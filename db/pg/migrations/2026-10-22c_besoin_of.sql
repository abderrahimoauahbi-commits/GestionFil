-- =============================================================================
-- 2026-10-22c — Le besoin au-delà du plan : les OF consomment le plan (lot B)
-- =============================================================================
-- docs/A-DECIDER-of-supply-chain.md, §3, §4 (rôle 4) et §6 quater.
--
-- LA RÈGLE (décision du 22/10/2026, défauts du §6 quater). Par qualité et par
-- mois :
--
--     m² retenus = m² des OF retenus + max(0, m² du plan − m² des OF)
--
--   - OF retenus : PRÉVU et LANCÉ (un OF CLÔTURÉ ou ANNULÉ ne compte plus) ;
--   - un OF se répartit au prorata des jours entre sa date et sa fin prévue
--     (sans fin prévue : tout dans le mois de sa date) ;
--   - un OF n'est JAMAIS compté deux fois avec le plan : la part du plan qu'il
--     couvre se retire du besoin du plan, et lui s'y substitue ;
--   - MOIS ÉCOULÉS : le plan non couvert est abandonné (les vues du besoin ne
--     lisaient déjà que le mois courant et les suivants) ; un OF du passé
--     encore ouvert compte pour son RESTE, dans le mois courant ;
--   - RESTE d'un OF : son besoin matière prévu (métrage × recette, perte de la
--     qualité comprise, par référence) moins la consommation déjà attribuée à
--     cet OF — jamais négatif. La consommation attribuée s'impute d'abord sur
--     les mois les plus anciens de l'OF.
--
-- LA CONSOMMATION ATTRIBUÉE est calculée ici (pas de dépendance à
-- v_of_consommation, écrite en parallèle ; mêmes règles) :
--   - fil : écarts des lignes de décision machine ACTIVES dont l'OF DE LA
--     PÉRIODE est l'OF, effets CONSOMMATION (hors MJ_CORRECTION), DÉCHET, PERTE,
--     CASSE ; plus les bobines déchargées vers le déchet, la perte ou la casse ;
--   - hors machine : CONSO_DIRECTE portant l'OF, moins les RETOUR_CONSO portant
--     l'OF ; un mouvement contre-passé (et sa contre-passation) ne compte pas.
--
-- LE BESOIN SE DÉCOMPOSE ET SE MONTRE :
--   - besoin lié au plan : le plan non couvert + la part des OF qui tient dans
--     le plan du mois ;
--   - besoin AU-DELÀ du plan : la part des OF qui dépasse le plan du mois (un OF
--     hors plan y va tout entier).
--
-- POINT D'INSERTION : en aval de `besoin_mrp`, pas dans le calcul MRP. Le MRP
-- photographie le PLAN (figé, un recalcul par plan) ; les OF bougent tous les
-- jours (statut, consommation) : les matérialiser dans `besoin_mrp` les ferait
-- périmer entre deux calculs. Les vues qui lisent le besoin (`v_besoin_12m`,
-- `v_besoin_horizon`) reçoivent l'ajustement des OF par une vue vivante,
-- `v_besoin_of_mois` ; le stock projeté, le plan d'achat et sa proposition
-- suivent sans changer. SANS AUCUN OF, l'ajustement est vide et chaque vue rend
-- EXACTEMENT ce qu'elle rendait avant.
--
-- La part du plan couverte se retire de `besoin_mrp` (ce que le plan d'achat lit
-- aujourd'hui) au prorata de la recette vivante : jamais plus que ce que le MRP a
-- photographié, même si la recette a changé depuis.
--
-- Mois courant, à l'horizon du délai : le plan y compte au prorata des jours
-- qui restent (il est supposé consommé au fil du mois) ; le reste d'un OF, lui,
-- est déjà net de ce qu'il a consommé : il compte en entier sur les jours qui
-- restent.
--
--   1. v_of_mois              : chaque OF retenu, mois par mois (m²) ;
--   2. v_besoin_of_qualite    : par qualité et mois, m² du plan / des OF / au-delà ;
--   3. v_besoin_of            : par OF, référence et mois : prévu, consommé, reste,
--                               part liée au plan, part au-delà ;
--   4. v_besoin_of_mois       : par référence et mois ≥ courant : plan couvert à
--                               retirer, OF dans le plan, OF au-delà ;
--   5. v_besoin_mois          : le besoin combiné, par référence, mois et ORIGINE
--                               (PLAN / AU_DELA_PLAN) — la traçabilité ;
--   6. v_besoin_12m, v_stock_projete : colonnes AJOUTÉES À LA FIN (besoin du
--      plan / au-delà du plan) ; v_besoin_horizon : l'ajustement des OF, mêmes
--      colonnes (2026-10-09k doit se rejouer) ; v_besoin_horizon_of : la part
--      au-delà du plan sur le délai et la couverture ;
--   7. C64 (signal, jamais bloquant) : qualité et mois où les OF dépassent le plan ;
--   8. champs déclarés (STOCK, PLAN_ACHAT).
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- 1. Les OF retenus, mois par mois
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_of_mois AS
WITH of_retenu AS (
    SELECT o.id_of, o.numero, o.code_qualite, o.statut, o.date_of, o.date_fin_prevue,
           COALESCE(o.date_fin_prevue, o.date_of) AS date_fin,
           o.metrage_m2, COALESCE(q.taux_perte_pct, 0) AS taux_perte_pct
      FROM ordre_fabrication o
      JOIN qualite q ON q.code_qualite = o.code_qualite
     WHERE o.statut IN ('PREVU', 'LANCE')
)
SELECT o.id_of, o.numero, o.code_qualite, o.statut, o.date_of, o.date_fin_prevue,
       o.metrage_m2, o.taux_perte_pct,
       to_char(m.debut, 'YYYY-MM') AS annee_mois,
       -- Les jours de l'OF dans ce mois, sur les jours de l'OF (bornes comprises).
       o.metrage_m2 * (LEAST(o.date_fin, (m.debut + interval '1 month')::date - 1)
                       - GREATEST(o.date_of, m.debut::date) + 1)::numeric
                    / (o.date_fin - o.date_of + 1)::numeric AS m2
  FROM of_retenu o
 CROSS JOIN LATERAL generate_series(date_trunc('month', o.date_of::timestamp),
                                    date_trunc('month', o.date_fin::timestamp),
                                    interval '1 month') AS m(debut);
ALTER VIEW v_of_mois OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 2. Par qualité et mois : le plan, les OF, ce qui dépasse
-- -----------------------------------------------------------------------------
-- Le plan : les lignes des plans EN SERVICE dont la qualité est retenue par
-- l'en-tête (celles que le MRP explose).
CREATE OR REPLACE VIEW v_besoin_of_qualite AS
WITH plan_qm AS (
    SELECT lpp.code_qualite, lpp.annee_mois, sum(lpp.m2_prevus) AS m2
      FROM ligne_plan_production lpp
      JOIN plan_production pp ON pp.id_plan = lpp.id_plan
     WHERE pp.statut = 'EN_COURS' AND lpp.m2_prevus > 0
       AND EXISTS (SELECT 1 FROM plan_qualite pq
                    WHERE pq.id_plan = lpp.id_plan AND pq.code_qualite = lpp.code_qualite)
     GROUP BY lpp.code_qualite, lpp.annee_mois
),
of_qm AS (
    SELECT code_qualite, annee_mois, sum(m2) AS m2, count(*) AS nb_of,
           string_agg(numero, ', ' ORDER BY numero) AS ofs
      FROM v_of_mois
     GROUP BY code_qualite, annee_mois
)
SELECT o.code_qualite, o.annee_mois,
       round(COALESCE(p.m2, 0), 2)                         AS m2_plan,
       round(o.m2, 2)                                      AS m2_of,
       round(LEAST(o.m2, COALESCE(p.m2, 0)), 2)            AS m2_couvert,
       round(GREATEST(0, o.m2 - COALESCE(p.m2, 0)), 2)     AS m2_au_dela,
       -- La part du plan couverte par les OF, la part des OF au-delà du plan.
       CASE WHEN COALESCE(p.m2, 0) > 0 THEN LEAST(o.m2, p.m2) / p.m2 ELSE 0 END          AS part_plan_couverte,
       CASE WHEN o.m2 > 0 THEN GREATEST(0, o.m2 - COALESCE(p.m2, 0)) / o.m2 ELSE 0 END    AS part_of_au_dela,
       o.nb_of, o.ofs
  FROM of_qm o
  LEFT JOIN plan_qm p ON p.code_qualite = o.code_qualite AND p.annee_mois = o.annee_mois;
ALTER VIEW v_besoin_of_qualite OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 3. Par OF, référence et mois : prévu, consommé, reste, plan / au-delà
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_besoin_of AS
WITH
-- Des CTE MATERIALIZED : peu de lignes, et le planificateur n'a pas à
-- recombiner les vues imbriquées (sinon des secondes de planification).
om AS MATERIALIZED (
    SELECT id_of, numero, code_qualite, statut, date_of, date_fin_prevue, metrage_m2,
           taux_perte_pct, annee_mois, m2
      FROM v_of_mois
),
qm AS MATERIALIZED (
    SELECT code_qualite, annee_mois, m2_plan, m2_of, part_of_au_dela
      FROM v_besoin_of_qualite
),
recette AS MATERIALIZED (
    SELECT code_qualite, code_reference, sum(kg_m2) AS kg_m2
      FROM v_recette_calculee
     WHERE kg_m2 IS NOT NULL
       AND code_qualite IN (SELECT code_qualite FROM om)
     GROUP BY code_qualite, code_reference
),
prevu AS MATERIALIZED (
    SELECT om.*, r.code_reference,
           om.m2 * r.kg_m2 * (1 + om.taux_perte_pct / 100.0) AS kg_prevu
      FROM om
      JOIN recette r ON r.code_qualite = om.code_qualite
),
-- La consommation déjà attribuée à l'OF, par référence.
conso AS MATERIALIZED (
    SELECT x.id_of, x.code_reference, sum(x.kg) AS kg
      FROM (
        SELECT l.id_of_periode AS id_of, l.code_reference,
               CASE WHEN l.effet_ecart = 'CONSOMMATION' AND l.code_motif <> 'MJ_CORRECTION' THEN l.ecart_kg
                    WHEN l.effet_ecart IN ('DECHET', 'PERTE', 'CASSE') THEN l.ecart_kg
                    ELSE 0 END
             + CASE WHEN d.nature = 'DECHARGE' AND l.destination IN ('DECHET', 'PERTE', 'CASSE')
                    THEN l.kg_mouvementes ELSE 0 END AS kg
          FROM machine_decision_ligne l
          JOIN machine_decision d ON d.id_decision = l.id_decision
         WHERE d.statut = 'ACTIVE'
           AND l.id_of_periode IN (SELECT id_of FROM om)
        UNION ALL
        SELECT m.id_of, lm.code_reference,
               CASE m.code_type_mvt WHEN 'CONSO_DIRECTE' THEN lm.quantite_kg ELSE -lm.quantite_kg END
          FROM mouvement m
          JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
         WHERE m.id_of IN (SELECT id_of FROM om)
           AND m.code_type_mvt IN ('CONSO_DIRECTE', 'RETOUR_CONSO')
           AND m.id_mouvement_contrepasse IS NULL
           AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
      ) x
     GROUP BY x.id_of, x.code_reference
),
-- Le consommé s'impute d'abord sur les mois les plus anciens de l'OF.
reste AS (
    SELECT p.*, LEAST(p.kg_prevu, GREATEST(0, p.kg_conso_of - p.cumul_avant)) AS kg_consomme
      FROM (
        SELECT pv.*, COALESCE(c.kg, 0) AS kg_conso_of,
               COALESCE(sum(pv.kg_prevu) OVER (PARTITION BY pv.id_of, pv.code_reference ORDER BY pv.annee_mois
                                               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS cumul_avant
          FROM prevu pv
          LEFT JOIN conso c ON c.id_of = pv.id_of AND c.code_reference = pv.code_reference
      ) p
)
SELECT r.id_of, r.numero, r.code_qualite, r.statut, r.date_of, r.date_fin_prevue, r.metrage_m2,
       r.annee_mois,
       -- Le mois où le reste pèse : un mois écoulé se reporte sur le mois courant.
       GREATEST(r.annee_mois, to_char(CURRENT_DATE, 'YYYY-MM'))   AS annee_mois_besoin,
       r.code_reference,
       round(r.m2, 4)                                               AS m2,
       qm.m2_plan                                                   AS m2_plan_mois,
       qm.m2_of                                                     AS m2_of_mois,
       round(qm.part_of_au_dela, 6)                                 AS part_au_dela,
       round(r.kg_prevu, 4)                                         AS kg_prevu,
       round(r.kg_consomme, 4)                                      AS kg_consomme,
       round(r.kg_prevu - r.kg_consomme, 4)                         AS kg_reste,
       round((r.kg_prevu - r.kg_consomme) * (1 - qm.part_of_au_dela), 4) AS kg_reste_plan,
       round((r.kg_prevu - r.kg_consomme) * qm.part_of_au_dela, 4)       AS kg_reste_au_dela
  FROM reste r
  JOIN qm ON qm.code_qualite = r.code_qualite AND qm.annee_mois = r.annee_mois;
ALTER VIEW v_besoin_of OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 4. Par référence et mois (≥ courant) : l'ajustement que les OF portent au plan
-- -----------------------------------------------------------------------------
-- UNE FONCTION, PAS UNE VUE IMBRIQUÉE. Le stock projeté et le plan d'achat
-- joignent déjà une vingtaine de relations ; y déplier ces vues faisait passer
-- la PLANIFICATION de v_plan_achat de moins d'une seconde à près de dix
-- (mesuré le 22/10/2026). Une fonction plpgsql est opaque pour le planificateur
-- (il n'y voit qu'un balayage de quelques lignes) et son plan se garde dans la
-- session. Sans OF retenu, elle ne lit rien et ne rend rien.
CREATE OR REPLACE FUNCTION fn_besoin_of_mois()
RETURNS TABLE (code_reference text, annee_mois text, kg_plan_couvert numeric,
               kg_of_plan numeric, kg_of_au_dela numeric, kg_ajustement numeric)
LANGUAGE plpgsql STABLE ROWS 20 AS $fn$
#variable_conflict use_column
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ordre_fabrication WHERE statut IN ('PREVU', 'LANCE')) THEN
        RETURN;
    END IF;
    RETURN QUERY
    WITH
    cal AS (SELECT to_char(CURRENT_DATE, 'YYYY-MM') AS mois_courant),
    recette AS (
        SELECT code_qualite, code_reference, sum(kg_m2) AS kg_m2
          FROM v_recette_calculee
         WHERE kg_m2 IS NOT NULL
         GROUP BY code_qualite, code_reference
    ),
    -- Les qualités et mois dont le plan est (en partie) couvert par des OF, et les
    -- références qu'elles touchent : le calcul qui suit ne porte que sur elles (sans
    -- OF, il ne coûte rien).
    couv_qm AS MATERIALIZED (
        SELECT q.code_qualite, q.annee_mois, q.part_plan_couverte
          FROM v_besoin_of_qualite q
         CROSS JOIN cal
         WHERE q.part_plan_couverte > 0 AND q.annee_mois >= cal.mois_courant
    ),
    touchees AS MATERIALIZED (
        SELECT DISTINCT r.code_reference, c.annee_mois
          FROM couv_qm c
          JOIN recette r ON r.code_qualite = c.code_qualite
    ),
    -- Le plan recalculé sur la recette vivante, par qualité : il ne sert qu'à dire
    -- QUELLE PART du besoin photographié la couverture des OF retire.
    plan_vivant AS (
        SELECT lpp.code_qualite, lpp.annee_mois, r.code_reference,
               sum(lpp.m2_prevus * r.kg_m2 * (1 + pp.taux_perte_pct / 100.0)) AS kg
          FROM ligne_plan_production lpp
          JOIN plan_production pp ON pp.id_plan = lpp.id_plan
          JOIN plan_qualite pq ON pq.id_plan = lpp.id_plan AND pq.code_qualite = lpp.code_qualite
          JOIN recette r ON r.code_qualite = lpp.code_qualite
          JOIN touchees t ON t.code_reference = r.code_reference AND t.annee_mois = lpp.annee_mois
         WHERE pp.statut = 'EN_COURS' AND lpp.m2_prevus > 0
         GROUP BY lpp.code_qualite, lpp.annee_mois, r.code_reference
    ),
    couvert AS (
        SELECT pv.code_reference, pv.annee_mois,
               sum(pv.kg * COALESCE(q.part_plan_couverte, 0)) / NULLIF(sum(pv.kg), 0) AS part
          FROM plan_vivant pv
          LEFT JOIN couv_qm q ON q.code_qualite = pv.code_qualite AND q.annee_mois = pv.annee_mois
         GROUP BY pv.code_reference, pv.annee_mois
        HAVING sum(pv.kg * COALESCE(q.part_plan_couverte, 0)) > 0
    ),
    plan_couvert AS (
        SELECT bm.code_reference, bm.annee_mois, sum(bm.quantite_kg) * LEAST(1, min(c.part)) AS kg
          FROM couvert c
          JOIN besoin_mrp bm ON bm.code_reference = c.code_reference AND bm.annee_mois = c.annee_mois
          JOIN plan_production pp ON pp.id_plan = bm.id_plan AND pp.statut = 'EN_COURS'
         GROUP BY bm.code_reference, bm.annee_mois
    ),
    of_ref AS MATERIALIZED (
        SELECT code_reference, annee_mois_besoin AS annee_mois,
               sum(kg_reste_plan) AS kg_plan, sum(kg_reste_au_dela) AS kg_au_dela
          FROM v_besoin_of
         GROUP BY code_reference, annee_mois_besoin
    )
    SELECT COALESCE(o.code_reference, c.code_reference)       AS code_reference,
           COALESCE(o.annee_mois, c.annee_mois)               AS annee_mois,
           round(COALESCE(c.kg, 0), 4)                        AS kg_plan_couvert,
           round(COALESCE(o.kg_plan, 0), 4)                   AS kg_of_plan,
           round(COALESCE(o.kg_au_dela, 0), 4)                AS kg_of_au_dela,
           round(COALESCE(o.kg_plan, 0) + COALESCE(o.kg_au_dela, 0) - COALESCE(c.kg, 0), 4) AS kg_ajustement
      FROM of_ref o
      FULL JOIN plan_couvert c ON c.code_reference = o.code_reference AND c.annee_mois = o.annee_mois;
END;
$fn$;
ALTER FUNCTION fn_besoin_of_mois() OWNER TO gestionfil;

CREATE OR REPLACE VIEW v_besoin_of_mois AS
SELECT code_reference, annee_mois, kg_plan_couvert, kg_of_plan, kg_of_au_dela, kg_ajustement
  FROM fn_besoin_of_mois();
ALTER VIEW v_besoin_of_mois OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 5. Le besoin combiné, par référence, mois et origine (traçabilité)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_besoin_mois AS
WITH
cal AS (SELECT to_char(CURRENT_DATE, 'YYYY-MM') AS mois_courant),
plan_mrp AS (
    SELECT bm.code_reference, bm.annee_mois, sum(bm.quantite_kg) AS kg
      FROM besoin_mrp bm
      JOIN plan_production pp ON pp.id_plan = bm.id_plan
     CROSS JOIN cal
     WHERE pp.statut = 'EN_COURS' AND bm.annee_mois >= cal.mois_courant
     GROUP BY bm.code_reference, bm.annee_mois
),
ofm AS MATERIALIZED (
    SELECT * FROM v_besoin_of_mois
)
SELECT COALESCE(p.code_reference, o.code_reference) AS code_reference,
       COALESCE(p.annee_mois, o.annee_mois)         AS annee_mois,
       'PLAN'::text                                 AS origine,
       round(GREATEST(0, COALESCE(p.kg, 0) - COALESCE(o.kg_plan_couvert, 0) + COALESCE(o.kg_of_plan, 0)), 4) AS quantite_kg,
       round(COALESCE(o.kg_of_plan, 0), 4)          AS dont_of_kg
  FROM plan_mrp p
  FULL JOIN ofm o ON o.code_reference = p.code_reference AND o.annee_mois = p.annee_mois
UNION ALL
SELECT code_reference, annee_mois, 'AU_DELA_PLAN'::text, kg_of_au_dela, kg_of_au_dela
  FROM ofm
 WHERE kg_of_au_dela > 0;
ALTER VIEW v_besoin_mois OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 6a. v_besoin_12m : le plan + l'ajustement des OF ; deux colonnes à la fin
-- -----------------------------------------------------------------------------
-- Les deux premières colonnes gardent leur calcul : sans OF, l'ajustement est
-- vide et la vue rend exactement ce qu'elle rendait.
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
),
ajust AS (
    SELECT code_reference,
           sum(kg_of_plan - kg_plan_couvert) AS kg_plan,
           sum(kg_of_au_dela)                AS kg_au_dela,
           count(DISTINCT annee_mois)        AS nb_mois
      FROM v_besoin_of_mois
     GROUP BY code_reference
)
SELECT COALESCE(p.code_reference, a.code_reference) AS code_reference,
       round(GREATEST(0, COALESCE(p.kg, 0) + COALESCE(a.kg_plan, 0)) + COALESCE(a.kg_au_dela, 0), 4) AS besoin_12m_kg,
       round((GREATEST(0, COALESCE(p.kg, 0) + COALESCE(a.kg_plan, 0)) + COALESCE(a.kg_au_dela, 0))
             / COALESCE(p.nb_mois, NULLIF(a.nb_mois, 0), 1)::numeric, 4)                         AS besoin_mensuel_moyen_kg,
       round(GREATEST(0, COALESCE(p.kg, 0) + COALESCE(a.kg_plan, 0)), 4)                         AS besoin_plan_12m_kg,
       round(COALESCE(a.kg_au_dela, 0), 4)                                                        AS besoin_au_dela_12m_kg
  FROM plan p
  FULL JOIN ajust a ON a.code_reference = p.code_reference;
