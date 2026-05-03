@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

echo.
echo ==============================================
echo GESTOR DE DESARROLLO - TAURI/RUST
echo ==============================================
echo.

echo [INFO] Verificando dependencias...

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js no encontrado.
    echo Descarga desde: https://nodejs.org
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js encontrado

where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm no encontrado.
    pause
    exit /b 1
)
echo [OK] npm encontrado

where cargo >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Rust no encontrado.
    echo Instala desde: https://rustup.rs
    echo.
    pause
    exit /b 1
)
echo [OK] Rust encontrado

if not exist "%SCRIPT_DIR%node_modules" (
    echo.
    echo [INFO] Instalando dependencias de Node.js...
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
echo 5. Limpiar cach? y dependencias
echo 6. Salir
echo ==============================================
echo.

set /p modo="Seleccione una opcion: "
if "%modo%"=="6" goto exit_script
if "%modo%"=="1" goto windows_dev
if "%modo%"=="2" goto android_dev
if "%modo%"=="3" goto windows_build
if "%modo%"=="4" goto android_build
if "%modo%"=="5" goto clean_cache
echo [ERROR] Opcion invalida.
cls
goto menu

:clean_cache
echo.
echo ==============================================
echo LIMPIEZA DE CACHE Y DEPENDENCIAS
echo ==============================================
echo.
echo [INFO] Eliminando carpetas...
echo.

if exist "%SCRIPT_DIR%node_modules\.vite" (
    echo [OK] Eliminando cache de Vite...
    rmdir /s /q "%SCRIPT_DIR%node_modules\.vite"
)

if exist "%SCRIPT_DIR%src-tauri\target" (
    echo [OK] Eliminando target de Rust...
    rmdir /s /q "%SCRIPT_DIR%src-tauri\target"
)

if exist "%SCRIPT_DIR%src-tauri\gen\android\app\build" (
    echo [OK] Eliminando build de Android...
    rmdir /s /q "%SCRIPT_DIR%src-tauri\gen\android\app\build"
)

if exist "%SCRIPT_DIR%dist" (
    echo [OK] Eliminando dist...
    rmdir /s /q "%SCRIPT_DIR%dist"
)

echo.
echo [INFO] Ejecutando npm cache clean...
call npm cache clean

echo.
echo [INFO] Ejecutando cargo clean...
cd "%SCRIPT_DIR%src-tauri"
call cargo clean
cd "%SCRIPT_DIR%"

echo.
echo ==============================================
echo [OK] Limpieza completada!
echo ==============================================
echo.
pause
cls
goto menu

:windows_dev
echo.
echo [INFO] Iniciando desarrollo en Windows...
echo.
set "win_script=%TEMP%\run_windows_%RANDOM%.bat"
echo @echo off > "%win_script%"
echo chcp 65001 >nul >> "%win_script%"
echo call npm run tauri dev >> "%win_script%"
echo pause >> "%win_script%"
start "Tauri Windows Dev" "%win_script%"
echo [INFO] Servidor de desarrollo iniciado en ventana separada.
echo [INFO] Revisa la ventana "Tauri Windows Dev" para ver el progreso.
echo.
pause
cls
goto menu

:android_dev
echo.
echo [INFO] Iniciando desarrollo en Android...
echo.
if "%ANDROID_HOME%"=="" (
    echo [ERROR] ANDROID_HOME no esta configurada.
    pause
    goto menu
)
set "ANDROID_SDK=%ANDROID_HOME%"
set "ADB_PATH=%ANDROID_HOME%\platform-tools\adb.exe"
set "EMULATOR_PATH=%ANDROID_HOME%\emulator\emulator.exe"
set "ANDROID_NDK_HOME=%ANDROID_HOME%\ndk\27.0.12077973"
setx ANDROID_NDK_HOME "%ANDROID_NDK_HOME%" >nul 2>&1
echo [OK] ANDROID_HOME: %ANDROID_SDK%
set "NDK_VALID=0"
if exist "%ANDROID_NDK_HOME%\source.properties" set "NDK_VALID=1"
if exist "%ANDROID_NDK_HOME%\toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe" set "NDK_VALID=1"
if "%NDK_VALID%"=="0" (
    echo [INFO] Instalando NDK...
    echo y | call "%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" "ndk;27.0.12077973"
) else (
    echo [OK] NDK verificada.
)
if not exist "%SCRIPT_DIR%src-tauri\gen\android" (
    echo [INFO] Inicializando proyecto Android...
    call npm run tauri android init
) else (
    echo [OK] Proyecto Android listo.
)
rustup target list --installed | findstr "android" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [INFO] Instalando targets de Rust...
    rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
)
echo.
echo [INFO] Emuladores disponibles:
set "emu_count=0"
for /f "delims=" %%a in ('"%EMULATOR_PATH%" -list-avds 2^nul') do (
    set /a emu_count+=1
    echo    !emu_count!. %%a
)
if %emu_count%==0 (
    echo [ERROR] No hay emuladores.
    pause
    goto menu
)
echo.
set /p avd_select="Selecciona el numero del emulador (1-%emu_count%): "
if "%avd_select%"=="" goto menu
set "avd_name="
set "current=0"
for /f "delims=" %%a in ('"%EMULATOR_PATH%" -list-avds 2^nul') do (
    set /a current+=1
    if !current! EQU %avd_select% set "avd_name=%%a"
)
echo [INFO] Iniciando emulador '%avd_name%'...
set "temp_script=%TEMP%\run_emu_%RANDOM%.bat"
echo @echo off > "%temp_script%"
echo "%EMULATOR_PATH%" -avd "%avd_name%" -no-audio >> "%temp_script%"
echo pause >> "%temp_script%"
start "Emulador" "%temp_script%"
timeout /t 10 /nobreak >nul
echo [INFO] Verificando emuladores...
"%ADB_PATH%" devices > "%TEMP%\adb.txt" 2>&1
findstr "emulator-" "%TEMP%\adb.txt" >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] Emulador detectado!
    type "%TEMP%\adb.txt"
    set /p usar="Usar este emulador? (y/n): "
    if /i "%usar%"=="y" goto run_tauri
)
echo [INFO] Esperando emulador...
:wait_dev
timeout /t 3 /nobreak >nul
"%ADB_PATH%" devices | findstr "emulator-" >nul
if %ERRORLEVEL%==0 goto run_tauri
goto wait_dev
:run_tauri
echo.
echo [INFO] Ejecutando app...
set "ts=%TEMP%\run_tauri_%RANDOM%.bat"
echo @echo off > "%ts%"
echo chcp 65001 >nul >> "%ts%"
echo call npm run tauri android dev >> "%ts%"
echo pause >> "%ts%"
start "Tauri Android" "%ts%"
echo [INFO] App en ejecucion. Revisa la ventana.
pause
cls
goto menu

