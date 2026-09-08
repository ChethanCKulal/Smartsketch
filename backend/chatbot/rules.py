"""Command validation rules shared with the frontend contract."""

ALLOWED_ACTIONS = {
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
    "LOAD_DIAGRAM",
}


def validate_command(command):
    if not isinstance(command, dict):
        return False, "Command must be an object."
    action = command.get("action")
    if action not in ALLOWED_ACTIONS:
        return False, f"Invalid action: {action}"
    payload = command.get("payload")
    if payload is not None and not isinstance(payload, dict):
        return False, "payload must be an object."
    return True, None
