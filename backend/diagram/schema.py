ALLOWED_TYPES = {"flowchart", "uml", "er", "dfd", "unknown", "auto"}

NODE_TYPES = {
    "rectangle",
    "roundedRectangle",
    "ellipse",
    "diamond",
    "triangle",
    "hexagon",
    "parallelogram",
    "cylinder",
    "document",
    "star",
    "cloud",
    "stickyNote",
    "callout",
    "text",
    "arrowRight",
    "arrowLeft",
    "arrowUp",
    "arrowDown",
    "arrowBoth",
    "process",
    "decision",
    "terminator",
    "io",
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

UNIVERSAL_SHAPES = {
    "rectangle",
    "roundedRectangle",
    "ellipse",
    "diamond",
    "triangle",
    "hexagon",
    "parallelogram",
    "cylinder",
    "document",
    "star",
    "cloud",
    "stickyNote",
    "callout",
    "text",
    "arrowRight",
    "arrowLeft",
    "arrowUp",
    "arrowDown",
    "arrowBoth",
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


# When the user explicitly selects a diagram family, vision models still emit
# generic shape names (rectangle, ellipse, diamond, process). These tables pull
# such shapes into the chosen family's notation. Only applied on explicit
# selection — auto-detected runs keep the model's finer-grained types.
FAMILY_REMAP = {
    "er": {
        "rectangle": "entity", "roundedRectangle": "entity", "process": "entity",
        "dfdProcess": "entity", "class": "entity", "interface": "entity",
        "package": "entity", "externalEntity": "entity", "dataStore": "entity",
        "database": "entity", "document": "entity", "predefinedProcess": "entity",
        "parallelogram": "entity", "hexagon": "entity", "triangle": "entity",
        "diamond": "relationship", "decision": "relationship",
        "ellipse": "attribute", "usecase": "attribute", "terminator": "attribute",
        "io": "attribute", "actor": "attribute", "dataFlow": "relationship",
    },
    "uml": {
        "rectangle": "class", "roundedRectangle": "class", "process": "class",
        "dfdProcess": "class", "entity": "class", "weakEntity": "class",
        "externalEntity": "class", "dataStore": "class", "database": "class",
        "document": "class", "predefinedProcess": "class", "parallelogram": "class",
        "io": "class", "hexagon": "class", "triangle": "class",
        "diamond": "class", "decision": "class",
        "ellipse": "usecase", "attribute": "usecase", "terminator": "usecase",
    },
    "dfd": {
        "process": "dfdProcess", "rectangle": "externalEntity",
        "roundedRectangle": "dfdProcess", "entity": "externalEntity",
        "class": "externalEntity", "interface": "externalEntity",
        "package": "externalEntity", "weakEntity": "externalEntity",
        "database": "dataStore", "document": "externalEntity",
        "predefinedProcess": "dfdProcess", "parallelogram": "externalEntity",
        "io": "externalEntity", "hexagon": "externalEntity", "triangle": "externalEntity",
        "diamond": "dfdProcess", "decision": "dfdProcess",
        "ellipse": "dfdProcess", "usecase": "dfdProcess", "terminator": "dfdProcess",
        "attribute": "dfdProcess", "actor": "externalEntity",
    },
    "flowchart": {
        "entity": "process", "class": "process", "interface": "process",
        "package": "process", "dfdProcess": "process", "externalEntity": "process",
        "dataStore": "database", "weakEntity": "process", "hexagon": "process",
        "triangle": "process", "parallelogram": "io", "actor": "process",
        "ellipse": "terminator", "usecase": "terminator", "attribute": "io",
        "relationship": "decision", "diamond": "decision", "dataFlow": "io",
    },
}

# The complete shape vocabulary of each diagram family. Nothing outside this
# set may appear on the canvas while that family is active.
FAMILY_NODE_TYPES = {
    "flowchart": {"process", "decision", "terminator", "io", "document", "database", "predefinedProcess", "text"},
    "er": {"entity", "attribute", "relationship", "weakEntity", "text"},
    "uml": {"class", "interface", "package", "actor", "usecase", "text"},
    "dfd": {"dfdProcess", "dataStore", "externalEntity", "dataFlow", "text"},
}

# Where a shape has no meaningful counterpart in the family, fall back to this.
FAMILY_DEFAULTS = {
    "flowchart": "process",
    "er": "entity",
    "uml": "class",
    "dfd": "dfdProcess",
}


def remap_to_family(node_type, diagram_type):
    """Pull generic shape types into the explicitly selected diagram family."""
    mapping = FAMILY_REMAP.get(diagram_type)
    if not mapping:
        return node_type
    return mapping.get(node_type, node_type)


def enforce_family(node_type, diagram_type):
    """Guarantee a node type belongs to the diagram family's shape vocabulary.

    Allowed types pass through; everything else is remapped into the family and,
    if even that fails, coerced to the family's default shape. "group" is a
    canvas construct and is exempt.
    """
    if node_type == "group":
        return node_type
    family = FAMILY_NODE_TYPES.get(diagram_type)
    if not family:
        return node_type
    if node_type in family:
        return node_type
    remapped = remap_to_family(node_type, diagram_type)
    if remapped in family:
        return remapped
    return FAMILY_DEFAULTS.get(diagram_type, node_type)


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
