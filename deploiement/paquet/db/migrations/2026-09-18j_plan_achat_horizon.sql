-- ==========================================================================
-- MIGRATION 2026-09-18j — LE PLAN D'ACHAT RETROUVE L'HORIZON DU CLASSEUR
-- --------------------------------------------------------------------------
-- CONSTAT DU 18/09/2026, chiffre sur les donnees reelles :
--
--     l'ERP proposait  2 360 747 kg pour 47 773 990 MAD
--     le classeur en propose   755 300 kg pour 16 117 878 MAD
--
-- Trois fois trop, soit 31,7 MILLIONS DE DIRHAMS de sur-commande.
--
-- LA CAUSE TIENT EN UN MOT : L'HORIZON.
--
-- L'ERP projetait le stock ainsi :
--     physique + en-cours - BESOINS DES DOUZE MOIS
-- Le classeur ainsi :
--     physique + en-cours - demande PENDANT LE DELAI D'APPROVISIONNEMENT
--
-- Ce ne sont pas deux approximations de la meme chose, ce sont deux questions
-- differentes. La premiere demande « mon stock couvre-t-il l'annee ? » — et la
-- reponse est NON pour toute matiere qu'on rachete regulierement, ce qui est le
-- propre d'une matiere premiere. La seconde demande « quand ma commande
-- arrivera, me restera-t-il quelque chose ? » : c'est elle qui declenche un
-- reapprovisionnement, et c'est elle que tous les ERP retiennent.
--
-- Avec la premiere, 71 references sur 125 s'affichaient en RUPTURE alors que le
-- magasin porte 251 tonnes. L'alerte etait devenue du bruit.
--
-- LA QUANTITE A COMMANDER RETROUVE SES DEUX TERMES. Le classeur ecrit :
--
--     resid = MAX(0 ; stock projete)
--     secu  = securite(ABC) x sorties prevues / couverture
--     Qte   = MAX(0 ; sorties prevues + secu - resid ; stock min - resid)
--
-- L'ERP n'en gardait QUE LE SECOND terme (stock min - projete), et sans le
-- MAX(0 ; ...) sur le projete : un stock projete negatif venait donc s'ajouter
-- au minimum au lieu d'etre ramene a zero. Le premier terme — couvrir la
-- demande de la fenetre de commande, securite comprise — n'existait pas.
--
-- LA COUVERTURE DE COMMANDE ENTRE DANS LE REFERENTIEL. Le classeur la porte par
-- fournisseur (« Couverture commande (j) ») : c'est la duree qu'une commande
-- doit couvrir une fois livree. HASIRCI TEXTILE commande par 60 jours ; a
-- defaut, P_MargeJours (30 j).
--
-- LES COLONNES DU CLASSEUR ARRIVENT AU PLAN : prix en devise, devise, montant
-- en devise, palettes a commander. Le tier et le risque de sourcing y etaient
-- deja.
--
-- Rejouable : ALTER ... IF NOT EXISTS et CREATE OR REPLACE.
-- ==========================================================================

BEGIN;

-- --------------------------------------- 1. LA COUVERTURE DE COMMANDE
ALTER TABLE fournisseur ADD COLUMN IF NOT EXISTS couverture_commande_j bigint;

COMMENT ON COLUMN fournisseur.couverture_commande_j IS
  'Duree qu''une commande doit couvrir une fois livree, en jours. Vide = P_MargeJours.';

UPDATE fournisseur SET couverture_commande_j = 60
 WHERE nom = 'HASIRCI TEXTILE' AND couverture_commande_j IS DISTINCT FROM 60;

