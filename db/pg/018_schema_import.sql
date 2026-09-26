-- =============================================================================
-- Module 18 : DOSSIERS D'IMPORTATION — reception, cout de revient, CUMP
-- -----------------------------------------------------------------------------
-- PERIMETRE, ARRETE LE 11 SEPTEMBRE 2026 : MRP, stock et CUMP. Rien d'autre.
-- Pas de transitaire, pas de comptabilite, pas de paiement. Le dossier dit ce
-- qu'une expedition a coute, et fait entrer la marchandise au bon prix.
--
-- LA STRUCTURE
--   un dossier (05/26)   -> plusieurs factures, de plusieurs fournisseurs
--   une facture          -> plusieurs lignes ; chaque ligne dit, S'IL Y EN A UN,
--                           de quel bon de commande elle vient
--   une reception        -> une facture, plusieurs, ou une partie
--   des frais            -> repartis sur les lignes AU PRORATA DE LA VALEUR
--
-- LES LIGNES HORS ERP. Une piece de rechange importee dans le meme conteneur que
-- le fil n'entre ni au stock ni au catalogue. Mais elle reste sur la facture et
-- prend sa part des frais : sans elle, le fil paierait le transport de la piece.
-- C'est tout ce qu'elle fait.
--
-- LA TVA A L'IMPORTATION est recuperable : elle se saisit (le dossier doit
-- balancer avec les pieces) mais n'entre JAMAIS dans le cout de revient. C'est
-- `parametres_frais.inclus_dans_cout` qui le dit, pas un test sur un libelle.
--
-- LE CUMP en deux temps : la reception fait entrer la marchandise a la valeur
-- facture ; la cloture du dossier ajoute les frais au stock encore present
-- (`import_ajustements_cump`). Aucune ecriture comptable.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- parametres_frais — le catalogue des frais, colonnes du classeur IMPORTATION
-- -----------------------------------------------------------------------------
-- Chaque type de frais dit QUATRE choses, et l'ecran de saisie s'y conforme :
--   * quelle PIECE le justifie — ce que l'assistante doit avoir en main ;
--   * s'il est RECUPERABLE (la TVA a l'importation) : alors il ne rejoint
--     jamais le cout de revient, quelle que soit la saisie ;
--   * s'il est COMMUN au dossier, ou s'il vise des lignes designees (une
--     analyse, une redevance sur une seule marchandise) ;
--   * COMMENT il se repartit. Le classeur repartit tout a la valeur ; les
--     autres methodes existent parce qu'un fret se repartit parfois au poids,
--     et qu'une formalite se partage a parts egales.
CREATE TABLE parametres_frais (
    id_frais            text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    categorie           text    NOT NULL
                                CHECK (categorie IN ('DOUANE','TAXE','TRANSPORT','PORT','TRANSIT','AUTRE')),
    piece_justificative text,
    recuperable         bigint  NOT NULL DEFAULT 0 CHECK (recuperable IN (0,1)),
    commun              bigint  NOT NULL DEFAULT 1 CHECK (commun IN (0,1)),
    methode_repartition text    NOT NULL DEFAULT 'VALEUR'
                                CHECK (methode_repartition IN ('VALEUR','POIDS','QUANTITE','PARTS_EGALES')),
    inclus_dans_cout    bigint  NOT NULL CHECK (inclus_dans_cout IN (0,1)),
    ordre               bigint  NOT NULL DEFAULT 0,
    actif               bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    -- Un frais recuperable se recupere : le porter au cout de revient le
    -- ferait payer deux fois par la marchandise.
    CHECK (recuperable = 0 OR inclus_dans_cout = 0)
);


