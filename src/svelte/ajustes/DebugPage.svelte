<script lang="ts">
  /**
   * DebugPage — gestion de datos de la app.
   *
   * Solo tres acciones y la informacion del sistema: exportar, importar y
   * purgar. Se quitaron los botones que ya no servian:
   *   · "Seleccionar Carpeta"  -> solo mostraba un toast, no cambiaba nada.
   *   · "Base de Datos" x2     -> duplicaban Exportar/Importar exactamente.
   *   · "Configuracion" x2     -> mostraban "Funcionalidad no implementada".
   *   · "Reiniciar Local"      -> la purga ya reinicia la base local, asi que
   *                              quedaban dos botones para lo mismo.
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
      if (!source || typeof source !== "string") return;
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
        console.error("[Import] reset/sync automático falló:", e);
      }
      if (syncErrores) {
        await emit("show-toast", { message: `✅ Base importada y migrada. ⚠️ Sync completo no pudo ejecutarse: ${syncErrores}.`, type: "warning" });
      } else {
        await emit("show-toast", { message: `✅ Base importada, migrada y sincronizada (${sincronizada} filas en la nube). Reinicie la app si algo no responde.`, type: "success" });
      }
    } catch (error) { await emit("show-toast", { message: "❌ Error al importar: " + error, type: "error" }); }
    finally { isImporting = false; }
  }

  /**
   * Purga TOTAL del perfil: vacía la nube D1 (school key activa) Y reinicia la
   * base local, dejando el perfil en cero para importar una base buena. La
   * config de conexión (d1_config) se conserva.
   */
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
      // Vaciar la nube es best-effort: si D1 no está configurado, se sigue igual.
      let nubeOk = true;
      try {
        const r = await invoke<{ ok: boolean; deleted: number }>("d1_wipe_remote");
        console.log("[Wipe] nube purgada:", r);
      } catch (e) {
        nubeOk = false;
        console.warn("[Wipe] nube no purgada (¿D1 sin configurar?):", e);
      }
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
</script>

<div class="dbg-page">
  <div class="category-card" style="border-left: 3px solid {ACCENT};">
    <div class="category-header" style="border-left: none;">
      <div style="width:36px;height:36px;border-radius:10px;background:{ACCENT}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">🐛</div>
      <h3>Depuración y Datos</h3>
    </div>

    <div class="dbg-body">
      <!-- EXPORTAR -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📤</span><h5>Exportar datos</h5></div>
        <p class="dbg-desc">Guarda una copia completa de la base de datos {isAndroid ? "en la carpeta Descargas" : " donde elijas"}.</p>
        <button onclick={handleExportDB} class="dbg-btn dbg-btn-verde">📤 Exportar base de datos</button>
      </div>

      <!-- IMPORTAR -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📥</span><h5>Importar datos</h5></div>
        <p class="dbg-desc">Restaura desde un archivo <code>.db</code> exportado antes. Sobrescribe los datos actuales, corre las migraciones y sincroniza con la nube.</p>
        <button onclick={handleImportDB} disabled={isImporting} class="dbg-btn dbg-btn-rojo">
          {isImporting ? "⏳ Importando + sincronizando…" : "📥 Importar base de datos"}
        </button>
        <div class="dbg-hint">⚠️ La importación sobrescribirá los datos actuales.</div>
      </div>

      <!-- PURGAR -->
      <div class="dbg-box dbg-box-peligro">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">🧨</span><h5 class="dbg-peligro-titulo">Purgar perfil</h5></div>
        <p class="dbg-desc">Deja el perfil en cero: borra los datos de la <strong>nube</strong> de esta cuenta y reinicia la base <strong>local</strong>. Los demás dispositivos también perderán los datos.</p>
        <button onclick={handleWipeProfileData} disabled={isWipingProfile} class="dbg-btn-peligro">
          {isWipingProfile ? "⏳ Purgando…" : "🧨 Purgar perfil (Nube + Local)"}
        </button>
        <div class="dbg-hint">Úsalo solo si vas a importar una base buena justo después.</div>
      </div>

      <!-- SISTEMA -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📊</span><h5>Información del sistema</h5></div>
        <dl class="dbg-info">
          <div><dt>Versión de la app</dt><dd>1.2.0</dd></div>
          <div><dt>Ruta de la base de datos</dt><dd class="dbg-path">{dbPath || "Cargando…"}</dd></div>
          <div><dt>Plataforma</dt><dd>{isAndroid ? "Android" : "Escritorio"}</dd></div>
        </dl>
      </div>
    </div>
  </div>
</div>

<style>
  /* Full-bleed: la card ocupa todo el ancho disponible. */
  .dbg-page {
    display: flex; flex-direction: column;
    align-items: stretch;
    width: 100%; max-width: 100%; min-width: 0;
    box-sizing: border-box;
  }
  .dbg-page > * { width: 100%; min-width: 0; box-sizing: border-box; }
  .dbg-body { padding: 2rem; display: flex; flex-direction: column; gap: 1.25rem; }

  .dbg-box {
    background: rgba(255,255,255,0.05);
    padding: 1.5rem; border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.1);
  }
  .dbg-box-peligro { background: rgba(239,68,68,0.05); border-color: rgba(239,68,68,0.2); }
  .dbg-box-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
  .dbg-box-head h5 { margin: 0; color: #e2e8f0; font-size: 1rem; }
  .dbg-peligro-titulo { color: #f87171 !important; }
  .dbg-desc { margin: 0 0 0.9rem; color: #94a3b8; font-size: 0.82rem; line-height: 1.5; }
  .dbg-desc code {
    font-family: monospace; font-size: 0.95em;
    background: rgba(255,255,255,0.08); padding: 0.05rem 0.3rem; border-radius: 4px;
  }

  .dbg-btn, .dbg-btn-peligro {
    width: 100%; padding: 0.7rem 1rem; cursor: pointer;
    border-radius: 8px; font-size: 0.9rem; font-weight: 600;
    transition: all 0.2s ease;
  }
  .dbg-btn-verde { background: linear-gradient(135deg,#10b981,#059669); border: none; color: #fff; }
  .dbg-btn-verde:hover { filter: brightness(1.1); }
  .dbg-btn-rojo { background: linear-gradient(135deg,#ef4444,#dc2626); border: none; color: #fff; }
  .dbg-btn-rojo:hover { filter: brightness(1.1); }
  .dbg-btn-peligro {
    background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.4);
    color: #f87171;
  }
  .dbg-btn-peligro:hover { background: rgba(239,68,68,0.22); }
  .dbg-btn:disabled, .dbg-btn-peligro:disabled { opacity: 0.6; cursor: not-allowed; filter: none; }

  .dbg-hint { font-size: 0.78rem; color: #64748b; margin-top: 0.6rem; word-break: break-word; }

  .dbg-info { margin: 0; display: flex; flex-direction: column; gap: 0.7rem; }
  .dbg-info > div { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .dbg-info dt { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  .dbg-info dd { margin: 0; color: #e2e8f0; font-weight: 600; }
  .dbg-path { font-size: 0.8rem; word-break: break-all; font-weight: 400 !important; }

  @media (max-width: 640px) {
    .dbg-body { padding: 1.1rem; gap: 1rem; }
    .dbg-box { padding: 1.1rem; }
  }
</style>
