-- =============================================================================
-- 2026-10-21b — Le bon de commande passe par un controle et une demande de prix
-- =============================================================================
-- Decision de l'utilisateur du 21/10/2026 (logique SAP : l'offre du fournisseur
-- avant la commande ferme). Le circuit devient :
--
--   BROUILLON → EN_CONTROLE → DEMANDE_PRIX → EN_ATTENTE_VALIDATION → VALIDE
--             → ENVOYE → LIVRE_PARTIEL → CLOTURE        (et ANNULE)
--
--   1. BROUILLON → EN_CONTROLE : l'acheteur envoie son bon au controle.
--   2. EN_CONTROLE : un AUTRE compte que le createur verifie quantites et
--      fournisseur (separation des taches ; l'ADMIN en est dispense, comme pour
--      la validation, decision du 22/09/2026). Il renvoie en brouillon (motif)
--      ou passe en demande de prix. Le bon est fige pendant le controle.
--   3. DEMANDE_PRIX : le document « Demande de prix » part chez le fournisseur ;
--      sa reponse se saisit ligne par ligne. Seuls le PRIX et la REMISE des
--      lignes se modifient ; le prix d'avant (plan, saisie) est garde pour
--      signaler l'ecart. Quantites et references : renvoyer en brouillon.
--   4. La demande de prix se SAUTE (EN_CONTROLE → EN_ATTENTE_VALIDATION) avec un
--      motif obligatoire (prix sous contrat, achat local…), trace sur le bon.
--   5. EN_ATTENTE_VALIDATION → VALIDE : la direction, comme avant. L'ecart entre
--      le prix confirme et le prix d'avant se SIGNALE (C59), il ne bloque pas.
--   6. Les bons existants ne changent pas d'etat. La soumission directe
--      BROUILLON → EN_ATTENTE_VALIDATION disparait.
--   7. Retours : EN_CONTROLE → BROUILLON et DEMANDE_PRIX → BROUILLON (motif),
--      ANNULE depuis les deux nouveaux etats. La devalidation est inchangee.
--
-- Un bon au controle ou en demande de prix N'ENGAGE RIEN : il ne compte ni dans
-- l'en-cours ni dans les quantites attendues (les vues qui listent les etats
-- engages — VALIDE, ENVOYE, LIVRE_PARTIEL — n'ont pas a changer). Il se range
-- avec le brouillon dans le tableau fournisseur, et avec les bons non engages
-- dans la file des receptions a regulariser.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. Les colonnes
-- -----------------------------------------------------------------------------
-- Sur l'en-tete : qui a controle, quand ; quand la demande est partie ; pourquoi
-- elle a ete sautee ; pourquoi le bon a ete renvoye en brouillon (le dernier
-- motif — le journal d'audit les garde tous, voir fn_trg_audit_bc_statut).
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS id_utilisateur_controle text REFERENCES utilisateur(id_utilisateur);
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS date_controle timestamptz;
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS date_demande_prix timestamptz;
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS motif_saut_demande_prix text;
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS motif_renvoi text;
CREATE INDEX IF NOT EXISTS ix_fk_bon_commande_controle ON bon_commande (id_utilisateur_controle);

-- Sur la ligne : le prix et la remise d'AVANT la demande (ceux du plan ou de la
-- saisie), poses a l'entree en demande de prix ; et le moment ou la reponse du
-- fournisseur a ete saisie.
ALTER TABLE ligne_bc ADD COLUMN IF NOT EXISTS prix_unitaire_avant_demande numeric(18,4);
ALTER TABLE ligne_bc ADD COLUMN IF NOT EXISTS remise_pct_avant_demande numeric(5,2);
ALTER TABLE ligne_bc ADD COLUMN IF NOT EXISTS date_reponse_prix timestamptz;

-- -----------------------------------------------------------------------------
-- 2. Les etats permis
-- -----------------------------------------------------------------------------
ALTER TABLE bon_commande DROP CONSTRAINT IF EXISTS bon_commande_statut_check;
ALTER TABLE bon_commande ADD CONSTRAINT bon_commande_statut_check
    CHECK (statut IN ('BROUILLON', 'EN_CONTROLE', 'DEMANDE_PRIX', 'EN_ATTENTE_VALIDATION',
                      'VALIDE', 'ENVOYE', 'LIVRE_PARTIEL', 'CLOTURE', 'ANNULE'));

