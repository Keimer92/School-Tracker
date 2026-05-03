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
echo 2. Android (Desarrollo)
echo 3. Windows Build (Release)
echo 4. Android Build (Release)
echo.
echo === GESTOR DE EMULADORES ===
echo 5. Ver emuladores/dispositivos
echo 6. Crear nuevo emulador
echo 7. Eliminar emulador
echo 8. Iniciar emulador (sin app)
echo.
echo === MANTENIMIENTO ===
echo 9. Limpiar cach? y dependencias
echo 10. Salir
echo ==============================================
echo.

set /p modo="Seleccione una opcion: "
if "%modo%"=="10" goto exit_script
if "%modo%"=="1" goto windows_dev
if "%modo%"=="2" goto android_dev
if "%modo%"=="3" goto windows_build
if "%modo%"=="4" goto android_build
if "%modo%"=="5" goto view_emulators
if "%modo%"=="6" goto create_emulator
if "%modo%"=="7" goto delete_emulator
if "%modo%"=="8" goto start_emulator
if "%modo%"=="9" goto clean_cache
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

:windows_dev
set "f=%TEMP%\tw_%RANDOM%.bat"
echo @echo off^&^&chcp 65001^&^&call npm run tauri dev^&^&pause>"%f%"
start "Tauri Windows" "%f%"
cls
goto menu

:android_dev
echo.
echo [INFO] Iniciando Android...
if "%ANDROID_HOME%"=="" (echo [ERROR] ANDROID_HOME no configurada.&pause&cls&goto menu)
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
REM DETECTAR DISPOSITIVOS - VERSION SIMPLIFICADA
REM ==============================================
echo.
echo [INFO] Buscando dispositivos...

REM Crear archivo temporal con lista de dispositivos
"%ADB_PATH%" devices -l 2>nul > "%TEMP%\dev_list.txt"

REM Mostrar dispositivos
echo.
echo ==============================================
echo DISPOSITIVOS DISPONIBLES:
echo ==============================================
type "%TEMP%\dev_list.txt"
echo ==============================================
echo.

REM Contar l?neas (descontando header)
set "cnt=0"
for /f "skip=1 delims=" %%a in ('type "%TEMP%\dev_list.txt"') do (
    set /a cnt+=1
    set "dev_!cnt!=%%a"
    echo   !cnt!. %%a
)

if %cnt%==0 (
    echo [ERROR] No hay dispositivos.
    echo   - Conecta USB con depuracion
    echo   - O usa opcion 8 para emulador
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
echo [INFO] Ejecutando app...

REM Ejecutar en ventana separada
set "f=%TEMP%\ta_%RANDOM%.bat"
echo @echo off^&^&chcp 65001^&^&call npm run tauri android dev^&^&pause>"%f%"
start "Tauri Android" "%f%"

cls
goto menu

:windows_build
set "f=%TEMP%\wb_%RANDOM%.bat"
echo @echo off^&^&chcp 65001^&^&call npm run tauri build^&^&pause>"%f%"
start "Windows Build" "%f%"
pause
cls
goto menu

:android_build
set "f=%TEMP%\ab_%RANDOM%.bat"
echo @echo off^&^&chcp 65001^&^&call npm run tauri android build^&^&pause>"%f%"
start "Android Build" "%f%"
pause
cls
goto menu

:exit_script
exit /b 0
