/** Canonical diagram JSON — single source of truth for canvas, export, and recognition. */

import {
  DEFAULT_END_MARKER,
  DEFAULT_MARKER_SIZE,
  DEFAULT_ROUTING,
  DEFAULT_START_MARKER,
  MAX_MARKER_SIZE,
  MIN_MARKER_SIZE,
  arrowFromMarkers,
  markersFromArrow,
} from "../canvas/connectors.js";

export const DIAGRAM_TYPES = [
  { id: "flowchart", label: "Flowchart" },
  { id: "uml", label: "UML Class Diagram" },
  { id: "er", label: "ER Diagram" },
  { id: "dfd", label: "Data Flow Diagram" },
];

export const NODE_TYPES = [
  "rectangle",
  "roundedRectangle",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "parallelogram",
  "invertedTriangle",
  "trapezoid",
  "pentagon",
  "octagon",
  "cylinder",
  "cloud",
  "star",
  "callout",
  "stickyNote",
  "multipleDocument",
  "text",
  "process",
  "decision",
  "terminator",
  "io",
  "document",
  "database",
  "predefinedProcess",
  "manualOperation",
  "preparation",
  "connector",
  "offPageConnector",
  "class",
  "interface",
  "package",
  "actor",
  "usecase",
  "entity",
  "attribute",
  "relationship",
  "weakEntity",
  "multivaluedAttribute",
  "derivedAttribute",
  "dfdProcess",
  "dataStore",
  "externalEntity",
  "dataFlow",
  "group",
];

export const DEFAULT_SIZE = { width: 160, height: 72 };

/**
 * Shapes that belong to no single notation: they are offered by every diagram
 * family and keep their type wherever the user places them.
 *
 * Recognition output is unaffected: nodes that arrive with provenance are
 * still normalized with the strict `enforceFamily` filter on load, so a vision
 * model's generic "rectangle" becomes an entity in an ER diagram exactly as
 * before.
 */
export const GENERAL_NODE_TYPES = [
  "text",
  "rectangle",
  "roundedRectangle",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "parallelogram",
  "invertedTriangle",
  "trapezoid",
  "pentagon",
  "octagon",
  "cylinder",
  "cloud",
  "star",
  "callout",
  "stickyNote",
  "multipleDocument",
];

/** The shape types a family offers: its own notation plus the general shapes. */
export function shapesForFamily(diagramType) {
  const family = FAMILY_NODE_TYPES[diagramType] || NODE_TYPES;
  return [...family, ...GENERAL_NODE_TYPES.filter((t) => !family.includes(t))];
}

/**
 * The complete shape vocabulary of each diagram family. Nothing outside this
 * set may appear on the canvas while that family is active — an ER diagram
 * never shows flowchart shapes and vice versa.
 */
export const FAMILY_NODE_TYPES = {
  flowchart: [
    "process",
    "decision",
    "terminator",
    "io",
    "document",
    "database",
    "predefinedProcess",
    "manualOperation",
    "preparation",
    "connector",
    "offPageConnector",
    "text",
  ],
  er: [
    "entity",
    "attribute",
    "relationship",
    "weakEntity",
    "multivaluedAttribute",
    "derivedAttribute",
    "text",
  ],
  uml: ["class", "interface", "package", "actor", "usecase", "text"],
  dfd: ["dfdProcess", "dataStore", "externalEntity", "dataFlow", "text"],
};

/** Where a shape has no meaningful counterpart in the family, use this. */
export const FAMILY_DEFAULTS = {
  flowchart: "process",
  er: "entity",
  uml: "class",
  dfd: "dfdProcess",
};

