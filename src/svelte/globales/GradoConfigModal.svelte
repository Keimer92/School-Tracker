<script lang="ts">
  /**
   * GradoConfigModal — asignaturas (currículo) de un grado.
   *
   * Extraido de GlobalesPage.svelte, que no estaba montado en ningun sitio, asi
   * que el boton ⚙️ de la card de Grado no se renderizaba nunca en la UI real.
   */
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { onDataChange } from "../../lib/autoSync";
  import { portalToBody } from "../../lib/portalToBody";

  export interface GradoItem { id: number; nombre: string; cualitativo?: boolean; }
  interface AsignaturaItem { id: number; nombre: string; }

  let { grado = null, onClose }: { grado?: GradoItem | null; onClose?: () => void } = $props();

  let todasAsignaturas = $state<AsignaturaItem[]>([]);
  let asignadasIds = $state<number[]>([]);
  let original = $state("");
  let saving = $state(false);

  let dirty = $derived(grado !== null && JSON.stringify(asignadasIds) !== original);

  // El efecto solo lee `grado`; escribir el resto no lo invalida.
  $effect(() => {
    const g = grado;
    if (!g) return;
    Promise.all([
      invoke<AsignaturaItem[]>("get_asignaturas"),
      invoke<AsignaturaItem[]>("get_subjects_by_grade", { gradoId: g.id }),
    ])
      .then(([todas, asignadas]) => {
        todasAsignaturas = todas;
        asignadasIds = asignadas.map(s => s.id);
        original = JSON.stringify(asignadasIds);
      })
      .catch(e => console.error("[GradoConfig]Subjects:", e));
  });

  function cerrar() {
    if (!dirty) { onClose?.(); return; }
    ask("Hay cambios sin guardar en este modal.\n¿Descartarlos?", {
      title: "Cambios sin guardar", kind: "warning", okLabel: "Descartar", cancelLabel: "Seguir editando",
    }).then(ok => { if (ok) onClose?.(); });
  }

  function toggle(id: number) {
    asignadasIds = asignadasIds.includes(id) ? asignadasIds.filter(x => x !== id) : [...asignadasIds, id];
  }

  async function guardar() {
    if (!grado || !dirty) return;
    if (!await ask(`¿Aplicar los cambios de currículo de "${grado.nombre}"?`, { title: "Confirmar cambios", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar" })) return;
    saving = true;
    try {
      const prev: number[] = JSON.parse(original);
      for (const id of asignadasIds) {
        if (!prev.includes(id)) await invoke("assign_subject_to_grade", { gradoId: grado.id, asignaturaId: id });
      }
      for (const id of prev) {
        if (!asignadasIds.includes(id)) await invoke("unassign_subject_from_grade", { gradoId: grado.id, asignaturaId: id });
      }
      original = JSON.stringify(asignadasIds);
      onDataChange("grado_asignatura");
      await emit("show-toast", { message: "✅ Currículo guardado", type: "success" });
      await emit("subjects-updated");
    } catch (e) { await emit("show-toast", { message: "❌ Error al guardar currículo: " + e, type: "error" }); }
    finally { saving = false; }
  }
</script>

{#if grado}
  <div class="modal-overlay" use:portalToBody onclick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
    <div class="modal-content category-card" style="max-width: 480px; width: 95%;">
      <div class="category-header" style="justify-content: space-between;">
        <h3 style="margin: 0; font-size: 1.1rem;">⚙️ {grado.nombre} — Asignaturas</h3>
        <button onclick={cerrar} style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.2rem;">✕</button>
      </div>

      <div style="padding:0.5rem 1rem 1rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
          <span style="font-size:0.8rem;font-weight:700;color:#e2e8f0;">📚 Asignaturas</span>
          <div style="display:flex;gap:0.3rem;">
            <button onclick={() => asignadasIds = todasAsignaturas.map(s => s.id)} class="bulk-on">Todas</button>
            <button onclick={() => asignadasIds = []} class="bulk-off">Ninguna</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.4rem;max-height:300px;overflow-y:auto;">
          {#each todasAsignaturas as sub (sub.id)}
            {@const on = asignadasIds.includes(sub.id)}
            <button class="item-row grade-row" class:on onclick={() => toggle(sub.id)}>
              <span class="switch" style="pointer-events:none;">
                <span class="slider round" class:on={on}></span>
              </span>
              <span class="grade-label" class:on>{sub.nombre}</span>
            </button>
          {/each}
        </div>
        {#if dirty}
          <button onclick={guardar} disabled={saving} class="save-verde">
            {saving ? '⏳ Guardando...' : '💾 Guardar asignaturas'}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .grade-row {
    width: 100%; text-align: left; cursor: pointer;
    display: flex; align-items: center; gap: 10px;
    padding: 0.5rem 0.65rem; border-radius: 8px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    transition: all 0.2s ease;
  }
  .grade-row.on { border-color: rgba(74,222,128,0.3); }
  .grade-row:hover { background: rgba(255,255,255,0.06); }
  .grade-label { flex: 1; min-width: 0; font-size: 0.85rem; font-weight: 500; color: #94a3b8; }
  .grade-label.on { font-weight: 700; color: #4ade80; }

  .switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; border: none; background: none; padding: 0; cursor: pointer; }
  .slider { position: absolute; inset: 0; background: rgba(255,255,255,0.14); border-radius: 999px; transition: all 0.25s ease; }
  .slider::before {
    content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 50%;
    transform: translateY(-50%); background: #cbd5e1; border-radius: 50%; transition: all 0.25s ease;
  }
  .slider.on { background: linear-gradient(135deg,#22c55e,#16a34a); }
  .slider.on::before { transform: translateY(-50%) translateX(18px); background: #fff; }

  .bulk-on, .bulk-off {
    padding: 0.3rem 0.6rem; font-size: 0.7rem; border-radius: 6px; cursor: pointer; font-weight: 600;
    border: 1px solid rgba(var(--primary-rgb),0.3); background: rgba(var(--primary-rgb),0.1); color: var(--primary-color);
  }
  .bulk-off { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: #fca5a5; }

  .save-verde {
    margin-top: 0.75rem; width: 100%; padding: 0.6rem 1.25rem; border-radius: 10px; border: none;
    background: linear-gradient(135deg,#22c55e,#16a34a); color: white; font-weight: 700; font-size: 0.85rem;
    cursor: pointer; box-shadow: 0 4px 14px rgba(34,197,94,0.3);
  }
  .save-verde:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
