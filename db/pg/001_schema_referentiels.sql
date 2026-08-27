-- =============================================================================
-- ERP GESTION FIL — Polyfashions Carpet Morocco
-- Module 1 : REFERENTIELS & PARAMETRES
-- Cible : PostgreSQL 16+   (porte depuis la version SQLite, voir db/pg/porter.py)
-- =============================================================================
-- CONVENTIONS (voir docs/ADR-001-decisions-fondatrices.md)
--   * Identifiants techniques : TEXT, UUID v4 canonique (DEFAULT fourni).
--   * Horodatages              : TEXT ISO-8601 UTC 'YYYY-MM-DDTHH:MM:SS.sssZ'.
--   * Dates calendaires        : TEXT 'YYYY-MM-DD'.
--   * Decimaux                 : REAL, arrondi explicite a l'ecriture.
--   * Booleens                 : INTEGER 0/1 + CHECK.
--   * JSON                     : TEXT + CHECK(json_valid(...)).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- entreprise
-- -----------------------------------------------------------------------------
CREATE TABLE entreprise (
    id_entreprise       text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    nom                 text    NOT NULL,
    adresse             text,
    ice                 text,
    rc                  text,
    identifiant_fiscal  text,
    tp                  text,
    cnss                text,
    capital             numeric(18,2),
    dirigeant           text,
    logo_url            text,
    devise_base         text    NOT NULL DEFAULT 'MAD',
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

-- -----------------------------------------------------------------------------
-- devise
-- -----------------------------------------------------------------------------
CREATE TABLE devise (
    code_devise         text    NOT NULL PRIMARY KEY CHECK (length(code_devise) = 3),
    libelle             text    NOT NULL,
    symbole             text,
    est_pivot           smallint NOT NULL DEFAULT 0 CHECK (est_pivot IN (0,1)),
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

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
    id_taux             text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_devise         text    NOT NULL REFERENCES devise(code_devise),
    taux                numeric(9,4)    NOT NULL CHECK (taux > 0),
    date_debut          text    NOT NULL,
    date_fin            text,
    source              text,
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    CHECK (date_fin IS NULL OR date_fin > date_debut)
);

CREATE INDEX ix_taux_devise_date ON taux_change(code_devise, date_debut DESC);
CREATE UNIQUE INDEX ux_taux_devise_debut ON taux_change(code_devise, date_debut);

-- -----------------------------------------------------------------------------
-- categorie_matiere
-- -----------------------------------------------------------------------------
CREATE TABLE categorie_matiere (
    code_categorie      text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    description         text,
    -- Role BOM auquel cette matiere est normalement destinee.
    --
    -- Le lien matiere -> role n'existait que dans les faits : le classeur emploie
    -- le polypropylene en Poil et le jute en Trame, sans jamais le dire. Le
    -- declarer permet a la saisie de composition de proposer les bonnes matieres
    -- pour le role choisi, au lieu des 124 references du catalogue.
    --
    -- C'est une AIDE A LA SAISIE, pas une contrainte : rien n'interdit d'employer
    -- une matiere hors de son role habituel, l'ecran offre de lever le filtre.
    code_role_defaut    text,
    ordre_affichage     integer NOT NULL DEFAULT 0,
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

-- -----------------------------------------------------------------------------
-- role_bom
-- -----------------------------------------------------------------------------
CREATE TABLE role_bom (
    code_role           text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    description         text,
    ordre_affichage     integer NOT NULL DEFAULT 0,
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

-- -----------------------------------------------------------------------------
-- magasin
-- inclure_mrp : exclut les zones non disponibles (quarantaine) du stock projete.
-- est_quarantaine : destination automatique des receptions non conformes.
-- -----------------------------------------------------------------------------
CREATE TABLE magasin (
    code_magasin        text    NOT NULL PRIMARY KEY,
    nom                 text    NOT NULL,
    type                text,
    adresse             text,
    responsable         text,
    inclure_mrp         smallint NOT NULL DEFAULT 1 CHECK (inclure_mrp IN (0,1)),
    est_quarantaine     smallint NOT NULL DEFAULT 0 CHECK (est_quarantaine IN (0,1)),
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    CHECK (est_quarantaine = 0 OR inclure_mrp = 0)
);

-- -----------------------------------------------------------------------------
-- type_mouvement
-- CORRECTION CDC : signe strictement -1 ou +1. Le type AJUST_INV "+/-1" du CDC
-- (E7) etait instockable ; il est scinde en AJUST_INV_POS / AJUST_INV_NEG.
-- Cf. ADR-001 D-05.
--   exige_prix   : le prix_kg_mad de la ligne est obligatoire.
--   impacte_cmup : ce type recalcule le CMUP (uniquement les entrees, R04).
-- -----------------------------------------------------------------------------
CREATE TABLE type_mouvement (
    code_type_mvt       text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    signe               integer NOT NULL CHECK (signe IN (-1, 1)),
    exige_prix          smallint NOT NULL DEFAULT 0 CHECK (exige_prix IN (0,1)),
    impacte_cmup        smallint NOT NULL DEFAULT 0 CHECK (impacte_cmup IN (0,1)),
    exige_of            smallint NOT NULL DEFAULT 0 CHECK (exige_of IN (0,1)),
    exige_motif_ligne   smallint NOT NULL DEFAULT 0 CHECK (exige_motif_ligne IN (0,1)),
    couleur             text,
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    -- Un type ne peut impacter le CMUP que s'il est une entree valorisee (R04).
    CHECK (impacte_cmup = 0 OR (signe = 1 AND exige_prix = 1))
);

-- -----------------------------------------------------------------------------
-- motif_mouvement
-- -----------------------------------------------------------------------------
CREATE TABLE motif_mouvement (
    code_motif          text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    categorie           text    NOT NULL,
    signe_default       integer NOT NULL CHECK (signe_default IN (-1, 1)),
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

-- -----------------------------------------------------------------------------
-- motif_ligne  (motifs de retour R1..R6 du CDC C08)
-- -----------------------------------------------------------------------------
CREATE TABLE motif_ligne (
    code_motif_ligne    text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    categorie           text,
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

-- -----------------------------------------------------------------------------
-- parametre
-- Valeurs par DEFAUT DE CREATION uniquement (CDC B3 / R09).
-- Les entites metier embarquent leur propre copie ; modifier un parametre
-- global n'affecte donc aucun enregistrement existant.
-- verrouille = 1 : valeur figee, toute modification est refusee (ex. P_DateSaisie).
-- -----------------------------------------------------------------------------
CREATE TABLE parametre (
    code_parametre      text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    valeur_courante     text    NOT NULL,
    type_donnee         text    NOT NULL CHECK (type_donnee IN ('ENTIER','DECIMAL','TEXTE','DATE','BOOLEEN')),
    unite               text,
    description         text,
    categorie           text,
    modifiable_par      text,
    verrouille          smallint NOT NULL DEFAULT 0 CHECK (verrouille IN (0,1)),
    date_derniere_modif text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur_modif text,
    motif_modif         text,
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

-- -----------------------------------------------------------------------------
-- parametre_historique
-- -----------------------------------------------------------------------------
CREATE TABLE parametre_historique (
    id_histo_param      text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_parametre      text    NOT NULL REFERENCES parametre(code_parametre),
    ancienne_valeur     text    NOT NULL,
    nouvelle_valeur     text    NOT NULL,
    date_modification   text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur      text,
    motif               text,
    ip_adresse          text,
    CHECK (ancienne_valeur IS DISTINCT FROM nouvelle_valeur)
);

CREATE INDEX ix_param_histo_code ON parametre_historique(code_parametre, date_modification DESC);

-- -----------------------------------------------------------------------------
-- transition_statut
-- AJOUT (absent du CDC). Machine a etats declarative : la seule facon d'empecher
-- les transitions arriere qui rejouent les cascades (ex. reception CLOTURE ->
-- VALIDE recomptait le stock). Cf. analyse §3 "Transitions d'etats non gardees".
-- -----------------------------------------------------------------------------
CREATE TABLE transition_statut (
    entite              text    NOT NULL,
    statut_source       text    NOT NULL,
    statut_cible        text    NOT NULL,
    role_requis         text,
    description         text,
    PRIMARY KEY (entite, statut_source, statut_cible)
);
