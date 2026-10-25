import { create } from "zustand";
import { emptyDiagram } from "../schema/canonical.js";
import {
  activePage,
  clonePage,
  createDocument,
  createPage,
  documentSnapshot,
  nextPageName,
  parseDocument,
  toFilePayload,
  uniquePageName,
  withPageDiagram,
} from "../schema/document.js";
import { applyCommand } from "../canvas/commands/executor.js";
import {
  createHistory,
  pushSnapshot,
  redo as redoHistory,
  undo as undoHistory,
} from "../canvas/history/historyManager.js";
import { ACTIONS } from "../canvas/commands/types.js";
import { downloadJson, safeFileName } from "../utils/download.js";

const initialDocument = createDocument("flowchart");
const initialPage = initialDocument.pages[0];
const initialHistory = createHistory(initialPage.diagram);

/**
 * The state of "the page the editor is showing now".
 *
 * The active page's diagram is mirrored into `document.pages`, so every edit is
 * immediately part of the document and unsaved-change detection can compare the
 * whole document with what was last written to disk.
 */
function pageView(document, page, histories, extra = {}) {
  const history = histories[page.id] || createHistory(page.diagram);
  return {
    document,
    activePageId: page.id,
    diagram: page.diagram,
    history,
    pageHistories: { ...histories, [page.id]: history },
    selectedIds: [],
    selectedEdgeIds: [],
    editingNodeId: null,
    editingCompartment: null,
    ...extra,
  };
}

