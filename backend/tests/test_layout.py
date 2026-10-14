"""Placement: scale-independent, text-fitted, and free of overlaps.

The recorded fixture in `fixtures/er_live_payloads.json` holds two live answers
for the same drawing — Gemini in image pixels, the Groq vision model in ~0-1000
units. Treating either as canvas pixels is what used to overlap every shape.
"""

import json
import os

import pytest

from diagram.layout import assign_relative_positions, estimate_size, layout_diagram
from diagram.normalizer import normalize_source_payload, to_canonical_diagram
from recognition.reconciliation_engine import reconcile

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "er_live_payloads.json")


def _fixture():
    with open(FIXTURE, encoding="utf-8") as handle:
        return json.load(handle)


def _overlaps(nodes, gap=0):
    pairs = []
    for i, a in enumerate(nodes):
        for b in nodes[i + 1:]:
            ax, ay = a["position"]["x"], a["position"]["y"]
            bx, by = b["position"]["x"], b["position"]["y"]
            aw, ah = a["size"]["width"], a["size"]["height"]
            bw, bh = b["size"]["width"], b["size"]["height"]
            separated = ax + aw + gap <= bx or bx + bw + gap <= ax or ay + ah + gap <= by or by + bh + gap <= ay
            if not separated:
                pairs.append((a["label"], b["label"]))
    return pairs


def _canvas(payload, source, requested="er"):
    return to_canonical_diagram(normalize_source_payload(payload, source, requested))


def _scaled(payload, factor):
    """The same drawing expressed in a different coordinate space."""
    clone = json.loads(json.dumps(payload))
    for node in clone["nodes"]:
        if node.get("bbox"):
            node["bbox"] = [round(value * factor, 3) for value in node["bbox"]]
    return clone


def _positions(diagram):
    return {node["label"]: (node["position"]["x"], node["position"]["y"]) for node in diagram["nodes"]}


# --- the coordinate-space bug ------------------------------------------------


@pytest.mark.parametrize("factor", [1000 / 420, 1 / 420])
def test_layout_is_independent_of_the_models_coordinate_space(factor):
    """Pixels, ~0-1000 units and fractions of the image must place identically."""
    fixture = _fixture()
    pixels = _canvas(fixture["gemini"], "gemini")
    rescaled = _canvas(_scaled(fixture["gemini"], factor), "gemini")
    for label, (x, y) in _positions(pixels).items():
        other = _positions(rescaled)[label]
        assert abs(other[0] - x) <= 2 and abs(other[1] - y) <= 2, f"{label} moved when only units changed"


def test_pixel_and_1000_unit_sources_agree_on_the_arrangement():
    """A drawing answered in two coordinate spaces must land the same way.

    Horizontal placement is exact. Vertical placement differs by a few percent
    because the two models report different vertical scales for the *same*
    drawing (their own extents are 450x307 and 908x540, aspects 0.68 vs 0.60),
    so the test pins the ordering it must preserve and a tolerance that reflects
    that model noise rather than pretending the sources agree pixel for pixel.
    """
    fixture = _fixture()
    gemini = _positions(_canvas(fixture["gemini"], "gemini"))
    groq = _positions(_canvas(fixture["groq"], "groq"))
    assert set(gemini) == set(groq)

    span_x = max(x for x, _ in gemini.values()) - min(x for x, _ in gemini.values())
    span_y = max(y for _, y in gemini.values()) - min(y for _, y in gemini.values())
    for label in gemini:
        assert abs(gemini[label][0] - groq[label][0]) <= span_x * 0.02, f"{label} placed differently per source"
        assert abs(gemini[label][1] - groq[label][1]) <= span_y * 0.25, f"{label} too far apart per source"

    def ordering(layout):
        relations = set()
        for a in layout:
            for b in layout:
                if a == b:
                    continue
                relations.add((a, "left" if layout[a][0] < layout[b][0] else "right", b))
                relations.add((a, "above" if layout[a][1] < layout[b][1] else "below", b))
        return relations

    assert ordering(gemini) == ordering(groq)


# --- overlap freedom --------------------------------------------------------


def test_recorded_er_has_no_overlapping_shapes():
    fixture = _fixture()
    diagram = to_canonical_diagram(
        reconcile(
            [normalize_source_payload(fixture["gemini"], "gemini", "er"),
             normalize_source_payload(fixture["groq"], "groq", "er")]
        )
    )
    assert _overlaps(diagram["nodes"], gap=30) == []


def test_shapes_receive_the_size_their_text_needs():
    fixture = _fixture()
    diagram = _canvas(fixture["gemini"], "gemini")
    sizes = {node["label"]: node["size"] for node in diagram["nodes"]}
    # Fitted to the label, not to the ink box the model reported.
    assert sizes["COURSE"]["width"] < 100
    assert sizes["ENROLLS"]["width"] > sizes["COURSE"]["width"]  # a diamond needs more room
    for size in sizes.values():
        assert 40 <= size["width"] <= 460 and 28 <= size["height"] <= 560