-- ------------------------------ 1bis. LES PROPOSITIONS PORTENT LA DEVISE
-- Une proposition est une PHOTO du calcul, prise au moment ou on la genere :
-- elle doit donc porter elle-meme ce qu'on ira negocier, et non le rechercher
-- plus tard dans un catalogue qui aura bouge.
ALTER TABLE plan_achat
  ADD COLUMN IF NOT EXISTS code_devise          text,
  ADD COLUMN IF NOT EXISTS prix_devise          numeric,
  ADD COLUMN IF NOT EXISTS montant_devise       numeric,
  ADD COLUMN IF NOT EXISTS taux_devise          numeric,
  ADD COLUMN IF NOT EXISTS palettes_a_commander bigint;

COMMENT ON COLUMN plan_achat.prix_devise IS
  'Prix unitaire dans la devise du catalogue. On ne negocie pas en dirhams avec un fournisseur turc.';

-- Les propositions deja ouvertes retrouvent leur devise : sans cela, elles
-- resteraient muettes jusqu'a la prochaine generation.
UPDATE plan_achat pa
   SET code_devise    = r.code_devise_catalogue,
       prix_devise    = ROUND(r.prix_catalogue_kg, 4),
       montant_devise = ROUND(pa.quantite_suggeree_kg * r.prix_catalogue_kg, 2),
       palettes_a_commander =
           CASE WHEN r.poids_bobine_kg > 0 AND r.bobines_par_palette > 0
                THEN CEIL(pa.quantite_suggeree_kg / (r.poids_bobine_kg * r.bobines_par_palette))::bigint END
  FROM reference r
 WHERE r.code_reference = pa.code_reference
   AND pa.code_devise IS NULL;

