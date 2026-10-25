import { useEffect, useRef, useState } from "react";
import { pageHasContent } from "../../schema/document";
import { useDiagramStore } from "../../state/diagramStore";
import ConfirmDialog from "../Dialogs/ConfirmDialog";

/**
 * The page strip under the canvas: one tab per page, an add button and the
 * actions for the active page. Double-click a tab to rename it.
 */
export default function PageBar({ dirty = false, onNotice }) {
  const document = useDiagramStore((s) => s.document);
  const activePageId = useDiagramStore((s) => s.activePageId);
  const setActivePage = useDiagramStore((s) => s.setActivePage);
  const addPage = useDiagramStore((s) => s.addPage);
  const duplicatePage = useDiagramStore((s) => s.duplicatePage);
  const renamePage = useDiagramStore((s) => s.renamePage);
  const renameDocument = useDiagramStore((s) => s.renameDocument);
  const deletePage = useDiagramStore((s) => s.deletePage);
  const movePage = useDiagramStore((s) => s.movePage);

  const [renaming, setRenaming] = useState(null); // { id, value }
  const [docRenaming, setDocRenaming] = useState(null); // draft name, or null
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const renameRef = useRef(null);
  const barRef = useRef(null);

  const pages = document.pages;
  const activeIndex = pages.findIndex((page) => page.id === activePageId);
  const active = pages[activeIndex] || pages[0];
  const single = pages.length <= 1;

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  const commitDocRename = () => {
    if (docRenaming !== null) renameDocument(docRenaming);
    setDocRenaming(null);
  };

  // Close the actions menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event) => {
      if (barRef.current && !barRef.current.contains(event.target)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const startRename = (page) => {
    setMenuOpen(false);
    setRenaming({ id: page.id, value: page.name });
  };

  const commitRename = () => {
    if (!renaming) return;
    renamePage(renaming.id, renaming.value);
    setRenaming(null);
  };

  const requestDelete = (page) => {
    setMenuOpen(false);
    if (pages.length <= 1) {
      onNotice?.("A document needs at least one page.", "error");
      return;
    }
    if (pageHasContent(page)) {
      setPendingDelete(page);
      return;
    }
    deletePage(page.id);
  };

  const confirmDelete = () => {
    if (pendingDelete) deletePage(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <nav className="page-bar" aria-label="Diagram pages" ref={barRef}>
      {docRenaming !== null ? (
        <div className="page-doc">
          <input
            className="page-doc-input"
            autoFocus
            aria-label="Document name"
            value={docRenaming}
            onChange={(event) => setDocRenaming(event.target.value)}
            onBlur={commitDocRename}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") commitDocRename();
              if (event.key === "Escape") setDocRenaming(null);
            }}
          />
        </div>
      ) : (
        <div
          className="page-doc"
          title={`${document.name} — double-click to rename. Saved as a .json file with this name.`}
          onDoubleClick={() => setDocRenaming(document.name)}
        >
          <span className="page-doc-name">{document.name}</span>
          {dirty ? (
            <span className="page-dirty" title="Unsaved changes" aria-label="Unsaved changes">
              ●
            </span>
          ) : null}
        </div>
      )}

      <div className="page-tabs" role="tablist" aria-label="Pages">
        {pages.map((page, index) => {
          const isActive = page.id === active?.id;
          if (renaming?.id === page.id) {
            return (
              <div className="page-tab renaming" key={page.id}>
                <input
                  ref={renameRef}
                  value={renaming.value}
                  aria-label="Page name"
                  onChange={(event) => setRenaming({ id: page.id, value: event.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") commitRename();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                />
              </div>
            );
          }
          return (
            <button
              key={page.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`page-tab ${isActive ? "active" : ""}`}
              title={`${page.name} — ${page.diagram.diagram_type}, ${page.diagram.nodes.length} nodes. Double-click to rename.`}
              onClick={() => setActivePage(page.id)}
              onDoubleClick={() => startRename(page)}
              onAuxClick={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              data-index={index}
            >
              <span className="page-tab-name">{page.name}</span>
              <span className="page-tab-count">{page.diagram.nodes.length}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="page-btn page-add"
        title="Add a page"
        aria-label="Add a page"
        onClick={() => addPage()}
      >
        +
      </button>

      <div className="page-menu export-menu">
        <button
          type="button"
          className={`page-btn ${menuOpen ? "active" : ""}`}
          title={`Actions for ${active?.name || "this page"}`}
          aria-label="Page actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋮
        </button>
        {menuOpen && active ? (
          <div className="export-pop page-pop" role="menu">
            <div className="pop-title">{active.name}</div>
            <button type="button" role="menuitem" onClick={() => startRename(active)}>
              Rename…
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); duplicatePage(active.id); }}>
              Duplicate
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={activeIndex <= 0}
              onClick={() => { setMenuOpen(false); movePage(active.id, -1); }}
            >
              Move left
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={activeIndex >= pages.length - 1}
              onClick={() => { setMenuOpen(false); movePage(active.id, 1); }}
            >
              Move right
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              disabled={single}
              title={single ? "A document needs at least one page" : "Delete this page"}
              onClick={() => requestDelete(active)}
            >
              Delete page
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.name || "page"}?`}
        danger
        confirmLabel="Delete page"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        This page contains {pendingDelete?.diagram.nodes.length || 0} shape
        {(pendingDelete?.diagram.nodes.length || 0) === 1 ? "" : "s"} and{" "}
        {pendingDelete?.diagram.edges.length || 0} connector
        {(pendingDelete?.diagram.edges.length || 0) === 1 ? "" : "s"}. Deleting it cannot be
        undone. The other pages are not affected.
      </ConfirmDialog>
    </nav>
  );
}
