-- Porte automatiquement depuis db/012_controles.sql par pg/porter_vues.py.
-- NE PAS MODIFIER ICI : corriger la source, puis rejouer le portage.

-- =============================================================================
-- CONTROLES METIER  (CDC partie K)
-- =============================================================================
-- Le CDC listait C01-C14 et T01-T20 avec des resultats "OK / anomalie" qui
-- decrivaient l'etat du FICHIER EXCEL au 17/05/2026 — pas des controles
-- executables sur l'ERP. Le "score qualite 85%" n'etait donc pas mesurable.
-- Ils sont ici traduits en requetes, plus 6 controles ajoutes (C15-C20) qui
-- couvrent les defauts structurels releves dans l'analyse du CDC.
--
-- Usage :  sqlite3 gestionfil.db "SELECT * FROM v_controles;"
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Detail par controle : chaque vue liste les lignes en anomalie.
-- -----------------------------------------------------------------------------

-- C01 : somme des pourcentages <> 100% par (qualite, role)
-- La tolerance de 0,5 point est celle qu'appliquait le parametre local des
-- recettes ; elle est desormais la meme pour toutes les qualites.
DROP VIEW IF EXISTS v_ctl_c01 CASCADE;
CREATE VIEW v_ctl_c01 AS
SELECT r.code_qualite, q.nom AS qualite_nom, q.statut, r.code_role,
       ROUND(SUM(r.pourcentage_composition), 2) AS somme_pct
FROM recette r
JOIN qualite q ON q.code_qualite = r.code_qualite
WHERE r.actif = 1 AND q.statut = 'ACTIF'
-- `q.nom` et `q.statut` dependent de `code_qualite`, deja groupe.
GROUP BY r.code_qualite, q.nom, q.statut, r.code_role
HAVING abs(SUM(r.pourcentage_composition) - 100.0) > 0.5;

-- C02 : BC envoyes et non soldes depuis plus de 30 jours
DROP VIEW IF EXISTS v_ctl_c02 CASCADE;
CREATE VIEW v_ctl_c02 AS
SELECT bc.id_bc, bc.numero_bc, bc.code_fournisseur, bc.date_envoi, bc.statut,
       CAST((current_date - (bc.date_envoi)::date) AS integer) AS jours_depuis_envoi
FROM bon_commande bc
WHERE bc.statut IN ('ENVOYE','LIVRE_PARTIEL')
  AND bc.date_envoi IS NOT NULL
  AND (current_date - (bc.date_envoi)::date) > 30;

-- C03 / C04 : references et fournisseurs orphelins.
-- Structurellement impossibles depuis que les cles etrangeres sont declarees
-- NOT NULL (le CDC laissait reference.code_fournisseur nullable). Conserves
-- comme controles de non-regression sur PRAGMA foreign_keys.
DROP VIEW IF EXISTS v_ctl_c03 CASCADE;
CREATE VIEW v_ctl_c03 AS
SELECT lm.id_ligne_mouvement, lm.code_reference
FROM ligne_mouvement lm
WHERE NOT EXISTS (SELECT 1 FROM reference r WHERE r.code_reference = lm.code_reference);

DROP VIEW IF EXISTS v_ctl_c04 CASCADE;
CREATE VIEW v_ctl_c04 AS
SELECT r.code_reference, r.code_fournisseur
FROM reference r
WHERE NOT EXISTS (SELECT 1 FROM fournisseur f WHERE f.code_fournisseur = r.code_fournisseur);

-- C05 : stock projete negatif sur 12 mois
DROP VIEW IF EXISTS v_ctl_c05 CASCADE;
CREATE VIEW v_ctl_c05 AS
SELECT code_reference, designation, stock_mrp_kg, encours_kg, besoin_12m_kg,
       stock_projete_kg, jours_couverture, statut
FROM v_stock_projete
WHERE stock_projete_kg < 0;

-- C06 : mouvement date dans le futur
DROP VIEW IF EXISTS v_ctl_c06 CASCADE;
CREATE VIEW v_ctl_c06 AS
SELECT id_mouvement, numero_mouvement, date_mouvement
FROM mouvement
WHERE date_mouvement > to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

