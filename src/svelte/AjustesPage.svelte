<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { copyFile, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
  import * as XLSX from "xlsx";
  import { syncService, syncManager, type SyncStatus } from "../lib/syncService";
  import { getTursoUrl, getTursoToken, saveTursoCredentials, clearTursoCredentials } from "../lib/tursoClient";
  import GoogleDriveBackup from "./GoogleDriveBackup.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; }

  function getThemeColor(color: string): string {
    return { mint: "#10b981", carmesi: "#ef4444", amarillo: "#eab308", rosado: "#ec4899", azul: "#3b82f6" }[color] || "#10b981";
  }
  function getThemeName(color: string): string {
    return { mint: "Mint", carmesi: "Carmesí", amarillo: "Amarillo", rosado: "Rosado", azul: "Azul" }[color] || "Mint";
  }

  const PRESET_COLORS = ["#000000","#7f7f7f","#880015","#ed1c24","#ff7f27","#fff200","#22b14c","#00a2e8","#3f48cc","#a349a4","#ffffff","#c3c3c3","#b97a57","#ffaec9","#ffc90e","#efe4b0","#b5e61d","#99d9ea","#7092be","#c8bfe7","#C00000","#FF0000","#FFC000","#FFFF00","#92D050","#00B050","#00B0F0","#0070C0","#002060","#7030A0"];

  const TABS = [
    { id: "configuracion", label: "General", icon: "⚙️" },
    { id: "apariencia", label: "Diseño", icon: "🎨" },
    { id: "calificaciones", label: "Notas", icon: "⭐" },
    { id: "sync", label: "Sync", icon: "cloud" },
    { id: "google-drive", label: "Drive", icon: "☁️" },
    { id: "almacenamiento", label: "Almacén", icon: "📦" },
    { id: "debugging", label: "Debug", icon: "🐛" },
    { id: "acercaDe", label: "Info", icon: "📖" },
  ] as const;

  const isAndroid = /Android/i.test(navigator.userAgent);

  let activeTab: typeof TABS[number]["id"] | null = $state(isAndroid ? null : "configuracion");
  let theme = $state(localStorage.getItem("app-theme") || "mint");
  let dbPath = $state("");
  let gradeConfigs = $state<{ id: string; nombre: string; color: string; minimo: number }[]>([]);
  let highlightColor = $state(localStorage.getItem("student-highlight-color") || "#4ade80");
  let orientation = $state(localStorage.getItem("app-orientation") || "any");
  let currentUserId = $state("");
  let showUserIdBox = $state(false);
  let anos: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let selectedAno = $state(0);
  let selectedColegio = $state(0);
  let isExportingExcel = $state(false);
  let isExportingByYear = $state(false);
  let isSynced = $state(!!getTursoUrl());
  let syncStatus = $state<{ status: SyncStatus; lastSync: string | null; lastSyncDetails: string | null; message: string | null; }>({ status: "idle", lastSync: null, lastSyncDetails: null, message: null });
  let showServerConfig = $state(false);
  let tursoUrl = $state(getTursoUrl());
  let tursoToken = $state(getTursoToken());
  let tursoTesting = $state(false);
  let tursoStatus: 'idle' | 'online' | 'offline' = $state('idle');
  let tursoLatency: number | null = $state(null);
  let tursoError: string | null = $state(null);
  let syncInterval = $state(parseInt(localStorage.getItem('periodic_sync_interval_seconds') || '10', 10));
  let showResetConfirm = $state(false);
  let resetConfig = $state<{ title: string; message: string; onConfirm: () => Promise<void>; isDanger?: boolean; } | null>(null);
  let isProcessingReset = $state(false);

  $effect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("app-theme", theme); });
  $effect(() => { localStorage.setItem("student-highlight-color", highlightColor); });

  function getGradeLabel(id: string): string {
    return { 'AA': 'Aprendizaje Avanzado', 'AS': 'Aprendizaje Satisfactorio', 'AF': 'Aprendizaje Fundamental', 'AI': 'Aprendizaje Inicial' }[id] || id;
  }
  function getGradeDisplayName(id: string): string {
    const label = getGradeLabel(id); return label !== id ? `${id}: ${label}` : id;
  }

  onMount(() => {
    const unsub = syncManager.subscribe((state) => { syncStatus = state; });
    invoke<{ id: string; nombre: string; color: string; minimo: number }[]>("get_grade_configs").then(d => gradeConfigs = d).catch(e => console.error("Error fetching grade configs:", e));
    invoke<string>("get_db_path").then(p => dbPath = p).catch(e => console.error("Error fetching db path:", e));
    Promise.all([invoke<CategoryItem[]>("get_anos"), invoke<CategoryItem[]>("get_colegios")]).then(([aData, cData]) => {
      anos = aData; colegios = cData;
      const activeYear = aData.find(a => a.activo) || aData[0]; if (activeYear) selectedAno = activeYear.id;
      const activeColegio = cData.find(c => c.activo) || cData[0]; if (activeColegio) selectedColegio = activeColegio.id;
    }).catch(e => console.error("Error fetching catalogs:", e));
    return () => unsub();
  });

  async function handleUpdateGradeConfig(id: string, nombre: string, color: string, minimo: number) {
    let v = minimo; if (id !== "AI") { if (v < 0) v = 0; if (v > 100) v = 100; } else v = 0;
    try {
      await invoke("update_grade_config", { id, nombre, color, minimo: v });
      gradeConfigs = gradeConfigs.map(c => c.id === id ? { ...c, nombre, color, minimo: v } : c);
      syncService.syncAllSilent().catch(e => console.warn("Auto-sync:", e));
      await emit("grade-configs-updated");
    } catch (error) {
      console.error("Error updating grade config:", error);
      await emit("show-toast", { message: "❌ Error al actualizar la configuración: " + error, type: "error" });
    }
  }

  function handleUpdateHighlightColor(color: string) { highlightColor = color; emit("highlight-color-updated", color); }

  async function handleUpdateOrientation(newOrientation: string) {
    orientation = newOrientation; localStorage.setItem("app-orientation", newOrientation);
    if (isAndroid) {
      try {
        const lockType = newOrientation === "portrait" ? "portrait-primary" : newOrientation === "landscape" ? "landscape-primary" : "any";
        if (lockType === "any") (screen.orientation as any).unlock?.();
        else await (screen.orientation as any).lock?.(lockType).catch(() => {});
        const { invoke: inv } = await import("@tauri-apps/api/core"); await inv("set_orientation", { orientation: newOrientation });
      } catch (e) { console.error("Error al cambiar orientación:", e); }
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

  function handleResetLocalDB() {
    resetConfig = { title: "⚠️ Reiniciar Base de Datos Local", message: "¿Estás SEGURO de que quieres reiniciar la base de datos LOCAL?\n\nSe borrarán todos los estudiantes, notas, asistencias y configuraciones.\nEsta acción no se puede deshacer.", isDanger: true, onConfirm: async () => {
      try { await invoke("reset_local_database"); await emit("catalog-updated"); await emit("show-toast", { message: "✅ Base de datos local reiniciada.", type: "success" }); }
      catch (error) { await emit("show-toast", { message: "❌ Error al reiniciar DB: " + error, type: "error" }); }
    } }; showResetConfirm = true;
  }

  function handleResetRemoteDB() {
    resetConfig = { title: "🚨 Limpiar Datos en Sync", message: "¡ATENCIÓN! ¿Estás SEGURO de limpiar los datos sincronizados?\n\nSe borrarán PERMANENTEMENTE todos tus datos en el servidor.", isDanger: true, onConfirm: async () => {
      try { await syncService.wipeRemoteData(); await emit("show-toast", { message: "✅ Datos en la nube eliminados.", type: "success" }); }
      catch (error) { await emit("show-toast", { message: "❌ Error al limpiar nube.", type: "error" }); }
    } }; showResetConfirm = true;
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

  async function handleConnectTurso() {
    tursoTesting = true; tursoError = null;
    try {
      const result = await syncService.connectAndSetup(tursoUrl, tursoToken);
      if (result.ok) { isSynced = true; tursoStatus = 'online'; syncService.ensurePeriodicSync(); syncService.syncAllSilent(); }
      else tursoError = result.error || 'Error de conexión';
    } catch (e: any) { tursoError = e?.message || String(e); }
    tursoTesting = false;
  }
</script>

<div class="page-container" style="display: block;">
  <style>{`
    .ajustes-ribbon-container { position: sticky; top: 0; z-index: 1000; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255, 255, 255, 0.1); margin: 0 -1rem 1.5rem -1rem; overflow-x: auto; scrollbar-width: none; }
    .ajustes-ribbon-container::-webkit-scrollbar { display: none; }
    .ajustes-ribbon { display: flex; padding: 0.5rem; gap: 0.4rem; min-width: max-content; }
    .ajustes-tab { padding: 0.6rem 1.2rem; border-radius: 8px; border: none; background: transparent; color: #94a3b8; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; align-items: center; gap: 0.5rem; }
    .ajustes-tab.active { color: white; background: rgba(var(--primary-rgb, 59, 130, 246), 0.2); box-shadow: 0 0 10px rgba(var(--primary-rgb, 59, 130, 246), 0.1); border-bottom: 2px solid var(--primary-color, #3b82f6); }
    .ajustes-tab:hover:not(.active) { background: rgba(255, 255, 255, 0.05); color: #e2e8f0; }
    .sync-dot-mini { width: 6px; height: 6px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 5px #4ade80; flex-shrink: 0; }
    .tab-label { display: inline-block; transition: all 0.3s ease; }
    @media (max-width: 1024px) {
      .ajustes-ribbon-container { margin: 0 -1rem 1.5rem -1rem !important; overflow: hidden !important; border-radius: 0 !important; }
      .ajustes-ribbon { display: flex !important; justify-content: space-around !important; padding: 0.5rem !important; gap: 4px !important; min-width: 0 !important; width: 100% !important; }
      .ajustes-tab { padding: 0.6rem 0.5rem !important; flex: 0 1 auto !important; justify-content: center !important; border-radius: 12px !important; gap: 0 !important; transition: all 0.2s ease-in-out !important; position: relative !important; }
      .ajustes-tab .tab-label { display: none !important; }
      .ajustes-tab.active { flex: 1 1 auto !important; background: rgba(var(--primary-rgb, 59, 130, 246), 0.15) !important; border-bottom: 2px solid var(--primary-color, #3b82f6) !important; gap: 0.4rem !important; padding: 0.6rem 1rem !important; }
      .ajustes-tab.active .tab-label { display: inline-block !important; font-size: 0.85rem !important; white-space: nowrap !important; }
      .sync-dot-mini { position: absolute !important; top: 6px; right: 6px; width: 8px !important; height: 8px !important; }
    }
  `}</style>

  {#if !isAndroid}
    <div class="ajustes-ribbon-container">
      <div class="ajustes-ribbon">
        {#each TABS as tab (tab.id)}
          <button class="ajustes-tab" class:active={activeTab === tab.id} onclick={() => activeTab = tab.id}>
            {#if tab.icon === "cloud"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="flex-shrink: 0;"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="cloudGrad" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="#60A5FA"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs></svg>
            {:else}
              <span style="font-size: 1.1rem;">{tab.icon}</span>
            {/if}
            <span class="tab-label">{tab.label}</span>
            {#if tab.id === "sync" && isSynced}<span class="sync-dot-mini"></span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if isAndroid && activeTab === null}
    <div style="padding: 1rem;">
      <h1 style="font-size: 1.5rem; font-weight: 700; color: #f1f5f9; margin-bottom: 1.5rem; text-align: center;">Ajustes</h1>
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        {#each TABS as tab (tab.id)}
          <button onclick={() => activeTab = tab.id} style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; background: rgba(51, 65, 85, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; cursor: pointer; width: 100%;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <div style="width: 4px; height: 40px; background: linear-gradient(180deg, var(--primary-color, #3b82f6) 0%, #1d4ed8 100%); border-radius: 2px;"></div>
              {#if tab.icon === "cloud"}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="flex-shrink: 0;"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGradMenu)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="cloudGradMenu" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="#60A5FA"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs></svg>
              {:else}<span style="font-size: 1.25rem;">{tab.icon}</span>{/if}
              <span style="font-size: 1rem; font-weight: 600; color: #e2e8f0; text-align: left;">{tab.label}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              {#if tab.id === "sync" && isSynced}<span class="sync-dot-mini" style="position: static; display: inline-block;"></span>{/if}
              <span style="font-size: 1.25rem; color: #64748b;">→</span>
            </div>
          </button>
        {/each}
      </div>
    </div>
  {:else if activeTab !== null}
    <div style="padding: isAndroid ? '1rem' : '0'">
      {#if isAndroid}
        <button onclick={() => activeTab = null} style="display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; background: rgba(51, 65, 85, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; cursor: pointer; margin-bottom: 1.5rem; width: 100%;">
          <span style="font-size: 1.25rem;">←</span>
          <span style="font-size: 0.95rem; font-weight: 600; color: #94a3b8;">Volver a Ajustes</span>
        </button>
      {/if}
      <div class="settings-content-wrapper">
        <!-- CONFIGURACIÓN -->
        {#if activeTab === "configuracion"}
          <div class="category-card">
            <div class="category-header"><h3>⚙️ Configuración del Sistema</h3></div>
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
              <div style="margin-bottom: 2rem;">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">📱 Orientación del Dispositivo</h4>
                <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Define la orientación predeterminada de la aplicación (solo aplicable en Android).</p>
                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.8rem;">
                    {#each [{ id: "any", label: "🔄 Automático", icon: "📱" }, { id: "portrait", label: "📱 Vertical", icon: "↕️" }, { id: "landscape", label: "🌅 Horizontal", icon: "↔️" }] as opt}
                      <button onclick={() => handleUpdateOrientation(opt.id)} style="padding: 1rem; border: {orientation === opt.id ? '2px solid #646cff' : '1px solid rgba(255,255,255,0.1)'}; border-radius: 10px; background: {orientation === opt.id ? 'rgba(100, 108, 255, 0.1)' : 'rgba(255,255,255,0.03)'}; color: {orientation === opt.id ? 'white' : '#94a3b8'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.2rem;">{opt.icon}</span>
                        <span style="font-size: 0.85rem; font-weight: {orientation === opt.id ? 'bold' : 'normal'};">{opt.label}</span>
                      </button>
                    {/each}
                  </div>
                  {#if !isAndroid}
                    <div style="margin-top: 1rem; padding: 0.6rem; border-radius: 6px; background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.2); display: flex; align-items: center; gap: 0.5rem;">
                      <span style="font-size: 0.9rem;">⚠️</span>
                      <p style="margin: 0; font-size: 0.75rem; color: #eab308;">Esta opción no tiene efecto en Windows. Se aplicará cuando uses la app en Android.</p>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- APARIENCIA -->
        {#if activeTab === "apariencia"}
          <div class="category-card">
            <div class="category-header"><h3>🎨 Apariencia</h3></div>
            <div style="padding: 2rem;">
              <div style="margin-bottom: 2rem;">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">Tema del Sistema</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 1rem;">
                  {#each ["mint", "carmesi", "amarillo", "rosado", "azul"] as color}
                    <button onclick={() => theme = color} style="padding: 1rem; border: 2px solid rgba(255,255,255,0.2); border-radius: 12px; background: {theme === color ? 'rgba(255,255,255,0.1)' : 'transparent'}; color: {theme === color ? 'white' : '#94a3b8'}; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                      <div style="width: 24px; height: 24px; border-radius: 50%; background-color: {getThemeColor(color)}; border: 2px solid rgba(255,255,255,0.3);"></div>
                      <span style="font-size: 0.9rem; font-weight: {theme === color ? 'bold' : 'normal'};">{getThemeName(color)}</span>
                    </button>
                  {/each}
                </div>
              </div>
              <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">Vista Previa</h4>
                <div style="display: flex; gap: 1rem; align-items: center;">
                  <div style="width: 32px; height: 32px; border-radius: 8px; background-color: {getThemeColor(theme)}; border: 2px solid rgba(255,255,255,0.3);"></div>
                  <span style="color: #e2e8f0; font-weight: bold;">Tema actual: {getThemeName(theme)}</span>
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- CALIFICACIONES -->
        {#if activeTab === "calificaciones"}
          <div class="category-card">
            <div class="category-header"><h3>⭐ Configuración de Calificaciones</h3></div>
            <div style="padding: 2rem;">
              <div style="margin-bottom: 2rem;">
                <h4 style="margin: 0 0 1rem 0; color: #e2e8f0;">Colores de Notas Cualitativas</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 1rem;">
                  {#each gradeConfigs as grade (grade.id)}
                    <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; gap: 0.8rem;">
                      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                        <span style="font-size: 1.5rem; font-weight: bold; color: {grade.color}; min-width: 40px;">{grade.id}: {grade.nombre}</span>
                        <div style="display: flex; align-items: center; gap: 0.8rem; flex: 1 1 auto; justify-content: flex-end; flex-wrap: wrap;">
                          {#if grade.id !== "AI"}
                            <div style="display: flex; flex-direction: column; gap: 0.2rem; align-items: flex-start;">
                              <label style="font-size: 0.7rem; color: #94a3b8;">Mínimo pts</label>
                              <input type="number" value={grade.minimo} oninput={(e) => handleUpdateGradeConfig(grade.id, grade.nombre, grade.color, parseInt((e.target as HTMLInputElement).value) || 0)} style="width: 55px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; padding: 0.3rem; font-size: 0.85rem; text-align: center;" />
                            </div>
                          {/if}
                          <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                            <label style="font-size: 0.7rem; color: #94a3b8;">Color</label>
                            <div style="width: 80px; height: 35px; border-radius: 8px; background: {grade.color}; border: 2px solid rgba(255,255,255,0.2); cursor: pointer; position: relative; overflow: hidden;" onclick={() => document.getElementById(`color-input-${grade.id}`)?.click()}>
                              <input id="color-input-{grade.id}" type="color" value={grade.color} oninput={(e) => handleUpdateGradeConfig(grade.id, grade.nombre, (e.target as HTMLInputElement).value, grade.minimo)} style="position: absolute; top: -10px; left: -10px; width: 200%; height: 200%; opacity: 0; cursor: pointer;" />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 0.2rem; justify-content: center;">
                        {#each PRESET_COLORS as preset}
                          <button onclick={() => handleUpdateGradeConfig(grade.id, grade.nombre, preset, grade.minimo)} style="width: 18px; height: 18px; background-color: {preset}; border: {grade.color.toLowerCase() === preset.toLowerCase() ? '2px solid white' : '1px solid rgba(255,255,255,0.2)'}; border-radius: 4px; cursor: pointer; padding: 0;"></button>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- SYNC -->
        {#if activeTab === "sync"}
          <div class="category-card">
            <div class="category-header">
              <h3><span style="display: inline-flex; align-items: center; gap: 12px; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%); padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);"><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="cloudGrad2" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="#60A5FA"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs></svg>Sincronización en la Nube</span></h3>
            </div>

            {#if isSynced}
              <div style="padding: 0 1.5rem 1.5rem;">
                <div style="background: linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(96,165,250,0.04) 100%); border-radius: 14px; border: 1px solid rgba(59,130,246,0.12); padding: 1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 10px; height: 10px; border-radius: 50%; background: {syncStatus.status === 'syncing' ? '#eab308' : isSynced ? '#22c55e' : '#64748b'}; box-shadow: {isSynced ? '0 0 8px rgba(34,197,94,0.4)' : 'none'}; flex-shrink: 0;"></div>
                    <div>
                      <div style="color: #f1f5f9; font-weight: 600; font-size: 0.85rem;">{isSynced ? 'Conectado' : syncStatus.status === 'syncing' ? 'Sincronizando...' : 'Desconectado'}</div>
                      <div style="color: #64748b; font-size: 0.7rem; margin-top: 1px;">{syncStatus.lastSync ? `Última sync: ${new Date(syncStatus.lastSync).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Sin sincronizar'}</div>
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; color: #94a3b8;"><span>⚡</span><span>{syncInterval}s</span></div>
                    <div style="display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; color: #94a3b8; cursor: pointer;" onclick={() => showServerConfig = !showServerConfig}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></div>
                  </div>
                </div>

                {#if syncStatus.message}
                  <div style="margin-top: 8px; padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; border-left: 3px solid {syncStatus.status === 'error' ? '#ef4444' : '#3b82f6'}; background: rgba(0,0,0,0.2); color: {syncStatus.status === 'error' ? '#fca5a5' : '#93c5fd'};">
                    {syncStatus.message}
                  </div>
                {/if}

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 1rem;">
                  <button onclick={async () => { try { await syncService.pushAll(); } catch (e) {} }} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%); border: 1px solid rgba(34,197,94,0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span style="color: #22c55e; font-weight: 600; font-size: 0.85rem;">Subir datos</span>
                  </button>
                  <button onclick={() => syncService.pullAll()} disabled={syncStatus.status === 'syncing'} style="padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(59,130,246,0.04) 100%); border: 1px solid rgba(59,130,246,0.2); border-radius: 12px; cursor: pointer; opacity: {syncStatus.status === 'syncing' ? 0.5 : 1}; display: flex; align-items: center; justify-content: center; gap: 10px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span style="color: #60a5fa; font-weight: 600; font-size: 0.85rem;">Bajar datos</span>
                  </button>
                </div>

                {#if showServerConfig}
                  <div style="margin-top: 1rem; padding: 1rem 1.25rem; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.75rem;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg><span style="color: #cbd5e1; font-size: 0.85rem; font-weight: 600;">Configuración Turso</span></div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem;">
                      <input type="text" bind:value={tursoUrl} placeholder="libsql://mydb.turso.io" style="width: 100%; padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; outline: none; box-sizing: border-box;" />
                      <input type="password" bind:value={tursoToken} placeholder="Token de autenticación" style="width: 100%; padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; outline: none; box-sizing: border-box;" />
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                      <button onclick={handleConnectTurso} disabled={tursoTesting || !tursoUrl || !tursoToken} style="flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: none; background: {tursoTesting ? '#64748b' : 'var(--primary-color, #3b82f6)'}; color: #fff; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{tursoTesting ? 'Conectando...' : 'Conectar'}</button>
                      <button onclick={async () => { tursoTesting = true; tursoStatus = 'idle'; tursoLatency = null; tursoError = null; try { const result = await syncService.testConnection(tursoUrl, tursoToken); tursoLatency = result.latency; tursoStatus = result.ok ? 'online' : 'offline'; if (!result.ok) tursoError = result.error || 'Conexión fallida'; } catch (e: any) { tursoStatus = 'offline'; tursoError = e?.message || String(e); } tursoTesting = false; }} disabled={tursoTesting || !tursoUrl || !tursoToken} style="padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 600; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">{tursoTesting ? '...' : 'Probar'}</button>
                    </div>
                    {#if tursoStatus !== 'idle'}
                      <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; margin-top: 0.5rem; background: {tursoStatus === 'online' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}; color: {tursoStatus === 'online' ? '#4ade80' : '#f87171'};">
                        {tursoStatus === 'online' ? `✅ Conectado (${tursoLatency}ms)` : `❌ ${tursoError || `Sin conexión (${tursoLatency}ms)`}`}
                      </div>
                    {/if}
                    <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                      <button onclick={async () => { try { const result = await syncService.testConnection(tursoUrl, tursoToken); if (!result.ok) { tursoError = result.error || 'Conexión fallida'; tursoStatus = 'offline'; return; } const sr = await syncService.runSchemaSetup(); if (!sr.ok) tursoError = sr.error || 'Error creando schema'; else tursoStatus = 'online'; } catch (e: any) { tursoError = e?.message || String(e); } }} disabled={!tursoUrl || !tursoToken} style="padding: 0.4rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: #94a3b8; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Ejecutar Schema</button>
                      <button onclick={() => { clearTursoCredentials(); tursoUrl = ''; tursoToken = ''; tursoStatus = 'idle'; isSynced = false; syncService.disconnect(); }} style="padding: 0.4rem 0.75rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.08); color: #f87171; font-weight: 500; font-size: 0.75rem; cursor: pointer;">Desconectar</button>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; padding-top: 0.75rem; margin-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06);">
                      <span style="color: #94a3b8; font-size: 0.8rem;">Sync periódico:</span>
                      <input type="number" min={3} max={300} bind:value={syncInterval} oninput={() => { localStorage.setItem('periodic_sync_interval_seconds', String(syncInterval)); syncService.ensurePeriodicSync(); }} style="width: 56px; padding: 0.25rem 0.4rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.8rem; font-family: monospace; text-align: center; outline: none;" />
                      <span style="color: #64748b; font-size: 0.8rem;">segundos</span>
                    </div>
                  </div>
                {/if}

                <div style="margin-top: 1rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
                  {#each [{ icon: '💻', title: 'Local-First', desc: 'Datos seguros en tu PC' }, { icon: '☁️', title: 'Turso Cloud', desc: 'Siempre disponible' }, { icon: '📴', title: 'Offline', desc: 'Trabaja sin internet' }, { icon: '🔄', title: 'Periódico', desc: `Cada ${syncInterval}s` }] as item}
                    <div style="padding: 0.75rem; background: rgba(0,0,0,0.15); border-radius: 10px; text-align: center;">
                      <div style="font-size: 1.1rem; margin-bottom: 2px;">{item.icon}</div>
                      <div style="font-size: 0.75rem; color: #f1f5f9; font-weight: 600;">{item.title}</div>
                      <div style="font-size: 0.65rem; color: #64748b; margin-top: 1px;">{item.desc}</div>
                    </div>
                  {/each}
                </div>
              </div>
            {:else}
              <div style="padding: 1.5rem 1.5rem 2.5rem; text-align: center;">
                <div style="color: #64748b; font-size: 0.9rem; margin-bottom: 1.5rem;">Conectá tu base de datos Turso para sincronizar datos entre dispositivos.</div>
                <div style="max-width: 400px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.5rem;">
                  <input type="text" bind:value={tursoUrl} placeholder="libsql://mydb.turso.io" style="width: 100%; padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.85rem; font-family: monospace; outline: none; box-sizing: border-box;" />
                  <input type="password" bind:value={tursoToken} placeholder="Token de autenticación" style="width: 100%; padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); color: #e2e8f0; font-size: 0.85rem; font-family: monospace; outline: none; box-sizing: border-box;" />
                  <button onclick={handleConnectTurso} disabled={tursoTesting || !tursoUrl || !tursoToken} style="padding: 0.6rem 1rem; border-radius: 8px; border: none; background: {tursoTesting ? '#64748b' : 'var(--primary-color, #3b82f6)'}; color: #fff; font-weight: 600; font-size: 0.85rem; cursor: pointer;">{tursoTesting ? 'Conectando...' : 'Conectar a Turso'}</button>
                  {#if tursoError}<div style="color: #f87171; font-size: 0.75rem; margin-top: 0.5rem;">❌ {tursoError}</div>{/if}
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- GOOGLE DRIVE -->
        {#if activeTab === "google-drive"}
          <div class="category-card">
            <div class="category-header"><h3>☁️ Respaldo en Google Drive</h3></div>
            <div style="padding: 2rem;"><GoogleDriveBackup /></div>
          </div>
        {/if}

        <!-- ALMACENAMIENTO -->
        {#if activeTab === "almacenamiento"}
          <div class="category-card">
            <div class="category-header"><h3>📦 Almacenamiento y Reportes</h3></div>
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
                  <h5 style="margin: 0 0 1rem 0; color: #60a5fa; font-size: 0.95rem; font-weight: 600;">📁 Exportar Todos los Estudiantes por Año Lectivo</h5>
                  <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem;">Exporta todos los estudiantes de todos los colegios para un año lectivo específico.</p>
                  <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                      <label style="font-size: 0.8rem; color: #94a3b8; font-weight: bold;">Año Lectivo</label>
                      <select bind:value={selectedAno} style="padding: 0.8rem; border-radius: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.1); color: white; outline: none; width: 100%; box-sizing: border-box;">
                        <option value={0}>Seleccione año...</option>
                        {#each anos as a (a.id)}<option value={a.id}>{a.nombre}</option>{/each}
                      </select>
                    </div>
                    <button onclick={handleExportStudentsByYear} disabled={isExportingByYear || !selectedAno} style="padding: 1rem; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border: none; color: white; border-radius: 12px; cursor: pointer; font-size: 1rem; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 0.8rem; opacity: {(isExportingByYear || !selectedAno) ? 0.6 : 1};">
                      {#if isExportingByYear}
                        <div style="width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2); border-top: 2px solid white; border-radius: 50%; animation: spin 1s linear infinite;"></div> Generando Excel...
                      {:else}<span style="font-size: 1.2rem;">📋</span> Exportar Todos los Estudiantes ({anos.find(a => a.id === selectedAno)?.nombre || "Año"}){/if}
                    </button>
                  </div>
                </div>

                <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(59, 130, 246, 0.05); border-radius: 12px; border: 1px solid rgba(59, 130, 246, 0.2);">
                  <h5 style="margin: 0 0 0.5rem 0; color: #60a5fa;">💡 Consejos Pro</h5>
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
          <div class="category-card">
            <div class="category-header"><h3>🐛 Debugging</h3></div>
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
                </div>
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
          <div class="category-card">
            <div class="category-header"><h3>📖 Acerca de la Aplicación</h3></div>
            <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem;">
              <div style="text-align: center;">
                <h2 style="margin: 0 0 0.5rem 0; font-size: 2.5rem; background: linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">📊 GESTIÓN DE NOTAS</h2>
                <p style="color: #94a3b8; font-size: 1.1rem; margin: 0;">Sistema de Gestión Académica Profesional</p>
                <div style="display: inline-block; margin-top: 0.5rem; padding: 0.2rem 0.8rem; background: rgba(255,255,255,0.05); border-radius: 20px; font-size: 0.8rem; color: var(--primary-color); border: 1px solid var(--primary-color);">v1.2.0 - Android & Cloud Edition</div>
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; text-align: center;">
                {#each [{ icon: "📱", title: "Mobile First", desc: "Interfaz optimizada" }, { icon: "☁️", title: "Cloud Sync", desc: "PocketBase Sync" }, { icon: "🎨", title: "Personalizable", desc: "Temas dinámicos" }, { icon: "🛡️", title: "Seguridad", desc: "Local Storage" }] as card}
                  <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">{card.icon}</div>
                    <div style="font-weight: bold;">{card.title}</div>
                    <div style="font-size: 0.8rem; color: #94a3b8;">{card.desc}</div>
                  </div>
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
                  <div><div style="font-weight: bold; color: #a855f7; margin-bottom: 0.5rem;">Data & Cloud</div><ul style="color: #94a3b8; font-size: 0.8rem; padding-left: 1.2rem;"><li>SQLite Local</li><li>PocketBase</li><li>SQLite Remoto</li></ul></div>
                </div>
              </div>
              <div style="text-align: center; color: #64748b; font-size: 0.9rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem;">Desarrollado con ❤️ por Keimer - v1.2.0</div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showResetConfirm && resetConfig}
    <div class="modal-overlay" style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);">
      <div class="modal-content category-card" style="width: 450px;">
        <div class="category-header"><h3>{resetConfig.title}</h3></div>
        <div style="padding: 1.5rem;">
          <p style="color: #94a3b8; white-space: pre-wrap;">{resetConfig.message}</p>
          <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 2rem;">
            <button class="cancel" onclick={() => showResetConfirm = false}>Cancelar</button>
            <button class="primary" onclick={async () => { isProcessingReset = true; await resetConfig.onConfirm(); showResetConfirm = false; isProcessingReset = false; }} style="background-color: #ef4444;">{isProcessingReset ? "..." : "Confirmar"}</button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
