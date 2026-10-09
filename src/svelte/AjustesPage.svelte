<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";
  import { loadAppSettings, saveAppSettings, getAppSettings, onAppSettingsChange } from "../lib/appSettings";
  import NotificacionesPage from "./notificaciones/NotificacionesPage.svelte";
  import DebugPage from "./ajustes/DebugPage.svelte";
  import InfoPage from "./ajustes/InfoPage.svelte";
  import BrowserPicker from "./BrowserPicker.svelte";
  import LanguagePicker from "./LanguagePicker.svelte";
  import { t } from "../lib/i18n.svelte";
  import appIcon from "../assets/app-icon.png";

  function getThemeColor(color: string): string {
    return { claro: "#f1f5f9", oscuro: "#0f172a", sistema: "var(--primary-color)" }[color] || "#0f172a";
  }
  function getThemeName(color: string): string {
    // Los VALORES del tema ('claro'/'oscuro'/'sistema') no se traducen: son
    // claves que viajan al resto de la app y al sistema. Solo las etiquetas.
    return { claro: t("ajustes.tab.temaClaro"), oscuro: t("ajustes.tab.temaOscuro"), sistema: t("ajustes.tab.temaSistema") }[color] || t("ajustes.tab.temaOscuro");
  }
  function getThemeLabel(color: string): string {
    return { claro: t("ajustes.tab.temaClaro"), oscuro: t("ajustes.tab.temaOscuro"), sistema: t("ajustes.tab.temaSistema") }[color] || "";
  }

