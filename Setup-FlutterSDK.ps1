#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Configura automáticamente el SDK de Flutter en Windows.
.DESCRIPTION
    Este script solicita la ruta del SDK de Flutter, valida la instalación,
    configura las variables de entorno del sistema y verifica que todo esté correcto.
.NOTES
    Ejecutar como Administrador.
    Versión: 2.0
#>

[CmdletBinding()]
param()

# ─────────────────────────────────────────────────────────────
# CONFIGURACIÓN Y UTILIDADES
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

function Write-Header {
    param([string]$Text)
    Write-Host "`n═══════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════`n" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Text)
    Write-Host "  ✓ $Text" -ForegroundColor Green
}

function Write-Warning2 {
    param([string]$Text)
    Write-Host "  ⚠ $Text" -ForegroundColor Yellow
}

function Write-Error2 {
    param([string]$Text)
    Write-Host "  ✗ $Text" -ForegroundColor Red
}

function Test-CommandExists {
    param([string]$Command)
    return [bool](Get-Command -Name $Command -ErrorAction SilentlyContinue)
}

# ─────────────────────────────────────────────────────────────
# 1. VERIFICAR EJECUCIÓN COMO ADMINISTRADOR
# ─────────────────────────────────────────────────────────────

Write-Header "Verificando privilegios de administrador"

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error2 "Este script debe ejecutarse como Administrador."
    Write-Host "`n  Por favor, cierra PowerShell y vuelve a abrirlo como Administrador." -ForegroundColor Yellow
    Write-Host "  Click derecho en PowerShell → 'Ejecutar como administrador'`n" -ForegroundColor Yellow
    pause
    exit 1
}
Write-Success "Ejecutando con privilegios de administrador"

# ─────────────────────────────────────────────────────────────
# 2. SOLICITAR RUTA DEL SDK DE FLUTTER
# ─────────────────────────────────────────────────────────────

Write-Header "Configuración del SDK de Flutter"

# Intentar detectar Flutter automáticamente
$autoPaths = @(
    "C:\flutter",
    "C:\src\flutter",
    "$env:USERPROFILE\flutter",
    "$env:USERPROFILE\development\flutter",
    "$env:LOCALAPPDATA\flutter",
    "C:\tools\flutter"
)

$foundPath = $null
foreach ($path in $autoPaths) {
    if (Test-Path "$path\bin\flutter.bat") {
        $foundPath = $path
        break
    }
}

if ($foundPath) {
    Write-Host "  🔍 SDK de Flutter detectado automáticamente en:" -ForegroundColor Blue
    Write-Host "     $foundPath" -ForegroundColor White
    $useAuto = Read-Host "`n  ¿Deseas usar esta ruta? (S/N) [S]"
    if ($useAuto -eq "" -or $useAuto -match "^[Ss]$") {
        $flutterPath = $foundPath
    } else {
        $flutterPath = $null
    }
}

if (-not $flutterPath) {
    Write-Host "`n  Ingresa la ruta completa donde está instalado el SDK de Flutter." -ForegroundColor White
    Write-Host "  Ejemplo: C:\flutter o C:\src\flutter" -ForegroundColor DarkGray
    Write-Host "  (Debe contener la carpeta 'bin' con el archivo flutter.bat)`n" -ForegroundColor DarkGray
    
    do {
        $flutterPath = Read-Host "  Ruta del SDK de Flutter"
        $flutterPath = $flutterPath.Trim().Trim('"').Trim("'")
        
        # Expandir variables de entorno si las hay
        $flutterPath = [Environment]::ExpandEnvironmentVariables($flutterPath)
        
        # Normalizar ruta
        $flutterPath = (Resolve-Path $flutterPath -ErrorAction SilentlyContinue).Path
        
        if (-not $flutterPath) {
            Write-Error2 "La ruta ingresada no existe. Intenta de nuevo."
            continue
        }
        
        $flutterBin = Join-Path $flutterPath "bin"
        $flutterExe = Join-Path $flutterBin "flutter.bat"
        
        if (-not (Test-Path $flutterExe)) {
            Write-Error2 "No se encontró 'bin\flutter.bat' en esa ruta."
            Write-Warning2 "Asegúrate de que sea la carpeta RAÍZ del SDK de Flutter."
            $flutterPath = $null
        }
    } while (-not $flutterPath)
}