-- ------------------------------------------- 2. L'HORIZON, UNE VUE A PART
-- Deux fenetres glissantes sur les douze mois du MRP :
--
--   * [0 ; L]     ce qui sera consomme AVANT que la commande n'arrive ;
--   * [L ; L+R]   ce que la commande devra couvrir une fois arrivee.
--
-- Le poids d'un mois est la part de ce mois qui tombe dans la fenetre. Un mois
-- vaut trente jours : c'est la convention du classeur, et elle evite de faire
-- dependre un plan d'achat de la longueur de fevrier.
CREATE OR REPLACE VIEW v_besoin_horizon AS
WITH p AS (
    SELECT
      (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_DelaiDefaut') AS delai_defaut,
      (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_MargeJours')  AS marge_jours
),
mois AS (
    SELECT i, to_char(date_trunc('month', current_date) + ((i - 1) || ' month')::interval,
                      'YYYY-MM') AS annee_mois
      FROM generate_series(1, 12) i
),
fenetre AS (
    SELECT r.code_reference,
           COALESCE(f.delai_livraison_jours::numeric, p.delai_defaut) AS lead_j,
           COALESCE(f.couverture_commande_j::numeric, p.marge_jours)  AS couv_j
      FROM reference r
      LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
      CROSS JOIN p
)
SELECT w.code_reference,
       w.lead_j,
       w.couv_j,
       ROUND(COALESCE(SUM(bm.quantite_kg
             * GREATEST(0, LEAST(m.i * 30.0, w.lead_j) - (m.i - 1) * 30.0) / 30.0), 0), 4)
                                                                     AS dem_lead_kg,
       ROUND(COALESCE(SUM(bm.quantite_kg
             * GREATEST(0, LEAST(m.i * 30.0, w.lead_j + w.couv_j)
                         - GREATEST((m.i - 1) * 30.0, w.lead_j)) / 30.0), 0), 4)
                                                                     AS sorties_prevues_kg
  FROM fenetre w
  CROSS JOIN mois m
  LEFT JOIN besoin_mrp bm ON bm.code_reference = w.code_reference AND bm.annee_mois = m.annee_mois
 GROUP BY w.code_reference, w.lead_j, w.couv_j;

ALTER VIEW v_besoin_horizon OWNER TO gestionfil;

-- ------------------------------ 3. LA PROJECTION CHANGE D'HORIZON
CREATE OR REPLACE VIEW v_stock_projete AS
SELECT
    r.code_reference,
    r.designation,
    r.code_fournisseur,
    f.nom                                   AS fournisseur_nom,
    f.pays                                  AS fournisseur_pays,
    COALESCE(f.delai_livraison_jours, CAST(p_delai.v AS bigint)) AS delai_livraison_jours,
    r.classe_abc,
    r.classe_xyz,
    r.unite_catalogue,
    r.cmup_mad,

    sd.stock_mrp_kg,
    sd.stock_total_kg,
    sd.valeur_totale_mad,

    -- --- REALITE PHYSIQUE ---------------------------------------------------
    ph.stock_physique_net_kg,
    ph.stock_quarantaine_kg,
    ph.stock_reserve_kg,

    -- --- EN-COURS : ce qu'on attend, et ce qu'on n'attend plus --------------
    COALESCE(ef.encours_fiable_kg, 0)       AS encours_kg,
    COALESCE(ef.encours_retarde_kg, 0)      AS encours_retarde_kg,
    COALESCE(ef.nb_lignes_retardees, 0)     AS nb_lignes_retardees,
    ef.retard_max_jours,
    COALESCE(b.besoin_12m_kg, 0)            AS besoin_12m_kg,

    -- Projection = stock utilisable + en-cours FIABLE - besoins. Une commande
    -- en retard au-dela de la tolerance ne compte plus : le retard reel annule
    -- la prevision au lieu de la prolonger.
    ROUND(ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0), 4)                          AS stock_projete_kg,

    cr.conso_mensuelle_kg,
    cr.source_conso,
    CASE WHEN COALESCE(cr.conso_mensuelle_kg, 0) > 0
         THEN ROUND((ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0)) / (cr.conso_mensuelle_kg / 30.0), 1)
    END                                     AS jours_couverture,

    -- Les deux bornes de l'echelle logique, exposees telles quelles. L'ecran en
    -- a besoin pour graduer la jauge de couverture. Sans elles il ecrirait 60 et
    -- 90 en dur, et la jauge cesserait de suivre le parametre le jour ou la
    -- direction le deplace : le chiffre changerait de statut, la barre non.
    CAST(p_crit.v   AS numeric)                AS seuil_critique_jours,
    CAST(p_alerte.v AS numeric)                AS seuil_alerte_jours,

    -- Le minimum recalcule (F3, MAX de quatre securites) : c'est LUI le seuil
    -- du veto physique, et non un plancher absolu en kilos. La difference n'est
    -- pas cosmetique — le minimum se parametre par reference, un plancher global
    -- traite pareil un fil livre en huit jours et un autre en trois mois.
    sm.stock_min_kg,
    sm.terme2_couverture_kg,

    -- Le maximum : au-dela, le stock immobilise du capital sans servir la
    -- couverture. Plancher a une fois et demie le minimum, majore d'un mois de
    -- consommation supplementaire (P_MargeJours).
    ROUND(GREATEST(sm.stock_min_kg * 1.5, sm.stock_min_kg + COALESCE(cr.conso_mensuelle_kg, 0)
                                * CAST(p_marge.v AS numeric) / 30.0), 4)   AS stock_max_kg,

    -- --- DECLENCHEUR A : la logique, en jours de couverture ----------------
    -- Echelle 60 / 90 jours. Elle ne juge PAS le stock d'aujourd'hui mais ce
    -- qu'il devient une fois les besoins de l'horizon retranches et les
    -- commandes fiables ajoutees.
    CASE
        -- Ni consommation, ni besoin planifie : personne ne demande cette
        -- reference. Un stock nul n'y est pas une rupture mais une reference
        -- inutilisee, et la compter en rupture noie les vraies sous des fausses.
        -- Ce test doit preceder celui du stock : teste apres, il ne sert jamais,
        -- car un stock nul est deja tombe dans RUPTURE.
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) = 0
         AND COALESCE(b.besoin_12m_kg, 0) = 0 THEN 'OK'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0)) <= 0 THEN 'RUPTURE'
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) = 0 THEN 'OK'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0))
             / (cr.conso_mensuelle_kg / 30.0) < CAST(p_crit.v AS numeric)  THEN 'CRITIQUE'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0))
             / (cr.conso_mensuelle_kg / 30.0) < CAST(p_alerte.v AS numeric) THEN 'ATTENTION'
        ELSE 'OK'
    END                                     AS statut_logique,

    -- --- DECLENCHEUR B : le veto physique ----------------------------------
    -- Aucun raisonnement : ce qu'il y a dans les allees, maintenant, compare au
    -- minimum recalcule. Une reference que personne ne demande n'a pas de seuil.
    CASE
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) = 0
         AND COALESCE(b.besoin_12m_kg, 0) = 0 THEN 'OK'
        WHEN ph.stock_physique_net_kg <= 0 THEN 'RUPTURE'
        WHEN COALESCE(sm.stock_min_kg, 0) > 0
         AND ph.stock_physique_net_kg < sm.stock_min_kg THEN 'CRITIQUE'
        ELSE 'OK'
    END                                     AS statut_physique,

    -- --- STATUT FINAL : le PIRE des deux -----------------------------------
    -- Jamais la moyenne, jamais le plus optimiste. Une alerte qui s'adoucit
    -- parce que l'autre moitie du calcul va bien se lit comme un feu vert.
    --
    -- Le SUR-STOCK n'y figure PAS. Simule sur les donnees reelles, le placer
    -- dans cette echelle interceptait 72 references sur 124 et eteignait la
    -- couche logique : 31 d'entre elles passaient sous 90 jours de couverture
    -- tout en affichant « suspendre la prochaine commande ». Le sur-stock ne
    -- mesure pas un risque de manquer, il mesure du capital immobilise : c'est
    -- un SECOND AXE, porte par le drapeau ci-dessous.
    CASE
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) = 0
         AND COALESCE(b.besoin_12m_kg, 0) = 0 THEN 'OK'
        WHEN ph.stock_physique_net_kg <= 0
          OR (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0)) <= 0 THEN 'RUPTURE'
        -- Le veto physique s'impose ici, avant l'echelle logique.
        WHEN COALESCE(sm.stock_min_kg, 0) > 0
         AND ph.stock_physique_net_kg < sm.stock_min_kg THEN 'CRITIQUE'
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) = 0 THEN 'OK'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0))
             / (cr.conso_mensuelle_kg / 30.0) < CAST(p_crit.v AS numeric)  THEN 'CRITIQUE'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0))
             / (cr.conso_mensuelle_kg / 30.0) < CAST(p_alerte.v AS numeric) THEN 'ATTENTION'
        ELSE 'OK'
    END                                     AS statut,

    -- --- SECOND AXE : le sur-stock -----------------------------------------
    -- Juge sur la PROJECTION, pas sur le stock du jour. Compare un stock
    -- physique a un maximum calibre au mois pendant que la projection retranche
    -- douze mois de besoins revient a declarer excessif tout stock sain pour
    -- l'annee : la simulation en donnait 72 sur 124.
    CASE WHEN COALESCE(sm.stock_min_kg, 0) > 0
          AND (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0))
              > GREATEST(sm.stock_min_kg * 1.5, sm.stock_min_kg + COALESCE(cr.conso_mensuelle_kg, 0)
                                      * CAST(p_marge.v AS numeric) / 30.0)
         THEN 1 ELSE 0 END                  AS sur_stock,
    -- --- DECLENCHEUR C : l'ecart majeur ------------------------------------
    -- Le filet de securite. La logique dit qu'on est confortable, le magasin dit
    -- qu'on est sous le minimum : quelque chose n'a pas ete declare — une casse,
    -- une consommation, une erreur de saisie, un vol. Ce n'est pas une alerte de
    -- stock, c'est une alerte de VERITE des donnees, et elle se traite autrement.
    CASE WHEN COALESCE(cr.conso_mensuelle_kg, 0) > 0
          AND (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(bh.dem_lead_kg, 0)) / (cr.conso_mensuelle_kg / 30.0)
              > CAST(p_ecart.v AS numeric)
          AND ph.stock_physique_net_kg < COALESCE(r.stock_min_kg, 0)
         THEN 1 ELSE 0 END                  AS ecart_majeur,

    -- Fraicheur du raisonnement. La projection melange un stock VIVANT a des
    -- besoins FIGES au dernier calcul MRP : sans cette date a cote du statut,
    -- une alerte verte peut n'etre que le reflet d'un calcul qui n'a pas ete
    -- relance depuis que le plan a change.
    (SELECT MAX(date_calcul) FROM besoin_mrp)                         AS besoins_calcules_le,

    -- L'HORIZON, MAINTENANT VISIBLE. Ce qui est retranche du stock pour le
    -- projeter, et ce qu'il faudra couvrir a la prochaine commande.
    COALESCE(bh.dem_lead_kg, 0)             AS demande_delai_kg,
    COALESCE(bh.sorties_prevues_kg, 0)      AS sorties_prevues_kg
