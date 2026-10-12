-- =============================================================================
-- 2026-10-12a — Les fiches de frais d'approche : allocation figee, application
--               tracee, anciens dossiers intouches (etape 1 : le schema seul)
-- =============================================================================
-- Conception validee le 12/10/2026 (memoire frais-approche-conception-1210) :
--   * PARAMETRAGE : le type de frais dit les cles AUTORISEES et propose la cle
--     par defaut (methode_repartition). Il ne decide rien.
--   * DECISION    : la fiche (dossier_lignes_frais) porte la cle choisie, un
--     motif si elle differe du defaut, et passe BROUILLON -> VALIDE -> APPLIQUE.
--     VALIDE -> BROUILLON seulement si rien n'a ete applique (motif, auteur,
--     date). Une fiche appliquee ne se reecrit plus : on la corrige par une
--     fiche RECTIFICATIVE liee (id_ligne_frais_origine).
--   * MOTEUR      : l'allocation (lignes_frais_repartition) est ecrite UNE fois,
--     par version de fiche, puis figee. Chaque application au CMUP est une ligne
--     du journal import_ajustements_cump (origine FICHE), liee a la fiche, a la
--     ligne de facture et a la reception ; une contre-passation en est l'inverse
--     EXACT.
--
-- ANCIENS DOSSIERS. Les dossiers clotures passent au moteur HISTORIQUE : leurs
-- frais (statut NULL), leurs allocations et leur journal ne bougent plus — plus
-- aucune echappatoire « post-cloture » ne permet de recalculer leur
-- repartition. Un frais tardif s'y ajoute en fiche NOUVELLE (motif), avec
-- sa propre allocation. Les dossiers NON clotures passent au moteur FICHES : leurs frais
-- deviennent des fiches BROUILLON (cle actuelle proposee) et leur allocation
-- actuelle est gardee comme version 0 archivee — ni recalculee, ni effacee.
--
-- ATTENTION — SE PUBLIE AVEC LE BINAIRE DE L'ETAPE 2. L'ancien recalcul efface
-- toute la repartition d'un dossier : sur un dossier converti, la garde le
-- refuse (version archivee). La migration est donc exigee au demarrage par le
-- nouveau binaire, et l'ancien binaire ne doit pas servir une base migree.
--
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';
-- Les ecritures de la conversion (section 7) sont signees dans le journal
-- d'audit : un compte technique nomme, jamais une ligne anonyme.
SELECT set_config('gestionfil.id_utilisateur', 'MIGRATION 2026-10-12a', true);

-- -----------------------------------------------------------------------------
-- 1. Le parametrage : cles autorisees, cle proposee
-- -----------------------------------------------------------------------------
-- LE NOUVEAU MOTEUR NE CONNAIT QUE VALEUR, POIDS ET MANUEL. Un type dont la
-- cle proposee est autre (QUANTITE, PARTS_EGALES) arrete la migration AVANT
-- toute modification : le parametrage se corrige d'abord, rien n'est converti
-- en silence. Les frais historiques n'en dependent pas (leur allocation est
-- conservee telle quelle, sans cle).
DO $$
DECLARE
    v_types text;
BEGIN
    SELECT string_agg(id_frais || ' (' || methode_repartition || ')', ', ') INTO v_types
      FROM parametres_frais WHERE NOT (methode_repartition = ANY (ARRAY['VALEUR', 'POIDS', 'MANUEL']));
    IF v_types IS NOT NULL THEN
        RAISE EXCEPTION 'Types de frais dont la cle proposee n''est ni VALEUR, ni POIDS, ni MANUEL : %. Corrigez methode_repartition avant de migrer.', v_types;
    END IF;
END $$;

ALTER TABLE parametres_frais
    ADD COLUMN IF NOT EXISTS cles_autorisees text[] NOT NULL DEFAULT ARRAY['VALEUR', 'POIDS', 'MANUEL'];
COMMENT ON COLUMN parametres_frais.cles_autorisees IS
  'Cles que l''utilisateur peut choisir sur une fiche de ce type. methode_repartition est la cle PROPOSEE, prise dans cette liste.';
COMMENT ON COLUMN parametres_frais.methode_repartition IS
  'Cle proposee par defaut a la saisie d''une fiche. Une proposition : la fiche enregistre la cle reellement choisie.';

ALTER TABLE parametres_frais DROP CONSTRAINT IF EXISTS parametres_frais_methode_check;
ALTER TABLE parametres_frais ADD CONSTRAINT parametres_frais_methode_check
    CHECK (methode_repartition = ANY (ARRAY['VALEUR', 'POIDS', 'MANUEL']));
ALTER TABLE parametres_frais DROP CONSTRAINT IF EXISTS ck_pf_cles_autorisees;
ALTER TABLE parametres_frais ADD CONSTRAINT ck_pf_cles_autorisees
    CHECK (cardinality(cles_autorisees) > 0
           AND cles_autorisees <@ ARRAY['VALEUR', 'POIDS', 'MANUEL']::text[]);
ALTER TABLE parametres_frais DROP CONSTRAINT IF EXISTS ck_pf_defaut_autorise;
ALTER TABLE parametres_frais ADD CONSTRAINT ck_pf_defaut_autorise
    CHECK (methode_repartition = ANY (cles_autorisees));

-- -----------------------------------------------------------------------------
-- 2. Le dossier : quel moteur porte ses frais
-- -----------------------------------------------------------------------------
-- Ajoutee a HISTORIQUE (tous les dossiers existants), puis les dossiers non
-- clotures passent a FICHES ; un dossier cree ensuite naît FICHES.
ALTER TABLE import_dossiers
    ADD COLUMN IF NOT EXISTS moteur_frais text NOT NULL DEFAULT 'HISTORIQUE';
ALTER TABLE import_dossiers DROP CONSTRAINT IF EXISTS ck_import_dossiers_moteur_frais;
ALTER TABLE import_dossiers ADD CONSTRAINT ck_import_dossiers_moteur_frais
    CHECK (moteur_frais = ANY (ARRAY['HISTORIQUE', 'FICHES']));
