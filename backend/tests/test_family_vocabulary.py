"""The selected diagram family owns the shape vocabulary end to end."""

from diagram.normalizer import normalize_source_payload, to_canonical_diagram
from diagram.schema import enforce_family, FAMILY_NODE_TYPES, validate_diagram


def test_er_request_returns_only_er_types():
    payload = {
        "diagram_type": "flowchart",  # model misreads
        "nodes": [
            {"id": "n1", "type": "rectangle", "label": "Customer", "bbox": [0, 0, 100, 60]},
            {"id": "n2", "type": "diamond", "label": "orders", "bbox": [200, 0, 280, 60]},
            {"id": "n3", "type": "ellipse", "label": "name", "bbox": [0, 120, 80, 170]},
            {"id": "n4", "type": "process", "label": "Mystery", "bbox": [300, 120, 400, 180]},
        ],
        "edges": [{"source": "n1", "target": "n2"}],
    }
    diagram = to_canonical_diagram(normalize_source_payload(payload, "gemini", "er"))
    assert diagram["diagram_type"] == "er"
    allowed = FAMILY_NODE_TYPES["er"]
    for node in diagram["nodes"]:
        assert node["type"] in allowed, f"{node['label']} came out as {node['type']}"


def test_unmappable_shape_falls_back_to_family_default():
    # "text" is allowed everywhere; something exotic like "group" is exempt,
    # but a stray flowchart type with no ER counterpart coerces to entity.
    assert enforce_family("dataStore", "er") == "entity"
    assert enforce_family("attribute", "flowchart") == "io"
    assert enforce_family("dataFlow", "er") == "relationship"
    assert enforce_family("actor", "er") == "attribute"


def test_family_vocabularies_are_disjoint():
    er = FAMILY_NODE_TYPES["er"] - {"text"}
    flow = FAMILY_NODE_TYPES["flowchart"] - {"text"}
    assert er.isdisjoint(flow)
    assert not (FAMILY_NODE_TYPES["uml"] & er)
    assert not (FAMILY_NODE_TYPES["dfd"] & er)


def test_every_family_vocabulary_member_is_canonical():
    from diagram.schema import NODE_TYPES

    for family, types in FAMILY_NODE_TYPES.items():
        for t in types:
            assert t in NODE_TYPES, f"{family} vocabulary contains unknown type {t}"


def test_validate_still_passes_after_enforcement():
    payload = {
        "diagram_type": "er",
        "nodes": [
            {"id": "n1", "type": "hexagon", "label": "Weird", "bbox": [0, 0, 100, 60]},
            {"id": "n2", "type": "diamond", "label": "relates", "bbox": [200, 0, 280, 60]},
        ],
        "edges": [{"source": "n1", "target": "n2"}],
    }
    diagram = to_canonical_diagram(normalize_source_payload(payload, "huggingface", "er"))
    ok, errors = validate_diagram(diagram)
    assert ok, errors
    assert {n["type"] for n in diagram["nodes"]} <= FAMILY_NODE_TYPES["er"]
