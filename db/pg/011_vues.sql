-- Porte automatiquement depuis db/011_vues.sql par pg/porter_vues.py.
-- NE PAS MODIFIER ICI : corriger la source, puis rejouer le portage.

-- =============================================================================
-- VUES DE PILOTAGE
-- =============================================================================
-- Les 7 vues du CDC (partie I) sont reecrites. Defauts corriges :
--   * duplication du stock par magasin (jointure non agregee)
--   * absence de l'en-cours fournisseur dans le stock projete
--   * consommation MRP utilisee au lieu de la consommation reelle (correction N4)
--   * arithmetique NULL du plan d'achat (max()/NULLIF sous SQLite et GREATEST
--     sous PostgreSQL n'ont pas la meme semantique face a NULL)
--   * fan-out d'agregat dans le scorecard fournisseur
--   * stock neuf classe dormant
--
-- ATTENTION SQLite : GREATEST(a, b, c) scalaire renvoie NULL si un argument est NULL
-- (contrairement a GREATEST de PostgreSQL qui ignore les NULL). Tous les termes
-- sont donc explicitement COALESCE. C'est precisement le piege qui mettait la
-- quantite a commander a 0 en silence dans la vue I2 du CDC.
-- =============================================================================

-- =============================================================================
-- 1. RECETTES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_recette_calculee  (ex v_ligne_recette_calculee)
-- Remplace la colonne stockee `kg_m2` du CDC (donnee derivee sans trigger de
-- coherence = derive garantie).
-- Formule E3, les deux cas d'unite de densite :
--     kg/m2 : kg_m2 = densite_role * (% / 100)
--     ml/m2 : kg_m2 = densite_role * (% / 100) * densite_kg_ml_reference
-- Jointure INTERNE sur ligne_qualite : pas de COALESCE(...,0), donc pas de
-- besoin nul silencieux. Le trigger trg_qualite_activer_roles garantit qu'une
-- qualite ACTIVE ne peut pas avoir de role sans densite.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_ligne_recette_calculee CASCADE;
DROP VIEW IF EXISTS v_recette_calculee CASCADE;
CREATE VIEW v_recette_calculee AS
SELECT
    r.id_recette,
    r.code_qualite,
    q.nom                           AS qualite_nom,
    q.statut                        AS statut_qualite,
    r.ligne_numero,
    r.code_reference,
    ref.designation,
    r.code_role,
    rb.libelle                      AS role_libelle,
    r.pourcentage_composition,
    r.couleur,
    r.code_groupe_equiv,
    lq.densite                      AS densite_role,
    lq.unite_densite,
    ref.densite_kg_ml,
    ROUND(
        CASE lq.unite_densite
            WHEN 'kg_m2' THEN lq.densite * r.pourcentage_composition / 100.0
            WHEN 'ml_m2' THEN lq.densite * r.pourcentage_composition / 100.0 * ref.densite_kg_ml
        END, 6)                     AS kg_m2
FROM recette r
JOIN qualite       q  ON q.code_qualite  = r.code_qualite
JOIN ligne_qualite lq ON lq.code_qualite = r.code_qualite
                     AND lq.code_role    = r.code_role
                     AND lq.actif        = 1
JOIN role_bom      rb ON rb.code_role    = r.code_role
JOIN reference    ref ON ref.code_reference = r.code_reference
WHERE r.actif = 1;

-- =============================================================================
-- 2. MRP
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_besoin_mrp_calcule
-- Formule F2, AGREGEE par reference (exigence explicite de F2 que la vue I4 du
-- CDC ne respectait pas), avec application du taux de perte embarque sur le plan.
-- Le lien plan -> composition passe par plan_qualite (correction BL-4).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_besoin_mrp_calcule CASCADE;
CREATE VIEW v_besoin_mrp_calcule AS
SELECT
    pp.id_plan,
    pp.libelle                              AS plan_libelle,
    pp.annee,
    lpp.mois,
    lpp.rang_mois,
    lpp.annee_mois,
    rc.code_reference,
    ROUND(SUM(lpp.m2_prevus * rc.kg_m2), 4)                                AS quantite_brute_kg,
    pp.taux_perte_pct,
    ROUND(SUM(lpp.m2_prevus * rc.kg_m2) * (1 + pp.taux_perte_pct / 100.0), 4) AS quantite_kg
FROM plan_production pp
JOIN ligne_plan_production lpp ON lpp.id_plan = pp.id_plan
JOIN plan_qualite pq          ON pq.id_plan   = pp.id_plan
                             AND pq.code_qualite = lpp.code_qualite
JOIN v_recette_calculee rc    ON rc.code_qualite = pq.code_qualite
WHERE lpp.m2_prevus > 0
-- `lpp.mois` et `lpp.annee_mois` sont fonctionnellement determines par
-- (id_plan, rang_mois) : les citer ne change aucun resultat. SQLite les
-- tolerait hors GROUP BY en choisissant une ligne au hasard ; PostgreSQL
-- les exige, et il a raison — le hasard n'a rien a faire dans un calcul
-- de besoins.
GROUP BY pp.id_plan, lpp.rang_mois, lpp.mois, lpp.annee_mois, rc.code_reference;

-- -----------------------------------------------------------------------------
-- v_besoin_12m : besoins figes des plans EN_COURS couvrant la date du jour (R08)
-- -----------------------------------------------------------------------------
-- Le nom est trompeur et le reste pour l'instant : la vue ne couvre PAS douze
-- mois, elle couvre l'horizon du plan en service, quel qu'il soit. Le renommer
-- toucherait le service Rust et six ecrans ; la correction du calcul, elle, ne
-- pouvait pas attendre.
--
-- LE BESOIN EST LE PLAN SEUL (decision du 26/10/2026, migration
-- 2026-10-27b_besoin_plan_seul.sql). Du 22/10 au 27/10 (2026-10-22c), les OF
-- retenus consommaient le plan (besoin = OF + plan non couvert) ; c'est retire :
-- l'OF est du court terme et ne sert que l'axe production / statistiques
-- (v_of_mois, v_besoin_of_qualite, v_of_bilan, C64). La definition en service
-- garde les deux colonnes ajoutees par 22c, besoin_plan_12m_kg (= besoin_12m_kg)
-- et besoin_au_dela_12m_kg (= 0). Elles etaient reprises par v_stock_projete, et
-- v_besoin_of_mois et v_besoin_horizon_of survivaient, vides : les trois sont
-- retirees depuis le 27/10/2026 (une seule source de verite, le moteur de
-- couverture, migration 2026-10-27e). Cette vue reste : c'est la lecture du plan
-- restant (une entree, pas un calcul de besoin).
DROP VIEW IF EXISTS v_besoin_12m CASCADE;
CREATE VIEW v_besoin_12m AS
-- -----------------------------------------------------------------------------
-- CE QUI RESTE A CONSOMMER, PAS CE QUE LE PLAN PREVOYAIT EN TOUT.
--
-- La vue sommait TOUS les mois du plan, passes compris. Or le stock projete
-- s'ecrit « physique + en-cours - besoin » : le physique a DEJA perdu ce que
-- les mois passes ont consomme. Ces mois etaient donc retires deux fois — une
-- fois du stock par les sorties reelles, une seconde fois par le plan.
--
-- Mesure sur la base de verification (17/09/2026) : plan d'avril 2026 a mars
-- 2027, 1 000 kg par mois, 3 000 kg en stock. Le plan d'achat proposait
-- 11 600 kg ; le besoin reel en appelait 6 600. SURCOMMANDE : 5 000 kg, soit
-- exactement les cinq mois deja ecoules — et l'ecart grossit d'un mois de
-- consommation a chaque mois qui passe, jusqu'a la fin du plan.
--
-- On ne retient donc que le MOIS COURANT ET LES SUIVANTS. Le mois courant
-- reste compte en entier : il n'est pas encore consomme, et le retirer serait
-- l'erreur inverse — une rupture en fin de mois.
-- -----------------------------------------------------------------------------
WITH horizon AS (
    -- Nombre de mois REELLEMENT couverts par chaque plan. C'est le plan qui
    -- donne le denominateur, jamais une constante : un plan de six mois divise
    -- par six. Diviser par douze halvait la consommation mensuelle, doublait la
    -- couverture affichee, et retardait d'autant le declenchement des alertes
    -- — verifie : facteur exactement 2,0 sur un plan de six mois.
    --
    -- Le denominateur suit le meme horizon que le numerateur : les mois RESTANTS.
    -- Diviser le reste du plan par ses douze mois d'origine ferait fondre la
    -- consommation mensuelle au fil de l'annee.
    SELECT id_plan, COUNT(DISTINCT annee_mois) AS mois
      FROM besoin_mrp
     WHERE annee_mois >= to_char(current_date, 'YYYY-MM')
     GROUP BY id_plan
)
SELECT
    bm.code_reference,
    ROUND(SUM(bm.quantite_kg), 4)                  AS besoin_12m_kg,
    -- LE DENOMINATEUR EST UN CHOIX, PLUS UN HASARD.
    --
    -- `h.mois` vient de la CTE `horizon`, une ligne par plan ; le groupe, lui,
    -- est par reference. SQLite acceptait la colonne nue et prenait la valeur
    -- d'une ligne au hasard. RG-10 garantit qu'un seul plan est EN_COURS a la
    -- fois, donc il n'y avait en pratique qu'une valeur — mais rien ne le
    -- disait, et un jour ou l'invariant casserait, le chiffre aurait change
    -- sans prevenir.
    --
    -- On prend le MINIMUM, et c'est la direction prudente : un horizon plus
    -- court donne un besoin mensuel PLUS ELEVE, donc une couverture plus faible
    -- et des alertes plus tot. L'erreur inverse — diviser par douze quand le
    -- plan couvrait six mois — avait deja ete corrigee ici meme, elle halvait
    -- la consommation et retardait les alertes d'autant.
    ROUND(SUM(bm.quantite_kg)
          / CASE WHEN MIN(h.mois) > 0 THEN MIN(h.mois) ELSE 1 END, 4)
                                                   AS besoin_mensuel_moyen_kg
