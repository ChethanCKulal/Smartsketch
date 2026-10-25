import { Handle, NodeResizer } from "@xyflow/react";
import { SIDES, SIDE_POSITION, anchorId, slotPercent } from "../handles";
import { SHAPE_ART, hasShapeArt } from "../shapeGeometry";
import { useDiagramStore } from "../../state/diagramStore";

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
  // Drawn shapes own their outline (see ShapeArt), so the box itself stays
  // transparent and nothing the node contains is clipped.
  if (hasShapeArt(type)) return { ...base, background: "transparent", border: 0 };
  if (type === "ellipse" || type === "usecase" || type === "attribute" || type === "terminator") {
    return { ...base, borderRadius: "50%" };
  }
  // ER notation: a multivalued attribute is a double oval, a derived attribute
  // is a dashed oval.
  if (type === "multivaluedAttribute") {
    return {
      ...base,
      borderRadius: "50%",
      boxShadow: `inset 0 0 0 3px ${s.fill}, inset 0 0 0 4.5px ${s.border}`,
    };
  }
  if (type === "derivedAttribute") {
    return { ...base, borderRadius: "50%", borderStyle: "dashed" };
  }
  if (type === "roundedRectangle" || type === "process" || type === "dfdProcess") {
    return { ...base, borderRadius: 18 };
  }
  if (type === "predefinedProcess") {
    return { ...base, boxShadow: `inset 10px 0 0 ${s.border}, inset -10px 0 0 ${s.border}` };
  }
  if (type === "weakEntity") {
    return { ...base, outline: `${s.borderWidth || 2}px solid ${s.border}`, outlineOffset: 3 };
  }
  if (type === "entity") {
    return { ...base, borderRadius: 2, padding: 0 };
  }
  if (type === "dataStore") {
    return { ...base, borderLeft: `4px solid ${s.border}`, borderRight: 0, borderRadius: 0 };
  }
  if (type === "externalEntity" || type === "class" || type === "interface") {
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
 * Polygons and curved outlines are painted here, in the node's own fill, border
 * and border width. The layer sits behind the label and never takes a pointer
 * event, so a shape can be selected, dragged and edited like any other.
 */
function ShapeArt({ node }) {
  const art = SHAPE_ART[node.type];
  if (!art) return null;
  const s = node.style || {};
  const bodies = art.bodies || [art.body];
  const strokeWidth = s.borderWidth ?? 1.5;
  return (
    <svg
      className="node-shape"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* The box is stretched to the node's size, so the stroke is told not to
          stretch with it — otherwise the two axes draw different widths. */}
      {bodies.filter(Boolean).map((d, i) => (
        <path
          key={`body-${i}`}
          d={d}
          fill={s.fill}
          stroke={s.border}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {(art.detail || []).map((d, i) => (
        <path
          key={`detail-${i}`}
          d={d}
          fill="none"
          stroke={s.border}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
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

  const startEdit = (e, compartment) => {
    e.stopPropagation();
    useDiagramStore.getState().setEditingNode(id, compartment);
  };

  return (
    <div
      className={`diagram-node ${node.locked ? "locked" : ""}`}
      style={style}
      onDoubleClick={(e) => startEdit(e, isClass ? "title" : null)}
      title={isClass ? "Double-click a compartment to edit it" : "Double-click to edit text"}
    >
      <ShapeArt node={node} />
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
        // UML classes always keep their three compartments: name, attributes,
        // methods. Each is edited on its own, never as one flattened label.
        <div className="class-body">
          <div
            className="class-title"
            data-compartment="title"
            onDoubleClick={(e) => startEdit(e, "title")}
          >
            {node.type === "interface" ? `\u00ABinterface\u00BB ${node.label}` : node.label}
          </div>
          <div
            className="class-section class-attrs"
            data-compartment="attributes"
            onDoubleClick={(e) => startEdit(e, "attributes")}
            title="Double-click to edit attributes"
          >
            {(node.attributes || []).length > 0
              ? node.attributes.map((a, i) => (
                  <div key={i} className="class-member">
                    {a}
                  </div>
                ))
              : <div className="class-member class-empty">&nbsp;</div>}
          </div>
          <div
            className="class-section class-methods"
            data-compartment="methods"
            onDoubleClick={(e) => startEdit(e, "methods")}
            title="Double-click to edit methods"
          >
            {(node.methods || []).length > 0
              ? node.methods.map((m, i) => (
                  <div key={i} className="class-member">
                    {m}
                  </div>
                ))
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