const PRESET_COLORS = ["#000000","#7f7f7f","#880015","#ed1c24","#ff7f27","#fff200","#22b14c","#00a2e8","#3f48cc","#a349a4","#ffffff","#c3c3c3","#b97a57","#ffaec9","#ffc90e","#efe4b0","#b5e61d","#99d9ea","#7092be","#c8bfe7","#C00000","#FF0000","#FFC000","#FFFF00","#92D050","#00B050","#00B0F0","#0070C0","#002060","#7030A0"];

  // `$derived` y no `const`: las etiquetas salen de `t()`, que lee el rune
  // `$state` del idioma. Con un `const` se calcularían una sola vez al importar
  // el módulo y cambiar de idioma no las actualaría nunca.
  const TABS = $derived([
    { id: "configuracion", label: t("ajustes.tab.configuracion"), icon: "⚙️" },
    { id: "notificaciones", label: t("ajustes.tab.notificaciones"), icon: "🔔", soloAndroid: true },
    { id: "debugging", label: t("ajustes.tab.debug"), icon: "🐛" },
    { id: "acercaDe", label: t("ajustes.tab.info"), icon: "📖" },
  ] as const);

  const TAB_COLORS: Record<string, string> = { configuracion: "#60a5fa", notificaciones: "#fbbf24", debugging: "#ef4444", acercaDe: "#a78bfa" };

  const isAndroid = /Android/i.test(navigator.userAgent);
  // Notificaciones de asistencia SOLO Android (usa AlarmManager nativo)
  const tabsVisibles = $derived(TABS.filter(x => isAndroid || !("soloAndroid" in x && x.soloAndroid)));

  let activeTab: typeof TABS[number]["id"] | null = $state(isAndroid ? null : "configuracion");

  $effect(() => {
    if (!pageActive || !isAndroid || soloContenido || activeTab === null) return;
    const dispose = registerBackHandler(() => { activeTab = null; return true; });
    return () => dispose();
  });
  let gradeConfigs = $state<{ id: string; nombre: string; color: string; minimo: number }[]>([]);
  let highlightColor = $state(localStorage.getItem("student-highlight-color") || "#4ade80");

  let { themeMode = "sistema", setThemeMode = () => {}, pageActive = false, tabRequest = null as string | null, seccion = null as string | null, soloContenido = false } = $props();

  /**
   * Cuando la página se monta dentro de Configuración, `soloContenido`
   * oculta la navegación propia (rail, lista de cards y grid) y muestra solo
   * la sección pedida. Fuera de ese contenedor el comportamiento no cambia:
   * escritorio muestra todas las tarjetas y Android la lista de secciones.
   */
  /**
   * `seccion` usa los ids públicos del shell (general, debug, info…); acá las
   * secciones tienen nombres propios. Esta tabla traduce entre ambos.
   */
  const MAP_SECCION: Record<string, string> = {
    general: "configuracion", notificaciones: "notificaciones",
    debug: "debugging", info: "acercaDe",
  };
  const seccionInterna = $derived(soloContenido && seccion ? (MAP_SECCION[seccion] ?? seccion) : null);
  const filtro = $derived(soloContenido ? (seccionInterna ?? activeTab) : null);

  // Dentro del shell la navegación la maneja el shell, no esta página.
  $effect(() => { if (seccionInterna) activeTab = seccionInterna as any; });

  $effect(() => {
    if (tabRequest) {
      const target = tabsVisibles.find(t => t.id === tabRequest);
      if (target) activeTab = target.id as any;
    }
  });

  function handleThemeChange(mode: string) {
    setThemeMode(mode);
    saveAppSettings({ ...getAppSettings(), theme: mode });
  }
  // The highlight colour is persisted from the user action itself
  // (`handleUpdateHighlightColor`), NOT from an effect watching the state.
  //
  // Why it matters: `saveAppSettings` calls `onDataChange(..., immediate)` →
  // `flush()` → Cloudflare push+pull AND an instant Drive upload. An effect that
  // saves on every mount meant that merely OPENING a rail section (the rail
  // mounts pages on hover after 200 ms) fired a full sync of both clouds
  // without the user having changed anything: `ultimoHighlightGuardado` starts
  // at `null`, so the first run of the effect always looked like a change.
  function handleUpdateHighlightColor(color: string) {
    highlightColor = color;
    void saveAppSettings({ ...getAppSettings(), highlightColor: color });
    emit("highlight-color-updated", color);
  }

  // El callback NO puede ser `async`: todo lo que sigue a un `await` se ejecuta
  // fuera del contexto de inicialización del componente, y `onDestroy`lanza
  // `lifecycle_outside_component`. Por eso el cleanup se devuelve como valor
  // de retorno del `onMount` (Svelte lo invoca al destruír el componente).
  onMount(() => {
    invoke<{ id: string; nombre: string; color: string; minimo: number }[]>("get_grade_configs").then(d => gradeConfigs = d).catch(e => console.error("Error fetching grade configs:", e));
    // La ruta de la BD la carga DebugPage por su cuenta (solo la usa esa sección).
    // Cargar configuraciones desde la tabla syncronizable
    loadAppSettings()
      .then((settings) => { highlightColor = settings.highlightColor; })
      .catch((e) => console.error("Error loading app settings:", e));
    // Suscribirse a cambios externos (sync desde otro dispositivo)
    const unsub = onAppSettingsChange((s) => {
      highlightColor = s.highlightColor;
    });
    return () => unsub();
  });

  async function handleUpdateGradeConfig(id: string, nombre: string, color: string, minimo: number) {
    let v = minimo; if (id !== "AI") { if (v < 0) v = 0; if (v > 100) v = 100; } else v = 0;
    try {
      await invoke("update_grade_config", { id, nombre, color, minimo: v });
      gradeConfigs = gradeConfigs.map(c => c.id === id ? { ...c, nombre, color, minimo: v } : c);
      onDataChange('configuracion_calificacion');
      await emit("grade-configs-updated");
    } catch (error) {
      console.error("Error updating grade config:", error);
      await emit("show-toast", { message: "❌ " + t("ajustes.config.error", { msg: String(error) }), type: "error" });
    }
  }

  /** Android: pide el permiso POST_NOTIFICATIONS (segunda vía si el diálogo
   *  inicial del Welcome no apareció o fue denegado). */
  async function pedirPermisoNotificaciones() {
    try {
      await invoke('gd_request_notification_permission');
       await emit("show-toast", { message: "🔔 " + t("ajustes.notif.aviso"), type: "info" });
    } catch (e) {
      await emit("show-toast", { message: "❌ " + t("ajustes.notif.error", { msg: String(e) }), type: "error" });
    }
  }


</script>

