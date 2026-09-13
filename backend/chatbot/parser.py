import re

ACTIONS = [
    "ADD_NODE",
    "DELETE_NODE",
    "MOVE_NODE",
    "RESIZE_NODE",
    "EDIT_TEXT",
    "CONNECT",
    "DISCONNECT",
    "RECOLOR",
    "CHANGE_TYPE",
    "GROUP",
    "UNGROUP",
    "ADD_ATTRIBUTE",
    "DELETE_ATTRIBUTE",
]

TYPE_ALIASES = {
    "entity": "entity",
    "process": "process",
    "class": "class",
    "decision": "decision",
    "diamond": "diamond",
    "rectangle": "rectangle",
    "terminator": "terminator",
    "actor": "actor",
    "datastore": "dataStore",
    "data store": "dataStore",
}

COLORS = {
    "red": "#8b3a3a",
    "blue": "#2a4a72",
    "green": "#2f5a45",
    "yellow": "#7a6a2a",
}

# Same deltas the frontend parser emits, so both parsers produce identical
# command payloads for the shared command layer.
MOVE_DELTAS = {
    "left": {"x": -80, "y": 0},
    "right": {"x": 80, "y": 0},
    "up": {"x": 0, "y": -80},
    "down": {"x": 0, "y": 80},
    "above": {"x": 0, "y": -140},
    "below": {"x": 0, "y": 140},
}


def sanitize(text):
    return re.sub(r"[<>]", "", str(text or ""))[:240].strip()


def parse_command(raw):
    text = sanitize(raw)
    if not text:
        return {"ok": False, "error": "Empty command."}
    lower = text.lower()

    if lower in {"undo", "redo"}:
        return {"ok": True, "meta": {"history": lower}}

    patterns = [
        (r"^add (.+) (entity|process|class|actor|decision|terminator)$", lambda m: _cmd("ADD_NODE", {"type": TYPE_ALIASES.get(m.group(2), m.group(2)), "label": _title(m.group(1))})),
        (r"^delete (?:the|a|an) ([a-z ]+)$", lambda m: _delete_type_or_label(m.group(1))),
        (r"^delete (.+) from (.+)$", lambda m: _cmd("DELETE_ATTRIBUTE", {"attribute": _title(m.group(1)), "label": _title(m.group(2))})),
        (r"^delete (.+)$", lambda m: _cmd("DELETE_NODE", {"label": _title(m.group(1))})),
        (r"^rename (.+) to (.+)$", lambda m: _cmd("EDIT_TEXT", {"from": _title(m.group(1)), "to": _title(m.group(2))})),
        (r"^add (.+) attribute to (.+)$", lambda m: _cmd("ADD_ATTRIBUTE", {"attribute": _title(m.group(1)), "label": _title(m.group(2))})),
        (r"^connect (.+) to (.+)$", lambda m: _cmd("CONNECT", {"source": _title(m.group(1)), "target": _title(m.group(2))})),
        (r"^disconnect (.+) from (.+)$", lambda m: _cmd("DISCONNECT", {"source": _title(m.group(1)), "target": _title(m.group(2))})),
        # Color pattern must precede change-type: "change x color to red" would
        # otherwise match "change (.+) to (.+)" with type "red".
        (r"^change (.+) color(?: to ([a-z]+))?$", lambda m: _cmd("RECOLOR", {"label": _title(m.group(1)), "fill": COLORS.get(m.group(2) or "blue", COLORS["blue"])})),
        (r"^change (.+) to ([a-z ]+)$", lambda m: _cmd("CHANGE_TYPE", {"label": _title(m.group(1)), "type": TYPE_ALIASES.get(m.group(2).strip(), m.group(2).strip())})),
        (r"^move (.+) (left|right|up|down|below|above)(?: (.+))?$", lambda m: _cmd("MOVE_NODE", {"label": _title(m.group(1)), "direction": m.group(2), "delta": MOVE_DELTAS[m.group(2)], "relativeTo": _title(m.group(3)) if m.group(3) else None})),
        (r"^resize (.+)$", lambda m: _cmd("RESIZE_NODE", {"label": _title(m.group(1)), "scale": 1.25})),
    ]
    for pattern, builder in patterns:
        match = re.match(pattern, lower)
        if match:
            return builder(match)
    if lower == "help":
        return {"ok": True, "help": True, "message": "Add Student entity | Delete Student | Rename A to B | Connect A to B | Undo"}
    return {"ok": False, "error": f'Unrecognized command: "{text}"'}


def _cmd(action, payload):
    return {"ok": True, "command": {"action": action, "payload": payload}}


def _delete_type_or_label(raw):
    """"Delete the diamond" targets a shape type; otherwise treat it as a label."""
    known = TYPE_ALIASES.get(raw.strip())
    if known:
        return _cmd("DELETE_BY_TYPE", {"type": known})
    return _cmd("DELETE_NODE", {"label": _title(raw)})


def _title(value):
    return " ".join(part.capitalize() for part in str(value or "").split())
