<script lang="ts">
  import { tick } from 'svelte';
  import { registerBackHandler } from '../lib/androidBack';

  /**
   * Calendario glassmorphism rosa/cian — reemplaza al <input type="date"> nativo.
   * Uso: <DatePickerGlass bind:value={fecha} invalid={bool} disabled={bool} />
   * value en formato 'YYYY-MM-DD'. Popup con blur, acentos rosa/cian,
   * semana iniciando en lunes, botón Hoy, cierre por fuera/Escape/Back(Android).
   */

  let {
    value = $bindable(''),
    disabled = false,
    invalid = false,
    zIndex = 1200,
  }: { value?: string; disabled?: boolean; invalid?: boolean; zIndex?: number } = $props();

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const ACCENTO1 = '#f472b6';
  const ACCENTO2 = '#22d3ee';

  let abierto = $state(false);
  let abrirAbajo = $state(true);
  let alinearDerecha = $state(false);
  let verAno = $state(new Date().getFullYear());
  let verMes = $state(new Date().getMonth()); // 0-based
  let rootEl: HTMLElement | null = $state(null);
  let panelEl: HTMLElement | null = $state(null);

  const pad = (n: number) => String(n).padStart(2, '0');
  const hoyIso = () => {
    const h = new Date();
    return `${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(h.getDate())}`;
  };

  function abrir() {
    if (disabled) return;
    const base = value || hoyIso();
    verAno = parseInt(base.slice(0, 4), 10);
    verMes = parseInt(base.slice(5, 7), 10) - 1;
    // Voltear hacia arriba si no hay espacio suficiente debajo,
    // y anclar a la derecha si el panel desbordaría el viewport.
    try {
      const r = rootEl!.getBoundingClientRect();
      const espacioAbajo = window.innerHeight - r.bottom;
      abrirAbajo = espacioAbajo >= 340 || espacioAbajo > r.top;
      const anchoPanel = Math.min(300, window.innerWidth - 24);
      alinearDerecha = r.left + anchoPanel > window.innerWidth - 8;
    } catch { abrirAbajo = true; }
    abierto = true;
    tick().then(() => panelEl?.focus());
  }

  function cerrar() {
    abierto = false;
  }

  function seleccionar(iso: string) {
    value = iso;
    cerrar();
  }

  function irHoy() {
    value = hoyIso();
    verAno = parseInt(value.slice(0, 4), 10);
    verMes = parseInt(value.slice(5, 7), 10) - 1;
    cerrar();
  }

  function mesDelta(d: number) {
    let m = verMes + d;
    let a = verAno;
    if (m < 0) { m = 11; a--; }
    if (m > 11) { m = 0; a++; }
    verAno = a; verMes = m;
  }
  function anoDelta(d: number) { verAno += d; }

  // Cuadrícula del mes (semana inicia lunes). leading/trailing = celdas vacías.
  let celdas = $derived.by(() => {
    const primero = new Date(verAno, verMes, 1);
    const startDow = (primero.getDay() + 6) % 7;
    const diasEnMes = new Date(verAno, verMes + 1, 0).getDate();
    const out: { iso: string; dia: number }[] = [];
    for (let i = 0; i < startDow; i++) out.push({ iso: '', dia: 0 });
    for (let d = 1; d <= diasEnMes; d++) {
      out.push({ iso: `${verAno}-${pad(verMes + 1)}-${pad(d)}`, dia: d });
    }
    while (out.length % 7 !== 0) out.push({ iso: '', dia: 0 });
    return out;
  });

  let hoyStr = $derived(hoyIso());
  let displayTxt = $derived.by(() => {
    if (!value || value.length < 10) return '--/--/----';
    return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  });

  // Cierre por clic/touch fuera del componente
  $effect(() => {
    if (!abierto) return;
    const fuera = (e: Event) => {
      if (rootEl && !rootEl.contains(e.target as Node)) cerrar();
    };
    document.addEventListener('pointerdown', fuera, true);
    return () => document.removeEventListener('pointerdown', fuera, true);
  });

  // Android Back: cerrar el calendario primero
  $effect(() => {
    if (!abierto) return;
    return registerBackHandler(() => { cerrar(); return true; });
  });

  function onPanelKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
  }
</script>

