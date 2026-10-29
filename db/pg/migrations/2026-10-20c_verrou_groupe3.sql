-- =============================================================================
-- 2026-10-20c — Verrou optimiste, groupe 3 (decision du 20/10/2026)
-- =============================================================================
-- docs/A-DECIDER-verrou-optimiste.md : dossiers d'import et leurs factures,
-- factures fournisseur, retours fournisseur, parametres, fiche technique d'une
-- machine. Meme mecanisme que les groupes 1 et 2 : la colonne `version`,
-- l'ecriture conditionnelle cote serveur (domain/concurrence.rs), un refus 409
-- qui nomme l'auteur. Les frais, engagements, paiements et lignes d'un dossier
-- passent par le verrou du dossier, comme les lignes d'un bon par son en-tete.
--
-- Restent hors verrou, par decision : les utilisateurs (l'administrateur seul),
-- les fiches de saisie machine (verrou fiche puis etage, decision tete) et le
-- comptage d'inventaire (plusieurs compteurs a la fois).
--
-- DEUX DECLENCHEURS. Le parametre, fiche d'une ligne : la version n'avance
-- que si une donnee saisie change (fn_trg_version_si_saisie, 2026-10-19c).
-- Les DOCUMENTS A LIGNES (dossier, facture d'import, facture et retour
-- fournisseur, machine et ses zones) : la version avance a CHAQUE ecriture, y compris la prise sous
-- verrou `SET version = version` qui precede l'enregistrement des lignes —
-- sinon, un enregistrement qui ne change que des lignes laisserait l'en-tete a
-- la meme version, et la saisie concurrente passerait. Seule exception : une
-- ecriture du SYSTEME qui ne change que des colonnes calculees (l'etat de
-- reception d'une facture d'import, recalcule depuis les arrivages) ne rend
-- pas perimee la facture qu'on est en train de corriger.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_version_document() RETURNS trigger AS $$
BEGIN
    -- TG_ARGV : les colonnes calculees par le systeme. Une ecriture qui ne
    -- change QUE celles-la garde la version ; toute autre, meme sans changement
    -- (la prise sous verrou), la fait avancer.
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
       AND ((to_jsonb(NEW) - 'version') - COALESCE(TG_ARGV, '{}'::text[]))
           IS NOT DISTINCT FROM ((to_jsonb(OLD) - 'version') - COALESCE(TG_ARGV, '{}'::text[])) THEN
        NEW.version := OLD.version;
    ELSE
        NEW.version := OLD.version + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_version_document() OWNER TO gestionfil;

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('import_dossiers',     'fn_trg_version_document',  ''),
        ('import_factures',     'fn_trg_version_document',  'statut_reception'),
        ('facture_fournisseur', 'fn_trg_version_document',  ''),
        ('retour_fournisseur',  'fn_trg_version_document',  ''),
        ('parametre',           'fn_trg_version_si_saisie', ''),
        ('machine',             'fn_trg_version_document',  '')
    ) AS v(nom, fonction, calculees)
    LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1', r.nom);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_aa_version ON %I', r.nom);
        EXECUTE format(
            'CREATE TRIGGER trg_aa_version BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION %I(%s)',
            r.nom, r.fonction,
            COALESCE((SELECT string_agg(quote_literal(c), ', ')
                        FROM unnest(string_to_array(NULLIF(r.calculees, ''), ',')) c), ''));
    END LOOP;
END $$;

-- UN DOSSIER CLOS SE PREND SOUS VERROU. Le frais post-cloture, l'avoir, les
-- paiements et les pieces vivent apres la cloture ; ils prennent le dossier
-- par `SET version = version`. La garde refusait toute ecriture d'un dossier
-- clos, celle-la comprise : deux paiements simultanes passaient alors l'un
-- apres l'autre au lieu d'etre refuses. Elle laisse passer desormais une
-- ecriture qui ne change QUE la version — rien du dossier ne bouge.
CREATE OR REPLACE FUNCTION fn_trg_import_dossier_garde() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN
            RAISE EXCEPTION 'Seul un dossier en brouillon se supprime.' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.statut = 'CLOTURE' AND NEW.statut IS DISTINCT FROM 'EN_COURS'
       AND (to_jsonb(NEW) - 'version') IS DISTINCT FROM (to_jsonb(OLD) - 'version') THEN
        RAISE EXCEPTION 'Dossier cloture : il ne se modifie plus.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
ALTER FUNCTION fn_trg_import_dossier_garde() OWNER TO gestionfil;

-- Temoin
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'version'
           AND table_name IN ('import_dossiers', 'import_factures', 'facture_fournisseur',
                              'retour_fournisseur', 'parametre', 'machine')) <> 6 THEN
        RAISE EXCEPTION '2026-10-20c : migration incomplete';
    END IF;
END $$;

COMMIT;
