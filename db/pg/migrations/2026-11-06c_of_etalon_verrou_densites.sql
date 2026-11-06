-- =============================================================================
-- 2026-11-06c — L'etalon de l'OF fige au lancement ; les densites verrouillees
-- =============================================================================
-- Revue des 22 domaines (06/11/2026), arbitrages 8 et 9 (Q15 de
-- docs/A-DECIDER-analyse-consommation.md, decide le 27/10, jamais code) :
--
--   1. AU LANCEMENT D'UN OF, ON FIGE L'ETALON APPLICABLE A CET OF : par
--      reference, les kg/m2 de la recette du jour et le taux de perte de la
--      qualite (`of_etalon`, ecrit par le service au passage en LANCE, jamais
--      modifie). On ne fige PAS une quantite en kg : le metrage peut etre
--      inconnu (2026-11-06a) ou revise. Le prevu se calcule a la lecture :
--      metrage x etalon fige. Une recette corrigee apres coup ne reecrit plus
--      l'ecart des OF lances ou clotures.
--      Un OF encore PREVU n'a pas d'etalon : il lit la recette active.
--   2. LE PREVU RESTE VIDE TANT QUE LE METRAGE EST INCONNU : `v_of_consommation`
--      et `v_of_bilan` rendent NULL (« inconnu »), et non 0, pour le prevu et
--      l'ecart. Avec un metrage connu, une reference hors recette garde un
--      prevu de 0.
--   3. LES OF DEJA LANCES OU CLOTURES (reprise) : leur etalon est fige sur la
--      recette d'aujourd'hui, la seule connue (origine REPRISE).
--   4. LES DENSITES VERROUILLEES COMME LA RECETTE : une qualite produite par le
--      plan en service ne change ni ses densites, ni leurs unites, ni ses roles
--      (meme regle et meme message que trg_recette_verrou_plan_*). Le libelle,
--      l'ordre d'affichage, l'observation et le poids commercial restent libres.
--
-- Rejouable. Enregistree par migrer.py. Exigee au demarrage (MIGRATIONS_REQUISES).
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. L'etalon fige
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS of_etalon (
    id_of           text          NOT NULL REFERENCES ordre_fabrication(id_of),
    code_reference  text          NOT NULL REFERENCES reference(code_reference),
    -- La qualite de l'OF au lancement : l'etalon ne vaut que pour elle.
    code_qualite    text          NOT NULL REFERENCES qualite(code_qualite),
    kg_m2           numeric(18,6) NOT NULL CHECK (kg_m2 >= 0),
    taux_perte_pct  numeric(9,4)  NOT NULL CHECK (taux_perte_pct >= 0),
    origine         text          NOT NULL DEFAULT 'LANCEMENT'
                                  CHECK (origine IN ('LANCEMENT', 'REPRISE')),
    date_figee      timestamptz   NOT NULL DEFAULT now(),
    id_utilisateur  text          REFERENCES utilisateur(id_utilisateur),
    PRIMARY KEY (id_of, code_reference)
);
ALTER TABLE of_etalon OWNER TO gestionfil;
COMMENT ON TABLE of_etalon IS
  'Etalon de l''OF fige au lancement (Q15) : kg/m2 et perte par reference. Insertion seule.';

-- Une trace : ni modification, ni suppression.
CREATE OR REPLACE FUNCTION fn_trg_of_etalon_immuable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'OF-ETALON : l''etalon d''un OF lance est fige ; il ne se modifie ni ne se supprime.';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_of_etalon_immuable() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_of_etalon_immuable ON of_etalon;
CREATE TRIGGER trg_of_etalon_immuable BEFORE UPDATE OR DELETE ON of_etalon
FOR EACH ROW EXECUTE FUNCTION fn_trg_of_etalon_immuable();

-- La reprise : les OF deja lances ou clotures, sur la recette d'aujourd'hui.
INSERT INTO of_etalon (id_of, code_reference, code_qualite, kg_m2, taux_perte_pct, origine)
SELECT o.id_of, rc.code_reference, o.code_qualite, sum(rc.kg_m2), q.taux_perte_pct, 'REPRISE'
  FROM ordre_fabrication o
  JOIN qualite q ON q.code_qualite = o.code_qualite
  JOIN v_recette_calculee rc ON rc.code_qualite = o.code_qualite
 WHERE o.statut IN ('LANCE', 'CLOTURE') AND rc.kg_m2 IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM of_etalon e WHERE e.id_of = o.id_of)
 GROUP BY o.id_of, rc.code_reference, o.code_qualite, q.taux_perte_pct;

