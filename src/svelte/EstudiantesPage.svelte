<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { emit, listen } from "@tauri-apps/api/event";
  import { syncService } from "../lib/syncService";
  import { onDataChange } from "../lib/autoSync";
  import { registerBackHandler } from "../lib/androidBack";
  import { ask } from "@tauri-apps/plugin-dialog";
  import FilterContainer from "./FilterContainer.svelte";
  import FilterGroup from "./FilterGroup.svelte";
  import SearchFab from "./SearchFab.svelte";

  interface CategoryItem { id: number; nombre: string; activo?: boolean; }
  interface Student { id?: number; nombre: string; codigo: string; sexo: string; anoLectivoId: number; gradoId: number; seccionId: number; colegioId: number; telefono?: string; direccion?: string; email?: string; foto?: string | null; }

  // Camera state
  let photoPreview: string | null = $state(null);
  let fileInputEl: HTMLInputElement | undefined = $state(undefined);

  function openCamera() { fileInputEl?.click(); }
  function clearPhoto() { photoPreview = null; if (fileInputEl) fileInputEl.value = ''; }
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        if (result.length > 500000) compressImage(result, resolve);
        else resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function compressImage(base64: string, resolve: (v: string) => void) {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let width = img.width; let height = img.height;
      const maxWidth = 800;
      if (width > maxWidth) { height = (height * maxWidth) / width; width = maxWidth; }
      canvas.width = width; canvas.height = height;
      if (ctx) { ctx.drawImage(img, 0, 0, width, height); resolve(canvas.toDataURL('image/jpeg', 0.7)); }
      else resolve(base64);
    };
    img.onerror = () => resolve(base64);
  }
  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Por favor selecciona una imagen válida'); return; }
    try { photoPreview = await fileToBase64(file) as string; }
    catch (err) { console.error('Error al procesar imagen:', err); alert('Error al procesar la imagen'); }
    if (fileInputEl) fileInputEl.value = '';
  }

  let students: Student[] = $state([]);
  let anos: CategoryItem[] = $state([]);
  let grados: CategoryItem[] = $state([]);
  let secciones: CategoryItem[] = $state([]);
  let colegios: CategoryItem[] = $state([]);
  let modalGrados: CategoryItem[] = $state([]);
  let modalSecciones: CategoryItem[] = $state([]);
  let allGrados: CategoryItem[] = $state([]);
  let allSecciones: CategoryItem[] = $state([]);

  let isModalOpen = $state(false);
  let isEditing = $state(false);

  $effect(() => {
    if (isModalOpen) {
      return registerBackHandler(() => { isModalOpen = false; return true; });
    }
  });
  $effect(() => {
    if (gridSelectedStudent) {
      return registerBackHandler(() => { gridSelectedStudent = null; return true; });
    }
  });
  $effect(() => {
    if (showImportHelp) {
      return registerBackHandler(() => { showImportHelp = false; return true; });
    }
  });
  // Cierre garantizado con Escape (desktop), autónomo y sin depender de la pila de back-handlers.
  $effect(() => {
    if (!showImportHelp) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') showImportHelp = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  let searchTerm = $state("");
  let isMobile = $state(false);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isWindows = /Windows/i.test(navigator.userAgent);
  const isAndroidMobile = $derived(isAndroid || (isMobile && !isWindows));
  let showFiltersModal = $state(false);
  $effect(() => {
    if (showFiltersModal) {
      return registerBackHandler(() => { showFiltersModal = false; return true; });
    }
  });
  let viewMode = $state<'card' | 'list' | 'grid'>(isAndroid ? 'list' : (localStorage.getItem('estudiantes-view-mode') as 'card' | 'list' | 'grid') || (isMobile ? 'list' : 'grid'));
  let gridSelectedStudent: Student | null = $state(null);
  let isImporting = $state(false);
  let showImportHelp = $state(false);
  let isDeleting = $state(false);
  let studentToDeleteId: number | null = $state(null);
  let selectedIds = $state<Set<number>>(new Set());
  let selectMode = $state(false);
  let isDeletingSelected = $state(false);

  let filters = $state({ anoLectivoId: 0, colegioId: 0, gradoId: 0, seccionId: 0, sexo: "" });

  // Promoción de estudiantes
  let showPromoteBanner = $state(false);
  let promoteFromAno: CategoryItem | null = $state(null);
  let promoteToAno: CategoryItem | null = $state(null);
  let promoteStudentCount = $state(0);
  let isPromoting = $state(false);
  let showColegioPicker = $state(false);
  let secundariaColegios: { id: number; nombre: string; tipo: string }[] = $state([]);
  let pendingSixthGraders: { estudianteId: number; nombre: string; colegioOrigenId: number; colegioOrigenNombre: string }[] = $state([]);
  let selectedColegioId = $state(0);

  const emptyStudent: Student = { nombre: "", codigo: "", sexo: "M", anoLectivoId: 0, gradoId: 0, seccionId: 0, colegioId: 0, telefono: "", direccion: "", email: "" };
  let formData: Student = $state({ ...emptyStudent });

  let filteredStudents = $derived.by(() => {
    let result = students;
    if (filters.anoLectivoId > 0) result = result.filter(s => s.anoLectivoId === filters.anoLectivoId);
    if (filters.colegioId > 0) result = result.filter(s => s.colegioId === filters.colegioId);
    if (filters.gradoId > 0) result = result.filter(s => s.gradoId === filters.gradoId);
    if (filters.seccionId > 0) result = result.filter(s => s.seccionId === filters.seccionId);
    if (filters.sexo) result = result.filter(s => s.sexo === filters.sexo);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(s => s.nombre.toLowerCase().includes(term) || s.codigo.toLowerCase().includes(term));
    }
    return [...result].sort((a, b) => {
      const gradoA = allGrados.find(g => g.id === a.gradoId)?.nombre || '';
      const gradoB = allGrados.find(g => g.id === b.gradoId)?.nombre || '';
      const gs = gradoA.localeCompare(gradoB, undefined, { numeric: true, sensitivity: 'base' });
      if (gs !== 0) return gs;
      const secA = allSecciones.find(s => s.id === a.seccionId)?.nombre || '';
      const secB = allSecciones.find(s => s.id === b.seccionId)?.nombre || '';
      const ss = secA.localeCompare(secB, undefined, { numeric: true, sensitivity: 'base' });
      if (ss !== 0) return ss;
      return a.nombre.localeCompare(b.nombre, undefined, { sensitivity: 'base' });
    });
  });

  let stats = $derived({ total: filteredStudents.length, f: filteredStudents.filter(s => s.sexo === 'F').length, m: filteredStudents.filter(s => s.sexo === 'M').length });

  const lowerCaseParticles = new Set([
    "de", "del", "y", "e", "la", "las", "los", "el", "en", "con",
    "por", "para", "a", "un", "una", "su", "lo", "no", "o", "ni",
    "que", "es", "se", "le", "da", "do", "das", "dos", "van", "von",
    "san", "santa", "don", "doña", "di"
  ]);

  function toTitleCase(str: string): string {
    let wordIdx = 0;
    return str.split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part)) return part;
      const lower = part.toLowerCase();
      const isParticle = wordIdx > 0 && lowerCaseParticles.has(lower);
      wordIdx++;
      if (isParticle) return lower;
      return lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
    }).join("");
  }

  function normalizeString(str: string) {
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }

  async function findOrCreateItem(name: string, items: CategoryItem[], addCommand: string, fetchItems: () => Promise<CategoryItem[]>, _type: string): Promise<number> {
    const normalizedInput = normalizeString(name);
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
    let found = items.find(item => {
      const normalizedItem = normalizeString(item.nombre);
      if (normalizedItem === normalizedInput) return true;
      for (const [canonical, variations] of Object.entries(aliases)) {
        if (normalizeString(canonical) === normalizedItem && variations.includes(normalizedInput)) return true;
      }
      return false;
    });
    if (found) return Number(found.id);
    for (const [canonical, variations] of Object.entries(aliases)) {
      if (variations.includes(normalizedInput)) {
        const canonicalFound = items.find(item => normalizeString(item.nombre) === normalizeString(canonical));
        if (canonicalFound) return Number(canonicalFound.id);
        const newId = await invoke<number>(addCommand, { nombre: canonical });
        await fetchItems();
        return newId;
      }
    }
    const newId = await invoke<number>(addCommand, { nombre: name });
    await fetchItems();
    return newId;
  }

  async function fetchGrados(colegioId: number, anoId: number, isModalFlag = false) {
    try {
      let data: CategoryItem[] = [];
      if (colegioId && anoId) data = await invoke<CategoryItem[]>("get_grados_by_colegio", { colegioId: Number(colegioId), anoLectivoId: Number(anoId) });
      if (isModalFlag && data.length === 0) data = await invoke<CategoryItem[]>("get_grados");
      if (isModalFlag) modalGrados = data; else grados = data;
      return data;
    } catch (error) { console.error("Error fetching grados:", error); return []; }
  }

  async function fetchSecciones(gradoId: number, colegioId: number, anoId: number, isModalFlag = false) {
    try {
      let data: CategoryItem[] = [];
      if (gradoId && colegioId && anoId) data = await invoke("get_secciones_by_grado_colegio", { gradoId: Number(gradoId), colegioId: Number(colegioId), anoLectivoId: Number(anoId) });
      if (isModalFlag && data.length === 0) data = await invoke<CategoryItem[]>("get_secciones");
      if (isModalFlag) modalSecciones = data; else secciones = data;
      return data;
    } catch (error) { console.error("Error fetching secciones:", error); return []; }
  }

