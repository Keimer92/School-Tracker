import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
}

export function ReporteAsistenciaPage() {
  // Filtros
  const [anos, setAnos] = useState<CategoryItem[]>([]);
  const [colegios, setColegios] = useState<CategoryItem[]>([]);
  const [grados, setGrados] = useState<CategoryItem[]>([]);
  const [secciones, setSecciones] = useState<CategoryItem[]>([]);

  const [selectedAno, setSelectedAno] = useState<number>(0);
  const [selectedColegio, setSelectedColegio] = useState<number>(0);
  const [selectedGrado, setSelectedGrado] = useState<number>(0);
  const [selectedSeccion, setSelectedSeccion] = useState<number>(0);
  
  const [periodo, setPeriodo] = useState<"diario" | "semanal" | "mensual">("diario");
  const [fechaBase, setFechaBase] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [mesSeleccionado, setMesSeleccionado] = useState<number>(() => new Date().getMonth() + 1);
  const [anoSeleccionado, setAnoSeleccionado] = useState<number>(() => new Date().getFullYear());

  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [fechaFin, setFechaFin] = useState<string>("");

  const [reporte, setReporte] = useState<AsistenciaReporteItem[]>([]);
  const [loading, setLoading] = useState(false);

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
      setFechaInicio(lunes.toISOString().split('T')[0]);
      setFechaFin(new Date().toISOString().split('T')[0]); // Hasta hoy
    } else if (periodo === "mensual") {
      // Primer día del mes seleccionado
      const primerDia = new Date(anoSeleccionado, mesSeleccionado - 1, 1);
      setFechaInicio(primerDia.toISOString().split('T')[0]);
      
      // Si el mes seleccionado es el actual, hasta hoy. Si es pasado, hasta el fin de mes.
      if (anoSeleccionado === hoy.getFullYear() && mesSeleccionado === hoy.getMonth() + 1) {
        setFechaFin(hoy.toISOString().split('T')[0]);
      } else {
        const ultimoDia = new Date(anoSeleccionado, mesSeleccionado, 0);
        setFechaFin(ultimoDia.toISOString().split('T')[0]);
      }
    }
  }, [periodo, fechaBase, mesSeleccionado, anoSeleccionado]);

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
      
      if (anosData.length > 0) {
        const activo = anosData.find(a => a.activo);
        setSelectedAno(activo ? activo.id : anosData[0].id);
      }
      
      // Lógica de recomendación diaria para asistencia
      if (recommendedColegioId && recommendedColegioId > 0) {
        setSelectedColegio(recommendedColegioId);
      } else if (colegiosData.length > 0) {
        const activo = colegiosData.find(c => c.activo);
        setSelectedColegio(activo ? activo.id : colegiosData[0].id);
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
    }
  }, [selectedColegio, selectedAno]);

  const fetchGrados = async () => {
    try {
      if (!selectedColegio || !selectedAno) return;
      const gradosData = await invoke<CategoryItem[]>("get_grados_by_colegio", {
        colegioId: Number(selectedColegio),
        anoLectivoId: Number(selectedAno)
      });
      setGrados(gradosData);
      if (gradosData.length > 0) {
        setSelectedGrado(gradosData[0].id);
      } else {
        setSelectedGrado(0);
      }
    } catch (error) {
      console.error("Error fetching grados:", error);
      await emit("show-toast", { message: "❌ Error al cargar grados: " + error, type: "error" });
    }
  };

  // Cargar secciones cuando cambie el grado o el colegio o el año
  useEffect(() => {
    if (selectedGrado && selectedColegio && selectedAno) {
      fetchSecciones();
    }
  }, [selectedGrado, selectedColegio, selectedAno]);

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
        setSelectedSeccion(data[0].id);
      } else {
        setSelectedSeccion(0);
      }
    } catch (error) {
      console.error("Error fetching secciones:", error);
      await emit("show-toast", { message: "❌ Error al cargar secciones: " + error, type: "error" });
    }
  };

  const fetchReporte = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke<AsistenciaReporteItem[]>("get_asistencia_rango", {
        fechaInicio,
        fechaFin,
        anoLectivoId: selectedAno,
        colegioId: selectedColegio,
        gradoId: selectedGrado,
        seccionId: selectedSeccion,
      });
      setReporte(data);
    } catch (error) {
      console.error("Error fetching attendance report:", error);
      await emit("show-toast", { message: "❌ Error al cargar reporte: " + error, type: "error" });
    } finally {
      setLoading(false);
    }
  }, [fechaInicio, fechaFin, selectedAno, selectedColegio, selectedGrado, selectedSeccion]);

  // Escuchar cambios en estudiantes para refrescar el reporte
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen("student-updated", () => {
        console.log("🔔 Evento 'student-updated' recibido en ReporteAsistenciaPage. Refrescando...");
        fetchReporte();
      });
      return unlisten;
    };

    const setupCatalogListener = async () => {
      return await listen("catalog-updated", () => {
        console.log("🔔 Evento 'catalog-updated' recibido en ReporteAsistenciaPage. Refrescando catálogos...");
        fetchCatalogs();
      });
    };

    const unlistenPromise = setupListener();
    const unlistenCatalogPromise = setupCatalogListener();
    
    return () => {
      unlistenPromise.then(u => u());
      unlistenCatalogPromise.then(u => u());
    };
  }, [fetchReporte]);

  // Cargar reporte cuando cambien los filtros
  useEffect(() => {
    if (selectedAno && selectedColegio && selectedGrado && selectedSeccion && fechaInicio && fechaFin) {
      fetchReporte();
    }
  }, [selectedAno, selectedColegio, selectedGrado, selectedSeccion, fechaInicio, fechaFin, fetchReporte]);

  // Obtener lista de fechas únicas en el rango
  const getFechasUnicas = () => {
    const fechasSet = new Set<string>();
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
    return Array.from(fechasSet).sort();
  };

  const fechasColumnas = getFechasUnicas();

  const getEstadoEnFecha = (item: AsistenciaReporteItem, fecha: string) => {
    const found = item.fechas.find(f => f.startsWith(fecha));
    if (!found) return "-";
    return found.split(':')[1];
  };

  const getEstadoColor = (estado: string) => {
    switch (estado) {
      case 'P': return '#4caf50'; // Verde para Presente
      case 'A': return '#f44336'; // Rojo para Ausente
      case 'J': return '#ff9800'; // Naranja para Justificado
      default: return 'transparent';
    }
  };

  const exportToPDF = async () => {
    try {
      const doc = new jsPDF('l', 'mm', 'a4'); // Paisaje para más columnas
      const colegioNombre = colegios.find(c => c.id === selectedColegio)?.nombre || "";
      const gradoNombre = grados.find(g => g.id === selectedGrado)?.nombre || "";
      const seccionNombre = secciones.find(s => s.id === selectedSeccion)?.nombre || "";

      doc.setFontSize(16);
      doc.text("Reporte de Asistencia", 14, 15);
      doc.setFontSize(10);
      doc.text(`Colegio: ${colegioNombre}`, 14, 22);
      doc.text(`Grado: ${gradoNombre} - Sección: ${seccionNombre}`, 14, 27);
      doc.text(`Periodo: ${periodo.toUpperCase()} (${fechaInicio} al ${fechaFin})`, 14, 32);

      let headers: string[] = [];
      let body: any[][] = [];

      if (periodo === "diario") {
        headers = ["Estudiante", "Sexo", "Estado", "Observación"];
        body = reporte.map(est => {
          const estado = getEstadoEnFecha(est, fechaInicio);
          return [
            est.nombre,
            est.sexo,
            estado === '-' ? 'Sin registro' : estado,
            '' // Observación vacía por ahora
          ];
        });
      } else {
        const fechasCols = getFechasUnicas();
        headers = ["Estudiante", ...fechasCols.map(f => f.split('-').slice(1).reverse().join('/')), "P", "A", "J"];
        body = reporte.map(est => {
          const p = est.fechas.filter(f => f.endsWith(':P')).length;
          const a = est.fechas.filter(f => f.endsWith(':A')).length;
          const j = est.fechas.filter(f => f.endsWith(':J')).length;
          return [
            est.nombre,
            ...fechasCols.map(f => getEstadoEnFecha(est, f)),
            p, a, j
          ];
        });
      }

      autoTable(doc, {
        head: [headers],
        body: body,
        startY: 40,
        styles: { fontSize: 8, cellPadding: 1 },
        headStyles: { fillColor: [44, 62, 80] },
        didParseCell: (data) => {
          if (data.section === 'body') {
            const val = data.cell.raw as string;
            if (val === 'P') data.cell.styles.textColor = [76, 175, 80];
            if (val === 'A') data.cell.styles.textColor = [244, 67, 54];
            if (val === 'J') data.cell.styles.textColor = [255, 152, 0];
          }
        }
      });

      doc.save(`Asistencia_${gradoNombre}_${seccionNombre}_${fechaInicio}.pdf`);
      await emit("show-toast", { message: "✅ PDF generado exitosamente", type: 'success' });
    } catch (error) {
      console.error("Error al exportar PDF:", error);
      await emit("show-toast", { 
        message: "❌ Error al generar el PDF: " + (error instanceof Error ? error.message : String(error)), 
        type: 'error' 
      });
    }
  };

  return (
    <div className="page-container">
      <div className="category-grid" style={{ display: 'block' }}>
        {/* Filtros */}
        <div className="category-card sticky-filters" style={{ 
          position: 'sticky', 
          top: 0, 
          zIndex: 999, 
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
          background: 'rgba(26, 26, 26, 0.8)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          marginBottom: '1.5rem',
          width: '100%',
          padding: '0.6rem',
          borderRadius: '0 0 12px 12px',
          border: '1px solid rgba(255,255,255,0.05)',
          borderTop: 'none'
        }}>
          <div className="filters-row" style={{ 
            padding: '0.4rem', 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: '0.4rem',
            justifyContent: 'flex-start',
            alignItems: 'center'
          }}>
            <div className="input-container-small">
              <label>Período:</label>
              <select 
                className="filter-select"
                value={periodo} 
                onChange={(e) => setPeriodo(e.target.value as any)}
              >
                <option value="diario">Diario</option>
                <option value="semanal">Semanal</option>
                <option value="mensual">Mensual</option>
              </select>
            </div>

            {periodo !== "mensual" ? (
              <div className="input-container-small">
                <label>{periodo === "diario" ? "Fecha:" : "Semana de:"}</label>
                <input 
                  type="date" 
                  className="filter-select"
                  value={fechaBase} 
                  onChange={(e) => setFechaBase(e.target.value)} 
                />
              </div>
            ) : (
              <>
                <div className="input-container-small">
                  <label>Mes:</label>
                  <select 
                    className="filter-select"
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
                </div>
                <div className="input-container-small">
                  <label>Año:</label>
                  <select 
                    className="filter-select"
                    value={anoSeleccionado} 
                    onChange={(e) => setAnoSeleccionado(Number(e.target.value))}
                  >
                    {[...Array(5)].map((_, i) => {
                      const year = new Date().getFullYear() - 2 + i;
                      return <option key={year} value={year}>{year}</option>;
                    })}
                  </select>
                </div>
              </>
            )}

            <div className="input-container-small">
              <label>Año Lectivo:</label>
              <select 
                className="filter-select"
                value={selectedAno} 
                onChange={(e) => setSelectedAno(Number(e.target.value))}
              >
                {anos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
            <div className="input-container-small">
              <label>Colegio:</label>
              <select 
                className="filter-select"
                value={selectedColegio} 
                onChange={(e) => setSelectedColegio(Number(e.target.value))}
              >
                {colegios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="input-container-small">
              <label>Grado:</label>
              <select 
                className="filter-select"
                value={selectedGrado} 
                onChange={(e) => setSelectedGrado(Number(e.target.value))}
              >
                {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div className="input-container-small">
              <label>Sección:</label>
              <select 
                className="filter-select"
                value={selectedSeccion} 
                onChange={(e) => setSelectedSeccion(Number(e.target.value))}
              >
                {secciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <button className="action-button primary" onClick={exportToPDF} style={{ marginLeft: 'auto' }}>
              📄 Exportar PDF
            </button>
          </div>
        </div>

        {/* Tabla de Resultados o Estado Vacío */}
        <div className="table-container" style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="loading-container">Cargando reporte...</div>
          ) : reporte.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '5rem 2rem', border: '2px dashed rgba(255, 255, 255, 0.1)', borderRadius: '16px', margin: '0 1rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
              <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>No hay datos para mostrar</h4>
              <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
                No se encontraron registros de asistencia para los filtros seleccionados (Año, Colegio, Grado, Sección, Rango de fechas).
              </p>
            </div>
          ) : periodo === "diario" ? (
            /* Vista simplificada para modo Diario (similar a AsistenciaPage) */
            <table className="custom-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Estudiante</th>
                  <th>Sexo</th>
                  <th>Estado</th>
                  <th>Observación</th>
                </tr>
              </thead>
              <tbody>
                {reporte.map(item => {
                  const estado = getEstadoEnFecha(item, fechaInicio);
                  // Intentar obtener observación si existiera en el futuro (actualmente el comando no la trae)
                  return (
                    <tr key={item.id}>
                      <td style={{ textAlign: 'left', fontWeight: 'bold' }}>{item.nombre}</td>
                      <td>{item.sexo}</td>
                      <td>
                        <div className="asistencia-options" style={{ justifyContent: 'center', pointerEvents: 'none' }}>
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
                      <td style={{ color: '#94a3b8', fontSize: '0.8rem', fontStyle: 'italic' }}>
                        {estado === '-' ? "Sin registro" : "Registrado"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            /* Vista de rango para Semanal/Mensual */
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Estudiante</th>
                  {fechasColumnas.map(f => (
                    <th key={f} style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                      {f.split('-').slice(1).reverse().join('/')}
                    </th>
                  ))}
                  <th>P</th>
                  <th>A</th>
                  <th>J</th>
                </tr>
              </thead>
              <tbody>
                {reporte.map(item => {
                  const p = item.fechas.filter(f => f.endsWith(':P')).length;
                  const a = item.fechas.filter(f => f.endsWith(':A')).length;
                  const j = item.fechas.filter(f => f.endsWith(':J')).length;
                  
                  return (
                    <tr key={item.id}>
                      <td style={{ textAlign: 'left', fontWeight: 'bold' }}>{item.nombre}</td>
                      {fechasColumnas.map(f => {
                        const estado = getEstadoEnFecha(item, f);
                        return (
                          <td key={f} style={{ 
                            color: getEstadoColor(estado), 
                            fontWeight: 'bold',
                            fontSize: '0.8rem'
                          }}>
                            {estado}
                          </td>
                        );
                      })}
                      <td style={{ color: '#4caf50' }}>{p}</td>
                      <td style={{ color: '#f44336' }}>{a}</td>
                      <td style={{ color: '#ff9800' }}>{j}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
