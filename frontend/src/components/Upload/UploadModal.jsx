import { useEffect, useRef, useState } from "react";
import { recognizeDiagram } from "../../services/api";

const TYPES = ["image/png", "image/jpeg", "image/jpg"];
const MAX = 8 * 1024 * 1024;

const TYPE_CARDS = [
  { id: "flowchart", label: "Flowchart", detail: "Process, decision, terminator…", glyph: "⇨" },
  { id: "er", label: "ER Diagram", detail: "Entities, relationships, attributes", glyph: "▣" },
  { id: "uml", label: "UML Class", detail: "Classes, interfaces, actors", glyph: "☰" },
  { id: "dfd", label: "DFD", detail: "Processes, data stores, flows", glyph: "◉" },
];

export default function UploadModal({ open, onClose, onRecognized }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState(0);
  const [diagramType, setDiagramType] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const [sourcesReport, setSourcesReport] = useState(null);
  const inputRef = useRef();

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!open) return null;

  const pick = (f) => {
    setError("");
    setReport(null);
    setSourcesReport(null);
    if (!f) return;
    if (!TYPES.includes(f.type) && !/\.(png|jpe?g)$/i.test(f.name)) {
      setError("Invalid image. Use PNG, JPG, or JPEG.");
      return;
    }
    if (f.size > MAX) {
      setError("Image exceeds 8 MB limit.");
      return;
    }
    setFile(f);
  };

  const transformedFile = async () => {
    const img = new Image();
    img.src = preview;
    await img.decode();
    const canvas = document.createElement("canvas");
    const rad = (rotation * Math.PI) / 180;
    const w = img.width;
    const h = img.height;
    const inset = Math.round(Math.min(w, h) * (crop / 100) * 0.2);
    const cw = Math.abs(Math.cos(rad) * w) + Math.abs(Math.sin(rad) * h);
    const ch = Math.abs(Math.sin(rad) * w) + Math.abs(Math.cos(rad) * h);
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -w / 2 + inset / 2, -h / 2 + inset / 2, w - inset, h - inset);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return new File([blob], file.name.replace(/\.\w+$/, ".png"), { type: "image/png" });
  };

  const start = async () => {
    if (!file) {
      setError("Upload an image first.");
      return;
    }
    if (!diagramType) {
      setError("Choose the diagram type before starting recognition.");
      return;
    }
    setBusy(true);
    setError("");
    setProgress("Processing Image");
    try {
      const payload = await transformedFile();
      const result = await recognizeDiagram({
        file: payload,
        diagramType,
        autoDetect: false,
      });
      setReport(result.reconciliation);
      setSourcesReport(result.sources || null);
      setProgress("Recognition complete.");
      onRecognized(result);
    } catch (err) {
      setError(err.message || "Recognition failed.");
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  const chosen = TYPE_CARDS.find((t) => t.id === diagramType);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Upload diagram photograph</h2>
        <p>Send a hand-drawn diagram to both vision services. Results are reconciled into editable canvas objects.</p>

        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0]);
          }}
          onClick={() => inputRef.current?.click()}
        >
          Drop PNG/JPG here or click to browse
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(e) => pick(e.target.files[0])}
          />
        </div>

        {preview && (
          <div className="preview-wrap">
            <img src={preview} alt="Preview" style={{ transform: `rotate(${rotation}deg) scale(${1 - crop / 200})` }} />
          </div>
        )}
        <div className="prop-row">
          <label>
            Rotate
            <input type="range" min="0" max="360" value={rotation} onChange={(e) => setRotation(Number(e.target.value))} />
          </label>
          <label>
            Crop inset
            <input type="range" min="0" max="40" value={crop} onChange={(e) => setCrop(Number(e.target.value))} />
          </label>
        </div>

        <div className="type-picker">
          <div className="type-picker-title">What kind of diagram is this?</div>
          <div className="type-grid">
            {TYPE_CARDS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`type-card ${diagramType === t.id ? "selected" : ""}`}
                onClick={() => setDiagramType(t.id)}
              >
                <span className="type-glyph">{t.glyph}</span>
                <span className="type-label">{t.label}</span>
                <span className="type-detail">{t.detail}</span>
              </button>
            ))}
          </div>
          <div className="type-note">
            {chosen
              ? `Both models will be told to treat this as a ${chosen.label} — the diagram keeps that notation's shapes and wording.`
              : "Pick the diagram type — recognition uses it to choose the right shapes and wording."}
          </div>
        </div>

        {busy && (
          <div style={{ marginTop: 12 }}>
            <div className="progress">
              <div />
            </div>
            <p>{progress}</p>
          </div>
        )}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        {report && (
          <div className="recon-card">
            <h3>Reconciliation</h3>
            <div>Detected as: <strong>{report.detected_type || "—"}</strong> · Requested: <strong>{report.requested_type}</strong></div>
            <div>Sources used: {(report.sources_used || []).join(", ") || "none"}</div>
            {sourcesReport && (
              <div>
                Gemini: {sourcesReport.gemini?.node_count ?? "–"} nodes / {sourcesReport.gemini?.edge_count ?? "–"} edges
                {" · "}Groq: {sourcesReport.groq?.node_count ?? "–"} nodes /{" "}
                {sourcesReport.groq?.edge_count ?? "–"} edges
              </div>
            )}
            <div>Disagreements: {report.disagreements?.length || 0}</div>
            {report.warnings?.length ? <div>Warnings: {report.warnings.join(" ")}</div> : null}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn-ghost" disabled={!file || !diagramType || busy} onClick={start}>
            Retry / start recognition
          </button>
          <button className="btn-primary" disabled={!file || !diagramType || busy} onClick={start}>
            Start recognition
          </button>
        </div>
      </div>
    </div>
  );
}