def test_a_dense_diagram_stays_overlap_free():
    """25 nodes in a small area is the case that used to collapse."""
    payload = {
        "diagram_type": "er",
        "nodes": [
            {"id": f"n{i}", "type": "attribute" if i % 3 else "entity", "label": f"Entity {i}",
             "bbox": [200 + (i % 5) * 100, 150 + (i // 5) * 80, 280 + (i % 5) * 100, 200 + (i // 5) * 80]}
            for i in range(25)
        ],
        "edges": [],
    }
    diagram = _canvas(payload, "groq", "er")
    assert len(diagram["nodes"]) == 25
    assert _overlaps(diagram["nodes"], gap=20) == []


def test_nodes_without_boxes_are_still_placed_apart():
    payload = {
        "diagram_type": "er",
        "nodes": [{"id": f"n{i}", "type": "entity", "label": f"E{i}"} for i in range(6)],
        "edges": [],
    }
    diagram = _canvas(payload, "gemini", "er")
    assert _overlaps(diagram["nodes"], gap=20) == []


def test_identical_boxes_do_not_leave_shapes_stacked():
    payload = {
        "diagram_type": "dfd",
        "nodes": [
            {"id": f"n{i}", "type": "dfdProcess", "label": f"P{i}", "bbox": [10, 10, 60, 60]} for i in range(4)
        ],
        "edges": [],
    }
    diagram = _canvas(payload, "groq", "dfd")
    assert _overlaps(diagram["nodes"], gap=20) == []


# --- arrangement ------------------------------------------------------------


def test_the_drawings_arrangement_survives_the_layout():
    """COURSE top-left, ENROLLS top-right, STUDENT centre, ovals underneath."""
    fixture = _fixture()
    nodes = {node["label"]: node for node in _canvas(fixture["gemini"], "gemini")["nodes"]}

    def cx(label):
        node = nodes[label]
        return node["position"]["x"] + node["size"]["width"] / 2

    def cy(label):
        node = nodes[label]
        return node["position"]["y"] + node["size"]["height"] / 2

    assert cx("COURSE") < cx("STUDENT") < cx("ENROLLS")
    assert cy("COURSE") < cy("STUDENT") and cy("ENROLLS") < cy("STUDENT")
    assert cy("StudentID") > cy("STUDENT") and cy("Name") > cy("STUDENT")


def test_a_wide_drawing_is_not_squared_off():
    payload = {
        "diagram_type": "flowchart",
        "nodes": [
            {"id": "n1", "type": "process", "label": "Wide One", "bbox": [0, 0, 40, 20]},
            {"id": "n2", "type": "process", "label": "Wide Two", "bbox": [900, 0, 940, 20]},
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
    }
    nodes = to_canonical_diagram(normalize_source_payload(payload, "gemini", "flowchart"))["nodes"]
    width = max(n["position"]["x"] + n["size"]["width"] for n in nodes) - min(n["position"]["x"] for n in nodes)
    height = max(n["position"]["y"] + n["size"]["height"] for n in nodes) - min(n["position"]["y"] for n in nodes)
    assert width > height


# --- internals --------------------------------------------------------------


def test_canonical_output_does_not_leak_the_layout_helper_field():
    fixture = _fixture()
    diagram = _canvas(fixture["groq"], "groq")
    assert all("rel" not in node for node in diagram["nodes"])
    assert all(set(node["position"]) == {"x", "y"} for node in diagram["nodes"])


def test_er_attributes_taken_out_of_the_entity_are_placed_clear_of_it():
    payload = {
        "diagram_type": "er",
        "nodes": [
            {"id": "n1", "type": "entity", "label": "STUDENT", "attributes": ["Name", "ID", "Dept"],
             "bbox": [300, 300, 700, 500]}
        ],
        "edges": [],
    }
    diagram = _canvas(payload, "gemini", "er")
    assert _overlaps(diagram["nodes"], gap=20) == []
    assert len([n for n in diagram["nodes"] if n["type"] == "attribute"]) == 3


def test_single_node_is_placed_at_the_margin():
    nodes = [{"id": "n1", "type": "entity", "label": "Only", "bbox": [0, 0, 10, 10]}]
    assign_relative_positions(nodes)
    diagram = layout_diagram({"nodes": nodes})
    assert diagram["nodes"][0]["position"]["x"] > 0
    assert diagram["nodes"][0]["position"]["y"] > 0


# Widths measured in Chromium at 400 13px "Segoe UI", Arial, sans-serif — the
# exact font stack the canvas measures with (frontend/src/canvas/autosize.js).
# The layout must reserve at least this much, or the canvas box can grow past
# the space the layout cleared for it and overlap its neighbour.
CANVAS_MEASURED_13PX = {
    "COURSE": 47.7,
    "STUDENT": 54.9,
    "ENROLLS": 52.9,
    "StudentID": 57.1,
    "Name": 34.3,
    "DataStore": 56.6,
    "A very long entity name": 130.7,
    "WWWWWW": 72.9,  # a flat per-character factor under-reserved this by ~34%
    "MMMMMM": 70.0,
}


def test_text_measurement_bounds_the_canvas_font():
    from diagram.layout import _text_width

    for label, canvas_width in CANVAS_MEASURED_13PX.items():
        estimated = _text_width(label, 13)
        assert estimated >= canvas_width, f"{label!r}: reserved {estimated:.1f}px, canvas draws {canvas_width}px"


def test_size_estimate_grows_with_content():
    short = estimate_size({"type": "entity", "label": "A"})
    long = estimate_size({"type": "entity", "label": "A very long entity name"})
    assert long["width"] > short["width"]
    # A UML box keeps all three compartments, and the canvas floor for one is
    # 72 px — so compare against a class that actually carries members.
    loaded = estimate_size({
        "type": "class",
        "label": "Student",
        "attributes": ["- id: int", "- name: String", "- email: String", "- year: int"],
        "methods": ["+ enroll(): void", "+ drop(): void", "+ average(): double", "+ save(): void"],
    })
    empty_class = estimate_size({"type": "class", "label": "Student"})
    assert loaded["height"] > empty_class["height"]
    assert loaded["height"] >= 72  # the canvas minimum for a class box
