import SearchInput from './SearchInput';
import { FilterContainer, FilterGroup, FilterActions } from './FilterContainer';

import React, { useState, useEffect, useRef, useCallback, useMemo, Fragment, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { syncService } from "../lib/syncService";
import "../App.css";

interface CategoryItem {
  id: number;
  nombre: string;
  activo?: boolean;
  cualitativo?: boolean;
}

interface Criterio {
  id: number;
  orden: number;
  descripcion: string;
  puntajeMaximo: number;
}

interface Indicador {
  id: number;
  orden: number;
  descripcion: string;
  activo: boolean;
  criterios: Criterio[];
}

interface Estudiante {
  id: number;
  nombre: string;
  gradoId: number;
  seccionId: number;
  grado: string;
  seccion: string;
}

interface NotaEstudiante {
  estudianteId: number;
  estudianteNombre: string;
  notas: Record<number, number>;
}

const MemoRow = memo(({ est, index, renderRow }: { est: NotaEstudiante, index: number, renderRow: (est: NotaEstudiante, index: number) => React.ReactNode }) => {
  return <>{renderRow(est, index)}</>;
});

export function NotasPage() {
  // @ts-ignore
  const unlistenNotas = null;
  // Filtros
  const [anos, setAnos] = useState<CategoryItem[]>([]);
  const [cortes, setCortes] = useState<CategoryItem[]>([]);
  const [colegios, setColegios] = useState<CategoryItem[]>([]);
  const [asignaturas, setAsignaturas] = useState<CategoryItem[]>([]);
  const [grados, setGrados] = useState<CategoryItem[]>([]);
  const [secciones, setSecciones] = useState<CategoryItem[]>([]);

  const [selectedAno, setSelectedAno] = useState<number>(0);
  const [selectedCorte, setSelectedCorte] = useState<number>(0);
  const [selectedColegio, setSelectedColegio] = useState<number>(0);
  const [selectedAsignatura, setSelectedAsignatura] = useState<number>(() => {
    const saved = localStorage.getItem('notas-last-asignatura');
    return saved ? parseInt(saved) : 0;
  });
  const [selectedGrado, setSelectedGrado] = useState<number>(() => {
    const saved = localStorage.getItem('notas-last-grado');
    return saved ? parseInt(saved) : 0;
  });
  const [selectedSeccion, setSelectedSeccion] = useState<number>(0);
  const [selectedSexo, setSelectedSexo] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  // Configuración de evaluación
  const [indicadores, setIndicadores] = useState<Indicador[]>([]);
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [notas, setNotas] = useState<NotaEstudiante[]>([]);
  // Estado para almacenar notas cualitativas directamente
  const [notasCualitativas, setNotasCualitativas] = useState<Map<string, string>>(new Map());
  const [gradeConfigs, setGradeConfigs] = useState<{ id: string, nombre: string, color: string, minimo: number }[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const nextRefreshSilent = useRef(false);
  const [rowVersions, setRowVersions] = useState<Map<number, number>>(new Map());
  const [isQualitative, setIsQualitative] = useState(false);
  // editingStudentId eliminado — ahora se usa CSS :focus-within
  const [highlightColor, setHighlightColor] = useState<string>(() => {
    return localStorage.getItem('student-highlight-color') || '#4ade80';
  });
  
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    
    // Forzar orientación horizontal en móviles al entrar a esta página
    const lockOrientation = async () => {
      try {
        if (window.innerWidth <= 768 && screen.orientation && ('lock' in screen.orientation)) {
          // Forzar a landscape.
          // @ts-ignore
          await screen.orientation.lock("landscape");
        }
      } catch (err) {
        console.warn("No se pudo bloquear la orientación:", err);
      }
    };
    
    lockOrientation();

    return () => {
      window.removeEventListener('resize', handleResize);
      // Desbloquear al salir para volver a la orientación normal
      try {
        if (screen.orientation && ('unlock' in screen.orientation)) {
          // @ts-ignore
          screen.orientation.unlock();
        }
      } catch (err) {
        console.warn("No se pudo desbloquear la orientación:", err);
      }
    };
  }, []);

// Refs para filtros (para usar en listeners globales sin problemas de stale closure)
  const filtersRef = useRef({
    ano: selectedAno,
    corte: selectedCorte,
    colegio: selectedColegio,
    asignatura: selectedAsignatura,
    grado: selectedGrado,
    seccion: selectedSeccion,
    sexo: selectedSexo

  });

// Ref para notas cualitativas sin re-render durante escritura
  const notasCualitativasRef = useRef<Map<string, string>>(new Map());

  // Actualizar refs cuando cambian los filtros
  useEffect(() => {
    filtersRef.current = {
      ano: selectedAno,
      corte: selectedCorte,
      colegio: selectedColegio,
      asignatura: selectedAsignatura,
      grado: selectedGrado,
      seccion: selectedSeccion,
      sexo: selectedSexo
    };
  }, [selectedAno, selectedCorte, selectedColegio, selectedAsignatura, selectedGrado, selectedSeccion, selectedSexo]);

  // Escuchar actualizaciones de estudiantes y catálogos desde otros componentes
  useEffect(() => {
    let studentTimeout: NodeJS.Timeout;
    let notasTimeout: NodeJS.Timeout;
    let catalogTimeout: NodeJS.Timeout;

    const unlistenStudent = listen("student-updated", () => {
      clearTimeout(studentTimeout);
      studentTimeout = setTimeout(() => {
        console.log("🔔 [Realtime] Evento student-updated recibido en NotasPage (debounced)");
        nextRefreshSilent.current = true;
        setRefreshTrigger(prev => prev + 1);
      }, 500);
    });

    const unlistenNotas = listen("notas-updated", () => {
      clearTimeout(notasTimeout);
      notasTimeout = setTimeout(() => {
        console.log("🔔 [Realtime] Evento notas-updated recibido en NotasPage (debounced)");
        nextRefreshSilent.current = true;
        setRefreshTrigger(prev => prev + 1);
      }, 500);
    });

    const unlistenCatalog = listen("catalog-updated", () => {
      clearTimeout(catalogTimeout);
      catalogTimeout = setTimeout(() => {
        console.log("🔔 [Realtime] Evento catalog-updated recibido en NotasPage (debounced)");
        fetchCatalogs();
        if (selectedColegio && selectedAno) {
           fetchGradosYAsignaturas();
        }
        nextRefreshSilent.current = true;
        setRefreshTrigger(prev => prev + 1);
      }, 500);
    });

    return () => {
      unlistenStudent.then(f => f());
      unlistenCatalog.then(f => f());
      unlistenNotas.then(f => f());
    };
  }, []);

  const filteredNotas = React.useMemo(() => {
    if (!searchTerm) return notas;
    return notas.filter(n => n.estudianteNombre.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [notas, searchTerm]);

  // Sistema de Deshacer/Rehacer
  const [history, setHistory] = useState<Map<string, string>[]>([]);
  const [redoStack, setRedoStack] = useState<Map<string, string>[]>([]);
  const historyRef = useRef<Map<string, string>[]>([]);
  const redoStackRef = useRef<Map<string, string>[]>([]);
  const isUndoRedoAction = useRef(false);
  const cellSnapshot = useRef<Map<string, string> | null>(null);

  // Ref para notas cuantitativas (sin re-render)
  const notasCuantitativasRef = useRef<Map<string, number>>(new Map());

  // ===== Fase 3: Pre-computar lookups para evitar flatMap/findIndex repetidos =====
  const allCriterios = useMemo(() => indicadores.flatMap(ind => ind.criterios), [indicadores]);
  const criterioIndexMap = useMemo(() => new Map(allCriterios.map((c, i) => [c.id, i])), [allCriterios]);
  const totalColumns = useMemo(() => allCriterios.length, [allCriterios]);
  const studentIndexMap = useMemo(() => new Map(estudiantes.map((e, i) => [e.id, i])), [estudiantes]);

  // Sincronizar refs con el estado para que el UI sepa cuándo habilitar botones
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    redoStackRef.current = redoStack;
  }, [redoStack]);

  // Ref para almacenar referencias a los inputs de notas
  const inputsRef = useRef<Map<string, HTMLInputElement>>(new Map());

  // Cargar configuraciones de calificación
  const fetchGradeConfigs = async () => {
    try {
      console.log("[fetchGradeConfigs] Iniciando carga...");
      const configs = await invoke<{ id: string, nombre: string, color: string, minimo: number }[]>("get_grade_configs");
      console.log("[fetchGradeConfigs] configs desde BD:", configs);
      setGradeConfigs(configs);
      console.log("[fetchGradeConfigs] gradeConfigs seteado:", configs.length > 0 ? configs : "VACÍO");
      // Forzar re-render para actualizar colores
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error("[fetchGradeConfigs] Error:", error);
    }
  };

  // Forzar recarga de configs al montar el componente
  useEffect(() => {
    console.log("[useEffect] Mount, chiamando fetchGradeConfigs");
    fetchGradeConfigs();
  }, []);

  // Listeners para eventos globales
  useEffect(() => {
    let unlistenGradeConfigs: (() => void) | null = null;
    let unlistenNotas: (() => void) | null = null;
    let unlistenHighlightColor: (() => void) | null = null;
    let unlistenConfigEvaluacion: (() => void) | null = null;

    const setupListeners = async () => {
      unlistenGradeConfigs = await listen("grade-configs-updated", () => {
        console.log("Configuraciones de calificación actualizadas - recargando...");
        fetchGradeConfigs();
      });

      unlistenHighlightColor = await listen("highlight-color-updated", (event: any) => {
        console.log("Color de resaltado recibido en NotasPage:", event.payload);
        setHighlightColor(event.payload);
      });

      // Escuchar cambios en la configuración de indicadores/criterios
      unlistenConfigEvaluacion = await listen("indicadores-updated", async () => {
        console.log("NotasPage: Indicadores actualizados, recargando...");
        const newInd = await fetchConfiguracionEvaluacion(true);
        await fetchEstudiantes(newInd, true);
      });
    };

    setupListeners();

    return () => {
      if (unlistenGradeConfigs) unlistenGradeConfigs();
      // @ts-ignore
      if (typeof unlistenNotas === 'function') unlistenNotas();
      if (unlistenHighlightColor) unlistenHighlightColor();
      if (unlistenConfigEvaluacion) unlistenConfigEvaluacion();
    };
  }, [selectedAno, selectedCorte, selectedColegio, selectedAsignatura, selectedGrado, selectedSeccion]); // Re-suscribir si cambian los filtros para tener acceso a los valores actuales

  // Cargar catálogos iniciales
  useEffect(() => {
    fetchCatalogs();
  }, []);

  // Cargar configuraciones de calificación al montar
  useEffect(() => {
    console.log("Loading grade configs on mount...");
    fetchGradeConfigs();
  }, []);

  // Pre-sortear gradeConfigs una sola vez (Fase 3)
  const sortedGradeConfigs = useMemo(() => {
    const defaultConfigs = [
      { id: 'AA', color: '#22c55e', minimo: 90 },
      { id: 'AS', color: '#3b82f6', minimo: 70 },
      { id: 'AF', color: '#eab308', minimo: 50 },
      { id: 'AI', color: '#ef4444', minimo: 0 },
    ];
    const configs = gradeConfigs.length > 0 ? gradeConfigs : defaultConfigs;
    return [...configs].sort((a, b) => b.minimo - a.minimo);
  }, [gradeConfigs]);

  const getGradeFromScore = useCallback((score: number) => {
    const config = sortedGradeConfigs.find(c => score >= c.minimo);
    return config || { id: 'AI', color: '#ef4444', minimo: 0 };
  }, [sortedGradeConfigs]);

  const getGradeConfig = useCallback((gradeValue: string) => {
    const trimmedValue = gradeValue.trim().toUpperCase();
    const config = gradeConfigs.find(gc => gc.id === trimmedValue);
    return config || null;
  }, [gradeConfigs]);

  const getGradeColor = useCallback((value: string, maxScore?: number) => {
    if (!value) return '#94a3b8';
    const upperValue = value.trim().toUpperCase();
    if (['AA', 'AS', 'AF', 'AI'].includes(upperValue)) {
      const config = getGradeConfig(upperValue);
      if (config) return config.color;
      // Fallback si gradeConfigs está vacío
      if (upperValue === 'AA') return '#22c55e';
      if (upperValue === 'AS') return '#3b82f6';
      if (upperValue === 'AF') return '#eab308';
      if (upperValue === 'AI') return '#ef4444';
      return '#94a3b8';
    }
    if (maxScore !== undefined && !isNaN(parseFloat(value))) {
      const score = parseFloat(value);
      const normalizedScore = (score / maxScore) * 100;
      const config = getGradeFromScore(normalizedScore);
      return config ? config.color : '#94a3b8';
    }
    return '#94a3b8';
  }, [getGradeConfig, getGradeFromScore]);

  // Flag para evitar múltiples cargas rápidas
  const isLoadingRef = useRef(false);

  // Cargar estudiantes cuando cambien los filtros
  useEffect(() => {
    // Si ya está cargando o los filtros no están completos, salir
    if (isLoadingRef.current) return;
    
    const loadData = async () => {
      isLoadingRef.current = true;
      
      if (selectedAno > 0 && selectedCorte > 0 && selectedColegio > 0 && selectedAsignatura > 0 && selectedGrado > 0 && selectedSeccion > 0) {
        // Primero cargar la configuración de evaluación para tener los indicadores
        const currentIndicadores = await fetchConfiguracionEvaluacion();
        // Luego cargar los estudiantes y sus notas (que depende de los indicadores para el mapeo cualitativo)
        await fetchEstudiantes(currentIndicadores);
        
        // Limpiar historial al cambiar filtros
        historyRef.current = [];
        redoStackRef.current = [];
        setHistory([]);
        setRedoStack([]);
      } else {
        setEstudiantes([]);
        setNotas([]);
      }
      
      isLoadingRef.current = false;
    };
    
    loadData();
  }, [selectedAno, selectedCorte, selectedColegio, selectedAsignatura, selectedGrado, selectedSeccion, selectedSexo]);

  // Efecto separado solo para refrescos en tiempo real
  useEffect(() => {
    if (refreshTrigger > 0 && selectedAno > 0 && selectedCorte > 0 && selectedColegio > 0 && selectedAsignatura > 0 && selectedGrado > 0 && selectedSeccion > 0) {
      fetchEstudiantes();
    }
  }, [refreshTrigger]);

  // Atajos de teclado para deshacer/rehacer y guardar
  useEffect(() => {
    const handleKeyDownGlobal = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
      } else if (e.ctrlKey && e.key === 'g') {
        e.preventDefault();
        handleGuardarNotas();
      }
    };

    window.addEventListener('keydown', handleKeyDownGlobal);
    return () => window.removeEventListener('keydown', handleKeyDownGlobal);
  }, []);

  const fetchCatalogs = async () => {
    try {
      const [anosData, cortesData, colegiosData] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_cortes"),
        invoke<CategoryItem[]>("get_colegios"),
      ]);
      setAnos(anosData);
      setCortes(cortesData);
      setColegios(colegiosData);
      
      const activeAno = anosData.find(a => a.activo)?.id || (anosData.length > 0 ? anosData[0].id : 0);
      const activeCorte = cortesData.find(c => c.activo)?.id || (cortesData.length > 0 ? cortesData[0].id : 0);
      const activeColegio = colegiosData.find(c => c.activo)?.id || (colegiosData.length > 0 ? colegiosData[0].id : 0);

      if (activeAno) setSelectedAno(activeAno);
      if (activeCorte) setSelectedCorte(activeCorte);
      if (activeColegio) setSelectedColegio(activeColegio);
    } catch (error) {
      console.error("Error fetching catalogs:", error);
    }
  };

  // Cargar grados y asignaturas cuando cambie el colegio o el año
  useEffect(() => {
    if (selectedColegio && selectedAno) {
      fetchGradosYAsignaturas();
    } else {
      setGrados([]);
      setAsignaturas([]);
      setSelectedGrado(0);
      setSelectedAsignatura(0);
    }
  }, [selectedColegio, selectedAno]);

  const fetchGradosYAsignaturas = async () => {
    try {
      const [gradosData, asignaturasData] = await Promise.all([
        invoke<CategoryItem[]>("get_grados_by_colegio", { 
          colegioId: selectedColegio, 
          anoLectivoId: selectedAno 
        }),
        invoke<CategoryItem[]>("get_subjects_by_colegio", { colegioId: selectedColegio }),
      ]);
      setGrados(gradosData);
      
      let currentGradoId = selectedGrado;
      if (gradosData.length > 0) {
        const stillExists = gradosData.some(g => g.id === selectedGrado);
        if (!stillExists) {
          currentGradoId = gradosData[0].id;
          setSelectedGrado(currentGradoId);
        }
      } else {
        currentGradoId = 0;
        setSelectedGrado(0);
      }
      
      // Intentar obtener asignaturas por grado si el comando existe
      let filteredAsignaturas = asignaturasData;
      if (currentGradoId > 0) {
        try {
          const subjectsByGrade = await invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: currentGradoId });
          if (subjectsByGrade.length > 0) {
            // Filtrar las asignaturas del grado para asegurar que pertenezcan al colegio seleccionado
            filteredAsignaturas = subjectsByGrade.filter(sg => asignaturasData.some(ca => ca.id === sg.id));
          }
        } catch (e) {
          console.log("Comando get_subjects_by_grade no disponible, usando globales");
        }
      }
      
      const sortedAsignaturas = [...filteredAsignaturas].sort((a, b) => a.nombre.localeCompare(b.nombre));
      
      setAsignaturas(sortedAsignaturas);
      
      // Solo cambiar la asignatura si es 0 (nunca se ha seleccionado) O si la actual no existe en la lista nueva
      if (sortedAsignaturas.length > 0) {
        const stillExists = sortedAsignaturas.some(a => a.id === selectedAsignatura);
        // Solo seleccionar automáticamente si es la primera vez (selectedAsignatura === 0)
        // O si la seleccionada actualmente no existe en la lista
        if (selectedAsignatura === 0 || !stillExists) {
          setSelectedAsignatura(sortedAsignaturas[0].id);
        }
      } else {
        setSelectedAsignatura(0);
      }
    } catch (error) {
      console.error("Error fetching grados y asignaturas:", error);
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

  // Actualizar modo cualitativo cuando cambie el grado o la asignatura
  useEffect(() => {
    const grado = grados.find(g => g.id === selectedGrado);
    const asignatura = asignaturas.find(a => a.id === selectedAsignatura);
    
    // Es cualitativo si el grado es cualitativo O la asignatura es cualitativa
    const qual = (grado?.cualitativo === true) || (asignatura?.cualitativo === true);
    console.log("Modo cualitativo actualizado:", { 
      grado: grado?.nombre, 
      gradoQual: grado?.cualitativo, 
      asig: asignatura?.nombre, 
      asigQual: asignatura?.cualitativo, 
      final: qual 
    });
    setIsQualitative(qual);
  }, [selectedGrado, selectedAsignatura, grados, asignaturas]);

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
        if (!stillExists) setSelectedSeccion(data[0].id);
      } else {
        setSelectedSeccion(0);
      }
    } catch (error) {
      console.error("Error fetching secciones:", error);
    }
  };

  const fetchEstudiantes = async (currentIndicadores?: Indicador[], silent = false) => {
    const isActuallySilent = silent || nextRefreshSilent.current;
    if (!isActuallySilent) setLoading(true);
    nextRefreshSilent.current = false; // Reset for next time
    const indToUse = currentIndicadores || indicadores;
    const { corte, asignatura, grado, seccion, sexo } = filtersRef.current;
    
    console.log("[DEBUG] fetchEstudiantes - filtros:", { grado, seccion, corte, asignatura });
    
    try {
      const [dataRaw, notasGuardadas] = await Promise.all([
        invoke<Estudiante[]>("get_estudiantes_by_filters", {
          gradoId: grado,
          seccionId: seccion,
        }),
        invoke<{estudianteId: number, criterioId: number, valor: number}[]>("get_notas_by_filters", {
          gradoId: grado,
          seccionId: seccion,
          corteId: corte,
          asignaturaId: asignatura,
        })
      ]);
      
      console.log(`[DEBUG] fetchEstudiantes: ${notasGuardadas.length} notas obtenidas de SQLite`);
      if (notasGuardadas.length > 0) {
        console.log(`[DEBUG] Ejemplo de nota obtenida:`, notasGuardadas[0]);
      }

      // Filtrar por sexo localmente si hay un filtro seleccionado
      const data = sexo 
        ? dataRaw.filter((est: any) => est.sexo === sexo)
        : dataRaw;

      setEstudiantes(data);
      
      // Mapear notas guardadas a la estructura de la tabla
      const notasMap = new Map<string, string>();
      const cuantitativasMap: Record<number, Record<number, number>> = {};
      
      // Primero inicializar todos los estudiantes con notas vacías
      data.forEach(est => {
        cuantitativasMap[est.id] = {};
      });

      // Llenar con las notas recuperadas de la DB
      notasGuardadas.forEach(n => {
        const key = `${n.estudianteId}-${n.criterioId}`;
        
        // Buscar el criterio para obtener su puntaje máximo
        const criterio = indToUse
          .flatMap(ind => ind.criterios)
          .find(c => c.id === n.criterioId);
        
        if (criterio) {
          // Usamos un margen más amplio para el redondeo de punto flotante (0.05)
          const ratio = n.valor / criterio.puntajeMaximo;
          let qualValue = "";
          
          // Mapeo por rangos para mayor robustez
          if (ratio >= 0.90) qualValue = "AA";
          else if (ratio >= 0.70) qualValue = "AS";
          else if (ratio >= 0.50) qualValue = "AF";
          else if (ratio >= 0.30) qualValue = "AI";

          if (qualValue) {
            notasMap.set(key, qualValue);
          }
        }
        
        if (cuantitativasMap[n.estudianteId]) {
          cuantitativasMap[n.estudianteId][n.criterioId] = n.valor;
        }
      });

      console.log("[DEBUG] Notas cualitativas mapeadas:", notasMap.size);
      console.log("[DEBUG] Notas cuantitativas mapeadas:", Object.keys(cuantitativasMap).length);
      
      // En un refresco silencioso (tiempo real), aceptamos la verdad del servidor
      // y sobrescribimos cualquier estado local para evitar inconsistencias.
      if (isActuallySilent) {
        historyRef.current = [];
        redoStackRef.current = [];
        setHistory([]);
        setRedoStack([]);
        setHasUnsavedChanges(false);
      }

      setNotas(prevNotas => {
        const notasIniciales = data.map(est => ({
          estudianteId: est.id,
          estudianteNombre: est.nombre,
          notas: cuantitativasMap[est.id] || {}
        }));
        
        // Si hay historial de cambios (dirty state) y NO es un refresco por tiempo real, mezclamos
        if (historyRef.current.length > 0 && !isActuallySilent) {
          return notasIniciales.map(newEst => {
            const matchingOld = prevNotas.find(p => p.estudianteId === newEst.estudianteId);
            if (matchingOld) {
              return {
                ...newEst,
                notas: { ...newEst.notas, ...matchingOld.notas }
              };
            }
            return newEst;
          });
        }
        return notasIniciales;
      });

      // Actualizar el ref de cualitativas
      const finalQualState = new Map(notasMap);
      notasCualitativasRef.current = finalQualState;

      setNotasCualitativas(prevQual => {
        // Si hay historial de cambios y NO es tiempo real, preservamos valores locales
        if (historyRef.current.length > 0 && !isActuallySilent) {
          const newQual = new Map(notasMap);
          prevQual.forEach((val, key) => {
            const studentId = parseInt(key.split('-')[0]);
            if (data.some(e => e.id === studentId)) {
              newQual.set(key, val);
            }
          });
          return newQual;
        }
        return finalQualState;
      });

      // FORZAR ACTUALIZACIÓN VISUAL DE LOS INPUTS (Uncontrolled)
      if (isActuallySilent) {
        setTimeout(() => {
          const flattenedCriterios = indToUse.flatMap(ind => ind.criterios);
          inputsRef.current.forEach((inputEl, inputKey) => {
            const parts = inputKey.split('-');
            if (parts.length === 4) {
              const estId = parseInt(parts[1]);
              const critIdx = parseInt(parts[3]);
              const criterio = flattenedCriterios[critIdx];
              if (criterio) {
                const key = `${estId}-${criterio.id}`;
                const val = finalQualState.get(key) || '';
                if (inputEl.value !== val) {
                  inputEl.value = val;
                }
              }
            }
          });
          // Forzar recalculo de totales
          setRowVersions(prev => {
            const next = new Map(prev);
            data.forEach(est => {
              next.set(est.id, (next.get(est.id) || 0) + 1);
            });
            return next;
          });
        }, 100);
      }

    } catch (error) {
      console.error("Error fetching estudiantes:", error);
      if (!silent) {
        await emit("show-toast", { message: "❌ Error al cargar estudiantes: " + error, type: 'error' });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchConfiguracionEvaluacion = async (silent = false): Promise<Indicador[]> => {
    const isActuallySilent = silent || nextRefreshSilent.current;
    if (!isActuallySilent) setLoading(true);
    const { corte, asignatura, grado } = filtersRef.current;
    try {
      const data = await invoke<Indicador[]>("get_evaluation_config", {
        gradoId: grado,
        asignaturaId: asignatura,
        corteEvaluativoId: corte,
      });
      setIndicadores(data);
      return data;
    } catch (error) {
      console.error("Error fetching evaluation config:", error);
      if (!silent) {
        await emit("show-toast", { message: "❌ Error al cargar configuración de evaluación: " + error, type: 'error' });
      }
      return [];
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Mapeo de notas cualitativas a porcentajes
  const notaMapping = {
    AA: 1.0,  // Representa el 100% (rango 90-100%)
    AS: 0.85, // Representa el rango 76-89%
    AF: 0.65, // Representa el rango 60-75%
    AI: 0.40  // Representa el rango 0-59%
  };

  const qualitativeWeights: Record<string, number> = {
    'AA': 4,
    'AS': 3,
    'AF': 2,
    'AI': 1
  };

  const reverseQualitativeWeights: Record<number, string> = {
    4: 'AA',
    3: 'AS',
    2: 'AF',
    1: 'AI'
  };

  const calcularNotaCualitativaFinal = useCallback((notasQual: string[]): string => {
    if (notasQual.length === 0) return '';
    
    // Filtrar notas vacías o incompletas
    const validNotes = notasQual.filter(n => ['AA', 'AS', 'AF', 'AI'].includes(n));
    if (validNotes.length === 0) return '';

    // 1. Intentar encontrar la moda
    const counts: Record<string, number> = {};
    let maxCount = 0;

    validNotes.forEach(n => {
      counts[n] = (counts[n] || 0) + 1;
      if (counts[n] > maxCount) {
        maxCount = counts[n];
      }
    });

    // Obtener todas las notas que tienen la frecuencia máxima
    const modes = Object.keys(counts).filter(n => counts[n] === maxCount);

    // Si hay una moda única Y se repite (maxCount > 1), devolverla
    if (modes.length === 1 && maxCount > 1) return modes[0];

    // 2. Si no hay moda clara (todas diferentes) o hay empate, usar el término medio (promedio de pesos)
    const weights = validNotes.map(n => qualitativeWeights[n]);
    const sum = weights.reduce((a, b) => a + b, 0);
    const average = Math.round(sum / weights.length);
    
    return reverseQualitativeWeights[average as keyof typeof reverseQualitativeWeights] || 'AI';
  }, []);

  // Manejo de notas cualitativas
  const handleNotaChange = useCallback((estudianteId: number, criterioId: number, value: string) => {
    // Normalizar el valor a mayúsculas
    const normalizedValue = value.toUpperCase();
    
    // Permitir edición libre de hasta 2 caracteres alfabéticos para mejor UX
    // La validación estricta se aplica al calcular el valor numérico
    if (normalizedValue.length > 2) return;
    if (normalizedValue !== '' && !/^[A-Z]*$/.test(normalizedValue)) return;
    
    // Generar la clave única para la nota
    const key = `${estudianteId}-${criterioId}`;
    
    // Buscar el criterio usando el mapa pre-computado (O(1) en vez de flatMap+find)
    const idx = criterioIndexMap.get(criterioId);
    const criterio = idx !== undefined ? allCriterios[idx] : undefined;
       
    if (!criterio) return;
    
    // Calcular el valor numérico solo si es una nota final válida
    const finalNotes = ['AA', 'AS', 'AF', 'AI'];
    let numValue = 0;
    if (finalNotes.includes(normalizedValue)) {
      const percentage = notaMapping[normalizedValue as keyof typeof notaMapping];
      numValue = criterio.puntajeMaximo * percentage;
    } else if (normalizedValue === 'A') {
      // Si solo es 'A', el valor numérico es 0 hasta que se complete la nota
      numValue = 0;
    }
    
// Actualizar notas cuantitativas en ref (sin re-render)
    notasCuantitativasRef.current.set(key, Math.round(numValue));
    
    // Marcar como hay cambios sin guardar
    setHasUnsavedChanges(true);

  }, [allCriterios, criterioIndexMap, setHasUnsavedChanges]);

  // Manejar enfoque y desenfoque para historial por celda
  // Fase 1.2: Lazy snapshot — solo crea snapshot si no existe uno activo
  const handleInputFocus = useCallback(() => {
    if (!cellSnapshot.current) {
      cellSnapshot.current = new Map(notasCualitativasRef.current);
    }
  }, []);

  const handleInputBlur = (estudianteId: number, criterioId: number, value: string) => {
    if (!cellSnapshot.current) return;

    const key = `${estudianteId}-${criterioId}`;
    const oldValue = cellSnapshot.current.get(key) || '';
    const newValue = value.toUpperCase();

    // Solo guardar en historial si el valor final cambió
    if (oldValue !== newValue) {
      const newSnapshot = new Map(cellSnapshot.current!);
      
      // Actualizar Ref inmediatamente para que undo() lo vea
      const newHistory = [...historyRef.current, newSnapshot];
      if (newHistory.length > 50) newHistory.shift();
      historyRef.current = newHistory;
      
      // Actualizar estado para la UI
      setHistory(newHistory);
      
      // Limpiar redoStack
      redoStackRef.current = [];
      setRedoStack([]);
      
      setRowVersions(prev => {
        const next = new Map(prev);
        next.set(estudianteId, (next.get(estudianteId) || 0) + 1);
        return next;
      });
    }
    cellSnapshot.current = null;
  };

  // Funciones Deshacer/Rehacer
  const updateInputsUI = (targetState: Map<string, string>) => {
    notasCualitativasRef.current = new Map(targetState);
    
    // Update all inputs visually without re-rendering everything
    inputsRef.current.forEach((inputEl, inputKey) => {
      const parts = inputKey.split('-');
      if (parts.length === 4) {
        const estId = parseInt(parts[1]);
        const critIdx = parseInt(parts[3]);
        const criterio = allCriterios[critIdx];
        if (criterio) {
          const key = `${estId}-${criterio.id}`;
          const val = targetState.get(key) || '';
          if (inputEl.value !== val) {
            inputEl.value = val;
          }
        }
      }
    });

    // Update row versions to recalculate totals
    setRowVersions(prev => {
      const next = new Map(prev);
      targetState.forEach((val, key) => {
        const estId = parseInt(key.split('-')[0]);
        next.set(estId, (next.get(estId) || 0) + 1);
      });
      return next;
    });
  };

  const undo = () => {
    const currentHistory = historyRef.current;
    if (currentHistory.length === 0) return;
    
    const previousState = currentHistory[currentHistory.length - 1];
    const newHistory = currentHistory.slice(0, -1);
    
    // Guardar estado actual en redoStack
    const currentRedoStack = [new Map(notasCualitativasRef.current), ...redoStackRef.current];
    redoStackRef.current = currentRedoStack;
    setRedoStack(currentRedoStack);
    
    // Actualizar historial
    historyRef.current = newHistory;
    setHistory(newHistory);
    
// Actualizar estados
    isUndoRedoAction.current = true;
    updateInputsUI(previousState);
    
    // Marcar como hay cambios sin guardar después de deshacer
    setHasUnsavedChanges(true);

    // Sincronizar notas cuantitativas inmediatamente para asegurar actualización de UI
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadores.forEach(ind => {
        ind.criterios.forEach(crit => {
          const key = `${est.id}-${crit.id}`;
          const qualValue = previousState.get(key) || '';
          
          let numValue = 0;
          if (['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
            const percentage = notaMapping[qualValue as keyof typeof notaMapping];
            numValue = crit.puntajeMaximo * percentage;
          }
          studentNotas[crit.id] = numValue;
        });
      });
      return {
        estudianteId: est.id,
        estudianteNombre: est.nombre,
        notas: studentNotas
      };
    });
    setNotas(newNotas);
  };

  const redo = () => {
    const currentRedoStack = redoStackRef.current;
    if (currentRedoStack.length === 0) return;
    
    const nextState = currentRedoStack[0];
    const newRedoStack = currentRedoStack.slice(1);
    
    // Guardar estado actual en history
    const currentHistory = [...historyRef.current, new Map(notasCualitativasRef.current)];
    historyRef.current = currentHistory;
    setHistory(currentHistory);
    
    // Actualizar redoStack
    redoStackRef.current = newRedoStack;
    setRedoStack(newRedoStack);
    
    // Actualizar estados
    isUndoRedoAction.current = true;
    updateInputsUI(nextState);
    
    // Marcar como hay cambios sin guardar después de rehacer
    setHasUnsavedChanges(true);

    // Sincronizar notas cuantitativas inmediatamente para asegurar actualización de UI
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadores.forEach(ind => {
        ind.criterios.forEach(crit => {
          const key = `${est.id}-${crit.id}`;
          const qualValue = nextState.get(key) || '';
          
          let numValue = 0;
          if (['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
            const percentage = notaMapping[qualValue as keyof typeof notaMapping];
            numValue = crit.puntajeMaximo * percentage;
          }
          studentNotas[crit.id] = numValue;
        });
      });
      return {
        estudianteId: est.id,
        estudianteNombre: est.nombre,
        notas: studentNotas
      };
    });
    setNotas(newNotas);
  };

  // Manejo de navegación con teclas direccionales (Optimizado O(1) con pre-computados)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, estudianteId: number, criterioIndex: number) => {
    const rowIndex = studentIndexMap.get(estudianteId);
    if (rowIndex === undefined) return;
    
    let nextRow = rowIndex;
    let nextCol = criterioIndex;
    
    // Sobreescritura inteligente: si se presiona una letra que inicia una nota válida
    if (isQualitative && /^[aAsSfFiI]$/.test(e.key)) {
      const currentCriterio = allCriterios[criterioIndex];
      if (currentCriterio) {
        const key = `${estudianteId}-${currentCriterio.id}`;
        const currentVal = (notasCualitativasRef.current.get(key) || '').toUpperCase();
        
        if (currentVal.length >= 2) {
          handleNotaChange(estudianteId, currentCriterio.id, '');
        }
      }
      return;
    }
      {/* Search input for NotasPage filters */}
      <div style={{ padding: '0.4rem 0' }}>
        <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Buscar estudiante por nombre..." isMobile={isMobile} />
      </div>
      {/* Lines 1318-1750 omitted */}
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        const currentCriterio = allCriterios[criterioIndex];
        if (currentCriterio) {
          handleNotaChange(estudianteId, currentCriterio.id, '');
        }
        return;
      case 'ArrowRight':
        if (criterioIndex < totalColumns - 1) nextCol++;
        break;
      case 'ArrowLeft':
        if (criterioIndex > 0) nextCol--;
        break;
      case 'ArrowDown':
        if (rowIndex < estudiantes.length - 1) nextRow++;
        break;
      case 'ArrowUp':
        if (rowIndex > 0) nextRow--;
        break;
      default:
        return;
    }
    
    e.preventDefault();
    
    const nextEstudiante = estudiantes[nextRow];
    if (!nextEstudiante) return;
    
    const nextCriterio = allCriterios[nextCol];
    if (nextCriterio) {
      const key = `row-${nextEstudiante.id}-col-${nextCol}`;
      inputsRef.current.get(key)?.focus();
    }
  }, [allCriterios, totalColumns, estudiantes, studentIndexMap, isQualitative, handleNotaChange]);

  // Calcular total por indicador
  const calcularTotalIndicador = useCallback((estudianteNotas: Record<number, number>, indicador: Indicador): number => {
    return indicador.criterios.reduce((sum, criterio) => {
      const nota = estudianteNotas[criterio.id] || 0;
      return sum + nota;
    }, 0);
  }, []);

  // Calcular total final (solo indicadores activos)
  const calcularTotalFinal = useCallback((estudianteNotas: Record<number, number>): number => {
    if (isQualitative) return 0; // No usar totales numéricos en modo cualitativo
    const indicadoresActivos = indicadores.filter(i => i.activo);
    return indicadoresActivos.reduce((sum, indicador) => {
      return sum + calcularTotalIndicador(estudianteNotas, indicador);
    }, 0);
  }, [isQualitative, indicadores, calcularTotalIndicador]);

  // Guardar notas
  const handleGuardarNotas = async () => {
    if (notas.length === 0) {
      await emit("show-toast", { message: "⚠️ No hay estudiantes para guardar notas", type: 'info' });
      return;
    }

    // Mezclar notas cualitativas y cuantitativas del ref con el estado notas
    const notasActualizadas = notas.map(notaEst => {
      const updatedNotas: Record<number, number> = { ...notaEst.notas };
      // Sobrescribir con valores cualitativos convertidos a numéricos
      indicadores.forEach(ind => {
        ind.criterios.forEach(crit => {
          const key = `${notaEst.estudianteId}-${crit.id}`;
          // Primero intentar del ref cuantitativo
          const refValue = notasCuantitativasRef.current.get(key);
          if (refValue !== undefined) {
            updatedNotas[crit.id] = refValue;
          }
          // También verificar notas cualitativas y convertir
          const qualValue = notasCualitativasRef.current.get(key);
          if (qualValue && ['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
            const percentage = notaMapping[qualValue as keyof typeof notaMapping];
            updatedNotas[crit.id] = Math.round(crit.puntajeMaximo * percentage);
          }
        });
      });
      return { ...notaEst, notas: updatedNotas };
    });

    // Validar si hay notas incompletas (solo 'A')
    const hasIncomplete = Array.from(notasCualitativas.values()).some(v => v === 'A');
    if (hasIncomplete) {
      await emit("show-toast", { 
        message: "⚠️ Hay notas incompletas (solo 'A'). Por favor complételas (AA, AS, AF, AI) o bórrelas antes de guardar.", 
        type: 'error' 
      });
      return;
    }

    // Validar que todas las notas estén dentro de los rangos permitidos
    for (const notaEst of notasActualizadas) {
      for (const indicador of indicadores) {
        if (!indicador.activo) continue;
        
        // Si es cualitativo, no validamos el rango numérico de 20 pts
        if (isQualitative) continue;

        const totalIndicador = calcularTotalIndicador(notaEst.notas, indicador);
        if (totalIndicador > 20) {
          await emit("show-toast", { 
            message: `⚠️ El estudiante ${notaEst.estudianteNombre} tiene ${totalIndicador} pts en el Indicador ${indicador.orden} (máximo 20)`, 
            type: 'error' 
          });
          return;
        }
      }
    }

    setSaving(true);
    try {
      // Preparar datos para guardar
      const notasParaGuardar = notasActualizadas.map(notaEst => ({
        estudianteId: notaEst.estudianteId,
        notas: Object.entries(notaEst.notas).map(([criterioId, valor]) => ({
          criterioId: parseInt(criterioId),
          valor: valor
        }))
      }));

      console.log("LOG [Guardar]: Iniciando guardado de notas en SQLite", {
        totalEstudiantes: notasParaGuardar.length,
        corteId: selectedCorte,
        asignaturaId: selectedAsignatura
      });

      await invoke("save_notas_estudiantes", {
        notas: notasParaGuardar,
        corteId: selectedCorte,
        asignaturaId: selectedAsignatura
      });

// Limpiar historial tras guardado exitoso
    historyRef.current = [];
    redoStackRef.current = [];
    setHistory([]);
    setRedoStack([]);
    
    // Resetear estado de cambios
    setHasUnsavedChanges(false);

    // Feedback inmediato tras guardado local (SQLite es instantáneo)
    setSaving(false);
    await emit("show-toast", { message: "✅ Notas guardadas localmente", type: "success" });
      
      // Sincronización en segundo plano (No bloqueante)
      (async () => {
        try {
          console.log("LOG [Sincronización]: Iniciando en segundo plano...");
          // Asegurar que los indicadores y criterios existan en Supabase antes de las notas
          await syncService.syncEvaluacionConfig(indicadores);
            await emit("sync-completed", { message: "⚡ Sync completed successfully" });

          // Preparar todas las notas para sincronización en lote
          const todasLasNotasParaSync: any[] = [];
          notasParaGuardar.forEach(notaEst => {
            notaEst.notas.forEach(n => {
              todasLasNotasParaSync.push({
                estudianteId: notaEst.estudianteId,
                criterioId: n.criterioId,
                valor: n.valor,
                corteEvaluativoId: selectedCorte,
                asignaturaId: selectedAsignatura
              });
            });
          });

          if (todasLasNotasParaSync.length > 0) {
            await syncService.syncNotasBatch(todasLasNotasParaSync);
            console.log("LOG [Sincronización]: Notas sincronizadas con éxito");
          }
        } catch (syncError) {
          console.error("LOG [Sincronización]: Error en segundo plano:", syncError);
        }
      })();

      // Recargar datos localmente y notificar a otros componentes (sin参数 para mantener filtros actuales)
      // Solo recargar una vez, no emitiremos eventos que puedan causar recargas adicionales
      setTimeout(() => {
        fetchEstudiantes(undefined, true);
      }, 200);

    } catch (error) {
      console.error("Error saving notes:", error);
      await emit("show-toast", { message: "❌ Error al guardar notas: " + error, type: "error" });
      setSaving(false);
    }
  };


  const renderRow = useCallback((est: NotaEstudiante, index: number) => {
﻿                  const estudianteNotas = notas.find(n => n.estudianteId === est.estudianteId) || { notas: {} };
                  
                  return (
                    <tr key={est.estudianteId} className="notas-row">
                      <td className="sticky-cell student-number" style={{ 
                        padding: '0.2rem', 
                        textAlign: 'center', 
                        position: 'sticky',
                        left: 0,
                        zIndex: 5,
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        fontSize: '0.65rem'
                      }}>{index + 1}</td>
                      <td className="sticky-cell student-name" style={{ 
                        padding: '0.3rem', 
                        position: 'sticky',
                        left: '35px',
                        zIndex: 5,
                        borderBottom: '1px solid rgba(255,255,255,0.05)'
                      }}>
                        <div style={{ 
                          fontWeight: 'bold', 
                          fontSize: '0.75rem', 
                          whiteSpace: 'nowrap', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          maxWidth: '120px'
                        }}>{est.estudianteNombre}</div>
                      </td>
                      {(() => {
                        return indicadores.map(ind => (
                          <Fragment key={`row-${est.estudianteId}-ind-${ind.id}`}>
                            {ind.criterios.map(crit => {
                              const criterioIndex = criterioIndexMap.get(crit.id) ?? 0;
                              const inputKey = `row-${est.estudianteId}-col-${criterioIndex}`;
                              const key = `${est.estudianteId}-${crit.id}`;
                              const currentQualitativeValue = notasCualitativasRef.current.get(key) || '';
                              
return (
                                <td key={`${est.estudianteId}-${crit.id}`} style={{ padding: '0.15rem', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                  <input
                                    type="text"
                                    defaultValue={currentQualitativeValue}
onChange={(e) => {
        // Marcar como hay cambios sin guardar
        setHasUnsavedChanges(true);
        
        const rawVal = e.target.value.toUpperCase();
        const val = rawVal.slice(0, 2);

        // Validar primer carácter: solo puede ser A
        const firstChar = val.charAt(0);
        const isValidFirstChar = firstChar === '' || firstChar === 'A';

        if (!isValidFirstChar) {
          e.target.value = '';
          notasCualitativasRef.current.set(key, '');
                                        e.target.style.borderColor = '#ef4444';
                                        e.target.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                                        setTimeout(() => {
                                          e.target.style.borderColor = '';
                                          e.target.style.backgroundColor = '';
                                        }, 1000);
                                        return;
                                      }
                                      
                                      // Validar segundo carácter: puede ser A, S, F, I
                                      const secondChar = val.charAt(1);
                                      const isValidSecondChar = secondChar === '' || ['A', 'S', 'F', 'I'].includes(secondChar);
                                      
                                      if (!isValidSecondChar) {
                                        e.target.value = val.charAt(0);
                                        notasCualitativasRef.current.set(key, val.charAt(0));
                                        e.target.style.borderColor = '#ef4444';
                                        e.target.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                                        setTimeout(() => {
                                          e.target.style.borderColor = '';
                                          e.target.style.backgroundColor = '';
                                        }, 1000);
                                      } else {
                                        notasCualitativasRef.current.set(key, val);
                                        e.target.value = val;
                                      }
                                    }}
                                    onKeyDown={(e) => handleKeyDown(e, est.estudianteId, criterioIndex)}
                                    onFocus={(e) => {
                                      handleInputFocus();
                                      e.target.select();
                                    }}
                                    onBlur={(e) => {
                                      const val = e.target.value.toUpperCase();
                                      const isValid = val === '' || ['AA', 'AS', 'AF', 'AI'].includes(val);
                                      
                                      if (!isValid) {
                                        e.target.value = '';
                                        notasCualitativasRef.current.set(key, '');
                                        handleInputBlur(est.estudianteId, crit.id, '');
                                      } else {
                                        notasCualitativasRef.current.set(key, val);
                                        handleInputBlur(est.estudianteId, crit.id, val);
                                      }
                                    }}
                                    ref={(el) => {
                                      if (el) inputsRef.current.set(inputKey, el);
                                      else inputsRef.current.delete(inputKey);
                                    }}
                                    style={{
                                      width: isQualitative ? '48px' : '32px',
                                      padding: '0.15rem',
                                      fontSize: isQualitative ? '0.85rem' : '0.75rem',
                                      textAlign: 'center',
                                      background: isQualitative ? 'rgba(139, 92, 246, 0.1)' : 'rgba(255,255,255,0.03)',
                                      border: `2px solid ${currentQualitativeValue ? getGradeColor(currentQualitativeValue, crit.puntajeMaximo) : (isQualitative ? 'rgba(139, 92, 256, 0.4)' : 'rgba(255,255,255,0.1)')}`,
                                      borderRadius: '4px',
                                      color: currentQualitativeValue ? getGradeColor(currentQualitativeValue, crit.puntajeMaximo) : (isQualitative ? '#a78bfa' : 'white'),
                                      textTransform: 'uppercase',
                                      fontWeight: currentQualitativeValue ? 'bold' : 'normal',
                                      outline: 'none'
                                    }}
                                    maxLength={2}
                                  />
                                </td>
                              );
                            })}
                            <td style={{ 
                              padding: '0.2rem', 
                              textAlign: 'center', 
                              fontWeight: 'bold', 
                              background: ind.activo ? 'rgba(100, 108, 255, 0.05)' : 'rgba(100, 116, 139, 0.08)',
                              borderBottom: '1px solid rgba(255,255,255,0.05)'
                            }}>
                              {(() => {
                                // Calcular desde cualitativas (más actualizado durante edición)
                                const totalIndicador = ind.criterios.reduce((sum, c) => {
                                  const qualValue = notasCualitativasRef.current.get(`${est.estudianteId}-${c.id}`);
                                  if (qualValue && ['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
                                    const percentage = notaMapping[qualValue as keyof typeof notaMapping];
                                    return sum + Math.round(c.puntajeMaximo * percentage);
                                  }
                                  return sum;
                                }, 0);
                                const totalIndicadorRedondeado = Math.round(totalIndicador);
                                
                                // Calcular el puntaje mÃ¡ximo real de este indicador
                                const maximoIndicador = ind.criterios.reduce((sum, c) => sum + (c.puntajeMaximo || 0), 0);
                                const totalEscalado = maximoIndicador > 0 ? (totalIndicador / maximoIndicador) * 100 : 0;
                                
                                const gradeConfig = getGradeFromScore(totalEscalado);
                                const qualitativeGrade = isQualitative 
                                  ? calcularNotaCualitativaFinal(ind.criterios.map(c => notasCualitativasRef.current.get(`${est.estudianteId}-${c.id}`) || ''))
                                  : (gradeConfig?.id || 'AI');
                                
                                const displayColor = ind.activo 
                                  ? (qualitativeGrade ? getGradeColor(qualitativeGrade) : '#94a3b8')
                                  : '#64748b';

                                return (
                                  <div style={{ color: displayColor, fontSize: '0.75rem', fontWeight: 'bold' }}>
                                    {isQualitative 
                                      ? qualitativeGrade 
                                      : `${totalIndicadorRedondeado}${qualitativeGrade ? ` (${qualitativeGrade})` : ''}`}
                                  </div>
                                );
                              })()}
                            </td>
                          </Fragment>
                        ));
                      })()}
                      <td style={{ 
                        padding: '0.2rem', 
                        textAlign: 'center', 
                        fontWeight: 'bold', 
                        background: '#1e293b',
                        position: 'sticky',
                        right: 0,
                        zIndex: 5,
                        borderBottom: '1px solid rgba(34, 197, 94, 0.2)',
                        whiteSpace: 'nowrap',
                        minWidth: '50px'
                      }}>
                        {(() => {
                          const rawTotalFinal = indicadores.filter(i => i.activo).reduce((sum, ind) => {
                            return sum + ind.criterios.reduce((s, c) => {
                              const qualValue = notasCualitativasRef.current.get(`${est.estudianteId}-${c.id}`);
                              if (qualValue && ['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
                                const percentage = notaMapping[qualValue as keyof typeof notaMapping];
                                return s + Math.round(c.puntajeMaximo * percentage);
                              }
                              return s;
                            }, 0);
                          }, 0);
                          const totalFinal = Math.round(rawTotalFinal);
                          
                          const maximoTotal = indicadores
                            .filter(i => i.activo)
                            .reduce((sum, i) => sum + i.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0);
                          
                          const totalEscaladoFinal = maximoTotal > 0 ? (rawTotalFinal / maximoTotal) * 100 : 0;
                          const gradeConfig = getGradeFromScore(totalEscaladoFinal);
                          const qualitativeFinal = isQualitative 
                            ? calcularNotaCualitativaFinal(indicadores.filter(i => i.activo).map(i => {
                                return calcularNotaCualitativaFinal(i.criterios.map(c => notasCualitativasRef.current.get(`${est.estudianteId}-${c.id}`) || ''));
                              }))
                            : (gradeConfig?.id || 'AI');
                          const displayColor = qualitativeFinal ? getGradeColor(qualitativeFinal) : '#94a3b8';

                          return (
                            <div style={{ 
                              color: displayColor, 
                              fontSize: '0.8rem', 
                              fontWeight: 'bold',
                              padding: '0.15rem 0.3rem',
                              borderRadius: '4px',
                              display: 'inline-block'
                            }}>
                              {isQualitative 
                                ? qualitativeFinal 
                                : `${totalFinal}${qualitativeFinal ? ` (${qualitativeFinal})` : ''}`}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );

  }, [notas, indicadores, criterioIndexMap, isQualitative, getGradeColor, getGradeFromScore, calcularTotalIndicador, calcularNotaCualitativaFinal, calcularTotalFinal, handleKeyDown, handleInputFocus, handleInputBlur]);

  return (
    <div className="page-container">
      <div className="category-grid" style={{ display: 'block' }}>
      
<FilterContainer isMobile={isMobile}>
          {/* Año Lectivo */}
          <FilterGroup label="Año Lectivo:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedAno}
              onChange={(e) => setSelectedAno(Number(e.target.value))}
            >
              {anos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </FilterGroup>
          
          {/* Corte */}
          <FilterGroup label="Corte:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedCorte}
              onChange={(e) => setSelectedCorte(Number(e.target.value))}
            >
              {cortes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </FilterGroup>

          {/* Colegio */}
          <FilterGroup label="Colegio:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedColegio}
              onChange={(e) => setSelectedColegio(Number(e.target.value))}
            >
              {colegios.map(col => <option key={col.id} value={col.id}>{col.nombre}</option>)}
            </select>
          </FilterGroup>

          {/* Grado */}
          <FilterGroup label="Grado:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedGrado}
              onChange={(e) => {
                const newVal = Number(e.target.value);
                setSelectedGrado(newVal);
                localStorage.setItem('notas-last-grado', String(newVal));
              }}
            >
              {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </FilterGroup>

          {/* Sección */}
          <FilterGroup label="Sección:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedSeccion}
              onChange={(e) => setSelectedSeccion(Number(e.target.value))}
            >
              {secciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </FilterGroup>

          {/* Sexo */}
          <FilterGroup label="Sexo:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedSexo}
              onChange={(e) => setSelectedSexo(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
            </select>
          </FilterGroup>

          {/* Asignatura */}
          <FilterGroup label="Asignatura:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedAsignatura}
              onChange={(e) => {
                const newVal = Number(e.target.value);
                setSelectedAsignatura(newVal);
                localStorage.setItem('notas-last-asignatura', String(newVal));
              }}
            >
              {asignaturas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </FilterGroup>

          {/* Buscador y Botones en la misma fila */}
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'flex-end', flex: isMobile ? '1 1 100%' : '0 0 auto' }}>
            <div style={{ flex: '1', minWidth: '80px' }}>
              <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Buscar..." isMobile={isMobile} />
            </div>
            <button
              onClick={undo}
              disabled={history.length === 0}
              className="btn-modern btn-undo"
              title="Deshacer (Ctrl+Z)"
              style={{
                padding: isMobile ? '0.4rem 0.6rem' : '0.6rem 1.2rem',
                fontSize: isMobile ? '0.75rem' : '0.9rem',
                height: isMobile ? '28px' : '42px',
                backgroundColor: history.length > 0 ? '#f59e0b' : 'rgba(148, 163, 184, 0.5)',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontWeight: '600',
                cursor: history.length > 0 ? 'pointer' : 'not-allowed',
                transition: 'all 0.3s ease',
                boxShadow: history.length > 0 ? '0 4px 14px rgba(245, 158, 11, 0.4)' : 'none',
                flexShrink: 0,
                whiteSpace: 'nowrap',
                opacity: history.length > 0 ? 1 : 0.7
              }}
            >
              <span>↩️</span>
              {!isMobile && <span>Deshacer</span>}
            </button>
            <button
              onClick={redo}
              disabled={redoStack.length === 0}
              className="btn-modern btn-redo"
              title="Rehacer (Ctrl+Y)"
              style={{
                padding: isMobile ? '0.4rem 0.6rem' : '0.6rem 1.2rem',
                fontSize: isMobile ? '0.75rem' : '0.9rem',
                height: isMobile ? '28px' : '42px',
                backgroundColor: redoStack.length > 0 ? '#f59e0b' : 'rgba(148, 163, 184, 0.5)',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontWeight: '600',
                cursor: redoStack.length > 0 ? 'pointer' : 'not-allowed',
                transition: 'all 0.3s ease',
                boxShadow: redoStack.length > 0 ? '0 4px 14px rgba(245, 158, 11, 0.4)' : 'none',
                flexShrink: 0,
                whiteSpace: 'nowrap',
                opacity: redoStack.length > 0 ? 1 : 0.7
              }}
            >
              <span>↪️</span>
              {!isMobile && <span>Rehacer</span>}
            </button>
            <button
              onClick={handleGuardarNotas}
              disabled={!hasUnsavedChanges || saving || (estudiantes.length === 0)}
              className="btn-modern btn-save-notes"
              title="Guardar Notas (Ctrl+G)"
              style={{
                padding: isMobile ? '0.4rem 0.6rem' : '0.6rem 1.2rem',
                fontSize: isMobile ? '0.75rem' : '0.9rem',
                height: isMobile ? '28px' : '42px',
                backgroundColor: !hasUnsavedChanges ? 'rgba(148, 163, 184, 0.5)' : (saving ? '#059669' : '#10b981'),
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                fontWeight: '600',
                cursor: (!hasUnsavedChanges || saving || estudiantes.length === 0) ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: hasUnsavedChanges && !saving && estudiantes.length > 0 ? '0 4px 14px rgba(16, 185, 129, 0.4)' : 'none',
                flexShrink: 0,
                whiteSpace: 'nowrap',
                opacity: (hasUnsavedChanges && !saving && estudiantes.length > 0) ? 1 : 0.7
              }}
            >
              <span>{saving ? '⏳' : '💾'}</span>
              {!isMobile && <span>{saving ? 'Guardando...' : (hasUnsavedChanges ? 'Guardar' : 'Sin cambios')}</span>}
            </button>
          </div>
        </FilterContainer>

      {loading && <div style={{textAlign: 'center', padding: '2rem'}}>Cargando datos...</div>}

      {/* Tabla de Notas */}
      {!loading && estudiantes.length > 0 && (
        <div className="category-card" style={{
          width: '100%',
          maxWidth: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          padding: isMobile ? '0.3rem' : '0.75rem'
        }}>
          <div className="category-header" style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: isMobile ? '0.2rem' : '0.5rem'
          }}>
            <h3 style={{ 
              margin: 0, 
              fontSize: isMobile ? '1rem' : '1.2rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              📋 Estudiantes <span style={{ opacity: 0.7, fontSize: '0.8em' }}>({filteredNotas.length})</span>
            </h3>
            <div style={{ fontSize: isMobile ? '0.75rem' : '0.9rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <span>{isMobile ? 'Indicadores Activos:' : 'Indicadores Activos:'}</span> 
              <span style={{ fontWeight: 'bold', color: '#fff' }}>{indicadores.filter(i => i.activo).length}/5</span>
            </div>
          </div>
          
          <div className="notas-table-container" style={{ 
            overflowX: 'auto', 
            padding: '0', 
            width: '100%', 
            maxWidth: '100%',
            WebkitOverflowScrolling: 'touch', 
            border: '1px solid rgba(255,255,255,0.1)', 
            borderRadius: '8px' 
          }}>
            <table className="notas-table" style={{ width: '100%', minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.7rem' }}>
              <thead>
                <tr style={{ background: '#1e293b', position: 'sticky', top: 0, zIndex: 100 }}>
                  <th style={{ 
                    padding: '0.3rem', 
                    textAlign: 'center', 
                    fontWeight: 'bold', 
                    color: '#94a3b8',
                    position: 'sticky',
                    left: 0,
                    zIndex: 110,
                    background: '#1e293b',
                    borderBottom: '2px solid rgba(255,255,255,0.1)',
                    width: '35px'
                  }}>Nº</th>
                  <th style={{ 
                    padding: '0.3rem', 
                    textAlign: 'left', 
                    fontWeight: 'bold', 
                    color: '#94a3b8',
                    position: 'sticky',
                    left: '35px',
                    zIndex: 110,
                    background: '#1e293b',
                    borderBottom: '2px solid rgba(255,255,255,0.1)',
                    minWidth: '130px',
                    maxWidth: '150px'
                  }}>Estudiante</th>
                  {indicadores.map(ind => (
                    <th key={ind.id} colSpan={ind.criterios.length + 1} style={{ 
                      padding: '0.2rem', 
                      textAlign: 'center', 
                      fontWeight: 'bold',
                      borderBottom: '2px solid rgba(255,255,255,0.1)'
                    }}>
                      <div 
                        title={ind.descripcion}
                        style={{ 
                          background: ind.activo ? 'rgba(100, 108, 255, 0.15)' : 'rgba(100, 116, 139, 0.2)', 
                          padding: '0.2rem', 
                          borderRadius: '4px',
                          border: `1px solid ${ind.activo ? 'rgba(100, 108, 255, 0.4)' : 'rgba(100, 116, 139, 0.4)'}`,
                          color: ind.activo ? '#93c5fd' : '#94a3b8',
                          cursor: 'help'
                        }}
                      >
                        <div style={{ fontWeight: 'bold', fontSize: '0.7rem' }}>
                          Ind. {ind.orden}
                        </div>
                      </div>
                    </th>
                  ))}
                  <th style={{ 
                    padding: '0.3rem', 
                    textAlign: 'center', 
                    fontWeight: 'bold', 
                    color: '#4ade80', 
                    background: '#1e293b', // Fondo sólido (igual que el resto de la cabecera)
                    borderBottom: '2px solid rgba(34, 197, 94, 0.4)',
                    position: 'sticky',
                    right: 0,
                    zIndex: 110,
                    width: '60px'
                  }}>
                    <div style={{ fontWeight: 'bold', fontSize: '0.7rem' }}>Final</div>
                    <div style={{ fontSize: '0.55rem', color: '#94a3b8' }}>{isQualitative ? 'Cual.' : '100'}</div>
                  </th>
                </tr>
                <tr style={{ background: '#1e293b' }}>
                  <th style={{ position: 'sticky', left: 0, zIndex: 110, background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.1)' }}></th>
                  <th style={{ position: 'sticky', left: '35px', zIndex: 110, background: '#1e293b', borderBottom: '1px solid rgba(255,255,255,0.1)' }}></th>
                  {indicadores.map(ind => (
                    <Fragment key={`sub-${ind.id}`}>
                      {ind.criterios.map(crit => (
                        <th key={crit.id} 
                          title={crit.descripcion}
                          style={{ 
                            padding: '0.2rem', 
                            textAlign: 'center', 
                            color: '#94a3b8', 
                            fontSize: '0.65rem',
                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                            cursor: 'help'
                          }}
                        >
                          <div style={{ fontWeight: 'bold' }}>C{crit.orden}</div>
                          {!isQualitative && <div style={{ fontSize: '0.55rem', color: '#4ade80' }}>{crit.puntajeMaximo}</div>}
                        </th>
                      ))}
                      <th style={{ 
                        padding: '0.2rem', 
                        textAlign: 'center', 
                        color: '#94a3b8', 
                        fontWeight: 'bold', 
                        background: ind.activo ? 'rgba(100, 108, 255, 0.08)' : 'rgba(100, 116, 139, 0.15)',
                        borderBottom: '1px solid rgba(255,255,255,0.1)'
                      }}>
                        <div style={{ color: ind.activo ? '#4ade80' : '#64748b', fontSize: '0.65rem' }}>
                          {isQualitative ? 'Cual.' : 'Tot'}
                        </div>
                      </th>
                    </Fragment>
                  ))}
                  <th style={{ 
                    padding: '0.2rem', 
                    textAlign: 'center', 
                    color: '#94a3b8', 
                    fontWeight: 'bold', 
                    background: '#1e293b', // Fondo sólido
                    position: 'sticky',
                    right: 0,
                    zIndex: 110,
                    borderBottom: '1px solid rgba(34, 197, 94, 0.4)'
                  }}>
                    <div style={{ color: '#4ade80', fontSize: '0.65rem' }}>{isQualitative ? 'Cual.' : 'Tot'}</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredNotas.map((est, index) => (
  <MemoRow key={est.estudianteId} est={est} index={index} renderRow={renderRow} />
))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Estado Vacío (Búsqueda o Filtros) */}
      {!loading && (
        <>
          {estudiantes.length > 0 && filteredNotas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '5rem 2rem', border: '2px dashed rgba(255, 255, 255, 0.1)', borderRadius: '16px', margin: '1rem 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
              <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>No se encontraron resultados</h4>
              <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
                No se encontró ningún estudiante que coincida con "{searchTerm}"
              </p>
              <button 
                className="secondary" 
                onClick={() => setSearchTerm("")}
                style={{ marginTop: '1.5rem', padding: '0.5rem 1rem' }}
              >
                Limpiar búsqueda
              </button>
            </div>
          ) : estudiantes.length === 0 && selectedGrado > 0 && selectedSeccion > 0 ? (
            <div style={{ textAlign: 'center', padding: '5rem 2rem', border: '2px dashed rgba(255, 255, 255, 0.1)', borderRadius: '16px', margin: '1rem 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👥</div>
              <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>No hay estudiantes para mostrar</h4>
              <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
                No hay estudiantes registrados para {grados.find(g => g.id === selectedGrado)?.nombre} - {secciones.find(s => s.id === selectedSeccion)?.nombre}.
                Por favor, registre estudiantes en la sección de Estudiantes.
              </p>
            </div>
          ) : !selectedGrado || !selectedSeccion ? (
            <div style={{ textAlign: 'center', padding: '5rem 2rem', border: '2px dashed rgba(255, 255, 255, 0.1)', borderRadius: '16px', margin: '1rem 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
              <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>Seleccione los filtros</h4>
              <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
                Seleccione un año, corte, colegio, asignatura, grado y sección para ver y calificar a los estudiantes.
              </p>
            </div>
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}
