// Cliente HTTP mínimo hacia la API (/api), con token JWT en localStorage.
const TOKEN_KEY = "maestros_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function req(method: string, path: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = {};
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // 401 = "sesión expirada" SOLO si había un token (una sesión que venció) y no
  // es el propio login (ahí un 401 es "usuario/clave incorrectos": se deja pasar
  // al manejador de abajo para mostrar el mensaje real del backend).
  if (r.status === 401 && tok && !path.includes("/auth/login")) {
    clearToken();
    window.dispatchEvent(new Event("maestros:logout"));
    throw new Error("Sesión expirada");
  }
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* sin cuerpo JSON */
    }
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}

async function upload(path: string, file: File): Promise<any> {
  const headers: Record<string, string> = {};
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`/api${path}`, { method: "POST", headers, body: fd });
  if (r.status === 401 && tok) { clearToken(); window.dispatchEvent(new Event("maestros:logout")); throw new Error("Sesión expirada"); }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* */ }
    throw new Error(msg);
  }
  return r.json();
}

async function uploadMulti(path: string, files: File[]): Promise<any> {
  const headers: Record<string, string> = {};
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const r = await fetch(`/api${path}`, { method: "POST", headers, body: fd });
  if (r.status === 401 && tok) { clearToken(); window.dispatchEvent(new Event("maestros:logout")); throw new Error("Sesión expirada"); }
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* */ }
    throw new Error(msg);
  }
  return r.json();
}

async function download(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const r = await fetch(`/api${path}`, { headers });
  if (!r.ok) throw new Error(r.statusText);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function downloadPost(path: string, body: unknown, filename: string): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const r = await fetch(`/api${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function openPdf(path: string): Promise<void> {
  const headers: Record<string, string> = {};
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const r = await fetch(`/api${path}`, { headers });
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const api = {
  get: (p: string) => req("GET", p),
  post: (p: string, b?: unknown) => req("POST", p, b ?? {}),
  put: (p: string, b?: unknown) => req("PUT", p, b ?? {}),
  del: (p: string) => req("DELETE", p),
  upload,
  uploadMulti,
  download,
  downloadPost,
  openPdf,
};
