bat_content = """@echo off
:: Configurar la variable de entorno para la sesión actual
set "SCHOOLTRACKER_PROFILE=test2"

:: Ejecutar el binario de la aplicación
"src-tauri\\target\\debug\\school-tracker-pro.exe"
"""

file_path = "run_school_tracker.bat"
with open(file_path, "w", encoding="utf-8") as f:
    f.write(bat_content)

print(f"File created: {file_path}")