"""Flowchart symbol detection with the project's trained YOLO11n model.

This is the only module that knows about the detector. It is deliberately
independent of the vision services and of the recognition route: it takes image
bytes and answers detections, so the flowchart path can use it while every other
diagram family keeps its existing pipeline.

What the model was trained on (``runs/flowchart/yolo11n_v1``) is six classes —
``arrow, arrowhead, data, decision, process, terminator`` — and the class names
are read from the checkpoint's own ``names`` mapping rather than from a
hardcoded id table, so re-training cannot silently shift the interpretation.

Two consequences shape the mapping below:

* Only ``process``, ``decision``, ``terminator`` and ``data`` are *symbols*.
  ``data`` is SmartSketch's parallelogram, whose canonical type is ``io``.
* ``arrow`` and ``arrowhead`` are *connector evidence*, never process nodes.
  They are returned in their own bucket for the fusion step, which may use them
  to place a connection between two symbols that actually exist.

Loading is lazy and cached: ``ultralytics`` pulls in torch, so the import lives
inside the loader, and the loaded model is reused for every request instead of
being re-read per upload. Every failure is reported as a :class:`YoloError` with
a machine-readable code and an HTTP-ish status; nothing internal (stack traces,
absolute paths beyond the weights location, credentials) reaches the client.
"""

from __future__ import annotations

import io
import logging
import os
import threading
from pathlib import Path

from PIL import Image

from diagram.schema import default_style

logger = logging.getLogger(__name__)

SOURCE_NAME = "yolo"

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_WEIGHTS = ("models", "flowchart", "best.pt")

DEFAULT_IMGSZ = 640
DEFAULT_CONF = 0.25
# "auto" picks CUDA when this machine can actually use it, and never fails when
# it cannot: CPU inference is always available.
DEFAULT_DEVICE = "auto"
AUTO_DEVICE = {"auto", "", "any", "default"}

# Trained class name -> canonical SmartSketch flowchart node type.
# Keyed by *name*, not by class id, so the checkpoint's own mapping decides.
SYMBOL_TYPES = {
    "process": "process",
    "decision": "decision",
    "terminator": "terminator",
    "data": "io",
}
# Connector components: evidence for an edge between two symbols, never nodes.
CONNECTOR_CLASSES = {"arrow", "arrowhead"}

# Human-readable placeholder per symbol type. Used only when no text source
# could label a symbol; the recognition response flags such labels explicitly.
PLACEHOLDER_NAMES = {
    "process": "Process",
    "decision": "Decision",
    "terminator": "Start/End",
    "io": "Input/Output",
}

# Failures that mean "this environment cannot run the model at all" rather than
# "this image could not be processed". The route degrades to the vision-source
# pipeline for these and reports why, instead of failing the upload.
UNAVAILABLE_CODES = {"missing_dependency", "missing_weights", "model_load_failed"}


class YoloError(Exception):
    """Detection failure with a machine-readable code and an HTTP-ish status."""

    def __init__(self, message, code="yolo_error", status=502):
        super().__init__(message)
        self.code = code
        self.status = status


def _clean(value):
    return str(value or "").strip()


def _int_env(name, fallback):
    try:
        return int(_clean(os.getenv(name)) or fallback)
    except ValueError:
        return fallback


def _float_env(name, fallback):
    try:
        return float(_clean(os.getenv(name)) or fallback)
    except ValueError:
        return fallback


def enabled():
    """Whether the flowchart path may use the trained detector.

    Defaults to on; ``SMARTSKETCH_YOLO_ENABLED=off`` restores the previous
    two-vision-source behaviour for flowcharts without touching any code.
    """
    return _clean(os.getenv("SMARTSKETCH_YOLO_ENABLED", "true")).lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def weights_path():
    """Where the trained weights live, resolved without trusting the CWD.

    ``SMARTSKETCH_YOLO_MODEL`` may be absolute, or relative to the backend
    directory (never relative to whatever directory Flask was launched from).
    """
    configured = _clean(os.getenv("SMARTSKETCH_YOLO_MODEL"))
    path = Path(configured).expanduser() if configured else Path(*DEFAULT_WEIGHTS)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    return path.resolve()


def settings():
    """Inference settings in one place, all overridable by environment."""
    return {
        "imgsz": max(64, _int_env("SMARTSKETCH_YOLO_IMGSZ", DEFAULT_IMGSZ)),
        "conf": min(1.0, max(0.0, _float_env("SMARTSKETCH_YOLO_CONF", DEFAULT_CONF))),
        "device": _clean(os.getenv("SMARTSKETCH_YOLO_DEVICE")) or DEFAULT_DEVICE,
    }


