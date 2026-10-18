<script lang="ts">
  /**
   * CalificacionesConfig — escalas de calificacion cualitativa (tabla
   * `configuracion_calificacion`): sigla, nombre, color y puntaje minimo.
   *
   * Extraido de NotasConfig.svelte, que mezclaba esta card con la de
   * multiplicadores y las guardaba juntas. Ahora cada una es un modulo
   * independiente con su propio boton de guardado.
   */
  import { invoke } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { onDataChange } from "../../lib/autoSync";
import { t } from "../../lib/i18n.svelte";

  interface GradeConfig { id: string; nombre: string; color: string; minimo: number; }

  const PRESET_COLORS = ["#000000","#7f7f7f","#880015","#ed1c24","#ff7f27","#fff200","#22b14c","#00a2e8","#3f48cc","#a349a4","#ffffff","#c3c3c3","#b97a57","#ffaec9","#ffc90e","#efe4b0","#b5e61d","#99d9ea","#7092be","#c8bfe7","#C00000","#FF0000","#FFC000","#FFFF00","#92D050","#00B050","#00B0F0","#0070C0","#002060","#7030A0"];
  const GRADE_ORDER = ["AA", "AS", "AF", "AI"];

  let gradeConfigs = $state<GradeConfig[]>([]);
  let original = $state("");
  let saving = $state(false);

  let hasUnsaved = $derived(original !== JSON.stringify(gradeConfigs));

  const isAndroid = /Android/i.test(navigator.userAgent);

  async function recargar() {
    try {
      const gc = await invoke<GradeConfig[]>("get_grade_configs");
      gradeConfigs = gc.sort((a, b) => GRADE_ORDER.indexOf(a.id) - GRADE_ORDER.indexOf(b.id));
      original = JSON.stringify(gradeConfigs);
    } catch (e) {
      console.error("[Calificaciones] Error cargando:", e);
    }
  }
  recargar();

  function update(id: string, nombre: string, color: string, minimo: number, oldId?: string) {
    let v = minimo;
    if (id !== "AI") { if (v < 0) v = 0; if (v > 100) v = 100; } else v = 0;
    const old = oldId || id;
    gradeConfigs = gradeConfigs.map(c => c.id === old ? { ...c, id, nombre, color, minimo: v } : c);
    gradeConfigs = gradeConfigs.sort((a, b) => GRADE_ORDER.indexOf(a.id) - GRADE_ORDER.indexOf(b.id));
  }

  async function save() {
    if (!hasUnsaved) {
      await emit("show-toast", { message: "No hay cambios en las calificaciones por guardar.", type: "info" });
      return;
    }
    saving = true;
    try {
      for (const gc of gradeConfigs) {
        await invoke("update_grade_config", { id: gc.id, nombre: gc.nombre, color: gc.color, minimo: gc.minimo, oldId: gc.id });
      }
      original = JSON.stringify(gradeConfigs);
      onDataChange("configuracion_calificacion", { immediate: true });
      await emit("grade-configs-updated");
      await emit("show-toast", { message: "✅ Calificaciones guardadas correctamente", type: "success" });
    } catch (error) {
      console.error("[Calificaciones] Error al guardar:", error);
      await emit("show-toast", { message: "❌ Error al guardar calificaciones: " + error, type: "error" });
    } finally {
      saving = false;
    }
  }
</script>

