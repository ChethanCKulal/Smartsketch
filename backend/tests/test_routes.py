"""Route-level tests. Recognition routes are exercised with stubbed services."""

import io
import json

import pytest
from PIL import Image


def _png_bytes(w=120, h=80):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (240, 240, 240)).save(buf, format="PNG")
    return buf.getvalue()


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert "gemini_configured" in body
    # Groq readiness is reported without any network call when unconfigured.
    assert body["groq_configured"] is False
    assert body["groq"]["available"] is False
    assert "GROQ_API_KEY is not configured." in body["groq"]["reason"]


def test_recognize_requires_image(client):
    res = client.post("/api/recognize")
    assert res.status_code == 400


def test_recognize_rejects_non_image(client):
    res = client.post(
        "/api/recognize",
        data={"image": (io.BytesIO(b"not an image"), "x.png")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 400


def test_recognize_missing_keys_is_graceful(client):
    res = client.post(
        "/api/recognize",
        data={"image": (io.BytesIO(_png_bytes()), "diagram.png")},
        content_type="multipart/form-data",
    )
    assert res.status_code == 502
    body = res.get_json()
    assert "error" in body
    assert body["sources"]["gemini"]["ok"] is False
    assert body["sources"]["groq"]["ok"] is False


def test_recognize_uses_groq_as_the_second_source(client, monkeypatch):
    """The Groq payload travels through reconciliation into the canonical diagram."""
    from routes import recognize as recognize_route

    def fake_groq(image_bytes, mime_type="image/png", diagram_type="auto"):
        return {
            "diagram_type": "er",
            "nodes": [
                {"id": "n1", "type": "entity", "label": "Student", "bbox": [10, 10, 110, 90], "confidence": 0.9},
                {"id": "n2", "type": "attribute", "label": "Name", "bbox": [10, 120, 80, 160], "confidence": 0.7},
            ],
            "edges": [{"id": "e1", "source": "n1", "target": "n2", "label": "has", "arrow": "none", "confidence": 0.7}],
        }

    monkeypatch.setattr(recognize_route, "recognize_with_groq", fake_groq)
    monkeypatch.setattr(recognize_route, "resolve_vision_model", lambda *a, **k: {"model": "qwen/qwen3.8-27b"})

    res = client.post(
        "/api/recognize",
        data={"image": (io.BytesIO(_png_bytes(240, 240)), "diagram.png"), "diagram_type": "er"},
        content_type="multipart/form-data",
    )
    assert res.status_code == 200
    body = res.get_json()
    # Gemini has no key in tests, so Groq carries the diagram alone: the existing
    # partial-result path must still produce a renderable canonical diagram.
    assert body["partial"] is True
    assert body["reconciliation"]["sources_used"] == ["groq"]
    assert body["sources"]["groq"]["ok"] is True
    assert body["sources"]["groq"]["node_count"] == 2
    assert body["sources"]["groq"]["model"] == "qwen/qwen3.8-27b"
    diagram = body["diagram"]
    assert diagram["diagram_type"] == "er"
    assert {n["label"] for n in diagram["nodes"]} >= {"Student", "Name"}
    assert all(n["type"] in {"entity", "attribute", "relationship", "weakEntity", "text"} for n in diagram["nodes"])


def test_chat_parses_without_diagram(client):
    res = client.post("/api/chat", json={"text": "Add Student entity"})
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"]
    assert body["command"]["action"] == "ADD_NODE"


def test_chat_rejects_bad_input(client):
    res = client.post("/api/chat", json={"text": "frobnicate everything"})
    assert res.status_code == 400
    res = client.post("/api/chat", json={"text": 123})
    assert res.status_code == 400
    res = client.post("/api/chat", data="not json", content_type="application/json")
    assert res.status_code == 400


def test_chat_executes_against_diagram(client):
    diagram = {"nodes": [{"id": "n1", "label": "Student", "type": "entity", "position": {"x": 0, "y": 0}, "size": {"width": 100, "height": 60}}], "edges": []}
    res = client.post("/api/chat", json={"text": "Delete Student", "diagram": diagram})
    assert res.status_code == 200
    body = res.get_json()
    assert body["execution"]["ok"]
    assert body["execution"]["diagram"]["nodes"] == []


def test_export_svg_requires_diagram(client):
    res = client.post("/api/export/svg", json={})
    assert res.status_code == 400


def test_export_svg_renders(client):
    diagram = {
        "diagram_type": "flowchart",
        "nodes": [
            {"id": "n1", "type": "process", "label": "Start", "position": {"x": 0, "y": 0}, "size": {"width": 120, "height": 60}, "style": {}},
            {"id": "n2", "type": "decision", "label": "OK?", "position": {"x": 300, "y": 0}, "size": {"width": 120, "height": 60}, "style": {}},
        ],
        "edges": [
            {"id": "e1", "source": "n1", "target": "n2", "label": "yes", "arrow": "forward", "style": {}},
            {"id": "bad", "source": "n1", "target": "missing", "style": {}},
        ],
    }
    res = client.post("/api/export/svg", json={"diagram": diagram})
    assert res.status_code == 200
    assert res.mimetype == "image/svg+xml"
    svg = res.get_data(as_text=True)
    assert svg.startswith("<svg")
    assert "Start" in svg and "OK?" in svg
    assert 'marker-end="url(#arrow)"' in svg
