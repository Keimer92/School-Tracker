import { useState, useEffect, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { useIsMobile } from "./hooks/useAndroid";
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

type Tab = "notas" | "reportes" | "estudiantes" | "evaluaciones" | "globales" | "ajustes" | "asistencia" | "informe";

function App() {
  const [appMode] = useState<string>("unified");

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const savedTab = localStorage.getItem('active-tab') as Tab;
    if (appMode === "asistencia") return "asistencia";
    return savedTab || "notas";
  });
  
const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => {
  const saved = localStorage.getItem('visited-tabs');
  // Siempre incluir todas las tabs por defecto para que se muestren en Android
  const defaultTabs: Tab[] = ["notas", "reportes", "estudiantes", "evaluaciones", "globales", "ajustes", "asistencia", "informe"];
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const active = (localStorage.getItem('active-tab') as Tab) || "notas";
      return new Set([...parsed, active]);
    } catch (e) {
      return new Set(defaultTabs);
    }
  }
  return new Set(defaultTabs);
});

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved) : 260;
  });

const isMobile = useIsMobile();
const [drawerOpen, setDrawerOpen] = useState(false);
const drawerRef = useRef<HTMLDivElement>(null);

const toggleDrawer = () => setDrawerOpen(prev => !prev);
const closeDrawer = () => setDrawerOpen(false);

// Aplicar safe areas en dispositivos móviles
useEffect(() => {
  if (!isMobile) return;

  // Función para aplicar los inset de manera forzada
  const applySafeAreas = () => {
    // Calcular el espacio usado por la barra de estado y navegación
    const windowHeight = window.innerHeight;
    const visualHeight = window.visualViewport?.height || windowHeight;
    const offsetTop = window.visualViewport?.offsetTop || 0;
    
    // La barra de abajo es la diferencia
    const bottomInset = Math.max(0, windowHeight - visualHeight - offsetTop);
    // La barra de arriba
    const topInset = Math.max(0, offsetTop);
    
    // Aplicar directamente al body
    document.body.style.setProperty('--system-bottom', `${bottomInset}px`);
    document.body.style.setProperty('--system-top', `${topInset}px`);
    
    console.log('Safe areas - Top:', topInset, 'Bottom:', bottomInset);
  };

  // Aplicar inmediatamente
  applySafeAreas();

  // Aplicar cuando cambie el viewport visual
  if (window.visualViewport) {
    const handleResize = () => requestAnimationFrame(applySafeAreas);
    window.visualViewport.addEventListener('resize', handleResize);
    
    // También cuando cambie el window
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleResize);
    };
  }
}, [isMobile]);



  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        closeDrawer();
      }
    };
    if (drawerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [drawerOpen]);

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
    console.log('Tab change:', tab, 'isMobile:', isMobile);
    setActiveTab(tab);
    setVisitedTabs(prev => new Set(prev).add(tab));
    if (isMobile) {
      closeDrawer();
    }
  };

  const handleButtonClick = (tab: Tab) => {
    handleTabChange(tab);
    if (isMobile) {
      closeDrawer();
    }
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

  return (
    <div 
      className="app-layout" 
      style={{ 
        gridTemplateColumns: isMobile ? '0px 0px 1fr' : `${sidebarWidth}px 4px 1fr`,
        paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0
      }}
    >
      {isMobile && (
        <div className="mobile-header">
          {!drawerOpen && (
            <button className="mobile-menu-btn" onClick={toggleDrawer}>
              <span>☰</span>
            </button>
          )}
          <span className="mobile-title">School Tracker</span>
        </div>
      )}
      {isMobile && drawerOpen && <div className="drawer-backdrop" onClick={closeDrawer} />}
      <nav 
        className={`sidebar ${isMobile ? 'drawer' : ''} ${drawerOpen ? 'open' : ''}`} 
        ref={drawerRef}
        onClick={(e) => e.stopPropagation()}
        style={{ pointerEvents: 'auto' }}
      >
        <div className="sidebar-header-integrated">
          <div className="mode-badge">
            <span className="glow-icon-notas">📚</span>
            <div className="mode-info">
              <span className="mode-label">SCHOOL</span>
              <span className="mode-name">TRACKER</span>
              <span className="mode-pro">PRO</span>
            </div>
          </div>
          {isMobile && (
            <button className="drawer-close-btn" onClick={closeDrawer}>✕</button>
          )}
        </div>
        <div className="sidebar-nav">
          <div className="sidebar-section-header">ASISTENCIA</div>
          <button 
            className={`sidebar-button ${activeTab === "asistencia" ? "active" : ""}`} 
            onClick={() => handleButtonClick("asistencia")}
            type="button"
          >
            <span>📅</span>
            <span>Asistencia</span>
          </button>
          <button 
            className={`sidebar-button ${activeTab === "informe" ? "active" : ""}`} 
            onClick={() => handleButtonClick("informe")}
            type="button"
          >
            <span>📊</span>
            <span>Informe</span>
          </button>

          <div className="sidebar-section-header">NOTAS</div>
          <button 
            className={`sidebar-button ${activeTab === "notas" ? "active" : ""}`} 
            onClick={() => handleButtonClick("notas")}
            type="button"
          >
            <span>📊</span>
            <span>Notas</span>
          </button>
          <button 
            className={`sidebar-button ${activeTab === "reportes" ? "active" : ""}`} 
            onClick={() => handleButtonClick("reportes")}
            type="button"
          >
            <span>📋</span>
            <span>Reportes</span>
          </button>
          <button 
            className={`sidebar-button ${activeTab === "evaluaciones" ? "active" : ""}`} 
            onClick={() => handleButtonClick("evaluaciones")}
            type="button"
          >
            <span>📝</span>
            <span>Evaluaciones</span>
          </button>
          <button 
            className={`sidebar-button ${activeTab === "estudiantes" ? "active" : ""}`} 
            onClick={() => handleButtonClick("estudiantes")}
            type="button"
          >
            <span>👨‍🎓</span>
            <span>Estudiantes</span>
          </button>

          <div className="sidebar-section-header">GENERALES</div>
          <button 
            className={`sidebar-button ${activeTab === "globales" ? "active" : ""}`} 
            onClick={() => handleButtonClick("globales")}
            type="button"
          >
            <span>🌐</span>
            <span>Globales</span>
          </button>
          <button 
            className={`sidebar-button ${activeTab === "ajustes" ? "active" : ""}`} 
            onClick={() => handleButtonClick("ajustes")}
            type="button"
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
        {renderTab("asistencia", <AsistenciaPage />)}
        {renderTab("informe", <InformePage />)}
        {renderTab("notas", <NotasPage />)}
        {renderTab("reportes", <ReportesPage />)}
        {renderTab("evaluaciones", <EvaluacionesPage />)}
        {renderTab("estudiantes", <EstudiantesPage />)}
        {renderTab("globales", <GlobalesPage />)}
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
