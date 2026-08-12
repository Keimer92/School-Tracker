// Nombre histórico del key en localStorage (antes "turso_dirty_tables").
// Se migra una sola vez al nombre actual para no romper marcas pendientes existentes.
const DIRTY_KEY = 'stp_dirty_tables';
const LEGACY_DIRTY_KEY = 'turso_dirty_tables';

try {
  const legacy = localStorage.getItem(LEGACY_DIRTY_KEY);
  if (legacy !== null) {
    if (localStorage.getItem(DIRTY_KEY) === null) {
      localStorage.setItem(DIRTY_KEY, legacy);
    }
    localStorage.removeItem(LEGACY_DIRTY_KEY);
  }
} catch { /* noop */ }

const ALL_TABLES = [
  'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado',
  'seccion', 'grado_asignatura', 'colegio_asignatura', 'indicador',
  'criterio', 'estudiante', 'configuracion_calificacion',
  'multiplicador_calificacion',
  'colegio_dias_asistencia', 'asistencia', 'nota',
];

function loadDirty(): Set<string> {
  try {
    const raw = localStorage.getItem(DIRTY_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveDirty(set: Set<string>): void {
  localStorage.setItem(DIRTY_KEY, JSON.stringify([...set]));
}

export function markDirty(table: string): void {
  const set = loadDirty();
  set.add(table);
  saveDirty(set);
}

export function markAllDirty(): void {
  saveDirty(new Set(ALL_TABLES));
}

export function markClean(table: string): void {
  const set = loadDirty();
  set.delete(table);
  saveDirty(set);
}

export function markAllClean(): void {
  localStorage.removeItem(DIRTY_KEY);
}

export function isDirty(table: string): boolean {
  return loadDirty().has(table);
}

export function getDirtyTables(): string[] {
  return [...loadDirty()];
}

export function hasDirtyTables(): boolean {
  try {
    const raw = localStorage.getItem(DIRTY_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}
