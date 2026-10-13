import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.TEMP + "\\stp3.db", { readOnly: true });
const one = (s, ...p) => db.prepare(s).get(...p);
const all = (s, ...p) => db.prepare(s).all(...p);
const linea = (t) => console.log("\n=== " + t + " ===");

linea("A. NOTAS huerfanas (estudiante borrado)");
console.log("filas:", one("SELECT COUNT(*) n FROM nota WHERE estudiante_id NOT IN (SELECT id FROM estudiante)").n,
  "| estudiantes:", JSON.stringify(all("SELECT DISTINCT estudiante_id FROM nota WHERE estudiante_id NOT IN (SELECT id FROM estudiante)").map(r => r.estudiante_id)));

linea("B. NOTAS con criterio de otro grado que su estudiante");
console.log("filas:", one(`SELECT COUNT(*) n FROM nota n JOIN estudiante e ON e.id=n.estudiante_id
  JOIN criterio c ON c.id=n.criterio_id JOIN indicador i ON i.id=c.indicador_id WHERE i.grado_id<>e.grado_id`).n);

linea("C. NOTAS cuyo corte/asignatura no coinciden con su indicador");
console.log("corte:", one(`SELECT COUNT(*) n FROM nota n JOIN criterio c ON c.id=n.criterio_id
  JOIN indicador i ON i.id=c.indicador_id WHERE i.corte_evaluativo_id<>n.corte_evaluativo_id`).n,
  "| asignatura:", one(`SELECT COUNT(*) n FROM nota n JOIN criterio c ON c.id=n.criterio_id
  JOIN indicador i ON i.id=c.indicador_id WHERE i.asignatura_id<>n.asignatura_id`).n);

linea("D. ASISTENCIAS huerfanas");
console.log("filas:", one("SELECT COUNT(*) n FROM asistencia WHERE estudiante_id NOT IN (SELECT id FROM estudiante)").n);

linea("E. CRITERIOS/INDICADORES huerfanos");
console.log("criterio sin indicador:", one("SELECT COUNT(*) n FROM criterio WHERE indicador_id NOT IN (SELECT id FROM indicador)").n);
console.log("nota sin criterio     :", one("SELECT COUNT(*) n FROM nota WHERE criterio_id NOT IN (SELECT id FROM criterio)").n);

linea("F. DIA_SIN_CLASES huerfanos / con grado-seccion inconsistentes");
console.log("colegio inexistente :", one("SELECT COUNT(*) n FROM dia_sin_clases WHERE colegio_id NOT IN (SELECT id FROM colegio)").n);
console.log("grado no asignado al colegio:", one(`SELECT COUNT(*) n FROM dia_sin_clases d
   WHERE d.grado_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM colegio_grado cg WHERE cg.colegio_id=d.colegio_id AND cg.grado_id=d.grado_id)`).n);
console.log("seccion sin grado   :", one(`SELECT COUNT(*) n FROM dia_sin_clases WHERE seccion_id IS NOT NULL AND grado_id IS NULL`).n);

linea("G. CATALOGOS con FK rota");
for (const [t, c, ref] of [["estudiante", "grado_id", "grado"], ["estudiante", "seccion_id", "seccion"],
                           ["estudiante", "colegio_id", "colegio"], ["estudiante", "ano_lectivo_id", "ano_lectivo"]]) {
  console.log(`${t}.${c}:`, one(`SELECT COUNT(*) n FROM ${t} WHERE ${c} IS NOT NULL AND ${c} NOT IN (SELECT id FROM ${ref})`).n);
}
console.log("grado_asignatura huerfanos:", one(`SELECT COUNT(*) n FROM grado_asignatura WHERE grado_id NOT IN (SELECT id FROM grado) OR asignatura_id NOT IN (SELECT id FROM asignatura)`).n);
console.log("colegio_grado huerfanos   :", one(`SELECT COUNT(*) n FROM colegio_grado WHERE colegio_id NOT IN (SELECT id FROM colegio) OR grado_id NOT IN (SELECT id FROM grado)`).n);

linea("H. ESTUDIANTES duplicados (mismo codigo)");
console.log(JSON.stringify(all("SELECT codigo, COUNT(*) n, GROUP_CONCAT(id) ids FROM estudiante WHERE codigo IS NOT NULL AND codigo<>'' GROUP BY codigo HAVING n>1"), null, 1));

linea("I. ESTUDIANTES duplicados (mismo nombre + grado + seccion)");
console.log(JSON.stringify(all(`SELECT nombre, grado_id, seccion_id, COUNT(*) n, GROUP_CONCAT(id) ids FROM estudiante
  GROUP BY nombre, grado_id, seccion_id HAVING n>1`), null, 1));

linea("J. PENDIENTES de borrado acumulados (tombstones sin sync)");
console.log(JSON.stringify(all(`SELECT tabla, COUNT(*) n FROM sync_pending_deletions GROUP BY tabla`), null, 1));

linea("K. INDICADORES activos > 5 por grado/asignatura/corte");
console.log(JSON.stringify(all(`SELECT grado_id, asignatura_id, corte_evaluativo_id, COUNT(*) n
  FROM indicador WHERE activo=1 GROUP BY grado_id, asignatura_id, corte_evaluativo_id HAVING n>5`), null, 1));
db.close();