UPDATE import_dossiers SET moteur_frais = 'FICHES'
 WHERE statut <> 'CLOTURE' AND moteur_frais = 'HISTORIQUE';
ALTER TABLE import_dossiers ALTER COLUMN moteur_frais SET DEFAULT 'FICHES';
COMMENT ON COLUMN import_dossiers.moteur_frais IS
  'HISTORIQUE : dossier clos avant le 12/10/2026, frais portes a la cloture par l''ancien moteur, jamais recalcules. FICHES : fiches de frais validees et appliquees une a une.';

-- -----------------------------------------------------------------------------
-- 3. La fiche de frais : la decision de l'utilisateur
-- -----------------------------------------------------------------------------
ALTER TABLE dossier_lignes_frais
    ADD COLUMN IF NOT EXISTS statut text,
    ADD COLUMN IF NOT EXISTS cle_repartition text,
    ADD COLUMN IF NOT EXISTS motif_cle text,
    ADD COLUMN IF NOT EXISTS capitalisable smallint,
    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS id_utilisateur_validation text REFERENCES utilisateur(id_utilisateur),
    ADD COLUMN IF NOT EXISTS date_validation text,
    ADD COLUMN IF NOT EXISTS date_application text,
    ADD COLUMN IF NOT EXISTS id_ligne_frais_origine text REFERENCES dossier_lignes_frais(id_ligne_frais),
    ADD COLUMN IF NOT EXISTS motif_rectification text,
    ADD COLUMN IF NOT EXISTS motif_brouillon text,
    ADD COLUMN IF NOT EXISTS id_utilisateur_brouillon text REFERENCES utilisateur(id_utilisateur),
    ADD COLUMN IF NOT EXISTS date_brouillon text;

COMMENT ON COLUMN dossier_lignes_frais.statut IS
  'BROUILLON -> VALIDE (allocation figee) -> APPLIQUE (reste a appliquer nul). NULL : frais d''un dossier HISTORIQUE (ancien moteur).';
COMMENT ON COLUMN dossier_lignes_frais.cle_repartition IS
  'Cle CHOISIE par l''utilisateur (VALEUR, POIDS, MANUEL), dans les cles autorisees du type.';
COMMENT ON COLUMN dossier_lignes_frais.motif_cle IS
  'Exige quand la cle choisie differe de la cle proposee par le type.';
COMMENT ON COLUMN dossier_lignes_frais.capitalisable IS
  'Recopie du type a la validation : un changement ulterieur du parametrage ne touche pas une fiche validee.';
COMMENT ON COLUMN dossier_lignes_frais.version IS
  'Version de l''allocation en vigueur. Une remise en brouillon l''incremente ; les versions anterieures restent, archivees.';
COMMENT ON COLUMN dossier_lignes_frais.id_ligne_frais_origine IS
  'Fiche rectificative : la fiche d''origine qu''elle corrige. L''origine n''est jamais reecrite.';

ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_statut;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_statut
    CHECK (statut IS NULL OR statut = ANY (ARRAY['BROUILLON', 'VALIDE', 'APPLIQUE']));
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_cle;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_cle
    CHECK (cle_repartition IS NULL OR cle_repartition = ANY (ARRAY['VALEUR', 'POIDS', 'MANUEL']));
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_capitalisable;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_capitalisable
    CHECK (capitalisable IS NULL OR capitalisable = ANY (ARRAY[0, 1]::smallint[]));
-- Une fiche validee porte sa decision complete.
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_decision;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_decision
    CHECK (statut IS NULL OR statut = 'BROUILLON'
           OR (cle_repartition IS NOT NULL AND capitalisable IS NOT NULL
               AND id_utilisateur_validation IS NOT NULL AND date_validation IS NOT NULL));
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_application;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_application
    CHECK (statut IS DISTINCT FROM 'APPLIQUE' OR date_application IS NOT NULL);
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_brouillon_motif;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_brouillon_motif
    CHECK (date_brouillon IS NULL
           OR (id_utilisateur_brouillon IS NOT NULL AND char_length(btrim(COALESCE(motif_brouillon, ''))) >= 5));
-- Le montant : positif, sauf une rectificative (signee, jamais nulle).
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS dossier_lignes_frais_montant_devise_check;
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_montant;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_montant
    CHECK (montant_devise > 0 OR (id_ligne_frais_origine IS NOT NULL AND montant_devise <> 0));
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_origine_autre;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_origine_autre
    CHECK (id_ligne_frais_origine IS DISTINCT FROM id_ligne_frais);
