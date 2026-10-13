-- =============================================================================
-- 2026-10-13c — Audit de sécurité du 13/10/2026 : ce qui se garantit en base
-- =============================================================================
-- Décisions du 13/10/2026 (audit de sécurité, points 3 à 9 et 13) :
--   * les SESSIONS sont tenues par le serveur : la déconnexion révoque le
--     jeton, le verrou d'inactivité tient même après un rechargement (F5) ;
--   * la DOUBLE AUTHENTIFICATION est obligatoire pour l'Administrateur et la
--     Direction (réglable par rôle) ;
--   * seul l'Administrateur attribue le rôle Administrateur ou touche à un
--     compte administrateur ; personne ne change son propre rôle ;
--   * les prix suggérés et les budgets se masquent comme les autres montants.
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. Les sessions ouvertes
-- -----------------------------------------------------------------------------
-- Une ligne par connexion réussie (le `sid` du jeton). Un jeton sans ligne,
-- révoqué ou expiré est refusé ; une session verrouillée ne sert plus qu'à se
-- déverrouiller.
CREATE TABLE IF NOT EXISTS session_ouverte (
    sid             text PRIMARY KEY,
    id_utilisateur  text NOT NULL REFERENCES utilisateur(id_utilisateur),
    ouverte_le      text NOT NULL,
    expire_le       bigint NOT NULL,
    adresse_ip      text,
    revoquee_le     text,
    verrouillee_le  text
);
ALTER TABLE session_ouverte OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_session_ouverte_utilisateur ON session_ouverte(id_utilisateur);
COMMENT ON TABLE session_ouverte IS
  'Sessions de connexion (13/10/2026) : révoquées à la déconnexion, verrouillées par le verrou d''inactivité.';

-- -----------------------------------------------------------------------------
-- 2. La double authentification exigée par rôle
-- -----------------------------------------------------------------------------
ALTER TABLE role_utilisateur ADD COLUMN IF NOT EXISTS exige_totp smallint NOT NULL DEFAULT 0;
ALTER TABLE role_utilisateur DROP CONSTRAINT IF EXISTS ck_role_exige_totp;
ALTER TABLE role_utilisateur ADD CONSTRAINT ck_role_exige_totp CHECK (exige_totp IN (0, 1));
-- Décision du 13/10/2026 : Administrateur et Direction. Posé une fois : un
-- réglage changé ensuite depuis la page des rôles n'est pas écrasé au rejeu.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM migration_appliquee WHERE fichier = '2026-10-13c_securite.sql') THEN
        UPDATE role_utilisateur SET exige_totp = 1 WHERE code_role_user IN ('ADMIN', 'DIRECTION');
    END IF;
EXCEPTION WHEN undefined_table THEN
    UPDATE role_utilisateur SET exige_totp = 1 WHERE code_role_user IN ('ADMIN', 'DIRECTION');
END $$;

