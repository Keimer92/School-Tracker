import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

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
      }
    });
  }
  return instance;
};

export const supabase = getSupabase();

// Función helper para suscribirse a cambios en una tabla
export const subscribeToTable = async (
  table: string,
  callback: (payload: any) => void,
  filter?: string
): Promise<() => void> => {
  try {
    // Verificar que el usuario esté autenticado
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.log('[Supabase] No hay sesión activa, saltando suscripción realtime');
      return () => {};
    }

    console.log(`[Supabase] Suscribiéndose a cambios en tabla: ${table}${filter ? ` con filtro: ${filter}` : ''} (User: ${session.user.id})`);

    const channel = supabase
      .channel(`${table}-changes-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: table,
          ...(filter ? { filter } : {})
        },
        (payload) => {
          console.log(`[Supabase] Cambio detectado en ${table}:`, payload);
          callback(payload);
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.error(`[Supabase] Error en suscripción para ${table}:`, err);
        } else {
          console.log(`[Supabase] Estado de suscripción para ${table}:`, status);
        }
      });

    return () => {
      console.log(`[Supabase] Desuscribiéndose de ${table}`);
      supabase.removeChannel(channel);
    };
  } catch (error) {
    console.error(`[Supabase] Error al suscribirse a ${table}:`, error);
    return () => {};
  }
};

// Polling - força sync desde Supabase
export const startPolling = async (
  onSync: () => Promise<void>,
  canSync: () => boolean,
  intervalMs: number = 30000
): Promise<() => void> => {
  console.log(`[Polling] Iniciado cada ${intervalMs}ms`);
  
  const poll = async () => {
    if (!canSync()) return;
    
    console.log('[Polling] Sincronizando desde Supabase...');
    try {
      await onSync();
      console.log('[Polling] Sync completado');
    } catch (e) {
      console.error('[Polling] Error:', e);
    }
  };
  
  // Primera ejecución tras 2 segundos
  const timeoutId = setTimeout(poll, 2000);
  
  // Luego ejecutar periódicamente
  const intervalId = setInterval(poll, intervalMs);
  
  return () => {
    console.log('[Polling] Detenido');
    clearTimeout(timeoutId);
    clearInterval(intervalId);
  };
};
};
