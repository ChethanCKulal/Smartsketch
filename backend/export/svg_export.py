"""Deterministic SVG renderer for canonical diagram JSON.

Keeps export independent from the browser: the server can turn the same
canonical JSON the canvas renders into a static SVG file.
"""

from diagram.schema import default_style

# White-background export overrides for readability.
_EXPORT_STYLE = {
    "fill": "#f0f4f8",
    "border": "#3a6b9f",
    "borderWidth": 1.5,
    "color": "#1a1a1a",
    "font": "Segoe UI",
    "fontSize": 13,
    "fontStyle": "normal",
    "fontWeight": "500",
    "textAlign": "center",
    "opacity": 1,
    "lineStyle": "solid",
    "arrow": "forward",
}


# ER-specific palette for attribute ovals, entity boxes, relationship diamonds.
_ER_EXPORT = {
    "attribute": {"fill": "#dce8f5", "border": "#4a7fb5", "color": "#1a1a1a"},
    "entity": {"fill": "#c8ddf5", "border": "#2c6aa0", "color": "#0d1b2a"},
    "relationship": {"fill": "#c5e6d0", "border": "#2a8a4a", "color": "#0d1b2a"},
    "weakEntity": {"fill": "#d5c8f0", "border": "#6a4aae", "color": "#0d1b2a"},
}


