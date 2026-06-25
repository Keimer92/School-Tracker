import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { syncService } from "../lib/syncService";
import { useIsMobile } from "../hooks/useAndroid";

interface CategoryItem {
  id: number;
  nombre: string;
  activo?: boolean;
  cualitativo?: boolean;
}

interface CategoryConfig {
  title: string;
  table: string;
  endpoints: {
    get: string;
    add: string;
    update: string;
    delete: string;
    setActive?: string;
    updateOrder?: string;
  };
}

interface DeleteCheckResponse {
  hasStudents: boolean;
  hasGrades: boolean;
  hasNotes: boolean;
  hasAttendance: boolean;
  studentCount: number;
  noteCount: number;
  attendanceCount: number;
}

const CATEGORIES: CategoryConfig[] = [
  {
    title: "Año Lectivo",
    table: "ano_lectivo",
    endpoints: {
      get: "get_anos",
      add: "add_ano",
      update: "update_ano",
      delete: "delete_ano",
      setActive: "set_active_ano",
    },
  },
  {
    title: "Corte Evaluativo",
    table: "corte_evaluativo",
    endpoints: {
      get: "get_cortes",
      add: "add_corte",
      update: "update_corte",
      delete: "delete_corte",
      setActive: "set_active_corte",
    },
  },
  {
    title: "Colegio",
    table: "colegio",
    endpoints: {
      get: "get_colegios",
      add: "add_colegio",
      update: "update_colegio",
      delete: "delete_colegio",
      setActive: "set_active_colegio",
      updateOrder: "update_colegio_order",
    },
  },
  {
    title: "Asignatura",
    table: "asignatura",
    endpoints: {
      get: "get_asignaturas",
      add: "add_asignatura",
      update: "update_asignatura",
      delete: "delete_asignatura",
    },
  },
  {
    title: "Grado",
    table: "grado",
    endpoints: {
      get: "get_grados",
      add: "add_grado",
      update: "update_grado",
      delete: "delete_grado",
    },
  },
  {
    title: "Sección",
    table: "seccion",
    endpoints: {
      get: "get_secciones",
      add: "add_seccion",
      update: "update_seccion",
      delete: "delete_seccion",
    },
  },
];

