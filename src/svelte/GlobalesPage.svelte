<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { ask } from "@tauri-apps/plugin-dialog";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";
  import CategoryTabContent from "./CategoryTabContent.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface CategoryConfig { title: string; table: string; endpoints: { get: string; add: string; update: string; delete: string; setActive?: string; updateOrder?: string; }; hideDefault?: boolean; noAdd?: boolean; }
  interface ColegioDiasAsistencia { colegioId: number; lunes: boolean; martes: boolean; miercoles: boolean; jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean; }
  interface GradeConfig { id: string; nombre: string; color: string; minimo: number; }
  interface MultiplicadorItem { id: string; multiplicador: number; }

  const PRESET_COLORS = ["#000000","#7f7f7f","#880015","#ed1c24","#ff7f27","#fff200","#22b14c","#00a2e8","#3f48cc","#a349a4","#ffffff","#c3c3c3","#b97a57","#ffaec9","#ffc90e","#efe4b0","#b5e61d","#99d9ea","#7092be","#c8bfe7","#C00000","#FF0000","#FFC000","#FFFF00","#92D050","#00B050","#00B0F0","#0070C0","#002060","#7030A0"];

  const CATEGORIES: CategoryConfig[] = [
    { title: "Año Lectivo", table: "ano_lectivo", endpoints: { get: "get_anos", add: "add_ano", update: "update_ano", delete: "delete_ano", setActive: "set_active_ano" } },
    { title: "Corte Evaluativo", table: "corte_evaluativo", endpoints: { get: "get_cortes", add: "add_corte", update: "update_corte", delete: "delete_corte", setActive: "set_active_corte" }, noAdd: true },
    { title: "Colegio", table: "colegio", endpoints: { get: "get_colegios", add: "add_colegio", update: "update_colegio", delete: "delete_colegio", setActive: "set_active_colegio", updateOrder: "update_colegio_order" }, hideDefault: true },
    { title: "Asignatura", table: "asignatura", endpoints: { get: "get_asignaturas", add: "add_asignatura", update: "update_asignatura", delete: "delete_asignatura" } },
    { title: "Grado", table: "grado", endpoints: { get: "get_grados", add: "add_grado", update: "update_grado", delete: "delete_grado" } },
    { title: "Sección", table: "seccion", endpoints: { get: "get_secciones", add: "add_seccion", update: "update_seccion", delete: "delete_seccion" } },
  ];

  const TAB_NAMES = ["Notas", ...CATEGORIES.map(c => c.title)];
  const GRADE_ORDER = ["AA", "AS", "AF", "AI"];
  const TAB_ICONS: Record<string, string> = { Notas: "⭐", "Año Lectivo": "📅", "Corte Evaluativo": "✂️", Colegio: "🏫", Asignatura: "📚", Grado: "📊", Sección: "👥" };

  let gradeConfigs: GradeConfig[] = $state([]);
  let multiplicadores: MultiplicadorItem[] = $state([]);
  let originalGradeConfigs: string = $state('');
  let originalMultiplicadores: string = $state('');
  let saving = $state(false);
  let isMobile = $state(false);

  let { pageActive = false }: { pageActive?: boolean } = $props();

  $effect(() => {
    if (!pageActive) return;
    if (selectedColegioForSubjects) {
      const dispose = registerBackHandler(() => { cerrarColegioSubjects(); return true; });
      return () => dispose();
    }
    if (selectedGrade) {
      const dispose = registerBackHandler(() => { cerrarGradeModal(); return true; });
      return () => dispose();
    }
    if (selectedColegio) {
      const dispose = registerBackHandler(() => { cerrarColegioModal(); return true; });
      return () => dispose();
    }
    if (selectedCategory) {
      const dispose = registerBackHandler(() => { selectedCategory = null; return true; });
      return () => dispose();
    }
    if (selectedTab === "Notas") {
      const dispose = registerBackHandler(() => { selectedTab = TAB_NAMES[1]; return true; });
      return () => dispose();
    }
  });

  let hasUnsavedChanges = $derived(
    originalGradeConfigs !== JSON.stringify(gradeConfigs) ||
    originalMultiplicadores !== JSON.stringify(multiplicadores)
  );

  function captureOriginals() {
    originalGradeConfigs = JSON.stringify(gradeConfigs);
    originalMultiplicadores = JSON.stringify(multiplicadores);
  }
  let selectedTab = $state(TAB_NAMES[1]);
  let selectedCategory: CategoryConfig | null = $state(null);
  let selectedGrade: CategoryItem | null = $state(null);
  let selectedColegio: CategoryItem | null = $state(null);
  let colegioConfig: ColegioDiasAsistencia | null = $state(null);
  let colegioConfigOriginal: string = $state('');
  let allSubjects: CategoryItem[] = $state([]);
  let assignedSubjects: number[] = $state([]);
  let assignedOriginal: string = $state('');
  let selectedColegioForSubjects: CategoryItem | null = $state(null);
  let colegioAsignadasIds: number[] = $state([]);
  let colegioAsignadasOriginal: string = $state('');
  let savingModal = $state(false);

  // ---- Cierre seguro de modales con draft pendiente (ask nativo) ----
  async function cerrarSiSeguro(dirty: boolean, cerrar: () => void) {
    if (!dirty) { cerrar(); return; }
    const ok = await ask("Hay cambios sin guardar en este modal.\n¿Descartarlos?", {
      title: "Cambios sin guardar", kind: "warning", okLabel: "Descartar", cancelLabel: "Seguir editando",
    });
    if (ok) cerrar();
  }

  function cerrarGradeModal() { cerrarSiSeguro(gradeDirty, () => { selectedGrade = null; }); }
  function cerrarColegioModal() { cerrarSiSeguro(diasDirty, () => { selectedColegio = null; }); }
  function cerrarColegioSubjects() { cerrarSiSeguro(colegioSubjectsDirty, () => { selectedColegioForSubjects = null; }); }

  function fetchColegioConfig() {
    if (!selectedColegio) return;
    invoke("get_colegio_dias_asistencia", { colegioId: selectedColegio.id }).then((config) => {
      // La nueva lógica de días solo considera lunes–viernes; sábado y domingo
      // nunca son días de clase, así que se fuerzan a falso al cargar (incluso
      // en bases previas que los tenían activos por defecto).
      colegioConfig = { ...(config as ColegioDiasAsistencia), sabado: false, domingo: false };
      colegioConfigOriginal = JSON.stringify(colegioConfig);
    }).catch((error) => console.error("Error fetching colegio config:", error));
  }

  function fetchColegioSubjectsData() {
    if (!selectedColegioForSubjects) return;
    Promise.all([
      invoke<CategoryItem[]>("get_asignaturas"),
      invoke<CategoryItem[]>("get_subjects_by_colegio", { colegioId: selectedColegioForSubjects.id }),
    ]).then(([all, assigned]) => {
      allSubjects = all;
      colegioAsignadasIds = assigned.map((s) => s.id);
      colegioAsignadasOriginal = JSON.stringify(colegioAsignadasIds);
    }).catch((error) => console.error("[DEBUG ColegioSubjects] Error fetching colegio subjects:", error));
  }

  // ---- Días de asistencia (buffer + guardar con confirmación nativa) ----
  let diasDirty = $derived(colegioConfig !== null && JSON.stringify(colegioConfig) !== colegioConfigOriginal);

  function handleToggleDay(day: keyof Omit<ColegioDiasAsistencia, "colegioId">) {
    if (!colegioConfig) return;
    colegioConfig = { ...colegioConfig, [day]: !colegioConfig[day] };
  }

  function handleBulkDays(checked: boolean) {
    if (!colegioConfig) return;
    colegioConfig = { ...colegioConfig, lunes: checked, martes: checked, miercoles: checked, jueves: checked, viernes: checked, sabado: false, domingo: false };
  }

  async function saveColegioDias() {
    if (!colegioConfig || !selectedColegio || !diasDirty) return;
    const ok = await ask(`¿Aplicar la configuración de días de "${selectedColegio.nombre}"?`, {
      title: "Confirmar cambios", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar",
    });
    if (!ok) return;
    savingModal = true;
    try {
      await invoke("save_colegio_dias_asistencia", { config: colegioConfig });
      colegioConfigOriginal = JSON.stringify(colegioConfig);
      onDataChange('colegio_dias_asistencia');
      await emit("show-toast", { message: "✅ Configuración guardada", type: "success" });
      await emit("catalog-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error guardando configuración: " + error, type: "error" }); }
    finally { savingModal = false; }
  }

  function fetchSubjectsData() {
    if (!selectedGrade) return;
    Promise.all([
      invoke<CategoryItem[]>("get_asignaturas"),
      invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrade.id }),
    ]).then(([all, assigned]) => {
      allSubjects = all;
      assignedSubjects = assigned.map((s) => s.id);
      assignedOriginal = JSON.stringify(assignedSubjects);
    }).catch((error) => console.error("Error fetching subjects:", error));
  }

  // ---- Asignaturas de grado (buffer + guardar con confirmación nativa) ----
  let gradeDirty = $derived(selectedGrade !== null && JSON.stringify(assignedSubjects) !== assignedOriginal);
  let colegioSubjectsDirty = $derived(selectedColegioForSubjects !== null && JSON.stringify(colegioAsignadasIds) !== colegioAsignadasOriginal);

  function toggleSubject(subjectId: number) {
    if (!selectedGrade) return;
    if (assignedSubjects.includes(subjectId)) assignedSubjects = assignedSubjects.filter((id) => id !== subjectId);
    else assignedSubjects = [...assignedSubjects, subjectId];
  }

  function handleBulkAction(action: "assign_all" | "unassign_all") {
    if (!selectedGrade) return;
    assignedSubjects = action === "assign_all" ? allSubjects.map((s) => s.id) : [];
  }

  async function saveCurriculum() {
    if (!selectedGrade || !gradeDirty) return;
    const ok = await ask(`¿Aplicar los cambios de currículo de "${selectedGrade.nombre}"?`, {
      title: "Confirmar cambios", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar",
    });
    if (!ok) return;
    savingModal = true;
    try {
      const orig: number[] = JSON.parse(assignedOriginal);
      for (const id of assignedSubjects) {
        if (!orig.includes(id)) await invoke("assign_subject_to_grade", { gradoId: selectedGrade.id, asignaturaId: id });
      }
      for (const id of orig) {
        if (!assignedSubjects.includes(id)) await invoke("unassign_subject_from_grade", { gradoId: selectedGrade.id, asignaturaId: id });
      }
      assignedOriginal = JSON.stringify(assignedSubjects);
      onDataChange('grado_asignatura');
      await emit("show-toast", { message: "✅ Currículo guardado", type: "success" });
      await emit("subjects-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error al guardar currículo: " + error, type: "error" }); }
    finally { savingModal = false; }
  }

  // ---- Asignaturas de colegio (buffer + guardar con confirmación nativa) ----
  function handleToggleColegioSubject(subject: CategoryItem) {
    if (!subject.id) return;
    if (colegioAsignadasIds.includes(subject.id)) colegioAsignadasIds = colegioAsignadasIds.filter((id) => id !== subject.id);
    else colegioAsignadasIds = [...colegioAsignadasIds, subject.id];
  }

  function handleBulkColegioSubject(action: "assign_all" | "unassign_all") {
    colegioAsignadasIds = action === "assign_all" ? allSubjects.map((s) => s.id) : [];
  }

  async function saveColegioSubjects() {
    if (!selectedColegioForSubjects || !colegioSubjectsDirty) return;
    const ok = await ask(`¿Aplicar las asignaturas de "${selectedColegioForSubjects.nombre}"?`, {
      title: "Confirmar cambios", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar",
    });
    if (!ok) return;
    savingModal = true;
    try {
      const orig: number[] = JSON.parse(colegioAsignadasOriginal);
      for (const id of colegioAsignadasIds) {
        if (!orig.includes(id)) await invoke("assign_subject_to_colegio", { colegioId: selectedColegioForSubjects.id, asignaturaId: id });
      }
      for (const id of orig) {
        if (!colegioAsignadasIds.includes(id)) await invoke("unassign_subject_from_colegio", { colegioId: selectedColegioForSubjects.id, asignaturaId: id });
      }
      colegioAsignadasOriginal = JSON.stringify(colegioAsignadasIds);
      onDataChange('colegio_asignatura');
      await emit("show-toast", { message: "✅ Asignación guardada", type: "success" });
      await emit("subjects-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error al guardar asignación: " + error, type: "error" }); }
    finally { savingModal = false; }
  }

  $effect(() => { if (selectedGrade) fetchSubjectsData(); });
  $effect(() => { if (selectedColegio) fetchColegioConfig(); });
  $effect(() => { if (selectedColegioForSubjects) fetchColegioSubjectsData(); });

  function updateGradeConfig(id: string, nombre: string, color: string, minimo: number, oldId?: string) {
    let v = minimo; if (id !== "AI") { if (v < 0) v = 0; if (v > 100) v = 100; } else v = 0;
    const old = oldId || id;
    gradeConfigs = gradeConfigs.map(c => c.id === old ? { ...c, id, nombre, color, minimo: v } : c);
    gradeConfigs = gradeConfigs.sort((a, b) => GRADE_ORDER.indexOf(a.id) - GRADE_ORDER.indexOf(b.id));
  }

  function updateMultiplicador(id: string, multiplicador: number) {
    const clamped = Math.max(0, Math.min(1, multiplicador));
    multiplicadores = multiplicadores.map(m => m.id === id ? { ...m, multiplicador: clamped } : m);
  }

  async function handleSaveChanges() {
    saving = true;
    try {
      // Guardar grade configs modificados
      const curr = JSON.stringify(gradeConfigs);
      if (originalGradeConfigs !== curr) {
        for (const gc of gradeConfigs) {
          const old = gradeConfigs.find(c => c.id === gc.id);
          await invoke("update_grade_config", {
            id: gc.id, nombre: gc.nombre, color: gc.color, minimo: gc.minimo, oldId: gc.id
          });
        }
        onDataChange('configuracion_calificacion', { immediate: true });
      }
      // Guardar multiplicadores modificados
      const currMult = JSON.stringify(multiplicadores);
      if (originalMultiplicadores !== currMult) {
        for (const m of multiplicadores) {
          await invoke("update_multiplicador", { id: m.id, multiplicador: m.multiplicador });
        }
        onDataChange('multiplicador_calificacion', { immediate: true });
      }
      captureOriginals();
      await emit("grade-configs-updated");
      await emit("show-toast", { message: "✅ Cambios guardados correctamente", type: "success" });
    } catch (error) {
      console.error("Error saving changes:", error);
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: "error" });
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    isMobile = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isMobile = e.matches; };
    mql.addEventListener("change", handler);
    invoke<GradeConfig[]>("get_grade_configs").then(d => { gradeConfigs = d.sort((a, b) => GRADE_ORDER.indexOf(a.id) - GRADE_ORDER.indexOf(b.id)); captureOriginals(); }).catch(e => console.error("Error fetching grade configs:", e));
    invoke<MultiplicadorItem[]>("get_multiplicadores").then(d => { multiplicadores = d; captureOriginals(); }).catch(e => console.error("Error fetching multiplicadores:", e));
    return () => mql.removeEventListener("change", handler);
  });
