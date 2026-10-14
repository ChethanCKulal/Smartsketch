"""Placement for recognized diagrams.

Two problems had to be solved together, because either one alone still leaves
boxes on top of each other.

1. **The two sources do not share a coordinate space.** Gemini answers in image
   pixels; the Groq vision model answers in ~0-1000 units with its own y scale.
   Treating either as pixels inflates a box by up to ~2.4x on one side and
   shifts it on the other. Placement here is therefore *scale-independent*: a
   source's boxes are normalised against that source's own extent, so the
   drawing's arrangement survives whatever units the model chose (pixels,
   0-1000, fractions).

2. **A model's box is not a canvas box.** A photographed shape arrives as a
   bounding box the size of the ink, but the canvas draws each shape fitted to
   its text. Sizes are measured here with the same rules as the canvas
   (`frontend/src/canvas/autosize.js`), then overlaps are removed by pushing
   shapes apart while keeping their relative order — what the user drew stays
   where they drew it, just no longer on top of its neighbour.

`rel` is the intermediate unit-space position carried from normalisation to
layout; it is an internal detail and is dropped from the canonical output.
"""

import math
import os

from PIL import ImageFont

# Must match the canvas autosize rules (frontend/src/canvas/autosize.js).
MEMBER_FONT_SIZE = 11
MIN_WIDTH = 40
MIN_HEIGHT = 28
DEFAULT_FONT_SIZE = 13

