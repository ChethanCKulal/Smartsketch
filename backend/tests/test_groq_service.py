"""GroqCloud vision adapter: model resolution, response adaptation, error mapping.

No test in this module touches the network: the Groq client is replaced with a
fake, and every provider failure is injected as the same SDK exception class the
real client raises.
"""

import io
import json

import httpx
import pytest
from PIL import Image
from groq import (
    APIStatusError,
    APITimeoutError,
    BadRequestError,
    NotFoundError,
    RateLimitError,
)

from recognition import groq_service
from recognition.groq_service import GroqRecognitionError, recognize_with_groq


def _png(width=64, height=64):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (250, 250, 250)).save(buf, format="PNG")
    return buf.getvalue()


def _provider_error(cls, status, message):
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    body = {"error": {"message": message}}
    return cls(message, response=httpx.Response(status, request=request, json=body), body=body)


class _FakeCompletions:
    def __init__(self, outcomes):
        # One outcome per call; the last is reused when more calls happen.
        self.outcomes = list(outcomes)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes[min(len(self.calls) - 1, len(self.outcomes) - 1)]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class _FakeClient:
    def __init__(self, model_ids=(), outcomes=None):
        self.models = self
        self._model_ids = list(model_ids)
        self._completions = _FakeCompletions(outcomes or [_completion('{"nodes": []}')])
        self.chat = self

    def list(self):
        return type("Listing", (), {"data": [type("M", (), {"id": i}) for i in self._model_ids]})

    @property
    def completions(self):
        return self._completions

    @property
    def calls(self):
        return self._completions.calls


def _completion(content):
    message = type("Message", (), {"content": content})
    choice = type("Choice", (), {"message": message})
    return type("Completion", (), {"choices": [choice]})


@pytest.fixture(autouse=True)
def _clean_caches():
    groq_service._model_list_cache.update({"at": 0.0, "ids": None})
    groq_service._model_verdicts.clear()
    yield
    groq_service._model_list_cache.update({"at": 0.0, "ids": None})
    groq_service._model_verdicts.clear()


