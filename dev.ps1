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
        $EmulatorPath = Join-Path $env:ANDROID_HOME "emulator\emulator.exe"
        $AdbPath = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
        $AvdManager = Join-Path $env:ANDROID_HOME "cmdline-tools\latest\bin\avdmanager.bat"
        $SdkManager = Join-Path $env:ANDROID_HOME "cmdline-tools\latest\bin\sdkmanager.bat"
    } else {
        $EmulatorPath = ""
        $AdbPath = ""
        $AvdManager = ""
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
        Write-Host "   2. Android (Desarrollo - Compila todo)"
        Write-Host "   3. Android (Hot Reload - Rapido, requiere servidor)"
        Write-Host "   4. Windows Build (Release)"
        Write-Host "   5. Android Build (Release)"
        Write-Host ""
        Write-Host " === GESTOR DE EMULADORES ===" -ForegroundColor Yellow
        Write-Host "   6. Ver emuladores / dispositivos"
        Write-Host "   7. Crear nuevo emulador"
        Write-Host "   8. Eliminar emulador"
        Write-Host "   9. Iniciar emulador (sin app)"
        Write-Host "  10. Conectar ADB por WiFi"
        Write-Host ""
        Write-Host " === MANTENIMIENTO ===" -ForegroundColor Yellow
        Write-Host "  11. Limpiar cache y dependencias"
        Write-Host "  12. Depurar Android (Chrome Inspect)"
        Write-Host "  13. Configurar firmas Android (Release)"
        Write-Host ""
        Write-Host " === OTROS ===" -ForegroundColor Yellow
        Write-Host "  14. Crear .gitignore para Rust/Tauri"
        Write-Host "  15. Salir"
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
        Write-Host ""
        Write-Host "[INFO] Iniciando desarrollo en Windows..." -ForegroundColor Cyan
        Write-Host "[INFO] Servidor: http://localhost:1420" -ForegroundColor Cyan
        Write-Host ""
        $cmd = "`$host.UI.RawUI.WindowTitle = 'Tauri Windows (Dev)'; Set-Location '$ScriptDir'; npm run tauri dev"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
    }

    function Select-AndroidArchitecture {
        Write-Host ""
        Write-Host "Selecciona arquitectura de compilacion:" -ForegroundColor Yellow
        Write-Host "  1. Todas las arquitecturas (arm64 + arm7 + x86 + x86_64) [mas lento]"
        Write-Host "  2. Solo arm64 (mas rapido)"
        Write-Host ""
        $archSel = Read-Host "Arquitectura (1-2)"
        
        # Limpiar env vars anteriores
        Remove-Item Env:ORG_GRADLE_PROJECT_abiList -ErrorAction SilentlyContinue
        Remove-Item Env:ORG_GRADLE_PROJECT_archList -ErrorAction SilentlyContinue
        Remove-Item Env:ORG_GRADLE_PROJECT_targetList -ErrorAction SilentlyContinue
        
        if ($archSel -eq "2") {
            Write-Host "[INFO] Compilando solo arm64..." -ForegroundColor Cyan
            $env:ORG_GRADLE_PROJECT_abiList = "arm64-v8a"
            $env:ORG_GRADLE_PROJECT_archList = "arm64"
            $env:ORG_GRADLE_PROJECT_targetList = "aarch64"
        } else {
            Write-Host "[INFO] Compilando para todas las arquitecturas..." -ForegroundColor Cyan
        }
        Write-Host ""
    }

    function Invoke-AndroidDev {
        if (-not (Assert-AndroidSdk)) { return }
        
        Select-AndroidArchitecture
        
        Write-Host ""
        Write-Host "[INFO] Iniciando desarrollo en Android..." -ForegroundColor Cyan
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
        
        # Verificar NDK
        $ndkProps = Join-Path $ndkPath "source.properties"
        if (-not (Test-Path $ndkProps)) {
            Write-Host "[INFO] Instalando NDK..." -ForegroundColor Cyan
            @("y", "y", "y", "y", "y", "y", "y") | & $SdkManager --licenses > $null 2>&1
            "y" | & $SdkManager "ndk;27.0.12077973"
        }
        
        # Verificar proyecto
        $genAndroid = Join-Path $ScriptDir "src-tauri\gen\android"
        if (-not (Test-Path $genAndroid)) {
            Write-Host "[INFO] Inicializando proyecto..." -ForegroundColor Cyan
            npm run tauri android init
        }
        
        # Verificar targets
        $installedTargets = rustup target list --installed
        $hasAndroidTarget = $installedTargets | Out-String -Stream | Select-String "android"
        if (-not $hasAndroidTarget) {
            Write-Host "[INFO] Instalando targets de Rust para Android..." -ForegroundColor Cyan
            rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
        }
        
        # DETECTAR DISPOSITIVOS
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
            Write-Host "[ERROR] No hay dispositivos conectados." -ForegroundColor Red
            Write-Host "  - Conecta USB con depuracion activada"
            Write-Host "  - O usa la opcion 10 para conectar por WiFi"
            Write-Host "  - O usa la opcion 9 para iniciar un emulador"
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
        if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt $devices.Count) {
            return
        }
        
        $selected = $devices[$idx - 1]
        Write-Host "[OK] Seleccionado: $selected" -ForegroundColor Green
        Write-Host ""
        
        # Obtener IP de la PC
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

    function Invoke-AndroidHotReload {
        if (-not (Assert-AndroidSdk)) { return }
        
        Select-AndroidArchitecture
        
        Write-Host ""
        Write-Host "[INFO] Android Hot Reload (Rapido)..." -ForegroundColor Cyan
        Write-Host ""
        
        Write-Host "[INFO] Limpiando locks de compilacion..." -ForegroundColor Cyan
        $cargoLock = Join-Path $ScriptDir "src-tauri\target\.cargo-lock"
        if (Test-Path $cargoLock) { Remove-Item -Force $cargoLock -ErrorAction SilentlyContinue }
        
        $gradleDir = Join-Path $ScriptDir "src-tauri\gen\android\app\build\.gradle"
        if (Test-Path $gradleDir) { Remove-Item -Recurse -Force $gradleDir -ErrorAction SilentlyContinue }
        
        Stop-Process -Name "java" -Force -ErrorAction SilentlyContinue
        
        Write-Host "[INFO] Iniciando Tauri Android..." -ForegroundColor Cyan
        $cmd = "`$host.UI.RawUI.WindowTitle = 'Tauri Android (Hot Reload)'; Set-Location '$ScriptDir'; npx tauri android dev"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
    }

    function Invoke-WindowsBuild {
        Write-Host ""
        Write-Host "[INFO] Compilando Windows (Release)..." -ForegroundColor Cyan
        $cmd = "`$host.UI.RawUI.WindowTitle = 'Windows Build (Release)'; Set-Location '$ScriptDir'; npm run tauri build"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
        Read-Host "Presione Enter para continuar..."
    }

    function Invoke-AndroidBuild {
        if (-not (Assert-AndroidSdk)) { return }
        
        Select-AndroidArchitecture
        
        Write-Host ""
        Write-Host "[INFO] Compilando Android (Release)..." -ForegroundColor Cyan
        $cmd = "`$host.UI.RawUI.WindowTitle = 'Android Build (Release)'; Set-Location '$ScriptDir'; npm run tauri android build"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd
        Read-Host "Presione Enter para continuar..."
    }

    function Get-AndroidEmulator {
        if (-not (Assert-AndroidSdk)) { return }
        
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "DISPOSITIVOS Y EMULADORES" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "--- Dispositivos conectados ---" -ForegroundColor Yellow
        & $AdbPath devices -l
        Write-Host ""
        Write-Host "--- Emuladores instalados ---" -ForegroundColor Yellow
        & $EmulatorPath -list-avds
        Write-Host ""
        Read-Host "Presione Enter para continuar..."
    }

    function New-AndroidEmulator {
        if (-not (Assert-AndroidSdk)) { return }
        
        while ($true) {
            Clear-Host
            Write-Host "==============================================" -ForegroundColor Cyan
            Write-Host "CREAR NUEVO EMULADOR" -ForegroundColor Yellow
            Write-Host "==============================================" -ForegroundColor Cyan
            Write-Host "1. Android 12 (API 31) - x86_64 [RECOMENDADO]"
            Write-Host "2. Android 13 (API 33) - x86_64"
            Write-Host "3. Android 14 (API 34) - x86_64"
            Write-Host ""
            $v = Read-Host "Version (1-3)"
            if ($v -eq "1") { $api = "31"; break }
            elseif ($v -eq "2") { $api = "33"; break }
            elseif ($v -eq "3") { $api = "34"; break }
        }
        
        $n = Read-Host "Nombre (ej: android$api)"
        if ([string]::IsNullOrWhiteSpace($n)) { $n = "android$api" }
        
        Write-Host "[INFO] Aceptando todas las licencias del SDK de Android..." -ForegroundColor Cyan
        @("y", "y", "y", "y", "y", "y", "y", "y", "y", "y") | & $SdkManager --licenses > $null 2>&1
        
        Write-Host "[INFO] Descargando imagen de sistema para API $api (esto puede tardar unos minutos)..." -ForegroundColor Cyan
        & $SdkManager "system-images;android-$api;google_apis;x86_64"
        
        Write-Host ""
        Write-Host "[INFO] Creando emulador virtual (AVD)..." -ForegroundColor Cyan
        "no" | & $AvdManager create avd -n $n -k "system-images;android-$api;google_apis;x86_64" --force
        
        Write-Host ""
        Write-Host "[OK] Emulador `"$n`" creado exitosamente!" -ForegroundColor Green
        Read-Host "Presione Enter para continuar..."
    }

    function Remove-AndroidEmulator {
        if (-not (Assert-AndroidSdk)) { return }
        
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "ELIMINAR EMULADOR" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Buscando emuladores creados..."
        Write-Host ""
        
        $avds = & $EmulatorPath -list-avds 2>$null
        if ($null -eq $avds -or $avds.Count -eq 0 -or ($avds.Count -eq 1 -and [string]::IsNullOrWhiteSpace($avds[0]))) {
            Write-Host "[ERROR] No se encontraron emuladores para eliminar." -ForegroundColor Red
            Write-Host ""
            Read-Host "Presione Enter para continuar..."
            return
        }
        
        $avds = $avds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        
        for ($i = 0; $i -lt $avds.Count; $i++) {
            Write-Host "  $($i + 1). $($avds[$i])"
        }
        
        Write-Host ""
        $sel = Read-Host "Selecciona el numero a eliminar (1-$($avds.Count))"
        if ([string]::IsNullOrWhiteSpace($sel)) { return }
        
        [int]$idx = 0
        if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt $avds.Count) {
            Write-Host ""
            Write-Host "[ERROR] Seleccion invalida. Intentalo de nuevo." -ForegroundColor Red
            Read-Host "Presione Enter para continuar..."
            Remove-AndroidEmulator
            return
        }
        
        $selected = $avds[$idx - 1]
        
        Write-Host ""
        Write-Host "[WARNING] Estas a punto de eliminar el emulador `"$selected`"." -ForegroundColor Yellow
        $confirm = Read-Host "¿Estas seguro? (s/n)"
        if ($confirm -eq "s" -or $confirm -eq "S") {
            Write-Host "[INFO] Eliminando `"$selected`"..." -ForegroundColor Cyan
            & $AvdManager delete avd -n $selected
            Write-Host "[OK] Eliminado!" -ForegroundColor Green
        } else {
            Write-Host "[INFO] Operacion cancelada."
        }
        Read-Host "Presione Enter para continuar..."
    }

    function Start-AndroidEmulator {
        if (-not (Assert-AndroidSdk)) { return }
        
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "INICIAR EMULADOR" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Buscando emuladores creados..."
        Write-Host ""
        
        $avds = & $EmulatorPath -list-avds 2>$null
        if ($null -eq $avds -or $avds.Count -eq 0 -or ($avds.Count -eq 1 -and [string]::IsNullOrWhiteSpace($avds[0]))) {
            Write-Host "[ERROR] No se encontraron emuladores creados." -ForegroundColor Red
            Write-Host "Crea uno primero usando la opcion 7."
            Write-Host ""
            Read-Host "Presione Enter para continuar..."
            return
        }
        
        $avds = $avds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        
        for ($i = 0; $i -lt $avds.Count; $i++) {
            Write-Host "  $($i + 1). $($avds[$i])"
        }
        
        Write-Host ""
        $sel = Read-Host "Selecciona el numero de emulador (1-$($avds.Count))"
        if ([string]::IsNullOrWhiteSpace($sel)) { return }
        
        [int]$idx = 0
        if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt $avds.Count) {
            Write-Host ""
            Write-Host "[ERROR] Seleccion invalida. Intentalo de nuevo." -ForegroundColor Red
            Read-Host "Presione Enter para continuar..."
            Start-AndroidEmulator
            return
        }
        
        $selected = $avds[$idx - 1]
        
        Write-Host ""
        Write-Host "[INFO] Iniciando emulador `"$selected`" en segundo plano..." -ForegroundColor Cyan
        Start-Process -FilePath $EmulatorPath -ArgumentList "-avd", $selected -WindowStyle Minimized
        Write-Host "[OK] Iniciado!" -ForegroundColor Green
        Read-Host "Presione Enter para continuar..."
    }

    function Connect-AdbWifi {
        if (-not (Assert-AndroidSdk)) { return }
        
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "CONECTAR ADB POR WIFI" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "[INFO] Conectando dispositivo por USB primero..." -ForegroundColor Cyan
        Write-Host "[INFO] Ejecutando: adb tcpip 5555" -ForegroundColor Cyan
        Write-Host ""
        & $AdbPath tcpip 5555
        Write-Host ""
        $ip = Read-Host "Ingresa IP del dispositivo (ej: 192.168.1.X)"
        if (-not [string]::IsNullOrWhiteSpace($ip)) {
            Write-Host "[INFO] Conectando a $ip:5555..." -ForegroundColor Cyan
            & $AdbPath connect "$ip:5555"
        }
        Write-Host ""
        Read-Host "Presione Enter para continuar..."
    }

    function Clear-AppCache {
        Write-Host ""
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "LIMPIEZA DE CACHE Y DEPENDENCIAS" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        
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
        
        Write-Host "[OK] Limpieza completada!" -ForegroundColor Green
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

    function Invoke-AndroidSigner {
        Clear-Host
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host "CONFIGURAR FIRMAS ANDROID (RELEASE)" -ForegroundColor Yellow
        Write-Host "==============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Ejecutando Tauri Android Signer..." -ForegroundColor Cyan
        
        $commandExists = Get-Command tauri-android-signer -ErrorAction SilentlyContinue
        if ($commandExists) {
            & tauri-android-signer
        } else {
            Write-Host "[INFO] La herramienta no esta instalada globalmente. Compilando y ejecutando..." -ForegroundColor Yellow
            $cargoToml = Join-Path $ScriptDir "tauri-android-signer\Cargo.toml"
            cargo run --manifest-path $cargoToml
        }
        
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
        $modo = Read-Host "Seleccione una opcion (1-15)"
        
        switch ($modo) {
            "1" { Invoke-WindowsDev }
            "2" { Invoke-AndroidDev }
            "3" { Invoke-AndroidHotReload }
            "4" { Invoke-WindowsBuild }
            "5" { Invoke-AndroidBuild }
            "6" { Get-AndroidEmulator }
            "7" { New-AndroidEmulator }
            "8" { Remove-AndroidEmulator }
            "9" { Start-AndroidEmulator }
            "10" { Connect-AdbWifi }
            "11" { Clear-AppCache }
            "12" { Get-AndroidLogs }
            "13" { Invoke-AndroidSigner }
            "14" { New-GitIgnore }
            "15" { break }
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
