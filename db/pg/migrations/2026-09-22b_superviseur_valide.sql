-- =============================================================================
-- MIGRATION 2026-09-22b — le superviseur peut valider ce qu'il a cree
--
-- CE QUI CHANGE, ET SUR DECISION DE LA DIRECTION. La regle B4-4 — « on ne
-- valide pas un bon qu'on a cree » — est une separation des taches : elle
-- empeche qu'une seule personne engage l'entreprise de bout en bout. Elle
-- reste en vigueur pour TOUS LES ROLES SAUF ADMIN.
--
-- Pourquoi cette exception est defendable ici : dans une PME, le superviseur
-- est souvent seul a saisir ET seul a pouvoir engager. Lui interdire de
-- valider ne cree pas un second regard, cela cree un bon de commande bloque —
-- et, en pratique, quelqu'un finit par partager un mot de passe pour en
-- sortir. Une regle qu'on contourne protege moins qu'une regle qu'on assume.
--
-- LA TRACE RESTE ENTIERE : `id_utilisateur_validation` et `date_validation`
-- sont ecrits comme pour tout le monde. Un bon valide par son propre auteur se
-- voit donc dans le journal d'audit ; c'est le point.
--
-- POURQUOI UN DECLENCHEUR ET PLUS UNE CONTRAINTE. Une contrainte CHECK ne doit
-- pas interroger d'autres tables : PostgreSQL le tolere mais ne le reevalue
-- jamais, et la garantie devient fausse des que la donnee lue change. Or il
-- faut ici connaitre le ROLE du validateur, qui vit dans `utilisateur`. Un
-- declencheur, lui, a le droit de lire — c'est l'outil juste.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-22b_superviseur_valide.sql
-- =============================================================================

ALTER TABLE bon_commande DROP CONSTRAINT IF EXISTS bon_commande_check;

CREATE OR REPLACE FUNCTION fn_trg_bc_separation_taches() RETURNS trigger AS $$
DECLARE
    role_validateur text;
BEGIN
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

DROP TRIGGER IF EXISTS trg_bc_separation_taches ON bon_commande;
CREATE TRIGGER trg_bc_separation_taches
    BEFORE INSERT OR UPDATE ON bon_commande
    FOR EACH ROW EXECUTE FUNCTION fn_trg_bc_separation_taches();

-- PREUVE : l'ancienne contrainte est partie, le declencheur est en place.
SELECT 'contrainte bon_commande_check : ' ||
       (SELECT count(*) FROM pg_constraint
         WHERE conrelid = 'bon_commande'::regclass AND conname = 'bon_commande_check')
    || ' (0 attendu)'
UNION ALL
SELECT 'declencheur trg_bc_separation_taches : ' ||
       (SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'bon_commande'::regclass AND tgname = 'trg_bc_separation_taches')
    || ' (1 attendu)';
