from .schema import canonicalize_type, default_style, empty_diagram


def _bbox_to_position(bbox):
    if not bbox or not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
        return {"x": 80, "y": 80}, {"width": 160, "height": 72}
    x1, y1, x2, y2 = [float(v) for v in bbox[:4]]
    return {"x": min(x1, x2), "y": min(y1, y2)}, {
        "width": max(40, abs(x2 - x1)),
        "height": max(28, abs(y2 - y1)),
    }


def normalize_source_payload(payload, source_name, requested_type=None):
    """Map a vision-service payload onto the internal recognition schema."""
    if not isinstance(payload, dict):
        return {
            "ok": False,
            "source": source_name,
            "error": "Payload is not an object.",
            "diagram_type": requested_type or "unknown",
            "nodes": [],
            "edges": [],
        }

    diagram_type = str(payload.get("diagram_type") or requested_type or "unknown").lower()
    if diagram_type in {"class", "uml_class", "class_diagram"}:
        diagram_type = "uml"
    if diagram_type in {"entity_relationship", "erd"}:
        diagram_type = "er"
    if diagram_type in {"data_flow", "data-flow"}:
        diagram_type = "dfd"

    nodes = []
    for index, raw in enumerate(payload.get("nodes") or []):
        if not isinstance(raw, dict):
            continue
        bbox = raw.get("bbox") or raw.get("bounding_box")
        position, size = _bbox_to_position(bbox)
        if isinstance(raw.get("position"), dict):
            position = {
                "x": float(raw["position"].get("x", position["x"])),
                "y": float(raw["position"].get("y", position["y"])),
            }
        if isinstance(raw.get("size"), dict):
            size = {
                "width": float(raw["size"].get("width", size["width"])),
                "height": float(raw["size"].get("height", size["height"])),
            }
        label = str(raw.get("label") or raw.get("text") or raw.get("name") or f"Node {index + 1}")
        node_type = canonicalize_type(raw.get("type") or raw.get("shape"), diagram_type)
        confidence = raw.get("confidence")
        try:
            confidence = float(confidence) if confidence is not None else 0.5
        except (TypeError, ValueError):
            confidence = 0.5
        nodes.append(
            {
                "id": str(raw.get("id") or f"{source_name[0]}_n{index + 1}"),
                "type": node_type,
                "label": label,
                "attributes": list(raw.get("attributes") or []),
                "methods": list(raw.get("methods") or []),
                "position": position,
                "size": size,
                "bbox": bbox,
                "confidence": max(0.0, min(1.0, confidence)),
                "sources": [source_name],
                "style": default_style(),
            }
        )

    id_set = {n["id"] for n in nodes}
    label_map = {n["label"].strip().lower(): n["id"] for n in nodes}
    edges = []
    for index, raw in enumerate(payload.get("edges") or payload.get("connectors") or payload.get("relationships") or []):
        if not isinstance(raw, dict):
            continue
        source = str(raw.get("source") or raw.get("from") or "")
        target = str(raw.get("target") or raw.get("to") or "")
        if source not in id_set:
            source = label_map.get(source.strip().lower(), source)
        if target not in id_set:
            target = label_map.get(target.strip().lower(), target)
        if source not in id_set or target not in id_set:
            continue
        confidence = raw.get("confidence")
        try:
            confidence = float(confidence) if confidence is not None else 0.5
        except (TypeError, ValueError):
            confidence = 0.5
        arrow = str(raw.get("arrow") or raw.get("direction") or "forward").lower()
        if arrow in {"bidirectional", "both"}:
            arrow = "both"
        elif arrow in {"none", "undirected"}:
            arrow = "none"
        else:
            arrow = "forward"
        edges.append(
            {
                "id": str(raw.get("id") or f"{source_name[0]}_e{index + 1}"),
                "source": source,
                "target": target,
                "label": str(raw.get("label") or raw.get("text") or ""),
                "arrow": arrow,
                "lineStyle": str(raw.get("lineStyle") or "solid"),
                "confidence": max(0.0, min(1.0, confidence)),
                "sources": [source_name],
                "style": default_style(),
            }
        )

    return {
        "ok": True,
        "source": source_name,
        "diagram_type": diagram_type,
        "nodes": nodes,
        "edges": edges,
        "raw": payload,
    }


def to_canonical_diagram(normalized):
    diagram = empty_diagram(normalized.get("diagram_type") or "flowchart")
    diagram["nodes"] = []
    for node in normalized.get("nodes") or []:
        diagram["nodes"].append(
            {
                "id": node["id"],
                "type": node["type"],
                "label": node["label"],
                "position": node["position"],
                "size": node["size"],
                "style": node.get("style") or default_style(),
                "attributes": node.get("attributes") or [],
                "methods": node.get("methods") or [],
                "locked": False,
                "parentId": None,
                "confidence": node.get("confidence"),
                "sources": node.get("sources") or [],
            }
        )
    diagram["edges"] = []
    ids = {n["id"] for n in diagram["nodes"]}
    for edge in normalized.get("edges") or []:
        if edge["source"] in ids and edge["target"] in ids:
            diagram["edges"].append(
                {
                    "id": edge["id"],
                    "source": edge["source"],
                    "target": edge["target"],
                    "label": edge.get("label") or "",
                    "arrow": edge.get("arrow") or "forward",
                    "lineStyle": edge.get("lineStyle") or "solid",
                    "style": edge.get("style") or default_style(),
                    "confidence": edge.get("confidence"),
                    "sources": edge.get("sources") or [],
                }
            )
    _spread_if_collapsed(diagram)
    return diagram


def _spread_if_collapsed(diagram):
    nodes = diagram.get("nodes") or []
    if len(nodes) < 2:
        return
    xs = [n["position"]["x"] for n in nodes]
    ys = [n["position"]["y"] for n in nodes]
    if max(xs) - min(xs) > 40 or max(ys) - min(ys) > 40:
        return
    cols = max(1, int(len(nodes) ** 0.5))
    for index, node in enumerate(nodes):
        node["position"] = {"x": 80 + (index % cols) * 220, "y": 80 + (index // cols) * 140}
