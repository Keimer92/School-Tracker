@echo off
chcp 65001 >nul
setlocal

:: Get script directory and remove trailing backslash to prevent escaping issues in PowerShell
set "SCRIPT_DIR=%~dp0"
set "DIR_NO_SLASH=%SCRIPT_DIR:~0,-1%"

echo ==============================================================
echo [INFO] Solicitando permisos de Administrador para ejecutar dev.ps1...
echo ==============================================================

:: Added -NoExit so that if there is any error, the window does not close immediately
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%SCRIPT_DIR%dev.ps1\"' -WorkingDirectory \"%DIR_NO_SLASH%\" -Verb RunAs"

exit /b 0
