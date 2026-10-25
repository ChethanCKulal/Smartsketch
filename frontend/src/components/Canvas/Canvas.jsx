import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  SelectionMode,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import DiagramNode from "../../canvas/nodes/DiagramNode";
import DiagramEdge from "../../canvas/edges/DiagramEdge";
import { diagramToFlow } from "../../canvas/adapter";
import { ACTIONS } from "../../canvas/commands/types";
import { useDiagramStore } from "../../state/diagramStore";
import {
  canvasColor,
  gridColor,
  isLightColor,
  useUiStore,
} from "../../state/uiStore";
import { createCanonicalNode } from "../../schema/canonical";

const nodeTypes = { diagramNode: DiagramNode };
const edgeTypes = { diagramEdge: DiagramEdge };

const COMPARTMENT_SELECTOR = {
  title: ".class-title",
  attributes: ".class-attrs",
  methods: ".class-methods",
};

export default function Canvas() {
  const diagram = useDiagramStore((s) => s.diagram);
  const dispatch = useDiagramStore((s) => s.dispatch);
  const setSelection = useDiagramStore((s) => s.setSelection);
  const snapToGrid = useDiagramStore((s) => s.snapToGrid);
  const gridSize = useDiagramStore((s) => s.gridSize);
  const setZoom = useDiagramStore((s) => s.setZoom);
  const editingId = useDiagramStore((s) => s.editingNodeId);
  const editingCompartment = useDiagramStore((s) => s.editingCompartment);
  const setEditingNode = useDiagramStore((s) => s.setEditingNode);
  const canvasBackground = useUiStore((s) => s.canvasBackground);
  const theme = useUiStore((s) => s.theme);
  const gridVisible = useUiStore((s) => s.gridVisible);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, getZoom } = useReactFlow();
  const mapped = useMemo(() => diagramToFlow(diagram), [diagram]);
  const [nodes, setNodes] = useState(mapped.nodes);
  const [edges, setEdges] = useState(mapped.edges);
  const [menu, setMenu] = useState(null);

  const background = canvasColor(canvasBackground, theme);
  const transparent = background === "transparent";
  const grid = gridColor(canvasBackground, theme);

  // Replacing the canvas elements after an edit must not drop the selection:
  // otherwise the properties panel closes after the first change, which makes
  // adjusting a colour or a width impossible.
  useEffect(() => {
    setNodes((current) => {
      const selected = new Set(current.filter((n) => n.selected).map((n) => n.id));
      return mapped.nodes.map((n) => (selected.has(n.id) ? { ...n, selected: true } : n));
    });
    setEdges((current) => {
      const selected = new Set(current.filter((e) => e.selected).map((e) => e.id));
      return mapped.edges.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [mapped]);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/sketchcanvas");
      if (!raw) return;
      const item = JSON.parse(raw);
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      dispatch({
        action: ACTIONS.ADD_NODE,
        payload: createCanonicalNode({ type: item.type, label: item.label, position }),
      });
    },
    [dispatch, screenToFlowPosition]
  );

  const onConnect = useCallback(
    (connection) => {
      dispatch({
        action: ACTIONS.CONNECT,
        payload: {
          sourceId: connection.source,
          targetId: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
        },
      });
    },
    [dispatch]
  );

  const onNodesChange = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
    const dimensions = changes.filter((c) => c.type === "dimensions" && c.resizing === false && c.dimensions);
    for (const c of dimensions) {
      dispatch({
        action: ACTIONS.RESIZE_NODE,
        payload: { id: c.id, size: { width: c.dimensions.width, height: c.dimensions.height } },
      });
    }
  }, [dispatch]);

  const onEdgesChange = useCallback((changes) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onNodeDragStart = useCallback(() => {
    setEditingNode(null);
  }, [setEditingNode]);

  const onNodeDragStop = useCallback(
    (_e, _node, dragged) => {
      const moved = dragged.filter(
        (n) => !n.data?.canonical?.locked
      );
      if (!moved.length) return;
      dispatch({
        action: ACTIONS.MOVE_NODES,
        payload: { moves: moved.map((n) => ({ id: n.id, position: n.position })) },
      });
    },
    [dispatch]
  );

  const onSelectionChange = useCallback(
    ({ nodes: n, edges: e }) => {
      setSelection(
        n.map((x) => x.id),
        e.map((x) => x.id)
      );
    },
    [setSelection]
  );

  const onReconnect = useCallback(
    (oldEdge, newConnection) => {
      dispatch({
        action: ACTIONS.RECONNECT,
        payload: {
          id: oldEdge.id,
          sourceId: newConnection.source,
          targetId: newConnection.target,
          sourceHandle: newConnection.sourceHandle,
          targetHandle: newConnection.targetHandle,
        },
      });
    },
    [dispatch]
  );

  // Persist an inline edit through the shared command layer so it joins the
  // same undo history as chatbot renames. A UML compartment is written back to
  // its own field, never flattened into the label.
  const commitEdit = useCallback(
    (nodeId, compartment, value) => {
      setEditingNode(null);
      if (!nodeId) return;
      const canonical = useDiagramStore
        .getState()
        .diagram.nodes.find((n) => n.id === nodeId);
      if (!canonical) return;

      if (compartment === "attributes" || compartment === "methods") {
        const members = String(value)
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (JSON.stringify(members) === JSON.stringify(canonical[compartment] || [])) return;
        dispatch({
          action: ACTIONS.UPDATE_NODE,
          payload: { id: nodeId, patch: { [compartment]: members } },
        });
        return;
      }

      const label = String(value).trim();
      if (!label || canonical.label === label) return;
      dispatch({ action: ACTIONS.EDIT_TEXT, payload: { id: nodeId, label } });
    },
    [dispatch, setEditingNode]
  );

  useEffect(() => {
    window.__scFit = fitView;
    window.__scZoomIn = zoomIn;
    window.__scZoomOut = zoomOut;
    window.__scGetZoom = getZoom;
  }, [fitView, zoomIn, zoomOut, getZoom]);

  return (
    <div
      className={`canvas-wrap ${transparent ? "canvas-transparent" : ""}`}
      style={transparent ? undefined : { background }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={onDrop}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onClick={() => setMenu(null)}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onReconnect={onReconnect}
        // Loose mode lets any anchor start or receive an arrow, which is what
        // the single-handle-per-slot grid relies on.
        connectionMode={ConnectionMode.Loose}
        onSelectionChange={onSelectionChange}
        onMoveEnd={() => setZoom(getZoom())}
        snapToGrid={snapToGrid}
        snapGrid={[gridSize, gridSize]}
        selectionOnDrag
        panOnDrag={[1, 2]}
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        fitView
        minZoom={0.2}
        maxZoom={2.5}
        defaultEdgeOptions={{ type: "diagramEdge" }}
      >
        {gridVisible && <Background gap={gridSize} size={1} color={grid} />}
        <MiniMap
          pannable
          zoomable
          nodeColor="#4c8dff"
          maskColor={isLightColor(background) ? "rgba(248,250,253,0.72)" : "rgba(10,14,20,0.7)"}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            onClick={() => {
              const { selectedIds, selectedEdgeIds } = useDiagramStore.getState();
              dispatch({ action: ACTIONS.DELETE_SELECTION, payload: { ids: [...selectedIds, ...selectedEdgeIds] } });
              setMenu(null);
            }}
          >
            Delete
          </button>
          <button
            onClick={() => {
              const { selectedIds } = useDiagramStore.getState();
              dispatch({ action: ACTIONS.FIT_TEXT, payload: { ids: selectedIds } });
              setMenu(null);
            }}
          >
            Fit shapes to text
          </button>
          <button
            onClick={() => {
              window.__scFit?.();
              setMenu(null);
            }}
          >
            Fit to screen
          </button>
        </div>
      )}
      {editingId && (
        <InlineEditor
          key={`${editingId}:${editingCompartment || "label"}`}
          editingId={editingId}
          compartment={editingCompartment}
          onDone={commitEdit}
        />
      )}
    </div>
  );
}

