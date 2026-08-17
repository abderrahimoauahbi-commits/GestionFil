<#
.SYNOPSIS
    Demarre l'ERP Gestion Fil : backend puis frontend.

.DESCRIPTION
    L'application a besoin de DEUX serveurs :
      * le backend Rust sur 127.0.0.1:8080 (API et base de donnees) ;
      * le serveur de developpement Vite sur localhost:5173, qui relaie /api
        vers le backend.
    Sans le backend, Vite repond `ECONNREFUSED 127.0.0.1:8080`.

    Ce script verifie les prerequis, demarre les deux, et attend que le backend
    reponde avant de lancer le frontend.

.EXAMPLE
    .\demarrer.ps1              # backend + frontend
    .\demarrer.ps1 -SansFront   # backend seul
#>
[CmdletBinding()]
param(
    [switch] $SansFront,
    [int]    $PortApi = 8080,
    [int]    $PortWeb = 5173
)

$ErrorActionPreference = 'Stop'
$racine = Split-Path -Parent $MyInvocation.MyCommand.Path
$back   = Join-Path $racine 'backend'
$front  = Join-Path $racine 'frontend'
$base   = Join-Path $racine 'db\gestionfil.db'

function Occupe([int] $port) {
    [bool] (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

# ---------------------------------------------------------------- prerequis
if (-not (Test-Path $base)) {
    throw "Base absente. Executer d'abord :`n    cd db; .\build.ps1"
}
if (-not (Test-Path (Join-Path $back '.env'))) {
    throw "Configuration absente. Executer d'abord :`n    cd backend; cargo run --bin gestionfil-admin -- init-config"
}

$sqlite = (Get-Command sqlite3 -ErrorAction SilentlyContinue).Source
if ($sqlite) {
    $refs = & $sqlite $base "SELECT COUNT(*) FROM reference;"
    if ([int] $refs -eq 0) {
        Write-Host "Catalogue vide : lancer l'import avec" -ForegroundColor Yellow
        Write-Host "    cd backend; cargo run --bin gestionfil-import" -ForegroundColor Yellow
    }
    $sansMdp = & $sqlite $base "SELECT COUNT(*) FROM utilisateur WHERE actif=1 AND mot_de_passe_hash='!A_DEFINIR!';"
    if ([int] $sansMdp -gt 0) {
        Write-Host "$sansMdp compte(s) sans mot de passe :" -ForegroundColor Yellow
        Write-Host "    cd backend; cargo run --bin gestionfil-admin -- definir-mot-de-passe <login>" -ForegroundColor Yellow
    }
}

if (Occupe $PortApi) { throw "Le port $PortApi est deja utilise. Arreter l'autre serveur d'abord." }

# ---------------------------------------------------------------- backend
Write-Host "Compilation du backend..." -ForegroundColor Cyan
Push-Location $back
& cargo build --bin gestionfil --quiet
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "compilation echouee" }
Pop-Location

$exe = Join-Path $back 'target\debug\gestionfil.exe'
$api = Start-Process -FilePath $exe -WorkingDirectory $back -PassThru
Write-Host "Backend demarre (pid $($api.Id))..." -ForegroundColor Cyan

$pret = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-RestMethod "http://127.0.0.1:$PortApi/api/sante" -ErrorAction Stop | Out-Null
        $pret = $true
        break
    } catch { Start-Sleep -Milliseconds 300 }
}
if (-not $pret) {
    if (-not $api.HasExited) { Stop-Process -Id $api.Id -Force }
    throw "le backend n'a pas repondu sur le port $PortApi"
}
Write-Host "  API      http://127.0.0.1:$PortApi" -ForegroundColor Green

# ---------------------------------------------------------------- frontend
$web = $null
if (-not $SansFront) {
    if (Occupe $PortWeb) {
        Write-Host "  Le port $PortWeb est deja utilise : frontend suppose deja demarre." -ForegroundColor Yellow
    } else {
        if (-not (Test-Path (Join-Path $front 'node_modules'))) {
            Write-Host "Installation des dependances frontend..." -ForegroundColor Cyan
            Push-Location $front; & npm install --silent; Pop-Location
        }
        $web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm run dev' `
                             -WorkingDirectory $front -PassThru
        Start-Sleep -Seconds 3
        Write-Host "  Interface http://localhost:$PortWeb" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Ctrl+C pour tout arreter." -ForegroundColor Cyan

try {
    while (-not $api.HasExited) { Start-Sleep -Seconds 1 }
} finally {
    Write-Host "`nArret..." -ForegroundColor Cyan
    if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
    # `npm run dev` passe par cmd.exe : le processus node survit a son parent.
    Get-Process node -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.StartTime -gt (Get-Date).AddHours(-12) } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
}
