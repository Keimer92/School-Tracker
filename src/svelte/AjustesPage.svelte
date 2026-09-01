<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { open, save, ask } from "@tauri-apps/plugin-dialog";
  import { copyFile, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";
  import { getLocalDateISOString } from "../lib/dateUtils";
  import appIcon from "../assets/app-icon.png";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; }

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
    { id: "almacenamiento", label: "Almacén", icon: "📦" },
    { id: "debugging", label: "Debug", icon: "🐛" },
    { id: "acercaDe", label: "Info", icon: "📖" },
  ] as const;

  const TAB_COLORS: Record<string, string> = { configuracion: "#60a5fa", notificaciones: "#fbbf24", almacenamiento: "#34d399", debugging: "#ef4444", acercaDe: "#a78bfa" };

  const isAndroid = /Android/i.test(navigator.userAgent);
  // Notificaciones de asistencia SOLO Android (usa AlarmManager nativo)
  const tabsVisibles = TABS.filter(t => isAndroid || !("soloAndroid" in t && t.soloAndroid));

  let activeTab: typeof TABS[number]["id"] | null = $state(isAndroid ? null : "configuracion");

  $effect(() => {
    if (!pageActive || !isAndroid || activeTab === null) return;
    const dispose = registerBackHandler(() => { activeTab = null; return true; });
    return () => dispose();
  });
  let dbPath = $state("");
  let gradeConfigs = $state<{ id: string; nombre: string; color: string; minimo: number }[]>([]);
  let highlightColor = $state(localStorage.getItem("student-highlight-color") || "#4ade80");
  let currentUserId = $state("");
  let showUserIdBox = $state(false);
  let anos: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let selectedAno = $state(0);
  let selectedColegio = $state(0);
  let isExportingExcel = $state(false);
  let isExportingByYear = $state(false);
  let selectedFeature = $state<{ icon: string; title: string; desc: string } | null>(null);

  const FEATURES = [
    { icon: "📋", title: "Gestión Académica", desc: "Organiza años lectivos, colegios, grados, secciones y asignaturas. Crea y administra catálogos completos con relaciones entre grados y asignaturas por colegio." },
    { icon: "📝", title: "Notas y Evaluaciones", desc: "Registra notas por indicador y criterio dentro de cada corte evaluativo. Soporta calificaciones numéricas y cualitativas (AA, AS, AF, AI) con multiplicadores configurables." },
    { icon: "✅", title: "Asistencia", desc: "Control diario, semanal y mensual de asistencia por estudiante (Presente, Ausente, Justificado). Incluye días sin clases, informes por período y exportación." },
    { icon: "📊", title: "Informes y PDF", desc: "Genera boletines de calificaciones, listados de estudiantes y reportes de asistencia en formato PDF y Excel. Personaliza colores y diseño de encabezados." },
    { icon: "☁️", title: "Sync en la Nube", desc: "Respaldo completo en Google Drive y sincronización bilateral en tiempo real con Cloudflare D1. Múltiples dispositivos siempre actualizados." },
    { icon: "📱", title: "Multiplataforma", desc: "Funciona en Windows, Android y navegadores web. Datos almacenados localmente en SQLite — no requiere conexión constante a internet." },
  ];

  const NOTIF_STORAGE_KEY = 'stp_attendance_notif_settings';

  interface NotifColegioCfg { activo: boolean; inicio: string; fin: string; intervaloMin: number; }
  let notifColegios: CategoryItem[] = $state([]);
  let notifEnabled = $state(false);
  // Config por colegio: ventana [inicio, fin] + repetición cada N minutos
  let notifCfg = $state<Record<number, NotifColegioCfg>>({});
  let notifSaving = $state(false);
  let notifTesting = $state(false);
  let notifSilencedToday = $state(false);
  let notifDismissing = $state(false);
  let testColegio = $state<number>(0);

  function cfgDe(id: number): NotifColegioCfg {
    return notifCfg[id] ?? { activo: false, inicio: '07:00', fin: '12:00', intervaloMin: 45 };
  }
  function setCfg(id: number, patch: Partial<NotifColegioCfg>) {
    notifCfg = { ...notifCfg, [id]: { ...cfgDe(id), ...patch } };
  }

  function loadNotifSettings() {
    try {
      const stored = localStorage.getItem(NOTIF_STORAGE_KEY);
      if (stored) {
        const s = JSON.parse(stored);
        notifEnabled = !!s.enabled;
        // Nuevo modelo: [{id, inicio, fin, intervaloMin}]
        const map: Record<number, NotifColegioCfg> = {};
        for (const c of Array.isArray(s.colegios) ? s.colegios : []) {
          if (typeof c === 'object' && c.id != null) {
            map[Number(c.id)] = {
              activo: true,
              inicio: c.inicio || '07:00',
              fin: c.fin || '12:00',
              intervaloMin: Number(c.intervaloMin) || 45,
            };
          }
        }
        if (Object.keys(map).length > 0) notifCfg = map;
      }
    } catch (e) {
      console.error("Error cargando config de notificaciones:", e);
    }
  }

  async function loadNotifCatalogs() {
    try {
      notifColegios = await invoke<CategoryItem[]>("get_colegios");
    } catch (e) {
      console.error("Error cargando catálogos de notificaciones:", e);
    }
  }

  async function saveNotifSettings() {
    notifSaving = true;
    try {
      const colegios = Object.entries(notifCfg)
        .filter(([, c]) => c.activo)
        .map(([id, c]) => ({ id: Number(id), inicio: c.inicio, fin: c.fin, intervaloMin: Number(c.intervaloMin) || 45 }));
      const config = { enabled: notifEnabled && colegios.length > 0, colegios };
      console.log('[NotifUI] Guardando config:', JSON.stringify(config));
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(config));
      const dbPath = await invoke<string>("get_db_path");
      console.log('[NotifUI] dbPath =', dbPath);
      if (config.enabled) {
        await invoke("schedule_attendance_alarm", { config: JSON.stringify(config), dbPath });
        console.log('[NotifUI] schedule_attendance_alarm OK');
        await emit("show-toast", { message: "🔔 Notificaciones programadas para " + colegios.length + " colegio(s)", type: "success" });
      } else {
        await invoke("cancel_attendance_alarm");
        console.log('[NotifUI] cancel_attendance_alarm OK');
        await emit("show-toast", { message: "🔕 Notificaciones desactivadas", type: "info" });
      }
    } catch (error) {
      console.error('[NotifUI] Error guardando/programando:', error);
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: "error" });
    } finally {
      notifSaving = false;
    }
  }

  function toggleNotifColegio(id: number) {
    const c = cfgDe(id);
    setCfg(id, { activo: !c.activo });
  }

  async function testNotif() {
    const cid = testColegio || notifColegios[0]?.id;
    if (!cid) { await emit("show-toast", { message: "⚠️ No hay colegios configurados", type: "warning" }); return; }
    notifTesting = true;
    try {
      // PRUEBA REAL: consulta los grados pendientes de HOY para ese colegio
      const fecha = getLocalDateISOString();
      console.log('[NotifUI] Test real: colegio', cid, 'fecha', fecha);
      const pendientes = await invoke<Array<{ grado: string; seccion: string }>>(
        "get_grados_secciones_sin_asistencia_hoy", { colegioId: cid, fecha }
      );
      const nombre = notifColegios.find(c => c.id === cid)?.nombre || "";
      if (!pendientes || pendientes.length === 0) {
        // Distinguir motivo: día no hábil vs todo registrado
        let motivo = 'todo está registrado hoy ✅';
        try {
          const cfg = await invoke<Record<string, boolean>>("get_colegio_dias_asistencia", { colegioId: cid });
          const dias = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
          const d = new Date(fecha + 'T12:00:00').getDay();
          if (cfg && cfg[dias[d]] === false) motivo = 'hoy NO es día hábil para este colegio 🚫';
        } catch {}
        await emit("show-toast", { message: `ℹ️ Sin pendientes: ${motivo}`, type: "info" });
        return;
      }
      const lista = pendientes.slice(0, 5).map(p => `${p.grado} ${p.seccion}`).join(", ");
      const resto = pendientes.length > 5 ? ` y ${pendientes.length - 5} más` : "";
      await invoke("notify_attendance_reminder", {
        title: "Asistencia pendiente",
        body: `Sin asistencia hoy (${nombre}): ${lista}${resto}`,
      });
      console.log('[NotifUI] notify_attendance_reminder OK, pendientes:', pendientes.length);
      await emit("show-toast", { message: `🔔 Notificación enviada con ${pendientes.length} grado(s) pendiente(s)`, type: "success" });
    } catch (error) {
      console.error('[NotifUI] Error en notificación de prueba:', error);
      await emit("show-toast", { message: "❌ Error: " + error, type: "error" });
    } finally {
      notifTesting = false;
    }
  }

  async function refreshNotifSilenced() {
    try {
      notifSilencedToday = await invoke<boolean>("get_attendance_silenced_today");
    } catch (e) {
      notifSilencedToday = false;
    }
  }

  async function dismissNotifToday() {
    notifDismissing = true;
    try {
      await invoke("dismiss_attendance_today");
      notifSilencedToday = true;
      await emit("show-toast", { message: "🔕 Recordatorios silenciados para hoy", type: "success" });
    } catch (error) {
      await emit("show-toast", { message: "❌ Error: " + error, type: "error" });
    } finally {
      notifDismissing = false;
    }
  }

  $effect(() => {
    if (activeTab === "notificaciones") {
      loadNotifSettings();
      loadNotifCatalogs();
      refreshNotifSilenced();
    }
  });

  let { themeMode = "sistema", setThemeMode = () => {}, pageActive = false, tabRequest = null as string | null } = $props();

  $effect(() => {
    if (tabRequest) {
      const target = tabsVisibles.find(t => t.id === tabRequest);
      if (target) activeTab = target.id as any;
    }
  });

  function handleThemeChange(mode: string) {
    setThemeMode(mode);
  }
  $effect(() => { localStorage.setItem("student-highlight-color", highlightColor); });

  onMount(() => {
    invoke<{ id: string; nombre: string; color: string; minimo: number }[]>("get_grade_configs").then(d => gradeConfigs = d).catch(e => console.error("Error fetching grade configs:", e));
    invoke<string>("get_db_path").then(p => dbPath = p).catch(e => console.error("Error fetching db path:", e));
    Promise.all([invoke<CategoryItem[]>("get_anos"), invoke<CategoryItem[]>("get_colegios")]).then(([aData, cData]) => {
      anos = aData; colegios = cData;
      const activeYear = aData.find(a => a.activo) || aData[0]; if (activeYear) selectedAno = activeYear.id;
      const activeColegio = cData.find(c => c.activo) || cData[0]; if (activeColegio) selectedColegio = activeColegio.id;
    }).catch(e => console.error("Error fetching catalogs:", e));
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
      await emit("show-toast", { message: "🔔 Si no viste el diálogo, actívalo en Sistema → Apps → School Tracker Pro → Notificaciones", type: "info" });
    } catch (e) {
      await emit("show-toast", { message: "❌ Error solicitando permiso: " + e, type: "error" });
    }
  }

  async function handleExportDB() {
    try {
      const dbFile = await invoke<string>("get_db_path");
      if (isAndroid) {
        await copyFile(dbFile, `backup_notas_${Date.now()}.sqlite`, { toPathBaseDir: BaseDirectory.Download });
        await emit("show-toast", { message: "✅ Base de datos exportada a Descargas", type: "success" }); return;
      }
      const dest = await save({ filters: [{ name: "Database File", extensions: ["db"] }], defaultPath: "backup_notas.db" });
      if (dest) { await copyFile(dbFile, dest); await emit("show-toast", { message: "✅ Base de datos exportada", type: "success" }); }
    } catch (error) { await emit("show-toast", { message: "❌ Error al exportar: " + error, type: "error" }); }
  }

  async function handleImportDB() {
    try {
      const source = await open({ filters: [{ name: "Database File", extensions: ["db"] }], multiple: false });
      if (source && typeof source === "string") {
        const dbFile = await invoke<string>("get_db_path"); await copyFile(source, dbFile);
        await emit("show-toast", { message: "✅ Base de datos importada. Reinicie la app.", type: "success" });
      }
    } catch (error) { await emit("show-toast", { message: "❌ Error al importar: " + error, type: "error" }); }
  }

  async function handleResetLocalDB() {
    const ok = await ask("¿Estás SEGURO de que quieres reiniciar la base de datos LOCAL?\n\nSe borrarán todos los estudiantes, notas, asistencias y configuraciones.\nEsta acción no se puede deshacer.", { title: "⚠️ Reiniciar Base de Datos Local", kind: "warning", okLabel: "Confirmar", cancelLabel: "Cancelar" });
    if (!ok) return;
    try { await invoke("reset_local_database"); await emit("catalog-updated"); await emit("show-toast", { message: "✅ Base de datos local reiniciada.", type: "success" }); }
    catch (error) { await emit("show-toast", { message: "❌ Error al reiniciar DB: " + error, type: "error" }); }
  }

  async function handleResetRemoteDB() {
    const ok = await ask("¡ATENCIÓN! ¿Estás SEGURO de limpiar los datos sincronizados?\n\nSe borrarán PERMANENTEMENTE todos tus datos en el servidor.", { title: "🚨 Limpiar Datos en Sync", kind: "warning", okLabel: "Confirmar", cancelLabel: "Cancelar" });
    if (!ok) return;
    try { await syncService.wipeRemoteData(); await emit("show-toast", { message: "✅ Datos en la nube eliminados.", type: "success" }); }
    catch (error) { await emit("show-toast", { message: "❌ Error al limpiar nube.", type: "error" }); }
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
          ? "✅ Perfil purgado (nube + local en cero). Ahora importa tu base buena."
          : "⚠️ Local reiniciada; la nube NO se purgó (D1 sin configurar).",
        type: nubeOk ? "success" : "warning",
      });
    } catch (error) {
      console.error("[Wipe] error:", error);
      await emit("show-toast", { message: "❌ Error al purgar perfil: " + error, type: "error" });
    } finally {
      isWipingProfile = false;
    }
  }

  async function handleFactoryReset() {
    const ok = await ask('¿Estás SEGURO? Se borrarán TODOS los datos locales y la app se reiniciará desde cero.\n\nEsta acción no se puede deshacer.', { title: 'Restablecer valores de fábrica', kind: 'warning', okLabel: 'Confirmar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    try {
      await invoke('factory_reset');
      await emit('show-toast', { message: '✅ Datos restablecidos. La app se recargará.', type: 'success' });
      setTimeout(() => location.reload(), 1500);
    } catch (error) {
      await emit('show-toast', { message: '❌ Error: ' + error, type: 'error' });
    }
  }

  async function showUserId() { currentUserId = await syncService.getUserId() || 'No conectado'; showUserIdBox = true; }
  async function copyUserId() { if (currentUserId && currentUserId !== 'No conectado') { await navigator.clipboard.writeText(currentUserId); emit("show-toast", { message: "User ID copiado al portapapeles", type: "success" }); } }
  async function handleSelectFolder() {
    try { const selected = await open({ directory: true, multiple: false }); if (selected) await emit("show-toast", { message: "📁 Carpeta seleccionada: " + selected, type: "info" }); }
    catch (error) { console.error("Error al seleccionar carpeta:", error); }
  }

  async function handleExportStudentsToExcel() {
    if (!selectedAno || !selectedColegio) { await emit("show-toast", { message: "⚠️ Seleccione año y colegio", type: "warning" }); return; }
    isExportingExcel = true;
    try {
      const XLSX = await import("xlsx");
      const students = await invoke<any[]>("get_students");
      const filtered = students.filter(s => Number(s.anoLectivoId) === Number(selectedAno) && Number(s.colegioId) === Number(selectedColegio));
      if (filtered.length === 0) { await emit("show-toast", { message: "ℹ️ No hay estudiantes para exportar", type: "info" }); isExportingExcel = false; return; }
      const [grados, secciones] = await Promise.all([invoke<CategoryItem[]>("get_grados"), invoke<CategoryItem[]>("get_secciones")]);
      const excelData = filtered.map(s => ({
        "Nombre Completo": s.nombre, Sexo: s.sexo === "F" ? "Femenino" : "Masculino",
        Grado: grados.find(g => g.id === s.gradoId)?.nombre || "N/A", Sección: secciones.find(sec => sec.id === s.seccionId)?.nombre || "N/A",
        Teléfono: s.telefono || "", Email: s.email || "", Dirección: s.direccion || "",
      }));
      excelData.sort((a, b) => { const g = a.Grado.localeCompare(b.Grado, undefined, { numeric: true, sensitivity: "base" }); if (g) return g; const se = a.Sección.localeCompare(b.Sección, undefined, { numeric: true, sensitivity: "base" }); return se || a["Nombre Completo"].localeCompare(b["Nombre Completo"], undefined, { sensitivity: "base" }); });
      const ws = XLSX.utils.json_to_sheet(excelData); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Estudiantes");
      const colegioName = colegios.find(c => c.id === selectedColegio)?.nombre || "Colegio";
      const anoName = anos.find(a => a.id === selectedAno)?.nombre || "Año";
      const fileName = `Estudiantes_${colegioName.replace(/\s+/g, "_")}_${anoName}.xlsx`;
      const dest = await save({ filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }], defaultPath: fileName });
      if (dest) { const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }); await writeFile(dest, new Uint8Array(buf)); await emit("show-toast", { message: "✅ Exportación exitosa", type: "success" }); }
    } catch (error) { await emit("show-toast", { message: "❌ Error al exportar: " + error, type: "error" }); }
    finally { isExportingExcel = false; }
  }

  async function handleExportStudentsByYear() {
    if (!selectedAno) { await emit("show-toast", { message: "⚠️ Seleccione un año lectivo", type: "warning" }); return; }
    isExportingByYear = true;
    try {
      const XLSX = await import("xlsx");
      const students = await invoke<any[]>("get_students");
      const filtered = students.filter(s => Number(s.anoLectivoId) === Number(selectedAno));
      if (filtered.length === 0) { await emit("show-toast", { message: "ℹ️ No hay estudiantes para exportar", type: "info" }); isExportingByYear = false; return; }
      const [grados, secciones, colegiosList] = await Promise.all([invoke<CategoryItem[]>("get_grados"), invoke<CategoryItem[]>("get_secciones"), invoke<CategoryItem[]>("get_colegios")]);
      const byColegio = filtered.reduce((acc, s) => { const n = colegiosList.find(c => c.id === s.colegioId)?.nombre || "Sin_Colegio"; const safe = n.replace(/[\\/*?:\[\]]/g, "_"); if (!acc[safe]) acc[safe] = []; acc[safe].push({ ...s, colegioNombre: n }); return acc; }, {} as Record<string, any[]>);
      const wb = XLSX.utils.book_new();
      Object.entries(byColegio).forEach(([sheetName, colegioStudents]) => {
        (colegioStudents as any[]).sort((a, b) => { const ga = grados.find(g => g.id === a.gradoId)?.nombre || ""; const gb = grados.find(g => g.id === b.gradoId)?.nombre || ""; const gs = ga.localeCompare(gb, undefined, { numeric: true, sensitivity: "base" }); if (gs) return gs; const sa = secciones.find(sec => sec.id === a.seccionId)?.nombre || ""; const sb = secciones.find(sec => sec.id === b.seccionId)?.nombre || ""; return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" }) || a.nombre.localeCompare(b.nombre, undefined, { sensitivity: "base" }); });
        const data = (colegioStudents as any[]).map(s => ({ "Nombre Completo": s.nombre, Sexo: s.sexo === "F" ? "Femenino" : "Masculino", Grado: grados.find(g => g.id === s.gradoId)?.nombre || "N/A", Sección: secciones.find(sec => sec.id === s.seccionId)?.nombre || "N/A", Teléfono: s.telefono || "", Email: s.email || "", Dirección: s.direccion || "" }));
        const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = [{ wch: 35 }, { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 30 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, ws, sheetName.length > 31 ? sheetName.substring(0, 31) : sheetName);
      });
      const anoName = anos.find(a => a.id === selectedAno)?.nombre || "Año";
      const dest = await save({ filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }], defaultPath: `Todos_Estudiantes_${anoName.replace(/\s+/g, "_")}.xlsx` });
      if (dest) { const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }); await writeFile(dest, new Uint8Array(buf)); await emit("show-toast", { message: `✅ Exportación exitosa de ${filtered.length} estudiantes en ${Object.keys(byColegio).length} colegios`, type: "success" }); }
    } catch (error) { await emit("show-toast", { message: "❌ Error al exportar: " + error, type: "error" }); }
    finally { isExportingByYear = false; }
  }

</script>

<div class="page-container" style="display: block;">

  {#if !isAndroid}
    <h1 style="font-size: 1.6rem; font-weight: 700; color: #f1f5f9; margin: 0 0 1.25rem;">Ajustes</h1>
    <div class="ajustes-grid">
      <!-- CONFIGURACIÓN -->
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

      <!-- ALMACENAMIENTO -->
      <div class="category-card" style="border-left: 3px solid {TAB_COLORS.almacenamiento};">
        <div class="category-header" style="border-left: none;">
          <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.almacenamiento}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">📦</div>
          <h3>Almacenamiento y Reportes</h3>
        </div>
        <div style="padding: 1.5rem 2rem;">
          <h4 style="margin: 0 0 0.75rem 0; color: #e2e8f0; font-size: 0.95rem;">Exportar Estudiantes a Excel</h4>
          <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem;">Genera un archivo Excel con el listado de estudiantes.</p>
          <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; gap: 1rem;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
              <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                <label style="font-size: 0.75rem; color: #94a3b8; font-weight: bold;">Año Lectivo</label>
                <select bind:value={selectedAno} style="padding: 0.6rem; border-radius: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.1); color: white; outline: none; width: 100%; box-sizing: border-box; font-size: 0.85rem;">
                  <option value={0}>Seleccione año...</option>
                  {#each anos as a (a.id)}<option value={a.id}>{a.nombre}</option>{/each}
                </select>
              </div>
              <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                <label style="font-size: 0.75rem; color: #94a3b8; font-weight: bold;">Colegio</label>
                <select bind:value={selectedColegio} style="padding: 0.6rem; border-radius: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.1); color: white; outline: none; width: 100%; box-sizing: border-box; font-size: 0.85rem;">
                  <option value={0}>Seleccione colegio...</option>
                  {#each colegios as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}
                </select>
              </div>
            </div>
            <button onclick={handleExportStudentsToExcel} disabled={isExportingExcel || !selectedAno || !selectedColegio} style="padding: 0.8rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; color: white; border-radius: 10px; cursor: pointer; font-size: 0.9rem; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 0.6rem; opacity: {(isExportingExcel || !selectedAno || !selectedColegio) ? 0.6 : 1};">
              {#if isExportingExcel}<div style="width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.2); border-top: 2px solid white; border-radius: 50%; animation: spin 1s linear infinite;"></div> Generando...{:else}<span style="font-size: 1.1rem;">📊</span> Exportar por Colegio{/if}
            </button>
          </div>
          <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed rgba(255,255,255,0.1);">
            <h5 style="margin: 0 0 0.5rem 0; color: var(--primary-color); font-size: 0.85rem;">📁 Exportar Todos por Año</h5>
            <p style="color: #94a3b8; font-size: 0.8rem; margin-bottom: 0.75rem;">Exporta todos los estudiantes de todos los colegios.</p>
            <button onclick={handleExportStudentsByYear} disabled={isExportingByYear || !selectedAno} style="padding: 0.7rem; background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%); border: none; color: white; border-radius: 10px; cursor: pointer; font-size: 0.85rem; font-weight: bold; width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; opacity: {(isExportingByYear || !selectedAno) ? 0.6 : 1};">
              {#if isExportingByYear}<div style="width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.2); border-top: 2px solid white; border-radius: 50%; animation: spin 1s linear infinite;"></div> Generando...{:else}<span style="font-size: 1rem;">📋</span> Exportar Todos ({anos.find(a => a.id === selectedAno)?.nombre || "Año"}){/if}
            </button>
          </div>
        </div>
      </div>

      <!-- DEBUGGING -->
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
              <button onclick={handleImportDB} style="padding: 0.5rem 0.8rem; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border: none; color: white; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 600; width: 100%;">📥 Importar DB</button>
            </div>
          </div>
          <div style="background: rgba(239, 68, 68, 0.05); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.2);">
            <h5 style="margin: 0 0 0.5rem 0; color: #f87171; font-size: 0.85rem;">⚠️ Zona de Peligro</h5>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem;">
              <button onclick={handleResetLocalDB} style="padding: 0.45rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">🗑️ Reset Local</button>
              <button onclick={handleResetRemoteDB} style="padding: 0.45rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">☁️ Limpiar Nube</button>
              <button onclick={handleFactoryReset} style="padding: 0.45rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">🔄 Fábrica</button>
            </div>
          </div>
          <div style="margin-top: 1rem; background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;"><span style="font-size: 1rem;">📊</span><h5 style="margin: 0; color: #e2e8f0; font-size: 0.85rem;">Sistema</h5></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <div><div style="font-size: 0.7rem; color: #64748b;">Versión</div><div style="color: #e2e8f0; font-weight: 600; font-size: 0.85rem;">1.2.0</div></div>
              <div><div style="font-size: 0.7rem; color: #64748b;">Ruta DB</div><div style="color: #e2e8f0; font-size: 0.7rem; word-break: break-all;">{dbPath}</div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- INFO -->
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
    </div>
  {/if}

  {#if isAndroid && activeTab === null}
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
  {:else if isAndroid && activeTab !== null}
    <div style="padding: 1rem;">
      <!-- El back nativo de Android ya maneja la vuelta (registerBackHandler) -->
      <div class="settings-content-wrapper">
        <!-- NOTIFICACIONES DE ASISTENCIA (solo Android) -->
        {#if activeTab === "notificaciones"}
          <div class="notif-page">
            <!-- Header glass con toggle global -->
            <div class="notif-hero">
              <div class="notif-hero-icon">🔔</div>
              <div style="flex:1;min-width:0">
                <h3 style="margin:0 0 2px;font-size:1.05rem;color:#f1f5f9;">Notificaciones de Asistencia</h3>
                <p style="margin:0;font-size:0.75rem;color:#94a3b8;line-height:1.45;">Avisa cuando un colegio tenga grados sin asistencia, dentro de su ventana horaria. Funciona con la app cerrada.</p>
              </div>
              <label class="switch" style="flex-shrink:0">
                <input type="checkbox" bind:checked={notifEnabled} />
                <span class="slider"></span>
              </label>
            </div>

            {#if notifEnabled}
              <!-- Cards por colegio -->
              <div style="display:flex;flex-direction:column;gap:0.6rem;">
                {#each notifColegios as c (c.id)}
                  {@const cfg = cfgDe(c.id!)}
                  <div class="notif-colegio-card" class:activa={cfg.activo}>
                    <div class="notif-colegio-head" onclick={() => toggleNotifColegio(c.id!)}>
                      <span class="notif-check">{cfg.activo ? '✓' : ''}</span>
                      <span class="notif-colegio-nombre">{c.nombre}</span>
                    </div>
                    {#if cfg.activo}
                      <div class="notif-colegio-body">
                        <div class="notif-campo">
                          <label>Desde</label>
                          <input type="time" value={cfg.inicio} onchange={(e) => setCfg(c.id!, { inicio: (e.target as HTMLInputElement).value })} />
                        </div>
                        <div class="notif-campo">
                          <label>Hasta</label>
                          <input type="time" value={cfg.fin} onchange={(e) => setCfg(c.id!, { fin: (e.target as HTMLInputElement).value })} />
                        </div>
                        <div class="notif-campo" style="flex:1.3">
                          <label>Repetir cada</label>
                          <select value={String(cfg.intervaloMin)} onchange={(e) => setCfg(c.id!, { intervaloMin: Number((e.target as HTMLSelectElement).value) })}>
                            {#each [15, 30, 45, 60, 90, 120] as m}
                              <option value={m}>{m} min</option>
                            {/each}
                          </select>
                        </div>
                      </div>
                      <div class="notif-resumen">⏱ De {cfg.inicio} a {cfg.fin} · cada {cfg.intervaloMin} min si hay grados pendientes</div>
                    {/if}
                  </div>
                {/each}
                {#if Object.values(notifCfg).filter(c => c.activo).length === 0}
                  <div class="empty-state-sm"><span>👆</span><span>Toca un colegio para configurar su horario</span></div>
                {/if}
              </div>

              <!-- Acciones -->
              <div class="notif-campo" style="width:100%">
                <label>Colegio para la prueba</label>
                <select bind:value={testColegio}>
                  {#each notifColegios as c (c.id)}
                    <option value={c.id}>{c.nombre}</option>
                  {/each}
                </select>
              </div>
              <div style="display:flex;gap:0.6rem;">
                <button class="notif-btn-primary" onclick={saveNotifSettings} disabled={notifSaving} style="flex:1">
                  {notifSaving ? "Guardando..." : "💾 Guardar"}
                </button>
                <button class="notif-btn-ghost" onclick={testNotif} disabled={notifTesting} style="flex:1">
                  {notifTesting ? "Probando..." : "🔔 Probar real"}
                </button>
              </div>

              <!-- Silenciar hoy -->
              {#if notifSilencedToday}
                <div class="notif-banner-ok">
                  <span>🔕 Recordatorios silenciados para hoy</span>
                  <button onclick={async () => {
                    try {
                      await invoke("set_attendance_silenced_today", { silenced: false });
                      notifSilencedToday = false;
                      await emit("show-toast", { message: "🔔 Recordatorios reactivados para hoy", type: "success" });
                    } catch (e) {
                      await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
                    }
                  }} class="notif-btn-mini">Reactivar</button>
                </div>
              {:else}
                <button class="notif-btn-ghost" onclick={dismissNotifToday} disabled={notifDismissing} style="align-self:flex-start;width:auto;">
                  {notifDismissing ? "Silenciando..." : "🔕 Silenciar recordatorios de hoy"}
                </button>
              {/if}

              <div class="notif-nota">
                ⚠️ En Android 12+ la precisión exacta requiere el permiso "Alarmas y recordatorios exactos" (Sistema → Apps → School Tracker Pro).
              </div>
            {:else}
              <div class="empty-state-sm"><span>🔕</span><span>Las notificaciones están desactivadas</span></div>
            {/if}
          </div>
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

        <!-- ALMACENAMIENTO -->
        {#if activeTab === "almacenamiento"}
          <div class="category-card" style="border-left: 3px solid {TAB_COLORS.almacenamiento};">
            <div class="category-header" style="border-left: none;">
              <div style="width:36px;height:36px;border-radius:10px;background:{TAB_COLORS.almacenamiento}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">📦</div>
              <h3>Almacenamiento y Reportes</h3>
            </div>
            <div style="padding: 2rem;">
              <div style="margin-bottom: 2rem;">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">Exportar Base de Datos de Estudiantes</h4>
                <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Genera un archivo Excel profesional con el listado completo de estudiantes filtrado por colegio y año lectivo.</p>
                <div style="background: rgba(255,255,255,0.05); padding: 2rem; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; gap: 1.5rem;">
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                      <label style="font-size: 0.8rem; color: #94a3b8; font-weight: bold;">Año Lectivo</label>
                      <select bind:value={selectedAno} style="padding: 0.8rem; border-radius: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.1); color: white; outline: none; width: 100%; box-sizing: border-box;">
                        <option value={0}>Seleccione año...</option>
                        {#each anos as a (a.id)}<option value={a.id}>{a.nombre}</option>{/each}
                      </select>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                      <label style="font-size: 0.8rem; color: #94a3b8; font-weight: bold;">Colegio</label>
                      <select bind:value={selectedColegio} style="padding: 0.8rem; border-radius: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.1); color: white; outline: none; width: 100%; box-sizing: border-box;">
                        <option value={0}>Seleccione colegio...</option>
                        {#each colegios as c (c.id)}<option value={c.id}>{c.nombre}</option>{/each}
                      </select>
                    </div>
                  </div>
                  <button onclick={handleExportStudentsToExcel} disabled={isExportingExcel || !selectedAno || !selectedColegio} style="margin-top: 1rem; padding: 1rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; color: white; border-radius: 12px; cursor: pointer; font-size: 1rem; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 0.8rem; opacity: {(isExportingExcel || !selectedAno || !selectedColegio) ? 0.6 : 1};">
                    {#if isExportingExcel}
                      <div style="width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2); border-top: 2px solid white; border-radius: 50%; animation: spin 1s linear infinite;"></div> Generando Excel...
                    {:else}<span style="font-size: 1.2rem;">📊</span> Exportar Listado de Estudiantes a Excel{/if}
                  </button>
                </div>

                <div style="margin-top: 1rem; padding-top: 1.5rem; border-top: 1px dashed rgba(255,255,255,0.15);">
                  <h5 style="margin: 0 0 1rem 0; color: var(--primary-color); font-size: 0.95rem; font-weight: 600;">📁 Exportar Todos los Estudiantes por Año Lectivo</h5>
                  <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem;">Exporta todos los estudiantes de todos los colegios para un año lectivo específico.</p>
                  <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                      <label style="font-size: 0.8rem; color: #94a3b8; font-weight: bold;">Año Lectivo</label>
                      <select bind:value={selectedAno} style="padding: 0.8rem; border-radius: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.1); color: white; outline: none; width: 100%; box-sizing: border-box;">
                        <option value={0}>Seleccione año...</option>
                        {#each anos as a (a.id)}<option value={a.id}>{a.nombre}</option>{/each}
                      </select>
                    </div>
                    <button onclick={handleExportStudentsByYear} disabled={isExportingByYear || !selectedAno} style="padding: 1rem; background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-hover) 100%); border: none; color: white; border-radius: 12px; cursor: pointer; font-size: 1rem; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 0.8rem; opacity: {(isExportingByYear || !selectedAno) ? 0.6 : 1};">
                      {#if isExportingByYear}
                        <div style="width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2); border-top: 2px solid white; border-radius: 50%; animation: spin 1s linear infinite;"></div> Generando Excel...
                      {:else}<span style="font-size: 1.2rem;">📋</span> Exportar Todos los Estudiantes ({anos.find(a => a.id === selectedAno)?.nombre || "Año"}){/if}
                    </button>
                  </div>
                </div>

                <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(var(--primary-rgb), 0.05); border-radius: 12px; border: 1px solid rgba(var(--primary-rgb), 0.2);">
                  <h5 style="margin: 0 0 0.5rem 0; color: var(--primary-color);">💡 Consejos Pro</h5>
                  <ul style="color: #94a3b8; font-size: 0.85rem; padding-left: 1.2rem; margin: 0; line-height: 1.6;">
                    <li><strong style="color: #e2e8f0;">Exportar por Colegio:</strong> Genera un Excel con una sola hoja conteniendo los estudiantes de un colegio específico.</li>
                    <li><strong style="color: #e2e8f0;">Exportar por Año Lectivo:</strong> Genera un Excel con múltiples hojas, una por cada colegio.</li>
                    <li>Cada hoja incluye: Nombre, Sexo, Grado, Sección, Teléfono, Email y Dirección.</li>
                    <li>Los datos se ordenan automáticamente: Grado (orden natural), Sección, y luego Nombre.</li>
                    <li>Ideal para auditorías de fin de año, imprimir listados por colegio, o enviar reportes específicos.</li>
                  </ul>
                </div>
              </div>
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
                  <button onclick={handleImportDB} style="padding: 0.6rem 1rem; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border: none; color: white; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">📥 Importar Todo</button>
                  <button onclick={handleImportDB} style="padding: 0.6rem 1rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">📊 Base de Datos</button>
                  <button onclick={async () => { await emit("show-toast", { message: "ℹ️ Funcionalidad no implementada.", type: "info" }); }} style="padding: 0.6rem 1rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #e2e8f0; border-radius: 8px; cursor: pointer; font-size: 0.9rem;">⚙️ Configuración</button>
                  <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.5rem;">⚠️ La importación sobrescribirá los datos actuales.</div>
                </div>
              </div>
              <div style="background: rgba(239, 68, 68, 0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.2); margin-top: 1.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;"><span style="font-size: 1.2rem;">⚠️</span><h5 style="margin: 0; color: #f87171; font-size: 1rem;">Zona de Peligro (Reset)</h5></div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
                  <button onclick={handleResetLocalDB} style="padding: 0.6rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">🗑️ Reiniciar DB Local</button>
                  <button onclick={handleResetRemoteDB} style="padding: 0.6rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="margin-right: 6px; vertical-align: middle;"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Limpiar Nube</button>
                  <button onclick={handleWipeProfileData} disabled={isWipingProfile} style="padding: 0.6rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600; opacity: {isWipingProfile ? 0.6 : 1};">{isWipingProfile ? "⏳ Purgando…" : "🧨 Purgar Perfil (Nube + Local)"}</button>
                  <button onclick={handleFactoryReset} style="padding: 0.6rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600;">🔄 Restablecer valores de fábrica</button>
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.75rem;">🧨 <strong>Purgar Perfil</strong>: vacía la nube D1 de esta cuenta Y reinicia la base local. Úsalo antes de importar una base de datos buena para evitar mezclas con datos viejos.</div>
              </div>
              <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-top: 1.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;"><span style="font-size: 1.2rem;">📊</span><h5 style="margin: 0; color: #e2e8f0; font-size: 1rem;">Información del Sistema</h5></div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
                  <div><div style="font-size: 0.8rem; color: #64748b; margin-bottom: 0.25rem;">Versión App</div><div style="color: #e2e8f0; font-weight: 600;">1.2.0</div></div>
                  <div><div style="font-size: 0.8rem; color: #64748b; margin-bottom: 0.25rem;">Ruta DB</div><div style="color: #e2e8f0; font-size: 0.8rem; word-break: break-all;">{dbPath}</div></div>
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
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
    gap: 1.25rem;
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
  /* ── Switch redondeado moderno (toggle de notificaciones) ── */
  .notif-hero .switch {
    position: relative;
    display: inline-block;
    width: 52px;
    height: 30px;
    margin: 0;
  }
  .notif-hero .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .notif-hero .slider {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .notif-hero .slider::before {
    content: '';
    position: absolute;
    width: 22px;
    height: 22px;
    left: 4px;
    top: 50%;
    transform: translateY(-50%);
    background: #cbd5e1;
    border-radius: 50%;
    transition: all 0.3s cubic-bezier(0.34, 1.3, 0.64, 1);
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  }
  .notif-hero .switch input:checked + .slider {
    background: linear-gradient(135deg, #22c55e, #16a34a);
    border-color: transparent;
    box-shadow: 0 0 12px rgba(34,197,94,0.35);
  }
  .notif-hero .switch input:checked + .slider::before {
    transform: translateY(-50%) translateX(21px);
    background: #fff;
  }

  /* ── Notificaciones (glassmorphism, solo Android) ── */
  .notif-page { display: flex; flex-direction: column; gap: 0.75rem; }
  .notif-hero {
    display: flex; align-items: center; gap: 0.9rem;
    padding: 1rem 1.1rem; border-radius: 18px;
    background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(139,92,246,0.06));
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.09);
    box-shadow: 0 8px 28px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05);
  }
  .notif-hero-icon {
    width: 46px; height: 46px; border-radius: 14px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 1.3rem;
    background: rgba(245,158,11,0.14); border: 1px solid rgba(245,158,11,0.28);
    backdrop-filter: blur(10px);
  }
  .notif-colegio-card {
    border-radius: 16px; overflow: hidden;
    background: rgba(255,255,255,0.02);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255,255,255,0.07);
    transition: all 0.2s ease;
  }
  .notif-colegio-card.activa {
    border-color: rgba(var(--primary-rgb), 0.35);
    background: rgba(var(--primary-rgb), 0.04);
  }
  .notif-colegio-head {
    display: flex; align-items: center; gap: 0.7rem;
    padding: 0.8rem 0.9rem; cursor: pointer; user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .notif-colegio-head:active { background: rgba(255,255,255,0.04); }
  .notif-check {
    width: 20px; height: 20px; border-radius: 6px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.65rem; font-weight: 800; color: #fff;
    border: 2px solid rgba(255,255,255,0.2);
    transition: all 0.2s ease;
  }
  .activa .notif-check { background: var(--primary-color); border-color: var(--primary-color); box-shadow: 0 0 10px rgba(var(--primary-rgb), 0.4); }
  .notif-colegio-nombre { flex: 1; min-width: 0; font-size: 0.88rem; font-weight: 600; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .notif-colegio-body { display: flex; gap: 0.5rem; padding: 0 0.9rem 0.5rem; }
  .notif-campo { flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .notif-campo label {
    font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.5px;
    color: #64748b; font-weight: 700;
  }
  .notif-campo input, .notif-campo select {
    width: 100%; padding: 0.45rem 0.55rem; border-radius: 9px; box-sizing: border-box;
    border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.25); color: #e2e8f0;
    font-size: 0.85rem; outline: none; text-align: center;
  }
  .notif-campo input:focus, .notif-campo select:focus { border-color: var(--primary-color); }
  .notif-resumen {
    margin: 0 0.9rem 0.75rem; padding: 0.35rem 0.6rem; border-radius: 8px;
    font-size: 0.68rem; color: #94a3b8;
    background: rgba(0,0,0,0.2); border-left: 3px solid var(--primary-color);
  }
  .notif-btn-primary {
    height: 44px; border-radius: 12px; border: none; cursor: pointer;
    background: linear-gradient(135deg, var(--primary-color), var(--primary-hover));
    color: #fff; font-weight: 700; font-size: 0.85rem;
    box-shadow: 0 4px 14px rgba(var(--primary-rgb), 0.3);
  }
  .notif-btn-primary:disabled { opacity: 0.6; }
  .notif-btn-ghost {
    height: 44px; border-radius: 12px; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
    color: #cbd5e1; font-weight: 600; font-size: 0.82rem;
  }
  .notif-btn-mini {
    padding: 0.35rem 0.75rem; border-radius: 8px; cursor: pointer;
    border: 1px solid rgba(16,185,129,0.4); background: rgba(16,185,129,0.15);
    color: #6ee7b7; font-weight: 600; font-size: 0.72rem;
  }
  .notif-banner-ok {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.8rem 0.95rem; border-radius: 12px; font-size: 0.8rem; color: #6ee7b7;
    background: rgba(16,185,129,0.08); backdrop-filter: blur(12px);
    border: 1px solid rgba(16,185,129,0.28);
  }
  .notif-nota {
    padding: 0.75rem 0.9rem; border-radius: 12px;
    font-size: 0.7rem; color: #fde68a; line-height: 1.5;
    background: rgba(250,204,21,0.07); border: 1px solid rgba(250,204,21,0.18);
    backdrop-filter: blur(12px);
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
