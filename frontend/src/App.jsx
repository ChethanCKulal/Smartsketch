import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import Toolbar from "./components/Toolbar/Toolbar";
import ShapePanel from "./components/ShapePanel/ShapePanel";
import Canvas from "./components/Canvas/Canvas";
import PropertiesPanel from "./components/PropertiesPanel/PropertiesPanel";
import Chatbot from "./components/Chatbot/Chatbot";
import UploadModal from "./components/Upload/UploadModal";
import { useDiagramStore } from "./state/diagramStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { healthCheck } from "./services/api";

export default function App() {
  const [rightTab, setRightTab] = useState("properties");
  const [uploadOpen, setUploadOpen] = useState(false);
  const diagram = useDiagramStore((s) => s.diagram);
  const status = useDiagramStore((s) => s.status);
  const statusKind = useDiagramStore((s) => s.statusKind);
  const zoom = useDiagramStore((s) => s.zoom);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const loadDiagram = useDiagramStore((s) => s.loadDiagram);
  const setStatus = useDiagramStore((s) => s.setStatus);

  useKeyboardShortcuts();

  useEffect(() => {
    healthCheck().then((h) => {
      if (!h.ok) setStatus("Backend offline — editor still works locally.", "warn");
      else setStatus("Ready", "ok");
    });
  }, [setStatus]);

  return (
    <div className="app-shell">
      <Toolbar onUpload={() => setUploadOpen(true)} onOpenFile={(data) => loadDiagram(data)} />
      <div className="workspace">
        <ShapePanel />
        <ReactFlowProvider>
          <Canvas />
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
        <span>{status}</span>
        <span>
          {diagram.diagram_type} · {diagram.nodes.length} nodes · {diagram.edges.length} edges ·{" "}
          {selectedIds.length} selected · {Math.round(zoom * 100)}%
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
    </div>
  );
}
