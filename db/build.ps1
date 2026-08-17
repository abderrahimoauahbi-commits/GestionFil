<#
.SYNOPSIS
    Construit la base de developpement SQLite de l'ERP Gestion Fil.

.EXAMPLE
    .\build.ps1                 # schema + seed de reference
    .\build.ps1 -Demo           # + jeu de demonstration SH
    .\build.ps1 -Database test.db     # base cible differente
#>
[CmdletBinding()]
param(
    [switch] $Demo,
    [string] $Database = "gestionfil.db"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$sqlite = (Get-Command sqlite3 -ErrorAction SilentlyContinue).Source
if (-not $sqlite) { throw "sqlite3 introuvable dans le PATH." }

if (Test-Path $Database) { Remove-Item $Database -Force }

# Les scripts de schema se DECOUVRENT, ils ne s'enumerent pas.
#
# La liste etait ecrite en dur et s'arretait a 012_controles.sql : un fichier
# 013_* ajoute plus tard n'etait jamais joue. Et comme SQLite accepte sans
# broncher une vue creee sur une table absente, la base se construisait « ok »
# puis cassait a la premiere lecture de cette vue — le pire des deux mondes.
#
# Le tri est numerique par prefixe : l'ordre de creation compte (les tables
# avant les triggers, les triggers avant les vues, les vues avant les controles).
$scripts = @(
    Get-ChildItem -Path $root -Filter '*.sql' -File |
        Where-Object { $_.Name -match '^\d{3}_' } |
        Sort-Object Name |
        ForEach-Object { $_.Name }
)
if ($scripts.Count -lt 12) { throw "Seulement $($scripts.Count) scripts de schema trouves : verifier le repertoire $root." }

# Les seeds gardent un ordre EXPLICITE : 004_qualites depend de 002_securite,
# et 003_fournisseurs n'est charge qu'en demonstration. Les decouvrir par tri
# alphabetique inverserait ces dependances sans le dire.
$scripts += 'seed/001_referentiels.sql',
            'seed/002_securite.sql',
            'seed/004_qualites.sql'

# Les fournisseurs et le jeu SH ne sont charges qu'en mode demonstration : en
# exploitation, la source des fournisseurs est GESTION Fil.xlsx, via
# `gestionfil-import`. Charger les deux creerait les memes societes sous deux
# codes differents (HAS et FRS-001).
if ($Demo) {
    $scripts += 'seed/003_fournisseurs.sql', 'seed/900_demo_sh.sql', 'seed/901_demo_reception.sql',
                'seed/902_demo_alertes.sql'
}

foreach ($s in $scripts) {
    if (-not (Test-Path $s)) { throw "Script manquant : $s" }
    Write-Host ("  -> {0}" -f $s)
    $sql = Get-Content $s -Raw -Encoding UTF8
    $out = ($sql | & $sqlite -bail $Database) 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host $out -ForegroundColor Red
        throw "Echec sur $s"
    }
}

# Verifications structurelles
$fk = & $sqlite $Database "PRAGMA foreign_key_check;"
if ($fk) { Write-Host "Cles etrangeres en defaut :`n$fk" -ForegroundColor Red; throw "foreign_key_check a echoue" }

$integrity = & $sqlite $Database "PRAGMA integrity_check;"
if ($integrity -ne 'ok') { Write-Host $integrity -ForegroundColor Red; throw "integrity_check a echoue" }

$tables   = & $sqlite $Database "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
$vues     = & $sqlite $Database "SELECT COUNT(*) FROM sqlite_master WHERE type='view';"
$triggers = & $sqlite $Database "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger';"
$index    = & $sqlite $Database "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';"

Write-Host ""
Write-Host "Base construite : $Database" -ForegroundColor Green
Write-Host ("  tables   : {0}" -f $tables)
Write-Host ("  vues     : {0}" -f $vues)
Write-Host ("  triggers : {0}" -f $triggers)
Write-Host ("  index    : {0}" -f $index)
Write-Host ("  integrite: {0}" -f $integrity)

