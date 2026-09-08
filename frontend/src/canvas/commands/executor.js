import { ACTIONS } from "./types";
import {
  createCanonicalEdge,
  createCanonicalNode,
  emptyDiagram,
  validateDiagram,
} from "../../schema/canonical";

function findNode(diagram, predicate) {
  return diagram.nodes.find(predicate);
}

function byLabel(diagram, label) {
  const needle = String(label || "").trim().toLowerCase();
  return diagram.nodes.find((n) => n.label.trim().toLowerCase() === needle);
}

function byType(diagram, type) {
  return diagram.nodes.filter((n) => n.type === type);
}

export function applyCommand(diagram, command) {
  const action = command.action;
  const payload = command.payload || {};
  const next = structuredClone(diagram);

  switch (action) {
    case ACTIONS.ADD_NODE: {
      const node = createCanonicalNode(payload);
      next.nodes.push(node);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Added ${node.label}.`, result: node };
    }
    case ACTIONS.DELETE_NODE: {
      const id = payload.id || byLabel(next, payload.label)?.id;
      if (!id) return { ok: false, diagram, error: "Node not found." };
      next.nodes = next.nodes.filter((n) => n.id !== id && n.parentId !== id);
      next.edges = next.edges.filter((e) => e.source !== id && e.target !== id);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: "Deleted node." };
    }
    case ACTIONS.DELETE_SELECTION: {
      const ids = new Set(payload.ids || []);
      if (!ids.size) return { ok: false, diagram, error: "Nothing selected." };
      next.nodes = next.nodes.filter((n) => !ids.has(n.id) && !ids.has(n.parentId));
      const remaining = new Set(next.nodes.map((n) => n.id));
      next.edges = next.edges.filter(
        (e) => !ids.has(e.id) && remaining.has(e.source) && remaining.has(e.target)
      );
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: "Deleted selection." };
    }
    case ACTIONS.MOVE_NODE: {
      const node = payload.id ? next.nodes.find((n) => n.id === payload.id) : byLabel(next, payload.label);
      if (!node) return { ok: false, diagram, error: "Node not found." };
      if (node.locked) return { ok: false, diagram, error: `${node.label} is locked.` };
      const delta = payload.delta || { x: 0, y: 0 };
      node.position.x += delta.x ?? 0;
      node.position.y += delta.y ?? 0;
      if (payload.position) {
        node.position.x = payload.position.x;
        node.position.y = payload.position.y;
      }
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Moved ${node.label}.` };
    }
    case ACTIONS.MOVE_NODES: {
      for (const item of payload.moves || []) {
        const node = next.nodes.find((n) => n.id === item.id);
        if (node && !node.locked) node.position = { ...item.position };
      }
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next };
    }
    case ACTIONS.RESIZE_NODE: {
      const node = payload.id ? next.nodes.find((n) => n.id === payload.id) : byLabel(next, payload.label);
      if (!node) return { ok: false, diagram, error: "Node not found." };
      if (node.locked) return { ok: false, diagram, error: `${node.label} is locked.` };
      node.size.width = Math.max(40, payload.size?.width ?? node.size.width * (payload.scale || 1.2));
      node.size.height = Math.max(28, payload.size?.height ?? node.size.height * (payload.scale || 1.2));
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Resized ${node.label}.` };
    }
    case ACTIONS.EDIT_TEXT: {
      const node = payload.id ? next.nodes.find((n) => n.id === payload.id) : byLabel(next, payload.from);
      if (!node) return { ok: false, diagram, error: "Node not found." };
      node.label = payload.label ?? payload.to ?? node.label;
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Renamed to ${node.label}.` };
    }
    case ACTIONS.UPDATE_NODE: {
      const node = next.nodes.find((n) => n.id === payload.id);
      if (!node) return { ok: false, diagram, error: "Node not found." };
      Object.assign(node, payload.patch || {});
      if (payload.patch?.style) node.style = { ...node.style, ...payload.patch.style };
      if (payload.patch?.position) node.position = { ...node.position, ...payload.patch.position };
      if (payload.patch?.size) node.size = { ...node.size, ...payload.patch.size };
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next };
    }
    case ACTIONS.CONNECT: {
      const source = payload.sourceId
        ? next.nodes.find((n) => n.id === payload.sourceId)
        : byLabel(next, payload.source);
      const target = payload.targetId
        ? next.nodes.find((n) => n.id === payload.targetId)
        : byLabel(next, payload.target);
      if (!source || !target) return { ok: false, diagram, error: "Could not find both nodes to connect." };
      const exists = next.edges.some((e) => e.source === source.id && e.target === target.id);
      if (exists) return { ok: false, diagram, error: "Those nodes are already connected." };
      const edge = createCanonicalEdge({
        source: source.id,
        target: target.id,
        label: payload.label || "",
        arrow: payload.arrow || "forward",
      });
      next.edges.push(edge);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Connected ${source.label} to ${target.label}.` };
    }
    case ACTIONS.DISCONNECT: {
      if (payload.id) {
        next.edges = next.edges.filter((e) => e.id !== payload.id);
      } else {
        const source = byLabel(next, payload.source);
        const target = byLabel(next, payload.target);
        if (!source || !target) return { ok: false, diagram, error: "Could not find both nodes." };
        next.edges = next.edges.filter(
          (e) => !(e.source === source.id && e.target === target.id) && !(e.source === target.id && e.target === source.id)
        );
      }
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: "Disconnected." };
    }
    case ACTIONS.UPDATE_EDGE: {
      const edge = next.edges.find((e) => e.id === payload.id);
      if (!edge) return { ok: false, diagram, error: "Edge not found." };
      Object.assign(edge, payload.patch || {});
      if (payload.patch?.style) edge.style = { ...edge.style, ...payload.patch.style };
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next };
    }
    case ACTIONS.RECOLOR: {
      const node = payload.id ? next.nodes.find((n) => n.id === payload.id) : byLabel(next, payload.label);
      if (!node) return { ok: false, diagram, error: "Node not found." };
      node.style.fill = payload.fill || payload.color || node.style.fill;
      if (payload.border) node.style.border = payload.border;
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Recolored ${node.label}.` };
    }
    case ACTIONS.CHANGE_TYPE: {
      const node = payload.id
        ? next.nodes.find((n) => n.id === payload.id)
        : payload.label
          ? byLabel(next, payload.label)
          : byType(next, payload.fromType)?.[0];
      if (!node) return { ok: false, diagram, error: "Node not found." };
      node.type = payload.type;
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Changed ${node.label} to ${payload.type}.` };
    }
    case ACTIONS.GROUP: {
      const ids = payload.ids || [];
      if (ids.length < 2) return { ok: false, diagram, error: "Select at least two nodes to group." };
      const members = next.nodes.filter((n) => ids.includes(n.id));
      const minX = Math.min(...members.map((n) => n.position.x));
      const minY = Math.min(...members.map((n) => n.position.y));
      const maxX = Math.max(...members.map((n) => n.position.x + n.size.width));
      const maxY = Math.max(...members.map((n) => n.position.y + n.size.height));
      const group = createCanonicalNode({
        type: "group",
        label: payload.label || "Group",
        position: { x: minX - 16, y: minY - 36 },
        size: { width: maxX - minX + 32, height: maxY - minY + 52 },
        style: { fill: "rgba(40,58,82,0.35)", border: "#5d7ea3", color: "#c5d4e6" },
      });
      for (const node of members) {
        node.parentId = group.id;
        node.position = {
          x: node.position.x - group.position.x,
          y: node.position.y - group.position.y,
        };
      }
      next.nodes.unshift(group);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: "Grouped selection.", result: group };
    }
    case ACTIONS.UNGROUP: {
      const groupIds = payload.ids || [];
      const groups = next.nodes.filter((n) => n.type === "group" && groupIds.includes(n.id));
      if (!groups.length) return { ok: false, diagram, error: "No group selected." };
      for (const group of groups) {
        for (const child of next.nodes.filter((n) => n.parentId === group.id)) {
          child.parentId = null;
          child.position = {
            x: child.position.x + group.position.x,
            y: child.position.y + group.position.y,
          };
        }
      }
      const remove = new Set(groups.map((g) => g.id));
      next.nodes = next.nodes.filter((n) => !remove.has(n.id));
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: "Ungrouped." };
    }
    case ACTIONS.LOCK:
    case ACTIONS.UNLOCK: {
      const locked = action === ACTIONS.LOCK;
      const ids = payload.ids || [];
      for (const node of next.nodes) {
        if (ids.includes(node.id)) node.locked = locked;
      }
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: locked ? "Locked." : "Unlocked." };
    }
    case ACTIONS.SET_DIAGRAM_TYPE: {
      next.diagram_type = payload.diagram_type;
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next };
    }
    case ACTIONS.LOAD_DIAGRAM: {
      const check = validateDiagram(payload.diagram);
      if (!check.ok) return { ok: false, diagram, error: check.errors.join(" ") };
      const loaded = {
        ...emptyDiagram(payload.diagram.diagram_type),
        ...payload.diagram,
        nodes: (payload.diagram.nodes || []).map((n) => createCanonicalNode(n)),
        edges: (payload.diagram.edges || []).filter((e) => e.source && e.target).map((e) => createCanonicalEdge(e)),
      };
      loaded.meta = { ...emptyDiagram().meta, ...(payload.diagram.meta || {}) };
      return { ok: true, diagram: loaded, message: "Diagram loaded." };
    }
    case ACTIONS.PASTE: {
      const idMap = {};
      const offset = payload.offset || { x: 32, y: 32 };
      const copies = (payload.nodes || []).map((n) => {
        const copy = createCanonicalNode({
          ...n,
          id: undefined,
          position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
          parentId: null,
        });
        idMap[n.id] = copy.id;
        return copy;
      });
      const edges = (payload.edges || [])
        .filter((e) => idMap[e.source] && idMap[e.target])
        .map((e) =>
          createCanonicalEdge({
            ...e,
            id: undefined,
            source: idMap[e.source],
            target: idMap[e.target],
          })
        );
      next.nodes.push(...copies);
      next.edges.push(...edges);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: "Pasted.", result: { nodes: copies, edges } };
    }
    case ACTIONS.ADD_ATTRIBUTE: {
      const node = payload.id ? next.nodes.find((n) => n.id === payload.id) : byLabel(next, payload.label);
      if (!node) return { ok: false, diagram, error: "Entity not found." };
      const name = String(payload.attribute || "").trim();
      if (!name) return { ok: false, diagram, error: "Attribute name is empty." };
      if (!node.attributes.includes(name)) node.attributes.push(name);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Added ${name} to ${node.label}.` };
    }
    case ACTIONS.DELETE_ATTRIBUTE: {
      const node = payload.id ? next.nodes.find((n) => n.id === payload.id) : byLabel(next, payload.label);
      if (!node) return { ok: false, diagram, error: "Entity not found." };
      const name = String(payload.attribute || "").trim().toLowerCase();
      node.attributes = node.attributes.filter((a) => a.toLowerCase() !== name);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Removed attribute from ${node.label}.` };
    }
    default:
      return { ok: false, diagram, error: `Unknown action: ${action}` };
  }
}

export { findNode };
