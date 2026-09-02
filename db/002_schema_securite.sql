-- =============================================================================
-- Module 2 : SECURITE (roles, utilisateurs, permissions, droits par champ)
-- =============================================================================
-- DEUX NIVEAUX D'AUTORISATION, DELIBEREMENT DISTINCTS :
--
--   1. ACCES MODULE  -> porte par le ROLE (matrice CDC D2).
--      Peut-on lire / ecrire / valider dans le module Catalogue ?
--
--   2. VISIBILITE CHAMP -> portee par l'UTILISATEUR.
--      Sur l'ecran Catalogue, cet utilisateur voit-il le prix ?
--      Trois etats : MASQUE / LECTURE / ECRITURE.
--
-- Le niveau 2 est configure utilisateur par utilisateur : deux magasiniers
-- peuvent avoir des grilles differentes. Les modeles par role (table
-- modele_droit_champ) ne servent qu'a INITIALISER une grille en un clic ; ils
-- ne sont jamais consultes lors d'une requete.
--
-- Casbin est ecarte : deux moteurs d'autorisation signifient deux verites
-- possibles sur qui a le droit de faire quoi (ADR-001 D-09).
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- role_utilisateur
-- -----------------------------------------------------------------------------
CREATE TABLE role_utilisateur (
    code_role_user      TEXT    NOT NULL PRIMARY KEY,
    libelle             TEXT    NOT NULL,
    description         TEXT,
    niveau_hierarchique INTEGER NOT NULL DEFAULT 0,
    -- Plafond de validation d'un BC en MAD (CDC B4 regle 3). NULL = illimite.
    plafond_validation_bc_mad REAL,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- -----------------------------------------------------------------------------
-- utilisateur
-- -----------------------------------------------------------------------------
CREATE TABLE utilisateur (
    id_utilisateur      TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    code_role_user      TEXT    NOT NULL REFERENCES role_utilisateur(code_role_user),
    login               TEXT    NOT NULL UNIQUE,
    mot_de_passe_hash   TEXT    NOT NULL,          -- Argon2id
    nom                 TEXT    NOT NULL,
    email               TEXT,
    telephone           TEXT,
    magasin_principal   TEXT    REFERENCES magasin(code_magasin),
    date_creation       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    derniere_connexion  TEXT,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

CREATE INDEX ix_utilisateur_role ON utilisateur(code_role_user);

-- -----------------------------------------------------------------------------
-- permission : acces MODULE, par role (matrice CDC D2)
-- action : LIRE | ECRIRE | VALIDER
-- Le CDC ne distinguait que R/W ; VALIDER est ajoute car toute la SoD (B4)
-- repose sur une permission de validation distincte de l'ecriture.
-- -----------------------------------------------------------------------------
CREATE TABLE permission (
    id_permission       TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    code_role_user      TEXT    NOT NULL REFERENCES role_utilisateur(code_role_user) ON DELETE CASCADE,
    module              TEXT    NOT NULL,
    action              TEXT    NOT NULL CHECK (action IN ('LIRE','ECRIRE','VALIDER')),
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    UNIQUE (code_role_user, module, action)
) STRICT;

-- -----------------------------------------------------------------------------
-- champ_configurable
-- Catalogue des champs dont la visibilite se pilote. Sert a trois choses :
--   * alimenter l'ecran d'administration (il faut bien savoir quoi proposer) ;
--   * fournir le niveau applique quand un utilisateur n'a AUCUNE ligne pour ce
--     champ — sans quoi l'ajout d'un champ au produit le rendrait invisible a
--     tout le monde jusqu'a reconfiguration manuelle de chaque compte ;
--   * marquer les champs sensibles (prix, valorisation) pour les mettre en
--     evidence dans l'interface.
-- -----------------------------------------------------------------------------
CREATE TABLE champ_configurable (
    module              TEXT    NOT NULL,
    champ               TEXT    NOT NULL,
    libelle             TEXT    NOT NULL,
    niveau_defaut       TEXT    NOT NULL DEFAULT 'LECTURE'
                                CHECK (niveau_defaut IN ('MASQUE','LECTURE','ECRITURE')),
    sensible            INTEGER NOT NULL DEFAULT 0 CHECK (sensible IN (0,1)),
    ordre               INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (module, champ)
) STRICT;

CREATE INDEX ix_champ_conf_module ON champ_configurable(module, ordre);

-- -----------------------------------------------------------------------------
-- droit_champ : SOURCE DE VERITE de la visibilite des champs, par UTILISATEUR
--
--   MASQUE   : le champ n'est ni renvoye par l'API ni rendu a l'ecran.
--   LECTURE  : renvoye, affiche, mais toute tentative de modification est
--              rejetee par le SERVEUR (pas seulement grisee a l'ecran).
--   ECRITURE : modifiable, sous reserve du droit ECRIRE sur le module.
--
-- Absence de ligne = champ_configurable.niveau_defaut.
-- -----------------------------------------------------------------------------
CREATE TABLE droit_champ (
    id_utilisateur      TEXT    NOT NULL REFERENCES utilisateur(id_utilisateur) ON DELETE CASCADE,
    module              TEXT    NOT NULL,
    champ               TEXT    NOT NULL,
    niveau              TEXT    NOT NULL CHECK (niveau IN ('MASQUE','LECTURE','ECRITURE')),
    date_modification   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    id_utilisateur_modif TEXT   REFERENCES utilisateur(id_utilisateur),
    PRIMARY KEY (id_utilisateur, module, champ),
    FOREIGN KEY (module, champ) REFERENCES champ_configurable(module, champ) ON DELETE CASCADE
) STRICT;

CREATE INDEX ix_droit_champ_module ON droit_champ(id_utilisateur, module);

-- -----------------------------------------------------------------------------
-- modele_droit_champ
-- Grilles types par role. Servent UNIQUEMENT a initialiser ou reinitialiser la
-- grille d'un utilisateur ("appliquer le modele du role"). Sans elles, chaque
-- nouvel employe repartirait d'une grille vide : 16 modules x ~180 champs a
-- saisir a la main.
-- -----------------------------------------------------------------------------
CREATE TABLE modele_droit_champ (
    code_role_user      TEXT    NOT NULL REFERENCES role_utilisateur(code_role_user) ON DELETE CASCADE,
    module              TEXT    NOT NULL,
    champ               TEXT    NOT NULL,
    niveau              TEXT    NOT NULL CHECK (niveau IN ('MASQUE','LECTURE','ECRITURE')),
    PRIMARY KEY (code_role_user, module, champ),
    FOREIGN KEY (module, champ) REFERENCES champ_configurable(module, champ) ON DELETE CASCADE
) STRICT;
