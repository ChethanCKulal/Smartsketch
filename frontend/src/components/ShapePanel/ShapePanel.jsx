import { SHAPE_LIBRARY } from "../../canvas/shapeCatalog";

export default function ShapePanel() {
  const onDragStart = (event, item) => {
    event.dataTransfer.setData("application/sketchcanvas", JSON.stringify(item));
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="left-panel">
      <div className="panel-title">Shape library</div>
      {SHAPE_LIBRARY.map((group) => (
        <div className="shape-group" key={group.category}>
          <h4>{group.category}</h4>
          <div className="shape-grid">
            {group.items.map((item) => (
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
      ))}
    </aside>
  );
}
