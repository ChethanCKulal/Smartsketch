from .schema import canonicalize_type, default_style, empty_diagram, enforce_family

EXPLICIT_TYPES = {"flowchart", "uml", "er", "dfd"}


_VISIBILITY = ("+", "-", "#", "~")


def _looks_like_member(text):
    t = str(text or "").strip().lstrip("*•").strip()
    return bool(t) and (t[0] in _VISIBILITY or "(" in t)


def _is_method(text):
    t = str(text or "").strip().lstrip("*•").strip()
    return "(" in t or t.endswith("()")


def _member_key(value):
    text = str(value or "").strip().lstrip("*•").strip()
    text = text.lstrip("+- #~").strip()
    return " ".join(text.split()).lower()


def _same_member(a, b):
    """True when two member keys are the same member spelled in more detail.

    One model may report ``calc average`` while the other reports
    ``calc average(): double``; the signature is extra detail, not a new member.
    """
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if not longer.startswith(shorter):
        return False
    return longer[len(shorter):].lstrip().startswith(("(", ":"))


def merge_members(values):
    """Merge class-member strings, dropping cosmetic duplicates.

    The two vision services spell the same member differently (``name`` vs
    ``- name``, sometimes with a return type), so members are keyed by their
    text with visibility markers stripped, and the most detailed spelling wins.
    """
    order, chosen = [], {}
    for value in values:
        # Collapse stray whitespace so "-  Name" and "- name" render identically.
        text = " ".join(str(value or "").lstrip("*•").split())
        key = _member_key(text)
        if not key:
            continue
        match = key if key in chosen else next((k for k in order if _same_member(k, key)), None)
        if match is None:
            order.append(key)
            chosen[key] = text
        elif len(text) > len(chosen[match]):
            chosen[match] = text
    return [chosen[key] for key in order]


def _split_class_label(label):
    """Split a class label into (name, attributes, methods).

    Vision models often return a whole UML box as a single label with the
    compartments joined by newlines or pipes, which would otherwise render all
    of it in the name compartment.  Only split when the extra lines actually
    look like members, so a wrapped multi-line name is left intact.
    """
    text = str(label or "").replace("\\n", "\n")
    parts = [p.strip() for p in text.splitlines() if p.strip()]
    if len(parts) < 2:
        parts = [p.strip() for p in text.split("|") if p.strip()]
    if len(parts) < 2 or not any(_looks_like_member(p) for p in parts[1:]):
        return str(label or "").strip(), [], []
    attrs, methods = [], []
    for part in parts[1:]:
        cleaned = part.lstrip("*•").strip()
        if cleaned:
            (methods if _is_method(cleaned) else attrs).append(cleaned)
    return parts[0], attrs, methods


def _bbox_to_position(bbox):
    if not bbox or not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
        return {"x": 80, "y": 80}, {"width": 160, "height": 72}
    x1, y1, x2, y2 = [float(v) for v in bbox[:4]]
    # If coordinates are normalized in 0..1 range, scale to standard 1000px coordinate space.
    if 0 <= max(x1, y1, x2, y2) <= 1.0 and max(x1, y1, x2, y2) > 0:
        x1 *= 1000.0
        y1 *= 1000.0
        x2 *= 1000.0
        y2 *= 1000.0
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

    requested = str(requested_type or "auto").strip().lower()
    explicit = requested in EXPLICIT_TYPES
    diagram_type = str(payload.get("diagram_type") or requested or "unknown").lower()
    if diagram_type in {"class", "uml_class", "class_diagram"}:
        diagram_type = "uml"
    if diagram_type in {"entity_relationship", "erd"}:
        diagram_type = "er"
    if diagram_type in {"data_flow", "data-flow"}:
        diagram_type = "dfd"
    if explicit:
        # The user's selection is authoritative — a model that misreads the
        # family must not override it (e.g. ER misreported as flowchart).
        diagram_type = requested

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
        if explicit:
            node_type = enforce_family(node_type, requested)
        attributes = list(raw.get("attributes") or [])
        methods = list(raw.get("methods") or [])
        if node_type in {"class", "interface"}:
            # UML boxes must fill their three compartments, not the name cell.
            label, parsed_attrs, parsed_methods = _split_class_label(label)
            attributes = merge_members(attributes + parsed_attrs)
            methods = merge_members(methods + parsed_methods)
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
                "attributes": attributes,
                "methods": methods,
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
    # Final safety net: no shape outside the diagram family's vocabulary may
    # reach the canvas (e.g. a model claiming "er" while emitting rectangles).
    for node in normalized.get("nodes") or []:
        node["type"] = enforce_family(node["type"], diagram["diagram_type"])
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
    _inline_attributes_to_nodes(diagram)
    _auto_connect_attributes(diagram)
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


