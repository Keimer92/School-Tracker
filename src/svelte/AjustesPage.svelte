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
  import appIcon from "../assets/app-icon.png";

  function getThemeColor(color: string): string {
    return { claro: "#f1f5f9", oscuro: "#0f172a", sistema: "var(--primary-color)" }[color] || "#0f172a";
  }
  function getThemeName(color: string): string {
    return { claro: "Claro", oscuro: "Oscuro", sistema: "Según sistema" }[color] || "Oscuro";
  }
  function getThemeLabel(color: string): string {
    return { claro: "☀️ Tema Claro — Fondos claros, texto oscuro", oscuro: "🌙 Tema Oscuro — Fondos oscuros, texto claro", sistema: "💻 Según sistema — Usa la configuración de tu dispositivo" }[color] || "";
  }

const PRESET_COLORS = ["#000000","#7f7f7f","#880015","#ed1c24","#ff7f27","#fff200","#22b14c","#00a2e8","#3f48cc","#a349a4","#ffffff","#c3c3c3","#b97a57","#ffaec9","#ffc90e","#efe4b0","#b5e61d","#99d9ea","#7092be","#c8bfe7","#C00000","#FF0000","#FFC000","#FFFF00","#92D050","#00B050","#00B0F0","#0070C0","#002060","#7030A0"];

  const TABS = [
    { id: "configuracion", label: "General", icon: "⚙️" },
    { id: "notificaciones", label: "Notif. Asistencia", icon: "🔔", soloAndroid: true },
    { id: "debugging", label: "Debug", icon: "🐛" },
    { id: "acercaDe", label: "Info", icon: "📖" },
  ] as const;

  const TAB_COLORS: Record<string, string> = { configuracion: "#60a5fa", notificaciones: "#fbbf24", debugging: "#ef4444", acercaDe: "#a78bfa" };

  const isAndroid = /Android/i.test(navigator.userAgent);
  // Notificaciones de asistencia SOLO Android (usa AlarmManager nativo)
  const tabsVisibles = TABS.filter(t => isAndroid || !("soloAndroid" in t && t.soloAndroid));

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
   * Cuando la página se monta dentro de Ajustes Generales, `soloContenido`
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
  $effect(() => { saveAppSettings({ ...getAppSettings(), highlightColor }); });

  onMount(async () => {
    invoke<{ id: string; nombre: string; color: string; minimo: number }[]>("get_grade_configs").then(d => gradeConfigs = d).catch(e => console.error("Error fetching grade configs:", e));
    // La ruta de la BD la carga DebugPage por su cuenta (solo la usa esa sección).
    // Cargar configuraciones desde la tabla syncronizable
    const settings = await loadAppSettings();
    highlightColor = settings.highlightColor;
    // Suscribirse a cambios externos (sync desde otro dispositivo)
    const unsub = onAppSettingsChange((s) => {
      highlightColor = s.highlightColor;
    });
    onDestroy(unsub);
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
      await emit("show-toast", { message: "❌ Error al actualizar la configuración: " + error, type: "error" });
    }
  }

  function handleUpdateHighlightColor(color: string) { highlightColor = color; emit("highlight-color-updated", color); }

  /** Android: pide el permiso POST_NOTIFICATIONS (segunda vía si el diálogo
   *  inicial del Welcome no apareció o fue denegado). */
  async function pedirPermisoNotificaciones() {
    try {
      await invoke('gd_request_notification_permission');
       await emit("show-toast", { message: "🔔 Si no viste el diálogo, actívalo en Sistema → Apps → School Tracker → Notificaciones", type: "info" });
    } catch (e) {
      await emit("show-toast", { message: "❌ Error solicitando permiso: " + e, type: "error" });
    }
  }


</script>

