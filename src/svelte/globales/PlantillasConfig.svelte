<script lang="ts">
  /**
   * PlantillasConfig — CRUD de plantillas de instrumentos de evaluación.
   *
   * El constructor visual vive ACÁ (Configuración); NotasPage solo las consume
   * al generar PDF/Excel. La definición se guarda en la tabla
   * `instrumento_plantilla` (BD SQLite, sincronizada por Cloudflare D1), no en
   * archivos .xlsx sueltos: así viaja entre dispositivos y sobrevive al
   * restore de Drive.
   *
   * Definición guardada: JSON `PlantillaDefinicion` (titulo, textoIntro,
   * leyenda, mostrarPuntajeCriterios, colFinal, orientacion).
   */
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { t } from "../../lib/i18n.svelte";
  import { onDataChange } from "../../lib/autoSync";
  import {
    defaultDefinicion,
    parseDefinicion,
    listarInstrumentoPlantillas,
    guardarInstrumentoPlantilla,
    eliminarInstrumentoPlantilla,
    type InstrumentoPlantilla,
    type PlantillaDefinicion,
  } from "../../lib/instrumentoPlantilla";
  import { INSTRUMENTO_OPS, type InstrumentoTipo } from "../../lib/instrumentosPdf";

  const ACENTO = "#38bdf8";

  interface FilaUI extends InstrumentoPlantilla {
    def: PlantillaDefinicion;
  }

  let plantillas = $state<FilaUI[]>([]);
  let cargando = $state(false);

  // Estado del editor (constructor visual). `editando = null` → modal cerrado.
  let editandoId = $state(0);
  let editando = $state(false);
  let editNombre = $state("");
  let editTipo = $state<InstrumentoTipo>("escala");
  let editDef = $state<PlantillaDefinicion>(defaultDefinicion());
  let guardando = $state(false);
  let borrandoId = $state(0);

  const isAndroid = /Android/i.test(navigator.userAgent);

  const labelTipo = (tipo: string): string =>
    INSTRUMENTO_OPS.find(o => o.id === tipo)?.label ?? tipo;

  async function recargar() {
    cargando = true;
    try {
      const filas = await listarInstrumentoPlantillas();
      plantillas = filas.map(p => ({ ...p, def: parseDefinicion(p.definicion) }));
    } catch (e) {
      console.error("[Plantillas] Error cargando:", e);
    } finally {
      cargando = false;
    }
  }
  recargar();

  function abrirCrear() {
    editandoId = 0;
    editNombre = "";
    editTipo = "escala";
    editDef = defaultDefinicion();
    editando = true;
  }

  function abrirEditar(p: FilaUI) {
    editandoId = p.id;
    editNombre = p.nombre;
    editTipo = p.tipo;
    editDef = { ...defaultDefinicion(p.tipo), ...p.def };
    editando = true;
  }

  function cerrarEditor() {
    editando = false;
  }

  function cambiarTipo(nuevo: InstrumentoTipo) {
    editTipo = nuevo;
    // Al cambiar el tipo, los defaults específicos vuelven a su valor natural
    // (p. ej. cotejo usa columna "Total").
    editDef = { ...defaultDefinicion(nuevo) };
  }

  async function guardar() {
    if (!editNombre.trim()) {
      await emit("show-toast", { message: t('pl.err.nombre'), type: "warning" });
      return;
    }
    guardando = true;
    try {
      const saved = await guardarInstrumentoPlantilla({
        id: editandoId,
        nombre: editNombre,
        tipo: editTipo,
        definicion: editDef,
      });
      onDataChange("instrumento_plantilla", { immediate: true });
      editando = false;
      await recargar();
      await emit("show-toast", { message: t('pl.ok.guardada', { n: saved.nombre }), type: "success" });
    } catch (e) {
      console.error("[Plantillas] Error guardando:", e);
      await emit("show-toast", { message: t('pl.err.guardar', { msg: String(e) }), type: "error" });
    } finally {
      guardando = false;
    }
  }

  async function eliminar(p: FilaUI) {
    if (borrandoId) return;
    const ok = await ask(t('pl.confirmar.borrar', { n: p.nombre }), {
      title: t('pl.confirmar.titulo'),
      kind: "warning",
      okLabel: t('comun.eliminar'),
      cancelLabel: t('comun.cancelar'),
    });
    if (!ok) return;
    borrandoId = p.id;
    try {
      await eliminarInstrumentoPlantilla(p.id);
      onDataChange("instrumento_plantilla", { immediate: true });
      await recargar();
      await emit("show-toast", { message: t('pl.ok.borrada'), type: "success" });
    } catch (e) {
      console.error("[Plantillas] Error borrando:", e);
      await emit("show-toast", { message: t('pl.err.borrar', { msg: String(e) }), type: "error" });
    } finally {
      borrandoId = 0;
    }
  }

  function cambiar<K extends keyof PlantillaDefinicion>(k: K, v: PlantillaDefinicion[K]) {
    editDef = { ...editDef, [k]: v };
  }

  // ── Datos de ejemplo para la vista previa en vivo ──
  const EJEMPLO = [
    { nombre: "Ana Pérez Gómez", letras: ["AA", "AS", "AA"], valoracion: "AA" },
    { nombre: "Luis Ramírez Cruz", letras: ["AS", "AF", "AS"], valoracion: "AS" },
    { nombre: "María Tapia Ríos", letras: ["AF", "AI", "AF"], valoracion: "AF" },
  ];
  const EJEMPLO_CRITERIOS = [
    { orden: 1, descripcion: "Reconoce el concepto trabajado", puntajeMaximo: 20 },
    { orden: 2, descripcion: "Aplica el procedimiento correctamente", puntajeMaximo: 20 },
  ];
