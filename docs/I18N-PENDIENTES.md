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
| **Traducido** | 8 | ~379 |
| **Pendiente** | 40 | ~545 |

Traducidos: `WelcomePage`, `AjustesPage`, `AsistenciaPage`, `NotasPage`,
`EstudiantesPage`, `ConfirmDialog`, `BrowserPicker`, `LanguagePicker`
(+ `main.ts` para el arranque del idioma).

Del total pendiente, ~430 están en páginas `.svelte` (lo que el usuario ve) y
~115 en servicios `.ts` (mayormente `show-toast`).

## Pendientes, por impacto

Ordenado por cantidad de textos. Las tres primeras son el grueso del trabajo
y las que el usuario usa todos los días.

| # | Archivo | Textos | Líneas | Nota |
|---|---|---|---|---|
| 1 | `src/svelte/ConfiguracionPage.svelte` | ~67 | 496 | Configuración de catálogos |
| 2 | `src/svelte/InformePage.svelte` | ~65 | 1341 | Informe de asistencia |
| 3 | `src/svelte/ReportesPage.svelte` | ~54 | 1453 | Reportes de notas |
| 4 | `src/lib/driveSyncService.ts` | ~34 | 1092 | Avisos de respaldo Drive |
| 5 | `src/svelte/EvaluacionesPage.svelte` | ~25 | 515 | Indicadores y criterios |
| 6 | `src/lib/cloudLogin.ts` | ~24 | 430 | Mensajes de login |
| 7 | `src/svelte/DashboardPage.svelte` | ~20 | 514 | |
| 8 | `src/svelte/CloudPage.svelte` | ~20 | 844 | Nube / respaldos |
| 9 | `src/lib/excel.ts` | ~19 | 489 | ⚠️ Ver nota abajo |
| 10 | `src/svelte/GoogleDriveBackup.svelte` | ~18 | 390 | Legacy, no se monta |
| 11 | `src/svelte/ajustes/DebugPage.svelte` | ~16 | 594 | |
| 12 | `src/svelte/globales/ColegioConfigModal.svelte` | ~16 | 468 | |
| 13 | `src/svelte/AccountPage.svelte` | ~16 | 407 | |
| 14 | `src/svelte/Sidebar.svelte` | ~12 | 184 | |
| 15 | `src/lib/instrumentosPdf.ts` | ~12 | 294 | ⚠️ Encabezados de PDF |
| 16 | `src/lib/deviceHandover.ts` | ~11 | 121 | |
| 17 | `src/lib/wsSyncService.ts` | ~10 | 230 | Avisos de sync |
| 18 | `src/svelte/FiltersModalAndroid.svelte` | ~10 | 187 | Modal de filtros en Android |
| 19 | `src/svelte/ajustes/InfoPage.svelte` | ~10 | 199 | |
| 20 | `src/App.svelte` | ~9 | 584 | Shell, tabs |
| 21 | `src/lib/driveAutoBackup.ts` | ~9 | 445 | |
| 22 | `src/svelte/CloudCards.svelte` | ~8 | 541 | |
| 23 | `src/lib/d1SyncService.ts` | ~7 | 380 | Avisos de sync |
| 24 | `src/svelte/notificaciones/NotificacionesPage.svelte` | ~7 | 633 | Solo Android |
| 25 | `src/svelte/CategoryTabContent.svelte` | ~7 | 749 | Genérico de configuración |
| 26 | `src/lib/botones.ts` | ~6 | 51 | |
| 27 | `src/svelte/globales/CalificacionesConfig.svelte` | ~6 | 142 | |
| 28 | `src/svelte/globales/MultiplicadoresConfig.svelte` | ~5 | 116 | |
| 29 | `src/svelte/globales/GradoConfigModal.svelte` | ~3 | 146 | |
| 30 | `src/lib/driveInstantBackup.ts` | ~3 | 223 | |
| 31 | `src/svelte/SearchInput.svelte` | ~3 | 39 | Placeholder |
| 32 | `src/svelte/AndroidDrawer.svelte` | ~3 | 235 | |
| 33 | `src/svelte/asistencia/AsistenciaMainPage.svelte` | ~2 | 223 | Wrapper de sub-tabs |
| 34 | `src/svelte/FilterSelect.svelte` | ~2 | 29 | Genérico |
| 35 | `src/lib/instrumentosExcel.ts` | ~1 | 299 | ⚠️ Hoja/encabezado de Excel |
| 36 | `src/svelte/notas/NotasMainPage.svelte` | ~1 | 230 | Wrapper de sub-tabs |
| 37 | `src/svelte/DatePickerGlass.svelte` | ~1 | 390 | Placeholder |
| 38 | `src/svelte/FilterGroup.svelte`, `FilterContainer.svelte`, `BotonMod.svelte` | ~3 | — | Genéricos, casi sin texto |

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
7. **Verificar**:
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
