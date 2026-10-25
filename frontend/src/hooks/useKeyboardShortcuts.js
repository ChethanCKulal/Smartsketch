import { useEffect } from "react";
import { ACTIONS } from "../canvas/commands/types";
import { useDiagramStore } from "../state/diagramStore";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.ctrlKey || e.metaKey;
      const tag = e.target.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable;
      const store = useDiagramStore.getState();

      // Typing owns the keyboard, including the browser's own undo inside a text
      // field: no canvas shortcut may fire while text is being entered.
      if (typing || store.editingNodeId) return;
      // A dialog owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"]')) return;

      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }
      if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (meta && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelection(store);
      }
      if (meta && e.key.toLowerCase() === "x") {
        e.preventDefault();
        copySelection(store);
        store.dispatch({
          action: ACTIONS.DELETE_SELECTION,
          payload: { ids: [...store.selectedIds, ...store.selectedEdgeIds] },
        });
      }
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        store.setSelection(store.diagram.nodes.map((n) => n.id), store.diagram.edges.map((e) => e.id));
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        store.dispatch({
          action: ACTIONS.DELETE_SELECTION,
          payload: { ids: [...store.selectedIds, ...store.selectedEdgeIds] },
        });
      }
      if (e.key === "+" || e.key === "=") window.__scZoomIn?.();
      if (e.key === "-" || e.key === "_") window.__scZoomOut?.();
      if (e.key === "0") window.__scFit?.({ padding: 0.2 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function copySelection(store) {
  const nodes = store.diagram.nodes.filter((n) => store.selectedIds.includes(n.id)).map((n) => structuredClone(n));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = store.diagram.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => structuredClone(e));
  store.setClipboard({ nodes, edges });
}
