-- =============================================================================
-- 2026-10-21d — Bon fige en attente de validation, une ligne par reference,
--               tuiles d'accueil du circuit, une ligne de reception par lot
-- =============================================================================
-- Decisions de l'utilisateur du 21/10/2026 :
--
--   A. UN BON EN ATTENTE DE VALIDATION EST FIGE, comme au controle : ni son
--      en-tete ni ses lignes ne bougent (quantites, references, prix, ajout ou
--      retrait de ligne). Restent permis : le renvoi en brouillon (motif, qui
--      efface le controle), l'annulation, et ce que la VALIDATION elle-meme
--      ecrit (taux engage et sa justification, montants recalcules a ce taux,
--      valideur et date). Les bons deja dans cet etat deviennent figes : voulu.
--
--   B. Deux tuiles d'accueil : « Bons au controle » (EN_CONTROLE) et
--      « Demandes de prix en attente » (DEMANDE_PRIX). Deux compteurs de plus
--      dans v_cockpit_files, declares comme les autres compteurs de bons.
--
--   C. UNE SEULE LIGNE DE MARCHANDISE PAR REFERENCE SUR UN BON. Ajouter une
--      reference deja presente augmente la ligne existante (le serveur le fait) ;
--      la base refuse une SECONDE ligne active de la meme reference pour les
--      NOUVELLES ecritures. Les doublons deja en base ne bloquent rien : ils se
--      SIGNALENT (C60). Les lignes ANNULE ou SOLDE ne comptent pas.
--
--   D. UNE LIGNE DE RECEPTION PAR REFERENCE ET PAR LOT. La meme reference, sur
--      la meme ligne de bon, du meme lot fournisseur, saisie deux fois se
--      fusionne (le serveur additionne) ; deux lots restent deux lignes. La base
--      refuse le doublon nouveau. Les regles de quantite (R-REC, C58) ne
--      changent pas.
--
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- A. Les lignes d'un bon en attente de validation sont figees
-- -----------------------------------------------------------------------------
-- Au controle et en attente de validation : rien ne bouge. En demande de prix :
-- seuls le prix et la remise (21b, inchange).
CREATE OR REPLACE FUNCTION fn_trg_ligne_bc_figee() RETURNS trigger AS $$
DECLARE
    v_statut  text;
    v_numero  text;
    v_change  boolean;
    v_permis  text[] := ARRAY['prix_unitaire_devise', 'remise_pct', 'prix_unitaire_avant_demande',
                              'remise_pct_avant_demande', 'date_reponse_prix', 'arbitree',
                              -- colonnes calculees : vides dans NEW avant l'ecriture
                              'prix_kg_devise', 'total_ligne_devise', 'quantite_restante_kg'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT b.statut, b.numero_bc INTO v_statut, v_numero FROM bon_commande b WHERE b.id_bc = OLD.id_bc;
    ELSE
        SELECT b.statut, b.numero_bc INTO v_statut, v_numero FROM bon_commande b WHERE b.id_bc = NEW.id_bc;
    END IF;
    IF v_statut = 'EN_CONTROLE' THEN
        RAISE EXCEPTION 'BC-FIGE : le bon % est au controle : ses lignes ne se modifient pas. Renvoyez-le en brouillon pour les corriger.',
            v_numero USING ERRCODE = 'check_violation';
    END IF;
    IF v_statut = 'EN_ATTENTE_VALIDATION' THEN
        RAISE EXCEPTION 'BC-FIGE : le bon % attend sa validation : ses lignes ne se modifient pas. Renvoyez-le en brouillon pour les corriger.',
            v_numero USING ERRCODE = 'check_violation';
    END IF;
    IF v_statut = 'DEMANDE_PRIX' AND TG_OP = 'UPDATE' THEN
        v_change := (to_jsonb(NEW) - v_permis) IS DISTINCT FROM (to_jsonb(OLD) - v_permis);
    ELSE
        v_change := true;
    END IF;
    IF v_statut = 'DEMANDE_PRIX' AND v_change THEN
        RAISE EXCEPTION 'BC-DEMANDE-PRIX : le bon % est en demande de prix : seuls le prix et la remise des lignes se modifient. Pour les quantites ou les references, renvoyez-le en brouillon.',
            v_numero USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_bc_figee() OWNER TO gestionfil;

-- L'en-tete d'un bon en attente de validation. Ce qui peut encore changer :
-- le statut (renvoi, annulation, validation) et ce que chacun de ces pas ecrit ;
-- la version (trg_aa_version) ; le taux engage, sa justification et les montants
-- qu'il recalcule — c'est la validation qui les pose, avant le statut, dans la
-- meme transaction.
CREATE OR REPLACE FUNCTION fn_trg_bc_entete_figee() RETURNS trigger AS $$
DECLARE
    v_permis text[] := ARRAY['statut', 'version',
                             -- la validation
                             'taux_change_engage', 'date_taux_engage', 'date_cours_engage',
                             'source_taux_engage', 'motif_taux_engage',
                             'montant_total_devise', 'montant_total_mad',
                             'id_utilisateur_validation', 'date_validation',
                             -- le renvoi en brouillon
                             'motif_renvoi', 'id_utilisateur_controle', 'date_controle',
                             'motif_saut_demande_prix'];
BEGIN
    IF OLD.statut = 'EN_ATTENTE_VALIDATION'
       AND (to_jsonb(NEW) - v_permis) IS DISTINCT FROM (to_jsonb(OLD) - v_permis) THEN
        RAISE EXCEPTION 'BC-FIGE : le bon % attend sa validation : il ne se modifie plus. Renvoyez-le en brouillon pour le corriger.',
            OLD.numero_bc USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_bc_entete_figee() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_bc_entete_figee ON bon_commande;
CREATE TRIGGER trg_bc_entete_figee BEFORE UPDATE ON bon_commande
    FOR EACH ROW EXECUTE FUNCTION fn_trg_bc_entete_figee();

-- -----------------------------------------------------------------------------
-- C. Une ligne de marchandise active par reference et par bon
-- -----------------------------------------------------------------------------
-- Seulement a l'insertion et quand la reference (ou le bon, ou la nature) d'une
-- ligne change : une ligne SOLDE qui redevient PARTIELLE apres une
-- contre-passation (fn_recaler_lignes_bc) ne doit pas faire echouer celle-ci.
CREATE OR REPLACE FUNCTION fn_trg_ligne_bc_une_par_reference() RETURNS trigger AS $$
DECLARE
    v_ligne  bigint;
    v_numero text;
BEGIN
    IF NEW.type_ligne <> 'MARCHANDISE' OR NEW.code_reference IS NULL
       OR NEW.statut IN ('ANNULE', 'SOLDE') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.code_reference IS NOT DISTINCT FROM NEW.code_reference
       AND OLD.id_bc = NEW.id_bc AND OLD.type_ligne = NEW.type_ligne THEN
        RETURN NEW;
    END IF;
    SELECT l.ligne_numero, b.numero_bc INTO v_ligne, v_numero
      FROM ligne_bc l JOIN bon_commande b ON b.id_bc = l.id_bc
     WHERE l.id_bc = NEW.id_bc
       AND l.code_reference = NEW.code_reference
       AND l.type_ligne = 'MARCHANDISE'
       AND l.statut NOT IN ('ANNULE', 'SOLDE')
       AND l.id_ligne_bc <> NEW.id_ligne_bc
     ORDER BY l.ligne_numero
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'BC-UNE-LIGNE : la reference % est deja sur la ligne % du bon % : augmentez la quantite de cette ligne plutot que d''en ajouter une seconde.',
            NEW.code_reference, v_ligne, v_numero USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_bc_une_par_reference() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_ligne_bc_une_par_reference ON ligne_bc;
CREATE TRIGGER trg_ligne_bc_une_par_reference
    BEFORE INSERT OR UPDATE OF code_reference, id_bc, type_ligne ON ligne_bc
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_bc_une_par_reference();

-- C60 : les doublons d'avant la regle. Un SIGNAL : l'acheteur les fond (ou les
-- laisse se solder) ; rien n'est bloque.
CREATE OR REPLACE VIEW v_ctl_c60 AS
SELECT b.numero_bc, b.statut AS statut_bc, b.code_fournisseur, lb.code_reference,
       count(*)                                                        AS nb_lignes,
       string_agg(lb.ligne_numero::text, ', ' ORDER BY lb.ligne_numero) AS lignes,
       round(sum(lb.quantite_commandee_kg), 4)                         AS quantite_kg
  FROM ligne_bc lb
  JOIN bon_commande b ON b.id_bc = lb.id_bc
 WHERE lb.type_ligne = 'MARCHANDISE'
   AND lb.code_reference IS NOT NULL
   AND lb.statut NOT IN ('ANNULE', 'SOLDE')
   AND b.statut <> 'ANNULE'
 GROUP BY b.id_bc, b.numero_bc, b.statut, b.code_fournisseur, lb.code_reference
HAVING count(*) > 1;
ALTER VIEW v_ctl_c60 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C60' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C60''::text, ''Meme reference sur plusieurs lignes actives d''''un bon de commande''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c60)';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- D. Une ligne de reception par ligne de bon, reference et lot
-- -----------------------------------------------------------------------------
-- Le lot vide est un lot comme un autre : deux pesees sans lot de la meme
-- reference sur la meme ligne de bon font une seule ligne.
CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_un_lot() RETURNS trigger AS $$
DECLARE
    v_ligne bigint;
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.id_reception = NEW.id_reception
       AND OLD.id_ligne_bc IS NOT DISTINCT FROM NEW.id_ligne_bc
       AND OLD.code_reference = NEW.code_reference
       AND COALESCE(btrim(OLD.lot_fournisseur), '') = COALESCE(btrim(NEW.lot_fournisseur), '') THEN
        RETURN NEW;
    END IF;
    SELECT l.ligne_numero INTO v_ligne
      FROM ligne_reception l
     WHERE l.id_reception = NEW.id_reception
       AND l.id_ligne_bc IS NOT DISTINCT FROM NEW.id_ligne_bc
       AND l.code_reference = NEW.code_reference
       AND COALESCE(btrim(l.lot_fournisseur), '') = COALESCE(btrim(NEW.lot_fournisseur), '')
       AND l.id_ligne_reception <> NEW.id_ligne_reception
     ORDER BY l.ligne_numero
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'REC-UNE-LIGNE : % (lot %) est deja pese sur la ligne % de cette reception : ajoutez la quantite a cette ligne. Un autre lot fait une autre ligne.',
            NEW.code_reference, COALESCE(NULLIF(btrim(NEW.lot_fournisseur), ''), 'sans numero'), v_ligne
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_reception_un_lot() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_ligne_reception_un_lot ON ligne_reception;
CREATE TRIGGER trg_ligne_reception_un_lot
    BEFORE INSERT OR UPDATE OF id_reception, id_ligne_bc, code_reference, lot_fournisseur ON ligne_reception
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_reception_un_lot();

-- -----------------------------------------------------------------------------
-- B. Les deux files du circuit au tableau de bord
-- -----------------------------------------------------------------------------
-- Deux colonnes AJOUTEES A LA FIN (CREATE OR REPLACE VIEW n'accepte que cela).
DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_cockpit_files'::regclass);
    IF position('nb_bc_au_controle' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_cockpit_files AS ' || def ||
                ', (SELECT count(*) FROM bon_commande WHERE statut = ''EN_CONTROLE'') AS nb_bc_au_controle'
                ', (SELECT count(*) FROM bon_commande WHERE statut = ''DEMANDE_PRIX'') AS nb_bc_demande_prix';
    END IF;
END $$;

-- Declares comme les autres compteurs de bons (un champ non declare est masque),
-- et lus par les memes roles et comptes que « Bons a valider ».
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
    ('COCKPIT', 'nb_bc_au_controle',  'Bons au controle',             'LECTURE', 0, 165),
    ('COCKPIT', 'nb_bc_demande_prix', 'Demandes de prix en attente',  'LECTURE', 0, 166)
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN (VALUES ('nb_bc_au_controle'), ('nb_bc_demande_prix')) c(champ)
 WHERE m.module = 'COCKPIT' AND m.champ = 'nb_bc_a_valider'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, origine)
SELECT d.id_utilisateur, d.module, c.champ, d.niveau, d.origine
  FROM droit_champ d
 CROSS JOIN (VALUES ('nb_bc_au_controle'), ('nb_bc_demande_prix')) c(champ)
 WHERE d.module = 'COCKPIT' AND d.champ = 'nb_bc_a_valider'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Temoin
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bc_entete_figee')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_bc_une_par_reference')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_reception_un_lot')
       OR position('EN_ATTENTE_VALIDATION' IN pg_get_functiondef('fn_trg_ligne_bc_figee'::regproc)) = 0
       OR position('C60' IN pg_get_viewdef('v_controles'::regclass)) = 0
       OR position('nb_bc_demande_prix' IN pg_get_viewdef('v_cockpit_files'::regclass)) = 0
       OR NOT EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'COCKPIT' AND champ = 'nb_bc_au_controle') THEN
        RAISE EXCEPTION '2026-10-21d : migration incomplete';
    END IF;
END $$;

COMMIT;

SELECT count(*) AS controles FROM v_controles;
