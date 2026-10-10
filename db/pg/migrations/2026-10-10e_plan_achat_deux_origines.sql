-- =============================================================================
-- 2026-10-10e — Le plan d'achat a deux origines qui ne se melangent plus
-- =============================================================================
-- Demande de l'utilisateur (10/10/2026) : « le plan d'achat ne doit pas
-- melanger : un plan suit le plan de production, l'autre la proposition basee
-- sur le stock minimum, sur deux onglets differents ».
--
-- AVANT : une seule quantite par reference, le plus grand de deux besoins
--   GREATEST(sorties de la fenetre + securite - residuel, minimum - residuel)
-- sans dire lequel l'avait emporte. L'acheteur ne pouvait ni justifier une
-- ligne devant la production, ni separer ce qui se commande pour produire de
-- ce qui se commande pour se proteger.
--
-- APRES, deux propositions independantes par reference :
--   * PLAN (plan de production) : sorties de la fenetre de commande + securite
--     - residuel, au minimum de commande et a la palette ;
--   * STOCK_MIN (stock minimum) : ce qui manque ENCORE pour remonter au
--     minimum du catalogue une fois la proposition du plan livree,
--     minimum - residuel - quantite du plan, au minimum de commande et a la
--     palette. Jamais de double compte : une reference que le plan suffit a
--     remonter au minimum n'a pas de proposition « stock minimum ».
-- `qte_a_commander_kg` devient leur somme : les vues qui en dependent (cockpit,
-- risques, briefing) lisent toujours une ligne par reference.
--
-- Chaque proposition enregistree (plan_achat) porte son origine ; un bon genere
-- ne melange pas les deux (motif MRP ou STOCK_MIN).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- --- 1. L'origine d'une proposition -------------------------------------------
ALTER TABLE plan_achat ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'PLAN';
ALTER TABLE plan_achat DROP CONSTRAINT IF EXISTS plan_achat_origine_check;
ALTER TABLE plan_achat ADD CONSTRAINT plan_achat_origine_check CHECK (origine IN ('PLAN', 'STOCK_MIN'));

-- Une proposition ouverte par reference ET par origine.
DROP INDEX IF EXISTS ux_plan_achat_ouvert;
CREATE UNIQUE INDEX ux_plan_achat_ouvert ON plan_achat (code_reference, origine)
 WHERE statut IN ('PROPOSE', 'EN_REVISION', 'VALIDE');

-- --- 2. Le motif d'un bon : le stock minimum a le sien --------------------------
ALTER TABLE bon_commande DROP CONSTRAINT IF EXISTS bon_commande_motif_creation_check;
ALTER TABLE bon_commande ADD CONSTRAINT bon_commande_motif_creation_check
    CHECK (motif_creation = ANY (ARRAY['MRP', 'STOCK_MIN', 'OPPORTUNITE_PRIX', 'ANTICIPATION_RISQUE', 'MANUEL']));

