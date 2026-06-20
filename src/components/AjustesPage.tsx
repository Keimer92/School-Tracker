import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { copyFile, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import * as XLSX from "xlsx";
import { Auth } from "./Auth";
import { syncService, syncManager, SyncStatus } from "../lib/syncService";
import { cloud } from "../lib/cloud/CloudBridge";
import { reconnect as pbReconnect, getPocketBaseUrl, savePocketBaseUrl } from "../lib/pocketbase";
import { GoogleDriveBackup } from "./GoogleDriveBackup";
import "../App.css";

interface CategoryItem {
  id: number;
  nombre: string;
  activo?: boolean;
}

export function AjustesPage() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const [activeTab, setActiveTab] = useState<
    | "configuracion"
    | "apariencia"
    | "calificaciones"
    | "sync"
    | "google-drive"
    | "almacenamiento"
    | "debugging"
    | "acercaDe"
    | null
  >(isAndroid ? null : "configuracion");
  const [theme, setTheme] = useState<string>(() => {
    return localStorage.getItem("app-theme") || "mint";
  });
  const [dbPath, setDbPath] = useState<string>("");
  const [gradeConfigs, setGradeConfigs] = useState<
    { id: string; nombre: string; color: string; minimo: number }[]
  >([]);
  const [highlightColor, setHighlightColor] = useState<string>(() => {
    return localStorage.getItem("student-highlight-color") || "#4ade80";
  });
  const [orientation, setOrientation] = useState<string>(() => {
    return localStorage.getItem("app-orientation") || "any";
  });
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [showUserIdBox, setShowUserIdBox] = useState<boolean>(false);

  // Catalogs for export
  const [anos, setAnos] = useState<CategoryItem[]>([]);
  const [colegios, setColegios] = useState<CategoryItem[]>([]);
  const [selectedAno, setSelectedAno] = useState<number>(0);
  const [selectedColegio, setSelectedColegio] = useState<number>(0);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingByYear, setIsExportingByYear] = useState(false);

  const [isSynced, setIsSynced] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    status: SyncStatus;
    lastSync: string | null;
    lastSyncDetails: string | null;
    message: string | null;
  }>({
    status: "idle",
    lastSync: null,
    lastSyncDetails: null,
    message: null,
  });
  const [showServerConfig, setShowServerConfig] = useState(false);

  const [pbUrl, setPbUrl] = useState(getPocketBaseUrl);
  const [pbTesting, setPbTesting] = useState(false);
  const [pbStatus, setPbStatus] = useState<'idle' | 'online' | 'offline'>('idle');
  const [pbLatency, setPbLatency] = useState<number | null>(null);
  const [syncInterval, setSyncInterval] = useState(() => {
    return parseInt(localStorage.getItem('periodic_sync_interval_seconds') || '10', 10);
  });
  
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfig, setResetConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    isDanger?: boolean;
  } | null>(null);
  const [isProcessingReset, setIsProcessingReset] = useState(false);

  useEffect(() => {
    const unsubscribe = syncManager.subscribe((state) => {
      setSyncStatus(state);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const provider = cloud.getProvider();
    const unsubscribe = provider.onAuthStateChange((user) => {
      setIsSynced(!!user);
    });

    provider.getUser().then((user) => {
      setIsSynced(!!user);
    });

    return () => unsubscribe();
  }, []);

  const getGradeLabel = (id: string) => {
    const labels: Record<string, string> = {
      // Nuevos IDs estándar
      'AA': 'Aprendizaje Avanzado',
      'AS': 'Aprendizaje Satisfactorio',
      'AF': 'Aprendizaje Fundamental',
      'AI': 'Aprendizaje Inicial',
    };
    return labels[id] || id;
  };

  // Mostrar código y nombre juntos
  const getGradeDisplayName = (id: string) => {
    const label = getGradeLabel(id);
    // Si tenemos el mapeo, mostrar "AA: Aprendizaje Avanzado"
    // Si no, mostrar solo el ID
    return label !== id ? `${id}: ${label}` : id;
  };

  const PRESET_COLORS = [
    "#000000",
    "#7f7f7f",
    "#880015",
    "#ed1c24",
    "#ff7f27",
    "#fff200",
    "#22b14c",
    "#00a2e8",
    "#3f48cc",
    "#a349a4",
    "#ffffff",
    "#c3c3c3",
    "#b97a57",
    "#ffaec9",
    "#ffc90e",
    "#efe4b0",
    "#b5e61d",
    "#99d9ea",
    "#7092be",
    "#c8bfe7",
    "#C00000",
    "#FF0000",
    "#FFC000",
    "#FFFF00",
    "#92D050",
    "#00B050",
    "#00B0F0",
    "#0070C0",
    "#002060",
    "#7030A0",
  ];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  useEffect(() => {
    const fetchGradeConfigs = async () => {
      try {
        console.log("Fetching grade configs...");
        const configs =
          await invoke<{ id: string; nombre: string; color: string; minimo: number }[]>(
            "get_grade_configs",
          );
        console.log("Grade configs fetched:", configs);
        setGradeConfigs(configs);
      } catch (error) {
        console.error("Error fetching grade configs:", error);
      }
    };
    fetchGradeConfigs();
  }, []);

  useEffect(() => {
    const fetchDbPath = async () => {
      try {
        const path = await invoke<string>("get_db_path");
        setDbPath(path);
      } catch (error) {
        console.error("Error fetching db path:", error);
      }
    };
    fetchDbPath();
  }, []);

  const handleUpdateGradeConfig = async (
    id: string,
    nombre: string,
    color: string,
    minimo: number,
  ) => {
    let validatedMinimo = minimo;
    if (id !== "AI") {
      if (minimo < 0) validatedMinimo = 0;
      if (minimo > 100) validatedMinimo = 100;
    } else {
      validatedMinimo = 0;
    }

    try {
      await invoke("update_grade_config", {
        id,
        nombre,
        color,
        minimo: validatedMinimo,
      });
      setGradeConfigs((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, nombre, color, minimo: validatedMinimo } : c,
        ),
      );
      syncService.syncGradeConfig({ id, color, minimo: validatedMinimo });
      await emit("grade-configs-updated");
    } catch (error) {
      console.error("Error updating grade config:", error);
      await emit("show-toast", {
        message: "❌ Error al actualizar la configuración: " + error,
        type: "error",
      });
    }
  };

  const handleUpdateHighlightColor = (color: string) => {
    setHighlightColor(color);
    localStorage.setItem("student-highlight-color", color);
    emit("highlight-color-updated", color);
  };

  const handleUpdateOrientation = async (newOrientation: string) => {
    setOrientation(newOrientation);
    localStorage.setItem("app-orientation", newOrientation);

    if (/Android/i.test(navigator.userAgent)) {
      try {
        try {
          const lockType =
            newOrientation === "portrait"
              ? "portrait-primary"
              : newOrientation === "landscape"
                ? "landscape-primary"
                : "any";

          if (lockType === "any") {
            (screen.orientation as any).unlock?.();
          } else {
            await (screen.orientation as any).lock?.(lockType).catch(() => {});
          }
        } catch (e) {}
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_orientation", { orientation: newOrientation });
      } catch (error) {
        console.error("Error al cambiar orientación:", error);
      }
    }
  };

  const handleExportDB = async () => {
    try {
      const dbFile = await invoke<string>("get_db_path");
      if (isAndroid) {
        const suggestedName = `backup_notas_${new Date().getTime()}.sqlite`;
        await copyFile(dbFile, suggestedName, {
          toPathBaseDir: BaseDirectory.Download,
        });
        await emit("show-toast", {
          message:
            "✅ Base de datos exportada exitosamente a la carpeta de Descargas",
          type: "success",
        });
        return;
      }
      const destination = await save({
        filters: [{ name: "Database File", extensions: ["db"] }],
        defaultPath: "backup_notas.db",
      });
      if (destination) {
        await copyFile(dbFile, destination);
        await emit("show-toast", {
          message: "✅ Base de datos exportada exitosamente",
          type: "success",
        });
      }
    } catch (error) {
      console.error("Error al exportar:", error);
      await emit("show-toast", {
        message: "❌ Error al exportar la base de datos: " + error,
        type: "error",
      });
    }
  };

  const handleImportDB = async () => {
    try {
      const source = await open({
        filters: [{ name: "Database File", extensions: ["db"] }],
        multiple: false,
      });
      if (source && typeof source === "string") {
        const dbFile = await invoke<string>("get_db_path");
        await copyFile(source, dbFile);
        await emit("show-toast", {
          message:
            "✅ Base de datos importada exitosamente. Por favor, reinicie la aplicación para ver los cambios.",
          type: "success",
        });
      }
    } catch (error) {
      console.error("Error al importar:", error);
      await emit("show-toast", {
        message: "❌ Error al importar la base de datos: " + error,
        type: "error",
      });
    }
  };

  const handleResetLocalDB = () => {
    setResetConfig({
      title: "⚠️ Reiniciar Base de Datos Local",
      message:
        "¿Estás SEGURO de que quieres reiniciar la base de datos LOCAL?\n\nSe borrarán todos los estudiantes, notas, asistencias y configuraciones de esta computadora.\nEsta acción no se puede deshacer.",
      isDanger: true,
      onConfirm: async () => {
        try {
          await invoke("reset_local_database");
          await emit("catalog-updated");
          await emit("show-toast", {
            message: "✅ Base de datos local reiniciada correctamente.",
            type: "success",
          });
        } catch (error) {
          console.error("Error al reiniciar DB local:", error);
          await emit("show-toast", {
            message: "❌ Error al reiniciar base de datos local: " + error,
            type: "error",
          });
        }
      },
    });
    setShowResetConfirm(true);
  };

  const handleResetRemoteDB = () => {
    setResetConfig({
      title: "🚨 Limpiar Datos en Sync",
      message:
        "¡ATENCIÓN! ¿Estás SEGURO de que quieres limpiar los datos sincronizados?\n\nSe borrarán PERMANENTEMENTE todos tus datos en el servidor.\nTus datos locales no se verán afectados.",
      isDanger: true,
      onConfirm: async () => {
        try {
          await syncService.wipeRemoteData();
          await emit("show-toast", {
            message: "✅ Datos en la nube eliminados correctamente.",
            type: "success",
          });
        } catch (error) {
          console.error("Error al limpiar nube:", error);
          await emit("show-toast", {
            message: "❌ Error al limpiar datos remotos.",
            type: "error",
          });
        }
      },
    });
    setShowResetConfirm(true);
  };

  const showUserId = async () => {
    const userId = await syncService.getUserId();
    setCurrentUserId(userId || 'No conectado');
    setShowUserIdBox(true);
  };

  const copyUserId = async () => {
    if (currentUserId && currentUserId !== 'No conectado') {
      await navigator.clipboard.writeText(currentUserId);
      emit("show-toast", {
        message: "User ID copiado al portapapeles",
        type: "success"
      });
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        await emit("show-toast", {
          message: "📁 Carpeta seleccionada: " + selected,
          type: "info",
        });
      }
    } catch (error) {
      console.error("Error al seleccionar carpeta:", error);
    }
  };

  useEffect(() => {
    const fetchCatalogs = async () => {
      try {
        const [aData, cData] = await Promise.all([
          invoke<CategoryItem[]>("get_anos"),
          invoke<CategoryItem[]>("get_colegios"),
        ]);
        setAnos(aData);
        setColegios(cData);

        const activeYear = aData.find((a) => a.activo) || aData[0];
        if (activeYear) setSelectedAno(activeYear.id);

        const activeColegio = cData.find((c) => c.activo) || cData[0];
        if (activeColegio) setSelectedColegio(activeColegio.id);
      } catch (error) {
        console.error("Error fetching catalogs:", error);
      }
    };
    fetchCatalogs();
  }, []);

  const handleExportStudentsToExcel = async () => {
    if (!selectedAno || !selectedColegio) {
      await emit("show-toast", {
        message: "⚠️ Por favor seleccione año y colegio",
        type: "warning",
      });
      return;
    }

    setIsExportingExcel(true);
    try {
      const students = await invoke<any[]>("get_students");
      const filteredStudents = students.filter(
        (s) =>
          Number(s.anoLectivoId) === Number(selectedAno) &&
          Number(s.colegioId) === Number(selectedColegio),
      );

      if (filteredStudents.length === 0) {
        await emit("show-toast", {
          message: "ℹ️ No hay estudiantes para exportar en esta selección",
          type: "info",
        });
        setIsExportingExcel(false);
        return;
      }

      // Fetch catalogs to resolve names
      const [grados, secciones] = await Promise.all([
        invoke<CategoryItem[]>("get_grados"),
        invoke<CategoryItem[]>("get_secciones"),
      ]);

      const excelData = filteredStudents.map((s) => ({
        "Nombre Completo": s.nombre,
        Sexo: s.sexo === "F" ? "Femenino" : "Masculino",
        Grado: grados.find((g) => g.id === s.gradoId)?.nombre || "N/A",
        Sección:
          secciones.find((sec) => sec.id === s.seccionId)?.nombre || "N/A",
        Teléfono: s.telefono || "",
        Email: s.email || "",
        Dirección: s.direccion || "",
      }));

      // Senior sorting: Natural order for Grades (1ro, 2do, 10mo), then Section, then Name
      excelData.sort((a, b) => {
        const gradeSort = a.Grado.localeCompare(b.Grado, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (gradeSort !== 0) return gradeSort;

        const sectionSort = a.Sección.localeCompare(b.Sección, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (sectionSort !== 0) return sectionSort;

        return a["Nombre Completo"].localeCompare(
          b["Nombre Completo"],
          undefined,
          { sensitivity: "base" },
        );
      });

      const ws = XLSX.utils.json_to_sheet(excelData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Estudiantes");

      const colegioName =
        colegios.find((c) => c.id === selectedColegio)?.nombre || "Colegio";
      const anoName = anos.find((a) => a.id === selectedAno)?.nombre || "Año";
      const fileName = `Estudiantes_${colegioName.replace(/\s+/g, "_")}_${anoName}.xlsx`;

      // Unified export logic using system file picker
      const destination = await save({
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
        defaultPath: fileName,
      });

      if (destination) {
        const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        await writeFile(destination, new Uint8Array(excelBuffer));
        await emit("show-toast", {
          message: "✅ Exportación a Excel exitosa",
          type: "success",
        });
      }
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      await emit("show-toast", {
        message: "❌ Error al exportar: " + error,
        type: "error",
      });
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportStudentsByYear = async () => {
    if (!selectedAno) {
      await emit("show-toast", {
        message: "⚠️ Por favor seleccione un año lectivo",
        type: "warning",
      });
      return;
    }

    setIsExportingByYear(true);
    try {
      const students = await invoke<any[]>("get_students");
      const filteredStudents = students.filter(
        (s) => Number(s.anoLectivoId) === Number(selectedAno),
      );

      if (filteredStudents.length === 0) {
        await emit("show-toast", {
          message: "ℹ️ No hay estudiantes para exportar en este año lectivo",
          type: "info",
        });
        setIsExportingByYear(false);
        return;
      }

      // Fetch catalogs to resolve names
      const [grados, secciones, colegiosList] = await Promise.all([
        invoke<CategoryItem[]>("get_grados"),
        invoke<CategoryItem[]>("get_secciones"),
        invoke<CategoryItem[]>("get_colegios"),
      ]);

      // Group students by colegio
      const studentsByColegio = filteredStudents.reduce((acc, student) => {
        const colegioName = colegiosList.find((c) => c.id === student.colegioId)?.nombre || "Sin_Colegio";
        const safeColegioName = colegioName.replace(/[\\/*?:\[\]]/g, "_"); // Clean invalid sheet chars
        if (!acc[safeColegioName]) {
          acc[safeColegioName] = [];
        }
        acc[safeColegioName].push({
          ...student,
          colegioNombre: colegioName,
        });
        return acc;
      }, {} as Record<string, typeof filteredStudents>);

      // Create workbook
      const wb = XLSX.utils.book_new();

      // Create a sheet for each colegio
      Object.entries(studentsByColegio).forEach(([colegioSheetName, colegioStudents]) => {
        const students = colegioStudents as typeof filteredStudents;
        
        // Sort students: Natural order for Grades (1ro, 2do, 10mo), then Section, then Name
        students.sort((a, b) => {
          const gradeA = grados.find((g) => g.id === a.gradoId)?.nombre || "";
          const gradeB = grados.find((g) => g.id === b.gradoId)?.nombre || "";
          const gradeSort = gradeA.localeCompare(gradeB, undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (gradeSort !== 0) return gradeSort;

          const sectionA = secciones.find((sec) => sec.id === a.seccionId)?.nombre || "";
          const sectionB = secciones.find((sec) => sec.id === b.seccionId)?.nombre || "";
          const sectionSort = sectionA.localeCompare(sectionB, undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (sectionSort !== 0) return sectionSort;

          return a.nombre.localeCompare(b.nombre, undefined, { sensitivity: "base" });
        });

        const excelData = students.map((s) => ({
          "Nombre Completo": s.nombre,
          Sexo: s.sexo === "F" ? "Femenino" : "Masculino",
          Grado: grados.find((g) => g.id === s.gradoId)?.nombre || "N/A",
          Sección:
            secciones.find((sec) => sec.id === s.seccionId)?.nombre || "N/A",
          Teléfono: s.telefono || "",
          Email: s.email || "",
          Dirección: s.direccion || "",
        }));

        const ws = XLSX.utils.json_to_sheet(excelData);
        
        // Set column widths
        ws['!cols'] = [
          { wch: 35 }, // Nombre
          { wch: 12 }, // Sexo
          { wch: 20 }, // Grado
          { wch: 15 }, // Sección
          { wch: 15 }, // Teléfono
          { wch: 30 }, // Email
          { wch: 30 }, // Dirección
        ];

        // Limit sheet name to 31 chars (Excel limit)
        const sheetName = colegioSheetName.length > 31 
          ? colegioSheetName.substring(0, 31) 
          : colegioSheetName;
        
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      const anoName = anos.find((a) => a.id === selectedAno)?.nombre || "Año";
      const fileName = `Todos_Estudiantes_${anoName.replace(/\s+/g, "_")}.xlsx`;

      // Unified export logic using system file picker
      const destination = await save({
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
        defaultPath: fileName,
      });

      if (destination) {
        const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        await writeFile(destination, new Uint8Array(excelBuffer));
        await emit("show-toast", {
          message: `✅ Exportación exitosa de ${filteredStudents.length} estudiantes en ${Object.keys(studentsByColegio).length} colegios`,
          type: "success",
        });
      }
    } catch (error) {
      console.error("Error exporting to Excel by year:", error);
      await emit("show-toast", {
        message: "❌ Error al exportar: " + error,
        type: "error",
      });
    } finally {
      setIsExportingByYear(false);
    }
  };

  const TABS = [
    { id: "configuracion", label: "General", icon: "⚙️" },
    { id: "apariencia", label: "Diseño", icon: "🎨" },
    { id: "calificaciones", label: "Notas", icon: "⭐" },
    { id: "sync", label: "Sync", icon: "cloud" },
    { id: "google-drive", label: "Drive", icon: "☁️" },
    { id: "almacenamiento", label: "Almacén", icon: "📦" },
    { id: "debugging", label: "Debug", icon: "🐛" },
    { id: "acercaDe", label: "Info", icon: "📖" },
  ] as const;

  return (
    <div className="page-container" style={{ display: "block" }}>
      <style>{`
        .ajustes-ribbon-container {
          position: sticky;
          top: 0;
          z-index: 1000;
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          margin: 0 -1rem 1.5rem -1rem;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .ajustes-ribbon-container::-webkit-scrollbar { display: none; }
        .ajustes-ribbon {
          display: flex;
          padding: 0.5rem;
          gap: 0.4rem;
          min-width: max-content;
        }
        .ajustes-tab {
          padding: 0.6rem 1.2rem;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: #94a3b8;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .ajustes-tab.active {
          color: white;
          background: rgba(var(--primary-rgb, 59, 130, 246), 0.2);
          box-shadow: 0 0 10px rgba(var(--primary-rgb, 59, 130, 246), 0.1);
          border-bottom: 2px solid var(--primary-color, #3b82f6);
        }
        .ajustes-tab:hover:not(.active) {
          background: rgba(255, 255, 255, 0.05);
          color: #e2e8f0;
        }
        .sync-dot-mini {
          width: 6px;
          height: 6px;
          background: #4ade80;
          border-radius: 50%;
          box-shadow: 0 0 5px #4ade80;
          flex-shrink: 0;
        }
        
        .tab-label {
          display: inline-block;
          transition: all 0.3s ease;
        }

        @media (max-width: 1024px) {
          .ajustes-ribbon-container {
            margin: 0 -1rem 1.5rem -1rem !important;
            overflow: hidden !important;
            border-radius: 0 !important;
          }
          .ajustes-ribbon {
            display: flex !important;
            justify-content: space-around !important;
            padding: 0.5rem !important;
            gap: 4px !important;
            min-width: 0 !important;
            width: 100% !important;
          }
          .ajustes-tab {
            padding: 0.6rem 0.5rem !important;
            flex: 0 1 auto !important;
            justify-content: center !important;
            border-radius: 12px !important;
            gap: 0 !important;
            transition: all 0.2s ease-in-out !important;
            position: relative !important;
          }
          .ajustes-tab .tab-label {
            display: none !important;
          }
          .ajustes-tab.active {
            flex: 1 1 auto !important;
            background: rgba(var(--primary-rgb, 59, 130, 246), 0.15) !important;
            border-bottom: 2px solid var(--primary-color, #3b82f6) !important;
            gap: 0.4rem !important;
            padding: 0.6rem 1rem !important;
          }
          .ajustes-tab.active .tab-label {
            display: inline-block !important;
            font-size: 0.85rem !important;
            white-space: nowrap !important;
          }
          .sync-dot-mini {
            position: absolute !important;
            top: 6px;
            right: 6px;
            width: 8px !important;
            height: 8px !important;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(1.1); }
          }
        }
      `}</style>

      {/* Cinta de Pestañas Inteligente */}
      {!isAndroid && (
        <div className="ajustes-ribbon-container">
        <div className="ajustes-ribbon">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`ajustes-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon === "cloud" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <defs>
                    <linearGradient id="cloudGrad" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#60A5FA"/>
                      <stop offset="1" stopColor="#A78BFA"/>
                    </linearGradient>
                  </defs>
                </svg>
              ) : (
                <span style={{ fontSize: "1.1rem" }}>{tab.icon}</span>
              )}
              <span className="tab-label">{tab.label}</span>
              {tab.id === "sync" && isSynced && (
                <span className="sync-dot-mini"></span>
              )}
            </button>
          ))}
        </div>
      </div>
      )}

      {isAndroid && activeTab === null ? (
        <div style={{
          padding: '1rem',
        }}>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: '700',
            color: '#f1f5f9',
            marginBottom: '1.5rem',
            textAlign: 'center',
          }}>
            Ajustes
          </h1>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1rem 1.25rem',
                  background: 'rgba(51, 65, 85, 0.5)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(51, 65, 85, 0.7)';
                  e.currentTarget.style.transform = 'translateX(4px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(51, 65, 85, 0.5)';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                }}>
                  <div style={{
                    width: '4px',
                    height: '40px',
                    background: 'linear-gradient(180deg, var(--primary-color, #3b82f6) 0%, #1d4ed8 100%)',
                    borderRadius: '2px',
                  }} />
                  {tab.icon === "cloud" ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                      <path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGradMenu)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <defs>
                        <linearGradient id="cloudGradMenu" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#60A5FA"/>
                          <stop offset="1" stopColor="#A78BFA"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  ) : (
                    <span style={{ fontSize: '1.25rem' }}>{tab.icon}</span>
                  )}
                  <span style={{
                    fontSize: '1rem',
                    fontWeight: '600',
                    color: '#e2e8f0',
                    textAlign: 'left',
                  }}>
                    {tab.label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {tab.id === "sync" && isSynced && (
                    <span className="sync-dot-mini" style={{ position: 'static', display: 'inline-block' }}></span>
                  )}
                  <span style={{
                    fontSize: '1.25rem',
                    color: '#64748b',
                  }}>
                    →
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: isAndroid ? '1rem' : '0' }}>
          {isAndroid && activeTab !== null && (
            <button
              onClick={() => setActiveTab(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: 'rgba(51, 65, 85, 0.5)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px',
                cursor: 'pointer',
                marginBottom: '1.5rem',
                width: '100%',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(51, 65, 85, 0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(51, 65, 85, 0.5)';
              }}
            >
              <span style={{ fontSize: '1.25rem' }}>←</span>
              <span style={{
                fontSize: '0.95rem',
                fontWeight: '600',
                color: '#94a3b8',
              }}>
                Volver a Ajustes
              </span>
            </button>
          )}

          <div className="settings-content-wrapper">
        {/* SECCIÓN: CONFIGURACIÓN */}
        {activeTab === "configuracion" && (
          <div className="category-card">
            <div className="category-header">
              <h3>⚙️ Configuración del Sistema</h3>
            </div>
            <div style={{ padding: isAndroid ? "1rem" : "2rem" }}>
              <div style={{ marginBottom: "2rem" }}>
                <h4 style={{ margin: "0 0 1rem 0", color: "#e2e8f0" }}>
                  Personalización de Tabla de Notas
                </h4>
                <p
                  style={{
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                    marginBottom: "1.5rem",
                  }}
                >
                  Configura el color de resaltado para el estudiante
                  seleccionado en la página de notas.
                </p>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: "1.5rem",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: isAndroid ? "column" : "row",
                      alignItems: isAndroid ? "stretch" : "center",
                      justifyContent: "space-between",
                      gap: isAndroid ? "1rem" : "2rem",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <h5 style={{ margin: "0 0 0.5rem 0", color: "#e2e8f0" }}>
                        Color de Resaltado
                      </h5>
                      <p
                        style={{
                          color: "#94a3b8",
                          fontSize: "0.85rem",
                          margin: 0,
                        }}
                      >
                        Este color se usará para destacar al estudiante y su
                        fila cuando estés editando sus notas.
                      </p>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "1rem",
                      }}
                    >
                      <div
                        style={{
                          width: "45px",
                          height: "45px",
                          borderRadius: "8px",
                          backgroundColor: highlightColor,
                          border: "2px solid rgba(255,255,255,0.2)",
                          cursor: "pointer",
                          position: "relative",
                          overflow: "hidden",
                        }}
                        onClick={() =>
                          document
                            .getElementById("highlight-color-picker")
                            ?.click()
                        }
                      >
                        <input
                          id="highlight-color-picker"
                          type="color"
                          value={highlightColor}
                          onChange={(e) =>
                            handleUpdateHighlightColor(e.target.value)
                          }
                          style={{
                            position: "absolute",
                            top: "-10px",
                            left: "-10px",
                            width: "200%",
                            height: "200%",
                            opacity: 0,
                            cursor: "pointer",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontFamily: "monospace",
                          color: "#94a3b8",
                          fontSize: "0.9rem",
                        }}
                      >
                        {highlightColor.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginTop: "1.5rem",
                    }}
                  >
                    {PRESET_COLORS.map((preset) => (
                      <button
                        key={preset}
                        onClick={() => handleUpdateHighlightColor(preset)}
                        style={{
                          width: "24px",
                          height: "24px",
                          backgroundColor: preset,
                          border:
                            highlightColor.toLowerCase() ===
                            preset.toLowerCase()
                              ? "2px solid white"
                              : "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          cursor: "pointer",
                          padding: 0,
                        }}
                        title={preset}
                      />
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: "2rem",
                    background: "rgba(255,255,255,0.03)",
                    padding: "1rem",
                    borderRadius: "8px",
                    border: "1px dotted rgba(255,255,255,0.1)",
                  }}
                >
                  <h5
                    style={{
                      margin: "0 0 0.5rem 0",
                      color: "#e2e8f0",
                      fontSize: "0.9rem",
                    }}
                  >
                    Vista Previa
                  </h5>
                  <div
                    style={{
                      background: "rgba(15, 23, 42, 0.5)",
                      padding: "1rem",
                      borderRadius: "6px",
                      border: "1px solid rgba(255,255,255,0.05)",
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <div
                      style={{
                        padding: "0.4rem 0.8rem",
                        borderRadius: "4px",
                        background: `${highlightColor}1a`,
                        borderLeft: `4px solid ${highlightColor}`,
                        color: highlightColor,
                        fontWeight: "bold",
                        fontSize: "0.85rem",
                      }}
                    >
                      Juan Pérez García
                    </div>
                    <div style={{ color: "#64748b", fontSize: "0.8rem" }}>
                      ← Ejemplo de estudiante resaltado
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: "2rem" }}>
                <h4 style={{ margin: "0 0 1rem 0", color: "#e2e8f0" }}>
                  📱 Orientación del Dispositivo
                </h4>
                <p
                  style={{
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                    marginBottom: "1.5rem",
                  }}
                >
                  Define la orientación predeterminada de la aplicación (solo
                  aplicable en Android).
                </p>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: "1.5rem",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isAndroid ? "1fr" : "repeat(auto-fit, minmax(140px, 1fr))",
                      gap: "0.8rem",
                    }}
                  >
                    {[
                      { id: "any", label: "🔄 Automático", icon: "📱" },
                      { id: "portrait", label: "📱 Vertical", icon: "↕️" },
                      { id: "landscape", label: "🌅 Horizontal", icon: "↔️" },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => handleUpdateOrientation(opt.id)}
                        style={{
                          padding: "1rem",
                          border:
                            orientation === opt.id
                              ? "2px solid #646cff"
                              : "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "10px",
                          background:
                            orientation === opt.id
                              ? "rgba(100, 108, 255, 0.1)"
                              : "rgba(255,255,255,0.03)",
                          color: orientation === opt.id ? "white" : "#94a3b8",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <span style={{ fontSize: "1.2rem" }}>{opt.icon}</span>
                        <span
                          style={{
                            fontSize: "0.85rem",
                            fontWeight:
                              orientation === opt.id ? "bold" : "normal",
                          }}
                        >
                          {opt.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  {!isAndroid && (
                    <div
                      style={{
                        marginTop: "1rem",
                        padding: "0.6rem",
                        borderRadius: "6px",
                        backgroundColor: "rgba(234, 179, 8, 0.1)",
                        border: "1px solid rgba(234, 179, 8, 0.2)",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <span style={{ fontSize: "0.9rem" }}>⚠️</span>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.75rem",
                          color: "#eab308",
                        }}
                      >
                        Esta opción no tiene efecto en Windows. Se aplicará
                        cuando uses la app en Android.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECCIÓN: APARIENCIA */}
        {activeTab === "apariencia" && (
          <div className="category-card">
            <div className="category-header">
              <h3>🎨 Apariencia</h3>
            </div>
            <div style={{ padding: "2rem" }}>
              <div style={{ marginBottom: "2rem" }}>
                <h4 style={{ margin: "0 0 1rem 0", color: "#e2e8f0" }}>
                  Tema del Sistema
                </h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
                    gap: "1rem",
                  }}
                >
                  {["mint", "carmesi", "amarillo", "rosado", "azul"].map(
                    (color) => (
                      <button
                        key={color}
                        onClick={() => setTheme(color)}
                        style={{
                          padding: "1rem",
                          border: "2px solid rgba(255,255,255,0.2)",
                          borderRadius: "12px",
                          background:
                            theme === color
                              ? "rgba(255,255,255,0.1)"
                              : "transparent",
                          color: theme === color ? "white" : "#94a3b8",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <div
                          style={{
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            backgroundColor: getThemeColor(color),
                            border: "2px solid rgba(255,255,255,0.3)",
                          }}
                        />
                        <span
                          style={{
                            fontSize: "0.9rem",
                            fontWeight: theme === color ? "bold" : "normal",
                          }}
                        >
                          {getThemeName(color)}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.05)",
                  padding: "1.5rem",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <h4 style={{ margin: "0 0 1rem 0", color: "#e2e8f0" }}>
                  Vista Previa
                </h4>
                <div
                  style={{ display: "flex", gap: "1rem", alignItems: "center" }}
                >
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "8px",
                      backgroundColor: getThemeColor(theme),
                      border: "2px solid rgba(255,255,255,0.3)",
                    }}
                  />
                  <span style={{ color: "#e2e8f0", fontWeight: "bold" }}>
                    Tema actual: {getThemeName(theme)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECCIÓN: CALIFICACIONES */}
        {activeTab === "calificaciones" && (
          <div className="category-card">
            <div className="category-header">
              <h3>⭐ Configuración de Calificaciones</h3>
            </div>
            <div style={{ padding: "clamp(1rem, 5vw, 2rem)" }}>
              <div style={{ marginBottom: "2rem" }}>
                <h4 style={{ margin: "0 0 1rem 0", color: "#e2e8f0" }}>
                  Colores de Notas Cualitativas
                </h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
                    gap: "1rem",
                  }}
                >
                  {gradeConfigs.map((grade) => (
                    <div
                      key={grade.id}
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        padding: "1rem",
                        borderRadius: "12px",
                        border: "1px solid rgba(255,255,255,0.1)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.8rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "0.5rem",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "1.5rem",
                            fontWeight: "bold",
                            color: grade.color,
                            minWidth: "40px",
                          }}
                        >
                          {grade.id}: {grade.nombre}
                        </span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.8rem",
                            flex: "1 1 auto",
                            justifyContent: "flex-end",
                            flexWrap: "wrap",
                          }}
                        >
                          {grade.id !== "AI" && (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.2rem",
                                alignItems: "flex-start",
                              }}
                            >
                              <label
                                style={{ fontSize: "0.7rem", color: "#94a3b8" }}
                              >
                                Mínimo pts
                              </label>
                              <input
                                type="number"
                                value={grade.minimo}
                                onChange={(e) =>
                                  handleUpdateGradeConfig(
                                    grade.id,
                                    grade.nombre,
                                    grade.color,
                                    parseInt(e.target.value) || 0,
                                  )
                                }
                                style={{
                                  width: "55px",
                                  background: "rgba(255,255,255,0.1)",
                                  border: "1px solid rgba(255,255,255,0.2)",
                                  borderRadius: "6px",
                                  color: "white",
                                  padding: "0.3rem",
                                  fontSize: "0.85rem",
                                  textAlign: "center",
                                }}
                              />
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.2rem",
                            }}
                          >
                            <label
                              style={{ fontSize: "0.7rem", color: "#94a3b8" }}
                            >
                              Color
                            </label>
                            <div
                              style={{
                                width: "80px",
                                height: "35px",
                                borderRadius: "8px",
                                background: grade.color,
                                border: "2px solid rgba(255,255,255,0.2)",
                                cursor: "pointer",
                                position: "relative",
                                overflow: "hidden",
                              }}
                              onClick={() => {
                                const input = document.getElementById(
                                  `color-input-${grade.id}`,
                                );
                                if (input) input.click();
                              }}
                            >
                              <input
                                id={`color-input-${grade.id}`}
                                type="color"
                                value={grade.color}
                                onChange={(e) =>
                                  handleUpdateGradeConfig(
                                    grade.id,
                                    grade.nombre,
                                    e.target.value,
                                    grade.minimo,
                                  )
                                }
                                style={{
                                  position: "absolute",
                                  top: "-10px",
                                  left: "-10px",
                                  width: "200%",
                                  height: "200%",
                                  opacity: 0,
                                  cursor: "pointer",
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "4px",
                          marginTop: "0.2rem",
                          justifyContent: "center",
                        }}
                      >
                        {PRESET_COLORS.map((preset) => (
                          <button
                            key={preset}
                            onClick={() =>
                              handleUpdateGradeConfig(
                                grade.id,
                                grade.nombre,
                                preset,
                                grade.minimo,
                              )
                            }
                            style={{
                              width: "18px",
                              height: "18px",
                              backgroundColor: preset,
                              border:
                                grade.color.toLowerCase() ===
                                preset.toLowerCase()
                                  ? "2px solid white"
                                  : "1px solid rgba(255,255,255,0.2)",
                              borderRadius: "4px",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECCIÓN: SYNC */}
        {activeTab === "sync" && (
          <div className="category-card">
            <div className="category-header">
              <h3>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
                  padding: '0.5rem 1rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.08)'
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="url(#cloudGrad2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <defs>
                      <linearGradient id="cloudGrad2" x1="6" y1="8" x2="19" y2="18" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#60A5FA"/>
                        <stop offset="1" stopColor="#A78BFA"/>
                      </linearGradient>
                    </defs>
                  </svg>
                  Sincronización en la Nube
                </span>
              </h3>
            </div>

            <div style={{ padding: isAndroid ? "1rem" : "1.5rem" }}>
              <Auth />
            </div>

            {isSynced && (
              <div style={{ padding: isAndroid ? "0 1rem 1rem" : "0 1.5rem 1.5rem" }}>
                {/* Status Bar */}
                <div style={{
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(96,165,250,0.04) 100%)',
                  borderRadius: '14px',
                  border: '1px solid rgba(59,130,246,0.12)',
                  padding: '1rem 1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: syncStatus.status === 'syncing' ? '#eab308' : isSynced ? '#22c55e' : '#64748b',
                      boxShadow: isSynced ? '0 0 8px rgba(34,197,94,0.4)' : 'none',
                      animation: syncStatus.status === 'syncing' ? 'pulse 1.5s infinite' : 'none',
                      flexShrink: 0,
                    }} />
                    <div>
                      <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.85rem' }}>
                        {isSynced ? 'Conectado' : syncStatus.status === 'syncing' ? 'Sincronizando...' : 'Desconectado'}
                      </div>
                      <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: '1px' }}>
                        {syncStatus.lastSync
                          ? `Última sync: ${new Date(syncStatus.lastSync).toLocaleString('es-ES', {
                              day: '2-digit', month: '2-digit',
                              hour: '2-digit', minute: '2-digit'
                            })}`
                          : 'Sin sincronizar'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'rgba(0,0,0,0.25)', padding: '4px 10px',
                      borderRadius: '8px', fontSize: '0.75rem',
                      color: '#94a3b8',
                    }}>
                      <span>⚡</span>
                      <span>{syncInterval}s</span>
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'rgba(0,0,0,0.25)', padding: '4px 10px',
                      borderRadius: '8px', fontSize: '0.75rem',
                      color: '#94a3b8', cursor: 'pointer',
                    }} onClick={() => setShowServerConfig(!showServerConfig)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Sync status message */}
                {syncStatus.message && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    borderLeft: `3px solid ${syncStatus.status === 'error' ? '#ef4444' : '#3b82f6'}`,
                    background: 'rgba(0,0,0,0.2)',
                    color: syncStatus.status === 'error' ? '#fca5a5' : '#93c5fd',
                  }}>
                    {syncStatus.status === 'syncing' && (
                      <span style={{ display: 'inline-block', marginRight: '8px' }}>
                        <span style={{
                          display: 'inline-block', width: '10px', height: '10px',
                          border: '2px solid #60a5fa', borderTopColor: 'transparent',
                          borderRadius: '50%', animation: 'spin 1s linear infinite',
                          verticalAlign: 'middle',
                        }} />
                      </span>
                    )}
                    {syncStatus.message}
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isAndroid ? '1fr' : '1fr 1fr',
                  gap: '0.75rem',
                  marginTop: '1rem',
                }}>
                  <button
                    onClick={async () => {
                      const btn = document.getElementById('sync-push-btn');
                      if (btn) { (btn as HTMLButtonElement).disabled = true; }
                      try { await cloud.getProvider().pushAll(); } finally {
                        if (btn) { (btn as HTMLButtonElement).disabled = false; }
                      }
                    }}
                    disabled={syncStatus.status === 'syncing'}
                    id="sync-push-btn"
                    style={{
                      padding: '0.85rem 1rem',
                      background: 'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 100%)',
                      border: '1px solid rgba(34,197,94,0.2)',
                      borderRadius: '12px',
                      cursor: syncStatus.status === 'syncing' ? 'not-allowed' : 'pointer',
                      opacity: syncStatus.status === 'syncing' ? 0.5 : 1,
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span style={{ color: '#22c55e', fontWeight: 600, fontSize: '0.85rem' }}>Subir datos</span>
                  </button>

                  <button
                    onClick={() => syncService.pullAll()}
                    disabled={syncStatus.status === 'syncing'}
                    style={{
                      padding: '0.85rem 1rem',
                      background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(59,130,246,0.04) 100%)',
                      border: '1px solid rgba(59,130,246,0.2)',
                      borderRadius: '12px',
                      cursor: syncStatus.status === 'syncing' ? 'not-allowed' : 'pointer',
                      opacity: syncStatus.status === 'syncing' ? 0.5 : 1,
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    <span style={{ color: '#60a5fa', fontWeight: 600, fontSize: '0.85rem' }}>Bajar datos</span>
                  </button>
                </div>

                {/* Server Config (collapsible) */}
                {showServerConfig && (
                  <div style={{
                    marginTop: '1rem',
                    padding: '1rem 1.25rem',
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                        <line x1="6" y1="6" x2="6.01" y2="6"/>
                        <line x1="6" y1="18" x2="6.01" y2="18"/>
                      </svg>
                      <span style={{ color: '#cbd5e1', fontSize: '0.85rem', fontWeight: 600 }}>
                        Configuración del Servidor
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <input
                        type="text"
                        value={pbUrl}
                        onChange={(e) => setPbUrl(e.target.value)}
                        placeholder="http://127.0.0.1:8090"
                        style={{
                          flex: 1,
                          padding: '0.5rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(0,0,0,0.3)',
                          color: '#e2e8f0',
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                          outline: 'none',
                        }}
                      />
                      <button
                        onClick={async () => {
                          setPbTesting(true);
                          setPbStatus('idle');
                          setPbLatency(null);
                          const start = Date.now();
                          try {
                            const result = await pbReconnect(pbUrl);
                            const latency = Date.now() - start;
                            setPbLatency(latency);
                            setPbStatus(result.ok ? 'online' : 'offline');
                            if (result.ok) savePocketBaseUrl(pbUrl);
                          } catch {
                            setPbLatency(Date.now() - start);
                            setPbStatus('offline');
                          }
                          setPbTesting(false);
                        }}
                        disabled={pbTesting || !pbUrl}
                        style={{
                          padding: '0.5rem 1rem',
                          borderRadius: '8px',
                          border: 'none',
                          background: pbTesting ? '#64748b' : 'var(--primary-color, #3b82f6)',
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: '0.8rem',
                          cursor: pbTesting ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pbTesting ? 'Probando...' : 'Probar'}
                      </button>
                    </div>

                    {pbStatus !== 'idle' && (
                      <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        marginBottom: '0.75rem',
                        background: pbStatus === 'online' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                        color: pbStatus === 'online' ? '#4ade80' : '#f87171',
                      }}>
                        <span>{pbStatus === 'online' ? '✅' : '❌'}</span>
                        <span>
                          {pbStatus === 'online' ? `Conectado (${pbLatency}ms)` : `Sin conexión${pbLatency ? ` (${pbLatency}ms)` : ''}`}
                        </span>
                      </div>
                    )}

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      paddingTop: '0.5rem',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Sync periódico:</span>
                      <input
                        type="number"
                        min={3}
                        max={300}
                        value={syncInterval}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10) || 10;
                          setSyncInterval(v);
                          localStorage.setItem('periodic_sync_interval_seconds', String(v));
                          syncService.ensurePeriodicSync();
                        }}
                        style={{
                          width: '56px',
                          padding: '0.25rem 0.4rem',
                          borderRadius: '6px',
                          border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(0,0,0,0.3)',
                          color: '#e2e8f0',
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                          textAlign: 'center',
                          outline: 'none',
                        }}
                      />
                      <span style={{ color: '#64748b', fontSize: '0.8rem' }}>segundos</span>
                    </div>
                  </div>
                )}

                {/* Info Grid */}
                <div style={{
                  marginTop: '1rem',
                  display: 'grid',
                  gridTemplateColumns: isAndroid ? '1fr 1fr' : 'repeat(4, 1fr)',
                  gap: '8px',
                }}>
                  {[
                    { icon: '💻', title: 'Local-First', desc: 'Datos seguros en tu PC' },
                    { icon: '🔐', title: 'Seguro', desc: 'Solo tú por email' },
                    { icon: '📴', title: 'Offline', desc: 'Trabaja sin internet' },
                    { icon: '🔄', title: 'Periódico', desc: `Cada ${syncInterval}s` },
                  ].map((item) => (
                    <div key={item.title} style={{
                      padding: '0.75rem',
                      background: 'rgba(0,0,0,0.15)',
                      borderRadius: '10px',
                      textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '1.1rem', marginBottom: '2px' }}>{item.icon}</div>
                      <div style={{ fontSize: '0.75rem', color: '#f1f5f9', fontWeight: 600 }}>{item.title}</div>
                      <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '1px' }}>{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECCIÓN: GOOGLE DRIVE */}
        {activeTab === "google-drive" && (
          <div className="category-card">
            <div className="category-header">
              <h3>☁️ Respaldo en Google Drive</h3>
            </div>
            <div style={{ padding: isAndroid ? "1rem" : "2rem" }}>
              <GoogleDriveBackup />
            </div>
          </div>
        )}

        {/* SECCIÓN: ALMACENAMIENTO */}
        {activeTab === "almacenamiento" && (
          <div className="category-card">
            <div className="category-header">
              <h3>📦 Almacenamiento y Reportes</h3>
            </div>
            <div style={{ padding: "2rem" }}>
              <div style={{ marginBottom: "2rem" }}>
                <h4 style={{ margin: "0 0 1rem 0", color: "#e2e8f0" }}>
                  Exportar Base de Datos de Estudiantes
                </h4>
                <p
                  style={{
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                    marginBottom: "1.5rem",
                  }}
                >
                  Genera un archivo Excel profesional con el listado completo de
                  estudiantes filtrado por colegio y año lectivo.
                </p>

                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: isAndroid ? "1.2rem" : "2rem",
                    borderRadius: "16px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "1.5rem",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isAndroid ? "1fr" : "1fr 1fr",
                      gap: "1rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      <label
                        style={{
                          fontSize: "0.8rem",
                          color: "#94a3b8",
                          fontWeight: "bold",
                        }}
                      >
                        Año Lectivo
                      </label>
                      <select
                        value={selectedAno}
                        onChange={(e) => setSelectedAno(Number(e.target.value))}
                        style={{
                          padding: "0.8rem",
                          borderRadius: "8px",
                          background: "rgba(15, 23, 42, 0.6)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "white",
                          outline: "none",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <option value={0}>Seleccione año...</option>
                        {anos.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      <label
                        style={{
                          fontSize: "0.8rem",
                          color: "#94a3b8",
                          fontWeight: "bold",
                        }}
                      >
                        Colegio
                      </label>
                      <select
                        value={selectedColegio}
                        onChange={(e) =>
                          setSelectedColegio(Number(e.target.value))
                        }
                        style={{
                          padding: "0.8rem",
                          borderRadius: "8px",
                          background: "rgba(15, 23, 42, 0.6)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "white",
                          outline: "none",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <option value={0}>Seleccione colegio...</option>
                        {colegios.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={handleExportStudentsToExcel}
                    disabled={
                      isExportingExcel || !selectedAno || !selectedColegio
                    }
                    style={{
                      marginTop: "1rem",
                      padding: "1rem",
                      background:
                        "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                      border: "none",
                      color: "white",
                      borderRadius: "12px",
                      cursor:
                        isExportingExcel || !selectedAno || !selectedColegio
                          ? "not-allowed"
                          : "pointer",
                      fontSize: "1rem",
                      fontWeight: "bold",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.8rem",
                      boxShadow: "0 4px 12px rgba(16, 185, 129, 0.2)",
                      transition: "all 0.3s ease",
                      opacity:
                        isExportingExcel || !selectedAno || !selectedColegio
                          ? 0.6
                          : 1,
                    }}
                  >
                    {isExportingExcel ? (
                      <>
                        <div
                          className="sync-spinner"
                          style={{
                            width: "18px",
                            height: "18px",
                            border: "2px solid rgba(255,255,255,0.2)",
                            borderTop: "2px solid white",
                            borderRadius: "50%",
                            animation: "spin 1s linear infinite",
                          }}
                        ></div>
                        Generando Excel...
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: "1.2rem" }}>📊</span>
                        Exportar Listado de Estudiantes a Excel
                      </>
                    )}
                  </button>
                </div>

                {/* Nueva opción: Exportar todos los estudiantes por año lectivo */}
                <div
                  style={{
                    marginTop: "1rem",
                    paddingTop: "1.5rem",
                    borderTop: "1px dashed rgba(255,255,255,0.15)",
                  }}
                >
                  <h5
                    style={{
                      margin: "0 0 1rem 0",
                      color: "#60a5fa",
                      fontSize: "0.95rem",
                      fontWeight: "600",
                    }}
                  >
                    📁 Exportar Todos los Estudiantes por Año Lectivo
                  </h5>
                  <p
                    style={{
                      color: "#94a3b8",
                      fontSize: "0.85rem",
                      marginBottom: "1rem",
                    }}
                  >
                    Exporta todos los estudiantes de todos los colegios para un
                    año lectivo específico. Ideal para reportes generales o
                    auditorías.
                  </p>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "1rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      <label
                        style={{
                          fontSize: "0.8rem",
                          color: "#94a3b8",
                          fontWeight: "bold",
                        }}
                      >
                        Año Lectivo
                      </label>
                      <select
                        value={selectedAno}
                        onChange={(e) => setSelectedAno(Number(e.target.value))}
                        style={{
                          padding: "0.8rem",
                          borderRadius: "8px",
                          background: "rgba(15, 23, 42, 0.6)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "white",
                          outline: "none",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <option value={0}>Seleccione año...</option>
                        {anos.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nombre}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={handleExportStudentsByYear}
                      disabled={isExportingByYear || !selectedAno}
                      style={{
                        padding: "1rem",
                        background:
                          "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                        border: "none",
                        color: "white",
                        borderRadius: "12px",
                        cursor:
                          isExportingByYear || !selectedAno
                            ? "not-allowed"
                            : "pointer",
                        fontSize: "1rem",
                        fontWeight: "bold",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.8rem",
                        boxShadow: "0 4px 12px rgba(59, 130, 246, 0.2)",
                        transition: "all 0.3s ease",
                        opacity:
                          isExportingByYear || !selectedAno ? 0.6 : 1,
                      }}
                    >
                      {isExportingByYear ? (
                        <>
                          <div
                            className="sync-spinner"
                            style={{
                              width: "18px",
                              height: "18px",
                              border: "2px solid rgba(255,255,255,0.2)",
                              borderTop: "2px solid white",
                              borderRadius: "50%",
                              animation: "spin 1s linear infinite",
                            }}
                          ></div>
                          Generando Excel...
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: "1.2rem" }}>📋</span>
                          Exportar Todos los Estudiantes ({anos.find((a) => a.id === selectedAno)?.nombre || "Año"})
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "2rem",
                    padding: "1.5rem",
                    background: "rgba(59, 130, 246, 0.05)",
                    borderRadius: "12px",
                    border: "1px solid rgba(59, 130, 246, 0.2)",
                  }}
                >
                  <h5 style={{ margin: "0 0 0.5rem 0", color: "#60a5fa" }}>
                    💡 Consejos Pro
                  </h5>
                  <ul
                    style={{
                      color: "#94a3b8",
                      fontSize: "0.85rem",
                      paddingLeft: "1.2rem",
                      margin: 0,
                      lineHeight: "1.6",
                    }}
                  >
                    <li>
                      <strong style={{ color: "#e2e8f0" }}>Exportar por Colegio:</strong> Genera un Excel con una sola hoja conteniendo los estudiantes de un colegio específico.
                    </li>
                    <li>
                      <strong style={{ color: "#e2e8f0" }}>Exportar por Año Lectivo:</strong> Genera un Excel con múltiples hojas, una por cada colegio, facilitando la organización y revisión de datos.
                    </li>
                    <li>
                      Cada hoja incluye: Nombre, Sexo, Grado, Sección, Teléfono, Email y Dirección de los estudiantes del colegio correspondiente.
                    </li>
                    <li>
                      Los datos se ordenan automáticamente en cada hoja: Grado (orden natural), Sección, y luego Nombre alfabéticamente.
                    </li>
                    <li>
                      Ideal para auditorías de fin de año, imprimir listados por colegio, o enviar reportes específicos a cada institución.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECCIÓN: DEBUGGING */}
        {activeTab === "debugging" && (
          <div className="category-card">
            <div className="category-header">
              <h3>🐛 Debugging</h3>
            </div>
            <div style={{ padding: isAndroid ? "1rem" : "2rem" }}>
              <div style={{ marginBottom: "2rem" }}>
                <h4 style={{ color: "#e2e8f0" }}>
                  Gestión de Datos y Configuración
                </h4>
                <p
                  style={{
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                    marginBottom: "1.5rem",
                  }}
                >
                  Configura la ubicación de almacenamiento y gestiona la
                  importación/exportación de datos
                </p>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isAndroid ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "1.5rem",
                  marginBottom: "2rem",
                }}
              >
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: "1.5rem",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <span style={{ fontSize: "1.2rem" }}>📁</span>
                    <h5
                      style={{ margin: 0, color: "#e2e8f0", fontSize: "1rem" }}
                    >
                      Ubicación de Almacenamiento
                    </h5>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    <button
                      onClick={handleSelectFolder}
                      style={{
                        padding: "0.6rem 1rem",
                        background: "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "#e2e8f0",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                      }}
                    >
                      📂 Seleccionar Carpeta
                    </button>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#64748b",
                        marginTop: "0.5rem",
                        wordBreak: "break-all",
                      }}
                    >
                      Carpeta actual: {dbPath || "Cargando..."}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: "1.5rem",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <span style={{ fontSize: "1.2rem" }}>📤</span>
                    <h5
                      style={{ margin: 0, color: "#e2e8f0", fontSize: "1rem" }}
                    >
                      Exportación de Datos
                    </h5>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    <button
                      onClick={handleExportDB}
                      style={{
                        padding: "0.6rem 1rem",
                        background:
                          "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                        border: "none",
                        color: "white",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                        fontWeight: "600",
                      }}
                    >
                      📤 Exportar Todo
                    </button>
                    <button
                      onClick={handleExportDB}
                      style={{
                        padding: "0.6rem 1rem",
                        background: "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "#e2e8f0",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                      }}
                    >
                      🗄️ Base de Datos
                    </button>
                    <button
                      onClick={async () => {
                        await emit("show-toast", {
                          message:
                            "ℹ️ Funcionalidad no implementada para archivos individuales.",
                          type: "info",
                        });
                      }}
                      style={{
                        padding: "0.6rem 1rem",
                        background: "rgba(255,255,255,0.1)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "#e2e8f0",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "0.9rem",
                      }}
                    >
                      ⚙️ Configuración
                    </button>
                  </div>
                </div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.05)",
                  padding: "1.5rem",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "1rem",
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>📥</span>
                  <h5 style={{ margin: 0, color: "#e2e8f0", fontSize: "1rem" }}>
                    Importación de Datos
                  </h5>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <button
                    onClick={handleImportDB}
                    style={{
                      padding: "0.6rem 1rem",
                      background:
                        "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                      border: "none",
                      color: "white",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      fontWeight: "600",
                    }}
                  >
                    📥 Importar Todo
                  </button>
                  <button
                    onClick={handleImportDB}
                    style={{
                      padding: "0.6rem 1rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      color: "#e2e8f0",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                    }}
                  >
                    📊 Base de Datos
                  </button>
                  <button
                    onClick={async () => {
                      await emit("show-toast", {
                        message:
                          "ℹ️ Funcionalidad no implementada para archivos individuales.",
                        type: "info",
                      });
                    }}
                    style={{
                      padding: "0.6rem 1rem",
                      background: "rgba(255,255,255,0.1)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      color: "#e2e8f0",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                    }}
                  >
                    ⚙️ Configuración
                  </button>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#64748b",
                      marginTop: "0.5rem",
                    }}
                  >
                    ⚠️ Advertencia: La importación sobrescribirá los datos
                    actuales.
                  </div>
                </div>
              </div>
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.05)",
                  padding: "1.5rem",
                  borderRadius: "12px",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  marginTop: "1.5rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "1rem",
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>⚠️</span>
                  <h5 style={{ margin: 0, color: "#f87171", fontSize: "1rem" }}>
                    Zona de Peligro (Reset)
                  </h5>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isAndroid ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "1rem",
                  }}
                >
                  <button
                    onClick={handleResetLocalDB}
                    style={{
                      padding: "0.6rem",
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      color: "#f87171",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: "600",
                    }}
                  >
                    🗑️ Reiniciar DB Local
                  </button>
                  <button
                    onClick={handleResetRemoteDB}
                    style={{
                      padding: "0.6rem",
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      color: "#f87171",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: "600",
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                      <path d="M19 18H6a5 5 0 0 1 0-10h1.26a5.5 5.5 0 0 1 10.48 0H18a5 5 0 0 1 0 10z" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Limpiar Nube
                  </button>
                </div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.05)",
                  padding: "1.5rem",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  marginTop: "1.5rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginBottom: "1rem",
                  }}
                >
                  <span style={{ fontSize: "1.2rem" }}>📊</span>
                  <h5 style={{ margin: 0, color: "#e2e8f0", fontSize: "1rem" }}>
                    Información del Sistema
                  </h5>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: "1rem",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#64748b",
                        marginBottom: "0.25rem",
                      }}
                    >
                      Versión App
                    </div>
                    <div style={{ color: "#e2e8f0", fontWeight: "600" }}>
                      1.2.0
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#64748b",
                        marginBottom: "0.25rem",
                      }}
                    >
                      Ruta DB
                    </div>
                    <div
                      style={{
                        color: "#e2e8f0",
                        fontSize: "0.8rem",
                        wordBreak: "break-all",
                      }}
                    >
                      {dbPath}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECCIÓN: ACERCA DE */}
        {activeTab === "acercaDe" && (
          <div className="category-card">
            <div className="category-header">
              <h3>📖 Acerca de la Aplicación</h3>
            </div>
            <div
              style={{
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <h2
                  style={{
                    margin: "0 0 0.5rem 0",
                    fontSize: "2.5rem",
                    background:
                      "linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  📊 GESTIÓN DE NOTAS
                </h2>
                <p style={{ color: "#94a3b8", fontSize: "1.1rem", margin: 0 }}>
                  Sistema de Gestión Académica Profesional
                </p>
                <div
                  style={{
                    display: "inline-block",
                    marginTop: "0.5rem",
                    padding: "0.2rem 0.8rem",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "20px",
                    fontSize: "0.8rem",
                    color: "var(--primary-color)",
                    border: "1px solid var(--primary-color)",
                  }}
                >
                  v1.2.0 - Android & Cloud Edition
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: "1rem",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: "1rem",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
                    📱
                  </div>
                  <div style={{ fontWeight: "bold" }}>Mobile First</div>
                  <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                    Interfaz optimizada
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: "1rem",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
                    ☁️
                  </div>
                  <div style={{ fontWeight: "bold" }}>Cloud Sync</div>
                  <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                    PocketBase Sync
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: "1rem",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
                    🎨
                  </div>
                  <div style={{ fontWeight: "bold" }}>Personalizable</div>
                  <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                    Temas dinámicos
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    padding: "1rem",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
                    🛡️
                  </div>
                  <div style={{ fontWeight: "bold" }}>Seguridad</div>
                  <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                    Local Storage
                  </div>
                </div>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.05)",
                  padding: "1.5rem",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <h4 style={{ margin: "0 0 1rem 0", color: "#e2e8f0" }}>
                  🚀 Últimas Actualizaciones (v1.2.0)
                </h4>
                <ul
                  style={{
                    color: "#94a3b8",
                    fontSize: "0.9rem",
                    margin: 0,
                    paddingLeft: "1.5rem",
                    lineHeight: "1.8",
                  }}
                >
                  <li>
                    📱 Rediseño Android: Nueva navegación de Ajustes optimizada.
                  </li>
                  <li>☁️ Sync Real-time: Estado de sincronización en vivo.</li>
                  <li>
                    ⭐ Calificaciones Flexibles: Configuración dinámica de
                    colores.
                  </li>
                  <li>🎨 Motor de Temas: Soporte para múltiples esquemas.</li>
                  <li>
                    🔄 Gestión de Orientación: Control de rotación en Android.
                  </li>
                </ul>
              </div>
              <div
                style={{
                  background: "rgba(255,255,255,0.05)",
                  padding: "1.5rem",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <h4 style={{ margin: "0 0 1rem 0", color: "#e2e8f0" }}>
                  Tecnologías de Vanguardia
                </h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "1rem",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: "bold",
                        color: "var(--primary-color)",
                        marginBottom: "0.5rem",
                      }}
                    >
                      Core System
                    </div>
                    <ul
                      style={{
                        color: "#94a3b8",
                        fontSize: "0.8rem",
                        paddingLeft: "1.2rem",
                      }}
                    >
                      <li>Tauri v2 (Rust)</li>
                      <li>React 19</li>
                      <li>TypeScript</li>
                    </ul>
                  </div>
                  <div>
                    <div
                      style={{
                        fontWeight: "bold",
                        color: "#a855f7",
                        marginBottom: "0.5rem",
                      }}
                    >
                      Data & Cloud
                    </div>
                    <ul
                      style={{
                        color: "#94a3b8",
                        fontSize: "0.8rem",
                        paddingLeft: "1.2rem",
                      }}
                    >
                      <li>SQLite Local</li>
                      <li>PocketBase</li>
                      <li>SQLite Remoto</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div
                style={{
                  textAlign: "center",
                  color: "#64748b",
                  fontSize: "0.9rem",
                  borderTop: "1px solid rgba(255,255,255,0.1)",
                  paddingTop: "1rem",
                }}
              >
                Desarrollado con ❤️ por Keimer - v1.2.0
              </div>
            </div>
          </div>
        )}
          </div>
        </div>
      )}

      {/* Modal de Confirmación */}
      {showResetConfirm &&
        resetConfig &&
        createPortal(
          <div className="modal-overlay">
            <div
              className="modal-content category-card"
              style={{ width: "450px" }}
            >
              <div className="category-header">
                <h3>{resetConfig.title}</h3>
              </div>
              <div style={{ padding: "1.5rem" }}>
                <p style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}>
                  {resetConfig.message}
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "1rem",
                    marginTop: "2rem",
                  }}
                >
                  <button
                    className="cancel"
                    onClick={() => setShowResetConfirm(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    className="primary"
                    onClick={async () => {
                      setIsProcessingReset(true);
                      await resetConfig.onConfirm();
                      setShowResetConfirm(false);
                      setIsProcessingReset(false);
                    }}
                    style={{ backgroundColor: "#ef4444" }}
                  >
                    {isProcessingReset ? "..." : "Confirmar"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function getThemeColor(color: string): string {
  const colors: Record<string, string> = {
    mint: "#10b981",
    carmesi: "#ef4444",
    amarillo: "#eab308",
    rosado: "#ec4899",
    azul: "#3b82f6",
  };
  return colors[color] || "#10b981";
}

function getThemeName(color: string): string {
  const names: Record<string, string> = {
    mint: "Mint",
    carmesi: "Carmesí",
    amarillo: "Amarillo",
    rosado: "Rosado",
    azul: "Azul",
  };
  return names[color] || "Mint";
}

export default AjustesPage;
