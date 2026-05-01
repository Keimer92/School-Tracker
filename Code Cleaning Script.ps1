#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Limpia proyectos Rust/Tauri eliminando archivos basura (build artifacts, dependencias, etc.)

.DESCRIPTION
    Este script elimina:
    - Directorios target/ (Rust build artifacts)
    - Directorios node_modules/ (Node.js dependencies)
    - Archivos .pdb (debug symbols)
    - Directorios gen/android/ (Android build artifacts)
    - Opcionalmente: historial de Git

.PARAMETER Path
    Ruta del proyecto a limpiar. Por defecto usa el directorio actual.

.PARAMETER CleanGit
    Si se especifica, elimina el directorio .git y reinicia el repositorio.

.PARAMETER WhatIf
    Muestra qué se eliminaría sin ejecutar la limpieza.

.EXAMPLE
    .\clean-project.ps1 -Path "D:\Mis proyectos\Rust\mi-proyecto"

.EXAMPLE
    .\clean-project.ps1 -Path "D:\Mis proyectos\Rust\mi-proyecto" -CleanGit

.EXAMPLE
    .\clean-project.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Path = (Get-Location),
    [switch]$CleanGit
)

$ErrorActionPreference = "Stop"

# Colores para output
$InfoColor = "Cyan"
$SuccessColor = "Green"
$WarningColor = "Yellow"
$ErrorColor = "Red"

function Write-Info { Write-Host $args -ForegroundColor $InfoColor }
function Write-Success { Write-Host $args -ForegroundColor $SuccessColor }
function Write-Warning { Write-Host $args -ForegroundColor $WarningColor }
function Write-Error { Write-Host $args -ForegroundColor $ErrorColor }

# Banner
Write-Host ""
Write-Host "========================================" -ForegroundColor $InfoColor
Write-Host "  Rust/Tauri Project Cleaner" -ForegroundColor $InfoColor
Write-Host "========================================" -ForegroundColor $InfoColor
Write-Host ""

# Validar que existe el directorio
if (-not (Test-Path $Path)) {
    Write-Error "El directorio no existe: $Path"
    exit 1
}

$Path = Resolve-Path $Path
Write-Info "Proyecto: $Path"
Write-Host ""

