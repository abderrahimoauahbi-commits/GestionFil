-- =============================================================================
-- Module 7 : RECEPTIONS
-- =============================================================================
-- CORRECTIONS MAJEURES :
--
--  * Controle qualite absent du CDC : `reception.statut` n'offrait que
--    BROUILLON/VALIDE/CLOTURE, sans etat "a controler", alors que D2 donne au
--    Controleur Qualite un droit RW sur les receptions et que B4 regle 2 impose
--    le controle croise. -> etat A_CONTROLER + acteur de controle distinct.
--
--  * Quarantaine non implementee : le CDC calculait statut_qualite =
--    'QUARANTAINE' mais J4 envoyait quand meme la marchandise dans
--    code_magasin_dest. -> CHECK de routage vers un magasin de quarantaine.
--
--  * Ecart de pesee : le CDC comparait quantite_pesee a quantite_commandee sans
--    garantie d'unite commune. Les deux grandeurs sont ici en kg.
--
--  * Tolerance 2% : E6 exigeait "blocage + validation direction" sans aucun
--    mecanisme. -> derogation explicite, tracee et nominative.
--
--  * Multi-magasin : J4 prenait le magasin de la PREMIERE ligne (LIMIT 1 sans
--    ORDER BY) pour toute la reception. La cascade est desormais assuree par le
--    service Rust, qui cree un mouvement PAR magasin destinataire.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- reception
-- -----------------------------------------------------------------------------
CREATE TABLE reception (
    id_reception        text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    numero_reception    text    NOT NULL UNIQUE,
    date_reception      text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_bc               text    REFERENCES bon_commande(id_bc),
    code_fournisseur    text    NOT NULL REFERENCES fournisseur(code_fournisseur),
    transporteur        text,
    num_bon_livraison   text,
    -- La facture arrive apres le camion : elle se saisit quand elle arrive, et
    -- c'est elle qui rapproche la reception du reglement.
    numero_facture      text,
    nombre_colis        integer CHECK (nombre_colis IS NULL OR nombre_colis > 0),
    poids_total_brut_kg numeric(18,4)    CHECK (poids_total_brut_kg IS NULL OR poids_total_brut_kg > 0),

    statut              text    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','A_CONTROLER','VALIDE','CLOTURE','ANNULE')),

    -- RG-09 : taux fige a la date de RECEPTION (distinct du taux engage du BC)
    taux_change_reception numeric(9,4)  CHECK (taux_change_reception IS NULL OR taux_change_reception > 0),

    id_utilisateur_reception text NOT NULL REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_controle  text REFERENCES utilisateur(id_utilisateur),
    date_controle       text,
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),

    -- B4 regle 2 : le magasinier qui pese n'est pas celui qui libere la marchandise
    CHECK (id_utilisateur_controle IS NULL
           OR id_utilisateur_controle <> id_utilisateur_reception),
    -- Une reception validee est necessairement controlee et tracee
    CHECK (statut IN ('BROUILLON','A_CONTROLER','ANNULE')
           OR (id_utilisateur_controle IS NOT NULL AND date_controle IS NOT NULL
               AND taux_change_reception IS NOT NULL))
);

CREATE INDEX ix_reception_bc     ON reception(id_bc);
CREATE INDEX ix_reception_statut ON reception(statut, date_reception DESC);

