# i18n — Páginas que faltan traducir

Estado de la traducción al **Español / English** de la interfaz, y qué queda
pendiente. Complementa la sección *i18n* de `AGENTS.md`, que explica **cómo**
funciona el mecanismo; este archivo es solo el **qué falta**.

## Cómo medir

Los números salen de un script que cuenta, por archivo, los textos visibles:

- **Nodos de texto del template**: lo que está entre `>` y `<`.
- **Literales de cadena** en el `<script>` que parecen texto de interfaz
  (dos o más palabras, o con acento).

Se excluyen a propósito los `console.log` / `console.error` / `console.warn`
(mensajes de desarrollo) y los valores de CSS. **El conteo es un límite
superior**: no distingue un `title=` de un `<h2>`, ni un mensaje de diálogo de
un texto suelto. Sirve para ordenar el trabajo, no para estimar al minutillo.

```powershell
# Recontar antes de empezar (el script está en docs/i18n-status.ps1)
powershell -File docs\i18n-status.ps1
```

## Estado actual

| | Archivos | Textos |
|---|---|---|
| **LISTO** | 23 | ~499 |
| **PENDIENTE** | 4 | ~50 |

**La traducción está completa.** Todo texto visible de UI está trasladado a
`t()`. Los 4 archivos que siguen marcados como PENDIENTE son **exclusión
deliberada** (ver tabla abajo): encabezados de reportes PDF/Excel y un
componente legacy que no se monta.

Traducidos: `WelcomePage`, `AjustesPage`, `AsistenciaPage` (incluye el sub-tab
Informe), `NotasPage`,
`EstudiantesPage`, `ConfiguracionPage` (+ `CategoryTabContent`),
`ReportesPage`, `EvaluacionesPage`, `DashboardPage`,
`ConfirmDialog`, `BrowserPicker`, `LanguagePicker`, `Sidebar`, `AndroidDrawer`,
`CloudCards`, `App`, `FiltersModalAndroid`, `NotificacionesPage`,
`GradoConfigModal`, `ColegioConfigModal`, `CalificacionesConfig`,
`MultiplicadoresConfig`, `SearchInput`, los wrappers `AsistenciaMainPage` /
`NotasMainPage`, `DatePickerGlass`, `InfoPage`, los modales de nube
(`modales/ModalBase`, `modales/ModalNubeD1`, `modales/ModalNubeDrive`) y los
servicios `driveSyncService`, `d1SyncService`, `cloudLogin`, `driveAutoBackup`,
`driveInstantBackup`, `deviceHandover` (+ `main.ts` para el arranque del
idioma). (`DashboardPage` y varios `.ts` quedaron con 0 textos sueltos: el
contador los saca del listado.)

> ℹ️ `CloudPage` y `AccountPage` se eliminaron (2026-10): la nube pasó a ser
> modales y la cuenta dejó de tener uso con la nube de un solo usuario. Sus
> claves (`acc.*`, `cfg.sec/desc.nube|cuenta`) se borraron de los diccionarios;
> el traspaso de dispositivo quedó en `DebugPage` con el prefijo `dpg.traspaso.*`.

> ⚠️ El script marca `LISTO` en cuanto el archivo importa `i18n.svelte`, así
> que el número de "textos" de un archivo LISTO es el total que **tenía**, no
> lo que falta. Para ver qué queda dentro de un archivo LISTO hay que correr el
> inventario (`inv.ps1`) o leer el diff.

### Textos que quedan en español a propósito dentro de archivos LISTO

- **`AsistenciaPage` (sub-tab Informe)**: el bloque `.print-header`
  (`Reporte de Asistencia`,
  `Colegio:`, `Grado:`, `Sección:`, `Período:`), el `titulo`/`subtitulo`/`chip`
  de las tablas del PDF, los encabezados `["Estudiante","Sexo",…,"P","A","J"]`,
  el `printHtml` y `fechaLarga`/`encabezadoPeriodo` (alimentan el PDF y el
  nombre del archivo). Traducirlos rompería el criterio de "reportes en
  español" y dejaría los PDF con idioma mezclado.
- **`ReportesPage`**: igual — el `printHtml` (`Reporte de Calificaciones` +
  sus etiquetas), el bloque `.print-header`, los `headers` de ese HTML, las
  cabeceras del TSV que se pega en Excel (`['Estudiante','Nota Final']`) y
  `selectedNames.corte` (que solo alimenta la subcarpeta y el PDF).
  ⚠️ **Salvedad**: los `<th>` de la tabla EN PANTALLA (`Estudiante`, `Sexo`,
  `Nota Final`) sí se traducen porque son la vista de trabajo del usuario; si
  alguien imprime con Ctrl+P (que usa el CSS `@media print` de la propia
  página) esos encabezados saldrán en el idioma de la UI, mientras que el
  camino de impresión del botón 🖨 (modal con iframe) sale entero en español.
- **`ConfiguracionPage`**: `CATEGORIES[].title` es clave de dominio
  (`config.title === "Colegio"`), no etiqueta.

## Pendientes, por impacto

Los 4 archivos restantes son **exclusión deliberada**, no trabajo pendiente:
si algún día se decide traducirlos, hay que actualizar también la sección
"Qué NO se traduce" de este documento.

| # | Archivo | Textos | Líneas | Motivo de la exclusión |
|---|---|---|---|---|
| 1 | `src/lib/excel.ts` | 19 | 489 | ⚠️ Encabezados/portada de reportes Excel (ver nota abajo) |
| 2 | `src/svelte/GoogleDriveBackup.svelte` | 18 | 390 | Legacy: no se monta en `App.svelte` |
| 3 | `src/lib/instrumentosPdf.ts` | 12 | 294 | ⚠️ Encabezados de PDF de instrumentos |
| 4 | `src/lib/instrumentosExcel.ts` | 1 | 299 | ⚠️ Hoja/encabezado de Excel de instrumentos |