ALTER VIEW v_besoin_12m OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 6b. v_besoin_horizon : l'ajustement des OF, MÊMES COLONNES
-- -----------------------------------------------------------------------------
-- Les colonnes ne changent pas : 2026-10-09k redéfinit cette vue et doit
-- pouvoir se rejouer (banc, scénario migrations_rejouables) — une colonne
-- ajoutée l'en empêcherait (« ne peut pas supprimer les colonnes d'une vue »).
-- La part au-delà du plan sur l'horizon se lit dans v_besoin_horizon_of.
-- Le plan couvert se retire au rythme du plan (/ 30 jours, le mois courant au
-- prorata des jours qui restent) ; le reste d'un OF compte en entier sur les
-- jours qui restent du mois (diviseur : la longueur du mois dans l'horizon).
-- La prolongation au-delà du plan reste celle du plan seul.
CREATE OR REPLACE VIEW v_besoin_horizon AS
WITH p AS (
    SELECT (SELECT parametre.valeur_courante::numeric FROM parametre
             WHERE parametre.code_parametre = 'P_DelaiDefaut') AS delai_defaut,
           (SELECT parametre.valeur_courante::numeric FROM parametre
             WHERE parametre.code_parametre = 'P_MargeJours') AS marge_jours,
           ((date_trunc('month', CURRENT_DATE::timestamp with time zone) + '1 mon'::interval)::date - CURRENT_DATE)::numeric
             / EXTRACT(day FROM date_trunc('month', CURRENT_DATE::timestamp with time zone) + '1 mon -1 days'::interval) AS reste_mois,
           COALESCE((SELECT parametre.valeur_courante FROM parametre
                      WHERE parametre.code_parametre = 'P_HorizonProlonge'), '1') = '1' AS prolonger
),
mois AS (
    SELECT i.i,
           to_char(date_trunc('month', CURRENT_DATE::timestamp with time zone) + (((i.i - 1) || ' month')::interval), 'YYYY-MM') AS annee_mois,
           CASE WHEN i.i = 1 THEN 0::numeric
                ELSE 30.0 * p.reste_mois + (i.i - 2)::numeric * 30.0 END AS debut_j,
           30.0 * p.reste_mois + (i.i - 1)::numeric * 30.0 AS fin_j
      FROM generate_series(1, 12) i(i)
     CROSS JOIN p
),
fenetre AS (
    SELECT r.code_reference,
           COALESCE(f.delai_livraison_jours::numeric, p.delai_defaut) AS lead_j,
           COALESCE(f.couverture_commande_j::numeric, p.marge_jours) AS couv_j
      FROM reference r
      LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
     CROSS JOIN p
),
besoin_plan AS (
    SELECT bm_1.code_reference, bm_1.annee_mois, bm_1.quantite_kg
      FROM besoin_mrp bm_1
      JOIN plan_production pp ON pp.id_plan = bm_1.id_plan
     WHERE pp.statut = 'EN_COURS'
),
etendue AS (
    SELECT max(besoin_plan.annee_mois) AS dernier, count(DISTINCT besoin_plan.annee_mois) AS nb
      FROM besoin_plan
),
-- Calculé une fois (MATERIALIZED) : sinon la jointure par référence le referait
-- pour chaque ligne de l'horizon.
of_mois AS MATERIALIZED (
    SELECT code_reference, annee_mois, kg_plan_couvert, kg_of_plan, kg_of_au_dela
      FROM v_besoin_of_mois
),
besoin AS MATERIALIZED (
    SELECT besoin_plan.code_reference, besoin_plan.annee_mois, besoin_plan.quantite_kg,
           false AS prolonge, false AS of_entier, 0::numeric AS au_dela_kg
      FROM besoin_plan
    UNION ALL
    SELECT b.code_reference, m_1.annee_mois,
           sum(b.quantite_kg) / NULLIF(e.nb, 0)::numeric
             * COALESCE((SELECT s.coefficient FROM saison_mois s
                          WHERE s.mois = substr(m_1.annee_mois, 6, 2)::smallint), 1::numeric),
           true, false, 0::numeric
      FROM besoin_plan b
     CROSS JOIN etendue e
     CROSS JOIN mois m_1
     CROSS JOIN p
     WHERE p.prolonger AND m_1.annee_mois > e.dernier
     GROUP BY b.code_reference, m_1.annee_mois, e.nb
    UNION ALL
    -- Les OF (lot B, 22/10/2026) : la part du plan qu'ils couvrent se retire...
    SELECT o.code_reference, o.annee_mois, -o.kg_plan_couvert, false, false, 0::numeric
      FROM of_mois o
     WHERE o.kg_plan_couvert <> 0
    UNION ALL
    -- ... et leur reste s'y substitue, dont la part au-delà du plan.
    SELECT o.code_reference, o.annee_mois, o.kg_of_plan + o.kg_of_au_dela, false, true, o.kg_of_au_dela
      FROM of_mois o
     WHERE o.kg_of_plan + o.kg_of_au_dela <> 0
)
SELECT w.code_reference, w.lead_j, w.couv_j,
       round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j) - m.debut_j)
                          / CASE WHEN bm.of_entier THEN m.fin_j - m.debut_j ELSE 30.0 END), 0::numeric), 4) AS dem_lead_kg,
       round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j + w.couv_j) - GREATEST(m.debut_j, w.lead_j))
                          / CASE WHEN bm.of_entier THEN m.fin_j - m.debut_j ELSE 30.0 END), 0::numeric), 4) AS sorties_prevues_kg,
       round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j) - m.debut_j) / 30.0)
                      FILTER (WHERE bm.prolonge), 0::numeric), 4) AS dem_lead_prolonge_kg,
       round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j + w.couv_j) - GREATEST(m.debut_j, w.lead_j)) / 30.0)
                      FILTER (WHERE bm.prolonge), 0::numeric), 4) AS sorties_prolongees_kg
  FROM fenetre w
 CROSS JOIN mois m
  LEFT JOIN besoin bm ON bm.code_reference = w.code_reference AND bm.annee_mois = m.annee_mois
 GROUP BY w.code_reference, w.lead_j, w.couv_j;