async function fetchData(preserveFilters = false) {
  try {
    const [sData, aData, colData, gData, secData] = await Promise.all([
      invoke<Student[]>("get_students"),
      invoke<CategoryItem[]>("get_anos"),
      invoke<CategoryItem[]>("get_colegios"),
      invoke<CategoryItem[]>("get_grados"),
      invoke<CategoryItem[]>("get_secciones"),
    ]);
    anos = aData; colegios = colData; students = sData; allGrados = gData; allSecciones = secData;
    const activeYear = aData.find(a => a.activo) || aData[0];
    const activeYearId = activeYear?.id ?? 0;
    const activeColegio = colData.find(c => c.activo) || colData[0];
    const activeColegioId = activeColegio?.id ?? 0;
    if (!preserveFilters) {
      filters = { ...filters, anoLectivoId: activeYearId, colegioId: activeColegioId, gradoId: 0, seccionId: 0 };
    }
    if (!isEditing) formData = { ...formData, anoLectivoId: formData.anoLectivoId || activeYearId, colegioId: formData.colegioId || activeColegioId };
    checkPromotionEligibility();
    return { students: sData, anos: aData, colegios: colData };
  } catch (error) { console.error("Error fetching data:", error); return null; }
}

  async function handleImportExcel() {
    try {
      const XLSX = await import("xlsx");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const selected = await open({ multiple: false, filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }] });
      if (!selected || Array.isArray(selected)) return;
      isImporting = true;
      const fileContent = await readFile(selected);
      if (!fileContent) throw new Error("No se pudo leer el archivo");
      const wb = XLSX.read(fileContent, { type: 'array' });
      const hojaDataMap: Map<string, any[]> = new Map();
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(ws);
        if (Array.isArray(sheetData) && sheetData.length > 0) hojaDataMap.set(sheetName, sheetData);
      }
      if (hojaDataMap.size === 0) throw new Error("No se encontraron datos en ninguna de las hojas del archivo");
      let importedCount = 0; let errors = 0; let skippedCount = 0; let lastImportedFilter = { ...filters }; const newlyImportedStudents: Student[] = [];
      const freshData = await fetchData(true);
      if (!freshData) throw new Error("No se pudieron cargar los datos del sistema");
      let currentAnos = [...freshData.anos]; let currentColegios = [...freshData.colegios];
      let currentGrados = await invoke<CategoryItem[]>("get_grados"); let currentSecciones = await invoke<CategoryItem[]>("get_secciones"); let currentStudentsList = [...freshData.students];
      const refreshAnos = async () => { const a = await invoke<CategoryItem[]>("get_anos"); anos = a; currentAnos = a; return a; };
      const refreshColegios = async () => { const c = await invoke<CategoryItem[]>("get_colegios"); colegios = c; currentColegios = c; return c; };
      const refreshGrados = async () => { const g = await invoke<CategoryItem[]>("get_grados"); grados = g; currentGrados = g; return g; };
      const refreshSecciones = async () => { const s = await invoke<CategoryItem[]>("get_secciones"); secciones = s; currentSecciones = s; return s; };
      const resolveId = async (val: any, items: CategoryItem[], addCmd: string, refreshFn: () => Promise<CategoryItem[]>, type: string, filterId: number) => {
        if (val === undefined || val === null || val === "" || typeof val === 'boolean') return filterId;
        const numericVal = Number(val);
        if (!isNaN(numericVal) && numericVal > 0) { const found = items.find(item => Number(item.id) === numericVal); if (found) return numericVal; }
        return await findOrCreateItem(String(val), items, addCmd, refreshFn, type);
      };
      let rowIndex = 0;
      for (const [sheetName, sheetData] of hojaDataMap) {
        for (let i = 0; i < sheetData.length; i++) {
          const row = sheetData[i]; rowIndex++;
          try {
            const nombre = row.Nombre || row.Estudiante || row.nombre || row.estudiante || row["Nombre Completo"] || row["NOMBRE"] || row["Estudiantes"];
            if (!nombre) { skippedCount++; continue; }
            const rawAno = row["Año Lectivo"] || row.Año || row.Ano || row.Periodo || row.ano || row.año || row["AÑO LECTIVO"] || row["AÑO"];
            const rawColegio = row.Colegio || row.Escuela || row.Centro || row.colegio || row["COLEGIO"] || row["CENTRO"] || row["ESCUELA"] || sheetName;
            const rawGrado = row.Grado || row.Nivel || row.grado || row["GRADO"] || row["NIVEL"];
            const rawSeccion = row.Seccion || row["Sección"] || row.Grupo || row.Aula || row.seccion || row["SECCION"] || row["SECCIÓN"] || row["GRUPO"] || row["AULA"];
            const anoId = await resolveId(rawAno, currentAnos, "add_ano", refreshAnos, 'ano', filters.anoLectivoId);
            const colegioId = await resolveId(rawColegio, currentColegios, "add_colegio", refreshColegios, 'colegio', filters.colegioId);
            const gradoId = await resolveId(rawGrado, currentGrados, "add_grado", refreshGrados, 'grado', filters.gradoId);
            let seccionId = 0;
            const trimmedRawSeccion = String(rawSeccion || "").trim();
            if (trimmedRawSeccion) { seccionId = await resolveId(trimmedRawSeccion, currentSecciones, "add_seccion", refreshSecciones, 'seccion', 0); }
            if (!seccionId || seccionId === 0) seccionId = await findOrCreateItem("Unica", currentSecciones, "add_seccion", refreshSecciones, 'seccion');
            if (!anoId || !colegioId || !gradoId || !seccionId) { errors++; continue; }
            const isDuplicate = currentStudentsList.some(s => normalizeString(s.nombre) === normalizeString(nombre) && Number(s.anoLectivoId) === Number(anoId) && Number(s.gradoId) === Number(gradoId) && Number(s.seccionId) === Number(seccionId) && Number(s.colegioId) === Number(colegioId));
            if (isDuplicate) { skippedCount++; lastImportedFilter = { ...lastImportedFilter, anoLectivoId: Number(anoId), colegioId: Number(colegioId), gradoId: Number(gradoId), seccionId: Number(seccionId) }; continue; }
            let codigo = row.Codigo || row.codigo || row.ID || row.id || row["CODIGO"] || row["Código"] || "";
            if (!codigo) { const numericCodes = currentStudentsList.map(s => parseInt(s.codigo)).filter(code => !isNaN(code)); const nextCode = numericCodes.length > 0 ? Math.max(...numericCodes) + 1 : 1; codigo = nextCode.toString().padStart(4, '0'); }
            const rawSexo = (row.Sexo || row.sexo || row.Genero || row.genero || row["SEXO"] || row["Género"] || "M").toString().toUpperCase();
            const sexo = rawSexo.startsWith("F") || rawSexo === "MUJER" || rawSexo === "FEMENINO" ? "F" : "M";
            const newStudent: Student = {
              nombre: toTitleCase(String(nombre)), codigo: String(codigo).trim(), sexo, anoLectivoId: Number(anoId), gradoId: Number(gradoId), seccionId: Number(seccionId), colegioId: Number(colegioId),
              telefono: String(row.Telefono || row.telefono || row["TELEFONO"] || row["Teléfono"] || "").trim(),
              direccion: String(row.Direccion || row.direccion || row["DIRECCION"] || row["Dirección"] || "").trim(),
              email: String(row.Email || row.email || row["EMAIL"] || "").trim(),
            };
            const studentId = await invoke<number>("add_student", { student: newStudent });
            const studentWithId = { ...newStudent, id: studentId };
            currentStudentsList.push(studentWithId); students = [...students, studentWithId]; newlyImportedStudents.push(studentWithId);
            lastImportedFilter = { ...lastImportedFilter, anoLectivoId: Number(anoId), colegioId: Number(colegioId), gradoId: Number(gradoId), seccionId: Number(seccionId) };
          } catch (err) { console.error(`Error al procesar fila ${rowIndex}:`, row, err); errors++; }
        }
      }
      if (newlyImportedStudents.length > 0) onDataChange('estudiante', { immediate: true });
      if (importedCount > 0 || skippedCount > 0) {
        filters = lastImportedFilter;
        await emit("student-updated", { timestamp: Date.now() }); await emit("catalog-updated");
        setTimeout(async () => { await fetchData(true); }, 100);
      } else { await emit("student-updated", { timestamp: Date.now() }); await emit("catalog-updated"); await fetchData(true); }
      await emit("show-toast", { message: `✅ Importación Finalizada\nÉxito: ${importedCount} | Omitidos: ${skippedCount} | Errores: ${errors}`, type: 'success' });
    } catch (err) {
      console.error("Error crítico en importación:", err);
      await emit("show-toast", { message: "❌ Error de Importación: " + ((err as any).message || "Fallo al abrir el archivo"), type: 'error' });
    } finally { isImporting = false; }
  }

  async function handleDownloadTemplate() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const headers = ['Nombre', 'Sexo', 'Año Lectivo', 'Colegio', 'Grado', 'Sección', 'Teléfono', 'Dirección', 'Email'];
    const sampleRow = ['Juan Pérez', 'M', '2026', 'San José', '1ro', 'A', '04141234567', 'Calle Principal', 'juan@email.com'];
    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    ws['!cols'] = headers.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Estudiantes');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      const path = await save({ filters: [{ name: "Excel", extensions: ["xlsx"] }], defaultPath: "plantilla_importacion_estudiantes.xlsx" });
      if (path) {
        await writeFile(path, out);
        emit("show-toast", { message: `✅ Plantilla guardada en ${path}`, type: "success" });
        openUrl(path);
      }
    } catch {
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'plantilla_importacion_estudiantes.xlsx';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      emit("show-toast", { message: "✅ Plantilla descargada: plantilla_importacion_estudiantes.xlsx", type: "success" });
    }
  }

  function handleFilterChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const { name, value } = target;
    const val = name === 'sexo' ? value : Number(value);
    const newFilters = { ...filters, [name]: val };
    if (name === 'colegioId' || name === 'anoLectivoId') { newFilters.gradoId = 0; newFilters.seccionId = 0; }
    else if (name === 'gradoId') newFilters.seccionId = 0;
    filters = newFilters;
  }

  $effect(() => {
    if (filters.colegioId > 0 && filters.anoLectivoId > 0) {
      fetchGrados(filters.colegioId, filters.anoLectivoId).then(loadedGrados => {
        if (filters.gradoId === 0 && loadedGrados.length > 0) {
          filters = { ...filters, gradoId: loadedGrados[0].id };
        }
      });
    }
  });

  $effect(() => {
    if (filters.gradoId > 0 && filters.colegioId > 0 && filters.anoLectivoId > 0) {
      fetchSecciones(filters.gradoId, filters.colegioId, filters.anoLectivoId).then(loadedSecciones => {
        if (filters.seccionId === 0 && loadedSecciones.length > 0) {
          filters = { ...filters, seccionId: loadedSecciones[0].id };
        }
      });
    } else secciones = [];
  });

  function handleFormChange(e: Event) {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const { name, value } = target;
    const val = (name === 'nombre' || name === 'codigo' || name === 'sexo' || name === 'telefono' || name === 'direccion' || name === 'email') ? value : Number(value);
    const newData = { ...formData, [name]: val };
    if (name === 'colegioId' || name === 'anoLectivoId') { newData.gradoId = 0; newData.seccionId = 0; }
    else if (name === 'gradoId') newData.seccionId = 0;
    formData = newData;
  }

  $effect(() => {
    if (!isModalOpen) { modalGrados = []; modalSecciones = []; return; }
    // El catálogo de grados es global: mostrar TODOS sin filtrar por colegio/año
    invoke<CategoryItem[]>("get_grados").then(data => {
      modalGrados = data;
      if (!formData.gradoId || !data.some(g => g.id === formData.gradoId)) {
        formData = { ...formData, gradoId: data[0]?.id ?? 0, seccionId: 0 };
      }
    });
  });

  $effect(() => {
    if (!isModalOpen) return;
    // El catálogo de secciones es global: mostrar TODAS sin filtrar por grado/colegio/año
    invoke<CategoryItem[]>("get_secciones").then(data => {
      modalSecciones = data;
      if (!formData.seccionId || !data.some(s => s.id === formData.seccionId)) {
        formData = { ...formData, seccionId: data[0]?.id ?? 0 };
      }
    });
  });

  function openAddModal() {
    isEditing = false;
    const activeYear = anos.find(a => a.activo) || anos[0];
    const activeYearId = activeYear?.id ?? 0;
    const activeColegio = colegios.find(c => c.activo) || colegios[0];
    const activeColegioId = activeColegio?.id ?? 0;
    formData = {
      ...emptyStudent,
      anoLectivoId: filters.anoLectivoId || activeYearId,
      colegioId: filters.colegioId || activeColegioId,
      gradoId: filters.gradoId || 0,
      seccionId: filters.seccionId || 0,
    };
    modalGrados = []; modalSecciones = [];
    isModalOpen = true;
  }

  function openEditModal(student: Student) {
    isEditing = true;
    formData = { ...student, nombre: toTitleCase(student.nombre) };
    photoPreview = student.foto || null;
    modalGrados = []; modalSecciones = [];
    isModalOpen = true;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const esEdicion = isEditing;
    const mensaje = esEdicion
      ? `¿Guardar los cambios de "${toTitleCase(formData.nombre).trim()}"?`
      : "¿Registrar este nuevo estudiante?";
    const ok = await ask(mensaje, {
      title: esEdicion ? "✏️ Confirmar edición" : "➕ Confirmar registro",
      kind: "info",
      okLabel: esEdicion ? "Guardar" : "Registrar",
      cancelLabel: "Cancelar",
    });
    if (!ok) return;
    try {
      let studentToSave = { ...formData, nombre: toTitleCase(formData.nombre).trim() };
      if (!studentToSave.codigo.trim()) {
        const numericCodes = students.map(s => parseInt(s.codigo)).filter(code => !isNaN(code));
        const nextCode = numericCodes.length > 0 ? Math.max(...numericCodes) + 1 : 1;
        studentToSave.codigo = nextCode.toString().padStart(4, '0');
      }
      if (isEditing) {
        studentToSave.foto = photoPreview || undefined;
        await invoke("update_student", { student: studentToSave });
        onDataChange('estudiante', { immediate: true });
        await emit("student-updated", { timestamp: Date.now() });
        await emit("catalog-updated", { timestamp: Date.now() });
        await emit("show-toast", { message: '✅ Estudiante actualizado correctamente', type: 'success' });
      } else {
        const newStudentWithFoto = { ...studentToSave, foto: photoPreview || undefined };
        const newId = await invoke<number>("add_student", { student: newStudentWithFoto });
        onDataChange('estudiante', { immediate: true });
        await emit("student-updated", { timestamp: Date.now() });
        await emit("catalog-updated", { timestamp: Date.now() });
        await emit("show-toast", { message: '✅ Estudiante registrado correctamente', type: 'success' });
      }
      formData = { ...emptyStudent };
      await fetchData(true);
      isModalOpen = false;
    } catch (error) {
      console.error("Error saving student:", error);
      await emit("show-toast", { message: "❌ Error al guardar: " + error, type: 'error' });
    }
  }

  async function handleDelete(id: number) {
    let impactMessage = '¿Está seguro de eliminar este estudiante?';
    try {
      const impact = await invoke<{ totalNotas: number; totalAsistencias: number }>("get_student_impact", { studentId: id });
      const student = students.find(s => s.id === id);
      const studentName = student ? student.nombre : 'este estudiante';
      impactMessage = `¿Está seguro de eliminar a ${studentName}?`;
      if (impact.totalNotas > 0 || impact.totalAsistencias > 0) {
        impactMessage += `\n\n⚠️ ATENCIÓN: Esta acción eliminará permanentemente:`;
        if (impact.totalNotas > 0) impactMessage += `\n- ${impact.totalNotas} Calificaciones registradas`;
        if (impact.totalAsistencias > 0) impactMessage += `\n- ${impact.totalAsistencias} Registros de asistencia`;
        impactMessage += `\n\nEsta acción no se puede deshacer.`;
      }
    } catch (error) {
      console.error("Error getting student impact:", error);
    }
    studentToDeleteId = id;
    const ok = await ask(impactMessage, { title: 'Eliminar estudiante', kind: 'warning', okLabel: 'Eliminar', cancelLabel: 'Cancelar' });
    if (ok) await confirmDelete();
  }

  async function confirmDelete() {
    if (studentToDeleteId === null) return;
    isDeleting = true;
    const idToDelete = studentToDeleteId;
    try {
      await invoke("delete_student", { id: idToDelete });
      students = students.filter(s => s.id !== idToDelete);
      studentToDeleteId = null;
      await emit("show-toast", { message: '✅ Estudiante eliminado correctamente', type: 'success' });
      await emit("student-updated", { timestamp: Date.now() });
      onDataChange('estudiante', { immediate: true });
      setTimeout(() => { fetchData(true); }, 200);
    } catch (error) {
      console.error("Error deleting student:", error);
      await emit("show-toast", { message: "❌ Error al eliminar: " + error, type: 'error' });
    } finally { isDeleting = false; }
  }

  async function handleBatchDelete() {
    const ids = filteredStudents.map(s => s.id!);
    if (ids.length === 0) return;
    const ok = await ask(`¿Eliminar TODOS los estudiantes filtrados (${ids.length})? Esta acción no se puede deshacer.`, { title: 'Eliminar en lote', kind: 'warning', okLabel: 'Eliminar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    isDeleting = true;
    try {
      await invoke("delete_student_batch", { ids });
      students = students.filter(s => !ids.includes(s.id!));
      await emit("show-toast", { message: `✅ ${ids.length} estudiantes eliminados correctamente`, type: "success" });
      await emit("student-updated", { timestamp: Date.now() });
      onDataChange('estudiante', { immediate: true });
      setTimeout(() => { fetchData(true); }, 200);
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al eliminar en lote: " + error, type: "error" });
    } finally { isDeleting = false; }
  }

  function toggleSelect(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  function selectAllFiltered() {
    selectedIds = new Set(filteredStudents.map(s => s.id!));
    selectMode = true;
  }

  function clearSelection() {
    selectedIds = new Set();
    selectMode = false;
  }

  async function deleteSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = await ask(`¿Eliminar los ${ids.length} estudiantes seleccionados? Esta acción no se puede deshacer.`, { title: 'Eliminar selección', kind: 'warning', okLabel: 'Eliminar', cancelLabel: 'Cancelar' });
    if (!ok) return;
    isDeletingSelected = true;
    const count = ids.length;
    try {
      await invoke("delete_student_batch", { ids });
      students = students.filter(s => !ids.includes(s.id!));
      selectedIds = new Set();
      selectMode = false;
      await emit("show-toast", { message: `✅ ${count} estudiantes eliminados correctamente`, type: "success" });
      await emit("student-updated", { timestamp: Date.now() });
      onDataChange('estudiante', { immediate: true });
      setTimeout(() => { fetchData(true); }, 200);
    } catch (error) {
      await emit("show-toast", { message: "❌ Error al eliminar: " + error, type: "error" });
    } finally { isDeletingSelected = false; }
  }

  $effect(() => { if (!isAndroid) localStorage.setItem('estudiantes-view-mode', viewMode); });

  // Refresca lista y dropdowns (grado/sección) ante cualquier cambio de catálogo, estudiante o sync
  async function refreshAll() {
    await fetchData(true);
    if (filters.colegioId > 0 && filters.anoLectivoId > 0) {
      grados = await fetchGrados(filters.colegioId, filters.anoLectivoId);
    }
    if (filters.gradoId > 0 && filters.colegioId > 0 && filters.anoLectivoId > 0) {
      secciones = await fetchSecciones(filters.gradoId, filters.colegioId, filters.anoLectivoId);
    }
  }

  async function checkPromotionEligibility() {
    try {
      const allAnos = await invoke<CategoryItem[]>("get_anos");
      const activeAno = allAnos.find(a => a.activo);
      if (!activeAno) { showPromoteBanner = false; return; }

      const activeNum = parseInt(activeAno.nombre);
      if (isNaN(activeNum)) { showPromoteBanner = false; return; }

      const nextCandidates = allAnos
        .filter(a => a.id !== activeAno.id)
        .map(a => ({ ...a, _num: parseInt(a.nombre) }))
        .filter(a => !isNaN(a._num) && a._num > activeNum)
        .sort((a, b) => a._num - b._num);
      if (nextCandidates.length === 0) { showPromoteBanner = false; return; }

      const nextAno = nextCandidates[0];
      const activeCount = students.filter(s => s.anoLectivoId === activeAno.id).length;

      if (activeCount > 0) {
        promoteFromAno = activeAno;
        promoteToAno = nextAno;
        promoteStudentCount = activeCount;
        showPromoteBanner = true;
      } else {
        showPromoteBanner = false;
      }
    } catch (e) {
      console.error("Error checking promotion:", e);
    }
  }

  async function handlePromoteStudents() {
    if (!promoteFromAno || !promoteToAno) return;
    const ok = await ask(
      `¿Promover ${promoteStudentCount} estudiantes de "${promoteFromAno.nombre}" a "${promoteToAno.nombre}"?\n\nLos estudiantes subirán de grado (1er→2do, 2do→3ro...). Los de 11mo grado se marcarán como graduados.\n\nLos estudiantes de6to grado (Primaria) serán migrados a un colegio Secundaria si existe.`,
      { title: "📈 Confirmar promoción", kind: "info", okLabel: "Promover", cancelLabel: "Cancelar" }
    );
    if (!ok) return;
    isPromoting = true;
    try {
      const result = await invoke<{ promoted: number; graduated: number; pendingSixthGraders: any[] }>("promote_students", {
        fromAnoId: promoteFromAno.id,
        toAnoId: promoteToAno.id,
      });

      // Si hay estudiantes de6to grado pendientes (múltiples colegios Secundaria)
      if (result.pendingSixthGraders && result.pendingSixthGraders.length > 0) {
        pendingSixthGraders = result.pendingSixthGraders;
        // Obtener colegios Secundaria disponibles
        secundariaColegios = await invoke<{ id: number; nombre: string; tipo: string }[]>("get_secundaria_colegios");
        if (secundariaColegios.length > 0) {
          selectedColegioId = secundariaColegios[0].id;
          showColegioPicker = true;
          isPromoting = false;
          return;
        }
      }

      let msg = `✅ Promoción completada: ${result.promoted} promovidos`;
      if (result.graduated > 0) msg += `, ${result.graduated} graduados`;
      await emit("show-toast", { message: msg, type: "success" });
      await emit("student-updated", { timestamp: Date.now() });
      await emit("catalog-updated", { timestamp: Date.now() });
      onDataChange("estudiante", { immediate: true });
      showPromoteBanner = false;
      await fetchData(true);
    } catch (e) {
      console.error("Error promoting:", e);
      await emit("show-toast", { message: "❌ Error al promover: " + e, type: "error" });
    } finally {
      isPromoting = false;
    }
  }

  async function handleColegioSelected() {
    if (!promoteFromAno || !promoteToAno || selectedColegioId === 0) return;
    showColegioPicker = false;
    isPromoting = true;
    try {
      // Construir el mapa de colegio origen → colegio destino para los estudiantes pendientes
      const colegioDestinoMap: Record<number, number> = {};
      for (const pg of pendingSixthGraders) {
        colegioDestinoMap[pg.colegioOrigenId] = selectedColegioId;
      }
      const result = await invoke<{ promoted: number; graduated: number; pendingSixthGraders: any[] }>("promote_students", {
        fromAnoId: promoteFromAno.id,
        toAnoId: promoteToAno.id,
        colegioDestinoMap,
      });
      let msg = `✅ Promoción completada: ${result.promoted} promovidos`;
      if (result.graduated > 0) msg += `, ${result.graduated} graduados`;
      await emit("show-toast", { message: msg, type: "success" });
      await emit("student-updated", { timestamp: Date.now() });
      await emit("catalog-updated", { timestamp: Date.now() });
      onDataChange("estudiante", { immediate: true });
      showPromoteBanner = false;
      await fetchData(true);
    } catch (e) {
      console.error("Error promoting:", e);
      await emit("show-toast", { message: "❌ Error al promover: " + e, type: "error" });
    } finally {
      isPromoting = false;
      pendingSixthGraders = [];
    }
  }

  onMount(() => {
    fetchData();
    const checkMobile = () => { isMobile = window.innerWidth <= 768; };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    const u1 = listen("catalog-updated", () => refreshAll());
    const u2 = listen("student-updated", () => refreshAll());
    const onSync = () => refreshAll();
    window.addEventListener('schooltracker-sync', onSync);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('schooltracker-sync', onSync);
      u1.then(f => f()); u2.then(f => f());
    };
  });
</script>
{#if !isAndroidMobile}<SearchFab bind:value={searchTerm} placeholder="Nombre o codigo..." />{/if}


<div class="page-container" id="estudiantes-page" style="height: 100%; min-height: 0;">
  {#if isAndroidMobile}
    <div class="category-card" style="padding: 0.4rem 0.5rem; margin-bottom: 0.4rem;">
      <input bind:value={searchTerm} placeholder="🔍 Buscar nombre o código..."
        style="width:100%;height:38px;padding:0 0.8rem;font-size:0.82rem;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;outline:none;box-sizing:border-box;" />
    </div>
    <div class="category-card" style="padding: 0.5rem; margin-bottom: 0.4rem; display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
      <button type="button" onclick={() => { showFiltersModal = true; }}
        style="height:38px;padding:0 0.8rem;font-size:0.78rem;background:rgba(96,165,250,0.18);color:#bfdbfe;border:1px solid rgba(96,165,250,0.4);border-radius:8px;display:flex;align-items:center;justify-content:center;gap:5px;font-weight:600;cursor:pointer;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        <span>🔍</span>
        <span style="overflow:hidden;text-overflow:ellipsis;">
          {colegios.find(c => c.id === filters.colegioId)?.nombre || 'Colegio'} · {grados.find(g => g.id === filters.gradoId)?.nombre || 'Grado'} · {secciones.find(s => s.id === filters.seccionId)?.nombre || 'Sección'}{filters.sexo ? ` · ${filters.sexo === 'M' ? 'Masc' : 'Fem'}` : ''}
        </span>
      </button>
    </div>
    <div class="category-card" style="padding: 0.5rem; margin-bottom: 0.4rem; display:flex;gap:0.3rem;align-items:center;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;">
      <button onclick={openAddModal}
        style="height:42px;padding:0 0.9rem;font-size:0.75rem;background:linear-gradient(135deg,var(--primary-hover),var(--primary-color));color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 14px rgba(var(--primary-rgb),0.4);flex-shrink:0;white-space:nowrap">
        <span style="font-size:1rem">👨‍🎓</span>
      </button>
      <button onclick={handleImportExcel} disabled={isImporting}
        style="height:42px;padding:0 0.9rem;font-size:0.75rem;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:{isImporting ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(5,150,105,0.4);flex-shrink:0;white-space:nowrap;opacity:{isImporting ? 0.7 : 1}">
        <span style="font-size:1rem">{isImporting ? "⌛" : "📗"}</span>
      </button>
      <button onclick={handleDownloadTemplate}
        style="height:42px;padding:0 0.9rem;font-size:0.75rem;border:1px solid rgba(168,85,247,0.3);background:rgba(168,85,247,0.1);color:#c084fc;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700;cursor:pointer;transition:all 0.2s ease;flex-shrink:0;white-space:nowrap"
        title="Descargar plantilla Excel">📋</button>
      <button onclick={() => showImportHelp = true}
        style="height:42px;width:42px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.1);color:#94a3b8;border-radius:8px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:1.1rem;font-weight:700;flex-shrink:0;transition:all 0.2s ease"
        title="Ayuda de importación">?</button>
    </div>

    {#if showFiltersModal}
      <div class="modal-overlay" onclick={() => showFiltersModal = false} style="z-index:2000">
        <div class="modal-content" onclick={(e) => e.stopPropagation()}
          style="width:min(380px, calc(100vw - 32px));max-width:min(380px, calc(100vw - 32px));max-height:85vh;overflow-y:auto;background:#1e293b;border:1px solid rgba(148,163,184,0.35);border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,0.6);padding:1.25rem;text-align:left;position:relative">
          <button type="button" onclick={() => showFiltersModal = false} title="Cerrar"
            style="position:absolute;top:.6rem;right:.6rem;width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#1e293b;color:#e2e8f0;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>
          <h3 style="margin:0 0 1rem;color:#f1f5f9;font-size:1.05rem;padding-right:2.2rem">🔍 Filtros</h3>
          <div style="display:flex;flex-direction:column;gap:0.6rem">
            <div style="display:flex;flex-direction:column;gap:4px;flex:1 1 100%">
              <label style="font-size:0.7rem;color:#94a3b8;font-weight:600">Año lectivo:</label>
              <select class="filter-select"
                style="width:100%;height:38px;padding:0 0.6rem;font-size:0.85rem;border-radius:8px;background:#0f172a;border:1px solid rgba(148,163,184,0.45);color:#f1f5f9;font-weight:600;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e&quot;);background-repeat:no-repeat;background-position:right 0.6rem center;background-size:14px;padding-right:1.8rem"
                value={filters.anoLectivoId} onchange={(e) => { filters = { ...filters, anoLectivoId: Number((e.target as HTMLSelectElement).value), gradoId: 0, seccionId: 0 }; }}>
                {#each anos as a}<option value={a.id}>{a.nombre}{#if a.activo} ✓ (Activo){/if}</option>{/each}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1 1 100%">
              <label style="font-size:0.7rem;color:#94a3b8;font-weight:600">Colegio:</label>
              <select class="filter-select"
                style="width:100%;height:38px;padding:0 0.6rem;font-size:0.85rem;border-radius:8px;background:#0f172a;border:1px solid rgba(148,163,184,0.45);color:#f1f5f9;font-weight:600;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e&quot;);background-repeat:no-repeat;background-position:right 0.6rem center;background-size:14px;padding-right:1.8rem"
                value={filters.colegioId} onchange={(e) => { filters = { ...filters, colegioId: Number((e.target as HTMLSelectElement).value), gradoId: 0, seccionId: 0 }; }}>
                {#each colegios as c}<option value={c.id}>{c.nombre}{#if c.activo} ✓ (Activo){/if}</option>{/each}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1 1 100%">
              <label style="font-size:0.7rem;color:#94a3b8;font-weight:600">Grado:</label>
              <select class="filter-select"
                style="width:100%;height:38px;padding:0 0.6rem;font-size:0.85rem;border-radius:8px;background:#0f172a;border:1px solid rgba(148,163,184,0.45);color:#f1f5f9;font-weight:600;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e&quot;);background-repeat:no-repeat;background-position:right 0.6rem center;background-size:14px;padding-right:1.8rem"
                value={filters.gradoId} onchange={(e) => { filters = { ...filters, gradoId: Number((e.target as HTMLSelectElement).value), seccionId: 0 }; }}>
                {#each grados as g}<option value={g.id}>{g.nombre}</option>{/each}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1 1 100%">
              <label style="font-size:0.7rem;color:#94a3b8;font-weight:600">Sección:</label>
              <select class="filter-select"
                style="width:100%;height:38px;padding:0 0.6rem;font-size:0.85rem;border-radius:8px;background:#0f172a;border:1px solid rgba(148,163,184,0.45);color:#f1f5f9;font-weight:600;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e&quot;);background-repeat:no-repeat;background-position:right 0.6rem center;background-size:14px;padding-right:1.8rem"
                value={filters.seccionId} onchange={(e) => { filters = { ...filters, seccionId: Number((e.target as HTMLSelectElement).value) }; }}>
                {#each secciones as s}<option value={s.id}>{s.nombre}</option>{/each}
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1 1 100%">
              <label style="font-size:0.7rem;color:#94a3b8;font-weight:600">Sexo:</label>
              <select class="filter-select"
                style="width:100%;height:38px;padding:0 0.6rem;font-size:0.85rem;border-radius:8px;background:#0f172a;border:1px solid rgba(148,163,184,0.45);color:#f1f5f9;font-weight:600;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'/%3e%3c/svg%3e&quot;);background-repeat:no-repeat;background-position:right 0.6rem center;background-size:14px;padding-right:1.8rem"
                value={filters.sexo} onchange={(e) => { filters = { ...filters, sexo: (e.target as HTMLSelectElement).value }; }}>
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </div>
          </div>
          <button class="primary" onclick={() => showFiltersModal = false} style="margin-top:1.25rem;width:100%">✓ Aplicar</button>
        </div>
      </div>
    {/if}
  {:else}
  <FilterContainer {isMobile}>
      <FilterGroup label="Año Lectivo:" {isMobile}>
          <select name="anoLectivoId" onchange={handleFilterChange} value={filters.anoLectivoId} class="filter-select" style="width:100%">
            {#each anos as a}
              <option value={a.id}>{a.nombre}{#if a.activo} ✓ (Activo){/if}</option>
            {/each}
          </select>
      </FilterGroup>
      <FilterGroup label="Colegio:" {isMobile}>
          <select name="colegioId" onchange={handleFilterChange} value={filters.colegioId} class="filter-select" style="width:100%">
            {#each colegios as c}
              <option value={c.id}>{c.nombre}{#if c.activo} ✓ (Activo){/if}</option>
            {/each}
          </select>
      </FilterGroup>
      <FilterGroup label="Grado:" {isMobile}>
          <select name="gradoId" onchange={handleFilterChange} value={filters.gradoId} class="filter-select" style="width:100%">
            {#each grados as g}
              <option value={g.id}>{g.nombre}</option>
            {/each}
          </select>
      </FilterGroup>
  <FilterGroup label="Sección:" {isMobile}>
    <select name="seccionId" onchange={handleFilterChange} value={filters.seccionId} class="filter-select" style="width:100%" key={secciones.length}>
      {#each secciones as s}
      <option value={s.id}>{s.nombre}</option>
      {/each}
    </select>
  </FilterGroup>
      <FilterGroup label="Sexo:" {isMobile}>
          <select name="sexo" onchange={handleFilterChange} value={filters.sexo} class="filter-select" style="width:100%">
            <option value="">Todos</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
          </select>
      </FilterGroup>
      <div style="display:flex;gap:0.3rem;align-items:flex-end;flex:{isMobile ? '1 1 100%' : '0 0 auto'}">
        <div style="flex:1;min-width:100px">
        </div>
        <button onclick={openAddModal}
          style="height:42px;padding:0 1.25rem;font-size:0.85rem;background:linear-gradient(135deg,var(--primary-hover),var(--primary-color));color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:pointer;transition:all 0.2s ease;box-shadow:0 4px 14px rgba(var(--primary-rgb),0.4);flex-shrink:0;white-space:nowrap">
          <span style="font-size:1.1rem">👨‍🎓</span>
          {#if !isMobile}<span>Nuevo</span>{/if}
        </button>
        <button onclick={handleImportExcel} disabled={isImporting}
          style="height:42px;padding:0 1.25rem;font-size:0.85rem;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:{isImporting ? 'default' : 'pointer'};transition:all 0.2s ease;box-shadow:0 4px 14px rgba(5,150,105,0.4);flex-shrink:0;white-space:nowrap;opacity:{isImporting ? 0.7 : 1}">
          <span style="font-size:1.1rem">{isImporting ? "⌛" : "📗"}</span>
          {#if !isMobile}<span>{isImporting ? "Importando..." : "Excel"}</span>{/if}
        </button>
        <button onclick={handleDownloadTemplate}
          style="height:42px;padding:0 1.25rem;font-size:0.85rem;border:1px solid rgba(168,85,247,0.3);background:rgba(168,85,247,0.1);color:#c084fc;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;cursor:pointer;transition:all 0.2s ease;flex-shrink:0;white-space:nowrap"
          title="Descargar plantilla Excel">📋 {#if !isMobile}<span>Plantilla</span>{/if}</button>
        <button onclick={() => showImportHelp = true}
          style="height:42px;width:42px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.1);color:#94a3b8;border-radius:8px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:1.1rem;font-weight:700;flex-shrink:0;transition:all 0.2s ease"
          title="Ayuda de importación">?</button>
      </div>
  </FilterContainer>
  {/if}

  {#if showPromoteBanner && promoteFromAno && promoteToAno}
    <div style="margin-top: 0.75rem; padding: 0.85rem 1rem; background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.12)); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 12px; {isMobile ? 'margin-left: 0.25rem; margin-right: 0.25rem;' : ''}">
      <div style="display: flex; align-items: center; gap: 0.75rem; {isMobile ? 'flex-wrap: wrap;' : ''}">
        <div style="width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">📈</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 700; color: #e0e7ff; font-size: {isMobile ? '0.8rem' : '0.9rem'};">Promover estudiantes</div>
          <div style="color: #c7d2fe; font-size: {isMobile ? '0.7rem' : '0.8rem'}; margin-top: 2px;">
            <strong>{promoteStudentCount}</strong> estudiantes en <strong>{promoteFromAno.nombre}</strong> → <strong>{promoteToAno.nombre}</strong>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; {isMobile ? 'width: 100%;' : ''}">
          <button onclick={handlePromoteStudents} disabled={isPromoting}
            style="{isMobile ? 'flex: 1;' : ''} padding: 0.45rem 1rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; font-size: 0.8rem; white-space: nowrap;">
            {isPromoting ? '⏳ Promoviendo...' : '📈 Promover'}
          </button>
          <button onclick={() => showPromoteBanner = false}
            style="padding: 0.45rem 0.8rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #c7d2fe; font-weight: 600; cursor: pointer; font-size: 0.8rem;">
            Descartar
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showColegioPicker}
    <div style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:overlayIn 0.2s ease">
      <div style="width:min(420px,90vw);max-height:80vh;overflow-y:auto;background:rgba(20,24,31,0.92);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid rgba(255,255,255,0.1);border-radius:20px;box-shadow:0 25px 60px -12px rgba(0,0,0,0.65);padding:1.5rem">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
          <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:1.2rem">🏫</div>
          <div>
            <div style="font-weight:700;color:#e0e7ff;font-size:1rem">Migrar6to grado a Secundaria</div>
            <div style="color:#94a3b8;font-size:0.75rem;margin-top:2px">Hay {pendingSixthGraders.length} estudiante{pendingSixthGraders.length > 1 ? 's' : ''} de6to grado que {pendingSixthGraders.length > 1 ? 'necesitan' : 'necesita'} un colegio Secundaria</div>
          </div>
        </div>

        <div style="margin-bottom:1rem">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:0.5rem;font-weight:600">Estudiantes afectados</div>
          <div style="display:flex;flex-direction:column;gap:0.35rem;max-height:120px;overflow-y:auto">
            {#each pendingSixthGraders as pg}
              <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px">
                <span style="color:#e2e8f0;font-size:0.8rem;flex:1">{pg.nombre}</span>
                <span style="color:#94a3b8;font-size:0.7rem">→ {pg.colegioOrigenNombre}</span>
              </div>
            {/each}
          </div>
        </div>

        <div style="margin-bottom:1.25rem">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:0.5rem;font-weight:600">Mover a colegio Secundaria</div>
          <div style="display:flex;flex-direction:column;gap:0.35rem">
            {#each secundariaColegios as col}
              <button onclick={() => selectedColegioId = col.id}
                style="display:flex;align-items:center;gap:0.6rem;padding:0.6rem 0.75rem;border-radius:10px;cursor:pointer;text-align:left;width:100%;font-family:inherit;transition:all 0.2s ease;background:{selectedColegioId === col.id ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid {selectedColegioId === col.id ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.06)'}">
                <div style="width:20px;height:20px;border-radius:50%;border:2px solid {selectedColegioId === col.id ? '#6366f1' : 'rgba(255,255,255,0.15)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  {#if selectedColegioId === col.id}
                    <div style="width:10px;height:10px;border-radius:50%;background:#6366f1"></div>
                  {/if}
                </div>
                <span style="color:#e2e8f0;font-size:0.85rem;font-weight:600">{col.nombre}</span>
              </button>
            {/each}
          </div>
        </div>

        <div style="display:flex;gap:0.5rem;justify-content:flex-end">
          <button onclick={() => { showColegioPicker = false; pendingSixthGraders = []; }}
            style="padding:0.5rem 1rem;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;font-weight:600;cursor:pointer;font-size:0.8rem;font-family:inherit;transition:all 0.2s ease">
            Cancelar
          </button>
          <button onclick={handleColegioSelected} disabled={selectedColegioId === 0}
            style="padding:0.5rem 1.25rem;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:white;font-weight:600;cursor:pointer;font-size:0.8rem;font-family:inherit;transition:all 0.2s ease;opacity:{selectedColegioId === 0 ? 0.5 : 1}">
            Confirmar migración
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if filteredStudents.length > 0}
    <div class="student-summary-row" style="display: flex; gap: 0.5rem; margin-top: 0.8rem; padding-top: 0.8rem; border-top: 1px solid rgba(255, 255, 255, 0.1); width: 100%; {isMobile ? 'gap: 0.4rem;' : ''}">
      <div style="flex: 1; min-width: 0; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: {isMobile ? '0.3rem 0.3rem' : '0.5rem'}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; {isMobile ? 'min-height: 40px;' : 'min-height: 50px;'} border-left: 3px solid #a855f7;" title="Total de estudiantes en todos los colegios">
        <span style="font-size: {isMobile ? '0.5rem' : '0.65rem'}; color: #94a3b8; text-transform: uppercase; font-weight: bold; margin-bottom: 2px; white-space: nowrap;">{isMobile ? 'Gen' : 'General'}</span>
        <span style="font-size: {isMobile ? '0.95rem' : '1.1rem'}; font-weight: 800; line-height: 1; color: #a855f7;">{students.length}</span>
      </div>
      <div style="flex: 1; min-width: 0; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: {isMobile ? '0.3rem 0.3rem' : '0.5rem'}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; {isMobile ? 'min-height: 40px;' : 'min-height: 50px;'} border-left: 3px solid #06b6d4;" title="Total de estudiantes con los filtros actuales">
        <span style="font-size: {isMobile ? '0.5rem' : '0.65rem'}; color: #94a3b8; text-transform: uppercase; font-weight: bold; margin-bottom: 2px; white-space: nowrap;">{isMobile ? 'Tot' : 'Total'}</span>
        <span style="font-size: {isMobile ? '0.95rem' : '1.1rem'}; font-weight: 800; line-height: 1; color: #06b6d4;">{stats.total}</span>
      </div>
      <div style="flex: 1; min-width: 0; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: {isMobile ? '0.3rem 0.3rem' : '0.5rem'}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; {isMobile ? 'min-height: 40px;' : 'min-height: 50px;'} border-left: 3px solid #f472b6;" title="Cantidad de estudiantes femenino con los filtros actuales">
        <span style="font-size: {isMobile ? '0.5rem' : '0.65rem'}; color: #94a3b8; text-transform: uppercase; font-weight: bold; margin-bottom: 2px; white-space: nowrap;">{isMobile ? 'Fem' : 'Femenino'}</span>
        <span style="font-size: {isMobile ? '0.95rem' : '1.1rem'}; font-weight: 800; line-height: 1; color: #f472b6;">{stats.f}</span>
      </div>
      <div style="flex: 1; min-width: 0; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: {isMobile ? '0.3rem 0.3rem' : '0.5rem'}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; {isMobile ? 'min-height: 40px;' : 'min-height: 50px;'} border-left: 3px solid #60a5fa;" title="Cantidad de estudiantes masculino con los filtros actuales">
        <span style="font-size: {isMobile ? '0.5rem' : '0.65rem'}; color: #94a3b8; text-transform: uppercase; font-weight: bold; margin-bottom: 2px; white-space: nowrap;">{isMobile ? 'Masc' : 'Masculino'}</span>
        <span style="font-size: {isMobile ? '0.95rem' : '1.1rem'}; font-weight: 800; line-height: 1; color: #60a5fa;">{stats.m}</span>
      </div>
    </div>
  {/if}

  {#if showImportHelp}
    <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem;">
      <div class="category-card" style="max-width: 800px; width: 100%; max-height: 90vh; overflow-y: auto; position: relative; padding: 2rem;">
        <button onclick={() => showImportHelp = false} style="position: absolute; top: 1rem; right: 1rem; background: transparent; border: none; color: #94a3b8; font-size: 1.5rem; cursor: pointer;">×</button>
        <h2 style="margin-bottom: 1.5rem; color: var(--primary-color);">Guía de Importación Excel</h2>
        <p style="margin-bottom: 1rem; color: #cbd5e1;">El sistema es inteligente y detectará automáticamente las columnas. Cada hoja del Excel se procesará como un colegio separado (el nombre de la hoja será el nombre del colegio por defecto).</p>
        <div style="overflow-x: auto; margin-bottom: 1.5rem;">
          <table style="width: 100%; border-collapse: collapse; background: rgba(0,0,0,0.2); border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background: rgba(var(--primary-rgb), 0.2);">
                <th style="padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">Nombre</th>
                <th style="padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">Año</th>
                <th style="padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">Colegio</th>
                <th style="padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">Grado</th>
                <th style="padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">Sección</th>
                <th style="padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">Sexo</th>
                <th style="padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">Teléfono</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">Juan Pérez</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">2026</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">San José</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">1ro</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">A</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">M</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05); color: #64748b; font-style: italic;">Opcional</td></tr>
              <tr><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">María Sosa</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">2026</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">San José</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">1ro</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">(vacío)</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">F</td><td style="padding: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05); color: #64748b; font-style: italic;">Opcional</td></tr>
            </tbody>
          </table>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; font-size: 0.9rem;">
          <ul style="color: #94a3b8; padding-left: 1.2rem;">
            <li style="margin-bottom: 0.5rem;"><strong>Nombre:</strong> Nombre completo del alumno. Obligatorio.</li>
            <li style="margin-bottom: 0.5rem;"><strong>Año:</strong> Período escolar (2024, 2025, 2026...). Se usa el filtro actual si está vacío.</li>
            <li style="margin-bottom: 0.5rem;"><strong>Colegio:</strong> Nombre del centro. Si está vacío, usa el nombre de la hoja como colegio.</li>
            <li style="margin-bottom: 0.5rem;"><strong>Grado:</strong> Acepta "1", "1ro", "1er", "Primero", "1 grado", etc.</li>
          </ul>
          <ul style="color: #94a3b8; padding-left: 1.2rem;">
            <li style="margin-bottom: 0.5rem;"><strong>Sección:</strong> Grupo (A, B, Unica). Si está vacío, usa "Unica".</li>
            <li style="margin-bottom: 0.5rem;"><strong>Sexo:</strong> M (Masculino) o F (Femenino).</li>
            <li style="margin-bottom: 0.5rem;"><strong>Teléfono, Dirección, Email:</strong> Opcionales.</li>
            <li style="margin-bottom: 0.5rem;"><strong>Duplicados:</strong> Se ignoran estudiantes que ya existan.</li>
          </ul>
        </div>
        <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(var(--primary-rgb), 0.1); border-radius: 8px; border: 1px solid rgba(var(--primary-rgb), 0.2);">
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0;"><strong>💡 Consejo:</strong> Si tienes un Excel con estudiantes de diferentes colegios, organízalos en hojas separadas. Cada hoja se importará como un colegio distinto.</p>
        </div>
        <div style="margin-top: 2rem; text-align: center;">
          <button class="primary" onclick={() => showImportHelp = false}>Entendido</button>
        </div>
      </div>
    </div>
  {/if}

  {#if filteredStudents.length > 0}
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; margin-top: 0.2rem; flex-wrap: wrap; gap: 0.4rem;">
      <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
        {#if selectedIds.size > 0}
          <button onclick={deleteSelected} disabled={isDeletingSelected} style="padding: 0.4rem 1rem; font-size: 0.8rem; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.15); color: #fca5a5; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.4rem;">
            🗑 Eliminar ({selectedIds.size})
          </button>
          <button onclick={clearSelection} style="padding: 0.3rem 0.7rem; font-size: 0.75rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer;">Deseleccionar</button>
        {:else}
          <button onclick={selectAllFiltered} style="padding: 0.4rem 0.8rem; font-size: 0.75rem; border-radius: 8px; border: 1px solid rgba(100, 116, 139, 0.3); background: rgba(100, 116, 139, 0.1); color: #94a3b8; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;">
            ☐ Seleccionar
          </button>
          <button onclick={handleBatchDelete} disabled={isDeleting} style="padding: 0.4rem 0.8rem; font-size: 0.75rem; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.1); color: #fca5a5; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;">
            🗑 Todos ({filteredStudents.length})
          </button>
        {/if}
      </div>
      {#if !isAndroid}
      <div style="display: flex; gap: 2px; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 3px; border: 1px solid rgba(255,255,255,0.06);">
        {#each ['grid', 'list', 'card'] as mode}
          <button onclick={() => viewMode = mode}
            style="padding: {isMobile ? '4px 8px' : '5px 12px'}; font-size: {isMobile ? '0.75rem' : '0.8rem'}; font-weight: {viewMode === mode ? '700' : '500'}; border-radius: 8px; border: none; background: {viewMode === mode ? 'linear-gradient(135deg, rgba(56,189,248,0.25), rgba(99,102,241,0.25))' : 'transparent'}; color: {viewMode === mode ? '#38bdf8' : '#64748b'}; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s; white-space: nowrap;"
            title={mode === 'card' ? 'Vista tarjetas' : mode === 'list' ? 'Vista lista' : 'Vista avatares'}>
            <span>{mode === 'card' ? '▦' : mode === 'list' ? '☰' : '⊞'}</span>
            {#if !isMobile}<span>{mode === 'card' ? 'Cards' : mode === 'list' ? 'Lista' : 'Grid'}</span>{/if}
          </button>
        {/each}
      </div>
      {/if}
    </div>
  {/if}

  <div style="flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; min-width: 0; width: 100%; box-sizing: border-box;">
    {#if filteredStudents.length === 0}
      <div style="text-align: center; padding: 5rem 2rem; border: 2px dashed rgba(255, 255, 255, 0.1); border-radius: 16px; width: 100%; box-sizing: border-box;">
        <div style="font-size: 3rem; margin-bottom: 1rem;">{searchTerm ? '🔍' : '👥'}</div>
        <h4 style="color: #cbd5e1; margin-bottom: 0.5rem;">{searchTerm ? 'No se encontraron resultados' : 'No hay estudiantes registrados'}</h4>
        <p style="color: #94a3b8; max-width: 400px; margin: 0 auto;">
          {searchTerm ? `No se encontró ningún estudiante que coincida con "${searchTerm}"` : 'No hay estudiantes registrados para los filtros seleccionados (Año, Colegio, Grado, Sección).'}
        </p>
        {#if searchTerm}
          <button class="secondary" onclick={() => searchTerm = ""} style="margin-top: 1.5rem; padding: 0.5rem 1rem;">Limpiar búsqueda</button>
        {/if}
      </div>
    {:else if viewMode === 'card'}
      <div style="display: grid; grid-template-columns: {isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))'}; gap: {isMobile ? '0.5rem' : '0.75rem'}; padding: {isMobile ? '0 0.25rem' : '0'}; width: 100%; min-width: 0; box-sizing: border-box; align-content: flex-start;">
        {#each filteredStudents as st, index}
          <div class="category-card" style="margin: 0; padding: 0.6rem 0.8rem; border: {selectedIds.has(st.id!) ? '1.5px solid #ef4444' : '1px solid rgba(255,255,255,0.05)'}; cursor: pointer;"
            onclick={() => openEditModal(st)}>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.6rem; flex: 1; min-width: 0;">
                <div onclick={(e) => { e.stopPropagation(); toggleSelect(st.id!); }} style="cursor: pointer; width: 20px; height: 20px; border-radius: 4px; border: 2px solid {selectedIds.has(st.id!) ? '#ef4444' : 'rgba(255,255,255,0.2)'}; background: {selectedIds.has(st.id!) ? 'rgba(239,68,68,0.2)' : 'transparent'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">{selectedIds.has(st.id!) ? '✓' : ''}</div>
                {#if st.foto}
                  <img src={st.foto} alt={st.nombre} style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(56, 189, 248, 0.3); flex-shrink: 0;" />
                {:else}
                  <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 1rem; flex-shrink: 0;">👤</div>
                {/if}
                <span style="font-size: 0.7rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 1px 5px; border-radius: 4px; font-weight: bold; flex-shrink: 0; border: 1px solid rgba(56, 189, 248, 0.2);">#{index + 1}</span>
                <span style="flex: 1; min-width: 0; font-size: 0.9rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{st.nombre}</span>
              </div>
              <div class="item-actions" style="display: flex; gap: 0.2rem; flex-shrink: 0;">
                <button class="icon-button delete" onclick={(e) => { e.stopPropagation(); handleDelete(st.id!); }}
                  style="width: 36px; height: 36px; font-size: 1rem; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.25); border-radius: 8px; color: #f87171; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s;">🗑</button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else if viewMode === 'list'}
      <div style="display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);">
        {#each filteredStudents as st, index}
          <div style="content-visibility: auto; contain-intrinsic-size: auto 48px; display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border-bottom: {index < filteredStudents.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none'}; background: {selectedIds.has(st.id!) ? 'rgba(239,68,68,0.08)' : index % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'}; transition: background 0.15s; cursor: pointer;"
            onclick={() => openEditModal(st)}>
            <div onclick={(e) => { e.stopPropagation(); toggleSelect(st.id!); }} style="cursor: pointer; width: 18px; height: 18px; border-radius: 3px; border: 2px solid {selectedIds.has(st.id!) ? '#ef4444' : 'rgba(255,255,255,0.2)'}; background: {selectedIds.has(st.id!) ? 'rgba(239,68,68,0.2)' : 'transparent'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 0.6rem; color: #ef4444;">{selectedIds.has(st.id!) ? '✓' : ''}</div>
            {#if st.foto}
              <img src={st.foto} alt={st.nombre} style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(56, 189, 248, 0.2); flex-shrink: 0;" />
            {:else}
              <div style="width: 30px; height: 30px; border-radius: 50%; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0;">👤</div>
            {/if}
            <span style="font-size: 0.65rem; font-weight: bold; flex-shrink: 0; min-width: 26px; text-align: center; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(56, 189, 248, 0.2);">{index + 1}</span>
            <span style="font-size: 0.85rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">{st.nombre}</span>
            <div style="display: flex; gap: 0.15rem; flex-shrink: 0;">
              <button class="icon-button delete" onclick={(e) => { e.stopPropagation(); handleDelete(st.id!); }}
                style="width: 36px; height: 36px; font-size: 1rem; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.25); border-radius: 8px; color: #f87171; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s;">🗑</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div style="display: grid; grid-template-columns: {isMobile ? 'repeat(4, 1fr)' : 'repeat(6, 1fr)'}; gap: {isMobile ? '0.6rem' : '0.8rem'}; padding: 0.25rem 0;">
        {#each filteredStudents as st, index}
          <div onclick={() => { if (!selectedIds.has(st.id!)) gridSelectedStudent = st; }}
            style="content-visibility: auto; contain-intrinsic-size: auto 96px; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer; padding: 0.6rem 0.4rem; border-radius: 12px; transition: background 0.2s; background: {selectedIds.has(st.id!) ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.02)'}; border: 1px solid {selectedIds.has(st.id!) ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.04)'};">
            <div onclick={(e) => { e.stopPropagation(); toggleSelect(st.id!); }} style="cursor: pointer; width: 22px; height: 22px; border-radius: 4px; border: 2px solid {selectedIds.has(st.id!) ? '#ef4444' : 'rgba(255,255,255,0.2)'}; background: {selectedIds.has(st.id!) ? 'rgba(239,68,68,0.2)' : 'transparent'}; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; color: #ef4444; margin-bottom: 2px;">{selectedIds.has(st.id!) ? '✓' : ''}</div>
            <div style="position: relative; display: inline-flex;">
              {#if st.foto}
                <img src={st.foto} alt={st.nombre} style="width: {isMobile ? '52px' : '64px'}; height: {isMobile ? '52px' : '64px'}; border-radius: 50%; object-fit: cover; border: 2px solid rgba(56, 189, 248, 0.25); box-shadow: 0 2px 8px rgba(0,0,0,0.3);" />
              {:else}
                <div style="width: {isMobile ? '52px' : '64px'}; height: {isMobile ? '52px' : '64px'}; border-radius: 50%; background: linear-gradient(135deg, rgba(56,189,248,0.15), rgba(168,85,247,0.15)); display: flex; align-items: center; justify-content: center; font-size: {isMobile ? '1.3rem' : '1.6rem'}; border: 2px solid rgba(56, 189, 248, 0.15);">👤</div>
              {/if}
              <span style="position: absolute; top: -4px; right: -4px; font-size: 0.6rem; font-weight: bold; background: linear-gradient(135deg, #38bdf8, #6366f1); color: white; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 2px solid rgba(15,23,42,0.8);">{index + 1}</span>
            </div>
            <span style="font-size: {isMobile ? '0.7rem' : '0.8rem'}; color: #e2e8f0; text-align: center; overflow: hidden; text-overflow: ellipsis; max-width: 100%; white-space: nowrap; font-weight: 600; margin-top: 3px;">{st.nombre}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Modal: Add/Edit Student -->
  {#if isModalOpen}
    <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) isModalOpen = false; }} style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6);">
      <div class="modal-content category-card" style="width: 450px; max-width: 95%; max-height: 90vh; overflow-y: auto; position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6); animation: slideUp 0.15s ease-out;">
        <div class="category-header" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.06);">
          <h3 style="margin: 0; font-size: 1.1rem; color: #f1f5f9;">{isEditing ? "Editar Estudiante" : "Registrar Estudiante"}</h3>
          <button onclick={() => isModalOpen = false} style="background: transparent; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer;">✕</button>
        </div>
        <form onsubmit={handleSubmit} style="display: grid; gap: 0.6rem; grid-template-columns: 1fr 1fr; padding: 1rem 1.25rem; width: 100%; box-sizing: border-box;">
          <div style="grid-column: span 2; display: flex; flex-direction: column; align-items: center; gap: 0.4rem; margin-bottom: 0.5rem;">
            <div style="width: 80px; height: 80px; border-radius: 50%; background: rgba(255,255,255,0.05); border: 2px dashed rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; overflow: hidden; cursor: pointer;" onclick={openCamera}>
              {#if photoPreview}
                <img src={photoPreview} alt="Foto estudiante" style="width: 100%; height: 100%; object-fit: cover;" />
              {:else}
                <div style="text-align: center; color: #64748b;">
                  <div style="font-size: 1.5rem;">📷</div>
                  <div style="font-size: 0.65rem;">Foto</div>
                </div>
              {/if}
            </div>
            {#if photoPreview}
              <button type="button" onclick={clearPhoto} style="font-size: 0.65rem; color: #f87171; background: none; border: none; cursor: pointer; text-decoration: underline;">🗑️ Eliminar</button>
            {/if}
          </div>

          <input type="file" accept="image/*" capture="environment" onchange={handleFileChange} style="display: none;" bind:this={fileInputEl} />

          <div class="input-container" style="grid-column: span 2; margin-bottom: 0;">
            <input name="nombre" placeholder="Nombre completo" value={formData.nombre} oninput={(e) => { const t = e.target as HTMLInputElement; const start = t.selectionStart; const transformed = toTitleCase(t.value); if (transformed !== t.value) { t.value = transformed; t.setSelectionRange?.(start, start); } formData = { ...formData, nombre: transformed }; }} required style="width: 100%; padding: 0.5rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.6); color: #e2e8f0; font-size: 0.9rem; outline: none; box-sizing: border-box;" />
          </div>
          <div class="input-container" style="margin-bottom: 0;">
            <input name="codigo" placeholder="Auto-generado" value={formData.codigo} disabled style="width: 100%; padding: 0.5rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.3); color: #64748b; font-size: 0.9rem; outline: none; box-sizing: border-box; cursor: not-allowed;" />
          </div>
          <div class="input-container" style="margin-bottom: 0;">
            <select name="sexo" value={formData.sexo} onchange={handleFormChange} style="width: 100%; padding: 0.5rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.6); color: #e2e8f0; font-size: 0.9rem; outline: none; box-sizing: border-box;">
              <option value="M">Masculino</option>
              <option value="F">Femenino</option>
            </select>
          </div>
          <div class="input-container" style="margin-bottom: 0;">
            <label style="display: block; margin-bottom: 0.3rem; font-size: 0.7rem; color: #94a3b8; font-weight: 600;">Año Lectivo</label>
            <select name="anoLectivoId" value={formData.anoLectivoId} onchange={handleFormChange} style="width: 100%; padding: 0.5rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.6); color: #e2e8f0; font-size: 0.9rem; outline: none; box-sizing: border-box;">
              {#each anos as opt}
                <option value={opt.id}>{opt.nombre}{#if opt.activo} (Activo){/if}</option>
              {/each}
            </select>
          </div>
          <div class="input-container" style="margin-bottom: 0;">
            <label style="display: block; margin-bottom: 0.3rem; font-size: 0.7rem; color: #94a3b8; font-weight: 600;">Colegio</label>
            <select name="colegioId" value={formData.colegioId} onchange={handleFormChange} style="width: 100%; padding: 0.5rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.6); color: #e2e8f0; font-size: 0.9rem; outline: none; box-sizing: border-box;">
              {#each colegios as opt}
                <option value={opt.id}>{opt.nombre}</option>
              {/each}
            </select>
          </div>
          <div class="input-container" style="margin-bottom: 0;">
            <label style="display: block; margin-bottom: 0.3rem; font-size: 0.7rem; color: #94a3b8; font-weight: 600;">Grado</label>
            <select name="gradoId" value={formData.gradoId} onchange={handleFormChange} style="width: 100%; padding: 0.5rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.6); color: #e2e8f0; font-size: 0.9rem; outline: none; box-sizing: border-box;">
              <option value={0}>Seleccione grado</option>
              {#each modalGrados as opt}
                <option value={opt.id}>{opt.nombre}</option>
              {/each}
            </select>
          </div>
          <div class="input-container" style="margin-bottom: 0;">
            <label style="display: block; margin-bottom: 0.3rem; font-size: 0.7rem; color: #94a3b8; font-weight: 600;">Sección</label>
            <select name="seccionId" value={formData.seccionId} onchange={handleFormChange} style="width: 100%; padding: 0.5rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.6); color: #e2e8f0; font-size: 0.9rem; outline: none; box-sizing: border-box;">
              <option value={0}>Seleccione sección</option>
              {#each modalSecciones as opt}
                <option value={opt.id}>{opt.nombre}</option>
              {/each}
            </select>
          </div>
          <div style="grid-column: span 2; display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.75rem;">
            <button type="button" onclick={() => isModalOpen = false} style="padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: #94a3b8; cursor: pointer; font-weight: 600;">Cancelar</button>
            <button type="submit" style="padding: 0.5rem 1.25rem; font-size: 0.85rem; border-radius: 8px; border: none; background: linear-gradient(135deg, var(--primary-hover), var(--primary-color)); color: white; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(var(--primary-rgb), 0.4);">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Grid Student Detail Modal -->
  {#if gridSelectedStudent}
    <div class="modal-overlay" style="position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);" onclick={() => gridSelectedStudent = null}>
      <div class="modal-content category-card" onclick={(e) => e.stopPropagation()} style="width: 380px; max-width: 90%; padding: 1.5rem; position: relative; background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98)); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);">
        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
          {#if gridSelectedStudent.foto}
            <img src={gridSelectedStudent.foto} alt={gridSelectedStudent.nombre} style="width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(56, 189, 248, 0.3);" />
          {:else}
            <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 1.5rem;">👤</div>
          {/if}
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 1.1rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #f1f5f9;">{gridSelectedStudent.nombre}</div>
            <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">Código: {gridSelectedStudent.codigo}</div>
          </div>
          <button onclick={() => gridSelectedStudent = null} style="background: transparent; border: none; color: #94a3b8; font-size: 1.2rem; cursor: pointer; padding: 4px;">✕</button>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.4rem; font-size: 0.75rem; margin-bottom: 1rem;">
          <span style="background: rgba(56, 189, 248, 0.1); color: #38bdf8; padding: 2px 8px; border-radius: 4px;">
            {allGrados.find(g => g.id === gridSelectedStudent.gradoId)?.nombre || 'Grado'}
          </span>
          <span style="background: rgba(168, 85, 247, 0.1); color: #a855f7; padding: 2px 8px; border-radius: 4px;">
            {allSecciones.find(s => s.id === gridSelectedStudent.seccionId)?.nombre || 'Sección'}
          </span>
          <span style="background: {gridSelectedStudent.sexo === 'M' ? 'rgba(96, 165, 250, 0.1)' : 'rgba(244, 114, 182, 0.1)'}; color: {gridSelectedStudent.sexo === 'M' ? '#60a5fa' : '#f472b6'}; padding: 2px 8px; border-radius: 4px;">
            {gridSelectedStudent.sexo === 'M' ? 'Masculino' : 'Femenino'}
          </span>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick={() => { openEditModal(gridSelectedStudent); gridSelectedStudent = null; }} style="flex: 1; justify-content: center; padding: 0.6rem; font-size: 0.85rem; border-radius: 8px; border: none; background: linear-gradient(135deg, var(--primary-hover), var(--primary-color)); color: white; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(var(--primary-rgb), 0.4);">✏️ Editar</button>
          <button onclick={() => { handleDelete(gridSelectedStudent.id!); gridSelectedStudent = null; }} style="flex: 1; justify-content: center; padding: 0.6rem; font-size: 0.85rem; border-radius: 8px; border: 1px solid rgba(239,68,68,0.4); background: rgba(239,68,68,0.15); color: #fca5a5; font-weight: 600; cursor: pointer;">🗑 Eliminar</button>
        </div>
      </div>
    </div>
  {/if}
</div>
