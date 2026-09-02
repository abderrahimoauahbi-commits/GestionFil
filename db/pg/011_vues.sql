-- Porte automatiquement depuis db/011_vues.sql par pg/porter_vues.py.
-- NE PAS MODIFIER ICI : corriger la source, puis rejouer le portage.

-- =============================================================================
-- VUES DE PILOTAGE
-- =============================================================================
-- Les 7 vues du CDC (partie I) sont reecrites. Defauts corriges :
--   * duplication du stock par magasin (jointure non agregee)
--   * absence de l'en-cours fournisseur dans le stock projete
--   * consommation MRP utilisee au lieu de la consommation reelle (correction N4)
--   * arithmetique NULL du plan d'achat (max()/NULLIF sous SQLite et GREATEST
--     sous PostgreSQL n'ont pas la meme semantique face a NULL)
--   * fan-out d'agregat dans le scorecard fournisseur
--   * stock neuf classe dormant
--
-- ATTENTION SQLite : GREATEST(a, b, c) scalaire renvoie NULL si un argument est NULL
-- (contrairement a GREATEST de PostgreSQL qui ignore les NULL). Tous les termes
-- sont donc explicitement COALESCE. C'est precisement le piege qui mettait la
-- quantite a commander a 0 en silence dans la vue I2 du CDC.
-- =============================================================================

-- =============================================================================
-- 1. RECETTES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_recette_calculee  (ex v_ligne_recette_calculee)
-- Remplace la colonne stockee `kg_m2` du CDC (donnee derivee sans trigger de
-- coherence = derive garantie).
-- Formule E3, les deux cas d'unite de densite :
--     kg/m2 : kg_m2 = densite_role * (% / 100)
--     ml/m2 : kg_m2 = densite_role * (% / 100) * densite_kg_ml_reference
-- Jointure INTERNE sur ligne_qualite : pas de COALESCE(...,0), donc pas de
-- besoin nul silencieux. Le trigger trg_qualite_activer_roles garantit qu'une
-- qualite ACTIVE ne peut pas avoir de role sans densite.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_ligne_recette_calculee CASCADE;
DROP VIEW IF EXISTS v_recette_calculee CASCADE;
CREATE VIEW v_recette_calculee AS
SELECT
    r.id_recette,
    r.code_qualite,
    q.nom                           AS qualite_nom,
    q.statut                        AS statut_qualite,
    r.ligne_numero,
    r.code_reference,
    ref.designation,
    r.code_role,
    rb.libelle                      AS role_libelle,
    r.pourcentage_composition,
    r.couleur,
    r.code_groupe_equiv,
    lq.densite                      AS densite_role,
    lq.unite_densite,
    ref.densite_kg_ml,
    ROUND(
        CASE lq.unite_densite
            WHEN 'kg_m2' THEN lq.densite * r.pourcentage_composition / 100.0
            WHEN 'ml_m2' THEN lq.densite * r.pourcentage_composition / 100.0 * ref.densite_kg_ml
        END, 6)                     AS kg_m2
FROM recette r
JOIN qualite       q  ON q.code_qualite  = r.code_qualite
JOIN ligne_qualite lq ON lq.code_qualite = r.code_qualite
                     AND lq.code_role    = r.code_role
                     AND lq.actif        = 1
JOIN role_bom      rb ON rb.code_role    = r.code_role
JOIN reference    ref ON ref.code_reference = r.code_reference
WHERE r.actif = 1;

-- =============================================================================
-- 2. MRP
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_besoin_mrp_calcule
-- Formule F2, AGREGEE par reference (exigence explicite de F2 que la vue I4 du
-- CDC ne respectait pas), avec application du taux de perte embarque sur le plan.
-- Le lien plan -> composition passe par plan_qualite (correction BL-4).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_besoin_mrp_calcule CASCADE;
CREATE VIEW v_besoin_mrp_calcule AS
SELECT
    pp.id_plan,
    pp.libelle                              AS plan_libelle,
    pp.annee,
    lpp.mois,
    lpp.rang_mois,
    lpp.annee_mois,
    rc.code_reference,
    ROUND(SUM(lpp.m2_prevus * rc.kg_m2), 4)                                AS quantite_brute_kg,
    pp.taux_perte_pct,
    ROUND(SUM(lpp.m2_prevus * rc.kg_m2) * (1 + pp.taux_perte_pct / 100.0), 4) AS quantite_kg
FROM plan_production pp
JOIN ligne_plan_production lpp ON lpp.id_plan = pp.id_plan
JOIN plan_qualite pq          ON pq.id_plan   = pp.id_plan
                             AND pq.code_qualite = lpp.code_qualite
JOIN v_recette_calculee rc    ON rc.code_qualite = pq.code_qualite
WHERE lpp.m2_prevus > 0
-- `lpp.mois` et `lpp.annee_mois` sont fonctionnellement determines par
-- (id_plan, rang_mois) : les citer ne change aucun resultat. SQLite les
-- tolerait hors GROUP BY en choisissant une ligne au hasard ; PostgreSQL
-- les exige, et il a raison — le hasard n'a rien a faire dans un calcul
-- de besoins.
GROUP BY pp.id_plan, lpp.rang_mois, lpp.mois, lpp.annee_mois, rc.code_reference;

-- -----------------------------------------------------------------------------
-- v_besoin_12m : besoins figes des plans EN_COURS couvrant la date du jour (R08)
-- -----------------------------------------------------------------------------
-- Le nom est trompeur et le reste pour l'instant : la vue ne couvre PAS douze
-- mois, elle couvre l'horizon du plan en service, quel qu'il soit. Le renommer
-- toucherait le service Rust et six ecrans ; la correction du calcul, elle, ne
-- pouvait pas attendre.
DROP VIEW IF EXISTS v_besoin_12m CASCADE;
CREATE VIEW v_besoin_12m AS
WITH horizon AS (
    -- Nombre de mois REELLEMENT couverts par chaque plan. C'est le plan qui
    -- donne le denominateur, jamais une constante : un plan de six mois divise
    -- par six. Diviser par douze halvait la consommation mensuelle, doublait la
    -- couverture affichee, et retardait d'autant le declenchement des alertes
    -- — verifie : facteur exactement 2,0 sur un plan de six mois.
    SELECT id_plan, COUNT(DISTINCT annee_mois) AS mois
      FROM besoin_mrp
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
GROUP BY bm.code_reference;

-- =============================================================================
-- 3. STOCK
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_stock_disponible
-- CORRECTION : la vue I1 du CDC joignait stock_magasin SANS agregation. Une
-- reference presente dans 3 magasins produisait 3 lignes, chacune ne voyant
-- qu'un tiers du stock -> ruptures surcomptees et 3 propositions d'achat pour
-- la meme reference. Le flag magasin.inclure_mrp, prevu pour exclure la zone de
-- quarantaine, n'etait par ailleurs utilise nulle part.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_disponible CASCADE;
CREATE VIEW v_stock_disponible AS
SELECT
    r.code_reference,
    ROUND(COALESCE(SUM(CASE WHEN mg.inclure_mrp = 1 THEN sm.quantite_kg END), 0), 4) AS stock_mrp_kg,
    ROUND(COALESCE(SUM(sm.quantite_kg), 0), 4)                                       AS stock_total_kg,
    ROUND(COALESCE(SUM(CASE WHEN mg.est_quarantaine = 1 THEN sm.quantite_kg END), 0), 4) AS stock_quarantaine_kg,
    ROUND(COALESCE(SUM(sm.quantite_kg * COALESCE(sm.cmup_mad, 0)), 0), 2)            AS valeur_totale_mad,
    MAX(sm.date_derniere_entree)                                                     AS date_derniere_entree,
    MAX(sm.date_derniere_sortie)                                                     AS date_derniere_sortie
FROM reference r
LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
LEFT JOIN magasin       mg ON mg.code_magasin   = sm.code_magasin
WHERE r.actif = 1
GROUP BY r.code_reference;

-- -----------------------------------------------------------------------------
-- v_encours_bc
-- CORRECTION : la vue I1 du CDC definissait stock_projete = stock - besoins,
-- en ignorant les commandes deja passees. Definition MRP correcte :
--     disponible = stock + en-cours - besoins
-- Sans ce terme, le systeme recommande de recommander ce qui est deja commande.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_encours_bc CASCADE;
CREATE VIEW v_encours_bc AS
SELECT
    lb.code_reference,
    ROUND(SUM(lb.quantite_restante_kg), 4) AS encours_kg,
    COUNT(DISTINCT lb.id_bc)               AS nb_bc_ouverts,
    MIN(lb.date_livraison_prevue)          AS prochaine_livraison
FROM ligne_bc lb
JOIN bon_commande bc ON bc.id_bc = lb.id_bc
WHERE bc.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
  AND lb.statut NOT IN ('ANNULE','SOLDE')
  AND lb.quantite_restante_kg > 0
GROUP BY lb.code_reference;

-- -----------------------------------------------------------------------------
-- v_conso_reelle
-- Consommation mensuelle REELLE, conformement a la correction N4 du 11/06/2026 :
--     Conso_Mensuelle = Sorties_Cumulees / nb_mois_reellement_ecoules
-- La vue I1 du CDC utilisait SUM(besoin_mrp)/12, c'est-a-dire la consommation
-- PREVISIONNELLE : la correction N4 n'avait pas ete reportee dans le SQL.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_conso_reelle CASCADE;
CREATE VIEW v_conso_reelle AS
SELECT
    lm.code_reference,
    ROUND(SUM(lm.quantite_kg), 4) AS sorties_cumulees_kg,
    GREATEST(1, CAST(((current_date - (min(m.date_mouvement))::date)) / 30.44 AS integer)) AS nb_mois_ecoules,
    ROUND(SUM(lm.quantite_kg)
          / GREATEST(1, CAST(((current_date - (min(m.date_mouvement))::date)) / 30.44 AS integer)), 4) AS conso_mensuelle_kg,
    min(m.date_mouvement) AS premiere_sortie,
    max(m.date_mouvement) AS derniere_sortie
FROM ligne_mouvement lm
JOIN mouvement       m  ON m.id_mouvement  = lm.id_mouvement
JOIN type_mouvement  tm ON tm.code_type_mvt = m.code_type_mvt
WHERE tm.signe = -1
  AND m.code_type_mvt = 'SORTIE_PROD'
GROUP BY lm.code_reference;

-- -----------------------------------------------------------------------------
-- v_conso_retenue
-- Consommation de reference du pilotage. Le repli sur la prevision MRP quand
-- aucun historique de sortie n'existe est AUTORISE mais TRACE (source_conso),
-- au lieu du COALESCE(..., 1) silencieux de la vue I1 du CDC — qui contredisait
-- frontalement B2/R01 "jamais de fallback silencieux".
-- -----------------------------------------------------------------------------
-- FIX P1 (feuille GESTION FIL, mai 2026) : c'est le MAXIMUM des deux sources,
-- pas la premiere disponible.
--
-- Retenir l'historique des qu'il existe, comme le faisait un COALESCE, sous-
-- estime la consommation chaque fois que le plan est plus ambitieux que le passe
-- — c'est-a-dire precisement quand la production monte. La couverture s'en
-- trouve surevaluee, et l'alerte reste verte pendant que le besoin croit.
--
-- Le maximum protege dans les deux sens : un demarrage sans historique prend le
-- previsionnel, une consommation reelle superieure au plan prend le reel.
DROP VIEW IF EXISTS v_conso_retenue CASCADE;
CREATE VIEW v_conso_retenue AS
SELECT
    r.code_reference,
    -- max() scalaire de SQLite propage les NULL : chaque terme est COALESCE, et
    -- le zero final redevient NULL pour distinguer « aucune donnee » de « zero ».
    NULLIF(GREATEST(COALESCE(cr.conso_mensuelle_kg, 0), COALESCE(b.besoin_mensuel_moyen_kg, 0)), 0)   AS conso_mensuelle_kg,
    ROUND(COALESCE(cr.conso_mensuelle_kg, 0), 4)             AS conso_reelle_kg,
    ROUND(COALESCE(b.besoin_mensuel_moyen_kg, 0), 4)         AS conso_previsionnelle_kg,
    CASE
        WHEN cr.conso_mensuelle_kg IS NULL AND b.besoin_mensuel_moyen_kg IS NULL
             THEN 'INDETERMINEE'
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) >= COALESCE(b.besoin_mensuel_moyen_kg, 0)
             THEN 'REELLE'
        ELSE 'PREVISIONNELLE_MRP'
    END AS source_conso,
    cr.nb_mois_ecoules
