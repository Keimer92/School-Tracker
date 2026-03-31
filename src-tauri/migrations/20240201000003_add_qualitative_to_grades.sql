-- Add qualitative column to all category tables to maintain macro consistency
ALTER TABLE ano_lectivo ADD COLUMN cualitativo BOOLEAN DEFAULT FALSE;
ALTER TABLE corte_evaluativo ADD COLUMN cualitativo BOOLEAN DEFAULT FALSE;
ALTER TABLE colegio ADD COLUMN cualitativo BOOLEAN DEFAULT FALSE;
ALTER TABLE asignatura ADD COLUMN cualitativo BOOLEAN DEFAULT FALSE;
ALTER TABLE grado ADD COLUMN cualitativo BOOLEAN DEFAULT FALSE;
ALTER TABLE seccion ADD COLUMN cualitativo BOOLEAN DEFAULT FALSE;
