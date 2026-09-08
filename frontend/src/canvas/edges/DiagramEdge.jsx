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
              background: "#1b2533",
              border: "1px solid #2a3648",
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 11,
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
