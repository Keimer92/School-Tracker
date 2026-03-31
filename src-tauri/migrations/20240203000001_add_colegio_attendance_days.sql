-- Migration to add enabled attendance days to colegio
CREATE TABLE IF NOT EXISTS colegio_dias_asistencia (
    colegio_id INTEGER PRIMARY KEY,
    lunes BOOLEAN DEFAULT 1,
    martes BOOLEAN DEFAULT 1,
    miercoles BOOLEAN DEFAULT 1,
    jueves BOOLEAN DEFAULT 1,
    viernes BOOLEAN DEFAULT 1,
    sabado BOOLEAN DEFAULT 1,
    domingo BOOLEAN DEFAULT 1,
    FOREIGN KEY (colegio_id) REFERENCES colegio(id) ON DELETE CASCADE
);
