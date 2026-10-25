import { useEffect, useMemo, useState } from "react";
import { DIAGRAM_TYPES } from "../../schema/canonical";
import { activePage, pageHasContent } from "../../schema/document";
import { convertMxCells } from "../../import/drawioXml";
import { useDiagramStore } from "../../state/diagramStore";

/**
 * Shown after pasting supported diagram XML. It states what will be imported
 * before anything replaces the current page, and asks where multipage XML goes.
 */
export default function ImportDialog({ request, onCancel, onImport }) {
  const document = useDiagramStore((s) => s.document);
  const diagram = useDiagramStore((s) => s.diagram);
  const [diagramType, setDiagramType] = useState(diagram?.diagram_type || "flowchart");
  const [mode, setMode] = useState("single");
  const [pageIndex, setPageIndex] = useState(0);

  const ready = request?.status === "ready";
  const pages = request?.pages || [];

  useEffect(() => {
    if (!ready) return;
    setDiagramType(diagram?.diagram_type || "flowchart");
    setMode(pages.length > 1 ? "all" : "single");
    setPageIndex(0);
  }, [ready, request, pages.length, diagram?.diagram_type]);

  // Convert with the selected type so the preview matches the import exactly.
  const previews = useMemo(
    () => (ready ? pages.map((page) => convertMxCells(page.cells, { diagramType })) : []),
    [ready, pages, diagramType]
  );

  if (!request) return null;

  const current = activePage(document);
  const warnings = [
    ...(request.warnings || []),
    ...previews.flatMap((preview) => preview.warnings),
  ];
  const uniqueWarnings = [...new Set(warnings)];
  const totals = previews.reduce(
    (sum, preview) => ({
      shapes: sum.shapes + preview.stats.shapes,
      connectors: sum.connectors + preview.stats.connectors,
    }),
    { shapes: 0, connectors: 0 }
  );
  const single = previews[pageIndex];
  const importable =
    mode === "all"
      ? previews.some((preview) => preview.stats.shapes + preview.stats.connectors > 0)
      : Boolean(single && single.stats.shapes + single.stats.connectors > 0);
  const replacesContent = mode === "single" && pageHasContent(current);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="modal modal-medium" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <h2 id="import-title">
          {request.status === "error" ? "Import failed" : "Import diagram XML"}
        </h2>

        {request.status === "parsing" ? (
          <div className="modal-body">
            <p>Reading the pasted XML…</p>
            <div className="progress">
              <div />
            </div>
          </div>
        ) : null}

        {request.status === "error" ? (
          <div className="modal-body">
            <p>{request.message}</p>
            {request.details?.length ? (
              <pre className="dialog-details">{request.details.slice(0, 4).join("\n")}</pre>
            ) : null}
            <p className="props-hint">Your current diagram was not changed.</p>
          </div>
        ) : null}

        {ready ? (
          <form className="modal-body import-form" onSubmit={(event) => event.preventDefault()}>
            <p>
              Recognised <strong>draw.io</strong> XML: {pages.length} page
              {pages.length === 1 ? "" : "s"}, {totals.shapes} shape
              {totals.shapes === 1 ? "" : "s"} and {totals.connectors} connector
              {totals.connectors === 1 ? "" : "s"}.
            </p>

            <label className="dialog-field">
              Diagram type
              <select value={diagramType} onChange={(event) => setDiagramType(event.target.value)}>
                {DIAGRAM_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>

            {pages.length > 1 ? (
              <fieldset className="dialog-choice">
                <legend>Where should the pages go?</legend>
                <label>
                  <input
                    type="radio"
                    name="import-mode"
                    value="all"
                    checked={mode === "all"}
                    onChange={() => setMode("all")}
                  />
                  Import all {pages.length} pages as new pages
                </label>
                <label>
                  <input
                    type="radio"
                    name="import-mode"
                    value="single"
                    checked={mode === "single"}
                    onChange={() => setMode("single")}
                  />
                  Import one page into the current page
                </label>
                {mode === "single" ? (
                  <select
                    aria-label="Page to import"
                    value={pageIndex}
                    onChange={(event) => setPageIndex(Number(event.target.value))}
                  >
                    {pages.map((page, index) => (
                      <option key={`${page.name}-${index}`} value={index}>
                        {page.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </fieldset>
            ) : null}

            {mode === "single" ? (
              <p className={replacesContent ? "dialog-warning" : "props-hint"}>
                {replacesContent
                  ? `This replaces the content of “${current?.name}”. You can undo it with Ctrl+Z.`
                  : `Imports into “${current?.name}”.`}
              </p>
            ) : (
              <p className="props-hint">
                The imported pages are added after the existing ones and can be deleted from
                the page menu.
              </p>
            )}

            {uniqueWarnings.length ? (
              <div className="import-warnings">
                <strong>Warnings</strong>
                <ul>
                  {uniqueWarnings.slice(0, 6).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                {uniqueWarnings.length > 6 ? (
                  <span>…and {uniqueWarnings.length - 6} more.</span>
                ) : null}
              </div>
            ) : null}

            {!importable ? (
              <p className="dialog-error" role="alert">
                No shapes or connectors could be recognised in this XML.
              </p>
            ) : null}
          </form>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {request.status === "error" ? "Close" : "Cancel"}
          </button>
          {ready ? (
            <button
              type="button"
              className="btn-primary"
              disabled={!importable}
              onClick={() => onImport({ mode, pageIndex, diagramType })}
            >
              Import
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
