<script lang="ts">
  /**
   * DebugPage — gestion de datos: almacenamiento, importacion/exportacion,
   * zona de peligro (reinicio local / purga de perfil) e informacion del sistema.
   *
   * Extraido de AjustesPage.svelte, donde el markup estaba DUPLICADO: una copia
   * en la rama de escritorio (dentro de `.ajustes-grid`) y otra en la de Android.
   * Ahora hay un solo modulo que ambas ramas renderizan.
   *
   * El wrapper es full-bleed a proposito: igual que NotificacionesPage, sin
   * padding lateral ni wrappers intermedios, para que la card ocupe todo el
   * ancho disponible en pantallas angostas.
   */
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { open, save, ask } from "@tauri-apps/plugin-dialog";
  import { copyFile, BaseDirectory } from "@tauri-apps/plugin-fs";

  const isAndroid = /Android/i.test(navigator.userAgent);
  const ACCENT = "#ef4444";

  let dbPath = $state("");
  let isImporting = $state(false);
  let isWipingProfile = $state(false);

  invoke<string>("get_db_path").then(p => dbPath = p).catch(() => dbPath = "");

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
        await emit("show-toast", { message: "✅ Base de datos exportada a Descargas", type: "success" });
        return;
      }
      const dest = await save({ filters: [{ name: "Database File", extensions: ["db"] }], defaultPath: backupFileName("db") });
      if (dest) { await copyFile(dbFile, dest); await emit("show-toast", { message: "✅ Base de datos exportada", type: "success" }); }
    } catch (error) { await emit("show-toast", { message: "❌ Error al exportar: " + error, type: "error" }); }
  }

  async function handleImportDB() {
    try {
      const source = await open({ filters: [{ name: "Database File", extensions: ["db"] }], multiple: false });
      if (source && typeof source === "string") {
        isImporting = true;
        const dbFile = await invoke<string>("get_db_path");
        await copyFile(source, dbFile);
        // Reabrir la conexión Y correr migraciones: un backup de una versión
        // anterior puede carecer de tablas nuevas (colegio_grado, dia_sin_clases,
        // columna tipo, …). Sin esto el sync D1 falla con "no such table".
        try {
          await invoke("gd_reload_database");
          await emit("catalog-updated");
          await emit("data-updated");
        } catch (e) { console.warn("[Import] Post-import migrate/reload:", e); }
        // Sync COMPLETO automático tras importar un backup completo:
        // 1) RESET de la nube: borra filas Y tombstones residuales de purgas
        //    previas. Sin esto los tombstones viajan a los dispositivos y borran
        //    las filas recién subidas ("los datos desaparecen al refrescar").
        // 2) full=true re-pushea TODAS las filas locales (ignora cursores viejos
        //    del d1_config importado) y deja la nube = la base importada.
        let sincronizada = 0;
        let syncErrores = "";
        try {
          await invoke("d1_reset_remote");
          const r = await invoke<any>("d1_sync_all", { full: true });
          const pushed = r?.pushed || {};
          sincronizada = typeof pushed === "number" ? pushed : Object.values(pushed).reduce((a: number, b: any) => a + Number(b || 0), 0);
        } catch (e) {
          syncErrores = String(e);
          console.error("[Import] reset/sync completo automático falló:", e);
        }
        if (syncErrores) {
          await emit("show-toast", { message: `✅ Base importada y migrada. ⚠️ Sync completo no pudo ejecutarse: ${syncErrores}.`, type: "warning" });
        } else {
          await emit("show-toast", { message: `✅ Base importada, migrada y sincronizada (${sincronizada} filas en la nube). Reinicie la app si algo no responde.`, type: "success" });
        }
      }
    } catch (error) { await emit("show-toast", { message: "❌ Error al importar: " + error, type: "error" }); }
    finally { isImporting = false; }
  }

  async function handleResetLocalDB() {
    const ok = await ask(
      "¿Estás SEGURO de que quieres reiniciar la base de datos LOCAL?\n\nSe borrarán todos los estudiantes, notas, asistencias y configuraciones.\nLa conexión a la nube se conserva (el próximo sync re-traerá tus datos).\nEsta acción no se puede deshacer.",
      { title: "⚠️ Reiniciar Base de Datos Local", kind: "warning", okLabel: "Confirmar", cancelLabel: "Cancelar" }
    );
    if (!ok) return;
    try {
      await invoke("reset_local_database");
      await emit("catalog-updated");
      await emit("data-updated");
      await emit("show-toast", { message: "✅ Base de datos local reiniciada. Recargando…", type: "success" });
      setTimeout(() => location.reload(), 1500);
    } catch (error) { await emit("show-toast", { message: "❌ Error al reiniciar DB: " + error, type: "error" }); }
  }

  /** Purga TOTAL del perfil logueado: vacía la nube D1 (school key activa) Y
   *  reinicia la base local, dejando el perfil en cero para importar una DB
   *  buena. La config de conexión (d1_config) se conserva. */
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

  async function handleSelectFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) await emit("show-toast", { message: "📁 Carpeta seleccionada: " + selected, type: "info" });
    } catch (error) { console.error("Error al seleccionar carpeta:", error); }
  }
