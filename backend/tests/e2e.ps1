<#
.SYNOPSIS
    Verification de bout en bout de l'API : connexion, RBAC, masquage des prix,
    cascade de reception 3-en-1.

.DESCRIPTION
    Reconstruit la base avec le jeu de demonstration, definit les mots de passe,
    demarre le serveur, exerce l'API, puis controle l'etat de la base.

.EXAMPLE
    .\e2e.ps1
#>
[CmdletBinding()]
param([int] $Port = 8099)

$ErrorActionPreference = 'Stop'
$root     = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$racine   = Split-Path -Parent $root
$dbDir    = Join-Path $racine 'db'
$dbFile   = Join-Path $dbDir  'e2e.db'
$base     = "http://127.0.0.1:$Port"
$sqlite   = (Get-Command sqlite3).Source

$script:ok = 0
$script:ko = 0

function Verifier {
    param([string] $Nom, [scriptblock] $Test)
    try {
        $resultat = & $Test
        if ($resultat -eq $true) {
            Write-Host ("  OK     {0}" -f $Nom) -ForegroundColor Green
            $script:ok++
        } else {
            Write-Host ("  ECHEC  {0}" -f $Nom) -ForegroundColor Red
            Write-Host ("         {0}" -f $resultat)
            $script:ko++
        }
    } catch {
        Write-Host ("  ECHEC  {0}" -f $Nom) -ForegroundColor Red
        Write-Host ("         exception : {0}" -f $_.Exception.Message)
        $script:ko++
    }
}

function Sql { param([string] $Requete) (& $sqlite $dbFile $Requete) }

function Appel {
    param([string] $Methode, [string] $Route, [string] $Jeton, $Corps)
    $entetes = @{}
    if ($Jeton) { $entetes['Authorization'] = "Bearer $Jeton" }
    $p = @{ Uri = "$base$Route"; Method = $Methode; Headers = $entetes; ErrorAction = 'Stop' }
    if ($Corps) {
        $p['Body'] = ($Corps | ConvertTo-Json -Compress)
        $p['ContentType'] = 'application/json'
    }
    Invoke-RestMethod @p
}

function CodeHttp {
    param([string] $Methode, [string] $Route, [string] $Jeton)
    try {
        Appel $Methode $Route $Jeton | Out-Null
        return 200
    } catch {
        if ($_.Exception.Response) { return [int] $_.Exception.Response.StatusCode }
        throw
    }
}

# ---------------------------------------------------------------- preparation
Write-Host "Preparation de la base e2e..." -ForegroundColor Cyan
Push-Location $dbDir
& .\build.ps1 -Demo -Database 'e2e.db' | Out-Null
Pop-Location

Push-Location $root
$env:DATABASE_URL   = "sqlite://$($dbFile -replace '\\','/')"
$env:JWT_SECRET     = 'secret-de-test-e2e-suffisamment-long-pour-passer-la-validation'
$env:BIND_ADDR      = "127.0.0.1:$Port"
$env:RUST_LOG       = 'gestionfil=warn'

foreach ($compte in @('direction','achat','qualite','magasin','planif','daf')) {
    $env:GESTIONFIL_MOT_DE_PASSE = "MotDePasse-$compte-2026"
    & cargo run --quiet --bin gestionfil-admin -- definir-mot-de-passe $compte | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "definition du mot de passe echouee pour $compte" }
}
Remove-Item Env:\GESTIONFIL_MOT_DE_PASSE -ErrorAction SilentlyContinue

& cargo build --quiet --bin gestionfil
if ($LASTEXITCODE -ne 0) { throw "compilation du serveur echouee" }

# Le binaire se prend LA OU cargo vient de l'ecrire. Sans cela, une application
# deja lancee retient `target\debug\gestionfil.exe`, la compilation echoue sans
# bruit, et la suite tourne sur un binaire perime en annoncant des succes.
$cible   = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root 'target' }
$exe     = Join-Path $cible 'debug\gestionfil.exe'
if (-not (Test-Path $exe)) { throw "binaire introuvable : $exe" }
$serveur = Start-Process -FilePath $exe -NoNewWindow -PassThru
Pop-Location

