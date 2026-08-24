import { mount } from "svelte";
import App from "./App.svelte";
import "./App.css";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";

const init = async () => {
  const currentWindow = getCurrentWebviewWindow();
  console.log("Iniciando aplicación en ventana:", currentWindow.label);

  // Android: bloquear gestos de pinch-zoom (2+ dedos) en cualquier página
  if (/Android/i.test(navigator.userAgent)) {
    const bloquearMultitouch = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    document.addEventListener("touchstart", bloquearMultitouch, { passive: false, capture: true });
    document.addEventListener("touchmove", bloquearMultitouch, { passive: false, capture: true });
  }

  if (currentWindow.label === 'google-login') {
    document.getElementById("root")!.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:white;font-family:sans-serif;text-align:center;padding:20px;">
        <div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.1);border-top:4px solid #3b82f6;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:20px;"></div>
        <p style="font-size:1.1rem;font-weight:bold;">Procesando autenticación...</p>
        <p style="font-size:0.8rem;color:#94a3b8;">Esta ventana se cerrará automáticamente.</p>
        <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
      </div>
    `;

    const checkForCode = async () => {
      const fullUrl = window.location.href;
      console.log("DEBUG AUTH (Ventana): URL actual:", fullUrl);
      const match = fullUrl.match(/[?&]code=([^&#]+)/);
      const code = match ? match[1] : null;
      if (code) {
        console.log("DEBUG AUTH (Ventana): Código encontrado, emitiendo...");
        await emit("auth-code", code);
        setTimeout(() => { currentWindow.close(); }, 800);
        return true;
      }
      return false;
    };

    if (!await checkForCode()) {
      const interval = setInterval(async () => {
        if (await checkForCode()) clearInterval(interval);
      }, 500);
      setTimeout(() => clearInterval(interval), 10000);
    }
    return;
  }

  mount(App, { target: document.getElementById("root")! });
};

init();