<div class="page-container" style="display: flex; flex-direction: column; width: 100%; align-items: stretch;{(soloContenido ? ';padding:0' : '')}">

  {#if !isAndroid}
    {#if !soloContenido}
      <h1 style="font-size: 1.6rem; font-weight: 700; color: #f1f5f9; margin: 0 0 1.25rem;">Ajustes</h1>
    {/if}
    <div class="ajustes-grid">
      <!-- CONFIGURACIÓN -->
      {#if !filtro || filtro === "configuracion"}
      <div class="category-card" style="border-left: 3px solid {TAB_COLORS.configuracion};">
        <div class="category-header" style="border-left: none;">
          <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.configuracion}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">⚙️</div>
          <h3>Configuración</h3>
        </div>
        <div style="padding: 1.5rem 2rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #e2e8f0; font-size: 0.95rem;">Color de Resaltado</h4>
          <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem;">Color para destacar al estudiante en la tabla de notas.</p>
          <div style="background: rgba(255,255,255,0.05); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 2rem;">
              <div style="flex: 1;">
                <h5 style="margin: 0 0 0.4rem 0; color: #e2e8f0; font-size: 0.9rem;">Color de Resaltado</h5>
                <p style="color: #94a3b8; font-size: 0.8rem; margin: 0;">Este color se usará para destacar al estudiante.</p>
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
            <h5 style="margin: 0 0 0.4rem 0; color: #e2e8f0; font-size: 0.85rem;">Vista Previa</h5>
            <div style="background: rgba(15, 23, 42, 0.5); padding: 0.75rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; gap: 0.75rem;">
              <div style="padding: 0.3rem 0.6rem; border-radius: 4px; background: {highlightColor}1a; border-left: 4px solid {highlightColor}; color: {highlightColor}; font-weight: bold; font-size: 0.8rem;">Juan Pérez García</div>
              <div style="color: #64748b; font-size: 0.75rem;">← Ejemplo</div>
            </div>
          </div>
        </div>
      </div>
      {/if}

      <!-- DEBUGGING -->
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
      <h1 style="font-size: 1.5rem; font-weight: 700; color: #f1f5f9; margin-bottom: 1.5rem; text-align: center;">Ajustes</h1>
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
              <h3>Configuración del Sistema</h3>
            </div>
            <div style="padding: 2rem;">
              <div style="margin-bottom: 2rem;">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">Personalización de Tabla de Notas</h4>
                <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Configura el color de resaltado para el estudiante seleccionado en la página de notas.</p>
                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                  <div style="display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 2rem;">
                    <div style="flex: 1;">
                      <h5 style="margin: 0 0 0.5rem 0; color: #e2e8f0;">Color de Resaltado</h5>
                      <p style="color: #94a3b8; font-size: 0.85rem; margin: 0;">Este color se usará para destacar al estudiante y su fila cuando estés editando sus notas.</p>
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
                    <div style="color: #64748b; font-size: 0.8rem;">← Ejemplo de estudiante resaltado</div>
                  </div>
                </div>
              </div>

              {#if isAndroid}
                <div style="margin-top: 2rem; background: rgba(245,158,11,0.06); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(245,158,11,0.2);">
                  <h4 style="margin: 0 0 0.5rem 0; color: #e2e8f0;">🔔 Notificaciones del sistema</h4>
                  <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem;">Permite que la app muestre recordatorios de asistencia y avisos de sincronización. Si el aviso del primer inicio no apareció o denegaste el permiso, actívalo aquí.</p>
                  <button onclick={pedirPermisoNotificaciones} style="padding: 0.7rem 1.2rem; border-radius: 10px; border: 1px solid rgba(245,158,11,0.35); background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; font-weight: 600; font-size: 0.85rem; cursor: pointer;">
                    Activar notificaciones
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- DEBUGGING -->
        {#if activeTab === "debugging"}
          <DebugPage />
        {/if}

        <!-- ACERCA DE -->
        {#if activeTab === "acercaDe"}
          <InfoPage />
        {/if}
      </div>
    </div>
  {/if}

</div>

<style>
  .ajustes-grid {
    display: grid;
    /* auto-fit (no auto-fill): colapsa las columnas vacías para que una card
       sola ocupe todo el ancho. Con auto-fill quedaba en 1/3 del ancho. */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 1.25rem;
    align-items: start;
  }
</style>
