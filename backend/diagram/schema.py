ALLOWED_TYPES = {"flowchart", "uml", "er", "dfd", "unknown", "auto"}

NODE_TYPES = {
    "rectangle",
    "roundedRectangle",
    "ellipse",
    "diamond",
    "triangle",
    "hexagon",
    "parallelogram",
    "text",
    "process",
    "decision",
    "terminator",
    "io",
    "document",
    "database",
    "predefinedProcess",
    "class",
    "interface",
    "package",
    "actor",
    "usecase",
    "entity",
    "attribute",
    "relationship",
    "weakEntity",
    "dfdProcess",
    "dataStore",
    "externalEntity",
    "dataFlow",
    "group",
}

TYPE_ALIASES = {
    "rect": "rectangle",
    "box": "rectangle",
    "rounded": "roundedRectangle",
    "rounded_rectangle": "roundedRectangle",
    "circle": "ellipse",
    "oval": "ellipse",
    "rhombus": "diamond",
    "decision": "decision",
    "start": "terminator",
    "end": "terminator",
    "input": "io",
    "output": "io",
    "input/output": "io",
    "predefined": "predefinedProcess",
    "use_case": "usecase",
    "use-case": "usecase",
    "weak_entity": "weakEntity",
    "data_store": "dataStore",
    "datastore": "dataStore",
    "external": "externalEntity",
    "external_entity": "externalEntity",
    "data_flow": "dataFlow",
    "dfd_process": "dfdProcess",
    "class_node": "class",
}


def empty_diagram(diagram_type="flowchart"):
    return {
        "version": 1,
        "diagram_type": diagram_type if diagram_type in ALLOWED_TYPES else "flowchart",
        "nodes": [],
        "edges": [],
        "groups": [],
        "meta": {"name": "Untitled Diagram"},
    }


def default_style():
    return {
        "fill": "#1e2a3a",
        "border": "#7aa2c9",
        "borderWidth": 1.5,
        "color": "#e8eef6",
        "font": "Segoe UI",
        "fontSize": 13,
        "fontStyle": "normal",
        "fontWeight": "500",
        "textAlign": "center",
        "opacity": 1,
        "lineStyle": "solid",
        "arrow": "forward",
    }


def canonicalize_type(value, diagram_type="flowchart"):
    raw = str(value or "").strip().lower().replace(" ", "_")
    if raw in NODE_TYPES:
        return raw
    if raw in TYPE_ALIASES:
        return TYPE_ALIASES[raw]
    if diagram_type == "er":
        return "entity"
    if diagram_type == "uml":
        return "class"
    if diagram_type == "dfd":
        return "dfdProcess"
    return "process"


def validate_diagram(data):
    errors = []
    if not isinstance(data, dict):
        return False, ["Diagram is not an object."]
    if "nodes" not in data or not isinstance(data["nodes"], list):
        errors.append("nodes must be an array.")
    if "edges" not in data or not isinstance(data["edges"], list):
        errors.append("edges must be an array.")
    ids = set()
    for node in data.get("nodes") or []:
        if not isinstance(node, dict) or not node.get("id"):
            errors.append("A node is missing an id.")
            continue
        if node["id"] in ids:
            errors.append(f"Duplicate node id: {node['id']}")
        ids.add(node["id"])
        if "position" not in node:
            errors.append(f"Node {node['id']} is missing position.")
    for edge in data.get("edges") or []:
        if not isinstance(edge, dict) or not edge.get("id"):
            errors.append("An edge is missing an id.")
            continue
        if edge.get("source") not in ids or edge.get("target") not in ids:
            errors.append(f"Edge {edge.get('id')} references missing nodes.")
    return len(errors) == 0, errors