-- --- 3. La vue : deux quantites, et leur somme ----------------------------------
CREATE OR REPLACE VIEW v_plan_achat AS
WITH p AS (
    SELECT
      (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_SecuriteA')  AS sec_a,
      (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_SecuriteB')  AS sec_b,
      (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_SecuriteC')  AS sec_c,
      (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_SeuilTier1') AS tier1,
      (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_SeuilTier2') AS tier2,
      (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_SeuilTier3') AS tier3
),
base AS (
    SELECT sp.*,
           r.moq_kg,
           CASE WHEN r.arrondi_palette = 1 AND r.poids_bobine_kg > 0 AND r.bobines_par_palette > 0
                THEN round(r.poids_bobine_kg * r.bobines_par_palette, 4) END AS multiple_achat_kg,
           r.facteur_kg,
           r.poids_bobine_kg, r.bobines_par_palette,
           COALESCE(r.stock_min_kg, 0)                         AS stock_min_catalogue_kg,
           r.code_devise_catalogue                             AS devise,
           r.prix_catalogue_kg,
           -- LE PRIX D'UNE PROPOSITION (regle 8, 09/10/2026) : dernier prix d'achat,
           -- sinon catalogue converti, sinon CMUP.
           COALESCE(fn_dernier_prix_achat_mad(r.code_reference, r.code_fournisseur),
                    round(r.prix_catalogue_kg * tc.taux, 4), r.cmup_mad) AS prix_retenu_mad,
           CASE WHEN fn_dernier_prix_achat_mad(r.code_reference, r.code_fournisseur) IS NOT NULL THEN 'DERNIER_ACHAT'
                WHEN r.prix_catalogue_kg IS NOT NULL AND tc.taux IS NOT NULL THEN 'CATALOGUE'
                WHEN r.cmup_mad IS NOT NULL THEN 'CMUP'
                ELSE 'AUCUN' END                               AS source_prix,
           COALESCE(tc.taux, 1.0)                              AS taux,
           CASE sp.classe_abc WHEN 'A' THEN p.sec_a WHEN 'B' THEN p.sec_b ELSE p.sec_c END AS sec_j,
           p.tier1, p.tier2, p.tier3
      FROM v_stock_projete sp
      JOIN reference r ON r.code_reference = sp.code_reference
      LEFT JOIN taux_change tc
             ON tc.code_devise = r.code_devise_catalogue
            AND to_char(current_date, 'YYYY-MM-DD') >= substr(tc.date_debut, 1, 10)
            AND (tc.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(tc.date_fin, 1, 10))
      CROSS JOIN p
),
classeur AS (
    SELECT b.*,
           GREATEST(0, b.stock_projete_kg)                     AS residuel_kg,
           CASE WHEN COALESCE(bh.couv_j, 0) = 0 THEN 0
                ELSE ROUND(b.sec_j * COALESCE(bh.sorties_prevues_kg, 0) / bh.couv_j, 4) END
                                                               AS securite_kg,
           COALESCE(bh.sorties_prevues_kg, 0)                  AS sorties_fenetre_kg
      FROM base b
      LEFT JOIN v_besoin_horizon bh ON bh.code_reference = b.code_reference
),
-- LE BESOIN DU PLAN DE PRODUCTION : couvrir la fenetre de commande, securite comprise.
plan AS (
    SELECT c.*,
           GREATEST(0, ROUND(c.sorties_fenetre_kg + c.securite_kg - c.residuel_kg, 4)) AS besoin_plan_kg
      FROM classeur c
),
plan_arrondi AS (
    SELECT x.*,
           CASE WHEN x.plan_moq_kg <= 0 THEN 0.0
                WHEN x.multiple_achat_kg IS NULL OR x.multiple_achat_kg <= 0 THEN ROUND(x.plan_moq_kg, 4)
                ELSE ROUND(CEIL(x.plan_moq_kg / x.multiple_achat_kg) * x.multiple_achat_kg, 4) END AS qte_plan_kg
      FROM (SELECT plan.*,
                   CASE WHEN plan.besoin_plan_kg > 0
                        THEN GREATEST(plan.besoin_plan_kg, COALESCE(plan.moq_kg, 0)) ELSE 0.0 END AS plan_moq_kg
              FROM plan) x
),
-- LE BESOIN DU STOCK MINIMUM : ce qui manque encore au minimum, la proposition du plan livree.
minimum AS (
    SELECT pa.*,
           GREATEST(0, ROUND(pa.stock_min_catalogue_kg - pa.residuel_kg - pa.qte_plan_kg, 4)) AS besoin_min_kg
      FROM plan_arrondi pa
),
arrondi AS (
    SELECT y.*,
           CASE WHEN y.min_moq_kg <= 0 THEN 0.0
                WHEN y.multiple_achat_kg IS NULL OR y.multiple_achat_kg <= 0 THEN ROUND(y.min_moq_kg, 4)
                ELSE ROUND(CEIL(y.min_moq_kg / y.multiple_achat_kg) * y.multiple_achat_kg, 4) END AS qte_min_kg,
           y.plan_moq_kg + y.min_moq_kg                        AS qte_avec_moq_kg
      FROM (SELECT minimum.*,
                   CASE WHEN minimum.besoin_min_kg > 0
                        THEN GREATEST(minimum.besoin_min_kg, COALESCE(minimum.moq_kg, 0)) ELSE 0.0 END AS min_moq_kg
              FROM minimum) y
),
total AS (
    SELECT arrondi.*, arrondi.qte_plan_kg + arrondi.qte_min_kg AS qte_a_commander_kg FROM arrondi
)
SELECT
    code_reference, designation, code_fournisseur, fournisseur_nom, fournisseur_pays,
    delai_livraison_jours, classe_abc, classe_xyz, unite_catalogue,
    stock_mrp_kg, encours_kg, besoin_12m_kg, stock_projete_kg, jours_couverture,
    conso_mensuelle_kg, source_conso, statut, stock_min_kg,
    qte_a_commander_kg,
    CASE WHEN facteur_kg > 0 THEN ROUND(qte_a_commander_kg / facteur_kg, 4) END
                                                               AS qte_a_commander_unite,
    prix_retenu_mad                                            AS prix_estime_mad,
    source_prix,
    ROUND(qte_a_commander_kg * prix_retenu_mad, 2)             AS montant_estime_mad,
    CASE
        WHEN statut = 'RUPTURE' THEN 'TIER 1'
        WHEN classe_abc = 'A' AND qte_a_commander_kg * prix_retenu_mad >= tier1 THEN 'TIER 1'
        WHEN qte_a_commander_kg * prix_retenu_mad >= tier2 THEN 'TIER 2'
        WHEN qte_a_commander_kg * prix_retenu_mad >= tier3 THEN 'TIER 3'
        ELSE 'TIER 4'
    END                                                        AS tier,
    CASE WHEN (SELECT COUNT(*) FROM reference_groupe_equiv rge1
                 JOIN reference_groupe_equiv rge2
                   ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                  AND rge2.code_reference <> rge1.code_reference AND rge2.actif = 1
                 JOIN reference r2 ON r2.code_reference = rge2.code_reference AND r2.actif = 1
                 JOIN reference r1 ON r1.code_reference = rge1.code_reference
                WHERE rge1.code_reference = a.code_reference AND rge1.actif = 1
                  AND r2.code_fournisseur IS DISTINCT FROM r1.code_fournisseur) > 0
         THEN 'MULTI-SOURCE' ELSE 'MONO-SOURCE' END            AS risque_sourcing,
    to_char((current_date + delai_livraison_jours::integer)::timestamptz, 'YYYY-MM-DD')
                                                               AS date_besoin_prevue,
    devise,
    ROUND(prix_catalogue_kg, 4)                                AS prix_devise,
    ROUND(qte_a_commander_kg * prix_catalogue_kg, 2)           AS montant_devise,
    ROUND(taux, 4)                                             AS taux_devise,
    CASE WHEN poids_bobine_kg > 0 AND bobines_par_palette > 0
         THEN CEIL(qte_a_commander_kg / (poids_bobine_kg * bobines_par_palette))::bigint END
                                                               AS palettes_a_commander,
    ROUND(sorties_fenetre_kg, 4)                               AS sorties_fenetre_kg,
    ROUND(securite_kg, 4)                                      AS securite_kg,
    ROUND(residuel_kg, 4)                                      AS residuel_kg,
    ROUND(stock_min_catalogue_kg, 4)                           AS stock_min_catalogue_kg,
    ROUND(qte_avec_moq_kg, 4)                                  AS besoin_avant_arrondi_kg,
    ROUND(qte_a_commander_kg - qte_avec_moq_kg, 4)             AS complement_palette_kg,
    -- LES DEUX ORIGINES (10/10/2026), chacune avec son besoin brut et sa quantite.
    ROUND(besoin_plan_kg, 4)                                   AS besoin_plan_kg,
    ROUND(qte_plan_kg, 4)                                      AS qte_plan_kg,
    ROUND(besoin_min_kg, 4)                                    AS besoin_stock_min_kg,
    ROUND(qte_min_kg, 4)                                       AS qte_stock_min_kg,
    facteur_kg,
    CASE WHEN poids_bobine_kg > 0 AND bobines_par_palette > 0
         THEN round(poids_bobine_kg * bobines_par_palette, 4) END AS poids_palette_kg
FROM total a
WHERE qte_a_commander_kg > 0
ORDER BY CASE statut WHEN 'RUPTURE' THEN 1 WHEN 'CRITIQUE' THEN 2 WHEN 'ATTENTION' THEN 3 ELSE 4 END,
         qte_a_commander_kg * prix_retenu_mad DESC;
ALTER VIEW v_plan_achat OWNER TO gestionfil;

-- --- 4. Les champs nouveaux se declarent, sinon ils restent masques -------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('PLAN_ACHAT', 'origine',             'Origine du besoin',              'LECTURE', 0, 12),
 ('PLAN_ACHAT', 'besoin_plan_kg',      'Besoin du plan de production (kg)', 'LECTURE', 0, 4300),
 ('PLAN_ACHAT', 'qte_plan_kg',         'À commander pour le plan (kg)',  'LECTURE', 0, 4310),
 ('PLAN_ACHAT', 'besoin_stock_min_kg', 'Manque au stock minimum (kg)',   'LECTURE', 0, 4320),
 ('PLAN_ACHAT', 'qte_stock_min_kg',    'À commander pour le minimum (kg)', 'LECTURE', 0, 4330)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;
-- Ils se voient la ou se voit la quantite suggeree, ni plus ni moins.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'PLAN_ACHAT', c.champ, CASE WHEN m.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM modele_droit_champ m
 CROSS JOIN (VALUES ('origine'), ('besoin_plan_kg'), ('qte_plan_kg'), ('besoin_stock_min_kg'), ('qte_stock_min_kg')) c(champ)
 WHERE m.module = 'PLAN_ACHAT' AND m.champ = 'quantite_suggeree_kg'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'PLAN_ACHAT', c.champ, CASE WHEN d.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM droit_champ d
 CROSS JOIN (VALUES ('origine'), ('besoin_plan_kg'), ('qte_plan_kg'), ('besoin_stock_min_kg'), ('qte_stock_min_kg')) c(champ)
 WHERE d.module = 'PLAN_ACHAT' AND d.champ = 'quantite_suggeree_kg'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
