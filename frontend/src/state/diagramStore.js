import { create } from "zustand";
import { emptyDiagram } from "../schema/canonical";
import { applyCommand } from "../canvas/commands/executor";
import { createHistory, pushSnapshot, redo as redoHistory, undo as undoHistory } from "../canvas/history/historyManager";
import { ACTIONS } from "../canvas/commands/types";

const initial = emptyDiagram("flowchart");

export const useDiagramStore = create((set, get) => ({
  diagram: initial,
  history: createHistory(initial),
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

  dispatch(command, { record = true } = {}) {
    const { diagram, history } = get();
    const result = applyCommand(diagram, command);
    if (!result.ok) {
      set({ status: result.error, statusKind: "error" });
      return result;
    }
    const nextHistory = record ? pushSnapshot(history, result.diagram) : { ...history, present: result.diagram };
    set({
      diagram: result.diagram,
      history: nextHistory,
      status: result.message || "Updated diagram.",
      statusKind: "ok",
      lastCommand: command,
    });
    return result;
  },

  undo() {
    const next = undoHistory(get().history);
    set({
      history: next,
      diagram: next.present,
      status: "Undo",
      statusKind: "ok",
    });
  },

  redo() {
    const next = redoHistory(get().history);
    set({
      history: next,
      diagram: next.present,
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

  setSnap(snapToGrid) {
    set({ snapToGrid });
  },

  setStatus(status, statusKind = "ok") {
    set({ status, statusKind });
  },

  pushChat(entry) {
    set({ chatbotLog: [...get().chatbotLog, entry].slice(-80) });
  },

  newDiagram(type = "flowchart") {
    const diagram = emptyDiagram(type);
    set({
      diagram,
      history: createHistory(diagram),
      selectedIds: [],
      selectedEdgeIds: [],
      status: "New diagram",
      statusKind: "ok",
    });
  },

  loadDiagram(diagram) {
    return get().dispatch({ action: ACTIONS.LOAD_DIAGRAM, payload: { diagram } });
  },
}));
