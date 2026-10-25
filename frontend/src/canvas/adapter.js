import { planAnchors } from "./handles";
import { dashArray } from "./connectors";

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
        strokeDasharray: dashArray(edge.lineStyle || edge.style?.lineStyle),
      },
    };
  });

  return { nodes, edges };
}

export function flowNodesToPositions(nodes) {
  return nodes.map((n) => ({
    id: n.id,
    position: { x: n.position.x, y: n.position.y },
  }));
}
