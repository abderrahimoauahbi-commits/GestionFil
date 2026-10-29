<#
.SYNOPSIS
    Verification complete avant commit ou envoi : types, lint, tests, build.

.DESCRIPTION
    LE TROU QUE CE SCRIPT BOUCHE (17/10/2026). Tout l'outillage du projet est
    bon et ne s'execute jamais seul : `cargo clippy`, `cargo test`, `npm run
    lint`, `npm run build` et le banc ne tournent que si quelqu'un y pense.
    `fabriquer-paquet.ps1` les exige, mais seulement au moment de fabriquer un
    paquet — donc trop tard, apres des jours de travail.

    Ce script les rejoue d'un coup, en quelques minutes, et dit ce qui casse.
    Il ne remplace pas `fabriquer-paquet.ps1` : il evite d'y arriver avec une
    mauvaise surprise.

    CIBLE SEPAREE PAR DEFAUT : la compilation n'ecrase pas le binaire du
    serveur de developpement, qui serait verrouille et ferait echouer
    l'edition de liens.

.PARAMETER Rapide
    Saute le banc metier et les tests de bout en bout : ne garde que ce qui ne
    demande ni base de donnees ni serveur. Une minute au lieu de dix.

.PARAMETER Cible
    Le CARGO_TARGET_DIR a utiliser. Par defaut, un dossier d'essai separe.

.EXAMPLE
    .\verifier.ps1 -Rapide
    .\verifier.ps1
#>
[CmdletBinding()]
param(
    [switch]$Rapide,
    [string]$Cible = "$env:TEMP\gestionfil-verif"
)

$ErrorActionPreference = 'Stop'
$racine = $PSScriptRoot
$env:CARGO_TARGET_DIR = $Cible
$echecs = [System.Collections.Generic.List[string]]::new()
$debut = Get-Date

function Etape {
    param([string]$Nom, [scriptblock]$Faire)
    Write-Host ""
    Write-Host "=== $Nom" -ForegroundColor Cyan
    $t = Get-Date
    try {
        & $Faire
        if ($LASTEXITCODE -ne 0) { throw "code de sortie $LASTEXITCODE" }
        Write-Host ("    ok  ({0:n0} s)" -f ((Get-Date) - $t).TotalSeconds) -ForegroundColor Green
    } catch {
        Write-Host "    ECHEC : $_" -ForegroundColor Red
        $script:echecs.Add($Nom)
    }
}

Write-Host "Verification de Gestion Fil" -ForegroundColor White
Write-Host "  cible de compilation : $Cible"
if ($Rapide) { Write-Host "  mode rapide : banc et bout en bout sautes" -ForegroundColor Yellow }

# --- Ce qui ne demande ni base ni serveur ------------------------------------
Push-Location (Join-Path $racine 'backend')
Etape 'cargo check --all-targets' { cargo check --all-targets }
Etape 'cargo clippy --all-targets' { cargo clippy --all-targets }
Etape 'cargo test' { cargo test }
Pop-Location

Push-Location (Join-Path $racine 'frontend')
Etape 'npm run lint' { npm run lint }
Etape 'npm run build' { npm run build }
Etape 'npm test' { npm test }
Pop-Location

# --- Ce qui demande PostgreSQL et un serveur d'essai -------------------------
if (-not $Rapide) {
    if (-not $env:PGPASSWORD) {
        Write-Host ""
        Write-Host "    PGPASSWORD absent : le banc et le bout en bout ont besoin du mot de passe postgres." -ForegroundColor Yellow
        $echecs.Add('banc et bout en bout non joues (PGPASSWORD absent)')
    } else {
        Push-Location $racine
        Etape 'banc metier' { python backend\tests\banc\banc.py --cible $Cible }
        Pop-Location
        Push-Location (Join-Path $racine 'frontend')
        Etape 'bout en bout (Playwright + Edge)' { python e2e\lancer.py --cible $Cible }
        Pop-Location
    }
}

# --- Verdict -----------------------------------------------------------------
$duree = ((Get-Date) - $debut).TotalMinutes
Write-Host ""
if ($echecs.Count -eq 0) {
    Write-Host ("TOUT PASSE  ({0:n1} min)" -f $duree) -ForegroundColor Green
    exit 0
}
Write-Host ("{0} ECHEC(S)  ({1:n1} min)" -f $echecs.Count, $duree) -ForegroundColor Red
$echecs | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
exit 1
