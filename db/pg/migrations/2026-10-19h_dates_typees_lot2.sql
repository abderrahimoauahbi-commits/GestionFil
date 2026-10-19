-- =============================================================================
-- 2026-10-19h — Les dates en vrai type : deuxieme lot (A1, 19/10/2026)
-- =============================================================================
-- Les vingt colonnes qui ne portent QUE des dates (inventaire du 17/10) passent
-- en `date`, par l'outil de 2026-10-19g (vues, controles et declencheurs mis de
-- cote puis recrees ; les vues lisent la colonne en texte, comme avant). Un
-- horodatage egare y deviendrait le jour de Casablanca.
--
-- Quatre fonctions melaient ces dates et du texte : elles sont reecrites sur
-- place, par remplacement exact de la ligne fautive (rejouable).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';


SELECT fn_retyper_colonnes_date('archive_reception',  ARRAY['date_reception'], NULL);
SELECT fn_retyper_colonnes_date('besoin_mrp',         ARRAY['date_reference'], NULL);
SELECT fn_retyper_colonnes_date('bon_commande',       ARRAY['date_cours_engage', 'date_livraison_prevue'], NULL);
SELECT fn_retyper_colonnes_date('cours_bam',          ARRAY['date_cours'], NULL);
SELECT fn_retyper_colonnes_date('historique_prix',    ARRAY['date_achat'], NULL);
SELECT fn_retyper_colonnes_date('import_dossiers',    ARRAY['date_arrivee', 'date_dum'], NULL);
SELECT fn_retyper_colonnes_date('import_factures',    ARRAY['date_facture'], NULL);
SELECT fn_retyper_colonnes_date('import_receptions',  ARRAY['date_reception'], NULL);
SELECT fn_retyper_colonnes_date('ligne_bc',           ARRAY['date_livraison_prevue'], NULL);
SELECT fn_retyper_colonnes_date('machine_etat',       ARRAY['date_constat'], NULL);
SELECT fn_retyper_colonnes_date('machine_fiche',      ARRAY['date_constat_precedent', 'date_fiche'], NULL);
SELECT fn_retyper_colonnes_date('plan_achat',         ARRAY['date_besoin_prevue'], NULL);
SELECT fn_retyper_colonnes_date('plan_production',    ARRAY['date_debut', 'date_fin'], NULL);
SELECT fn_retyper_colonnes_date('reception',          ARRAY['date_reception'],
                                '((now() AT TIME ZONE ''Africa/Casablanca'')::date)');
SELECT fn_retyper_colonnes_date('stock_lot',          ARRAY['date_premiere_entree'],
                                '((now() AT TIME ZONE ''Africa/Casablanca'')::date)');
SELECT fn_retyper_colonnes_date('stock_magasin',      ARRAY['date_derniere_entree'], NULL);

-- Les fonctions, APRES les conversions : une fonction SQL est verifiee a sa
-- creation, contre le type que la colonne a a cet instant.
DO $$
DECLARE
    v_src text;
BEGIN
    -- Le jour du mouvement, les dates d'entree et de sortie : des `date`.
    v_src := pg_get_functiondef('fn_trg_lmvt_appliquer'::regproc);
    IF position('v_date          date;' IN v_src) = 0 THEN
        v_src := replace(v_src, 'v_date          text;', 'v_date          date;');
        v_src := replace(v_src, 'COALESCE(v_date, v_maintenant)', 'COALESCE(v_date, fn_jour_casablanca(v_maintenant))');
        EXECUTE v_src;
    END IF;
    -- Le cours BAM de fin d'annee : une date, plus un texte.
    v_src := pg_get_functiondef('fn_cours_bam_fin_annee'::regproc);
    IF position('make_date(p_annee, 12, 31)' IN v_src) = 0 THEN
        v_src := replace(v_src, 'date_cours <= p_annee::text || ''-12-31''', 'date_cours <= make_date(p_annee, 12, 31)');
        EXECUTE v_src;
    END IF;
    -- La consommation machine : la date de fiche, lue en texte pour le COALESCE.
    v_src := pg_get_functiondef('f_machine_consommation'::regproc);
    IF position('fi.date_fiche::text' IN v_src) = 0 THEN
        v_src := replace(v_src, 'COALESCE(fi.date_fiche, e.date_decision)', 'COALESCE(fi.date_fiche::text, e.date_decision)');
        EXECUTE v_src;
    END IF;
END $$;

DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type = 'date'
           AND (table_name, column_name) IN (
               ('archive_reception', 'date_reception'), ('besoin_mrp', 'date_reference'),
               ('bon_commande', 'date_cours_engage'), ('bon_commande', 'date_livraison_prevue'),
               ('cours_bam', 'date_cours'), ('historique_prix', 'date_achat'),
               ('import_dossiers', 'date_arrivee'), ('import_dossiers', 'date_dum'),
               ('import_factures', 'date_facture'), ('import_receptions', 'date_reception'),
               ('ligne_bc', 'date_livraison_prevue'), ('machine_etat', 'date_constat'),
               ('machine_fiche', 'date_constat_precedent'), ('machine_fiche', 'date_fiche'),
               ('plan_achat', 'date_besoin_prevue'), ('plan_production', 'date_debut'),
               ('plan_production', 'date_fin'), ('reception', 'date_reception'),
               ('stock_lot', 'date_premiere_entree'), ('stock_magasin', 'date_derniere_entree'))) <> 20
       OR to_regclass('public.v_controles') IS NULL THEN
        RAISE EXCEPTION '2026-10-19h : migration incomplete';
    END IF;
END $$;

COMMIT;
