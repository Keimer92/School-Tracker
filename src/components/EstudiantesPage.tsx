import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import * as XLSX from "xlsx";
import { syncService } from "../lib/syncService";
import { useCamera } from "../hooks/useCamera";
import "../App.css"; // Ensure styles are available

interface CategoryItem {
  id: number;
  nombre: string;
  activo?: boolean;
}

interface Student {
  id?: number;
  nombre: string;
  codigo: string;
  sexo: string;
  anoLectivoId: number;
  gradoId: number;
  seccionId: number;
  colegioId: number;
  telefono?: string;
  direccion?: string;
  email?: string;
  foto?: string | null; // URL o base64 de la foto del estudiante
}

export function EstudiantesPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);

  // Camera hook
  const { photoPreview, openCamera, clearPhoto, setPhotoPreview, fileInputRef, handleFileChange } = useCamera();

  // Catalogs
  const [anos, setAnos] = useState<CategoryItem[]>([]);
  const [grados, setGrados] = useState<CategoryItem[]>([]);
  const [secciones, setSecciones] = useState<CategoryItem[]>([]);
  const [colegios, setColegios] = useState<CategoryItem[]>([]);

  // Modal Catalogs (separados para no interferir con los filtros)
  const [modalGrados, setModalGrados] = useState<CategoryItem[]>([]);
  const [modalSecciones, setModalSecciones] = useState<CategoryItem[]>([]);
  
  // Global catalogs for display (para cuando los filtros están en "todos")
  const [allGrados, setAllGrados] = useState<CategoryItem[]>([]);
  const [allSecciones, setAllSecciones] = useState<CategoryItem[]>([]);

  // UI State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Stats calculation
  const stats = useMemo(() => {
    return {
      total: filteredStudents.length,
      f: filteredStudents.filter(s => s.sexo === 'F').length,
      m: filteredStudents.filter(s => s.sexo === 'M').length
    };
  }, [filteredStudents]);

  // Filters State
  const [filters, setFilters] = useState({
    anoLectivoId: 0,
    colegioId: 0,
    gradoId: 0,
    seccionId: 0,
    sexo: "",
  });

  const emptyStudent: Student = {
    nombre: "",
    codigo: "",
    sexo: "M",
    anoLectivoId: 0,
    gradoId: 0,
    seccionId: 0,
    colegioId: 0,
    telefono: "",
    direccion: "",
    email: "",
  };

  // Form State
  const [formData, setFormData] = useState<Student>(emptyStudent);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportHelp, setShowImportHelp] = useState(false);

  const normalizeString = (str: string) => {
    return str.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  };

  const findOrCreateItem = async (
    name: string, 
    items: CategoryItem[], 
    addCommand: string, 
    fetchItems: () => Promise<CategoryItem[]>,
    _type: 'grado' | 'seccion' | 'colegio' | 'ano'
  ): Promise<number> => {
    const normalizedInput = normalizeString(name);
    
    // Alias mapping
    const aliases: Record<string, string[]> = {
      '1er grado': ['1', '1ro', '1er', 'primero', '1 grado', 'primer grado'],
      '2do grado': ['2', '2do', 'segundo', '2 grado', 'segundo grado'],
      '3er grado': ['3', '3ro', '3er', 'tercero', '3 grado', 'tercer grado'],
      '4to grado': ['4', '4to', 'cuarto', '4 grado', 'cuarto grado'],
      '5to grado': ['5', '5to', 'quinto', '5 grado', 'quinto grado'],
      '6to grado': ['6', '6to', 'sexto', '6 grado', 'sexto grado'],
      '7mo grado': ['7', '7mo', 'septimo', '7 grado', 'septimo grado'],
      '8vo grado': ['8', '8vo', 'octavo', '8 grado', 'octavo grado'],
      '9no grado': ['9', '9no', 'noveno', '9 grado', 'noveno grado'],
      '10mo grado': ['10', '10mo', 'decimo', '10 grado', 'decimo grado'],
      '11mo grado': ['11', '11mo', 'once', 'undecimo', '11 grado', 'undecimo grado'],
    };

    // Find by alias or normalized name
    let found = items.find(item => {
      const normalizedItem = normalizeString(item.nombre);
      if (normalizedItem === normalizedInput) return true;
      
      // Check if the item name has aliases that match input
      for (const [canonical, variations] of Object.entries(aliases)) {
        if (normalizeString(canonical) === normalizedItem && variations.includes(normalizedInput)) {
          return true;
        }
      }
      return false;
    });

    if (found) return Number(found.id);

    // If not found, check if input is an alias of something we have
    for (const [canonical, variations] of Object.entries(aliases)) {
      if (variations.includes(normalizedInput)) {
        const canonicalFound = items.find(item => normalizeString(item.nombre) === normalizeString(canonical));
        if (canonicalFound) return Number(canonicalFound.id);
        
        // If canonical doesn't exist yet, create it instead of the variation
        const newId = await invoke<number>(addCommand, { nombre: canonical });
        await fetchItems();
        return newId;
      }
    }

    // Truly new item
    const newId = await invoke<number>(addCommand, { nombre: name });
    await fetchItems();
    return newId;
  };

  const fetchGrados = async (colegioId: number, anoId: number, isModal = false) => {
    try {
      console.log(`fetching grados for colegio:${colegioId}, ano:${anoId}, isModal:${isModal}`);
      
      let data: CategoryItem[] = [];
      
      if (colegioId && anoId) {
        data = await invoke<CategoryItem[]>("get_grados_by_colegio", { 
          colegioId: Number(colegioId),
          anoLectivoId: Number(anoId)
        });
      }

      // FALLBACK: Si estamos en el modal y no hay grados, cargar todos los grados disponibles
      if (isModal && data.length === 0) {
        console.log("Fetching global grados as fallback...");
        data = await invoke<CategoryItem[]>("get_grados");
      }

      console.log(`Fetched ${data.length} grados`, data);
      if (isModal) {
        setModalGrados(data);
      } else {
        setGrados(data);
      }
      return data;
    } catch (error) {
      console.error("Error fetching grados:", error);
      return [];
    }
  };

  const fetchSecciones = async (gradoId: number, colegioId: number, anoId: number, isModal = false) => {
    try {
      console.log(`fetching secciones for grado:${gradoId}, colegio:${colegioId}, ano:${anoId}, isModal:${isModal}`);
      
      let data: CategoryItem[] = [];

      if (gradoId && colegioId && anoId) {
        data = await invoke("get_secciones_by_grado_colegio", { 
          gradoId: Number(gradoId),
          colegioId: Number(colegioId),
          anoLectivoId: Number(anoId)
        });
      }

      // FALLBACK: Si estamos en el modal y no hay secciones, cargar todas las secciones
      if (isModal && data.length === 0) {
        console.log("Fetching global secciones as fallback...");
        data = await invoke<CategoryItem[]>("get_secciones");
      }

      console.log(`Fetched ${data.length} secciones`, data);
      if (isModal) {
        setModalSecciones(data);
      } else {
        setSecciones(data);
      }
      return data;
    } catch (error) {
      console.error("Error fetching secciones:", error);
      return [];
    }
  };

  const fetchData = async (preserveFilters = false) => {
    try {
      const [sData, aData, colData, gData, secData] = await Promise.all([
        invoke<Student[]>("get_students"),
        invoke<CategoryItem[]>("get_anos"),
        invoke<CategoryItem[]>("get_colegios"),
        invoke<CategoryItem[]>("get_grados"),
        invoke<CategoryItem[]>("get_secciones"),
      ]);

      setAnos(aData);
      setColegios(colData);
      setStudents(sData);
      setAllGrados(gData);
      setAllSecciones(secData);

      // Find active defaults
      const activeYear = aData.find((a) => a.activo) || aData[0];
      const activeYearId = activeYear?.id ?? 0;

      const activeColegio = colData.find((c) => c.activo) || colData[0];
      const activeColegioId = activeColegio?.id ?? 0;

      // Set filters to active year/school by default (or 0 if none active)
      // IMPORTANTE: Si preserveFilters es true, usamos los filtros actuales del estado
      // que pueden haber sido actualizados por setFilters antes de llamar a fetchData
      const currentFilters = preserveFilters
        ? filters
        : {
            ...filters,
            anoLectivoId: activeYearId, // Start with active year
            colegioId: activeColegioId,  // Start with active school
          };

      if (!preserveFilters) {
        setFilters(currentFilters);
      }

      // Cargar grados inicialmente basados en los filtros por defecto
      if (currentFilters.colegioId && currentFilters.anoLectivoId) {
        await fetchGrados(currentFilters.colegioId, currentFilters.anoLectivoId);
      }

      // Initialize form defaults if catalogs exist
      if (!isEditing) {
        setFormData(prev => ({
          ...prev,
          anoLectivoId: prev.anoLectivoId || activeYearId,
          colegioId: prev.colegioId || activeColegioId,
        }));
      }

      return { students: sData, anos: aData, colegios: colData };
    } catch (error) {
      console.error("Error fetching data:", error);
      return null;
    }
  };

  // Escuchar cambios en catálogos para refrescar los datos
  useEffect(() => {
    const unlisten = listen("catalog-updated", () => {
      console.log("Evento catalog-updated recibido en EstudiantesPage, refrescando...");
      fetchData(true); // Preserve current filters when catalog updates
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const handleImportExcel = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");

      const selected = await open({
        multiple: false,
        filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }]
      });

      if (!selected || Array.isArray(selected)) return;

      setIsImporting(true);
      
      const fileContent = await readFile(selected);
      if (!fileContent) throw new Error("No se pudo leer el archivo");
      
      const wb = XLSX.read(fileContent, { type: 'array' });
      let excelData: any[] = [];
      
      // Procesar cada hoja por separado para preservar el nombre de la hoja como colegio
      const hojaDataMap: Map<string, any[]> = new Map();
      
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(ws);
        if (Array.isArray(sheetData) && sheetData.length > 0) {
          console.log(`Cargando ${sheetData.length} filas de la hoja: ${sheetName}`);
          hojaDataMap.set(sheetName, sheetData);
        }
      }

      if (hojaDataMap.size === 0) {
        throw new Error("No se encontraron datos en ninguna de las hojas del archivo");
      }

      let importedCount = 0;
      let errors = 0;
      let skippedCount = 0;
      let lastImportedFilter = { ...filters };
      const newlyImportedStudents: Student[] = [];

      // Refrescar metadatos antes de empezar y obtener los datos frescos
      const freshData = await fetchData(true); // Preserve current filters during import
      if (!freshData) throw new Error("No se pudieron cargar los datos del sistema");
      
      let currentAnos = [...freshData.anos];
      let currentColegios = [...freshData.colegios];
      let currentGrados = await invoke<CategoryItem[]>("get_grados");
      let currentSecciones = await invoke<CategoryItem[]>("get_secciones");
      let currentStudentsList = [...freshData.students];

      const refreshAnos = async () => { const a = await invoke<CategoryItem[]>("get_anos"); setAnos(a); currentAnos = a; return a; };
      const refreshColegios = async () => { const c = await invoke<CategoryItem[]>("get_colegios"); setColegios(c); currentColegios = c; return c; };
      const refreshGrados = async () => { const g = await invoke<CategoryItem[]>("get_grados"); setGrados(g); currentGrados = g; return g; };
      const refreshSecciones = async () => { const s = await invoke<CategoryItem[]>("get_secciones"); setSecciones(s); currentSecciones = s; return s; };

      const resolveId = async (val: any, items: CategoryItem[], addCmd: string, refreshFn: () => Promise<CategoryItem[]>, type: any, filterId: number) => {
        if (val === undefined || val === null || val === "") return filterId;
        
        // Si ya es un ID existente, usarlo
        const numericVal = Number(val);
        if (!isNaN(numericVal) && numericVal > 0) {
          const found = items.find(item => Number(item.id) === numericVal);
          if (found) return numericVal;
        }
        
        // Si no es un ID o no existe, tratar como nombre
        return await findOrCreateItem(String(val), items, addCmd, refreshFn, type);
      };

      // Procesar cada hoja por separado
      let rowIndex = 0;
      for (const [sheetName, sheetData] of hojaDataMap) {
        console.log(`Procesando hoja: ${sheetName} con ${sheetData.length} filas`);
        
        for (let i = 0; i < sheetData.length; i++) {
          const row = sheetData[i];
          rowIndex++;
          try {
            const nombre = row.Nombre || row.Estudiante || row.nombre || row.estudiante || row["Nombre Completo"] || row["NOMBRE"] || row["Estudiantes"];
            if (!nombre) {
              console.warn(`Fila ${rowIndex} saltada: nombre vacío`, row);
              skippedCount++;
              continue;
            }

            // Normalización agresiva de datos de la fila
            const rawAno = row["Año Lectivo"] || row.Año || row.Ano || row.Periodo || row.ano || row.año || row["AÑO LECTIVO"] || row["AÑO"];
            // Usar el nombre de la hoja como colegio por defecto si no hay columna de colegio
            const rawColegio = row.Colegio || row.Escuela || row.Centro || row.colegio || row["COLEGIO"] || row["CENTRO"] || row["ESCUELA"] || sheetName;
            const rawGrado = row.Grado || row.Nivel || row.grado || row["GRADO"] || row["NIVEL"];
            const rawSeccion = row.Seccion || row.Grupo || row.Aula || row.seccion || row["SECCION"] || row["GRUPO"] || row["AULA"];

          const anoId = await resolveId(rawAno, currentAnos, "add_ano", refreshAnos, 'ano', filters.anoLectivoId);
          const colegioId = await resolveId(rawColegio, currentColegios, "add_colegio", refreshColegios, 'colegio', filters.colegioId);
          const gradoId = await resolveId(rawGrado, currentGrados, "add_grado", refreshGrados, 'grado', filters.gradoId);
          
          // Para la sección, si no se puede resolver, intentamos crear una por defecto
          let seccionId = await resolveId(rawSeccion, currentSecciones, "add_seccion", refreshSecciones, 'seccion', 0);
          if (!seccionId || seccionId === 0) {
            // Si sigue siendo 0, crear una sección "Unica" por defecto
            seccionId = await findOrCreateItem("Unica", currentSecciones, "add_seccion", refreshSecciones, 'seccion');
          }

          if (!anoId || !colegioId || !gradoId || !seccionId) {
             console.warn(`Fila ${i + 1} (${nombre}) saltada por falta de datos esenciales (ID 0 detectado).`, {
               anoId, colegioId, gradoId, seccionId, row
             });
             errors++;
             continue;
          }

          const isDuplicate = currentStudentsList.some(s => 
            normalizeString(s.nombre) === normalizeString(nombre) &&
            Number(s.anoLectivoId) === Number(anoId) &&
            Number(s.gradoId) === Number(gradoId) &&
            Number(s.seccionId) === Number(seccionId) &&
            Number(s.colegioId) === Number(colegioId)
          );

          if (isDuplicate) {
            console.log(`Fila ${i + 1} omitida: Estudiante duplicado (${nombre})`);
            skippedCount++;
            // Actualizamos el filtro para que el usuario vea el estudiante que ya existía
            lastImportedFilter = {
              ...lastImportedFilter,
              anoLectivoId: Number(anoId),
              colegioId: Number(colegioId),
              gradoId: Number(gradoId),
              seccionId: Number(seccionId)
            };
            continue;
          }

          let codigo = row.Codigo || row.codigo || row.ID || row.id || row["CODIGO"] || row["Código"] || "";
          if (!codigo) {
            const numericCodes = currentStudentsList
              .map(s => parseInt(s.codigo))
              .filter(code => !isNaN(code));
            const nextCode = numericCodes.length > 0 ? Math.max(...numericCodes) + 1 : 1;
            codigo = nextCode.toString().padStart(4, '0');
          }

          const rawSexo = (row.Sexo || row.sexo || row.Genero || row.genero || row["SEXO"] || row["Género"] || "M").toString().toUpperCase();
          const sexo = rawSexo.startsWith("F") || rawSexo === "MUJER" || rawSexo === "FEMENINO" ? "F" : "M";

          const newStudent: Student = {
            nombre: String(nombre).trim(),
            codigo: String(codigo).trim(),
            sexo,
            anoLectivoId: Number(anoId),
            gradoId: Number(gradoId),
            seccionId: Number(seccionId),
            colegioId: Number(colegioId),
            telefono: String(row.Telefono || row.telefono || row["TELEFONO"] || row["Teléfono"] || "").trim(),
            direccion: String(row.Direccion || row.direccion || row["DIRECCION"] || row["Dirección"] || "").trim(),
            email: String(row.Email || row.email || row["EMAIL"] || "").trim(),
          };

          const studentId = await invoke<number>("add_student", { student: newStudent });
          const studentWithId = { ...newStudent, id: studentId };
          currentStudentsList.push(studentWithId);
          // IMPORTANTE: Agregar también al estado local para que se muestre inmediatamente
          setStudents(prev => [...prev, studentWithId]);
          newlyImportedStudents.push(studentWithId);
          importedCount++;

          // Guardar los últimos IDs importados con éxito
          lastImportedFilter = {
            ...lastImportedFilter,
            anoLectivoId: Number(anoId),
            colegioId: Number(colegioId),
            gradoId: Number(gradoId),
            seccionId: Number(seccionId)
          };
          } catch (err) {
            console.error(`Error al procesar fila ${rowIndex}:`, row, err);
            errors++;
          }
        }
      }

      // Sincronizar los nuevos estudiantes con Supabase en lote
      if (newlyImportedStudents.length > 0) {
        try {
          await syncService.syncStudentsBatch(newlyImportedStudents);
        } catch (syncErr) {
          console.error("Error al sincronizar estudiantes importados:", syncErr);
          await emit("show-toast", { 
            message: "⚠️ Estudiantes importados localmente, pero falló la sincronización a la nube.", 
            type: "warning" 
          });
        }
      }

      // Actualizar filtros para mostrar los estudiantes importados (o los que ya existían)
      if (importedCount > 0 || skippedCount > 0) {
        // Primero actualizamos los filtros
        setFilters(lastImportedFilter);
        // Forzar actualización de catálogos y estudiantes con los nuevos filtros
        await emit("student-updated", { timestamp: Date.now() });
        await emit("catalog-updated");
        // Pequeño delay para asegurar que los estados se actualicen
        setTimeout(async () => {
          // Usar los filtros actualizados al cargar datos
          await fetchData(true);
        }, 100);
      } else {
        await emit("student-updated", { timestamp: Date.now() });
        await emit("catalog-updated");
        await fetchData(true);
      }

      await emit("show-toast", { 
        message: `✅ Importación Finalizada\nÉxito: ${importedCount} | Omitidos: ${skippedCount} | Errores: ${errors}`, 
        type: 'success' 
      });
    } catch (err) {
      console.error("Error crítico en importación:", err);
      await emit("show-toast", { 
        message: "❌ Error de Importación: " + (err instanceof Error ? err.message : "Fallo al abrir el archivo"), 
        type: 'error' 
      });
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filter Logic - también se ejecuta cuando los filtros cambian para actualizar la vista
  useEffect(() => {
    let result = students;
    // Solo filtrar si el filtro es mayor a 0 (0 = todos)
    if (filters.anoLectivoId > 0) result = result.filter(s => s.anoLectivoId === filters.anoLectivoId);
    if (filters.colegioId > 0) result = result.filter(s => s.colegioId === filters.colegioId);
    if (filters.gradoId > 0) result = result.filter(s => s.gradoId === filters.gradoId);
    if (filters.seccionId > 0) result = result.filter(s => s.seccionId === filters.seccionId);
    if (filters.sexo) result = result.filter(s => s.sexo === filters.sexo);
    if (searchTerm) {
      result = result.filter((s) =>
        s.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.codigo.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Ordenar por: Grado → Sección → Nombre
    const sortedResult = [...result].sort((a, b) => {
      // 1. Ordenar por grado (usando allGrados para obtener los nombres completos)
      const gradoA = allGrados.find(g => g.id === a.gradoId)?.nombre || '';
      const gradoB = allGrados.find(g => g.id === b.gradoId)?.nombre || '';
      const gradeSort = gradoA.localeCompare(gradoB, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (gradeSort !== 0) return gradeSort;

      // 2. Ordenar por sección (usando allSecciones para obtener los nombres completos)
      const seccionA = allSecciones.find(s => s.id === a.seccionId)?.nombre || '';
      const seccionB = allSecciones.find(s => s.id === b.seccionId)?.nombre || '';
      const sectionSort = seccionA.localeCompare(seccionB, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      if (sectionSort !== 0) return sectionSort;

      // 3. Ordenar por nombre alfabéticamente
      return a.nombre.localeCompare(b.nombre, undefined, { sensitivity: 'base' });
    });

    setFilteredStudents(sortedResult);
  }, [students, filters, searchTerm, allGrados, allSecciones]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    const val = name === 'sexo' ? value : Number(value);
    
    setFilters(prev => {
      const newFilters = { ...prev, [name]: val };
      
      // Cascading reset
      if (name === 'colegioId' || name === 'anoLectivoId') {
        newFilters.gradoId = 0;
        newFilters.seccionId = 0;
      } else if (name === 'gradoId') {
        newFilters.seccionId = 0;
      }
      
      return newFilters;
    });
  };

  // Efectos para carga en cascada de catálogos en filtros
  useEffect(() => {
    if (filters.colegioId && filters.anoLectivoId) {
      fetchGrados(filters.colegioId, filters.anoLectivoId);
    }
  }, [filters.colegioId, filters.anoLectivoId]);

  useEffect(() => {
    if (filters.gradoId && filters.colegioId && filters.anoLectivoId) {
      fetchSecciones(filters.gradoId, filters.colegioId, filters.anoLectivoId);
    } else {
      setSecciones([]);
    }
  }, [filters.gradoId, filters.colegioId, filters.anoLectivoId]);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const val = (name === 'nombre' || name === 'codigo' || name === 'sexo' || name === 'telefono' || name === 'direccion' || name === 'email') 
      ? value 
      : Number(value);

    setFormData(prev => {
      const newData = { ...prev, [name]: val };
      
      // Cascading reset for modal
      if (name === 'colegioId' || name === 'anoLectivoId') {
        newData.gradoId = 0;
        newData.seccionId = 0;
      } else if (name === 'gradoId') {
        newData.seccionId = 0;
      }
      
      return newData;
    });
  };

  // Efectos para carga en cascada en el modal
  useEffect(() => {
    console.log("Modal Effect (Grados):", { isModalOpen, colegioId: formData.colegioId, anoId: formData.anoLectivoId });
    if (isModalOpen) {
      fetchGrados(formData.colegioId, formData.anoLectivoId, true);
    }
  }, [isModalOpen, formData.colegioId, formData.anoLectivoId]);

  useEffect(() => {
    console.log("Modal Effect (Secciones):", { isModalOpen, gradoId: formData.gradoId, colegioId: formData.colegioId, anoId: formData.anoLectivoId });
    if (isModalOpen) {
      fetchSecciones(formData.gradoId, formData.colegioId, formData.anoLectivoId, true);
    } else {
      setModalSecciones([]);
    }
  }, [isModalOpen, formData.gradoId, formData.colegioId, formData.anoLectivoId]);

  // Efectos para auto-seleccionar el primer elemento en el modal al cargar/cambiar
  useEffect(() => {
    if (isModalOpen && !isEditing && modalGrados.length > 0 && formData.gradoId === 0) {
      console.log("Auto-selecting first Grado:", modalGrados[0]);
      setFormData(prev => ({ ...prev, gradoId: modalGrados[0].id }));
    }
  }, [isModalOpen, isEditing, modalGrados, formData.gradoId]);

  useEffect(() => {
    if (isModalOpen && !isEditing && modalSecciones.length > 0 && formData.seccionId === 0) {
      console.log("Auto-selecting first Seccion:", modalSecciones[0]);
      setFormData(prev => ({ ...prev, seccionId: modalSecciones[0].id }));
    }
  }, [isModalOpen, isEditing, modalSecciones, formData.seccionId]);

  const openAddModal = () => {
    setIsEditing(false);
    
    // Buscar años y colegios activos para los valores por defecto
    const activeYear = anos.find((a) => a.activo) || anos[0];
    const activeYearId = activeYear?.id ?? 0;
    const activeColegio = colegios.find((c) => c.activo) || colegios[0];
    const activeColegioId = activeColegio?.id ?? 0;
    
    setFormData({
      ...emptyStudent,
      anoLectivoId: activeYearId,
      colegioId: activeColegioId,
      gradoId: 0, // Se auto-seleccionará por el useEffect
      seccionId: 0, // Se auto-seleccionará por el useEffect
    });
    
    // Limpiar catálogos previos del modal para forzar recarga fresca
    setModalGrados([]);
    setModalSecciones([]);
    
    setIsModalOpen(true);
  };

  const openEditModal = (student: Student) => {
    setIsEditing(true);
    setFormData({ ...student });
    // Cargar foto si existe
    if (student.foto) {
      setPhotoPreview(student.foto);
    } else {
      clearPhoto();
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let studentToSave = { ...formData };

      // Lógica de código automático si está vacío
      if (!studentToSave.codigo.trim()) {
        // Encontrar el código numérico más alto actual
        const numericCodes = students
          .map(s => parseInt(s.codigo))
          .filter(code => !isNaN(code));
        
        const nextCode = numericCodes.length > 0 
          ? Math.max(...numericCodes) + 1 
          : 1;
        
        // Formatear con ceros a la izquierda (ej: 0001) o simplemente el número
        studentToSave.codigo = nextCode.toString().padStart(4, '0');
      }

      if (isEditing) {
        // Agregar foto al estudiante
        studentToSave.foto = photoPreview || undefined;
        
        await invoke("update_student", { student: studentToSave });
        
        // Sincronización
        try {
          await syncService.syncStudent(studentToSave, false);
        } catch (err) {
          console.error("Error en sincronización background (update):", err);
          await emit("show-toast", { 
            message: "💾 Actualizado localmente, pero falló la sincronización.", 
            type: "warning" 
          });
        }

        await emit("student-updated", { timestamp: Date.now() });
        await emit("show-toast", { message: '✅ Estudiante actualizado correctamente', type: 'success' });
      } else {
        // Agregar foto al nuevo estudiante
        const newStudentWithFoto = { ...studentToSave, foto: photoPreview || undefined };
        const newId = await invoke<number>("add_student", { student: newStudentWithFoto });
        const newStudent = { ...newStudentWithFoto, id: newId };

        // Sincronización
        try {
          await syncService.syncStudent(newStudent, true);
        } catch (err) {
          console.error("Error en sincronización background (add):", err);
          await emit("show-toast", { 
            message: "💾 Guardado localmente, pero falló la sincronización.", 
            type: "warning" 
          });
        }

        await emit("student-updated", { timestamp: Date.now() });
        await emit("show-toast", { message: '✅ Estudiante registrado correctamente', type: 'success' });
      }

      setFormData(emptyStudent);
      fetchData(true); // Preserve filters after saving
      setIsModalOpen(false);
    } catch (error) {
      console.error("Error saving student:", error);
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: 'error' });
    }
  };

  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [studentToDeleteId, setStudentToDeleteId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    try {
      const impact = await invoke<{ totalNotas: number, totalAsistencias: number }>("get_student_impact", { studentId: id });
      
      const student = students.find(s => s.id === id);
      const studentName = student ? student.nombre : 'este estudiante';

      let impactMessage = `¿Está seguro de eliminar a ${studentName}?`;
      
      if (impact.totalNotas > 0 || impact.totalAsistencias > 0) {
        impactMessage += `\n\n⚠️ ATENCIÓN: Esta acción eliminará permanentemente:`;
        if (impact.totalNotas > 0) impactMessage += `\n- ${impact.totalNotas} Calificaciones registradas`;
        if (impact.totalAsistencias > 0) impactMessage += `\n- ${impact.totalAsistencias} Registros de asistencia`;
        impactMessage += `\n\nEsta acción no se puede deshacer.`;
      }

      setStudentToDeleteId(id);
      setDeleteMessage(impactMessage);
      setShowDeleteConfirm(true);
    } catch (error) {
      console.error("Error getting student impact:", error);
      setStudentToDeleteId(id);
      setDeleteMessage('¿Está seguro de eliminar este estudiante?');
      setShowDeleteConfirm(true);
    }
  };

  const confirmDelete = async () => {
    if (studentToDeleteId === null) return;
    setIsDeleting(true);
    const idToDelete = studentToDeleteId;

    try {
      // 1. Eliminar localmente (Crítico)
      await invoke("delete_student", { id: idToDelete });
      
      // 2. Actualizar UI inmediatamente (Optimista)
      setStudents(prev => prev.filter(s => s.id !== idToDelete));
      setFilteredStudents(prev => prev.filter(s => s.id !== idToDelete));
      
      // 3. Cerrar modal y mostrar éxito inmediatamente
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setStudentToDeleteId(null);
      
      await emit("show-toast", { message: '✅ Estudiante eliminado correctamente', type: 'success' });
      
      // 4. Notificar a otros componentes inmediatamente tras éxito local
      await emit("student-updated", { timestamp: Date.now() });

      // 5. Sincronización y refresco de datos en segundo plano
      (async () => {
        try {
          // Intentar sincronizar con Supabase (esto puede tardar)
          await syncService.deleteStudent(idToDelete);
        } catch (syncError) {
          console.error("Error en sincronización de eliminación (segundo plano):", syncError);
        }

        try {
          // Refrescar datos completos por consistencia
          fetchData(true); // Preserve filters after deletion
        } catch (eventError) {
          console.error("Error al refrescar datos post-eliminación:", eventError);
        }
      })();

    } catch (error) {
      console.error("Error deleting student:", error);
      await emit("show-toast", { message: "❌ Error al eliminar: " + error, type: 'error' });
      setIsDeleting(false);
      // Mantenemos el modal abierto si falló la eliminación local
    }
  };

  return (
    <div className="page-container">
      <style>
        {`
          .input-label {
            display: block;
            margin-bottom: 0.5rem;
            font-size: 0.8rem;
            color: #94a3b8;
            font-weight: 600;
          }
          .filter-select {
            width: 100%;
            padding: 0.6rem 1rem;
            border-radius: 8px;
            background: rgba(15, 23, 42, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: white;
            outline: none;
            cursor: pointer;
          }
          .filter-select:focus {
            border-color: #3b82f6;
          }
          .student-summary-row {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.8rem;
            padding-top: 0.8rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            width: 100%;
          }
          .summary-mini-card {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            padding: 0.5rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            min-height: 50px;
          }
          .summary-mini-label {
            font-size: 0.65rem;
            color: #94a3b8;
            text-transform: uppercase;
            font-weight: bold;
            margin-bottom: 2px;
          }
          .summary-mini-value {
            font-size: 1.1rem;
            font-weight: 800;
            line-height: 1;
          }
          .card-total { border-left: 3px solid #06b6d4; }
          .card-fem { border-left: 3px solid #f472b6; }
          .card-masc { border-left: 3px solid #60a5fa; }
          .glow-button-primary {
            background: -webkit-linear-gradient(135deg, #2563eb 0%, #3b82f6 100%) !important;
            background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%) !important;
            -webkit-box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
            -webkit-transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            position: relative;
            overflow: hidden;
            -webkit-transform: translateZ(0);
            transform: translateZ(0);
            will-change: transform, box-shadow;
          }
          .glow-button-primary:hover:not(:disabled), .glow-button-primary:active:not(:disabled) {
            -webkit-box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
            -webkit-transform: translateY(-2px) scale(1.05);
            transform: translateY(-2px) scale(1.05);
          }
          .glow-button-success {
            background: -webkit-linear-gradient(135deg, #059669 0%, #10b981 100%) !important;
            background: linear-gradient(135deg, #059669 0%, #10b981 100%) !important;
            -webkit-box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
            box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
            -webkit-transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            position: relative;
            overflow: hidden;
            -webkit-transform: translateZ(0);
            transform: translateZ(0);
            will-change: transform, box-shadow;
          }
          .glow-button-success:hover:not(:disabled), .glow-button-success:active:not(:disabled) {
            -webkit-box-shadow: 0 6px 20px rgba(5, 150, 105, 0.5);
            box-shadow: 0 6px 20px rgba(5, 150, 105, 0.5);
            -webkit-transform: translateY(-2px) scale(1.05);
            transform: translateY(-2px) scale(1.05);
          }
          .glow-button-primary::after, .glow-button-success::after {
            content: '';
            position: absolute;
            top: -50%;
            left: -100%;
            width: 40%;
            height: 200%;
            background: -webkit-linear-gradient(left, transparent, rgba(255, 255, 255, 0.3), transparent);
            background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.3), transparent);
            transform: rotate(30deg);
            -webkit-transition: all 0.6s ease;
            transition: all 0.6s ease;
          }
          .glow-button-primary:hover::after, .glow-button-primary:active::after,
          .glow-button-success:hover::after, .glow-button-success:active::after {
            left: 150%;
          }
        `}
      </style>
      {/* Top Bar: Filters and Add Button */}
      <div className="category-card sticky-filters" style={{ 
        marginBottom: isMobile ? "0.5rem" : "1rem", 
        padding: isMobile ? "0.5rem" : "1rem", 
        width: '100%',
        boxSizing: 'border-box',
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
        <div className="filters-row" style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? '0.4rem' : '0.8rem', alignItems: 'flex-end' }}>
          {/* Año Lectivo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '0.3rem', flex: '1 1 120px' }}>
            {!isMobile && <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: 0 }}>Año Lectivo</label>}
            <select
              name="anoLectivoId"
              onChange={handleFilterChange}
              value={filters.anoLectivoId}
              className="filter-select"
              style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
            >
              <option value={0}>Todos los años</option>
              {anos.map(a => (
                <option key={a.id} value={a.id}>
                  {a.nombre} {a.activo && "✓ (Activo)"}
                </option>
              ))}
            </select>
          </div>

          {/* Colegio */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '0.3rem', flex: '1 1 150px' }}>
            {!isMobile && <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: 0 }}>Colegio</label>}
            <select
              name="colegioId"
              onChange={handleFilterChange}
              value={filters.colegioId}
              className="filter-select"
              style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
            >
              <option value={0}>Todos los colegios</option>
              {colegios.map(c => (
                <option key={c.id} value={c.id}>
                  {c.nombre} {c.activo && "✓ (Activo)"}
                </option>
              ))}
            </select>
          </div>

          {/* Grado */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '0.3rem', flex: '1 1 120px' }}>
            {!isMobile && <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: 0 }}>Grado</label>}
            <select 
              name="gradoId" 
              onChange={handleFilterChange} 
              value={filters.gradoId} 
              className="filter-select"
              style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
            >
              <option value={0}>Todos los grados</option>
              {grados.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>

          {/* Sección */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '0.3rem', flex: '1 1 100px' }}>
            {!isMobile && <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: 0 }}>Sección</label>}
            <select 
              name="seccionId" 
              onChange={handleFilterChange} 
              value={filters.seccionId} 
              className="filter-select"
              style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
            >
              <option value={0}>Todas las secciones</option>
              {secciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          {/* Sexo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '0.3rem', flex: '1 1 100px' }}>
            {!isMobile && <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: 0 }}>Sexo</label>}
            <select 
              name="sexo" 
              onChange={handleFilterChange} 
              value={filters.sexo} 
              className="filter-select"
              style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
            >
              <option value="">Todos</option>
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
            </select>
          </div>

          {/* Botones de Acción */}
          <div style={{ display: 'flex', gap: '0.5rem', flex: '0 0 auto', justifyContent: 'flex-start' }}>
            <button 
              className="primary glow-button-primary" 
              onClick={openAddModal} 
              style={{ 
                height: '38px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                padding: '0.4rem 1rem',
                fontSize: '0.85rem',
                borderRadius: '10px',
                border: 'none',
                color: 'white',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>👨‍🎓</span>
              {!isMobile && <span>Nuevo</span>}
            </button>
            <button 
              className="primary glow-button-success" 
              onClick={handleImportExcel}
              disabled={isImporting}
              style={{ 
                height: '38px',
                padding: '0.4rem 1rem', 
                cursor: 'pointer', 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                fontSize: '0.85rem',
                borderRadius: '10px',
                border: 'none',
                color: 'white',
                fontWeight: 'bold',
                whiteSpace: 'nowrap'
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>{isImporting ? "⌛" : "📗"}</span>
              {!isMobile && <span>{isImporting ? "Importando..." : "Excel"}</span>}
            </button>
            <button
              onClick={() => setShowImportHelp(true)}
              style={{
                height: '38px',
                width: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer',
                fontSize: '1.1rem',
                fontWeight: 'bold'
              }}
              title="Ayuda de importación"
            >
              ?
            </button>
          </div>

          {/* Buscador Dinámico */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0' : '0.3rem', flex: '1 1 200px' }}>
            {!isMobile && <label className="input-label" style={{ fontSize: '0.75rem', marginBottom: 0 }}>Buscar Estudiante</label>}
            <div className="search-container">
              <span className="search-icon-left">🔍</span>
              <input 
                type="text" 
                className="search-input search-input-with-icon" 
                placeholder="Nombre o código..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ padding: '0.4rem 0.6rem 0.4rem 2.2rem', fontSize: '0.85rem', height: '38px' }}
              />
              {searchTerm && (
                <span 
                  className="search-clear-icon" 
                  onClick={() => setSearchTerm("")}
                  title="Limpiar búsqueda"
                >
                  ✕
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Resumen de estadísticas (Sticky) */}
        {filteredStudents.length > 0 && (
          <div className="student-summary-row">
            <div className="summary-mini-card card-total">
              <span className="summary-mini-label">Total</span>
              <span className="summary-mini-value" style={{ color: '#06b6d4' }}>{stats.total}</span>
            </div>
            <div className="summary-mini-card card-fem">
              <span className="summary-mini-label">Femenino</span>
              <span className="summary-mini-value" style={{ color: '#f472b6' }}>{stats.f}</span>
            </div>
            <div className="summary-mini-card card-masc">
              <span className="summary-mini-label">Masculino</span>
              <span className="summary-mini-value" style={{ color: '#60a5fa' }}>{stats.m}</span>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Ayuda para Importación */}
      {showImportHelp && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '2rem'
        }}>
          <div className="category-card" style={{ 
            maxWidth: '800px', 
            width: '100%', 
            maxHeight: '90vh', 
            overflowY: 'auto',
            position: 'relative',
            padding: '2rem'
          }}>
            <button 
              onClick={() => setShowImportHelp(false)}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '1.5rem',
                cursor: 'pointer'
              }}
            >
              ×
            </button>
            
            <h2 style={{ marginBottom: '1.5rem', color: '#3b82f6' }}>Guía de Importación Excel</h2>
            <p style={{ marginBottom: '1rem', color: '#cbd5e1' }}>
              El sistema es inteligente y detectará automáticamente las columnas. Aquí tienes un ejemplo de cómo organizar tu archivo:
            </p>

            <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
              <table style={{ 
                width: '100%', 
                borderCollapse: 'collapse', 
                backgroundColor: 'rgba(0,0,0,0.2)',
                borderRadius: '8px',
                overflow: 'hidden'
              }}>
                <thead>
                  <tr style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Estudiante</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Año Lectivo</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Colegio</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Grado</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Sección</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Sexo</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Codigo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Juan Pérez</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>2024</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>San José</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>1ro</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>A</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>M</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>1025</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>María Sosa</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>2024</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>San José</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>1ro</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>A</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>F</td>
                    <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#64748b', fontStyle: 'italic' }}>Opcional</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', fontSize: '0.9rem' }}>
              <ul style={{ color: '#94a3b8', paddingLeft: '1.2rem' }}>
                <li style={{ marginBottom: '0.5rem' }}><strong>Estudiante:</strong> Nombre completo del alumno.</li>
                <li style={{ marginBottom: '0.5rem' }}><strong>Año Lectivo:</strong> Periodo escolar (ej: 2024, 2025).</li>
                <li style={{ marginBottom: '0.5rem' }}><strong>Colegio:</strong> Nombre del centro educativo.</li>
                <li style={{ marginBottom: '0.5rem' }}><strong>Grado:</strong> Soporta variaciones como "1ro", "1er grado", "Primero".</li>
              </ul>
              <ul style={{ color: '#94a3b8', paddingLeft: '1.2rem' }}>
                <li style={{ marginBottom: '0.5rem' }}><strong>Sección:</strong> Grupo o aula (ej: A, B, Unica).</li>
                <li style={{ marginBottom: '0.5rem' }}><strong>Sexo:</strong> M (Masculino) o F (Femenino).</li>
                <li style={{ marginBottom: '0.5rem' }}><strong>Codigo:</strong> Identificador único (si está vacío, se genera uno).</li>
                <li style={{ marginBottom: '0.5rem' }}><strong>Duplicados:</strong> El sistema ignora filas de estudiantes que ya existan.</li>
              </ul>
            </div>
            
            <div style={{ marginTop: '2rem', textAlign: 'center' }}>
              <button className="primary" onClick={() => setShowImportHelp(false)}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* Student Grid or Empty State */}
      <div style={{ 
        display: filteredStudents.length === 0 ? "block" : "grid", 
        gridTemplateColumns: filteredStudents.length === 0 ? "none" : "repeat(auto-fill, minmax(350px, 1fr))", 
        gap: "1rem",
        width: '100%' 
      }}>
        {filteredStudents.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '5rem 2rem', 
            border: '2px dashed rgba(255, 255, 255, 0.1)', 
            borderRadius: '16px',
            width: '100%',
            boxSizing: 'border-box'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{searchTerm ? '🔍' : '👥'}</div>
            <h4 style={{ color: '#cbd5e1', marginBottom: '0.5rem' }}>
              {searchTerm ? 'No se encontraron resultados' : 'No hay estudiantes registrados'}
            </h4>
            <p style={{ color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
              {searchTerm 
                ? `No se encontró ningún estudiante que coincida con "${searchTerm}"`
                : 'No hay estudiantes registrados para los filtros seleccionados (Año, Colegio, Grado, Sección).'}
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
          filteredStudents.map((st, index) => (
            <div key={st.id} className="category-card" style={{ margin: 0, padding: "0.8rem" }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                    {/* Foto del estudiante */}
                    {st.foto ? (
                      <img 
                        src={st.foto} 
                        alt={st.nombre}
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: '2px solid rgba(56, 189, 248, 0.3)',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.2rem',
                        flexShrink: 0,
                      }}>
                        👤
                      </div>
                    )}
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontSize: "0.75rem",
                        background: "rgba(56, 189, 248, 0.15)",
                        color: "#38bdf8",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        fontWeight: "bold",
                        flexShrink: 0,
                        border: "1px solid rgba(56, 189, 248, 0.2)"
                      }}>
                        #{index + 1}
                      </span>
                      <span style={{ fontSize: "0.95rem", fontWeight: "bold", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {st.nombre}
                      </span>
                    </div>
                  </div>
                  <div className="item-actions" style={{ display: "flex", gap: "0.2rem", flexShrink: 0 }}>
                    <button 
                      className="icon-button edit" 
                      onClick={() => openEditModal(st)} 
                      style={{ color: "#38bdf8", padding: '4px' }}
                    >
                      ✏️
                    </button>
                    <button 
                      className="icon-button delete" 
                      onClick={() => handleDelete(st.id!)} 
                      style={{ padding: '4px' }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
                
                <div style={{ 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: '0.6rem', 
                  fontSize: '0.75rem', 
                  color: '#94a3b8',
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '0.5rem',
                  borderRadius: '6px'
                }}>
                  <span style={{ whiteSpace: 'nowrap' }}><strong style={{color: '#38bdf8'}}>Cod:</strong> {st.codigo}</span>
                  <span style={{ whiteSpace: 'nowrap' }}>{st.sexo === 'M' ? 'Masc' : 'Fem'}</span>
                  
                  <div style={{ width: '1px', height: '12px', background: 'rgba(255,255,255,0.1)', margin: '0 2px' }}></div>

                  <span style={{ background: "rgba(56, 189, 248, 0.1)", color: "#38bdf8", padding: "1px 6px", borderRadius: "3px", whiteSpace: 'nowrap' }}>
                    {allGrados.find(g => g.id === st.gradoId)?.nombre || 'Grado'}
                  </span>
                  <span style={{ background: "rgba(168, 85, 247, 0.1)", color: "#a855f7", padding: "1px 6px", borderRadius: "3px", whiteSpace: 'nowrap' }}>
                    {allSecciones.find(s => s.id === st.seccionId)?.nombre || 'Sección'}
                  </span>
                </div>

                {(st.telefono || st.email || st.direccion) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', fontSize: '0.75rem', color: '#64748b', paddingLeft: '0.2rem' }}>
                     {st.telefono && <span>📞 {st.telefono}</span>}
                     {st.email && <span>📧 {st.email}</span>}
                     {st.direccion && <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📍 {st.direccion}</span>}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal Overlay para Registro/Edición */}
       {isModalOpen && createPortal(
         <div className="modal-overlay">
           <div className="modal-content category-card" style={{ 
             width: '450px', 
             maxWidth: '95%',
             maxHeight: '90vh',
             overflowY: 'auto',
           }}>
             <div className="category-header" style={{ justifyContent: 'space-between', padding: '1rem 1.25rem' }}>
               <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{isEditing ? "Editar Estudiante" : "Registrar Estudiante"}</h3>
               <button
                 onClick={() => setIsModalOpen(false)}
                 style={{ background: 'transparent', border: 'none', color: 'white', fontSize: '1.2rem', cursor: 'pointer' }}
               >✕</button>
             </div>

             <form onSubmit={handleSubmit} style={{
               display: "grid",
               gap: "0.6rem",
               gridTemplateColumns: "1fr 1fr",
               padding: "1rem 1.25rem",
               width: "100%",
               boxSizing: "border-box"
             }}>
               {/* Foto del estudiante */}
               <div style={{
                 gridColumn: 'span 2',
                 display: 'flex',
                 flexDirection: 'column',
                 alignItems: 'center',
                 gap: '0.4rem',
                 marginBottom: '0.5rem'
               }}>
                 <div style={{
                   width: '80px',
                   height: '80px',
                   borderRadius: '50%',
                   background: 'rgba(255,255,255,0.05)',
                   border: '2px dashed rgba(255,255,255,0.2)',
                   display: 'flex',
                   alignItems: 'center',
                   justifyContent: 'center',
                   overflow: 'hidden',
                   cursor: 'pointer',
                 }}
                 onClick={openCamera}
                 >
                   {photoPreview ? (
                     <img
                       src={photoPreview}
                       alt="Foto estudiante"
                       style={{
                         width: '100%',
                         height: '100%',
                         objectFit: 'cover'
                       }}
                     />
                   ) : (
                     <div style={{ textAlign: 'center', color: '#64748b' }}>
                       <div style={{ fontSize: '1.5rem' }}>📷</div>
                       <div style={{ fontSize: '0.65rem' }}>Foto</div>
                     </div>
                   )}
                 </div>
                 {photoPreview && (
                   <button
                     type="button"
                     onClick={clearPhoto}
                     style={{
                       fontSize: '0.65rem',
                       color: '#f87171',
                       background: 'none',
                       border: 'none',
                       cursor: 'pointer',
                       textDecoration: 'underline',
                     }}
                   >
                     🗑️ Eliminar
                   </button>
                 )}
               </div>

               {/* Input file oculto para cámara */}
               <input
                 ref={fileInputRef}
                 type="file"
                 accept="image/*"
                 capture="environment"
                 onChange={handleFileChange}
                 style={{ display: 'none' }}
               />

               <div className="input-container" style={{ gridColumn: 'span 2', marginBottom: 0 }}>
                 <input name="nombre" placeholder="Nombre completo" value={formData.nombre} onChange={handleFormChange} required style={{ width: '100%' }} />
               </div>
               <div className="input-container" style={{ marginBottom: 0 }}>
                 <input name="codigo" placeholder="Código" value={formData.codigo} onChange={handleFormChange} style={{ width: '100%' }} />
               </div>

               <div className="input-container" style={{ marginBottom: 0 }}>
                 <select name="sexo" value={formData.sexo} onChange={handleFormChange} className="filter-select" style={{ width: '100%', border: 'none', background: 'transparent', padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}>
                   <option value="M">Masculino</option>
                   <option value="F">Femenino</option>
                 </select>
               </div>

               <div className="input-container" style={{ marginBottom: 0 }}>
                 <input name="telefono" placeholder="Teléfono" value={formData.telefono} onChange={handleFormChange} style={{ width: '100%' }} />
               </div>
               <div className="input-container" style={{ marginBottom: 0 }}>
                 <input name="email" placeholder="Email" value={formData.email} onChange={handleFormChange} style={{ width: '100%' }} />
               </div>
               <div className="input-container" style={{ gridColumn: 'span 2', marginBottom: 0 }}>
                 <input name="direccion" placeholder="Dirección" value={formData.direccion} onChange={handleFormChange} style={{ width: '100%' }} />
               </div>

               <div className="input-container" style={{ marginBottom: 0 }}>
                 <label className="input-label" style={{ fontSize: '0.7rem' }}>Año Lectivo</label>
                 <select name="anoLectivoId" value={formData.anoLectivoId} onChange={handleFormChange} className="filter-select" style={{ width: '100%', border: 'none', background: 'transparent', padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}>
                   {anos.map((opt) => <option key={opt.id} value={opt.id}>{opt.nombre} {opt.activo && "(Activo)"}</option>)}
                 </select>
               </div>

               <div className="input-container" style={{ marginBottom: 0 }}>
                 <label className="input-label" style={{ fontSize: '0.7rem' }}>Colegio</label>
                 <select name="colegioId" value={formData.colegioId} onChange={handleFormChange} className="filter-select" style={{ width: '100%', border: 'none', background: 'transparent', padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}>
                    {colegios.map((opt) => <option key={opt.id} value={opt.id}>{opt.nombre}</option>)}
                 </select>
               </div>

               <div className="input-container" style={{ marginBottom: 0 }}>
                 <label className="input-label" style={{ fontSize: '0.7rem' }}>Grado</label>
                  <select name="gradoId" value={formData.gradoId} onChange={handleFormChange} className="filter-select" style={{ width: '100%', border: 'none', background: 'transparent', padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}>
                    <option value={0}>Seleccione grado</option>
                    {modalGrados.map((opt) => <option key={opt.id} value={opt.id}>{opt.nombre}</option>)}
                 </select>
               </div>

                <div className="input-container" style={{ marginBottom: 0 }}>
                  <label className="input-label" style={{ fontSize: '0.7rem' }}>Sección</label>
                  <select name="seccionId" value={formData.seccionId} onChange={handleFormChange} className="filter-select" style={{ width: '100%', border: 'none', background: 'transparent', padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}>
                    <option value={0}>Seleccione sección</option>
                    {modalSecciones.map((opt) => <option key={opt.id} value={opt.id}>{opt.nombre}</option>)}
                  </select>
                </div>

               <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
                 <button type="button" className="cancel" onClick={() => setIsModalOpen(false)} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>Cancelar</button>
                 <button type="submit" className="primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}>Guardar</button>
               </div>
             </form>
           </div>
         </div>,
         document.body
       )}

      {/* Modal de Confirmación de Eliminación */}
      {showDeleteConfirm && createPortal(
        <div className="modal-overlay">
          <div className="modal-content category-card" style={{ width: '400px', maxWidth: '90%', padding: '1.5rem' }}>
            <h3 style={{ marginTop: 0, color: '#f87171' }}>⚠️ Confirmar Eliminación</h3>
            <div style={{ 
              whiteSpace: 'pre-wrap', 
              margin: '1.5rem 0', 
              color: '#e2e8f0',
              fontSize: '0.95rem',
              lineHeight: '1.5'
            }}>
              {deleteMessage}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button 
                className="cancel" 
                onClick={() => { setShowDeleteConfirm(false); setStudentToDeleteId(null); }}
                disabled={isDeleting}
              >
                Cancelar
              </button>
              <button 
                className="primary" 
                onClick={confirmDelete}
                disabled={isDeleting}
                style={{ backgroundColor: '#ef4444' }}
              >
                {isDeleting ? "Eliminando..." : "Eliminar Todo"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
