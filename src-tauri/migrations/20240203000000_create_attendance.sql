CREATE TABLE IF NOT EXISTS asistencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estudiante_id INTEGER NOT NULL,
    fecha TEXT NOT NULL, -- Formato YYYY-MM-DD
    estado TEXT NOT NULL, -- 'P' (Presente), 'A' (Ausente), 'T' (Tarde), 'E' (Excusa)
    observacion TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estudiante_id) REFERENCES estudiante(id) ON DELETE CASCADE,
    UNIQUE(estudiante_id, fecha)
);