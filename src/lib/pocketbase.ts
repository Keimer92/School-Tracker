import PocketBase from 'pocketbase';

const DEFAULT_URL = import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090';
const STORAGE_KEY = 'pocketbase_url';

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

export const reconnect = async (url: string) => {
  const token = pb.authStore.token;
  const model = pb.authStore.model;
  savePocketBaseUrl(url);
  instance = new PocketBase(url);
  if (token && model) {
    instance.authStore.save(token, model);
  }
  try {
    await instance.health.check();
    return { ok: true, latency: 0 };
  } catch {
    return { ok: false, latency: 0 };
  }
};
