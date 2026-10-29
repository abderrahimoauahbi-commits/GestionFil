-- =============================================================================
-- 2026-10-21a — Les indicateurs du plan d'achat, calcules a la generation
-- =============================================================================
-- L'en-tete du plan d'achat (references en alerte, budget, paliers, risques,
-- fournisseurs) se recalculait a CHAQUE ouverture : toute la projection de stock,
-- 4 a 7 s mesurees le 21/10/2026. Il se calcule desormais a la generation du
-- plan et s'enregistre ici ; l'ecran lit le dernier, avec sa date.
-- Une table de journal : on ajoute, on ne modifie pas.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS plan_achat_indicateurs (
    id             bigserial PRIMARY KEY,
    date_calcul    timestamptz NOT NULL DEFAULT now(),
    valeurs        jsonb NOT NULL,
    id_utilisateur text REFERENCES utilisateur(id_utilisateur)
);
ALTER TABLE plan_achat_indicateurs OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_fk_plan_achat_indicateurs_utilisateur
    ON plan_achat_indicateurs (id_utilisateur);

-- Temoin
DO $$
BEGIN
    IF to_regclass('public.plan_achat_indicateurs') IS NULL THEN
        RAISE EXCEPTION '2026-10-21a : migration incomplete';
    END IF;
END $$;

COMMIT;
