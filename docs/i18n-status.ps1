param(
  # Filtro opcional: 'svelte' | 'ts' o el nombre de un archivo (sin ruta).
  [string]$Filtro = ''
)

# Cuenta los textos visibles por archivo para medir el avance del i18n.
#
# Criterio (mismo que se uso a mano para AsistenciaPage):
#   - Nodos de texto del template: lo que esta entre '>' y '<'.
#   - Literales de cadena en el <script> que parecen texto de interfaz
#     (dos o mas palabras, o con acento).
#
# Excluye a proposito: console.log/warn/error/debug y los llamadores tipo
# wsLog() (mensajes de desarrollo), incluidas sus concatenaciones multilinea,
# valores de CSS, y rutas/nombres de simbolo. Un archivo cuyos "textos" son
# solo logs no figura en la lista (ej. wsSyncService.ts).
#
# LIMITACION: el conteo es un limite superior. No distingue un 'title=' de un
# '<h2>', ni un mensaje de dialogo de un texto suelto. Sirve para ordenar el
# trabajo, no para estimar al minutillo.
#
# Uso:
#   powershell -File docs\i18n-status.ps1
#   powershell -File docs\i18n-status.ps1 svelte
#   powershell -File docs\i18n-status.ps1 NotasPage

$ErrorActionPreference = 'Stop'
$utf = New-Object System.Text.UTF8Encoding($false, $true)

# Se arman los conjuntos con code point para no escribir acentos en el script
# (este archivo se edita a mano y un acento mal codificado rompe el parseo).
$acentos = -join @(
  [char]0xE1, [char]0xE9, [char]0xE0, [char]0xED, [char]0xF3, [char]0xFA, [char]0xF1,
  [char]0xFC, [char]0xBF, [char]0xA1, [char]0xD3, [char]0xC1, [char]0xC9, [char]0xC0,
  [char]0xCD, [char]0xD1, [char]0xDC, [char]0xB1, [char]0xA7
)
$patAc = '[' + [regex]::Escape($acentos) + ']'

$q = [char]39
$patLit = $q + '([^' + $q + '\x60]{5,160})' + $q

# Palabras que delatan texto en espanol (todas ASCII a proposito).
$kw = 'Guardar|Cancelar|Eliminar|Editar|Estudiante|Estudiantes|Nota|Notas|Asistencia|' +
      'Dashboard|Reportes|Evaluaciones|Configuracion|Ajustes|Bienvenido|Volver|' +
      'Siguiente|Anterior|Descargando|Guardando|Sincronizando|Cargando|Colegio|' +
      'Colegios|Grado|Grados|Seccion|Secciones|Asignatura|Asignaturas|Buscar|' +
      'Cerrar|Abrir|Nuevo|Confirmar|Advertencia|Aplicacion|Nube|Respaldo|Nuevos|' +
      'Todos|Total|Salir|Ausente|Presente|Justificado|Limpiar|Marcar|Informe|' +
      'Mensual|Semanal|Diario'
$patKw = '\b(' + $kw + ')\b'

# Archivos que son infraestructura del i18n, no pantallas: sus "textos" son
# comentarios o los propios diccionarios, asi que no cuentan como pendientes.
$infra = @(
  'src\lib\locales\es.ts',
  'src\lib\locales\en.ts',
  'src\lib\i18n.svelte.ts',
  'src\lib\oauthBrowser.ts'
)

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)   # raiz del repo
$out = New-Object System.Collections.Generic.List[string]
$rows = @()

