<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { registerBackHandler } from "../lib/androidBack";
  import { getAppSettings, saveAppSettings, loadAppSettings, onAppSettingsChange } from "../lib/appSettings";
  import CategoryTabContent from "./CategoryTabContent.svelte";
  import NotasConfig from "./globales/NotasConfig.svelte";
  import AjustesPage from "./AjustesPage.svelte";
  import EvaluacionesPage from "./EvaluacionesPage.svelte";
  import CloudPage from "./CloudPage.svelte";
  import AccountPage from "./AccountPage.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface CategoryConfig {
    title: string; table: string;
    endpoints: { get: string; add: string; update: string; delete: string; setActive?: string; updateOrder?: string; };
    hideDefault?: boolean; noAdd?: boolean;
  }

  let { pageActive = true, seccion = $bindable('evaluaciones'), themeMode = 'sistema', setThemeMode = () => {} }: {
    pageActive?: boolean;
    seccion?: string;
    themeMode?: string;
    setThemeMode?: (v: string) => void;
  } = $props();

  const isAndroid = /Android/i.test(navigator.userAgent);
  const isWindows = /Windows/i.test(navigator.userAgent);
  const isMobile = $state(window.innerWidth <= 768);
  const isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));

  const CATEGORIES: CategoryConfig[] = [
    { title: "Año Lectivo", table: "ano_lectivo", endpoints: { get: "get_anos", add: "add_ano", update: "update_ano", delete: "delete_ano", setActive: "set_active_ano" } },
    { title: "Corte Evaluativo", table: "corte_evaluativo", endpoints: { get: "get_cortes", add: "add_corte", update: "update_corte", delete: "delete_corte", setActive: "set_active_corte" }, noAdd: true },
    { title: "Asignatura", table: "asignatura", endpoints: { get: "get_asignaturas", add: "add_asignatura", update: "update_asignatura", delete: "delete_asignatura" } },
    { title: "Colegio", table: "colegio", endpoints: { get: "get_colegios", add: "add_colegio", update: "update_colegio", delete: "delete_colegio", setActive: "set_active_colegio", updateOrder: "update_colegio_order" }, hideDefault: true },
    { title: "Grado", table: "grado", endpoints: { get: "get_grados", add: "add_grado", update: "update_grado", delete: "delete_grado" }, noAdd: true },
    { title: "Sección", table: "seccion", endpoints: { get: "get_secciones", add: "add_seccion", update: "update_seccion", delete: "delete_seccion" } },
  ];

  interface Seccion {
    id: string; label: string; icono: string; color: string; grupo: string;
    cat?: CategoryConfig; contador?: string; soloAndroid?: boolean;
  }
  const GRUPOS = ['Académico', 'Aplicación', 'Sistema'] as const;

  /** Una línea que explica qué hace cada sección, bajo el título. */
  const DESCRIPCIONES: Record<string, string> = {
    'ano-lectivo': 'Años lectivos del centro. Se ingresan como año calendario de 4 dígitos (2026, 2027) y el sistema los usa como tales para la vista mensual.',
    'corte': 'Períodos de evaluación (1er, 2do, 3er, 4to corte) contra los que se capturan y reportan notas.',
    'asignaturas': 'Catálogo de materias. De aquí sale el selector de asignatura en Notas y Reportes.',
    'colegios': 'Centros educativos. El tipo (Primaria o Secundaria) define qué grados ofrece cada uno.',
    'grados': 'Grados disponibles. Se comparten entre años lectivos; se configuran por colegio desde su ficha.',
    'secciones': 'Secciones de cada grado. Se comparten entre grados, por eso cada ficha las asocia a un grado concreto.',
    'notas': 'Calificaciones cualitativas (color y mínimo) y sus multiplicadores para el cálculo automático de la nota final.',
    'evaluaciones': 'Creación de los indicadores y criterios de evaluación: aquí se define qué se evalúa y con cuántos puntos.',
    'general': 'Color de resaltado, valores por defecto de año lectivo y colegio, y comportamiento de la sincronización.',
    'notificaciones': 'Avisos cuando un colegio tiene grados sin asistencia, dentro de su ventana horaria y con la app cerrada.',
    'nube': 'Conexión con Cloudflare D1 y respaldo en Google Drive. Estado de la sincronización y recuperación de datos.',
    'cuenta': 'Cuentas de Google vinculadas, cambio de perfil y datos de la cuenta activa.',
    'debug': 'Herramientas de diagnóstico y purga. Actúa sobre la base local y la nube: usá con precaución.',
    'info': 'Versión de la app, ruta de la base de datos y detalle de las funciones disponibles.',
  };

  const SECCIONES: Seccion[] = [
    { id: 'evaluaciones', label: 'Evaluaciones', icono: '✏️', color: '#c084fc', grupo: 'Académico' },
    { id: 'notas', label: 'Notas', icono: '⭐', color: '#fbbf24', grupo: 'Académico', contador: 'get_grade_configs' },
    { id: 'ano-lectivo', label: 'Año Lectivo', icono: '📅', color: '#818cf8', grupo: 'Académico', cat: CATEGORIES[0], contador: 'get_anos' },
    { id: 'corte', label: 'Corte Evaluativo', icono: '✂️', color: '#f472b6', grupo: 'Académico', cat: CATEGORIES[1], contador: 'get_cortes' },
    { id: 'asignaturas', label: 'Asignatura', icono: '📚', color: '#60a5fa', grupo: 'Académico', cat: CATEGORIES[2], contador: 'get_asignaturas' },
    { id: 'colegios', label: 'Colegio', icono: '🏫', color: '#34d399', grupo: 'Académico', cat: CATEGORIES[3], contador: 'get_colegios' },
    { id: 'grados', label: 'Grado', icono: '📊', color: '#fb923c', grupo: 'Académico', cat: CATEGORIES[4], contador: 'get_grados' },
    { id: 'secciones', label: 'Sección', icono: '👥', color: '#a78bfa', grupo: 'Académico', cat: CATEGORIES[5], contador: 'get_secciones' },
    { id: 'general', label: 'General', icono: '⚙️', color: '#60a5fa', grupo: 'Aplicación' },
    { id: 'notificaciones', label: 'Notif. Asistencia', icono: '🔔', color: '#fbbf24', grupo: 'Aplicación', soloAndroid: true },
    { id: 'nube', label: 'Nube', icono: '☁️', color: '#38bdf8', grupo: 'Aplicación' },
    { id: 'cuenta', label: 'Cuenta', icono: '👤', color: '#f472b6', grupo: 'Aplicación' },
    { id: 'debug', label: 'Debug', icono: '🐛', color: '#ef4444', grupo: 'Sistema' },
    { id: 'info', label: 'Info', icono: '📖', color: '#a78bfa', grupo: 'Sistema' },
  ];

  const seccionesVisibles = $derived(SECCIONES.filter(s => !s.soloAndroid || isAndroid));
  /** Sección que se abre siempre que se entra a Ajustes Generales. */
  const SECCION_POR_DEFECTO = 'evaluaciones';
  // En escritorio se abre directamente la sección pedida (por defecto Notas):
  // el rail es navegación secundaria, no una pantalla de bienvenida.
  let activa = $state<Seccion | null>(isAndroidMobile ? null : SECCIONES.find(s => s.id === SECCION_POR_DEFECTO) ?? null);
  let busqueda = $state('');
  let railExpandido = $state(false);
  let railFijado = $state(false);
  let contadores = $state<Record<string, number>>({});
  const contadoresCargados = new Set<string>();

  const filtradas = $derived.by(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return seccionesVisibles;
    return seccionesVisibles.filter(s => s.label.toLowerCase().includes(q) || s.grupo.toLowerCase().includes(q));
  });
  const activaVisible = $derived(!!activa && filtradas.some(s => s.id === activa!.id));

  function abrir(s: Seccion) {
    activa = s;
    seccion = s.id;
    busqueda = '';
    if (s.contador && !contadoresCargados.has(s.id)) cargarContador(s);
  }
  function cerrar() { activa = null; }

  async function cargarContador(s: Seccion) {
    if (!s.contador) return;
    contadoresCargados.add(s.id);
    try {
      const items = await invoke<CategoryItem[]>(s.contador);
      contadores = { ...contadores, [s.id]: Array.isArray(items) ? items.length : 0 };
    } catch {
      contadores = { ...contadores, [s.id]: 0 };
    }
  }

  /**
   * Carga los contadores de TODAS las secciones del catálogo de una sola vez.
   * Antes cada contador se pedía al abrir su sección, así que el número del rail
   * aparecía recién después de entrar a la página y las demás entradas quedaban
   * sin conteo. Con esto el número está siempre visible.
   *
   * `forzar` vuelve a pedir todos los contadores, para que no queden desfasados
   * después de agregar o borrar ítems en otra sección.
   */
  async function cargarTodosLosContadores(forzar = false) {
    for (const s of SECCIONES) {
      if (!s.contador) continue;
      if (!forzar && contadoresCargados.has(s.id)) continue;
      await cargarContador(s);
    }
  }

  function abrirPorId(id: string) {
    const s = SECCIONES.find(x => x.id === id);
    if (s) abrir(s);
  }

  /**
   * Navegación desde dentro del shell (CloudPage, AccountPage). Antes estas
   * páginas vivían en tabs propios y pedían un cambio de tab; ahora que están
   * dentro del rail, la traducción es abrir la sección equivalente.
   */
  function irAjustes(destino: string) {
    if (destino === 'cloud') { abrirPorId('nube'); return; }
    if (destino === 'account') { abrirPorId('cuenta'); return; }
    if (destino === 'evaluaciones') { abrirPorId('evaluaciones'); return; }
    // Cualquier otro destino (p. ej. "welcome") no aplica dentro del shell.
    console.warn('[Ajustes] destino de navegación no soportado:', destino);
  }

  // Al volver a la página: en Android se muestra la lista; en escritorio se
  // respeta la sección pedida por deep-link. Los contadores se recalculan porque
  // mientras la app estuvo en otra pestaña se pudieron agregar o borrar ítems.
  let fueVisible = pageActive;
  $effect(() => {
    const ahora = pageActive;
    const previo = fueVisible;
    fueVisible = ahora;
    if (!ahora || previo) return;
    if (isAndroidMobile) { activa = null; }
    else { abrirPorId(seccion); }
    void cargarTodosLosContadores(true);
  });

  // Deep-link: cualquier página puede pedir una sección concreta.
  $effect(() => {
    if (!pageActive) return;
    const off = listen<{ section: string }>('open-ajustes', (e) => {
      const id = e.payload?.section;
      if (id) abrirPorId(id);
    });
    return () => { off.then(f => f()); };
  });

  // Back de Android: desde el detalle vuelve a la lista.
  $effect(() => {
    if (!isAndroidMobile || !pageActive) return;
    if (!activa) return;
    return registerBackHandler(() => { cerrar(); return true; });
  });

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && filtradas.length > 0) abrir(filtradas[0]);
    if (e.key === 'Escape') { busqueda = ''; railFijado = false; }
  }

  const railAncho = $derived(railExpandido || railFijado || !!busqueda.trim() ? '252px' : '64px');

  // Estado del toggle "Mostrar selector de Año Lectivo" en otras páginas.
  let showAnoDropdown = $state(true);

  onMount(() => {
    // El toggle del selector de año vive en AjustesGlobales, pero lo muestra
    // este shell (sección Año Lectivo): hay que suscribirse a los ajustes.
    loadAppSettings().then(s => { showAnoDropdown = s.showAnoDropdown; });
    const unsub = onAppSettingsChange(s => { showAnoDropdown = s.showAnoDropdown; });
    // Contadores de TODAS las secciones de una vez, para que el número del rail
    // esté siempre visible y no solo en la sección abierta.
    void cargarTodosLosContadores();
    return unsub;
  });

  function toggleAnoDropdown() {
    showAnoDropdown = !showAnoDropdown;
    void saveAppSettings({ ...getAppSettings(), showAnoDropdown });
  }