def resolve_device(requested=None):
    """Turn the device setting into something Ultralytics accepts."""
    value = _clean(requested) or DEFAULT_DEVICE
    if value.lower() not in AUTO_DEVICE:
        return value  # an explicit choice ("cpu", "0", "cuda:1") is honoured
    try:
        import torch
    except Exception:  # torch absent is not fatal — CPU inference still works
        return "cpu"
    try:
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    except Exception:  # pragma: no cover - a broken CUDA install must not crash
        return "cpu"


_model_lock = threading.Lock()
_infer_lock = threading.Lock()
_model_cache = {"path": None, "model": None, "device": None}


def _create_model(path):
    """Import Ultralytics and load the weights.

    The import lives here so the dependency stays optional, and this function is
    the single seam the tests replace with a fake model.
    """
    from ultralytics import YOLO

    return YOLO(str(path))


def get_model(path=None):
    """The loaded model, reading the weights once and reusing them afterwards."""
    weights = Path(path) if path is not None else weights_path()
    if not weights.is_file() or weights.stat().st_size == 0:
        raise YoloError(
            "The trained flowchart model is not available. Expected weights at "
            f"'{weights}'; set SMARTSKETCH_YOLO_MODEL to point at best.pt.",
            "missing_weights",
            503,
        )
    key = str(weights)
    with _model_lock:
        if _model_cache["model"] is not None and _model_cache["path"] == key:
            return _model_cache["model"]
        try:
            model = _create_model(weights)
        except ImportError as exc:
            raise YoloError(
                "Flowchart detection needs the 'ultralytics' package (with a matching "
                "torch build) in the backend environment.",
                "missing_dependency",
                503,
            ) from exc
        except Exception as exc:
            logger.warning("YOLO weights could not be loaded: %s", type(exc).__name__)
            raise YoloError(
                f"The trained flowchart model could not be loaded ({type(exc).__name__}).",
                "model_load_failed",
                503,
            ) from exc
        _model_cache.update({"path": key, "model": model, "device": None})
        return model


def reset_model_cache():
    """Drop the cached model (used by tests and after a weights swap)."""
    with _model_lock:
        _model_cache.update({"path": None, "model": None, "device": None})


def model_info():
    """Non-fatal report for the health surface: never imports torch, never loads weights."""
    weights = weights_path()
    settings_now = settings()
    return {
        "source": SOURCE_NAME,
        "enabled": enabled(),
        "weights": weights.name,
        "present": weights.is_file() and weights.stat().st_size > 0,
        "loaded": _model_cache["model"] is not None,
        # The device actually used once a detection has run; before that, the
        # configured request (resolving "auto" would mean importing torch here,
        # which a health check has no business doing).
        "device": _model_cache["device"] or settings_now["device"],
        "imgsz": settings_now["imgsz"],
        "conf": settings_now["conf"],
    }


def class_names(model):
    """The checkpoint's class-id -> class-name mapping, however Ultralytics holds it."""
    names = getattr(model, "names", None)
    if isinstance(names, dict):
        return {int(key): str(value) for key, value in names.items()}
    if isinstance(names, (list, tuple)):
        return {index: str(value) for index, value in enumerate(names)}
    return {}


def symbol_type(class_name):
    """Canonical node type for a trained class name, or None when it is not a symbol."""
    return SYMBOL_TYPES.get(_clean(class_name).lower())


def is_connector(class_name):
    return _clean(class_name).lower() in CONNECTOR_CLASSES


def placeholder_label(node_type, ordinal):
    return f"{PLACEHOLDER_NAMES.get(node_type, 'Step')} {ordinal}"


def _as_rows(values):
    """Tensors, numpy arrays and plain lists all become a list of rows.

    Ultralytics hands over ``xyxy`` as an (n, 4) tensor but ``conf`` and ``cls``
    as flat (n,) tensors, so a scalar row is wrapped rather than rejected —
    treating every row as a sequence silently returned no detections at all.
    """
    if values is None:
        return []
    try:
        items = values.tolist()
    except AttributeError:
        try:
            items = list(values)
        except TypeError:
            return []
    except Exception:
        return []
    if not isinstance(items, list):
        items = [items]
    return [item if isinstance(item, list) else [item] for item in items]


