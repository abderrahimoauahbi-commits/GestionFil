-- =============================================================================
-- 2026-10-27g — Le grand livre de la consommation (lots L0 et L1)
-- =============================================================================
-- DÉCISIONS DE LA DIRECTION DU 27/10/2026 (docs/A-DECIDER-analyse-consommation.md,
-- Q1, Q2, Q5 à Q9, Q11) et « deux chiffres séparés » :
--
--   * UNE SOURCE DU RÉEL : `v_consommation_fait`, une ligne par FAIT, posée sur les
--     deux registres immuables — les décisions machine ACTIVES (une décision
--     retirée ou annulée n'a pas eu lieu) et les mouvements NON contre-passés (ni
--     l'original ni sa contre-passation). Ce n'est ni un stock ni un journal de
--     plus : une vue qui RANGE, elle ne calcule rien par la recette.
--   * Q5 : un fait machine est daté au JOUR DE LA FICHE (machine_fiche.date_fiche),
--     jamais à la validation. Q7 : un retour se déduit au jour du retour.
--   * Q8 : corrections (MJ_CORRECTION), écarts non qualifiés, régularisations,
--     erreurs de saisie et ajustements d'inventaire sont HORS réel : nature
--     AUTRE_ECART, montrée à part (colonne `categorie_ecart`).
--   * Q2 : le réel d'achat COMPTE le rebut (déchet, perte, casse : écarts et
--     déchargements vers le rebut ; sortie production = déchet).
--   * Q6 : les moyennes portent sur les 12 MOIS PLEINS GLISSANTS — les 12 mois
--     calendaires complets qui précèdent le mois en cours (au 27/10/2026 : du
--     01/10/2025 au 30/09/2026). Le mois en cours n'y entre pas : il n'est pas plein.
--     Un mois sans consommation compte pour zéro. `v_conso_fenetre`.
--   * Q9 : sans OF ni qualité, « Non attribué » — jamais réparti.
--   * Q11 : la valeur est le prix de sortie porté par le mouvement ; un fait
--     machine (écart, déchargement au rebut) n'a pas de mouvement : il est valorisé
--     au CMUP DU JOUR DU FAIT. IL N'EXISTE PAS D'HISTORIQUE DU CMUP (valorisation_stock
--     est vide, aucun journal du CMUP) : le CMUP d'un jour passé se RECONSTITUE par
--     le coût de la dernière sortie de la référence datée au plus tard ce jour-là
--     (trg_lmvt_cout_sortie écrit sur chaque sortie le CMUP du magasin à l'instant
--     de la sortie) ; à défaut, le CMUP actuel de la fiche. `prix_source` dit lequel
--     a servi (DECISION, MOUVEMENT, SORTIE_DU_JOUR, CMUP_ACTUEL) : le défaut est
--     signalé sur la ligne, jamais caché.
--
-- « DEUX CHIFFRES SÉPARÉS » : le « plus grand des deux » (v_conso_retenue = max(réel,
-- plan moyen)) est SUPPRIMÉ, et avec lui v_stock_min_dynamique, qui le lisait. Le
-- « Réel / mois » (`reel_mois_kg`) vient du grand livre, 12 mois pleins ; le « Plan /
-- mois » vient du moteur de couverture (plan_mois_kg, en Rust). Chaque vue d'analyse
-- est redéfinie sur l'un ou l'autre, explicitement :
--   RÉEL (constat du passé) : Pareto, analyse ABC/XYZ, budget par fournisseur et par
--     devise, budget mono-source et palier du risque de sourcing, rotation, coût
--     matière annuel / DIO / DPO (route), C50 ;
--   PLAN / MOTEUR (avenir) : économies identifiées (calculées par la route au
--     plan du moteur), stock minimum affiché (= sécurité du jour du moteur),
--     couverture du stock, « trop tard pour commander ».
--
-- LES SIX DÉFINITIONS CONCURRENTES (étude §1.2) deviennent des AGRÉGATS du grand
-- livre, MÊMES COLONNES EN SORTIE :
--   D1 v_conso_reelle (12 mois pleins, rebut compris, colonnes ajoutées en fin),
--   D2 la requête XYZ (backend/src/domain/classification.rs, sur v_conso_reelle_mois),
--   D3 v_of_consommation (→ v_of_bilan, C61), D4 v_qualite_consommation (le hors
--   machine historique y entre enfin, sous sa qualité ou « Non attribué »),
--   D5 f_machine_consommation (+ colonne correction_kg : la correction quitte la
--   consommation, Q8) ; D6 v_machine_consommation, sans lecteur et fausse, est RETIRÉE.
--
-- CONTRÔLE C67 (signal, jamais bloquant) : le rapprochement machine, par référence —
-- chargé − déchargé au magasin − variation de l'état machine = faits machine du
-- grand livre (consommation + rebut + autres écarts). Tolérance : 0,01 kg, un
-- seuil TECHNIQUE d'arrondi (les kilos sont écrits à 4 décimales) ; les seuils
-- d'écart existants (P_MachineEcartVert/Rouge) qualifient une MESURE de ligne, pas
-- l'accord de deux registres, et masqueraient un vrai désaccord.
--
-- Hors de ce lot (L3) : l'étalon figé de l'OF, l'écart sur OF clôturés seulement, la
-- substitution ; C61 compare toujours un prévu « perte comprise » à un réel sans
-- rebut, et v_of_bilan montre −100 % sur un OF lancé. v_qualite_consommation garde
-- sa part OF au mois de l'OF (sa part sans OF est au mois du fait).
--
-- Rejouable. Enregistrée par migrer.py. Exigée au démarrage (backend/src/db.rs).
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- 1. La fenêtre des 12 mois pleins glissants
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_conso_fenetre AS
SELECT (date_trunc('month', (now() AT TIME ZONE 'Africa/Casablanca')::date) - interval '12 months')::date AS debut,
       date_trunc('month', (now() AT TIME ZONE 'Africa/Casablanca')::date)::date                           AS fin,
       12::bigint                                                                                            AS nb_mois;
ALTER VIEW v_conso_fenetre OWNER TO gestionfil;
COMMENT ON VIEW v_conso_fenetre IS
    'Les 12 mois pleins glissants : [debut, fin[ = les 12 mois calendaires complets qui precedent le mois en cours (jour de Casablanca).';