$files = Get-ChildItem -Recurse -File -Include *.svelte, *.ts -Path (Join-Path $root 'src')
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1)
  if ($Filtro -and $rel -notmatch $Filtro) { continue }

  $lines = [System.IO.File]::ReadAllLines($f.FullName, $utf)
  $todo = $lines -join "`n"
  $yaTraducido = $todo -match 'i18n\.svelte'
  $esInfra = $infra -contains $rel

  $nText = 0
  $nLit = 0
  $enLog = $false   # dentro de una llamada a console/wsLog que se abre multilinea
  for ($i = 0; $i -lt $lines.Length; $i++) {
    $l = $lines[$i]
    $trim = $l.Trim()

    # Console / logger: sus literales son mensajes de desarrollo, no UI.
    # Cubre la llamada multilinea: mientras la sentencia siga abierta
    # (termina en '+', ',', '(' o un operador), las lineas siguientes son
    # continuacion y tampoco se cuentan.
    if ($enLog) {
      if ($trim -match '\+$|,$|\($|&&$|\|\|$') { continue }
      $enLog = $false
      continue
    }
    if ($l -match '(console\.(log|info|warn|error|debug|trace)|\bwsLog)\s*\(') {
      if ($trim -match '\+$|,$|\($|&&$|\|\|$') { $enLog = $true }
      continue
    }

    foreach ($m in [regex]::Matches($l, '>([^<>{}]{2,120})<')) {
      $v = $m.Groups[1].Value.Trim()
      if ($v -match '[A-Za-z]{2}' -and ($v -match $patAc -or $v -match $patKw)) { $nText++ }
    }

    if ($l -match '^\s*(//|\*|/\*)') { continue }
    foreach ($m in [regex]::Matches($l, $patLit)) {
      $v = $m.Groups[1].Value
      if ($v -notmatch '[A-Za-z]{2}') { continue }
      if ($v -match '^[\w./\-:#]+$') { continue }                    # ruta o simbolo
      if ($v -notmatch '\s' -and $v -notmatch $patAc) { continue }  # una palabra suelta
      if ($v -match '(Error|Cargando|Fall|fallo|Failed|rror )') { continue }   # console
      if ($v -match '^(rgba|linear-gradient|min|max|calc|var|#[0-9a-fA-F]|[0-9]+px)') { continue }
      if ($v -match '^\s*(--|/|\.|@)') { continue }
      $nLit++
    }
  }

  $tot = $nText + $nLit
  if ($tot -gt 0) {
    $estado = if ($esInfra) { 'INFRA' } elseif ($yaTraducido) { 'LISTO' } else { 'PENDIENTE' }
    $rows += [pscustomobject]@{
      File = $rel; Lineas = $lines.Length; Textos = $tot; Estado = $estado
    }
  }
}

$out.Add('=== i18n: estado por archivo ===')
if ($Filtro) { $out.Add('filtro: ' + $Filtro) }
$out.Add('')
$out.Add(('archivo'.PadRight(46) + 'lineas'.PadLeft(7) + 'textos'.PadLeft(8) + '  estado'))
$out.Add(('-' * 72))

$orden = @{ LISTO = 0; INFRA = 1; PENDIENTE = 2 }
foreach ($r in ($rows | Sort-Object @{ Expression = { $orden[$_.Estado] } }, @{ Expression = { $_.Textos }; Descending = $true })) {
  $out.Add(($r.File.PadRight(46) + ([string]$r.Lineas).PadLeft(7) + ([string]$r.Textos).PadLeft(8) + '  ' + $r.Estado))
}

$pend = @($rows | Where-Object { $_.Estado -eq 'PENDIENTE' })
$listo = @($rows | Where-Object { $_.Estado -eq 'LISTO' })
$infra = @($rows | Where-Object { $_.Estado -eq 'INFRA' })

function Total($lista) {
  $s = ($lista | Measure-Object -Property Textos -Sum).Sum
  if ($null -eq $s) { return 0 }
  return $s
}

$out.Add('')
$out.Add('PENDIENTE: ' + (Total $pend) + ' textos en ' + $pend.Count + ' archivo(s)')
$out.Add('LISTO:     ' + (Total $listo) + ' textos en ' + $listo.Count + ' archivo(s)')
$out.Add('INFRA:     ' + (Total $infra) + ' textos en ' + $infra.Count + ' archivo(s) (diccionarios, no cuentan)')

$out | Write-Host
