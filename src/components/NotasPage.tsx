import React, { useState, useEffect, useRef, Fragment } from "react";
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
  const [selectedAsignatura, setSelectedAsignatura] = useState<number>(0);
  const [selectedGrado, setSelectedGrado] = useState<number>(0);
  const [selectedSeccion, setSelectedSeccion] = useState<number>(0);
  const [selectedSexo, setSelectedSexo] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  // Configuración de evaluación
  const [indicadores, setIndicadores] = useState<Indicador[]>([]);
  const [estudiantes, setEstudiantes] = useState<Estudiante[]>([]);
  const [notas, setNotas] = useState<NotaEstudiante[]>([]);
  // Estado para almacenar notas cualitativas directamente
  const [notasCualitativas, setNotasCualitativas] = useState<Map<string, string>>(new Map());
  const [gradeConfigs, setGradeConfigs] = useState<{ id: string, color: string, minimo: number }[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isQualitative, setIsQualitative] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<number | null>(null);
  const [highlightColor, setHighlightColor] = useState<string>(() => {
    return localStorage.getItem('student-highlight-color') || '#4ade80';
  });
  
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
    const unlistenStudent = listen("student-updated", () => {
      console.log("Evento student-updated recibido en NotasPage, refrescando...");
      fetchEstudiantes();
    });

    const unlistenCatalog = listen("catalog-updated", () => {
      console.log("Evento catalog-updated recibido en NotasPage, refrescando catálogos...");
      fetchCatalogs();
      setRefreshTrigger(prev => prev + 1);
    });

    return () => {
      unlistenStudent.then(f => f());
      unlistenCatalog.then(f => f());
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
      const configs = await invoke<{ id: string, color: string, minimo: number }[]>("get_grade_configs");
      setGradeConfigs(configs);
    } catch (error) {
      console.error("Error fetching grade configs:", error);
    }
  };

  // Listeners para eventos globales
  useEffect(() => {
    let unlistenGradeConfigs: (() => void) | null = null;
    let unlistenNotas: (() => void) | null = null;
    let unlistenHighlightColor: (() => void) | null = null;
    let unlistenConfigEvaluacion: (() => void) | null = null;

    const setupListeners = async () => {
      unlistenGradeConfigs = await listen("grade-configs-updated", () => {
        console.log("Configuraciones de calificación actualizadas");
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
    fetchGradeConfigs();

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

  const getGradeConfig = (gradeValue: string) => {
    const trimmedValue = gradeValue.trim().toUpperCase();
    return gradeConfigs.find(gc => gc.id === trimmedValue);
  };

  const getGradeColor = (value: string, maxScore?: number) => {
    // Si es una etiqueta cualitativa (AA, AS, etc.)
    if (['AA', 'AS', 'AF', 'AI'].includes(value)) {
      const config = getGradeConfig(value);
      return config ? config.color : 'white';
    }
    
    // Si es un número y tenemos el puntaje máximo, podemos calcular el color
    if (maxScore !== undefined && !isNaN(parseFloat(value))) {
      const score = parseFloat(value);
      const normalizedScore = (score / maxScore) * 100;
      const config = getGradeFromScore(normalizedScore);
      return config ? config.color : 'white';
    }

    return 'white';
  };

  const getGradeFromScore = (score: number) => {
    // Ordenar configuraciones por puntaje mínimo descendente
    const sortedConfigs = [...gradeConfigs].sort((a, b) => b.minimo - a.minimo);
    const config = sortedConfigs.find(c => score >= c.minimo);
    return config || gradeConfigs.find(c => c.id === 'AI');
  };

  // Cargar estudiantes cuando cambien los filtros
  useEffect(() => {
    const loadData = async () => {
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
    };
    
    loadData();
  }, [selectedAno, selectedCorte, selectedColegio, selectedAsignatura, selectedGrado, selectedSeccion, selectedSexo]);

  // Sincronizar notas cuantitativas cuando cambian las cualitativas (para deshacer/rehacer)
  useEffect(() => {
    if (!isUndoRedoAction.current) return;
    
    // Recalcular todas las notas cuantitativas basadas en las cualitativas actuales
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadores.forEach(ind => {
        ind.criterios.forEach(crit => {
          const key = `${est.id}-${crit.id}`;
          const qualValue = notasCualitativas.get(key) || '';
          
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
    isUndoRedoAction.current = false;
  }, [notasCualitativas]);

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
  }, [history, redoStack, notasCualitativas, notas, selectedCorte, selectedAsignatura]);

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
  }, [selectedColegio, selectedAno, refreshTrigger]);

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
      
      setAsignaturas(filteredAsignaturas);
      
      if (filteredAsignaturas.length > 0) {
        const stillExists = filteredAsignaturas.some(a => a.id === selectedAsignatura);
        if (!stillExists) setSelectedAsignatura(filteredAsignaturas[0].id);
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
    if (!silent) setLoading(true);
    const indToUse = currentIndicadores || indicadores;
    const { corte, asignatura, grado, seccion, sexo } = filtersRef.current;
    
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

      setNotas(prevNotas => {
        const notasIniciales = data.map(est => ({
          estudianteId: est.id,
          estudianteNombre: est.nombre,
          notas: cuantitativasMap[est.id] || {}
        }));
        
        // Si hay historial de cambios (dirty state), mezclamos
        if (historyRef.current.length > 0) {
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

      setNotasCualitativas(prevQual => {
        // Si hay historial de cambios, mezclamos las cualitativas
        if (historyRef.current.length > 0) {
          const newQual = new Map(notasMap);
          prevQual.forEach((val, key) => {
            const studentId = parseInt(key.split('-')[0]);
            if (data.some(e => e.id === studentId)) {
              newQual.set(key, val);
            }
          });
          return newQual;
        }
        return notasMap;
      });
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
    if (!silent) setLoading(true);
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

  const calcularNotaCualitativaFinal = (notasQual: string[]): string => {
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
  };

  // Manejo de notas cualitativas
  const handleNotaChange = (estudianteId: number, criterioId: number, value: string) => {
    // Normalizar el valor a mayúsculas
    const normalizedValue = value.toUpperCase();
    
    // Permitir edición libre de hasta 2 caracteres alfabéticos para mejor UX
    // La validación estricta se aplica al calcular el valor numérico
    if (normalizedValue.length > 2) return;
    if (normalizedValue !== '' && !/^[A-Z]*$/.test(normalizedValue)) return;
    
    // Generar la clave única para la nota
    const key = `${estudianteId}-${criterioId}`;
    
    // Actualizar el estado de notas cualitativas (siempre actualizamos para que el usuario vea lo que escribe)
    setNotasCualitativas(prev => {
      const newMap = new Map(prev);
      if (normalizedValue === '') {
        newMap.delete(key);
      } else {
        newMap.set(key, normalizedValue);
      }
      return newMap;
    });
    
    // Buscar el criterio correspondiente
    const criterio = indicadores
      .flatMap(ind => ind.criterios)
      .find(c => c.id === criterioId);
    
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
    
    // Actualizar el estado de notas cuantitativas para mantener los totales actualizados
    setNotas(prevNotas => {
      const newNotas = [...prevNotas];
      const studentIndex = newNotas.findIndex(n => n.estudianteId === estudianteId);
      
      if (studentIndex !== -1) {
        const student = { ...newNotas[studentIndex] };
        const updatedNotas = { ...student.notas };
        
        // Eliminado: La lógica que borraba otros criterios en modo cualitativo
        // permitiendo ahora guardar múltiples criterios por indicador sin que se borren entre sí.

        updatedNotas[criterioId] = Math.round(numValue);
        student.notas = updatedNotas;
        newNotas[studentIndex] = student;
      }
      
      return newNotas;
    });
  };

  // Manejar enfoque y desenfoque para historial por celda
  const handleInputFocus = () => {
    cellSnapshot.current = new Map(notasCualitativas);
  };

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
    }
    cellSnapshot.current = null;
  };

  // Funciones Deshacer/Rehacer
  const undo = () => {
    const currentHistory = historyRef.current;
    if (currentHistory.length === 0) return;
    
    const previousState = currentHistory[currentHistory.length - 1];
    const newHistory = currentHistory.slice(0, -1);
    
    // Guardar estado actual en redoStack
    const currentRedoStack = [new Map(notasCualitativas), ...redoStackRef.current];
    redoStackRef.current = currentRedoStack;
    setRedoStack(currentRedoStack);
    
    // Actualizar historial
    historyRef.current = newHistory;
    setHistory(newHistory);
    
    // Actualizar estados de notas
    isUndoRedoAction.current = true;
    setNotasCualitativas(previousState);
    
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
    const currentHistory = [...historyRef.current, new Map(notasCualitativas)];
    historyRef.current = currentHistory;
    setHistory(currentHistory);
    
    // Actualizar redoStack
    redoStackRef.current = newRedoStack;
    setRedoStack(newRedoStack);
    
    // Actualizar estados de notas
    isUndoRedoAction.current = true;
    setNotasCualitativas(nextState);

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

  // Manejo de navegación con teclas direccionales
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, estudianteId: number, criterioIndex: number) => {
    // Calcular total de columnas (inputs por fila)
    const totalColumns = indicadores.reduce((sum, ind) => sum + ind.criterios.length, 0);
    
    // Obtener índice de fila (estudiante)
    const rowIndex = estudiantes.findIndex(est => est.id === estudianteId);
    
    let nextRow = rowIndex;
    let nextCol = criterioIndex;
    
    // Sobreescritura inteligente: si se presiona una letra que inicia una nota válida
    if (isQualitative && /^[aAsSfFiI]$/.test(e.key)) {
      // Obtener todos los criterios en un array plano
      const allCriterios = indicadores.flatMap(ind => ind.criterios);
      const currentCriterio = allCriterios[criterioIndex];
      if (currentCriterio) {
        const key = `${estudianteId}-${currentCriterio.id}`;
        const currentVal = (notasCualitativas.get(key) || '').toUpperCase();
        
        // SOLO sobreescribimos si la nota actual ya está completa (2 letras)
        // o si es una nota válida de 1 letra (si las hubiera en el futuro).
        // Si hay una sola letra, permitimos que la segunda se concatene.
        if (currentVal.length >= 2) {
          handleNotaChange(estudianteId, currentCriterio.id, '');
        }
      }
      return; // Dejar que el evento continúe hacia onChange para concatenar o insertar
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        // Limpiar la celda actual
        e.preventDefault();
        // Obtener todos los criterios en un array plano
        const allCriterios = indicadores.flatMap(ind => ind.criterios);
        const currentCriterio = allCriterios[criterioIndex];
        if (currentCriterio) {
          handleNotaChange(estudianteId, currentCriterio.id, '');
        }
        return;
      case 'ArrowRight':
        if (criterioIndex < totalColumns - 1) {
          nextCol++;
        }
        break;
      case 'ArrowLeft':
        if (criterioIndex > 0) {
          nextCol--;
        }
        break;
      case 'ArrowDown':
        if (rowIndex < estudiantes.length - 1) {
          nextRow++;
        }
        break;
      case 'ArrowUp':
        if (rowIndex > 0) {
          nextRow--;
        }
        break;
      default:
        return; // No manejar otras teclas
    }
    
    // Prevenir comportamiento predeterminado
    e.preventDefault();
    
    // Obtener el siguiente estudiante y criterio index
    const nextEstudiante = estudiantes[nextRow];
    if (!nextEstudiante) return;
    
    // Calcular el criterio real basado en el índice de columna
    let currentCol = 0;
    let nextCriterio = null;
    
    for (const ind of indicadores) {
      for (const crit of ind.criterios) {
        if (currentCol === nextCol) {
          nextCriterio = crit;
          break;
        }
        currentCol++;
      }
      if (nextCriterio) break;
    }
    
    if (nextCriterio) {
      const key = `row-${nextEstudiante.id}-col-${nextCol}`;
      const nextInput = inputsRef.current.get(key);
      if (nextInput) {
        nextInput.focus();
      }
    }
  };

  // Calcular total por indicador
  const calcularTotalIndicador = (estudianteNotas: Record<number, number>, indicador: Indicador): number => {
    return indicador.criterios.reduce((sum, criterio) => {
      const nota = estudianteNotas[criterio.id] || 0;
      return sum + nota;
    }, 0);
  };

  // Calcular total final (solo indicadores activos)
  const calcularTotalFinal = (estudianteNotas: Record<number, number>): number => {
    if (isQualitative) return 0; // No usar totales numéricos en modo cualitativo
    const indicadoresActivos = indicadores.filter(i => i.activo);
    return indicadoresActivos.reduce((sum, indicador) => {
      return sum + calcularTotalIndicador(estudianteNotas, indicador);
    }, 0);
  };

  // Guardar notas
  const handleGuardarNotas = async () => {
    if (notas.length === 0) {
      await emit("show-toast", { message: "⚠️ No hay estudiantes para guardar notas", type: 'info' });
      return;
    }

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
    for (const notaEst of notas) {
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
      const notasParaGuardar = notas.map(notaEst => ({
        estudianteId: notaEst.estudianteId,
        notas: Object.entries(notaEst.notas).map(([criterioId, valor]) => ({
          criterioId: parseInt(criterioId),
          valor: valor
        }))
      }));

      console.log("LOG [Guardar]: Iniciando guardado de notas en SQLite", {
        totalEstudiantes: notasParaGuardar.length,
        corteId: selectedCorte,
        asignaturaId: selectedAsignatura,
        primerosDatos: notasParaGuardar.slice(0, 2)
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

      // Feedback inmediato tras guardado local (SQLite es instantáneo)
      setSaving(false);
      await emit("show-toast", { message: "✅ Notas guardadas localmente", type: "success" });
      
      // Sincronización en segundo plano (No bloqueante)
      (async () => {
        try {
          console.log("LOG [Sincronización]: Iniciando en segundo plano...");
          // Asegurar que los indicadores y criterios existan en Supabase antes de las notas
          await syncService.syncEvaluacionConfig(indicadores);

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

      // Recargar datos localmente y notificar a otros componentes
      fetchEstudiantes(undefined, true);
      setTimeout(async () => {
        await emit("notas-updated", { timestamp: Date.now() });
      }, 100);

    } catch (error) {
      console.error("Error saving notes:", error);
      await emit("show-toast", { message: "❌ Error al guardar notas: " + error, type: "error" });
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <div className="category-grid" style={{ display: 'block' }}>
      
      {/* Filtros de Búsqueda */}
      <div className="category-card sticky-filters" style={{ 
        position: 'sticky', 
        top: 0, 
        zIndex: 999, 
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
        background: 'rgba(26, 26, 26, 0.8)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        marginBottom: isMobile ? '0.5rem' : '1.5rem',
        width: '100%',
        padding: isMobile ? '0.3rem' : '0.6rem',
        borderRadius: '0 0 12px 12px',
        border: '1px solid rgba(255,255,255,0.05)',
        borderTop: 'none'
      }}>
        <div className="filters-row" style={{ 
          padding: isMobile ? '0.2rem' : '0.4rem', 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: isMobile ? '0.3rem' : '0.4rem',
          justifyContent: 'flex-start',
          alignItems: 'flex-end'
        }}>
           {/* Año Lectivo */}
           <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '2px', flex: isMobile ? '1 1 40%' : '0 0 auto' }}>
             {!isMobile && <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>Año Lectivo:</label>}
             <select 
               className="filter-select"
               style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
               value={selectedAno}
               onChange={(e) => setSelectedAno(Number(e.target.value))}
             >
                {anos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
             </select>
           </div>
           
           {/* Corte */}
           <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '2px', flex: isMobile ? '1 1 40%' : '0 0 auto' }}>
             {!isMobile && <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>Corte:</label>}
             <select 
               className="filter-select"
               style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
               value={selectedCorte}
               onChange={(e) => setSelectedCorte(Number(e.target.value))}
             >
                {cortes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
             </select>
           </div>

           {/* Colegio */}
           <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '2px', flex: isMobile ? '1 1 100%' : '0 0 auto' }}>
             {!isMobile && <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>Colegio:</label>}
             <select 
               className="filter-select"
               style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
               value={selectedColegio}
               onChange={(e) => setSelectedColegio(Number(e.target.value))}
             >
                {colegios.map(col => <option key={col.id} value={col.id}>{col.nombre}</option>)}
             </select>
           </div>

           {/* Grado */}
           <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '2px', flex: isMobile ? '1 1 30%' : '0 0 auto' }}>
             {!isMobile && <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>Grado:</label>}
             <select 
               className="filter-select"
               style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
               value={selectedGrado}
               onChange={(e) => setSelectedGrado(Number(e.target.value))}
             >
                {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
             </select>
           </div>

           {/* Sección */}
           <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '2px', flex: isMobile ? '1 1 30%' : '0 0 auto' }}>
             {!isMobile && <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>Sección:</label>}
             <select 
               className="filter-select"
               style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
               value={selectedSeccion}
               onChange={(e) => setSelectedSeccion(Number(e.target.value))}
             >
                {secciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
             </select>
           </div>

           {/* Sexo */}
           <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '2px', flex: isMobile ? '1 1 30%' : '0 0 auto' }}>
             {!isMobile && <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>Sexo:</label>}
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
           </div>

           {/* Asignatura */}
           <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '2px', flex: isMobile ? '1 1 100%' : '0 0 auto' }}>
             {!isMobile && <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>Asignatura:</label>}
             <select 
               className="filter-select"
               style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
               value={selectedAsignatura}
               onChange={(e) => setSelectedAsignatura(Number(e.target.value))}
             >
                {asignaturas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
             </select>
           </div>

           {/* Buscador Dinámico */}
           <div className="search-container" style={{ minWidth: isMobile ? '120px' : '180px', flex: '1', maxWidth: '300px' }}>
             <span className="search-icon-left">🔍</span>
             <input 
               type="text" 
               className="search-input search-input-with-icon" 
               placeholder={isMobile ? "Buscar..." : "Buscar estudiante..."}
               style={{ fontSize: '0.75rem', padding: '0.3rem 1.8rem 0.3rem 1.8rem', height: '28px' }}
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
             />
             {searchTerm && (
               <span 
                 className="search-clear-icon" 
                 onClick={() => setSearchTerm("")}
                 title="Limpiar búsqueda"
                 style={{ right: '8px', top: '50%', transform: 'translateY(-50%)' }}
               >
                 ✕
               </span>
             )}
           </div>

           {/* Botones de Acción */}
           <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
             <button 
               onClick={undo} 
               disabled={history.length === 0}
               className="icon-button"
               title="Deshacer (Ctrl+Z)"
               style={{ 
                 background: 'rgba(255,255,255,0.05)', 
                 padding: '0.3rem 0.5rem',
                 borderRadius: '6px',
                 opacity: history.length === 0 ? 0.3 : 1,
                 cursor: history.length === 0 ? 'not-allowed' : 'pointer',
                 width: 'auto',
                 fontSize: '0.7rem',
                 height: '28px',
                 display: 'flex',
                 alignItems: 'center',
                 justifyContent: 'center'
               }}
             >
               ↩️ Deshacer
             </button>
             <button 
               onClick={redo} 
               disabled={redoStack.length === 0}
               className="icon-button"
               title="Rehacer (Ctrl+Y)"
               style={{ 
                 background: 'rgba(255,255,255,0.05)', 
                 padding: '0.3rem 0.5rem',
                 borderRadius: '6px',
                 opacity: redoStack.length === 0 ? 0.3 : 1,
                 cursor: redoStack.length === 0 ? 'not-allowed' : 'pointer',
                 width: 'auto',
                 fontSize: '0.7rem',
                 height: '28px',
                 display: 'flex',
                 alignItems: 'center',
                 justifyContent: 'center'
               }}
             >
               ↪️ Rehacer
             </button>
             <button 
               onClick={handleGuardarNotas}
               disabled={saving || (estudiantes.length === 0)}
               className="icon-button"
               title="Guardar Notas (Ctrl+G)"
               style={{ 
                 background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                 padding: '0.3rem 0.6rem',
                 borderRadius: '6px',
                 color: 'white',
                 border: 'none',
                 opacity: (saving || estudiantes.length === 0) ? 0.5 : 1,
                 cursor: (saving || estudiantes.length === 0) ? 'not-allowed' : 'pointer',
                 width: 'auto',
                 display: 'flex',
                 alignItems: 'center',
                 justifyContent: 'center',
                 gap: '4px',
                 fontWeight: 'bold',
                 fontSize: '0.7rem',
                 height: '28px'
               }}
             >
               <span>{saving ? '⏳' : '💾'}</span>
               <span>{saving ? 'Guardando...' : 'Guardar'}</span>
             </button>
           </div>
        </div>
      </div>

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
                {filteredNotas.map((est, index) => {
                  const estudianteNotas = notas.find(n => n.estudianteId === est.estudianteId) || { notas: {} };
                  const isEven = index % 2 === 0;
                  const isEditing = editingStudentId === est.estudianteId;
                  
                  // Calculamos colores SÓLIDOS (sin transparencias)
                  // Si estamos editando, usamos un tono derivado del color de resaltado del usuario
                  const rowBg = isEditing 
                    ? `${highlightColor}33` // Sigue siendo un poco transparente para la fila general...
                    : (isEven ? '#0f172a' : '#161e2f');
                  
                  // Pero para las columnas STICKY, forzamos un color TOTALMENTE SÓLIDO mezclado
                  // Esto evita que se vea lo de abajo pero mantiene la estética del usuario
                  const stickyBg = isEditing
                    ? '#1e293b' // Un tono azulado sólido para edición que combina con el resaltado
                    : (isEven ? '#0f172a' : '#161e2f');

                  const nameColor = isEditing ? highlightColor : '#e2e8f0';
                  
                  return (
                    <tr key={est.estudianteId} style={{ background: rowBg, transition: 'background 0.2s ease' }}>
                      <td style={{ 
                        padding: '0.2rem', 
                        textAlign: 'center', 
                        color: isEditing ? highlightColor : '#94a3b8',
                        position: 'sticky',
                        left: 0,
                        background: stickyBg, // Fondo sólido para bloquear transparencia
                        zIndex: 5,
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        fontSize: '0.65rem',
                        transition: 'all 0.2s ease'
                      }}>{index + 1}</td>
                      <td style={{ 
                        padding: '0.3rem', 
                        color: nameColor,
                        position: 'sticky',
                        left: '35px',
                        background: stickyBg, // Fondo sólido para bloquear transparencia
                        zIndex: 5,
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        transition: 'all 0.2s ease'
                      }}>
                        <div style={{ 
                          fontWeight: 'bold', 
                          fontSize: '0.75rem', 
                          whiteSpace: 'nowrap', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          maxWidth: '120px',
                          color: nameColor
                        }}>{est.estudianteNombre}</div>
                      </td>
                      {(() => {
                        const allCriterios = indicadores.flatMap(ind => ind.criterios);
                        return indicadores.map(ind => (
                          <Fragment key={`row-${est.estudianteId}-ind-${ind.id}`}>
                            {ind.criterios.map(crit => {
                              const criterioIndex = allCriterios.findIndex(c => c.id === crit.id);
                              const inputKey = `row-${est.estudianteId}-col-${criterioIndex}`;
                              const key = `${est.estudianteId}-${crit.id}`;
                              const currentQualitativeValue = notasCualitativas.get(key) || '';
                              
                              return (
                                <td key={`${est.estudianteId}-${crit.id}`} style={{ padding: '0.15rem', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                  <input
                                    type="text"
                                    value={currentQualitativeValue}
                                    onChange={(e) => handleNotaChange(est.estudianteId, crit.id, e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(e, est.estudianteId, criterioIndex)}
                                    onFocus={(e) => {
                                      handleInputFocus();
                                      setEditingStudentId(est.estudianteId);
                                      // Seleccionar todo el texto al ganar el foco para facilitar sobreescritura
                                      e.target.select();
                                    }}
                                    onBlur={(e) => {
                                      handleInputBlur(est.estudianteId, crit.id, e.target.value);
                                      setEditingStudentId(null);
                                    }}
                                    ref={(el) => {
                                      if (el) inputsRef.current.set(inputKey, el);
                                      else inputsRef.current.delete(inputKey);
                                    }}
                                    style={{
                                      width: '32px',
                                      padding: '0.15rem',
                                      fontSize: '0.75rem',
                                      textAlign: 'center',
                                      background: 'rgba(255,255,255,0.03)',
                                      border: `1px solid ${currentQualitativeValue ? getGradeColor(currentQualitativeValue, crit.puntajeMaximo) : 'rgba(255,255,255,0.1)'}`,
                                      borderRadius: '3px',
                                      color: currentQualitativeValue ? getGradeColor(currentQualitativeValue, crit.puntajeMaximo) : 'white',
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
                                const totalIndicador = calcularTotalIndicador(estudianteNotas.notas, ind);
                                const totalIndicadorRedondeado = Math.round(totalIndicador);
                                
                                // Calcular el puntaje máximo real de este indicador
                                const maximoIndicador = ind.criterios.reduce((sum, c) => sum + (c.puntajeMaximo || 0), 0);
                                const totalEscalado = maximoIndicador > 0 ? (totalIndicador / maximoIndicador) * 100 : 0;
                                
                                const gradeConfig = getGradeFromScore(totalEscalado);
                                
                                const qualitativeGrade = isQualitative 
                                  ? calcularNotaCualitativaFinal(ind.criterios.map(c => notasCualitativas.get(`${est.estudianteId}-${c.id}`) || ''))
                                  : gradeConfig?.id || '';
                                
                                const displayColor = ind.activo 
                                  ? (isQualitative ? getGradeColor(qualitativeGrade) : (gradeConfig?.color || '#4ade80'))
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
                        background: stickyBg, // Forzamos fondo sólido para evitar transparencia
                        position: 'sticky',
                        right: 0,
                        zIndex: 5,
                        borderBottom: '1px solid rgba(34, 197, 94, 0.2)'
                      }}>
                        {(() => {
                          const rawTotalFinal = calcularTotalFinal(estudianteNotas.notas);
                          const totalFinal = Math.round(rawTotalFinal);
                          
                          // Calcular el puntaje máximo total de indicadores activos
                          const maximoTotal = indicadores
                            .filter(i => i.activo)
                            .reduce((sum, i) => sum + i.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0);
                          
                          const totalEscaladoFinal = maximoTotal > 0 ? (rawTotalFinal / maximoTotal) * 100 : 0;
                          const gradeConfig = getGradeFromScore(totalEscaladoFinal);
                          const qualitativeFinal = isQualitative 
                            ? calcularNotaCualitativaFinal(indicadores.filter(i => i.activo).map(i => {
                                return calcularNotaCualitativaFinal(i.criterios.map(c => notasCualitativas.get(`${est.estudianteId}-${c.id}`) || ''));
                              }))
                            : gradeConfig?.id || '';
                          const displayColor = isQualitative ? getGradeColor(qualitativeFinal) : (gradeConfig?.color || '#4ade80');

                          return (
                            <div style={{ 
                              color: displayColor, 
                              fontSize: '0.8rem', 
                              fontWeight: 'bold',
                              background: stickyBg, // Fondo sólido también aquí
                              padding: '0.2rem',
                              borderRadius: '4px'
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
                })}
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