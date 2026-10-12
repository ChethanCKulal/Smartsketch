import { DIAGRAM_TYPES, FAMILY_NODE_TYPES, NODE_TYPES } from "../../schema/canonical";
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
          Label / Words
          <input
            value={edge.label}
            placeholder="Type words on line..."
            onChange={(e) =>
              dispatch({ action: ACTIONS.UPDATE_EDGE, payload: { id: edge.id, patch: { label: e.target.value } } })
            }
          />
        </label>
        <div className="prop-row">
          <label>
            Arrow type
            <select
              value={edge.arrow}
              onChange={(e) =>
                dispatch({ action: ACTIONS.UPDATE_EDGE, payload: { id: edge.id, patch: { arrow: e.target.value } } })
              }
            >
              <option value="forward">Forward Arrow →</option>
              <option value="backward">Backward Arrow ←</option>
              <option value="both">Both Arrows ↔</option>
              <option value="none">Plain Line —</option>
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
              <option value="solid">Solid ───</option>
              <option value="dashed">Dashed ╌╌╌</option>
              <option value="dotted">Dotted ┄┄┄</option>
            </select>
          </label>
        </div>
        <div className="prop-row">
          <label>
            Line Color
            <input
              type="color"
              value={toHex(edge.style?.border || "#7aa2c9")}
              onChange={(e) =>
                dispatch({
                  action: ACTIONS.UPDATE_EDGE,
                  payload: { id: edge.id, patch: { style: { ...edge.style, border: e.target.value } } },
                })
              }
            />
          </label>
          <label>
            Line Width
            <input
              type="number"
              min="1"
              max="12"
              step="0.5"
              value={edge.style?.borderWidth ?? 1.6}
              onChange={(e) =>
                dispatch({
                  action: ACTIONS.UPDATE_EDGE,
                  payload: { id: edge.id, patch: { style: { ...edge.style, borderWidth: Number(e.target.value) } } },
                })
              }
            />
          </label>
        </div>
        <div className="prop-row">
          <label>
            Words Text Color
            <input
              type="color"
              value={toHex(edge.style?.color || "#e8eef6")}
              onChange={(e) =>
                dispatch({
                  action: ACTIONS.UPDATE_EDGE,
                  payload: { id: edge.id, patch: { style: { ...edge.style, color: e.target.value } } },
                })
              }
            />
          </label>
          <label>
            Words Background
            <input
              type="color"
              value={toHex(edge.style?.fill || "#1b2533")}
              onChange={(e) =>
                dispatch({
                  action: ACTIONS.UPDATE_EDGE,
                  payload: { id: edge.id, patch: { style: { ...edge.style, fill: e.target.value } } },
                })
              }
            />
          </label>
        </div>
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Quick Line Colors:</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {["#4c8dff", "#10b981", "#ef4444", "#f59e0b", "#8b5cf6", "#06b6d4", "#ffffff", "#e8eef6", "#64748b", "#0f172a"].map((c) => (
              <button
                key={c}
                type="button"
                style={{ width: 18, height: 18, borderRadius: 3, background: c, border: "1px solid var(--border)", cursor: "pointer" }}
                onClick={() =>
                  dispatch({
                    action: ACTIONS.UPDATE_EDGE,
                    payload: { id: edge.id, patch: { style: { ...edge.style, border: c } } },
                  })
                }
              />
            ))}
          </div>
        </div>
      </form>
    );
  }

  const patch = (partial) =>
    dispatch({ action: ACTIONS.UPDATE_NODE, payload: { id: node.id, patch: partial } });

  const isClass = node.type === "class" || node.type === "interface";

  return (
    <form className="prop-form" onSubmit={(e) => e.preventDefault()}>
      {(node.confidence != null || node.sources?.length) && (
        <div className="props-badge">
          {node.confidence != null && (
            <span>
              Recognition confidence: <strong>{Math.round(node.confidence * 100)}%</strong>
            </span>
          )}
          {node.sources?.length ? (
            <span>
              Sources: <strong>{node.sources.join(", ")}</strong>
            </span>
          ) : null}
        </div>
      )}
      <label>
        Text
        <input value={node.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <label>
        Shape type
        <select value={node.type} onChange={(e) => patch({ type: e.target.value })}>
          {(FAMILY_NODE_TYPES[diagram.diagram_type] || NODE_TYPES).map((t) => (
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
          Background Fill
          <input type="color" value={toHex(node.style.fill)} onChange={(e) => patch({ style: { fill: e.target.value } })} />
        </label>
        <label>
          Border / Line
          <input type="color" value={toHex(node.style.border)} onChange={(e) => patch({ style: { border: e.target.value } })} />
        </label>
      </div>
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Quick Fill Colors:</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["#1e2a3a", "#123a66", "#1e3a2a", "#3a1e2a", "#2e1e3a", "#fff2a8", "#ffffff", "#334155", "#0f172a", "#222222"].map((c) => (
            <button
              key={c}
              type="button"
              style={{ width: 18, height: 18, borderRadius: 3, background: c, border: "1px solid var(--border)", cursor: "pointer" }}
              onClick={() => patch({ style: { fill: c } })}
            />
          ))}
        </div>
      </div>
      <div className="prop-row">
        <label>
          Border width
          <input
            type="number"
            min="0"
            max="12"
            step="0.5"
            value={node.style.borderWidth ?? 1.5}
            onChange={(e) => patch({ style: { borderWidth: Number(e.target.value) } })}
          />
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
      <div className="prop-row">
        <label>
          Words / Text Color
          <input type="color" value={toHex(node.style.color)} onChange={(e) => patch({ style: { color: e.target.value } })} />
        </label>
        <label>
          Font size
          <input
            type="number"
            value={node.style.fontSize}
            onChange={(e) => patch({ style: { fontSize: Number(e.target.value) } })}
          />
        </label>
      </div>
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Quick Text Colors:</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["#e8eef6", "#ffffff", "#4c8dff", "#5cbc8a", "#d46565", "#d4b05c", "#6cb6ff", "#000000", "#1e293b", "#94a3b8"].map((c) => (
            <button
              key={c}
              type="button"
              style={{ width: 18, height: 18, borderRadius: 3, background: c, border: "1px solid var(--border)", cursor: "pointer" }}
              onClick={() => patch({ style: { color: c } })}
            />
          ))}
        </div>
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
          Font style
          <select value={node.style.fontStyle} onChange={(e) => patch({ style: { fontStyle: e.target.value } })}>
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </label>
        <label>
          Weight
          <select value={node.style.fontWeight || "500"} onChange={(e) => patch({ style: { fontWeight: e.target.value } })}>
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="700">Bold</option>
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
      {/* ER entities are a name-only rectangle, so members are edited as nodes. */}
      {(isClass ||
        (!["entity", "weakEntity"].includes(node.type) && (node.attributes?.length || node.methods?.length))) && (
        <label>
          Attributes (one per line)
          <textarea
            rows={isClass ? 3 : 2}
            value={(node.attributes || []).join("\n")}
            onChange={(e) => patch({ attributes: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
      )}
      {isClass && (
        <label>
          Methods (one per line)
          <textarea
            rows={3}
            value={(node.methods || []).join("\n")}
            onChange={(e) => patch({ methods: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
      )}
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