-- C07 : sortie production sans numero d'OF
DROP VIEW IF EXISTS v_ctl_c07 CASCADE;
CREATE VIEW v_ctl_c07 AS
SELECT m.id_mouvement, m.numero_mouvement, lm.id_ligne_mouvement, lm.code_reference
FROM ligne_mouvement lm
JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
WHERE m.code_type_mvt = 'SORTIE_PROD'
  AND COALESCE(lm.numero_of, m.numero_of) IS NULL;

-- C08 : retour sans motif de ligne
DROP VIEW IF EXISTS v_ctl_c08 CASCADE;
CREATE VIEW v_ctl_c08 AS
SELECT m.id_mouvement, m.numero_mouvement, lm.id_ligne_mouvement, m.code_type_mvt
FROM ligne_mouvement lm
JOIN mouvement m       ON m.id_mouvement = lm.id_mouvement
JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
WHERE tm.exige_motif_ligne = 1 AND lm.code_motif_ligne IS NULL;

-- C09 : mouvement sans utilisateur (impossible : colonne NOT NULL)
DROP VIEW IF EXISTS v_ctl_c09 CASCADE;
CREATE VIEW v_ctl_c09 AS
SELECT id_mouvement, numero_mouvement FROM mouvement WHERE id_utilisateur IS NULL;

-- C10 : ecart de pesee hors tolerance sans derogation tracee
DROP VIEW IF EXISTS v_ctl_c10 CASCADE;
CREATE VIEW v_ctl_c10 AS
SELECT lr.id_ligne_reception, rc.numero_reception, lr.code_reference,
       lr.quantite_commandee_kg, lr.quantite_stock_kg, ROUND(lr.ecart_pct, 2) AS ecart_pct,
       lr.derogation_ecart
