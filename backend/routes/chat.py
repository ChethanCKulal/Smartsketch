from flask import Blueprint, jsonify, request

from chatbot.parser import parse_command
from chatbot.command_executor import execute_command
from chatbot.rules import validate_command

chat_bp = Blueprint("chat", __name__)


@chat_bp.post("/chat")
def chat():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"ok": False, "error": "Request body must be a JSON object."}), 400

    text = body.get("text")
    if not isinstance(text, str):
        return jsonify({"ok": False, "error": "text must be a string."}), 400

    parsed = parse_command(text)
    if not parsed.get("ok"):
        return jsonify(parsed), 400

    diagram = body.get("diagram")
    if isinstance(diagram, dict) and parsed.get("command"):
        ok, error = validate_command(parsed["command"])
        if not ok:
            return jsonify({"ok": False, "error": error}), 400
        result = execute_command(diagram, parsed["command"])
        if not result.get("ok"):
            # Server-side dry run failed (e.g. node not found); still return the parse.
            parsed["execution"] = result
        else:
            parsed["execution"] = result
    return jsonify(parsed)
