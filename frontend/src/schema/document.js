/**
 * Multipage document model.
 *
 * A document is a name plus ordered pages; every page owns a complete canonical
 * diagram. The file keeps the single-page fields of the active page at the top
 * level as well, so a build that only understands one diagram still opens the
 * active page of a multipage file instead of discarding it.
 *
 * Everything here is pure: no React, no DOM. The store and the checks both use
 * it, and the XML importer reuses `sanitizeDiagram`.
 */

import { DIAGRAM_TYPES, emptyDiagram } from "./canonical.js";

export const DOCUMENT_FORMAT = "sketchcanvas.document";
export const DOCUMENT_VERSION = 2;

const DIAGRAM_TYPE_IDS = DIAGRAM_TYPES.map((t) => t.id);

function freshId(prefix) {
  const random = globalThis.crypto?.randomUUID?.()?.slice(0, 8) ||
    Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

function normalizeDiagramType(value, fallback = "flowchart") {
  const type = String(value || "").toLowerCase();
  return DIAGRAM_TYPE_IDS.includes(type) ? type : fallback;
}

/** A new, empty page with its own diagram. */
export function createPage(name = "Page 1", diagramType = "flowchart") {
  return {
    id: freshId("page"),
    name,
    diagram: emptyDiagram(normalizeDiagramType(diagramType)),
  };
}

/** A new, empty document with exactly one page. */
export function createDocument(diagramType = "flowchart", name = "Untitled Document") {
  const page = createPage("Page 1", diagramType);
  return {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    name,
    activePageId: page.id,
    pages: [page],
  };
}

export function activePage(document) {
  if (!document) return null;
  return (
    document.pages.find((page) => page.id === document.activePageId) ||
    document.pages[0] ||
    null
  );
}

export function pageHasContent(page) {
  const diagram = page?.diagram;
  if (!diagram) return false;
  return (diagram.nodes?.length || 0) + (diagram.edges?.length || 0) > 0;
}

/** Replace the active page's diagram without touching any other page. */
export function withPageDiagram(document, pageId, diagram) {
  return {
    ...document,
    activePageId: pageId,
    pages: document.pages.map((page) =>
      page.id === pageId ? { ...page, diagram } : page
    ),
  };
}

/** "Page 3" for a document whose existing names already include Page 1–2. */
export function nextPageName(document) {
  const used = new Set((document.pages || []).map((page) => page.name));
  let index = (document.pages?.length || 0) + 1;
  while (used.has(`Page ${index}`)) index += 1;
  return `Page ${index}`;
}

export function uniquePageName(document, baseName) {
  const used = new Set((document.pages || []).map((page) => page.name));
  if (!used.has(baseName)) return baseName;
  let index = 2;
  while (used.has(`${baseName} (${index})`)) index += 1;
  return `${baseName} (${index})`;
}

/**
 * Deep copy of a page with fresh node and edge ids, so editing a duplicate can
 * never reach back into the page it came from.
 */
export function clonePage(page, name) {
  const source = page?.diagram || emptyDiagram();
  const idMap = new Map();
  const nodes = (source.nodes || []).map((node) => {
    const id = freshId("node");
    idMap.set(node.id, id);
    return { ...structuredClone(node), id };
  });
  // Parents are remapped in a second pass: a group may appear after its children.
  for (const node of nodes) {
    if (node.parentId && idMap.has(node.parentId)) node.parentId = idMap.get(node.parentId);
  }
  const edges = (source.edges || []).map((edge) => ({
    ...structuredClone(edge),
    id: freshId("edge"),
    source: idMap.get(edge.source) || edge.source,
    target: idMap.get(edge.target) || edge.target,
  }));
  return {
    id: freshId("page"),
    name,
    diagram: { ...structuredClone(source), nodes, edges },
  };
}

/**
 * Repair what can be repaired and report what was dropped: duplicate node ids,
 * edges pointing at shapes that are not there, and missing arrays.
 *
 * Used when opening a file and when importing XML — never on the live canvas,
 * where the command layer already keeps these invariants.
 */
export function sanitizeDiagram(diagram, diagramType = "flowchart") {
  const warnings = [];
  const source = diagram && typeof diagram === "object" ? diagram : {};
  const base = emptyDiagram(normalizeDiagramType(source.diagram_type || diagramType));

  const nodes = [];
  const ids = new Set();
  for (const raw of Array.isArray(source.nodes) ? source.nodes : []) {
    if (!raw || typeof raw !== "object") {
      warnings.push("A node without data was skipped.");
      continue;
    }
    let id = raw.id == null ? "" : String(raw.id).trim();
    if (!id) {
      id = freshId("node");
      warnings.push("A node without an id was given a new one.");
    }
    if (ids.has(id)) {
      const replacement = `${id}_2`;
      let candidate = replacement;
      let n = 3;
      while (ids.has(candidate)) candidate = `${id}_${n++}`;
      warnings.push(`Duplicate node id "${id}" was renamed to "${candidate}".`);
      id = candidate;
    }
    ids.add(id);
    const position = raw.position || {};
    const size = raw.size || {};
    nodes.push({
      ...structuredClone(raw),
      id,
      position: {
        x: Number.isFinite(Number(position.x)) ? Number(position.x) : 0,
        y: Number.isFinite(Number(position.y)) ? Number(position.y) : 0,
      },
      size: {
        width: Number.isFinite(Number(size.width)) ? Number(size.width) : 160,
        height: Number.isFinite(Number(size.height)) ? Number(size.height) : 72,
      },
    });
  }

  const edges = [];
  const edgeIds = new Set();
  let dangling = 0;
  for (const raw of Array.isArray(source.edges) ? source.edges : []) {
    if (!raw || typeof raw !== "object") continue;
    if (!ids.has(raw.source) || !ids.has(raw.target)) {
      dangling += 1;
      continue;
    }
    let id = raw.id == null ? "" : String(raw.id).trim();
    if (!id) id = freshId("edge");
    if (edgeIds.has(id)) {
      const candidate = `${id}_2`;
      let suffix = 3;
      let next = candidate;
      while (edgeIds.has(next)) next = `${id}_${suffix++}`;
      warnings.push(`Duplicate edge id "${id}" was renamed to "${next}".`);
      id = next;
    }
    edgeIds.add(id);
    edges.push({ ...structuredClone(raw), id });
  }
  if (dangling) {
    warnings.push(
      `${dangling} connector${dangling === 1 ? "" : "s"} skipped: no shape at both ends.`
    );
  }

  return {
    diagram: {
      ...base,
      ...structuredClone(source),
      diagram_type: normalizeDiagramType(source.diagram_type || diagramType),
      nodes,
      edges,
      groups: Array.isArray(source.groups) ? source.groups : [],
      meta: { ...base.meta, ...(source.meta || {}) },
    },
    warnings,
  };
}

/** Order-insensitive serialization, so dirty checks ignore key order. */
export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (input) => {
    if (input === null || typeof input !== "object") {
      if (typeof input === "number" && !Number.isFinite(input)) return "null";
      return JSON.stringify(input);
    }
    if (seen.has(input)) return "null";
    seen.add(input);
    if (Array.isArray(input)) return `[${input.map(walk).join(",")}]`;
    const keys = Object.keys(input).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${walk(input[key])}`).join(",")}}`;
  };
  return walk(value);
}

