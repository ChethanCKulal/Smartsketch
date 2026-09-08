from flask import Blueprint, jsonify
import os

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "SketchCanvas",
            "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
            "huggingface_configured": bool(os.getenv("HUGGINGFACE_API_KEY")),
        }
    )
