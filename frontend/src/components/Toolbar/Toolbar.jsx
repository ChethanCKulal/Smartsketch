import { useRef, useState } from "react";
import { DIAGRAM_TYPES } from "../../schema/canonical";
import { ACTIONS } from "../../canvas/commands/types";
import { useDiagramStore } from "../../state/diagramStore";
import { CANVAS_BACKGROUNDS, useUiStore } from "../../state/uiStore";
import { exportPng, exportSvg, openJsonFile } from "../Export/exportDiagram";

function Tip({ title, children, onClick, disabled, active }) {
  return (
    <button className={`tb-btn ${active ? "active" : ""}`} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export default function Toolbar({ onUpload, onOpenFile, onNew }) {
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
  const saveDocument = useDiagramStore((s) => s.saveDocument);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const canvasBackground = useUiStore((s) => s.canvasBackground);
  const setCanvasBackground = useUiStore((s) => s.setCanvasBackground);
  const gridVisible = useUiStore((s) => s.gridVisible);
  const setGridVisible = useUiStore((s) => s.setGridVisible);
  const [exportOpen, setExportOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
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

  const nextTheme = theme === "dark" ? "light" : "dark";
  const customColor = /^#[0-9a-f]{6}$/i.test(canvasBackground) ? canvasBackground : "#101722";

  return (
    <header className="top-toolbar">
      <div className="brand">
        <div className="brand-mark" />
        SketchCanvas
      </div>
      <div className="toolbar-group">
        <Tip title="New document" onClick={onNew}>
          New
        </Tip>
        <Tip title="Open JSON" onClick={() => fileRef.current?.click()}>
          Open
        </Tip>
        <Tip title="Save the document (all pages) as JSON" onClick={saveDocument}>
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
        <Tip
          title={
            selectedIds.length
              ? "Resize the selected shapes to their text"
              : "Resize every shape to the text it holds"
          }
          onClick={() => dispatch({ action: ACTIONS.FIT_TEXT, payload: { ids: selectedIds } })}
          disabled={!diagram.nodes.length}
        >
          Fit text
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

      <div className="toolbar-group toolbar-end">
        <div className="export-menu">
          <Tip
            title="Canvas background and grid"
            active={canvasOpen}
            onClick={() => {
              setCanvasOpen((v) => !v);
              setExportOpen(false);
            }}
          >
            Canvas
          </Tip>
          {canvasOpen && (
            <div className="export-pop canvas-pop">
              <div className="pop-title">Canvas background</div>
              {CANVAS_BACKGROUNDS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={canvasBackground === option.id ? "active" : ""}
                  onClick={() => setCanvasBackground(option.id)}
                >
                  <span className={`bg-dot ${option.id}`} aria-hidden="true" />
                  {option.label}
                </button>
              ))}
              <label className="pop-field">
                Custom
                <input
                  type="color"
                  value={customColor}
                  aria-label="Custom canvas background"
                  onChange={(e) => setCanvasBackground(e.target.value)}
                />
              </label>
              <label className="pop-check">
                <input
                  type="checkbox"
                  checked={gridVisible}
                  onChange={(e) => setGridVisible(e.target.checked)}
                />
                Show grid
              </label>
            </div>
          )}
        </div>

        <button
          type="button"
          className="tb-btn theme-toggle"
          title={`Switch to ${nextTheme} theme`}
          aria-label={`Switch to ${nextTheme} theme`}
          onClick={toggleTheme}
        >
          {nextTheme === "light" ? <SunIcon /> : <MoonIcon />}
        </button>

        <div className="export-menu">
          <Tip
            title="Export"
            active={exportOpen}
            onClick={() => {
              setExportOpen((v) => !v);
              setCanvasOpen(false);
            }}
          >
            Export
          </Tip>
          {exportOpen && (
            <div className="export-pop">
              <button
                title="Export the current page as a PNG image"
                onClick={async () => {
                  await exportPng();
                  setExportOpen(false);
                }}
              >
                PNG — this page
              </button>
              <button
                title="Export the current page as an SVG image"
                onClick={async () => {
                  await exportSvg();
                  setExportOpen(false);
                }}
              >
                SVG — this page
              </button>
              <button
                title="Save the whole document, including every page, as JSON"
                onClick={() => {
                  saveDocument();
                  setExportOpen(false);
                }}
              >
                JSON — all pages
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <line x1="12" y1="2.2" x2="12" y2="4.6" />
        <line x1="12" y1="19.4" x2="12" y2="21.8" />
        <line x1="2.2" y1="12" x2="4.6" y2="12" />
        <line x1="19.4" y1="12" x2="21.8" y2="12" />
        <line x1="5.1" y1="5.1" x2="6.8" y2="6.8" />
        <line x1="17.2" y1="17.2" x2="18.9" y2="18.9" />
        <line x1="5.1" y1="18.9" x2="6.8" y2="17.2" />
        <line x1="17.2" y1="6.8" x2="18.9" y2="5.1" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