def _esc(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _find(nodes, node_id):
    for node in nodes:
        if node["id"] == node_id:
            return node
    return None


def _anchor(node, side):
    """Connection point on a node's edge, mirroring the canvas handles."""
    x = node["position"]["x"]
    y = node["position"]["y"]
    w = node["size"]["width"]
    h = node["size"]["height"]
    return {
        "top": (x + w / 2, y),
        "bottom": (x + w / 2, y + h),
        "left": (x, y + h / 2),
        "right": (x + w, y + h / 2),
    }[side]


def _edge_svg(edge, nodes, ox, oy):
    source = _find(nodes, edge.get("source"))
    target = _find(nodes, edge.get("target"))
    if not source or not target:
        return ""
    style = {**_EXPORT_STYLE, **(edge.get("style") or {})}

    sx, sy = source["position"]["x"], source["position"]["y"]
    tx, ty = target["position"]["x"], target["position"]["y"]
    sw, sh = source["size"]["width"], source["size"]["height"]
    tw, th = target["size"]["width"], target["size"]["height"]
    scx, scy = sx + sw / 2, sy + sh / 2
    tcx, tcy = tx + tw / 2, ty + th / 2

    # Exit/enter on the facing sides so arrows read like the canvas.
    if abs(tcx - scx) >= abs(tcy - scy):
        p1 = _anchor(source, "right" if tcx >= scx else "left")
        p2 = _anchor(target, "left" if tcx >= scx else "right")
    else:
        p1 = _anchor(source, "bottom" if tcy >= scy else "top")
        p2 = _anchor(target, "top" if tcy >= scy else "bottom")

    x1, y1 = p1[0] - ox, p1[1] - oy
    x2, y2 = p2[0] - ox, p2[1] - oy
    midx = (x1 + x2) / 2
    path = f"M {x1:.1f} {y1:.1f} C {midx:.1f} {y1:.1f}, {midx:.1f} {y2:.1f}, {x2:.1f} {y2:.1f}"

    dash = {"dashed": ' stroke-dasharray="8 6"', "dotted": ' stroke-dasharray="2 4"'}.get(
        edge.get("lineStyle", "solid"), ""
    )
    arrow = edge.get("arrow", "forward")
    marker = ""
    if arrow in ("forward", "both"):
        marker += ' marker-end="url(#arrow)"'
    if arrow in ("backward", "both"):
        marker += ' marker-start="url(#arrow-start)"'

    parts = [
        f'<path d="{path}" fill="none" stroke="{_esc(style["border"])}" '
        f'stroke-width="{style.get("borderWidth", 1.6)}"{dash}{marker}/>'
    ]
    label = edge.get("label") or ""
    if label:
        label_color = style.get("color", "#1a1a1a")
        parts.append(
            f'<text x="{midx:.1f}" y="{(y1 + y2) / 2 - 6:.1f}" fill="{_esc(label_color)}" '
            f'font-size="11" text-anchor="middle">{_esc(label)}</text>'
        )
    return "".join(parts)


def _node_svg(node, ox, oy):
    base = {**_EXPORT_STYLE}
    # Apply ER-specific palette for recognized shapes.
    er_override = _ER_EXPORT.get(node.get("type"))
    if er_override:
        base.update(er_override)
    # Use only structural overrides from canonical style (ignore fill/color on
    # export so the white-background palette stays consistent).
    raw = node.get("style") or {}
    style = {
        **base,
        "fontSize": raw.get("fontSize", base["fontSize"]),
        "fontStyle": raw.get("fontStyle", base["fontStyle"]),
        "fontWeight": raw.get("fontWeight", base["fontWeight"]),
        "opacity": raw.get("opacity", base["opacity"]),
    }
    x = node["position"]["x"] - ox
    y = node["position"]["y"] - oy
    w = node["size"]["width"]
    h = node["size"]["height"]
    fill = _esc(style["fill"])
    stroke = _esc(style["border"])
    border_w = style.get("borderWidth", 1.5)
    node_type = node.get("type", "rectangle")

    common = f'fill="{fill}" stroke="{stroke}" stroke-width="{border_w}"'
    shape = f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="4" {common}/>'
    if node_type in ("ellipse", "usecase", "attribute"):
        shape = f'<ellipse cx="{x + w / 2:.1f}" cy="{y + h / 2:.1f}" rx="{w / 2:.1f}" ry="{h / 2:.1f}" {common}/>'
    elif node_type == "terminator":
        r = min(h / 2, 24)
        shape = f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r:.1f}" ry="{r:.1f}" {common}/>'
    elif node_type in ("diamond", "decision", "relationship"):
        pts = f"{x + w / 2:.1f},{y:.1f} {x + w:.1f},{y + h / 2:.1f} {x + w / 2:.1f},{y + h:.1f} {x:.1f},{y + h / 2:.1f}"
        shape = f'<polygon points="{pts}" {common}/>'
    elif node_type in ("io", "parallelogram"):
        offset = w * 0.18
        pts = f"{x + offset:.1f},{y:.1f} {x + w:.1f},{y:.1f} {x + w - offset:.1f},{y + h:.1f} {x:.1f},{y + h:.1f}"
        shape = f'<polygon points="{pts}" {common}/>'
    elif node_type == "dataStore":
        shape = f'<path d="M {x + w:.1f} {y:.1f} L {x:.1f} {y:.1f} L {x:.1f} {y + h:.1f} L {x + w:.1f} {y + h:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{border_w}" stroke-linecap="round"/>'
    elif node_type == "weakEntity":
        shape = (
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="2" {common}/>'
            f'<rect x="{x + 4:.1f}" y="{y + 4:.1f}" width="{max(1, w - 8):.1f}" height="{max(1, h - 8):.1f}" rx="1" fill="none" stroke="{stroke}" stroke-width="{border_w}"/>'
        )
    elif node_type in ("roundedRectangle", "process", "dfdProcess"):
        shape = f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="18" {common}/>'

    label = node.get("label") or ""
    attrs = node.get("attributes") or []
    methods = node.get("methods") or []
    parts = [shape]
    font_size = style.get("fontSize", 13)
    line_height = font_size + 4
    color = _esc(style["color"])
    font = _esc(style.get("font", "Segoe UI"))

    if node_type in ("entity", "weakEntity"):
        # ER entity: name only. Attributes are separate oval nodes.
        name_y = y + h / 2 + font_size * 0.35
        parts.append(
            f'<text x="{x + w / 2:.1f}" y="{name_y:.1f}" fill="{color}" '
            f'font-size="{font_size}" font-weight="700" text-anchor="middle" '
            f'font-family="{font}">{_esc(label)}</text>'
        )
    elif node_type in ("class", "interface"):
        # UML class: name | attributes | methods. All three compartments are
        # always drawn, even when one of them is empty.
        prefix = "\u00ABinterface\u00BB " if node_type == "interface" else ""
        name_h = font_size + 12
        body_h = max(1.0, h - name_h)
        line1_y = y + name_h
        line2_y = y + name_h + body_h / 2
        member_size = max(9, font_size - 2)

        parts.append(
            f'<text x="{x + w / 2:.1f}" y="{y + name_h / 2 + font_size * 0.35:.1f}" fill="{color}" '
            f'font-size="{font_size}" font-weight="700" text-anchor="middle" '
            f'font-family="{font}">{_esc(prefix + label)}</text>'
        )
        for divider_y in (line1_y, line2_y):
            if divider_y < y + h:
                parts.append(
                    f'<line x1="{x:.1f}" y1="{divider_y:.1f}" x2="{x + w:.1f}" y2="{divider_y:.1f}" '
                    f'stroke="{color}" stroke-width="0.8" opacity="0.5"/>'
                )

        attr_y = line1_y + member_size + 4
        for a in attrs:
            if attr_y > line2_y - 2:
                break
            parts.append(
                f'<text x="{x + 6:.1f}" y="{attr_y:.1f}" fill="{color}" '
                f'font-size="{member_size}" text-anchor="start" '
                f'font-family="{font}">{_esc(str(a))}</text>'
            )
            attr_y += member_size + 3

        mth_y = line2_y + member_size + 4
        for m in methods:
            if mth_y > y + h - 2:
                break
            parts.append(
                f'<text x="{x + 6:.1f}" y="{mth_y:.1f}" fill="{color}" '
                f'font-size="{member_size}" text-anchor="start" '
                f'font-family="{font}">{_esc(str(m))}</text>'
            )
            mth_y += member_size + 3
    else:
        # Generic node: label centered, with comma-separated attrs below.
        lines = [label]
        if attrs:
            lines.append(", ".join(str(a) for a in attrs))
        text_h = line_height * len(lines)
        ty = y + h / 2 - text_h / 2 + line_height * 0.8
        for line in lines:
            parts.append(
                f'<text x="{x + w / 2:.1f}" y="{ty:.1f}" fill="{color}" '
                f'font-size="{font_size}" text-anchor="middle" '
                f'font-family="{font}">{_esc(line)}</text>'
            )
            ty += line_height
    return "".join(parts)


