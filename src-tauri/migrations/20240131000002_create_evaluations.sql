CREATE TABLE IF NOT EXISTS indicador (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grado_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    corte_evaluativo_id INTEGER NOT NULL,
    orden INTEGER NOT NULL,
    descripcion TEXT DEFAULT '',
    activo INTEGER DEFAULT 0,
    FOREIGN KEY(grado_id) REFERENCES grado(id),
    FOREIGN KEY(asignatura_id) REFERENCES asignatura(id),
    FOREIGN KEY(corte_evaluativo_id) REFERENCES corte_evaluativo(id),
    UNIQUE(grado_id, asignatura_id, corte_evaluativo_id, orden)
);

CREATE TABLE IF NOT EXISTS criterio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    indicador_id INTEGER NOT NULL,
    orden INTEGER NOT NULL,
    descripcion TEXT DEFAULT '',
    puntaje_maximo INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(indicador_id) REFERENCES indicador(id) ON DELETE CASCADE,
    UNIQUE(indicador_id, orden)
);

CREATE TABLE IF NOT EXISTS nota (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estudiante_id INTEGER NOT NULL,
    criterio_id INTEGER NOT NULL,
    valor REAL NOT NULL DEFAULT 0,
    corte_evaluativo_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    FOREIGN KEY(estudiante_id) REFERENCES estudiante(id) ON DELETE CASCADE,
    FOREIGN KEY(criterio_id) REFERENCES criterio(id) ON DELETE CASCADE,
    FOREIGN KEY(corte_evaluativo_id) REFERENCES corte_evaluativo(id),
    FOREIGN KEY(asignatura_id) REFERENCES asignatura(id),
    UNIQUE(estudiante_id, criterio_id, corte_evaluativo_id, asignatura_id)
);
