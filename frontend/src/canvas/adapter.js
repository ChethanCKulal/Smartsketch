import { MarkerType } from "@xyflow/react";

export function diagramToFlow(diagram) {
  const nodes = (diagram.nodes || []).map((node) => ({
    id: node.id,
    type: "diagramNode",
    position: { ...node.position },
    data: { canonical: node },
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

  const edges = (diagram.edges || []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
    label: edge.label,
    type: "diagramEdge",
    data: { canonical: edge },
    style: {
      stroke: edge.style?.border || "#8fb4d9",
      strokeWidth: edge.style?.borderWidth || 1.6,
      strokeDasharray: dash(edge.lineStyle || edge.style?.lineStyle),
    },
    markerEnd: marker(edge.arrow || edge.style?.arrow),
    markerStart: startMarker(edge.arrow || edge.style?.arrow),
  }));

  return { nodes, edges };
}

function dash(lineStyle) {
  if (lineStyle === "dashed") return "8 6";
  if (lineStyle === "dotted") return "2 4";
  return undefined;
}

function marker(arrow) {
  if (arrow === "none") return undefined;
  if (arrow === "backward") return undefined;
  return { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#8fb4d9" };
}

function startMarker(arrow) {
  if (arrow === "both" || arrow === "backward") {
    return { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#8fb4d9" };
  }
  return undefined;
}

export function flowNodesToPositions(nodes) {
  return nodes.map((n) => ({
    id: n.id,
    position: { x: n.position.x, y: n.position.y },
  }));
}
