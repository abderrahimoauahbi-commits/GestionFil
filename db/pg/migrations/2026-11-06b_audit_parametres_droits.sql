-- =============================================================================
-- 2026-11-06b — Ce qui changeait sans trace, et la grille de la Direction
-- =============================================================================
-- Revue des 22 domaines (06/11/2026), arbitrages 2 et 3 : aucun second journal,
-- le declencheur generique `fn_trg_audit_modification` (2026-10-08d) se branche
-- la ou il manquait.
--
--   1. LA REFERENCE : voir 2026-11-06e (avec la fin de vie, colonne nouvelle).
--   2. LA SECURITE DES COMPTES : `trg_audit_utilisateur` ne voyait que le role et
--      l'etat actif. Le changement de mot de passe (le sien ou celui d'autrui),
--      l'activation et le retrait de la double authentification laissent
--      desormais leur ligne : on journalise `mot_de_passe_change_le`,
--      `totp_actif`, `totp_active_le` — JAMAIS l'empreinte ni le secret.
--   3. LES REFERENTIELS DU CRUD SANS AUDIT : groupes d'equivalence et leurs
--      membres, parametres de frais, conditionnements, motifs machine, devises.
--   4. LA DIRECTION A TOUS LES DROITS SUR TOUS LES MODULES (regle ecrite de
--      seed_002_securite.sql) : les 9 droits poses par la page Roles le 13/10
--      manquaient au socle du 09/10, donc a toute base neuve.
--
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 2. Les comptes : mot de passe et double authentification, sans les secrets
-- -----------------------------------------------------------------------------
-- `mot_de_passe_change_le` est pose par trg_utilisateur_mdp_change (BEFORE) des
-- que l'empreinte change : c'est lui qui porte la trace d'un changement.
DROP TRIGGER IF EXISTS trg_audit_securite_compte ON utilisateur;
CREATE TRIGGER trg_audit_securite_compte
AFTER UPDATE ON utilisateur FOR EACH ROW
WHEN (   OLD.mot_de_passe_hash IS DISTINCT FROM NEW.mot_de_passe_hash
      OR OLD.totp_actif        IS DISTINCT FROM NEW.totp_actif
      OR OLD.secret_totp       IS DISTINCT FROM NEW.secret_totp)
EXECUTE FUNCTION fn_trg_audit_modification(
    'mot_de_passe_hash', 'secret_totp', 'totp_dernier_pas',
    'derniere_connexion', 'echecs_consecutifs', 'bloque_jusqu_a', 'dernier_echec',
    -- deja journalises par trg_audit_utilisateur
    'code_role_user', 'actif');

-- -----------------------------------------------------------------------------
-- 3. Les referentiels du CRUD
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        -- table,                  operations (la suppression la ou trg_audit_suppression manque)
        ('groupe_equiv',           'INSERT OR UPDATE OR DELETE'),
        ('reference_groupe_equiv', 'INSERT OR UPDATE'),
        ('parametres_frais',       'INSERT OR UPDATE OR DELETE'),
        ('conditionnement',        'INSERT OR UPDATE OR DELETE'),
        ('machine_motif',          'INSERT OR UPDATE OR DELETE'),
        ('devise',                 'INSERT OR UPDATE OR DELETE')
    ) v(nom, ops)
    LOOP
        IF to_regclass('public.' || t.nom) IS NULL THEN
            RAISE NOTICE 'audit des referentiels : table % absente, ignoree', t.nom;
            CONTINUE;
        END IF;
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_modification ON %I', t.nom);
        EXECUTE format('CREATE TRIGGER trg_audit_modification AFTER %s ON %I FOR EACH ROW '
                       'EXECUTE FUNCTION fn_trg_audit_modification(%L)', t.ops, t.nom, 'version');
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. La Direction : tous les droits sur tous les modules (seed_002_securite.sql)
-- -----------------------------------------------------------------------------
INSERT INTO permission (code_role_user, module, action, actif)
SELECT 'DIRECTION', d.module, d.action, 1
  FROM (VALUES ('UTILISATEURS', 'ECRIRE'), ('UTILISATEURS', 'VALIDER'),
               ('AUDIT', 'ECRIRE'), ('AUDIT', 'VALIDER'),
               ('PARAMETRES', 'VALIDER'), ('CATALOGUE', 'VALIDER'), ('COCKPIT', 'VALIDER'),
               ('MRP', 'VALIDER'), ('VALORISATION', 'VALIDER')) d(module, action)
 WHERE EXISTS (SELECT 1 FROM role_utilisateur WHERE code_role_user = 'DIRECTION')
ON CONFLICT (code_role_user, module, action) DO UPDATE SET actif = 1;

-- Le temoin : la Direction a ses neuf droits.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM role_utilisateur WHERE code_role_user = 'DIRECTION')
       AND (SELECT count(*) FROM permission
             WHERE code_role_user = 'DIRECTION' AND actif = 1
               AND (module, action) IN (('UTILISATEURS','ECRIRE'), ('UTILISATEURS','VALIDER'),
                                        ('AUDIT','ECRIRE'), ('AUDIT','VALIDER'),
                                        ('PARAMETRES','VALIDER'), ('CATALOGUE','VALIDER'),
                                        ('COCKPIT','VALIDER'), ('MRP','VALIDER'),
                                        ('VALORISATION','VALIDER'))) <> 9 THEN
        RAISE EXCEPTION '2026-11-06b : la Direction n''a pas ses neuf droits.';
    END IF;
END $$;

COMMIT;
