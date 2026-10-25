/**
 * Shapes that are drawn rather than styled.
 *
 * Polygons and curved outlines are painted as SVG inside the node's box, so the
 * border follows the outline and the label is never clipped. The same art feeds
 * the shape-library previews, which keeps a preview honest about what will
 * appear on the canvas.
 *
 * Every path lives in a 0..100 box and is stretched to the node's size, exactly
 * like the flowchart decision always was.
 */

const DIAMOND = "M50 0 L100 50 L50 100 L0 50 Z";

export const SHAPE_ART = {
  // Flowchart
  decision: { body: DIAMOND },

  // ER
  relationship: { body: DIAMOND },

  // General polygons
  diamond: { body: DIAMOND },
  triangle: { body: "M50 0 L100 100 H0 Z" },
  invertedTriangle: { body: "M0 0 H100 L50 100 Z" },
  hexagon: { body: "M25 0 H75 L100 50 L75 100 H25 L0 50 Z" },
  pentagon: { body: "M50 0 L100 38 L81 100 L19 100 L0 38 Z" },
  octagon: { body: "M30 0 H70 L100 30 V70 L70 100 H30 L0 70 V30 Z" },
  parallelogram: { body: "M15 0 H100 L85 100 H0 Z" },
  trapezoid: { body: "M20 0 H80 L100 100 H0 Z" },
  star: {
    body: "M50 0 L61.8 33.8 L97.6 34.6 L69 56.2 L79.4 90.5 L50 70 L20.6 90.5 L31 56.2 L2.5 34.6 L38.2 33.8 Z",
  },
  cloud: {
    body: "M24 82 C10 82 2 68 12 58 C6 44 20 32 34 38 C40 22 62 20 70 34 C86 28 100 42 94 56 C104 68 94 84 78 82 Z",
  },
  callout: {
    body: "M8 6 C8 2 11 0 15 0 H85 C89 0 92 2 92 6 V64 C92 68 89 70 85 70 H56 L36 94 L38 70 H15 C11 70 8 68 8 64 Z",
  },
  stickyNote: {
    body: "M0 0 H70 L100 30 V100 H0 Z",
    detail: ["M70 0 V30 H100"],
  },

  // Flowchart input/output is a parallelogram, as in the notation.
  io: { body: "M15 0 H100 L85 100 H0 Z" },
  // Manual operation: a trapezoid narrowing towards the bottom.
  manualOperation: { body: "M0 0 H100 L80 100 H20 Z" },
  // Preparation: the hexagon used for setup steps.
  preparation: { body: "M25 0 H75 L100 50 L75 100 H25 L0 50 Z" },
  // On-page connector: the small circle that continues a flow elsewhere.
  connector: { body: "M0 50 A50 50 0 1 1 100 50 A50 50 0 1 1 0 50 Z" },
  // Off-page connector: the home plate that leaves the page.
  offPageConnector: { body: "M0 0 H70 L100 50 L70 100 H0 Z" },

  // Documents
  document: {
    body: "M0 0 H100 V86 C75 98 50 74 25 86 C15 91 7 88 0 86 Z",
  },
  multipleDocument: {
    bodies: [
      "M14 0 H96 V70 C78 80 62 62 50 68 C40 73 28 76 14 70 Z",
      "M0 16 H78 V90 C60 100 44 82 32 88 C22 93 10 96 0 90 Z",
    ],
  },

  // Storage
  database: {
    body: "M0 12 A50 12 0 0 0 100 12 V88 A50 12 0 0 1 0 88 Z",
    detail: ["M0 12 A50 12 0 0 1 100 12"],
  },

  // UML
  package: { body: "M0 12 H32 V0 H64 V12 H100 V100 H0 Z" },
};

export function hasShapeArt(type) {
  return Boolean(SHAPE_ART[type]);
}

/** Shapes drawn with a plain CSS box keep their corner radius here. */
export function boxRadius(type) {
  if (type === "ellipse" || type === "usecase" || type === "attribute" || type === "terminator") return "50%";
  if (type === "roundedRectangle" || type === "process" || type === "dfdProcess") return 18;
  if (type === "package") return 4;
  if (type === "predefinedProcess") return 2;
  return 4;
}
