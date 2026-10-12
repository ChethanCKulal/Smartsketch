import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";

export default function DiagramEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  markerStart,
  label,
  data,
}) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const canonical = data?.canonical;
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} markerStart={markerStart} />
      {(label || canonical?.label) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: canonical?.style?.fill || "#1b2533",
              border: `1px solid ${canonical?.style?.border || style?.stroke || "#2a3648"}`,
              color: canonical?.style?.color || "#e7eef7",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: canonical?.style?.fontSize || 11,
              fontFamily: canonical?.style?.font || "inherit",
              fontWeight: canonical?.style?.fontWeight || "500",
              pointerEvents: "all",
            }}
          >
            {label || canonical.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
