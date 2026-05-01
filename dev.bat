@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

echo.
echo ==============================================
echo    GESTOR DE DESARROLLO - TAURI/RUST
echo ==============================================
echo.

REM ==============================================
REM VERIFICAR DEPENDENCIAS
REM ==============================================

echo [INFO] Verificando dependencias...

REM Verificar Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js no encontrado.
    echo Descarga desde: https://nodejs.org
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js encontrado

REM Verificar npm
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm no encontrado.
    pause
    exit /b 1
)
echo [OK] npm encontrado

REM Verificar Rust
where cargo >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Rust no encontrado.
    echo Instala desde: https://rustup.rs
    echo.
    pause
    exit /b 1
)
echo [OK] Rust encontrado

REM Verificar si node_modules existe
if not exist "%SCRIPT_DIR%node_modules" (
    echo.
    echo [INFO] Instalando dependencias de Node.js...
    echo [INFO] Esto puede tomar varios minutos...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Fallo al instalar dependencias de Node.
        pause
        exit /b 1
    )
    echo [OK] Dependencias de Node instaladas
) else (
    echo [OK] Dependencias de Node ya instaladas
)



echo.
echo [OK] Todas las dependencias verificadas.
echo ==============================================
echo.

goto menu

:menu
cls
echo ==============================================
echo    GESTOR DE DESARROLLO - TAURI/RUST
echo ==============================================
echo.
echo 1. Windows (Desarrollo)
echo 2. Android (Desarrollo)
echo 3. Windows Build (Release)
echo 4. Android Build (Release)
echo 5. Salir
echo ==============================================
echo.

set /p modo="Seleccione una opcion: "

if "%modo%"=="5" goto exit_script

if "%modo%"=="1" goto windows_dev
if "%modo%"=="2" goto android_dev
if "%modo%"=="3" goto windows_build
if "%modo%"=="4" goto android_build

echo.
echo [ERROR] Opcion invalida.
echo.
cls
goto menu

:windows_dev
echo.
echo [INFO] Iniciando desarrollo en Windows...
echo [INFO] Presiona Ctrl+C para detener...
echo.
npm run tauri dev
echo.
echo [OK] Proceso de desarrollo finalizado.
cls
goto menu

:android_dev
echo.
echo [INFO] Iniciando desarrollo en Android...
echo.

REM Buscar Android SDK en PATH
where adb >nul 2>nul
if %ERRORLEVEL%==0 (
    for /f "delims=" %%i in ('where adb') do set "ADB_PATH=%%i"
    for %%i in ("%ADB_PATH%") do set "ANDROID_SDK=%%~dpi\..\.."
    echo [OK] ANDROID_HOME: !ANDROID_SDK!
) else (
    echo [ERROR] No se encontro adb.exe en el PATH.
    echo Instala Android SDK y agregalo al PATH.
    echo.
    pause
    cls
    goto menu
)

set "EMULATOR_PATH=%ANDROID_SDK%\emulator\emulator.exe"
set "ADB_PATH=%ANDROID_SDK%\platform-tools\adb.exe"

if not exist "%EMULATOR_PATH%" (
    echo [ERROR] No se encontro el emulador: %EMULATOR_PATH%
    echo.
    pause
    cls
    goto menu
)

echo.
echo [INFO] Buscando emuladores...
"%EMULATOR_PATH%" -list-avds 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] No hay emuladores. Crea uno en Android Studio.
    echo.
    pause
    cls
    goto menu
)

echo.
set /p avd_name="Ingresa el nombre del emulador: "

if "%avd_name%"=="" (
    echo [ERROR] Debes ingresar un nombre.
    echo.
    cls
    goto menu
)

echo.
echo [INFO] Iniciando emulador '%avd_name%'...
start "" "%EMULATOR_PATH%" -avd "%avd_name%" -no-audio -no-snapshot-load

echo [INFO] Esperando emulador...
set "timeout_count=0"
:wait_emulator
timeout /t 3 /nobreak >nul
"%ADB_PATH%" devices | findstr "emulator-" >nul
if %ERRORLEVEL%==0 goto emulator_ready
set /a timeout_count+=1
if %timeout_count% LSS 30 goto wait_emulator

echo [ERROR] Timeout esperando el emulador.
echo.
pause
cls
goto menu

:emulator_ready
echo [OK] Emulador listo!
echo.
echo [INFO] Compilando e instalando en Android...
npm run tauri android dev

if %ERRORLEVEL%==0 (
    echo.
    echo [OK] Proceso completado!
) else (
    echo.
    echo [ERROR] Fallo la compilacion.
)
cls
goto menu

:windows_build
echo.
echo [INFO] Compilando para Windows (Release)...
npm run tauri build

if %ERRORLEVEL%==0 (
    echo.
    echo [OK] Compilacion exitosa!
    echo Revisa la carpeta: src-tauri\target\release
) else (
    echo.
    echo [ERROR] Fallo la compilacion.
)
cls
goto menu

:android_build
echo.
echo [INFO] Compilando para Android (Release)...
npm run tauri android build

if %ERRORLEVEL%==0 (
    echo.
    echo [OK] Compilacion exitosa!
    echo Revisa la carpeta: src-tauri\target\release\android
) else (
    echo.
    echo [ERROR] Fallo la compilacion.
)
cls
goto menu

:exit_script
echo.
echo Saliendo...
exit /b 0