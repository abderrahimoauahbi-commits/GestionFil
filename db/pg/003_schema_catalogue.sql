-- =============================================================================
-- Module 3 : CATALOGUE & FOURNISSEURS
-- =============================================================================


-- -----------------------------------------------------------------------------
-- fournisseur
-- -----------------------------------------------------------------------------
CREATE TABLE fournisseur (
    code_fournisseur    text    NOT NULL PRIMARY KEY,
    nom                 text    NOT NULL,
    contact_principal   text,
    telephone           text,
    email               text,
    adresse             text,
    ville               text,
    pays                text    NOT NULL DEFAULT 'Maroc',
    delai_livraison_jours bigint CHECK (delai_livraison_jours IS NULL OR delai_livraison_jours > 0),
    conditions_paiement text,
    delai_paiement_jours bigint,                  -- alimente le DPO du cockpit
    code_devise         text    REFERENCES devise(code_devise),
    incoterm            text,
    transporteur        text,
    note_globale        numeric(5,2)    CHECK (note_globale IS NULL OR note_globale BETWEEN 0 AND 100),
    delai_reel_moyen_jours numeric(12,4),
    tolerance_pesee_pct numeric(9,4)    CHECK (tolerance_pesee_pct IS NULL OR tolerance_pesee_pct >= 0),
    actif               bigint NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- -----------------------------------------------------------------------------
-- contact_fournisseur
-- -----------------------------------------------------------------------------
CREATE TABLE contact_fournisseur (
    id_contact          text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_fournisseur    text    NOT NULL REFERENCES fournisseur(code_fournisseur) ON DELETE CASCADE,
    nom                 text    NOT NULL,
    fonction            text,
    email               text,
    telephone           text,
    est_principal       bigint NOT NULL DEFAULT 0 CHECK (est_principal IN (0,1)),
    actif               bigint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

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
-- couleur — NOTRE liste de couleurs, commune a tous les fournisseurs
-- -----------------------------------------------------------------------------
-- Le meme rouge se nomme « RED 7612 » chez Hasirci, « OZ 5109 » chez Ozkaralar
-- et « RED 5342 » chez Goral. Le code interne (C3) est ce qui les rapproche.
--
-- La classe de teinture est tarifaire : le prix d'une couleur est le prix de
-- base de sa famille plus un supplement, en devise par tonne, qui ne depend que
-- de la classe (LIGHT 1,80 / MEDIUM 1,85 / DARK 1,95 / RED 2,10 chez Goral).
-- C'est ce qui permet de chiffrer une couleur jamais achetee.
-- -----------------------------------------------------------------------------
CREATE TABLE couleur (
    code_couleur_interne text    NOT NULL PRIMARY KEY,
    libelle              text    NOT NULL,
    classe_teinture      text    CHECK (classe_teinture IS NULL
                                        OR classe_teinture IN ('LIGHT','MEDIUM','DARK','RED')),
    description          text,
    ordre_affichage      bigint  NOT NULL DEFAULT 0,
    actif                bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);


-- -----------------------------------------------------------------------------
-- famille — le produit, independamment de qui le vend
-- -----------------------------------------------------------------------------
-- « FIL 2650 dtex FZ », « FIL VERONA 1500 », « MILIPLY POLYESTER 3000 Deniers » :
-- c'est le titre des blocs des classeurs de prix. Deux references de meme
-- famille et de meme couleur sont le meme fil, chez deux vendeurs differents.
-- -----------------------------------------------------------------------------
CREATE TABLE famille (
    code_famille    text    NOT NULL PRIMARY KEY,
    libelle         text    NOT NULL,
    code_categorie  text    REFERENCES categorie_matiere(code_categorie),
    type_fil        text,
    titrage         text,
    description     text,
    ordre_affichage bigint  NOT NULL DEFAULT 0,
    actif           bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);


-- -----------------------------------------------------------------------------
CREATE TABLE reference (
    code_reference      text    NOT NULL PRIMARY KEY,
    code_categorie      text    NOT NULL REFERENCES categorie_matiere(code_categorie),
    code_fournisseur    text    NOT NULL REFERENCES fournisseur(code_fournisseur),
    designation         text    NOT NULL,
    type_fil            text,
    couleur             text,
    -- La nuance du fournisseur (« 7612 » sur la facture Hasirci), distincte
    -- du nom de la couleur : c'est elle que la production suit au lot.
    code_couleur        text,
    titrage             text,
    -- Le produit et la couleur, en referentiel : ce qui rapproche deux
    -- fournisseurs du meme fil (voir `famille` et `couleur` ci-dessus).
    code_famille        text    REFERENCES famille(code_famille),
    code_couleur_interne text   REFERENCES couleur(code_couleur_interne),
    -- La reference telle que le fournisseur l'ecrit sur sa facture : c'est
    -- elle que la saisie assistee lit, et elle seule.
    reference_fournisseur text,
    -- Supplement de teinture, en devise par tonne (100, 150, 530...).
    supplement_teinture numeric(18,4) CHECK (supplement_teinture IS NULL OR supplement_teinture >= 0),

    -- Unite de saisie et facteurs de conversion vers le kg
    unite_catalogue     text    NOT NULL CHECK (unite_catalogue IN ('kg','Palette','Bobine','ml')),
    poids_bobine_kg     numeric(18,4)    CHECK (poids_bobine_kg IS NULL OR poids_bobine_kg > 0),
    bobines_par_palette bigint CHECK (bobines_par_palette IS NULL OR bobines_par_palette > 0),
    densite_kg_ml       numeric(18,4)    CHECK (densite_kg_ml IS NULL OR densite_kg_ml > 0),
    facteur_kg          numeric(18,4)    GENERATED ALWAYS AS (
                            CASE unite_catalogue
                                WHEN 'kg'      THEN 1.0
                                WHEN 'Bobine'  THEN poids_bobine_kg
                                WHEN 'Palette' THEN poids_bobine_kg * bobines_par_palette
                                WHEN 'ml'      THEN densite_kg_ml
                            END) STORED,

    -- Prix
    prix_catalogue      numeric(18,4)    NOT NULL CHECK (prix_catalogue > 0),   -- par unite_catalogue
    code_devise_catalogue text  NOT NULL REFERENCES devise(code_devise),
    date_prix_catalogue text,
    prix_catalogue_kg   numeric(18,4)    GENERATED ALWAYS AS (
                            prix_catalogue / CASE unite_catalogue
                                WHEN 'kg'      THEN 1.0
                                WHEN 'Bobine'  THEN poids_bobine_kg
                                WHEN 'Palette' THEN poids_bobine_kg * bobines_par_palette
                                WHEN 'ml'      THEN densite_kg_ml
                            END) STORED,

    -- Politique de reapprovisionnement (parametres LOCAUX, cf. B3/R09)
    stock_min_kg        numeric(18,4)    CHECK (stock_min_kg IS NULL OR stock_min_kg >= 0),
    couverture_min_mois numeric(12,4)    CHECK (couverture_min_mois IS NULL OR couverture_min_mois >= 0),
    marge_securite_pct  numeric(9,4)    CHECK (marge_securite_pct IS NULL OR marge_securite_pct >= 0),
    moq_kg              numeric(18,4)    CHECK (moq_kg IS NULL OR moq_kg > 0),
    multiple_achat_kg   numeric(18,4)    CHECK (multiple_achat_kg IS NULL OR multiple_achat_kg > 0),

    -- Classification (calculee par fn_classifier_abc_xyz cote applicatif)
    classe_abc          text    CHECK (classe_abc IS NULL OR classe_abc IN ('A','B','C')),
    classe_xyz          text    CHECK (classe_xyz IS NULL OR classe_xyz IN ('X','Y','Z')),
    date_dernier_abc    text,

    -- Valorisation (RG-08 : NULL tant qu'aucune reception reelle)
    cmup_mad            numeric(18,4)    CHECK (cmup_mad IS NULL OR cmup_mad >= 0),
    date_dernier_cmup   text,

    suivi_lot           bigint NOT NULL DEFAULT 0 CHECK (suivi_lot IN (0,1)),
    actif               bigint NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur_creation text REFERENCES utilisateur(id_utilisateur),

    -- R01 : facteur de conversion obligatoire selon l'unite. Aucun fallback.
    CHECK (unite_catalogue <> 'Bobine'  OR poids_bobine_kg IS NOT NULL),
    CHECK (unite_catalogue <> 'Palette' OR (poids_bobine_kg IS NOT NULL AND bobines_par_palette IS NOT NULL)),
    CHECK (unite_catalogue <> 'ml'      OR densite_kg_ml IS NOT NULL),
    -- Un multiple d'achat doit etre coherent avec le MOQ
    CHECK (moq_kg IS NULL OR multiple_achat_kg IS NULL OR moq_kg >= multiple_achat_kg)
);

CREATE INDEX ix_ref_categorie   ON reference(code_categorie);
CREATE INDEX ix_ref_fournisseur ON reference(code_fournisseur);
CREATE INDEX ix_ref_abc         ON reference(classe_abc) WHERE actif = 1;
CREATE INDEX ix_ref_famille_couleur ON reference(code_famille, code_couleur_interne) WHERE actif = 1;
CREATE INDEX ix_ref_reference_fournisseur ON reference(reference_fournisseur)
    WHERE reference_fournisseur IS NOT NULL;

-- -----------------------------------------------------------------------------
-- groupe_equiv  (substitution, CDC F8)
-- -----------------------------------------------------------------------------
CREATE TABLE groupe_equiv (
    code_groupe_equiv   text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    description         text,
    actif               bigint NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

-- -----------------------------------------------------------------------------
-- reference_groupe_equiv
-- -----------------------------------------------------------------------------
CREATE TABLE reference_groupe_equiv (
    id_ref_grp          text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    code_groupe_equiv   text    NOT NULL REFERENCES groupe_equiv(code_groupe_equiv) ON DELETE CASCADE,
    priorite            bigint NOT NULL CHECK (priorite > 0),
    est_preferentielle  bigint NOT NULL DEFAULT 0 CHECK (est_preferentielle IN (0,1)),
    date_debut          text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    date_fin            text,
    actif               bigint NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    UNIQUE (code_reference, code_groupe_equiv),
    CHECK (date_fin IS NULL OR date_fin > date_debut)
);

CREATE INDEX ix_grp_equiv_priorite ON reference_groupe_equiv(code_groupe_equiv, priorite);
-- Une seule reference preferentielle et une seule priorite N par groupe
CREATE UNIQUE INDEX ux_grp_equiv_pref ON reference_groupe_equiv(code_groupe_equiv) WHERE est_preferentielle = 1;
CREATE UNIQUE INDEX ux_grp_equiv_prio ON reference_groupe_equiv(code_groupe_equiv, priorite) WHERE actif = 1;