-- Une rectificative dit pourquoi et sur quelle piece (numero_piece, colonne
-- existante : la reference de l'avoir ou de la facture corrigee).
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_rectification;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_rectification
    CHECK (id_ligne_frais_origine IS NULL
           OR (char_length(btrim(COALESCE(motif_rectification, ''))) >= 5
               AND btrim(COALESCE(numero_piece, '')) <> ''));
-- Les dates suivent la convention du schema : texte ISO-8601 controle.
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_date_dossier_lignes_frais_date_validation;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_date_dossier_lignes_frais_date_validation
    CHECK (date_validation IS NULL OR date_validation ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$');
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_date_dossier_lignes_frais_date_application;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_date_dossier_lignes_frais_date_application
    CHECK (date_application IS NULL OR date_application ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$');
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_date_dossier_lignes_frais_date_brouillon;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_date_dossier_lignes_frais_date_brouillon
    CHECK (date_brouillon IS NULL OR date_brouillon ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$');
DROP TRIGGER IF EXISTS trg_00_date_vide ON dossier_lignes_frais;
CREATE TRIGGER trg_00_date_vide BEFORE INSERT OR UPDATE ON dossier_lignes_frais
    FOR EACH ROW EXECUTE FUNCTION fn_trg_date_vide_null('date_creation', 'date_validation', 'date_application', 'date_brouillon');

CREATE INDEX IF NOT EXISTS ix_fk_dossier_lignes_frais_origine
    ON dossier_lignes_frais (id_ligne_frais_origine);
CREATE INDEX IF NOT EXISTS ix_fk_dossier_lignes_frais_validation
    ON dossier_lignes_frais (id_utilisateur_validation);
CREATE INDEX IF NOT EXISTS ix_fk_dossier_lignes_frais_brouillon
    ON dossier_lignes_frais (id_utilisateur_brouillon);

-- -----------------------------------------------------------------------------
-- 4. Les lignes visees : le montant saisi en cle MANUEL
-- -----------------------------------------------------------------------------
ALTER TABLE dossier_lignes_frais_cibles
    ADD COLUMN IF NOT EXISTS montant_saisi numeric(18,2);
COMMENT ON COLUMN dossier_lignes_frais_cibles.montant_saisi IS
  'Cle MANUEL : le montant que l''utilisateur affecte a la ligne. Leur somme doit egaler le montant de la fiche.';

-- -----------------------------------------------------------------------------
-- 4 bis. La ligne de facture : la decision sur le reste a appliquer au solde
-- -----------------------------------------------------------------------------
-- Une ligne soldee peut garder un reste de frais non applique. Le moteur ne
-- tranche pas : l'utilisateur choisit, explicitement. NULL = pas encore
-- decide ; la cloture refuse tant qu'un reste existe sans decision.
ALTER TABLE import_facture_lignes
    ADD COLUMN IF NOT EXISTS traitement_reste_frais text,
    ADD COLUMN IF NOT EXISTS motif_traitement_reste text,
    ADD COLUMN IF NOT EXISTS id_utilisateur_traitement_reste text REFERENCES utilisateur(id_utilisateur),
    ADD COLUMN IF NOT EXISTS date_traitement_reste text;
COMMENT ON COLUMN import_facture_lignes.traitement_reste_frais IS
  'Ligne soldee avec un reste de frais : APPLIQUER_RECU (le reste va aux kg reellement recus) ou JOURNAL_ECART (le reste va au journal des ecarts). NULL : pas encore decide.';
ALTER TABLE import_facture_lignes DROP CONSTRAINT IF EXISTS ck_ifl_traitement_reste;
ALTER TABLE import_facture_lignes ADD CONSTRAINT ck_ifl_traitement_reste
    CHECK (traitement_reste_frais IS NULL
           OR (traitement_reste_frais = ANY (ARRAY['APPLIQUER_RECU', 'JOURNAL_ECART'])
               AND char_length(btrim(COALESCE(motif_traitement_reste, ''))) >= 5
               AND id_utilisateur_traitement_reste IS NOT NULL AND date_traitement_reste IS NOT NULL));
ALTER TABLE import_facture_lignes DROP CONSTRAINT IF EXISTS ck_date_import_facture_lignes_date_traitement_reste;
ALTER TABLE import_facture_lignes ADD CONSTRAINT ck_date_import_facture_lignes_date_traitement_reste
    CHECK (date_traitement_reste IS NULL OR date_traitement_reste ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$');
DROP TRIGGER IF EXISTS trg_00_date_vide ON import_facture_lignes;
CREATE TRIGGER trg_00_date_vide BEFORE INSERT OR UPDATE ON import_facture_lignes
    FOR EACH ROW EXECUTE FUNCTION fn_trg_date_vide_null('date_traitement_reste');
CREATE INDEX IF NOT EXISTS ix_fk_import_facture_lignes_traitement_reste
    ON import_facture_lignes (id_utilisateur_traitement_reste);

-- -----------------------------------------------------------------------------
-- 5. L'allocation : une version par validation, figee
-- -----------------------------------------------------------------------------
ALTER TABLE lignes_frais_repartition
    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS base_repartition numeric(20,6),
    ADD COLUMN IF NOT EXISTS montant_theorique numeric(20,6);
COMMENT ON COLUMN lignes_frais_repartition.base_repartition IS
  'La base de la ligne pour la cle choisie (valeur MAD, poids net kg, ou montant saisi en MANUEL).';
COMMENT ON COLUMN lignes_frais_repartition.montant_theorique IS
  'Montant exact avant arrondi ; montant_alloue_dhs est l''arrondi au centime par la methode du plus fort reste.';

-- La version entre dans la cle : une remise en brouillon ajoute une version,
-- elle ne remplace pas l'ancienne.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.conname = 'lignes_frais_repartition_pkey' AND a.attname = 'version'
    ) THEN
        ALTER TABLE lignes_frais_repartition DROP CONSTRAINT lignes_frais_repartition_pkey;
        ALTER TABLE lignes_frais_repartition
            ADD CONSTRAINT lignes_frais_repartition_pkey PRIMARY KEY (id_ligne_frais, version, id_article_dossier);
    END IF;
END $$;

-- Le signe de l'allocation suit celui de la fiche (garde plus bas) : la
-- contrainte « >= 0 » refuserait une rectificative negative.
ALTER TABLE lignes_frais_repartition DROP CONSTRAINT IF EXISTS lignes_frais_repartition_montant_alloue_dhs_check;

-- -----------------------------------------------------------------------------
-- 6. Le journal : chaque application, liee et reversible exactement
-- -----------------------------------------------------------------------------
ALTER TABLE import_ajustements_cump
    ADD COLUMN IF NOT EXISTS type_operation text,
    ADD COLUMN IF NOT EXISTS id_ligne_frais text REFERENCES dossier_lignes_frais(id_ligne_frais),
    ADD COLUMN IF NOT EXISTS id_ligne text REFERENCES import_facture_lignes(id_ligne),
    ADD COLUMN IF NOT EXISTS id_reception text REFERENCES import_receptions(id_reception),
    ADD COLUMN IF NOT EXISTS quantite_kg numeric(18,4),
    ADD COLUMN IF NOT EXISTS id_ajustement_origine text REFERENCES import_ajustements_cump(id_ajustement);
COMMENT ON COLUMN import_ajustements_cump.type_operation IS
  'Origine FICHE : APPLICATION (part d''une fiche portee au stock ou au consomme) ou CONTRE_PASSATION (inverse exact d''une application). NULL pour l''ancien moteur.';
COMMENT ON COLUMN import_ajustements_cump.quantite_kg IS
  'Origine FICHE : les kg sur lesquels porte la ligne (presents dans le magasin, ou sortis).';

ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS ck_iac_origine;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT ck_iac_origine
    CHECK (origine = ANY (ARRAY['FRAIS', 'AVOIR_PRIX', 'AVOIR_RETOUR', 'FICHE']));
ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS ck_iac_avoir_justifie;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT ck_iac_avoir_justifie
    CHECK (origine = ANY (ARRAY['FRAIS', 'FICHE'])
           OR (COALESCE(btrim(numero_piece), '') <> '' AND char_length(btrim(COALESCE(motif, ''))) >= 5));
ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS ck_iac_type_operation;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT ck_iac_type_operation
    CHECK (type_operation IS NULL OR type_operation = ANY (ARRAY['APPLICATION', 'CONTRE_PASSATION']));
ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS ck_iac_fiche;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT ck_iac_fiche
    CHECK ((origine = 'FICHE') = (type_operation IS NOT NULL)
           AND (origine <> 'FICHE'
                OR (id_ligne_frais IS NOT NULL AND id_ligne IS NOT NULL AND quantite_kg IS NOT NULL)));
ALTER TABLE import_ajustements_cump DROP CONSTRAINT IF EXISTS ck_iac_contre_passation;
ALTER TABLE import_ajustements_cump ADD CONSTRAINT ck_iac_contre_passation
    CHECK ((type_operation IS NOT DISTINCT FROM 'CONTRE_PASSATION') = (id_ajustement_origine IS NOT NULL));

-- IDEMPOTENCE : une reception ne s'applique qu'une fois par fiche, ligne,
-- nature et magasin ; une application ne se contre-passe qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS ux_iac_application
    ON import_ajustements_cump (id_ligne_frais, id_ligne, COALESCE(id_reception, ''), nature, COALESCE(code_magasin, ''))
 WHERE type_operation = 'APPLICATION';
CREATE UNIQUE INDEX IF NOT EXISTS ux_iac_contre_passation
    ON import_ajustements_cump (id_ajustement_origine)
 WHERE type_operation = 'CONTRE_PASSATION';
CREATE INDEX IF NOT EXISTS ix_fk_iac_ligne_frais ON import_ajustements_cump (id_ligne_frais);
CREATE INDEX IF NOT EXISTS ix_fk_iac_ligne ON import_ajustements_cump (id_ligne);
CREATE INDEX IF NOT EXISTS ix_fk_iac_reception ON import_ajustements_cump (id_reception);

-- -----------------------------------------------------------------------------
-- 6 bis. L'audit des tables de frais qui ne l'etaient pas — AVANT la conversion,
--        pour que le passage des allocations en version 0 soit trace.
-- -----------------------------------------------------------------------------
-- Le parametrage (une cle autorisee retiree se trace), les lignes visees
-- (montants saisis) et l'allocation (ecrite a la validation).
DROP TRIGGER IF EXISTS trg_audit_modification ON parametres_frais;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON parametres_frais
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();
DROP TRIGGER IF EXISTS trg_audit_modification ON dossier_lignes_frais_cibles;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON dossier_lignes_frais_cibles
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();
DROP TRIGGER IF EXISTS trg_audit_modification ON lignes_frais_repartition;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON lignes_frais_repartition
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- -----------------------------------------------------------------------------
-- 7. Conversion des dossiers non clotures (avant les gardes)
-- -----------------------------------------------------------------------------
-- Leur allocation actuelle devient la version 0, archivee : elle n'est ni
-- recalculee ni effacee. Leurs frais deviennent des fiches BROUILLON, version 1,
-- avec la cle actuelle du type PROPOSEE (l'utilisateur la confirme a la
-- validation). Rejouable : une fiche deja convertie (statut renseigne) n'est
-- plus touchee.
UPDATE lignes_frais_repartition r
   SET version = 0
  FROM dossier_lignes_frais f
  JOIN import_dossiers d ON d.id_dossier = f.id_dossier
 WHERE r.id_ligne_frais = f.id_ligne_frais
   AND d.moteur_frais = 'FICHES' AND f.statut IS NULL AND r.version <> 0;

UPDATE dossier_lignes_frais f
   SET statut = 'BROUILLON',
       cle_repartition = CASE WHEN p.methode_repartition = ANY (ARRAY['VALEUR', 'POIDS', 'MANUEL'])
                              THEN p.methode_repartition END
  FROM import_dossiers d, parametres_frais p
 WHERE d.id_dossier = f.id_dossier AND p.id_frais = f.id_frais
   AND d.moteur_frais = 'FICHES' AND f.statut IS NULL;

-- -----------------------------------------------------------------------------
-- 8. Les gardes en base
-- -----------------------------------------------------------------------------

-- 8a. La fiche : transitions et decision figee.
CREATE OR REPLACE FUNCTION fn_trg_fiche_frais_garde() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_somme    numeric;
    v_lignes   bigint;
    v_origine  record;
    v_type     record;
    v_libres   text[];
    v_applique boolean;
BEGIN
    -- Une fiche nouvelle, meme sur un dossier HISTORIQUE (frais tardif) :
    -- elle a sa propre allocation, les frais anciens ne bougent pas. Sur un
    -- dossier clos, fn_trg_frais_dossier_clos exige en plus le motif.
    IF TG_OP = 'INSERT' THEN
        IF NEW.statut IS DISTINCT FROM 'BROUILLON' THEN
            RAISE EXCEPTION 'FRAIS-ETAT : une fiche de frais nait en BROUILLON.' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.id_ligne_frais_origine IS NOT NULL THEN
            SELECT id_dossier, statut, id_ligne_frais_origine AS origine_de_l_origine INTO v_origine
              FROM dossier_lignes_frais WHERE id_ligne_frais = NEW.id_ligne_frais_origine;
            IF v_origine.id_dossier IS DISTINCT FROM NEW.id_dossier
               OR v_origine.statut IS NULL OR v_origine.statut = 'BROUILLON' THEN
                RAISE EXCEPTION 'FRAIS-RECTIFICATIVE : une rectificative corrige une fiche validee du meme dossier.'
                    USING ERRCODE = 'check_violation';
            END IF;
            -- PAS DE CHAINE : toute rectificative vise la fiche ORIGINALE.
            -- Plusieurs rectificatives d'une meme fiche restent possibles.
            IF v_origine.origine_de_l_origine IS NOT NULL THEN
                RAISE EXCEPTION 'FRAIS-RECTIFICATIVE : une rectificative ne corrige pas une rectificative ; rattachez-la a la fiche originale.'
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- Un frais de l'ancien moteur (dossier HISTORIQUE) est une photographie :
    -- la conversion des dossiers ouverts a eu lieu dans la migration, avant
    -- cette garde.
    IF OLD.statut IS NULL THEN
        RAISE EXCEPTION 'FRAIS-HISTORIQUE : ce frais a ete porte par l''ancien moteur ; il ne se modifie plus.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN
            RAISE EXCEPTION 'FRAIS-FIGE : une fiche validee ne se supprime pas ; corrigez-la par une rectificative.'
                USING ERRCODE = 'check_violation';
        END IF;
        -- Une fiche qui porte une allocation archivee (version 0 de la
        -- migration, ou version validee puis remise en brouillon) garde sa
        -- trace : elle ne se supprime pas. Une fiche neuve, si.
        IF EXISTS (SELECT 1 FROM lignes_frais_repartition
                    WHERE id_ligne_frais = OLD.id_ligne_frais AND version < OLD.version) THEN
            RAISE EXCEPTION 'FRAIS-ARCHIVE : cette fiche porte une allocation archivee (fiche issue de la migration, ou deja validee) ; elle ne se supprime pas.'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.statut IS NULL THEN
        RAISE EXCEPTION 'FRAIS-ETAT : une fiche ne redevient pas un frais de l''ancien moteur.' USING ERRCODE = 'check_violation';
    END IF;

    -- Brouillon : libre, ou validation.
    IF OLD.statut = 'BROUILLON' THEN
        IF NEW.statut = 'BROUILLON' THEN
            RETURN NEW;
        ELSIF NEW.statut = 'VALIDE' THEN
            -- LA DECISION DANS LES LIMITES DU PARAMETRAGE : cle autorisee, motif
            -- si elle s'ecarte de la cle proposee, et la nature du type
            -- recopiee telle qu'elle est au moment de la validation.
            SELECT cles_autorisees, methode_repartition, inclus_dans_cout INTO v_type
              FROM parametres_frais WHERE id_frais = NEW.id_frais;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'FRAIS-CLE : type de frais % introuvable.', NEW.id_frais USING ERRCODE = 'check_violation';
            END IF;
            IF NOT COALESCE(NEW.cle_repartition = ANY (v_type.cles_autorisees), false) THEN
                RAISE EXCEPTION 'FRAIS-CLE : la cle % n''est pas autorisee pour ce type de frais.', NEW.cle_repartition
                    USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.cle_repartition <> v_type.methode_repartition
               AND char_length(btrim(COALESCE(NEW.motif_cle, ''))) < 5 THEN
                RAISE EXCEPTION 'FRAIS-CLE : la cle proposee est %, la cle choisie % ; dites pourquoi (motif).',
                    v_type.methode_repartition, NEW.cle_repartition USING ERRCODE = 'check_violation';
            END IF;
            IF NEW.capitalisable IS DISTINCT FROM v_type.inclus_dans_cout::smallint THEN
                RAISE EXCEPTION 'FRAIS-CAPITALISABLE : la fiche recopie la nature du type a la validation.'
                    USING ERRCODE = 'check_violation';
            END IF;
            -- L'INVARIANT DE L'ALLOCATION, pour la version validee. Le montant
            -- en MAD se recalcule ici : montant_dhs est une colonne calculee,
            -- que PostgreSQL ne remplit qu'APRES les declencheurs BEFORE.
            SELECT COALESCE(sum(montant_alloue_dhs), 0), count(*) INTO v_somme, v_lignes
              FROM lignes_frais_repartition
             WHERE id_ligne_frais = NEW.id_ligne_frais AND version = NEW.version;
            IF NEW.capitalisable = 1 THEN
                -- Capitalisable : l'allocation fait le montant, au centime.
                IF v_somme <> round(NEW.montant_devise * NEW.cours_change, 2) THEN
                    RAISE EXCEPTION 'FRAIS-SOMME : l''allocation fait % MAD pour une fiche de % MAD.',
                        v_somme, round(NEW.montant_devise * NEW.cours_change, 2) USING ERRCODE = 'check_violation';
                END IF;
                -- MANUEL : chaque ligne allouee est exactement le montant saisi
                -- pour elle, et chaque montant saisi a sa ligne allouee.
                IF NEW.cle_repartition = 'MANUEL' AND EXISTS (
                    SELECT 1
                      FROM (SELECT id_article_dossier AS id_ligne, montant_alloue_dhs
                              FROM lignes_frais_repartition
                             WHERE id_ligne_frais = NEW.id_ligne_frais AND version = NEW.version) r
                      FULL JOIN (SELECT id_ligne, montant_saisi
                                   FROM dossier_lignes_frais_cibles
                                  WHERE id_ligne_frais = NEW.id_ligne_frais) c USING (id_ligne)
                     WHERE r.montant_alloue_dhs IS DISTINCT FROM c.montant_saisi) THEN
                    RAISE EXCEPTION 'FRAIS-MANUEL : l''allocation doit reprendre exactement les montants saisis, ligne par ligne.'
                        USING ERRCODE = 'check_violation';
                END IF;
            ELSIF v_lignes > 0 THEN
                -- Non capitalisable (TVA recuperable...) : rien n'entre au
                -- cout, donc rien a repartir.
                RAISE EXCEPTION 'FRAIS-SOMME : un frais non capitalisable n''a pas d''allocation (% ligne(s) trouvee(s)).', v_lignes
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'FRAIS-ETAT : une fiche en brouillon ne passe qu''a VALIDE.' USING ERRCODE = 'check_violation';
    END IF;

    -- Validee ou appliquee : la decision est figee. Seules changent les
    -- colonnes que la transition demandee autorise.
    IF OLD.statut = 'VALIDE' AND NEW.statut = 'BROUILLON' THEN
        SELECT EXISTS (SELECT 1 FROM import_ajustements_cump
                        WHERE id_ligne_frais = OLD.id_ligne_frais AND origine = 'FICHE') INTO v_applique;
        IF v_applique THEN
            RAISE EXCEPTION 'FRAIS-APPLIQUE : une partie de ce frais a deja ete appliquee ; il ne revient plus en brouillon. Corrigez-le par une rectificative.'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.version <> OLD.version + 1 OR NEW.date_brouillon IS NULL
           OR NEW.date_brouillon IS NOT DISTINCT FROM OLD.date_brouillon THEN
            RAISE EXCEPTION 'FRAIS-ETAT : la remise en brouillon ouvre une nouvelle version, avec son motif, son auteur et sa date.'
                USING ERRCODE = 'check_violation';
        END IF;
        v_libres := ARRAY['statut', 'version', 'motif_brouillon', 'id_utilisateur_brouillon', 'date_brouillon',
                          'id_utilisateur_validation', 'date_validation', 'capitalisable', 'montant_dhs'];
    ELSIF OLD.statut IN ('VALIDE', 'APPLIQUE') AND NEW.statut IN ('VALIDE', 'APPLIQUE') THEN
        -- VALIDE <-> APPLIQUE suit le reste a appliquer (une contre-passation
        -- de reception peut le rouvrir) ; seule la date d'application bouge.
        -- montant_dhs (calculee, vide dans un BEFORE) se juge par montant_devise
        -- et cours_change, qui restent compares.
        v_libres := ARRAY['statut', 'date_application', 'montant_dhs'];
    ELSE
        RAISE EXCEPTION 'FRAIS-ETAT : transition % -> % interdite.', OLD.statut, NEW.statut
            USING ERRCODE = 'check_violation';
    END IF;

    IF (to_jsonb(NEW) - v_libres) IS DISTINCT FROM (to_jsonb(OLD) - v_libres) THEN
        RAISE EXCEPTION 'FRAIS-FIGE : une fiche validee ne se modifie pas ; corrigez-la par une rectificative.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_fiche_frais_garde() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_fiche_frais_garde ON dossier_lignes_frais;
CREATE TRIGGER trg_fiche_frais_garde BEFORE INSERT OR UPDATE OR DELETE ON dossier_lignes_frais
    FOR EACH ROW EXECUTE FUNCTION fn_trg_fiche_frais_garde();

-- 8b. L'allocation : ecrite en brouillon, figee ensuite, versions archivees
--     intouchables, signe de la fiche.
CREATE OR REPLACE FUNCTION fn_trg_repartition_garde() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_row    record;
    v_fiche  record;
BEGIN
    IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
    SELECT f.statut, f.version, f.montant_dhs, d.moteur_frais INTO v_fiche
      FROM dossier_lignes_frais f JOIN import_dossiers d ON d.id_dossier = f.id_dossier
     WHERE f.id_ligne_frais = v_row.id_ligne_frais;
    -- Fiche introuvable : suppression EN CASCADE de sa fiche (deja jugee par
    -- fn_trg_fiche_frais_garde, qui refuse une fiche validee ou archivee).
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'FRAIS-ALLOCATION : fiche % introuvable.', v_row.id_ligne_frais USING ERRCODE = 'check_violation';
    END IF;

    -- Un frais de l'ancien moteur : son allocation est une photographie.
    IF v_fiche.statut IS NULL THEN
        RAISE EXCEPTION 'FRAIS-HISTORIQUE : l''allocation d''un frais de l''ancien moteur ne se recalcule pas.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP <> 'INSERT' AND OLD.version <> v_fiche.version THEN
        RAISE EXCEPTION 'FRAIS-ARCHIVE : une version anterieure de l''allocation est archivee ; elle ne se modifie pas.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.version <> v_fiche.version THEN
        RAISE EXCEPTION 'FRAIS-ARCHIVE : l''allocation s''ecrit dans la version en vigueur de la fiche.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_fiche.statut <> 'BROUILLON' THEN
        RAISE EXCEPTION 'FRAIS-FIGE : l''allocation d''une fiche validee est figee.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP <> 'DELETE'
       AND ((v_fiche.montant_dhs > 0 AND NEW.montant_alloue_dhs < 0)
            OR (v_fiche.montant_dhs < 0 AND NEW.montant_alloue_dhs > 0)) THEN
        RAISE EXCEPTION 'FRAIS-SIGNE : une ligne d''allocation a le signe de sa fiche.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_repartition_garde() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_repartition_garde ON lignes_frais_repartition;
CREATE TRIGGER trg_repartition_garde BEFORE INSERT OR UPDATE OR DELETE ON lignes_frais_repartition
    FOR EACH ROW EXECUTE FUNCTION fn_trg_repartition_garde();

-- 8c. Les lignes visees d'une fiche validee ne changent plus.
CREATE OR REPLACE FUNCTION fn_trg_cibles_garde() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_statut text;
BEGIN
    SELECT statut INTO v_statut FROM dossier_lignes_frais
     WHERE id_ligne_frais = COALESCE(NEW.id_ligne_frais, OLD.id_ligne_frais);
    -- Suppression en cascade de la fiche : deja jugee par sa propre garde.
    IF NOT FOUND AND TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF v_statut IS NULL THEN
        RAISE EXCEPTION 'FRAIS-HISTORIQUE : les lignes visees d''un frais de l''ancien moteur ne changent plus.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_statut IN ('VALIDE', 'APPLIQUE') THEN
        RAISE EXCEPTION 'FRAIS-FIGE : les lignes visees d''une fiche validee ne changent plus.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_cibles_garde() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_cibles_garde ON dossier_lignes_frais_cibles;
CREATE TRIGGER trg_cibles_garde BEFORE INSERT OR UPDATE OR DELETE ON dossier_lignes_frais_cibles
    FOR EACH ROW EXECUTE FUNCTION fn_trg_cibles_garde();

-- 8c bis. Une ligne de facture visee par une fiche validee ne change plus sa
--     base : reference, nature, quantite, poids net, prix, remise. Sa
--     suppression est deja refusee (la cascade sur l'allocation figee echoue).
--     Les autres colonnes (kg recus, decision au solde) restent libres.
CREATE OR REPLACE FUNCTION fn_trg_ligne_allouee() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.code_reference, NEW.type_ligne, NEW.quantite, NEW.poids_net_kg,
        NEW.prix_unitaire_devise, NEW.remise_pct)
       IS DISTINCT FROM
       (OLD.code_reference, OLD.type_ligne, OLD.quantite, OLD.poids_net_kg,
        OLD.prix_unitaire_devise, OLD.remise_pct)
       AND EXISTS (SELECT 1
                     FROM lignes_frais_repartition r
                     JOIN dossier_lignes_frais f ON f.id_ligne_frais = r.id_ligne_frais
                                                AND r.version = f.version
                    WHERE r.id_article_dossier = OLD.id_ligne
                      AND f.statut IN ('VALIDE', 'APPLIQUE')) THEN
        RAISE EXCEPTION 'FRAIS-LIGNE : cette ligne porte l''allocation d''une fiche validee ; sa reference, sa quantite, son poids et son prix ne changent plus.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_ligne_allouee() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_ligne_allouee ON import_facture_lignes;
CREATE TRIGGER trg_ligne_allouee BEFORE UPDATE ON import_facture_lignes
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_allouee();

-- 8d. La contre-passation est l'inverse EXACT de son application.
CREATE OR REPLACE FUNCTION fn_trg_iac_contre_passation() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    o import_ajustements_cump%ROWTYPE;
BEGIN
    IF NEW.type_operation IS DISTINCT FROM 'CONTRE_PASSATION' THEN
        RETURN NEW;
    END IF;
    SELECT * INTO o FROM import_ajustements_cump WHERE id_ajustement = NEW.id_ajustement_origine;
    IF o.type_operation IS DISTINCT FROM 'APPLICATION' THEN
        RAISE EXCEPTION 'FRAIS-CONTRE-PASSATION : seule une application se contre-passe.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.montant_dhs <> -o.montant_dhs OR NEW.quantite_kg <> -o.quantite_kg
       OR NEW.nature IS DISTINCT FROM o.nature OR NEW.code_magasin IS DISTINCT FROM o.code_magasin
       OR NEW.id_ligne_frais IS DISTINCT FROM o.id_ligne_frais OR NEW.id_ligne IS DISTINCT FROM o.id_ligne
       OR NEW.id_reception IS DISTINCT FROM o.id_reception OR NEW.id_dossier IS DISTINCT FROM o.id_dossier
       OR NEW.code_reference IS DISTINCT FROM o.code_reference THEN
        RAISE EXCEPTION 'FRAIS-CONTRE-PASSATION : la contre-passation doit etre l''inverse exact de l''application (montant, kg, nature, magasin, fiche, ligne, reception).'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_iac_contre_passation() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_iac_contre_passation ON import_ajustements_cump;
CREATE TRIGGER trg_iac_contre_passation BEFORE INSERT ON import_ajustements_cump
    FOR EACH ROW EXECUTE FUNCTION fn_trg_iac_contre_passation();

-- 8e. Dossier clos : plus d'echappatoire pour recalculer une allocation
--     historique. Seules passent l'insertion d'une fiche post-cloture (motif,
--     drapeau de session, inchangee) et les ecritures des FICHES elles-memes,
--     que leurs propres gardes encadrent.
CREATE OR REPLACE FUNCTION fn_trg_import_verrou() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_row     record;
    v_dossier text;
    v_statut  text;
    v_fiche   text;
BEGIN
    IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

    IF TG_TABLE_NAME IN ('import_factures', 'dossier_lignes_frais') THEN
        v_dossier := v_row.id_dossier;
    ELSIF TG_TABLE_NAME = 'import_facture_lignes' THEN
        SELECT id_dossier INTO v_dossier FROM import_factures WHERE id_facture = v_row.id_facture;
    ELSIF TG_TABLE_NAME IN ('dossier_lignes_frais_cibles', 'lignes_frais_repartition') THEN
        SELECT id_dossier, statut INTO v_dossier, v_fiche FROM dossier_lignes_frais
         WHERE id_ligne_frais = v_row.id_ligne_frais;
    END IF;

    SELECT statut INTO v_statut FROM import_dossiers WHERE id_dossier = v_dossier;
    IF v_statut = 'CLOTURE' THEN
        -- Une fiche post-cloture : son insertion (drapeau + motif, voir
        -- fn_trg_frais_dossier_clos), puis ses lignes visees et son allocation.
        -- IF imbriques : la fonction sert aussi aux factures et a leurs lignes,
        -- qui n'ont pas de colonne statut ; OLD.statut n'est lu que pour une
        -- fiche.
        IF TG_TABLE_NAME = 'dossier_lignes_frais' THEN
            IF TG_OP = 'INSERT' THEN
                IF current_setting('gestionfil.frais_post_cloture', true) = 'on' THEN
                    RETURN NEW;
                END IF;
            ELSIF OLD.statut IS NOT NULL THEN
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                RETURN NEW;
            END IF;
        ELSIF TG_TABLE_NAME IN ('dossier_lignes_frais_cibles', 'lignes_frais_repartition') THEN
            IF v_fiche IS NOT NULL THEN
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                RETURN NEW;
            END IF;
        ELSIF TG_TABLE_NAME = 'import_facture_lignes' AND TG_OP = 'UPDATE' THEN
            -- La decision sur le reste d'une ligne soldee, pour un frais tardif :
            -- ces quatre colonnes seulement, rien de ce que la ligne a facture.
            -- (montant_devise et reste_kg sont calculees : vides dans un BEFORE,
            -- elles se jugent par les colonnes dont elles derivent.)
            IF (to_jsonb(NEW) - ARRAY['traitement_reste_frais', 'motif_traitement_reste',
                                      'id_utilisateur_traitement_reste', 'date_traitement_reste',
                                      'montant_devise', 'reste_kg'])
               = (to_jsonb(OLD) - ARRAY['traitement_reste_frais', 'motif_traitement_reste',
                                        'id_utilisateur_traitement_reste', 'date_traitement_reste',
                                        'montant_devise', 'reste_kg']) THEN
                RETURN NEW;
            END IF;
        END IF;
        RAISE EXCEPTION 'Dossier cloture : ses factures, ses frais et leur repartition sont figes. Un frais tardif s''ajoute en fiche post-cloture, avec motif.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_import_verrou() OWNER TO gestionfil;

-- 8f. Meme regle pour la garde propre aux frais d'un dossier clos : une fiche
--     post-cloture se valide et s'applique ; un frais historique, jamais.
CREATE OR REPLACE FUNCTION fn_trg_frais_dossier_clos() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_statut text;
    v_numero text;
BEGIN
    SELECT statut, numero INTO v_statut, v_numero
      FROM import_dossiers WHERE id_dossier = COALESCE(NEW.id_dossier, OLD.id_dossier);
    IF v_statut = 'CLOTURE' THEN
        IF TG_OP = 'INSERT' AND current_setting('gestionfil.frais_post_cloture', true) = 'on'
           AND NEW.post_cloture = 1 AND length(btrim(COALESCE(NEW.motif_post_cloture, ''))) >= 5 THEN
            RETURN NEW;
        END IF;
        IF TG_OP <> 'INSERT' AND OLD.statut IS NOT NULL THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'IMPORT-CLOS : le dossier % est cloture, ses frais sont figes. Un frais tardif s''ajoute en fiche post-cloture, avec motif.',
            v_numero USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
ALTER FUNCTION fn_trg_frais_dossier_clos() OWNER TO gestionfil;

-- 8g. Un dossier clos ne se rouvre plus (regle 5 du 09/10/2026). La garde
--     admettait encore CLOTURE -> EN_COURS ; aucune route ne s'en sert, et avec
--     des fiches appliquees une reouverture rendrait l'historique ambigu.
CREATE OR REPLACE FUNCTION fn_trg_import_dossier_garde() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN
            RAISE EXCEPTION 'Seul un dossier en brouillon se supprime.' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.statut = 'CLOTURE' THEN
        RAISE EXCEPTION 'Dossier cloture : il ne se modifie plus et ne se rouvre pas. Un frais tardif s''ajoute en fiche post-cloture.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_import_dossier_garde() OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 8h. Les vues lisent l'allocation EN VIGUEUR, pas les versions archivees
-- -----------------------------------------------------------------------------
-- v_import_cout_revient (cout de revient du dossier) et v_cout_revient_reel
-- sommaient toute la table : avec les versions, la version 0 archivee d'un
-- dossier converti aurait ete comptee. En vigueur = la version courante d'un
-- frais historique (statut NULL) ou d'une fiche validee ; un brouillon n'a
-- rien d'alloue tant qu'il n'est pas valide.
CREATE OR REPLACE VIEW v_frais_allocation_en_vigueur AS
SELECT r.id_ligne_frais, r.id_article_dossier, r.pourcentage, r.montant_alloue_dhs,
       r.version, r.base_repartition, r.montant_theorique
  FROM lignes_frais_repartition r
  JOIN dossier_lignes_frais f ON f.id_ligne_frais = r.id_ligne_frais AND f.version = r.version
 WHERE f.statut IS NULL OR f.statut = ANY (ARRAY['VALIDE', 'APPLIQUE']);
ALTER VIEW v_frais_allocation_en_vigueur OWNER TO gestionfil;
COMMENT ON VIEW v_frais_allocation_en_vigueur IS
  'L''allocation qui compte : version courante d''un frais historique ou d''une fiche validee. Les versions archivees et les brouillons n''y sont pas.';

DO $$
DECLARE
    v_vue text;
    v_def text;
BEGIN
    FOREACH v_vue IN ARRAY ARRAY['v_import_cout_revient', 'v_cout_revient_reel'] LOOP
        v_def := pg_get_viewdef(v_vue::regclass);
        IF position('v_frais_allocation_en_vigueur' IN v_def) > 0 THEN
            CONTINUE;                                    -- deja faite (rejeu)
        END IF;
        IF position('lignes_frais_repartition' IN v_def) = 0 THEN
            RAISE EXCEPTION '% : la lecture de lignes_frais_repartition est introuvable, la vue a change', v_vue;
        END IF;
        EXECUTE format('CREATE OR REPLACE VIEW %I AS ', v_vue)
             || rtrim(rtrim(replace(v_def, 'lignes_frais_repartition', 'v_frais_allocation_en_vigueur')), ';');
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 9. Les champs nouveaux, declares (sinon masques pour tous)
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'IMPORT', c.champ, c.libelle, 'LECTURE', c.sensible, 970
  FROM (VALUES ('cle_repartition', 'Clé de répartition', 0),
               ('motif_cle', 'Motif de la clé', 0),
               ('statut_fiche', 'État de la fiche', 0),
               ('base_repartition', 'Base de répartition', 1),
               ('montant_theorique', 'Montant théorique (DH)', 1),
               ('montant_saisi', 'Montant saisi (DH)', 1),
               ('montant_applique_dhs', 'Montant appliqué (DH)', 1),
               ('reste_a_appliquer_dhs', 'Reste à appliquer (DH)', 1),
               ('motif_rectification', 'Motif de la rectification', 0),
               ('traitement_reste_frais', 'Traitement du reste au solde', 0)) c(champ, libelle, sensible)
ON CONFLICT DO NOTHING;

-- Les montants restent masques au magasinier, comme ceux de 2026-10-09x.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'IMPORT', c.champ,
       CASE WHEN r.code_role_user = 'MAGASIN' AND c.sensible = 1 THEN 'MASQUE' ELSE 'LECTURE' END
  FROM (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
 CROSS JOIN (SELECT champ, sensible FROM champ_configurable WHERE module = 'IMPORT' AND ordre = 970) c
ON CONFLICT DO NOTHING;

COMMIT;
