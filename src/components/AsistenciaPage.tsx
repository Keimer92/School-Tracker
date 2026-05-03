import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { syncService } from "../lib/syncService";
import { getLocalDateISOString } from "../lib/dateUtils";
import { ask } from "@tauri-apps/plugin-dialog";
import "../App.css";

interface CategoryItem {
  id: number;
  nombre: string;
  activo?: boolean;
}

interface EstudianteAsistencia {
  id: number;
  nombre: string;
  sexo: string;
  estado: string | null;
  observacion: string | null;
}

export function AsistenciaPage() {
  // Filtros
  const [anos, setAnos] = useState<CategoryItem[]>([]);
  const [colegios, setColegios] = useState<CategoryItem[]>([]);
  const [grados, setGrados] = useState<CategoryItem[]>([]);
  const [secciones, setSecciones] = useState<CategoryItem[]>([]);

  const [selectedAno, setSelectedAno] = useState<number>(() => Number(localStorage.getItem("selectedAno")) || 0);
  const [selectedColegio, setSelectedColegio] = useState<number>(() => Number(localStorage.getItem("selectedColegio")) || 0);
  const [selectedGrado, setSelectedGrado] = useState<number>(() => Number(localStorage.getItem("selectedGrado")) || 0);
  const [selectedSeccion, setSelectedSeccion] = useState<number>(() => Number(localStorage.getItem("selectedSeccion")) || 0);
  const [selectedSexo, setSelectedSexo] = useState<string>(() => localStorage.getItem("selectedSexo") || "");
  const [selectedFecha, setSelectedFecha] = useState<string>(() => {
    const savedFecha = sessionStorage.getItem("asistencia_selectedFecha");
    return savedFecha || getLocalDateISOString();
  });
  const [searchTerm, setSearchTerm] = useState("");

  const [colegioConfig, setColegioConfig] = useState<any>(null);
  const [isFechaHabilitada, setIsFechaHabilitada] = useState<boolean>(true);
  const [estudiantes, setEstudiantes] = useState<EstudianteAsistencia[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pressingStatus, setPressingStatus] = useState<string | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState<{show: boolean, type: string, stats: any}>({
    show: false,
    type: '',
    stats: null
  });

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Ref para rastrear los cambios locales (borrador) independientemente del estado de estudiantes
  // Esto permite que el estado sobreviva a refrescos automáticos provocados por eventos globales
  const draftRef = useRef<Record<number, { estado: string | null, observacion: string | null }>>({});

  // Al montar, intentar recuperar borrador de sessionStorage
  useEffect(() => {
    const savedDraft = sessionStorage.getItem("asistencia_draft");
    if (savedDraft) {
      try {
        draftRef.current = JSON.parse(savedDraft);
        if (Object.keys(draftRef.current).length > 0) {
          setHasUnsavedChanges(true);
        }
      } catch (e) {
        console.error("Error cargando borrador:", e);
      }
    }
  }, []);

  // Guardar borrador en sessionStorage cada vez que cambia
  const syncDraftToStorage = () => {
    if (Object.keys(draftRef.current).length > 0) {
      sessionStorage.setItem("asistencia_draft", JSON.stringify(draftRef.current));
    } else {
      sessionStorage.removeItem("asistencia_draft");
    }
  };

  const [selectedStudentDetail, setSelectedStudentDetail] = useState<EstudianteAsistencia | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  // Cargar catálogos iniciales
  useEffect(() => {
    fetchCatalogs();
  }, []);

  const fetchCatalogs = async () => {
    try {
      const [anosData, colegiosData, recommendedColegioId] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_colegios"),
        invoke<number>("get_recommended_colegio"),
      ]);
      setAnos(anosData);
      setColegios(colegiosData);
      
      const activeAno = anosData.find(a => a.activo)?.id || (anosData.length > 0 ? anosData[0].id : 0);
      
      // Lógica de recomendación: Priorizar el recomendado para hoy (alfabético entre los de hoy)
      // Si no hay recomendado (ej: hoy es domingo y ninguno tiene domingo), usar el activo o el primero.
      let colegioToSelect = 0;
      if (recommendedColegioId && recommendedColegioId > 0) {
        colegioToSelect = recommendedColegioId;
      } else {
        const activeColegio = colegiosData.find(c => c.activo)?.id || (colegiosData.length > 0 ? colegiosData[0].id : 0);
        colegioToSelect = activeColegio;
      }

      const savedAno = localStorage.getItem("selectedAno");
      // Nota: Ignoramos el savedColegio de localStorage para forzar la recomendación diaria según pidió el usuario
      
      if (savedAno) {
        setSelectedAno(Number(savedAno));
      } else if (activeAno) {
        setSelectedAno(activeAno);
      }

      if (colegioToSelect) {
        setSelectedColegio(colegioToSelect);
      }
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: "❌ Error al cargar catálogos: " + error, type: "error" });
    }
  };

  // Cargar grados cuando cambie el colegio o el año
  useEffect(() => {
    if (selectedColegio && selectedAno) {
      fetchGrados();
      fetchColegioConfig();
    } else {
      setGrados([]);
      setSelectedGrado(0);
    }
  }, [selectedColegio, selectedAno, refreshTrigger]);

  const fetchColegioConfig = async () => {
    try {
      const config = await invoke("get_colegio_dias_asistencia", { colegioId: selectedColegio });
      setColegioConfig(config);
    } catch (error) {
      console.error("Error fetching colegio config:", error);
      await emit("show-toast", { message: "❌ Error al cargar configuración del colegio: " + error, type: "error" });
    }
  };

  // Validar si la fecha está habilitada según el colegio
  useEffect(() => {
    if (!selectedFecha || !colegioConfig) {
      setIsFechaHabilitada(true);
      return;
    }

    const date = new Date(selectedFecha + "T12:00:00");
    const dayNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const dayName = dayNames[date.getDay()];
    
    const habilitado = colegioConfig[dayName] !== false; // Default true if undefined
    setIsFechaHabilitada(habilitado);

    if (!habilitado) {
      setEstudiantes([]);
    }
  }, [selectedFecha, colegioConfig]);

  const fetchGrados = async () => {
    try {
      const gradosData = await invoke<CategoryItem[]>("get_grados_by_colegio", {
        colegioId: selectedColegio,
        anoLectivoId: selectedAno
      });
      setGrados(gradosData);
      
      if (gradosData.length > 0) {
        const stillExists = gradosData.some(g => g.id === selectedGrado);
        if (!stillExists) {
          setSelectedGrado(gradosData[0].id);
        }
      } else {
        setSelectedGrado(0);
      }
    } catch (error) {
      console.error("Error fetching grados:", error);
      await emit("show-toast", { message: "❌ Error al cargar grados: " + error, type: "error" });
    }
  };

  // Cargar secciones cuando cambie el grado, el colegio o el año
  useEffect(() => {
    if (selectedGrado && selectedColegio && selectedAno) {
      fetchSecciones();
    } else {
      setSecciones([]);
      setSelectedSeccion(0);
    }
  }, [selectedGrado, selectedColegio, selectedAno, refreshTrigger]);

  const fetchSecciones = async () => {
    try {
      const data: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", {
        gradoId: selectedGrado,
        colegioId: selectedColegio,
        anoLectivoId: selectedAno
      });
      setSecciones(data);
      
      if (data.length > 0) {
        const stillExists = data.some(s => s.id === selectedSeccion);
        if (!stillExists) {
          setSelectedSeccion(data[0].id);
        }
      } else {
        setSelectedSeccion(0);
      }
    } catch (error) {
      console.error("Error fetching secciones:", error);
      await emit("show-toast", { message: "❌ Error al cargar secciones: " + error, type: "error" });
    }
  };

  // Escuchar actualizaciones de estudiantes y catálogos desde otros componentes
  useEffect(() => {
    const unlistenStudent = listen("student-updated", () => {
      console.log("Evento student-updated recibido en AsistenciaPage, refrescando...");
      setRefreshTrigger(prev => prev + 1);
    });

    const unlistenCatalog = listen("catalog-updated", () => {
      console.log("Evento catalog-updated recibido en AsistenciaPage, refrescando catálogos...");
      fetchCatalogs();
      fetchColegioConfig();
      setRefreshTrigger(prev => prev + 1);
    });

    const unlistenSubjects = listen("subjects-updated", () => {
      console.log("Evento subjects-updated recibido en AsistenciaPage, refrescando...");
      fetchColegioConfig();
    });

    return () => {
      unlistenStudent.then(f => f());
      unlistenCatalog.then(f => f());
      unlistenSubjects.then(f => f());
    };
  }, [fetchColegioConfig]);

  // Cargar estudiantes cuando cambien los filtros o la fecha
  useEffect(() => {
    // Guardar filtros en localStorage para persistencia entre páginas
    if (selectedAno) localStorage.setItem("selectedAno", selectedAno.toString());
    if (selectedColegio) localStorage.setItem("selectedColegio", selectedColegio.toString());
    if (selectedGrado) localStorage.setItem("selectedGrado", selectedGrado.toString());
    if (selectedSeccion) localStorage.setItem("selectedSeccion", selectedSeccion.toString());
    if (selectedSexo !== undefined) localStorage.setItem("selectedSexo", selectedSexo);
    if (selectedFecha) sessionStorage.setItem("asistencia_selectedFecha_v2", selectedFecha);

    if (selectedAno && selectedColegio && selectedGrado && selectedSeccion && selectedFecha && isFechaHabilitada) {
      fetchEstudiantes();
    }
  }, [selectedAno, selectedColegio, selectedGrado, selectedSeccion, selectedSexo, selectedFecha, isFechaHabilitada, refreshTrigger]);

  const fetchEstudiantes = async () => {
    setLoading(true);
    try {
      const data = await invoke<EstudianteAsistencia[]>("get_asistencia_estudiantes", {
        fecha: selectedFecha,
        anoLectivoId: selectedAno,
        colegioId: selectedColegio,
        gradoId: selectedGrado,
        seccionId: selectedSeccion,
        sexo: selectedSexo || null,
      });
      
      // Aplicar el borrador local sobre los datos frescos de la BD/API
      const mergedData = data.map(est => {
        const draft = draftRef.current[est.id];
        if (draft) {
          return {
            ...est,
            estado: draft.estado !== undefined ? draft.estado : est.estado,
            observacion: draft.observacion !== undefined ? draft.observacion : est.observacion
          };
        }
        return est;
      });

      setEstudiantes(mergedData);
    } catch (error) {
      console.error("Error fetching students:", error);
      await emit("show-toast", { message: "❌ Error al cargar estudiantes: " + error, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const saveChanges = async (updatedEstudiantes: EstudianteAsistencia[]) => {
    setSaving(true);
    try {
      const records = updatedEstudiantes
        .filter(est => est.estado) // Solo guardar los que tienen estado seleccionado
        .map(est => ({
          estudianteId: est.id,
          fecha: selectedFecha,
          estado: est.estado,
          observacion: est.observacion
        }));

      // Siempre enviamos aunque esté vacío para limpiar si es necesario, 
      // pero aquí filtramos por estado. Si queremos permitir borrar, 
      // la lógica actual solo guarda los que tienen estado.
      // Si records es vacío, significa que nadie tiene estado (o se borraron todos).
      // Si queremos borrar en BD, necesitamos enviar el registro con estado null o borrarlo.
      // La implementación actual de save_asistencia probablemente hace upsert.
      
      if (records.length === 0) {
        // Si no hay registros con estado, podría ser que se limpiaron todos.
        // Pero save_asistencia espera registros.
        setSaving(false);
        // Si todos los estados son "-", significa que el usuario quiere limpiar la asistencia
        // Podemos llamar a una función específica para borrar la asistencia de ese día si es necesario,
        // o simplemente no hacer nada y decir que se guardó (ya que localmente se ve limpio).
        // Sin embargo, para persistir el "borrado" en la BD, necesitaríamos una lógica de borrado.
        // Asumiendo que save_asistencia hace upsert, si no mandamos nada, no borra lo existente.
        
        // Vamos a verificar si la intención era borrar.
        const intentClear = updatedEstudiantes.every(est => !est.estado || est.estado === '-');
        if (intentClear) {
             try {
                // Si existe un endpoint para borrar asistencia por día/sección, llamarlo aquí.
                // Si no, podríamos enviar registros con un estado especial o null si el backend lo soporta.
                // Por ahora, solo simularemos el guardado para que no se quede pegado.
                await emit("show-toast", { message: "⚠️ No hay asistencias marcadas para guardar.", type: "warning" });
             } catch (e) {
                console.error(e);
             }
        }
        return;
      }

      await invoke("save_asistencia", { records });

      // Limpiar borrador tras guardado exitoso
      draftRef.current = {};
      syncDraftToStorage();
      
      // Reset unsaved changes and stop loading indicator immediately after local success
      setHasUnsavedChanges(false);
      setSaving(false);
      await emit("show-toast", { message: "✅ Asistencia guardada localmente", type: "success" });

      // Background synchronization (Non-blocking)
      (async () => {
        try {
          await syncService.syncAsistenciaBatch(records);
          console.log("LOG [Sincronización]: Asistencia sincronizada con éxito");
        } catch (syncError) {
          console.error("Error en sincronización background:", syncError);
          // Opcional: avisar que la nube está pendiente, pero de forma discreta
        }
      })();
      
      // Emitir evento para refrescar InformePage si está abierto
      try {
        await emit("asistencia-updated");
      } catch (eventError) {
        console.error("Error al emitir evento:", eventError);
      }
    } catch (error) {
      console.error("Error saving attendance:", error);
      await emit("show-toast", { message: "❌ Error al guardar asistencia: " + error, type: "error" });
      setSaving(false);
    }
  };

  const handleManualSave = async () => {
    await saveChanges(estudiantes);
    await emit("show-toast", { message: "✅ Asistencia guardada correctamente", type: "success" });
  };

  const handleEstadoChange = (estudianteId: number, estado: string) => {
    // Actualizar borrador
    draftRef.current[estudianteId] = { 
      ...draftRef.current[estudianteId], 
      estado 
    };
    syncDraftToStorage();

    const updated = estudiantes.map(est => 
      est.id === estudianteId ? { ...est, estado } : est
    );
    setEstudiantes(updated);
    setHasUnsavedChanges(true);
  };

  const handleObservacionChange = (estudianteId: number, observacion: string) => {
    // Actualizar borrador
    draftRef.current[estudianteId] = { 
      ...draftRef.current[estudianteId], 
      observacion 
    };
    syncDraftToStorage();

    const updated = estudiantes.map(est => 
      est.id === estudianteId ? { ...est, observacion } : est
    );
    setEstudiantes(updated);
    setHasUnsavedChanges(true);
  };

  const marcarTodos = (estado: string) => {
    // Actualizar borrador para todos los estudiantes actuales
    estudiantes.forEach(est => {
      draftRef.current[est.id] = { 
        ...draftRef.current[est.id], 
        estado 
      };
    });
    syncDraftToStorage();

    const updated = estudiantes.map(est => ({ ...est, estado }));
    setEstudiantes(updated);
    setHasUnsavedChanges(true);
  };

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const limpiarAsistencia = () => {
    setShowClearConfirm(true);
  };

  const confirmClearAllStatus = async () => {
    // Actualizar borrador local y marcar como no guardado
    estudiantes.forEach(est => {
      draftRef.current[est.id] = {
        estado: "-",
        observacion: ''
      };
    });
    syncDraftToStorage();

    const updated = estudiantes.map(est => ({
      ...est,
      estado: "-",
      observacion: ''
    }));
    setEstudiantes(updated);
    setHasUnsavedChanges(true);
    setShowClearConfirm(false);
    await emit("show-toast", { message: "🧹 Asistencia limpiada. Recuerda guardar los cambios.", type: "info" });
  };

  const handleLongPressStart = (estado: string) => {
    // Evitar múltiples timers si ya hay uno
    if (longPressTimer.current) return;

    setPressingStatus(estado);
    longPressTimer.current = setTimeout(() => {
      marcarTodos(estado);
      setPressingStatus(null);
      longPressTimer.current = null;
      
      // Feedback visual
      const card = document.querySelector(`.summary-card.${estado.toLowerCase()}`);
      if (card) {
        card.classList.add('pulse-feedback');
        setTimeout(() => card.classList.remove('pulse-feedback'), 500);
      }
    }, 1500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setPressingStatus(null);
  };

  const handleCardClick = (type: string, stats: any) => {
    // Si es un clic breve (no un long press), mostrar el modal
    setShowSummaryModal({
      show: true,
      type,
      stats
    });
  };

  // Cálculos dinámicos de totales
  const totalEstudiantes = estudiantes.length;
  const totalM = estudiantes.filter(e => e.sexo === 'M').length;
  const totalF = estudiantes.filter(e => e.sexo === 'F').length;

  const getStats = (estado: string | null) => {
    const filtered = estudiantes.filter(e => e.estado === estado);
    return {
      total: filtered.length,
      m: filtered.filter(e => e.sexo === 'M').length,
      f: filtered.filter(e => e.sexo === 'F').length
    };
  };

  const statsP = getStats('P');
  const statsA = getStats('A');
  const statsJ = getStats('J');

  const colegioNombre = colegios.find(c => c.id === selectedColegio)?.nombre || "";
  const gradoNombre = grados.find(g => g.id === selectedGrado)?.nombre || "";
  const seccionNombre = secciones.find(s => s.id === selectedSeccion)?.nombre || "";

  const [expandedObs, setExpandedObs] = useState<Record<number, boolean>>({});

  const toggleObs = (id: number) => {
    setExpandedObs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredEstudiantes = estudiantes.filter(est => 
    est.nombre.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleFilterChange = async (setter: Function, value: any) => {
    if (hasUnsavedChanges) {
      const answer = await ask('Tienes cambios sin guardar. ¿Deseas guardarlos antes de continuar?', {
        title: 'Cambios sin guardar',
        kind: 'warning',
        okLabel: 'Guardar',
        cancelLabel: 'Descartar'
      });
      
      if (answer) {
        await saveChanges(estudiantes);
        // After save, we proceed to change filter
        setHasUnsavedChanges(false);
        setter(value);
      } else {
        // User chose to discard changes
        draftRef.current = {}; // Limpiamos borrador explícitamente
        syncDraftToStorage();
        setHasUnsavedChanges(false); 
        setter(value);
      }
    } else {
      setter(value);
    }
  };

  return (
    <div className="page-container">
      <style>
        {`
          .asistencia-summary {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 0.5rem;
            margin-top: 0.5rem;
          }
          .summary-card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 0.5rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            min-height: 60px;
            transition: all 0.2s ease;
            /* Desactivar selección de texto */
            user-select: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
            -webkit-tap-highlight-color: transparent;
          }
          .summary-label {
            font-size: 0.65rem;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.025em;
            margin-bottom: 2px;
            display: block !important;
          }
          .summary-value {
            font-size: 1.1rem;
            font-weight: 700;
            color: #fff;
            line-height: 1;
          }
          .gender-labels {
            display: flex;
            gap: 0.4rem;
            margin-top: 4px;
            font-size: 0.6rem;
            font-weight: 600;
          }
          .gender-f { color: #f472b6; }
          .gender-m { color: #60a5fa; }
          
          .summary-card.students { border-left: 3px solid #3b82f6; }
          .summary-card.p { border-left: 3px solid #10b981; }
          .summary-card.a { border-left: 3px solid #ef4444; }
          .summary-card.j { border-left: 3px solid #f59e0b; }
          
          .summary-card.pressing {
            transform: scale(0.95);
            background: rgba(255, 255, 255, 0.1);
          }
          .pressing-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(3px);
            pointer-events: none;
          }
          .mass-marking-spinner {
            width: 60px;
            height: 60px;
            border: 5px solid rgba(255, 255, 255, 0.1);
            border-left-color: #3b82f6;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-bottom: 1rem;
            box-shadow: 0 0 15px rgba(59, 130, 246, 0.5);
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }

          @media (max-width: 600px) {
            .asistencia-summary {
              grid-template-columns: repeat(2, 1fr);
            }
          }
          .asistencia-opt {
            width: 30px !important;
            height: 30px !important;
            font-size: 0.8rem !important;
          }
          .asistencia-options-mobile {
            gap: 4px !important;
            justify-content: center;
          }
        `}
      </style>
      <div className="category-grid" style={{ display: 'block' }}>
        {/* Filtros de Búsqueda (Mismo estilo que NotasPage) */}
      <div className="sticky-filters"
        style={{ 
        position: 'sticky', 
        top: 0, 
        zIndex: 1000, 
        background: '#0f172a',
        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        width: '100%',
        borderRadius: '0 0 12px 12px',
        border: '1px solid rgba(255,255,255,0.05)',
        borderTop: 'none',
        padding: '0.4rem'
      }}>
        <div className="filters-row" style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: '0.4rem',
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
          marginBottom: '0.5rem'
        }}>
            <div className="input-container-small">
              {!isMobile && <label>Fecha:</label>}
              <input 
                type="date" 
                className={`filter-select ${!isFechaHabilitada ? 'invalid-date' : ''}`}
                style={{ 
                  padding: '0.3rem 0.4rem', 
                  fontSize: '0.75rem', 
                  height: '28px',
                  border: !isFechaHabilitada ? '1px solid #ef4444' : undefined,
                  color: !isFechaHabilitada ? '#ef4444' : 'inherit'
                }}
                value={selectedFecha} 
                onChange={(e) => handleFilterChange(setSelectedFecha, e.target.value)} 
                title={!isFechaHabilitada ? "Este colegio no tiene habilitada la asistencia para este día" : ""}
              />
            </div>
            <div className="input-container-small">
              {!isMobile && <label>Año Lectivo:</label>}
              <select 
                className="filter-select"
                style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px' }}
                value={selectedAno} 
                onChange={(e) => handleFilterChange(setSelectedAno, Number(e.target.value))}
              >
                {anos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
            <div className="input-container-small">
              {!isMobile && <label>Colegio:</label>}
              <select 
                className="filter-select"
                style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px' }}
                value={selectedColegio} 
                onChange={(e) => handleFilterChange(setSelectedColegio, Number(e.target.value))}
              >
                {colegios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="input-container-small">
              {!isMobile && <label>Grado:</label>}
              <select 
                className="filter-select"
                style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px' }}
                value={selectedGrado} 
                onChange={(e) => handleFilterChange(setSelectedGrado, Number(e.target.value))}
              >
                {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div className="input-container-small">
              {!isMobile && <label>Sección:</label>}
              <select 
                className="filter-select"
                style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px' }}
                value={selectedSeccion} 
                onChange={(e) => handleFilterChange(setSelectedSeccion, Number(e.target.value))}
              >
                {secciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div className="input-container-small">
              {!isMobile && <label>Sexo:</label>}
              <select 
                className="filter-select"
                style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px' }}
                value={selectedSexo} 
                onChange={(e) => handleFilterChange(setSelectedSexo, e.target.value)}
              >
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>

              <button 
                type="button"
                className="primary"
                onClick={handleManualSave}
                disabled={!hasUnsavedChanges || saving}
                style={{ 
                  padding: '0.3rem 0.8rem',
                  borderRadius: '6px',
                  width: 'auto',
                  fontSize: '0.75rem',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: hasUnsavedChanges ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                  color: hasUnsavedChanges ? 'white' : '#94a3b8',
                  cursor: hasUnsavedChanges ? 'pointer' : 'default',
                  fontWeight: 'bold',
                  boxShadow: hasUnsavedChanges ? '0 0 10px rgba(59, 130, 246, 0.5)' : 'none',
                  transition: 'all 0.3s ease'
                }}
              >
                {saving ? (
                  <>
                     <span className="saving-dot"></span> Guardando...
                  </>
                ) : (
                  <>💾 Guardar</>
                )}
              </button>

              <button 
                type="button"
                className="icon-button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  limpiarAsistencia();
                }}
                disabled={estudiantes.length === 0}
                style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '0.3rem 0.5rem',
                  borderRadius: '6px',
                  width: 'auto',
                  fontSize: '0.7rem',
                  height: '28px',
                  opacity: estudiantes.length === 0 ? 0.5 : 1,
                  cursor: estudiantes.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                🧹 Limpiar
              </button>
              
              <div className="search-container" style={{ flex: 1, minWidth: '150px' }}>
                <span className="search-icon-left">🔍</span>
                <input 
                  type="text" 
                  className="search-input search-input-with-icon" 
                  placeholder="Buscar..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ 
                    width: '100%', 
                    padding: '0.3rem 0.5rem 0.3rem 1.8rem', 
                    fontSize: '0.75rem', 
                    height: '28px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    color: 'white'
                  }}
                />
                {searchTerm && (
                  <span 
                    className="search-clear-icon" 
                    onClick={() => setSearchTerm("")}
                    style={{ top: '50%', transform: 'translateY(-50%)', right: '8px', fontSize: '0.7rem' }}
                  >
                    ✕
                  </span>
                )}
              </div>
            </div>
          </div>

        {isMobile && (
          <div className="asistencia-summary-mobile" style={{ 
            marginTop: '0',
            marginLeft: '-0.4rem',
            marginRight: '-0.4rem',
            paddingTop: '0.5rem',
            paddingBottom: '0.2rem',
            paddingLeft: '0.4rem',
            paddingRight: '0.4rem',
            width: 'calc(100% + 0.8rem)',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'stretch'
          }}>
            {/* Card 1: Sexo (F, M) */}
            <div style={{
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'center',
               gap: '0.8rem',
               background: 'rgba(255, 255, 255, 0.05)',
               borderRadius: '8px',
               padding: '0 0.6rem',
               flex: '0 0 auto'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                   <span style={{ color: '#f472b6', fontWeight: 'bold', fontSize: '0.8rem' }}>F:</span>
                   <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{totalF}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                   <span style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '0.8rem' }}>M:</span>
                   <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{totalM}</span>
                </div>
            </div>

            {/* Card 2: Estados (E, P, A, J) */}
            <div style={{
               display: 'flex',
               alignItems: 'center',
               justifyContent: 'space-around',
               gap: '0.3rem',
               background: 'rgba(255, 255, 255, 0.05)',
               borderRadius: '8px',
               padding: '0 0.3rem',
               flex: '1',
               userSelect: 'none',
               WebkitUserSelect: 'none',
               WebkitTouchCallout: 'none'
            }}>
                <div 
                  className="summary-item-mobile" 
                  onClick={() => handleCardClick('Total', { total: totalEstudiantes, m: totalM, f: totalF })}
                  style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}
                >
                  <span style={{ color: '#06b6d4', fontWeight: 'bold', fontSize: '0.8rem' }}>E:</span>
                  <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{totalEstudiantes}</span>
                </div>

                <div 
                  className={`summary-item-mobile ${pressingStatus === 'P' ? 'pressing' : ''}`}
                  onClick={() => handleCardClick('Presentes', statsP)}
                  onMouseDown={() => handleLongPressStart('P')}
                  onMouseUp={handleLongPressEnd}
                  onMouseLeave={handleLongPressEnd}
                  onTouchStart={(e) => { 
                    e.preventDefault(); 
                    handleLongPressStart('P'); 
                  }}
                  onTouchEnd={handleLongPressEnd}
                  style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer', position: 'relative' }}
                >
                  <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.8rem' }}>P:</span>
                  <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsP.total}</span>
                </div>

                <div 
                  className={`summary-item-mobile ${pressingStatus === 'A' ? 'pressing' : ''}`}
                  onClick={() => handleCardClick('Ausentes', statsA)}
                  onMouseDown={() => handleLongPressStart('A')}
                  onMouseUp={handleLongPressEnd}
                  onMouseLeave={handleLongPressEnd}
                  onTouchStart={(e) => { 
                    e.preventDefault(); 
                    handleLongPressStart('A'); 
                  }}
                  onTouchEnd={handleLongPressEnd}
                  style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer', position: 'relative' }}
                >
                  <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.8rem' }}>A:</span>
                  <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsA.total}</span>
                </div>

                <div 
                  className={`summary-item-mobile ${pressingStatus === 'J' ? 'pressing' : ''}`}
                  onClick={() => handleCardClick('Justificados', statsJ)}
                  onMouseDown={() => handleLongPressStart('J')}
                  onMouseUp={handleLongPressEnd}
                  onMouseLeave={handleLongPressEnd}
                  onTouchStart={(e) => { 
                    e.preventDefault(); 
                    handleLongPressStart('J'); 
                  }}
                  onTouchEnd={handleLongPressEnd}
                  style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer', position: 'relative' }}
                >
                  <span style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '0.8rem' }}>J:</span>
                  <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsJ.total}</span>
                </div>
            </div>
          </div>
        )}
      </div>

      {/* Información del Reporte (Visible en impresión) */}
      <div className="report-header-info">
          <div className="report-title-section">
            <h2>Control de Asistencia</h2>
            <div className="report-date-badge">
              Fecha: {selectedFecha.split('-').reverse().join('/')}
            </div>
          </div>
          
          <div className="report-details-grid">
            <div className="detail-item">
              <span className="detail-label">Colegio:</span>
              <span className="detail-value">{colegioNombre}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Grado y Sección:</span>
              <span className="detail-value">{gradoNombre} - {seccionNombre}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Filtro Sexo:</span>
              <span className="detail-value">{selectedSexo === 'M' ? 'Masculino' : selectedSexo === 'F' ? 'Femenino' : 'Todos'}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Año Lectivo:</span>
              <span className="detail-value">{anos.find(a => a.id === selectedAno)?.nombre || ""}</span>
            </div>
          </div>
        </div>



        <div className="table-container" style={{ 
          width: '100%',
          padding: '0', 
          overflowX: 'hidden', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center' 
        }}>
        {/* Resumen de Asistencia */}
        {!isMobile && (
          <div className="asistencia-summary" style={{ margin: '0.5rem 0', padding: '0 0.4rem', width: '100%', maxWidth: '100%' }}>
          <div className="summary-card students" onClick={() => handleCardClick('Total', { total: totalEstudiantes, m: totalM, f: totalF })}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold', fontSize: '0.95rem' }}>
              <span><span style={{ color: '#06b6d4' }}>E</span>: {totalEstudiantes}</span>
              <span className="gender-m" style={{ marginLeft: '2px' }}>M: {totalM}</span>
              <span className="gender-f" style={{ marginLeft: '2px' }}>F: {totalF}</span>
            </div>
          </div>
          <div 
            className={`summary-card p ${pressingStatus === 'P' ? 'pressing' : ''}`}
            onClick={() => handleCardClick('Presentes', statsP)}
            onMouseDown={() => handleLongPressStart('P')}
            onMouseUp={handleLongPressEnd}
            onMouseLeave={handleLongPressEnd}
            onTouchStart={(e) => { 
              e.preventDefault(); 
              handleLongPressStart('P'); 
            }}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            title="Mantén presionado para marcar todos como Presente"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold', fontSize: '0.95rem' }}>
              <span><span style={{ color: '#10b981' }}>P</span>: {statsP.total}</span>
              <span className="gender-m" style={{ marginLeft: '2px' }}>M: {statsP.m}</span>
              <span className="gender-f" style={{ marginLeft: '2px' }}>F: {statsP.f}</span>
            </div>
          </div>
          <div 
            className={`summary-card a ${pressingStatus === 'A' ? 'pressing' : ''}`}
            onClick={() => handleCardClick('Ausentes', statsA)}
            onMouseDown={() => handleLongPressStart('A')}
            onMouseUp={handleLongPressEnd}
            onMouseLeave={handleLongPressEnd}
            onTouchStart={(e) => { 
              e.preventDefault(); 
              handleLongPressStart('A'); 
            }}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            title="Mantén presionado para marcar todos como Ausente"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold', fontSize: '0.95rem' }}>
              <span><span style={{ color: '#ef4444' }}>A</span>: {statsA.total}</span>
              <span className="gender-m" style={{ marginLeft: '2px' }}>M: {statsA.m}</span>
              <span className="gender-f" style={{ marginLeft: '2px' }}>F: {statsA.f}</span>
            </div>
          </div>
          <div 
            className={`summary-card j ${pressingStatus === 'J' ? 'pressing' : ''}`}
            onClick={() => handleCardClick('Justificados', statsJ)}
            onMouseDown={() => handleLongPressStart('J')}
            onMouseUp={handleLongPressEnd}
            onMouseLeave={handleLongPressEnd}
            onTouchStart={(e) => { 
              e.preventDefault(); 
              handleLongPressStart('J'); 
            }}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            title="Mantén presionado para marcar todos como Justificado"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold', fontSize: '0.95rem' }}>
              <span><span style={{ color: '#f59e0b' }}>J</span>: {statsJ.total}</span>
              <span className="gender-m" style={{ marginLeft: '2px' }}>M: {statsJ.m}</span>
              <span className="gender-f" style={{ marginLeft: '2px' }}>F: {statsJ.f}</span>
            </div>
          </div>
        </div>
        )}
          {loading ? (
            <div className="loading-state">Cargando estudiantes...</div>
          ) : !isFechaHabilitada ? (
            <div className="empty-state" style={{ 
              padding: '40px', 
              textAlign: 'center', 
              background: 'rgba(239, 68, 68, 0.1)', 
              borderRadius: '12px',
              border: '1px dashed #ef4444',
              color: '#ef4444'
            }}>
              <h3>📅 Día no laborable</h3>
              <p>El colegio seleccionado no tiene habilitada la toma de asistencia para los días <strong>{
                new Date(selectedFecha + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'long' })
              }</strong>.</p>
              <p style={{ fontSize: '0.9rem', opacity: 0.8 }}>Puedes cambiar esto en la configuración de Colegios en la página Globales.</p>
            </div>
          ) : filteredEstudiantes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '5rem 2rem', border: '2px dashed rgba(255, 255, 255, 0.1)', borderRadius: '16px', margin: '0 1rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{searchTerm ? '🔍' : '📋'}</div>
              <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>
                {searchTerm ? 'No se encontraron resultados' : 'No hay estudiantes para mostrar'}
              </h4>
              <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
                {searchTerm 
                  ? `No se encontró ningún estudiante que coincida con "${searchTerm}"`
                  : 'No se encontraron estudiantes para los filtros seleccionados (Año, Colegio, Grado, Sección).'}
              </p>
              {searchTerm && (
                <button 
                  className="secondary" 
                  onClick={() => setSearchTerm("")}
                  style={{ marginTop: '1.5rem', padding: '0.5rem 1rem' }}
                >
                  Limpiar búsqueda
                </button>
              )}
            </div>
          ) : (
            <table className="custom-table" style={{ margin: '0.5rem auto 1.5rem auto', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '35px' }}>#</th>
                  <th style={{ textAlign: 'left' }}>Estudiante</th>
                  <th style={{ width: '105px' }}>Asistencia</th>
                  <th style={{ width: '45px' }}>Obs</th>
                </tr>
              </thead>
              <tbody>
                {filteredEstudiantes.map((est, index) => (
                  <tr key={est.id} className={expandedObs[est.id] ? 'row-expanded' : ''}>
                    <td>
                      <span className="student-number-badge">{index + 1}</span>
                    </td>
                    <td style={{ textAlign: 'left', overflow: 'hidden' }}>
                      <div 
                        className="student-name-container" 
                        style={{ 
                          fontWeight: 'bold', 
                          cursor: 'pointer', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '6px',
                          width: '100%'
                        }}
                        onClick={() => setSelectedStudentDetail(est)}
                      >
                        <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{est.sexo === 'F' ? '👩' : '👨'}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{est.nombre}</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: '22px' }}>{est.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                    </td>
                    <td>
                      <div className="asistencia-options-mobile">
                        <label className={`asistencia-opt ${est.estado === 'P' ? 'active p' : ''}`}>
                          <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'P'} onChange={() => handleEstadoChange(est.id, 'P')} />
                          <span>P</span>
                        </label>
                        <label className={`asistencia-opt ${est.estado === 'A' ? 'active a' : ''}`}>
                          <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'A'} onChange={() => handleEstadoChange(est.id, 'A')} />
                          <span>A</span>
                        </label>
                        <label className={`asistencia-opt ${est.estado === 'J' ? 'active j' : ''}`}>
                          <input type="radio" name={`asist-${est.id}`} checked={est.estado === 'J'} onChange={() => handleEstadoChange(est.id, 'J')} />
                          <span>J</span>
                        </label>
                      </div>
                    </td>
                    <td>
                      <button 
                        className={`obs-toggle-btn ${est.observacion ? 'has-obs' : ''} ${expandedObs[est.id] ? 'active' : ''}`}
                        onClick={() => toggleObs(est.id)}
                        title="Observaciones"
                      >
                        {est.observacion ? '📝' : '💬'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredEstudiantes.map((est) => expandedObs[est.id] && (
                  <tr key={`obs-${est.id}`} className="obs-row-expanded">
                    <td colSpan={4} style={{ padding: '0.5rem 1rem' }}>
                      <div className="obs-container-mobile">
                        <div style={{ position: 'relative', width: '100%' }}>
                          <textarea 
                            className="asistencia-obs-mobile"
                            value={est.observacion || ""} 
                            placeholder="Escribe una observación..."
                            onChange={(e) => handleObservacionChange(est.id, e.target.value)}
                            autoFocus
                          />
                          {est.observacion && (
                            <button 
                              className="clear-obs-btn"
                              onClick={() => handleObservacionChange(est.id, "")}
                              style={{
                                position: 'absolute',
                                right: '10px',
                                top: '10px',
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: 'none',
                                borderRadius: '50%',
                                width: '24px',
                                height: '24px',
                                color: '#ef4444',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                zIndex: 10
                              }}
                              title="Limpiar texto"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <button className="close-obs-btn" onClick={() => toggleObs(est.id)}>Aceptar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal de Detalles de Resumen */}
      {showSummaryModal.show && createPortal(
        <div className="modal-overlay" onClick={() => setShowSummaryModal({ ...showSummaryModal, show: false })}>
          <div 
            className="modal-content category-card" 
            style={{ width: '300px', maxWidth: '85%', padding: '1.2rem', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: '#60a5fa', fontSize: '1.2rem', marginBottom: '1rem' }}>
              📊 {showSummaryModal.type}
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <div style={{ 
                background: 'rgba(255,255,255,0.05)', 
                padding: '0.8rem', 
                borderRadius: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ color: '#94a3b8' }}>Total:</span>
                <span style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#fff' }}>
                  {showSummaryModal.stats?.total}
                </span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <div style={{ 
                  background: 'rgba(96, 165, 250, 0.1)', 
                  padding: '0.8rem', 
                  borderRadius: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <span style={{ color: '#60a5fa', fontSize: '0.8rem' }}>Masculino</span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#60a5fa' }}>
                    {showSummaryModal.stats?.m}
                  </span>
                </div>
                
                <div style={{ 
                  background: 'rgba(244, 114, 182, 0.1)', 
                  padding: '0.8rem', 
                  borderRadius: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <span style={{ color: '#f472b6', fontSize: '0.8rem' }}>Femenino</span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#f472b6' }}>
                    {showSummaryModal.stats?.f}
                  </span>
                </div>
              </div>
            </div>

            <button 
              className="primary" 
              onClick={() => setShowSummaryModal({ ...showSummaryModal, show: false })}
              style={{ marginTop: '1.5rem', width: '100%' }}
            >
              Cerrar
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Confirmación para Limpiar */}
      {showClearConfirm && createPortal(
        <div className="modal-overlay">
          <div className="modal-content category-card" style={{ width: '400px', maxWidth: '90%', padding: '1.5rem' }}>
            <h3 style={{ marginTop: 0, color: '#f87171' }}>⚠️ Confirmar Limpieza</h3>
            <div style={{ 
              margin: '1.5rem 0', 
              color: '#e2e8f0',
              fontSize: '0.95rem',
              lineHeight: '1.5'
            }}>
              ¿Está seguro de limpiar todos los estados de asistencia seleccionados?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button 
                className="cancel" 
                onClick={() => setShowClearConfirm(false)}
              >
                Cancelar
              </button>
              <button 
                className="primary" 
                onClick={confirmClearAllStatus}
                style={{ backgroundColor: '#ef4444' }}
              >
                Limpiar Todo
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de Detalle Estudiante */}
      {selectedStudentDetail && createPortal(
        <div className="modal-overlay" onClick={() => setSelectedStudentDetail(null)}>
          <div 
            className="modal-content category-card" 
            onClick={e => e.stopPropagation()}
            style={{ 
              width: '400px', 
              maxWidth: '90%', 
              padding: '1.5rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            <div style={{ 
              width: '60px', 
              height: '60px', 
              borderRadius: '50%', 
              backgroundColor: 'var(--primary-light)', 
              color: 'var(--primary-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              margin: '0 auto'
            }}>
              👤
            </div>

            <div>
              <h3 style={{ margin: '0.5rem 0', color: '#fff', fontSize: '1.2rem' }}>
                {selectedStudentDetail.nombre}
              </h3>
              <div style={{ 
                display: 'inline-block', 
                padding: '0.3rem 0.8rem', 
                borderRadius: '20px', 
                background: selectedStudentDetail.sexo === 'M' ? 'rgba(96, 165, 250, 0.1)' : 'rgba(244, 114, 182, 0.1)',
                color: selectedStudentDetail.sexo === 'M' ? '#60a5fa' : '#f472b6',
                fontSize: '0.85rem',
                fontWeight: '600',
                marginTop: '0.3rem'
              }}>
                {selectedStudentDetail.sexo === 'M' ? 'Masculino' : 'Femenino'}
              </div>
            </div>

            <button 
              className="primary" 
              onClick={() => setSelectedStudentDetail(null)}
              style={{ marginTop: '1rem', width: '100%' }}
            >
              Cerrar
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Overlay de marcación masiva */}
      {pressingStatus && createPortal(
        <div className="pressing-overlay">
          <div className="mass-marking-spinner"></div>
          <div style={{ 
            color: 'white', 
            fontWeight: 'bold', 
            fontSize: '1.1rem',
            textShadow: '0 2px 10px rgba(0,0,0,0.5)',
            textAlign: 'center',
            padding: '0 2rem'
          }}>
            Marcando todos como {
              pressingStatus === 'P' ? 'Presentes' : 
              pressingStatus === 'A' ? 'Ausentes' : 'Justificados'
            }...
          </div>
        </div>,
        document.body
      )}
      </div>
      );
      }