-- Au-dela des etats non engages, un bon est necessairement valide et trace.
ALTER TABLE bon_commande DROP CONSTRAINT IF EXISTS bon_commande_check1;
ALTER TABLE bon_commande ADD CONSTRAINT bon_commande_check1
    CHECK (statut IN ('BROUILLON', 'EN_CONTROLE', 'DEMANDE_PRIX', 'EN_ATTENTE_VALIDATION', 'ANNULE')
           OR (id_utilisateur_validation IS NOT NULL AND date_validation IS NOT NULL));

-- Un motif se lit : cinq caracteres au moins, comme le motif du taux.
ALTER TABLE bon_commande DROP CONSTRAINT IF EXISTS ck_bc_motif_saut_demande_prix;
ALTER TABLE bon_commande ADD CONSTRAINT ck_bc_motif_saut_demande_prix
    CHECK (motif_saut_demande_prix IS NULL OR length(btrim(motif_saut_demande_prix)) >= 5);

-- -----------------------------------------------------------------------------
-- 3. Les transitions
-- -----------------------------------------------------------------------------
INSERT INTO transition_statut (entite, statut_source, statut_cible, role_requis, description) VALUES
    ('bon_commande', 'BROUILLON',    'EN_CONTROLE',           'ACHAT', 'Envoi au controle'),
    ('bon_commande', 'EN_CONTROLE',  'BROUILLON',             'ACHAT', 'Renvoi pour correction (motif)'),
    ('bon_commande', 'EN_CONTROLE',  'DEMANDE_PRIX',          'ACHAT', 'Controle fait (autre compte que le createur) : demande de prix'),
    ('bon_commande', 'EN_CONTROLE',  'EN_ATTENTE_VALIDATION', 'ACHAT', 'Controle fait, demande de prix sautee (motif)'),
    ('bon_commande', 'EN_CONTROLE',  'ANNULE',                'ACHAT', 'Abandon'),
    ('bon_commande', 'DEMANDE_PRIX', 'EN_ATTENTE_VALIDATION', 'ACHAT', 'Reponse du fournisseur saisie : soumission a validation'),
    ('bon_commande', 'DEMANDE_PRIX', 'BROUILLON',             'ACHAT', 'Renvoi pour correction (motif)'),
    ('bon_commande', 'DEMANDE_PRIX', 'ANNULE',                'ACHAT', 'Abandon')
ON CONFLICT (entite, statut_source, statut_cible)
    DO UPDATE SET role_requis = EXCLUDED.role_requis, description = EXCLUDED.description;

-- La soumission directe disparait : un bon passe par le controle.
DELETE FROM transition_statut
 WHERE entite = 'bon_commande' AND statut_source = 'BROUILLON' AND statut_cible = 'EN_ATTENTE_VALIDATION';

-- -----------------------------------------------------------------------------
-- 4. Les gardes de la base
-- -----------------------------------------------------------------------------
-- La transition : en plus de la table, sortir du controle exige un controleur
-- nomme, et sauter la demande de prix exige son motif.
CREATE OR REPLACE FUNCTION fn_trg_transition_bc() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
       AND NOT EXISTS (SELECT 1 FROM transition_statut
                        WHERE entite = 'bon_commande' AND statut_source = OLD.statut AND statut_cible = NEW.statut)
       -- Le recalage apres contre-passation (fn_recaler_lignes_bc), et lui seul.
       AND NOT (COALESCE(current_setting('gestionfil.recalcul_bc', true), '') = 'on'
                AND OLD.statut IN ('CLOTURE', 'LIVRE_PARTIEL')
                AND NEW.statut IN ('LIVRE_PARTIEL', 'ENVOYE')) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur le bon de commande.';
    END IF;
    IF OLD.statut = 'EN_CONTROLE' AND NEW.statut IN ('DEMANDE_PRIX', 'EN_ATTENTE_VALIDATION')
       AND NEW.id_utilisateur_controle IS NULL THEN
        RAISE EXCEPTION 'BC-CONTROLE : le bon % sort du controle sans controleur nomme.', NEW.numero_bc
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.statut = 'EN_CONTROLE' AND NEW.statut = 'EN_ATTENTE_VALIDATION'
       AND length(btrim(COALESCE(NEW.motif_saut_demande_prix, ''))) < 5 THEN
        RAISE EXCEPTION 'BC-SAUT : sauter la demande de prix du bon % demande un motif (prix sous contrat, achat local…).',
            NEW.numero_bc USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_transition_bc() OWNER TO gestionfil;

