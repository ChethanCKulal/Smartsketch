import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
} from "@xyflow/react";
import { DEFAULT_MARKER_SIZE, markerSpec } from "../connectors";
import { markerBackdrop, useUiStore } from "../../state/uiStore";

/**
 * One path per routing style. Elbow is the same orthogonal path as rounded,
 * with the corners left square; curved is a bezier between the two anchors.
 */
function routePath(routing, geometry) {
  if (routing === "straight") return getStraightPath(geometry);
  if (routing === "curved") return getBezierPath(geometry);
  return getSmoothStepPath({ ...geometry, borderRadius: routing === "elbow" ? 0 : 8 });
}

/**
 * A marker is drawn in a 0..10 box with its tip on the right edge, so the same
 * definition works at both ends via `orient="auto-start-reverse"`.
 */
function Marker({ id, spec, color, backdrop, size }) {
  const fill = spec.fill === "solid" ? color : spec.fill === "hollow" ? backdrop : "none";
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="10"
      refY="5"
      markerWidth={size}
      markerHeight={size}
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      {spec.shape === "circle" ? (
        <circle
          cx={spec.cx}
          cy={spec.cy}
          r={spec.r}
          fill={fill}
          stroke={color}
          strokeWidth="1.4"
        />
      ) : (
        <path
          d={spec.d}
          fill={fill}
          stroke={color}
          strokeWidth={spec.fill === "none" ? 1.6 : 1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </marker>
  );
}

/** Where a multiplicity sits next to its end, given the side it leaves on. */
function endLabelPoint(x, y, position) {
  if (position === "left") return { x: x - 10, y: y - 9 };
  if (position === "right") return { x: x + 10, y: y - 9 };
  if (position === "top") return { x: x + 9, y: y - 6 };
  return { x: x + 9, y: y + 16 };
}

export default function DiagramEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  label,
  data,
  interactionWidth,
}) {
  const canonical = data?.canonical || {};
  const canvasBackground = useUiStore((s) => s.canvasBackground);
  const theme = useUiStore((s) => s.theme);

  const routing = canonical.routing || "rounded";
  const [edgePath, labelX, labelY] = routePath(routing, {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const color = canonical.style?.border || style?.stroke || "#8fb4d9";
  const size = canonical.markerSize || DEFAULT_MARKER_SIZE;
  const startSpec = markerSpec(canonical.startMarker);
  const endSpec = markerSpec(canonical.endMarker);
  const hasStart = startSpec.id !== "none";
  const hasEnd = endSpec.id !== "none";
  // Hollow heads are filled with the canvas so they read as outlines.
  const backdrop = markerBackdrop(canvasBackground, theme);

  const startId = `sc-mk-${id}-start`;
  const endId = `sc-mk-${id}-end`;
  const startLabel = String(canonical.sourceMultiplicity || "").trim();
  const targetLabel = String(canonical.targetMultiplicity || "").trim();
  const text = label || canonical.label || "";

  return (
    <>
      {(hasStart || hasEnd) && (
        <defs>
          {hasStart && (
            <Marker id={startId} spec={startSpec} color={color} backdrop={backdrop} size={size} />
          )}
          {hasEnd && (
            <Marker id={endId} spec={endSpec} color={color} backdrop={backdrop} size={size} />
          )}
        </defs>
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        // A connector is only a few pixels wide; this widens the area that can
        // be clicked so the properties panel is reachable.
        interactionWidth={interactionWidth}
        style={style}
        markerStart={hasStart ? `url(#${startId})` : undefined}
        markerEnd={hasEnd ? `url(#${endId})` : undefined}
      />
      {text ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {startLabel ? (
        <EdgeLabelRenderer>
          <div
            className="edge-multiplicity"
            style={{
              transform: `translate(-50%, -50%) translate(${endLabelPoint(sourceX, sourceY, sourcePosition).x}px, ${endLabelPoint(sourceX, sourceY, sourcePosition).y}px)`,
            }}
          >
            {startLabel}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {targetLabel ? (
        <EdgeLabelRenderer>
          <div
            className="edge-multiplicity"
            style={{
              transform: `translate(-50%, -50%) translate(${endLabelPoint(targetX, targetY, targetPosition).x}px, ${endLabelPoint(targetX, targetY, targetPosition).y}px)`,
            }}
          >
            {targetLabel}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
