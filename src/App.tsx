import { useState, useEffect } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import "./App.css";
import { GlobalesPage } from "./components/GlobalesPage";
import { EstudiantesPage } from "./components/EstudiantesPage";
import { EvaluacionesPage } from "./components/EvaluacionesPage";
import { AjustesPage } from "./components/AjustesPage";
import { NotasPage } from "./components/NotasPage";
import { ReportesPage } from "./components/ReportesPage";
import { AsistenciaPage } from "./components/AsistenciaPage";
import { InformePage } from "./components/InformePage";
import { supabase } from "./lib/supabase";
import { syncService } from "./lib/syncService";

type AppMode = "selection" | "notas" | "asistencia";
type Tab = "notas" | "reportes" | "estudiantes" | "evaluaciones" | "globales" | "ajustes" | "asistencia" | "informe";

function App() {
  console.log("Componente App montándose...");
  
  const [appMode, setAppMode] = useState<AppMode>(() => {
    const saved = localStorage.getItem('app-mode');
    console.log("Cargando appMode de localStorage:", saved);
    // Configuración modificada para entrar directamente a asistencia
    // Si estaba en notas, se mantiene. Si no, o si estaba en selection, va a asistencia.
    return saved === "notas" ? "notas" : "asistencia";
  });

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const savedTab = localStorage.getItem('active-tab') as Tab;
    if (appMode === "asistencia") return "asistencia";
    return savedTab || "notas";
  });
  
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => {
    const saved = localStorage.getItem('visited-tabs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Asegurarnos de que el activeTab esté siempre en visitedTabs
        const active = (localStorage.getItem('active-tab') as Tab) || "notas";
        return new Set([...parsed, active]);
      } catch (e) {
        return new Set([activeTab]);
      }
    }
    return new Set([activeTab]);
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved) : 260;
  });

  const [isResizing, setIsResizing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; isOpen: boolean }>({
    message: '',
    type: 'info',
    isOpen: false
  });

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type, isOpen: true });
    setTimeout(() => {
      setToast(prev => ({ ...prev, isOpen: false }));
    }, 3000);
  };

  useEffect(() => {
    const unlisten = listen('show-toast', (event: any) => {
      const { message, type } = event.payload;
      showToast(message, type);
    });
    return () => {
      unlisten.then(u => u());
    };
  }, []);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setVisitedTabs(prev => new Set(prev).add(tab));
  };

  // Sincronización automática: descarga datos de la nube al iniciar sesión o al arrancar con sesión activa
  useEffect(() => {
    let lastUserId: string | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const currentUser = session?.user ?? null;

      if (currentUser && currentUser.id !== lastUserId) {
        const isInitialLoad = lastUserId === null;
        lastUserId = currentUser.id;

        console.log(`[Auto-Sync] Evento: ${event} | Usuario: ${currentUser.email}`);

        // Solo disparar sync en eventos de inicio de sesión o sesión inicial
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          // Descargar datos de la nube en segundo plano (no bloqueante)
          syncService.pullAll()
            .then(async () => {
              console.log('[Auto-Sync] Descarga completa');
              // Emitir evento para que las páginas refresquen las asignaturas
              try {
                await emit('subjects-updated');
              } catch (e) {
                console.error('Error emitting subjects-updated:', e);
              }
              if (!isInitialLoad) {
                showToast('✅ Datos actualizados desde la nube', 'success');
              }
            })
            .catch(err => {
              // Silenciar errores de usuario no logueado (esperado en carga inicial offline)
              if (!err?.message?.includes('estar conectado')) {
                console.error('[Auto-Sync] Error pullAll:', err);
                if (!isInitialLoad) {
                  showToast('⚠️ No se pudo descargar datos de la nube', 'error');
                }
              }
            });
        }

      } else if (!currentUser) {
        lastUserId = null;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const stopResizing = () => {
    setIsResizing(false);
  };

  const resize = (e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      if (newWidth > 180 && newWidth < 450) {
        setSidebarWidth(newWidth);
      }
    }
  };

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
    } else {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing]);

  // Cargar tema al iniciar la aplicación
  useEffect(() => {
    const savedTheme = localStorage.getItem('app-theme') || 'mint';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  // Aplicar orientación en Android al cambiar de modo
  useEffect(() => {
    const updateOrientation = async () => {
      console.log("Iniciando cambio de orientación para modo:", appMode);
      if (/Android/i.test(navigator.userAgent)) {
        let newOrientation = 'any';
        
        if (appMode === 'asistencia') {
          newOrientation = 'portrait';
        } else if (appMode === 'notas') {
          newOrientation = 'landscape';
        }

        try {
          // 1. Intentar con API de JS
          try {
            const lockType = newOrientation === 'portrait' ? 'portrait-primary' : 
                             newOrientation === 'landscape' ? 'landscape-primary' : 'any';

            if (lockType === 'any') {
              (screen.orientation as any).unlock?.();
            } else {
              await (screen.orientation as any).lock?.(lockType).catch(() => {});
            }
          } catch (e) { /* ignore */ }

          // 2. Usar comando nativo de Rust
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('set_orientation', { orientation: newOrientation });
          
          // Guardar la preferencia actual
          localStorage.setItem('app-orientation', newOrientation);
        } catch (error) {
          console.error("Error al cambiar orientación:", error);
        }
      }
    };
    
    if (appMode !== 'selection') {
      updateOrientation();
    }
  }, [appMode]);

  useEffect(() => {
    localStorage.setItem('sidebar-width', sidebarWidth.toString());
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('active-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('visited-tabs', JSON.stringify(Array.from(visitedTabs)));
  }, [visitedTabs]);

  useEffect(() => {
    localStorage.setItem('app-mode', appMode);
    if (appMode === "asistencia") {
      setActiveTab("asistencia");
    } else if (appMode === "notas" && activeTab === "asistencia") {
      setActiveTab("notas");
    }
  }, [appMode]);

  const handleModeSelection = (mode: AppMode) => {
    setAppMode(mode);
    if (mode === "asistencia") {
      setActiveTab("asistencia");
      setVisitedTabs(prev => new Set(prev).add("asistencia"));
    } else if (mode === "notas") {
      setActiveTab("notas");
      setVisitedTabs(prev => new Set(prev).add("notas"));
    }
  };

  const toggleAppMode = () => {
    const newMode = appMode === "notas" ? "asistencia" : "notas";
    setAppMode(newMode);
    
    // Al cambiar de modo, también cambiamos la pestaña activa correspondiente
    if (newMode === "asistencia") {
      setActiveTab("asistencia");
      setVisitedTabs(prev => new Set(prev).add("asistencia"));
    } else {
      setActiveTab("notas");
      setVisitedTabs(prev => new Set(prev).add("notas"));
    }
  };

  const renderTab = (tab: Tab, component: React.ReactNode) => {
    if (!visitedTabs.has(tab)) return null;
    return (
      <div style={{ 
        display: activeTab === tab ? "block" : "none",
        width: "100%",
        maxWidth: "100%",
        height: "100%"
      }}>
        {component}
      </div>
    );
  };

  if (appMode === "selection") {
    return (
      <div className="mode-selection-container">
        <div className="mode-selection-card">
          <h1>Bienvenido</h1>
          <p>Seleccione el sistema que desea utilizar:</p>
          <div className="mode-options">
            <button 
              className={`mode-button notas ${(appMode as string) === 'notas' ? 'active-glow' : ''}`}
              onClick={() => handleModeSelection("notas")}
            >
              <span className="mode-icon glow-icon-notas">📝</span>
              <span className="mode-text">Gestión de Notas Escolares</span>
            </button>
            <button 
              className={`mode-button asistencia ${(appMode as string) === 'asistencia' ? 'active-glow' : ''}`}
              onClick={() => handleModeSelection("asistencia")}
            >
              <span className="mode-icon glow-icon-asistencia">✅</span>
              <span className="mode-text">Asistencia Escolar</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-layout mode-${appMode}`} style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}>
      <nav className="sidebar">
        <div className="sidebar-header-integrated" onClick={toggleAppMode} title={appMode === "notas" ? "Cambiar a Asistencia" : "Cambiar a Notas"}>
          <div className="mode-badge">
            {appMode === "notas" ? (
              <>
                <span className="glow-icon-notas">📝</span>
                <div className="mode-info">
                  <span className="mode-label">MODO</span>
                  <span className="mode-name">NOTAS</span>
                </div>
              </>
            ) : (
              <>
                <span className="glow-icon-asistencia">✅</span>
                <div className="mode-info">
                  <span className="mode-label">MODO</span>
                  <span className="mode-name">ASISTENCIA</span>
                </div>
            </>
            )}
          </div>
          <div className="mode-switch-indicator">
            <span>🔄</span>
          </div>
        </div>
        <div className="sidebar-nav">
          {appMode === "notas" ? (
            <>
              <button 
                className={`sidebar-button ${activeTab === "notas" ? "active" : ""}`} 
                onClick={() => handleTabChange("notas")}
              >
                <span>📊</span>
                <span>Notas</span>
              </button>
              <button 
                className={`sidebar-button ${activeTab === "reportes" ? "active" : ""}`} 
                onClick={() => handleTabChange("reportes")}
              >
                <span>📋</span>
                <span>Reportes</span>
              </button>
              <button 
                className={`sidebar-button ${activeTab === "estudiantes" ? "active" : ""}`} 
                onClick={() => handleTabChange("estudiantes")}
              >
                <span>👨‍🎓</span>
                <span>Estudiantes</span>
              </button>
              <button 
                className={`sidebar-button ${activeTab === "evaluaciones" ? "active" : ""}`} 
                onClick={() => handleTabChange("evaluaciones")}
              >
                <span>📝</span>
                <span>Evaluaciones</span>
              </button>
            </>
          ) : (
            <>
              <button 
                className={`sidebar-button ${activeTab === "asistencia" ? "active" : ""}`} 
                onClick={() => handleTabChange("asistencia")}
              >
                <span>📅</span>
                <span>Asistencia</span>
              </button>
              <button 
                className={`sidebar-button ${activeTab === "informe" ? "active" : ""}`} 
                onClick={() => handleTabChange("informe")}
              >
                <span>📊</span>
                <span>Informe</span>
              </button>
            </>
          )}
          
          <button 
            className={`sidebar-button ${activeTab === "globales" ? "active" : ""}`} 
            onClick={() => handleTabChange("globales")}
          >
            <span>🌐</span>
            <span>Globales</span>
          </button>
          
          {appMode === "asistencia" && (
            <button 
              className={`sidebar-button ${activeTab === "estudiantes" ? "active" : ""}`} 
              onClick={() => handleTabChange("estudiantes")}
            >
              <span>👨‍🎓</span>
              <span>Estudiantes</span>
            </button>
          )}

          <button 
            className={`sidebar-button ${activeTab === "ajustes" ? "active" : ""}`} 
            onClick={() => handleTabChange("ajustes")}
          >
            <span>⚙️</span>
            <span>Ajustes</span>
          </button>
        </div>
      </nav>

      <div 
        className={`resizer ${isResizing ? "resizing" : ""}`} 
        onMouseDown={startResizing}
      />

      <main className="main-content">
        {appMode === "notas" ? (
          <>
            {renderTab("notas", <NotasPage />)}
            {renderTab("reportes", <ReportesPage />)}
            {renderTab("estudiantes", <EstudiantesPage />)}
            {renderTab("evaluaciones", <EvaluacionesPage />)}
          </>
        ) : (
          <>
            {renderTab("asistencia", <AsistenciaPage />)}
            {renderTab("informe", <InformePage />)}
          </>
        )}
        {renderTab("globales", <GlobalesPage />)}
        {appMode === "asistencia" && renderTab("estudiantes", <EstudiantesPage />)}
        {renderTab("ajustes", <AjustesPage />)}
      </main>

      {/* Toast Notification */}
      {toast.isOpen && (
        <div className={`toast-notification ${toast.type}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {toast.type === 'success' && '✅'}
              {toast.type === 'error' && '❌'}
              {toast.type === 'info' && 'ℹ️'}
            </span>
            <span className="toast-message">{toast.message}</span>
          </div>
          <div className="toast-progress"></div>
        </div>
      )}
    </div>
  );
}

export default App;
