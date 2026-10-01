# Plan: Estudiantes Retirados (borrado lógico en vez de definitivo)

> Objetivo: que al "eliminar" un estudiante su historial (notas, asistencias) **quede
> en la base** para poder consultarlo en el futuro, sin que ese estudiante aparezca en
> Asistencia, Notas, Reportes, Dashboard ni en ninguna otra lista operativa.
> La acción pasa a llamarse **Retirar**, y los retirados viven en una vista aparte
> dentro de EstudiantesPage.

> **ESTADO: PLANIFICADO, NO IMPLEMENTADO.** Este documento no tiene efecto hasta que se
> ejecute. Ver §9 (Rollback).

---

## 1. Por qué el cambio

Hoy `delete_student` (`db.rs:2741`) borra de verdad:

```sql
DELETE FROM estudiante WHERE id = ?
```

Eso dispara el **FK CASCADE** sobre `nota` y `asistencia`, y además inscribe tombstones
en `sync_pending_deletions` y `sync_pending_deletions_asistencia`. Consecuencia doble:

1. El historial del estudiante se destruye en local.
2. El borrado **se propaga a la nube** como eliminación, así que los demás dispositivos
   también lo pierden.

No hay nada que recuperar hoy. Para llevar el control histórico que se necesita, el
borrado tiene que ser lógico.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| ¿Dónde vive el estado? | Columna en `estudiante` (no tabla aparte) |
| Estados posibles | `activo` / `retirado` / `graduado` |
| Borrado de catálogos con retirados | **Pedir confirmación y advertir** cuántos se perderán |
| ¿Borrado definitivo disponible? | **Sí**, solo desde la vista Retirados, con doble confirmación |
| Graduados de 11mo | **Sí**, se marcan `graduado` automáticamente al promover |
| Sección con todos sus estudiantes retirados | **Sí**, desaparece de los filtros |

### 2.1 Por qué una columna y no una tabla `estudiantes_retirados`

1. **Sin JOINs**: hay ~8 consultas calientes que leen estudiantes; con columna es
   agregar `AND e.situacion = 'activo'`.
2. **Viaja con el estudiante en el sync**: la fila se reconcilia por clave de negocio
   (`codigo`), así que el estado va y viene sin lógica extra.
3. **Revertir es un `UPDATE`**, no reconstruir notas y asistencias.
4. **Deja puerta a un tercer estado** (`graduado`) sin cambiar el mecanismo.

### 2.2 Por qué `situacion` y no `estado`

La tabla `asistencia` **ya tiene** una columna `estado` con valores `P/A/J`. Y
`get_asistencia_estudiantes` (`db.rs:4647`) hace JOIN de `estudiante` + `asistencia` en
la misma consulta. Con dos columnas `estado`, el mapeo al struct `AsistenciaEstudiante`
queda ambiguo. `situacion` evita la colisión de nombres.

---

## 3. Schema

### 3.1 `CREATE TABLE` en `db.rs::init_database` (tabla `estudiante`, ~L166)

Agregar tres columnas antes de los `FOREIGN KEY`:

```sql
situacion       TEXT NOT NULL DEFAULT 'activo',  -- 'activo' | 'retirado' | 'graduado'
retirado_fecha  TEXT,
retirado_motivo TEXT,
```

### 3.2 Migración para bases existentes (`db.rs::migrate_add_columns`)

```rust
// situation/estado de retiro del estudiante. DEFAULT 'activo' para que
// cualquier fila previa siga cuenta como activa: sin esto, al agregar la
// columna SQLite la deja NULL y el filtro `situacion = 'activo'` las ocultaría.
if !column_exists(conn, "estudiante", "situacion") {
    conn.execute(
        "ALTER TABLE estudiante ADD COLUMN situacion TEXT NOT NULL DEFAULT 'activo'",
        [],
    )?;
}
if !column_exists(conn, "estudiante", "retirado_fecha") {
    conn.execute("ALTER TABLE estudiante ADD COLUMN retirado_fecha TEXT", [])?;
}
if !column_exists(conn, "estudiante", "retirado_motivo") {
    conn.execute("ALTER TABLE estudiante ADD COLUMN retirado_motivo TEXT", [])?;
}
```

> **GOTCHA**: el `DEFAULT 'activo'` en el `ALTER` es obligatorio. Un `ADD COLUMN` sin
> default deja `NULL` en las filas existentes, y el filtro de la Fase 1 las esconde.
> Para migración de datos ya existente usar
> `UPDATE estudiante SET situacion = 'activo' WHERE situacion IS NULL;`

---

## 4. Inventario de sitios a modificar

> Los números de línea son de la revisión actual; pueden derivar. Los nombres de
> función son el ancla estable.

### 4.1 Lecturas que deben EXCLUIR retirados/graduados

