/**
 * Shape and connector invariants (node scripts/check-shapes.mjs).
 *
 * The library, the renderer and the connectors all read the same registries.
 * These checks fail if a control could offer something the canvas cannot draw,
 * if a shape is registered twice, or if a family's notation drifts.
 */

import assert from "node:assert/strict";
import { SHAPE_LIBRARY, TYPE_LABELS, CATALOG_TYPES } from "../src/canvas/shapeCatalog.js";
import {
  FAMILY_NODE_TYPES,
  GENERAL_NODE_TYPES,
  NODE_TYPES,
  createCanonicalEdge,
  emptyDiagram,
  enforceFamily,
  isUniversalShape,
  shapesForFamily,
} from "../src/schema/canonical.js";
import { ACTIONS } from "../src/canvas/commands/types.js";
import { applyCommand } from "../src/canvas/commands/executor.js";
import { SHAPE_ART } from "../src/canvas/shapeGeometry.js";
import {
  CONNECTOR_PRESETS,
  DEFAULT_END_MARKER,
  DEFAULT_ROUTING,
  DEFAULT_START_MARKER,
  LINE_STYLES,
  MARKERS,
  MAX_MARKER_SIZE,
  MIN_MARKER_SIZE,
  MULTIPLICITIES,
  ROUTINGS,
  UML_RELATIONSHIPS,
  arrowFromMarkers,
  markerSpec,
  markersFromArrow,
  presetOf,
} from "../src/canvas/connectors.js";

/* ------------------------------------------------------------ library --- */

assert.equal(new Set(CATALOG_TYPES).size, CATALOG_TYPES.length, "a shape type is listed twice");

for (const type of CATALOG_TYPES) {
  assert.ok(NODE_TYPES.includes(type), `${type} is in the library but not a node type`);
  assert.ok(TYPE_LABELS[type], `${type} has no label`);
  assert.ok(
    GENERAL_NODE_TYPES.includes(type) || Object.values(FAMILY_NODE_TYPES).some((f) => f.includes(type)),
    `${type} belongs to no family and is not general`
  );
}

for (const type of NODE_TYPES) {
  if (type === "group") continue;
  assert.ok(CATALOG_TYPES.includes(type), `${type} is a node type but is not in the library`);
}

for (const type of GENERAL_NODE_TYPES) {
  assert.ok(CATALOG_TYPES.includes(type), `general shape ${type} is not in the library`);
  assert.ok(isUniversalShape(type), `${type} must be a universal shape`);
  for (const family of Object.keys(FAMILY_NODE_TYPES)) {
    assert.ok(shapesForFamily(family).includes(type), `${family} must offer ${type}`);
  }
}

for (const [family, types] of Object.entries(FAMILY_NODE_TYPES)) {
  for (const type of types) {
    assert.ok(CATALOG_TYPES.includes(type), `${family} offers ${type}, which is not in the library`);
  }
}

/* ----------------------------------------------------- family semantics --- */

const FLOWCHART = FAMILY_NODE_TYPES.flowchart;
assert.ok(FLOWCHART.includes("decision"), "a flowchart decision must exist");
assert.ok(FLOWCHART.includes("process"), "a flowchart process must exist");
assert.ok(FLOWCHART.includes("terminator"), "a flowchart terminator must exist");
assert.ok(FAMILY_NODE_TYPES.er.includes("entity"), "ER must offer an entity");
assert.ok(FAMILY_NODE_TYPES.er.includes("relationship"), "ER must offer a relationship");
assert.ok(FAMILY_NODE_TYPES.er.includes("attribute"), "ER must offer an attribute");
assert.ok(FAMILY_NODE_TYPES.uml.includes("class"), "UML must offer a class");
assert.ok(FAMILY_NODE_TYPES.uml.includes("interface"), "UML must offer an interface");
for (const type of ["dfdProcess", "dataStore", "externalEntity", "dataFlow"]) {
  assert.ok(FAMILY_NODE_TYPES.dfd.includes(type), `DFD must offer ${type}`);
}

