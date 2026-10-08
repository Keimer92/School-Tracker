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
| **Traducido** | 15 | ~530 |
| **Pendiente** | 32 | ~253 |

Traducidos: `WelcomePage`, `AjustesPage`, `AsistenciaPage`, `NotasPage`,
`EstudiantesPage`, `ConfiguracionPage` (+ `CategoryTabContent`), `InformePage`,
`ReportesPage`, `EvaluacionesPage`, `DashboardPage`, `CloudPage`,
`ConfirmDialog`, `BrowserPicker`, `LanguagePicker` (+ `main.ts` para el
arranque del idioma y `driveSyncService` para los mensajes de error de sync).
(`DashboardPage` quedó con 0 textos sueltos: el contador lo saca del listado.)

Del total pendiente, ~180 están en páginas `.svelte` (lo que el usuario ve) y
~75 en servicios `.ts` (mayormente `show-toast`).

> ⚠️ El script marca `LISTO` en cuanto el archivo importa `i18n.svelte`, así
> que el número de "textos" de un archivo LISTO es el total que **tenía**, no
> lo que falta. Para ver qué queda dentro de un archivo LISTO hay que correr el
> inventario (`inv.ps1`) o leer el diff.

### Textos que quedan en español a propósito dentro de archivos LISTO

- **`InformePage`**: el bloque `.print-header` (`Reporte de Asistencia`,
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

Ordenado por cantidad de textos. Ya no quedan páginas del día a día en la
lista: lo que sigue son sobre todo servicios `.ts` (avisos) y páginas
secundarias (Configuración → globales, Ajustes → Depuración, Nube).

| # | Archivo | Textos | Líneas | Nota |
|---|---|---|---|---|
| 1 | `src/lib/cloudLogin.ts` | ~24 | 430 | Mensajes de login |
| 2 | `src/lib/excel.ts` | ~19 | 489 | ⚠️ Ver nota abajo |
| 3 | `src/svelte/GoogleDriveBackup.svelte` | ~18 | 390 | Legacy, no se monta |
| 4 | `src/svelte/ajustes/DebugPage.svelte` | ~16 | 594 | |
| 5 | `src/svelte/globales/ColegioConfigModal.svelte` | ~16 | 468 | |
| 6 | `src/svelte/AccountPage.svelte` | ~16 | 407 | |
| 7 | `src/svelte/Sidebar.svelte` | ~12 | 184 | |
| 8 | `src/lib/instrumentosPdf.ts` | ~12 | 294 | ⚠️ Encabezados de PDF |
| 9 | `src/lib/deviceHandover.ts` | ~11 | 121 | |
| 10 | `src/lib/wsSyncService.ts` | ~10 | 230 | Avisos de sync |
| 11 | `src/svelte/FiltersModalAndroid.svelte` | ~10 | 187 | Modal de filtros en Android |
| 12 | `src/svelte/ajustes/InfoPage.svelte` | ~10 | 199 | |
| 13 | `src/App.svelte` | ~9 | 584 | Shell, tabs |
| 14 | `src/lib/driveAutoBackup.ts` | ~9 | 445 | |
| 15 | `src/svelte/CloudCards.svelte` | ~8 | 541 | |
| 16 | `src/svelte/notificaciones/NotificacionesPage.svelte` | ~7 | 633 | Solo Android |
| 17 | `src/lib/d1SyncService.ts` | ~7 | 380 | Avisos de sync |
| 18 | `src/svelte/globales/CalificacionesConfig.svelte` | ~6 | 142 | |
| 19 | `src/lib/botones.ts` | ~6 | 51 | |
| 20 | `src/svelte/globales/MultiplicadoresConfig.svelte` | ~5 | 116 | |
| 21 | `src/svelte/globales/GradoConfigModal.svelte` | ~3 | 146 | |
| 22 | `src/lib/driveInstantBackup.ts` | ~3 | 223 | |
| 23 | `src/svelte/SearchInput.svelte` | ~3 | 39 | Placeholder |
| 24 | `src/svelte/AndroidDrawer.svelte` | ~3 | 235 | |
| 25 | `src/svelte/asistencia/AsistenciaMainPage.svelte` | ~2 | 223 | Wrapper de sub-tabs |
| 26 | `src/svelte/FilterSelect.svelte` | ~2 | 29 | Genérico |
| 27 | `src/lib/instrumentosExcel.ts` | ~1 | 299 | ⚠️ Hoja/encabezado de Excel |
| 28 | `src/svelte/notas/NotasMainPage.svelte` | ~1 | 230 | Wrapper de sub-tabs |
| 29 | `src/svelte/DatePickerGlass.svelte` | ~1 | 390 | Placeholder |
| 30 | `src/svelte/BotonMod.svelte` | ~1 | 46 | Genérico |
| 31 | `src/svelte/FilterContainer.svelte` | ~1 | 20 | Genérico |
| 32 | `src/svelte/FilterGroup.svelte` | ~1 | 17 | Genérico |

### Servicios `.ts` (textos de `show-toast` y avisos)

| Archivo | Textos | Nota |
|---|---|---|
| `src/lib/driveSyncService.ts` | ~34 | Casi todos `console`; solo los toasts |
| `src/lib/cloudLogin.ts` | ~24 | Mensajes del login |
| `src/lib/excel.ts` | ~19 | ⚠️ **No traducir** (ver decisiones) |
| `src/lib/instrumentosPdf.ts` / `instrumentosExcel.ts` | ~13 | ⚠️ **No traducir** |
| `src/lib/deviceHandover.ts` | ~11 | Mensajes de traspaso de dispositivo |
| `src/lib/wsSyncService.ts` | ~10 | Casi todos `console` |
| `src/lib/driveAutoBackup.ts` | ~9 | Logs |
| `src/lib/d1SyncService.ts` | ~7 | 1 mensaje visible + console |
| `src/lib/botones.ts` | ~6 | Etiquetas de botones reutilizables |

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
