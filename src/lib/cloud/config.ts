// Configuración persistente del proveedor de la nube elegido
const STORAGE_KEY = 'senku_cloud_provider';

export type ProviderType = 'supabase' | 'appwrite';

export const getSelectedProvider = (): ProviderType => {
  return (localStorage.getItem(STORAGE_KEY) as ProviderType) || 'supabase';
};

export const setSelectedProvider = (provider: ProviderType) => {
  localStorage.setItem(STORAGE_KEY, provider);
};