// Shapes that carry a notation must be drawn as that notation, not as a box.
assert.equal(SHAPE_ART.decision.body, SHAPE_ART.diamond.body, "decision draws the diamond");
assert.equal(SHAPE_ART.relationship.body, SHAPE_ART.diamond.body, "ER relationship draws the diamond");
assert.equal(SHAPE_ART.io.body, SHAPE_ART.parallelogram.body, "input/output is a parallelogram");

// Generic shapes still map into an explicitly chosen family, so recognition
// output keeps its existing treatment.
assert.equal(enforceFamily("rectangle", "er"), "entity");
assert.equal(enforceFamily("ellipse", "flowchart"), "terminator");
assert.equal(enforceFamily("diamond", "er"), "relationship");
assert.equal(enforceFamily("class", "flowchart"), "process");

const offered = shapesForFamily("er");
assert.ok(offered.includes("entity") && offered.includes("cloud"), "a family offers its shapes and the general ones");
assert.equal(new Set(offered).size, offered.length, "shapesForFamily must not list a shape twice");

for (const [type, art] of Object.entries(SHAPE_ART)) {
  for (const d of [...(art.bodies || [art.body]), ...(art.detail || [])].filter(Boolean)) {
    assert.match(d, /^M/, `${type} has malformed geometry: ${d}`);
  }
}

/* --------------------------------------------------------- connectors --- */

assert.equal(new Set(MARKERS.map((m) => m.id)).size, MARKERS.length, "marker ids must be unique");
for (const marker of MARKERS) {
  if (marker.id === "none") continue;
  const hasGeometry =
    marker.shape === "circle"
      ? typeof marker.r === "number"
      : typeof marker.d === "string" && marker.d.startsWith("M");
  assert.ok(hasGeometry, `marker ${marker.id} has no drawable geometry`);
  assert.ok(["solid", "hollow", "none"].includes(marker.fill), `marker ${marker.id} has no fill mode`);
}

assert.equal(new Set(ROUTINGS.map((r) => r.id)).size, ROUTINGS.length, "routing ids must be unique");
assert.ok(ROUTINGS.some((r) => r.id === "straight"));
assert.ok(ROUTINGS.some((r) => r.id === "elbow"));
assert.ok(ROUTINGS.some((r) => r.id === "rounded"));
assert.ok(ROUTINGS.some((r) => r.id === "curved"));
assert.ok(LINE_STYLES.some((s) => s.id === "dashed") && LINE_STYLES.some((s) => s.id === "dotted"));

for (const preset of CONNECTOR_PRESETS) {
  assert.ok(ROUTINGS.some((r) => r.id === preset.routing), `${preset.id} uses an unknown routing`);
  assert.equal(markerSpec(preset.startMarker).id, preset.startMarker, `${preset.id} start marker`);
  assert.equal(markerSpec(preset.endMarker).id, preset.endMarker, `${preset.id} end marker`);
}

// All six connector kinds the editor advertises.
for (const kind of ["straight", "elbow", "rounded", "curved", "association", "bidirectional"]) {
  assert.ok(CONNECTOR_PRESETS.some((p) => p.id === kind), `missing connector preset ${kind}`);
}

for (const rel of UML_RELATIONSHIPS) {
  assert.equal(markerSpec(rel.startMarker).id, rel.startMarker, `${rel.id} start marker`);
  assert.equal(markerSpec(rel.endMarker).id, rel.endMarker, `${rel.id} end marker`);
  assert.ok(LINE_STYLES.some((s) => s.id === rel.lineStyle), `${rel.id} line style`);
}

// Inheritance and realization are hollow triangles; aggregation/composition are
// diamonds at the whole's end. These are the notations the labels promise.
const byId = Object.fromEntries(UML_RELATIONSHIPS.map((r) => [r.id, r]));
assert.equal(byId.inheritance.endMarker, "hollowTriangle");
assert.equal(byId.realization.endMarker, "hollowTriangle");
assert.equal(byId.aggregation.startMarker, "hollowDiamond");
assert.equal(byId.composition.startMarker, "diamond");
assert.equal(byId.dependency.lineStyle, "dashed");

