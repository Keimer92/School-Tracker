import type { Clave } from './es';

/**
 * Diccionario en inglés.
 *
 * El tipo `Record<Clave, string>` es la pieza clave de la infraestructura: si
 * se agrega una clave en `es.ts` y se olvida traducirla acá, el `tsc` del build
 * falla con "Property 'x' is missing". No hace falta ningún script de chequeo.
 *
 * ⚠️ No dejar valores en español "por ahora": es preferible un `[EN] ...`
 * visible a un texto en español que rompa el idioma en producción.
 */
export const en: Record<Clave, string> = {
  // ── Common ───────────────────────────────────────────────────────────────
  'comun.volver': 'Back',
  'comun.cancelar': 'Cancel',
  'comun.cerrar': 'Close',
  'comun.continuar': 'Continue',
  'comun.siguiente': 'Next',
  'comun.anterior': 'Previous',
  'comun.si': 'Yes',
  'comun.no': 'No',
  'comun.activo': 'Active',
  'comun.buscando': 'Searching…',
  'comun.cargando': 'Loading…',
  'comun.guardando': 'Saving…',
  'comun.guardar': 'Save',
  'comun.confirmar': 'Confirm',

  // ── Language picker ──────────────────────────────────────────────────────
  'idioma.titulo': 'Language',
  'idioma.descripcion': 'Application language.',
  'idioma.es': 'Español',
  'idioma.en': 'English',

  // ── WelcomePage ──────────────────────────────────────────────────────────
  'welcome.appTitle': 'School Tracker',
  'welcome.subtitle': 'Choose how you want to start',
  'welcome.cardGoogle.title': 'Continue with Google',
  'welcome.cardGoogle.desc': 'Sign in with your account and recover the latest backup saved in Google Drive.',
  'welcome.cardGoogle.tag1': 'Google Drive',
  'welcome.cardGoogle.tag2': 'No code needed',
  'welcome.cardWizard.title': 'Start from scratch',
  'welcome.cardWizard.desc': 'Create a clean database and pick the grades and sections you will use.',
  'welcome.cardWizard.tag1': 'Preloaded catalog',
  'welcome.cardWizard.tag2': 'No cloud',
  'welcome.google.nueva': 'Looking for your latest Google Drive backup…',
  'welcome.google.entrando': 'Signing in to the cloud…',
  'welcome.google.verificando': 'Verifying your identity…',
  'welcome.google.navegador': 'Your browser opened: sign in with Google there…',
  'welcome.drive.buscando': 'Looking for Drive backups…',
  'welcome.drive.descargando': 'Downloading backup…',
  'welcome.drive.restaurando': 'Restoring backup…',
  'welcome.drive.restaurado': 'Backup restored',
  'welcome.drive.vacio': 'No backups in Google Drive',
  'welcome.drive.sinRespaldo':
    'This account has no Drive backups. Trying to recover your data from the cloud…',
  'welcome.drive.todosVacios': 'The Drive backups downloaded, but they all had an empty database.',
  'welcome.drive.error': 'Could not restore from Drive: {msg}',
  'welcome.drive.nuevaCuenta':
    'This Google account is new: it has no Drive backups and no data in the cloud. Let us set up your database from scratch.',
  'welcome.drive.antiguoTitulo': 'Restore an old backup',
  'welcome.drive.antiguoAviso':
    'The Drive backup is from {fecha}, older than the last cloud sync ({fechaNube}).\n\nIf you restore it, you may lose attendance or grades changed on the desktop after that date.',
  'welcome.drive.antiguoSi': 'Yes, restore it anyway',
  'welcome.drive.antiguoNo': 'Cancel',
  'welcome.drive.cancelado': 'Restore cancelled.',
  'welcome.drive.descartados': 'Discarded: {lista}',
  'welcome.nube.sincronizando': 'Syncing the backup with the cloud…',
  'welcome.nube.sinNube':
    'Your account has no access to this developer’s cloud. We will continue with your Google Drive.',
  'welcome.nube.error': 'Could not connect to the cloud: {msg}',
  'welcome.nube.reintentando': 'Retrying the download…',
  'welcome.nube.vaciaRespuesta':
    'Your cloud answered correctly but it is empty: no data is stored for this account. Let us set up your database from scratch.',
  'welcome.nube.quotaTitulo': '☁️⚠️ Cloudflare daily limit reached',
  'welcome.nube.quotaBody':
    'The free Cloudflare Workers plan has a daily cap of about 100,000 requests. If you hit the limit, the quota resets at 00:00 UTC (around {reinicio}). You can wait and retry, or configure it manually and sync tomorrow once the quota has reset.',
  'welcome.nube.sinDatosTitulo': '☁️ No data in the cloud for this account',
  'welcome.nube.sinDatosBody':
    'The server answered correctly but there is no synced data for your Google account in the cloud.\n\nThis can happen if this is the first time you connect this account, or if the data was previously deleted from the cloud.\n\nYou can retry the download, restore from Google Drive if you have a backup, or create a local database from scratch.',
  'welcome.nube.incompletosTitulo': '☁️ Incomplete data in the cloud',
  'welcome.nube.incompletosBody':
    'Some data was downloaded but the information is incomplete (base tables such as school year or schools are missing). This usually happens when the Cloudflare quota ran out halfway through the download.\n\nYou can retry to fetch the missing data, or create the local database from scratch.',
  'welcome.nube.noConectadoTitulo': 'Could not connect to the cloud',
  'welcome.nube.noConectadoBody': 'Check your internet connection and try again in a few minutes.',
  'welcome.nube.noConfigTitulo': 'Connection not configured',
  'welcome.nube.noConfigBody':
    'The cloud connection is not configured. Configure it manually or import a connection file (.key).',
  'welcome.nube.errorServidorTitulo': 'Server error',
  'welcome.nube.errorServidorBody':
    'The sync server returned an error. It may be a temporary problem: try again or configure the cloud manually.',
  'welcome.nube.errorTitulo': 'Could not connect to the cloud',
  'welcome.nube.errorBody':
    'An error occurred while talking to the server. Try again or configure it manually.',
  'welcome.inicializandoParcial': 'Starting the app with partial data…',
  'welcome.errorGenerico': 'Error: {msg}',
  'welcome.wizard.preparando': 'Preparing the initial setup…',
  'welcome.wizard.volver': '← Back to the options',
  'welcome.wizard.sinDatos': 'No previous data found. Let us set up your database from scratch.',
  'welcome.wizard.stepAnios': 'School years',
  'welcome.wizard.stepAsignaturas': 'Subjects',
  'welcome.wizard.stepGrados': 'Grades',
  'welcome.wizard.stepSecciones': 'Sections',
  'welcome.wizard.stepColegios': 'Schools',
  'welcome.wizard.stepResumen': 'Summary',
  'welcome.wizard.minimoElementos': 'You must add at least one item in each category.',
  'welcome.wizard.errorGuardando': 'Error saving data: {msg}',
  'welcome.wizard.volverBoton': '← Back',
  'welcome.wizard.agregar': 'Add',
  'welcome.wizard.siguiente': 'Next →',
  'welcome.wizard.anterior': '← Previous',
  'welcome.wizard.verDetalle': 'See technical details',
  'welcome.wizard.tipo': 'School type',
  'welcome.wizard.primaria': 'Primary',
  'welcome.wizard.secundaria': 'Secondary',
  'welcome.wizard.tipoAplicara1': 'Type that will be applied:',
  'welcome.wizard.tipoAplicara2': '(detected from the selected grades).',
  'welcome.wizard.hintGrados':
    'Select the grades you will use. The school type is detected automatically: with a 7th grade or higher it becomes Secondary.',
  'welcome.wizard.hintSecciones':
    'Select the sections you will use. They are shared across all grades.',
  'welcome.wizard.hintAsignaturas':
    'Select the subjects you will use. Quantitative ones are graded with a number, qualitative ones with a label (AA/AS/AF/AI).',
  'welcome.wizard.grupoCuantitativas': '📊 Quantitative',
  'welcome.wizard.grupoCualitativas': '🏷️ Qualitative',
  'welcome.wizard.sinColegios': 'You have not added any schools yet. Type one above and press "Add".',
  'welcome.wizard.sinItems': 'You have not added {item} yet. Type one above and press "Add".',
  'welcome.wizard.diasClases': 'Class days',
  'welcome.wizard.asignaturasImparte': 'Subjects taught',
  'welcome.wizard.seleccionaTodos': 'All',
  'welcome.wizard.seccionTitle': 'Section {s}',
  'welcome.wizard.phColegio': 'E.g. Central School',
  'welcome.wizard.phAsignatura': 'E.g. History (if not in the list)',

  // ── AttendancePage ───────────────────────────────────────────────────────
  'asis.estado.presente': 'Present',
  'asis.estado.ausente': 'Absent',
  'asis.estado.justificado': 'Excused',
  'asis.estado.sinMarcar': 'Not marked',
  'asis.stats.total': 'Total',
  'asis.stats.presentes': 'Present',
  'asis.stats.ausentes': 'Absent',
  'asis.stats.justificados': 'Excused',
  'asis.stats.asistencia': 'Attendance',
  'asis.col.estudiante': 'Student',
  'asis.col.asistencia': 'Attendance',
  'asis.col.observacion': 'Note',
  'asis.col.porcentajeMes': '% Month',
  'asis.estudiantes': 'Students',
  'asis.cargando': 'Loading students…',
  'asis.limpiarBusqueda': 'Clear search',
  'asis.noClasesHoy': 'No classes this day',
  'asis.diaNoLaborable': '📅 Non-working day',
  'asis.diaNoLaborableDesc':
    'The selected school does not have attendance enabled for the days',
  'asis.sinDiasHabiles.titulo': '📅 No working days',
  'asis.sinDiasHabiles.desc': 'No working days are configured for the selected period.',
  'asis.vacio.titulo': 'No results found',
  'asis.vacio.tituloAlt': 'No students to show',
  'asis.vacio.desc': 'No students match the selected filters.',
  'asis.vacio.busqueda': 'No student matches "{q}"',
  'asis.filtros.todas': 'All',
  'asis.filtros.ninguna': 'None',
  'asis.filtros.total': 'Total:',
  'asis.filtros.masculino': 'Male',
  'asis.filtros.femenino': 'Female',
  'asis.periodo.etiqueta': 'Period:',
  'asis.periodo.diario': 'Daily',
  'asis.periodo.semanal': 'Weekly',
  'asis.periodo.mensual': 'Monthly',
  'asis.periodo.semanaDe': 'Week of:',
  'asis.periodo.mes': 'Month:',
  'asis.guardado.escribiendo': 'Writing to the database',
  'asis.guardado.sinGuardar': 'Unsaved changes',
  'asis.guardado.limpio': 'No changes',
  'asis.btn.guardar': 'Save attendance',
  'asis.btn.listo': '✓ Done',
  'asis.btn.limpiar': 'Clear',
  'asis.masivo.titulo': 'Which days to mark?',
  'asis.masivo.presentes': 'Mark present',
  'asis.masivo.ausentes': 'Mark absent',
  'asis.masivo.justificados': 'Mark excused',
  'asis.masivo.sinMarcadas': '⚠️ No attendance marked on those days',
  'asis.masivo.todos': 'Mark every student for the day',
  'asis.masivo.todosDesc': 'Fill in only the empty attendance slots for the days you pick, and save them',
  'asis.masivo.completo': 'All done',
  'asis.masivo.marcarTodos': 'Mark all',
  'asis.masivo.guardando': '⏳ Saving',
  'asis.masivo.marcarGuardar': 'Mark and save',
  'asis.masivo.al': 'to',
  'asis.masivo.fechas': 'Dates',
  'asis.masivo.estudiantes': 'Students',
  'asis.masivo.confirmarMsg':
    'Mark {n} attendance record(s) as "{estado}" ({codigo})?\n\nDates: {rango} ({dias})\nStudents: {estudiantes}\n\nOnly empty ones are filled in; the ones that already have a state are left untouched.',
  'asis.masivo.marcarTitulo': 'Mark {estado} in bulk',
  'asis.masivo.exito': '✅ {n} attendance record(s) saved ({estado})',
  'asis.masivo.siMarcar': 'Yes, mark and save',
  'asis.limpiar.titulo': 'Which days to clear?',
  'asis.limpiar.btn': 'Clear attendance',
  'asis.limpiar.diario': 'Clear the attendance for the day',
  'asis.limpiar.diarioDesc': 'Clear the attendance marked on the days you pick',
  'asis.limpiar.mensual': 'Nothing to clear',
  'asis.limpiar.mensualDesc':
    'Clear the marked cells for the chosen days and delete them from the database',
  'asis.limpiar.rellenarDesc': 'Fill in the empty cells for the chosen days and save to the database',
  'asis.limpiar.limpiarGuardar': 'Clear and save',
  'asis.limpiar.confirmar': 'Yes, clear',
  'asis.limpiar.confirmarTitulo': 'Confirm clearing',
  'asis.limpiar.pedirGuardar': 'Clear every attendance state for the current period?\n\nUnsaved changes will be discarded.',
  'asis.limpiar.alcanceSeccion': 'this section',
  'asis.limpiar.alcanceGrado': 'this grade',
  'asis.limpiar.alcanceColegio': 'this school',
  'asis.limpiar.vacias': '⚠️ No attendance marked on those days',
  'asis.limpiar.confirmarMsg':
    'Clear {n} marked attendance record(s)?\n\nDates: {rango} ({dias})\nStudents: {estudiantes}\n\n{aviso}Only the chosen days are cleared; the rest of the period is left untouched.',
  'asis.limpiar.avisoServidor':
    '⚠️ {n} record(s) will be deleted from the database, along with the note for those days.\n\n',
  'asis.limpiar.exito': '✅ {n} attendance record(s) cleared',
  'asis.limpiar.aviso': '🧹 Attendance cleared. Remember to save your changes.',
  'asis.sinClases.btn': 'No classes',
  'asis.sinClases.chip': 'No classes',
  'asis.sinClases.pasto': 'Mark as no class',
  'asis.sinClases.confirmar': 'Yes, mark',
  'asis.sinClases.todosColegios': 'Mark in every school',
  'asis.sinClases.todosColegiosConfirmar': 'Yes, mark all',
  'asis.sinClases.reactivarTodos': 'Restore classes in every school',
  'asis.sinClases.reactivar': 'Restore classes',
  'asis.sinClases.motivo': 'Reason for the day(s) without classes',
  'asis.sinClases.todoPeriodo': 'Whole period',
  'asis.sinClases.elegirSemana': 'Pick a week',
  'asis.sinClases.descSemana': 'Leave one week of the month without classes',
  'asis.sinClases.descPeriodo': 'Mark the current period as having no classes',
  'asis.sinClases.tituloSemana': 'Week without classes',
  'asis.sinClases.alcanceTodo': 'the whole school',
  'asis.sinClases.alcanceColegio': 'this school',
  'asis.sinClases.alcanceSoloSeccion': 'only this section',
  'asis.sinClases.eseDia': 'that day',
  'asis.sinClases.periodoActual': 'the current period',
  'asis.sinClases.todoColegio': 'ALL schools',
  'asis.sinClases.marcado': 'Day marked as no class',
  'asis.sinClases.badgeTodo': '🏫 Whole school',
  'asis.sinClases.badgeSeccion': '🚪 This section',
  'asis.sinClases.clickMarcar': 'Click to mark this day as no class',
  'asis.sinClases.clickReactivar': '— Click to restore classes',
  'asis.sinClases.motivoVacio': 'No classes',
  'asis.sinClases.etiquetaSemana': 'week {n}',
  'asis.sinClases.motivoObligatorio': '⚠️ The reason is required',
  'asis.sinClases.seleccioneSemana': '⚠️ Select the week that will have no classes',
  'asis.sinClases.alcance': 'Scope',
  'asis.sinClases.afecta': 'Affects',
  'asis.sinClases.confirmarMsg':
    'Mark {rango} as day(s) without classes?\n\nScope: {alcance}\nAffects: {afecta}\nReason: {motivo}',
  'asis.sinClases.nivelColegio': 'School',
  'asis.sinClases.nivelSeccion': 'Section',
  'asis.sinClases.exito': '🚫 {nivel}: {n} day(s) without classes ({motivo})',
  'asis.sinClases.exitoTodos': '🚫 {n} day(s) without classes in every school ({motivo})',
  'asis.sinClases.reactivarExito': 'Classes restored: {n} day(s)',
  'asis.sinClases.sinColegios': '⚠️ No schools registered',
  'asis.sinClases.todosTitulo': 'ALL schools',
  'asis.sinClases.todosConfirmarMsg':
    'Mark {rango} as no classes in the {n} school(s)?\n\nScope: {alcance}\nAffects: {afecta}\nReason: {motivo}',
  'asis.sinClases.todosExito': '🌐 {dias} day(s) without classes in {n} school(s) ({motivo})',
  'asis.sinClases.reactivarTodosMsg':
    'Restore the classes for {rango} in the {n} school(s)?\n\nThe mark will be removed from every school.',
  'asis.sinClases.reactivarSi': 'Yes, restore',
  'asis.sinClases.reactivarTodosExito': '✅ Classes restored in every school',
  'asis.sinClases.errorMarcarTodos': '❌ Error marking in every school: {msg}',
  'asis.sinClases.errorReactivarTodos': '❌ Error restoring in every school: {msg}',
  'asis.sinClases.reactivarUnicoMsg': 'Restore the classes for {rango}?',
  'asis.sinClases.reactivarUnicoAlcance': 'Scope: {alcance}',
  'asis.sinClases.reactivarOk': '✅ Classes restored: {n} day(s)',
  'asis.filtro.sexo': 'Sex:',
  'asis.filtro.todos': 'All',
  'asis.sinClases.marcarFecha': 'Mark {fecha} as no class',
  'asis.sinClases.semanaN': 'Week {n}',
  'asis.sinClases.secciones': 'Sections',
  'asis.sinClases.colegios': 'Schools',
  'asis.sinClases.phMotivo': 'E.g. National holiday (required)',
  'asis.sinClases.reactivarSemana': '♻️ Restore the classes of week {n}',
  'asis.sinClases.marcarSeccion': '🚪 Mark only this section',
  'asis.sinClases.marcarColegio': '🏫 Mark this whole school',
  'asis.sinClases.marcarTodos': '🌐 Mark in ALL schools',
  'asis.sinClases.tituloSeccion': 'Only affects {seccion} of {grado}',
  'asis.sinClases.tituloColegio': 'Affects every section of {colegio}',
  'asis.sinClases.tituloTodos':
    'Affects the {n} school(s) in the catalog, for the visible week or period',
  'asis.limpiar.marcadas': '{n} marked',
  'asis.limpiar.conEstado': '{n} with a state',
  'asis.btn.rellenar': 'Fill in',
  'asis.rellenar.sinMarcar': '{n} not marked',
  'asis.rellenar.estudiantes': '{n} student(s)',
  'asis.ausencia.soloEstaFecha': 'Only affects that specific date',
  'asis.ausencia.hintSemana': 'Hover a week to highlight it in the table',
  'asis.confirmar.guardar': 'Save the pending attendance changes?',
  'asis.confirmar.guardarTitulo': 'Confirm save',
  'asis.confirmar.sinGuardar': 'You have unsaved changes. Save them before continuing?',
  'asis.confirmar.sinGuardarTitulo': 'Unsaved changes',
  'asis.confirmar.descartar': 'Discard',
  'asis.error.guardar': '❌ Error saving: {msg}',
  'asis.error.limpiar': '❌ Error clearing: {msg}',
  'asis.error.masivo': 'Error marking attendance in bulk: {msg}',
  'asis.error.limpiarMasivo': 'Error clearing attendance: {msg}',
  'asis.error.diasSinClases': 'Error marking days without classes: {msg}',
  'asis.error.diasSinClasesTodos':
    'Error marking days without classes in every school: {msg}',
  'asis.error.reactivarTodos':
    'Error restoring days without classes in every school: {msg}',
  'asis.error.reactivar': 'Error restoring classes: {msg}',
  'asis.error.cargarDias': 'Error loading days without classes: {msg}',

  // ── NotesPage ────────────────────────────────────────────────────────────
  'notas.filtro.corte': 'Term:',
  'notas.filtro.asignatura': 'Subject:',
  'notas.filtro.corteActual': 'Current term',
  'notas.filtro.colegio': 'School:',
  'notas.filtro.grado': 'Grade:',
  'notas.filtro.seccion': 'Section:',
  'notas.filtro.sexo': 'Sex:',
  'notas.filtro.todos': 'All',
  'notas.filtro.masculino': 'Male',
  'notas.filtro.femenino': 'Female',
  'notas.acciones': 'Actions',
  'notas.activos': '{n} active · {m} grades',
  'notas.btn.deshacer': 'Undo',
  'notas.btn.rehacer': 'Redo',
  'notas.btn.guardarCorto': 'Save',
  'notas.btn.guardando': 'Saving',
  'notas.historial': '{n} in history',
  'notas.porRehacer': '{n} to redo',
  'notas.cambiosPendientes': '{n} changes',
  'notas.corte': 'Term',
  'notas.filtro.masc': 'M',
  'notas.filtro.fem': 'F',
  'notas.chip.colegio': 'School',
  'notas.chip.grado': 'Grade',
  'notas.chip.seccion': 'Section',
  'notas.chip.asignatura': 'Subject',
  'notas.cargando': 'Loading data...',
  'notas.noSuma': '· does not count',
  'notas.noSumaCorto': 'does not count',
  'notas.noSumaTotal': '· does not count toward the total',
  'notas.estudiantes': 'Students',
  'notas.sumanSeccion': 'Counting in this section:',
  'notas.configPropia': '· 📌 section-specific config',
  'notas.col.estudiante': 'Student',
  'notas.col.final': 'Final',
  'notas.col.notaFinal': 'Final grade',
  'notas.vacio.titulo': 'No results found',
  'notas.vacio.tituloAlt': 'No students to show',
  'notas.vacio.seleccioneFiltros': 'Select the filters',
  'notas.limpiarBusqueda': 'Clear search',
  'notas.btn.instrumentos': 'Instruments',
  'notas.btn.distribuir': 'Distribute',
  'notas.btn.eliminarNotas': 'Delete grades',
  'notas.btn.acciones': 'Instruments, distribute and delete grades',
  'notas.guardado.escribiendo': 'Writing to the database',
  'notas.guardado.sinGuardar': 'Unsaved changes',
  'notas.guardado.limpio': 'No changes',
  'notas.btn.guardar': 'Save grades (Ctrl+G)',
  'notas.deshacer': 'Undo (Ctrl+Z)',
  'notas.rehacer': 'Redo (Ctrl+Y)',
  'notas.rehacerNada': 'Nothing to redo',
  'notas.sinDescripcion': 'No description',
  'notas.sinDescripcionPar': '(No description)',
  'notas.sinNotas': 'No grades entered',
  'notas.sinNotasCorto': 'no grades',
  'notas.errorGenerico': '❌ Error: {msg}',
  'notas.buscar.placeholder': 'Search student or grade...',
  'notas.filtro.anoLectivo': 'School year:',
  'notas.movil.indice': '{i} of {n} — tap for the list',
  'notas.escala0a100': '0-100 scale',
  'notas.indicador': 'Indicator {n}',
  'notas.indicadorInactivo': 'INACTIVE: its grades do not count toward the 100 pts total',
  'notas.criterioClic': ' — click to see criterion options',
  'notas.maxCriterio': 'max {n}',
  'notas.estudiantesConteo': '{n} students',
  'notas.criteriosCount': '{n} criterion/criteria',
  'notas.sumanTitulo': 'Indicators counting in this section. Change it with the ⚙ on each indicator.',
  'notas.configPropiaTitulo':
    'This section has indicators different from the global ones. Use ⚙ → Reset to go back to the default values.',
  'notas.noSumanTitulo':
    'Inactive indicators are also shown and can be graded, but their grades do NOT count toward the 100 pts total nor are touched by the distribute modal.',
  'notas.noSumanCount': '· {n} not counting',
  'notas.maxRealTitulo':
    'With {n} indicators the real maximum is {pts} pts. The Final column is shown on a 0-100 scale.',
  'notas.maxReal': '· real max {pts} pts',
  'notas.col.finalTitulo':
    '0-100 scale (same as the distribute modal). Hover over the grade to see the raw points.',
  'notas.vacio.sinResultados': 'No student matched "{q}"',
  'notas.vacio.sinEstudiantes':
    'There are no students registered for {grado} - {seccion}. Please register students in the Students section.',
  'notas.vacio.seleccioneDesc':
    'Select a school year, term, school, subject, grade and section to view and grade the students.',
  'notas.tooltip.sumaTotal': 'Counts toward the total: {a} of {b} pts',
  'notas.tooltip.inactivo': 'Inactive indicator: {a} of {b} pts — does NOT count',
  'notas.tooltip.total': '{a} of {b} pts',
  'notas.btn.instrumentosTitulo': 'Assessment instruments',
  'notas.btn.instrumentosSub': 'PDF and XLSX for {a} of {b} active',
  'notas.btn.distribuirSub': 'Automatic distribution of {n} active',
  'notas.del.previa': '⚠️ Select a term and a subject first',
  'notas.btn.eliminarNotasSub': 'Deletes the {n} grades of the current filter',
  'notas.popover.distribuirAuto': 'Distribute grades automatically',
  'notas.popover.opciones': 'Options',
  'notas.elegir.lleno': 'There are already {n} active indicators',
  'notas.elegir.desc1': 'To activate Indicator {n}, choose which one to deactivate.',
  'notas.elegir.desc2': 'Nothing is deleted:',
  'notas.elegir.desc3': 'the one removed keeps its grades.',
  'notas.elegir.swapTitle': 'Deactivate Indicator {a} and activate {b}',
  'notas.elegir.cualitativo': 'qualitative',
  'notas.elegir.conservaTitle': 'Keeps {n} grade(s)',
  'notas.elegir.conservaCount': '{n} grade(s)',
  'notas.elegir.vacio': 'empty',
  'notas.popover.sumaAqui': 'counts here',
  'notas.popover.noSumaAqui': 'does not count here',
  'notas.popover.dejarSumar': 'Stop counting here',
  'notas.popover.sumarSeccion': 'Count in this section',
  'notas.popover.ayuda1': 'Stops counting in this section, but keeps its grades.',
  'notas.popover.ayuda2': 'There are already {n} counting here ({a}). You will be asked which one to stop.',
  'notas.popover.ayuda3': 'Its grades will count in this section ({a} of {b}).',
  'notas.popover.restablecerTitulo': 'Remove this section exceptions and go back to the global values',
  'notas.popover.restablecer': 'Reset to global values',
  'notas.popover.vaciar': 'Clear indicator grades',
  'notas.popover.vaciarAyuda':
    'Leaves the {n} columns empty to fill in again, only in {corte}. The indicator is not deleted.',
  'notas.esteCorte': 'this term',
  'notas.popover.criterioTitulo': 'Criterion {c} · Indicator {i}',
  'notas.popover.maxPts': ' · max {n} pts',
  'notas.popover.aplicarTodos': 'Apply grade to everyone',
  'notas.popover.soloVacias': 'Empty cells only',
  'notas.popover.soloVaciasEstado': 'Does not overwrite existing grades',
  'notas.popover.sobrescribeEstado': 'Overwrites all',
  'notas.popover.eliminarCriterio': 'Delete this criterion',
  'notas.popover.eliminarAyuda': 'Deletes only C{n} of this indicator and all its grades in every term.',
  'notas.dist.titulo': 'Distribute grades automatically',
  'notas.dist.subCual': 'C1, C2{c3} = target grade{sinC3}. Only AA, AS, AF available.',
  'notas.dist.subCualC3': ' and C3',
  'notas.dist.subCualSinC3': ', C3 = AA',
  'notas.dist.subNum': 'Enter the desired total percentage (0-100). C1, C2{c3} are calculated automatically.',
  'notas.dist.consejo1': '💡 Performance never goes backwards: always ',
  'notas.dist.consejo2':
    '. When possible the lowest letter goes to C1 and the highest to C3, without losing the requested grade.',
  'notas.dist.chipTitle': '{titulo}: {label}',
  'notas.popover.sobrescribir': 'Overwrite existing grades',
  'notas.dist.overwriteOn': 'All grades will be replaced',
  'notas.dist.overwriteOff': 'Only empty criteria will be filled',
  'notas.popover.modificarC3': 'Also modify C3',
  'notas.dist.c3On': 'C1, C2 and C3 are distributed',
  'notas.dist.c3Off': 'C3 will always be AA',
  'notas.popover.compararCortes': 'Compare previous terms',
  'notas.dist.cargandoAnt': '⏳ Loading previous grades…',
  'notas.dist.colConNota1': '{n} column with the final grade',
  'notas.dist.colConNotaN': '{n} columns with the final grade',
  'notas.dist.notaFinalAnterior': 'Final grade of each previous term',
  'notas.dist.corte': 'term',
  'notas.dist.corteActual': 'current term',
  'notas.dist.corteDistribuyendo': 'Term being distributed: {nombre}',
  'notas.dist.metaCual': 'Final grade after applying the chosen letter',
  'notas.dist.metaNum': 'Total resulting from applying the new total',
  'notas.dist.nuevaNota': 'New grade',
  'notas.dist.resultante': '→ Resulting',
  'notas.dist.notaObjetivo': 'Target grade',
  'notas.dist.nuevoTotal': 'New total',
  'notas.dist.corteTitulo': '{nombre}: {valor}',
  'notas.dist.sinNotas': 'no grades',
  'notas.dist.notaFinalActual': 'Current final grade ({nombre})',
  'notas.dist.aplicar': '✨ Apply',
  'notas.inst.titulo': '📋 Assessment instruments',
  'notas.inst.generando': '⏳ Generating…',
  'notas.inst.generarTodos': '📄 Generate all',
  'notas.inst.ayudaExcel': '❓ Excel help',
  'notas.inst.plantillaTitulo': '📗 Template:',
  'notas.inst.cargandoPlantillas': 'loading…',
  'notas.inst.sinPlantillas':
    'No templates — open the folder and copy your .xlsx (name containing Rubrica/Cotejo/Escala)',
  'notas.inst.auto': '(Auto — based on the indicator type)',
  'notas.inst.tipoRubrica': '🟣 Rubric',
  'notas.inst.tipoCotejo': '🟢 Checklist',
  'notas.inst.tipoEscala': '🔵 Scale',
  'notas.inst.carpeta': '📂 Folder',
  'notas.inst.abrirCarpeta': 'Open templates folder',
  'notas.inst.recargar': 'Reload list',
  'notas.inst.ayudaTitulo': '📗 How to create your Excel template',
  'notas.inst.copiarInstrucciones': '📋 Copy instructions',
  'notas.inst.sinPlantillasTitulo': 'There are no templates in the Templates folder',
  'notas.inst.tituloPdf': 'Generate the PDF for this instrument',
  'notas.inst.tituloXls': 'Generate from your Excel template (.xlsx) with markers',
  'notas.inst.sinIndicadores': 'No indicators configured',
  'notas.inst.pie':
    'The instrument is saved per indicator and syncs across devices. PDFs are generated with the current grades.',
  'notas.inst.guiaTitulo': '📗 Your own Excel template',
  'notas.inst.guia1a': 'Design your layout in Excel and type these markers wherever you want the data. The ',
  'notas.inst.guia1b': ' button fills in your file ',
  'notas.inst.guia1diseno': 'keeping all your design',
  'notas.inst.guia1c': ' (borders, colors, logo, merged cells).',
  'notas.inst.guia2a': 'Student row:',
  'notas.inst.guia2b': ' in one row type ',
  'notas.inst.guia2c': ' in the first cell (flag) and in the others: ',
  'notas.inst.guia2d': '. That row is cloned per student. Avoid merged cells inside that row.',
  'notas.ayudaPlantilla': `GOAL
Create an Excel template (.xlsx) that the School Tracker app will fill in
automatically with the real data (header, indicator, criteria and students
with their qualitative grades), keeping ALL of your design.

VALID TOOLS
- Microsoft Excel or LibreOffice Calc: save as .xlsx.
- Google Sheets: File > Download > Microsoft Excel (.xlsx).

WHERE TO SAVE THE TEMPLATE
In the folder opened by the "Folder" button of this modal:
  Documents/SchoolTrackerPro/Templates/
The app detects it automatically and it shows up in the dropdown.

INSTRUMENT TYPES (based on the file name)
The file NAME of the .xlsx must contain the keyword for the type:
  ...Rubrica... / ...Rúbrica...  -> Rubric
  ...Cotejo...                   -> Checklist
  ...Escala...                   -> Rating scale
Valid examples: "Rubrica_MINED.xlsx", "My reading checklist.xlsx",
"Semester scale.xlsx". No keyword = treated as a rating scale.

AUTOMATIC SELECTION
Each indicator has a configured type (selector in this modal; only the types
that have a template in the folder are shown). When you press XLS, the app
automatically uses the template whose name matches that type. If you prefer
another one, pick it manually from the dropdown.

GOLDEN RULE
- Every marker must be COMPLETE inside a single cell.
- Always save as .xlsx (not .xls, not .ods).

STEP 1 — HEADER (free rows on top)
Design your header however you like (colors, logo, merged cells) and place
these markers wherever they belong:
  {COLEGIO}   {ANO}   {CORTE}   {ASIGNATURA}   {GRADO}   {SECCION}
  {IND_ORDEN}  -> indicator number
  {IND_TEXTO}  -> indicator text
  {CRITERIOS_LISTA} -> numbered list "1. description (points)" of all criteria

STEP 2 — REPEATABLE STUDENT ROW
Pick ONE row that will serve as the template for each student. In its FIRST
cell type exactly the flag: {{FILAS}}
In the other cells of that same row place these markers:
  {NUM}      -> running number (1, 2, 3...)
  {NOMBRE}   -> student name
  {SEXO}     -> M or F
  {LETRA_1}  -> qualitative grade of criterion 1 (AA, AS, AF, AI or empty)
  {LETRA_2}  -> criterion 2 ... {LETRA_N} depending on the number of criteria
  {VAL_IND}  -> qualitative assessment of the whole indicator

The app will CLONE that row once per student, keeping its formatting, and
push down everything below it.

IMPORTANT RULES
1. Do NOT use merged cells INSIDE the repeatable row (above it is fine).
2. Markers must not be split across several cells.
3. Only one {{FILAS}} block per sheet. You can have several sheets.
4. Leave some free rows between the header and the flag row if you need space.

LAYOUT EXAMPLE
  Row 1-4: title, {COLEGIO}, {GRADO}-{SECCION}, {CORTE}
  Row 5:   {IND_ORDEN}. {IND_TEXTO}
  Row 6:   Criteria: {CRITERIOS_LISTA}
  Row 8:   {{FILAS}} | {NUM} | {NOMBRE} | {LETRA_1} | {LETRA_2} | {VAL_IND}

RESULT
Save your template in the "SchoolTrackerPro/Templates" folder (the "Folder"
button of the modal). When you press XLS, the app fills in that template and
delivers an .xlsx identical to your design but with all the real data, ready
to print. It is saved in Documents/SchoolTrackerPro/Instruments.`,
  'notas.ayudaCopiada': '📋 Instructions copied to the clipboard',

  // ── EstudiantesPage ───────────────────────────────────────────────────────
  'est.fotoInvalida': 'Please select a valid image',
  'est.fotoError': 'Error processing the image',
  'est.import.error': '❌ Import error: {msg}',
  'est.import.errorFallback': 'Could not open the file',
  'est.plantilla.guardada': '✅ Template saved at {ruta}',
  'est.guardado.okEditado': '✅ Student updated successfully',
  'est.guardado.okCreado': '✅ Student registered successfully',
  'est.guardado.error': '❌ Error saving: {msg}',
  'est.eliminar': 'Delete',
  'est.del.seguro': 'Are you sure you want to delete this student?',
  'est.del.nombreFallback': 'this student',
  'est.del.seguroA': 'Are you sure you want to delete {nombre}?',
  'est.del.atencion': '\n\n⚠️ WARNING: This action will permanently delete:',
  'est.del.notas': '\n- {n} recorded grades',
  'est.del.asistencias': '\n- {n} attendance records',
  'est.del.noDeshacer': '\n\nThis action cannot be undone.',
  'est.del.titulo': 'Delete student',
  'est.del.okEstudiante': '✅ Student deleted successfully',
  'est.del.error': '❌ Error deleting: {msg}',
  'est.del.loteTitulo': 'Batch delete',
  'est.del.loteConfirmar':
    'Delete ALL the filtered students ({n})? This action cannot be undone.',
  'est.del.loteOk': '✅ {n} students deleted successfully',
  'est.del.loteError': '❌ Error deleting in batch: {msg}',
  'est.del.selTitulo': 'Delete selection',
  'est.del.selConfirmar':
    'Delete the {n} selected students? This action cannot be undone.',
  'notas.del.titulo': 'Delete Grades',
  'notas.del.noDeshacer': 'This action cannot be undone',
  'notas.del.todas': 'All displayed grades',
  'notas.del.todasDesc': 'Deletes all grades of the current term and subject',
  'notas.del.porEstudiante': 'By student',
  'notas.del.porEstudianteDesc': 'Deletes all grades of a specific student',
  'notas.del.selEstudiante': 'Select student...',
  'notas.del.porIndicador': 'By indicator',
  'notas.del.porIndicadorDesc': 'Deletes all grades of a specific indicator',
  'notas.del.selIndicador': 'Select indicator...',
  'notas.del.eliminando': 'Deleting...',
  'notas.tipo.cotejo': 'Checklist',
  'notas.tipo.escala': 'Rating scale',
  'notas.tipo.rubrica': 'Rubric',
  'notas.dist.errorPrevias': '❌ Could not load the grades from previous terms: {msg}',
  'notas.guardar.incompletas':
    "⚠️ There are incomplete grades (only 'A'). Please complete them (AA, AS, AF, AI) or delete them before saving.",
  'notas.guardar.maxPts':
    '⚠️ Student {nombre} has {pts} pts in Indicator {n} (maximum 20)',
  'notas.guardar.confirmar':
    'Save the grades?\n\nThe changes will be recorded in the local database.',
  'notas.guardar.titulo': '💾 Confirm save',
  'notas.guardar.okBorrados': '✅ Grades saved · {n} grade(s) deleted',
  'notas.guardar.okSimple': '✅ Grades saved locally',
  'notas.guardar.error': '❌ Error saving grades: {msg}',
  'notas.del.selUnEstudiante': '⚠️ Select a student',
  'notas.del.selUnIndicador': '⚠️ Select an indicator',
  'notas.del.confirmarTodas':
    'Are you sure you want to delete ALL the displayed grades for this term and subject? This action cannot be undone.',
  'notas.del.confirmarEstudiante':
    'Are you sure you want to delete all the grades of "{nombre}" for this term and subject?',
  'notas.del.confirmarIndicador':
    'Are you sure you want to delete all the grades of {indicador} for this term and subject?',
  'notas.del.indicadorSel': 'the selected indicator',
  'notas.del.confirmarTitulo': '🗑️ Confirm deletion',
  'notas.del.confirmarOk': 'Yes, delete',
  'notas.del.ok': '✅ Grades deleted',
  'notas.del.error': '❌ Error deleting grades: {msg}',
  'notas.inst.ok': '✅ Indicator {n}: {label}',
  'notas.inst.error': '❌ Error saving instrument: {msg}',
  'notas.alcanceSeccion': 'this section',
  'notas.activo.activarTitulo': '✔ Activate indicator',
  'notas.activo.desactivarTitulo': '👁 Deactivate indicator',
  'notas.activo.activarBtn': 'Activate',
  'notas.activo.desactivarBtn': 'Deactivate',
  'notas.activo.sumarMsg':
    'Add Indicator {n} to section {seccion}?\n\nOnly this section changes; the others are left untouched.',
  'notas.activo.noSumarMsg':
    'Stop counting Indicator {n} in section {seccion}?\n\nIts grades stop counting toward this section total, but nothing is deleted.',
  'notas.activo.exito': '✅ Indicator {n} {estado} in section {seccion}',
  'notas.activo.exitoSuma': 'counts',
  'notas.activo.exitoNoSuma': 'does not count',
  'notas.reestablecer.msg':
    'The section will go back to the default global indicators.\n\nIts exceptions are removed ({n} active row(s) remain in the local database for this section).\nIndicators, their grades and criteria are NOT deleted.',
  'notas.reestablecer.titulo': '↩ Reset to global values',
  'notas.reestablecer.btn': 'Reset',
  'notas.reestablecer.exito': '↩ {n} exception(s) removed. The section uses the global values.',
  'notas.intercambio.excesoPts':
    '❌ Indicator {n} adds up to {pts} pts and the per-indicator maximum is {max}.\nFix its points in Evaluations before activating it.',
  'notas.intercambio.msg':
    'Swap indicators:\n\n✔ Activate: Indicator {ordenNuevo} "{descNuevo}" ({puntosNuevo})\n👁 Deactivate: Indicator {ordenSaliente} "{descSaliente}"{conserva}\n\nThe {max} active ones will still add up to {total}.\nThe deactivated indicator is NOT deleted: it keeps its grades and criteria,\nit just stops counting toward the total. You can activate it again anytime.',
  'notas.intercambio.cualitativo': 'qualitative',
  'notas.intercambio.conserva': ' (keeps its {n} grade(s))',
  'notas.intercambio.titulo': '🔄 Swap indicators',
  'notas.intercambio.btn': 'Apply swap',
  'notas.intercambio.exito': '🔄 In this section: {nuevo} counts · {saliente} does not count (keeps its grades)',
  'notas.intercambio.error': '❌ Error swapping: {msg}',
  'notas.vaciar.previo': '⚠️ Select a term and a subject before clearing',
  'notas.vaciar.msg':
    'The grades of the {criterios} criterion/criteria of Indicator {orden} "{descripcion}" will be deleted.\n\n· Only in "{corte}" ({asignatura}).\n· {estudiantes} student(s) in this view will be left with empty cells.\n· Other evaluation terms are NOT modified.\n\nThe indicator and its criteria are kept; only the grades are cleared.\nThis action cannot be undone.',
  'notas.vaciar.titulo': '🧹 Clear indicator grades',
  'notas.vaciar.btn': 'Yes, clear this term',
  'notas.vaciar.exito': '🧹 Indicator {orden}: {n} grade(s) cleared in {corte}',
  'notas.vaciar.error': '❌ Error clearing: {msg}',
  'notas.criterio.msg':
    'Criterion {c} of Indicator {i} will be deleted.\n\n· {notas} grade(s) will be deleted from EVERY evaluation term.\n· In this view it affects {estudiantes} student(s).\n\nThis action cannot be undone.',
  'notas.criterio.titulo': '🗑 Delete criterion',
  'notas.criterio.btn': 'Yes, delete',
  'notas.criterio.exito': '🗑 Criterion {n} deleted',
  'notas.criterio.error': '❌ Error deleting: {msg}',
  'notas.masiva.vacias': 'ℹ️ No empty cells in C{n}',
  'notas.masiva.msg':
    'Apply {letra} to Criterion {c} of Indicator {i} for {n} student(s){alcance}.\n\nRemember you still have to press Save to write it to the database.',
  'notas.masiva.soloVacias': ' (empty cells only)',
  'notas.masiva.sobrescribe': ' (overwrites)',
  'notas.masiva.titulo': '✍ Bulk grade {letra}',
  'notas.masiva.btn': 'Apply {letra}',
  'notas.masiva.exito': '✍ {letra} applied to {n} student(s) in C{c}',

  // ── Settings ─────────────────────────────────────────────────────────────
  'ajustes.titulo': 'Settings',
  'ajustes.tab.configuracion': 'General',
  'ajustes.tab.notificaciones': 'Attendance notif.',
  'ajustes.tab.debug': 'Debug',
  'ajustes.tab.info': 'About',
  'ajustes.tab.temaClaro': 'Light theme',
  'ajustes.tab.temaOscuro': 'Dark theme',
  'ajustes.tab.temaSistema': 'Follow system',
  'ajustes.config.titulo': 'Settings',
  'ajustes.config.personalizacion': 'Grade table customization',
  'ajustes.config.colorResaltado': 'Highlight color',
  'ajustes.config.colorResaltadoDesc': 'Color used to highlight the student in the grades table.',
  'ajustes.config.colorResaltadoLargo':
    'This color highlights the student and their row while you are editing grades.',
  'ajustes.config.vistaPrevia': 'Preview',
  'ajustes.config.vistaPreviaEjemplo': '← Example',
  'ajustes.config.vistaPreviaEjemploLargo': '← Highlighted student example',
  'ajustes.config.error': 'Error updating the settings: {msg}',
  'ajustes.notif.titulo': 'System notifications',
  'ajustes.notif.desc':
    'Lets the app show attendance reminders and sync notices. If the prompt on first launch did not appear, or you denied it, enable it here.',
  'ajustes.notif.activar': 'Enable notifications',
  'ajustes.notif.aviso':
    'If you did not see the prompt, enable it in Settings → Apps → School Tracker → Notifications',
  'ajustes.notif.error': 'Error requesting permission: {msg}',

  // ── Login browser ────────────────────────────────────────────────────────
  'nav.titulo': 'Browser for Google sign-in',
  'nav.desc':
    'Only affects Google sign-in (Welcome and Cloud). If your default browser is still Edge, pick yours here and it will open that one.',
  'nav.compacto': 'Browser: {nombre}',
  'nav.default': 'System default',
  'nav.firefox': 'Firefox',
  'nav.chrome': 'Google Chrome',
  'nav.edge': 'Microsoft Edge',
  'nav.brave': 'Brave',
  'nav.seAbrira': 'It will open: {ruta}',
  'nav.noEncontrado': 'That browser was not found installed; the system default will be used.',
  'nav.usaraSistema': 'The browser configured in your system will be used.',
  'nav.notaWindows':
    'To change the system default: Windows 11 → Settings → Apps → Default apps. Note: {http} and {https} are separate associations, and as long as {https} still points to Edge the sign-in opens in Edge, even if you set a different default browser.',
};
