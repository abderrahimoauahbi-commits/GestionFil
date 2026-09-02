<#
.SYNOPSIS
    Fabrique le paquet de deploiement pour le serveur Ubuntu.

.DESCRIPTION
    Compile l'interface, compile le service POUR LINUX, et rassemble le tout
    dans une archive que `03-publier.sh` sait installer.

    POURQUOI COMPILER SUR LE SERVEUR ET NON ICI. Rust sait produire un binaire
    Linux depuis Windows, mais il faut une chaine de compilation croisee
    complete — l'editeur de liens, la bibliotheque C, les en-tetes. L'installer
    prend plus de temps que de compiler sur la machine cible, qui a quatre
    coeurs et quinze gigaoctets de memoire.

    L'INTERFACE, ELLE, SE COMPILE ICI : c'est du JavaScript, le resultat est
    identique quelle que soit la machine, et cela evite d'installer Node sur le
    serveur.

.EXAMPLE
    .\fabriquer-paquet.ps1
    .\fabriquer-paquet.ps1 -SansInterface   # binaires seuls
#>
[CmdletBinding()]
param(
    [switch] $SansInterface
)

$ErrorActionPreference = 'Stop'
$racine = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sortie = Join-Path $racine 'deploiement\paquet'
$date   = Get-Date -Format 'yyyyMMdd-HHmm'

function Dire($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# --- 1. L'interface ----------------------------------------------------------
if (-not $SansInterface) {
    Dire "Interface"
    Push-Location (Join-Path $racine 'frontend')
    try {
        if (-not (Test-Path 'node_modules')) { & npm install --silent }
        & npx vite build
        if ($LASTEXITCODE -ne 0) { throw "la compilation de l'interface a echoue" }
    } finally { Pop-Location }

    $dist = Join-Path $racine 'frontend\dist'
    if (-not (Test-Path (Join-Path $dist 'index.html'))) {
        throw "dist/index.html absent : la compilation n'a rien produit"
    }
    Write-Host ("  {0:N0} Ko" -f ((Get-ChildItem $dist -Recurse -File |
        Measure-Object -Property Length -Sum).Sum / 1KB))
}

# --- 2. Le paquet source pour le serveur -------------------------------------
# On envoie les SOURCES du service, pas un binaire : la compilation se fait sur
# la machine cible. Le dossier `target` est exclu — il pese des gigaoctets et ne
# sert a rien la-bas.
Dire "Assemblage"
if (Test-Path $sortie) { Remove-Item $sortie -Recurse -Force }
New-Item -ItemType Directory -Path $sortie -Force | Out-Null

Copy-Item (Join-Path $racine 'backend\src')        (Join-Path $sortie 'src')  -Recurse
Copy-Item (Join-Path $racine 'backend\Cargo.toml') $sortie
if (Test-Path (Join-Path $racine 'backend\Cargo.lock')) {
    # Le fichier de verrouillage part avec les sources : sans lui, le serveur
    # resoudrait les versions a sa facon et compilerait autre chose que ce qui
    # a ete verifie ici.
    Copy-Item (Join-Path $racine 'backend\Cargo.lock') $sortie
}
if (-not $SansInterface) {
    Copy-Item (Join-Path $racine 'frontend\dist') (Join-Path $sortie 'web') -Recurse
}

# Le script de compilation, joue sur le serveur.
@'
#!/usr/bin/env bash
# Compile le service sur le serveur, en mode release.
#
# `--locked` : la resolution des versions est celle du Cargo.lock envoye, pas
# une resolution fraiche. Sans cela, une version mineure publiee entre-temps
# entrerait dans la compilation sans que personne ne l'ait vue.
set -euo pipefail
cd "$(dirname "$0")"

command -v cargo >/dev/null 2>&1 || {
    echo "Rust absent. L'installer :"
    echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    echo "    source \$HOME/.cargo/env"
    exit 1
}

echo "Compilation (mode release, peut prendre quelques minutes)..."
cargo build --release --locked --bin gestionfil --bin gestionfil-admin --bin gestionfil-import

cp target/release/gestionfil        ./gestionfil
cp target/release/gestionfil-admin  ./gestionfil-admin
cp target/release/gestionfil-import ./gestionfil-import
strip ./gestionfil ./gestionfil-admin ./gestionfil-import 2>/dev/null || true

echo
echo "Binaires prets :"
ls -lh ./gestionfil ./gestionfil-admin ./gestionfil-import
'@ | Set-Content -Path (Join-Path $sortie 'compiler.sh') -Encoding UTF8 -NoNewline

# --- 3. L'archive ------------------------------------------------------------
Dire "Archive"
$archive = Join-Path $racine "deploiement\gestionfil-$date.tar.gz"
Push-Location $sortie
try {
    & tar -czf $archive .
    if ($LASTEXITCODE -ne 0) { throw "tar a echoue" }
} finally { Pop-Location }

$taille = (Get-Item $archive).Length / 1MB
Write-Host ("  {0}  ({1:N1} Mo)" -f (Split-Path $archive -Leaf), $taille) -ForegroundColor Green

Dire "Suite"
Write-Host @"
Sur le serveur :

    scp $(Split-Path $archive -Leaf) sysadmin@192.168.1.140:~/
    ssh sysadmin@192.168.1.140
    mkdir -p ~/gestionfil-build && tar -xzf ~/$(Split-Path $archive -Leaf) -C ~/gestionfil-build
    cd ~/gestionfil-build && bash compiler.sh
    tar -czf ~/gestionfil-pret.tar.gz gestionfil gestionfil-admin gestionfil-import web
    sudo bash /chemin/vers/03-publier.sh ~/gestionfil-pret.tar.gz
"@
