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
  'asis.limpiar.confirmarMsg':
    '¿Limpiar todos los estados de asistencia del período actual?\n\nLos cambios sin guardar se descartarán.',
  'asis.limpiar.alcanceSeccion': 'esta sección',
  'asis.limpiar.alcanceGrado': 'este grado',
  'asis.limpiar.alcanceColegio': 'este colegio',
  'asis.limpiar.vacias': '⚠️ No hay asistencias marcadas en esos días',
  'asis.limpiar.confirmarMsg':
    '¿Vaciar {n} asistencia(s) marcadas?\n\nFechas: {rango} ({dias})\nEstudiantes: {estudiantes}\n\n{aviso}Solo se limpian los días elegidos; el resto del período no se toca.',
  'asis.limpiar.avisoServidor':
    '⚠️ Se borran {n} registro(s) de la base, y con ellos la observación de esos días.\n\n',
  'asis.limpiar.exito': '✅ {n} asistencia(s) limpiadas',
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
  'asis.ausencia.soloEstaFecha': 'Solo afecta esa fecha específica',
  'asis.ausencia.hintSemana':
    'Pasa el cursor sobre una semana para verla resaltada en la tabla',
  'asis.confirmar.guardar': '¿Guardar los cambios de asistencia pendientes?',
  'asis.confirmar.guardarTitulo': 'Confirmar guardado',
  'asis.confirmar.sinGuardar':
    'Tienes cambios sin guardar. ¿Deseas guardarlos antes de continuar?',
  'asis.confirmar.sinGuardarTitulo': 'Cambios sin guardar',
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