-- -----------------------------------------------------------------------------
-- 2. Le grand livre de la consommation
-- -----------------------------------------------------------------------------
-- Un fait machine porte sa ligne de décision : un ÉCART qualifié (effet autre
-- qu'AUCUN, écart non nul) et/ou un DÉCHARGEMENT vers le rebut (déchet, perte,
-- casse : aucun mouvement, le fil était sorti du magasin au chargement). Le
-- chargement, le retour au magasin, les transferts, les retours fournisseur et le
-- prêt ne sont PAS des consommations : ils n'y sont pas.
--
-- kg SIGNÉ : positif = matière partie (consommée, rebutée, perdue à l'inventaire),
-- négatif = matière revenue (retour de consommation, ajustement d'inventaire +,
-- régularisation d'un constat supérieur à l'attendu).
CREATE OR REPLACE VIEW v_consommation_fait AS
WITH decision AS (
    SELECT d.id_decision, f.numero_fiche, d.code_machine, d.code_emplacement,
           COALESCE(f.responsable, d.responsable)                                     AS responsable,
           COALESCE(f.date_fiche, (d.date_decision AT TIME ZONE 'Africa/Casablanca')::date) AS date_fait,
           l.ligne_numero, l.code_reference, l.lot_fournisseur,
           l.ecart_kg, COALESCE(l.effet_ecart, 'AUCUN') AS effet_ecart, l.code_motif,
           l.destination, l.kg_mouvementes,
           l.id_of_periode                                                            AS id_of,
           COALESCE(o.code_qualite, l.code_qualite_periode)                           AS code_qualite,
           CASE WHEN l.id_of_periode IS NOT NULL THEN 'OF'
                WHEN l.code_qualite_periode IS NOT NULL THEN 'QUALITE'
                ELSE 'NON_ATTRIBUE' END                                               AS attribution,
           (SELECT fl.mode_constat FROM machine_fiche_ligne fl
             WHERE fl.id_fiche = d.id_fiche AND fl.code_reference = l.code_reference
               AND fl.lot_fournisseur = l.lot_fournisseur
             ORDER BY fl.ligne_numero LIMIT 1)                                         AS mode_mesure,
           NULLIF(l.cmup_mad, 0)                                                      AS cmup_decision,
           r.cmup_mad                                                                 AS cmup_actuel
      FROM machine_decision d
      JOIN machine_decision_ligne l ON l.id_decision = d.id_decision
      JOIN reference r              ON r.code_reference = l.code_reference
      LEFT JOIN machine_fiche f     ON f.id_fiche = d.id_fiche
      LEFT JOIN ordre_fabrication o ON o.id_of = l.id_of_periode
     -- Toutes les decisions ACTIVES (une fiche de depart n'a pas de ligne : elle ne
     -- porte qu'un etat ; la date d'une decision sans fiche est celle de sa validation).
     WHERE d.statut = 'ACTIVE'
       AND ((COALESCE(l.effet_ecart, 'AUCUN') <> 'AUCUN' AND l.ecart_kg <> 0)
            OR (l.destination IN ('DECHET', 'PERTE', 'CASSE') AND l.kg_mouvementes > 0))
),
sorties AS (
    -- Les sorties valorisées : chacune porte le CMUP du magasin à l'instant de la
    -- sortie (trg_lmvt_cout_sortie). Le CMUP d'un jour passé se reconstitue par la
    -- dernière d'entre elles datée au plus tard ce jour-là (voir l'en-tête).
    SELECT lm.code_reference, m.date_mouvement, m.date_creation, lm.ligne_numero, lm.prix_kg_mad
      FROM ligne_mouvement lm
      JOIN mouvement m       ON m.id_mouvement = lm.id_mouvement
      JOIN type_mouvement t  ON t.code_type_mvt = m.code_type_mvt
     WHERE t.signe = -1 AND lm.prix_kg_mad > 0
),
decision_prix AS (
    SELECT DISTINCT ON (x.id_decision, x.ligne_numero)
           x.*, s.prix_kg_mad AS cmup_du_jour
      FROM decision x
      LEFT JOIN sorties s ON x.cmup_decision IS NULL
                         AND s.code_reference = x.code_reference
                         AND s.date_mouvement <= x.date_fait
     ORDER BY x.id_decision, x.ligne_numero,
              s.date_mouvement DESC NULLS LAST, s.date_creation DESC NULLS LAST, s.ligne_numero DESC NULLS LAST
),
faits_machine AS (
    SELECT 'DECISION'::text AS source, x.id_decision AS id_source, x.ligne_numero, 'ECART'::text AS composante,
           x.numero_fiche AS numero_document, x.date_fait,
           CASE WHEN x.effet_ecart = 'CONSOMMATION' AND x.code_motif <> 'MJ_CORRECTION' THEN 'CONSOMMATION_MACHINE'
                WHEN x.effet_ecart IN ('DECHET', 'PERTE', 'CASSE') THEN 'REBUT_' || x.effet_ecart
                ELSE 'AUTRE_ECART' END AS nature,
           CASE WHEN x.effet_ecart = 'CONSOMMATION' AND x.code_motif = 'MJ_CORRECTION' THEN 'CORRECTION'
                WHEN x.effet_ecart IN ('NON_QUALIFIE', 'REGULARISATION', 'ERREUR_SAISIE') THEN x.effet_ecart
                END AS categorie_ecart,
           x.ecart_kg AS kg,
           x.code_reference, x.lot_fournisseur, x.code_machine, x.code_emplacement, x.code_motif,
           x.responsable, x.id_of, x.code_qualite, x.attribution, x.mode_mesure,
           x.cmup_decision, x.cmup_du_jour, x.cmup_actuel
      FROM decision_prix x
     WHERE x.effet_ecart <> 'AUCUN' AND x.ecart_kg <> 0
    UNION ALL
    SELECT 'DECISION', x.id_decision, x.ligne_numero, 'DECHARGEMENT',
           x.numero_fiche, x.date_fait,
           'REBUT_' || x.destination, NULL,
           x.kg_mouvementes,
           x.code_reference, x.lot_fournisseur, x.code_machine, x.code_emplacement, x.code_motif,
           x.responsable, x.id_of, x.code_qualite, x.attribution, x.mode_mesure,
           x.cmup_decision, x.cmup_du_jour, x.cmup_actuel
      FROM decision_prix x
     WHERE x.destination IN ('DECHET', 'PERTE', 'CASSE') AND x.kg_mouvementes > 0
),
mvt AS (
    SELECT m.id_mouvement, m.numero_mouvement, m.date_mouvement, m.code_type_mvt, m.code_motif,
           m.responsable, m.id_of, m.code_qualite AS code_qualite_mvt,
           lm.ligne_numero, lm.code_reference, lm.lot_fournisseur, lm.quantite_kg,
           NULLIF(lm.prix_kg_mad, 0) AS prix_mouvement, lm.code_motif_ligne, lm.mode_pesee,
           r.cmup_mad AS cmup_actuel
      FROM mouvement m
      JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
      JOIN reference r        ON r.code_reference = lm.code_reference
     WHERE m.id_mouvement_contrepasse IS NULL
       AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
       AND (m.code_type_mvt IN ('CONSO_DIRECTE', 'RETOUR_CONSO', 'SORTIE_PROD', 'AJUST_INV_NEG', 'AJUST_INV_POS')
            OR (m.code_type_mvt = 'SORTIE_HORS_MACHINE' AND COALESCE(lm.code_motif_ligne, '') <> 'HM_PRET'))
),
mvt_prix AS (
    SELECT DISTINCT ON (x.id_mouvement, x.ligne_numero)
           x.*, s.prix_kg_mad AS cmup_du_jour
      FROM mvt x
      LEFT JOIN sorties s ON x.prix_mouvement IS NULL
                         AND s.code_reference = x.code_reference
                         AND s.date_mouvement <= x.date_mouvement
     ORDER BY x.id_mouvement, x.ligne_numero,
              s.date_mouvement DESC NULLS LAST, s.date_creation DESC NULLS LAST, s.ligne_numero DESC NULLS LAST
),
faits_mvt AS (
    SELECT 'MOUVEMENT'::text AS source, x.id_mouvement AS id_source, x.ligne_numero, 'MOUVEMENT'::text AS composante,
           x.numero_mouvement AS numero_document, x.date_mouvement AS date_fait,
           CASE x.code_type_mvt
                WHEN 'CONSO_DIRECTE'       THEN 'CONSOMMATION_DIRECTE'
                WHEN 'RETOUR_CONSO'        THEN 'RETOUR_CONSO'
                WHEN 'SORTIE_HORS_MACHINE' THEN 'HORS_MACHINE'
                WHEN 'SORTIE_PROD'         THEN 'REBUT_DECHET'
                ELSE 'AUTRE_ECART' END AS nature,
           CASE WHEN x.code_type_mvt IN ('AJUST_INV_NEG', 'AJUST_INV_POS') THEN 'AJUSTEMENT_INVENTAIRE' END AS categorie_ecart,
           CASE WHEN x.code_type_mvt IN ('RETOUR_CONSO', 'AJUST_INV_POS') THEN -x.quantite_kg ELSE x.quantite_kg END AS kg,
           x.code_type_mvt,
           COALESCE(x.code_motif_ligne, x.code_motif) AS code_motif,
           x.responsable, x.code_reference, x.lot_fournisseur, x.id_of,
           COALESCE(o.code_qualite, x.code_qualite_mvt) AS code_qualite,
           CASE WHEN x.id_of IS NOT NULL THEN 'OF'
                WHEN x.code_qualite_mvt IS NOT NULL THEN 'QUALITE'
                ELSE 'NON_ATTRIBUE' END AS attribution,
           x.mode_pesee AS mode_mesure,
           x.prix_mouvement,
           x.cmup_du_jour,
           x.cmup_actuel
      FROM mvt_prix x
      LEFT JOIN ordre_fabrication o ON o.id_of = x.id_of
),
faits AS (
    SELECT fm.source, fm.id_source, fm.ligne_numero, fm.composante, fm.numero_document, fm.date_fait,
           fm.nature, fm.categorie_ecart, fm.kg,
           COALESCE(fm.cmup_decision, fm.cmup_du_jour, fm.cmup_actuel) AS prix_kg_mad,
           CASE WHEN fm.cmup_decision IS NOT NULL THEN 'DECISION'
                WHEN fm.cmup_du_jour IS NOT NULL THEN 'SORTIE_DU_JOUR'
                WHEN fm.cmup_actuel IS NOT NULL THEN 'CMUP_ACTUEL' END AS prix_source,
           fm.code_reference, fm.lot_fournisseur, NULL::text AS code_type_mvt,
           fm.code_machine, fm.code_emplacement, fm.code_motif, fm.responsable,
           fm.id_of, fm.code_qualite, fm.attribution, fm.mode_mesure
      FROM faits_machine fm
    UNION ALL
    SELECT v.source, v.id_source, v.ligne_numero, v.composante, v.numero_document, v.date_fait,
           v.nature, v.categorie_ecart, v.kg,
           COALESCE(v.prix_mouvement, v.cmup_du_jour, v.cmup_actuel),
           CASE WHEN v.prix_mouvement IS NOT NULL THEN 'MOUVEMENT'
                WHEN v.cmup_du_jour IS NOT NULL THEN 'SORTIE_DU_JOUR'
                WHEN v.cmup_actuel IS NOT NULL THEN 'CMUP_ACTUEL' END,
           v.code_reference, v.lot_fournisseur, v.code_type_mvt,
           NULL::text, NULL::text, v.code_motif, v.responsable,
           v.id_of, v.code_qualite, v.attribution, v.mode_mesure
      FROM faits_mvt v
)
SELECT g.source,
       g.id_source,
       g.ligne_numero,
       g.composante,
       g.numero_document,
       g.date_fait,
       to_char(g.date_fait, 'YYYY-MM')                     AS mois,
       g.nature,
       g.categorie_ecart,
       (g.nature <> 'AUTRE_ECART')                         AS dans_reel,
       ROUND(g.kg, 4)                                      AS kg,
       ROUND(g.prix_kg_mad, 4)                             AS prix_kg_mad,
       ROUND(g.kg * g.prix_kg_mad, 2)                      AS valeur_mad,
       g.prix_source,
       g.code_reference,
       g.lot_fournisseur,
       g.code_type_mvt,
       g.code_machine,
       g.code_emplacement,
       g.code_motif,
       g.responsable,
       g.id_of,
       g.code_qualite,
       COALESCE(q.nom, 'Non attribué')                     AS qualite_libelle,
       g.attribution,
       g.mode_mesure
  FROM faits g
  LEFT JOIN qualite q ON q.code_qualite = g.code_qualite;
ALTER VIEW v_consommation_fait OWNER TO gestionfil;
COMMENT ON VIEW v_consommation_fait IS
    'Grand livre de la consommation (27/10/2026) : une ligne par fait, decisions machine actives (date de la fiche) et mouvements non contre-passes. dans_reel = tout sauf AUTRE_ECART (corrections, non qualifies, regularisations, erreurs, ajustements d inventaire).';

