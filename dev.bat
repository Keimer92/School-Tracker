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
echo 5. Salir
echo ==============================================
echo.

set /p modo="Seleccione una opcion: "
if "%modo%"=="5" goto exit_script
if "%modo%"=="1" goto windows_dev
if "%modo%"=="2" goto android_dev
if "%modo%"=="3" goto windows_build
if "%modo%"=="4" goto android_build
echo [ERROR] Opcion invalida.
cls
goto menu

:windows_dev
echo.
echo [INFO] Iniciando desarrollo en Windows...
npm run tauri dev
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
echo [INFO] Compilando Windows...
npm run tauri build
pause
cls
goto menu

:android_build
echo [INFO] Compilando Android...
npm run tauri android build
pause
cls
goto menu

:exit_script
exit /b 0
