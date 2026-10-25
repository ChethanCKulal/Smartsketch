"""GroqCloud vision recognition — SmartSketch's second independent source.

Replaces the Hugging Face Inference Providers path (which answered with
``402 Payment Required``) with GroqCloud's OpenAI-compatible chat completions
API, using an image-capable chat model.

The service returns exactly the payload shape the Gemini service returns, so the
normalizer, reconciliation engine, canvas adapter and frontend stay untouched —
Groq's response is adapted here, in the backend, not downstream.

Two Groq-specific facts drive the implementation (both verified against the live
API):

* A text-only Groq model rejects an image part with ``400`` ("messages[0].content
  must be a string"), and a retired model answers ``404``. Neither is assumed to
  be usable: capability is checked before a model is used.
* Groq rejects images smaller than 32 px on a side, so that is reported as a
  clear input error instead of surfacing as a provider 400.

Model selection is configuration-driven (``GROQ_VISION_MODEL``) but verified
against the account's live model list, with a fallback chain, so a retired model
name degrades to a working one instead of failing every upload.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import re
import threading
import time

from PIL import Image
from groq import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    Groq,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
)

from diagram.json_extract import extract_json
from recognition.prompts import diagram_hint_block

logger = logging.getLogger(__name__)

SOURCE_NAME = "groq"

# Same recognition prompt the Hugging Face path used, unchanged, so the diagram
# requirements (compartments, ER attributes, DFD notation) stay identical.
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

# The flowchart path asks for far less than the other families, and it has to.
#
# Its symbol classes, boxes and confidence values come from the trained detector,
# so the text source is only asked for the words and the relationships — nothing
# the detector already knows, and nothing the fusion does not read back. That is
# not just tidiness: a request's *expected* output counts against the account's
# output-tokens-per-minute budget, and Groq rejects a request whose expectation
# exceeds the whole per-minute allowance outright ("Request too large for model
# ... reduce max_tokens"), which no amount of waiting can cure. A full node record
# per symbol — type, confidence, attributes, methods, ids — pushes a dense drawing
# over that line, and the upload then loses every label it could have had.
FLOWCHART_PROMPT = """Read this hand-drawn flowchart photograph and transcribe it.
Return STRICT JSON only, no markdown, in exactly this shape:
{
  "nodes": [{"id": "n1", "label": "<the text written inside one symbol>", "bbox": [x1, y1, x2, y2]}],
  "edges": [{"source": "<id of the symbol the arrow leaves>", "target": "<id of the symbol the arrow reaches>", "label": "<text written on the arrow, else empty>", "arrow": "forward|backward|both|none"}]
}
One node entry per drawn symbol, whatever shape it is. bbox is that symbol's box in the image's own pixels.
Do not output shape types, confidence values, attributes, methods or anything else.
A symbol or an arrow you cannot read must be left out rather than invented.
DIAGRAM_TYPE_HINT
"""

# Model used when GROQ_VISION_MODEL is unset. Verified image-capable on Groq
# (supersedes meta-llama/llama-4-*, which Groq retired); it was read from
# configuration rather than hardcoded into a request, so it can be changed
# without touching application code.
DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b"

# Tried in order when the configured model is retired or does not accept images.
# Only image-capable models belong here: Groq's text-only models (gpt-oss,
# allam) reject image content parts outright.
FALLBACK_VISION_MODELS = ("qwen/qwen3.8-27b",)

# Groq rejects images smaller than this on either side.
MIN_SIDE_PX = 32

REQUEST_TIMEOUT = float(os.getenv("GROQ_TIMEOUT_SECONDS", "90"))

# Output budget per request. The generic request needs room for a whole diagram
# description; the flowchart request needs room for one short record per symbol,
# and is deliberately kept below the output-tokens-per-minute ceiling a free
# Groq account enforces (1000/min today), because a request that expects more than
# that is refused before it is ever run. Overridable for accounts with more room:
# a dense drawing needs a bigger budget to be transcribed in full.
DEFAULT_MAX_TOKENS = 8192
DEFAULT_FLOWCHART_MAX_TOKENS = 1024
MIN_MAX_TOKENS = 64
# How long a model listing / capability verdict is trusted before re-checking.
MODEL_CACHE_TTL = float(os.getenv("GROQ_MODEL_CACHE_TTL", "600"))

# A 48x48 black-on-white rectangle, inlined so preflight can prove the model
# accepts image input without shipping a fixture file.
PROBE_IMAGE_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwAQAAAAB/ecQqAAAAIklEQVR42mP8z8DAwMDAxECQYvjDwMDAYE+EyuFHMRId"
    "SgAb2wOW9UU00AAAAABJRU5ErkJggg=="
)
PROBE_PROMPT = (
    "This is a capability check. Reply with STRICT JSON only, no prose: "
    '{"accepted": true} if you received an image along with this text.'
)
PROBE_MAX_TOKENS = 32


# Provider messages are surfaced to the client, so credential-shaped and
# account-identifying tokens are stripped before anything is logged or returned.
_REDACT = re.compile(r"(gsk_[A-Za-z0-9_\-]+|org_[A-Za-z0-9]+)")


def _redact(text):
    return _REDACT.sub("<redacted>", str(text or ""))


class GroqRecognitionError(Exception):
    """Recognition failure with a machine-readable code and an HTTP-ish status."""

    def __init__(self, message, code="groq_error", status=502):
        super().__init__(message)
        self.code = code
        self.status = status


_cache_lock = threading.Lock()
_model_list_cache = {"at": 0.0, "ids": None}
_model_verdicts = {}  # model id -> (timestamp, accepts_images)


def configured_models():
    """Candidate model ids: GROQ_VISION_MODEL, then GROQ_VISION_MODELS, then defaults."""
    raw = [os.getenv("GROQ_VISION_MODEL")]
    raw.extend((os.getenv("GROQ_VISION_MODELS") or "").split(","))
    raw.extend(FALLBACK_VISION_MODELS)
    ordered = []
    for value in raw:
        name = str(value or "").strip()
        if name and name not in ordered:
            ordered.append(name)
    return ordered


def _api_key():
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise GroqRecognitionError("GROQ_API_KEY is not configured.", "missing_key", 503)
    return key


def _int_env(name, fallback):
    try:
        return int(str(os.getenv(name, "")).strip() or fallback)
    except (TypeError, ValueError):
        return fallback


def is_flowchart(diagram_type):
    return str(diagram_type or "").strip().lower() == "flowchart"


def prompt_for(diagram_type):
    """The prompt this request should send: minimal for a flowchart (see above)."""
    return FLOWCHART_PROMPT if is_flowchart(diagram_type) else STRICT_PROMPT


def output_budget(diagram_type):
    """max_tokens for this request.

    Only the flowchart request is bounded to fit the account's per-minute output
    ceiling; the other families keep the larger budget their compartment payloads
    need, so ER, UML and DFD behaviour is unchanged.
    """
    if is_flowchart(diagram_type):
        return max(MIN_MAX_TOKENS, _int_env("GROQ_FLOWCHART_MAX_TOKENS", DEFAULT_FLOWCHART_MAX_TOKENS))
    return max(MIN_MAX_TOKENS, _int_env("GROQ_MAX_TOKENS", DEFAULT_MAX_TOKENS))


def _client(api_key=None):
    # max_retries=0: retries are decided here (billing and rate limits are never
    # retried), so a failure is reported to the user instead of being hidden.
    return Groq(api_key=api_key or _api_key(), timeout=REQUEST_TIMEOUT, max_retries=0)


def account_model_ids(client=None, refresh=False):
    """Model ids the account can currently call, or None when listing failed."""
    now = time.time()
    with _cache_lock:
        if not refresh and _model_list_cache["ids"] and now - _model_list_cache["at"] < MODEL_CACHE_TTL:
            return _model_list_cache["ids"]
    try:
        ids = {m.id for m in (client or _client()).models.list().data}
    except Exception as exc:  # listing is advisory; the recognition call still validates
        logger.warning("Groq model listing failed (%s).", type(exc).__name__)
        return None
    with _cache_lock:
        _model_list_cache["ids"] = ids
        _model_list_cache["at"] = now
    return ids


def mark_model_usable(model, usable):
    """Record a live verdict so a rejected model is skipped for the cache window."""
    with _cache_lock:
        _model_verdicts[model] = (time.time(), bool(usable))


def _known_usable(model):
    with _cache_lock:
        entry = _model_verdicts.get(model)
    if not entry:
        return None
    at, usable = entry
    if time.time() - at > MODEL_CACHE_TTL:
        return None
    return usable


def vision_candidates(refresh=False, client=None):
    """Ordered model ids worth calling, with a human-readable note.

    A model is worth calling when the account still offers it (when the listing
    is available) and it has not been proven to reject images.
    """
    chain = configured_models()
    ids = account_model_ids(client=client, refresh=refresh)
    if ids is not None:
        available = [m for m in chain if m in ids]
        if not available:
            return [], "none of the configured models are available on this account"
        chain = available
    usable = [m for m in chain if _known_usable(m) is not False]
    if not usable:
        return [], "every configured model rejected image input"
    note = None
    if usable[0] != configured_models()[0]:
        note = (
            f"configured model '{configured_models()[0]}' is not usable on this account; "
            f"using '{usable[0]}'"
        )
    return usable, note


def resolve_vision_model(refresh=False, client=None):
    """Report which vision model the next recognition call will use.

    Never raises: this backs the health/preflight surface, so an unreachable or
    unconfigured provider is reported as data, not as an exception.
    """
    report = {
        "configured": os.getenv("GROQ_VISION_MODEL") or DEFAULT_VISION_MODEL,
        "model": None,
        "available": False,
        "reason": None,
        "checked_at": None,
    }
    if not os.getenv("GROQ_API_KEY"):
        report["reason"] = "GROQ_API_KEY is not configured."
        return report
    try:
        candidates, note = vision_candidates(refresh=refresh, client=client)
    except Exception as exc:
        report["reason"] = f"Groq model check failed: {type(exc).__name__}"
        return report
    report["checked_at"] = time.time()
    report["reason"] = note
    if candidates:
        report["model"] = candidates[0]
        report["available"] = True
    else:
        report["reason"] = note or "No image-capable Groq model is available."
    return report


def probe_vision_support(refresh=False, client=None):
    """Live preflight: confirm the resolved model exists and accepts an image.

    This costs one small request, so it is only run when explicitly asked for
    (``GET /api/health?probe=1``) — never on the recognition path.
    """
    resolution = resolve_vision_model(refresh=refresh, client=client)
    report = {
        "ok": False,
        "model": resolution.get("model"),
        "reason": resolution.get("reason"),
        "answer": None,
        "checked_at": time.time(),
    }
    if not resolution.get("available"):
        return report
    try:
        completion = (client or _client()).chat.completions.create(
            model=resolution["model"],
            temperature=0,
            max_tokens=PROBE_MAX_TOKENS,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROBE_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{PROBE_IMAGE_B64}"},
                        },
                    ],
                }
            ],
        )
        answer = _completion_text(completion)
        extract_json(answer)
    except GroqRecognitionError as exc:
        report["reason"] = str(exc)
        return report
    except Exception as exc:
        error, _ = classify_error(exc, resolution["model"])
        report["reason"] = str(error)
        return report
    report["ok"] = True
    report["answer"] = answer
    report["reason"] = "model accepted an image and returned JSON"
    mark_model_usable(resolution["model"], True)
    return report


def recognize_with_groq(image_bytes, mime_type="image/png", diagram_type="auto"):
    """Recognize a diagram photograph and return the internal payload shape.

    Raises GroqRecognitionError with a specific code for every failure class the
    caller must distinguish (missing key, auth, quota, rate limit, network,
    invalid image, invalid JSON). A successful-but-empty diagram is returned as
    an empty payload: reconciliation already reports it as "returned no nodes"
    rather than inventing results.
    """
    api_key = _api_key()
    _check_min_side(image_bytes)

    prompt = prompt_for(diagram_type).replace("DIAGRAM_TYPE_HINT", diagram_hint_block(diagram_type))
    budget = output_budget(diagram_type)
    data_url = f"data:{mime_type or 'image/png'};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    client = _client(api_key)

    candidates, note = vision_candidates(client=client)
    if not candidates:
        raise GroqRecognitionError(
            "No image-capable Groq model is available for this account. "
            "Set GROQ_VISION_MODEL to a supported vision model.",
            "no_vision_model",
            503,
        )
    if note:
        logger.warning("Groq vision model substitution: %s", note)

    last_detail = ""
    for model in candidates:
        try:
            completion = client.chat.completions.create(
                model=model,
                temperature=0.1,
                max_tokens=budget,
                response_format={"type": "json_object"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    }
                ],
            )
        except Exception as exc:
            error, try_next = classify_error(exc, model)
            if try_next:
                last_detail = str(error)
                logger.warning("Groq model '%s' unusable, trying next: %s", model, error)
                continue
            raise error

        payload = _parse_completion(completion)
        mark_model_usable(model, True)
        note = _truncation_note(completion, budget)
        if note:
            # The labels it did emit are real readings, so they are kept and the
            # shortfall is reported; throwing the whole answer away would cost the
            # user text that was read correctly.
            payload["text_note"] = note
            logger.warning("Groq stopped at its output limit: %s", note)
        logger.info("Groq vision model '%s' recognized a %s diagram", model, diagram_type)
        return _adapt_payload(payload)

    raise GroqRecognitionError(
        "No usable Groq vision model answered. Last provider message: "
        f"{last_detail or 'unknown'}",
        "api_failure",
        502,
    )


def _truncation_note(completion, budget):
    """A note when the model ran out of output budget mid-answer, else None.

    `finish_reason` used to be ignored, so a drawing the model could only partly
    describe came back looking complete: the shapes it never reached kept their
    placeholder names with nothing saying why.
    """
    try:
        choice = completion.choices[0]
    except (AttributeError, IndexError, TypeError):
        return None
    if getattr(choice, "finish_reason", None) != "length":
        return None
    return (
        f"The text model reached its {budget}-token output limit before it finished, so "
        "some shapes in this drawing keep a placeholder name. Raise "
        "GROQ_FLOWCHART_MAX_TOKENS if this account's plan allows a larger answer."
    )


def _retry_after(exc):
    """Seconds the provider asks us to wait, when it says so."""
    headers = getattr(getattr(exc, "response", None), "headers", None)
    if not headers:
        return None
    try:
        raw = headers.get("retry-after")
    except AttributeError:
        return None
    if not raw:
        return None
    try:
        return int(float(str(raw).strip()))
    except ValueError:
        return None


def _rate_limit_failure(exc, message):
    """Groq answers 429 for two different problems, and they need different advice.

    One is the per-minute window being spent — waiting fixes it. The other is a
    single request whose *expected* output exceeds the window's entire budget
    ("Request too large ... reduce max_tokens"); waiting never fixes that, the
    request has to be made smaller. Until now both arrived as the same generic
    sentence, and the route logged neither, so a fixable request problem looked
    like an unlucky moment.
    """
    wait = _retry_after(exc)
    when = f" Wait about {wait}s and try again." if wait else ""
    if "request too large" in message.lower():
        return (
            GroqRecognitionError(
                "Groq refused this request as too large for the account's output-token "
                f"limit; retrying it unchanged cannot help.{when} Provider message: {message[:220]}",
                "output_too_large",
                429,
            ),
            False,
        )
    return (
        GroqRecognitionError(
            "Groq rate limit reached: the account's per-minute window is spent, which says "
            f"nothing about the image.{when} Provider message: {message[:220]}",
            "rate_limit",
            429,
        ),
        False,
    )


def classify_error(exc, model):
    """Map a Groq SDK/transport failure to (GroqRecognitionError, try_next_model)."""
    message = _redact(str(exc).strip())
    status = getattr(exc, "status_code", None)

    if isinstance(exc, AuthenticationError):
        return GroqRecognitionError("Groq rejected the API key. Check GROQ_API_KEY.", "auth", 401), False
    if isinstance(exc, PermissionDeniedError):
        # Model-level restrictions (e.g. an Enterprise-only model) look like this,
        # so the next configured candidate is still worth trying.
        return (
            GroqRecognitionError(
                f"Groq denied access to model '{model}'. Check the key's model access.",
                "forbidden",
                403,
            ),
            True,
        )
    if isinstance(exc, RateLimitError):
        return _rate_limit_failure(exc, message)
    if status == 402:
        return (
            GroqRecognitionError(
                "Groq reports insufficient credits or an unpaid plan (402). Check billing before retrying.",
                "payment_required",
                402,
            ),
            False,
        )
    if isinstance(exc, (APITimeoutError, APIConnectionError)):
        return GroqRecognitionError(f"Groq network failure: {type(exc).__name__}.", "network", 503), False
    if isinstance(exc, NotFoundError):
        # Retired or not granted: not usable by this account.
        mark_model_usable(model, False)
        return GroqRecognitionError(f"Groq model '{model}' is not available.", "model_not_found", 404), True
    if isinstance(exc, BadRequestError):
        lower = message.lower()
        text_only = "must be a string" in lower
        no_vision = "image" in lower and "support" in lower
        if text_only or no_vision:
            # A text-only model refuses the image content part; never use it.
            mark_model_usable(model, False)
            return (
                GroqRecognitionError(
                    f"Groq model '{model}' does not accept image input.", "not_vision_capable", 400
                ),
                True,
            )
        if "failed to generate json" in lower:
            # Structured-output mode ran out of room to finish a valid object; the
            # model is usable, the answer just did not fit. Retrying the same model
            # would waste the window, so this is reported as it is.
            return (
                GroqRecognitionError(
                    "Groq could not produce valid JSON for this image, which usually means "
                    f"the answer was cut off before it was complete: {message[:200]}",
                    "invalid_json",
                    502,
                ),
                False,
            )
        if "at least 32 pixels" in lower:
            return (
                GroqRecognitionError(
                    "Groq requires images of at least 32x32 pixels.", "image_too_small", 400
                ),
                False,
            )
        if "image" in lower:
            return (
                GroqRecognitionError(
                    f"Groq rejected the image: {message[:200]}", "invalid_image", 400
                ),
                False,
            )
        return GroqRecognitionError(f"Groq rejected the request: {message[:200]}", "api_failure", 502), True
    if isinstance(exc, (InternalServerError, APIStatusError)):
        return GroqRecognitionError(f"Groq service failure ({status or 'unknown'}).", "api_failure", 502), False
    return GroqRecognitionError(f"Groq request failed: {type(exc).__name__}.", "api_failure", 502), False


def _completion_text(completion):
    try:
        text = completion.choices[0].message.content
    except (AttributeError, IndexError, TypeError) as exc:
        raise GroqRecognitionError("Empty recognition response from Groq.", "empty", 502) from exc
    if isinstance(text, list):  # parity with providers that return content parts
        text = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in text)
    return text


def _parse_completion(completion):
    text = _completion_text(completion)
    try:
        parsed = extract_json(text)
    except ValueError as exc:
        raise GroqRecognitionError(str(exc), "invalid_json", 502) from exc
    if not isinstance(parsed, dict):
        raise GroqRecognitionError("Groq JSON was not an object.", "invalid_json", 502)
    return parsed


def _adapt_payload(parsed):
    """Accept the top-level shapes Groq models actually emit.

    The prompt asks for ``nodes``/``edges``; some models answer an ER diagram
    with ``entities``/``relationships``. Only the naming is adapted — every
    field-level decision stays with the normalizer, which validates and maps the
    payload onto the internal schema.
    """
    if not isinstance(parsed.get("nodes"), list) and isinstance(parsed.get("entities"), list):
        parsed["nodes"] = parsed["entities"]
    return parsed


def _check_min_side(image_bytes):
    """Fail early and clearly on images Groq cannot accept."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
    except Exception:  # decoding is validated upstream; never block on this check
        return
    if min(width, height) < MIN_SIDE_PX:
        raise GroqRecognitionError(
            f"Groq requires images of at least {MIN_SIDE_PX}x{MIN_SIDE_PX} pixels "
            f"(this one is {width}x{height}).",
            "image_too_small",
            400,
        )
