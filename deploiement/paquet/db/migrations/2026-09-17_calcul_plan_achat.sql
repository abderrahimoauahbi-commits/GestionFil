-- ===========================================================================
-- DEUX REGLES DU PLAN D'ACHAT QUI FAISAIENT SURCOMMANDER
--
-- Verifiees le 17 septembre 2026 sur une copie de la base propre : un scenario
-- de cinq references aux chiffres connus, recalcule en Python a partir des
-- regles metier, confronte aux vues. L'ERP etait FIDELE a ses formules — chaque
-- valeur intermediaire tombait juste. Ce sont deux formules qui etaient fausses.
--
-- 1. L'HORIZON DU BESOIN (v_besoin_12m). Le stock projete retranchait tout le
--    plan, mois passes compris, alors que le stock physique avait deja perdu
--    ces mois-la. Plan d'avril 2026 a mars 2027, 1 000 kg/mois, 3 000 kg en
--    stock : 11 600 kg proposes au lieu de 6 600. Surcommande de 5 000 kg, qui
--    grossit d'un mois de consommation chaque mois.
--
-- 2. L'ARRONDI AU MULTIPLE (v_plan_achat). Un multiple de trop pres d'une fois
--    sur deux : 1 600 kg au multiple de 1 000 donnaient 3 000 kg.
--
-- Colonnes inchangees : les six vues qui en dependent — stock projete,
-- consommation retenue, equivalences, cockpit — suivent sans etre recreees.
-- La migration se rejoue sans effet de bord.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE VIEW v_besoin_12m AS
-- -----------------------------------------------------------------------------
-- CE QUI RESTE A CONSOMMER, PAS CE QUE LE PLAN PREVOYAIT EN TOUT.
--
-- La vue sommait TOUS les mois du plan, passes compris. Or le stock projete
-- s'ecrit « physique + en-cours - besoin » : le physique a DEJA perdu ce que
-- les mois passes ont consomme. Ces mois etaient donc retires deux fois — une
-- fois du stock par les sorties reelles, une seconde fois par le plan.
--
-- Mesure sur la base de verification (17/09/2026) : plan d'avril 2026 a mars
-- 2027, 1 000 kg par mois, 3 000 kg en stock. Le plan d'achat proposait
-- 11 600 kg ; le besoin reel en appelait 6 600. SURCOMMANDE : 5 000 kg, soit
-- exactement les cinq mois deja ecoules — et l'ecart grossit d'un mois de
-- consommation a chaque mois qui passe, jusqu'a la fin du plan.
--
-- On ne retient donc que le MOIS COURANT ET LES SUIVANTS. Le mois courant
-- reste compte en entier : il n'est pas encore consomme, et le retirer serait
-- l'erreur inverse — une rupture en fin de mois.
-- -----------------------------------------------------------------------------
WITH horizon AS (
    -- Nombre de mois REELLEMENT couverts par chaque plan. C'est le plan qui
    -- donne le denominateur, jamais une constante : un plan de six mois divise
    -- par six. Diviser par douze halvait la consommation mensuelle, doublait la
    -- couverture affichee, et retardait d'autant le declenchement des alertes
    -- — verifie : facteur exactement 2,0 sur un plan de six mois.
    --
    -- Le denominateur suit le meme horizon que le numerateur : les mois RESTANTS.
    -- Diviser le reste du plan par ses douze mois d'origine ferait fondre la
    -- consommation mensuelle au fil de l'annee.
    SELECT id_plan, COUNT(DISTINCT annee_mois) AS mois
      FROM besoin_mrp
     WHERE annee_mois >= to_char(current_date, 'YYYY-MM')
     GROUP BY id_plan
)
SELECT
    bm.code_reference,
    ROUND(SUM(bm.quantite_kg), 4)                  AS besoin_12m_kg,
    -- LE DENOMINATEUR EST UN CHOIX, PLUS UN HASARD.
    --
    -- `h.mois` vient de la CTE `horizon`, une ligne par plan ; le groupe, lui,
    -- est par reference. SQLite acceptait la colonne nue et prenait la valeur
    -- d'une ligne au hasard. RG-10 garantit qu'un seul plan est EN_COURS a la
    -- fois, donc il n'y avait en pratique qu'une valeur — mais rien ne le
    -- disait, et un jour ou l'invariant casserait, le chiffre aurait change
    -- sans prevenir.
    --
    -- On prend le MINIMUM, et c'est la direction prudente : un horizon plus
    -- court donne un besoin mensuel PLUS ELEVE, donc une couverture plus faible
    -- et des alertes plus tot. L'erreur inverse — diviser par douze quand le
    -- plan couvrait six mois — avait deja ete corrigee ici meme, elle halvait
    -- la consommation et retardait les alertes d'autant.
    ROUND(SUM(bm.quantite_kg)
          / CASE WHEN MIN(h.mois) > 0 THEN MIN(h.mois) ELSE 1 END, 4)
                                                   AS besoin_mensuel_moyen_kg
