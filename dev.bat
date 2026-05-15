@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "ANDROID_HOME=%ANDROID_HOME%"
set "EMULATOR_PATH=%ANDROID_HOME%\emulator\emulator.exe"
set "ADB_PATH=%ANDROID_HOME%\platform-tools\adb.exe"
set "AVDMANAGER=%ANDROID_HOME%\cmdline-tools\latest\bin\avdmanager.bat"
set "SDKMANAGER=%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat"

goto menu

:menu
cls
echo ==============================================
echo GESTOR DE DESARROLLO - TAURI/RUST
echo ==============================================
echo.
echo === DESARROLLO ===
echo 1. Windows (Desarrollo)
echo 2. Android (Desarrollo - Compila todo)
echo 3. Android (Hot Reload - rapido, requiere servidor)
echo 4. Windows Build (Release)
echo 5. Android Build (Release)
echo.
echo === GESTOR DE EMULADORES ===
echo 6. Ver emuladores/dispositivos
echo 7. Crear nuevo emulador
echo 8. Eliminar emulador
echo 9. Iniciar emulador (sin app)
echo 10. Conectar ADB por WiFi
echo.
echo === MANTENIMIENTO ===
echo 11. Limpiar cache y dependencias
echo 12. Depurar Android (Chrome Inspect)
echo 13. Salir
echo ==============================================
echo.

set /p modo="Seleccione una opcion: "
if "%modo%"=="13" goto exit_script
if "%modo%"=="1" goto windows_dev
if "%modo%"=="2" goto android_dev
if "%modo%"=="3" goto android_hot_reload
if "%modo%"=="4" goto windows_build
if "%modo%"=="5" goto android_build
if "%modo%"=="6" goto view_emulators
if "%modo%"=="7" goto create_emulator
if "%modo%"=="8" goto delete_emulator
if "%modo%"=="9" goto start_emulator
if "%modo%"=="10" goto adb_wifi
if "%modo%"=="11" goto clean_cache
if "%modo%"=="12" goto android_logs
cls
goto menu

:clean_cache
echo.
echo ==============================================
echo LIMPIEZA DE CACHE Y DEPENDENCIAS
echo ==============================================
if exist "%SCRIPT_DIR%node_modules\.vite" (rmdir /s /q "%SCRIPT_DIR%node_modules\.vite")
if exist "%SCRIPT_DIR%src-tauri\target" (rmdir /s /q "%SCRIPT_DIR%src-tauri\target")
if exist "%SCRIPT_DIR%src-tauri\gen\android\app\build" (rmdir /s /q "%SCRIPT_DIR%src-tauri\gen\android\app\build")
if exist "%SCRIPT_DIR%dist" (rmdir /s /q "%SCRIPT_DIR%dist")
call npm cache clean
cd "%SCRIPT_DIR%src-tauri" && call cargo clean
cd "%SCRIPT_DIR%"
echo [OK] Limpieza completada!
pause
cls
goto menu

:view_emulators
cls
echo ==============================================
echo DISPOSITIVOS Y EMULADORES
echo ==============================================
echo.
echo --- Dispositivos conectados ---
"%ADB_PATH%" devices -l
echo.
echo --- Emuladores instalados ---
"%EMULATOR_PATH%" -list-avds
echo.
pause
cls
goto menu

:create_emulator
cls
echo ==============================================
echo CREAR NUEVO EMULADOR
echo ==============================================
echo 1. Android 12 (API 31) - x86_64 [RECOMENDADO]
echo 2. Android 13 (API 33) - x86_64
echo 3. Android 14 (API 34) - x86_64
echo.
set /p v="Version (1-3): "
if "%v%"=="" goto create_emulator
if "%v%"=="1" set "api=31"
if "%v%"=="2" set "api=33"
if "%v%"=="3" set "api=34"
set /p n="Nombre (ej: android%api%): "
if "%n%"=="" set "n=android%api%"
echo y | "%SDKMANAGER%" "system-images;android-%api%;google_apis;x86_64"
"%AVDMANAGER%" create avd -n "%n%" -k "system-images;android-%api%;google_apis;x86_64"
echo [OK] Creado!
pause
cls
goto menu

:delete_emulator
cls
echo ==============================================
echo ELIMINAR EMULADOR
echo ==============================================
"%EMULATOR_PATH%" -list-avds
echo.
set /p n="Nombre a eliminar: "
if not "%n%"=="" "%AVDMANAGER%" delete avd -n "%n%"
pause
cls
goto menu

:start_emulator
cls
echo ==============================================
echo INICIAR EMULADOR
echo ==============================================
"%EMULATOR_PATH%" -list-avds
echo.
set /p n="Nombre del emulador: "
if not "%n%"=="" (
    start "Emulador" cmd /k "\"%EMULATOR_PATH%\" -avd %n%"
)
pause
cls
goto menu

:adb_wifi
cls
echo ==============================================
echo CONECTAR ADB POR WIFI
echo ==============================================
echo.
echo [INFO] Conectando dispositivo por USB primero...
echo [INFO] Ejecuta: adb tcpip 5555
echo.
"%ADB_PATH%" tcpip 5555
echo.
set /p ip="Ingresa IP del dispositivo (ej: 192.168.1.X): "
if not "%ip%"=="" (
    echo [INFO] Conectando a %ip%:5555...
    "%ADB_PATH%" connect %ip%:5555
)
echo.
pause
cls
goto menu

:windows_dev
echo.
echo [INFO] Iniciando desarrollo en Windows...
echo [INFO] Servidor: http://localhost:1420
echo.
start "Tauri Windows" cmd /k "cd /d %SCRIPT_DIR% && npm run tauri dev"
cls
goto menu

