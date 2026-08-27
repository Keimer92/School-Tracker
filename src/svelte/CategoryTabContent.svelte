<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { ask, message } from "@tauri-apps/plugin-dialog";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; cualitativo?: boolean; }
  interface CategoryConfig { title: string; table: string; endpoints: { get: string; add: string; update: string; delete: string; setActive?: string; updateOrder?: string; }; hideDefault?: boolean; noAdd?: boolean; }
  interface DeleteCheckResponse { hasStudents: boolean; hasGrades: boolean; hasNotes: boolean; hasAttendance: boolean; studentCount: number; noteCount: number; attendanceCount: number; }

  let { config, onConfigClick, onSubjectsClick }: {
    config: CategoryConfig;
    onConfigClick?: (item: CategoryItem) => void;
    onSubjectsClick?: (item: CategoryItem) => void;
  } = $props();

  const isAndroid = /Android/i.test(navigator.userAgent);

  // ---- Estado: lista del servidor (snapshot) + draft local ----
  let items: CategoryItem[] = $state([]);
  let original: CategoryItem[] = $state([]);
  // Altas pendientes (sin id real aún)
  let nuevos: { tempId: number; nombre: string; cualitativo: boolean }[] = $state([]);
  let tempCounter = -1;

  let saving = $state(false);
  let isDeleting = $state(false);
  let selectedIds: Set<number> = $state(new Set());
  let draggedItem: CategoryItem | null = $state(null);
  let globalCualitativo: boolean | null = $state(null);
  let promptInput: HTMLInputElement | undefined = $state(undefined);

  // Prompt (entrada de nombre — modal glass; la CONFIRMACIÓN es nativa)
  let showPrompt = $state(false);
  let promptTitle = $state("");
  let promptLabel = $state("");
  let promptValue = $state("");
  let promptOnConfirm: ((val: string) => void) | null = $state(null);

  function snap(list: CategoryItem[]) {
    return JSON.stringify(list.map(i => ({ id: i.id, nombre: i.nombre, activo: !!i.activo, cualitativo: !!i.cualitativo })));
  }

  // Vista combinada: existentes + altas pendientes
  let vista: (CategoryItem & { esNuevo?: boolean })[] = $derived([
    ...items,
    ...nuevos.map(n => ({ id: n.tempId, nombre: n.nombre, cualitativo: n.cualitativo, esNuevo: true })),
  ]);

  let hasUnsavedChanges = $derived(snap(items) !== snap(original) || nuevos.length > 0);

  function countCambios(): number {
    const orig = new Map(original.map(i => [i.id, i]));
    let n = nuevos.length;
    for (const it of items) {
      const o = orig.get(it.id);
      if (!o || o.nombre !== it.nombre || !!o.activo !== !!it.activo || !!o.cualitativo !== !!it.cualitativo) n++;
    }
    return n;
  }

  function orderChanged(): boolean {
    if (!config.endpoints.updateOrder) return false;
    const a = items.map(i => i.id).join(",");
    const b = original.map(i => i.id).join(",");
    return a !== b && items.length === original.length && nuevos.length === 0
      ? true
      : a !== b;
  }

  $effect(() => {
    if (showPrompt) {
      const dispose = registerBackHandler(() => { showPrompt = false; return true; });
      return () => dispose();
    }
  });

  // Back de Android con draft pendiente → confirmación nativa de descarte
  $effect(() => {
    if (!hasUnsavedChanges) return;
    const dispose = registerBackHandler(() => {
      descartarConConfirmacion();
      return true;
    });
    return () => dispose();
  });

  async function fetchItems() {
    try {
      const data: CategoryItem[] = await invoke(config.endpoints.get);
      items = data;
      original = JSON.parse(JSON.stringify(data));
      nuevos = [];
    }
    catch (error) { console.error(`Error fetching ${config.title}:`, error); }
  }

  function captureOriginal() {
    original = JSON.parse(JSON.stringify(items));
    nuevos = [];
  }

  async function descartarConConfirmacion() {
    const ok = await ask(`Hay cambios sin guardar en "${config.title}".\n¿Descartarlos?`, {
      title: "Cambios sin guardar", kind: "warning", okLabel: "Descartar", cancelLabel: "Seguir editando",
    });
    if (ok) { items = JSON.parse(JSON.stringify(original)); nuevos = []; }
  }

  function descartar() {
    items = JSON.parse(JSON.stringify(original));
    nuevos = [];
  }

  // ---- Reordenar (drag&drop desktop + botones touch) ----
  function mover(item: CategoryItem, dir: -1 | 1) {
    if (!config.endpoints.updateOrder) return;
    const list = [...items];
    const idx = list.findIndex(i => i.id === item.id);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    items = list;
  }

  function handleDragStart(e: DragEvent, item: CategoryItem) {
    if (!config.endpoints.updateOrder) return;
    draggedItem = item;
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", item.id?.toString() || ""); }
  }

  function handleDragOver(e: DragEvent) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; }

  function handleDrop(e: DragEvent, targetItem: CategoryItem) {
    e.preventDefault();
    if (!draggedItem || draggedItem.id === targetItem.id || !config.endpoints.updateOrder) return;
    const newItems = [...items];
    const draggedIndex = newItems.findIndex(i => i.id === draggedItem!.id);
    const targetIndex = newItems.findIndex(i => i.id === targetItem.id);
    if (draggedIndex === -1 || targetIndex === -1) return;
    newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);
    items = newItems;
    draggedItem = null;
  }

  // ---- Prompt add/edit (muta el DRAFT, no invoca) ----
  function openPrompt(title: string, label: string, initialValue: string, onConfirm: (val: string) => void) {
    promptTitle = title; promptLabel = label; promptValue = initialValue; promptOnConfirm = onConfirm; showPrompt = true;
  }

  function handleAdd() {
    openPrompt(`Nuevo ${config.title.toLowerCase()}`, "Nombre", "", (nombre) => {
      if (!nombre || !nombre.trim()) return;
      const name = nombre.trim();
      if ([...items, ...nuevos].some(i => i.nombre.toLowerCase() === name.toLowerCase())) {
        emit("show-toast", { message: "⚠️ Ya existe un elemento con ese nombre", type: "warning" });
        return;
      }
      nuevos = [...nuevos, { tempId: tempCounter--, nombre: name, cualitativo: false }];
    });
  }

  function handleEdit(item: CategoryItem & { esNuevo?: boolean }) {
    openPrompt(`Editar ${config.title.toLowerCase()}`, "Nombre", item.nombre, (nuevoNombre) => {
      if (!nuevoNombre || !nuevoNombre.trim() || nuevoNombre.trim() === item.nombre) return;
      const name = nuevoNombre.trim();
      if (item.esNuevo) {
        nuevos = nuevos.map(n => n.tempId === item.id ? { ...n, nombre: name } : n);
      } else {
        items = items.map(i => i.id === item.id ? { ...i, nombre: name } : i);
      }
    });
  }

  // ---- Toggles (buffered) ----
  function handleSetActive(id: number) {
    if (!config.endpoints.setActive) return;
    const yaActivo = items.find(i => i.id === id)?.activo;
    items = items.map(i => ({ ...i, activo: i.id === id ? !yaActivo : false }));
  }

  function handleToggleCualitativo(item: CategoryItem & { esNuevo?: boolean }) {
    if (item.esNuevo) {
      nuevos = nuevos.map(n => n.tempId === item.id ? { ...n, cualitativo: !item.cualitativo } : n);
    } else {
      items = items.map(i => i.id === item.id ? { ...i, cualitativo: !i.cualitativo } : i);
    }
  }

  function handleGlobalCualitativo(enabled: boolean) {
    globalCualitativo = enabled;
    items = items.map(i => ({ ...i, cualitativo: enabled }));
    nuevos = nuevos.map(n => ({ ...n, cualitativo: enabled }));
  }

  // ---- GUARDAR: confirmación NATIVA y aplicación agrupada ----
  async function handleSave() {
    const total = countCambios() + (orderChanged() ? 1 : 0);
    if (total === 0) return;
    const ok = await ask(
      `¿Aplicar ${total} cambio(s) en "${config.title}"?\n\nLos cambios se guardarán y sincronizarán.`,
      { title: "Confirmar cambios", kind: "info", okLabel: "Guardar", cancelLabel: "Cancelar" },
    );
    if (!ok) return;
    saving = true;
    try {
      // 1. Altas pendientes
      for (const n of nuevos) {
        await invoke(config.endpoints.add, { nombre: n.nombre.trim() });
      }
      // 2. Updates (renombrar / toggles) sobre existentes
      const origMap = new Map(original.map(i => [i.id, i]));
      for (const it of items) {
        const o = origMap.get(it.id);
        if (!o) continue;
        if (o.nombre !== it.nombre || !!o.cualitativo !== !!it.cualitativo || (!!o.activo !== !!it.activo && !config.endpoints.setActive)) {
          await invoke(config.endpoints.update, { id: it.id, nombre: it.nombre, cualitativo: !!it.cualitativo });
        }
      }
      // 3. Activo (semántica exclusiva): detectar el nuevo activo
      if (config.endpoints.setActive) {
        const origActivo = original.find(i => i.activo);
        const nuevoActivo = items.find(i => i.activo);
        if ((origActivo?.id ?? null) !== (nuevoActivo?.id ?? null) && nuevoActivo) {
          await invoke(config.endpoints.setActive, { id: nuevoActivo.id });
        }
      }
      // 4. Orden
      if (config.endpoints.updateOrder && orderChanged()) {
        let orderedIds = items.map(i => i.id);
        if (nuevos.length > 0) {
          // Resolver ids reales de las altas por nombre
          const fresh: CategoryItem[] = await invoke(config.endpoints.get);
          const byName = new Map(fresh.map(f => [f.nombre.toLowerCase(), f.id]));
          orderedIds = vista.map(v => v.esNuevo ? (byName.get(v.nombre.toLowerCase()) ?? 0) : v.id).filter(id => id > 0);
        }
        await invoke(config.endpoints.updateOrder, { items: orderedIds });
      }
      onDataChange(config.table);
      await emit("show-toast", { message: `✅ ${total} cambio(s) guardados`, type: "success" });
      await emit("catalog-updated");
      await fetchItems();
    } catch (error) {
      console.error("Error guardando cambios:", error);
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: "error" });
      await fetchItems();
    } finally { saving = false; }
  }

  // ---- ELIMINAR: confirmación NATIVA (ask/message del sistema) ----
  async function handleDelete(item: CategoryItem) {
    if (!item.id) return;
    try {
      const check: DeleteCheckResponse = await invoke("check_category_dependencies", { table: config.table, id: item.id });
      const hasDeps = check.hasStudents || check.hasNotes || check.hasAttendance || check.hasGrades;
      if (hasDeps) {
        const warnings: string[] = [];
        if (check.hasGrades) warnings.push(`• Asignaciones al currículo y grados`);
        if (check.hasStudents) warnings.push(`• ${check.studentCount} estudiantes registrados`);
        if (check.hasNotes) warnings.push(`• ${check.noteCount} calificaciones`);
        if (check.hasAttendance) warnings.push(`• ${check.attendanceCount} registros de asistencia`);
        await message(
          `No se puede eliminar "${item.nombre}" porque tiene datos asociados:\n\n${warnings.join("\n")}\n\nElimina primero los estudiantes desde la página de Estudiantes.`,
          { title: "Eliminación bloqueada", kind: "warning", okLabel: "Entendido" },
        );
        return;
      }
      const ok = await ask(`¿Está seguro de eliminar "${item.nombre}"?\n\nEsta acción no se puede deshacer.`, {
        title: "Confirmar eliminación", kind: "warning", okLabel: "Eliminar", cancelLabel: "Cancelar",
      });
      if (!ok) return;
      isDeleting = true;
      await invoke("delete_category_force", { table: config.table, id: item.id });
      items = items.filter(i => i.id !== item.id);
      original = original.filter(i => i.id !== item.id);
      selectedIds = new Set([...selectedIds].filter(id => id !== item.id));
      await emit("show-toast", { message: `✅ ${config.title} eliminado`, type: "success" });
      onDataChange(config.table);
      await emit("catalog-updated");
    } catch (error) {
      console.error("Error en handleDelete:", error);
      await emit("show-toast", { message: "❌ Error al eliminar: " + error, type: "error" });
    } finally { isDeleting = false; }
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
    const nombres = items.filter(i => selectedIds.has(i.id)).map(i => `"${i.nombre}"`).slice(0, 8).join(", ");
    const resto = selectedIds.size > 8 ? ` y ${selectedIds.size - 8} más` : "";
    const ok = await ask(
      `¿Eliminar ${selectedIds.size} ${config.title.toLowerCase()}(s)?\n\n${nombres}${resto}\n\nTodos los datos asociados se eliminarán permanentemente.`,
      { title: "Confirmar eliminación masiva", kind: "warning", okLabel: "Eliminar todo", cancelLabel: "Cancelar" },
    );
    if (!ok) return;
    isDeleting = true;
    const ids = Array.from(selectedIds);
    try {
      await invoke("delete_category_force_batch", { table: config.table, ids });
      items = items.filter(i => !ids.includes(i.id));
      original = original.filter(i => !ids.includes(i.id));
      selectedIds = new Set();
      await emit("show-toast", { message: `✅ ${ids.length} ${config.title.toLowerCase()}(s) eliminados`, type: "success" });
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
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (hasUnsavedChanges && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      u1.then(u => u());
      window.removeEventListener('schooltracker-sync', onSync);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="category-card" style="position:relative;background:rgba(255,255,255,0.02);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);border-radius:18px;padding:1.5rem;margin-bottom:1.5rem;overflow:hidden;transition:all 0.25s ease;">
  <div style="position:absolute;top:0;left:0;width:100%;height:1px;background:linear-gradient(90deg,transparent,rgba(var(--primary-rgb),0.3),transparent);"></div>
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.06);">
    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
      <div style="width: 4px; height: 28px; background: linear-gradient(180deg, var(--primary-color), var(--primary-hover)); border-radius: 2px;"></div>
      <h2 style="margin: 0; font-size: 1.25rem; color: #f1f5f9; font-weight: 700; letter-spacing: -0.02em;">{config.title}</h2>
      {#if hasUnsavedChanges}
        <span title="Cambios sin guardar" style="width:10px;height:10px;border-radius:50%;background:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,0.6);flex-shrink:0;"></span>
      {/if}
      {#if items.length > 0 && config.title !== "Corte Evaluativo"}
        <label class="cat-select-all" class:active={selectedIds.size > 0} onclick={(e) => e.stopPropagation()}>
          <input type="checkbox" class="cat-selectbox-input" checked={items.length > 0 && selectedIds.size === items.length} onchange={toggleSelectAll} />
          <span class="cat-selectbox" class:checked={selectedIds.size === items.length}>
            <svg class="cat-selectbox-check" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          <span class="cat-select-all-text">Todo{selectedIds.size > 0 ? ` · ${selectedIds.size}` : ""}</span>
        </label>
        {#if selectedIds.size > 0}
          <button onclick={handleBatchDelete} disabled={isDeleting} style="padding:0.3rem 0.6rem;font-size:0.7rem;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);cursor:pointer;font-weight:600;color:#fca5a5;transition:all 0.2s;">🗑 {selectedIds.size}</button>
        {/if}
      {/if}
      {#if config.title === "Asignatura" && items.length > 0}
        <div style="display: flex; align-items: center; gap: 0.4rem; margin-left: 0.5rem; padding: 0.3rem 0.6rem; background: rgba(139, 92, 246, 0.1); border-radius: 6px; border: 1px solid rgba(139, 92, 246, 0.2);">
          <span style="font-size: 0.7rem; color: #a78bfa; font-weight: 600;">Cualitativo</span>
          <label class="switch" title={globalCualitativo ? "Desactivar todo" : "Activar todo"}>
            <input type="checkbox" checked={globalCualitativo === true} onchange={(e) => { const checked = (e.target as HTMLInputElement).checked; handleGlobalCualitativo(checked); }} />
            <span class="slider round" style="background-color: {globalCualitativo ? '#8b5cf6' : undefined};"></span>
          </label>
        </div>
      {/if}
    </div>
    {#if !config.noAdd}
    <button onclick={handleAdd} style="padding:0.55rem 1.1rem;font-size:0.8rem;border-radius:10px;background:linear-gradient(135deg,var(--primary-color),var(--primary-hover));border:none;cursor:pointer;font-weight:600;color:white;box-shadow:0 2px 10px rgba(var(--primary-rgb),0.3);transition:all 0.2s;letter-spacing:0.2px"
      onmouseenter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
      onmouseleave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
      onmousedown={(e) => e.currentTarget.style.transform = 'translateY(1px)'}
      onmouseup={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}>
      <span style="margin-right:0.4rem;font-size:1rem;">+</span> Agregar {config.title}
    </button>
    {/if}
  </div>

  <div style="display: flex; flex-direction: column; gap: 0.65rem;">
    {#if vista.length === 0}
      <div style="padding:3rem 2rem;text-align:center;background:rgba(255,255,255,0.02);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:14px;border:1px dashed rgba(255,255,255,0.08);">
        <div style="font-size: 2.5rem; margin-bottom: 1rem;">📭</div>
        <p style="margin: 0; font-size: 1rem; color: #94a3b8; font-weight: 500;">No hay {config.title.toLowerCase()}s registrados</p>
        {#if config.noAdd}
          <p style="margin: 0.75rem 0 0 0; font-size: 0.85rem; color: #64748b;">Están definidos por el sistema (4 cortes evaluativos).</p>
        {:else}
          <p style="margin: 0.75rem 0 0 0; font-size: 0.85rem; color: #64748b;">Haz clic en "<strong style="color: var(--primary-color);">+ Agregar</strong>" para crear uno nuevo</p>
        {/if}
      </div>
    {:else}
      {#each vista as item (item.id)}
        <div ondragstart={(e) => handleDragStart(e, item)} ondragover={handleDragOver} ondrop={(e) => handleDrop(e, item)}
          draggable={!!config.endpoints.updateOrder && !isAndroid}
          style="position:relative;background:rgba(255,255,255,0.02);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:12px;border:{item.esNuevo ? '1px dashed rgba(var(--primary-rgb),0.45)' : '1px solid rgba(255,255,255,0.06)'};padding:0.85rem 1rem;display:flex;align-items:center;gap:10px;opacity:{draggedItem?.id === item.id ? 0.4 : 1};cursor:{config.endpoints.updateOrder && !isAndroid ? 'grab' : 'default'};transition:all 0.2s ease;box-shadow:0 1px 4px rgba(0,0,0,0.1);"
          onmouseenter={(e) => { if (draggedItem?.id !== item.id) { e.currentTarget.style.borderColor = 'rgba(var(--primary-rgb), 0.25)'; e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.04)'; }}}
          onmouseleave={(e) => { if (draggedItem?.id !== item.id) { e.currentTarget.style.borderColor = item.esNuevo ? 'rgba(var(--primary-rgb),0.45)' : 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}}>
          <div style="display: flex; align-items: center; gap: 6px;">
            {#if !item.esNuevo && config.title !== "Corte Evaluativo"}
              <label class="cat-selectbox-wrap" onclick={(e) => e.stopPropagation()}>
                <input type="checkbox" class="cat-selectbox-input" checked={selectedIds.has(item.id)} onchange={() => toggleSelectItem(item.id)} />
                <span class="cat-selectbox" class:checked={selectedIds.has(item.id)}>
                  <svg class="cat-selectbox-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              </label>
            {/if}
            {#if config.endpoints.updateOrder}
              {#if isAndroid}
                <div style="display:flex;flex-direction:column;gap:2px;">
                  <button onclick={() => mover(item, -1)} style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#94a3b8;font-size:0.55rem;padding:0.1rem 0.35rem;cursor:pointer;line-height:1;">▲</button>
                  <button onclick={() => mover(item, 1)} style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#94a3b8;font-size:0.55rem;padding:0.1rem 0.35rem;cursor:pointer;line-height:1;">▼</button>
                </div>
              {:else}
                <span style="cursor:grab;color:var(--text-muted);font-size:1rem;user-select:none;padding:0.15rem;opacity:0.5;">⋮⋮</span>
              {/if}
            {/if}
            {#if config.endpoints.setActive && !config.hideDefault && !item.esNuevo}
              <label class="switch" title="Activar">
                <input type="checkbox" checked={item.activo || false} onchange={() => handleSetActive(item.id)} />
                <span class="slider round"></span>
              </label>
            {/if}
            {#if (config.title === "Grado" || config.title === "Asignatura")}
              <label class="switch" title={item.cualitativo ? "Cambiar a Cuantitativo" : "Cambiar a Cualitativo"}>
                <input type="checkbox" checked={item.cualitativo || false} onchange={() => handleToggleCualitativo(item)} />
                <span class="slider round" style="background-color: {item.cualitativo ? '#8b5cf6' : undefined};"></span>
              </label>
            {/if}
          </div>
          <span style="flex: 1; color: {item.cualitativo ? '#a78bfa' : ((item.activo && config.title !== 'Colegio') ? '#4ade80' : '#e2e8f0')}; font-weight: {((item.activo && config.title !== 'Colegio') || item.cualitativo) ? '700' : '500'}; font-size: 0.9rem; letter-spacing: 0.01em;">
            {item.nombre}
            {#if item.esNuevo}
              <span style="margin-left: 0.5rem; font-size: 0.65rem; color: var(--primary-color); font-weight: 700; text-transform: uppercase; background: rgba(var(--primary-rgb), 0.12); padding: 0.15rem 0.4rem; border-radius: 4px; letter-spacing: 0.04em;">+ Nuevo</span>
            {/if}
            {#if item.activo && config.title !== "Colegio"}
              <span style="margin-left: 0.5rem; font-size: 0.65rem; color: #4ade80; font-weight: 700; text-transform: uppercase; background: rgba(74, 222, 128, 0.12); padding: 0.15rem 0.4rem; border-radius: 4px; letter-spacing: 0.04em;">✓ Activo</span>
            {/if}
            {#if item.cualitativo}
              <span style="margin-left: 0.5rem; font-size: 0.65rem; color: #a78bfa; font-weight: 700; background: rgba(167, 139, 250, 0.12); padding: 0.15rem 0.4rem; border-radius: 4px; letter-spacing: 0.04em;">♢ Cualitativo</span>
            {/if}
          </span>
          <div style="display: flex; gap: 0.35rem;">
            {#if config.title === "Grado" && onConfigClick && !item.esNuevo}
              <button onclick={() => onConfigClick(item)} title="Configurar Materias" style="background:rgba(var(--primary-rgb),0.1);border:1px solid rgba(var(--primary-rgb),0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(var(--primary-rgb),0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(var(--primary-rgb),0.1)'}>🛠️</button>
            {/if}
            {#if config.title === "Colegio" && onConfigClick && !item.esNuevo}
              <button onclick={() => onConfigClick(item)} title="Configurar Días de Asistencia" style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(16,185,129,0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(16,185,129,0.1)'}>📅</button>
            {/if}
            {#if config.title === "Colegio" && onSubjectsClick && !item.esNuevo}
              <button onclick={() => onSubjectsClick(item)} title="Configurar Asignaturas" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(245,158,11,0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(245,158,11,0.1)'}>📚</button>
            {/if}
            <button onclick={() => handleEdit(item)} title="Editar" style="background:rgba(var(--primary-rgb),0.1);border:1px solid rgba(var(--primary-rgb),0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(var(--primary-rgb),0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(var(--primary-rgb),0.1)'}>✎</button>
            {#if config.title !== "Corte Evaluativo"}
              <button onclick={() => handleDelete(item)} disabled={isDeleting} title="Eliminar" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:7px;padding:0.4rem 0.5rem;cursor:pointer;font-size:1rem;transition:all 0.15s;" onmouseenter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'} onmouseleave={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}>🗑</button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Barra Guardar / Descartar (aparece solo con cambios pendientes) -->
  {#if hasUnsavedChanges}
    <div class="cat-savebar">
      <span style="font-size:0.78rem;color:#fbbf24;font-weight:600;">⚠️ {countCambios() + (orderChanged() ? 1 : 0)} cambio(s) sin guardar</span>
      <div style="display:flex;gap:0.5rem;">
        <button onclick={descartar} disabled={saving} class="cat-btn-ghost">Descartar</button>
        <button onclick={handleSave} disabled={saving} class="cat-btn-save">{saving ? "Guardando..." : "💾 Guardar cambios"}</button>
      </div>
    </div>
  {/if}
</div>

<!-- Prompt Modal (Add/Edit — solo entrada de texto; la confirmación final es nativa) -->
{#if showPrompt}
  <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) showPrompt = false; }} style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">
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
        <button onclick={() => showPrompt = false} style="padding:0.5rem 1rem;font-size:0.8rem;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer;font-weight:600;transition:all 0.15s;">Cancelar</button>
        <button onclick={() => { if (promptOnConfirm) promptOnConfirm(promptValue); showPrompt = false; }} style="padding:0.5rem 1.25rem;font-size:0.8rem;border-radius:8px;border:none;background:linear-gradient(135deg,var(--primary-hover),var(--primary-color));color:white;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(var(--primary-rgb),0.3);transition:all 0.15s;">Aceptar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cat-savebar {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
    margin-top: 1.25rem; padding: 0.85rem 1rem;
    background: rgba(245,158,11,0.07); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(245,158,11,0.22); border-radius: 14px;
  }
  .cat-btn-ghost {
    padding: 0.5rem 1rem; font-size: 0.8rem; border-radius: 9px;
    border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
    color: #cbd5e1; cursor: pointer; font-weight: 600; transition: all 0.2s ease;
  }
  .cat-btn-ghost:hover { background: rgba(255,255,255,0.1); }
  .cat-btn-save {
    padding: 0.55rem 1.25rem; font-size: 0.82rem; border-radius: 9px; border: none;
    background: linear-gradient(135deg, #22c55e, #16a34a); color: white;
    font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(34,197,94,0.3);
    transition: all 0.2s ease;
  }
  .cat-btn-save:hover { transform: translateY(-1px); }
  .cat-btn-save:active { transform: translateY(1px); }
  .cat-btn-save:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

  /* Casillas de selección (borrado en lote) — glassmorphism moderno */
  .cat-selectbox-input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
  .cat-selectbox-wrap {
    display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; flex-shrink: 0; padding: 3px; border-radius: 11px;
    transition: background 0.2s ease;
  }
  .cat-selectbox-wrap:hover { background: rgba(var(--primary-rgb), 0.1); }
  .cat-selectbox {
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 8px;
    border: 2px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.03);
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .cat-selectbox-wrap:hover .cat-selectbox {
    border-color: var(--primary-color);
    background: rgba(var(--primary-rgb), 0.08);
  }
  .cat-selectbox.checked {
    border-color: transparent;
    background: linear-gradient(135deg, var(--primary-color), var(--primary-hover));
    box-shadow: 0 4px 14px rgba(var(--primary-rgb), 0.45);
  }
  .cat-selectbox-check {
    color: #fff; opacity: 0; transform: scale(0.3) rotate(-12deg);
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .cat-selectbox.checked .cat-selectbox-check { opacity: 1; transform: scale(1) rotate(0deg); }

  .cat-select-all {
    display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer;
    padding: 0.35rem 0.75rem; border-radius: 11px;
    background: rgba(255,255,255,0.03); border: 1px solid transparent;
    font-size: 0.72rem; color: #94a3b8; font-weight: 700; user-select: none;
    letter-spacing: 0.3px; transition: all 0.2s ease;
  }
  .cat-select-all:hover { background: rgba(var(--primary-rgb), 0.1); color: var(--text-secondary); }
  .cat-select-all.active {
    background: rgba(var(--primary-rgb), 0.14); border-color: rgba(var(--primary-rgb), 0.3);
    color: var(--text-bright, #e2e8f0); box-shadow: 0 2px 10px rgba(var(--primary-rgb), 0.15);
  }
  .cat-select-all-text { white-space: nowrap; }
</style>
