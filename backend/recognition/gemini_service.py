import os
import base64
import requests

from diagram.json_extract import extract_json

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
If the diagram type is provided as a hint, prefer it unless the image clearly contradicts it.
Hint: DIAGRAM_TYPE_HINT
"""


class RecognitionError(Exception):
    def __init__(self, message, code="gemini_error", status=502):
        super().__init__(message)
        self.code = code
        self.status = status


def recognize_with_gemini(image_bytes, mime_type="image/png", diagram_type="auto"):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RecognitionError("GEMINI_API_KEY is not configured.", "missing_key", 503)

    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    prompt = STRICT_PROMPT.replace("DIAGRAM_TYPE_HINT", diagram_type or "auto")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
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
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }
    try:
        response = requests.post(url, params={"key": api_key}, json=payload, timeout=60)
    except requests.RequestException as exc:
        raise RecognitionError(f"Gemini network failure: {exc}", "network", 503) from exc

    if response.status_code == 429:
        raise RecognitionError("Gemini rate limit reached.", "rate_limit", 429)
    if response.status_code >= 400:
        raise RecognitionError(f"Gemini API failure ({response.status_code}).", "api_failure", 502)

    body = response.json()
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
