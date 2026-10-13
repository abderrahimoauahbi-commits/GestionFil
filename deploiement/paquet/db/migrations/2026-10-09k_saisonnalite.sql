-- =============================================================================
-- 2026-10-09k — La saison, deux alertes et les stocks minimums (regle 9,
-- arbitrage du 09/10/2026)
-- =============================================================================
-- 1. LA SAISON. Au-dela du plan en service, la demande est prolongee a la
--    moyenne du plan ; janvier-mars tourne pourtant a 120-140 t par mois contre
--    184 en moyenne. Un coefficient par mois (saison_mois, regle par la
--    Direction, 1 par defaut) multiplie la moyenne prolongee.
-- 2. DEUX ALERTES qui signalent sans bloquer :
--    C49 la part prolongee depasse la moitie de la demande d'une proposition
--        (« estimation basee sur la prolongation ») ;
--    C50 apres 6 mois d'historique, la moyenne du plan s'ecarte de plus de 50 %
--        de la consommation reelle.
-- 3. LES STOCKS MINIMUMS A REVOIR (793 t venues du classeur, non voulues) :
--    mesures au besoin mensuel DU PLAN (l'historique reel est trop court), avec
--    une valeur proposee = couverture minimale en mois x besoin mensuel.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. La saison -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saison_mois (
    mois                 smallint PRIMARY KEY CHECK (mois BETWEEN 1 AND 12),
    libelle              text NOT NULL,
    coefficient          numeric(6, 3) NOT NULL DEFAULT 1 CHECK (coefficient > 0 AND coefficient <= 3),
    date_modification    text,
    id_utilisateur_modif text REFERENCES utilisateur(id_utilisateur)
);
ALTER TABLE saison_mois OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_fk_saison_mois_modif ON saison_mois(id_utilisateur_modif);
INSERT INTO saison_mois (mois, libelle) VALUES
  (1, 'Janvier'), (2, 'Fevrier'), (3, 'Mars'), (4, 'Avril'), (5, 'Mai'), (6, 'Juin'),
  (7, 'Juillet'), (8, 'Aout'), (9, 'Septembre'), (10, 'Octobre'), (11, 'Novembre'), (12, 'Decembre')
ON CONFLICT (mois) DO NOTHING;
DROP TRIGGER IF EXISTS trg_audit_modification ON saison_mois;
CREATE TRIGGER trg_audit_modification AFTER UPDATE ON saison_mois
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES ('PARAMETRES', 'coefficient', 'Coefficient de saison', 'ECRITURE', 0, 900)
ON CONFLICT DO NOTHING;

-- La demande, avec sa part prolongee (colonnes ajoutees en fin de vue).
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

-- 2. Les deux alertes ----------------------------------------------------------------
CREATE OR REPLACE VIEW v_ctl_c49 AS
SELECT h.code_reference,
       round(h.dem_lead_kg + h.sorties_prevues_kg, 1) AS demande_kg,
       round(h.dem_lead_prolonge_kg + h.sorties_prolongees_kg, 1) AS part_prolongee_kg,
       round(100 * (h.dem_lead_prolonge_kg + h.sorties_prolongees_kg)
                 / NULLIF(h.dem_lead_kg + h.sorties_prevues_kg, 0), 1) AS part_pct
  FROM v_besoin_horizon h
  JOIN v_plan_achat pa ON pa.code_reference = h.code_reference AND pa.qte_a_commander_kg > 0
 WHERE h.dem_lead_kg + h.sorties_prevues_kg > 0
   AND (h.dem_lead_prolonge_kg + h.sorties_prolongees_kg) > 0.5 * (h.dem_lead_kg + h.sorties_prevues_kg);
ALTER VIEW v_ctl_c49 OWNER TO gestionfil;

CREATE OR REPLACE VIEW v_ctl_c50 AS
WITH plan AS (
    SELECT bm.code_reference, sum(bm.quantite_kg) / NULLIF(count(DISTINCT bm.annee_mois), 0) AS moyenne_plan_kg
      FROM besoin_mrp bm JOIN plan_production pp ON pp.id_plan = bm.id_plan
     WHERE pp.statut = 'EN_COURS'
     GROUP BY bm.code_reference
)
SELECT c.code_reference, round(p.moyenne_plan_kg, 1) AS moyenne_plan_kg,
       round(c.conso_mensuelle_kg, 1) AS conso_reelle_kg, c.nb_mois_ecoules
  FROM v_conso_reelle c
  JOIN plan p ON p.code_reference = c.code_reference
 WHERE c.nb_mois_ecoules >= 6 AND c.conso_mensuelle_kg > 0
   AND abs(p.moyenne_plan_kg - c.conso_mensuelle_kg) > 0.5 * c.conso_mensuelle_kg;
ALTER VIEW v_ctl_c50 OWNER TO gestionfil;

-- 3. Les stocks minimums a revoir -----------------------------------------------------
CREATE OR REPLACE VIEW v_stocks_minimums_a_revoir AS
WITH plan AS (
    SELECT bm.code_reference, sum(bm.quantite_kg) / NULLIF(count(DISTINCT bm.annee_mois), 0) AS besoin_mensuel_kg
      FROM besoin_mrp bm JOIN plan_production pp ON pp.id_plan = bm.id_plan
     WHERE pp.statut = 'EN_COURS'
     GROUP BY bm.code_reference
)
SELECT r.code_reference, r.designation, r.code_fournisseur,
       round(r.stock_min_kg, 1) AS stock_min_kg,
       r.couverture_min_mois,
       round(COALESCE(p.besoin_mensuel_kg, 0), 1) AS besoin_mensuel_kg,
       round(r.stock_min_kg / NULLIF(p.besoin_mensuel_kg, 0), 1) AS mois_couverts,
       round(r.couverture_min_mois * p.besoin_mensuel_kg, 0) AS valeur_proposee_kg
  FROM reference r
  LEFT JOIN plan p ON p.code_reference = r.code_reference
 WHERE r.actif = 1 AND COALESCE(r.stock_min_kg, 0) > 0
   AND (COALESCE(p.besoin_mensuel_kg, 0) = 0 OR r.stock_min_kg > 3 * p.besoin_mensuel_kg);
ALTER VIEW v_stocks_minimums_a_revoir OWNER TO gestionfil;

DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C49' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C49''::text, ''Proposition estimee surtout sur la prolongation du plan''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c49)'
                ' UNION ALL SELECT ''C50''::text, ''Moyenne du plan eloignee de plus de 50 % de la consommation reelle''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c50)';
    END IF;
END $$;

COMMIT;