-- -----------------------------------------------------------------------------
-- 2. Le prevu : l'etalon fige s'il existe, sinon la recette active ; vide sans metrage
-- -----------------------------------------------------------------------------
-- MEMES COLONNES qu'avant : une migration plus ancienne (22b, 27g) redefinit ces
-- vues quand on la rejoue ; une colonne de plus l'en empecherait. L'origine du
-- prevu (etalon fige ou recette du jour) se lit dans `of_etalon` par la route.
CREATE OR REPLACE VIEW v_of_consommation AS
WITH base AS (
    SELECT e.id_of, e.code_reference, e.kg_m2, e.taux_perte_pct
      FROM of_etalon e
    UNION ALL
    SELECT o.id_of, rc.code_reference, rc.kg_m2, q.taux_perte_pct
      FROM ordre_fabrication o
      JOIN qualite q ON q.code_qualite = o.code_qualite
      JOIN v_recette_calculee rc ON rc.code_qualite = o.code_qualite
     WHERE rc.kg_m2 IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM of_etalon e WHERE e.id_of = o.id_of)
), prevu AS (
    SELECT b.id_of, b.code_reference,
           sum(o.metrage_m2 * b.kg_m2 * (1::numeric + b.taux_perte_pct / 100.0)) AS kg_prevu
      FROM base b
      JOIN ordre_fabrication o ON o.id_of = b.id_of
     GROUP BY b.id_of, b.code_reference
), reel AS (
    SELECT g.id_of,
           g.code_reference,
           string_agg(DISTINCT NULLIF(g.lot_fournisseur, ''::text), ', '::text) AS lots,
           sum(g.kg) FILTER (WHERE g.nature = 'CONSOMMATION_MACHINE'::text) AS kg_conso_fil,
           sum(g.kg) FILTER (WHERE g.nature = ANY (ARRAY['CONSOMMATION_DIRECTE'::text, 'HORS_MACHINE'::text])) AS kg_sorti,
           - sum(g.kg) FILTER (WHERE g.nature = 'RETOUR_CONSO'::text) AS kg_rendu,
           sum(g.kg) FILTER (WHERE g.nature = 'REBUT_DECHET'::text) AS kg_dechet,
           sum(g.kg) FILTER (WHERE g.nature = 'REBUT_PERTE'::text) AS kg_perte,
           sum(g.kg) FILTER (WHERE g.nature = 'REBUT_CASSE'::text) AS kg_casse,
           sum(g.kg) FILTER (WHERE g.nature = 'AUTRE_ECART'::text AND g.categorie_ecart IS DISTINCT FROM 'AJUSTEMENT_INVENTAIRE'::text) AS kg_autre_ecart
      FROM v_consommation_fait g
     WHERE g.id_of IS NOT NULL
     GROUP BY g.id_of, g.code_reference
), cles AS (
    SELECT prevu.id_of, prevu.code_reference FROM prevu
    UNION
    SELECT reel.id_of, reel.code_reference FROM reel
), calc AS (
    SELECT k.id_of, k.code_reference, h.lots,
           -- Metrage inconnu : prevu inconnu. Connu : 0 pour une reference hors recette.
           CASE WHEN o.metrage_m2 IS NULL THEN NULL ELSE COALESCE(p.kg_prevu, 0::numeric) END AS kg_prevu,
           COALESCE(h.kg_conso_fil, 0::numeric) AS kg_conso_fil,
           COALESCE(h.kg_sorti, 0::numeric) AS kg_sorti,
           COALESCE(h.kg_rendu, 0::numeric) AS kg_rendu,
           COALESCE(h.kg_dechet, 0::numeric) AS kg_dechet,
           COALESCE(h.kg_perte, 0::numeric) AS kg_perte,
           COALESCE(h.kg_casse, 0::numeric) AS kg_casse,
           COALESCE(h.kg_autre_ecart, 0::numeric) AS kg_autre_ecart
      FROM cles k
      JOIN ordre_fabrication o ON o.id_of = k.id_of
      LEFT JOIN prevu p ON p.id_of = k.id_of AND p.code_reference = k.code_reference
      LEFT JOIN reel h ON h.id_of = k.id_of AND h.code_reference = k.code_reference
)
SELECT o.id_of,
       o.numero,
       o.code_qualite,
       o.statut,
       o.date_of,
       o.metrage_m2,
       c.code_reference,
       r.designation,
       NULLIF(c.lots, ''::text) AS lots,
       round(c.kg_prevu, 4) AS kg_prevu,
       round(c.kg_conso_fil, 4) AS kg_conso_fil,
       round(c.kg_sorti, 4) AS kg_sorti_hors_machine,
       round(c.kg_rendu, 4) AS kg_rendu_hors_machine,
       round(c.kg_sorti - c.kg_rendu, 4) AS kg_hors_machine,
       round(c.kg_conso_fil + c.kg_sorti - c.kg_rendu, 4) AS kg_reel,
       round(c.kg_dechet, 4) AS kg_dechet,
       round(c.kg_perte, 4) AS kg_perte,
       round(c.kg_casse, 4) AS kg_casse,
       round(c.kg_autre_ecart, 4) AS kg_autre_ecart,
       round(c.kg_conso_fil + c.kg_sorti - c.kg_rendu - c.kg_prevu, 4) AS ecart_kg,
       CASE WHEN c.kg_prevu > 0::numeric
            THEN round((c.kg_conso_fil + c.kg_sorti - c.kg_rendu - c.kg_prevu) / c.kg_prevu * 100::numeric, 2)
       END AS ecart_pct
  FROM calc c
  JOIN ordre_fabrication o ON o.id_of = c.id_of
  JOIN reference r ON r.code_reference = c.code_reference;
