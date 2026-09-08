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
      if (typing) return;
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
      if (meta && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (store.clipboard.nodes?.length) store.dispatch({ action: ACTIONS.PASTE, payload: store.clipboard });
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