assert.ok(MULTIPLICITIES.includes("*") && MULTIPLICITIES.includes("0..1"));

/* ----------------------------------------------------- edge persistence --- */

const legacy = createCanonicalEdge({ id: "e1", source: "a", target: "b", arrow: "forward" });
assert.equal(legacy.startMarker, "none");
assert.equal(legacy.endMarker, "arrow");
assert.equal(legacy.routing, DEFAULT_ROUTING);

assert.deepEqual(markersFromArrow("backward"), { startMarker: "arrow", endMarker: "none" });
assert.deepEqual(markersFromArrow("both"), { startMarker: "arrow", endMarker: "arrow" });
assert.deepEqual(markersFromArrow("none"), { startMarker: "none", endMarker: "none" });
for (const arrow of ["forward", "backward", "both", "none"]) {
  const markers = markersFromArrow(arrow);
  assert.equal(arrowFromMarkers(markers.startMarker, markers.endMarker), arrow);
}

// Start and end can differ, and every new field survives a save/reload cycle.
const custom = createCanonicalEdge({
  id: "e2",
  source: "a",
  target: "b",
  startMarker: "hollowDiamond",
  endMarker: "openArrow",
  routing: "curved",
  lineStyle: "dashed",
  markerSize: 22,
  sourceMultiplicity: "1",
  targetMultiplicity: "0..*",
  relationshipType: "aggregation",
});
assert.equal(custom.arrow, "both");
assert.notEqual(custom.startMarker, custom.endMarker);
const reloaded = createCanonicalEdge(custom);
assert.equal(reloaded.startMarker, "hollowDiamond");
assert.equal(reloaded.endMarker, "openArrow");
assert.equal(reloaded.routing, "curved");
assert.equal(reloaded.lineStyle, "dashed");
assert.equal(reloaded.markerSize, 22);
assert.equal(reloaded.sourceMultiplicity, "1");
assert.equal(reloaded.targetMultiplicity, "0..*");
assert.equal(reloaded.relationshipType, "aggregation");

assert.equal(presetOf(custom), "");
assert.equal(presetOf(legacy), "rounded", "a legacy arrow reads as the rounded-arrow preset");

// Marker size is clamped to what the panel offers.
assert.equal(createCanonicalEdge({ source: "a", target: "b", markerSize: 900 }).markerSize, MAX_MARKER_SIZE);
assert.equal(createCanonicalEdge({ source: "a", target: "b", markerSize: 1 }).markerSize, MIN_MARKER_SIZE);
assert.equal(createCanonicalEdge({ source: "a", target: "b" }).markerSize, 16);
assert.equal(DEFAULT_START_MARKER, "none");
assert.equal(DEFAULT_END_MARKER, "arrow");

/* ------------------------------------------------------- command layer --- */

// A universal shape dropped into any family keeps its type.
const dropped = applyCommand(emptyDiagram("er"), {
  action: ACTIONS.ADD_NODE,
  payload: { type: "cloud", label: "Notes", position: { x: 0, y: 0 } },
});
assert.ok(dropped.ok, dropped.error);
assert.equal(dropped.result.type, "cloud", "a general shape keeps its type in an ER diagram");

// A notation shape from another family is still filtered into the family.
const filtered = applyCommand(emptyDiagram("er"), {
  action: ACTIONS.ADD_NODE,
  payload: { type: "class", label: "Thing", position: { x: 0, y: 0 } },
});
assert.equal(filtered.result.type, "entity", "a foreign notation shape is remapped");

