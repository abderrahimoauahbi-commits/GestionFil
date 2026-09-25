<#
.SYNOPSIS
    Fabrique l'installateur Windows du client de bureau.

.DESCRIPTION
    L'ADRESSE DU SERVEUR EST INSCRITE DANS LE PAQUET. Sans elle, l'application
    installee ne sait pas ou joindre l'ERP : elle interroge sa propre enveloppe
    et recoit sa page d'accueil en guise de reponse d'API. L'utilisateur devrait
    alors taper une adresse IP, ce qu'on ne demande pas a un magasinier.

    Elle reste MODIFIABLE apres coup — un clic sur la version, en bas de l'ecran
    de connexion, ouvre le reglage — parce qu'un serveur peut changer d'adresse
    et qu'on ne va pas reinstaller trente postes pour cela.

    POURQUOI L'INSTALLATEUR EST PETIT (environ deux megaoctets). Le client
    n'embarque pas de navigateur : il emploie WebView2, present d'origine dans
    Windows 10 depuis 2018. Les applications bati es sur Electron embarquent
    Chromium en entier, d'ou leurs cent a deux cents megaoctets.

.EXAMPLE
    .\fabriquer-client-bureau.ps1
    .\fabriquer-client-bureau.ps1 -Serveur http://192.168.1.50:8080
#>
[CmdletBinding()]
param(
    # LE SERVEUR EST EN HTTPS depuis sa mise en production : le port 8080 en
    # clair ne sert plus qu'au developpement. L'autorite interne doit etre
    # installee sur le poste, sinon WebView2 refuse le certificat — c'est la
    # seule condition prealable a l'installation.
    [string] $Serveur = 'https://192.168.1.140'
)

$ErrorActionPreference = 'Stop'
$racine = Split-Path -Parent $PSScriptRoot

Write-Host "`n==> Serveur inscrit dans le paquet : $Serveur" -ForegroundColor Cyan
$env:VITE_API_URL = $Serveur

Push-Location $racine
try {
    & npx vite build
    if ($LASTEXITCODE -ne 0) { throw "la compilation de l'interface a echoue" }

    & npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "la fabrication de l'installateur a echoue" }
} finally {
    Remove-Item Env:\VITE_API_URL -ErrorAction SilentlyContinue
    Pop-Location
}

# LA VERSION SE LIT DANS LA CONFIGURATION, elle ne se recopie pas ici :
# ecrite en dur, le script cherchait encore la 0.1.0 apres la premiere montee
# de version et s'arretait sur « installateur introuvable » alors qu'il
# venait de le fabriquer.
$version = (Get-Content (Join-Path $racine 'src-tauri\tauri.conf.json') -Raw |
            ConvertFrom-Json).version
# LE BUNDLE NE SUIT PAS TOUJOURS LE PROJET. Tauri obeit a CARGO_TARGET_DIR
# comme le reste de cargo : quand ce reglage existe, l'installateur est ecrit
# hors du depot, dans <CARGO_TARGET_DIR>\release\bundle. Meme cause et meme
# remede que pour la version ci-dessus — on demande, on ne suppose pas.
$racineCompil = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR }
                else { Join-Path $racine 'src-tauri\target' }
$paquet = Join-Path $racineCompil ("release\bundle\nsis\Gestion Fil_$($version)_x64-setup.exe")
if (-not (Test-Path $paquet)) { throw "installateur introuvable : $paquet" }

Write-Host ("`n==> Installateur : {0:N1} Mo" -f ((Get-Item $paquet).Length / 1MB)) -ForegroundColor Green
Write-Host "    $paquet"
Write-Host "`nA deposer sur le serveur sous le nom gestionfil-windows-<version>.exe :"
Write-Host "    scp '$paquet' sysadmin@192.168.1.140:/home/sysadmin/paquets/gestionfil-windows-$version.exe"