export const useDiagramStore = create((set, get) => ({
  // --- document ---------------------------------------------------------
  document: initialDocument,
  activePageId: initialPage.id,
  // Undo history is per page: one page's stack is never applied to another.
  pageHistories: { [initialPage.id]: initialHistory },
  // Serialized document as last written to disk, for dirty detection.
  savedSnapshot: documentSnapshot(initialDocument),

  // --- active page ------------------------------------------------------
  diagram: initialPage.diagram,
  history: initialHistory,
  selectedIds: [],
  selectedEdgeIds: [],
  clipboard: { nodes: [], edges: [] },
  zoom: 1,
  snapToGrid: true,
  gridSize: 16,
  status: "Ready",
  statusKind: "ok",
  chatbotLog: [],
  lastCommand: null,
  // The node being edited inline, and which part of it: null for a plain
  // label, "title" / "attributes" / "methods" for a UML class.
  editingNodeId: null,
  editingCompartment: null,

  dispatch(command, { record = true } = {}) {
    const { diagram, history, document, activePageId, pageHistories } = get();
    const result = applyCommand(diagram, command);
    if (!result.ok) {
      set({ status: result.error, statusKind: "error" });
      return result;
    }
    const nextHistory = record
      ? pushSnapshot(history, result.diagram)
      : { ...history, present: result.diagram };
    set({
      diagram: result.diagram,
      history: nextHistory,
      pageHistories: { ...pageHistories, [activePageId]: nextHistory },
      document: withPageDiagram(document, activePageId, result.diagram),
      status: result.message || "Updated diagram.",
      statusKind: "ok",
      lastCommand: command,
    });
    return result;
  },

  undo() {
    const { history, document, activePageId, pageHistories } = get();
    const next = undoHistory(history);
    if (next === history) return;
    set({
      history: next,
      diagram: next.present,
      pageHistories: { ...pageHistories, [activePageId]: next },
      document: withPageDiagram(document, activePageId, next.present),
      status: "Undo",
      statusKind: "ok",
    });
  },

  redo() {
    const { history, document, activePageId, pageHistories } = get();
    const next = redoHistory(history);
    if (next === history) return;
    set({
      history: next,
      diagram: next.present,
      pageHistories: { ...pageHistories, [activePageId]: next },
      document: withPageDiagram(document, activePageId, next.present),
      status: "Redo",
      statusKind: "ok",
    });
  },

  setSelection(nodeIds, edgeIds = []) {
    set({ selectedIds: nodeIds, selectedEdgeIds: edgeIds });
  },

  setClipboard(payload) {
    set({ clipboard: payload });
  },

  setZoom(zoom) {
    set({ zoom });
  },

  setEditingNode(editingNodeId, editingCompartment = null) {
    set({ editingNodeId, editingCompartment });
  },

  setSnap(snapToGrid) {
    set({ snapToGrid });
  },

  setStatus(status, statusKind = "ok") {
    set({ status, statusKind });
  },

  pushChat(entry) {
    set({ chatbotLog: [...get().chatbotLog, entry].slice(-80) });
  },

  // --- pages ------------------------------------------------------------
  setActivePage(id) {
    const { document, activePageId, pageHistories, history } = get();
    if (!document || id === activePageId) return;
    const page = document.pages.find((item) => item.id === id);
    if (!page) return;
    // Park the current page's history under its own id before switching.
    const histories = { ...pageHistories, [activePageId]: history };
    set(
      pageView({ ...document, activePageId: id }, page, histories, {
        status: `Page: ${page.name}`,
        statusKind: "ok",
      })
    );
  },

  addPage(name) {
    const { document, pageHistories, diagram } = get();
    const page = createPage(
      name ? uniquePageName(document, String(name).trim()) : nextPageName(document),
      diagram?.diagram_type || "flowchart"
    );
    const nextDocument = {
      ...document,
      pages: [...document.pages, page],
      activePageId: page.id,
    };
    set(
      pageView(nextDocument, page, pageHistories, {
        status: `Added ${page.name}.`,
        statusKind: "ok",
      })
    );
    return page;
  },

  duplicatePage(id) {
    const { document, pageHistories } = get();
    const index = document.pages.findIndex((page) => page.id === id);
    if (index < 0) return null;
    const source = document.pages[index];
    const copy = clonePage(source, uniquePageName(document, `${source.name} copy`));
    const pages = [...document.pages];
    pages.splice(index + 1, 0, copy);
    const nextDocument = { ...document, pages, activePageId: copy.id };
    set(
      pageView(nextDocument, copy, pageHistories, {
        status: `Duplicated ${source.name}.`,
        statusKind: "ok",
      })
    );
    return copy;
  },

  /** The document name is the saved file name, so it is part of the document. */
  renameDocument(name) {
    const { document } = get();
    const trimmed = String(name || "").trim();
    if (!trimmed || trimmed === document.name) return false;
    set({
      document: { ...document, name: trimmed },
      status: `Renamed document to ${trimmed}.`,
      statusKind: "ok",
    });
    return true;
  },

  renamePage(id, name) {
    const { document } = get();
    const page = document.pages.find((item) => item.id === id);
    if (!page) return false;
    const trimmed = String(name || "").trim();
    if (!trimmed || trimmed === page.name) return false;
    if (document.pages.some((item) => item.id !== id && item.name === trimmed)) {
      set({ status: `A page named "${trimmed}" already exists.`, statusKind: "error" });
      return false;
    }
    const pages = document.pages.map((item) =>
      item.id === id ? { ...item, name: trimmed } : item
    );
    set({
      document: { ...document, pages },
      status: `Renamed page to ${trimmed}.`,
      statusKind: "ok",
    });
    return true;
  },

  deletePage(id) {
    const { document, activePageId, pageHistories } = get();
    if (document.pages.length <= 1) {
      set({ status: "A document needs at least one page.", statusKind: "error" });
      return false;
    }
    const index = document.pages.findIndex((page) => page.id === id);
    if (index < 0) return false;
    const pages = document.pages.filter((page) => page.id !== id);
    const histories = { ...pageHistories };
    delete histories[id];

    if (id !== activePageId) {
      set({
        document: { ...document, pages },
        pageHistories: histories,
        status: "Deleted page.",
        statusKind: "ok",
      });
      return true;
    }
    const nextPage = pages[Math.min(index, pages.length - 1)];
    set(
      pageView(
        { ...document, pages, activePageId: nextPage.id },
        nextPage,
        histories,
        { status: `Deleted page — showing ${nextPage.name}.`, statusKind: "ok" }
      )
    );
    return true;
  },

  movePage(id, delta) {
    const { document } = get();
    const index = document.pages.findIndex((page) => page.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= document.pages.length) return false;
    const pages = [...document.pages];
    const [page] = pages.splice(index, 1);
    pages.splice(target, 0, page);
    set({
      document: { ...document, pages },
      status: `Moved ${page.name}.`,
      statusKind: "ok",
    });
    return true;
  },

  /** Add imported pages after the existing ones and show the first of them. */
  importPages(entries) {
    const { document, pageHistories } = get();
    const names = new Set(document.pages.map((page) => page.name));
    const pages = (entries || []).map((entry, index) => {
      const diagramType = entry?.diagram?.diagram_type || "flowchart";
      const page = createPage(entry?.name || `Page ${document.pages.length + index + 1}`, diagramType);
      let name = page.name;
      let suffix = 2;
      while (names.has(name)) name = `${page.name} (${suffix++})`;
      names.add(name);
      return {
        ...page,
        name,
        diagram: { ...emptyDiagram(diagramType), ...entry.diagram, meta: { ...entry.diagram?.meta, name } },
      };
    });
    if (!pages.length) return [];

    const nextDocument = {
      ...document,
      pages: [...document.pages, ...pages],
      activePageId: pages[0].id,
    };
    set(
      pageView(nextDocument, pages[0], pageHistories, {
        status: `Imported ${pages.length} page${pages.length === 1 ? "" : "s"}.`,
        statusKind: "ok",
      })
    );
    return pages;
  },

  // --- document lifecycle ----------------------------------------------
  isDirty() {
    return documentSnapshot(get().document) !== get().savedSnapshot;
  },

  /**
   * Write the whole document to disk. Returns false if nothing was saved.
   *
   * `write` is the only side effect and is injectable so the save contract
   * (clean only after success, document kept on failure) can be checked
   * outside a browser.
   */
  saveDocument(write = downloadJson) {
    const { document } = get();
    const payload = toFilePayload(document);
    try {
      write(`${safeFileName(document.name, "sketchcanvas")}.json`, payload);
    } catch (error) {
      set({
        status: `Could not save: ${error?.message || "the browser refused the download"}. Your work is still open.`,
        statusKind: "error",
      });
      return false;
    }
    set({
      // Only a completed write marks the document clean.
      savedSnapshot: documentSnapshot(document),
      status: `Saved ${payload.pages.length} page${payload.pages.length === 1 ? "" : "s"} to ${safeFileName(document.name, "sketchcanvas")}.json.`,
      statusKind: "ok",
    });
    return true;
  },

  newDocument(diagramType = "flowchart") {
    const document = createDocument(diagramType || "flowchart");
    const page = document.pages[0];
    const history = createHistory(page.diagram);
    set({
      document,
      activePageId: page.id,
      diagram: page.diagram,
      history,
      pageHistories: { [page.id]: history },
      savedSnapshot: documentSnapshot(document),
      selectedIds: [],
      selectedEdgeIds: [],
      editingNodeId: null,
      editingCompartment: null,
      lastCommand: null,
      status: "New document",
      statusKind: "ok",
    });
  },

  /** Open a saved document, or a legacy single-diagram file. */
  loadDocument(data) {
    const parsed = parseDocument(data);
    if (!parsed.ok) {
      set({ status: parsed.error, statusKind: "error" });
      return parsed;
    }
    const document = parsed.document;
    const page = activePage(document);
    const histories = {};
    for (const item of document.pages) histories[item.id] = createHistory(item.diagram);
    set({
      ...pageView(document, page, histories),
      savedSnapshot: documentSnapshot(document),
      status: parsed.warnings.length
        ? `Opened ${document.name} — ${parsed.warnings.length} warning${parsed.warnings.length === 1 ? "" : "s"}.`
        : `Opened ${document.name}.`,
      statusKind: parsed.warnings.length ? "warn" : "ok",
    });
    return parsed;
  },

  /** Load one diagram into the active page (recognition, XML import). */
  loadDiagram(diagram) {
    return get().dispatch({ action: ACTIONS.LOAD_DIAGRAM, payload: { diagram } });
  },
}));