| # | Ubicación | Función / ancla | Alimenta |
|---|---|---|---|
| R1 | `db.rs:2405` | `get_students` | Lista principal de EstudiantesPage |
| R2 | `db.rs:3969` | `get_estudiantes_by_filters` | NotasPage, ReportesPage |
| R3 | `db.rs:4647` | `get_asistencia_estudiantes` | Asistencia diario/semanal |
| R4 | `db.rs:4743` | `get_asistencia_estudiantes_rango` | Asistencia mensual |
| R5 | `db.rs:6198` | `promote_students` | **No debe promoverlos** |
| R6 | `db.rs:5415-5452` | Contadores y `SELECT DISTINCT colegio/grado` | Dashboard, estadísticas |
| R7 | `db.rs:5481-5497` | Estadísticas de asistencia | Dashboard |

### 4.2 Catálogos que derivan de estudiantes (requieren parámetro)

| # | Ubicación | Ancla | Nota |
|---|---|---|---|
| C1 | `db.rs:2346` | `get_grados_by_colegio` | Alimenta filtros Y `exportarPdfs` |
| C2 | `db.rs:2381` | `get_secciones_by_grado_colegio` | Ídem |

Ambos reciben un `incluirRetirados: bool`. Con `false` (vista normal) una sección sin
estudiantes activos desaparece de los filtros. Con `true` (vista Retirados) se listan
igual, para poder consultar el histórico.

> **GOTCHA**: C1/C2 también son la fuente del recorrido de `exportarPdfs`
> (`ReportesPage.svelte`, bucle grado×sección). Al filtrar, los combos sin activos dejan
> de generar PDF vacío. Es el comportamiento deseado.

### 4.3 Comandos nuevos

| Comando | Qué hace |
|---|---|
| `retirar_estudiantes(ids, motivo?)` | `UPDATE ... SET situacion='retirado', retirado_fecha=datetime('now'), retirado_motivo=?` |
| `reactivar_estudiantes(ids)` | `UPDATE ... SET situacion='activo', retirado_fecha=NULL, retirado_motivo=NULL` |
| `eliminar_estudiantes_definitivo(ids)` | Reusa el cascade actual (`delete_student_batch`) |

**Registrar en los DOS lugares** (si se olvida el segundo, `invoke` falla en runtime
sin error de compile):

- `src-tauri/src/lib.rs` → `generate_handler![...]`
- `src-tauri/permissions/local-commands.toml` → `commands.allow`

`retirar_estudiantes` y `reactivar_estudiantes` deben llamar `onDataChange('estudiante')`
desde el frontend (no `markDirty`) para que el cambio suba de inmediato.

### 4.4 Borrados de catálogo que necesitan advertencia (Fase 4)

Todos aceptan `incluirRetirados` implícito: se comportan como hoy (borran todo), pero
antes preguntan cuántos retirados se perderían.

| Ubicación | Ancla |
|---|---|
| `db.rs:1660-1697` | `delete_ano_lectivo` (simple + batch) |
| `db.rs:1761-1798` | `delete_colegio` |
| `db.rs:1934-1971` | `delete_grado` |
| `db.rs:2032-2069` | `delete_seccion` |

---

## 5. Fases de implementación

### Fase 0 — Schema
`init_database` + `migrate_add_columns` (§3). Sin tocar nada más todavía.
**Verificar:** `cargo check` y abrir la app → todos los estudiantes siguen visibles.

### Fase 1 — Filtro en lecturas
Agregar el filtro a R1-R7 y el parámetro a C1-C2.

Sugerencia de implementación: una constante compartida para el fragmento, para que las
8+T consultas no diverjan.

```rust
/// Fragmento de WHERE para las lecturas de estudiante que deben ocultar
/// retirados y graduados.
const SOLO_ACTIVOS: &str = "AND e.situacion = 'activo'";
```

**Verificar:** `rg "FROM estudiante"` sobre `db.rs` y confirmar que **cada** lectura
tiene el filtro o el parámetro. Este es el paso de mayor riesgo del plan (§7).

### Fase 2 — Comandos
`retirar_estudiantes`, `reactivar_estudiantes`, `eliminar_estudiantes_definitivo` (§4.3).
`eliminar_estudiantes_definitivo` no es lógica nueva: delega a `delete_student_batch`.

**Verificar:** `cargo check`, los tres en `local-commands.toml`, y una invocación real.

### Fase 3 — Promoción
- `promote_students` (R5): saltear filas con `situacion != 'activo'`.
- Los 11mo que hoy se dejan atrás (`graduated`) pasan a `situacion='graduado'`.

**Verificar:** promover un año con un retirado presente; el retirado no debe copiarse.

### Fase 4 — Advertencia en borrado de catálogo
Contar retirados afectados y `ask()` antes de ejecutar.

