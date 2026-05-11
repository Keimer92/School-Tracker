import React, { useState, useEffect, useRef } from "react";
import SearchInput from './SearchInput';
import { FilterContainer, FilterGroup, FilterActions } from './FilterContainer';
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { join, tempDir, documentDir } from "@tauri-apps/api/path";
import { writeFile, mkdir } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getLocalDateISOString } from "../lib/dateUtils";
import "../App.css";

interface CategoryItem {
  id: number;
  nombre: string;
  activo?: boolean;
}

interface AsistenciaReporteItem {
  id: number;
  nombre: string;
  sexo: string;
  fechas: string[]; // "YYYY-MM-DD:ESTADO"
  observaciones: string[]; // "YYYY-MM-DD:OBSERVACION"
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

export function InformePage() {
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

  // Mobile Logic
  const [isMobile, setIsMobile] = useState(false);
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  const isAndroidMobile = isAndroid || (isMobile && !isWindows);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const [periodo, setPeriodo] = useState<"diario" | "semanal" | "mensual">("diario");
  const [fechaBase, setFechaBase] = useState<string>(() => {
    const savedFecha = sessionStorage.getItem("asistencia_selectedFecha_v2");
    return savedFecha || getLocalDateISOString();
  });
  const [mesSeleccionado, setMesSeleccionado] = useState<number>(() => new Date().getMonth() + 1);
  const [anoSeleccionado, setAnoSeleccionado] = useState<number>(() => new Date().getFullYear());
  const [searchTerm, setSearchTerm] = useState("");

  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [fechaFin, setFechaFin] = useState<string>("");

  const [reporte, setReporte] = useState<AsistenciaReporteItem[]>([]);
  const [colegioConfig, setColegioConfig] = useState<ColegioDiasAsistencia | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const fetchingRef = React.useRef(false);
  const refreshQueuedRef = React.useRef(false);

  // Modal de resumen detallado
  const [showSummaryModal, setShowSummaryModal] = useState<{
    show: boolean;
    type: string;
    stats: { total: number; m: number; f: number } | null;
  }>({
    show: false,
    type: "",
    stats: null
  });

  const [selectedStudentDetail, setSelectedStudentDetail] = useState<AsistenciaReporteItem | null>(null);

  const handleCardClick = (type: string, stats: any) => {
    setShowSummaryModal({
      show: true,
      type,
      stats
    });
  };

  const fetchReporte = React.useCallback(async () => {
    if (fetchingRef.current) {
      console.log("[InformePage] Ya hay una carga en curso, encolando actualización...");
      refreshQueuedRef.current = true;
      return;
    }
    
    if (!selectedAno || !selectedColegio || !selectedGrado || !selectedSeccion || !fechaInicio || !fechaFin) {
      console.log("[InformePage] Faltan filtros para cargar el reporte:", { selectedAno, selectedColegio, selectedGrado, selectedSeccion, fechaInicio, fechaFin });
      return;
    }

    fetchingRef.current = true;
    setLoading(true);
    try {
      const data = await invoke<AsistenciaReporteItem[]>("get_asistencia_rango", {
        fechaInicio,
        fechaFin,
        anoLectivoId: Number(selectedAno),
        colegioId: Number(selectedColegio),
        gradoId: Number(selectedGrado),
        seccionId: Number(selectedSeccion),
      });
      setReporte(data);
    } catch (error) {
      console.error("[InformePage] Error fetching attendance report:", error);
      await emit("show-toast", { message: "❌ Error al cargar reporte: " + error, type: "error" });
    } finally {
      setLoading(false);
      fetchingRef.current = false;
      
      // Si se solicitó una actualización mientras cargábamos, ejecutarla ahora
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        fetchReporte();
      }
    }
  }, [selectedAno, selectedColegio, selectedGrado, selectedSeccion, fechaInicio, fechaFin]);

