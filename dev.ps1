# dev.ps1
# Forzar codificación UTF-8 para la consola
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

# Buscar npm.exe y agregar su directorio al PATH
$npmPaths = @(
    "C:\Program Files\nodejs\npm.cmd",
    "${env:ProgramFiles}\nodejs\npm.cmd",
    "$env:AppData\npm\npm.cmd",
    "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd"
)

$nodeFound = $false
foreach ($npmPath in $npmPaths) {
    if (Test-Path $npmPath) {
        $npmDir = Split-Path $npmPath -Parent
        if ($env:Path -notlike "*$npmDir*") {
            $env:Path = "$npmDir;$env:Path"
        }
        $nodeFound = $true
        break
    }
}

if (-not $nodeFound) {
    Write-Host "[ERROR] No se encontró npm. Instala Node.js desde https://nodejs.org" -ForegroundColor Red
    Start-Sleep -Seconds 3
    exit 1
}

# Función para cargar el entorno de Visual Studio (cl.exe)
function Import-VSVars {
    if (Get-Command "cl.exe" -ErrorAction SilentlyContinue) { return }
    Write-Host "`n[INFO] Buscando entorno de Visual Studio..." -ForegroundColor Yellow
    
    $vcvarsPath = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
    if (-not (Test-Path $vcvarsPath)) { $vcvarsPath = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" }
    if (-not (Test-Path $vcvarsPath)) { $vcvarsPath = "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" }

    if (Test-Path $vcvarsPath) {
        Write-Host "[INFO] Cargando variables de entorno desde vcvarsall.bat..." -ForegroundColor Gray
        $tempFile = [System.IO.Path]::GetTempFileName()
        cmd /c "`"$vcvarsPath`" x64 && set" > $tempFile
        Get-Content $tempFile | Foreach-Object {
            if ($_ -match "^(.*?)=(.*)$") {
                $name = $matches[1]
                $value = $matches[2]
                if ($name -ne "Path") { Set-Item "env:$name" $value } else { $env:Path = $value }
            }
        }
        Remove-Item $tempFile
        Write-Host "[OK] Entorno de compilaci$([char]0x00F3)n listo." -ForegroundColor Green
    }
}

Import-VSVars
$env:CC = "cl.exe"
$env:CXX = "cl.exe"

# Verificar e inicializar proyecto Android si no existe
$androidProjectPath = "$PSScriptRoot\src-tauri\gen\android"
    if (-not (Test-Path $androidProjectPath)) {
        Write-Host "`n[INFO] Proyecto Android no encontrado. Inicializando..." -ForegroundColor Yellow
        Write-Host "============================================================" -ForegroundColor Cyan
        
        npm run tauri android init
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "`n[ERROR] Falló la inicialización del proyecto Android." -ForegroundColor Red
            Write-Host "[INFO] Verifica que Android SDK y NDK estén instalados correctamente." -ForegroundColor Gray
            Write-Host "[INFO] Puedes intentar ejecutar manualmente: npm run tauri android init" -ForegroundColor Gray
            Write-Host "`nPresione cualquier tecla para continuar..."
            $null = [Console]::ReadKey($true)
        } else {
            Write-Host "`n[OK] Proyecto Android inicializado correctamente!" -ForegroundColor Green
        }
        Write-Host "============================================================`n" -ForegroundColor Cyan
    }

function Show-Menu {
    Clear-Host
    Write-Host "`n==============================================" -ForegroundColor Cyan
    Write-Host "   GESTOR DE DESARROLLO - TAURI/RUST" -ForegroundColor Cyan
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host "1." -NoNewline; Write-Host " Windows (Desarrollo)"
    Write-Host "2." -NoNewline; Write-Host " Android (Desarrollo) (IP: 192.168.100.27)"
    Write-Host "3." -NoNewline; Write-Host " Windows Build (Release - Instalador final)"
    Write-Host "4." -NoNewline; Write-Host " Android Build (Release - APK Final)"
    Write-Host "5." -NoNewline; Write-Host " Salir" -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Cyan
}

# Bucle infinito para que el script NUNCA se cierre solo
while ($true) {
    # Manejador de interrupciones (Ctrl+C) y errores fatales
    trap {
        Write-Host "`n`n[SISTEMA] Proceso interrumpido o error detectado." -ForegroundColor Yellow
        Write-Host "Regresando al menú principal..." -ForegroundColor Yellow
        Start-Sleep -Seconds 2
        Clear-Host
        continue
    }

    try {
        Show-Menu
        Write-Host "Seleccione una opción: " -NoNewline
        $modo = Read-Host

        if ($modo -eq "5") {
            Write-Host "`nSaliendo..." -ForegroundColor Cyan
            break
        }

        switch ($modo) {
            "1" {
                $env:TAURI_DEV_HOST = "0.0.0.0"
                Write-Host "`n[INFO] Iniciando desarrollo en Windows..." -ForegroundColor Yellow
                Write-Host "[INFO] Presiona Ctrl+C para detener el proceso y volver al menú." -ForegroundColor DarkGray

                # Ejecutar npm run tauri dev (más directo que npx tauri)
                npm run tauri dev

                Write-Host "`n[OK] Proceso de desarrollo finalizado." -ForegroundColor Green
                Start-Sleep -Seconds 1
            }
            "2" {
                # Para el emulador, usar localhost (10.0.2.2 es como el emulador ve localhost)
                $env:TAURI_DEV_HOST = "10.0.2.2"
                Write-Host "`n[INFO] Iniciando desarrollo en Android..." -ForegroundColor Yellow
                
                # Rutas comunes de Android SDK
                $commonPaths = @(
                    "$env:LOCALAPPDATA\Android\Sdk",
                    "$env:USERPROFILE\AppData\Local\Android\Sdk",
                    "C:\Program Files\Android\Android Studio\jbr",
                    "$env:ProgramFiles\Android\Android Studio"
                )
                
                # Verificar ANDROID_HOME o buscar automáticamente
                if (-not $env:ANDROID_HOME) {
                    Write-Host "[INFO] ANDROID_HOME no está definida. Buscando automáticamente..." -ForegroundColor Yellow
                    foreach ($path in $commonPaths) {
                        if (Test-Path "$path\emulator\emulator.exe") {
                            $env:ANDROID_HOME = $path
                            [Environment]::SetEnvironmentVariable("ANDROID_HOME", $path, "User")
                            Write-Host "[OK] ANDROID_HOME encontrada y configurada: $path" -ForegroundColor Green
                            break
                        }
                    }
                    
                    if (-not $env:ANDROID_HOME) {
                        Write-Host "[ERROR] No se encontró Android SDK en rutas comunes." -ForegroundColor Red
                        Write-Host "`n¿Deseas establecerla manualmente? (s/n): " -NoNewline
                        $setPath = Read-Host
                        if ($setPath -eq "s" -or $setPath -eq "S") {
                            Write-Host "Ingresa la ruta completa del SDK: " -NoNewline
                            $sdkPath = Read-Host
                            if (Test-Path "$sdkPath\emulator\emulator.exe") {
                                $env:ANDROID_HOME = $sdkPath
                                [Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdkPath, "User")
                                Write-Host "[OK] ANDROID_HOME configurada." -ForegroundColor Green
                            } else {
                                Write-Host "[ERROR] Ruta inválida. Verifica que contenga 'emulator\emulator.exe'" -ForegroundColor Red
                                Start-Sleep -Seconds 2
                                continue
                            }
                        } else {
                            continue
                        }
                    }
                }
                
                $emulatorPath = "$env:ANDROID_HOME\emulator\emulator.exe"
                $adbPath = "$env:ANDROID_HOME\platform-tools\adb.exe"
                
                if (-not (Test-Path $emulatorPath)) {
                    Write-Host "[ERROR] No se encontró el emulador en: $emulatorPath" -ForegroundColor Red
                    Start-Sleep -Seconds 2
                    continue
                }
                
                # Listar AVDs disponibles
                Write-Host "`n[INFO] Buscando emuladores disponibles..." -ForegroundColor Cyan
                $avds = & $emulatorPath -list-avds 2>$null
                
                if (-not $avds -or $avds.Count -eq 0) {
                    Write-Host "[ERROR] No se encontraron emuladores. Crea uno en Android Studio." -ForegroundColor Red
                    Start-Sleep -Seconds 2
                    continue
                }
                
                Write-Host "Emuladores disponibles:" -ForegroundColor Gray
                $avds | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
                
                # Seleccionar primer AVD o pedir al usuario
                if ($avds.Count -eq 1) {
                    $selectedAvd = $avds
                } else {
                    Write-Host "`nSeleccione el emulador (nombre exacto): " -NoNewline -ForegroundColor Yellow
                    $selectedAvd = Read-Host
                }
                
                # Verificar si ya hay un emulador corriendo
                $runningEmulators = & $adbPath devices 2>$null | Select-String "emulator-"
                if ($runningEmulators) {
                    Write-Host "`n[INFO] Ya hay emuladores corriendo:" -ForegroundColor Yellow
                    $runningEmulators | ForEach-Object { Write-Host "  $($_.Line.Trim())" -ForegroundColor Gray }
                    Write-Host "`n¿Iniciar otro emulador? (s/n): " -NoNewline -ForegroundColor Yellow
                    $startNew = Read-Host
                    if ($startNew -ne "s" -and $startNew -ne "S") {
                        $selectedAvd = $null
                    }
                }
                
                # Iniciar emulador si es necesario
                if ($selectedAvd) {
                    Write-Host "`n[INFO] Iniciando emulador '$selectedAvd'..." -ForegroundColor Cyan
                    # Usar cold boot y sin snapshot para evitar problemas de boot loop
                    Start-Process $emulatorPath -ArgumentList "-avd", $selectedAvd, "-no-audio", "-no-snapshot-load"
                    
                    Write-Host "[INFO] Esperando que el emulador arranque (esto puede tardar)..." -ForegroundColor Yellow
                    
                    # Esperar dispositivo con timeout (no bloquear infinitamente)
                    $waitTimeout = 60  # segundos
                    $waitStart = Get-Date
                    $deviceReady = $false
                    
                    while ((New-TimeSpan -Start $waitStart -End (Get-Date)).TotalSeconds -lt $waitTimeout) {
                        $devices = & $adbPath devices 2>$null | Select-String "emulator-.*device"
                        if ($devices) {
                            $deviceReady = $true
                            break
                        }
                        Start-Sleep -Seconds 2
                    }
                    
                    if (-not $deviceReady) {
                        Write-Host "[ERROR] Timeout esperando el emulador." -ForegroundColor Red
                        Write-Host "[INFO] Intenta: Device Manager > Wipe Data en Android Studio" -ForegroundColor Gray
                        Start-Sleep -Seconds 3
                        continue
                    }
                    
                    Write-Host "[OK] Dispositivo detectado!" -ForegroundColor Green
                    
                    # Esperar a que el boot se complete
                    Write-Host "[INFO] Esperando que Android termine de arrancar..." -ForegroundColor Yellow
                    $bootTimeout = 120  # 2 minutos
                    $bootStart = Get-Date
                    $bootComplete = $false
                    
                    while ((New-TimeSpan -Start $bootStart -End (Get-Date)).TotalSeconds -lt $bootTimeout) {
                        try {
                            $bootStatus = & $adbPath shell getprop sys.boot_completed 2>$null
                            if ($bootStatus -eq "1") {
                                Write-Host "[OK] Android completamente iniciado!" -ForegroundColor Green
                                $bootComplete = $true
                                break
                            }
                        } catch {
                            # Ignorar errores de adb
                        }
                        
                        Start-Sleep -Seconds 3
                    }
                    
                    if (-not $bootComplete) {
                        Write-Host "[WARNING] Timeout de boot. El emulador puede seguir arrancando..." -ForegroundColor Yellow
                        Write-Host "[INFO] Continuando con la compilación..." -ForegroundColor Gray
                    }
                    
                    Write-Host "[OK] Emulador listo!" -ForegroundColor Green
                }
                
                # Ejecutar Tauri con output visible
                Write-Host "`n[INFO] Compilando e instalando app en el emulador..." -ForegroundColor Yellow
                Write-Host "============================================================" -ForegroundColor Cyan
                Write-Host "Tiempo estimado: 5-15 minutos (primera vez)" -ForegroundColor Gray
                Write-Host "============================================================`n" -ForegroundColor Cyan

                # Ejecutar npm con output en tiempo real
                npm run tauri android dev
                
                Write-Host "`n[OK] Proceso completado!" -ForegroundColor Green
            }
            "3" {
                Write-Host "`n[INFO] Compilando instalador final para Windows..." -ForegroundColor Green
                npm run tauri build
            }
            "4" {
                Write-Host "`n[INFO] Compilando APK final para Android..." -ForegroundColor Yellow
                npm run tauri android build
            }
            Default {
                Write-Host "`n[ERROR] Opci$([char]0x00F3)n no v$([char]0x00E1)lida." -ForegroundColor Red
                Start-Sleep -Seconds 1
                continue
            }
        }

        Write-Host "`n[OK] Proceso finalizado." -ForegroundColor Green
        Write-Host "`nPresione cualquier tecla para volver al men$([char]0x00FA)..."
        $null = [Console]::ReadKey($true)

    } catch {
        # Captura cualquier error inesperado dentro del try
        Write-Host "`n`n[ERROR] Ocurrió un error: $_" -ForegroundColor Red
        Write-Host "Regresando al menú..."
        Start-Sleep -Seconds 2
    }
}
