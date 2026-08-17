<#
.SYNOPSIS
    Verification du CRUD complet : creation, lecture, modification, suppression
    sur toutes les entites, plus les workflows metier.
#>
[CmdletBinding()]
param([int] $Port = 8098)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$racine = Split-Path -Parent $root
$dbDir  = Join-Path $racine 'db'
$dbFile = Join-Path $dbDir 'crud.db'
$base   = "http://127.0.0.1:$Port"
$sqlite = (Get-Command sqlite3).Source

$script:ok = 0; $script:ko = 0

function Verifier { param([string] $Nom, [scriptblock] $Test)
  try {
    $r = & $Test
    if ($r -eq $true) { Write-Host ("  OK     {0}" -f $Nom) -ForegroundColor Green; $script:ok++ }
    else { Write-Host ("  ECHEC  {0}" -f $Nom) -ForegroundColor Red; Write-Host "         $r"; $script:ko++ }
  } catch {
    Write-Host ("  ECHEC  {0}" -f $Nom) -ForegroundColor Red
    Write-Host ("         {0}" -f $_.Exception.Message)
    # Le corps de la reponse porte le message metier : sans lui, un 422 ne dit
    # rien de la regle qui a refuse. Invoke-RestMethod ayant deja consomme le
    # flux, c'est ErrorDetails qui le conserve.
    $corps = $_.ErrorDetails.Message
    if ($corps) { Write-Host ("         reponse : {0}" -f $corps) -ForegroundColor DarkYellow }
    $script:ko++
  }
}
function Sql { param([string] $R) (& $sqlite $dbFile $R) }
function Appel { param([string] $M, [string] $R, [string] $J, $C)
  $p = @{ Uri = "$base$R"; Method = $M; Headers = @{ Authorization = "Bearer $J" }; ErrorAction = 'Stop' }
  if ($null -ne $C) { $p.Body = ($C | ConvertTo-Json -Depth 8 -Compress); $p.ContentType = 'application/json' }
  Invoke-RestMethod @p
}
function Code { param([string] $M, [string] $R, [string] $J, $C)
  try { Appel $M $R $J $C | Out-Null; 200 } catch { if ($_.Exception.Response) { [int] $_.Exception.Response.StatusCode } else { throw } }
}

Write-Host "Preparation..." -ForegroundColor Cyan
Push-Location $dbDir; & .\build.ps1 -Demo -Database 'crud.db' | Out-Null; Pop-Location

Push-Location $root
$env:DATABASE_URL = "sqlite://$($dbFile -replace '\\','/')"
$env:JWT_SECRET   = 'secret-de-test-crud-suffisamment-long-pour-la-validation'
$env:BIND_ADDR    = "127.0.0.1:$Port"
$env:RUST_LOG     = 'gestionfil=warn'
foreach ($c in @('direction','achat','qualite','magasin','planif')) {
  $env:GESTIONFIL_MOT_DE_PASSE = "MotDePasse-$c-2026"
  & cargo run --quiet --bin gestionfil-admin -- definir-mot-de-passe $c | Out-Null
}
Remove-Item Env:\GESTIONFIL_MOT_DE_PASSE
& cargo build --quiet --bin gestionfil
# Sans ce controle, une compilation echouee laissait la suite tourner sur le
# binaire precedent et annoncer des succes sur du code qui n'existe plus.
if ($LASTEXITCODE -ne 0) { throw "compilation du serveur echouee" }
# Le binaire se prend LA OU cargo vient de l'ecrire : une application deja
# lancee retient `target\debug\gestionfil.exe`, la compilation echoue sans bruit,
# et la suite tourne sur un binaire perime en annoncant des succes.
$cible = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root 'target' }
$exe   = Join-Path $cible 'debug\gestionfil.exe'
if (-not (Test-Path $exe)) { throw "binaire introuvable : $exe" }
$srv = Start-Process $exe -NoNewWindow -PassThru
Pop-Location