FROM besoin_mrp bm
JOIN plan_production pp ON pp.id_plan = bm.id_plan
JOIN horizon h          ON h.id_plan  = bm.id_plan
WHERE pp.statut = 'EN_COURS'
  AND to_char(current_date, 'YYYY-MM-DD') BETWEEN pp.date_debut AND pp.date_fin
  AND bm.annee_mois >= to_char(current_date, 'YYYY-MM')
GROUP BY bm.code_reference;

-- =============================================================================
-- 3. STOCK
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_stock_disponible
-- CORRECTION : la vue I1 du CDC joignait stock_magasin SANS agregation. Une
-- reference presente dans 3 magasins produisait 3 lignes, chacune ne voyant
-- qu'un tiers du stock -> ruptures surcomptees et 3 propositions d'achat pour
-- la meme reference. Le flag magasin.inclure_mrp, prevu pour exclure la zone de
-- quarantaine, n'etait par ailleurs utilise nulle part.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_disponible CASCADE;
CREATE VIEW v_stock_disponible AS
SELECT
    r.code_reference,
    ROUND(COALESCE(SUM(CASE WHEN mg.inclure_mrp = 1 THEN sm.quantite_kg END), 0), 4) AS stock_mrp_kg,
    ROUND(COALESCE(SUM(sm.quantite_kg), 0), 4)                                       AS stock_total_kg,
    ROUND(COALESCE(SUM(CASE WHEN mg.est_quarantaine = 1 THEN sm.quantite_kg END), 0), 4) AS stock_quarantaine_kg,
    ROUND(COALESCE(SUM(sm.quantite_kg * COALESCE(sm.cmup_mad, 0)), 0), 2)            AS valeur_totale_mad,
    MAX(sm.date_derniere_entree)                                                     AS date_derniere_entree,
    MAX(sm.date_derniere_sortie)                                                     AS date_derniere_sortie
FROM reference r
LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
LEFT JOIN magasin       mg ON mg.code_magasin   = sm.code_magasin
WHERE r.actif = 1
GROUP BY r.code_reference;

-- -----------------------------------------------------------------------------
-- v_encours_bc
-- CORRECTION : la vue I1 du CDC definissait stock_projete = stock - besoins,
-- en ignorant les commandes deja passees. Definition MRP correcte :
--     disponible = stock + en-cours - besoins
-- Sans ce terme, le systeme recommande de recommander ce qui est deja commande.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_encours_bc CASCADE;
CREATE VIEW v_encours_bc AS
SELECT
    lb.code_reference,
    ROUND(SUM(lb.quantite_restante_kg), 4) AS encours_kg,
    COUNT(DISTINCT lb.id_bc)               AS nb_bc_ouverts,
    MIN(lb.date_livraison_prevue)          AS prochaine_livraison
FROM ligne_bc lb
JOIN bon_commande bc ON bc.id_bc = lb.id_bc
WHERE bc.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
  AND lb.statut NOT IN ('ANNULE','SOLDE')
  AND lb.type_ligne = 'MARCHANDISE'
  AND lb.quantite_restante_kg > 0
GROUP BY lb.code_reference;

-- -----------------------------------------------------------------------------
-- v_conso_reelle
-- Consommation mensuelle REELLE, conformement a la correction N4 du 11/06/2026 :
--     Conso_Mensuelle = Sorties_Cumulees / nb_mois_reellement_ecoules
-- La vue I1 du CDC utilisait SUM(besoin_mrp)/12, c'est-a-dire la consommation
-- PREVISIONNELLE : la correction N4 n'avait pas ete reportee dans le SQL.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_conso_reelle CASCADE;
CREATE VIEW v_conso_reelle AS
SELECT
    lm.code_reference,
    ROUND(SUM(lm.quantite_kg), 4) AS sorties_cumulees_kg,
    GREATEST(1, CAST(((current_date - (min(m.date_mouvement))::date)) / 30.44 AS bigint)) AS nb_mois_ecoules,
    ROUND(SUM(lm.quantite_kg)
          / GREATEST(1, CAST(((current_date - (min(m.date_mouvement))::date)) / 30.44 AS bigint)), 4) AS conso_mensuelle_kg,
    min(m.date_mouvement) AS premiere_sortie,
    max(m.date_mouvement) AS derniere_sortie
FROM ligne_mouvement lm
JOIN mouvement       m  ON m.id_mouvement  = lm.id_mouvement
JOIN type_mouvement  tm ON tm.code_type_mvt = m.code_type_mvt
WHERE tm.signe = -1
  AND m.code_type_mvt = 'SORTIE_PROD'
GROUP BY lm.code_reference;

-- -----------------------------------------------------------------------------
-- v_conso_retenue
-- Consommation de reference du pilotage. Le repli sur la prevision MRP quand
-- aucun historique de sortie n'existe est AUTORISE mais TRACE (source_conso),
-- au lieu du COALESCE(..., 1) silencieux de la vue I1 du CDC — qui contredisait
-- frontalement B2/R01 "jamais de fallback silencieux".
-- -----------------------------------------------------------------------------
-- FIX P1 (feuille GESTION FIL, mai 2026) : c'est le MAXIMUM des deux sources,
-- pas la premiere disponible.
--
-- Retenir l'historique des qu'il existe, comme le faisait un COALESCE, sous-
-- estime la consommation chaque fois que le plan est plus ambitieux que le passe
-- — c'est-a-dire precisement quand la production monte. La couverture s'en
-- trouve surevaluee, et l'alerte reste verte pendant que le besoin croit.
--
-- Le maximum protege dans les deux sens : un demarrage sans historique prend le
-- previsionnel, une consommation reelle superieure au plan prend le reel.
DROP VIEW IF EXISTS v_conso_retenue CASCADE;
CREATE VIEW v_conso_retenue AS
SELECT
    r.code_reference,
    -- max() scalaire de SQLite propage les NULL : chaque terme est COALESCE, et
    -- le zero final redevient NULL pour distinguer « aucune donnee » de « zero ».
    NULLIF(GREATEST(COALESCE(cr.conso_mensuelle_kg, 0), COALESCE(b.besoin_mensuel_moyen_kg, 0)), 0)   AS conso_mensuelle_kg,
    ROUND(COALESCE(cr.conso_mensuelle_kg, 0), 4)             AS conso_reelle_kg,
    ROUND(COALESCE(b.besoin_mensuel_moyen_kg, 0), 4)         AS conso_previsionnelle_kg,
    CASE
        WHEN cr.conso_mensuelle_kg IS NULL AND b.besoin_mensuel_moyen_kg IS NULL
             THEN 'INDETERMINEE'
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) >= COALESCE(b.besoin_mensuel_moyen_kg, 0)
             THEN 'REELLE'
        ELSE 'PREVISIONNELLE_MRP'
    END AS source_conso,
    cr.nb_mois_ecoules
FROM reference r
LEFT JOIN v_conso_reelle cr ON cr.code_reference = r.code_reference
LEFT JOIN v_besoin_12m   b  ON b.code_reference  = r.code_reference
WHERE r.actif = 1;

