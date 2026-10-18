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
   * El editor es una CUADRÍCULA tipo Excel: celdas editables en vivo (el
   * preview ES la edición), fusionar celdas (col/rowspan), filas/columnas
   * dinámicas y una FILA DE ESTUDIANTES que se expande sola al generar.
   * Los tokens {COLEGIO}, {CRIT_1}, {ESTUDIANTE}, {LETRA_1}, {VALORACION}…
   * se reemplazan con datos reales en los generadores.
   */
  import { emit } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { t } from "../../lib/i18n.svelte";
  import { onDataChange } from "../../lib/autoSync";
  import {
    defaultDefinicion,
    gridPresetChecklist,
    parseDefinicion,
    listarInstrumentoPlantillas,
    guardarInstrumentoPlantilla,
    eliminarInstrumentoPlantilla,
    type InstrumentoPlantilla,
    type PlantillaDefinicion,
    type PlantillaGrid,
    type GridCelda,
  } from "../../lib/instrumentoPlantilla";
  import { INSTRUMENTO_OPS, type InstrumentoTipo } from "../../lib/instrumentosPdf";

  const ACENTO = "#38bdf8";

  interface FilaUI extends InstrumentoPlantilla {
    def: PlantillaDefinicion;
  }

  let plantillas = $state<FilaUI[]>([]);
  let cargando = $state(false);

  // Estado del editor. `editando` = modal abierto.
  let editandoId = $state(0);
  let editando = $state(false);
  let editNombre = $state("");
  let editTipo = $state<InstrumentoTipo>("escala");
  let editDef = $state<PlantillaDefinicion>(defaultDefinicion());
  let guardando = $state(false);
  let borrandoId = $state(0);

  // Celda seleccionada de la cuadrícula (para fusionar/borrar/arriba).
  let selR = $state(0);
  let selC = $state(0);

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
    selR = 0; selC = 0;
    editando = true;
  }

  function abrirEditar(p: FilaUI) {
    editandoId = p.id;
    editNombre = p.nombre;
    editTipo = p.tipo;
    editDef = { ...defaultDefinicion(p.tipo), ...p.def };
    selR = 0; selC = 0;
    editando = true;
  }

  function cerrarEditor() {
    editando = false;
  }

  function cambiarTipo(nuevo: InstrumentoTipo) {
    editTipo = nuevo;
  }

  // ════════════════ Cuadrícula tipo Excel ════════════════

  const grid = (): PlantillaGrid => editDef.grid ?? gridPresetChecklist();

  function mutarGrid(fn: (g: PlantillaGrid) => void) {
    const g = { ...grid(), celdas: { ...grid().celdas } };
    fn(g);
    editDef = { ...editDef, grid: g };
  }

  const kOf = (r: number, c: number): string => `${r}:${c}`;

  /** Posiciones CUBIERTAS por un merge (claves "r:c" → celda dueña). */
  function cubiertos(g: PlantillaGrid): Map<string, [number, number]> {
    const m = new Map<string, [number, number]>();
    for (const [k, cel] of Object.entries(g.celdas)) {
      const [r, c] = k.split(":").map(Number);
      const cs = cel.cs ?? 1;
      const rs = cel.rs ?? 1;
      for (let rr = r; rr < Math.min(r + rs, g.filas); rr++) {
        for (let cc = c; cc < Math.min(c + cs, g.cols); cc++) {
          if (rr !== r || cc !== c) m.set(`${rr}:${cc}`, [r, c]);
        }
      }
    }
    return m;
  }

  function setCeldaVal(r: number, c: number, v: string) {
    const g = grid();
    mutarGrid(cg => { cg.celdas[kOf(r, c)] = { ...cg.celdas[kOf(r, c)] ?? { v: "" }, v }; });
    void g;
  }

  /** Fusiona la celda seleccionada: → derecha, ↓ abajo, o deshacer. */
  function fusionar(dir: "der" | "ab" | "no") {
    const g = grid();
    const key = kOf(selR, selC);
    const cel = g.celdas[key];
    if (dir === "no") {
      mutarGrid(cg => {
        const c2 = { ...cel };
        delete c2.cs; delete c2.rs;
        if (!c2.v) delete cg.celdas[key]; else cg.celdas[key] = c2;
      });
      return;
    }
    // La celda destino no debe estar ya cubierta por otro merge.
    const cov = cubiertos(g);
    if (cov.has(key)) return;
    if (dir === "der") {
      const nuevoCs = Math.min((cel?.cs ?? 1) + 1, g.cols - selC);
      mutarGrid(cg => {
        cg.celdas[key] = { ...(cel ?? { v: "" }), cs: nuevoCs };
        // Al expandir se pierde la celda engranada debajo.
        for (let cc = selC + 1; cc < selC + nuevoCs; cc++) {
          const kk = kOf(selR, cc);
          if (!cov.has(kk)) delete cg.celdas[kk];
        }
      });
      return;
    }
    const nuevoRs = Math.min((cel?.rs ?? 1) + 1, g.filas - selR);
    mutarGrid(cg => {
      cg.celdas[key] = { ...(cel ?? { v: "" }), rs: nuevoRs };
      for (let rr = selR + 1; rr < selR + nuevoRs; rr++) {
        const kk = kOf(rr, selC);
        if (!cov.has(kk)) delete cg.celdas[kk];
      }
    });
  }

  function toggleFilaEstudiantes() {
    mutarGrid(cg => {
      cg.filaEstudiantes = cg.filaEstudiantes === selR ? -1 : selR;
    });
  }

  function addFila() {
    mutarGrid(cg => { cg.filas += 1; });
  }

  function delFila(r: number) {
    const g = grid();
    if (g.filas <= 1) return;
    mutarGrid(cg => {
      const nd: Record<string, GridCelda> = {};
      for (const [kk, celOrig] of Object.entries(cg.celdas)) {
        const cel = { ...celOrig };
        let [rr, cc] = kk.split(":").map(Number);
        const rs = cel.rs ?? 1;
        // Fila borrada dentro del merge: recortar rowspan si empieza arriba.
        if (rr === r) continue; // celda que arranca en la fila borrada
        if (rr < r && rr + rs > r) cel.rs = rs - 1; // merge cruzaba la fila
        if (rr > r) rr -= 1;
        nd[`${rr}:${cc}`] = cel;
      }
      cg.celdas = nd;
      cg.filas -= 1;
      if (cg.filaEstudiantes === r) cg.filaEstudiantes = -1;
      else if (cg.filaEstudiantes > r) cg.filaEstudiantes -= 1;
      if (selR >= cg.filas) selR = Math.max(0, cg.filas - 1);
    });
  }

  function addCol() {
    mutarGrid(cg => { cg.cols += 1; });
  }

  function delCol(c: number) {
    const g = grid();
    if (g.cols <= 1) return;
    mutarGrid(cg => {
      const nd: Record<string, GridCelda> = {};
      for (const [kk, celOrig] of Object.entries(cg.celdas)) {
        const cel = { ...celOrig };
        let [rr, cc] = kk.split(":").map(Number);
        const cs = cel.cs ?? 1;
        if (cc === c) continue;
        if (cc < c && cc + cs > c) cel.cs = cs - 1; // merge cruzaba la col
        if (cc > c) cc -= 1;
        nd[`${rr}:${cc}`] = cel;
      }
      cg.celdas = nd;
      cg.cols -= 1;
      if (selC >= cg.cols) selC = Math.max(0, cg.cols - 1);
    });
  }

  /** Conmuta la fila seleccionada como fila de estudiantes (toggle). */

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
            <div class="pl-card-barra"></div>
            <div style="padding:0.9rem 0.9rem 0.7rem 1.2rem;display:flex;flex-direction:column;gap:0.5rem;flex:1;min-width:0;">
              <span style="color:#f1f5f9;font-size:0.9rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{p.nombre}</span>
              <span class="pl-tipo">{t('pl.tipo')}: {labelTipo(p.tipo)}</span>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap;font-size:0.66rem;color:#94a3b8;">
                <span>{t('pl.hint.colFinal')}: {p.def.colFinal === 'total' ? t('pl.opt.total') : p.def.colFinal === 'ninguno' ? t('pl.opt.ninguno') : t('pl.opt.valoracion')}</span>
                {#if p.def.orientacion !== 'auto'}<span>· {p.def.orientacion === 'horizontal' ? t('pl.opt.horizontal') : t('pl.opt.vertical')}</span>{/if}
              </div>
            </div>
            <div style="display:flex;gap:0.4rem;padding:0 0.9rem 0.8rem 0.9rem;">
              <button class="pl-btn" onclick={() => abrirEditar(p)} title={t('pl.editar')}>✎</button>
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

<!-- ── Constructor: cuadrícula tipo Excel (modal) ── -->
{#if editando}
  <div class="modal-overlay" onpointerdown={(e) => { if (e.target === e.currentTarget) cerrarEditor(); }}>
    <div class="modal-capa">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;">
        <h3 style="margin:0;color:#f1f5f9;font-size:1.05rem;font-weight:700;">
          {editandoId ? t('pl.editor.tituloEditar') : t('pl.editor.tituloCrear')}
        </h3>
        <button onclick={cerrarEditor} style="background:transparent;border:none;color:#64748b;font-size:1.2rem;cursor:pointer;">✕</button>
      </div>

      <!-- Nombre + tipo + orientación -->
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.7rem;">
        <div style="flex:1;min-width:200px;">
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
          <label class="pl-label">{t('pl.editor.orientacion')}</label>
          <div class="pl-seg">
            <button class="pl-seg-btn" class:activo={editDef.orientacion === 'auto'} onclick={() => cambiar('orientacion', 'auto')}>{t('pl.opt.auto')}</button>
            <button class="pl-seg-btn" class:activo={editDef.orientacion === 'horizontal'} onclick={() => cambiar('orientacion', 'horizontal')}>{t('pl.opt.horizontal')}</button>
            <button class="pl-seg-btn" class:activo={editDef.orientacion === 'vertical'} onclick={() => cambiar('orientacion', 'vertical')}>{t('pl.opt.vertical')}</button>
          </div>
        </div>
      </div>

      <!-- Barra de herramientas de la cuadrícula -->
      <div class="gr-toolbar">
        <button class="gr-tool" onclick={addFila} title={t('pl.grid.addFila')}>➕{t('pl.grid.fila')}</button>
        <button class="gr-tool" onclick={addCol} title={t('pl.grid.addCol')}>➕{t('pl.grid.col')}</button>
        <span class="gr-sep"></span>
        <button class="gr-tool" onclick={() => fusionar('der')} title={t('pl.grid.mDer')}>→⇥ {t('pl.grid.fusion')}</button>
        <button class="gr-tool" onclick={() => fusionar('ab')} title={t('pl.grid.mAb')}>↓⇩ {t('pl.grid.fusion')}</button>
        <button class="gr-tool" onclick={() => fusionar('no')} title={t('pl.grid.mNo')}>✕ {t('pl.grid.desfus')}</button>
        <span class="gr-sep"></span>
        <button class="gr-tool" class:gr-tool-on={grid().filaEstudiantes === selR} onclick={toggleFilaEstudiantes}>
          🧑 {t('pl.grid.filaEst')} {grid().filaEstudiantes === selR ? '✓' : ''}
        </button>
        <select class="gr-tool gr-token"
          onchange={(e) => {
            const el = e.currentTarget as HTMLSelectElement;
            const tk = el.value;
            if (!tk) return;
            setCeldaVal(selR, selC, ((grid().celdas[kOf(selR, selC)]?.v ?? '') || '') + tk);
            el.selectedIndex = 0;
          }}>
          <option value="">🪄 {t('pl.grid.tokens')}</option>
          <option value="{COLEGIO}">{t('pl.tok.colegio')}</option>
          <option value="{GRADO}">{t('pl.tok.grado')}</option>
          <option value="{SECCION}">{t('pl.tok.seccion')}</option>
          <option value="{ASIGNATURA}">{t('pl.tok.asignatura')}</option>
          <option value="{CORTE}">{t('pl.tok.corte')}</option>
          <option value="{ANO}">{t('pl.tok.ano')}</option>
          <option value="{FECHA}">{t('pl.tok.fecha')}</option>
          <option value="{IND_N}">{t('pl.tok.indN')}</option>
          <option value="{IND_DESC}">{t('pl.tok.indDesc')}</option>
          <option value="{CRIT_1}">{t('pl.tok.crit')} 1</option>
          <option value="{CRIT_2}">{t('pl.tok.crit')} 2</option>
          <option value="{CRIT_3}">{t('pl.tok.crit')} 3</option>
          <option value="{CRIT_4}">{t('pl.tok.crit')} 4</option>
          <option value="{CRIT_5}">{t('pl.tok.crit')} 5</option>
          <option value="{N}">{t('pl.tok.num')}</option>
          <option value="{ESTUDIANTE}">{t('pl.tok.estudiante')}</option>
          <option value="{LETRA_1}">{t('pl.tok.letra')} 1</option>
          <option value="{LETRA_2}">{t('pl.tok.letra')} 2</option>
          <option value="{LETRA_3}">{t('pl.tok.letra')} 3</option>
          <option value="{VALORACION}">{t('pl.tok.valoracion')}</option>
        </select>
      </div>

      <!-- Cuadrícula editable en vivo -->
      <div class="gr-wrap">
        <table class="gr-tabla">
          <thead>
            <tr>
              <th class="gr-head"></th>
              {#each Array(grid().cols) as _, ci (ci)}
                <th class="gr-head" onclick={() => { selC = ci; }}>{ci + 1}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each Array(grid().filas) as _, ri (ri)}
              {@const cov = cubiertos(grid())}
              <tr class:est={grid().filaEstudiantes === ri}>
                <th class="gr-head gr-head-row" class:activa={grid().filaEstudiantes === ri}
                  onclick={() => { selR = ri; }}>
                  {grid().filaEstudiantes === ri ? '🧑' : ri + 1}
                </th>
                {#each Array(grid().cols) as _, ci (ci)}
                  {@if !cov.has(`${ri}:${ci}`)}
                    {@const cel = grid().celdas[kOf(ri, ci)]}
                    <td colspan={cel?.cs ?? 1} rowspan={cel?.rs ?? 1}
                      class:sel={selR === ri && selC === ci}
                      class:est={grid().filaEstudiantes === ri}
                      onpointerdown={() => { selR = ri; selC = ci; }}>
                      <div class="gr-celda" contenteditable="true"
                        onblur={(e) => setCeldaVal(ri, ci, (e.currentTarget as HTMLElement).innerText)}
                        onkeydown={(e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}>
                        {cel?.v ?? ''}
                      </div>
                    </td>
                  {/if}
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Borrar fila/col de la selección -->
      <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
        <button class="gr-tool" class:gr-tool-rojo={true} onclick={() => delFila(selR)} disabled={grid().filas <= 1}>🗑 {t('pl.grid.delFila')}</button>
        <button class="gr-tool" class:gr-tool-rojo={true} onclick={() => delCol(selC)} disabled={grid().cols <= 1}>🗑 {t('pl.grid.delCol')}</button>
        <span style="flex:1;"></span>
        <span style="align-self:center;color:#64748b;font-size:0.66rem;">{t('pl.grid.selpos')} {selR + 1}×{selC + 1}</span>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:0.6rem;margin-top:0.9rem;">
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
  }
  .pl-card:hover { border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.05); }
  .pl-card-barra { position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: #38bdf8; opacity: 0.8; }
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
    background: rgba(20,24,31,0.92); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(56,189,248,0.2); border-radius: 20px;
    padding: 1.1rem 1.3rem 1.3rem 1.3rem; width: min(1050px, 97vw); max-height: 92vh; overflow-y: auto;
    box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);
  }

  /* ══ Cuadrícula tipo Excel ══ */
  .gr-toolbar {
    display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;
    padding: 0.5rem 0.6rem; margin-bottom: 0.5rem;
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
  }
  .gr-tool {
    padding: 0.35rem 0.65rem; border-radius: 8px; font-size: 0.72rem; font-weight: 600;
    border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);
    color: #cbd5e1; cursor: pointer; transition: all 0.15s ease; white-space: nowrap;
  }
  .gr-tool:hover { border-color: rgba(56,189,248,0.4); color: #7dd3fc; }
  .gr-tool-on { background: rgba(56,189,248,0.2); border-color: rgba(56,189,248,0.5); color: #bae6fd; }
  .gr-tool-rojo:hover { border-color: rgba(239,68,68,0.5); color: #fca5a5; }
  .gr-tool-rojo:disabled { opacity: 0.4; cursor: not-allowed; }
  .gr-sep { width: 1px; height: 1.2rem; background: rgba(255,255,255,0.12); }
  .gr-token { color-scheme: dark; }

  .gr-wrap {
    overflow-x: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
    background: rgba(255,255,255,0.02);
  }
  .gr-tabla { border-collapse: collapse; width: 100%; min-width: 640px; table-layout: fixed; }
  .gr-head {
    width: 1.6rem; padding: 0.15rem 0.2rem; font-size: 0.58rem; font-weight: 600;
    color: #475569; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
    cursor: pointer; text-align: center; user-select: none;
  }
  .gr-head-row.activa { background: rgba(56,189,248,0.25); color: #bae6fd; }
  .gr-tabla tr.est .gr-head-row { background: rgba(56,189,248,0.15); }
  .gr-tabla td {
    border: 1px solid rgba(255,255,255,0.12); padding: 0; vertical-align: top;
    min-width: 3.2rem;
  }
  .gr-tabla td.sel { outline: 2px solid #38bdf8; outline-offset: -2px; }
  .gr-celda {
    min-height: 1.7rem; padding: 0.25rem 0.4rem; font-size: 0.74rem; color: #e2e8f0;
    outline: none; cursor: text; overflow-wrap: anywhere;
  }
  .gr-celda:focus { background: rgba(56,189,248,0.08); }
  .gr-tabla td.est .gr-celda { color: #7dd3fc; }
  .gr-tabla tr.est td { background: rgba(56,189,248,0.06); }

  .pl-btn-cancelar {
    padding: 0.55rem 1.1rem; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);
    background: transparent; color: #94a3b8; font-size: 0.8rem; font-weight: 600; cursor: pointer;
    transition: all 0.2s ease;
  }
  .pl-btn-cancelar:hover { color: #e2e8f0; border-color: rgba(255,255,255,0.25); }
  .pl-btn-guardar {
    padding: 0.55rem 1.4rem; border-radius: 10px; border: none;
    background: linear-gradient(135deg,#38bdf8,#0284c7); color: #fff; font-size: 0.8rem;
    font-weight: 700; cursor: pointer; box-shadow: 0 6px 22px rgba(56,189,248,0.3);
    transition: all 0.2s ease;
  }
  .pl-btn-guardar:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
