import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";

const init = async () => {
  const currentWindow = getCurrentWebviewWindow();
  console.log("Iniciando aplicación en ventana:", currentWindow.label);
  
  // Lógica especial para la ventana de Login
  if (currentWindow.label === 'google-login') {
    // 1. Renderizar mensaje de espera
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh',
        background: '#0f172a',
        color: 'white',
        fontFamily: 'sans-serif',
        textAlign: 'center',
        padding: '20px'
      }}>
        <div style={{ 
          width: '40px', height: '40px', 
          border: '4px solid rgba(255,255,255,0.1)', 
          borderTop: '4px solid #3b82f6', 
          borderRadius: '50%', 
          animation: 'spin 1s linear infinite',
          marginBottom: '20px'
        }}></div>
        <p style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Procesando autenticación...</p>
        <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Esta ventana se cerrará automáticamente.</p>
      </div>
    );

    // 2. Intentar capturar el código de todas las formas posibles
    const checkForCode = async () => {
      const fullUrl = window.location.href;
      console.log("DEBUG AUTH (Ventana): URL actual:", fullUrl);
      
      // Buscar 'code=' en query o fragmento
      const match = fullUrl.match(/[?&]code=([^&#]+)/);
      const code = match ? match[1] : null;
      
      if (code) {
        console.log("DEBUG AUTH (Ventana): Código encontrado, emitiendo...");
        await emit('auth-code', code);
        setTimeout(() => {
          currentWindow.close();
        }, 800);
        return true;
      }
      return false;
    };

    // Verificar inmediatamente
    if (!await checkForCode()) {
      // Si no está, esperar un poco (por si hay redirecciones internas)
      const interval = setInterval(async () => {
        if (await checkForCode()) clearInterval(interval);
      }, 500);
      
      // Timeout de seguridad para no dejar la ventana abierta siempre
      setTimeout(() => clearInterval(interval), 10000);
    }
    return;
  }

  // Carga normal de la App
  try {
    const rootElement = document.getElementById("root");
    if (!rootElement) throw new Error("No se encontró el elemento root");
    
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (error) {
    console.error("Error al renderizar:", error);
  }
};

init();
