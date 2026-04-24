ALTER TABLE ano_lectivo ADD COLUMN IF NOT EXISTS activo INTEGER DEFAULT 0;
ALTER TABLE corte_evaluativo ADD COLUMN IF NOT EXISTS activo INTEGER DEFAULT 0;

-- Set the first year and first period as active by default
UPDATE ano_lectivo SET activo = 1 WHERE id = (SELECT min(id) FROM ano_lectivo);
UPDATE corte_evaluativo SET activo = 1 WHERE id = (SELECT min(id) FROM corte_evaluativo);