FROM reference r
JOIN      v_stock_disponible sd ON sd.code_reference = r.code_reference
JOIN      v_stock_physique   ph ON ph.code_reference = r.code_reference
JOIN      v_stock_min_dynamique sm ON sm.code_reference = r.code_reference
LEFT JOIN fournisseur         f ON f.code_fournisseur = r.code_fournisseur
LEFT JOIN v_encours_fiable   ef ON ef.code_reference = r.code_reference
LEFT JOIN v_besoin_12m        b ON b.code_reference  = r.code_reference
LEFT JOIN v_besoin_horizon   bh ON bh.code_reference = r.code_reference
LEFT JOIN v_conso_retenue    cr ON cr.code_reference = r.code_reference
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_DelaiDefaut')      p_delai
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_SeuilCritique')    p_crit
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_SeuilAlerte')      p_alerte
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_MargeJours')       p_marge
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_EcartCouvertureJours') p_ecart
WHERE r.actif = 1;

-- ---------------------------------- 4. LE PLAN D'ACHAT, FORMULE DU CLASSEUR
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
           r.moq_kg, r.multiple_achat_kg, r.facteur_kg,
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
    ROUND(stock_min_catalogue_kg, 4)                           AS stock_min_catalogue_kg
FROM arrondi a
WHERE qte_a_commander_kg > 0
ORDER BY CASE statut WHEN 'RUPTURE' THEN 1 WHEN 'CRITIQUE' THEN 2 WHEN 'ATTENTION' THEN 3 ELSE 4 END,
         qte_a_commander_kg * prix_retenu_mad DESC;