FROM besoin_mrp bm
JOIN plan_production pp ON pp.id_plan = bm.id_plan
JOIN horizon h          ON h.id_plan  = bm.id_plan
WHERE pp.statut = 'EN_COURS'
  AND to_char(current_date, 'YYYY-MM-DD') BETWEEN pp.date_debut AND pp.date_fin
  AND bm.annee_mois >= to_char(current_date, 'YYYY-MM')
GROUP BY bm.code_reference;

CREATE OR REPLACE VIEW v_plan_achat AS
WITH base AS (
    SELECT
        -- `smd.stock_min_kg` etait cite ici EN PLUS de `sp.*`, qui l'expose
        -- deja : la CTE produisait donc DEUX colonnes du meme nom. SQLite
        -- l'accepte et resout `a.stock_min_kg` sur la premiere venue ;
        -- PostgreSQL refuse, et c'est ce refus qui a revele le doublon.
        --
        -- Verifie avant de corriger : `v_stock_projete.stock_min_kg` vient
        -- lui-meme de `v_stock_min_dynamique`, et les deux colonnes sont
        -- identiques sur les 124 references. Aucun chiffre n'etait donc faux
        -- — mais la vue promettait la formule dynamique en s'en remettant a
        -- l'ordre des colonnes pour l'obtenir.
        sp.*,
        r.moq_kg,
        r.multiple_achat_kg,
        r.facteur_kg,
        -- Prix retenu et sa provenance
        COALESCE(r.cmup_mad, ROUND(r.prix_catalogue_kg * COALESCE(tc.taux, 1.0), 4)) AS prix_retenu_mad,
        CASE WHEN r.cmup_mad IS NOT NULL THEN 'CMUP' ELSE 'CATALOGUE' END            AS source_prix,
        -- Besoin net avant MOQ / multiple
        GREATEST(0.0, ROUND(smd.stock_min_kg - sp.stock_projete_kg, 4))                   AS besoin_net_kg
    FROM v_stock_projete       sp
    JOIN reference              r   ON r.code_reference = sp.code_reference
    JOIN v_stock_min_dynamique smd  ON smd.code_reference = sp.code_reference
    LEFT JOIN taux_change      tc   ON tc.code_devise = r.code_devise_catalogue
                                   AND to_char(current_date, 'YYYY-MM-DD') >= substr(tc.date_debut, 1, 10)
                                   AND (tc.date_fin IS NULL OR to_char(current_date, 'YYYY-MM-DD') < substr(tc.date_fin, 1, 10))
), calcul AS (
    SELECT
        base.*,
        -- MOQ applique seulement s'il y a quelque chose a commander
        CASE WHEN besoin_net_kg > 0
             THEN GREATEST(besoin_net_kg, COALESCE(moq_kg, 0))
             ELSE 0.0 END AS qte_avec_moq_kg
    FROM base
), arrondi AS (
    SELECT
        calcul.*,
        CASE
            WHEN qte_avec_moq_kg <= 0 THEN 0.0
            WHEN multiple_achat_kg IS NULL OR multiple_achat_kg <= 0 THEN ROUND(qte_avec_moq_kg, 4)
            -- L'ARRONDI AU MULTIPLE SUPERIEUR, VRAIMENT. La formule precedente
            -- — `CAST((q + m - 0,0001) / m AS bigint)` — supposait qu'une
            -- conversion en entier TRONQUE. PostgreSQL ARRONDIT. Le resultat
            -- commandait un multiple de trop dans pres d'un cas sur deux :
            -- 1 600 kg au multiple de 1 000 donnaient 3 000 kg au lieu de 2 000,
            -- et un besoin tombant pile sur un multiple en ajoutait un entier.
            -- Mesure le 17/09/2026. `CEIL` dit exactement ce qu'on veut dire.
            ELSE ROUND(CEIL(qte_avec_moq_kg / multiple_achat_kg) * multiple_achat_kg, 4)
        END AS qte_a_commander_kg
    FROM calcul
)
SELECT
    a.code_reference,
    a.designation,
    a.code_fournisseur,
    a.fournisseur_nom,
    a.fournisseur_pays,
    a.delai_livraison_jours,
    a.classe_abc,
    a.classe_xyz,
    a.unite_catalogue,
    a.stock_mrp_kg,
    a.encours_kg,
    a.besoin_12m_kg,
    a.stock_projete_kg,
    a.jours_couverture,
    a.conso_mensuelle_kg,
    a.source_conso,
    a.statut,
    a.stock_min_kg,
    a.qte_a_commander_kg,
    CASE WHEN a.facteur_kg > 0 THEN ROUND(a.qte_a_commander_kg / a.facteur_kg, 4) END AS qte_a_commander_unite,
    a.prix_retenu_mad                                        AS prix_estime_mad,
    a.source_prix,
    ROUND(a.qte_a_commander_kg * a.prix_retenu_mad, 2)       AS montant_estime_mad,

    -- Tiering F7, calcule sur le montant reellement commande
    CASE
        WHEN a.statut = 'RUPTURE' THEN 'TIER 1'
        WHEN a.classe_abc = 'A'
         AND a.qte_a_commander_kg * a.prix_retenu_mad >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_SeuilTier1') THEN 'TIER 1'
        WHEN a.qte_a_commander_kg * a.prix_retenu_mad >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_SeuilTier2') THEN 'TIER 2'
        WHEN a.qte_a_commander_kg * a.prix_retenu_mad >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_SeuilTier3') THEN 'TIER 3'
        ELSE 'TIER 4'
    END AS tier,

    -- Sourcing : nombre d'alternatives ACTIVES et en cours de validite
    -- MULTI-SOURCE exige un autre FOURNISSEUR, pas seulement une autre
    -- reference. Deux articles equivalents achetes a la meme maison tombent
    -- ensemble : compter les references faisait passer ce cas pour une securite
    -- d'approvisionnement, et le plan d'achat s'y fiait.
    CASE WHEN (
        SELECT COUNT(*)
        FROM reference_groupe_equiv rge1
        JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                        AND rge2.code_reference   <> rge1.code_reference
                                        AND rge2.actif = 1
        JOIN reference r2 ON r2.code_reference = rge2.code_reference AND r2.actif = 1
        JOIN reference r1 ON r1.code_reference = rge1.code_reference
        WHERE rge1.code_reference = a.code_reference AND rge1.actif = 1
          AND r2.code_fournisseur IS DISTINCT FROM r1.code_fournisseur
    ) > 0 THEN 'MULTI-SOURCE' ELSE 'MONO-SOURCE' END AS risque_sourcing,

    to_char(current_date + (a.delai_livraison_jours)::integer, 'YYYY-MM-DD') AS date_besoin_prevue
FROM arrondi a
WHERE a.qte_a_commander_kg > 0
ORDER BY
    CASE a.statut WHEN 'RUPTURE' THEN 1 WHEN 'CRITIQUE' THEN 2 WHEN 'ATTENTION' THEN 3 ELSE 4 END,
    a.qte_a_commander_kg * a.prix_retenu_mad DESC;

COMMIT;