-- -----------------------------------------------------------------------------
-- v_stock_min_dynamique
-- Formule F3 (MAX de 4 securites), absente des vues du CDC qui n'utilisaient que
-- le stock_min_kg saisi au catalogue.
-- Rappel SQLite : max() scalaire propage les NULL -> chaque terme est COALESCE.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_min_dynamique CASCADE;
CREATE VIEW v_stock_min_dynamique AS
SELECT
    r.code_reference,
    COALESCE(r.stock_min_kg, 0)                                              AS terme1_catalogue_kg,
    ROUND(COALESCE(r.couverture_min_mois, p_couv.v) * COALESCE(cr.conso_mensuelle_kg, 0)
          * (1 + COALESCE(r.marge_securite_pct, p_marge.v) / 100.0), 4)      AS terme2_couverture_kg,
    ROUND(COALESCE(cr.conso_mensuelle_kg, 0)
          * COALESCE(f.delai_livraison_jours, p_delai.v) / 30.0, 4)          AS terme3_delai_kg,
    ROUND(COALESCE(cr.conso_mensuelle_kg, 0)
          * CASE r.classe_abc WHEN 'A' THEN p_seca.v WHEN 'B' THEN p_secb.v ELSE p_secc.v END
          / 30.0, 4)                                                         AS terme4_securite_abc_kg,
    ROUND(GREATEST(COALESCE(r.stock_min_kg, 0), COALESCE(r.couverture_min_mois, p_couv.v) * COALESCE(cr.conso_mensuelle_kg, 0)
            * (1 + COALESCE(r.marge_securite_pct, p_marge.v) / 100.0), COALESCE(cr.conso_mensuelle_kg, 0) * COALESCE(f.delai_livraison_jours, p_delai.v) / 30.0, COALESCE(cr.conso_mensuelle_kg, 0)
            * CASE r.classe_abc WHEN 'A' THEN p_seca.v WHEN 'B' THEN p_secb.v ELSE p_secc.v END / 30.0), 4)                                                                    AS stock_min_kg
FROM reference r
LEFT JOIN fournisseur     f  ON f.code_fournisseur = r.code_fournisseur
LEFT JOIN v_conso_retenue cr ON cr.code_reference  = r.code_reference
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_CouvMinMois')  p_couv
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_MargeSecurite') p_marge
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_DelaiDefaut')   p_delai
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_SecuriteA')     p_seca
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_SecuriteB')     p_secb
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_SecuriteC')     p_secc
WHERE r.actif = 1;

-- -----------------------------------------------------------------------------
-- v_stock_physique   —   LA REALITE, sans projection
--
-- Cette vue ne raisonne pas. Elle dit ce qu'il y a dans les allees, maintenant :
-- l'utilisable, la quarantaine, ce qui est mis de cote (restes, lots bloques),
-- le fil sur machine et le fil en route vers un magasin compte.
--
-- 27/10/2026 : une seule source de verite, le moteur de couverture (migration
-- 2026-10-27e_source_unique_moteur.sql). La colonne stock_mrp_net_kg — et le
-- parametre P_MrpInclureStockMachine qui la reglait — est retiree : le moteur
-- (backend/src/domain/couverture.rs) fait seul le compte du disponible et de la
-- projection. Le fil sur machine compte au dernier constat, quel que soit son
-- age (2026-10-27b, decision du 26/10/2026) : P_JoursInventMachine ne sert plus
-- que le signal C36.
--
-- FICHIERS D'ORIGINE SANS LOTS NI MACHINES. La definition en service
-- (migrations 2026-10-02 a 2026-10-27e, voir socle/schema.sql) lit les restes
-- et les lots bloques dans `lot` et `stock_lot`, le fil sur machine dans
-- `machine_etat`. Ces tables ne sont pas dans 001-018 : les colonnes qui en
-- viennent y valent donc zero, avec leur nom et leur place, pour que les vues
-- qui les lisent (v_stock_reference) se chargent ici a l'identique. Le transit,
-- lui, se calcule comme en service.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_physique CASCADE;
CREATE VIEW v_stock_physique AS
WITH en_route AS (
    -- Le fil en route (transfert expedie, pas encore recu) vers un magasin
    -- compte : ni en quarantaine, ni hors MRP.
    SELECT lt.code_reference,
           ROUND(SUM(lt.quantite_kg), 4) AS kg
      FROM transfert t
      JOIN ligne_transfert lt ON lt.id_transfert = t.id_transfert
      JOIN magasin md         ON md.code_magasin = t.code_magasin_dest
     WHERE t.statut = 'VALIDE' AND md.inclure_mrp = 1 AND md.est_quarantaine = 0
     GROUP BY lt.code_reference
)
SELECT
    r.code_reference,

    -- Le net se calcule sur les DEUX drapeaux plutot que sur leur concordance :
    -- un magasin declare en quarantaine mais laisse dans le MRP passerait au
    -- travers si l'on se fiait au seul inclure_mrp.
    ROUND(COALESCE(SUM(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0
                            THEN sm.quantite_kg END), 0), 4)          AS stock_utilisable_kg,
    ROUND(COALESCE(SUM(CASE WHEN mg.est_quarantaine = 1
                            THEN sm.quantite_kg END), 0), 4)          AS stock_quarantaine_kg,

    -- Mis de cote = restes + lots bloques (en service : depuis `lot`).
    0.0                                                               AS stock_reserve_kg,

    ROUND(COALESCE(SUM(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0
                            THEN sm.quantite_kg END), 0) - 0.0, 4)    AS stock_physique_net_kg,
    0.0                                                               AS stock_restes_kg,
    0.0                                                               AS stock_bloque_kg,
    -- Le fil sur machine, au dernier constat (en service : `machine_etat`).
    0.0                                                               AS stock_machine_kg,
    ROUND(COALESCE(MAX(er.kg), 0), 4)                                 AS stock_transit_kg
FROM reference r
LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
LEFT JOIN magasin       mg ON mg.code_magasin   = sm.code_magasin
LEFT JOIN en_route      er ON er.code_reference = r.code_reference
WHERE r.actif = 1
GROUP BY r.code_reference;

