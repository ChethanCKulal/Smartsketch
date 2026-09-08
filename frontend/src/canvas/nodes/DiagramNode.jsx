import { Handle, NodeResizer, Position } from "@xyflow/react";

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

export default function DiagramNode({ data, selected }) {
  const node = data.canonical;
  const style = shellStyle(node);
  const isClass = node.type === "class" || node.type === "interface";

  return (
    <div className={`diagram-node ${node.locked ? "locked" : ""}`} style={style}>
      <NodeResizer
        isVisible={selected && !node.locked}
        minWidth={40}
        minHeight={28}
        color="#4c8dff"
      />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Right} id="r" />
      {node.type === "actor" ? (
        <div style={{ textAlign: "center", lineHeight: 1.1 }}>
          <div style={{ fontSize: 22 }}>☺</div>
          <div className="label">{node.label}</div>
        </div>
      ) : isClass ? (
        <div className="class-body">
          <div className="title">{node.type === "interface" ? `«interface» ${node.label}` : node.label}</div>
          <div className="section">{(node.attributes || []).join("\n") || " "}</div>
          <div className="section" style={{ borderTop: "1px solid currentColor" }}>
            {(node.methods || []).join("\n") || " "}
          </div>
        </div>
      ) : (
        <div className="label">
          {node.label}
          {node.attributes?.length ? <div className="node-attrs">{node.attributes.join(", ")}</div> : null}
        </div>
      )}
    </div>
  );
}
