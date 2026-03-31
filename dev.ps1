# dev.ps1
# Forzar codificación UTF-8 para la consola
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"

# Función para cargar el entorno de Visual Studio (cl.exe)
function Import-VSVars {
    if (Get-Command "cl.exe" -ErrorAction SilentlyContinue) { return }
    Write-Host "`n[INFO] Buscando entorno de Visual Studio..." -ForegroundColor Yellow
    
    $vcvarsPath = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
    if (-not (Test-Path $vcvarsPath)) { $vcvarsPath = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" }
    if (-not (Test-Path $vcvarsPath)) { $vcvarsPath = "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" }

    if (Test-Path $vcvarsPath) {
        Write-Host "[INFO] Cargando variables de entorno desde vcvarsall.bat..." -ForegroundColor Gray
        $tempFile = [System.IO.Path]::GetTempFileName()
        cmd /c "`"$vcvarsPath`" x64 && set" > $tempFile
        Get-Content $tempFile | Foreach-Object {
            if ($_ -match "^(.*?)=(.*)$") {
                $name = $matches[1]
                $value = $matches[2]
                if ($name -ne "Path") { Set-Item "env:$name" $value } else { $env:Path = $value }
            }
        }
        Remove-Item $tempFile
        Write-Host "[OK] Entorno de compilaci$([char]0x00F3)n listo." -ForegroundColor Green
    }
}

Import-VSVars
$env:CC = "cl.exe"
$env:CXX = "cl.exe"

function Show-Menu {
    Clear-Host
    Write-Host "`n==============================================" -ForegroundColor Cyan
    Write-Host "   GESTOR DE DESARROLLO - TAURI/RUST" -ForegroundColor Cyan
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host "1." -NoNewline; Write-Host " Windows (Desarrollo)"
    Write-Host "2." -NoNewline; Write-Host " Android (Desarrollo) (IP: 192.168.100.27)"
    Write-Host "3." -NoNewline; Write-Host " Windows Build (Release - Instalador final)"
    Write-Host "4." -NoNewline; Write-Host " Android Build (Release - APK Final)"
    Write-Host "5." -NoNewline; Write-Host " Salir" -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Cyan
}

# Bucle infinito para que el script NUNCA se cierre solo
while ($true) {
    try {
        Show-Menu
        Write-Host "Seleccione una opci$([char]0x00F3)n: " -NoNewline
        $modo = Read-Host
        
        if ($modo -eq "5") {
            Write-Host "`nSaliendo..." -ForegroundColor Cyan
            break
        }

        switch ($modo) {
            "1" {
                $env:TAURI_DEV_HOST = "0.0.0.0"
                Write-Host "`n[INFO] Iniciando desarrollo en Windows..." -ForegroundColor Yellow
                npm run tauri dev
            }
            "2" {
                $env:TAURI_DEV_HOST = "192.168.100.27"
                Write-Host "`n[INFO] Iniciando desarrollo en Android..." -ForegroundColor Yellow
                npm run tauri android dev
            }
            "3" {
                Write-Host "`n[INFO] Compilando instalador final para Windows..." -ForegroundColor Green
                npm run tauri build
            }
            "4" {
                Write-Host "`n[INFO] Compilando APK final para Android..." -ForegroundColor Yellow
                npm run tauri android build
            }
            Default {
                Write-Host "`n[ERROR] Opci$([char]0x00F3)n no v$([char]0x00E1)lida." -ForegroundColor Red
                Start-Sleep -Seconds 1
                continue
            }
        }

        Write-Host "`n[OK] Proceso finalizado." -ForegroundColor Green
        Write-Host "`nPresione cualquier tecla para volver al men$([char]0x00FA)..."
        $null = [Console]::ReadKey($true)

    } catch [System.Management.Automation.PipelineStoppedException] {
        # Este bloque captura específicamente el Ctrl + C
        Write-Host "`n`n[SISTEMA] Interrupci$([char]0x00F3)n detectada. Regresando al men$([char]0x00FA)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 1
    } catch {
        # Captura cualquier otro error inesperado
        Write-Host "`n`n[ERROR] Ocurri$([char]0x00F3) un error inesperado: $_" -ForegroundColor Red
        Write-Host "Regresando al men$([char]0x00FA)..."
        Start-Sleep -Seconds 2
    }
}
