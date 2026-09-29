<!--
  SelectChip — filtro desplegable con forma de chip.

  Reemplaza al `<select>` nativo de las barras de filtro: muestra el valor
  actual como chip y, al pulsarlo, abre la lista para cambiarlo. Es el mismo
  lenguaje visual de los popovers de la grilla de Notas, pero reutilizable.

  El panel se monta en `<body>` con `portalToBody` y se posiciona con
  `position: fixed` + coordenadas de viewport. Sin el portal, los contenedores de
  la app usan `backdrop-filter` y `transform`, y eso los convierte en bloque
  contenedor de sus descendientes `fixed` además de abrir un stacking context: el
  panel salía descentrado y por debajo de los paneles hermanos.

  Cierra al pulsar fuera (en `pointerdown`, para no tragarse el clic siguiente),
  con Escape, al redimensionar y con el botón atrás de Android.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { registerBackHandler } from "../lib/androidBack";
  import { portalToBody } from "../lib/portalToBody";

  export interface ChipOpcion {
    value: string | number | null;
    label: string;
    sub?: string;
    /** Encabezado de grupo; los ítems con el mismo valor se agrupan juntos. */
    grupo?: string;
  }

  let {
    value,
    options,
    onchange,
    label = '',
    placeholder = '—',
    ancho = 0,
    titulo = '',
    disabled = false,
    clase = '',
  }: {
    value: string | number | null;
    options: ChipOpcion[];
    onchange: (v: string | number | null) => void;
    label?: string;
    placeholder?: string;
    /** Ancho mínimo del panel; si es 0 se usa el ancho del chip. */
    ancho?: number;
    titulo?: string;
    disabled?: boolean;
    /** Clase extra para variantes de estilo (ej. `dashboard-select`). */
    clase?: string;
  } = $props();

  const isAndroid = /Android/i.test(navigator.userAgent);

  /** Alto estimado de un ítem, usado para decidir si abre hacia arriba. */
  const ALTO_ITEM = 34;
  const SEPARACION = 4;
  /** Ancho mínimo del panel: cabe un nombre de colegio largo sin cortar. */
  const ANCHO_MIN = 300;

  let abierto = $state(false);
  let triggerEl = $state<HTMLElement | null>(null);
  let panelEl = $state<HTMLElement | null>(null);
  let pos = $state({ x: 0, y: 0, arriba: false });
  let maxiAlto = $state(320);
  let anchoPanelActivo = $state(ANCHO_MIN);

  const textoActual = $derived(
    options.find(o => String(o.value) === String(value))?.label ?? placeholder
  );

  function abrir() {
    if (disabled) return;
    const r = triggerEl?.getBoundingClientRect();
    if (!r) return;
    const items = options.length || 1;
    const alto = Math.min(items * ALTO_ITEM, 320) + 10;
    // Si no cabe abajo, abre hacia arriba; si tampoco, se recorta al alto útil.
    const abreArriba = r.bottom + alto > window.innerHeight && r.top > alto;
    const disponible = abreArriba ? r.top - SEPARACION : window.innerHeight - r.bottom - SEPARACION;
    maxiAlto = Math.max(140, Math.min(alto, disponible));
    // El panel nunca es más angosto que ANCHO_MIN: los chips de la barra de
    // filtros son angostos por la grilla y con el ancho del chip los nombres
    // largos (colegios) quedaban con ellipsis. Crece a lo que haga falta y se
    // recorta al viewport.
    const anchoPanel = Math.min(
      Math.max(ancho || 0, r.width, ANCHO_MIN),
      window.innerWidth - 16
    );
    pos = {
      x: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - anchoPanel - 8)),
      y: Math.round(abreArriba ? r.top - maxiAlto - SEPARACION : r.bottom + SEPARACION),
      arriba: abreArriba,
    };
    anchoPanelActivo = Math.round(anchoPanel);
    abierto = true;
  }

  function alternar() { abierto ? cerrar() : abrir(); }

  function cerrar() { abierto = false; }

  function elegir(v: string | number | null) {
    cerrar();
    onchange(v);
  }

  onMount(() => {
    const onPointerDown = (ev: PointerEvent) => {
      if (!abierto) return;
      const t = ev.target as Node | null;
      if (t && (panelEl?.contains(t) || triggerEl?.contains(t))) return;
      cerrar();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cerrar(); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', cerrar);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', cerrar);
    };
  });

  $effect(() => {
    if (!abierto || !isAndroid) return;
    return registerBackHandler(() => { cerrar(); return true; });
  });
