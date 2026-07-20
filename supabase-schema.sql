-- Script para crear el schema esperado por School Tracker Pro en Supabase.
-- Ejecutar en el SQL Editor de Supabase (Proyecto correcto).

CREATE TABLE IF NOT EXISTS ano_lectivo (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER DEFAULT 0,
  cualitativo INTEGER DEFAULT 0,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS corte_evaluativo (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER DEFAULT 0,
  cualitativo INTEGER DEFAULT 0,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS colegio (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER DEFAULT 0,
  cualitativo INTEGER DEFAULT 0,
  orden INTEGER DEFAULT 0,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS asignatura (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  cualitativo INTEGER DEFAULT 0,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS grado (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  cualitativo INTEGER DEFAULT 0,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS seccion (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  cualitativo INTEGER DEFAULT 0,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS estudiante (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  codigo TEXT NOT NULL,
  sexo TEXT NOT NULL,
  ano_lectivo_id INTEGER NOT NULL,
  grado_id INTEGER NOT NULL,
  seccion_id INTEGER NOT NULL,
  colegio_id INTEGER NOT NULL,
  telefono TEXT,
  direccion TEXT,
  email TEXT,
  foto TEXT,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS configuracion_calificacion (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  color TEXT NOT NULL,
  minimo INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS grado_asignatura (
  grado_id INTEGER NOT NULL,
  asignatura_id INTEGER NOT NULL,
  user_id TEXT,
  PRIMARY KEY (grado_id, asignatura_id)
);

CREATE TABLE IF NOT EXISTS colegio_asignatura (
  colegio_id INTEGER NOT NULL,
  asignatura_id INTEGER NOT NULL,
  user_id TEXT,
  PRIMARY KEY (colegio_id, asignatura_id)
);

CREATE TABLE IF NOT EXISTS indicador (
  id SERIAL PRIMARY KEY,
  grado_id INTEGER NOT NULL,
  asignatura_id INTEGER NOT NULL,
  corte_evaluativo_id INTEGER NOT NULL,
  orden INTEGER NOT NULL,
  descripcion TEXT DEFAULT '',
  activo INTEGER DEFAULT 1,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS criterio (
  id SERIAL PRIMARY KEY,
  indicador_id INTEGER NOT NULL,
  orden INTEGER NOT NULL,
  descripcion TEXT DEFAULT '',
  puntaje_maximo INTEGER NOT NULL,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (
  colegio_id INTEGER PRIMARY KEY,
  lunes INTEGER DEFAULT 1,
  martes INTEGER DEFAULT 1,
  miercoles INTEGER DEFAULT 1,
  jueves INTEGER DEFAULT 1,
  viernes INTEGER DEFAULT 1,
  sabado INTEGER DEFAULT 1,
  domingo INTEGER DEFAULT 1,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS asistencia (
  id SERIAL PRIMARY KEY,
  estudiante_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL,
  observacion TEXT,
  user_id TEXT,
  UNIQUE (estudiante_id, fecha)
);

CREATE TABLE IF NOT EXISTS nota (
  estudiante_id INTEGER NOT NULL,
  criterio_id INTEGER NOT NULL,
  valor DOUBLE PRECISION NOT NULL,
  corte_evaluativo_id INTEGER NOT NULL,
  asignatura_id INTEGER NOT NULL,
  user_id TEXT,
  PRIMARY KEY (estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)
);

CREATE TABLE IF NOT EXISTS sync_deletions (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  deleted_at TEXT DEFAULT now()::text,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS sync_batch (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,
  data TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT DEFAULT now()::text
);

ALTER TABLE grado ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE seccion ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE criterio ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE grado_asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE colegio_asignatura ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE colegio_dias_asistencia ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE ano_lectivo DISABLE ROW LEVEL SECURITY;
ALTER TABLE corte_evaluativo DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio DISABLE ROW LEVEL SECURITY;
ALTER TABLE asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE grado DISABLE ROW LEVEL SECURITY;
ALTER TABLE seccion DISABLE ROW LEVEL SECURITY;
ALTER TABLE estudiante DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_calificacion DISABLE ROW LEVEL SECURITY;
ALTER TABLE grado_asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio_asignatura DISABLE ROW LEVEL SECURITY;
ALTER TABLE indicador DISABLE ROW LEVEL SECURITY;
ALTER TABLE criterio DISABLE ROW LEVEL SECURITY;
ALTER TABLE colegio_dias_asistencia DISABLE ROW LEVEL SECURITY;
ALTER TABLE asistencia DISABLE ROW LEVEL SECURITY;
ALTER TABLE nota DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_deletions DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_batch DISABLE ROW LEVEL SECURITY;
