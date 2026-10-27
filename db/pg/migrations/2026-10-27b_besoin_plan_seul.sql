-- =============================================================================
-- 2026-10-27b — L'OF sort du besoin MRP : le besoin est le PLAN SEUL
-- =============================================================================
-- docs/A-DECIDER-of-supply-chain.md, « 27/10 : l'OF sort du besoin MRP ».
--
-- LA DÉCISION (direction, 26/10/2026). Deux axes séparés :
--   * AXE 1, projection et approvisionnement : la demande est le PLAN DE
--     PRODUCTION SEUL (la photo `besoin_mrp` du plan en service). Les OF sont du
--     très court terme (journaliers, au plus une semaine) quand les délais d'achat
--     se comptent en semaines ou en mois : à l'horizon d'achat, seul le plan
--     existe. Un OF n'est ni un remplacement du plan ni un « au-delà du plan ».
--   * AXE 2, production et statistiques : PLAN → OF → machine → qualité →
--     mouvements → consommation réelle. Ses objets restent INTACTS : v_of_mois,
--     v_besoin_of_qualite, v_besoin_of, v_of_consommation, v_of_bilan,
--     v_qualite_consommation, et le contrôle C64 (« OF au-delà du plan »), un
--     simple signal que la direction garde.
--
-- CE QUE FAIT LA MIGRATION (ce qu'avait ajouté 2026-10-22c au besoin, retiré) :
--   1. v_besoin_of_mois : vide (mêmes colonnes) — l'ajustement des OF n'existe
--      plus ; fn_besoin_of_mois(), qui le calculait, est supprimée ;
--   2. v_besoin_mois : le plan seul, origine PLAN, dont_of_kg = 0 ;
--   3. v_besoin_12m : le plan seul ; besoin_plan_12m_kg = besoin_12m_kg,
--      besoin_au_dela_12m_kg = 0 (colonnes gardées : v_stock_projete les lit) ;
--   4. v_besoin_horizon : la définition du plan seul de 2026-10-09k (saisonnalité
--      au-delà de la fin du plan), mêmes colonnes ;
--   5. v_besoin_horizon_of : vide (mêmes colonnes) ;
--   6. LE FIL SUR MACHINE COMPTE AU DERNIER CONSTAT, QUEL QUE SOIT SON ÂGE
--      (décision du 26/10/2026) : v_stock_physique ne l'exclut plus après
--      P_JoursInventMachine jours. Le paramètre reste : il ne sert plus que le
--      signal C36 (étage non constaté depuis trop longtemps), jamais le calcul.
--
-- AUCUNE COLONNE NE CHANGE : v_stock_projete, v_plan_achat, v_conso_retenue,
-- v_ctl_c49, v_equivalence… se recalculent d'eux-mêmes sur le plan seul.
-- Rejouable (après 2026-10-22c rejouée, elle remet le plan seul). Enregistrée par
-- migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- 1. Plus d'ajustement des OF
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_besoin_of_mois AS
SELECT NULL::text    AS code_reference,
       NULL::text    AS annee_mois,
       0::numeric    AS kg_plan_couvert,
       0::numeric    AS kg_of_plan,
       0::numeric    AS kg_of_au_dela,
       0::numeric    AS kg_ajustement
 WHERE false;
ALTER VIEW v_besoin_of_mois OWNER TO gestionfil;

DROP FUNCTION IF EXISTS fn_besoin_of_mois();

-- -----------------------------------------------------------------------------
-- 2. Le besoin par référence et mois : le plan seul
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_besoin_mois AS
SELECT bm.code_reference,
       bm.annee_mois,
       'PLAN'::text                    AS origine,
       round(sum(bm.quantite_kg), 4)   AS quantite_kg,
       0::numeric                      AS dont_of_kg
  FROM besoin_mrp bm
  JOIN plan_production pp ON pp.id_plan = bm.id_plan
 WHERE pp.statut = 'EN_COURS'
   AND bm.annee_mois >= to_char(CURRENT_DATE, 'YYYY-MM')
 GROUP BY bm.code_reference, bm.annee_mois;
ALTER VIEW v_besoin_mois OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 3. v_besoin_12m : le plan seul, les colonnes de 22c gardées
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_besoin_12m AS
WITH horizon AS (
    SELECT besoin_mrp.id_plan, count(DISTINCT besoin_mrp.annee_mois) AS mois
      FROM besoin_mrp
     WHERE besoin_mrp.annee_mois >= to_char(CURRENT_DATE::timestamp with time zone, 'YYYY-MM')
     GROUP BY besoin_mrp.id_plan
),
plan AS (
    SELECT bm.code_reference, sum(bm.quantite_kg) AS kg,
           CASE WHEN min(h.mois) > 0 THEN min(h.mois) ELSE 1::bigint END AS nb_mois
      FROM besoin_mrp bm
      JOIN plan_production pp ON pp.id_plan = bm.id_plan
      JOIN horizon h ON h.id_plan = bm.id_plan
     WHERE pp.statut = 'EN_COURS'
       AND to_char(CURRENT_DATE::timestamp with time zone, 'YYYY-MM-DD') >= pp.date_debut::text
       AND to_char(CURRENT_DATE::timestamp with time zone, 'YYYY-MM-DD') <= pp.date_fin::text
       AND bm.annee_mois >= to_char(CURRENT_DATE::timestamp with time zone, 'YYYY-MM')
     GROUP BY bm.code_reference
)
SELECT p.code_reference,
       round(p.kg, 4)                              AS besoin_12m_kg,
       round(p.kg / p.nb_mois::numeric, 4)         AS besoin_mensuel_moyen_kg,
       -- Le besoin EST le plan : la part « liée au plan » vaut le tout, la part
       -- « au-delà du plan » vaut zéro (colonnes de 2026-10-22c, gardées).
       round(p.kg, 4)                              AS besoin_plan_12m_kg,
       0::numeric                                  AS besoin_au_dela_12m_kg
  FROM plan p;
ALTER VIEW v_besoin_12m OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 4. v_besoin_horizon : celle du plan seul (2026-10-09k), mêmes colonnes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_besoin_horizon AS
 WITH p AS (
         SELECT ( SELECT parametre.valeur_courante::numeric AS valeur_courante
                   FROM parametre
                  WHERE parametre.code_parametre = 'P_DelaiDefaut'::text) AS delai_defaut,
            ( SELECT parametre.valeur_courante::numeric AS valeur_courante
                   FROM parametre
                  WHERE parametre.code_parametre = 'P_MargeJours'::text) AS marge_jours,
            ((date_trunc('month', CURRENT_DATE) + interval '1 month')::date - CURRENT_DATE)::numeric
              / extract(day FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::numeric
              AS reste_mois,
            COALESCE((SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_HorizonProlonge'), '1') = '1'
              AS prolonger
        ), mois AS (
         SELECT i.i,
            to_char(date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) + (((i.i - 1) || ' month'::text)::interval), 'YYYY-MM'::text) AS annee_mois,
            CASE WHEN i.i = 1 THEN 0::numeric ELSE 30.0 * p.reste_mois + (i.i - 2)::numeric * 30.0 END AS debut_j,
            30.0 * p.reste_mois + (i.i - 1)::numeric * 30.0 AS fin_j
           FROM generate_series(1, 12) i(i)
             CROSS JOIN p
        ), fenetre AS (
         SELECT r.code_reference,
            COALESCE(f.delai_livraison_jours::numeric, p.delai_defaut) AS lead_j,
            COALESCE(f.couverture_commande_j::numeric, p.marge_jours) AS couv_j
           FROM reference r
             LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
             CROSS JOIN p
        ), besoin_plan AS (
         SELECT bm.code_reference, bm.annee_mois, bm.quantite_kg
           FROM besoin_mrp bm
           JOIN plan_production pp ON pp.id_plan = bm.id_plan
          WHERE pp.statut = 'EN_COURS'
        ), etendue AS (
         SELECT max(annee_mois) AS dernier, count(DISTINCT annee_mois) AS nb FROM besoin_plan
        ), besoin AS (
         SELECT code_reference, annee_mois, quantite_kg, false AS prolonge FROM besoin_plan
         UNION ALL
         -- Au-dela du plan : la moyenne mensuelle du plan, mois par mois,
         -- multipliee par le coefficient de saison du mois (regle 9, 09/10/2026).
         SELECT b.code_reference, m.annee_mois,
                sum(b.quantite_kg) / NULLIF(e.nb, 0)
                  * COALESCE((SELECT s.coefficient FROM saison_mois s
                               WHERE s.mois = substr(m.annee_mois, 6, 2)::smallint), 1),
                true
           FROM besoin_plan b
           CROSS JOIN etendue e
           CROSS JOIN mois m
           CROSS JOIN p
          WHERE p.prolonger AND m.annee_mois > e.dernier
          GROUP BY b.code_reference, m.annee_mois, e.nb
        )
 SELECT w.code_reference,
    w.lead_j,
    w.couv_j,
    round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j) - m.debut_j) / 30.0), 0::numeric), 4) AS dem_lead_kg,
    round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j + w.couv_j) - GREATEST(m.debut_j, w.lead_j)) / 30.0), 0::numeric), 4) AS sorties_prevues_kg,
    round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j) - m.debut_j) / 30.0)
                     FILTER (WHERE bm.prolonge), 0::numeric), 4) AS dem_lead_prolonge_kg,
    round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j + w.couv_j) - GREATEST(m.debut_j, w.lead_j)) / 30.0)
                     FILTER (WHERE bm.prolonge), 0::numeric), 4) AS sorties_prolongees_kg
   FROM fenetre w
     CROSS JOIN mois m
     LEFT JOIN besoin bm ON bm.code_reference = w.code_reference AND bm.annee_mois = m.annee_mois
  GROUP BY w.code_reference, w.lead_j, w.couv_j;