-- -----------------------------------------------------------------------------
-- 3. Le réel par mois, dans la fenêtre (XYZ, tendance, rotation)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_conso_reelle_mois AS
SELECT g.code_reference,
       g.mois,
       ROUND(COALESCE(SUM(g.kg) FILTER (WHERE g.dans_reel), 0), 4)                   AS kg_reel,
       ROUND(COALESCE(SUM(g.kg) FILTER (WHERE g.nature LIKE 'REBUT\_%'), 0), 4)       AS kg_rebut,
       ROUND(COALESCE(SUM(g.kg) FILTER (WHERE NOT g.dans_reel), 0), 4)               AS kg_autres_ecarts,
       ROUND(COALESCE(SUM(g.valeur_mad) FILTER (WHERE g.dans_reel), 0), 2)           AS valeur_mad
  FROM v_consommation_fait g
  CROSS JOIN v_conso_fenetre f
 WHERE g.date_fait >= f.debut AND g.date_fait < f.fin
 GROUP BY g.code_reference, g.mois;
ALTER VIEW v_conso_reelle_mois OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 4. D1 — v_conso_reelle : agrégat du grand livre, mêmes colonnes (+ en fin)
-- -----------------------------------------------------------------------------
-- sorties_cumulees_kg = le réel d'achat des 12 mois pleins (consommation + rebut −
-- retours) ; conso_mensuelle_kg = ce réel ÷ 12 (le « Réel / mois ») ;
-- nb_mois_ecoules = les mois pleins d'historique dans la fenêtre (0 à 12) ;
-- premiere/derniere_sortie = premier et dernier fait du grand livre (tout l'historique).
-- sorties_prod_kg = la part des mouvements, conso_machine_kg = la part des machines.
CREATE OR REPLACE VIEW v_conso_reelle AS
WITH f AS (SELECT debut, fin FROM v_conso_fenetre),
agg AS (
    SELECT g.code_reference,
           SUM(g.kg) FILTER (WHERE g.dans_reel AND g.date_fait >= f.debut AND g.date_fait < f.fin)                       AS reel_kg,
           SUM(g.kg) FILTER (WHERE g.dans_reel AND g.source = 'MOUVEMENT' AND g.date_fait >= f.debut AND g.date_fait < f.fin) AS reel_mvt_kg,
           SUM(g.kg) FILTER (WHERE g.dans_reel AND g.source = 'DECISION'  AND g.date_fait >= f.debut AND g.date_fait < f.fin) AS reel_machine_kg,
           SUM(g.valeur_mad) FILTER (WHERE g.dans_reel AND g.date_fait >= f.debut AND g.date_fait < f.fin)               AS valeur_mad,
           SUM(g.kg) FILTER (WHERE g.nature LIKE 'REBUT\_%' AND g.date_fait >= f.debut AND g.date_fait < f.fin)          AS rebut_kg,
           SUM(g.kg) FILTER (WHERE NOT g.dans_reel AND g.date_fait >= f.debut AND g.date_fait < f.fin)                   AS autres_kg,
           MIN(g.date_fait) AS premier,
           MAX(g.date_fait) AS dernier,
           MAX(f.debut) AS debut,
           MAX(f.fin) AS fin
      FROM v_consommation_fait g
      CROSS JOIN f
     GROUP BY g.code_reference
)
SELECT a.code_reference,
       ROUND(COALESCE(a.reel_kg, 0), 4)                                         AS sorties_cumulees_kg,
       GREATEST(0, LEAST(12, (EXTRACT(YEAR FROM age(a.fin, date_trunc('month', a.premier)::date)) * 12
                              + EXTRACT(MONTH FROM age(a.fin, date_trunc('month', a.premier)::date)))))::bigint
                                                                                AS nb_mois_ecoules,
       ROUND(COALESCE(a.reel_kg, 0) / 12.0, 4)                                  AS conso_mensuelle_kg,
       to_char(a.premier, 'YYYY-MM-DD')                                         AS premiere_sortie,
       to_char(a.dernier, 'YYYY-MM-DD')                                         AS derniere_sortie,
       ROUND(COALESCE(a.reel_mvt_kg, 0), 4)                                     AS sorties_prod_kg,
       ROUND(COALESCE(a.reel_machine_kg, 0), 4)                                 AS conso_machine_kg,
       ROUND(COALESCE(a.reel_kg, 0), 4)                                         AS reel_12m_kg,
       ROUND(COALESCE(a.valeur_mad, 0), 2)                                      AS valeur_12m_mad,
       ROUND(COALESCE(a.rebut_kg, 0), 4)                                        AS rebut_12m_kg,
       ROUND(COALESCE(a.autres_kg, 0), 4)                                       AS autres_ecarts_12m_kg,
       a.debut                                                                  AS fenetre_debut,
       a.fin                                                                    AS fenetre_fin
  FROM agg a;
ALTER VIEW v_conso_reelle OWNER TO gestionfil;
COMMENT ON VIEW v_conso_reelle IS
    'Reel / mois (27/10/2026) : grand livre, 12 mois pleins glissants, rebut compris, retours deduits, autres ecarts exclus. conso_mensuelle_kg = reel des 12 mois / 12.';

-- -----------------------------------------------------------------------------
-- 5. D6 — v_machine_consommation : sans lecteur, fausse (lisait une colonne que
--    le modèle des décisions ne remplit plus) — retirée.
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_machine_consommation CASCADE;
COMMENT ON TABLE machine_consommation IS
    'Reliquat de l''ancien journal (avant les decisions machine, 05/10/2026), vide. La consommation se lit dans le grand livre v_consommation_fait (27/10/2026).';

-- -----------------------------------------------------------------------------
-- 6. D3 — v_of_consommation : agrégat du grand livre, mêmes colonnes
-- -----------------------------------------------------------------------------
-- Le prévu (métrage × recette × (1 + perte)) ne change pas (L3 le figera). Le réel
-- d'un OF : la consommation machine attribuée à l'OF de la période, la
-- consommation directe et le hors machine portant l'OF, moins ses retours ; le
-- rebut et les autres écarts à part (hors ajustements d'inventaire).
CREATE OR REPLACE VIEW v_of_consommation AS
WITH prevu AS (
    SELECT o_1.id_of, rc.code_reference,
           sum(o_1.metrage_m2 * rc.kg_m2 * (1::numeric + q.taux_perte_pct / 100.0)) AS kg_prevu
      FROM ordre_fabrication o_1
      JOIN qualite q ON q.code_qualite = o_1.code_qualite
      JOIN v_recette_calculee rc ON rc.code_qualite = o_1.code_qualite
     WHERE rc.kg_m2 IS NOT NULL
     GROUP BY o_1.id_of, rc.code_reference
), reel AS (
    SELECT g.id_of, g.code_reference,
           string_agg(DISTINCT NULLIF(g.lot_fournisseur, ''::text), ', '::text)                     AS lots,
           sum(g.kg) FILTER (WHERE g.nature = 'CONSOMMATION_MACHINE')                               AS kg_conso_fil,
           sum(g.kg) FILTER (WHERE g.nature IN ('CONSOMMATION_DIRECTE', 'HORS_MACHINE'))            AS kg_sorti,
           -sum(g.kg) FILTER (WHERE g.nature = 'RETOUR_CONSO')                                      AS kg_rendu,
           sum(g.kg) FILTER (WHERE g.nature = 'REBUT_DECHET')                                       AS kg_dechet,
           sum(g.kg) FILTER (WHERE g.nature = 'REBUT_PERTE')                                        AS kg_perte,
           sum(g.kg) FILTER (WHERE g.nature = 'REBUT_CASSE')                                        AS kg_casse,
           sum(g.kg) FILTER (WHERE g.nature = 'AUTRE_ECART'
                               AND g.categorie_ecart IS DISTINCT FROM 'AJUSTEMENT_INVENTAIRE')      AS kg_autre_ecart
      FROM v_consommation_fait g
     WHERE g.id_of IS NOT NULL
     GROUP BY g.id_of, g.code_reference
), cles AS (
    SELECT prevu.id_of, prevu.code_reference FROM prevu
    UNION
    SELECT reel.id_of, reel.code_reference FROM reel
)
SELECT o.id_of,
       o.numero,
       o.code_qualite,
       o.statut,
       o.date_of,
       o.metrage_m2,
       k.code_reference,
       r.designation,
       NULLIF(h.lots, ''::text) AS lots,
       round(COALESCE(p.kg_prevu, 0::numeric), 4) AS kg_prevu,
       round(COALESCE(h.kg_conso_fil, 0::numeric), 4) AS kg_conso_fil,
       round(COALESCE(h.kg_sorti, 0::numeric), 4) AS kg_sorti_hors_machine,
       round(COALESCE(h.kg_rendu, 0::numeric), 4) AS kg_rendu_hors_machine,
       round(COALESCE(h.kg_sorti, 0::numeric) - COALESCE(h.kg_rendu, 0::numeric), 4) AS kg_hors_machine,
       round(COALESCE(h.kg_conso_fil, 0::numeric) + COALESCE(h.kg_sorti, 0::numeric) - COALESCE(h.kg_rendu, 0::numeric), 4) AS kg_reel,
       round(COALESCE(h.kg_dechet, 0::numeric), 4) AS kg_dechet,
       round(COALESCE(h.kg_perte, 0::numeric), 4) AS kg_perte,
       round(COALESCE(h.kg_casse, 0::numeric), 4) AS kg_casse,
       round(COALESCE(h.kg_autre_ecart, 0::numeric), 4) AS kg_autre_ecart,
       round(COALESCE(h.kg_conso_fil, 0::numeric) + COALESCE(h.kg_sorti, 0::numeric) - COALESCE(h.kg_rendu, 0::numeric) - COALESCE(p.kg_prevu, 0::numeric), 4) AS ecart_kg,
       CASE
           WHEN COALESCE(p.kg_prevu, 0::numeric) > 0::numeric
           THEN round((COALESCE(h.kg_conso_fil, 0::numeric) + COALESCE(h.kg_sorti, 0::numeric) - COALESCE(h.kg_rendu, 0::numeric) - p.kg_prevu) / p.kg_prevu * 100::numeric, 2)
           ELSE NULL::numeric
       END AS ecart_pct
  FROM cles k
  JOIN ordre_fabrication o ON o.id_of = k.id_of
  JOIN reference r ON r.code_reference = k.code_reference
  LEFT JOIN prevu p ON p.id_of = k.id_of AND p.code_reference = k.code_reference
  LEFT JOIN reel h ON h.id_of = k.id_of AND h.code_reference = k.code_reference;
ALTER VIEW v_of_consommation OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 7. D4 — v_qualite_consommation : agrégat du grand livre, mêmes colonnes
-- -----------------------------------------------------------------------------
-- Part OF : v_of_bilan au mois de l'OF (inchangée, L3). Part sans OF : le grand
-- livre au mois du FAIT, sous la qualité de la période ou du mouvement, sinon
-- « Non attribué ». Le hors machine historique (SORTIE_HORS_MACHINE) y entre
-- désormais : il manquait (étude, défaut n° 5).
CREATE OR REPLACE VIEW v_qualite_consommation AS
WITH of_part AS (
    SELECT b.code_qualite,
           to_char(b.date_of::timestamp with time zone, 'YYYY-MM'::text) AS mois,
           count(*) AS nb_of,
           count(*) FILTER (WHERE b.statut = 'CLOTURE'::text) AS nb_of_clotures,
           sum(b.metrage_m2) AS metrage_m2,
           sum(b.kg_prevu) AS kg_prevu,
           sum(b.kg_conso_fil) AS kg_conso_fil,
           sum(b.kg_hors_machine) AS kg_hors_machine,
           sum(b.kg_reel) AS kg_reel,
           sum(b.kg_dechet) AS kg_dechet,
           sum(b.kg_perte) AS kg_perte,
           sum(b.kg_casse) AS kg_casse,
           sum(b.kg_autre_ecart) AS kg_autre_ecart
      FROM v_of_bilan b
     WHERE b.statut <> 'ANNULE'::text
     GROUP BY b.code_qualite, (to_char(b.date_of::timestamp with time zone, 'YYYY-MM'::text))
), sans_of AS (
    SELECT g.code_qualite,
           g.mois,
           COALESCE(sum(g.kg) FILTER (WHERE g.nature = 'CONSOMMATION_MACHINE'), 0::numeric) AS kg_conso_fil,
           COALESCE(sum(g.kg) FILTER (WHERE g.nature IN ('CONSOMMATION_DIRECTE', 'HORS_MACHINE', 'RETOUR_CONSO')), 0::numeric) AS kg_hors_machine,
           COALESCE(sum(g.kg) FILTER (WHERE g.nature = 'REBUT_DECHET'), 0::numeric) AS kg_dechet,
           COALESCE(sum(g.kg) FILTER (WHERE g.nature = 'REBUT_PERTE'), 0::numeric) AS kg_perte,
           COALESCE(sum(g.kg) FILTER (WHERE g.nature = 'REBUT_CASSE'), 0::numeric) AS kg_casse,
           COALESCE(sum(g.kg) FILTER (WHERE g.nature = 'AUTRE_ECART'), 0::numeric) AS kg_autre_ecart
      FROM v_consommation_fait g
     WHERE g.id_of IS NULL
       AND g.categorie_ecart IS DISTINCT FROM 'AJUSTEMENT_INVENTAIRE'
     GROUP BY g.code_qualite, g.mois
    HAVING (sum(abs(g.kg))) > 0::numeric
), cles AS (
    SELECT of_part.code_qualite, of_part.mois FROM of_part
    UNION
    SELECT sans_of.code_qualite, sans_of.mois FROM sans_of
)
SELECT k.code_qualite,
       CASE WHEN k.code_qualite IS NULL THEN 'Non attribué'::text ELSE q.nom END AS qualite_nom,
       k.mois,
       COALESCE(o.nb_of, 0::bigint) AS nb_of,
       COALESCE(o.nb_of_clotures, 0::bigint) AS nb_of_clotures,
       round(COALESCE(o.metrage_m2, 0::numeric), 2) AS metrage_m2,
       round(COALESCE(o.kg_prevu, 0::numeric), 4) AS kg_prevu,
       round(COALESCE(o.kg_conso_fil, 0::numeric) + COALESCE(s.kg_conso_fil, 0::numeric), 4) AS kg_conso_fil,
       round(COALESCE(o.kg_hors_machine, 0::numeric) + COALESCE(s.kg_hors_machine, 0::numeric), 4) AS kg_hors_machine,
       round(COALESCE(o.kg_reel, 0::numeric) + COALESCE(s.kg_conso_fil, 0::numeric) + COALESCE(s.kg_hors_machine, 0::numeric), 4) AS kg_reel,
       round(COALESCE(o.kg_dechet, 0::numeric) + COALESCE(s.kg_dechet, 0::numeric), 4) AS kg_dechet,
       round(COALESCE(o.kg_perte, 0::numeric) + COALESCE(s.kg_perte, 0::numeric), 4) AS kg_perte,
       round(COALESCE(o.kg_casse, 0::numeric) + COALESCE(s.kg_casse, 0::numeric), 4) AS kg_casse,
       round(COALESCE(o.kg_autre_ecart, 0::numeric) + COALESCE(s.kg_autre_ecart, 0::numeric), 4) AS kg_autre_ecart,
       round(o.kg_reel - o.kg_prevu, 4) AS ecart_kg,
       CASE WHEN o.kg_prevu > 0::numeric THEN round((o.kg_reel - o.kg_prevu) / o.kg_prevu * 100::numeric, 2)
            ELSE NULL::numeric END AS ecart_pct,
       round(COALESCE(o.kg_reel, 0::numeric), 4) AS kg_reel_of,
       round(COALESCE(s.kg_conso_fil, 0::numeric) + COALESCE(s.kg_hors_machine, 0::numeric), 4) AS kg_reel_sans_of,
       k.code_qualite IS NOT NULL AS attribue
  FROM cles k
  LEFT JOIN qualite q ON q.code_qualite = k.code_qualite
  LEFT JOIN of_part o ON NOT o.code_qualite IS DISTINCT FROM k.code_qualite AND o.mois = k.mois
  LEFT JOIN sans_of s ON NOT s.code_qualite IS DISTINCT FROM k.code_qualite AND s.mois = k.mois;
ALTER VIEW v_qualite_consommation OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 8. D5 — f_machine_consommation : les écarts viennent du grand livre
-- -----------------------------------------------------------------------------
-- Les bornes (début, fin), le chargé, le retourné et le sorti ailleurs restent lus
-- sur les lignes de décision (ce ne sont pas des consommations). Les colonnes
-- d'écart sont les natures du grand livre ; la CORRECTION (MJ_CORRECTION) quitte
-- la consommation (Q8) pour sa colonne, ajoutée en fin.
DROP FUNCTION IF EXISTS f_machine_consommation(text, text, text);
CREATE FUNCTION f_machine_consommation(p_machine text DEFAULT NULL::text, p_debut text DEFAULT NULL::text, p_fin text DEFAULT NULL::text)
 RETURNS TABLE(code_machine text, machine_nom text, code_emplacement text, zone text, code_reference text,
               designation text, lot_fournisseur text, date_debut text, kg_debut numeric, kg_charge numeric,
               kg_retourne numeric, kg_sorti_autre numeric, date_fin text, kg_fin numeric, consommation_kg numeric,
               dechet_perte_casse_kg numeric, non_qualifie_kg numeric, regularisation_kg numeric,
               erreur_saisie_kg numeric, correction_kg numeric)
 LANGUAGE sql
 STABLE
AS $function$
    WITH periode AS (
        SELECT e.*, l.nb_mouvementees
          FROM v_machine_ecart e
          JOIN machine_decision_ligne l ON l.id_decision = e.id_decision
                                       AND l.ligne_numero = e.ligne_numero
          LEFT JOIN machine_fiche fi ON fi.id_fiche = e.id_fiche
         WHERE e.nature <> 'DEPART'
           AND (p_machine IS NULL OR e.code_machine = p_machine)
           -- La date du FAIT (la fiche), a defaut celle de la validation.
           AND (p_debut   IS NULL OR substr(COALESCE(fi.date_fiche::text, fn_iso(e.date_decision)), 1, 10) >= substr(p_debut, 1, 10))
           AND (p_fin     IS NULL OR substr(COALESCE(fi.date_fiche::text, fn_iso(e.date_decision)), 1, 10) <= substr(p_fin, 1, 10))
    ),
    ecarts AS MATERIALIZED (
        SELECT g.id_source, g.ligne_numero, g.nature, g.categorie_ecart, g.kg
          FROM v_consommation_fait g
         WHERE g.source = 'DECISION' AND g.composante = 'ECART'
    ),
    bornes AS (
        SELECT DISTINCT ON (p.code_emplacement, p.code_reference, p.lot_fournisseur)
               p.code_emplacement, p.code_reference, p.lot_fournisseur,
               fn_iso(p.date_decision) AS date_debut, p.kg_avant AS kg_debut
          FROM periode p
         ORDER BY p.code_emplacement, p.code_reference, p.lot_fournisseur, p.date_decision
    ),
    fins AS (
        SELECT DISTINCT ON (p.code_emplacement, p.code_reference, p.lot_fournisseur)
               p.code_emplacement, p.code_reference, p.lot_fournisseur,
               fn_iso(p.date_decision) AS date_fin, p.kg_apres AS kg_fin
          FROM periode p
         ORDER BY p.code_emplacement, p.code_reference, p.lot_fournisseur, p.date_decision DESC
    )
    SELECT p.code_machine, m.nom, p.code_emplacement, p.zone, p.code_reference, p.designation,
           p.lot_fournisseur, b.date_debut, ROUND(b.kg_debut, 3),
           ROUND(SUM(CASE WHEN p.nature = 'CHARGE' THEN p.kg_mouvementes ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.nature = 'DECHARGE' AND p.destination = 'MAGASIN'
                          THEN p.kg_mouvementes ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.nature = 'DECHARGE' AND p.destination <> 'MAGASIN'
                          THEN p.kg_mouvementes ELSE 0 END), 3),
           fn.date_fin, ROUND(fn.kg_fin, 3),
           ROUND(COALESCE(SUM(x.kg) FILTER (WHERE x.nature = 'CONSOMMATION_MACHINE'), 0), 3),
           ROUND(COALESCE(SUM(x.kg) FILTER (WHERE x.nature LIKE 'REBUT\_%'), 0), 3),
           ROUND(COALESCE(SUM(x.kg) FILTER (WHERE x.categorie_ecart = 'NON_QUALIFIE'), 0), 3),
           ROUND(COALESCE(SUM(x.kg) FILTER (WHERE x.categorie_ecart = 'REGULARISATION'), 0), 3),
           ROUND(COALESCE(SUM(x.kg) FILTER (WHERE x.categorie_ecart = 'ERREUR_SAISIE'), 0), 3),
           ROUND(COALESCE(SUM(x.kg) FILTER (WHERE x.categorie_ecart = 'CORRECTION'), 0), 3)
      FROM periode p
      JOIN machine m ON m.code_machine = p.code_machine
      LEFT JOIN ecarts x ON x.id_source = p.id_decision AND x.ligne_numero = p.ligne_numero
      JOIN bornes b  ON b.code_emplacement = p.code_emplacement
                    AND b.code_reference = p.code_reference AND b.lot_fournisseur = p.lot_fournisseur
      JOIN fins fn   ON fn.code_emplacement = p.code_emplacement
                    AND fn.code_reference = p.code_reference AND fn.lot_fournisseur = p.lot_fournisseur
     GROUP BY p.code_machine, m.nom, p.code_emplacement, p.zone, p.code_reference, p.designation,
              p.lot_fournisseur, b.date_debut, b.kg_debut, fn.date_fin, fn.kg_fin
$function$;
ALTER FUNCTION f_machine_consommation(text, text, text) OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 9. Le « plus grand des deux » est supprimé ; les vues d'analyse lisent le réel
-- -----------------------------------------------------------------------------
-- v_stock_reference ne porte plus de consommation « retenue » ni de minimum : elle
-- porte le Réel / mois et la valeur réelle des 12 mois pleins (grand livre). Le
-- plan / mois et la sécurité du jour viennent du moteur (route).
DROP VIEW IF EXISTS v_supervision CASCADE;
DROP VIEW IF EXISTS v_supervision_valeurs CASCADE;
DROP VIEW IF EXISTS v_stock_reference CASCADE;
DROP VIEW IF EXISTS v_conso_retenue CASCADE;
DROP VIEW IF EXISTS v_stock_min_dynamique CASCADE;

CREATE VIEW v_stock_reference AS
 SELECT r.code_reference,
    r.designation,
    r.code_fournisseur,
    f.nom AS fournisseur_nom,
    f.pays AS fournisseur_pays,
    COALESCE(f.delai_livraison_jours, p_delai.v::bigint) AS delai_livraison_jours,
    r.classe_abc,
    r.classe_xyz,
    r.unite_catalogue,
    r.cmup_mad,
    sd.stock_mrp_kg,
    sd.stock_total_kg,
    sd.valeur_totale_mad,
    ph.stock_physique_net_kg,
    ph.stock_quarantaine_kg,
    ph.stock_reserve_kg,
    ph.stock_machine_kg,
    ph.stock_transit_kg,
    cr.conso_mensuelle_kg AS reel_mois_kg,
    COALESCE(cr.valeur_12m_mad, 0::numeric) AS valeur_reel_12m_mad
   FROM reference r
     JOIN v_stock_disponible sd ON sd.code_reference = r.code_reference
     JOIN v_stock_physique ph ON ph.code_reference = r.code_reference
     LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
     LEFT JOIN v_conso_reelle cr ON cr.code_reference = r.code_reference
     CROSS JOIN ( SELECT parametre.valeur_courante AS v
           FROM parametre
          WHERE parametre.code_parametre = 'P_DelaiDefaut'::text) p_delai
  WHERE r.actif = 1;
ALTER VIEW v_stock_reference OWNER TO gestionfil;

-- L'état des stocks : le minimum (sécurité du jour) et « sous le minimum » viennent
-- du moteur (route /api/etat-stock) ; la vue ne les porte plus.
CREATE VIEW v_etat_stock AS
 WITH ventilation AS (
         SELECT sm.code_reference,
            jsonb_object_agg(sm.code_magasin, round(sm.quantite_kg, 3)) FILTER (WHERE e.code_machine IS NULL AND sm.quantite_kg <> 0::numeric) AS par_magasin,
            COALESCE(sum(sm.quantite_kg) FILTER (WHERE e.code_machine IS NULL), 0::numeric) AS magasins_kg,
            COALESCE(sum(sm.quantite_kg) FILTER (WHERE e.code_machine IS NOT NULL), 0::numeric) AS machines_kg,
            COALESCE(sum(sm.nb_bobines) FILTER (WHERE e.code_machine IS NOT NULL), 0::numeric) AS machines_bobines,
            count(DISTINCT e.code_machine) FILTER (WHERE e.code_machine IS NOT NULL) AS nb_machines
           FROM stock_magasin sm
             LEFT JOIN machine_emplacement e ON e.code_magasin = sm.code_magasin
          GROUP BY sm.code_reference
        ), mouvement_dernier AS (
         SELECT lm.code_reference,
            max(mv.date_mouvement::text) FILTER (WHERE tm.signe = '-1'::integer) AS derniere_sortie,
            max(mv.date_mouvement::text) AS dernier_mouvement
           FROM ligne_mouvement lm
             JOIN mouvement mv ON mv.id_mouvement = lm.id_mouvement
             JOIN type_mouvement tm ON tm.code_type_mvt = mv.code_type_mvt
          GROUP BY lm.code_reference
        )
 SELECT sp.code_reference,
    sp.designation,
    r.code_categorie,
    cm.libelle AS categorie,
    sp.code_fournisseur,
    sp.fournisseur_nom,
    sp.unite_catalogue AS unite,
    round(sp.stock_total_kg, 3) AS stock_global_kg,
    round(v.magasins_kg, 3) AS magasins_kg,
    round(v.machines_kg, 3) AS machines_kg,
    v.machines_bobines,
    v.nb_machines,
    v.par_magasin,
    round(sp.stock_quarantaine_kg, 3) AS quarantaine_kg,
    round(sp.stock_physique_net_kg, 3) AS disponible_kg,
    round(sp.reel_mois_kg, 3) AS reel_mois_kg,
    sp.delai_livraison_jours,
    sp.classe_abc,
    sp.classe_xyz,
    round(sp.cmup_mad, 4) AS cmup_mad,
    round(r.prix_catalogue_kg, 4) AS prix_catalogue_kg,
    r.code_devise_catalogue AS devise,
    round(sp.valeur_totale_mad, 2) AS valeur_mad,
    md.derniere_sortie,
    md.dernier_mouvement,
        CASE
            WHEN md.dernier_mouvement IS NULL THEN NULL::integer
            ELSE CURRENT_DATE - "left"(md.dernier_mouvement, 10)::date
        END AS jours_sans_mouvement,
    rge.code_groupe_equiv,
    ( SELECT count(*) AS count
           FROM reference_groupe_equiv x
          WHERE x.code_groupe_equiv = rge.code_groupe_equiv AND x.code_reference <> sp.code_reference AND x.actif = 1) AS nb_equivalents,
    round(r.bobines_par_palette::numeric * r.poids_bobine_kg, 3) AS kg_par_palette,
        CASE
            WHEN r.bobines_par_palette > 0 AND r.poids_bobine_kg > 0::numeric THEN round(sp.stock_total_kg / (r.bobines_par_palette::numeric * r.poids_bobine_kg), 2)
            ELSE NULL::numeric
        END AS palettes,
        CASE
            WHEN r.poids_bobine_kg > 0::numeric THEN round(sp.stock_total_kg / r.poids_bobine_kg)
            ELSE NULL::numeric
        END AS bobines
   FROM v_stock_reference sp
     JOIN reference r ON r.code_reference = sp.code_reference
     LEFT JOIN categorie_matiere cm ON cm.code_categorie = r.code_categorie
     LEFT JOIN ventilation v ON v.code_reference = sp.code_reference
     LEFT JOIN mouvement_dernier md ON md.code_reference = sp.code_reference
     LEFT JOIN reference_groupe_equiv rge ON rge.code_reference = sp.code_reference AND rge.actif = 1;
ALTER VIEW v_etat_stock OWNER TO gestionfil;

CREATE VIEW v_etat_stock_conditionne AS
 SELECT e.code_reference,
    e.designation,
    e.code_categorie,
    e.categorie,
    e.code_fournisseur,
    e.fournisseur_nom,
    e.unite,
    e.stock_global_kg,
    e.magasins_kg,
    e.machines_kg,
    e.machines_bobines,
    e.nb_machines,
    e.par_magasin,
    e.quarantaine_kg,
    e.disponible_kg,
    e.reel_mois_kg,
    e.delai_livraison_jours,
    e.classe_abc,
    e.classe_xyz,
    e.cmup_mad,
    e.prix_catalogue_kg,
    e.devise,
    e.valeur_mad,
    e.derniere_sortie,
    e.dernier_mouvement,
    e.jours_sans_mouvement,
    e.code_groupe_equiv,
    e.nb_equivalents,
    e.kg_par_palette,
    e.palettes,
    e.bobines,
    c.code_conditionnement,
    c.conditionnement_libelle,
    c.unite_singulier,
    c.unite_pluriel,
    c.declare AS conditionnement_declare,
    c.comptable AS conditionnement_comptable,
    c.contenance_litres,
        CASE
            WHEN c.comptable = 1 THEN e.bobines
            ELSE NULL::numeric
        END AS nb_colis,
        CASE
            WHEN c.comptable = 1 THEN e.palettes
            ELSE NULL::numeric
        END AS nb_palettes,
        CASE
            WHEN c.comptable = 1 AND c.contenance_litres IS NOT NULL THEN round(e.bobines * c.contenance_litres, 0)
            ELSE NULL::numeric
        END AS litres
   FROM v_etat_stock e
     JOIN v_reference_conditionnement c USING (code_reference);
ALTER VIEW v_etat_stock_conditionne OWNER TO gestionfil;

-- L'analyse ABC / XYZ : le RÉEL des 12 mois pleins (kg / mois et valeur au livre).
CREATE VIEW v_analyse_abc_xyz AS
 WITH valeur AS (
         SELECT sp.code_reference,
            sp.designation,
            sp.fournisseur_nom,
            sp.reel_mois_kg,
            sp.cmup_mad,
            sp.valeur_totale_mad,
            r.classe_abc,
            r.classe_xyz,
            r.date_dernier_abc,
            round(sp.valeur_reel_12m_mad, 2) AS valeur_conso_annuelle_mad
           FROM v_stock_reference sp
             JOIN reference r ON r.code_reference = sp.code_reference
          WHERE r.actif = 1
        ), total AS (
         SELECT sum(valeur.valeur_conso_annuelle_mad) AS t
           FROM valeur
        )
 SELECT code_reference,
    designation,
    fournisseur_nom,
    reel_mois_kg,
    cmup_mad,
    valeur_totale_mad,
    classe_abc,
    classe_xyz,
    fn_iso(date_dernier_abc) AS date_dernier_abc,
    valeur_conso_annuelle_mad,
    ( SELECT count(*) + 1
           FROM valeur w
          WHERE w.valeur_conso_annuelle_mad > v.valeur_conso_annuelle_mad) AS rang,
    round((( SELECT sum(w.valeur_conso_annuelle_mad) AS sum
           FROM valeur w
          WHERE w.valeur_conso_annuelle_mad >= v.valeur_conso_annuelle_mad)) * 100.0 / NULLIF(( SELECT total.t
           FROM total), 0::numeric), 4) AS pct_cumule,
    round(valeur_conso_annuelle_mad * 100.0 / NULLIF(( SELECT total.t
           FROM total), 0::numeric), 4) AS part_pct,
        CASE
            WHEN classe_abc IS NULL OR classe_xyz IS NULL THEN 'A classer'::text
            WHEN classe_abc = 'A'::text AND classe_xyz = 'X'::text THEN 'Flux tendu, commandes cadencees'::text
            WHEN classe_abc = 'A'::text AND classe_xyz = 'Y'::text THEN 'Stock de securite modere, revue mensuelle'::text
            WHEN classe_abc = 'A'::text AND classe_xyz = 'Z'::text THEN 'Stock de securite eleve et suivi rapproche'::text
            WHEN classe_abc = 'B'::text AND classe_xyz = 'X'::text THEN 'Reapprovisionnement automatique'::text
            WHEN classe_abc = 'B'::text THEN 'Revue trimestrielle'::text
            WHEN classe_abc = 'C'::text AND classe_xyz = 'X'::text THEN 'Commande automatique, lot economique'::text
            ELSE 'A la demande, sans stock dedie'::text
        END AS politique
   FROM valeur v;
ALTER VIEW v_analyse_abc_xyz OWNER TO gestionfil;

-- Budget par devise : RÉEL (structure constatée des achats consommés, 12 mois pleins).
CREATE VIEW v_cockpit_devise AS
 WITH budget AS (
         SELECT r.code_devise_catalogue AS code_devise,
            count(*) AS nb_references,
            sum(sp.valeur_reel_12m_mad) AS montant_mad
           FROM reference r
             JOIN v_stock_reference sp ON sp.code_reference = r.code_reference
          WHERE r.actif = 1
          GROUP BY r.code_devise_catalogue
        )
 SELECT code_devise,
    nb_references,
    round(montant_mad, 2) AS montant_mad,
    round(montant_mad * 100.0 / NULLIF(( SELECT sum(budget.montant_mad) AS sum
           FROM budget), 0::numeric), 2) AS part_pct
   FROM budget b
  WHERE montant_mad > 0::numeric;
ALTER VIEW v_cockpit_devise OWNER TO gestionfil;

-- Économies : une PROJECTION (ce qu'un autre fournisseur coûterait de moins sur
-- l'année à venir) → au PLAN du moteur. La vue rend les prix ; la route
-- (consultation::economies_au_plan) multiplie l'écart par le plan / mois × 12.
CREATE VIEW v_cockpit_economies AS
 WITH groupes AS (
         SELECT reference_groupe_equiv.code_reference,
            reference_groupe_equiv.code_groupe_equiv
           FROM reference_groupe_equiv
          WHERE reference_groupe_equiv.actif = 1
        ), mini AS (
         SELECT g_1.code_groupe_equiv,
            min(sp_1.cmup_mad) AS prix_min_mad
           FROM groupes g_1
             JOIN v_stock_reference sp_1 ON sp_1.code_reference = g_1.code_reference
          WHERE sp_1.cmup_mad > 0::numeric
          GROUP BY g_1.code_groupe_equiv
        )
 SELECT sp.code_reference,
    sp.designation,
    sp.fournisseur_nom AS fournisseur_actuel,
    g.code_groupe_equiv,
    round(sp.cmup_mad, 4) AS prix_actuel_mad,
    round(m.prix_min_mad, 4) AS prix_min_mad,
    ( SELECT sp2.fournisseur_nom
           FROM groupes g2
             JOIN v_stock_reference sp2 ON sp2.code_reference = g2.code_reference
          WHERE g2.code_groupe_equiv = g.code_groupe_equiv AND sp2.cmup_mad = m.prix_min_mad
         LIMIT 1) AS fournisseur_alternatif
   FROM v_stock_reference sp
     JOIN groupes g ON g.code_reference = sp.code_reference
     JOIN mini m ON m.code_groupe_equiv = g.code_groupe_equiv
  WHERE sp.cmup_mad > m.prix_min_mad;
ALTER VIEW v_cockpit_economies OWNER TO gestionfil;

-- Mono-source : le budget est le RÉEL des 12 mois pleins (poids constaté, comme l'ABC).
CREATE VIEW v_cockpit_mono_source AS
 SELECT code_reference,
    designation,
    fournisseur_nom,
    delai_livraison_jours,
    round(valeur_reel_12m_mad, 2) AS budget_annuel_mad
   FROM v_stock_reference sp
  WHERE NOT (EXISTS ( SELECT 1
           FROM reference_groupe_equiv a
             JOIN reference_groupe_equiv b ON b.code_groupe_equiv = a.code_groupe_equiv AND b.code_reference <> a.code_reference AND b.actif = 1
             JOIN reference rb ON rb.code_reference = b.code_reference AND rb.actif = 1
          WHERE a.code_reference = sp.code_reference AND a.actif = 1 AND rb.code_fournisseur IS DISTINCT FROM sp.code_fournisseur));
ALTER VIEW v_cockpit_mono_source OWNER TO gestionfil;

-- Pareto : l'assiette de l'ABC, le RÉEL valorisé au livre des 12 mois pleins.
CREATE VIEW v_cockpit_pareto AS
 WITH valeur AS (
         SELECT sp.code_reference,
            sp.designation,
            r.classe_abc,
            r.classe_xyz,
            round(sp.valeur_reel_12m_mad, 2) AS valeur_conso_annuelle_mad
           FROM v_stock_reference sp
             JOIN reference r ON r.code_reference = sp.code_reference
          WHERE r.actif = 1
        )
 SELECT code_reference,
    designation,
    classe_abc,
    classe_xyz,
    valeur_conso_annuelle_mad,
    ( SELECT count(*) + 1
           FROM valeur w
          WHERE w.valeur_conso_annuelle_mad > v.valeur_conso_annuelle_mad) AS rang,
    round((( SELECT sum(w.valeur_conso_annuelle_mad) AS sum
           FROM valeur w
          WHERE w.valeur_conso_annuelle_mad >= v.valeur_conso_annuelle_mad)) * 100.0 / NULLIF(( SELECT sum(valeur.valeur_conso_annuelle_mad) AS sum
           FROM valeur), 0::numeric), 4) AS pct_cumule
   FROM valeur v
  WHERE valeur_conso_annuelle_mad > 0::numeric;
ALTER VIEW v_cockpit_pareto OWNER TO gestionfil;

-- Risque de sourcing : budget et palier au RÉEL des 12 mois pleins (poids constaté,
-- même assiette que l'ABC) ; l'état vient du moteur (route).
CREATE VIEW v_risque_sourcing AS
 WITH alternatives AS (
         SELECT a_1.code_reference,
            count(DISTINCT sp_1.code_fournisseur) AS nb_sources
           FROM reference_groupe_equiv a_1
             JOIN reference_groupe_equiv b ON b.code_groupe_equiv = a_1.code_groupe_equiv AND b.actif = 1
             JOIN v_stock_reference sp_1 ON sp_1.code_reference = b.code_reference
          WHERE a_1.actif = 1
          GROUP BY a_1.code_reference
        )
 SELECT sp.code_reference,
    sp.designation,
    sp.fournisseur_nom,
    r.classe_abc,
    r.classe_xyz,
    sp.delai_livraison_jours,
    round(sp.valeur_reel_12m_mad, 2) AS budget_annuel_mad,
    COALESCE(a.nb_sources, 1::bigint) AS nb_sources,
        CASE
            WHEN COALESCE(a.nb_sources, 1::bigint) <= 1 THEN 'MONO_SOURCE'::text
            ELSE 'MULTI_SOURCE'::text
        END AS risque_source,
        CASE
            WHEN sp.valeur_reel_12m_mad >= (( SELECT parametre.valeur_courante::numeric AS valeur_courante
               FROM parametre
              WHERE parametre.code_parametre = 'P_SeuilTier1'::text)) THEN 'TIER_1'::text
            WHEN sp.valeur_reel_12m_mad >= (( SELECT parametre.valeur_courante::numeric AS valeur_courante
               FROM parametre
              WHERE parametre.code_parametre = 'P_SeuilTier2'::text)) THEN 'TIER_2'::text
            WHEN sp.valeur_reel_12m_mad >= (( SELECT parametre.valeur_courante::numeric AS valeur_courante
               FROM parametre
              WHERE parametre.code_parametre = 'P_SeuilTier3'::text)) THEN 'TIER_3'::text
            ELSE 'TIER_4'::text
        END AS tier
   FROM v_stock_reference sp
     JOIN reference r ON r.code_reference = sp.code_reference
     LEFT JOIN alternatives a ON a.code_reference = sp.code_reference
  WHERE r.actif = 1;
ALTER VIEW v_risque_sourcing OWNER TO gestionfil;

-- La supervision : la rotation au RÉEL (valeur au livre des 12 mois pleins, sur
-- six mois d'historique au moins) ; les économies se calculent au plan du moteur,
-- dans la route (NULL ici).
CREATE VIEW v_supervision_valeurs AS
 WITH stock AS (
         SELECT COALESCE(sum(v_etat_stock.valeur_mad), 0::numeric) AS valeur_mad,
            NULLIF(count(*), 0) AS nb_refs
           FROM v_etat_stock
        ), sourcing AS (
         SELECT count(*) FILTER (WHERE v_risque_sourcing.nb_sources <= 1) AS nb_mono,
            COALESCE(sum(v_risque_sourcing.budget_annuel_mad) FILTER (WHERE v_risque_sourcing.nb_sources <= 1), 0::numeric) AS budget_mono
           FROM v_risque_sourcing
        ), livraison AS (
         SELECT count(*) AS nb,
            count(*) FILTER (WHERE substr(r.date_reception::text, 1, 10)::date <= substr(b.date_livraison_prevue::text, 1, 10)::date) AS nb_a_lheure,
            avg(substr(r.date_reception::text, 1, 10)::date - substr(b.date_bc::text, 1, 10)::date) AS delai_reel
           FROM reception r
             JOIN bon_commande b ON b.id_bc = r.id_bc
          WHERE (r.statut = ANY (ARRAY['VALIDE'::text, 'CLOTURE'::text])) AND b.date_livraison_prevue::text IS NOT NULL
        ), completude AS (
         SELECT count(*) AS nb,
            count(*) FILTER (WHERE l.quantite_recue_kg >= (l.quantite_commandee_kg * 0.98)) AS nb_completes
           FROM ligne_bc l
             JOIN bon_commande b ON b.id_bc = l.id_bc
          WHERE l.quantite_commandee_kg > 0::numeric AND (b.statut = ANY (ARRAY['ENVOYE'::text, 'LIVRE_PARTIEL'::text, 'CLOTURE'::text]))
        ), rotation AS (
         SELECT COALESCE(sum(c.valeur_mad), 0::numeric) AS reel_mad,
            count(DISTINCT c.mois) AS nb_mois
           FROM v_conso_reelle_mois c
        ), dormant AS (
         SELECT COALESCE(sum(e.valeur_mad) FILTER (WHERE NOT (EXISTS ( SELECT 1
                   FROM ligne_mouvement lm
                     JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
                  WHERE lm.code_reference = e.code_reference AND m.date_mouvement::text >= to_char((now() AT TIME ZONE 'UTC'::text) - '60 days'::interval, 'YYYY-MM-DD'::text)))), 0::numeric) AS dormant_mad,
            NULLIF(sum(e.valeur_mad), 0::numeric) AS total_mad
           FROM v_etat_stock e
        ), prix AS (
         SELECT sum(h.prix_kg_mad * h.quantite_achetee_kg) FILTER (WHERE h.date_achat >= to_char((now() AT TIME ZONE 'UTC'::text) - '6 mons'::interval, 'YYYY-MM-DD'::text)) / NULLIF(sum(h.quantite_achetee_kg) FILTER (WHERE h.date_achat >= to_char((now() AT TIME ZONE 'UTC'::text) - '6 mons'::interval, 'YYYY-MM-DD'::text)), 0::numeric) AS recent,
            sum(h.prix_kg_mad * h.quantite_achetee_kg) FILTER (WHERE h.date_achat < to_char((now() AT TIME ZONE 'UTC'::text) - '6 mons'::interval, 'YYYY-MM-DD'::text) AND h.date_achat >= to_char((now() AT TIME ZONE 'UTC'::text) - '1 year'::interval, 'YYYY-MM-DD'::text)) / NULLIF(sum(h.quantite_achetee_kg) FILTER (WHERE h.date_achat < to_char((now() AT TIME ZONE 'UTC'::text) - '6 mons'::interval, 'YYYY-MM-DD'::text) AND h.date_achat >= to_char((now() AT TIME ZONE 'UTC'::text) - '1 year'::interval, 'YYYY-MM-DD'::text)), 0::numeric) AS ancien
           FROM v_historique_prix_courant h
          WHERE h.quantite_achetee_kg > 0::numeric AND h.prix_kg_mad > 0::numeric
        ), machine AS (
         SELECT COALESCE(sum(machine_etat.kg), 0::numeric) AS kg,
            count(*) AS nb
           FROM machine_etat
        )
 SELECT 'valeur_stock'::text AS cle,
    s.valeur_mad AS valeur
   FROM stock s
UNION ALL
 SELECT 'mono_source'::text AS cle,
    so.nb_mono::numeric AS valeur
   FROM sourcing so
UNION ALL
 SELECT 'budget_mono'::text AS cle,
    so.budget_mono AS valeur
   FROM sourcing so
UNION ALL
 SELECT 'economies'::text AS cle,
    NULL::numeric AS valeur
UNION ALL
 SELECT 'on_time'::text AS cle,
        CASE
            WHEN l.nb > 0 THEN round(100.0 * l.nb_a_lheure::numeric / l.nb::numeric, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM livraison l
UNION ALL
 SELECT 'lead_time'::text AS cle,
        CASE
            WHEN l.nb > 0 THEN round(l.delai_reel, 0)
            ELSE NULL::numeric
        END AS valeur
   FROM livraison l
UNION ALL
 SELECT 'in_full'::text AS cle,
        CASE
            WHEN c.nb > 0 THEN round(100.0 * c.nb_completes::numeric / c.nb::numeric, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM completude c
UNION ALL
 SELECT 'otif'::text AS cle,
        CASE
            WHEN l.nb > 0 AND c.nb > 0 THEN round(100.0 * l.nb_a_lheure::numeric / l.nb::numeric * c.nb_completes::numeric / c.nb::numeric, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM livraison l,
    completude c
UNION ALL
 SELECT 'rotation'::text AS cle,
        CASE
            WHEN r.nb_mois >= 6 AND (( SELECT stock.valeur_mad
               FROM stock)) > 0::numeric THEN round(r.reel_mad / (( SELECT stock.valeur_mad
               FROM stock)), 2)
            ELSE NULL::numeric
        END AS valeur
   FROM rotation r
UNION ALL
 SELECT 'stock_dormant'::text AS cle,
        CASE
            WHEN d.total_mad IS NOT NULL THEN round(100.0 * d.dormant_mad / d.total_mad, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM dormant d
UNION ALL
 SELECT 'evolution_prix'::text AS cle,
        CASE
            WHEN p.ancien IS NOT NULL AND p.ancien > 0::numeric THEN round(100.0 * (p.recent - p.ancien) / p.ancien, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM prix p
UNION ALL
 SELECT 'wip_machine'::text AS cle,
        CASE
            WHEN m.nb > 0 THEN round(m.kg, 0)
            ELSE NULL::numeric
        END AS valeur
   FROM machine m;
ALTER VIEW v_supervision_valeurs OWNER TO gestionfil;

CREATE VIEW v_supervision AS
 SELECT d.domaine,
    d.cle,
    d.libelle,
    d.unite,
    d.definition,
    (v.valeur IS NOT NULL)::integer AS disponible,
        CASE
            WHEN v.valeur IS NULL THEN d.condition
            ELSE NULL::text
        END AS condition,
    d.sens,
    d.cible,
    d.vigilance
   FROM ( VALUES ('STOCK'::text,'valeur_stock'::text,'Valeur du stock'::text,'MAD'::text,'Au CMUP, tous magasins confondus.'::text,'Aucun stock valorise.'::text,'neutre'::text,NULL::numeric,NULL::numeric), ('STOCK'::text,'couverture_mediane'::text,'Couverture mediane'::text,'jours'::text,'Jours couverts par le moteur de couverture (jusqu a la premiere rupture, sinon tout l horizon du plan) : la moitie des references tient plus longtemps, l autre moins.'::text,'Aucune reference avec un plan en service.'::text,'haut'::text,60,30), ('STOCK'::text,'taux_rupture'::text,'Taux de rupture'::text,'%'::text,'References dont une part du plan n est pas couverte sur l horizon (moteur de couverture).'::text,'Aucune reference suivie.'::text,'bas'::text,2,5), ('STOCK'::text,'taux_disponibilite'::text,'Taux de disponibilite'::text,'%'::text,'References couvertes sur tout l horizon (ni rupture ni passage sous la securite), sur le total suivi par le moteur.'::text,'Aucune reference suivie.'::text,'haut'::text,95,90), ('STOCK'::text,'rotation'::text,'Rotation du stock'::text,'fois/an'::text,'Reel : consommation des 12 mois pleins (grand livre, rebut compris, valeur au livre) rapportee a la valeur du stock.'::text,'Moins de six mois de consommation dans les 12 mois pleins : la rotation n aurait aucun sens.'::text,'haut'::text,4,2), ('STOCK'::text,'stock_dormant'::text,'Stock dormant'::text,'%'::text,'Valeur sans aucun mouvement depuis soixante jours.'::text,'Le magasin a moins de soixante jours.'::text,'bas'::text,5,12), ('LIVRAISON'::text,'otif'::text,'OTIF fournisseur'::text,'%'::text,'A l heure ET complet : le produit des deux, jamais leur moyenne.'::text,'Aucune reception rapprochee d un bon de commande.'::text,'haut'::text,95,85), ('LIVRAISON'::text,'on_time'::text,'Ponctualite'::text,'%'::text,'Livraisons arrivees au plus tard a la date promise.'::text,'Aucune reception avec une date promise.'::text,'haut'::text,95,85), ('LIVRAISON'::text,'in_full'::text,'Completude'::text,'%'::text,'Quantite pesee contre quantite commandee, tolerance de 2 %.'::text,'Aucune ligne de commande servie.'::text,'haut'::text,98,92), ('LIVRAISON'::text,'lead_time'::text,'Delai fournisseur reel'::text,'jours'::text,'Entre la date du bon et la date de reception.'::text,'Aucun bon suivi d une reception.'::text,'bas'::text,60,90), ('ACHATS'::text,'mono_source'::text,'References mono-source'::text,'refs'::text,'Une seule source connue : un incident fournisseur arrete la production.'::text,'Aucune reference analysee.'::text,'bas'::text,0,10), ('ACHATS'::text,'budget_mono'::text,'Budget expose au mono-source'::text,'MAD/an'::text,'Reel : ce qu a coute sur les 12 mois pleins (grand livre, valeur au livre) ce qui n a qu une source.'::text,'Aucun budget calcule.'::text,'neutre'::text,NULL::numeric,NULL::numeric), ('ACHATS'::text,'economies'::text,'Economies identifiees'::text,'MAD/an'::text,'Au plan : a qualite egale, le meme titrage achete moins cher ailleurs, sur le plan / mois du moteur x 12.'::text,'Aucune equivalence declaree, ou aucun plan sur les references concernees.'::text,'neutre'::text,NULL::numeric,NULL::numeric), ('ACHATS'::text,'evolution_prix'::text,'Evolution des prix'::text,'%'::text,'Prix moyen pondere des six derniers mois contre les six precedents.'::text,'Moins d un an de releves de prix.'::text,'bas'::text,3,8), ('PREVISION'::text,'forecast_accuracy'::text,'Precision de prevision'::text,'%'::text,'100 moins l erreur ponderee entre besoin calcule et sortie reelle.'::text,'Le rapprochement besoin/realise n est pas encore etabli.'::text,'haut'::text,85,70), ('PRODUCTION'::text,'wip_machine'::text,'Matiere en machine'::text,'kg'::text,'Bobines montees sur metier, immobilisees hors magasin.'::text,'Aucun constat de machine.'::text,'neutre'::text,NULL::numeric,NULL::numeric)) d(domaine, cle, libelle, unite, definition, condition, sens, cible, vigilance)
     LEFT JOIN v_supervision_valeurs v USING (cle);
ALTER VIEW v_supervision OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 10. C67 : le rapprochement machine (SIGNAL)
-- -----------------------------------------------------------------------------
-- Par référence, depuis l'origine : chargé (CHARGE_MACHINE − ANNUL_CHARGE_MACHINE)
-- − déchargé au magasin (RETOUR_MACHINE − ANNUL_RETOUR_MACHINE) − variation de
-- l'état machine (état actuel − état de départ des fiches de départ) doit égaler
-- la somme des faits machine du grand livre (consommation, rebut, autres écarts).
-- Mouvements contre-passés et contre-passations exclus. Tolérance 0,01 kg (arrondi).
CREATE OR REPLACE VIEW v_ctl_c67 AS
WITH mvt AS (
    SELECT lm.code_reference,
           SUM(CASE m.code_type_mvt WHEN 'CHARGE_MACHINE' THEN lm.quantite_kg
                                    WHEN 'ANNUL_CHARGE_MACHINE' THEN -lm.quantite_kg ELSE 0 END) AS charge_kg,
           SUM(CASE m.code_type_mvt WHEN 'RETOUR_MACHINE' THEN lm.quantite_kg
                                    WHEN 'ANNUL_RETOUR_MACHINE' THEN -lm.quantite_kg ELSE 0 END) AS retour_kg
      FROM mouvement m
      JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
     WHERE m.code_type_mvt IN ('CHARGE_MACHINE', 'ANNUL_CHARGE_MACHINE', 'RETOUR_MACHINE', 'ANNUL_RETOUR_MACHINE')
       AND m.id_mouvement_contrepasse IS NULL
       AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
     GROUP BY lm.code_reference
), depart AS (
    SELECT e.code_reference, SUM(e.kg) AS kg
      FROM machine_decision d
      JOIN machine_decision_etat e ON e.id_decision = d.id_decision AND e.moment = 'APRES'
     WHERE d.nature = 'DEPART' AND d.statut = 'ACTIVE'
     GROUP BY e.code_reference
), actuel AS (
    SELECT code_reference, SUM(kg) AS kg FROM machine_etat GROUP BY code_reference
), faits AS (
    SELECT code_reference, SUM(kg) AS kg
      FROM v_consommation_fait
     WHERE source = 'DECISION'
     GROUP BY code_reference
), cles AS (
    SELECT code_reference FROM mvt UNION SELECT code_reference FROM depart
    UNION SELECT code_reference FROM actuel UNION SELECT code_reference FROM faits
), calcul AS (
    SELECT k.code_reference,
           ROUND(COALESCE(m.charge_kg, 0), 4) AS charge_kg,
           ROUND(COALESCE(m.retour_kg, 0), 4) AS retour_magasin_kg,
           ROUND(COALESCE(d.kg, 0), 4)        AS etat_depart_kg,
           ROUND(COALESCE(a.kg, 0), 4)        AS etat_actuel_kg,
           ROUND(COALESCE(m.charge_kg, 0) - COALESCE(m.retour_kg, 0) - (COALESCE(a.kg, 0) - COALESCE(d.kg, 0)), 4) AS attendu_kg,
           ROUND(COALESCE(f.kg, 0), 4)        AS faits_machine_kg
      FROM cles k
      LEFT JOIN mvt m    ON m.code_reference = k.code_reference
      LEFT JOIN depart d ON d.code_reference = k.code_reference
      LEFT JOIN actuel a ON a.code_reference = k.code_reference
      LEFT JOIN faits f  ON f.code_reference = k.code_reference
)
SELECT c.code_reference,
       r.designation,
       c.charge_kg,
       c.retour_magasin_kg,
       c.etat_depart_kg,
       c.etat_actuel_kg,
       c.attendu_kg,
       c.faits_machine_kg,
       ROUND(c.attendu_kg - c.faits_machine_kg, 4) AS difference_kg
  FROM calcul c
  JOIN reference r ON r.code_reference = c.code_reference
 WHERE abs(c.attendu_kg - c.faits_machine_kg) > 0.01;
ALTER VIEW v_ctl_c67 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('v_ctl_c67' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C67''::text, ''Machine : charge - decharge - variation de l''''etat different du grand livre de la consommation''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c67)';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 11. Les champs affichés (une colonne non déclarée est masquée à l'écran)
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT c.module, c.champ, c.libelle, 'LECTURE', 0, 995
  FROM (VALUES ('STOCK',   'reel_mois_kg',     'Réel / mois (kg, 12 mois pleins)'),
               ('COCKPIT', 'reel_mois_kg',     'Réel / mois (kg, 12 mois pleins)'),
               ('COCKPIT', 'nb_trop_tard',     'Trop tard pour commander'),
               ('COCKPIT', 'trop_tard',        'Trop tard pour commander'),
               ('STOCK',   'securite_kg',      'Sécurité du jour (kg)'),
               ('STOCK',   'correction_kg',    'Correction (kg)')
       ) c(module, champ, libelle)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 12. Témoin
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_manquantes text;
BEGIN
    SELECT string_agg(v, ', ') INTO v_manquantes
      FROM unnest(ARRAY['v_conso_fenetre', 'v_consommation_fait', 'v_conso_reelle_mois', 'v_conso_reelle',
                        'v_of_consommation', 'v_of_bilan', 'v_qualite_consommation', 'v_ctl_c61', 'v_ctl_c50',
                        'v_stock_reference', 'v_etat_stock', 'v_etat_stock_conditionne', 'v_analyse_abc_xyz',
                        'v_cockpit_devise', 'v_cockpit_economies', 'v_cockpit_mono_source', 'v_cockpit_pareto',
                        'v_risque_sourcing', 'v_supervision_valeurs', 'v_supervision', 'v_ctl_c67',
                        'v_controles', 'v_cockpit_files', 'v_equivalence', 'v_substitution_dispo']) v
     WHERE to_regclass('public.' || v) IS NULL;
    IF v_manquantes IS NOT NULL THEN
        RAISE EXCEPTION '2026-10-27g : vues manquantes après la migration : %', v_manquantes;
    END IF;
    IF to_regclass('public.v_conso_retenue') IS NOT NULL
       OR to_regclass('public.v_stock_min_dynamique') IS NOT NULL
       OR to_regclass('public.v_machine_consommation') IS NOT NULL THEN
        RAISE EXCEPTION '2026-10-27g : une vue retirée est encore là (v_conso_retenue, v_stock_min_dynamique, v_machine_consommation)';
    END IF;
    IF position('v_ctl_c67' IN pg_get_viewdef('v_controles'::regclass)) = 0
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = 'f_machine_consommation'
                         AND pg_get_function_result(p.oid) LIKE '%correction_kg%')
       OR NOT EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'COCKPIT' AND champ = 'nb_trop_tard') THEN
        RAISE EXCEPTION '2026-10-27g : migration incomplète (C67, f_machine_consommation ou champs)';
    END IF;
END $$;

COMMIT;
