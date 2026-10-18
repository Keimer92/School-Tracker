// Key de tablas "sucias" en localStorage.
//
// Antes se llamaba "turso_dirty_tables" y se migraba al nombre actual en cada
// arranque. La migración se eliminó en 2026-10 al retirar Turso: el key viejo ya
// no existe en ningún cliente y mantenerlo solo agregaba código muerto.
const DIRTY_KEY = 'stp_dirty_tables';

const ALL_TABLES = [
  'ano_lectivo', 'corte_evaluativo', 'colegio', 'asignatura', 'grado',
  'seccion', 'grado_asignatura', 'colegio_asignatura', 'colegio_grado', 'indicador',
  'criterio', 'estudiante', 'estudiante_retirado', 'configuracion_calificacion',
  'multiplicador_calificacion',
  'colegio_dias_asistencia', 'asistencia', 'nota', 'app_settings',
  'instrumento_plantilla',
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
