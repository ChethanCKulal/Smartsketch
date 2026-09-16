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

  // Build a lookup for source/target positions to auto-select best handles.
  const nodeMap = new Map();
  for (const n of nodes) {
    const c = n.data.canonical;
    nodeMap.set(n.id, {
      cx: (c.position?.x || 0) + (c.size?.width || 160) / 2,
      cy: (c.position?.y || 0) + (c.size?.height || 80) / 2,
    });
  }

  const edges = (diagram.edges || []).map((edge) => {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    // Auto-select handles when not explicitly stored (recognition / chatbot).
    let sourceHandle = edge.sourceHandle || undefined;
    let targetHandle = edge.targetHandle || undefined;
    if (src && tgt && !sourceHandle && !targetHandle) {
      const dx = tgt.cx - src.cx;
      const dy = tgt.cy - src.cy;
      if (Math.abs(dx) >= Math.abs(dy)) {
        sourceHandle = dx >= 0 ? "r" : "l";
        targetHandle = dx >= 0 ? "l" : "r";
      } else {
        // top/bottom use React Flow default handle id (undefined)
        sourceHandle = undefined;
        targetHandle = undefined;
      }
    }
    return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle,
    targetHandle,
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
