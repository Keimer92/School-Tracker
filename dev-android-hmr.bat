@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ============================================================
rem  School Tracker Pro - Android dev con HMR - lanzador rapido
rem  Uso:
rem    dev-android-hmr.bat              -> dispositivo fisico HMR
rem    dev-android-hmr.bat emulator     -> emulador HMR
rem    dev-android-hmr.bat --ip=x.x.x.x -> IP manual
rem ============================================================

set MODE=device
set EXTRA_ARGS=

:parse
if "%~1"=="" goto :run
if /i "%~1"=="emulator" (
  set MODE=emulator
) else (
  set EXTRA_ARGS=!EXTRA_ARGS! %1
)
shift
goto :parse

:run
rem --- Limpiar Vite huerfano en el puerto 1420 para evitar el error
rem --- beforeDevCommand terminated with a non-zero status code
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":1420" ^| findstr "LISTENING"') do (
  echo [School Tracker Pro] Cerrando proceso viejo en puerto 1420, PID %%p...
  taskkill /f /pid %%p >nul 2>&1
)
timeout /t 1 /nobreak >nul

if "%MODE%"=="emulator" (
  echo [School Tracker Pro] Iniciando Android dev HMR con EMULADOR...
  npm run dev:android:hmr
) else (
  echo [School Tracker Pro] Iniciando Android dev HMR con DISPOSITIVO FISICO...
  echo [School Tracker Pro] Conecta el telefono por USB y acepta la depuracion.
  if defined EXTRA_ARGS (
    npm run dev:android:device -- !EXTRA_ARGS!
  ) else (
    npm run dev:android:device
  )
)

endlocal