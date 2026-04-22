import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '@supabase/supabase-js';
import { emit, listen } from "@tauri-apps/api/event";
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { cloud } from '../lib/cloud/CloudBridge';
import "../App.css";

type AuthMode = 'login' | 'signup' | 'recovery' | 'update-password';

export function Auth() {
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<User | any | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const [mode, setMode] = useState<AuthMode>('login');
  
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

  useEffect(() => {
    checkServer();

    const setupDeepLinks = async () => {
      try {
        const unlistenDeepLink = await onOpenUrl((urls) => {
          urls.forEach(url => {
            addLog(`URL recibida: ${url.substring(0, 50)}...`);
            processAuthInput(url);
          });
        });

        const unlistenEvent = await listen('deep-link-received', (e: any) => {
          processAuthInput(e.payload);
        });

        const unlistenAuthCode = await listen('auth-code', (e: any) => {
          processAuthInput(e.payload);
        });

        addLog("Listeners de deep link activos");

        return () => {
          unlistenDeepLink();
          unlistenEvent();
          unlistenAuthCode();
        };
      } catch (error) {
        console.error("Error configurando deep links:", error);
        return () => {};
      }
    };

    const cleanupPromise = setupDeepLinks();

    cloud.getProvider().getUser().then(u => {
      setUser(u);
    });

    const unsubscribe = cloud.getProvider().onAuthStateChange((u) => {
      if (u) {
        if (u.id !== currentUserIdRef.current) {
          currentUserIdRef.current = u.id;
          emit("show-toast", { message: '¡Sesión activa!', type: 'success' });
        }
        setUser(u);
      } else {
        setUser(null);
        currentUserIdRef.current = null;
      }
    });

    return () => {
      unsubscribe();
      cleanupPromise.then(c => c());
    };
  }, []);

  const processAuthInput = async (input: string) => {
    if (!input || input.length < 10) return;

    addLog(`Procesando URL...`);
    console.log("🔗 PROCESANDO URL:", input);

    // Flujo Implicit (access_token)
    if (input.includes('access_token=')) {
      addLog("Detectado access_token...");
      setLoading(true);
      try {
        const hash = input.includes('#') ? input.split('#')[1] : (input.includes('?') ? input.split('?')[1] : "");
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          if (data.user) {
            addLog("¡Sesión iniciada!");
            setUser(data.user);
            emit("show-toast", { message: '¡Sesión de Supabase activa!', type: 'success' });
          }
        }
      } catch (e: any) {
        addLog("Error: " + e.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Flujo PKCE (code)
    const matchCode = input.match(/[?&]code=([^&#]+)/);
    if (matchCode) {
      const code = matchCode[1];
      setLoading(true);
      addLog("Canjeando código...");
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        if (data.session) {
          addLog("¡Sesión iniciada!");
          setUser(data.session.user);
          emit("show-toast", { message: '¡Sesión de Supabase activa!', type: 'success' });
        }
      } catch (e: any) {
        addLog("Error: " + e.message);
      } finally {
        setLoading(false);
      }
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
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: cleanEmail, password: cleanPassword });
        if (error) throw error;
        if (data.user && data.session === null) {
          emit("show-toast", { message: '¡Cuenta creada! Confirma tu correo.', type: 'info' });
        }
        setMode('login');
      } else if (mode === 'recovery') {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: 'com.keimer.schooltrackerpro://supabase' });
        if (error) throw error;
        emit("show-toast", { message: 'Enlace enviado', type: 'success' });
        setMode('login');
      }
    } catch (error: any) {
      emit("show-toast", { message: error.message, type: 'error' });
    } finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await cloud.getProvider().signInWithGoogle();
    } catch (error: any) {
      emit("show-toast", { message: error.message || 'Error de conexión', type: 'error' });
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await cloud.getProvider().signOut();
      setUser(null);
      emit("show-toast", { message: 'Sesión cerrada', type: 'success' });
    } catch {
      emit("show-toast", { message: 'Error al cerrar sesión', type: 'error' });
    }
  };

  if (user && mode !== 'update-password') {
    return (
      <div className="auth-connected-card">
        <div style={{ fontSize: '2.5rem' }}>✅</div>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#f8fafc' }}>Conectado a la Nube</h3>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>{user.email}</p>
        </div>
        <button onClick={handleSignOut} className="auth-signout-button">Cerrar Sesión</button>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div style={{ alignSelf: 'flex-end', marginBottom: '0.5rem', padding: '0.2rem 0.6rem', background: 'rgba(0,0,0,0.2)', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: serverStatus === 'online' ? '#22c55e' : serverStatus === 'checking' ? '#eab308' : '#ef4444', boxShadow: serverStatus === 'online' ? '0 0 8px #22c55e' : 'none' }}></div>
        <span style={{ color: '#94a3b8', fontWeight: 'bold' }}>SUPABASE {serverStatus === 'online' ? 'LISTA' : serverStatus === 'checking' ? 'REVISANDO' : 'DESCONECTADA'}</span>
      </div>

      <h3 style={{ marginBottom: '1.5rem', color: '#f8fafc', textAlign: 'center' }}>
        {mode === 'login' ? 'Iniciar Sesión' : mode === 'signup' ? 'Crear Cuenta' : mode === 'recovery' ? 'Recuperar Clave' : 'Nueva Contraseña'}
      </h3>

      {serverStatus === 'offline' && (
        <div className="auth-offline-warning">
          ⚠️ La nube está pausada o desconectada. Estamos intentando despertarla.
          <button onClick={checkServer} className="auth-retry-button">Reintentar</button>
        </div>
      )}
      
      <form onSubmit={handleEmailAuth} className="auth-form">
        {mode !== 'update-password' && (
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo electrónico" className="auth-input" required />
        )}
        {mode !== 'recovery' && (
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'update-password' ? "Nueva clave" : "Contraseña"} className="auth-input" required />
        )}
        <button type="submit" disabled={loading || serverStatus !== 'online'} className="auth-submit-button">
          {loading ? 'Cargando...' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Registrar' : mode === 'recovery' ? 'Enviar Correo' : 'Guardar Nueva Clave'}
        </button>
      </form>

      {mode !== 'update-password' && (
        <>
          <div className="auth-divider">O CONTINUAR CON</div>
          <button type="button" onClick={handleGoogleLogin} disabled={loading || serverStatus !== 'online'} className="auth-google-button">
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Google
          </button>
        </>
      )}

      <div className="auth-footer-links">
        {mode === 'login' ? (
          <>
            <button type="button" onClick={() => setMode('signup')} className="link-button">Crear cuenta</button>
            <button type="button" onClick={() => setMode('recovery')} className="link-button secondary">Olvidé clave</button>
          </>
        ) : (
          mode !== 'update-password' && <button type="button" onClick={() => setMode('login')} className="link-button">Volver</button>
        )}
      </div>

      <div className="auth-help-section">
        <button type="button" onClick={() => setShowHelp(!showHelp)} className="help-toggle">Ayuda técnica</button>
        {showHelp && (
          <div className="help-content">
            <input type="text" placeholder="URL de error" value={manualInput} onChange={(e) => setManualInput(e.target.value)} className="help-input" />
            <button type="button" onClick={() => processAuthInput(manualInput)} className="help-submit">Entrar con URL</button>
          </div>
        )}
      </div>
    </div>
  );
}
