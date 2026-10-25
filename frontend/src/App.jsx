import { useEffect, useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import Toolbar from "./components/Toolbar/Toolbar";
import ShapePanel from "./components/ShapePanel/ShapePanel";
import Canvas from "./components/Canvas/Canvas";
import PropertiesPanel from "./components/PropertiesPanel/PropertiesPanel";
import Chatbot from "./components/Chatbot/Chatbot";
import UploadModal from "./components/Upload/UploadModal";
import PageBar from "./components/PageBar/PageBar";
import NewDocumentDialog from "./components/Dialogs/NewDocumentDialog";
import ImportDialog from "./components/Import/ImportDialog";
import { useDiagramStore } from "./state/diagramStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useClipboardPaste } from "./hooks/useClipboardPaste";
import { documentSnapshot } from "./schema/document";
import { buildImportedDiagram } from "./import/drawioXml";
import { healthCheck } from "./services/api";

export default function App() {
  const [rightTab, setRightTab] = useState("properties");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const diagram = useDiagramStore((s) => s.diagram);
  const doc = useDiagramStore((s) => s.document);
  const savedSnapshot = useDiagramStore((s) => s.savedSnapshot);
  const activePageId = useDiagramStore((s) => s.activePageId);
  const status = useDiagramStore((s) => s.status);
  const statusKind = useDiagramStore((s) => s.statusKind);
  const zoom = useDiagramStore((s) => s.zoom);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const loadDiagram = useDiagramStore((s) => s.loadDiagram);
  const loadDocument = useDiagramStore((s) => s.loadDocument);
  const newDocument = useDiagramStore((s) => s.newDocument);
  const importPages = useDiagramStore((s) => s.importPages);
  const setStatus = useDiagramStore((s) => s.setStatus);

  useKeyboardShortcuts();
  const { request: importRequest, close: closeImport } = useClipboardPaste();

  // Dirtiness is a snapshot comparison, not a flag: undo back to the saved state
  // makes the document clean again, and selection/zoom never touch it.
  const dirty = useMemo(() => documentSnapshot(doc) !== savedSnapshot, [doc, savedSnapshot]);
  const pageIndex = Math.max(0, doc.pages.findIndex((page) => page.id === activePageId));

  useEffect(() => {
    healthCheck().then((h) => {
      if (!h.ok) setStatus("Backend offline — editor still works locally.", "warn");
      else setStatus("Ready", "ok");
    });
  }, [setStatus]);

  // One native warning for unsaved document data. Nothing else registers a
  // beforeunload listener, so there is exactly one prompt.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const handleNew = () => {
    if (dirty) {
      setNewOpen(true);
      return;
    }
    newDocument(diagram.diagram_type);
  };

  const handleImport = ({ mode, pageIndex: chosenIndex, diagramType }) => {
    const pages = importRequest?.pages || [];
    if (!pages.length) return;

    if (mode === "all") {
      const entries = pages.map((page, index) => {
        const built = buildImportedDiagram(page, diagramType);
        return { name: page.name || `Page ${index + 1}`, ...built };
      });
      const shapes = entries.reduce((sum, entry) => sum + entry.stats.shapes, 0);
      const connectors = entries.reduce((sum, entry) => sum + entry.stats.connectors, 0);
      const warnings = entries.reduce((sum, entry) => sum + entry.warnings.length, 0);
      if (!shapes && !connectors) {
        setStatus("Nothing importable in that XML — the current diagram was left untouched.", "error");
        closeImport();
        return;
      }
      importPages(entries.map(({ name, diagram: page }) => ({ name, diagram: page })), diagramType);
      setStatus(
        `Imported ${entries.length} page${entries.length === 1 ? "" : "s"}: ${shapes} shape${
          shapes === 1 ? "" : "s"
        }, ${connectors} connector${connectors === 1 ? "" : "s"}${
          warnings ? ` — ${warnings} warning${warnings === 1 ? "" : "s"}` : ""
        }.`,
        warnings ? "warn" : "ok",
      );
    } else {
      const page = pages[chosenIndex] || pages[0];
      const built = buildImportedDiagram(page, diagramType);
      if (!built.diagram.nodes.length && !built.diagram.edges.length) {
        setStatus("Nothing importable in that page — the current diagram was left untouched.", "error");
        closeImport();
        return;
      }
      loadDiagram(built.diagram);
      setStatus(
        `Imported ${built.stats.shapes} shape${built.stats.shapes === 1 ? "" : "s"} and ${
          built.stats.connectors
        } connector${built.stats.connectors === 1 ? "" : "s"}${
          built.warnings.length ? ` — ${built.warnings.length} warning${built.warnings.length === 1 ? "" : "s"}` : ""
        }.`,
        built.warnings.length ? "warn" : "ok",
      );
    }

    closeImport();
    // The new content lands after React commits; fit once it is on the canvas.
    window.setTimeout(() => window.__scFit?.({ padding: 0.2 }), 120);
  };

  return (
    <div className="app-shell">
      <Toolbar onUpload={() => setUploadOpen(true)} onOpenFile={(data) => loadDocument(data)} onNew={handleNew} />
      <div className="workspace">
        <ShapePanel />
        <ReactFlowProvider>
          <div className="canvas-column">
            <Canvas />
            <PageBar dirty={dirty} onNotice={(message, kind) => setStatus(message, kind)} />
          </div>
        </ReactFlowProvider>
        <aside className="right-panel">
          <div className="right-tabs">
            <button className={rightTab === "properties" ? "active" : ""} onClick={() => setRightTab("properties")}>
              Properties
            </button>
            <button className={rightTab === "chat" ? "active" : ""} onClick={() => setRightTab("chat")}>
              Chatbot
            </button>
          </div>
          {rightTab === "properties" ? <PropertiesPanel /> : <Chatbot />}
        </aside>
      </div>
      <footer className={`status-bar ${statusKind}`}>
        <span>
          {status}
          {dirty ? <span className="dirty-dot" title="Unsaved changes"> ●</span> : null}
        </span>
        <span>
          {doc.name} · page {pageIndex + 1}/{doc.pages.length} · {diagram.diagram_type} · {diagram.nodes.length} node
          {diagram.nodes.length === 1 ? "" : "s"} · {diagram.edges.length} edge
          {diagram.edges.length === 1 ? "" : "s"} · {selectedIds.length} selected · {Math.round(zoom * 100)}%
        </span>
      </footer>
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onRecognized={(result) => {
          if (result.diagram) {
            loadDiagram(result.diagram);
            setStatus(result.message || "Recognition complete.", result.partial ? "warn" : "ok");
            setUploadOpen(false);
          }
        }}
      />
      <NewDocumentDialog open={newOpen} onCancel={() => setNewOpen(false)} />
      <ImportDialog request={importRequest} onCancel={closeImport} onImport={handleImport} />
    </div>
  );
}
