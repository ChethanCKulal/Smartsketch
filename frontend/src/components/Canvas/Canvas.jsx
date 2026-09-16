import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
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
import { createCanonicalNode } from "../../schema/canonical";

const nodeTypes = { diagramNode: DiagramNode };
const edgeTypes = { diagramEdge: DiagramEdge };

export default function Canvas() {
  const diagram = useDiagramStore((s) => s.diagram);
  const dispatch = useDiagramStore((s) => s.dispatch);
  const setSelection = useDiagramStore((s) => s.setSelection);
  const snapToGrid = useDiagramStore((s) => s.snapToGrid);
  const gridSize = useDiagramStore((s) => s.gridSize);
  const setZoom = useDiagramStore((s) => s.setZoom);
  const editingId = useDiagramStore((s) => s.editingNodeId);
  const setEditingId = useDiagramStore((s) => s.setEditingNodeId);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, getZoom } = useReactFlow();
  const mapped = useMemo(() => diagramToFlow(diagram), [diagram]);
  const [nodes, setNodes] = useState(mapped.nodes);
  const [edges, setEdges] = useState(mapped.edges);
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    setNodes(mapped.nodes);
    setEdges(mapped.edges);
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
    setEditingId(null);
  }, []);

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

  // Persist an inline label edit through the shared command layer so it joins
  // the same undo history as chatbot renames.
  const commitEdit = useCallback(
    (nodeId, label) => {
      setEditingId(null);
      if (!nodeId) return;
      const canonical = useDiagramStore
        .getState()
        .diagram.nodes.find((n) => n.id === nodeId);
      if (!canonical || canonical.label === label) return;
      dispatch({ action: ACTIONS.EDIT_TEXT, payload: { id: nodeId, label } });
    },
    [dispatch, setEditingId]
  );

  useEffect(() => {
    window.__scFit = fitView;
    window.__scZoomIn = zoomIn;
    window.__scZoomOut = zoomOut;
    window.__scGetZoom = getZoom;
  }, [fitView, zoomIn, zoomOut, getZoom]);

  return (
    <div
      className="canvas-wrap"
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
        <Background gap={gridSize} size={1} color="#243044" />
        <MiniMap pannable zoomable nodeColor="#4c8dff" maskColor="rgba(10,14,20,0.7)" />
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
        <InlineLabelEditor
          editingId={editingId}
          onDone={commitEdit}
        />
      )}
    </div>
  );
}

/**
 * Floats an input over the selected node (double-click to edit).
 * Lives outside React Flow so it never fights the node renderer for focus.
 */
function InlineLabelEditor({ editingId, onDone }) {
  const diagram = useDiagramStore((s) => s.diagram);
  const node = diagram.nodes.find((n) => n.id === editingId);
  const [value, setValue] = useState(node?.label ?? "");
  if (!node) return null;
  return (
    <div
      className="inline-edit"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      ref={(el) => {
        if (!el || el.dataset.live === "1") return;
        el.dataset.live = "1";
        // Track the node each frame so the editor sticks to it while zooming.
        const tick = () => {
          if (!document.body.contains(el)) return;
          const dom = document.querySelector(`[data-id="${CSS.escape(editingId)}"]`);
          if (dom) {
            const r = dom.getBoundingClientRect();
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
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onDone(editingId, value.trim() || node.label)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone(editingId, value.trim() || node.label);
          if (e.key === "Escape") onDone(null, "");
        }}
      />
    </div>
  );
}
