<#
.SYNOPSIS
    Demarre l'ERP Gestion Fil : UN serveur, qui sert l'API et l'interface.

.DESCRIPTION
    Le serveur Rust sert aussi l'interface compilee (frontend\dist) : en usage
    normal, un seul processus suffit, sur http://localhost:8080. Ce script :
      * recompile l'interface SEULEMENT si son code a change depuis la derniere
        compilation (npm run build) ;
      * compile le serveur (cargo build) ;
      * arrete un ancien serveur Gestion Fil reste sur le port, s'il y en a un ;
      * demarre le serveur, attend qu'il reponde, ouvre le navigateur.
    Ctrl+C arrete le serveur.

    Le mode -Dev garde l'ancien fonctionnement pour developper l'interface :
    le serveur Vite sur localhost:5173, qui relaie /api vers le serveur et
    recharge la page a chaque modification.

.EXAMPLE
    .\demarrer.ps1                  # le serveur seul, interface comprise
    .\demarrer.ps1 -Reconstruire    # recompiler l'interface meme sans changement
    .\demarrer.ps1 -SansNavigateur  # ne pas ouvrir le navigateur
    .\demarrer.ps1 -Dev             # serveur + Vite (rechargement a chaud)
#>
[CmdletBinding()]
param(
    [switch] $Dev,
    [switch] $Reconstruire,
    [switch] $SansNavigateur,
    [int]    $PortApi = 8080,
    [int]    $PortWeb = 5173
)

$ErrorActionPreference = 'Stop'
$racine = Split-Path -Parent $MyInvocation.MyCommand.Path
$back   = Join-Path $racine 'backend'
$front  = Join-Path $racine 'frontend'
$dist   = Join-Path $front 'dist'

function Ecouteur([int] $port) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
}

# ---------------------------------------------------------------- prerequis
# LA BASE EST POSTGRESQL (depuis le 04/09/2026) : plus de fichier a verifier ici.
# Le serveur controle lui-meme au demarrage le schema, les migrations exigees et
# les comptes sans mot de passe, et le dit dans sa console.
if (-not (Test-Path (Join-Path $back '.env'))) {
    throw "Configuration absente. Executer d'abord :`n    cd backend; cargo run --bin gestionfil-admin -- init-config"
}

# UN ANCIEN SERVEUR GESTION FIL SUR LE PORT s'arrete : relancer le script, c'est
# vouloir le nouveau. Un AUTRE programme sur le port, en revanche, on n'y touche pas.
$occupant = Ecouteur $PortApi
if ($occupant) {
    $proc = Get-Process -Id $occupant.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'gestionfil') {
        Write-Host "Arret de l'ancien serveur (pid $($proc.Id))..." -ForegroundColor Cyan
        Stop-Process -Id $proc.Id -Force
        for ($i = 0; $i -lt 20 -and (Ecouteur $PortApi); $i++) { Start-Sleep -Milliseconds 250 }
    } else {
        throw "Le port $PortApi est pris par un autre programme ($($proc.ProcessName), pid $($occupant.OwningProcess))."
    }
}

# ---------------------------------------------------------------- interface
# LA COMPILATION SEULEMENT SI LE CODE A CHANGE : une minute de gagnee a chaque
# demarrage ordinaire. On compare le fichier le plus recent des sources a
# l'index compile.
if (-not $Dev) {
    if (-not (Test-Path (Join-Path $front 'node_modules'))) {
        Write-Host "Installation des dependances de l'interface..." -ForegroundColor Cyan
        Push-Location $front; & npm install --silent; Pop-Location
    }
    $index = Join-Path $dist 'index.html'
    $aJour = $false
    if ((Test-Path $index) -and -not $Reconstruire) {
        $compile = (Get-Item $index).LastWriteTime
        $sources = @(Get-ChildItem (Join-Path $front 'src') -Recurse -File) +
                   @(Get-ChildItem $front -File | Where-Object { $_.Name -in 'index.html', 'package.json', 'vite.config.ts' }) +
                   @(Get-ChildItem (Join-Path $front 'public') -Recurse -File -ErrorAction SilentlyContinue)
        $recent = ($sources | Measure-Object LastWriteTime -Maximum).Maximum
        $aJour = $recent -le $compile
    }
    if ($aJour) {
        Write-Host "Interface a jour (aucun changement depuis la derniere compilation)." -ForegroundColor DarkGray
    } else {
        Write-Host "Compilation de l'interface..." -ForegroundColor Cyan
        Push-Location $front
        & npm run build --silent
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { throw "compilation de l'interface echouee" }
    }
}

