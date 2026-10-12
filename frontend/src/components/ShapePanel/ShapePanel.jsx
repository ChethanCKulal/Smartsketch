import { useState } from "react";
import { SHAPE_LIBRARY } from "../../canvas/shapeCatalog";
import { FAMILY_NODE_TYPES } from "../../schema/canonical";
import { useDiagramStore } from "../../state/diagramStore";

const FAMILY_TITLES = {
  flowchart: "Flowchart",
  er: "ER",
  uml: "UML",
  dfd: "DFD",
};

export default function ShapePanel() {
  const diagramType = useDiagramStore((s) => s.diagram.diagram_type);
  const [showAll, setShowAll] = useState(false);

  const groups = showAll
    ? SHAPE_LIBRARY
    : SHAPE_LIBRARY.filter((g) => !g.family || g.family === diagramType);

  return (
    <aside className="left-panel">
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Shapes</span>
        <button
          type="button"
          className="tb-btn"
          style={{ fontSize: 10, padding: "2px 6px", height: "auto" }}
          onClick={() => setShowAll((v) => !v)}
          title="Toggle between active family shapes and all diagram shapes"
        >
          {showAll ? "Filter" : "Show all"}
        </button>
      </div>
      {groups.map((group) => {
        const items = group.items;
        if (!items.length) return null;
        return (
          <div className="shape-group" key={group.category}>
            <h4>{group.category}</h4>
            <div className="shape-grid">
              {items.map((item) => (
                <div
                  key={item.type}
                  className="shape-item"
                  draggable
                  title={`Drag ${item.label} onto the canvas`}
                  onDragStart={(e) => onDragStart(e, item)}
                >
                  <div className={`shape-preview ${item.type}`} />
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function onDragStart(event, item) {
  event.dataTransfer.setData("application/sketchcanvas", JSON.stringify(item));
  event.dataTransfer.effectAllowed = "move";
}