/**
 * Floats an editor over the selected node (double-click to edit). A UML class
 * opens it on the compartment that was double-clicked: the title is one line,
 * attributes and methods are one member per line.
 * Lives outside React Flow so it never fights the node renderer for focus.
 */
function InlineEditor({ editingId, compartment, onDone }) {
  const diagram = useDiagramStore((s) => s.diagram);
  const node = diagram.nodes.find((n) => n.id === editingId);
  const multiLine = compartment === "attributes" || compartment === "methods";
  const initial = !node
    ? ""
    : multiLine
      ? (node[compartment] || []).join("\n")
      : node.label ?? "";
  const [value, setValue] = useState(initial);

  if (!node) return null;

  const commit = () => onDone(editingId, compartment, value);
  const cancel = () => onDone(null, null, "");

  return (
    <div
      className={`inline-edit ${multiLine ? "inline-edit-multi" : ""}`}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      ref={(el) => {
        if (!el || el.dataset.live === "1") return;
        el.dataset.live = "1";
        // Track the node (or the exact compartment) each frame so the editor
        // sticks to it while zooming.
        const tick = () => {
          if (!document.body.contains(el)) return;
          const dom = document.querySelector(`[data-id="${CSS.escape(editingId)}"]`);
          const target = dom && compartment
            ? dom.querySelector(COMPARTMENT_SELECTOR[compartment]) || dom
            : dom;
          if (target) {
            const r = target.getBoundingClientRect();
            el.style.left = `${r.left}px`;
            el.style.top = `${r.top}px`;
            el.style.width = `${r.width}px`;
            el.style.height = `${r.height}px`;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }}
    >
      {multiLine ? (
        <textarea
          autoFocus
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") cancel();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commit();
          }}
        />
      ) : (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
        />
      )}
    </div>
  );
}