</script>

<div class="dbg-page">
  <div class="category-card" style="border-left: 3px solid {ACCENT};">
    <div class="category-header" style="border-left: none;">
      <div style="width:36px;height:36px;border-radius:10px;background:{ACCENT}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">🐛</div>
      <h3>Debugging</h3>
    </div>
    <div style="padding: 2rem;">
      <div style="margin-bottom: 2rem;">
        <h4 style="color: #e2e8f0;">Gestión de Datos y Configuración</h4>
        <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem;">Configura la ubicación de almacenamiento y gestiona la importación/exportación de datos</p>
      </div>

      <div class="dbg-grid-2">
        <div class="dbg-box">
          <div class="dbg-box-head"><span style="font-size: 1.2rem;">📁</span><h5>Ubicación de Almacenamiento</h5></div>
          <div class="dbg-col">
            <button onclick={handleSelectFolder} class="dbg-btn">📂 Seleccionar Carpeta</button>
            <div class="dbg-hint">Carpeta actual: {dbPath || "Cargando..."}</div>
          </div>
        </div>
        <div class="dbg-box">
          <div class="dbg-box-head"><span style="font-size: 1.2rem;">📤</span><h5>Exportación de Datos</h5></div>
          <div class="dbg-col">
            <button onclick={handleExportDB} class="dbg-btn dbg-btn-verde">📤 Exportar Todo</button>
            <button onclick={handleExportDB} class="dbg-btn">🗄️ Base de Datos</button>
            <button onclick={async () => { await emit("show-toast", { message: "ℹ️ Funcionalidad no implementada.", type: "info" }); }} class="dbg-btn">⚙️ Configuración</button>
          </div>
        </div>
      </div>

      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📥</span><h5>Importación de Datos</h5></div>
        <div class="dbg-col">
          <button onclick={handleImportDB} disabled={isImporting} class="dbg-btn dbg-btn-rojo">
            {isImporting ? "⏳ Importando + sincronizando…" : "📥 Importar Todo"}
          </button>
          <button onclick={handleImportDB} class="dbg-btn">📊 Base de Datos</button>
          <button onclick={async () => { await emit("show-toast", { message: "ℹ️ Funcionalidad no implementada.", type: "info" }); }} class="dbg-btn">⚙️ Configuración</button>
          <div class="dbg-hint">⚠️ La importación sobrescribirá los datos actuales.</div>
        </div>
      </div>

      <div class="dbg-box dbg-box-peligro">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">⚠️</span><h5 class="dbg-peligro-titulo">Zona de Peligro (Reset)</h5></div>
        <div class="dbg-grid-peligro">
          <button onclick={handleResetLocalDB} title="Borra estudiantes, notas, asistencias y catálogos de este dispositivo y recarga la app. La conexión a la nube se conserva (el próximo sync re-traerá tus datos)." class="dbg-btn-peligro">
            🗑️ Reiniciar Local
          </button>
          <button onclick={handleWipeProfileData} disabled={isWipingProfile} title="Purga total: vacía la nube D1 de esta cuenta Y reinicia la base local, luego recarga. Úsalo antes de importar una DB buena." class="dbg-btn-peligro">
            {isWipingProfile ? "⏳ Purgando…" : "🧨 Purgar Perfil (Nube + Local)"}
          </button>
        </div>
        <div class="dbg-hint">🗑️ <strong>Reiniciar Local</strong>: solo este dispositivo, la nube queda intacta. 🧨 <strong>Purgar Perfil</strong>: vacía la nube D1 de esta cuenta Y reinicia la base local. Úsalo antes de importar una base de datos buena para evitar mezclas con datos viejos.</div>
      </div>

      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📊</span><h5>Información del Sistema</h5></div>
        <div class="dbg-grid-2">
          <div><div class="dbg-label">Versión App</div><div class="dbg-valor">1.2.0</div></div>
          <div><div class="dbg-label">Ruta DB</div><div class="dbg-valor dbg-path">{dbPath}</div></div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* Full-bleed: la card ocupa todo el ancho disponible, sin padding lateral ni
     wrappers intermedios que la puedan encoger. */
  .dbg-page {
    display: flex; flex-direction: column;
    align-items: stretch;
    width: 100%; max-width: 100%; min-width: 0;
    box-sizing: border-box;
  }
  .dbg-page > * { width: 100%; min-width: 0; box-sizing: border-box; }

  .dbg-grid-2 {
    display: grid; gap: 1.5rem; margin-bottom: 2rem;
    /* minmax(0,1fr) para que las columnas puedan encogerse en pantallas angostas */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  }
  .dbg-box {
    background: rgba(255,255,255,0.05);
    padding: 1.5rem; border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.1);
  }
  .dbg-box-peligro { background: rgba(239,68,68,0.05); border-color: rgba(239,68,68,0.2); margin-top: 1.5rem; }
  .dbg-box-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
  .dbg-box-head h5 { margin: 0; color: #e2e8f0; font-size: 1rem; }
  .dbg-peligro-titulo { color: #f87171 !important; }
  .dbg-col { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }

  .dbg-btn {
    width: 100%; padding: 0.6rem 1rem; cursor: pointer;
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    color: #e2e8f0; border-radius: 8px; font-size: 0.9rem;
    transition: all 0.2s ease;
  }
  .dbg-btn:hover { background: rgba(255,255,255,0.16); }
  .dbg-btn-verde { background: linear-gradient(135deg,#10b981 0%,#059669 100%); border: none; color: white; font-weight: 600; }
  .dbg-btn-rojo { background: linear-gradient(135deg,#ef4444 0%,#dc2626 100%); border: none; color: white; font-weight: 600; }
  .dbg-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .dbg-btn-peligro {
    width: 100%; padding: 0.6rem; cursor: pointer;
    background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
    color: #f87171; border-radius: 8px; font-size: 0.85rem; font-weight: 600;
    transition: all 0.2s ease;
  }
  .dbg-btn-peligro:hover { background: rgba(239,68,68,0.18); }
  .dbg-btn-peligro:disabled { opacity: 0.6; cursor: not-allowed; }
  .dbg-grid-peligro { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 1rem; }

  .dbg-hint { font-size: 0.8rem; color: #64748b; margin-top: 0.5rem; word-break: break-word; }
  .dbg-label { font-size: 0.8rem; color: #64748b; margin-bottom: 0.25rem; }
  .dbg-valor { color: #e2e8f0; font-weight: 600; }
  .dbg-path { font-size: 0.8rem; word-break: break-all; }

  @media (max-width: 640px) {
    .dbg-page > .category-card > div { padding: 1.1rem !important; }
    .dbg-box { padding: 1.1rem; }
  }
</style>
