import PocketBase from 'pocketbase';

const DEFAULT_URL = import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090';
const STORAGE_KEY = 'pocketbase_url';
const ADMIN_STORAGE_KEY = 'pocketbase_admin_token';

let instance: PocketBase | null = null;

export const getPocketBaseUrl = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_URL;
  }
  return DEFAULT_URL;
};

export const savePocketBaseUrl = (url: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, url);
  }
};

export const getPocketBase = () => {
  if (!instance) {
    instance = new PocketBase(getPocketBaseUrl());
  }
  return instance;
};

export const pb = getPocketBase();

export const restoreAdminAuth = () => {
  const token = localStorage.getItem(ADMIN_STORAGE_KEY);
  if (token) {
    pb.authStore.save(token, null);
  }
};

export const authenticateAdmin = async (email: string, password: string) => {
  const result = await pb.admins.authWithPassword(email, password);
  localStorage.setItem(ADMIN_STORAGE_KEY, result.token);
  return result;
};

export const isAdminAuthenticated = () => {
  return pb.authStore.isValid && (pb.authStore.record?.collectionName === '_superusers');
};

export const logoutAdmin = () => {
  pb.authStore.clear();
  localStorage.removeItem(ADMIN_STORAGE_KEY);
};

export const reconnect = async (url: string) => {
  const token = localStorage.getItem(ADMIN_STORAGE_KEY);
  savePocketBaseUrl(url);
  instance = new PocketBase(url);
  if (token) {
    instance.authStore.save(token, null);
  }
  try {
    await instance.health.check();
    return { ok: true, latency: 0 };
  } catch {
    return { ok: false, latency: 0 };
  }
};
