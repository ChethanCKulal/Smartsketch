"""Deterministic SVG renderer for canonical diagram JSON.

Keeps export independent from the browser: the server can turn the same
canonical JSON the canvas renders into a static SVG file.
"""

from diagram.schema import default_style


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
    style = {**default_style(), **(edge.get("style") or {})}

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
        parts.append(
            f'<text x="{midx:.1f}" y="{(y1 + y2) / 2 - 6:.1f}" fill="{_esc(style["color"])}" '
            f'font-size="11" text-anchor="middle">{_esc(label)}</text>'
        )
    return "".join(parts)


def _node_svg(node, ox, oy):
    style = {**default_style(), **(node.get("style") or {})}
    x = node["position"]["x"] - ox
    y = node["position"]["y"] - oy
    w = node["size"]["width"]
    h = node["size"]["height"]
    fill = _esc(style["fill"])
    stroke = _esc(style["border"])
    border_w = style.get("borderWidth", 1.5)
    node_type = node.get("type", "rectangle")

    common = f'fill="{fill}" stroke="{stroke}" stroke-width="{border_w}"'
    shape = f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="6" {common}/>'
    if node_type in ("ellipse", "usecase", "attribute", "terminator"):
        shape = f'<ellipse cx="{x + w / 2:.1f}" cy="{y + h / 2:.1f}" rx="{w / 2:.1f}" ry="{h / 2:.1f}" {common}/>'
    elif node_type in ("diamond", "decision", "relationship"):
        pts = f"{x + w / 2:.1f},{y:.1f} {x + w:.1f},{y + h / 2:.1f} {x + w / 2:.1f},{y + h:.1f} {x:.1f},{y + h / 2:.1f}"
        shape = f'<polygon points="{pts}" {common}/>'
    elif node_type in ("roundedRectangle", "process", "dfdProcess"):
        shape = f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="18" {common}/>'

    label = node.get("label") or ""
    lines = [label]
    attrs = node.get("attributes") or []
    if attrs and node_type not in ("class", "interface"):
        lines.append(", ".join(str(a) for a in attrs))

    parts = [shape]
    font_size = style.get("fontSize", 13)
    line_height = font_size + 4
    text_h = line_height * len(lines)
    ty = y + h / 2 - text_h / 2 + line_height * 0.8
    for line in lines:
        parts.append(
            f'<text x="{x + w / 2:.1f}" y="{ty:.1f}" fill="{_esc(style["color"])}" '
            f'font-size="{font_size}" text-anchor="middle" '
            f'font-family="{_esc(style.get("font", "Segoe UI"))}">{_esc(line)}</text>'
        )
        ty += line_height
    return "".join(parts)


def diagram_to_svg(diagram) -> str:
    nodes = diagram.get("nodes") or []
    edges = diagram.get("edges") or []
    if not nodes:
        return _wrap(800, 500, '<rect x="0" y="0" width="800" height="500" fill="#101722"/>', 800, 500)

    pad = 40
    x_min = min(n["position"]["x"] for n in nodes)
    y_min = min(n["position"]["y"] for n in nodes)
    x_max = max(n["position"]["x"] + n["size"]["width"] for n in nodes)
    y_max = max(n["position"]["y"] + n["size"]["height"] for n in nodes)
    width = x_max - x_min + pad * 2
    height = y_max - y_min + pad * 2

    parts = [f'<rect x="0" y="0" width="{width:.0f}" height="{height:.0f}" fill="#101722"/>']
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
        '<path d="M0,0 L10,4 L0,8 z" fill="#8fb4d9"/></marker>'
        '<marker id="arrow-start" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto" '
        'markerUnits="userSpaceOnUse">'
        '<path d="M10,0 L0,4 L10,8 z" fill="#8fb4d9"/></marker>'
        "</defs>"
        f"{body}</svg>"
    )
