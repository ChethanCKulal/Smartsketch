"""POST /api/recognize with an explicit flowchart: routing, contract, failures.

The detector and the Groq service are both replaced, so nothing here needs a GPU,
weights, or an API key. What is under test is the routing decision and the
response the frontend actually receives.
"""

import copy
import io

import pytest
from PIL import Image

from diagram.schema import FAMILY_NODE_TYPES, validate_diagram
from recognition.groq_service import GroqRecognitionError
from recognition.yolo_service import YoloError
from routes import recognize as recognize_route


def png_bytes(width=640, height=480):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (250, 250, 250)).save(buf, format="PNG")
    return buf.getvalue()


# process, decision, terminator and an io (trained class "data") plus the arrow
# and arrowhead that link the first two.
DETECTION = {
    "ok": True,
    "source": "yolo",
    "width": 640,
    "height": 480,
    "imgsz": 640,
    "conf": 0.25,
    "device": "cpu",
    "weights": "best.pt",
    "class_names": {"0": "arrow", "1": "arrowhead", "2": "data", "3": "decision", "4": "process", "5": "terminator"},
    "class_counts": {"process": 1, "decision": 1, "data": 1, "terminator": 1},
    "symbols": [
        {"class_id": 4, "class_name": "process", "confidence": 0.92, "bbox": [64, 48, 256, 144]},
        {"class_id": 3, "class_name": "decision", "confidence": 0.85, "bbox": [80, 240, 240, 400]},
        {"class_id": 5, "class_name": "terminator", "confidence": 0.9, "bbox": [400, 48, 560, 120]},
        {"class_id": 2, "class_name": "data", "confidence": 0.8, "bbox": [400, 240, 560, 320]},
    ],
    "connectors": [
        {"class_id": 0, "class_name": "arrow", "confidence": 0.7, "bbox": [150, 150, 170, 235]},
        {"class_id": 1, "class_name": "arrowhead", "confidence": 0.65, "bbox": [150, 210, 170, 240]},
    ],
    "detections": [],
}

GROQ_PAYLOAD = {
    "diagram_type": "flowchart",
    "nodes": [
        {"id": "n1", "type": "process", "label": "Take order", "bbox": [64, 48, 256, 144]},
        {"id": "n2", "type": "decision", "label": "Approved?", "bbox": [80, 240, 240, 400]},
        {"id": "n3", "type": "terminator", "label": "Start", "bbox": [400, 48, 560, 120]},
        {"id": "n4", "type": "io", "label": "Send invoice", "bbox": [400, 240, 560, 320]},
    ],
    "edges": [
        # The text source saw the connection but not its direction.
        {"id": "e1", "source": "n1", "target": "n2", "label": "yes", "arrow": "none", "confidence": 0.8},
        {"source": "n3", "target": "n1"},
        {"source": "n1", "target": "n9"},  # references a node that does not exist
    ],
}


def fake_detect(image_bytes, *args, **kwargs):
    return copy.deepcopy(DETECTION)


def fake_groq(image_bytes, mime_type="image/png", diagram_type="auto"):
    return copy.deepcopy(GROQ_PAYLOAD)


@pytest.fixture()
def stubs(monkeypatch):
    """Detector and text source both succeed; a real call would fail the test."""
    monkeypatch.setattr(recognize_route, "detect_flowchart_symbols", fake_detect)
    monkeypatch.setattr(recognize_route, "recognize_with_groq", fake_groq)
    monkeypatch.setattr(recognize_route, "resolve_vision_model", lambda *a, **k: {"model": "qwen/qwen3.8-27b"})
    monkeypatch.delenv("SMARTSKETCH_YOLO_ENABLED", raising=False)
    return monkeypatch


def post(client, diagram_type="flowchart", auto_detect="false", image=None):
    return client.post(
        "/api/recognize",
        data={
            "image": (io.BytesIO(image or png_bytes()), "diagram.png"),
            "diagram_type": diagram_type,
            "auto_detect": auto_detect,
        },
        content_type="multipart/form-data",
    )


