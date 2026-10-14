# SketchCanvas

AI-assisted software engineering diagram editor. Upload a photograph of a flowchart, UML class diagram, ER diagram, or DFD. Gemini and Groq recognize the drawing independently; a reconciliation engine merges them into canonical JSON; React Flow renders an editable diagram. Manual edits and the rule-based chatbot share one command layer and undo history.

## Run locally

Create `.env` from `.env.example` and set your keys (never commit them):

```
GEMINI_API_KEY=...
GROQ_API_KEY=...
GROQ_VISION_MODEL=qwen/qwen3.8-27b
```

Backend (Flask, port 5000):

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Frontend (Vite dev server, proxies `/api` to `http://127.0.0.1:5000`):

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

The canvas editor, shape library, properties, chatbot, undo/redo, and JSON import/export work without API keys. Image recognition requires at least one of Gemini or Groq; if one service fails, the other is still used, and only when both fail does the upload report an error.

### Tests

```bash
cd backend
python -m pytest tests/ -q

cd ../frontend
npm run check:anchors   # edge anchor planning
```

73 tests cover the chatbot parser, reconciliation engine, normalizer/schema, family vocabulary enforcement, UML compartments, ER entity rendering, SVG export, the GroqCloud adapter (model resolution/substitution, image adaptation, error mapping for auth, quota, rate limit, timeout, invalid JSON, and retired models — all with a fake client, no network), and the REST routes (including failure paths with missing keys, invalid images, and a stubbed Groq source carrying a diagram through reconciliation).

## Architecture

```
Recognition (Gemini ∥ Groq, independent)
        ↓
 Canonical JSON  (single source of truth)
        ↓
 Canvas adapter
        ↓
 React Flow

Chatbot / mouse / properties panel
        ↓
 Command object  (ADD_NODE, CONNECT, …)
        ↓
 Command executor
        ↓
 Canvas state + shared undo history
```

- **Recognition services** (`backend/recognition/`) each run in their own thread, never overwrite each other, and fall back through a chain of current vision models automatically if a configured model is retired.
- **GroqCloud** (`backend/recognition/groq_service.py`) is the second source, called through the official `groq` SDK with the image sent as a base64 data URL and JSON mode requested. Groq-specific behaviour is contained here: the provider's response is adapted to the same payload shape Gemini returns, so the normalizer, reconciliation engine and canvas need no provider knowledge. Images under 32×32 px and models that reject image input are reported as input errors, never retried as if they were transient.
- **Model resolution and preflight.** `GROQ_VISION_MODEL` is checked against the models the account can actually call; if it has been retired (as Groq retired the Llama 4 vision models) the next configured model is used and the substitution is logged and reported. `GET /api/health` returns the resolved model without a network call, and `GET /api/health?probe=1` sends one small image to prove the model accepts image input and returns JSON before you upload anything. Rate limits and billing errors are surfaced as-is, never retried in a loop.
- **Reconciliation engine** (`backend/recognition/reconciliation_engine.py`) normalizes both payloads, matches nodes by label/type/bbox overlap, combines agreeing confidences (weighted, agreement-boosted), resolves disagreements deterministically via a swappable `WeightStrategy`, and records per-item `sources` and disagreements.
- **Canonical schema** (`backend/diagram/schema.py`, `frontend/src/schema/canonical.js`) is validated before rendering; every node and edge carries position, size, style, confidence, and source list.
- **Command layer** (`frontend/src/canvas/commands/`) is the only way canvas state changes — from mouse drags, the properties panel, or chatbot text alike — so undo/redo works uniformly.
- **Chatbot** (`frontend/src/components/Chatbot/parser.js`, mirrored in `backend/chatbot/`) is purely rule-based: regex + keyword matching, no LLM.

## Export

Use **Export** for PNG, SVG, or JSON of the live canvas (not the original photo). SVG is rendered server-side from the canonical JSON by `backend/export/svg_export.py` (`POST /api/export/svg`), with an html-to-image fallback when the backend is offline. **Save** writes the canonical JSON document; **Open** loads it back.

## Notation rules

- The upload modal requires an explicit diagram type (Flowchart / ER / UML Class / DFD) — no "detect automatically". The choice is sent with the request and is authoritative: it decides the vocabulary of the returned nodes and overrides any model misread.
- **ER entities are a single rectangle holding only the entity name.** Attributes are separate ovals wired to their owner; if a model returns attributes inside the entity's `attributes` array, they are converted into real attribute nodes and connected automatically.
- **UML classes always render three compartments: name, attributes, methods.** Class names found with members crammed into the label (newlines or pipes) are split into the right compartments, and both services' members are merged so neither source's methods are lost.
- The canvas enforces the same family vocabulary everywhere — shape library, properties dropdown, chatbot commands, and type switching.

## Editing

- Shapes size themselves to the text they hold. Recognition boxes arrive sized from the photograph, so every node is refitted on load; editing a label, attribute or method refits that shape too. Resize a node by hand and your size wins until you ask for a refit again.
- **Fit text** in the toolbar (or *Fit shapes to text* in the canvas context menu) resizes the selection — or every shape when nothing is selected — to its text in a single undoable step.
- Drag shapes from the left library; connect by dragging between any anchor; reconnect by dragging an edge endpoint (one undo step).
- Arrows spread themselves over a shape's four sides. Each side carries one arrow; a side only takes a second arrow once all four sides are used, and then the arrows sit at separate slots along that side. Anchor planning (`frontend/src/canvas/handles.js`) runs per diagram, so the layout follows the arrows actually meeting each shape.
- Connections are made in React Flow's loose mode: every anchor can start or receive an arrow, which lets one arrow per side enter and leave through the same points.
- Double-click a node to edit its text inline.
- Multi-select with Shift or right-drag; pan with middle/right drag; Delete/Ctrl+Z/Ctrl+Y/Ctrl+C/V/X shortcuts.
- Properties panel edits text, geometry, colors, fonts, opacity, attributes, and methods; recognized items show their confidence and sources.
- Chatbot examples: `Add Student entity`, `Add Name attribute to Student`, `Connect Student to Course`, `Move Student left`, `Change Student color to red`, `Delete the diamond`, `Rename Student to Customer`, `Undo`.
