import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { syncService } from "../lib/syncService";
import { FilterContainer, FilterGroup, FilterActions } from './FilterContainer';
import { useIsMobile } from "../hooks/useAndroid";
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

type ViewMode = 'modern-cards' | 'accordion' | 'split-panel' | 'refined';

const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'modern-cards', label: 'Moderno', icon: '🎴' },
  { key: 'accordion', label: 'Acordeón', icon: '📋' },
  { key: 'split-panel', label: 'Panel', icon: '⛶' },
  { key: 'refined', label: 'Clásico', icon: '🎨' },
];

const VIEW_MODE_KEY = 'evaluaciones-view-mode';

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

  const isMobile = useIsMobile();

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
    if (saved) return saved;
    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    return isAndroid ? 'accordion' : 'split-panel';
  });
  const [expandedIndicador, setExpandedIndicador] = useState<number | null>(null);
  const [accordionOpen, setAccordionOpen] = useState<Set<number>>(new Set());

  const filteredActiveIndicadores = indicadores.filter(i => i.activo);
  const puntosActivos = filteredActiveIndicadores.reduce((sum, ind) => {
    if (isQualitative) return sum;
    return sum + ind.criterios.reduce((s, c) => s + Number(c.puntajeMaximo), 0);
  }, 0);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
    setExpandedIndicador(null);
    setAccordionOpen(new Set());
  };

  useEffect(() => {
    fetchCatalogs();
  }, []);

  useEffect(() => {
    const unlistenSubjects = listen("subjects-updated", async () => {
      if (selectedGrado) {
        try {
          const asignaturasData = await invoke<CategoryItem[]>("get_subjects_by_grade", { gradoId: selectedGrado });
          const sortedAsignaturas = asignaturasData.sort((a, b) => a.nombre.localeCompare(b.nombre));
          setAsignaturas(sortedAsignaturas);
          if (sortedAsignaturas.length > 0 && !sortedAsignaturas.some(a => a.id === selectedAsignatura)) {
            setSelectedAsignatura(sortedAsignaturas[0].id);
          }
        } catch (error) {
          console.error("Error refreshing subjects:", error);
        }
      }
    });
    return () => { unlistenSubjects.then(f => f()); };
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
          const sortedData = data.sort((a, b) => a.nombre.localeCompare(b.nombre));
          setAsignaturas(sortedData);
          if (sortedData.length > 0) {
            setSelectedAsignatura(sortedData[0].id);
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
      setIndicadores(prev => prev.map(i => i.id === indicador.id ? { ...i, activo: !i.activo } : i));
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("notas-updated", { timestamp: Date.now() });
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al actualizar: " + error, type: "error" });
    }
  };

  const handleUpdateIndicadorDesc = async (id: number, desc: string) => {
    setIndicadores(prev => prev.map(i => i.id === id ? { ...i, descripcion: desc } : i));
  };

  const handleBlurIndicador = async (indicador: Indicador) => {
    try {
      await invoke("update_indicador", {
        id: indicador.id,
        descripcion: indicador.descripcion,
        activo: indicador.activo
      });
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
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
    const problemas = [];
    let primerIndicadorConProblema = null;

    if (!isQualitative) {
      for (const indicador of indicadores) {
        if (!indicador.activo) continue;
        const totalPuntaje = indicador.criterios.reduce((sum, crit) => sum + Number(crit.puntajeMaximo), 0);
        if (totalPuntaje > 20) {
          problemas.push(`Indicador ${indicador.orden}: ${totalPuntaje} pts (máximo 20)`);
          if (!primerIndicadorConProblema) {
            primerIndicadorConProblema = indicador;
          }
        }
      }
    }

    if (problemas.length > 0) {
      const mensaje = `⚠️ Errores de validación encontrados:\n\n${problemas.join('\n')}\n\nPor favor corrija los puntajes antes de guardar.`;
      await emit("show-toast", { message: mensaje, type: "error" });
      if (primerIndicadorConProblema) {
        setTimeout(() => {
          const element = document.getElementById(`indicador-${primerIndicadorConProblema.id}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.style.boxShadow = '0 0 0 3px rgba(244, 63, 94, 0.5)';
            element.style.transition = 'box-shadow 0.3s ease';
            setTimeout(() => {
              if (element) element.style.boxShadow = 'none';
            }, 2000);
          }
        }, 100);
      }
      return;
    }

    try {
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
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("notas-updated", { timestamp: Date.now() });
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
        puntajeMaximo: Number(criterio.puntajeMaximo)
      });
      syncService.syncAllSilent().catch(err => console.warn("Auto-sync:", err));
      await emit("notas-updated", { timestamp: Date.now(), source: 'EvaluacionesPage-BlurCriterio' });
    } catch (error) {
      console.error("Error saving criterio", error);
      await emit("show-toast", { message: "❌ Error al guardar criterio: " + error, type: "error" });
    }
  };

  const renderCriterioInputs = (ind: Indicador, crit: Criterio) => (
    <div key={crit.id} className="criterio-row">
      <span className="criterio-label">Crit. {crit.orden}</span>
      <input
        type="text"
        value={crit.descripcion}
        onChange={(e) => handleUpdateCriterio(ind.id, crit.id, 'descripcion', e.target.value)}
        onBlur={() => handleBlurCriterio(crit)}
        placeholder="Descripción del criterio..."
        className="criterio-input"
      />
      <div className="criterio-score">
        <input
          type="number"
          value={crit.puntajeMaximo}
          onChange={(e) => handleUpdateCriterio(ind.id, crit.id, 'puntajeMaximo', Number(e.target.value))}
          onBlur={() => handleBlurCriterio(crit)}
          disabled={isQualitative}
          className="criterio-puntaje"
        />
        <span className="criterio-pts">pts</span>
      </div>
    </div>
  );

  const renderIndicadorSwitch = (ind: Indicador) => (
    <label className="switch" title={ind.activo ? "Desactivar" : "Activar"}>
      <input
        type="checkbox"
        checked={ind.activo}
        onChange={() => handleToggleIndicador(ind)}
      />
      <span className="slider round"></span>
    </label>
  );

  const renderIndicadorBadge = (ind: Indicador) => (
    <div className={`indicador-badge ${ind.activo ? 'active' : 'inactive'}`}>
      {ind.orden}
    </div>
  );

  const renderStatusTag = (ind: Indicador) => {
    if (!ind.activo) return <span className="status-tag inactive">Inactivo</span>;
    return (
      <span className={`status-tag ${isQualitative ? 'qualitative' : 'quantitative'}`}>
        {isQualitative ? 'Cualitativo' : '20 pts'}
      </span>
    );
  };

  // ──────────────── VIEW MODE: MODERN CARDS ────────────────
  const renderModernCards = () => (
    <div className="ev-cards-container">
      {indicadores.map((ind) => (
        <div
          key={ind.id}
          id={`indicador-${ind.id}`}
          className={`indicador-card ${ind.activo ? 'active' : 'inactive'}`}
        >
          <div className="indicador-header">
            <div className="indicador-header-left">
              {renderIndicadorSwitch(ind)}
              {renderIndicadorBadge(ind)}
              <input
                type="text"
                value={ind.descripcion}
                onChange={(e) => handleUpdateIndicadorDesc(ind.id, e.target.value)}
                onBlur={() => handleBlurIndicador(ind)}
                placeholder="Descripción del indicador..."
                className="indicador-desc-input"
              />
            </div>
            <div className="indicador-header-right">
              {renderStatusTag(ind)}
            </div>
          </div>

          {ind.activo && (
            <div className="indicador-body">
              {ind.criterios.map(crit => renderCriterioInputs(ind, crit))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  // ──────────────── VIEW MODE: ACCORDION ────────────────
  const renderAccordion = () => (
    <div className="accordion-container">
      {indicadores.map((ind) => {
        const isOpen = accordionOpen.has(ind.id) || (!ind.activo && accordionOpen.has(ind.id));
        const expanded = accordionOpen.has(ind.id);
        return (
          <div
            key={ind.id}
            id={`indicador-${ind.id}`}
            className={`accordion-item ${ind.activo ? 'active' : 'inactive'} ${expanded ? 'expanded' : ''}`}
          >
            <div
              className="accordion-header"
              onClick={() => {
                const next = new Set(accordionOpen);
                if (next.has(ind.id)) next.delete(ind.id);
                else next.add(ind.id);
                setAccordionOpen(next);
              }}
            >
              <div className="accordion-header-left">
                {renderIndicadorSwitch(ind)}
                {renderIndicadorBadge(ind)}
                <input
                  type="text"
                  value={ind.descripcion}
                  onChange={(e) => handleUpdateIndicadorDesc(ind.id, e.target.value)}
                  onBlur={() => handleBlurIndicador(ind)}
                  placeholder="Descripción del indicador..."
                  className="indicador-desc-input"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="accordion-header-right">
                {renderStatusTag(ind)}
                <span className={`accordion-chevron ${expanded ? 'open' : ''}`}>&#9660;</span>
              </div>
            </div>

            {expanded && (
              <div className="accordion-body">
                {ind.activo ? (
                  ind.criterios.length > 0 ? (
                    ind.criterios.map(crit => renderCriterioInputs(ind, crit))
                  ) : (
                    <div className="accordion-empty">Sin criterios</div>
                  )
                ) : (
                  <div className="accordion-empty">Indicador inactivo — activa el switch para editar criterios</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ──────────────── VIEW MODE: SPLIT PANEL ────────────────
  const renderSplitPanel = () => {
    if (isMobile) return renderAccordion();

    const selected = indicadores.find(i => i.id === expandedIndicador) || indicadores[0] || null;

    return (
      <div className="split-layout">
        <div className="split-list">
          {indicadores.map((ind) => (
            <div
              key={ind.id}
              id={`indicador-${ind.id}`}
              className={`split-item ${ind.activo ? 'active' : 'inactive'} ${expandedIndicador === ind.id ? 'selected' : ''}`}
              onClick={() => setExpandedIndicador(ind.id)}
            >
              <div className="split-item-row">
                {renderIndicadorSwitch(ind)}
                {renderIndicadorBadge(ind)}
                <span className="split-item-desc">{ind.descripcion || `Indicador ${ind.orden}`}</span>
                {renderStatusTag(ind)}
              </div>
            </div>
          ))}
        </div>

        <div className="split-detail">
          {selected ? (
            <>
              <div className="split-detail-header">
                <h3>Indicador {selected.orden}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {renderIndicadorSwitch(selected)}
                  {renderStatusTag(selected)}
                </div>
              </div>
              <input
                type="text"
                value={selected.descripcion}
                onChange={(e) => handleUpdateIndicadorDesc(selected.id, e.target.value)}
                onBlur={() => handleBlurIndicador(selected)}
                placeholder="Descripción del indicador..."
                className="split-detail-desc"
              />
              <div className="split-detail-criterios">
                {selected.activo ? (
                  selected.criterios.map(crit => renderCriterioInputs(selected, crit))
                ) : (
                  <div className="accordion-empty">Indicador inactivo — activa el switch para editar criterios</div>
                )}
              </div>
            </>
          ) : (
            <div className="accordion-empty">Selecciona un indicador de la lista</div>
          )}
        </div>
      </div>
    );
  };

  // ──────────────── VIEW MODE: REFINED ────────────────
  const renderRefined = () => (
    <div className="ev-cards-container">
      {indicadores.map((ind) => (
        <div
          key={ind.id}
          id={`indicador-${ind.id}`}
          className={`refined-card ${ind.activo ? 'active' : 'inactive'}`}
        >
          <div className="refined-header">
            <div className="refined-header-top">
              <div className="refined-header-left">
                {renderIndicadorSwitch(ind)}
                <span className="refined-num">Ind. {ind.orden}</span>
              </div>
              {renderStatusTag(ind)}
            </div>
            <input
              type="text"
              value={ind.descripcion}
              onChange={(e) => handleUpdateIndicadorDesc(ind.id, e.target.value)}
              onBlur={() => handleBlurIndicador(ind)}
              placeholder="Descripción del indicador..."
              className="refined-desc-input"
            />
          </div>

          {ind.activo && (
            <div className="refined-body">
              {ind.criterios.map(crit => (
                <div key={crit.id} className="refined-criterio">
                  <span className="refined-crit-label">Crit. {crit.orden}</span>
                  <input
                    type="text"
                    value={crit.descripcion}
                    onChange={(e) => handleUpdateCriterio(ind.id, crit.id, 'descripcion', e.target.value)}
                    onBlur={() => handleBlurCriterio(crit)}
                    placeholder="Descripción del criterio..."
                    className="refined-crit-input"
                  />
                  <div className="refined-crit-score">
                    <input
                      type="number"
                      value={crit.puntajeMaximo}
                      onChange={(e) => handleUpdateCriterio(ind.id, crit.id, 'puntajeMaximo', Number(e.target.value))}
                      onBlur={() => handleBlurCriterio(crit)}
                      disabled={isQualitative}
                      className="refined-crit-puntaje"
                    />
                    <span className="criterio-pts">pts</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  // ──────────────── RENDER CONTENT ────────────────
  const renderContent = () => {
    if (loading) {
      return (
        <div className="ev-loading">
          <div className="ev-loading-spinner" />
          <span>Cargando configuración...</span>
        </div>
      );
    }

    if (indicadores.length === 0) {
      return (
        <div className="ev-empty">
          <div className="ev-empty-icon">⚙️</div>
          <h4>No hay configuración de evaluación</h4>
          <p>
            {!selectedGrado || !selectedAsignatura || !selectedCorte
              ? 'Seleccione un grado, asignatura y corte para configurar los indicadores y criterios de evaluación.'
              : 'No se encontró una configuración para la combinación seleccionada. Intente con otros filtros.'}
          </p>
        </div>
      );
    }

    // Score summary bar
    const activeCount = filteredActiveIndicadores.length;
    const maxScore = isQualitative ? activeCount * 20 : 100;
    const scoreRatio = maxScore > 0 ? Math.min(puntosActivos / maxScore, 1) : 0;

    return (
      <>
        <div className="ev-score-summary">
          <div className="ev-score-text">
            <span>Activos: <strong>{activeCount}</strong> / 5</span>
            {!isQualitative && (
              <span style={{ marginLeft: '1rem' }}>
                Puntaje: <strong>{puntosActivos}</strong> / {maxScore} pts
              </span>
            )}
          </div>
          {!isQualitative && (
            <div className="ev-score-bar">
              <div className="ev-score-fill" style={{ width: `${scoreRatio * 100}%` }} />
            </div>
          )}
        </div>

        {viewMode === 'modern-cards' && renderModernCards()}
        {viewMode === 'accordion' && renderAccordion()}
        {viewMode === 'split-panel' && renderSplitPanel()}
        {viewMode === 'refined' && renderRefined()}
      </>
    );
  };

  // ──────────────── MAIN RENDER ────────────────
  return (
    <div className="page-container">
      <div className="category-grid" style={{ display: 'block' }}>
        <FilterContainer isMobile={isMobile}>
          <FilterGroup label="Grado:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select
              className="filter-select"
              style={{ width: '100%', padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px' }}
              value={selectedGrado}
              onChange={(e) => setSelectedGrado(Number(e.target.value))}
              aria-label="Seleccionar grado"
            >
              {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </FilterGroup>
          <FilterGroup label="Asignatura:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select
              className="filter-select"
              style={{ width: '100%', padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px' }}
              value={selectedAsignatura}
              onChange={(e) => setSelectedAsignatura(Number(e.target.value))}
              disabled={asignaturas.length === 0}
              aria-label="Seleccionar asignatura"
            >
              {asignaturas.length === 0 && <option value="0">Sin asignaturas</option>}
              {asignaturas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </FilterGroup>
          <FilterGroup label="Corte:" isMobile={isMobile} flex={isMobile ? '1 1 calc(33.33% - 0.4rem)' : '0 0 auto'}>
            <select
              className="filter-select"
              style={{ width: '100%', padding: '0.3rem 0.4rem', fontSize: '0.75rem', height: '28px' }}
              value={selectedCorte}
              onChange={(e) => setSelectedCorte(Number(e.target.value))}
              aria-label="Seleccionar corte evaluativo"
            >
              {cortes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </FilterGroup>
          <FilterActions>
            <button
              className="primary"
              onClick={handleSaveConfig}
              disabled={loading || asignaturas.length === 0}
              style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
            >
              {loading ? '⏳...' : '💾'}
            </button>
          </FilterActions>
        </FilterContainer>

        {/* View mode toggle */}
        <div className="ev-view-toggle">
          {VIEW_MODES.map(({ key, label, icon }) => (
            <button
              key={key}
              className={`ev-view-btn ${viewMode === key ? 'active' : ''}`}
              onClick={() => handleViewModeChange(key)}
              title={label}
            >
              <span className="ev-view-icon">{icon}</span>
              {!isMobile && <span className="ev-view-label">{label}</span>}
            </button>
          ))}
        </div>

        {renderContent()}
      </div>
    </div>
  );
}
