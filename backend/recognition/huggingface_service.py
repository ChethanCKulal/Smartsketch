import os
import base64
import requests

from diagram.json_extract import extract_json
from recognition.prompts import diagram_hint_block

STRICT_PROMPT = """Extract a software engineering diagram from this image.
Return STRICT JSON only, no markdown, matching:
{
  "diagram_type": "flowchart|uml|er|dfd",
  "nodes": [{"id":"n1","type":"entity|process|class|decision|terminator|dataStore|externalEntity|attribute|relationship","label":"...","attributes":[],"methods":[],"bbox":[x1,y1,x2,y2],"confidence":0.0}],
  "edges": [{"id":"e1","source":"n1","target":"n2","label":"","arrow":"forward","confidence":0.0}]
}
Identify diagram type, nodes, text, attributes, methods, relationships, connectors, bounding boxes, and confidence.
A class/interface label is ONLY the class name — its members go in "attributes" and "methods", never in the label.
Use "rectangle" only when a shape matches no domain notation.
DIAGRAM_TYPE_HINT
"""


class HuggingFaceError(Exception):
    def __init__(self, message, code="huggingface_error", status=502):
        super().__init__(message)
        self.code = code
        self.status = status


# Tried in order when the configured model is unsupported or retired.
FALLBACK_MODELS = (
    "Qwen/Qwen2.5-VL-72B-Instruct",
    "Qwen/Qwen3-VL-30B-A3B-Instruct",
    "Qwen/Qwen2.5-VL-7B-Instruct",
    "meta-llama/Llama-3.2-11B-Vision-Instruct",
)


def recognize_with_huggingface(image_bytes, mime_type="image/png", diagram_type="auto"):
    token = os.getenv("HUGGINGFACE_API_KEY")
    if not token:
        raise HuggingFaceError("HUGGINGFACE_API_KEY is not configured.", "missing_key", 503)

    prompt = STRICT_PROMPT.replace("DIAGRAM_TYPE_HINT", diagram_hint_block(diagram_type))
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"

    # Independent path from Gemini: Hugging Face router chat completions with a vision model.
    url = "https://router.huggingface.co/v1/chat/completions"
    configured = os.getenv("HUGGINGFACE_MODEL", "Qwen/Qwen2.5-VL-72B-Instruct")
    models = [configured] + [m for m in FALLBACK_MODELS if m != configured]
    last_response = None
    for model in models:
        payload = {
            "model": model,
            "temperature": 0.1,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        }
        try:
            response = requests.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
                timeout=90,
            )
        except requests.RequestException:
            continue
        last_response = response

        if response.status_code in (400, 402, 404, 422, 429) or response.status_code >= 500:
            continue
        return _parse_huggingface(response)

    if last_response is not None:
        if last_response.status_code == 402:
            raise HuggingFaceError("Hugging Face API returned 402 (account credits exhausted).", "credits_exhausted", 402)
        if last_response.status_code == 429:
            raise HuggingFaceError("Hugging Face rate limit reached.", "rate_limit", 429)
        raise HuggingFaceError(
            f"Hugging Face API failure ({last_response.status_code}): no usable model.",
            "api_failure",
            502,
        )
    raise HuggingFaceError("Hugging Face returned no response.", "empty", 502)


def _parse_huggingface(response):
    try:
        body = response.json()
    except ValueError as exc:
        raise HuggingFaceError("Hugging Face returned a non-JSON body.", "invalid_json", 502) from exc
    try:
        text = body["choices"][0]["message"]["content"]
        if isinstance(text, list):
            text = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in text)
    except (KeyError, IndexError, TypeError) as exc:
        raise HuggingFaceError("Empty recognition response from Hugging Face.", "empty", 502) from exc

    try:
        parsed = extract_json(text)
    except ValueError as exc:
        raise HuggingFaceError(str(exc), "invalid_json", 502) from exc
    if not isinstance(parsed, dict):
        raise HuggingFaceError("Hugging Face JSON was not an object.", "invalid_json", 502)
    return parsed
