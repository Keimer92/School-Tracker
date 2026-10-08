<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
import { t } from "../lib/i18n.svelte";
  import {
    getPerfilLocal, setPerfilLocal, clearPerfilLocal,
    getValidAuthToken, getAuthToken,
    fetchAdminUsers, suspendUser, deleteUserData,
    DEFAULT_WORKER_URL,
    type CloudPerfil, type AdminUserInfo,
  } from "../lib/cloudAuth";
  import { iniciarSesionGoogleConNube } from "../lib/cloudLogin";
  import { setBackAuthInProgress } from "../lib/androidBack";
  import { d1SyncService } from "../lib/d1SyncService";
  import { invalidateD1Cache, syncService } from "../lib/syncService";
  import { ensureWsSync, stopWsSync } from "../lib/wsSyncService";
  import { driveSyncService } from "../lib/driveSyncService";

  let { onNavigate }: { onNavigate?: (tab: string) => void } = $props();

  let perfil: CloudPerfil | null = $state(getPerfilLocal());
  let dbPath = $state("");
  let isAndroid = /Android/i.test(navigator.userAgent);

  async function loadDbPath() {
    try { dbPath = await invoke<string>("get_db_path"); } catch {}
  }

  // ── Login / logout ──
  let loginLoading = $state(false);
  let loginMsg = $state("");

  async function handleLogin() {
    loginLoading = true;
    loginMsg = "";
    try {
      const res = await iniciarSesionGoogleConNube({
        onStatus: (m) => { loginMsg = m; },
        setBackAuth: setBackAuthInProgress,
      });
      if (res.status === 'ok') {
        perfil = getPerfilLocal();
        await loadDbPath();
        await emit("show-toast", {
          message: perfil?.rol === 'admin' ? t('acc.toast.adminLogin') : t('acc.toast.loginOk'),
          type: "success",
        });
      } else if (res.status === 'cancelled') {
        await emit("show-toast", { message: t('acc.toast.cancelada'), type: "info" });
      } else if (res.status === 'sin-nube') {
        await emit("show-toast", { message: t('acc.toast.sinNube'), type: "info" });
      } else {
        await emit("show-toast", { message: "❌ " + res.error, type: "error" });
      }
    } finally {
      loginLoading = false;
      loginMsg = "";
    }
  }

  function cerrarSesion() {
    clearPerfilLocal();
    perfil = null;
    adminUsers = [];
    showAdminPanel = false;
    emit("show-toast", { message: t('acc.toast.sesionCerrada'), type: "info" });
  }

  /**
   * Traspaso del dispositivo a otra persona: respaldo a Drive, borrado de los
   * datos locales y del vínculo con la nube, y vuelta al Welcome.
   *
   * El orden está en `deviceHandover.ts` y es importante: si el respaldo a Drive
   * falla, no se borra nada y se avisa.
   */
  let handoverBusy = $state(false);
  let handoverEtapa = $state('');

  async function traspasar() {
    if (handoverBusy) return;
    const ok = await ask(
      t('acc.borrarDatos') + '\n\n' +
      t('acc.primeroRespaldo') + '\n\n' +
      t('acc.volverInicio') + '\n\n' +
      t('acc.continuarPregunta'),
      { title: t('acc.traspasarDispositivo'), kind: 'warning', okLabel: t('acc.respaldarYTraspasar'), cancelLabel: t('comun.cancelar') }
    );
    if (!ok) return;
    handoverBusy = true;
    handoverEtapa = t('acc.respaldando');
    try {
      const { traspasarDispositivo } = await import('../lib/deviceHandover');
      const res = await traspasarDispositivo({
        onEtapa: (etapa) => { handoverEtapa = etapa; },
      });
      if (res.ok) {
        handoverEtapa = t('acc.listoReiniciando');
        await emit("show-toast", { message: t('acc.toast.traspasado'), type: "success" });
      } else {
        handoverEtapa = '';
        await emit("show-toast", { message: t('acc.toast.error') + (res.motivo || t('acc.noCompletoTraspaso')), type: "error" });
      }
    } catch (e: any) {
      handoverEtapa = '';
      await emit("show-toast", { message: t('acc.toast.errorTraspaso') + (e?.message || e), type: "error" });
    } finally {
      if (handoverEtapa !== t('acc.listoReiniciando')) handoverBusy = false;
    }
  }
  // ── Admin panel ──
  let showAdminPanel = $state(false);
  let adminUsers: AdminUserInfo[] = $state([]);
  let adminLoading = $state(false);
  let adminActionBusy = $state(false);

  async function cargarUsuarios() {
    const token = await getValidAuthToken();
    if (!token) { await emit("show-toast", { message: t('acc.toast.sinSesionAdmin'), type: "warning" }); return; }
    adminLoading = true;
    try {
      const d1c = await invoke<any>("d1_get_config");
      const workerUrl = d1c?.workerUrl || undefined;
      adminUsers = await fetchAdminUsers(workerUrl);
    } catch (e) {
      await emit("show-toast", { message: t('acc.toast.errorUsuarios') + e, type: "error" });
    } finally { adminLoading = false; }
  }

  async function toggleSuspend(u: AdminUserInfo) {
    const accion = u.suspendido ? t('acc.ask.accionRestaurar') : t('acc.ask.accionSuspender');
    const ok = await ask(t('acc.ask.suspenderMsg', { accion, nombre: u.nombre, email: u.email, extra: u.suspendido ? "" : t('acc.ask.noSincroniza') }), {
      title: u.suspendido ? t('acc.ask.restaurarTitulo') : t('acc.ask.suspenderTitulo'),
      kind: "warning", okLabel: u.suspendido ? t('acc.restaurar') : t('acc.suspender'), cancelLabel: t('comun.cancelar'),
    });
    if (!ok) return;
    adminActionBusy = true;
    try {
      await suspendUser(u.email, !u.suspendido);
      u.suspendido = !u.suspendido;
      adminUsers = [...adminUsers];
      await emit("show-toast", { message: u.suspendido ? t('acc.toast.suspendido') : t('acc.toast.restaurado'), type: "success" });
    } catch (e) {
      await emit("show-toast", { message: t('acc.toast.error') + e, type: "error" });
    } finally { adminActionBusy = false; }
  }

  async function purgarDatos(u: AdminUserInfo) {
    const ok = await ask(t('acc.ask.purgarMsg', { nombre: u.nombre, email: u.email }), {
      title: t('acc.ask.purgarTitulo'), kind: "warning", okLabel: t('acc.ask.eliminarTodo'), cancelLabel: t('comun.cancelar'),
    });
    if (!ok) return;
    adminActionBusy = true;
    try {
      const n = await deleteUserData(u.email);
      await emit("show-toast", { message: t('acc.toast.purgado', { n, email: u.email }), type: "success" });
    } catch (e) {
      await emit("show-toast", { message: t('acc.toast.error') + e, type: "error" });
    } finally { adminActionBusy = false; }
  }

  onMount(() => {
    loadDbPath();
  });
