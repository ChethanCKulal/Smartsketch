"""Unit tests for the reconciliation engine."""

from recognition.reconciliation_engine import WeightStrategy, reconcile
from diagram.normalizer import normalize_source_payload


GEMINI = {
    "diagram_type": "er",
    "nodes": [
        {"id": "n1", "type": "entity", "label": "Student", "bbox": [10, 10, 110, 90], "confidence": 0.91, "attributes": ["StudentID"]},
        {"id": "n2", "type": "entity", "label": "Course", "bbox": [300, 10, 400, 90], "confidence": 0.88},
    ],
    "edges": [
        {"id": "e1", "source": "n1", "target": "n2", "label": "Enrolls", "arrow": "forward", "confidence": 0.84}
    ],
}

GROQ = {
    "diagram_type": "er",
    "nodes": [
        {"id": "n1", "type": "entity", "label": "Student", "bbox": [12, 12, 112, 92], "confidence": 0.84, "attributes": ["Name"]},
        {"id": "n2", "type": "entity", "label": "Course", "bbox": [302, 8, 402, 88], "confidence": 0.9},
    ],
    "edges": [
        {"id": "e1", "source": "n1", "target": "n2", "label": "Enrolls", "arrow": "forward", "confidence": 0.8}
    ],
}


def _normalized(payload, source):
    return normalize_source_payload(payload, source, "er")


def test_agreement_boosts_confidence_and_records_sources():
    result = reconcile([_normalized(GEMINI, "gemini"), _normalized(GROQ, "groq")])
    assert result["ok"]
    student = next(n for n in result["nodes"] if n["label"] == "Student")
    # Weighted mean of 0.91/0.84 plus the agreement boost, capped at 1.
    assert student["confidence"] > 0.84
    assert set(student["sources"]) == {"gemini", "groq"}
    # Attributes union is preserved.
    assert set(student["attributes"]) == {"StudentID", "Name"}
    assert {n["sources"] and "groq" in n["sources"] for n in result["nodes"]}
    assert result["sources_used"] == ["gemini", "groq"]
    assert not result["disagreements"]


def test_neither_source_overwrites_the_other():
    result = reconcile([_normalized(GEMINI, "gemini"), _normalized(GROQ, "groq")])
    # A merged node is a new object, not either input.
    for node in result["nodes"]:
        assert node["id"] not in {"n1", "n2", "h_n1", "h_n2"}


def test_disagreement_picks_higher_weighted_confidence():
    # 0.62*1.0 (gemini) vs 0.75*0.95 (groq): Groq wins, outside tie band.
    gem = {
        "diagram_type": "er",
        "nodes": [{"id": "n1", "type": "entity", "label": "Student", "bbox": [10, 10, 110, 90], "confidence": 0.62}],
        "edges": [],
    }
    groq = {
        "diagram_type": "er",
        "nodes": [{"id": "n1", "type": "entity", "label": "Pupil", "bbox": [10, 10, 110, 90], "confidence": 0.75}],
        "edges": [],
    }
    result = reconcile([_normalized(gem, "gemini"), _normalized(groq, "groq")])
    assert result["ok"]
    assert result["disagreements"], "label conflict should be reported"
    chosen = next(n for n in result["nodes"] if n["label"] in ("Student", "Pupil"))
    assert chosen["label"] == "Pupil"


def test_disagreement_tie_breaks_deterministically():
    # Scores within 0.04: denser label wins regardless of confidence order.
    gem = {
        "diagram_type": "er",
        "nodes": [{"id": "n1", "type": "entity", "label": "Student", "bbox": [10, 10, 110, 90], "confidence": 0.85}],
        "edges": [],
    }
    groq = {
        "diagram_type": "er",
        "nodes": [{"id": "n1", "type": "entity", "label": "Student Registration Record", "bbox": [10, 10, 110, 90], "confidence": 0.92}],
        "edges": [],
    }
    result = reconcile([_normalized(gem, "gemini"), _normalized(groq, "groq")])
    assert result["ok"]
    chosen = next(n for n in result["nodes"] if n["label"].startswith(("Student", "Student Registration")))
    assert chosen["label"] == "Student Registration Record"


def test_single_source_survives_partial_failure():
    failed = {"ok": False, "source": "gemini", "error": "Gemini failed.", "nodes": [], "edges": []}
    result = reconcile([failed, _normalized(GROQ, "groq")])
    assert result["ok"]
    assert result["partial"]
    assert result["nodes"]
    assert any("Gemini failed" in w for w in result["warnings"])


def test_both_sources_failing_is_reported():
    failed = {"ok": False, "source": "gemini", "error": "down", "nodes": [], "edges": []}
    result = reconcile([failed, dict(failed, source="groq", error="down too")])
    assert not result["ok"]
    assert "Both recognition sources failed" in result["error"]


def test_strategy_is_swappable():
    class GroqFirst(WeightStrategy):
        def source_weight(self, source):
            return 1.0 if source == "groq" else 0.5

    result = reconcile(
        [_normalized(GEMINI, "gemini"), _normalized(GROQ, "groq")],
        strategy=GroqFirst(),
    )
    assert result["ok"]
    student = next(n for n in result["nodes"] if n["label"] == "Student")
    assert set(student["sources"]) == {"gemini", "groq"}


def test_id_collision_across_sources_does_not_break_merging():
    # Both services emit "n1"/"n2"; ids must not collide during merge.
    result = reconcile([_normalized(GEMINI, "gemini"), _normalized(GROQ, "groq")])
    ids = [n["id"] for n in result["nodes"]]
    assert len(ids) == len(set(ids)) == 2
    edge_ids = [e["id"] for e in result["edges"]]
    assert len(edge_ids) == len(set(edge_ids)) == 1
