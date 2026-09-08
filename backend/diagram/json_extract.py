import json
import re


def extract_json(text):
    """Reject unstructured prose by extracting the first JSON object/array."""
    if text is None:
        raise ValueError("Empty recognition response.")
    if isinstance(text, (dict, list)):
        return text
    raw = str(text).strip()
    if not raw:
        raise ValueError("Empty recognition response.")
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    if fenced:
        raw = fenced.group(1).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start_obj = raw.find("{")
        start_arr = raw.find("[")
        starts = [i for i in (start_obj, start_arr) if i >= 0]
        if not starts:
            raise ValueError("Recognition output was not valid JSON.")
        start = min(starts)
        candidate = raw[start:]
        decoder = json.JSONDecoder()
        try:
            parsed, _ = decoder.raw_decode(candidate)
            return parsed
        except json.JSONDecodeError as exc:
            raise ValueError("Recognition output was not valid JSON.") from exc
