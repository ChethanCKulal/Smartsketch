"""YOLO + Groq fusion: label association, relationship mapping, connector evidence.

Everything here is deterministic: detections and Groq payloads are supplied
directly, so no model, GPU, or API key is involved.
"""

from recognition.flowchart_fusion import fuse_flowchart

IMAGE = (640, 480)


def detection(symbols, connectors=()):
    """The shape ``yolo_service.detect`` returns, without running the model."""
    return {
        "ok": True,
        "source": "yolo",
        "width": IMAGE[0],
        "height": IMAGE[1],
        "imgsz": 640,
        "conf": 0.25,
        "device": "cpu",
        "class_counts": {},
        "class_names": {},
        "symbols": [
            {"class_id": 0, "class_name": name, "confidence": conf, "bbox": list(box)}
            for name, box, conf in symbols
        ],
        "connectors": [
            {"class_id": 0, "class_name": name, "confidence": conf, "bbox": list(box)}
            for name, box, conf in connectors
        ],
        "detections": [],
    }


def groq_payload(nodes, edges=()):
    return {"diagram_type": "flowchart", "nodes": list(nodes), "edges": list(edges)}


def node_count(fused):
    return len(fused["nodes"])


def labels(fused):
    return {n["id"]: n["label"] for n in fused["nodes"]}


def edge_pairs(fused):
    return {(e["source"], e["target"]) for e in fused["edges"]}


# --- label association -------------------------------------------------------

# The same two shapes as the two sources report them: pixels from the detector,
# ~0-1000 units from the vision model. Only their own normalised frames agree.
SYMBOLS_PIXELS = [
    ("process", (64, 48, 256, 144), 0.9),
    ("decision", (80, 240, 240, 400), 0.8),
]
GROQ_NODES_1000 = [
    {"id": "n1", "label": "Validate order", "bbox": [100, 100, 400, 300], "confidence": 0.9},
    {"id": "n2", "label": "In stock?", "bbox": [125, 500, 375, 833], "confidence": 0.8},
]


# The minimal payload the flowchart prompt now asks for: an id, a label and a box
# per symbol, and relationships referring to those ids — no shape type, no
# confidence, no attributes or methods. The fusion must consume exactly this.
MINIMAL_NODES = [
    {"id": "n1", "label": "Start", "bbox": [64, 48, 256, 144]},
    {"id": "n2", "label": "Approved?", "bbox": [80, 240, 240, 400]},
]
MINIMAL_EDGES = [{"source": "n1", "target": "n2", "label": "yes", "arrow": "forward"}]


def test_the_minimal_label_payload_still_names_and_connects_the_symbols():
    fused = fuse_flowchart(detection(SYMBOLS_PIXELS), groq_payload(MINIMAL_NODES, MINIMAL_EDGES))
    assert labels(fused) == {"yolo_n1": "Start", "yolo_n2": "Approved?"}
    assert edge_pairs(fused) == {("yolo_n1", "yolo_n2")}
    assert fused["report"]["match"]["matched"] == 2
    assert fused["report"]["labels_are_placeholders"] is False
    assert fused["report"]["edges_rejected"] == 0


def test_a_minimal_relationship_keeps_its_label_and_gets_a_confidence():
    fused = fuse_flowchart(detection(SYMBOLS_PIXELS), groq_payload(MINIMAL_NODES, MINIMAL_EDGES))
    edge = fused["edges"][0]
    assert edge["label"] == "yes"
    assert edge["arrow"] == "forward"
    assert 0.0 < edge["confidence"] <= 1.0


def test_an_empty_text_source_leaves_placeholders_and_says_so():
    """A payload that arrived and read nothing is not the same as a failed call.

    The shapes are still real detections, so they are kept with their placeholder
    names, and the report says the text source had nothing rather than implying the
    drawing was unreadable.
    """
    fused = fuse_flowchart(detection(SYMBOLS_PIXELS), groq_payload([], []))
    assert node_count(fused) == 2
    assert labels(fused) == {"yolo_n1": "Process 1", "yolo_n2": "Decision 1"}
    assert fused["report"]["labels_are_placeholders"] is True
    assert fused["report"]["text_source_used"] is True
    assert any("returned no labels" in w for w in fused["warnings"])
    assert not any("could not be read" in w for w in fused["warnings"])


