"""Mirrors frontend command semantics for API-side dry runs."""

from .rules import validate_command
from diagram.schema import canonicalize_type, default_style


def execute_command(diagram, command):
    ok, error = validate_command(command)
    if not ok:
        return {"ok": False, "error": error, "diagram": diagram}
    action = command["action"]
    payload = command.get("payload") or {}
    nodes = list(diagram.get("nodes") or [])
    edges = list(diagram.get("edges") or [])

    def find_label(label):
        needle = str(label or "").strip().lower()
        return next((n for n in nodes if n.get("label", "").strip().lower() == needle), None)

    if action == "ADD_NODE":
        node = {
            "id": payload.get("id") or f"node_{len(nodes) + 1}",
            "type": canonicalize_type(payload.get("type")),
            "label": payload.get("label") or "Node",
            "position": payload.get("position") or {"x": 120 + 20 * len(nodes), "y": 120},
            "size": payload.get("size") or {"width": 160, "height": 72},
            "style": default_style(),
            "attributes": [],
            "locked": False,
        }
        nodes.append(node)
        return {"ok": True, "diagram": {**diagram, "nodes": nodes, "edges": edges}, "message": f"Added {node['label']}."}

    if action == "DELETE_NODE":
        node = next((n for n in nodes if n["id"] == payload.get("id")), None) or find_label(payload.get("label"))
        if not node:
            return {"ok": False, "error": "Node not found.", "diagram": diagram}
        nodes = [n for n in nodes if n["id"] != node["id"]]
        edges = [e for e in edges if e["source"] != node["id"] and e["target"] != node["id"]]
        return {"ok": True, "diagram": {**diagram, "nodes": nodes, "edges": edges}, "message": "Deleted node."}

    return {"ok": False, "error": "This action is executed on the canvas command layer.", "diagram": diagram}
