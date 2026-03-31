import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '@supabase/supabase-js';
import { emit, listen } from "@tauri-apps/api/event";
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { cloud } from '../lib/cloud/CloudBridge';
import { getSelectedProvider, setSelectedProvider, ProviderType } from '../lib/cloud/config';
import "../App.css";

type AuthMode = 'login' | 'signup' | 'recovery' | 'update-password';

export function Auth() {
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<User | any | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const [mode, setMode] = useState<AuthMode>('login');
  
  // Nuevo: Selector de Proveedor
  const [provider, setProvider] = useState<ProviderType>(getSelectedProvider());
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline' | 'restoring'>('checking');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log("DEBUG AUTH:", msg);
    setDebugLog(prev => [msg.substring(0, 60), ...prev].slice(0, 3));
  };

  // Verificar si la nube elegida responde
  const checkServer = async () => {
    try {
      setServerStatus('checking');
      const status = await cloud.getProvider().checkHealth();
      setServerStatus(status === 'online' ? 'online' : 'offline');
    } catch (e) {
      console.error("Error checking server:", e);
      setServerStatus('offline');
    }
  };

  const handleProviderChange = (newProvider: ProviderType) => {
    setSelectedProvider(newProvider);
    setProvider(newProvider);
    emit("show-toast", { message: `Cambiando a ${newProvider.toUpperCase()}...`, type: 'info' });
    checkServer();
  };

  useEffect(() => {
    checkServer(); // Verificar al montar

    // Configurar listeners de deep link INMEDIATAMENTE
    const setupDeepLinks = async () => {
      try {
        // Listener principal para cuando la app se abre desde un deep link
        const unlistenDeepLink = await onOpenUrl((urls) => {
          console.log("🔗 Deep link recibido:", urls);
          urls.forEach(url => {
            addLog(`URL recibida: ${url.substring(0, 50)}...`);
            processAuthInput(url);
          });
        });

        // Listener alternativo para eventos de deep link
        const unlistenEvent = await listen('deep-link-received', (e: any) => {
          console.log("🔗 Evento deep-link-received:", e.payload);
          processAuthInput(e.payload);
        });

        // Listener para auth-code (usado desde main.tsx)
        const unlistenAuthCode = await listen('auth-code', (e: any) => {
          console.log("🔗 Evento auth-code:", e.payload);
          processAuthInput(e.payload);
        });

        addLog("Listeners de deep link registrados");

        return () => {
          unlistenDeepLink();
          unlistenEvent();
          unlistenAuthCode();
          addLog("Listeners de deep link removidos");
        };
      } catch (error) {
        console.error("Error configurando deep links:", error);
        addLog("Error deep links: " + error);
        return () => {};
      }
    };

    const cleanupPromise = setupDeepLinks();

    // Sesión inicial usando el proveedor activo
    cloud.getProvider().getUser().then(u => {
      addLog("Sesión inicial: " + (u?.email || "null"));
      setUser(u);
    });

    // Escuchar el estado de autenticación de forma genérica
    const unsubscribe = cloud.getProvider().onAuthStateChange((u) => {
      if (u) {
        if (u.id !== currentUserIdRef.current) {
          currentUserIdRef.current = u.id;
          addLog("¡Nuevo usuario autenticado!");
          emit("show-toast", { message: '¡Sesión activa!', type: 'success' });
        }
        setUser(u);
      } else {
        setUser(null);
        currentUserIdRef.current = null;
        addLog("Sesión cerrada");
      }
    });

    return () => {
      unsubscribe();
      cleanupPromise.then(c => c());
    };
  }, [provider]); // Re-ejecutar si cambia el proveedor

  const processAuthInput = async (input: string) => {
    if (!input || input.length < 10) {
      addLog("URL inválida o muy corta");
      return;
    }

    addLog(`Procesando URL: ${input.substring(0, 100)}...`);
    console.log("🔗 PROCESANDO URL:", input);

    // CASO 1: Supabase (code)
    const matchCode = input.match(/[?&]code=([^&#]+)/);

    if (matchCode && provider === 'supabase') {
      const code = matchCode[1];
      setLoading(true);
      addLog("Canjeando code Supabase...");
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          if (!error.message.includes("verifier")) {
            addLog("Error: " + error.message);
            emit("show-toast", { message: error.message, type: 'error' });
          } else {
            addLog("Error PKCE verifier - posible problema de redirección");
          }
        } else if (data.session) {
          addLog("¡Supabase Ok!");
          setUser(data.session.user);
          if (input.includes('type=recovery') || mode === 'recovery') setMode('update-password');
          emit("show-toast", { message: '¡Sesión de Supabase activa!', type: 'success' });
        }
      } catch (e: any) {
        addLog("Excepción: " + e?.message);
      } finally {
        setLoading(false);
      }
    } 
    // CASO 2: Appwrite - El SDK maneja la sesión automáticamente
    else if (provider === 'appwrite') {
      addLog("Appwrite OAuth en proceso...");
      // Con Appwrite, la sesión se establece automáticamente después del login
      // Solo necesitamos verificar si el usuario está autenticado
      setLoading(true);
      
      try {
        // Pequeña pausa para dar tiempo al SDK de procesar la sesión
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const u = await cloud.getProvider().getUser();
        if (u) {
          addLog(`¡Aprobado! User: ${u.email}`);
          setUser(u);
          emit("show-toast", { message: '¡Sesión de Appwrite activa!', type: 'success' });
        } else {
          addLog("Esperando sesión de Appwrite...");
        }
        setLoading(false);
      } catch (err: any) {
        addLog("Error verificando sesión: " + err.message);
        setLoading(false);
      }
    }
    else {
      addLog("URL no reconocida - no es Supabase ni Appwrite");
      console.log("URL sin match:", input);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (mode === 'update-password') {
      if (!cleanPassword) return;
      setLoading(true);
      try {
        const { error } = await supabase.auth.updateUser({ password: cleanPassword });
        if (error) throw error;
        emit("show-toast", { message: '¡Contraseña actualizada!', type: 'success' });
        setMode('login');
        setPassword('');
      } catch (error: any) {
        emit("show-toast", { message: error.message, type: 'error' });
      } finally { setLoading(false); }
      return;
    }

    if (!cleanEmail || (mode !== 'recovery' && !cleanPassword)) {
      emit("show-toast", { message: 'Por favor, completa todos los campos', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: cleanPassword });
        if (error) {
          if (error.message.includes("Email not confirmed")) {
            throw new Error("El correo no ha sido confirmado. Revisa tu bandeja de entrada.");
          }
          throw error;
        }
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password: cleanPassword });
        if (error) throw error;
        
        if (data.user && data.session === null) {
          await emit("show-toast", { 
            message: '¡Usuario creado! REVISA TU CORREO para confirmar la cuenta antes de entrar.', 
            type: 'info' 
          });
        } else {
          await emit("show-toast", { message: '¡Cuenta creada e iniciada!', type: 'success' });
        }
        setMode('login');
      } else if (mode === 'recovery') {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: 'com.keimer.senkuapp://supabase' });
        if (error) throw error;
        emit("show-toast", { message: 'Enlace de recuperación enviado', type: 'success' });
        setMode('login');
      }
    } catch (error: any) {
      emit("show-toast", { message: error.message, type: 'error' });
    } finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    if (loading) return;
    setLoading(true);
    addLog(`Iniciando OAuth con ${provider.toUpperCase()}...`);
    try {
      await cloud.getProvider().signInWithGoogle();
      addLog("Esperando callback...");
    } catch (error: any) {
      addLog("Error: " + (error.message || 'Fallo al iniciar OAuth'));
      emit("show-toast", { message: error.message || 'Error de conexión', type: 'error' });
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await cloud.getProvider().signOut();
      setUser(null); // Actualizar instantáneamente la interfaz
      emit("show-toast", { message: 'Sesión cerrada exitosamente', type: 'success' });
    } catch {
      emit("show-toast", { message: 'Error cerrando la sesión', type: 'error' });
    }
  };

  if (user && mode !== 'update-password') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '1.5rem', background: 'rgba(34, 197, 94, 0.05)', borderRadius: '12px', border: '1px solid rgba(34, 197, 94, 0.2)', width: '100%' }}>
        <div style={{ fontSize: '2.5rem' }}>✅</div>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#f8fafc' }}>Conectado a {provider.toUpperCase()}</h3>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>{user.email}</p>
        </div>
        <button onClick={handleSignOut} style={{ marginTop: '1rem', padding: '0.6rem 1.2rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', cursor: 'pointer' }}>Cerrar Sesión</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem', background: 'rgba(15, 23, 42, 0.8)', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.1)', width: '100%', maxWidth: '400px', margin: '0 auto' }}>
      
      {/* Selector de Proveedor Híbrido */}
      <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '10px', marginBottom: '1.5rem', width: '100%' }}>
        <button 
          onClick={() => handleProviderChange('supabase')}
          style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', transition: 'all 0.3s', background: provider === 'supabase' ? '#3b82f6' : 'transparent', color: provider === 'supabase' ? 'white' : '#64748b' }}
        >
          Supabase
        </button>
        <button 
          onClick={() => handleProviderChange('appwrite')}
          style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', transition: 'all 0.3s', background: provider === 'appwrite' ? '#f02e65' : 'transparent', color: provider === 'appwrite' ? 'white' : '#64748b' }}
        >
          Appwrite
        </button>
      </div>

      {/* Indicador de Estado de la Nube */}
      <div style={{ alignSelf: 'flex-end', marginBottom: '-1rem', padding: '0.2rem 0.6rem', background: 'rgba(0,0,0,0.2)', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: serverStatus === 'online' ? '#22c55e' : serverStatus === 'checking' ? '#eab308' : '#ef4444', boxShadow: serverStatus === 'online' ? '0 0 8px #22c55e' : 'none' }}></div>
        <span style={{ color: '#94a3b8', fontWeight: 'bold' }}>{provider.toUpperCase()} {serverStatus === 'online' ? 'LISTA' : serverStatus === 'checking' ? 'REVISANDO' : 'DESCONECTADA'}</span>
      </div>

      <h3 style={{ marginBottom: '1.5rem', color: '#f8fafc', textAlign: 'center' }}>
        {mode === 'login' ? 'Iniciar Sesión' : mode === 'signup' ? 'Crear Cuenta' : mode === 'recovery' ? 'Recuperar Clave' : 'Nueva Contraseña'}
      </h3>

      {serverStatus === 'offline' && (
        <div style={{ marginBottom: '1.5rem', padding: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', fontSize: '0.75rem', color: '#fca5a5', textAlign: 'center' }}>
          {provider === 'supabase' ? (
            <>⚠️ La nube está pausada (Plan Gratuito). Estamos intentando despertarla, esto puede tardar 2-3 minutos.</>
          ) : (
            <>⚠️ No se pudo establecer conexión con la nube de Appwrite. Verifica tu conexión a internet o el Project ID.</>
          )}
          <button onClick={checkServer} style={{ display: 'block', margin: '0.5rem auto 0', padding: '0.3rem 0.8rem', background: '#450a0a', border: '1px solid #ef4444', color: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '0.65rem' }}>Reintentar Conexión</button>
        </div>
      )}
      
      <form onSubmit={handleEmailAuth} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        {mode !== 'update-password' && (
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo electrónico" style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white' }} required />
        )}
        {mode !== 'recovery' && (
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'update-password' ? "Nueva clave" : "Contraseña"} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white' }} required />
        )}
        <button type="submit" disabled={loading || serverStatus !== 'online'} style={{ padding: '12px', borderRadius: '8px', background: serverStatus === 'online' ? '#3b82f6' : '#1e293b', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold', opacity: serverStatus === 'online' ? 1 : 0.6 }}>
          {loading ? 'Cargando...' : serverStatus !== 'online' ? 'Esperando Nube...' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Registrar' : mode === 'recovery' ? 'Enviar Correo' : 'Guardar Nueva Clave'}
        </button>
      </form>

      {loading && (
        <div style={{ width: '100%', textAlign: 'center', marginBottom: '1rem' }}>
          <button 
            type="button"
            onClick={() => setLoading(false)} 
            style={{ padding: '8px 20px', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', borderRadius: '20px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
          >
            ❌ Cancelar y Reintentar
          </button>
        </div>
      )}

      {mode !== 'update-password' && (
        <>
          <div style={{ margin: '1rem 0', color: '#475569', fontSize: '0.7rem' }}>O CONTINUAR CON</div>
          <button type="button" onClick={handleGoogleLogin} disabled={loading || serverStatus !== 'online'} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'white', color: '#1f2937', border: 'none', fontWeight: '600', padding: '12px', borderRadius: '8px', cursor: serverStatus === 'online' ? 'pointer' : 'not-allowed', opacity: serverStatus === 'online' ? 1 : 0.5 }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Google
          </button>
        </>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
        {mode === 'login' ? (
          <>
            <button type="button" onClick={() => setMode('signup')} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer' }}>Crear cuenta</button>
            <button type="button" onClick={() => setMode('recovery')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>Olvidé clave</button>
          </>
        ) : (
          mode !== 'update-password' && <button type="button" onClick={() => setMode('login')} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer' }}>Volver</button>
        )}
      </div>

      <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', width: '100%', textAlign: 'center' }}>
        <button type="button" onClick={() => setShowHelp(!showHelp)} style={{ background: 'none', border: 'none', color: '#475569', fontSize: '0.7rem', cursor: 'pointer', textDecoration: 'underline' }}>
          Ayuda técnica
        </button>
        {showHelp && (
          <div style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input type="text" placeholder="URL de error" value={manualInput} onChange={(e) => setManualInput(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #334155', background: '#0f172a', color: 'white', fontSize: '0.7rem' }} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={() => processAuthInput(manualInput)} style={{ flex: 1, padding: '6px', borderRadius: '4px', background: '#1e293b', color: 'white', fontSize: '0.7rem', cursor: 'pointer' }}>Entrar con URL</button>
              <button type="button" onClick={() => setMode('update-password')} style={{ flex: 1, padding: '6px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.2)', fontSize: '0.7rem', cursor: 'pointer' }}>Forzar Nueva Clave</button>
            </div>
          </div>
        )}
      </div>

      {debugLog.length > 0 && (
        <div style={{ marginTop: '1rem', color: '#4ade80', fontSize: '0.6rem', fontFamily: 'monospace', opacity: 0.5 }}>
          {debugLog.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      )}
    </div>
  );
}
