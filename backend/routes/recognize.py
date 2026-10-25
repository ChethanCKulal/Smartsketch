from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import os
from flask import Blueprint, jsonify, request

from utils.images import InvalidImageError, validate_image
from ocr.ocr_service import inspect_image
from recognition.gemini_service import RecognitionError, recognize_with_gemini
from recognition.groq_service import GroqRecognitionError, recognize_with_groq, resolve_vision_model
from recognition.reconciliation_engine import reconcile
from recognition.flowchart_fusion import fuse_flowchart
from recognition.yolo_service import UNAVAILABLE_CODES, YoloError
from recognition.yolo_service import detect as detect_flowchart_symbols
from recognition.yolo_service import enabled as yolo_enabled
from recognition.yolo_service import weights_path as yolo_weights_path
from diagram.layout import assign_relative_positions
from diagram.normalizer import normalize_source_payload, to_canonical_diagram
from diagram.schema import validate_diagram

logger = logging.getLogger(__name__)

recognize_bp = Blueprint("recognize", __name__)

EXPLICIT_TYPES = {"flowchart", "uml", "er", "dfd"}


@recognize_bp.post("/recognize")
def recognize():
    upload = request.files.get("image")
    if not upload:
        return jsonify({"error": "No image uploaded."}), 400

    diagram_type = (request.form.get("diagram_type") or "auto").lower()
    auto_detect = request.form.get("auto_detect", "true").lower() == "true"
    hint = "auto" if auto_detect or diagram_type == "auto" else diagram_type

    try:
        image_bytes, mime, size = validate_image(
            upload, int(os.getenv("MAX_UPLOAD_MB", "8")) * 1024 * 1024
        )
    except InvalidImageError as exc:
        return jsonify({"error": str(exc)}), 400

    ocr_meta = inspect_image(image_bytes)
    fallback_notes = []

    if _uses_flowchart_detector(diagram_type, auto_detect):
        flowchart, fallback = _flowchart_recognition(image_bytes, mime, size, ocr_meta)
        if flowchart is not None:
            return flowchart
        # The detector could not contribute to this upload; the vision services
        # take over, and the response says so rather than pretending otherwise.
        fallback_notes.append(
            f"{fallback} Flowchart recognition fell back to the vision services for this upload."
        )
        logger.info("Flowchart detector unavailable, using vision sources: %s", fallback)

    gemini_norm, groq_norm, groq_model = _run_both(image_bytes, mime, hint)

    reconciled = reconcile([gemini_norm, groq_norm])
    warnings = fallback_notes + list(reconciled.get("warnings") or [])
    if not reconciled.get("ok"):
        return (
            jsonify(
                {
                    "error": reconciled.get("error") or "Recognition failed.",
                    "reconciliation": {
                        "requested_type": hint,
                        "detected_type": reconciled.get("diagram_type"),
                        "warnings": warnings,
                        "sources_used": reconciled.get("sources_used"),
                        "disagreements": reconciled.get("disagreements"),
                    },
                    "sources": {
                        "gemini": _public_source(gemini_norm),
                        "groq": _public_source(groq_norm, groq_model),
                    },
                }
            ),
            502,
        )

    diagram = to_canonical_diagram(reconciled)
    if hint != "auto" and hint in EXPLICIT_TYPES:
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
                "warnings": warnings,
                "disagreements": reconciled.get("disagreements"),
            },
            "sources": {
                "gemini": _public_source(gemini_norm),
                "groq": _public_source(groq_norm, groq_model),
            },
        }
    )


def _uses_flowchart_detector(diagram_type, auto_detect):
    """Whether this request is an explicit flowchart selection.

    Only an explicit choice routes an image to the trained detector: the six
    shape classes it knows are flowchart notation, so they must never decide
    which family an upload belongs to. Auto detection keeps its existing path.
    """
    return diagram_type == "flowchart" and not auto_detect and yolo_enabled()