$flutterBinPath = Join-Path $flutterPath "bin"
$flutterCachePath = Join-Path $flutterBinPath "cache"

Write-Success "Ruta del SDK validada: $flutterPath"

# ─────────────────────────────────────────────────────────────
# 3. CONFIGURAR VARIABLES DE ENTORNO DEL SISTEMA
# ─────────────────────────────────────────────────────────────

Write-Header "Configurando variables de entorno del sistema"

# Obtener PATH del sistema actual
$systemPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")

# Normalizar y eliminar rutas antiguas de Flutter del PATH del sistema
$pathEntries = $systemPath -split ";" | Where-Object { 
    $_ -and ($_ -notmatch "\\flutter\\bin" -and $_ -notmatch "\\flutter\\bin\\cache" -and $_ -ne $flutterBinPath -and $_ -ne $flutterCachePath)
}

# Agregar nueva ruta de Flutter (al inicio para prioridad)
$newSystemPath = ($flutterBinPath, $flutterCachePath + "\dart-sdk\bin") + $pathEntries | Select-Object -Unique
$newSystemPathString = ($newSystemPath -join ";").TrimEnd(";")

# Aplicar cambios
try {
    [Environment]::SetEnvironmentVariable("Path", $newSystemPathString, "Machine")
    Write-Success "PATH del sistema actualizado con Flutter"
} catch {
    Write-Error2 "Error al actualizar PATH del sistema: $_"
    exit 1
}

# Configurar FLUTTER_ROOT (opcional pero recomendado)
[Environment]::SetEnvironmentVariable("FLUTTER_ROOT", $flutterPath, "Machine")
Write-Success "Variable FLUTTER_ROOT configurada: $flutterPath"

# Configurar PUB_CACHE si no existe (para paquetes de Dart)
$pubCachePath = Join-Path $env:USERPROFILE ".pub-cache\bin"
if (-not (Test-Path $pubCachePath)) {
    New-Item -ItemType Directory -Path $pubCachePath -Force | Out-Null
}
# Agregar pub-cache al PATH del usuario si no está
if ($currentUserPath -notlike "*$pubCachePath*") {
    $newUserPath = "$pubCachePath;$currentUserPath"
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    Write-Success "Pub cache agregado al PATH del usuario"
}

# ─────────────────────────────────────────────────────────────
# 4. ACTUALIZAR PATH EN LA SESIÓN ACTUAL
# ─────────────────────────────────────────────────────────────

Write-Header "Actualizando sesión actual de PowerShell"

# Refrescar PATH en la sesión actual
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
$env:FLUTTER_ROOT = $flutterPath

Write-Success "Variables de entorno cargadas en la sesión actual"

# ─────────────────────────────────────────────────────────────
# 5. VERIFICAR CONFIGURACIÓN
# ─────────────────────────────────────────────────────────────

Write-Header "Verificando instalación de Flutter"

# Verificar que flutter está disponible
$flutterCmd = Get-Command flutter -ErrorAction SilentlyContinue
if (-not $flutterCmd) {
    Write-Error2 "Flutter no se encuentra en el PATH de esta sesión."
    Write-Warning2 "Es posible que necesites reiniciar PowerShell."
} else {
    Write-Success "Flutter encontrado en: $($flutterCmd.Source)"
}

# Ejecutar flutter --version
Write-Host "`n  Ejecutando 'flutter --version'..." -ForegroundColor Blue
try {
    $version = & flutter --version 2>&1
    $version | ForEach-Object { Write-Host "    $_" -ForegroundColor White }
    Write-Success "Flutter responde correctamente"
} catch {
    Write-Error2 "Error al ejecutar flutter --version: $_"
}

