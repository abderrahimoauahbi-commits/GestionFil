-- =============================================================================
-- 2026-10-12b — Le retour fournisseur, document LIBRE sur sa propre page
-- =============================================================================
-- Decisions du 12/10/2026 : le retour fournisseur est un retour libre, comme
-- l'avoir d'une gestion commerciale. On rend ce qui est en stock, sans savoir
-- forcement de quelle reception il vient (local ou import, c'est un retour) :
--   * en-tete : le fournisseur, la date, le motif ; lignes : reference,
--     magasin, lot s'il y en a, quantite, PRIX saisi par les achats (propose au
--     CMUP du magasin) ; le montant de l'avoir = somme quantite x prix ;
--   * BROUILLON, puis VALIDE par UN AUTRE COMPTE que celui qui l'a saisi ;
--   * la validation produit le mouvement RETOUR_FOURN (un par magasin) : le
--     stock et les lots baissent ; la sortie se fait AU PRIX DU RETOUR, le CMUP
--     du stock restant est recalcule — jamais sous zero, la part qu'il ne peut
--     pas porter va au journal des ecarts (v_ecart_prix, circuit RETOUR) ;
--   * il ne rouvre pas le reste a livrer du bon de commande.
-- Valide, il ne se modifie plus et son mouvement ne se contre-passe pas.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS retour_fournisseur (
    id_retour                 text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    numero                    text NOT NULL UNIQUE,
    statut                    text NOT NULL DEFAULT 'BROUILLON',
    date_retour               text NOT NULL,
    code_fournisseur          text NOT NULL REFERENCES fournisseur(code_fournisseur),
    motif                     text NOT NULL,
    observations              text,
    id_utilisateur_creation   text NOT NULL REFERENCES utilisateur(id_utilisateur),
    date_creation             text NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur_validation text REFERENCES utilisateur(id_utilisateur),
    date_validation           text,
    CONSTRAINT ck_rfo_statut CHECK (statut = ANY (ARRAY['BROUILLON', 'VALIDE'])),
    CONSTRAINT ck_rfo_motif CHECK (char_length(btrim(motif)) >= 3),
    CONSTRAINT ck_rfo_validation CHECK (statut = 'BROUILLON'
        OR (id_utilisateur_validation IS NOT NULL AND date_validation IS NOT NULL)),
    CONSTRAINT ck_date_retour_fournisseur_date_retour CHECK (date_retour ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$'),
    CONSTRAINT ck_date_retour_fournisseur_date_validation CHECK (date_validation IS NULL OR date_validation ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$')
);
ALTER TABLE retour_fournisseur OWNER TO gestionfil;
COMMENT ON TABLE retour_fournisseur IS
  'Retour fournisseur libre (avoir) : fournisseur, references en stock, quantite et prix. BROUILLON puis VALIDE par un autre compte ; la validation produit le mouvement RETOUR_FOURN.';
CREATE INDEX IF NOT EXISTS ix_fk_rfo_fournisseur ON retour_fournisseur (code_fournisseur);
CREATE INDEX IF NOT EXISTS ix_fk_rfo_creation ON retour_fournisseur (id_utilisateur_creation);
CREATE INDEX IF NOT EXISTS ix_fk_rfo_validation ON retour_fournisseur (id_utilisateur_validation);

CREATE TABLE IF NOT EXISTS ligne_retour_fournisseur (
    id_ligne_retour  text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
    id_retour        text NOT NULL REFERENCES retour_fournisseur(id_retour) ON DELETE CASCADE,
    ligne_numero     integer NOT NULL,
    code_reference   text NOT NULL REFERENCES reference(code_reference),
    code_magasin     text NOT NULL REFERENCES magasin(code_magasin),
    lot_fournisseur  text,
    quantite_kg      numeric(18,4) NOT NULL,
    prix_kg_mad      numeric(18,4) NOT NULL,
    nb_bobines       bigint,
    code_motif_ligne text NOT NULL REFERENCES motif_ligne(code_motif_ligne),
    -- Poses a la validation : le mouvement, et ce que le prix du retour a fait
    -- au CMUP du magasin (la part portee par le stock restant, l'ecart).
    id_mouvement     text REFERENCES mouvement(id_mouvement),
    cmup_avant       numeric(18,4),
    cmup_apres       numeric(18,4),
    au_stock_mad     numeric(18,2),
    ecart_mad        numeric(18,2),
    CONSTRAINT ck_lrfo_quantite CHECK (quantite_kg > 0),
    CONSTRAINT ck_lrfo_prix CHECK (prix_kg_mad >= 0),
    CONSTRAINT ck_lrfo_bobines CHECK (nb_bobines IS NULL OR nb_bobines >= 0),
    CONSTRAINT ck_lrfo_cmup CHECK (cmup_apres IS NULL OR cmup_apres >= 0),
    CONSTRAINT ux_lrfo_numero UNIQUE (id_retour, ligne_numero)
);
ALTER TABLE ligne_retour_fournisseur OWNER TO gestionfil;
COMMENT ON TABLE ligne_retour_fournisseur IS
  'Une ligne rendue : reference, magasin, lot, quantite, prix du retour. id_mouvement est le RETOUR_FOURN cree a la validation ; cmup_avant/apres, au_stock_mad et ecart_mad tracent la correction du CMUP.';
CREATE INDEX IF NOT EXISTS ix_fk_lrfo_retour ON ligne_retour_fournisseur (id_retour);
CREATE INDEX IF NOT EXISTS ix_fk_lrfo_reference ON ligne_retour_fournisseur (code_reference);
CREATE INDEX IF NOT EXISTS ix_fk_lrfo_magasin ON ligne_retour_fournisseur (code_magasin);
CREATE INDEX IF NOT EXISTS ix_fk_lrfo_motif ON ligne_retour_fournisseur (code_motif_ligne);
CREATE INDEX IF NOT EXISTS ix_fk_lrfo_mouvement ON ligne_retour_fournisseur (id_mouvement);

-- -----------------------------------------------------------------------------
-- Les gardes : separation des taches, document valide fige
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_retour_fournisseur_garde() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.statut <> 'BROUILLON' THEN
            RAISE EXCEPTION 'RFO-ETAT : un retour fournisseur nait en brouillon.' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.statut = 'VALIDE' THEN
        RAISE EXCEPTION 'RFO-FIGE : le retour % est valide ; il ne se modifie ni ne se supprime.',
            OLD.numero USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.statut = 'VALIDE'
       AND NEW.id_utilisateur_validation IS NOT DISTINCT FROM OLD.id_utilisateur_creation THEN
        RAISE EXCEPTION 'RFO-SEPARATION : celui qui a saisi le retour % ne peut pas le valider.', OLD.numero
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_retour_fournisseur_garde() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_retour_fournisseur_garde ON retour_fournisseur;
CREATE TRIGGER trg_retour_fournisseur_garde BEFORE INSERT OR UPDATE OR DELETE ON retour_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_retour_fournisseur_garde();

-- Les lignes suivent leur document : figees une fois valide. (La validation
-- ecrit leurs champs de trace AVANT de passer l'en-tete a VALIDE.)
CREATE OR REPLACE FUNCTION fn_trg_ligne_retour_garde() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_statut text;
    v_numero text;
BEGIN
    SELECT statut, numero INTO v_statut, v_numero FROM retour_fournisseur
     WHERE id_retour = COALESCE(NEW.id_retour, OLD.id_retour);
    IF NOT FOUND AND TG_OP = 'DELETE' THEN
        RETURN OLD;                      -- suppression en cascade d'un brouillon
    END IF;
    IF v_statut = 'VALIDE' THEN
        RAISE EXCEPTION 'RFO-FIGE : les lignes du retour % valide ne changent plus.', v_numero
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_ligne_retour_garde() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_ligne_retour_garde ON ligne_retour_fournisseur;
CREATE TRIGGER trg_ligne_retour_garde BEFORE INSERT OR UPDATE OR DELETE ON ligne_retour_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_retour_garde();

-- Valide, un retour est definitif : le mouvement qu'il a produit ne se
-- contre-passe pas (la correction du CMUP au prix du retour resterait seule).
CREATE OR REPLACE FUNCTION fn_trg_retour_non_contrepasse() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    v_numero text;
BEGIN
    IF NEW.id_mouvement_contrepasse IS NOT NULL THEN
        SELECT r.numero INTO v_numero
          FROM ligne_retour_fournisseur l JOIN retour_fournisseur r ON r.id_retour = l.id_retour
         WHERE l.id_mouvement = NEW.id_mouvement_contrepasse
         LIMIT 1;
        IF v_numero IS NOT NULL THEN
            RAISE EXCEPTION 'RFO-DEFINITIF : ce mouvement vient du retour fournisseur % valide ; il ne se contre-passe pas.',
                v_numero USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_retour_non_contrepasse() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_retour_non_contrepasse ON mouvement;
CREATE TRIGGER trg_retour_non_contrepasse BEFORE INSERT ON mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_retour_non_contrepasse();

-- -----------------------------------------------------------------------------
-- L'audit
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_modification ON retour_fournisseur;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON retour_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();
DROP TRIGGER IF EXISTS trg_audit_modification ON ligne_retour_fournisseur;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON ligne_retour_fournisseur
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- -----------------------------------------------------------------------------
-- Le journal des ecarts : la part du prix d'un retour que le stock restant ne
-- peut pas porter (tout rendu, ou valeur restante sous zero).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ecart_prix AS
SELECT 'LOCAL'::text AS circuit, a.id_ajustement, substr(a.date_ajustement, 1, 10) AS date_ecart,
       r.numero_reception AS document, r.id_reception AS id_document,
       r.code_fournisseur, f.nom AS fournisseur_nom, a.code_reference, ref.designation,
       a.origine, a.numero_piece, a.motif, a.quantite_recue_kg, round(a.montant_mad, 2) AS montant_mad
  FROM reception_ajustements_cmup a
  JOIN reception r ON r.id_reception = a.id_reception
  LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
  LEFT JOIN reference ref ON ref.code_reference = a.code_reference
 WHERE a.nature = 'ECART_PRIX' AND a.montant_mad <> 0
UNION ALL
SELECT 'IMPORT', a.id_ajustement, substr(a.date_ajustement, 1, 10),
       d.numero, d.id_dossier,
       ref.code_fournisseur, f.nom, a.code_reference, ref.designation,
       a.origine, a.numero_piece, a.motif, a.quantite_recue_kg, round(a.montant_dhs, 2)
  FROM import_ajustements_cump a
  JOIN import_dossiers d ON d.id_dossier = a.id_dossier
  LEFT JOIN reference ref ON ref.code_reference = a.code_reference
  LEFT JOIN fournisseur f ON f.code_fournisseur = ref.code_fournisseur
 WHERE a.nature = 'CONSOMME' AND a.montant_dhs <> 0
UNION ALL
SELECT 'RETOUR', l.id_ligne_retour, substr(r.date_retour, 1, 10),
       r.numero, r.id_retour,
       r.code_fournisseur, f.nom, l.code_reference, ref.designation,
       'RETOUR'::text, NULL::text, r.motif, l.quantite_kg, round(l.ecart_mad, 2)
  FROM ligne_retour_fournisseur l
  JOIN retour_fournisseur r ON r.id_retour = l.id_retour
  LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
  LEFT JOIN reference ref ON ref.code_reference = l.code_reference
 WHERE r.statut = 'VALIDE' AND l.ecart_mad <> 0;
ALTER VIEW v_ecart_prix OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- Les champs de la page, declares (module RECEPTIONS). Les prix et montants
-- sont masques au magasinier, comme les montants d'achat.
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'RECEPTIONS', c.champ, c.libelle, 'LECTURE', c.sensible, 980
  FROM (VALUES ('numero_retour', 'N° de retour', 0),
               ('statut_retour', 'État du retour', 0),
               ('date_retour', 'Date du retour', 0),
               ('fournisseur_nom', 'Fournisseur', 0),
               ('quantite_totale_kg', 'Kilos rendus', 0),
               ('nb_lignes', 'Lignes', 0),
               ('montant_avoir_mad', 'Montant de l''avoir (DH)', 1),
               ('prix_kg_mad', 'Prix du retour (DH/kg)', 1),
               ('montant_ligne_mad', 'Montant de la ligne (DH)', 1),
               ('cmup_avant', 'CMUP avant (DH/kg)', 1),
               ('cmup_apres', 'CMUP après (DH/kg)', 1),
               ('ecart_mad', 'Écart (DH)', 1)) c(champ, libelle, sensible)
ON CONFLICT DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'RECEPTIONS', c.champ,
       CASE WHEN r.code_role_user = 'MAGASIN' AND c.sensible = 1 THEN 'MASQUE' ELSE 'LECTURE' END
  FROM (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
 CROSS JOIN (SELECT champ, sensible FROM champ_configurable WHERE module = 'RECEPTIONS' AND ordre = 980) c
ON CONFLICT DO NOTHING;
-- Et les comptes deja crees depuis le modele (comme 2026-10-09a) : sans leur
-- ligne propre, un champ sensible nouveau leur serait lisible.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ AND c.sensible = 1
 WHERE m.niveau = 'MASQUE' AND c.module = 'RECEPTIONS' AND c.ordre = 980
   AND NOT EXISTS (SELECT 1 FROM droit_champ d
                    WHERE d.id_utilisateur = u.id_utilisateur AND d.module = m.module AND d.champ = m.champ);

COMMIT;