def _vision_only(monkeypatch):
    """The vision payload the fallback path uses, and nothing from the detector."""
    monkeypatch.setattr(
        recognize_route,
        "recognize_with_groq",
        lambda *a, **k: {
            "diagram_type": "flowchart",
            "nodes": [{"id": "n1", "type": "process", "label": "Step one", "bbox": [10, 10, 110, 90]}],
            "edges": [],
        },
    )
    monkeypatch.setattr(recognize_route, "resolve_vision_model", lambda *a, **k: {"model": "qwen/qwen3.8-27b"})


def _detector_must_not_run(monkeypatch):
    def _fail(*args, **kwargs):
        raise AssertionError("the trained detector must not be used for this request")

    monkeypatch.setattr(recognize_route, "detect_flowchart_symbols", _fail)


# --- the explicit flowchart path ---------------------------------------------


def test_explicit_flowchart_is_recognized_by_the_detector(client, stubs):
    res = post(client)
    assert res.status_code == 200
    body = res.get_json()
    diagram = body["diagram"]
    assert diagram["diagram_type"] == "flowchart"
    assert [n["label"] for n in diagram["nodes"]] == ["Take order", "Approved?", "Start", "Send invoice"]
    assert "trained detector" in body["message"]
    assert body["partial"] is False


def test_detected_types_reach_the_canvas_in_the_flowchart_vocabulary(client, stubs):
    diagram = post(client).get_json()["diagram"]
    types = {n["id"]: n["type"] for n in diagram["nodes"]}
    assert types == {"yolo_n1": "process", "yolo_n2": "decision", "yolo_n3": "terminator", "yolo_n4": "io"}
    assert all(t in FAMILY_NODE_TYPES["flowchart"] for t in types.values())
    assert not {"arrow", "arrowhead"} & set(types.values())


def test_every_node_carries_placement_style_and_provenance(client, stubs):
    diagram = post(client).get_json()["diagram"]
    for node in diagram["nodes"]:
        # Pixel boxes from the detector must never reach the canvas as they are:
        # the canonical layout re-places and re-sizes every shape.
        assert isinstance(node["position"]["x"], int) and isinstance(node["position"]["y"], int)
        assert node["position"]["x"] > 0 and node["position"]["y"] > 0
        assert 40 <= node["size"]["width"] <= 460 and 28 <= node["size"]["height"] <= 560
        assert node["style"]["fontSize"] > 0
        assert node["confidence"] is not None and 0 < node["confidence"] <= 1
        assert node["sources"] == ["groq", "yolo"]
    assert len({(n["position"]["x"], n["position"]["y"]) for n in diagram["nodes"]}) == len(diagram["nodes"])


def test_canonical_diagram_is_valid_with_real_edge_endpoints(client, stubs):
    diagram = post(client).get_json()["diagram"]
    ok, errors = validate_diagram(diagram)
    assert ok, errors
    ids = {n["id"] for n in diagram["nodes"]}
    assert diagram["edges"]
    for edge in diagram["edges"]:
        assert edge["source"] in ids and edge["target"] in ids
        assert edge["source"] != edge["target"]


def test_nodes_do_not_overlap_after_layout(client, stubs):
    nodes = post(client).get_json()["diagram"]["nodes"]
    for i, first in enumerate(nodes):
        for second in nodes[i + 1:]:
            a, b = first["position"], second["position"]
            separated = (
                a["x"] + first["size"]["width"] <= b["x"]
                or b["x"] + second["size"]["width"] <= a["x"]
                or a["y"] + first["size"]["height"] <= b["y"]
                or b["y"] + second["size"]["height"] <= a["y"]
            )
            assert separated, f"{first['id']} overlaps {second['id']}"