ALTER VIEW v_besoin_horizon OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 5. Plus de part « au-delà du plan » sur le délai et la couverture
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_besoin_horizon_of AS
SELECT NULL::text  AS code_reference,
       0::numeric  AS dem_lead_au_dela_kg,
       0::numeric  AS sorties_au_dela_kg
 WHERE false;
ALTER VIEW v_besoin_horizon_of OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 6. Le fil sur machine compte au dernier constat, quel que soit son âge
-- -----------------------------------------------------------------------------
-- La définition en service (2026-10-10b), sans la condition d'âge du constat :
-- seuls P_MrpInclureStockMachine et le lot bloqué excluent encore du fil.
CREATE OR REPLACE VIEW v_stock_physique AS
 WITH hors_mrp AS (
         SELECT sl.code_reference,
            sum(
                CASE
                    WHEN l.categorie = 'RESTES'::text AND rr.suivi_lot = 1 AND l.statut <> 'BLOQUE'::text THEN sl.quantite_kg
                    ELSE 0::numeric
                END) AS restes_kg,
            sum(
                CASE
                    WHEN l.statut = 'BLOQUE'::text THEN sl.quantite_kg
                    ELSE 0::numeric
                END) AS bloque_kg
           FROM stock_lot sl
             JOIN lot l ON l.code_reference = sl.code_reference AND l.lot_fournisseur = sl.lot_fournisseur
             JOIN reference rr ON rr.code_reference = sl.code_reference
             JOIN magasin mg_1 ON mg_1.code_magasin = sl.code_magasin
          WHERE mg_1.inclure_mrp = 1 AND mg_1.est_quarantaine = 0
          GROUP BY sl.code_reference
        ), machine AS (
         SELECT e.code_reference,
            round(sum(e.kg), 4) AS kg_sur_machine
           FROM machine_etat e
             LEFT JOIN lot l ON l.code_reference = e.code_reference AND l.lot_fournisseur = e.lot_fournisseur
          WHERE COALESCE(( SELECT parametre.valeur_courante
                   FROM parametre
                  WHERE parametre.code_parametre = 'P_MrpInclureStockMachine'::text), '1'::text) = '1'::text
            AND COALESCE(l.statut, 'LIBRE'::text) <> 'BLOQUE'::text
          GROUP BY e.code_reference
        ), en_route AS (
         SELECT lt.code_reference,
            round(sum(lt.quantite_kg), 4) AS kg
           FROM transfert t
             JOIN ligne_transfert lt ON lt.id_transfert = t.id_transfert
             JOIN magasin md ON md.code_magasin = t.code_magasin_dest
          WHERE t.statut = 'VALIDE'::text AND md.inclure_mrp = 1 AND md.est_quarantaine = 0
          GROUP BY lt.code_reference
        )
 SELECT r.code_reference,
    round(COALESCE(sum(
        CASE
            WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg
            ELSE NULL::numeric
        END), 0::numeric), 4) AS stock_utilisable_kg,
    round(COALESCE(sum(
        CASE
            WHEN mg.est_quarantaine = 1 THEN sm.quantite_kg
            ELSE NULL::numeric
        END), 0::numeric), 4) AS stock_quarantaine_kg,
    round(COALESCE(max(h.restes_kg), 0::numeric) + COALESCE(max(h.bloque_kg), 0::numeric), 4) AS stock_reserve_kg,
    round(COALESCE(sum(
        CASE
            WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg
            ELSE NULL::numeric
        END), 0::numeric) - COALESCE(max(h.restes_kg), 0::numeric) - COALESCE(max(h.bloque_kg), 0::numeric), 4) AS stock_physique_net_kg,
    round(COALESCE(max(h.restes_kg), 0::numeric), 4) AS stock_restes_kg,
    round(COALESCE(max(h.bloque_kg), 0::numeric), 4) AS stock_bloque_kg,
    round(COALESCE(max(mc.kg_sur_machine), 0::numeric), 4) AS stock_machine_kg,
    round(COALESCE(sum(
        CASE
            WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg
            ELSE NULL::numeric
        END), 0::numeric) - COALESCE(max(h.restes_kg), 0::numeric) - COALESCE(max(h.bloque_kg), 0::numeric) + COALESCE(max(mc.kg_sur_machine), 0::numeric) + COALESCE(max(er.kg), 0::numeric), 4) AS stock_mrp_net_kg,
    round(COALESCE(max(er.kg), 0::numeric), 4) AS stock_transit_kg
   FROM reference r
     LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
     LEFT JOIN magasin mg ON mg.code_magasin = sm.code_magasin
     LEFT JOIN hors_mrp h ON h.code_reference = r.code_reference
     LEFT JOIN machine mc ON mc.code_reference = r.code_reference
     LEFT JOIN en_route er ON er.code_reference = r.code_reference
  WHERE r.actif = 1
  GROUP BY r.code_reference;