FROM reference r
LEFT JOIN v_conso_reelle cr ON cr.code_reference = r.code_reference
LEFT JOIN v_besoin_12m   b  ON b.code_reference  = r.code_reference
WHERE r.actif = 1;

-- -----------------------------------------------------------------------------
-- v_stock_min_dynamique
-- Formule F3 (MAX de 4 securites), absente des vues du CDC qui n'utilisaient que
-- le stock_min_kg saisi au catalogue.
-- Rappel SQLite : max() scalaire propage les NULL -> chaque terme est COALESCE.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_min_dynamique CASCADE;
CREATE VIEW v_stock_min_dynamique AS
SELECT
    r.code_reference,
    COALESCE(r.stock_min_kg, 0)                                              AS terme1_catalogue_kg,
    ROUND(COALESCE(r.couverture_min_mois, p_couv.v) * COALESCE(cr.conso_mensuelle_kg, 0)
          * (1 + COALESCE(r.marge_securite_pct, p_marge.v) / 100.0), 4)      AS terme2_couverture_kg,
    ROUND(COALESCE(cr.conso_mensuelle_kg, 0)
          * COALESCE(f.delai_livraison_jours, p_delai.v) / 30.0, 4)          AS terme3_delai_kg,
    ROUND(COALESCE(cr.conso_mensuelle_kg, 0)
          * CASE r.classe_abc WHEN 'A' THEN p_seca.v WHEN 'B' THEN p_secb.v ELSE p_secc.v END
          / 30.0, 4)                                                         AS terme4_securite_abc_kg,
    ROUND(GREATEST(COALESCE(r.stock_min_kg, 0), COALESCE(r.couverture_min_mois, p_couv.v) * COALESCE(cr.conso_mensuelle_kg, 0)
            * (1 + COALESCE(r.marge_securite_pct, p_marge.v) / 100.0), COALESCE(cr.conso_mensuelle_kg, 0) * COALESCE(f.delai_livraison_jours, p_delai.v) / 30.0, COALESCE(cr.conso_mensuelle_kg, 0)
            * CASE r.classe_abc WHEN 'A' THEN p_seca.v WHEN 'B' THEN p_secb.v ELSE p_secc.v END / 30.0), 4)                                                                    AS stock_min_kg
FROM reference r
LEFT JOIN fournisseur     f  ON f.code_fournisseur = r.code_fournisseur
LEFT JOIN v_conso_retenue cr ON cr.code_reference  = r.code_reference
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_CouvMinMois')  p_couv
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_MargeSecurite') p_marge
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_DelaiDefaut')   p_delai
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_SecuriteA')     p_seca
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_SecuriteB')     p_secb
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_SecuriteC')     p_secc
WHERE r.actif = 1;

-- -----------------------------------------------------------------------------
-- v_stock_physique   —   LA REALITE, par opposition a la projection
--
-- La couverture en jours est un raisonnement, pas un constat. Elle suppose que
-- les besoins sont a jour, que les commandes arrivent a l'heure, et que tout ce
-- qui est en stock est utilisable. Ces trois hypotheses tombent regulierement :
-- un camion reste en douane, un lot passe en quarantaine, une consommation
-- exceptionnelle vide le magasin avant que le MRP ne l'ait integre.
--
-- Cette vue ne raisonne pas. Elle dit ce qu'il y a dans les allees, maintenant.
-- C'est le VETO qui s'imposera a la projection : l'alerte finale est le pire des
-- deux, jamais la moyenne, jamais la plus optimiste.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_physique CASCADE;
CREATE VIEW v_stock_physique AS
SELECT
    r.code_reference,

    -- Le net se calcule sur les DEUX drapeaux plutot que sur leur concordance :
    -- un magasin declare en quarantaine mais laisse dans le MRP passerait au
    -- travers si l'on se fiait au seul inclure_mrp.
    ROUND(COALESCE(SUM(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0
                            THEN sm.quantite_kg END), 0), 4)          AS stock_utilisable_kg,
    ROUND(COALESCE(SUM(CASE WHEN mg.est_quarantaine = 1
                            THEN sm.quantite_kg END), 0), 4)          AS stock_quarantaine_kg,

    -- Reserve a un ordre de fabrication en cours. Le terme est pose des
    -- maintenant, a zero : il n'existe aucune table d'ordre de fabrication dans
    -- ce produit. Le jour ou elle existera, seule cette ligne changera, et le
    -- veto se resserrera de lui-meme partout ou il est lu. Poser un zero
    -- explicite vaut mieux qu'un terme absent qu'on oubliera d'ajouter.
    0.0                                                               AS stock_reserve_kg,

    ROUND(COALESCE(SUM(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0
                            THEN sm.quantite_kg END), 0) - 0.0, 4)    AS stock_physique_net_kg
FROM reference r
LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
LEFT JOIN magasin       mg ON mg.code_magasin   = sm.code_magasin
WHERE r.actif = 1
GROUP BY r.code_reference;

-- -----------------------------------------------------------------------------
-- v_encours_fiable   —   ce qu'on peut RAISONNABLEMENT attendre
--
-- v_encours_bc compte toute commande ouverte, qu'elle soit prevue demain ou en
-- retard de six mois. La couverture s'en trouve gonflee par des marchandises
-- que plus personne n'attend vraiment.
--
-- Passe la tolerance de retard, la quantite sort du calcul : la couverture
-- s'effondre, et l'alerte vire. C'est voulu — le retard REEL doit annuler la
-- prevision, pas la prolonger. La quantite retardee reste comptee a part, pour
-- que l'ecran dise POURQUOI la couverture a chute.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_encours_fiable CASCADE;
CREATE VIEW v_encours_fiable AS
SELECT
    lb.code_reference,
    ROUND(SUM(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) >= to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
                     OR lb.date_livraison_prevue IS NULL
                   THEN lb.quantite_restante_kg ELSE 0 END), 4)       AS encours_fiable_kg,
    ROUND(SUM(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) <  to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
                   THEN lb.quantite_restante_kg ELSE 0 END), 4)       AS encours_retarde_kg,
    SUM(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) <  to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
             THEN 1 ELSE 0 END)                                       AS nb_lignes_retardees,
    MIN(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) <  to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
             THEN lb.date_livraison_prevue END)                       AS plus_ancien_retard,
    MAX(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) <  to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
             THEN CAST((current_date - (lb.date_livraison_prevue)::date) AS integer) END)
                                                                      AS retard_max_jours
FROM ligne_bc lb
JOIN bon_commande bc ON bc.id_bc = lb.id_bc
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_RetardBCJours') p_ret
WHERE bc.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
  AND lb.statut NOT IN ('ANNULE','SOLDE')
  AND lb.quantite_restante_kg > 0
GROUP BY lb.code_reference;

