-- =============================================================================
-- 2026-10-10e — Le plan d'achat suit le plan de production, et lui seul
-- =============================================================================
-- Decision de l'utilisateur (10/10/2026) : « le plan d'achat suit seulement les
-- plans de production, pas de stock minimum ». Le service achats ne planifie
-- pas d'achat hors besoin de production.
--
-- AVANT : besoin = le plus grand de (sorties de la fenetre + securite - residuel)
--         et (minimum du catalogue - residuel).
-- APRES : besoin = sorties de la fenetre + securite - residuel, rien d'autre.
-- La colonne stock_min_catalogue_kg reste exposee (lecture seule, pour
-- information) : les ecrans et vues qui la lisent ne cassent pas.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    def   text;
    avant text := 'GREATEST((0)::numeric, round(((c.sorties_fenetre_kg + c.securite_kg) - c.residuel_kg), 4), round((c.stock_min_catalogue_kg - c.residuel_kg), 4)) AS besoin_net_kg';
    apres text := 'GREATEST((0)::numeric, round(((c.sorties_fenetre_kg + c.securite_kg) - c.residuel_kg), 4)) AS besoin_net_kg';
BEGIN
    def := pg_get_viewdef('v_plan_achat'::regclass);
    IF position(apres IN def) > 0 THEN
        RETURN;
    END IF;
    IF position(avant IN def) = 0 THEN
        RAISE EXCEPTION 'v_plan_achat : l''expression du besoin est introuvable, la vue a change';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW v_plan_achat AS ' || rtrim(rtrim(replace(def, avant, apres)), ';');
END $$;

COMMIT;