ALTER VIEW v_besoin_horizon OWNER TO gestionfil;

-- La part AU-DELÀ DU PLAN de la demande pendant le délai et des sorties de la
-- couverture : mêmes fenêtres que v_besoin_horizon, sur le seul reste des OF
-- au-delà du plan (en entier sur les jours qui restent du mois courant). Une
-- ligne par référence touchée par un OF au-delà du plan ; aucune sans OF.
CREATE OR REPLACE VIEW v_besoin_horizon_of AS
WITH p AS (
    SELECT (SELECT parametre.valeur_courante::numeric FROM parametre
             WHERE parametre.code_parametre = 'P_DelaiDefaut') AS delai_defaut,
           (SELECT parametre.valeur_courante::numeric FROM parametre
             WHERE parametre.code_parametre = 'P_MargeJours') AS marge_jours,
           ((date_trunc('month', CURRENT_DATE::timestamp with time zone) + '1 mon'::interval)::date - CURRENT_DATE)::numeric
             / EXTRACT(day FROM date_trunc('month', CURRENT_DATE::timestamp with time zone) + '1 mon -1 days'::interval) AS reste_mois
),
mois AS (
    SELECT to_char(date_trunc('month', CURRENT_DATE::timestamp with time zone) + (((i.i - 1) || ' month')::interval), 'YYYY-MM') AS annee_mois,
           CASE WHEN i.i = 1 THEN 0::numeric
                ELSE 30.0 * p.reste_mois + (i.i - 2)::numeric * 30.0 END AS debut_j,
           30.0 * p.reste_mois + (i.i - 1)::numeric * 30.0 AS fin_j
      FROM generate_series(1, 12) i(i)
     CROSS JOIN p
),
ofm AS MATERIALIZED (
    SELECT code_reference, annee_mois, kg_of_au_dela
      FROM v_besoin_of_mois
     WHERE kg_of_au_dela <> 0
),
fenetre AS (
    SELECT r.code_reference,
           COALESCE(f.delai_livraison_jours::numeric, p.delai_defaut) AS lead_j,
           COALESCE(f.couverture_commande_j::numeric, p.marge_jours) AS couv_j
      FROM reference r
      LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
     CROSS JOIN p
     WHERE r.code_reference IN (SELECT code_reference FROM ofm)
)
SELECT w.code_reference,
       round(COALESCE(sum(o.kg_of_au_dela * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j) - m.debut_j)
                          / (m.fin_j - m.debut_j)), 0::numeric), 4) AS dem_lead_au_dela_kg,
       round(COALESCE(sum(o.kg_of_au_dela * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j + w.couv_j) - GREATEST(m.debut_j, w.lead_j))
                          / (m.fin_j - m.debut_j)), 0::numeric), 4) AS sorties_au_dela_kg
  FROM fenetre w
 CROSS JOIN mois m
  LEFT JOIN ofm o ON o.code_reference = w.code_reference AND o.annee_mois = m.annee_mois
 GROUP BY w.code_reference;