-- -----------------------------------------------------------------------------
-- import_dossiers
-- -----------------------------------------------------------------------------
CREATE TABLE import_dossiers (
    id_dossier          text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    -- Le numero du classeur : rang dans l'annee / annee, « 05/26 ».
    numero              text    NOT NULL UNIQUE,
    numero_bl           text,
    conteneurs          text,
    -- Devise et taux GLOBAUX : proposes par defaut a chaque facture du dossier.
    code_devise         text    NOT NULL REFERENCES devise(code_devise),
    taux_change         numeric(9,4)  NOT NULL CHECK (taux_change > 0),
    date_arrivee        text,
    statut              text    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','EN_COURS','CLOTURE')),
    notes               text,
    id_utilisateur_creation text NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur_cloture text REFERENCES utilisateur(id_utilisateur),
    date_cloture        text,
    -- Un dossier clos dit par qui et quand : c'est lui qui a change le CUMP.
    CHECK (statut <> 'CLOTURE' OR (id_utilisateur_cloture IS NOT NULL AND date_cloture IS NOT NULL))
);

CREATE INDEX ix_import_dossiers_statut ON import_dossiers(statut, date_creation DESC);


-- -----------------------------------------------------------------------------
-- import_factures — plusieurs par dossier, chacune de son fournisseur
-- -----------------------------------------------------------------------------
CREATE TABLE import_factures (
    id_facture          text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_dossier          text    NOT NULL REFERENCES import_dossiers(id_dossier) ON DELETE CASCADE,
    code_fournisseur    text    NOT NULL REFERENCES fournisseur(code_fournisseur),
    numero_facture      text    NOT NULL,
    date_facture        text    NOT NULL,
    code_devise         text    NOT NULL REFERENCES devise(code_devise),
    taux_change         numeric(9,4)  NOT NULL CHECK (taux_change > 0),
    -- Les totaux IMPRIMES, pour controler la saisie des lignes.
    montant_devise      numeric(18,2) CHECK (montant_devise IS NULL OR montant_devise >= 0),
    nb_palettes         bigint  CHECK (nb_palettes IS NULL OR nb_palettes >= 0),
    nb_bobines          bigint  CHECK (nb_bobines  IS NULL OR nb_bobines  >= 0),
    statut_reception    text    NOT NULL DEFAULT 'NON_RECUE'
                                CHECK (statut_reception IN ('NON_RECUE','PARTIELLE','RECUE')),
    id_utilisateur_creation text NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    -- La meme facture ne se saisit pas deux fois.
    UNIQUE (code_fournisseur, numero_facture)
);

CREATE INDEX ix_import_factures_dossier     ON import_factures(id_dossier);
CREATE INDEX ix_import_factures_fournisseur ON import_factures(code_fournisseur, date_facture DESC);