<div class="page-container" style="display: flex; flex-direction: column; width: 100%; align-items: stretch;{(soloContenido ? ';padding:0' : '')}">

  {#if !isAndroid}
    {#if !soloContenido}
      <h1 style="font-size: 1.6rem; font-weight: 700; color: #f1f5f9; margin: 0 0 1.25rem;">{t("ajustes.titulo")}</h1>
    {/if}
    <div class="ajustes-grid">
      <!-- CONFIGURACIÓN -->
      {#if !filtro || filtro === "configuracion"}
      <div class="category-card" style="border-left: 3px solid {TAB_COLORS.configuracion};">
        <div class="category-header" style="border-left: none;">
          <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.configuracion}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">⚙️</div>
          <h3>{t("ajustes.config.titulo")}</h3>
        </div>
        <div style="padding: 1.5rem 2rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #e2e8f0; font-size: 0.95rem;">{t("ajustes.config.colorResaltado")}</h4>
          <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem;">{t("ajustes.config.colorResaltadoDesc")}</p>
          <div style="background: rgba(255,255,255,0.05); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 2rem;">
              <div style="flex: 1;">
                <h5 style="margin: 0 0 0.4rem 0; color: #e2e8f0; font-size: 0.9rem;">{t("ajustes.config.colorResaltado")}</h5>
                <p style="color: #94a3b8; font-size: 0.8rem; margin: 0;">{t("ajustes.config.colorResaltadoDesc")}</p>
              </div>
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div style="width: 40px; height: 40px; border-radius: 8px; background-color: {highlightColor}; border: 2px solid rgba(255,255,255,0.2); cursor: pointer; position: relative; overflow: hidden;" onclick={() => document.getElementById("highlight-color-picker")?.click()}>
                  <input id="highlight-color-picker" type="color" value={highlightColor} oninput={(e) => handleUpdateHighlightColor((e.target as HTMLInputElement).value)} style="position: absolute; top: -10px; left: -10px; width: 200%; height: 200%; opacity: 0; cursor: pointer;" />
                </div>
                <span style="font-family: monospace; color: #94a3b8; font-size: 0.85rem;">{highlightColor.toUpperCase()}</span>
              </div>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 1rem;">
              {#each PRESET_COLORS as preset}
                <button onclick={() => handleUpdateHighlightColor(preset)} style="width: 22px; height: 22px; background-color: {preset}; border: {highlightColor.toLowerCase() === preset.toLowerCase() ? '2px solid white' : '1px solid rgba(255,255,255,0.2)'}; border-radius: 4px; cursor: pointer; padding: 0;" title={preset}></button>
              {/each}
            </div>
          </div>
          <div style="margin-top: 1rem; padding: 0.75rem; border-radius: 8px; border: 1px dotted rgba(255,255,255,0.1);">
            <h5 style="margin: 0 0 0.4rem 0; color: #e2e8f0; font-size: 0.85rem;">{t("ajustes.config.vistaPrevia")}</h5>
            <div style="background: rgba(15, 23, 42, 0.5); padding: 0.75rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; gap: 0.75rem;">
              <div style="padding: 0.3rem 0.6rem; border-radius: 4px; background: {highlightColor}1a; border-left: 4px solid {highlightColor}; color: {highlightColor}; font-weight: bold; font-size: 0.8rem;">Juan Pérez García</div>
              <div style="color: #64748b; font-size: 0.75rem;">{t("ajustes.config.vistaPreviaEjemplo")}</div>
            </div>
          </div>

          <!-- ── Navegador del login de Google (solo escritorio) ──
               Windows no siempre abre el navegador que uno usa: decide con la
               asociación http/https del usuario, y Edge se auto-registra al
               instalarse, así que esa asociación suele seguir apuntando a Edge.
               Acá se elige con qué navegador se hace el login, sin depender de
               eso. Si el elegido no está instalado se cae al del sistema. -->
          <div style="margin-top: 2rem; background: rgba(96,165,250,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(96,165,250,0.18);">
            <h4 style="margin: 0 0 0.5rem 0; color: #e2e8f0;">🌐 {t("nav.titulo")}</h4>
            <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 0.25rem;">
              {t("nav.desc")}
            </p>
            <BrowserPicker />
          </div>

          <!-- ── Idioma de la aplicación ──
               También en el WelcomePage: el idioma tiene que poder elegirse
               ANTES de entrar a la app (ver LanguagePicker.svelte). -->
          <div style="margin-top: 2rem; background: rgba(167,139,250,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(167,139,250,0.18);">
            <h4 style="margin: 0 0 0.5rem 0; color: #e2e8f0;">🌐 {t("idioma.titulo")}</h4>
            <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 0.25rem;">
              {t("idioma.descripcion")}
            </p>
            <LanguagePicker />
          </div>
        </div>
      </div>
      {/if}

<!-- DEBUGGING -->
  <!-- Un SOLO render. Antes había un segundo `<DebugPage />` en
       `{#if activeTab === "debugging"}` más abajo, y no lo separaba ningún
       `{:else}`: al abrir la sección se cumplían AMBAS condiciones
       (`!filtro` porque el shell no pasa `filtro`, y `activeTab === 'debugging'`
       porque el efecto de sección lo setea), así que se montaban dos instancias
       con dos `ultimoTimer` independientes y dos backups por periodo. -->
  {#if !filtro || filtro === "debugging"}
    <DebugPage />
  {/if}

      <!-- INFO -->
      {#if !filtro || filtro === "acercaDe"}
        <InfoPage />
      {/if}
    </div>
  {/if}

  {#if isAndroid && !soloContenido && activeTab === null}
    <div style="padding: 1rem;">
      <h1 style="font-size: 1.5rem; font-weight: 700; color: #f1f5f9; margin-bottom: 1.5rem; text-align: center;">{t("ajustes.titulo")}</h1>
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        {#each tabsVisibles as tab (tab.id)}
          {@const color = TAB_COLORS[tab.id] || '#60a5fa'}
          <button onclick={() => activeTab = tab.id}
            style="display: flex; align-items: center; gap: 1rem; padding: 1rem 1.25rem; background: rgba(51, 65, 85, 0.5); border: 1px solid rgba(255,255,255,0.08); border-left: 3px solid {color}; border-radius: 12px; cursor: pointer; width: 100%; transition: all 0.2s ease;"
            onmouseenter={(e) => { e.currentTarget.style.borderColor = color + '44'; e.currentTarget.style.background = color + '0d'; }}
            onmouseleave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderLeftColor = color; e.currentTarget.style.background = 'rgba(51, 65, 85, 0.5)'; }}>
            <div style="width:40px;height:40px;border-radius:10px;background:{color}18;display:flex;align-items:center;justify-content:center;font-size:1.15rem;flex-shrink:0;">
              {#if tab.id === "acercaDe"}<img src={appIcon} alt="" style="width:24px;height:24px;border-radius:6px;object-fit:contain;" />{:else}{tab.icon}{/if}
            </div>
            <span style="font-size: 1rem; font-weight: 600; color: #e2e8f0; text-align: left; flex:1;">{tab.label}</span>
            <span style="font-size: 1.25rem; color: #64748b;">›</span>
          </button>
        {/each}
      </div>
    </div>
  {:else if isAndroid && (soloContenido || activeTab !== null)}
    <!-- Full-bleed: mismo criterio que EvaluacionesPage, sin padding lateral ni
         wrappers que intermediates puedan encoger. Solo aire vertical abajo. -->
    <div style="padding: 0 0 1.5rem; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; align-items: stretch;">
      <!-- El back nativo de Android ya maneja la vuelta (registerBackHandler) -->
      <div class="settings-content-wrapper" style="width:100%;min-width:0;">
        <!-- NOTIFICACIONES DE ASISTENCIA (solo Android) — modulo propio -->
        {#if activeTab === "notificaciones"}
          <NotificacionesPage />
        {/if}

        <!-- CONFIGURACIÓN -->
        {#if activeTab === "configuracion"}
          <div class="category-card" style="border-left: 3px solid {TAB_COLORS.configuracion};">
            <div class="category-header" style="border-left: none;">
              <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.configuracion}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">⚙️</div>
              <h3>{t("ajustes.config.titulo")}</h3>
            </div>
            <div style="padding: 2rem;">
              <div style="margin-bottom: 2rem;">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">Personalización de Tabla de Notas</h4>
                <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Configura el color de resaltado para el estudiante seleccionado en la página de notas.</p>
                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                  <div style="display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 2rem;">
                    <div style="flex: 1;">
                      <h5 style="margin: 0 0 0.5rem 0; color: #e2e8f0;">{t("ajustes.config.colorResaltado")}</h5>
                      <p style="color: #94a3b8; font-size: 0.85rem; margin: 0;">{t("ajustes.config.colorResaltadoLargo")}</p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                      <div style="width: 45px; height: 45px; border-radius: 8px; background-color: {highlightColor}; border: 2px solid rgba(255,255,255,0.2); cursor: pointer; position: relative; overflow: hidden;" onclick={() => document.getElementById("highlight-color-picker")?.click()}>
                        <input id="highlight-color-picker" type="color" value={highlightColor} oninput={(e) => handleUpdateHighlightColor((e.target as HTMLInputElement).value)} style="position: absolute; top: -10px; left: -10px; width: 200%; height: 200%; opacity: 0; cursor: pointer;" />
                      </div>
                      <span style="font-family: monospace; color: #94a3b8; font-size: 0.9rem;">{highlightColor.toUpperCase()}</span>
                    </div>
                  </div>
                  <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 1.5rem;">
                    {#each PRESET_COLORS as preset}
                      <button onclick={() => handleUpdateHighlightColor(preset)} style="width: 24px; height: 24px; background-color: {preset}; border: {highlightColor.toLowerCase() === preset.toLowerCase() ? '2px solid white' : '1px solid rgba(255,255,255,0.2)'}; border-radius: 4px; cursor: pointer; padding: 0;" title={preset}></button>
                    {/each}
                  </div>
                </div>
                <div style="margin-top: 2rem; background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 8px; border: 1px dotted rgba(255,255,255,0.1);">
                  <h5 style="margin: 0 0 0.5rem 0; color: #e2e8f0; font-size: 0.9rem;">Vista Previa</h5>
                  <div style="background: rgba(15, 23, 42, 0.5); padding: 1rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; gap: 1rem;">
                    <div style="padding: 0.4rem 0.8rem; border-radius: 4px; background: {highlightColor}1a; border-left: 4px solid {highlightColor}; color: {highlightColor}; font-weight: bold; font-size: 0.85rem;">Juan Pérez García</div>
                    <div style="color: #64748b; font-size: 0.8rem;">{t("ajustes.config.vistaPreviaEjemploLargo")}</div>
                  </div>
                </div>
              </div>

              {#if isAndroid}
                <div style="margin-top: 2rem; background: rgba(245,158,11,0.06); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(245,158,11,0.2);">
                  <h4 style="margin: 0 0 0.5rem 0; color: #e2e8f0;">🔔 {t("ajustes.notif.titulo")}</h4>
                  <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem;">{t("ajustes.notif.desc")}</p>
                  <button onclick={pedirPermisoNotificaciones} style="padding: 0.7rem 1.2rem; border-radius: 10px; border: 1px solid rgba(245,158,11,0.35); background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; font-weight: 600; font-size: 0.85rem; cursor: pointer;">
                    {t("ajustes.notif.activar")}
                  </button>
                </div>
              {/if}

              <!-- ── Idioma de la aplicación ──
                   También en el WelcomePage: el idioma tiene que poder elegirse
                   ANTES de entrar a la app (ver LanguagePicker.svelte). -->
              <div style="margin-top: 2rem; background: rgba(167,139,250,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(167,139,250,0.18);">
                <h4 style="margin: 0 0 0.5rem 0; color: #e2e8f0;">🌐 {t("idioma.titulo")}</h4>
                <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 0.25rem;">
                  {t("idioma.descripcion")}
                </p>
                <LanguagePicker />
              </div>
            </div>
          </div>
{/if}

  </div>
    </div>
  {/if}

</div>

<style>
  /* El selector de navegador del login vive en BrowserPicker.svelte (shared
     con el WelcomePage); no hay estilos condicionales de botones acá. */

  .ajustes-grid {
    display: grid;
    /* auto-fit (no auto-fill): colapsa las columnas vacías para que una card
       sola ocupe todo el ancho. Con auto-fill quedaba en 1/3 del ancho. */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 1.25rem;
    align-items: start;
  }
</style>