# The canvas draws with Segoe UI and measures text with real font metrics, so
# sizes here are measured from the same font rather than guessed. Verified
# against browser measureText: within ~3% either way, and the margin below puts
# the estimate on the safe side (the layout must never reserve less than the
# canvas draws). Without a usable font file the per-character fallback is used.
MEASURE_MARGIN = 1.03
FONT_CANDIDATES = (
    os.getenv("SKETCH_FONT_PATH"),
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
BOLD_FONT_CANDIDATES = (
    os.getenv("SKETCH_BOLD_FONT_PATH"),
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
# Fallback advances, per character class, chosen as bounds rather than averages.
NARROW_CHARS = " iljtfr1.,'!|:;()[]{}/\\-"
WIDE_CHARS = "WMmw@%&"
FALLBACK_FACTORS = {"narrow": 0.56, "wide": 0.96, "digit": 0.55, "upper": 0.77, "lower": 0.61, "other": 0.95}

_font_cache = {}

GAP = 30  # minimum clear space between two shapes, in canvas pixels
MARGIN = 64  # clear space around the whole diagram
# Roominess of the first guess at the drawing's scale. Keeping the start roomy is
# what lets a shape stay where it was drawn: separation only nudges what the
# drawing itself left touching.
DENSITY = 2.6


def _clamp(value, low, high):
    return max(low, min(high, value))


def _load_font(size, bold=False):
    key = (int(size), bool(bold))
    if key in _font_cache:
        return _font_cache[key]
    font = None
    for path in BOLD_FONT_CANDIDATES if bold else FONT_CANDIDATES:
        if not path or not os.path.exists(path):
            continue
        try:
            font = ImageFont.truetype(path, int(size))
            break
        except OSError:  # pragma: no cover - an unreadable font is just a miss
            continue
    _font_cache[key] = font
    return font


def _fallback_width(text, size):
    total = 0.0
    for char in text:
        if char in NARROW_CHARS:
            total += FALLBACK_FACTORS["narrow"]
        elif char in WIDE_CHARS:
            total += FALLBACK_FACTORS["wide"]
        elif char.isdigit():
            total += FALLBACK_FACTORS["digit"]
        elif char.isupper():
            total += FALLBACK_FACTORS["upper"]
        elif char.islower():
            total += FALLBACK_FACTORS["lower"]
        else:
            total += FALLBACK_FACTORS["other"]
    return total * size


def _text_width(text, size, bold=False):
    longest = ""
    for line in str(text or "").split("\n"):
        if len(line) > len(longest):
            longest = line
    font = _load_font(size, bold)
    if font is not None:
        return float(font.getlength(longest)) * MEASURE_MARGIN
    return _fallback_width(longest, size) * MEASURE_MARGIN


def _widest(values, size, bold=False):
    return max((_text_width(value, size, bold) for value in values), default=0.0)


def _label_box(node, font_size, extra_width=0):
    label = str(node.get("label") or " ")
    lines = max(1, label.count("\n") + 1)
    return {
        "width": _text_width(label, font_size) + 16 + extra_width,
        "height": lines * font_size * 1.35 + 14,
    }


def estimate_size(node):
    """The box a shape needs to hold its text, mirroring the canvas rules."""
    style = node.get("style") or {}
    font_size = float(style.get("fontSize") or DEFAULT_FONT_SIZE)
    node_type = node.get("type")
    attributes = list(node.get("attributes") or [])
    methods = list(node.get("methods") or [])
    if node_type == "group":
        return None

    if node_type in ("class", "interface"):
        title = f"«interface» {node.get('label') or ''}" if node_type == "interface" else str(node.get("label") or "")
        member_width = _widest(attributes + methods, MEMBER_FONT_SIZE)
        content_width = max(_text_width(title, font_size, True), member_width)
        attr_height = max(18, len(attributes) * MEMBER_FONT_SIZE * 1.35 + 6)
        method_height = max(18, len(methods) * MEMBER_FONT_SIZE * 1.35 + 6)
        return {
            "width": int(_clamp(math.ceil(content_width + 26), 96, 460)),
            "height": int(_clamp(math.ceil(font_size * 1.35 + 12 + attr_height + method_height), 72, 560)),
        }

    if node_type in ("entity", "weakEntity", "externalEntity"):
        box = _label_box(node, font_size)
        return {
            "width": int(_clamp(math.ceil(box["width"]), 72, 420)),
            "height": int(_clamp(math.ceil(box["height"]), 40, 240)),
        }

    if node_type in ("relationship", "decision", "diamond"):
        box = _label_box(node, font_size)
        return {
            "width": int(_clamp(math.ceil(box["width"] * 1.9), 100, 460)),
            "height": int(_clamp(math.ceil(box["height"] * 1.9), 84, 320)),
        }

    if node_type in ("attribute", "usecase"):
        box = _label_box(node, font_size)
        return {
            "width": int(_clamp(math.ceil(box["width"] * 1.55), 84, 420)),
            "height": int(_clamp(math.ceil(box["height"] * 1.45), 44, 220)),
        }

    if node_type == "terminator":
        box = _label_box(node, font_size, 18)
        return {
            "width": int(_clamp(math.ceil(box["width"] * 1.25), 76, 420)),
            "height": int(_clamp(math.ceil(box["height"] * 1.2), 40, 200)),
        }

    if node_type == "document":
        box = _label_box(node, font_size)
        return {
            "width": int(_clamp(math.ceil(box["width"]), 70, 420)),
            "height": int(_clamp(math.ceil(box["height"] + 14), 48, 260)),
        }

    if node_type == "database":
        box = _label_box(node, font_size, 14)
        return {
            "width": int(_clamp(math.ceil(box["width"]), 80, 420)),
            "height": int(_clamp(math.ceil(box["height"] + 20), 52, 260)),
        }

    if node_type == "predefinedProcess":
        box = _label_box(node, font_size, 34)
        return {
            "width": int(_clamp(math.ceil(box["width"]), 90, 440)),
            "height": int(_clamp(math.ceil(box["height"]), 40, 240)),
        }

    if node_type == "dataStore":
        box = _label_box(node, font_size, 18)
        return {
            "width": int(_clamp(math.ceil(box["width"]), 90, 440)),
            "height": int(_clamp(math.ceil(box["height"]), 40, 240)),
        }

    if node_type == "io":
        box = _label_box(node, font_size)
        return {
            "width": int(_clamp(math.ceil(box["width"] * 1.3), 90, 440)),
            "height": int(_clamp(math.ceil(box["height"]), 40, 240)),
        }

    if node_type == "actor":
        box = _label_box(node, font_size)
        return {
            "width": int(_clamp(math.ceil(box["width"]), 56, 260)),
            "height": int(_clamp(math.ceil(box["height"] + 34), 76, 260)),
        }

    if node_type == "text":
        box = _label_box(node, font_size)
        return {
            "width": int(_clamp(math.ceil(box["width"]), 32, 460)),
            "height": int(_clamp(math.ceil(box["height"]), 28, 240)),
        }

    # Plain boxes (process, rectangle, package …) plus members printed below.
    box = _label_box(node, font_size)
    attrs_width = _widest(attributes, 10)
    attrs_height = len(attributes) * 13 + 6 if attributes else 0
    return {
        "width": int(_clamp(math.ceil(max(box["width"], attrs_width + 16)), MIN_WIDTH, 460)),
        "height": int(_clamp(math.ceil(box["height"] + attrs_height), MIN_HEIGHT, 560)),
    }


def _valid_bbox(value):
    if not isinstance(value, (list, tuple)) or len(value) < 4:
        return None
    try:
        x1, y1, x2, y2 = (float(v) for v in value[:4])
    except (TypeError, ValueError):
        return None
    return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))