# Calcular tamaño inicial
$initialSize = (Get-ChildItem $Path -Recurse -Force -ErrorAction SilentlyContinue | 
                 Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
$initialSizeGB = [math]::Round($initialSize / 1GB, 2)
Write-Info "Tamaño inicial: $initialSizeGB GB"
Write-Host ""

# Elementos a eliminar
$patterns = @(
    # Rust
    @{ Name = "Rust target directories"; Pattern = "target" },
    @{ Name = "Debug symbols (PDB)"; Pattern = "*.pdb" },
    @{ Name = "DLL files"; Pattern = "*.dll" },
    @{ Name = "Library files (LIB)"; Pattern = "*.lib" },
    @{ Name = "Export files (EXP)"; Pattern = "*.exp" },
    @{ Name = "Object files (OBJ)"; Pattern = "*.obj" },

    # Node.js
    @{ Name = "Node.js modules"; Pattern = "node_modules" },
    @{ Name = "Dist directories"; Pattern = "dist" },
    @{ Name = "Dist-ssr directories"; Pattern = "dist-ssr" },
    @{ Name = "Local config files"; Pattern = "*.local" },

    # Svelte
    @{ Name = "Svelte build directories"; Pattern = "build" },
    @{ Name = "Svelte-kit directories"; Pattern = ".svelte-kit" },
    @{ Name = "Package directories"; Pattern = "package" },

    # Tauri / Android
    @{ Name = "Build artifacts (gen)"; Pattern = "gen" },
    @{ Name = "Tauri local databases"; Pattern = "*.db" },
    @{ Name = "SQLite databases"; Pattern = "*.sqlite" },

    # Tooling & Cache
    @{ Name = "Kilo tool directory"; Pattern = ".kilo" },
    @{ Name = "Qwen settings/cache"; Pattern = ".qwen" },
    @{ Name = "TypeScript build info"; Pattern = "*.tsbuildinfo" },

    # Assets
    @{ Name = "Raw icons directory (root)"; Pattern = "icons" },

    # Environment
    @{ Name = "Environment files"; Pattern = ".env" },
    @{ Name = "Environment local files"; Pattern = ".env.*" },

    # IDEs
    @{ Name = "VS Code settings"; Pattern = ".vscode" },
    @{ Name = "IntelliJ IDEA settings"; Pattern = ".idea" },
    @{ Name = "Swap files"; Pattern = "*.swp" },
    @{ Name = "Swo files"; Pattern = "*.swo" },
    @{ Name = "Suo files"; Pattern = "*.suo" },
    @{ Name = "NTVS files"; Pattern = "*.ntvs*" },
    @{ Name = "Node.js project files"; Pattern = "*.njsproj" },
    @{ Name = "Solution files"; Pattern = "*.sln" },

    # System
    @{ Name = "macOS system files"; Pattern = ".DS_Store" },
    @{ Name = "Windows Thumbnails"; Pattern = "Thumbs.db" },
    @{ Name = "Windows Desktop Settings"; Pattern = "Desktop.ini" },

    # Logs
    @{ Name = "Log files"; Pattern = "*.log" },
    @{ Name = "NPM/Yarn/PNPM debug logs"; Pattern = "*-debug.log*" },
    @{ Name = "Yarn error logs"; Pattern = "yarn-error.log*" },

    # Build artifacts
    @{ Name = "Bin directories"; Pattern = "bin" },
    @{ Name = "Obj directories"; Pattern = "obj" },
    @{ Name = "Executables"; Pattern = "*.exe" },
    @{ Name = "Shared objects"; Pattern = "*.so" },
    @{ Name = "Dynamic libraries"; Pattern = "*.dylib" },
    @{ Name = "Debian packages"; Pattern = "*.deb" },
    @{ Name = "AppImage packages"; Pattern = "*.appimage" },
    @{ Name = "MSI installers"; Pattern = "*.msi" },
    @{ Name = "RPM packages"; Pattern = "*.rpm" },
    @{ Name = "Snap packages"; Pattern = "*.snap" },
    @{ Name = "WebAssembly artifacts"; Pattern = "*.wasm" },

    # Mobile
    @{ Name = "Android APKs"; Pattern = "*.apk" },
    @{ Name = "Android App Bundles"; Pattern = "*.aab" },
    @{ Name = "iOS IPAs"; Pattern = "*.ipa" },

    # Personalizado
    @{ Name = "Backup directories"; Pattern = "Backup" },
    @{ Name = "Custom log files"; Pattern = "log_*.txt" },
    @{ Name = "Aider files"; Pattern = ".aider*" }
)

$totalDeleted = 0

foreach ($item in $patterns) {
    Write-Info "Buscando: $($item.Name)..."
    
    $items = Get-ChildItem $Path -Recurse -Force -ErrorAction SilentlyContinue | 
             Where-Object { 
                 if ($_.Name -eq ".env.example") { return $false } # No eliminar .env.example
                 
                 # Excepción específica para iconos necesarios de Tauri
                 if ($_.FullName -like "*\src-tauri\icons*") { return $false }

                 if ($item.Pattern -like "*.*") {
                     $_.Name -like $item.Pattern
                 } else {
                     $_.Name -eq $item.Pattern -or $_.FullName -like "*\$($item.Pattern)\*"
                 }
             }
    
    if ($items.Count -eq 0) {
        Write-Host "  No se encontraron elementos." -ForegroundColor Gray
        continue
    }
    
    foreach ($target in $items) {
        $size = 0
        if ($target.PSIsContainer) {
            $size = (Get-ChildItem $target.FullName -Recurse -Force -ErrorAction SilentlyContinue | 
                     Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        } else {
            $size = $target.Length
        }
        
        $sizeMB = [math]::Round($size / 1MB, 2)
        $totalDeleted += $size
        
        if ($PSCmdlet.ShouldProcess($target.FullName, "Delete")) {
            try {
                Remove-Item $target.FullName -Recurse -Force -ErrorAction Stop
                Write-Host "  ✓ Eliminados: $($target.FullName) ($sizeMB MB)" -ForegroundColor $SuccessColor
            } catch {
                Write-Host "  ✗ Error eliminando: $($target.FullName)" -ForegroundColor $ErrorColor
            }
        } else {
            Write-Host "  [WhatIf] Eliminaría: $($target.FullName) ($sizeMB MB)" -ForegroundColor $WarningColor
        }
    }
}

# Limpieza de Git (opcional)
if ($CleanGit) {
    $gitPath = Join-Path $Path ".git"
    if (Test-Path $gitPath) {
        $gitSize = (Get-ChildItem $gitPath -Recurse -Force -ErrorAction SilentlyContinue | 
                    Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        $gitSizeMB = [math]::Round($gitSize / 1MB, 2)
        $totalDeleted += $gitSize
        
        if ($PSCmdlet.ShouldProcess($gitPath, "Delete .git directory")) {
            Write-Info "Eliminando directorio .git..."
            Remove-Item $gitPath -Recurse -Force
            Write-Host "  ✓ .git eliminado ($gitSizeMB MB)" -ForegroundColor $SuccessColor
            
            # Reiniciar Git
            Write-Info "Inicializando nuevo repositorio Git..."
            git -C $Path init | Out-Null
            git -C $Path add . | Out-Null
            git -C $Path commit -m "Initial commit - clean source code" | Out-Null
            Write-Success "  ✓ Git reiniciado con commit inicial"
        } else {
            Write-Host "  [WhatIf] Eliminaría .git ($gitSizeMB MB)" -ForegroundColor $WarningColor
        }
    }
}

# Calcular tamaño final
$finalSize = (Get-ChildItem $Path -Recurse -Force -ErrorAction SilentlyContinue | 
              Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
$finalSizeGB = [math]::Round($finalSize / 1GB, 2)
$savedGB = [math]::Round(($initialSize - $finalSize) / 1GB, 2)

Write-Host ""
Write-Host "========================================" -ForegroundColor $InfoColor
Write-Host "  Limpieza completada!" -ForegroundColor $SuccessColor
Write-Host "========================================" -ForegroundColor $InfoColor
Write-Host ""
Write-Host "  Tamaño inicial:  $initialSizeGB GB" -ForegroundColor $InfoColor
Write-Host "  Tamaño final:    $finalSizeGB GB" -ForegroundColor $InfoColor
Write-Host "  Espacio ahorrado: $savedGB GB" -ForegroundColor $SuccessColor
Write-Host ""

# Verificar si hay .gitignore, si no, sugerir crearlo
$gitignorePath = Join-Path $Path ".gitignore"
if (-not (Test-Path $gitignorePath)) {
    Write-Warning "No se encontró .gitignore. ¿Quieres crear uno recomendado para Rust/Tauri?"
    $response = Read-Host "  (y/n)"
    if ($response -eq "y" -or $response -eq "Y") {
        $gitignoreContent = @"
# Rust
/target/
**/target/
*.pdb
*.dll
*.lib
*.exp
*.obj

# Node
/node_modules/
dist/
dist-ssr/
*.local

# Svelte
/build/
/.svelte-kit/
/package/

# Tauri
src-tauri/target/
src-tauri/**/*.pdb
gen/

# Environment
.env
.env.*
!.env.example

# IDE
.vscode/*
!.vscode/extensions.json
.idea/
*.swp
*.swo
*.suo
*.ntvs*
*.njsproj
*.sln

# System
.DS_Store
Thumbs.db
Desktop.ini

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Build artifacts
bin/
obj/
*.exe
*.so
*.dylib
*.deb
*.appimage
*.msi
*.rpm
*.snap
*.wasm

# Mobile (Tauri)
*.apk
*.aab
*.ipa

# Personalizado
Backup/
log_*.txt
.aider*
"@
        Set-Content -Path $gitignorePath -Value $gitignoreContent
        Write-Success "  ✓ .gitignore creado"
    }
}

Write-Host ""