-- -----------------------------------------------------------------------------
-- import_facture_lignes — les articles du dossier
-- -----------------------------------------------------------------------------
CREATE TABLE import_facture_lignes (
    id_ligne            text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_facture          text    NOT NULL REFERENCES import_factures(id_facture) ON DELETE CASCADE,
    ligne_numero        bigint  NOT NULL CHECK (ligne_numero > 0),
    type_ligne          text    NOT NULL DEFAULT 'ERP' CHECK (type_ligne IN ('ERP','HORS_ERP')),
    code_reference      text    REFERENCES reference(code_reference),
    libelle             text,

    -- LE BON DE COMMANDE, PORTE PAR LA LIGNE ET NON PAR LA FACTURE. Une facture
    -- peut regrouper les lignes de plusieurs bons, et d'autres qui n'en ont
    -- aucun. NULL = achat libre.
    id_ligne_bc         text    REFERENCES ligne_bc(id_ligne_bc),

    lot_fournisseur     text,
    code_couleur        text,
    -- Le libelle imprime a cote du code (« RED » pour 7612).
    libelle_couleur     text,

    -- Quantite FACTUREE, dans l'unite de la facture ; le poids net est saisi a
    -- part parce que le stock se tient en kg (R01) quelle que soit l'unite.
    unite               text    NOT NULL DEFAULT 'kg' CHECK (unite IN ('kg','ml','piece')),
    quantite            numeric(18,4) NOT NULL CHECK (quantite > 0),
    poids_net_kg        numeric(18,4) CHECK (poids_net_kg IS NULL OR poids_net_kg > 0),
    nb_bobines          bigint  NOT NULL DEFAULT 0 CHECK (nb_bobines  >= 0),
    nb_palettes         bigint  NOT NULL DEFAULT 0 CHECK (nb_palettes >= 0),
    prix_unitaire_devise numeric(18,4) NOT NULL CHECK (prix_unitaire_devise > 0),
    -- La BASE de la repartition des frais.
    -- NET DE REMISE : c'est lui qui valorise le stock. Voir 2026-09-26c.
    montant_devise      numeric(18,2) GENERATED ALWAYS AS
                            (round(quantite * prix_unitaire_devise * (1 - remise_pct / 100), 2)) STORED,
    remise_pct          numeric(5,2) NOT NULL DEFAULT 0
                            CHECK (remise_pct >= 0 AND remise_pct < 100),
    -- Part de la ligne dans la valeur du dossier, en %, tenue par le calcul.
    pct_dossier         numeric(13,10),

    -- Le suivi des receptions : cumul des receptions VALIDEES.
    quantite_recue_kg   numeric(18,4) NOT NULL DEFAULT 0 CHECK (quantite_recue_kg >= 0),
    reste_kg            numeric(18,4) GENERATED ALWAYS AS (
                            CASE WHEN type_ligne = 'ERP' THEN poids_net_kg - quantite_recue_kg END) STORED,
    -- Solder un reliquat qui ne viendra pas (manquant, casse) : sans cela, un
    -- dossier a 7 kg pres ne pourrait jamais etre cloture.
    soldee              bigint  NOT NULL DEFAULT 0 CHECK (soldee IN (0,1)),
    motif_solde         text,

    UNIQUE (id_facture, ligne_numero),
    CHECK ((type_ligne = 'ERP'      AND code_reference IS NOT NULL AND poids_net_kg IS NOT NULL)
        OR (type_ligne = 'HORS_ERP' AND code_reference IS NULL AND id_ligne_bc IS NULL
                                    AND libelle IS NOT NULL)),
    -- Facturee au kg, la quantite EST le poids net : une seule verite.
    CHECK (unite <> 'kg' OR poids_net_kg IS NULL OR abs(quantite - poids_net_kg) < 0.0005),
    CHECK (soldee = 0 OR motif_solde IS NOT NULL)
);

CREATE INDEX ix_ifl_facture   ON import_facture_lignes(id_facture);
CREATE INDEX ix_ifl_reference ON import_facture_lignes(code_reference);
CREATE INDEX ix_ifl_ligne_bc  ON import_facture_lignes(id_ligne_bc) WHERE id_ligne_bc IS NOT NULL;


