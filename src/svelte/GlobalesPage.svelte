<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import CategoryTabContent from "./CategoryTabContent.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface CategoryConfig { title: string; table: string; endpoints: { get: string; add: string; update: string; delete: string; setActive?: string; updateOrder?: string; }; }
  interface ColegioDiasAsistencia { colegioId: number; lunes: boolean; martes: boolean; miercoles: boolean; jueves: boolean; viernes: boolean; sabado: boolean; domingo: boolean; }

  const CATEGORIES: CategoryConfig[] = [
    { title: "Año Lectivo", table: "ano_lectivo", endpoints: { get: "get_anos", add: "add_ano", update: "update_ano", delete: "delete_ano", setActive: "set_active_ano" } },
    { title: "Corte Evaluativo", table: "corte_evaluativo", endpoints: { get: "get_cortes", add: "add_corte", update: "update_corte", delete: "delete_corte", setActive: "set_active_corte" } },
    { title: "Colegio", table: "colegio", endpoints: { get: "get_colegios", add: "add_colegio", update: "update_colegio", delete: "delete_colegio", setActive: "set_active_colegio", updateOrder: "update_colegio_order" } },
    { title: "Asignatura", table: "asignatura", endpoints: { get: "get_asignaturas", add: "add_asignatura", update: "update_asignatura", delete: "delete_asignatura" } },
    { title: "Grado", table: "grado", endpoints: { get: "get_grados", add: "add_grado", update: "update_grado", delete: "delete_grado" } },
    { title: "Sección", table: "seccion", endpoints: { get: "get_secciones", add: "add_seccion", update: "update_seccion", delete: "delete_seccion" } },
  ];

  let isMobile = $state(false);
  let selectedTab = $state(CATEGORIES[0].title);
  let selectedCategory: CategoryConfig | null = $state(null);
  let selectedGrade: CategoryItem | null = $state(null);
  let selectedColegio: CategoryItem | null = $state(null);
  let colegioConfig: ColegioDiasAsistencia | null = $state(null);
  let allSubjects: CategoryItem[] = $state([]);
  let assignedSubjects: number[] = $state([]);
  let selectedColegioForSubjects: CategoryItem | null = $state(null);
  let colegioSubjects: CategoryItem[] = $state([]);

  function fetchColegioConfig() {
    if (!selectedColegio) return;
    invoke("get_colegio_dias_asistencia", { colegioId: selectedColegio.id }).then((config) => {
      colegioConfig = config as ColegioDiasAsistencia;
    }).catch((error) => console.error("Error fetching colegio config:", error));
  }

  function fetchColegioSubjectsData() {
    if (!selectedColegioForSubjects) return;
    Promise.all([
      invoke<CategoryItem[]>("get_asignaturas"),
      invoke<CategoryItem[]>("get_subjects_by_colegio", { colegioId: selectedColegioForSubjects.id }),
    ]).then(([all, assigned]) => {
      allSubjects = all;
      colegioSubjects = assigned;
    }).catch((error) => console.error("[DEBUG ColegioSubjects] Error fetching colegio subjects:", error));
  }

  async function handleToggleColegioSubject(subject: CategoryItem) {
    if (!selectedColegioForSubjects || !subject.id) return;
    const isAssigned = colegioSubjects.some((s) => s.id === subject.id);
    const newAssigned = isAssigned ? colegioSubjects.filter((s) => s.id !== subject.id) : [...colegioSubjects, subject];
    colegioSubjects = newAssigned;
    try {
      if (isAssigned) await invoke("unassign_subject_from_colegio", { colegioId: selectedColegioForSubjects.id, asignaturaId: subject.id });
      else await invoke("assign_subject_to_colegio", { colegioId: selectedColegioForSubjects.id, asignaturaId: subject.id });
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("show-toast", { message: "✅ Asignación actualizada", type: "success" });
      await emit("subjects-updated");
    } catch (error) {
      await emit("show-toast", { message: "❌ Error actualizando asignación: " + error, type: "error" });
      fetchColegioSubjectsData();
    }
  }

  async function handleBulkColegioSubject(action: "assign_all" | "unassign_all") {
    if (!selectedColegioForSubjects) return;
    try {
      if (action === "assign_all") {
        await invoke("assign_all_subjects_to_colegio", { colegioId: selectedColegioForSubjects.id });
        colegioSubjects = [...allSubjects];
      } else {
        await invoke("unassign_all_subjects_from_colegio", { colegioId: selectedColegioForSubjects.id });
        colegioSubjects = [];
      }
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("show-toast", { message: "✅ Asignación actualizada", type: "success" });
      await emit("subjects-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error: " + error, type: "error" }); }
  }

  async function handleToggleDay(day: keyof Omit<ColegioDiasAsistencia, "colegioId">) {
    if (!colegioConfig || !selectedColegio) return;
    const newConfig = { ...colegioConfig, [day]: !colegioConfig[day] };
    try {
      await invoke("save_colegio_dias_asistencia", { config: newConfig });
      colegioConfig = newConfig;
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("show-toast", { message: "✅ Configuración guardada", type: "success" });
      await emit("catalog-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error guardando configuración: " + error, type: "error" }); }
  }

  async function handleBulkDays(checked: boolean) {
    if (!colegioConfig || !selectedColegio) return;
    const newConfig = { ...colegioConfig, lunes: checked, martes: checked, miercoles: checked, jueves: checked, viernes: checked, sabado: checked, domingo: checked };
    try {
      await invoke("save_colegio_dias_asistencia", { config: newConfig });
      colegioConfig = newConfig;
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("show-toast", { message: `✅ Todos los días ${checked ? "marcados" : "desmarcados"}`, type: "success" });
      await emit("catalog-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error en actualización masiva: " + error, type: "error" }); }
  }

  function fetchSubjectsData() {
    if (!selectedGrade) return;
    Promise.all([
      invoke<CategoryItem[]>("get_asignaturas"),
      invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrade.id }),
    ]).then(([all, assigned]) => {
      allSubjects = all;
      assignedSubjects = assigned.map((s) => s.id);
    }).catch((error) => console.error("Error fetching subjects:", error));
  }

  async function toggleSubject(subjectId: number) {
    if (!selectedGrade) return;
    const isAssigned = assignedSubjects.includes(subjectId);
    try {
      if (isAssigned) await invoke("unassign_subject_from_grade", { gradoId: selectedGrade.id, asignaturaId: subjectId });
      else await invoke("assign_subject_to_grade", { gradoId: selectedGrade.id, asignaturaId: subjectId });
      if (isAssigned) assignedSubjects = assignedSubjects.filter((id) => id !== subjectId);
      else assignedSubjects = [...assignedSubjects, subjectId];
      await emit("show-toast", { message: "✅ Currículo actualizado", type: "success" });
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("subjects-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error updating curriculum: " + error, type: "error" }); }
  }

  async function handleBulkAction(action: "assign_all" | "unassign_all") {
    if (!selectedGrade) return;
    try {
      if (action === "assign_all") {
        await invoke("assign_all_subjects_to_grade", { gradoId: selectedGrade.id });
        assignedSubjects = allSubjects.map((s) => s.id);
      } else {
        await invoke("unassign_all_subjects_from_grade", { gradoId: selectedGrade.id });
        assignedSubjects = [];
      }
      await emit("show-toast", { message: "✅ Currículo actualizado", type: "success" });
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("subjects-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error: " + error, type: "error" }); }
  }

  $effect(() => { if (selectedGrade) fetchSubjectsData(); });
  $effect(() => { if (selectedColegio) fetchColegioConfig(); });
  $effect(() => { if (selectedColegioForSubjects) fetchColegioSubjectsData(); });

  onMount(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    isMobile = mql.matches;
    const handler = (e: MediaQueryListEvent) => { isMobile = e.matches; };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  });