-- -----------------------------------------------------------------------------
-- v_stock_reference   —   la lecture NEUTRE d'une reference (27/10/2026)
--
-- Une seule source de verite, le moteur de couverture (migration 2026-10-27e).
-- Cette vue remplace v_stock_projete comme socle des vues d'etat, d'analyse et
-- de cockpit, SANS projection ni statut : ce qui se lit sans calcul de besoin —
-- fournisseur et delai, classes, stock (disponible au MRP, total, physique net,
-- quarantaine, mis de cote, machine, transit), consommation retenue et minimum
-- recalcule (un seuil affiche, il n'entre plus dans aucun besoin). Le statut,
-- les jours couverts, la 1re rupture et la quantite a commander viennent du
-- moteur (backend/src/domain/couverture.rs) : la route qui sert l'ecran les
-- ajoute.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_reference CASCADE;
CREATE VIEW v_stock_reference AS
SELECT
    r.code_reference,
    r.designation,
    r.code_fournisseur,
    f.nom                                   AS fournisseur_nom,
    f.pays                                  AS fournisseur_pays,
    COALESCE(f.delai_livraison_jours, CAST(p_delai.v AS bigint)) AS delai_livraison_jours,
    r.classe_abc,
    r.classe_xyz,
    r.unite_catalogue,
    r.cmup_mad,

    sd.stock_mrp_kg,
    sd.stock_total_kg,
    sd.valeur_totale_mad,

    ph.stock_physique_net_kg,
    ph.stock_quarantaine_kg,
    ph.stock_reserve_kg,
    ph.stock_machine_kg,
    ph.stock_transit_kg,

    cr.conso_mensuelle_kg,
    cr.source_conso,
    sm.stock_min_kg
FROM reference r
JOIN      v_stock_disponible    sd ON sd.code_reference   = r.code_reference
JOIN      v_stock_physique      ph ON ph.code_reference   = r.code_reference
JOIN      v_stock_min_dynamique sm ON sm.code_reference   = r.code_reference
LEFT JOIN fournisseur            f ON f.code_fournisseur  = r.code_fournisseur
LEFT JOIN v_conso_retenue       cr ON cr.code_reference   = r.code_reference
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_DelaiDefaut') p_delai
WHERE r.actif = 1;

-- =============================================================================
-- 4. ET 5. L'ANCIEN CALCUL DU BESOIN — RETIRE LE 27/10/2026
-- =============================================================================
-- Une seule source de verite, le moteur de couverture (migration
-- 2026-10-27e_source_unique_moteur.sql). Ces vues etaient definies ici et ne
-- le sont plus — l'ancien calcul ne reste pas en parallele :
--   * v_encours_fiable (en-cours « fiable » selon P_RetardBCJours) ;
--   * v_stock_projete (remplacait I1 : double declencheur RUPTURE / CRITIQUE /
--     ATTENTION / OK, stock projete = physique net + en-cours fiable - besoin) ;
--   * v_plan_achat (remplacait I2 : proposition « minimum - projete », MOQ,
--     multiple, palier) ;
--   * v_cockpit_stock (remplacait I3 : compteurs du cockpit).
-- Le moteur (backend/src/domain/couverture.rs) projette jour par jour ; le
-- plan d'achat genere prend sa 1re proposition (domain/plan_achat.rs) ; les
-- compteurs du cockpit sont calcules par la route. Les vues qui gardaient un
-- statut ou une projection pour l'afficher sont redefinies sans lui, sur
-- v_stock_reference.

-- =============================================================================
-- 6. SUBSTITUTION, FOURNISSEURS, DORMANT, LOTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_substitution_dispo   (remplace I5)
--
-- 27/10/2026 : une seule source de verite, le moteur de couverture (migration
-- 2026-10-27e). La vue ne filtre plus la principale sur RUPTURE / CRITIQUE (le
-- statut de v_stock_projete, retiree) et ne porte plus de stock projete : elle
-- liste les substituts qui ont du stock ; l'etat de la principale vient du
-- moteur, cote serveur.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_substitution_dispo CASCADE;
CREATE VIEW v_substitution_dispo AS
SELECT
    r1.code_reference           AS ref_principale,
    r1.designation              AS designation_principale,
    rge1.code_groupe_equiv,
    ge.libelle                  AS groupe_libelle,
    rge1.priorite               AS priorite_principale,
    r2.code_reference           AS ref_substitut,
    r2.designation              AS designation_substitut,
    r2.code_fournisseur         AS fournisseur_substitut,
    rge2.priorite               AS priorite_substitut,
    rge2.est_preferentielle,
    -- LE STOCK D'UN SUBSTITUT SE LIT NET : sans ses lots Restes ni ses lots
    -- bloques (02/10/2026). Un Reste ne remplace pas un lot de production.
    ph2.stock_physique_net_kg   AS stock_substitut_kg
FROM reference r1
JOIN reference_groupe_equiv rge1 ON rge1.code_reference = r1.code_reference AND rge1.actif = 1
JOIN groupe_equiv           ge   ON ge.code_groupe_equiv = rge1.code_groupe_equiv AND ge.actif = 1
JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                AND rge2.code_reference   <> rge1.code_reference
                                AND rge2.actif = 1
JOIN reference              r2   ON r2.code_reference = rge2.code_reference AND r2.actif = 1
JOIN v_stock_physique       ph2  ON ph2.code_reference = r2.code_reference
WHERE r1.actif = 1
  AND ph2.stock_physique_net_kg > 0
ORDER BY r1.code_reference, rge2.est_preferentielle DESC, rge2.priorite;

-- -----------------------------------------------------------------------------
-- v_fournisseur_scorecard   (remplace I6)
-- CORRECTION : la vue I6 du CDC enchainait deux LEFT JOIN
-- (bon_commande -> reception -> ligne_reception) puis sommait
-- bon_commande.montant_total_mad. Classique fan-out : le montant de chaque BC
-- etait multiplie par son nombre de lignes recues. COUNT(DISTINCT) protegeait
-- nb_bc, rien ne protegeait le SUM.
-- Chaque agregat est ici calcule dans son propre CTE puis joint.
-- L'OTIF (P_CibleOTIF), confie a l'acheteur en D1 mais calcule nulle part, est
-- ajoute.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_fournisseur_scorecard CASCADE;
CREATE VIEW v_fournisseur_scorecard AS
WITH bc_agg AS (
    SELECT code_fournisseur,
           COUNT(*)                                    AS nb_bc,
           ROUND(COALESCE(SUM(montant_total_mad), 0), 2) AS montant_total_mad
    FROM bon_commande
    WHERE statut NOT IN ('BROUILLON','EN_CONTROLE','DEMANDE_PRIX','ANNULE')
    GROUP BY code_fournisseur
),
rec_agg AS (
    SELECT ar.code_fournisseur,
           COUNT(*)                                                          AS nb_lignes_recues,
           ROUND(AVG(CASE WHEN ar.statut_qualite = 'CONFORME' THEN 100.0 ELSE 0.0 END), 2) AS taux_conformite_pct,
           ROUND(AVG(CASE WHEN ar.conformite_delai = 1 THEN 100.0 ELSE 0.0 END), 2)        AS taux_ponctualite_pct,
           ROUND(AVG(abs(COALESCE(ar.ecart_pct, 0))), 2)                     AS ecart_pesee_moyen_pct,
           ROUND(AVG(CASE WHEN ar.statut_qualite = 'CONFORME'
                           AND ar.conformite_delai = 1
                           AND ar.conformite_quantite = 1 THEN 100.0 ELSE 0.0 END), 2)     AS otif_pct,
           ROUND(AVG(COALESCE(ar.jours_retard, 0)), 1)                       AS retard_moyen_jours
    FROM archive_reception ar
    GROUP BY ar.code_fournisseur
),
ref_agg AS (
    SELECT code_fournisseur, COUNT(*) AS nb_references
    FROM reference WHERE actif = 1
    GROUP BY code_fournisseur
)
SELECT
    f.code_fournisseur,
    f.nom,
    f.pays,
    f.code_devise,
    f.delai_livraison_jours,
    f.delai_reel_moyen_jours,
    COALESCE(rf.nb_references, 0)      AS nb_references,
    COALESCE(b.nb_bc, 0)               AS nb_bc,
    COALESCE(b.montant_total_mad, 0)   AS montant_total_mad,
    COALESCE(rc.nb_lignes_recues, 0)   AS nb_lignes_recues,
    rc.taux_conformite_pct,
    rc.taux_ponctualite_pct,
    rc.ecart_pesee_moyen_pct,
    rc.otif_pct,
    rc.retard_moyen_jours,
    f.note_globale,
    CASE
        WHEN COALESCE(f.note_globale, 0) >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_ScoreStrategique') THEN 'STRATEGIQUE'
        WHEN COALESCE(f.note_globale, 0) >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_ScoreStandard')    THEN 'STANDARD'
        WHEN COALESCE(f.note_globale, 0) >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_ScoreSurveiller')  THEN 'A_SURVEILLER'
        ELSE 'CHALLENGER'
    END AS classement
FROM fournisseur f
LEFT JOIN bc_agg  b  ON b.code_fournisseur  = f.code_fournisseur
LEFT JOIN rec_agg rc ON rc.code_fournisseur = f.code_fournisseur
LEFT JOIN ref_agg rf ON rf.code_fournisseur = f.code_fournisseur
WHERE f.actif = 1;

-- -----------------------------------------------------------------------------
-- v_stock_dormant   (remplace I7)
-- CORRECTION : la vue I7 du CDC classait dormante toute reference sans date de
-- derniere sortie — y compris une reference RECUE LA VEILLE. Le repere est
-- desormais la derniere sortie, a defaut la derniere entree.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_dormant CASCADE;
CREATE VIEW v_stock_dormant AS
SELECT
    sm.code_reference,
    r.designation,
    sm.code_magasin,
    mg.nom                          AS magasin_nom,
    sm.quantite_kg,
    sm.cmup_mad,
    sm.valeur_mad,
    sm.date_derniere_sortie,
    sm.date_derniere_entree,
    COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree) AS date_reference_dormance,
    CAST((current_date - (COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree))::date) AS bigint) AS jours_sans_mouvement,
    r.classe_abc