  const fetchCatalogs = async () => {
    try {
      const [anosData, colegiosData] = await Promise.all([
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_colegios"),
      ]);
      setAnos(anosData);
      setColegios(colegiosData);
      
      const activeAno = anosData.find(a => a.activo)?.id || (anosData.length > 0 ? anosData[0].id : 0);
      const activeColegio = colegiosData.find(c => c.activo)?.id || (colegiosData.length > 0 ? colegiosData[0].id : 0);

      // Solo establecer valores iniciales si no se han cargado desde localStorage
      const savedAno = localStorage.getItem("selectedAno");
      const savedColegio = localStorage.getItem("selectedColegio");

      let currentColegioId = 0;
      if (savedAno) {
        setSelectedAno(Number(savedAno));
      } else if (activeAno) {
        setSelectedAno(activeAno);
      }

      if (savedColegio) {
        currentColegioId = Number(savedColegio);
        setSelectedColegio(currentColegioId);
      } else if (activeColegio) {
        currentColegioId = activeColegio;
        setSelectedColegio(currentColegioId);
      }

      if (currentColegioId) {
        fetchColegioConfig(currentColegioId);
      }
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: "❌ Error al cargar catálogos: " + error, type: "error" });
    }
  };

  const fetchGrados = async () => {
    try {
      if (!selectedColegio || !selectedAno) return;
      const gradosData = await invoke<CategoryItem[]>("get_grados_by_colegio", { 
        colegioId: Number(selectedColegio),
        anoLectivoId: Number(selectedAno)
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

  const fetchSecciones = async () => {
    try {
      if (!selectedGrado || !selectedColegio || !selectedAno) return;
      const data: CategoryItem[] = await invoke("get_secciones_by_grado_colegio", { 
        gradoId: Number(selectedGrado),
        colegioId: Number(selectedColegio),
        anoLectivoId: Number(selectedAno)
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

  const fetchColegioConfig = async (colegioId: number) => {
    try {
      const config: ColegioDiasAsistencia = await invoke("get_colegio_dias_asistencia", { colegioId });
      setColegioConfig(config);
    } catch (error) {
      console.error("Error fetching colegio config:", error);
    }
  };

  // Efecto para calcular fechaInicio y fechaFin basado en el periodo
  useEffect(() => {
    const hoy = new Date();
    const base = new Date(fechaBase + "T12:00:00"); // Evitar problemas de zona horaria

    if (periodo === "diario") {
      setFechaInicio(fechaBase);
      setFechaFin(fechaBase);
    } else if (periodo === "semanal") {
      // Calcular el lunes de la semana de la fechaBase
      const day = base.getDay(); // 0 (Dom) a 6 (Sab)
      const diff = base.getDate() - day + (day === 0 ? -6 : 1); // Ajustar a Lunes
      const lunes = new Date(base.setDate(diff));
      const domingo = new Date(lunes);
      domingo.setDate(lunes.getDate() + 6);
      
      setFechaInicio(getLocalDateISOString(lunes));
      setFechaFin(getLocalDateISOString(domingo));
    } else if (periodo === "mensual") {
      // Primer día del mes seleccionado
      const primerDia = new Date(anoSeleccionado, mesSeleccionado - 1, 1);
      setFechaInicio(getLocalDateISOString(primerDia));
      
      // Si el mes seleccionado es el actual, hasta hoy. Si es pasado, hasta el fin de mes.
      if (anoSeleccionado === hoy.getFullYear() && mesSeleccionado === hoy.getMonth() + 1) {
        setFechaFin(getLocalDateISOString(hoy));
      } else {
        const ultimoDia = new Date(anoSeleccionado, mesSeleccionado, 0);
        setFechaFin(getLocalDateISOString(ultimoDia));
      }
    }
  }, [periodo, fechaBase, mesSeleccionado, anoSeleccionado]);

  // Cargar catálogos iniciales
  useEffect(() => {
    fetchCatalogs();
  }, []);

  // Escuchar cambios en la asistencia, estudiantes y catálogos para refrescar el reporte
  useEffect(() => {
    const unlistenAsistencia = listen("asistencia-updated", () => {
      console.log("🔔 Evento 'asistencia-updated' recibido. Refrescando reporte...");
      fetchReporte();
    });

    const unlistenEstudiantes = listen("student-updated", () => {
      console.log("🔔 Evento 'student-updated' recibido en InformePage. Refrescando reporte...");
      fetchReporte();
    });

    const unlistenCatalog = listen("catalog-updated", () => {
      console.log("🔔 Evento 'catalog-updated' recibido en InformePage. Refrescando catálogos...");
      fetchCatalogs();
      setRefreshTrigger(prev => prev + 1);
    });

    return () => {
      unlistenAsistencia.then(f => f());
      unlistenEstudiantes.then(f => f());
      unlistenCatalog.then(f => f());
    };
  }, [fetchReporte]);

  // Cargar grados cuando cambie el colegio o el año
  useEffect(() => {
    if (selectedColegio && selectedAno) {
      fetchGrados();
    }
  }, [selectedColegio, selectedAno, refreshTrigger]);

  // Cargar secciones cuando cambie el grado o el colegio o el año
  useEffect(() => {
    if (selectedGrado && selectedColegio && selectedAno) {
      fetchSecciones();
    }
  }, [selectedGrado, selectedColegio, selectedAno, refreshTrigger]);

  // Cargar reporte cuando cambien los filtros
  useEffect(() => {
    // Guardar filtros en localStorage para persistencia entre páginas
    if (selectedAno) localStorage.setItem("selectedAno", selectedAno.toString());
    if (selectedColegio) localStorage.setItem("selectedColegio", selectedColegio.toString());
    if (selectedGrado) localStorage.setItem("selectedGrado", selectedGrado.toString());
    if (selectedSeccion) localStorage.setItem("selectedSeccion", selectedSeccion.toString());
    if (selectedSexo !== undefined) localStorage.setItem("selectedSexo", selectedSexo);
    if (fechaBase) sessionStorage.setItem("asistencia_selectedFecha_v2", fechaBase);

    // Debounce para evitar múltiples llamadas mientras se cargan los catálogos en cadena
    const timeoutId = setTimeout(() => {
      if (selectedAno && selectedColegio && selectedGrado && selectedSeccion && fechaInicio && fechaFin) {
        console.log("Todos los filtros validados, llamando a fetchReporte");
        fetchReporte();
      } else {
        console.log("Filtros incompletos en useEffect, esperando...", { selectedAno, selectedColegio, selectedGrado, selectedSeccion });
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [selectedAno, selectedColegio, selectedGrado, selectedSeccion, fechaInicio, fechaFin, fetchReporte, selectedSexo]);

  // Obtener lista de fechas únicas en el rango considerando los días lectivos del colegio
  const getFechasUnicas = () => {
    const fechasSet = new Set<string>();
    
    // Si tenemos configuración del colegio, generamos las fechas del rango
    if (colegioConfig && (periodo === "semanal" || periodo === "mensual")) {
      const inicio = new Date(fechaInicio + "T12:00:00");
      const fin = new Date(fechaFin + "T12:00:00");
      const temp = new Date(inicio);
      
      const diasLectivosMap = {
        0: colegioConfig.domingo,
        1: colegioConfig.lunes,
        2: colegioConfig.martes,
        3: colegioConfig.miercoles,
        4: colegioConfig.jueves,
        5: colegioConfig.viernes,
        6: colegioConfig.sabado
      };
      
      while (temp <= fin) {
        const dayOfWeek = temp.getDay();
        if (diasLectivosMap[dayOfWeek as keyof typeof diasLectivosMap]) {
          fechasSet.add(getLocalDateISOString(temp));
        }
        temp.setDate(temp.getDate() + 1);
      }
    } else {
      // Comportamiento original si no hay config o es diario
      reporte.forEach(item => {
        item.fechas.forEach(f => {
          const [fecha] = f.split(':');
          fechasSet.add(fecha);
        });
      });
      // Si es diario y no hay datos, igual mostrar la fecha base
      if (periodo === "diario" && fechasSet.size === 0) {
        fechasSet.add(fechaBase);
      }
    }
    
    return Array.from(fechasSet).sort();
  };

  const fechasColumnas = getFechasUnicas();

  const reporteFiltrado = React.useMemo(() => {
    let filtrado = reporte;
    if (selectedSexo) {
      filtrado = filtrado.filter(item => item.sexo === selectedSexo);
    }
    if (searchTerm) {
      filtrado = filtrado.filter(item => item.nombre.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return filtrado;
  }, [reporte, selectedSexo, searchTerm]);

  const getEstadoEnFecha = (item: AsistenciaReporteItem, fecha: string) => {
    const found = item.fechas.find(f => f.startsWith(fecha));
    if (!found) return "-";
    return found.split(':')[1];
  };

  const getObservacionEnFecha = (item: AsistenciaReporteItem, fecha: string) => {
    const found = item.observaciones?.find(f => f.startsWith(fecha));
    if (!found) return "";
    return found.split(':').slice(1).join(':');
  };

  const getEstadoColor = (estado: string) => {
    switch (estado) {
      case 'P': return '#10b981'; // Verde para Presente (Coherente con el programa)
      case 'A': return '#ef4444'; // Rojo para Ausente (Coherente con el programa)
      case 'J': return '#9b59b6'; // Púrpura para Justificado (Coherente con el programa)
      default: return 'transparent';
    }
  };

  const exportToPDF = async () => {
    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'letter'
      });
      const margins = { top: 10, bottom: 10, left: 10, right: 10 };
      const colegioNombre = colegios.find(c => c.id === selectedColegio)?.nombre || "";
      const gradoNombre = grados.find(g => g.id === selectedGrado)?.nombre || "";
      const seccionNombre = secciones.find(s => s.id === selectedSeccion)?.nombre || "";

      doc.setFontSize(16);
      doc.text("Reporte", margins.left + 4, 15);
      doc.setFontSize(10);
      doc.text(`Colegio: ${colegioNombre}`, margins.left + 4, 22);
      doc.text(`Grado: ${gradoNombre} - Sección: ${seccionNombre}`, margins.left + 4, 27);
      doc.text(`Periodo: ${periodo.toUpperCase()} (${fechaInicio} al ${fechaFin})`, margins.left + 4, 32);
      if (selectedSexo) {
        doc.text(`Filtro Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}`, margins.left + 4, 37);
      }

      let headers: string[] = [];
      let body: any[][] = [];

      if (periodo === "diario") {
        headers = ["Estudiante", "Sexo", "Estado", "Observación"];
        body = reporteFiltrado.map(est => {
          const estado = getEstadoEnFecha(est, fechaInicio);
          const obs = getObservacionEnFecha(est, fechaInicio);
          return [
            est.nombre,
            est.sexo,
            estado === '-' ? 'Sin registro' : estado,
            obs
          ];
        });
      } else {
        const fechasCols = getFechasUnicas();
        headers = ["Estudiante", "Sexo", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"];
        body = reporteFiltrado.map(est => {
          const p = est.fechas.filter(f => f.endsWith(':P')).length;
          const a = est.fechas.filter(f => f.endsWith(':A')).length;
          const j = est.fechas.filter(f => f.endsWith(':J')).length;
          return [
            est.nombre,
            est.sexo,
            ...fechasCols.map(f => getEstadoEnFecha(est, f)),
            p, a, j
          ];
        });
      }

      autoTable(doc, {
        startY: selectedSexo ? 42 : 37,
        margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
        head: [headers],
        body: body,
        styles: { fontSize: 8, cellPadding: 1 },
        headStyles: { fillColor: [16, 185, 129] },
        didParseCell: (data) => {
          if (data.section === 'body') {
            const val = String(data.cell.raw);
            if (val === 'P') data.cell.styles.textColor = [16, 185, 129];
            if (val === 'A') data.cell.styles.textColor = [239, 68, 68];
            if (val === 'J') data.cell.styles.textColor = [155, 89, 182];
          }
        }
      });

const pdfData = doc.output('arraybuffer');
      const fileName = `Asistencia_${gradoNombre}_${seccionNombre}_${fechaInicio}.pdf`;
      const docsPath = await documentDir();
      const folderName = "SchoolTrackerPro";
      const separator = isAndroid ? '/' : '\\';
      const fullFolderPath = docsPath + separator + folderName;
      const fullFilePath = fullFolderPath + separator + fileName;

      await mkdir(fullFolderPath, { recursive: true }).catch(e => console.log("mkdir:", e));
      await writeFile(fullFilePath, new Uint8Array(pdfData));

      const formattedPath = fullFilePath.replace(/\\/g, '/');

      if (isAndroid) {
        // En Android, usar share para abrir el PDF con otra app
        try {
          await invoke('share_pdf', { path: formattedPath });
          await emit("show-toast", { message: "✅ PDF guardado. Abriendo...", type: 'success' });
        } catch (shareError) {
          console.error("Error en share_pdf:", shareError);
          // Fallback: intentar guardar en Downloads
          try {
            await invoke('save_file_android', { 
              path: formattedPath, 
              mime: "application/pdf", 
              name: fileName 
            });
            await emit("show-toast", { message: "✅ PDF guardado en descargas", type: 'success' });
          } catch (saveError) {
            await emit("show-toast", { message: "✅ PDF guardado en Documents/SchoolTrackerPro", type: 'success' });
          }
        }
      } else {
        // En desktop, abrir la carpeta
        const folderUrl = "file:///" + fullFolderPath.replace(/\\/g, "/");
        await openUrl(folderUrl);
        await emit("show-toast", { message: "✅ PDF guardado en Documents/SchoolTrackerPro", type: 'success' });
      }
    } catch (error) {
      console.error("Error al exportar PDF:", error);
      await emit("show-toast", { 
        message: "❌ Error al generar el PDF: " + (error instanceof Error ? error.message : String(error)), 
        type: 'error' 
      });
    }
  };

  const handlePrintWithIframe = async () => {
    if (reporteFiltrado.length === 0) {
      await emit("show-toast", { message: "⚠️ No hay datos para imprimir", type: 'warning' });
      return;
    }
    
    try {
      await emit("show-toast", { message: "✅ Preparando reporte...", type: 'success' });
      
      const headers = ["Estudiante", "Sexo", "Estado", "Observación"];
      
      const rows = reporteFiltrado.map(est => {
        const estado = getEstadoEnFecha(est, fechaInicio);
        const obs = getObservacionEnFecha(est, fechaInicio);
        const estadoClass = estado === 'P' ? 'estado-P' : estado === 'A' ? 'estado-A' : estado === 'J' ? 'estado-J' : '';
        return `<tr>
          <td>${est.nombre}</td>
          <td>${est.sexo}</td>
          <td class="${estadoClass}">${estado === '-' ? '' : estado}</td>
          <td>${obs}</td>
        </tr>`;
      }).join('');
      
      const htmlContent = `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h2 { margin: 0 0 10px 0; }
            .info { margin-bottom: 15px; font-size: 12px; }
            table { border-collapse: collapse; width: 100%; font-size: 11px; }
            th, td { border: 1px solid #ddd; padding: 6px; text-align: center; }
            th { background-color: #10b981; color: white; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            .estado-P { color: #10b981; font-weight: bold; }
            .estado-A { color: #ef4444; font-weight: bold; }
            .estado-J { color: #9b59b6; font-weight: bold; }
            @media print {
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
              th { background-color: #10b981 !important; }
              tr:nth-child(even) { background-color: #f9f9f9 !important; }
              .estado-P { color: #10b981 !important; }
              .estado-A { color: #ef4444 !important; }
              .estado-J { color: #9b59b6 !important; }
            }
          </style>
        </head>
        <body>
          <h2>Reporte de Asistencia</h2>
          <div class="info">
            <p><strong>Colegio:</strong> ${colegioNombre}</p>
            <p><strong>Grado:</strong> ${gradoNombre} - Sección: ${seccionNombre}</p>
            <p><strong>Período:</strong> ${periodo.toUpperCase()} (${fechaInicio} al ${fechaFin})${selectedSexo ? ` - Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}` : ''}</p>
          </div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
        </html>`;
      
      setPrintHtml(htmlContent);
    } catch (error) {
      console.error("Error generando reporte:", error);
      await emit("show-toast", { message: "❌ Error al generar el reporte", type: 'error' });
    }
  };

  const handlePrint = async () => {
    if (reporteFiltrado.length === 0) {
      await emit("show-toast", { message: "⚠️ No hay datos para imprimir", type: 'warning' });
      return;
    }
    
    try {
      await emit("show-toast", { message: "✅ Preparando impresión...", type: 'success' });
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'letter'
      });
      const margins = { top: 10, bottom: 10, left: 10, right: 10 };
      const colegioNombre = colegios.find(c => c.id === selectedColegio)?.nombre || "";
      const gradoNombre = grados.find(g => g.id === selectedGrado)?.nombre || "";
      const seccionNombre = secciones.find(s => s.id === selectedSeccion)?.nombre || "";

      doc.setFontSize(16);
      doc.text("Reporte", margins.left + 4, 15);
      doc.setFontSize(10);
      doc.text(`Colegio: ${colegioNombre}`, margins.left + 4, 22);
      doc.text(`Grado: ${gradoNombre} - Sección: ${seccionNombre}`, margins.left + 4, 27);
      doc.text(`Periodo: ${periodo.toUpperCase()} (${fechaInicio} al ${fechaFin})`, margins.left + 4, 32);
      if (selectedSexo) {
        doc.text(`Filtro Sexo: ${selectedSexo === 'M' ? 'Masculino' : 'Femenino'}`, margins.left + 4, 37);
      }

      let headers: string[] = [];
      let body: any[][] = [];

      if (periodo === "diario") {
        headers = ["Estudiante", "Sexo", "Estado", "Observación"];
        body = reporteFiltrado.map(est => {
          const estado = getEstadoEnFecha(est, fechaInicio);
          const obs = getObservacionEnFecha(est, fechaInicio);
          return [
            est.nombre,
            est.sexo,
            estado === '-' ? 'Sin registro' : estado,
            obs
          ];
        });
      } else {
        const fechasCols = getFechasUnicas();
        headers = ["Estudiante", "Sexo", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"];
        body = reporteFiltrado.map(est => {
          const p = est.fechas.filter(f => f.endsWith(':P')).length;
          const a = est.fechas.filter(f => f.endsWith(':A')).length;
          const j = est.fechas.filter(f => f.endsWith(':J')).length;
          return [
            est.nombre,
            est.sexo,
            ...fechasCols.map(f => getEstadoEnFecha(est, f)),
            p, a, j
          ];
        });
      }

      autoTable(doc, {
        startY: selectedSexo ? 42 : 37,
        margin: { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right },
        head: [headers],
        body: body,
        styles: { fontSize: 8, cellPadding: 1 },
        headStyles: { fillColor: [16, 185, 129] },
        didParseCell: (data) => {
          if (data.section === 'body') {
            const val = String(data.cell.raw);
            if (val === 'P') data.cell.styles.textColor = [16, 185, 129];
            if (val === 'A') data.cell.styles.textColor = [239, 68, 68];
            if (val === 'J') data.cell.styles.textColor = [155, 89, 182];
          }
        }
      });

      // Guardar en directorio temporal para impresión
      const pdfArrayBuffer = doc.output('arraybuffer');
      const dir = await tempDir();
      const fileName = `reporte_asistencia_${Date.now()}.pdf`;
      const filePath = await join(dir, fileName);
      
      console.log("Intentando escribir PDF en:", filePath);
      await writeFile(filePath, new Uint8Array(pdfArrayBuffer));
      console.log("PDF escrito exitosamente");
      
      // Formatear path para openUrl si falla
      const formattedPath = filePath.replace(/\\/g, '/');
const fileUrl = formattedPath.startsWith('/') ? `file://${formattedPath}` : `file:///${formattedPath}`;

try {
        if (isAndroid || isMobile) {
            // Intentar compartir en Android (o móvil)
            try {
              if (isAndroid) {
                  await invoke('share_pdf', { path: formattedPath });
                  await emit("show-toast", { message: "✅ Abriendo opciones...", type: 'success' });
              } else {
                  // Fallback para otros móviles (iOS no soportado aún en nativo)
                  throw new Error("Plataforma móvil no soportada para impresión nativa");
              }
            } catch (shareError) {
              console.error("Error en share_pdf:", shareError);
              await emit("show-toast", { 
                message: "⚠️ Error nativo: " + String(shareError), 
                type: 'error' 
              });
              // NO llamar a openUrl en Android para evitar el crash
              return; 
            }
        } else {
            // En desktop, intentar imprimir
            await invoke('print_pdf', { path: formattedPath });
            await emit("show-toast", { message: "✅ Enviado a impresora", type: 'success' });
        }
      } catch (error) {
        if (isAndroid) {
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

  const colegioNombre = colegios.find(c => c.id === selectedColegio)?.nombre || "";
  const gradoNombre = grados.find(g => g.id === selectedGrado)?.nombre || "";
  const seccionNombre = secciones.find(s => s.id === selectedSeccion)?.nombre || "";

  // Cálculos dinámicos de totales
  const statsTotal = React.useMemo(() => {
    return {
      total: reporteFiltrado.length,
      m: reporteFiltrado.filter(e => e.sexo === 'M').length,
      f: reporteFiltrado.filter(e => e.sexo === 'F').length
    };
  }, [reporteFiltrado]);

  const getAsistenciaStats = React.useCallback((estado: string) => {
    let countM = 0;
    let countF = 0;
    
    reporteFiltrado.forEach(est => {
      const pCount = est.fechas.filter(f => f.endsWith(`:${estado}`)).length;
      if (est.sexo === 'M') countM += pCount;
      if (est.sexo === 'F') countF += pCount;
    });

    return { total: countM + countF, m: countM, f: countF };
  }, [reporteFiltrado]);

  const statsP = getAsistenciaStats('P');
  const statsA = getAsistenciaStats('A');
  const statsJ = getAsistenciaStats('J');

  return (
    <div className="page-container">
      <style>{`
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

          @media (max-width: 600px) {
            .asistencia-summary {
              grid-template-columns: repeat(2, 1fr);
            }
          }
          .asistencia-opt {
            width: 28px !important;
            height: 28px !important;
            font-size: 0.75rem !important;
          }
          .asistencia-options {
            gap: 3px !important;
          }
        `}
      </style>
      <div className="category-grid" style={{ display: 'block' }}>
        <FilterContainer isMobile={isMobile} style={{ padding: '0.4rem' }}>
          {/* Período */}
          <FilterGroup label="Período:" isMobile={isMobile} flex={isMobile ? '1 1 100%' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={periodo} 
              onChange={(e) => setPeriodo(e.target.value as any)}
            >
              <option value="diario">Diario</option>
              <option value="semanal">Semanal</option>
              <option value="mensual">Mensual</option>
            </select>
          </FilterGroup>

          {/* Fecha / Semana / Mes-Año */}
          {periodo !== "mensual" ? (
            <FilterGroup label={periodo === "diario" ? "Fecha:" : "Semana de:"} isMobile={isMobile} flex={isMobile ? '1 1 100%' : '0 0 auto'}>
              <input 
                type="date" 
                className="filter-select"
                style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
                value={fechaBase} 
                onChange={(e) => setFechaBase(e.target.value)} 
              />
            </FilterGroup>
          ) : (
            <>
              <FilterGroup label="Mes:" isMobile={isMobile} flex={isMobile ? '1 1 50%' : '0 0 auto'}>
                <select 
                  className="filter-select"
                  style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
                  value={mesSeleccionado} 
                  onChange={(e) => setMesSeleccionado(Number(e.target.value))}
                >
                  <option value={1}>Enero</option>
                  <option value={2}>Febrero</option>
                  <option value={3}>Marzo</option>
                  <option value={4}>Abril</option>
                  <option value={5}>Mayo</option>
                  <option value={6}>Junio</option>
                  <option value={7}>Julio</option>
                  <option value={8}>Agosto</option>
                  <option value={9}>Septiembre</option>
                  <option value={10}>Octubre</option>
                  <option value={11}>Noviembre</option>
                  <option value={12}>Diciembre</option>
                </select>
              </FilterGroup>
              <FilterGroup label="Año:" isMobile={isMobile} flex={isMobile ? '1 1 50%' : '0 0 auto'}>
                <select 
                  className="filter-select"
                  style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
                  value={anoSeleccionado} 
                  onChange={(e) => setAnoSeleccionado(Number(e.target.value))}
                >
                  {[...Array(5)].map((_, i) => {
                    const year = new Date().getFullYear() - 2 + i;
                    return <option key={year} value={year}>{year}</option>;
                  })}
                </select>
              </FilterGroup>
            </>
          )}

          {/* Año Lectivo */}
          <FilterGroup label="Año Lectivo:" isMobile={isMobile} flex={isMobile ? '1 1 50%' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedAno} 
              onChange={(e) => setSelectedAno(Number(e.target.value))}
            >
              {anos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </FilterGroup>

          {/* Colegio */}
          <FilterGroup label="Colegio:" isMobile={isMobile} flex={isMobile ? '1 1 100%' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedColegio} 
              onChange={(e) => setSelectedColegio(Number(e.target.value))}
            >
              {colegios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </FilterGroup>

          {/* Grado */}
          <FilterGroup label="Grado:" isMobile={isMobile} flex={isMobile ? '1 1 50%' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedGrado} 
              onChange={(e) => setSelectedGrado(Number(e.target.value))}
            >
              {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </FilterGroup>

          {/* Sección */}
          <FilterGroup label="Sección:" isMobile={isMobile} flex={isMobile ? '1 1 50%' : '0 0 auto'}>
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
          <FilterGroup label="Sexo:" isMobile={isMobile} flex={isMobile ? '1 1 50%' : '0 0 auto'}>
            <select 
              className="filter-select"
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px', width: '100%' }}
              value={selectedSexo} 
              onChange={(e) => setSelectedSexo(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </FilterGroup>

          {/* Buscador */}
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Buscar..." isMobile={isMobile} />

          {/* Botones de Acción */}
          <FilterActions>
            {/* Solo mostrar botón imprimir en desktop (no Android) */}
            {!isAndroid && (
              <button 
                className="secondary" 
                onClick={handlePrintWithIframe} 
                disabled={reporteFiltrado.length === 0 || loading}
                style={{ 
                  padding: '0.3rem 0.6rem', 
                  fontSize: '0.75rem', 
                  height: '28px',
                  backgroundColor: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={isMobile ? "Compartir reporte" : "Imprimir reporte"}
              >
                {isMobile ? "📤" : "🖨️"}
              </button>
            )}
            <button 
              className="secondary" 
              onClick={exportToPDF} 
              disabled={reporteFiltrado.length === 0 || loading}
              style={{ 
                padding: '0.3rem 0.6rem', 
                fontSize: '0.75rem', 
                height: '28px',
                backgroundColor: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Exportar a PDF"
            >
              📄 PDF
            </button>
          </FilterActions>
        </FilterContainer>
          
          {/* Encabezado de impresión - Oculto en UI normal */}
<div style={{ display: 'none' }} className="print-header">
  <div className="print-title">Reporte de Asistencia</div>
  <div className="print-grid">
    <div><strong>Colegio:</strong> {colegioNombre}</div>
    <div><strong>Grado:</strong> {gradoNombre}</div>
    <div><strong>Sección:</strong> {seccionNombre}</div>
    <div><strong>Período:</strong> {periodo}</div>
    <div><strong>Fecha:</strong> {fechaInicio} al {fechaFin}</div>
  </div>
</div>

{isMobile && reporteFiltrado.length > 0 && (
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
                       <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsTotal.f}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                       <span style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '0.8rem' }}>M:</span>
                       <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsTotal.m}</span>
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
                      onClick={() => handleCardClick('Total', statsTotal)}
                      style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}
                    >
                      <span style={{ color: '#06b6d4', fontWeight: 'bold', fontSize: '0.8rem' }}>E:</span>
                      <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsTotal.total}</span>
                    </div>

                    <div 
                      className="summary-item-mobile"
                      onClick={() => handleCardClick('Presentes', statsP)}
                      style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}
                    >
                      <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.8rem' }}>P:</span>
                      <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsP.total}</span>
                    </div>

                    <div 
                      className="summary-item-mobile"
                      onClick={() => handleCardClick('Ausentes', statsA)}
                      style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}
                    >
                      <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.8rem' }}>A:</span>
                      <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsA.total}</span>
                    </div>

                    <div 
                      className="summary-item-mobile"
                      onClick={() => handleCardClick('Justificados', statsJ)}
                      style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}
                    >
                      <span style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '0.8rem' }}>J:</span>
                      <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.9rem' }}>{statsJ.total}</span>
                    </div>
</div>
</div>
)}



      {/* Tabla de Resultados o Estado Vacío */}
      <div className="table-container" style={{
          width: '100%',
          padding: '0', 
          overflowX: 'hidden', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center' 
        }}>
          {/* Tarjetas de Resumen */}
          {!isMobile && reporteFiltrado.length > 0 && (
            <div className="asistencia-summary" style={{ margin: '0.5rem 0', padding: '0 0.4rem', width: '100%', maxWidth: '100%' }}>
              <div 
                className="summary-card students"
                onClick={() => handleCardClick('Total', statsTotal)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold', fontSize: '0.95rem' }}>
                  <span><span style={{ color: '#06b6d4' }}>E</span>: {statsTotal.total}</span>
                  <span className="gender-m" style={{ marginLeft: '2px' }}>M: {statsTotal.m}</span>
                  <span className="gender-f" style={{ marginLeft: '2px' }}>F: {statsTotal.f}</span>
                </div>
              </div>

              <div 
                className="summary-card p"
                onClick={() => handleCardClick('Presentes', statsP)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold', fontSize: '0.95rem' }}>
                  <span><span style={{ color: '#10b981' }}>P</span>: {statsP.total}</span>
                  <span className="gender-m" style={{ marginLeft: '2px' }}>M: {statsP.m}</span>
                  <span className="gender-f" style={{ marginLeft: '2px' }}>F: {statsP.f}</span>
                </div>
              </div>

              <div 
                className="summary-card a"
                onClick={() => handleCardClick('Ausentes', statsA)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold', fontSize: '0.95rem' }}>
                  <span><span style={{ color: '#ef4444' }}>A</span>: {statsA.total}</span>
                  <span className="gender-m" style={{ marginLeft: '2px' }}>M: {statsA.m}</span>
                  <span className="gender-f" style={{ marginLeft: '2px' }}>F: {statsA.f}</span>
                </div>
              </div>

              <div 
                className="summary-card j"
                onClick={() => handleCardClick('Justificados', statsJ)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 'bold', fontSize: '0.95rem' }}>
                  <span><span style={{ color: '#f59e0b' }}>J</span>: {statsJ.total}</span>
                  <span className="gender-m" style={{ marginLeft: '2px' }}>M: {statsJ.m}</span>
                  <span className="gender-f" style={{ marginLeft: '2px' }}>F: {statsJ.f}</span>
                </div>
              </div>
            </div>
          )}

          <div style={{ width: '100%', overflowX: 'auto' }}>
          {loading ? (
            <div className="loading-container">Cargando reporte...</div>
          ) : reporteFiltrado.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '5rem 2rem', border: '2px dashed rgba(255, 255, 255, 0.1)', borderRadius: '16px', margin: '0 1rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{searchTerm ? '🔍' : '📋'}</div>
              <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>
                {searchTerm ? 'No se encontraron resultados' : 'No hay datos para mostrar'}
              </h4>
              <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
                {searchTerm 
                  ? `No se encontró ningún estudiante que coincida con "${searchTerm}"`
                  : 'No se encontraron registros de asistencia para los filtros seleccionados (Año, Colegio, Grado, Sección, Rango de fechas).'}
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
          ) : periodo === "diario" ? (
            /* Vista simplificada para modo Diario (similar a AsistenciaPage) */
            <table className="custom-table" style={{ margin: '0.5rem auto 1.5rem auto', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '30px' }}>#</th>
                  <th style={{ textAlign: 'left' }}>Estudiante</th>
                  <th style={{ width: '100px' }}>Asistencia</th>
                  <th style={{ width: '40px' }}>Obs</th>
                </tr>
              </thead>
              <tbody>
                {reporteFiltrado.map((item, index) => {
                  const estado = getEstadoEnFecha(item, fechaInicio);
                  return (
                    <tr key={item.id}>
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
                          onClick={() => setSelectedStudentDetail(item)}
                        >
                          <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{item.sexo === 'F' ? '👩' : '👨'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nombre}</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: '22px' }}>{item.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                      </td>
                      <td>
                        <div className="asistencia-options-mobile">
                          <label className={`asistencia-opt ${estado === 'P' ? 'active p' : ''}`}>
                            <span>P</span>
                          </label>
                          <label className={`asistencia-opt ${estado === 'A' ? 'active a' : ''}`}>
                            <span>A</span>
                          </label>
                          <label className={`asistencia-opt ${estado === 'J' ? 'active j' : ''}`}>
                            <span>J</span>
                          </label>
                        </div>
                      </td>
                      <td style={{ color: '#94a3b8', fontSize: '0.8rem', fontStyle: 'italic', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={getObservacionEnFecha(item, fechaInicio)}>
                        {getObservacionEnFecha(item, fechaInicio) || (estado === '-' ? "Sin registro" : "")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            /* Vista de rango para Semanal/Mensual */
            <table className="custom-table" style={{ margin: '0.5rem auto 1.5rem auto' }}>
              <thead>
                <tr>
                  <th style={{ width: '30px' }}>#</th>
                  <th style={{ textAlign: 'left' }}>Estudiante</th>
                  {fechasColumnas.map(f => (
                    <th key={f} style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: '0.6rem', opacity: 0.7 }}>
                        {new Date(f + "T12:00:00").toLocaleDateString('es-ES', { weekday: 'short' })}
                      </div>
                      {f.split('-').slice(1).reverse().join('/')}
                    </th>
                  ))}
                  <th style={{ width: '30px' }}>P</th>
                  <th style={{ width: '30px' }}>A</th>
                  <th style={{ width: '30px' }}>J</th>
                </tr>
              </thead>
              <tbody>
                {reporteFiltrado.map((item, index) => {
                  const p = item.fechas.filter(f => f.endsWith(':P')).length;
                  const a = item.fechas.filter(f => f.endsWith(':A')).length;
                  const j = item.fechas.filter(f => f.endsWith(':J')).length;
                  
                  return (
                    <tr key={item.id}>
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
                          onClick={() => setSelectedStudentDetail(item)}
                        >
                          <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{item.sexo === 'F' ? '👩' : '👨'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nombre}</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: '22px' }}>{item.sexo === 'F' ? 'Femenino' : 'Masculino'}</div>
                      </td>
                      {fechasColumnas.map(f => {
                        const estado = getEstadoEnFecha(item, f);
                        return (
                          <td key={f} style={{ 
                            color: getEstadoColor(estado), 
                            fontWeight: 'bold',
                            fontSize: '0.8rem'
                          }}>
                            <span style={{
                              display: 'inline-block',
                              width: '24px',
                              height: '24px',
                              lineHeight: '24px',
                              borderRadius: '4px',
                              backgroundColor: getEstadoColor(estado),
                              color: estado === '-' ? 'rgba(255,255,255,0.2)' : 'white',
                              fontSize: '0.8rem',
                              fontWeight: 'bold'
                            }}>
                              {estado}
                            </span>
                          </td>
                        );
                      })}
                      <td style={{ color: '#4caf50', fontWeight: 'bold' }}>{p}</td>
                      <td style={{ color: '#f44336', fontWeight: 'bold' }}>{a}</td>
                      <td style={{ color: '#ff9800', fontWeight: 'bold' }}>{j}</td>
                    </tr>
                  );
                })}
              </tbody>
</table>
      )}
    </div>
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

        {/* Modal de Vista Previa de Impresión */}
        {printHtml && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '20px'
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '900px',
              height: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '15px 20px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#f8fafc'
              }}>
                <span style={{ fontSize: '16px', fontWeight: '600', color: '#1e293b' }}>Vista Previa de Impresión</span>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    onClick={() => {
                      const iframe = document.querySelector('iframe');
                      if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.print();
                      }
                    }}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: '500'
                    }}
                  >
                    🖨️ Imprimir
                  </button>
                  <button 
                    onClick={() => setPrintHtml(null)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#64748b',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: '500'
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              <iframe 
                srcDoc={printHtml}
                style={{
                  flex: 1,
                  width: '100%',
                  border: 'none'
                }}
                title="Print Preview"
              />
            </div>
          </div>
        )}
</div>
  );
}