`GoogleDriveBackup.svelte` usa además el comando antiguo
`gd_start_oauth_server`; si algún día se resucita, traducir junto con el resto.

Los componentes genéricos que antes figuraban acá (`SearchInput`,
`FilterSelect`, `FilterContainer`, `FilterGroup`, `BotonMod`) tenían solo
valores CSS como "textos" (falsos positivos del script, ya excluidos) o dos
etiquetas reales (`SearchInput`: placeholder y aria-label) que quedaron
resueltas con claves existentes (`inf.buscar`, `asis.limpiarBusqueda`).
`wsSyncService.ts`, `botones.ts` y los demás servicios `.ts` quedaron LISTO o
con 0 textos: sus literales son `console.*`/`wsLog` (desarrollo) y el script ya
los excluye.

## Qué NO se traduce (decisiones tomadas)

Estas decisiones son **deliberadas**. No "se olvidaron":

- **Encabezados de PDF y Excel** (`excel.ts`, `instrumentosPdf.ts`,
  `instrumentosExcel.ts`). Un reporte en inglés para una dirección de colegio
  es raro. Si alguna vez se quiere, necesita un interruptor aparte, no solo
  `t()`.
- **Nombres de grado, sección, asignatura, estudiante, colegio**. Son datos
  del usuario, no de la interfaz.
- **Valores de enum**. `tipoDesdeGrados === 'Primaria'`,
  `themeMode: 'claro' | 'oscuro' | 'sistema'`, `periodo: 'diario'`, los ids
  `'P' | 'A' | 'J'`. Son claves que viajan a la base de datos o se comparan
  en código: se traduce la etiqueta que se ve, nunca el valor.
- **Nombres de claves de dominio**. En `AsistenciaPage`,
  `dayNames = ['domingo','lunes',...]` indexa `colegioConfig`, que viene de la
  tabla `colegio_dias_asistencia` (columnas `lunes`..`domingo`). Traducirlas
  rompe el filtro de días hábiles **en silencio**.
- **`console.log` / `console.warn` / `console.error`**. El código del repo
  está en español por convención; estos mensajes son para developers.
- **Abreviaturas de una letra** en las tarjetas compactas de móvil (`F:`, `M:`,
  `E:`, `P:`, `A:`, `J:`). Casi universales, la etiqueta completa ya aparece
  en las tarjetas de escritorio, y el texto largo rompe el ancho de la fila.

## Checklist para traducir una página

1. **Medir**: correr el script y anotar el número de textos del archivo.
2. **Inventariar**: listar los textos (nodos de template y literales del
   script). Lo más rápido es grep de `>` … `<` y de cadenas con espacios.
3. **Buscar trampas antes de editar**:
   - `const t =` / `let t =` / `(t) =>` — una variable local llamada `t` tapa
     la función `t()`. Renombrar a `nodo` o `target`.
   - `toLocaleDateString('es-ES'` — locale hardcodeado. Usar
     `fmtFecha(iso, opts)` de `i18n.svelte.ts` para que la fecha siga el
     idioma.
4. **Agregar las claves primero** a `es.ts` (fuente de verdad), luego a
   `en.ts`. El tipado `Record<Clave, string>` obliga a que no falte ninguna;
   si el build falla con "Property is missing", es que falta la de `en.ts`.
5. **Usar `$derived`, no `const`**, para cualquier array u objeto que contenga
   `t()`. Con `const` se evalúa al importar el módulo y no cambia de idioma.
   ⚠️ No da error de compilación, es el fallo más silencioso de todos.
6. **Traducir en el call site** cuando el valor de dominio no se toca pero la
   etiqueta sí: `handleCardClick(t('x.y'), stats)` en vez de traducir dentro
   del handler.
7. **Un identificador de dominio que además se muestra** (ej.
   `config.title === "Colegio"` en `CategoryTabContent`): NO se traduce el
   valor; se agrega una clave de etiqueta aparte y se traduce solo el display.
   Si se traduce el valor, todas las comparaciones rompen en silencio.
   Patrón: `const titulo = $derived(RECORD[config.table] ?? config.title)`.
   ⚠️ No usar `` t(`prefijo.${x}`) `` si `x` es `string`: el tipo de clave de
   `t()` es unión de literales y `tsc` no lo acepta. Con `x` tipado como union
   (ej. `o.id as InstrumentoTipo`) sí funciona.
8. **Verificar**:
   ```powershell
   npx svelte-check --threshold error   # 0 errores
   npm run build                          # tsc + vite en verde
   ```
   Y en la app: cambiar de idioma y recorrer la pantalla. Lo que no cambia al
   cambiar el idioma es, por definición, algo que quedó sin traducir.

## Añadir un tercer idioma

1. Copiar `src/lib/locales/es.ts` a `xx.ts` con las mismas claves.
2. Declararlo en `src/lib/locales/en.ts` como `Record<Clave, string>` (el
   tipado del peer obliga a traducirlo entero).
3. Agregarlo a `LOCALES` y al mapa `desdeTag()` en `i18n.svelte.ts`.

## Archivo del script

`docs/i18n-status.ps1` — regenera la tabla de estado. Acepta un filtro
opcional:

```powershell
powershell -File docs\i18n-status.ps1            # todas
powershell -File docs\i18n-status.ps1 svelte     # solo páginas
powershell -File docs\i18n-status.ps1 NotasPage  # solo una
```