def _grid_rel(index, count):
    """Deterministic fallback for nodes a model gave no usable box for."""
    cols = max(1, int(math.ceil(math.sqrt(count))))
    return {"x": float(index % cols) * 0.9, "y": float(index // cols) * 0.6}


def assign_relative_positions(nodes):
    """Give each node a scale-independent position from its bounding box.

    Normalising against the source's own extent makes placement independent of
    the coordinate space the model answered in, and keeps the arrangement the
    user drew: the node that was left of another stays left of it.
    """
    boxes = [_valid_bbox(node.get("bbox")) for node in nodes]
    known = [box for box in boxes if box]
    extents = set()
    if known:
        min_x = min(box[0] for box in known)
        min_y = min(box[1] for box in known)
        max_x = max(box[2] for box in known)
        max_y = max(box[3] for box in known)
        extents = (max_x - min_x, max_y - min_y)
    if len(known) < 2 or max(extents[0], extents[1]) <= 1e-6:
        # Nothing to learn from: one node, or every box identical.
        for index, node in enumerate(nodes):
            node["rel"] = _grid_rel(index, len(nodes))
        return

    span_x, span_y = extents
    # One unit for both axes keeps the drawing's aspect ratio, so a wide
    # diagram does not come back as a square.
    unit = max(span_x, span_y)
    min_x = min(box[0] for box in known)
    min_y = min(box[1] for box in known)

    missing = 0
    for node, box in zip(nodes, boxes):
        if not box:
            node["rel"] = None  # placed below the drawing, after its extent is known
            missing += 1
            continue
        node["rel"] = {
            "x": ((box[0] + box[2]) / 2 - min_x) / unit,
            "y": ((box[1] + box[3]) / 2 - min_y) / unit,
        }
        node["bbox"] = [
            (box[0] - min_x) / unit,
            (box[1] - min_y) / unit,
            (box[2] - min_x) / unit,
            (box[3] - min_y) / unit,
        ]

    if missing:
        placed = [node["rel"] for node in nodes if node.get("rel")]
        base_y = max(rel["y"] for rel in placed) + 0.35 if placed else 0.0
        base_x = min(rel["x"] for rel in placed) if placed else 0.0
        slot = 0
        for node in nodes:
            if node.get("rel") is not None:
                continue
            node["rel"] = {"x": base_x + (slot % 3) * 0.45, "y": base_y + (slot // 3) * 0.35}
            slot += 1


def _boxes_overlap(a, b, gap):
    return not (
        a["x"] + a["w"] + gap <= b["x"]
        or b["x"] + b["w"] + gap <= a["x"]
        or a["y"] + a["h"] + gap <= b["y"]
        or b["y"] + b["h"] + gap <= a["y"]
    )


def _any_overlap(nodes, boxes, gap):
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            if _boxes_overlap(boxes[i], boxes[j], gap):
                return True
    return False


def _keep_inside(boxes, margin):
    """Slide the whole arrangement inside the margins.

    Clamping each box on its own would push shapes back into the neighbours the
    previous sweep had just cleared; translating them together cannot create an
    overlap, so separation survives.
    """
    shift_x = margin - min(box["x"] for box in boxes)
    shift_y = margin - min(box["y"] for box in boxes)
    if shift_x > 0 or shift_y > 0:
        for box in boxes:
            box["x"] += shift_x if shift_x > 0 else 0.0
            box["y"] += shift_y if shift_y > 0 else 0.0


def _separate_pass(nodes, boxes, gap, margin):
    """One sweep of pairwise separation. Returns True when something moved.

    A colliding pair is pushed apart along its axis of least penetration and in
    the direction the two shapes are already ordered, so the arrangement is
    nudged, never reshuffled.
    """
    moved = False
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            a, b = boxes[i], boxes[j]
            if not _boxes_overlap(a, b, gap):
                continue
            overlap_x = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])
            overlap_y = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
            if overlap_x <= overlap_y:
                shift = (overlap_x + gap) / 2
                if b["x"] >= a["x"]:
                    a["x"] -= shift
                    b["x"] += shift
                else:
                    a["x"] += shift
                    b["x"] -= shift
            else:
                shift = (overlap_y + gap) / 2
                if b["y"] >= a["y"]:
                    a["y"] -= shift
                    b["y"] += shift
                else:
                    a["y"] += shift
                    b["y"] -= shift
            moved = True
    if moved:
        _keep_inside(boxes, margin)
    return moved


def layout_diagram(diagram, gap=GAP, margin=MARGIN, max_expansions=40, sweeps=60):
    """Place every node: fitted to its text, in its drawn arrangement, no overlaps."""
    nodes = list(diagram.get("nodes") or [])
    if not nodes:
        return diagram

    rels = []
    for index, node in enumerate(nodes):
        node["size"] = estimate_size(node) or node.get("size") or {"width": 160, "height": 72}
        rel = node.get("rel")
        if not isinstance(rel, dict) or "x" not in rel or "y" not in rel:
            rel = _grid_rel(index, len(nodes))
        rels.append({"x": float(rel["x"]), "y": float(rel["y"])})

    min_x = min(rel["x"] for rel in rels)
    min_y = min(rel["y"] for rel in rels)
    width = max(rel["x"] for rel in rels) - min_x
    height = max(rel["y"] for rel in rels) - min_y
    if width <= 0 and height <= 0:
        # Degenerate extent: spread on a grid instead of stacking every node.
        for index, rel in enumerate(rels):
            rel.update(_grid_rel(index, len(nodes)))
        min_x = min(rel["x"] for rel in rels)
        min_y = min(rel["y"] for rel in rels)
        width = max(rel["x"] for rel in rels) - min_x
        height = max(rel["y"] for rel in rels) - min_y
    width = max(width, 1.0)
    height = max(height, 1.0)

    # First guess at the drawing's scale: enough area for every fitted box.
    area = sum((node["size"]["width"] + gap) * (node["size"]["height"] + gap) for node in nodes) * DENSITY
    scale = math.sqrt(area / (width * height))

    boxes = []
    for node, rel in zip(nodes, rels):
        size = node["size"]
        boxes.append(
            {
                "x": margin + (rel["x"] - min_x) * scale - size["width"] / 2,
                "y": margin + (rel["y"] - min_y) * scale - size["height"] / 2,
                "w": float(size["width"]),
                "h": float(size["height"]),
            }
        )

    for _ in range(max_expansions):
        for _ in range(sweeps):
            if not _separate_pass(nodes, boxes, gap, margin):
                break
        if not _any_overlap(nodes, boxes, gap):
            break
        # Positions are unbounded, so scaling the arrangement about its centre
        # always opens enough room; sizes stay as fitted.
        centre_x = sum(box["x"] + box["w"] / 2 for box in boxes) / len(boxes)
        centre_y = sum(box["y"] + box["h"] / 2 for box in boxes) / len(boxes)
        for box in boxes:
            box["x"] = centre_x + (box["x"] - centre_x) * 1.08
            box["y"] = centre_y + (box["y"] - centre_y) * 1.08
        _keep_inside(boxes, margin)

    for node, box in zip(nodes, boxes):
        node["position"] = {"x": round(box["x"]), "y": round(box["y"])}
        node.pop("rel", None)
    return diagram
