-- =============================================================================
-- 2026-10-09z — Le type d'un parametre garanti par la base (audit v5, T15)
-- =============================================================================
-- Un parametre porte son type (ENTIER, DECIMAL, DATE, TEXTE) mais rien ne le
-- verifiait : « 2,5 » ou « 10 j » dans un seuil se lisait plus tard, en
-- « erreur interne » au premier calcul qui le convertissait. La valeur se
-- verifie a l'ecriture :
--   * ENTIER : un entier positif ou nul ;
--   * DECIMAL : un nombre positif ou nul, le point pour separateur ;
--   * DATE : AAAA-MM-JJ, une date qui existe ;
--   * TEXTE : libre.
-- Aucun seuil de l'application n'a de sens negatif. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_trg_parametre_type() RETURNS trigger AS $$
DECLARE
    v text := btrim(COALESCE(NEW.valeur_courante, ''));
BEGIN
    IF NEW.type_donnee = 'ENTIER' AND v !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'PARAMETRE : % attend un entier positif ou nul, pas « % ».',
            NEW.code_parametre, NEW.valeur_courante USING ERRCODE = 'check_violation';
    ELSIF NEW.type_donnee = 'DECIMAL' AND v !~ '^[0-9]+([.][0-9]+)?$' THEN
        RAISE EXCEPTION 'PARAMETRE : % attend un nombre positif ou nul, avec un point (2.5), pas « % ».',
            NEW.code_parametre, NEW.valeur_courante USING ERRCODE = 'check_violation';
    ELSIF NEW.type_donnee = 'DATE' THEN
        IF v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION 'PARAMETRE : % attend une date AAAA-MM-JJ, pas « % ».',
                NEW.code_parametre, NEW.valeur_courante USING ERRCODE = 'check_violation';
        END IF;
        BEGIN
            PERFORM v::date;
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'PARAMETRE : % : « % » n''est pas une date qui existe.',
                NEW.code_parametre, NEW.valeur_courante USING ERRCODE = 'check_violation';
        END;
    END IF;
    IF NEW.type_donnee IN ('ENTIER', 'DECIMAL', 'DATE') THEN
        NEW.valeur_courante := v;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_parametre_type() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_00_parametre_type ON parametre;
CREATE TRIGGER trg_00_parametre_type BEFORE INSERT OR UPDATE OF valeur_courante, type_donnee ON parametre
FOR EACH ROW EXECUTE FUNCTION fn_trg_parametre_type();

-- Ce qui est deja en base doit passer : sinon, la migration s'arrete et dit quoi.
DO $$
DECLARE
    fautifs text;
BEGIN
    SELECT string_agg(code_parametre || '=' || valeur_courante, ', ') INTO fautifs
      FROM parametre
     WHERE (type_donnee = 'ENTIER' AND btrim(valeur_courante) !~ '^[0-9]+$')
        OR (type_donnee = 'DECIMAL' AND btrim(valeur_courante) !~ '^[0-9]+([.][0-9]+)?$')
        OR (type_donnee = 'DATE' AND btrim(valeur_courante) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    IF fautifs IS NOT NULL THEN
        RAISE EXCEPTION 'Parametres de type incoherent, a corriger avant cette migration : %', fautifs;
    END IF;
END $$;

COMMIT;