FROM stock_magasin sm
JOIN reference r  ON r.code_reference = sm.code_reference
JOIN magasin  mg  ON mg.code_magasin  = sm.code_magasin
WHERE sm.quantite_kg > 0
  AND COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree) IS NOT NULL
  AND (current_date - (COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree))::date)
      > (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_SeuilDormant')
ORDER BY jours_sans_mouvement DESC;

-- -----------------------------------------------------------------------------
-- v_lot_fefo
-- Proposition d'allocation FEFO (First Expired, First Out).
-- L'allocation elle-meme reste une decision metier assuree par le service Rust :
-- ce n'est pas un invariant de base.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_lot_fefo CASCADE;
CREATE VIEW v_lot_fefo AS
SELECT
    sl.code_reference,
    r.designation,
    sl.code_magasin,
    sl.lot_fournisseur,
    sl.quantite_kg,
    sl.prix_entree_mad,
    sl.date_fabrication,
    sl.date_peremption,
    sl.date_premiere_entree,
    CASE WHEN sl.date_peremption IS NOT NULL
         THEN CAST(((sl.date_peremption)::date - current_date) AS bigint) END AS jours_avant_peremption,
    ROW_NUMBER() OVER (
        PARTITION BY sl.code_reference, sl.code_magasin
        ORDER BY COALESCE(sl.date_peremption, '9999-12-31'), sl.date_premiere_entree
    ) AS rang_fefo
FROM stock_lot sl
JOIN reference r ON r.code_reference = sl.code_reference
WHERE sl.quantite_kg > 0;

-- =============================================================================
-- 7. POSTE DE TRAVAIL ET MUR DE RISQUES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_cockpit_files
-- Les compteurs du poste de travail : ce qui ATTEND QUELQU'UN, ici, maintenant.
--
-- Ils ne se confondent pas avec ceux de l'etat du stock (combien de references
-- en rupture, quelle valeur de stock), que la route du cockpit calcule au moteur
-- de couverture depuis le 27/10/2026 (v_cockpit_stock retiree). Ceux-ci decrivent
-- une FILE : chacun se vide quand quelqu'un fait son travail, et chacun mene a
-- une liste sur laquelle on peut agir. Un compteur qui ne mene nulle part n'a
-- rien a faire sur un ecran d'accueil.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_cockpit_files CASCADE;
CREATE VIEW v_cockpit_files AS
SELECT
    -- Achats
    (SELECT COUNT(*) FROM plan_achat WHERE statut IN ('PROPOSE','EN_REVISION'))
        AS nb_propositions_a_traiter,
    (SELECT COUNT(*) FROM bon_commande WHERE statut = 'BROUILLON')
        AS nb_bc_en_preparation,
    (SELECT COUNT(*) FROM bon_commande WHERE statut = 'EN_ATTENTE_VALIDATION')
        AS nb_bc_a_valider,
    (SELECT ROUND(COALESCE(SUM(montant_total_mad), 0), 2) FROM bon_commande
      WHERE statut = 'EN_ATTENTE_VALIDATION')
        AS montant_bc_a_valider_mad,
    (SELECT COUNT(*) FROM bon_commande WHERE statut = 'VALIDE')
        AS nb_bc_a_envoyer,

    -- Livraisons : le retard se compte sur la promesse, pas sur l'anciennete.
    (SELECT COUNT(*) FROM bon_commande
      WHERE statut IN ('ENVOYE','LIVRE_PARTIEL')
        AND date_livraison_prevue IS NOT NULL
        AND substr(date_livraison_prevue, 1, 10) < to_char(current_date, 'YYYY-MM-DD'))
        AS nb_livraisons_en_retard,
    (SELECT COALESCE(MAX(CAST((current_date - (date_livraison_prevue)::date)
                              AS bigint)), 0)
       FROM bon_commande
      WHERE statut IN ('ENVOYE','LIVRE_PARTIEL')
        AND date_livraison_prevue IS NOT NULL
        AND substr(date_livraison_prevue, 1, 10) < to_char(current_date, 'YYYY-MM-DD'))
        AS retard_max_jours,

    -- Reception et qualite
    (SELECT COUNT(*) FROM reception WHERE statut = 'BROUILLON')
        AS nb_receptions_en_saisie,
    (SELECT COUNT(*) FROM reception WHERE statut = 'A_CONTROLER')
        -- Les receptions d'import attendent le meme controle (08/10/2026).
        + (SELECT COUNT(*) FROM import_receptions WHERE statut = 'A_CONTROLER')
        AS nb_receptions_a_controler,
    (SELECT COUNT(*) FROM ligne_reception lr
       JOIN reception rc ON rc.id_reception = lr.id_reception
      WHERE rc.statut IN ('BROUILLON','A_CONTROLER')
        AND lr.statut_qualite <> 'CONFORME')
        AS nb_lignes_non_conformes,

    -- Une reception dont le bon n'est pas engage ne se validera pas : c'est une
    -- file BLOQUEE, et elle doit se voir avant qu'on la decouvre au controle.
    (SELECT COUNT(DISTINCT rc.id_reception)
       FROM reception rc
       JOIN ligne_reception lr ON lr.id_reception = rc.id_reception
       JOIN ligne_bc lb        ON lb.id_ligne_bc  = lr.id_ligne_bc
       JOIN bon_commande bc    ON bc.id_bc        = lb.id_bc
      WHERE rc.statut IN ('BROUILLON','A_CONTROLER')
        AND bc.statut IN ('BROUILLON','EN_CONTROLE','DEMANDE_PRIX','EN_ATTENTE_VALIDATION','VALIDE'))
        AS nb_receptions_a_regulariser,

    -- Stock. nb_refs_sous_minimum (lu de v_plan_achat) est retire le 27/10/2026 :
    -- une seule source de verite, le moteur de couverture (migration 2026-10-27e).
    (SELECT COUNT(*) FROM v_stock_dormant)
        AS nb_refs_dormantes,
    (SELECT ROUND(COALESCE(SUM(valeur_mad), 0), 2) FROM v_stock_dormant)
        AS valeur_dormante_mad,
    (SELECT COUNT(*) FROM v_lot_fefo
      WHERE jours_avant_peremption IS NOT NULL AND jours_avant_peremption <= 90)
        AS nb_lots_peremption_proche,

    -- Sante du referentiel
    (SELECT COUNT(*) FROM v_controles WHERE criticite = 'BLOQUANT' AND anomalies > 0)
        AS nb_controles_bloquants,
    (SELECT COUNT(*) FROM v_controles WHERE criticite = 'CRITIQUE' AND anomalies > 0)
        AS nb_controles_critiques,
    (SELECT COUNT(*) FROM alerte WHERE statut = 'OUVERTE')
        AS nb_alertes_ouvertes,

    -- Les deux attentes du circuit du bon (migration 2026-10-21d) : en fin de
    -- vue, la ou CREATE OR REPLACE VIEW les a ajoutees.
    (SELECT COUNT(*) FROM bon_commande WHERE statut = 'EN_CONTROLE')
        AS nb_bc_au_controle,
    (SELECT COUNT(*) FROM bon_commande WHERE statut = 'DEMANDE_PRIX')
        AS nb_bc_demande_prix;

-- -----------------------------------------------------------------------------
-- v_risque_mensuel, v_risque_reference — RETIREES LE 27/10/2026
--
-- Le mur de risques projetait mois par mois (stock MRP + entrees attendues -
-- besoin) et triait les references a risque. Une seule source de verite, le
-- moteur de couverture (migration 2026-10-27e) : la projection est celle du
-- moteur, jour par jour, et la route du mur de risques l'appelle.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 8. STATISTIQUES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_stat_mouvement_mois
-- Le flux, mois par mois et par type. Les entrees et les sorties sont comptees
-- SEPAREMENT, jamais nettes : un mois a 50 t entrees et 50 t sorties n'est pas
-- un mois sans activite, et le solde seul le ferait croire.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_mouvement_mois CASCADE;
CREATE VIEW v_stat_mouvement_mois AS
SELECT
    substr(m.date_mouvement, 1, 7)          AS annee_mois,
    m.code_type_mvt,
    tm.libelle                                   AS type_libelle,
    tm.signe,
    tm.couleur,
    COUNT(DISTINCT m.id_mouvement)               AS nb_mouvements,
    COUNT(*)                                     AS nb_lignes,
    COUNT(DISTINCT lm.code_reference)            AS nb_references,
    ROUND(SUM(lm.quantite_kg), 3)                AS quantite_kg,
    -- La valeur n'existe que pour les mouvements valorises : une sortie de
    -- production ne porte pas de prix, et lui en inventer un serait faux.
    ROUND(SUM(COALESCE(lm.total_mad, 0)), 2)     AS valeur_mad
FROM ligne_mouvement lm
JOIN mouvement       m  ON m.id_mouvement  = lm.id_mouvement
JOIN type_mouvement  tm ON tm.code_type_mvt = m.code_type_mvt
-- `tm.libelle`, `tm.signe` et `tm.couleur` dependent tous de
-- `code_type_mvt`, deja groupe. Les citer ne change rien au resultat.
GROUP BY 1, 2, tm.libelle, tm.signe, tm.couleur;

-- -----------------------------------------------------------------------------
-- v_stat_mouvement_reference
-- Ce qui bouge, et ce qui ne bouge pas.
--
-- La rotation est le rapport des sorties au stock moyen. Faute d'historique de
-- stock, on la calcule sur le stock ACTUEL : c'est une approximation, et elle
-- est signalee comme telle plutot que presentee comme un ratio comptable.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_mouvement_reference CASCADE;
CREATE VIEW v_stat_mouvement_reference AS
WITH flux AS (
    SELECT lm.code_reference,
           SUM(CASE WHEN tm.signe = 1  THEN lm.quantite_kg ELSE 0 END) AS entrees_kg,
           SUM(CASE WHEN tm.signe = -1 THEN lm.quantite_kg ELSE 0 END) AS sorties_kg,
           SUM(CASE WHEN tm.signe = 1  THEN COALESCE(lm.total_mad, 0) ELSE 0 END) AS entrees_mad,
           COUNT(*)                                                    AS nb_lignes,
           MIN(m.date_mouvement)                                       AS premier_mouvement,
           MAX(m.date_mouvement)                                       AS dernier_mouvement,
           COUNT(DISTINCT substr(m.date_mouvement, 1, 7))         AS nb_mois_actifs
      FROM ligne_mouvement lm
      JOIN mouvement      m  ON m.id_mouvement   = lm.id_mouvement
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     GROUP BY lm.code_reference
)
SELECT
    r.code_reference,
    r.designation,
    r.classe_abc,
    ROUND(COALESCE(fx.entrees_kg, 0), 3)                 AS entrees_kg,
    ROUND(COALESCE(fx.sorties_kg, 0), 3)                 AS sorties_kg,
    ROUND(COALESCE(fx.entrees_kg, 0) - COALESCE(fx.sorties_kg, 0), 3) AS solde_kg,
    ROUND(COALESCE(fx.entrees_mad, 0), 2)                AS entrees_mad,
    COALESCE(fx.nb_lignes, 0)                            AS nb_lignes,
    COALESCE(fx.nb_mois_actifs, 0)                       AS nb_mois_actifs,
    fx.premier_mouvement,
    fx.dernier_mouvement,
    ROUND(COALESCE(sd.stock_total_kg, 0), 3)             AS stock_actuel_kg,
    CASE WHEN COALESCE(sd.stock_total_kg, 0) > 0 AND COALESCE(fx.sorties_kg, 0) > 0
         THEN ROUND(fx.sorties_kg / sd.stock_total_kg, 2) END AS rotation,
    CASE WHEN fx.dernier_mouvement IS NULL THEN NULL
         ELSE CAST((current_date - (fx.dernier_mouvement)::date) AS bigint)
    END                                                  AS jours_sans_mouvement
