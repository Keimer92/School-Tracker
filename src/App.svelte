<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, emit } from "@tauri-apps/api/event";
  import { restoreTursoClient } from "./lib/tursoClient";
  import { syncService } from "./lib/syncService";
  import { runAutomaticGoogleDriveBackupIfNeeded } from "./lib/googleDriveBackupService";
  import AsistenciaPage from "./svelte/AsistenciaPage.svelte";
  import InformePage from "./svelte/InformePage.svelte";
  import NotasPage from "./svelte/NotasPage.svelte";
  import ReportesPage from "./svelte/ReportesPage.svelte";
  import EvaluacionesPage from "./svelte/EvaluacionesPage.svelte";
  import EstudiantesPage from "./svelte/EstudiantesPage.svelte";
  import GlobalesPage from "./svelte/GlobalesPage.svelte";
  import AjustesPage from "./svelte/AjustesPage.svelte";
  import CloudPage from "./svelte/CloudPage.svelte";

  type Tab = "notas" | "reportes" | "estudiantes" | "evaluaciones" | "globales" | "ajustes" | "asistencia" | "informe" | "cloud";

  let isMobile = $state(false);
  let activeTab = $state<Tab>("asistencia");
  let visitedTabs = $state<Set<Tab>>(new Set(["notas", "reportes", "estudiantes", "evaluaciones", "globales", "ajustes", "asistencia", "informe", "cloud"]));
  let sidebarWidth = $state(260);
  let drawerOpen = $state(false);
  let isResizing = $state(false);
  let toast: { message: string; type: string; isOpen: boolean } = $state({ message: "", type: "info", isOpen: false });
  let unlisten: (() => void)[] = [];

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

  onMount(() => {
    checkMobile();
    const saved = localStorage.getItem("active-tab") as Tab | null;
    if (saved) activeTab = saved;
    const w = localStorage.getItem("sidebar-width");
    if (w) sidebarWidth = parseInt(w);
    const visits = localStorage.getItem("visited-tabs");
    if (visits) { try { visitedTabs = new Set(JSON.parse(visits)); } catch {} }
    const savedTheme = localStorage.getItem("app-theme") || "mint";
    document.documentElement.setAttribute("data-theme", savedTheme);

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

  <nav
    class="sidebar {isMobile ? 'drawer' : ''} {drawerOpen ? 'open' : ''}"
    onclick={(e) => e.stopPropagation()}
    style="pointer-events: auto;"
  >
    <div class="sidebar-header-integrated">
      <div class="mode-badge">
        <span class="glow-icon-notas">📚</span>
        <div class="mode-info">
          <span class="mode-label">SCHOOL</span>
          <div class="mode-name-line">
            <span class="mode-name">TRACKER</span>
            <span class="mode-pro">PRO</span>
          </div>
        </div>
      </div>
      {#if isMobile}
        <button class="drawer-close-btn" onclick={closeDrawer}>✕</button>
      {/if}
    </div>
    <div class="sidebar-nav">
      <div class="sidebar-section-header">ASISTENCIA</div>
      <button class="sidebar-button {activeTab === 'asistencia' ? 'active' : ''}" onclick={() => handleTabChange('asistencia')} type="button">
        <span>📅</span><span>Asistencia</span>
      </button>
      <button class="sidebar-button {activeTab === 'informe' ? 'active' : ''}" onclick={() => handleTabChange('informe')} type="button">
        <span>📊</span><span>Informe</span>
      </button>

      <div class="sidebar-section-header">NOTAS</div>
      <button class="sidebar-button {activeTab === 'notas' ? 'active' : ''}" onclick={() => handleTabChange('notas')} type="button">
        <span>📓</span><span>Notas</span>
      </button>
      <button class="sidebar-button {activeTab === 'reportes' ? 'active' : ''}" onclick={() => handleTabChange('reportes')} type="button">
        <span>📋</span><span>Reportes</span>
      </button>
      <button class="sidebar-button {activeTab === 'evaluaciones' ? 'active' : ''}" onclick={() => handleTabChange('evaluaciones')} type="button">
        <span>📝</span><span>Evaluaciones</span>
      </button>
      <button class="sidebar-button {activeTab === 'estudiantes' ? 'active' : ''}" onclick={() => handleTabChange('estudiantes')} type="button">
        <span>👨‍🎓</span><span>Estudiantes</span>
      </button>

      <div class="sidebar-section-header">GENERALES</div>
      <button class="sidebar-button {activeTab === 'globales' ? 'active' : ''}" onclick={() => handleTabChange('globales')} type="button">
        <span>🌐</span><span>Globales</span>
      </button>
      <button class="sidebar-button {activeTab === 'cloud' ? 'active' : ''}" onclick={() => handleTabChange('cloud')} type="button">
        <span>☁️</span><span>Nube</span>
      </button>
      <button class="sidebar-button {activeTab === 'ajustes' ? 'active' : ''}" onclick={() => handleTabChange('ajustes')} type="button">
        <span>⚙️</span><span>Ajustes</span>
      </button>
    </div>
  </nav>

    <div
      class="resizer {isResizing ? 'resizing' : ''}"
      onmousedown={startResize}
    ></div>

  <main class="main-content">
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
      <div style="display: {activeTab === 'cloud' ? 'block' : 'none'}; width: 100%; height: 100%;"><CloudPage /></div>
    {/if}
    {#if visitedTabs.has('ajustes')}
      <div style="display: {activeTab === 'ajustes' ? 'block' : 'none'}; width: 100%; height: 100%;"><AjustesPage /></div>
    {/if}
  </main>

  {#if toast.isOpen}
    <div class="toast-notification {toast.type}">{toast.message}</div>
  {/if}
</div>
