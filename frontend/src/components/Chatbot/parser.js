import { ACTIONS } from "../../canvas/commands/types";

const COLORS = {
  red: "#8b3a3a",
  blue: "#2a4a72",
  green: "#2f5a45",
  yellow: "#7a6a2a",
  orange: "#7a4a28",
  purple: "#4a3a72",
  gray: "#3a4554",
  grey: "#3a4554",
  white: "#dce6f2",
  black: "#121820",
};

const TYPE_ALIASES = {
  rectangle: "rectangle",
  box: "rectangle",
  "rounded rectangle": "roundedRectangle",
  ellipse: "ellipse",
  circle: "ellipse",
  oval: "ellipse",
  diamond: "diamond",
  decision: "decision",
  triangle: "triangle",
  hexagon: "hexagon",
  parallelogram: "parallelogram",
  "input/output": "io",
  io: "io",
  process: "process",
  terminator: "terminator",
  document: "document",
  database: "database",
  class: "class",
  interface: "interface",
  package: "package",
  actor: "actor",
  "use case": "usecase",
  usecase: "usecase",
  entity: "entity",
  attribute: "attribute",
  relationship: "relationship",
  "weak entity": "weakEntity",
  "data store": "dataStore",
  datastore: "dataStore",
  "external entity": "externalEntity",
  "data flow": "dataFlow",
};

function sanitize(input) {
  return String(input || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function parseChatCommand(raw) {
  const text = sanitize(raw);
  if (!text) return { ok: false, error: "Empty command." };
  const lower = text.toLowerCase();

  if (/^(undo|redo)$/.test(lower)) {
    return { ok: true, meta: { history: lower } };
  }

  let m = lower.match(/^add (.+?) (entity|process|class|actor|interface|package|attribute|relationship|terminator|decision|datastore|data store|external entity)$/);
  if (m) {
    const type = TYPE_ALIASES[m[2]] || m[2];
    return cmd(ACTIONS.ADD_NODE, { type, label: title(m[1]) });
  }

  m = lower.match(/^add (?:an? )?(.+)$/);
  if (m && !lower.includes(" attribute ")) {
    const alias = TYPE_ALIASES[m[1].trim()];
    if (alias) return cmd(ACTIONS.ADD_NODE, { type: alias, label: title(m[1]) });
    const parts = m[1].trim().split(/\s+/);
    const last = parts[parts.length - 1];
    const type = TYPE_ALIASES[last] || "entity";
    const label = TYPE_ALIASES[last] ? title(parts.slice(0, -1).join(" ") || last) : title(m[1]);
    return cmd(ACTIONS.ADD_NODE, { type, label });
  }

  m = lower.match(/^delete (?:the|a|an) ([a-z ]+)$/);
  if (m) {
    const type = TYPE_ALIASES[m[1].trim()];
    if (type) return cmd(ACTIONS.DELETE_BY_TYPE, { type });
  }

  m = lower.match(/^delete (.+) from (.+)$/);
  if (m) return cmd(ACTIONS.DELETE_ATTRIBUTE, { attribute: title(m[1]), label: title(m[2]) });

  m = lower.match(/^delete (.+)$/);
  if (m) return cmd(ACTIONS.DELETE_NODE, { label: title(m[1]) });

  m = lower.match(/^rename (.+) to (.+)$/);
  if (m) return cmd(ACTIONS.EDIT_TEXT, { from: title(m[1]), to: title(m[2]) });

  m = lower.match(/^add (.+) attribute to (.+)$/);
  if (m) return cmd(ACTIONS.ADD_ATTRIBUTE, { attribute: title(m[1]), label: title(m[2]) });

  m = lower.match(/^connect (.+) to (.+)$/);
  if (m) return cmd(ACTIONS.CONNECT, { source: title(m[1]), target: title(m[2]) });

  m = lower.match(/^disconnect (.+) from (.+)$/);
  if (m) return cmd(ACTIONS.DISCONNECT, { source: title(m[1]), target: title(m[2]) });

  m = lower.match(/^move (.+) (left|right|up|down|above|below)(?: (.+))?$/);
  if (m) {
    const dir = m[2];
    const other = m[3] ? title(m[3].replace(/^(of|to|from)\s+/, "")) : null;
    const delta = {
      left: { x: -80, y: 0 },
      right: { x: 80, y: 0 },
      up: { x: 0, y: -80 },
      down: { x: 0, y: 80 },
      above: { x: 0, y: -140 },
      below: { x: 0, y: 140 },
    }[dir];
    return cmd(ACTIONS.MOVE_NODE, { label: title(m[1]), delta, relativeTo: other, direction: dir });
  }

  m = lower.match(/^resize (.+)$/);
  if (m) return cmd(ACTIONS.RESIZE_NODE, { label: title(m[1]), scale: 1.25 });

  m = lower.match(/^change (.+) to ([a-z ]+)$/);
  if (m && !lower.includes("color")) {
    const type = TYPE_ALIASES[m[2].trim()];
    if (type) return cmd(ACTIONS.CHANGE_TYPE, { label: title(m[1]), type });
  }

  m = lower.match(/^change (.+) color(?: to ([a-z]+))?$/);
  if (m) {
    const color = COLORS[m[2] || "blue"] || COLORS.blue;
    return cmd(ACTIONS.RECOLOR, { label: title(m[1]), fill: color });
  }

  if (lower === "group" || lower === "group selection") return cmd(ACTIONS.GROUP, {});
  if (lower === "ungroup") return cmd(ACTIONS.UNGROUP, {});

  if (lower.startsWith("help")) {
    return {
      ok: true,
      help: true,
      message:
        "Commands: Add Student entity | Delete Student | Rename A to B | Add Name attribute to Student | Connect A to B | Move A left | Resize A | Change A to rectangle | Change A color to blue | Undo | Redo",
    };
  }

  return { ok: false, error: `Unrecognized command: "${text}". Type help for examples.` };
}

function cmd(action, payload) {
  return { ok: true, command: { action, payload } };
}

function title(value) {
  return String(value || "")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export { COLORS, TYPE_ALIASES };
