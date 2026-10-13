-- =============================================================================
-- 2026-10-09a — Gardes de la priorite 1 (arbitrages de l'audit v5, 09/10/2026)
-- =============================================================================
-- 1. UNE DATE VIDE EST UNE DATE ABSENTE. La contrainte de format du 08/10
--    (2026-10-08m) refusait la chaine vide qu'envoie un formulaire dont la date
--    est laissee en blanc : un bon de commande sans date de livraison ne se
--    creait plus (regression). Un declencheur, pose sur chaque table qui a une
--    colonne de date, change '' en NULL avant les controles.
-- 2. LE SEUIL DE TOLERANCE DU FOURNISSEUR EST JOURNALISE (U5) : il se fixe
--    desormais au droit VALIDER ; chaque changement de la fiche fournisseur
--    entre au journal d'audit, ancienne et nouvelle valeur.
-- 3. LE MODELE DE DROITS DU MAGASINIER COMPLET (T5) : le montant des lignes de
--    bon (BONS_COMMANDE.total_ligne_mad) n'avait de ligne que pour ADMIN ; un
--    magasinier cree depuis le modele le voyait. Chaque role recoit la ligne
--    manquante ; le controle C46 signale un champ sensible sans modele.
-- 4. UN MOUVEMENT MACHINE NE S'ANNULE QUE PAR SA FICHE (T6). Le chargement est
--    une sortie du magasin ET une entree sur la machine : deux mouvements,
--    deux livres. Contre-passer le seul cote magasin rendrait le fil au
--    magasin en le laissant sur la machine. Le service le refusait deja ; la
--    base le refuse aussi : l'annulation d'un mouvement machine est un
--    ANNUL_* de la meme decision, et seule la derniere decision d'un etage se
--    retire.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Dates vides --------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_date_vide_null() RETURNS trigger AS $$
DECLARE
    j       jsonb := to_jsonb(NEW);
    col     text;
    change  boolean := false;
BEGIN
    FOREACH col IN ARRAY TG_ARGV LOOP
        IF j ? col AND jsonb_typeof(j -> col) = 'string' AND btrim(j ->> col) = '' THEN
            j := jsonb_set(j, ARRAY[col], 'null'::jsonb);
            change := true;
        END IF;
    END LOOP;
    IF change THEN
        NEW := jsonb_populate_record(NEW, j);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_date_vide_null() OWNER TO gestionfil;

DO $$
DECLARE
    t       record;
    poses   int := 0;
BEGIN
    FOR t IN
        SELECT col.table_name AS tbl,
               string_agg(quote_literal(col.column_name), ', ' ORDER BY col.ordinal_position) AS colonnes
          FROM information_schema.columns col
          JOIN information_schema.tables tb USING (table_schema, table_name)
         WHERE col.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND col.data_type = 'text'
           AND col.is_generated = 'NEVER'
           AND (col.column_name LIKE 'date%' OR col.column_name LIKE '%\_le'
                OR col.column_name LIKE 'horodatage%' OR col.column_name LIKE '%jusqu\_a')
         GROUP BY col.table_name
    LOOP
        -- « 00 » : il passe avant les autres declencheurs BEFORE de la table.
        EXECUTE format('DROP TRIGGER IF EXISTS trg_00_date_vide ON %I', t.tbl);
        EXECUTE format('CREATE TRIGGER trg_00_date_vide BEFORE INSERT OR UPDATE ON %I '
                       'FOR EACH ROW EXECUTE FUNCTION fn_trg_date_vide_null(%s)', t.tbl, t.colonnes);
        poses := poses + 1;
    END LOOP;
    RAISE NOTICE 'dates vides changees en NULL sur % tables', poses;
END $$;

-- 2. La fiche fournisseur au journal -----------------------------------------
-- Le seuil se fixe au droit VALIDER du module : la Direction le recoit (seul
-- l'administrateur l'avait), l'assistante garde le droit d'ecrire la fiche.
INSERT INTO permission (code_role_user, module, action, actif)
SELECT 'DIRECTION', 'FOURNISSEURS', 'VALIDER', 1
 WHERE NOT EXISTS (SELECT 1 FROM permission
                    WHERE code_role_user = 'DIRECTION' AND module = 'FOURNISSEURS' AND action = 'VALIDER');
UPDATE permission SET actif = 1
 WHERE code_role_user = 'DIRECTION' AND module = 'FOURNISSEURS' AND action = 'VALIDER' AND actif <> 1;

DROP TRIGGER IF EXISTS trg_audit_modification ON fournisseur;
CREATE TRIGGER trg_audit_modification AFTER UPDATE ON fournisseur
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- 3. Le modele de droits complet ----------------------------------------------
-- Le magasinier ne voit aucun montant ; les autres roles recoivent, pour un
-- champ sensible sans ligne, le niveau qu'ils ont sur le montant total du meme
-- module (a defaut LECTURE).
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN r.code_role_user = 'MAGASIN' THEN 'MASQUE'
            ELSE COALESCE((SELECT m.niveau FROM modele_droit_champ m
                            WHERE m.code_role_user = r.code_role_user AND m.module = c.module
                              AND m.champ = 'montant_total_mad'), 'LECTURE') END
  FROM champ_configurable c
 CROSS JOIN (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
 WHERE c.sensible = 1
   AND NOT EXISTS (SELECT 1 FROM modele_droit_champ m
                    WHERE m.code_role_user = r.code_role_user AND m.module = c.module AND m.champ = c.champ);

-- Et les comptes deja crees depuis le modele, s'ils n'ont pas de ligne propre.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ AND c.sensible = 1
 WHERE m.niveau = 'MASQUE'
   AND NOT EXISTS (SELECT 1 FROM droit_champ d
                    WHERE d.id_utilisateur = u.id_utilisateur AND d.module = m.module AND d.champ = m.champ);

CREATE OR REPLACE VIEW v_ctl_c46 AS
SELECT r.code_role_user, c.module, c.champ
  FROM champ_configurable c
 CROSS JOIN (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
 WHERE c.sensible = 1
   AND NOT EXISTS (SELECT 1 FROM modele_droit_champ m
                    WHERE m.code_role_user = r.code_role_user AND m.module = c.module AND m.champ = c.champ);
ALTER VIEW v_ctl_c46 OWNER TO gestionfil;

-- 4. Un mouvement machine ne s'annule que par sa fiche ------------------------
CREATE OR REPLACE FUNCTION fn_trg_mouvement_machine_annulation() RETURNS trigger AS $$
DECLARE
    o_type      text;
    o_numero    text;
    o_decision  text;
    o_fiche     text;
    attendu     text;
BEGIN
    IF NEW.code_type_mvt IN ('ANNUL_CHARGE_MACHINE', 'ANNUL_RETOUR_MACHINE')
       AND NEW.id_mouvement_contrepasse IS NULL THEN
        RAISE EXCEPTION 'MACHINE-ANNULATION : % annule un mouvement de fiche machine : il doit le designer.',
            NEW.code_type_mvt USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.id_mouvement_contrepasse IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT code_type_mvt, numero_mouvement, id_decision_machine, reference_document
      INTO o_type, o_numero, o_decision, o_fiche
      FROM mouvement WHERE id_mouvement = NEW.id_mouvement_contrepasse;
    IF o_type IN ('ANNUL_CHARGE_MACHINE', 'ANNUL_RETOUR_MACHINE') THEN
        RAISE EXCEPTION 'MACHINE-ANNULATION : % est deja une annulation de fiche machine : on n''annule pas une annulation.',
            o_numero USING ERRCODE = 'check_violation';
    END IF;
    IF o_type NOT IN ('CHARGE_MACHINE', 'RETOUR_MACHINE') THEN
        RETURN NEW;
    END IF;
    attendu := CASE o_type WHEN 'CHARGE_MACHINE' THEN 'ANNUL_CHARGE_MACHINE' ELSE 'ANNUL_RETOUR_MACHINE' END;
    IF NEW.code_type_mvt <> attendu
       OR NEW.id_decision_machine IS DISTINCT FROM o_decision
       OR NOT EXISTS (SELECT 1 FROM machine_decision d
                       WHERE d.id_decision = o_decision AND d.statut = 'ACTIVE' AND d.est_tete = 1) THEN
        RAISE EXCEPTION 'MACHINE-ANNULATION : % vient de la fiche machine % : il ne se defait qu''en annulant ou en devalidant cette fiche, la derniere de son etage, qui ramene aussi l''etage a son etat precedent.',
            o_numero, COALESCE(o_fiche, '?') USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_mouvement_machine_annulation() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_mouvement_machine_annulation ON mouvement;
CREATE TRIGGER trg_mouvement_machine_annulation BEFORE INSERT ON mouvement
FOR EACH ROW EXECUTE FUNCTION fn_trg_mouvement_machine_annulation();

-- Les controles ---------------------------------------------------------------
DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C46' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C46''::text, ''Champ sensible sans ligne dans le modele de droits d''''un role''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c46)';
    END IF;
END $$;

COMMIT;
