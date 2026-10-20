<script lang="ts">
  /**
   * NotificacionesPage — modulo de "Notif. Asistencia" (solo Android).
   *
   * Extraido de AjustesPage.svelte para que la pagina no dependa de el: aqui viven
   * TODO su estado, sus funciones y sus estilos (`.notif-*`). AjustesPage solo la
   * monta cuando `activeTab === "notificaciones"`.
   *
   * Como funciona: por cada colegio se define una ventana horaria `[inicio, fin]` y
   * cada cuanto repetir (AlarmManager nativo). La config vive en la tabla
   * `app_settings` de la BD (sincronizada con D1), en su PROPIA fila
   * (`key = 'attendance'`) y se manda al calendario de Android con
   * `schedule_attendance_alarm`.
   *
   * ⚠️ Se lee de la BD (`loadAppSettings`), NO del localStorage: el localStorage
   * del WebView puede perderse y era la causa de que las alertas "se
   * desactivaran solas" al reabrir la app. La BD es la fuente de verdad;
   * `appSettings.ts` mantiene el espejo localStorage solo como caché.
   */
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { getLocalDateISOString } from "../../lib/dateUtils";
  import { loadAppSettings, saveAttendanceSettings, getAppSettings } from "../../lib/appSettings";
  import { aplicarAlarmaAsistencia, configDesdeSettings } from "../../lib/attendanceAlarm";
  import { onMount } from "svelte";
  import { t } from "../../lib/i18n.svelte";

  interface ColegioItem { id: number; nombre: string; }

  const INTERVALOS = [15, 30, 45, 60, 90, 120];
  // Caché localStorage que mantiene `appSettings.ts` (fallback si la BD falla).
  const STORAGE_KEY_FALLBACK = "stp_attendance_notif_settings";
  // Orden = indice de `Date.getDay()` (0 = domingo). Debe coincidir con las
  // columnas de `colegio_dias_asistencia`.
  const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const CFG_POR_DEFECTO: Omit<NotifColegioCfg, "activo"> = { inicio: "07:00", fin: "12:00", intervaloMin: 45 };

  interface NotifColegioCfg { activo: boolean; inicio: string; fin: string; intervaloMin: number; }

  let colegios = $state<ColegioItem[]>([]);
  let enabled = $state(false);
  let cfg = $state<Record<number, NotifColegioCfg>>({});
  let saving = $state(false);
  let testing = $state(false);
  let silencedToday = $state(false);
  let dismissing = $state(false);
  // String porque `bind:value` en un <select> entrega texto; el comando Rust
  // espera i64, por eso `testNotif` convierte con Number().
  let testColegio = $state<string>("");
  // La config se lee UNA vez al montar. Antes se releia en cada render (el efecto
  // se auto-invalidaba) y pisaba la hora/intervalo recien elegidos.
  let cargada = $state(false);

  // ── Sonido de la alarma (solo Android) ──────────────────────────────
  interface RingtoneState { ok: boolean; uri: string; label: string; canalExiste?: boolean; }
  // Label vacio a proposito: lo reemplaza el nativo (cargarRingtone) o, si no
  // llega, el fallback con t() en el template. Inicializarlo aqui con t()
  // lo dejaria congelado en el idioma del arranque.
  let ringtone = $state<RingtoneState>({ ok: true, uri: "", label: "" });
  let abriendoSonido = $state(false);

  const isAndroid = /Android/i.test(navigator.userAgent);

  async function cargarRingtone() {
    if (!isAndroid) return;
    try {
      const raw = await invoke<string>("attendance_get_ringtone");
      ringtone = JSON.parse(raw);
    } catch (e) {
      console.warn("[Notif] No se pudo leer el sonido:", e);
    }
  }

  /**
   * Lanza el selector nativo. El resultado NO vuelve por el `invoke`: Kotlin
   * emite el evento `android-ringtone-result` al WebView, porque el picker es
   * asíncrono y la WebView puede recargarse mientras el usuario está en él.
   */
  async function elegirSonido(tipo: "sistema" | "archivo") {
    if (abriendoSonido) return;
    abriendoSonido = true;
    try {
      await invoke("attendance_pick_ringtone", { tipo });
    } catch (e) {
      abriendoSonido = false;
      console.error("[Notif] No se pudo abrir el selector:", e);
      await emit("show-toast", { message: t("notif.toast.sinSelector"), type: "error" });
    }
    // `abriendoSonido` se baja recién en el evento o al volver a la app, por si
    // el usuario cancela el picker (en ese caso no llega ningún evento).
  }

  async function resetSonido() {
    try {
      await invoke("attendance_reset_ringtone");
      await cargarRingtone();
    } catch (e) {
      console.error("[Notif] No se pudo restablecer el sonido:", e);
    }
  }

  onMount(() => {
    void cargarRingtone();
    // El evento se escucha en `window` y no por `listen` de Tauri a propósito:
    // Kotlin lo inyecta con `CustomEvent`, que sobrevive aunque el objeto global
    // `__TAURI__` no esté disponible en la WebView (mismo motivo que
    // `google-native-auth-result`).
    const onResultado = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as RingtoneState | undefined;
      abriendoSonido = false;
      if (!detail) return;
      if (detail.ok) {
        ringtone = detail;
        void emit("show-toast", {
          message: detail.uri ? t("notif.toast.sonido", { label: detail.label }) : "🔔 " + t("notif.sonidoDefecto"),
          type: "success",
        });
      }
    };
    window.addEventListener("android-ringtone-result", onResultado);
    // Al volver a la app: si el usuario canceló el picker no llega evento, así
    // que el botón quedaría trabado en "abriendo..." para siempre.
    const onVisible = () => { if (document.visibilityState === "visible") abriendoSonido = false; };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("android-ringtone-result", onResultado);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });

  function cfgDe(id: number): NotifColegioCfg {
    return cfg[id] ?? { activo: false, ...CFG_POR_DEFECTO };
  }
  function setCfg(id: number, patch: Partial<NotifColegioCfg>) {
    cfg = { ...cfg, [id]: { ...cfgDe(id), ...patch } };
  }
  function toggleColegio(id: number) {
    setCfg(id, { activo: !cfgDe(id).activo });
  }

  async function loadSettings() {
    // Fuente de verdad: la tabla `app_settings` (BD sincronizada). Se releer de
    // la BD al montar para no depender de que el `loadAppSettings` del arranque
    // ya terminara. El fallback localStorage se mantiene para bases donde la
    // config nunca llegó a la BD.
    try {
      const s = await loadAppSettings();
      const dbTieneCfg = Object.keys(s.notifCfg || {}).length > 0;
      if (s.notifEnabled || dbTieneCfg) {
        enabled = !!s.notifEnabled;
        const map: Record<number, NotifColegioCfg> = {};
        for (const [id, c] of Object.entries(s.notifCfg || {})) {
          map[Number(id)] = {
            activo: !!c.activo,
            inicio: c.inicio || CFG_POR_DEFECTO.inicio,
            fin: c.fin || CFG_POR_DEFECTO.fin,
            intervaloMin: Number(c.intervaloMin) || CFG_POR_DEFECTO.intervaloMin,
          };
        }
        if (Object.keys(map).length > 0) cfg = map;
        return;
      }
    } catch (e) {
      console.warn("[Notif] No se pudo leer la config de la BD:", e);
    }
    // Respaldo: caché localStorage (formato { enabled, colegios[] }).
    try {
      const stored = localStorage.getItem(STORAGE_KEY_FALLBACK);
      if (!stored) return;
      const s = JSON.parse(stored);
      enabled = !!s.enabled;
      const map: Record<number, NotifColegioCfg> = {};
      for (const c of Array.isArray(s.colegios) ? s.colegios : []) {
        if (typeof c === "object" && c != null && c.id != null) {
          map[Number(c.id)] = {
            activo: true,
            inicio: c.inicio || CFG_POR_DEFECTO.inicio,
            fin: c.fin || CFG_POR_DEFECTO.fin,
            intervaloMin: Number(c.intervaloMin) || CFG_POR_DEFECTO.intervaloMin,
          };
        }
      }
      if (Object.keys(map).length > 0) cfg = map;
    } catch (e) {
      console.error("[Notif] Error cargando config:", e);
    }
  }

  async function loadCatalogs() {
    try {
      colegios = await invoke<ColegioItem[]>("get_colegios");
      await elegirColegioDePrueba();
    } catch (e) {
      console.error("[Notif] Error cargando colegios:", e);
    }
  }

  /** ¿Este colegio tiene HOY marcado como día de asistencia? */
  async function laborableHoy(colegioId: number): Promise<boolean> {
    try {
      const dias = await invoke<Record<string, boolean>>("get_colegio_dias_asistencia", { colegioId });
      // Sin fila en la tabla se asume que labora (mismo criterio que el backend:
      // `COALESCE(columna, 1) = 1`).
      return dias?.[DIAS[dayOfWeek()]] !== false;
    } catch {
      return true;
    }
  }

  function dayOfWeek(): number {
    return new Date(getLocalDateISOString() + "T12:00:00").getDay();
  }

  /**
   * El select de prueba SIEMPRE debe mostrar un colegio, para que "Probar real"
   * sea usable sin tocarlo. Se prefiere uno que tenga hoy como día hábil (si no,
   * la prueba siempre respondería "hoy NO es día hábil"); entre los que sirvan
   * gana el primero por orden alfabético. Sin config, el primero alfabético.
   */
  async function elegirColegioDePrueba() {
    if (colegios.length === 0) { testColegio = ""; return; }
    // Si el usuario ya eligió uno válido, no se le cambia debajo.
    if (testColegio && colegios.some(c => String(c.id) === testColegio)) return;

    // Orden alfabético estable por nombre (locale para acentos/ñ).
    const ordenados = [...colegios].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const resultados = await Promise.all(
      ordenados.map(async c => ({ c, ok: await laborableHoy(c.id) }))
    );
    const elegido = resultados.find(r => r.ok)?.c ?? ordenados[0];
    if (!elegido) { testColegio = ""; return; }
    testColegio = String(elegido.id);
  }

  async function refreshSilenced() {
    try {
      silencedToday = await invoke<boolean>("get_attendance_silenced_today");
    } catch {
      silencedToday = false;
    }
  }

  /**
   * Persiste la config y programa la alarma. Son dos pasos separados a proposito:
   * si la alarma falla, lo guardado NO se revierte, y el toast lo dice claro para
   * no invitar a pulsar Guardar en bucle sin efecto.
   */
  async function save() {
    saving = true;
    try {
      // Fila DEDICADA (`app_settings.key = 'attendance'`): un cambio de tema o
      // color en otro equipo reescribe `main` y ya no puede pisar esta config.
      await saveAttendanceSettings(enabled, cfg);
      // `saveAttendanceSettings` ya refrescó el espejo localStorage con el
      // criterio "enabled solo si hay colegios activos"; NO reescribirlo aquí.
      const config = configDesdeSettings(getAppSettings());

      if (!config.enabled) {
        await aplicarAlarmaAsistencia(getAppSettings());
        await emit("show-toast", { message: t("notif.toast.desactivadas"), type: "info" });
        return;
      }

      const detalle = config.colegios.map(c => {
        const nombre = colegios.find(x => x.id === c.id)?.nombre || `#${c.id}`;
        return `${nombre} ${c.inicio}-${c.fin}/${c.intervaloMin}m`;
      });
      try {
        await aplicarAlarmaAsistencia(getAppSettings());
        await emit("show-toast", { message: t("notif.toast.guardado", { detalle: detalle.join(", ") }), type: "success" });
      } catch (alarmErr) {
        console.error("[Notif] Error programando alarma:", alarmErr);
        const msg = alarmErr instanceof Error ? alarmErr.message : alarmErr;
        await emit("show-toast", { message: t("notif.toast.guardadoSinAlarma", { msg: String(msg) }), type: "warning" });
      }
    } catch (error) {
      console.error("[Notif] Error guardando:", error);
      await emit("show-toast", { message: t("notif.toast.errorGuardar", { error: String(error) }), type: "error" });
    } finally {
      saving = false;
    }
  }

  /** Dispara una notificacion real con los grados pendientes de HOY. */
  async function test() {
    // `testColegio` ya viene elegido por `elegirColegioDePrueba`; el `||` solo
    // cubre el caso sin colegios configurados.
    const cid = Number(testColegio) || colegios[0]?.id;
    if (!cid) { await emit("show-toast", { message: t("notif.toast.sinColegiosPrueba"), type: "warning" }); return; }
    testing = true;
    try {
      const fecha = getLocalDateISOString();
      const pendientes = await invoke<Array<{ grado: string; seccion: string }>>(
        "get_grados_secciones_sin_asistencia_hoy", { colegioId: cid, fecha }
      );
      const nombre = colegios.find(c => c.id === cid)?.nombre || "";
      if (!pendientes || pendientes.length === 0) {
        // Distinguir motivo: dia no habil vs todo registrado.
        let motivo = t("notif.motivo.todoRegistrado");
        try {
          const dias = await invoke<Record<string, boolean>>("get_colegio_dias_asistencia", { colegioId: cid });
          if (dias && dias[DIAS[dayOfWeek()]] === false) motivo = t("notif.motivo.noHabil");
        } catch { /* la tabla puede no existir: se deja el motivo por defecto */ }
        await emit("show-toast", { message: t("notif.toast.sinPendientes", { motivo }), type: "info" });
        return;
      }
      const lista = pendientes.slice(0, 5).map(p => `${p.grado} ${p.seccion}`).join(", ");
      const resto = pendientes.length > 5 ? t("notif.yMas", { n: pendientes.length - 5 }) : "";
      await invoke("notify_attendance_reminder", {
        title: t("notif.alarm.titulo"),
        body: t("notif.alarm.cuerpo", { nombre, lista, resto }),
      });
      await emit("show-toast", { message: t("notif.toast.enviada", { n: pendientes.length }), type: "success" });
    } catch (error) {
      console.error("[Notif] Error en la prueba:", error);
      await emit("show-toast", { message: t("notif.toast.error", { error: String(error) }), type: "error" });
    } finally {
      testing = false;
    }
  }

  async function dismissToday() {
    dismissing = true;
    try {
      await invoke("dismiss_attendance_today");
      silencedToday = true;
      await emit("show-toast", { message: t("notif.silenciadoHoy"), type: "success" });
    } catch (error) {
      await emit("show-toast", { message: t("notif.toast.error", { error: String(error) }), type: "error" });
    } finally {
      dismissing = false;
    }
  }

  async function reactivateToday() {
    try {
      await invoke("set_attendance_silenced_today", { silenced: false });
      silencedToday = false;
      await emit("show-toast", { message: t("notif.toast.reactivados"), type: "success" });
    } catch (error) {
      await emit("show-toast", { message: t("notif.toast.error", { error: String(error) }), type: "error" });
    }
  }

  $effect(() => {
    if (cargada) return;
    cargada = true;
    loadSettings();
    loadCatalogs();
    refreshSilenced();
  });
