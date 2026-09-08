from flask import Blueprint, jsonify, request

from chatbot.parser import parse_command
from chatbot.command_executor import execute_command

chat_bp = Blueprint("chat", __name__)


@chat_bp.post("/chat")
def chat():
    body = request.get_json(silent=True) or {}
    parsed = parse_command(body.get("text") or "")
    if not parsed.get("ok"):
        return jsonify(parsed), 400
    diagram = body.get("diagram")
    if diagram and parsed.get("command"):
        result = execute_command(diagram, parsed["command"])
        parsed["execution"] = result
    return jsonify(parsed)