-- -----------------------------------------------------------------------------
-- v_stock_projete   (remplace I1)
--
-- ALERTE A DOUBLE DECLENCHEUR. Le statut final est le PIRE des deux :
--
--   * le declencheur LOGIQUE — la couverture en jours, calculee sur les besoins
--     du MRP et sur l'en-cours fiable. Excellent pour planifier, faux des que le
--     MRP n'a pas ete relance ou qu'une commande traine ;
--   * le declencheur PHYSIQUE — le stock reellement utilisable, hors
--     quarantaine et hors reserve, compare a un plancher absolu. Il ne raisonne
--     pas, donc il ne se trompe pas.
--
-- Prendre le pire des deux, et jamais la moyenne : une alerte qui s'adoucit
-- parce que l'autre moitie du calcul est optimiste est pire qu'une alerte
-- absente, parce qu'elle se lit comme un feu vert.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_projete CASCADE;
CREATE VIEW v_stock_projete AS
SELECT
    r.code_reference,
    r.designation,
    r.code_fournisseur,
    f.nom                                   AS fournisseur_nom,
    f.pays                                  AS fournisseur_pays,
    COALESCE(f.delai_livraison_jours, CAST(p_delai.v AS integer)) AS delai_livraison_jours,
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
          - COALESCE(b.besoin_12m_kg, 0), 4)                          AS stock_projete_kg,

    cr.conso_mensuelle_kg,
    cr.source_conso,
    CASE WHEN COALESCE(cr.conso_mensuelle_kg, 0) > 0
         THEN ROUND((ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
                     - COALESCE(b.besoin_12m_kg, 0)) / (cr.conso_mensuelle_kg / 30.0), 1)
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
              - COALESCE(b.besoin_12m_kg, 0)) <= 0 THEN 'RUPTURE'
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) = 0 THEN 'OK'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(b.besoin_12m_kg, 0))
             / (cr.conso_mensuelle_kg / 30.0) < CAST(p_crit.v AS numeric)  THEN 'CRITIQUE'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(b.besoin_12m_kg, 0))
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
              - COALESCE(b.besoin_12m_kg, 0)) <= 0 THEN 'RUPTURE'
        -- Le veto physique s'impose ici, avant l'echelle logique.
        WHEN COALESCE(sm.stock_min_kg, 0) > 0
         AND ph.stock_physique_net_kg < sm.stock_min_kg THEN 'CRITIQUE'
        WHEN COALESCE(cr.conso_mensuelle_kg, 0) = 0 THEN 'OK'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(b.besoin_12m_kg, 0))
             / (cr.conso_mensuelle_kg / 30.0) < CAST(p_crit.v AS numeric)  THEN 'CRITIQUE'
        WHEN (ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg, 0)
              - COALESCE(b.besoin_12m_kg, 0))
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
               - COALESCE(b.besoin_12m_kg, 0))
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
               - COALESCE(b.besoin_12m_kg, 0)) / (cr.conso_mensuelle_kg / 30.0)
              > CAST(p_ecart.v AS numeric)
          AND ph.stock_physique_net_kg < COALESCE(r.stock_min_kg, 0)
         THEN 1 ELSE 0 END                  AS ecart_majeur,

    -- Fraicheur du raisonnement. La projection melange un stock VIVANT a des
    -- besoins FIGES au dernier calcul MRP : sans cette date a cote du statut,
    -- une alerte verte peut n'etre que le reflet d'un calcul qui n'a pas ete
    -- relance depuis que le plan a change.
    (SELECT MAX(date_calcul) FROM besoin_mrp)                         AS besoins_calcules_le
FROM reference r
JOIN      v_stock_disponible sd ON sd.code_reference = r.code_reference
JOIN      v_stock_physique   ph ON ph.code_reference = r.code_reference
JOIN      v_stock_min_dynamique sm ON sm.code_reference = r.code_reference
LEFT JOIN fournisseur         f ON f.code_fournisseur = r.code_fournisseur
LEFT JOIN v_encours_fiable   ef ON ef.code_reference = r.code_reference
LEFT JOIN v_besoin_12m        b ON b.code_reference  = r.code_reference
LEFT JOIN v_conso_retenue    cr ON cr.code_reference = r.code_reference
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_DelaiDefaut')      p_delai
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_SeuilCritique')    p_crit
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_SeuilAlerte')      p_alerte
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_MargeJours')       p_marge
CROSS JOIN (SELECT valeur_courante v FROM parametre WHERE code_parametre = 'P_EcartCouvertureJours') p_ecart
WHERE r.actif = 1;

-- =============================================================================
-- 4. PLAN D'ACHAT
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_plan_achat   (remplace I2)
--
-- CORRECTIONS :
--  * quantite : la formule I2 du CDC renvoyait 0 en silence des que
--    multiple_achat_kg etait NULL (NULLIF -> NULL -> GREATEST ignore les NULL).
--  * le MOQ ne s'applique que si l'on commande effectivement.
--  * le tiering porte desormais sur le MONTANT REELLEMENT COMMANDE (arrondi +
--    MOQ compris) et non sur un montant intermediaire different de l'affichage.
--  * prix : repli CMUP -> catalogue converti en MAD, explicitement trace.
--  * stock_min : formule dynamique F3 au lieu du seul stock_min catalogue.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_plan_achat CASCADE;
CREATE VIEW v_plan_achat AS
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
            ELSE ROUND(CAST(
                     (qte_avec_moq_kg + multiple_achat_kg - 0.0001) / multiple_achat_kg
                 AS integer) * multiple_achat_kg, 4)
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

-- =============================================================================
-- 5. COCKPIT
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_cockpit_stock   (remplace I3)
-- Un seul balayage par CTE, la ou la vue I3 du CDC rescannait v_stock_projete
-- 4 fois et v_plan_achat 3 fois (chacune rescannant elle-meme v_stock_projete).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_cockpit_stock CASCADE;
CREATE VIEW v_cockpit_stock AS
WITH s AS (SELECT statut, classe_abc FROM v_stock_projete),
     p AS (SELECT montant_estime_mad, classe_abc, tier FROM v_plan_achat)
