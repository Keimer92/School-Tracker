<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { registerBackHandler } from "../lib/androidBack";

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
  }

  let { onNavigate }: { onNavigate?: (tab: string) => void } = $props();

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

  let pctP = $derived(stats && stats.estudiantesHoy > 0 ? Math.round((stats.presentesHoy / stats.estudiantesHoy) * 100) : 0);
  let pctA = $derived(stats && stats.estudiantesHoy > 0 ? Math.round((stats.ausentesHoy / stats.estudiantesHoy) * 100) : 0);
  let pctJ = $derived(stats && stats.estudiantesHoy > 0 ? Math.round((stats.justificadosHoy / stats.estudiantesHoy) * 100) : 0);

  let maxGradoCount = $derived(stats ? Math.max(...stats.estudiantesPorGrado.map(g => g.count), 1) : 1);

  interface DetalleItem { nombre: string; colegio: string | null; actualizado: string; }
  let detalle = $state<{ titulo: string; items: DetalleItem[] } | null>(null);

  $effect(() => {
    if (!detalle) return;
    return registerBackHandler(() => { detalle = null; return true; });
  });

  async function verDetalle(tipo: 'colegio' | 'grado' | 'seccion') {
    try {
      const items = await invoke<DetalleItem[]>('get_dashboard_detalle', { tipo, colegioId: selectedColegio });
      const titulos = { colegio: '🏫 Colegios', grado: '📚 Grados', seccion: '🏷️ Secciones' } as const;
      detalle = { titulo: titulos[tipo], items };
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
      <span>Cargando dashboard...</span>
    </div>
  {:else if error}
    <div class="error-container">
      <span class="error-icon">⚠️</span>
      <span>Error al cargar: {error}</span>
      <button class="retry-btn" onclick={() => loadStats()}>Reintentar</button>
    </div>
  {:else if stats}
    <div class="dashboard-header">
      <div class="header-left">
        <h1 class="dashboard-title">Dashboard</h1>
        <p class="dashboard-subtitle">
          Año lectivo: <strong>{stats.anoActivo || "—"}</strong>
          · Colegio: <strong>{stats.colegioActivo || "Todos"}</strong>
        </p>
      </div>
      <div class="header-right">
        <select class="dashboard-select" bind:value={selectedColegio} onchange={() => loadStats()}>
          <option value={null}>Todos los colegios</option>
          {#each colegios as c}
            <option value={c.id}>{c.nombre}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- Summary cards -->
    <div class="cards-grid">
      <div class="summary-card" style="--card-accent: #8b5cf6">
        <div class="card-icon">👨‍🎓</div>
        <div class="card-content">
          <span class="card-value">{stats.totalEstudiantes}</span>
          <span class="card-label">Estudiantes</span>
        </div>
      </div>
      <div class="summary-card" style="--card-accent: #3b82f6">
        <div class="card-icon">📓</div>
        <div class="card-content">
          <span class="card-value">{stats.totalNotas}</span>
          <span class="card-label">Notas</span>
        </div>
      </div>
      <div class="summary-card" style="--card-accent: #10b981">
        <div class="card-icon">📅</div>
        <div class="card-content">
          <span class="card-value">{stats.totalAsistencias}</span>
          <span class="card-label">Asistencias</span>
        </div>
      </div>
      <div class="summary-card clickable" style="--card-accent: #f59e0b" onclick={() => verDetalle('grado')} title="Ver grados">
        <div class="card-icon">📚</div>
        <div class="card-content">
          <span class="card-value">{stats.totalGrados}</span>
          <span class="card-label">Grados</span>
        </div>
      </div>
      <div class="summary-card clickable" style="--card-accent: #ec4899" onclick={() => verDetalle('seccion')} title="Ver secciones">
        <div class="card-icon">🏷️</div>
        <div class="card-content">
          <span class="card-value">{stats.totalSecciones}</span>
          <span class="card-label">Secciones</span>
        </div>
      </div>
      <div class="summary-card clickable" style="--card-accent: #ef4444" onclick={() => verDetalle('colegio')} title="Ver colegios">
        <div class="card-icon">🏫</div>
        <div class="card-content">
          <span class="card-value">{stats.totalColegios}</span>
          <span class="card-label">Colegios</span>
        </div>
      </div>
      <div class="summary-card" style="--card-accent: #06b6d4">
        <div class="card-icon">📖</div>
        <div class="card-content">
          <span class="card-value">{stats.totalAsignaturas}</span>
          <span class="card-label">Asignaturas</span>
        </div>
      </div>
    </div>

    <!-- Middle row: attendance + quick actions -->
    <div class="middle-row">
      <!-- Today's attendance -->
      <div class="glass-card attendance-card">
        <h2 class="card-title">Asistencia Hoy</h2>
        {#if stats.estudiantesHoy > 0}
          <div class="attendance-bar-container">
            <div class="attendance-bar">
              {#if stats.presentesHoy > 0}
                <div class="bar-segment bar-p" style="flex: {stats.presentesHoy}"><span>P</span></div>
              {/if}
              {#if stats.ausentesHoy > 0}
                <div class="bar-segment bar-a" style="flex: {stats.ausentesHoy}"><span>A</span></div>
              {/if}
              {#if stats.justificadosHoy > 0}
                <div class="bar-segment bar-j" style="flex: {stats.justificadosHoy}"><span>J</span></div>
              {/if}
            </div>
          </div>
          <div class="attendance-legend">
            <div class="legend-item"><span class="dot dot-p"></span> Presente: {stats.presentesHoy} ({pctP}%)</div>
            <div class="legend-item"><span class="dot dot-a"></span> Ausente: {stats.ausentesHoy} ({pctA}%)</div>
            <div class="legend-item"><span class="dot dot-j"></span> Justificado: {stats.justificadosHoy} ({pctJ}%)</div>
          </div>
          <p class="attendance-total">Total: {stats.estudiantesHoy} registros hoy</p>
        {:else}
          <div class="empty-state-sm">
            <span>📭</span>
            <span>No hay asistencias registradas hoy</span>
            <button class="action-link" onclick={() => goTo("asistencia")}>Ir a Asistencia</button>
          </div>
        {/if}
      </div>

      <!-- Quick actions -->
      <div class="glass-card quick-actions-card">
        <h2 class="card-title">Acceso Rápido</h2>
        <div class="quick-actions-grid">
          <button class="quick-action-btn" onclick={() => goTo("asistencia")}>
            <span class="qa-icon">📅</span>
            <span class="qa-label">Asistencia</span>
          </button>
          <button class="quick-action-btn" onclick={() => goTo("notas")}>
            <span class="qa-icon">📓</span>
            <span class="qa-label">Notas</span>
          </button>
          <button class="quick-action-btn" onclick={() => goTo("informe")}>
            <span class="qa-icon">📊</span>
            <span class="qa-label">Informe</span>
          </button>
          <button class="quick-action-btn" onclick={() => goTo("estudiantes")}>
            <span class="qa-icon">👨‍🎓</span>
            <span class="qa-label">Estudiantes</span>
          </button>
          <button class="quick-action-btn" onclick={() => goTo("reportes")}>
            <span class="qa-icon">📋</span>
            <span class="qa-label">Reportes</span>
          </button>
          <button class="quick-action-btn" onclick={() => goTo("cloud")}>
            <span class="qa-icon">☁️</span>
            <span class="qa-label">Nube</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Students per grade -->
    <div class="glass-card grade-card">
      <h2 class="card-title">Estudiantes por Grado</h2>
      {#if stats.estudiantesPorGrado.length > 0}
        <div class="grade-list">
          {#each stats.estudiantesPorGrado as g}
            <div class="grade-row">
              <span class="grade-name">{g.grado}</span>
              <div class="grade-bar-track">
                <div class="grade-bar-fill" style="width: {(g.count / maxGradoCount) * 100}%"></div>
              </div>
              <span class="grade-count">{g.count}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state-sm">
          <span>📭</span>
          <span>No hay estudiantes registrados</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if detalle}
  <div class="modal-overlay" onclick={() => (detalle = null)}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <h3 class="detalle-titulo">{detalle.titulo}</h3>
      <div class="detalle-list">
        {#if detalle.items.length === 0}
          <div class="empty-state-sm"><span>📭</span><span>Sin registros</span></div>
        {:else}
          {#each detalle.items as it}
            <div class="detalle-row">
              <div style="min-width:0">
                <div class="det-nombre">{it.nombre}</div>
                {#if it.colegio}<div class="det-sub">{it.colegio}</div>{/if}
              </div>
              <span class="det-fecha" title="Última modificación">{it.actualizado || '—'}</span>
            </div>
          {/each}
        {/if}
      </div>
      <button class="detalle-cerrar" onclick={() => (detalle = null)}>Cerrar</button>
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
  .middle-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  @media (max-width: 768px) { .middle-row { grid-template-columns: 1fr; } }
  .glass-card {
    background: rgba(255,255,255,0.02);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 18px;
    padding: 1.25rem;
  }
  .card-title { font-size: 0.85rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 1rem 0; }
  .attendance-bar-container { margin-bottom: 0.75rem; }
  .attendance-bar { display: flex; height: 32px; border-radius: 8px; overflow: hidden; }
  .bar-segment { display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; color: #fff; transition: flex 0.3s ease; min-width: 0; }
  .bar-segment span { text-shadow: 0 1px 2px rgba(0,0,0,0.3); }
  .bar-p { background: linear-gradient(135deg, #10b981, #059669); }
  .bar-a { background: linear-gradient(135deg, #ef4444, #dc2626); }
  .bar-j { background: linear-gradient(135deg, #f59e0b, #d97706); }
  .attendance-legend { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.5rem; }
  .legend-item { display: flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; color: #cbd5e1; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot-p { background: #10b981; }
  .dot-a { background: #ef4444; }
  .dot-j { background: #f59e0b; }
  .attendance-total { font-size: 0.7rem; color: #64748b; margin: 0; }
  .empty-state-sm { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 1.5rem 0; font-size: 0.85rem; color: #64748b; }
  .action-link { background: none; border: none; color: var(--primary-color, #8b5cf6); cursor: pointer; font-size: 0.8rem; font-weight: 600; padding: 0; text-decoration: underline; }
  .quick-actions-card { display: flex; flex-direction: column; }
  .quick-actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; flex: 1; }
  .quick-action-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.8rem 0.5rem;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #cbd5e1;
  }
  .quick-action-btn:hover { background: rgba(255,255,255,0.06); border-color: var(--primary-color, #8b5cf6); transform: translateY(-1px); }
  .qa-icon { font-size: 1.3rem; }
  .qa-label { font-size: 0.75rem; font-weight: 600; }
  .grade-card {}
  .grade-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .grade-row { display: flex; align-items: center; gap: 0.75rem; }
  .grade-name { font-size: 0.8rem; color: #cbd5e1; width: auto; min-width: 80px; max-width: 45%; flex-shrink: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grade-bar-track { flex: 1; height: 20px; background: rgba(255,255,255,0.05); border-radius: 10px; overflow: hidden; }
  .grade-bar-fill { height: 100%; background: linear-gradient(90deg, var(--primary-color, #8b5cf6), #a78bfa); border-radius: 10px; transition: width 0.5s ease; min-width: 4px; }
  .grade-count { font-size: 0.8rem; color: #94a3b8; width: 30px; text-align: right; font-weight: 700; }
</style>
