import { useEffect, useRef, useState } from "react";
import { DIAGRAM_TYPES } from "../../schema/canonical";
import { recognizeDiagram } from "../../services/api";

const TYPES = ["image/png", "image/jpeg", "image/jpg"];
const MAX = 8 * 1024 * 1024;

export default function UploadModal({ open, onClose, onRecognized }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState(0);
  const [diagramType, setDiagramType] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
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
    setBusy(true);
    setError("");
    setProgress("Sending image to Gemini and Hugging Face…");
    try {
      const payload = await transformedFile();
      const result = await recognizeDiagram({
        file: payload,
        diagramType,
        autoDetect: diagramType === "auto",
      });
      setReport(result.reconciliation);
      setProgress("Recognition complete.");
      onRecognized(result);
    } catch (err) {
      setError(err.message || "Recognition failed.");
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

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
        <label>
          Diagram type
          <select value={diagramType} onChange={(e) => setDiagramType(e.target.value)} className="toolbar-select" style={{ width: "100%", marginTop: 6 }}>
            <option value="auto">Automatic detection</option>
            {DIAGRAM_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
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
            <div>Sources used: {(report.sources_used || []).join(", ") || "none"}</div>
            <div>Disagreements: {report.disagreements?.length || 0}</div>
            {report.warnings?.length ? <div>Warnings: {report.warnings.join(" ")}</div> : null}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn-ghost" disabled={!file || busy} onClick={start}>
            Retry / start recognition
          </button>
          <button className="btn-primary" disabled={!file || busy} onClick={start}>
            Start recognition
          </button>
        </div>
      </div>
    </div>
  );
}