/** Closest cross-family counterparts, mirroring the backend FAMILY_REMAP. */
const CROSS_FAMILY = {
  // Generic shapes a vision model may emit for any family
  rectangle: { flowchart: "process", er: "entity", uml: "class", dfd: "externalEntity" },
  roundedRectangle: { flowchart: "process", er: "entity", uml: "class", dfd: "dfdProcess" },
  ellipse: { flowchart: "terminator", er: "attribute", uml: "usecase", dfd: "dfdProcess" },
  diamond: { flowchart: "decision", er: "relationship", uml: "class", dfd: "dfdProcess" },
  triangle: { flowchart: "process", er: "entity", uml: "class", dfd: "externalEntity" },
  hexagon: { flowchart: "process", er: "entity", uml: "class", dfd: "externalEntity" },
  parallelogram: { flowchart: "io", er: "entity", uml: "class", dfd: "externalEntity" },
  // flowchart → others
  process: { er: "entity", uml: "class", dfd: "dfdProcess" },
  decision: { er: "relationship", uml: "class", dfd: "dfdProcess" },
  terminator: { er: "attribute", uml: "usecase", dfd: "dfdProcess" },
  io: { er: "attribute", uml: "class", dfd: "externalEntity" },
  document: { er: "entity", uml: "class", dfd: "externalEntity" },
  database: { er: "entity", uml: "class", dfd: "dataStore" },
  predefinedProcess: { er: "entity", uml: "class", dfd: "dfdProcess" },
  manualOperation: { er: "entity", uml: "class", dfd: "dfdProcess" },
  preparation: { er: "entity", uml: "class", dfd: "dfdProcess" },
  connector: { er: "attribute", uml: "usecase", dfd: "dfdProcess" },
  offPageConnector: { er: "entity", uml: "class", dfd: "externalEntity" },
  // er → others
  entity: { flowchart: "process", uml: "class", dfd: "externalEntity" },
  attribute: { flowchart: "io", uml: "usecase", dfd: "dfdProcess" },
  relationship: { flowchart: "decision", uml: "class", dfd: "dfdProcess" },
  weakEntity: { flowchart: "process", uml: "class", dfd: "externalEntity" },
  multivaluedAttribute: { flowchart: "io", uml: "usecase", dfd: "dfdProcess" },
  derivedAttribute: { flowchart: "io", uml: "usecase", dfd: "dfdProcess" },
  // uml → others
  class: { flowchart: "process", er: "entity", dfd: "externalEntity" },
  interface: { flowchart: "process", er: "entity", dfd: "externalEntity" },
  package: { flowchart: "process", er: "entity", dfd: "externalEntity" },
  actor: { flowchart: "terminator", er: "attribute", dfd: "externalEntity" },
  usecase: { flowchart: "terminator", er: "attribute", dfd: "dfdProcess" },
  // dfd → others
  dfdProcess: { flowchart: "process", er: "entity", uml: "class" },
  dataStore: { flowchart: "database", er: "entity", uml: "class" },
  externalEntity: { flowchart: "process", er: "entity", uml: "class" },
  dataFlow: { flowchart: "io", er: "relationship", uml: "class" },
};

/** A general shape is offered by every family and is never remapped. */
export function isUniversalShape(nodeType) {
  return GENERAL_NODE_TYPES.includes(nodeType);
}

/**
 * Map a foreign node type into a diagram family's vocabulary.
 *
 * This is the strict family filter: recognized shapes are normalized with it,
 * so a vision model's generic "rectangle" still becomes an entity in an ER
 * diagram. User-authored general shapes bypass it via `isUniversalShape`.
 */
export function enforceFamily(nodeType, diagramType) {
  if (nodeType === "group") return nodeType;
  const family = FAMILY_NODE_TYPES[diagramType];
  if (!family) return nodeType;
  if (family.includes(nodeType)) return nodeType;
  const counterpart = CROSS_FAMILY[nodeType]?.[diagramType];
  if (counterpart && family.includes(counterpart)) return counterpart;
  return FAMILY_DEFAULTS[diagramType] || nodeType;
}

