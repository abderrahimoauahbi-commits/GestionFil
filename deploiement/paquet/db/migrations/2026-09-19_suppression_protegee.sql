-- =============================================================================
-- MIGRATION 2026-09-19 — CE QUI RETIENT UN ENREGISTREMENT, ET LA TRACE DE SA MORT
-- -----------------------------------------------------------------------------
-- DECISION DU 19/09/2026, prise sur le modele des grands ERP. Deux natures de
-- donnees, deux traitements :
--
--   * une DONNEE DE BASE (famille, couleur, reference, machine...) s'efface
--     vraiment si rien ne s'en sert, et se desactive sinon ;
--   * un DOCUMENT se devalide, s'annule ou se contre-passe, il ne s'efface pas.
--
-- CETTE MIGRATION POSE LE SOCLE DE LA PREMIERE REGLE, et rien d'autre.
--
-- 1. `fn_retenants` REPOND A « QUI S'EN SERT ? » EN LISANT LE CATALOGUE.
--
--    La suppression definitive d'une reference verifiait SEPT tables. Or
--    vingt-et-une portent une cle etrangere vers `reference` : les quatorze
--    autres auraient rendu une violation de contrainte brute, illisible pour
--    celui qui la lit. Une liste ecrite a la main vieillit a chaque migration ;
--    le catalogue de PostgreSQL, lui, est toujours a jour parce qu'il EST la
--    verite. On le lit donc, au lieu de le recopier.
--
-- 2. LA SUPPRESSION SE TRACE, PARTOUT.
--
--    L'audit couvrait surtout les modifications : `reference` n'auditait que ses
--    UPDATE, `fournisseur` aussi, et famille, couleur, categorie, magasin,
--    machine n'auditaient rien du tout. Ouvrir la suppression sans ouvrir la
--    trace reviendrait a rendre les disparitions inexplicables — exactement ce
--    qu'un ERP d'analyse ne peut pas se permettre.
--
--    Le declencheur garde la LIGNE ENTIERE en JSON. Ce n'est pas du luxe : une
--    suppression regrettee se rejoue depuis cette ligne, alors qu'un identifiant
--    seul ne permet que de constater le trou.
--
--    LES TABLES CALCULEES EN SONT EXCLUES (besoins du MRP, cliches machine,
--    soldes de stock) : elles se vident et se refont a chaque recalcul, et les
--    auditer noierait les vraies suppressions sous des milliers de lignes.
--
-- Rejouable : CREATE OR REPLACE et DROP TRIGGER IF EXISTS.
-- =============================================================================

BEGIN;