:android_dev
echo.
echo [INFO] Iniciando desarrollo en Android...
echo.
if "%ANDROID_HOME%"=="" (echo [ERROR] ANDROID_HOME no configurada.&pause&cls&goto menu)

echo [INFO] Limpiando locks de compilaci?n...
if exist "%SCRIPT_DIR%src-tauri\target\.cargo-lock" del /q "%SCRIPT_DIR%src-tauri\target\.cargo-lock" 2>nul
if exist "%SCRIPT_DIR%src-tauri\gen\android\app\build\.gradle" rmdir /s /q "%SCRIPT_DIR%src-tauri\gen\android\app\build\.gradle" 2>nul
taskkill /F /IM java.exe /T 2>nul

setx ANDROID_NDK_HOME "%ANDROID_HOME%\ndk\27.0.12077973" >nul 2>&1

REM Verificar NDK
if not exist "%ANDROID_HOME%\ndk\27.0.12077973\source.properties" (
    echo [INFO] Instalando NDK...
    echo y | "%SDKMANAGER%" "ndk;27.0.12077973"
)

REM Verificar proyecto
if not exist "%SCRIPT_DIR%src-tauri\gen\android" (
    echo [INFO] Inicializando proyecto...
    call npm run tauri android init
)

REM Verificar targets
rustup target list --installed | findstr "android" >nul 2>nul
if %ERRORLEVEL% neq 0 rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

REM ==============================================
REM DETECTAR DISPOSITIVOS
REM ==============================================
echo.
echo [INFO] Buscando dispositivos...
"%ADB_PATH%" devices -l 2>nul > "%TEMP%\dev_list.txt"

echo.
echo ==============================================
echo DISPOSITIVOS DISPONIBLES:
echo ==============================================
type "%TEMP%\dev_list.txt"
echo ==============================================

set "cnt=0"
for /f "skip=1 delims=" %%a in ('type "%TEMP%\dev_list.txt"') do (
    set /a cnt+=1
    set "dev_!cnt!=%%a"
    echo   !cnt!. %%a
)

if %cnt%==0 (
    echo.
    echo [ERROR] No hay dispositivos.
    echo   - Conecta USB con depuracion activada
    echo   - O usa opcion 9 para conectar por WiFi
    echo   - O usa opcion 8 para iniciar emulador
    echo.
    pause
    cls
    goto menu
)

echo.
set /p sel="Selecciona dispositivo (1-%cnt%): "
if "%sel%"=="" goto android_dev

set "selected=%dev_%sel%%"
if "%selected%"=="" goto android_dev

echo [OK] Seleccionado: %selected%
echo.

REM Obtener IP de la PC
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    set "pc_ip=%%a"
    set "pc_ip=!pc_ip: =!"
)

echo ==============================================
echo [INFO] IMPORTANTE PARA DISPOSITIVO FISICO:
echo ==============================================
echo 1. Asegurate que el firewall permita el puerto 1420
echo 2. La PC y el dispositivo deben estar en la misma red
echo 3. IP de tu PC: %pc_ip%
echo 4. Si falla, ejecuta en PowerShell:
echo    New-NetFirewallRule -DisplayName "Vite Dev" -Direction Inbound -LocalPort 1420 -Protocol TCP -Action Allow
echo ==============================================
echo.

echo [INFO] Iniciando servidor Vite e Android...
start "Vite Dev Server" cmd /k "cd /d %SCRIPT_DIR% && npm run dev"
timeout /t 5 /nobreak >nul
start "Tauri Android" cmd /k "cd /d %SCRIPT_DIR% && npx tauri android dev"

cls
goto menu

:windows_build
echo.
echo [INFO] Compilando Windows (Release)...
start "Windows Build" cmd /k "cd /d %SCRIPT_DIR% && npm run tauri build"
pause
cls
goto menu

:android_build
echo.
echo [INFO] Compilando Android (Release)...
start "Android Build" cmd /k "cd /d %SCRIPT_DIR% && npm run tauri android build"
pause
cls
goto menu

:android_hot_reload
echo.
echo [INFO] Android Hot Reload (Rapido)
echo.
if "%ANDROID_HOME%"=="" (echo [ERROR] ANDROID_HOME no configurada.&pause&cls&goto menu)

echo [INFO] Limpiando locks de compilaci?n...
if exist "%SCRIPT_DIR%src-tauri\target\.cargo-lock" del /q "%SCRIPT_DIR%src-tauri\target\.cargo-lock" 2>nul
if exist "%SCRIPT_DIR%src-tauri\gen\android\app\build\.gradle" rmdir /s /q "%SCRIPT_DIR%src-tauri\gen\android\app\build\.gradle" 2>nul
taskkill /F /IM java.exe /T 2>nul

echo [INFO] Iniciando Tauri Android (servidor se iniciara automaticamente)...
start "Tauri Android" cmd /k "cd /d %SCRIPT_DIR% && npx tauri android dev"

cls
goto menu

:android_logs
cls
echo ==============================================
echo DEPURADOR DE CHROME (Android)
echo ==============================================
echo [INFO] La URL 'chrome://inspect/#devices' ha sido copiada al portapapeles.
echo [INFO] 1. Abre Chrome (o Edge).
echo [INFO] 2. Pega la URL en la barra de direcciones (Ctrl+V).
echo [INFO] 3. Haz clic en 'inspect' bajo tu dispositivo.
echo.
powershell -Command "Set-Clipboard 'chrome://inspect/#devices'"
start chrome
pause
cls
goto menu

:exit_script
exit /b 0
