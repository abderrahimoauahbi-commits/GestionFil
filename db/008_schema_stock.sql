-- =============================================================================
-- Module 8 : STOCK & MOUVEMENTS
-- =============================================================================
-- CORRECTIONS MAJEURES :
--
--  * BL-1 : dans le CDC, le SEUL trigger ecrivant dans stock_magasin etait le
--    recalcul CMUP, garde par `IF signe = 1 AND prix > 0`. Consequences :
--      - aucune sortie (SORTIE_PROD, RETOUR_FOURN, TRANSFERT_SORTIE) n'affectait
--        le stock -> le stock ne diminuait JAMAIS ;
--      - les transferts, inseres sans prix, n'affectaient aucun des deux cotes
--        -> un transfert valide ne deplacait rien.
--    -> application du solde et recalcul du CMUP sont deux responsabilites
--       DISTINCTES (cf. 010_triggers.sql).
--
--  * Double encodage du signe : le CDC portait un signe sur type_mouvement ET
--    des quantites negatives dans ligne_mouvement (trigger J3). Source de
--    double negation. -> quantite_kg est TOUJOURS positive ; le sens vient
--    exclusivement de type_mouvement.signe.
--
--  * BL-8 : stock_magasin etait clefe sur (reference, magasin) SANS lot, ce qui
--    rendait la tracabilite "lot par lot" promise en A3 irrealisable.
--    -> table stock_lot. Determinant en tapis : le bain de teinture conditionne
--       la nuance, un melange de lots est un defaut qualite.
--
--  * transfert : le CDC declarait l'etat TERMINE en G5 mais son CHECK ne
--    l'autorisait pas. Etat ajoute.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- mouvement  (entete du grand livre) - IMMUABLE (R03)
-- -----------------------------------------------------------------------------
CREATE TABLE mouvement (
    id_mouvement        TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    numero_mouvement    TEXT    NOT NULL UNIQUE,
    date_mouvement      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    code_type_mvt       TEXT    NOT NULL REFERENCES type_mouvement(code_type_mvt),
    code_magasin        TEXT    NOT NULL REFERENCES magasin(code_magasin),
    code_motif          TEXT    NOT NULL REFERENCES motif_mouvement(code_motif),
    reference_document  TEXT,                       -- n° BC / reception / transfert / inventaire
    numero_of           TEXT,                       -- ordre de fabrication (C07)
    observations_globales TEXT,
    id_utilisateur      TEXT    NOT NULL REFERENCES utilisateur(id_utilisateur),  -- C09
    est_initial         INTEGER NOT NULL DEFAULT 0 CHECK (est_initial IN (0,1)),
    date_creation       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE INDEX ix_mvt_type    ON mouvement(code_type_mvt, date_mouvement DESC);
CREATE INDEX ix_mvt_magasin ON mouvement(code_magasin, date_mouvement DESC);
CREATE INDEX ix_mvt_date    ON mouvement(date_mouvement DESC);
CREATE INDEX ix_mvt_doc     ON mouvement(reference_document);

-- -----------------------------------------------------------------------------
-- ligne_mouvement  (detail du grand livre) - IMMUABLE (R03)
-- quantite_kg > 0 TOUJOURS : le sens du mouvement vient de type_mouvement.signe.
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_mouvement (
    id_ligne_mouvement  TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    id_mouvement        TEXT    NOT NULL REFERENCES mouvement(id_mouvement) ON DELETE CASCADE,
    ligne_numero        INTEGER NOT NULL CHECK (ligne_numero > 0),
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),

    quantite_kg         REAL    NOT NULL CHECK (quantite_kg > 0),
    prix_kg_mad         REAL    CHECK (prix_kg_mad IS NULL OR prix_kg_mad > 0),
    total_mad           REAL    GENERATED ALWAYS AS (quantite_kg * COALESCE(prix_kg_mad, 0)) VIRTUAL,

    -- Saisie d'origine conservee pour l'audit (R01 : le kg reste canonique)
    quantite_saisie     REAL    CHECK (quantite_saisie IS NULL OR quantite_saisie > 0),
    unite_saisie        TEXT    CHECK (unite_saisie IS NULL OR unite_saisie IN ('kg','Palette','Bobine','ml')),
    facteur_conversion  REAL    CHECK (facteur_conversion IS NULL OR facteur_conversion > 0),

    lot_fournisseur     TEXT,
    date_fabrication    TEXT,
    date_peremption     TEXT,
    code_motif_ligne    TEXT    REFERENCES motif_ligne(code_motif_ligne),
    numero_of           TEXT,
    statut_qualite      TEXT    CHECK (statut_qualite IS NULL OR statut_qualite IN ('CONFORME','NON_CONFORME','QUARANTAINE')),

    UNIQUE (id_mouvement, ligne_numero),
    -- Si l'unite de saisie est renseignee, la conversion doit etre coherente
    CHECK (quantite_saisie IS NULL OR facteur_conversion IS NULL
           OR abs(quantite_kg - quantite_saisie * facteur_conversion) < 0.001)
) STRICT;

