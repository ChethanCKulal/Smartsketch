from diagram.normalizer import normalize_source_payload, to_canonical_diagram
from diagram.schema import validate_diagram
from chatbot.command_executor import execute_command
from diagram.json_extract import extract_json


def test_normalize_maps_bbox_and_aliases():
    payload = {
        "diagram_type": "class",
        "nodes": [
            {"id": "n1", "type": "use_case", "label": "Login", "bbox": [0, 0, 100, 50], "confidence": 1.4},
            {"id": "n2", "type": "datastore", "label": "DB", "confidence": None},
        ],
        "edges": [{"source": "n1", "target": "n2", "direction": "bidirectional"}],
    }
    # auto requested type: aliases still canonicalize, no family remap
    norm = normalize_source_payload(payload, "gemini", "auto")
    assert norm["ok"]
    assert norm["diagram_type"] == "uml"
    n1, n2 = norm["nodes"]
    assert n1["type"] == "usecase"  # alias canonicalized
    assert n1["confidence"] == 1.0  # clamped
    assert n2["type"] == "dataStore"
    assert n2["confidence"] == 0.5  # default
    assert norm["edges"][0]["arrow"] == "both"


def test_normalize_resolves_labels_as_edge_endpoints():
    payload = {
        "diagram_type": "er",
        "nodes": [
            {"id": "n1", "type": "entity", "label": "Student", "bbox": [0, 0, 10, 10]},
            {"id": "n2", "type": "entity", "label": "Course", "bbox": [20, 0, 30, 10]},
        ],
        "edges": [{"source": "Student", "target": "Course"}],
    }
    norm = normalize_source_payload(payload, "groq")
    assert norm["edges"][0]["source"] == "n1"
    assert norm["edges"][0]["target"] == "n2"


def test_to_canonical_validates_and_spreads_collapsed_layout():
    norm = normalize_source_payload(
        {
            "diagram_type": "flowchart",
            "nodes": [
                {"id": "n1", "type": "process", "label": "A", "bbox": [50, 50, 100, 80]},
                {"id": "n2", "type": "process", "label": "B", "bbox": [60, 55, 110, 85]},
            ],
            "edges": [{"source": "n1", "target": "n2"}],
        },
        "gemini",
    )
    diagram = to_canonical_diagram(norm)
    ok, errors = validate_diagram(diagram)
    assert ok, errors
    xs = [n["position"]["x"] for n in diagram["nodes"]]
    # The spreader triggers when the bbox spread is < 40 px; verify the grid ran.
    assert not (max(xs) - min(xs) <= 40 and len({tuple(n["position"].values()) for n in diagram["nodes"]}) < len(diagram["nodes"]))


def test_command_executor_add_and_delete():
    diagram = {"nodes": [], "edges": []}
    result = execute_command(
        diagram, {"action": "ADD_NODE", "payload": {"label": "Student", "type": "entity"}}
    )
    assert result["ok"]
    diagram = result["diagram"]
    assert diagram["nodes"][0]["label"] == "Student"

    result = execute_command(diagram, {"action": "DELETE_NODE", "payload": {"label": "Student"}})
    assert result["ok"]
    assert result["diagram"]["nodes"] == []


def test_command_executor_validates_actions():
    result = execute_command({"nodes": [], "edges": []}, {"action": "LAUNCH_MISSILES"})
    assert not result["ok"]


def test_extract_json_variants():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! {"a": 1} hope that helps') == {"a": 1}
    assert extract_json('{"a": [1, 2]}') == {"a": [1, 2]}
    try:
        extract_json("no json here")
        assert False, "should have raised"
    except ValueError:
        pass
