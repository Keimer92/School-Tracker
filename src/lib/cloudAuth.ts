/**
 * Autenticación del sync Cloudflare con Google Sign-In.
 *
 * El ID token de Google se verifica en el Worker (JWKS); aquí solo lo
 * transportamos. El Worker devuelve la schoolKey del usuario (login o
 * registro nuevo) y su perfil (nombre/foto/rol).
 */

/** URL por defecto del Worker de sync (distribución directa). */
export const DEFAULT_WORKER_URL = "https://schooltracker-d1-sync.pedroluisnfc.workers.dev";

export interface CloudPerfil {
  nombre: string;
  foto: string;
  email: string;
  rol: "admin" | "user";
}

export interface AuthResult {
  ok: true;
  creado: boolean;
  schoolKey: string;
  perfil: CloudPerfil;
  legacyReclamadas?: number;
}

const PERFIL_KEY = "stp_cloud_perfil";
const TOKEN_KEY = "stp_cloud_idtoken";

export function getPerfilLocal(): CloudPerfil | null {
  try {
    const raw = localStorage.getItem(PERFIL_KEY);
    return raw ? JSON.parse(raw) as CloudPerfil : null;
  } catch { return null; }
}

export function setPerfilLocal(p: CloudPerfil): void {
  localStorage.setItem(PERFIL_KEY, JSON.stringify(p));
}

export function clearPerfilLocal(): void {
  localStorage.removeItem(PERFIL_KEY);
}

// ── ID token de la última sesión (para llamadas admin; expira ~1 h) ──
export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getAuthToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function authTokenExpirado(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (payload.exp || 0) * 1000 < Date.now();
  } catch { return true; }
}

export interface AdminUserInfo {
  email: string; nombre: string; foto: string;
  rol: "admin" | "user"; creado: string; suspendido: boolean;
}

async function adminFetch(workerUrl: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-Token": getAuthToken() },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
  return data;
}

export async function fetchAdminUsers(workerUrl = DEFAULT_WORKER_URL): Promise<AdminUserInfo[]> {
  const d = await adminFetch(workerUrl, "/admin/users", {});
  return d.users as AdminUserInfo[];
}

export async function suspendUser(email: string, suspend: boolean, workerUrl = DEFAULT_WORKER_URL): Promise<void> {
  await adminFetch(workerUrl, "/admin/suspend", { email, suspend });
}

export async function deleteUserData(email: string, workerUrl = DEFAULT_WORKER_URL): Promise<number> {
  const d = await adminFetch(workerUrl, "/admin/delete-data", { email });
  return d.borradas ?? 0;
}

/** Login/registro contra el Worker usando un ID token de Google. */
export async function authWithGoogleIdToken(idToken: string, workerUrl = DEFAULT_WORKER_URL): Promise<AuthResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${workerUrl}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
    setPerfilLocal(data.perfil);
    return data as AuthResult;
  } finally {
    clearTimeout(timeout);
  }
}

/** Guarda el ID token de la sesión (llamar tras un auth exitoso). */
export function guardarTokenSesion(idToken: string): void {
  if (idToken) setAuthToken(idToken);
}

/** Extrae el email de un ID token sin verificar la firma (solo para mostrar). */
export function decodeIdTokenEmail(idToken: string): string {
  try {
    const payload = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email || "";
  } catch { return ""; }
}
