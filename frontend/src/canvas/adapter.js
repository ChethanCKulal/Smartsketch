import { MarkerType } from "@xyflow/react";
import { planAnchors } from "./handles";

export function diagramToFlow(diagram) {
  // Anchors are planned for the whole diagram at once: which side and slot each
  // arrow leaves from depends on the other arrows meeting the same shape.
  const plan = planAnchors(diagram);

  const nodes = (diagram.nodes || []).map((node) => ({
    id: node.id,
    type: "diagramNode",
    position: { ...node.position },
    data: { canonical: node, anchors: plan.counts.get(node.id) },
    parentId: node.parentId || undefined,
    extent: node.parentId ? "parent" : undefined,
    draggable: !node.locked,
    selectable: true,
    style: {
      width: node.size.width,
      height: node.size.height,
      opacity: node.style?.opacity ?? 1,
    },
    zIndex: node.type === "group" ? 0 : 1,
  }));

  const edges = (diagram.edges || []).map((edge) => {
    // A stored handle only expresses which side the user dragged from; the
    // planned anchor decides the exact slot on that side.
    const anchor = plan.anchors.get(edge.id) || {};
    return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: anchor.sourceHandle,
    targetHandle: anchor.targetHandle,
    label: edge.label,
    type: "diagramEdge",
    data: { canonical: edge },
    style: {
      stroke: edge.style?.border || "#8fb4d9",
      strokeWidth: edge.style?.borderWidth || 1.6,
      strokeDasharray: dash(edge.lineStyle || edge.style?.lineStyle),
    },
    markerEnd: marker(edge.arrow || edge.style?.arrow, edge.style?.border),
    markerStart: startMarker(edge.arrow || edge.style?.arrow, edge.style?.border),
  };
  });

  return { nodes, edges };
}

function dash(lineStyle) {
  if (lineStyle === "dashed") return "8 6";
  if (lineStyle === "dotted") return "2 4";
  return undefined;
}

function color(edgeColor) {
  return edgeColor || "#8fb4d9";
}

function marker(arrow, edgeColor) {
  if (arrow === "none" || arrow === "backward") return undefined;
  return { type: MarkerType.ArrowClosed, width: 16, height: 16, color: color(edgeColor) };
}

function startMarker(arrow, edgeColor) {
  if (arrow === "both" || arrow === "backward") {
    return { type: MarkerType.ArrowClosed, width: 16, height: 16, color: color(edgeColor) };
  }
  return undefined;
}

export function flowNodesToPositions(nodes) {
  return nodes.map((n) => ({
    id: n.id,
    position: { x: n.position.x, y: n.position.y },
  }));
}
