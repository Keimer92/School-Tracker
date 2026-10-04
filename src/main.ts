import { mount } from "svelte";
import App from "./App.svelte";
import "./App.css";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { inicializarIdioma } from "./lib/i18n.svelte";

const init = async () => {
  const currentWindow = getCurrentWebviewWindow();
  console.log("Iniciando aplicación en ventana:", currentWindow.label);

  // Idioma: aplica el `<html lang>` guardado/detectado ANTES de montar nada, para
  // que el spellcheck del SO y los lectores de pantalla ya entrafen con el
  // idioma correcto en el primer render.
  inicializarIdioma();

  // Captura global de errores: un fallo de render en cualquier página dejaba la
  // ventana en negro sin decir nada. Se loguea con prefijo [Init] para que se
  // distinga de los errores de Tauri en la consola.
  window.addEventListener("error", (e) => {
    console.error("[Init] ERROR NO CAPTURADO:", e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[Init] PROMESA RECHAZADA:", e.reason);
  });

  // Android: bloquear gestos de pinch-zoom (2+ dedos) en cualquier página
  if (/Android/i.test(navigator.userAgent)) {
    const bloquearMultitouch = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    document.addEventListener("touchstart", bloquearMultitouch, { passive: false, capture: true });
    document.addEventListener("touchmove", bloquearMultitouch, { passive: false, capture: true });
  }

  // Bloquea la selección/copia accidental en la interfaz. El CSS (App.css)
  // desactiva la selección, pero no el menú contextual del clic derecho ni el
  // arrastre de texto, que hay que cortar por JS. Se exceptúan los campos
  // editables para no impedir pegar un valor con Ctrl+V.
  const esEditable = (el: EventTarget | null) =>
    !!(el as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]');

  document.addEventListener("selectstart", (e) => {
    if (!esEditable(e.target)) e.preventDefault();
  });
  document.addEventListener("contextmenu", (e) => {
    if (!esEditable(e.target)) e.preventDefault();
  });
  document.addEventListener("dragstart", (e) => {
    if (!esEditable(e.target)) e.preventDefault();
  });

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

  try {
    mount(App, { target: document.getElementById("root")! });
  } catch (e) {
    console.error("[Init] falló el montaje de la app:", e);
  }
};

init();
