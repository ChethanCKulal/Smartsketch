const API = "/api";

async function parseJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Request failed (${res.status})`);
  }
}

export async function recognizeDiagram({ file, diagramType, autoDetect }) {
  const body = new FormData();
  body.append("image", file);
  body.append("diagram_type", diagramType || "auto");
  body.append("auto_detect", autoDetect ? "true" : "false");
  const res = await fetch(`${API}/recognize`, { method: "POST", body });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(data.error || data.message || "Recognition failed.");
  }
  return data;
}

export async function healthCheck() {
  try {
    const res = await fetch(`${API}/health`);
    return await parseJson(res);
  } catch {
    return { ok: false, error: "Backend unreachable" };
  }
}
