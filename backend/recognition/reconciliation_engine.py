"""Deterministic reconciliation of independent vision sources.

Weighting is isolated in WeightStrategy so it can be swapped later.
Neither source overwrites the other; a new merged structure is produced.
"""

from copy import deepcopy
from difflib import SequenceMatcher

from diagram.normalizer import merge_members


class WeightStrategy:
    def __init__(self, weights=None):
        self.weights = weights or {"gemini": 1.0, "huggingface": 0.95}

    def source_weight(self, source):
        return float(self.weights.get(source, 0.8))

    def combine_agreeing(self, conf_a, weight_a, conf_b, weight_b):
        total = weight_a + weight_b
        if total <= 0:
            return max(conf_a, conf_b)
        mixed = (conf_a * weight_a + conf_b * weight_b) / total
        # Agreement boosts confidence without exceeding 1.
        return min(1.0, mixed + 0.05)

    def choose_disagreement(self, item_a, item_b):
        score_a = item_a["confidence"] * self.source_weight(item_a["sources"][0])
        score_b = item_b["confidence"] * self.source_weight(item_b["sources"][0])
        if abs(score_a - score_b) < 0.04:
            # Deterministic tie-break: denser label, then gemini, then lexical id.
            if len(item_a.get("label", "")) != len(item_b.get("label", "")):
                return item_a if len(item_a.get("label", "")) >= len(item_b.get("label", "")) else item_b
            if "gemini" in item_a["sources"]:
                return item_a
            if "huggingface" in item_b["sources"]:
                return item_b
            return item_a if item_a["id"] <= item_b["id"] else item_b
        return item_a if score_a >= score_b else item_b


def _sim(a, b):
    return SequenceMatcher(None, (a or "").lower().strip(), (b or "").lower().strip()).ratio()


def _bbox_iou(a, b):
    if not a or not b or len(a) < 4 or len(b) < 4:
        return 0.0
    ax1, ay1, ax2, ay2 = a[:4]
    bx1, by1, bx2, by2 = b[:4]
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union else 0.0


def _node_score(a, b):
    return 0.55 * _sim(a.get("label"), b.get("label")) + 0.2 * (1.0 if a.get("type") == b.get("type") else 0.0) + 0.25 * _bbox_iou(a.get("bbox"), b.get("bbox"))


def reconcile(source_results, strategy=None):
    strategy = strategy or WeightStrategy()
    warnings = []
    disagreements = []
    sources_used = []
    usable = []

    for result in source_results:
        if result.get("ok") and (result.get("nodes") or result.get("edges")):
            usable.append(result)
            sources_used.append(result["source"])
        elif result.get("ok") and not result.get("nodes"):
            warnings.append(f"{result['source']} returned no nodes.")
            sources_used.append(result["source"])
        else:
            warnings.append(result.get("error") or f"{result.get('source')} failed.")

    if not usable:
        return {
            "ok": False,
            "error": "Both recognition sources failed or returned empty results.",
            "warnings": warnings,
            "disagreements": disagreements,
            "sources_used": [],
            "nodes": [],
            "edges": [],
            "diagram_type": "unknown",
        }

    if len(usable) == 1:
        only = deepcopy(usable[0])
        only["warnings"] = warnings
        only["disagreements"] = disagreements
        only["sources_used"] = sources_used
        only["partial"] = True
        return only

    left, right = usable[0], usable[1]
    matched_right = set()
    merged_nodes = []
    id_map_left = {}
    id_map_right = {}

    for i, node_a in enumerate(left["nodes"]):
        best_j, best = None, 0.0
        for j, node_b in enumerate(right["nodes"]):
            if j in matched_right:
                continue
            score = _node_score(node_a, node_b)
            if score > best:
                best, best_j = score, j
        if best_j is not None and best >= 0.45:
            matched_right.add(best_j)
            node_b = right["nodes"][best_j]
            merged = _merge_nodes(node_a, node_b, strategy, disagreements)
            new_id = f"node_{len(merged_nodes) + 1}"
            id_map_left[node_a["id"]] = new_id
            id_map_right[node_b["id"]] = new_id
            merged["id"] = new_id
            merged_nodes.append(merged)
        else:
            clone = deepcopy(node_a)
            new_id = f"node_{len(merged_nodes) + 1}"
            id_map_left[node_a["id"]] = new_id
            clone["id"] = new_id
            merged_nodes.append(clone)

    for j, node_b in enumerate(right["nodes"]):
        if j in matched_right:
            continue
        clone = deepcopy(node_b)
        new_id = f"node_{len(merged_nodes) + 1}"
        id_map_right[node_b["id"]] = new_id
        clone["id"] = new_id
        merged_nodes.append(clone)

    merged_edges = _merge_edges(left, right, id_map_left, id_map_right, strategy, disagreements)

    type_votes = [left.get("diagram_type"), right.get("diagram_type")]
    diagram_type = type_votes[0] if type_votes[0] == type_votes[1] else _pick_type(left, right, strategy)
    if type_votes[0] != type_votes[1]:
        disagreements.append(
            {
                "kind": "diagram_type",
                "gemini": left.get("diagram_type") if left["source"] == "gemini" else right.get("diagram_type"),
                "huggingface": left.get("diagram_type") if left["source"] == "huggingface" else right.get("diagram_type"),
                "chosen": diagram_type,
            }
        )

    return {
        "ok": True,
        "diagram_type": diagram_type,
        "nodes": merged_nodes,
        "edges": merged_edges,
        "warnings": warnings,
        "disagreements": disagreements,
        "sources_used": sources_used,
        "partial": False,
    }


