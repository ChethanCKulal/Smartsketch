import { useEffect, useState } from "react";
import { useDiagramStore } from "../../state/diagramStore";

/**
 * Asked only when the document has unsaved changes. Save writes the document
 * first and creates the new one only after the write succeeded; Don't Save
 * discards it; Cancel leaves everything exactly as it was.
 */
export default function NewDocumentDialog({ open, onCancel }) {
  const saveDocument = useDiagramStore((s) => s.saveDocument);
  const newDocument = useDiagramStore((s) => s.newDocument);
  const diagram = useDiagramStore((s) => s.diagram);
  const document = useDiagramStore((s) => s.document);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const createNew = () => {
    const type = diagram?.diagram_type || "flowchart";
    newDocument(type);
    onCancel();
  };

  const saveThenCreate = () => {
    setSaving(true);
    setError(null);
    const saved = saveDocument();
    setSaving(false);
    if (!saved) {
      // The store keeps the document and reports why; never discard work here.
      setError(useDiagramStore.getState().status);
      return;
    }
    createNew();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="modal modal-narrow" role="dialog" aria-modal="true" aria-labelledby="new-doc-title">
        <h2 id="new-doc-title">Start a new document?</h2>
        <div className="modal-body">
          <p>
            <strong>{document?.name || "This document"}</strong> has unsaved changes on{" "}
            {document?.pages.length || 1} page{(document?.pages.length || 1) === 1 ? "" : "s"}.
            Saving writes the current document first; cancelling keeps everything open.
          </p>
          {error ? (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-ghost danger" onClick={createNew} disabled={saving}>
            Don’t Save
          </button>
          <button type="button" className="btn-primary" onClick={saveThenCreate} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
