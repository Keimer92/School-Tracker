@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "ANDROID_HOME=%ANDROID_HOME%"
set "EMULATOR_PATH=%ANDROID_HOME%\emulator\emulator.exe"
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
echo 5. Ver emuladores instalados
echo 6. Crear nuevo emulador
echo 7. Eliminar emulador
echo 8. Iniciar emulador (sin app)
echo.
echo === MANTENIMIENTO ===
echo 9. Limpiar cache y dependencias
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
echo [ERROR] Opcion invalida.
timeout /t 2 /nobreak >nul
cls
goto menu

:clean_cache
echo.
echo ==============================================
echo LIMPIEZA DE CACHE Y DEPENDENCIAS
echo ==============================================
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

echo [INFO] Limpiando npm...
call npm cache clean
echo [INFO] Limpiando cargo...
cd "%SCRIPT_DIR%src-tauri"
call cargo clean
cd "%SCRIPT_DIR%"

echo [OK] Limpieza completada!
echo.
pause
cls
goto menu

:view_emulators
cls
echo ==============================================
echo EMULADORES INSTALADOS
echo ==============================================
echo.
if exist "%EMULATOR_PATH%" (
    "%EMULATOR_PATH%" -list-avds
    echo.
    echo [INFO] Dispositivos conectados:
    call "%ANDROID_HOME%\platform-tools\adb.exe" devices
) else (
    echo [ERROR] Emulador no encontrado.
)
echo.
pause
cls
goto menu

:create_emulator
cls
echo ==============================================
echo CREAR NUEVO EMULADOR
echo ==============================================
echo.
echo [INFO] Imagenes disponibles para instalar:
echo.
echo 1. Android 10 (API 29) - x86_64
echo 2. Android 11 (API 30) - x86_64
echo 3. Android 12 (API 31) - x86_64  [RECOMENDADO]
echo 4. Android 13 (API 33) - x86_64
echo 5. Android 14 (API 34) - x86_64
echo.
set /p api_version="Selecciona version (1-5): "

if "%api_version%"=="1" set "api=29" & set "tag=google_apis" & set "abi=x86_64"
if "%api_version%"=="2" set "api=30" & set "tag=google_apis" & set "abi=x86_64"
if "%api_version%"=="3" set "api=31" & set "tag=google_apis" & set "abi=x86_64"
if "%api_version%"=="4" set "api=33" & set "tag=google_apis" & set "abi=x86_64"
if "%api_version%"=="5" set "api=34" & set "tag=google_apis" & set "abi=x86_64"

if "%api%"=="" goto create_emulator

echo.
set /p avd_name="Nombre del emulador (ej: android%api%_emu): "
if "%avd_name%"=="" set "avd_name=android%api%_emu"

echo.
echo [INFO] Instalando imagen del sistema...
echo "%SDKMANAGER%" "system-images;android-%api%;%tag%;%abi%"
echo y | call "%SDKMANAGER%" "system-images;android-%api%;%tag%;%abi%"

echo.
echo [INFO] Creando emulador...
call "%AVDMANAGER%" create avd -n "%avd_name%" -k "system-images;android-%api%;%tag%;%abi%"

echo.
echo [OK] Emulador '%avd_name%' creado!
echo.
pause
cls
goto menu

:delete_emulator
cls
echo ==============================================
echo ELIMINAR EMULADOR
echo ==============================================
echo.
echo [INFO] Emuladores instalados:
call "%EMULATOR_PATH%" -list-avds
echo.
set /p avd_name="Nombre del emulador a eliminar: "
if "%avd_name%"=="" goto menu

echo.
set /p confirm="Confirmar eliminacion de '%avd_name%'? (y/n): "
if /i not "%confirm%"=="y" goto menu

call "%AVDMANAGER%" delete avd -n "%avd_name%"
echo [OK] Emulador eliminado.
echo.
pause
cls
goto menu

:start_emulator
cls
echo ==============================================
echo INICIAR EMULADOR
echo ==============================================
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

echo.
echo [INFO] Iniciando '%avd_name%'...
set "temp_script=%TEMP%\run_emu_%RANDOM%.bat"
echo @echo off > "%temp_script%"
echo "%EMULATOR_PATH%" -avd "%avd_name%" -no-audio >> "%temp_script%"
echo pause >> "%temp_script%"
start "Emulador %avd_name%" "%temp_script%"
echo [OK] Emulador iniciado.
echo.
pause
cls
goto menu

:windows_dev
echo.
echo [INFO] Iniciando desarrollo en Windows...
set "win_script=%TEMP%\run_windows_%RANDOM%.bat"
echo @echo off > "%win_script%"
echo chcp 65001 >nul >> "%win_script%"
echo call npm run tauri dev >> "%win_script%"
echo pause >> "%win_script%"
start "Tauri Windows Dev" "%win_script%"
echo [INFO] Servidor iniciado en ventana separada.
cls
goto menu

:android_dev
echo.
echo [INFO] Iniciando desarrollo en Android...
echo.
if "%ANDROID_HOME%"=="" (
    echo [ERROR] ANDROID_HOME no configurada.
    pause
    cls
    goto menu
)
set "ADB_PATH=%ANDROID_HOME%\platform-tools\adb.exe"
setx ANDROID_NDK_HOME "%ANDROID_HOME%\ndk\27.0.12077973" >nul 2>&1
echo [OK] ANDROID_HOME: %ANDROID_HOME%

REM Verificar NDK
set "NDK_VALID=0"
if exist "%ANDROID_HOME%\ndk\27.0.12077973\source.properties" set "NDK_VALID=1"
if "%NDK_VALID%"=="0" (
    echo [INFO] Instalando NDK...
    echo y | call "%SDKMANAGER%" "ndk;27.0.12077973"
)

REM Verificar proyecto Android
if not exist "%SCRIPT_DIR%src-tauri\gen\android" (
    echo [INFO] Inicializando proyecto Android...
    call npm run tauri android init
)

REM Verificar targets Rust
rustup target list --installed | findstr "android" >nul 2>nul
if %ERRORLEVEL% neq 0 (
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
    cls
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

echo [INFO] Verificando emulador...
"%ADB_PATH%" devices > "%TEMP%\adb.txt" 2>&1
findstr "emulator-" "%TEMP%\adb.txt" >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] Emulador detectado!
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
cls
goto menu

:windows_build
echo.
echo [INFO] Compilando Windows (Release)...
set "wb_script=%TEMP%\run_winbuild_%RANDOM%.bat"
echo @echo off > "%wb_script%"
echo chcp 65001 >nul >> "%wb_script%"
echo call npm run tauri build >> "%wb_script%"
echo if %%ERRORLEVEL%%==0 ( echo [OK] Exitosa! ) else ( echo [ERROR] Fallo. ) >> "%wb_script%"
echo pause >> "%wb_script%"
start "Windows Build" "%wb_script%"
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
echo if %%ERRORLEVEL%%==0 ( echo [OK] Exitosa! ) else ( echo [ERROR] Fallo. ) >> "%ab_script%"
echo pause >> "%ab_script%"
start "Android Build" "%ab_script%"
pause
cls
goto menu

:exit_script
exit /b 0
