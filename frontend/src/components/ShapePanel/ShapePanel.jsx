import { useMemo, useState } from "react";
import { SHAPE_LIBRARY } from "../../canvas/shapeCatalog";
import { FAMILY_NODE_TYPES, GENERAL_NODE_TYPES } from "../../schema/canonical";
import ShapePreview from "../../canvas/ShapePreview";
import { useDiagramStore } from "../../state/diagramStore";

const FAMILY_TITLES = {
  flowchart: "Flowchart",
  er: "ER",
  uml: "UML",
  dfd: "DFD",
};

export default function ShapePanel() {
  const diagramType = useDiagramStore((s) => s.diagram.diagram_type);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState({});

  // Only the active family's shapes are offered, plus the general shapes every
  // family shares: an ER diagram never shows flowchart shapes and vice versa.
  const allowed = FAMILY_NODE_TYPES[diagramType];
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const available = SHAPE_LIBRARY.filter((g) => !g.family || g.family === diagramType);
    return available
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const permitted =
            GENERAL_NODE_TYPES.includes(item.type) || !allowed || allowed.includes(item.type);
          if (!permitted) return false;
          if (!needle) return true;
          return (
            item.label.toLowerCase().includes(needle) || item.type.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((group) => group.items.length);
  }, [allowed, diagramType, needle]);

  const toggle = (category) =>
    setCollapsed((current) => ({ ...current, [category]: !current[category] }));

  return (
    <aside className="left-panel">
      <div className="panel-title">
        Shape library {diagramType !== "unknown" ? `· ${FAMILY_TITLES[diagramType] || diagramType}` : ""}
      </div>
      <div className="shape-search">
        <input
          type="search"
          value={query}
          placeholder="Search shapes"
          aria-label="Search shapes"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {groups.map((group) => {
        const isCollapsed = !needle && collapsed[group.category];
        return (
          <section className="shape-group" key={group.category}>
            <button
              type="button"
              className="shape-group-head"
              aria-expanded={!isCollapsed}
              title={isCollapsed ? `Show ${group.category} shapes` : `Hide ${group.category} shapes`}
              onClick={() => toggle(group.category)}
            >
              <span className={`shape-chevron ${isCollapsed ? "collapsed" : ""}`} aria-hidden="true">
                ▾
              </span>
              <span>{group.category}</span>
              <span className="shape-count">{group.items.length}</span>
            </button>
            {!isCollapsed && (
              <div className="shape-grid">
                {group.items.map((item) => (
                  <div
                    key={item.type}
                    className="shape-item"
                    draggable
                    title={`${item.label} · drag onto the canvas`}
                    onDragStart={(e) => onDragStart(e, item)}
                  >
                    <div className="shape-preview-box">
                      <ShapePreview type={item.type} />
                    </div>
                    {item.label}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {!groups.length && (
        <div className="shape-empty">No shapes match “{query.trim()}”.</div>
      )}
    </aside>
  );
}

function onDragStart(event, item) {
  event.dataTransfer.setData("application/sketchcanvas", JSON.stringify(item));
  event.dataTransfer.effectAllowed = "move";
}