def test_relationships_are_mapped_onto_detected_symbols(client, stubs):
    body = post(client).get_json()
    pairs = {(e["source"], e["target"]) for e in body["diagram"]["edges"]}
    assert pairs == {("yolo_n1", "yolo_n2"), ("yolo_n3", "yolo_n1")}
    first = next(e for e in body["diagram"]["edges"] if e["target"] == "yolo_n2")
    assert first["label"] == "yes"
    # The text did not know the direction; the drawn arrowhead supplied it.
    assert first["arrow"] == "forward"
    assert first["sources"] == ["groq", "yolo"]
    report = body["reconciliation"]
    assert report["engine"] == "yolo_groq_fusion"
    assert report["labels_matched"] == 4
    assert report["edges_from_text"] == 2
    assert report["edges_rejected"] == 1  # the edge to a nonexistent symbol
    assert report["labels_are_placeholders"] is False


def test_a_shape_disagreement_reaches_the_response(client, stubs):
    payload = copy.deepcopy(GROQ_PAYLOAD)
    payload["nodes"][0]["type"] = "terminator"  # the detector read a process box
    stubs.setattr(recognize_route, "recognize_with_groq", lambda *a, **k: payload)
    body = post(client).get_json()
    assert body["diagram"]["nodes"][0]["type"] == "process"
    assert body["reconciliation"]["type_disagreements"] == 1
    assert body["reconciliation"]["disagreements"][0]["vision"] == "terminator"
    assert body["reconciliation"]["disagreements"][0]["chosen"] == "process"


def test_response_keeps_the_existing_contract(client, stubs):
    body = post(client).get_json()
    assert {"diagram", "message", "partial", "image", "reconciliation", "sources"} <= set(body)
    assert body["image"]["width"] == 640 and body["image"]["height"] == 480
    assert body["image"]["ocr"]["text_hint"] is None
    assert {"requested_type", "detected_type", "sources_used", "warnings", "disagreements"} <= set(body["reconciliation"])
    assert body["reconciliation"]["requested_type"] == "flowchart"
    assert body["reconciliation"]["disagreements"] == []
    assert {"gemini", "groq", "yolo"} <= set(body["sources"])
    assert body["sources"]["yolo"]["node_count"] == 4
    assert body["sources"]["yolo"]["connector_count"] == 2
    assert body["sources"]["yolo"]["class_counts"] == {"process": 1, "decision": 1, "data": 1, "terminator": 1}
    assert body["sources"]["groq"]["model"] == "qwen/qwen3.8-27b"
    # Gemini is not called for an explicit flowchart, and the response says so.
    assert body["sources"]["gemini"]["ok"] is False and body["sources"]["gemini"]["node_count"] == 0


def test_gemini_is_not_called_for_an_explicit_flowchart(client, stubs):
    def _fail(*args, **kwargs):
        raise AssertionError("Gemini must not run for an explicit flowchart")

    stubs.setattr(recognize_route, "recognize_with_gemini", _fail)
    assert post(client).status_code == 200


def test_missing_image_is_still_a_400(client, stubs):
    res = client.post("/api/recognize", data={"diagram_type": "flowchart", "auto_detect": "false"})
    assert res.status_code == 400


def test_invalid_image_is_still_a_400_without_running_the_detector(client, stubs):
    _detector_must_not_run(stubs)
    res = client.post(
        "/api/recognize",
        data={"image": (io.BytesIO(b"not an image"), "x.png"), "diagram_type": "flowchart"},
        content_type="multipart/form-data",
    )
    assert res.status_code == 400


# --- degraded but useful paths ----------------------------------------------


def test_text_failure_keeps_detected_shapes_and_marks_them_placeholders(client, stubs):
    def _fail(*args, **kwargs):
        raise GroqRecognitionError("GROQ_API_KEY is not configured.", "missing_key", 503)

    stubs.setattr(recognize_route, "recognize_with_groq", _fail)
    res = post(client)
    assert res.status_code == 200
    body = res.get_json()
    assert body["partial"] is True
    assert len(body["diagram"]["nodes"]) == 4
    assert all(n["label"].startswith(("Process", "Decision", "Start/End", "Input/Output")) for n in body["diagram"]["nodes"])
    assert body["reconciliation"]["labels_are_placeholders"] is True
    assert any("placeholder" in w for w in body["reconciliation"]["warnings"])
    assert body["sources"]["groq"]["ok"] is False
    # The arrow the detector saw is still a real connection.
    assert len(body["diagram"]["edges"]) == 1
    assert body["diagram"]["edges"][0]["arrow"] == "forward"


