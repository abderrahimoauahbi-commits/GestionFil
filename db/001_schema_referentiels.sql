-- =============================================================================
-- ERP GESTION FIL — Polyfashions Carpet Morocco
-- Module 1 : REFERENTIELS & PARAMETRES
-- Cible dev : SQLite 3.51+  (tables STRICT)  |  Cible prod : PostgreSQL 16
-- =============================================================================
-- CONVENTIONS (voir docs/ADR-001-decisions-fondatrices.md)
--   * Identifiants techniques : TEXT, UUID v4 canonique (DEFAULT fourni).
--   * Horodatages              : TEXT ISO-8601 UTC 'YYYY-MM-DDTHH:MM:SS.sssZ'.
--   * Dates calendaires        : TEXT 'YYYY-MM-DD'.
--   * Decimaux                 : REAL, arrondi explicite a l'ecriture.
--   * Booleens                 : INTEGER 0/1 + CHECK.
--   * JSON                     : TEXT + CHECK(json_valid(...)).
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- entreprise
-- -----------------------------------------------------------------------------
CREATE TABLE entreprise (
    id_entreprise       TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    nom                 TEXT    NOT NULL,
    adresse             TEXT,
    ice                 TEXT,
    rc                  TEXT,
    identifiant_fiscal  TEXT,
    tp                  TEXT,
    cnss                TEXT,
    capital             REAL,
    dirigeant           TEXT,
    logo_url            TEXT,
    devise_base         TEXT    NOT NULL DEFAULT 'MAD',
    date_creation       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- -----------------------------------------------------------------------------
-- devise
-- -----------------------------------------------------------------------------
CREATE TABLE devise (
    code_devise         TEXT    NOT NULL PRIMARY KEY CHECK (length(code_devise) = 3),
    libelle             TEXT    NOT NULL,
    symbole             TEXT,
    est_pivot           INTEGER NOT NULL DEFAULT 0 CHECK (est_pivot IN (0,1)),
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- Une seule devise pivot possible (MAD). Corrige l'ambiguite CDC E8 / A4.
CREATE UNIQUE INDEX ux_devise_pivot ON devise(est_pivot) WHERE est_pivot = 1;

-- -----------------------------------------------------------------------------
-- taux_change
-- CORRECTION CDC : source de verite UNIQUE du taux de change.
-- Les parametres P_TauxEURMAD / P_TauxUSDMAD du CDC (A4) sont supprimes : ils
-- dupliquaient cette table (contradiction E8 vs J4). Cf. ADR-001 D-07.
-- Periodes non chevauchantes garanties par trg_taux_change_chevauchement.
-- -----------------------------------------------------------------------------
CREATE TABLE taux_change (
    id_taux             TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    code_devise         TEXT    NOT NULL REFERENCES devise(code_devise),
    taux                REAL    NOT NULL CHECK (taux > 0),
    date_debut          TEXT    NOT NULL,
    date_fin            TEXT,
    source              TEXT,
    date_creation       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (date_fin IS NULL OR date_fin > date_debut)
) STRICT;

CREATE INDEX ix_taux_devise_date ON taux_change(code_devise, date_debut DESC);
CREATE UNIQUE INDEX ux_taux_devise_debut ON taux_change(code_devise, date_debut);

-- -----------------------------------------------------------------------------
-- categorie_matiere
-- -----------------------------------------------------------------------------
CREATE TABLE categorie_matiere (
    code_categorie      TEXT    NOT NULL PRIMARY KEY,
    libelle             TEXT    NOT NULL,
    description         TEXT,
    -- Role BOM auquel cette matiere est normalement destinee.
    --
    -- Le lien matiere -> role n'existait que dans les faits : le classeur emploie
    -- le polypropylene en Poil et le jute en Trame, sans jamais le dire. Le
    -- declarer permet a la saisie de composition de proposer les bonnes matieres
    -- pour le role choisi, au lieu des 124 references du catalogue.
    --
    -- C'est une AIDE A LA SAISIE, pas une contrainte : rien n'interdit d'employer
    -- une matiere hors de son role habituel, l'ecran offre de lever le filtre.
    code_role_defaut    TEXT    REFERENCES role_bom(code_role),
    ordre_affichage     INTEGER NOT NULL DEFAULT 0,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- -----------------------------------------------------------------------------
-- role_bom
-- -----------------------------------------------------------------------------
CREATE TABLE role_bom (
    code_role           TEXT    NOT NULL PRIMARY KEY,
    libelle             TEXT    NOT NULL,
    description         TEXT,
    ordre_affichage     INTEGER NOT NULL DEFAULT 0,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- -----------------------------------------------------------------------------
-- magasin
-- inclure_mrp : exclut les zones non disponibles (quarantaine) du stock projete.
-- est_quarantaine : destination automatique des receptions non conformes.
-- -----------------------------------------------------------------------------
CREATE TABLE magasin (
    code_magasin        TEXT    NOT NULL PRIMARY KEY,
    nom                 TEXT    NOT NULL,
    type                TEXT,
    adresse             TEXT,
    responsable         TEXT,
    inclure_mrp         INTEGER NOT NULL DEFAULT 1 CHECK (inclure_mrp IN (0,1)),
    est_quarantaine     INTEGER NOT NULL DEFAULT 0 CHECK (est_quarantaine IN (0,1)),
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    CHECK (est_quarantaine = 0 OR inclure_mrp = 0)
) STRICT;

-- -----------------------------------------------------------------------------
-- type_mouvement
-- CORRECTION CDC : signe strictement -1 ou +1. Le type AJUST_INV "+/-1" du CDC
-- (E7) etait instockable ; il est scinde en AJUST_INV_POS / AJUST_INV_NEG.
-- Cf. ADR-001 D-05.
--   exige_prix   : le prix_kg_mad de la ligne est obligatoire.
--   impacte_cmup : ce type recalcule le CMUP (uniquement les entrees, R04).
-- -----------------------------------------------------------------------------
CREATE TABLE type_mouvement (
    code_type_mvt       TEXT    NOT NULL PRIMARY KEY,
    libelle             TEXT    NOT NULL,
    signe               INTEGER NOT NULL CHECK (signe IN (-1, 1)),
    exige_prix          INTEGER NOT NULL DEFAULT 0 CHECK (exige_prix IN (0,1)),
    impacte_cmup        INTEGER NOT NULL DEFAULT 0 CHECK (impacte_cmup IN (0,1)),
    exige_of            INTEGER NOT NULL DEFAULT 0 CHECK (exige_of IN (0,1)),
    exige_motif_ligne   INTEGER NOT NULL DEFAULT 0 CHECK (exige_motif_ligne IN (0,1)),
    couleur             TEXT,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    -- Un type ne peut impacter le CMUP que s'il est une entree valorisee (R04).
    CHECK (impacte_cmup = 0 OR (signe = 1 AND exige_prix = 1))
) STRICT;

-- -----------------------------------------------------------------------------
-- motif_mouvement
-- -----------------------------------------------------------------------------
CREATE TABLE motif_mouvement (
    code_motif          TEXT    NOT NULL PRIMARY KEY,
    libelle             TEXT    NOT NULL,
    categorie           TEXT    NOT NULL,
    signe_default       INTEGER NOT NULL CHECK (signe_default IN (-1, 1)),
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- -----------------------------------------------------------------------------
-- motif_ligne  (motifs de retour R1..R6 du CDC C08)
-- -----------------------------------------------------------------------------
CREATE TABLE motif_ligne (
    code_motif_ligne    TEXT    NOT NULL PRIMARY KEY,
    libelle             TEXT    NOT NULL,
    categorie           TEXT,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- -----------------------------------------------------------------------------
-- parametre
-- Valeurs par DEFAUT DE CREATION uniquement (CDC B3 / R09).
-- Les entites metier embarquent leur propre copie ; modifier un parametre
-- global n'affecte donc aucun enregistrement existant.
-- verrouille = 1 : valeur figee, toute modification est refusee (ex. P_DateSaisie).
-- -----------------------------------------------------------------------------
CREATE TABLE parametre (
    code_parametre      TEXT    NOT NULL PRIMARY KEY,
    libelle             TEXT    NOT NULL,
    valeur_courante     TEXT    NOT NULL,
    type_donnee         TEXT    NOT NULL CHECK (type_donnee IN ('ENTIER','DECIMAL','TEXTE','DATE','BOOLEEN')),
    unite               TEXT,
    description         TEXT,
    categorie           TEXT,
    modifiable_par      TEXT,
    verrouille          INTEGER NOT NULL DEFAULT 0 CHECK (verrouille IN (0,1)),
    date_derniere_modif TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    id_utilisateur_modif TEXT,
    motif_modif         TEXT,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- -----------------------------------------------------------------------------
-- parametre_historique
-- -----------------------------------------------------------------------------
CREATE TABLE parametre_historique (
    id_histo_param      TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    code_parametre      TEXT    NOT NULL REFERENCES parametre(code_parametre),
    ancienne_valeur     TEXT    NOT NULL,
    nouvelle_valeur     TEXT    NOT NULL,
    date_modification   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    id_utilisateur      TEXT,
    motif               TEXT,
    ip_adresse          TEXT,
    CHECK (ancienne_valeur IS NOT nouvelle_valeur)
) STRICT;

CREATE INDEX ix_param_histo_code ON parametre_historique(code_parametre, date_modification DESC);

-- -----------------------------------------------------------------------------
-- transition_statut
-- AJOUT (absent du CDC). Machine a etats declarative : la seule facon d'empecher
-- les transitions arriere qui rejouent les cascades (ex. reception CLOTURE ->
-- VALIDE recomptait le stock). Cf. analyse §3 "Transitions d'etats non gardees".
-- -----------------------------------------------------------------------------
CREATE TABLE transition_statut (
    entite              TEXT    NOT NULL,
    statut_source       TEXT    NOT NULL,
    statut_cible        TEXT    NOT NULL,
    role_requis         TEXT,
    description         TEXT,
    PRIMARY KEY (entite, statut_source, statut_cible)
) STRICT;
