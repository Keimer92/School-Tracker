param(
    [string]$PocketBaseUrl = "http://127.0.0.1:8090",
    [string]$AdminEmail = "admin@schooltracker.com",
    [string]$AdminPassword = "Admin123456!"
)

$ErrorActionPreference = "Stop"

Write-Host "=== PocketBase Setup ===" -ForegroundColor Cyan
Write-Host "URL: $PocketBaseUrl"
Write-Host ""

# 1. Crear admin si no existe
Write-Host "[1/4] Creando administrador..." -ForegroundColor Yellow
try {
    $body = @{
        email = $AdminEmail
        password = $AdminPassword
        passwordConfirm = $AdminPassword
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$PocketBaseUrl/api/admins" -Method Post -Body $body -ContentType "application/json" -ErrorAction SilentlyContinue
    Write-Host "  ✅ Admin creado: $AdminEmail" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 403) {
        Write-Host "  ⚠️ Ya existe un admin, usando autenticación..." -ForegroundColor Yellow
    } else {
        Write-Host "  ⚠️ Error (probablemente ya existe): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 2. Autenticar como admin
Write-Host "[2/4] Autenticando como admin..." -ForegroundColor Yellow
$authBody = @{
    identity = $AdminEmail
    password = $AdminPassword
} | ConvertTo-Json

try {
    $authResponse = Invoke-RestMethod -Uri "$PocketBaseUrl/api/admins/auth-with-password" -Method Post -Body $authBody -ContentType "application/json"
    $token = $authResponse.token
    Write-Host "  ✅ Autenticado" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Error de autenticación: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# 3. Definir colecciones
$collections = @(
    @{
        name = "ano_lectivo"
        type = "base"
        schema = @(
            @{ name = "nombre"; type = "text"; required = $true; unique = $true }
            @{ name = "activo"; type = "bool" }
            @{ name = "cualitativo"; type = "bool" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "corte_evaluativo"
        type = "base"
        schema = @(
            @{ name = "nombre"; type = "text"; required = $true; unique = $true }
            @{ name = "activo"; type = "bool" }
            @{ name = "cualitativo"; type = "bool" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "colegio"
        type = "base"
        schema = @(
            @{ name = "nombre"; type = "text"; required = $true; unique = $true }
            @{ name = "activo"; type = "bool" }
            @{ name = "cualitativo"; type = "bool" }
            @{ name = "orden"; type = "number" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "asignatura"
        type = "base"
        schema = @(
            @{ name = "nombre"; type = "text"; required = $true; unique = $true }
            @{ name = "cualitativo"; type = "bool" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "grado"
        type = "base"
        schema = @(
            @{ name = "nombre"; type = "text"; required = $true; unique = $true }
            @{ name = "cualitativo"; type = "bool" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "seccion"
        type = "base"
        schema = @(
            @{ name = "nombre"; type = "text"; required = $true; unique = $true }
            @{ name = "cualitativo"; type = "bool" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "estudiante"
        type = "base"
        schema = @(
            @{ name = "nombre"; type = "text"; required = $true }
            @{ name = "codigo"; type = "text"; required = $true; unique = $true }
            @{ name = "sexo"; type = "text" }
            @{ name = "ano_lectivo_id"; type = "number" }
            @{ name = "grado_id"; type = "number" }
            @{ name = "seccion_id"; type = "number" }
            @{ name = "colegio_id"; type = "number" }
            @{ name = "telefono"; type = "text" }
            @{ name = "direccion"; type = "text" }
            @{ name = "email"; type = "text" }
            @{ name = "foto"; type = "text" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "grado_asignatura"
        type = "base"
        schema = @(
            @{ name = "grado_id"; type = "number"; required = $true }
            @{ name = "asignatura_id"; type = "number"; required = $true }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "colegio_asignatura"
        type = "base"
        schema = @(
            @{ name = "colegio_id"; type = "number"; required = $true }
            @{ name = "asignatura_id"; type = "number"; required = $true }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "indicador"
        type = "base"
        schema = @(
            @{ name = "grado_id"; type = "number"; required = $true }
            @{ name = "asignatura_id"; type = "number"; required = $true }
            @{ name = "corte_evaluativo_id"; type = "number"; required = $true }
            @{ name = "orden"; type = "number"; required = $true }
            @{ name = "descripcion"; type = "text" }
            @{ name = "activo"; type = "bool" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "criterio"
        type = "base"
        schema = @(
            @{ name = "indicador_id"; type = "number"; required = $true }
            @{ name = "orden"; type = "number"; required = $true }
            @{ name = "descripcion"; type = "text" }
            @{ name = "puntaje_maximo"; type = "number"; required = $true }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "nota"
        type = "base"
        schema = @(
            @{ name = "estudiante_id"; type = "number"; required = $true }
            @{ name = "criterio_id"; type = "number"; required = $true }
            @{ name = "valor"; type = "number"; required = $true }
            @{ name = "corte_evaluativo_id"; type = "number"; required = $true }
            @{ name = "asignatura_id"; type = "number"; required = $true }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "asistencia"
        type = "base"
        schema = @(
            @{ name = "estudiante_id"; type = "number"; required = $true }
            @{ name = "fecha"; type = "text"; required = $true }
            @{ name = "estado"; type = "text"; required = $true }
            @{ name = "observacion"; type = "text" }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "configuracion_calificacion"
        type = "base"
        schema = @(
            @{ name = "nombre"; type = "text"; required = $true }
            @{ name = "color"; type = "text"; required = $true }
            @{ name = "minimo"; type = "number"; required = $true }
            @{ name = "user_id"; type = "text" }
        )
    },
    @{
        name = "colegio_dias_asistencia"
        type = "base"
        schema = @(
            @{ name = "colegio_id"; type = "number"; required = $true }
            @{ name = "lunes"; type = "bool" }
            @{ name = "martes"; type = "bool" }
            @{ name = "miercoles"; type = "bool" }
            @{ name = "jueves"; type = "bool" }
            @{ name = "viernes"; type = "bool" }
            @{ name = "sabado"; type = "bool" }
            @{ name = "domingo"; type = "bool" }
            @{ name = "user_id"; type = "text" }
        )
    }
)

# 4. Crear colecciones
Write-Host "[3/4] Creando colecciones..." -ForegroundColor Yellow

# Obtener colecciones existentes
$existing = @()
try {
    $existingResponse = Invoke-RestMethod -Uri "$PocketBaseUrl/api/collections" -Method Get -Headers $headers
    $existing = $existingResponse.items | ForEach-Object { $_.name }
} catch {
    Write-Host "  ⚠️ No se pudieron listar colecciones existentes" -ForegroundColor Yellow
}

foreach ($col in $collections) {
    if ($existing -contains $col.name) {
        Write-Host "  ⏭️ Saltando $($col.name) (ya existe)" -ForegroundColor Gray
        continue
    }

    try {
        $body = $col | ConvertTo-Json -Depth 5
        $response = Invoke-RestMethod -Uri "$PocketBaseUrl/api/collections" -Method Post -Body $body -Headers $headers
        Write-Host "  ✅ Creada: $($col.name)" -ForegroundColor Green
    } catch {
        Write-Host "  ❌ Error creando $($col.name): $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "[4/4] ¡Setup completado!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Admin: $PocketBaseUrl/_/ " -ForegroundColor Green
Write-Host "Email: $AdminEmail" -ForegroundColor Green
Write-Host "Pass:  $AdminPassword" -ForegroundColor Green
