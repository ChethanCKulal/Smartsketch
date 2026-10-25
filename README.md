# SketchCanvas

AI-assisted software engineering diagram editor. Upload a photograph of a flowchart, UML class diagram, ER diagram, or DFD. Gemini and Groq recognize the drawing independently; a reconciliation engine merges them into canonical JSON; React Flow renders an editable diagram. A flowchart you select explicitly is read instead by the project's own trained YOLO11n detector, with Groq supplying the labels and relationships. Manual edits and the rule-based chatbot share one command layer and undo history.

##Environment setup
.\.venv312\Scripts\Activate.ps1    

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

Flowchart recognition also needs the trained detector (CUDA PyTorch + Ultralytics + `best.pt`) — see [Flowchart detection](#flowchart-detection). Everything else, including the other diagram families, runs without it.

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
npm run check           # anchors, shape geometry, document model + XML import
npm run check:anchors   # edge anchor planning only
npm run check:document  # pages, dirty state, save/reopen, draw.io conversion
```

158 tests cover the chatbot parser, reconciliation engine, normalizer/schema, layout, family vocabulary enforcement, UML compartments, ER entity rendering, SVG export, the GroqCloud adapter (model resolution/substitution, image adaptation, error mapping for auth, quota, rate limit, timeout, invalid JSON, and retired models — all with a fake client, no network), and the REST routes (including failure paths with missing keys, invalid images, and a stubbed Groq source carrying a diagram through reconciliation).

69 of them belong to the trained flowchart path, and none of those needs a GPU, the real weights, or the network — Ultralytics is replaced through one loader seam. They cover the checkpoint's own class-name mapping, `data` → `io`, arrows and arrowheads staying out of the node set, box and confidence preservation, the flat and column tensor shapes real results hand over, lazy load-and-reuse, missing weights or a missing Ultralytics install, every coordinate space a vision payload can arrive in, ambiguous label matches, relationships resolved by id and by label (and dropped when they point at a symbol that does not exist), connector-derived connections and their direction, the text-source failure path, and the routing rules that keep auto-detection, ER, UML and DFD on the vision pipeline.

## Flowchart detection

An explicit **Flowchart** selection in the upload modal is served by the trained YOLO11n model instead of the two vision services: the six shape classes it knows are flowchart notation, so they must never decide which family an upload belongs to. Auto-detection and every other diagram type keep the existing Gemini ∥ Groq pipeline, and the API contract is unchanged.

- **Model.** `backend/models/flowchart/best.pt`, overridable with `SMARTSKETCH_YOLO_MODEL` (a relative path resolves against `backend/`, never against the working directory). Class names are read from the checkpoint rather than from a hardcoded id table, so re-training cannot silently shift the interpretation. Held-out results on the training dataset — P 94.5%, R 94.4%, mAP50 96.0%, mAP50-95 77.9% — are dataset numbers, not a promise about an arbitrary photo.
- **Symbols** come from the detector: `process`, `decision`, `terminator`, and `data` (SmartSketch's `io`), with boxes in the image's own pixels and the model's confidence preserved. Arrows and arrowheads are never emitted as process nodes.
- **Text and relationships** come from the existing Groq vision service, associated with the detected symbols by box overlap and centre distance in the drawing's own normalised frame — the sources do not share a coordinate space, so nothing is matched in raw pixels. A label that fits two symbols about equally well is left off and reported instead.
- **Connections from drawn arrows.** An arrow whose box reaches exactly two detected symbols links them, and an arrowhead at one end gives the direction. An arrowhead alone never creates an edge, a connector reaching more than two symbols is skipped with a warning, and an arrow with no arrowhead is drawn undirected rather than guessed.
- **Honest failure.** If Groq fails, the detected shapes still come back with clearly marked placeholder names (`Process 1`, …), `partial: true`, and a message saying so — never invented handwriting. If the detector cannot run at all (weights missing, Ultralytics absent) or finds no symbols, the upload falls back to the vision pipeline and says why in `reconciliation.warnings`. `SMARTSKETCH_YOLO_ENABLED=false` takes the model off the path entirely.
- **Tuning.** `SMARTSKETCH_YOLO_CONF` (0.25), `SMARTSKETCH_YOLO_IMGSZ` (640), and `SMARTSKETCH_YOLO_DEVICE` (`auto` = CUDA when usable, otherwise CPU). `GET /api/health` reports the detector's readiness without loading it.
- **Text budget.** The flowchart text request asks only for the labels and the relationships — the shape classes, boxes and confidences already come from the detector — and is bounded by `GROQ_FLOWCHART_MAX_TOKENS` (1024). Groq's on-demand tier measures a request's *expected* output against its output-tokens-per-minute ceiling (1000/min today) and refuses any request that exceeds it, so asking for a full node record per symbol can fail before the request ever runs. On that tier one flowchart upload per minute succeeds; a second upload in the same window returns the detected shapes with placeholder names and the wait Groq asked for, in `sources.groq.error`. An answer clipped at the output limit keeps every label the model did read and says so in `reconciliation.warnings`.

Install it into the backend environment (PowerShell, from the repository root). Put the CUDA build in **first**, so pip cannot substitute the CPU-only wheel:

```powershell
C:\smartsketch\.venv312\Scripts\python.exe -m pip install --index-url https://download.pytorch.org/whl/cu128 torch==2.11.0 torchvision==0.26.0
C:\smartsketch\.venv312\Scripts\python.exe -m pip install -r C:\smartsketch\backend\requirements.txt
Copy-Item "C:\smartsketch-2\runs\flowchart\yolo11n_v1\weights\best.pt" "C:\smartsketch\backend\models\flowchart\best.pt"
```

On a machine without a usable GPU, skip the first line and let `ultralytics` install torch from PyPI: inference still works, it is just slower.

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
- **Flowchart detector** (`backend/recognition/yolo_service.py`, `flowchart_fusion.py`) is the third path, used only when a flowchart is selected explicitly. The model is loaded once and reused, inference is CPU-capable, and the six trained classes map onto the flowchart vocabulary by class *name*. The fusion step is separate from the reconciliation engine on purpose: there, two peer vision services are matched against each other, while here the detector is authoritative about class and geometry and Groq only supplies text and candidate relationships.
- **Reconciliation engine** (`backend/recognition/reconciliation_engine.py`) normalizes both payloads, matches nodes by label/type/bbox overlap, combines agreeing confidences (weighted, agreement-boosted), resolves disagreements deterministically via a swappable `WeightStrategy`, and records per-item `sources` and disagreements.
- **Canonical schema** (`backend/diagram/schema.py`, `frontend/src/schema/canonical.js`) is validated before rendering; every node and edge carries position, size, style, confidence, and source list.
- **Command layer** (`frontend/src/canvas/commands/`) is the only way canvas state changes — from mouse drags, the properties panel, or chatbot text alike — so undo/redo works uniformly.
- **Chatbot** (`frontend/src/components/Chatbot/parser.js`, mirrored in `backend/chatbot/`) is purely rule-based: regex + keyword matching, no LLM.

## Pages and documents

A document is an ordered list of pages, each with its own diagram (nodes, connectors, groups, styles, positions) and its own undo/redo stack. The page strip under the canvas switches pages, adds one, and — through its ⋮ menu — renames, duplicates, reorders, and deletes. Double-click a tab to rename it, and a document always keeps at least one page.

`Save` / `Open` write the whole document as version 2 JSON:

```json
{ "version": 2, "name": "Untitled Document", "activePageId": "page_…",
  "pages": [{ "id": "page_…", "name": "Page 1", "diagram": { "version": 1, "diagram_type": "flowchart", "nodes": [], "edges": [], "groups": [], "meta": {} } }] }
```

Version 1 single-diagram files still open as a one-page document, and the per-page `diagram` keeps the original canonical shape, so existing export and recognition payloads are unchanged. **Export → PNG / SVG** renders the current page; **Export → JSON** saves every page.

Unsaved changes are detected by comparing the serialized document with the last saved one, so undoing back to the saved state makes the document clean again and selecting, zooming or switching pages never does. New asks Save / Don't Save / Cancel only when the document is dirty; Save creates the new document only after the download succeeded, and the same dirty state drives the single `beforeunload` warning.

## Pasting draw.io XML

Copy diagram XML from draw.io / diagrams.net and paste it onto the canvas (not into a text field). Supported inputs are an `<mxfile>` document — with several pages, and with compressed pages inflated through the browser's `DecompressionStream` — a bare `<mxGraphModel>`, and an `<mxGraphModel>` nested in a wrapper. A confirmation dialog states what was recognised, lets you pick the target diagram family, and for multi-page files asks whether to add every page as new pages or import one page into the current one.

Shapes map onto the active family's existing vocabulary (`rhombus` → decision/diamond, `cylinder3` → database, `note` → sticky note, …), keeping text, geometry, fill, border, width, dashes, font size/weight, label colour, connector routing, arrowheads and edge labels. The XML is read with `DOMParser` only: no scripts run, nothing is fetched, rich-text labels are reduced to text, ids are made unique, and connectors whose endpoints did not import are dropped with a warning. An import into the current page is a single undo step; malformed or unsupported XML leaves the open diagram untouched.

Not converted: draw.io images/icons, swimlane lane structure (the lane container becomes a plain box), custom stencils, waypoint-level edge geometry, and page-level canvas settings such as grid size.

## Export

Use **Export** for PNG, SVG, or JSON of the live canvas (not the original photo). SVG is rendered server-side from the canonical JSON by `backend/export/svg_export.py` (`POST /api/export/svg`), with an html-to-image fallback when the backend is offline. **Save** writes the whole document; **Open** loads it back.

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