**Verificar:** borrar un grado con 3 retirados → aparece "se perderán 3 estudiantes y
sus notas"; cancelar no cambia nada.

### Fase 5 — Sincronización ⚠️

Las columnas de `estudiante` son **explícitas** en tres lugares. Falta uno = push roto.

| # | Archivo | Qué agregar |
|---|---|---|
| S1 | `src-tauri/src/lib.rs:271` (`collect_local_data_since`) | `situacion`, `retirado_fecha`, `retirado_motivo` en el SELECT + el `json!` |
| S2 | `cloudflare-sync/src/index.ts:123` (`TABLES.estudiante.cols`) | Las 3 columnas |
| S3 | `cloudflare-sync/src/index.ts` (`ensureSchema`) | En el `CREATE TABLE` + `ALTER TABLE ... ADD COLUMN` tolerante (try/catch) |

Y después:

```powershell
cd cloudflare-sync; npx wrangler deploy
```

> **GOTCHA CRÍTICO — sin redeploy el push muere.** Con cliente nuevo contra worker viejo:
> `HTTP 400: table estudiante has no column named situacion`. Es el mismo modo de falla
> que se documentó con `colegio_grado`/`device_id` en `AGENTS.md`.
>
> `npx wrangler deploy --dry-run` primero, y validar con `curl`.

Además:
- `dirtyTracker.ts`: confirmar que `estudiante` ya está en la lista (sí, según AGENTS.md).
- El apply del pull inserta con `INSERT OR REPLACE` genérico → si `situacion` no viene en
  las columnas, **se perdería**. Verificar que S2 y S3 están alineados con S1.

### Fase 6 — UI (EstudiantesPage)

Segmented control arriba de la lista: `Activos | Retirados`.

| Vista | Acciones |
|---|---|
| **Activos** | "Retirar" (reemplaza "Eliminar"), motivo opcional |
| **Retirados** | "Reactivar" · "Borrar definitivamente" (doble confirmación) |

- Contador de retirados en el toggle.
- Reutilizar el `SearchFab` existente (`searchTerm`, `EstudiantesPage:104`).
- En Android, la vista Retirados debe entrar en el flujo de `FiltersModalAndroid`.
- Borrar la lista actual: cambiar el `🗑️/Eliminar` del menú por fila (`EstudiantesPage:1299`)
  y los botones de lote (`:1219`, `:1238`).

---

## 6. Verificación

**Auditoría de fugas (obligatoria antes de dar por terminado)**

```
rg "FROM\s+estudiante|JOIN\s+estudiante" src-tauri/src/db.rs
```
Cada lectura debe tener `situacion = 'activo'` o el parámetro `incluirRetirados`.
Una fuga pasa desapercibida hasta que un PDF sale con 43 personas.

**Prueba manual**

1. Retirar un estudiante con notas → desaparece de Asistencia, Notas, Reportes y Dashboard.
2. Sus notas y asistencias siguen en la base (consultables desde Retirados).
3. PDF de asistencia del grado: no lo incluye.
4. Reactivar → vuelve a todos lados con su historial intacto.
5. Borrar el grado de la sección con el retirado → avisa cuántos se pierden.
6. Retirar en un dispositivo → aparece retirado en el otro tras el sync.
7. Promover un año: el retirado no se copia; el 11mo queda `graduado`.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| **Fuga en una consulta** (retirado visible en un PDF) | Auditoría `rg` + §6 |
| **Push roto por columna faltante en el worker** | S1+S2+S3 juntos y `wrangler deploy` |
| `situacion` NULL en bases viejas → todos ocultos | `DEFAULT 'activo'` en el `ALTER` + `UPDATE ... WHERE situacion IS NULL` |
| **Retirado se pierde al borrar su grado** | Fase 4 avisa antes; el usuario decide |
| Dispositivo viejo sin actualizar | Actualizar la app en todos antes de seguir usando el sync |
| Colisión de nombres `estado` vs `situacion` | Por eso el nombre es `situacion` (§2.2) |

---

## 8. Fuera de alcance

No incluye, salvo que se pida aparte:

- Reingreso de un retirado en otro año lectivo (hoy la reactivas y cambias su año).
- Historial de cambios de `situacion` (bitácora de "quién retiró a quién y cuándo"
  más allá del `retirado_fecha`/`retirado_motivo`).
- Exportar el listado de retirados.
- Productos منفar (retirado ≠ expulsado: es una baja con historial conservado).

---

## 9. Rollback

Mientras no se mezclen datos el rollback es barato:

```sql
UPDATE estudiante SET situacion = 'activo';
-- y revertir el código (las columnas sobran, no molestan)
```

Después de retirar de verdad a alguien, revertir "revive" al que se retiró a propósito.
Por eso la Fase 6 es la última: hasta llegar ahí, el cambio de arquitectura se puede
deshacer sin tocar datos.