-- -----------------------------------------------------------------------------
-- ligne_reception
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_reception (
    id_ligne_reception  text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    id_reception        text    NOT NULL REFERENCES reception(id_reception) ON DELETE CASCADE,
    id_ligne_bc         text    REFERENCES ligne_bc(id_ligne_bc),
    ligne_numero        integer NOT NULL CHECK (ligne_numero > 0),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    designation         text,

    -- Quantites : tout en kg (R01). L'unite de saisie n'est qu'un masque.
    unite_saisie        text    NOT NULL CHECK (unite_saisie IN ('kg','Palette','Bobine','ml')),
    facteur_kg          numeric(18,4)    NOT NULL CHECK (facteur_kg > 0),
    quantite_pesee_unite numeric(18,4)   NOT NULL CHECK (quantite_pesee_unite > 0),
    quantite_stock_kg   numeric(18,4)    NOT NULL CHECK (quantite_stock_kg > 0),
    quantite_commandee_kg numeric(18,4)  CHECK (quantite_commandee_kg IS NULL OR quantite_commandee_kg > 0),
    ecart_pct           numeric(9,4)    GENERATED ALWAYS AS (
                            CASE WHEN quantite_commandee_kg IS NULL OR quantite_commandee_kg = 0 THEN NULL
                                 ELSE (quantite_stock_kg - quantite_commandee_kg) / quantite_commandee_kg * 100.0
                            END) STORED,

    -- Prix : distinction stricte devise / MAD (correction BL-5)
    prix_kg_devise      numeric(18,2)    NOT NULL CHECK (prix_kg_devise > 0),
    code_devise         text    NOT NULL REFERENCES devise(code_devise),
    taux_change         numeric(9,4)    NOT NULL CHECK (taux_change > 0),
    prix_kg_mad         numeric(18,2)    NOT NULL CHECK (prix_kg_mad > 0),
    total_devise        numeric(18,2)    GENERATED ALWAYS AS (quantite_stock_kg * prix_kg_devise) STORED,
    total_mad           numeric(18,2)    GENERATED ALWAYS AS (quantite_stock_kg * prix_kg_mad) STORED,

    -- Tracabilite lot (A3)
    -- Quantite ANNONCEE sur le bon de livraison, distincte de la quantite PESEE.
    -- Le fournisseur declare un poids, la bascule en donne un autre : l'ecart
    -- entre les deux est un litige de transport, et le confondre avec l'ecart au
    -- commande reviendrait a reprocher au fournisseur ce qu'il a bien expedie.
    quantite_bl_kg      numeric(18,4)    CHECK (quantite_bl_kg IS NULL OR quantite_bl_kg >= 0),
    -- Nombre de colis de CETTE ligne. Le poids moyen par colis qui s'en deduit
    -- detecte un conditionnement different de celui annonce au catalogue.
    nb_colis_ligne      integer CHECK (nb_colis_ligne IS NULL OR nb_colis_ligne > 0),
    lot_fournisseur     text,
    date_fabrication    text,
    date_peremption     text,

    -- Controle qualite
    statut_qualite      text    NOT NULL DEFAULT 'CONFORME'
                                CHECK (statut_qualite IN ('CONFORME','NON_CONFORME','QUARANTAINE')),
    code_motif_ligne    text    REFERENCES motif_ligne(code_motif_ligne),
    -- SUBSTITUTION. Le fournisseur livre l'equivalent de ce qu'on a commande :
    -- meme matiere, meme couleur, autre reference. Le cas est reel et refuser la
    -- marchandise au quai n'est pas une option.
    --
    -- Mais il ne doit jamais passer en silence : le drapeau est une CONFIRMATION
    -- explicite, et le trigger refuse l'ecart sans lui. Sans cette porte, on
    -- pourrait solder une ligne de fil de chaine avec du jute et ne s'en
    -- apercevoir qu'a l'inventaire.
    substitution_acceptee integer NOT NULL DEFAULT 0
                                CHECK (substitution_acceptee IN (0,1)),
    motif_substitution  text,

    code_magasin_dest   text    NOT NULL REFERENCES magasin(code_magasin),

    -- Lien vers le mouvement genere par la cascade (tracabilite descendante).
    -- Les liens vers l'archive et l'historique de prix sont portes par ces
    -- tables elles-memes, via id_ligne_reception UNIQUE.
    id_mouvement_genere text,

    -- Derogation sur ecart de pesee hors tolerance (E6)
    derogation_ecart    smallint NOT NULL DEFAULT 0 CHECK (derogation_ecart IN (0,1)),
    id_utilisateur_derogation text REFERENCES utilisateur(id_utilisateur),
    motif_derogation    text,

    notes               text,

    UNIQUE (id_reception, ligne_numero),
    CHECK (abs(quantite_stock_kg - quantite_pesee_unite * facteur_kg) < 0.001),
    CHECK (abs(prix_kg_mad - prix_kg_devise * taux_change) < 0.01),
    CHECK (date_peremption IS NULL OR date_fabrication IS NULL OR date_peremption > date_fabrication),
    CHECK (derogation_ecart = 0
           OR (id_utilisateur_derogation IS NOT NULL AND motif_derogation IS NOT NULL))
);

CREATE INDEX ix_ligne_reception_ref ON ligne_reception(code_reference);
CREATE INDEX ix_ligne_reception_bc  ON ligne_reception(id_ligne_bc);

-- -----------------------------------------------------------------------------
-- archive_reception  (photo qualite FIGEE - R03)
-- TABLE IMMUABLE : cf. trg_archive_reception_immuable.
-- Duplique volontairement les donnees de ligne_reception : l'archive ne doit
-- dependre d'aucune ligne modifiable (defaut releve dans l'analyse §3).
-- -----------------------------------------------------------------------------
CREATE TABLE archive_reception (
    id_archive          text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    id_ligne_reception  text    NOT NULL UNIQUE,
    numero_reception    text    NOT NULL,
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    code_fournisseur    text    NOT NULL REFERENCES fournisseur(code_fournisseur),
    date_reception      text    NOT NULL,
    lot_fournisseur     text,
    quantite_pesee_unite numeric(18,4)   NOT NULL,
    unite_saisie        text    NOT NULL,
    quantite_stock_kg   numeric(18,4)    NOT NULL,
    prix_kg_devise      numeric(18,2)    NOT NULL,
    code_devise         text    NOT NULL,
    taux_change         numeric(9,4)    NOT NULL,
    prix_kg_mad         numeric(18,2)    NOT NULL,
    total_mad           numeric(18,2)    NOT NULL,
    code_magasin_dest   text    NOT NULL,
    statut_qualite      text    NOT NULL,
    ecart_pct           numeric(9,4),
    conformite_specifications integer CHECK (conformite_specifications IS NULL OR conformite_specifications IN (0,1)),
    conformite_quantite integer CHECK (conformite_quantite IS NULL OR conformite_quantite IN (0,1)),
    conformite_delai    integer CHECK (conformite_delai IS NULL OR conformite_delai IN (0,1)),
    jours_retard        integer,
    documents_attaches  text    CHECK (documents_attaches IS NULL OR (documents_attaches)::jsonb IS NOT NULL),
    photos              text    CHECK (photos IS NULL OR (photos)::jsonb IS NOT NULL),
    date_archive        text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur_archive text REFERENCES utilisateur(id_utilisateur)
);

CREATE INDEX ix_archive_ref  ON archive_reception(code_reference, date_reception DESC);
CREATE INDEX ix_archive_four ON archive_reception(code_fournisseur, date_reception DESC);
