/**
 * Fits a node's box to the text it actually holds.
 *
 * Recognition returns boxes sized from the photograph, so a class with three
 * members can arrive as a tall empty rectangle. Every visible node is measured
 * here and given the smallest box that holds its label, attributes and methods
 * without clipping. Measurements mirror the CSS in `styles.css`, and use the
 * canvas 2D text metrics when a DOM is available.
 */

const FONT_FAMILY = '"Segoe UI", Arial, sans-serif';
const MEMBER_FONT_SIZE = 11; // must match .class-member / .node-attrs blocks
const MIN_WIDTH = 40;
const MIN_HEIGHT = 28;

let context = null;

function measureContext() {
  if (context) return context;
  if (typeof document === "undefined") return null;
  context = document.createElement("canvas").getContext("2d");
  return context;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function textWidth(text, size, bold = false) {
  const value = String(text ?? "");
  const longest = value
    .split("\n")
    .reduce((best, line) => (line.length > best.length ? line : best), "");
  const ctx = measureContext();
  if (ctx) {
    ctx.font = `${bold ? "700" : "400"} ${size}px ${FONT_FAMILY}`;
    return ctx.measureText(longest).width;
  }
  // Headless fallback: rough average glyph width.
  return longest.length * size * (bold ? 0.62 : 0.56);
}

function widest(values, size, bold = false) {
  return values.reduce((best, value) => Math.max(best, textWidth(value, size, bold)), 0);
}

/** Label box: padding 6px/8px, a little slack so words do not break, plus the tallest line. */
const LABEL_SLACK = 8;

function labelBox(node, fontSize, extraWidth = 0) {
  const label = String(node.label ?? " ");
  const lines = Math.max(1, label.split("\n").length);
  return {
    width: textWidth(label, fontSize, false) + 16 + LABEL_SLACK + extraWidth,
    height: lines * fontSize * 1.35 + 14,
  };
}

export function measureNode(node) {
  const style = node.style || {};
  const fontSize = Number(style.fontSize) || 13;
  const type = node.type;
  const attrs = node.attributes || [];
  const methods = node.methods || [];

  if (type === "group") {
    return null; // groups wrap their children, they are never fitted
  }

  if (type === "class" || type === "interface") {
    // Three compartments: title, attributes, methods. All three keep their
    // space even when empty, so an empty class still reads as a UML box.
    const title = type === "interface" ? `«interface» ${node.label ?? ""}` : String(node.label ?? "");
    const memberW = widest([...attrs, ...methods], MEMBER_FONT_SIZE);
    const contentW = Math.max(textWidth(title, fontSize, true), memberW);
    const attrH = Math.max(18, attrs.length * MEMBER_FONT_SIZE * 1.35 + 6);
    const methodH = Math.max(18, methods.length * MEMBER_FONT_SIZE * 1.35 + 6);
    return {
      width: clamp(Math.ceil(contentW + 26), 96, 460),
      height: clamp(Math.ceil(fontSize * 1.35 + 12 + attrH + methodH), 72, 560),
    };
  }

  if (type === "entity" || type === "weakEntity" || type === "externalEntity") {
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width), 72, 420),
      height: clamp(Math.ceil(box.height), 40, 240),
    };
  }

  if (type === "relationship" || type === "decision" || type === "diamond") {
    // A diamond's usable middle is roughly half its width, so it needs more room.
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width * 1.9), 100, 460),
      height: clamp(Math.ceil(box.height * 1.9), 84, 320),
    };
  }

  if (type === "attribute" || type === "usecase" || type === "multivaluedAttribute" || type === "derivedAttribute") {
    // Ellipses lose their width towards the text, hence the generous factor.
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width * 1.55), 84, 420),
      height: clamp(Math.ceil(box.height * 1.45), 44, 220),
    };
  }

  if (type === "terminator") {
    const box = labelBox(node, fontSize, 18);
    return {
      width: clamp(Math.ceil(box.width * 1.25), 76, 420),
      height: clamp(Math.ceil(box.height * 1.2), 40, 200),
    };
  }

  if (type === "document") {
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width), 70, 420),
      height: clamp(Math.ceil(box.height + 14), 48, 260),
    };
  }

  if (type === "connector") {
    // A connector is a small circle: it holds a short reference, not a sentence.
    const box = labelBox(node, fontSize);
    const side = clamp(Math.ceil(Math.max(box.width, box.height) + 18), 40, 120);
    return { width: side, height: side };
  }

  if (type === "star") {
    // A star's usable middle is small, so it needs room around its text.
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width * 1.7), 90, 420),
      height: clamp(Math.ceil(box.height * 1.5), 80, 320),
    };
  }

  if (type === "cloud" || type === "callout") {
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width * 1.25), 90, 440),
      height: clamp(Math.ceil(box.height + (type === "callout" ? 22 : 16)), 50, 260),
    };
  }

  if (type === "cylinder") {
    const box = labelBox(node, fontSize, 14);
    return {
      width: clamp(Math.ceil(box.width), 80, 420),
      height: clamp(Math.ceil(box.height + 20), 56, 260),
    };
  }

  if (type === "database") {
    const box = labelBox(node, fontSize, 14);
    return {
      width: clamp(Math.ceil(box.width), 80, 420),
      height: clamp(Math.ceil(box.height + 20), 52, 260),
    };
  }

  if (type === "predefinedProcess") {
    const box = labelBox(node, fontSize, 34);
    return {
      width: clamp(Math.ceil(box.width), 90, 440),
      height: clamp(Math.ceil(box.height), 40, 240),
    };
  }

  if (type === "dataStore") {
    const box = labelBox(node, fontSize, 18);
    return {
      width: clamp(Math.ceil(box.width), 90, 440),
      height: clamp(Math.ceil(box.height), 40, 240),
    };
  }

  if (type === "io") {
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width * 1.3), 90, 440),
      height: clamp(Math.ceil(box.height), 40, 240),
    };
  }

  if (type === "actor") {
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width), 56, 260),
      height: clamp(Math.ceil(box.height + 34), 76, 260),
    };
  }

  if (type === "text") {
    const box = labelBox(node, fontSize);
    return {
      width: clamp(Math.ceil(box.width), 32, 460),
      height: clamp(Math.ceil(box.height), 28, 240),
    };
  }

  // Plain boxes (process, rectangle, package, data stores …) plus the members
  // that generic nodes print underneath their label.
  const box = labelBox(node, fontSize);
  const attrsW = widest(attrs, 10);
  const attrsH = attrs.length ? attrs.length * 13 + 6 : 0;
  return {
    width: clamp(Math.ceil(Math.max(box.width, attrsW + 16)), MIN_WIDTH, 460),
    height: clamp(Math.ceil(box.height + attrsH), MIN_HEIGHT, 560),
  };
}

/** Returns a copy of `node` with its box fitted to its text. */
export function fittedNode(node) {
  const size = measureNode(node);
  if (!size) return node;
  return { ...node, size, autoSize: true };
}

export function fitDiagram(diagram) {
  return { ...diagram, nodes: (diagram.nodes || []).map(fittedNode) };
}