-- -----------------------------------------------------------------------------
-- 3. Le rôle Administrateur ne s'attribue que par un administrateur
-- -----------------------------------------------------------------------------
-- Sans contexte (outil d'administration, migration), rien n'est refusé : ce
-- sont des gestes d'exploitant sur le serveur.
CREATE OR REPLACE FUNCTION fn_trg_utilisateur_garde_role() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_user text := NULLIF(current_setting('gestionfil.id_utilisateur', true), '');
    v_role text;
BEGIN
    IF v_user IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT code_role_user INTO v_role FROM utilisateur WHERE id_utilisateur = v_user;
    IF TG_OP = 'UPDATE' AND NEW.id_utilisateur = v_user
       AND NEW.code_role_user IS DISTINCT FROM OLD.code_role_user THEN
        RAISE EXCEPTION 'UTIL-PROPRE-ROLE : on ne change pas son propre rôle.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_role IS DISTINCT FROM 'ADMIN'
       AND (NEW.code_role_user = 'ADMIN'
            OR (TG_OP = 'UPDATE' AND OLD.code_role_user = 'ADMIN')) THEN
        RAISE EXCEPTION 'UTIL-ADMIN : seul un administrateur attribue le rôle Administrateur ou modifie un compte administrateur.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_utilisateur_garde_role() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_utilisateur_garde_role ON utilisateur;
CREATE TRIGGER trg_utilisateur_garde_role BEFORE INSERT OR UPDATE ON utilisateur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_utilisateur_garde_role();

-- -----------------------------------------------------------------------------
-- 4. Les montants qui passaient sans masque
-- -----------------------------------------------------------------------------
-- Prix suggérés à la saisie d'un bon (souvent le CMUP) : au niveau du prix
-- unitaire du bon. Budget du plan d'achat : au niveau du montant estimé.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES ('BONS_COMMANDE', 'prix_mad_suggere',    'Prix suggéré (DH/kg)',         'LECTURE', 1, 995),
       ('BONS_COMMANDE', 'prix_suggere_devise', 'Prix suggéré (devise)',        'LECTURE', 1, 996),
       ('PLAN_ACHAT',    'budget_mad',          'Budget estimé (DH)',           'LECTURE', 1, 995),
       ('PLAN_ACHAT',    'budget_total_mad',    'Budget total estimé (DH)',     'LECTURE', 1, 996)
ON CONFLICT DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, n.module, n.champ, m.niveau
  FROM (VALUES ('BONS_COMMANDE', 'prix_mad_suggere',    'prix_unitaire_devise'),
               ('BONS_COMMANDE', 'prix_suggere_devise', 'prix_unitaire_devise'),
               ('PLAN_ACHAT',    'budget_mad',          'montant_estime_mad'),
               ('PLAN_ACHAT',    'budget_total_mad',    'montant_estime_mad')) n(module, champ, modele)
  JOIN modele_droit_champ m ON m.module = n.module AND m.champ = n.modele
ON CONFLICT DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, origine)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau, 'MODELE'
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE (m.module, m.champ) IN (('BONS_COMMANDE', 'prix_mad_suggere'), ('BONS_COMMANDE', 'prix_suggere_devise'),
                               ('PLAN_ACHAT', 'budget_mad'), ('PLAN_ACHAT', 'budget_total_mad'))
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Les types de mouvement passent sous Paramètres
-- -----------------------------------------------------------------------------
-- Décision du 13/10/2026 : le signe, l'effet sur le CMUP ou le prix exigé d'un
-- type ne se règlent plus avec le droit d'écrire des mouvements (magasinier),
-- mais avec celui des Paramètres. Leurs colonnes se déclarent sous ce module,
-- aux mêmes niveaux qu'avant.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'PARAMETRES', cc.champ, cc.libelle, cc.niveau_defaut, cc.sensible, 900 + cc.ordre
  FROM champ_configurable cc
 WHERE cc.module = 'MOUVEMENTS'
   AND cc.champ IN ('code_type_mvt', 'signe', 'exige_prix', 'impacte_cmup', 'exige_of',
                    'exige_motif_ligne', 'couleur', 'nb_mouvements')
ON CONFLICT DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'PARAMETRES', m.champ, m.niveau
  FROM modele_droit_champ m
 WHERE m.module = 'MOUVEMENTS'
   AND m.champ IN ('code_type_mvt', 'signe', 'exige_prix', 'impacte_cmup', 'exige_of',
                   'exige_motif_ligne', 'couleur', 'nb_mouvements')
ON CONFLICT DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, origine)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau, 'MODELE'
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'PARAMETRES'
   AND m.champ IN ('code_type_mvt', 'signe', 'exige_prix', 'impacte_cmup', 'exige_of',
                   'exige_motif_ligne', 'couleur', 'nb_mouvements')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. L'adresse de la plateforme d'assistance ne se règle plus à l'écran
-- -----------------------------------------------------------------------------
UPDATE parametre
   SET description = 'Ignoré depuis le 13/10/2026 : l''adresse de la plateforme se règle dans le .env du serveur (GESTIONAI_URL).'
 WHERE code_parametre = 'P_AssistantPlateforme';

COMMIT;
