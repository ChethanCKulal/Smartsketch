import os
import base64
import time

import requests

from diagram.json_extract import extract_json
from recognition.prompts import diagram_hint_block

STRICT_PROMPT = """You are a software-engineering diagram recognizer.
Analyze the uploaded photograph of a hand-drawn diagram.

Return STRICT JSON only. No markdown. No prose.

Schema:
{
  "diagram_type": "flowchart" | "uml" | "er" | "dfd",
  "nodes": [
    {
      "id": "n1",
      "type": "process|decision|terminator|io|document|database|class|interface|entity|attribute|relationship|weakEntity|dfdProcess|dataStore|externalEntity|rectangle|diamond|ellipse",
      "label": "string",
      "attributes": ["optional"],
      "bbox": [x1, y1, x2, y2],
      "confidence": 0.0
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "n1",
      "target": "n2",
      "label": "string",
      "arrow": "forward|backward|both|none",
      "confidence": 0.0
    }
  ]
}

Identify shapes, text, entities, attributes, relationships, connectors, arrow directions, approximate pixel positions, and confidence.
Use "rectangle" only when a shape matches no domain notation.
DIAGRAM_TYPE_HINT
"""


class RecognitionError(Exception):
    def __init__(self, message, code="gemini_error", status=502):
        super().__init__(message)
        self.code = code
        self.status = status


# Tried in order when the configured model is retired or unavailable.
# Each entry carries its own generationConfig extras: some models reject
# thinkingConfig entirely, others only stay fast with thinking disabled.
FALLBACK_MODELS = (
    ("gemini-3.6-flash", {}),
    ("gemini-3.5-flash", {"thinkingConfig": {"thinkingBudget": 0}}),
    ("gemini-flash-latest", {}),
)


def recognize_with_gemini(image_bytes, mime_type="image/png", diagram_type="auto"):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RecognitionError("GEMINI_API_KEY is not configured.", "missing_key", 503)

    prompt = STRICT_PROMPT.replace("DIAGRAM_TYPE_HINT", diagram_hint_block(diagram_type))
    base_config = {
        "temperature": 0.1,
        "responseMimeType": "application/json",
        "maxOutputTokens": 8192,
    }

    configured = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
    models = [(configured, {})] + [(m, extra) for m, extra in FALLBACK_MODELS if m != configured]
    last_response = None
    for model, extra_config in models:
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": base64.b64encode(image_bytes).decode("ascii"),
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {**base_config, **extra_config},
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            response = requests.post(url, params={"key": api_key}, json=payload, timeout=90)
            # 5xx from Gemini is usually transient overload — retry once.
            if response.status_code >= 500:
                time.sleep(2)
                response = requests.post(url, params={"key": api_key}, json=payload, timeout=90)
        except requests.RequestException as exc:
            raise RecognitionError(f"Gemini network failure: {exc}", "network", 503) from exc
        last_response = response

        if response.status_code == 429:
            raise RecognitionError("Gemini rate limit reached.", "rate_limit", 429)
        # Retired/unknown model: transparently try the next candidate.
        if response.status_code == 404 or (response.status_code == 400 and "model" in response.text.lower()):
            continue
        if response.status_code >= 400:
            raise RecognitionError(f"Gemini API failure ({response.status_code}).", "api_failure", 502)
        return _parse_gemini(response)

    if last_response is not None and last_response.status_code >= 400:
        raise RecognitionError(
            f"Gemini API failure ({last_response.status_code}): no usable model.", "api_failure", 502
        )
    raise RecognitionError("Gemini returned no response.", "empty", 502)


def _parse_gemini(response):

    try:
        body = response.json()
    except ValueError as exc:
        raise RecognitionError("Gemini returned a non-JSON body.", "invalid_json", 502) from exc
    try:
        text = body["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RecognitionError("Empty recognition response from Gemini.", "empty", 502) from exc

    try:
        parsed = extract_json(text)
    except ValueError as exc:
        raise RecognitionError(str(exc), "invalid_json", 502) from exc

    if not isinstance(parsed, dict):
        raise RecognitionError("Gemini JSON was not an object.", "invalid_json", 502)
    return parsed