def test_no_symbols_falls_back_to_the_vision_pipeline(client, stubs):
    empty = copy.deepcopy(DETECTION)
    empty["symbols"] = []
    stubs.setattr(recognize_route, "detect_flowchart_symbols", lambda *a, **k: empty)
    _vision_only(stubs)
    res = post(client)
    assert res.status_code == 200
    body = res.get_json()
    assert [n["label"] for n in body["diagram"]["nodes"]] == ["Step one"]
    assert any("no flowchart symbols" in w for w in body["reconciliation"]["warnings"])
    assert set(body["sources"]) == {"gemini", "groq"}


def test_detector_unavailable_falls_back_and_reports_why(client, stubs):
    def _missing(*args, **kwargs):
        raise YoloError("Flowchart detection needs the 'ultralytics' package.", "missing_dependency", 503)

    stubs.setattr(recognize_route, "detect_flowchart_symbols", _missing)
    _vision_only(stubs)
    res = post(client)
    assert res.status_code == 200
    body = res.get_json()
    assert [n["label"] for n in body["diagram"]["nodes"]] == ["Step one"]
    warnings = " ".join(body["reconciliation"]["warnings"])
    assert "ultralytics" in warnings and "fell back" in warnings
    assert set(body["sources"]) == {"gemini", "groq"}


def test_inference_failure_is_reported_without_falling_back(client, stubs):
    def _boom(*args, **kwargs):
        raise YoloError("Flowchart detection failed (RuntimeError).", "inference_failed", 502)

    stubs.setattr(recognize_route, "detect_flowchart_symbols", _boom)
    _detector_must_not_run_calls = []
    stubs.setattr(recognize_route, "recognize_with_gemini", lambda *a, **k: _detector_must_not_run_calls.append(1))
    res = post(client)
    assert res.status_code == 502
    body = res.get_json()
    assert "detection failed" in body["error"]
    assert body["sources"]["yolo"]["ok"] is False
    assert body["sources"]["yolo"]["code"] == "inference_failed"
    assert _detector_must_not_run_calls == []


# --- what the user is told when the text source cannot answer ---------------


def test_a_limited_text_source_reports_the_reason_instead_of_only_zeros(client, stubs, caplog):
    """The failure this was written for: YOLO answered, Groq was refused.

    The upload must keep the detected shapes, say why the text is missing, and
    leave the reason in the server log — the response alone was previously the
    only place it existed.
    """

    def _limited(*args, **kwargs):
        raise GroqRecognitionError(
            "Groq rate limit reached: the account's per-minute window is spent, which says "
            "nothing about the image. Wait about 40s and try again.",
            "rate_limit",
            429,
        )

    stubs.setattr(recognize_route, "recognize_with_groq", _limited)
    with caplog.at_level("WARNING"):
        res = post(client)
    assert res.status_code == 200
    body = res.get_json()
    assert body["partial"] is True
    # The detector still contributed everything it knows.
    assert len(body["diagram"]["nodes"]) == 4
    assert body["sources"]["yolo"]["ok"] is True
    assert body["sources"]["yolo"]["node_count"] == 4
    # And the source that failed says why, rather than reporting 0 nodes only.
    assert body["sources"]["groq"]["ok"] is False
    assert body["sources"]["groq"]["code"] == "rate_limit"
    assert "per-minute window" in body["sources"]["groq"]["error"]
    assert any("could not be read" in w for w in body["reconciliation"]["warnings"])
    assert "rate_limit" in caplog.text


def test_a_request_too_large_is_reported_as_unfixable_by_waiting(client, stubs):
    def _too_large(*args, **kwargs):
        raise GroqRecognitionError(
            "Groq refused this request as too large for the account's output-token limit; "
            "retrying it unchanged cannot help.",
            "output_too_large",
            429,
        )

    stubs.setattr(recognize_route, "recognize_with_groq", _too_large)
    body = post(client).get_json()
    assert body["sources"]["groq"]["code"] == "output_too_large"
    assert "cannot help" in body["sources"]["groq"]["error"]
    assert len(body["diagram"]["nodes"]) == 4  # the shapes still arrive