def _flowchart_recognition(image_bytes, mime, size, ocr_meta):
    """Recognize an explicitly selected flowchart with the trained detector.

    Returns ``(response, fallback_reason)`` with exactly one of the two set: a
    ready Flask response (which carries its own status, 200 or an error), or the
    reason the detector could not contribute — in which case the caller runs the
    existing vision pipeline instead.
    """
    detection, yolo_error, groq_payload, groq_error, groq_model = _flowchart_sources(image_bytes, mime)

    if detection is None:
        failure = yolo_error or YoloError("Flowchart detection failed.", "inference_failed", 502)
        if failure.code in UNAVAILABLE_CODES:
            return None, str(failure)
        error = jsonify(
            {
                "error": str(failure),
                "reconciliation": {
                    "requested_type": "flowchart",
                    "detected_type": "flowchart",
                    "sources_used": ["yolo"],
                    "warnings": [],
                    "disagreements": [],
                },
                "sources": {
                    "yolo": _yolo_source(detection, failure),
                    "groq": _groq_source(groq_payload, groq_error, groq_model),
                    "gemini": _gemini_not_called(),
                },
            }
        )
        error.status_code = failure.status
        return error, None

    if groq_error is not None:
        # The response says this to the user, and the server log has to hold it too:
        # an upload used to lose every label with nothing recorded anywhere.
        logger.warning(
            "Flowchart text source failed (%s): %s",
            getattr(groq_error, "code", "unknown"),
            groq_error,
        )

    # A text source that ran out of output budget keeps the labels it did read and
    # says so, rather than passing a half-read drawing off as a complete one.
    text_note = (groq_payload or {}).get("text_note")
    fused = fuse_flowchart(
        detection,
        groq_payload,
        groq_ok=groq_error is None,
        warnings=[text_note] if text_note else None,
    )
    if not fused.get("ok"):
        # Nothing the detector can contribute; the vision services still might.
        return None, fused.get("error") or "The trained detector found no flowchart symbols."

    nodes = fused["nodes"]
    assign_relative_positions(nodes)
    diagram = to_canonical_diagram(fused)
    diagram["diagram_type"] = "flowchart"
    ok, errors = validate_diagram(diagram)
    if not ok:
        invalid = jsonify({"error": "Invalid JSON after flowchart fusion.", "details": errors})
        invalid.status_code = 502
        return invalid, None

    report = fused["report"]
    partial = groq_error is not None
    message = "Flowchart recognized with the trained detector."
    if report["match"]["matched"]:
        message += f" {report['match']['matched']} label(s) read from the image text."
    if report["edges_from_arrows"]:
        message += f" {report['edges_from_arrows']} connection(s) placed from the drawn arrows."
    if partial:
        message += (
            " Text extraction failed, so the detected shapes carry placeholder names "
            "rather than text read from the image."
        )
    if text_note:
        message += f" {text_note}"

    return (
        jsonify(
            {
                "diagram": diagram,
                "message": message,
                "partial": partial,
                "image": {"width": size[0], "height": size[1], "ocr": ocr_meta},
                "reconciliation": {
                    "requested_type": "flowchart",
                    "detected_type": "flowchart",
                    "sources_used": ["yolo"] + (["groq"] if groq_payload else []),
                    "warnings": fused["warnings"],
                    "disagreements": fused.get("disagreements") or [],
                    "engine": report["engine"],
                    "detected_symbols": detection.get("class_counts"),
                    "labels_matched": report["match"]["matched"],
                    "type_disagreements": report["match"]["type_disagreements"],
                    "labels_are_placeholders": report["labels_are_placeholders"],
                    "edges_from_text": report["edges_from_text"],
                    "edges_from_arrows": report["edges_from_arrows"],
                    "edges_rejected": report["edges_rejected"],
                    "connectors_dangling": report["connectors_dangling"],
                    "connectors_ambiguous": report["connectors_ambiguous"],
                },
                "sources": {
                    "yolo": _yolo_source(detection, None),
                    "groq": _groq_source(groq_payload, groq_error, groq_model),
                    "gemini": _gemini_not_called(),
                },
            }
        ),
        None,
    )