</script>

<div class="account-page">
  <!-- Login card (no profile) -->
  {#if !perfil}
    <div class="account-card" style="margin-bottom: 1.25rem;">
      <div class="account-card-header">
        <h3>
          <span class="header-badge">
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            {t('acc.titulo')}
          </span>
        </h3>
      </div>
      <div class="account-card-body" style="text-align: center;">
        <p style="color: #94a3b8; font-size: 0.88rem; margin: 0 0 1.1rem;">{t('acc.loginGoogle')}</p>
        {#if loginLoading}
          <div style="display:flex;flex-direction:column;align-items:center;gap:0.6rem;">
            <button disabled class="btn-google-loading">{t('acc.continuing')}</button>
            {#if loginMsg}<p style="color:#94a3b8;font-size:0.78rem;margin:0;">{loginMsg}</p>{/if}
          </div>
        {:else}
          <button onclick={handleLogin} class="btn-google">
            {t('acc.btnGoogle')}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Profile card -->
  {#if perfil}
    <div class="account-card" style="margin-bottom: 1.25rem;">
      <div class="profile-row">
        {#if perfil.foto}
          <img src={perfil.foto} alt="" referrerpolicy="no-referrer" class="profile-pic" />
        {:else}
          <div class="profile-pic profile-pic-fallback">👤</div>
        {/if}
        <div style="flex:1;min-width:140px;">
          <div style="color:#f1f5f9;font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:6px;">
            {perfil.nombre}
            {#if perfil.rol === 'admin'}<span class="badge-admin">{t('acc.admin')}</span>{/if}
          </div>
          <div style="color:#94a3b8;font-size:0.78rem;">{perfil.email}</div>
        </div>
        <button onclick={cerrarSesion} class="btn-logout">{t('acc.cerrarSesion')}</button>
      </div>

      {#if dbPath}
        <div class="db-path-row">
          <span class="label-sm">{t('acc.baseDatosActiva')}</span>
          <span class="db-path" title={dbPath}>{dbPath.split(/[/\\]/).pop()}</span>
        </div>
      {/if}

      {#if perfil.rol === 'admin'}
        <div style="padding: 0 1.5rem 1.1rem;">
          <button onclick={() => { showAdminPanel = !showAdminPanel; if (showAdminPanel && adminUsers.length === 0) cargarUsuarios(); }}
            class="btn-admin-toggle">
            {t('acc.panelAdmin')} {showAdminPanel ? '▲' : '▼'}
          </button>
          {#if showAdminPanel}
            <div class="admin-panel">
              {#if adminLoading}
                <p style="color:#94a3b8;font-size:0.8rem;margin:0.4rem;">{t('acc.cargandoUsuarios')}</p>
              {:else if adminUsers.length === 0}
                <p style="color:#64748b;font-size:0.8rem;margin:0.4rem;">{t('acc.sinUsuarios')}</p>
              {:else}
                {#each adminUsers as u (u.email)}
                  <div class="admin-user-row">
                    {#if u.foto}
                      <img src={u.foto} alt="" referrerpolicy="no-referrer" class="admin-user-pic" />
                    {:else}
                      <div class="admin-user-pic admin-user-pic-fallback">👤</div>
                    {/if}
                    <div style="flex:1;min-width:0;">
                      <div style="color:#e2e8f0;font-size:0.8rem;font-weight:600;{u.suspendido ? 'text-decoration:line-through;opacity:0.6;' : ''}">{u.nombre}{u.rol === 'admin' ? ' · ' + t('acc.adminBadge') : ''}</div>
                      <div style="color:#64748b;font-size:0.68rem;">{u.email} · {t('acc.alta')} {u.creado?.slice(0, 10)}</div>
                    </div>
                    {#if u.rol !== 'admin'}
                      <button onclick={() => toggleSuspend(u)} disabled={adminActionBusy}
                        class="btn-admin-action" style="border-color:{u.suspendido ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'};background:{u.suspendido ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)'};color:{u.suspendido ? '#4ade80' : '#fbbf24'};">
                        {u.suspendido ? t('acc.restaurar') : t('acc.suspender')}
                      </button>
                      <button onclick={() => purgarDatos(u)} disabled={adminActionBusy}
                        class="btn-admin-action" style="border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#fca5a5;">
                        {t('acc.datos')}
                      </button>
                    {/if}
                  </div>
                {/each}
              {/if}
              <button onclick={cargarUsuarios} disabled={adminLoading} class="btn-admin-reload">
                {adminLoading ? t('acc.cargando') : t('acc.recargarLista')}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Linked accounts + Switch -->
  <div class="account-card" style="margin-bottom: 1.25rem;">
    <div class="account-card-header">
      <h3>
        <span class="header-badge">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4285F4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>
          {t('acc.traspasarDispositivo')}
        </span>
      </h3>
    </div>
    <div class="account-card-body">
      <!--
        Antes esto era "cuentas vinculadas" con un selector para saltar de una a
        otra. Se reemplazó por el traspaso: el dispositivo se respalda a Drive, se
        borra y vuelve al Welcome para que entre la próxima persona. Alternar
        cuentas en el mismo equipo mezclaba contexts (el `.db` de una cuenta con
        el `d1_config` de otra), que es la clase de error más difícil de detectar
        en esta app.
      -->
      <p style="color:#94a3b8;font-size:0.8rem;line-height:1.5;margin:0 0 0.8rem;">
        {t('acc.traspasar.p1')}
      </p>
      <p style="color:#64748b;font-size:0.72rem;line-height:1.5;margin:0 0 0.8rem;">
        {t('acc.traspasar.p2')}
      </p>
      <button onclick={traspasar} disabled={handoverBusy} class="btn-switch"
        style="background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.3);color:#fca5a5;">
        {handoverBusy ? handoverEtapa : t('acc.btnTraspasar')}
      </button>
    </div>
  </div>
</div>

<style>
  .account-page { max-width: 640px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; }
  .account-card { background: var(--card-bg); border-radius: 20px; border: 1px solid var(--card-border); overflow: hidden; }
  .account-card-header { padding: 1.25rem 1.5rem 0; }
  .account-card-header h3 { margin: 0; color: var(--text-primary); font-size: 1.1rem; font-weight: 700; }
  .header-badge {
    display: inline-flex; align-items: center; gap: 10px;
    background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
    padding: 0.5rem 1rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);
  }
  .account-card-body { padding: 1.25rem 1.5rem 1.5rem; }

  .profile-row {
    padding: 1.1rem 1.5rem; display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap;
  }
  .profile-pic {
    width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.15); object-fit: cover;
  }
  .profile-pic-fallback {
    display: flex; align-items: center; justify-content: center; font-size: 1.2rem;
    background: rgba(52,168,83,0.15); border: 2px solid rgba(52,168,83,0.3);
  }
  .badge-admin {
    font-size: 0.6rem; background: rgba(245,158,11,0.15); color: #fbbf24;
    padding: 0.1rem 0.4rem; border-radius: 4px; text-transform: uppercase; font-weight: 800;
  }
  .btn-logout {
    padding: 0.4rem 0.85rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.25);
    background: rgba(239,68,68,0.08); color: #fca5a5; cursor: pointer; font-size: 0.75rem; font-weight: 600;
  }

  .db-path-row {
    padding: 0 1.5rem 1rem; display: flex; flex-direction: column; gap: 0.3rem;
  }
  .label-sm {
    font-size: 0.65rem; letter-spacing: 0.5px; color: #64748b; text-transform: uppercase; font-weight: 600;
  }
  .db-path {
    font-family: monospace; font-size: 0.75rem; color: #94a3b8;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background: rgba(0,0,0,0.2); padding: 0.3rem 0.6rem; border-radius: 6px;
  }

  .btn-admin-toggle {
    width: 100%; padding: 0.55rem 1rem; border-radius: 10px;
    border: 1px solid rgba(245,158,11,0.25); background: rgba(245,158,11,0.07);
    color: #fbbf24; cursor: pointer; font-size: 0.8rem; font-weight: 600;
  }
  .admin-panel {
    margin-top: 0.75rem; padding: 0.9rem; background: rgba(0,0,0,0.2); border-radius: 12px;
  }
  .admin-user-row {
    display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.35rem;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .admin-user-pic {
    width: 30px; height: 30px; border-radius: 50%; object-fit: cover;
  }
  .admin-user-pic-fallback {
    display: flex; align-items: center; justify-content: center; font-size: 0.9rem;
    background: rgba(255,255,255,0.08);
  }
  .btn-admin-action {
    padding: 0.3rem 0.6rem; border-radius: 7px; border: 1px solid;
    cursor: pointer; font-size: 0.65rem; font-weight: 600;
  }
  .btn-admin-reload {
    margin-top: 0.6rem; padding: 0.4rem 0.8rem; border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
    color: #cbd5e1; cursor: pointer; font-size: 0.72rem; font-weight: 600;
  }

  .account-item {
    display: flex; align-items: center; gap: 0.6rem; width: 100%;
    padding: 0.5rem 0.7rem; margin-bottom: 0.35rem; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02);
    color: #e2e8f0; cursor: pointer; font-size: 0.8rem; text-align: left;
  }
  .account-item.active {
    border-color: rgba(66,133,244,0.5); background: rgba(66,133,244,0.12); opacity: 0.85; cursor: default;
  }
  .account-item:disabled { cursor: default; }
  .account-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .btn-switch {
    width: 100%; padding: 0.7rem 1rem; border-radius: 12px;
    border: 1px solid rgba(168,85,247,0.3);
    background: linear-gradient(135deg, rgba(168,85,247,0.15), rgba(99,102,241,0.12));
    color: #c4b5fd; cursor: pointer; font-size: 0.85rem; font-weight: 600;
  }
  .btn-switch:disabled { opacity: 0.6; cursor: default; }

  .btn-google {
    padding: 0.8rem 2rem; background: linear-gradient(135deg, #4285F4, #34A853);
    border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 1rem;
    cursor: pointer; box-shadow: 0 4px 16px rgba(66,133,244,0.3);
  }
  .btn-google-loading {
    padding: 0.8rem 2rem; background: linear-gradient(135deg, #4285F4, #34A853);
    border: none; color: white; border-radius: 12px; font-weight: 600; font-size: 1rem;
    opacity: 0.7; cursor: default;
  }
</style>
