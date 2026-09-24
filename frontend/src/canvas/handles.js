/**
 * Connection anchors.
 *
 * Every shape exposes the same anchor grid — four sides, each with as many
 * slots as that side needs. Edges are assigned so a side carries a single
 * arrow whenever possible and extra arrows spread across the remaining sides,
 * instead of every line leaving (or entering) the shape through one point.
 *
 * Outgoing and incoming arrows share the grid: a side holds one arrow, whether
 * it leaves from there or arrives there.
 */

export const SIDES = ["top", "right", "bottom", "left"];

// React Flow's Position enum values are exactly these strings, so the side name
// doubles as the handle position.
export const SIDE_POSITION = { top: "top", right: "right", bottom: "bottom", left: "left" };

/** Handle ids used before the anchor grid existed. */
const LEGACY_SIDES = { t: "top", b: "bottom", l: "left", r: "right" };

export function anchorId(side, slot) {
  return `${side}-${slot}`;
}

/** Where a slot sits along its side, as a CSS percentage. */
export function slotPercent(slot, count) {
  if (count <= 1) return 50;
  return Math.round(((slot + 1) / (count + 1)) * 1000) / 10;
}

/** The side a stored handle id belongs to, if it is one of ours. */
export function sideOfAnchor(handleId) {
  if (!handleId) return null;
  const name = String(handleId).split("-")[0].toLowerCase();
  if (SIDES.includes(name)) return name;
  return LEGACY_SIDES[name] || null;
}

function centerOf(node) {
  return {
    x: (node.position?.x || 0) + (node.size?.width || 0) / 2,
    y: (node.position?.y || 0) + (node.size?.height || 0) / 2,
  };
}

/** The sides an arrow naturally leaves from and arrives at. */
function preferredSides(from, to) {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { out: "right", in: "left" } : { out: "left", in: "right" };
  }
  return dy >= 0 ? { out: "bottom", in: "top" } : { out: "top", in: "bottom" };
}

/**
 * Pick the side and slot for one endpoint: an unused side always wins, then the
 * least crowded side, breaking ties towards the arrow's natural direction.
 */
function nextAnchor(counts, preferred) {
  const order = [preferred, ...SIDES.filter((side) => side !== preferred)];
  let side = order[0];
  let used = Infinity;
  for (const candidate of order) {
    const count = counts[candidate] || 0;
    if (count < used) {
      used = count;
      side = candidate;
      if (count === 0) break;
    }
  }
  const slot = used === Infinity ? 0 : used;
  return { side, slot };
}

/**
 * Assign every edge endpoint an anchor.
 *
 * Returns the handle ids per edge plus, per node, how many slots each side
 * carries so the node can render exactly those handles.
 */
export function planAnchors(diagram) {
  const nodes = diagram.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const counts = new Map(); // nodeId -> { side: slots used }
  const anchors = new Map(); // edgeId -> { sourceHandle, targetHandle }

  const sideCounts = (nodeId) => {
    let entry = counts.get(nodeId);
    if (!entry) {
      entry = {};
      counts.set(nodeId, entry);
    }
    return entry;
  };

  for (const edge of diagram.edges || []) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const natural = preferredSides(source, target);

    const outCounts = sideCounts(source.id);
    const out = nextAnchor(outCounts, sideOfAnchor(edge.sourceHandle) || natural.out);
    outCounts[out.side] = out.slot + 1;

    const inCounts = sideCounts(target.id);
    const into = nextAnchor(inCounts, sideOfAnchor(edge.targetHandle) || natural.in);
    inCounts[into.side] = into.slot + 1;

    anchors.set(edge.id, {
      sourceHandle: anchorId(out.side, out.slot),
      targetHandle: anchorId(into.side, into.slot),
    });
  }

  return { anchors, counts };
}
