-- =============================================================================
-- 2026-10-19i — Les dates en vrai type : troisieme lot (A1, 19/10/2026)
-- =============================================================================
-- Les colonnes VIDES (inventaire du 17/10, verifie dans la base de saisie le
-- 19/10) qui designent un JOUR passent en `date`, par l'outil de 2026-10-19g :
-- peremption et fabrication (mouvement, reception, lot), prix catalogue, retour,
-- facture fournisseur, frais d'approche, engagement d'import, paiement,
-- transfert, valorisation, constat de consommation machine.
--
-- Les colonnes vides qui designent un INSTANT (date_creation, date_validation,
-- date_cloture…) attendent le lot des horodatages, en `timestamptz`.
-- reference_groupe_equiv.date_fin aussi : elle se compare a date_debut, un
-- horodatage, et passera avec lui.
-- date_frais et date_transfert gardent un defaut : le jour de Casablanca.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

SELECT fn_retyper_colonnes_date('ligne_mouvement',         ARRAY['date_fabrication', 'date_peremption'], NULL);
SELECT fn_retyper_colonnes_date('ligne_reception',         ARRAY['date_fabrication', 'date_peremption'], NULL);
SELECT fn_retyper_colonnes_date('stock_lot',               ARRAY['date_fabrication', 'date_peremption'], NULL);
SELECT fn_retyper_colonnes_date('reference',               ARRAY['date_prix_catalogue'], NULL);
SELECT fn_retyper_colonnes_date('retour_fournisseur',      ARRAY['date_retour'], NULL);
SELECT fn_retyper_colonnes_date('facture_fournisseur',     ARRAY['date_facture'], NULL);
SELECT fn_retyper_colonnes_date('frais_approche',          ARRAY['date_frais'],
                                '(now() AT TIME ZONE ''Africa/Casablanca'')::date');
SELECT fn_retyper_colonnes_date('import_engagements',      ARRAY['date_ei'], NULL);
SELECT fn_retyper_colonnes_date('paiement_facture_import', ARRAY['date_paiement'], NULL);
SELECT fn_retyper_colonnes_date('transfert',               ARRAY['date_transfert'],
                                '(now() AT TIME ZONE ''Africa/Casablanca'')::date');
SELECT fn_retyper_colonnes_date('valorisation_stock',      ARRAY['date_valorisation'], NULL);
SELECT fn_retyper_colonnes_date('machine_consommation',    ARRAY['date_constat', 'date_constat_precedent'], NULL);

DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type = 'date'
           AND (table_name, column_name) IN (
               ('ligne_mouvement', 'date_fabrication'), ('ligne_mouvement', 'date_peremption'),
               ('ligne_reception', 'date_fabrication'), ('ligne_reception', 'date_peremption'),
               ('stock_lot', 'date_fabrication'), ('stock_lot', 'date_peremption'),
               ('reference', 'date_prix_catalogue'), ('retour_fournisseur', 'date_retour'),
               ('facture_fournisseur', 'date_facture'), ('frais_approche', 'date_frais'),
               ('import_engagements', 'date_ei'), ('paiement_facture_import', 'date_paiement'),
               ('transfert', 'date_transfert'), ('valorisation_stock', 'date_valorisation'),
               ('machine_consommation', 'date_constat'),
               ('machine_consommation', 'date_constat_precedent'))) <> 16
       OR to_regclass('public.v_controles') IS NULL THEN
        RAISE EXCEPTION '2026-10-19i : migration incomplete';
    END IF;
END $$;

COMMIT;