-- La separation des taches : celui qui a cree le bon ne le valide pas (B4-4),
-- et ne le controle pas non plus. L'ADMIN est dispense des deux (22/09/2026).
CREATE OR REPLACE FUNCTION fn_trg_bc_separation_taches() RETURNS trigger AS $$
DECLARE
    role_validateur text;
    role_controleur text;
BEGIN
    IF NEW.id_utilisateur_controle IS NOT NULL
       AND NEW.id_utilisateur_controle = NEW.id_utilisateur_creation THEN
        SELECT u.code_role_user INTO role_controleur
          FROM utilisateur u WHERE u.id_utilisateur = NEW.id_utilisateur_controle;
        IF role_controleur IS DISTINCT FROM 'ADMIN' THEN
            RAISE EXCEPTION
                'B4 regle 4 : vous ne pouvez pas controler un bon de commande que vous avez cree. '
                'Un autre compte doit verifier quantites et fournisseur.';
        END IF;
    END IF;

    -- Rien a verifier tant que personne n'a valide.
    IF NEW.id_utilisateur_validation IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.id_utilisateur_validation <> NEW.id_utilisateur_creation THEN
        RETURN NEW;
    END IF;

    SELECT u.code_role_user INTO role_validateur
      FROM utilisateur u
     WHERE u.id_utilisateur = NEW.id_utilisateur_validation;

    IF role_validateur = 'ADMIN' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'B4 regle 4 : vous ne pouvez pas valider un bon de commande que vous avez cree. '
        'Un autre compte habilite doit le valider.';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_bc_separation_taches() OWNER TO gestionfil;