-- ------------------------------------------------- 1. QUI RETIENT CETTE LIGNE ?
CREATE OR REPLACE FUNCTION fn_retenants(p_table text, p_valeur text)
RETURNS TABLE(table_liee text, colonne text, nb bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_oid  oid := p_table::regclass;
    v_pk   text;
    r      record;
    n      bigint;
BEGIN
    -- La colonne de cle primaire de la table visee. Sans elle, on ne saurait
    -- pas QUELLE colonne des tables liees comparer.
    SELECT a.attname INTO v_pk
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'p' AND c.conrelid = v_oid
       AND array_length(c.conkey, 1) = 1;
    IF v_pk IS NULL THEN
        RETURN;  -- cle composite : hors de portee de cette fonction
    END IF;

    FOR r IN
        -- Pour chaque cle etrangere pointant vers cette table, la colonne
        -- PORTEUSE en face de la colonne REFERENCEE : c'est l'appariement
        -- position par position de conkey et confkey qui le donne.
        SELECT c.conrelid::regclass::text AS t, ac.attname::text AS col
          FROM pg_constraint c
          CROSS JOIN LATERAL generate_subscripts(c.conkey, 1) AS i
          JOIN pg_attribute ac ON ac.attrelid = c.conrelid AND ac.attnum = c.conkey[i]
          JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[i]
         WHERE c.contype = 'f' AND c.confrelid = v_oid AND af.attname = v_pk
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE %I::text = $1', r.t, r.col)
           INTO n USING p_valeur;
        IF n > 0 THEN
            table_liee := r.t;
            colonne    := r.col;
            nb         := n;
            RETURN NEXT;
        END IF;
    END LOOP;
END $$;

COMMENT ON FUNCTION fn_retenants(text, text) IS
  'Ce qui empeche d''effacer une ligne : tables liees et nombre de lignes, lu dans le catalogue.';

-- ------------------------------------------- 2. TOUTE SUPPRESSION LAISSE SA TRACE
CREATE OR REPLACE FUNCTION fn_trg_audit_suppression() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_cle text;
BEGIN
    -- L'identifiant de la ligne effacee, quel que soit le nom de sa cle : on le
    -- retrouve dans le JSON de la ligne, par la colonne de cle primaire.
    SELECT to_jsonb(OLD) ->> a.attname INTO v_cle
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'p' AND c.conrelid = TG_RELID
       AND array_length(c.conkey, 1) = 1;

    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES (TG_TABLE_NAME, 'DELETE', COALESCE(v_cle, '(cle composite)'),
            to_jsonb(OLD), NULL,
            current_setting('gestionfil.id_utilisateur', true),
            current_setting('gestionfil.adresse_ip', true),
            current_setting('gestionfil.session_id', true));
    RETURN OLD;
END $$;

DO $$
DECLARE
    t text;
    -- LES TABLES DONT LA DISPARITION D'UNE LIGNE EST UN EVENEMENT. Les tables
    -- calculees n'y sont pas : leurs lignes vont et viennent a chaque recalcul.
    tables text[] := ARRAY[
        -- Donnees de base
        'reference', 'famille', 'couleur', 'couleur_fournisseur', 'categorie_matiere',
        'fournisseur', 'magasin', 'machine', 'machine_emplacement', 'role_bom',
        'type_mouvement', 'motif_mouvement', 'motif_ligne', 'type_frais',
        'groupe_equivalence', 'reference_groupe_equiv', 'taux_change',
        'qualite', 'ligne_qualite', 'recette', 'plan_qualite',
        'utilisateur', 'permission', 'parametre', 'champ_configurable',
        -- Documents
        'bon_commande', 'ligne_bc', 'reception', 'ligne_reception',
        'inventaire', 'ligne_inventaire', 'transfert', 'ligne_transfert',
        'plan_production', 'ligne_plan_production', 'plan_saisonnalite',
        'machine_fiche', 'machine_fiche_ligne',
        'import_dossiers', 'import_factures', 'import_facture_lignes',
        'import_receptions',
        -- Le grand livre : la suppression y est interdite, et c'est justement
        -- pour cela qu'on l'audite. Le jour ou une migration desactive le
        -- garde-fou — nous l'avons fait deux fois en deux jours — la trace
        -- restera.
        'mouvement', 'ligne_mouvement'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'table % absente, ignoree', t;
            CONTINUE;
        END IF;
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_suppression ON %I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON %I '
            'FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_suppression()', t);
    END LOOP;
END $$;

-- ------------------------------------------------------------- 3. LES PREUVES
DO $$
DECLARE n_trg bigint; n_ret bigint; exemple text;
BEGIN
    SELECT count(*) INTO n_trg FROM pg_trigger WHERE tgname = 'trg_audit_suppression';
    IF n_trg < 40 THEN
        RAISE EXCEPTION 'seulement % declencheur(s) de trace posé(s)', n_trg;
    END IF;

    -- La fonction voit-elle ce que l'ancien controle ecrit a la main voyait ?
    SELECT count(*) INTO n_ret FROM fn_retenants('reference',
        (SELECT code_reference FROM ligne_mouvement LIMIT 1));
    IF n_ret = 0 THEN
        RAISE EXCEPTION 'fn_retenants ne voit rien pour une reference qui a des mouvements';
    END IF;
    SELECT string_agg(table_liee || ' (' || nb || ')', ', ') INTO exemple
      FROM fn_retenants('reference', (SELECT code_reference FROM ligne_mouvement LIMIT 1));
    RAISE NOTICE 'trace posee sur % tables ; exemple de retenants : %', n_trg, exemple;
END $$;

COMMIT;
