-- =============================================================================
-- MIGRATION 2026-09-11 — DOSSIERS D'IMPORTATION (MRP / stock / CUMP)
-- -----------------------------------------------------------------------------
-- 1. le code couleur rejoint la reference, le mouvement et le lot ;
-- 2. le declencheur de stock le recopie au lot ;
-- 3. les tables, declencheurs et la vue du module (db/pg/018_schema_import.sql) ;
-- 4. le catalogue des frais, les droits et les champs (db/pg/seed_130_import.sql).
-- Tout ou rien.
-- =============================================================================

BEGIN;

ALTER TABLE reference       ADD COLUMN IF NOT EXISTS code_couleur text;
ALTER TABLE ligne_mouvement ADD COLUMN IF NOT EXISTS code_couleur text;
ALTER TABLE stock_lot       ADD COLUMN IF NOT EXISTS code_couleur text;

CREATE OR REPLACE FUNCTION public.fn_trg_lmvt_appliquer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_magasin       text;
    v_date          text;
    v_signe         integer;
    v_impacte_cmup  smallint;
    v_maintenant    text := to_char((now() AT TIME ZONE 'UTC'),
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    SELECT m.code_magasin, m.date_mouvement, tm.signe, tm.impacte_cmup
      INTO v_magasin, v_date, v_signe, v_impacte_cmup
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- (a1) garantir l'existence de la ligne de solde, a zero
    INSERT INTO stock_magasin (code_reference, code_magasin, quantite_kg, cmup_mad)
    VALUES (NEW.code_reference, v_magasin, 0, NULL)
    ON CONFLICT (code_reference, code_magasin) DO NOTHING;

    -- (a2) appliquer le delta signe, puis le CMUP si entree valorisee (R04)
    UPDATE stock_magasin
       SET cmup_mad = CASE
               WHEN v_impacte_cmup = 1
                AND NEW.prix_kg_mad IS NOT NULL
                AND quantite_kg + NEW.quantite_kg > 0
               THEN round(( quantite_kg * COALESCE(cmup_mad, NEW.prix_kg_mad)
                          + NEW.quantite_kg * NEW.prix_kg_mad )
                          / (quantite_kg + NEW.quantite_kg), 4)
               ELSE cmup_mad
           END,
           quantite_kg = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
           -- LE COMPTE DE BOBINES SUIT LES KILOS, avec le meme signe.
           --
           -- GREATEST borne a zero, et ce n'est pas une precaution de confort :
           -- les mouvements anterieurs a ce module ne portent aucun nombre de
           -- bobines, donc un magasin peut contenir 400 kg pour un compte de 0.
           -- Sans la borne, la premiere sortie chiffree violerait le CHECK et
           -- bloquerait un mouvement de kilos parfaitement legitime. Le compte
           -- est un compteur SECONDAIRE ; c'est le controle C30 qui signale les
           -- incoherences, pas une erreur au visage du magasinier.
           nb_bobines = GREATEST(0, nb_bobines + v_signe * COALESCE(NEW.nb_bobines, 0)),
           date_derniere_entree = CASE WHEN v_signe =  1 THEN v_date
                                       ELSE date_derniere_entree END,
           date_derniere_sortie = CASE WHEN v_signe = -1 THEN v_date
                                       ELSE date_derniere_sortie END,
           date_maj = v_maintenant
     WHERE code_reference = NEW.code_reference
       AND code_magasin   = v_magasin;

    -- (b) solde par lot, seulement si la ligne porte un lot
    IF NEW.lot_fournisseur IS NOT NULL THEN
        INSERT INTO stock_lot (code_reference, code_magasin, lot_fournisseur, quantite_kg,
                               prix_entree_mad, date_fabrication, date_peremption, code_couleur)
        VALUES (NEW.code_reference, v_magasin, NEW.lot_fournisseur, 0,
                NEW.prix_kg_mad, NEW.date_fabrication, NEW.date_peremption, NEW.code_couleur)
        ON CONFLICT (code_reference, code_magasin, lot_fournisseur) DO NOTHING;

        UPDATE stock_lot
           SET quantite_kg      = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
               -- Meme borne, meme raison qu'au solde par magasin ci-dessus.
               -- C'est CE compte-ci que lit le declencheur de capacite : sur un
               -- emplacement de machine, ou la saisie impose toujours le nombre
               -- de bobines, il est exact des la premiere ecriture.
               nb_bobines       = GREATEST(0, nb_bobines + v_signe * COALESCE(NEW.nb_bobines, 0)),
               prix_entree_mad  = COALESCE(prix_entree_mad, NEW.prix_kg_mad),
               date_fabrication = COALESCE(date_fabrication, NEW.date_fabrication),
               date_peremption  = COALESCE(date_peremption, NEW.date_peremption),
               code_couleur     = COALESCE(code_couleur, NEW.code_couleur),
               date_maj         = v_maintenant
         WHERE code_reference  = NEW.code_reference
           AND lot_fournisseur = NEW.lot_fournisseur
           AND code_magasin    = v_magasin;
    END IF;

    -- (c) CMUP consolide tous magasins sur la fiche reference (RG-08)
    IF v_impacte_cmup = 1 THEN
        UPDATE reference
           SET cmup_mad = (
                   SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                     FROM stock_magasin sm
                    WHERE sm.code_reference = NEW.code_reference
                      AND sm.quantite_kg > 0
                      AND sm.cmup_mad IS NOT NULL),
               date_dernier_cmup = v_maintenant
         WHERE code_reference = NEW.code_reference;
    END IF;

    RETURN NULL;
END;
$function$;

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
CREATE TABLE parametres_frais (
    id_frais            text    NOT NULL PRIMARY KEY,
    libelle             text    NOT NULL,
    categorie           text    NOT NULL
                                CHECK (categorie IN ('DOUANE','TAXE','TRANSPORT','PORT','TRANSIT','AUTRE')),
    inclus_dans_cout    bigint  NOT NULL CHECK (inclus_dans_cout IN (0,1)),
    ordre               bigint  NOT NULL DEFAULT 0,
    actif               bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
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

    -- Quantite FACTUREE, dans l'unite de la facture ; le poids net est saisi a
    -- part parce que le stock se tient en kg (R01) quelle que soit l'unite.
    unite               text    NOT NULL DEFAULT 'kg' CHECK (unite IN ('kg','ml','piece')),
    quantite            numeric(18,4) NOT NULL CHECK (quantite > 0),
    poids_net_kg        numeric(18,4) CHECK (poids_net_kg IS NULL OR poids_net_kg > 0),
    nb_bobines          bigint  NOT NULL DEFAULT 0 CHECK (nb_bobines  >= 0),
    nb_palettes         bigint  NOT NULL DEFAULT 0 CHECK (nb_palettes >= 0),
    prix_unitaire_devise numeric(18,4) NOT NULL CHECK (prix_unitaire_devise > 0),
    -- La BASE de la repartition des frais.
    montant_devise      numeric(18,2) GENERATED ALWAYS AS (round(quantite * prix_unitaire_devise, 2)) STORED,
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
-- -----------------------------------------------------------------------------
CREATE TABLE import_receptions (
    id_reception        text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    numero              text    NOT NULL UNIQUE,
    id_dossier          text    NOT NULL REFERENCES import_dossiers(id_dossier),
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

CREATE INDEX ix_import_receptions_dossier ON import_receptions(id_dossier, date_reception DESC);

-- Une ligne recue = une ligne de facture. Les lignes d'une meme reception
-- peuvent venir de PLUSIEURS factures du dossier.
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


-- Une ligne recue appartient au dossier de sa reception, et c'est une ligne ERP.
CREATE OR REPLACE FUNCTION fn_trg_irl_coherence() RETURNS trigger AS $$
DECLARE
    v_dossier_rec text;
    v_dossier_lig text;
    v_type        text;
BEGIN
    SELECT id_dossier INTO v_dossier_rec FROM import_receptions WHERE id_reception = NEW.id_reception;
    SELECT f.id_dossier, l.type_ligne INTO v_dossier_lig, v_type
      FROM import_facture_lignes l JOIN import_factures f ON f.id_facture = l.id_facture
     WHERE l.id_ligne = NEW.id_ligne;

    IF v_type IS DISTINCT FROM 'ERP' THEN
        RAISE EXCEPTION 'Une ligne hors ERP ne se receptionne pas : elle ne porte que sa part de frais.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_dossier_rec IS DISTINCT FROM v_dossier_lig THEN
        RAISE EXCEPTION 'Cette ligne de facture appartient a un autre dossier.' USING ERRCODE = 'check_violation';
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
       l.soldee
  FROM import_facture_lignes l
  JOIN import_factures f  ON f.id_facture = l.id_facture
  JOIN import_dossiers d  ON d.id_dossier = f.id_dossier
  LEFT JOIN reference r   ON r.code_reference = l.code_reference
  LEFT JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
  LEFT JOIN ligne_bc lb   ON lb.id_ligne_bc = l.id_ligne_bc
  LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc
  LEFT JOIN frais fr      ON fr.id_article_dossier = l.id_ligne;


-- =============================================================================
-- seed_130 — DOSSIERS D'IMPORTATION : catalogue des frais, droits, champs
-- =============================================================================

-- Les colonnes de frais du classeur IMPORTATION 2026, une par une. La TVA est
-- saisie comme les autres (le dossier doit balancer avec les pieces) mais elle
-- est recuperable : elle n'entre jamais dans le cout de revient.
INSERT INTO parametres_frais (id_frais, libelle, categorie, inclus_dans_cout, ordre) VALUES
    ('DOUANE',    'Droits de douane (D.D.)',              'DOUANE',    1, 10),
    ('TVA',       'TVA a l''importation',                 'TAXE',      0, 20),
    ('PORT_MED',  'Port Tanger Med',                      'PORT',      1, 30),
    ('FRET',      'Fret',                                 'TRANSPORT', 1, 40),
    ('TREMSA',    'Transitaire (TREMSA / WIDEM)',         'TRANSIT',   1, 50),
    ('TIMBRE',    'Timbre',                               'TAXE',      1, 60),
    ('INT_OC',    'INT/OC',                               'TRANSIT',   1, 70),
    ('TMSA',      'TMSA',                                 'PORT',      1, 80),
    ('TRANSPORT', 'Transport local',                      'TRANSPORT', 1, 90),
    ('AUTRE',     'Autre frais',                          'AUTRE',     1, 99)
ON CONFLICT (id_frais) DO NOTHING;

-- Le module IMPORT. Saisir un dossier : direction, administration, assistante.
-- CLOTURER — donc changer le CUMP — : direction et administration seulement.
-- La reception physique passe, elle, par le module RECEPTIONS, comme toute
-- reception : le magasinier y a deja ses droits.
INSERT INTO permission (code_role_user, module, action)
SELECT r.code_role_user, 'IMPORT', a.action
  FROM role_utilisateur r
  CROSS JOIN (VALUES ('LIRE'), ('ECRIRE'), ('VALIDER')) AS a(action)
 WHERE (r.code_role_user IN ('ADMIN', 'DIRECTION'))
    OR (r.code_role_user = 'ASSISTANTE' AND a.action IN ('LIRE', 'ECRIRE'))
ON CONFLICT (code_role_user, module, action) DO NOTHING;

-- LES COLONNES DE LA LISTE DOIVENT ETRE DECLAREES : l'interface masque tout
-- champ absent de la grille, et la liste des dossiers n'afficherait qu'une
-- colonne. Elles se lisent avec le module.
--
-- Le cout de revient, lui, est une VALORISATION : masque a qui n'a pas ce
-- module. Les prix d'achat restent lisibles — l'assistante les saisit.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('IMPORT', 'numero',                    'Numero du dossier',             'LECTURE', 0, 2000),
 ('IMPORT', 'statut',                    'Statut',                        'LECTURE', 0, 2005),
 ('IMPORT', 'fournisseurs',              'Fournisseurs',                  'LECTURE', 0, 2010),
 ('IMPORT', 'nb_factures',               'Nombre de factures',            'LECTURE', 0, 2015),
 ('IMPORT', 'date_arrivee',              'Date d''arrivee',               'LECTURE', 0, 2020),
 ('IMPORT', 'valeur_dhs',                'Valeur d''achat (DH)',          'LECTURE', 0, 2025),
 ('IMPORT', 'frais_dhs',                 'Frais inclus (DH)',             'LECTURE', 0, 2030),
 ('IMPORT', 'tva_dhs',                   'Frais hors cout (DH)',          'LECTURE', 0, 2035),
 ('IMPORT', 'poids_kg',                  'Poids facture (kg)',            'LECTURE', 0, 2040),
 ('IMPORT', 'recu_kg',                   'Poids recu (kg)',               'LECTURE', 0, 2045),
 ('IMPORT', 'nb_palettes',               'Palettes',                      'LECTURE', 0, 2050),
 ('IMPORT', 'nb_bobines',                'Bobines',                       'LECTURE', 0, 2055),
 ('IMPORT', 'frais_alloues_dhs',         'Frais alloues (DH)',            'LECTURE', 1, 2100),
 ('IMPORT', 'montant_alloue_dhs',        'Part de frais (DH)',            'LECTURE', 1, 2110),
 ('IMPORT', 'cout_revient_dhs',          'Cout de revient (DH)',          'LECTURE', 1, 2120),
 ('IMPORT', 'cout_revient_unitaire_dhs', 'Cout de revient unitaire (DH)', 'LECTURE', 1, 2130),
 ('IMPORT', 'cout_revient_kg_dhs',       'Cout de revient au kg (DH)',    'LECTURE', 1, 2140),
 ('IMPORT', 'coef_frais_pct',            'Frais en % de la valeur',       'LECTURE', 1, 2150),
 ('IMPORT', 'cump_avant',                'CUMP avant cloture',            'LECTURE', 1, 2160),
 ('IMPORT', 'cump_apres',                'CUMP apres cloture',            'LECTURE', 1, 2170)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
           WHEN c.sensible = 1 AND NOT EXISTS (
                SELECT 1 FROM permission p
                 WHERE p.code_role_user = r.code_role_user
                   AND p.module = 'VALORISATION' AND p.action = 'LIRE') THEN 'MASQUE'
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = 'IMPORT' AND p.action = 'LIRE') THEN 'LECTURE'
           ELSE 'MASQUE'
       END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'IMPORT' AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'IMPORT'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;


ALTER TABLE parametres_frais            OWNER TO gestionfil;
ALTER TABLE import_dossiers             OWNER TO gestionfil;
ALTER TABLE import_factures             OWNER TO gestionfil;
ALTER TABLE import_facture_lignes       OWNER TO gestionfil;
ALTER TABLE dossier_lignes_frais        OWNER TO gestionfil;
ALTER TABLE dossier_lignes_frais_cibles OWNER TO gestionfil;
ALTER TABLE lignes_frais_repartition    OWNER TO gestionfil;
ALTER TABLE import_receptions           OWNER TO gestionfil;
ALTER TABLE import_reception_lignes     OWNER TO gestionfil;
ALTER TABLE import_ajustements_cump     OWNER TO gestionfil;
ALTER VIEW  v_import_cout_revient       OWNER TO gestionfil;

COMMIT;