def test_a_truncation_note_does_not_disturb_the_fusion():
    payload = groq_payload(MINIMAL_NODES, MINIMAL_EDGES)
    payload["text_note"] = "The text model reached its 1024-token output limit before it finished."
    fused = fuse_flowchart(
        detection(SYMBOLS_PIXELS), payload, warnings=[payload["text_note"]]
    )
    assert labels(fused) == {"yolo_n1": "Start", "yolo_n2": "Approved?"}
    assert payload["text_note"] in fused["warnings"]


def test_labels_match_across_different_coordinate_spaces():
    fused = fuse_flowchart(detection(SYMBOLS_PIXELS), groq_payload(GROQ_NODES_1000))
    assert labels(fused) == {"yolo_n1": "Validate order", "yolo_n2": "In stock?"}
    assert fused["report"]["match"]["matched"] == 2
    assert fused["report"]["labels_are_placeholders"] is False


def test_labeled_symbols_record_both_sources():
    fused = fuse_flowchart(detection(SYMBOLS_PIXELS), groq_payload(GROQ_NODES_1000))
    assert all(n["sources"] == ["groq", "yolo"] for n in fused["nodes"])
    assert all(n["placeholder"] is False for n in fused["nodes"])


def test_symbol_class_and_geometry_survive_fusion():
    fused = fuse_flowchart(detection(SYMBOLS_PIXELS), groq_payload(GROQ_NODES_1000))
    first = fused["nodes"][0]
    assert first["type"] == "process"
    assert first["bbox"] == [64.0, 48.0, 256.0, 144.0]
    assert first["confidence"] == 0.9
    assert fused["nodes"][1]["type"] == "decision"


def test_ambiguous_text_match_keeps_the_placeholder_and_warns():
    """Two equally good fits must not be written onto either symbol."""
    frames = [
        ("process", (0, 0, 100, 100), 0.9),
        ("decision", (300, 0, 400, 100), 0.9),
    ]
    nodes = [
        {"id": "n1", "label": "Alpha", "bbox": [0, 0, 100, 100]},
        {"id": "n2", "label": "Beta", "bbox": [0, 0, 92, 100]},
        {"id": "n3", "label": "Gamma", "bbox": [300, 0, 400, 100]},
    ]
    fused = fuse_flowchart(detection(frames), groq_payload(nodes))
    assert fused["report"]["match"]["ambiguous"] == 1
    assert labels(fused)["yolo_n1"] == "Process 1"  # placeholder, not "Alpha"
    assert labels(fused)["yolo_n2"] == "Gamma"
    assert any("fits more than one detected symbol" in w for w in fused["warnings"])


def test_a_shape_disagreement_is_reported_and_the_detector_wins():
    """The trained class decides the shape; the difference is recorded, not hidden."""
    fused = fuse_flowchart(
        detection(SYMBOLS_PIXELS),
        groq_payload(
            [
                {"id": "n1", "type": "terminator", "label": "Validate order", "bbox": [64, 48, 256, 144]},
                {"id": "n2", "type": "decision", "label": "In stock?", "bbox": [80, 240, 240, 400]},
            ]
        ),
    )
    assert [n["type"] for n in fused["nodes"]] == ["process", "decision"]
    assert fused["report"]["match"]["type_disagreements"] == 1
    assert fused["disagreements"] == [
        {
            "kind": "node_type",
            "symbol": "yolo_n1",
            "text": "Validate order",
            "detector": "process",
            "vision": "terminator",
            "chosen": "process",
        }
    ]


def test_agreeing_shapes_raise_no_disagreement():
    fused = fuse_flowchart(
        detection(SYMBOLS_PIXELS),
        groq_payload(
            [
                {"id": "n1", "type": "process", "label": "Validate order", "bbox": [64, 48, 256, 144]},
                {"id": "n2", "type": "decision", "label": "In stock?", "bbox": [80, 240, 240, 400]},
            ]
        ),
    )
    assert fused["report"]["match"]["type_disagreements"] == 0
    assert fused["disagreements"] == []


def test_an_unlabeled_shape_is_not_counted_as_a_disagreement():
    fused = fuse_flowchart(
        detection(SYMBOLS_PIXELS),
        groq_payload([{"id": "n1", "type": "terminator", "bbox": [64, 48, 256, 144]}]),
    )
    assert fused["report"]["match"]["type_disagreements"] == 0


def test_unmatched_vision_nodes_are_counted_not_placed():
    symbols = [("process", (0, 0, 100, 100), 0.9)]
    nodes = [{"id": "n1", "label": "Alpha", "bbox": [0, 0, 100, 100]}, {"id": "n2", "label": "Far", "bbox": [900, 900, 1000, 1000]}]
    fused = fuse_flowchart(detection(symbols), groq_payload(nodes))
    assert node_count(fused) == 1  # the detector alone decides how many shapes exist
    assert labels(fused) == {"yolo_n1": "Alpha"}
    assert fused["report"]["match"]["unmatched"] == 1