def _detections(result, names):
    """Turn one Ultralytics result into plain detections, in image pixels."""
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return []
    coordinates = _as_rows(getattr(boxes, "xyxy", None))
    scores = _as_rows(getattr(boxes, "conf", None))
    classes = _as_rows(getattr(boxes, "cls", None))
    found = []
    for index, xyxy in enumerate(coordinates):
        if len(xyxy) < 4 or index >= len(classes):
            continue
        try:
            class_id = int(classes[index][0] if isinstance(classes[index], list) else classes[index])
        except (TypeError, ValueError, IndexError):
            continue
        try:
            confidence = float(scores[index][0] if isinstance(scores[index], list) else scores[index])
        except (TypeError, ValueError, IndexError):
            confidence = 0.0
        x1, y1, x2, y2 = (float(value) for value in xyxy[:4])
        found.append(
            {
                "class_id": class_id,
                "class_name": names.get(class_id, f"class_{class_id}"),
                "confidence": round(max(0.0, min(1.0, confidence)), 4),
                # Ultralytics already maps boxes back to the original image size.
                "bbox": [min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)],
            }
        )
    return found


def _reading_order(detection):
    return (detection["bbox"][1], detection["bbox"][0])


def _decode(image_bytes):
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.load()
            return image.convert("RGB")
    except Exception as exc:
        raise YoloError("Could not decode the image for flowchart detection.", "invalid_image", 400) from exc


def detect(image_bytes, conf=None, imgsz=None, device=None):
    """Detect flowchart symbols and connector components in an image.

    Returns every detection the model produced, split into ``symbols`` (the four
    drawable classes, in reading order so ids are stable) and ``connectors``
    (arrows and arrowheads, kept as evidence), with bounding boxes in the
    original image's pixel coordinates and confidence preserved from the model.
    """
    picture = _decode(image_bytes)
    model = get_model()
    current = settings()
    conf = current["conf"] if conf is None else float(conf)
    imgsz = current["imgsz"] if imgsz is None else int(imgsz)
    chosen_device = resolve_device(current["device"] if device is None else device)
    names = class_names(model)

    # One inference at a time: the model and its accelerator memory are shared
    # per process, and a flowchart upload is a single user action.
    with _infer_lock:
        try:
            results = model.predict(
                source=picture,
                imgsz=imgsz,
                conf=conf,
                device=chosen_device,
                verbose=False,
            )
        except Exception as exc:
            logger.warning("YOLO inference failed: %s", type(exc).__name__)
            raise YoloError(
                f"Flowchart detection failed ({type(exc).__name__}).", "inference_failed", 502
            ) from exc

    with _model_lock:
        _model_cache["device"] = chosen_device

    first = next(iter(results), None)
    found = _detections(first, names) if first is not None else []
    symbols = sorted([d for d in found if symbol_type(d["class_name"])], key=_reading_order)
    connectors = [d for d in found if is_connector(d["class_name"])]
    counts = {}
    for detection in symbols:
        counts[detection["class_name"]] = counts.get(detection["class_name"], 0) + 1
    logger.info(
        "YOLO detected %s symbols and %s connector components on %sx%s",
        len(symbols),
        len(connectors),
        picture.width,
        picture.height,
    )
    return {
        "ok": True,
        "source": SOURCE_NAME,
        "width": picture.width,
        "height": picture.height,
        "imgsz": imgsz,
        "conf": conf,
        "device": chosen_device,
        "weights": getattr(model, "ckpt_path", None) or str(weights_path()),
        "class_names": {str(key): value for key, value in sorted(names.items())},
        "class_counts": counts,
        "symbols": symbols,
        "connectors": connectors,
        "detections": found,
    }


def symbols_to_nodes(symbols):
    """Symbol detections as internal recognition nodes (labels still placeholders).

    Class identity and geometry come from the detector; the label is filled in by
    the fusion step when a text source can be associated with the symbol, and
    stays an explicit placeholder when it cannot.
    """
    nodes = []
    ordinals = {}
    for index, detection in enumerate(symbols):
        node_type = symbol_type(detection["class_name"])
        if node_type is None:
            continue
        ordinals[node_type] = ordinals.get(node_type, 0) + 1
        x1, y1, x2, y2 = detection["bbox"]
        nodes.append(
            {
                "id": f"{SOURCE_NAME}_n{index + 1}",
                "type": node_type,
                "label": placeholder_label(node_type, ordinals[node_type]),
                "attributes": [],
                "methods": [],
                # Raw pixel geometry; the canonical layout re-places and re-sizes
                # every shape from its text, as it does for the vision sources.
                "position": {"x": x1, "y": y1},
                "size": {"width": max(1.0, x2 - x1), "height": max(1.0, y2 - y1)},
                "bbox": [x1, y1, x2, y2],
                "confidence": detection["confidence"],
                "sources": [SOURCE_NAME],
                "style": default_style(),
                # Internal only — dropped by the canonical converter.
                "class_name": detection["class_name"],
                "placeholder": True,
            }
        )
    return nodes