-- Le journal du statut porte desormais le controleur et les motifs : le motif
-- d'un renvoi ou d'un saut est ecrit sur le bon dans le meme UPDATE que le
-- statut, et se retrouve donc ici, a cote du changement qu'il justifie.
CREATE OR REPLACE FUNCTION fn_trg_audit_bc_statut() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('bon_commande', 'UPDATE', NEW.id_bc,
            json_build_object('statut', OLD.statut),
            json_build_object('statut', NEW.statut, 'montant_total_mad', NEW.montant_total_mad,
                              'id_utilisateur_validation', NEW.id_utilisateur_validation,
                              'id_utilisateur_controle', NEW.id_utilisateur_controle,
                              'motif_saut_demande_prix', NEW.motif_saut_demande_prix,
                              'motif_renvoi', NEW.motif_renvoi),
            current_setting('gestionfil.id_utilisateur', true),
            current_setting('gestionfil.adresse_ip', true),
            current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_audit_bc_statut() OWNER TO gestionfil;

-- Les lignes d'un bon au controle sont figees ; en demande de prix, seuls le
-- prix et la remise bougent (et ce qui les accompagne : le prix d'avant, la date
-- de la reponse, le drapeau d'arbitrage). Le reste : renvoyer en brouillon.
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
DROP TRIGGER IF EXISTS trg_ligne_bc_figee ON ligne_bc;
CREATE TRIGGER trg_ligne_bc_figee BEFORE INSERT OR UPDATE OR DELETE ON ligne_bc
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_bc_figee();

-- -----------------------------------------------------------------------------
-- 5. Les vues qui rangent les bons par etat
-- -----------------------------------------------------------------------------
-- En-cours, quantites attendues, risque, retards, bons ouverts du cockpit :
-- elles ne comptent que VALIDE / ENVOYE / LIVRE_PARTIEL — rien a changer.
-- Deux vues comptent les etats NON engages par une liste ; on y ajoute les
-- deux nouveaux (remplacement textuel, qui ne rejoue pas une fois fait).
DO $$
DECLARE
    def text;
BEGIN
    -- Une reception dont le bon n'est pas engage ne se validera pas.
    def := pg_get_viewdef('v_cockpit_files'::regclass);
    IF position('EN_CONTROLE' IN def) = 0 THEN
        def := replace(def,
            'ARRAY[''BROUILLON''::text, ''EN_ATTENTE_VALIDATION''::text, ''VALIDE''::text]',
            'ARRAY[''BROUILLON''::text, ''EN_CONTROLE''::text, ''DEMANDE_PRIX''::text, ''EN_ATTENTE_VALIDATION''::text, ''VALIDE''::text]');
        IF position('EN_CONTROLE' IN def) = 0 THEN
            RAISE EXCEPTION '2026-10-21b : v_cockpit_files n''a pas la forme attendue';
        END IF;
        EXECUTE 'CREATE OR REPLACE VIEW v_cockpit_files AS ' || def;
    END IF;

    -- Le tableau fournisseur ne compte pas les brouillons : ni ceux au controle,
    -- ni ceux en demande de prix.
    def := pg_get_viewdef('v_fournisseur_scorecard'::regclass);
    IF position('EN_CONTROLE' IN def) = 0 THEN
        def := replace(def,
            'ARRAY[''BROUILLON''::text, ''ANNULE''::text]',
            'ARRAY[''BROUILLON''::text, ''EN_CONTROLE''::text, ''DEMANDE_PRIX''::text, ''ANNULE''::text]');
        IF position('EN_CONTROLE' IN def) = 0 THEN
            RAISE EXCEPTION '2026-10-21b : v_fournisseur_scorecard n''a pas la forme attendue';
        END IF;
        EXECUTE 'CREATE OR REPLACE VIEW v_fournisseur_scorecard AS ' || def;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. C59 : le prix confirme par le fournisseur s'ecarte du prix d'avant
-- -----------------------------------------------------------------------------
-- Un SIGNAL, jamais un refus : la direction le lit avant de valider. Le prix
-- compare est le prix NET (remise deduite), celui qui valorisera l'entree.
CREATE OR REPLACE VIEW v_ctl_c59 AS
SELECT b.numero_bc, b.code_fournisseur, b.code_devise, lb.ligne_numero,
       COALESCE(lb.code_reference, lb.libelle) AS article,
       lb.prix_unitaire_avant_demande AS prix_avant,
       lb.remise_pct_avant_demande    AS remise_avant,
       lb.prix_unitaire_devise        AS prix_confirme,
       lb.remise_pct                  AS remise_confirmee,
       round(100.0 * (lb.prix_unitaire_devise * (1 - lb.remise_pct / 100.0)
                      - lb.prix_unitaire_avant_demande * (1 - COALESCE(lb.remise_pct_avant_demande, 0) / 100.0))
             / NULLIF(lb.prix_unitaire_avant_demande * (1 - COALESCE(lb.remise_pct_avant_demande, 0) / 100.0), 0), 2)
           AS ecart_pct
  FROM ligne_bc lb
  JOIN bon_commande b ON b.id_bc = lb.id_bc
 WHERE b.statut = 'EN_ATTENTE_VALIDATION'
   AND lb.statut <> 'ANNULE'
   AND lb.prix_unitaire_avant_demande IS NOT NULL
   AND abs(lb.prix_unitaire_devise * (1 - lb.remise_pct / 100.0)
           - lb.prix_unitaire_avant_demande * (1 - COALESCE(lb.remise_pct_avant_demande, 0) / 100.0)) > 0.00005;
ALTER VIEW v_ctl_c59 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C59' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C59''::text, ''Prix confirme par le fournisseur different du prix d''''avant la demande''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c59)';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Le prix d'avant se masque comme le prix
-- -----------------------------------------------------------------------------
-- Un compte qui ne lit pas le prix d'une ligne ne doit pas le lire par la
-- bande : le champ reprend, role par role et compte par compte, le niveau du
-- prix unitaire.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT module, 'prix_unitaire_avant_demande', 'Prix avant la demande de prix', niveau_defaut, 1, 141
  FROM champ_configurable WHERE module = 'BONS_COMMANDE' AND champ = 'prix_unitaire_devise'
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, 'prix_unitaire_avant_demande', m.niveau
  FROM modele_droit_champ m
 WHERE m.module = 'BONS_COMMANDE' AND m.champ = 'prix_unitaire_devise'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, origine)
SELECT d.id_utilisateur, d.module, 'prix_unitaire_avant_demande', d.niveau, d.origine
  FROM droit_champ d
 WHERE d.module = 'BONS_COMMANDE' AND d.champ = 'prix_unitaire_devise'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Temoin
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'ligne_bc' AND column_name = 'prix_unitaire_avant_demande')
       OR NOT EXISTS (SELECT 1 FROM transition_statut
                       WHERE entite = 'bon_commande' AND statut_source = 'EN_CONTROLE' AND statut_cible = 'DEMANDE_PRIX')
       OR EXISTS (SELECT 1 FROM transition_statut
                   WHERE entite = 'bon_commande' AND statut_source = 'BROUILLON' AND statut_cible = 'EN_ATTENTE_VALIDATION')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_bc_figee')
       OR position('C59' IN pg_get_viewdef('v_controles'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-10-21b : migration incomplete';
    END IF;
END $$;

COMMIT;
