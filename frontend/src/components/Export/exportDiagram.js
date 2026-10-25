import { toPng, toSvg } from "html-to-image";
import { useDiagramStore } from "../../state/diagramStore";
import { download, downloadJson, safeFileName } from "../../utils/download";

function currentDiagram() {
  return useDiagramStore.getState().diagram;
}

export async function exportPng() {
  const el = document.querySelector(".react-flow__viewport");
  if (!el) throw new Error("Canvas not ready.");
  const dataUrl = await toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 });
  const res = await fetch(dataUrl);
  download(`${safeFileName(currentDiagram().meta?.name || "sketchcanvas")}.png`, await res.blob());
}

/**
 * Prefer the deterministic backend SVG renderer (same canonical JSON the canvas
 * uses). If the backend is offline, fall back to rasterizing the live DOM.
 */
export async function exportSvg() {
  const diagram = currentDiagram();
  try {
    const res = await fetch("/api/export/svg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagram }),
    });
    if (!res.ok) throw new Error(`Backend export failed (${res.status})`);
    download(`${safeFileName(diagram.meta?.name || "sketchcanvas")}.svg`, await res.blob());
    return "server";
  } catch {
    const el = document.querySelector(".react-flow__viewport");
    if (!el) throw new Error("Canvas not ready.");
    const dataUrl = await toSvg(el, { backgroundColor: "#ffffff" });
    const res = await fetch(dataUrl);
    download(`${safeFileName(diagram.meta?.name || "sketchcanvas")}.svg`, await res.blob());
    return "client";
  }
}

/** Write a whole document (every page) to disk. Throws if the browser refuses. */
export function writeDocumentFile(payload, name) {
  downloadJson(`${safeFileName(name, "sketchcanvas")}.json`, payload);
}

export function openJsonFile(file) {
  return file.text().then((text) => JSON.parse(text));
}
