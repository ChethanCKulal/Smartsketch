"""Fuse the trained flowchart detector with the Groq vision service.

The detector answers *what* each symbol is — six trained classes with
pixel-accurate boxes. Groq answers *what it says* and *what connects to what*.
This module is the narrow seam between the two, and it is deliberately not the
reconciliation engine: that engine matches two peer vision services against each
other by label/type/box, while here one side is authoritative about class and
geometry and the other only supplies text and candidate relationships.

Three rules drive it:

* **Symbols come from the detector.** Groq never creates a flowchart node; its
  boxes are only used to find the symbol that carries a label.
* **The two sources are brought into one coordinate frame before they are
  compared.** Vision providers answer in whatever space they like — pixels,
  roughly 0-1000 units, or fractions — and they do not agree on the image's
  scale. So the payload's own boxes are tested against four interpretations and
  the one whose boxes actually line up with the detected symbols is used, with
  the winner reported in ``report["match"]["coordinate_space"]``. Guessing, or
  comparing raw numbers from two different spaces, is what makes labels land on
  the wrong shape.
* **Ambiguity is reported, never guessed.** A label or connection is only
  accepted when one candidate clearly wins; otherwise the symbol keeps its
  placeholder label (or the edge is dropped) and a warning says why.

The connectors the detector found are used as evidence, not decoration: an arrow
whose box reaches exactly two symbols links them, and an arrowhead at one end
says which way it points. An arrowhead on its own never creates an edge.
"""

from __future__ import annotations

import logging

from diagram.schema import canonicalize_type, default_style, enforce_family
from recognition.yolo_service import SOURCE_NAME as YOLO_SOURCE
from recognition.yolo_service import symbols_to_nodes

logger = logging.getLogger(__name__)

GROQ_SOURCE = "groq"
ENGINE = "yolo_groq_fusion"

# How well a vision-service box must agree with a detected symbol before its text
# is applied to that symbol, and how far ahead of the runner-up it must be.
MATCH_MIN = 0.34
AMBIGUITY_MARGIN = 0.10
IOU_WEIGHT = 0.65
# Share of the drawing's span within which two box centres count as the same place.
PROXIMITY_SPAN = 0.35

# Which symbols a connector reaches, expressed as a fraction of the median
# symbol diagonal so the rule follows the drawing's scale, not a pixel constant.
CONNECTOR_PAD = 0.55
MIN_PAD = 8.0
MAX_PAD_FRACTION = 0.12
# The third-nearest symbol must be this much farther away than the second, or
# the connector's pair is ambiguous and no edge is created from it.
CONNECTOR_GAP = 1.25

DEFAULT_EDGE_CONFIDENCE = 0.5
FALLBACK_SPACE = "pixels"
# A reading must be *clearly* better than the one before it to displace it, so
# near-identical interpretations (a payload whose own frame happens to coincide
# with the drawing's) keep the most literal reading rather than flipping on
# floating-point noise.
SPACE_MARGIN = 1e-3


def _clean(value):
    return str(value or "").strip()


def _key(value):
    return " ".join(_clean(value).split()).lower()


def _bbox(value):
    if not isinstance(value, (list, tuple)) or len(value) < 4:
        return None
    try:
        x1, y1, x2, y2 = (float(v) for v in value[:4])
    except (TypeError, ValueError):
        return None
    return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))


def _payload_list(payload, *keys):
    if not isinstance(payload, dict):
        return []
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _extent(boxes):
    known = [box for box in boxes if box]
    if not known:
        return None
    min_x = min(box[0] for box in known)
    min_y = min(box[1] for box in known)
    max_x = max(box[2] for box in known)
    max_y = max(box[3] for box in known)
    return min_x, min_y, max(1e-6, max_x - min_x), max(1e-6, max_y - min_y)


def _span(boxes):
    extent = _extent(boxes)
    return max(extent[2], extent[3]) if extent else 1.0


def _relative(box, extent):
    """A box in the normalised frame of its own set (0-1 on both axes)."""
    if not box or not extent:
        return None
    min_x, min_y, span_x, span_y = extent
    return (
        (box[0] - min_x) / span_x,
        (box[1] - min_y) / span_y,
        (box[2] - min_x) / span_x,
        (box[3] - min_y) / span_y,
    )


