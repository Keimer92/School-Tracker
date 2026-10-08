/**
 * Diccionario en español. Es la FUENTE DE VERDAD: la clave se define acá.
 *
 * `en.ts` está tipado como `Record<Clave, string>`, así que TypeScript falla el
 * build si el inglés se queda sin una traducción. Esa es toda la garantía que
 * hace falta para que las claves no se desincronicen: no hay script que revisar,
 * el compilador avisa.
 *
 * Convenciones:
 * - Las claves van por área: `welcome.*`, `ajustes.*`, `comun.*`.
 * - Los parámetros van entre llaves: `'{n} filas'`. Se rellenan con `t(k, {n})`.
 * - Los `{...}` literales que el usuario puede escribir (nombres de grado,
 *   sección, asignatura) NO se traducen: son datos suyos.
 */
export const es = {
  // ── Común ────────────────────────────────────────────────────────────────
  'comun.volver': 'Volver',
  'comun.cancelar': 'Cancelar',
  'comun.cerrar': 'Cerrar',
  'comun.continuar': 'Continuar',
  'comun.siguiente': 'Siguiente',
  'comun.anterior': 'Anterior',
  'comun.si': 'Sí',
  'comun.no': 'No',
  'comun.activo': 'Activo',
  'comun.buscando': 'Buscando…',
  'comun.cargando': 'Cargando…',
  'comun.guardando': 'Guardando…',
  'comun.guardar': 'Guardar',
  'comun.confirmar': 'Confirmar',

  // ── Selector de idioma ───────────────────────────────────────────────────
  'idioma.titulo': 'Idioma',
  'idioma.descripcion': 'Idioma de la aplicación.',
  'idioma.es': 'Español',
  'idioma.en': 'English',

  // ── WelcomePage ──────────────────────────────────────────────────────────
  'welcome.appTitle': 'School Tracker',
  'welcome.subtitle': 'Selecciona cómo quieres iniciar',
  'welcome.cardGoogle.title': 'Continuar con Google',
  'welcome.cardGoogle.desc':
    'Entra con tu cuenta y recupera el último respaldo guardado en Google Drive.',
  'welcome.cardGoogle.tag1': 'Google Drive',
  'welcome.cardGoogle.tag2': 'Sin código',
  'welcome.cardWizard.title': 'Empezar de cero',
  'welcome.cardWizard.desc':
    'Crea una base de datos limpia y marca con toggles los grados y secciones que vas a usar.',
  'welcome.cardWizard.tag1': 'Catálogo precargado',
  'welcome.cardWizard.tag2': 'Sin nube',
  'welcome.google.nueva': 'Buscando tu último respaldo en Google Drive…',
  'welcome.google.entrando': 'Ingresando a la nube…',
  'welcome.google.verificando': 'Verificando identidad…',
  'welcome.google.navegador': 'Se abrió tu navegador: inicia sesión con Google allí…',
  'welcome.drive.buscando': 'Buscando respaldos en Drive…',
  'welcome.drive.descargando': 'Descargando respaldo…',
  'welcome.drive.restaurando': 'Restaurando respaldo…',
  'welcome.drive.restaurado': 'Respaldo restaurado',
  'welcome.drive.vacio': 'No hay respaldos en Google Drive',
  'welcome.drive.sinRespaldo':
    'Esta cuenta no tiene respaldos en Drive. Intentando recuperar tus datos desde la nube…',
  'welcome.drive.todosVacios': 'Se descargaron los respaldos de Drive pero todos vinieron con la base vacía.',
  'welcome.drive.error': 'No se pudo restaurar desde Drive: {msg}',
  'welcome.drive.nuevaCuenta':
    'Esta cuenta de Google es nueva: no tiene respaldos en Drive ni datos en la nube. Vamos a configurar tu base de datos desde cero.',
  'welcome.drive.antiguoTitulo': 'Restaurar respaldo antiguo',
  'welcome.drive.antiguoAviso':
    'El respaldo de Drive es del {fecha}, más antiguo que la última sincronización con la nube ({fechaNube}).\n\nSi lo restauras, podrías perder asistencias o notas modificadas en el escritorio después de esa fecha.',
  'welcome.drive.antiguoSi': 'Sí, restaurar de todos modos',
  'welcome.drive.antiguoNo': 'Cancelar',
  'welcome.drive.cancelado': 'Restauración cancelada.',
  'welcome.drive.descartados': 'Descartados: {lista}',
  'welcome.nube.sincronizando': 'Sincronizando respaldo con la nube…',
  'welcome.nube.sinNube':
    'Tu cuenta no tiene acceso a la nube de este desarrollador. Seguimos con tu Google Drive.',
  'welcome.nube.error': 'No se pudo conectar con la nube: {msg}',
  'welcome.nube.reintentando': 'Reintentando la descarga…',
  'welcome.nube.vaciaRespuesta':
    'Tu nube respondió correctamente pero está vacía: no hay datos guardados para esta cuenta. Vamos a configurar tu base de datos desde cero.',
  'welcome.nube.quotaTitulo': '☁️⚠️ Límite diario de Cloudflare alcanzado',
  'welcome.nube.quotaBody':
    'El plan gratuito de Cloudflare Workers tiene un tope diario de ~100.000 solicitudes. Si alcanzaste el límite, la cuota se reinicia a las 00:00 UTC (aprox. {reinicio}). Puedes esperar y reintentar, o configurar manualmente y sincronizar mañana cuando la cuota se haya reiniciado.',
  'welcome.nube.sinDatosTitulo': '☁️ Nube sin datos para esta cuenta',
  'welcome.nube.sinDatosBody':
    'El servidor respondió correctamente pero no hay datos sincronizados para tu cuenta de Google en la nube.\n\nEsto puede pasar si es la primera vez que conectas esta cuenta, o si los datos fueron eliminados de la nube previamente.\n\nPuedes reintentar la descarga, restaurar desde Google Drive si tienes un respaldo, o crear una base de datos local desde cero.',
  'welcome.nube.incompletosTitulo': '☁️ Datos incompletos en la nube',
  'welcome.nube.incompletosBody':
    'Se descargaron algunos datos pero la información está incompleta (faltan tablas base como año lectivo o colegios). Esto suele pasar cuando la cuota de Cloudflare se agotó a mitad de la descarga.\n\nPuedes reintentar para completar los datos faltantes, o crear la base local desde cero.',
  'welcome.nube.noConectadoTitulo': 'No se pudo conectar con la nube',
  'welcome.nube.noConectadoBody':
    'Revisa tu conexión a internet e inténtalo de nuevo en unos minutos.',
  'welcome.nube.noConfigTitulo': 'Conexión no configurada',
  'welcome.nube.noConfigBody':
    'La conexión con la nube no está configurada. Configúrala manualmente o importa un archivo de conexión (.key).',
  'welcome.nube.errorServidorTitulo': 'Error del servidor',
  'welcome.nube.errorServidorBody':
    'El servidor de sincronización devolvió un error. Puede ser un problema temporal: inténtalo de nuevo o configura la nube manualmente.',
  'welcome.nube.errorTitulo': 'No se pudo conectar con la nube',
  'welcome.nube.errorBody':
    'Ocurrió un error al hablar con el servidor. Inténtalo de nuevo o configura manualmente.',
  'welcome.inicializandoParcial': 'Inicializando la app con datos parciales…',
  'welcome.errorGenerico': 'Error: {msg}',
  'welcome.wizard.preparando': 'Preparando la configuración inicial…',
  'welcome.wizard.volver': '← Volver a las opciones',
  'welcome.wizard.sinDatos':
    'No encontramos datos previos. Vamos a configurar tu base de datos desde cero.',
  'welcome.wizard.stepAnios': 'Años Lectivos',
  'welcome.wizard.stepAsignaturas': 'Asignaturas',
  'welcome.wizard.stepGrados': 'Grados',
  'welcome.wizard.stepSecciones': 'Secciones',
  'welcome.wizard.stepColegios': 'Colegios',
  'welcome.wizard.stepResumen': 'Resumen',
  'welcome.wizard.minimoElementos': 'Debes agregar al menos un elemento en cada categoría.',
  'welcome.wizard.errorGuardando': 'Error guardando datos: {msg}',
  'welcome.wizard.volverBoton': '← Volver',
  'welcome.wizard.agregar': 'Agregar',
  'welcome.wizard.siguiente': 'Siguiente →',
  'welcome.wizard.anterior': '← Anterior',
  'welcome.wizard.verDetalle': 'Ver detalle técnico',
  'welcome.wizard.tipo': 'Tipo de colegio',
  'welcome.wizard.primaria': 'Primaria',
  'welcome.wizard.secundaria': 'Secundaria',
  'welcome.wizard.tipoAplicara1': 'Tipo que se aplicará:',
  'welcome.wizard.tipoAplicara2': '(detectado por los grados marcados).',
  'welcome.wizard.hintGrados':
    'Marca los grados que vas a usar. El tipo del colegio se deduce solo: con un grado de 7mo en adelante será Secundaria.',
  'welcome.wizard.hintSecciones':
    'Marca las secciones que vas a usar. Se comparten entre todos los grados.',
  'welcome.wizard.hintAsignaturas':
    'Marca las asignaturas que vas a usar. Las cuantitativas se anotan con número y las cualitativas con etiqueta (AA/AS/AF/AI).',
  'welcome.wizard.grupoCuantitativas': '📊 Cuantitativas',
  'welcome.wizard.grupoCualitativas': '🏷️ Cualitativas',
  'welcome.wizard.sinColegios': 'Aún no has agregado colegios. Escribe uno arriba y pulsa "Agregar".',
  'welcome.wizard.sinItems': 'Aún no has agregado {item}. Escribe uno arriba y pulsa "Agregar".',
  'welcome.wizard.diasClases': 'Días de clases',
  'welcome.wizard.asignaturasImparte': 'Asignaturas que imparte',
  'welcome.wizard.seleccionaTodos': 'Todos',
  'welcome.wizard.seccionTitle': 'Sección {s}',
  'welcome.wizard.phColegio': 'Ej: Colegio Central',
  'welcome.wizard.phAsignatura': 'Ej: Historia (si no está en la lista)',

  // ── AsistenciaPage ──────────────────────────────────────────────────────
  'asis.estado.presente': 'Presente',
  'asis.estado.ausente': 'Ausente',
  'asis.estado.justificado': 'Justificado',
  'asis.estado.sinMarcar': 'Sin marcar',
  'asis.stats.total': 'Total',
  'asis.stats.presentes': 'Presentes',
  'asis.stats.ausentes': 'Ausentes',
  'asis.stats.justificados': 'Justificados',
  'asis.stats.asistencia': 'Asistencia',
  'asis.col.estudiante': 'Estudiante',
  'asis.col.asistencia': 'Asistencia',
  'asis.col.observacion': 'Observación',
  'asis.col.porcentajeMes': '% Mes',
  'asis.estudiantes': 'Estudiantes',
  'asis.cargando': 'Cargando estudiantes…',
  'asis.limpiarBusqueda': 'Limpiar búsqueda',
  'asis.noClasesHoy': 'No hubo clases este día',
  'asis.diaNoLaborable': '📅 Día no laborable',
  'asis.diaNoLaborableDesc':
    'El colegio seleccionado no tiene habilitada la toma de asistencia para los días',
  'asis.sinDiasHabiles.titulo': '📅 Sin días hábiles',
  'asis.sinDiasHabiles.desc':
    'No hay días hábiles configurados para el período seleccionado.',
  'asis.vacio.titulo': 'No se encontraron resultados',
  'asis.vacio.tituloAlt': 'No hay estudiantes para mostrar',
  'asis.vacio.desc': 'No se encontraron estudiantes para los filtros seleccionados.',
  'asis.vacio.busqueda': 'No se encontró ningún estudiante que coincida con "{q}"',
  'asis.filtros.todas': 'Todas',
  'asis.filtros.ninguna': 'Ninguna',
  'asis.filtros.total': 'Total:',
  'asis.filtros.masculino': 'Masculino',
  'asis.filtros.femenino': 'Femenino',
  'asis.periodo.etiqueta': 'Período:',
  'asis.periodo.diario': 'Diario',
  'asis.periodo.semanal': 'Semanal',
  'asis.periodo.mensual': 'Mensual',
  'asis.periodo.semanaDe': 'Semana de:',
  'asis.periodo.mes': 'Mes:',
  'asis.guardado.escribiendo': 'Escribiendo en la BD',
  'asis.guardado.sinGuardar': 'Cambios sin guardar',
  'asis.guardado.limpio': 'Sin cambios',
  'asis.btn.guardar': 'Guardar asistencia',
  'asis.btn.listo': '✓ Listo',
  'asis.btn.limpiar': 'Limpiar',
  'asis.masivo.titulo': '¿Qué días marcar?',
  'asis.masivo.presentes': 'Marcar presentes',
  'asis.masivo.ausentes': 'Marcar ausentes',
  'asis.masivo.justificados': 'Marcar justificados',
  'asis.masivo.sinMarcadas': '⚠️ No hay asistencias marcadas en esos días',
  'asis.masivo.todos': 'Marcar a todos los estudiantes del día',
  'asis.masivo.todosDesc':
    'Rellenar solo las asistencias vacías de los días que elijas, y guardarlas',
  'asis.masivo.completo': 'Todo completo',
  'asis.masivo.marcarTodos': 'Marcar todos',
  'asis.masivo.guardando': '⏳ Guardando',
  'asis.masivo.marcarGuardar': 'Marcar y guardar',
  'asis.masivo.al': 'al',
  'asis.masivo.fechas': 'Fechas',
  'asis.masivo.estudiantes': 'Estudiantes',
  'asis.masivo.confirmarMsg':
    '¿Marcar {n} asistencia(s) como "{estado}" ({codigo})?\n\nFechas: {rango} ({dias})\nEstudiantes: {estudiantes}\n\nSolo se rellenan las que están vacías; las que ya tienen estado no se tocan.',
  'asis.masivo.marcarTitulo': 'Marcar {estado} masivamente',
  'asis.masivo.exito': '✅ {n} asistencia(s) guardadas ({estado})',
  'asis.masivo.siMarcar': 'Sí, marcar y guardar',
  'asis.limpiar.titulo': '¿Qué días limpiar?',
  'asis.limpiar.btn': 'Limpiar asistencias',
  'asis.limpiar.diario': 'Limpiar la asistencia del día',
  'asis.limpiar.diarioDesc': 'Vaciar las asistencias marcadas de los días que elijas',
  'asis.limpiar.mensual': 'Nada que borrar',
  'asis.limpiar.mensualDesc':
    'Vaciar las celdas marcadas de los días elegidos y borrarlas de la base',
  'asis.limpiar.rellenarDesc': 'Rellenar las vacías de los días elegidos y guardar en la base',
  'asis.limpiar.limpiarGuardar': 'Limpiar y guardar',
  'asis.limpiar.confirmar': 'Sí, limpiar',
  'asis.limpiar.confirmarTitulo': 'Confirmar Limpieza',
  'asis.limpiar.pedirGuardar': '¿Limpiar todos los estados de asistencia del período actual?\n\nLos cambios sin guardar se descartarán.',
  'asis.limpiar.alcanceSeccion': 'esta sección',
  'asis.limpiar.alcanceGrado': 'este grado',
  'asis.limpiar.alcanceColegio': 'este colegio',
  'asis.limpiar.vacias': '⚠️ No hay asistencias marcadas en esos días',
  'asis.limpiar.confirmarMsg':
    '¿Vaciar {n} asistencia(s) marcadas?\n\nFechas: {rango} ({dias})\nEstudiantes: {estudiantes}\n\n{aviso}Solo se limpian los días elegidos; el resto del período no se toca.',
  'asis.limpiar.avisoServidor':
    '⚠️ Se borran {n} registro(s) de la base, y con ellos la observación de esos días.\n\n',
  'asis.limpiar.exito': '✅ {n} asistencia(s) limpiadas',
  'asis.limpiar.aviso': '🧹 Asistencia limpiada. Recuerda guardar los cambios.',
  'asis.sinClases.btn': 'Sin clases',
  'asis.sinClases.chip': 'Sin Clases',
  'asis.sinClases.pasto': 'Marcar sin clases',
  'asis.sinClases.confirmar': 'Sí, marcar',
  'asis.sinClases.todosColegios': 'Marcar en todos los colegios',
  'asis.sinClases.todosColegiosConfirmar': 'Sí, marcar todos',
  'asis.sinClases.reactivarTodos': 'Reactivar en todos los colegios',
  'asis.sinClases.reactivar': 'Reactivar clases',
  'asis.sinClases.motivo': 'Motivo del día(s) sin clases',
  'asis.sinClases.todoPeriodo': 'Todo el período',
  'asis.sinClases.elegirSemana': 'Elegir semana',
  'asis.sinClases.descSemana': 'Dejar una semana del mes sin clases',
  'asis.sinClases.descPeriodo': 'Marcar el período actual sin clases',
  'asis.sinClases.tituloSemana': 'Semana sin clases',
  'asis.sinClases.alcanceTodo': 'todo el colegio',
  'asis.sinClases.alcanceColegio': 'este colegio',
  'asis.sinClases.alcanceSoloSeccion': 'solo esta sección',
  'asis.sinClases.eseDia': 'ese día',
  'asis.sinClases.periodoActual': 'el período actual',
  'asis.sinClases.todoColegio': 'TODO el colegio',
  'asis.sinClases.marcado': 'Día marcado sin clases',
  'asis.sinClases.badgeTodo': '🏫 Todo el colegio',
  'asis.sinClases.badgeSeccion': '🚪 Esta sección',
  'asis.sinClases.clickMarcar': 'Click para marcar este día sin clases',
  'asis.sinClases.clickReactivar': '— Click para reactivar clases',
  'asis.sinClases.motivoVacio': 'Sin clases',
  'asis.sinClases.etiquetaSemana': 'la semana {n}',
  'asis.sinClases.motivoObligatorio': '⚠️ El motivo es obligatorio',
  'asis.sinClases.seleccioneSemana': '⚠️ Seleccione la semana que quedará sin clases',
  'asis.sinClases.alcance': 'Alcance',
  'asis.sinClases.afecta': 'Afecta',
  'asis.sinClases.confirmarMsg':
    '¿Marcar {rango} como día(s) sin clases?\n\nAlcance: {alcance}\nAfecta: {afecta}\nMotivo: {motivo}',
  'asis.sinClases.nivelColegio': 'Colegio',
  'asis.sinClases.nivelSeccion': 'Sección',
  'asis.sinClases.exito': '🚫 {nivel}: {n} día(s) sin clases ({motivo})',
  'asis.sinClases.exitoTodos': '🚫 {n} día(s) sin clases en todos los colegios ({motivo})',
  'asis.sinClases.reactivarExito': 'Clases reactivadas: {n} día(s)',
  'asis.sinClases.sinColegios': '⚠️ No hay colegios registrados',
  'asis.sinClases.todosTitulo': 'TODOS los colegios',
  'asis.sinClases.todosConfirmarMsg':
    '¿Marcar {rango} sin clases en los {n} colegio(s)?\n\nAlcance: {alcance}\nAfecta: {afecta}\nMotivo: {motivo}',
  'asis.sinClases.todosExito': '🌐 {dias} día(s) sin clases en {n} colegio(s) ({motivo})',
  'asis.sinClases.reactivarTodosMsg':
    '¿Reactivar las clases del {rango} en los {n} colegio(s)?\n\nSe quitará la marca en todos los colegios.',
  'asis.sinClases.reactivarSi': 'Sí, reactivar',
  'asis.sinClases.reactivarTodosExito': '✅ Clases reactivadas en todos los colegios',
  'asis.sinClases.errorMarcarTodos': '❌ Error al marcar en todos los colegios: {msg}',
  'asis.sinClases.errorReactivarTodos': '❌ Error al reactivar en todos los colegios: {msg}',
  'asis.sinClases.reactivarUnicoMsg': '¿Reactivar las clases del {rango}?',
  'asis.sinClases.reactivarUnicoAlcance': 'Alcance: {alcance}',
  'asis.sinClases.reactivarOk': '✅ Clases reactivadas: {n} día(s)',
  'asis.filtro.sexo': 'Sexo:',
  'asis.filtro.todos': 'Todos',
  'asis.sinClases.marcarFecha': 'Marcar {fecha} sin clases',
  'asis.sinClases.semanaN': 'Semana {n}',
  'asis.sinClases.secciones': 'Secciones',
  'asis.sinClases.colegios': 'Colegios',
  'asis.sinClases.phMotivo': 'Ej: Feriado nacional (obligatorio)',
  'asis.sinClases.reactivarSemana': '♻️ Reactivar las clases de la semana {n}',
  'asis.sinClases.marcarSeccion': '🚪 Marcar solo esta sección',
  'asis.sinClases.marcarColegio': '🏫 Marcar todo este colegio',
  'asis.sinClases.marcarTodos': '🌐 Marcar en TODOS los colegios',
  'asis.sinClases.tituloSeccion': 'Solo afecta a {seccion} de {grado}',
  'asis.sinClases.tituloColegio': 'Afecta a todas las secciones de {colegio}',
  'asis.sinClases.tituloTodos':
    'Afecta a los {n} colegio(s) del catálogo, en la semana o el período visible',
  'asis.limpiar.marcadas': '{n} marcadas',
  'asis.limpiar.conEstado': '{n} con estado',
  'asis.btn.rellenar': 'Rellenar',
  'asis.rellenar.sinMarcar': '{n} sin marcar',
  'asis.rellenar.estudiantes': '{n} estudiante(s)',
  'asis.ausencia.soloEstaFecha': 'Solo afecta esa fecha específica',
  'asis.ausencia.hintSemana':
    'Pasa el cursor sobre una semana para verla resaltada en la tabla',
  'asis.confirmar.guardar': '¿Guardar los cambios de asistencia pendientes?',
  'asis.confirmar.guardarTitulo': 'Confirmar guardado',
  'asis.confirmar.sinGuardar':
    'Tienes cambios sin guardar. ¿Deseas guardarlos antes de continuar?',
  'asis.confirmar.sinGuardarTitulo': 'Cambios sin guardar',
  'asis.confirmar.descartar': 'Descartar',
  'asis.error.guardar': '❌ Error al guardar: {msg}',
  'asis.error.limpiar': '❌ Error al limpiar: {msg}',
  'asis.error.masivo': 'Error marcando asistencias masivamente: {msg}',
  'asis.error.limpiarMasivo': 'Error limpiando asistencias: {msg}',
  'asis.error.diasSinClases': 'Error marcando días sin clases: {msg}',
  'asis.error.diasSinClasesTodos':
    'Error marcando días sin clases en todos los colegios: {msg}',
  'asis.error.reactivarTodos':
    'Error reactivando días sin clases en todos los colegios: {msg}',
  'asis.error.reactivar': 'Error reactivando clases: {msg}',
  'asis.error.cargarDias': 'Error cargando días sin clases: {msg}',

  // ── NotasPage ──────────────────────────────────────────────────────────
  'notas.filtro.corte': 'Corte:',
  'notas.filtro.asignatura': 'Asignatura:',
  'notas.filtro.corteActual': 'Corte actual',
  'notas.filtro.colegio': 'Colegio:',
  'notas.filtro.grado': 'Grado:',
  'notas.filtro.seccion': 'Sección:',
  'notas.filtro.sexo': 'Sexo:',
  'notas.filtro.todos': 'Todos',
  'notas.filtro.masculino': 'Masculino',
  'notas.filtro.femenino': 'Femenino',
  'notas.acciones': 'Acciones',
  'notas.activos': '{n} activos · {m} notas',
  'notas.btn.deshacer': 'Deshacer',
  'notas.btn.rehacer': 'Rehacer',
  'notas.btn.guardarCorto': 'Guardar',
  'notas.btn.guardando': 'Guardando',
  'notas.historial': '{n} en historial',
  'notas.porRehacer': '{n} por rehacer',
  'notas.cambiosPendientes': '{n} cambios',
  'notas.corte': 'Corte',
  'notas.filtro.masc': 'Masc',
  'notas.filtro.fem': 'Fem',
  'notas.chip.colegio': 'Colegio',
  'notas.chip.grado': 'Grado',
  'notas.chip.seccion': 'Sección',
  'notas.chip.asignatura': 'Asignatura',
  'notas.cargando': 'Cargando datos...',
  'notas.noSuma': '· no suma',
  'notas.noSumaCorto': 'no suma',
  'notas.noSumaTotal': '· no suma al total',
  'notas.estudiantes': 'Estudiantes',
  'notas.sumanSeccion': 'Suman en esta sección:',
  'notas.configPropia': '· 📌 config propia de la sección',
  'notas.col.estudiante': 'Estudiante',
  'notas.col.final': 'Final',
  'notas.col.notaFinal': 'Nota Final',
  'notas.vacio.titulo': 'No se encontraron resultados',
  'notas.vacio.tituloAlt': 'No hay estudiantes para mostrar',
  'notas.vacio.seleccioneFiltros': 'Seleccione los filtros',
  'notas.limpiarBusqueda': 'Limpiar búsqueda',
  'notas.btn.instrumentos': 'Instrumentos',
  'notas.btn.distribuir': 'Distribuir',
  'notas.btn.eliminarNotas': 'Eliminar notas',
  'notas.btn.acciones': 'Instrumentos, distribuir y eliminar notas',
  'notas.guardado.escribiendo': 'Escribiendo en la BD',
  'notas.guardado.sinGuardar': 'Cambios sin guardar',
  'notas.guardado.limpio': 'Sin cambios',
  'notas.btn.guardar': 'Guardar Notas (Ctrl+G)',
  'notas.deshacer': 'Deshacer (Ctrl+Z)',
  'notas.rehacer': 'Rehacer (Ctrl+Y)',
  'notas.rehacerNada': 'Nada que rehacer',
  'notas.sinDescripcion': 'Sin descripción',
  'notas.sinDescripcionPar': '(Sin descripción)',
  'notas.sinNotas': 'Sin notas cargadas',
  'notas.sinNotasCorto': 'sin notas',
  'notas.errorGenerico': '❌ Error: {msg}',
  'notas.buscar.placeholder': 'Buscar estudiante o nota...',
  'notas.filtro.anoLectivo': 'Año Lectivo:',
  'notas.movil.indice': '{i} de {n} — toca para ver la lista',
  'notas.escala0a100': 'Escala 0-100',
  'notas.indicador': 'Indicador {n}',
  'notas.indicadorInactivo': 'INACTIVO: sus notas no suman al total de 100 pts',
  'notas.criterioClic': ' — clic para ver opciones del criterio',
  'notas.maxCriterio': 'máx {n}',
  'notas.estudiantesConteo': '{n} estudiantes',
  'notas.criteriosCount': '{n} criterio(s)',
  'notas.sumanTitulo':
    'Indicadores que suman en esta sección. Se cambia con el ⚙ de cada indicador.',
  'notas.configPropiaTitulo':
    'Esta sección tiene indicadores distintos a los globales. Usa ⚙ → Restablecer para volver a los valores por defecto.',
  'notas.noSumanTitulo':
    'Los indicadores inactivos también se muestran y se pueden calificar, pero sus notas NO suman al total de 100 pts ni los toca el modal de distribución.',
  'notas.noSumanCount': '· {n} no suman',
  'notas.maxRealTitulo':
    'Con {n} indicadores el máximo real es {pts} pts. La columna Final se muestra en escala 0-100.',
  'notas.maxReal': '· máx real {pts} pts',
  'notas.col.finalTitulo':
    'Escala 0-100 (igual que el modal de distribución). Pasa el cursor sobre la nota para ver los puntos crudos.',
  'notas.vacio.sinResultados': 'No se encontró ningún estudiante que coincida con "{q}"',
  'notas.vacio.sinEstudiantes':
    'No hay estudiantes registrados para {grado} - {seccion}. Por favor, registre estudiantes en la sección de Estudiantes.',
  'notas.vacio.seleccioneDesc':
    'Seleccione un año, corte, colegio, asignatura, grado y sección para ver y calificar a los estudiantes.',
  'notas.tooltip.sumaTotal': 'Suma al total: {a} de {b} pts',
  'notas.tooltip.inactivo': 'Indicador inactivo: {a} de {b} pts — NO suma al total',
  'notas.tooltip.total': '{a} de {b} pts',
  'notas.btn.instrumentosTitulo': 'Instrumentos de evaluación',
  'notas.btn.instrumentosSub': 'PDF y XLSX de los {a} de {b} activos',
  'notas.btn.distribuirSub': 'Reparto automático de {n} activos',
  'notas.del.previa': '⚠️ Seleccione un corte y asignatura primero',
  'notas.btn.eliminarNotasSub': 'Borra las {n} notas del filtro actual',
  'notas.popover.distribuirAuto': 'Distribuir notas automáticamente',
  'notas.popover.opciones': 'Opciones',
  'notas.elegir.lleno': 'Ya hay {n} indicadores activos',
  'notas.elegir.desc1': 'Para activar el Indicador {n}, elige cuál se desactiva.',
  'notas.elegir.desc2': 'No se borra nada:',
  'notas.elegir.desc3': 'el que salga conserva sus notas.',
  'notas.elegir.swapTitle': 'Desactivar el Indicador {a} y activar el {b}',
  'notas.elegir.cualitativo': 'cualitativo',
  'notas.elegir.conservaTitle': 'Conserva {n} nota(s)',
  'notas.elegir.conservaCount': '{n} nota(s)',
  'notas.elegir.vacio': 'vacío',
  'notas.popover.sumaAqui': 'suma aquí',
  'notas.popover.noSumaAqui': 'no suma aquí',
  'notas.popover.dejarSumar': 'Dejar de sumar aquí',
  'notas.popover.sumarSeccion': 'Sumar en esta sección',
  'notas.popover.ayuda1': 'Deja de sumar en esta sección, pero conserva sus notas.',
  'notas.popover.ayuda2': 'Ya hay {n} que suman aquí ({a}). Te pediré cuál dejar de sumar.',
  'notas.popover.ayuda3': 'Sumará sus notas en esta sección ({a} de {b}).',
  'notas.popover.restablecerTitulo':
    'Borrar las excepciones de esta sección y volver a los valores globales',
  'notas.popover.restablecer': 'Restablecer a valores globales',
  'notas.popover.vaciar': 'Vaciar notas del indicador',
  'notas.popover.vaciarAyuda':
    'Deja las {n} columnas vacías para volver a llenarlas, solo en {corte}. El indicador no se borra.',
  'notas.esteCorte': 'este corte',
  'notas.popover.criterioTitulo': 'Criterio {c} · Indicador {i}',
  'notas.popover.maxPts': ' · máx {n} pts',
  'notas.popover.aplicarTodos': 'Aplicar nota a todos',
  'notas.popover.soloVacias': 'Solo celdas vacías',
  'notas.popover.soloVaciasEstado': 'No sobrescribe lo escrito',
  'notas.popover.sobrescribeEstado': 'Sobrescribe todas',
  'notas.popover.eliminarCriterio': 'Eliminar este criterio',
  'notas.popover.eliminarAyuda':
    'Borra solo C{n} de este indicador y todas sus notas en todos los cortes.',
  'notas.dist.titulo': 'Distribuir notas automáticamente',
  'notas.dist.subCual':
    'C1, C2{c3} = nota objetivo{sinC3}. Solo AA, AS, AF disponibles.',
  'notas.dist.subCualC3': ' y C3',
  'notas.dist.subCualSinC3': ', C3 = AA',
  'notas.dist.subNum':
    'Ingrese el porcentaje total deseado (0-100). C1, C2{c3} se calculan automáticamente.',
  'notas.dist.consejo1': '💡 El desempeño nunca retrocede: siempre ',
  'notas.dist.consejo2':
    '. Cuando se puede, la letra más baja va al C1 y las más altas al C3, sin perder la nota pedida.',
  'notas.dist.chipTitle': '{titulo}: {label}',
  'notas.popover.sobrescribir': 'Sobrescribir notas existentes',
  'notas.dist.overwriteOn': 'Se reemplazarán todas las notas',
  'notas.dist.overwriteOff': 'Solo se llenarán criterios vacíos',
  'notas.popover.modificarC3': 'Modificar también el C3',
  'notas.dist.c3On': 'C1, C2 y C3 se distribuyen',
  'notas.dist.c3Off': 'C3 siempre será AA',
  'notas.popover.compararCortes': 'Comparar cortes previos',
  'notas.dist.cargandoAnt': '⏳ Cargando notas anteriores…',
  'notas.dist.colConNota1': '{n} columna con la nota final',
  'notas.dist.colConNotaN': '{n} columnas con la nota final',
  'notas.dist.notaFinalAnterior': 'Nota final de cada corte anterior',
  'notas.dist.corte': 'corte',
  'notas.dist.corteActual': 'corte actual',
  'notas.dist.corteDistribuyendo': 'Corte que se está distribuyendo: {nombre}',
  'notas.dist.metaCual': 'Nota final que quedará al aplicar la letra elegida',
  'notas.dist.metaNum': 'Total que resultará de aplicar el nuevo total',
  'notas.dist.nuevaNota': 'Nueva Nota',
  'notas.dist.resultante': '→ Resultante',
  'notas.dist.notaObjetivo': 'Nota objetivo',
  'notas.dist.nuevoTotal': 'Nuevo total',
  'notas.dist.corteTitulo': '{nombre}: {valor}',
  'notas.dist.sinNotas': 'sin notas',
  'notas.dist.notaFinalActual': 'Nota final actual ({nombre})',
  'notas.dist.aplicar': '✨ Aplicar',
  'notas.inst.titulo': '📋 Instrumentos de evaluación',
  'notas.inst.generando': '⏳ Generando…',
  'notas.inst.generarTodos': '📄 Generar todos',
  'notas.inst.ayudaExcel': '❓ Ayuda Excel',
  'notas.inst.plantillaTitulo': '📗 Plantilla:',
  'notas.inst.cargandoPlantillas': 'cargando…',
  'notas.inst.sinPlantillas':
    'Sin plantillas — abre la carpeta y copia tus .xlsx (nombre con Rubrica/Cotejo/Escala)',
  'notas.inst.auto': '(Auto — según el tipo del indicador)',
  'notas.inst.tipoRubrica': '🟣 Rúbrica',
  'notas.inst.tipoCotejo': '🟢 Cotejo',
  'notas.inst.tipoEscala': '🔵 Escala',
  'notas.inst.carpeta': '📂 Carpeta',
  'notas.inst.abrirCarpeta': 'Abrir carpeta de plantillas',
  'notas.inst.recargar': 'Recargar lista',
  'notas.inst.ayudaTitulo': '📗 Cómo crear tu plantilla en Excel',
  'notas.inst.copiarInstrucciones': '📋 Copiar instrucciones',
  'notas.inst.sinPlantillasTitulo': 'No hay plantillas en la carpeta Plantillas',
  'notas.inst.tituloPdf': 'Generar PDF de este instrumento',
  'notas.inst.tituloXls': 'Generar desde tu plantilla Excel (.xlsx) con marcadores',
  'notas.inst.sinIndicadores': 'No hay indicadores configurados',
  'notas.inst.pie':
    'El instrumento se guarda por indicador y se sincroniza entre dispositivos. Los PDF se generan con las notas actuales.',
  'notas.inst.guiaTitulo': '📗 Plantilla propia en Excel',
  'notas.inst.guia1a': 'Diseña tu formato en Excel y escribe estos marcadores donde quieras los datos. El botón ',
  'notas.inst.guia1b': ' rellena tu archivo ',
  'notas.inst.guia1diseno': 'conservando todo tu diseño',
  'notas.inst.guia1c': ' (bordes, colores, logo, celdas combinadas).',
  'notas.inst.guia2a': 'Fila de estudiantes:',
  'notas.inst.guia2b': ' en una fila escribe ',
  'notas.inst.guia2c': ' en la primera celda (bandera) y en las demás: ',
  'notas.inst.guia2d': '. Esa fila se clona por estudiante. Evita celdas combinadas dentro de esa fila.',
  'notas.ayudaPlantilla': `OBJETIVO
Crear una plantilla Excel (.xlsx) que la app School Tracker rellenará
automáticamente con los datos reales (encabezado, indicador, criterios y
estudiantes con sus notas cualitativas), conservando TODO tu diseño.

HERRAMIENTAS VÁLIDAS
- Microsoft Excel o LibreOffice Calc: guardar como .xlsx.
- Google Sheets: Archivo > Descargar > Microsoft Excel (.xlsx).

DÓNDE GUARDAR LA PLANTILLA
En la carpeta que abre el botón "Carpeta" de este modal:
  Documentos/SchoolTrackerPro/Plantillas/
La app la detecta sola y aparece en la lista desplegable.

TIPOS DE INSTRUMENTO (según el nombre del archivo)
El NOMBRE del archivo .xlsx debe contener la palabra clave del tipo:
  ...Rubrica... / ...Rúbrica...  -> Rúbrica
  ...Cotejo...                   -> Lista de cotejo
  ...Escala...                   -> Escala valorativa
Ejemplos válidos: "Rubrica_MINED.xlsx", "Mi cotejo de lectura.xlsx",
"Escala semestral.xlsx". Sin palabra clave = se trata como Escala.

SELECCIÓN AUTOMÁTICA
Cada indicador tiene un tipo configurado (selector en este modal; solo se
muestran los tipos que tienen plantilla en la carpeta). Al pulsar XLS, la app
usa automáticamente la plantilla cuyo nombre coincida con ese tipo. Si
prefieres otra, selecciónala manualmente en el desplegable.

REGLA DE ORO
- Todo marcador debe estar COMPLETO dentro de una sola celda.
- Guarda siempre como .xlsx (no .xls, no .ods).

PASO 1 — ENCABEZADO (filas libres arriba)
Diseña tu encabezado como quieras (colores, logo, celdas combinadas) y coloca
estos marcadores donde correspondan:
  {COLEGIO}   {ANO}   {CORTE}   {ASIGNATURA}   {GRADO}   {SECCION}
  {IND_ORDEN}  -> número del indicador
  {IND_TEXTO}  -> texto del indicador
  {CRITERIOS_LISTA} -> lista numerada "1. descripción (puntos)" de todos los criterios

PASO 2 — FILA REPETIBLE DE ESTUDIANTES
Elige UNA fila que servirá de plantilla para cada estudiante. En su PRIMERA
celda escribe exactamente la bandera: {{FILAS}}
En las demás celdas de esa misma fila coloca estos marcadores:
  {NUM}      -> número correlativo (1, 2, 3...)
  {NOMBRE}   -> nombre del estudiante
  {SEXO}     -> M o F
  {LETRA_1}  -> nota cualitativa del criterio 1 (AA, AS, AF, AI o vacía)
  {LETRA_2}  -> criterio 2 ... {LETRA_N} según cantidad de criterios
  {VAL_IND}  -> valoración cualitativa del indicador completo

La app CLONará esa fila una vez por estudiante, manteniendo su formato, y
correrá hacia abajo todo lo que esté debajo.

REGLAS IMPORTANTES
1. NO uses celdas combinadas DENTRO de la fila repetible (encima sí).
2. Los marcadores no deben dividirse entre varias celdas.
3. Un solo bloque {{FILAS}} por hoja. Puedes tener varias hojas.
4. Deja unas filas libres entre el encabezado y la fila bandera si necesitas espacio.

EJEMPLO DE MAQUETACIÓN
  Fila 1-4: título, {COLEGIO}, {GRADO}-{SECCION}, {CORTE}
  Fila 5:   {IND_ORDEN}. {IND_TEXTO}
  Fila 6:   Criterios: {CRITERIOS_LISTA}
  Fila 8:   {{FILAS}} | {NUM} | {NOMBRE} | {LETRA_1} | {LETRA_2} | {VAL_IND}

RESULTADO
Guarda tu plantilla en la carpeta "SchoolTrackerPro/Plantillas" (botón
"Carpeta" del modal). Al pulsar XLS, la app rellena esa plantilla y entrega
un .xlsx idéntico a tu diseño pero con todos los datos reales, listo para
imprimir. Se guarda en Documentos/SchoolTrackerPro/Instrumentos.`,
  'notas.ayudaCopiada': '📋 Instrucciones copiadas al portapapeles',

  // ── EstudiantesPage ───────────────────────────────────────────────────────
  'est.fotoInvalida': 'Por favor selecciona una imagen válida',
  'est.fotoError': 'Error al procesar la imagen',
  'est.import.error': '❌ Error de Importación: {msg}',
  'est.import.errorFallback': 'Fallo al abrir el archivo',
  'est.plantilla.guardada': '✅ Plantilla guardada en {ruta}',
  'est.guardado.okEditado': '✅ Estudiante actualizado correctamente',
  'est.guardado.okCreado': '✅ Estudiante registrado correctamente',
  'est.guardado.error': '❌ Error al guardar: {msg}',
  'est.eliminar': 'Eliminar',
  'est.del.seguro': '¿Está seguro de eliminar este estudiante?',
  'est.del.nombreFallback': 'este estudiante',
  'est.del.seguroA': '¿Está seguro de eliminar a {nombre}?',
  'est.del.atencion': '\n\n⚠️ ATENCIÓN: Esta acción eliminará permanentemente:',
  'est.del.notas': '\n- {n} Calificaciones registradas',
  'est.del.asistencias': '\n- {n} Registros de asistencia',
  'est.del.noDeshacer': '\n\nEsta acción no se puede deshacer.',
  'est.del.titulo': 'Eliminar estudiante',
  'est.del.okEstudiante': '✅ Estudiante eliminado correctamente',
  'est.del.error': '❌ Error al eliminar: {msg}',
  'est.del.loteTitulo': 'Eliminar en lote',
  'est.del.loteConfirmar':
    '¿Eliminar TODOS los estudiantes filtrados ({n})? Esta acción no se puede deshacer.',
  'est.del.loteOk': '✅ {n} estudiantes eliminados correctamente',
  'est.del.loteError': '❌ Error al eliminar en lote: {msg}',
  'est.del.selTitulo': 'Eliminar selección',
  'est.del.selConfirmar':
    '¿Eliminar los {n} estudiantes seleccionados? Esta acción no se puede deshacer.',

  // Filtros
  'est.filtros.titulo': '🔍 Filtros',
  'est.filtros.cerrar': 'Cerrar',
  'est.filtro.ano': 'Año lectivo:',
  'est.filtro.colegio': 'Colegio:',
  'est.filtro.grado': 'Grado:',
  'est.filtro.seccion': 'Sección:',
  'est.filtro.sexo': 'Sexo:',
  'est.filtro.aplicar': '✓ Aplicar',
  'est.todos': 'Todos',
  'est.masculino': 'Masculino',
  'est.femenino': 'Femenino',
  'est.activoCon': '✓ (Activo)',
  'est.activo': 'Activo',
  'est.buscarPh': 'Nombre o código...',
  'est.buscarPhAndroid': 'Buscar nombre o código...',
  'est.fallback.colegio': 'Colegio',
  'est.fallback.grado': 'Grado',
  'est.fallback.seccion': 'Sección',

  // Botones / sub / títulos
  'est.btn.nuevo': 'Nuevo',
  'est.btn.importar': 'Importar Excel',
  'est.btn.importarCorto': 'Importar',
  'est.btn.importando': 'Importando',
  'est.btn.plantilla': 'Plantilla',
  'est.btn.exportar': 'Exportar',
  'est.btn.exportando': 'Exportando',
  'est.btn.ayuda': 'Ayuda',
  'est.btn.seleccionar': 'Seleccionar',
  'est.btn.deseleccionar': 'Deseleccionar',
  'est.btn.eliminarTodos': 'Eliminar todos',
  'est.sub.enFiltro': '{n} en el filtro',
  'est.sub.enFiltroCorto': '{n} en filtro',
  'est.sub.enBase': '{n} en la base',
  'est.sub.enBaseCorto': '{n} en base',
  'est.sub.leyendo': 'Leyendo filas',
  'est.sub.formato': 'Formato .xlsx',
  'est.sub.formatoCorto': 'Formato',
  'est.sub.formatoExcel': 'Formato del Excel',
  'est.sub.generandoLibros': 'Generando libros',
  'est.sub.estudiantes': '{n} estudiantes',
  'est.sub.estudCorto': '{n} estud.',
  'est.sub.seleccionados': '{a} de {b} seleccionados',
  'est.sub.delFiltro': '{n} del filtro',
  'est.sub.quitarSel': 'Quitar la selección',
  'est.title.agregar': 'Agregar estudiante',
  'est.title.importarExcel':
    'Importar estudiantes desde un archivo Excel',
  'est.title.importarExcelCorto': 'Importar estudiantes desde Excel',
  'est.title.plantilla': 'Descargar plantilla Excel',
  'est.title.exportar':
    'Exportar todos los colegios a Excel (un libro por colegio)',
  'est.title.exportarCorto': 'Exportar todos los colegios a Excel',
  'est.title.ayuda': 'Ayuda de importación',
  'est.title.eliminarSel': 'Eliminar los estudiantes seleccionados',
  'est.title.deseleccionar': 'Deseleccionar todos',
  'est.title.seleccionar': 'Seleccionar todos los estudiantes del filtro',
  'est.title.eliminarFiltro':
    'Eliminar todos los estudiantes del filtro actual',

  // Resumen
  'est.resumen.totalTitle': 'Total de estudiantes en todos los colegios',
  'est.resumen.totalTitleFiltro': 'Total de estudiantes con los filtros actuales',
  'est.resumen.femTitle': 'Cantidad de estudiantes femenino con los filtros actuales',
  'est.resumen.mascTitle': 'Cantidad de estudiantes masculino con los filtros actuales',
  'est.resumen.general': 'General',
  'est.resumen.generalCorto': 'Gen',
  'est.resumen.total': 'Total',
  'est.resumen.totalCorto': 'Tot',
  'est.resumen.femenino': 'Femenino',
  'est.resumen.femeninoCorto': 'Fem',
  'est.resumen.masculino': 'Masculino',
  'est.resumen.masculinoCorto': 'Masc',

  // Promoción
  'est.promo.titulo': 'Promover estudiantes',
  'est.promo.conteoA': ' estudiantes en ',
  'est.promo.promoviendo': '⏳ Promoviendo...',
  'est.promo.promover': '📈 Promover',
  'est.promo.descartar': 'Descartar',
  'est.promo.ok': '✅ Promoción completada: {prom} promovidos',
  'est.promo.graduados': ', {n} graduados',
  'est.promo.error': '❌ Error al promover: {msg}',

  // Modal de migración de 6to grado
  'est.picker.titulo': 'Migrar 6to grado a Secundaria',
  'est.picker.descPlural':
    'Hay {n} estudiantes de 6to grado que necesitan un colegio Secundaria',
  'est.picker.descSingular':
    'Hay {n} estudiante de 6to grado que necesita un colegio Secundaria',
  'est.picker.afectados': 'Estudiantes afectados',
  'est.picker.mover': 'Mover a colegio Secundaria',
  'est.picker.confirmar': 'Confirmar migración',

  // Modal de ayuda de importación
  'est.ayuda.titulo': 'Guía de Importación Excel',
  'est.ayuda.intro':
    'El sistema es inteligente y detectará automáticamente las columnas. Cada hoja del Excel se procesará como un colegio separado (el nombre de la hoja será el nombre del colegio por defecto).',
  'est.ayuda.opcional': 'Opcional',
  'est.ayuda.vacio': '(vacío)',
  'est.ayuda.descNombre': 'Nombre completo del alumno. Obligatorio.',
  'est.ayuda.descAno':
    'Período escolar (2024, 2025, 2026...). Se usa el filtro actual si está vacío.',
  'est.ayuda.descColegio':
    'Nombre del centro. Si está vacío, usa el nombre de la hoja como colegio.',
  'est.ayuda.descGrado': 'Acepta "1", "1ro", "1er", "Primero", "1 grado", etc.',
  'est.ayuda.descSeccion': 'Grupo (A, B, Unica). Si está vacío, usa "Unica".',
  'est.ayuda.descSexo': 'M (Masculino) o F (Femenino).',
  'est.ayuda.descDuplicados': 'Se ignoran estudiantes que ya existan.',
  'est.ayuda.consejoLabel': '💡 Consejo:',
  'est.ayuda.consejo':
    'Si tienes un Excel con estudiantes de diferentes colegios, organízalos en hojas separadas. Cada hoja se importará como un colegio distinto.',
  'est.ayuda.entendido': 'Entendido',

  // Estados vacíos
  'est.vacio.tituloSinResultados': 'No se encontraron resultados',
  'est.vacio.titulo': 'No hay estudiantes registrados',
  'est.vacio.sinResultados':
    'No se encontró ningún estudiante que coincida con "{q}"',
  'est.vacio.sinFiltros':
    'No hay estudiantes registrados para los filtros seleccionados (Año, Colegio, Grado, Sección).',
  'est.vacio.limpiar': 'Limpiar búsqueda',

  // Tarjeta de estudiante
  'est.card.editar': '✏️ Editar',
  'est.card.eliminar': '🗑 Eliminar',

  // Modal Alta/Edición
  'est.modal.editar': 'Editar Estudiante',
  'est.modal.registrar': 'Registrar Estudiante',
  'est.modal.fotoAlt': 'Foto estudiante',
  'est.modal.foto': 'Foto',
  'est.modal.quitarFoto': '🗑️ Eliminar',
  'est.modal.nombrePh': 'Nombre completo',
  'est.modal.codigoPh': 'Auto-generado',
  'est.modal.anoLectivo': 'Año Lectivo',
  'est.modal.colegio': 'Colegio',
  'est.modal.grado': 'Grado',
  'est.modal.seccion': 'Sección',
  'est.modal.selGrado': 'Seleccione grado',
  'est.modal.selSeccion': 'Seleccione sección',

  // Modal de exportación
  'est.export.titulo': 'Exportar estudiantes a Excel',
  'est.export.sub': 'Un archivo .xlsx por colegio, con sus grados y secciones agrupadas',
  'est.export.ano': 'Año lectivo',
  'est.export.colegios': 'Colegios a exportar',
  'est.export.todos': 'Todos',
  'est.export.todosMarcados': 'Todos marcados',
  'est.export.quitar': 'Quitar de la exportación',
  'est.export.anadir': 'Añadir a la exportación',
  'est.export.resumenUno': '{n} est. · {g} grado',
  'est.export.resumenN': '{n} est. · {g} grados',
  'est.export.incluirVacios': 'Incluir grados sin estudiantes',
  'est.export.vaciosOn': 'Se incluyen hojas de grados vacíos',
  'est.export.vaciosOff': 'Solo grados con estudiantes',
  'est.export.generarA': 'Se generarán ',
  'est.export.generarB': ' archivo(s) con ',
  'est.export.generarC': ' estudiante(s) de ',
  'est.export.guardarAndroid': 'Se guardarán en Descargas/School Tracker',
  'est.export.ultimaCarpeta': 'Última carpeta: {p}',
  'est.export.generando': '⏳ Generando...',
  'est.export.exportarExcel': '📊 Exportar Excel',
  'est.export.okAndroid':
    '✅ {n} archivo(s) en Descargas/School Tracker · {m} estudiantes',
  'est.export.ok': '✅ {n} archivo(s) exportados · {m} estudiantes',
  'est.export.error': '❌ Error al exportar: {msg}',
  'est.export.selAno': '⚠️ Selecciona un año lectivo',
  'est.export.selColegios': '⚠️ No hay colegios seleccionados',
  'est.export.vacioAno': '⚠️ No hay estudiantes en {ano}',
  'est.export.confirmarAndroid':
    'Se generarán {n} archivo(s) Excel (uno por colegio) con los estudiantes de {ano}.\\n\\nSe guardarán en Descargas/School Tracker.',
  'est.export.confirmarDesktop':
    'Se generarán {n} archivo(s) Excel (uno por colegio) con los estudiantes de {ano}.\\n\\nElige la carpeta donde guardarlos.',
  'est.export.tituloAsk': '📊 Exportar estudiantes',
  'est.export.elegirCarpeta': 'Elegir carpeta',
  'est.export.carpetaTitulo': 'Carpeta destino para los archivos Excel',
  'est.export.carpetaError': '❌ No se pudo elegir la carpeta',
  'est.form.confirmarEditar': '¿Guardar los cambios de "{nombre}"?',
  'est.form.confirmarNuevo': '¿Registrar este nuevo estudiante?',
  'est.form.tituloEdit': '✏️ Confirmar edición',
  'est.form.tituloNuevo': '➕ Confirmar registro',
  'est.form.okEditar': 'Guardar',
  'est.form.okNuevo': 'Registrar',
  'est.promo.confirmarTitulo': '📈 Confirmar promoción',
  'est.promo.confirmarOk': 'Promover',
  'notas.del.titulo': 'Eliminar Notas',
  'notas.del.noDeshacer': 'Esta acción no se puede deshacer',
  'notas.del.todas': 'Todas las notas mostradas',
  'notas.del.todasDesc': 'Elimina todas las notas del corte y asignatura actuales',
  'notas.del.porEstudiante': 'Por estudiante',
  'notas.del.porEstudianteDesc': 'Elimina todas las notas de un estudiante específico',
  'notas.del.selEstudiante': 'Seleccione estudiante...',
  'notas.del.porIndicador': 'Por indicador',
  'notas.del.porIndicadorDesc': 'Elimina todas las notas de un indicador específico',
  'notas.del.selIndicador': 'Seleccione indicador...',
  'notas.del.eliminando': 'Eliminando...',
  'notas.tipo.cotejo': 'Lista de cotejo',
  'notas.tipo.escala': 'Escala valorativa',
  'notas.tipo.rubrica': 'Rúbrica',
  'notas.dist.errorPrevias': '❌ No se pudieron cargar las notas de cortes anteriores: {msg}',
  'notas.guardar.incompletas':
    "⚠️ Hay notas incompletas (solo 'A'). Por favor complételas (AA, AS, AF, AI) o bórrelas antes de guardar.",
  'notas.guardar.maxPts':
    '⚠️ El estudiante {nombre} tiene {pts} pts en el Indicador {n} (máximo 20)',
  'notas.guardar.confirmar':
    '¿Guardar las notas?\n\nSe registrarán los cambios en la base de datos local.',
  'notas.guardar.titulo': '💾 Confirmar guardado',
  'notas.guardar.okBorrados': '✅ Notas guardadas · {n} nota(s) borrada(s)',
  'notas.guardar.okSimple': '✅ Notas guardadas localmente',
  'notas.guardar.error': '❌ Error al guardar notas: {msg}',
  'notas.del.selUnEstudiante': '⚠️ Seleccione un estudiante',
  'notas.del.selUnIndicador': '⚠️ Seleccione un indicador',
  'notas.del.confirmarTodas':
    '¿Está seguro de eliminar TODAS las notas mostradas para este corte y asignatura? Esta acción no se puede deshacer.',
  'notas.del.confirmarEstudiante':
    '¿Está seguro de eliminar todas las notas de "{nombre}" para este corte y asignatura?',
  'notas.del.confirmarIndicador':
    '¿Está seguro de eliminar todas las notas del {indicador} para este corte y asignatura?',
  'notas.del.indicadorSel': 'indicador seleccionado',
  'notas.del.confirmarTitulo': '🗑️ Confirmar eliminación',
  'notas.del.confirmarOk': 'Sí, eliminar',
  'notas.del.ok': '✅ Notas eliminadas',
  'notas.del.error': '❌ Error al eliminar notas: {msg}',
  'notas.inst.ok': '✅ Indicador {n}: {label}',
  'notas.inst.error': '❌ Error guardando instrumento: {msg}',
  'notas.alcanceSeccion': 'esta sección',
  'notas.activo.activarTitulo': '✔ Activar indicador',
  'notas.activo.desactivarTitulo': '👁 Desactivar indicador',
  'notas.activo.activarBtn': 'Activar',
  'notas.activo.desactivarBtn': 'Desactivar',
  'notas.activo.sumarMsg':
    '¿Sumar el Indicador {n} en la sección {seccion}?\n\nSolo cambia en esta sección; las demás no se tocan.',
  'notas.activo.noSumarMsg':
    '¿Dejar de sumar el Indicador {n} en la sección {seccion}?\n\nSus notas dejan de sumar al total de esta sección, pero no se borra nada.',
  'notas.activo.exito': '✅ Indicador {n} {estado} en la sección {seccion}',
  'notas.activo.exitoSuma': 'suma',
  'notas.activo.exitoNoSuma': 'no suma',
  'notas.reestablecer.msg':
    'La sección volverá a usar los indicadores globales por defecto.\n\nSe borran sus excepciones (quedan {n} activo(s) en la BD local para esta sección).\nLos indicadores, sus notas y los criterios NO se borran.',
  'notas.reestablecer.titulo': '↩ Restablecer a valores globales',
  'notas.reestablecer.btn': 'Restablecer',
  'notas.reestablecer.exito': '↩ {n} excepción(es) borrada(s). La sección usa los valores globales.',
  'notas.intercambio.excesoPts':
    '❌ El Indicador {n} suma {pts} pts y el máximo por indicador es {max}.\nCorrige sus puntos en Evaluaciones antes de activarlo.',
  'notas.intercambio.msg':
    'Intercambio de indicadores:\n\n✔ Activar: Indicador {ordenNuevo} "{descNuevo}" ({puntosNuevo})\n👁 Desactivar: Indicador {ordenSaliente} "{descSaliente}"{conserva}\n\nLos {max} activos seguirán sumando {total}.\nEl indicador desactivado NO se borra: sigue con sus notas y criterios,\nsolo deja de sumar al total. Puedes volver a activarlo cuando quieras.',
  'notas.intercambio.cualitativo': 'cualitativo',
  'notas.intercambio.conserva': ' (conserva sus {n} nota(s))',
  'notas.intercambio.titulo': '🔄 Intercambiar indicadores',
  'notas.intercambio.btn': 'Hacer cambio',
  'notas.intercambio.exito': '🔄 En esta sección: {nuevo} suma · {saliente} no suma (conserva sus notas)',
  'notas.intercambio.error': '❌ Error en el intercambio: {msg}',
  'notas.vaciar.previo': '⚠️ Selecciona corte y asignatura antes de vaciar',
  'notas.vaciar.msg':
    'Se borrarán las notas de los {criterios} criterio(s) del Indicador {orden} "{descripcion}".\n\n· Solo en "{corte}" ({asignatura}).\n· {estudiantes} estudiante(s) de esta vista quedan con las celdas vacías.\n· Los demás cortes evaluativos NO se modifican.\n\nEl indicador y sus criterios se conservan; solo se vacían las notas.\nEsta acción no se puede deshacer.',
  'notas.vaciar.titulo': '🧹 Vaciar notas del indicador',
  'notas.vaciar.btn': 'Sí, vaciar este corte',
  'notas.vaciar.exito': '🧹 Indicador {orden}: {n} nota(s) vaciada(s) en {corte}',
  'notas.vaciar.error': '❌ Error al vaciar: {msg}',
  'notas.criterio.msg':
    'Se eliminará el Criterio {c} del Indicador {i}.\n\n· {notas} nota(s) se borrarán de TODOS los cortes evaluativos.\n· En esta vista afecta a {estudiantes} estudiante(s).\n\nEsta acción no se puede deshacer.',
  'notas.criterio.titulo': '🗑 Eliminar criterio',
  'notas.criterio.btn': 'Sí, eliminar',
  'notas.criterio.exito': '🗑 Criterio {n} eliminado',
  'notas.criterio.error': '❌ Error al eliminar: {msg}',
  'notas.masiva.vacias': 'ℹ️ No hay celdas vacías en C{n}',
  'notas.masiva.msg':
    'Se aplicará {letra} al Criterio {c} del Indicador {i} a {n} estudiante(s){alcance}.\n\nRecuerda que aún debes pulsar Guardar para escribirlo en la base de datos.',
  'notas.masiva.soloVacias': ' (solo celdas vacías)',
  'notas.masiva.sobrescribe': ' (sobrescribe)',
  'notas.masiva.titulo': '✍ Nota masiva {letra}',
  'notas.masiva.btn': 'Aplicar {letra}',
  'notas.masiva.exito': '✍ {letra} aplicado a {n} estudiante(s) en C{c}',

  // ── Ajustes ──────────────────────────────────────────────────────────────
  'ajustes.titulo': 'Ajustes',
  'ajustes.tab.configuracion': 'General',
  'ajustes.tab.notificaciones': 'Notif. Asistencia',
  'ajustes.tab.debug': 'Debug',
  'ajustes.tab.info': 'Info',
  'ajustes.tab.temaClaro': 'Tema Claro',
  'ajustes.tab.temaOscuro': 'Tema Oscuro',
  'ajustes.tab.temaSistema': 'Según sistema',
  'ajustes.config.titulo': 'Configuración',
  'ajustes.config.personalizacion': 'Personalización de Tabla de Notas',
  'ajustes.config.colorResaltado': 'Color de Resaltado',
  'ajustes.config.colorResaltadoDesc': 'Color para destacar al estudiante en la tabla de notas.',
  'ajustes.config.colorResaltadoLargo':
    'Este color se usará para destacar al estudiante y su fila cuando estés editando sus notas.',
  'ajustes.config.vistaPrevia': 'Vista Previa',
  'ajustes.config.vistaPreviaEjemplo': '← Ejemplo',
  'ajustes.config.vistaPreviaEjemploLargo': '← Ejemplo de estudiante resaltado',
  'ajustes.config.error': 'Error al actualizar la configuración: {msg}',
  'ajustes.notif.titulo': 'Notificaciones del sistema',
  'ajustes.notif.desc':
    'Permite que la app muestre recordatorios de asistencia y avisos de sincronización. Si el aviso del primer inicio no apareció o denegaste el permiso, actívalo aquí.',
  'ajustes.notif.activar': 'Activar notificaciones',
  'ajustes.notif.aviso':
    'Si no viste el diálogo, actívalo en Sistema → Apps → School Tracker → Notificaciones',
  'ajustes.notif.error': 'Error solicitando permiso: {msg}',

  // ── Navegador del login ──────────────────────────────────────────────────
  'nav.titulo': 'Navegador para iniciar sesión con Google',
  'nav.desc':
    'Solo afecta al login de Google (Welcome y Nube). Si tu navegador predeterminado sigue siendo Edge, elegí el tuyo acá y se abrirá ese.',
  'nav.compacto': 'Navegador: {nombre}',
  'nav.default': 'Predeterminado del sistema',
  'nav.firefox': 'Firefox',
  'nav.chrome': 'Google Chrome',
  'nav.edge': 'Microsoft Edge',
  'nav.brave': 'Brave',
  'nav.seAbrira': 'Se abrirá: {ruta}',
  'nav.noEncontrado':
    'No encontramos ese navegador instalado; se usará el del sistema.',
  'nav.usaraSistema': 'Se usará el navegador que el sistema tenga configurado.',
  'nav.notaWindows':
    'Para cambiar el predeterminado del sistema: Windows 11 → Configuración → Aplicaciones → Aplicaciones predeterminadas. Ojo: {http} y {https} son asociaciones separadas, y basta con que {https} siga en Edge para que el login se abra en Edge aunque hayas puesto otro navegador como predeterminado.',
} as const;

export type Clave = keyof typeof es;