</script>

<div class="category-card" class:compacto={isAndroid} style="border-left:3px solid {ACENTO};">
  <div class="category-header"><h3>{t('pl.titulo')}</h3></div>
  <div class="cfg-body">
    <p style="margin:0 0 1rem 0;color:#94a3b8;font-size:0.85rem;">{t('pl.desc')}</p>

    <div style="display:flex;justify-content:flex-start;margin-bottom:1rem;">
      <button onclick={abrirCrear}
        style="padding:0.6rem 1.4rem;background:linear-gradient(135deg,{ACENTO},#0284c7);border:none;border-radius:10px;color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;box-shadow:0 6px 22px rgba(56,189,248,0.3);transition:all 0.2s ease;"
        onmouseenter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
        onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
        ✚ {t('pl.btn.crear')}
      </button>
    </div>

    {#if cargando && plantillas.length === 0}
      <div style="text-align:center;color:#64748b;font-size:0.8rem;padding:1.5rem 0;">⏳ {t('comun.cargando')}</div>
    {:else if plantillas.length === 0}
      <div class="pl-vacia">{t('pl.vacia')}</div>
    {:else}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:0.75rem;">
        {#each plantillas as p (p.id)}
          <div class="pl-card">
            <div class="pl-card-barra" style="background:{ACENTO};"></div>
            <div style="padding:0.9rem 0.9rem 0.7rem 1.2rem;display:flex;flex-direction:column;gap:0.5rem;flex:1;min-width:0;">
              <span style="color:#f1f5f9;font-size:0.9rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{p.nombre}</span>
              <span class="pl-tipo">{t('pl.tipo')}: {labelTipo(p.tipo)}</span>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap;font-size:0.66rem;color:#94a3b8;">
                <span>{t('pl.hint.colFinal')}: {p.def.colFinal === 'total' ? t('pl.opt.total') : p.def.colFinal === 'ninguno' ? t('pl.opt.ninguno') : t('pl.opt.valoracion')}</span>
                {#if p.def.orientacion !== 'auto'}<span>· {p.def.orientacion === 'horizontal' ? t('pl.opt.horizontal') : t('pl.opt.vertical')}</span>{/if}
              </div>
            </div>
            <div style="display:flex;gap:0.4rem;padding:0 0.9rem 0.8rem 0.9rem;">
              <button class="pl-btn" onclick={() => abrirEditar(p)} title={t('comun.editar')}>✎</button>
              <button class="pl-btn pl-btn-rojo" onclick={() => eliminar(p)} disabled={borrandoId === p.id} title={t('comun.eliminar')}>
                {borrandoId === p.id ? '⏳' : '🗑'}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- ── Constructor visual (modal). Debe fijarse al viewport del documento, no
        del card glass: nada del markup interior tiene transform/backdrop-filter
        como ancestro directo, pero se monta a nivel de página por si acaso. ── -->
{#if editando}
  <div class="modal-overlay" onpointerdown={(e) => { if (e.target === e.currentTarget) cerrarEditor(); }}>
    <div class="modal-capa">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h3 style="margin:0;color:#f1f5f9;font-size:1.05rem;font-weight:700;">
          {editandoId ? t('pl.editor.tituloEditar') : t('pl.editor.tituloCrear')}
        </h3>
        <button onclick={cerrarEditor} style="background:transparent;border:none;color:#64748b;font-size:1.2rem;cursor:pointer;">✕</button>
      </div>

      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
        <!-- Columna izquierda: campos -->
        <div style="flex:1.1;min-width:260px;display:flex;flex-direction:column;gap:0.7rem;">
          <div>
            <label class="pl-label">{t('pl.editor.nombre')}</label>
            <input class="pl-input" bind:value={editNombre} placeholder={t('pl.editor.nombreEj')} />
          </div>

          <div>
            <label class="pl-label">{t('pl.editor.tipo')}</label>
            <div class="pl-seg">
              {#each INSTRUMENTO_OPS as op (op.id)}
                <button class="pl-seg-btn" class:activo={editTipo === op.id} onclick={() => cambiarTipo(op.id)}>{op.label}</button>
              {/each}
            </div>
          </div>

          <div>
            <label class="pl-label">{t('pl.editor.documentoTitulo')}</label>
            <input class="pl-input" bind:value={editDef.titulo} placeholder={t('pl.editor.documentoTituloEj')}
              oninput={() => cambiar('titulo', editDef.titulo)} />
          </div>

          <div>
            <label class="pl-label">{t('pl.editor.textoIntro')}</label>
            <textarea class="pl-input" rows="2" bind:value={editDef.textoIntro}
              oninput={() => cambiar('textoIntro', editDef.textoIntro)}
              placeholder={t('pl.editor.textoIntroEj')}></textarea>
          </div>

          <div>
            <label class="pl-label">{t('pl.editor.colFinal')}</label>
            <div class="pl-seg">
              <button class="pl-seg-btn" class:activo={editDef.colFinal === 'valoracion'} onclick={() => cambiar('colFinal', 'valoracion')}>{t('pl.opt.valoracion')}</button>
              <button class="pl-seg-btn" class:activo={editDef.colFinal === 'total'} onclick={() => cambiar('colFinal', 'total')}>{t('pl.opt.total')}</button>
              <button class="pl-seg-btn" class:activo={editDef.colFinal === 'ninguno'} onclick={() => cambiar('colFinal', 'ninguno')}>{t('pl.opt.ninguno')}</button>
            </div>
          </div>

          <div>
            <label class="pl-label">{t('pl.editor.orientacion')}</label>
            <div class="pl-seg">
              <button class="pl-seg-btn" class:activo={editDef.orientacion === 'auto'} onclick={() => cambiar('orientacion', 'auto')}>{t('pl.opt.auto')}</button>
              <button class="pl-seg-btn" class:activo={editDef.orientacion === 'horizontal'} onclick={() => cambiar('orientacion', 'horizontal')}>{t('pl.opt.horizontal')}</button>
              <button class="pl-seg-btn" class:activo={editDef.orientacion === 'vertical'} onclick={() => cambiar('orientacion', 'vertical')}>{t('pl.opt.vertical')}</button>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">
            <span style="font-size:0.78rem;color:#e2e8f0;">{t('pl.editor.mostrarPuntaje')}</span>
            <label class="switch" title={t('pl.editor.mostrarPuntaje')}>
              <input type="checkbox" checked={editDef.mostrarPuntajeCriterios}
                onchange={(e) => cambiar('mostrarPuntajeCriterios', (e.target as HTMLInputElement).checked)} />
              <span class="slider round"></span>
            </label>
          </div>

          <div>
            <label class="pl-label">{t('pl.editor.leyenda')}</label>
            <input class="pl-input" bind:value={editDef.leyenda} placeholder={t('pl.editor.leyendaEj')}
              oninput={() => cambiar('leyenda', editDef.leyenda)} />
          </div>
        </div>

        <!-- Columna derecha: vista previa en vivo -->
        <div style="flex:1;min-width:240px;">
          <label class="pl-label">{t('pl.editor.preview')}</label>
          <div class="pl-preview">
            <div class="pl-preview-titulo">{(editDef.titulo || '').trim() || `Instrumento: ${labelTipo(editTipo)} — Indicador 1`}</div>
            <div class="pl-preview-meta">
              {t('pl.preview.meta', { a: 'Colegio', b: 'Corte', c: 'Grado — Sección', d: 'Asignatura' })}
            </div>
            {#if (editDef.textoIntro || '').trim()}
              <div class="pl-preview-intro">{editDef.textoIntro}</div>
            {/if}
            <div class="pl-preview-crit">
              {#each EJEMPLO_CRITERIOS as c (c.orden)}
                <div><b>{c.orden}.</b> {c.descripcion}{#if editDef.mostrarPuntajeCriterios}<span class="pl-preview-pts"> ({c.puntajeMaximo} pts)</span>{/if}</div>
              {/each}
            </div>
            <table class="pl-preview-tabla">
              <thead>
                <tr>
                  <th>#</th><th class="izq">{t('pl.preview.estudiante')}</th>
                  {#each EJEMPLO_CRITERIOS as c (c.orden)}<th>C{c.orden}</th>{/each}
                  {#if editDef.colFinal !== 'ninguno'}<th>{editDef.colFinal === 'total' ? t('pl.opt.total') : t('pl.opt.valoracion')}</th>{/if}
                </tr>
              </thead>
              <tbody>
                {#each EJEMPLO as est, i (i)}
                  <tr>
                    <td>{i + 1}</td>
                    <td class="izq">{est.nombre}</td>
                    {#each est.letras as l, li (li)}<td>{l}</td>{/each}
                    {#if editDef.colFinal !== 'ninguno'}<td class="negrita">{est.valoracion}</td>{/if}
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if editTipo === 'escala'}
              <div class="pl-preview-leyenda">{(editDef.leyenda || '').trim() || t('pl.preview.leyendaDefault')}</div>
            {/if}
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:1rem;">
        <button onclick={cerrarEditor} class="pl-btn-cancelar">{t('comun.cancelar')}</button>
        <button onclick={guardar} disabled={guardando} class="pl-btn-guardar">
          {guardando ? t('comun.guardando') : t('comun.guardar')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cfg-body { padding: 1.5rem 2rem; }

  /* ── Android: compacto (mismo lenguaje de Debug/Info/Calificaciones) ──
     La cabecera del .category-card SE CONSERVA (único título de la sección). */
  .category-card.compacto .cfg-body { padding: 0.35rem; }
  .category-card.compacto .category-header { margin-bottom: 0.9rem; }
  .category-card.compacto .category-header h3 { font-size: 1.05rem; }

  .pl-vacia {
    text-align: center; padding: 2rem 1rem; color: #64748b; font-size: 0.85rem;
    border: 1px dashed rgba(56,189,248,0.25); border-radius: 12px;
    background: rgba(56,189,248,0.04);
  }
  .pl-card {
    position: relative; display: flex; flex-direction: column;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px; overflow: hidden; transition: all 0.2s ease;
    cursor: pointer;
  }
  .pl-card:hover { border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.05); }
  .pl-card-barra { position: absolute; top: 0; left: 0; width: 4px; height: 100%; opacity: 0.8; }
  .pl-tipo { color: #7dd3fc; font-size: 0.72rem; font-weight: 600; }
  .pl-btn {
    flex: 1; padding: 0.4rem; border-radius: 8px;
    border: 1px solid rgba(56,189,248,0.25); background: rgba(56,189,248,0.1);
    color: #7dd3fc; cursor: pointer; font-size: 0.8rem; transition: all 0.2s ease;
  }
  .pl-btn:hover { background: rgba(56,189,248,0.2); }
  .pl-btn-rojo { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08); color: #fca5a5; }
  .pl-btn-rojo:hover { background: rgba(239,68,68,0.18); }
  .pl-btn-rojo:disabled { opacity: 0.5; cursor: not-allowed; }

  .pl-label {
    display: block; margin: 0 0 0.3rem 0;
    font-size: 0.65rem; letter-spacing: 0.5px; text-transform: uppercase;
    color: #64748b; font-weight: 700;
  }
  .pl-input {
    width: 100%; box-sizing: border-box; padding: 0.45rem 0.6rem;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px; color: #e2e8f0; font-size: 0.83rem; outline: none;
    transition: border-color 0.2s ease; font-family: inherit; resize: vertical;
  }
  .pl-input:focus { border-color: rgba(56,189,248,0.5); }

  .pl-seg { display: flex; gap: 0.3rem; flex-wrap: wrap; }
  .pl-seg-btn {
    padding: 0.4rem 0.7rem; border-radius: 8px; font-size: 0.72rem; font-weight: 600;
    border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
    color: #94a3b8; cursor: pointer; transition: all 0.2s ease;
  }
  .pl-seg-btn.activo {
    background: rgba(56,189,248,0.16); border-color: rgba(56,189,248,0.4); color: #7dd3fc;
  }

  .modal-overlay {
    position: fixed; inset: 0; z-index: 2000;
    display: flex; align-items: center; justify-content: center; padding: 1rem;
    background: rgba(2,6,23,0.7); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .modal-capa {
    background: rgba(20,24,31,0.9); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(56,189,248,0.2); border-radius: 20px;
    padding: 1.4rem; width: min(900px, 96vw); max-height: 88vh; overflow-y: auto;
    box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);
  }

  /* Vista previa */
  .pl-preview {
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px; padding: 0.8rem; display: flex; flex-direction: column;
    gap: 0.45rem; font-size: 0.72rem; color: #cbd5e1;
  }
  .pl-preview-titulo { font-weight: 700; font-size: 0.82rem; color: #f1f5f9; }
  .pl-preview-meta { color: #94a3b8; font-size: 0.62rem; }
  .pl-preview-intro { font-style: italic; color: #94a3b8; font-size: 0.66rem; white-space: pre-wrap; }
  .pl-preview-crit { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.68rem; }
  .pl-preview-pts { color: #64748b; font-size: 0.62rem; }
  .pl-preview-tabla { width: 100%; border-collapse: collapse; margin-top: 0.2rem; }
  .pl-preview-tabla th, .pl-preview-tabla td {
    border: 1px solid rgba(255,255,255,0.12); padding: 0.28rem 0.4rem;
    text-align: center; font-size: 0.66rem;
  }
  .pl-preview-tabla th { background: rgba(56,189,248,0.12); color: #e2f2ff; }
  .pl-preview-tabla .izq { text-align: left; }
  .pl-preview-tabla .negrita { font-weight: 700; }
  .pl-preview-leyenda { font-style: italic; color: #64748b; font-size: 0.62rem; margin-top: 0.2rem; }

  .pl-btn-cancelar {
    padding: 0.55rem 1.1rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);
    background: transparent; color: #94a3b8; font-size: 0.8rem; font-weight: 600; cursor: pointer;
    transition: all 0.2s ease;
  }
  .pl-btn-cancelar:hover { color: #e2e8f0; border-color: rgba(255,255,255,0.25); }
  .pl-btn-guardar {
    padding: 0.55rem 1.4rem; border-radius: 10px; border: none;
    background: linear-gradient(135deg,{ACENTO},#0284c7); color: #fff; font-size: 0.8rem;
    font-weight: 700; cursor: pointer; box-shadow: 0 6px 22px rgba(56,189,248,0.3);
    transition: all 0.2s ease;
  }
  .pl-btn-guardar:disabled { opacity: 0.6; cursor: not-allowed; }

  /* El switch / slider ya vienen de los estilos globales del repo. */
</style>
