"""Explicit diagram-type selection must override model claims and remap shapes."""

from diagram.normalizer import normalize_source_payload, to_canonical_diagram
from diagram.schema import validate_diagram
from recognition.prompts import diagram_hint_block


def _payload():
    return {
        "diagram_type": "flowchart",  # model misreads the family
        "nodes": [
            {"id": "n1", "type": "rectangle", "label": "Customer", "bbox": [0, 0, 100, 60]},
            {"id": "n2", "type": "diamond", "label": "orders", "bbox": [200, 0, 280, 60]},
            {"id": "n3", "type": "ellipse", "label": "name", "bbox": [0, 120, 80, 170]},
        ],
        "edges": [{"source": "n1", "target": "n2"}],
    }


def test_explicit_er_overrides_model_claim():
    norm = normalize_source_payload(_payload(), "gemini", "er")
    assert norm["diagram_type"] == "er"


def test_explicit_er_remaps_generic_shapes():
    norm = normalize_source_payload(_payload(), "gemini", "er")
    types = {n["label"]: n["type"] for n in norm["nodes"]}
    assert types["Customer"] == "entity"
    assert types["orders"] == "relationship"
    assert types["name"] == "attribute"


def test_auto_mode_keeps_model_vocabulary():
    norm = normalize_source_payload(_payload(), "gemini", "auto")
    types = {n["label"]: n["type"] for n in norm["nodes"]}
    assert types["Customer"] == "rectangle"
    assert types["orders"] == "diamond"


def test_explicit_selection_survives_to_canonical():
    norm = normalize_source_payload(_payload(), "gemini", "er")
    diagram = to_canonical_diagram(norm)
    ok, errors = validate_diagram(diagram)
    assert ok, errors
    assert diagram["diagram_type"] == "er"
    types = {n["label"]: n["type"] for n in diagram["nodes"]}
    assert types["Customer"] == "entity"


def test_uml_selection_remaps_boxes_to_classes():
    payload = {
        "diagram_type": "flowchart",
        "nodes": [{"id": "n1", "type": "rectangle", "label": "Order", "bbox": [0, 0, 100, 60]}],
        "edges": [],
    }
    norm = normalize_source_payload(payload, "groq", "uml")
    assert norm["diagram_type"] == "uml"
    assert norm["nodes"][0]["type"] == "class"


def test_hint_blocks_are_type_specific():
    assert "ER DIAGRAM" in diagram_hint_block("er")
    assert "FLOWCHART" in diagram_hint_block("flowchart")
    assert "DATA FLOW" in diagram_hint_block("dfd")
    assert "UML" in diagram_hint_block("uml")
    # Auto guide mentions all families
    guide = diagram_hint_block("auto")
    for word in ("flowchart", "er", "uml", "dfd"):
        assert word in guide
