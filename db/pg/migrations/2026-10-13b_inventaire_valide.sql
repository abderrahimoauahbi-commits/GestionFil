-- =============================================================================
-- 2026-10-13b — L'inventaire comme un bon : Brouillon → Validé → Clôturé
-- =============================================================================
-- Décisions du 13/10/2026 :
--   * BROUILLON : l'inventaire est créé, ses lignes préparées d'emblée (la
--     photo du stock), le magasinier compte et corrige ;
--   * VALIDÉ : un AUTRE compte que ceux qui ont compté (droit Valider ;
--     l'Administrateur dispensé) fige le comptage — rien n'a encore touché le
--     stock ; « Renvoyer au comptage » le remet en brouillon, avec un motif ;
--   * CLÔTURÉ : droit Valider, les écarts passent au stock (comme avant).
-- L'ancien état EN_COURS (comptage commencé) devient BROUILLON. Un seul
-- inventaire ouvert (brouillon ou validé) par magasin.
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. Qui a validé, et le dernier renvoi au comptage
-- -----------------------------------------------------------------------------
ALTER TABLE inventaire ADD COLUMN IF NOT EXISTS id_utilisateur_validation text REFERENCES utilisateur(id_utilisateur);
ALTER TABLE inventaire ADD COLUMN IF NOT EXISTS date_validation text;
ALTER TABLE inventaire ADD COLUMN IF NOT EXISTS motif_renvoi text;
CREATE INDEX IF NOT EXISTS ix_inventaire_id_utilisateur_validation ON inventaire(id_utilisateur_validation);

-- -----------------------------------------------------------------------------
-- 2. Les états : EN_COURS devient BROUILLON, VALIDE arrive
-- -----------------------------------------------------------------------------
ALTER TABLE inventaire DROP CONSTRAINT IF EXISTS inventaire_statut_check;
ALTER TABLE inventaire ADD CONSTRAINT inventaire_statut_check
    CHECK (statut = ANY (ARRAY['BROUILLON', 'EN_COURS', 'VALIDE', 'CLOTURE', 'ANNULE']));

DROP INDEX IF EXISTS ux_inventaire_en_cours;
INSERT INTO transition_statut (entite, statut_source, statut_cible, role_requis, description)
VALUES ('inventaire', 'EN_COURS', 'BROUILLON', NULL, 'Migration du 13/10/2026')
ON CONFLICT DO NOTHING;
UPDATE inventaire SET statut = 'BROUILLON' WHERE statut = 'EN_COURS';

ALTER TABLE inventaire DROP CONSTRAINT inventaire_statut_check;
ALTER TABLE inventaire ADD CONSTRAINT inventaire_statut_check
    CHECK (statut = ANY (ARRAY['BROUILLON', 'VALIDE', 'CLOTURE', 'ANNULE']));

DELETE FROM transition_statut WHERE entite = 'inventaire';
INSERT INTO transition_statut (entite, statut_source, statut_cible, role_requis, description) VALUES
    ('inventaire', 'BROUILLON', 'VALIDE',    'DIRECTION', 'Validation du comptage, par un autre compte que ceux qui ont compté'),
    ('inventaire', 'BROUILLON', 'ANNULE',    'DIRECTION', 'Abandon du comptage'),
    ('inventaire', 'VALIDE',    'BROUILLON', 'DIRECTION', 'Renvoi au comptage, avec un motif'),
    ('inventaire', 'VALIDE',    'CLOTURE',   'DIRECTION', 'Clôture : génère les ajustements'),
    ('inventaire', 'VALIDE',    'ANNULE',    'DIRECTION', 'Abandon du comptage validé'),
    ('inventaire', 'CLOTURE',   'VALIDE',    'DIRECTION', 'Dévalidation, après contre-passation des ajustements')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Un seul inventaire ouvert par magasin
-- -----------------------------------------------------------------------------
-- L'index ne se pose que si la base n'a pas déjà deux inventaires ouverts sur
-- un magasin (C44 les signale) ; la migration se rejoue après l'annulation du
-- doublon.
DO $$
DECLARE
    doublons text;
BEGIN
    SELECT string_agg(code_magasin || ' (' || nums || ')', ', ') INTO doublons
      FROM (SELECT code_magasin, string_agg(numero_inventaire, ', ' ORDER BY numero_inventaire) AS nums
              FROM inventaire WHERE statut IN ('BROUILLON', 'VALIDE')
             GROUP BY code_magasin HAVING count(*) > 1) d;
    IF doublons IS NULL THEN
        CREATE UNIQUE INDEX IF NOT EXISTS ux_inventaire_ouvert
            ON inventaire(code_magasin) WHERE statut IN ('BROUILLON', 'VALIDE');
    ELSE
        RAISE NOTICE 'ux_inventaire_ouvert NON créé : plusieurs inventaires ouverts (%) — annulez le doublon puis rejouez cette migration.', doublons;
    END IF;
END $$;

CREATE OR REPLACE VIEW v_ctl_c44 AS
SELECT code_magasin,
       count(*) AS nb_en_cours,
       string_agg(numero_inventaire, ', ' ORDER BY numero_inventaire) AS inventaires
  FROM inventaire
 WHERE statut IN ('BROUILLON', 'VALIDE')
 GROUP BY code_magasin
HAVING count(*) > 1;
ALTER VIEW v_ctl_c44 OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 4. Celui qui a compté ne valide pas (l'Administrateur dispensé)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_inventaire_separation() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_user text := NULLIF(current_setting('gestionfil.id_utilisateur', true), '');
    v_role text;
BEGIN
    IF NEW.statut = 'VALIDE' AND OLD.statut = 'BROUILLON' AND v_user IS NOT NULL THEN
        SELECT code_role_user INTO v_role FROM utilisateur WHERE id_utilisateur = v_user;
        IF v_role IS DISTINCT FROM 'ADMIN' AND EXISTS (
               SELECT 1 FROM ligne_inventaire
                WHERE id_inventaire = NEW.id_inventaire AND id_utilisateur_comptage = v_user) THEN
            RAISE EXCEPTION 'INV-SEPARATION : vous avez compté des lignes de l''inventaire % : sa validation revient à un autre compte.',
                NEW.numero_inventaire USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_inventaire_separation() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_inventaire_separation ON inventaire;
CREATE TRIGGER trg_inventaire_separation BEFORE UPDATE OF statut ON inventaire
    FOR EACH ROW EXECUTE FUNCTION fn_trg_inventaire_separation();

-- -----------------------------------------------------------------------------
-- 5. Le comptage ne bouge plus hors du brouillon
-- -----------------------------------------------------------------------------
-- Une ligne se compte, s'ajoute ou se retire seulement sur un inventaire en
-- brouillon. La clôture, qui ne touche que les colonnes de l'écart et du
-- statut de ligne, passe sur un inventaire validé.
CREATE OR REPLACE FUNCTION fn_trg_ligne_inventaire_fige() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_statut text;
BEGIN
    SELECT statut INTO v_statut FROM inventaire WHERE id_inventaire = COALESCE(NEW.id_inventaire, OLD.id_inventaire);
    IF v_statut = 'BROUILLON' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'UPDATE' AND v_statut = 'VALIDE'
       AND NEW.quantite_comptee_kg IS NOT DISTINCT FROM OLD.quantite_comptee_kg
       AND NEW.nb_bobines_comptees IS NOT DISTINCT FROM OLD.nb_bobines_comptees
       AND NEW.nb_palettes_comptees IS NOT DISTINCT FROM OLD.nb_palettes_comptees
       AND NEW.motif_ecart IS NOT DISTINCT FROM OLD.motif_ecart
       AND NEW.code_reference = OLD.code_reference
       AND NEW.lot_fournisseur IS NOT DISTINCT FROM OLD.lot_fournisseur THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'INV-FIGE : l''inventaire est %, son comptage ne se modifie plus (renvoyez-le au comptage s''il est validé).',
        lower(COALESCE(v_statut, 'introuvable')) USING ERRCODE = 'check_violation';
END;
$$;
ALTER FUNCTION fn_trg_ligne_inventaire_fige() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_ligne_inventaire_fige ON ligne_inventaire;
CREATE TRIGGER trg_ligne_inventaire_fige BEFORE INSERT OR UPDATE OR DELETE ON ligne_inventaire
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_inventaire_fige();

-- -----------------------------------------------------------------------------
-- 6. Les colonnes nouvelles se déclarent (sinon masquées)
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'INVENTAIRE', c.champ, c.libelle, 'LECTURE', 0, 990
  FROM (VALUES ('valide_par', 'Validé par'),
               ('date_validation', 'Date de validation'),
               ('motif_renvoi', 'Motif du renvoi au comptage')) c(champ, libelle)
ON CONFLICT DO NOTHING;

COMMIT;
