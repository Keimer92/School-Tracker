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
        flowType: 'implicit', // Cambiamos a implicit para evitar errores de "invalid flow state"
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
      }
    });
  }
  return instance;
};

export const supabase = getSupabase();
