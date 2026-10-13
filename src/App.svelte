<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, emit } from "@tauri-apps/api/event";
  import { onBackButtonPress } from "@tauri-apps/api/app";
  import { handleBack, isBackAuthInProgress, setBackAuthInProgress } from "./lib/androidBack";
  import { syncService } from "./lib/syncService";
  import { isD1Configured, d1SyncManager } from "./lib/syncService";
  import { driveSyncService, ensureDriveSession, ensureDriveAccountEmail } from "./lib/driveSyncService";
  import { driveAutoBackup } from "./lib/driveAutoBackup";
  import { ensureWsSync, stopWsSync } from "./lib/wsSyncService";
  import { loadAppSettings, saveAppSettings, getAppSettings, onAppSettingsChange } from "./lib/appSettings";
  import { aplicarColoresSexo } from "./lib/coloresSexo.svelte";
  import { applyAccentColor, DEFAULT_ACCENT } from "./lib/theme";
  import { getLocalDateISOString } from "./lib/dateUtils";
  import { t } from "./lib/i18n.svelte";
  import appIcon from "./assets/app-icon.png";
  import AsistenciaMainPage from "./svelte/asistencia/AsistenciaMainPage.svelte";
  import NotasMainPage from "./svelte/notas/NotasMainPage.svelte";
  import EstudiantesPage from "./svelte/EstudiantesPage.svelte";
  import ConfiguracionPage from "./svelte/ConfiguracionPage.svelte";

  import DashboardPage from "./svelte/DashboardPage.svelte";
  import Sidebar from "./svelte/Sidebar.svelte";
  import WelcomePage from "./svelte/WelcomePage.svelte";
  import AndroidDrawer from "./svelte/AndroidDrawer.svelte";
  import ModalNubeD1 from "./svelte/modales/ModalNubeD1.svelte";
  import ModalNubeDrive from "./svelte/modales/ModalNubeDrive.svelte";

  type Tab = "dashboard" | "notas" | "estudiantes" | "ajustes" | "asistencia";

  // Every page mounts from startup; `visitedTabs` only keeps the history so it
  // can be rehydrated without flickering. It must always include the active tab
  // or its block is not rendered and the content area stays empty.
  // The cloud (Cloudflare D1 + Drive) is no longer a tab: it lives in modals
  // opened from the sidebar cards / Android header chips. The Cuenta page is gone.
  const DEFAULT_TABS: Tab[] = ["dashboard", "notas", "estudiantes", "ajustes", "asistencia"];

  /** ¿El string recibido corresponde a una tab vigente? */
  function esTabValida(v: string): v is Tab {
    return (DEFAULT_TABS as string[]).includes(v);
  }

  let initialized = $state<boolean | null>(null);
  let isMobile = $state(false);
  let isAndroid = $state(false);
  let activeTab = $state<Tab>("dashboard");
  let visitedTabs = $state<Set<Tab>>(new Set(DEFAULT_TABS));
  let sidebarWidth = $state(Math.min(Math.max(220, Math.floor(window.innerWidth * 0.16)), 260));
  let drawerOpen = $state(false);
  let isResizing = $state(false);
  let toast: { message: string; type: string; isOpen: boolean } = $state({ message: "", type: "info", isOpen: false });
  let unlisten: (() => void)[] = [];
  /** Sección de Configuración abierta (deep-link). */
  let ajustesSeccion = $state<string>('evaluaciones');

  /** Sección que se abre al entrar a Ajustes sin deep-link. */
  const SECCION_AJUSTES_POR_DEFECTO = 'evaluaciones';

  /** Legacy tab names that became sections of the Ajustes rail. */
  const TAB_A_SECCION_AJUSTES: Record<string, string> = {
    cloud: 'general', account: 'general', evaluaciones: 'evaluaciones',
  };

  // Estado de sync D1 para el chip del header móvil
  let d1Status = $state<string>((d1SyncManager.getState() as { status?: string })?.status ?? 'idle');
  $effect(() => {
    const unsub = d1SyncManager.subscribe((s: unknown) => {
      d1Status = (s as { status?: string })?.status ?? 'idle';
    });
    return () => unsub();
  });
  let asistenciaSubTabRequest = $state<string | null>(null);
  let notasSubTabRequest = $state<string | null>(null);

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
    applyAccentColor(getAppSettings().accentColor || DEFAULT_ACCENT);
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

  /**
   * Navegación central. Acepta `string` y no `Tab` a propósito: los
   * quick-actions del Dashboard y varios `onNavigate` siguen pasando nombres
   * históricos ("reportes", "informe", "cloud"…) que se redirigen más abajo.
   * Declarationar `Tab` obligaba a castear en cada comparación.
   */
  function handleTabChange(tab: string) {
    // Migración: el quick-action "Reportes" del Dashboard abre la página unificada en su sub-tab Reportes
    if (tab === "reportes") {
      notasSubTabRequest = "reportes";
      setActiveTab("notas");
      if (isMobile) drawerOpen = false;
      return;
    }
    // Migración: el quick-action "Informe" del Dashboard abre la página unificada en su sub-tab Informe
    if (tab === "informe") {
      asistenciaSubTabRequest = "informe";
      setActiveTab("asistencia");
      if (isMobile) drawerOpen = false;
      return;
    }
    // Evaluaciones ya no es tab: es una sección del rail de Ajustes. Cualquier
    // llamador legado (páginas) que aún pida ese destino aterriza en Ajustes con
    // la sección equivalente. Nube y Cuenta ya no tienen destino: el primero son
    // modales (`abrirNube`), el segundo se eliminó.
    const seccionAjustes = TAB_A_SECCION_AJUSTES[tab];
    if (seccionAjustes) {
      ajustesSeccion = seccionAjustes;
      setActiveTab("ajustes");
      if (isMobile) drawerOpen = false;
      return;
    }
    if (!esTabValida(tab)) {
      // Destino desconocido: no se cambia de pestaña en vez de dejar la app
      // apuntando a una tab inexistente.
      return;
    }
    // Entrada normal a Ajustes (barra lateral): se abre la sección por defecto.
    // Los deep-links llegan por otra vía y conservan la sección pedida.
    if (tab === "ajustes") ajustesSeccion = SECCION_AJUSTES_POR_DEFECTO;
    asistenciaSubTabRequest = null;
    notasSubTabRequest = null;
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
    showToast(t("app.sinAtras"), "info");
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
    // En desktop, Escape cierra el modal/dialogo superior. Se delega a handleBack(),
    // que recorre la pila de back-handlers registrados por cada modal al abrirse
    // (misma pila que el botón "atrás" de Android). Así SE CIERRA CUALQUIER MODAL
    // de CUALQUIER página, sin importar su clase/markup, siempre que registre su cierre.
    if (e.key === 'Escape' && !isAndroid) {
      handleBack();
    }
  }

  /**
   * Un fallo en cualquier await del arranque dejaba `initialized` en null y la
   * ventana girando en el splash para siempre, sin decir nada. Este catch
   * garantiza que la app entre igual y registre la causa.
   */
  onMount(() => {
    // El listener se registra acá, en la parte SINCRÓNICA del onMount, y el
    // cleanup se devuelve como retorno. Antes se deregistraba desde dentro de
    // `iniciar()` con `onDestroy(...)`, lo cual solo funcionaba por casualidad:
    // mientras no hubiera un `await` antes, el cuerpo síncrono de `iniciar()`
    // aún corre dentro del ciclo de vida del componente. Al primer `await`
    // se habría lanzado `lifecycle_outside_component`.
    window.addEventListener('keydown', handleKeyDown);
    void iniciar();
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  async function iniciar() {
   try {
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
    let init = false;
    try {
      init = await invoke('is_app_initialized');
    } catch (e) {
      console.error('[Init] is_app_initialized falló', e);
    }
    initialized = init;

    if (init) {
      // Existing init logic only runs if already initialized
      // Se lee como `string` y no como `Tab`: el valor persistido puede ser un
      // nombre de tab de una versión anterior, y castearlo a `Tab` antes de
      // comparar hacía que TypeScript viera las migraciones como imposibles.
      const saved = localStorage.getItem("active-tab");
      const esTabActual = (v: string): v is Tab => (DEFAULT_TABS as string[]).includes(v);
      // Migraciones: páginas fusionadas como sub-tabs, y Globales→Configuración
      if (saved === "informe" || saved === "reportes") {
        const merged = saved === "informe" ? "asistencia" : "notas";
        activeTab = merged as Tab;
        localStorage.setItem("active-tab", merged);
      }
      else if (saved === "globales") {
        activeTab = "ajustes";
        localStorage.setItem("active-tab", "ajustes");
      }
      // Cloud, account and Evaluaciones stopped being tabs: the cloud became
      // modals and the Cuenta page was removed, so legacy values land on
      // Ajustes at the closest remaining section.
      else if (saved === "cloud" || saved === "account" || saved === "evaluaciones") {
        activeTab = "ajustes";
        ajustesSeccion = TAB_A_SECCION_AJUSTES[saved];
        localStorage.setItem("active-tab", "ajustes");
      }
      else if (saved && esTabActual(saved)) activeTab = saved;
      // Cualquier otro valor desconocido cae en el dashboard en vez de dejar
      // `activeTab` apuntando a una tab inexistente (pantalla vacía).
      else if (saved) { activeTab = "dashboard"; localStorage.setItem("active-tab", "dashboard"); }
      const w = localStorage.getItem("sidebar-width");
      if (w) sidebarWidth = parseInt(w);
      const visits = localStorage.getItem("visited-tabs");
      if (visits) {
        try {
          const parsed = JSON.parse(visits) as string[];
          // Migración de visited-tabs históricos: sub-tabs fusionados y
          // Globales→Configuración. Se RECONSTRUYE el Set partiendo de los
          // valores migrados + los por defecto, en vez de filtrar `parsed` pelado
          // (eso descartaba las migraciones y podía dejar el Set vacío).
          const LegacyTabMapeo: Record<string, Tab> = {
            "informe": "asistencia",
            "reportes": "notas",
            "globales": "ajustes",
            "cloud": "ajustes",
            "account": "ajustes",
            "evaluaciones": "ajustes",
          };
          const migrados = new Set<Tab>(DEFAULT_TABS);
          for (const t of parsed) {
            if (typeof t !== "string") continue;
            const destino = LegacyTabMapeo[t] ?? (t as Tab);
            if (DEFAULT_TABS.includes(destino as Tab)) migrados.add(destino as Tab);
          }
          visitedTabs = migrados;
          localStorage.setItem("visited-tabs", JSON.stringify(Array.from(visitedTabs)));
        } catch (e) {
          console.warn("[Init] visited-tabs ilegibles, se usan los valores por defecto:", e);
        }
      }
      // Si la tab activa quedó sin bloque renderizable, se cae a dashboard.
      if (!DEFAULT_TABS.includes(activeTab)) activeTab = "dashboard";
      const savedMode = localStorage.getItem("app-theme") || "sistema";
      themeMode = savedMode;
      applyTheme(savedMode);
      // Cargar configuraciones syncronizables y aplicar tema desde la tabla
      loadAppSettings().then(s => {
        if (s.theme && s.theme !== savedMode) {
          themeMode = s.theme;
        }
        applyTheme(themeMode);
        applyAccentColor(s.accentColor || DEFAULT_ACCENT);
        aplicarColoresSexo(s);
      });
      const unsubSettings = onAppSettingsChange(s => {
        if (s.theme && s.theme !== themeMode) {
          themeMode = s.theme;
        }
        applyTheme(themeMode);
        applyAccentColor(s.accentColor || DEFAULT_ACCENT);
        aplicarColoresSexo(s);
      });
      unlisten.push(unsubSettings);

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

      // Deep-link: cualquier página pide abrir una sección de Configuración.
      listen("open-ajustes", (event: any) => {
        const seccion = event.payload?.section;
        if (!seccion) return;
        ajustesSeccion = seccion;
        setActiveTab("ajustes");
        if (isMobile) drawerOpen = false;
      }).then(u => unlisten.push(u));

      // Sincronización automática SOLO con Cloudflare D1 (si está configurado).
      // Google Drive: automatic backup (push) every N minutes + manual from the Drive panel.
      driveSyncService.ensureAutoBackup();
      // Scheduler híbrido de Drive (timer inteligente + triggers pasivos + cuenta).
      driveAutoBackup.start();

      // Recuperar la sesion de Drive antes de que la UI la evalúe. El estado
      // "conectado" se deriva de `accessToken`, que expira cada ~1 h; si
      // expiró mientras la app estaba cerrada, sin esto la app arrancaba
      // Mostrándose desconectada hasta el primer respaldo (o para siempre si
      // el refreshToken se perdió). Es idempotente y barato si ya está vigente.
      ensureDriveSession().catch(() => {});
      // Orden importa: primero el email (de él depende el nombre del archivo de
      // Drive) y después el token. Si el email falta, accountTag() cae a
      // "default" y la app subiría un respaldo NUEVO en cada guardado.
      ensureDriveAccountEmail().catch(() => {});

      // Pull bilateral pasivo: traer cambios de otros dispositivos sin esperar
      // al timer ni generar un cambio local.
      const d1TrySync = async (source: string = 'manual') => {
        try {
          const ok = await isD1Configured();
          console.debug(`[D1Debug] sync disparado (${source}) · config=${ok}`);
          if (!ok) { stopWsSync(); return; }
          // Revivir el timer periódico si hubiera muerto (idempotente)
          syncService.ensurePeriodicSync();
          await ensureWsSync();
          await syncService.syncAllSilent();
        } catch (e) {
          console.error('[D1Debug] error en sync disparado:', e);
        }
      };
      const d1OnVisible = () => { if (!document.hidden) void d1TrySync('foreground'); };
      const d1OnOnline = () => void d1TrySync('online');
      document.addEventListener("visibilitychange", d1OnVisible);
      window.addEventListener("online", d1OnOnline);
      unlisten.push(() => {
        document.removeEventListener("visibilitychange", d1OnVisible);
        window.removeEventListener("online", d1OnOnline);
      });

      // ARRANQUE: sync inicial + conexión al hub WebSocket de una sola vez.
      // Sin esto, el WS no existía hasta que el usuario cambiara de ventana/página
      // y los avisos en tiempo real del otro dispositivo se perdían.
      void d1TrySync('startup');

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
   } catch (e) {
    // Sin esto la ventana queda en el splash para siempre: un `await` que
    // rechaza deja `initialized` en null y nadie ve la causa.
    console.error('[App] error fatal en el arranque', e);
    initialized = true;
   }
  }

  onDestroy(() => {
    unlisten.forEach(u => u());
    window.removeEventListener("resize", checkMobile);
    window.removeEventListener("mousemove", onResize);
    window.removeEventListener("mouseup", stopResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", applySafeAreas);
      window.removeEventListener("resize", applySafeAreas);
    }
    driveAutoBackup.stop();
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
    <AndroidDrawer
      {drawerOpen}
      {d1Status}
      {toggleDrawer}
      {closeDrawer}
    />
  {/if}

    <Sidebar
      {activeTab}
      {drawerOpen}
      {isMobile}
      {themeMode}
      setThemeMode={setThemeMode}
      onTabChange={handleTabChange}
      toggleDrawer={toggleDrawer}
      onDrawerClose={closeDrawer}
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
      <div style="display: {activeTab === 'asistencia' ? 'block' : 'none'}; width: 100%; height: 100%;"><AsistenciaMainPage pageActive={activeTab === 'asistencia'} subTabRequest={asistenciaSubTabRequest} /></div>
    {/if}
    {#if visitedTabs.has('notas')}
      <div style="display: {activeTab === 'notas' ? 'block' : 'none'}; width: 100%; height: 100%;"><NotasMainPage pageActive={activeTab === 'notas'} subTabRequest={notasSubTabRequest} /></div>
    {/if}
    {#if visitedTabs.has('estudiantes')}
      <div style="display: {activeTab === 'estudiantes' ? 'block' : 'none'}; width: 100%; height: 100%;"><EstudiantesPage /></div>
    {/if}
    {#if visitedTabs.has('ajustes')}
      <div style="display: {activeTab === 'ajustes' ? 'block' : 'none'}; width: 100%; height: 100%;"><ConfiguracionPage pageActive={activeTab === 'ajustes'} bind:seccion={ajustesSeccion} {themeMode} {setThemeMode} /></div>
    {/if}
  </main>

  {#if toast.isOpen}
    <div class="toast-notification {toast.type}">{toast.message}</div>
  {/if}
</div>

<!--
  Cloud panels (Cloudflare D1 + Drive), mounted ONCE for the whole app.

  They are opened with `openCloudPanel('d1' | 'drive')` from anywhere: the
  sidebar cards, the Android header chips, any future page. Mounting them here
  (instead of inside the component that triggers them) is what keeps a single
  source of truth for the Drive session and the D1 sync state; each panel renders
  nothing until it is actually open.
-->
<ModalNubeD1 />
<ModalNubeDrive />
{:else}
  <WelcomePage />
{/if}