ALTER VIEW v_plan_achat OWNER TO gestionfil;

-- ---------------------------- 5. LES COLONNES DOIVENT ETRE DECLAREES
--
-- LA CASE A COCHER DE CHAQUE LIGNE N'EXISTAIT PAS A L'ECRAN, et personne ne
-- comprenait pourquoi : le tableau filtre ses colonnes par la grille de droits,
-- et un champ NON DECLARE vaut MASQUE. « selection » n'avait jamais ete
-- declare. Il ne restait donc que « Tout cocher / Tout decocher » — d'ou
-- l'impression, juste, qu'on ne pouvait choisir ni reference, ni quantite, ni
-- prix : on ne voyait meme pas la case.
--
-- Le meme oubli masquait la classe ABC et le risque de sourcing, et masquerait
-- les trois colonnes de devise qu'on vient d'ajouter.
CREATE TEMP TABLE champs_neufs (module text, champ text, libelle text, niveau_defaut text,
                                sensible int, ordre int, modele text) ON COMMIT DROP;
INSERT INTO champs_neufs VALUES
 ('PLAN_ACHAT', 'selection',            'Case de selection',            'LECTURE', 0, 4200, 'statut'),
 ('PLAN_ACHAT', 'classe_abc',           'Classe ABC',                   'LECTURE', 0, 4210, 'statut'),
 ('PLAN_ACHAT', 'classe_xyz',           'Classe XYZ',                   'LECTURE', 0, 4220, 'statut'),
 ('PLAN_ACHAT', 'risque_source',        'Risque de sourcing',           'LECTURE', 0, 4230, 'statut'),
 ('PLAN_ACHAT', 'nb_sources',           'Nombre de sources',            'LECTURE', 0, 4240, 'statut'),
 ('PLAN_ACHAT', 'code_devise',          'Devise',                       'LECTURE', 0, 4250, 'prix_estime_mad'),
 ('PLAN_ACHAT', 'prix_devise',          'Prix (devise)',                'LECTURE', 1, 4260, 'prix_estime_mad'),
 ('PLAN_ACHAT', 'montant_devise',       'Montant (devise)',             'LECTURE', 1, 4270, 'montant_total_mad'),
 ('PLAN_ACHAT', 'taux_devise',          'Taux de change retenu',        'LECTURE', 0, 4280, 'prix_estime_mad'),
 ('PLAN_ACHAT', 'palettes_a_commander', 'Palettes a commander',         'LECTURE', 0, 4290, 'quantite_suggeree_kg'),
 ('STOCK',      'palettes',             'Palettes en stock',            'LECTURE', 0, 4300, 'stock_global_kg'),
 ('STOCK',      'bobines',              'Bobines en stock',             'LECTURE', 0, 4310, 'stock_global_kg'),
 ('STOCK',      'kg_par_palette',       'Kilos par palette',            'LECTURE', 0, 4320, 'stock_global_kg');

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT module, champ, libelle, niveau_defaut, sensible, ordre FROM champs_neufs
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