:windows_build
echo.
echo [INFO] Compilando Windows (Release)...
set "wb_script=%TEMP%\run_winbuild_%RANDOM%.bat"
echo @echo off > "%wb_script%"
echo chcp 65001 >nul >> "%wb_script%"
echo call npm run tauri build >> "%wb_script%"
echo echo. >> "%wb_script%"
echo if %%ERRORLEVEL%%==0 ( echo [OK] Compilacion exitosa! ) else ( echo [ERROR] Fallo la compilacion. ) >> "%wb_script%"
echo pause >> "%wb_script%"
start "Windows Build" "%wb_script%"
echo [INFO] Compilacion en ventana separada.
pause
cls
goto menu

:android_build
echo.
echo [INFO] Compilando Android (Release)...
set "ab_script=%TEMP%\run_andbuild_%RANDOM%.bat"
echo @echo off > "%ab_script%"
echo chcp 65001 >nul >> "%ab_script%"
echo call npm run tauri android build >> "%ab_script%"
echo echo. >> "%ab_script%"
echo if %%ERRORLEVEL%%==0 ( echo [OK] Compilacion exitosa! ) else ( echo [ERROR] Fallo la compilacion. ) >> "%ab_script%"
echo pause >> "%ab_script%"
start "Android Build" "%ab_script%"
echo [INFO] Compilacion en ventana separada.
pause
cls
goto menu

:exit_script
echo.
echo Saliendo...
exit /b 0
