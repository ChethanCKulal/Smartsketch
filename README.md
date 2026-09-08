# SketchCanvas

AI-assisted software engineering diagram editor. Upload a photograph of a flowchart, UML class diagram, ER diagram, or DFD. Gemini and Hugging Face recognize the drawing independently; a reconciliation engine merges them into canonical JSON; React Flow renders an editable diagram. Manual edits and the rule-based chatbot share one command layer and undo history.

## Run locally

Create `c:\smartsketch\.env` from `.env.example` and set keys (never commit them):

```
GEMINI_API_KEY=...
HUGGINGFACE_API_KEY=...
```

Backend:

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Frontend (proxies `/api` to `http://127.0.0.1:5000`):

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

The canvas editor, shape library, properties, chatbot, undo/redo, and JSON import/export work without API keys. Image recognition requires at least one of Gemini or Hugging Face. If one service fails, the other is still used.

## Architecture

```
Recognition (Gemini ∥ Hugging Face)
        ↓
 Canonical JSON
        ↓
 Canvas adapter
        ↓
 React Flow

Chatbot / mouse
        ↓
 Command object
        ↓
 Command executor
        ↓
 Canvas state + history
```

## Export

Use **Export** for PNG, SVG, or JSON of the live canvas (not the original photo). **Save** writes the canonical JSON document.