-- Chaque champ neuf reprend le niveau du champ MODELE, role par role et
-- utilisateur par utilisateur : personne ne gagne ni ne perd un droit au
-- passage.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, n.module, n.champ,
       CASE WHEN m.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM champs_neufs n
  JOIN modele_droit_champ m ON m.module = n.module AND m.champ = n.modele
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, n.module, n.champ,
       CASE WHEN d.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM champs_neufs n
  JOIN droit_champ d ON d.module = n.module AND d.champ = n.modele
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- ------------------------------------------------------------ 6. LES PREUVES
DO $$
DECLARE n_refs bigint; kg numeric; mad numeric; ruptures bigint; sans_devise bigint;
        n_champs bigint;
BEGIN
    SELECT COUNT(*) INTO n_champs FROM champ_configurable
     WHERE (module, champ) IN (('PLAN_ACHAT','selection'), ('PLAN_ACHAT','prix_devise'),
                               ('PLAN_ACHAT','montant_devise'), ('STOCK','palettes'));
    IF n_champs <> 4 THEN
        RAISE EXCEPTION 'les colonnes neuves ne sont pas toutes declarees (%/4) : elles resteraient invisibles', n_champs;
    END IF;
    SELECT COUNT(*), ROUND(SUM(qte_a_commander_kg)), ROUND(SUM(montant_estime_mad))
      INTO n_refs, kg, mad FROM v_plan_achat;
    SELECT COUNT(*) INTO ruptures FROM v_stock_projete WHERE statut = 'RUPTURE';
    SELECT COUNT(*) INTO sans_devise FROM v_plan_achat WHERE devise IS NULL;

    IF kg > 1500000 THEN
        RAISE EXCEPTION 'le plan propose encore % kg : l''horizon n''a pas change', kg;
    END IF;
    IF sans_devise > 0 THEN
        RAISE NOTICE '% ligne(s) sans devise au catalogue', sans_devise;
    END IF;
    RAISE NOTICE 'plan d''achat : % references, % kg, % MAD, % rupture(s)',
                 n_refs, kg, mad, ruptures;
END $$;

COMMIT;
