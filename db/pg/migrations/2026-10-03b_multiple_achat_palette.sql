-- =============================================================================
-- MIGRATION 2026-10-03b — l'arrondi a la palette pleine (complement de palette),
--                         AU CHOIX de l'article
--
-- « Multiple d'achat » etait un champ a saisir, rempli sur 1 reference sur 126,
-- et que personne ne comprenait. Il est remplace par une case de la fiche
-- article : « Commander par palettes entieres ».
--
--   * Cochee : le plan d'achat arrondit la quantite au nombre de palettes
--     superieur. Le poids d'une palette = poids d'une bobine x bobines par
--     palette, deux chiffres deja sur la fiche (PP FRZ-2900 : 3,15 x 240 =
--     756 kg ; 1 000 kg deviennent 2 palettes, 1 512 kg).
--   * Decochee (par defaut) : la quantite proposee n'est pas arrondie.
--
-- C'EST UNE OPTION, PAS UNE REGLE : le fournisseur change parfois le poids de
-- ses bobines, et le poids d'une palette n'est alors qu'une estimation. Ce qui
-- se commande, c'est le NOMBRE de palettes ; les kilos exacts sont ceux que la
-- reception pese.
--
-- LE COMPLEMENT DE PALETTE se lit a part : le besoin avant arrondi, puis ce qui
-- est ajoute UNIQUEMENT pour fermer la palette (besoin de 0,85 palette : le
-- complement est 0,15 palette). C'est ce que les ERP appellent un profil
-- d'arrondi ; l'acheteur voit ce qu'il commande pour produire et ce qu'il
-- commande pour la logistique.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-03b_multiple_achat_palette.sql
-- =============================================================================
BEGIN;

ALTER TABLE reference ADD COLUMN IF NOT EXISTS arrondi_palette bigint NOT NULL DEFAULT 0
    CHECK (arrondi_palette IN (0, 1));

-- Un champ non declare est masque pour tout le monde : sans ces lignes, la case
-- n'arriverait jamais a l'ecran du catalogue.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('CATALOGUE','arrondi_palette', 'Arrondi a la palette pleine', 'ECRITURE', 0, 3017),
 ('PLAN_ACHAT','complement_palette_kg', 'Complement de palette (kg)', 'LECTURE', 0, 4295)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;
