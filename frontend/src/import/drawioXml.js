/**
 * draw.io / diagrams.net XML import.
 *
 * Two layers:
 *  - `parseDrawioXml` (browser) reads an `<mxfile>` or `<mxGraphModel>` into a
 *    plain `{ pages: [{ name, cells }] }` structure. Compressed pages are
 *    inflated with the browser's own DecompressionStream.
 *  - `convertMxCells` (pure) turns those cells into canonical nodes and edges.
 *    It never touches the DOM, so the risky mapping is covered by the checks.
 *
 * Safety: the XML is only ever read with DOMParser('application/xml'), which
 * does not execute scripts or fetch anything. Labels are reduced to text with a
 * tag-stripping pass; no XML content is inserted into the document as HTML.
 */

import { DEFAULT_SIZE, FAMILY_NODE_TYPES, emptyDiagram, enforceFamily } from "../schema/canonical.js";

/** Refuse anything absurdly large before doing any work. */
export const MAX_XML_LENGTH = 8 * 1024 * 1024;

export class ImportError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ImportError";
    this.details = details;
  }
}

/* --------------------------------------------------------------- detect --- */

/** Cheap check: only these two document shapes are supported. */
export function isSupportedDiagramXml(text) {
  if (typeof text !== "string") return false;
  const head = text.trimStart();
  if (head.length < 8 || head.length > MAX_XML_LENGTH) return false;
  if (!head.startsWith("<")) return false;
  return /<mxfile[\s>]/i.test(head) || /<mxGraphModel[\s>]/i.test(head);
}

/* ------------------------------------------------------------ cell data --- */

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstChildNamed(parent, name) {
  for (const child of parent?.children || []) {
    if (child.nodeName === name) return child;
  }
  return null;
}

/** Read one `<mxGraphModel>` into plain cells — no DOM escapes this function. */
function extractCells(model) {
  const root = firstChildNamed(model, "root") || model;
  const cells = [];
  for (const element of root.getElementsByTagName("mxCell")) {
    const wrapper =
      element.parentElement && /^(object|userobject)$/i.test(element.parentElement.nodeName)
        ? element.parentElement
        : null;
    const id = String(wrapper?.getAttribute("id") || element.getAttribute("id") || "").trim();
    if (!id) continue;
    const geometry = firstChildNamed(element, "mxGeometry");
    cells.push({
      id,
      // `UserObject` stores the label on the wrapper instead of the cell.
      value: wrapper?.getAttribute("label") ?? element.getAttribute("value") ?? "",
      style: element.getAttribute("style") || "",
      parent: element.getAttribute("parent") || "",
      vertex: element.getAttribute("vertex") === "1",
      edge: element.getAttribute("edge") === "1",
      source: element.getAttribute("source") || null,
      target: element.getAttribute("target") || null,
      visible: element.getAttribute("visible") !== "0",
      geometry: geometry
        ? {
            x: num(geometry.getAttribute("x")),
            y: num(geometry.getAttribute("y")),
            width: num(geometry.getAttribute("width")),
            height: num(geometry.getAttribute("height")),
            relative: geometry.getAttribute("relative") === "1",
          }
        : null,
    });
  }
  return cells;
}

