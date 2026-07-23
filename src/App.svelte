<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, emit } from "@tauri-apps/api/event";
  import { restoreTursoClient } from "./lib/tursoClient";
  import { syncService } from "./lib/syncService";
  import { runAutomaticGoogleDriveBackupIfNeeded } from "./lib/googleDriveBackupService";
  import { markAllDirty } from "./lib/dirtyTracker";
  import AsistenciaPage from "./svelte/AsistenciaPage.svelte";
  import InformePage from "./svelte/InformePage.svelte";
  import NotasPage from "./svelte/NotasPage.svelte";
  import ReportesPage from "./svelte/ReportesPage.svelte";
  import EvaluacionesPage from "./svelte/EvaluacionesPage.svelte";
  import EstudiantesPage from "./svelte/EstudiantesPage.svelte";
  import GlobalesPage from "./svelte/GlobalesPage.svelte";
  import AjustesPage from "./svelte/AjustesPage.svelte";
  import CloudPage from "./svelte/CloudPage.svelte";
  import DashboardPage from "./svelte/DashboardPage.svelte";
  import Sidebar from "./svelte/Sidebar.svelte";

  type Tab = "dashboard" | "notas" | "reportes" | "estudiantes" | "evaluaciones" | "globales" | "ajustes" | "asistencia" | "informe" | "cloud";

  let isMobile = $state(false);
  let activeTab = $state<Tab>("dashboard");
  let visitedTabs = $state<Set<Tab>>(new Set(["dashboard", "notas", "reportes", "estudiantes", "evaluaciones", "globales", "ajustes", "asistencia", "informe", "cloud"]));
  let sidebarWidth = $state(Math.min(Math.max(220, Math.floor(window.innerWidth * 0.16)), 260));
  let drawerOpen = $state(false);
  let isResizing = $state(false);
  let toast: { message: string; type: string; isOpen: boolean } = $state({ message: "", type: "info", isOpen: false });
  let unlisten: (() => void)[] = [];

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

  function checkMobile() {
    isMobile = window.innerWidth <= 768 || /Android/i.test(navigator.userAgent);
  }

  function saveSidebarWidth(val: number) {
    sidebarWidth = val;
    localStorage.setItem("sidebar-width", String(val));
  }

  function handleTabChange(tab: Tab) {
    activeTab = tab;
    visitedTabs.add(tab);
    localStorage.setItem("active-tab", tab);
    localStorage.setItem("visited-tabs", JSON.stringify(Array.from(visitedTabs)));
    if (isMobile) drawerOpen = false;
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

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    onDestroy(() => window.removeEventListener('keydown', handleKeyDown));
    checkMobile();
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

    // Turso init
    const client = restoreTursoClient();
    if (client) {
      markAllDirty();
      syncService.ensurePeriodicSync();
      client.execute("SELECT COUNT(*) as count FROM ano_lectivo")
        .then((result: any) => {
          const count = result.rows[0]?.count as number || 0;
          if (count > 0) syncService.pullAllSilent();
          else invoke("seed_defaults_now");
        })
        .catch(() => invoke("seed_defaults_now"));
    } else {
      invoke("seed_defaults_now");
    }

    // Google Drive scheduler
    setTimeout(() => runAutomaticGoogleDriveBackupIfNeeded(), 10000);
    const interval = setInterval(() => runAutomaticGoogleDriveBackupIfNeeded(), 300000);
    unlisten.push(() => clearInterval(interval));
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

<div
  class="app-layout"
  style="grid-template-columns: {isMobile ? '0px 0px 1fr' : sidebarWidth + 'px 4px 1fr'}; padding-bottom: {isMobile ? 'env(safe-area-inset-bottom, 0px)' : '0'};"
>
  {#if isMobile}
    <div class="mobile-header">
      {#if !drawerOpen}
        <button class="mobile-menu-btn" onclick={toggleDrawer}><span>☰</span></button>
      {/if}
      <span class="mobile-title">School Tracker</span>
    </div>
  {/if}
  {#if isMobile && drawerOpen}
    <div class="drawer-backdrop" onclick={closeDrawer}></div>
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
      <div style="display: {activeTab === 'globales' ? 'block' : 'none'}; width: 100%; height: 100%;"><GlobalesPage /></div>
    {/if}
    {#if visitedTabs.has('cloud')}
      <div style="display: {activeTab === 'cloud' ? 'block' : 'none'}; width: 100%; height: 100%;"><CloudPage activeTab={activeTab} /></div>
    {/if}
    {#if visitedTabs.has('ajustes')}
      <div style="display: {activeTab === 'ajustes' ? 'block' : 'none'}; width: 100%; height: 100%;"><AjustesPage {themeMode} {setThemeMode} /></div>
    {/if}
  </main>

  {#if toast.isOpen}
    <div class="toast-notification {toast.type}">{toast.message}</div>
  {/if}
</div>