CREATE INDEX ix_lmvt_ref ON ligne_mouvement(code_reference);
CREATE INDEX ix_lmvt_mvt ON ligne_mouvement(id_mouvement);
CREATE INDEX ix_lmvt_lot ON ligne_mouvement(code_reference, lot_fournisseur);

-- -----------------------------------------------------------------------------
-- stock_magasin  (solde agrege, DERIVE du grand livre)
-- Cache recalculable : en cas de derive, la verite reste ligne_mouvement.
-- Cf. controle C15.
-- -----------------------------------------------------------------------------
CREATE TABLE stock_magasin (
    id_stock            TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),
    code_magasin        TEXT    NOT NULL REFERENCES magasin(code_magasin),
    quantite_kg         REAL    NOT NULL DEFAULT 0 CHECK (quantite_kg >= 0),   -- R02
    cmup_mad            REAL    CHECK (cmup_mad IS NULL OR cmup_mad >= 0),      -- RG-08 : NULL si aucun achat
    valeur_mad          REAL    GENERATED ALWAYS AS (quantite_kg * COALESCE(cmup_mad, 0)) VIRTUAL,
    date_derniere_entree TEXT,
    date_derniere_sortie TEXT,
    date_dernier_inventaire TEXT,
    date_maj            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (code_reference, code_magasin)
) STRICT;

CREATE INDEX ix_stock_ref     ON stock_magasin(code_reference);
CREATE INDEX ix_stock_magasin ON stock_magasin(code_magasin);

-- -----------------------------------------------------------------------------
-- stock_lot  (AJOUT : correction BL-8 - tracabilite par lot)
-- Alimente uniquement pour les references dont suivi_lot = 1.
-- -----------------------------------------------------------------------------
CREATE TABLE stock_lot (
    id_stock_lot        TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),
    code_magasin        TEXT    NOT NULL REFERENCES magasin(code_magasin),
    lot_fournisseur     TEXT    NOT NULL,
    quantite_kg         REAL    NOT NULL DEFAULT 0 CHECK (quantite_kg >= 0),
    prix_entree_mad     REAL    CHECK (prix_entree_mad IS NULL OR prix_entree_mad >= 0),
    date_fabrication    TEXT,
    date_peremption     TEXT,
    date_premiere_entree TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    date_maj            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (code_reference, code_magasin, lot_fournisseur)
) STRICT;

-- Index FEFO : sert fn_suggerer_lots_fefo (vue v_lot_fefo)
CREATE INDEX ix_stock_lot_fefo ON stock_lot(code_reference, code_magasin, date_peremption)
    WHERE quantite_kg > 0;

-- -----------------------------------------------------------------------------
-- transfert
-- -----------------------------------------------------------------------------
CREATE TABLE transfert (
    id_transfert        TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    numero_transfert    TEXT    NOT NULL UNIQUE,
    date_transfert      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    code_magasin_source TEXT    NOT NULL REFERENCES magasin(code_magasin),
    code_magasin_dest   TEXT    NOT NULL REFERENCES magasin(code_magasin),
    statut              TEXT    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','VALIDE','TERMINE','ANNULE')),
    id_utilisateur      TEXT    NOT NULL REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_reception TEXT REFERENCES utilisateur(id_utilisateur),

    -- Trois dates distinctes, et les confondre fait perdre le delai de route :
    --   date_transfert      quand le document a ete etabli ;
    --   date_sortie         quand la marchandise a REELLEMENT quitte le source ;
    --   date_reception_dest quand quelqu'un a constate son arrivee.
    date_sortie         TEXT,
    date_reception_dest TEXT,

    -- Qui repond de la marchandise pendant le trajet : chauffeur, chef de
    -- quai, transporteur. Distinct des comptes applicatifs, qui disent qui a
    -- SAISI — pas qui etait au volant.
    responsable         TEXT,
    transporteur        TEXT,

    observations        TEXT,
    CHECK (code_magasin_source <> code_magasin_dest)
) STRICT;