ALTER VIEW v_of_consommation OWNER TO gestionfil;

CREATE OR REPLACE VIEW v_of_bilan AS
SELECT o.id_of,
       o.numero,
       o.code_qualite,
       q.nom AS qualite_nom,
       o.statut,
       o.date_of,
       o.date_fin_prevue,
       o.metrage_m2,
       o.date_cloture,
       count(c.code_reference) AS nb_references,
       CASE WHEN o.metrage_m2 IS NULL THEN NULL
            ELSE COALESCE(round(sum(c.kg_prevu), 4), 0::numeric) END AS kg_prevu,
       COALESCE(round(sum(c.kg_conso_fil), 4), 0::numeric) AS kg_conso_fil,
       COALESCE(round(sum(c.kg_hors_machine), 4), 0::numeric) AS kg_hors_machine,
       COALESCE(round(sum(c.kg_reel), 4), 0::numeric) AS kg_reel,
       COALESCE(round(sum(c.kg_dechet), 4), 0::numeric) AS kg_dechet,
       COALESCE(round(sum(c.kg_perte), 4), 0::numeric) AS kg_perte,
       COALESCE(round(sum(c.kg_casse), 4), 0::numeric) AS kg_casse,
       COALESCE(round(sum(c.kg_autre_ecart), 4), 0::numeric) AS kg_autre_ecart,
       CASE WHEN o.metrage_m2 IS NULL THEN NULL
            ELSE COALESCE(round(sum(c.kg_reel) - sum(c.kg_prevu), 4), 0::numeric) END AS ecart_kg,
       CASE WHEN o.metrage_m2 IS NOT NULL AND sum(c.kg_prevu) > 0::numeric
            THEN round((sum(c.kg_reel) - sum(c.kg_prevu)) / sum(c.kg_prevu) * 100::numeric, 2)
       END AS ecart_pct
  FROM ordre_fabrication o
  JOIN qualite q ON q.code_qualite = o.code_qualite
  LEFT JOIN v_of_consommation c ON c.id_of = o.id_of
 GROUP BY o.id_of, q.nom;
ALTER VIEW v_of_bilan OWNER TO gestionfil;

-- Le champ nouveau de l'en-tete OF (`etalon_fige`, calcule par la route), declare
-- comme le prevu (un champ non declare est masque a la sortie).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'PLANS', 'etalon_fige', 'Étalon figé', j.niveau_defaut, j.sensible, j.ordre + 1
  FROM champ_configurable j WHERE j.module = 'PLANS' AND j.champ = 'kg_prevu'
ON CONFLICT (module, champ) DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, 'etalon_fige', m.niveau
  FROM modele_droit_champ m WHERE m.module = 'PLANS' AND m.champ = 'kg_prevu'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, 'etalon_fige', d.niveau
  FROM droit_champ d WHERE d.module = 'PLANS' AND d.champ = 'kg_prevu'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Les densites d'une qualite produite par le plan en service
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_ligne_qualite_verrou_plan() RETURNS trigger AS $$
DECLARE
    v_qualite text := CASE WHEN TG_OP = 'INSERT' THEN NEW.code_qualite ELSE OLD.code_qualite END;
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.densite IS NOT DISTINCT FROM NEW.densite
       AND OLD.unite_densite IS NOT DISTINCT FROM NEW.unite_densite
       AND OLD.code_role IS NOT DISTINCT FROM NEW.code_role
       AND OLD.code_qualite IS NOT DISTINCT FROM NEW.code_qualite
       AND OLD.actif IS NOT DISTINCT FROM NEW.actif THEN
        RETURN NEW;    -- libelle, ordre, observation, poids commercial : libres
    END IF;
    IF EXISTS (SELECT 1 FROM plan_qualite pq
                 JOIN plan_production pp ON pp.id_plan = pq.id_plan
                WHERE pq.code_qualite = v_qualite AND pp.statut = 'EN_COURS') THEN
        RAISE EXCEPTION 'Densites verrouillees : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_qualite_verrou_plan() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_ligne_qualite_verrou_plan ON ligne_qualite;
CREATE TRIGGER trg_ligne_qualite_verrou_plan
BEFORE INSERT OR UPDATE OR DELETE ON ligne_qualite
FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_qualite_verrou_plan();

-- Le temoin.
DO $$
BEGIN
    IF to_regclass('public.of_etalon') IS NULL
       OR position('of_etalon' IN pg_get_viewdef('v_of_consommation'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-11-06c : l''etalon de l''OF n''est pas en place.';
    END IF;
END $$;

COMMIT;