<div class="category-card" class:compacto={isAndroid} style="border-left:3px solid #fbbf24;">
  <div class="category-header"><h3>{t('cc_calificaciones.titulo')}</h3></div>
  <div class="cfg-body">
    <p style="margin:0 0 1.5rem 0;color:#94a3b8;font-size:0.85rem;">{t('cc_calificaciones.desc')}</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:1rem;">
      {#each gradeConfigs as grade (grade.id)}
        <div style="position:relative;background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;transition:all 0.25s ease"
          onmouseenter={(e) => { e.currentTarget.style.borderColor = grade.color + '44'; e.currentTarget.style.boxShadow = `0 8px 32px ${grade.color}22`; }}
          onmouseleave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}>
          <div style="position:absolute;top:0;left:0;width:4px;height:100%;background:{grade.color};border-radius:0 2px 2px 0;"></div>
          <div style="padding:1.25rem 1.25rem 1rem 1.5rem;display:flex;flex-direction:column;gap:1rem;">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <div style="width:12px;height:12px;border-radius:50%;background:{grade.color};box-shadow:0 0 8px {grade.color}66;flex-shrink:0;"></div>
              <input value={grade.id}
                onfocus={(e) => { e.currentTarget.dataset.old = grade.id; e.currentTarget.style.borderColor = grade.color; }}
                oninput={(e) => { const v = e.currentTarget.value; gradeConfigs = gradeConfigs.map(g => g.id === grade.id ? { ...g, id: v } : g); }}
                onblur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; const old = e.currentTarget.dataset.old || grade.id; if (e.currentTarget.value !== old) update(e.currentTarget.value, grade.nombre, grade.color, grade.minimo, old); }}
                onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                style="width:32px;padding:0.2rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#f1f5f9;font-size:1rem;font-weight:700;text-align:center;outline:none;letter-spacing:-0.3px;transition:border 0.2s;flex-shrink:0;" />
              <input value={grade.nombre}
                oninput={(e) => { const v = e.currentTarget.value; gradeConfigs = gradeConfigs.map(g => g.id === grade.id ? { ...g, nombre: v } : g); }}
                onblur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; if (e.currentTarget.value !== grade.nombre) update(grade.id, e.currentTarget.value, grade.color, grade.minimo, grade.id); }}
                onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                style="flex:1;min-width:40px;padding:0.25rem 0.4rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#94a3b8;font-size:0.8rem;outline:none;transition:border 0.2s;"
                onfocus={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'} />
            </div>
            <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
              {#if grade.id !== "AI"}
                <div style="display:flex;flex-direction:column;gap:0.25rem;flex:0 0 auto;">
                  <span style="font-size:0.65rem;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Mínimo</span>
                  <input type="number" value={grade.minimo} oninput={(e) => update(grade.id, grade.nombre, grade.color, parseInt((e.target as HTMLInputElement).value) || 0, grade.id)}
                    style="width:52px;padding:0.35rem 0.4rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e2e8f0;font-size:0.85rem;font-weight:600;text-align:center;outline:none;transition:border 0.2s"
                    onfocus={(e) => e.currentTarget.style.borderColor = grade.color}
                    onblur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'} />
                </div>
              {/if}
              <div style="display:flex;flex-direction:column;gap:0.25rem;flex:1;min-width:0;">
                <span style="font-size:0.65rem;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Color</span>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                  <div style="position:relative;width:72px;height:32px;border-radius:8px;background:{grade.color};border:1px solid rgba(255,255,255,0.15);cursor:pointer;overflow:hidden;flex-shrink:0;transition:box-shadow 0.2s"
                    onclick={() => document.getElementById(`color-input-${grade.id}`)?.click()}
                    onmouseenter={(e) => e.currentTarget.style.boxShadow = `0 0 12px ${grade.color}44`}
                    onmouseleave={(e) => e.currentTarget.style.boxShadow = 'none'}>
                    <input id={`color-input-${grade.id}`} type="color" value={grade.color} oninput={(e) => update(grade.id, grade.nombre, (e.target as HTMLInputElement).value, grade.minimo, grade.id)} style="position:absolute;top:-12px;left:-12px;width:200%;height:200%;opacity:0;cursor:pointer;" />
                  </div>
                  <span style="font-family:monospace;font-size:0.7rem;color:#64748b;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{grade.color.toUpperCase()}</span>
                </div>
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;padding-top:0.25rem;border-top:1px solid rgba(255,255,255,0.04);">
              {#each PRESET_COLORS as preset}
                <button onclick={() => update(grade.id, grade.nombre, preset, grade.minimo, grade.id)}
                  title={preset}
                  style="width:16px;height:16px;border-radius:4px;background:{preset};border:{grade.color.toLowerCase() === preset.toLowerCase() ? '2px solid white' : '1px solid rgba(255,255,255,0.12)'};cursor:pointer;padding:0;transition:all 0.15s ease;transform:{grade.color.toLowerCase() === preset.toLowerCase() ? 'scale(1.2)' : 'scale(1)'};"
                  onmouseenter={(e) => e.currentTarget.style.transform = 'scale(1.3)'}
                  onmouseleave={(e) => e.currentTarget.style.transform = grade.color.toLowerCase() === preset.toLowerCase() ? 'scale(1.2)' : 'scale(1)'}></button>
              {/each}
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

{#if hasUnsaved}
  <div style="position:sticky;bottom:0;display:flex;justify-content:flex-end;align-items:center;gap:0.75rem;padding:0.85rem 1.25rem;background:rgba(15,23,42,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(96,165,250,0.35);border-radius:14px;box-shadow:0 -8px 28px rgba(0,0,0,0.4)">
    <span style="font-size:0.78rem;color:#94a3b8">{t('cc_calificaciones.sinGuardar')}</span>
    <button onclick={save} disabled={saving}
      style="padding:0.6rem 1.4rem;background:linear-gradient(135deg,#60a5fa,#3b82f6);border:none;border-radius:10px;color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;box-shadow:0 6px 22px rgba(59,130,246,0.3);display:flex;align-items:center;gap:0.5rem;{saving ? 'opacity:0.6;cursor:not-allowed;' : ''}"
      onmouseenter={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onmouseleave={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(0)'; }}>
      {saving ? t('cc_calificaciones.guardando') : t('cc_calificaciones.btn.guardarCambios')}
    </button>
  </div>
{/if}

<style>
  /* El padding del cuerpo era inline (`1.5rem 2rem`): moverlo a clase permite
     compactarlo en Android SIN pisar el estilo inline desde el stylesheet. */
  .cfg-body { padding: 1.5rem 2rem; }

  /* ── Android: compacto (`.and-card`) ───────────────────────────────────
     La cabecera se conserva (en Android es el único título de la sección);
     lo que se reduce es el aire interno del cuerpo. */
  .category-card.compacto .cfg-body { padding: 0.35rem; }
  .category-card.compacto .category-header { margin-bottom: 0.9rem; }
  .category-card.compacto .category-header h3 { font-size: 1.05rem; }
</style>
