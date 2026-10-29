-- =============================================================================
-- 2026-10-17c — Les trois cles etrangeres de `facture_fournisseur` sans index
-- =============================================================================
-- CONSTAT DE L'AUDIT (B4). Sur les 395 index de la base, il manquait exactement
-- trois index de couverture de cle etrangere, tous sur `facture_fournisseur` —
-- la table la plus recente (migration 2026-10-14d). Requete de controle :
--
--   SELECT conrelid::regclass, conkey FROM pg_constraint c
--    WHERE c.contype='f' AND c.connamespace='public'::regnamespace
--      AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid
--          AND (i.indkey::smallint[])[0:array_length(c.conkey,1)-1] @> c.conkey);
--
-- POURQUOI CELA COMPTE, MEME SUR UNE PETITE TABLE. PostgreSQL n'indexe pas le
-- cote ENFANT d'une cle etrangere. Sans index, toute suppression ou mise a jour
-- de la cle d'un PARENT — une devise, un compte utilisateur — doit parcourir
-- `facture_fournisseur` en entier pour verifier qu'aucune ligne n'y renvoie, et
-- elle pose un verrou pendant ce parcours. C'est sans effet aujourd'hui (la
-- table est jeune) et c'est exactement le genre de dette qui ne se voit qu'une
-- fois la table devenue grosse, quand desactiver un compte fait attendre tout
-- le monde.
--
-- Ces index servent aussi les listes de l'ecran /factures-fournisseur filtrees
-- par createur ou par valideur.
--
-- REJOUABLE : `IF NOT EXISTS` sur les trois. Les index heritent du proprietaire
-- de la table (`gestionfil`), il n'y a donc pas d'`OWNER TO` a poser.
-- =============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS ix_facture_fournisseur_devise
    ON facture_fournisseur (code_devise);

CREATE INDEX IF NOT EXISTS ix_facture_fournisseur_createur
    ON facture_fournisseur (id_utilisateur_creation);

CREATE INDEX IF NOT EXISTS ix_facture_fournisseur_valideur
    ON facture_fournisseur (id_utilisateur_validation);

-- ---- Temoin : plus aucune cle etrangere sans index de couverture ------------
DO $$
DECLARE
    v_sans integer;
BEGIN
    SELECT count(*) INTO v_sans
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.connamespace = 'public'::regnamespace
       AND NOT EXISTS (
             SELECT 1 FROM pg_index i
              WHERE i.indrelid = c.conrelid
                AND (i.indkey::smallint[])[0:array_length(c.conkey, 1) - 1] @> c.conkey);
    RAISE NOTICE '2026-10-17c : % cle(s) etrangere(s) sans index de couverture restante(s).', v_sans;
    IF v_sans > 0 THEN
        RAISE WARNING 'Il reste des cles etrangeres sans index : relancer la requete de controle ci-dessus.';
    END IF;
END $$;

COMMIT;
