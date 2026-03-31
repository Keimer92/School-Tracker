-- Establecer única y exclusivamente 1er y 2do grado como cualitativos por defecto
-- Primero nos aseguramos de que todos los demás sean cuantitativos
UPDATE grado SET cualitativo = FALSE;

-- Luego activamos cualitativo solo para 1ro y 2do
UPDATE grado 
SET cualitativo = TRUE 
WHERE nombre = '1er grado' 
   OR nombre = '2do grado'
   OR nombre LIKE 'Primero%' 
   OR nombre LIKE 'Segundo%';