ALTER VIEW v_stock_physique OWNER TO gestionfil;

-- Le paramètre P_JoursInventMachine reste en place, inchangé : il ne sert plus que
-- le signal C36 (v_ctl_c36), jamais le calcul des besoins.

-- -----------------------------------------------------------------------------
-- Témoin
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_views
                WHERE schemaname = 'public'
                  AND viewname IN ('v_besoin_horizon', 'v_besoin_12m', 'v_besoin_mois')
                  AND definition LIKE '%v_besoin_of_mois%')
       OR EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_stock_physique'
                                           AND definition LIKE '%P_JoursInventMachine%')
       OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_besoin_of_mois')
       OR (SELECT count(*) FROM v_besoin_of_mois) <> 0
       OR (SELECT count(*) FROM v_besoin_horizon_of) <> 0
       OR EXISTS (SELECT 1 FROM v_besoin_12m WHERE besoin_au_dela_12m_kg <> 0
                                                OR besoin_plan_12m_kg <> besoin_12m_kg)
       OR to_regclass('public.v_ctl_c64') IS NULL
       OR to_regclass('public.v_besoin_of_qualite') IS NULL
       OR position('C64' IN pg_get_viewdef('v_controles'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-10-27b : migration incomplete';
    END IF;
END $$;

COMMIT;
