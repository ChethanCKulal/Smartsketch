"""SVG export rendering tests."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from export.svg_export import diagram_to_svg


DIAGRAM = {
    "diagram_type": "er",
    "nodes": [
        {
            "id": "n1",
            "type": "entity",
            "label": "Student",
            "attributes": ["StudentID", "Name"],
            "position": {"x": 0, "y": 0},
            "size": {"width": 120, "height": 60},
            "style": {},
        },
        {
            "id": "n2",
            "type": "ellipse",
            "label": "Course",
            "position": {"x": 300, "y": 100},
            "size": {"width": 100, "height": 50},
            "style": {},
        },
    ],
    "edges": [
        {"id": "e1", "source": "n1", "target": "n2", "label": "Enrolls", "arrow": "forward", "style": {}},
        {"id": "e2", "source": "n1", "target": "n2", "label": "", "arrow": "both", "style": {}},
        {"id": "e3", "source": "n1", "target": "n2", "label": "", "arrow": "none", "lineStyle": "dashed", "style": {}},
    ],
}


def test_svg_contains_nodes_and_labels():
    svg = diagram_to_svg(DIAGRAM)
    assert svg.startswith("<svg")
    assert "Student" in svg and "Course" in svg
    # ER entities show only the name; attributes are separate oval nodes.
    assert "Student" in svg
    assert "Enrolls" in svg


def test_svg_arrows_and_dasharray():
    svg = diagram_to_svg(DIAGRAM)
    assert svg.count('marker-end="url(#arrow)"') == 2  # forward + both
    assert svg.count('marker-start="url(#arrow-start)"') == 1  # both
    assert 'stroke-dasharray="8 6"' in svg


def test_svg_escapes_user_text():
    hostile = {
        "nodes": [
            {
                "id": "n1",
                "type": "text",
                "label": '<script>alert("x")</script>',
                "position": {"x": 0, "y": 0},
                "size": {"width": 80, "height": 40},
                "style": {},
            }
        ],
        "edges": [],
    }
    svg = diagram_to_svg(hostile)
    assert "<script>" not in svg
    assert "&lt;script&gt;" in svg


def test_empty_diagram_renders_blank_canvas():
    svg = diagram_to_svg({"nodes": [], "edges": []})
    assert svg.startswith("<svg") and svg.endswith("</svg>")
