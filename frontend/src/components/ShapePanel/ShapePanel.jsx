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

  // Only the active family's shapes are offered: an ER diagram never shows
  // flowchart shapes and vice versa.
  const allowed = FAMILY_NODE_TYPES[diagramType];
  const groups = SHAPE_LIBRARY.filter((g) => !g.family || g.family === diagramType);

  return (
    <aside className="left-panel">
      <div className="panel-title">
        Shape library {diagramType !== "unknown" ? `· ${FAMILY_TITLES[diagramType] || diagramType}` : ""}
      </div>
      {groups.map((group) => {
        const items = allowed ? group.items.filter((i) => allowed.includes(i.type)) : group.items;
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
