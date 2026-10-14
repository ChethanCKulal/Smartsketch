"""UML compartment and ER entity rendering rules.

- A UML class keeps its three compartments: name, attributes, methods — vision
  models often dump all of it into one label, which must be split.
- An ER entity is a plain rectangle holding only its name, so attributes a
  model returned inside the entity must become real attribute nodes.
"""

from diagram.normalizer import merge_members, normalize_source_payload, to_canonical_diagram
from recognition.reconciliation_engine import reconcile


def _canonical(payload, requested=None):
    normalized = normalize_source_payload(payload, "gemini", requested_type=requested)
    return to_canonical_diagram(normalized)


def test_multiline_class_label_is_split_into_compartments():
    payload = {
        "diagram_type": "uml",
        "nodes": [
            {
                "id": "n1",
                "type": "class",
                "label": "Student\n- studentID: int\n- name: String\n+ enroll(): void\n+ drop(): void",
                "bbox": [10, 10, 210, 170],
                "confidence": 0.9,
            }
        ],
        "edges": [],
    }
    node = _canonical(payload, requested="uml")["nodes"][0]
    assert node["label"] == "Student"
    assert node["attributes"] == ["- studentID: int", "- name: String"]
    assert node["methods"] == ["+ enroll(): void", "+ drop(): void"]


def test_pipe_separated_class_label_is_split():
    payload = {
        "diagram_type": "uml",
        "nodes": [
            {
                "id": "n1",
                "type": "class",
                "label": "Course | - code: String | + credits(): int",
                "bbox": [10, 10, 210, 170],
                "confidence": 0.9,
            }
        ],
        "edges": [],
    }
    node = _canonical(payload, requested="uml")["nodes"][0]
    assert node["label"] == "Course"
    assert node["attributes"] == ["- code: String"]
    assert node["methods"] == ["+ credits(): int"]


def test_wrapped_class_name_is_not_treated_as_members():
    payload = {
        "diagram_type": "uml",
        "nodes": [
            {
                "id": "n1",
                "type": "class",
                "label": "Course\nRegistration",
                "bbox": [10, 10, 210, 170],
                "confidence": 0.9,
            }
        ],
        "edges": [],
    }
    node = _canonical(payload, requested="uml")["nodes"][0]
    assert node["label"] == "Course\nRegistration"
    assert node["attributes"] == [] and node["methods"] == []


def test_declared_class_members_are_kept_alongside_parsed_ones():
    payload = {
        "diagram_type": "uml",
        "nodes": [
            {
                "id": "n1",
                "type": "class",
                "label": "Student\n- id: int\n+ save(): void",
                "attributes": ["- email: String"],
                "methods": ["+ load(): void"],
                "bbox": [10, 10, 210, 170],
                "confidence": 0.9,
            }
        ],
        "edges": [],
    }
    node = _canonical(payload, requested="uml")["nodes"][0]
    assert node["attributes"] == ["- email: String", "- id: int"]
    assert node["methods"] == ["+ load(): void", "+ save(): void"]


def test_entity_inline_attributes_become_connected_attribute_nodes():
    payload = {
        "diagram_type": "er",
        "nodes": [
            {
                "id": "n1",
                "type": "entity",
                "label": "STUDENT",
                "attributes": ["DeptID (PK)", "Name"],
                "bbox": [300, 100, 460, 180],
                "confidence": 0.9,
            }
        ],
        "edges": [],
    }
    diagram = _canonical(payload, requested="er")
    entities = [n for n in diagram["nodes"] if n["type"] == "entity"]
    attributes = [n for n in diagram["nodes"] if n["type"] == "attribute"]
    assert len(entities) == 1
    assert entities[0]["attributes"] == []  # nothing rendered inside the box
    assert sorted(a["label"] for a in attributes) == ["DeptID (PK)", "Name"]
    for attribute in attributes:
        assert any(e["source"] == "n1" and e["target"] == attribute["id"] for e in diagram["edges"])


def test_inline_attribute_that_already_exists_as_oval_is_not_duplicated():
    payload = {
        "diagram_type": "er",
        "nodes": [
            {"id": "n1", "type": "entity", "label": "STUDENT", "attributes": ["Name"], "bbox": [300, 100, 460, 180], "confidence": 0.9},
            {"id": "n2", "type": "attribute", "label": "Name", "bbox": [100, 100, 200, 140], "confidence": 0.8},
        ],
        "edges": [],
    }
    diagram = _canonical(payload, requested="er")
    assert [n["label"] for n in diagram["nodes"] if n["type"] == "attribute"] == ["Name"]


def test_cosmetic_duplicate_members_are_merged():
    merged = merge_members(["name", "- name", "-  Name", "+ enroll(): void", "enroll(): void"])
    assert merged == ["- name", "+ enroll(): void"]


def test_member_reported_with_and_without_signature_is_one_member():
    merged = merge_members(["Calc Avg Mark", "+ Calc Avg Mark(): double", "- marks: List<Mark>"])
    assert merged == ["+ Calc Avg Mark(): double", "- marks: List<Mark>"]


def test_reconciliation_keeps_methods_from_both_sources():
    gemini = normalize_source_payload(
        {
            "diagram_type": "uml",
            "nodes": [
                {"id": "n1", "type": "class", "label": "Student", "methods": ["+ enroll()"], "attributes": ["- id"], "bbox": [10, 10, 210, 170], "confidence": 0.9}
            ],
            "edges": [],
        },
        "gemini",
        requested_type="uml",
    )
    groq = normalize_source_payload(
        {
            "diagram_type": "uml",
            "nodes": [
                {"id": "n1", "type": "class", "label": "Student", "methods": ["+ drop()"], "attributes": ["- name"], "bbox": [12, 12, 212, 172], "confidence": 0.85}
            ],
            "edges": [],
        },
        "groq",
        requested_type="uml",
    )
    merged = reconcile([gemini, groq])
    node = merged["nodes"][0]
    assert set(node["methods"]) == {"+ enroll()", "+ drop()"}
    assert set(node["attributes"]) == {"- id", "- name"}
