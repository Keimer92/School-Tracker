<script lang="ts">
  /**
   * ColegioConfigModal — configuracion unificada de un colegio, en 4 pestañas:
   *   🏫 Tipo        Primaria / Secundaria (define que grados ofrece)
   *   📅 Días        dias de clase (lunes a viernes)
   *   📚 Asignaturas que ofrece el colegio
   *   📊 Grados      activar/desactivar y marcar cualitativo por colegio
   *
   * Extraido de GlobalesPage.svelte, que NO estaba montado en ningun sitio: la
   * UI real de catalogos vive en ConfiguracionPage -> CategoryTabContent, y ahi
   * el boton ⚙️ solo aparece si se le pasa `onConfigClick`. Sin ese handler el
   * boton ni se renderizaba, asi que estas opciones habian desaparecido de la UI.
   *
   * Los toggles usan el patron de AGENTS.md: no hay `<input type=checkbox>`
   * controlable, la fila entera es el boton y el estado vive en el array/objeto.
   * El `switch` visual es decorativo (`pointer-events:none`).
   */
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { onDataChange } from "../../lib/autoSync";
  import { portalToBody } from "../../lib/portalToBody";

  export interface ColegioItem { id: number; nombre: string; cualitativo?: boolean; }
  interface AsignaturaItem { id: number; nombre: string; cualitativo?: boolean; }
  interface ColegioDiasAsistencia {
    colegioId: number; lunes: boolean; martes: boolean; miercoles: boolean;
    jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean;
  }
  interface ColegioGrado { id: number; nombre: string; activo: boolean; cualitativo: boolean; }
  type Dia = keyof Omit<ColegioDiasAsistencia, "colegioId">;

  let { colegio = null, onClose }: { colegio?: ColegioItem | null; onClose?: () => void } = $props();

  const DIAS: Dia[] = ["lunes", "martes", "miercoles", "jueves", "viernes"];
  const TABS = [
    { id: "tipo", label: "🏫 Tipo" },
    { id: "dias", label: "📅 Días" },
    { id: "asignaturas", label: "📚 Asignaturas" },
    { id: "grados", label: "📊 Grados" },
  ] as const;
  type TabId = typeof TABS[number]["id"];

  let tab = $state<TabId>("tipo");
  let nombreEdit = $state("");
  let tipo = $state("Primaria");
  let dias = $state<ColegioDiasAsistencia | null>(null);
  let diasOriginal = $state("");
  let todasAsignaturas = $state<AsignaturaItem[]>([]);
  let asignadasIds = $state<number[]>([]);
  let asignadasOriginal = $state("");
  let grados = $state<ColegioGrado[]>([]);
  let gradosActivoOriginal = $state<Record<number, boolean>>({});
  let gradosCualOriginal = $state<Record<number, boolean>>({});
  let asignaturasCualOriginal = $state<Record<number, boolean>>({});
  let catalogoGrados = $state<Record<number, { nombre: string; cualitativo: boolean }>>({});
  let saving = $state(false);

  let diasDirty = $derived(dias !== null && JSON.stringify(dias) !== diasOriginal);
  let asignaturasDirty = $derived(
    colegio !== null &&
    (JSON.stringify(asignadasIds) !== asignadasOriginal ||
      todasAsignaturas.some(s => asignaturasCualOriginal[s.id] !== !!s.cualitativo))
  );
  let gradosDirty = $derived(
    colegio !== null &&
    grados.some(g => gradosActivoOriginal[g.id] !== g.activo || gradosCualOriginal[g.id] !== g.cualitativo)
  );
  let hayCambios = $derived(diasDirty || asignaturasDirty || gradosDirty);

  // Carga al abrir (o al cambiar de colegio). El efecto solo lee `colegio`, asi
  // que escribir el resto del estado NO lo invalida (no hace falta untrack).
  $effect(() => {
    const c = colegio;
    if (!c) return;
    tab = "tipo";
    nombreEdit = c.nombre;
    invoke("get_colegio_dias_asistencia", { colegioId: c.id })
      .then((cfg) => {
        // Sabado/domingo se fuerzan a false: no forman parte del selector.
        dias = { ...(cfg as ColegioDiasAsistencia), sabado: false, domingo: false };
        diasOriginal = JSON.stringify(dias);
      })
      .catch(e => console.error("[ColegioConfig] días:", e));
    invoke<ColegioItem[]>("get_colegios")
      .then(cols => { tipo = (cols.find(x => x.id === c.id) as any)?.tipo || "Primaria"; })
      .catch(() => {});
    Promise.all([
      invoke<AsignaturaItem[]>("get_asignaturas"),
      invoke<AsignaturaItem[]>("get_subjects_by_colegio", { colegioId: c.id }),
    ])
      .then(([todas, asignadas]) => {
        todasAsignaturas = todas;
        asignadasIds = asignadas.map(s => s.id);
        asignadasOriginal = JSON.stringify(asignadasIds);
        const mapa: Record<number, boolean> = {};
        for (const s of todas) mapa[s.id] = !!s.cualitativo;
        asignaturasCualOriginal = mapa;
      })
      .catch(e => console.error("[ColegioConfig] asignaturas:", e));

    // El CUALITATIVO de un grado es GLOBAL (`grado.cualitativo`), no por colegio:
    // es lo que leen NotasPage, ReportesPage, EvaluacionesPage y los PDF. Por eso
    // se trae el catalogo y se pisa el valor que devuelven las columnas
    // `colegio_grado` (que nadie leia y por eso se desincronizaba).
    Promise.all([
      invoke<ColegioGrado[]>("get_grados_config_by_colegio", { colegioId: c.id }),
      invoke<{ id: number; nombre: string; cualitativo: boolean }[]>("get_grados"),
    ])
      .then(([porColegio, catalogo]) => {
        const mapa: Record<number, { nombre: string; cualitativo: boolean }> = {};
        for (const g of catalogo) mapa[g.id] = { nombre: g.nombre, cualitativo: !!g.cualitativo };
        catalogoGrados = mapa;
        const lista = porColegio.map(g => ({ ...g, cualitativo: mapa[g.id]?.cualitativo ?? false }));
        grados = lista;
        const act: Record<number, boolean> = {};
        const cua: Record<number, boolean> = {};
        for (const g of lista) { act[g.id] = g.activo; cua[g.id] = g.cualitativo; }
        gradosActivoOriginal = act;
        gradosCualOriginal = cua;
      })
      .catch(e => console.error("[ColegioConfig] grados:", e));
  });

  /** Cierra el modal; si hay cambios sin guardar, pregunta. */
  export function cerrar() {
    if (!hayCambios) { onClose?.(); return; }
    ask("Hay cambios sin guardar en este modal.\n¿Descartarlos?", {
      title: "Cambios sin guardar", kind: "warning", okLabel: "Descartar", cancelLabel: "Seguir editando",
    }).then(ok => { if (ok) onClose?.(); });
  }

  function toggleDia(day: Dia) {
    if (!dias) return;
    dias = { ...dias, [day]: !dias[day] };
  }
  function bulkDias(marcar: boolean) {
    if (!dias) return;
    dias = { ...dias, lunes: marcar, martes: marcar, miercoles: marcar, jueves: marcar, viernes: marcar, sabado: false, domingo: false };
  }
  function toggleAsignatura(id: number) {
    asignadasIds = asignadasIds.includes(id) ? asignadasIds.filter(x => x !== id) : [...asignadasIds, id];
  }
  function toggleGradoActivo(g: ColegioGrado) {
    grados = grados.map(x => x.id === g.id ? { ...x, activo: !x.activo } : x);
  }
  function toggleGradoCualitativo(g: ColegioGrado) {
    grados = grados.map(x => x.id === g.id ? { ...x, cualitativo: !x.cualitativo } : x);
  }

  async function guardarDias() {
    if (!dias || !colegio || !diasDirty) return;
    if (!await ask(`¿Aplicar la configuración de días de "${colegio.nombre}"?`, { title: "Confirmar cambios", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar" })) return;
    saving = true;
    try {
      await invoke("save_colegio_dias_asistencia", { config: dias });
      diasOriginal = JSON.stringify(dias);
      onDataChange("colegio_dias_asistencia");
      await emit("show-toast", { message: "✅ Configuración guardada", type: "success" });
      await emit("catalog-updated");
    } catch (e) { await emit("show-toast", { message: "❌ Error guardando configuración: " + e, type: "error" }); }
    finally { saving = false; }
  }

  function toggleAsignaturaCualitativo(s: AsignaturaItem) {
    todasAsignaturas = todasAsignaturas.map(x => x.id === s.id ? { ...x, cualitativo: !x.cualitativo } : x);
  }

  async function guardarAsignaturas() {
    if (!colegio || !asignaturasDirty) return;
    if (!await ask(`¿Aplicar las asignaturas de "${colegio.nombre}"?`, { title: "Confirmar cambios", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar" })) return;
    saving = true;
    try {
      const prev: number[] = JSON.parse(asignadasOriginal);
      for (const id of asignadasIds) {
        if (!prev.includes(id)) await invoke("assign_subject_to_colegio", { colegioId: colegio.id, asignaturaId: id });
      }
      for (const id of prev) {
        if (!asignadasIds.includes(id)) await invoke("unassign_subject_from_colegio", { colegioId: colegio.id, asignaturaId: id });
      }
      // El cualitativo de la asignatura tambien es GLOBAL (`asignatura.cualitativo`).
      const mapa: Record<number, boolean> = {};
      let tocoCualitativo = false;
      for (const s of todasAsignaturas) {
        if (asignaturasCualOriginal[s.id] !== !!s.cualitativo) {
          await invoke("update_asignatura", { id: s.id, nombre: s.nombre, cualitativo: !!s.cualitativo });
          tocoCualitativo = true;
        }
        mapa[s.id] = !!s.cualitativo;
      }
      asignadasOriginal = JSON.stringify(asignadasIds);
      asignaturasCualOriginal = mapa;
      onDataChange("colegio_asignatura");
      if (tocoCualitativo) onDataChange("asignatura", { immediate: true });
      await emit("show-toast", { message: "✅ Asignación guardada", type: "success" });
      await emit("subjects-updated");
      await emit("catalog-updated");
    } catch (e) { await emit("show-toast", { message: "❌ Error al guardar asignación: " + e, type: "error" }); }
    finally { saving = false; }
  }

  async function guardarGrados() {
    if (!colegio || !gradosDirty) return;
    if (!await ask(`¿Aplicar los grados de "${colegio.nombre}"?`, { title: "Confirmar cambios", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar" })) return;
    saving = true;
    try {
      const act: Record<number, boolean> = {};
      const cua: Record<number, boolean> = {};
      let tocoCualitativo = false;
      for (const g of grados) {
        // `activo` vive en colegio_grado (por colegio); `cualitativo` se espeja
        // desde el global para que la columna duplicada no quede obsoleta.
        await invoke("set_colegio_grado", { colegioId: colegio.id, gradoId: g.id, activo: g.activo, cualitativo: g.cualitativo });
        if (gradosCualOriginal[g.id] !== g.cualitativo) {
          const cat = catalogoGrados[g.id];
          await invoke("update_grado", { id: g.id, nombre: cat?.nombre ?? g.nombre, cualitativo: g.cualitativo });
          tocoCualitativo = true;
        }
        act[g.id] = g.activo;
        cua[g.id] = g.cualitativo;
      }
      gradosActivoOriginal = act;
      gradosCualOriginal = cua;
      onDataChange("colegio_grado");
      if (tocoCualitativo) onDataChange("grado", { immediate: true });
      await emit("show-toast", { message: "✅ Grados guardados", type: "success" });
      await emit("catalog-updated");
    } catch (e) { await emit("show-toast", { message: "❌ Error guardando grados: " + e, type: "error" }); }
    finally { saving = false; }
  }

  async function eliminarGrado(g: ColegioGrado) {
    if (!colegio) return;
    if (!await ask(`¿Eliminar "${g.nombre}" de "${colegio.nombre}"?\n\nEl grado dejará de estar disponible en este colegio.`, { title: "Eliminar grado", kind: "warning", okLabel: "Eliminar", cancelLabel: "Cancelar" })) return;
    try {
      await invoke("delete_colegio_grado", { colegioId: colegio.id, gradoId: g.id });
      grados = grados.filter(x => x.id !== g.id);
      // Se actualizan las dos bases de comparacion (activo y cualitativo).
      delete gradosActivoOriginal[g.id];
      delete gradosCualOriginal[g.id];
      gradosActivoOriginal = { ...gradosActivoOriginal };
      gradosCualOriginal = { ...gradosCualOriginal };
      onDataChange("colegio_grado");
      await emit("catalog-updated");
      await emit("show-toast", { message: "🗑 Grado eliminado del colegio", type: "success" });
    } catch (e) { await emit("show-toast", { message: "❌ Error eliminando grado: " + e, type: "error" }); }
  }

  async function guardarTipo() {
    if (!colegio) return;
    saving = true;
    try {
      await invoke("update_colegio", { id: colegio.id, nombre: colegio.nombre, cualitativo: colegio.cualitativo || false, tipo });
      onDataChange("colegio");
      await emit("catalog-updated");
      await emit("show-toast", { message: "✅ Tipo de colegio guardado", type: "success" });
    } catch (e) { await emit("show-toast", { message: "❌ Error al guardar: " + e, type: "error" }); }
    finally { saving = false; }
  }

  async function guardarNombre() {
    if (!colegio || !nombreEdit.trim()) return;
    const nuevo = nombreEdit.trim();
    if (nuevo === colegio.nombre) return;
    saving = true;
    try {
      await invoke("update_colegio", { id: colegio.id, nombre: nuevo, cualitativo: colegio.cualitativo || false, tipo });
      onDataChange("colegio");
      await emit("catalog-updated");
      await emit("show-toast", { message: "✅ Nombre actualizado", type: "success" });
    } catch (e) { await emit("show-toast", { message: "❌ Error al renombrar: " + e, type: "error" }); }
    finally { saving = false; }
  }
</script>

{#if colegio}
  <!-- use:portalToBody: sin esto el overlay `fixed` queda atrapado por el
       backdrop-filter de los ancestros y no cubre la pantalla (AGENTS.md). -->
  <div class="modal-overlay" use:portalToBody onclick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
    <div class="modal-content category-card" style="max-width: 520px; width: 95%;">
      <div class="category-header" style="justify-content: space-between;">
        <h3 style="margin: 0; font-size: 1.1rem;">⚙️ {colegio.nombre}</h3>
        <button onclick={cerrar} style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.2rem;">✕</button>
      </div>

      <!-- Editar nombre -->
      <div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 1rem;margin-top:0.5rem;">
        <input bind:value={nombreEdit} placeholder="Nombre del colegio"
          style="flex:1;padding:0.45rem 0.7rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#e2e8f0;font-size:0.85rem;outline:none;" />
        {#if nombreEdit !== colegio.nombre}
          <button onclick={guardarNombre} disabled={saving}
            style="padding:0.45rem 0.8rem;border-radius:8px;border:none;background:linear-gradient(135deg,#818cf8,#6366f1);color:white;font-weight:600;font-size:0.78rem;cursor:pointer;white-space:nowrap;">
            {saving ? '...' : '💾 Renombrar'}
          </button>
        {/if}
      </div>

      <!-- Segmented control -->
      <div style="display:flex;gap:4px;padding:6px;margin:0.5rem 1rem 0;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
        {#each TABS as t}
          <button onclick={() => tab = t.id}
            style="flex:1;padding:0.45rem 0.5rem;border-radius:8px;border:none;font-size:0.78rem;font-weight:600;cursor:pointer;transition:all 0.2s;{tab === t.id ? 'background:linear-gradient(135deg,#34d399,#10b981);color:white;box-shadow:0 2px 8px rgba(52,211,153,0.3);' : 'background:transparent;color:#94a3b8;'}">{t.label}</button>
        {/each}
      </div>

      <div style="padding:0.5rem 1rem 1rem;">
        <!-- TIPO -->
        {#if tab === "tipo"}
          <div style="display:flex;flex-direction:column;gap:0.75rem;">
            <p style="margin:0;color:#94a3b8;font-size:0.8rem;">Define el nivel del colegio para filtrar grados automáticamente.</p>
            {#each [
              { value: "Primaria", label: "Primaria", desc: "1er grado a 6to grado", icon: "🏫", color: "#34d399" },
              { value: "Secundaria", label: "Secundaria", desc: "7mo grado a 11mo grado", icon: "🎓", color: "#818cf8" },
            ] as option}
              <button onclick={() => tipo = option.value}
                style="display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1rem;border-radius:12px;border:2px solid {tipo === option.value ? option.color : 'rgba(255,255,255,0.08)'};background:{tipo === option.value ? option.color + '18' : 'rgba(255,255,255,0.03)'};cursor:pointer;transition:all 0.2s;text-align:left;width:100%;">
                <div style="width:40px;height:40px;border-radius:10px;background:{option.color}22;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">{option.icon}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:700;color:{tipo === option.value ? option.color : '#e2e8f0'};font-size:0.9rem;">{option.label}</div>
                  <div style="color:#94a3b8;font-size:0.75rem;margin-top:2px;">{option.desc}</div>
                </div>
                {#if tipo === option.value}
                  <div style="width:22px;height:22px;border-radius:50%;background:{option.color};display:flex;align-items:center;justify-content:center;color:white;font-size:0.7rem;font-weight:700;flex-shrink:0;">✓</div>
                {/if}
              </button>
            {/each}
            <button onclick={guardarTipo} disabled={saving}
              style="margin-top:0.5rem;padding:0.6rem 1.25rem;border-radius:10px;border:none;background:linear-gradient(135deg,#34d399,#10b981);color:white;font-weight:700;font-size:0.85rem;cursor:pointer;box-shadow:0 4px 14px rgba(52,211,153,0.3);transition:all 0.2s;">
              {saving ? '⏳ Guardando...' : '💾 Guardar tipo'}
            </button>
          </div>

        <!-- DÍAS -->
        {:else if tab === "dias"}
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            <div style="display:flex;gap:0.4rem;margin-bottom:0.5rem;">
              <button onclick={() => bulkDias(true)} class="bulk-on">Marcar todos</button>
              <button onclick={() => bulkDias(false)} class="bulk-off">Desmarcar todos</button>
            </div>
            {#each DIAS as day}
              {@const on = dias?.[day] ?? false}
              <button class="item-row cc-row" class:on onclick={() => toggleDia(day)}>
                <span class="switch" style="pointer-events:none;">
                  <span class="slider round" class:on={on}></span>
                </span>
                <span class="cc-label" class:on>{day}</span>
              </button>
            {/each}
            {#if diasDirty}
              <button onclick={guardarDias} disabled={saving} class="save-verde">
                {saving ? '⏳ Guardando...' : '💾 Guardar días'}
              </button>
            {/if}
          </div>

        <!-- ASIGNATURAS -->
        {:else if tab === "asignaturas"}
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            <div style="display:flex;gap:0.4rem;margin-bottom:0.5rem;">
              <button onclick={() => asignadasIds = todasAsignaturas.map(s => s.id)} class="bulk-on" style="border-color:rgba(96,165,250,0.3);background:rgba(96,165,250,0.1);color:#60a5fa;">Marcar todas</button>
              <button onclick={() => asignadasIds = []} class="bulk-off">Desmarcar todas</button>
            </div>
            {#each todasAsignaturas as sub (sub.id)}
              {@const on = asignadasIds.includes(sub.id)}
              <div class="item-row cc-row" class:on>
                <!-- Dos controles independientes: la fila es `div` (no `button`)
                     porque anidar botones seria HTML invalido. -->
                <button class="cc-main" onclick={() => toggleAsignatura(sub.id)} title={on ? "Quitar del colegio" : "Agregar al colegio"}>
                  <span class="switch" style="pointer-events:none;">
                    <span class="slider round" class:on={on}></span>
                  </span>
                  <span class="cc-label" class:on>{sub.nombre}</span>
                </button>
                <button class="switch" title={sub.cualitativo ? "Quitar cualitativo" : "Marcar cualitativo"} onclick={() => toggleAsignaturaCualitativo(sub)}>
                  <span class="slider round cc-cual" class:on={!!sub.cualitativo}></span>
                </button>
              </div>
            {/each}
            {#if asignaturasDirty}
              <button onclick={guardarAsignaturas} disabled={saving} class="save-verde">
                {saving ? '⏳ Guardando...' : '💾 Guardar asignaturas'}
              </button>
            {/if}
          </div>

        <!-- GRADOS -->
        {:else if tab === "grados"}
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            <p style="margin:0;color:#94a3b8;font-size:0.78rem;">Activa o desactiva los grados que este colegio ofrece y marca los cualitativos. Los grados son fijos (según el tipo del colegio).</p>
            {#each grados as g (g.id)}
              <div class="item-row" style="gap:12px;padding:0.5rem 0.75rem;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);transition:all 0.2s;{!g.activo ? 'opacity:0.55;' : ''}">
                <button class="switch" title={g.activo ? "Desactivar grado" : "Activar grado"} onclick={() => toggleGradoActivo(g)}>
                  <span class="slider round" class:on={g.activo}></span>
                </button>
                <span style="flex:1;min-width:0;font-weight:{g.activo ? '700' : '500'};color:{g.activo ? '#e2e8f0' : '#94a3b8'};font-size:0.85rem;">{g.nombre}</span>
                <button class="switch" title={g.cualitativo ? "Quitar cualitativo" : "Marcar cualitativo"} onclick={() => toggleGradoCualitativo(g)}>
                  <span class="slider round cc-cual" class:on={g.cualitativo}></span>
                </button>
                <button onclick={() => eliminarGrado(g)} title="Eliminar grado del colegio" class="cc-del">🗑</button>
              </div>
            {:else}
              <p style="color:#64748b;font-size:0.8rem;text-align:center;padding:1rem;">No hay grados configurados para este colegio.</p>
            {/each}
            {#if gradosDirty}
              <button onclick={guardarGrados} disabled={saving} class="save-naranja">
                {saving ? '⏳ Guardando...' : '💾 Guardar grados'}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* La fila entera es el control (regla de toggles: nunca checkbox). */
  .cc-row {
    width: 100%; text-align: left;
    display: flex; align-items: center; gap: 12px;
    padding: 0.6rem 0.75rem; border-radius: 10px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    transition: all 0.2s ease;
  }
  .cc-row.on { border-color: rgba(74,222,128,0.3); }
  .cc-row:hover { background: rgba(255,255,255,0.06); }
  /* Zona principal de la fila (membresia); el cualitativo es un control aparte. */
  .cc-main {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px;
    background: none; border: none; padding: 0; cursor: pointer; text-align: left;
  }
  .cc-label { flex: 1; min-width: 0; font-size: 0.85rem; font-weight: 500; color: #94a3b8; text-transform: capitalize; }
  .cc-label.on { font-weight: 700; color: #4ade80; }

  /* Switch decorativo: el estado real vive en el array, no en el DOM. */
  .switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; border: none; background: none; padding: 0; cursor: pointer; }
  .slider { position: absolute; inset: 0; background: rgba(255,255,255,0.14); border-radius: 999px; transition: all 0.25s ease; }
  .slider::before {
    content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 50%;
    transform: translateY(-50%); background: #cbd5e1; border-radius: 50%;
    transition: all 0.25s ease;
  }
  .slider.on { background: linear-gradient(135deg,#22c55e,#16a34a); }
  .slider.on::before { transform: translateY(-50%) translateX(18px); background: #fff; }
  .slider.cc-cual.on { background: linear-gradient(135deg,#8b5cf6,#7c3aed); }

  .cc-del {
    background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2);
    border-radius: 7px; padding: 0.4rem 0.5rem; cursor: pointer; font-size: 1rem;
    transition: all 0.15s ease; flex-shrink: 0;
  }
  .cc-del:hover { background: rgba(239,68,68,0.2); }

  .bulk-on, .bulk-off {
    flex: 1; padding: 0.4rem; font-size: 0.75rem; border-radius: 8px; cursor: pointer; font-weight: 600;
    border: 1px solid rgba(52,211,153,0.3); background: rgba(52,211,153,0.1); color: #34d399;
  }
  .bulk-off { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #fca5a5; }

  .save-verde, .save-naranja {
    margin-top: 0.5rem; padding: 0.6rem 1.25rem; border-radius: 10px; border: none;
    color: white; font-weight: 700; font-size: 0.85rem; cursor: pointer;
  }
  .save-verde { background: linear-gradient(135deg,#22c55e,#16a34a); box-shadow: 0 4px 14px rgba(34,197,94,0.3); }
  .save-naranja { background: linear-gradient(135deg,#fb923c,#f97316); box-shadow: 0 4px 14px rgba(251,146,60,0.3); }
  .save-verde:disabled, .save-naranja:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
