-- =============================================================================
-- 2026-10-09o — Plan d'achat : libelles justes, brouillons d'import hors en-cours
-- (audit v5, F16 et U8, valides le 09/10/2026)
-- =============================================================================
--   * C28 disait « retiree du calcul de couverture » : c'est faux tant que
--     P_EncoursRetardInclus vaut 1 (la commande en retard reste comptee). Le
--     libelle suit desormais le reglage.
--   * Un dossier d'import en BROUILLON n'engage rien : sa marchandise « au port »
--     ne compte plus dans l'en-cours (v_encours_fiable).
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    def text;
    ancien constant text := '''Commande en retard, retiree du calcul de couverture''::text';
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position(ancien IN def) > 0 THEN
        def := replace(rtrim(rtrim(def), ';'), ancien,
            '(CASE WHEN COALESCE((SELECT valeur_courante FROM parametre WHERE code_parametre = ''P_EncoursRetardInclus''), ''1'') = ''1'''
            || ' THEN ''Commande en retard, toujours comptee dans la couverture'''
            || ' ELSE ''Commande en retard, retiree du calcul de couverture'' END)');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def;
    END IF;

    def := pg_get_viewdef('v_encours_fiable'::regclass);
    IF position('''BROUILLON''' IN def) = 0 THEN
        IF position('d.statut <> ''CLOTURE''::text' IN def) = 0 THEN
            RAISE EXCEPTION 'v_encours_fiable : la condition sur le statut du dossier a change, migration a revoir';
        END IF;
        def := replace(rtrim(rtrim(def), ';'), 'd.statut <> ''CLOTURE''::text',
                       '(d.statut <> ALL (ARRAY[''CLOTURE''::text, ''BROUILLON''::text]))');
        EXECUTE 'CREATE OR REPLACE VIEW v_encours_fiable AS ' || def;
    END IF;
END $$;

COMMIT;