def _merge_nodes(a, b, strategy, disagreements):
    # Synthetic "L"/"R" ids: source ids may collide across services (both may emit "n1"),
    # so the winner must be identified by side, never by the original id.
    chosen = strategy.choose_disagreement(
        {"confidence": a["confidence"], "sources": a["sources"], "label": a["label"], "id": "L", "item": a},
        {"confidence": b["confidence"], "sources": b["sources"], "label": b["label"], "id": "R", "item": b},
    )
    primary = a if chosen["id"] == "L" else b
    secondary = b if primary is a else a
    label_agree = _sim(a["label"], b["label"]) >= 0.72
    type_agree = a["type"] == b["type"]
    if not label_agree or not type_agree:
        disagreements.append(
            {
                "kind": "node",
                "left": {"label": a["label"], "type": a["type"], "source": a["sources"][0], "confidence": a["confidence"]},
                "right": {"label": b["label"], "type": b["type"], "source": b["sources"][0], "confidence": b["confidence"]},
                "chosen": {"label": primary["label"], "type": primary["type"]},
            }
        )
    merged = deepcopy(primary)
    # Keep every member either service found — a UML class must not lose the
    # methods that only one model read out of its second compartment.
    for field in ("attributes", "methods"):
        merged[field] = merge_members((a.get(field) or []) + (b.get(field) or []))
    merged["sources"] = sorted(set(a.get("sources") + b.get("sources")))
    if label_agree and type_agree:
        merged["confidence"] = strategy.combine_agreeing(
            a["confidence"], strategy.source_weight(a["sources"][0]),
            b["confidence"], strategy.source_weight(b["sources"][0]),
        )
    else:
        merged["confidence"] = primary["confidence"]
    # Average geometry when both bboxes exist.
    if a.get("bbox") and b.get("bbox") and len(a["bbox"]) >= 4 and len(b["bbox"]) >= 4:
        merged["bbox"] = [(a["bbox"][i] + b["bbox"][i]) / 2 for i in range(4)]
        x1, y1, x2, y2 = merged["bbox"]
        merged["position"] = {"x": min(x1, x2), "y": min(y1, y2)}
        merged["size"] = {"width": max(40, abs(x2 - x1)), "height": max(28, abs(y2 - y1))}
    return merged


def _merge_edges(left, right, map_l, map_r, strategy, disagreements):
    used_r = set()
    merged = []
    for edge_a in left["edges"]:
        key_a = (map_l.get(edge_a["source"]), map_l.get(edge_a["target"]), (edge_a.get("label") or "").lower())
        match = None
        for j, edge_b in enumerate(right["edges"]):
            if j in used_r:
                continue
            key_b = (map_r.get(edge_b["source"]), map_r.get(edge_b["target"]), (edge_b.get("label") or "").lower())
            undirected_a = tuple(sorted(key_a[:2]))
            undirected_b = tuple(sorted(key_b[:2]))
            if undirected_a == undirected_b:
                match = (j, edge_b)
                break
        clone = deepcopy(edge_a)
        clone["source"] = map_l.get(edge_a["source"], edge_a["source"])
        clone["target"] = map_l.get(edge_a["target"], edge_a["target"])
        if match:
            used_r.add(match[0])
            edge_b = match[1]
            clone["sources"] = sorted(set(edge_a["sources"] + edge_b["sources"]))
            if (edge_a.get("label") or "") != (edge_b.get("label") or "") or edge_a.get("arrow") != edge_b.get("arrow"):
                disagreements.append({"kind": "edge", "left": edge_a, "right": edge_b})
                winner = strategy.choose_disagreement(
                    {"confidence": edge_a["confidence"], "sources": edge_a["sources"], "label": edge_a.get("label", ""), "id": "L"},
                    {"confidence": edge_b["confidence"], "sources": edge_b["sources"], "label": edge_b.get("label", ""), "id": "R"},
                )
                if winner["id"] == "R":
                    clone["label"] = edge_b.get("label", "")
                    clone["arrow"] = edge_b.get("arrow", "forward")
                    clone["source"] = map_r.get(edge_b["source"], clone["source"])
                    clone["target"] = map_r.get(edge_b["target"], clone["target"])
            else:
                clone["confidence"] = strategy.combine_agreeing(
                    edge_a["confidence"], strategy.source_weight(edge_a["sources"][0]),
                    edge_b["confidence"], strategy.source_weight(edge_b["sources"][0]),
                )
        clone["id"] = f"edge_{len(merged) + 1}"
        merged.append(clone)
    for j, edge_b in enumerate(right["edges"]):
        if j in used_r:
            continue
        clone = deepcopy(edge_b)
        clone["source"] = map_r.get(edge_b["source"], edge_b["source"])
        clone["target"] = map_r.get(edge_b["target"], edge_b["target"])
        clone["id"] = f"edge_{len(merged) + 1}"
        merged.append(clone)
    return merged


def _pick_type(left, right, strategy):
    score_l = (sum(n["confidence"] for n in left["nodes"]) / max(1, len(left["nodes"]))) * strategy.source_weight(left["source"])
    score_r = (sum(n["confidence"] for n in right["nodes"]) / max(1, len(right["nodes"]))) * strategy.source_weight(right["source"])
    return left["diagram_type"] if score_l >= score_r else right["diagram_type"]
