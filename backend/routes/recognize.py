from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from flask import Blueprint, jsonify, request

from utils.images import InvalidImageError, validate_image
from ocr.ocr_service import inspect_image
from recognition.gemini_service import RecognitionError, recognize_with_gemini
from recognition.huggingface_service import HuggingFaceError, recognize_with_huggingface
from recognition.reconciliation_engine import reconcile
from diagram.normalizer import normalize_source_payload, to_canonical_diagram
from diagram.schema import validate_diagram

recognize_bp = Blueprint("recognize", __name__)


@recognize_bp.post("/recognize")
def recognize():
    upload = request.files.get("image")
    if not upload:
        return jsonify({"error": "No image uploaded."}), 400

    diagram_type = (request.form.get("diagram_type") or "auto").lower()
    auto_detect_raw = request.form.get("auto_detect")
    if auto_detect_raw is not None:
        auto_detect = auto_detect_raw.lower() == "true"
    else:
        auto_detect = diagram_type == "auto"
    hint = "auto" if auto_detect or diagram_type == "auto" else diagram_type

    try:
        image_bytes, mime, size = validate_image(
            upload, int(os.getenv("MAX_UPLOAD_MB", "8")) * 1024 * 1024
        )
    except InvalidImageError as exc:
        return jsonify({"error": str(exc)}), 400

    ocr_meta = inspect_image(image_bytes)
    gemini_norm, hf_norm = _run_both(image_bytes, mime, hint)

    reconciled = reconcile([gemini_norm, hf_norm])
    if not reconciled.get("ok"):
        return (
            jsonify(
                {
                    "error": reconciled.get("error") or "Recognition failed.",
                    "reconciliation": {
                        "requested_type": hint,
                        "detected_type": reconciled.get("diagram_type"),
                        "warnings": reconciled.get("warnings"),
                        "sources_used": reconciled.get("sources_used"),
                        "disagreements": reconciled.get("disagreements"),
                    },
                    "sources": {
                        "gemini": _public_source(gemini_norm),
                        "huggingface": _public_source(hf_norm),
                    },
                }
            ),
            502,
        )

    diagram = to_canonical_diagram(reconciled)
    if hint != "auto" and hint in {"flowchart", "uml", "er", "dfd"}:
        diagram["diagram_type"] = hint

    ok, errors = validate_diagram(diagram)
    if not ok:
        return jsonify({"error": "Invalid JSON after reconciliation.", "details": errors}), 502

    if not any(n.get("label") for n in diagram["nodes"]):
        return jsonify({"error": "Missing OCR text; no labels were recovered."}), 422

    message = "Diagram recognized and reconciled."
    if reconciled.get("partial"):
        message = "One recognition source failed; continuing with the successful source."
    if hint != "auto":
        message += f" Requested type '{hint}' was enforced."

    return jsonify(
        {
            "diagram": diagram,
            "message": message,
            "partial": bool(reconciled.get("partial")),
            "image": {"width": size[0], "height": size[1], "ocr": ocr_meta},
            "reconciliation": {
                "requested_type": hint,
                "detected_type": reconciled.get("diagram_type"),
                "sources_used": reconciled.get("sources_used"),
                "warnings": reconciled.get("warnings"),
                "disagreements": reconciled.get("disagreements"),
            },
            "sources": {
                "gemini": _public_source(gemini_norm),
                "huggingface": _public_source(hf_norm),
            },
        }
    )


def _run_both(image_bytes, mime, hint):
    jobs = {
        "gemini": lambda: recognize_with_gemini(image_bytes, mime, hint),
        "huggingface": lambda: recognize_with_huggingface(image_bytes, mime, hint),
    }
    raw = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(fn): name for name, fn in jobs.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                raw[name] = {"ok": True, "payload": future.result()}
            except (RecognitionError, HuggingFaceError) as exc:
                raw[name] = {"ok": False, "error": str(exc), "code": exc.code}
            except Exception as exc:
                raw[name] = {"ok": False, "error": f"{name} failed: {exc}", "code": "unknown"}

    gemini_norm = (
        normalize_source_payload(raw["gemini"]["payload"], "gemini", hint)
        if raw.get("gemini", {}).get("ok")
        else {"ok": False, "source": "gemini", "error": raw.get("gemini", {}).get("error", "Gemini failed."), "nodes": [], "edges": []}
    )
    hf_norm = (
        normalize_source_payload(raw["huggingface"]["payload"], "huggingface", hint)
        if raw.get("huggingface", {}).get("ok")
        else {"ok": False, "source": "huggingface", "error": raw.get("huggingface", {}).get("error", "Hugging Face failed."), "nodes": [], "edges": []}
    )
    return gemini_norm, hf_norm


def _public_source(norm):
    return {
        "ok": bool(norm.get("ok")),
        "source": norm.get("source"),
        "error": norm.get("error"),
        "diagram_type": norm.get("diagram_type"),
        "node_count": len(norm.get("nodes") or []),
        "edge_count": len(norm.get("edges") or []),
    }