# ─────────────────────────────────────────────────────────────
# 6. EJECUTAR FLUTTER DOCTOR
# ─────────────────────────────────────────────────────────────

Write-Header "Ejecutando Flutter Doctor"

Write-Host "  Analizando el estado de la instalación..." -ForegroundColor Blue
Write-Host "  (Esto puede tardar unos segundos...)`n" -ForegroundColor DarkGray

try {
    $doctorOutput = & flutter doctor 2>&1
    $doctorOutput | ForEach-Object {
        if ($_ -match "✓|\[✓\]") {
            Write-Host "  $_" -ForegroundColor Green
        } elseif ($_ -match "✗|\[✗\]") {
            Write-Host "  $_" -ForegroundColor Red
        } elseif ($_ -match "!|\[!") {
            Write-Host "  $_" -ForegroundColor Yellow
        } else {
            Write-Host "  $_" -ForegroundColor White
        }
    }
} catch {
    Write-Error2 "Error al ejecutar flutter doctor: $_"
}

# ─────────────────────────────────────────────────────────────
# 7. RESUMEN Y RECOMENDACIONES
# ─────────────────────────────────────────────────────────────

Write-Header "Resumen de la configuración"

Write-Host "  📁 Ruta del SDK:      " -NoNewline; Write-Host $flutterPath -ForegroundColor Cyan
Write-Host "  🔧 Flutter en PATH:   " -NoNewline; Write-Host "Sí (sistema)" -ForegroundColor Green
Write-Host "  🌐 FLUTTER_ROOT:      " -NoNewline; Write-Host $env:FLUTTER_ROOT -ForegroundColor Cyan

Write-Host "`n  ───────────────────────────────────────────────────" -ForegroundColor DarkGray

# Verificar dependencias comunes
Write-Host "`n  Dependencias detectadas:" -ForegroundColor White

# Git
if (Test-CommandExists git) {
    $gitVersion = git --version 2>$null
    Write-Success "Git instalado: $gitVersion"
} else {
    Write-Error2 "Git NO encontrado. Flutter requiere Git."
    Write-Host "     Descarga: https://git-scm.com/download/win" -ForegroundColor DarkGray
}

# Android Studio / SDK
$androidHome = [Environment]::GetEnvironmentVariable("ANDROID_HOME", "Machine")
if (-not $androidHome) { $androidHome = [Environment]::GetEnvironmentVariable("ANDROID_SDK_ROOT", "Machine") }
if ($androidHome -and (Test-Path $androidHome)) {
    Write-Success "Android SDK encontrado: $androidHome"
} else {
    Write-Warning2 "Android SDK NO configurado. Necesario para compilar apps Android."
    Write-Host "     Instala Android Studio: https://developer.android.com/studio" -ForegroundColor DarkGray
}

# Java
if (Test-CommandExists java) {
    $javaVersion = java -version 2>&1 | Select-String "version" | Select-Object -First 1
    Write-Success "Java instalado: $javaVersion"
} else {
    Write-Warning2 "Java NO encontrado. Puede ser necesario para Android."
}

# Visual Studio (para Windows desktop)
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    Write-Success "Visual Studio encontrado (vswhere detectado)"
} else {
    Write-Warning2 "Visual Studio NO encontrado. Necesario para Windows Desktop."
}

Write-Host "`n═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ Configuración completada" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan

Write-Host "`n  ⚠ IMPORTANTE: Cierra y vuelve a abrir TODAS las" -ForegroundColor Yellow
Write-Host "     terminales (PowerShell, CMD, VS Code, Android Studio)" -ForegroundColor Yellow
Write-Host "     para que los cambios surtan efecto completamente.`n" -ForegroundColor Yellow

Write-Host "  Prueba ejecutando: flutter doctor" -ForegroundColor Cyan
Write-Host "  O crea un proyecto: flutter create mi_app`n" -ForegroundColor Cyan

pause