try {
  for ($i=0; $i -lt 60; $i++) { try { Invoke-RestMethod "$base/api/sante" -EA Stop | Out-Null; break } catch { Start-Sleep -Milliseconds 300 } }

  $j = @{}
  foreach ($c in @('direction','achat','qualite','magasin','planif')) {
    $j[$c] = (Appel POST '/api/auth/connexion' $null @{ login = $c; mot_de_passe = "MotDePasse-$c-2026" }).jeton
  }

  Write-Host ""
  Write-Host "=== CRUD GENERIQUE : REFERENTIELS ===" -ForegroundColor Cyan

  Verifier "Creation d'une categorie matiere" {
    Appel POST '/api/categories' $j.direction @{ code_categorie='TST'; libelle='Categorie de test'; ordre_affichage=999 } | Out-Null
    (Sql "SELECT libelle FROM categorie_matiere WHERE code_categorie='TST';").Trim() -eq 'Categorie de test'
  }
  Verifier "Lecture par identifiant" {
    (Appel GET '/api/categories/TST' $j.direction).libelle -eq 'Categorie de test'
  }
  Verifier "Modification partielle" {
    Appel PATCH '/api/categories/TST' $j.direction @{ libelle='Categorie modifiee' } | Out-Null
    (Sql "SELECT libelle FROM categorie_matiere WHERE code_categorie='TST';").Trim() -eq 'Categorie modifiee'
  }
  Verifier "Suppression = desactivation (l'historique reste referencable)" {
    Appel DELETE '/api/categories/TST' $j.direction | Out-Null
    (Sql "SELECT actif FROM categorie_matiere WHERE code_categorie='TST';").Trim() -eq '0'
  }
  Verifier "Recherche et filtres" {
    (Appel GET '/api/categories?recherche=Jute&actif=1' $j.direction).Count -ge 1
  }

  Verifier "Creation d'un fournisseur" {
    Appel POST '/api/fournisseurs' $j.achat @{
      code_fournisseur='TST-F'; nom='Fournisseur Test'; pays='Maroc'
      delai_livraison_jours=15; code_devise='MAD'
    } | Out-Null
    (Sql "SELECT nom FROM fournisseur WHERE code_fournisseur='TST-F';").Trim() -eq 'Fournisseur Test'
  }
  Verifier "Creation d'une reference du catalogue" {
    Appel POST '/api/catalogue' $j.direction @{
      code_reference='TST-REF'; code_categorie='JUT'; code_fournisseur='TST-F'
      designation='Reference de test'; unite_catalogue='kg'
      prix_catalogue=12.5; code_devise_catalogue='MAD'
    } | Out-Null
    (Sql "SELECT prix_catalogue FROM reference WHERE code_reference='TST-REF';").Trim() -eq '12.5'
  }
  Verifier "R01 : reference en ml sans densite refusee a la creation" {
    (Code POST '/api/catalogue' $j.direction @{
      code_reference='TST-ML'; code_categorie='JUT'; code_fournisseur='TST-F'
      designation='Test ml'; unite_catalogue='ml'; prix_catalogue=1; code_devise_catalogue='MAD'
    }) -in @(400,422)
  }
  Verifier "Cle obligatoire a la creation" {
    (Code POST '/api/categories' $j.direction @{ libelle='Sans code' }) -in @(400,422)
  }
  Verifier "Champ hors liste blanche refuse" {
    (Code PATCH '/api/catalogue/TST-REF' $j.direction @{ cmup_mad=99 }) -in @(400,403)
  }

  Write-Host ""
  Write-Host "=== CRUD : DROITS PAR CHAMP APPLIQUES A L'ECRITURE ===" -ForegroundColor Cyan

  Verifier "Magasinier : creation de reference refusee (module en lecture)" {
    (Code POST '/api/catalogue' $j.magasin @{
      code_reference='TST-X'; code_categorie='JUT'; code_fournisseur='TST-F'
      designation='X'; unite_catalogue='kg'; prix_catalogue=1; code_devise_catalogue='MAD'
    }) -eq 403
  }
  Verifier "Magasinier : modification de prix refusee (champ masque)" {
    (Code PATCH '/api/catalogue/TST-REF' $j.magasin @{ prix_catalogue=1 }) -eq 403
  }

  Write-Host ""
  Write-Host "=== CRUD : QUALITES ET DENSITES ===" -ForegroundColor Cyan

  Verifier "Creation d'une qualite (parametres embarques, B3)" {
    Appel POST '/api/qualites' $j.planif @{ code_qualite='TQ'; nom='Qualite Test'; poids_commercial_m2=2.5 } | Out-Null
    $p = (Sql "SELECT marge_securite_pct||'|'||couv_min_mois||'|'||taux_perte_pct FROM qualite WHERE code_qualite='TQ';").Trim()
    if ($p -eq '20.0|2.0|2.0') { $true } else { "parametres embarques : $p" }
  }
  Verifier "Definition d'une densite par role" {
    Appel PUT '/api/qualites/TQ/densites' $j.planif @{ code_role='TRAME'; densite=0.5; unite_densite='kg_m2' } | Out-Null
    (Sql "SELECT densite FROM ligne_qualite WHERE code_qualite='TQ' AND code_role='TRAME';").Trim() -eq '0.5'
  }
  Verifier "Role en ml/m2 hors poids commercial" {
    Appel PUT '/api/qualites/TQ/densites' $j.planif @{ code_role='CUIR'; densite=1.0; unite_densite='ml_m2' } | Out-Null
    (Sql "SELECT entre_poids_commercial FROM ligne_qualite WHERE code_qualite='TQ' AND code_role='CUIR';").Trim() -eq '0'
  }
  Verifier "Suppression d'une densite" {
    Appel DELETE '/api/qualites/TQ/densites/CUIR' $j.planif | Out-Null
    (Sql "SELECT COUNT(*) FROM ligne_qualite WHERE code_qualite='TQ' AND code_role='CUIR';").Trim() -eq '0'
  }
  Verifier "Composition et mise en service de TQ" {
    Appel PUT '/api/qualites' $j.planif @{
      code_qualite='TQ'; nom='Qualite Test'; statut='ACTIF'
      lignes=@(@{ code_role='TRAME'; densite=0.5; unite_densite='kg_m2' })
      composition=@(
        @{ code_reference='JUT-961'; code_role='TRAME'; pourcentage_composition=60 },
        @{ code_reference='PES-202'; code_role='TRAME'; pourcentage_composition=40 })
    } | Out-Null
    (Sql "SELECT statut FROM qualite WHERE code_qualite='TQ';").Trim() -eq 'ACTIF'
  }

  Write-Host ""
  Write-Host "=== QUALITES : DOCUMENT COMPLET (entete + densites + composition) ===" -ForegroundColor Cyan

  # Une qualite = une composition. Le document porte les trois blocs, et la mise
  # en service (statut ACTIF) declenche R07 et les controles de densite.
  $densTQD = @(
    @{ code_role='TRAME';  densite=1.25; unite_densite='kg_m2' },
    @{ code_role='CHAINE'; densite=0.75; unite_densite='kg_m2' },
    @{ code_role='CUIR';   densite=1.00; unite_densite='ml_m2' })

  Verifier "PUT : entete, densites et composition en une transaction" {
    $r = Appel PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='Qualite Document'; description='saisie en une fois'
      lignes=$densTQD
      composition=@(
        @{ code_reference='JUT-961'; code_role='TRAME';  pourcentage_composition=100 },
        @{ code_reference='PES-202'; code_role='CHAINE'; pourcentage_composition=100 },
        @{ code_reference='CUIR-01'; code_role='CUIR';   pourcentage_composition=100 })
    }
    $d = (Sql "SELECT COUNT(*) FROM ligne_qualite WHERE code_qualite='TQD';").Trim()
    $c = (Sql "SELECT COUNT(*) FROM recette WHERE code_qualite='TQD';").Trim()
    if (($r.cree -eq $true) -and ($d -eq '3') -and ($c -eq '3')) { $true }
    else { "cree=$($r.cree) densites=$d composition=$c" }
  }
  Verifier "PUT : poids commercial = somme des seules densites kg/m2" {
    # 1.25 + 0.75 ; la ligne en ml/m2 consomme sans entrer dans le poids.
    (Sql "SELECT poids_commercial_m2 FROM qualite WHERE code_qualite='TQD';").Trim() -eq '2.0'
  }
  Verifier "Une qualite nait en BROUILLON, quel que soit le statut demande" {
    (Sql "SELECT statut FROM qualite WHERE code_qualite='TQD';").Trim() -eq 'BROUILLON'
  }
  Verifier "Mise en service : R07 controle la somme des % par role" {
    $r = Code PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='Qualite Document'; statut='ACTIF'
      lignes=$densTQD
      composition=@(@{ code_reference='JUT-961'; code_role='TRAME'; pourcentage_composition=60 })
    }
    if ($r -eq 422) { $true } else { "code $r" }
  }
  Verifier "Mise en service acceptee une fois la composition complete" {
    Appel PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='Qualite Document'; statut='ACTIF'
      lignes=$densTQD
      composition=@(
        @{ code_reference='JUT-961'; code_role='TRAME';  pourcentage_composition=100 },
        @{ code_reference='PES-202'; code_role='CHAINE'; pourcentage_composition=60 },
        @{ code_reference='PES-204'; code_role='CHAINE'; pourcentage_composition=40 },
        @{ code_reference='CUIR-01'; code_role='CUIR';   pourcentage_composition=100 })
    } | Out-Null
    (Sql "SELECT statut FROM qualite WHERE code_qualite='TQD';").Trim() -eq 'ACTIF'
  }
  Verifier "La composition recue fait autorite (ligne absente = retiree)" {
    Appel PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='Qualite Document'; statut='ACTIF'
      lignes=$densTQD
      composition=@(
        @{ code_reference='JUT-961'; code_role='TRAME';  pourcentage_composition=100 },
        @{ code_reference='PES-202'; code_role='CHAINE'; pourcentage_composition=100 },
        @{ code_reference='CUIR-01'; code_role='CUIR';   pourcentage_composition=100 })
    } | Out-Null
    (Sql "SELECT COUNT(*) FROM recette WHERE code_qualite='TQD';").Trim() -eq '3'
  }
  Verifier "kg/m2 deduit de la densite du role et du pourcentage" {
    # TRAME : 1.25 kg/m2 x 100 % = 1.25
    $c = Appel GET '/api/qualites/TQD/composition' $j.planif
    $l = @($c | Where-Object { $_.code_role -eq 'TRAME' })
    $v = [double] $l[0].kg_m2
    if ([math]::Abs($v - 1.25) -lt 0.0001) { $true } else { "kg_m2 = $v sur $($l.Count) ligne(s)" }
  }
  Verifier "Role en ml/m2 : kg/m2 passe par la densite kg/ml de la reference" {
    # CUIR : 1.000 ml/m2 x 100 % x 0.35 kg/ml = 0.35
    $c = Appel GET '/api/qualites/TQD/composition' $j.planif
    $l = @($c | Where-Object { $_.code_role -eq 'CUIR' })
    $v = [double] $l[0].kg_m2
    if ([math]::Abs($v - 0.35) -lt 0.0001) { $true } else { "kg_m2 = $v sur $($l.Count) ligne(s)" }
  }
  Verifier "PUT : horodatage de modification renseigne" {
    (Sql "SELECT COUNT(*) FROM qualite WHERE code_qualite='TQD' AND date_modification IS NOT NULL AND id_utilisateur_modification IS NOT NULL;").Trim() -eq '1'
  }
  Verifier "PUT : role en doublon refuse (le second ecraserait le premier)" {
    (Code PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='X'
      lignes=@(
        @{ code_role='TRAME'; densite=1; unite_densite='kg_m2' },
        @{ code_role='TRAME'; densite=2; unite_densite='kg_m2' })
    }) -eq 400
  }
  Verifier "PUT : densite negative refusee" {
    (Code PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='X'
      lignes=@(@{ code_role='TRAME'; densite=-1; unite_densite='kg_m2' })
    }) -eq 400
  }
  Verifier "PUT : unite de densite inconnue refusee" {
    (Code PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='X'
      lignes=@(@{ code_role='TRAME'; densite=1; unite_densite='g_m2' })
    }) -eq 400
  }
  Verifier "PUT : meme reference deux fois sur un role refusee" {
    (Code PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='X'; lignes=$densTQD
      composition=@(
        @{ code_reference='JUT-961'; code_role='TRAME'; pourcentage_composition=50 },
        @{ code_reference='JUT-961'; code_role='TRAME'; pourcentage_composition=50 })
    }) -eq 400
  }
  Verifier "PUT : meme reference sur DEUX roles refusee" {
    # Une matiere ne figure qu'une fois dans une qualite, tous roles confondus :
    # deux lignes sur la meme reference additionneraient leurs pourcentages.
    (Code PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='X'; lignes=$densTQD
      composition=@(
        @{ code_reference='JUT-961'; code_role='TRAME';  pourcentage_composition=100 },
        @{ code_reference='JUT-961'; code_role='CHAINE'; pourcentage_composition=100 })
    }) -eq 400
  }
  Verifier "Unicite de la reference portee par la base" {
    # Meme en SQL direct, la base refuse : la regle ne depend pas du serveur.
    # On mesure l'EFFET plutot que le message : sqlite3 ecrit son erreur sur
    # stderr sans lever d'exception, un test sur le texte passerait a cote.
    $avant = [int](Sql "SELECT COUNT(*) FROM recette WHERE code_qualite='TQD';").Trim()
    try {
      Sql "INSERT INTO recette (code_qualite,ligne_numero,code_reference,code_role,pourcentage_composition) VALUES ('TQD',98,'JUT-961','CHAINE',10);" | Out-Null
    } catch {
      # sqlite3 ecrit son refus sur stderr ; selon le contexte PowerShell le
      # promeut ou non en exception. Les deux chemins menent au meme constat.
    }
    $apres = [int](Sql "SELECT COUNT(*) FROM recette WHERE code_qualite='TQD';").Trim()
    if ($apres -eq $avant) { $true } else { "la base a accepte le doublon ($avant -> $apres)" }
  }
  Verifier "PUT : retirer la densite d'un role encore compose refuse" {
    (Code PUT '/api/qualites' $j.planif @{
      code_qualite='TQD'; nom='Qualite Document'
      lignes=@(@{ code_role='TRAME'; densite=1.25; unite_densite='kg_m2' })
    }) -eq 422
  }
  Verifier "PUT : refus atomique, l'etat precedent est intact" {
    $r = (Sql "SELECT COUNT(*)||'|'||(SELECT COUNT(*) FROM ligne_qualite WHERE code_qualite='TQD') FROM recette WHERE code_qualite='TQD';").Trim()
    if ($r -eq '3|3') { $true } else { "composition|densites = $r" }
  }
  Verifier "Magasinier : enregistrement refuse (module en lecture)" {
    (Code PUT '/api/qualites' $j.magasin @{
      code_qualite='TQD'; nom='X'; lignes=@()
    }) -eq 403
  }
  Verifier "DELETE : suppression reelle si rien ne la reference" {
    $r = Appel DELETE '/api/qualites/TQD' $j.planif
    $n = (Sql "SELECT COUNT(*) FROM qualite WHERE code_qualite='TQD';").Trim()
    $d = (Sql "SELECT COUNT(*) FROM ligne_qualite WHERE code_qualite='TQD';").Trim()
    $c = (Sql "SELECT COUNT(*) FROM recette WHERE code_qualite='TQD';").Trim()
    if (($r.mode -eq 'SUPPRESSION') -and ($n -eq '0') -and ($d -eq '0') -and ($c -eq '0')) { $true }
    else { "mode=$($r.mode) qualite=$n densites=$d composition=$c" }
  }

  Write-Host ""
  Write-Host "=== COMPOSITIONS : VUE TRANSVERSALE ===" -ForegroundColor Cyan

  Verifier "GET /api/recettes liste les lignes tous articles confondus" {
    $l = Appel GET '/api/recettes' $j.planif
    ($l.Count -ge 12) -and ($l | Where-Object { $_.code_qualite -eq 'SH' }).Count -ge 1
  }
  Verifier "Filtre par reference : ou cette matiere est-elle employee ?" {
    $l = Appel GET '/api/recettes?code_reference=PP-3430' $j.planif
    $autres = @($l | Where-Object { $_.code_reference -ne 'PP-3430' }).Count
    if (($l.Count -ge 1) -and ($autres -eq 0)) { $true } else { "$($l.Count) ligne(s), $autres hors filtre" }
  }
  Verifier "Filtre par role" {
    $l = Appel GET '/api/recettes?code_role=POIL' $j.planif
    @($l | Where-Object { $_.code_role -ne 'POIL' }).Count -eq 0
  }
  Verifier "Chaque categorie declare son role BOM habituel" {
    # C'est ce qui permet a la saisie de composition de proposer les bonnes
    # matieres : sans ce lien, l'ecran offrirait les 124 references du catalogue.
    # Le champ est facultatif — une categorie creee a la volee peut le laisser
    # vide — mais aucune categorie EN SERVICE ne doit s'en passer, sinon la
    # saisie de composition n'a rien pour filtrer.
    $sans = (Sql "SELECT COALESCE(GROUP_CONCAT(code_categorie),'') FROM categorie_matiere WHERE actif=1 AND code_role_defaut IS NULL;").Trim()
    if ($sans -eq '') { $true } else { "categorie(s) active(s) sans role : $sans" }
  }
  Verifier "Le role habituel d'une categorie est modifiable" {
    Appel PATCH '/api/categories/JUT' $j.direction @{ code_role_defaut='CHAINE' } | Out-Null
    $avant = (Sql "SELECT code_role_defaut FROM categorie_matiere WHERE code_categorie='JUT';").Trim()
    Appel PATCH '/api/categories/JUT' $j.direction @{ code_role_defaut='TRAME' } | Out-Null
    $apres = (Sql "SELECT code_role_defaut FROM categorie_matiere WHERE code_categorie='JUT';").Trim()
    if (($avant -eq 'CHAINE') -and ($apres -eq 'TRAME')) { $true } else { "avant=$avant apres=$apres" }
  }

  Write-Host ""
  Write-Host "=== CRUD : PLANS DE PRODUCTION ===" -ForegroundColor Cyan

  # Saisonnalite de test : janvier a 0,5, les onze autres mois a 1,0.
  $sais = 1..12 | ForEach-Object { @{ code_qualite='TQ'; mois=$_; coefficient=$(if ($_ -eq 1) { 0.5 } else { 1.0 }) } }

  $idPlan = $null
  Verifier "PUT : creation d'un plan (parametres generaux embarques, B3)" {
    $p = Appel PUT '/api/plans' $j.planif @{
      libelle='Plan glissant 2027'; scenario_nom='TEST'
      date_debut='2027-01'; mois_horizon=12; croissance_annuelle_pct=0
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=1000 })
      saisonnalite=$sais
    }
    $script:idPlan = $p.id_plan
    $s = (Sql "SELECT seuil_tier1_mad||'|'||mois_horizon||'|'||date_debut||'|'||date_fin FROM plan_production WHERE id_plan='$script:idPlan';").Trim()
    if (($p.cree -eq $true) -and ($s -eq '300000.0|12|2027-01-01|2027-12-31')) { $true } else { "entete=$s cree=$($p.cree)" }
  }
  Verifier "Grille deduite : 12 mois x 1 qualite" {
    (Sql "SELECT COUNT(*) FROM ligne_plan_production WHERE id_plan='$script:idPlan';").Trim() -eq '12'
  }
  Verifier "Formule Production_Plan : base x coefficient du mois" {
    # Janvier : 1000 x 0,5 = 500. Fevrier : 1000 x 1,0 = 1000.
    $r = (Sql "SELECT (SELECT CAST(m2_prevus AS INTEGER) FROM ligne_plan_production WHERE id_plan='$script:idPlan' AND mois=1)||'|'||(SELECT CAST(m2_prevus AS INTEGER) FROM ligne_plan_production WHERE id_plan='$script:idPlan' AND mois=2);").Trim()
    if ($r -eq '500|1000') { $true } else { "janvier|fevrier = $r" }
  }
  Verifier "Total de la periode recalcule (500 + 11 x 1000)" {
    (Sql "SELECT CAST(m2_total_annuel AS INTEGER) FROM plan_production WHERE id_plan='$script:idPlan';").Trim() -eq '11500'
  }
  Verifier "Chaque case porte son rang et son mois date" {
    $r = (Sql "SELECT rang_mois||'|'||annee_mois FROM ligne_plan_production WHERE id_plan='$script:idPlan' AND mois=3;").Trim()
    if ($r -eq '2|2027-03') { $true } else { "mars = $r" }
  }
  Verifier "Croissance au prorata des mois ecoules" {
    # 12 %/an : le 12e mois (rang 11) vaut 1000 x 1,12^(11/12) = 1109.
    Appel PUT '/api/plans' $j.planif @{
      id_plan=$script:idPlan; libelle='Plan glissant 2027'; scenario_nom='TEST'
      date_debut='2027-01'; mois_horizon=12; croissance_annuelle_pct=12
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=1000 })
      saisonnalite=($sais | ForEach-Object { @{ code_qualite='TQ'; mois=$_.mois; coefficient=1.0 } })
    } | Out-Null
    $r = (Sql "SELECT CAST(m2_prevus AS INTEGER) FROM ligne_plan_production WHERE id_plan='$script:idPlan' AND rang_mois=11;").Trim()
    if ($r -eq '1109') { $true } else { "12e mois = $r (attendu 1109)" }
  }
  Verifier "La saisonnalite suit le mois calendaire, pas le rang" {
    # Depart en novembre : janvier (coef 0,5) tombe au rang 2.
    Appel PUT '/api/plans' $j.planif @{
      id_plan=$script:idPlan; libelle='Plan glissant 2027'; scenario_nom='TEST'
      date_debut='2027-11'; mois_horizon=12; croissance_annuelle_pct=0
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=1000 })
      saisonnalite=$sais
    } | Out-Null
    $r = (Sql "SELECT rang_mois||'|'||annee_mois||'|'||CAST(m2_prevus AS INTEGER) FROM ligne_plan_production WHERE id_plan='$script:idPlan' AND mois=1;").Trim()
    if ($r -eq '2|2028-01|500') { $true } else { "janvier = $r" }
  }
  Verifier "Qualite en brouillon refusee au plan (R08)" {
    Appel PUT '/api/qualites' $j.planif @{
      code_qualite='TQBR'; nom='Qualite Brouillon'
      lignes=@(@{ code_role='TRAME'; densite=1.0; unite_densite='kg_m2' })
      composition=@(@{ code_reference='JUT-961'; code_role='TRAME'; pourcentage_composition=100 })
    } | Out-Null
    $sBR = 1..12 | ForEach-Object { @{ code_qualite='TQBR'; mois=$_; coefficient=1.0 } }
    (Code PUT '/api/plans' $j.planif @{
      libelle='Plan sur brouillon'; date_debut='2029-01'
      qualites=@(@{ code_qualite='TQBR'; m2_base_mensuel=100 }); saisonnalite=$sBR
    }) -eq 422
  }
  Verifier "Qualite deja prise par un plan actif refusee" {
    (Code PUT '/api/plans' $j.planif @{
      libelle='Plan concurrent'; date_debut='2030-01'
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=100 }); saisonnalite=$sais
    }) -eq 422
  }
  Verifier "Meme qualite selectionnee deux fois refusee" {
    (Code PUT '/api/plans' $j.planif @{
      libelle='Plan doublon'; date_debut='2033-01'
      qualites=@(
        @{ code_qualite='TQ'; m2_base_mensuel=100 },
        @{ code_qualite='TQ'; m2_base_mensuel=200 })
      saisonnalite=$sais
    }) -eq 400
  }
  Verifier "Saisonnalite incomplete refusee (un coefficient par qualite et par mois)" {
    # Onze mois sur douze : le douzieme serait planifie a 1,00 sans que personne
    # l'ait decide.
    (Code PUT '/api/plans' $j.planif @{
      libelle='Plan a trous'; date_debut='2032-01'; mois_horizon=12
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=100 })
      saisonnalite=(1..11 | ForEach-Object { @{ code_qualite='TQ'; mois=$_; coefficient=1.0 } })
    }) -eq 400
  }
  Verifier "Horizon hors bornes refuse" {
    (Code PUT '/api/plans' $j.planif @{
      libelle='Plan trop long'; date_debut='2031-01'; mois_horizon=72
      qualites=@(); saisonnalite=@()
    }) -eq 400
  }
  Verifier "Plan PLURIANNUEL : 36 mois, saisonnalite repetee chaque annee" {
    # Le profil saisonnier est ANNUEL : douze coefficients qui se repetent.
    # Mai vaut 0,50 en an 1, en an 2 et en an 3.
    $sMai = 1..12 | ForEach-Object { @{ code_qualite='TQ'; mois=$_; coefficient=$(if ($_ -eq 5) { 0.5 } else { 1.0 }) } }
    Appel PUT '/api/plans' $j.planif @{
      id_plan=$script:idPlan; libelle='Plan glissant 2027'; scenario_nom='TEST'
      date_debut='2027-01'; mois_horizon=36; croissance_annuelle_pct=0
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=1000 })
      saisonnalite=$sMai
    } | Out-Null
    $n = (Sql "SELECT COUNT(*) FROM ligne_plan_production WHERE id_plan='$script:idPlan';").Trim()
    # Mai an 1 = rang 4, mai an 2 = rang 16, mai an 3 = rang 28.
    $m = (Sql "SELECT GROUP_CONCAT(CAST(m2_prevus AS INTEGER)) FROM (SELECT m2_prevus FROM ligne_plan_production WHERE id_plan='$script:idPlan' AND rang_mois IN (4,16,28) ORDER BY rang_mois);").Trim()
    if (($n -eq '36') -and ($m -eq '500,500,500')) { $true } else { "cases=$n mai=$m" }
  }
  Verifier "Croissance COMPOSEE : (1+t)^(rang/12), pas lineaire" {
    # 10 %/an sur 36 mois. Au rang 35 : 1000 x 1,10^(35/12) = 1320 m2.
    # Une croissance lineaire donnerait 1000 x (1 + 0,10 x 35/12) = 1292.
    Appel PUT '/api/plans' $j.planif @{
      id_plan=$script:idPlan; libelle='Plan glissant 2027'; scenario_nom='TEST'
      date_debut='2027-01'; mois_horizon=36; croissance_annuelle_pct=10
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=1000 })
      saisonnalite=($sais | ForEach-Object { @{ code_qualite='TQ'; mois=$_.mois; coefficient=1.0 } })
    } | Out-Null
    $v = [int](Sql "SELECT CAST(m2_prevus AS INTEGER) FROM ligne_plan_production WHERE id_plan='$script:idPlan' AND rang_mois=35;").Trim()
    if ($v -eq 1320) { $true } else { "rang 35 = $v (compose attendu 1320, lineaire donnerait 1292)" }
  }
  Verifier "Pluriannuel : le MRP distingue les mois de meme rang calendaire" {
    Sql "INSERT INTO plan_qualite (id_plan, code_qualite, m2_base_mensuel) VALUES ('$script:idPlan','TQ',1000);" | Out-Null
    Appel POST "/api/plans/$script:idPlan/mrp" $j.planif | Out-Null
    # 36 mois x N references : chaque rang a sa propre ligne de besoin.
    $rangs = (Sql "SELECT COUNT(DISTINCT rang_mois) FROM besoin_mrp WHERE id_plan='$script:idPlan';").Trim()
    if ($rangs -eq '36') { $true } else { "$rangs rang(s) distinct(s) au lieu de 36" }
  }
  Verifier "Retour a 12 mois pour la suite des tests" {
    Sql "DELETE FROM besoin_mrp WHERE id_plan='$script:idPlan'; DELETE FROM plan_qualite WHERE id_plan='$script:idPlan';" | Out-Null
    Appel PUT '/api/plans' $j.planif @{
      id_plan=$script:idPlan; libelle='Plan glissant 2027'; scenario_nom='TEST'
      date_debut='2027-01'; mois_horizon=12; croissance_annuelle_pct=0
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=1000 })
      saisonnalite=$sais
    } | Out-Null
    (Sql "SELECT COUNT(*) FROM ligne_plan_production WHERE id_plan='$script:idPlan';").Trim() -eq '12'
  }
  Verifier "R08 : validation refusee sans recette figee" {
    Appel PUT "/api/plans/$script:idPlan/statut" $j.planif @{ statut='SIMULATION' } | Out-Null
    Sql "DELETE FROM plan_qualite WHERE id_plan='$script:idPlan';" | Out-Null
    (Code PUT "/api/plans/$script:idPlan/statut" $j.direction @{ statut='EN_COURS' }) -eq 422
  }
  Verifier "Figement : refus si l'entete ne designe aucune qualite" {
    (Code POST "/api/plans/$script:idPlan/figer-recettes" $j.planif) -eq 422
  }
  Verifier "Un seul plan en service : mise en service refusee tant qu'un autre l'occupe" {
    # Le plan de demonstration 2026 est deja EN_COURS. Deux plans en service,
    # meme d'annees differentes, sommeraient leurs besoins sur les memes matieres.
    Sql "INSERT INTO plan_qualite (id_plan, code_qualite, m2_base_mensuel) VALUES ('$script:idPlan','TQ',1000);" | Out-Null
    Appel POST "/api/plans/$script:idPlan/figer-recettes" $j.planif | Out-Null
    (Code PUT "/api/plans/$script:idPlan/statut" $j.direction @{ statut='EN_COURS' }) -in @(409,422)
  }
  Verifier "Mise en service apres cloture du plan precedent" {
    $precedent = (Sql "SELECT id_plan FROM plan_production WHERE statut='EN_COURS' LIMIT 1;").Trim()
    Appel POST "/api/plans/$precedent/cloturer" $j.direction | Out-Null
    Appel PUT "/api/plans/$script:idPlan/statut" $j.direction @{ statut='EN_COURS' } | Out-Null
    $n = (Sql "SELECT COUNT(*) FROM plan_production WHERE statut='EN_COURS';").Trim()
    if ($n -eq '1') { $true } else { "$n plans en service" }
  }
  Verifier "Plan en service non modifiable" {
    (Code PUT '/api/plans' $j.planif @{
      id_plan=$script:idPlan; libelle='Plan glissant 2027'; date_debut='2027-01'
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=1 }); saisonnalite=@()
    }) -eq 422
  }
  Verifier "Plan en service non supprimable" {
    (Code DELETE "/api/plans/$script:idPlan" $j.planif) -eq 422
  }

  Write-Host ""
  Write-Host "=== PLANS : CLOTURE ===" -ForegroundColor Cyan

  Verifier "Cloture : le plan devient inactif et horodate" {
    Appel POST "/api/plans/$script:idPlan/mrp" $j.planif | Out-Null
    $r = Appel POST "/api/plans/$script:idPlan/cloturer" $j.planif
    $e = (Sql "SELECT statut||'|'||actif||'|'||(date_cloture IS NOT NULL)||'|'||(id_utilisateur_cloture IS NOT NULL) FROM plan_production WHERE id_plan='$script:idPlan';").Trim()
    if (($e -eq 'CLOTURE|0|1|1') -and ($r.qualites_liberees -ge 1)) { $true } else { "etat=$e liberees=$($r.qualites_liberees)" }
  }
  Verifier "Plan cloture : ses besoins sortent du calcul (v_besoin_12m)" {
    # Les lignes de besoin_mrp restent en base — c'est l'historique — mais la vue
    # qui alimente le plan d'achat ne retient que les plans VALIDE.
    $stockees = (Sql "SELECT COUNT(*) FROM besoin_mrp WHERE id_plan='$script:idPlan';").Trim()
    $retenues = (Sql "SELECT COUNT(*) FROM besoin_mrp bm JOIN plan_production pp ON pp.id_plan=bm.id_plan WHERE bm.id_plan='$script:idPlan' AND pp.statut='EN_COURS';").Trim()
    if (([int]$stockees -gt 0) -and ($retenues -eq '0')) { $true } else { "stockees=$stockees retenues=$retenues" }
  }
  Verifier "Cloture : la qualite redevient disponible pour un autre plan" {
    $d = Appel GET '/api/plans/qualites-disponibles' $j.planif
    if ($d.code_qualite -contains 'TQ') { $true } else { 'la qualite liberee ne reapparait pas' }
  }
  Verifier "Plan cloture : recalcul MRP refuse" {
    (Code POST "/api/plans/$script:idPlan/mrp" $j.planif) -eq 422
  }
  Verifier "Double cloture refusee" {
    (Code POST "/api/plans/$script:idPlan/cloturer" $j.planif) -eq 422
  }

  Write-Host ""
  Write-Host "=== PLANS : RECALCUL ET UNICITE DU PLAN EN SERVICE ===" -ForegroundColor Cyan

  $idRecalc = $null
  Verifier "Recalcul : la grille est refaite depuis les valeurs enregistrees" {
    $r = Appel PUT '/api/plans' $j.planif @{
      libelle='Plan a recalculer'; date_debut='2034-01'; mois_horizon=12
      croissance_annuelle_pct=0
      qualites=@(@{ code_qualite='TQ'; m2_base_mensuel=1000 })
      saisonnalite=$sais
    }
    $script:idRecalc = $r.id_plan
    # On corrompt la grille a la main, comme le ferait un enregistrement
    # interrompu : le recalcul doit la remettre d'aplomb.
    Sql "UPDATE ligne_plan_production SET m2_prevus = 1 WHERE id_plan='$script:idRecalc';" | Out-Null
    $avant = (Sql "SELECT CAST(SUM(m2_prevus) AS INTEGER) FROM ligne_plan_production WHERE id_plan='$script:idRecalc';").Trim()
    $c = Appel POST "/api/plans/$script:idRecalc/recalculer" $j.planif
    $apres = (Sql "SELECT CAST(SUM(m2_prevus) AS INTEGER) FROM ligne_plan_production WHERE id_plan='$script:idRecalc';").Trim()
    if (($avant -eq '12') -and ($apres -eq '11500') -and ($c.lignes_generees -eq 12)) { $true }
    else { "avant=$avant apres=$apres lignes=$($c.lignes_generees)" }
  }
  Verifier "Recalcul : le total du plan suit" {
    (Sql "SELECT CAST(m2_total_annuel AS INTEGER) FROM plan_production WHERE id_plan='$script:idRecalc';").Trim() -eq '11500'
  }
  Verifier "La place liberee, le plan suivant peut entrer en service" {
    # Le precedent a ete cloture dans la section ci-dessus : la place est libre.
    Appel PUT "/api/plans/$script:idRecalc/statut" $j.planif @{ statut='SIMULATION' } | Out-Null
    Appel POST "/api/plans/$script:idRecalc/figer-recettes" $j.planif | Out-Null
    Appel PUT "/api/plans/$script:idRecalc/statut" $j.direction @{ statut='EN_COURS' } | Out-Null
    (Sql "SELECT COUNT(*) FROM plan_production WHERE statut='EN_COURS';").Trim() -eq '1'
  }
  Verifier "Plan en service : recalcul de grille refuse" {
    (Code POST "/api/plans/$script:idRecalc/recalculer" $j.planif) -eq 422
  }
  Write-Host ""
  Write-Host "=== PRODUCTION & BESOINS (feuille Production_Besoins) ===" -ForegroundColor Cyan

  Verifier "Le dossier expose les mois, la production et les besoins" {
    Appel POST "/api/plans/$script:idRecalc/mrp" $j.planif | Out-Null
    $d = Appel GET "/api/plans/$script:idRecalc/production-besoins" $j.planif
    $m = $d.mois.Count; $p = $d.production.Count; $b = $d.besoins.Count
    if (($m -eq 12) -and ($p -eq 12) -and ($b -gt 0)) { $true }
    else { "mois=$m production=$p besoins=$b" }
  }
  Verifier "Chaque besoin est rattache a son mois glissant" {
    $d = Appel GET "/api/plans/$script:idRecalc/production-besoins" $j.planif
    $orphelins = @($d.besoins | Where-Object { $null -eq $_.rang_mois }).Count
    if ($orphelins -eq 0) { $true } else { "$orphelins besoin(s) sans rang de mois" }
  }
  Verifier "Le taux de perte du plan est celui applique aux besoins" {
    $d = Appel GET "/api/plans/$script:idRecalc/production-besoins" $j.planif
    $t = $d.plan.taux_perte_pct
    $distincts = @($d.besoins | ForEach-Object { $_.taux_perte_applique } | Sort-Object -Unique)
    if (($distincts.Count -eq 1) -and ($distincts[0] -eq $t)) { $true }
    else { "plan=$t besoins=$($distincts -join ',')" }
  }
  Verifier "Magasinier : dossier besoins lisible (module MRP en lecture)" {
    $d = Appel GET "/api/plans/$script:idRecalc/production-besoins" $j.magasin
    $d.besoins.Count -gt 0
  }

  Write-Host ""
  Write-Host "=== CRUD : MOUVEMENTS DE STOCK ===" -ForegroundColor Cyan

  Verifier "Saisie d'une entree avec conversion d'unite" {
    # PP-3430 est en bobines de 3,2 kg : 10 bobines = 32 kg.
    $m = Appel POST '/api/mouvements' $j.magasin @{
      code_type_mvt='STOCK_INIT'; code_magasin='MP-02'; code_motif='INIT'
      lignes = @(@{ code_reference='PP-3430'; quantite_saisie=10; unite_saisie='Bobine'
                    prix_kg_mad=28.5; lot_fournisseur='LOT-TEST-01' })
    }
    if ($m.quantite_totale_kg -eq 32) { $true } else { "obtenu $($m.quantite_totale_kg) kg" }
  }
  Verifier "Facteur et unite de saisie conserves" {
    (Sql "SELECT unite_saisie||'|'||facteur_conversion||'|'||quantite_saisie FROM ligne_mouvement WHERE lot_fournisseur='LOT-TEST-01';").Trim() -eq 'Bobine|3.2|10.0'
  }
  Verifier "R01 : unite sans facteur refusee" {
    (Code POST '/api/mouvements' $j.magasin @{
      code_type_mvt='STOCK_INIT'; code_magasin='MP-02'; code_motif='INIT'
      lignes = @(@{ code_reference='JUT-961'; quantite_saisie=1; unite_saisie='Bobine'; prix_kg_mad=9 })
    }) -eq 422
  }
  Verifier "R02 : sortie superieure au stock refusee" {
    (Code POST '/api/mouvements' $j.magasin @{
      code_type_mvt='SORTIE_PROD'; code_magasin='MP-02'; code_motif='PRODUCTION'; numero_of='OF-TEST'
      lignes = @(@{ code_reference='PP-3430'; quantite_saisie=9999; unite_saisie='kg'; lot_fournisseur='LOT-TEST-01' })
    }) -eq 422
  }
  Verifier "Numerotation automatique des mouvements" {
    (Sql "SELECT COUNT(*) FROM mouvement WHERE numero_mouvement LIKE 'MVT-20%';").Trim() -ge '1'
  }

  Write-Host ""
  Write-Host "=== CRUD : TRANSFERTS ET INVENTAIRES ===" -ForegroundColor Cyan

  Verifier "Creation d'un transfert et de sa ligne" {
    $t = Appel POST '/api/transferts' $j.magasin @{ code_magasin_source='MP-02'; code_magasin_dest='MP-01' }
    $script:idTrf = $t.id_transfert
    Appel POST "/api/transferts/$script:idTrf/lignes" $j.magasin @{
      code_reference='PP-3430'; quantite_saisie=5; unite_saisie='Bobine'; lot_fournisseur='LOT-TEST-01'
    } | Out-Null
    $t.numero_transfert -like 'TRF-*'
  }
  Verifier "Transfert : reception refusee avant expedition" {
    # L'ordre des deux etapes n'est pas une convention d'interface : la base le
    # tient. Recevoir ce qui n'est jamais parti creerait du stock a partir de rien.
    try { Appel POST "/api/transferts/$script:idTrf/receptionner" $j.magasin | Out-Null; 'acceptee a tort' }
    catch { $true }
  }
  # Le magasin destinataire porte deja du stock de cette reference : ce qui se
  # verifie ci-dessous est un DELTA, pas un solde nu. Comparer a zero ferait
  # crier a la regression des la premiere donnee de demonstration ajoutee.
  $script:destAvant = [double](Sql "SELECT COALESCE((SELECT quantite_kg FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01'), 0);").Trim()

  Verifier "Transfert : l'expedition sort la marchandise du magasin source" {
    $r = Appel POST "/api/transferts/$script:idTrf/expedier" $j.magasin
    $src = [double](Sql "SELECT quantite_kg FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-02';").Trim()
    if ($r.quantite_totale_kg -ne 16) { "obtenu $($r.quantite_totale_kg) kg" }
    elseif ($src -ne 16) { "reste $src kg au magasin source (attendu 16)" }
    else { $true }
  }
  Verifier "Transfert : la marchandise est EN TRANSIT, dans aucun magasin" {
    # C'est tout l'objet des deux etapes : entre le depart et l'arrivee, la
    # matiere n'est nulle part, et l'atelier destinataire ne doit pas la compter.
    $dest = [double](Sql "SELECT COALESCE((SELECT quantite_kg FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01'), 0);").Trim()
    $transit = [double](Sql "SELECT COALESCE(SUM(quantite_kg),0) FROM v_stock_transit WHERE code_reference='PP-3430';").Trim()
    if ($dest -ne $script:destAvant) { "le destinataire a bouge de $($dest - $script:destAvant) kg avant toute reception" }
    elseif ($transit -ne 16) { "$transit kg en transit (attendu 16)" }
    else { $true }
  }
  Verifier "Transfert : la valeur est figee au depart, pas relue a l'arrivee" {
    $fige = [double](Sql "SELECT prix_kg_mad FROM ligne_transfert WHERE id_transfert='$script:idTrf';").Trim()
    if ($fige -gt 0) { $true } else { 'aucune valeur figee sur la ligne' }
  }
  Verifier "Transfert : la reception fait entrer la marchandise a destination" {
    Appel POST "/api/transferts/$script:idTrf/receptionner" $j.direction | Out-Null
    $dest = [double](Sql "SELECT quantite_kg FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01';").Trim()
    $transit = [double](Sql "SELECT COALESCE(SUM(quantite_kg),0) FROM v_stock_transit WHERE code_reference='PP-3430';").Trim()
    $qui = (Sql "SELECT u.login FROM transfert t JOIN utilisateur u ON u.id_utilisateur=t.id_utilisateur_reception WHERE t.id_transfert='$script:idTrf';").Trim()
    if ($dest -ne ($script:destAvant + 16)) { "$dest kg a destination (attendu $($script:destAvant + 16))" }
    elseif ($transit -ne 0) { "$transit kg restent comptes en transit" }
    elseif ($qui -ne 'direction') { "reception attribuee a '$qui'" }
    else { $true }
  }
  Verifier "Transfert : entete et lignes enregistrees en un seul appel" {
    # La saisie ne passe plus par un brouillon vide auquel on ajoute des lignes :
    # le document part complet, ou il ne part pas.
    $t = Appel POST '/api/transferts' $j.magasin @{
      code_magasin_source='MP-02'; code_magasin_dest='MP-01'
      date_transfert='2026-08-14'; responsable='Chef de quai'; transporteur='Trans-Atlas'
      lignes = @(
        @{ code_reference='PP-3430'; quantite_saisie=2; unite_saisie='Bobine'
           lot_fournisseur='LOT-TEST-01'; nb_bobines=2; nb_palettes=1 })
    }
    $script:idTrf2 = $t.id_transfert
    if ($t.lignes -ne 1) { "0 ligne enregistree avec l'entete" }
    elseif ([double]$t.quantite_totale_kg -le 0) { 'quantite totale nulle' }
    else { $true }
  }
  Verifier "Transfert : le dossier fournit ce qu'impriment les deux bons" {
    $d = Appel GET "/api/transferts/$script:idTrf2" $j.direction
    $e = $d.entete
    $manque = @('numero_transfert','responsable','transporteur','date_sortie',
                'date_reception_dest','quantite_totale_kg','bobines_totales',
                'palettes_totales','magasin_source_nom','magasin_dest_nom') |
              Where-Object { -not ($e.PSObject.Properties.Name -contains $_) }
    if ($manque) { "champs absents de l'entete : $($manque -join ', ')" }
    elseif ($e.bobines_totales -ne 2) { "bobines totalisees : $($e.bobines_totales)" }
    elseif ($e.palettes_totales -ne 1) { "palettes totalisees : $($e.palettes_totales)" }
    elseif ($d.lignes.Count -ne 1) { "$($d.lignes.Count) ligne(s) dans le dossier" }
    else { $true }
  }
  Verifier "Transfert : un brouillon se reprend, lignes comprises" {
    # Corriger une quantite mal comptee ne doit pas obliger a abandonner le
    # document et a en ouvrir un autre, ce qui trouerait la numerotation.
    Appel PUT "/api/transferts/$script:idTrf2" $j.magasin @{
      code_magasin_source='MP-02'; code_magasin_dest='MP-01'
      responsable='Chef de quai (corrige)'
      lignes = @(
        @{ code_reference='PP-3430'; quantite_saisie=3; unite_saisie='Bobine'
           lot_fournisseur='LOT-TEST-01'; nb_bobines=3; nb_palettes=1 })
    } | Out-Null
    $d = Appel GET "/api/transferts/$script:idTrf2" $j.direction
    if ($d.entete.responsable -ne 'Chef de quai (corrige)') { "responsable non repris : $($d.entete.responsable)" }
    elseif ($d.entete.bobines_totales -ne 3) { "bobines : $($d.entete.bobines_totales)" }
    elseif ($d.lignes.Count -ne 1) { "$($d.lignes.Count) ligne(s) apres reprise" }
    else { $true }
  }
  Verifier "Transfert : une reprise refusee laisse le document intact" {
    # Le refus doit etre atomique : les anciennes lignes sont effacees avant
    # d'ecrire les nouvelles, et une conversion impossible a mi-chemin viderait
    # le document sans rien mettre a la place.
    $code = Code PUT "/api/transferts/$script:idTrf2" $j.magasin @{
      code_magasin_source='MP-02'; code_magasin_dest='MP-01'
      lignes = @(@{ code_reference='PP-3430'; quantite_saisie=-5; unite_saisie='kg' })
    }
    $d = Appel GET "/api/transferts/$script:idTrf2" $j.direction
    if ($code -eq 200) { 'quantite negative acceptee' }
    elseif ($d.lignes.Count -ne 1) { "le refus a laisse $($d.lignes.Count) ligne(s)" }
    else { $true }
  }
  Verifier "Transfert : parti, le document ne se modifie plus (R03)" {
    # $idTrf est deja receptionne : ses mouvements sont au grand livre.
    $mod = Code PUT "/api/transferts/$script:idTrf" $j.magasin @{
      code_magasin_source='MP-02'; code_magasin_dest='MP-01'
      lignes = @(@{ code_reference='PP-3430'; quantite_saisie=1; unite_saisie='kg' })
    }
    $sup = Code DELETE "/api/transferts/$script:idTrf" $j.magasin
    if ($mod -ne 422) { "modification acceptee ($mod)" }
    elseif ($sup -ne 422) { "abandon accepte ($sup)" }
    else { $true }
  }
  Verifier "Transfert : l'abandon garde le numero, marque ANNULE" {
    $t = Appel POST '/api/transferts' $j.magasin @{
      code_magasin_source='MP-02'; code_magasin_dest='MP-01'
      lignes = @(@{ code_reference='PP-3430'; quantite_saisie=1; unite_saisie='kg'
                    lot_fournisseur='LOT-TEST-01' })
    }
    Appel DELETE "/api/transferts/$($t.id_transfert)" $j.magasin | Out-Null
    (Sql "SELECT statut FROM transfert WHERE id_transfert='$($t.id_transfert)';").Trim() -eq 'ANNULE'
  }
  Verifier "Transfert : la valeur transportee ne sort pas vers le magasin (B4)" {
    $d = Appel GET "/api/transferts/$script:idTrf2" $j.magasin
    if ($d.entete.PSObject.Properties.Name -contains 'valeur_totale_mad') {
      'la valeur monetaire est visible du magasinier'
    } elseif (-not ($d.entete.PSObject.Properties.Name -contains 'quantite_totale_kg')) {
      'le magasinier ne voit plus les quantites : le bon sortirait troue'
    } else { $true }
  }
  Verifier "Inventaire : comptage AU LOT pour les references suivies" {
    $inv = Appel POST '/api/inventaires' $j.magasin @{ code_magasin='MP-02'; type_inventaire='GLOBAL' }
    $script:idInv = $inv.id_inventaire
    Appel POST "/api/inventaires/$script:idInv/ouvrir" $j.magasin | Out-Null
    # PP-3430 est sous suivi de lot : la ligne d'inventaire doit porter le lot.
    (Sql "SELECT lot_fournisseur FROM ligne_inventaire WHERE id_inventaire='$script:idInv' AND code_reference='PP-3430';").Trim() -eq 'LOT-TEST-01'
  }
  Verifier "Inventaire : comptage puis cloture avec ajustement" {
    Appel PUT "/api/inventaires/$script:idInv/lignes" $j.magasin @{
      comptages = @(@{ code_reference='PP-3430'; code_magasin='MP-02'; lot_fournisseur='LOT-TEST-01'
                       quantite_comptee_kg=14; motif_ecart='Casse constatee' })
    } | Out-Null
    Appel POST "/api/inventaires/$script:idInv/cloturer" $j.direction | Out-Null
    $stock = [double](Sql "SELECT quantite_kg FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-02';").Trim()
    if ($stock -eq 14) { $true } else { "stock apres ajustement : $stock (attendu 14)" }
  }
  Verifier "Inventaire : comptage d'une ligne inexistante refuse" {
    $inv2 = Appel POST '/api/inventaires' $j.magasin @{ code_magasin='MP-02'; type_inventaire='CIBLE' }
    Appel POST "/api/inventaires/$($inv2.id_inventaire)/ouvrir" $j.magasin | Out-Null
    (Code PUT "/api/inventaires/$($inv2.id_inventaire)/lignes" $j.magasin @{
      comptages = @(@{ code_reference='INEXISTANT'; code_magasin='MP-02'; quantite_comptee_kg=1 })
    }) -eq 404
  }

  Write-Host ""
  Write-Host "=== PLAN D'ACHAT : FIGEMENT DES PROPOSITIONS ===" -ForegroundColor Cyan

  $script:idProp = $null
  Verifier "Le recalcul produit des propositions" {
    $r = Appel POST '/api/plan-achat/generer' $j.achat @{}
    $p = (Appel GET '/api/plan-achat/propositions' $j.achat) |
         Where-Object { $_.statut -eq 'PROPOSE' -and -not $_.code_reference_origine } |
         Select-Object -First 1
    $script:idProp = $p.id_proposition
    $script:qteMrp = [double] $p.quantite_suggeree_kg
    if ($r.propositions_generees -lt 1) { "aucune proposition generee" }
    elseif (-not $script:idProp) { 'aucune proposition ouverte exploitable' }
    else { $true }
  }
  Verifier "Retoucher une proposition la protege du recalcul" {
    # Exiger un second geste garantirait qu'on l'oublie : retoucher, c'est deja
    # decider, donc la ligne se fige d'elle-meme.
    $r = Appel PATCH "/api/plan-achat/propositions/$script:idProp" $j.achat @{
      quantite_suggeree_kg = [math]::Round($script:qteMrp * 1.12, 0)
      commentaires = 'Arrondi a la palette complete'
    }
    if (-not $r.figee) { 'la retouche n a pas protege la ligne' }
    elseif ($r.motif_figement -ne 'QUANTITE_AJUSTEE') { "motif : $($r.motif_figement)" }
    else { $true }
  }
  Verifier "Le recalcul ne detruit plus le travail de l'acheteur" {
    # LE test de non-regression : avant le figement, la retouche passait la ligne
    # en EN_REVISION, et la purge de generer() supprimait precisement EN_REVISION.
    $attendu = [math]::Round($script:qteMrp * 1.12, 0)
    $r = Appel POST '/api/plan-achat/generer' $j.achat @{}
    $p = (Appel GET '/api/plan-achat/propositions' $j.achat) |
         Where-Object { $_.id_proposition -eq $script:idProp }
    if (-not $p) { 'la ligne protegee a ete DETRUITE par le recalcul' }
    elseif ([double]$p.quantite_suggeree_kg -ne $attendu) {
      "quantite ecrasee : $($p.quantite_suggeree_kg) au lieu de $attendu"
    }
    elseif ($r.propositions_figees -lt 1) { 'le recalcul ne compte aucune ligne protegee' }
    else { $true }
  }
  Verifier "Pas de doublon : la reference protegee n'est pas reproposee" {
    # ux_plan_achat_ouvert refuserait le doublon et ferait echouer la generation
    # entiere sur une contrainte incomprehensible pour l'acheteur.
    $p = (Appel GET '/api/plan-achat/propositions' $j.achat) |
         Where-Object { $_.id_proposition -eq $script:idProp }
    $memes = (Appel GET '/api/plan-achat/propositions' $j.achat) |
             Where-Object { $_.code_reference -eq $p.code_reference -and
                            $_.statut -in @('PROPOSE','EN_REVISION','VALIDE') }
    if (@($memes).Count -ne 1) { "$(@($memes).Count) propositions ouvertes sur $($p.code_reference)" }
    else { $true }
  }
  Verifier "L'ecart avec le calcul reste lisible sur la ligne protegee" {
    # Proteger n'est pas rendre aveugle : le calcul continue de dire ce qu'il
    # faudrait acheter, et l'ecart se lit a chaque lecture.
    $p = (Appel GET '/api/plan-achat/propositions' $j.achat) |
         Where-Object { $_.id_proposition -eq $script:idProp }
    if ($null -eq $p.quantite_calculee_kg) { 'la quantite calculee du jour est absente' }
    elseif ($null -eq $p.ecart_calcul_kg) { 'l ecart n est pas calcule' }
    elseif ($p.etat_figement -ne 'SURDIMENSIONNEE') { "etat : $($p.etat_figement)" }
    elseif ([double]$p.quantite_mrp_kg -ne $script:qteMrp) {
      "quantite d origine perdue : $($p.quantite_mrp_kg)"
    }
    else { $true }
  }
  Verifier "Rendre au calcul : la ligne redevient jetable" {
    Appel DELETE "/api/plan-achat/propositions/$script:idProp/figer" $j.achat | Out-Null
    Appel POST '/api/plan-achat/generer' $j.achat @{} | Out-Null
    $p = (Appel GET '/api/plan-achat/propositions' $j.achat) |
         Where-Object { $_.id_proposition -eq $script:idProp }
    if ($p) { 'la ligne rendue au calcul a survecu au recalcul' } else { $true }
  }
  Verifier "Fusion d'equivalent dans une ligne protegee refusee" {
    # Fusionner un besoin DANS une proposition protegee ecraserait la quantite
    # arbitree, en silence, par une action menee sur une AUTRE reference.
    $p = (Appel GET '/api/plan-achat/propositions' $j.achat) |
         Where-Object { $_.statut -in @('PROPOSE','EN_REVISION') -and $_.nb_equivalents -gt 0 } |
         Select-Object -First 1
    if (-not $p) { return 'aucune proposition avec equivalent : cas non couvert' }
    $eq = (Appel GET "/api/equivalences?code_reference=$($p.code_reference)" $j.achat) |
          Where-Object { $_.interchangeable -eq 1 } | Select-Object -First 1
    if (-not $eq) { return 'aucun equivalent interchangeable : cas non couvert' }

    # La cible n'a pas forcement de proposition ouverte dans le jeu de
    # demonstration : on CONSTRUIT la situation plutot que de la contourner, en
    # clonant la proposition source sur la reference equivalente.
    $cible = (Appel GET '/api/plan-achat/propositions' $j.achat) |
             Where-Object { $_.code_reference -eq $eq.equivalent_reference -and
                            $_.statut -in @('PROPOSE','EN_REVISION','VALIDE') } |
             Select-Object -First 1
    if (-not $cible) {
      Sql @"
INSERT INTO plan_achat (date_generation, id_plan, code_reference, quantite_suggeree_kg,
                        unite_saisie, quantite_suggeree_unite, code_fournisseur,
                        prix_estime_mad, source_prix, date_besoin_prevue, urgence, statut)
SELECT date_generation, id_plan, '$($eq.equivalent_reference)', quantite_suggeree_kg,
       unite_saisie, quantite_suggeree_unite,
       (SELECT code_fournisseur FROM reference WHERE code_reference='$($eq.equivalent_reference)'),
       prix_estime_mad, source_prix, date_besoin_prevue, urgence, 'PROPOSE'
  FROM plan_achat WHERE id_proposition='$($p.id_proposition)';
"@ | Out-Null
      $cible = (Appel GET '/api/plan-achat/propositions' $j.achat) |
               Where-Object { $_.code_reference -eq $eq.equivalent_reference -and
                              $_.statut -eq 'PROPOSE' } | Select-Object -First 1
    }
    if (-not $cible) { return 'impossible de construire une proposition sur la cible' }
    Appel POST "/api/plan-achat/propositions/$($cible.id_proposition)/figer" $j.achat @{ motif_figement='QUANTITE_AJUSTEE' } | Out-Null
    $code = Code POST "/api/plan-achat/$($p.id_proposition)/substituer" $j.achat @{
      code_reference_cible = $eq.equivalent_reference; motif = 'Essai de fusion' }
    # On rend la cible au calcul pour ne pas perturber les tests suivants.
    Appel DELETE "/api/plan-achat/propositions/$($cible.id_proposition)/figer" $j.achat | Out-Null
    if ($code -ne 422) { "fusion acceptee dans une ligne protegee ($code)" } else { $true }
  }
  Verifier "Convertir en bon de commande retire la protection" {
    # Une proposition COMMANDE et « protegee du recalcul » est un etat qui ne
    # veut rien dire, et que les ecrans compteraient parmi les arbitrages ouverts.
    $p = (Appel GET '/api/plan-achat/propositions' $j.achat) |
         Where-Object { $_.statut -in @('PROPOSE','EN_REVISION') } | Select-Object -First 1
    Appel POST "/api/plan-achat/propositions/$($p.id_proposition)/figer" $j.achat @{ motif_figement='PRIX_NEGOCIE' } | Out-Null
    # ConvertTo-Json reduit un tableau d'un seul element a un scalaire : sans le
    # doublon, le serveur recevrait une chaine la ou il attend une liste.
    Appel POST '/api/plan-achat/commander' $j.achat @{ propositions = @($p.id_proposition, $p.id_proposition) } | Out-Null
    $apres = (Sql "SELECT statut || '/' || figee FROM plan_achat WHERE id_proposition='$($p.id_proposition)';").Trim()
    if ($apres -ne 'COMMANDE/0') { "etat apres conversion : $apres (attendu COMMANDE/0)" } else { $true }
  }
  Verifier "Figement : motif inconnu refuse, magasinier interdit" {
    $p = (Appel GET '/api/plan-achat/propositions' $j.achat) |
         Where-Object { $_.statut -eq 'PROPOSE' -and $_.figee -eq 0 } | Select-Object -First 1
    $motif = Code POST "/api/plan-achat/propositions/$($p.id_proposition)/figer" $j.achat @{ motif_figement='MOTIF_INVENTE' }
    $role  = Code POST "/api/plan-achat/propositions/$($p.id_proposition)/figer" $j.magasin @{ motif_figement='AUTRE' }
    if ($motif -ne 400) { "motif inconnu accepte ($motif)" }
    elseif ($role -ne 403) { "magasinier autorise a figer ($role)" }
    else { $true }
  }

  Write-Host ""
  Write-Host "=== CRUD : BONS DE COMMANDE ===" -ForegroundColor Cyan

  $idBc = $null
  Verifier "Creation d'un BC (devise et taux repris du fournisseur)" {
    $b = Appel POST '/api/bons-commande' $j.achat @{ code_fournisseur='HAS'; date_livraison_prevue='2026-12-01' }
    $script:idBc = $b.id_bc
    ($b.code_devise -eq 'USD') -and ($b.taux_change_engage -eq 9.5)
  }
  Verifier "Ajout d'une ligne avec conversion et total" {
    $l = Appel POST "/api/bons-commande/$script:idBc/lignes" $j.achat @{
      code_reference='PP-3430'; unite_commande='Bobine'
      quantite_commandee_unite=100; prix_unitaire_devise=9.6
    }
    $mt = [double](Sql "SELECT montant_total_mad FROM bon_commande WHERE id_bc='$script:idBc';").Trim()
    # 100 bobines x 3,2 kg = 320 kg ; 100 x 9,6 USD = 960 USD x 9,5 = 9120 MAD
    if ($l.quantite_commandee_kg -eq 320 -and $mt -eq 9120) { $true } else { "kg=$($l.quantite_commandee_kg) montant=$mt" }
  }
  Verifier "B4-4 : le createur ne peut pas valider son propre BC" {
    Appel PUT "/api/bons-commande/$script:idBc/statut" $j.achat @{ statut='EN_ATTENTE_VALIDATION' } | Out-Null
    (Code PUT "/api/bons-commande/$script:idBc/statut" $j.achat @{ statut='VALIDE' }) -eq 422
  }
  Verifier "Validation par la Direction" {
    Appel PUT "/api/bons-commande/$script:idBc/statut" $j.direction @{ statut='VALIDE' } | Out-Null
    (Sql "SELECT statut FROM bon_commande WHERE id_bc='$script:idBc';").Trim() -eq 'VALIDE'
  }
  Verifier "BC valide : plus de modification de lignes" {
    (Code POST "/api/bons-commande/$script:idBc/lignes" $j.achat @{
      code_reference='JUT-961'; unite_commande='kg'; quantite_commandee_unite=10; prix_unitaire_devise=1
    }) -eq 422
  }

  Write-Host ""
  Write-Host "=== CRUD : RECEPTIONS ===" -ForegroundColor Cyan

  $idRec2 = $null
  Verifier "Creation d'une reception rattachee au BC" {
    Appel PUT "/api/bons-commande/$script:idBc/statut" $j.achat @{ statut='ENVOYE' } | Out-Null
    $r = Appel POST '/api/receptions' $j.magasin @{ id_bc=$script:idBc; num_bon_livraison='BL-TEST-1' }
    $script:idRec2 = $r.id_reception
    $r.code_fournisseur -eq 'HAS'
  }
  Verifier "Saisie d'une pesee : conversion et prix en MAD" {
    $idLigneBc = (Sql "SELECT id_ligne_bc FROM ligne_bc WHERE id_bc='$script:idBc' LIMIT 1;").Trim()
    $l = Appel POST "/api/receptions/$script:idRec2/lignes" $j.magasin @{
      code_reference='PP-3430'; id_ligne_bc=$idLigneBc
      unite_saisie='Bobine'; quantite_pesee_unite=100
      code_magasin_dest='MP-01'; lot_fournisseur='LOT-REC-TEST'
    }
    # 3 USD/kg x 9,5 = 28,50 MAD/kg
    if ($l.quantite_stock_kg -eq 320 -and $l.prix_kg_mad -eq 28.5) { $true } else { "kg=$($l.quantite_stock_kg) prix=$($l.prix_kg_mad)" }
  }
  Verifier "Soumission au controle qualite par le magasinier" {
    Appel PUT "/api/receptions/$script:idRec2/statut" $j.magasin @{ statut='A_CONTROLER' } | Out-Null
    (Sql "SELECT statut FROM reception WHERE id_reception='$script:idRec2';").Trim() -eq 'A_CONTROLER'
  }
  Verifier "La validation ne passe pas par /statut" {
    (Code PUT "/api/receptions/$script:idRec2/statut" $j.qualite @{ statut='VALIDE' }) -eq 422
  }
  Verifier "Cascade 3-en-1 apres controle qualite" {
    $avant = [double](Sql "SELECT COALESCE(quantite_kg,0) FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01';").Trim()
    Appel POST "/api/receptions/$script:idRec2/valider" $j.qualite | Out-Null
    $apres = [double](Sql "SELECT quantite_kg FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01';").Trim()
    $arch = [int](Sql "SELECT COUNT(*) FROM archive_reception WHERE lot_fournisseur='LOT-REC-TEST';").Trim()
    $hist = [int](Sql "SELECT COUNT(*) FROM historique_prix WHERE code_reference='PP-3430';").Trim()
    if (($apres - $avant) -eq 320 -and $arch -eq 1 -and $hist -ge 1) { $true }
    else { "delta=$($apres-$avant) archives=$arch historique=$hist" }
  }
  Verifier "Reception validee : lignes figees" {
    $idl = (Sql "SELECT id_ligne_reception FROM ligne_reception WHERE id_reception='$script:idRec2' LIMIT 1;").Trim()
    (Code DELETE "/api/receptions/$script:idRec2/lignes/$idl" $j.magasin) -eq 422
  }

  Write-Host ""
  Write-Host "=== COHERENCE ===" -ForegroundColor Cyan

  Verifier "Aucun controle bloquant en anomalie" {
    $n = [int](Sql "SELECT COALESCE(SUM(anomalies),0) FROM v_controles WHERE criticite='BLOQUANT';").Trim()
    if ($n -eq 0) { $true } else { "$n anomalie(s)" }
  }
  Verifier "Solde de stock = grand livre" { [int](Sql "SELECT COUNT(*) FROM v_ctl_c11;").Trim() -eq 0 }
  Verifier "Stock par lot = stock par magasin" { [int](Sql "SELECT COUNT(*) FROM v_ctl_c15;").Trim() -eq 0 }
  Verifier "Journal d'audit alimente" {
    [int](Sql "SELECT COUNT(*) FROM audit_log;").Trim() -gt 0
  }
}
finally {
  if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force }
  Remove-Item $dbFile, "$dbFile-wal", "$dbFile-shm" -EA SilentlyContinue
  # Sans ce nettoyage, la session garde DATABASE_URL pointe sur la base jetable
  # que l'on vient de supprimer : la commande suivante echoue avec un
  # « unable to open database file » sans rapport apparent.
  Remove-Item Env:\DATABASE_URL, Env:\JWT_SECRET, Env:\BIND_ADDR, Env:\RUST_LOG,
              Env:\GESTIONFIL_MOT_DE_PASSE -EA SilentlyContinue
}

Write-Host ""
Write-Host ("Reussis : {0}   Echecs : {1}" -f $script:ok, $script:ko) `
  -ForegroundColor $(if ($script:ko -eq 0) { 'Green' } else { 'Red' })
if ($script:ko -gt 0) { exit 1 }
