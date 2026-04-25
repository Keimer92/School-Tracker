@echo off
title Aider Smart Commit - %cd%
cls

echo ======================================================
echo           AIDER INTELLIGENT COMMIT
echo ======================================================
echo.
echo Proyecto: %cd%
echo Modelo:   qwen2.5-coder:1.5b (Local)
echo.

:: Verificar si Ollama está corriendo
tasklist /FI "IMAGENAME eq ollama app.exe" 2>NUL | find /I /N "ollama app.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo [ADVERTENCIA] Parece que Ollama no esta abierto.
    echo Intentando continuar de todos modos...
    echo.
)

echo [1/1] Generando mensaje y haciendo commit...
echo ------------------------------------------------------

:: Ejecutar Aider
aider --model ollama/qwen2.5-coder:1.5b --commit

:: Verificar el resultado del comando
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ------------------------------------------------------
    echo [ERROR] Aider encontro un problema.
    echo Revisa los mensajes de arriba para mas detalles.
    echo.
    pause
) else (
    echo.
    echo [EXITO] Commit realizado correctamente.
    echo.
    :: Opcional: Esperar 3 segundos antes de cerrar si todo salio bien
    timeout /t 3
)