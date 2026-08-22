<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, emit } from "@tauri-apps/api/event";
  import { onBackButtonPress } from "@tauri-apps/api/app";
  import { handleBack, isBackAuthInProgress, setBackAuthInProgress } from "./lib/androidBack";
  import { syncService } from "./lib/syncService";
  import { isD1Configured } from "./lib/syncService";
  import { driveSyncService } from "./lib/driveSyncService";
  import { getLocalDateISOString } from "./lib/dateUtils";
  import AsistenciaPage from "./svelte/AsistenciaPage.svelte";
  import InformePage from "./svelte/InformePage.svelte";
  import NotasPage from "./svelte/NotasPage.svelte";
  import ReportesPage from "./svelte/ReportesPage.svelte";
  import EvaluacionesPage from "./svelte/EvaluacionesPage.svelte";
  import EstudiantesPage from "./svelte/EstudiantesPage.svelte";
  import GlobalesPage from "./svelte/GlobalesPage.svelte";
  import AjustesPage from "./svelte/AjustesPage.svelte";
  import DashboardPage from "./svelte/DashboardPage.svelte";
  import Sidebar from "./svelte/Sidebar.svelte";
  import CloudCards from "./svelte/CloudCards.svelte";
  import WelcomePage from "./svelte/WelcomePage.svelte";

  type Tab = "dashboard" | "notas" | "reportes" | "estudiantes" | "evaluaciones" | "globales" | "ajustes" | "asistencia" | "informe" | "cloud";

  let initialized = $state<boolean | null>(null);
  let isMobile = $state(false);
  let isAndroid = $state(false);
  let activeTab = $state<Tab>("dashboard");
  let visitedTabs = $state<Set<Tab>>(new Set(["dashboard", "notas", "reportes", "estudiantes", "evaluaciones", "globales", "ajustes", "asistencia", "informe", "cloud"]));
  let sidebarWidth = $state(Math.min(Math.max(220, Math.floor(window.innerWidth * 0.16)), 260));
  let drawerOpen = $state(false);
  let isResizing = $state(false);
  let toast: { message: string; type: string; isOpen: boolean } = $state({ message: "", type: "info", isOpen: false });
  let unlisten: (() => void)[] = [];
  let ajustesTabRequest = $state<string | null>(null);

  // Theme state: "claro" | "oscuro" | "sistema"
  let themeMode = $state(localStorage.getItem("app-theme") || "sistema");

  const oldThemeMap: Record<string, string> = {
    mint: "oscuro", carmesi: "oscuro", amarillo: "oscuro",
    rosado: "oscuro", azul: "oscuro", oscuro: "oscuro",
    claro: "claro",
  };

  function resolveTheme(mode: string): string {
    const normalized = oldThemeMap[mode] || mode;
    if (normalized === "sistema") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return normalized === "claro" ? "light" : "dark";
  }

  function applyTheme(mode: string) {
    const resolved = resolveTheme(mode);
    document.documentElement.setAttribute("data-theme", resolved);
    localStorage.setItem("app-theme", mode);
  }

  function setThemeMode(mode: string) {
    themeMode = mode;
    applyTheme(mode);
  }

  $effect(() => {
    applyTheme(themeMode);
  });

  $effect(() => {
    document.documentElement.classList.toggle("is-android", isAndroid);
  });

  function checkMobile() {
    isMobile = window.innerWidth <= 768 || /Android/i.test(navigator.userAgent);
    isAndroid = /Android/i.test(navigator.userAgent);
  }

  async function checkAttendanceReminder() {
    try {
      const NOTIF_STORAGE_KEY = 'stp_attendance_notif_settings';
      let stored: any = null;
      try { stored = JSON.parse(localStorage.getItem(NOTIF_STORAGE_KEY) || "null"); } catch {}

      // Config no guardada o desactivada → no avisar.
      if (!stored || !stored.enabled) return;

      // Si la hora configurada aún no pasó, no avisar al abrir (la alarma lo hará).
      if (stored.hora) {
        const now = new Date();
        const [h, m] = String(stored.hora).split(":").map(Number);
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const cfgMin = (h || 0) * 60 + (m || 0);
        if (nowMin < cfgMin) return;
      }

      // No avisar al abrir si el día está silenciado.
      const silenced = await invoke<boolean>("get_attendance_silenced_today").catch(() => false);
      if (silenced) return;

      const colegios = Array.isArray(stored.colegios) && stored.colegios.length ? stored.colegios : [];
      const grados = Array.isArray(stored.grados) ? stored.grados : [];
      const secciones = Array.isArray(stored.secciones) ? stored.secciones : [];

      const fecha = getLocalDateISOString();
      const pendientes = await invoke<{ grado: string; seccion: string }[]>(
        "get_pendientes_asistencia_filtrados",
        { colegios, grados, secciones, fecha }
      );
      if (!pendientes || pendientes.length === 0) return;

      const lista = pendientes.slice(0, 5).map(p => `${p.grado} ${p.seccion}`).join(", ");
      const resto = pendientes.length > 5 ? ` y ${pendientes.length - 5} más` : "";
      await invoke("notify_attendance_reminder", {
        title: "Asistencia pendiente",
        body: `Sin asistencia hoy: ${lista}${resto}`,
      });
    } catch (e) {
      console.error("Error al verificar asistencias pendientes:", e);
    }
  }

  function saveSidebarWidth(val: number) {
    sidebarWidth = val;
    localStorage.setItem("sidebar-width", String(val));
  }

  function setActiveTab(tab: Tab) {
    activeTab = tab;
    visitedTabs.add(tab);
    localStorage.setItem("active-tab", tab);
    localStorage.setItem("visited-tabs", JSON.stringify(Array.from(visitedTabs)));
  }

  function handleTabChange(tab: Tab) {
    if (tab === "cloud") {
      ajustesTabRequest = "nube";
      setActiveTab("ajustes");
      if (isMobile) drawerOpen = false;
      return;
    }
    ajustesTabRequest = null;
    setActiveTab(tab);
    if (isMobile) drawerOpen = false;
  }

  async function goBack() {
    if (handleBack()) return;
    if (isBackAuthInProgress()) {
      setBackAuthInProgress(false);
      try { await invoke("gd_cancel_oauth"); } catch {}
      return;
    }
    if (drawerOpen) {
      closeDrawer();
      return;
    }
    showToast("No hay más páginas atrás", "info");
  }

  function showToast(message: string, type: "success" | "error" | "info" = "success") {
    toast = { message, type, isOpen: true };
    setTimeout(() => { toast = { ...toast, isOpen: false }; }, 3000);
  }

  function toggleDrawer() { drawerOpen = !drawerOpen; }
  function closeDrawer() { drawerOpen = false; }

  function startResize(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
  }

  function stopResize() {
    isResizing = false;
  }

  function onResize(e: MouseEvent) {
    if (isResizing) {
      const w = e.clientX;
      if (w > 180 && w < 450) saveSidebarWidth(w);
    }
  }

  function applySafeAreas() {
    const windowHeight = window.innerHeight;
    const visualHeight = window.visualViewport?.height || windowHeight;
    const offsetTop = window.visualViewport?.offsetTop || 0;
    const bottomInset = Math.max(0, windowHeight - visualHeight - offsetTop);
    const topInset = Math.max(0, offsetTop);
    document.body.style.setProperty("--system-bottom", `${bottomInset}px`);
    document.body.style.setProperty("--system-top", `${topInset}px`);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.metaKey && e.key === 'r')) {
      e.preventDefault();
      window.location.reload();
    }
    if (e.key === 'F12') {
      e.preventDefault();
    }
  }

  onMount(async () => {
    window.addEventListener('keydown', handleKeyDown);
    onDestroy(() => window.removeEventListener('keydown', handleKeyDown));
    checkMobile();

    // Back button Android: enruta el back al JS (AppPlugin no cierra la app).
    // Solo en Android: plugin:app|register_listener solo existe en la plataforma móvil.
    if (isAndroid) {
      try {
        const backListener = await onBackButtonPress(() => { goBack(); });
        unlisten.push(() => backListener.unregister());
      } catch (e) {
        console.error('Error al registrar onBackButtonPress:', e);
      }
    }

    // Check if app has been initialized (welcomed)
    const init = await invoke('is_app_initialized');
    initialized = init;

    if (init) {
      // Existing init logic only runs if already initialized
      const saved = localStorage.getItem("active-tab") as Tab | null;
      if (saved) activeTab = saved;
      const w = localStorage.getItem("sidebar-width");
      if (w) sidebarWidth = parseInt(w);
      const visits = localStorage.getItem("visited-tabs");
      if (visits) { try { visitedTabs = new Set(JSON.parse(visits)); } catch {} }
      const savedMode = localStorage.getItem("app-theme") || "sistema";
      themeMode = savedMode;
      applyTheme(savedMode);

      // Listen for system theme changes
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const systemHandler = () => {
        if (themeMode === "sistema") {
          applyTheme("sistema");
        }
      };
      mediaQuery.addEventListener("change", systemHandler);
      unlisten.push(() => mediaQuery.removeEventListener("change", systemHandler));

      // Safe areas
      if (isMobile) {
        applySafeAreas();
        if (window.visualViewport) {
          window.visualViewport.addEventListener("resize", applySafeAreas);
          window.addEventListener("resize", applySafeAreas);
        }
      }

      // Window resize for mobile detection
      window.addEventListener("resize", checkMobile);
      window.addEventListener("mousemove", onResize);
      window.addEventListener("mouseup", stopResize);

      // Toast listener
      listen("show-toast", (event: any) => {
        showToast(event.payload.message, event.payload.type);
      }).then(u => unlisten.push(u));

      // Sincronización automática SOLO con Cloudflare D1 (si está configurado).
      // Google Drive: respaldo automático (push) cada N minutos + manual desde CloudPage.
      driveSyncService.ensureAutoBackup();
      isD1Configured().then((d1) => {
        if (d1) {
          syncService.syncAllSilent();
          syncService.ensurePeriodicSync();
        }
      });
      invoke("seed_defaults_now");

      // Notificación Android: grados/secciones sin asistencia hoy (solo si colegio laborable).
      if (isAndroid) {
        checkAttendanceReminder();
      }
    }

    // Listen for welcome complete event (from WelcomePage)
    const welcomeListener = listen('welcome-complete', async () => {
      initialized = true;
      driveSyncService.ensureAutoBackup();
      if (await isD1Configured()) {
        syncService.syncAllSilent();
        syncService.ensurePeriodicSync();
      }
    });
    welcomeListener.then(u => unlisten.push(u));
  });

  onDestroy(() => {
    unlisten.forEach(u => u());
    window.removeEventListener("resize", checkMobile);
    window.removeEventListener("mousemove", onResize);
    window.removeEventListener("mouseup", stopResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", applySafeAreas);
      window.removeEventListener("resize", applySafeAreas);
    }
  });
