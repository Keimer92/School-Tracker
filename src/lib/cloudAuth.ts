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

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || "";

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

interface TokenBundle { idToken: string; refreshToken: string; expiresAt: number; }

function parseExpMs(idToken: string): number {
  try {
    const payload = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return (payload.exp || 0) * 1000;
  } catch { return 0; }
}

function readBundle(): TokenBundle | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    if (b && b.idToken) return b as TokenBundle;
  } catch { /* formato legacy: solo el idToken plano */ }
  // Compatibilidad con versiones anteriores (guardaban el idToken como string)
  try { return { idToken: raw, refreshToken: "", expiresAt: parseExpMs(raw) }; } catch { return null; }
}

// ── ID token de la última sesión (para llamadas admin) ──
export function setAuthToken(token: string): void {
  // Mantiene un refresh token previo si ya existía
  const prev = readBundle();
  const bundle: TokenBundle = { idToken: token, refreshToken: prev?.refreshToken || "", expiresAt: parseExpMs(token) };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(bundle));
}

export function getAuthToken(): string {
  return readBundle()?.idToken || "";
}

export function authTokenExpirado(token: string): boolean {
  return parseExpMs(token) < Date.now();
}

export function getRefreshToken(): string {
  return readBundle()?.refreshToken || "";
}

/**
 * Devuelve un ID token válido. Si el actual expiró y tenemos refresh_token,
 * lo renueva SILENCIOSAMENTE contra Google (evita tener que re-iniciar sesión
 * cada ~1 h). El refresh_token NO expira salvo que el usuario lo revoque.
 */
export async function getValidAuthToken(): Promise<string> {
  const cur = getAuthToken();
  if (cur && !authTokenExpirado(cur)) return cur;
  const rt = getRefreshToken();
  if (!rt) return cur;
  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: rt,
        grant_type: "refresh_token",
      }),
    });
    if (!resp.ok) return cur;
    const d = await resp.json();
    if (d.id_token) {
      const prev = readBundle();
      const bundle: TokenBundle = { idToken: d.id_token, refreshToken: d.refresh_token || prev?.refreshToken || rt, expiresAt: parseExpMs(d.id_token) };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(bundle));
      return d.id_token;
    }
  } catch { /* red caída: devolvemos el actual aunque expiró */ }
  return cur;
}

export interface AdminUserInfo {
  email: string; nombre: string; foto: string;
  rol: "admin" | "user"; creado: string; suspendido: boolean;
}

async function adminFetch(workerUrl: string, path: string, body: unknown): Promise<any> {
  const token = await getValidAuthToken();
  const res = await fetch(`${workerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-Token": token },
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
        if (!res.ok || !data.ok) {
          // Se adjunta el status para que el llamador distinga "no autorizado"
          // (403 por lista ALLOWED_EMAILS) de una caída de red o del Worker.
          const err = new Error(data.error || `Error HTTP ${res.status}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        setPerfilLocal(data.perfil);
        return data as AuthResult;

  } finally {
    clearTimeout(timeout);
  }
}

/** Guarda el ID token (y opcionalmente el refresh token) de la sesión. */
export function guardarTokenSesion(idToken: string, refreshToken?: string): void {
  if (!idToken) return;
  const prev = readBundle();
  const bundle: TokenBundle = {
    idToken,
    refreshToken: refreshToken || prev?.refreshToken || "",
    expiresAt: parseExpMs(idToken),
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(bundle));
}

/** Extrae el email de un ID token sin verificar la firma (solo para mostrar). */
export function decodeIdTokenEmail(idToken: string): string {
  try {
    const payload = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email || "";
  } catch { return ""; }
}
