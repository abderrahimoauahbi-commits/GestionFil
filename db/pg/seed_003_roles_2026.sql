-- Porte automatiquement depuis db/seed/003_roles_2026.sql par pg/porter_vues.py.
-- NE PAS MODIFIER ICI : corriger la source, puis rejouer le portage.

-- =============================================================================
-- ERP GESTION FIL — modele de roles, revision 2026
-- -----------------------------------------------------------------------------
-- Quatre roles, decides avec la direction le 29/08/2026, en remplacement des six
-- issus de l'organigramme theorique de depart.
--
--   DIRECTION   le metier et le financier. Voit tout, ecrit partout sauf sur les
--               comptes et le journal.
--   ADMIN       l'administrateur systeme. Comptes, droits, parametres, audit,
--               referentiels — mais AUCUN montant. Il fait tourner l'outil, il
--               ne lit pas les prix d'achat.
--   ASSISTANTE  toute la gestion courante : catalogue, qualites, recettes,
--               plans, besoins, plan d'achat, commandes, receptions, stock.
--               Sans les montants, sans les parametres systeme, sans les
--               comptes.
--   MAGASIN     le quai et les magasins : mouvements, inventaires, receptions.
--               Quantites uniquement.
--
-- POURQUOI PERSONNE N'A TOUT. DIRECTION lit les montants mais ne peut pas
-- s'attribuer de droits ; ADMIN attribue les droits mais ne lit pas les
-- montants. Un seul compte cumulant les deux pourrait se donner acces a la
-- valorisation puis effacer la trace — l'audit etant justement ce qu'il
-- administre. La separation coute une connexion de plus le jour d'une reprise ;
-- elle evite qu'un compte compromis puisse a la fois lire et couvrir.
--
-- CE QUE CE FICHIER NE TOUCHE PAS : les mots de passe.
--
-- CE QU'IL RECONSTRUIT EN REVANCHE : les droits individuels (`droit_champ`).
-- C'est indispensable, et c'est explique en section 5 — le serveur ne lit que
-- cette table, jamais le modele de role.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Les roles
-- -----------------------------------------------------------------------------
-- Les quatre anciens ne sont pas supprimes mais DESACTIVES : `utilisateur` et
-- `audit_log` les referencent, et un DELETE casserait la lecture de l'historique
-- — on ne saurait plus sous quel role une action de mars a ete faite.

INSERT INTO role_utilisateur (code_role_user, libelle, description, niveau_hierarchique,
                              plafond_validation_bc_mad, actif)
VALUES
  ('ADMIN', 'Administrateur systeme',
   'Comptes, droits, parametres, audit et referentiels. Aucun acces aux montants.',
   90, NULL, 1),
  ('ASSISTANTE', 'Assistante de gestion',
   'Gestion courante hors montants : catalogue, production, planification, achats, stock.',
   55, NULL, 1)
ON CONFLICT (code_role_user) DO UPDATE SET
  libelle             = excluded.libelle,
  description         = excluded.description,
  niveau_hierarchique = excluded.niveau_hierarchique,
  actif               = 1;

UPDATE role_utilisateur SET actif = 0
 WHERE code_role_user IN ('DAF', 'ACHAT', 'PLANIF', 'QUALITE');


-- -----------------------------------------------------------------------------
-- 2. Les comptes existants suivent
-- -----------------------------------------------------------------------------
-- Trois metiers de bureau deviennent l'assistante ; le controle qualite se fait
-- au quai, donc au magasin.

UPDATE utilisateur SET code_role_user = 'ASSISTANTE'
 WHERE code_role_user IN ('DAF', 'ACHAT', 'PLANIF');

UPDATE utilisateur SET code_role_user = 'MAGASIN'
 WHERE code_role_user = 'QUALITE';


-- -----------------------------------------------------------------------------
-- 3. Permissions par module
-- -----------------------------------------------------------------------------
-- Table rasee pour les quatre roles vivants, puis reconstruite : accumuler des
-- INSERT sur un modele deja pose laisserait des droits d'une revision
-- precedente, invisibles et jamais relus.

DELETE FROM permission
 WHERE code_role_user IN ('DIRECTION', 'ADMIN', 'ASSISTANTE', 'MAGASIN');

-- Les anciens roles gardent leurs lignes mais deviennent inertes : leur role est
-- inactif, donc aucun compte ne peut plus s'y rattacher.
UPDATE permission SET actif = 0
 WHERE code_role_user IN ('DAF', 'ACHAT', 'PLANIF', 'QUALITE');
