<script lang="ts">
  /**
   * MultiplicadoresConfig — factor de ponderacion por criterio (tabla
   * `multiplicador_calificacion`).
   *
   * Extraido de NotasConfig.svelte. Antes esta card vivia pegada a la de
   * calificaciones y se guardaban juntas con un unico boton; ahora es un modulo
   * independiente con su propio estado y su propio guardado.
   *
   * Lee `get_grade_configs` solo para pintar el nombre y el color de cada
   * calificacion: son datos de SOLO LECTURA, no se editan desde aqui (eso lo
   * hace CalificacionesConfig), asi que no se sincronizan al guardar.
   */
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { onDataChange } from "../../lib/autoSync";
import { t } from "../../lib/i18n.svelte";

  interface MultiplicadorItem { id: string; multiplicador: number; }
  interface GradeRef { id: string; nombre: string; color: string; }

  let multiplicadores = $state<MultiplicadorItem[]>([]);
  let original = $state("");
  let // Solo lectura: para mostrar nombre/color de cada calificacion.
  ref = $state<GradeRef[]>([]);
  let saving = $state(false);

  let hasUnsaved = $derived(original !== JSON.stringify(multiplicadores));

  async function recargar() {
    try {
      const [mult, grades] = await Promise.all([
        invoke<MultiplicadorItem[]>("get_multiplicadores"),
        invoke<GradeRef[]>("get_grade_configs"),
      ]);
      multiplicadores = mult;
      original = JSON.stringify(multiplicadores);
      ref = grades;
    } catch (e) {
      console.error("[Multiplicadores] Error cargando:", e);
    }
  }
  recargar();

  function update(id: string, multiplicador: number) {
    if (multiplicador < 0 || multiplicador > 1) {
      emit("show-toast", { message: `El multiplicador debe estar entre 0 y 1 (recibido: ${multiplicador}). Se ajustó automáticamente.`, type: "error" });
    }
    const clamped = Math.max(0, Math.min(1, multiplicador));
    multiplicadores = multiplicadores.map(m => m.id === id ? { ...m, multiplicador: clamped } : m);
  }

  async function save() {
    if (!hasUnsaved) {
      await emit("show-toast", { message: "No hay cambios en los multiplicadores por guardar.", type: "info" });
      return;
    }
    saving = true;
    try {
      for (const m of multiplicadores) {
        await invoke("update_multiplicador", { id: m.id, multiplicador: m.multiplicador });
      }
      original = JSON.stringify(multiplicadores);
      onDataChange("multiplicador_calificacion", { immediate: true });
      await emit("show-toast", { message: "✅ Multiplicadores guardados correctamente", type: "success" });
    } catch (error) {
      console.error("[Multiplicadores] Error al guardar:", error);
      await emit("show-toast", { message: "❌ Error al guardar multiplicadores: " + error, type: "error" });
    } finally {
      saving = false;
    }
  }
</script>

<div class="category-card" style="border-left:3px solid #a78bfa;">
  <div class="category-header"><h3>{t('ccm.multiplicadores.titulo')}</h3></div>
  <div style="padding:1.5rem 2rem;">
    <p style="margin:0 0 1.5rem 0;color:#94a3b8;font-size:0.85rem;">{t('ccm.multiplicadores.desc')}</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:1rem;">
      {#if multiplicadores.length === 0}
        <div style="grid-column:1/-1;text-align:center;padding:1.5rem;color:#64748b;font-size:0.85rem;">Cargando multiplicadores...</div>
      {:else}
        {#each multiplicadores as m (m.id)}
          {@const gc = ref.find(g => g.id === m.id)}
          {@const col = gc?.color || '#6b7280'}
          <div style="position:relative;background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;transition:all 0.25s ease"
            onmouseenter={(e) => { e.currentTarget.style.borderColor = col + '44'; e.currentTarget.style.boxShadow = `0 8px 32px ${col}22`; }}
            onmouseleave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}>
            <div style="position:absolute;top:0;left:0;width:4px;height:100%;background:{col};border-radius:0 2px 2px 0;"></div>
            <div style="padding:1.25rem 1.25rem 1rem 1.5rem;display:flex;align-items:center;gap:1rem;">
              <div style="width:12px;height:12px;border-radius:50%;background:{col};box-shadow:0 0 8px {col}66;flex-shrink:0;"></div>
              <div style="display:flex;flex-direction:column;gap:0.25rem;flex:1;min-width:0;">
                <span style="font-size:1rem;font-weight:700;color:#f1f5f9;">{gc?.nombre || m.id}</span>
                <span style="font-size:0.65rem;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">{m.id} · Ponderación por criterio</span>
              </div>
              <input type="number" value={m.multiplicador} step="0.01" min="0" max="1"
                oninput={(e) => update(m.id, parseFloat((e.target as HTMLInputElement).value) || 0)}
                style="width:72px;padding:0.35rem 0.4rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e2e8f0;font-size:0.95rem;font-weight:600;text-align:center;outline:none;transition:border 0.2s;flex-shrink:0;" />
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

{#if hasUnsaved}
  <div style="position:sticky;bottom:0;display:flex;justify-content:flex-end;align-items:center;gap:0.75rem;padding:0.85rem 1.25rem;background:rgba(15,23,42,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(96,165,250,0.35);border-radius:14px;box-shadow:0 -8px 28px rgba(0,0,0,0.4)">
    <span style="font-size:0.78rem;color:#94a3b8">{t('ccm.sinGuardar')}</span>
    <button onclick={save} disabled={saving}
      style="padding:0.6rem 1.4rem;background:linear-gradient(135deg,#60a5fa,#3b82f6);border:none;border-radius:10px;color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;box-shadow:0 6px 22px rgba(59,130,246,0.3);display:flex;align-items:center;gap:0.5rem;{saving ? 'opacity:0.6;cursor:not-allowed;' : ''}"
      onmouseenter={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onmouseleave={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(0)'; }}>
      {saving ? t('ccm.guardando') : t('ccm.btn.guardarCambios')}
    </button>
  </div>
{/if}
