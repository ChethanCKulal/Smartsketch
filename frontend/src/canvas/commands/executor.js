import { ACTIONS } from "./types.js";
import {
  createCanonicalEdge,
  createCanonicalNode,
  emptyDiagram,
  enforceFamily,
  isUniversalShape,
  validateDiagram,
} from "../../schema/canonical.js";
import { measureNode } from "../autosize.js";
import { arrowFromMarkers } from "../connectors.js";

/**
 * Fit a node's box to the text it holds.
 *
 * Recognition sizes boxes from the photograph, so a shape can arrive far
 * taller than its text. Nodes the user resized by hand are left alone.
 */
function fitToText(node) {
  if (!node || node.autoSize === false || node.type === "group") return node;
  const size = measureNode(node);
  if (size) {
    node.size = size;
    node.autoSize = true;
  }
  return node;
}

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
  let payload = command.payload || {};
  const next = structuredClone(diagram);

  // The active diagram family owns the shape vocabulary: every command that
  // introduces or retypes a node passes through the family filter.
  if (next.diagram_type) {
    if (payload.type && action !== ACTIONS.LOAD_DIAGRAM) {
      // A general shape (cloud, sticky note, cylinder …) is legal in every
      // family; only notation-specific shapes are filtered.
      payload = {
        ...payload,
        type: isUniversalShape(payload.type)
          ? payload.type
          : enforceFamily(payload.type, next.diagram_type),
      };
    }
    if (action === ACTIONS.SET_DIAGRAM_TYPE && payload.diagram_type !== next.diagram_type) {
      // Retyping the whole diagram migrates notation shapes into the new family
      // and leaves general shapes alone.
      next.nodes = next.nodes.map((n) => ({
        ...n,
        type:
          n.type === "group" || isUniversalShape(n.type)
            ? n.type
            : enforceFamily(n.type, payload.diagram_type),
      }));
    }
  }

  switch (action) {
    case ACTIONS.ADD_NODE: {
      const node = fitToText(createCanonicalNode(payload));
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
    case ACTIONS.DELETE_BY_TYPE: {
      // "Delete the diamond" — resolve a type to a concrete node deterministically.
      const candidates = byType(next, payload.type);
      if (!candidates.length) return { ok: false, diagram, error: `No ${payload.type} found.` };
      const target = candidates[0];
      next.nodes = next.nodes.filter((n) => n.id !== target.id && n.parentId !== target.id);
      next.edges = next.edges.filter((e) => e.source !== target.id && e.target !== target.id);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Deleted ${target.label}.` };
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
      node.autoSize = false; // hand-resized shapes keep the size the user chose
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Resized ${node.label}.` };
    }
    case ACTIONS.EDIT_TEXT: {
      const node = payload.id ? next.nodes.find((n) => n.id === payload.id) : byLabel(next, payload.from);
      if (!node) return { ok: false, diagram, error: "Node not found." };
      node.label = payload.label ?? payload.to ?? node.label;
      fitToText(node);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Renamed to ${node.label}.` };
    }
    case ACTIONS.FIT_TEXT: {
      // Explicit refit: every shape (or just the selection) hugs its text.
      const ids = payload.ids?.length ? payload.ids : null;
      let fitted = 0;
      for (const node of next.nodes) {
        if (ids && !ids.includes(node.id)) continue;
        if (node.type === "group") continue;
        const size = measureNode(node);
        if (!size) continue;
        node.size = size;
        node.autoSize = true;
        fitted += 1;
      }
      if (!fitted) return { ok: false, diagram, error: "No shapes to fit." };
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Fitted ${fitted} shape${fitted === 1 ? "" : "s"} to their text.` };
    }
    case ACTIONS.UPDATE_NODE: {
      const node = next.nodes.find((n) => n.id === payload.id);
      if (!node) return { ok: false, diagram, error: "Node not found." };
      const patch = payload.patch || {};
      const mergedStyle = patch.style ? { ...node.style, ...patch.style } : null;
      Object.assign(node, patch);
      if (mergedStyle) node.style = mergedStyle;
      if (patch.position) node.position = { ...node.position, ...patch.position };
      if (payload.patch?.size) {
        node.size = { ...node.size, ...payload.patch.size };
        node.autoSize = false; // an explicit size wins over fitting to text
      } else if (["label", "attributes", "methods", "type"].some((key) => key in patch)) {
        // Retyping can change what the box has to hold (a class gains
        // compartments, an interface gains a prefix), so an auto-sized shape is
        // measured again. A shape the user resized by hand keeps its size.
        fitToText(node);
      }
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next };
    }
    case ACTIONS.UPDATE_NODES: {
      // One command for a style applied to a whole selection: a single undo
      // step, and no shape outside the selection is touched.
      const ids = new Set(payload.ids || []);
      const patch = payload.patch || {};
      let changed = 0;
      for (const node of next.nodes) {
        if (!ids.has(node.id) || node.locked) continue;
        // Merge before assigning: assigning the patch first would replace the
        // whole style object and drop every key the patch does not mention.
        const merged = patch.style ? { ...node.style, ...patch.style } : null;
        Object.assign(node, patch);
        if (merged) node.style = merged;
        if (patch.size) {
          node.size = { ...node.size, ...patch.size };
          node.autoSize = false;
        }
        changed += 1;
      }
      if (!changed) return { ok: false, diagram, error: "No editable shapes selected." };
      next.meta.updatedAt = new Date().toISOString();
      return {
        ok: true,
        diagram: next,
        message: `Updated ${changed} shape${changed === 1 ? "" : "s"}.`,
      };
    }
    case ACTIONS.CONNECT: {
      const source = payload.sourceId
        ? next.nodes.find((n) => n.id === payload.sourceId)
        : byLabel(next, payload.source);
      const target = payload.targetId
        ? next.nodes.find((n) => n.id === payload.targetId)
        : byLabel(next, payload.target);
      if (!source || !target) return { ok: false, diagram, error: "Could not find both nodes to connect." };
      if (source.id === target.id) {
        return { ok: false, diagram, error: "A node cannot connect to itself." };
      }
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
    case ACTIONS.RECONNECT: {
      // One reversible action so reconnecting an edge is a single undo step.
      const edge = next.edges.find((e) => e.id === payload.id);
      if (!edge) return { ok: false, diagram, error: "Edge not found." };
      const newSource = payload.sourceId || edge.source;
      const newTarget = payload.targetId || edge.target;
      const exists = next.edges.some(
        (e) => e.id !== edge.id && e.source === newSource && e.target === newTarget
      );
      if (exists) return { ok: false, diagram, error: "Those nodes are already connected." };
      edge.source = newSource;
      edge.target = newTarget;
      edge.sourceHandle = payload.sourceHandle || null;
      edge.targetHandle = payload.targetHandle || null;
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: "Reconnected edge." };
    }
    case ACTIONS.UPDATE_EDGE: {
      const edge = next.edges.find((e) => e.id === payload.id);
      if (!edge) return { ok: false, diagram, error: "Edge not found." };
      const patch = payload.patch || {};
      const mergedStyle = patch.style ? { ...edge.style, ...patch.style } : null;
      Object.assign(edge, patch);
      if (mergedStyle) edge.style = mergedStyle;
      if ("startMarker" in patch || "endMarker" in patch) {
        // Keep the legacy field honest so the backend SVG export draws the same
        // ends the canvas does.
        edge.arrow = arrowFromMarkers(edge.startMarker, edge.endMarker);
      }
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
        nodes: (payload.diagram.nodes || []).map((n) => {
          // Recognized shapes are pulled into the diagram's vocabulary; a shape
          // the user placed deliberately keeps the type they chose.
          const recognized = (n.sources?.length || 0) > 0 || typeof n.confidence === "number";
          const type = recognized ? enforceFamily(n.type, payload.diagram.diagram_type) : n.type;
          return fitToText(createCanonicalNode({ ...n, type }));
        }),
        edges: (payload.diagram.edges || []).filter((e) => e.source && e.target).map((e) => createCanonicalEdge(e)),
      };
      loaded.meta = { ...emptyDiagram().meta, ...(payload.diagram.meta || {}) };
      return { ok: true, diagram: loaded, message: "Diagram loaded." };
    }
    case ACTIONS.PASTE: {
      const idMap = {};
      const offset = payload.offset || { x: 32, y: 32 };
      const copies = (payload.nodes || []).map((n) => {
        const copy = fitToText(createCanonicalNode({
          ...n,
          id: undefined,
          position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
          parentId: null,
        }));
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
      fitToText(node);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Added ${name} to ${node.label}.` };
    }
    case ACTIONS.DELETE_ATTRIBUTE: {
      const node = payload.id ? next.nodes.find((n) => n.id === payload.id) : byLabel(next, payload.label);
      if (!node) return { ok: false, diagram, error: "Entity not found." };
      const name = String(payload.attribute || "").trim().toLowerCase();
      node.attributes = node.attributes.filter((a) => a.toLowerCase() !== name);
      fitToText(node);
      next.meta.updatedAt = new Date().toISOString();
      return { ok: true, diagram: next, message: `Removed attribute from ${node.label}.` };
    }
    default:
      return { ok: false, diagram, error: `Unknown action: ${action}` };
  }
}

export { findNode };
