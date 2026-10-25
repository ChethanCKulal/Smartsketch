/** Browser download helper shared by document save and the image exports. */

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Firefox only follows the click when the link is in the document.
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename, data) {
  download(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
}

/** Strip characters that browsers refuse in a download name. */
export function safeFileName(name, fallback = "sketchcanvas") {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}
