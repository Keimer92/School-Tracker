/**
 * Registro local de las nubes (schoolKey) por cuenta de Google.
 *
 * El Worker asigna el schoolKey (el contenedor real de los datos en la nube) a
 * través de /auth SÓLO si existe un registro `user:<email>` en su KV. Las cuentas
 * conectadas vía archivo `.key` NO crean ese registro, por lo que al volver a
 * autenticar con Google el Worker genera un schoolKey NUEVO y vacío (se "pierde"
 * el vínculo con los datos existentes).
 *
 * Para aislar perfiles sin perder datos, guardamos aquí el schoolKey real de cada
 * cuenta la primera vez que la conectamos y lo reutilizamos al cambiar de cuenta,
 * en lugar de confiar en que /auth devuelva siempre el mismo.
 */
const PROFILES_KEY = "stp_account_profiles";
const CURRENT_KEY = "stp_current_account";

export interface AccountProfile {
  email: string;
  /**
   * Contenedor de datos en la nube. Ausentes cuando la cuenta NO tiene acceso a
   * la nube D1 (403 del Worker): esa cuenta se usa solo con Drive. Opcionales a
   * propósito, porque `saveProfile` hace merge y escribirlos vacíos borraría el
   * vínculo con la nube de quien ya lo tenía.
   */
  schoolKey?: string;
  workerUrl?: string;
  nombre?: string;
  foto?: string;
  // Credenciales guardadas para alternar de cuenta SIN re-autorizar
  googleIdToken?: string;
  googleAccessToken?: string | null;
  googleRefreshToken?: string | null;
  googleIdExpiresAt?: number;
  googleDriveExpiresAt?: number;
  googleClientId?: string;
}

export function loadProfiles(): Record<string, AccountProfile> {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveProfile(p: AccountProfile): void {
  const all = loadProfiles();
  const key = p.email.toLowerCase();
  // Merge (no reemplazo) para no perder las credenciales ya guardadas
  // (tokens) cuando sólo se actualiza la schoolKey/workerUrl.
  all[key] = { ...all[key], ...p };
  localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
}

/** Actualiza solo un subconjunto de campos (p. ej. tokens refrescados). */
export function patchProfileTokens(email: string, patch: Partial<AccountProfile>): void {
  const all = loadProfiles();
  const key = (email || '').toLowerCase();
  if (!key || !all[key]) return;
  all[key] = { ...all[key], ...patch };
  localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
}

export function getProfile(email: string | null | undefined): AccountProfile | null {
  if (!email) return null;
  return loadProfiles()[email.toLowerCase()] || null;
}

/** Lista de todas las cuentas vinculadas (para el selector de switch). */
export function listProfiles(): AccountProfile[] {
  return Object.values(loadProfiles());
}

export function removeProfile(email: string | null | undefined): void {
  if (!email) return;
  const all = loadProfiles();
  delete all[email.toLowerCase()];
  localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
}

export function getCurrentEmail(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function setCurrentEmail(email: string | null | undefined): void {
  if (email) localStorage.setItem(CURRENT_KEY, email);
}
