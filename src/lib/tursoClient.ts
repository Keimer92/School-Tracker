import { connect } from "@tursodatabase/serverless";

const URL_KEY = 'turso_db_url';
const TOKEN_KEY = 'turso_auth_token';

let client: ReturnType<typeof connect> | null = null;

export const getTursoUrl = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(URL_KEY) || '';
  }
  return '';
};

export const getTursoToken = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(TOKEN_KEY) || '';
  }
  return '';
};

export const saveTursoCredentials = (url: string, token: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(URL_KEY, url);
    localStorage.setItem(TOKEN_KEY, token);
  }
};

export const clearTursoCredentials = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(URL_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }
};

export const getTursoClient = () => {
  return client;
};

export const connectTurso = (url: string, authToken: string) => {
  if (client) {
    try { client.close(); } catch {}
  }
  saveTursoCredentials(url, authToken);
  client = connect({ url, authToken });
  return client;
};

export const disconnectTurso = () => {
  if (client) {
    try { client.close(); } catch {}
    client = null;
  }
  clearTursoCredentials();
};

export const restoreTursoClient = () => {
  const url = getTursoUrl();
  const token = getTursoToken();
  if (url && token) {
    client = connect({ url, authToken: token });
    return client;
  }
  return null;
};
