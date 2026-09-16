import { toPng, toSvg } from "html-to-image";
import { useDiagramStore } from "../../state/diagramStore";

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function currentDiagram() {
  return useDiagramStore.getState().diagram;
}

export async function exportPng() {
  const el = document.querySelector(".react-flow__viewport");
  if (!el) throw new Error("Canvas not ready.");
  const dataUrl = await toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 });
  const res = await fetch(dataUrl);
  download("sketchcanvas.png", await res.blob());
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
    download("sketchcanvas.svg", await res.blob());
    return "server";
  } catch {
    const el = document.querySelector(".react-flow__viewport");
    if (!el) throw new Error("Canvas not ready.");
    const dataUrl = await toSvg(el, { backgroundColor: "#ffffff" });
    const res = await fetch(dataUrl);
    download("sketchcanvas.svg", await res.blob());
    return "client";
  }
}

export function exportJson() {
  const diagram = currentDiagram();
  const blob = new Blob([JSON.stringify(diagram, null, 2)], { type: "application/json" });
  download(`${diagram.meta?.name || "sketchcanvas"}.json`, blob);
}

export function openJsonFile(file) {
  return file.text().then((text) => JSON.parse(text));
}
