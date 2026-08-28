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
  schoolKey: string;
  workerUrl: string;
  nombre?: string;
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
  all[p.email.toLowerCase()] = p;
  localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
}

export function getProfile(email: string | null | undefined): AccountProfile | null {
  if (!email) return null;
  return loadProfiles()[email.toLowerCase()] || null;
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