@pytest.fixture()
def _key(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_key_value")
    monkeypatch.delenv("GROQ_VISION_MODEL", raising=False)
    monkeypatch.delenv("GROQ_VISION_MODELS", raising=False)


def _use(monkeypatch, client):
    monkeypatch.setattr(groq_service, "_client", lambda *args, **kwargs: client)
    return client


# --- configuration -----------------------------------------------------------


def test_missing_key_is_reported(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "")
    with pytest.raises(GroqRecognitionError) as excinfo:
        recognize_with_groq(_png())
    assert excinfo.value.code == "missing_key"
    assert excinfo.value.status == 503


def test_resolve_uses_configured_model_when_the_account_has_it(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    _use(monkeypatch, _FakeClient(["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]))
    report = groq_service.resolve_vision_model(refresh=True)
    assert report["available"] is True
    assert report["model"] == "qwen/qwen3.8-27b"
    assert report["configured"] == "qwen/qwen3.8-27b"
    assert report["reason"] is None


def test_resolve_substitutes_a_retired_configured_model(monkeypatch, _key):
    # A model that Groq has retired (Llama 4 vision) must not break uploads.
    monkeypatch.setenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
    monkeypatch.setenv("GROQ_VISION_MODELS", "qwen/qwen3.8-27b")
    _use(monkeypatch, _FakeClient(["qwen/qwen3.8-27b"]))
    report = groq_service.resolve_vision_model(refresh=True)
    assert report["available"] is True
    assert report["model"] == "qwen/qwen3.8-27b"
    assert "not usable" in report["reason"]


def test_no_vision_model_is_reported_instead_of_silently_using_a_text_model(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    _use(monkeypatch, _FakeClient(["openai/gpt-oss-120b", "allam-2-7b"]))
    report = groq_service.resolve_vision_model(refresh=True)
    assert report["available"] is False
    assert report["model"] is None
    assert "available" in report["reason"]

    with pytest.raises(GroqRecognitionError) as excinfo:
        recognize_with_groq(_png())
    assert excinfo.value.code == "no_vision_model"


# --- preflight ---------------------------------------------------------------


def test_probe_confirms_the_model_accepts_images(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    client = _use(monkeypatch, _FakeClient(["qwen/qwen3.8-27b"], [_completion('{"accepted": true}')]))
    report = groq_service.probe_vision_support(refresh=True)
    assert report["ok"] is True
    assert report["model"] == "qwen/qwen3.8-27b"
    # The probe really sends an image part, not just text.
    content = client.chat.calls[0]["messages"][0]["content"]
    assert any(part["type"] == "image_url" for part in content)


def test_probe_rejects_a_text_only_model(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "openai/gpt-oss-120b")
    client = _use(
        monkeypatch,
        _FakeClient(
            ["openai/gpt-oss-120b"],
            [_provider_error(BadRequestError, 400, "messages[0].content must be a string")],
        ),
    )
    report = groq_service.probe_vision_support(refresh=True)
    assert report["ok"] is False
    assert "does not accept image input" in report["reason"]
    # And the model is not offered again for the cache window.
    candidates, _ = groq_service.vision_candidates(client=client)
    assert candidates == []


# --- recognition -------------------------------------------------------------


def test_recognition_adapts_entities_to_nodes(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    payload = {
        "diagram_type": "er",
        "entities": [{"id": "n1", "type": "entity", "label": "Student", "bbox": [0, 0, 80, 40], "confidence": 0.8}],
        "relationships": [{"source": "n1", "target": "n1", "label": ""}],
    }
    client = _use(
        monkeypatch, _FakeClient(["qwen/qwen3.8-27b"], [_completion(json.dumps(payload))])
    )
    result = recognize_with_groq(_png(), "image/png", "er")
    assert [n["label"] for n in result["nodes"]] == ["Student"]
    call = client.chat.calls[0]
    assert call["model"] == "qwen/qwen3.8-27b"
    # JSON-constrained output is requested, and the image travels as a data URL.
    assert call["response_format"] == {"type": "json_object"}
    image_part = [p for p in call["messages"][0]["content"] if p["type"] == "image_url"][0]
    assert image_part["image_url"]["url"].startswith("data:image/png;base64,")


def test_recognition_rejects_an_image_below_the_provider_minimum(monkeypatch, _key):
    client = _use(monkeypatch, _FakeClient(["qwen/qwen3.8-27b"]))
    with pytest.raises(GroqRecognitionError) as excinfo:
        recognize_with_groq(_png(16, 16))
    assert excinfo.value.code == "image_too_small"
    assert client.chat.calls == []  # nothing was sent to the provider


def test_rate_limit_is_surfaced_without_retrying(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    client = _use(
        monkeypatch,
        _FakeClient(
            ["qwen/qwen3.8-27b"], [_provider_error(RateLimitError, 429, "Rate limit reached")]
        ),
    )
    with pytest.raises(GroqRecognitionError) as excinfo:
        recognize_with_groq(_png())
    assert excinfo.value.code == "rate_limit"
    assert len(client.chat.calls) == 1


def test_billing_error_is_surfaced_as_payment_required(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    _use(
        monkeypatch,
        _FakeClient(
            ["qwen/qwen3.8-27b"],
            [_provider_error(APIStatusError, 402, "Insufficient credits")],
        ),
    )
    with pytest.raises(GroqRecognitionError) as excinfo:
        recognize_with_groq(_png())
    assert excinfo.value.code == "payment_required"
    assert excinfo.value.status == 402


def test_timeout_maps_to_a_network_error(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    _use(
        monkeypatch,
        _FakeClient(
            ["qwen/qwen3.8-27b"],
            [APITimeoutError(request=request)],
        ),
    )
    with pytest.raises(GroqRecognitionError) as excinfo:
        recognize_with_groq(_png())
    assert excinfo.value.code == "network"


def test_api_key_is_never_echoed_in_errors(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_secret_not_for_logs")
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    _use(
        monkeypatch,
        _FakeClient(["qwen/qwen3.8-27b"], [_provider_error(APIStatusError, 500, "Internal error")]),
    )
    with pytest.raises(GroqRecognitionError) as excinfo:
        recognize_with_groq(_png())
    assert "gsk_secret_not_for_logs" not in str(excinfo.value)


def test_credential_shaped_text_in_provider_errors_is_redacted(monkeypatch, _key, caplog):
    """Provider errors are surfaced to the client, so keys must never echo back."""
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    detail = "bad request for key gsk_leaked_value in organization org_01abc23"
    _use(
        monkeypatch,
        _FakeClient(["qwen/qwen3.8-27b"], [_provider_error(BadRequestError, 400, detail)]),
    )
    with caplog.at_level("WARNING"):
        with pytest.raises(GroqRecognitionError) as excinfo:
            recognize_with_groq(_png())
    assert "gsk_leaked_value" not in str(excinfo.value)
    assert "org_01abc23" not in str(excinfo.value)
    assert "gsk_leaked_value" not in caplog.text


def test_invalid_json_body_is_reported(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    _use(monkeypatch, _FakeClient(["qwen/qwen3.8-27b"], [_completion("I could not read that.")]))
    with pytest.raises(GroqRecognitionError) as excinfo:
        recognize_with_groq(_png())
    assert excinfo.value.code == "invalid_json"


def test_retired_model_falls_through_to_the_next_candidate(monkeypatch, _key):
    monkeypatch.setenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
    monkeypatch.setenv("GROQ_VISION_MODELS", "qwen/qwen3.8-27b")
    payload = {"diagram_type": "dfd", "nodes": [{"id": "n1", "type": "dfdProcess", "label": "Validate", "bbox": [0, 0, 60, 60]}]}
    client = _use(
        monkeypatch,
        _FakeClient(
            ["meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3.8-27b"],
            [_provider_error(NotFoundError, 404, "model_not_found"), _completion(json.dumps(payload))],
        ),
    )
    result = recognize_with_groq(_png(), "image/png", "dfd")
    assert result["nodes"][0]["label"] == "Validate"
    assert [call["model"] for call in client.chat.calls] == [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "qwen/qwen3.8-27b",
    ]
