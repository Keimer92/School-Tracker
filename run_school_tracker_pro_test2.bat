@echo off

: Configurar la variable de entorno para la sesión actual
set "SCHOOLTRACKER_PROFILE=test2"

: Ejecutar el binario de la aplicación
"src-tauri\\target\\debug\\school-tracker-pro.exe"