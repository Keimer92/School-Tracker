import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL_KEY = 'supabase_url';
const ANON_KEY = 'supabase_anon_key';
const DB_PW_KEY = 'sbDbPassword';

const DEFAULT_URL: string = import.meta.env.VITE_SUPABASE_URL || '';
const DEFAULT_ANON: string = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let _client: SupabaseClient | null = null;
let _currentConfig = { url: '', anonKey: '' };

function getConfig() {
  if (typeof window !== 'undefined') {
    return {
      url: localStorage.getItem(URL_KEY) || DEFAULT_URL,
      anonKey: localStorage.getItem(ANON_KEY) || DEFAULT_ANON,
    };
  }
  return { url: DEFAULT_URL, anonKey: DEFAULT_ANON };
}

export function saveSupabaseConfig(url: string, anonKey: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(URL_KEY, url);
    localStorage.setItem(ANON_KEY, anonKey);
  }
}

export function clearSupabaseConfig() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(URL_KEY);
    localStorage.removeItem(ANON_KEY);
  }
}

export function saveSupabaseDbPassword(pw: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(DB_PW_KEY, pw);
  }
}

export function getSupabaseDbPassword(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(DB_PW_KEY) || '';
  }
  return '';
}

export function hasSupabaseConfig(): boolean {
  const { url, anonKey } = getConfig();
  return !!(url && anonKey);
}

function ensureClient(): SupabaseClient | null {
  const { url, anonKey } = getConfig();
  if (!url || !anonKey) return null;
  if (_client && _currentConfig.url === url && _currentConfig.anonKey === anonKey) {
    return _client;
  }
  if (_client) {
    _client = null;
  }
  _currentConfig = { url, anonKey };
  _client = createClient(url, anonKey, {
    auth: { persistSession: true, storageKey: 'sb-schooltracker-auth' },
  });
  return _client;
}

export function getSupabaseClient(): SupabaseClient | null {
  return ensureClient();
}

export function destroyClient() {
  if (_client) {
    _client = null;
  }
  _currentConfig = { url: '', anonKey: '' };
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = ensureClient();
    if (!client) {
      return createNoopMethod(prop as string);
    }
    const value = (client as any)[prop];
    if (typeof value === 'function') {
      return (...args: any[]) => value.apply(client, args);
    }
    return value;
  },
});

function createNoopMethod(prop: string) {
  return (...args: any[]) => {
    console.warn(`[Supabase] Cliente no configurado. Llamada a '${prop}' ignorada.`);
    if (prop === 'from') {
      return createNoopQueryBuilder();
    }
    if (prop === 'auth') {
      return createNoopAuth();
    }
    if (['channel', 'removeChannel'].includes(prop)) {
      const noop = () => {};
      return prop === 'removeChannel' ? noop : { on: () => ({ subscribe: noop }), unsubscribe: noop };
    }
    return Promise.resolve({ data: null, error: new Error('Supabase no está configurado. Configura URL y Anon Key en Cloud > Sync.') });
  };
}

function createNoopQueryBuilder() {
  const noopChain = () => ({
    select: () => noopChain(),
    insert: () => noopChain(),
    upsert: () => noopChain(),
    update: () => noopChain(),
    delete: () => noopChain(),
    eq: () => noopChain(),
    neq: () => noopChain(),
    in: () => noopChain(),
    maybeSingle: () => noopChain(),
    single: () => noopChain(),
    order: () => noopChain(),
    limit: () => noopChain(),
    then: (resolve: any) => resolve({ data: null, error: new Error('Supabase no está configurado.') }),
    catch: (reject: any) => Promise.reject(new Error('Supabase no está configurado.')),
    finally: (cb: any) => Promise.resolve().then(cb),
  });
  return noopChain();
}

function createNoopAuth() {
  return {
    getUser: async () => ({ data: { user: null }, error: new Error('Supabase no configurado') }),
    getSession: async () => ({ data: { session: null }, error: new Error('Supabase no configurado') }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({ data: {}, error: new Error('Supabase no configurado') }),
    signUp: async () => ({ data: {}, error: new Error('Supabase no configurado') }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: new Error('Supabase no configurado') }),
    updateUser: async () => ({ data: {}, error: new Error('Supabase no configurado') }),
    signInWithOAuth: async () => ({ data: {}, error: new Error('Supabase no configurado') }),
  };
}

export const subscribeToTable = async () => () => {};
export const startPolling = async () => () => {};