function CategoryTabContent({
  config,
  onConfigClick,
  onSubjectsClick,
}: {
  config: CategoryConfig;
  onConfigClick?: (item: CategoryItem) => void;
  onSubjectsClick?: (item: CategoryItem) => void;
}) {
  const [items, setItems] = useState<CategoryItem[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<CategoryItem | null>(null);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasDependency, setHasDependency] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  const [showPrompt, setShowPrompt] = useState(false);
  const [promptConfig, setPromptConfig] = useState<{
    title: string;
    label: string;
    initialValue: string;
    onConfirm: (val: string) => void;
  } | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [draggedItem, setDraggedItem] = useState<CategoryItem | null>(null);
  const [globalCualitativo, setGlobalCualitativo] = useState<boolean | null>(null);

  const fetchItems = async () => {
    try {
      const data: CategoryItem[] = await invoke(config.endpoints.get);
      setItems(data);
    } catch (error) {
      console.error(`Error fetching ${config.title}:`, error);
    }
  };

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    item: CategoryItem,
  ) => {
    if (!config.endpoints.updateOrder) return;
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id?.toString() || "");
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!config.endpoints.updateOrder) return;
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (
    e: React.DragEvent<HTMLDivElement>,
    targetItem: CategoryItem,
  ) => {
    e.preventDefault();
    if (
      !draggedItem ||
      draggedItem.id === targetItem.id ||
      !config.endpoints.updateOrder
    )
      return;

    const newItems = [...items];
    const draggedIndex = newItems.findIndex((i) => i.id === draggedItem.id);
    const targetIndex = newItems.findIndex((i) => i.id === targetItem.id);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged item
    newItems.splice(draggedIndex, 1);
    // Insert at target index
    newItems.splice(targetIndex, 0, draggedItem);

    setItems(newItems);
    setDraggedItem(null);

    // Persist order
    try {
      await invoke(config.endpoints.updateOrder, { items: newItems });
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("catalog-updated");
    } catch (error) {
      console.error("Error updating order:", error);
      fetchItems(); // Revert on error
      await emit("show-toast", {
        message: "❌ Error al reordenar: " + error,
        type: "error",
      });
    }
  };

  useEffect(() => {
    fetchItems();

    const unlistenSubjects = listen("subjects-updated", async () => {
      console.log("GlobalesPage: Evento 'subjects-updated' recibido, refrescando datos...");
      await fetchItems();
    });

    const onSync = () => {
      console.log("Sync completado, refrescando GlobalesPage...");
      fetchItems();
    };
    window.addEventListener('schooltracker-sync', onSync);

    return () => {
      unlistenSubjects.then(u => u());
      window.removeEventListener('schooltracker-sync', onSync);
    };
  }, []);

  const openPrompt = (
    title: string,
    label: string,
    initialValue: string,
    onConfirm: (val: string) => void,
  ) => {
    setPromptConfig({ title, label, initialValue, onConfirm });
    setPromptValue(initialValue);
    setShowPrompt(true);
  };

  const handleAdd = () => {
    openPrompt(
      `Nuevo ${config.title.toLowerCase()}`,
      "Nombre",
      "",
      async (nombre) => {
        if (!nombre || !nombre.trim()) return;
        try {
          const id: number = await invoke(config.endpoints.add, {
            nombre: nombre.trim(),
          });
          fetchItems();
          syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
          await emit("show-toast", {
            message: `✅ ${config.title} agregado`,
            type: "success",
          });
          await emit("catalog-updated");
        } catch (error) {
          await emit("show-toast", {
            message: "❌ Error: " + error,
            type: "error",
          });
        }
      },
    );
  };

  const handleEdit = (item: CategoryItem) => {
    openPrompt(
      `Editar ${config.title.toLowerCase()}`,
      "Nombre",
      item.nombre,
      async (nuevoNombre) => {
        if (!nuevoNombre || !nuevoNombre.trim() || nuevoNombre === item.nombre)
          return;
        try {
          await invoke(config.endpoints.update, {
            id: item.id,
            nombre: nuevoNombre.trim(),
            cualitativo: item.cualitativo || false,
          });
          fetchItems();
          syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
          await emit("show-toast", {
            message: `✅ ${config.title} actualizado`,
            type: "success",
          });
          await emit("catalog-updated");
        } catch (error) {
          await emit("show-toast", {
            message: "❌ Error: " + error,
            type: "error",
          });
        }
      },
    );
  };

  const handleDelete = async (item: CategoryItem) => {
    if (!item.id) return;

    try {
      const check: DeleteCheckResponse = await invoke(
        "check_category_dependencies",
        {
          table: config.table,
          id: item.id,
        },
      );

      const hasDeps = check.hasStudents || check.hasNotes || check.hasAttendance || check.hasGrades;
      const warnings: string[] = [];

      if (check.hasGrades)
        warnings.push(`- Asignaciones al currículo y grados`);
      if (check.hasStudents)
        warnings.push(`- ${check.studentCount} Estudiantes registrados`);
      if (check.hasNotes)
        warnings.push(`- ${check.noteCount} Calificaciones registradas`);
      if (check.hasAttendance)
        warnings.push(`- ${check.attendanceCount} Registros de asistencia`);

      if (hasDeps) {
        setDeleteMessage(
          `❌ No se puede eliminar "${item.nombre}" porque tiene datos asociados:\n\n` +
          warnings.join("\n") +
          `\n\nDebe eliminar los estudiantes asociados desde la página de Estudiantes primero.` +
          `\n\nAl eliminar un estudiante, sus calificaciones y asistencias se eliminarán automáticamente.`
        );
      } else {
        setDeleteMessage(`¿Está seguro de eliminar "${item.nombre}"?`);
      }
      setHasDependency(hasDeps);
      setItemToDelete(item);
      setShowDeleteConfirm(true);
    } catch (error) {
      console.error("Error en handleDelete:", error);
      await emit("show-toast", {
        message: "❌ Error al verificar dependencias: " + error,
        type: "error",
      });
    }
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    const item = itemToDelete; // Capturar referencia para closure

    try {
      // 1. Eliminar localmente (Crítico)
      await invoke("delete_category_force", {
        table: config.table,
        id: item.id,
      });

      // 2. Actualizar UI inmediatamente (Optimista)
      setItems((prev) => prev.filter((i) => i.id !== item.id));

      // 3. Cerrar modal y feedback inmediato
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setItemToDelete(null);
      await emit("show-toast", {
        message: `✅ ${config.title} eliminado`,
        type: "success",
      });

      // 4. Segundo plano: Sync y Eventos
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      try {
        fetchItems();
        await emit("catalog-updated");
      } catch (e) {
        console.error("Error emitting catalog update:", e);
      }
    } catch (error) {
      console.error("Error deleting category:", error);
      await emit("show-toast", {
        message: "❌ Error al eliminar: " + error,
        type: "error",
      });
      setIsDeleting(false);
      // Mantener modal abierto en error local
    }
  };

  const handleSetActive = async (id: number) => {
    if (!config.endpoints.setActive) return;
    try {
      await invoke(config.endpoints.setActive, { id });
      const data: CategoryItem[] = await invoke(config.endpoints.get);
      setItems(data);
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("show-toast", {
        message: "✅ Activado correctamente",
        type: "success",
      });
      await emit("catalog-updated");
    } catch (error) {
      await emit("show-toast", {
        message: "❌ Error al activar: " + error,
        type: "error",
      });
    }
  };

  const handleToggleCualitativo = async (item: CategoryItem) => {
    try {
      await invoke(config.endpoints.update, {
        id: item.id,
        nombre: item.nombre,
        cualitativo: !item.cualitativo,
      });
      fetchItems();
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("catalog-updated");
      await emit("show-toast", {
        message: "✅ Tipo de evaluación actualizado",
        type: "success",
      });
    } catch (error) {
      await emit("show-toast", {
        message: "❌ Error al cambiar tipo: " + error,
        type: "error",
      });
    }
  };

  const handleGlobalCualitativo = async (enabled: boolean) => {
    try {
      setGlobalCualitativo(enabled);
      for (const item of items) {
        if (item.cualitativo !== enabled) {
          await invoke(config.endpoints.update, {
            id: item.id,
            nombre: item.nombre,
            cualitativo: enabled,
          });
        }
      }
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      fetchItems();
      await emit("catalog-updated");
      await emit("show-toast", {
        message: enabled ? "✅ Todas las asignaturas ahora son cualitativas" : "✅ Todas las asignaturas ahora son cuantitativas",
        type: "success",
      });
    } catch (error) {
      setGlobalCualitativo(null);
      await emit("show-toast", {
        message: "❌ Error al cambiar tipo masivo: " + error,
        type: "error",
      });
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(i => i.id)));
    }
  };

  const toggleSelectItem = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setShowBatchDeleteConfirm(false);
    setIsDeleting(true);
    const ids = Array.from(selectedIds);
    try {
      await invoke("delete_category_force_batch", {
        table: config.table,
        ids,
      });
      setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
      setSelectedIds(new Set());
      setIsDeleting(false);
      await emit("show-toast", {
        message: `✅ ${ids.length} ${config.title.toLowerCase()} eliminados`,
        type: "success",
      });
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("catalog-updated");
    } catch (error) {
      setIsDeleting(false);
      await emit("show-toast", {
        message: "❌ Error al eliminar en lote: " + error,
        type: "error",
      });
    }
  };

  return (
    <div className="category-card" style={{
      background: 'rgba(30, 41, 59, 0.5)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px',
      padding: '1.5rem',
      marginBottom: '1.5rem',
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.25)',
    }}>
      {/* Header con selección masiva y botón Agregar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem',
        paddingBottom: '1rem',
        borderBottom: '2px solid rgba(59, 130, 246, 0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '4px',
            height: '28px',
            background: 'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)',
            borderRadius: '2px',
          }} />
          <h2 style={{ 
            margin: 0, 
            fontSize: '1.35rem', 
            color: '#f1f5f9',
            fontWeight: '700',
            letterSpacing: '-0.02em',
          }}>
            {config.title}
          </h2>
          {items.length > 0 && (
            <>
              <label
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  cursor: 'pointer',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '6px',
                  background: selectedIds.size > 0 ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.03)',
                  border: selectedIds.size > 0 ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid transparent',
                  fontSize: '0.75rem',
                  color: selectedIds.size > 0 ? '#93c5fd' : '#94a3b8',
                  fontWeight: '600',
                  transition: 'all 0.15s ease',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={items.length > 0 && selectedIds.size === items.length}
                  onChange={toggleSelectAll}
                  style={{ display: 'none' }}
                />
                <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '16px',
                  height: '16px',
                  borderRadius: '4px',
                  border: selectedIds.size === items.length ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.2)',
                  background: selectedIds.size === items.length ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  flexShrink: 0,
                }}>
                  {selectedIds.size === items.length && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Todo
              </label>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setShowBatchDeleteConfirm(true)}
                  disabled={isDeleting}
                  style={{
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.75rem',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    cursor: 'pointer',
                    fontWeight: '600',
                    color: '#fca5a5',
                  }}
                >
                  🗑 Eliminar ({selectedIds.size})
                </button>
              )}
            </>
          )}
          {config.title === "Asignatura" && items.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1rem', padding: '0.4rem 0.75rem', background: 'rgba(139, 92, 246, 0.15)', borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              <span style={{ fontSize: '0.75rem', color: '#a78bfa', fontWeight: '600' }}>Todo Cualitativo</span>
              <label className="switch" title={globalCualitativo ? "Desactivar todo" : "Activar todo"}>
                <input
                  type="checkbox"
                  checked={globalCualitativo === true}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setGlobalCualitativo(checked ? true : false);
                    handleGlobalCualitativo(checked);
                  }}
                />
                <span
                  className="slider round"
                  style={{
                    backgroundColor: globalCualitativo ? '#8b5cf6' : undefined,
                  }}
                ></span>
              </label>
            </div>
          )}
        </div>
        <button
          className="primary"
          onClick={handleAdd}
          style={{
            padding: '0.65rem 1.25rem',
            fontSize: '0.85rem',
            borderRadius: '10px',
            backgroundColor: '#3b82f6',
            border: 'none',
            cursor: 'pointer',
            fontWeight: '600',
            color: 'white',
            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.4)';
          }}
        >
          <span style={{ marginRight: '0.5rem' }}>+</span> Agregar {config.title}
        </button>
      </div>

      {/* Lista de items */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}>
        {items.length === 0 ? (
          <div style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            color: '#64748b',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: '12px',
            border: '2px dashed rgba(255,255,255,0.08)',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📭</div>
            <p style={{ 
              margin: 0, 
              fontSize: '1rem',
              color: '#94a3b8',
              fontWeight: '500',
            }}>
              No hay {config.title.toLowerCase()}s registrados
            </p>
            <p style={{ 
              margin: '0.75rem 0 0 0', 
              fontSize: '0.85rem',
              color: '#64748b',
            }}>
              Haz clic en "<strong style={{ color: '#3b82f6' }}>+ Agregar</strong>" para crear uno nuevo
            </p>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              draggable={!!config.endpoints.updateOrder}
              onDragStart={(e) => handleDragStart(e, item)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '1rem 1.25rem',
                background: 'rgba(51, 65, 85, 0.4)',
                borderRadius: '10px',
                border: draggedItem?.id === item.id 
                  ? '2px dashed #3b82f6' 
                  : '1px solid rgba(255,255,255,0.06)',
                opacity: draggedItem?.id === item.id ? 0.5 : 1,
                cursor: config.endpoints.updateOrder ? 'move' : 'default',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(51, 65, 85, 0.6)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                e.currentTarget.style.transform = 'translateX(4px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(51, 65, 85, 0.4)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                e.currentTarget.style.transform = 'translateX(0)';
              }}
            >
              {/* Controles */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '22px',
                    height: '22px',
                    borderRadius: '6px',
                    border: selectedIds.has(item.id) ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.15)',
                    background: selectedIds.has(item.id) ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelectItem(item.id)}
                    style={{ display: 'none' }}
                  />
                  {selectedIds.has(item.id) && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </label>
                {config.endpoints.updateOrder && (
                  <span style={{
                    cursor: 'move',
                    color: '#475569',
                    fontSize: '1.2rem',
                    userSelect: 'none',
                    padding: '0.25rem',
                  }}>
                    ⋮⋮
                  </span>
                )}
                {config.endpoints.setActive && (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <label className="switch" title="Activar">
                      <input
                        type="checkbox"
                        checked={item.activo || false}
                        onChange={() => handleSetActive(item.id)}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                )}

                {/* Switch para Cualitativo (Solo para Grado y Asignatura) */}
                {(config.title === "Grado" || config.title === "Asignatura") && (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <label
                      className="switch"
                      title={
                        item.cualitativo
                          ? "Cambiar a Cuantitativo"
                          : "Cambiar a Cualitativo"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={item.cualitativo || false}
                        onChange={() => handleToggleCualitativo(item)}
                      />
                      <span
                        className="slider round"
                        style={{
                          backgroundColor: item.cualitativo ? '#8b5cf6' : undefined,
                        }}
                      ></span>
                    </label>
                  </div>
                )}
              </div>

              {/* Nombre del item */}
              <span
                className={`item-name ${item.activo ? "active-item" : ""}`}
                style={{
                  flex: 1,
                  color: item.cualitativo ? "#a78bfa" : item.activo ? "#4ade80" : '#e2e8f0',
                  fontWeight: item.activo || item.cualitativo ? "700" : "500",
                  fontSize: '0.95rem',
                  letterSpacing: '0.01em',
                }}
              >
                {item.nombre}
                {item.activo && (
                  <span style={{
                    marginLeft: '0.75rem',
                    fontSize: '0.7rem',
                    color: '#4ade80',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    background: 'rgba(74, 222, 128, 0.15)',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    letterSpacing: '0.05em',
                  }}>
                    ✓ Activo
                  </span>
                )}
                {item.cualitativo && (
                  <span style={{
                    marginLeft: '0.75rem',
                    fontSize: '0.7rem',
                    color: '#a78bfa',
                    fontWeight: '700',
                    background: 'rgba(167, 139, 250, 0.15)',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    letterSpacing: '0.05em',
                  }}>
                    ♢ Cualitativo
                  </span>
                )}
              </span>

              {/* Botones de acción */}
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {/* Botón Configurar Materias (Solo para Grado) */}
                {config.title === "Grado" && onConfigClick && (
                  <button
                    className="icon-button edit"
                    onClick={() => onConfigClick(item)}
                    title="Configurar Materias"
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      borderRadius: '8px',
                      padding: '0.5rem 0.65rem',
                      cursor: 'pointer',
                      fontSize: '1.1rem',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    🛠️
                  </button>
                )}
                {/* Botón Configurar Días (Solo para Colegio) */}
                {config.title === "Colegio" && onConfigClick && (
                  <button
                    className="icon-button edit"
                    onClick={() => onConfigClick(item)}
                    title="Configurar Días de Asistencia"
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '8px',
                      padding: '0.5rem 0.65rem',
                      cursor: 'pointer',
                      fontSize: '1.1rem',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)';
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    📅
                  </button>
                )}
                {/* Botón Configurar Asignaturas (Solo para Colegio) */}
                {config.title === "Colegio" && onSubjectsClick && (
                  <button
                    className="icon-button edit"
                    onClick={() => onSubjectsClick(item)}
                    title="Configurar Asignaturas"
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '8px',
                      padding: '0.5rem 0.65rem',
                      cursor: 'pointer',
                      fontSize: '1.1rem',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(245, 158, 11, 0.25)';
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    📚
                  </button>
                )}
                {/* Botón Editar */}
                <button
                  className="icon-button edit"
                  onClick={() => handleEdit(item)}
                  title="Editar"
                  style={{
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '8px',
                    padding: '0.5rem 0.65rem',
                    cursor: 'pointer',
                    fontSize: '1.1rem',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  ✎
                </button>
                {/* Botón Eliminar */}
                <button
                  className="icon-button delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item);
                  }}
                  title="Eliminar"
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '0.5rem 0.65rem',
                    cursor: 'pointer',
                    fontSize: '1.1rem',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  🗑
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal de Confirmación de Eliminación (Individual) */}
      {showDeleteConfirm &&
        createPortal(
          <div className="modal-overlay">
            <div
              className="modal-content category-card"
              style={{ width: "400px", maxWidth: "90%", padding: "1.5rem" }}
            >
              <h3 style={{ marginTop: 0, color: "#f87171" }}>
                ⚠️ Confirmar Eliminación
              </h3>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  margin: "1.5rem 0",
                  color: "#e2e8f0",
                  fontSize: "0.95rem",
                  lineHeight: "1.5",
                }}
              >
                {deleteMessage}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "1rem",
                }}
              >
                <button
                  className="cancel"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setItemToDelete(null);
                  }}
                  disabled={isDeleting}
                >
                  {hasDependency ? "Entendido" : "Cancelar"}
                </button>
                {!hasDependency && (
                  <button
                    className="primary"
                    onClick={confirmDelete}
                    disabled={isDeleting}
                    style={{ backgroundColor: "#ef4444" }}
                  >
                    {isDeleting ? "Eliminando..." : "Eliminar"}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal de Confirmación de Eliminación Masiva */}
      {showBatchDeleteConfirm &&
        createPortal(
          <div className="modal-overlay">
            <div
              className="modal-content category-card"
              style={{ width: "400px", maxWidth: "90%", padding: "1.5rem" }}
            >
              <h3 style={{ marginTop: 0, color: "#f87171" }}>
                ⚠️ Confirmar Eliminación Masiva
              </h3>
              <div
                style={{
                  margin: "1.5rem 0",
                  color: "#e2e8f0",
                  fontSize: "0.95rem",
                  lineHeight: "1.5",
                }}
              >
                <p>¿Está seguro de eliminar los siguientes <strong>{selectedIds.size}</strong> {config.title.toLowerCase()}?</p>
                <ul style={{ maxHeight: '200px', overflowY: 'auto', paddingLeft: '1.25rem', marginTop: '0.75rem', fontSize: '0.85rem', color: '#94a3b8' }}>
                  {items.filter(i => selectedIds.has(i.id)).map(i => (
                    <li key={i.id}>{i.nombre}</li>
                  ))}
                </ul>
                <p style={{ color: '#f87171', fontWeight: '600', marginTop: '1rem' }}>
                  Todos los datos asociados (estudiantes, calificaciones, asistencias) se eliminarán permanentemente. Esta acción no se puede deshacer.
                </p>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "1rem",
                }}
              >
                <button
                  className="cancel"
                  onClick={() => setShowBatchDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancelar
                </button>
                <button
                  className="primary"
                  onClick={handleBatchDelete}
                  disabled={isDeleting}
                  style={{ backgroundColor: "#ef4444" }}
                >
                  {isDeleting ? "Eliminando..." : `Eliminar ${selectedIds.size} elementos`}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal de Prompt (Añadir/Editar) */}
      {showPrompt &&
        promptConfig &&
        createPortal(
          <div className="modal-overlay">
            <div
              className="modal-content category-card"
              style={{ width: "400px", maxWidth: "90%", padding: "1.5rem" }}
            >
              <h3 style={{ marginTop: 0 }}>{promptConfig.title}</h3>
              <div style={{ margin: "1.5rem 0" }}>
                <label className="input-label">{promptConfig.label}</label>
                <input
                  autoFocus
                  type="text"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      promptConfig.onConfirm(promptValue);
                      setShowPrompt(false);
                    }
                  }}
                  style={{ width: "100%", marginTop: "0.5rem" }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "1rem",
                }}
              >
                <button className="cancel" onClick={() => setShowPrompt(false)}>
                  Cancelar
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    promptConfig.onConfirm(promptValue);
                    setShowPrompt(false);
                  }}
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

