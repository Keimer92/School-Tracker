import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { syncService } from "../lib/syncService";
import "../App.css";

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

interface CategoryItem {
  id: number;
  nombre: string;
  activo?: boolean;
  cualitativo?: boolean;
}

export function EvaluacionesPage() {
  const [grados, setGrados] = useState<CategoryItem[]>([]);
  const [asignaturas, setAsignaturas] = useState<CategoryItem[]>([]);
  const [cortes, setCortes] = useState<CategoryItem[]>([]);
  
  const [selectedGrado, setSelectedGrado] = useState<number>(0);
  const [selectedAsignatura, setSelectedAsignatura] = useState<number>(0);
  const [selectedCorte, setSelectedCorte] = useState<number>(0);

  const [indicadores, setIndicadores] = useState<Indicador[]>([]);
  const [loading, setLoading] = useState(false);
  const [isQualitative, setIsQualitative] = useState(false);

  useEffect(() => {
    fetchCatalogs();
  }, []);

  // Listen for subject-specific updates to refresh subjects
  useEffect(() => {
    const unlistenSubjects = listen("subjects-updated", async () => {
      console.log("EvaluacionesPage: Evento 'subjects-updated' recibido, refrescando asignaturas...");
      // Refresh subjects for the currently selected grade
      if (selectedGrado) {
        try {
          const asignaturasData = await invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrado });
          setAsignaturas(asignaturasData);
          // Keep current selection if still valid, otherwise reset
          if (asignaturasData.length > 0 && !asignaturasData.some(a => a.id === selectedAsignatura)) {
            setSelectedAsignatura(asignaturasData[0].id);
          }
        } catch (error) {
          console.error("Error refreshing subjects:", error);
        }
      }
    });

    return () => {
      unlistenSubjects.then(f => f());
    };
  }, [selectedGrado, selectedAsignatura]);

  useEffect(() => {
    if (selectedGrado && selectedAsignatura && selectedCorte) {
      fetchConfig();
    } else {
      setIndicadores([]);
    }
  }, [selectedGrado, selectedAsignatura, selectedCorte]);

  const fetchCatalogs = async () => {
    try {
      const [gData, cData] = await Promise.all([
        invoke<CategoryItem[]>("get_grados"),
        invoke<CategoryItem[]>("get_cortes"),
      ]);
      setGrados(gData);
      setCortes(cData);
      if (cData.length > 0) setSelectedCorte(cData[0].id);
      if (gData.length > 0) {
        setSelectedGrado(gData[0].id);
        setIsQualitative(gData[0].cualitativo || false);
      }
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      await emit("show-toast", { message: "❌ Error al cargar catálogos: " + error, type: "error" });
    }
  };

  useEffect(() => {
    if (selectedGrado) {
      const grado = grados.find(g => g.id === selectedGrado);
      setIsQualitative(grado?.cualitativo || false);

      invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrado })
        .then(data => {
          setAsignaturas(data);
          if (data.length > 0) {
            setSelectedAsignatura(data[0].id);
          } else {
            setSelectedAsignatura(0);
          }
        })
        .catch(async (err) => {
          console.error("Error fetching subjects:", err);
          await emit("show-toast", { message: "❌ Error al cargar asignaturas: " + err, type: "error" });
          setAsignaturas([]);
          setSelectedAsignatura(0);
        });
    } else {
      setAsignaturas([]);
      setSelectedAsignatura(0);
      setIsQualitative(false);
    }
  }, [selectedGrado, grados]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const data = await invoke<Indicador[]>("get_evaluation_config", {
        gradoId: selectedGrado,
        asignaturaId: selectedAsignatura,
        corteEvaluativoId: selectedCorte,
      });
      setIndicadores(data);
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al cargar configuración: " + error, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleIndicador = async (indicador: Indicador) => {
    const activeCount = indicadores.filter(i => i.activo).length;
    
    if (!indicador.activo && activeCount >= 5) {
      await emit("show-toast", { 
        message: "⚠️ Solo pueden haber 5 indicadores activos. Desmarque uno antes de activar este.", 
        type: "warning" 
      });
      return;
    }

    try {
      await invoke("update_indicador", {
        id: indicador.id,
        descripcion: indicador.descripcion,
        activo: !indicador.activo
      });
      // Optimistic update
      setIndicadores(prev => prev.map(i => i.id === indicador.id ? { ...i, activo: !i.activo } : i));
      
      console.log("EvaluacionesPage: Emitiendo evento 'notas-updated' tras cambiar estado de indicador");
      await emit("notas-updated", { timestamp: Date.now() });
      console.log("EvaluacionesPage: Evento 'notas-updated' emitido con éxito.");
    } catch (error) {
       await emit("show-toast", { message: "❌ Error al actualizar: " + error, type: "error" });
    }
  };

  const handleUpdateIndicadorDesc = async (id: number, desc: string) => {
      // Local update first for responsiveness
      setIndicadores(prev => prev.map(i => i.id === id ? { ...i, descripcion: desc } : i));
  };

  const handleBlurIndicador = async (indicador: Indicador) => {
      // Save on blur
      try {
        await invoke("update_indicador", {
            id: indicador.id,
            descripcion: indicador.descripcion,
            activo: indicador.activo
        });
        // Emitir evento para que NotasPage se entere del cambio de descripción inmediatamente
        await emit("notas-updated", { timestamp: Date.now(), source: 'EvaluacionesPage-BlurIndicador' });
      } catch (error) {
          console.error("Error saving description", error);
          await emit("show-toast", { message: "❌ Error al guardar descripción: " + error, type: "error" });
      }
  };

  const handleUpdateCriterio = async (indicadorId: number, criterioId: number, field: 'descripcion' | 'puntajeMaximo', value: string | number) => {
     setIndicadores(prev => prev.map(ind => {
         if (ind.id !== indicadorId) return ind;
         return {
             ...ind,
             criterios: ind.criterios.map(crit => crit.id === criterioId ? { ...crit, [field]: value } : crit)
         };
     }));
  };

  const handleSaveConfig = async () => {
    // Validar puntajes antes de guardar (solo si no es cualitativo)
    const problemas = [];
    let primerIndicadorConProblema = null;

    if (!isQualitative) {
      for (const indicador of indicadores) {
        if (!indicador.activo) continue;
        
        const totalPuntaje = indicador.criterios.reduce((sum, crit) => sum + Number(crit.puntajeMaximo), 0);
        
        if (totalPuntaje > 20) {
          problemas.push(`Indicador ${indicador.orden}: ${totalPuntaje} pts (máximo 20)`);
          
          // Guardar el primer indicador con problema para hacer scroll
          if (!primerIndicadorConProblema) {
            primerIndicadorConProblema = indicador;
          }
        }
      }
    }

    // Si hay problemas, mostrar alerta y hacer scroll al primer indicador con problema
    if (problemas.length > 0) {
      const mensaje = `⚠️ Errores de validación encontrados:\n\n${problemas.join('\n')}\n\nPor favor corrija los puntajes antes de guardar.`;
      
      await emit("show-toast", { message: mensaje, type: "error" });

      // Hacer scroll al primer indicador con problema
      if (primerIndicadorConProblema) {
        setTimeout(() => {
          const element = document.getElementById(`indicador-${primerIndicadorConProblema.id}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.style.boxShadow = '0 0 0 3px rgba(244, 63, 94, 0.5)';
            element.style.transition = 'box-shadow 0.3s ease';
            
            // Remover el efecto después de 2 segundos
            setTimeout(() => {
              if (element) {
                element.style.boxShadow = 'none';
              }
            }, 2000);
          }
        }, 100);
      }
      
      return;
    }

    try {
      // Guardar todos los indicadores y criterios
      for (const indicador of indicadores) {
        await invoke("update_indicador", {
          id: indicador.id,
          descripcion: indicador.descripcion,
          activo: indicador.activo
        });
        
        for (const criterio of indicador.criterios) {
          await invoke("update_criterio", {
            id: criterio.id,
            descripcion: criterio.descripcion,
            puntajeMaximo: Number(criterio.puntajeMaximo)
          });
        }
      }
      
      console.log("EvaluacionesPage: Emitiendo evento 'notas-updated' después de guardar configuración");
      await emit("notas-updated", { timestamp: Date.now() });
      console.log("EvaluacionesPage: Evento 'notas-updated' emitido con éxito.");
      
      // Sincronizar con Supabase en segundo plano (sin await)
      syncService.syncEvaluacionConfig(indicadores).catch(err => {
        console.error("Error en sincronización background de evaluación:", err);
      });
      
      await emit("show-toast", { message: "✅ Configuración guardada localmente (Sincronizando...)", type: "success" });
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al guardar la configuración: " + error, type: "error" });
    }
  };

  const handleBlurCriterio = async (criterio: Criterio) => {
      try {
          await invoke("update_criterio", {
              id: criterio.id,
              descripcion: criterio.descripcion,
              puntajeMaximo: Number(criterio.puntajeMaximo) // Ensure number
          });
          // Emitir evento para que NotasPage se entere del cambio de descripción inmediatamente
          await emit("notas-updated", { timestamp: Date.now(), source: 'EvaluacionesPage-BlurCriterio' });
      } catch (error) {
          console.error("Error saving criterio", error);
          await emit("show-toast", { message: "❌ Error al guardar criterio: " + error, type: "error" });
      }
  };

  return (
    <div className="page-container">
      <div className="category-grid" style={{ display: 'block' }}>
      
      {/* Configure Header */}
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
        <div className="filters-row" style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: '0.8rem', 
          alignItems: 'flex-end' 
        }}>
           <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: '1 1 120px' }}>
             <label style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 'bold' }}>Grado</label>
             <select 
               className="filter-select"
               style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
               value={selectedGrado}
               onChange={(e) => setSelectedGrado(Number(e.target.value))}
               aria-label="Seleccionar grado"
             >
                {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
             </select>
           </div>
           
           <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: '1 2 180px' }}>
             <label style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 'bold' }}>Asignatura</label>
             <select 
               className="filter-select"
               style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
               value={selectedAsignatura}
               onChange={(e) => setSelectedAsignatura(Number(e.target.value))}
               disabled={asignaturas.length === 0}
               aria-label="Seleccionar asignatura"
             >
                {asignaturas.length === 0 && <option value="0">Sin asignaturas</option>}
                {asignaturas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
             </select>
           </div>

           <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: '1 1 120px' }}>
             <label style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 'bold' }}>Corte</label>
             <select 
               className="filter-select"
               style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
               value={selectedCorte}
               onChange={(e) => setSelectedCorte(Number(e.target.value))}
               aria-label="Seleccionar corte evaluativo"
             >
                {cortes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
             </select>
           </div>

           <div style={{ flex: '1 0 auto', display: 'flex', justifyContent: 'flex-end' }}>
             <button 
               className="primary" 
               onClick={handleSaveConfig}
               disabled={loading || asignaturas.length === 0}
               style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
             >
               {loading ? '⏳ Guardando...' : '💾 Guardar Todo'}
             </button>
           </div>
        </div>
      </div>

      {loading && <div style={{textAlign: 'center', padding: '2rem'}}>Cargando configuración...</div>}

      {/* Indicators List */}
      {!loading && (
        <>
          {indicadores.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ padding: '0 1rem', color: '#aaa', fontSize: '0.9rem' }}>
                 Total Activos: {indicadores.filter(i => i.activo).length} / 5 {!isQualitative && '(100 pts)'}
              </div>

              {indicadores.map((ind) => (
                  <div key={ind.id} id={`indicador-${ind.id}`} className={`category-card ${!ind.activo ? 'inactive-card' : ''}`} style={{ opacity: ind.activo ? 1 : 0.6 }}>
                      <div className="category-header" style={{ 
                          background: ind.activo ? 'rgba(100, 108, 255, 0.1)' : 'rgba(0,0,0,0.2)', 
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '0.5rem',
                          padding: '0.8rem'
                      }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flex: '1 1 250px' }}>
                              <label className="switch" title={ind.activo ? "Desactivar" : "Activar"}>
                                 <input 
                                     type="checkbox" 
                                     checked={ind.activo} 
                                     onChange={() => handleToggleIndicador(ind)}
                                 />
                                 <span className="slider round"></span>
                             </label>
                             <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>Ind. {ind.orden}</span>
                             <input 
                                 type="text" 
                                 value={ind.descripcion}
                                 onChange={(e) => handleUpdateIndicadorDesc(ind.id, e.target.value)}
                                 onBlur={() => handleBlurIndicador(ind)}
                                 placeholder="Descripción del indicador..."
                                 aria-label={`Descripción del indicador ${ind.orden}`}
                                 style={{ 
                                     background: 'transparent', 
                                     border: 'none', 
                                     borderBottom: '1px solid rgba(255,255,255,0.2)', 
                                     color: 'white', 
                                     flex: 1,
                                     padding: '0.3rem',
                                     minWidth: '100px'
                                 }}
                             />
                          </div>
                          <span style={{ 
                              fontSize: '0.75rem', 
                              background: ind.activo ? (isQualitative ? '#3b82f6' : '#4ade80') : '#64748b', 
                              color: ind.activo && isQualitative ? '#fff' : '#000', 
                              padding: '2px 8px', 
                              borderRadius: '10px',
                              marginLeft: 'auto'
                          }}>
                              {ind.activo ? (isQualitative ? 'Cualitativo' : '20 pts') : 'Inactivo'}
                          </span>
                      </div>
                      
                      {/* Criteria */}
                      {ind.activo && (
                          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              {ind.criterios.map(crit => (
                                  <div key={crit.id} style={{ 
                                      display: 'flex', 
                                      flexWrap: 'wrap', 
                                      gap: '0.5rem', 
                                      alignItems: 'center',
                                      padding: '0.5rem',
                                      background: 'rgba(255,255,255,0.02)',
                                      borderRadius: '8px',
                                      marginBottom: '0.2rem'
                                  }}>
                                      <span style={{ fontSize: '0.7rem', color: '#aaa', minWidth: '60px' }}>Crit. {crit.orden}</span>
                                      <input 
                                         type="text" 
                                         value={crit.descripcion}
                                         onChange={(e) => handleUpdateCriterio(ind.id, crit.id, 'descripcion', e.target.value)}
                                         onBlur={() => handleBlurCriterio(crit)}
                                         placeholder="Descripción del criterio..."
                                         aria-label={`Descripción del criterio ${crit.orden}`}
                                         style={{ 
                                             background: 'rgba(255,255,255,0.05)', 
                                             border: '1px solid rgba(255,255,255,0.1)', 
                                             color: 'white', 
                                             padding: '0.3rem', 
                                             borderRadius: '4px',
                                             flex: '1 1 150px'
                                         }}
                                      />
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: 'auto' }}>
                                          <input 
                                             type="number" 
                                             value={crit.puntajeMaximo}
                                             onChange={(e) => handleUpdateCriterio(ind.id, crit.id, 'puntajeMaximo', Number(e.target.value))}
                                             onBlur={() => handleBlurCriterio(crit)}
                                             disabled={isQualitative}
                                             aria-label={`Puntaje máximo del criterio ${crit.orden}`}
                                             style={{ 
                                                 width: '45px', 
                                                 padding: '0.2rem', 
                                                 textAlign: 'center', 
                                                 background: isQualitative ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.3)', 
                                                 border: isQualitative ? '1px solid #64748b' : '1px solid #4ade80', 
                                                 borderRadius: '4px', 
                                                 color: isQualitative ? '#64748b' : '#4ade80', 
                                                 fontWeight: 'bold',
                                                 fontSize: '0.85rem'
                                             }}
                                          />
                                          <span style={{ fontSize: '0.65rem', color: isQualitative ? '#64748b' : '#aaa' }}>pts</span>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '5rem 2rem', border: '2px dashed rgba(255, 255, 255, 0.1)', borderRadius: '16px', margin: '0 1rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚙️</div>
              <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>No hay configuración de evaluación</h4>
              <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
                {!selectedGrado || !selectedAsignatura || !selectedCorte 
                  ? 'Seleccione un grado, asignatura y corte para configurar los indicadores y criterios de evaluación.'
                  : 'No se encontró una configuración para la combinación seleccionada. Intente con otros filtros.'}
              </p>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
