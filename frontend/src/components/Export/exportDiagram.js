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

export async function exportPng() {
  const el = document.querySelector(".react-flow__viewport");
  if (!el) throw new Error("Canvas not ready.");
  const dataUrl = await toPng(el, { backgroundColor: "#101722", pixelRatio: 2 });
  const res = await fetch(dataUrl);
  download("sketchcanvas.png", await res.blob());
}

export async function exportSvg() {
  const el = document.querySelector(".react-flow__viewport");
  if (!el) throw new Error("Canvas not ready.");
  const dataUrl = await toSvg(el, { backgroundColor: "#101722" });
  const res = await fetch(dataUrl);
  download("sketchcanvas.svg", await res.blob());
}

export function exportJson() {
  const diagram = useDiagramStore.getState().diagram;
  const blob = new Blob([JSON.stringify(diagram, null, 2)], { type: "application/json" });
  download(`${diagram.meta?.name || "sketchcanvas"}.json`, blob);
}

export function openJsonFile(file) {
  return file.text().then((text) => JSON.parse(text));
}