</script>

{#if initialized === null}
<div class="app-loading-screen">
  <div class="app-loading-card">
    <div class="loader-spinner"></div>
    <p class="loader-text">School Tracker</p>
  </div>
</div>
{:else if initialized}
<div
  class="app-layout"
  style="grid-template-columns: {isMobile ? '0px 0px 1fr' : sidebarWidth + 'px 4px 1fr'}; padding-bottom: {isMobile ? 'env(safe-area-inset-bottom, 0px)' : '0'};"
>
  {#if isMobile}
      <div class="mobile-header">
        <button class="mobile-menu-btn {drawerOpen ? 'hidden' : ''}" onclick={toggleDrawer}><span>☰</span></button>
        <span class="mobile-title">School Tracker</span>
        <CloudCards compact onTabChange={(t) => handleTabChange(t as Tab)} />
      </div>
  {/if}
  {#if isMobile}
    <div class="drawer-backdrop {drawerOpen ? '' : 'closed'}" onclick={closeDrawer}></div>
  {/if}

    <Sidebar
      {activeTab}
      {drawerOpen}
      {isMobile}
      {themeMode}
      setThemeMode={setThemeMode}
      onTabChange={handleTabChange}
      toggleDrawer={toggleDrawer}
      on:closeDrawer={closeDrawer}
    />

    <div
      class="resizer {isResizing ? 'resizing' : ''}"
      onmousedown={startResize}
    ></div>

  <main class="main-content">
    {#if visitedTabs.has('dashboard')}
      <div style="display: {activeTab === 'dashboard' ? 'block' : 'none'}; width: 100%; height: 100%;"><DashboardPage onNavigate={handleTabChange} /></div>
    {/if}
    {#if visitedTabs.has('asistencia')}
      <div style="display: {activeTab === 'asistencia' ? 'block' : 'none'}; width: 100%; height: 100%;"><AsistenciaPage /></div>
    {/if}
    {#if visitedTabs.has('informe')}
      <div style="display: {activeTab === 'informe' ? 'block' : 'none'}; width: 100%; height: 100%;"><InformePage /></div>
    {/if}
    {#if visitedTabs.has('notas')}
      <div style="display: {activeTab === 'notas' ? 'block' : 'none'}; width: 100%; height: 100%;"><NotasPage /></div>
    {/if}
    {#if visitedTabs.has('reportes')}
      <div style="display: {activeTab === 'reportes' ? 'block' : 'none'}; width: 100%; height: 100%;"><ReportesPage /></div>
    {/if}
    {#if visitedTabs.has('evaluaciones')}
      <div style="display: {activeTab === 'evaluaciones' ? 'block' : 'none'}; width: 100%; height: 100%;"><EvaluacionesPage /></div>
    {/if}
    {#if visitedTabs.has('estudiantes')}
      <div style="display: {activeTab === 'estudiantes' ? 'block' : 'none'}; width: 100%; height: 100%;"><EstudiantesPage /></div>
    {/if}
    {#if visitedTabs.has('globales')}
      <div style="display: {activeTab === 'globales' ? 'block' : 'none'}; width: 100%; height: 100%;"><GlobalesPage pageActive={activeTab === 'globales'} /></div>
    {/if}
    {#if visitedTabs.has('ajustes')}
      <div style="display: {activeTab === 'ajustes' ? 'block' : 'none'}; width: 100%; height: 100%;"><AjustesPage pageActive={activeTab === 'ajustes'} tabRequest={ajustesTabRequest} {themeMode} {setThemeMode} /></div>
    {/if}
  </main>

  {#if toast.isOpen}
    <div class="toast-notification {toast.type}">{toast.message}</div>
  {/if}
</div>
{:else}
  <WelcomePage />
{/if}
