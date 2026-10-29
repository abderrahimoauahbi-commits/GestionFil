-- =============================================================================
-- 2026-10-19c — Verrou optimiste sur les 17 referentiels (decision du 19/10/2026)
-- =============================================================================
-- docs/A-DECIDER-verrou-optimiste.md, groupe 1 : toutes les tables de base
-- administrees par le CRUD generique recoivent la colonne `version`. Deux
-- saisies concurrentes sur la meme fiche (une reference, un fournisseur) : la
-- seconde est refusee en 409 au lieu d'ecraser la premiere en silence. Le
-- refus est pose par le serveur (crud.rs) ; ici, la version avance.
--
-- LA VERSION N'AVANCE QUE SI UNE DONNEE SAISIE CHANGE. Ces tables sont aussi
-- reecrites par le systeme : le CMUP d'une reference a chaque reception, ses
-- classes ABC/XYZ a chaque calcul, le delai reel d'un fournisseur. Si ces
-- ecritures faisaient avancer la version, chaque reception validee rendrait
-- perimee la fiche qu'un acheteur est en train de corriger : un faux conflit.
-- Le declencheur compare donc l'ancienne et la nouvelle ligne SANS les colonnes
-- calculees, qui lui sont passees en arguments. Une mise a jour qui ne change
-- rien ne la fait pas avancer non plus.
--
-- Les six documents de 2026-10-17d gardent leur declencheur : chez eux, toute
-- ecriture compte (un total recalcule apres une ligne modifiee doit bien rendre
-- l'en-tete perime).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_version_si_saisie() RETURNS trigger AS $$
BEGIN
    -- TG_ARGV : les colonnes calculees par le systeme, ignorees dans la
    -- comparaison. `version` l'est toujours : c'est elle qu'on pose.
    -- SANS ARGUMENT, TG_ARGV VAUT NULL, pas un tableau vide : `jsonb - NULL` rend
    -- NULL des deux cotes, et la version ne bougeait plus (vu sur saison_mois).
    IF ((to_jsonb(NEW) - 'version') - COALESCE(TG_ARGV, '{}'::text[]))
       IS DISTINCT FROM ((to_jsonb(OLD) - 'version') - COALESCE(TG_ARGV, '{}'::text[])) THEN
        NEW.version := OLD.version + 1;
    ELSE
        NEW.version := OLD.version;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_version_si_saisie() OWNER TO gestionfil;

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('saison_mois',            ''),
        ('categorie_matiere',      ''),
        ('role_bom',               ''),
        ('type_mouvement',         ''),
        ('motif_mouvement',        ''),
        ('motif_ligne',            ''),
        ('magasin',                ''),
        ('groupe_equiv',           ''),
        ('parametres_frais',       ''),
        ('position_tarifaire',     ''),
        ('fournisseur',            'delai_reel_moyen_jours,couverture_commande_j'),
        ('couleur',                ''),
        ('conditionnement',        ''),
        ('couleur_fournisseur',    ''),
        ('famille',                ''),
        ('reference',              'facteur_kg,prix_catalogue_kg,classe_abc,classe_xyz,date_dernier_abc,cmup_mad,date_dernier_cmup'),
        ('reference_groupe_equiv', '')
    ) AS v(nom, calculees)
    LOOP
        IF to_regclass('public.' || r.nom) IS NULL THEN
            RAISE EXCEPTION '2026-10-19c : table % absente', r.nom;
        END IF;
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1', r.nom);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_aa_version ON %I', r.nom);
        EXECUTE format(
            'CREATE TRIGGER trg_aa_version BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_trg_version_si_saisie(%s)',
            r.nom,
            COALESCE((SELECT string_agg(quote_literal(c), ', ')
                        FROM unnest(string_to_array(NULLIF(r.calculees, ''), ',')) c), ''));
    END LOOP;
END $$;

-- Temoin : 17 + les 6 documents de 2026-10-17d.
DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n FROM pg_trigger WHERE tgname = 'trg_aa_version' AND NOT tgisinternal;
    IF n < 23 THEN
        RAISE EXCEPTION '2026-10-19c : % declencheur(s) de version au lieu de 23', n;
    END IF;
END $$;

COMMIT;