def _inline_attributes_to_nodes(diagram):
    """Turn attributes listed inside an ER entity into real attribute nodes.

    An ER entity is drawn as a single rectangle holding only its name, so
    attributes that a model returned inside the entity's ``attributes`` array
    would otherwise be invisible.  Each one becomes an attribute oval wired to
    its owner.
    """
    if diagram.get("diagram_type") != "er":
        return
    nodes = diagram.get("nodes") or []
    edges = diagram.get("edges") or []
    existing = {str(n.get("label") or "").strip().lower() for n in nodes if n["type"] == "attribute"}
    created = 0
    for entity in list(nodes):
        attrs = entity.get("attributes") or []
        if entity["type"] not in ("entity", "weakEntity") or not attrs:
            continue
        entity["attributes"] = []
        cy = entity["position"]["y"] + entity["size"]["height"] / 2
        kept = []
        for raw_attr in attrs:
            text = str(raw_attr).strip()
            if not text or text.lower() in existing:
                continue
            existing.add(text.lower())
            kept.append(text)
            created += 1
        if not kept:
            continue
        for index, text in enumerate(kept):  # noqa: B007 - index builds the oval id
            width, height = 110, 42
            attr_id = f"{entity['id']}_a{index + 1}"
            nodes.append(
                {
                    "id": attr_id,
                    "type": "attribute",
                    "label": text,
                    "position": {
                        "x": entity["position"]["x"] - width - 30,
                        "y": cy - (len(kept) - 1) * 26 + index * 52 - height / 2,
                    },
                    "size": {"width": width, "height": height},
                    "style": default_style(),
                    "attributes": [],
                    "methods": [],
                    "locked": False,
                    "parentId": None,
                    "confidence": entity.get("confidence"),
                    "sources": list(entity.get("sources") or []),
                }
            )
            edges.append(
                {
                    "id": f"{attr_id}_e",
                    "source": entity["id"],
                    "target": attr_id,
                    "label": "",
                    "arrow": "none",
                    "lineStyle": "solid",
                    "confidence": entity.get("confidence") or 0.6,
                    "sources": list(entity.get("sources") or []),
                    "style": default_style(),
                }
            )
    if created:
        diagram["nodes"] = nodes
        diagram["edges"] = edges


def _auto_connect_attributes(diagram):
    """Connect orphan attribute nodes to their nearest entity/weakEntity.

    Vision models often miss attribute-entity edges.  This heuristic pairs each
    attribute that has no edges with the closest entity (by bounding-box center).
    """
    nodes = diagram.get("nodes") or []
    edges = diagram.get("edges") or []
    if diagram.get("diagram_type") != "er":
        return

    # Nodes already participating in at least one edge.
    connected = set()
    for e in edges:
        connected.add(e["source"])
        connected.add(e["target"])

    entities = [n for n in nodes if n["type"] in ("entity", "weakEntity")]
    attributes = [n for n in nodes if n["type"] == "attribute" and n["id"] not in connected]
    if not entities or not attributes:
        return

    eid = len(edges)
    for attr in attributes:
        ax = attr["position"]["x"] + attr["size"]["width"] / 2
        ay = attr["position"]["y"] + attr["size"]["height"] / 2
        best = None
        best_d = float("inf")
        for ent in entities:
            ex = ent["position"]["x"] + ent["size"]["width"] / 2
            ey = ent["position"]["y"] + ent["size"]["height"] / 2
            d = (ax - ex) ** 2 + (ay - ey) ** 2
            if d < best_d:
                best_d = d
                best = ent
        if best:
            eid += 1
            edges.append({
                "id": f"auto_e{eid}",
                "source": best["id"],
                "target": attr["id"],
                "label": "",
                "arrow": "none",
                "lineStyle": "solid",
                "confidence": 0.6,
                "sources": ["auto_connect"],
                "style": default_style(),
            })
    diagram["edges"] = edges
