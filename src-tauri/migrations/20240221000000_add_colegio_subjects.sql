-- Create table for Colegio-Asignatura Relationship (Many-to-Many)
CREATE TABLE IF NOT EXISTS colegio_asignatura (
    colegio_id INTEGER NOT NULL,
    asignatura_id INTEGER NOT NULL,
    PRIMARY KEY (colegio_id, asignatura_id),
    FOREIGN KEY(colegio_id) REFERENCES colegio(id) ON DELETE CASCADE,
    FOREIGN KEY(asignatura_id) REFERENCES asignatura(id) ON DELETE CASCADE
);

-- Default: Assign all subjects to all existing colegios to maintain backward compatibility
INSERT OR IGNORE INTO colegio_asignatura (colegio_id, asignatura_id)
SELECT c.id, a.id FROM colegio c CROSS JOIN asignatura a;
