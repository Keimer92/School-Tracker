# Set console encoding to UTF-8 to support any system output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    # Set current location to script directory
    $ScriptDir = $PSScriptRoot
    if ($ScriptDir) {
        Set-Location $ScriptDir
    }

    # Check Administrator privileges
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "==============================================" -ForegroundColor Red
        Write-Host "   ERROR! SE REQUIEREN PERMISOS DE ADMIN" -ForegroundColor Red
        Write-Host "==============================================" -ForegroundColor Red
        Write-Host "Este script debe ejecutarse como Administrador."
        Write-Host "Por favor, usa el archivo .bat proporcionado para iniciarlo."
        Write-Host ""
        Read-Host "Presiona Enter para salir..."
        exit 1
    }

    # Detect and configure ANDROID_HOME
    if (-not $env:ANDROID_HOME) {
        if (Test-Path "C:\Users\Admin\Android") {
            $env:ANDROID_HOME = "C:\Users\Admin\Android"
        } elseif (Test-Path "$env:LOCALAPPDATA\Android\Sdk") {
            $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
        } elseif (Test-Path "$env:USERPROFILE\AppData\Local\Android\Sdk") {
            $env:ANDROID_HOME = "$env:USERPROFILE\AppData\Local\Android\Sdk"
        }
    }

    # Safely define paths if ANDROID_HOME is set
    if ($env:ANDROID_HOME) {
        $AdbPath = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
        $SdkManager = Join-Path $env:ANDROID_HOME "cmdline-tools\latest\bin\sdkmanager.bat"
    } else {
        $AdbPath = ""
        $SdkManager = ""
    }

    function Show-Menu {
        Clear-Host
        Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
        Write-Host "|    GESTOR DE DESARROLLO - TAURI / RUST       |" -ForegroundColor Cyan
        Write-Host "|               PowerShell v1.4                |" -ForegroundColor Cyan
        Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
        if (-not $env:ANDROID_HOME) {
            Write-Host "ADVERTENCIA: ANDROID_HOME no esta configurada en este sistema." -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host " === DESARROLLO ===" -ForegroundColor Yellow
        Write-Host "   1. Windows (Desarrollo)"
        Write-Host "   2. Android (Desarrollo)"
        Write-Host "   3. Windows Build (Release)"
        Write-Host "   4. Android Build (Release - arm64) [Rapido]"
        Write-Host "   5. Android Build (Release - Todas las arquitecturas)"
        Write-Host ""
         Write-Host " === MANTENIMIENTO ===" -ForegroundColor Yellow
         Write-Host "   6. Limpiar cache y dependencias"
         Write-Host "   7. Depurar Android (Chrome Inspect)"
         Write-Host "   8. Configurar firmas Android (Release)"
         Write-Host "   9. Limpiar proyecto para portabilidad"
         Write-Host ""
          Write-Host " === OTROS ===" -ForegroundColor Yellow
          Write-Host " 10. Crear .gitignore para Rust/Tauri"
          Write-Host " 11. Gestionar llaves (keystore)"
          Write-Host " 12. Compilar motor de WhatsApp"
          Write-Host " 13. Salir"
        Write-Host "------------------------------------------------" -ForegroundColor Cyan
        Write-Host ""
    }

    function Assert-AndroidSdk {
        if (-not $env:ANDROID_HOME) {
            Write-Host ""
            Write-Host "[ERROR] Esta opcion requiere que ANDROID_HOME este configurado." -ForegroundColor Red
            Write-Host "Asegurate de tener instalado Android SDK en una de las rutas predeterminadas"
            Write-Host "o configura la variable de entorno ANDROID_HOME."
            Write-Host ""
            Read-Host "Presione Enter para continuar..."
            return $false
        }
        return $true
    }

    function Invoke-WindowsDev {
        if (-not (Assert-NodeModules)) { return }
        Write-Host ""
        Write-Host "[INFO] Iniciando desarrollo en Windows..." -ForegroundColor Cyan
        Write-Host "[INFO] Servidor: http://localhost:1420" -ForegroundColor Cyan
        Write-Host ""
        $cmd = "`$host.UI.RawUI.WindowTitle = 'Tauri Windows (Dev)'; Set-Location '$ScriptDir'; npm run tauri dev"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
    }

    function Set-AndroidArchArm64 {
        Remove-Item Env:ORG_GRADLE_PROJECT_abiList -ErrorAction SilentlyContinue
        Remove-Item Env:ORG_GRADLE_PROJECT_archList -ErrorAction SilentlyContinue
        Remove-Item Env:ORG_GRADLE_PROJECT_targetList -ErrorAction SilentlyContinue
        $env:ORG_GRADLE_PROJECT_abiList = "arm64-v8a"
        $env:ORG_GRADLE_PROJECT_archList = "arm64"
        $env:ORG_GRADLE_PROJECT_targetList = "aarch64"
    }

    function Set-AndroidArchAll {
        Remove-Item Env:ORG_GRADLE_PROJECT_abiList -ErrorAction SilentlyContinue
        Remove-Item Env:ORG_GRADLE_PROJECT_archList -ErrorAction SilentlyContinue
        Remove-Item Env:ORG_GRADLE_PROJECT_targetList -ErrorAction SilentlyContinue
    }

    function Assert-NodeModules {
        $nmDir = Join-Path $ScriptDir "node_modules"
        if (-not (Test-Path $nmDir)) {
            Write-Host ""
            Write-Host "[INFO] node_modules no encontrado. Ejecutando npm install..." -ForegroundColor Cyan
            Write-Host ""
            Push-Location $ScriptDir
            npm install
            Pop-Location
            if ($LASTEXITCODE -ne 0) {
                Write-Host ""
                Write-Host "[ERROR] npm install fallo." -ForegroundColor Red
                Read-Host "Presione Enter para continuar..."
                return $false
            }
            Write-Host ""
            Write-Host "[OK] npm install completado." -ForegroundColor Green
        }
        return $true
    }

    function Assert-AndroidProject {
        $gradlewBat = Join-Path $ScriptDir "src-tauri\gen\android\gradlew.bat"
        if (-not (Test-Path $gradlewBat)) {
            Write-Host "[WARNING] No se encontro el wrapper de Gradle (gradlew.bat)." -ForegroundColor Yellow
            Write-Host "[INFO] Inicializando el proyecto Android con Tauri para restaurar Gradle..." -ForegroundColor Cyan
            npx tauri android init
            if (-not (Test-Path $gradlewBat)) {
                Write-Host "[ERROR] No se pudo inicializar Gradle en el proyecto de Android." -ForegroundColor Red
                Read-Host "Presione Enter para continuar..."
                return $false
            }
        }
        return $true
    }

    function Invoke-AndroidDevBase {
        param([bool]$allArchs)
        if (-not (Assert-NodeModules)) { return }
        if (-not (Assert-AndroidSdk)) { return }
        if (-not (Assert-AndroidProject)) { return }
        
        if ($allArchs) { Set-AndroidArchAll } else { Set-AndroidArchArm64 }
        $archLabel = if ($allArchs) { "Todas las arquitecturas" } else { "arm64" }
        
        Write-Host ""
        Write-Host "[INFO] Iniciando desarrollo en Android ($archLabel)..." -ForegroundColor Cyan
        Write-Host ""
        
        Write-Host "[INFO] Limpiando locks de compilacion..." -ForegroundColor Cyan
        $cargoLock = Join-Path $ScriptDir "src-tauri\target\.cargo-lock"
        if (Test-Path $cargoLock) { Remove-Item -Force $cargoLock -ErrorAction SilentlyContinue }
        
        $gradleDir = Join-Path $ScriptDir "src-tauri\gen\android\app\build\.gradle"
        if (Test-Path $gradleDir) { Remove-Item -Recurse -Force $gradleDir -ErrorAction SilentlyContinue }
        
        Stop-Process -Name "java" -Force -ErrorAction SilentlyContinue
        
        $ndkPath = Join-Path $env:ANDROID_HOME "ndk\27.0.12077973"
        [Environment]::SetEnvironmentVariable("ANDROID_NDK_HOME", $ndkPath, "Machine")
        $env:ANDROID_NDK_HOME = $ndkPath
        
        $ndkProps = Join-Path $ndkPath "source.properties"
        if (-not (Test-Path $ndkProps)) {
            Write-Host "[INFO] Instalando NDK..." -ForegroundColor Cyan
            @("y", "y", "y", "y", "y", "y", "y") | & $SdkManager --licenses > $null 2>&1
            "y" | & $SdkManager "ndk;27.0.12077973"
        }
        
        $genAndroid = Join-Path $ScriptDir "src-tauri\gen\android"
        if (-not (Test-Path $genAndroid)) {
            Write-Host "[INFO] Inicializando proyecto..." -ForegroundColor Cyan
            npm run tauri android init
        }
        
        $installedTargets = rustup target list --installed
        $hasAndroidTarget = $installedTargets | Out-String -Stream | Select-String "android"
        if (-not $hasAndroidTarget) {
            Write-Host "[INFO] Instalando targets de Rust para Android..." -ForegroundColor Cyan
            rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
        }
        
        Write-Host ""
        Write-Host "[INFO] Buscando dispositivos..." -ForegroundColor Cyan
        $adbDevicesOutput = & $AdbPath devices -l 2>$null
        
        Write-Host ""
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "DISPOSITIVOS DISPONIBLES:" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        $adbDevicesOutput | ForEach-Object { Write-Host $_ }
        Write-Host "==============================================" -ForegroundColor Cyan
        
        $devices = @()
        if ($adbDevicesOutput) {
            for ($i = 1; $i -lt $adbDevicesOutput.Count; $i++) {
                $line = $adbDevicesOutput[$i]
                if (-not [string]::IsNullOrWhiteSpace($line)) {
                    $devices += $line
                }
            }
        }
        
        if ($devices.Count -eq 0) {
            Write-Host ""
            Write-Host "[ERROR] No hay dispositivos fisicos conectados." -ForegroundColor Red
            Write-Host "  - Conecta USB con depuracion activada"
            Write-Host "  - O usa la opcion 10 para conectar por WiFi"
            Write-Host ""
            Read-Host "Presione Enter para continuar..."
            return
        }
        
        Write-Host ""
        for ($i = 0; $i -lt $devices.Count; $i++) {
            Write-Host "  $($i + 1). $($devices[$i])"
        }
        
        Write-Host ""
        $sel = Read-Host "Selecciona dispositivo (1-$($devices.Count))"
        if ([string]::IsNullOrWhiteSpace($sel)) { return }
        
        [int]$idx = 0
        if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt $devices.Count) { return }
        
        $selected = $devices[$idx - 1]
        Write-Host "[OK] Seleccionado: $selected" -ForegroundColor Green
        Write-Host ""
        
        $pc_ip = ""
        $ipConfig = ipconfig
        foreach ($line in $ipConfig) {
            if ($line -like "*IPv4*") {
                if ($line -match "IPv4.*:\s*(.*)") {
                    $pc_ip = $Matches[1].Trim()
                    break
                }
            }
        }
        
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "[INFO] IMPORTANTE PARA DISPOSITIVO FISICO:" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "1. Asegurate que el firewall permita el puerto 1420"
        Write-Host "2. La PC y el dispositivo deben estar en la misma red"
        Write-Host "3. IP de tu PC: $pc_ip"
        Write-Host "4. Si falla, ejecuta en PowerShell (como Administrador):"
        Write-Host "    New-NetFirewallRule -DisplayName `"Vite Dev`" -Direction Inbound -LocalPort 1420 -Protocol TCP -Action Allow"
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        
        Write-Host "[INFO] Iniciando servidor Vite y Android..." -ForegroundColor Cyan
        $cmdVite = "`$host.UI.RawUI.WindowTitle = 'Vite Dev Server'; Set-Location '$ScriptDir'; npm run dev"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmdVite
        Start-Sleep -Seconds 5
        $cmdTauri = "`$host.UI.RawUI.WindowTitle = 'Tauri Android (Dev)'; Set-Location '$ScriptDir'; npx tauri android dev"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmdTauri
    }

    function Invoke-WindowsBuild {
        if (-not (Assert-NodeModules)) { return }
        Write-Host ""
        Write-Host "[INFO] Compilando Windows (Release)..." -ForegroundColor Cyan
        $cmd = "`$host.UI.RawUI.WindowTitle = 'Windows Build (Release)'; Set-Location '$ScriptDir'; npm run tauri build"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
        Read-Host "Presione Enter para continuar..."
    }

    function Invoke-AndroidBuildBase {
        param([bool]$allArchs)
        if (-not (Assert-NodeModules)) { return }
        if (-not (Assert-AndroidSdk)) { return }
        if (-not (Assert-AndroidProject)) { return }
        
        if ($allArchs) { Set-AndroidArchAll } else { Set-AndroidArchArm64 }
        $archLabel = if ($allArchs) { "Todas las arquitecturas" } else { "arm64" }
        
        Write-Host ""
        Write-Host "[INFO] Compilando Android ($archLabel)..." -ForegroundColor Cyan
        
        $buildCmd = "npx tauri android build"
        
        $cmd = "`$host.UI.RawUI.WindowTitle = 'Android Build ($archLabel)'; Set-Location '$ScriptDir'; $buildCmd"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
        Read-Host "Presione Enter para continuar..."
    }

    function Invoke-AndroidBuildArm64 {
        if (-not (Assert-NodeModules)) { return }
        if (-not (Assert-AndroidSdk)) { return }
        if (-not (Assert-AndroidProject)) { return }
        
        Write-Host ""
        Write-Host "[INFO] Compilando Android solo arm64 (Release)..." -ForegroundColor Cyan
        Write-Host "[INFO] Usando: npx tauri android build --release --target aarch64" -ForegroundColor Cyan
        
        $buildCmd = "npx tauri android build --target aarch64"
        $cmd = "`$host.UI.RawUI.WindowTitle = 'Android Build arm64'; Set-Location '$ScriptDir'; $buildCmd"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
        Read-Host "Presione Enter para continuar..."
    }

    function Invoke-AndroidBuildAll { Invoke-AndroidBuildBase -allArchs $true }

    function Clear-AppCache {
        Write-Host ""
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "LIMPIEZA DE CACHE Y DEPENDENCIAS" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host " 1. Rapida - Solo limpia builds (Android + Windows)"
        Write-Host " 2. Agresiva - Limpia TODO (target, node_modules, npm cache, builds)"
        Write-Host ""
        $choice = Read-Host "Selecciona tipo de limpieza (1-2)"
        Write-Host ""

        if ($choice -eq "1") {
            Write-Host "[INFO] Limpieza rapida (builds)..." -ForegroundColor Cyan

            $androidBuildDir = Join-Path $ScriptDir "src-tauri\gen\android\app\build"
            if (Test-Path $androidBuildDir) {
                Remove-Item -Recurse -Force $androidBuildDir
                Write-Host "  [OK] Android build limpiado" -ForegroundColor Green
            } else {
                Write-Host "  [--] No hay build de Android" -ForegroundColor Gray
            }

            $windowsBuildDir = Join-Path $ScriptDir "src-tauri\target\release"
            if (Test-Path $windowsBuildDir) {
                Remove-Item -Recurse -Force $windowsBuildDir
                Write-Host "  [OK] Release de Windows limpiado" -ForegroundColor Green
            } else {
                Write-Host "  [--] No hay build de Windows" -ForegroundColor Gray
            }

            $debugBuildDir = Join-Path $ScriptDir "src-tauri\target\debug"
            if (Test-Path $debugBuildDir) {
                Remove-Item -Recurse -Force $debugBuildDir
                Write-Host "  [OK] Debug de Windows limpiado" -ForegroundColor Green
            } else {
                Write-Host "  [--] No hay build debug de Windows" -ForegroundColor Gray
            }

            $distDir = Join-Path $ScriptDir "dist"
            if (Test-Path $distDir) {
                Remove-Item -Recurse -Force $distDir
                Write-Host "  [OK] Dist limpiado" -ForegroundColor Green
            } else {
                Write-Host "  [--] No hay dist" -ForegroundColor Gray
            }

            $viteDir = Join-Path $ScriptDir "node_modules\.vite"
            if (Test-Path $viteDir) {
                Remove-Item -Recurse -Force $viteDir
                Write-Host "  [OK] Cache de Vite limpiado" -ForegroundColor Green
            } else {
                Write-Host "  [--] No hay cache de Vite" -ForegroundColor Gray
            }
        } else {
            $viteDir = Join-Path $ScriptDir "node_modules\.vite"
            if (Test-Path $viteDir) { Remove-Item -Recurse -Force $viteDir }
            
            $targetDir = Join-Path $ScriptDir "src-tauri\target"
            if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
            
            $androidBuildDir = Join-Path $ScriptDir "src-tauri\gen\android\app\build"
            if (Test-Path $androidBuildDir) { Remove-Item -Recurse -Force $androidBuildDir }
            
            $distDir = Join-Path $ScriptDir "dist"
            if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
            
            Write-Host "[INFO] Limpiando cache de npm..." -ForegroundColor Cyan
            npm cache clean --force
            
            Write-Host "[INFO] Ejecutando cargo clean..." -ForegroundColor Cyan
            Push-Location (Join-Path $ScriptDir "src-tauri")
            cargo clean
            Pop-Location
        }

        Write-Host ""
        Write-Host "[OK] Limpieza completada!" -ForegroundColor Green
        Read-Host "Presione Enter para continuar..."
    }

    function Invoke-CleanProject {
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "LIMPIAR PROYECTO PARA PORTABILIDAD" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Se eliminaran TODOS los archivos de compilacion y dependencias,"
        Write-Host "dejando solo el codigo fuente y configuracion necesaria para"
        Write-Host "compilar en cualquier maquina."
        Write-Host ""
        Write-Host "Se eliminara:" -ForegroundColor Red
        Write-Host "  - src-tauri\target\    (build artifacts de Rust)"
        Write-Host "  - src-tauri\gen\       (proyecto Android auto-generado)"
        Write-Host "  - node_modules\        (dependencias npm)"
        Write-Host "  - dist\                (build del frontend)"
        Write-Host "  - node_modules\.vite\  (cache de Vite)"
        Write-Host "  - *.log, .cargo-lock   (archivos temporales)"
        Write-Host ""
        Write-Host "Se conservara:" -ForegroundColor Green
        Write-Host "  - src-tauri\src\       (codigo fuente Rust)"
        Write-Host "  - src-tauri\Cargo.toml + Cargo.lock"
        Write-Host "  - src-tauri\tauri.conf.json, build.rs, icons, capabilities"
        Write-Host "  - src\                 (codigo fuente frontend)"
        Write-Host "  - package.json + package-lock.json"
        Write-Host "  - vite.config.ts, tsconfig*.json, index.html"
        Write-Host "  - public\              (assets estaticos)"
        Write-Host ""
        $confirm = Read-Host "Esta seguro? (s/n)"
        if ($confirm -ne "s" -and $confirm -ne "S") {
            Write-Host "[INFO] Operacion cancelada."
            Read-Host "Presione Enter para continuar..."
            return
        }

        function Get-DirSize($path) {
            if (-not (Test-Path $path)) { return 0 }
            $result = Get-ChildItem -Path $path -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue
            if ($null -eq $result -or $null -eq $result.Sum) { return 0 }
            $size = [long]$result.Sum
            if ($size -lt 0) { return 0 }
            return $size
        }

        $totalFreed = 0
        Write-Host ""
        Write-Host "[INFO] Limpiando..." -ForegroundColor Cyan
        Write-Host ""

        # 1. Rust build artifacts
        $targetDir = Join-Path $ScriptDir "src-tauri\target"
        if (Test-Path $targetDir) {
            $size = Get-DirSize $targetDir
            Write-Host "  Eliminando src-tauri\target\... " -NoNewline
            Remove-Item -Recurse -Force $targetDir -ErrorAction SilentlyContinue
            $totalFreed += $size
            Write-Host "[OK] ($(if ($size -gt 1GB) { '{0:N2} GB' -f ($size/1GB) } elseif ($size -gt 1MB) { '{0:N2} MB' -f ($size/1MB) } else { '{0:N2} KB' -f ($size/1KB) }))" -ForegroundColor Green
        } else {
            Write-Host "  src-tauri\target\ no existe" -ForegroundColor Gray
        }

        # 2. Android auto-generated project
        $genDir = Join-Path $ScriptDir "src-tauri\gen"
        if (Test-Path $genDir) {
            $size = Get-DirSize $genDir
            Write-Host "  Eliminando src-tauri\gen\... " -NoNewline
            Remove-Item -Recurse -Force $genDir -ErrorAction SilentlyContinue
            $totalFreed += $size
            Write-Host "[OK] ($(if ($size -gt 1GB) { '{0:N2} GB' -f ($size/1GB) } elseif ($size -gt 1MB) { '{0:N2} MB' -f ($size/1MB) } else { '{0:N2} KB' -f ($size/1KB) }))" -ForegroundColor Green
        } else {
            Write-Host "  src-tauri\gen\ no existe" -ForegroundColor Gray
        }

        # 3. node_modules
        $nmDir = Join-Path $ScriptDir "node_modules"
        if (Test-Path $nmDir) {
            $size = Get-DirSize $nmDir
            Write-Host "  Eliminando node_modules\... " -NoNewline
            Remove-Item -Recurse -Force $nmDir -ErrorAction SilentlyContinue
            $totalFreed += $size
            Write-Host "[OK] ($(if ($size -gt 1GB) { '{0:N2} GB' -f ($size/1GB) } elseif ($size -gt 1MB) { '{0:N2} MB' -f ($size/1MB) } else { '{0:N2} KB' -f ($size/1KB) }))" -ForegroundColor Green
        } else {
            Write-Host "  node_modules\ no existe" -ForegroundColor Gray
        }

        # 4. dist
        $distDir = Join-Path $ScriptDir "dist"
        if (Test-Path $distDir) {
            $size = Get-DirSize $distDir
            Write-Host "  Eliminando dist\... " -NoNewline
            Remove-Item -Recurse -Force $distDir -ErrorAction SilentlyContinue
            $totalFreed += $size
            Write-Host "[OK] ($(if ($size -gt 1GB) { '{0:N2} GB' -f ($size/1GB) } elseif ($size -gt 1MB) { '{0:N2} MB' -f ($size/1MB) } else { '{0:N2} KB' -f ($size/1KB) }))" -ForegroundColor Green
        } else {
            Write-Host "  dist\ no existe" -ForegroundColor Gray
        }

        # 5. Vite cache
        $viteDir = Join-Path $ScriptDir "node_modules\.vite"
        if (Test-Path $viteDir) {
            $size = Get-DirSize $viteDir
            Write-Host "  Eliminando cache de Vite... " -NoNewline
            Remove-Item -Recurse -Force $viteDir -ErrorAction SilentlyContinue
            $totalFreed += $size
            Write-Host "[OK] ($(if ($size -gt 1GB) { '{0:N2} GB' -f ($size/1GB) } elseif ($size -gt 1MB) { '{0:N2} MB' -f ($size/1MB) } else { '{0:N2} KB' -f ($size/1KB) }))" -ForegroundColor Green
        } else {
            Write-Host "  cache de Vite no existe" -ForegroundColor Gray
        }

        # 6. .cargo-lock files
        $cargoLock = Join-Path $ScriptDir "src-tauri\target\.cargo-lock"
        if (Test-Path $cargoLock) {
            $size = (Get-Item $cargoLock -ErrorAction SilentlyContinue).Length
            Remove-Item -Force $cargoLock -ErrorAction SilentlyContinue
            $totalFreed += $size
            Write-Host "  [OK] .cargo-lock eliminado ($(if ($size -gt 1MB) { '{0:N2} MB' -f ($size/1MB) } else { '{0:N2} KB' -f ($size/1KB) }))" -ForegroundColor Green
        }

        # 7. Build logs
        $buildLog = Join-Path $ScriptDir "src-tauri\build_log.txt"
        if (Test-Path $buildLog) {
            $size = (Get-Item $buildLog -ErrorAction SilentlyContinue).Length
            Remove-Item -Force $buildLog -ErrorAction SilentlyContinue
            $totalFreed += $size
            Write-Host "  [OK] build_log.txt eliminado ($(if ($size -gt 1MB) { '{0:N2} MB' -f ($size/1MB) } else { '{0:N2} KB' -f ($size/1KB) }))" -ForegroundColor Green
        }

        # 8. Gradle build artifacts (if gen/android still had build)
        $gradleBuild = Join-Path $ScriptDir "src-tauri\gen\android\app\build"
        if (Test-Path $gradleBuild) {
            $size = Get-DirSize $gradleBuild
            Remove-Item -Recurse -Force $gradleBuild -ErrorAction SilentlyContinue
            $totalFreed += $size
            Write-Host "  [OK] Gradle build eliminado ($(if ($size -gt 1GB) { '{0:N2} GB' -f ($size/1GB) } elseif ($size -gt 1MB) { '{0:N2} MB' -f ($size/1MB) } else { '{0:N2} KB' -f ($size/1KB) }))" -ForegroundColor Green
        }

        Write-Host ""
        Write-Host "[OK] Proyecto limpiado para portabilidad!" -ForegroundColor Green
        Write-Host "     Espacio liberado: $(if ($totalFreed -gt 1GB) { '{0:N2} GB' -f ($totalFreed/1GB) } elseif ($totalFreed -gt 1MB) { '{0:N2} MB' -f ($totalFreed/1MB) } else { '{0:N2} KB' -f ($totalFreed/1KB) } )" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Para compilar en una maquina nueva:" -ForegroundColor Yellow
        Write-Host "  1. npm install"
        Write-Host "  2. npx tauri android init  (solo para Android)"
        Write-Host "  3. npm run tauri dev       (Windows)"
        Write-Host "  4. npm run tauri android dev (Android)"
        Write-Host ""
        Read-Host "Presione Enter para continuar..."
    }

    function Get-AndroidLogs {
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "DEPURADOR DE CHROME (Android)" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "[INFO] La URL chrome://inspect/#devices ha sido copiada al portapapeles." -ForegroundColor Cyan
        Write-Host "[INFO] 1. Abre Chrome (o Edge)."
        Write-Host "[INFO] 2. Pega la URL en la barra de direcciones (Ctrl+V)."
        Write-Host "[INFO] 3. Haz clic en inspect bajo tu dispositivo."
        Write-Host ""
        
        Set-Clipboard "chrome://inspect/#devices"
        try {
            Start-Process "chrome"
        } catch {
            Write-Host "[WARNING] No se pudo abrir Chrome automaticamente. Por favor abre tu navegador y pega la URL." -ForegroundColor Yellow
        }
        Read-Host "Presione Enter para continuar..."
    }

    function Invoke-SignerTool {
        Write-Host "[INFO] Compilando herramienta de firmas desde codigo fuente..." -ForegroundColor Cyan
        $cargoToml = Join-Path $ScriptDir "tauri-android-signer\Cargo.toml"
        cargo run --manifest-path $cargoToml
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] Fallo la compilacion." -ForegroundColor Red
            Read-Host "Presione Enter para continuar..."
        }
    }

    function Invoke-AndroidSigner {
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "CONFIGURAR FIRMAS ANDROID (RELEASE)" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Ejecutando Tauri Android Signer..." -ForegroundColor Cyan
        Invoke-SignerTool
        Read-Host "Presione Enter para continuar..."
    }

    function Manage-Keystore {
        while ($true) {
            Clear-Host
            Write-Host "==============================================" -ForegroundColor Cyan
            Write-Host "GESTION DE LLAVES (KEYSTORE)" -ForegroundColor Yellow
            Write-Host "==============================================" -ForegroundColor Cyan
            Write-Host ""
            Write-Host " 1. Abrir herramienta de firmas (crear/usar/importar)"
            Write-Host " 2. Respaldar keystore actual"
            Write-Host " 3. Restaurar keystore desde respaldo"
            Write-Host " 4. Ver respaldos disponibles"
            Write-Host " 5. Volver al menu principal"
            Write-Host ""

            $opt = Read-Host "Seleccione una opcion (1-5)"
            
            switch ($opt) {
                "1" {
                    Clear-Host
                    Write-Host "==============================================" -ForegroundColor Cyan
                    Write-Host "CONFIGURAR FIRMAS ANDROID (RELEASE)" -ForegroundColor Yellow
                    Write-Host "==============================================" -ForegroundColor Cyan
                    Write-Host ""
                    Invoke-SignerTool
                    Read-Host "`nPresione Enter para continuar..."
                }
                "2" {
                    Clear-Host
                    Write-Host "--- RESPALDAR KEYSTORE ---" -ForegroundColor Cyan
                    $backupDir = Join-Path $ScriptDir "keystore-backups"
                    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
                    $destDir = Join-Path $backupDir $timestamp

                    $androidApp = Join-Path $ScriptDir "src-tauri\gen\android\app"
                    $keystoreFiles = Get-ChildItem -Path $androidApp -Filter "*.keystore" -ErrorAction SilentlyContinue
                    $jksFiles = Get-ChildItem -Path $androidApp -Filter "*.jks" -ErrorAction SilentlyContinue
                    $allKeys = @($keystoreFiles) + @($jksFiles)

                    if ($allKeys.Count -eq 0) {
                        Write-Host ""
                        Write-Host "[ERROR] No se encontraron archivos .keystore o .jks en el proyecto." -ForegroundColor Red
                        Write-Host "La ruta buscada es: $androidApp" -ForegroundColor Yellow
                        Write-Host "Primero crea uno con la opcion 1 (Abrir herramienta de firmas)."
                        Read-Host "`nPresione Enter para continuar..."
                        continue
                    }

                    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
                    
                    foreach ($key in $allKeys) {
                        Copy-Item -Path $key.FullName -Destination (Join-Path $destDir $key.Name)
                        Write-Host "  [OK] $($key.Name) respaldado." -ForegroundColor Green
                    }

                    $propsFile = Join-Path $androidApp "keystore.properties"
                    if (Test-Path $propsFile) {
                        Copy-Item -Path $propsFile -Destination (Join-Path $destDir "keystore.properties")
                        Write-Host "  [OK] keystore.properties respaldado." -ForegroundColor Green
                    }

                    Write-Host ""
                    Write-Host "[OK] Respaldo completado en:" -ForegroundColor Green
                    Write-Host "     $destDir" -ForegroundColor Cyan
                    Write-Host ""
                    Write-Host "IMPORTANTE: Guarda esta carpeta en un lugar seguro (USB, nube)." -ForegroundColor Yellow
                    Write-Host "Para usarla en otra PC, elige 'Restaurar keystore desde respaldo'." -ForegroundColor Yellow
                    Read-Host "`nPresione Enter para continuar..."
                }
                "3" {
                    Clear-Host
                    Write-Host "--- RESTAURAR KEYSTORE ---" -ForegroundColor Cyan
                    $backupDir = Join-Path $ScriptDir "keystore-backups"

                    if (-not (Test-Path $backupDir)) {
                        Write-Host ""
                        Write-Host "[ERROR] No existe la carpeta de respaldos." -ForegroundColor Red
                        Write-Host "Primero debes crear un respaldo con la opcion 2."
                        Read-Host "`nPresione Enter para continuar..."
                        continue
                    }

                    $backups = Get-ChildItem -Path $backupDir -Directory | Sort-Object Name
                    if ($backups.Count -eq 0) {
                        Write-Host ""
                        Write-Host "[ERROR] No hay respaldos disponibles." -ForegroundColor Red
                        Read-Host "`nPresione Enter para continuar..."
                        continue
                    }

                    Write-Host ""
                    Write-Host "Respaldos disponibles:" -ForegroundColor Yellow
                    for ($i = 0; $i -lt $backups.Count; $i++) {
                        $fileCount = (Get-ChildItem -Path $backups[$i].FullName -File).Count
                        Write-Host "  $($i + 1). $($backups[$i].Name) ($fileCount archivo(s))"
                    }
                    Write-Host ""
                    $sel = Read-Host "Seleccione respaldo a restaurar (1-$($backups.Count))"
                    
                    [int]$idx = 0
                    if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt $backups.Count) {
                        continue
                    }

                    $selected = $backups[$idx - 1]
                    $androidApp = Join-Path $ScriptDir "src-tauri\gen\android\app"
                    $files = Get-ChildItem -Path $selected.FullName -File
                    $count = 0

                    foreach ($f in $files) {
                        Copy-Item -Path $f.FullName -Destination (Join-Path $androidApp $f.Name) -Force
                        Write-Host "  [OK] $($f.Name) restaurado." -ForegroundColor Green
                        $count++
                    }

                    Write-Host ""
                    Write-Host "[OK] Restauracion completada ($count archivo(s))." -ForegroundColor Green
                    Write-Host "Ya puedes compilar tu Android en modo release con firma."
                    Read-Host "`nPresione Enter para continuar..."
                }
                "4" {
                    Clear-Host
                    Write-Host "--- RESPALDOS DISPONIBLES ---" -ForegroundColor Cyan
                    $backupDir = Join-Path $ScriptDir "keystore-backups"
                    
                    if (-not (Test-Path $backupDir)) {
                        Write-Host ""
                        Write-Host "No existe la carpeta de respaldos." -ForegroundColor Yellow
                        Write-Host "Usa la opcion 2 para crear tu primer respaldo."
                        Read-Host "`nPresione Enter para continuar..."
                        continue
                    }

                    $backups = Get-ChildItem -Path $backupDir -Directory | Sort-Object Name -Descending
                    if ($backups.Count -eq 0) {
                        Write-Host ""
                        Write-Host "No hay respaldos aun." -ForegroundColor Yellow
                        Write-Host "Usa la opcion 2 para crear tu primer respaldo."
                    } else {
                        Write-Host ""
                        Write-Host "Total de respaldos: $($backups.Count)" -ForegroundColor Yellow
                        Write-Host ""
                        foreach ($b in $backups) {
                            $fileCount = (Get-ChildItem -Path $b.FullName -File).Count
                            $totalSize = "{0:N2} KB" -f ((Get-ChildItem -Path $b.FullName -Recurse | Measure-Object -Property Length -Sum).Sum / 1KB)
                            $backupLine = "  $($b.Name)  |  $($fileCount) archivo(s)  |  $($totalSize)"
                            Write-Host $backupLine
                        }
                    }
                    Read-Host "`nPresione Enter para continuar..."
                }
                "5" { break }
                default { }
            }
        }
    }

    function Invoke-WhatsAppEngineBuild {
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "COMPILAR MOTOR DE WHATSAPP" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        
        $engineJs = Join-Path $ScriptDir "src-tauri\whatsapp-engine\engine.js"
        $bundleMjs = Join-Path $ScriptDir "src-tauri\whatsapp-engine\bundle.mjs"
        
        if (-not (Test-Path $engineJs)) {
            Write-Host ""
            Write-Host "[ERROR] No se encontro el motor de WhatsApp en este proyecto." -ForegroundColor Red
            Write-Host "  Ruta esperada: src-tauri\whatsapp-engine\engine.js" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Este proyecto no tiene un motor de WhatsApp integrado." -ForegroundColor Gray
            Read-Host "Presione Enter para continuar..."
            return
        }
        
        if (-not (Test-Path $bundleMjs)) {
            Write-Host ""
            Write-Host "[ERROR] No se encontro el script de compilacion del motor." -ForegroundColor Red
            Write-Host "  Ruta esperada: src-tauri\whatsapp-engine\bundle.mjs" -ForegroundColor Yellow
            Read-Host "Presione Enter para continuar..."
            return
        }
        
        $nccPath = Join-Path $ScriptDir "node_modules\.bin\ncc"
        if (-not (Test-Path "$nccPath.cmd") -and -not (Test-Path "$nccPath.ps1")) {
            Write-Host ""
            Write-Host "[INFO] @vercel/ncc no encontrado. Instalando..." -ForegroundColor Cyan
            npm install 2>&1 | Out-Null
            if (-not (Test-Path "$nccPath.cmd") -and -not (Test-Path "$nccPath.ps1")) {
                Write-Host "[ERROR] No se pudo instalar @vercel/ncc. Verifica que este en devDependencies." -ForegroundColor Red
                Read-Host "Presione Enter para continuar..."
                return
            }
        }
        
        Write-Host ""
        Write-Host "[INFO] Instalando dependencias del motor..." -ForegroundColor Cyan
        Push-Location (Join-Path $ScriptDir "src-tauri\whatsapp-engine")
        npm install 2>&1 | Out-Null
        Pop-Location
        
        Write-Host "[INFO] Compilando motor de WhatsApp con ncc..." -ForegroundColor Cyan
        Write-Host ""
        
        $result = & node $bundleMjs 2>&1
        $output = $result | Out-String
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] Fallo la compilacion del motor:" -ForegroundColor Red
            Write-Host $output -ForegroundColor Red
            Read-Host "Presione Enter para continuar..."
            return
        }
        
        Write-Host ""
        Write-Host $output -ForegroundColor Green
        Write-Host "[OK] Motor de WhatsApp compilado exitosamente!" -ForegroundColor Green
        
        $bundleDir = Join-Path $ScriptDir "src-tauri\resources\whatsapp-engine-bundle"
        if (Test-Path $bundleDir) {
            $bundleSize = "{0:N2} MB" -f ((Get-ChildItem -Path $bundleDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB)
            Write-Host "  Bundle generado en: $bundleDir" -ForegroundColor Cyan
            Write-Host "  Tamano total del bundle: $bundleSize" -ForegroundColor Cyan
        }
        
        Write-Host ""
        Read-Host "Presione Enter para continuar..."
    }

    function New-GitIgnore {
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "CREAR .gitignore PARA RUST/TAURI" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Se ignoraran archivos de compilacion, dependencias, caches"
        Write-Host "y archivos del sistema/IDE."
        Write-Host "Se conservara codigo fuente, configuraciones y assets."
        Write-Host ""
        
        $confirm = Read-Host "¿Crear/sobrescribir .gitignore? (s/n)"
        if ($confirm -ne "s" -and $confirm -ne "S") {
            Write-Host "[INFO] Operacion cancelada."
            Read-Host "Presione Enter para continuar..."
            return
        }
        
        $gitignorePath = Join-Path $ScriptDir ".gitignore"
        
        @"
# ============================================
# .gitignore para Rust/Tauri + Windows/Android
# ============================================

# --- Rust / Cargo (build artifacts, muy pesados) ---
src-tauri/target/

# --- Node.js ---
node_modules/

# --- Vite cache ---
node_modules/.vite

# --- Frontend build output ---
dist/
build/

# --- Android nativo (auto-generado por 'npx tauri android init') ---
# Ignorar todo src-tauri/gen/ porque es regenerable desde cero
src-tauri/gen/
src-tauri/gen/android/
src-tauri/gen/schemas/

# --- Sistema operativo ---
.DS_Store
Thumbs.db
Desktop.ini
*.swp
*.swo
*~

# --- IDE ---
.vscode/
.idea/
*.sublime-project
*.sublime-workspace

# --- Variables de entorno (pueden contener keys) ---
.env
.env.local
.env.*.local

# --- Logs ---
*.log
"@ | Out-File -FilePath $gitignorePath -Encoding utf8 -Force
        
        Write-Host ""
        Write-Host "[OK] .gitignore creado exitosamente!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Archivos PRESERVADOS en git (esenciales para compilar):" -ForegroundColor Cyan
        Write-Host "  - src/ (codigo frontend)"
        Write-Host "  - src-tauri/src/ (codigo Rust)"
        Write-Host "  - src-tauri/Cargo.toml + Cargo.lock"
        Write-Host "  - src-tauri/tauri.conf.json"
        Write-Host "  - src-tauri/icons/"
        Write-Host "  - src-tauri/capabilities/"
        Write-Host "  - src-tauri/build.rs"
        Write-Host "  - package.json + package-lock.json"
        Write-Host "  - tsconfig.json, vite.config.ts"
        Write-Host "  - index.html, public/"
        Write-Host ""
        Write-Host "Para compilar en maquina nueva:" -ForegroundColor Yellow
        Write-Host "  1. git clone <repo>"
        Write-Host "  2. npm install"
        Write-Host "  3. npx tauri android init (solo si compilas para Android)"
        Write-Host "  4. npm run tauri dev (Windows) / tauri android dev (Android)"
        Write-Host ""
        Read-Host "Presione Enter para continuar..."
    }

    # Main Loop
    while ($true) {
        Show-Menu
        $modo = Read-Host "Seleccione una opcion (1-12)"
        
        switch ($modo) {
            "1" { Invoke-WindowsDev }
            "2" { Invoke-AndroidDevBase -allArchs $false }
            "3" { Invoke-WindowsBuild }
            "4" { Invoke-AndroidBuildArm64 }
            "5" { Invoke-AndroidBuildAll }
            "6" { Clear-AppCache }
            "7" { Get-AndroidLogs }
            "8" { Invoke-AndroidSigner }
            "9" { Invoke-CleanProject }
            "10" { New-GitIgnore }
            "11" { Manage-Keystore }
            "12" { Invoke-WhatsAppEngineBuild }
            "13" { break }
            default {
                # Let the loop clear the screen and show menu again
            }
        }
    }

} catch {
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host "   ERROR CRITICO AL EJECUTAR EL SCRIPT!" -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    Write-Host $_.ScriptStackTrace -ForegroundColor Gray
    Write-Host ""
    Read-Host "Presione Enter para cerrar la ventana..."
}
