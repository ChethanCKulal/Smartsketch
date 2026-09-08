import { useRef, useState } from "react";
import { DIAGRAM_TYPES } from "../../schema/canonical";
import { ACTIONS } from "../../canvas/commands/types";
import { useDiagramStore } from "../../state/diagramStore";
import { exportJson, exportPng, exportSvg, openJsonFile } from "../Export/exportDiagram";

function Tip({ title, children, onClick, disabled, active }) {
  return (
    <button className={`tb-btn ${active ? "active" : ""}`} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export default function Toolbar({ onUpload, onOpenFile }) {
  const diagram = useDiagramStore((s) => s.diagram);
  const dispatch = useDiagramStore((s) => s.dispatch);
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const history = useDiagramStore((s) => s.history);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const selectedEdgeIds = useDiagramStore((s) => s.selectedEdgeIds);
  const clipboard = useDiagramStore((s) => s.clipboard);
  const setClipboard = useDiagramStore((s) => s.setClipboard);
  const snapToGrid = useDiagramStore((s) => s.snapToGrid);
  const setSnap = useDiagramStore((s) => s.setSnap);
  const newDiagram = useDiagramStore((s) => s.newDiagram);
  const [exportOpen, setExportOpen] = useState(false);
  const fileRef = useRef();

  const selectedNodes = diagram.nodes.filter((n) => selectedIds.includes(n.id));
  const locked = selectedNodes.length > 0 && selectedNodes.every((n) => n.locked);

  const copy = () => {
    const nodes = selectedNodes.map((n) => structuredClone(n));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = diagram.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => structuredClone(e));
    setClipboard({ nodes, edges });
  };

  const cut = () => {
    copy();
    dispatch({ action: ACTIONS.DELETE_SELECTION, payload: { ids: [...selectedIds, ...selectedEdgeIds] } });
  };

  const paste = () => {
    if (!clipboard.nodes?.length) return;
    dispatch({ action: ACTIONS.PASTE, payload: clipboard });
  };

  return (
    <header className="top-toolbar">
      <div className="brand">
        <div className="brand-mark" />
        SketchCanvas
      </div>
      <div className="toolbar-group">
        <Tip title="New diagram" onClick={() => newDiagram(diagram.diagram_type)}>
          New
        </Tip>
        <Tip title="Open JSON" onClick={() => fileRef.current?.click()}>
          Open
        </Tip>
        <Tip title="Save JSON" onClick={exportJson}>
          Save
        </Tip>
        <Tip title="Upload photograph" onClick={onUpload}>
          Upload
        </Tip>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const data = await openJsonFile(file);
            onOpenFile(data);
          }}
        />
      </div>
      <div className="toolbar-group">
        <Tip title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.past.length}>
          Undo
        </Tip>
        <Tip title="Redo (Ctrl+Y)" onClick={redo} disabled={!history.future.length}>
          Redo
        </Tip>
      </div>
      <div className="toolbar-group">
        <Tip title="Zoom in" onClick={() => window.__scZoomIn?.()}>
          +
        </Tip>
        <Tip title="Zoom out" onClick={() => window.__scZoomOut?.()}>
          −
        </Tip>
        <Tip title="Fit to screen" onClick={() => window.__scFit?.({ padding: 0.2 })}>
          Fit
        </Tip>
      </div>
      <div className="toolbar-group">
        <Tip
          title="Delete"
          onClick={() => dispatch({ action: ACTIONS.DELETE_SELECTION, payload: { ids: [...selectedIds, ...selectedEdgeIds] } })}
          disabled={!selectedIds.length && !selectedEdgeIds.length}
        >
          Delete
        </Tip>
        <Tip title="Copy (Ctrl+C)" onClick={copy} disabled={!selectedIds.length}>
          Copy
        </Tip>
        <Tip title="Paste (Ctrl+V)" onClick={paste} disabled={!clipboard.nodes?.length}>
          Paste
        </Tip>
        <Tip title="Cut (Ctrl+X)" onClick={cut} disabled={!selectedIds.length}>
          Cut
        </Tip>
      </div>
      <div className="toolbar-group">
        <Tip
          title="Group"
          onClick={() => dispatch({ action: ACTIONS.GROUP, payload: { ids: selectedIds } })}
          disabled={selectedIds.length < 2}
        >
          Group
        </Tip>
        <Tip
          title="Ungroup"
          onClick={() => dispatch({ action: ACTIONS.UNGROUP, payload: { ids: selectedIds } })}
          disabled={!selectedNodes.some((n) => n.type === "group")}
        >
          Ungroup
        </Tip>
        <Tip
          title={locked ? "Unlock" : "Lock"}
          onClick={() =>
            dispatch({
              action: locked ? ACTIONS.UNLOCK : ACTIONS.LOCK,
              payload: { ids: selectedIds },
            })
          }
          disabled={!selectedIds.length}
        >
          {locked ? "Unlock" : "Lock"}
        </Tip>
        <Tip title="Toggle snap to grid" active={snapToGrid} onClick={() => setSnap(!snapToGrid)}>
          Snap
        </Tip>
      </div>
      <div className="toolbar-group">
        <select
          className="toolbar-select"
          title="Diagram type"
          value={diagram.diagram_type}
          onChange={(e) => dispatch({ action: ACTIONS.SET_DIAGRAM_TYPE, payload: { diagram_type: e.target.value } })}
        >
          {DIAGRAM_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar-group export-menu" style={{ marginLeft: "auto" }}>
        <Tip title="Export" onClick={() => setExportOpen((v) => !v)}>
          Export
        </Tip>
        {exportOpen && (
          <div className="export-pop">
            <button
              onClick={async () => {
                await exportPng();
                setExportOpen(false);
              }}
            >
              PNG
            </button>
            <button
              onClick={async () => {
                await exportSvg();
                setExportOpen(false);
              }}
            >
              SVG
            </button>
            <button
              onClick={() => {
                exportJson();
                setExportOpen(false);
              }}
            >
              JSON
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