ALTER VIEW v_besoin_horizon_of OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 6c. v_stock_projete : le besoin du plan, le besoin au-delà ; colonnes à la fin
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    def    text;
    -- La dernière colonne, puis la clause FROM (forme brute de pg_get_viewdef).
    ancre  text := 'ph.stock_machine_kg' || chr(10) || '   FROM ';
BEGIN
    def := pg_get_viewdef('v_stock_projete'::regclass);
    IF position('besoin_au_dela_12m_kg' IN def) = 0 THEN
        IF (length(def) - length(replace(def, ancre, ''))) / length(ancre) <> 1 THEN
            RAISE EXCEPTION '2026-10-22c : fin de la liste des colonnes de v_stock_projete introuvable';
        END IF;
        def := replace(rtrim(rtrim(def), ';'), ancre,
            'ph.stock_machine_kg,' || chr(10)
            || '    COALESCE(b.besoin_plan_12m_kg, 0::numeric) AS besoin_plan_12m_kg,' || chr(10)
            || '    COALESCE(b.besoin_au_dela_12m_kg, 0::numeric) AS besoin_au_dela_12m_kg' || chr(10)
            || '   FROM ');
        EXECUTE 'CREATE OR REPLACE VIEW v_stock_projete AS ' || def;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. C64 : des OF au-delà du plan (signal, jamais bloquant)
