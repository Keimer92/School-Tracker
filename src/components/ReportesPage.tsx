import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { join, tempDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
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
  sexo: string;
  grado: string;
  seccion: string;
}

interface EstudianteReporte extends Estudiante {
  notasIndicadores: Record<number, number>;
  notasCualitativasIndicadores: Record<number, string>; // Nueva propiedad para las etiquetas cualitativas
  notasCriterios?: Record<number, number>;
  notaFinal: number;
  notaFinalCualitativa?: string; // Nueva propiedad para la nota final cualitativa
}

interface GradeConfig {
  id: string;
  color: string;
  minimo: number;
}

export function ReportesPage() {
  // Filtros
  const [anos, setAnos] = useState<CategoryItem[]>([]);
  const [cortes, setCortes] = useState<CategoryItem[]>([]);
  const [colegios, setColegios] = useState<CategoryItem[]>([]);
  const [asignaturas, setAsignaturas] = useState<CategoryItem[]>([]);
  const [grados, setGrados] = useState<CategoryItem[]>([]);
  const [secciones, setSecciones] = useState<CategoryItem[]>([]);
  const [gradeConfigs, setGradeConfigs] = useState<GradeConfig[]>([]);

  // Estados para los valores seleccionados
  const [selectedAno, setSelectedAno] = useState<number>(0);
  const [selectedCorte, setSelectedCorte] = useState<number>(0);
  const [specialCorte, setSpecialCorte] = useState<string>(""); // Nuevo estado para Semestres y Nota Final
  const [selectedColegio, setSelectedColegio] = useState<number>(0);
  const [selectedAsignatura, setSelectedAsignatura] = useState<number>(0);
  const [selectedGrado, setSelectedGrado] = useState<number>(0);
  const [selectedSeccion, setSelectedSeccion] = useState<number>(0);
  const [selectedSexo, setSelectedSexo] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  
  // Estado para estudiantes y configuración
  const [estudiantes, setEstudiantes] = useState<EstudianteReporte[]>([]);
  const [configIndicadores, setConfigIndicadores] = useState<Indicador[]>([]);

  // Filtrado dinámico por búsqueda
  const filteredReporte = useMemo(() => {
    if (!searchTerm) return estudiantes;
    const term = searchTerm.toLowerCase();
    return estudiantes.filter(est => 
      est.nombre.toLowerCase().includes(term)
    );
  }, [estudiantes, searchTerm]);
  
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeSlide, setActiveSlide] = useState<'tabla' | 'estadisticas'>('tabla');
  const [isMobile, setIsMobile] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
      setIsAndroid(/Android/i.test(navigator.userAgent));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [printConfig, setPrintConfig] = useState({
    pageSize: 'letter',
    orientation: 'portrait',
    margins: {
      top: 10,
      bottom: 10,
      left: 10,
      right: 10
    }
  });

  const isQualitative = useMemo(() => {
    const grado = grados.find(g => g.id === selectedGrado);
    const asignatura = asignaturas.find(a => a.id === selectedAsignatura);
    return (grado?.cualitativo || false) || (asignatura?.cualitativo || false);
  }, [grados, selectedGrado, asignaturas, selectedAsignatura]);

  // @ts-ignore
  const notaMapping = {
    AA: 1.0,
    AS: 0.85,
    AF: 0.65,
    AI: 0.40
  };

  const getQualitativeLabel = (score: number) => {
    if (!gradeConfigs || gradeConfigs.length === 0) return 'AI';
    
    // Ordenar configuraciones por puntaje mínimo descendente
    const sortedConfigs = [...gradeConfigs].sort((a, b) => {
      if (b.minimo !== a.minimo) return b.minimo - a.minimo;
      // Si los mínimos son iguales (error de DB), usamos el ID como desempate inverso
      // para que el orden sea AA, AS, AF, AI y el .find encuentre el primero.
      return a.id.localeCompare(b.id);
    });
    
    const config = sortedConfigs.find(c => score >= c.minimo - 0.01);
    return config ? config.id : (gradeConfigs.find(c => c.id === 'AI')?.id || 'AI');
  };

  const totalPuntajeMaximoConfig = useMemo(() => {
    return configIndicadores.reduce((total, ind) => {
      if (!ind.activo) return total;
      return total + ind.criterios.reduce((sum, crit) => sum + (crit.puntajeMaximo || 0), 0);
    }, 0);
  }, [configIndicadores]);

  const getPorcentajeFinal = (nota: number, maximo: number) => {
    if (maximo <= 0) return 0;
    return (nota / maximo) * 100;
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
      if (counts[n] > maxCount) maxCount = counts[n];
    });

    const modes = Object.keys(counts).filter(n => counts[n] === maxCount);
    
    // Si hay una moda única Y se repite (maxCount > 1), devolverla
    if (modes.length === 1 && maxCount > 1) return modes[0];

    // 2. Si no hay moda clara (todas diferentes) o hay empate, usar el término medio (promedio de pesos)
    const weights = validNotes.map(n => qualitativeWeights[n]);
    const sum = weights.reduce((a, b) => a + b, 0);
    const average = Math.round(sum / weights.length);
    
    return reverseQualitativeWeights[average as keyof typeof reverseQualitativeWeights] || 'AI';
  };

  // Función para obtener el color de una nota basado en la configuración
  const getNoteColor = (score: number, label?: string) => {
    // Si es cualitativo y tenemos una etiqueta, buscar por ID directamente
    if (isQualitative && label) {
      const config = gradeConfigs.find(c => c.id === label);
      if (config) return config.color;
    }
    
    if (gradeConfigs.length === 0) {
      return score >= 60 ? '#4ade80' : '#f87171';
    }

    // Ordenar por puntaje mínimo descendente para encontrar el rango correcto
    const sortedConfigs = [...gradeConfigs].sort((a, b) => b.minimo - a.minimo);
    const config = sortedConfigs.find(c => score >= c.minimo);
    
    if (!config) {
      // Fallback a AI si no encuentra configuración (puntaje muy bajo)
      const aiConfig = gradeConfigs.find(c => c.id === 'AI');
      return aiConfig ? aiConfig.color : '#f87171';
    }
    
    return config.color;
  };

  const hexToRgb = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result 
      ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
      : [0, 0, 0];
  };

  // Cargar catálogos iniciales
  useEffect(() => {
    // Escuchar cambios en la configuración de colores desde AjustesPage
    let unlistenGradeConfigs: (() => void) | null = null;
    let unlistenNotas: (() => void) | null = null;
    let unlistenStudents: (() => void) | null = null;
    let unlistenCatalogs: (() => void) | null = null;

    // REGISTRAR LISTENERS PRIMERO
    listen("grade-configs-updated", async (_event) => {
      try {
        const configsData = await invoke<GradeConfig[]>("get_grade_configs");
        setGradeConfigs(configsData);
      } catch (error) {
        console.error("Error refreshing grade configs in ReportesPage:", error);
      }
    }).then(u => unlistenGradeConfigs = u);

    listen("notas-updated", () => {
      console.log("ReportesPage: Evento notas-updated recibido, refrescando reporte...");
      setRefreshTrigger(prev => prev + 1);
    }).then(u => unlistenNotas = u);

    listen("student-updated", () => {
      setRefreshTrigger(prev => prev + 1);
    }).then(u => unlistenStudents = u);

    listen("catalog-updated", () => {
      console.log("ReportesPage: Evento catalog-updated recibido, refrescando...");
      fetchInitialCatalogs();
    }).then(u => unlistenCatalogs = u);

    // CARGAR DATOS DESPUÉS
    fetchInitialCatalogs();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        setActiveSlide(prev => prev === 'tabla' ? 'estadisticas' : 'tabla');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (unlistenGradeConfigs) unlistenGradeConfigs();
      if (unlistenNotas) unlistenNotas();
      if (unlistenStudents) unlistenStudents();
      if (unlistenCatalogs) unlistenCatalogs();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Cargar grados y asignaturas cuando cambie el colegio
  useEffect(() => {
    if (selectedColegio > 0 && selectedAno > 0) {
      fetchGradosYAsignaturas();
    } else {
      setGrados([]);
      setAsignaturas([]);
      setSelectedGrado(0);
      setSelectedAsignatura(0);
    }
  }, [selectedColegio, selectedAno]);

  // Cargar secciones cuando cambie el grado o el colegio o el año
  useEffect(() => {
    if (selectedGrado > 0 && selectedColegio > 0 && selectedAno > 0) {
      fetchSecciones();
    } else {
      setSecciones([]);
      setSelectedSeccion(0);
    }
  }, [selectedGrado, selectedColegio, selectedAno]);

  // Cargar reporte cuando cambien los filtros críticos
  useEffect(() => {
    console.log("ReportesPage: useEffect disparado por cambios en dependencias", {
      selectedGrado, selectedSeccion, selectedCorte, specialCorte, selectedAsignatura, refreshTrigger
    });
    if (selectedGrado > 0 && selectedSeccion > 0 && (selectedCorte > 0 || specialCorte) && selectedAsignatura > 0) {
      fetchReporte();
    } else {
      setEstudiantes([]);
      setConfigIndicadores([]);
    }
  }, [selectedAno, selectedCorte, specialCorte, selectedColegio, selectedAsignatura, selectedGrado, selectedSeccion, selectedSexo, refreshTrigger]);

  // Obtener nombres de los filtros para el encabezado de impresión
  const getSelectedNames = () => {
    let corteNombre = cortes.find(c => c.id === selectedCorte)?.nombre || "";
    if (specialCorte === "1S") corteNombre = "1er Semestre";
    else if (specialCorte === "2S") corteNombre = "2do Semestre";
    else if (specialCorte === "NF") corteNombre = "Nota Final";

    return {
      ano: anos.find(a => a.id === selectedAno)?.nombre || "",
      corte: corteNombre,
      colegio: colegios.find(c => c.id === selectedColegio)?.nombre || "",
      asignatura: asignaturas.find(a => a.id === selectedAsignatura)?.nombre || "",
      grado: grados.find(g => g.id === selectedGrado)?.nombre || "",
      seccion: secciones.find(s => s.id === selectedSeccion)?.nombre || ""
    };
  };

  const selectedNames = getSelectedNames();

  const fetchInitialCatalogs = async () => {
    try {
      const [anosData, cortesData, colegiosData, configsData] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_cortes"),
        invoke<CategoryItem[]>("get_colegios"),
        invoke<GradeConfig[]>("get_grade_configs"),
      ]);
      setAnos(anosData);
      setCortes(cortesData);
      setColegios(colegiosData);
      setGradeConfigs(configsData);
      
      // Seleccionar valores por defecto (activos o el primero)
      if (anosData.length > 0) {
        const activo = anosData.find(a => a.activo);
        setSelectedAno(activo ? activo.id : anosData[0].id);
      }
      
      if (cortesData.length > 0) {
        const activo = cortesData.find(c => c.activo);
        setSelectedCorte(activo ? activo.id : cortesData[0].id);
      }
      
      if (colegiosData.length > 0) {
        const activo = colegiosData.find(c => c.activo);
        setSelectedColegio(activo ? activo.id : colegiosData[0].id);
      }
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: "❌ Error al cargar catálogos: " + error, type: "error" });
    }
  };

  const fetchGradosYAsignaturas = async () => {
    try {
      const [gradosData, asignaturasData] = await Promise.all([
        invoke<CategoryItem[]>("get_grados_by_colegio", { colegioId: selectedColegio, anoLectivoId: selectedAno }),
        invoke<CategoryItem[]>("get_subjects_by_colegio", { colegioId: selectedColegio }),
      ]);
      setGrados(gradosData);
      
      if (gradosData.length > 0) {
        const stillExists = gradosData.some(g => g.id === selectedGrado);
        if (!stillExists) setSelectedGrado(gradosData[0].id || 0);
      } else {
        setSelectedGrado(0);
      }

      // Si el backend tuviera get_subjects_by_grade, lo ideal sería cargarlas cuando cambie el grado
      let filteredAsignaturas = asignaturasData;
      if (selectedGrado > 0) {
        try {
          const subjectsByGrade = await invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrado });
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
        if (!stillExists) setSelectedAsignatura(filteredAsignaturas[0].id || 0);
      } else {
        setSelectedAsignatura(0);
      }

    } catch (error) {
      console.error("Error fetching grados y asignaturas:", error);
      await emit("show-toast", { message: "❌ Error al cargar grados y asignaturas: " + error, type: "error" });
    }
  };

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
        if (!stillExists) setSelectedSeccion(data[0].id || 0);
      } else {
        setSelectedSeccion(0);
      }
    } catch (error) {
      console.error("Error fetching secciones:", error);
      await emit("show-toast", { message: "❌ Error al cargar secciones: " + error, type: "error" });
    }
  };

  const fetchReporte = async () => {
    console.log("ReportesPage: Ejecutando fetchReporte...", { specialCorte });
    setLoading(true);
    try {
      // 1. Determinar qué cortes evaluativos usar
      let cortesIds: number[] = [];
      if (specialCorte === "1S") {
        // Asumimos que los IDs 1 y 2 son el 1er y 2do corte
        // Pero es mejor buscarlos por nombre para ser robustos
        const c1 = cortes.find(c => c.nombre.toLowerCase().includes("1er"))?.id;
        const c2 = cortes.find(c => c.nombre.toLowerCase().includes("2do"))?.id;
        if (c1) cortesIds.push(c1);
        if (c2) cortesIds.push(c2);
      } else if (specialCorte === "2S") {
        const c3 = cortes.find(c => c.nombre.toLowerCase().includes("3er"))?.id;
        const c4 = cortes.find(c => c.nombre.toLowerCase().includes("4to"))?.id;
        if (c3) cortesIds.push(c3);
        if (c4) cortesIds.push(c4);
      } else if (specialCorte === "NF") {
        cortesIds = cortes.map(c => c.id);
      } else {
        cortesIds = [selectedCorte];
      }

      if (cortesIds.length === 0) {
        throw new Error("No se pudieron determinar los cortes evaluativos.");
      }

      // 2. Obtener configuración de indicadores (usamos el primer corte para la estructura)
      // En semestres o nota final, la estructura de indicadores suele ser la misma
      const indicadores = await invoke<Indicador[]>("get_evaluation_config", {
        gradoId: selectedGrado,
        asignaturaId: selectedAsignatura,
        corteEvaluativoId: cortesIds[0]
      });
      setConfigIndicadores(indicadores);

      // 3. Obtener estudiantes
      const listaEstudiantes = await invoke<any[]>("get_estudiantes_by_filters", {
        gradoId: selectedGrado,
        seccionId: selectedSeccion
      });

      // 4. Obtener notas para TODOS los cortes necesarios
      const todasLasNotas = await Promise.all(cortesIds.map(cId => 
        invoke<any[]>("get_notas_by_filters", {
          gradoId: selectedGrado,
          seccionId: selectedSeccion,
          corteId: cId,
          asignaturaId: selectedAsignatura
        })
      ));

      // 5. Mapear todas las notas en un objeto global para acceso rápido: [corteId][estudianteId][criterioId] = valor
      const notasGlobales: Record<number, Record<number, Record<number, number>>> = {};
      todasLasNotas.forEach((notasCorte, index) => {
        const cId = cortesIds[index];
        notasGlobales[cId] = {};
        notasCorte.forEach(n => {
          if (!notasGlobales[cId][n.estudianteId]) {
            notasGlobales[cId][n.estudianteId] = {};
          }
          notasGlobales[cId][n.estudianteId][n.criterioId] = n.valor;
        });
      });

      // 6. Procesar y promediar
      const reporte: EstudianteReporte[] = listaEstudiantes.map(est => {
        const notasEstPorCorte: Record<number, number> = {};
        const tieneNotasEnCorte: Record<number, boolean> = {};
        const notasCualitativasEstPorCorte: Record<number, string> = {};
        
        cortesIds.forEach(cId => {
          const notasCriterios = notasGlobales[cId]?.[est.id] || {};
          let totalCorte = 0;
          let totalMaximoCorte = 0;
          let haIngresadoAlgunaNota = false;
          const labelsCualitativosCorte: string[] = [];

          indicadores.forEach(ind => {
            if (ind.activo) {
              ind.criterios.forEach(crit => {
                const valor = notasCriterios[crit.id];
                if (valor !== undefined) {
                  totalCorte += valor;
                  haIngresadoAlgunaNota = true;
                  totalMaximoCorte += crit.puntajeMaximo;
                  
                  if (isQualitative) {
                    // Mapeo robusto basado en rangos (similar a NotasPage.tsx)
                    const ratio = valor / (crit.puntajeMaximo || 1);
                    let qualValue = "AI";
                    if (ratio >= 0.90) qualValue = "AA";
                    else if (ratio >= 0.70) qualValue = "AS";
                    else if (ratio >= 0.50) qualValue = "AF";
                    else if (ratio >= 0.30) qualValue = "AI";
                    
                    labelsCualitativosCorte.push(qualValue);
                  }
                }
              });
            }
          });
          
          if (haIngresadoAlgunaNota) {
            const porcentaje = (totalCorte / (totalMaximoCorte || 1)) * 100;
            // Para grados cuantitativos, guardamos la suma redondeada como en NotasPage
            notasEstPorCorte[cId] = isQualitative ? porcentaje : Math.round(totalCorte);
            tieneNotasEnCorte[cId] = true;
            
            if (isQualitative) {
              notasCualitativasEstPorCorte[cId] = calcularNotaCualitativaFinal(labelsCualitativosCorte);
            } else {
              // Para cuantitativo, necesitamos la etiqueta cualitativa del total del corte
              notasCualitativasEstPorCorte[cId] = getQualitativeLabel(porcentaje);
            }
          }
        });

        // Calcular nota final
        let notaFinalValue = 0;
        let notaFinalCualitativa = "-";
        
        const cortesConNotas = cortesIds.filter(cId => tieneNotasEnCorte[cId]);
        
        if (cortesConNotas.length > 0) {
          const sumaNotasCortes = cortesConNotas.reduce((sum, cId) => sum + notasEstPorCorte[cId], 0);
          const promedio = sumaNotasCortes / cortesConNotas.length;
          
          if (isQualitative) {
            const labelsCortes = cortesConNotas.map(cId => notasCualitativasEstPorCorte[cId]);
            notaFinalCualitativa = calcularNotaCualitativaFinal(labelsCortes);
            notaFinalValue = promedio;
          } else {
            notaFinalValue = Math.round(promedio);
            // El porcentaje para la etiqueta cualitativa se basa en el promedio sobre el máximo de un corte
            // ya que cada corte tiene el mismo máximo (20 puntos por ejemplo)
            const maximoUnCorte = indicadores.reduce((total, ind) => {
              if (!ind.activo) return total;
              return total + ind.criterios.reduce((sum, crit) => sum + (crit.puntajeMaximo || 0), 0);
            }, 0);
            const pctFinal = getPorcentajeFinal(promedio, maximoUnCorte);
            notaFinalCualitativa = getQualitativeLabel(pctFinal);
          }
        }

        const notasIndicadoresSimuladas: Record<number, number> = {};
        const notasCualitativasIndicadoresSimuladas: Record<number, string> = {};

        if (specialCorte) {
          // En modo especial, las columnas muestran los cortes
          cortesIds.forEach((cId) => {
            if (tieneNotasEnCorte[cId]) {
              notasIndicadoresSimuladas[cId] = notasEstPorCorte[cId];
              notasCualitativasIndicadoresSimuladas[cId] = notasCualitativasEstPorCorte[cId];
            } else {
              notasCualitativasIndicadoresSimuladas[cId] = "-";
            }
          });
        } else {
          // Modo normal: indicadores detallados de un solo corte
          const cId = cortesIds[0];
          const notasCriterios = notasGlobales[cId]?.[est.id] || {};
          
          indicadores.forEach(ind => {
            if (!ind.activo) return;
            let totalIndicador = 0;
            let totalMaximoPosible = 0;
            let countCriteriosConNota = 0;
            const labelsIndicador: string[] = [];
            
            ind.criterios.forEach(crit => {
              const valor = notasCriterios[crit.id];
              if (valor !== undefined) {
                totalIndicador += valor;
                totalMaximoPosible += crit.puntajeMaximo;
                countCriteriosConNota++;
                
                if (isQualitative) {
                  // Mapeo robusto basado en rangos (similar a NotasPage.tsx)
                  const ratio = valor / (crit.puntajeMaximo || 1);
                  let qualValue = "AI";
                  if (ratio >= 0.90) qualValue = "AA";
                  else if (ratio >= 0.70) qualValue = "AS";
                  else if (ratio >= 0.50) qualValue = "AF";
                  else if (ratio >= 0.30) qualValue = "AI";
                  
                  labelsIndicador.push(qualValue);
                }
              }
            });

            if (countCriteriosConNota > 0) {
              const porcentaje = (totalIndicador / (totalMaximoPosible || 1)) * 100;
              notasIndicadoresSimuladas[ind.id] = isQualitative ? porcentaje : Math.round(totalIndicador);
              notasCualitativasIndicadoresSimuladas[ind.id] = isQualitative 
                ? calcularNotaCualitativaFinal(labelsIndicador)
                : getQualitativeLabel(porcentaje);
            } else {
              notasCualitativasIndicadoresSimuladas[ind.id] = "-";
            }
          });
        }

        return {
          ...est,
          notasIndicadores: notasIndicadoresSimuladas,
          notasCualitativasIndicadores: notasCualitativasIndicadoresSimuladas,
          notaFinal: notaFinalValue,
          notaFinalCualitativa: notaFinalCualitativa
        };
      });

      // Actualizar la configuración de "indicadores" visuales si estamos en modo especial
      if (specialCorte) {
        const indicadoresEspeciales = cortesIds.map((cId, idx) => ({
          id: cId,
          orden: idx + 1,
          descripcion: cortes.find(c => c.id === cId)?.nombre || `Corte ${idx + 1}`,
          activo: true,
          criterios: [] // No hay criterios detallados en vista resumida
        }));
        setConfigIndicadores(indicadoresEspeciales as any);
      }

      const reporteFiltrado = selectedSexo 
        ? reporte.filter(est => est.sexo === selectedSexo)
        : reporte;

      setEstudiantes(reporteFiltrado);
    } catch (error) {
      console.error("Error fetching reporte:", error);
      await emit("show-toast", { message: "❌ Error al cargar el reporte: " + error, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const exportToPDF = async () => {
    if (estudiantes.length === 0) return;

    try {
      // @ts-ignore
      const doc = new jsPDF({
        orientation: printConfig.orientation,
        unit: 'mm',
        format: printConfig.pageSize
      });
      const names = getSelectedNames();
      const date = new Date().toLocaleDateString();

      // Título
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("Reporte de Calificaciones", doc.internal.pageSize.getWidth() / 2, 15, { align: "center" });

      // Información de filtros
      doc.setFontSize(10);
      doc.setTextColor(0); // Negro en lugar de gris
      
      const filterInfo = [
        ["Colegio:", names.colegio, "Año Lectivo:", names.ano],
        ["Grado:", names.grado, "Sección:", names.seccion],
        ["Asignatura:", names.asignatura, "Corte:", names.corte],
        ["Fecha:", date, "Sexo:", selectedSexo === "M" ? "Masculino" : selectedSexo === "F" ? "Femenino" : "Todos"]
      ];

      let yPos = 25;
      const margins = printConfig.margins;
      filterInfo.forEach(row => {
        doc.setFont("helvetica", "bold");
        doc.text(row[0], margins.left + 10, yPos);
        doc.setFont("helvetica", "normal");
        doc.text(row[1], margins.left + 35, yPos);
        
        doc.setFont("helvetica", "bold");
        doc.text(row[2], doc.internal.pageSize.getWidth() / 2 + 5, yPos);
        doc.setFont("helvetica", "normal");
        doc.text(row[3], doc.internal.pageSize.getWidth() / 2 + 30, yPos);
        
        yPos += 6;
      });

      // Preparar datos de la tabla
      const tableHeaders = [
        "Estudiante",
        "Sexo",
        ...(specialCorte ? [] : configIndicadores.map(ind => `Ind. ${ind.orden}`)),
        "Nota Final"
      ];

      const tableRows = estudiantes.map(est => [
        est.nombre,
        est.sexo,
        ...(specialCorte ? [] : configIndicadores.map(ind => {
          const nota = est.notasIndicadores[ind.id] || 0;
          const label = est.notasCualitativasIndicadores[ind.id] || "";
          if (label === "-" || label === "") return "-";
          
          if (isQualitative) return label;
          return `${nota}${label ? ` ${label}` : ''}`;
        })),
        (est.notaFinalCualitativa === "-" || est.notaFinalCualitativa === "") 
          ? "-" 
          : (isQualitative 
              ? (est.notaFinalCualitativa || '-') 
              : `${est.notaFinal}${est.notaFinalCualitativa ? ` ${est.notaFinalCualitativa}` : ''}`)
      ]);

      // Generar tabla
      autoTable(doc, {
        startY: yPos + 5,
        margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
        head: [tableHeaders],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 15, halign: 'center' }
        },
        didParseCell: (data) => {
          // Si es una celda de datos (no encabezado) y es una de las columnas de notas
          if (data.section === 'body' && data.column.index >= 2) {
            const rowIndex = data.row.index;
            const colIndex = data.column.index;
            const estudiante = estudiantes[rowIndex];
            
            let colorHex = "";
            let isInactive = false;

            if (colIndex === tableHeaders.length - 1) {
              // Columna de Nota Final
              if (estudiante.notaFinalCualitativa === "-") {
                colorHex = "#64748b";
              } else {
                colorHex = getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa);
              }
            } else {
              // Columnas de Indicadores
              const indicatorIndex = colIndex - 2;
              const indicator = configIndicadores[indicatorIndex];
              const indicatorId = indicator.id;
              isInactive = !indicator.activo;

              if (isInactive) {
                colorHex = "#64748b"; // Color para inactivos (gris)
              } else {
                const label = estudiante.notasCualitativasIndicadores[indicatorId] || (isQualitative ? 'AI' : '');
                if (label === "-") {
                  colorHex = "#64748b";
                } else {
                  colorHex = getNoteColor(isQualitative ? 0 : (estudiante.notasIndicadores[indicatorId] || 0), label);
                }
              }
            }

            const [r, g, b] = hexToRgb(colorHex);
            
            // Aplicar color al estilo de la celda para que autoTable lo use al dibujar
            data.cell.styles.textColor = [r, g, b];
            data.cell.styles.fontStyle = isInactive ? 'normal' : 'bold';
          }
        }
      });

      // Añadir resumen al final
      // @ts-ignore
      const finalY = doc.lastAutoTable.finalY + 10;
      let promedioText = "";
      const estudiantesConNotas = estudiantes.filter(e => e.notaFinal >= 0);
      
      if (estudiantesConNotas.length === 0) {
        promedioText = "-";
      } else if (isQualitative) {
        const labelsFinales = estudiantesConNotas.map(e => e.notaFinalCualitativa || 'AI');
        promedioText = calcularNotaCualitativaFinal(labelsFinales);
      } else {
        const promedio = (estudiantesConNotas.reduce((sum, e) => sum + e.notaFinal, 0) / estudiantesConNotas.length);
        const labelPromedio = getQualitativeLabel(getPorcentajeFinal(promedio, totalPuntajeMaximoConfig));
        promedioText = `${Math.round(promedio)}${labelPromedio ? ` (${labelPromedio})` : ''}`;
      }
      
      doc.setFontSize(11);
      doc.setTextColor(0);
      doc.text(`Total Estudiantes: ${estudiantes.length}`, margins.left + 10, finalY);
      doc.text(`Promedio Grupal: ${promedioText}`, doc.internal.pageSize.getWidth() / 2 + 15, finalY);

      // --- LÓGICA DE GUARDADO NATIVO ---
      
      // 1. Obtener el nombre de archivo sugerido
      const suggestedName = `Reporte_${names.grado}_${names.seccion}_${names.asignatura}.pdf`.replace(/\s+/g, '_');
      
      // 2. Abrir el diálogo de guardado de Tauri en todos los dispositivos
      const filePath = await save({
        filters: [{
          name: 'PDF',
          extensions: ['pdf']
        }],
        defaultPath: suggestedName
      });

      if (!filePath) return; // El usuario canceló el diálogo

      // 3. Obtener el contenido del PDF como ArrayBuffer y escribirlo usando el sistema de archivos de Tauri
      const pdfArrayBuffer = doc.output('arraybuffer');
      await writeFile(filePath, new Uint8Array(pdfArrayBuffer));
      
      // Abrir el archivo automáticamente después de guardarlo usando shell.open o openUrl
      try {
        const formattedPath = filePath.replace(/\\/g, '/');
        const fileUrl = formattedPath.startsWith('/') ? `file://${formattedPath}` : `file:///${formattedPath}`;
        await openUrl(fileUrl);
      } catch (openError) {
        console.warn("No se pudo abrir automáticamente:", openError);
      }
      
      await emit("show-toast", { message: "✅ PDF guardado exitosamente", type: 'success' });
    } catch (error) {
      console.error("Error al generar PDF:", error);
      await emit("show-toast", { 
        message: "❌ Error al generar el PDF: " + (error instanceof Error ? error.message : String(error)), 
        type: 'error' 
      });
    }
  };

  const handlePrint = async () => {
     if (estudiantes.length === 0) {
       await emit("show-toast", { message: "⚠️ No hay datos para imprimir", type: 'warning' });
       return;
     }
     
     try {
       await emit("show-toast", { message: "✅ Preparando impresión...", type: 'success' });
       const doc = new jsPDF({
        orientation: printConfig.orientation as 'landscape' | 'portrait',
        unit: 'mm',
        format: printConfig.pageSize
      });
      const margins = printConfig.margins;
      const names = getSelectedNames();
      const date = new Date().toLocaleDateString();

      // Encabezado
      doc.setFontSize(18);
      doc.setTextColor(59, 130, 246);
      doc.text("Reporte de Calificaciones", doc.internal.pageSize.getWidth() / 2, 15, { align: "center" });
      
      doc.setFontSize(10);
      doc.setTextColor(0);
      
      const filterInfo = [
        ["Colegio:", names.colegio, "Año Lectivo:", names.ano],
        ["Grado:", names.grado, "Sección:", names.seccion],
        ["Asignatura:", names.asignatura, "Corte:", names.corte],
        ["Fecha:", date, "Sexo:", selectedSexo === "M" ? "Masculino" : selectedSexo === "F" ? "Femenino" : "Todos"]
      ];

      let yPos = 25;
      filterInfo.forEach(row => {
        doc.setFont("helvetica", "bold");
        doc.text(row[0], margins.left + 10, yPos);
        doc.setFont("helvetica", "normal");
        doc.text(row[1], margins.left + 35, yPos);
        
        doc.setFont("helvetica", "bold");
        doc.text(row[2], doc.internal.pageSize.getWidth() / 2 + 5, yPos);
        doc.setFont("helvetica", "normal");
        doc.text(row[3], doc.internal.pageSize.getWidth() / 2 + 30, yPos);
        
        yPos += 6;
      });

      const tableHeaders = [
        "Estudiante",
        "Sexo",
        ...(specialCorte ? [] : configIndicadores.map(ind => `Ind. ${ind.orden}`)),
        "Nota Final"
      ];

      const tableRows = estudiantes.map(est => [
        est.nombre,
        est.sexo,
        ...(specialCorte ? [] : configIndicadores.map(ind => {
          const nota = est.notasIndicadores[ind.id] || 0;
          const label = est.notasCualitativasIndicadores[ind.id] || "";
          if (label === "-" || label === "") return "-";
          if (isQualitative) return label;
          return `${nota}${label ? ` ${label}` : ''}`;
        })),
        (est.notaFinalCualitativa === "-" || est.notaFinalCualitativa === "") 
          ? "-" 
          : (isQualitative 
              ? (est.notaFinalCualitativa || '-') 
              : `${est.notaFinal}${est.notaFinalCualitativa ? ` ${est.notaFinalCualitativa}` : ''}`)
      ]);

      autoTable(doc, {
        startY: yPos + 5,
        margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
        head: [tableHeaders],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index >= 2) {
            const rowIndex = data.row.index;
            const colIndex = data.column.index;
            const estudiante = estudiantes[rowIndex];
            let colorHex = "";
            if (colIndex === tableHeaders.length - 1) {
              colorHex = estudiante.notaFinalCualitativa === "-" ? "#64748b" : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa);
            } else {
              const indicatorIndex = colIndex - 2;
              const indicator = configIndicadores[indicatorIndex];
              if (!indicator.activo) {
                colorHex = "#64748b";
              } else {
                const label = estudiante.notasCualitativasIndicadores[indicator.id] || (isQualitative ? 'AI' : '');
                colorHex = label === "-" ? "#64748b" : getNoteColor(isQualitative ? 0 : (estudiante.notasIndicadores[indicator.id] || 0), label);
              }
            }
            const [r, g, b] = hexToRgb(colorHex);
            data.cell.styles.textColor = [r, g, b];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });

      const finalY = (doc as any).lastAutoTable.finalY + 10;
      const estudiantesConNotas = estudiantes.filter(e => e.notaFinal >= 0);
      let promedioText = "-";
      if (estudiantesConNotas.length > 0) {
        if (isQualitative) {
          promedioText = calcularNotaCualitativaFinal(estudiantesConNotas.map(e => e.notaFinalCualitativa || 'AI'));
        } else {
          const promedio = (estudiantesConNotas.reduce((sum, e) => sum + e.notaFinal, 0) / estudiantesConNotas.length);
          const labelPromedio = getQualitativeLabel(getPorcentajeFinal(promedio, totalPuntajeMaximoConfig));
          promedioText = `${Math.round(promedio)}${labelPromedio ? ` (${labelPromedio})` : ''}`;
        }
      }
      
      doc.setFontSize(11);
      doc.text(`Total Estudiantes: ${estudiantes.length}`, margins.left + 10, finalY);
      doc.text(`Promedio Grupal: ${promedioText}`, doc.internal.pageSize.getWidth() / 2 + 15, finalY);

      // Guardar en directorio temporal para impresión/compartir
      const pdfArrayBuffer = doc.output('arraybuffer');
      const dir = await tempDir();
      const fileName = `reporte_calificaciones_${Date.now()}.pdf`;
      const filePath = await join(dir, fileName);
      
      console.log("Intentando escribir PDF en:", filePath);
      await writeFile(filePath, new Uint8Array(pdfArrayBuffer));
      console.log("PDF escrito exitosamente");
      
      // Formatear path para openUrl si falla
      const formattedPath = filePath.replace(/\\/g, '/');
      const fileUrl = formattedPath.startsWith('/') ? `file://${formattedPath}` : `file:///${formattedPath}`;
      
      const isAndroidLocal = /Android/i.test(navigator.userAgent);

      try {
        if (isAndroidLocal || isMobile) {
            // Intentar compartir en Android (o móvil)
            try {
              if (isAndroidLocal) {
                  await invoke('share_pdf', { path: formattedPath });
                  await emit("show-toast", { message: "✅ Abriendo opciones...", type: 'success' });
              } else {
                  throw new Error("Plataforma móvil no soportada para impresión nativa");
              }
            } catch (shareError) {
              console.error("Error en share_pdf:", shareError);
              await emit("show-toast", { 
                message: "⚠️ Error nativo: " + String(shareError), 
                type: 'error' 
              });
              return; 
            }
        } else {
            // En desktop, intentar imprimir
            await invoke('print_pdf', { path: formattedPath });
            await emit("show-toast", { message: "✅ Enviado a impresora", type: 'success' });
        }
      } catch (error) {
        if (isAndroidLocal) {
            await emit("show-toast", { 
                message: "❌ Error al imprimir en Android: " + String(error), 
                type: 'error' 
            });
            return;
        }
        console.log("No se pudo usar función nativa, abriendo archivo...", error);
        await openUrl(fileUrl);
        await emit("show-toast", { message: "✅ Reporte generado. Abriendo visor de PDF...", type: 'success' });
      }
    } catch (error) {
      console.error("Error al imprimir:", error);
      await emit("show-toast", { 
        message: "❌ Error al imprimir: " + (error instanceof Error ? error.message : String(error)), 
        type: 'error' 
      });
    }
  };

  const exportToExcel = async () => {
    if (estudiantes.length === 0) return;

    try {
      const names = getSelectedNames();
      
      // 1. Preparar el encabezado de información general
      const infoHeader = [
        ["REPORTE DE CALIFICACIONES"],
        ["Colegio:", names.colegio, "", "Año Lectivo:", names.ano],
        ["Grado:", names.grado, "", "Sección:", names.seccion],
        ["Asignatura:", names.asignatura, "", "Corte:", names.corte],
        ["Fecha:", new Date().toLocaleDateString(), "", "Sexo:", selectedSexo === "M" ? "Masculino" : selectedSexo === "F" ? "Femenino" : "Todos"],
        [] // Fila vacía
      ];

      // 2. Preparar los encabezados de la tabla (Nivel 1: Indicadores)
      const headerLevel1 = ["", "", ""]; // N°, Estudiante, Sexo
      if (!specialCorte) {
        configIndicadores.forEach(ind => {
          // El indicador abarca todos sus criterios + su columna de Total
          const span = ind.criterios.length + 1;
          headerLevel1.push(`Indicador ${ind.orden}${ind.activo ? " (Activo)" : ""}`);
          for (let i = 1; i < span; i++) headerLevel1.push("");
        });
      }
      headerLevel1.push("Nota Final");

      // 3. Preparar los encabezados de la tabla (Nivel 2: Criterios y Totales)
      const headerLevel2 = ["N°", "Estudiante", "Sexo"];
      if (!specialCorte) {
        configIndicadores.forEach(ind => {
          ind.criterios.forEach(crit => {
            headerLevel2.push(`Crit. ${crit.orden}`);
          });
          headerLevel2.push(isQualitative ? "Total Cualitativo" : "Total");
        });
      }
      headerLevel2.push(isQualitative ? "Cualitativo" : "Nota Final");

      // 4. Preparar los datos de los estudiantes
      const tableData = estudiantes.map((est, index) => {
        const rowData: any[] = [
          index + 1,
          est.nombre,
          est.sexo
        ];

        if (!specialCorte) {
          configIndicadores.forEach(ind => {
            ind.criterios.forEach(crit => {
              const notaCrit = est.notasCriterios?.[crit.id] || 0;
              if (isQualitative) {
                // Si es cualitativo, mostrar etiqueta (AA, AS, etc.) basándose en el porcentaje del puntaje máximo
                const porcentaje = (notaCrit / (crit.puntajeMaximo || 1)) * 100;
                rowData.push(getQualitativeLabel(porcentaje));
              } else {
                // Si es cuantitativo, mostrar valor numérico
                rowData.push(notaCrit);
              }
            });
            
            // El total del indicador siempre se muestra según el tipo de grado
            const label = est.notasCualitativasIndicadores[ind.id] || (isQualitative ? "AI" : "");
            if (label === "-") {
              rowData.push("-");
            } else if (isQualitative) {
              rowData.push(label);
            } else {
              const nota = est.notasIndicadores[ind.id] || 0;
              rowData.push(`${Math.round(nota)}${label ? ` ${label}` : ''}`);
            }
          });
        }
        
        // Añadir la nota final cualitativa o numérica
        if (est.notaFinalCualitativa === "-") {
          rowData.push("-");
        } else if (isQualitative) {
          rowData.push(est.notaFinalCualitativa || "AI");
        } else {
          rowData.push(`${Math.round(est.notaFinal)}${est.notaFinalCualitativa ? ` ${est.notaFinalCualitativa}` : ''}`);
        }

        return rowData;
      });

      // Crear el libro y la hoja
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([...infoHeader, headerLevel1, headerLevel2, ...tableData]);

      // Configurar merges (combinar celdas) para los indicadores
      const merges: XLSX.Range[] = [];
      // Combinar celdas de información general (REPORTE DE CALIFICACIONES)
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } });

      // Merges para el Nivel 1 de encabezados
      if (!specialCorte) {
        let currentCol = 3;
        configIndicadores.forEach(ind => {
          const span = ind.criterios.length + 1;
          merges.push({ s: { r: 6, c: currentCol }, e: { r: 6, c: currentCol + span - 1 } });
          currentCol += span;
        });
      }

      ws['!merges'] = merges;

      // Configurar anchos de columna
      const wscols = [
        { wch: 5 },  // N°
        { wch: 35 }, // Estudiante
        { wch: 8 },  // Sexo
      ];
      // Anchos para columnas de notas
      for (let i = 3; i < headerLevel2.length; i++) {
        wscols.push({ wch: 12 });
      }
      ws['!cols'] = wscols;

      // Añadir la hoja al libro
      XLSX.utils.book_append_sheet(wb, ws, "Reporte");

      // Diálogo de guardado
      const suggestedName = `Reporte_${names.grado}_${names.seccion}_${names.asignatura}.xlsx`.replace(/\s+/g, '_');

      const filePath = await save({
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        defaultPath: suggestedName
      });

      if (filePath) {
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        await writeFile(filePath, new Uint8Array(excelBuffer));
        
        // Abrir el archivo automáticamente después de guardarlo
        try {
          const formattedPath = filePath.replace(/\\/g, '/');
          const fileUrl = formattedPath.startsWith('/') ? `file://${formattedPath}` : `file:///${formattedPath}`;
          await openUrl(fileUrl);
        } catch (openError) {
          console.warn("No se pudo abrir automáticamente:", openError);
        }
        
        await emit("show-toast", { message: "✅ Excel exportado exitosamente", type: 'success' });
      }

    } catch (error) {
      console.error("Error al exportar a Excel:", error);
      await emit("show-toast", { message: "❌ Error al exportar a Excel: " + error, type: 'error' });
    }
  };

  
  return (
    <div className="page-container">
      <style>
        {`
          @media print {
            /* Forzar esquema de color claro para impresión */
            :root {
              color-scheme: light !important;
            }

            /* Forzar fondo blanco y texto base negro */
            *, *::before, *::after {
              background-color: white !important;
              background-image: none !important;
              color: black; /* Sin !important para permitir colores específicos */
              box-shadow: none !important;
              text-shadow: none !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              position: static !important;
            }

            /* Asegurar que el contenedor principal ocupe todo el espacio y sea blanco */
            html, body, #root, .app-layout, .main-content, .page-container {
              background: white !important;
              background-color: white !important;
              color: black !important;
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              height: auto !important;
              overflow: visible !important;
              display: block !important;
              position: static !important;
            }

            /* Ocultar elementos innecesarios */
            nav, .sidebar, .navbar, .no-print, button, .filters-section, 
            .background-decoration, .resizer, .loading-spinner, 
            .input-container, .sidebar-nav, .sidebar-title, .filters-row,
            .category-card:not(.print-header):not(.table-card),
            .statistics-slide-container {
              display: none !important;
            }

            .table-slide-container {
              display: block !important;
              opacity: 1 !important;
              visibility: visible !important;
            }

            /* Mostrar y dar estilo al encabezado de impresión */
            .print-header {
              display: block !important;
              visibility: visible !important;
              width: 100% !important;
              margin-bottom: 20px !important;
              border-bottom: 2px solid black !important;
              padding-bottom: 10px !important;
              position: relative !important;
            }

            .print-title {
              text-align: center !important;
              font-size: 20pt !important;
              font-weight: bold !important;
              margin-bottom: 10px !important;
              color: black !important;
              display: block !important;
            }

            .print-grid {
              display: grid !important;
              grid-template-columns: 1fr 1fr !important;
              gap: 5px 20px !important;
              font-size: 11pt !important;
              color: black !important;
            }

            /* Estilos específicos para la tabla */
            .category-card.table-card {
              display: block !important;
              background: white !important;
              padding: 0 !important;
              margin: 0 !important;
              border: none !important;
              box-shadow: none !important;
              position: relative !important;
            }

            table {
              display: table !important;
              width: 100% !important;
              border-collapse: collapse !important;
              border: 1px solid black !important;
              margin-top: 10px !important;
              color: black !important;
            }

            thead {
              display: table-header-group !important;
            }

            tr {
              page-break-inside: avoid !important;
            }

            th, td {
              border: 1px solid black !important;
              padding: 6px 4px !important;
              text-align: center !important;
              background-color: white !important;
              position: static !important;
            }

            th {
              background-color: #f2f2f2 !important;
              font-weight: bold !important;
              color: black !important;
            }

            /* Asegurar que el texto del estudiante sea legible */
            td:first-child {
              text-align: left !important;
              padding-left: 10px !important;
              font-weight: 500 !important;
              color: black !important;
            }

            /* Mantener colores de las notas (vienen como estilos inline) */
            td[style*="color"], span[style*="color"] {
              /* No forzamos color: black aquí para que se vean los colores de la UI */
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            /* Resetear paddings y márgenes */
            .main-content {
              padding: 0 !important;
            }

            /* Ocultar scrollbars */
            ::-webkit-scrollbar {
              display: none !important;
            }
          }

          .print-header {
            display: none;
          }

          /* Clases para controlar la visibilidad de los slides sin usar display inline */
          .table-slide-container, .statistics-slide-container {
            display: none;
          }
          .table-slide-container.active, .statistics-slide-container.active {
            display: block;
          }
        `}
      </style>

      {/* Encabezado para Impresión */}
      <div className="print-header">
        <div className="print-title">Reporte de Calificaciones</div>
        <div className="print-grid">
          <div><strong>Colegio:</strong> {selectedNames.colegio}</div>
          <div><strong>Año Lectivo:</strong> {selectedNames.ano}</div>
          <div><strong>Grado:</strong> {selectedNames.grado}</div>
          <div><strong>Sección:</strong> {selectedNames.seccion}</div>
          <div><strong>Asignatura:</strong> {selectedNames.asignatura}</div>
          <div><strong>Corte:</strong> {selectedNames.corte}</div>
          <div><strong>Fecha:</strong> {new Date().toLocaleDateString()}</div>
          <div><strong>Sexo:</strong> {selectedSexo === "M" ? "Masculino" : selectedSexo === "F" ? "Femenino" : "Todos"}</div>
        </div>
      </div>

      {/* Contenedor de Filtros - Siempre Visible */}
      <div className="category-card sticky-filters" style={{ 
          marginBottom: '1rem', 
          padding: '0.8rem',
          position: 'sticky',
          top: 0,
          zIndex: 999,
          background: 'rgba(26, 26, 26, 0.8)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
          borderRadius: '0 0 12px 12px',
          border: '1px solid rgba(255,255,255,0.05)',
          borderTop: 'none'
      }}>
        <div className="filters-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap', gap: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 auto' }}>
            <h3 style={{ margin: 0, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '1.1rem' }}>
              📊 Reportes
            </h3>
            <div style={{ height: '16px', width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.75rem' }} className="hide-mobile">
              Rendimiento
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Indicador de Slide */}
            <div style={{ 
              display: 'flex', 
              background: 'rgba(255,255,255,0.05)', 
              borderRadius: '10px', 
              padding: '2px',
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <button 
                onClick={() => setActiveSlide('tabla')}
                style={{
                  padding: '0.2rem 0.6rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: activeSlide === 'tabla' ? '#3b82f6' : 'transparent',
                  color: activeSlide === 'tabla' ? 'white' : '#94a3b8',
                  fontSize: '0.7rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Tabla
              </button>
              <button 
                onClick={() => setActiveSlide('estadisticas')}
                style={{
                  padding: '0.2rem 0.6rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: activeSlide === 'estadisticas' ? '#3b82f6' : 'transparent',
                  color: activeSlide === 'estadisticas' ? 'white' : '#94a3b8',
                  fontSize: '0.7rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Stats
              </button>
            </div>

            <button 
              className="secondary" 
              onClick={handlePrint}
              disabled={estudiantes.length === 0 || loading}
              style={{ 
                padding: '0.3rem 0.6rem', 
                fontSize: '0.75rem', 
                height: '28px',
                backgroundColor: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title={(isMobile || isAndroid) ? "Compartir PDF" : "Imprimir"}
            >
              {(isMobile || isAndroid) ? "📤" : "🖨️"}
            </button>
            <button 
              className="primary" 
              onClick={exportToExcel}
              disabled={estudiantes.length === 0 || loading}
              style={{ 
                padding: '0.3rem 0.6rem', 
                fontSize: '0.75rem', 
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              Excel
            </button>
            <button 
              className="primary" 
              onClick={exportToPDF}
              disabled={estudiantes.length === 0 || loading}
              style={{ 
                padding: '0.3rem 0.6rem', 
                fontSize: '0.75rem', 
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              PDF
            </button>
            <button 
              className="secondary" 
              onClick={() => setShowPrintOptions(true)}
              style={{ 
                padding: '0.3rem 0.6rem', 
                fontSize: '0.75rem', 
                height: '28px',
                backgroundColor: '#6366f1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Configuración de página"
            >
              ⚙️
            </button>
          </div>
        </div>

        {/* Modal de Configuración de Impresión */}
        {showPrintOptions && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            backdropFilter: 'blur(8px)',
            padding: '20px',
            overflowY: 'auto'
          }}
          onClick={() => setShowPrintOptions(false)}
          >
            <div style={{
              backgroundColor: '#1e293b',
              padding: '2rem',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '360px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ 
                color: 'white', 
                marginBottom: '1.5rem', 
                marginTop: 0, 
                fontSize: '1.25rem',
                fontWeight: '600',
                textAlign: 'center',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                paddingBottom: '1rem'
              }}>
                Configuración de Página
              </h3>
              
              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Tamaño de Página</label>
                <select 
                  value={printConfig.pageSize}
                  onChange={(e) => setPrintConfig({...printConfig, pageSize: e.target.value})}
                  style={{ 
                    width: '100%', 
                    padding: '0.7rem', 
                    borderRadius: '10px', 
                    backgroundColor: '#0f172a', 
                    color: 'white', 
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                >
                  <option value="a4">A4 (Estándar)</option>
                  <option value="letter">Carta (Letter)</option>
                  <option value="legal">Oficio (Legal)</option>
                </select>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Orientación</label>
                <select 
                  value={printConfig.orientation}
                  onChange={(e) => setPrintConfig({...printConfig, orientation: e.target.value})}
                  style={{ 
                    width: '100%', 
                    padding: '0.7rem', 
                    borderRadius: '10px', 
                    backgroundColor: '#0f172a', 
                    color: 'white', 
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                >
                  <option value="portrait">Vertical (Retrato)</option>
                  <option value="landscape">Horizontal (Paisaje)</option>
                </select>
              </div>

              <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '1rem' }}>
                <label style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '0.8rem', fontWeight: '600' }}>Márgenes (mm)</label>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <label style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Arriba</label>
                      <span style={{ color: '#6366f1', fontSize: '0.75rem' }}>{printConfig.margins.top}</span>
                    </div>
                    <input 
                      type="range" min="0" max="50" step="1"
                      value={printConfig.margins.top}
                      onChange={(e) => setPrintConfig({...printConfig, margins: {...printConfig.margins, top: Number(e.target.value)}})}
                      style={{ width: '100%', accentColor: '#6366f1' }}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <label style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Abajo</label>
                      <span style={{ color: '#6366f1', fontSize: '0.75rem' }}>{printConfig.margins.bottom}</span>
                    </div>
                    <input 
                      type="range" min="0" max="50" step="1"
                      value={printConfig.margins.bottom}
                      onChange={(e) => setPrintConfig({...printConfig, margins: {...printConfig.margins, bottom: Number(e.target.value)}})}
                      style={{ width: '100%', accentColor: '#6366f1' }}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <label style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Izquierda</label>
                      <span style={{ color: '#6366f1', fontSize: '0.75rem' }}>{printConfig.margins.left}</span>
                    </div>
                    <input 
                      type="range" min="0" max="50" step="1"
                      value={printConfig.margins.left}
                      onChange={(e) => setPrintConfig({...printConfig, margins: {...printConfig.margins, left: Number(e.target.value)}})}
                      style={{ width: '100%', accentColor: '#6366f1' }}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <label style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Derecha</label>
                      <span style={{ color: '#6366f1', fontSize: '0.75rem' }}>{printConfig.margins.right}</span>
                    </div>
                    <input 
                      type="range" min="0" max="50" step="1"
                      value={printConfig.margins.right}
                      onChange={(e) => setPrintConfig({...printConfig, margins: {...printConfig.margins, right: Number(e.target.value)}})}
                      style={{ width: '100%', accentColor: '#6366f1' }}
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowPrintOptions(false)}
                className="secondary"
                style={{ 
                  width: '100%', 
                  padding: '0.8rem', 
                  borderRadius: '12px',
                  backgroundColor: '#6366f1',
                  color: 'white',
                  fontWeight: '600',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
              >
                Listo
              </button>
            </div>
          </div>
        )}

        {/* Fila de Filtros Compacta */}
        <div className="filters-row" style={{ 
          display: 'flex', 
          flexWrap: 'wrap',
          gap: '0.5rem', 
          padding: '0.5rem',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          alignItems: 'flex-end'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 100px' }}>
            <label className="input-label" style={{ fontSize: '0.7rem', marginBottom: 0 }}>Año</label>
            <select 
              className="filter-select"
              value={selectedAno}
              onChange={(e) => setSelectedAno(Number(e.target.value))}
              style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.8rem', height: '28px' }}
            >
              {anos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 100px' }}>
            <label className="input-label" style={{ fontSize: '0.7rem', marginBottom: 0 }}>Corte</label>
            <select 
              className="filter-select"
              value={specialCorte ? specialCorte : selectedCorte}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "1S" || val === "2S" || val === "NF") {
                  setSpecialCorte(val);
                  setSelectedCorte(0);
                } else {
                  setSpecialCorte("");
                  setSelectedCorte(Number(val));
                }
              }}
              style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.8rem', height: '28px' }}
            >
              <optgroup label="Cortes Individuales">
                {cortes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </optgroup>
              <optgroup label="Promedios">
                <option value="1S">1er Semestre</option>
                <option value="2S">2do Semestre</option>
                <option value="NF">Nota Final</option>
              </optgroup>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 140px' }}>
            <label className="input-label" style={{ fontSize: '0.7rem', marginBottom: 0 }}>Colegio</label>
            <select 
              className="filter-select"
              value={selectedColegio}
              onChange={(e) => setSelectedColegio(Number(e.target.value))}
              style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.8rem', height: '28px' }}
            >
              {colegios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 140px' }}>
            <label className="input-label" style={{ fontSize: '0.7rem', marginBottom: 0 }}>Grado</label>
            <select 
              className="filter-select"
              value={selectedGrado}
              onChange={(e) => setSelectedGrado(Number(e.target.value))}
              style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.8rem', height: '28px' }}
            >
              {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 140px' }}>
            <label className="input-label" style={{ fontSize: '0.7rem', marginBottom: 0 }}>Sección</label>
            <select 
              className="filter-select"
              value={selectedSeccion}
              onChange={(e) => setSelectedSeccion(Number(e.target.value))}
              style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.8rem', height: '28px' }}
            >
              {secciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 90px' }}>
            <label className="input-label" style={{ fontSize: '0.7rem', marginBottom: 0 }}>Sexo</label>
            <select 
              className="filter-select"
              value={selectedSexo}
              onChange={(e) => setSelectedSexo(e.target.value)}
              style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.8rem', height: '28px' }}
            >
              <option value="">Todos</option>
              <option value="M">Masc.</option>
              <option value="F">Fem.</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 140px' }}>
            <label className="input-label" style={{ fontSize: '0.7rem', marginBottom: 0 }}>Asignatura</label>
            <select 
              className="filter-select"
              value={selectedAsignatura}
              onChange={(e) => setSelectedAsignatura(Number(e.target.value))}
              disabled={asignaturas.length === 0}
              style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.8rem', height: '28px' }}
            >
              {asignaturas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>

          {/* Buscador Dinámico */}
          <div className="search-container" style={{ minWidth: '180px', flex: '1', maxWidth: '300px' }}>
            <span className="search-icon-left">🔍</span>
            <input 
              type="text" 
              className="search-input search-input-with-icon" 
              placeholder="Buscar estudiante..." 
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
        </div>
      </div>
      {/* Área de Contenido (Slides) */}
      <div style={{ position: 'relative', flex: 1, minHeight: '400px', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem' }}>
            <div className="loading-spinner" style={{ 
              width: '50px', 
              height: '50px', 
              border: '4px solid rgba(59, 130, 246, 0.1)', 
              borderTop: '4px solid #3b82f6', 
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              marginBottom: '1rem'
            }}></div>
            <p style={{ color: '#94a3b8', fontWeight: 500 }}>Generando reporte...</p>
          </div>
        ) : filteredReporte.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 2rem', border: '2px dashed rgba(255, 255, 255, 0.1)', borderRadius: '16px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{searchTerm ? '🔍' : '📋'}</div>
            <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>
              {searchTerm ? 'No se encontraron resultados' : 'No hay datos para mostrar'}
            </h4>
            <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
              {searchTerm 
                ? `No se encontró ningún estudiante que coincida con "${searchTerm}"`
                : 'Seleccione todos los filtros necesarios para generar el reporte de calificaciones.'}
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
          <>
            {/* Slide de Tabla */}
            <div className={`table-slide-container ${activeSlide === 'tabla' ? 'active' : ''}`} style={{ 
              animation: activeSlide === 'tabla' ? 'fadeIn 0.3s ease-out' : 'none'
            }}>
              <div className="category-card table-card" style={{ padding: '0', overflow: 'hidden' }}>
                <div className="notas-table-container" style={{ 
                  overflowX: 'auto', 
                  width: '100%',
                  borderRadius: '12px', 
                  backgroundColor: 'transparent' 
                }}>
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '1rem', textAlign: 'left', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderBottom: '2px solid rgba(255, 255, 255, 0.1)', color: '#93c5fd', position: 'sticky', left: 0, zIndex: 10 }}>Estudiante</th>
                        <th style={{ padding: '1rem', textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderBottom: '2px solid rgba(255, 255, 255, 0.1)', color: '#94a3b8' }}>Sexo</th>
                        {!specialCorte && configIndicadores.map((ind) => (
                          <th key={ind.id} 
                            title={ind.descripcion} 
                            style={{ 
                              padding: '1rem', 
                              textAlign: 'center', 
                              backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                              borderBottom: '2px solid rgba(255, 255, 255, 0.1)', 
                              color: ind.activo ? '#93c5fd' : '#64748b', 
                              fontSize: '0.85rem',
                              cursor: 'help'
                            }}
                          >
                            Ind. {ind.orden}
                            {!ind.activo && <div style={{ fontSize: '0.7rem', color: '#ef4444' }}>(Inactivo)</div>}
                          </th>
                        ))}
                        <th style={{ padding: '1rem', textAlign: 'center', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderBottom: '2px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa', fontWeight: 'bold' }}>Nota Final</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReporte.map((estudiante, idx) => (
                        <tr key={estudiante.id} className="table-row-hover" style={{ backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.01)' }}>
                          <td style={{ 
                            padding: '0.85rem 1rem', 
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
                            color: '#f1f5f9', 
                            fontWeight: 500, 
                            position: 'sticky', 
                            left: 0, 
                            backgroundColor: idx % 2 === 0 ? '#1e293b' : '#1a2234', 
                            zIndex: 5 
                          }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {estudiante.nombre}
                            </div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', color: '#94a3b8' }}>
                            {estudiante.sexo}
                          </td>
                          {!specialCorte && configIndicadores.map((ind) => {
                            const nota = estudiante.notasIndicadores[ind.id] || 0;
                            const label = estudiante.notasCualitativasIndicadores[ind.id] || (isQualitative ? '' : '');
                            const isMissing = label === "-" || label === "";
                            
                            // Ahora 'nota' ya es un porcentaje (0-100)
                            const noteColor = isMissing ? '#64748b' : getNoteColor(isQualitative ? 0 : nota, label);
                            
                            return (
                              <td key={ind.id} style={{ 
                                padding: '0.85rem 1rem', 
                                textAlign: 'center', 
                                borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
                                color: ind.activo ? noteColor : '#64748b', 
                                opacity: ind.activo ? 1 : 0.6 
                              }}>
                                {isQualitative ? (
                                  <span style={{ fontWeight: isMissing ? 'normal' : 'bold', color: noteColor }}>{isMissing ? "-" : label}</span>
                                ) : (
                                  <span style={{ fontWeight: (ind.activo && !isMissing) ? 'bold' : 'normal', color: ind.activo ? noteColor : '#64748b' }}>
                                    {isMissing ? "-" : `${Math.round(nota)}${label ? ` ${label}` : ''}`}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td style={{ 
                            padding: '0.85rem 1rem', 
                            textAlign: 'center', 
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
                            fontWeight: 'bold', 
                            color: (estudiante.notaFinalCualitativa === "-" || estudiante.notaFinalCualitativa === "") ? "#64748b" : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa),
                            backgroundColor: 'rgba(59, 130, 246, 0.05)' 
                          }}>
                            {isQualitative ? (
                              <span style={{ color: (estudiante.notaFinalCualitativa === "-" || estudiante.notaFinalCualitativa === "") ? "#64748b" : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa) }}>
                                {(!estudiante.notaFinalCualitativa || estudiante.notaFinalCualitativa === "-") ? "-" : estudiante.notaFinalCualitativa}
                              </span>
                            ) : (
                              <span style={{ color: (estudiante.notaFinalCualitativa === "-" || estudiante.notaFinalCualitativa === "") ? "#64748b" : getNoteColor(estudiante.notaFinal, estudiante.notaFinalCualitativa) }}>
                                {(estudiante.notaFinalCualitativa === "-" || estudiante.notaFinalCualitativa === "") ? "-" : (
                                  <>
                                    {Math.round(estudiante.notaFinal)}
                                    {estudiante.notaFinalCualitativa ? ` (${estudiante.notaFinalCualitativa})` : ''}
                                  </>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Slide de Estadísticas */}
            <div className={`statistics-slide-container ${activeSlide === 'estadisticas' ? 'active' : ''}`} style={{ 
                animation: activeSlide === 'estadisticas' ? 'fadeIn 0.3s ease-out' : 'none'
            }}>
              <div className="asistencia-summary" style={{ margin: 0, padding: '0.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <div className="summary-card students">
                  <span className="summary-label">{searchTerm ? 'Resultados' : 'Estudiantes'}</span>
                  <span className="summary-value">{filteredReporte.length}</span>
                  <div className="gender-labels">
                    <span className="gender-m">M: {filteredReporte.filter(e => e.sexo === 'M').length}</span>
                    <span className="gender-f">F: {filteredReporte.filter(e => e.sexo === 'F').length}</span>
                  </div>
                </div>

                <div className="summary-card p">
                  <span className="summary-label">Promedio Grupal</span>
                  <div className="summary-value" style={{ 
                      color: (() => {
                        const conNotas = filteredReporte.filter(e => e.notaFinal >= 0);
                        if (conNotas.length === 0) return '#64748b';
                        
                        const promedio = (conNotas.reduce((sum, e) => sum + e.notaFinal, 0) / conNotas.length);
                        let label = undefined;
                        if (isQualitative) {
                          const labelsFinales = conNotas.map(e => e.notaFinalCualitativa || 'AI');
                          label = calcularNotaCualitativaFinal(labelsFinales);
                        }
                        return getNoteColor(promedio, label);
                      })()
                    }}>
                    {(() => {
                      const conNotas = filteredReporte.filter(e => e.notaFinal >= 0);
                      if (conNotas.length === 0) return '-';
                      
                      const promedio = (conNotas.reduce((sum, e) => sum + e.notaFinal, 0) / conNotas.length);
                      if (isQualitative) {
                        const labelsFinales = conNotas.map(e => e.notaFinalCualitativa || 'AI');
                        return calcularNotaCualitativaFinal(labelsFinales);
                      }
                      const labelPromedio = getQualitativeLabel(promedio);
                      return `${Math.round(promedio)}${labelPromedio ? ` (${labelPromedio})` : ''}`;
                    })()}
                  </div>
                </div>

                <div className="category-card" style={{ padding: '0.8rem', gridColumn: '1 / -1', marginTop: '0.5rem' }}>
                  <h4 style={{ margin: '0 0 0.8rem 0', color: '#93c5fd', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                    ℹ️ Detalle de Indicadores
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.8rem' }}>
                    {configIndicadores.filter(i => i.activo).map(ind => (
                      <div key={ind.id} style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <strong style={{ color: '#60a5fa' }}>Ind. {ind.orden}:</strong> {ind.descripcion || "Sin descripción"}
                      </div>
                    ))}
                    {configIndicadores.filter(i => i.activo).length === 0 && (
                      <p style={{ color: '#64748b', fontStyle: 'italic' }}>No hay indicadores activos configurados.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .table-row-hover:hover {
          background-color: rgba(255, 255, 255, 0.04) !important;
        }
        .filter-select {
          width: 100%;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          padding: 0.6rem;
          border-radius: 8px;
          outline: none;
          cursor: pointer;
        }
        .filter-select:focus {
          border-color: #3b82f6;
        }
        .input-label {
          display: block;
          margin-bottom: 0.5rem;
          font-size: 0.8rem;
          color: #94a3b8;
          font-weight: 600;
        }
      `}</style>

    </div>
  );
}