def test_an_empty_text_source_keeps_the_detected_shapes_and_says_it_had_nothing(client, stubs):
    """Groq answered, in time, with nothing in it, and no key was missing.

    That is a different message from a failed call, and the shapes it could not
    name still reach the canvas.
    """
    stubs.setattr(
        recognize_route,
        "recognize_with_groq",
        lambda *a, **k: {"diagram_type": "flowchart", "nodes": [], "edges": []},
    )
    res = post(client)
    assert res.status_code == 200
    body = res.get_json()
    assert body["partial"] is False  # nothing failed; the answer was simply empty
    assert len(body["diagram"]["nodes"]) == 4
    assert all(n["label"].startswith(("Process", "Decision", "Start/End", "Input/Output")) for n in body["diagram"]["nodes"])
    assert body["sources"]["groq"]["ok"] is True
    assert body["sources"]["groq"]["node_count"] == 0
    assert any("returned no labels" in w for w in body["reconciliation"]["warnings"])
    assert body["reconciliation"]["labels_are_placeholders"] is True


def test_a_truncated_text_source_keeps_its_labels_and_says_the_answer_was_cut_off(client, stubs):
    payload = copy.deepcopy(GROQ_PAYLOAD)
    payload["text_note"] = (
        "The text model reached its 1024-token output limit before it finished, so some "
        "shapes in this drawing keep a placeholder name."
    )
    stubs.setattr(recognize_route, "recognize_with_groq", lambda *a, **k: payload)
    body = post(client).get_json()
    # Everything it did read still lands on the right symbols...
    assert [n["label"] for n in body["diagram"]["nodes"]] == [
        "Take order",
        "Approved?",
        "Start",
        "Send invoice",
    ]
    assert body["partial"] is False
    # ...and the shortfall is stated rather than looking like a complete reading.
    assert any("output limit" in w for w in body["reconciliation"]["warnings"])
    assert "output limit" in body["message"]


# --- the other paths are untouched ------------------------------------------


@pytest.mark.parametrize("diagram_type", ["er", "uml", "dfd"])
def test_other_families_never_run_the_detector(client, stubs, diagram_type):
    _detector_must_not_run(stubs)
    res = post(client, diagram_type=diagram_type)
    assert res.status_code == 200
    body = res.get_json()
    # The vision pipeline answered, with its own contract.
    assert set(body["sources"]) == {"gemini", "groq"}
    assert body["reconciliation"]["requested_type"] == diagram_type
    assert "engine" not in body["reconciliation"]
    assert body["diagram"]["diagram_type"] == diagram_type


def test_auto_detection_keeps_the_vision_pipeline(client, stubs):
    _detector_must_not_run(stubs)
    res = post(client, diagram_type="flowchart", auto_detect="true")
    assert res.status_code == 200
    body = res.get_json()
    assert body["reconciliation"]["requested_type"] == "auto"
    assert set(body["sources"]) == {"gemini", "groq"}


def test_detector_can_be_switched_off_by_configuration(client, stubs):
    _detector_must_not_run(stubs)
    stubs.setenv("SMARTSKETCH_YOLO_ENABLED", "false")
    _vision_only(stubs)
    res = post(client)
    assert res.status_code == 200
    assert set(res.get_json()["sources"]) == {"gemini", "groq"}


def test_health_reports_the_detector_without_loading_it(client, monkeypatch):
    def _fail(*args, **kwargs):
        raise AssertionError("a health check must not load the model")

    monkeypatch.setattr("recognition.yolo_service._create_model", _fail)
    body = client.get("/api/health").get_json()
    assert body["ok"] is True
    assert body["yolo"]["enabled"] is True
    assert body["yolo"]["loaded"] is False
    assert {"weights", "present", "device", "imgsz", "conf"} <= set(body["yolo"])
