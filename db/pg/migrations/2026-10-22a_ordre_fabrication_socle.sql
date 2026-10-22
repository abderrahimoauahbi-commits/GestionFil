-- =============================================================================
-- 2026-10-22a — L'OF Supply Chain : le socle (décision du 22/10/2026)
-- =============================================================================
-- docs/A-DECIDER-of-supply-chain.md. L'OF (date, qualité, métrage) PRÉVOIT le
-- besoin, ORIENTE les machines et ANALYSE la réalité : il ne déplace jamais le
-- stock. La matière est révélée par ses mouvements et ses constats datés ; l'OF
-- donne le contexte d'attribution.
--
-- Ce socle pose seulement les données ; la logique vient avec les lots suivants :
--   - `ordre_fabrication` : numéro (celui de l'ERP Production, ou interne),
--     date, fin prévue, qualité, métrage, statut ;
--   - `machine.largeur_m` : la largeur de la machine (CRM1 : 4,20 m), d'où le
--     nombre de bobines d'une voie (capacité de l'étage / largeur × voie) ;
--   - l'OF sur la fiche machine (par défaut de ses lignes), sur chaque ligne de
--     fiche et sur l'état de l'étage (l'OF que la ligne sert), avec la largeur de
--     voie (information pour le magasinier) ;
--   - sur la ligne de décision (immuable) : l'OF nouveau ET l'OF DE LA PÉRIODE —
--     celui que la ligne servait avant ce constat. L'écart mesure la période qui
--     se termine : il appartient à l'OF sortant (décision du 22/10/2026) ;
--   - l'OF sur le mouvement (consommation directe et retour des matières hors
--     machine).
-- Le `numero_of` en texte reste, pour l'historique.
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS ordre_fabrication (
    id_of                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    numero                  text NOT NULL UNIQUE,
    date_of                 date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Casablanca')::date,
    date_fin_prevue         date,
    code_qualite            text NOT NULL REFERENCES qualite(code_qualite),
    metrage_m2              numeric(14,2) NOT NULL CHECK (metrage_m2 > 0),
    statut                  text NOT NULL DEFAULT 'PREVU'
                                CHECK (statut IN ('PREVU', 'LANCE', 'CLOTURE', 'ANNULE')),
    notes                   text,
    id_utilisateur_creation text REFERENCES utilisateur(id_utilisateur),
    date_creation           timestamptz NOT NULL DEFAULT now(),
    date_cloture            timestamptz,
    version                 integer NOT NULL DEFAULT 1,
    CONSTRAINT ordre_fabrication_dates CHECK (date_fin_prevue IS NULL OR date_fin_prevue >= date_of)
);
ALTER TABLE ordre_fabrication OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_fk_ordre_fabrication_qualite ON ordre_fabrication (code_qualite);
CREATE INDEX IF NOT EXISTS ix_fk_ordre_fabrication_utilisateur ON ordre_fabrication (id_utilisateur_creation);
CREATE INDEX IF NOT EXISTS ix_ordre_fabrication_statut_date ON ordre_fabrication (statut, date_of);

DROP TRIGGER IF EXISTS trg_audit_modification ON ordre_fabrication;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON ordre_fabrication
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();
DROP TRIGGER IF EXISTS trg_aa_version ON ordre_fabrication;
CREATE TRIGGER trg_aa_version BEFORE UPDATE ON ordre_fabrication
FOR EACH ROW EXECUTE FUNCTION fn_trg_version_si_saisie();

-- La largeur de la machine.
ALTER TABLE machine ADD COLUMN IF NOT EXISTS largeur_m numeric(6,3);
ALTER TABLE machine DROP CONSTRAINT IF EXISTS machine_largeur_positive;
ALTER TABLE machine ADD CONSTRAINT machine_largeur_positive CHECK (largeur_m IS NULL OR largeur_m > 0);
UPDATE machine SET largeur_m = 4.20 WHERE code_machine = 'CRM1' AND largeur_m IS NULL;

-- L'OF et la voie sur la fiche, ses lignes, l'état de l'étage et la décision.
ALTER TABLE machine_fiche        ADD COLUMN IF NOT EXISTS id_of text REFERENCES ordre_fabrication(id_of);
ALTER TABLE machine_fiche_ligne  ADD COLUMN IF NOT EXISTS id_of text REFERENCES ordre_fabrication(id_of);
ALTER TABLE machine_fiche_ligne  ADD COLUMN IF NOT EXISTS largeur_voie_m numeric(6,3);
ALTER TABLE machine_etat         ADD COLUMN IF NOT EXISTS id_of text REFERENCES ordre_fabrication(id_of);
ALTER TABLE machine_etat         ADD COLUMN IF NOT EXISTS largeur_voie_m numeric(6,3);
ALTER TABLE machine_decision_ligne ADD COLUMN IF NOT EXISTS id_of text REFERENCES ordre_fabrication(id_of);
ALTER TABLE machine_decision_ligne ADD COLUMN IF NOT EXISTS id_of_periode text REFERENCES ordre_fabrication(id_of);
ALTER TABLE machine_decision_ligne ADD COLUMN IF NOT EXISTS largeur_voie_m numeric(6,3);
ALTER TABLE mouvement            ADD COLUMN IF NOT EXISTS id_of text REFERENCES ordre_fabrication(id_of);

ALTER TABLE machine_fiche_ligne DROP CONSTRAINT IF EXISTS machine_fiche_ligne_voie_positive;
ALTER TABLE machine_fiche_ligne ADD CONSTRAINT machine_fiche_ligne_voie_positive
    CHECK (largeur_voie_m IS NULL OR largeur_voie_m > 0);
ALTER TABLE machine_etat DROP CONSTRAINT IF EXISTS machine_etat_voie_positive;
ALTER TABLE machine_etat ADD CONSTRAINT machine_etat_voie_positive
    CHECK (largeur_voie_m IS NULL OR largeur_voie_m > 0);

CREATE INDEX IF NOT EXISTS ix_fk_machine_fiche_of ON machine_fiche (id_of);
CREATE INDEX IF NOT EXISTS ix_fk_machine_fiche_ligne_of ON machine_fiche_ligne (id_of);
CREATE INDEX IF NOT EXISTS ix_fk_machine_etat_of ON machine_etat (id_of);
CREATE INDEX IF NOT EXISTS ix_fk_machine_decision_ligne_of ON machine_decision_ligne (id_of);
CREATE INDEX IF NOT EXISTS ix_fk_machine_decision_ligne_of_periode ON machine_decision_ligne (id_of_periode);
CREATE INDEX IF NOT EXISTS ix_fk_mouvement_of ON mouvement (id_of);

-- Témoin
DO $$
BEGIN
    IF to_regclass('public.ordre_fabrication') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'machine_decision_ligne' AND column_name = 'id_of_periode')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'mouvement' AND column_name = 'id_of')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'machine' AND column_name = 'largeur_m') THEN
        RAISE EXCEPTION '2026-10-22a : migration incomplete';
    END IF;
END $$;

COMMIT;
