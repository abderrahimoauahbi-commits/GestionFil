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

function Occupe([int] $port) {
    [bool] (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

# ---------------------------------------------------------------- prerequis
# LA BASE EST POSTGRESQL (depuis le 04/09/2026) : plus de fichier a verifier ici.
# Le serveur controle lui-meme au demarrage le schema, les migrations exigees et
# les comptes sans mot de passe, et le dit dans sa console.
if (-not (Test-Path (Join-Path $back '.env'))) {
    throw "Configuration absente. Executer d'abord :`n    cd backend; cargo run --bin gestionfil-admin -- init-config"
}

if (Occupe $PortApi) { throw "Le port $PortApi est deja utilise. Arreter l'autre serveur d'abord." }

# ---------------------------------------------------------------- backend
Write-Host "Compilation du backend..." -ForegroundColor Cyan
Push-Location $back
& cargo build --bin gestionfil --quiet
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "compilation echouee" }
Pop-Location

# OU CARGO A-T-IL POSE LE BINAIRE ? Pas forcement dans backend\target : quand
# CARGO_TARGET_DIR est defini, toute la compilation sort du projet et se
# partage entre tous les projets Rust du poste. Coder le chemin en dur faisait
# echouer le demarrage avec un « binaire introuvable » des que ce reglage
# existait. On demande donc a l'environnement plutot que de supposer.
$racineCompil = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $back 'target' }
$exe = Join-Path $racineCompil 'debug\gestionfil.exe'
if (-not (Test-Path $exe)) { throw "Binaire introuvable : $exe" }
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