FROM reference r
LEFT JOIN flux fx               ON fx.code_reference = r.code_reference
LEFT JOIN v_stock_disponible sd ON sd.code_reference = r.code_reference
WHERE r.actif = 1;

-- -----------------------------------------------------------------------------
-- v_stat_prix_mois
-- Le prix d'achat mois par mois, en moyenne PONDEREE par les quantites.
--
-- Une moyenne simple donnerait le meme poids a une palette d'essai et a un
-- conteneur : le prix affiche ne serait celui de personne.
--
-- Les deux devises sont conservees separement. C'est ce qui permet, en aval, de
-- distinguer une hausse consentie au fournisseur d'une simple derive du change.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_prix_mois CASCADE;
CREATE VIEW v_stat_prix_mois AS
SELECT
    hp.code_reference,
    r.designation,
    substr(hp.date_achat, 1, 7)                     AS annee_mois,
    hp.code_devise,
    COUNT(*)                                             AS nb_achats,
    COUNT(DISTINCT hp.code_fournisseur)                  AS nb_fournisseurs,
    ROUND(SUM(hp.quantite_achetee_kg), 3)                AS quantite_kg,
    ROUND(SUM(hp.total_mad), 2)                          AS montant_mad,
    ROUND(SUM(hp.prix_kg_devise * hp.quantite_achetee_kg)
          / SUM(hp.quantite_achetee_kg), 4)              AS prix_moyen_devise,
    ROUND(SUM(hp.prix_kg_mad * hp.quantite_achetee_kg)
          / SUM(hp.quantite_achetee_kg), 4)              AS prix_moyen_mad,
    ROUND(SUM(hp.taux_change * hp.quantite_achetee_kg)
          / SUM(hp.quantite_achetee_kg), 4)              AS taux_moyen,
    MIN(hp.prix_kg_mad)                                  AS prix_min_mad,
    MAX(hp.prix_kg_mad)                                  AS prix_max_mad
FROM historique_prix hp
JOIN reference r ON r.code_reference = hp.code_reference
-- `r.designation` depend de `code_reference`, deja groupe.
GROUP BY hp.code_reference, r.designation, 3, hp.code_devise;

-- -----------------------------------------------------------------------------
-- v_stat_prix_reference
-- La derive du prix d'achat, DECOMPOSEE.
--
-- Un prix en MAD qui monte de 14 % ne dit pas d'ou vient la hausse. Deux causes
-- sans rapport s'y melangent :
--   * le fournisseur a augmente son tarif  -> negociation, appel d'offres ;
--   * le dirham s'est deprecie             -> couverture de change, rien a
--                                             negocier avec le fournisseur.
-- Les confondre fait reprocher au fournisseur une variation du marche des
-- devises. On les separe donc explicitement.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_prix_reference CASCADE;
CREATE VIEW v_stat_prix_reference AS
WITH bornes AS (
    SELECT code_reference,
           MIN(date_achat) AS premier,
           MAX(date_achat) AS dernier
      FROM historique_prix
     GROUP BY code_reference
),
premier AS (
    SELECT hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad, hp.taux_change,
           hp.code_devise, hp.date_achat
      FROM historique_prix hp
      JOIN bornes b ON b.code_reference = hp.code_reference AND b.premier = hp.date_achat
     GROUP BY hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad,
              hp.taux_change, hp.code_devise, hp.date_achat
),
dernier AS (
    SELECT hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad, hp.taux_change,
           hp.code_devise, hp.date_achat
      FROM historique_prix hp
      JOIN bornes b ON b.code_reference = hp.code_reference AND b.dernier = hp.date_achat
     GROUP BY hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad,
              hp.taux_change, hp.code_devise, hp.date_achat
),
cumul AS (
    SELECT code_reference,
           COUNT(*)                          AS nb_achats,
           COUNT(DISTINCT code_fournisseur)  AS nb_fournisseurs,
           ROUND(SUM(quantite_achetee_kg), 3) AS quantite_totale_kg,
           ROUND(SUM(total_mad), 2)           AS montant_total_mad,
           ROUND(SUM(prix_kg_mad * quantite_achetee_kg) / SUM(quantite_achetee_kg), 4)
                                              AS prix_moyen_mad
      FROM historique_prix
     GROUP BY code_reference
)
SELECT
    c.code_reference,
    r.designation,
    r.classe_abc,
    d.code_devise,
    c.nb_achats,
    c.nb_fournisseurs,
    c.quantite_totale_kg,
    c.montant_total_mad,
    c.prix_moyen_mad,
    p.date_achat                              AS premier_achat,
    d.date_achat                              AS dernier_achat,
    p.prix_kg_mad                             AS premier_prix_mad,
    d.prix_kg_mad                             AS dernier_prix_mad,
    p.prix_kg_devise                          AS premier_prix_devise,
    d.prix_kg_devise                          AS dernier_prix_devise,
    p.taux_change                             AS premier_taux,
    d.taux_change                             AS dernier_taux,
    -- Variation totale constatee en MAD.
    CASE WHEN p.prix_kg_mad > 0
         THEN ROUND((d.prix_kg_mad - p.prix_kg_mad) / p.prix_kg_mad * 100.0, 2) END
                                              AS derive_totale_pct,
    -- Part imputable au FOURNISSEUR : sa variation de tarif, en devise d'origine.
    CASE WHEN p.prix_kg_devise > 0
         THEN ROUND((d.prix_kg_devise - p.prix_kg_devise) / p.prix_kg_devise * 100.0, 2) END
                                              AS derive_fournisseur_pct,
    -- Part imputable au CHANGE : rien a negocier avec le fournisseur.
    CASE WHEN p.taux_change > 0
         THEN ROUND((d.taux_change - p.taux_change) / p.taux_change * 100.0, 2) END
                                              AS derive_change_pct,
    -- Effet en dirhams de la seule derive fournisseur, sur les volumes achetes :
    -- c'est le montant qu'une renegociation pourrait viser.
    CASE WHEN p.prix_kg_devise > 0
         THEN ROUND((d.prix_kg_devise - p.prix_kg_devise) * d.taux_change
                    * c.quantite_totale_kg, 2) END
                                              AS impact_fournisseur_mad
FROM cumul c
JOIN reference r ON r.code_reference = c.code_reference
JOIN premier  p  ON p.code_reference = c.code_reference
JOIN dernier  d  ON d.code_reference = c.code_reference;

-- -----------------------------------------------------------------------------
-- v_stat_fournisseur_mois
-- L'activite d'achat par fournisseur et par mois : volume, montant, ponctualite.
-- Complete v_fournisseur_scorecard, qui donne le cumul mais pas la TENDANCE.
-- Un fournisseur a 92 % d'OTIF qui se degrade depuis trois mois n'appelle pas
-- la meme decision qu'un fournisseur a 92 % qui remonte.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_fournisseur_mois CASCADE;
CREATE VIEW v_stat_fournisseur_mois AS
SELECT
    rc.code_fournisseur,
    f.nom                                        AS fournisseur_nom,
    substr(rc.date_reception, 1, 7)         AS annee_mois,
    COUNT(DISTINCT rc.id_reception)              AS nb_receptions,
    COUNT(lr.id_ligne_reception)                 AS nb_lignes,
    ROUND(SUM(lr.quantite_stock_kg), 3)          AS quantite_kg,
    ROUND(SUM(lr.quantite_stock_kg * lr.prix_kg_mad), 2) AS montant_mad,
    ROUND(100.0 * SUM(CASE WHEN lr.statut_qualite = 'CONFORME' THEN 1 ELSE 0 END)
          / COUNT(lr.id_ligne_reception), 1)     AS taux_conformite_pct,
    -- Ponctualite mesuree sur les receptions rattachables a une promesse ; les
    -- autres sont exclues du ratio plutot que comptees comme ponctuelles.
    SUM(CASE WHEN bc.date_livraison_prevue IS NOT NULL
                  AND substr(rc.date_reception, 1, 10) <= substr(bc.date_livraison_prevue, 1, 10)
             THEN 1 ELSE 0 END)                  AS nb_a_lheure,
    SUM(CASE WHEN bc.date_livraison_prevue IS NOT NULL THEN 1 ELSE 0 END) AS nb_mesurables,
    ROUND(AVG(CASE WHEN bc.date_livraison_prevue IS NOT NULL
                   THEN ((rc.date_reception)::date - (bc.date_livraison_prevue)::date) END), 1) AS retard_moyen_jours