</script>

<div style="position:relative; width:100%; min-width:0;">
  <button
    bind:this={triggerEl}
    type="button"
    class="filter-select {clase}"
    class:chip-abierto={abierto}
    onclick={alternar}
    {disabled}
    title={titulo || textoActual || label}
    aria-label={label || undefined}
    aria-haspopup="listbox"
    aria-expanded={abierto}
    style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:0.4rem; text-align:left; cursor:{disabled ? 'not-allowed' : 'pointer'}; appearance:none; -webkit-appearance:none; line-height:1.2; font-family:inherit; box-sizing:border-box; opacity:{disabled ? 0.5 : 1};"
  >
    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{textoActual}</span>
    <span style="flex-shrink:0; color:#64748b; font-size:0.7rem;">▾</span>
  </button>
</div>

{#if abierto}
  <div
    bind:this={panelEl}
    use:portalToBody
    role="listbox"
    style="position:fixed; z-index:99990; left:{pos.x}px; top:{pos.y}px; width:{anchoPanelActivo}px; max-height:{maxiAlto}px; overflow-y:auto; padding:0.5rem; box-sizing:border-box; border-radius:16px; background:rgba(13,20,36,0.975); backdrop-filter:blur(24px) saturate(1.3); -webkit-backdrop-filter:blur(24px) saturate(1.3); border:1px solid rgba(255,255,255,0.16); box-shadow:0 24px 60px -12px rgba(0,0,0,0.7); outline:none; animation:pop-in .18s cubic-bezier(.34,1.3,.64,1);"
>
    {#each options as o, i (o.value)}
      {@const nuevoGrupo = i === 0 || o.grupo !== options[i - 1].grupo}
      {@const activo = String(o.value) === String(value)}
      {#if nuevoGrupo && o.grupo}
        <div style="padding:0.4rem 0.55rem 0.2rem; font-size:0.6rem; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; color:#64748b;">{o.grupo}</div>
      {/if}
      <button
        role="option"
        aria-selected={activo}
        onclick={() => elegir(o.value)}
        style="width:100%; display:flex; align-items:flex-start; justify-content:space-between; gap:0.5rem; padding:0.45rem 0.55rem; border-radius:8px; border:1px solid {activo ? 'rgba(129,140,248,0.35)' : 'transparent'}; background:{activo ? 'rgba(99,102,241,0.16)' : 'transparent'}; color:{activo ? '#e0e7ff' : '#cbd5e1'}; font-size:0.78rem; font-weight:{activo ? 700 : 500}; cursor:pointer; text-align:left; transition:all 0.15s ease;"
        onmouseenter={(e) => { if (!activo) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onmouseleave={(e) => { if (!activo) e.currentTarget.style.background = 'transparent'; }}
      >
        <span style="flex:1; min-width:0; line-height:1.35; overflow-wrap:anywhere;">{o.label}</span>
        {#if o.sub}<span style="font-size:0.62rem; color:#64748b; flex-shrink:0; padding-top:0.1rem;">{o.sub}</span>{/if}
        {#if activo}<span style="color:#a5b4fc; flex-shrink:0; padding-top:0.05rem;">✓</span>{/if}
      </button>
    {/each}
    {#if options.length === 0}
      <div style="padding:0.6rem; text-align:center; color:#64748b; font-size:0.75rem;">Sin opciones</div>
    {/if}
  </div>
{/if}

<style>
  .filter-select { cursor:pointer; }
  .filter-select.chip-abierto { border-color: rgba(255,255,255,0.16); }
  @keyframes pop-in { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
</style>
