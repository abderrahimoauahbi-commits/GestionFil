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
    [string] $Serveur = 'http://192.168.1.140:8080'
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

$paquet = Join-Path $racine 'src-tauri\target\release\bundle\nsis\Gestion Fil_0.1.0_x64-setup.exe'
if (-not (Test-Path $paquet)) { throw "installateur introuvable : $paquet" }

Write-Host ("`n==> Installateur : {0:N1} Mo" -f ((Get-Item $paquet).Length / 1MB)) -ForegroundColor Green
Write-Host "    $paquet"
Write-Host "`nA deposer sur le serveur sous le nom gestionfil-windows-<version>.exe :"
Write-Host "    scp '$paquet' sysadmin@192.168.1.140:/home/sysadmin/paquets/gestionfil-windows-0.1.0.exe"
