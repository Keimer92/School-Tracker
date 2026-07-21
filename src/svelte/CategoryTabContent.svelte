<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface CategoryConfig { title: string; table: string; endpoints: { get: string; add: string; update: string; delete: string; setActive?: string; updateOrder?: string; }; }
  interface DeleteCheckResponse { hasStudents: boolean; hasGrades: boolean; hasNotes: boolean; hasAttendance: boolean; studentCount: number; noteCount: number; attendanceCount: number; }

  let { config, onConfigClick, onSubjectsClick }: {
    config: CategoryConfig;
    onConfigClick?: (item: CategoryItem) => void;
    onSubjectsClick?: (item: CategoryItem) => void;
  } = $props();

  let items: CategoryItem[] = $state([]);
  let showDeleteConfirm = $state(false);
  let itemToDelete: CategoryItem | null = $state(null);
  let deleteMessage = $state("");
  let isDeleting = $state(false);
  let hasDependency = $state(false);
  let selectedIds: Set<number> = $state(new Set());
  let showBatchDeleteConfirm = $state(false);
  let showPrompt = $state(false);
  let promptTitle = $state("");
  let promptLabel = $state("");
  let promptValue = $state("");
  let promptOnConfirm: ((val: string) => void) | null = $state(null);
  let draggedItem: CategoryItem | null = $state(null);
  let globalCualitativo: boolean | null = $state(null);
  let promptInput: HTMLInputElement | undefined = $state(undefined);

  async function fetchItems() {
    try { const data: CategoryItem[] = await invoke(config.endpoints.get); items = data; }
    catch (error) { console.error(`Error fetching ${config.title}:`, error); }
  }

  function handleDragStart(e: DragEvent, item: CategoryItem) {
    if (!config.endpoints.updateOrder) return;
    draggedItem = item;
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.id?.toString() || ""); }
  }

  function handleDragOver(e: DragEvent) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; }

  async function handleDrop(e: DragEvent, targetItem: CategoryItem) {
    e.preventDefault();
    if (!draggedItem || draggedItem.id === targetItem.id || !config.endpoints.updateOrder) return;
    const newItems = [...items];
    const draggedIndex = newItems.findIndex(i => i.id === draggedItem.id);
    const targetIndex = newItems.findIndex(i => i.id === targetItem.id);
    if (draggedIndex === -1 || targetIndex === -1) return;
    newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);
    items = newItems;
    draggedItem = null;
    try {
      await invoke(config.endpoints.updateOrder, { items: newItems });
      onDataChange(config.table);
      await emit("catalog-updated");
    } catch (error) {
      console.error("Error updating order:", error);
      fetchItems();
      await emit("show-toast", { message: "❌ Error al reordenar: " + error, type: "error" });
    }
  }

  function openPrompt(title: string, label: string, initialValue: string, onConfirm: (val: string) => void) {
    promptTitle = title; promptLabel = label; promptValue = initialValue; promptOnConfirm = onConfirm; showPrompt = true;
  }

  function handleAdd() {
    openPrompt(`Nuevo ${config.title.toLowerCase()}`, "Nombre", "", async (nombre) => {
      if (!nombre || !nombre.trim()) return;
      try {
        await invoke(config.endpoints.add, { nombre: nombre.trim() });
        fetchItems();
        onDataChange(config.table);
        await emit("show-toast", { message: `✅ ${config.title} agregado`, type: "success" });
        await emit("catalog-updated");
      } catch (error) { await emit("show-toast", { message: "❌ Error: " + error, type: "error" }); }
    });
  }

  function handleEdit(item: CategoryItem) {
    openPrompt(`Editar ${config.title.toLowerCase()}`, "Nombre", item.nombre, async (nuevoNombre) => {
      if (!nuevoNombre || !nuevoNombre.trim() || nuevoNombre === item.nombre) return;
      try {
        await invoke(config.endpoints.update, { id: item.id, nombre: nuevoNombre.trim(), cualitativo: item.cualitativo || false });
        fetchItems();
        onDataChange(config.table);
        await emit("show-toast", { message: `✅ ${config.title} actualizado`, type: "success" });
        await emit("catalog-updated");
      } catch (error) { await emit("show-toast", { message: "❌ Error: " + error, type: "error" }); }
    });
  }

  async function handleDelete(item: CategoryItem) {
    if (!item.id) return;
    try {
      const check: DeleteCheckResponse = await invoke("check_category_dependencies", { table: config.table, id: item.id });
      const hasDeps = check.hasStudents || check.hasNotes || check.hasAttendance || check.hasGrades;
      const warnings: string[] = [];
      if (check.hasGrades) warnings.push(`- Asignaciones al currículo y grados`);
      if (check.hasStudents) warnings.push(`- ${check.studentCount} Estudiantes registrados`);
      if (check.hasNotes) warnings.push(`- ${check.noteCount} Calificaciones registradas`);
      if (check.hasAttendance) warnings.push(`- ${check.attendanceCount} Registros de asistencia`);
      if (hasDeps) {
        deleteMessage = `❌ No se puede eliminar "${item.nombre}" porque tiene datos asociados:\n\n${warnings.join("\n")}\n\nDebe eliminar los estudiantes asociados desde la página de Estudiantes primero.\n\nAl eliminar un estudiante, sus calificaciones y asistencias se eliminarán automáticamente.`;
      } else { deleteMessage = `¿Está seguro de eliminar "${item.nombre}"?`; }
      hasDependency = hasDeps; itemToDelete = item; showDeleteConfirm = true;
    } catch (error) {
      console.error("Error en handleDelete:", error);
      await emit("show-toast", { message: "❌ Error al verificar dependencias: " + error, type: "error" });
    }
  }

  async function confirmDelete() {
    if (!itemToDelete) return;
    isDeleting = true;
    const item = itemToDelete;
    try {
      await invoke("delete_category_force", { table: config.table, id: item.id });
      items = items.filter(i => i.id !== item.id);
      showDeleteConfirm = false; itemToDelete = null;
      await emit("show-toast", { message: `✅ ${config.title} eliminado`, type: "success" });
      onDataChange(config.table);
      try { fetchItems(); await emit("catalog-updated"); } catch (e) { console.error("Error emitting catalog update:", e); }
    } catch (error) {
      console.error("Error deleting category:", error);
      await emit("show-toast", { message: "❌ Error al eliminar: " + error, type: "error" });
    } finally { isDeleting = false; }
  }

  async function handleSetActive(id: number) {
    if (!config.endpoints.setActive) return;
    try {
      await invoke(config.endpoints.setActive, { id });
      const data: CategoryItem[] = await invoke(config.endpoints.get);
      items = data;
      onDataChange(config.table);
      await emit("show-toast", { message: "✅ Activado correctamente", type: "success" });
      await emit("catalog-updated");
    } catch (error) { await emit("show-toast", { message: "❌ Error al activar: " + error, type: "error" }); }
  }

  async function handleToggleCualitativo(item: CategoryItem) {
    try {
      await invoke(config.endpoints.update, { id: item.id, nombre: item.nombre, cualitativo: !item.cualitativo });
      fetchItems();
      onDataChange(config.table);
      await emit("catalog-updated");
      await emit("show-toast", { message: "✅ Tipo de evaluación actualizado", type: "success" });
    } catch (error) { await emit("show-toast", { message: "❌ Error al cambiar tipo: " + error, type: "error" }); }
  }

  async function handleGlobalCualitativo(enabled: boolean) {
    try {
      globalCualitativo = enabled;
      for (const item of items) {
        if (item.cualitativo !== enabled) {
          await invoke(config.endpoints.update, { id: item.id, nombre: item.nombre, cualitativo: enabled });
        }
      }
      onDataChange(config.table);
      fetchItems();
      await emit("catalog-updated");
      await emit("show-toast", { message: enabled ? "✅ Todas las asignaturas ahora son cualitativas" : "✅ Todas las asignaturas ahora son cuantitativas", type: "success" });
    } catch (error) {
      globalCualitativo = null;
      await emit("show-toast", { message: "❌ Error al cambiar tipo masivo: " + error, type: "error" });
    }
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) selectedIds = new Set();
    else selectedIds = new Set(items.map(i => i.id));
  }

  function toggleSelectItem(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) return;
    showBatchDeleteConfirm = false; isDeleting = true;
    const ids = Array.from(selectedIds);
    try {
      await invoke("delete_category_force_batch", { table: config.table, ids });
      items = items.filter(i => !selectedIds.has(i.id));
      selectedIds = new Set();
      await emit("show-toast", { message: `✅ ${ids.length} ${config.title.toLowerCase()} eliminados`, type: "success" });
      onDataChange(config.table);
      await emit("catalog-updated");
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al eliminar en lote: " + error, type: "error" });
    } finally { isDeleting = false; }
  }

  $effect(() => { if (showPrompt && promptInput) promptInput.focus(); });

  onMount(() => {
    fetchItems();
    const u1 = listen("subjects-updated", async () => { await fetchItems(); });
    const onSync = () => { fetchItems(); };
    window.addEventListener('schooltracker-sync', onSync);
    return () => { u1.then(u => u()); window.removeEventListener('schooltracker-sync', onSync); };
  });
