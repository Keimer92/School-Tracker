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
  import { t, tagLocale } from "../../lib/i18n.svelte";
  import { onDataChange } from "../../lib/autoSync";

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
  let isReparandoNotas = $state(false);

  // ── Traspaso del dispositivo ──
  // Vivía en la página "Cuenta", que se eliminó al quedar la nube de un solo
  // usuario. Sigue siendo la única forma de entregar el equipo a otra persona:
  // respaldo a Drive, borrado de lo local y vuelta al Welcome. El orden está en
  // `lib/deviceHandover.ts` y es importante: si el respaldo falla, no se borra
  // nada y se avisa.
  let handoverBusy = $state(false);
  let handoverEtapa = $state("");

  async function traspasarDispositivo() {
    if (handoverBusy) return;
    const ok = await ask(
      t('dpg.traspaso.borrarDatos') + '\n\n' +
      t('dpg.traspaso.primeroRespaldo') + '\n\n' +
      t('dpg.traspaso.volverInicio') + '\n\n' +
      t('dpg.traspaso.continuarPregunta'),
      {
        title: t('dpg.traspaso.titulo'),
        kind: 'warning',
        okLabel: t('dpg.traspaso.respaldarYTraspasar'),
        cancelLabel: t('comun.cancelar'),
      }
    );
    if (!ok) return;
    handoverBusy = true;
    handoverEtapa = t('dpg.traspaso.respaldando');
    try {
      const { traspasarDispositivo: traspasar } = await import('../../lib/deviceHandover');
      const res = await traspasar({ onEtapa: (etapa) => { handoverEtapa = etapa; } });
      if (res.ok) {
        handoverEtapa = t('dpg.traspaso.listoReiniciando');
        await emit('show-toast', { message: t('dpg.traspaso.toastOk'), type: 'success' });
      } else {
        handoverEtapa = '';
        await emit('show-toast', {
          message: t('dpg.traspaso.toastError') + (res.motivo || t('dpg.traspaso.noCompleto')),
          type: 'error',
        });
      }
    } catch (e: any) {
      handoverEtapa = '';
      await emit('show-toast', { message: t('dpg.traspaso.toastError') + (e?.message || e), type: 'error' });
    } finally {
      // On success the app reloads on its own: keep the button disabled so the
      // user cannot start a second handover while the first one finishes.
      if (handoverEtapa !== t('dpg.traspaso.listoReiniciando')) handoverBusy = false;
    }
  }

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
    if (!proximo) return t('dbg.cron.sinProgramar');
    const min = Math.max(0, Math.round((proximo - ahora) / 60000));
    if (min <= 0) return t('dbg.cron.cualquierMomento');
    if (min < 60) return t('dbg.cron.enMin', { min });
    return t('dbg.cron.enH', { h: Math.floor(min / 60), mm: String(min % 60).padStart(2, "0") });
  };

  const marcaTiempo = (ms: number | null | undefined) =>
    ms ? new Date(ms).toLocaleString(tagLocale(), { dateStyle: "short", timeStyle: "short" }) : t('dbg.cron.nunca');

  /**
   * Estado REAL de la sesión de Google Drive.
   *
   * Existe porque la UI decía "conectado" mirando solo que el `accessToken`
   * estuviera lleno, y ese string sobrevive una hora después de expirar: la app
   * se veía conectada mientras la API devolvía 401 en cada llamada. Con esta
   * caja se ve de un vistazo si hay sesión de verdad, y sobre todo si el
   * `refreshToken` sigue existiendo — que es lo que determina si hay que
   * re-loguear o no.
   *
   * El dato clave para el caso "se me desconectó solo": si `refreshToken` sigue
   * presente pero el `accessToken` venció, NO hace falta iniciar sesión: se
   * renueva solo. Si `refreshToken` NO está, Google lo revocó y sí hay que
   * entrar de nuevo (típico cuando la pantalla de consentimiento quedó en
   * estado "Testing", que las revoca a los 7 días).
   *
   * Todo se lee de `localStorage`, sin red: es seguro mostrarlo siempre.
   */
  const sesionDrive = $derived.by(() => {
    const leer = () => {
      try {
        const s = JSON.parse(localStorage.getItem("schooltracker-google-drive-settings") || "{}");
        return s as {
          accessToken?: string | null; refreshToken?: string | null;
          tokenExpiry?: number | null; googleUserEmail?: string | null;
        };
      } catch { return {}; }
    };
    const s = leer();
    const acceso = !!s.accessToken;
    const refresco = !!s.refreshToken;
    const expira = typeof s.tokenExpiry === "number" ? s.tokenExpiry : 0;
    const vivo = acceso && refresco && expira > Date.now() + 120000;

    let texto: string; let tono: string;
    if (!acceso && !refresco) { texto = t('dbg.sesionDrive.sinSesion'); tono = "#94a3b8"; }
    else if (!refresco) { texto = t('dbg.sesionDrive.revocada'); tono = "#f87171"; }
    else if (!acceso) { texto = t('dbg.sesionDrive.renovar'); tono = "#fbbf24"; }
    else if (expira && expira <= Date.now() + 120000) { texto = t('dbg.sesionDrive.vencida'); tono = "#f87171"; }
    else { texto = t('dbg.sesionDrive.viva'); tono = "#4ade80"; }

    // El "escritura" dice quién puede escribir hoy: el nombre del archivo lleva
    // el tag de la cuenta, así que sin email los respaldos se guardan como
    // "default" y dejan de encontrarse los anteriores.
    const email = s.googleUserEmail || t('dbg.sesionDrive.sinEmail');
    const escritura = s.googleUserEmail ? t('dbg.sesionDrive.ok') : t('dbg.sesionDrive.tagDefault');

    return {
      texto, tono, email, escritura,
      access: acceso ? `${t('dbg.sesionDrive.hay')} (${s.accessToken!.slice(0, 12)}…)` : t('dbg.sesionDrive.noHay'),
      refresh: refresco ? t('dbg.sesionDrive.hay') : t('dbg.sesionDrive.noHay'),
      expira: expira
        ? `${marcaTiempo(expira)}${expira <= Date.now() ? ` · ${t('dbg.sesionDrive.vencido')}` : ` · ${cuentaRegresiva(expira)}`}`
        : t('dbg.sesionDrive.sinExpiry'),
      vivo,
    };
  });

  const forzarRespaldoDrive = async () => {
    abSubiendo = true;
    abMensaje = "";
    try {
      const { driveAutoBackup } = await import("../../lib/driveAutoBackup");
      // `runOnce` respeta el toggle `enabled` y el throttle de 15 min, así que
      // el botón avisa en vez de fingir que subió.
      const res = await driveAutoBackup.runOnce("manual");
      abMensaje = res.ran
        ? t('dbg.res.subido')
        : t('dbg.res.noSubio', { motivo: res.reason ?? t('dbg.res.sinMotivo') }) +
            (res.reason === "no_changes"
              ? t('dbg.res.noChanges')
              : res.reason === "throttled"
                ? t('dbg.res.throttled')
                : res.reason === "disabled"
                  ? t('dbg.res.disabled')
                  : "");
    } catch (e) {
      abMensaje = t('dbg.res.error', { e: String((e as Error)?.message ?? e) });
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

  const INTERVALOS = $derived([
    { min: 0, label: t('dbg.intervalo.desactivado') },
    { min: 60, label: t('dbg.intervalo.cadaHora') },
    { min: 180, label: t('dbg.intervalo.cada3Horas') },
    { min: 360, label: t('dbg.intervalo.cada6Horas') },
    { min: 720, label: t('dbg.intervalo.cada12Horas') },
    { min: 1440, label: t('dbg.intervalo.cadaDia') },
  ]);

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

  async function handleRepararNotas() {
    if (isReparandoNotas) return;
    const ok = await ask(t('dbg.reparar.confirmar'), { title: t('dbg.reparar.titulo'), kind: 'warning', okLabel: t('comun.confirmar'), cancelLabel: t('comun.cancelar') });
    if (!ok) return;
    isReparandoNotas = true;
    try {
      // Respaldo antes de tocar nada: las notas borradas no se reconstruyen a mano.
      try { await invoke('gd_create_backup', {}); } catch { /* el respaldo automatico tambien corre */ }
      const r = await invoke<{ huerfanas: number; gradoAjeno: number; borradas: number }>("reparar_integridad_notas", {});
      await emit("show-toast", {
        message: t('dbg.reparar.hecho', { h: r.huerfanas, g: r.gradoAjeno, n: r.borradas }),
        type: r.borradas > 0 ? "success" : "info",
      });
      onDataChange('nota');
    } catch (e) {
      await emit("show-toast", { message: t('dbg.reparar.error', { msg: String(e) }), type: "error" });
    } finally { isReparandoNotas = false; }
  }

  async function hacerBackupAhora() {
    if (runningBackup) return;
    runningBackup = true;
    try {
      // Mismo límite que el respaldo de cierre (db::MAX_BACKUPS_LOCALES): si el
    // botón usara otro número, la carpeta dependería de qué disparador generó
    // el último backup, que es justo lo que no debe pasar.
      const ruta = await invoke<string>("run_local_backup", { keep: 5 });
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
        const r = await invoke<any>("d1_sync_all", { full: true, force: true, source: 'profile-import' });
        const pushed = r?.pushed || {};
        sincronizada = typeof pushed === "number" ? pushed : Object.values(pushed).reduce((a: number, b: any) => a + Number(b || 0), 0);
      } catch (e) {
        syncErrores = String(e);
        console.error("[Import] reset/sync automático falló:", e);
      }
      if (syncErrores) {
        await emit("show-toast", { message: `✅ Base importada y migrada. ⚠️ Sync completo no pudo ejecutarse: ${syncErrores}.`, type: "warning" });
      } else {
        await emit("show-toast", { message: t('dbg.toast.importOk', { n: sincronizada }), type: "success" });
      }
    } catch (error) { await emit("show-toast", { message: t('dbg.toast.importErr', { e: String(error) }), type: "error" }); }
    finally { isImporting = false; }
  }

  /**
   * Purga TOTAL del perfil: vacía la nube D1 (school key activa) Y reinicia la
   * base local, dejando el perfil en cero para importar una base buena. La
   * config de conexión (d1_config) se conserva.
   */
  async function handleWipeProfileData() {
    const ok = await ask(
      t('dbg.askWipeMsg'),
      { title: t('dbg.askWipeTitulo'), kind: "warning", okLabel: t('dbg.askWipeOk'), cancelLabel: t('comun.cancelar') }
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
          ? t('dbg.toast.wipeOk')
          : t('dbg.toast.wipeWarn'),
        type: nubeOk ? "success" : "warning",
      });
      setTimeout(() => location.reload(), 1800);
    } catch (error) {
      console.error("[Wipe] error:", error);
      await emit("show-toast", { message: t('dbg.toast.wipeErr', { e: String(error) }), type: "error" });
    } finally {
      isWipingProfile = false;
    }
  }