<div class="dg-root" bind:this={rootEl}>
  <button
    type="button"
    class="dg-trigger"
    class:invalid
    disabled={disabled}
    onclick={() => (abierto ? cerrar() : abrir())}
    title={displayTxt}
  >
    <span class="dg-txt">{displayTxt}</span>
    <svg class="dg-cal-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none"/>
    </svg>
    <span class="dg-caret">▾</span>
  </button>

  {#if abierto}
    <div
      class="dg-panel"
      class:arriba={!abrirAbajo}
      class:der={alinearDerecha}
      style="z-index:{zIndex}"
      bind:this={panelEl}
      tabindex="-1"
      onkeydown={onPanelKeydown}
    >
      <div class="dg-nav">
        <button class="dg-nav-btn" onclick={() => anoDelta(-1)} title="Año anterior">«</button>
        <button class="dg-nav-btn" onclick={() => mesDelta(-1)} title="Mes anterior">‹</button>
        <span class="dg-mes">{MESES[verMes]} {verAno}</span>
        <button class="dg-nav-btn" onclick={() => mesDelta(1)} title="Mes siguiente">›</button>
        <button class="dg-nav-btn" onclick={() => anoDelta(1)} title="Año siguiente">»</button>
      </div>

      <div class="dg-dias-head">
        {#each DIAS as d}<span class="dg-dow">{d}</span>{/each}
      </div>

      <div class="dg-grid">
        {#each celdas as c}
          {@const esHoy = c.iso === hoyStr}
          {@const esSel = c.iso !== '' && c.iso === value}
          {#if c.iso === ''}
            <span class="dg-vacio"></span>
          {:else}
            <button
              type="button"
              class="dg-dia"
              class:hoy={esHoy}
              class:sel={esSel}
              onclick={() => seleccionar(c.iso)}
            >{c.dia}</button>
          {/if}
        {/each}
      </div>

      <div class="dg-foot">
        <button class="dg-hoy" onclick={irHoy}>● Hoy</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .dg-root { position: relative; width: 100%; }

  .dg-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .dg-trigger:hover:not(:disabled),
  .dg-trigger:focus-visible {
    border-color: rgba(34, 211, 238, 0.55);
    box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12);
  }
  .dg-trigger.invalid { border-color: #ef4444; }
  .dg-trigger.invalid .dg-txt,
  .dg-trigger.invalid .dg-cal-ico { color: #ef4444; }
  .dg-trigger:disabled { opacity: 0.5; cursor: not-allowed; }

  .dg-txt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
  .dg-cal-ico { color: #67e8f9; flex-shrink: 0; }
  .dg-caret { color: #64748b; font-size: 0.7rem; flex-shrink: 0; }

  .dg-panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: min(300px, calc(100vw - 24px));
    box-sizing: border-box;
    padding: 0.75rem;
    border-radius: 18px;
    background: rgba(13, 20, 36, 0.975);
    backdrop-filter: blur(24px) saturate(1.3);
    -webkit-backdrop-filter: blur(24px) saturate(1.3);
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    outline: none;
    animation: dg-in 0.18s cubic-bezier(0.34, 1.3, 0.64, 1);
  }
  .dg-panel.arriba { top: auto; bottom: calc(100% + 6px); animation-name: dg-in-up; }
  .dg-panel.der { left: auto; right: 0; }
  @keyframes dg-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
  @keyframes dg-in-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  .dg-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .dg-mes {
    font-weight: 700;
    font-size: 0.82rem;
    color: #f1f5f9;
    background: linear-gradient(90deg, var(--accent-pink, #f472b6), var(--accent-cyan, #22d3ee));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .dg-nav-btn {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: #cbd5e1;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dg-nav-btn:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }

  .dg-dias-head {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
    width: 100%;
    margin-bottom: 2px;
  }
  .dg-dow {
    text-align: center;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #64748b;
    padding: 2px 0;
  }

  .dg-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
    width: 100%;
  }
  .dg-vacio { visibility: hidden; }

  .dg-dia {
    width: 100%;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    aspect-ratio: 1 / 0.92;
    border-radius: 9px;
    border: none;
    background: transparent;
    color: #cbd5e1;
    font-size: 0.74rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease, box-shadow 0.14s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .dg-dia:hover {
    background: rgba(244, 114, 182, 0.16);
    color: #fff;
    box-shadow:
      0 0 10px rgba(244, 114, 182, 0.5),
      0 0 22px rgba(34, 211, 238, 0.35);
  }

  .dg-dia.hoy {
    box-shadow: inset 0 0 0 1.5px var(--accent-cyan-solid, #22d3ee);
    color: var(--accent-cyan-solid, #22d3ee);
  }
  .dg-dia.hoy:hover {
    color: #fff;
  }

  .dg-dia.sel {
    background: linear-gradient(135deg, #ec4899, #06b6d4);
    color: #fff;
    font-weight: 800;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 2px 10px rgba(236, 72, 153, 0.4);
  }
  .dg-dia.sel.hoy { box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55), 0 2px 10px rgba(236, 72, 153, 0.4); }

  .dg-foot {
    display: flex;
    justify-content: center;
    margin-top: 0.55rem;
    padding-top: 0.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }
  .dg-hoy {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    background-image: linear-gradient(90deg, var(--accent-pink, #f472b6), var(--accent-cyan, #22d3ee));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    transition: filter 0.15s ease;
  }
  .dg-hoy:hover { filter: brightness(1.35); }
</style>