</script>

<div class="page-container">
  {#if isMobile}
    {#if !selectedCategory}
      <div style="padding: 1rem;">
        <h1 style="font-size: 1.5rem; font-weight: 700; color: #f1f5f9; margin-bottom: 1.5rem; text-align: center;">Datos Globales</h1>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          {#each CATEGORIES as cat (cat.title)}
            <button onclick={() => selectedCategory = cat}
              style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; background: rgba(51, 65, 85, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; cursor: pointer; transition: all 0.2s ease; width: 100%;">
              <div style="display: flex; align-items: center; gap: 1rem;">
                <div style="width: 4px; height: 40px; background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%); border-radius: 2px;"></div>
                <span style="font-size: 1rem; font-weight: 600; color: #e2e8f0; text-align: left;">{cat.title}</span>
              </div>
              <span style="font-size: 1.25rem; color: #64748b;">→</span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div style="padding: 1rem;">
        <button onclick={() => selectedCategory = null}
          style="display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; background: rgba(51, 65, 85, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; cursor: pointer; margin-bottom: 1rem; width: 100%; transition: all 0.2s ease;">
          <span style="font-size: 1.25rem;">←</span>
          <span style="font-size: 0.95rem; font-weight: 600; color: #94a3b8;">Volver a categorías</span>
        </button>
        <CategoryTabContent
          config={selectedCategory}
          onConfigClick={(item: CategoryItem) => {
            if (selectedCategory.title === "Grado") selectedGrade = item;
            if (selectedCategory.title === "Colegio") selectedColegio = item;
          }}
          onSubjectsClick={(item: CategoryItem) => {
            if (selectedCategory.title === "Colegio") selectedColegioForSubjects = item;
          }}
        />
      </div>
    {/if}
  {:else}
    <div class="category-card" style="margin-bottom: 1rem; padding: 0.75rem; background: rgba(26, 26, 26, 0.95); backdrop-filter: blur(10px); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);">
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        {#each CATEGORIES as cat (cat.title)}
          <button onclick={() => selectedTab = cat.title}
            style="padding: 0.6rem 1.25rem; font-size: 0.85rem; font-weight: 600; border-radius: 8px; border: {selectedTab === cat.title ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent'}; background: {selectedTab === cat.title ? 'rgba(37, 99, 235, 0.2)' : 'rgba(255,255,255,0.03)'}; color: {selectedTab === cat.title ? '#60a5fa' : '#94a3b8'}; cursor: pointer; white-space: nowrap;">
            {cat.title}
          </button>
        {/each}
      </div>
    </div>
    <div style="width: 100%;">
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
    </div>
  {/if}

  <!-- Grade Curriculum Modal -->
  {#if selectedGrade}
    <div class="modal-overlay">
      <div class="modal-content category-card">
        <div class="category-header" style="justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <h3 style="margin: 0; font-size: 1.1rem;">Materias: {selectedGrade.nombre}</h3>
          <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
            <button onclick={() => handleBulkAction("assign_all")} class="primary" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Marcar todas</button>
            <button onclick={() => handleBulkAction("unassign_all")} class="cancel" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Desmarcar todas</button>
            <button onclick={() => selectedGrade = null} style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.2rem; margin-left: 0.2rem;">✕</button>
          </div>
        </div>
        <div class="item-list" style="max-height: 300px; overflow-y: auto;">
          {#each allSubjects as sub (sub.id)}
            <div class="item-row" style="cursor: pointer; display: flex; align-items: center; gap: 12px; justify-content: flex-start;" onclick={() => toggleSubject(sub.id)}>
              <label class="switch" style="pointer-events: none;">
                <input type="checkbox" checked={assignedSubjects.includes(sub.id)} readonly />
                <span class="slider round"></span>
              </label>
              <span style="flex: 1; text-align: left; font-weight: {assignedSubjects.includes(sub.id) ? 'bold' : 'normal'}; color: {assignedSubjects.includes(sub.id) ? '#4ade80' : 'inherit'};">{sub.nombre}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Colegio Days Modal -->
  {#if selectedColegio && colegioConfig}
    <div class="modal-overlay">
      <div class="modal-content category-card">
        <div class="category-header" style="justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <h3 style="margin: 0; font-size: 1.1rem;">Días de Asistencia: {selectedColegio.nombre}</h3>
          <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
            <button onclick={() => handleBulkDays(true)} class="primary" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Marcar todos</button>
            <button onclick={() => handleBulkDays(false)} class="cancel" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Desmarcar todos</button>
            <button onclick={() => selectedColegio = null} style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.2rem; margin-left: 0.2rem;">✕</button>
          </div>
        </div>
        <div class="item-list">
          {#each ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as day}
            <div class="item-row" style="cursor: pointer; display: flex; align-items: center; gap: 12px; justify-content: flex-start;" onclick={() => handleToggleDay(day)}>
              <label class="switch" style="pointer-events: none;">
                <input type="checkbox" checked={colegioConfig[day]} readonly />
                <span class="slider round"></span>
              </label>
              <span style="flex: 1; text-align: left; font-weight: {colegioConfig[day] ? 'bold' : 'normal'}; color: {colegioConfig[day] ? '#4ade80' : 'inherit'}; text-transform: capitalize;">{day}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Colegio Subjects Modal -->
  {#if selectedColegioForSubjects}
    <div class="modal-overlay">
      <div class="modal-content category-card">
        <div class="category-header" style="justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <h3 style="margin: 0; font-size: 1.1rem;">Asignaturas: {selectedColegioForSubjects.nombre}</h3>
          <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
            <button onclick={() => handleBulkColegioSubject("assign_all")} class="primary" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Marcar todas</button>
            <button onclick={() => handleBulkColegioSubject("unassign_all")} class="cancel" style="font-size: 0.65rem; padding: 0.25rem 0.5rem;">Desmarcar todas</button>
            <button onclick={() => selectedColegioForSubjects = null} style="background: transparent; border: none; color: white; cursor: pointer; font-size: 1.2rem; margin-left: 0.2rem;">✕</button>
          </div>
        </div>
        <div class="item-list" style="max-height: 300px; overflow-y: auto;">
          {#each allSubjects as sub (sub.id)}
            {@const isAssigned = colegioSubjects.some((s) => s.id === sub.id)}
            <div class="item-row" style="cursor: pointer; display: flex; align-items: center; gap: 12px; justify-content: flex-start;" onclick={() => handleToggleColegioSubject(sub)}>
              <label class="switch" style="pointer-events: none;">
                <input type="checkbox" checked={isAssigned} readonly />
                <span class="slider round"></span>
              </label>
              <span style="flex: 1; text-align: left; font-weight: {isAssigned ? 'bold' : 'normal'}; color: {isAssigned ? '#4ade80' : 'inherit'};">{sub.nombre}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>
