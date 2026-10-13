-- =============================================================================
-- MIGRATION 2026-10-02d — l'administrateur a tous les droits, sans exception
--
-- La regle vit dans le serveur (`rbac::droits_champ`) : un ADMIN ecrit sur tout
-- champ, meme ajoute plus tard. Ce fichier aligne les DONNEES sur la regle, pour
-- que l'ecran des droits montre ce qui s'applique vraiment : 66 champs etaient
-- en lecture pour les comptes ADMIN, et les champs sans ligne prenaient leur
-- niveau par defaut (« Suivi par lot » en lecture, par exemple).
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-02d_admin_tous_droits.sql
-- =============================================================================
BEGIN;

-- Le modele du role : chaque champ declare, en ecriture.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT 'ADMIN', c.module, c.champ, 'ECRITURE'
  FROM champ_configurable c
ON CONFLICT (code_role_user, module, champ) DO UPDATE SET niveau = 'ECRITURE';

-- Chaque compte ADMIN, actif ou non.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, c.module, c.champ, 'ECRITURE'
  FROM utilisateur u
  CROSS JOIN champ_configurable c
 WHERE u.code_role_user = 'ADMIN'
ON CONFLICT (id_utilisateur, module, champ) DO UPDATE SET niveau = 'ECRITURE';

-- Et toutes les actions sur tous les modules.
INSERT INTO permission (code_role_user, module, action)
SELECT 'ADMIN', m.module, a.action
  FROM (SELECT DISTINCT module FROM permission) m
  CROSS JOIN (VALUES ('LIRE'), ('ECRIRE'), ('VALIDER')) a(action)
ON CONFLICT DO NOTHING;
UPDATE permission SET actif = 1 WHERE code_role_user = 'ADMIN';

SELECT 'administrateur : tous les droits' AS etat;
COMMIT;
