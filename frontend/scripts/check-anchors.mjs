/**
 * Sanity checks for the anchor planner (node scripts/check-anchors.mjs).
 *
 * Every arrow must land on its own point: no two arrows share a node side slot,
 * and a shape spreads its arrows over all four sides before doubling up.
 */

import assert from "node:assert/strict";
import { planAnchors } from "../src/canvas/handles.js";

const node = (id, x, y, w = 120, h = 60) => ({
  id,
  type: "entity",
  label: id,
  position: { x, y },
  size: { width: w, height: h },
});

// A hub with four arrows heading right, like a DFD external entity.
const hub = {
  diagram_type: "dfd",
  nodes: [node("hub", 0, 300), node("a", 500, 0), node("b", 500, 200), node("c", 500, 400), node("d", 500, 600)],
  edges: ["a", "b", "c", "d"].map((t, i) => ({ id: `e${i}`, source: "hub", target: t })),
};
const hubPlan = planAnchors(hub);
const hubHandles = ["e0", "e1", "e2", "e3"].map((id) => hubPlan.anchors.get(id).sourceHandle);
assert.equal(new Set(hubHandles).size, 4, `hub arrows must not share a point: ${hubHandles}`);
assert.deepEqual(hubPlan.counts.get("hub"), { right: 1, top: 1, bottom: 1, left: 1 });

// Past four arrows, the extra ones get their own slot on the busiest side.
const overflow = {
  ...hub,
  nodes: [...hub.nodes, node("e", 500, 800), node("f", 500, 1000)],
  edges: [...hub.edges, { id: "e4", source: "hub", target: "e" }, { id: "e5", source: "hub", target: "f" }],
};
const overflowPlan = planAnchors(overflow);
const overflowHandles = ["e0", "e1", "e2", "e3", "e4", "e5"].map((id) => overflowPlan.anchors.get(id).sourceHandle);
assert.equal(new Set(overflowHandles).size, 6, `overflow arrows must stay distinct: ${overflowHandles}`);
assert.deepEqual(overflowPlan.counts.get("hub"), { right: 2, top: 1, bottom: 2, left: 1 });

// Ends never share a slot with each other either, on either side of the arrow.
const incoming = {
  diagram_type: "er",
  nodes: [node("mid", 400, 0), node("x", 0, 0), node("y", 0, 200), node("z", 0, 400)],
  edges: [
    { id: "i1", source: "x", target: "mid" },
    { id: "i2", source: "y", target: "mid" },
    { id: "i3", source: "z", target: "mid" },
  ],
};
const incomingPlan = planAnchors(incoming);
const targets = ["i1", "i2", "i3"].map((id) => incomingPlan.anchors.get(id).targetHandle);
assert.equal(new Set(targets).size, 3, `incoming arrows must not share a point: ${targets}`);

// A stored side from an earlier session is respected as the preference.
const pinned = {
  diagram_type: "er",
  nodes: [node("a", 0, 0), node("b", 400, 0), node("c", 0, 300)],
  edges: [
    { id: "p1", source: "a", target: "b", sourceHandle: "top-0", targetHandle: "bottom-0" },
    { id: "p2", source: "a", target: "c" },
  ],
};
const pinnedPlan = planAnchors(pinned);
assert.equal(pinnedPlan.anchors.get("p1").sourceHandle, "top-0");
assert.equal(pinnedPlan.anchors.get("p2").sourceHandle, "bottom-0");

console.log("anchor planner checks passed");
