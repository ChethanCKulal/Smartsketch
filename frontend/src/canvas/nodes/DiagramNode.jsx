import { Handle, NodeResizer } from "@xyflow/react";
import { SIDES, SIDE_POSITION, anchorId, slotPercent } from "../handles";
import { useDiagramStore } from "../../state/diagramStore";

const CLIP = {
  hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  triangle: "polygon(50% 0%, 100% 100%, 0% 100%)",
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  parallelogram: "polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)",
  document: "polygon(0 0, 100% 0, 100% 82%, 75% 92%, 50% 82%, 25% 92%, 0 82%)",
};

function shellStyle(node) {
  const s = node.style || {};
  const type = node.type;
  const base = {
    background: s.fill,
    border: `${s.borderWidth || 1.5}px solid ${s.border}`,
    color: s.color,
    fontFamily: s.font,
    fontSize: s.fontSize,
    fontStyle: s.fontStyle,
    fontWeight: s.fontWeight,
    textAlign: s.textAlign,
    width: "100%",
    height: "100%",
    opacity: s.opacity,
  };
  if (type === "ellipse" || type === "usecase" || type === "attribute" || type === "terminator") {
    return { ...base, borderRadius: "50%" };
  }
  if (type === "roundedRectangle" || type === "process" || type === "dfdProcess") {
    return { ...base, borderRadius: 18 };
  }
  if (type === "package") return { ...base, borderRadius: "8px 8px 4px 4px" };
  if (CLIP[type]) return { ...base, clipPath: CLIP[type], border: 0, boxShadow: `inset 0 0 0 ${s.borderWidth || 2}px ${s.border}` };
  if (type === "io") return { ...base, clipPath: CLIP.parallelogram, border: 0, boxShadow: `inset 0 0 0 2px ${s.border}` };
  if (type === "relationship") return { ...base, clipPath: CLIP.diamond, border: 0, boxShadow: `inset 0 0 0 2px ${s.border}` };
  if (type === "database") {
    return { ...base, borderRadius: "50% / 18%", borderTop: `3px solid ${s.border}` };
  }
  if (type === "predefinedProcess") {
    return { ...base, boxShadow: `inset 10px 0 0 ${s.border}, inset -10px 0 0 ${s.border}` };
  }
  if (type === "weakEntity") {
    return { ...base, outline: `2px solid ${s.border}`, outlineOffset: 3 };
  }
  if (type === "entity") {
    return { ...base, borderRadius: 2, padding: 0 };
  }
  if (type === "dataStore") {
    return { ...base, borderLeft: `4px solid ${s.border}`, borderRight: 0, borderRadius: 0 };
  }
  if (type === "externalEntity" || type === "class" || type === "interface" || type === "entity") {
    return { ...base, borderRadius: 2 };
  }
  if (type === "text") {
    return { ...base, background: "transparent", border: "0" };
  }
  if (type === "group") {
    return { ...base, borderStyle: "dashed" };
  }
  return { ...base, borderRadius: 4 };
}

/**
 * Renders the node's connection anchors: at least one per side, plus extra
 * slots where several arrows share a side. Anchors are planned per diagram so
 * each arrow gets its own point.
 */
function NodeAnchors({ counts }) {
  const handles = [];
  for (const side of SIDES) {
    const count = Math.max(1, counts?.[side] || 0);
    for (let slot = 0; slot < count; slot += 1) {
      const percent = `${slotPercent(slot, count)}%`;
      const vertical = side === "top" || side === "bottom";
      handles.push(
        <Handle
          key={anchorId(side, slot)}
          id={anchorId(side, slot)}
          type="source"
          position={SIDE_POSITION[side]}
          style={vertical ? { left: percent } : { top: percent }}
        />
      );
    }
  }
  return handles;
}

export default function DiagramNode({ data, selected, id }) {
  const node = data.canonical;
  const style = shellStyle(node);
  const isClass = node.type === "class" || node.type === "interface";
  const isErEntity = node.type === "entity" || node.type === "weakEntity";

  const startEdit = (e) => {
    e.stopPropagation();
    useDiagramStore.getState().setEditingNodeId(id);
  };

  return (
    <div
      className={`diagram-node ${node.locked ? "locked" : ""}`}
      style={style}
      onDoubleClick={startEdit}
      title="Double-click to edit text"
    >
      <NodeResizer
        isVisible={selected && !node.locked}
        minWidth={40}
        minHeight={28}
        color="#4c8dff"
      />
      <NodeAnchors counts={data.anchors} />
      {node.type === "actor" ? (
        <div style={{ textAlign: "center", lineHeight: 1.1 }}>
          <div style={{ fontSize: 22 }}>☺</div>
          <div className="label">{node.label}</div>
        </div>
      ) : isClass ? (
        // UML classes always keep their three compartments: name, attributes, methods.
        <div className="class-body">
          <div className="class-title">{node.type === "interface" ? `\u00ABinterface\u00BB ${node.label}` : node.label}</div>
          <div className="class-section class-attrs">
            {(node.attributes || []).length > 0
              ? node.attributes.map((a, i) => <div key={i} className="class-member">{a}</div>)
              : <div className="class-member class-empty">&nbsp;</div>}
          </div>
          <div className="class-section class-methods">
            {(node.methods || []).length > 0
              ? node.methods.map((m, i) => <div key={i} className="class-member">{m}</div>)
              : <div className="class-member class-empty">&nbsp;</div>}
          </div>
        </div>
      ) : isErEntity ? (
        // ER entities are a single plain rectangle holding only the name.
        <div className="er-entity-name">{node.label}</div>
      ) : (
        <div className="label">
          {node.label}
          {node.attributes?.length ? <div className="node-attrs">{node.attributes.join(", ")}</div> : null}
        </div>
      )}
    </div>
  );
}
