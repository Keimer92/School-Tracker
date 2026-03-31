CREATE TABLE IF NOT EXISTS configuracion_calificacion (
    id TEXT PRIMARY KEY,
    color TEXT NOT NULL
);

-- Insertar colores por defecto para las 4 notas cualitativas
INSERT OR IGNORE INTO configuracion_calificacion (id, color) VALUES ('AA', '#4ade80'); -- Verde
INSERT OR IGNORE INTO configuracion_calificacion (id, color) VALUES ('AS', '#60a5fa'); -- Azul
INSERT OR IGNORE INTO configuracion_calificacion (id, color) VALUES ('AF', '#fbbf24'); -- Amarillo/Naranja
INSERT OR IGNORE INTO configuracion_calificacion (id, color) VALUES ('AI', '#f87171'); -- Rojo
