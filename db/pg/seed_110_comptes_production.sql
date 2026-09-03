-- =============================================================================
-- COMPTES ET ROLES DE PRODUCTION — Polyfashions Carpet Morocco
-- -----------------------------------------------------------------------------
-- Ce fichier fait passer la base du modele de developpement (huit roles, six
-- comptes generiques) au modele reel : QUATRE ROLES, SIX PERSONNES.
--
-- AUCUN MOT DE PASSE N'EST ECRIT ICI, et c'est deliberé. Chaque compte porte le
-- marqueur `!A_DEFINIR!`, qui n'est pas une empreinte Argon2 valide : aucune
-- connexion n'est possible tant qu'un mot de passe reel n'a pas ete pose. Le
-- serveur le signale au demarrage. On les definit ensuite, un par un, sur le
-- serveur :
--
--     GESTIONFIL_MOT_DE_PASSE="au moins douze caracteres" \
--       ./gestionfil-admin definir-mot-de-passe <login>
--
-- Ecrire les mots de passe dans un fichier versionne les rendrait lisibles par
-- quiconque obtient le depot, et ils y resteraient dans l'historique meme
-- apres correction.
--
-- LES QUATRE ROLES
--   DIRECTION   tous les droits, aucun champ masque.
--   ADMIN       administration technique : sauvegardes, comptes, parametres
--               systeme. Voit la gestion, n'arbitre pas.
--   ASSISTANTE  toute la gestion — stocks, besoins, plans d'achat et de
--               production — mais AUCUNE VALEUR MONETAIRE, aucune statistique
--               financiere, aucun droit sur les comptes.
--   MAGASIN     les mouvements et les quantites. Ni prix, ni valorisation.
--
-- Ce fichier est IDEMPOTENT : le rejouer ne cree pas de doublon.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Les six comptes reels
-- -----------------------------------------------------------------------------
-- Les identifiants sont ceux de la base de recette, repris tels quels : ils
-- apparaissent deja dans des journaux d'audit, et les changer romprait le lien
-- entre une trace et la personne qui l'a laissee.
INSERT INTO utilisateur
    (id_utilisateur, code_role_user, login, mot_de_passe_hash, nom, magasin_principal, actif)
VALUES
    ('fb4103c0-c16e-4214-a90b-451f7cd64211', 'ADMIN',      'admin',     '!A_DEFINIR!', 'Superviseur systeme',   NULL,    1),
    ('119a2b25-7dde-4132-a626-ad141264801d', 'DIRECTION',  'Mohamed',   '!A_DEFINIR!', 'Mohamed Mazari',        NULL,    1),
    ('98c682da-54db-4818-ad5a-4d4d826ae45a', 'DIRECTION',  'Choukri',   '!A_DEFINIR!', 'Chokri Mazari',         NULL,    1),
    ('86a20519-69c4-45aa-aa41-aff9fa88d628', 'DIRECTION',  'Tarik',     '!A_DEFINIR!', 'Tarik Mazari',          NULL,    1),
    ('d5160331-fa19-4141-a47e-9b040a0746fa', 'ASSISTANTE', 'Assistante','!A_DEFINIR!', 'Assistante de gestion', NULL,    1),
    ('16974041-c279-480c-ad58-db7a5a37fb2a', 'MAGASIN',    'Magasinie', '!A_DEFINIR!', 'Magasinier',            'MP-01', 1)
ON CONFLICT (id_utilisateur) DO UPDATE SET
    code_role_user    = excluded.code_role_user,
    login             = excluded.login,
    nom               = excluded.nom,
    magasin_principal = excluded.magasin_principal,
    actif             = excluded.actif;
-- Le mot de passe n'est PAS dans la clause de mise a jour : rejouer ce fichier
-- ne doit pas reinitialiser des mots de passe deja definis.

-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- 2. Les comptes generiques de developpement s'en vont
-- -----------------------------------------------------------------------------
-- `direction`, `daf`, `achat`, `planif`, `qualite`, `magasin` : des comptes de
-- fonction, sans personne derriere. Un journal d'audit qui dit « modifie par
-- achat » ne nomme personne et ne prouve rien — c'est tout l'interet d'avoir
-- des comptes nominatifs.
--
-- MAIS ON N'EFFACE PAS UNE TRACE. Les 124 references et les 18 qualites du
-- referentiel portent l'identifiant du compte qui les a creees pendant la
-- reprise. Supprimer ce compte casserait la cle etrangere — et supprimer la
-- trace avec lui serait pire : le referentiel n'aurait plus d'auteur.
--
-- Ces traces sont donc REPORTEES sur `admin`, le compte technique qui a
-- effectivement conduit la reprise. Dire « cree par admin le jour de la
-- reprise » est exact ; dire « cree par personne » ne l'est pas.
--
-- Seules les colonnes du REFERENTIEL sont traitees : les tables
-- d'exploitation (mouvements, receptions, plans, bons de commande) sont vides
-- dans une base initiale, donc rien n'y pointe.
UPDATE reference SET id_utilisateur_creation = 'fb4103c0-c16e-4214-a90b-451f7cd64211'
 WHERE id_utilisateur_creation IN (
       SELECT id_utilisateur FROM utilisateur
        WHERE login IN ('direction', 'daf', 'achat', 'planif', 'qualite', 'magasin'));

UPDATE qualite SET id_utilisateur_creation = 'fb4103c0-c16e-4214-a90b-451f7cd64211'
 WHERE id_utilisateur_creation IN (
       SELECT id_utilisateur FROM utilisateur
        WHERE login IN ('direction', 'daf', 'achat', 'planif', 'qualite', 'magasin'));

