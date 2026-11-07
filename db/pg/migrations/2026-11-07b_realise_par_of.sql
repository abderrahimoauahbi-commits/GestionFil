-- =============================================================================
-- 2026-11-07b — Le metrage realise d'une qualite vient des OF clotures
-- =============================================================================
-- Revue des 22 domaines, point 11 (07/11/2026). `ligne_plan_production.m2_realises`
-- n'a aucun ecran ni aucun calcul qui l'ecrive : le taux de realisation de
-- `v_stat_qualite` (Statistiques, Cockpit) valait toujours 0 %. Le realise d'un
-- mois et d'une qualite est desormais le METRAGE DES OF CLOTURES de cette
-- qualite dates de ce mois (`ordre_fabrication.date_of`) ; un OF sans metrage ne
-- compte pas (on ne devine pas). Une valeur saisie sur la ligne du plan, s'il y
-- en a une, prime toujours.
--
-- Rien n'est ajoute au schema : memes colonnes, meme sens, la source change.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE VIEW v_stat_qualite AS
WITH cout AS (
    SELECT rc.code_qualite,
           count(*) AS nb_composants,
           count(DISTINCT rc.code_role) AS nb_roles,
           sum(CASE WHEN r.cmup_mad IS NULL THEN 1 ELSE 0 END) AS nb_sans_cmup,
           round(sum(rc.kg_m2), 6) AS kg_m2_total,
           round(sum(rc.kg_m2 * COALESCE(r.cmup_mad, 0::numeric)), 4) AS cout_matiere_m2_mad
      FROM v_recette_calculee rc
      JOIN reference r ON r.code_reference = rc.code_reference
     GROUP BY rc.code_qualite
),
realise_of AS (
    -- Le metrage des OF clotures, par qualite et par mois de l'OF.
    SELECT o.code_qualite, to_char(o.date_of, 'YYYY-MM') AS annee_mois, sum(o.metrage_m2) AS m2
      FROM ordre_fabrication o
     WHERE o.statut = 'CLOTURE' AND o.metrage_m2 IS NOT NULL
     GROUP BY o.code_qualite, to_char(o.date_of, 'YYYY-MM')
),
production AS (
    SELECT lpp.code_qualite,
           round(sum(lpp.m2_prevus), 0) AS m2_prevus,
           round(sum(COALESCE(lpp.m2_realises, ro.m2, 0::numeric)), 0) AS m2_realises,
           count(*) AS nb_mois_planifies
      FROM ligne_plan_production lpp
      JOIN plan_production pp ON pp.id_plan = lpp.id_plan
      LEFT JOIN realise_of ro ON ro.code_qualite = lpp.code_qualite AND ro.annee_mois = lpp.annee_mois
     WHERE pp.statut = 'EN_COURS'
     GROUP BY lpp.code_qualite
)
SELECT q.code_qualite,
       q.nom AS qualite_nom,
       q.statut,
       q.poids_commercial_m2,
       q.taux_perte_pct,
       COALESCE(c.nb_composants, 0::bigint) AS nb_composants,
       COALESCE(c.nb_roles, 0::bigint) AS nb_roles,
       COALESCE(c.nb_sans_cmup, 0::bigint) AS nb_sans_cmup,
       c.kg_m2_total,
       c.cout_matiere_m2_mad,
       CASE WHEN q.poids_commercial_m2 > 0::numeric AND c.kg_m2_total IS NOT NULL
            THEN round((c.kg_m2_total - q.poids_commercial_m2) / q.poids_commercial_m2 * 100.0, 2)
            ELSE NULL::numeric END AS ecart_poids_pct,
       COALESCE(p.m2_prevus, 0::numeric) AS m2_prevus,
       COALESCE(p.m2_realises, 0::numeric) AS m2_realises,
       COALESCE(p.nb_mois_planifies, 0::bigint) AS nb_mois_planifies,
       CASE WHEN COALESCE(p.m2_prevus, 0::numeric) > 0::numeric
            THEN round(100.0 * COALESCE(p.m2_realises, 0::numeric) / p.m2_prevus, 1)
            ELSE NULL::numeric END AS taux_realisation_pct,
       CASE WHEN c.cout_matiere_m2_mad IS NOT NULL AND COALESCE(p.m2_prevus, 0::numeric) > 0::numeric
            THEN round(c.cout_matiere_m2_mad * p.m2_prevus, 2)
            ELSE NULL::numeric END AS cout_matiere_plan_mad
  FROM qualite q
  LEFT JOIN cout c ON c.code_qualite = q.code_qualite
  LEFT JOIN production p ON p.code_qualite = q.code_qualite;
ALTER VIEW v_stat_qualite OWNER TO gestionfil;

-- Temoin
DO $$
BEGIN
    IF position('ordre_fabrication' IN pg_get_viewdef('v_stat_qualite')) = 0 THEN
        RAISE EXCEPTION '2026-11-07b : migration incomplete';
    END IF;
END $$;

COMMIT;