# ---------------------------------------------------------------- serveur
Write-Host "Compilation du serveur..." -ForegroundColor Cyan
Push-Location $back
& cargo build --bin gestionfil --quiet
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "compilation du serveur echouee" }

# OU CARGO A-T-IL POSE LE BINAIRE ? Pas forcement dans backend\target : quand
# CARGO_TARGET_DIR est defini, toute la compilation sort du projet et se
# partage entre tous les projets Rust du poste. Coder le chemin en dur faisait
# echouer le demarrage avec un « binaire introuvable » des que ce reglage
# existait. On demande donc a l'environnement plutot que de supposer.
$racineCompil = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $back 'target' }
$exe = Join-Path $racineCompil 'debug\gestionfil.exe'
if (-not (Test-Path $exe)) { throw "Binaire introuvable : $exe" }

# L'interface servie par le serveur : si .env ne la designe pas, c'est frontend\dist.
if (-not (Select-String -Path (Join-Path $back '.env') -Pattern '^\s*FRONTEND_DIR=' -Quiet)) {
    $env:FRONTEND_DIR = $dist
}

# Le serveur tourne DANS cette console : ses messages s'y affichent, et Ctrl+C
# l'arrete avec elle.
$api = Start-Process -FilePath $exe -WorkingDirectory $back -NoNewWindow -PassThru
$pret = $false
for ($i = 0; $i -lt 100; $i++) {
    if ($api.HasExited) { break }
    try {
        Invoke-RestMethod "http://127.0.0.1:$PortApi/api/sante" -ErrorAction Stop | Out-Null
        $pret = $true
        break
    } catch { Start-Sleep -Milliseconds 300 }
}
if (-not $pret) {
    if (-not $api.HasExited) { Stop-Process -Id $api.Id -Force }
    throw "le serveur n'a pas repondu sur le port $PortApi (voir ses messages ci-dessus : migration manquante, base arretee...)"
}

# ---------------------------------------------------------------- Vite (mode -Dev)
$web = $null
$adresse = "http://localhost:$PortApi"
if ($Dev) {
    if (Ecouteur $PortWeb) {
        Write-Host "  Le port $PortWeb est deja utilise : Vite suppose deja demarre." -ForegroundColor Yellow
    } else {
        if (-not (Test-Path (Join-Path $front 'node_modules'))) {
            Write-Host "Installation des dependances de l'interface..." -ForegroundColor Cyan
            Push-Location $front; & npm install --silent; Pop-Location
        }
        $web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm run dev' `
                             -WorkingDirectory $front -PassThru
        Start-Sleep -Seconds 3
    }
    $adresse = "http://localhost:$PortWeb"
}

Write-Host ""
Write-Host "  Gestion Fil   $adresse" -ForegroundColor Green
$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
      Select-Object -First 1 -ExpandProperty IPAddress
if ($ip -and -not $Dev) { Write-Host "  Depuis un autre poste : http://${ip}:$PortApi" -ForegroundColor Green }
Write-Host "  Ctrl+C pour arreter." -ForegroundColor Cyan
Write-Host ""
if (-not $SansNavigateur) { Start-Process $adresse }

try {
    while (-not $api.HasExited) { Start-Sleep -Seconds 1 }
} finally {
    Write-Host "`nArret..." -ForegroundColor Cyan
    # `npm run dev` passe par cmd.exe : le processus node survit a son parent.
    # On arrete l'ARBRE de ce processus-la, pas tous les node du poste.
    if ($web -and -not $web.HasExited) {
        & taskkill.exe /PID $web.Id /T /F 2>$null | Out-Null
    }
    if (-not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
}
