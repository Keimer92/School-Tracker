<script lang="ts">
  import { onMount } from "svelte";
import SelectChip from "./SelectChip.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { registerBackHandler } from "../lib/androidBack";
  import { t } from "../lib/i18n.svelte";

  /** Permite que el aviso de "sin estudiantes" mande al usuario a esa página. */
  let { onNavigate }: { onNavigate?: (tab: string) => void } = $props();

  interface DashboardStats {
    totalEstudiantes: number;
    totalNotas: number;
    totalAsistencias: number;
    totalGrados: number;
    totalColegios: number;
    totalSecciones: number;
    totalAsignaturas: number;
    anoActivo: string;
    colegioActivo: string;
    estudiantesHoy: number;
    presentesHoy: number;
    ausentesHoy: number;
    justificadosHoy: number;
    estudiantesPorGrado: { grado: string; count: number }[];
    estudiantesPorGradoSeccion: { grado: string; seccion: string; colegio: string; count: number }[];
  }

  interface Colegio {
    id: number;
    nombre: string;
  }

  let colegios = $state<Colegio[]>([]);
  let selectedColegio = $state<number | null>(null);

  let stats = $state<DashboardStats | null>(null);
  let loading = $state(true);
  let error = $state("");
  let isMobile = $state(false);

  let maxGradoSeccionCount = $derived(
    stats ? Math.max(...stats.estudiantesPorGradoSeccion.map(g => g.count), 1) : 1
  );

  interface DetalleItem { nombre: string; colegio: string | null; actualizado: string; }
  type DetalleTipo = 'colegio' | 'grado' | 'seccion' | 'asignatura';
  // En $state va SOLO el id: si guardáramos el título ya traducido, el modal
  // conservaría el idioma viejo al cambiar el idioma de la app.
  let detalle = $state<{ tipo: DetalleTipo; items: DetalleItem[] } | null>(null);
  const TITULOS_DETALLE = $derived<Record<DetalleTipo, string>>({
    colegio: t('dash.detalle.colegio'),
    grado: t('dash.detalle.grado'),
    seccion: t('dash.detalle.seccion'),
    asignatura: t('dash.detalle.asignatura'),
  });
  let detalleTitulo = $derived(detalle ? TITULOS_DETALLE[detalle.tipo] : '');

  $effect(() => {
    if (!detalle) return;
    return registerBackHandler(() => { detalle = null; return true; });
  });

  async function verDetalle(tipo: DetalleTipo) {
    try {
      const items = await invoke<DetalleItem[]>('get_dashboard_detalle', { tipo, colegioId: selectedColegio });
      detalle = { tipo, items };
    } catch (e) {
      console.error('Error cargando detalle:', e);
    }
  }

  async function loadColegios() {
    try {
      const data = await invoke<Colegio[]>("get_colegios");
      colegios = data || [];
    } catch (e) {
      console.error("Error loading colegios:", e);
    }
  }

  async function loadStats(silent = false) {
    try {
      if (!silent) {
        loading = true;
        error = "";
      }
      const today = new Date();
      const fecha = today.toISOString().split("T")[0];
      const data = await invoke<DashboardStats>("get_dashboard_stats", { 
        fechaHoy: fecha,
        colegioId: selectedColegio
      });
      stats = data;
    } catch (e) {
      error = String(e);
      console.error("Dashboard error:", e);
    } finally {
      if (!silent) {
        loading = false;
      }
    }
  }

  function goTo(tab: string) {
    if (onNavigate) onNavigate(tab);
  }

  function checkMobile() {
    isMobile = window.innerWidth <= 768;
  }

  onMount(() => {
    checkMobile();
    window.addEventListener("resize", checkMobile);
    
    const handleEvent = () => loadStats(true);
    window.addEventListener("schooltracker-sync", handleEvent);
    
    loadColegios().then(() => loadStats());

    const unsubs: (() => void)[] = [];
    
    Promise.all([
      listen("notas-updated", handleEvent),
      listen("asistencia-updated", handleEvent),
      listen("student-updated", handleEvent),
      listen("catalog-updated", handleEvent)
    ]).then((fns) => {
      unsubs.push(...fns);
    });

    return () => {
      window.removeEventListener("resize", checkMobile);
      window.removeEventListener("schooltracker-sync", handleEvent);
      unsubs.forEach((unsub) => unsub());
    };
  });
</script>

