@echo off
chcp 65001 >nul
setlocal

set "SCRIPT_DIR=%~dp0"
set "DIR_NO_SLASH=%SCRIPT_DIR:~0,-1%"

echo ==============================================================
echo [INFO] Solicitando permisos de Administrador para ejecutar dev.ps1...
echo ==============================================================

:: Usamos la herramienta de comandos de Windows para elevar directamente el segundo proceso sin saturar el primero
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = New-Object System.Diagnostics.ProcessStartInfo; $p.FileName = 'powershell.exe'; $p.Arguments = '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%SCRIPT_DIR%dev.ps1\"'; $p.WorkingDirectory = \"%DIR_NO_SLASH%\"; $p.Verb = 'RunAs'; [System.Diagnostics.Process]::Start($p)"

exit /b 0