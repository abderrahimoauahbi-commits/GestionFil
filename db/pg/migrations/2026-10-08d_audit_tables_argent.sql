-- =============================================================================
-- 2026-10-08d — L'audit des tables d'argent (audit v4, P2 action 11)
-- =============================================================================
-- Le journal d'audit voyait les statuts et les suppressions, pas les montants :
-- un prix de ligne de bon, une facture d'import, des frais, le montant d'une
-- facture de reception, une pesee d'import reecrite au controle, une
-- proposition d'achat effacee a l'annulation d'un bon changeaient sans trace.
--
-- Un declencheur generique : a la MODIFICATION, il n'inscrit que les colonnes
-- qui changent (anciennes et nouvelles valeurs) ; a la creation, la ligne ; a
-- la suppression, la ligne (la ou trg_audit_suppression ne le fait pas deja).
-- Les arguments du declencheur nomment les colonnes a ignorer (horodatages
-- techniques, statut deja journalise par son propre declencheur).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_audit_modification() RETURNS trigger AS $$
DECLARE
    v_ancien  jsonb;
    v_nouveau jsonb;
    v_cle     text;
    v_ignore  text[] := ARRAY['date_modification', 'date_maj', 'date_derniere_modif'] || TG_ARGV;
    v_col     text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_ancien := '{}'::jsonb;
        v_nouveau := '{}'::jsonb;
        FOR v_col IN SELECT key FROM jsonb_each(to_jsonb(NEW)) LOOP
            CONTINUE WHEN v_col = ANY (v_ignore);
            IF to_jsonb(OLD) -> v_col IS DISTINCT FROM to_jsonb(NEW) -> v_col THEN
                v_ancien := v_ancien || jsonb_build_object(v_col, to_jsonb(OLD) -> v_col);
                v_nouveau := v_nouveau || jsonb_build_object(v_col, to_jsonb(NEW) -> v_col);
            END IF;
        END LOOP;
        IF v_nouveau = '{}'::jsonb THEN
            RETURN NEW;    -- rien qui compte n'a change
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        v_nouveau := to_jsonb(NEW);
    ELSE
        v_ancien := to_jsonb(OLD);
    END IF;

    -- La cle, meme composee (un lot : reference|lot fournisseur).
    SELECT string_agg(COALESCE(to_jsonb(NEW), to_jsonb(OLD)) ->> a.attname, '|'
                      ORDER BY array_position(c.conkey, a.attnum)) INTO v_cle
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'p' AND c.conrelid = TG_RELID;

    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES (TG_TABLE_NAME, TG_OP, COALESCE(v_cle, '(cle composite)'),
            v_ancien::text, v_nouveau::text,
            current_setting('gestionfil.id_utilisateur', true),
            current_setting('gestionfil.adresse_ip', true),
            current_setting('gestionfil.session_id', true));
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_audit_modification() OWNER TO gestionfil;

-- Les tables, et ce qui s'y journalise. La suppression n'est ajoutee que la ou
-- trg_audit_suppression ne la couvre pas.
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        -- table,                     operations,                  colonnes ignorees
        ('ligne_bc',                  'INSERT OR UPDATE',          ''),
        ('bon_commande',              'UPDATE',                    'statut'),
        ('reception',                 'UPDATE',                    'statut'),
        ('import_dossiers',           'UPDATE',                    ''),
        ('import_factures',           'INSERT OR UPDATE',          ''),
        ('import_facture_lignes',     'INSERT OR UPDATE',          'quantite_recue_kg'),
        ('dossier_lignes_frais',      'INSERT OR UPDATE OR DELETE', ''),
        ('import_receptions',         'INSERT OR UPDATE',          ''),
        ('import_reception_lignes',   'INSERT OR UPDATE OR DELETE', ''),
        ('lot',                       'UPDATE',                    'date_derniere_activite'),
        ('demande_autorisation',      'INSERT OR UPDATE',          ''),
        ('taux_change',               'INSERT OR UPDATE',          '')
    ) v(nom, ops, ignorees)
    LOOP
        IF to_regclass('public.' || t.nom) IS NULL THEN
            RAISE NOTICE 'audit des montants : table % absente, ignoree', t.nom;
            CONTINUE;
        END IF;
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_modification ON %I', t.nom);
        EXECUTE format('CREATE TRIGGER trg_audit_modification AFTER %s ON %I FOR EACH ROW '
                       'EXECUTE FUNCTION fn_trg_audit_modification(%s)',
                       t.ops, t.nom,
                       (SELECT string_agg(quote_literal(x), ', ')
                          FROM unnest(string_to_array(NULLIF(t.ignorees, ''), ',')) x));
    END LOOP;
END $$;

-- Les propositions d'achat : chaque calcul les reecrit ; seuls comptent le
-- changement de statut (ecartee, retenue, convertie) et la suppression.
DROP TRIGGER IF EXISTS trg_audit_modification ON plan_achat;
CREATE TRIGGER trg_audit_modification
AFTER UPDATE OF statut ON plan_achat FOR EACH ROW
WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
EXECUTE FUNCTION fn_trg_audit_modification();
DROP TRIGGER IF EXISTS trg_audit_suppression_plan_achat ON plan_achat;
CREATE TRIGGER trg_audit_suppression_plan_achat
AFTER DELETE ON plan_achat FOR EACH ROW
EXECUTE FUNCTION fn_trg_audit_modification();

COMMIT;
