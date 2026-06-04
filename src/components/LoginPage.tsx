import { useState, useEffect } from "react";
import { Auth } from "./Auth";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "../App.css";

const STORAGE_KEY = "schooltracker-first-launch-complete";

interface LoginPageProps {
  onComplete: () => void;
}

export function LoginPage({ onComplete }: LoginPageProps) {
  const [showAuth, setShowAuth] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveUserEmail, setDriveUserEmail] = useState<string | null>(null);
  const [driveUserName, setDriveUserName] = useState<string | null>(null);

  const GD_STORAGE_KEY = 'schooltracker-google-drive-settings';
  const GD_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const GD_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || '';
  const GD_DESKTOP_REDIRECT = 'http://localhost:51733/callback';
  const GD_ANDROID_REDIRECT = 'http://127.0.0.1/callback';

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", localStorage.getItem("app-theme") || "mint");
    const stored = localStorage.getItem(GD_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.refreshToken) {
          setDriveConnected(true);
          setDriveUserEmail(parsed.googleUserEmail || null);
          setDriveUserName(parsed.googleUserName || null);
        }
      } catch (_) {}
    }
  }, []);

  const completeDriveConnect = async (code: string) => {
    setDriveLoading(true);
    const isAndroid = /Android/i.test(navigator.userAgent);
    const redirectUri = isAndroid ? GD_ANDROID_REDIRECT : GD_DESKTOP_REDIRECT;
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code.trim(),
          client_id: GD_CLIENT_ID,
          client_secret: GD_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!response.ok) throw new Error('Error de autenticación');
      const data = await response.json();
      const infoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      const profile = infoResponse.ok ? await infoResponse.json() : {};
      const stored = localStorage.getItem(GD_STORAGE_KEY);
      const existing = stored ? JSON.parse(stored) : {};
      localStorage.setItem(GD_STORAGE_KEY, JSON.stringify({
        ...existing,
        clientId: GD_CLIENT_ID,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenExpiry: Date.now() + (data.expires_in * 1000),
        googleUserEmail: profile.email || null,
        googleUserName: profile.name || null,
        googleUserProfilePic: profile.picture || null,
      }));
      setDriveConnected(true);
      setDriveUserEmail(profile.email || null);
      setDriveUserName(profile.name || null);
    } catch (e: any) {
      await emit("show-toast", { message: `Error: ${e.message || e}`, type: "error" });
    } finally {
      setDriveLoading(false);
    }
  };

  const handleDriveConnect = async () => {
    setDriveLoading(true);
    const isAndroid = /Android/i.test(navigator.userAgent);
    const redirectUri = isAndroid ? GD_ANDROID_REDIRECT : GD_DESKTOP_REDIRECT;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=https://www.googleapis.com/auth/drive.file%20https://www.googleapis.com/auth/userinfo.email%20https://www.googleapis.com/auth/userinfo.profile&access_type=offline&prompt=consent`;
    if (isAndroid) {
      try {
        await openUrl(authUrl);
        const unlisten = await listen<string>('oauth-callback-android', (event) => {
          unlisten();
          completeDriveConnect(event.payload);
        });
      } catch (e) {
        await emit("show-toast", { message: `Error al abrir navegador: ${e}`, type: "error" });
        setDriveLoading(false);
      }
    } else {
      const serverPromise = invoke<string>('gd_start_oauth_server', { port: 51733 });
      try {
        await invoke('gd_open_url_browser', { url: authUrl });
      } catch {
        window.open(authUrl, '_blank');
      }
      try {
        const capturedCode = await serverPromise;
        await completeDriveConnect(capturedCode);
      } catch {
        setDriveLoading(false);
      }
    }
  };

  const handleDriveDisconnect = () => {
    localStorage.setItem(GD_STORAGE_KEY, JSON.stringify({
      clientId: GD_CLIENT_ID,
      backupEnabled: false,
      backupInterval: 12,
      lastBackupTime: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiry: null,
      deviceName: 'PC Principal',
      googleUserEmail: null,
      googleUserName: null,
      googleUserProfilePic: null,
    }));
    setDriveConnected(false);
    setDriveUserEmail(null);
    setDriveUserName(null);
  };

  const handleContinue = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    onComplete();
  };

  return (
    <div style={{
      height: '100dvh',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at top, rgba(16, 185, 129, 0.08), transparent 60%), radial-gradient(ellipse at bottom, rgba(59, 130, 246, 0.08), transparent 60%), #0f172a',
      padding: '1rem',
    }}>
      <style>{`
        @keyframes login-fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .login-section {
          animation: login-fade-in 0.6s ease-out both;
        }
        .login-section:nth-child(2) { animation-delay: 0.15s; }
        .login-section:nth-child(3) { animation-delay: 0.3s; }
        .login-section:nth-child(4) { animation-delay: 0.45s; }
      `}</style>

      <div style={{
        width: '100%',
        maxWidth: '480px',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}>
        <div className="login-section" style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📚</div>
          <h1 style={{
            fontSize: '1.8rem',
            fontWeight: '800',
            color: '#f1f5f9',
            margin: 0,
            letterSpacing: '-0.02em',
          }}>
            School Tracker Pro
          </h1>
          <p style={{
            color: '#64748b',
            fontSize: '0.85rem',
            marginTop: '0.3rem',
            maxWidth: '320px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Conecta tu cuenta para sincronizar datos en la nube y crear respaldos automáticos.
            Ambas conexiones son opcionales.
          </p>
        </div>

        <div className="login-section" style={{
          background: 'rgba(30, 41, 59, 0.6)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          overflow: 'hidden',
        }}>
          <div
            onClick={() => setShowAuth(!showAuth)}
            style={{
              padding: '0.8rem 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              borderBottom: showAuth ? '1px solid rgba(255,255,255,0.08)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGradLogin)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <defs>
                  <linearGradient id="cloudGradLogin" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#60A5FA"/>
                    <stop offset="1" stopColor="#A78BFA"/>
                  </linearGradient>
                </defs>
              </svg>
              <span style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: '0.9rem' }}>
                Sincronización en la Nube
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{showAuth ? 'Ocultar' : 'Configurar'}</span>
              <span style={{
                transform: showAuth ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                color: '#64748b',
              }}>▼</span>
            </div>
          </div>
          {showAuth && (
            <div style={{ padding: '1rem' }}>
              <Auth />
            </div>
          )}
        </div>

        <div className="login-section" style={{
          background: 'rgba(30, 41, 59, 0.6)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          overflow: 'hidden',
        }}>
          <div
            onClick={() => setShowDrive(!showDrive)}
            style={{
              padding: '0.8rem 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              borderBottom: showDrive ? '1px solid rgba(255,255,255,0.08)' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818cf8',
                fontSize: '0.75rem',
                flexShrink: 0,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z"/>
                </svg>
              </div>
              <span style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: '0.9rem' }}>
                Respaldo en Google Drive
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{showDrive ? 'Ocultar' : 'Configurar'}</span>
              <span style={{
                transform: showDrive ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                color: '#64748b',
              }}>▼</span>
            </div>
          </div>
          {showDrive && (
            <div style={{ padding: '1rem' }}>
              {driveConnected ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>☁️</div>
                  <div style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 'bold' }}>✓ Cuenta Vinculada</div>
                  {driveUserEmail && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>{driveUserEmail}</div>
                  )}
                  <button
                    onClick={handleDriveDisconnect}
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.5rem 1rem',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                    }}
                  >
                    Desvincular Cuenta
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>☁️</div>
                  <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: '0 0 1rem 0' }}>
                    Vincula tu cuenta de Google para activar los respaldos automáticos en la nube.
                  </p>
                  <button
                    onClick={handleDriveConnect}
                    disabled={driveLoading}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: '#6366f1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: 'bold',
                      fontSize: '0.9rem',
                      cursor: driveLoading ? 'not-allowed' : 'pointer',
                      opacity: driveLoading ? 0.7 : 1,
                    }}
                  >
                    {driveLoading ? 'Esperando autorización...' : 'Iniciar Sesión con Google'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="login-section">
          <button
            onClick={handleContinue}
            style={{
              width: '100%',
              padding: '1rem',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontWeight: 'bold',
              fontSize: '1.05rem',
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(16, 185, 129, 0.3)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 24px rgba(16, 185, 129, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(16, 185, 129, 0.3)';
            }}
          >
            Continuar a la App
          </button>
          <p style={{
            textAlign: 'center',
            color: '#64748b',
            fontSize: '0.75rem',
            marginTop: '0.5rem',
            marginBottom: 0,
          }}>
            Puedes configurar ambas opciones más tarde desde Ajustes
          </p>
        </div>
      </div>
    </div>
  );
}
