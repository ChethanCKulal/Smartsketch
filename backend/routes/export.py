import io
import os

from flask import Blueprint, jsonify, request, send_file

from diagram.schema import validate_diagram
from export.svg_export import diagram_to_svg

export_bp = Blueprint("export", __name__)


@export_bp.post("/export/svg")
def export_svg():
    body = request.get_json(silent=True)
    diagram = body.get("diagram") if isinstance(body, dict) else None
    if not isinstance(diagram, dict):
        return jsonify({"error": "Request body must contain a diagram object."}), 400

    # Edges may reference nodes missing on the client; drop them rather than fail.
    node_ids = {n.get("id") for n in diagram.get("nodes") or [] if isinstance(n, dict)}
    cleaned = {
        **diagram,
        "nodes": [n for n in diagram.get("nodes") or [] if isinstance(n, dict) and n.get("id")],
        "edges": [
            e
            for e in diagram.get("edges") or []
            if isinstance(e, dict) and e.get("source") in node_ids and e.get("target") in node_ids
        ],
    }
    ok, errors = validate_diagram(cleaned)
    if not ok:
        return jsonify({"error": "Invalid diagram JSON.", "details": errors}), 400

    svg = diagram_to_svg(cleaned)
    return send_file(
        io.BytesIO(svg.encode("utf-8")),
        mimetype="image/svg+xml",
        as_attachment=True,
        download_name="sketchcanvas.svg",
    )
