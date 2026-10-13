-- PROTEGER LA CONNEXION, 14 septembre 2026.
--
-- Deux manques, tous deux payants le jour ou quelqu'un quitte l'entreprise en
-- connaissant les identifiants de ses collegues :
--
--   * RIEN N'ARRETAIT LES TENTATIVES. Un appareil pose sur le reseau pouvait
--     essayer des mots de passe indefiniment, sans jamais etre ralenti.
--   * UN MOT DE PASSE SUFFISAIT. Celui qui le connaissait entrait, sans autre
--     obstacle.
--
-- LE BLOCAGE EST PROGRESSIF, PAS DEFINITIF. Un verrouillage ferme laisserait
-- n'importe qui fermer le compte du directeur en tapant cinq fois a cote :
-- l'attaque de deni de service remplacerait celle du mot de passe. L'attente
-- s'allonge donc a chaque echec et se remet a zero des la premiere reussite,
-- avec un plafond pour que le compte se rouvre toujours de lui-meme.
--
-- LE SECOND FACTEUR RESTE FACULTATIF, compte par compte. L'imposer d'un coup a
-- six personnes dont personne n'a encore vu l'ecran, c'est se preparer a
-- rouvrir six comptes a la main le lendemain. Chacun l'active, le verifie, et
-- la direction decide ensuite d'en faire une regle.

ALTER TABLE utilisateur
    -- Le compte des echecs DEPUIS LA DERNIERE REUSSITE. Remis a zero a chaque
    -- connexion valide : c'est la serie qui compte, pas le total de la vie du
    -- compte.
    ADD COLUMN IF NOT EXISTS echecs_consecutifs bigint NOT NULL DEFAULT 0
        CHECK (echecs_consecutifs >= 0),
    -- L'instant avant lequel on refuse, meme avec le bon mot de passe. Nul
    -- quand le compte est libre.
    ADD COLUMN IF NOT EXISTS bloque_jusqu_a text,
    ADD COLUMN IF NOT EXISTS dernier_echec text,
    -- Le secret du second facteur, en base32, tel que l'application mobile le
    -- recoit. Nul tant que personne ne l'a pose.
    ADD COLUMN IF NOT EXISTS secret_totp text,
    -- Tant qu'il vaut 0, le secret existe mais n'est pas exige : c'est l'etat
    -- dans lequel on verifie que son telephone donne bien le bon code AVANT de
    -- s'enfermer dehors.
    ADD COLUMN IF NOT EXISTS totp_actif bigint NOT NULL DEFAULT 0
        CHECK (totp_actif IN (0, 1)),
    ADD COLUMN IF NOT EXISTS totp_active_le text;

-- Un second facteur exige sans secret pose serait un compte inaccessible.
ALTER TABLE utilisateur DROP CONSTRAINT IF EXISTS ck_utilisateur_totp;
ALTER TABLE utilisateur ADD CONSTRAINT ck_utilisateur_totp
    CHECK (totp_actif = 0 OR secret_totp IS NOT NULL);

-- -----------------------------------------------------------------------------
-- LE JOURNAL DES CONNEXIONS.
--
-- Il repond a la question qu'on se pose apres coup, et a laquelle rien ne
-- repondait : « qui a essayé d'entrer, quand, et depuis quelle machine ». Le
-- journal d'audit, lui, ne suit que les changements de donnees — une tentative
-- refusee n'y laisse aucune trace.
--
-- ON Y ECRIT AUSSI LES ECHECS, et c'est tout l'interet : une serie d'echecs sur
-- plusieurs comptes depuis une meme adresse est la signature qu'on cherche.
-- Le mot de passe essaye n'y figure JAMAIS : il est souvent le bon mot de passe
-- d'un autre service.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_connexion (
    id_journal      text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    horodatage      text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    login           text    NOT NULL,
    -- Nul quand le login n'existe pas : on garde quand meme la trace.
    id_utilisateur  text    REFERENCES utilisateur(id_utilisateur),
    resultat        text    NOT NULL
                            CHECK (resultat IN ('REUSSITE','MOT_DE_PASSE','CODE','BLOQUE','INACTIF','INCONNU')),
    adresse_ip      text,
    agent           text
);

CREATE INDEX IF NOT EXISTS ix_journal_connexion_date  ON journal_connexion(horodatage DESC);
CREATE INDEX IF NOT EXISTS ix_journal_connexion_login ON journal_connexion(login, horodatage DESC);

ALTER TABLE journal_connexion OWNER TO gestionfil;
GRANT SELECT, INSERT ON journal_connexion TO gestionfil;

-- -----------------------------------------------------------------------------
-- LES CHAMPS SE DECLARENT, sinon ils sont masques pour tout le monde.
--
-- Ils relevent d'UTILISATEURS : le journal des connexions nomme des personnes,
-- et n'a rien a faire sous un module que tout le monde lit. `secret_totp` n'est
-- JAMAIS declare : aucun ecran ne doit pouvoir le rendre, meme a son
-- proprietaire, meme en lecture.
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
    ('UTILISATEURS', 'totp_actif',         'Double authentification', 'LECTURE', 0, 4010),
    ('UTILISATEURS', 'totp_active_le',     'Activée le',              'LECTURE', 0, 4020),
    ('UTILISATEURS', 'echecs_consecutifs', 'Échecs consécutifs',      'LECTURE', 0, 4030),
    ('UTILISATEURS', 'bloque_jusqu_a',     'Bloqué jusqu’à',          'LECTURE', 0, 4040),
    ('UTILISATEURS', 'dernier_echec',      'Dernier échec',           'LECTURE', 0, 4050),
    ('UTILISATEURS', 'resultat',           'Résultat',                'LECTURE', 0, 4060),
    ('UTILISATEURS', 'agent',              'Appareil',                'LECTURE', 0, 4070)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ, 'LECTURE'
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'UTILISATEURS' AND c.ordre BETWEEN 4010 AND 4070
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'UTILISATEURS'
   AND m.champ IN ('totp_actif','totp_active_le','echecs_consecutifs','bloque_jusqu_a',
                   'dernier_echec','resultat','agent')
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;