try {
    # Attente du demarrage
    $pret = $false
    for ($i = 0; $i -lt 40; $i++) {
        try { Invoke-RestMethod "$base/api/sante" -ErrorAction Stop | Out-Null; $pret = $true; break }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $pret) { throw "le serveur n'a pas demarre sur $base" }

    Write-Host ""
    Write-Host "=== AUTHENTIFICATION ===" -ForegroundColor Cyan

    $jetons = @{}
    foreach ($compte in @('direction','achat','qualite','magasin','planif','daf')) {
        $r = Appel POST '/api/auth/connexion' $null @{ login = $compte; mot_de_passe = "MotDePasse-$compte-2026" }
        $jetons[$compte] = $r.jeton
    }
    Verifier "Connexion des 6 roles" { $jetons.Count -eq 6 -and $jetons['direction'] }

    Verifier "Mot de passe errone rejete (401)" {
        try {
            Appel POST '/api/auth/connexion' $null @{ login = 'direction'; mot_de_passe = 'faux' } | Out-Null
            "attendu 401, obtenu 200"
        } catch { ([int] $_.Exception.Response.StatusCode) -eq 401 }
    }

    Verifier "Acces sans jeton refuse (401)" { (CodeHttp GET '/api/cockpit' $null) -eq 401 }

    Verifier "Droits effectifs exposes par /auth/moi" {
        $moi = Appel GET '/api/auth/moi' $jetons['magasin']
        $modules = $moi.droits_champ.PSObject.Properties.Name
        ($moi.role -eq 'MAGASIN') -and ($moi.permissions.Count -gt 0) -and ($modules.Count -gt 5)
    }

    Write-Host ""
    Write-Host "=== RBAC (CDC D2) ===" -ForegroundColor Cyan

    Verifier "Magasinier : audit interdit (403)" { (CodeHttp GET '/api/audit' $jetons['magasin']) -eq 403 }
    Verifier "Direction  : audit autorise (200)" { (CodeHttp GET '/api/audit' $jetons['direction']) -eq 200 }
    Verifier "Magasinier : generation du plan d'achat interdite (403)" {
        (CodeHttp POST '/api/plan-achat/generer' $jetons['magasin']) -eq 403
    }
    Verifier "Acheteur   : generation du plan d'achat autorisee (200)" {
        (CodeHttp POST '/api/plan-achat/generer' $jetons['achat']) -eq 200
    }

    Write-Host ""
    Write-Host "=== MASQUAGE DES PRIX (CDC B4 regle 1) ===" -ForegroundColor Cyan

    Verifier "Magasinier : aucun prix dans le catalogue" {
        $cat = Appel GET '/api/catalogue?limite=5' $jetons['magasin']
        $premier = $cat[0]
        $interdits = @('prix_catalogue','prix_catalogue_kg','cmup_mad') |
                     Where-Object { $premier.PSObject.Properties.Name -contains $_ }
        if ($interdits) { "champs exposes a tort : $($interdits -join ', ')" } else { $true }
    }

    Verifier "Direction : les prix restent visibles" {
        $cat = Appel GET '/api/catalogue?limite=5' $jetons['direction']
        $cat[0].PSObject.Properties.Name -contains 'prix_catalogue'
    }

    Verifier "Magasinier : stock sans valorisation" {
        $st = Appel GET '/api/stock?limite=5' $jetons['magasin']
        -not ($st[0].PSObject.Properties.Name -contains 'cmup_mad')
    }

    Write-Host ""
    Write-Host "=== MRP ===" -ForegroundColor Cyan

    $idPlan = (Sql "SELECT id_plan FROM plan_production WHERE annee=2026 LIMIT 1;").Trim()

    Verifier "Besoin de juillet conforme a l'exemple F2 du CDC (56.32 kg)" {
        $b = Appel GET "/api/plans/$idPlan/besoins" $jetons['direction']
        $pp = $b | Where-Object { $_.code_reference -eq 'PP-3430' -and $_.mois -eq 7 }
        if ([math]::Abs($pp.quantite_brute_kg - 56.32) -lt 0.001) { $true }
        else { "attendu 56.32, obtenu $($pp.quantite_brute_kg)" }
    }

    # La matrice D2 reserve l'ecriture MRP au Planificateur : la Direction n'a
    # que la lecture. Le refus ci-dessous n'est pas un contournement du test,
    # c'est la regle.
    Verifier "Direction : ecriture MRP interdite (403, conforme a D2)" {
        (CodeHttp POST "/api/plans/$idPlan/mrp" $jetons['direction']) -eq 403
    }

    Verifier "Planificateur : recalcul MRP idempotent (pas de doublement)" {
        $avant = [int](Sql "SELECT COUNT(*) FROM besoin_mrp WHERE id_plan='$idPlan';").Trim()
        Appel POST "/api/plans/$idPlan/mrp" $jetons['planif'] | Out-Null
        Appel POST "/api/plans/$idPlan/mrp" $jetons['planif'] | Out-Null
        $apres = [int](Sql "SELECT COUNT(*) FROM besoin_mrp WHERE id_plan='$idPlan';").Trim()
        if ($avant -eq $apres) { $true } else { "avant $avant, apres 2 recalculs $apres" }
    }

    Verifier "DAF : valorisation lisible, ecriture catalogue interdite" {
        ((CodeHttp GET '/api/stock' $jetons['daf']) -eq 200) -and
        ((CodeHttp POST '/api/classification' $jetons['daf']) -eq 403)
    }

    Write-Host ""
    Write-Host "=== CASCADE RECEPTION 3-EN-1 (CDC G3) ===" -ForegroundColor Cyan

    $idRec = '00000000-0000-4000-a000-0000000000e1'

    Verifier "SoD : le magasinier peseur ne peut pas valider (422)" {
        (CodeHttp POST "/api/receptions/$idRec/valider" $jetons['magasin']) -eq 403 -or
        (CodeHttp POST "/api/receptions/$idRec/valider" $jetons['magasin']) -eq 422
    }

    Verifier "SoD : l'acheteur createur du BC ne peut pas controler (422)" {
        (CodeHttp POST "/api/receptions/$idRec/valider" $jetons['achat']) -eq 422 -or
        (CodeHttp POST "/api/receptions/$idRec/valider" $jetons['achat']) -eq 403
    }

    $resultat = $null
    Verifier "Controleur qualite : validation acceptee" {
        $script:resultat = Appel POST "/api/receptions/$idRec/valider" $jetons['qualite']
        $script:resultat.lignes_traitees -eq 1
    }

    Verifier "Stock augmente de 4800 kg (11100 -> 15900)" {
        $q = [double](Sql "SELECT quantite_kg FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01';").Trim()
        if ([math]::Abs($q - 15900) -lt 0.001) { $true } else { "obtenu $q" }
    }

    Verifier "CMUP recalcule en moyenne ponderee (29.0736)" {
        $c = [double](Sql "SELECT cmup_mad FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01';").Trim()
        if ([math]::Abs($c - 29.0736) -lt 0.0001) { $true } else { "attendu 29.0736, obtenu $c" }
    }

    Verifier "Archive de reception creee" {
        [int](Sql "SELECT COUNT(*) FROM archive_reception WHERE numero_reception='REC-2026-0001';").Trim() -eq 1
    }

    Verifier "Historique de prix : devise et MAD distincts (3.20 USD / 30.40 MAD)" {
        $l = (Sql "SELECT prix_kg_devise || '|' || code_devise || '|' || prix_kg_mad FROM historique_prix WHERE code_reference='PP-3430';").Trim()
        if ($l -eq '3.2|USD|30.4') { $true } else { "obtenu '$l'" }
    }

    Verifier "Ligne de BC soldee en kg" {
        $l = (Sql "SELECT quantite_recue_kg || '|' || statut FROM ligne_bc WHERE id_bc='00000000-0000-4000-a000-0000000000d1';").Trim()
        if ($l -eq '4800.0|SOLDE') { $true } else { "obtenu '$l'" }
    }

    Verifier "Bon de commande cloture" {
        (Sql "SELECT statut FROM bon_commande WHERE numero_bc='BC-2026-0001';").Trim() -eq 'CLOTURE'
    }

    Verifier "Stock par lot alimente (LOT-HAS-2603)" {
        $q = [double](Sql "SELECT quantite_kg FROM stock_lot WHERE lot_fournisseur='LOT-HAS-2603';").Trim()
        if ([math]::Abs($q - 4800) -lt 0.001) { $true } else { "obtenu $q" }
    }

    Verifier "Double validation refusee (transition interdite)" {
        (CodeHttp POST "/api/receptions/$idRec/valider" $jetons['qualite']) -eq 422
    }

    Write-Host ""
    Write-Host "=== DROITS PAR CHAMP, PAR UTILISATEUR ===" -ForegroundColor Cyan

    $idMagasin = (Sql "SELECT id_utilisateur FROM utilisateur WHERE login='magasin';").Trim()

    Verifier "Grille individuelle : un niveau par champ configurable et par utilisateur" {
        # Un champ declare sans niveau serait MASQUE par defaut : c'est le bon
        # repli, mais il doit resulter d'une decision, pas d'un oubli de seed.
        $n = [int](Sql "SELECT COUNT(*) FROM droit_champ WHERE id_utilisateur='$idMagasin';").Trim()
        $c = [int](Sql "SELECT COUNT(*) FROM champ_configurable;").Trim()
        if ($n -eq $c) { $true } else { "$n niveaux pour $c champs declares" }
    }

    Verifier "/auth/moi expose la grille complete par module" {
        $moi = Appel GET '/api/auth/moi' $jetons['magasin']
        ($moi.droits_champ.CATALOGUE.prix_catalogue -eq 'MASQUE') -and
        ($moi.droits_champ.CATALOGUE.code_reference -eq 'LECTURE')
    }

    Verifier "Ecriture refusee sur un champ masque (serveur, pas interface)" {
        try {
            Appel PATCH '/api/catalogue/PP-3430' $jetons['magasin'] @{ prix_catalogue = 99 } | Out-Null
            "attendu un refus, obtenu un succes"
        } catch { ([int] $_.Exception.Response.StatusCode) -in @(403, 400) }
    }

    Verifier "Ecriture refusee sur un champ en LECTURE SEULE" {
        # facteur_kg est en LECTURE pour tous : c'est une valeur derivee.
        try {
            Appel PATCH '/api/catalogue/PP-3430' $jetons['direction'] @{ facteur_kg = 1 } | Out-Null
            "attendu un refus, obtenu un succes"
        } catch { ([int] $_.Exception.Response.StatusCode) -in @(403, 400) }
    }

    Verifier "Ecriture acceptee sur un champ en ECRITURE" {
        $r = Appel PATCH '/api/catalogue/PP-3430' $jetons['direction'] @{ stock_min_kg = 13500 }
        $v = [double](Sql "SELECT stock_min_kg FROM reference WHERE code_reference='PP-3430';").Trim()
        if ($v -eq 13500) { $true } else { "valeur en base : $v" }
    }

    # Le coeur de l'exigence : deux utilisateurs, meme ecran, champs differents.
    Verifier "Changement de droit pris en compte immediatement" {
        $avant = Appel GET '/api/catalogue?limite=1' $jetons['magasin']
        $visibleAvant = $avant[0].PSObject.Properties.Name -contains 'prix_catalogue'

        Appel PUT "/api/admin/utilisateurs/$idMagasin/droits" $jetons['direction'] @{
            droits = @(@{ module = 'CATALOGUE'; champ = 'prix_catalogue'; niveau = 'LECTURE' })
        } | Out-Null

        $apres = Appel GET '/api/catalogue?limite=1' $jetons['magasin']
        $visibleApres = $apres[0].PSObject.Properties.Name -contains 'prix_catalogue'

        if (-not $visibleAvant -and $visibleApres) { $true }
        else { "avant=$visibleAvant apres=$visibleApres (attendu : faux puis vrai)" }
    }

    Verifier "Visible ne veut pas dire modifiable" {
        # prix_catalogue vient de passer en LECTURE pour le magasinier : il le
        # voit desormais, mais ne doit toujours pas pouvoir l'ecrire.
        try {
            Appel PATCH '/api/catalogue/PP-3430' $jetons['magasin'] @{ prix_catalogue = 99 } | Out-Null
            "attendu un refus, obtenu un succes"
        } catch { ([int] $_.Exception.Response.StatusCode) -in @(403, 400) }
    }

    Verifier "Retour au modele du role restaure la grille" {
        Appel POST "/api/admin/utilisateurs/$idMagasin/droits/appliquer-modele" $jetons['direction'] @{
            module = 'CATALOGUE'
        } | Out-Null
        $apres = Appel GET '/api/catalogue?limite=1' $jetons['magasin']
        -not ($apres[0].PSObject.Properties.Name -contains 'prix_catalogue')
    }

    Verifier "Changement de droit trace dans le journal d'audit" {
        $n = [int](Sql "SELECT COUNT(*) FROM audit_log WHERE table_concernee='droit_champ';").Trim()
        if ($n -gt 0) { $true } else { "aucune trace d'audit sur droit_champ" }
    }

    Verifier "Magasinier : administration des utilisateurs interdite (403)" {
        (CodeHttp GET '/api/admin/utilisateurs' $jetons['magasin']) -eq 403
    }

    Write-Host ""
    Write-Host "=== COHERENCE APRES OPERATIONS ===" -ForegroundColor Cyan

    Verifier "Aucun controle BLOQUANT en anomalie" {
        $n = [int](Sql "SELECT COALESCE(SUM(anomalies),0) FROM v_controles WHERE criticite='BLOQUANT';").Trim()
        if ($n -eq 0) { $true } else { "$n anomalie(s) bloquante(s)" }
    }

    Verifier "Solde de stock = grand livre" {
        [int](Sql "SELECT COUNT(*) FROM v_ctl_c11;").Trim() -eq 0
    }

    Verifier "Journal d'audit alimente et nominatif" {
        $n = [int](Sql "SELECT COUNT(*) FROM audit_log WHERE table_concernee='reception' AND id_utilisateur IS NOT NULL;").Trim()
        if ($n -ge 1) { $true } else { "aucune entree d'audit nominative" }
    }

    Verifier "Cockpit coherent apres reception" {
        $c = Appel GET '/api/cockpit' $jetons['direction']
        $c.valeur_stock_mad -gt 0 -and $c.nb_references -gt 0
    }
}
finally {
    if ($serveur -and -not $serveur.HasExited) { Stop-Process -Id $serveur.Id -Force }
    Remove-Item $dbFile, "$dbFile-wal", "$dbFile-shm" -ErrorAction SilentlyContinue
    # Sans ce nettoyage, la session garde DATABASE_URL pointe sur la base
    # jetable supprimee : la commande suivante echoue sans raison apparente.
    Remove-Item Env:\DATABASE_URL, Env:\JWT_SECRET, Env:\BIND_ADDR, Env:\RUST_LOG,
                Env:\GESTIONFIL_MOT_DE_PASSE -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host ("Reussis : {0}   Echecs : {1}" -f $script:ok, $script:ko) `
    -ForegroundColor $(if ($script:ko -eq 0) { 'Green' } else { 'Red' })
if ($script:ko -gt 0) { exit 1 }