-- -----------------------------------------------------------------------------
-- dossier_lignes_frais — les frais saisis pour un dossier
-- -----------------------------------------------------------------------------
CREATE TABLE dossier_lignes_frais (
    id_ligne_frais      text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_dossier          text    NOT NULL REFERENCES import_dossiers(id_dossier) ON DELETE CASCADE,
    id_frais            text    NOT NULL REFERENCES parametres_frais(id_frais),
    libelle             text,
    numero_piece        text,
    montant_devise      numeric(18,2) NOT NULL CHECK (montant_devise > 0),
    code_devise         text    NOT NULL REFERENCES devise(code_devise),
    cours_change        numeric(9,4)  NOT NULL CHECK (cours_change > 0),
    montant_dhs         numeric(18,2) GENERATED ALWAYS AS (round(montant_devise * cours_change, 2)) STORED,
    id_utilisateur_creation text NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX ix_dlf_dossier ON dossier_lignes_frais(id_dossier);

-- Un frais qui ne concerne que certaines lignes : les droits de douane nuls sur
-- une piece de rechange (dossier 10/26 du classeur). Aucune ligne = tout le
-- dossier, et c'est le cas ordinaire.
CREATE TABLE dossier_lignes_frais_cibles (
    id_ligne_frais      text    NOT NULL REFERENCES dossier_lignes_frais(id_ligne_frais) ON DELETE CASCADE,
    id_ligne            text    NOT NULL REFERENCES import_facture_lignes(id_ligne) ON DELETE CASCADE,
    PRIMARY KEY (id_ligne_frais, id_ligne)
);


-- -----------------------------------------------------------------------------
-- lignes_frais_repartition — l'allocation d'un frais sur les lignes
-- -----------------------------------------------------------------------------
CREATE TABLE lignes_frais_repartition (
    id_ligne_frais      text    NOT NULL REFERENCES dossier_lignes_frais(id_ligne_frais) ON DELETE CASCADE,
    -- La ligne de facture qui recoit sa part (« l'article du dossier »).
    id_article_dossier  text    NOT NULL REFERENCES import_facture_lignes(id_ligne) ON DELETE CASCADE,
    pourcentage         numeric(13,10) NOT NULL CHECK (pourcentage >= 0 AND pourcentage <= 100),
    montant_alloue_dhs  numeric(18,2)  NOT NULL CHECK (montant_alloue_dhs >= 0),
    PRIMARY KEY (id_ligne_frais, id_article_dossier)
);

CREATE INDEX ix_lfr_article ON lignes_frais_repartition(id_article_dossier);


-- -----------------------------------------------------------------------------
-- import_receptions — le suivi physique
--
-- UN DOCUMENT A PART, sans dossier : le magasin recoit ce que le camion
-- apporte, et un camion ne connait pas les dossiers. Le lien au dossier passe
-- par les lignes (ligne recue -> ligne de facture -> facture -> dossier) ; une
-- meme reception peut donc prendre des lignes de factures de PLUSIEURS dossiers.
-- -----------------------------------------------------------------------------
CREATE TABLE import_receptions (
    id_reception        text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    numero              text    NOT NULL UNIQUE,
    date_reception      text    NOT NULL,
    statut              text    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','VALIDEE','ANNULEE')),
    litige              bigint  NOT NULL DEFAULT 0 CHECK (litige IN (0,1)),
    motif_litige        text,
    notes               text,
    id_utilisateur_creation   text NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur_validation text REFERENCES utilisateur(id_utilisateur),
    date_validation     text,
    CHECK (litige = 0 OR motif_litige IS NOT NULL),
    CHECK (statut <> 'VALIDEE' OR (id_utilisateur_validation IS NOT NULL AND date_validation IS NOT NULL))
);

CREATE INDEX ix_import_receptions_date ON import_receptions(date_reception DESC);

-- Une ligne recue = une ligne de facture. Les lignes d'une meme reception
-- peuvent venir de PLUSIEURS factures, de plusieurs dossiers.
CREATE TABLE import_reception_lignes (
    id_reception_ligne  text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_reception        text    NOT NULL REFERENCES import_receptions(id_reception) ON DELETE CASCADE,
    id_ligne            text    NOT NULL REFERENCES import_facture_lignes(id_ligne),
    quantite_recue_kg   numeric(18,4) NOT NULL CHECK (quantite_recue_kg > 0),
    -- Le reste a recevoir au moment de la saisie : l'ecart se lit contre lui.
    quantite_attendue_kg numeric(18,4) CHECK (quantite_attendue_kg IS NULL OR quantite_attendue_kg >= 0),
    ecart_kg            numeric(18,4) GENERATED ALWAYS AS (quantite_recue_kg - quantite_attendue_kg) STORED,
    nb_bobines          bigint  NOT NULL DEFAULT 0 CHECK (nb_bobines  >= 0),
    nb_palettes         bigint  NOT NULL DEFAULT 0 CHECK (nb_palettes >= 0),
    lot_fournisseur     text,
    code_couleur        text,
    libelle_couleur     text,
    code_magasin        text    NOT NULL REFERENCES magasin(code_magasin),
    id_mouvement        text    REFERENCES mouvement(id_mouvement),
    UNIQUE (id_reception, id_ligne)
);

CREATE INDEX ix_irl_ligne ON import_reception_lignes(id_ligne);


-- -----------------------------------------------------------------------------
-- import_ajustements_cump — ce que la cloture a fait au CUMP. IMMUABLE.
--
--   STOCK    : une ligne par magasin ou la reference restait en stock ; le CUMP
--              y monte des frais, au prorata du stock present.
--   CONSOMME : une ligne par reference, sans magasin — la part des frais qui
--              revenait a une marchandise deja sortie (tissee, chargee sur un
--              metier). Elle est TRACEE, pas reinjectee : on ne revalorise pas
--              un tapis deja fabrique.
-- -----------------------------------------------------------------------------
CREATE TABLE import_ajustements_cump (
    id_ajustement       text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_dossier          text    NOT NULL REFERENCES import_dossiers(id_dossier),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    nature              text    NOT NULL CHECK (nature IN ('STOCK','CONSOMME')),
    code_magasin        text    REFERENCES magasin(code_magasin),
    quantite_recue_kg   numeric(18,4) NOT NULL CHECK (quantite_recue_kg >= 0),
    stock_kg            numeric(18,4) NOT NULL CHECK (stock_kg >= 0),
    cump_avant          numeric(18,4),
    cump_apres          numeric(18,4),
    montant_dhs         numeric(18,2) NOT NULL,
    date_ajustement     text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur      text    NOT NULL REFERENCES utilisateur(id_utilisateur),
    CHECK ((nature = 'STOCK'    AND code_magasin IS NOT NULL AND cump_apres IS NOT NULL)
        OR (nature = 'CONSOMME' AND code_magasin IS NULL))
);

CREATE INDEX ix_iac_dossier   ON import_ajustements_cump(id_dossier);
CREATE INDEX ix_iac_reference ON import_ajustements_cump(code_reference, date_ajustement DESC);


-- =============================================================================
-- DECLENCHEURS
-- =============================================================================

-- La ligne de commande liee doit etre du MEME fournisseur et de la MEME
-- reference que la ligne de facture : sans ce garde, une facture Hasirci
-- pourrait solder un bon Globaltex.
CREATE OR REPLACE FUNCTION fn_trg_ifl_bc() RETURNS trigger AS $$
DECLARE
    v_ref       text;
    v_four_bc   text;
    v_num_bc    text;
    v_four_fac  text;
BEGIN
    IF NEW.id_ligne_bc IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT lb.code_reference, bc.code_fournisseur, bc.numero_bc
      INTO v_ref, v_four_bc, v_num_bc
      FROM ligne_bc lb JOIN bon_commande bc ON bc.id_bc = lb.id_bc
     WHERE lb.id_ligne_bc = NEW.id_ligne_bc;
    SELECT code_fournisseur INTO v_four_fac FROM import_factures WHERE id_facture = NEW.id_facture;

    IF v_four_bc IS DISTINCT FROM v_four_fac THEN
        RAISE EXCEPTION 'Le bon % est du fournisseur %, la facture de % : la ligne ne peut pas s''y rattacher.',
            v_num_bc, v_four_bc, v_four_fac USING ERRCODE = 'check_violation';
    END IF;
    IF v_ref IS DISTINCT FROM NEW.code_reference THEN
        RAISE EXCEPTION 'La ligne du bon % porte la reference %, la ligne de facture %.',
            v_num_bc, v_ref, NEW.code_reference USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ifl_bc
BEFORE INSERT OR UPDATE OF id_ligne_bc, code_reference ON import_facture_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_ifl_bc();


-- UN DOSSIER CLOS NE BOUGE PLUS. Ses factures, ses lignes, ses frais et leur
-- repartition sont ce qui a servi a corriger le CUMP : les modifier apres coup
-- ferait mentir le stock sans le dire.
CREATE OR REPLACE FUNCTION fn_trg_import_verrou() RETURNS trigger AS $$
DECLARE
    v_row     record;
    v_dossier text;
    v_statut  text;
BEGIN
    IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

    IF TG_TABLE_NAME IN ('import_factures', 'dossier_lignes_frais') THEN
        v_dossier := v_row.id_dossier;
    ELSIF TG_TABLE_NAME = 'import_facture_lignes' THEN
        SELECT id_dossier INTO v_dossier FROM import_factures WHERE id_facture = v_row.id_facture;
    ELSIF TG_TABLE_NAME IN ('dossier_lignes_frais_cibles', 'lignes_frais_repartition') THEN
        SELECT id_dossier INTO v_dossier FROM dossier_lignes_frais WHERE id_ligne_frais = v_row.id_ligne_frais;
    END IF;

    SELECT statut INTO v_statut FROM import_dossiers WHERE id_dossier = v_dossier;
    IF v_statut = 'CLOTURE' THEN
        RAISE EXCEPTION 'Dossier cloture : ses factures, ses frais et leur repartition sont figes.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_import_factures_verrou       BEFORE INSERT OR UPDATE OR DELETE ON import_factures
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_verrou();
CREATE TRIGGER trg_import_lignes_verrou         BEFORE INSERT OR UPDATE OR DELETE ON import_facture_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_verrou();
CREATE TRIGGER trg_import_frais_verrou          BEFORE INSERT OR UPDATE OR DELETE ON dossier_lignes_frais
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_verrou();
CREATE TRIGGER trg_import_cibles_verrou         BEFORE INSERT OR UPDATE OR DELETE ON dossier_lignes_frais_cibles
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_verrou();
CREATE TRIGGER trg_import_repartition_verrou    BEFORE INSERT OR UPDATE OR DELETE ON lignes_frais_repartition
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_verrou();

-- Le dossier lui-meme : clos, il est fige ; commence, il ne se supprime plus
-- (des mouvements de stock le citent).
CREATE OR REPLACE FUNCTION fn_trg_import_dossier_garde() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN
            RAISE EXCEPTION 'Seul un dossier en brouillon se supprime.' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.statut = 'CLOTURE' THEN
        RAISE EXCEPTION 'Dossier cloture : il ne se modifie plus.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_import_dossier_garde
BEFORE UPDATE OR DELETE ON import_dossiers
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_dossier_garde();


-- Le CHECK ci-dessus protege la donnee ; ce declencheur protege l'utilisateur :
-- il dit POURQUOI, en francais, au lieu de laisser remonter une contrainte.
CREATE OR REPLACE FUNCTION fn_trg_pf_coherence() RETURNS trigger AS $$
BEGIN
    IF NEW.recuperable = 1 AND NEW.inclus_dans_cout = 1 THEN
        RAISE EXCEPTION 'Un frais recuperable n''entre pas dans le cout de revient : la marchandise le paierait deux fois.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pf_coherence
BEFORE INSERT OR UPDATE OF recuperable, inclus_dans_cout ON parametres_frais
FOR EACH ROW EXECUTE FUNCTION fn_trg_pf_coherence();


-- Une ligne recue est une ligne ERP, d'un dossier qui n'est pas clos : la
-- cloture a deja reparti les frais sur ce qui etait recu.
CREATE OR REPLACE FUNCTION fn_trg_irl_coherence() RETURNS trigger AS $$
DECLARE
    v_type    text;
    v_numero  text;
    v_statut  text;
BEGIN
    SELECT l.type_ligne, d.numero, d.statut INTO v_type, v_numero, v_statut
      FROM import_facture_lignes l
      JOIN import_factures f ON f.id_facture = l.id_facture
      JOIN import_dossiers d ON d.id_dossier = f.id_dossier
     WHERE l.id_ligne = NEW.id_ligne;

    IF v_type IS DISTINCT FROM 'ERP' THEN
        RAISE EXCEPTION 'Une ligne hors ERP ne se receptionne pas : elle ne porte que sa part de frais.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_statut = 'CLOTURE' THEN
        RAISE EXCEPTION 'Le dossier % est cloture : il ne recoit plus rien.', v_numero
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_irl_coherence
BEFORE INSERT OR UPDATE OF id_ligne, id_reception ON import_reception_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_irl_coherence();


-- Le journal de la cloture est immuable, comme les autres journaux (R03).
CREATE OR REPLACE FUNCTION fn_trg_iac_immuable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'import_ajustements_cump est un journal : ni modification, ni suppression.'
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_iac_immuable
BEFORE UPDATE OR DELETE ON import_ajustements_cump
FOR EACH ROW EXECUTE FUNCTION fn_trg_iac_immuable();


-- =============================================================================
-- VUE — le cout de revient par ligne
-- -----------------------------------------------------------------------------
-- Cout de revient = (valeur d'achat + part des frais HT) / quantite.
-- La valeur d'achat est arrondie au centime ICI COMME DANS LE CALCUL : la base
-- qui a servi a repartir et celle qu'on affiche sont la meme.
-- =============================================================================
CREATE OR REPLACE VIEW v_import_cout_revient AS
WITH frais AS (
    SELECT id_article_dossier, sum(montant_alloue_dhs) AS frais_dhs
      FROM lignes_frais_repartition
     GROUP BY id_article_dossier
)
SELECT l.id_ligne,
       f.id_dossier,
       d.numero                                               AS numero_dossier,
       d.statut                                               AS statut_dossier,
       f.id_facture,
       f.numero_facture,
       f.date_facture,
       f.code_fournisseur,
       fo.nom                                                 AS fournisseur_nom,
       l.ligne_numero,
       l.type_ligne,
       l.code_reference,
       COALESCE(r.designation, l.libelle)                     AS designation,
       l.id_ligne_bc,
       bc.numero_bc,
       l.lot_fournisseur,
       l.code_couleur,
       l.unite,
       l.quantite,
       l.poids_net_kg,
       l.nb_bobines,
       l.nb_palettes,
       l.prix_unitaire_devise,
       f.code_devise,
       f.taux_change,
       l.montant_devise,
       l.pct_dossier,
       round(l.montant_devise * f.taux_change, 2)             AS valeur_achat_dhs,
       round(l.montant_devise * f.taux_change / l.quantite, 4) AS prix_achat_unitaire_dhs,
       COALESCE(fr.frais_dhs, 0)                              AS frais_alloues_dhs,
       round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0)
                                                              AS cout_revient_dhs,
       round((round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0))
             / l.quantite, 4)                                 AS cout_revient_unitaire_dhs,
       CASE WHEN l.poids_net_kg > 0 THEN
            round((round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0))
                  / l.poids_net_kg, 4) END                    AS cout_revient_kg_dhs,
       CASE WHEN l.montant_devise > 0 THEN
            round(COALESCE(fr.frais_dhs, 0) * 100 / round(l.montant_devise * f.taux_change, 2), 2)
       END                                                    AS coef_frais_pct,
       l.quantite_recue_kg,
       l.reste_kg,
       l.soldee,
       l.libelle_couleur,
       -- Voir 2026-09-26d : la remise, en derniere colonne.
       l.remise_pct
  FROM import_facture_lignes l
  JOIN import_factures f  ON f.id_facture = l.id_facture
  JOIN import_dossiers d  ON d.id_dossier = f.id_dossier
  LEFT JOIN reference r   ON r.code_reference = l.code_reference
  LEFT JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
  LEFT JOIN ligne_bc lb   ON lb.id_ligne_bc = l.id_ligne_bc
  LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc
  LEFT JOIN frais fr      ON fr.id_article_dossier = l.id_ligne;

-- -----------------------------------------------------------------------------
-- Engagements d'importation (EI) — voir la migration 2026-09-26e.
-- Reference seulement : ils servent a retrouver et classer un dossier ; le
-- suivi du credit (consommation, echeances) appartient a la tresorerie.
-- -----------------------------------------------------------------------------
CREATE TABLE import_engagements (
    id_engagement   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_dossier      text NOT NULL REFERENCES import_dossiers (id_dossier) ON DELETE CASCADE,
    numero_ei       text NOT NULL CHECK (btrim(numero_ei) <> ''),
    banque          text,
    date_ei         text,
    quantite_kg     numeric(18, 2) CHECK (quantite_kg IS NULL OR quantite_kg >= 0),
    montant_devise  numeric(18, 2) CHECK (montant_devise IS NULL OR montant_devise >= 0),
    code_devise     text,
    notes           text,
    id_utilisateur_creation text,
    date_creation   text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE (id_dossier, numero_ei)
);
CREATE INDEX idx_import_engagements_numero ON import_engagements (numero_ei);