async function inflateModel(payload) {
  if (typeof DecompressionStream === "undefined" || typeof atob === "undefined") {
    throw new ImportError(
      "This draw.io page is compressed and this browser cannot decompress it. Re-export the diagram with compression turned off."
    );
  }
  let xml;
  try {
    const binary = atob(payload.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    xml = decodeURIComponent(await new Response(stream).text());
  } catch (error) {
    throw new ImportError(
      "This draw.io page is compressed and could not be decompressed. Re-export the diagram with compression turned off.",
      [String(error?.message || error)]
    );
  }
  const doc = new DOMParser().parseFromString(xml.trim(), "application/xml");
  if (doc.getElementsByTagName("parsererror")[0]) {
    throw new ImportError("The decompressed page is not valid XML.");
  }
  const model =
    doc.documentElement?.nodeName === "mxGraphModel"
      ? doc.documentElement
      : doc.getElementsByTagName("mxGraphModel")[0];
  if (!model) throw new ImportError("The decompressed page contains no mxGraphModel.");
  return model;
}

/**
 * Read a supported XML document into pages of plain cells.
 * Throws ImportError with a user-facing message for anything unsupported.
 */
export async function parseDrawioXml(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new ImportError("There is nothing to import.");
  }
  if (text.length > MAX_XML_LENGTH) {
    throw new ImportError("That XML is too large to import (limit 8 MB).");
  }
  if (!isSupportedDiagramXml(text)) {
    throw new ImportError(
      "That is not a supported diagram XML. Supported formats: draw.io <mxfile> and <mxGraphModel>."
    );
  }

  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror")[0]) {
    throw new ImportError("The XML is malformed and could not be read.");
  }

  const warnings = [];
  const pages = [];
  const mxfile =
    doc.documentElement?.nodeName === "mxfile"
      ? doc.documentElement
      : doc.getElementsByTagName("mxfile")[0];

  if (mxfile) {
    const diagramElements = [];
    for (const child of mxfile.children) {
      if (child.nodeName === "diagram") diagramElements.push(child);
    }
    if (!diagramElements.length) {
      throw new ImportError("This <mxfile> contains no <diagram> pages.");
    }
    for (let index = 0; index < diagramElements.length; index += 1) {
      const element = diagramElements[index];
      const name = String(element.getAttribute("name") || `Page ${index + 1}`).trim();
      let model = firstChildNamed(element, "mxGraphModel");
      if (!model) {
        const payload = element.textContent.trim();
        if (payload) model = await inflateModel(payload);
      }
      if (!model) {
        warnings.push(`Page "${name}" was empty and was skipped.`);
        continue;
      }
      pages.push({ name, cells: extractCells(model) });
    }
  } else {
    const model =
      doc.documentElement?.nodeName === "mxGraphModel"
        ? doc.documentElement
        : doc.getElementsByTagName("mxGraphModel")[0];
    if (!model) {
      throw new ImportError("No <mxGraphModel> was found in this XML.");
    }
    pages.push({ name: "Imported page", cells: extractCells(model) });
  }

  if (!pages.length) throw new ImportError("No diagram pages were found in this XML.");
  return { pages, warnings };
}

/* ------------------------------------------------------------- mapping ---- */

/** mxGraph style string -> plain object. `ellipse;html=1;` yields { ellipse: "1" }. */
export function parseStyleString(style) {
  const out = {};
  for (const part of String(style || "").split(";")) {
    const chunk = part.trim();
    if (!chunk) continue;
    const eq = chunk.indexOf("=");
    if (eq === -1) {
      out[chunk.toLowerCase()] = "1";
      continue;
    }
    const key = chunk.slice(0, eq).trim();
    if (key) out[key] = chunk.slice(eq + 1).trim();
  }
  return out;
}

const SHAPE_TYPES = {
  ellipse: "ellipse",
  doubleellipse: "ellipse",
  usecase: "ellipse",
  rhombus: "diamond",
  decision: "decision",
  terminator: "terminator",
  triangle: "triangle",
  hexagon: "hexagon",
  cylinder: "database",
  cylinder3: "database",
  database: "database",
  document: "document",
  note: "stickyNote",
  card: "stickyNote",
  cloud: "cloud",
  star: "star",
  pentagon: "pentagon",
  octagon: "octagon",
  callout: "callout",
  actor: "actor",
  umlactor: "actor",
  package: "package",
  module: "package",
  internalstorage: "dataStore",
  datastore: "dataStore",
  parallelogram: "parallelogram",
  data: "parallelogram",
  trapezoid: "trapezoid",
  step: "preparation",
  preparation: "preparation",
  manualoperation: "manualOperation",
  offpagereference: "offPageConnector",
  onpagereference: "connector",
  predefinedprocess: "predefinedProcess",
  process: "process",
  delay: "process",
  display: "process",
  multidocument: "multipleDocument",
  text: "text",
  swimlane: "rectangle",
  group: "rectangle",
};

