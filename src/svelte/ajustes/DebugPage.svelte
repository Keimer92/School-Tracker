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
  import { open, ask } from "@tauri-apps/plugin-dialog";
  import { copyFile } from "@tauri-apps/plugin-fs";
  import { untrack } from "svelte";
  import { portalToBody } from "../../lib/portalToBody";

  const isAndroid = /Android/i.test(navigator.userAgent);
  const ACCENT = "#ef4444";
  /**
   * Carpeta unica de backups. En Android se pasa a `guardar_en_descargas`, que
   * la resuelve bajo `Download/`; en escritorio se resuelve contra `Documents/`.
   */
  const CARPETA_BACKUPS = "School Tracker/Backups";

  let dbPath = $state("");
  let isImporting = $state(false);
  let isWipingProfile = $state(false);

  // ── Estado del respaldo automático a Google Drive ──
  // Existía como scheduler sin ninguna UI: era imposible saber si estaba
  // corriendo, armando el temporizador o saltándose por throttle. Este panel
  // lo hace observable. Se refresca cada 5 s porque `getState()` es síncrono y
  // solo lee un objeto en memoria (no toca la red).
  type AbEstado = import("../../lib/driveAutoBackup").AutoBackupState;
  let abEstado = $state<AbEstado | null>(null);
  let abSubiendo = $state(false);
  let abMensaje = $state("");
  let ahora = $state(Date.now());

  const leerEstadoDrive = async () => {
    try {
      const { driveAutoBackup } = await import("../../lib/driveAutoBackup");
      abEstado = { ...driveAutoBackup.getState() };
    } catch (e) {
      console.warn("[DebugPage] no se pudo leer el estado de Drive:", e);
    }
  };

  /** Cuenta regresiva formateada: "12 min" / "1 h 05 min" / "ahora". */
  const cuentaRegresiva = (proximo: number | null | undefined) => {
    if (!proximo) return "sin programar";
    const min = Math.max(0, Math.round((proximo - ahora) / 60000));
    if (min <= 0) return "en cualquier momento";
    if (min < 60) return `en ${min} min`;
    return `en ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
  };

  const marcaTiempo = (ms: number | null | undefined) =>
    ms ? new Date(ms).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "nunca";

  const forzarRespaldoDrive = async () => {
    abSubiendo = true;
    abMensaje = "";
    try {
      const { driveAutoBackup } = await import("../../lib/driveAutoBackup");
      // `runOnce` respeta el toggle `enabled` y el throttle de 15 min, así que
      // el botón avisa en vez de fingir que subió.
      const res = await driveAutoBackup.runOnce("manual");
      abMensaje = res.ran
        ? "✓ Respaldo subido a Drive."
        : `No se subió (${res.reason ?? "sin motivo"}). ${
            res.reason === "no_changes"
              ? "No hay cambios locales pendientes."
              : res.reason === "throttled"
                ? "Pasaron menos de 15 min desde el último respaldo."
                : res.reason === "disabled"
                  ? "El respaldo automático está desactivado."
                  : ""
          }`;
    } catch (e) {
      abMensaje = `✗ Error: ${(e as Error)?.message ?? e}`;
    } finally {
      abSubiendo = false;
      await leerEstadoDrive();
    }
  };

  $effect(() => {
    void leerEstadoDrive();
    const t1 = setInterval(() => void leerEstadoDrive(), 5000);
    const t2 = setInterval(() => (ahora = Date.now()), 10000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  });

  // ── Backup automático local ──
  let backupActivo = $state(false);
  let backupIntervaloMin = $state(120);
  let showBackupPopover = $state(false);
  let savingBackupCfg = $state(false);
  let runningBackup = $state(false);

  const INTERVALOS = [
    { min: 0, label: "Desactivado" },
    { min: 60, label: "Cada hora" },
    { min: 180, label: "Cada 3 horas" },
    { min: 360, label: "Cada 6 horas" },
    { min: 720, label: "Cada 12 horas" },
    { min: 1440, label: "Cada día" },
  ];

  invoke<string>("get_db_path").then(p => dbPath = p).catch(() => dbPath = "");

  // Carga la config guardada (via el mismo canal que el resto de app_settings).
  (async () => {
    try {
      const raw = await invoke<string>("get_app_settings");
      const s = JSON.parse(raw || "{}");
      backupActivo = !!s.localBackupActivo;
      if (Number.isFinite(Number(s.localBackupIntervaloMin))) {
        backupIntervaloMin = Math.max(0, Number(s.localBackupIntervaloMin));
      }
    } catch { /* sin config guardada: se usan los valores por defecto */ }
  })();

  /** Tupla [min, hora] de la ultima ejecucion; la clave evita timers duplicados. */
  let ultimoTimer: ReturnType<typeof setTimeout> | null = null;
  let ultimaCorridaMs = $state(0);

  function agendarBackupEscritorio() {
    // En Android manda la alarma nativa (LocalBackupScheduler): aqui solo se
    // agenda mientras la app vive, y por eso NO se promete backup con la app
    // cerrada en escritorio.
    if (isAndroid) return;
    if (ultimoTimer) { clearTimeout(ultimoTimer); ultimoTimer = null; }
    if (!backupActivo || backupIntervaloMin <= 0) return;
    const periodo = backupIntervaloMin * 60_000;
    // La PRIMERA corrida tiene que esperar el periodo completo.
    //
    // Antes se calculaba `elapsed = Date.now() - ultimaCorridaMs` con
    // `ultimaCorridaMs = 0`, o sea la hora de epoch (~1,8e12 ms): un número
    // gigante pero POSITIVO, así que la rama `elapsed > 0 ? elapsed : periodo`
    // tomaba siempre el valor gigante, `periodo - elapsed` daba negativo y lo
    //_convertía_ el piso de 60 s. La rama `: periodo` (la que pretendía esperar
    // el periodo completo) nunca se ejecutaba. Resultado: el primer backup
    // salía a los 60 segundos, y como se reapagaba en cada montaje del
    // componente, se repetía cada vez que se entraba a la sección.
    const hayCorridaPrevia = ultimaCorridaMs > 0;
    const elapsed = hayCorridaPrevia ? Date.now() - ultimaCorridaMs : 0;
    const faltan = Math.max(60_000, periodo - elapsed);
    console.debug(`[LocalBackup] agendado en ${Math.round(faltan / 1000)}s (periodo ${Math.round(periodo / 1000)}s, corrida previa: ${hayCorridaPrevia})`);
    ultimoTimer = setTimeout(async () => {
      ultimoTimer = null;
      await hacerBackupAhora();
      ultimaCorridaMs = Date.now();
      agendarBackupEscritorio();
    }, faltan);
  }

  $effect(() => {
    // Se reagenda SOLO cuando el usuario cambia la config desde el popover.
    //
    // Las dos vars se leen FUERA del untrack para que sigan siendo las
    // dependencias del effect, y todo lo de `agendarBackupEscritorio()` va
    // DENTRO: esa función también lee `ultimaCorridaMs`, que es `$state` y se
    // reescribe dentro del propio `setTimeout`. Sin esto el effect se
    // suscribía a ese estado y cada corrida del timer lo reescribía →
    // effect → timer → effect, encadenando respaldos locales indefinidamente
    // sin importar el intervalo elegido.
    const activo = backupActivo;
    const intervalo = backupIntervaloMin;
    untrack(() => agendarBackupEscritorio());
  });

  async function aplicarConfigBackup(activo: boolean, intervalo: number) {
    savingBackupCfg = true;
    try {
      await invoke("set_local_backup_config", { activo, intervaloMin: intervalo });
      backupActivo = activo;
      backupIntervaloMin = intervalo;
      showBackupPopover = false;
      await emit("show-toast", {
        message: activo
          ? `✅ Backup automático cada ${intervalo / 60} h`
          : "🔕 Backup automático desactivado",
        type: "success",
      });
    } catch (e) {
      await emit("show-toast", { message: "❌ No se pudo guardar la config: " + e, type: "error" });
    } finally { savingBackupCfg = false; }
  }

  async function hacerBackupAhora() {
    if (runningBackup) return;
    runningBackup = true;
    try {
      const ruta = await invoke<string>("run_local_backup", { keep: 2 });
      await emit("show-toast", {
        message: ruta ? `✅ Backup guardado: ${ruta.split(/[\\/]/).pop()}` : "❌ No se pudo guardar el backup",
        type: ruta ? "success" : "error",
      });
    } catch (e) {
      await emit("show-toast", { message: "❌ Error en el backup: " + e, type: "error" });
    } finally { runningBackup = false; }
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
        // `copyFile` con `BaseDirectory.Download` falla en Android: la app no
        // tiene escritura en la carpeta publica de Descargas (scoped storage).
        // La ruta correcta es escribir en el sandbox y dejar que
        // `guardar_en_descargas` la copie a Descargas via MediaStore.
        const nombre = backupFileName("sqlite");
        const ruta = await invoke<string>("guardar_en_descargas", {
          path: dbFile,
          mime: "application/vnd.sqlite3",
          carpeta: CARPETA_BACKUPS,
          nombre,
        });
        if (!ruta) {
          await emit("show-toast", { message: "❌ No se pudo guardar en Descargas", type: "error" });
        } else {
          await emit("show-toast", { message: `✅ Guardada en ${ruta}`, type: "success" });
        }
        return;
      }
      // Escritorio: se escribe directo en Documents/School Tracker/Backups, sin
      // dialogo (mismo destino que los backups automaticos).
      const { documentDir } = await import("@tauri-apps/api/path");
      const { mkdir } = await import("@tauri-apps/plugin-fs");
      const base = (await documentDir()) + "/" + CARPETA_BACKUPS;
      await mkdir(base, { recursive: true });
      const sep = base.includes("\\") ? "\\" : "/";
      const nombre = backupFileName("db");
      const destino = base + sep + nombre;
      await copyFile(dbFile, destino);
      await emit("show-toast", { message: `✅ Guardada en ${destino}`, type: "success" });
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
        const r = await invoke<any>("d1_sync_all", { full: true, force: true });
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
        <p class="dbg-desc">Guarda una copia completa de la base de datos en <strong>{CARPETA_BACKUPS}</strong> {isAndroid ? "(Descargas)" : "(Documentos)"}.</p>
        <button onclick={handleExportDB} class="dbg-btn dbg-btn-verde">📤 Exportar base de datos</button>

        <!-- Backup automático: botón completo, no un ícono suelto (en un ⏱ de
             30px no se descubría). Al tocarlo abre el popover de intervalos. -->
        <button
          class="dbg-auto"
          class:on={backupActivo}
          onclick={() => showBackupPopover = !showBackupPopover}
          disabled={savingBackupCfg}
          aria-label="Configurar backup automático"
          aria-expanded={showBackupPopover}>
          <span class="dbg-auto-ico">⏱</span>
          <span class="dbg-auto-txt">
            <strong>Backup automático</strong>
            <small>{backupActivo ? `Activo · cada ${backupIntervaloMin / 60} h` : "Desactivado"}</small>
          </span>
          <span class="dbg-auto-chev">›</span>
        </button>

        <!-- Popover: respaldo automático -->
        {#if showBackupPopover}
          <div class="dbg-pop" use:portalToBody>
            <div class="dbg-pop-card">
              <div class="dbg-pop-head">
                <span>⏱ Backup automático</span>
                <button class="dbg-pop-x" onclick={() => showBackupPopover = false} aria-label="Cerrar">✕</button>
              </div>
              <p class="dbg-pop-desc">
                Guarda una copia cada intervalo y conserva las <strong>2 más recientes</strong> (las anteriores se borran).
                {isAndroid
                  ? "Sigue funcionando con la app cerrada: lo programa una alarma del sistema."
                  : "Mientras la app esté abierta; con la app cerrada no hay proceso que la ejecute."}
              </p>
              <div class="dbg-pop-opts">
                {#each INTERVALOS as o}
                  <button
                    class="dbg-pop-opt"
                    class:on={backupIntervaloMin === o.min}
                    onclick={() => aplicarConfigBackup(o.min > 0, o.min)}
                    disabled={savingBackupCfg}>
                    {o.label}
                  </button>
                {/each}
              </div>
              <button onclick={hacerBackupAhora} disabled={runningBackup} class="dbg-btn dbg-btn-ghost" style="margin-top:0.6rem;">
                {runningBackup ? "⏳ Generando..." : "💾 Hacer un backup ahora"}
              </button>
            </div>
          </div>
        {/if}
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

      <!-- RESPALDO AUTOMATICO A GOOGLE DRIVE -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">☁️</span><h5>Respaldo automático a Drive</h5></div>
        {#if !abEstado}
          <p class="dbg-desc">Cargando estado…</p>
        {:else}
          <dl class="dbg-info">
            <div>
              <dt>Planificador</dt>
              <dd>
                {abEstado.enabled ? "Activo" : "Desactivado"}
                {#if !abEstado.enabled}<span style="color:#f87171;"> (no sube nada)</span>{/if}
              </dd>
            </div>
            <div><dt>Próxima subida automática</dt><dd>{cuentaRegresiva(abEstado.nextRunAt)}</dd></div>
            <div><dt>Intervalo actual</dt><dd>cada {abEstado.currentIntervalMin} min (±{abEstado.jitterMin})</dd></div>
            <div><dt>Último respaldo</dt><dd>{marcaTiempo(abEstado.lastSuccessAt)}</dd></div>
            <div><dt>Subidas totales</dt><dd>{abEstado.totalUploads}</dd></div>
            {#if abEstado.lastErrorAt}
              <div><dt>Último error</dt><dd style="color:#f87171;">{marcaTiempo(abEstado.lastErrorAt)} · {abEstado.consecutiveFails} seguidos</dd></div>
            {/if}
            {#if abEstado.onlyWifi}
              <div><dt>Solo con buena red</dt><dd>sí</dd></div>
            {/if}
          </dl>
          <p class="dbg-desc">
            Además, cada guardado en la app sube un respaldo instantáneo a los 5 s
            (no espera al temporizador).
          </p>
          <button onclick={forzarRespaldoDrive} class="dbg-btn dbg-btn-verde" disabled={abSubiendo}>
            {abSubiendo ? "Subiendo…" : "☁️ Forzar respaldo ahora"}
          </button>
          {#if abMensaje}
            <p class="dbg-desc" style="margin-top:0.5rem;">{abMensaje}</p>
          {/if}
        {/if}
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

  /* Botón de backup automático: fila completa y con texto, para que se vea
     que existe y cuál es el estado actual. */
  .dbg-auto {
    width: 100%; margin-top: 0.6rem;
    display: flex; align-items: center; gap: 0.65rem;
    padding: 0.65rem 0.8rem; cursor: pointer; text-align: left;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 11px; transition: all 0.2s ease;
  }
  .dbg-auto:hover { background: rgba(255,255,255,0.08); }
  .dbg-auto.on {
    background: rgba(52,211,153,0.12);
    border-color: rgba(52,211,153,0.4);
  }
  .dbg-auto:disabled { opacity: 0.6; cursor: not-allowed; }
  .dbg-auto-ico { font-size: 1.05rem; flex-shrink: 0; }
  .dbg-auto-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .dbg-auto-txt strong { font-size: 0.85rem; font-weight: 600; color: #e2e8f0; }
  .dbg-auto-txt small { font-size: 0.7rem; color: #64748b; }
  .dbg-auto.on .dbg-auto-txt small { color: #34d399; }
  .dbg-auto-chev { font-size: 1.15rem; color: #64748b; flex-shrink: 0; }

  /* Popover del backup automático. Va a <body> porque el overlay es `fixed` y
     los ancestros con backdrop-filter lo confinan (AGENTS.md). */
  .dbg-pop {
    position: fixed; inset: 0; z-index: 10000;
    display: flex; align-items: center; justify-content: center; padding: 1rem;
    background: rgba(0,0,0,0.5); backdrop-filter: blur(6px);
  }
  .dbg-pop-card {
    width: min(92vw, 340px); padding: 1.1rem; border-radius: 16px;
    background: rgba(20,24,31,0.95); border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);
  }
  .dbg-pop-head {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    font-size: 0.95rem; font-weight: 700; color: #f1f5f9; margin-bottom: 0.5rem;
  }
  .dbg-pop-x {
    background: transparent; border: none; color: #94a3b8; cursor: pointer;
    font-size: 1rem; line-height: 1; padding: 0.15rem 0.3rem; border-radius: 6px;
  }
  .dbg-pop-x:hover { color: #f1f5f9; background: rgba(255,255,255,0.08); }
  .dbg-pop-desc { margin: 0 0 0.8rem; color: #94a3b8; font-size: 0.76rem; line-height: 1.5; }
  .dbg-pop-opts { display: flex; flex-direction: column; gap: 0.35rem; }
  .dbg-pop-opt {
    width: 100%; padding: 0.55rem 0.7rem; cursor: pointer; text-align: left;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 9px; color: #cbd5e1; font-size: 0.85rem; transition: all 0.15s ease;
  }
  .dbg-pop-opt:hover { background: rgba(255,255,255,0.09); }
  .dbg-pop-opt.on {
    background: rgba(52,211,153,0.15); border-color: rgba(52,211,153,0.45);
    color: #34d399; font-weight: 700;
  }
  .dbg-pop-opt:disabled { opacity: 0.6; cursor: not-allowed; }
  .dbg-btn-ghost {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: #e2e8f0;
  }
  .dbg-btn-ghost:hover { background: rgba(255,255,255,0.12); }
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