FROM reception rc
JOIN fournisseur f       ON f.code_fournisseur = rc.code_fournisseur
JOIN ligne_reception lr  ON lr.id_reception    = rc.id_reception
LEFT JOIN ligne_bc lb    ON lb.id_ligne_bc     = lr.id_ligne_bc
LEFT JOIN bon_commande bc ON bc.id_bc          = lb.id_bc
WHERE rc.statut IN ('VALIDE','CLOTURE')
-- `f.nom` depend de `code_fournisseur`, deja groupe.
GROUP BY rc.code_fournisseur, f.nom, 3;

-- -----------------------------------------------------------------------------
-- v_stat_qualite
-- Ce que coute et ce que produit chaque qualite.
--
-- Le cout matiere au m2 est la somme, sur la recette, de (kg/m2 x CMUP). Il ne
-- vaut que ce que valent les CMUP : une reference jamais entree en stock n'en a
-- pas, et sa part manque au total. Le nombre de matieres SANS CMUP est donc
-- publie a cote du cout — un cout qui ignore en silence trois composants sur
-- douze est plus dangereux qu'une absence de cout.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_qualite CASCADE;
-- CORRIGE LE 17/09/2026 (2026-09-17i) : chaque composant au CMUP de la fiche.
-- La valeur du stock en magasin rendait gratuit tout composant sans stock :
-- Shehrazade a 10,24 MAD/m2 pour 83,62 reels.
CREATE VIEW v_stat_qualite AS
WITH cout AS (
    SELECT rc.code_qualite,
           COUNT(*)                                         AS nb_composants,
           COUNT(DISTINCT rc.code_role)                     AS nb_roles,
           SUM(CASE WHEN r.cmup_mad IS NULL THEN 1 ELSE 0 END)
                                                            AS nb_sans_cmup,
           ROUND(SUM(rc.kg_m2), 6)                          AS kg_m2_total,
           ROUND(SUM(rc.kg_m2 * COALESCE(r.cmup_mad, 0)), 4) AS cout_matiere_m2_mad
      FROM v_recette_calculee rc
      JOIN reference r ON r.code_reference = rc.code_reference
     GROUP BY rc.code_qualite
),
production AS (
    SELECT lpp.code_qualite,
           ROUND(SUM(lpp.m2_prevus), 0)                     AS m2_prevus,
           ROUND(SUM(COALESCE(lpp.m2_realises, 0)), 0)      AS m2_realises,
           COUNT(*)                                         AS nb_mois_planifies
      FROM ligne_plan_production lpp
      JOIN plan_production pp ON pp.id_plan = lpp.id_plan
     WHERE pp.statut = 'EN_COURS'
     GROUP BY lpp.code_qualite
)
SELECT
    q.code_qualite,
    q.nom                                        AS qualite_nom,
    q.statut,
    q.poids_commercial_m2,
    q.taux_perte_pct,
    COALESCE(c.nb_composants, 0)                 AS nb_composants,
    COALESCE(c.nb_roles, 0)                      AS nb_roles,
    COALESCE(c.nb_sans_cmup, 0)                  AS nb_sans_cmup,
    c.kg_m2_total,
    c.cout_matiere_m2_mad,
    CASE WHEN q.poids_commercial_m2 > 0 AND c.kg_m2_total IS NOT NULL
         THEN ROUND((c.kg_m2_total - q.poids_commercial_m2) / q.poids_commercial_m2 * 100.0, 2)
    END                                          AS ecart_poids_pct,
    COALESCE(p.m2_prevus, 0)                     AS m2_prevus,
    COALESCE(p.m2_realises, 0)                   AS m2_realises,
    COALESCE(p.nb_mois_planifies, 0)             AS nb_mois_planifies,
    CASE WHEN COALESCE(p.m2_prevus, 0) > 0
         THEN ROUND(100.0 * COALESCE(p.m2_realises, 0) / p.m2_prevus, 1) END
                                                 AS taux_realisation_pct,
    CASE WHEN c.cout_matiere_m2_mad IS NOT NULL AND COALESCE(p.m2_prevus, 0) > 0
         THEN ROUND(c.cout_matiere_m2_mad * p.m2_prevus, 2) END
                                                 AS cout_matiere_plan_mad
FROM qualite q
LEFT JOIN cout       c ON c.code_qualite = q.code_qualite
LEFT JOIN production p ON p.code_qualite = q.code_qualite;

-- -----------------------------------------------------------------------------
-- v_stat_qualite_role
-- La ventilation du cout d'une qualite PAR ROLE (trame, chaine, latex...).
-- C'est le niveau ou une decision se prend : on ne change pas « la recette »,
-- on change le melange d'un role.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_qualite_role CASCADE;
-- Meme correction (2026-09-17i).
CREATE VIEW v_stat_qualite_role AS
SELECT
    rc.code_qualite,
    rc.code_role,
    rc.role_libelle,
    COUNT(*)                                     AS nb_composants,
    ROUND(SUM(rc.pourcentage_composition), 2)    AS somme_pct,
    ROUND(SUM(rc.kg_m2), 6)                      AS kg_m2,
    ROUND(SUM(rc.kg_m2 * COALESCE(r.cmup_mad, 0)), 4) AS cout_m2_mad
FROM v_recette_calculee rc
JOIN reference r ON r.code_reference = rc.code_reference
GROUP BY rc.code_qualite, rc.code_role, rc.role_libelle;

-- =============================================================================
-- 9. EQUIVALENCES DE REFERENCES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_equivalence
-- « Quels equivalents pour cette reference ? » — sans condition.
--
-- v_substitution_dispo repond a une autre question : « quel substitut a du
-- stock tout de suite ». Elle filtre donc sur le stock du substitut. Au moment
-- de commander, de receptionner ou de sortir de la matiere, on a besoin de
-- connaitre les equivalents AVANT que la situation ne se degrade.
--
-- Cette vue-ci ne filtre rien d'autre que l'activite des rattachements. Les
-- deux cotes portent leur stock et leur besoin : c'est a l'ecran de decider ce
-- qu'il met en avant.
--
-- 27/10/2026 : une seule source de verite, le moteur de couverture (migration
-- 2026-10-27e). Les colonnes stock_projete_kg, statut, equivalent_stock_projete_kg
-- et equivalent_statut (lues de v_stock_projete, retiree) sont retirees ; l'etat
-- de chaque cote vient du moteur, cote serveur.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_equivalence CASCADE;
CREATE VIEW v_equivalence AS
SELECT
    rge1.code_groupe_equiv,
    ge.libelle                          AS groupe_libelle,

    r1.code_reference,
    r1.designation,
    r1.code_fournisseur,
    f1.nom                              AS fournisseur_nom,
    rge1.priorite,
    rge1.est_preferentielle,
    r1.unite_catalogue,
    COALESCE(sd1.stock_mrp_kg, 0)       AS stock_kg,
    COALESCE(b1.besoin_12m_kg, 0)       AS besoin_12m_kg,

    r2.code_reference                   AS equivalent_reference,
    r2.designation                      AS equivalent_designation,
    r2.code_fournisseur                 AS equivalent_fournisseur,
    f2.nom                              AS equivalent_fournisseur_nom,
    COALESCE(f2.delai_livraison_jours,
             (SELECT CAST(valeur_courante AS bigint) FROM parametre
               WHERE code_parametre = 'P_DelaiDefaut')) AS equivalent_delai_jours,
    rge2.priorite                       AS equivalent_priorite,
    rge2.est_preferentielle             AS equivalent_preferentielle,
    r2.unite_catalogue                  AS equivalent_unite,
    r2.prix_catalogue_kg                AS equivalent_prix_catalogue_kg,
    r2.code_devise_catalogue            AS equivalent_devise,
    COALESCE(sd2.stock_mrp_kg, 0)       AS equivalent_stock_kg,
    COALESCE(b2.besoin_12m_kg, 0)       AS equivalent_besoin_12m_kg,

    -- Deux references du meme groupe chez le MEME fournisseur ne sont pas une
    -- securite d'approvisionnement : elles tombent ensemble. La distinction
    -- doit se voir, sinon le mono-source se cache derriere un groupe de deux.
    CASE WHEN r1.code_fournisseur = r2.code_fournisseur THEN 1 ELSE 0 END
                                        AS meme_fournisseur,
    -- Substituer suppose la meme unite canonique et la meme densite : sinon le
    -- kg/m2 de la recette ne tient plus. Publie plutot que suppose.
    CASE WHEN r1.unite_catalogue = r2.unite_catalogue
          AND COALESCE(r1.densite_kg_ml, -1) = COALESCE(r2.densite_kg_ml, -1)
          AND r1.code_categorie = r2.code_categorie
         THEN 1 ELSE 0 END              AS interchangeable

