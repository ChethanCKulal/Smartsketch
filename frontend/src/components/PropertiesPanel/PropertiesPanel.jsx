import { DIAGRAM_TYPES, NODE_TYPES } from "../../schema/canonical";
import { TYPE_LABELS } from "../../canvas/shapeCatalog";
import { ACTIONS } from "../../canvas/commands/types";
import { useDiagramStore } from "../../state/diagramStore";

export default function PropertiesPanel() {
  const diagram = useDiagramStore((s) => s.diagram);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const selectedEdgeIds = useDiagramStore((s) => s.selectedEdgeIds);
  const dispatch = useDiagramStore((s) => s.dispatch);

  const node = diagram.nodes.find((n) => n.id === selectedIds[0]);
  const edge = diagram.edges.find((e) => e.id === selectedEdgeIds[0]);

  if (!node && !edge) {
    return (
      <div className="empty-props">
        Select a shape or connector to edit its properties. Changes apply immediately.
      </div>
    );
  }

  if (edge && !node) {
    return (
      <form className="prop-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Label
          <input
            value={edge.label}
            onChange={(e) =>
              dispatch({ action: ACTIONS.UPDATE_EDGE, payload: { id: edge.id, patch: { label: e.target.value } } })
            }
          />
        </label>
        <label>
          Arrow type
          <select
            value={edge.arrow}
            onChange={(e) =>
              dispatch({ action: ACTIONS.UPDATE_EDGE, payload: { id: edge.id, patch: { arrow: e.target.value } } })
            }
          >
            <option value="forward">Forward</option>
            <option value="backward">Backward</option>
            <option value="both">Both</option>
            <option value="none">None</option>
          </select>
        </label>
        <label>
          Line style
          <select
            value={edge.lineStyle}
            onChange={(e) =>
              dispatch({ action: ACTIONS.UPDATE_EDGE, payload: { id: edge.id, patch: { lineStyle: e.target.value } } })
            }
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
        <label>
          Color
          <input
            type="color"
            value={toHex(edge.style?.border)}
            onChange={(e) =>
              dispatch({
                action: ACTIONS.UPDATE_EDGE,
                payload: { id: edge.id, patch: { style: { ...edge.style, border: e.target.value } } },
              })
            }
          />
        </label>
      </form>
    );
  }

  const patch = (partial) =>
    dispatch({ action: ACTIONS.UPDATE_NODE, payload: { id: node.id, patch: partial } });

  return (
    <form className="prop-form" onSubmit={(e) => e.preventDefault()}>
      <label>
        Text
        <input value={node.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <label>
        Shape type
        <select value={node.type} onChange={(e) => patch({ type: e.target.value })}>
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] || t}
            </option>
          ))}
        </select>
      </label>
      <div className="prop-row">
        <label>
          Width
          <input
            type="number"
            value={Math.round(node.size.width)}
            onChange={(e) => patch({ size: { ...node.size, width: Number(e.target.value) } })}
          />
        </label>
        <label>
          Height
          <input
            type="number"
            value={Math.round(node.size.height)}
            onChange={(e) => patch({ size: { ...node.size, height: Number(e.target.value) } })}
          />
        </label>
      </div>
      <div className="prop-row">
        <label>
          X
          <input
            type="number"
            value={Math.round(node.position.x)}
            onChange={(e) => patch({ position: { ...node.position, x: Number(e.target.value) } })}
          />
        </label>
        <label>
          Y
          <input
            type="number"
            value={Math.round(node.position.y)}
            onChange={(e) => patch({ position: { ...node.position, y: Number(e.target.value) } })}
          />
        </label>
      </div>
      <div className="prop-row">
        <label>
          Fill
          <input type="color" value={toHex(node.style.fill)} onChange={(e) => patch({ style: { fill: e.target.value } })} />
        </label>
        <label>
          Border
          <input type="color" value={toHex(node.style.border)} onChange={(e) => patch({ style: { border: e.target.value } })} />
        </label>
      </div>
      <div className="prop-row">
        <label>
          Color
          <input type="color" value={toHex(node.style.color)} onChange={(e) => patch({ style: { color: e.target.value } })} />
        </label>
        <label>
          Opacity
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={node.style.opacity}
            onChange={(e) => patch({ style: { opacity: Number(e.target.value) } })}
          />
        </label>
      </div>
      <label>
        Font
        <select value={node.style.font} onChange={(e) => patch({ style: { font: e.target.value } })}>
          <option>Segoe UI</option>
          <option>Arial</option>
          <option>Georgia</option>
          <option>Consolas</option>
          <option>Times New Roman</option>
        </select>
      </label>
      <div className="prop-row">
        <label>
          Font size
          <input
            type="number"
            value={node.style.fontSize}
            onChange={(e) => patch({ style: { fontSize: Number(e.target.value) } })}
          />
        </label>
        <label>
          Font style
          <select value={node.style.fontStyle} onChange={(e) => patch({ style: { fontStyle: e.target.value } })}>
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </label>
      </div>
      <label>
        Text alignment
        <select value={node.style.textAlign} onChange={(e) => patch({ style: { textAlign: e.target.value } })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label>
        Diagram type
        <select
          value={diagram.diagram_type}
          onChange={(e) => dispatch({ action: ACTIONS.SET_DIAGRAM_TYPE, payload: { diagram_type: e.target.value } })}
        >
          {DIAGRAM_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

function toHex(color) {
  if (!color) return "#1e2a3a";
  if (color.startsWith("#") && color.length === 7) return color;
  return "#1e2a3a";
}
