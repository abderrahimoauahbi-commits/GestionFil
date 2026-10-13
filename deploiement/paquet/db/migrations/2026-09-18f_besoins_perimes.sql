-- =============================================================================
-- MIGRATION 2026-09-18f — DES BESOINS PERIMES DOIVENT SE VOIR
-- -----------------------------------------------------------------------------
-- CONSTAT DU 18/09/2026. On double la densite du poil de Shehrazade : le cout au
-- m2 suit (60,69 -> 102,46 MAD), mais les besoins du MRP restent a 580 197 kg au
-- lieu de 607 574, le plan d'achat garde ses 41,8 M MAD — et RIEN ne le signale.
-- Le controle C29 restait a zero et la ligne de fraicheur du cockpit aussi : ils
-- ne comparaient que la date du PLAN a celle du calcul. Une recette modifiee, une
-- densite corrigee, une reference retiree d'une composition ne les reveillaient
-- pas.
--
-- L'ERREUR VA TOUJOURS DANS LE SENS RASSURANT : des besoins sous-estimes donnent
-- une projection haute, donc des alertes vertes, donc des achats qu'on ne passe
-- pas.
--
-- LA MESURE EST DESORMAIS DIRECTE : ce qui est enregistre est-il encore ce que
-- les recettes d'aujourd'hui produiraient ? On compare les besoins figes a la
-- vue de calcul, en kilos et en nombre de lignes. Aucune date a tenir a jour,
-- aucune cause a prevoir — un ecart est un ecart.
--
-- Rejouable : CREATE OR REPLACE / DROP VIEW IF EXISTS.
-- =============================================================================

BEGIN;

