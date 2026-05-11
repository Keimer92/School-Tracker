import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('CRÍTICO: Falta la configuración de Supabase en el archivo .env');
}

// Singleton para evitar múltiples instancias
let instance: SupabaseClient | null = null;

export const getSupabase = () => {
  if (!instance) {
    instance = createClient(supabaseUrl || '', supabaseAnonKey || '', {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
      },
      realtime: {
        enabled: true,
        params: {
          eventsPerSecond: 10
        }
      }
    });
  }
  return instance;
};

export const supabase = getSupabase();

// Función helper para suscribirse a cambios en una tabla
export const subscribeToTable = (
  table: string,
  callback: (payload: any) => void,
  filter?: string
) => {
  const channel = supabase
    .channel(`${table}-changes`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: table,
        ...(filter ? { filter } : {})
      },
      callback
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};