def _iou(a, b):
    if not a or not b:
        return 0.0
    inter_x = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    inter_y = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = inter_x * inter_y
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _score(a, b, span):
    """How strongly two boxes, already in the same frame, describe the same item."""
    if not a or not b:
        return 0.0
    distance = (((a[0] + a[2]) / 2 - (b[0] + b[2]) / 2) ** 2 + ((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2) ** 2) ** 0.5
    proximity = max(0.0, 1.0 - distance / (PROXIMITY_SPAN * max(span, 1e-6)))
    return IOU_WEIGHT * _iou(a, b) + (1.0 - IOU_WEIGHT) * proximity


def _scale(box, factor_x, factor_y):
    return (box[0] * factor_x, box[1] * factor_y, box[2] * factor_x, box[3] * factor_y)


def _through(box, source_extent, target_extent):
    """Map a box from one set's normalised frame into another set's frame."""
    relative = _relative(box, source_extent)
    return (
        target_extent[0] + relative[0] * target_extent[2],
        target_extent[1] + relative[1] * target_extent[3],
        target_extent[0] + relative[2] * target_extent[2],
        target_extent[1] + relative[3] * target_extent[3],
    )


def _space_interpretations(symbol_boxes, payload_boxes, image_size):
    """Every plausible reading of a vision payload's numbers, in preference order."""
    width, height = image_size or (0, 0)
    yield "pixels", lambda box: box
    if width and height:
        yield "fraction", lambda box: _scale(box, width, height)
        yield "thousand", lambda box: _scale(box, width / 1000.0, height / 1000.0)
    symbol_extent = _extent(symbol_boxes)
    payload_extent = _extent(payload_boxes)
    if symbol_extent and payload_extent and payload_extent != symbol_extent:
        # The payload's own frame mapped onto the drawing's: what the canonical
        # layout does with positions, applied to matching instead.
        yield "relative", lambda box, source=payload_extent: _through(box, source, symbol_extent)


def choose_space(groq_boxes, symbol_boxes, image_size):
    """Pick the reading under which the vision boxes actually line up.

    Returns ``(name, mapped_boxes, evidence)``: the chosen space, the boxes
    mapped into the image's pixel frame, and how well that reading agreed. A
    payload with one box in the wrong place cannot drag the choice along, because
    every candidate is judged over all of its boxes against all detected symbols.
    """
    known = [box for box in groq_boxes if box]
    span = _span(symbol_boxes)
    best = (FALLBACK_SPACE, known, 0.0)
    best_score = -1.0
    for name, transform in _space_interpretations(symbol_boxes, known, image_size):
        try:
            mapped = [transform(box) for box in known]
        except (TypeError, ValueError):  # a malformed payload is never fatal
            continue
        if not mapped:
            continue
        score = sum(max((_score(box, symbol, span) for symbol in symbol_boxes), default=0.0) for box in mapped) / len(mapped)
        if score > best_score + SPACE_MARGIN:
            best, best_score = (name, mapped, score), score
    return best


def _confidence(value, fallback=DEFAULT_EDGE_CONFIDENCE):
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return fallback


def _arrow(value):
    lowered = _clean(value).lower()
    if lowered in {"bidirectional", "both"}:
        return "both"
    if lowered in {"none", "undirected", ""}:
        return "none"
    if lowered == "backward":
        return "backward"
    return "forward"


def _label_of(entry):
    return _clean(entry.get("label") or entry.get("text") or entry.get("name"))


def _family_type(value):
    """A vision service's declared shape pulled into the flowchart vocabulary."""
    return enforce_family(canonicalize_type(value, "flowchart"), "flowchart")


def match_labels(nodes, groq_entries, image_size, warnings, disagreements):
    """Apply the text source's labels to the detected symbols.

    Returns ``(id_map, label_map, stats)``: ``id_map`` maps the text source's own
    node ids onto detected symbol ids and ``label_map`` maps a resolved label
    onto a symbol id, so relationships can later be resolved by either reference.

    Where the two sources disagree about a symbol's *shape*, the detector's class
    is what the node keeps (that is what it was trained for) and the difference
    is recorded in ``disagreements`` rather than swallowed.
    """
    symbol_boxes = [node.get("bbox") for node in nodes]
    space, mapped, evidence = choose_space(
        [_bbox(entry.get("bbox") or entry.get("bounding_box")) for entry in groq_entries],
        symbol_boxes,
        image_size,
    )
    span = _span(symbol_boxes)
    stats = {
        "candidates": len(groq_entries),
        "matched": 0,
        "ambiguous": 0,
        "unlabeled": 0,
        "unmatched": 0,
        "type_disagreements": 0,
        "coordinate_space": space,
        "coordinate_evidence": round(evidence, 3),
    }
    id_map, label_map, used = {}, {}, set()

    for index, node in enumerate(nodes):
        best = runner_up = None
        for other in range(len(mapped)):
            if other in used:
                continue
            score = _score(mapped[other], symbol_boxes[index], span)
            if best is None or score > best[0]:
                best, runner_up = (score, other), best
            elif runner_up is None or score > runner_up[0]:
                runner_up = (score, other)
        if best is None or best[0] < MATCH_MIN:
            continue
        if runner_up is not None and best[0] - runner_up[0] < AMBIGUITY_MARGIN:
            # Two readings of the payload fit this symbol about equally well:
            # leave the placeholder rather than write the wrong text onto it.
            stats["ambiguous"] += 1
            rival = _label_of(groq_entries[best[1]]) or _label_of(groq_entries[runner_up[1]])
            warnings.append(
                f"Text '{rival or 'unlabeled box'}' fits more than one detected symbol, "
                f"so the symbol near {_point(node)} keeps its placeholder name."
            )
            continue
        entry = groq_entries[best[1]]
        used.add(best[1])
        groq_id = _clean(entry.get("id"))
        if groq_id:
            id_map[groq_id] = node["id"]
        label = _label_of(entry)
        if not label:
            stats["unlabeled"] += 1
            continue
        node["label"] = label
        node["placeholder"] = False
        node["sources"] = sorted(set(node["sources"] + [GROQ_SOURCE]))
        label_map[_key(label)] = node["id"]
        stats["matched"] += 1
        declared = _clean(entry.get("type") or entry.get("shape"))
        vision_type = _family_type(declared) if declared else None
        if vision_type and vision_type != node["type"]:
            stats["type_disagreements"] += 1
            disagreements.append(
                {
                    "kind": "node_type",
                    "symbol": node["id"],
                    "text": label,
                    "detector": node["type"],
                    "vision": vision_type,
                    "chosen": node["type"],
                }
            )

    stats["unmatched"] = max(
        0, len(groq_entries) - stats["matched"] - stats["ambiguous"] - stats["unlabeled"]
    )
    return id_map, label_map, stats


def _point(node):
    return f"({int(node['position']['x'])}, {int(node['position']['y'])})"


def _box_distance(a, b):
    """Gap between two boxes in pixels (0 when they touch or overlap)."""
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return (dx * dx + dy * dy) ** 0.5


def _text_edges(entries, id_map, label_map, pairs, warnings, stats):
    """The text source's relationships, kept only between real detected symbols."""
    edges = []
    for raw in entries:
        source_ref = _clean(raw.get("source") or raw.get("from"))
        target_ref = _clean(raw.get("target") or raw.get("to"))
        source = id_map.get(source_ref) or label_map.get(_key(source_ref))
        target = id_map.get(target_ref) or label_map.get(_key(target_ref))
        if not source or not target:
            stats["edges_rejected"] += 1
            continue
        if source == target:
            stats["self_loops"] += 1
            warnings.append(f"Ignored a connection {source_ref} → {target_ref} that points at one symbol.")
            continue
        if tuple(sorted((source, target))) in pairs:
            continue
        edge = {
            "id": f"edge_txt_{len(edges) + 1}",
            "source": source,
            "target": target,
            "label": _clean(raw.get("label") or raw.get("text")),
            "arrow": _arrow(raw.get("arrow") or raw.get("direction")),
            "lineStyle": "solid",
            "confidence": _confidence(raw.get("confidence")),
            "sources": [GROQ_SOURCE],
            "style": default_style(),
        }
        pairs[tuple(sorted((source, target)))] = edge
        edges.append(edge)
    return edges


def _arrowhead_targets(connectors, arrows, pad):
    """Which arrow each arrowhead belongs to, keyed by the arrow's index."""
    targets = {}
    for head in [c for c in connectors if _clean(c.get("class_name")).lower() == "arrowhead"]:
        head_box = _bbox(head.get("bbox"))
        if not head_box:
            continue
        ranked = sorted(
            (_box_distance(head_box, _bbox(arrow.get("bbox")) or head_box), index)
            for index, arrow in enumerate(arrows)
        )
        if not ranked or ranked[0][0] > pad:
            continue  # an arrowhead that reaches no arrow in this drawing
        if len(ranked) > 1 and ranked[1][0] <= ranked[0][0] * 1.5:
            continue  # two arrows are equally close: the direction stays unknown
        targets.setdefault(ranked[0][1], []).append(head_box)
    return targets


def _direction(tips, first, second):
    """Turn the arrowheads reaching a connector into (source, target, arrow)."""
    if tips == {first["id"], second["id"]}:
        return first["id"], second["id"], "both"
    target = tips.pop() if tips else None
    if target == first["id"]:
        return second["id"], first["id"], "forward"
    if target == second["id"]:
        return first["id"], second["id"], "forward"
    return first["id"], second["id"], "none"


def _arrow_edges(connectors, nodes, pairs, image_size, warnings, stats):
    """Edges from the connector components the detector itself found."""
    arrows = [c for c in connectors if _clean(c.get("class_name")).lower() == "arrow"]
    if not arrows or len(nodes) < 2:
        return []

    diagonals = sorted(
        ((node["bbox"][2] - node["bbox"][0]) ** 2 + (node["bbox"][3] - node["bbox"][1]) ** 2) ** 0.5
        for node in nodes
    )
    median = diagonals[len(diagonals) // 2]
    image_diagonal = (image_size[0] ** 2 + image_size[1] ** 2) ** 0.5
    pad = min(max(CONNECTOR_PAD * median, MIN_PAD), MAX_PAD_FRACTION * image_diagonal)
    heads = _arrowhead_targets(connectors, arrows, pad)

    edges = []
    for index, arrow in enumerate(arrows):
        arrow_box = _bbox(arrow.get("bbox"))
        if not arrow_box:
            continue
        ranked = sorted(
            (_box_distance(arrow_box, _bbox(node.get("bbox")) or arrow_box), position)
            for position, node in enumerate(nodes)
        )
        if len(ranked) < 2 or ranked[0][0] > pad or ranked[1][0] > pad:
            stats["connectors_dangling"] += 1
            continue
        if len(ranked) > 2 and ranked[2][0] <= ranked[1][0] * CONNECTOR_GAP:
            stats["connectors_ambiguous"] += 1
            continue

        first, second = nodes[ranked[0][1]], nodes[ranked[1][1]]
        arrowheads = heads.get(index) or []
        tips = set()
        if arrowheads:
            first_gap = min(_box_distance(head, first["bbox"]) for head in arrowheads)
            second_gap = min(_box_distance(head, second["bbox"]) for head in arrowheads)
            if len(arrowheads) > 1 and abs(first_gap - second_gap) < 1e-6:
                tips = {first["id"], second["id"]}
            else:
                tips = {first["id"]} if first_gap < second_gap else {second["id"]}
        source, target, direction = _direction(tips, first, second)

        pair = tuple(sorted((first["id"], second["id"])))
        if pair in pairs:
            # The relationships already connect these two; a real arrowhead can
            # still supply the direction the text left unstated.
            existing = pairs[pair]
            if existing["arrow"] == "none" and direction != "none":
                existing["arrow"] = direction
                existing["sources"] = sorted(set(existing["sources"] + [YOLO_SOURCE]))
                stats["directions_confirmed"] += 1
            continue
        if direction == "none":
            # Two symbols are linked, but nothing here says which way the flow
            # runs: the edge is drawn without an arrowhead rather than guessed.
            stats["connectors_without_direction"] += 1
        edge = {
            "id": f"edge_arrow_{len(edges) + 1}",
            "source": source,
            "target": target,
            "label": "",
            "arrow": direction,
            "lineStyle": "solid",
            # The evidence supports the link, not a reading: confidence is capped
            # by the weakest of the arrow and the two symbols it reached.
            "confidence": _confidence(
                min(
                    arrow.get("confidence", DEFAULT_EDGE_CONFIDENCE),
                    first.get("confidence", DEFAULT_EDGE_CONFIDENCE),
                    second.get("confidence", DEFAULT_EDGE_CONFIDENCE),
                ),
                0.4,
            ),
            "sources": [YOLO_SOURCE],
            "style": default_style(),
        }
        pairs[pair] = edge
        edges.append(edge)

    stats["edges_from_arrows"] = len(edges)
    if stats["connectors_dangling"]:
        warnings.append(
            f"{stats['connectors_dangling']} arrow(s) reached fewer than two detected symbols, "
            "so no connection was added for them."
        )
    if stats["connectors_ambiguous"]:
        warnings.append(
            f"{stats['connectors_ambiguous']} arrow(s) sat between more than two detected symbols; "
            "no connection was guessed for them."
        )
    return edges


def fuse_flowchart(detection, groq_payload=None, groq_ok=True, warnings=None):
    """Build the internal recognition payload for the flowchart path.

    ``detection`` is :func:`recognition.yolo_service.detect`'s result and
    ``groq_payload`` the payload of a Groq call (``None`` when text extraction
    failed). The result carries the keys the vision path produces (``ok``,
    ``source``, ``diagram_type``, ``nodes``, ``edges``) plus a ``report`` that
    says what came from where.
    """
    warnings = list(warnings or [])
    nodes = symbols_to_nodes(detection.get("symbols") or [])
    stats = {
        "engine": ENGINE,
        "symbols": len(nodes),
        "connectors": len(detection.get("connectors") or []),
        "match": {"candidates": 0, "matched": 0, "ambiguous": 0, "unlabeled": 0, "unmatched": 0, "type_disagreements": 0},
        "edges_from_text": 0,
        "edges_from_arrows": 0,
        "edges_rejected": 0,
        "self_loops": 0,
        "directions_confirmed": 0,
        "connectors_dangling": 0,
        "connectors_ambiguous": 0,
        "connectors_without_direction": 0,
        "text_source_used": bool(groq_payload),
        "labels_are_placeholders": False,
    }
    if not nodes:
        return {
            "ok": False,
            "code": "no_symbols",
            "source": YOLO_SOURCE,
            "diagram_type": "flowchart",
            "error": "The trained detector found no flowchart symbols in this image.",
            "nodes": [],
            "edges": [],
            "warnings": warnings,
            "report": stats,
        }

    pairs = {}
    edges = []
    disagreements = []
    if groq_payload:
        id_map, label_map, match_stats = match_labels(
            nodes,
            _payload_list(groq_payload, "nodes", "entities"),
            (detection.get("width") or 0, detection.get("height") or 0),
            warnings,
            disagreements,
        )
        stats["match"] = match_stats
        edges.extend(
            _text_edges(
                _payload_list(groq_payload, "edges", "connectors", "relationships"),
                id_map,
                label_map,
                pairs,
                warnings,
                stats,
            )
        )
    elif not groq_ok:
        warnings.append(
            "Text labels and relationships could not be read from the image, so the detected "
            "shapes carry placeholder names (they are not extracted text) and only connections "
            "visible in the drawing itself are drawn."
        )
    stats["edges_from_text"] = len(edges)
    # A payload can also arrive and read nothing at all. That used to pass in
    # silence: the shapes kept their placeholder names while the response looked
    # like a success, and the only clues were two zeros in the report.
    if groq_ok and not stats["match"]["matched"] and not stats["edges_from_text"]:
        warnings.append("The text source returned no labels or relationships for this drawing.")

    edges.extend(
        _arrow_edges(
            detection.get("connectors") or [],
            nodes,
            pairs,
            (detection.get("width") or 1, detection.get("height") or 1),
            warnings,
            stats,
        )
    )
    stats["labels_are_placeholders"] = not any(not node.get("placeholder") for node in nodes)

    return {
        "ok": True,
        "source": YOLO_SOURCE,
        "diagram_type": "flowchart",
        "nodes": nodes,
        "edges": edges,
        "warnings": warnings,
        "disagreements": disagreements,
        "report": stats,
    }