<div class="dashboard">
  {#if loading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <span>{t('dash.cargando')}</span>
    </div>
  {:else if error}
    <div class="error-container">
      <span class="error-icon">⚠️</span>
      <span>{t('dash.error', { e: error })}</span>
      <button class="retry-btn" onclick={() => loadStats()}>{t('dash.reintentar')}</button>
    </div>
  {:else if stats}
    <div class="dashboard-header">
      <div class="header-left">
        <h1 class="dashboard-title">{t('dash.titulo')}</h1>
        <p class="dashboard-subtitle">
          {t('dash.anoLectivo')} <strong>{stats.anoActivo || "—"}</strong>
          · {t('dash.colegioLabel')} <strong>{stats.colegioActivo || t('dash.todos')}</strong>
        </p>
      </div>
      <div class="header-right">
        <SelectChip
          clase="dashboard-select"
          value={selectedColegio}
          onchange={(v) => { selectedColegio = v === null ? null : Number(v); loadStats(); }}
          options={[
            { value: null, label: t('rep.subtitulo.todosColegios') },
            ...colegios.map(c => ({ value: c.id as string | number | null, label: c.nombre })),
          ]} />
      </div>
    </div>

    <!-- Aviso de base recién creada: sin estudiantes, los contadores de grados
         y secciones dan 0 (miden combinaciones en uso sobre la tabla
         `estudiante`, no el catálogo) y los desplegables de las demás páginas
         no tienen con qué llenarse. -->
    {#if stats.totalEstudiantes === 0}
      <div class="empty-hint">
        <div class="empty-hint-icon">👨‍🎓</div>
        <div class="empty-hint-body">
          <div class="empty-hint-title">{t('dash.vacio.titulo')}</div>
          <p class="empty-hint-text">
            {t('dash.vacio.a')}
            <strong>{t('dash.vacio.grados')}</strong> {t('dash.vacio.y')} <strong>{t('dash.vacio.secciones')}</strong>
            {t('dash.vacio.b')}
            <em>{t('dash.vacio.enUso')}</em>{t('dash.vacio.c')}
          </p>
          <button class="empty-hint-btn" onclick={() => onNavigate?.('estudiantes')}>
            {t('dash.vacio.ir')}
          </button>
        </div>
      </div>
    {/if}

    <!-- Summary cards -->
    <div class="cards-grid">
      <div class="summary-card" style="--card-accent: #8b5cf6">
        <div class="card-icon">👨‍🎓</div>
        <div class="card-content">
          <span class="card-value">{stats.totalEstudiantes}</span>
          <span class="card-label">{t('dash.card.estudiantes')}</span>
        </div>
      </div>
      <div class="summary-card" style="--card-accent: #3b82f6">
        <div class="card-icon">📓</div>
        <div class="card-content">
          <span class="card-value">{stats.totalNotas}</span>
          <span class="card-label">{t('dash.card.notas')}</span>
        </div>
      </div>
      <div class="summary-card" style="--card-accent: #10b981">
        <div class="card-icon">📅</div>
        <div class="card-content">
          <span class="card-value">{stats.totalAsistencias}</span>
          <span class="card-label">{t('dash.card.asistencias')}</span>
        </div>
      </div>
      <div class="summary-card clickable" style="--card-accent: #f59e0b" onclick={() => verDetalle('grado')} title={t('dash.ver.grados')}>
        <div class="card-icon">📚</div>
        <div class="card-content">
          <span class="card-value">{stats.totalGrados}</span>
          <span class="card-label">{t('dash.card.grados')}</span>
        </div>
      </div>
      <div class="summary-card clickable" style="--card-accent: #ec4899" onclick={() => verDetalle('seccion')} title={t('dash.ver.secciones')}>
        <div class="card-icon">🏷️</div>
        <div class="card-content">
          <span class="card-value">{stats.totalSecciones}</span>
          <span class="card-label">{t('dash.card.secciones')}</span>
        </div>
      </div>
      <div class="summary-card clickable" style="--card-accent: #ef4444" onclick={() => verDetalle('colegio')} title={t('dash.ver.colegios')}>
        <div class="card-icon">🏫</div>
        <div class="card-content">
          <span class="card-value">{stats.totalColegios}</span>
          <span class="card-label">{t('dash.card.colegios')}</span>
        </div>
      </div>
      <div class="summary-card clickable" style="--card-accent: #06b6d4" onclick={() => verDetalle('asignatura')} title={t('dash.ver.asignaturas')}>
        <div class="card-icon">📖</div>
        <div class="card-content">
          <span class="card-value">{stats.totalAsignaturas}</span>
          <span class="card-label">{t('dash.card.asignaturas')}</span>
        </div>
      </div>
    </div>

    <!-- Students per grade + section -->
    <div class="glass-card grade-card">
      <h2 class="card-title">{t('dash.porGradoSeccion')}</h2>
      {#if stats.estudiantesPorGradoSeccion.length > 0}
        <div class="grade-list">
          {#each stats.estudiantesPorGradoSeccion as gs}
            <div class="grade-row">
              <span class="grade-name">
                {gs.grado} <span class="grade-seccion">· {gs.seccion}</span>
                {#if !selectedColegio}<span class="grade-colegio"> · {gs.colegio}</span>{/if}
              </span>
              <div class="grade-bar-track">
                <div class="grade-bar-fill" style="width: {(gs.count / maxGradoSeccionCount) * 100}%"></div>
              </div>
              <span class="grade-count">{gs.count}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state-sm">
          <span>📭</span>
          <span>{t('dash.sinEstudiantes')}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if detalle}
  <div class="modal-overlay" onclick={() => (detalle = null)}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <h3 class="detalle-titulo">{detalleTitulo}</h3>
      <div class="detalle-list">
        {#if detalle.items.length === 0}
          <div class="empty-state-sm"><span>📭</span><span>{t('dash.sinRegistros')}</span></div>
        {:else}
          {#each detalle.items as it}
            <div class="detalle-row">
              <div style="min-width:0">
                <div class="det-nombre">{it.nombre}</div>
                {#if it.colegio}<div class="det-sub">{it.colegio}</div>{/if}
              </div>
              <span class="det-fecha" title={t('dash.ultimaModificacion')}>{it.actualizado || '—'}</span>
            </div>
          {/each}
        {/if}
      </div>
      <button class="detalle-cerrar" onclick={() => (detalle = null)}>{t('comun.cerrar')}</button>
    </div>
  </div>
{/if}

<style>
  .dashboard {
    padding: 1.5rem;
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .loading-container, .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    height: 50vh;
    color: #94a3b8;
    font-size: 0.9rem;
  }
  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(255,255,255,0.1);
    border-top-color: var(--primary-color, #8b5cf6);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error-icon { font-size: 2rem; }
  .retry-btn {
    padding: 0.4rem 1rem;
    background: rgba(139,92,246,0.15);
    border: 1px solid rgba(139,92,246,0.3);
    color: #8b5cf6;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    transition: all 0.15s;
  }
  .retry-btn:hover { background: rgba(139,92,246,0.25); }

  /* Aviso de base recién creada (sin estudiantes) */
  .empty-hint {
    display: flex; align-items: flex-start; gap: 0.9rem;
    padding: 1rem 1.15rem; margin-bottom: 1rem;
    background: linear-gradient(135deg, rgba(139,92,246,0.14), rgba(59,130,246,0.08));
    border: 1px solid rgba(167,139,250,0.32);
    border-left: 4px solid #a78bfa;
    border-radius: 14px;
    box-shadow: 0 4px 16px rgba(15,23,42,0.35), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .empty-hint-icon {
    width: 38px; height: 38px; flex-shrink: 0; border-radius: 11px;
    background: rgba(167,139,250,0.18); display: flex; align-items: center; justify-content: center;
    font-size: 1.15rem;
  }
  .empty-hint-body { min-width: 0; flex: 1; }
  .empty-hint-title { font-size: 0.92rem; font-weight: 700; color: #f1f5f9; margin-bottom: 0.25rem; }
  .empty-hint-text { font-size: 0.78rem; color: #94a3b8; line-height: 1.55; margin: 0 0 0.7rem; }
  .empty-hint-text strong { color: #c4b5fd; }
  .empty-hint-text em { color: #a78bfa; font-style: normal; font-weight: 600; }
  .empty-hint-btn {
    display: inline-flex; align-items: center; gap: 0.4rem;
    padding: 0.5rem 1rem; border: none; border-radius: 10px;
    background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff;
    font-size: 0.8rem; font-weight: 700; font-family: inherit; cursor: pointer;
    box-shadow: 0 4px 12px rgba(139,92,246,0.3);
    transition: transform 0.18s ease, box-shadow 0.18s ease;
  }
  .empty-hint-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(139,92,246,0.42); }
  .empty-hint-btn:active { transform: translateY(1px); }

  .dashboard-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
  .dashboard-title { font-size: 1.5rem; font-weight: 700; margin: 0; color: #f1f5f9; }
  .dashboard-subtitle { font-size: 0.8rem; color: #94a3b8; margin: 0.25rem 0 0 0; }
  .dashboard-select {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #f1f5f9;
    padding: 0.4rem 0.75rem;
    border-radius: 8px;
    font-size: 0.85rem;
    outline: none;
    transition: all 0.2s;
    cursor: pointer;
  }
  .dashboard-select:focus {
    border-color: var(--primary-color, #8b5cf6);
  }
  .dashboard-select option {
    background: #1e293b;
    color: #f1f5f9;
  }
  .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.75rem; }
  .summary-card {
    background: rgba(255,255,255,0.02);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px;
    padding: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    transition: all 0.2s ease;
    position: relative;
    overflow: hidden;
  }
  .summary-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--card-accent);
    border-radius: 0 2px 2px 0;
  }
  .summary-card:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
  .summary-card.clickable { cursor: pointer; }
  .summary-card.clickable:hover { transform: translateY(-2px); }
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal-content {
    width: 420px;
    max-width: 92vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: rgba(20,24,31,0.9);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);
    padding: 1.5rem;
    animation: modal-in 0.2s cubic-bezier(0.34,1.3,0.64,1);
  }
  @keyframes modal-in { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: none; } }
  .detalle-titulo {
    margin: 0 0 1rem;
    font-size: 1rem;
    font-weight: 700;
    color: #f1f5f9;
    background-image: linear-gradient(90deg, #f472b6, #22d3ee);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .detalle-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; }
  .detalle-row {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    padding: 0.55rem 0.7rem; border-radius: 12px;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  }
  .det-nombre { font-size: 0.85rem; font-weight: 600; color: #f1f5f9; }
  .det-sub { font-size: 0.68rem; color: #94a3b8; margin-top: 1px; }
  .det-fecha { font-size: 0.65rem; color: #64748b; white-space: nowrap; flex-shrink: 0; }
  .detalle-cerrar {
    margin-top: 1rem; padding: 0.55rem 1rem; border-radius: 10px; border: none;
    background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 700; cursor: pointer;
    transition: all 0.15s ease;
  }
  .detalle-cerrar:hover { filter: brightness(1.15); }
  .card-icon { font-size: 1.5rem; flex-shrink: 0; }
  .card-content { display: flex; flex-direction: column; gap: 0.1rem; }
  .card-value { font-size: 1.4rem; font-weight: 700; color: #f1f5f9; line-height: 1; }
  .card-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .middle-row { display: none; }
  .card-title { font-size: 0.85rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 1rem 0; }
  .empty-state-sm { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 1.5rem 0; font-size: 0.85rem; color: #64748b; }
  .glass-card {
    background: rgba(255,255,255,0.02);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 18px;
    padding: 1.25rem;
  }
  .grade-card {}
  .grade-list { display: flex; flex-direction: column; gap: 0.65rem; }
  .grade-row { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
  .grade-name { font-size: 0.8rem; color: #cbd5e1; width: auto; min-width: 0; max-width: 50%; flex: 0 1 auto; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grade-seccion { color: #8b5cf6; font-weight: 700; }
  .grade-colegio { color: #64748b; font-weight: 500; font-size: 0.72rem; }
  .grade-bar-track { flex: 1 1 auto; min-width: 0; height: 20px; background: rgba(255,255,255,0.05); border-radius: 10px; overflow: hidden; }
  .grade-bar-fill { height: 100%; background: linear-gradient(90deg, var(--primary-color, #8b5cf6), #a78bfa); border-radius: 10px; transition: width 0.5s ease; min-width: 4px; }
  .grade-count { font-size: 0.8rem; color: #94a3b8; width: 30px; flex: 0 0 auto; text-align: right; font-weight: 700; }
  @media (max-width: 768px) {
    .dashboard { padding: 0.75rem 0.5rem; gap: 0.85rem; }
    .cards-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 0.5rem; }
    .glass-card { padding: 0.9rem 0.7rem; }
    .grade-card { padding: 0.75rem; }
    .grade-list { gap: 0.5rem; }
    .grade-row {
      flex-direction: column;
      align-items: stretch;
      gap: 0.25rem;
      width: 100%;
    }
    .grade-name {
      max-width: 100%;
      min-width: 0;
      width: 100%;
      flex: 0 0 auto;
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
    }
    .grade-bar-track { width: 100%; flex: 0 0 auto; }
    .grade-count { width: 100%; flex: 0 0 auto; text-align: right; }
  }
</style>
