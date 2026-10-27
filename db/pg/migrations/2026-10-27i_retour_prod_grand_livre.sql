-- =============================================================================
-- 2026-10-27i — Le retour de production (RETOUR_PROD) entre au grand livre
-- =============================================================================
-- ARBITRAGE DE L'UTILISATEUR (27/10/2026) : « RETOUR_PROD → déduit du réel, si
-- c'est bien un retour de matière au stock. »
--
-- C'en est un : type de mouvement d'ENTRÉE (signe +1), « Retour de production »,
-- motif « Retour depuis atelier » (catégorie PRODUCTION), CMUP inchangé, valorisé
-- au CMUP du magasin — le fil sorti vers l'atelier qui revient au magasin. Il est
-- retiré de la saisie libre depuis la règle 12 (08/10/2026) : aucune voie du
-- serveur n'en crée plus ; ceux qui existent (historique) n'étaient pas déduits.
--
-- `v_consommation_fait` le range comme RETOUR_CONSO (2026-10-27g, Q7) : une nature
-- à lui, RETOUR_PROD, kg NÉGATIF, DANS le réel, daté au jour du retour, valorisé au
-- prix porté par le mouvement (à défaut le CMUP du jour reconstitué, puis le CMUP
-- actuel, comme toute ligne de mouvement du grand livre). Mouvements contre-passés
-- et contre-passations exclus, comme les autres.
--
-- Rien d'autre ne change : mêmes colonnes (CREATE OR REPLACE suffit, les vues
-- dépendantes restent en place) ; v_conso_reelle / v_conso_reelle_mois (D1, D2 :
-- ABC, XYZ, rythme réel) le déduisent par `dans_reel` ; v_of_consommation (D3) et
-- v_qualite_consommation (D4), qui choisissent leurs natures, ne le lisent pas ;
-- C67 ne lit que les faits machine (source DECISION) : il n'est pas touché.
--
-- Rejouable. Enregistrée par migrer.py. Le serveur n'en dépend pas : elle n'est
-- pas exigée au démarrage.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

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
       AND (m.code_type_mvt IN ('CONSO_DIRECTE', 'RETOUR_CONSO', 'RETOUR_PROD', 'SORTIE_PROD', 'AJUST_INV_NEG', 'AJUST_INV_POS')
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
                WHEN 'RETOUR_PROD'         THEN 'RETOUR_PROD'
                WHEN 'SORTIE_HORS_MACHINE' THEN 'HORS_MACHINE'
                WHEN 'SORTIE_PROD'         THEN 'REBUT_DECHET'
                ELSE 'AUTRE_ECART' END AS nature,
           CASE WHEN x.code_type_mvt IN ('AJUST_INV_NEG', 'AJUST_INV_POS') THEN 'AJUSTEMENT_INVENTAIRE' END AS categorie_ecart,
           CASE WHEN x.code_type_mvt IN ('RETOUR_CONSO', 'RETOUR_PROD', 'AJUST_INV_POS') THEN -x.quantite_kg ELSE x.quantite_kg END AS kg,
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
    'Grand livre de la consommation (27/10/2026) : une ligne par fait, decisions machine actives (date de la fiche) et mouvements non contre-passes. RETOUR_PROD (retour depuis l atelier) deduit du reel a sa date comme RETOUR_CONSO (27/10/2026, 27i). dans_reel = tout sauf AUTRE_ECART (corrections, non qualifies, regularisations, erreurs, ajustements d inventaire).';

-- Témoin : la nature est rangée, négative et dans le réel.
DO $$
DECLARE
    def text := pg_get_viewdef('v_consommation_fait'::regclass);
BEGIN
    IF position('''RETOUR_PROD''' IN def) = 0 THEN
        RAISE EXCEPTION '2026-10-27i : v_consommation_fait ne range pas RETOUR_PROD';
    END IF;
    IF EXISTS (SELECT 1 FROM v_consommation_fait WHERE nature = 'RETOUR_PROD' AND (kg > 0 OR NOT dans_reel)) THEN
        RAISE EXCEPTION '2026-10-27i : un RETOUR_PROD positif ou hors réel dans le grand livre';
    END IF;
END $$;

COMMIT;
