-- =============================================================================
-- Module 3 : CATALOGUE & FOURNISSEURS
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- fournisseur
-- -----------------------------------------------------------------------------
CREATE TABLE fournisseur (
    code_fournisseur    TEXT    NOT NULL PRIMARY KEY,
    nom                 TEXT    NOT NULL,
    contact_principal   TEXT,
    telephone           TEXT,
    email               TEXT,
    adresse             TEXT,
    ville               TEXT,
    pays                TEXT    NOT NULL DEFAULT 'Maroc',
    delai_livraison_jours INTEGER CHECK (delai_livraison_jours IS NULL OR delai_livraison_jours > 0),
    conditions_paiement TEXT,
    delai_paiement_jours INTEGER,                  -- alimente le DPO du cockpit
    code_devise         TEXT    REFERENCES devise(code_devise),
    incoterm            TEXT,
    transporteur        TEXT,
    note_globale        REAL    CHECK (note_globale IS NULL OR note_globale BETWEEN 0 AND 100),
    delai_reel_moyen_jours REAL,
    tolerance_pesee_pct REAL    CHECK (tolerance_pesee_pct IS NULL OR tolerance_pesee_pct >= 0),
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    date_creation       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- -----------------------------------------------------------------------------
-- contact_fournisseur
-- -----------------------------------------------------------------------------
CREATE TABLE contact_fournisseur (
    id_contact          TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    code_fournisseur    TEXT    NOT NULL REFERENCES fournisseur(code_fournisseur) ON DELETE CASCADE,
    nom                 TEXT    NOT NULL,
    fonction            TEXT,
    email               TEXT,
    telephone           TEXT,
    est_principal       INTEGER NOT NULL DEFAULT 0 CHECK (est_principal IN (0,1)),
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

CREATE UNIQUE INDEX ux_contact_principal
    ON contact_fournisseur(code_fournisseur) WHERE est_principal = 1;

-- -----------------------------------------------------------------------------
-- reference  (catalogue matieres premieres)
--
-- CORRECTIONS CDC :
--  * code_reference n'est plus le libelle commercial. Le CDC utilisait
--    VARCHAR(20) alors que tous ses exemples font 30+ caracteres
--    ("PP FRZ-2900 Dtex-Beige 44360-Hs"). Code court technique + designation.
--  * facteur_kg est une COLONNE GENEREE : la conversion vers l'unite canonique
--    (R01) devient structurelle. Combinee aux CHECK ci-dessous, elle ne peut
--    jamais etre NULL -> le "fallback silencieux x1" interdit par B2 est
--    physiquement impossible.
--  * prix_catalogue_kg generalise la regle E2 (prix ramene au kg) aux 4 unites.
--  * suivi_lot : active la tracabilite par lot (A3). Cf. table stock_lot.
-- -----------------------------------------------------------------------------
CREATE TABLE reference (
    code_reference      TEXT    NOT NULL PRIMARY KEY,
    code_categorie      TEXT    NOT NULL REFERENCES categorie_matiere(code_categorie),
    code_fournisseur    TEXT    NOT NULL REFERENCES fournisseur(code_fournisseur),
    designation         TEXT    NOT NULL,
    type_fil            TEXT,
    couleur             TEXT,
    titrage             TEXT,

    -- Unite de saisie et facteurs de conversion vers le kg
    unite_catalogue     TEXT    NOT NULL CHECK (unite_catalogue IN ('kg','Palette','Bobine','ml')),
    poids_bobine_kg     REAL    CHECK (poids_bobine_kg IS NULL OR poids_bobine_kg > 0),
    bobines_par_palette INTEGER CHECK (bobines_par_palette IS NULL OR bobines_par_palette > 0),
    densite_kg_ml       REAL    CHECK (densite_kg_ml IS NULL OR densite_kg_ml > 0),
    facteur_kg          REAL    GENERATED ALWAYS AS (
                            CASE unite_catalogue
                                WHEN 'kg'      THEN 1.0
                                WHEN 'Bobine'  THEN poids_bobine_kg
                                WHEN 'Palette' THEN poids_bobine_kg * bobines_par_palette
                                WHEN 'ml'      THEN densite_kg_ml
                            END) VIRTUAL,

    -- Prix
    prix_catalogue      REAL    NOT NULL CHECK (prix_catalogue > 0),   -- par unite_catalogue
    code_devise_catalogue TEXT  NOT NULL REFERENCES devise(code_devise),
    date_prix_catalogue TEXT,
    prix_catalogue_kg   REAL    GENERATED ALWAYS AS (
                            prix_catalogue / CASE unite_catalogue
                                WHEN 'kg'      THEN 1.0
                                WHEN 'Bobine'  THEN poids_bobine_kg
                                WHEN 'Palette' THEN poids_bobine_kg * bobines_par_palette
                                WHEN 'ml'      THEN densite_kg_ml
                            END) VIRTUAL,

    -- Politique de reapprovisionnement (parametres LOCAUX, cf. B3/R09)
    stock_min_kg        REAL    CHECK (stock_min_kg IS NULL OR stock_min_kg >= 0),
    couverture_min_mois REAL    CHECK (couverture_min_mois IS NULL OR couverture_min_mois >= 0),
    marge_securite_pct  REAL    CHECK (marge_securite_pct IS NULL OR marge_securite_pct >= 0),
    moq_kg              REAL    CHECK (moq_kg IS NULL OR moq_kg > 0),
    multiple_achat_kg   REAL    CHECK (multiple_achat_kg IS NULL OR multiple_achat_kg > 0),

    -- Classification (calculee par fn_classifier_abc_xyz cote applicatif)
    classe_abc          TEXT    CHECK (classe_abc IS NULL OR classe_abc IN ('A','B','C')),
    classe_xyz          TEXT    CHECK (classe_xyz IS NULL OR classe_xyz IN ('X','Y','Z')),
    date_dernier_abc    TEXT,

    -- Valorisation (RG-08 : NULL tant qu'aucune reception reelle)
    cmup_mad            REAL    CHECK (cmup_mad IS NULL OR cmup_mad >= 0),
    date_dernier_cmup   TEXT,

    suivi_lot           INTEGER NOT NULL DEFAULT 0 CHECK (suivi_lot IN (0,1)),
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    date_creation       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    id_utilisateur_creation TEXT REFERENCES utilisateur(id_utilisateur),

    -- R01 : facteur de conversion obligatoire selon l'unite. Aucun fallback.
    CHECK (unite_catalogue <> 'Bobine'  OR poids_bobine_kg IS NOT NULL),
    CHECK (unite_catalogue <> 'Palette' OR (poids_bobine_kg IS NOT NULL AND bobines_par_palette IS NOT NULL)),
    CHECK (unite_catalogue <> 'ml'      OR densite_kg_ml IS NOT NULL),
    -- Un multiple d'achat doit etre coherent avec le MOQ
    CHECK (moq_kg IS NULL OR multiple_achat_kg IS NULL OR moq_kg >= multiple_achat_kg)
) STRICT;

CREATE INDEX ix_ref_categorie   ON reference(code_categorie);
CREATE INDEX ix_ref_fournisseur ON reference(code_fournisseur);
CREATE INDEX ix_ref_abc         ON reference(classe_abc) WHERE actif = 1;

-- -----------------------------------------------------------------------------
-- groupe_equiv  (substitution, CDC F8)
-- -----------------------------------------------------------------------------
CREATE TABLE groupe_equiv (
    code_groupe_equiv   TEXT    NOT NULL PRIMARY KEY,
    libelle             TEXT    NOT NULL,
    description         TEXT,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
) STRICT;

-- -----------------------------------------------------------------------------
-- reference_groupe_equiv
-- -----------------------------------------------------------------------------
CREATE TABLE reference_groupe_equiv (
    id_ref_grp          TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),
    code_groupe_equiv   TEXT    NOT NULL REFERENCES groupe_equiv(code_groupe_equiv) ON DELETE CASCADE,
    priorite            INTEGER NOT NULL CHECK (priorite > 0),
    est_preferentielle  INTEGER NOT NULL DEFAULT 0 CHECK (est_preferentielle IN (0,1)),
    date_debut          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    date_fin            TEXT,
    actif               INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    UNIQUE (code_reference, code_groupe_equiv),
    CHECK (date_fin IS NULL OR date_fin > date_debut)
) STRICT;

CREATE INDEX ix_grp_equiv_priorite ON reference_groupe_equiv(code_groupe_equiv, priorite);
-- Une seule reference preferentielle et une seule priorite N par groupe
CREATE UNIQUE INDEX ux_grp_equiv_pref ON reference_groupe_equiv(code_groupe_equiv) WHERE est_preferentielle = 1;
CREATE UNIQUE INDEX ux_grp_equiv_prio ON reference_groupe_equiv(code_groupe_equiv, priorite) WHERE actif = 1;