/**
 * What counts as "the document" for unsaved-change detection. The active page
 * is excluded: merely looking at another page is not an edit.
 */
export function documentSnapshot(document) {
  return stableStringify({
    name: document?.name || "",
    pages: (document?.pages || []).map((page) => ({
      name: page.name,
      diagram: page.diagram,
    })),
  });
}

/**
 * The JSON written by Save. `pages` is the document; the top-level fields mirror
 * the active page for single-page readers.
 */
export function toFilePayload(document) {
  const page = activePage(document) || createPage();
  return {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    name: document?.name || "Untitled Document",
    activePageId: page.id,
    pages: (document?.pages || []).map((item) => ({
      id: item.id,
      name: item.name,
      diagram: item.diagram,
    })),
    diagram_type: page.diagram.diagram_type,
    nodes: page.diagram.nodes,
    edges: page.diagram.edges,
    groups: page.diagram.groups,
    meta: page.diagram.meta,
  };
}

/**
 * Read either a multipage document or a legacy single diagram.
 * Returns `{ ok, document, warnings, error }` and never mutates the input.
 */
export function parseDocument(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "That file is not a SmartSketch document." };
  }

  const rawPages = Array.isArray(data.pages) ? data.pages : null;
  if (rawPages && rawPages.length) {
    const warnings = [];
    const pages = [];
    const usedIds = new Set();
    rawPages.forEach((raw, index) => {
      const diagramSource = raw?.diagram && typeof raw.diagram === "object" ? raw.diagram : raw;
      const name =
        String(raw?.name || diagramSource?.meta?.name || `Page ${index + 1}`).trim() ||
        `Page ${index + 1}`;
      const { diagram, warnings: pageWarnings } = sanitizeDiagram(diagramSource);
      warnings.push(...pageWarnings.map((w) => `${name}: ${w}`));
      let id = raw?.id ? String(raw.id) : freshId("page");
      if (usedIds.has(id)) id = freshId("page");
      usedIds.add(id);
      pages.push({ id, name, diagram });
    });

    const activeId = pages.some((page) => page.id === data.activePageId)
      ? data.activePageId
      : pages[0].id;

    return {
      ok: true,
      warnings,
      document: {
        format: DOCUMENT_FORMAT,
        version: DOCUMENT_VERSION,
        name: String(data.name || data.meta?.name || "Imported Document").trim(),
        activePageId: activeId,
        pages,
      },
    };
  }

  // Legacy single-page diagram: wrap it in a one-page document.
  if (Array.isArray(data.nodes) || data.diagram_type) {
    const { diagram, warnings } = sanitizeDiagram(data);
    const page = {
      id: freshId("page"),
      name: "Page 1",
      diagram,
    };
    return {
      ok: true,
      warnings,
      document: {
        format: DOCUMENT_FORMAT,
        version: DOCUMENT_VERSION,
        name: String(data.meta?.name || "Untitled Document").trim() || "Untitled Document",
        activePageId: page.id,
        pages: [page],
      },
    };
  }

  return { ok: false, error: "That file contains no pages or diagram." };
}