</script>

<div class="category-card" style="background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid rgba(var(--primary-rgb), 0.3);">
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <div style="width: 4px; height: 28px; background: linear-gradient(180deg, var(--primary-color), var(--primary-hover)); border-radius: 2px;"></div>
      <h2 style="margin: 0; font-size: 1.35rem; color: #f1f5f9; font-weight: 700; letter-spacing: -0.02em;">{config.title}</h2>
      {#if items.length > 0}
        <label onclick={(e) => e.stopPropagation()} style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; padding: 0.35rem 0.6rem; border-radius: 6px; background: {selectedIds.size > 0 ? 'rgba(var(--primary-rgb), 0.1)' : 'rgba(255,255,255,0.03)'}; border: {selectedIds.size > 0 ? '1px solid rgba(var(--primary-rgb), 0.25)' : '1px solid transparent'}; font-size: 0.75rem; color: {selectedIds.size > 0 ? 'var(--text-secondary)' : '#94a3b8'}; font-weight: 600; user-select: none;">
          <input type="checkbox" checked={items.length > 0 && selectedIds.size === items.length} onchange={toggleSelectAll} style="display: none;" />
          <span style="display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 4px; border: {selectedIds.size === items.length ? '2px solid var(--primary-color)' : '2px solid rgba(255,255,255,0.2)'}; background: {selectedIds.size === items.length ? 'rgba(var(--primary-rgb), 0.2)' : 'transparent'}; flex-shrink: 0;">
            {#if selectedIds.size === items.length}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            {/if}
          </span>
          Todo
        </label>
        {#if selectedIds.size > 0}
          <button onclick={() => showBatchDeleteConfirm = true} disabled={isDeleting} style="padding: 0.35rem 0.75rem; font-size: 0.75rem; border-radius: 6px; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); cursor: pointer; font-weight: 600; color: #fca5a5;">🗑 Eliminar ({selectedIds.size})</button>
        {/if}
      {/if}
      {#if config.title === "Asignatura" && items.length > 0}
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-left: 1rem; padding: 0.4rem 0.75rem; background: rgba(139, 92, 246, 0.15); border-radius: 8px; border: 1px solid rgba(139, 92, 246, 0.3);">
          <span style="font-size: 0.75rem; color: #a78bfa; font-weight: 600;">Todo Cualitativo</span>
          <label class="switch" title={globalCualitativo ? "Desactivar todo" : "Activar todo"}>
            <input type="checkbox" checked={globalCualitativo === true} onchange={(e) => { const checked = (e.target as HTMLInputElement).checked; globalCualitativo = checked ? true : false; handleGlobalCualitativo(checked); }} />
            <span class="slider round" style="background-color: {globalCualitativo ? '#8b5cf6' : undefined};"></span>
          </label>
        </div>
      {/if}
    </div>
    <button onclick={handleAdd} style="padding: 0.65rem 1.25rem; font-size: 0.85rem; border-radius: 10px; background: var(--primary-color); border: none; cursor: pointer; font-weight: 600; color: white; box-shadow: 0 2px 8px rgba(var(--primary-rgb), 0.4);">
      <span style="margin-right: 0.5rem;">+</span> Agregar {config.title}
    </button>
  </div>

  <div style="display: flex; flex-direction: column; gap: 0.75rem;">
    {#if items.length === 0}
      <div style="padding: 3rem 2rem; text-align: center; color: #64748b; background: rgba(255,255,255,0.02); border-radius: 12px; border: 2px dashed rgba(255,255,255,0.08);">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">📭</div>
        <p style="margin: 0; font-size: 1rem; color: #94a3b8; font-weight: 500;">No hay {config.title.toLowerCase()}s registrados</p>
        <p style="margin: 0.75rem 0 0 0; font-size: 0.85rem; color: #64748b;">Haz clic en "<strong style="color: var(--primary-color);">+ Agregar</strong>" para crear uno nuevo</p>
      </div>
    {:else}
      {#each items as item (item.id)}
        <div ondragstart={(e) => handleDragStart(e, item)} ondragover={handleDragOver} ondrop={(e) => handleDrop(e, item)}
          draggable={!!config.endpoints.updateOrder}
          style="display: flex; align-items: center; gap: 12px; padding: 1rem 1.25rem; background: rgba(51, 65, 85, 0.4); border-radius: 10px; border: {draggedItem?.id === item.id ? '2px dashed var(--primary-color)' : '1px solid rgba(255,255,255,0.06)'}; opacity: {draggedItem?.id === item.id ? 0.5 : 1}; cursor: {config.endpoints.updateOrder ? 'move' : 'default'}; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label onclick={(e) => e.stopPropagation()} style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; border: {selectedIds.has(item.id) ? '2px solid var(--primary-color)' : '2px solid rgba(255,255,255,0.15)'}; background: {selectedIds.has(item.id) ? 'rgba(var(--primary-rgb), 0.2)' : 'transparent'}; cursor: pointer; flex-shrink: 0;">
              <input type="checkbox" checked={selectedIds.has(item.id)} onchange={() => toggleSelectItem(item.id)} style="display: none;" />
              {#if selectedIds.has(item.id)}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              {/if}
            </label>
            {#if config.endpoints.updateOrder}
              <span style="cursor: move; color: var(--text-muted); font-size: 1.2rem; user-select: none; padding: 0.25rem;">⋮⋮</span>
            {/if}
            {#if config.endpoints.setActive}
              <label class="switch" title="Activar">
                <input type="checkbox" checked={item.activo || false} onchange={() => handleSetActive(item.id)} />
                <span class="slider round"></span>
              </label>
            {/if}
            {#if config.title === "Grado" || config.title === "Asignatura"}
              <label class="switch" title={item.cualitativo ? "Cambiar a Cuantitativo" : "Cambiar a Cualitativo"}>
                <input type="checkbox" checked={item.cualitativo || false} onchange={() => handleToggleCualitativo(item)} />
                <span class="slider round" style="background-color: {item.cualitativo ? '#8b5cf6' : undefined};"></span>
              </label>
            {/if}
          </div>
          <span style="flex: 1; color: {item.cualitativo ? '#a78bfa' : (item.activo ? '#4ade80' : '#e2e8f0')}; font-weight: {(item.activo || item.cualitativo) ? '700' : '500'}; font-size: 0.95rem; letter-spacing: 0.01em;">
            {item.nombre}
            {#if item.activo}
              <span style="margin-left: 0.75rem; font-size: 0.7rem; color: #4ade80; font-weight: 700; text-transform: uppercase; background: rgba(74, 222, 128, 0.15); padding: 0.2rem 0.5rem; border-radius: 4px; letter-spacing: 0.05em;">✓ Activo</span>
            {/if}
            {#if item.cualitativo}
              <span style="margin-left: 0.75rem; font-size: 0.7rem; color: #a78bfa; font-weight: 700; background: rgba(167, 139, 250, 0.15); padding: 0.2rem 0.5rem; border-radius: 4px; letter-spacing: 0.05em;">♢ Cualitativo</span>
            {/if}
          </span>
          <div style="display: flex; gap: 0.4rem;">
            {#if config.title === "Grado" && onConfigClick}
              <button onclick={() => onConfigClick(item)} title="Configurar Materias" style="background: rgba(var(--primary-rgb), 0.15); border: 1px solid rgba(var(--primary-rgb), 0.3); border-radius: 8px; padding: 0.5rem 0.65rem; cursor: pointer; font-size: 1.1rem;">🛠️</button>
            {/if}
            {#if config.title === "Colegio" && onConfigClick}
              <button onclick={() => onConfigClick(item)} title="Configurar Días de Asistencia" style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 0.5rem 0.65rem; cursor: pointer; font-size: 1.1rem;">📅</button>
            {/if}
            {#if config.title === "Colegio" && onSubjectsClick}
              <button onclick={() => onSubjectsClick(item)} title="Configurar Asignaturas" style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 0.5rem 0.65rem; cursor: pointer; font-size: 1.1rem;">📚</button>
            {/if}
            <button onclick={() => handleEdit(item)} title="Editar" style="background: rgba(var(--primary-rgb), 0.15); border: 1px solid rgba(var(--primary-rgb), 0.3); border-radius: 8px; padding: 0.5rem 0.65rem; cursor: pointer; font-size: 1.1rem;">✎</button>
            <button onclick={() => handleDelete(item)} title="Eliminar" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 0.5rem 0.65rem; cursor: pointer; font-size: 1.1rem;">🗑</button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<!-- Delete Confirm Modal (Individual) -->
{#if showDeleteConfirm}
  <div class="modal-overlay" style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);">
    <div class="modal-content category-card" style="width: 400px; max-width: 90%; padding: 1.5rem; position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(239,68,68,0.25); border-radius: 20px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);">
      <h3 style="margin-top: 0; color: #f87171;">⚠️ Confirmar Eliminación</h3>
      <div style="white-space: pre-wrap; margin: 1.5rem 0; color: #e2e8f0; font-size: 0.95rem; line-height: 1.5;">
        {deleteMessage}
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 1rem;">
        <button onclick={() => { showDeleteConfirm = false; itemToDelete = null; }} disabled={isDeleting} style="padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600;">{hasDependency ? "Entendido" : "Cancelar"}</button>
        {#if !hasDependency}
          <button onclick={confirmDelete} disabled={isDeleting} style="padding: 0.5rem 1.25rem; font-size: 0.85rem; border-radius: 8px; border: none; background: #ef4444; color: white; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(239,68,68,0.4);">{isDeleting ? "Eliminando..." : "Eliminar"}</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Batch Delete Modal -->
{#if showBatchDeleteConfirm}
  <div class="modal-overlay" style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);">
    <div class="modal-content category-card" style="width: 400px; max-width: 90%; padding: 1.5rem; position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(239,68,68,0.25); border-radius: 20px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);">
      <h3 style="margin-top: 0; color: #f87171;">⚠️ Confirmar Eliminación Masiva</h3>
      <div style="margin: 1.5rem 0; color: #e2e8f0; font-size: 0.95rem; line-height: 1.5;">
        <p>¿Está seguro de eliminar los siguientes <strong>{selectedIds.size}</strong> {config.title.toLowerCase()}?</p>
        <ul style="max-height: 200px; overflow-y: auto; padding-left: 1.25rem; margin-top: 0.75rem; font-size: 0.85rem; color: #94a3b8;">
          {#each items.filter(i => selectedIds.has(i.id)) as i}
            <li>{i.nombre}</li>
          {/each}
        </ul>
        <p style="color: #f87171; font-weight: 600; margin-top: 1rem;">Todos los datos asociados (estudiantes, calificaciones, asistencias) se eliminarán permanentemente. Esta acción no se puede deshacer.</p>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 1rem;">
        <button onclick={() => showBatchDeleteConfirm = false} disabled={isDeleting} style="padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600;">Cancelar</button>
        <button onclick={handleBatchDelete} disabled={isDeleting} style="padding: 0.5rem 1.25rem; font-size: 0.85rem; border-radius: 8px; border: none; background: #ef4444; color: white; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(239,68,68,0.4);">{isDeleting ? "Eliminando..." : `Eliminar ${selectedIds.size} elementos`}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Prompt Modal (Add/Edit) -->
{#if showPrompt}
  <div class="modal-overlay" style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);">
    <div class="modal-content category-card" style="width: 400px; max-width: 90%; padding: 1.5rem; position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);">
      <h3 style="margin-top: 0; color: #f1f5f9; font-size: 1.1rem;">{promptTitle}</h3>
      <div style="margin: 1.5rem 0;">
        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.8rem; color: #94a3b8; font-weight: 600;">{promptLabel}</label>
        <input type="text" bind:value={promptValue} bind:this={promptInput}
          onkeydown={(e) => { if (e.key === "Enter" && promptOnConfirm) { promptOnConfirm(promptValue); showPrompt = false; } }}
          style="width: 100%; margin-top: 0.5rem; padding: 0.5rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.6); color: #e2e8f0; font-size: 0.9rem; outline: none; box-sizing: border-box;" />
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 1rem;">
        <button onclick={() => showPrompt = false} style="padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600;">Cancelar</button>
        <button onclick={() => { if (promptOnConfirm) promptOnConfirm(promptValue); showPrompt = false; }} style="padding: 0.5rem 1.25rem; font-size: 0.85rem; border-radius: 8px; border: none; background: linear-gradient(135deg, var(--primary-hover), var(--primary-color)); color: white; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(var(--primary-rgb), 0.4);">Guardar</button>
      </div>
    </div>
  </div>
{/if}
