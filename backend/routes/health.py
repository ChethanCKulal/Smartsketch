from flask import Blueprint, jsonify, request
import os

from recognition.groq_service import probe_vision_support, resolve_vision_model

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    # Cheap by default: the Groq model report costs no tokens and the account's
    # model listing is cached for GROQ_MODEL_CACHE_TTL seconds. `?probe=1` runs
    # the live preflight (model exists on this account AND accepts an image) —
    # useful before an upload, never on the recognition path, because it spends
    # tokens.
    groq = resolve_vision_model()
    if request.args.get("probe", "").lower() in {"1", "true", "yes"}:
        groq = {**groq, "probe": probe_vision_support(refresh=True)}
    return jsonify(
        {
            "ok": True,
            "service": "SketchCanvas",
            "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
            "groq_configured": bool(os.getenv("GROQ_API_KEY")),
            "groq": groq,
        }
    )