</script>

<div class="page-container">
  {#if isMobile}
    {#if !selectedCategory && selectedTab !== "Notas"}
      <div style="padding: 1rem;">
        <h1 style="font-size: 1.5rem; font-weight: 700; color: #f1f5f9; margin-bottom: 1.5rem; text-align: center;">Datos Globales</h1>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <button onclick={() => selectedTab = "Notas"}
            style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; background: rgba(51, 65, 85, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; cursor: pointer; transition: all 0.2s ease; width: 100%;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              
                <span style="font-size: 1.1rem; flex-shrink:0">{TAB_ICONS["Notas"]}</span>
                <span style="font-size: 1rem; font-weight: 600; color: #e2e8f0; text-align: left;">Notas</span>
            </div>
            <span style="font-size: 1.25rem; color: #64748b;">→</span>
          </button>
          {#each CATEGORIES as cat (cat.title)}
            <button onclick={() => selectedCategory = cat}
              style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; background: rgba(51, 65, 85, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; cursor: pointer; transition: all 0.2s ease; width: 100%;">
              <div style="display: flex; align-items: center; gap: 1rem;">
                
                <span style="font-size: 1.1rem; flex-shrink:0">{TAB_ICONS[cat.title]}</span>
                <span style="font-size: 1rem; font-weight: 600; color: #e2e8f0; text-align: left;">{cat.title}</span>
              </div>
              <span style="font-size: 1.25rem; color: #64748b;">→</span>
            </button>
          {/each}
        </div>
      </div>
    {:else if selectedCategory}
      <div style="padding: 1rem;">
        <!-- El back nativo de Android ya maneja la vuelta -->
        <CategoryTabContent
          config={selectedCategory!}
          onConfigClick={(item: CategoryItem) => {
            if (selectedCategory?.title === "Grado") selectedGrade = item;
            if (selectedCategory?.title === "Colegio") selectedColegio = item;
          }}
          onSubjectsClick={(item: CategoryItem) => {
            if (selectedCategory?.title === "Colegio") selectedColegioForSubjects = item;
          }}
        />
      </div>
    {:else}
      <div style="padding: 1rem;">
        <!-- El back nativo de Android ya maneja la vuelta -->
        <div class="category-card">
          <div class="category-header"><h3>⭐ Configuración de Calificaciones</h3></div>
          <div style="padding: 1.25rem;">
            <p style="margin:0 0 1rem 0;color:#94a3b8;font-size:0.8rem;">Personaliza las escalas de calificación.</p>
            <div style="display: grid; grid-template-columns: 1fr; gap: 0.85rem;">
              {#each gradeConfigs as grade (grade.id)}
                <div style="position:relative;background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:14px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
                  <div style="position:absolute;top:0;left:0;width:3px;height:100%;background:{grade.color};border-radius:0 2px 2px 0;"></div>
                  <div style="padding:1rem 1rem 0.85rem 1.25rem;display:flex;flex-direction:column;gap:0.75rem;">
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                      <div style="width:10px;height:10px;border-radius:50%;background:{grade.color};box-shadow:0 0 6px {grade.color}66;flex-shrink:0;"></div>
                      <input value={grade.id}
                        onfocus={(e) => { e.currentTarget.dataset.old = grade.id; e.currentTarget.style.borderColor = grade.color; }}
                        oninput={(e) => { const v = e.currentTarget.value; gradeConfigs = gradeConfigs.map(g => g.id === grade.id ? { ...g, id: v } : g); }}
                        onblur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; const old = e.currentTarget.dataset.old || grade.id; if (e.currentTarget.value !== old) updateGradeConfig(e.currentTarget.value, grade.nombre, grade.color, grade.minimo, old); }}
                        onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        style="width:28px;padding:0.15rem 0.15rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#f1f5f9;font-size:0.9rem;font-weight:700;text-align:center;outline:none;transition:border 0.2s;flex-shrink:0;" />
                      <input value={grade.nombre}
                        oninput={(e) => { const v = e.currentTarget.value; gradeConfigs = gradeConfigs.map(g => g.id === grade.id ? { ...g, nombre: v } : g); }}
                        onblur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; if (e.currentTarget.value !== grade.nombre) updateGradeConfig(grade.id, e.currentTarget.value, grade.color, grade.minimo, grade.id); }}
                        onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        style="flex:1;min-width:40px;padding:0.2rem 0.35rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#94a3b8;font-size:0.75rem;outline:none;transition:border 0.2s;width:auto;"
                        onfocus={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'} />
                    </div>
                    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
                      {#if grade.id !== "AI"}
                        <div style="display:flex;flex-direction:column;gap:0.2rem;">
                          <span style="font-size:0.6rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Mínimo</span>
                          <input type="number" value={grade.minimo} oninput={(e) => updateGradeConfig(grade.id, grade.nombre, grade.color, parseInt((e.target as HTMLInputElement).value) || 0, grade.id)}
                            style="width:48px;padding:0.3rem 0.35rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#e2e8f0;font-size:0.8rem;font-weight:600;text-align:center;outline:none;" />
                        </div>
                      {/if}
                      <div style="display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:0;">
                        <span style="font-size:0.6rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Color</span>
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                          <div style="position:relative;width:60px;height:28px;border-radius:7px;background:{grade.color};border:1px solid rgba(255,255,255,0.15);cursor:pointer;overflow:hidden;flex-shrink:0;"
                            onclick={() => document.getElementById(`color-input-m-${grade.id}`)?.click()}>
                            <input id="color-input-m-{grade.id}" type="color" value={grade.color} oninput={(e) => updateGradeConfig(grade.id, grade.nombre, (e.target as HTMLInputElement).value, grade.minimo, grade.id)} style="position:absolute;top:-12px;left:-12px;width:200%;height:200%;opacity:0;cursor:pointer;" />
                          </div>
                          <span style="font-family:monospace;font-size:0.65rem;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{grade.color.toUpperCase()}</span>
                        </div>
                      </div>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:3px;padding-top:0.25rem;border-top:1px solid rgba(255,255,255,0.04);">
                      {#each PRESET_COLORS as preset}
                        <button onclick={() => updateGradeConfig(grade.id, grade.nombre, preset, grade.minimo, grade.id)}
                          style="width:14px;height:14px;border-radius:3px;background:{preset};border:{grade.color.toLowerCase() === preset.toLowerCase() ? '2px solid white' : '1px solid rgba(255,255,255,0.12)'};cursor:pointer;padding:0;"></button>
                      {/each}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
        <!-- Multiplicadores de Criterios (Mobile) -->
        <div class="category-card" style="margin-top: 1rem;">
          <div class="category-header"><h3>📊 Multiplicadores de Criterios</h3></div>
          <div style="padding: 1.25rem;">
            <p style="margin:0 0 1rem 0;color:#94a3b8;font-size:0.8rem;">Factor de ponderación para cada calificación cualitativa por criterio.</p>
            <div style="display: grid; grid-template-columns: 1fr; gap: 0.85rem;">
              {#if multiplicadores.length === 0}
                <div style="text-align:center;padding:1.5rem;color:#64748b;font-size:0.8rem;">
                  Cargando multiplicadores...
                </div>
              {:else}
                {#each multiplicadores as m (m.id)}
                  {@const gc = gradeConfigs.find(g => g.id === m.id)}
                  <div style="position:relative;background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:14px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
                    <div style="position:absolute;top:0;left:0;width:3px;height:100%;background:{gc?.color || '#6b7280'};border-radius:0 2px 2px 0;"></div>
                    <div style="padding:1rem 1rem 0.85rem 1.25rem;display:flex;align-items:center;gap:1rem;">
                      <div style="width:10px;height:10px;border-radius:50%;background:{gc?.color || '#6b7280'};box-shadow:0 0 6px {gc?.color || '#6b7280'}66;flex-shrink:0;"></div>
                      <div style="display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:0;">
                        <span style="font-size:0.8rem;font-weight:700;color:#f1f5f9;">{gc?.nombre || m.id}</span>
                        <span style="font-size:0.6rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">{m.id} · Ponderación por criterio</span>
                      </div>
                      <input type="number" value={m.multiplicador} step="0.01" min="0" max="1"
                        oninput={(e) => { const v = parseFloat((e.target as HTMLInputElement).value) || 0; multiplicadores = multiplicadores.map(x => x.id === m.id ? { ...x, multiplicador: Math.max(0, Math.min(1, v)) } : x); }}
                        style="width:64px;padding:0.3rem 0.35rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#e2e8f0;font-size:0.85rem;font-weight:600;text-align:center;outline:none;flex-shrink:0;" />
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
    <!-- Mobile Save Button -->
    {#if hasUnsavedChanges}
      <div style="position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);z-index:100;">
        <button onclick={handleSaveChanges} disabled={saving}
          style="padding:0.75rem 2rem;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:12px;color:white;font-size:0.95rem;font-weight:700;cursor:pointer;box-shadow:0 8px 30px rgba(34,197,94,0.4);transition:all 0.2s ease;display:flex;align-items:center;gap:0.5rem;{saving ? 'opacity:0.6;cursor:not-allowed;' : ''}"
          onmouseenter={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onmouseleave={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(0)'; }}
          onmousedown={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(1px)'; }}>
          {saving ? '⏳ Guardando...' : '💾 Guardar cambios'}
        </button>
      </div>
    {/if}
  {:else}
    <div style="display:flex;justify-content:center;margin-bottom:1.5rem">
      <div class="globales-tabs">
        {#each TAB_NAMES as tabName}
          <button class="globales-tab" class:active={selectedTab === tabName} onclick={() => selectedTab = tabName}>
            <span style="font-size:1.1rem">{TAB_ICONS[tabName]}</span>
            <span>{tabName}</span>
          </button>
        {/each}
      </div>
    </div>
    <div style="width: 100%;">
      {#if selectedTab === "Notas"}
        <div class="category-card">
          <div class="category-header"><h3>⭐ Configuración de Calificaciones</h3></div>
          <div style="padding: 1.5rem 2rem;">
            <p style="margin:0 0 1.5rem 0;color:#94a3b8;font-size:0.85rem;">Personaliza las escalas de calificación cualitativa, sus colores y puntajes mínimos.</p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 1rem;">
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
                        onblur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; const old = e.currentTarget.dataset.old || grade.id; if (e.currentTarget.value !== old) updateGradeConfig(e.currentTarget.value, grade.nombre, grade.color, grade.minimo, old); }}
                        onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        style="width:32px;padding:0.2rem 0.2rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#f1f5f9;font-size:1rem;font-weight:700;text-align:center;outline:none;letter-spacing:-0.3px;transition:border 0.2s;flex-shrink:0;" />
                      <input value={grade.nombre}
                        oninput={(e) => { const v = e.currentTarget.value; gradeConfigs = gradeConfigs.map(g => g.id === grade.id ? { ...g, nombre: v } : g); }}
                        onblur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; if (e.currentTarget.value !== grade.nombre) updateGradeConfig(grade.id, e.currentTarget.value, grade.color, grade.minimo, grade.id); }}
                        onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        style="flex:1;min-width:40px;padding:0.25rem 0.4rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#94a3b8;font-size:0.8rem;font-weight:400;outline:none;transition:border 0.2s;width:auto;"
                        onfocus={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'} />
                    </div>
                    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
                      {#if grade.id !== "AI"}
                        <div style="display:flex;flex-direction:column;gap:0.25rem;flex:0 0 auto;">
                          <span style="font-size:0.65rem;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Mínimo</span>
                          <input type="number" value={grade.minimo} oninput={(e) => updateGradeConfig(grade.id, grade.nombre, grade.color, parseInt((e.target as HTMLInputElement).value) || 0, grade.id)}
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
                            <input id="color-input-{grade.id}" type="color" value={grade.color} oninput={(e) => updateGradeConfig(grade.id, grade.nombre, (e.target as HTMLInputElement).value, grade.minimo, grade.id)} style="position:absolute;top:-12px;left:-12px;width:200%;height:200%;opacity:0;cursor:pointer;" />
                          </div>
                          <span style="font-family:monospace;font-size:0.7rem;color:#64748b;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{grade.color.toUpperCase()}</span>
                        </div>
                      </div>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px;padding-top:0.25rem;border-top:1px solid rgba(255,255,255,0.04);">
                      {#each PRESET_COLORS as preset}
                        <button onclick={() => updateGradeConfig(grade.id, grade.nombre, preset, grade.minimo, grade.id)}
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
        <!-- Multiplicadores de Criterios (Desktop) -->
        <div class="category-card" style="margin-top: 1.5rem;">
          <div class="category-header"><h3>📊 Multiplicadores de Criterios</h3></div>
          <div style="padding: 1.5rem 2rem;">
            <p style="margin:0 0 1.5rem 0;color:#94a3b8;font-size:0.85rem;">Define el factor de ponderación que cada calificación cualitativa aplica por criterio.</p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 1rem;">
              {#if multiplicadores.length === 0}
                <div style="grid-column:1/-1;text-align:center;padding:1.5rem;color:#64748b;font-size:0.85rem;">
                  Cargando multiplicadores...
                </div>
              {:else}
                {#each multiplicadores as m (m.id)}
                  {@const gc = gradeConfigs.find(g => g.id === m.id)}
                  <div style="position:relative;background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;transition:all 0.25s ease"
                    onmouseenter={(e) => { e.currentTarget.style.borderColor = (gc?.color || '#6b7280') + '44'; e.currentTarget.style.boxShadow = `0 8px 32px ${gc?.color || '#6b7280'}22`; }}
                    onmouseleave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}>
                    <div style="position:absolute;top:0;left:0;width:4px;height:100%;background:{gc?.color || '#6b7280'};border-radius:0 2px 2px 0;"></div>
                    <div style="padding:1.25rem 1.25rem 1rem 1.5rem;display:flex;align-items:center;gap:1rem;">
                      <div style="width:12px;height:12px;border-radius:50%;background:{gc?.color || '#6b7280'};box-shadow:0 0 8px {gc?.color || '#6b7280'}66;flex-shrink:0;"></div>
                      <div style="display:flex;flex-direction:column;gap:0.25rem;flex:1;min-width:0;">
                        <span style="font-size:1rem;font-weight:700;color:#f1f5f9;">{gc?.nombre || m.id}</span>
                        <span style="font-size:0.65rem;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">{m.id} · Ponderación por criterio</span>
                      </div>
                      <input type="number" value={m.multiplicador} step="0.01" min="0" max="1"
                        oninput={(e) => { const v = parseFloat((e.target as HTMLInputElement).value) || 0; multiplicadores = multiplicadores.map(x => x.id === m.id ? { ...x, multiplicador: Math.max(0, Math.min(1, v)) } : x); }}
                        style="width:72px;padding:0.35rem 0.4rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e2e8f0;font-size:0.95rem;font-weight:600;text-align:center;outline:none;transition:border 0.2s;flex-shrink:0;" />
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      {:else}
        {#each CATEGORIES.filter(cat => cat.title === selectedTab) as cat (cat.title)}
          <CategoryTabContent
            config={cat}
            onConfigClick={(item: CategoryItem) => {
              if (cat.title === "Grado") selectedGrade = item;
              if (cat.title === "Colegio") selectedColegio = item;
            }}
            onSubjectsClick={(item: CategoryItem) => {
              if (cat.title === "Colegio") selectedColegioForSubjects = item;
            }}
          />
        {/each}
      {/if}
    </div>
    <!-- Desktop Save Button -->
    {#if hasUnsavedChanges}
      <div style="display:flex;justify-content:center;margin-top:1.5rem;">
        <button onclick={handleSaveChanges} disabled={saving}
          style="padding:0.85rem 2.5rem;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:14px;color:white;font-size:1rem;font-weight:700;cursor:pointer;box-shadow:0 8px 30px rgba(34,197,94,0.35);transition:all 0.2s ease;display:flex;align-items:center;gap:0.5rem;{saving ? 'opacity:0.6;cursor:not-allowed;' : ''}"
          onmouseenter={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onmouseleave={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(0)'; }}
          onmousedown={(e) => { if (!saving) e.currentTarget.style.transform = 'translateY(1px)'; }}>
          {saving ? '⏳ Guardando...' : '💾 Guardar cambios'}
        </button>
      </div>
    {/if}
  {/if}

  <!-- Grade Curriculum Modal -->
  {#if selectedGrade}
    <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) cerrarGradeModal(); }}>
      <div class="modal-content category-card">
        <div class="category-header" style="justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <h3 style="margin: 0; font-size: 1.1rem;">Asignaturas: {selectedGrade.nombre}</h3>
          <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
            <button onclick={() => handleBulkAction("assign_all")} class="primary" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Marcar todas</button>
            <button onclick={() => handleBulkAction("unassign_all")} class="cancel" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Desmarcar todas</button>
            <button onclick={cerrarGradeModal} style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.2rem; margin-left: 0.2rem;">✕</button>
          </div>
        </div>
        <div class="item-list" style="max-height: none; overflow: visible;">
          {#each allSubjects as sub (sub.id)}
            <div class="item-row" style="cursor: pointer; display: flex; align-items: center; gap: 12px; justify-content: flex-start;" onclick={() => toggleSubject(sub.id)}>
              <label class="switch" style="pointer-events: none;">
                <input type="checkbox" checked={assignedSubjects.includes(sub.id)} readonly />
                <span class="slider round"></span>
              </label>
              <span style="flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; font-weight: {assignedSubjects.includes(sub.id) ? 'bold' : 'normal'}; color: {assignedSubjects.includes(sub.id) ? '#4ade80' : 'inherit'};">{sub.nombre}</span>
            </div>
          {/each}
        </div>
        {#if gradeDirty}
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.6rem;padding-top:0.9rem;margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.07);flex-wrap:wrap;">
            <span style="font-size:0.75rem;color:#fbbf24;font-weight:600;">⚠️ Cambios sin guardar</span>
            <div style="display:flex;gap:0.5rem;">
              <button onclick={() => { assignedSubjects = JSON.parse(assignedOriginal); }} style="padding:0.4rem 0.85rem;font-size:0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#cbd5e1;cursor:pointer;font-weight:600;">Descartar</button>
              <button onclick={saveCurriculum} disabled={savingModal} style="padding:0.45rem 1rem;font-size:0.78rem;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(34,197,94,0.3);">{savingModal ? "Guardando..." : "💾 Guardar"}</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Colegio Days Modal -->
  {#if selectedColegio && colegioConfig}
    <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) cerrarColegioModal(); }}>
      <div class="modal-content category-card">
        <div class="category-header" style="justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <h3 style="margin: 0; font-size: 1.1rem;">Días de Asistencia: {selectedColegio.nombre}</h3>
          <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
            <button onclick={() => handleBulkDays(true)} class="primary" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Marcar todos</button>
            <button onclick={() => handleBulkDays(false)} class="cancel" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Desmarcar todos</button>
            <button onclick={cerrarColegioModal} style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.2rem; margin-left: 0.2rem;">✕</button>
          </div>
        </div>
        <div class="item-list" style="max-height: none; overflow: visible;">
          {#each ["lunes", "martes", "miercoles", "jueves", "viernes"] as day}
            <div class="item-row" style="cursor: pointer; display: flex; align-items: center; gap: 12px; justify-content: flex-start;" onclick={() => handleToggleDay(day as keyof Omit<ColegioDiasAsistencia, "colegioId">)}>
              <label class="switch" style="pointer-events: none;">
                <input type="checkbox" checked={colegioConfig[day as keyof Omit<ColegioDiasAsistencia, "colegioId">]} readonly />
                <span class="slider round"></span>
              </label>
              <span style="flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; font-weight: {colegioConfig[day as keyof Omit<ColegioDiasAsistencia, "colegioId">] ? 'bold' : 'normal'}; color: {colegioConfig[day as keyof Omit<ColegioDiasAsistencia, "colegioId">] ? '#4ade80' : 'inherit'}; text-transform: capitalize;">{day}</span>
            </div>
          {/each}
        </div>
        {#if diasDirty}
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.6rem;padding-top:0.9rem;margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.07);flex-wrap:wrap;">
            <span style="font-size:0.75rem;color:#fbbf24;font-weight:600;">⚠️ Cambios sin guardar</span>
            <div style="display:flex;gap:0.5rem;">
              <button onclick={() => { colegioConfig = JSON.parse(colegioConfigOriginal); }} style="padding:0.4rem 0.85rem;font-size:0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#cbd5e1;cursor:pointer;font-weight:600;">Descartar</button>
              <button onclick={saveColegioDias} disabled={savingModal} style="padding:0.45rem 1rem;font-size:0.78rem;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(34,197,94,0.3);">{savingModal ? "Guardando..." : "💾 Guardar"}</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Colegio Subjects Modal -->
  {#if selectedColegioForSubjects}
    <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) cerrarColegioSubjects(); }}>
      <div class="modal-content category-card">
        <div class="category-header" style="justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <h3 style="margin: 0; font-size: 1.1rem;">Asignaturas: {selectedColegioForSubjects.nombre}</h3>
          <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
            <button onclick={() => handleBulkColegioSubject("assign_all")} class="primary" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Marcar todas</button>
            <button onclick={() => handleBulkColegioSubject("unassign_all")} class="cancel" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Desmarcar todas</button>
            <button onclick={cerrarColegioSubjects} style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.2rem; margin-left: 0.2rem;">✕</button>
          </div>
        </div>
        <div class="item-list" style="max-height: none; overflow: visible;">
          {#each allSubjects as sub (sub.id)}
            {@const isAssigned = colegioAsignadasIds.includes(sub.id!)}
            <div class="item-row" style="cursor: pointer; display: flex; align-items: center; gap: 12px; justify-content: flex-start;" onclick={() => handleToggleColegioSubject(sub)}>
              <label class="switch" style="pointer-events: none;">
                <input type="checkbox" checked={isAssigned} readonly />
                <span class="slider round"></span>
              </label>
              <span style="flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; font-weight: {isAssigned ? 'bold' : 'normal'}; color: {isAssigned ? '#4ade80' : 'inherit'};">{sub.nombre}</span>
            </div>
          {/each}
        </div>
        {#if colegioSubjectsDirty}
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.6rem;padding-top:0.9rem;margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.07);flex-wrap:wrap;">
            <span style="font-size:0.75rem;color:#fbbf24;font-weight:600;">⚠️ Cambios sin guardar</span>
            <div style="display:flex;gap:0.5rem;">
              <button onclick={() => { colegioAsignadasIds = JSON.parse(colegioAsignadasOriginal); }} style="padding:0.4rem 0.85rem;font-size:0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#cbd5e1;cursor:pointer;font-weight:600;">Descartar</button>
              <button onclick={saveColegioSubjects} disabled={savingModal} style="padding:0.45rem 1rem;font-size:0.78rem;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(34,197,94,0.3);">{savingModal ? "Guardando..." : "💾 Guardar"}</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .globales-tabs { display: inline-flex; padding: 0.4rem; gap: 0.3rem; background: var(--bg-elevated); border-radius: 14px; border: 1px solid var(--border); }
  .globales-tab { padding: 0.5rem 1rem; border-radius: 10px; border: none; background: transparent; color: var(--text-muted); font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s ease; font-size: 0.85rem; }
  .globales-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
  .globales-tab.active { background: var(--bg-active); color: var(--text-bright); box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.08); }
</style>