// Styling a selection never touches a shape outside it.
let styled = emptyDiagram("flowchart");
for (const [id, type] of [["n1", "process"], ["n2", "process"], ["n3", "decision"]]) {
  styled = applyCommand(styled, {
    action: ACTIONS.ADD_NODE,
    payload: { id, type, label: id, position: { x: 0, y: 0 } },
  }).diagram;
}
const beforeOthers = styled.nodes.filter((n) => n.id !== "n2").map((n) => ({ ...n.style }));
const restyle = applyCommand(styled, {
  action: ACTIONS.UPDATE_NODES,
  payload: { ids: ["n2"], patch: { style: { fill: "#ff0000" } } },
});
assert.ok(restyle.ok, restyle.error);
assert.equal(restyle.diagram.nodes.find((n) => n.id === "n2").style.fill, "#ff0000");
assert.deepEqual(
  restyle.diagram.nodes.filter((n) => n.id !== "n2").map((n) => ({ ...n.style })),
  beforeOthers,
  "a style must not leak to other shapes"
);
assert.equal(
  restyle.diagram.nodes.find((n) => n.id === "n2").style.border,
  styled.nodes.find((n) => n.id === "n2").style.border,
  "unset style keys keep their existing value"
);

// The bulk command is one diagram change, so undo can step back past it.
assert.equal(restyle.diagram.nodes.filter((n) => n.style.fill === "#ff0000").length, 1);

// Marker edits keep the legacy `arrow` field (used by the SVG export) in sync.
const withEdge = applyCommand(emptyDiagram("uml"), {
  action: ACTIONS.ADD_NODE,
  payload: { id: "a", type: "class", label: "A", position: { x: 0, y: 0 } },
}).diagram;
const connected = applyCommand(withEdge, {
  action: ACTIONS.ADD_NODE,
  payload: { id: "b", type: "class", label: "B", position: { x: 300, y: 0 } },
}).diagram;
const linked = applyCommand(connected, {
  action: ACTIONS.CONNECT,
  payload: { sourceId: "a", targetId: "b", label: "owns" },
}).diagram;
const edgeId = linked.edges[0].id;

const asymmetric = applyCommand(linked, {
  action: ACTIONS.UPDATE_EDGE,
  payload: { id: edgeId, patch: { startMarker: "hollowDiamond", endMarker: "openArrow" } },
}).diagram;
assert.equal(asymmetric.edges[0].startMarker, "hollowDiamond");
assert.equal(asymmetric.edges[0].endMarker, "openArrow");
assert.equal(asymmetric.edges[0].arrow, "both", "an arrow at either end keeps `arrow` honest");

const bare = applyCommand(asymmetric, {
  action: ACTIONS.UPDATE_EDGE,
  payload: { id: edgeId, patch: { startMarker: "none", endMarker: "none" } },
}).diagram;
assert.equal(bare.edges[0].arrow, "none");

const restored = applyCommand(bare, { action: ACTIONS.LOAD_DIAGRAM, payload: { diagram: bare } });
assert.ok(restored.ok, restored.error);
assert.equal(restored.diagram.edges[0].startMarker, "none");
assert.equal(restored.diagram.edges[0].endMarker, "none");
assert.equal(restored.diagram.edges[0].label, "owns");

// Recognition output is normalized into the family; a hand-placed shape is not.
const loaded = applyCommand(emptyDiagram("er"), {
  action: ACTIONS.LOAD_DIAGRAM,
  payload: {
    diagram: {
      ...emptyDiagram("er"),
      nodes: [
        {
          id: "r1",
          type: "rectangle",
          label: "Recognized",
          position: { x: 0, y: 0 },
          size: { width: 100, height: 50 },
          sources: ["gemini"],
          confidence: 0.8,
        },
        {
          id: "u1",
          type: "rectangle",
          label: "Drawn by hand",
          position: { x: 200, y: 0 },
          size: { width: 100, height: 50 },
        },
      ],
      edges: [],
    },
  },
});
assert.ok(loaded.ok, loaded.error);
assert.equal(loaded.diagram.nodes[0].type, "entity", "recognized shapes keep family normalization");
assert.equal(loaded.diagram.nodes[1].type, "rectangle", "a hand-placed shape keeps its type");

console.log("shape and connector checks passed");