-- -----------------------------------------------------------------------------
-- Une qualité et un mois où les OF retenus (PRÉVU, LANCÉ) dépassent le plan en
-- service : le besoin augmente d'autant, c'est voulu (§4) ; on le montre.
CREATE OR REPLACE VIEW v_ctl_c64 AS
SELECT q.code_qualite, q.annee_mois, q.m2_plan, q.m2_of, q.m2_au_dela, q.nb_of, q.ofs
  FROM v_besoin_of_qualite q
 WHERE q.m2_au_dela > 0
 ORDER BY q.annee_mois, q.code_qualite;
ALTER VIEW v_ctl_c64 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C64' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C64''::text, ''OF au-dela du plan de production (qualite et mois)''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c64)';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Les champs affichés
-- -----------------------------------------------------------------------------
-- Écran « Stock projeté » (module STOCK) : le besoin de l'horizon (déjà en
-- colonne, jamais déclaré, donc masqué) et sa décomposition ; même niveau que
-- le stock projeté. Le détail du plan d'achat lit les mêmes noms.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
    ('STOCK',      'besoin_12m_kg',            'Besoin de l''horizon (kg)',         'LECTURE', 0, 101),
    ('STOCK',      'besoin_plan_12m_kg',       'Besoin lié au plan (kg)',           'LECTURE', 0, 102),
    ('STOCK',      'besoin_au_dela_12m_kg',    'Besoin au-delà du plan (kg)',       'LECTURE', 0, 103),
    ('STOCK',      'demande_delai_au_dela_kg', 'Demande au-delà du plan (délai)',   'LECTURE', 0, 104),
    ('PLAN_ACHAT', 'besoin_plan_12m_kg',       'Besoin lié au plan (kg)',           'LECTURE', 0, 51),
    ('PLAN_ACHAT', 'besoin_au_dela_12m_kg',    'Besoin au-delà du plan (kg)',       'LECTURE', 0, 52),
    ('PLAN_ACHAT', 'demande_delai_au_dela_kg', 'Demande au-delà du plan (délai)',   'LECTURE', 0, 53)
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN (VALUES ('besoin_12m_kg'), ('besoin_plan_12m_kg'), ('besoin_au_dela_12m_kg'),
                    ('demande_delai_au_dela_kg')) c(champ)
 WHERE m.module IN ('STOCK', 'PLAN_ACHAT') AND m.champ = 'stock_projete_kg'
   AND EXISTS (SELECT 1 FROM champ_configurable cc WHERE cc.module = m.module AND cc.champ = c.champ)
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, origine)
SELECT d.id_utilisateur, d.module, c.champ, d.niveau, d.origine
  FROM droit_champ d
 CROSS JOIN (VALUES ('besoin_12m_kg'), ('besoin_plan_12m_kg'), ('besoin_au_dela_12m_kg'),
                    ('demande_delai_au_dela_kg')) c(champ)
 WHERE d.module IN ('STOCK', 'PLAN_ACHAT') AND d.champ = 'stock_projete_kg'
   AND EXISTS (SELECT 1 FROM champ_configurable cc WHERE cc.module = d.module AND cc.champ = c.champ)
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Témoin
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.v_besoin_of_mois') IS NULL
       OR to_regclass('public.v_besoin_mois') IS NULL
       OR to_regclass('public.v_ctl_c64') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'v_stock_projete' AND column_name = 'besoin_au_dela_12m_kg')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'v_besoin_horizon_of' AND column_name = 'dem_lead_au_dela_kg')
       OR position('v_besoin_of_mois' IN pg_get_viewdef('v_besoin_horizon'::regclass)) = 0
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'v_besoin_12m' AND column_name = 'besoin_au_dela_12m_kg')
       OR position('C64' IN pg_get_viewdef('v_controles'::regclass)) = 0
       OR NOT EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'STOCK' AND champ = 'besoin_au_dela_12m_kg') THEN
        RAISE EXCEPTION '2026-10-22c : migration incomplete';
    END IF;
END $$;

COMMIT;