def test_text_source_never_creates_a_node():
    nodes = [
        {"id": "n1", "label": "A", "bbox": [0, 0, 50, 50]},
        {"id": "n2", "label": "B", "bbox": [200, 200, 260, 260]},
    ]
    fused = fuse_flowchart(detection([("process", (0, 0, 100, 100), 0.9)]), groq_payload(nodes))
    assert node_count(fused) == 1
    assert labels(fused) == {"yolo_n1": "Process 1"}


def test_the_same_payload_matches_in_every_coordinate_space_it_could_arrive_in():
    """Pixels, fractions, 0-1000 units and a self-normalised frame all resolve."""
    for space in ("pixels", "fraction", "thousand", "relative"):
        fused = fuse_flowchart(detection(SYMBOLS_PIXELS), groq_payload(_spaced_nodes(space)))
        assert labels(fused) == {"yolo_n1": "Validate order", "yolo_n2": "In stock?"}, space
        assert fused["report"]["match"]["coordinate_space"] == space


def _spaced_nodes(space):
    width, height = IMAGE
    if space == "pixels":
        boxes = [(64, 48, 256, 144), (80, 240, 240, 400)]
    elif space == "fraction":
        boxes = [(0.1, 0.1, 0.4, 0.3), (0.125, 0.5, 0.375, 0.833)]
    elif space == "thousand":
        boxes = [(100, 100, 400, 300), (125, 500, 375, 833)]
    else:  # the payload's own extent, which is how the layout normalises too
        boxes = [(0, 0, 1000, 272.7273), (83.3333, 545.4545, 916.6667, 1000)]
    return [
        {"id": "n1", "label": "Validate order", "bbox": list(boxes[0])},
        {"id": "n2", "label": "In stock?", "bbox": list(boxes[1])},
    ]


# --- relationships -----------------------------------------------------------

def _two_symbols():
    return detection(SYMBOLS_PIXELS)


def test_relationships_resolve_by_vision_node_id():
    fused = fuse_flowchart(
        _two_symbols(),
        groq_payload(GROQ_NODES_1000, [{"id": "e1", "source": "n1", "target": "n2", "label": "yes", "arrow": "forward", "confidence": 0.8}]),
    )
    assert edge_pairs(fused) == {("yolo_n1", "yolo_n2")}
    edge = fused["edges"][0]
    assert edge["label"] == "yes"
    assert edge["arrow"] == "forward"
    assert edge["confidence"] == 0.8
    assert edge["sources"] == ["groq"]
    assert fused["report"]["edges_from_text"] == 1


def test_relationships_resolve_by_label():
    fused = fuse_flowchart(
        _two_symbols(),
        groq_payload(GROQ_NODES_1000, [{"source": "Validate order", "target": "In stock?", "arrow": "forward"}]),
    )
    assert edge_pairs(fused) == {("yolo_n1", "yolo_n2")}


def test_relationships_to_unknown_symbols_are_dropped():
    fused = fuse_flowchart(
        _two_symbols(),
        groq_payload(GROQ_NODES_1000, [{"source": "n1", "target": "n99", "arrow": "forward"}]),
    )
    assert fused["edges"] == []
    assert fused["report"]["edges_rejected"] == 1


def test_self_references_are_dropped_with_a_warning():
    fused = fuse_flowchart(
        _two_symbols(),
        groq_payload(GROQ_NODES_1000, [{"source": "n1", "target": "n1", "arrow": "forward"}]),
    )
    assert fused["edges"] == []
    assert fused["report"]["self_loops"] == 1
    assert any("points at one symbol" in w for w in fused["warnings"])


def test_duplicate_relationships_are_merged():
    fused = fuse_flowchart(
        _two_symbols(),
        groq_payload(
            GROQ_NODES_1000,
            [
                {"source": "n1", "target": "n2", "label": "yes"},
                {"source": "n2", "target": "n1", "label": "yes"},
            ],
        ),
    )
    assert len(fused["edges"]) == 1


# --- connector evidence ------------------------------------------------------

ARROW_DOWN = ("arrow", (140, 162, 160, 298), 0.7)
ARROWHEAD_AT_BOTTOM = ("arrowhead", (140, 270, 160, 300), 0.6)
TWO_STACKED = [
    ("process", (100, 100, 200, 160), 0.9),
    ("process", (100, 300, 200, 360), 0.9),
]