INSERT INTO permission (id_permission, code_role_user, module, action, actif)
VALUES
  (gen_random_uuid()::text, 'DIRECTION', 'COCKPIT', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'COCKPIT', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'COCKPIT', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'COCKPIT', 'LIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'COCKPIT', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'CATALOGUE', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'CATALOGUE', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'CATALOGUE', 'LIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'CATALOGUE', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'CATALOGUE', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'CATALOGUE', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'CATALOGUE', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'FOURNISSEURS', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'FOURNISSEURS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'FOURNISSEURS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'FOURNISSEURS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'FOURNISSEURS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'FOURNISSEURS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'FOURNISSEURS', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'QUALITES', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'QUALITES', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'QUALITES', 'VALIDER', 1),
  (gen_random_uuid()::text, 'ADMIN', 'QUALITES', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'QUALITES', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'QUALITES', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'QUALITES', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'RECETTES', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'RECETTES', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'RECETTES', 'VALIDER', 1),
  (gen_random_uuid()::text, 'ADMIN', 'RECETTES', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'RECETTES', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'RECETTES', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'RECETTES', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'PLANS', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'PLANS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'PLANS', 'VALIDER', 1),
  (gen_random_uuid()::text, 'ADMIN', 'PLANS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'PLANS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'PLANS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'PLANS', 'VALIDER', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'PLANS', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'MRP', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'MRP', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'MRP', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'MRP', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'MRP', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'MRP', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'PLAN_ACHAT', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'PLAN_ACHAT', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'PLAN_ACHAT', 'VALIDER', 1),
  (gen_random_uuid()::text, 'ADMIN', 'PLAN_ACHAT', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'PLAN_ACHAT', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'PLAN_ACHAT', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'PLAN_ACHAT', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'BONS_COMMANDE', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'BONS_COMMANDE', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'BONS_COMMANDE', 'VALIDER', 1),
  (gen_random_uuid()::text, 'ADMIN', 'BONS_COMMANDE', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'BONS_COMMANDE', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'BONS_COMMANDE', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'BONS_COMMANDE', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'RECEPTIONS', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'RECEPTIONS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'RECEPTIONS', 'VALIDER', 1),
  (gen_random_uuid()::text, 'ADMIN', 'RECEPTIONS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'RECEPTIONS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'RECEPTIONS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'RECEPTIONS', 'LIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'RECEPTIONS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'MOUVEMENTS', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'MOUVEMENTS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'MOUVEMENTS', 'VALIDER', 1),
  (gen_random_uuid()::text, 'ADMIN', 'MOUVEMENTS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'MOUVEMENTS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'MOUVEMENTS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'MOUVEMENTS', 'LIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'MOUVEMENTS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'MOUVEMENTS', 'VALIDER', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'INVENTAIRE', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'INVENTAIRE', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'INVENTAIRE', 'VALIDER', 1),
  (gen_random_uuid()::text, 'ADMIN', 'INVENTAIRE', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'INVENTAIRE', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'INVENTAIRE', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'INVENTAIRE', 'LIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'INVENTAIRE', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'INVENTAIRE', 'VALIDER', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'STOCK', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'STOCK', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'STOCK', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'STOCK', 'LIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'STOCK', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'STOCK', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'VALORISATION', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'VALORISATION', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'PARAMETRES', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'PARAMETRES', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'PARAMETRES', 'LIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'PARAMETRES', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'ASSISTANTE', 'PARAMETRES', 'LIRE', 1),
  (gen_random_uuid()::text, 'MAGASIN', 'PARAMETRES', 'LIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'UTILISATEURS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'UTILISATEURS', 'LIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'UTILISATEURS', 'ECRIRE', 1),
  (gen_random_uuid()::text, 'DIRECTION', 'AUDIT', 'LIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'AUDIT', 'LIRE', 1),
  (gen_random_uuid()::text, 'ADMIN', 'AUDIT', 'ECRIRE', 1);

-- 107 permissions pour 4 roles et 17 modules


-- -----------------------------------------------------------------------------
-- 4. Droits par champ
-- -----------------------------------------------------------------------------
-- La permission de module ouvre l'ecran ; le droit par champ decide de chaque
-- colonne. Les deux sont necessaires : sans le second, un role autorise a lire
-- le catalogue y lirait aussi le prix d'achat et le CMUP.
--
-- `champ_configurable.sensible = 1` marque les 67 champs qui portent un montant
-- — prix, valorisation, CMUP, plafonds. C'est la seule liste tenue a jour quand
-- une colonne s'ajoute, et s'en servir evite d'enumerer ici des noms qui
-- divergeraient au premier ALTER TABLE.

DELETE FROM modele_droit_champ
 WHERE code_role_user IN ('DIRECTION', 'ADMIN', 'ASSISTANTE', 'MAGASIN');

-- Le niveau se decide en trois temps, et l'ordre compte :
--
--   1. le module est-il seulement lisible par ce role ? Sinon MASQUE. C'est
--      redondant avec la permission de module, et c'est voulu : le jour ou
--      quelqu'un ouvre VALORISATION au magasinier « juste pour voir », les
--      colonnes de montants restent fermees. Une seule erreur ne suffit alors
--      plus a decouvrir le patrimoine.
--   2. le champ porte-t-il un montant ? Si oui MASQUE, sauf exception ci-dessous.
--   3. sinon ECRITURE.

-- DIRECTION : tout, en ecriture. C'est le seul role qui lit les montants.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT 'DIRECTION', module, champ, 'ECRITURE' FROM champ_configurable;

-- ADMIN : tout sauf les montants. Il administre l'outil, pas les achats.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT 'ADMIN', c.module, c.champ,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM permission p
                           WHERE p.code_role_user = 'ADMIN' AND p.module = c.module
                             AND p.action = 'LIRE' AND p.actif = 1) THEN 'MASQUE'
         WHEN c.sensible = 1 THEN 'MASQUE'
         ELSE 'ECRITURE'
       END
  FROM champ_configurable c;

-- ASSISTANTE : la gestion sans les montants.
--
-- UNE EXCEPTION ASSUMEE : les prix des bons de commande, des receptions et du
-- plan d'achat lui restent ouverts. Un bon de commande sans prix n'est pas un
-- bon de commande — le serveur refuse la ligne, et l'ecran de saisie perdrait
-- la colonne qu'il doit remplir. Ce qui lui reste ferme, c'est la
-- VALORISATION : le CMUP, la valeur du stock, le capital immobilise. Elle
-- engage la depense, elle ne lit pas le patrimoine.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT 'ASSISTANTE', c.module, c.champ,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM permission p
                           WHERE p.code_role_user = 'ASSISTANTE' AND p.module = c.module
                             AND p.action = 'LIRE' AND p.actif = 1) THEN 'MASQUE'
         WHEN c.sensible = 1 AND c.module IN ('BONS_COMMANDE', 'RECEPTIONS', 'PLAN_ACHAT')
              THEN 'ECRITURE'
         WHEN c.sensible = 1 THEN 'MASQUE'
         ELSE 'ECRITURE'
       END
  FROM champ_configurable c;

-- MAGASIN : quantites seules. Tout montant est masque, sans exception — le
-- magasinier pese et compte, il ne valorise pas.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT 'MAGASIN', c.module, c.champ,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM permission p
                           WHERE p.code_role_user = 'MAGASIN' AND p.module = c.module
                             AND p.action = 'LIRE' AND p.actif = 1) THEN 'MASQUE'
         WHEN c.sensible = 1 THEN 'MASQUE'
         ELSE 'ECRITURE'
       END
  FROM champ_configurable c;


-- -----------------------------------------------------------------------------
-- 5. Derivation vers les droits effectifs
-- -----------------------------------------------------------------------------
-- SANS CETTE ETAPE, TOUT CE QUI PRECEDE EST DECORATIF.
--
-- Le serveur ne lit JAMAIS `modele_droit_champ`. Il resout la grille d'un
-- utilisateur dans `droit_champ`, avec repli sur `champ_configurable.
-- niveau_defaut` (auth/rbac.rs). Le modele est un gabarit pour l'ecran
-- d'administration ; c'est la table individuelle qui decide ce qui sort du
-- serveur.
--
-- On la reconstruit donc entierement depuis le modele du role de chacun.
--
-- CE QUE CELA EFFACE. Les 70 ecarts individuels constates avant migration, tous
-- de meme nature : ECRITURE accorde a la main la ou le modele disait LECTURE,
-- au fil des ecrans qui en avaient besoin. Le nouveau modele accorde ECRITURE
-- par defaut sur tout ce qui n'est ni un montant ni un module ferme : ces
-- ajustements sont donc absorbes, pas perdus. Aucun ecart n'allait dans l'autre
-- sens — aucun droit n'etait RETIRE a la main a quelqu'un.

DELETE FROM droit_champ
 WHERE id_utilisateur IN (
   SELECT id_utilisateur FROM utilisateur
    WHERE code_role_user IN ('DIRECTION', 'ADMIN', 'ASSISTANTE', 'MAGASIN'));

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, date_modification)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE u.code_role_user IN ('DIRECTION', 'ADMIN', 'ASSISTANTE', 'MAGASIN');