UPDATE qualite SET id_utilisateur_modification = 'fb4103c0-c16e-4214-a90b-451f7cd64211'
 WHERE id_utilisateur_modification IN (
       SELECT id_utilisateur FROM utilisateur
        WHERE login IN ('direction', 'daf', 'achat', 'planif', 'qualite', 'magasin'));

UPDATE qualite SET id_utilisateur_cloture = 'fb4103c0-c16e-4214-a90b-451f7cd64211'
 WHERE id_utilisateur_cloture IN (
       SELECT id_utilisateur FROM utilisateur
        WHERE login IN ('direction', 'daf', 'achat', 'planif', 'qualite', 'magasin'));

-- Leurs droits par champ partent ensuite : `droit_champ` les reference aussi.
DELETE FROM droit_champ
 WHERE id_utilisateur IN (
       SELECT id_utilisateur FROM utilisateur
        WHERE login IN ('direction', 'daf', 'achat', 'planif', 'qualite', 'magasin'));

DELETE FROM utilisateur
 WHERE login IN ('direction', 'daf', 'achat', 'planif', 'qualite', 'magasin');

-- 3. Les quatre roles de developpement s'en vont
-- -----------------------------------------------------------------------------
-- DAF, ACHAT, PLANIF et QUALITE ne portent plus aucun compte, mais gardent 73
-- permissions. Les laisser, c'est laisser quatre profils d'acces complets que
-- personne ne surveille — et qu'un compte cree a la va-vite pourrait recevoir.
DELETE FROM permission          WHERE code_role_user IN ('DAF', 'ACHAT', 'PLANIF', 'QUALITE');
DELETE FROM modele_droit_champ  WHERE code_role_user IN ('DAF', 'ACHAT', 'PLANIF', 'QUALITE');
DELETE FROM role_utilisateur    WHERE code_role_user IN ('DAF', 'ACHAT', 'PLANIF', 'QUALITE');

-- -----------------------------------------------------------------------------
-- 3 bis. Les parametres qui nommaient un role disparu
-- -----------------------------------------------------------------------------
-- `parametre.modifiable_par` porte un code de role SANS cle etrangere : rien
-- n'aurait signale que six parametres restaient « modifiables par DAF » apres
-- la disparition du role. Modifiables par personne, donc — et le decouvrir le
-- jour ou l'on veut changer un seuil de tresorerie.
--
-- DAF etait la gouvernance financiere : elle revient a la DIRECTION, seul role
-- du nouveau modele a voir les valeurs monetaires.
UPDATE parametre SET modifiable_par = 'DIRECTION' WHERE modifiable_par = 'DAF';
UPDATE parametre SET modifiable_par = 'ASSISTANTE' WHERE modifiable_par IN ('ACHAT', 'PLANIF');
UPDATE parametre SET modifiable_par = 'MAGASIN' WHERE modifiable_par = 'QUALITE';

-- -----------------------------------------------------------------------------
-- 4. Les droits effectifs, derives du modele
-- -----------------------------------------------------------------------------
-- LE SERVEUR NE LIT JAMAIS `modele_droit_champ`. Il lit `droit_champ`, ligne
-- par utilisateur. Sans cette derivation, tout ce qui precede serait decoratif :
-- les comptes existeraient, leurs droits par champ seraient vides, et l'API
-- retomberait sur les valeurs par defaut du catalogue — c'est-a-dire ouverte.
DELETE FROM droit_champ
 WHERE id_utilisateur IN (SELECT id_utilisateur FROM utilisateur);

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, date_modification)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user;

-- -----------------------------------------------------------------------------
-- 5. Le journal d'audit repart a zero
-- -----------------------------------------------------------------------------
-- Le chargement du referentiel a declenche les onze declencheurs d'audit :
-- 11 000 lignes disant « admin a cree la reference PP-1500 » a la seconde ou
-- le fichier a ete joue. Ce n'est pas une trace d'exploitation, c'est le bruit
-- de l'installation — et il noierait les premieres vraies actions.
--
-- ON NE L'EFFACE PAS : un declencheur interdit la suppression dans le journal
-- d'audit, et il a raison — un journal qu'on peut vider ne prouve rien.
--
-- La solution est en amont : les declencheurs d'audit sont poses APRES le
-- chargement du referentiel (voir `charger.py`, liste AUDIT). La reprise n'est
-- donc pas auditee du tout, au lieu d'etre auditee puis effacee. L'audit
-- commence a la mise en service, ce qui est exactement ce qu'on veut qu'il
-- signifie.
--
-- Une seule ligne est posee, qui date la reprise et dit d'ou vient le
-- referentiel.

INSERT INTO audit_log (id_audit, table_concernee, operation, id_enregistrement,
                       nouvelles_valeurs, date_operation, id_utilisateur)
VALUES (gen_random_uuid()::text, 'entreprise', 'INSERT', 'REPRISE',
        '{"evenement":"reprise initiale","source":"GESTION Fil.xlsx",'
        '"references":124,"fournisseurs":12,"qualites":18,"recettes":301}',
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'fb4103c0-c16e-4214-a90b-451f7cd64211');

COMMIT;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
-- DIRECTION doit avoir zero champ masque ; MAGASIN et ASSISTANTE doivent en
-- avoir. Une colonne « masques » a zero partout signifie que la derivation
-- ci-dessus n'a pas eu lieu — et que tout le monde voit les prix.
SELECT u.code_role_user,
       count(DISTINCT u.login)                          AS comptes,
       count(*) FILTER (WHERE d.niveau = 'MASQUE')      AS champs_masques,
       count(*)                                         AS champs_total
  FROM utilisateur u
  LEFT JOIN droit_champ d USING (id_utilisateur)
 GROUP BY u.code_role_user
 ORDER BY u.code_role_user;