/** Shapes kept exactly as they are: they are valid in every diagram family. */
const KEEP_AS_IS = new Set([
  "text",
  "cloud",
  "star",
  "callout",
  "stickyNote",
  "multipleDocument",
  "hexagon",
  "triangle",
  "pentagon",
  "octagon",
  "trapezoid",
  "invertedTriangle",
]);

function shapeKey(name) {
  return String(name || "")
    .split(".")
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function mapMxShape(style) {
  const s = typeof style === "string" ? parseStyleString(style) : style || {};
  if (s.shape) {
    const mapped = SHAPE_TYPES[shapeKey(s.shape)];
    if (mapped) return { type: mapped, known: true };
    return { type: "rectangle", known: false, name: s.shape };
  }
  if (s.ellipse === "1") return { type: "ellipse", known: true };
  if (s.rhombus === "1") return { type: "diamond", known: true };
  if (s.text === "1" || (s.strokeColor === "none" && s.fillColor === "none" && s.text)) {
    return { type: "text", known: true };
  }
  if (s.swimlane === "1" || s.group === "1") return { type: "rectangle", known: true };
  if (s.rounded === "1") return { type: "roundedRectangle", known: true };
  return { type: "rectangle", known: true };
}

/**
 * Keep a shape when the target family actually has it (or it is notation-free),
 * otherwise translate it the way recognition does: a plain box in an ER diagram
 * becomes an entity, not a stray rectangle.
 */
function resolveType(type, diagramType) {
  const family = diagramType || "flowchart";
  if (KEEP_AS_IS.has(type)) return type;
  if ((FAMILY_NODE_TYPES[family] || []).includes(type)) return type;
  return enforceFamily(type, family);
}

const ARROWS = {
  none: "none",
  classic: "arrow",
  classicthin: "arrow",
  block: "triangle",
  blockthin: "triangle",
  open: "openArrow",
  openthin: "openArrow",
  oval: "circle",
  ovalthin: "circle",
  dot: "circle",
  diamond: "diamond",
  diamondthin: "hollowDiamond",
  ermany: "crowfoot",
  ermandone: "crowfoot",
  erzerotomany: "crowfoot",
  erone: "circle",
  erzerotoone: "circle",
  async: "openArrow",
};

export function mxArrow(value, fallback) {
  if (!value) return fallback;
  return ARROWS[String(value).toLowerCase().replace(/[^a-z]/g, "")] || fallback;
}

export function mxRouting(style) {
  const s = typeof style === "string" ? parseStyleString(style) : style || {};
  if (s.curved === "1") return "curved";
  if (s.edgeStyle === "orthogonalEdgeStyle" || s.edgeStyle === "elbowEdgeStyle") {
    return s.rounded === "1" ? "rounded" : "elbow";
  }
  return "straight";
}

export function mxLineStyle(style) {
  const s = typeof style === "string" ? parseStyleString(style) : style || {};
  return s.dashed === "1" || s.dashPattern ? "dashed" : "solid";
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function fromCodePoint(code) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * draw.io labels are often HTML (`value="&lt;b&gt;Start&lt;/b&gt;"`). Only the
 * text is kept: tags are stripped and entities decoded, so nothing from the file
 * is ever interpreted as markup.
 */
export function stripRichText(value) {
  if (value == null) return "";
  let text = String(value);
  if (!text) return "";
  if (!/[<&]/.test(text)) return text.trim();

  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[String(name).toLowerCase()] ?? match);

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hexColor(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * draw.io leaves the label colour unset in most files: the text is black, which
 * only works because the default shape fill there is white. SmartSketch's theme
 * is dark, so an imported light fill would swallow the light label. Pick a
 * readable label colour from the fill we actually import.
 */
export function labelColorFor(fill) {
  const hex = hexColor(fill);
  if (!hex) return null;
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.45 ? "#1f2937" : "#e8eef6";
}

/** Node style overrides from an mxGraph style string (partial, merged later). */
export function mxNodeStyle(style) {
  const s = typeof style === "string" ? parseStyleString(style) : style || {};
  const out = {};
  if (s.fillColor === "none") out.fill = "transparent";
  else {
    const fill = hexColor(s.fillColor);
    if (fill) out.fill = fill;
  }
  if (s.strokeColor === "none") out.border = "transparent";
  else {
    const stroke = hexColor(s.strokeColor);
    if (stroke) out.border = stroke;
  }
  const font = hexColor(s.fontColor);
  if (font) out.color = font;

  const fontSize = Number(s.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) out.fontSize = clamp(fontSize, 8, 48);

  if (s.fontFamily) {
    const family = String(s.fontFamily).split(",")[0].replace(/["']/g, "").trim();
    if (family) out.font = family;
  }
  const fontStyle = Number(s.fontStyle || 0);
  if (fontStyle & 1) out.fontWeight = "700";
  if (fontStyle & 2) out.fontStyle = "italic";
  if (s.align === "left" || s.align === "right") out.textAlign = s.align;

  const strokeWidth = Number(s.strokeWidth);
  if (Number.isFinite(strokeWidth)) out.borderWidth = clamp(strokeWidth, 0, 12);

  const opacity = Number(s.opacity);
  if (Number.isFinite(opacity)) out.opacity = clamp(opacity / 100, 0.1, 1);

  return out;
}

function absolutePosition(cell, byId) {
  let x = cell.geometry?.x || 0;
  let y = cell.geometry?.y || 0;
  let parentId = cell.parent;
  let depth = 0;
  const seen = new Set();
  while (parentId && depth < 32) {
    const parent = byId.get(parentId);
    if (!parent || !parent.geometry || parent.edge || seen.has(parentId)) break;
    seen.add(parentId);
    x += parent.geometry.x || 0;
    y += parent.geometry.y || 0;
    parentId = parent.parent;
    depth += 1;
  }
  return { x, y };
}

/* ----------------------------------------------------------- conversion --- */

/**
 * Convert mxGraph cells into canonical nodes and edges for one page.
 * Dangling connectors are dropped, ids are made unique, and everything that
 * could not be represented is reported in `warnings`.
 */
export function convertMxCells(cells, { diagramType = "flowchart" } = {}) {
  const family = diagramType || "flowchart";
  const list = Array.isArray(cells) ? cells : [];
  const warnings = [];
  const stats = { shapes: 0, connectors: 0, skippedConnectors: 0, unsupportedShapes: 0 };

  const byId = new Map();
  for (const cell of list) {
    if (cell?.id && !byId.has(cell.id)) byId.set(cell.id, cell);
  }
  const edgeIds = new Set(list.filter((cell) => cell?.edge).map((cell) => cell.id));

  // Edge labels are separate vertex cells parented to the edge.
  const edgeLabels = new Map();
  for (const cell of list) {
    if (!cell?.vertex || !edgeIds.has(cell.parent) || cell.visible === false) continue;
    const text = stripRichText(cell.value);
    if (text) edgeLabels.set(cell.parent, text);
  }

  const nodes = [];
  const usedIds = new Set();
  const idFor = new Map();
  const unknownShapes = new Set();

  for (const cell of list) {
    if (!cell?.vertex || !cell.geometry) continue;
    if (cell.visible === false) continue;
    if (edgeIds.has(cell.parent)) continue; // edge label, not a shape
    if (cell.geometry.relative) continue;

    const style = parseStyleString(cell.style);
    if (style.edgeLabel === "1") continue;

    const mapped = mapMxShape(cell.style);
    if (!mapped.known) {
      stats.unsupportedShapes += 1;
      unknownShapes.add(mapped.name || "unknown");
    }
    if (!mapped.known && style.image === "1") unknownShapes.add("image");

    let id = String(cell.id);
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}_${suffix}`)) suffix += 1;
      warnings.push(`Duplicate shape id "${id}" was renamed.`);
      id = `${id}_${suffix}`;
    }
    usedIds.add(id);
    idFor.set(cell.id, id);

    const position = absolutePosition(cell, byId);
    const width = cell.geometry.width > 4 ? cell.geometry.width : DEFAULT_SIZE.width;
    const height = cell.geometry.height > 4 ? cell.geometry.height : DEFAULT_SIZE.height;

    const nodeStyle = mxNodeStyle(style);
    if (!nodeStyle.color && nodeStyle.fill) {
      const label = labelColorFor(nodeStyle.fill);
      if (label) nodeStyle.color = label;
    }

    nodes.push({
      id,
      type: resolveType(mapped.type, family),
      label: stripRichText(cell.value),
      position,
      size: { width, height },
      style: nodeStyle,
      attributes: [],
      methods: [],
      // The XML coordinates are authoritative: do not re-fit the box to its text.
      autoSize: false,
      locked: false,
      parentId: null,
      confidence: null,
      sources: [],
    });
    stats.shapes += 1;
  }

  if (unknownShapes.size) {
    const names = [...unknownShapes].slice(0, 3).join(", ");
    warnings.push(
      `${stats.unsupportedShapes} shape${stats.unsupportedShapes === 1 ? "" : "s"} used an unsupported style and became a box (${names}${unknownShapes.size > 3 ? ", …" : ""}).`
    );
  }

  const edges = [];
  const usedEdgeIds = new Set();
  for (const cell of list) {
    if (!cell?.edge || cell.visible === false) continue;
    const source = idFor.get(cell.source);
    const target = idFor.get(cell.target);
    if (!source || !target) {
      stats.skippedConnectors += 1;
      continue;
    }
    const style = parseStyleString(cell.style);
    let id = String(cell.id);
    if (usedEdgeIds.has(id)) {
      let suffix = 2;
      while (usedEdgeIds.has(`${id}_${suffix}`)) suffix += 1;
      id = `${id}_${suffix}`;
    }
    usedEdgeIds.add(id);

    const stroke =
      style.strokeColor === "none" ? "transparent" : hexColor(style.strokeColor) || undefined;
    const strokeWidth = Number(style.strokeWidth);
    edges.push({
      id,
      source,
      target,
      label: stripRichText(cell.value) || edgeLabels.get(cell.id) || "",
      routing: mxRouting(style),
      startMarker: mxArrow(style.startArrow, "none"),
      endMarker: mxArrow(style.endArrow, "arrow"),
      markerSize: 16,
      lineStyle: mxLineStyle(style),
      sourceMultiplicity: "",
      targetMultiplicity: "",
      relationshipType: "",
      style: {
        ...(stroke ? { border: stroke } : {}),
        ...(Number.isFinite(strokeWidth) ? { borderWidth: clamp(strokeWidth, 0.5, 10) } : {}),
      },
    });
    stats.connectors += 1;
  }

  if (stats.skippedConnectors) {
    warnings.push(
      `${stats.skippedConnectors} connector${stats.skippedConnectors === 1 ? "" : "s"} skipped: no imported shape at both ends.`
    );
  }

  return { nodes, edges, warnings, stats };
}

/** A complete canonical diagram for one imported page. */
export function buildImportedDiagram(page, diagramType = "flowchart") {
  const converted = convertMxCells(page?.cells, { diagramType });
  const base = emptyDiagram(diagramType);
  const diagram = {
    ...base,
    nodes: converted.nodes,
    edges: converted.edges,
    meta: { ...base.meta, name: page?.name || "Imported page" },
  };
  return { diagram, ...converted };
}
