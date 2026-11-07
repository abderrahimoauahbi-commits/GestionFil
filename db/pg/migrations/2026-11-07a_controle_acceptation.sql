-- =============================================================================
-- 2026-11-07a — L'acquittement d'une anomalie de controle
-- =============================================================================
-- Revue des 22 domaines, point 4 (arbitrage du 06/11/2026, mis en oeuvre le
-- 07/11/2026) : une anomalie d'un controle ATTENTION ou CRITIQUE peut etre
-- ACQUITTEE — « vue, comprise, on la laisse » —, jamais celle d'un BLOQUANT ;
-- par le droit VALIDER du module des controles (COCKPIT) ; l'acquittement vaut
-- tant que l'anomalie existe : disparue, il est leve.
--
-- UNE ANOMALIE = UNE LIGNE DU DETAIL DU CONTROLE, reconnue par son empreinte
-- (md5 de la ligne en jsonb, calculee par le serveur). Une ligne qui change
-- (une quantite, une date) est une autre anomalie : elle se represente.
--
-- L'acquittement ne s'efface pas : il se LEVE (date_levee, motif_levee
-- DISPARUE quand l'anomalie n'existe plus, RETIREE quand une personne le
-- retire). La table `alerte` n'est pas touchee (decision du 06/11 : pas de
-- suppression avant preuve).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS controle_acceptation (
    id_acceptation      text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code_controle       text NOT NULL CHECK (code_controle ~ '^C[0-9]{2}$'),
    -- JAMAIS UN BLOQUANT : une incoherence qui ne devrait pas exister ne s'acquitte pas.
    criticite           text NOT NULL CHECK (criticite IN ('ATTENTION', 'CRITIQUE')),
    empreinte           text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{32}$'),
    anomalie            jsonb NOT NULL,
    motif               text NOT NULL CHECK (length(btrim(motif)) >= 3),
    id_utilisateur      text NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_acceptation    timestamptz NOT NULL DEFAULT now(),
    date_levee          timestamptz,
    motif_levee         text CHECK (motif_levee IN ('DISPARUE', 'RETIREE')),
    id_utilisateur_levee text REFERENCES utilisateur(id_utilisateur),
    CHECK ((date_levee IS NULL) = (motif_levee IS NULL))
);
ALTER TABLE controle_acceptation OWNER TO gestionfil;
COMMENT ON TABLE controle_acceptation IS
  'Acquittement d''une anomalie de controle ATTENTION / CRITIQUE (07/11/2026) : valable tant que l''anomalie existe.';

-- Une anomalie n'a qu'un acquittement en cours.
CREATE UNIQUE INDEX IF NOT EXISTS ux_controle_acceptation_en_cours
    ON controle_acceptation (code_controle, empreinte) WHERE date_levee IS NULL;
CREATE INDEX IF NOT EXISTS ix_fk_controle_acceptation_utilisateur ON controle_acceptation (id_utilisateur);
CREATE INDEX IF NOT EXISTS ix_fk_controle_acceptation_levee ON controle_acceptation (id_utilisateur_levee);

-- L'ACQUITTEMENT EST UNE TRACE : il ne se supprime pas, et seule sa levee s'ecrit,
-- une fois.
CREATE OR REPLACE FUNCTION fn_trg_controle_acceptation_fige() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ACQUIT-FIGE : un acquittement ne se supprime pas, il se leve.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.date_levee IS NOT NULL THEN
        RAISE EXCEPTION 'ACQUIT-FIGE : cet acquittement est deja leve.' USING ERRCODE = 'check_violation';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['date_levee', 'motif_levee', 'id_utilisateur_levee'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['date_levee', 'motif_levee', 'id_utilisateur_levee']) THEN
        RAISE EXCEPTION 'ACQUIT-FIGE : un acquittement ne se modifie pas ; seule sa levee s''ecrit.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_controle_acceptation_fige() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_controle_acceptation_fige ON controle_acceptation;
CREATE TRIGGER trg_controle_acceptation_fige BEFORE UPDATE OR DELETE ON controle_acceptation
FOR EACH ROW EXECUTE FUNCTION fn_trg_controle_acceptation_fige();

DROP TRIGGER IF EXISTS trg_audit_modification ON controle_acceptation;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON controle_acceptation
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- Les champs que l'ecran des controles lit (un champ non declare est masque).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'COCKPIT', c.champ, c.libelle, 'LECTURE', 0, 997
  FROM (VALUES ('acquittees',          'Anomalies acquittées'),
               ('empreinte_anomalie',  'Empreinte de l''anomalie'),
               ('id_acceptation',      'Acquittement'),
               ('motif_acceptation',   'Motif de l''acquittement'),
               ('acquittee_par',       'Acquittée par'),
               ('date_acceptation',    'Acquittée le')) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- Temoin
DO $$
BEGIN
    IF to_regclass('public.controle_acceptation') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_controle_acceptation_fige') THEN
        RAISE EXCEPTION '2026-11-07a : migration incomplete';
    END IF;
END $$;

COMMIT;