</script>

{#snippet anoLectivoHeader()}
  <div style="display:flex;align-items:center;gap:0.6rem;padding:0.75rem 1rem;background:rgba(129,140,248,0.06);border:1px solid rgba(129,140,248,0.15);border-radius:12px;">
    <span style="font-size:1rem;line-height:1">📅</span>
    <span style="font-size:0.75rem;color:#c7d2fe;line-height:1.4">
      El año lectivo se ingresa como <strong>año calendario</strong> de 4 dígitos (Ej: 2026, 2027), no como rango. El sistema lo trata como año calendario: si es 2026, la vista mensual muestra 2026.
    </span>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;background:rgba(129,140,248,0.06);border:1px solid rgba(129,140,248,0.15);border-radius:12px;margin-top:0.5rem">
    <div style="display:flex;flex-direction:column;gap:2px;">
      <span style="font-size:0.8rem;color:#e2e8f0;font-weight:600;">Mostrar selector en otras páginas</span>
      <span style="font-size:0.7rem;color:#94a3b8;">Muestra/oculta el dropdown de Año Lectivo en Notas, Asistencia y Reportes</span>
    </div>
    <label class="switch" title={showAnoDropdown ? "Ocultar dropdown" : "Mostrar dropdown"}>
      <input type="checkbox" checked={showAnoDropdown} onchange={toggleAnoDropdown} />
      <span class="slider round"></span>
    </label>
  </div>
{/snippet}

{#snippet contenidoSeccion()}
  {#if !activa}
    <!-- `activa` es null en la lista raíz: acá no se renderiza nada. El guard
         además le permite a TS estrechar el tipo dentro del snippet. -->
  {:else if activa.cat}
    <CategoryTabContent config={activa.cat} accentColor={activa.color} accentIcon={activa.icono} headerExtra={activa.id === 'ano-lectivo' ? anoLectivoHeader : undefined} />
  {:else if activa.id === 'notas'}
    <NotasConfig />
  {:else if activa.id === 'evaluaciones'}
    <div style="width:100%;height:100%;"><EvaluacionesPage /></div>
  {:else if activa.id === 'nube'}
    <div style="width:100%;height:100%;overflow-y:auto;"><CloudPage onNavigate={irAjustes} pageActive={pageActive} /></div>
  {:else if activa.id === 'cuenta'}
    <div style="width:100%;height:100%;overflow-y:auto;"><AccountPage onNavigate={irAjustes} /></div>
  {:else}
    <AjustesPage seccion={activa.id} pageActive={pageActive} soloContenido {themeMode} {setThemeMode} />
  {/if}
{/snippet}

{#if isAndroidMobile}
  <div class="page-container">
    {#if !activa}
      <div style="padding:1rem;">
        <h1 style="font-size:1.5rem;font-weight:700;color:#f1f5f9;margin-bottom:1.5rem;text-align:center;">Ajustes Generales</h1>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          {#each GRUPOS as grupo (grupo)}
            {@const delGrupo = filtradas.filter(s => s.grupo === grupo)}
            {#if delGrupo.length > 0}
              <div style="font-size:0.62rem;letter-spacing:0.6px;text-transform:uppercase;color:#64748b;font-weight:700;padding:0.35rem 0.25rem 0.1rem">{grupo}</div>
              {#each delGrupo as s (s.id)}
                <button onclick={() => abrir(s)}
                  style="display:flex;align-items:center;gap:1rem;padding:1rem 1.25rem;background:rgba(51,65,85,0.5);border:1px solid rgba(255,255,255,0.08);border-left:3px solid {s.color};border-radius:12px;cursor:pointer;width:100%;transition:all 0.2s ease"
                  onmouseenter={(e) => { e.currentTarget.style.borderColor = s.color + '44'; e.currentTarget.style.background = s.color + '0d'; }}
                  onmouseleave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderLeftColor = s.color; e.currentTarget.style.background = 'rgba(51,65,85,0.5)'; }}>
                  <div style="width:40px;height:40px;border-radius:10px;background:{s.color}18;display:flex;align-items:center;justify-content:center;font-size:1.15rem;flex-shrink:0;">{s.icono}</div>
                  <span style="font-size:1rem;font-weight:600;color:#e2e8f0;text-align:left;flex:1;">{s.label}</span>
                  {#if contadores[s.id] !== undefined}<span style="font-size:0.75rem;font-weight:700;color:{s.color}">{contadores[s.id]}</span>{/if}
                  <span style="font-size:1.25rem;color:#64748b;">›</span>
                </button>
              {/each}
            {/if}
          {/each}
        </div>
      </div>
    {:else}
      <div style="padding:1rem;">
        {@render contenidoSeccion()}
      </div>
    {/if}
  </div>
{:else}
  <div class="aj-gen">
    <nav class="rail" class:expandido={railExpandido || railFijado || !!busqueda.trim()} style="width:{railAncho}"
      onmouseenter={() => railExpandido = true}
      onmouseleave={() => { railExpandido = false; if (!busqueda.trim()) railFijado = false; }}>
      <div class="rail-busca">
        <span class="lupa" onclick={() => { railExpandido = true; railFijado = true; }} title="Buscar sección">🔍</span>
        <input placeholder="Buscar sección" bind:value={busqueda} onfocus={() => railFijado = true} onkeydown={onSearchKey} />
      </div>

      <div class="rail-scroll">
        {#each GRUPOS as grupo (grupo)}
          {@const delGrupo = filtradas.filter(s => s.grupo === grupo)}
          {#if delGrupo.length > 0}
            <div class="rail-grupo">{grupo}</div>
            {#each delGrupo as s (s.id)}
              <button class="rail-item" class:activo={activa?.id === s.id} class:invisible={!activaVisible && activa?.id !== s.id}
                style="--acento:{s.color}" onclick={() => abrir(s)} title={s.label}>
                <span class="rail-icono">{s.icono}
                  {#if contadores[s.id] !== undefined}<span class="rail-badge">{contadores[s.id]}</span>{/if}
                </span>
                <span class="rail-label">{s.label}</span>
                {#if contadores[s.id] !== undefined}<span class="rail-count">{contadores[s.id]}</span>{/if}
              </button>
            {/each}
          {/if}
        {/each}
        {#if filtradas.length === 0}
          <div class="rail-vacio">Sin coincidencias</div>
        {/if}
      </div>
    </nav>

    <section class="contenido">
      {#if activa}
        <header class="cont-head" style="--acento:{activa.color}">
          <div>
            <h1>{activa.label}</h1>
            <p>{DESCRIPCIONES[activa.id]}</p>
          </div>
          {#if contadores[activa.id] !== undefined}
            <div class="cont-contador">{contadores[activa.id]}</div>
          {/if}
        </header>

        <div class="cont-body">
          {@render contenidoSeccion()}
        </div>
      {:else}
        <div class="cont-placeholder">Elegí una sección del menú</div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .aj-gen{display:flex;height:100%;min-height:0;width:100%;overflow:hidden}

  .rail{flex-shrink:0;display:flex;flex-direction:column;height:100%;background:rgba(15,23,42,0.55);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-right:1px solid rgba(255,255,255,0.07);overflow:hidden;transition:width 0.22s cubic-bezier(0.4,0,0.2,1)}
  .rail-busca{display:flex;align-items:center;gap:0.45rem;padding:0.6rem 0.55rem;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0}
  .lupa{font-size:0.85rem;opacity:0.6;flex-shrink:0}
  .rail-busca input{flex:1;min-width:0;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.35rem 0.5rem;color:#e2e8f0;font-size:0.78rem;outline:none}
  .rail-busca input::placeholder{color:#64748b}
  .rail-busca input:focus{border-color:var(--primary-color)}
  /* Colapsado no hay ancho para el input: se muestra solo la lupa (abre al expandir). */
  .rail:not(.expandido) .rail-busca input{display:none}
  .rail:not(.expandido) .rail-busca{justify-content:center;padding:0.6rem 0}

  .rail-scroll{flex:1;overflow-y:auto;overflow-x:hidden;padding:0.4rem 0.3rem 1rem}
  .rail-scroll::-webkit-scrollbar{width:5px}
  .rail-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.16);border-radius:3px}

  .rail-item{display:flex;align-items:center;gap:0.55rem;width:100%;padding:0.45rem;border:none;background:transparent;border-radius:9px;cursor:pointer;color:#94a3b8;position:relative;transition:background 0.15s,color 0.15s}
  .rail-item:hover{background:rgba(255,255,255,0.06);color:#e2e8f0}
  .rail-item.activo{background:var(--acento)1f;color:#f1f5f9}
  .rail-item.activo::before{content:'';position:absolute;left:-0.3rem;top:0.35rem;bottom:0.35rem;width:3px;border-radius:2px;background:var(--acento)}
  .rail-item.invisible{opacity:0.32}

  .rail-icono{position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:0.95rem;flex-shrink:0}
  .rail-badge{position:absolute;top:-3px;right:-4px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:var(--acento);color:#0f172a;font-size:0.55rem;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1}
  .rail-label{flex:1;min-width:0;font-size:0.8rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
  .rail-count{font-size:0.68rem;font-weight:800;color:var(--acento);flex-shrink:0}

  /* Colapsado (64px): solo icono + badge sobre el icono. Al expandir, el
     contador aparece a la derecha del texto (sin hover) y el badge se oculta
     para no duplicar el número. */
  .rail:not(.expandido) .rail-label,
  .rail:not(.expandido) .rail-count{display:none}
  .rail.expandido .rail-badge{display:none}

  .rail-grupo{font-size:0.55rem;letter-spacing:0.5px;text-transform:uppercase;color:#64748b;font-weight:700;padding:0.6rem 0.6rem 0.25rem;white-space:nowrap;overflow:hidden}
  .rail:not(.expandido) .rail-grupo{font-size:0;padding:0.55rem 0.25rem 0.1rem;border-top:1px solid rgba(255,255,255,0.07);margin:0.25rem 0.15rem}
  .rail:not(.expandido) .rail-grupo:first-child{border-top:none;margin-top:0;padding-top:0.2rem}

  .rail-vacio{padding:0.8rem 0.6rem;font-size:0.75rem;color:#64748b;white-space:nowrap}

  .contenido{flex:1;min-width:0;height:100%;overflow-y:auto;padding:1.5rem 1.75rem 3rem}
  .cont-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding-left:0.85rem;border-left:4px solid var(--acento);border-radius:0 10px 10px 0;margin-bottom:1.25rem}
  .cont-head h1{margin:0;font-size:1.4rem;font-weight:700;color:#f1f5f9;letter-spacing:-0.2px}
  .cont-head p{margin:0.3rem 0 0;font-size:0.82rem;color:#94a3b8;line-height:1.5;max-width:70ch}
  .cont-contador{font-size:1.6rem;font-weight:800;color:var(--acento);line-height:1;opacity:0.9}
  .cont-body{min-width:0}
  .cont-placeholder{color:#64748b;font-size:0.9rem;padding:3rem 0;text-align:center}
</style>