export function emptyDiagram(diagramType = "flowchart") {
  return {
    version: 1,
    diagram_type: diagramType,
    nodes: [],
    edges: [],
    groups: [],
    meta: {
      name: "Untitled Diagram",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function defaultStyle() {
  return {
    fill: "#1e2a3a",
    border: "#7aa2c9",
    borderWidth: 1.5,
    color: "#e8eef6",
    font: "Segoe UI",
    fontSize: 13,
    fontStyle: "normal",
    fontWeight: "500",
    textAlign: "center",
    opacity: 1,
    lineStyle: "solid",
    arrow: "forward",
  };
}

export function createCanonicalNode(partial = {}) {
  const style = { ...defaultStyle(), ...(partial.style || {}) };
  return {
    id: partial.id || `node_${crypto.randomUUID().slice(0, 8)}`,
    type: partial.type || "rectangle",
    label: partial.label ?? "Node",
    position: {
      x: Number(partial.position?.x ?? 120),
      y: Number(partial.position?.y ?? 120),
    },
    size: {
      width: Number(partial.size?.width ?? DEFAULT_SIZE.width),
      height: Number(partial.size?.height ?? DEFAULT_SIZE.height),
    },
    style,
    attributes: Array.isArray(partial.attributes) ? partial.attributes : [],
    methods: Array.isArray(partial.methods) ? partial.methods : [],
    // false once the user resizes a node by hand: their size then wins over
    // fitting the box to the text it holds.
    autoSize: partial.autoSize !== false,
    locked: Boolean(partial.locked),
    parentId: partial.parentId || null,
    confidence: typeof partial.confidence === "number" ? partial.confidence : null,
    sources: Array.isArray(partial.sources) ? partial.sources : [],
  };
}

export function createCanonicalEdge(partial = {}) {
  const style = { ...defaultStyle(), ...(partial.style || {}) };
  // Diagrams saved before end markers existed only carry `arrow`. Reading it as
  // the marker pair keeps every old connector looking exactly as it did.
  const legacy = markersFromArrow(partial.arrow || style.arrow);
  const startMarker = partial.startMarker || legacy.startMarker || DEFAULT_START_MARKER;
  const endMarker = partial.endMarker || legacy.endMarker || DEFAULT_END_MARKER;
  return {
    id: partial.id || `edge_${crypto.randomUUID().slice(0, 8)}`,
    source: partial.source,
    target: partial.target,
    sourceHandle: partial.sourceHandle || null,
    targetHandle: partial.targetHandle || null,
    label: partial.label ?? "",
    // How the line runs between its two anchors.
    routing: partial.routing || DEFAULT_ROUTING,
    // Kept in sync with the two end markers: the backend SVG export reads it.
    arrow: arrowFromMarkers(startMarker, endMarker),
    startMarker,
    endMarker,
    markerSize: clampMarkerSize(partial.markerSize),
    lineStyle: partial.lineStyle || style.lineStyle || "solid",
    // UML association ends, drawn at the corresponding connector ends.
    sourceMultiplicity: partial.sourceMultiplicity ?? "",
    targetMultiplicity: partial.targetMultiplicity ?? "",
    relationshipType: partial.relationshipType ?? "",
    style,
    confidence: typeof partial.confidence === "number" ? partial.confidence : null,
    sources: Array.isArray(partial.sources) ? partial.sources : [],
  };
}

export function clampMarkerSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_MARKER_SIZE;
  return Math.min(MAX_MARKER_SIZE, Math.max(MIN_MARKER_SIZE, Math.round(size)));
}

export function validateDiagram(data) {
  const errors = [];
  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["Diagram payload is not an object."] };
  }
  const type = String(data.diagram_type || "").toLowerCase();
  const allowed = DIAGRAM_TYPES.map((d) => d.id);
  if (type && !allowed.includes(type) && type !== "unknown" && type !== "auto") {
    errors.push(`Unsupported diagram type: ${data.diagram_type}`);
  }
  if (!Array.isArray(data.nodes)) errors.push("nodes must be an array.");
  if (!Array.isArray(data.edges)) errors.push("edges must be an array.");
  const ids = new Set();
  for (const node of data.nodes || []) {
    if (!node?.id) errors.push("A node is missing an id.");
    else if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    else ids.add(node.id);
  }
  for (const edge of data.edges || []) {
    if (!edge?.id) errors.push("An edge is missing an id.");
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      errors.push(`Edge ${edge?.id || "?"} references missing nodes.`);
    }
  }
  return { ok: errors.length === 0, errors };
}
