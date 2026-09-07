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


-- -----------------------------------------------------------------------------
-- mouvement  (entete du grand livre) - IMMUABLE (R03)
-- -----------------------------------------------------------------------------
CREATE TABLE mouvement (
    id_mouvement        text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    numero_mouvement    text    NOT NULL UNIQUE,
    date_mouvement      text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    code_type_mvt       text    NOT NULL REFERENCES type_mouvement(code_type_mvt),
    code_magasin        text    NOT NULL REFERENCES magasin(code_magasin),
    code_motif          text    NOT NULL REFERENCES motif_mouvement(code_motif),
    reference_document  text,                       -- n° BC / reception / transfert / inventaire
    numero_of           text,                       -- ordre de fabrication (C07)
    observations_globales text,
    -- QUI A SAISI : le compte applicatif, garanti par le serveur.
    id_utilisateur      text    NOT NULL REFERENCES utilisateur(id_utilisateur),  -- C09
    -- QUI EST RESPONSABLE : la personne qui a physiquement remis ou recu la
    -- marchandise. Ce n'est pas la meme chose et il ne faut pas les confondre :
    -- le magasinier saisit souvent pour un chef d'equipe ou un chauffeur, et
    -- c'est ce dernier qu'on cherche quand un ecart apparait trois jours plus
    -- tard. Texte libre : ce peut etre un tiers qui n'a pas de compte.
    responsable         text,
    est_initial         bigint NOT NULL DEFAULT 0 CHECK (est_initial IN (0,1)),
    -- DATE DE SAISIE, distincte de `date_mouvement`. Un mouvement du samedi
    -- saisi le lundi porte deux dates differentes, et l'ecart entre les deux
    -- est en soi une information : il dit si le magasin tient son journal a
    -- jour. C06 interdit une date de mouvement dans le futur, jamais dans le
    -- passe.
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX ix_mvt_type    ON mouvement(code_type_mvt, date_mouvement DESC);
CREATE INDEX ix_mvt_magasin ON mouvement(code_magasin, date_mouvement DESC);
CREATE INDEX ix_mvt_date    ON mouvement(date_mouvement DESC);
CREATE INDEX ix_mvt_doc     ON mouvement(reference_document);

-- -----------------------------------------------------------------------------
-- ligne_mouvement  (detail du grand livre) - IMMUABLE (R03)
-- quantite_kg > 0 TOUJOURS : le sens du mouvement vient de type_mouvement.signe.
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_mouvement (
    id_ligne_mouvement  text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    id_mouvement        text    NOT NULL REFERENCES mouvement(id_mouvement) ON DELETE CASCADE,
    ligne_numero        bigint NOT NULL CHECK (ligne_numero > 0),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),

    quantite_kg         numeric(18,4)    NOT NULL CHECK (quantite_kg > 0),
    prix_kg_mad         numeric(18,4)    CHECK (prix_kg_mad IS NULL OR prix_kg_mad > 0),
    total_mad           numeric(18,2)    GENERATED ALWAYS AS (quantite_kg * COALESCE(prix_kg_mad, 0)) STORED,

    -- Saisie d'origine conservee pour l'audit (R01 : le kg reste canonique)
    quantite_saisie     numeric(18,4)    CHECK (quantite_saisie IS NULL OR quantite_saisie > 0),
    unite_saisie        text    CHECK (unite_saisie IS NULL OR unite_saisie IN ('kg','Palette','Bobine','ml')),
    facteur_conversion  numeric(18,4)    CHECK (facteur_conversion IS NULL OR facteur_conversion > 0),

    -- LES COLIS REELLEMENT COMPTES, et non deduits du poids.
    --
    -- `quantite_saisie` en palettes se CONVERTIT en kg par un facteur theorique
    -- (poids d'une bobine x bobines par palette). Le nombre de palettes
    -- physiquement chargees, lui, se COMPTE sur le quai — et les deux different
    -- des qu'une palette est incomplete, ce qui est le cas ordinaire. Le bon
    -- imprime porte le compte reel : c'est ce que le cariste verifie.
    --
    -- Meme raison que sur `ligne_transfert`, ou ces deux colonnes existent
    -- depuis l'origine.
    nb_bobines          bigint CHECK (nb_bobines  IS NULL OR nb_bobines  >= 0),
    nb_palettes         bigint CHECK (nb_palettes IS NULL OR nb_palettes >= 0),

    -- -------------------------------------------------------------------
    -- LE POIDS REEL (catch weight)
    -- -------------------------------------------------------------------
    -- REGLE D'OR : le poids catalogue ne sert qu'a proposer et a afficher ;
    -- le stock n'enregistre que ce qui a ete constate. `quantite_kg` porte
    -- donc TOUJOURS le poids reel, et ces colonnes disent COMMENT il a ete
    -- obtenu.
    --
    -- Sans `mode_pesee`, rien ne distinguerait six mois plus tard un poids
    -- sorti de la bascule d'un poids juge a l'oeil — et c'est exactement la
    -- question que pose un ecart d'inventaire.
    mode_pesee          text    CHECK (mode_pesee IS NULL
                                    OR mode_pesee IN ('PESEE','ESTIMATION','THEORIQUE')),

    -- Le poids catalogue FIGE au moment du geste. Le catalogue evoluera ;
    -- l'ecart constate ce jour-la doit rester lisible dans dix ans.
    poids_unitaire_theorique_kg numeric(18,4)
                                CHECK (poids_unitaire_theorique_kg IS NULL
                                    OR poids_unitaire_theorique_kg > 0),

    -- MODE A : ce que la bascule a affiche. MODE B : le pourcentage estime.
    -- Exclusifs l'un de l'autre — la contrainte du bas l'impose.
    poids_total_pese_kg numeric(18,4) CHECK (poids_total_pese_kg IS NULL
                                          OR poids_total_pese_kg >= 0),
    pourcentage_restant numeric(6,2)  CHECK (pourcentage_restant IS NULL
                                          OR pourcentage_restant BETWEEN 0 AND 100),

    -- TRACABILITE. C'est ce chiffre qui permettra de dire, dans six mois, si le
    -- fil du fournisseur A tient vraiment les 2,70 kg qu'il annonce.
    poids_reel_moyen_bobine_kg numeric(18,4) GENERATED ALWAYS AS (
        CASE WHEN nb_bobines > 0 THEN quantite_kg / nb_bobines END) STORED,

    ecart_theorique_pct numeric(9,4) GENERATED ALWAYS AS (
        CASE WHEN nb_bobines > 0 AND poids_unitaire_theorique_kg > 0
             THEN (quantite_kg - nb_bobines * poids_unitaire_theorique_kg)
                  / (nb_bobines * poids_unitaire_theorique_kg) * 100.0 END) STORED,

    lot_fournisseur     text,
    date_fabrication    text,
    date_peremption     text,
    code_motif_ligne    text    REFERENCES motif_ligne(code_motif_ligne),
    numero_of           text,
    statut_qualite      text    CHECK (statut_qualite IS NULL OR statut_qualite IN ('CONFORME','NON_CONFORME','QUARANTAINE')),

    UNIQUE (id_mouvement, ligne_numero),

    -- LA CONVERSION THEORIQUE NE S'APPLIQUE PLUS QUAND UN POIDS A ETE CONSTATE.
    --
    -- Elle continue de proteger les mouvements ordinaires, ou une saisie en
    -- palettes se convertit par un facteur. Elle se retire des qu'une pesee ou
    -- une estimation a eu lieu : c'est le sens meme de la regle d'or, et c'est
    -- cette contrainte qui interdisait jusqu'ici d'enregistrer « 200 bobines
    -- qui pesent 528 kg » quand le catalogue en annonce 540.
    --
    -- COALESCE et non `mode_pesee IN (...)` : avec un mode nul, `IN` vaut NULL,
    -- un CHECK ne refuse que ce qui est FAUX, et la verification cesserait
    -- silencieusement de s'appliquer a tous les mouvements ordinaires.
    CONSTRAINT ck_lmvt_conversion CHECK (
           COALESCE(mode_pesee,'') IN ('PESEE','ESTIMATION')
           OR quantite_saisie IS NULL OR facteur_conversion IS NULL
           OR abs(quantite_kg - quantite_saisie * facteur_conversion) < 0.001),

    -- LA BASE REFAIT LE CALCUL DE L'OPERATEUR.
    --
    -- Sans elle, un client mal ecrit — ou une application mobile pressee —
    -- pourrait annoncer 'PESEE' et enregistrer le poids theorique. La regle
    -- d'or ne serait qu'une intention dans du code ; ici elle tient quel que
    -- soit l'appelant.
    CONSTRAINT ck_lmvt_mode_pesee CHECK (
        mode_pesee IS NULL
        OR mode_pesee = 'THEORIQUE'
        OR (mode_pesee = 'PESEE'
            AND poids_total_pese_kg IS NOT NULL
            AND pourcentage_restant IS NULL
            AND abs(quantite_kg - poids_total_pese_kg) < 0.001)
        OR (mode_pesee = 'ESTIMATION'
            AND pourcentage_restant IS NOT NULL
            AND poids_total_pese_kg IS NULL
            AND nb_bobines IS NOT NULL AND nb_bobines > 0
            AND poids_unitaire_theorique_kg IS NOT NULL
            AND abs(quantite_kg - nb_bobines * poids_unitaire_theorique_kg
                                  * pourcentage_restant / 100.0) < 0.01))
);

CREATE INDEX ix_lmvt_ref ON ligne_mouvement(code_reference);
CREATE INDEX ix_lmvt_mvt ON ligne_mouvement(id_mouvement);
CREATE INDEX ix_lmvt_lot ON ligne_mouvement(code_reference, lot_fournisseur);

-- -----------------------------------------------------------------------------
-- stock_magasin  (solde agrege, DERIVE du grand livre)
-- Cache recalculable : en cas de derive, la verite reste ligne_mouvement.
-- Cf. controle C15.
-- -----------------------------------------------------------------------------
CREATE TABLE stock_magasin (
    id_stock            text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    code_magasin        text    NOT NULL REFERENCES magasin(code_magasin),
    quantite_kg         numeric(18,4)    NOT NULL DEFAULT 0 CHECK (quantite_kg >= 0),   -- R02
    cmup_mad            numeric(18,4)    CHECK (cmup_mad IS NULL OR cmup_mad >= 0),      -- RG-08 : NULL si aucun achat
    valeur_mad          numeric(18,2)    GENERATED ALWAYS AS (quantite_kg * COALESCE(cmup_mad, 0)) STORED,

    -- LE COMPTE DE BOBINES, entretenu par le meme declencheur que les kilos.
    -- Sans lui, verifier la capacite d'un emplacement de machine imposerait de
    -- relire tout l'historique des mouvements a chaque saisie.
    --
    -- COMPTEUR SECONDAIRE : il ne doit JAMAIS empecher un mouvement de kilos
    -- legitime. Les mouvements anterieurs a ce module ne portent pas de nombre
    -- de bobines, donc le compte peut etre en retard sur la realite dans les
    -- magasins ordinaires ; le declencheur le borne a zero et le controle C30
    -- signale les incoherences. Sur un emplacement de machine, ou la saisie
    -- impose toujours le nombre, il est exact.
    nb_bobines          bigint  NOT NULL DEFAULT 0 CHECK (nb_bobines >= 0),
    date_derniere_entree text,
    date_derniere_sortie text,
    date_dernier_inventaire text,
    date_maj            text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE (code_reference, code_magasin)
);

CREATE INDEX ix_stock_ref     ON stock_magasin(code_reference);
CREATE INDEX ix_stock_magasin ON stock_magasin(code_magasin);

-- -----------------------------------------------------------------------------
-- stock_lot  (AJOUT : correction BL-8 - tracabilite par lot)
-- Alimente uniquement pour les references dont suivi_lot = 1.
-- -----------------------------------------------------------------------------
CREATE TABLE stock_lot (
    id_stock_lot        text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    code_magasin        text    NOT NULL REFERENCES magasin(code_magasin),
    lot_fournisseur     text    NOT NULL,
    quantite_kg         numeric(18,4)    NOT NULL DEFAULT 0 CHECK (quantite_kg >= 0),
    prix_entree_mad     numeric(18,4)    CHECK (prix_entree_mad IS NULL OR prix_entree_mad >= 0),
    -- LE COMPTE DE BOBINES, entretenu par le meme declencheur que les kilos.
    -- Sans lui, verifier la capacite d'un emplacement de machine imposerait de
    -- relire tout l'historique des mouvements a chaque saisie.
    --
    -- COMPTEUR SECONDAIRE : il ne doit JAMAIS empecher un mouvement de kilos
    -- legitime. Les mouvements anterieurs a ce module ne portent pas de nombre
    -- de bobines, donc le compte peut etre en retard sur la realite dans les
    -- magasins ordinaires ; le declencheur le borne a zero et le controle C30
    -- signale les incoherences. Sur un emplacement de machine, ou la saisie
    -- impose toujours le nombre, il est exact.
    nb_bobines          bigint  NOT NULL DEFAULT 0 CHECK (nb_bobines >= 0),
    date_fabrication    text,
    date_peremption     text,
    date_premiere_entree text   NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    date_maj            text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE (code_reference, code_magasin, lot_fournisseur)
);

-- Index FEFO : sert fn_suggerer_lots_fefo (vue v_lot_fefo)
CREATE INDEX ix_stock_lot_fefo ON stock_lot(code_reference, code_magasin, date_peremption)
    WHERE quantite_kg > 0;

-- -----------------------------------------------------------------------------
-- transfert
-- -----------------------------------------------------------------------------
CREATE TABLE transfert (
    id_transfert        text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    numero_transfert    text    NOT NULL UNIQUE,
    date_transfert      text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    code_magasin_source text    NOT NULL REFERENCES magasin(code_magasin),
    code_magasin_dest   text    NOT NULL REFERENCES magasin(code_magasin),
    statut              text    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','VALIDE','TERMINE','ANNULE')),
    id_utilisateur      text    NOT NULL REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_reception text REFERENCES utilisateur(id_utilisateur),

    -- Trois dates distinctes, et les confondre fait perdre le delai de route :
    --   date_transfert      quand le document a ete etabli ;
    --   date_sortie         quand la marchandise a REELLEMENT quitte le source ;
    --   date_reception_dest quand quelqu'un a constate son arrivee.
    date_sortie         text,
    date_reception_dest text,

    -- Qui repond de la marchandise pendant le trajet : chauffeur, chef de
    -- quai, transporteur. Distinct des comptes applicatifs, qui disent qui a
    -- SAISI — pas qui etait au volant.
    responsable         text,
    transporteur        text,

    observations        text,
    CHECK (code_magasin_source <> code_magasin_dest)
);

-- -----------------------------------------------------------------------------
-- ligne_transfert
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_transfert (
    id_ligne_transfert  text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    id_transfert        text    NOT NULL REFERENCES transfert(id_transfert) ON DELETE CASCADE,
    ligne_numero        bigint NOT NULL CHECK (ligne_numero > 0),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    quantite_kg         numeric(18,4)    NOT NULL CHECK (quantite_kg > 0),
    quantite_saisie     numeric(18,4),
    unite_saisie        text    CHECK (unite_saisie IS NULL OR unite_saisie IN ('kg','Palette','Bobine','ml')),
    facteur_conversion  numeric(18,4)    CHECK (facteur_conversion IS NULL OR facteur_conversion > 0),
    lot_fournisseur     text,

    -- Conditionnement REELLEMENT charge, compte au quai.
    --
    -- Ce n'est pas la conversion de `quantite_kg` : un camion emporte trois
    -- palettes completes et quatre bobines isolees, et c'est ce decompte-la que
    -- le magasin destinataire verifiera au dechargement. Le deduire du poids
    -- donnerait un nombre juste en moyenne et faux sur chaque envoi.
    nb_bobines          bigint CHECK (nb_bobines IS NULL OR nb_bobines >= 0),
    nb_palettes         bigint CHECK (nb_palettes IS NULL OR nb_palettes >= 0),

    -- CMUP du magasin SOURCE, fige au moment de l'expedition.
    --
    -- La valeur voyage avec la marchandise. Relire le CMUP source a l'arrivee
    -- ferait entrer le lot a un prix qu'il n'a jamais eu, des qu'une reception
    -- fournisseur intervient pendant le trajet — et le CMUP du destinataire,
    -- qui est une moyenne ponderee, s'en trouverait fausse durablement.
    prix_kg_mad         numeric(18,4)    CHECK (prix_kg_mad IS NULL OR prix_kg_mad > 0),

    UNIQUE (id_transfert, ligne_numero)
);

-- -----------------------------------------------------------------------------
-- valorisation_stock  (photo periodique)
-- -----------------------------------------------------------------------------
CREATE TABLE valorisation_stock (
    id_valo             text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    date_valorisation   text    NOT NULL,
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    code_magasin        text    NOT NULL REFERENCES magasin(code_magasin),
    quantite_kg         numeric(18,4)    NOT NULL,
    cmup_mad            numeric(18,4)    NOT NULL,
    valeur_mad          numeric(18,2)    NOT NULL,
    methode             text    NOT NULL DEFAULT 'CMUP' CHECK (methode IN ('CMUP')),
    date_calcul         text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE (date_valorisation, code_reference, code_magasin)
);

-- -----------------------------------------------------------------------------
-- inventaire
-- -----------------------------------------------------------------------------
CREATE TABLE inventaire (
    id_inventaire       text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    numero_inventaire   text    NOT NULL UNIQUE,
    date_inventaire     text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    type_inventaire     text    NOT NULL CHECK (type_inventaire IN ('GLOBAL','TOURNANT','CIBLE')),
    code_magasin        text    NOT NULL REFERENCES magasin(code_magasin),
    statut              text    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','EN_COURS','CLOTURE','ANNULE')),
    id_utilisateur_responsable text NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    date_cloture        text,
    CHECK (statut <> 'CLOTURE' OR date_cloture IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- ligne_inventaire
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_inventaire (
    id_ligne_inv        text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    id_inventaire       text    NOT NULL REFERENCES inventaire(id_inventaire) ON DELETE CASCADE,
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    code_magasin        text    NOT NULL REFERENCES magasin(code_magasin),
    lot_fournisseur     text,
    quantite_theorique_kg numeric(18,4)  NOT NULL CHECK (quantite_theorique_kg >= 0),
    quantite_comptee_kg numeric(18,4)    CHECK (quantite_comptee_kg IS NULL OR quantite_comptee_kg >= 0),
    ecart_kg            numeric(18,4)    GENERATED ALWAYS AS (quantite_comptee_kg - quantite_theorique_kg) STORED,
    ecart_pct           numeric(9,4)    GENERATED ALWAYS AS (
                            CASE WHEN quantite_theorique_kg = 0 THEN NULL
                                 ELSE (quantite_comptee_kg - quantite_theorique_kg) / quantite_theorique_kg * 100.0
                            END) STORED,
    ecart_mad           numeric(18,2),
    motif_ecart         text,
    statut_ligne        text    NOT NULL DEFAULT 'A_TRAITER'
                                CHECK (statut_ligne IN ('A_TRAITER','COMPTE','AJUSTE','IGNORE')),
    id_utilisateur_comptage text REFERENCES utilisateur(id_utilisateur),
    date_comptage       text,
    UNIQUE (id_inventaire, code_reference, code_magasin, lot_fournisseur),
    CHECK (statut_ligne = 'A_TRAITER' OR quantite_comptee_kg IS NOT NULL)
);

CREATE INDEX ix_ligne_inv_ref ON ligne_inventaire(code_reference);
