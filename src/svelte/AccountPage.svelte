<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import {
    getPerfilLocal, setPerfilLocal, clearPerfilLocal,
    getValidAuthToken, getAuthToken,
    fetchAdminUsers, suspendUser, deleteUserData,
    DEFAULT_WORKER_URL,
    type CloudPerfil, type AdminUserInfo,
  } from "../lib/cloudAuth";
  import {
    saveProfile, getProfile, setCurrentEmail, listProfiles, patchProfileTokens,
    type AccountProfile,
  } from "../lib/accountProfiles";
  import { iniciarSesionGoogleConNube } from "../lib/cloudLogin";
  import { setBackAuthInProgress } from "../lib/androidBack";
  import { d1SyncService } from "../lib/d1SyncService";
  import { invalidateD1Cache, syncService } from "../lib/syncService";
  import { ensureWsSync, stopWsSync } from "../lib/wsSyncService";
  import { driveSyncService } from "../lib/driveSyncService";

  let { onNavigate }: { onNavigate?: (tab: string) => void } = $props();

  let perfil: CloudPerfil | null = $state(getPerfilLocal());
  let linkedAccounts: AccountProfile[] = $state([]);
  let dbPath = $state("");
  let isAndroid = /Android/i.test(navigator.userAgent);

  function refreshLinkedAccounts() { linkedAccounts = listProfiles(); }

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
        refreshLinkedAccounts();
        await loadDbPath();
        await emit("show-toast", {
          message: perfil?.rol === 'admin' ? "👑 Sesión de administrador iniciada" : "✅ Sesión iniciada con Google",
          type: "success",
        });
      } else if (res.status === 'cancelled') {
        await emit("show-toast", { message: "Autenticación cancelada", type: "info" });
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
    emit("show-toast", { message: "👋 Sesión cerrada (la nube y tus datos permanecen intactos)", type: "info" });
  }

  // ── Cambio de cuenta (stored) ──
  let switchingAccount = $state(false);

  function parseIdTokenExp(idToken: string): number {
    try { const p = JSON.parse(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return (p.exp || 0) * 1000; } catch { return 0; }
  }

  async function openAccountDb(email: string) {
    try {
      const { driveAutoBackup } = await import('../lib/driveAutoBackup');
      await driveAutoBackup.flushBeforeAccountSwap();
    } catch (e) {
      console.warn('[AccountPage] flush Drive antes del swap falló:', e);
    }
    await invoke("open_account_db", { email, migrateFromDefault: true });
    setCurrentEmail(email);
  }

  async function finalizeAccountSwitch(opts: {
    email: string;
    cloud?: { workerUrl: string; schoolKey: string } | null;
    seedIfEmpty?: boolean;
  }): Promise<boolean> {
    const { email, cloud, seedIfEmpty = true } = opts;
    await invalidateD1Cache();
    if (cloud && cloud.workerUrl && cloud.schoolKey) {
      await d1SyncService.saveConfig(cloud.workerUrl, cloud.schoolKey);
    }
    stopWsSync();
    ensureWsSync();
    try { await invoke("d1_sync_all", {}); } catch (e) { console.warn("[cambiarCuenta] sync falló:", e); }
    try { await driveSyncService.pushAll(); } catch (e) { console.warn("[cambiarCuenta] Drive push falló:", e); }
    perfil = getPerfilLocal();
    const sts: any = await invoke("get_students").catch(() => []);
    const empty = !Array.isArray(sts) || sts.length === 0;
    await emit("data-updated", {});
    await emit("catalog-updated", {});
    await emit("student-updated", {});
    stopWsSync();
    ensureWsSync();
    if (empty && seedIfEmpty) {
      try { await invoke("seed_defaults_now"); } catch (e) { console.warn("[cambiarCuenta] seed falló:", e); }
      onNavigate?.("ajustes");
    }
    return !empty;
  }

  function applyAccountStores(acct: {
    idToken?: string; accessToken?: string | null; refreshToken?: string | null;
    idExpiresAt?: number; driveExpiresAt?: number; clientId?: string;
    email: string; nombre?: string; foto?: string;
  }) {
    const STORAGE_KEY = 'schooltracker-google-drive-settings';
    const DEFAULT_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
    let settings: any = {};
    try { settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
    settings.clientId = acct.clientId || settings.clientId || DEFAULT_CLIENT_ID;
    if (acct.accessToken !== undefined) settings.accessToken = acct.accessToken;
    if (acct.refreshToken !== undefined) settings.refreshToken = acct.refreshToken;
    if (acct.driveExpiresAt !== undefined) settings.tokenExpiry = acct.driveExpiresAt;
    settings.googleUserEmail = acct.email;
    settings.googleUserName = acct.nombre || null;
    settings.googleUserProfilePic = acct.foto || null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    if (acct.idToken) {
      const prev = getAuthToken();
      // Keep existing refresh token if new one not provided
      const prevProfile = getProfile(acct.email);
      const rt = acct.refreshToken || prevProfile?.googleRefreshToken || "";
      const bundle = { idToken: acct.idToken, refreshToken: rt, expiresAt: parseIdTokenExp(acct.idToken) };
      localStorage.setItem('stp_cloud_idtoken', JSON.stringify(bundle));
    }
    setPerfilLocal({ email: acct.email, nombre: acct.nombre || '', foto: acct.foto || '', rol: 'user' });
  }

  async function switchToStoredAccount(email: string) {
    if (switchingAccount || loginLoading) return;
    const prof = getProfile(email);
    if (!prof || !prof.googleRefreshToken) {
      await emit("show-toast", { message: "Esta cuenta requiere volver a iniciar sesión (no hay tokens guardados).", type: "info" });
      return;
    }
    const ok = await ask(
      `Vas a cambiar a la cuenta ${prof.email}.\n\nCada cuenta tiene su propia base de datos local y su nube. Tus datos de esta cuenta se conservan.\n\n¿Continuar?`,
      { title: 'Cambiar de cuenta', kind: 'warning', okLabel: 'Sí, cambiar', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    switchingAccount = true;
    try {
      await openAccountDb(prof.email);
      applyAccountStores({
        idToken: prof.googleIdToken || '',
        accessToken: prof.googleAccessToken ?? null,
        refreshToken: prof.googleRefreshToken ?? null,
        idExpiresAt: prof.googleIdExpiresAt,
        driveExpiresAt: prof.googleDriveExpiresAt,
        clientId: prof.googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
        email: prof.email,
        nombre: prof.nombre,
        foto: prof.foto,
      });
      await finalizeAccountSwitch({ email: prof.email, seedIfEmpty: true });
      patchProfileTokens(prof.email, {
        googleIdToken: getAuthToken(),
        googleClientId: prof.googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
      });
      refreshLinkedAccounts();
      await emit("show-toast", { message: `✅ Ahora usando la cuenta ${prof.email}`, type: "success" });
    } catch (e) {
      await emit("show-toast", { message: "❌ Error al cambiar de cuenta: " + e, type: "error" });
    } finally {
      switchingAccount = false;
    }
  }

  async function cambiarCuenta() {
    if (switchingAccount || loginLoading) return;
    const ok = await ask(
      'Vas a iniciar sesión con otra cuenta de Google.\n\n' +
      'Cada cuenta tiene su propia base de datos local y su nube. Al cambiar, se abre el archivo de esa cuenta ' +
      'y se sincroniza con su nube; los datos de las demás cuentas NO se tocan.\n\n' +
      '¿Continuar?',
      { title: 'Cambiar de cuenta', kind: 'warning', okLabel: 'Sí, cambiar', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;
    switchingAccount = true;
    try {
      const res = await iniciarSesionGoogleConNube({
        forceSelectAccount: true,
        skipSync: true,
        onStatus: (m) => emit("show-toast", { message: m, type: "info" }),
        setBackAuth: setBackAuthInProgress,
      });
      if (res.status === 'cancelled') {
        await emit("show-toast", { message: "Cambio de cuenta cancelado", type: "info" });
        return;
      }
      if (res.status === 'error') {
        await emit("show-toast", { message: "❌ " + res.error, type: "error" });
        return;
      }
      const newEmail = (res.result?.perfil?.email || '').toLowerCase();
      applyAccountStores({
        idToken: res.tokens?.idToken || '',
        accessToken: res.tokens?.accessToken ?? null,
        refreshToken: res.tokens?.refreshToken ?? null,
        idExpiresAt: res.tokens?.idToken ? parseIdTokenExp(res.tokens.idToken) : undefined,
        driveExpiresAt: res.tokens?.accessToken ? Date.now() + 3600 * 1000 : undefined,
        clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
        email: newEmail,
        nombre: res.result?.perfil?.nombre,
        foto: res.result?.perfil?.foto,
      });
      if (res.tokens) {
        patchProfileTokens(newEmail, {
          googleIdToken: res.tokens.idToken,
          googleAccessToken: res.tokens.accessToken,
          googleRefreshToken: res.tokens.refreshToken,
          googleIdExpiresAt: parseIdTokenExp(res.tokens.idToken),
          googleDriveExpiresAt: Date.now() + 3600 * 1000,
          googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
        });
      }
      const cloud = res.result?.schoolKey
        ? { workerUrl: DEFAULT_WORKER_URL, schoolKey: res.result.schoolKey }
        : null;
      const notEmpty = await finalizeAccountSwitch({ email: newEmail, cloud, seedIfEmpty: true });
      if (!notEmpty) onNavigate?.('ajustes');
      refreshLinkedAccounts();
      await emit("show-toast", { message: `✅ Ahora usando la cuenta ${newEmail}`, type: "success" });
    } catch (e) {
      await emit("show-toast", { message: "❌ Error al cambiar de cuenta: " + e, type: "error" });
    } finally {
      switchingAccount = false;
    }
  }

  // ── Admin panel ──
  let showAdminPanel = $state(false);
  let adminUsers: AdminUserInfo[] = $state([]);
  let adminLoading = $state(false);
  let adminActionBusy = $state(false);

  async function cargarUsuarios() {
    const token = await getValidAuthToken();
    if (!token) { await emit("show-toast", { message: "⚠️ Inicia sesión con Google para administrar usuarios", type: "warning" }); return; }
    adminLoading = true;
    try {
      const d1c = await invoke<any>("d1_get_config");
      const workerUrl = d1c?.workerUrl || undefined;
      adminUsers = await fetchAdminUsers(workerUrl);
    } catch (e) {
      await emit("show-toast", { message: "❌ Error cargando usuarios: " + e, type: "error" });
    } finally { adminLoading = false; }
  }

  async function toggleSuspend(u: AdminUserInfo) {
    const accion = u.suspendido ? "restaurar el acceso de" : "suspender a";
    const ok = await ask(`¿Seguro que deseas ${accion} "${u.nombre}" (${u.email})?${u.suspendido ? "" : "\n\nNo podrá sincronizar hasta que lo restaures. Sus datos NO se borran."}`, {
      title: u.suspendido ? "Restaurar usuario" : "Suspender usuario",
      kind: "warning", okLabel: u.suspendido ? "Restaurar" : "Suspender", cancelLabel: "Cancelar",
    });
    if (!ok) return;
    adminActionBusy = true;
    try {
      await suspendUser(u.email, !u.suspendido);
      u.suspendido = !u.suspendido;
      adminUsers = [...adminUsers];
      await emit("show-toast", { message: u.suspendido ? "🚫 Acceso suspendido" : "✅ Acceso restaurado", type: "success" });
    } catch (e) {
      await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
    } finally { adminActionBusy = false; }
  }

  async function purgarDatos(u: AdminUserInfo) {
    const ok = await ask(`⚠️ ¿ELIMINAR TODOS LOS DATOS en la nube de "${u.nombre}" (${u.email})?\n\nEsta acción es PERMANENTE e IRREVERSIBLE. Los datos locales de sus dispositivos NO se tocan, pero se borrarán al intentar sincronizar.`, {
      title: "Eliminar base de datos del usuario", kind: "warning", okLabel: "Eliminar todo", cancelLabel: "Cancelar",
    });
    if (!ok) return;
    adminActionBusy = true;
    try {
      const n = await deleteUserData(u.email);
      await emit("show-toast", { message: `🗑️ ${n} filas eliminadas de la nube para ${u.email}`, type: "success" });
    } catch (e) {
      await emit("show-toast", { message: "❌ Error: " + e, type: "error" });
    } finally { adminActionBusy = false; }
  }

  onMount(() => {
    refreshLinkedAccounts();
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
            Cuenta
          </span>
        </h3>
      </div>
      <div class="account-card-body" style="text-align: center;">
        <p style="color: #94a3b8; font-size: 0.88rem; margin: 0 0 1.1rem;">Inicia sesión con Google para sincronizar tus datos en la nube y administrar tu cuenta.</p>
        {#if loginLoading}
          <div style="display:flex;flex-direction:column;align-items:center;gap:0.6rem;">
            <button disabled class="btn-google-loading">Continuando...</button>
            {#if loginMsg}<p style="color:#94a3b8;font-size:0.78rem;margin:0;">{loginMsg}</p>{/if}
          </div>
        {:else}
          <button onclick={handleLogin} class="btn-google">
            🔵 Continuar con Google
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
            {#if perfil.rol === 'admin'}<span class="badge-admin">Admin</span>{/if}
          </div>
          <div style="color:#94a3b8;font-size:0.78rem;">{perfil.email}</div>
        </div>
        <button onclick={cerrarSesion} class="btn-logout">Cerrar sesión</button>
      </div>

      {#if dbPath}
        <div class="db-path-row">
          <span class="label-sm">BASE DE DATOS ACTIVA</span>
          <span class="db-path" title={dbPath}>{dbPath.split(/[/\\]/).pop()}</span>
        </div>
      {/if}

      {#if perfil.rol === 'admin'}
        <div style="padding: 0 1.5rem 1.1rem;">
          <button onclick={() => { showAdminPanel = !showAdminPanel; if (showAdminPanel && adminUsers.length === 0) cargarUsuarios(); }}
            class="btn-admin-toggle">
            🛡️ Panel de administración {showAdminPanel ? '▲' : '▼'}
          </button>
          {#if showAdminPanel}
            <div class="admin-panel">
              {#if adminLoading}
                <p style="color:#94a3b8;font-size:0.8rem;margin:0.4rem;">Cargando usuarios...</p>
              {:else if adminUsers.length === 0}
                <p style="color:#64748b;font-size:0.8rem;margin:0.4rem;">Sin usuarios registrados aún.</p>
              {:else}
                {#each adminUsers as u (u.email)}
                  <div class="admin-user-row">
                    {#if u.foto}
                      <img src={u.foto} alt="" referrerpolicy="no-referrer" class="admin-user-pic" />
                    {:else}
                      <div class="admin-user-pic admin-user-pic-fallback">👤</div>
                    {/if}
                    <div style="flex:1;min-width:0;">
                      <div style="color:#e2e8f0;font-size:0.8rem;font-weight:600;{u.suspendido ? 'text-decoration:line-through;opacity:0.6;' : ''}">{u.nombre}{u.rol === 'admin' ? ' · admin' : ''}</div>
                      <div style="color:#64748b;font-size:0.68rem;">{u.email} · alta {u.creado?.slice(0, 10)}</div>
                    </div>
                    {#if u.rol !== 'admin'}
                      <button onclick={() => toggleSuspend(u)} disabled={adminActionBusy}
                        class="btn-admin-action" style="border-color:{u.suspendido ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'};background:{u.suspendido ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)'};color:{u.suspendido ? '#4ade80' : '#fbbf24'};">
                        {u.suspendido ? 'Restaurar' : 'Suspender'}
                      </button>
                      <button onclick={() => purgarDatos(u)} disabled={adminActionBusy}
                        class="btn-admin-action" style="border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#fca5a5;">
                        🗑 Datos
                      </button>
                    {/if}
                  </div>
                {/each}
              {/if}
              <button onclick={cargarUsuarios} disabled={adminLoading} class="btn-admin-reload">
                {adminLoading ? 'Cargando...' : '🔄 Recargar lista'}
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
          Cuentas vinculadas
        </span>
      </h3>
    </div>
    <div class="account-card-body">
      {#if perfil && linkedAccounts.length > 0}
        <div style="margin-bottom: 0.8rem;">
          {#each linkedAccounts as acc (acc.email)}
            {@const isActive = acc.email.toLowerCase() === (perfil?.email || '').toLowerCase()}
            <button onclick={() => switchToStoredAccount(acc.email)} disabled={switchingAccount || isActive}
              class="account-item" class:active={isActive}>
              <span class="account-item-name">{acc.nombre || acc.email}</span>
              {#if !acc.googleRefreshToken}<span style="color:#fbbf24;font-size:0.62rem;">↻ requiere login</span>{/if}
              {#if isActive}<span style="color:#4ade80;font-size:0.7rem;">● activa</span>{/if}
            </button>
          {/each}
        </div>
      {:else if perfil}
        <p style="color:#64748b;font-size:0.8rem;margin:0 0 0.5rem;">Solo hay una cuenta vinculada.</p>
      {/if}

      {#if perfil}
        <button onclick={cambiarCuenta} disabled={switchingAccount || loginLoading} class="btn-switch">
          {switchingAccount ? 'Cambiando cuenta...' : '➕ Agregar otra cuenta de Google'}
        </button>
      {:else}
        <p style="color: #94a3b8; font-size: 0.85rem; margin: 0 0 1rem;">Inicia sesión para ver y cambiar entre tus cuentas vinculadas.</p>
      {/if}
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
