/**
 * Connector vocabulary: routing, end markers, presets and UML relationships.
 *
 * Everything a connector can be is described here once, as data. The canvas
 * edge renderer, the properties panel and the invariant checks all read this
 * module, so no control can offer something the renderer cannot draw.
 */

/** Routing styles the edge renderer knows how to draw. */
export const ROUTINGS = [
  { id: "straight", label: "Straight" },
  { id: "elbow", label: "Elbow (orthogonal)" },
  { id: "rounded", label: "Rounded elbow" },
  { id: "curved", label: "Curved" },
];

export const DEFAULT_ROUTING = "rounded";

/**
 * End markers. `geometry` is drawn in a 0..10 box with the tip at x = 10, so
 * one marker path serves both ends (`orient="auto-start-reverse"`).
 * `fill`: "solid" paints with the line colour, "hollow" fills with the canvas
 * background and strokes with the line colour, "none" draws only the stroke.
 */
export const MARKERS = [
  { id: "none", label: "None" },
  { id: "arrow", label: "Classic arrow", fill: "solid", d: "M0 0 L10 5 L0 10 L2.6 5 Z" },
  { id: "openArrow", label: "Open arrow", fill: "none", d: "M0 0 L10 5 L0 10" },
  { id: "triangle", label: "Filled triangle", fill: "solid", d: "M0 0 L10 5 L0 10 Z" },
  { id: "hollowTriangle", label: "Hollow triangle (inheritance)", fill: "hollow", d: "M0 0 L10 5 L0 10 Z" },
  { id: "diamond", label: "Filled diamond (composition)", fill: "solid", d: "M0 5 L5 0 L10 5 L5 10 Z" },
  { id: "hollowDiamond", label: "Hollow diamond (aggregation)", fill: "hollow", d: "M0 5 L5 0 L10 5 L5 10 Z" },
  { id: "circle", label: "Circle", fill: "solid", shape: "circle", cx: 5.5, cy: 5, r: 4.2 },
  { id: "hollowCircle", label: "Hollow circle", fill: "hollow", shape: "circle", cx: 5.5, cy: 5, r: 4.2 },
  { id: "crowfoot", label: "Crow's foot (many)", fill: "none", d: "M0 0 L10 5 M0 5 L10 5 M0 10 L10 5" },
];

export const MARKER_IDS = MARKERS.map((m) => m.id);

export const DEFAULT_START_MARKER = "none";
export const DEFAULT_END_MARKER = "arrow";
export const DEFAULT_MARKER_SIZE = 16;
export const MIN_MARKER_SIZE = 6;
export const MAX_MARKER_SIZE = 30;

export function markerSpec(id) {
  return MARKERS.find((m) => m.id === id) || MARKERS[0];
}

export function isMarker(id) {
  return MARKER_IDS.includes(id);
}

/** Line styles the edge renderer knows how to draw. */
export const LINE_STYLES = [
  { id: "solid", label: "Solid" },
  { id: "dashed", label: "Dashed" },
  { id: "dotted", label: "Dotted" },
];

export function dashArray(lineStyle) {
  if (lineStyle === "dashed") return "8 6";
  if (lineStyle === "dotted") return "2 4";
  return undefined;
}

/**
 * Connector presets cover the classic connector kinds (straight, orthogonal,
 * rounded, curved, association line, bidirectional) as one-click combinations
 * of routing and the two end markers. Every part stays independently editable.
 */
export const CONNECTOR_PRESETS = [
  { id: "straight", label: "Straight", routing: "straight", startMarker: "none", endMarker: "arrow" },
  { id: "elbow", label: "Elbow", routing: "elbow", startMarker: "none", endMarker: "arrow" },
  { id: "rounded", label: "Rounded elbow", routing: "rounded", startMarker: "none", endMarker: "arrow" },
  { id: "curved", label: "Curved", routing: "curved", startMarker: "none", endMarker: "arrow" },
  { id: "association", label: "Association line", routing: "straight", startMarker: "none", endMarker: "none" },
  { id: "bidirectional", label: "Bidirectional", routing: "straight", startMarker: "arrow", endMarker: "arrow" },
];