FROM ligne_reception lr
JOIN reception rc ON rc.id_reception = lr.id_reception
WHERE lr.ecart_pct IS NOT NULL
  AND lr.derogation_ecart = 0
  AND abs(lr.ecart_pct) > (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee');

-- C11 / C15 : DERIVE entre le solde cache (stock_magasin) et le grand livre.
-- Controle central : stock_magasin est un cache recalculable, ligne_mouvement
-- est la verite. Toute divergence signale un bug d'application.
DROP VIEW IF EXISTS v_ctl_c11 CASCADE;
CREATE VIEW v_ctl_c11 AS
WITH livre AS (
    SELECT m.code_magasin, lm.code_reference,
           ROUND(SUM(tm.signe * lm.quantite_kg), 4) AS solde_livre_kg
    FROM ligne_mouvement lm
    JOIN mouvement       m  ON m.id_mouvement   = lm.id_mouvement
    JOIN type_mouvement  tm ON tm.code_type_mvt = m.code_type_mvt
    GROUP BY m.code_magasin, lm.code_reference
)
SELECT sm.code_reference, sm.code_magasin,
       sm.quantite_kg                       AS solde_cache_kg,
       COALESCE(l.solde_livre_kg, 0)        AS solde_livre_kg,
       ROUND(sm.quantite_kg - COALESCE(l.solde_livre_kg, 0), 4) AS derive_kg
FROM stock_magasin sm
LEFT JOIN livre l ON l.code_magasin = sm.code_magasin AND l.code_reference = sm.code_reference
WHERE abs(sm.quantite_kg - COALESCE(l.solde_livre_kg, 0)) > 0.01;

-- C12 : reference active a prix nul ou absent
DROP VIEW IF EXISTS v_ctl_c12 CASCADE;
CREATE VIEW v_ctl_c12 AS
SELECT code_reference, designation, prix_catalogue, prix_catalogue_kg
FROM reference
WHERE actif = 1 AND (prix_catalogue IS NULL OR prix_catalogue <= 0 OR prix_catalogue_kg IS NULL);

-- C13 : reference active sans fournisseur (impossible : NOT NULL)
DROP VIEW IF EXISTS v_ctl_c13 CASCADE;
CREATE VIEW v_ctl_c13 AS
SELECT code_reference, designation FROM reference WHERE actif = 1 AND code_fournisseur IS NULL;

-- C14 : composant de recette a cout nul
DROP VIEW IF EXISTS v_ctl_c14 CASCADE;
CREATE VIEW v_ctl_c14 AS
SELECT DISTINCT r.code_qualite, r.code_reference, ref.designation,
       ref.prix_catalogue_kg, ref.cmup_mad
FROM recette r
JOIN qualite   q  ON q.code_qualite = r.code_qualite
JOIN reference ref ON ref.code_reference = r.code_reference
WHERE r.actif = 1 AND q.statut = 'ACTIF'
  AND COALESCE(ref.cmup_mad, ref.prix_catalogue_kg, 0) <= 0;

-- C15 : derive entre stock_lot et stock_magasin (tracabilite lot)
DROP VIEW IF EXISTS v_ctl_c15 CASCADE;
CREATE VIEW v_ctl_c15 AS
SELECT sm.code_reference, sm.code_magasin,
       sm.quantite_kg                                        AS solde_magasin_kg,
       ROUND(COALESCE(SUM(sl.quantite_kg), 0), 4)            AS solde_lots_kg,
       ROUND(sm.quantite_kg - COALESCE(SUM(sl.quantite_kg), 0), 4) AS derive_kg
FROM stock_magasin sm
JOIN reference r ON r.code_reference = sm.code_reference AND r.suivi_lot = 1
LEFT JOIN stock_lot sl ON sl.code_reference = sm.code_reference AND sl.code_magasin = sm.code_magasin
-- `sm.quantite_kg` est le solde de la ligne groupee : une seule valeur
-- par (reference, magasin).
GROUP BY sm.code_reference, sm.code_magasin, sm.quantite_kg
HAVING abs(sm.quantite_kg - COALESCE(SUM(sl.quantite_kg), 0)) > 0.01;

-- C16 : ligne de composition dont le role n'a pas de densite sur la qualite.
-- C'est exactement le cas ou la vue I4 du CDC produisait un besoin de 0 kg en
-- silence, via COALESCE(lq.densite, 0).
DROP VIEW IF EXISTS v_ctl_c16 CASCADE;
CREATE VIEW v_ctl_c16 AS
SELECT r.code_qualite, q.statut, r.code_role, r.code_reference
FROM recette r
JOIN qualite q ON q.code_qualite = r.code_qualite
WHERE r.actif = 1
  AND NOT EXISTS (
    SELECT 1 FROM ligne_qualite lq
    WHERE lq.code_qualite = r.code_qualite AND lq.code_role = r.code_role AND lq.actif = 1);

-- C17 : reference active n'apparaissant dans aucune recette (T09 du CDC : 35 refs)
DROP VIEW IF EXISTS v_ctl_c17 CASCADE;
CREATE VIEW v_ctl_c17 AS
SELECT r.code_reference, r.designation, r.classe_abc
FROM reference r
WHERE r.actif = 1
  AND NOT EXISTS (SELECT 1 FROM recette c WHERE c.code_reference = r.code_reference AND c.actif = 1);

-- C18 : qualite planifiee sans aucune densite de role definie
DROP VIEW IF EXISTS v_ctl_c18 CASCADE;
CREATE VIEW v_ctl_c18 AS
SELECT DISTINCT lpp.code_qualite, q.nom
FROM ligne_plan_production lpp
JOIN qualite q ON q.code_qualite = lpp.code_qualite
WHERE lpp.m2_prevus > 0
  AND NOT EXISTS (SELECT 1 FROM ligne_qualite lq WHERE lq.code_qualite = lpp.code_qualite AND lq.actif = 1);

-- C19 : taux de change absent pour une devise utilisee au catalogue
DROP VIEW IF EXISTS v_ctl_c19 CASCADE;
CREATE VIEW v_ctl_c19 AS
SELECT DISTINCT r.code_devise_catalogue
FROM reference r
WHERE r.actif = 1
  AND NOT EXISTS (
      SELECT 1 FROM taux_change tc
      WHERE tc.code_devise = r.code_devise_catalogue
        AND to_char(current_date, 'YYYY-MM-DD') >= substr(tc.date_debut, 1, 10)
        AND (tc.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(tc.date_fin, 1, 10)));

-- C20 : reference mono-source de classe A (risque d'approvisionnement, CDC E9 zone 6)
DROP VIEW IF EXISTS v_ctl_c20 CASCADE;
CREATE VIEW v_ctl_c20 AS
SELECT r.code_reference, r.designation, r.code_fournisseur, f.pays, r.classe_abc
FROM reference r
JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
WHERE r.actif = 1 AND r.classe_abc = 'A'
  -- Un equivalent chez le MEME fournisseur ne desamorce pas le mono-source :
  -- les deux references dependent de la meme maison.
  AND NOT EXISTS (
      SELECT 1
      FROM reference_groupe_equiv rge1
      JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                      AND rge2.code_reference   <> rge1.code_reference
                                      AND rge2.actif = 1
      JOIN reference r2 ON r2.code_reference = rge2.code_reference AND r2.actif = 1
      WHERE rge1.code_reference = r.code_reference AND rge1.actif = 1
        AND r2.code_fournisseur IS DISTINCT FROM r.code_fournisseur);

-- C21 : role portant une densite sur la qualite, mais aucune matiere au
-- catalogue ni aucune ligne de recette.
-- Constate a l'import de GESTION Fil.xlsx : les 18 qualites declarent
-- 0,8 ml/m2 de Franges, et AUCUNE reference du catalogue ne porte ce role.
-- Consequence : les franges sont consommees en production et ne sont jamais
-- planifiees ni achetees. Ce n'est pas une erreur de saisie, c'est une matiere
-- manquante — d'ou un controle plutot qu'un blocage a l'import.
DROP VIEW IF EXISTS v_ctl_c21 CASCADE;
CREATE VIEW v_ctl_c21 AS
SELECT lq.code_qualite, lq.code_role, lq.densite, lq.unite_densite,
       (SELECT COUNT(*) FROM reference r
         JOIN recette c2 ON c2.code_reference = r.code_reference
        WHERE c2.code_role = lq.code_role) AS refs_disponibles
FROM ligne_qualite lq
WHERE lq.actif = 1
  AND lq.densite > 0
  AND NOT EXISTS (
      SELECT 1 FROM recette r
      WHERE r.code_qualite = lq.code_qualite
        AND r.actif = 1
        AND r.code_role = lq.code_role);

-- C27 : ECART MAJEUR entre la couverture annoncee et le stock reel.
--
-- La couverture en jours est une projection : elle suppose que les besoins du
-- MRP sont a jour, que les commandes arrivent, et que tout le stock est
-- utilisable. Quand elle annonce du confort alors que le magasin est sous son
-- minimum, l'une de ces trois hypotheses est fausse — et le plus souvent c'est
-- une consommation, une casse ou une perte qui n'a pas ete declaree.
--
-- Ce controle ne dit pas « commandez » : il dit « allez verifier ». C'est une
-- alerte de VERITE DES DONNEES, pas une alerte de stock, et elle se traite par
-- un inventaire tournant, pas par un bon de commande.
DROP VIEW IF EXISTS v_ctl_c27 CASCADE;
CREATE VIEW v_ctl_c27 AS
SELECT sp.code_reference, sp.designation,
       sp.jours_couverture, sp.stock_physique_net_kg,
       r.stock_min_kg,
       ROUND(r.stock_min_kg - sp.stock_physique_net_kg, 3) AS manque_kg,
       sp.stock_quarantaine_kg, sp.encours_retarde_kg, sp.besoins_calcules_le
FROM v_stock_projete sp
JOIN reference r ON r.code_reference = sp.code_reference
WHERE sp.ecart_majeur = 1;

-- C28 : commande en retard qui ne compte plus dans la couverture.
--
-- Passe la tolerance, la quantite est retiree du calcul (v_encours_fiable) et la
-- couverture s'effondre. Le controle nomme la cause, sans quoi l'acheteur verrait
-- une alerte apparaitre sans comprendre ce qui a change : rien n'a bouge au
-- magasin, c'est une date qui est passee.
DROP VIEW IF EXISTS v_ctl_c28 CASCADE;
CREATE VIEW v_ctl_c28 AS
SELECT lb.code_reference, r.designation, bc.numero_bc, bc.code_fournisseur,
       lb.date_livraison_prevue,
       CAST((current_date - (lb.date_livraison_prevue)::date) AS integer) AS retard_jours,
       lb.quantite_restante_kg
FROM ligne_bc lb
JOIN bon_commande bc ON bc.id_bc = lb.id_bc
JOIN reference r     ON r.code_reference = lb.code_reference
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_RetardBCJours') p
WHERE bc.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
  AND lb.statut NOT IN ('ANNULE','SOLDE')
  AND lb.quantite_restante_kg > 0
  AND substr(lb.date_livraison_prevue, 1, 10) < to_char(current_date - (p.v)::integer, 'YYYY-MM-DD');

-- C29 : la projection repose sur des besoins plus anciens que le plan.
--
-- Le stock est vivant, les besoins sont figes au dernier calcul MRP. Quand le
-- plan a bouge depuis, la couverture affichee raisonne sur un plan qui n'existe
-- plus — et l'erreur va toujours dans le sens rassurant : un plan revu a la
-- hausse laisse les besoins bas, donc la projection haute, donc l'alerte verte.
DROP VIEW IF EXISTS v_ctl_c29 CASCADE;
CREATE VIEW v_ctl_c29 AS
SELECT pp.id_plan, pp.libelle, pp.statut,
       pp.date_modification,
       (SELECT MAX(date_calcul) FROM besoin_mrp b WHERE b.id_plan = pp.id_plan) AS dernier_calcul
FROM plan_production pp
WHERE pp.statut = 'EN_COURS'
  AND (
      NOT EXISTS (SELECT 1 FROM besoin_mrp b WHERE b.id_plan = pp.id_plan)
   OR COALESCE(pp.date_modification, pp.date_creation)
      > (SELECT MAX(date_calcul) FROM besoin_mrp b WHERE b.id_plan = pp.id_plan)
  );

-- -----------------------------------------------------------------------------
-- Tableau de bord des controles
-- criticite BLOQUANT : aucune anomalie toleree pour une mise en production.
-- -----------------------------------------------------------------------------

-- C22 : groupe d'equivalence dont les references ne sont PAS interchangeables.
-- Substituer l'une a l'autre changerait le kg/m2 des recettes : le groupe promet
-- une securite qu'il ne peut pas tenir.
DROP VIEW IF EXISTS v_ctl_c22 CASCADE;
CREATE VIEW v_ctl_c22 AS
SELECT code_groupe_equiv, libelle, nb_references, nb_unites, nb_densites, nb_categories
FROM v_groupe_equiv_detail
WHERE nb_references > 1
  AND (nb_unites > 1 OR nb_densites > 1 OR nb_categories > 1);

-- C23 : groupe de plusieurs references sans preferentielle. Rien ne dit laquelle
-- le plan d'achat doit proposer par defaut.
DROP VIEW IF EXISTS v_ctl_c23 CASCADE;
CREATE VIEW v_ctl_c23 AS
SELECT code_groupe_equiv, libelle, nb_references, nb_preferentielles
FROM v_groupe_equiv_detail
WHERE nb_references > 1 AND COALESCE(nb_preferentielles, 0) <> 1;

-- C24 : ligne de reception dont la reference differe de la ligne de commande
-- SANS substitution declaree. Rattrape ce qui a ete saisi avant le trigger
-- trg_ligne_reception_substitution : ces lignes ont solde une commande avec une
-- matiere qui n'etait pas celle attendue, et le besoin d'origine reste entier.
DROP VIEW IF EXISTS v_ctl_c24 CASCADE;
CREATE VIEW v_ctl_c24 AS
SELECT rc.numero_reception, rc.date_reception, lb.code_reference AS commandee,
       lr.code_reference AS recue, lr.quantite_stock_kg, rc.code_fournisseur
FROM ligne_reception lr
JOIN reception   rc ON rc.id_reception = lr.id_reception
JOIN ligne_bc    lb ON lb.id_ligne_bc  = lr.id_ligne_bc
WHERE lb.code_reference <> lr.code_reference
  AND lr.substitution_acceptee = 0;

-- C25 : reference alternative portant du stock sans aucun besoin planifie.
-- Ce n'est pas une faute, c'est du capital immobilise : la matiere est en
-- magasin, sa jumelle est peut-etre en tension, et le MRP ne les rapproche pas
-- de lui-meme. Le rapprochement est une decision, et elle n'a pas ete prise.
DROP VIEW IF EXISTS v_ctl_c25 CASCADE;
CREATE VIEW v_ctl_c25 AS
SELECT e.code_reference, e.designation, e.stock_kg,
       e.equivalent_reference, e.equivalent_statut,
       e.equivalent_besoin_12m_kg, e.equivalent_stock_projete_kg
FROM v_equivalence e
WHERE e.stock_kg > 0
  AND e.besoin_12m_kg = 0
  AND e.interchangeable = 1
  -- La jumelle doit etre REELLEMENT en tension. Se contenter d'un besoin non nul
  -- remontait toute alternative dont la preferentielle est employee — c'est-a
  -- dire l'etat NORMAL d'un groupe, et non une anomalie.
  AND e.equivalent_statut IS NOT NULL
  AND e.equivalent_statut <> 'OK';

-- C26 : groupe d'equivalence dont toutes les references viennent du MEME
-- fournisseur. Le groupe promet une alternative d'approvisionnement qu'il ne
-- peut pas tenir : si ce fournisseur fait defaut, aucune des references n'est
-- disponible. A completer par la reference d'un autre fournisseur, ou a assumer
-- comme un simple regroupement technique.
DROP VIEW IF EXISTS v_ctl_c26 CASCADE;
CREATE VIEW v_ctl_c26 AS
SELECT code_groupe_equiv, libelle, nb_references, nb_fournisseurs
FROM v_groupe_equiv_detail
WHERE qualification = 'MEME FOURNISSEUR';

DROP VIEW IF EXISTS v_controles CASCADE;
CREATE VIEW v_controles AS
SELECT 'C01' AS code, 'Somme des % <> 100 par role BOM'                AS controle, 'BLOQUANT'  AS criticite, (SELECT COUNT(*) FROM v_ctl_c01) AS anomalies UNION ALL
SELECT 'C02', 'BC envoyes non soldes depuis plus de 30j',              'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c02) UNION ALL
SELECT 'C03', 'Reference de mouvement absente du catalogue',           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c03) UNION ALL
SELECT 'C04', 'Fournisseur de reference inexistant',                   'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c04) UNION ALL
SELECT 'C05', 'Stock projete negatif sur 12 mois',                     'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c05) UNION ALL
SELECT 'C06', 'Mouvement date dans le futur',                          'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c06) UNION ALL
SELECT 'C07', 'Sortie production sans numero d''OF',                   'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c07) UNION ALL
SELECT 'C08', 'Retour sans motif de ligne',                            'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c08) UNION ALL
SELECT 'C09', 'Mouvement sans utilisateur',                            'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c09) UNION ALL
SELECT 'C10', 'Ecart de pesee hors tolerance sans derogation',         'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c10) UNION ALL
SELECT 'C11', 'Derive solde de stock vs grand livre',                  'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c11) UNION ALL
SELECT 'C12', 'Reference active a prix nul',                           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c12) UNION ALL
SELECT 'C13', 'Reference active sans fournisseur',                     'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c13) UNION ALL
SELECT 'C14', 'Composant de recette validee a cout nul',               'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c14) UNION ALL
SELECT 'C15', 'Derive stock par lot vs stock par magasin',             'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c15) UNION ALL
SELECT 'C16', 'Role de recette sans densite sur la qualite',           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c16) UNION ALL
SELECT 'C17', 'Reference active sans recette (orpheline)',             'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c17) UNION ALL
SELECT 'C18', 'Qualite planifiee sans densite de role',                'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c18) UNION ALL
SELECT 'C19', 'Devise catalogue sans taux de change en vigueur',       'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c19) UNION ALL
SELECT 'C20', 'Reference classe A mono-source',                        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c20) UNION ALL
SELECT 'C21', 'Role avec densite mais sans matiere en recette',        'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c21) UNION ALL
SELECT 'C22', 'Groupe d''equivalence aux references non interchangeables', 'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c22) UNION ALL
SELECT 'C23', 'Groupe d''equivalence sans reference preferentielle',     'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c23) UNION ALL
SELECT 'C24', 'Reception d''une autre reference sans substitution declaree', 'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c24) UNION ALL
SELECT 'C25', 'Stock mobilisable face a un equivalent en tension',        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c25) UNION ALL
SELECT 'C26', 'Groupe d''equivalence limite a un seul fournisseur',        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c26) UNION ALL
SELECT 'C27', 'Ecart majeur : couverture confortable, magasin sous le minimum', 'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c27) UNION ALL
SELECT 'C28', 'Commande en retard, retiree du calcul de couverture',      'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c28) UNION ALL
SELECT 'C29', 'Besoins plus anciens que le plan : projection perimee',    'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c29) UNION ALL
-- Les trois derniers viennent de la feuille Tests du classeur (T12, T17, T19).
-- Leurs vues de detail sont definies dans 016_controles_classeur.sql, charge
-- juste avant celui-ci lors de la construction.
SELECT 'C30', 'Delai fournisseur absent, nul ou negatif',                'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c30) UNION ALL
SELECT 'C31', 'Reception validee non repercutee au stock',               'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c31) UNION ALL
SELECT 'C32', 'Reception valorisee absente de l''historique des prix',   'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c32);
