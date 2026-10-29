-- =============================================================================
-- 2026-10-17d — Verrou optimiste sur les six documents a workflow (A2)
-- =============================================================================
-- LE DEFAUT, CONSTATE PAR L'AUDIT DU 17/10. Aucun document metier n'etait
-- protege contre l'ecrasement concurrent. Les trois colonnes `version` de la
-- base (`historique_prix_revision`, `archive_reception`, `telechargement`)
-- servent au versionnage d'archives, pas au controle de concurrence.
--
-- Deux utilisateurs qui ouvrent le meme bon de commande et enregistrent l'un
-- apres l'autre : LE SECOND ECRASE LE PREMIER EN SILENCE. Personne n'est
-- averti, et la saisie perdue ne laisse aucune trace visible — seul le journal
-- d'audit garde les deux versions, et encore faut-il penser a l'interroger.
-- C'est la perte de mise a jour classique, et c'est exactement le scenario d'un
-- atelier ou plusieurs postes travaillent sur les memes documents.
--
-- CE QUE FAIT CETTE MIGRATION. Elle ajoute une colonne `version` aux six
-- entites qui ont des transitions d'etat declarees dans `transition_statut` —
-- celles, justement, qui passent de main en main :
--
--     bon_commande (12 transitions)   reception (7)    inventaire (6)
--     plan_production (8)             qualite (6)      transfert (3)
--
-- et un declencheur qui l'incremente a CHAQUE modification.
--
-- POURQUOI EN BASE ET NON DANS LE SERVICE (ADR-001 D-04). Un compteur tenu par
-- le code applicatif ne protege que les ecritures qui passent par ce code. Ici,
-- toute modification incremente la version : une correction faite en SQL, un
-- script d'administration ou une migration future font avancer le compteur, et
-- un client qui travaillait sur l'ancienne version se voit refuse. Le client ne
-- peut pas non plus fixer la version lui-meme : le declencheur la calcule
-- depuis l'ancienne ligne et ignore ce qu'on lui envoie.
--
-- COMMENT LE SERVICE S'EN SERT. Il lit la version avec le document, la renvoie
-- au client, et la repasse dans son UPDATE : `... WHERE id = $1 AND version =
-- $n`. Zero ligne modifiee = quelqu'un est passe avant. Le service repond alors
-- 409 en nommant l'auteur et l'heure, qu'il lit dans `audit_log`.
--
-- REJOUABLE : `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, et les
-- declencheurs sont deposes avant d'etre recrees.
-- =============================================================================

BEGIN;

-- ---- 1. La colonne, sur les six documents a workflow ------------------------
-- DEFAULT 1 plutot que 0 : une version qui commence a 1 se lit comme « premiere
-- version », et une valeur a 0 dans un journal signalerait une anomalie.
ALTER TABLE bon_commande    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE reception       ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE inventaire      ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE transfert       ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE plan_production ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE qualite         ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- ---- 2. Le declencheur d'incrementation -------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_version_incrementer() RETURNS trigger AS $$
BEGIN
    -- LA VERSION N'EST PAS UNE DONNEE DE SAISIE. Quoi que le client envoie, la
    -- nouvelle version est l'ancienne plus un. C'est ce qui rend le compteur
    -- infalsifiable : un client ne peut pas rejouer une version ancienne pour
    -- faire croire qu'il detient la derniere.
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_trg_version_incrementer() OWNER TO gestionfil;

-- ---- 3. Pose sur chaque table -----------------------------------------------
-- L'ordre alphabetique du nom compte : PostgreSQL execute les declencheurs BEFORE
-- par ordre de nom. `trg_aa_version` passe avant les declencheurs metier, de sorte
-- que la version soit deja a jour si l'un d'eux relit NEW.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bon_commande', 'reception', 'inventaire',
                             'transfert', 'plan_production', 'qualite'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_aa_version ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_aa_version BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_trg_version_incrementer()', t);
    END LOOP;
END $$;

-- ---- 4. Temoin ---------------------------------------------------------------
DO $$
DECLARE
    v_colonnes integer;
    v_decl     integer;
BEGIN
    SELECT count(*) INTO v_colonnes
      FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'version'
       AND table_name IN ('bon_commande', 'reception', 'inventaire',
                          'transfert', 'plan_production', 'qualite');
    SELECT count(*) INTO v_decl
      FROM pg_trigger WHERE tgname = 'trg_aa_version' AND NOT tgisinternal;
    RAISE NOTICE '2026-10-17d : verrou optimiste — % colonne(s) version, % declencheur(s).',
                 v_colonnes, v_decl;
    IF v_colonnes <> 6 OR v_decl <> 6 THEN
        RAISE EXCEPTION 'Verrou optimiste incomplet : % colonnes, % declencheurs (6 attendus).',
                        v_colonnes, v_decl;
    END IF;
END $$;

COMMIT;