def _flowchart_sources(image_bytes, mime):
    """Run detection and text extraction together: they do not depend on each other."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        detection_future = pool.submit(detect_flowchart_symbols, image_bytes)
        text_future = pool.submit(recognize_with_groq, image_bytes, mime, "flowchart")

        detection, yolo_error = None, None
        try:
            detection = detection_future.result()
        except YoloError as exc:
            yolo_error = exc
        except Exception as exc:  # never leak a traceback through the API
            yolo_error = YoloError(
                f"Flowchart detection failed ({type(exc).__name__}).", "inference_failed", 502
            )

        groq_payload, groq_error, groq_model = None, None, None
        try:
            groq_payload = text_future.result()
            groq_model = resolve_vision_model().get("model")
        except GroqRecognitionError as exc:
            groq_error = exc
        except Exception as exc:
            groq_error = GroqRecognitionError(f"Groq failed: {type(exc).__name__}.", "unknown", 502)

    return detection, yolo_error, groq_payload, groq_error, groq_model


def _yolo_source(detection, failure=None):
    """Public, credential-free report of the detector for this request."""
    return {
        "ok": detection is not None,
        "source": "yolo",
        "error": str(failure) if failure else None,
        "code": getattr(failure, "code", None),
        "diagram_type": "flowchart" if detection is not None else None,
        "node_count": len((detection or {}).get("symbols") or []),
        "edge_count": None,
        "connector_count": len((detection or {}).get("connectors") or []),
        "class_counts": (detection or {}).get("class_counts"),
        "device": (detection or {}).get("device"),
        "imgsz": (detection or {}).get("imgsz"),
        "conf": (detection or {}).get("conf"),
        "weights": yolo_weights_path().name,
        "model": "yolo11n (flowchart, trained)",
    }


def _groq_source(payload, error, model):
    return {
        "ok": payload is not None,
        "source": "groq",
        "error": str(error) if error else None,
        "code": getattr(error, "code", None),
        "diagram_type": (payload or {}).get("diagram_type") if payload else None,
        "node_count": len(((payload or {}).get("nodes") or (payload or {}).get("entities") or [])),
        "edge_count": len(
            ((payload or {}).get("edges") or (payload or {}).get("relationships") or [])
        ),
        "model": model,
    }


def _gemini_not_called():
    """Kept so the response keeps its existing keys, and says why it is empty."""
    return {
        "ok": False,
        "source": "gemini",
        "error": "Not called: an explicit flowchart uses the trained detector with Groq text.",
        "diagram_type": None,
        "node_count": 0,
        "edge_count": 0,
        "model": None,
    }


def _run_both(image_bytes, mime, hint):
    jobs = {
        "gemini": lambda: recognize_with_gemini(image_bytes, mime, hint),
        "groq": lambda: recognize_with_groq(image_bytes, mime, hint),
    }
    raw = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(fn): name for name, fn in jobs.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                raw[name] = {"ok": True, "payload": future.result()}
            except (RecognitionError, GroqRecognitionError) as exc:
                raw[name] = {"ok": False, "error": str(exc), "code": exc.code}
            except Exception as exc:
                raw[name] = {"ok": False, "error": f"{name} failed: {exc}", "code": "unknown"}

    gemini_norm = (
        normalize_source_payload(raw["gemini"]["payload"], "gemini", hint)
        if raw.get("gemini", {}).get("ok")
        else {"ok": False, "source": "gemini", "error": raw.get("gemini", {}).get("error", "Gemini failed."), "nodes": [], "edges": []}
    )
    groq_norm = (
        normalize_source_payload(raw["groq"]["payload"], "groq", hint)
        if raw.get("groq", {}).get("ok")
        else {"ok": False, "source": "groq", "error": raw.get("groq", {}).get("error", "Groq failed."), "nodes": [], "edges": []}
    )
    # Which Groq model actually served the request, when it succeeded.
    groq_model = resolve_vision_model().get("model") if raw.get("groq", {}).get("ok") else None
    return gemini_norm, groq_norm, groq_model


def _public_source(norm, model=None):
    return {
        "ok": bool(norm.get("ok")),
        "source": norm.get("source"),
        "error": norm.get("error"),
        "diagram_type": norm.get("diagram_type"),
        "node_count": len(norm.get("nodes") or []),
        "edge_count": len(norm.get("edges") or []),
        "model": model,
    }