def diagram_to_svg(diagram) -> str:
    nodes = diagram.get("nodes") or []
    edges = diagram.get("edges") or []
    if not nodes:
        return _wrap(800, 500, '<rect x="0" y="0" width="800" height="500" fill="#ffffff"/>', 800, 500)

    pad = 40
    x_min = min(n["position"]["x"] for n in nodes)
    y_min = min(n["position"]["y"] for n in nodes)
    x_max = max(n["position"]["x"] + n["size"]["width"] for n in nodes)
    y_max = max(n["position"]["y"] + n["size"]["height"] for n in nodes)
    width = x_max - x_min + pad * 2
    height = y_max - y_min + pad * 2

    parts = [f'<rect x="0" y="0" width="{width:.0f}" height="{height:.0f}" fill="#ffffff"/>']
    for edge in edges:
        parts.append(_edge_svg(edge, nodes, x_min - pad, y_min - pad))
    for node in nodes:
        parts.append(_node_svg(node, x_min - pad, y_min - pad))
    return _wrap(width, height, "".join(parts), width, height)


def _wrap(width, height, body, _w=None, _h=None):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width:.0f}" height="{height:.0f}" '
        f'viewBox="0 0 {width:.0f} {height:.0f}">'
        "<defs>"
        '<marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">'
        '<path d="M0,0 L10,4 L0,8 z" fill="#3a6b9f"/></marker>'
        '<marker id="arrow-start" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto" '
        'markerUnits="userSpaceOnUse">'
        '<path d="M10,0 L0,4 L10,8 z" fill="#3a6b9f"/></marker>'
        "</defs>"
        f"{body}</svg>"
    )
