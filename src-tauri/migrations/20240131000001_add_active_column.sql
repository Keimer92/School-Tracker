ALTER TABLE ano_lectivo ADD COLUMN activo INTEGER DEFAULT 0;
ALTER TABLE corte_evaluativo ADD COLUMN activo INTEGER DEFAULT 0;

-- Set the first year and first period as active by default
UPDATE ano_lectivo SET activo = 1 WHERE id = (SELECT min(id) FROM ano_lectivo);
UPDATE corte_evaluativo SET activo = 1 WHERE id = (SELECT min(id) FROM corte_evaluativo);