/** Which preset an edge currently matches, or null once it is customised. */
export function presetOf(edge) {
  const routing = edge?.routing || DEFAULT_ROUTING;
  const startMarker = edge?.startMarker || DEFAULT_START_MARKER;
  const endMarker = edge?.endMarker || DEFAULT_END_MARKER;
  const match = CONNECTOR_PRESETS.find(
    (p) => p.routing === routing && p.startMarker === startMarker && p.endMarker === endMarker
  );
  return match ? match.id : "";
}

/** Apply a preset to an edge patch. */
export function presetPatch(id) {
  const preset = CONNECTOR_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  return {
    routing: preset.routing,
    startMarker: preset.startMarker,
    endMarker: preset.endMarker,
    arrow: arrowFromMarkers(preset.startMarker, preset.endMarker),
  };
}

/** UML relationship kinds, each a marker/line preset applied to the edge. */
export const UML_RELATIONSHIPS = [
  { id: "association", label: "Association", startMarker: "none", endMarker: "none", lineStyle: "solid", routing: "straight" },
  { id: "directedAssociation", label: "Directed association", startMarker: "none", endMarker: "arrow", lineStyle: "solid", routing: "straight" },
  { id: "inheritance", label: "Inheritance / generalization", startMarker: "none", endMarker: "hollowTriangle", lineStyle: "solid", routing: "straight" },
  { id: "aggregation", label: "Aggregation", startMarker: "hollowDiamond", endMarker: "none", lineStyle: "solid", routing: "straight" },
  { id: "composition", label: "Composition", startMarker: "diamond", endMarker: "none", lineStyle: "solid", routing: "straight" },
  { id: "dependency", label: "Dependency", startMarker: "none", endMarker: "openArrow", lineStyle: "dashed", routing: "straight" },
  { id: "realization", label: "Realization", startMarker: "none", endMarker: "hollowTriangle", lineStyle: "dashed", routing: "straight" },
];

/** Which UML relationship kind an edge's markers currently express. */
export function relationshipOf(edge) {
  const startMarker = edge?.startMarker || DEFAULT_START_MARKER;
  const endMarker = edge?.endMarker || DEFAULT_END_MARKER;
  const lineStyle = edge?.lineStyle || "solid";
  const match = UML_RELATIONSHIPS.find(
    (r) => r.startMarker === startMarker && r.endMarker === endMarker && r.lineStyle === lineStyle
  );
  return match ? match.id : "";
}

/** Apply a UML relationship kind to the edge, keeping its routing. */
export function relationshipPatch(id) {
  const rel = UML_RELATIONSHIPS.find((r) => r.id === id);
  if (!rel) return null;
  return {
    relationshipType: rel.id,
    startMarker: rel.startMarker,
    endMarker: rel.endMarker,
    lineStyle: rel.lineStyle,
    arrow: arrowFromMarkers(rel.startMarker, rel.endMarker),
  };
}

/** Multiplicities offered for UML association ends (free text is allowed too). */
export const MULTIPLICITIES = ["1", "0..1", "*", "1..*", "0..*", "2..5"];

/**
 * The legacy `arrow` field is what the backend SVG export still reads, so it is
 * kept in sync with the two end markers rather than left to drift.
 */
export function arrowFromMarkers(startMarker, endMarker) {
  const start = Boolean(startMarker) && startMarker !== "none";
  const end = Boolean(endMarker) && endMarker !== "none";
  if (start && end) return "both";
  if (start) return "backward";
  if (end) return "forward";
  return "none";
}

/** Map a legacy `arrow` value onto the marker pair (older saved diagrams). */
export function markersFromArrow(arrow) {
  if (arrow === "backward") return { startMarker: "arrow", endMarker: "none" };
  if (arrow === "both") return { startMarker: "arrow", endMarker: "arrow" };
  if (arrow === "none") return { startMarker: "none", endMarker: "none" };
  return { startMarker: "none", endMarker: "arrow" };
}
