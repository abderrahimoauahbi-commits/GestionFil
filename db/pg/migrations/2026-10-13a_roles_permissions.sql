-- =============================================================================
-- 2026-10-13a — Administrer les rôles et leurs permissions
-- =============================================================================
-- Décisions du 13/10/2026 (page « Rôles et permissions », réservée au rôle
-- Administrateur) :
--   * on crée des rôles, on modifie leurs permissions (module × lire, écrire,
--     valider), le modèle de visibilité de leurs champs et leur plafond de
--     validation des bons ;
--   * changer le modèle d'un rôle s'applique à ses utilisateurs, SAUF aux
--     champs réglés à la main pour une personne : chaque droit d'un compte dit
--     désormais d'où il vient (`origine` : MODELE ou MANUEL) ;
--   * un rôle ne se supprime pas tant qu'un utilisateur le porte ;
--   * l'Administrateur ne perd jamais la gestion des utilisateurs, et son rôle
--     ne se supprime pas : on ne s'enferme pas dehors.
-- Et le journal : rôles et modèles de champs entrent à l'audit.
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. D'où vient le droit d'un compte
-- -----------------------------------------------------------------------------
-- Les droits déjà posés, une seule fois (à l'ajout de la colonne) : égaux au
-- modèle du rôle = venus du modèle ; sinon, réglés à la main.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'droit_champ' AND column_name = 'origine') THEN
        ALTER TABLE droit_champ ADD COLUMN origine text NOT NULL DEFAULT 'MANUEL';
        UPDATE droit_champ d
           SET origine = 'MODELE'
          FROM utilisateur u, modele_droit_champ m
         WHERE u.id_utilisateur = d.id_utilisateur
           AND m.code_role_user = u.code_role_user AND m.module = d.module AND m.champ = d.champ
           AND m.niveau = d.niveau;
    END IF;
END $$;
-- Un droit pose ensuite sans origine dite (une migration qui recopie le
-- modele) vient du modele.
ALTER TABLE droit_champ ALTER COLUMN origine SET DEFAULT 'MODELE';
ALTER TABLE droit_champ DROP CONSTRAINT IF EXISTS ck_droit_champ_origine;
ALTER TABLE droit_champ ADD CONSTRAINT ck_droit_champ_origine CHECK (origine = ANY (ARRAY['MODELE', 'MANUEL']));
COMMENT ON COLUMN droit_champ.origine IS
  'MODELE : copie du modèle du rôle, suit ses changements ; MANUEL : réglé à la main pour ce compte, n''est plus touché par le modèle.';

-- -----------------------------------------------------------------------------
-- 2. Les gardes
-- -----------------------------------------------------------------------------
-- 2a. Le rôle Administrateur ne se supprime pas ; un rôle porté ne se supprime pas.
CREATE OR REPLACE FUNCTION fn_trg_role_garde() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_n bigint;
BEGIN
    IF OLD.code_role_user = 'ADMIN' AND (TG_OP = 'DELETE' OR NEW.actif = 0) THEN
        RAISE EXCEPTION 'ROLE-ADMIN : le rôle Administrateur ne se supprime pas.' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        SELECT count(*) INTO v_n FROM utilisateur WHERE code_role_user = OLD.code_role_user;
        IF v_n > 0 THEN
            RAISE EXCEPTION 'ROLE-UTILISE : % utilisateur(s) ont le rôle « % » : réaffectez-les d''abord.',
                v_n, OLD.libelle USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.code_role_user IS DISTINCT FROM OLD.code_role_user THEN
        RAISE EXCEPTION 'ROLE-CODE : le code d''un rôle ne change pas.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_role_garde() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_role_garde ON role_utilisateur;
CREATE TRIGGER trg_role_garde BEFORE UPDATE OR DELETE ON role_utilisateur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_role_garde();

-- 2b. L'Administrateur garde la gestion des utilisateurs (lire, écrire, valider).
CREATE OR REPLACE FUNCTION fn_trg_permission_admin() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.code_role_user = 'ADMIN' AND OLD.module = 'UTILISATEURS'
       AND (TG_OP = 'DELETE' OR NEW.actif = 0 OR NEW.module <> 'UTILISATEURS' OR NEW.action <> OLD.action) THEN
        RAISE EXCEPTION 'ROLE-ADMIN : l''Administrateur garde la gestion des utilisateurs, sinon personne ne pourrait plus rien régler.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_permission_admin() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_permission_admin ON permission;
CREATE TRIGGER trg_permission_admin BEFORE UPDATE OR DELETE ON permission
    FOR EACH ROW EXECUTE FUNCTION fn_trg_permission_admin();

-- Les trois droits de l'Administrateur sur les utilisateurs existent.
INSERT INTO permission (code_role_user, module, action)
SELECT 'ADMIN', 'UTILISATEURS', a.action
  FROM (VALUES ('LIRE'), ('ECRIRE'), ('VALIDER')) a(action)
 WHERE EXISTS (SELECT 1 FROM role_utilisateur WHERE code_role_user = 'ADMIN')
ON CONFLICT (code_role_user, module, action) DO UPDATE SET actif = 1;

-- -----------------------------------------------------------------------------
-- 3. Les colonnes de la machine a etats, jamais declarees
-- -----------------------------------------------------------------------------
-- Le tableau des transitions (Parametres > Roles et permissions) n'affichait
-- « aucune colonne visible » : un champ non declare est masque.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'PARAMETRES', c.champ, c.libelle, 'LECTURE', 0, 990
  FROM (VALUES ('entite', 'Entité'),
               ('statut_source', 'Statut de départ'),
               ('statut_cible', 'Statut d''arrivée'),
               ('role_requis', 'Rôle requis'),
               ('description', 'Description')) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. L'audit
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_modification ON role_utilisateur;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON role_utilisateur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();
DROP TRIGGER IF EXISTS trg_audit_modification ON modele_droit_champ;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON modele_droit_champ
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

COMMIT;