</script>

<div class="notif-page">
  <!-- Header glass con toggle global -->
  <div class="notif-hero">
    <div class="notif-hero-icon">🔔</div>
    <div style="flex:1;min-width:0">
      <h3 style="margin:0 0 2px;font-size:1.05rem;color:#f1f5f9;">{t('notif.titulo')}</h3>
      <p style="margin:0;font-size:0.75rem;color:#94a3b8;line-height:1.45;">{t('notif.desc')}</p>
    </div>
    <label class="switch" style="flex-shrink:0">
      <input type="checkbox" bind:checked={enabled} />
      <span class="slider"></span>
    </label>
  </div>

  {#if enabled}
    <!-- Cards por colegio. Sin borde, el `gap` es lo que las separa. -->
    <div class="notif-lista">
      {#each colegios as c (c.id)}
        {@const c0 = cfgDe(c.id)}
        <div class="notif-colegio-card" class:activa={c0.activo}>
          <div class="notif-colegio-head" onclick={() => toggleColegio(c.id)}>
            <span class="notif-check">{c0.activo ? "✓" : ""}</span>
            <span class="notif-colegio-nombre">{c.nombre}</span>
          </div>
          {#if c0.activo}
            <div class="notif-colegio-body">
              <div class="notif-campo">
                <label>{t('notif.desde')}</label>
                <input type="time" value={c0.inicio} onchange={(e) => setCfg(c.id, { inicio: e.currentTarget.value })} />
              </div>
              <div class="notif-campo">
                <label>{t('notif.hasta')}</label>
                <input type="time" value={c0.fin} onchange={(e) => setCfg(c.id, { fin: e.currentTarget.value })} />
              </div>
              <div class="notif-campo" style="flex:1.3">
                <label>{t('notif.repetirCada')}</label>
                <!-- `String(m)` en las options: con numero nunca coincidia el
                     `value` del select y volvia siempre a la primera opcion. -->
                <select
                  value={String(c0.intervaloMin)}
                  onchange={(e) => setCfg(c.id, { intervaloMin: Number(e.currentTarget.value) })}>
                  {#each INTERVALOS as m}
                    <option value={String(m)}>{m} min</option>
                  {/each}
                </select>
              </div>
            </div>
            <div class="notif-resumen">{t('notif.resumen', { inicio: c0.inicio, fin: c0.fin, intervalo: c0.intervaloMin })}</div>
          {/if}
        </div>
      {:else}
        <div class="notif-empty"><span>👆</span><span>{t('notif.sinColegios')}</span></div>
      {/each}
      {#if Object.values(cfg).filter(c => c.activo).length === 0 && colegios.length > 0}
        <div class="notif-empty"><span>👆</span><span>{t('notif.tocaColegio')}</span></div>
      {/if}
    </div>

    <!-- Acciones -->
    <div class="notif-campo" style="width:100%;padding:0 0.75rem;">
      <label>{t('notif.colegioPrueba')}</label>
      {#if colegios.length === 0}
        <select disabled><option>{t('notif.sinColegiosCfg')}</option></select>
      {:else}
        <select bind:value={testColegio}>
          {#each colegios as c (c.id)}
            <option value={String(c.id)}>{c.nombre}</option>
          {/each}
        </select>
      {/if}
    </div>
    <div class="notif-acciones">
      <button class="notif-btn-primary" onclick={save} disabled={saving}>
        {saving ? t('notif.guardando') : t('notif.btn.guardar')}
      </button>
      <button class="notif-btn-ghost" onclick={test} disabled={testing || colegios.length === 0}>
        {testing ? t('notif.probando') : t('notif.btn.probar')}
      </button>
    </div>

    <!-- Sonido de la alarma (solo Android) -->
    {#if isAndroid}
      <div class="notif-campo" style="width:100%;padding:0 0.75rem;">
        <label>{t('notif.sonido')}</label>
        <div class="notif-sonido-actual">
          <span style="font-size:1.1rem;">🔔</span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            {ringtone.label || t('notif.sonidoDefecto')}
          </span>
        </div>
        <div class="notif-sonido-btns">
          <button class="notif-btn-ghost" onclick={() => elegirSonido("sistema")}
            disabled={abriendoSonido} style="width:auto;">
            {abriendoSonido ? t('notif.abriendo') : t('notif.delSistema')}
          </button>
          <button class="notif-btn-ghost" onclick={() => elegirSonido("archivo")}
            disabled={abriendoSonido} style="width:auto;">
            {t('notif.archivo')}
          </button>
          {#if ringtone.uri}
            <button class="notif-btn-ghost" onclick={resetSonido} style="width:auto;">{t('notif.default')}</button>
          {/if}
        </div>
        <p style="margin:0.4rem 0 0;font-size:0.7rem;color:#64748b;line-height:1.45;">
          {t('notif.sonidoNota')}
        </p>
      </div>
    {/if}

    <!-- Silenciar hoy -->
    {#if silencedToday}
      <div class="notif-banner-ok" style="margin:0 0.75rem;">
        <span>{t('notif.silenciadoHoy')}</span>
        <button onclick={reactivateToday} class="notif-btn-mini">{t('notif.reactivar')}</button>
      </div>
    {:else}
      <button class="notif-btn-ghost" onclick={dismissToday} disabled={dismissing} style="align-self:flex-start;width:auto;">
        {dismissing ? t('notif.silenciando') : t('notif.silenciarHoy')}
      </button>
    {/if}

    <div class="notif-nota">
       {t('notif.notaAndroid')}
    </div>
  {:else}
    <div class="notif-empty"><span>🔕</span><span>{t('notif.desactivadas')}</span></div>
  {/if}
</div>

<style>
  /* ── Contenedor: full-bleed como EvaluacionesPage ── */
  .notif-page {
    display: flex; flex-direction: column; gap: 0.75rem;
    /* `stretch` + ancho completo: sin esto el flex column encoge las cards al
       contenido y quedan angostas en Android. */
    align-items: stretch;
    width: 100%; max-width: 100%; min-width: 0;
    box-sizing: border-box;
  }
  .notif-lista {
    display: flex; flex-direction: column; gap: 0.9rem;
    width: 100%; max-width: 100%;
    align-items: stretch;
  }
  .notif-acciones {
    display: flex; gap: 0.6rem;
    width: 100%; padding: 0 0.75rem;
    box-sizing: border-box;
  }
  .notif-acciones > * { flex: 1; min-width: 0; }

  /* Vacio: se define aqui porque `empty-state-sm` solo existe (scoped) en
     DashboardPage, asi que nunca aplicaba en Ajustes. */
  .notif-empty {
    display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
    padding: 1.5rem 0.75rem; font-size: 0.85rem; color: #64748b; text-align: center;
  }

  /* ── Hero ── */
  .notif-hero {
    display: flex; align-items: center; gap: 0.9rem;
    padding: 1rem 0.85rem; border-radius: 18px;
    width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box;
    background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(139,92,246,0.06));
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: none;
    box-shadow: 0 8px 28px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05);
  }
  .notif-hero-icon {
    width: 46px; height: 46px; border-radius: 14px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 1.3rem;
    background: rgba(245,158,11,0.14); border: none;
    backdrop-filter: blur(10px);
  }

  /* ── Card de colegio: sin borde, a sangre total ── */
  .notif-colegio-card {
    width: 100%; max-width: 100%; min-width: 0;
    box-sizing: border-box; align-self: stretch;
    border-radius: 16px; overflow: hidden;
    /* Sin borde la card necesita algo mas de fondo para separarse del lienzo. */
    background: rgba(255,255,255,0.045);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border: none;
    transition: all 0.2s ease;
  }
  /* El estado activo ya no puede marcar `border-color`; usa fondo + barra. */
  .notif-colegio-card.activa {
    background: rgba(var(--primary-rgb), 0.07);
    box-shadow: inset 3px 0 0 var(--primary-color);
  }
  .notif-colegio-head {
    display: flex; align-items: center; gap: 0.7rem;
    padding: 0.85rem 0.75rem; cursor: pointer; user-select: none;
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
  .notif-colegio-nombre {
    flex: 1; min-width: 0; font-size: 0.88rem; font-weight: 600; color: #e2e8f0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .notif-colegio-body {
    display: flex; gap: 0.5rem; padding: 0 0.75rem 0.5rem;
    width: 100%; box-sizing: border-box;
  }
  /* `min-width: 0` deja que los campos se encojan: sin esto el input de hora
     (ancho minimo del picker nativo) ensancha la card en pantallas angostas. */
  .notif-campo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
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
    margin: 0 0.75rem 0.75rem; padding: 0.35rem 0.6rem; border-radius: 8px;
    font-size: 0.68rem; color: #94a3b8;
    background: rgba(0,0,0,0.2); border-left: 3px solid var(--primary-color);
  }

  /* ── Botones ── */
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
  .notif-btn-ghost:disabled { opacity: 0.6; cursor: default; }

  /* Selector de sonido: el nombre puede ser largo (rutas del explorador de
     archivos), así que la fila actual recorta con ellipsis en vez de romper el
     layout, y los botones se envuelven en columna. */
  .notif-sonido-actual {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 0.7rem; border-radius: 10px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    font-size: 0.8rem; color: #e2e8f0;
  }
  .notif-sonido-btns {
    display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.4rem;
  }
  .notif-sonido-btns > * { flex: 1 1 auto; min-width: 0; }
  .notif-btn-mini {
    padding: 0.35rem 0.75rem; border-radius: 8px; cursor: pointer;
    border: 1px solid rgba(16,185,129,0.4); background: rgba(16,185,129,0.15);
    color: #6ee7b7; font-weight: 600; font-size: 0.72rem;
  }

  /* ── Banners ── */
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

  /* ── Switch del toggle global ── */
  .notif-hero .switch { position: relative; display: inline-block; width: 52px; height: 30px; margin: 0; }
  .notif-hero .switch input { opacity: 0; width: 0; height: 0; }
  .notif-hero .slider {
    position: absolute; inset: 0;
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 999px; cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .notif-hero .slider::before {
    content: ''; position: absolute; width: 22px; height: 22px;
    left: 4px; top: 50%; transform: translateY(-50%);
    background: #cbd5e1; border-radius: 50%;
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
</style>