FROM reference_groupe_equiv rge1
JOIN groupe_equiv           ge   ON ge.code_groupe_equiv  = rge1.code_groupe_equiv
                                AND ge.actif = 1
JOIN reference              r1   ON r1.code_reference     = rge1.code_reference
JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                AND rge2.code_reference   <> rge1.code_reference
                                AND rge2.actif = 1
JOIN reference              r2   ON r2.code_reference     = rge2.code_reference
LEFT JOIN fournisseur       f1   ON f1.code_fournisseur   = r1.code_fournisseur
LEFT JOIN fournisseur       f2   ON f2.code_fournisseur   = r2.code_fournisseur
LEFT JOIN v_stock_disponible sd1 ON sd1.code_reference    = r1.code_reference
LEFT JOIN v_stock_disponible sd2 ON sd2.code_reference    = r2.code_reference
LEFT JOIN v_besoin_12m       b1  ON b1.code_reference     = r1.code_reference
LEFT JOIN v_besoin_12m       b2  ON b2.code_reference     = r2.code_reference
WHERE rge1.actif = 1
  AND r1.actif = 1
  AND r2.actif = 1;

-- -----------------------------------------------------------------------------
-- v_groupe_equiv_detail
-- Une ligne par groupe : de quoi administrer, et de quoi controler.
--
-- Un groupe n'a d'interet que s'il offre une VRAIE alternative. Trois choses le
-- disqualifient, et elles sont comptees ici plutot que devinees : une seule
-- reference, des references heterogenes (substituer casserait le kg/m2), ou
-- toutes chez le meme fournisseur (elles tombent ensemble).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_groupe_equiv_detail CASCADE;
CREATE VIEW v_groupe_equiv_detail AS
SELECT
    g.code_groupe_equiv,
    g.libelle,
    g.description,
    g.actif,
    COUNT(rge.code_reference)                                   AS nb_references,
    COUNT(DISTINCT r.code_fournisseur)                          AS nb_fournisseurs,
    COUNT(DISTINCT r.unite_catalogue)                           AS nb_unites,
    COUNT(DISTINCT COALESCE(r.densite_kg_ml, -1))               AS nb_densites,
    COUNT(DISTINCT r.code_categorie)                            AS nb_categories,
    SUM(rge.est_preferentielle)                                 AS nb_preferentielles,
    SUM(CASE WHEN COALESCE(sd.stock_mrp_kg, 0) > 0 THEN 1 ELSE 0 END) AS nb_avec_stock,
    SUM(CASE WHEN COALESCE(b.besoin_12m_kg, 0) > 0 THEN 1 ELSE 0 END) AS nb_avec_besoin,
    ROUND(SUM(COALESCE(sd.stock_mrp_kg, 0)), 3)                 AS stock_cumule_kg,
    ROUND(SUM(COALESCE(b.besoin_12m_kg, 0)), 3)                 AS besoin_cumule_kg,
    -- Le groupe protege-t-il reellement d'une rupture d'approvisionnement ?
    CASE WHEN COUNT(rge.code_reference) < 2            THEN 'MONO-REFERENCE'
         WHEN COUNT(DISTINCT r.unite_catalogue) > 1
           OR COUNT(DISTINCT COALESCE(r.densite_kg_ml, -1)) > 1
           OR COUNT(DISTINCT r.code_categorie) > 1     THEN 'HETEROGENE'
         WHEN COUNT(DISTINCT r.code_fournisseur) < 2   THEN 'MEME FOURNISSEUR'
         ELSE 'ALTERNATIF' END                                  AS qualification
FROM groupe_equiv g
LEFT JOIN reference_groupe_equiv rge ON rge.code_groupe_equiv = g.code_groupe_equiv
                                    AND rge.actif = 1
LEFT JOIN reference              r   ON r.code_reference      = rge.code_reference
                                    AND r.actif = 1
LEFT JOIN v_stock_disponible     sd  ON sd.code_reference     = rge.code_reference
LEFT JOIN v_besoin_12m           b   ON b.code_reference      = rge.code_reference
GROUP BY g.code_groupe_equiv;

-- -----------------------------------------------------------------------------
-- v_stock_transit
-- Ce qui est parti d'un magasin sans etre encore arrive dans l'autre.
--
-- C'est un etat REEL, parfois de plusieurs jours, et il n'apparaissait nulle
-- part : la marchandise sortait du stock source et surgissait a destination au
-- meme instant. Desormais elle disparait des deux tant que personne n'a
-- constate l'arrivee — et cette vue est ce qui l'empeche d'etre perdue de vue.
--
-- Elle ne compte PAS dans le stock disponible : la matiere n'est ni dans un
-- magasin ni utilisable. L'y inclure ferait planifier une production sur ce qui
-- est encore dans le camion.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_transit CASCADE;
CREATE VIEW v_stock_transit AS
SELECT
    t.id_transfert,
    t.numero_transfert,
    t.date_transfert,
    t.code_magasin_source,
    ms.nom                                  AS magasin_source_nom,
    t.code_magasin_dest,
    md.nom                                  AS magasin_dest_nom,
    u.login                                 AS expediteur,
    lt.code_reference,
    r.designation,
    lt.lot_fournisseur,
    ROUND(lt.quantite_kg, 4)                AS quantite_kg,
    lt.prix_kg_mad,
    ROUND(lt.quantite_kg * COALESCE(lt.prix_kg_mad, 0), 2) AS valeur_mad,
    -- Depuis combien de jours la marchandise est-elle en route ? Au-dela de
    -- quelques jours pour un transfert interne, c'est qu'on a oublie de
    -- constater l'arrivee — ou que la marchandise s'est perdue.
    CAST((current_date - (t.date_transfert)::date) AS bigint) AS jours_en_transit
FROM transfert t
JOIN ligne_transfert lt ON lt.id_transfert = t.id_transfert
JOIN reference r        ON r.code_reference = lt.code_reference
LEFT JOIN magasin ms    ON ms.code_magasin = t.code_magasin_source
LEFT JOIN magasin md    ON md.code_magasin = t.code_magasin_dest
LEFT JOIN utilisateur u ON u.id_utilisateur = t.id_utilisateur
WHERE t.statut = 'VALIDE';


-- -----------------------------------------------------------------------------
-- v_equivalence_auto — l'equivalence qui se DEDUIT
-- -----------------------------------------------------------------------------
-- Deux references de meme famille et de meme couleur interne, chez deux
-- fournisseurs differents, sont le meme fil. Cette vue les rapproche sans
-- qu'on ait rien a declarer, et dit si un groupe d'equivalence les couvre deja.
-- Elle ne remplace pas les groupes : elle montre ce que la donnee dit.
-- -----------------------------------------------------------------------------
CREATE VIEW v_equivalence_auto AS
SELECT a.code_reference                AS code_reference,
       b.code_reference                AS code_equivalent,
       a.code_famille,
       f.libelle                       AS famille_libelle,
       a.code_couleur_interne,
       c.libelle                       AS couleur_libelle,
       a.code_fournisseur              AS fournisseur,
       b.code_fournisseur              AS fournisseur_equivalent,
       a.reference_fournisseur         AS reference_chez_fournisseur,
       b.reference_fournisseur         AS reference_chez_equivalent,
       (SELECT count(*) FROM reference_groupe_equiv g1
          JOIN reference_groupe_equiv g2 ON g2.code_groupe_equiv = g1.code_groupe_equiv
         WHERE g1.code_reference = a.code_reference
           AND g2.code_reference = b.code_reference
           AND g1.actif = 1 AND g2.actif = 1) AS deja_groupees
  FROM reference a
  JOIN reference b ON b.code_famille = a.code_famille
                  AND b.code_couleur_interne = a.code_couleur_interne
                  AND b.code_reference <> a.code_reference
  LEFT JOIN famille f ON f.code_famille = a.code_famille
  LEFT JOIN couleur c ON c.code_couleur_interne = a.code_couleur_interne
 WHERE a.actif = 1 AND b.actif = 1
   AND a.code_famille IS NOT NULL AND a.code_couleur_interne IS NOT NULL
   AND a.code_fournisseur <> b.code_fournisseur;