-- Le complement se voit la ou se voit la quantite suggeree, ni plus ni moins.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'PLAN_ACHAT', 'complement_palette_kg',
       CASE WHEN m.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM modele_droit_champ m WHERE m.module = 'PLAN_ACHAT' AND m.champ = 'quantite_suggeree_kg'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'PLAN_ACHAT', 'complement_palette_kg',
       CASE WHEN d.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM droit_champ d WHERE d.module = 'PLAN_ACHAT' AND d.champ = 'quantite_suggeree_kg'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'CATALOGUE', 'arrondi_palette',
       CASE WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                            AND p.module = 'CATALOGUE' AND p.action = 'ECRIRE') THEN 'ECRITURE'
            WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                            AND p.module = 'CATALOGUE' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r WHERE r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'CATALOGUE' AND m.champ = 'arrondi_palette'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;


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
           -- LE MULTIPLE D'ACHAT, SEULEMENT SI L'ARTICLE LE DEMANDE (03/10/2026) :
           -- case « Commander par palettes entieres » cochee, c'est le poids
           -- d'une palette (poids d'une bobine x bobines par palette) ; sinon,
           -- aucun arrondi. Le champ saisi autrefois n'est plus lu.
           CASE WHEN r.arrondi_palette = 1 AND r.poids_bobine_kg > 0 AND r.bobines_par_palette > 0
                THEN round(r.poids_bobine_kg * r.bobines_par_palette, 4) END AS multiple_achat_kg,
           r.facteur_kg,
           r.poids_bobine_kg, r.bobines_par_palette,
           COALESCE(r.stock_min_kg, 0)                         AS stock_min_catalogue_kg,
           r.code_devise_catalogue                             AS devise,
           r.prix_catalogue_kg,
           -- LE PRIX RETENU, EN MAD : le CMUP s'il existe, sinon le catalogue
           -- converti. Inchange.
           COALESCE(r.cmup_mad, ROUND(r.prix_catalogue_kg * COALESCE(tc.taux, 1.0), 4))
                                                               AS prix_retenu_mad,
           CASE WHEN r.cmup_mad IS NOT NULL THEN 'CMUP' ELSE 'CATALOGUE' END AS source_prix,
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
           -- LE RESIDUEL NE DESCEND PAS SOUS ZERO. Un stock projete negatif dit
           -- qu'on manquera avant la livraison ; le retrancher une seconde fois
           -- — ce que faisait « stock_min - projete » — comptait le manque deux
           -- fois et gonflait la commande d'autant.
           GREATEST(0, b.stock_projete_kg)                     AS residuel_kg,
           CASE WHEN COALESCE(bh.couv_j, 0) = 0 THEN 0
                ELSE ROUND(b.sec_j * COALESCE(bh.sorties_prevues_kg, 0) / bh.couv_j, 4) END
                                                               AS securite_kg,
           COALESCE(bh.sorties_prevues_kg, 0)                  AS sorties_fenetre_kg
      FROM base b
      LEFT JOIN v_besoin_horizon bh ON bh.code_reference = b.code_reference
),
calcul AS (
    SELECT c.*,
           -- LES DEUX TERMES DU CLASSEUR, et le plus exigeant l'emporte :
           --   couvrir la fenetre de commande, securite comprise ;
           --   ou remonter au minimum de catalogue.
           GREATEST(0,
                    ROUND(c.sorties_fenetre_kg + c.securite_kg - c.residuel_kg, 4),
                    ROUND(c.stock_min_catalogue_kg - c.residuel_kg, 4))  AS besoin_net_kg
      FROM classeur c
),
moq AS (
    SELECT calcul.*,
           CASE WHEN calcul.besoin_net_kg > 0
                THEN GREATEST(calcul.besoin_net_kg, COALESCE(calcul.moq_kg, 0))
                ELSE 0.0 END                                   AS qte_avec_moq_kg
      FROM calcul
),
arrondi AS (
    SELECT moq.*,
           CASE WHEN moq.qte_avec_moq_kg <= 0 THEN 0.0
                WHEN moq.multiple_achat_kg IS NULL OR moq.multiple_achat_kg <= 0
                     THEN ROUND(moq.qte_avec_moq_kg, 4)
                ELSE ROUND(CEIL(moq.qte_avec_moq_kg / moq.multiple_achat_kg)
                           * moq.multiple_achat_kg, 4) END     AS qte_a_commander_kg
      FROM moq
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

    -- LES COLONNES DU CLASSEUR. On ne negocie pas en dirhams avec un
    -- fournisseur turc : le bon de commande se libelle dans SA devise, et le
    -- montant en MAD ne sert qu'au budget.
    devise,
    ROUND(prix_catalogue_kg, 4)                                AS prix_devise,
    ROUND(qte_a_commander_kg * prix_catalogue_kg, 2)           AS montant_devise,
    ROUND(taux, 4)                                             AS taux_devise,
    CASE WHEN poids_bobine_kg > 0 AND bobines_par_palette > 0
         THEN CEIL(qte_a_commander_kg / (poids_bobine_kg * bobines_par_palette))::bigint END
                                                               AS palettes_a_commander,

    -- LE DETAIL DU CALCUL, EXPOSE. Une quantite qu'on ne peut pas refaire de
    -- tete est une quantite qu'on n'ose pas commander.
    ROUND(sorties_fenetre_kg, 4)                               AS sorties_fenetre_kg,
    ROUND(securite_kg, 4)                                      AS securite_kg,
    ROUND(residuel_kg, 4)                                      AS residuel_kg,
    ROUND(stock_min_catalogue_kg, 4)                           AS stock_min_catalogue_kg,
    -- LE COMPLEMENT DE PALETTE (03/10/2026) : le besoin avant arrondi, et ce
    -- que l'arrondi a la palette pleine ajoute pour la seule logistique.
    ROUND(qte_avec_moq_kg, 4)                                  AS besoin_avant_arrondi_kg,
    ROUND(qte_a_commander_kg - qte_avec_moq_kg, 4)             AS complement_palette_kg
FROM arrondi a
WHERE qte_a_commander_kg > 0
ORDER BY CASE statut WHEN 'RUPTURE' THEN 1 WHEN 'CRITIQUE' THEN 2 WHEN 'ATTENTION' THEN 3 ELSE 4 END,
         qte_a_commander_kg * prix_retenu_mad DESC;

ALTER VIEW v_plan_achat OWNER TO gestionfil;

SELECT 'plan d''achat : ' || count(*) FILTER (WHERE arrondi_palette = 1)
    || ' references commandees par palettes entieres (case cochee) ; '
    || count(*) FILTER (WHERE poids_bobine_kg > 0 AND bobines_par_palette > 0)
    || ' pourraient l''etre, sur ' || count(*) AS bilan
  FROM reference WHERE actif = 1;

COMMIT;
