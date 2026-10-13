-- =============================================================================
-- MIGRATION 2026-09-03 — journal des paquets clients
-- -----------------------------------------------------------------------------
-- CE QUE CELA APPORTE. L'application se sert dans un navigateur, mais un poste
-- de magasin gagne a l'avoir installee : elle demarre seule, garde son adresse
-- de serveur et survit a un onglet ferme par megarde. Les installateurs se
-- distribuaient par cle USB — donc mal, donc chaque poste finissait sur une
-- version differente, et personne ne savait laquelle.
--
-- LE FICHIER N'EST PAS EN BASE. Un installateur pese des megaoctets ; il vit
-- dans un dossier du serveur (`GESTIONFIL_PAQUETS`). Cette table ne porte que
-- la TRACE : qui a pris quelle version, et quand. Ce n'est pas de la
-- statistique d'usage, c'est la reponse a la seule question qu'on se pose
-- apres coup — « sur quelle version tourne ce poste » — quand un utilisateur
-- decrit un comportement que le code n'a plus.
--
-- Application, sur le serveur — le compte `postgres` ne lit pas /home/sysadmin,
-- d'ou le passage par l'entree standard plutot que `psql -f` :
--
--     cd /tmp
--     cat /home/sysadmin/gestionfil/db/migrations/2026-09-03_telechargements.sql |
--         sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
-- =============================================================================

CREATE TABLE IF NOT EXISTS telechargement (
    id_telechargement   text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    fichier             text    NOT NULL,
    plateforme          text    NOT NULL,
    version             text    NOT NULL,
    taille_octets       bigint,
    id_utilisateur      text    NOT NULL REFERENCES utilisateur(id_utilisateur),
    adresse_ip          text,
    date_telechargement text    NOT NULL
        DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS ix_telechargement_date
    ON telechargement(date_telechargement DESC);
CREATE INDEX IF NOT EXISTS ix_telechargement_user
    ON telechargement(id_utilisateur, date_telechargement DESC);

-- UNE TABLE CREEE PAR UNE MIGRATION APPARTIENT A CELUI QUI LA JOUE.
--
-- Ces migrations se lancent en `postgres` — le seul compte qui puisse tout
-- faire — alors que le schema, lui, a ete charge par le role `gestionfil`. La
-- table se retrouvait donc la propriete de `postgres`, et le service recevait
-- « droit refuse pour la table telechargement » a la premiere ecriture. Vu en
-- production, au premier telechargement.
--
-- A REPRODUIRE DANS TOUTE MIGRATION QUI CREE UNE TABLE. Un ALTER de colonne sur
-- une table existante n'a pas ce probleme : il ne change pas le proprietaire.
ALTER TABLE telechargement OWNER TO gestionfil;

-- --- Les champs configurables ------------------------------------------------
-- UN CHAMP NON DECLARE VAUT MASQUE, et sa colonne disparait de l'ecran sans un
-- mot. Le journal vit dans le module PARAMETRES : il nomme des personnes, ce
-- qui en fait une information d'exploitation et non de gestion.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('PARAMETRES','fichier',             'Fichier',         'LECTURE', 0, 200),
 ('PARAMETRES','plateforme',          'Plateforme',      'LECTURE', 0, 210),
 ('PARAMETRES','version',             'Version',         'LECTURE', 0, 220),
 ('PARAMETRES','taille_octets',       'Taille',          'LECTURE', 0, 230),
 ('PARAMETRES','date_telechargement', 'Telecharge le',   'LECTURE', 0, 240),
 ('PARAMETRES','utilisateur',         'Par',             'LECTURE', 0, 250),
 ('PARAMETRES','adresse_ip',          'Adresse IP',      'LECTURE', 0, 260),
 ('PARAMETRES','disponible',          'Disponible',      'LECTURE', 0, 270),
 ('PARAMETRES','nb_telechargements',  'Telechargements', 'LECTURE', 0, 280)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = c.module AND p.action = 'LIRE') THEN 'LECTURE'
           ELSE 'MASQUE'
       END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'PARAMETRES' AND c.ordre BETWEEN 200 AND 280
   AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

-- Un journal ne se corrige pas a la main : il est en LECTURE pour tous.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'PARAMETRES' AND c.ordre BETWEEN 200 AND 280
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

SELECT 'table telechargement' AS controle,
       count(*) AS valeur
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'telechargement'
UNION ALL
SELECT 'champs declares (attendu 9)', count(*)
  FROM champ_configurable
 WHERE module = 'PARAMETRES' AND ordre BETWEEN 200 AND 280;