def test_arrow_between_two_symbols_becomes_an_edge_with_direction():
    fused = fuse_flowchart(detection(TWO_STACKED, [ARROW_DOWN, ARROWHEAD_AT_BOTTOM]), None)
    assert edge_pairs(fused) == {("yolo_n1", "yolo_n2")}
    edge = fused["edges"][0]
    assert edge["arrow"] == "forward"  # the arrowhead sits at the lower symbol
    assert edge["sources"] == ["yolo"]
    assert edge["confidence"] == 0.7  # weakest of the arrow and the two symbols
    assert fused["report"]["edges_from_arrows"] == 1


def test_arrow_head_at_the_top_reverses_the_direction():
    fused = fuse_flowchart(detection(TWO_STACKED, [ARROW_DOWN, ("arrowhead", (140, 160, 160, 190), 0.6)]), None)
    assert edge_pairs(fused) == {("yolo_n2", "yolo_n1")}


def test_arrowhead_on_its_own_never_creates_an_edge():
    fused = fuse_flowchart(detection(TWO_STACKED, [ARROWHEAD_AT_BOTTOM]), None)
    assert fused["edges"] == []


def test_arrow_without_an_arrowhead_is_drawn_undirected():
    fused = fuse_flowchart(detection(TWO_STACKED, [ARROW_DOWN]), None)
    assert len(fused["edges"]) == 1
    assert fused["edges"][0]["arrow"] == "none"
    assert fused["report"]["connectors_without_direction"] == 1


def test_arrow_between_more_than_two_symbols_is_skipped():
    crowded = TWO_STACKED + [("process", (150, 290, 250, 350), 0.8)]
    fused = fuse_flowchart(detection(crowded, [ARROW_DOWN, ARROWHEAD_AT_BOTTOM]), None)
    assert fused["edges"] == []
    assert fused["report"]["connectors_ambiguous"] == 1
    assert any("more than two detected symbols" in w for w in fused["warnings"])


def test_arrow_reaching_one_symbol_is_reported_not_guessed():
    fused = fuse_flowchart(detection(TWO_STACKED, [("arrow", (500, 400, 520, 460), 0.7)]), None)
    assert fused["edges"] == []
    assert fused["report"]["connectors_dangling"] == 1
    assert any("fewer than two detected symbols" in w for w in fused["warnings"])


def test_a_real_arrowhead_supplies_a_direction_the_text_left_out():
    fused = fuse_flowchart(
        detection(TWO_STACKED, [ARROW_DOWN, ARROWHEAD_AT_BOTTOM]),
        groq_payload(
            [{"id": "n1", "label": "Check", "bbox": [100, 100, 200, 160]}, {"id": "n2", "label": "Ship", "bbox": [100, 300, 200, 360]}],
            [{"source": "n1", "target": "n2", "arrow": "none"}],
        ),
    )
    assert len(fused["edges"]) == 1
    assert fused["edges"][0]["arrow"] == "forward"
    assert fused["edges"][0]["sources"] == ["groq", "yolo"]
    assert fused["report"]["directions_confirmed"] == 1
    assert fused["report"]["edges_from_arrows"] == 0


# --- degraded paths ----------------------------------------------------------

def test_text_failure_keeps_the_shapes_and_says_they_are_placeholders():
    fused = fuse_flowchart(detection(TWO_STACKED, [ARROW_DOWN, ARROWHEAD_AT_BOTTOM]), None, groq_ok=False)
    assert fused["ok"] is True
    assert node_count(fused) == 2
    assert all(n["label"].startswith("Process") for n in fused["nodes"])
    assert fused["report"]["labels_are_placeholders"] is True
    assert fused["report"]["text_source_used"] is False
    assert any("placeholder" in w for w in fused["warnings"])
    # Connections the drawing itself shows are still kept.
    assert edge_pairs(fused) == {("yolo_n1", "yolo_n2")}


def test_empty_text_payload_is_reported_as_such():
    fused = fuse_flowchart(detection(TWO_STACKED), {})
    assert fused["report"]["labels_are_placeholders"] is True
    assert any("returned no labels" in w for w in fused["warnings"])


def test_no_detected_symbols_fails_instead_of_inventing_a_diagram():
    fused = fuse_flowchart(detection([], [ARROW_DOWN]), groq_payload(GROQ_NODES_1000))
    assert fused["ok"] is False
    assert fused["code"] == "no_symbols"
    assert fused["nodes"] == [] and fused["edges"] == []