interface ColegioDiasAsistencia {
  colegioId: number;
  lunes: boolean;
  martes: boolean;
  miercoles: boolean;
  jueves: boolean;
  viernes: boolean;
  sabado: boolean;
  domingo: boolean;
}

export function GlobalesPage() {
  const [selectedGrade, setSelectedGrade] = useState<CategoryItem | null>(null);
  const [selectedColegio, setSelectedColegio] = useState<CategoryItem | null>(
    null,
  );
  const [colegioConfig, setColegioConfig] =
    useState<ColegioDiasAsistencia | null>(null);
  const [allSubjects, setAllSubjects] = useState<CategoryItem[]>([]);
  const [assignedSubjects, setAssignedSubjects] = useState<number[]>([]);
  const [selectedColegioForSubjects, setSelectedColegioForSubjects] =
    useState<CategoryItem | null>(null);
  const [colegioSubjects, setColegioSubjects] = useState<CategoryItem[]>([]);

  // Tab state for desktop version
  const [selectedTab, setSelectedTab] = useState<string>(CATEGORIES[0].title);
  
  // Mobile view state - usando hook reutilizable
  const isMobile = useIsMobile();
  const [selectedCategory, setSelectedCategory] = useState<CategoryConfig | null>(null);

  // Fetch all subjects when modal opens
  useEffect(() => {
    if (selectedGrade) {
      fetchSubjectsData();
    }
  }, [selectedGrade]);

  // Fetch colegio attendance days when modal opens
  useEffect(() => {
    if (selectedColegio) {
      fetchColegioConfig();
    }
  }, [selectedColegio]);

  // Fetch colegio subjects when modal opens
  useEffect(() => {
    if (selectedColegioForSubjects) {
      fetchColegioSubjectsData();
    }
  }, [selectedColegioForSubjects]);

  const fetchColegioConfig = async () => {
    if (!selectedColegio) return;
    try {
      const config: ColegioDiasAsistencia = await invoke(
        "get_colegio_dias_asistencia",
        { colegioId: selectedColegio.id },
      );
      setColegioConfig(config);
    } catch (error) {
      console.error("Error fetching colegio config:", error);
    }
  };

  const fetchColegioSubjectsData = async () => {
    if (!selectedColegioForSubjects) return;
    try {
      console.log(`[DEBUG ColegioSubjects] fetchColegioSubjectsData() para colegio ID=${selectedColegioForSubjects.id} nombre="${selectedColegioForSubjects.nombre}"`);
      const [all, assigned] = await Promise.all([
        invoke<CategoryItem[]>("get_asignaturas"),
        invoke<CategoryItem[]>("get_subjects_by_colegio", {
          colegioId: selectedColegioForSubjects.id,
        }),
      ]);
      console.log(`[DEBUG ColegioSubjects] get_asignaturas devolvió ${all.length} asignaturas:`, all.map(s => `${s.id}:${s.nombre}`));
      console.log(`[DEBUG ColegioSubjects] get_subjects_by_colegio para colegio ${selectedColegioForSubjects.id} devolvió ${assigned.length} asignaturas:`, assigned.map(s => `${s.id}:${s.nombre}`));
      setAllSubjects(all);
      setColegioSubjects(assigned);
    } catch (error) {
      console.error("[DEBUG ColegioSubjects] Error fetching colegio subjects:", error);
    }
  };

  const handleToggleColegioSubject = async (subject: CategoryItem) => {
    if (!selectedColegioForSubjects || !subject.id) return;

    const isAssigned = colegioSubjects.some((s) => s.id === subject.id);
    console.log(`[DEBUG ColegioSubjects] handleToggleColegioSubject: subject ${subject.id}:${subject.nombre} isAssigned=${isAssigned} para colegio ${selectedColegioForSubjects.id}:${selectedColegioForSubjects.nombre}`);
    const newAssigned = isAssigned
      ? colegioSubjects.filter((s) => s.id !== subject.id)
      : [...colegioSubjects, subject];

    try {
      setColegioSubjects(newAssigned); // Optimistic UI

      if (isAssigned) {
        console.log(`[DEBUG ColegioSubjects] Llamando unassign_subject_from_colegio(colegioId=${selectedColegioForSubjects.id}, asignaturaId=${subject.id})`);
        await invoke("unassign_subject_from_colegio", {
          colegioId: selectedColegioForSubjects.id,
          asignaturaId: subject.id,
        });
        console.log(`[DEBUG ColegioSubjects] unassign_subject_from_colegio COMPLETADO`);
      } else {
        console.log(`[DEBUG ColegioSubjects] Llamando assign_subject_to_colegio(colegioId=${selectedColegioForSubjects.id}, asignaturaId=${subject.id})`);
        await invoke("assign_subject_to_colegio", {
          colegioId: selectedColegioForSubjects.id,
          asignaturaId: subject.id,
        });
        console.log(`[DEBUG ColegioSubjects] assign_subject_to_colegio COMPLETADO`);
      }

      console.log(`[DEBUG ColegioSubjects] Llamando syncAllSilent...`);
      await syncService.syncAllSilent().catch(err => console.warn("[DEBUG ColegioSubjects] Auto-sync error:", err));

      await emit("show-toast", {
        message: "✅ Asignación actualizada",
        type: "success",
      });
      // Emitir evento para que otras páginas refresquen las asignaturas
      await emit("subjects-updated");
    } catch (error) {
      console.error("[DEBUG ColegioSubjects] Error toggling subject:", error);
      await emit("show-toast", {
        message: "❌ Error actualizando asignación: " + error,
        type: "error",
      });
      fetchColegioSubjectsData(); // Revert
    }
  };

  const handleBulkColegioSubject = async (
    action: "assign_all" | "unassign_all",
  ) => {
    if (!selectedColegioForSubjects) return;
    console.log(`[DEBUG ColegioSubjects] handleBulkColegioSubject: action=${action} para colegio ${selectedColegioForSubjects.id}:${selectedColegioForSubjects.nombre}`);
    try {
      if (action === "assign_all") {
        console.log(`[DEBUG ColegioSubjects] Llamando assign_all_subjects_to_colegio(colegioId=${selectedColegioForSubjects.id})`);
        await invoke("assign_all_subjects_to_colegio", {
          colegioId: selectedColegioForSubjects.id,
        });
        console.log(`[DEBUG ColegioSubjects] assign_all_subjects_to_colegio COMPLETADO`);
        setColegioSubjects(allSubjects);
      } else {
        console.log(`[DEBUG ColegioSubjects] Llamando unassign_all_subjects_from_colegio(colegioId=${selectedColegioForSubjects.id})`);
        await invoke("unassign_all_subjects_from_colegio", {
          colegioId: selectedColegioForSubjects.id,
        });
        console.log(`[DEBUG ColegioSubjects] unassign_all_subjects_from_colegio COMPLETADO`);
        setColegioSubjects([]);
      }
      
      console.log(`[DEBUG ColegioSubjects] Llamando syncAllSilent...`);
      await syncService.syncAllSilent().catch(err => console.warn("[DEBUG ColegioSubjects] Auto-sync error:", err));

      await emit("show-toast", {
        message: "✅ Asignación actualizada",
        type: "success",
      });
      // Emitir evento para que otras páginas refresquen las asignaturas
      await emit("subjects-updated");
    } catch (error) {
      console.error("[DEBUG ColegioSubjects] Error bulk updating colegio subjects:", error);
      await emit("show-toast", {
        message: "❌ Error: " + error,
        type: "error",
      });
    }
  };

  const handleToggleDay = async (
    day: keyof Omit<ColegioDiasAsistencia, "colegioId">,
  ) => {
    if (!colegioConfig || !selectedColegio) return;

    const newConfig = { ...colegioConfig, [day]: !colegioConfig[day] };
    try {
      await invoke("save_colegio_dias_asistencia", { config: newConfig });
      setColegioConfig(newConfig);

      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));

      await emit("show-toast", {
        message: "✅ Configuración guardada",
        type: "success",
      });
      await emit("catalog-updated");
    } catch (error) {
      await emit("show-toast", {
        message: "❌ Error guardando configuración: " + error,
        type: "error",
      });
    }
  };

  const handleBulkDays = async (checked: boolean) => {
    if (!colegioConfig || !selectedColegio) return;

    const newConfig = {
      ...colegioConfig,
      lunes: checked,
      martes: checked,
      miercoles: checked,
      jueves: checked,
      viernes: checked,
      sabado: checked,
      domingo: checked,
    };

    try {
      await invoke("save_colegio_dias_asistencia", { config: newConfig });
      setColegioConfig(newConfig);

      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));

      await emit("show-toast", {
        message: `✅ Todos los días ${checked ? "marcados" : "desmarcados"}`,
        type: "success",
      });
      await emit("catalog-updated");
    } catch (error) {
      await emit("show-toast", {
        message: "❌ Error en actualización masiva: " + error,
        type: "error",
      });
    }
  };

  const fetchSubjectsData = async () => {
    try {
      console.log(
        "GlobalesPage: Fetching all subjects and assigned for grade:",
        selectedGrade?.id,
      );
      const [all, assigned] = await Promise.all([
        invoke<CategoryItem[]>("get_asignaturas"),
        invoke<CategoryItem[]>("get_subjects_by_grade", {
          gradoId: selectedGrade!.id,
        }),
      ]);
      console.log("GlobalesPage: All subjects:", all);
      console.log("GlobalesPage: Assigned subjects:", assigned);
      setAllSubjects(all);
      setAssignedSubjects(assigned.map((s) => s.id));
    } catch (error) {
      console.error("Error fetching subjects:", error);
    }
  };

  const toggleSubject = async (subjectId: number) => {
    if (!selectedGrade) return;
    const isAssigned = assignedSubjects.includes(subjectId);

    try {
      if (isAssigned) {
        await invoke("unassign_subject_from_grade", {
          gradoId: selectedGrade.id,
          asignaturaId: subjectId,
        });
        setAssignedSubjects((prev) => prev.filter((id) => id !== subjectId));
      } else {
        await invoke("assign_subject_to_grade", {
          gradoId: selectedGrade.id,
          asignaturaId: subjectId,
        });
        setAssignedSubjects((prev) => [...prev, subjectId]);
      }
      await emit("show-toast", {
        message: "✅ Currículo actualizado",
        type: "success",
      });
      // Emitir evento para que EvaluacionesPage refresque las asignaturas
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("subjects-updated");
    } catch (error) {
      await emit("show-toast", {
        message: "❌ Error updating curriculum: " + error,
        type: "error",
      });
    }
  };

  const handleBulkAction = async (action: "assign_all" | "unassign_all") => {
    if (!selectedGrade) return;
    try {
      if (action === "assign_all") {
        await invoke("assign_all_subjects_to_grade", {
          gradoId: selectedGrade.id,
        });
        setAssignedSubjects(allSubjects.map((s) => s.id));
      } else {
        await invoke("unassign_all_subjects_from_grade", {
          gradoId: selectedGrade.id,
        });
        setAssignedSubjects([]);
      }
      await emit("show-toast", {
        message: "✅ Currículo actualizado",
        type: "success",
      });
      // Emitir evento para que EvaluacionesPage refresque las asignaturas
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("subjects-updated");
    } catch (error) {
      await emit("show-toast", {
        message: "❌ Error: " + error,
        type: "error",
      });
    }
  };

  return (
    <div className="page-container">
      {/* Mobile View - Category Buttons */}
      {isMobile ? (
        <>
          {/* Category Selection Screen */}
          {!selectedCategory ? (
            <div style={{
              padding: '1rem',
            }}>
              <h1 style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                color: '#f1f5f9',
                marginBottom: '1.5rem',
                textAlign: 'center',
              }}>
                Datos Globales
              </h1>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.title}
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '1rem 1.25rem',
                      background: 'rgba(51, 65, 85, 0.5)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(51, 65, 85, 0.7)';
                      e.currentTarget.style.transform = 'translateX(4px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(51, 65, 85, 0.5)';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                    }}>
                      <div style={{
                        width: '4px',
                        height: '40px',
                        background: 'linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)',
                        borderRadius: '2px',
                      }} />
                      <span style={{
                        fontSize: '1rem',
                        fontWeight: '600',
                        color: '#e2e8f0',
                        textAlign: 'left',
                      }}>
                        {cat.title}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '1.25rem',
                      color: '#64748b',
                    }}>
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Category Detail Screen with Back Button */
            <div style={{
              padding: '1rem',
            }}>
              {/* Back Button */}
              <button
                onClick={() => setSelectedCategory(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem 1rem',
                  background: 'rgba(51, 65, 85, 0.5)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  marginBottom: '1rem',
                  width: '100%',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(51, 65, 85, 0.7)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(51, 65, 85, 0.5)';
                }}
              >
                <span style={{ fontSize: '1.25rem' }}>←</span>
                <span style={{
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  color: '#94a3b8',
                }}>
                  Volver a categorías
                </span>
              </button>
              
              {/* Category Content */}
              <CategoryTabContent
                config={selectedCategory}
                onConfigClick={(item) => {
                  if (selectedCategory.title === "Grado") setSelectedGrade(item);
                  if (selectedCategory.title === "Colegio") setSelectedColegio(item);
                }}
                onSubjectsClick={(item) => {
                  if (selectedCategory.title === "Colegio") setSelectedColegioForSubjects(item);
                }}
              />
            </div>
          )}
        </>
      ) : (
        /* Desktop View - Tabs */
        <>
          {/* Tab Navigation */}
          <div className="category-card" style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            background: 'rgba(26, 26, 26, 0.95)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}>
            <div style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.title}
                  onClick={() => setSelectedTab(cat.title)}
                  style={{
                    padding: '0.6rem 1.25rem',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    borderRadius: '8px',
                    border: selectedTab === cat.title
                      ? '1px solid rgba(59, 130, 246, 0.5)'
                      : '1px solid transparent',
                    background: selectedTab === cat.title
                      ? 'rgba(37, 99, 235, 0.2)'
                      : 'rgba(255,255,255,0.03)',
                    color: selectedTab === cat.title ? '#60a5fa' : '#94a3b8',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedTab !== cat.title) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                      e.currentTarget.style.color = '#e2e8f0';
                    } else {
                      e.currentTarget.style.background = 'rgba(37, 99, 235, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedTab !== cat.title) {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                      e.currentTarget.style.color = '#94a3b8';
                    } else {
                      e.currentTarget.style.background = 'rgba(37, 99, 235, 0.2)';
                    }
                  }}
                >
                  {cat.title}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div style={{
            width: '100%',
          }}>
            {CATEGORIES.filter(cat => cat.title === selectedTab).map((cat) => (
              <CategoryTabContent
                key={cat.title}
                config={cat}
                onConfigClick={(item) => {
                  if (cat.title === "Grado") setSelectedGrade(item);
                  if (cat.title === "Colegio") setSelectedColegio(item);
                }}
                onSubjectsClick={(item) => {
                  if (cat.title === "Colegio") setSelectedColegioForSubjects(item);
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* Modals */}
      {/* Curriculum Modal */}
      {selectedGrade && (
        <div className="modal-overlay">
          <div className="modal-content category-card">
            <div
              className="category-header"
              style={{
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                Materias: {selectedGrade.nombre}
              </h3>
              <div
                style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}
              >
                <button
                  onClick={() => handleBulkAction("assign_all")}
                  className="primary"
                  style={{ fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}
                >
                  Marcar todas
                </button>
                <button
                  onClick={() => handleBulkAction("unassign_all")}
                  className="cancel"
                  style={{ fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}
                >
                  Desmarcar todas
                </button>
                <button
                  onClick={() => setSelectedGrade(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "1.2rem",
                    marginLeft: "0.2rem",
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div
              className="item-list"
              style={{ maxHeight: "300px", overflowY: "auto" }}
            >
              {allSubjects.map((sub) => (
                <div
                  key={sub.id}
                  className="item-row"
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    justifyContent: "flex-start",
                  }}
                  onClick={() => toggleSubject(sub.id)}
                >
                  <label className="switch" style={{ pointerEvents: "none" }}>
                    <input
                      type="checkbox"
                      checked={assignedSubjects.includes(sub.id)}
                      readOnly
                    />
                    <span className="slider round"></span>
                  </label>
                  <span
                    style={{
                      flex: 1,
                      textAlign: "left",
                      fontWeight: assignedSubjects.includes(sub.id)
                        ? "bold"
                        : "normal",
                      color: assignedSubjects.includes(sub.id)
                        ? "#4ade80"
                        : "inherit",
                    }}
                  >
                    {sub.nombre}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Colegio Days Modal */}
      {selectedColegio && colegioConfig && (
        <div className="modal-overlay">
            <div className="modal-content category-card">
              <div
                className="category-header"
                style={{
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                  Días de Asistencia: {selectedColegio.nombre}
                </h3>
                <div
                  style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}
                >
                  <button
                    onClick={() => handleBulkDays(true)}
                    className="primary"
                    style={{ fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}
                  >
                    Marcar todos
                  </button>
                  <button
                    onClick={() => handleBulkDays(false)}
                    className="cancel"
                    style={{ fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}
                  >
                    Desmarcar todos
                  </button>
                  <button
                    onClick={() => setSelectedColegio(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "white",
                      cursor: "pointer",
                      fontSize: "1.2rem",
                      marginLeft: "0.2rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="item-list">
                {(
                  [
                    "lunes",
                    "martes",
                    "miercoles",
                    "jueves",
                    "viernes",
                    "sabado",
                    "domingo",
                  ] as const
                ).map((day) => (
                  <div
                    key={day}
                    className="item-row"
                    style={{
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      justifyContent: "flex-start",
                    }}
                    onClick={() => handleToggleDay(day)}
                  >
                    <label className="switch" style={{ pointerEvents: "none" }}>
                      <input
                        type="checkbox"
                        checked={colegioConfig[day]}
                        readOnly
                      />
                      <span className="slider round"></span>
                    </label>
                    <span
                      style={{
                        flex: 1,
                        textAlign: "left",
                        fontWeight: colegioConfig[day] ? "bold" : "normal",
                        color: colegioConfig[day] ? "#4ade80" : "inherit",
                        textTransform: "capitalize",
                      }}
                    >
                      {day}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      {/* Colegio Subjects Modal */}
      {selectedColegioForSubjects && (
        <div className="modal-overlay">
            <div className="modal-content category-card">
              <div
                className="category-header"
                style={{
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                  Asignaturas: {selectedColegioForSubjects.nombre}
                </h3>
                <div
                  style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}
                >
                  <button
                    onClick={() => handleBulkColegioSubject("assign_all")}
                    className="primary"
                    style={{ fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}
                  >
                    Marcar todas
                  </button>
                  <button
                    onClick={() => handleBulkColegioSubject("unassign_all")}
                    className="cancel"
                    style={{ fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}
                  >
                    Desmarcar todas
                  </button>
                  <button
                    onClick={() => setSelectedColegioForSubjects(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "white",
                      cursor: "pointer",
                      fontSize: "1.2rem",
                      marginLeft: "0.2rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div
                className="item-list"
                style={{ maxHeight: "300px", overflowY: "auto" }}
              >
                {allSubjects.map((sub) => {
                  const isAssigned = colegioSubjects.some(
                    (s) => s.id === sub.id,
                  );
                  return (
                    <div
                      key={sub.id}
                      className="item-row"
                      style={{
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        justifyContent: "flex-start",
                      }}
                      onClick={() => handleToggleColegioSubject(sub)}
                    >
                      <label
                        className="switch"
                        style={{ pointerEvents: "none" }}
                      >
                        <input type="checkbox" checked={isAssigned} readOnly />
                        <span className="slider round"></span>
                      </label>
                      <span
                        style={{
                          flex: 1,
                          textAlign: "left",
                          fontWeight: isAssigned ? "bold" : "normal",
                          color: isAssigned ? "#4ade80" : "inherit",
                        }}
                      >
                        {sub.nombre}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
