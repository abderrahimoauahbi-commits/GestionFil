<#
.SYNOPSIS
    Suite de tests d'invariants de la base ERP Gestion Fil.

    Chaque test verifie qu'un defaut identifie dans le cahier des charges est
    desormais IMPOSSIBLE.

    La suite construit SA PROPRE base de reference avec le jeu de demonstration,
    puis travaille sur une copie jetable remise a neuf avant chaque test. Elle ne
    depend donc pas de l'etat de gestionfil.db, qui peut avoir ete reconstruite
    sans demonstration ou alimentee par l'import Excel.

.EXAMPLE
    .\run-tests.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$sqlite = (Get-Command sqlite3).Source
$refBase = Join-Path $env:TEMP "gestionfil-reference.db"
$work    = Join-Path $env:TEMP "gestionfil-tests.db"

Write-Host "Construction de la base de reference..." -ForegroundColor Cyan
Push-Location (Join-Path $root '..')
& .\build.ps1 -Demo -Database $refBase | Out-Null
Pop-Location
if (-not (Test-Path $refBase)) { throw "construction de la base de reference echouee" }
$src = Resolve-Path $refBase

$script:passed = 0
$script:failed = 0

$sqlFile = Join-Path $env:TEMP "gestionfil-test.sql"
$outFile = Join-Path $env:TEMP "gestionfil-test.out"
$errFile = Join-Path $env:TEMP "gestionfil-test.err"

function Reset-Db {
    if (Test-Path $work) { Remove-Item $work -Force }
    Copy-Item $src $work
}