-- -----------------------------------------------------------------------------
-- ligne_transfert
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_transfert (
    id_ligne_transfert  TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    id_transfert        TEXT    NOT NULL REFERENCES transfert(id_transfert) ON DELETE CASCADE,
    ligne_numero        INTEGER NOT NULL CHECK (ligne_numero > 0),
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),
    quantite_kg         REAL    NOT NULL CHECK (quantite_kg > 0),
    quantite_saisie     REAL,
    unite_saisie        TEXT    CHECK (unite_saisie IS NULL OR unite_saisie IN ('kg','Palette','Bobine','ml')),
    facteur_conversion  REAL    CHECK (facteur_conversion IS NULL OR facteur_conversion > 0),
    lot_fournisseur     TEXT,

    -- Conditionnement REELLEMENT charge, compte au quai.
    --
    -- Ce n'est pas la conversion de `quantite_kg` : un camion emporte trois
    -- palettes completes et quatre bobines isolees, et c'est ce decompte-la que
    -- le magasin destinataire verifiera au dechargement. Le deduire du poids
    -- donnerait un nombre juste en moyenne et faux sur chaque envoi.
    nb_bobines          INTEGER CHECK (nb_bobines IS NULL OR nb_bobines >= 0),
    nb_palettes         INTEGER CHECK (nb_palettes IS NULL OR nb_palettes >= 0),

    -- CMUP du magasin SOURCE, fige au moment de l'expedition.
    --
    -- La valeur voyage avec la marchandise. Relire le CMUP source a l'arrivee
    -- ferait entrer le lot a un prix qu'il n'a jamais eu, des qu'une reception
    -- fournisseur intervient pendant le trajet — et le CMUP du destinataire,
    -- qui est une moyenne ponderee, s'en trouverait fausse durablement.
    prix_kg_mad         REAL    CHECK (prix_kg_mad IS NULL OR prix_kg_mad > 0),

    UNIQUE (id_transfert, ligne_numero)
) STRICT;

-- -----------------------------------------------------------------------------
-- valorisation_stock  (photo periodique)
-- -----------------------------------------------------------------------------
CREATE TABLE valorisation_stock (
    id_valo             TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    date_valorisation   TEXT    NOT NULL,
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),
    code_magasin        TEXT    NOT NULL REFERENCES magasin(code_magasin),
    quantite_kg         REAL    NOT NULL,
    cmup_mad            REAL    NOT NULL,
    valeur_mad          REAL    NOT NULL,
    methode             TEXT    NOT NULL DEFAULT 'CMUP' CHECK (methode IN ('CMUP')),
    date_calcul         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (date_valorisation, code_reference, code_magasin)
) STRICT;

-- -----------------------------------------------------------------------------
-- inventaire
-- -----------------------------------------------------------------------------
CREATE TABLE inventaire (
    id_inventaire       TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    numero_inventaire   TEXT    NOT NULL UNIQUE,
    date_inventaire     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    type_inventaire     TEXT    NOT NULL CHECK (type_inventaire IN ('GLOBAL','TOURNANT','CIBLE')),
    code_magasin        TEXT    NOT NULL REFERENCES magasin(code_magasin),
    statut              TEXT    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','EN_COURS','CLOTURE','ANNULE')),
    id_utilisateur_responsable TEXT NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    date_cloture        TEXT,
    CHECK (statut <> 'CLOTURE' OR date_cloture IS NOT NULL)
) STRICT;

-- -----------------------------------------------------------------------------
-- ligne_inventaire
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_inventaire (
    id_ligne_inv        TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    id_inventaire       TEXT    NOT NULL REFERENCES inventaire(id_inventaire) ON DELETE CASCADE,
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),
    code_magasin        TEXT    NOT NULL REFERENCES magasin(code_magasin),
    lot_fournisseur     TEXT,
    quantite_theorique_kg REAL  NOT NULL CHECK (quantite_theorique_kg >= 0),
    quantite_comptee_kg REAL    CHECK (quantite_comptee_kg IS NULL OR quantite_comptee_kg >= 0),
    ecart_kg            REAL    GENERATED ALWAYS AS (quantite_comptee_kg - quantite_theorique_kg) VIRTUAL,
    ecart_pct           REAL    GENERATED ALWAYS AS (
                            CASE WHEN quantite_theorique_kg = 0 THEN NULL
                                 ELSE (quantite_comptee_kg - quantite_theorique_kg) / quantite_theorique_kg * 100.0
                            END) VIRTUAL,
    ecart_mad           REAL,
    motif_ecart         TEXT,
    statut_ligne        TEXT    NOT NULL DEFAULT 'A_TRAITER'
                                CHECK (statut_ligne IN ('A_TRAITER','COMPTE','AJUSTE','IGNORE')),
    id_utilisateur_comptage TEXT REFERENCES utilisateur(id_utilisateur),
    date_comptage       TEXT,
    UNIQUE (id_inventaire, code_reference, code_magasin, lot_fournisseur),
    CHECK (statut_ligne = 'A_TRAITER' OR quantite_comptee_kg IS NOT NULL)
) STRICT;

CREATE INDEX ix_ligne_inv_ref ON ligne_inventaire(code_reference);
