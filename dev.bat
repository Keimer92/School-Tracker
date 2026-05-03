@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

echo.
echo ==============================================
echo GESTOR DE DESARROLLO - TAURI/RUST
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
echo GESTOR DE DESARROLLO - TAURI/RUST
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

REM Usar variables de entorno ANDROID_HOME y ANDROID_SDK_ROOT
if "%ANDROID_HOME%"=="" (
    echo [ERROR] ANDROID_HOME no esta configurada.
    echo Configura: setx ANDROID_HOME "C:\Users\Admin\Android"
    echo.
    pause
    cls
    goto menu
)

set "ANDROID_SDK=%ANDROID_HOME%"
set "ADB_PATH=%ANDROID_HOME%\platform-tools\adb.exe"
set "EMULATOR_PATH=%ANDROID_HOME%\emulator\emulator.exe"
set "ANDROID_NDK_HOME=%ANDROID_HOME%\ndk\27.0.12077973"

REM Configurar variables para Tauri/Android
setx ANDROID_NDK_HOME "%ANDROID_NDK_HOME%" >nul 2>&1

echo [OK] ANDROID_HOME: %ANDROID_SDK%

REM Verificar si NDK esta completamente instalada
set "NDK_VALID=0"
if exist "%ANDROID_NDK_HOME%\source.properties" set "NDK_VALID=1"
if exist "%ANDROID_NDK_HOME%\toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe" set "NDK_VALID=1"

if "%NDK_VALID%"=="0" (
    echo [INFO] NDK no encontrada o incompleta. Instalando...
    echo [INFO] Esto puede tomar varios minutos...
    echo y | call "%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" "ndk;27.0.12077973"
    echo [OK] NDK instalada
) else (
    echo [OK] NDK verificada: %ANDROID_NDK_HOME%
)

if not exist "%EMULATOR_PATH%" (
    echo [ERROR] El archivo del emulador no existe: %EMULATOR_PATH%
    echo.
    pause
    cls
    goto menu
)

echo.
echo [INFO] Emuladores disponibles:
echo ==============================================
set "emu_count=0"
for /f "delims=" %%a in ('"%EMULATOR_PATH%" -list-avds 2^nul') do (
    set /a emu_count+=1
    echo    !emu_count!. %%a
)
echo ==============================================
if %emu_count%==0 (
    echo [ERROR] No hay emuladores. Crea uno en Android Studio.
    echo.
    pause
    cls
    goto menu
)

echo.
set /p avd_select="Selecciona el numero del emulador (1-%emu_count%): "

if "%avd_select%"=="" (
    echo [ERROR] Debes ingresar un numero.
    echo.
    pause
    cls
    goto menu
)

if %avd_select% GTR %emu_count% (
    echo [ERROR] Numero invalido.
    echo.
    pause
    cls
    goto menu
)

set "avd_name="
set "current=0"
for /f "delims=" %%a in ('"%EMULATOR_PATH%" -list-avds 2^nul') do (
    set /a current+=1
    if !current! EQU %avd_select% set "avd_name=%%a"
)

if "%avd_name%"=="" (
    echo [ERROR] No se pudo obtener el nombre del emulador.
    echo.
    pause
    cls
    goto menu
)

echo.
echo [INFO] Iniciando emulador '%avd_name%'...

REM Crear script temporal para ejecutar el emulador
set "temp_script=%TEMP%\run_emulator_%RANDOM%.bat"
echo @echo off > "%temp_script%"
echo "%EMULATOR_PATH%" -avd "%avd_name%" -no-audio -no-snapshot-load >> "%temp_script%"
echo pause >> "%temp_script%"

REM Iniciar emulador en ventana separada
start "Emulador Android" "%temp_script%"

echo [INFO] Ventana del emulador abierta. Revisa si hay errores alli.
echo [INFO] Esperando 10 segundos para verificar si inicia...
timeout /t 10 /nobreak >nul

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
echo [INFO] Ejecutando npm run tauri android dev...
echo.
echo [INFO] IMPORTANTE: Si se abre una ventana pidiendo instalar NDK, presiona 'n' y Enter
echo.

REM Crear script temporal para ejecutar Tauri
set "tauri_script=%TEMP%\run_tauri_%RANDOM%.bat"
echo @echo off > "%tauri_script%"
echo chcp 65001 >nul >> "%tauri_script%"
echo call npm run tauri android dev >> "%tauri_script%"
echo echo %%ERRORLEVEL%% > "%TEMP%\tauri_result.txt" >> "%tauri_script%"
echo pause >> "%tauri_script%"

REM Ejecutar Tauri en ventana separada para ver errores
start "Tauri Android Dev" "%tauri_script%"

echo [INFO] Proceso de Tauri iniciado en ventana separada.
echo [INFO] Revisa la ventana "Tauri Android Dev" para ver el progreso.
echo.
pause
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
