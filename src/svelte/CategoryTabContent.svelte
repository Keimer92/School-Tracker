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

<div class="category-card" style="position:relative;background:rgba(255,255,255,0.02);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);border-radius:18px;padding:1.5rem;margin-bottom:1.5rem;overflow:hidden;transition:all 0.25s ease;">
  <div style="position:absolute;top:0;left:0;width:100%;height:1px;background:linear-gradient(90deg,transparent,rgba(var(--primary-rgb),0.3),transparent);"></div>
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.06);">
    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
      <div style="width: 4px; height: 28px; background: linear-gradient(180deg, var(--primary-color), var(--primary-hover)); border-radius: 2px;"></div>
      <h2 style="margin: 0; font-size: 1.25rem; color: #f1f5f9; font-weight: 700; letter-spacing: -0.02em;">{config.title}</h2>
      {#if items.length > 0}
        <label onclick={(e) => e.stopPropagation()} style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer; padding: 0.3rem 0.5rem; border-radius: 6px; background: {selectedIds.size > 0 ? 'rgba(var(--primary-rgb), 0.08)' : 'rgba(255,255,255,0.03)'}; border: {selectedIds.size > 0 ? '1px solid rgba(var(--primary-rgb), 0.2)' : '1px solid transparent'}; font-size: 0.7rem; color: {selectedIds.size > 0 ? 'var(--text-secondary)' : '#94a3b8'}; font-weight: 600; user-select: none;transition:all 0.2s">
          <input type="checkbox" checked={items.length > 0 && selectedIds.size === items.length} onchange={toggleSelectAll} style="display: none;" />
          <span style="display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 4px; border: {selectedIds.size === items.length ? '2px solid var(--primary-color)' : '2px solid rgba(255,255,255,0.15)'}; background: {selectedIds.size === items.length ? 'rgba(var(--primary-rgb), 0.2)' : 'transparent'}; flex-shrink: 0;">
            {#if selectedIds.size === items.length}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            {/if}
          </span>
          Todo
        </label>
        {#if selectedIds.size > 0}
          <button onclick={() => showBatchDeleteConfirm = true} disabled={isDeleting} style="padding:0.3rem 0.6rem;font-size:0.7rem;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);cursor:pointer;font-weight:600;color:#fca5a5;transition:all 0.2s;">🗑 {selectedIds.size}</button>
        {/if}
      {/if}
      {#if config.title === "Asignatura" && items.length > 0}
        <div style="display: flex; align-items: center; gap: 0.4rem; margin-left: 0.5rem; padding: 0.3rem 0.6rem; background: rgba(139, 92, 246, 0.1); border-radius: 6px; border: 1px solid rgba(139, 92, 246, 0.2);">
          <span style="font-size: 0.7rem; color: #a78bfa; font-weight: 600;">Cualitativo</span>
          <label class="switch" title={globalCualitativo ? "Desactivar todo" : "Activar todo"}>
            <input type="checkbox" checked={globalCualitativo === true} onchange={(e) => { const checked = (e.target as HTMLInputElement).checked; globalCualitativo = checked ? true : false; handleGlobalCualitativo(checked); }} />
            <span class="slider round" style="background-color: {globalCualitativo ? '#8b5cf6' : undefined};"></span>
          </label>
        </div>
      {/if}
    </div>
    <button onclick={handleAdd} style="padding:0.55rem 1.1rem;font-size:0.8rem;border-radius:10px;background:linear-gradient(135deg,var(--primary-color),var(--primary-hover));border:none;cursor:pointer;font-weight:600;color:white;box-shadow:0 2px 10px rgba(var(--primary-rgb),0.3);transition:all 0.2s;letter-spacing:0.2px"
      onmouseenter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
      onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
      onmousedown={(e) => e.currentTarget.style.transform = 'translateY(1px)'}
      onmouseup={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}>
      <span style="margin-right:0.4rem;font-size:1rem;">+</span> Agregar {config.title}
    </button>
  </div>

  <div style="display: flex; flex-direction: column; gap: 0.65rem;">
    {#if items.length === 0}
      <div style="padding:3rem 2rem;text-align:center;background:rgba(255,255,255,0.02);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:14px;border:1px dashed rgba(255,255,255,0.08);">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">📭</div>
        <p style="margin: 0; font-size: 1rem; color: #94a3b8; font-weight: 500;">No hay {config.title.toLowerCase()}s registrados</p>
        <p style="margin: 0.75rem 0 0 0; font-size: 0.85rem; color: #64748b;">Haz clic en "<strong style="color: var(--primary-color);">+ Agregar</strong>" para crear uno nuevo</p>
      </div>
    {:else}
      {#each items as item (item.id)}
        <div ondragstart={(e) => handleDragStart(e, item)} ondragover={handleDragOver} ondrop={(e) => handleDrop(e, item)}
          draggable={!!config.endpoints.updateOrder}
          style="position:relative;background:rgba(255,255,255,0.02);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:12px;border:1px solid rgba(255,255,255,0.06);padding:0.85rem 1rem;display:flex;align-items:center;gap:10px;opacity:{draggedItem?.id === item.id ? 0.4 : 1};cursor:{config.endpoints.updateOrder ? 'grab' : 'default'};transition:all 0.2s ease;box-shadow:0 1px 4px rgba(0,0,0,0.1);"
          onmouseenter={(e) => { if (draggedItem?.id !== item.id) { e.currentTarget.style.borderColor = 'rgba(var(--primary-rgb), 0.25)'; e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.04)'; }}}
          onmouseleave={(e) => { if (draggedItem?.id !== item.id) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}}>
          <div style="display: flex; align-items: center; gap: 6px;">
            <label onclick={(e) => e.stopPropagation()} style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 5px; border: {selectedIds.has(item.id) ? '2px solid var(--primary-color)' : '2px solid rgba(255,255,255,0.12)'}; background: {selectedIds.has(item.id) ? 'rgba(var(--primary-rgb), 0.15)' : 'transparent'}; cursor: pointer; flex-shrink: 0;transition:all 0.15s;">
              <input type="checkbox" checked={selectedIds.has(item.id)} onchange={() => toggleSelectItem(item.id)} style="display: none;" />
              {#if selectedIds.has(item.id)}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              {/if}
            </label>
            {#if config.endpoints.updateOrder}
              <span style="cursor:grab;color:var(--text-muted);font-size:1rem;user-select:none;padding:0.15rem;opacity:0.5;">⋮⋮</span>
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
          <span style="flex: 1; color: {item.cualitativo ? '#a78bfa' : (item.activo ? '#4ade80' : '#e2e8f0')}; font-weight: {(item.activo || item.cualitativo) ? '700' : '500'}; font-size: 0.9rem; letter-spacing: 0.01em;">
            {item.nombre}
            {#if item.activo}
              <span style="margin-left: 0.5rem; font-size: 0.65rem; color: #4ade80; font-weight: 700; text-transform: uppercase; background: rgba(74, 222, 128, 0.12); padding: 0.15rem 0.4rem; border-radius: 4px; letter-spacing: 0.04em;">✓ Activo</span>
            {/if}
            {#if item.cualitativo}
              <span style="margin-left: 0.5rem; font-size: 0.65rem; color: #a78bfa; font-weight: 700; background: rgba(167, 139, 250, 0.12); padding: 0.15rem 0.4rem; border-radius: 4px; letter-spacing: 0.04em;">♢ Cualitativo</span>
            {/if}
          </span>
          <div style="display: flex; gap: 0.35rem;">
            {#if config.title === "Grado" && onConfigClick}
              <button onclick={() => onConfigClick(item)} title="Configurar Materias" style="background:rgba(var(--primary-rgb),0.1);border:1px solid rgba(var(--primary-rgb),0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(var(--primary-rgb),0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(var(--primary-rgb),0.1)'}>🛠️</button>
            {/if}
            {#if config.title === "Colegio" && onConfigClick}
              <button onclick={() => onConfigClick(item)} title="Configurar Días de Asistencia" style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(16,185,129,0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(16,185,129,0.1)'}>📅</button>
            {/if}
            {#if config.title === "Colegio" && onSubjectsClick}
              <button onclick={() => onSubjectsClick(item)} title="Configurar Asignaturas" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(245,158,11,0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(245,158,11,0.1)'}>📚</button>
            {/if}
            <button onclick={() => handleEdit(item)} title="Editar" style="background:rgba(var(--primary-rgb),0.1);border:1px solid rgba(var(--primary-rgb),0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(var(--primary-rgb),0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(var(--primary-rgb),0.1)'}>✎</button>
            {#if config.title !== "Corte Evaluativo"}
              <button onclick={() => handleDelete(item)} title="Eliminar" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}>🗑</button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<!-- Delete Confirm Modal (Individual) -->
{#if showDeleteConfirm}
  <div class="modal-overlay" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">
    <div style="width:400px;max-width:90%;padding:1.5rem;background:rgba(20,24,31,0.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(239,68,68,0.25);border-radius:20px;box-shadow:0 25px 60px -12px rgba(0,0,0,0.6);">
      <div style="width:40px;height:40px;border-radius:12px;background:rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;font-size:1.2rem;margin-bottom:1rem;">⚠️</div>
      <h3 style="margin:0 0 0.5rem;color:#f1f5f9;font-size:1.05rem;font-weight:700;">Confirmar Eliminación</h3>
      <div style="white-space:pre-wrap;margin:1rem 0 1.5rem;color:#94a3b8;font-size:0.9rem;line-height:1.6;">
        {deleteMessage}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button onclick={() => { showDeleteConfirm = false; itemToDelete = null; }} disabled={isDeleting} style="padding:0.5rem 1rem;font-size:0.8rem;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer;font-weight:600;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}>{hasDependency ? "Entendido" : "Cancelar"}</button>
        {#if !hasDependency}
          <button onclick={confirmDelete} disabled={isDeleting} style="padding:0.5rem 1.25rem;font-size:0.8rem;border-radius:8px;border:none;background:linear-gradient(135deg,#dc2626,#ef4444);color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(239,68,68,0.3);transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'} onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>{isDeleting ? "Eliminando..." : "Eliminar"}</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Batch Delete Modal -->
{#if showBatchDeleteConfirm}
  <div class="modal-overlay" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">
    <div style="width:400px;max-width:90%;padding:1.5rem;background:rgba(20,24,31,0.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(239,68,68,0.25);border-radius:20px;box-shadow:0 25px 60px -12px rgba(0,0,0,0.6);">
      <div style="width:40px;height:40px;border-radius:12px;background:rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;font-size:1.2rem;margin-bottom:1rem;">⚠️</div>
      <h3 style="margin:0 0 0.5rem;color:#f1f5f9;font-size:1.05rem;font-weight:700;">Confirmar Eliminación Masiva</h3>
      <div style="margin:1rem 0 1.5rem;color:#94a3b8;font-size:0.9rem;line-height:1.6;">
        <p style="margin:0 0 0.75rem;">¿Está seguro de eliminar los siguientes <strong style="color:#f1f5f9;">{selectedIds.size}</strong> {config.title.toLowerCase()}?</p>
        <ul style="max-height:180px;overflow-y:auto;padding-left:1.25rem;margin:0.5rem 0;font-size:0.85rem;color:#94a3b8;">
          {#each items.filter(i => selectedIds.has(i.id)) as i}
            <li style="padding:0.15rem 0;">{i.nombre}</li>
          {/each}
        </ul>
        <p style="color:#f87171;font-weight:600;margin:1rem 0 0;font-size:0.85rem;">Todos los datos asociados se eliminarán permanentemente. Esta acción no se puede deshacer.</p>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button onclick={() => showBatchDeleteConfirm = false} disabled={isDeleting} style="padding:0.5rem 1rem;font-size:0.8rem;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer;font-weight:600;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}>Cancelar</button>
        <button onclick={handleBatchDelete} disabled={isDeleting} style="padding:0.5rem 1.25rem;font-size:0.8rem;border-radius:8px;border:none;background:linear-gradient(135deg,#dc2626,#ef4444);color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(239,68,68,0.3);transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'} onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>{isDeleting ? "Eliminando..." : `Eliminar ${selectedIds.size} elementos`}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Prompt Modal (Add/Edit) -->
{#if showPrompt}
  <div class="modal-overlay" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">
    <div style="width:400px;max-width:90%;padding:1.5rem;background:rgba(20,24,31,0.85);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.08);border-radius:20px;box-shadow:0 25px 60px -12px rgba(0,0,0,0.6);">
      <h3 style="margin:0 0 0.25rem;color:#f1f5f9;font-size:1.05rem;font-weight:700;">{promptTitle}</h3>
      <div style="margin:1.25rem 0 1.5rem;">
        <label style="display:block;margin-bottom:0.4rem;font-size:0.75rem;color:#94a3b8;font-weight:600;">{promptLabel}</label>
        <input type="text" bind:value={promptValue} bind:this={promptInput}
          onkeydown={(e) => { if (e.key === "Enter" && promptOnConfirm) { promptOnConfirm(promptValue); showPrompt = false; } }}
          style="width:100%;padding:0.55rem 0.75rem;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(15,23,42,0.5);color:#e2e8f0;font-size:0.9rem;outline:none;box-sizing:border-box;transition:border 0.2s;"
          onfocus={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
          onblur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'} />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
        <button onclick={() => showPrompt = false} style="padding:0.5rem 1rem;font-size:0.8rem;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer;font-weight:600;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}>Cancelar</button>
        <button onclick={() => { if (promptOnConfirm) promptOnConfirm(promptValue); showPrompt = false; }} style="padding:0.5rem 1.25rem;font-size:0.8rem;border-radius:8px;border:none;background:linear-gradient(135deg,var(--primary-hover),var(--primary-color));color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(var(--primary-rgb),0.3);transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'} onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>Guardar</button>
      </div>
    </div>
  </div>
{/if}