</script>

<div class="dbg-page">
  <div class="category-card" style="border-left: 3px solid {ACCENT};">
    <div class="category-header" style="border-left: none;">
      <div style="width:36px;height:36px;border-radius:10px;background:{ACCENT}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">🐛</div>
      <h3>{t('dbg.titulo')}</h3>
    </div>

    <div class="dbg-body">
      <!-- EXPORTAR -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📤</span><h5>{t('dbg.exportar.titulo')}</h5></div>
        <p class="dbg-desc">{@html t('dbg.exportar.desc', { carpeta: CARPETA_BACKUPS, carpeta2: isAndroid ? t('dbg.exportar.descargas') : t('dbg.exportar.docs') })}</p>
        <button onclick={handleExportDB} class="dbg-btn dbg-btn-verde">{t('dbg.exportar.btn')}</button>

        <!-- Backup automático: botón completo, no un ícono suelto (en un ⏱ de
             30px no se descubría). Al tocarlo abre el popover de intervalos. -->
        <button
          class="dbg-auto"
          class:on={backupActivo}
          onclick={() => showBackupPopover = !showBackupPopover}
          disabled={savingBackupCfg}
          aria-label={t('dbg.ariaBackup')}
          aria-expanded={showBackupPopover}>
          <span class="dbg-auto-ico">⏱</span>
          <span class="dbg-auto-txt">
            <strong>{t('dbg.backup.titulo')}</strong>
            <small>{backupActivo ? t('dbg.backup.subActivo', { h: backupIntervaloMin / 60 }) : t('dbg.backup.subDesactivado')}</small>
          </span>
          <span class="dbg-auto-chev">›</span>
        </button>

        <!-- Popover: respaldo automático -->
        {#if showBackupPopover}
          <div class="dbg-pop" use:portalToBody>
            <div class="dbg-pop-card">
              <div class="dbg-pop-head">
                <span>{t('dbg.pop.titulo')}</span>
                <button class="dbg-pop-x" onclick={() => showBackupPopover = false} aria-label={t('comun.cerrar')}>✕</button>
              </div>
              <p class="dbg-pop-desc">
                {@html t('dbg.pop.desc')}
                {isAndroid
                  ? t('dbg.pop.descAppCerrada')
                  : t('dbg.pop.descAppAbierta')}
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
                {runningBackup ? t('dbg.pop.generando') : t('dbg.pop.backupAhora')}
              </button>
            </div>
          </div>
        {/if}
      </div>


      <!-- IMPORTAR -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📥</span><h5>{t('dbg.importar.titulo')}</h5></div>
        <p class="dbg-desc">{t('dbg.importar.desc')}</p>
        <button onclick={handleImportDB} disabled={isImporting} class="dbg-btn dbg-btn-rojo">
          {isImporting ? t('dbg.importar.importando') : t('dbg.importar.btn')}
        </button>
        <div class="dbg-hint">{t('dbg.importar.hint')}</div>
      </div>

      <!-- REPARAR NOTAS -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">🩹</span><h5>{t('dbg.reparar.titulo')}</h5></div>
        <p class="dbg-desc">{t('dbg.reparar.desc')}</p>
        <button onclick={handleRepararNotas} disabled={isReparandoNotas} class="dbg-btn dbg-btn-rojo">
          {isReparandoNotas ? t('dbg.reparar.trabajando') : t('dbg.reparar.btn')}
        </button>
        <div class="dbg-hint">{t('dbg.reparar.hint')}</div>
      </div>

      <!-- PURGAR -->
      <div class="dbg-box dbg-box-peligro">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">🧨</span><h5 class="dbg-peligro-titulo">{t('dbg.purgar.titulo')}</h5></div>
        <p class="dbg-desc">{@html t('dbg.purgar.desc')}</p>
        <button onclick={handleWipeProfileData} disabled={isWipingProfile} class="dbg-btn-peligro">
          {isWipingProfile ? t('dbg.purgar.purgando') : t('dbg.purgar.btn')}
        </button>
        <div class="dbg-hint">{t('dbg.purgar.hint')}</div>
      </div>

      <!-- TRANSFER DEVICE -->
      <div class="dbg-box dbg-box-peligro">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📦</span><h5 class="dbg-peligro-titulo">{t('dpg.traspaso.titulo')}</h5></div>
        <p class="dbg-desc">{t('dpg.traspaso.p1')}</p>
        <p class="dbg-desc">{t('dpg.traspaso.p2')}</p>
        <button onclick={traspasarDispositivo} disabled={handoverBusy} class="dbg-btn-peligro">
          {handoverBusy ? handoverEtapa : t('dpg.traspaso.btn')}
        </button>
      </div>

      <!-- SISTEMA -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">📊</span><h5>{t('dbg.info.titulo')}</h5></div>
        <dl class="dbg-info">
          <div><dt>{t('dbg.info.version')}</dt><dd>1.2.0</dd></div>
          <div><dt>{t('dbg.info.ruta')}</dt><dd class="dbg-path">{dbPath || t('dbg.info.cargando')}</dd></div>
          <div><dt>{t('dbg.info.plataforma')}</dt><dd>{isAndroid ? "Android" : t('dbg.info.escritorio')}</dd></div>
        </dl>
      </div>

      <!-- DIAGNÓSTICO DE SESIÓN DE GOOGLE DRIVE -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">🔑</span><h5>{t('dbg.sesionDrive.titulo')}</h5></div>
        <p class="dbg-desc">{t('dbg.sesionDrive.desc')}</p>
        <dl class="dbg-info">
          <div>
            <dt>{t('dbg.sesionDrive.estado')}</dt>
            <dd style="color:{sesionDrive.tono};font-weight:700;">{sesionDrive.texto}</dd>
          </div>
          <div><dt>{t('dbg.sesionDrive.accessToken')}</dt><dd>{sesionDrive.access}</dd></div>
          <div><dt>{t('dbg.sesionDrive.refreshToken')}</dt><dd>{sesionDrive.refresh}</dd></div>
          <div><dt>{t('dbg.sesionDrive.expira')}</dt><dd>{sesionDrive.expira}</dd></div>
          <div><dt>{t('dbg.sesionDrive.cuenta')}</dt><dd>{sesionDrive.email}</dd></div>
          <div><dt>{t('dbg.sesionDrive.escritura')}</dt><dd>{sesionDrive.escritura}</dd></div>
        </dl>
        <p class="dbg-desc" style="margin-top:0.5rem;">{t('dbg.sesionDrive.pista')}</p>
      </div>

      <!-- RESPALDO AUTOMATICO A GOOGLE DRIVE -->
      <div class="dbg-box">
        <div class="dbg-box-head"><span style="font-size: 1.2rem;">☁️</span><h5>{t('dbg.drive.titulo')}</h5></div>
        {#if !abEstado}
          <p class="dbg-desc">{t('dbg.drive.cargando')}</p>
        {:else}
          <dl class="dbg-info">
            <div>
              <dt>{t('dbg.drive.planificador')}</dt>
              <dd>
                {abEstado.enabled ? t('dbg.drive.activo') : t('dbg.drive.desactivado')}
                {#if !abEstado.enabled}<span style="color:#f87171;"> {t('dbg.drive.noSube')}</span>{/if}
              </dd>
            </div>
            <div><dt>{t('dbg.drive.proxima')}</dt><dd>{cuentaRegresiva(abEstado.nextRunAt)}</dd></div>
            <div><dt>{t('dbg.drive.intervalo')}</dt><dd>{t('dbg.drive.cada', { n: abEstado.currentIntervalMin, j: abEstado.jitterMin })}</dd></div>
            <div><dt>{t('dbg.drive.ultimo')}</dt><dd>{marcaTiempo(abEstado.lastSuccessAt)}</dd></div>
            <div><dt>{t('dbg.drive.subidas')}</dt><dd>{abEstado.totalUploads}</dd></div>
            {#if abEstado.lastErrorAt}
              <div><dt>{t('dbg.drive.ultimoError')}</dt><dd style="color:#f87171;">{marcaTiempo(abEstado.lastErrorAt)} · {t('dbg.drive.seguidos', { n: abEstado.consecutiveFails })}</dd></div>
            {/if}
            {#if abEstado.onlyWifi}
              <div><dt>{t('dbg.drive.soloRed')}</dt><dd>{t('dbg.drive.si')}</dd></div>
            {/if}
          </dl>
          <p class="dbg-desc">
            {t('dbg.drive.nota')}
          </p>
          <button onclick={forzarRespaldoDrive} class="dbg-btn dbg-btn-verde" disabled={abSubiendo}>
            {abSubiendo ? t('dbg.drive.subiendo') : t('dbg.drive.forzar')}
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