-- La question, une fois pour toutes : ce plan a-t-il des besoins a jour ?
CREATE OR REPLACE FUNCTION fn_besoins_perimes(p_plan text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT NOT EXISTS (SELECT 1 FROM besoin_mrp b WHERE b.id_plan = p_plan)
        OR (SELECT COALESCE(pp.date_modification, pp.date_creation)
              FROM plan_production pp WHERE pp.id_plan = p_plan)
           > (SELECT MAX(date_calcul) FROM besoin_mrp b WHERE b.id_plan = p_plan)
        -- Le fond du controle : les kilos enregistres et ceux que les recettes
        -- donneraient maintenant. La tolerance est celle de l'arrondi au gramme.
        OR EXISTS (
            SELECT 1 FROM (
                SELECT code_reference, annee_mois, SUM(quantite_kg) AS kg
                  FROM besoin_mrp WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois
                EXCEPT
                SELECT code_reference, annee_mois, SUM(quantite_kg)
                  FROM v_besoin_mrp_calcule WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois) x)
        OR EXISTS (
            SELECT 1 FROM (
                SELECT code_reference, annee_mois, SUM(quantite_kg) AS kg
                  FROM v_besoin_mrp_calcule WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois
                EXCEPT
                SELECT code_reference, annee_mois, SUM(quantite_kg)
                  FROM besoin_mrp WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois) y)
$$;

-- CREATE OR REPLACE, et non DROP CASCADE : `v_controles` cite cette vue, et la
-- faire tomber emporterait aussi `v_cockpit_files`. Les colonnes ne font que
-- s'ajouter a la fin, ce que PostgreSQL accepte.
CREATE OR REPLACE VIEW v_ctl_c29 AS
SELECT pp.id_plan, pp.libelle, pp.statut,
       pp.date_modification,
       (SELECT MAX(date_calcul) FROM besoin_mrp b WHERE b.id_plan = pp.id_plan) AS dernier_calcul,
       (SELECT ROUND(COALESCE(SUM(quantite_kg), 0), 2) FROM besoin_mrp b
         WHERE b.id_plan = pp.id_plan)                                          AS besoins_enregistres_kg,
       (SELECT ROUND(COALESCE(SUM(quantite_kg), 0), 2) FROM v_besoin_mrp_calcule c
         WHERE c.id_plan = pp.id_plan)                                          AS besoins_recalcules_kg
FROM plan_production pp
WHERE pp.statut = 'EN_COURS'
  AND fn_besoins_perimes(pp.id_plan);

-- Le cockpit compte la meme chose, par la meme fonction : deux ecritures de la
-- meme regle finissent toujours par diverger.
CREATE OR REPLACE VIEW v_cockpit_stock AS
WITH s AS (SELECT statut, classe_abc FROM v_stock_projete),
     p AS (SELECT montant_estime_mad, classe_abc, tier FROM v_plan_achat)
SELECT
    (SELECT COUNT(*) FROM s WHERE statut = 'RUPTURE')                        AS nb_ruptures,
    (SELECT COUNT(*) FROM s WHERE statut = 'CRITIQUE')                       AS nb_critiques,

    (SELECT COUNT(*) FROM s WHERE statut = 'ATTENTION')                      AS nb_attention,
    -- Le sur-stock est un SECOND AXE : il ne dit pas qu'on va manquer, il dit
    -- qu'on immobilise. Il se compte a part, jamais dans l'echelle d'alerte.
    (SELECT COUNT(*) FROM v_stock_projete WHERE sur_stock = 1)               AS nb_sur_stock,
    (SELECT COUNT(*) FROM v_stock_projete WHERE ecart_majeur = 1)            AS nb_ecart_majeur,
    -- FRAICHEUR. Le stock est vivant, les besoins sont figes au dernier calcul
    -- MRP : sans cette date a cote des compteurs, un tableau tout vert peut
    -- n'etre que le reflet d'un calcul qu'on n'a pas relance depuis que le plan
    -- a change. L'erreur va toujours dans le sens rassurant.
    (SELECT MAX(date_calcul) FROM besoin_mrp)                                AS besoins_calcules_le,
    -- LA MEME REGLE QUE C29, PAR LA MEME FONCTION. Elle etait RECOPIEE ici, et
    -- les deux copies avaient diverge : celle-ci ignorait les recettes et les
    -- densites modifiees depuis le calcul. La fonction naissant dans une
    -- migration, elle existe avant cette vue — ce qui n'etait pas possible quand
    -- les controles se chargeaient apres les vues.
    (SELECT COUNT(*) FROM plan_production pp
      WHERE pp.statut = 'EN_COURS' AND fn_besoins_perimes(pp.id_plan))
                                                                             AS besoins_perimes,
    (SELECT COUNT(*) FROM s WHERE statut = 'OK')                             AS nb_ok,
    (SELECT COUNT(*) FROM s)                                                 AS nb_references,
    (SELECT ROUND(COALESCE(SUM(valeur_mad), 0), 2) FROM stock_magasin)       AS valeur_stock_mad,
    (SELECT COUNT(*) FROM p)                                                 AS nb_refs_a_commander,
    (SELECT ROUND(COALESCE(SUM(montant_estime_mad), 0), 2) FROM p)           AS budget_a_engager_mad,
    (SELECT COUNT(*) FROM p WHERE classe_abc = 'A')                          AS nb_classe_a_alerte,
    (SELECT COUNT(*) FROM p WHERE tier = 'TIER 1')                           AS nb_tier1,
    (SELECT COUNT(*) FROM fournisseur WHERE actif = 1)                       AS nb_fournisseurs_actifs,
    (SELECT COUNT(*) FROM bon_commande WHERE statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')) AS nb_bc_ouverts,
    (SELECT ROUND(COALESCE(SUM(montant_total_mad), 0), 2) FROM bon_commande
      WHERE statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL'))                   AS montant_bc_ouverts_mad,
    (SELECT COUNT(*) FROM alerte WHERE statut = 'OUVERTE' AND gravite IN ('CRITIQUE','BLOQUANT')) AS nb_alertes_critiques;
COMMIT;
