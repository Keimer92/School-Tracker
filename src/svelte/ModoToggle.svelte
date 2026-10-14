<!--
  ModoToggle — control segmentado de dos opciones para alternar el modo de una
  página con sub-tabs (Asistencia: Tomar ↔ Informe · Notas: Registrar ↔ Reportes).

  Vive DENTRO de la barra de filtros (envuelto en un FilterGroup), no como una
  barra propia arriba del contenido: antes cada wrapper dibujaba una caja glass
  aparte y, al apilarse con el SearchFab y con el FilterContainer, quedaban tres
  barras seguidas y la página se veía pesada. Como es un filtro más se alinea
  con el resto de la fila (mismo alto que `.filter-select`) y no gana altura.

  Solo escritorio: en Android el modo lo lleva la píldora flotante del wrapper,
  que no consume altura vertical (que en un teléfono es lo más escaso) y deja el
  gesto de swipe.

  Sin iconos a propósito: la fila de filtros es texto puro, y empatar con eso
  es lo que hace que el control pase desapercibido en lugar de gritar.
-->
<script lang="ts">
  export interface ModoOpcion {
    id: string;
    etiqueta: string;
    /** Tooltip y aria-label; por defecto la propia etiqueta. */
    titulo?: string;
  }

  let {
    valor,
    opciones,
    onchange,
    etiquetaGrupo = '',
    grande = false,
  }: {
    valor: string;
    opciones: ModoOpcion[];
    onchange: (id: string) => void;
    etiquetaGrupo?: string;
    /** Letra más grande y control más alto, para cuando va en su propia fila
     *  en móvil (lejos de la barra de filtros densa del escritorio).
     *  Los `@media` de abajo ACHICAN el control para emparejarlo con
     *  `.filter-select`, así que esta variante usa `.mt.mt-grande` para ganarle
     *  en especificidad y no quedar de nuevo chica en un teléfono angosto. */
    grande?: boolean;
  } = $props();

  // `elegir` en vez de `t`: `t` es la funcion de i18n (GOTCHA de AGENTS.md).
  function elegir(o: ModoOpcion) {
    if (o.id === valor) return;
    onchange(o.id);
  }
</script>

<div class="mt" class:mt-grande={grande} role="tablist" aria-label={etiquetaGrupo || undefined}>
  {#each opciones as o (o.id)}
    {@const act = o.id === valor}
    <button
      type="button"
      role="tab"
      aria-selected={act}
      class="mt-opt"
      class:act
      title={o.titulo || o.etiqueta}
      onclick={() => elegir(o)}
    >{o.etiqueta}</button>
  {/each}
</div>

<style>
  .mt {
    display: inline-flex;
    width: auto;
    box-sizing: border-box;
    gap: 2px;
    padding: 2px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    height: 28px;
    transition: background 0.2s ease, border-color 0.2s ease;
  }
  .mt:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  .mt-opt {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #94a3b8;
    font-family: inherit;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    padding: 0 0.55rem;
    transition: all 0.18s ease;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    -webkit-user-select: none;
  }
  .mt-opt:hover:not(.act) {
    color: #e2e8f0;
    background: rgba(255, 255, 255, 0.06);
  }
  .mt-opt:active:not(.act) {
    transform: scale(0.97);
  }
  .mt-opt.act {
    background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.22), rgba(var(--primary-rgb), 0.1));
    border-color: rgba(var(--primary-rgb), 0.4);
    color: #f1f5f9;
    box-shadow: 0 2px 10px rgba(var(--primary-rgb), 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .mt-opt:focus-visible {
    outline: none;
    border-color: rgba(148, 163, 184, 0.45);
  }

  /* Mismos escalones de alto que `.filter-select` (App.css): sin esto el control
     quedaba más alto que los chips vecinos en pantallas cortas. */
  @media (max-width: 1400px) {
    .mt { height: 26px; }
    .mt-opt { font-size: 0.68rem; padding: 0 0.45rem; }
  }
  @media (max-height: 800px) {
    .mt { height: 24px; }
    .mt-opt { font-size: 0.66rem; padding: 0 0.4rem; }
  }
  @media (max-width: 1400px) and (max-height: 800px) {
    .mt { height: 22px; }
    .mt-opt { font-size: 0.64rem; padding: 0 0.35rem; }
  }

  /* Variante grande para móvil. Va DESPUÉS de los `@media` y con doble clase a
     propósito: en un teléfono suelen caer las dos consultas (ancho < 1400 y
     alto < 800), que lo dejarían en 22px/0.64rem justo cuando se pidió más
     legible. */
  .mt.mt-grande {
    height: 38px;
    width: 100%;
    gap: 3px;
    padding: 3px;
    border-radius: 10px;
  }
  .mt.mt-grande .mt-opt {
    flex: 1 1 0;
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.3px;
    padding: 0 0.5rem;
    border-radius: 8px;
  }
</style>
