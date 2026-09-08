/** Canonical diagram JSON — single source of truth for canvas, export, and recognition. */

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
  "text",
  "process",
  "decision",
  "terminator",
  "io",
  "document",
  "database",
  "predefinedProcess",
  "class",
  "interface",
  "package",
  "actor",
  "usecase",
  "entity",
  "attribute",
  "relationship",
  "weakEntity",
  "dfdProcess",
  "dataStore",
  "externalEntity",
  "dataFlow",
  "group",
];

export const DEFAULT_SIZE = { width: 160, height: 72 };

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
    locked: Boolean(partial.locked),
    parentId: partial.parentId || null,
    confidence: typeof partial.confidence === "number" ? partial.confidence : null,
    sources: Array.isArray(partial.sources) ? partial.sources : [],
  };
}

export function createCanonicalEdge(partial = {}) {
  const style = { ...defaultStyle(), ...(partial.style || {}) };
  return {
    id: partial.id || `edge_${crypto.randomUUID().slice(0, 8)}`,
    source: partial.source,
    target: partial.target,
    sourceHandle: partial.sourceHandle || null,
    targetHandle: partial.targetHandle || null,
    label: partial.label ?? "",
    arrow: partial.arrow || style.arrow || "forward",
    lineStyle: partial.lineStyle || style.lineStyle || "solid",
    style,
    confidence: typeof partial.confidence === "number" ? partial.confidence : null,
    sources: Array.isArray(partial.sources) ? partial.sources : [],
  };
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
