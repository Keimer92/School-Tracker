import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '@supabase/supabase-js';
import { emit } from "@tauri-apps/api/event";
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

    cloud.getProvider().getUser().then(u => {
      setUser(u);
      // Marcar que ya se verificó el estado inicial
      currentUserIdRef.current = u?.id || null;
    });

    const unsubscribe = cloud.getProvider().onAuthStateChange((u) => {
      // Solo mostrar toast si el usuario cambió de desconectado a conectado
      // (no en el primer load inicial)
      const wasConnected = currentUserIdRef.current !== null && currentUserIdRef.current !== undefined;
      const isNowConnected = u !== null && u !== undefined;
      
      if (u && !wasConnected && isNowConnected) {
        emit("show-toast", { message: '¡Sesión activa!', type: 'success' });
      }
      
      if (u) {
        currentUserIdRef.current = u.id;
        setUser(u);
      } else {
        setUser(null);
        currentUserIdRef.current = null;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);



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
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);

        if (error) {
          console.error('Error enviando email de recuperación:', error);
          emit("show-toast", { message: `Error: ${error.message}`, type: 'error' });
        } else {
          emit("show-toast", { message: 'Se ha enviado un enlace de recuperación a tu correo. Revisa tu bandeja de entrada y spam.', type: 'success' });
        }


      }
    } catch (error: any) {
      emit("show-toast", { message: error.message, type: 'error' });
    } finally { setLoading(false); }
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
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#f8fafc' }}>Conectado a Sync</h3>
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


    </div>
  );
}
