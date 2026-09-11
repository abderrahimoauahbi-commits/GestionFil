-- =============================================================================
-- ADMIN devient super-utilisateur — 8 septembre 2026
-- -----------------------------------------------------------------------------
-- CE FICHIER DEFAIT UNE DECISION. Il faut donc dire laquelle, et ce qu'on perd.
--
-- Le 29/08/2026, quatre roles ont ete arretes avec la direction sur une
-- separation nette, expliquee en tete de `seed_003_roles_2026.sql` : DIRECTION
-- lit les montants sans pouvoir s'attribuer de droits, ADMIN attribue les
-- droits sans lire les montants. Le but etait qu'un seul compte compromis ne
-- puisse pas a la fois decouvrir le patrimoine et effacer la trace de l'avoir
-- fait — l'audit etant precisement ce qu'ADMIN administre.
--
-- Le 08/09/2026, le proprietaire de l'outil a tranche autrement : ADMIN aura
-- tout, montants compris. CE QUE CELA VEUT DIRE CONCRETEMENT : le compte
-- `admin` peut desormais lire la valorisation et le CMUP, ecrire un mouvement,
-- valider un bon de commande sans plafond, ET administrer le journal d'audit.
-- Il se protege donc comme un compte de direction, pas comme un compte
-- technique — un mot de passe partage sur ce compte-la expose tout.
--
-- Les trois autres roles ne bougent pas.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Les permissions de module : les 17 modules, les 3 actions.
-- -----------------------------------------------------------------------------
-- On lit la liste des modules dans `champ_configurable` plutot que de l'ecrire :
-- une liste recopiee ici divergerait au premier module ajoute.
INSERT INTO permission (id_permission, code_role_user, module, action, actif)
SELECT gen_random_uuid()::text, 'ADMIN', m.module, a.action, 1
  FROM (SELECT DISTINCT module FROM champ_configurable) m
 CROSS JOIN (VALUES ('LIRE'), ('ECRIRE'), ('VALIDER')) AS a(action)
    ON CONFLICT (code_role_user, module, action) DO NOTHING;

-- Une permission desactivee reste une permission : on la rallume.
UPDATE permission SET actif = 1 WHERE code_role_user = 'ADMIN' AND actif <> 1;

-- -----------------------------------------------------------------------------
-- 2. Le gabarit du role : ecriture partout, montants inclus, comme DIRECTION.
-- -----------------------------------------------------------------------------
DELETE FROM modele_droit_champ WHERE code_role_user = 'ADMIN';
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT 'ADMIN', module, champ, 'ECRITURE' FROM champ_configurable;

-- -----------------------------------------------------------------------------
-- 3. LES DROITS EFFECTIFS — sans quoi les deux etapes precedentes sont
--    decoratives : le serveur ne lit jamais le gabarit, il lit `droit_champ`.
-- -----------------------------------------------------------------------------
-- On repart de `champ_configurable` et non du gabarit : c'est la seule liste qui
-- porte TOUS les champs declares, y compris ceux qu'une migration a ajoutes
-- apres coup et dont le gabarit du role ne savait rien.
DELETE FROM droit_champ
 WHERE id_utilisateur IN (SELECT id_utilisateur FROM utilisateur
                           WHERE code_role_user = 'ADMIN');

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, date_modification)
SELECT u.id_utilisateur, c.module, c.champ, 'ECRITURE',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM utilisateur u
 CROSS JOIN champ_configurable c
 WHERE u.code_role_user = 'ADMIN';

-- -----------------------------------------------------------------------------
-- 4. La description du role, sinon l'ecran d'administration ment.
-- -----------------------------------------------------------------------------
UPDATE role_utilisateur
   SET description = 'Super-utilisateur : tous les modules, toutes les actions, '
                     'montants compris. Aucune separation avec la direction.'
 WHERE code_role_user = 'ADMIN';

COMMIT;