SELECT
    (SELECT COUNT(*) FROM s WHERE statut = 'RUPTURE')                        AS nb_ruptures,
    (SELECT COUNT(*) FROM s WHERE statut = 'CRITIQUE')                       AS nb_critiques,

    (SELECT COUNT(*) FROM s WHERE statut = 'ATTENTION')                      AS nb_attention,
    -- Le sur-stock est un SECOND AXE : il ne dit pas qu'on va manquer, il dit
    -- qu'on immobilise. Il se compte a part, jamais dans l'echelle d'alerte.
    (SELECT COUNT(*) FROM v_stock_projete WHERE sur_stock = 1)               AS nb_sur_stock,
    (SELECT COUNT(*) FROM v_stock_projete WHERE ecart_majeur = 1)            AS nb_ecart_majeur,
    -- FRAICHEUR. Le stock est vivant, les besoins sont figes au dernier calcul
    -- MRP : sans cette date a cote des compteurs, un tableau tout vert peut
    -- n'etre que le reflet d'un calcul qu'on n'a pas relance depuis que le plan
    -- a change. L'erreur va toujours dans le sens rassurant.
    (SELECT MAX(date_calcul) FROM besoin_mrp)                                AS besoins_calcules_le,
    -- La condition de C29 est RECOPIEE ici plutot que lue depuis v_ctl_c29 :
    -- les controles naissent dans 012, apres ce fichier. SQLite accepterait la
    -- vue et n'echouerait qu'a la premiere lecture — la base se construirait
    -- « integre » et le cockpit casserait a l'ouverture.
    (SELECT COUNT(*) FROM plan_production pp
      WHERE pp.statut = 'EN_COURS'
        AND (NOT EXISTS (SELECT 1 FROM besoin_mrp b WHERE b.id_plan = pp.id_plan)
          OR COALESCE(pp.date_modification, pp.date_creation)
             > (SELECT MAX(date_calcul) FROM besoin_mrp b WHERE b.id_plan = pp.id_plan)))
                                                                             AS besoins_perimes,
    (SELECT COUNT(*) FROM s WHERE statut = 'OK')                             AS nb_ok,
    (SELECT COUNT(*) FROM s)                                                 AS nb_references,
    (SELECT ROUND(COALESCE(SUM(valeur_mad), 0), 2) FROM stock_magasin)       AS valeur_stock_mad,
    (SELECT COUNT(*) FROM p)                                                 AS nb_refs_a_commander,
    (SELECT ROUND(COALESCE(SUM(montant_estime_mad), 0), 2) FROM p)           AS budget_a_engager_mad,
    (SELECT COUNT(*) FROM p WHERE classe_abc = 'A')                          AS nb_classe_a_alerte,
    (SELECT COUNT(*) FROM p WHERE tier = 'TIER 1')                           AS nb_tier1,
    (SELECT COUNT(*) FROM fournisseur WHERE actif = 1)                       AS nb_fournisseurs_actifs,
    (SELECT COUNT(*) FROM bon_commande WHERE statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')) AS nb_bc_ouverts,
    (SELECT ROUND(COALESCE(SUM(montant_total_mad), 0), 2) FROM bon_commande
      WHERE statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL'))                   AS montant_bc_ouverts_mad,
    (SELECT COUNT(*) FROM alerte WHERE statut = 'OUVERTE' AND gravite IN ('CRITIQUE','BLOQUANT')) AS nb_alertes_critiques;

-- =============================================================================
-- 6. SUBSTITUTION, FOURNISSEURS, DORMANT, LOTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_substitution_dispo   (remplace I5)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_substitution_dispo CASCADE;
CREATE VIEW v_substitution_dispo AS
SELECT
    r1.code_reference           AS ref_principale,
    r1.designation              AS designation_principale,
    sp1.statut                  AS statut_principale,
    sp1.stock_projete_kg        AS stock_projete_principale,
    rge1.code_groupe_equiv,
    ge.libelle                  AS groupe_libelle,
    rge1.priorite               AS priorite_principale,
    r2.code_reference           AS ref_substitut,
    r2.designation              AS designation_substitut,
    r2.code_fournisseur         AS fournisseur_substitut,
    rge2.priorite               AS priorite_substitut,
    rge2.est_preferentielle,
    sd2.stock_mrp_kg            AS stock_substitut_kg,
    sp2.stock_projete_kg        AS stock_projete_substitut
FROM reference r1
JOIN reference_groupe_equiv rge1 ON rge1.code_reference = r1.code_reference AND rge1.actif = 1
JOIN groupe_equiv           ge   ON ge.code_groupe_equiv = rge1.code_groupe_equiv AND ge.actif = 1
JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                AND rge2.code_reference   <> rge1.code_reference
                                AND rge2.actif = 1
JOIN reference              r2   ON r2.code_reference = rge2.code_reference AND r2.actif = 1
JOIN v_stock_projete       sp1   ON sp1.code_reference = r1.code_reference
JOIN v_stock_projete       sp2   ON sp2.code_reference = r2.code_reference
JOIN v_stock_disponible    sd2   ON sd2.code_reference = r2.code_reference
WHERE r1.actif = 1
  AND sp1.statut IN ('RUPTURE','CRITIQUE')
  AND sd2.stock_mrp_kg > 0
ORDER BY r1.code_reference, rge2.est_preferentielle DESC, rge2.priorite;

-- -----------------------------------------------------------------------------
-- v_fournisseur_scorecard   (remplace I6)
-- CORRECTION : la vue I6 du CDC enchainait deux LEFT JOIN
-- (bon_commande -> reception -> ligne_reception) puis sommait
-- bon_commande.montant_total_mad. Classique fan-out : le montant de chaque BC
-- etait multiplie par son nombre de lignes recues. COUNT(DISTINCT) protegeait
-- nb_bc, rien ne protegeait le SUM.
-- Chaque agregat est ici calcule dans son propre CTE puis joint.
-- L'OTIF (P_CibleOTIF), confie a l'acheteur en D1 mais calcule nulle part, est
-- ajoute.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_fournisseur_scorecard CASCADE;
CREATE VIEW v_fournisseur_scorecard AS
WITH bc_agg AS (
    SELECT code_fournisseur,
           COUNT(*)                                    AS nb_bc,
           ROUND(COALESCE(SUM(montant_total_mad), 0), 2) AS montant_total_mad
    FROM bon_commande
    WHERE statut NOT IN ('BROUILLON','ANNULE')
    GROUP BY code_fournisseur
),
rec_agg AS (
    SELECT ar.code_fournisseur,
           COUNT(*)                                                          AS nb_lignes_recues,
           ROUND(AVG(CASE WHEN ar.statut_qualite = 'CONFORME' THEN 100.0 ELSE 0.0 END), 2) AS taux_conformite_pct,
           ROUND(AVG(CASE WHEN ar.conformite_delai = 1 THEN 100.0 ELSE 0.0 END), 2)        AS taux_ponctualite_pct,
           ROUND(AVG(abs(COALESCE(ar.ecart_pct, 0))), 2)                     AS ecart_pesee_moyen_pct,
           ROUND(AVG(CASE WHEN ar.statut_qualite = 'CONFORME'
                           AND ar.conformite_delai = 1
                           AND ar.conformite_quantite = 1 THEN 100.0 ELSE 0.0 END), 2)     AS otif_pct,
           ROUND(AVG(COALESCE(ar.jours_retard, 0)), 1)                       AS retard_moyen_jours
    FROM archive_reception ar
    GROUP BY ar.code_fournisseur
),
ref_agg AS (
    SELECT code_fournisseur, COUNT(*) AS nb_references
    FROM reference WHERE actif = 1
    GROUP BY code_fournisseur
)
SELECT
    f.code_fournisseur,
    f.nom,
    f.pays,
    f.code_devise,
    f.delai_livraison_jours,
    f.delai_reel_moyen_jours,
    COALESCE(rf.nb_references, 0)      AS nb_references,
    COALESCE(b.nb_bc, 0)               AS nb_bc,
    COALESCE(b.montant_total_mad, 0)   AS montant_total_mad,
    COALESCE(rc.nb_lignes_recues, 0)   AS nb_lignes_recues,
    rc.taux_conformite_pct,
    rc.taux_ponctualite_pct,
    rc.ecart_pesee_moyen_pct,
    rc.otif_pct,
    rc.retard_moyen_jours,
    f.note_globale,
    CASE
        WHEN COALESCE(f.note_globale, 0) >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_ScoreStrategique') THEN 'STRATEGIQUE'
        WHEN COALESCE(f.note_globale, 0) >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_ScoreStandard')    THEN 'STANDARD'
        WHEN COALESCE(f.note_globale, 0) >= (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_ScoreSurveiller')  THEN 'A_SURVEILLER'
        ELSE 'CHALLENGER'
    END AS classement
FROM fournisseur f
LEFT JOIN bc_agg  b  ON b.code_fournisseur  = f.code_fournisseur
LEFT JOIN rec_agg rc ON rc.code_fournisseur = f.code_fournisseur
LEFT JOIN ref_agg rf ON rf.code_fournisseur = f.code_fournisseur
WHERE f.actif = 1;

-- -----------------------------------------------------------------------------
-- v_stock_dormant   (remplace I7)
-- CORRECTION : la vue I7 du CDC classait dormante toute reference sans date de
-- derniere sortie — y compris une reference RECUE LA VEILLE. Le repere est
-- desormais la derniere sortie, a defaut la derniere entree.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_dormant CASCADE;
CREATE VIEW v_stock_dormant AS
SELECT
    sm.code_reference,
    r.designation,
    sm.code_magasin,
    mg.nom                          AS magasin_nom,
    sm.quantite_kg,
    sm.cmup_mad,
    sm.valeur_mad,
    sm.date_derniere_sortie,
    sm.date_derniere_entree,
    COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree) AS date_reference_dormance,
    CAST((current_date - (COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree))::date) AS integer) AS jours_sans_mouvement,
    r.classe_abc
FROM stock_magasin sm
JOIN reference r  ON r.code_reference = sm.code_reference
JOIN magasin  mg  ON mg.code_magasin  = sm.code_magasin
WHERE sm.quantite_kg > 0
  AND COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree) IS NOT NULL
  AND (current_date - (COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree))::date)
      > (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_SeuilDormant')
ORDER BY jours_sans_mouvement DESC;

-- -----------------------------------------------------------------------------
-- v_lot_fefo
-- Proposition d'allocation FEFO (First Expired, First Out).
-- L'allocation elle-meme reste une decision metier assuree par le service Rust :
-- ce n'est pas un invariant de base.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_lot_fefo CASCADE;
CREATE VIEW v_lot_fefo AS
SELECT
    sl.code_reference,
    r.designation,
    sl.code_magasin,
    sl.lot_fournisseur,
    sl.quantite_kg,
    sl.prix_entree_mad,
    sl.date_fabrication,
    sl.date_peremption,
    sl.date_premiere_entree,
    CASE WHEN sl.date_peremption IS NOT NULL
         THEN CAST(((sl.date_peremption)::date - current_date) AS integer) END AS jours_avant_peremption,
    ROW_NUMBER() OVER (
        PARTITION BY sl.code_reference, sl.code_magasin
        ORDER BY COALESCE(sl.date_peremption, '9999-12-31'), sl.date_premiere_entree
    ) AS rang_fefo
FROM stock_lot sl
JOIN reference r ON r.code_reference = sl.code_reference
WHERE sl.quantite_kg > 0;

-- =============================================================================
-- 7. POSTE DE TRAVAIL ET MUR DE RISQUES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_cockpit_files
-- Les compteurs du poste de travail : ce qui ATTEND QUELQU'UN, ici, maintenant.
--
-- Ils ne se confondent pas avec ceux de v_cockpit_stock, qui decrivent un ETAT
-- (combien de references en rupture, quelle valeur de stock). Ceux-ci decrivent
-- une FILE : chacun se vide quand quelqu'un fait son travail, et chacun mene a
-- une liste sur laquelle on peut agir. Un compteur qui ne mene nulle part n'a
-- rien a faire sur un ecran d'accueil.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_cockpit_files CASCADE;
CREATE VIEW v_cockpit_files AS
SELECT
    -- Achats
    (SELECT COUNT(*) FROM plan_achat WHERE statut IN ('PROPOSE','EN_REVISION'))
        AS nb_propositions_a_traiter,
    (SELECT COUNT(*) FROM bon_commande WHERE statut = 'BROUILLON')
        AS nb_bc_en_preparation,
    (SELECT COUNT(*) FROM bon_commande WHERE statut = 'EN_ATTENTE_VALIDATION')
        AS nb_bc_a_valider,
    (SELECT ROUND(COALESCE(SUM(montant_total_mad), 0), 2) FROM bon_commande
      WHERE statut = 'EN_ATTENTE_VALIDATION')
        AS montant_bc_a_valider_mad,
    (SELECT COUNT(*) FROM bon_commande WHERE statut = 'VALIDE')
        AS nb_bc_a_envoyer,

    -- Livraisons : le retard se compte sur la promesse, pas sur l'anciennete.
    (SELECT COUNT(*) FROM bon_commande
      WHERE statut IN ('ENVOYE','LIVRE_PARTIEL')
        AND date_livraison_prevue IS NOT NULL
        AND substr(date_livraison_prevue, 1, 10) < to_char(current_date, 'YYYY-MM-DD'))
        AS nb_livraisons_en_retard,
    (SELECT COALESCE(MAX(CAST((current_date - (date_livraison_prevue)::date)
                              AS integer)), 0)
       FROM bon_commande
      WHERE statut IN ('ENVOYE','LIVRE_PARTIEL')
        AND date_livraison_prevue IS NOT NULL
        AND substr(date_livraison_prevue, 1, 10) < to_char(current_date, 'YYYY-MM-DD'))
        AS retard_max_jours,

    -- Reception et qualite
    (SELECT COUNT(*) FROM reception WHERE statut = 'BROUILLON')
        AS nb_receptions_en_saisie,
    (SELECT COUNT(*) FROM reception WHERE statut = 'A_CONTROLER')
        AS nb_receptions_a_controler,
    (SELECT COUNT(*) FROM ligne_reception lr
       JOIN reception rc ON rc.id_reception = lr.id_reception
      WHERE rc.statut IN ('BROUILLON','A_CONTROLER')
        AND lr.statut_qualite <> 'CONFORME')
        AS nb_lignes_non_conformes,

    -- Une reception dont le bon n'est pas engage ne se validera pas : c'est une
    -- file BLOQUEE, et elle doit se voir avant qu'on la decouvre au controle.
    (SELECT COUNT(DISTINCT rc.id_reception)
       FROM reception rc
       JOIN ligne_reception lr ON lr.id_reception = rc.id_reception
       JOIN ligne_bc lb        ON lb.id_ligne_bc  = lr.id_ligne_bc
       JOIN bon_commande bc    ON bc.id_bc        = lb.id_bc
      WHERE rc.statut IN ('BROUILLON','A_CONTROLER')
        AND bc.statut IN ('BROUILLON','EN_ATTENTE_VALIDATION','VALIDE'))
        AS nb_receptions_a_regulariser,

    -- Stock
    (SELECT COUNT(*) FROM v_plan_achat WHERE stock_projete_kg < stock_min_kg)
        AS nb_refs_sous_minimum,
    (SELECT COUNT(*) FROM v_stock_dormant)
        AS nb_refs_dormantes,
    (SELECT ROUND(COALESCE(SUM(valeur_mad), 0), 2) FROM v_stock_dormant)
        AS valeur_dormante_mad,
    (SELECT COUNT(*) FROM v_lot_fefo
      WHERE jours_avant_peremption IS NOT NULL AND jours_avant_peremption <= 90)
        AS nb_lots_peremption_proche,

    -- Sante du referentiel
    (SELECT COUNT(*) FROM v_controles WHERE criticite = 'BLOQUANT' AND anomalies > 0)
        AS nb_controles_bloquants,
    (SELECT COUNT(*) FROM v_controles WHERE criticite = 'CRITIQUE' AND anomalies > 0)
        AS nb_controles_critiques,
    (SELECT COUNT(*) FROM alerte WHERE statut = 'OUVERTE')
        AS nb_alertes_ouvertes;

-- -----------------------------------------------------------------------------
-- v_risque_mensuel
-- Le mur de risques : mois par mois, la reference tient-elle ?
--
-- La question d'une usine n'est pas « combien ai-je en stock » mais « est-ce que
-- je tiens le plan de production ». Un stock confortable aujourd'hui qui tombe a
-- zero en fevrier est un probleme de fevrier, et il faut le voir en aout, quand
-- on peut encore commander.
--
-- La projection part du stock disponible au MRP, puis deroule les mois :
--     fin(m) = fin(m-1) + entrees attendues(m) - besoin(m)
--
-- Deux choix qui changent la lecture, et qu'il faut assumer :
--   * les entrees viennent des bons OUVERTS. Ignorer une commande en route
--     ferait crier a la rupture pour une matiere deja engagee ;
--   * une livraison dont la date promise est deja passee est imputee au premier
--     mois de l'horizon plutot qu'oubliee. Elle est en retard, pas annulee — et
--     le retard se lit ailleurs, sur le poste de travail.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_risque_mensuel CASCADE;
CREATE VIEW v_risque_mensuel AS
WITH horizon AS (
    -- Les besoins figes du plan EN SERVICE. Un plan cloture ne peuple pas le
    -- mur : ses besoins ne sont plus ceux de l'atelier.
    --
    -- L'horizon demarre au MOIS COURANT, pas au premier mois du plan. Un plan
    -- lance en juillet et lu en octobre a trois mois derriere lui : leurs
    -- besoins ont deja ete consommes, et le stock d'aujourd'hui en porte la
    -- trace. Les recompter creuserait une rupture imaginaire, d'autant plus
    -- profonde que le plan est ancien — le mur annoncerait la catastrophe tout
    -- l'exercice, et plus personne ne le regarderait.
    SELECT bm.code_reference,
           bm.annee_mois,
           bm.rang_mois,
           ROUND(SUM(bm.quantite_kg), 4) AS besoin_kg
      FROM besoin_mrp bm
      JOIN plan_production pp ON pp.id_plan = bm.id_plan
     WHERE pp.statut = 'EN_COURS'
       AND to_char(current_date, 'YYYY-MM-DD') BETWEEN pp.date_debut AND pp.date_fin
       AND bm.annee_mois >= to_char(current_date, 'YYYY-MM')
     -- `annee_mois` est en correspondance 1:1 avec `rang_mois` dans un
     -- plan donne (verifie : aucun couple n'en porte deux).
     GROUP BY bm.code_reference, bm.rang_mois, bm.annee_mois
),
premier_mois AS (
    SELECT code_reference, MIN(annee_mois) AS annee_mois
      FROM horizon GROUP BY code_reference
),
attendu_brut AS (
    SELECT lb.code_reference,
           substr(COALESCE(lb.date_livraison_prevue, bc.date_livraison_prevue), 1, 7)
               AS annee_mois,
           lb.quantite_restante_kg AS entrees_kg
      FROM ligne_bc lb
      JOIN bon_commande bc ON bc.id_bc = lb.id_bc
     WHERE bc.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
       AND lb.statut NOT IN ('SOLDE','ANNULE')
       AND lb.quantite_restante_kg > 0
),
attendu AS (
    SELECT ab.code_reference,
           CASE WHEN ab.annee_mois IS NULL OR ab.annee_mois < pm.annee_mois
                THEN pm.annee_mois ELSE ab.annee_mois END AS annee_mois,
           ROUND(SUM(ab.entrees_kg), 4) AS entrees_kg
      FROM attendu_brut ab
      JOIN premier_mois pm ON pm.code_reference = ab.code_reference
     GROUP BY 1, 2
),
projection AS (
    SELECT h.code_reference,
           h.annee_mois,
           h.rang_mois,
           h.besoin_kg,
           COALESCE(a.entrees_kg, 0)                     AS entrees_kg,
           ROUND(COALESCE(sd.stock_mrp_kg, 0), 4)        AS stock_initial_kg,
           ROUND(COALESCE(sd.stock_mrp_kg, 0)
                 + SUM(COALESCE(a.entrees_kg, 0) - h.besoin_kg) OVER (
                       PARTITION BY h.code_reference ORDER BY h.rang_mois
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 4)
                                                          AS stock_fin_kg,
           ROUND(COALESCE(smd.stock_min_kg, 0), 4)        AS stock_min_kg
      FROM horizon h
      LEFT JOIN attendu a                 ON a.code_reference   = h.code_reference
                                         AND a.annee_mois       = h.annee_mois
      LEFT JOIN v_stock_disponible sd     ON sd.code_reference  = h.code_reference
      LEFT JOIN v_stock_min_dynamique smd ON smd.code_reference = h.code_reference
)
SELECT p.code_reference,
       r.designation,
       r.classe_abc,
       p.annee_mois,
       p.rang_mois,
       p.besoin_kg,
       p.entrees_kg,
       p.stock_initial_kg,
       p.stock_fin_kg,
       p.stock_min_kg,
       -- TENDU n'est pas une nuance de RUPTURE : c'est le mois ou l'on entame le
       -- stock de securite. La, la decision d'achat se prend encore sereinement ;
       -- en RUPTURE, il est deja trop tard.
       CASE WHEN p.stock_fin_kg < 0              THEN 'RUPTURE'
            WHEN p.stock_fin_kg < p.stock_min_kg THEN 'TENDU'
            ELSE 'COUVERT' END                    AS statut
  FROM projection p
  JOIN reference r ON r.code_reference = p.code_reference;

-- -----------------------------------------------------------------------------
-- v_risque_reference
-- Une ligne par reference a risque : de quoi TRIER le mur.
--
-- L'ordre est le message. Une rupture en fevrier sur une matiere de classe A
-- mono-source a 90 jours de delai n'a rien a voir avec une tension en juin sur
-- une classe C que trois fournisseurs proposent. Le tri croise donc l'echeance,
-- la criticite ABC, le sourcing et le delai — c'est-a-dire le temps qu'il reste
-- REELLEMENT pour agir.
--
-- Le sourcing reprend mot pour mot la definition de v_plan_achat (groupes
-- d'equivalence) : deux definitions du mono-source dans le meme produit se
-- contrediraient un jour.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_risque_reference CASCADE;
CREATE VIEW v_risque_reference AS
SELECT
    rm.code_reference,
    rm.designation,
    rm.classe_abc,
    ref.code_fournisseur,
    f.nom AS fournisseur_nom,
    COALESCE(f.delai_livraison_jours,
             (SELECT CAST(valeur_courante AS integer) FROM parametre
               WHERE code_parametre = 'P_DelaiDefaut')) AS delai_livraison_jours,
    -- Meme regle que v_plan_achat : un autre FOURNISSEUR, pas une autre
    -- reference. Le mur de risques trie sur ce champ ; le fausser reviendrait a
    -- reculer dans la liste une reference reellement mono-source.
    CASE WHEN (
        SELECT COUNT(*)
        FROM reference_groupe_equiv rge1
        JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                        AND rge2.code_reference   <> rge1.code_reference
                                        AND rge2.actif = 1
        JOIN reference r2 ON r2.code_reference = rge2.code_reference AND r2.actif = 1
        JOIN reference r1 ON r1.code_reference = rge1.code_reference
        WHERE rge1.code_reference = rm.code_reference AND rge1.actif = 1
          AND r2.code_fournisseur IS DISTINCT FROM r1.code_fournisseur
    ) > 0 THEN 'MULTI-SOURCE' ELSE 'MONO-SOURCE' END    AS risque_sourcing,
    MIN(rm.stock_min_kg)                                AS stock_min_kg,
    MIN(rm.stock_initial_kg)                            AS stock_initial_kg,
    SUM(CASE WHEN rm.statut = 'RUPTURE' THEN 1 ELSE 0 END)       AS nb_mois_rupture,
    SUM(CASE WHEN rm.statut = 'TENDU'   THEN 1 ELSE 0 END)       AS nb_mois_tendu,
    MIN(CASE WHEN rm.statut = 'RUPTURE'  THEN rm.annee_mois END) AS premier_mois_rupture,
    MIN(CASE WHEN rm.statut <> 'COUVERT' THEN rm.annee_mois END) AS premier_mois_risque,
    MIN(CASE WHEN rm.statut <> 'COUVERT' THEN rm.rang_mois END)  AS rang_premier_risque,
    -- Jours restants avant le premier mois a risque, DELAI FOURNISSEUR DEDUIT.
    -- Negatif, il est deja trop tard pour commander a temps : c'est le seul
    -- chiffre qui dise s'il reste une decision a prendre ou un degat a limiter.
    CAST(((MIN(CASE WHEN rm.statut <> 'COUVERT' THEN rm.annee_mois END) || '-01')::date - current_date)
         - COALESCE(f.delai_livraison_jours,
                    (SELECT CAST(valeur_courante AS integer) FROM parametre
                      WHERE code_parametre = 'P_DelaiDefaut')) AS integer)
                                                        AS marge_decision_jours,
    -- Un equivalent en stock change la NATURE du risque : ce n'est plus « il
    -- faut commander et attendre » mais « il faut decider ». Le dire evite de
    -- traiter en urgence ce qui se resout par un arbitrage.
    (SELECT ROUND(COALESCE(MAX(e.equivalent_stock_kg), 0), 3) FROM v_equivalence e
      WHERE e.code_reference = rm.code_reference
        AND e.interchangeable = 1)                      AS equivalent_dispo_kg,
    (SELECT e.equivalent_reference FROM v_equivalence e
      WHERE e.code_reference = rm.code_reference
        AND e.interchangeable = 1
      ORDER BY e.equivalent_stock_kg DESC LIMIT 1)      AS equivalent_reference
  FROM v_risque_mensuel rm
  JOIN reference ref      ON ref.code_reference = rm.code_reference
  LEFT JOIN fournisseur f ON f.code_fournisseur = ref.code_fournisseur
 GROUP BY rm.code_reference
HAVING nb_mois_rupture > 0 OR nb_mois_tendu > 0;

-- =============================================================================
-- 8. STATISTIQUES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_stat_mouvement_mois
-- Le flux, mois par mois et par type. Les entrees et les sorties sont comptees
-- SEPAREMENT, jamais nettes : un mois a 50 t entrees et 50 t sorties n'est pas
-- un mois sans activite, et le solde seul le ferait croire.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_mouvement_mois CASCADE;
CREATE VIEW v_stat_mouvement_mois AS
SELECT
    substr(m.date_mouvement, 1, 7)          AS annee_mois,
    m.code_type_mvt,
    tm.libelle                                   AS type_libelle,
    tm.signe,
    tm.couleur,
    COUNT(DISTINCT m.id_mouvement)               AS nb_mouvements,
    COUNT(*)                                     AS nb_lignes,
    COUNT(DISTINCT lm.code_reference)            AS nb_references,
    ROUND(SUM(lm.quantite_kg), 3)                AS quantite_kg,
    -- La valeur n'existe que pour les mouvements valorises : une sortie de
    -- production ne porte pas de prix, et lui en inventer un serait faux.
    ROUND(SUM(COALESCE(lm.total_mad, 0)), 2)     AS valeur_mad
FROM ligne_mouvement lm
JOIN mouvement       m  ON m.id_mouvement  = lm.id_mouvement
JOIN type_mouvement  tm ON tm.code_type_mvt = m.code_type_mvt
-- `tm.libelle`, `tm.signe` et `tm.couleur` dependent tous de
-- `code_type_mvt`, deja groupe. Les citer ne change rien au resultat.
GROUP BY 1, 2, tm.libelle, tm.signe, tm.couleur;

-- -----------------------------------------------------------------------------
-- v_stat_mouvement_reference
-- Ce qui bouge, et ce qui ne bouge pas.
--
-- La rotation est le rapport des sorties au stock moyen. Faute d'historique de
-- stock, on la calcule sur le stock ACTUEL : c'est une approximation, et elle
-- est signalee comme telle plutot que presentee comme un ratio comptable.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_mouvement_reference CASCADE;
CREATE VIEW v_stat_mouvement_reference AS
WITH flux AS (
    SELECT lm.code_reference,
           SUM(CASE WHEN tm.signe = 1  THEN lm.quantite_kg ELSE 0 END) AS entrees_kg,
           SUM(CASE WHEN tm.signe = -1 THEN lm.quantite_kg ELSE 0 END) AS sorties_kg,
           SUM(CASE WHEN tm.signe = 1  THEN COALESCE(lm.total_mad, 0) ELSE 0 END) AS entrees_mad,
           COUNT(*)                                                    AS nb_lignes,
           MIN(m.date_mouvement)                                       AS premier_mouvement,
           MAX(m.date_mouvement)                                       AS dernier_mouvement,
           COUNT(DISTINCT substr(m.date_mouvement, 1, 7))         AS nb_mois_actifs
      FROM ligne_mouvement lm
      JOIN mouvement      m  ON m.id_mouvement   = lm.id_mouvement
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     GROUP BY lm.code_reference
)
SELECT
    r.code_reference,
    r.designation,
    r.classe_abc,
    ROUND(COALESCE(fx.entrees_kg, 0), 3)                 AS entrees_kg,
    ROUND(COALESCE(fx.sorties_kg, 0), 3)                 AS sorties_kg,
    ROUND(COALESCE(fx.entrees_kg, 0) - COALESCE(fx.sorties_kg, 0), 3) AS solde_kg,
    ROUND(COALESCE(fx.entrees_mad, 0), 2)                AS entrees_mad,
    COALESCE(fx.nb_lignes, 0)                            AS nb_lignes,
    COALESCE(fx.nb_mois_actifs, 0)                       AS nb_mois_actifs,
    fx.premier_mouvement,
    fx.dernier_mouvement,
    ROUND(COALESCE(sd.stock_total_kg, 0), 3)             AS stock_actuel_kg,
    CASE WHEN COALESCE(sd.stock_total_kg, 0) > 0 AND COALESCE(fx.sorties_kg, 0) > 0
         THEN ROUND(fx.sorties_kg / sd.stock_total_kg, 2) END AS rotation,
    CASE WHEN fx.dernier_mouvement IS NULL THEN NULL
         ELSE CAST((current_date - (fx.dernier_mouvement)::date) AS integer)
    END                                                  AS jours_sans_mouvement
FROM reference r
LEFT JOIN flux fx               ON fx.code_reference = r.code_reference
LEFT JOIN v_stock_disponible sd ON sd.code_reference = r.code_reference
WHERE r.actif = 1;

-- -----------------------------------------------------------------------------
-- v_stat_prix_mois
-- Le prix d'achat mois par mois, en moyenne PONDEREE par les quantites.
--
-- Une moyenne simple donnerait le meme poids a une palette d'essai et a un
-- conteneur : le prix affiche ne serait celui de personne.
--
-- Les deux devises sont conservees separement. C'est ce qui permet, en aval, de
-- distinguer une hausse consentie au fournisseur d'une simple derive du change.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_prix_mois CASCADE;
CREATE VIEW v_stat_prix_mois AS
SELECT
    hp.code_reference,
    r.designation,
    substr(hp.date_achat, 1, 7)                     AS annee_mois,
    hp.code_devise,
    COUNT(*)                                             AS nb_achats,
    COUNT(DISTINCT hp.code_fournisseur)                  AS nb_fournisseurs,
    ROUND(SUM(hp.quantite_achetee_kg), 3)                AS quantite_kg,
    ROUND(SUM(hp.total_mad), 2)                          AS montant_mad,
    ROUND(SUM(hp.prix_kg_devise * hp.quantite_achetee_kg)
          / SUM(hp.quantite_achetee_kg), 4)              AS prix_moyen_devise,
    ROUND(SUM(hp.prix_kg_mad * hp.quantite_achetee_kg)
          / SUM(hp.quantite_achetee_kg), 4)              AS prix_moyen_mad,
    ROUND(SUM(hp.taux_change * hp.quantite_achetee_kg)
          / SUM(hp.quantite_achetee_kg), 4)              AS taux_moyen,
    MIN(hp.prix_kg_mad)                                  AS prix_min_mad,
    MAX(hp.prix_kg_mad)                                  AS prix_max_mad
FROM historique_prix hp
JOIN reference r ON r.code_reference = hp.code_reference
-- `r.designation` depend de `code_reference`, deja groupe.
GROUP BY hp.code_reference, r.designation, 3, hp.code_devise;

-- -----------------------------------------------------------------------------
-- v_stat_prix_reference
-- La derive du prix d'achat, DECOMPOSEE.
--
-- Un prix en MAD qui monte de 14 % ne dit pas d'ou vient la hausse. Deux causes
-- sans rapport s'y melangent :
--   * le fournisseur a augmente son tarif  -> negociation, appel d'offres ;
--   * le dirham s'est deprecie             -> couverture de change, rien a
--                                             negocier avec le fournisseur.
-- Les confondre fait reprocher au fournisseur une variation du marche des
-- devises. On les separe donc explicitement.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_prix_reference CASCADE;
CREATE VIEW v_stat_prix_reference AS
WITH bornes AS (
    SELECT code_reference,
           MIN(date_achat) AS premier,
           MAX(date_achat) AS dernier
      FROM historique_prix
     GROUP BY code_reference
),
premier AS (
    SELECT hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad, hp.taux_change,
           hp.code_devise, hp.date_achat
      FROM historique_prix hp
      JOIN bornes b ON b.code_reference = hp.code_reference AND b.premier = hp.date_achat
     GROUP BY hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad,
              hp.taux_change, hp.code_devise, hp.date_achat
),
dernier AS (
    SELECT hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad, hp.taux_change,
           hp.code_devise, hp.date_achat
      FROM historique_prix hp
      JOIN bornes b ON b.code_reference = hp.code_reference AND b.dernier = hp.date_achat
     GROUP BY hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad,
              hp.taux_change, hp.code_devise, hp.date_achat
),
cumul AS (
    SELECT code_reference,
           COUNT(*)                          AS nb_achats,
           COUNT(DISTINCT code_fournisseur)  AS nb_fournisseurs,
           ROUND(SUM(quantite_achetee_kg), 3) AS quantite_totale_kg,
           ROUND(SUM(total_mad), 2)           AS montant_total_mad,
           ROUND(SUM(prix_kg_mad * quantite_achetee_kg) / SUM(quantite_achetee_kg), 4)
                                              AS prix_moyen_mad
      FROM historique_prix
     GROUP BY code_reference
)
SELECT
    c.code_reference,
    r.designation,
    r.classe_abc,
    d.code_devise,
    c.nb_achats,
    c.nb_fournisseurs,
    c.quantite_totale_kg,
    c.montant_total_mad,
    c.prix_moyen_mad,
    p.date_achat                              AS premier_achat,
    d.date_achat                              AS dernier_achat,
    p.prix_kg_mad                             AS premier_prix_mad,
    d.prix_kg_mad                             AS dernier_prix_mad,
    p.prix_kg_devise                          AS premier_prix_devise,
    d.prix_kg_devise                          AS dernier_prix_devise,
    p.taux_change                             AS premier_taux,
    d.taux_change                             AS dernier_taux,
    -- Variation totale constatee en MAD.
    CASE WHEN p.prix_kg_mad > 0
         THEN ROUND((d.prix_kg_mad - p.prix_kg_mad) / p.prix_kg_mad * 100.0, 2) END
                                              AS derive_totale_pct,
    -- Part imputable au FOURNISSEUR : sa variation de tarif, en devise d'origine.
    CASE WHEN p.prix_kg_devise > 0
         THEN ROUND((d.prix_kg_devise - p.prix_kg_devise) / p.prix_kg_devise * 100.0, 2) END
                                              AS derive_fournisseur_pct,
    -- Part imputable au CHANGE : rien a negocier avec le fournisseur.
    CASE WHEN p.taux_change > 0
         THEN ROUND((d.taux_change - p.taux_change) / p.taux_change * 100.0, 2) END
                                              AS derive_change_pct,
    -- Effet en dirhams de la seule derive fournisseur, sur les volumes achetes :
    -- c'est le montant qu'une renegociation pourrait viser.
    CASE WHEN p.prix_kg_devise > 0
         THEN ROUND((d.prix_kg_devise - p.prix_kg_devise) * d.taux_change
                    * c.quantite_totale_kg, 2) END
                                              AS impact_fournisseur_mad
FROM cumul c
JOIN reference r ON r.code_reference = c.code_reference
JOIN premier  p  ON p.code_reference = c.code_reference
JOIN dernier  d  ON d.code_reference = c.code_reference;

-- -----------------------------------------------------------------------------
-- v_stat_fournisseur_mois
-- L'activite d'achat par fournisseur et par mois : volume, montant, ponctualite.
-- Complete v_fournisseur_scorecard, qui donne le cumul mais pas la TENDANCE.
-- Un fournisseur a 92 % d'OTIF qui se degrade depuis trois mois n'appelle pas
-- la meme decision qu'un fournisseur a 92 % qui remonte.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_fournisseur_mois CASCADE;
CREATE VIEW v_stat_fournisseur_mois AS
SELECT
    rc.code_fournisseur,
    f.nom                                        AS fournisseur_nom,
    substr(rc.date_reception, 1, 7)         AS annee_mois,
    COUNT(DISTINCT rc.id_reception)              AS nb_receptions,
    COUNT(lr.id_ligne_reception)                 AS nb_lignes,
    ROUND(SUM(lr.quantite_stock_kg), 3)          AS quantite_kg,
    ROUND(SUM(lr.quantite_stock_kg * lr.prix_kg_mad), 2) AS montant_mad,
    ROUND(100.0 * SUM(CASE WHEN lr.statut_qualite = 'CONFORME' THEN 1 ELSE 0 END)
          / COUNT(lr.id_ligne_reception), 1)     AS taux_conformite_pct,
    -- Ponctualite mesuree sur les receptions rattachables a une promesse ; les
    -- autres sont exclues du ratio plutot que comptees comme ponctuelles.
    SUM(CASE WHEN bc.date_livraison_prevue IS NOT NULL
                  AND substr(rc.date_reception, 1, 10) <= substr(bc.date_livraison_prevue, 1, 10)
             THEN 1 ELSE 0 END)                  AS nb_a_lheure,
    SUM(CASE WHEN bc.date_livraison_prevue IS NOT NULL THEN 1 ELSE 0 END) AS nb_mesurables,
    ROUND(AVG(CASE WHEN bc.date_livraison_prevue IS NOT NULL
                   THEN ((rc.date_reception)::date - (bc.date_livraison_prevue)::date) END), 1) AS retard_moyen_jours
FROM reception rc
JOIN fournisseur f       ON f.code_fournisseur = rc.code_fournisseur
JOIN ligne_reception lr  ON lr.id_reception    = rc.id_reception
LEFT JOIN ligne_bc lb    ON lb.id_ligne_bc     = lr.id_ligne_bc
LEFT JOIN bon_commande bc ON bc.id_bc          = lb.id_bc
WHERE rc.statut IN ('VALIDE','CLOTURE')
-- `f.nom` depend de `code_fournisseur`, deja groupe.
GROUP BY rc.code_fournisseur, f.nom, 3;

-- -----------------------------------------------------------------------------
-- v_stat_qualite
-- Ce que coute et ce que produit chaque qualite.
--
-- Le cout matiere au m2 est la somme, sur la recette, de (kg/m2 x CMUP). Il ne
-- vaut que ce que valent les CMUP : une reference jamais entree en stock n'en a
-- pas, et sa part manque au total. Le nombre de matieres SANS CMUP est donc
-- publie a cote du cout — un cout qui ignore en silence trois composants sur
-- douze est plus dangereux qu'une absence de cout.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_qualite CASCADE;
CREATE VIEW v_stat_qualite AS
WITH cout AS (
    SELECT rc.code_qualite,
           COUNT(*)                                         AS nb_composants,
           COUNT(DISTINCT rc.code_role)                     AS nb_roles,
           SUM(CASE WHEN COALESCE(sd.valeur_totale_mad, 0) > 0
                     AND COALESCE(sd.stock_total_kg, 0) > 0 THEN 0 ELSE 1 END)
                                                            AS nb_sans_cmup,
           ROUND(SUM(rc.kg_m2), 6)                          AS kg_m2_total,
           ROUND(SUM(rc.kg_m2 * CASE WHEN COALESCE(sd.stock_total_kg, 0) > 0
                                     THEN sd.valeur_totale_mad / sd.stock_total_kg
                                     ELSE 0 END), 4)        AS cout_matiere_m2_mad
      FROM v_recette_calculee rc
      LEFT JOIN v_stock_disponible sd ON sd.code_reference = rc.code_reference
     GROUP BY rc.code_qualite
),
production AS (
    SELECT lpp.code_qualite,
           ROUND(SUM(lpp.m2_prevus), 0)                     AS m2_prevus,
           ROUND(SUM(COALESCE(lpp.m2_realises, 0)), 0)      AS m2_realises,
           COUNT(*)                                         AS nb_mois_planifies
      FROM ligne_plan_production lpp
      JOIN plan_production pp ON pp.id_plan = lpp.id_plan
     WHERE pp.statut = 'EN_COURS'
     GROUP BY lpp.code_qualite
)
SELECT
    q.code_qualite,
    q.nom                                        AS qualite_nom,
    q.statut,
    q.poids_commercial_m2,
    q.taux_perte_pct,
    COALESCE(c.nb_composants, 0)                 AS nb_composants,
    COALESCE(c.nb_roles, 0)                      AS nb_roles,
    COALESCE(c.nb_sans_cmup, 0)                  AS nb_sans_cmup,
    c.kg_m2_total,
    c.cout_matiere_m2_mad,
    -- Ecart entre le poids commercial declare et la somme des kg/m2 de la
    -- recette : au-dela du bruit d'arrondi, la recette et la fiche produit ne
    -- decrivent plus le meme tapis.
    CASE WHEN q.poids_commercial_m2 > 0 AND c.kg_m2_total IS NOT NULL
         THEN ROUND((c.kg_m2_total - q.poids_commercial_m2) / q.poids_commercial_m2 * 100.0, 2)
    END                                          AS ecart_poids_pct,
    COALESCE(p.m2_prevus, 0)                     AS m2_prevus,
    COALESCE(p.m2_realises, 0)                   AS m2_realises,
    COALESCE(p.nb_mois_planifies, 0)             AS nb_mois_planifies,
    CASE WHEN COALESCE(p.m2_prevus, 0) > 0
         THEN ROUND(100.0 * COALESCE(p.m2_realises, 0) / p.m2_prevus, 1) END
                                                 AS taux_realisation_pct,
    CASE WHEN c.cout_matiere_m2_mad IS NOT NULL AND COALESCE(p.m2_prevus, 0) > 0
         THEN ROUND(c.cout_matiere_m2_mad * p.m2_prevus, 2) END
                                                 AS cout_matiere_plan_mad
FROM qualite q
LEFT JOIN cout       c ON c.code_qualite = q.code_qualite
LEFT JOIN production p ON p.code_qualite = q.code_qualite;

-- -----------------------------------------------------------------------------
-- v_stat_qualite_role
-- La ventilation du cout d'une qualite PAR ROLE (trame, chaine, latex...).
-- C'est le niveau ou une decision se prend : on ne change pas « la recette »,
-- on change le melange d'un role.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stat_qualite_role CASCADE;
CREATE VIEW v_stat_qualite_role AS
SELECT
    rc.code_qualite,
    rc.code_role,
    rc.role_libelle,
    COUNT(*)                                     AS nb_composants,
    ROUND(SUM(rc.pourcentage_composition), 2)    AS somme_pct,
    ROUND(SUM(rc.kg_m2), 6)                      AS kg_m2,
    ROUND(SUM(rc.kg_m2 * CASE WHEN COALESCE(sd.stock_total_kg, 0) > 0
                              THEN sd.valeur_totale_mad / sd.stock_total_kg
                              ELSE 0 END), 4)    AS cout_m2_mad
FROM v_recette_calculee rc
LEFT JOIN v_stock_disponible sd ON sd.code_reference = rc.code_reference
-- `rc.role_libelle` depend de `code_role`, deja groupe.
GROUP BY rc.code_qualite, rc.code_role, rc.role_libelle;

-- =============================================================================
-- 9. EQUIVALENCES DE REFERENCES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_equivalence
-- « Quels equivalents pour cette reference ? » — sans condition.
--
-- v_substitution_dispo repond a une autre question : « ou une rupture est-elle
-- couvrable tout de suite ». Elle filtre donc deux fois — la principale doit
-- etre en RUPTURE ou CRITIQUE, le substitut doit avoir du stock. Excellente
-- pour le cockpit, inutilisable partout ailleurs : au moment de commander, de
-- receptionner ou de sortir de la matiere, on a besoin de connaitre les
-- equivalents AVANT que la situation ne se degrade.
--
-- Cette vue-ci ne filtre rien d'autre que l'activite des rattachements. Les
-- deux cotes portent leur stock et leur statut : c'est a l'ecran de decider ce
-- qu'il met en avant.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_equivalence CASCADE;
CREATE VIEW v_equivalence AS
SELECT
    rge1.code_groupe_equiv,
    ge.libelle                          AS groupe_libelle,

    r1.code_reference,
    r1.designation,
    r1.code_fournisseur,
    f1.nom                              AS fournisseur_nom,
    rge1.priorite,
    rge1.est_preferentielle,
    r1.unite_catalogue,
    COALESCE(sd1.stock_mrp_kg, 0)       AS stock_kg,
    sp1.stock_projete_kg,
    sp1.statut,
    COALESCE(b1.besoin_12m_kg, 0)       AS besoin_12m_kg,

    r2.code_reference                   AS equivalent_reference,
    r2.designation                      AS equivalent_designation,
    r2.code_fournisseur                 AS equivalent_fournisseur,
    f2.nom                              AS equivalent_fournisseur_nom,
    COALESCE(f2.delai_livraison_jours,
             (SELECT CAST(valeur_courante AS integer) FROM parametre
               WHERE code_parametre = 'P_DelaiDefaut')) AS equivalent_delai_jours,
    rge2.priorite                       AS equivalent_priorite,
    rge2.est_preferentielle             AS equivalent_preferentielle,
    r2.unite_catalogue                  AS equivalent_unite,
    r2.prix_catalogue_kg                AS equivalent_prix_catalogue_kg,
    r2.code_devise_catalogue            AS equivalent_devise,
    COALESCE(sd2.stock_mrp_kg, 0)       AS equivalent_stock_kg,
    sp2.stock_projete_kg                AS equivalent_stock_projete_kg,
    sp2.statut                          AS equivalent_statut,
    COALESCE(b2.besoin_12m_kg, 0)       AS equivalent_besoin_12m_kg,

    -- Deux references du meme groupe chez le MEME fournisseur ne sont pas une
    -- securite d'approvisionnement : elles tombent ensemble. La distinction
    -- doit se voir, sinon le mono-source se cache derriere un groupe de deux.
    CASE WHEN r1.code_fournisseur = r2.code_fournisseur THEN 1 ELSE 0 END
                                        AS meme_fournisseur,
    -- Substituer suppose la meme unite canonique et la meme densite : sinon le
    -- kg/m2 de la recette ne tient plus. Publie plutot que suppose.
    CASE WHEN r1.unite_catalogue = r2.unite_catalogue
          AND COALESCE(r1.densite_kg_ml, -1) = COALESCE(r2.densite_kg_ml, -1)
          AND r1.code_categorie = r2.code_categorie
         THEN 1 ELSE 0 END              AS interchangeable

FROM reference_groupe_equiv rge1
JOIN groupe_equiv           ge   ON ge.code_groupe_equiv  = rge1.code_groupe_equiv
                                AND ge.actif = 1
JOIN reference              r1   ON r1.code_reference     = rge1.code_reference
JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                AND rge2.code_reference   <> rge1.code_reference
                                AND rge2.actif = 1
JOIN reference              r2   ON r2.code_reference     = rge2.code_reference
LEFT JOIN fournisseur       f1   ON f1.code_fournisseur   = r1.code_fournisseur
LEFT JOIN fournisseur       f2   ON f2.code_fournisseur   = r2.code_fournisseur
LEFT JOIN v_stock_disponible sd1 ON sd1.code_reference    = r1.code_reference
LEFT JOIN v_stock_disponible sd2 ON sd2.code_reference    = r2.code_reference
LEFT JOIN v_stock_projete    sp1 ON sp1.code_reference    = r1.code_reference
LEFT JOIN v_stock_projete    sp2 ON sp2.code_reference    = r2.code_reference
LEFT JOIN v_besoin_12m       b1  ON b1.code_reference     = r1.code_reference
LEFT JOIN v_besoin_12m       b2  ON b2.code_reference     = r2.code_reference
WHERE rge1.actif = 1
  AND r1.actif = 1
  AND r2.actif = 1;

-- -----------------------------------------------------------------------------
-- v_groupe_equiv_detail
-- Une ligne par groupe : de quoi administrer, et de quoi controler.
--
-- Un groupe n'a d'interet que s'il offre une VRAIE alternative. Trois choses le
-- disqualifient, et elles sont comptees ici plutot que devinees : une seule
-- reference, des references heterogenes (substituer casserait le kg/m2), ou
-- toutes chez le meme fournisseur (elles tombent ensemble).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_groupe_equiv_detail CASCADE;
CREATE VIEW v_groupe_equiv_detail AS
SELECT
    g.code_groupe_equiv,
    g.libelle,
    g.description,
    g.actif,
    COUNT(rge.code_reference)                                   AS nb_references,
    COUNT(DISTINCT r.code_fournisseur)                          AS nb_fournisseurs,
    COUNT(DISTINCT r.unite_catalogue)                           AS nb_unites,
    COUNT(DISTINCT COALESCE(r.densite_kg_ml, -1))               AS nb_densites,
    COUNT(DISTINCT r.code_categorie)                            AS nb_categories,
    SUM(rge.est_preferentielle)                                 AS nb_preferentielles,
    SUM(CASE WHEN COALESCE(sd.stock_mrp_kg, 0) > 0 THEN 1 ELSE 0 END) AS nb_avec_stock,
    SUM(CASE WHEN COALESCE(b.besoin_12m_kg, 0) > 0 THEN 1 ELSE 0 END) AS nb_avec_besoin,
    ROUND(SUM(COALESCE(sd.stock_mrp_kg, 0)), 3)                 AS stock_cumule_kg,
    ROUND(SUM(COALESCE(b.besoin_12m_kg, 0)), 3)                 AS besoin_cumule_kg,
    -- Le groupe protege-t-il reellement d'une rupture d'approvisionnement ?
    CASE WHEN COUNT(rge.code_reference) < 2            THEN 'MONO-REFERENCE'
         WHEN COUNT(DISTINCT r.unite_catalogue) > 1
           OR COUNT(DISTINCT COALESCE(r.densite_kg_ml, -1)) > 1
           OR COUNT(DISTINCT r.code_categorie) > 1     THEN 'HETEROGENE'
         WHEN COUNT(DISTINCT r.code_fournisseur) < 2   THEN 'MEME FOURNISSEUR'
         ELSE 'ALTERNATIF' END                                  AS qualification
FROM groupe_equiv g
LEFT JOIN reference_groupe_equiv rge ON rge.code_groupe_equiv = g.code_groupe_equiv
                                    AND rge.actif = 1
LEFT JOIN reference              r   ON r.code_reference      = rge.code_reference
                                    AND r.actif = 1
LEFT JOIN v_stock_disponible     sd  ON sd.code_reference     = rge.code_reference
LEFT JOIN v_besoin_12m           b   ON b.code_reference      = rge.code_reference
GROUP BY g.code_groupe_equiv;

-- -----------------------------------------------------------------------------
-- v_stock_transit
-- Ce qui est parti d'un magasin sans etre encore arrive dans l'autre.
--
-- C'est un etat REEL, parfois de plusieurs jours, et il n'apparaissait nulle
-- part : la marchandise sortait du stock source et surgissait a destination au
-- meme instant. Desormais elle disparait des deux tant que personne n'a
-- constate l'arrivee — et cette vue est ce qui l'empeche d'etre perdue de vue.
--
-- Elle ne compte PAS dans le stock disponible : la matiere n'est ni dans un
-- magasin ni utilisable. L'y inclure ferait planifier une production sur ce qui
-- est encore dans le camion.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_transit CASCADE;
CREATE VIEW v_stock_transit AS
SELECT
    t.id_transfert,
    t.numero_transfert,
    t.date_transfert,
    t.code_magasin_source,
    ms.nom                                  AS magasin_source_nom,
    t.code_magasin_dest,
    md.nom                                  AS magasin_dest_nom,
    u.login                                 AS expediteur,
    lt.code_reference,
    r.designation,
    lt.lot_fournisseur,
    ROUND(lt.quantite_kg, 4)                AS quantite_kg,
    lt.prix_kg_mad,
    ROUND(lt.quantite_kg * COALESCE(lt.prix_kg_mad, 0), 2) AS valeur_mad,
    -- Depuis combien de jours la marchandise est-elle en route ? Au-dela de
    -- quelques jours pour un transfert interne, c'est qu'on a oublie de
    -- constater l'arrivee — ou que la marchandise s'est perdue.
    CAST((current_date - (t.date_transfert)::date) AS integer) AS jours_en_transit
FROM transfert t
JOIN ligne_transfert lt ON lt.id_transfert = t.id_transfert
JOIN reference r        ON r.code_reference = lt.code_reference
LEFT JOIN magasin ms    ON ms.code_magasin = t.code_magasin_source
LEFT JOIN magasin md    ON md.code_magasin = t.code_magasin_dest
LEFT JOIN utilisateur u ON u.id_utilisateur = t.id_utilisateur
WHERE t.statut = 'VALIDE';
