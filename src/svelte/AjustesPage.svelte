<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { open, save, ask } from "@tauri-apps/plugin-dialog";
  import { copyFile, BaseDirectory } from "@tauri-apps/plugin-fs";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";
  import { loadAppSettings, saveAppSettings, getAppSettings, onAppSettingsChange } from "../lib/appSettings";
  import NotificacionesPage from "./notificaciones/NotificacionesPage.svelte";
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
  let dbPath = $state("");
  let gradeConfigs = $state<{ id: string; nombre: string; color: string; minimo: number }[]>([]);
  let highlightColor = $state(localStorage.getItem("student-highlight-color") || "#4ade80");
  let currentUserId = $state("");
  let showUserIdBox = $state(false);
  let selectedFeature = $state<{ icon: string; title: string; desc: string } | null>(null);

  const FEATURES = [
    { icon: "📋", title: "Gestión Académica", desc: "Organiza años lectivos, colegios, grados, secciones y asignaturas. Crea y administra catálogos completos con relaciones entre grados y asignaturas por colegio." },
    { icon: "📝", title: "Notas y Evaluaciones", desc: "Registra notas por indicador y criterio dentro de cada corte evaluativo. Soporta calificaciones numéricas y cualitativas (AA, AS, AF, AI) con multiplicadores configurables." },
    { icon: "✅", title: "Asistencia", desc: "Control diario, semanal y mensual de asistencia por estudiante (Presente, Ausente, Justificado). Incluye días sin clases, informes por período y exportación." },
    { icon: "📊", title: "Informes y PDF", desc: "Genera boletines de calificaciones, listados de estudiantes y reportes de asistencia en formato PDF y Excel. Personaliza colores y diseño de encabezados." },
    { icon: "☁️", title: "Sync en la Nube", desc: "Respaldo completo en Google Drive y sincronización bilateral en tiempo real con Cloudflare D1. Múltiples dispositivos siempre actualizados." },
    { icon: "📱", title: "Multiplataforma", desc: "Funciona en Windows, Android y navegadores web. Datos almacenados localmente en SQLite — no requiere conexión constante a internet." },
  ];


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
    invoke<string>("get_db_path").then(p => dbPath = p).catch(e => console.error("Error fetching db path:", e));
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

  function backupFileName(ext: string): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const fecha = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const hora = `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    return `Backup_SchoolTracker_${fecha}_${hora}.${ext}`;
  }

  async function handleExportDB() {
    try {
      const dbFile = await invoke<string>("get_db_path");
      if (isAndroid) {
        await copyFile(dbFile, backupFileName("sqlite"), { toPathBaseDir: BaseDirectory.Download });
        await emit("show-toast", { message: "✅ Base de datos exportada a Descargas", type: "success" }); return;
      }
      const dest = await save({ filters: [{ name: "Database File", extensions: ["db"] }], defaultPath: backupFileName("db") });
      if (dest) { await copyFile(dbFile, dest); await emit("show-toast", { message: "✅ Base de datos exportada", type: "success" }); }
    } catch (error) { await emit("show-toast", { message: "❌ Error al exportar: " + error, type: "error" }); }
  }

  let isImporting = $state(false);
  async function handleImportDB() {
    try {
      const source = await open({ filters: [{ name: "Database File", extensions: ["db"] }], multiple: false });
      if (source && typeof source === "string") {
        isImporting = true;
        const dbFile = await invoke<string>("get_db_path"); await copyFile(source, dbFile);
        // Reabrir la conexión Y correr migraciones: un backup de una versión
        // anterior puede carecer de tablas nuevas (colegio_grado, dia_sin_clases,
        // columna tipo, …). Sin esto el sync D1 falla con "no such table".
        try {
          await invoke("gd_reload_database");
          await emit("catalog-updated");
          await emit("data-updated");
        } catch (e) { console.warn("Post-import migrate/reload:", e); }
        // Sync COMPLETO automático tras importar un backup completo:
        // 1) RESET de la nube: borra filas Y tombstones residuales de purgas
        //    previas. Sin esto, los tombstones (que persistían en la nube)
        //    viajan a los dispositivos y borran las filas recién subidas
        //    ("los datos desaparecen al refrescar").
        // 2) full=true re-pushea TODAS las filas locales (ignora cursores viejos
        //    del d1_config importado) y deja la nube = la base importada.
        // Ambas son seguras/idempotentes (upsert LWW del worker).
        let sincronizada = 0;
        let syncErrores = '';
        try {
          await invoke("d1_reset_remote");
          const r = await invoke<any>("d1_sync_all", { full: true });
          const pushed = r?.pushed || {};
          sincronizada = typeof pushed === 'number' ? pushed : Object.values(pushed).reduce((a: number, b: any) => a + Number(b || 0), 0);
        } catch (e) {
          syncErrores = String(e);
          console.error("[Import] reset/sync completo automático falló:", e);
        }
        if (syncErrores) {
          await emit("show-toast", { message: `✅ Base importada y migrada. ⚠️ Sync completo no pudo ejecutarse: ${syncErrores}. Usa \u201cSync completo\u201d en Nube.`, type: "warning" });
        } else {
          await emit("show-toast", { message: `✅ Base importada, migrada y sincronizada (${sincronizada} filas en la nube). Reinicie la app si algo no responde.`, type: "success" });
        }
      }
    } catch (error) { await emit("show-toast", { message: "❌ Error al importar: " + error, type: "error" }); }
    finally { isImporting = false; }
  }

  async function handleResetLocalDB() {
    const ok = await ask("¿Estás SEGURO de que quieres reiniciar la base de datos LOCAL?\n\nSe borrarán todos los estudiantes, notas, asistencias y configuraciones.\nLa conexión a la nube se conserva (el próximo sync re-traerá tus datos).\nEsta acción no se puede deshacer.", { title: "⚠️ Reiniciar Base de Datos Local", kind: "warning", okLabel: "Confirmar", cancelLabel: "Cancelar" });
    if (!ok) return;
    try {
      await invoke("reset_local_database");
      await emit("catalog-updated");
      await emit("data-updated");
      await emit("show-toast", { message: "✅ Base de datos local reiniciada. Recargando…", type: "success" });
      setTimeout(() => location.reload(), 1500);
    }
    catch (error) { await emit("show-toast", { message: "❌ Error al reiniciar DB: " + error, type: "error" }); }
  }

  /** Purga TOTAL del perfil logueado: vacía la nube D1 (school key activa) Y
   *  reinicia la base local, dejando el perfil en cero para importar una DB
   *  buena. La config de conexión (d1_config) se conserva. */
  let isWipingProfile = $state(false);
  async function handleWipeProfileData() {
    const ok = await ask(
      "¡ATENCIÓN MÁXIMA! Esto dejará en CERO el perfil actual:\n\n" +
      "1️⃣ Borrará TODOS los datos de la NUBE (Cloudflare D1) de esta cuenta.\n" +
      "2️⃣ Reiniciará la base de datos LOCAL (con datos semilla por defecto).\n\n" +
      "Los demás dispositivos sincronizados también perderán los datos.\n" +
      "Después podrás importar tu base de datos buena.\n\n¿Continuar?",
      { title: "🚨 Purgar Perfil (Nube + Local)", kind: "warning", okLabel: "Sí, purgar todo", cancelLabel: "Cancelar" }
    );
    if (!ok) return;
    isWipingProfile = true;
    try {
      // 1. Vaciar la nube D1 del perfil (best-effort: si D1 no está configurado, seguir)
      let nubeOk = true;
      try {
        const r = await invoke<{ ok: boolean; deleted: number }>("d1_wipe_remote");
        console.log("[Wipe] nube purgada:", r);
      } catch (e) {
        nubeOk = false;
        console.warn("[Wipe] nube no purgada (¿D1 sin configurar?):", e);
      }
      // 2. Reiniciar la base local (conserva d1_config, re-siembra defaults)
      await invoke("reset_local_database");
      await emit("catalog-updated");
      await emit("data-updated");
      await emit("show-toast", {
        message: nubeOk
          ? "✅ Perfil purgado (nube + local en cero). Ahora importa tu base buena. Recargando…"
          : "⚠️ Local reiniciada; la nube NO se purgó (D1 sin configurar). Recargando…",
        type: nubeOk ? "success" : "warning",
      });
      setTimeout(() => location.reload(), 1800);
    } catch (error) {
      console.error("[Wipe] error:", error);
      await emit("show-toast", { message: "❌ Error al purgar perfil: " + error, type: "error" });
    } finally {
      isWipingProfile = false;
    }
  }

  async function showUserId() { currentUserId = await syncService.getUserId() || 'No conectado'; showUserIdBox = true; }
  async function copyUserId() { if (currentUserId && currentUserId !== 'No conectado') { await navigator.clipboard.writeText(currentUserId); emit("show-toast", { message: "User ID copiado al portapapeles", type: "success" }); } }
  async function handleSelectFolder() {
    try { const selected = await open({ directory: true, multiple: false }); if (selected) await emit("show-toast", { message: "📁 Carpeta seleccionada: " + selected, type: "info" }); }
    catch (error) { console.error("Error al seleccionar carpeta:", error); }
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
      <div class="category-card" style="border-left: 3px solid {TAB_COLORS.debugging};">
        <div class="category-header" style="border-left: none;">
          <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.debugging}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">🐛</div>
          <h3>Debugging</h3>
        </div>
        <div style="padding: 1.5rem 2rem;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
            <div style="background: rgba(255,255,255,0.05); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;"><span style="font-size: 1.1rem;">📤</span><h5 style="margin: 0; color: #e2e8f0; font-size: 0.9rem;">Exportar</h5></div>
              <button onclick={handleExportDB} style="padding: 0.5rem 0.8rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; color: white; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 600; width: 100%;">📤 Exportar DB</button>
            </div>
            <div style="background: rgba(255,255,255,0.05); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;"><span style="font-size: 1.1rem;">📥</span><h5 style="margin: 0; color: #e2e8f0; font-size: 0.9rem;">Importar</h5></div>
              <button onclick={handleImportDB} disabled={isImporting} style="padding: 0.5rem 0.8rem; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border: none; color: white; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 600; width: 100%; opacity: {isImporting ? 0.6 : 1};">{isImporting ? '⏳ Importando + sincronizando…' : '📥 Importar DB'}</button>
            </div>
          </div>
          <div style="background: rgba(239, 68, 68, 0.05); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.2);">
            <h5 style="margin: 0 0 0.5rem 0; color: #f87171; font-size: 0.85rem;">⚠️ Zona de Peligro</h5>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <button onclick={handleResetLocalDB} title="Borra estudiantes, notas, asistencias y catálogos de este dispositivo y recarga la app. La conexión a la nube se conserva (el próximo sync re-traerá tus datos)." style="padding: 0.45rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">🗑️ Reiniciar Local</button>
              <button onclick={handleWipeProfileData} disabled={isWipingProfile} title="Purga total: vacía la nube D1 de esta cuenta Y reinicia la base local, luego recarga. Úsalo antes de importar una DB buena." style="padding: 0.45rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 600; opacity: {isWipingProfile ? 0.6 : 1};">{isWipingProfile ? "⏳ Purgando…" : "🧨 Purgar Perfil"}</button>
            </div>
            <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 0.5rem;">🗑️ <strong>Reiniciar Local</strong>: solo este dispositivo, la nube queda intacta. 🧨 <strong>Purgar Perfil</strong>: vacía la nube D1 de esta cuenta Y reinicia la base local. Úsalo antes de importar una DB buena.</div>
          </div>
          <div style="margin-top: 1rem; background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;"><span style="font-size: 1rem;">📊</span><h5 style="margin: 0; color: #e2e8f0; font-size: 0.85rem;">Sistema</h5></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <div><div style="font-size: 0.7rem; color: #64748b;">Versión</div><div style="color: #e2e8f0; font-weight: 600; font-size: 0.85rem;">1.2.0</div></div>
              <div><div style="font-size: 0.7rem; color: #64748b;">Ruta DB</div><div class="selectable" style="color: #e2e8f0; font-size: 0.7rem; word-break: break-all;">{dbPath}</div></div>
            </div>
          </div>
        </div>
      </div>
      {/if}

      <!-- INFO -->
      {#if !filtro || filtro === "acercaDe"}
      <div class="category-card" style="border-left: 3px solid {TAB_COLORS.acercaDe};">
        <div class="category-header" style="border-left: none;">
          <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.acercaDe}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><img src={appIcon} alt="" style="width:24px;height:24px;border-radius:6px;object-fit:contain;" /></div>
          <h3>Info</h3>
        </div>
        <div style="padding: 1.5rem 2rem;">
          <div class="info-hero">
            <div class="info-hero-icon-wrap">
              <img src={appIcon} alt="School Tracker" class="info-hero-icon" />
            </div>
            <div class="info-hero-text">
              <h2 class="info-hero-title">School Tracker</h2>
              <p style="color: #94a3b8; font-size: 0.85rem; margin: 0;">Sistema de Gestión Académica</p>
              <div style="display: inline-block; margin-top: 0.4rem; padding: 0.15rem 0.6rem; background: rgba(255,255,255,0.05); border-radius: 20px; font-size: 0.7rem; color: var(--primary-color); border: 1px solid var(--primary-color);">v1.2.0</div>
            </div>
          </div>
          <div class="info-features">
            {#each FEATURES as f}
              <button class="info-feature" onclick={() => selectedFeature = f}>
                <span class="info-feature-icon">{f.icon}</span>
                <span class="info-feature-title">{f.title}</span>
              </button>
            {/each}
          </div>
          <div style="margin-top: 1rem; text-align: center; color: #64748b; font-size: 0.8rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.75rem;">Desarrollado con ❤️ por Keimer</div>
        </div>
      </div>
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
          <div class="category-card" style="border-left: 3px solid {TAB_COLORS.debugging};">
            <div class="category-header" style="border-left: none;">
              <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.debugging}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">🐛</div>
              <h3>Debugging</h3>
            </div>
            <div style="padding: 2rem;">
              <div style="margin-bottom: 2rem;">
                <h4 style="color: #e2e8f0;">Gestión de Datos y Configuración</h4>
                <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Configura la ubicación de almacenamiento y gestiona la importación/exportación de datos</p>
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                  <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;"><span style="font-size: 1.2rem;">📁</span><h5 style="margin: 0; color: #e2e8f0; font-size: 1rem;">Ubicación de Almacenamiento</h5></div>
                  <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <button onclick={handleSelectFolder} style="padding: 0.6rem 1rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">📂 Seleccionar Carpeta</button>
                    <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.5rem; word-break: break-all;">Carpeta actual: {dbPath || "Cargando..."}</div>
                  </div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                  <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;"><span style="font-size: 1.2rem;">📤</span><h5 style="margin: 0; color: #e2e8f0; font-size: 1rem;">Exportación de Datos</h5></div>
                  <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <button onclick={handleExportDB} style="padding: 0.6rem 1rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; color: white; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">📤 Exportar Todo</button>
                    <button onclick={handleExportDB} style="padding: 0.6rem 1rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">🗄️ Base de Datos</button>
                    <button onclick={async () => { await emit("show-toast", { message: "ℹ️ Funcionalidad no implementada.", type: "info" }); }} style="padding: 0.6rem 1rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">⚙️ Configuración</button>
                  </div>
                </div>
              </div>
              <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;"><span style="font-size: 1.2rem;">📥</span><h5 style="margin: 0; color: #e2e8f0; font-size: 1rem;">Importación de Datos</h5></div>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                  <button onclick={handleImportDB} disabled={isImporting} style="padding: 0.6rem 1rem; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border: none; color: white; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600; opacity: {isImporting ? 0.6 : 1};">{isImporting ? '⏳ Importando + sincronizando…' : '📥 Importar Todo'}</button>
                  <button onclick={handleImportDB} style="padding: 0.6rem 1rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">📊 Base de Datos</button>
                  <button onclick={async () => { await emit("show-toast", { message: "ℹ️ Funcionalidad no implementada.", type: "info" }); }} style="padding: 0.6rem 1rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">⚙️ Configuración</button>
                  <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.5rem;">⚠️ La importación sobrescribirá los datos actuales.</div>
                </div>
              </div>
              <div style="background: rgba(239, 68, 68, 0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.2); margin-top: 1.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;"><span style="font-size: 1.2rem;">⚠️</span><h5 style="margin: 0; color: #f87171; font-size: 1rem;">Zona de Peligro (Reset)</h5></div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
                  <button onclick={handleResetLocalDB} title="Borra estudiantes, notas, asistencias y catálogos de este dispositivo y recarga la app. La conexión a la nube se conserva (el próximo sync re-traerá tus datos)." style="padding: 0.6rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">🗑️ Reiniciar Local</button>
                  <button onclick={handleWipeProfileData} disabled={isWipingProfile} title="Purga total: vacía la nube D1 de esta cuenta Y reinicia la base local, luego recarga. Úsalo antes de importar una DB buena." style="padding: 0.6rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600; opacity: {isWipingProfile ? 0.6 : 1};">{isWipingProfile ? "⏳ Purgando…" : "🧨 Purgar Perfil (Nube + Local)"}</button>
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.75rem;">🗑️ <strong>Reiniciar Local</strong>: solo este dispositivo, la nube queda intacta. 🧨 <strong>Purgar Perfil</strong>: vacía la nube D1 de esta cuenta Y reinicia la base local. Úsalo antes de importar una base de datos buena para evitar mezclas con datos viejos.</div>
              </div>
              <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-top: 1.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;"><span style="font-size: 1.2rem;">📊</span><h5 style="margin: 0; color: #e2e8f0; font-size: 1rem;">Información del Sistema</h5></div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
                  <div><div style="font-size: 0.8rem; color: #64748b; margin-bottom: 0.25rem;">Versión App</div><div style="color: #e2e8f0; font-weight: 600;">1.2.0</div></div>
                  <div><div style="font-size: 0.8rem; color: #64748b; margin-bottom: 0.25rem;">Ruta DB</div><div class="selectable" style="color: #e2e8f0; font-size: 0.8rem; word-break: break-all;">{dbPath}</div></div>
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- ACERCA DE -->
        {#if activeTab === "acercaDe"}
          <div class="category-card" style="border-left: 3px solid {TAB_COLORS.acercaDe};">
            <div class="category-header" style="border-left: none;">
              <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.acercaDe}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><img src={appIcon} alt="" style="width:24px;height:24px;border-radius:6px;object-fit:contain;" /></div>
              <h3>Acerca de la Aplicación</h3>
            </div>
            <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem;">
              <div class="info-hero">
                <div class="info-hero-icon-wrap">
                  <img src={appIcon} alt="School Tracker" class="info-hero-icon" />
                </div>
                <div class="info-hero-text">
                  <h2 class="info-hero-title" style="font-size: 1.6rem;">School Tracker</h2>
                  <p style="color: #94a3b8; font-size: 0.9rem; margin: 0;">Sistema de Gestión Académica Profesional</p>
                  <div style="display: inline-block; margin-top: 0.4rem; padding: 0.2rem 0.7rem; background: rgba(255,255,255,0.05); border-radius: 20px; font-size: 0.75rem; color: var(--primary-color); border: 1px solid var(--primary-color);">v1.2.0 - Android & Cloud Edition</div>
                </div>
              </div>
              <div class="info-features">
                {#each FEATURES as f}
                  <button class="info-feature" onclick={() => selectedFeature = f}>
                    <span class="info-feature-icon">{f.icon}</span>
                    <span class="info-feature-title">{f.title}</span>
                  </button>
                {/each}
              </div>
              <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">🚀 Últimas Actualizaciones (v1.2.0)</h4>
                <ul style="color: #94a3b8; font-size: 0.9rem; margin: 0; padding-left: 1.5rem; line-height: 1.8;">
                  <li>📱 Rediseño Android: Nueva navegación de Ajustes optimizada.</li>
                  <li>☁️ Sync Real-time: Estado de sincronización en vivo.</li>
                  <li>⭐ Calificaciones Flexibles: Configuración dinámica de colores.</li>
                  <li>🎨 Motor de Temas: Soporte para múltiples esquemas.</li>
                  <li>🔄 Gestión de Orientación: Control de rotación en Android.</li>
                </ul>
              </div>
              <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">Tecnologías de Vanguardia</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
                  <div><div style="font-weight: bold; color: var(--primary-color); margin-bottom: 0.5rem;">Core System</div><ul style="color: #94a3b8; font-size: 0.8rem; padding-left: 1.2rem;"><li>Tauri v2 (Rust)</li><li>React 19</li><li>TypeScript</li></ul></div>
                  <div><div style="font-weight: bold; color: #a855f7; margin-bottom: 0.5rem;">Data & Cloud</div><ul style="color: #94a3b8; font-size: 0.8rem; padding-left: 1.2rem;"><li>SQLite Local</li><li>Google Drive</li></ul></div>
                </div>
              </div>
              <div style="text-align: center; color: #64748b; font-size: 0.9rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem;">Desarrollado con ❤️ por Keimer - v1.2.0</div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

</div>

{#if selectedFeature}
  <div class="info-modal-overlay" onclick={() => selectedFeature = null} role="presentation">
    <div class="info-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={selectedFeature.title}>
      <div class="info-modal-header">
        <span class="info-modal-icon">{selectedFeature.icon}</span>
        <h3 class="info-modal-title">{selectedFeature.title}</h3>
      </div>
      <p class="info-modal-desc">{selectedFeature.desc}</p>
      <button class="info-modal-close" onclick={() => selectedFeature = null}>Cerrar</button>
    </div>
  </div>
{/if}

<style>
  .ajustes-grid {
    display: grid;
    /* auto-fit (no auto-fill): colapsa las columnas vacías para que una card
       sola ocupe todo el ancho. Con auto-fill quedaba en 1/3 del ancho. */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 1.25rem;
    align-items: start;
  }
  .info-hero {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    padding: 1.5rem;
    border-radius: 16px;
    background: linear-gradient(135deg, rgba(var(--primary-rgb, 96,165,250), 0.08), rgba(168,85,247,0.06));
    border: 1px solid rgba(255,255,255,0.07);
    backdrop-filter: blur(20px);
    margin-bottom: 1.25rem;
  }
  .info-hero-icon-wrap {
    width: 72px;
    height: 72px;
    border-radius: 18px;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 20px rgba(var(--primary-rgb, 96,165,250), 0.15);
    animation: info-float 3s ease-in-out infinite, info-glow 2s ease-in-out infinite alternate;
  }
  .info-hero-icon {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .info-hero-text {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    animation: info-slide-in 0.6s ease-out both;
  }
  .info-hero-title {
    margin: 0;
    font-size: 1.8rem;
    font-weight: 700;
    background: linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: info-shimmer 3s ease-in-out infinite;
    background-size: 200% 100%;
  }
  @keyframes info-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
  @keyframes info-glow {
    0% { box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 15px rgba(var(--primary-rgb, 96,165,250), 0.1); }
    100% { box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 25px rgba(var(--primary-rgb, 96,165,250), 0.25); }
  }
  @keyframes info-slide-in {
    0% { opacity: 0; transform: translateX(-12px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  @keyframes info-shimmer {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  .info-features {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .info-feature {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.85rem;
    border-radius: 10px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    color: inherit;
    font: inherit;
    transition: all 0.2s ease;
    flex: 1 1 auto;
    min-width: 0;
    cursor: pointer;
  }
  .info-feature:hover {
    border-color: rgba(var(--primary-rgb, 96,165,250), 0.2);
    background: rgba(255,255,255,0.04);
  }
  .info-feature:active {
    transform: scale(0.97);
  }
  .info-feature-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }
  .info-feature-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
  }
  .info-feature-desc {
    display: none;
  }
  .ajustes-ribbon-container {
    display: flex;
    justify-content: center;
    margin-bottom: 1.5rem;
    position: sticky;
    top: 0;
    z-index: 500;
    padding: 0.6rem 0;
    background: var(--bg-primary, #0f172a);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-radius: 0 0 14px 14px;
  }
  :global(.ajustes-ribbon) { display: inline-flex; padding: 0.4rem; gap: 0.3rem; background: var(--bg-elevated); border-radius: 14px; border: 1px solid var(--border); }
  :global(.ajustes-tab) { padding: 0.5rem 1rem; border-radius: 10px; border: none; background: transparent; color: var(--text-muted); font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s ease; display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; }
  :global(.ajustes-tab.active) { color: var(--text-bright); background: var(--bg-active); box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.08); }
  :global(.ajustes-tab:hover:not(.active)) { background: var(--bg-hover); color: var(--text-primary); }
  :global(.tab-label) { display: inline-block; }
  @media (max-width: 1024px) {
    :global(.ajustes-ribbon-container) { justify-content: center; margin-bottom: 1rem; }
    :global(.ajustes-ribbon) { display: inline-flex; padding: 0.3rem; gap: 2px; }
    :global(.ajustes-tab) { padding: 0.5rem 0.6rem; gap: 0; font-size: 0.8rem; }
    :global(.ajustes-tab .tab-label) { display: none; }
    :global(.ajustes-tab.active) { padding: 0.5rem 0.8rem; }
    :global(.ajustes-tab.active .tab-label) { display: inline-block; font-size: 0.8rem; }
  }
  /* ── Modal Info Feature ── */
  .info-modal-overlay {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(8px);
    animation: info-modal-fade-in 0.2s ease-out;
  }
  .info-modal {
    width: min(90vw, 380px);
    padding: 1.5rem;
    border-radius: 18px;
    background: rgba(20,24,31,0.92);
    backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);
    animation: info-modal-slide-in 0.25s ease-out;
  }
  .info-modal-header {
    display: flex; align-items: center; gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .info-modal-icon {
    font-size: 1.8rem;
    width: 48px; height: 48px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 14px;
    background: rgba(var(--primary-rgb, 96,165,250), 0.1);
    border: 1px solid rgba(var(--primary-rgb, 96,165,250), 0.2);
    flex-shrink: 0;
  }
  .info-modal-title {
    margin: 0; font-size: 1.1rem; font-weight: 700; color: #f1f5f9;
  }
  .info-modal-desc {
    margin: 0 0 1.25rem; font-size: 0.85rem; color: #94a3b8; line-height: 1.6;
  }
  .info-modal-close {
    width: 100%; padding: 0.65rem; border: none; border-radius: 10px;
    background: rgba(255,255,255,0.08); color: #e2e8f0;
    font-size: 0.85rem; font-weight: 600; cursor: pointer;
    transition: all 0.15s ease;
  }
  .info-modal-close:hover { background: rgba(255,255,255,0.12); }
  .info-modal-close:active { transform: scale(0.97); }
  @keyframes info-modal-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes info-modal-slide-in {
    from { opacity: 0; transform: translateY(16px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
</style>
