-- =============================================================================
-- 2026-10-08h — Planification : l'en-cours complet, l'horizon prolonge
-- (audit v4, P2 action 16)
-- =============================================================================
-- 1. UNE COMMANDE EN RETARD RESTE EN COURS. Au-dela de P_RetardBCJours, la
--    ligne de bon sortait de l'en-cours : le besoin etait repropose, et la
--    marchandise arrivait deux fois. Elle reste comptee (P_EncoursRetardInclus,
--    1 par defaut) ; le retard se lit a part (encours_retarde_kg) pour relancer.
-- 2. LA MARCHANDISE AU PORT EST UN EN-COURS. Les lignes d'un dossier d'import
--    ouvert qui ne viennent d'aucun bon (achat libre) n'etaient comptees nulle
--    part avant leur reception : 15 lignes, 38,9 t sur la copie. Celles qui
--    viennent d'un bon sont deja comptees par lui.
-- 3. L'HORIZON NE S'ARRETE PLUS A LA FIN DU PLAN. Au-dela du dernier mois du
--    plan en service, la demande etait nulle : un delai de 90 jours en
--    decembre ne voyait rien de janvier. Elle se prolonge a la moyenne
--    mensuelle du plan (P_HorizonProlonge, 1 par defaut).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_EncoursRetardInclus', 'Compter les commandes en retard dans l''en-cours', '1', 'ENTIER', NULL,
   '1 : une ligne de bon en retard reste comptee dans l''en-cours (le retard se relance) ; 0 : elle en sort et le besoin est repropose.',
   'STOCK', 'DIRECTION'),
  ('P_HorizonProlonge', 'Prolonger la demande au-dela du plan', '1', 'ENTIER', NULL,
   '1 : au-dela du dernier mois du plan en service, la demande se prolonge a la moyenne mensuelle du plan ; 0 : elle est nulle.',
   'STOCK', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

CREATE OR REPLACE VIEW v_encours_fiable AS
 WITH p_ret AS (
         SELECT (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_RetardBCJours') AS v,
                COALESCE((SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_EncoursRetardInclus'), '1') = '1' AS inclure
        ), bons AS (
         SELECT lb.code_reference,
            lb.quantite_restante_kg AS kg,
            substr(lb.date_livraison_prevue, 1, 10) < to_char(CURRENT_DATE - p_ret.v::integer, 'YYYY-MM-DD') AS en_retard,
            lb.date_livraison_prevue
           FROM ligne_bc lb
             JOIN bon_commande bc ON bc.id_bc = lb.id_bc
             CROSS JOIN p_ret
          WHERE bc.statut = ANY (ARRAY['VALIDE', 'ENVOYE', 'LIVRE_PARTIEL'])
            AND lb.statut <> ALL (ARRAY['ANNULE', 'SOLDE'])
            AND lb.type_ligne = 'MARCHANDISE' AND lb.quantite_restante_kg > 0
        ), port AS (
         -- Les achats d'import sans bon, factures et pas encore recus.
         SELECT fl.code_reference, sum(fl.reste_kg) AS kg
           FROM import_facture_lignes fl
             JOIN import_factures f ON f.id_facture = fl.id_facture
             JOIN import_dossiers d ON d.id_dossier = f.id_dossier
          WHERE d.statut <> 'CLOTURE' AND fl.type_ligne = 'ERP' AND fl.soldee = 0
            AND fl.id_ligne_bc IS NULL AND fl.reste_kg > 0
          GROUP BY fl.code_reference
        ), refs AS (
         SELECT code_reference FROM bons UNION SELECT code_reference FROM port
        )
 SELECT r.code_reference,
    round(COALESCE((SELECT sum(b.kg) FROM bons b CROSS JOIN p_ret
                     WHERE b.code_reference = r.code_reference
                       AND (NOT COALESCE(b.en_retard, false) OR p_ret.inclure)), 0)
          + COALESCE((SELECT po.kg FROM port po WHERE po.code_reference = r.code_reference), 0), 4) AS encours_fiable_kg,
    round(COALESCE((SELECT sum(b.kg) FROM bons b WHERE b.code_reference = r.code_reference AND b.en_retard), 0), 4) AS encours_retarde_kg,
    (SELECT count(*) FROM bons b WHERE b.code_reference = r.code_reference AND b.en_retard) AS nb_lignes_retardees,
    (SELECT min(b.date_livraison_prevue) FROM bons b WHERE b.code_reference = r.code_reference AND b.en_retard) AS plus_ancien_retard,
    (SELECT max(CURRENT_DATE - b.date_livraison_prevue::date)::bigint FROM bons b
      WHERE b.code_reference = r.code_reference AND b.en_retard) AS retard_max_jours,
    round(COALESCE((SELECT po.kg FROM port po WHERE po.code_reference = r.code_reference), 0), 4) AS encours_import_kg
   FROM refs r;
ALTER VIEW v_encours_fiable OWNER TO gestionfil;

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
         SELECT code_reference, annee_mois, quantite_kg FROM besoin_plan
         UNION ALL
         -- Au-dela du plan : la moyenne mensuelle du plan, mois par mois.
         SELECT b.code_reference, m.annee_mois, sum(b.quantite_kg) / NULLIF(e.nb, 0)
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
    round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.fin_j, w.lead_j + w.couv_j) - GREATEST(m.debut_j, w.lead_j)) / 30.0), 0::numeric), 4) AS sorties_prevues_kg
   FROM fenetre w
     CROSS JOIN mois m
     LEFT JOIN besoin bm ON bm.code_reference = w.code_reference AND bm.annee_mois = m.annee_mois
  GROUP BY w.code_reference, w.lead_j, w.couv_j;
ALTER VIEW v_besoin_horizon OWNER TO gestionfil;

COMMIT;