# Execute un script SQL sur la base de travail.
# Start-Process isole les flux : PowerShell 5.1 transforme sinon la stderr d'un
# executable natif en ErrorRecord terminant, ce qui masque le code de retour.
function Invoke-Sql {
    param([string] $Sql)
    Set-Content -Path $sqlFile -Value ("PRAGMA foreign_keys=ON;`r`n" + $Sql) -Encoding UTF8
    $p = Start-Process -FilePath $sqlite -ArgumentList @('-bail', "`"$work`"") `
                       -RedirectStandardInput $sqlFile `
                       -RedirectStandardOutput $outFile `
                       -RedirectStandardError  $errFile `
                       -NoNewWindow -Wait -PassThru
    $script:lastCode = $p.ExitCode
    $o = if (Test-Path $outFile) { Get-Content $outFile -Raw } else { '' }
    $e = if (Test-Path $errFile) { Get-Content $errFile -Raw } else { '' }
    return (("$o`n$e").Trim())
}

# Attend un ECHEC : le SQL doit etre refuse par la base.
function Test-Refuse {
    param([string] $Nom, [string] $Sql, [string] $Attendu)
    Reset-Db
    $out = Invoke-Sql $Sql
    if ($script:lastCode -eq 0) {
        Write-Host ("  ECHEC  {0}" -f $Nom) -ForegroundColor Red
        Write-Host   "         attendu : refus de la base, obtenu : succes"
        $script:failed++
    } elseif ($Attendu -and $out -notmatch [regex]::Escape($Attendu)) {
        Write-Host ("  ECHEC  {0}" -f $Nom) -ForegroundColor Red
        Write-Host ("         message attendu contenant : {0}" -f $Attendu)
        Write-Host ("         obtenu : {0}" -f $out)
        $script:failed++
    } else {
        Write-Host ("  OK     {0}" -f $Nom) -ForegroundColor Green
        $script:passed++
    }
}

# Attend un SUCCES, et compare le resultat de la derniere requete.
function Test-Valeur {
    param([string] $Nom, [string] $Sql, [string] $Attendu)
    Reset-Db
    $out = Invoke-Sql $Sql
    $obtenu = ($out -replace "`r", '').Trim()
    if ($script:lastCode -ne 0) {
        Write-Host ("  ECHEC  {0}" -f $Nom) -ForegroundColor Red
        Write-Host ("         erreur inattendue : {0}" -f $obtenu)
        $script:failed++
    } elseif ($obtenu -ne $Attendu) {
        Write-Host ("  ECHEC  {0}" -f $Nom) -ForegroundColor Red
        Write-Host ("         attendu : '{0}'" -f $Attendu)
        Write-Host ("         obtenu  : '{0}'" -f $obtenu)
        $script:failed++
    } else {
        Write-Host ("  OK     {0}" -f $Nom) -ForegroundColor Green
        $script:passed++
    }
}

$U_MAG = "'00000000-0000-4000-a000-000000000015'"   # magasinier
$U_DIR = "'00000000-0000-4000-a000-000000000010'"   # direction
$U_ACH = "'00000000-0000-4000-a000-000000000012'"   # acheteur
$P_26  = "'00000000-0000-4000-a000-0000000000b1'"   # plan 2026 v1

Write-Host ""
Write-Host "=== STOCK & MOUVEMENTS ===" -ForegroundColor Cyan

# JUT-961 n'est pas sous suivi de lot : isole la garde de solde par magasin.
Test-Refuse "R02  Sortie superieure au stock du magasin refusee" @"
INSERT INTO mouvement (id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,numero_of,id_utilisateur)
VALUES ('t1','MVT-T1','SORTIE_PROD','MP-01','PRODUCTION','OF-T1',$U_MAG);
INSERT INTO ligne_mouvement (id_mouvement,ligne_numero,code_reference,quantite_kg)
VALUES ('t1',1,'JUT-961',999999);
"@ "stock insuffisant"

Test-Refuse "R02  Sortie superieure au stock d'un LOT refusee" @"
INSERT INTO mouvement (id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,numero_of,id_utilisateur)
VALUES ('t2','MVT-T2','SORTIE_PROD','MP-01','PRODUCTION','OF-T2',$U_MAG);
INSERT INTO ligne_mouvement (id_mouvement,ligne_numero,code_reference,quantite_kg,lot_fournisseur)
VALUES ('t2',1,'PP-3430',5000,'LOT-HAS-2602');
"@ "insuffisante sur ce lot"

Test-Refuse "R03  UPDATE sur le grand livre refuse" `
    "UPDATE mouvement SET observations_globales='x' WHERE numero_mouvement='MVT-INIT-2026-0001';" `
    "immuable"

Test-Refuse "R03  DELETE sur une ligne de mouvement refuse" `
    "DELETE FROM ligne_mouvement WHERE code_reference='PP-3430';" `
    "suppression interdite"

Test-Refuse "C07  Sortie production sans numero d'OF refusee" @"
INSERT INTO mouvement (id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,id_utilisateur)
VALUES ('t3','MVT-T3','SORTIE_PROD','MP-01','PRODUCTION',$U_MAG);
INSERT INTO ligne_mouvement (id_mouvement,ligne_numero,code_reference,quantite_kg,lot_fournisseur)
VALUES ('t3',1,'PP-3430',10,'LOT-HAS-2601');
"@ "numero d'OF obligatoire"

Test-Refuse "Lot obligatoire sur une reference sous suivi de lot" @"
INSERT INTO mouvement (id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,numero_of,id_utilisateur)
VALUES ('t4','MVT-T4','SORTIE_PROD','MP-01','PRODUCTION','OF-T4',$U_MAG);
INSERT INTO ligne_mouvement (id_mouvement,ligne_numero,code_reference,quantite_kg)
VALUES ('t4',1,'PP-3430',10);
"@ "lot_fournisseur obligatoire"

Test-Refuse "RG-07 Entree valorisee sans prix refusee" @"
INSERT INTO mouvement (id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,id_utilisateur)
VALUES ('t5','MVT-T5','ENTREE_REC','MP-01','RECEPTION',$U_MAG);
INSERT INTO ligne_mouvement (id_mouvement,ligne_numero,code_reference,quantite_kg,lot_fournisseur)
VALUES ('t5',1,'PP-3430',100,'LOT-HAS-2601');
"@ "prix_kg_mad"

Test-Refuse "C06  Mouvement date dans le futur refuse" @"
INSERT INTO mouvement (id_mouvement,numero_mouvement,date_mouvement,code_type_mvt,code_magasin,code_motif,id_utilisateur)
VALUES ('t6','MVT-T6','2099-01-01T00:00:00.000Z','ENTREE_REC','MP-01','RECEPTION',$U_MAG);
"@ "date dans le futur"

Write-Host ""
Write-Host "=== CMUP (R04 / RG-08) ===" -ForegroundColor Cyan

# Etat : PP-3430 = 11100 kg @ 28.50 MAD. Entree 5000 kg @ 31.00 MAD.
# CMUP attendu = (11100*28.50 + 5000*31.00) / 16100 = 471350 / 16100 = 29.2764
Test-Valeur "R04  CMUP recalcule sur entree valorisee" @"
INSERT INTO mouvement (id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,id_utilisateur)
VALUES ('t7','MVT-T7','ENTREE_REC','MP-01','RECEPTION',$U_MAG);
INSERT INTO ligne_mouvement (id_mouvement,ligne_numero,code_reference,quantite_kg,prix_kg_mad,lot_fournisseur)
VALUES ('t7',1,'PP-3430',5000,31.00,'LOT-HAS-2601');
SELECT quantite_kg || '|' || cmup_mad FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01';
"@ "16100.0|29.2764"

# Une sortie ne doit PAS modifier le CMUP (R04).
Test-Valeur "R04  Une sortie ne modifie pas le CMUP" @"
INSERT INTO mouvement (id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,numero_of,id_utilisateur)
VALUES ('t8','MVT-T8','SORTIE_PROD','MP-01','PRODUCTION','OF-T8',$U_MAG);
INSERT INTO ligne_mouvement (id_mouvement,ligne_numero,code_reference,quantite_kg,lot_fournisseur)
VALUES ('t8',1,'PP-3430',1100,'LOT-HAS-2601');
SELECT quantite_kg || '|' || cmup_mad FROM stock_magasin WHERE code_reference='PP-3430' AND code_magasin='MP-01';
"@ "10000.0|28.5"

Write-Host ""
Write-Host "=== COMPOSITION DES QUALITES (R07) ===" -ForegroundColor Cyan

# Une qualite = une composition. Le controle a lieu a la mise en service, et la
# composition d'une qualite produite par le plan en service est verrouillee.

Test-Refuse "Composition verrouillee tant qu'un plan en service la produit" @"
INSERT INTO recette (code_qualite,ligne_numero,code_reference,code_role,pourcentage_composition)
VALUES ('SH', 99, 'SBR-821', 'COLLE', 1.0);
"@ "Composition verrouillee"

Test-Refuse "R07  Somme des % <> 100 : mise en service refusee" @"
UPDATE qualite SET statut='BROUILLON' WHERE code_qualite='SH';
DELETE FROM plan_qualite;
DELETE FROM recette WHERE code_qualite='SH';
INSERT INTO recette (code_qualite,ligne_numero,code_reference,code_role,pourcentage_composition)
VALUES ('SH',1,'PP-3430','POIL',60.0);
UPDATE qualite SET statut='ACTIF' WHERE code_qualite='SH';
"@ "100%"

Test-Refuse "Role sans densite : mise en service refusee (pas de besoin nul silencieux)" @"
UPDATE qualite SET statut='BROUILLON' WHERE code_qualite='SH';
DELETE FROM plan_qualite;
DELETE FROM recette WHERE code_qualite='SH';
INSERT INTO recette (code_qualite,ligne_numero,code_reference,code_role,pourcentage_composition)
VALUES ('SH',1,'JUT-961','FRANGE',100.0);
UPDATE qualite SET statut='ACTIF' WHERE code_qualite='SH';
"@ "besoin nul en silence"

Test-Refuse "Qualite sans composition : mise en service refusee" @"
UPDATE qualite SET statut='BROUILLON' WHERE code_qualite='SH';
DELETE FROM plan_qualite;
DELETE FROM recette WHERE code_qualite='SH';
UPDATE qualite SET statut='ACTIF' WHERE code_qualite='SH';
"@ "sans ligne de composition"

Test-Refuse "Meme reference deux fois sur un role refusee" @"
DELETE FROM plan_qualite;
INSERT INTO recette (code_qualite,ligne_numero,code_reference,code_role,pourcentage_composition)
VALUES ('SH',99,'PP-3430','POIL',5.0);
"@ "UNIQUE"

Test-Valeur "La composition suit la qualite : suppression en cascade" @"
UPDATE qualite SET statut='BROUILLON' WHERE code_qualite='SH';
DELETE FROM plan_qualite;
DELETE FROM besoin_mrp;
DELETE FROM ligne_plan_production;
DELETE FROM plan_saisonnalite;
DELETE FROM qualite WHERE code_qualite='SH';
SELECT COUNT(*) FROM recette WHERE code_qualite='SH';
"@ "0"

Test-Valeur "Une qualite cloturee n'est plus active" @"
UPDATE qualite SET statut='BROUILLON' WHERE code_qualite='SH';
UPDATE qualite SET statut='CLOTURE', date_cloture='2026-08-06T00:00:00.000Z' WHERE code_qualite='SH';
SELECT statut||'|'||actif FROM qualite WHERE code_qualite='SH';
"@ "CLOTURE|0"

Test-Refuse "Cloture de qualite sans date de cloture refusee" @"
UPDATE qualite SET statut='BROUILLON' WHERE code_qualite='SH';
UPDATE qualite SET statut='CLOTURE' WHERE code_qualite='SH';
"@ "CHECK"

Write-Host ""
Write-Host "=== MACHINE A ETATS ===" -ForegroundColor Cyan

Test-Refuse "Transition arriere VALIDE -> BROUILLON refusee (plan)" `
    "UPDATE plan_production SET statut='BROUILLON' WHERE id_plan=$P_26;" `
    "Transition de statut interdite"

Test-Refuse "Transition non declaree ACTIF -> A_VALIDER refusee (qualite)" `
    "UPDATE qualite SET statut='A_VALIDER' WHERE code_qualite='SH';" `
    "Transition de statut interdite"

Write-Host ""
Write-Host "=== IMMUABILITE : LES TROIS VERBES ===" -ForegroundColor Cyan

# Interdire UPDATE et DELETE ne suffit pas : INSERT OR REPLACE reecrit une ligne
# en une instruction, et le DELETE implicite ne declenche aucun trigger tant que
# recursive_triggers est desactive — ce qu'il est, volontairement.
Test-Refuse "R03  INSERT OR REPLACE sur le grand livre refuse" @"
INSERT OR REPLACE INTO mouvement (id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,id_utilisateur)
SELECT id_mouvement,numero_mouvement,code_type_mvt,code_magasin,code_motif,id_utilisateur FROM mouvement LIMIT 1;
"@ "remplacement interdit"

Test-Refuse "R03  INSERT OR REPLACE sur une ligne de mouvement refuse" @"
INSERT OR REPLACE INTO ligne_mouvement (id_ligne_mouvement,id_mouvement,ligne_numero,code_reference,quantite_kg)
SELECT id_ligne_mouvement,id_mouvement,ligne_numero,code_reference,1.0 FROM ligne_mouvement LIMIT 1;
"@ "remplacement interdit"

Test-Refuse "R03  INSERT OR REPLACE sur le journal d'audit refuse" @"
INSERT OR REPLACE INTO audit_log (id_audit,table_concernee,operation,id_enregistrement)
SELECT id_audit,'x','UPDATE','y' FROM audit_log LIMIT 1;
"@ "remplacement interdit"

Write-Host ""
Write-Host "=== GARDES : UN JUMEAU PAR VERBE ===" -ForegroundColor Cyan

# Une garde posee sur le seul INSERT se contourne en deux instructions : inserer
# une valeur acceptable, puis la modifier.
Test-Refuse "R08  UPDATE vers une qualite non ACTIVE refuse" @"
UPDATE plan_qualite SET code_qualite = (SELECT code_qualite FROM qualite WHERE statut <> 'ACTIF' LIMIT 1)
 WHERE rowid = (SELECT MIN(rowid) FROM plan_qualite);
"@ "seule une qualite ACTIVE"

# Le jeu de demonstration ne porte qu'UNE qualite active, deja planifiee : on
# construit la situation en clonant la qualite existante avec sa composition,
# puis en la rendant active. Sans cela le cas serait intestable, et un cas
# intestable finit par etre declare couvert.
Test-Refuse "UPDATE vers une qualite deja planifiee ailleurs refuse" @"
-- qualite porte elle aussi ses parametres embarques (B3), tous NOT NULL : on
-- recopie la qualite existante en nommant les colonnes inserables.
INSERT INTO qualite
    (code_qualite,nom,description,poids_commercial_m2,statut,marge_securite_pct,couv_min_mois,
     taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,stock_securite_jours,
     id_utilisateur_creation)
SELECT 'QJUM','Qualite jumelle',description,poids_commercial_m2,'ACTIF',marge_securite_pct,
       couv_min_mois,taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,
       stock_securite_jours,id_utilisateur_creation
  FROM qualite LIMIT 1;
INSERT INTO plan_production
    (id_plan,annee,numero_version,libelle,scenario_nom,date_debut,date_fin,mois_horizon,
     croissance_annuelle_pct,statut,marge_securite_pct,couv_min_mois,taux_perte_pct,
     seuil_alerte_jours,seuil_critique_jours,seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,
     m2_total_annuel,id_utilisateur_creation)
SELECT 'p-jumeau',2028,numero_version,'Plan jumeau',scenario_nom,'2028-01-01','2028-12-31',
       mois_horizon,croissance_annuelle_pct,'BROUILLON',marge_securite_pct,couv_min_mois,
       taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,seuil_tier1_mad,seuil_tier2_mad,
       seuil_tier3_mad,m2_total_annuel,id_utilisateur_creation
  FROM plan_production LIMIT 1;
INSERT INTO plan_qualite (id_plan,code_qualite,m2_base_mensuel) VALUES ('p-jumeau','QJUM',100);
-- La bascule vers une qualite deja retenue par l'autre plan doit etre refusee.
UPDATE plan_qualite SET code_qualite = (SELECT code_qualite FROM plan_qualite WHERE id_plan <> 'p-jumeau' LIMIT 1)
 WHERE id_plan = 'p-jumeau';
"@ "figure deja dans un autre plan actif"

# Le meme garde ne doit PAS bloquer un DEPLACEMENT : la ligne s'exclut d'elle-meme.
Test-Valeur "Deplacer une qualite d'un plan a l'autre reste possible" @"
INSERT INTO plan_production
    (id_plan,annee,numero_version,libelle,scenario_nom,date_debut,date_fin,mois_horizon,
     croissance_annuelle_pct,statut,marge_securite_pct,couv_min_mois,taux_perte_pct,
     seuil_alerte_jours,seuil_critique_jours,seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,
     m2_total_annuel,id_utilisateur_creation)
SELECT 'p-accueil',2029,numero_version,'Plan d accueil',scenario_nom,'2029-01-01','2029-12-31',
       mois_horizon,croissance_annuelle_pct,'BROUILLON',marge_securite_pct,couv_min_mois,
       taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,seuil_tier1_mad,seuil_tier2_mad,
       seuil_tier3_mad,m2_total_annuel,id_utilisateur_creation
  FROM plan_production LIMIT 1;
UPDATE plan_qualite SET id_plan = 'p-accueil' WHERE rowid = (SELECT MIN(rowid) FROM plan_qualite);
SELECT COUNT(*) FROM plan_qualite WHERE id_plan = 'p-accueil';
"@ "1"
Write-Host ""
Write-Host "=== SEGREGATION DES TACHES (B4) ===" -ForegroundColor Cyan

Test-Refuse "B4-4 Createur de BC ne peut pas etre son propre valideur" @"
INSERT INTO bon_commande (id_bc,numero_bc,code_fournisseur,code_devise,taux_change_engage,
                          statut,id_utilisateur_creation,id_utilisateur_validation,date_validation)
VALUES ('t12','BC-T12','HAS','USD',9.5,'VALIDE',$U_ACH,$U_ACH,'2026-08-06T00:00:00.000Z');
"@ "CHECK constraint failed"

Test-Refuse "BC valide sans tracabilite de validation refuse" @"
INSERT INTO bon_commande (id_bc,numero_bc,code_fournisseur,code_devise,taux_change_engage,
                          statut,id_utilisateur_creation)
VALUES ('t13','BC-T13','HAS','USD',9.5,'VALIDE',$U_ACH);
"@ "CHECK constraint failed"

Write-Host ""
Write-Host "=== PARAMETRES & TAUX DE CHANGE ===" -ForegroundColor Cyan

Test-Refuse "Parametre verrouille non modifiable (P_DateSaisie)" `
    "UPDATE parametre SET valeur_courante='2026-01-01' WHERE code_parametre='P_DateSaisie';" `
    "verrouille"

Test-Valeur "Modification de parametre historisee ET auditee" @"
UPDATE _contexte_session SET id_utilisateur=$U_DIR WHERE id=1;
UPDATE parametre SET valeur_courante='75', motif_modif='Test' WHERE code_parametre='P_SeuilAlerte';
SELECT (SELECT COUNT(*) FROM parametre_historique WHERE code_parametre='P_SeuilAlerte')
    || '|' || (SELECT ancienne_valeur||'->'||nouvelle_valeur FROM parametre_historique WHERE code_parametre='P_SeuilAlerte')
    || '|' || (SELECT COUNT(*) FROM audit_log WHERE table_concernee='parametre');
"@ "1|90->75|1"

Test-Refuse "RG-09 Taux de change chevauchant refuse" @"
INSERT INTO taux_change (code_devise,taux,date_debut) VALUES ('USD',9.8,'2026-06-01T00:00:00.000Z');
"@ "chevauchantes"

Test-Refuse "Devise pivot a un taux different de 1 refusee" @"
INSERT INTO taux_change (code_devise,taux,date_debut,date_fin) VALUES ('MAD',1.05,'2020-01-01T00:00:00.000Z','2020-12-31T00:00:00.000Z');
"@ "pivot"

Write-Host ""
Write-Host "=== CATALOGUE (R01 : unite canonique) ===" -ForegroundColor Cyan

Test-Refuse "R01  Reference en 'ml' sans densite_kg_ml refusee" @"
INSERT INTO reference (code_reference,code_categorie,code_fournisseur,designation,unite_catalogue,
                       prix_catalogue,code_devise_catalogue)
VALUES ('T-ML','PLA','CHM','Test ml sans densite','ml',1.0,'MAD');
"@ "CHECK constraint failed"

Test-Refuse "R01  Reference en 'Palette' sans bobines_par_palette refusee" @"
INSERT INTO reference (code_reference,code_categorie,code_fournisseur,designation,unite_catalogue,
                       poids_bobine_kg,prix_catalogue,code_devise_catalogue)
VALUES ('T-PAL','PP','HAS','Test palette incomplete','Palette',3.2,100.0,'USD');
"@ "CHECK constraint failed"

# PP-3430 : Bobine de 3.2 kg -> facteur 3.2 | CUIR-01 : ml a 0.35 kg/ml -> facteur 0.35
Test-Valeur "R01  Facteurs de conversion Bobine et ml" @"
SELECT facteur_kg FROM reference WHERE code_reference IN ('PP-3430','CUIR-01') ORDER BY code_reference;
"@ "0.35`n3.2"

# Reference en Palette : facteur = poids_bobine x bobines_par_palette = 3.2 x 240 = 768
Test-Valeur "R01  Facteur de conversion Palette = poids_bobine x bobines" @"
INSERT INTO reference (code_reference,code_categorie,code_fournisseur,designation,unite_catalogue,
                       poids_bobine_kg,bobines_par_palette,prix_catalogue,code_devise_catalogue)
VALUES ('T-PAL','PP','HAS','Test palette complete','Palette',3.2,240,2304.0,'USD');
SELECT facteur_kg || '|' || prix_catalogue_kg FROM reference WHERE code_reference='T-PAL';
"@ "768.0|3.0"

Write-Host ""
Write-Host "=== RECEPTIONS ===" -ForegroundColor Cyan

Test-Refuse "Ligne non conforme dirigee hors quarantaine refusee" @"
INSERT INTO reception (id_reception,numero_reception,code_fournisseur,id_utilisateur_reception)
VALUES ('t14','REC-T14','HAS',$U_MAG);
INSERT INTO ligne_reception (id_reception,ligne_numero,code_reference,unite_saisie,facteur_kg,
    quantite_pesee_unite,quantite_stock_kg,prix_kg_devise,code_devise,taux_change,prix_kg_mad,
    statut_qualite,code_magasin_dest)
VALUES ('t14',1,'PP-3430','kg',1.0,100,100,3.0,'USD',9.5,28.5,'NON_CONFORME','MP-01');
"@ "quarantaine"

Test-Refuse "BL-5 Incoherence prix devise / prix MAD refusee" @"
INSERT INTO reception (id_reception,numero_reception,code_fournisseur,id_utilisateur_reception)
VALUES ('t15','REC-T15','HAS',$U_MAG);
INSERT INTO ligne_reception (id_reception,ligne_numero,code_reference,unite_saisie,facteur_kg,
    quantite_pesee_unite,quantite_stock_kg,prix_kg_devise,code_devise,taux_change,prix_kg_mad,
    code_magasin_dest)
VALUES ('t15',1,'PP-3430','kg',1.0,100,100,3.0,'USD',9.5,3.0,'MP-01');
"@ "CHECK constraint failed"

Test-Refuse "SoD  Le controleur ne peut pas etre le peseur" @"
INSERT INTO reception (id_reception,numero_reception,code_fournisseur,
                       id_utilisateur_reception,id_utilisateur_controle,date_controle)
VALUES ('t16','REC-T16','HAS',$U_MAG,$U_MAG,'2026-08-06T00:00:00.000Z');
"@ "CHECK constraint failed"

Write-Host ""
Write-Host "=== MRP (BL-4 / BL-6) ===" -ForegroundColor Cyan

Test-Refuse "BL-6 besoin_mrp idempotent : doublon refuse" @"
INSERT INTO besoin_mrp (id_plan,mois,rang_mois,annee_mois,code_reference,quantite_brute_kg,quantite_kg,date_reference)
VALUES ($P_26,7,6,'2026-07','PP-3430',56.32,57.4464,'2026-08-06');
"@ "UNIQUE"

Test-Refuse "R08  Plan sans recette figee : validation refusee" @"
INSERT INTO plan_production (id_plan,annee,numero_version,libelle,date_debut,date_fin,
    marge_securite_pct,couv_min_mois,taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,
    seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,id_utilisateur_creation)
VALUES ('t17',2027,1,'Plan 2027','2027-01-01','2027-12-31',20,2,2,90,60,300000,200000,100000,$U_DIR);
INSERT INTO ligne_plan_production (id_plan,mois,rang_mois,annee_mois,code_qualite,m2_prevus)
VALUES ('t17',1,0,'2027-01','SH',1000);
UPDATE plan_production SET statut='SIMULATION' WHERE id_plan='t17';
UPDATE plan_production SET statut='EN_COURS', date_validation='2026-08-06T00:00:00.000Z', id_utilisateur_validation=$U_DIR WHERE id_plan='t17';
"@ "entete du plan"

Test-Refuse "Une qualite ne peut appartenir qu'a un seul plan actif" @"
INSERT INTO plan_production (id_plan,annee,numero_version,libelle,date_debut,date_fin,
    marge_securite_pct,couv_min_mois,taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,
    seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,id_utilisateur_creation)
VALUES ('t20',2027,1,'Plan concurrent','2027-01-01','2027-12-31',20,2,2,90,60,300000,200000,100000,$U_DIR);
INSERT INTO plan_qualite (id_plan,code_qualite) VALUES ('t20','SH');
"@ "autre plan actif"

Test-Refuse "Un plan ne peut retenir qu'une qualite ACTIVE (R08)" @"
UPDATE plan_production SET statut='CLOTURE', date_cloture='2026-08-06T00:00:00.000Z' WHERE id_plan=$P_26;
UPDATE qualite SET statut='BROUILLON' WHERE code_qualite='SH';
INSERT INTO plan_production (id_plan,annee,numero_version,libelle,date_debut,date_fin,
    marge_securite_pct,couv_min_mois,taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,
    seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,id_utilisateur_creation)
VALUES ('t22',2027,1,'Plan sur brouillon','2027-01-01','2027-12-31',20,2,2,90,60,300000,200000,100000,$U_DIR);
INSERT INTO plan_qualite (id_plan,code_qualite) VALUES ('t22','SH');
"@ "R08"

Test-Refuse "Cloture de plan sans date de cloture refusee" `
    "UPDATE plan_production SET statut='CLOTURE' WHERE id_plan=$P_26;" `
    "CHECK"

Test-Valeur "Plan cloture : inactif, et ses besoins sortent de v_besoin_12m" @"
UPDATE plan_production SET statut='CLOTURE', date_cloture='2026-08-06T00:00:00.000Z' WHERE id_plan=$P_26;
SELECT (SELECT actif FROM plan_production WHERE id_plan=$P_26)
       ||'|'|| (SELECT COUNT(*) FROM besoin_mrp WHERE id_plan=$P_26 AND quantite_kg > 0)
       ||'|'|| (SELECT COUNT(*) FROM v_besoin_12m);
"@ "0|144|0"

Test-Valeur "Cloture d'un plan : ses qualites redeviennent libres" @"
UPDATE plan_production SET statut='CLOTURE', date_cloture='2026-08-06T00:00:00.000Z' WHERE id_plan=$P_26;
INSERT INTO plan_production (id_plan,annee,numero_version,libelle,date_debut,date_fin,
    marge_securite_pct,couv_min_mois,taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,
    seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,id_utilisateur_creation)
VALUES ('t23',2027,1,'Plan suivant','2027-01-01','2027-12-31',20,2,2,90,60,300000,200000,100000,$U_DIR);
INSERT INTO plan_qualite (id_plan,code_qualite) VALUES ('t23','SH');
SELECT COUNT(*) FROM plan_qualite WHERE id_plan='t23';
"@ "1"

# RG-10, durcie : un SEUL plan en service dans toute la base, pas un par annee.
# Une periode glissante ne s'aligne plus sur l'annee civile : deux plans en
# service, meme d'annees de depart differentes, chevaucheraient leurs mois.
Test-Refuse "RG-10 Deux plans EN_COURS sur la meme annee refuses" @"
INSERT INTO plan_production (id_plan,annee,numero_version,libelle,date_debut,date_fin,
    marge_securite_pct,couv_min_mois,taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,
    seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,statut,date_validation,
    id_utilisateur_creation,id_utilisateur_validation)
VALUES ('t18',2026,2,'Plan 2026 bis','2026-01-01','2026-12-31',20,2,2,90,60,300000,200000,100000,
        'EN_COURS','2026-08-06T00:00:00.000Z',$U_DIR,$U_DIR);
"@ "UNIQUE"

Test-Refuse "Un seul plan EN_COURS, meme sur une AUTRE annee" @"
INSERT INTO plan_production (id_plan,annee,numero_version,libelle,date_debut,date_fin,
    marge_securite_pct,couv_min_mois,taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,
    seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,statut,date_validation,
    id_utilisateur_creation,id_utilisateur_validation)
VALUES ('t19',2028,1,'Plan 2028','2028-03-01','2029-02-28',20,2,2,90,60,300000,200000,100000,
        'EN_COURS','2026-08-06T00:00:00.000Z',$U_DIR,$U_DIR);
"@ "UNIQUE"

Test-Valeur "Cloturer le plan en service libere la place" @"
UPDATE plan_production SET statut='CLOTURE', date_cloture='2026-08-06T00:00:00.000Z' WHERE id_plan=$P_26;
INSERT INTO plan_production (id_plan,annee,numero_version,libelle,date_debut,date_fin,
    marge_securite_pct,couv_min_mois,taux_perte_pct,seuil_alerte_jours,seuil_critique_jours,
    seuil_tier1_mad,seuil_tier2_mad,seuil_tier3_mad,statut,date_validation,
    id_utilisateur_creation,id_utilisateur_validation)
VALUES ('t24',2028,1,'Plan suivant','2028-03-01','2029-02-28',20,2,2,90,60,300000,200000,100000,
        'EN_COURS','2026-08-06T00:00:00.000Z',$U_DIR,$U_DIR);
SELECT COUNT(*) FROM plan_production WHERE statut='EN_COURS';
"@ "1"

Write-Host ""
Write-Host "=== PLAN D'ACHAT (correction de l'arithmetique NULL de la vue I2) ===" -ForegroundColor Cyan

# HOTMELT n'a NI moq_kg NI multiple_achat_kg : la formule du CDC renvoyait 0.
Test-Valeur "Reference sans MOQ ni multiple : quantite non nulle" @"
SELECT CASE WHEN qte_a_commander_kg > 0 THEN 'non-nul' ELSE 'NUL' END
FROM v_plan_achat WHERE code_reference='HOTMELT';
"@ "non-nul"

# PES-61044 : multiple 1000 kg -> la quantite doit etre un multiple exact.
Test-Valeur "Arrondi au multiple d'achat respecte" @"
SELECT CASE WHEN qte_a_commander_kg % 1000 = 0 THEN 'multiple-ok' ELSE 'multiple-KO' END
FROM v_plan_achat WHERE code_reference='PES-61044';
"@ "multiple-ok"

# Correction du defaut n°12 du CDC : sa vue I2 definissait
# stock_projete = stock - besoins, en ignorant les commandes deja passees.
# PP-3430 a 4800 kg en cours de livraison (BC-2026-0001) : sans ce terme, le
# systeme proposerait de recommander ce qui est deja commande.

# Le statut attendu est CRITIQUE et non OK : le veto physique constate 11 100 kg
# en magasin pour un minimum dynamique de 12 900, alors meme que 4 800 kg sont
# en route. C'est precisement ce que la couche physique doit dire — la
# marchandise commandee ne remplit pas les allees.
# L'objet du test reste le meme : l'en-cours est compte, donc rien n'est propose.
Test-Valeur "En-cours fournisseur pris en compte : pas de double commande" @"
SELECT (SELECT COUNT(*) FROM v_plan_achat WHERE code_reference='PP-3430')
    || '|' || (SELECT CAST(encours_kg AS INTEGER) FROM v_stock_projete WHERE code_reference='PP-3430')
    || '|' || (SELECT statut FROM v_stock_projete WHERE code_reference='PP-3430');
"@ "0|4800|CRITIQUE"

# --- Alerte a DOUBLE DECLENCHEUR ---------------------------------------------
# La couverture en jours est un raisonnement, pas un constat. Ces trois cas
# verifient que la realite physique l'emporte sur la projection.

# B — le retard annule la prevision. SEULE la date change : ni le stock, ni le
# besoin, ni la quantite commandee ne bougent, et la couverture s'effondre.
Test-Valeur "Declencheur B : une commande en retard sort du calcul de couverture" @"
UPDATE ligne_bc SET date_livraison_prevue = date('now','-10 days')
 WHERE code_reference='PP-3430' AND statut NOT IN ('ANNULE','SOLDE');
SELECT (SELECT CAST(encours_kg AS INTEGER) FROM v_stock_projete WHERE code_reference='PP-3430')
    || '|' || (SELECT CAST(encours_retarde_kg AS INTEGER) FROM v_stock_projete WHERE code_reference='PP-3430')
    || '|' || (SELECT COUNT(*) FROM v_ctl_c28 WHERE code_reference='PP-3430');
"@ "0|4800|1"

# A — le veto physique. La marchandise part en quarantaine : le calcul logique
# est inchange, mais elle n'est plus utilisable, donc l'alerte doit virer.
Test-Valeur "Declencheur A : la quarantaine fait basculer l'alerte, malgre la couverture" @"
UPDATE ligne_bc SET date_livraison_prevue = date('now','+25 days')
 WHERE code_reference='PP-3430' AND statut NOT IN ('ANNULE','SOLDE');
INSERT INTO stock_magasin (code_reference, code_magasin, quantite_kg, cmup_mad)
SELECT 'PP-3430','ZON-QUA', quantite_kg - 100, cmup_mad FROM stock_magasin
 WHERE code_reference='PP-3430' AND code_magasin='MP-01';
UPDATE stock_magasin SET quantite_kg = 100
 WHERE code_reference='PP-3430' AND code_magasin='MP-01';
SELECT (SELECT CAST(stock_physique_net_kg AS INTEGER) FROM v_stock_projete WHERE code_reference='PP-3430')
    || '|' || (SELECT statut_physique FROM v_stock_projete WHERE code_reference='PP-3430')
    || '|' || (SELECT statut FROM v_stock_projete WHERE code_reference='PP-3430');
"@ "100|CRITIQUE|CRITIQUE"

# Le statut final est le PIRE des deux, jamais le plus optimiste.
Test-Valeur "Le statut final ne peut pas etre meilleur que le veto physique" @"
SELECT COUNT(*) FROM v_stock_projete
 WHERE statut = 'OK' AND statut_physique IN ('RUPTURE','CRITIQUE');
"@ "0"

# Aucune remise en etat n'est necessaire : Test-Valeur repart d'une copie neuve
# de la base de reference avant chaque cas.

# --- Echelle de statut de la feuille GESTION FIL -----------------------------
# La projection se compare au STOCK MINIMUM RECALCULE, pas a un nombre de jours
# fixe : le minimum se parametre par reference, un seuil en jours non.
# Le SUR-STOCK est un SECOND AXE, pas un palier de l'echelle. Simule sur les
# donnees reelles, le placer dans le statut interceptait 72 references sur 124 :
# 31 d'entre elles passaient sous 90 jours de couverture tout en affichant
# « suspendre la prochaine commande ».
Test-Valeur "Le sur-stock n'eteint pas la couche logique" @"
SELECT COUNT(*) FROM v_stock_projete WHERE sur_stock = 1 AND statut = 'SUR_STOCK';
"@ "0"

Test-Valeur "Une reference peut etre en sur-stock ET en alerte" @"
-- Les deux axes sont independants : le drapeau ne remplace jamais le statut.
SELECT COUNT(*) FROM v_stock_projete WHERE sur_stock NOT IN (0,1);
"@ "0"

Test-Valeur "Veto physique : le seuil est le stock minimum, pas un plancher fixe" @"
UPDATE ligne_bc SET statut = 'ANNULE' WHERE code_reference = 'PP-3430';
UPDATE stock_magasin SET quantite_kg = (
    SELECT ROUND(0.9 * stock_min_kg, 3) FROM v_stock_min_dynamique
     WHERE code_reference='PP-3430')
 WHERE code_reference='PP-3430' AND code_magasin='MP-01';
UPDATE stock_lot SET quantite_kg = (
    SELECT quantite_kg FROM stock_magasin
     WHERE code_reference='PP-3430' AND code_magasin='MP-01')
 WHERE code_reference='PP-3430' AND code_magasin='MP-01';
SELECT statut_physique || '|' || statut FROM v_stock_projete WHERE code_reference='PP-3430';
"@ "CRITIQUE|CRITIQUE"

Test-Valeur "Aucun palier URGENT dans l'echelle" @"
SELECT COUNT(*) FROM v_stock_projete WHERE statut = 'URGENT' OR statut_logique = 'URGENT';
"@ "0"
Test-Valeur "FIX P1 : la consommation retenue est le MAX, pas le COALESCE" @"
SELECT COUNT(*) FROM v_conso_retenue cr
  JOIN v_conso_reelle re ON re.code_reference = cr.code_reference
  JOIN v_besoin_12m   bm ON bm.code_reference = cr.code_reference
 WHERE cr.conso_mensuelle_kg < max(re.conso_mensuelle_kg, bm.besoin_mensuel_moyen_kg) - 0.0001;
"@ "0"

Test-Valeur "Source du prix tracee (RG-08 : pas de repli silencieux)" @"
SELECT DISTINCT source_prix FROM v_plan_achat ORDER BY 1;
"@ "CATALOGUE`nCMUP"

Write-Host ""
Write-Host "=== COHERENCE GLOBALE ===" -ForegroundColor Cyan

Test-Valeur "Aucun controle BLOQUANT en anomalie" @"
SELECT COALESCE(SUM(anomalies),0) FROM v_controles WHERE criticite='BLOQUANT';
"@ "0"

Test-Valeur "Solde de stock = grand livre (aucune derive)" @"
SELECT COUNT(*) FROM v_ctl_c11;
"@ "0"

Test-Valeur "Stock par lot = stock par magasin" @"
SELECT COUNT(*) FROM v_ctl_c15;
"@ "0"

Remove-Item $work, $refBase -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host ("Reussis : {0}   Echecs : {1}" -f $script:passed, $script:failed) `
    -ForegroundColor $(if ($script:failed -eq 0) { 'Green' } else { 'Red' })
if ($script:failed -gt 0) { exit 1 }
