-- =============================================================================
-- MIGRATION 2026-10-02c — les statistiques par lot (cockpit, analyses, etats)
--
-- Tout se lit dans le registre (`lot`, `v_lot`) et le grand livre
-- (`ligne_mouvement`) : aucune donnee nouvelle, seulement des lectures.
--
--   v_stat_lot_categorie       stock Projet / Restes / bloque / dormant, par article
--   v_stat_lot_age             age des lots par tranche, kg et valeur
--   v_stat_divergence_bobine   ecart de poids par bobine, par ligne pesee
--   v_stat_divergence_fournisseur / _article / _mois   ses agregats
--   v_stat_derive_fournisseur  derive cumulee des lots, par fournisseur
--   v_stat_autorisations       file et delais des demandes, par type
--   v_cockpit_lots             les compteurs du poste de travail
--
-- Les mouvements INTERNES (fusion) et l'entree d'un transfert (qui confirme
-- la sortie) n'entrent pas dans les ecarts de poids.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-02c_statistiques_lots.sql
-- =============================================================================
BEGIN;

DROP VIEW IF EXISTS v_stat_lot_categorie CASCADE;
CREATE VIEW v_stat_lot_categorie AS
SELECT l.code_reference,
       l.designation,
       l.code_categorie,
       count(*) FILTER (WHERE l.solde_kg > 0)                                              AS nb_lots,
       round(sum(l.solde_kg) FILTER (WHERE l.categorie = 'PROJET' AND l.statut = 'LIBRE' AND NOT l.dormant), 2) AS projet_kg,
       round(sum(l.solde_kg) FILTER (WHERE l.categorie = 'RESTES' AND l.statut = 'LIBRE' AND NOT l.dormant), 2) AS restes_kg,
       round(sum(l.solde_kg) FILTER (WHERE l.statut = 'BLOQUE'), 2)                       AS bloque_kg,
       round(sum(l.solde_kg) FILTER (WHERE l.dormant AND l.statut <> 'BLOQUE'), 2)        AS dormant_kg,
       round(sum(l.solde_kg), 2)                                                           AS total_kg,
       round(sum(l.valeur_mad) FILTER (WHERE l.categorie = 'PROJET' AND l.statut = 'LIBRE' AND NOT l.dormant), 2) AS projet_mad,
       round(sum(l.valeur_mad) FILTER (WHERE l.categorie = 'RESTES' AND l.statut = 'LIBRE' AND NOT l.dormant), 2) AS restes_mad,
       round(sum(l.valeur_mad), 2)                                                         AS total_mad,
       count(*) FILTER (WHERE l.a_basculer)                                                AS nb_a_basculer
  FROM v_lot l
 WHERE l.solde_kg > 0
 GROUP BY l.code_reference, l.designation, l.code_categorie;
ALTER VIEW v_stat_lot_categorie OWNER TO gestionfil;

DROP VIEW IF EXISTS v_stat_lot_age CASCADE;
CREATE VIEW v_stat_lot_age AS
SELECT CASE WHEN a.jours < 90  THEN '0-90 j'
            WHEN a.jours < 180 THEN '90-180 j'
            WHEN a.jours < 365 THEN '180-365 j'
            ELSE 'plus d''un an' END                            AS tranche,
       CASE WHEN a.jours < 90 THEN 1 WHEN a.jours < 180 THEN 2 WHEN a.jours < 365 THEN 3 ELSE 4 END AS ordre,
       a.categorie,
       count(*)                                                  AS nb_lots,
       round(sum(a.solde_kg), 2)                                 AS kg,
       round(sum(a.valeur_mad), 2)                               AS valeur_mad
  FROM (SELECT l.*, (current_date - substr(l.date_creation, 1, 10)::date) AS jours
          FROM v_lot l WHERE l.solde_kg > 0) a
 GROUP BY 1, 2, 3;
ALTER VIEW v_stat_lot_age OWNER TO gestionfil;

-- Une ligne par ligne de mouvement PESEE (bobines et poids catalogue connus).
DROP VIEW IF EXISTS v_stat_divergence_bobine CASCADE;
CREATE VIEW v_stat_divergence_bobine AS
SELECT lm.code_reference,
       r.designation,
       lm.lot_fournisseur,
       COALESCE(lo.code_fournisseur, r.code_fournisseur)        AS code_fournisseur,
       f.nom                                                    AS fournisseur_nom,
       m.code_type_mvt,
       tm.libelle                                               AS type_libelle,
       substr(m.date_mouvement, 1, 7)                           AS mois,
       lm.nb_bobines,
       lm.quantite_kg,
       lm.poids_unitaire_theorique_kg                           AS poids_catalogue_kg,
       lm.poids_reel_moyen_bobine_kg                            AS poids_reel_kg,
       lm.ecart_theorique_pct                                   AS ecart_pct
  FROM ligne_mouvement lm
  JOIN mouvement m       ON m.id_mouvement = lm.id_mouvement
  JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
  JOIN reference r       ON r.code_reference = lm.code_reference
  LEFT JOIN lot lo       ON lo.code_reference = lm.code_reference AND lo.lot_fournisseur = lm.lot_fournisseur
  LEFT JOIN fournisseur f ON f.code_fournisseur = COALESCE(lo.code_fournisseur, r.code_fournisseur)
 WHERE lm.ecart_theorique_pct IS NOT NULL
   AND tm.interne = 0
   AND m.code_type_mvt <> 'TRANSFERT_ENTREE';
ALTER VIEW v_stat_divergence_bobine OWNER TO gestionfil;

-- L'ecart moyen est PONDERE par le theorique : une ligne de 2 400 bobines
-- pese plus qu'une ligne de 10.
DROP VIEW IF EXISTS v_stat_divergence_fournisseur CASCADE;
CREATE VIEW v_stat_divergence_fournisseur AS
SELECT code_fournisseur, fournisseur_nom,
       count(*)                                                                        AS nb_lignes,
       sum(nb_bobines)                                                                 AS bobines,
       round(sum(quantite_kg - nb_bobines * poids_catalogue_kg)
             / NULLIF(sum(nb_bobines * poids_catalogue_kg), 0) * 100, 2)               AS ecart_moyen_pct,
       round(min(ecart_pct), 2)                                                        AS ecart_min_pct,
       round(max(ecart_pct), 2)                                                        AS ecart_max_pct,
       round(sum(quantite_kg - nb_bobines * poids_catalogue_kg), 2)                    AS ecart_kg
  FROM v_stat_divergence_bobine
 GROUP BY code_fournisseur, fournisseur_nom;
ALTER VIEW v_stat_divergence_fournisseur OWNER TO gestionfil;

DROP VIEW IF EXISTS v_stat_divergence_article CASCADE;
CREATE VIEW v_stat_divergence_article AS
SELECT code_reference, designation, fournisseur_nom,
       count(*)                                                                        AS nb_lignes,
       sum(nb_bobines)                                                                 AS bobines,
       round(avg(poids_catalogue_kg), 3)                                               AS poids_catalogue_kg,
       round(sum(quantite_kg) / NULLIF(sum(nb_bobines), 0), 3)                         AS poids_reel_moyen_kg,
       round(sum(quantite_kg - nb_bobines * poids_catalogue_kg)
             / NULLIF(sum(nb_bobines * poids_catalogue_kg), 0) * 100, 2)               AS ecart_moyen_pct,
       round(sum(quantite_kg - nb_bobines * poids_catalogue_kg), 2)                    AS ecart_kg
  FROM v_stat_divergence_bobine
 GROUP BY code_reference, designation, fournisseur_nom;
ALTER VIEW v_stat_divergence_article OWNER TO gestionfil;

DROP VIEW IF EXISTS v_stat_divergence_mois CASCADE;
CREATE VIEW v_stat_divergence_mois AS
SELECT mois,
       count(*)                                                                        AS nb_lignes,
       round(sum(quantite_kg - nb_bobines * poids_catalogue_kg)
             / NULLIF(sum(nb_bobines * poids_catalogue_kg), 0) * 100, 2)               AS ecart_moyen_pct,
       round(sum(quantite_kg - nb_bobines * poids_catalogue_kg), 2)                    AS ecart_kg
  FROM v_stat_divergence_bobine
 GROUP BY mois;
ALTER VIEW v_stat_divergence_mois OWNER TO gestionfil;

DROP VIEW IF EXISTS v_stat_derive_fournisseur CASCADE;
CREATE VIEW v_stat_derive_fournisseur AS
SELECT l.code_fournisseur, l.fournisseur_nom,
       count(*)                                                                        AS nb_lots,
       count(*) FILTER (WHERE l.alerte_derive = 'ORANGE')                              AS lots_orange,
       count(*) FILTER (WHERE l.alerte_derive = 'ROUGE')                               AS lots_rouges,
       round(sum(l.ecart_cumule_kg), 2)                                                AS ecart_cumule_kg,
       round(avg(l.ecart_cumule_pct), 2)                                               AS ecart_moyen_pct
  FROM v_lot l
 WHERE l.ecart_cumule_pct IS NOT NULL
 GROUP BY l.code_fournisseur, l.fournisseur_nom;
ALTER VIEW v_stat_derive_fournisseur OWNER TO gestionfil;

DROP VIEW IF EXISTS v_stat_autorisations CASCADE;
CREATE VIEW v_stat_autorisations AS
SELECT type_demande, niveau,
       count(*)                                                      AS total,
       count(*) FILTER (WHERE statut = 'EN_ATTENTE')                 AS en_attente,
       count(*) FILTER (WHERE statut = 'ACCORDEE')                   AS accordees,
       count(*) FILTER (WHERE statut = 'REFUSEE')                    AS refusees,
       round(avg(EXTRACT(EPOCH FROM (date_decision::timestamptz - date_demande::timestamptz)) / 3600.0)
             FILTER (WHERE date_decision IS NOT NULL)::numeric, 1)   AS delai_moyen_h,
       round(100.0 * count(*) FILTER (WHERE statut = 'REFUSEE')
             / NULLIF(count(*) FILTER (WHERE statut IN ('ACCORDEE','REFUSEE')), 0), 1) AS taux_refus_pct
  FROM demande_autorisation
 GROUP BY type_demande, niveau;
ALTER VIEW v_stat_autorisations OWNER TO gestionfil;

DROP VIEW IF EXISTS v_cockpit_lots CASCADE;
CREATE VIEW v_cockpit_lots AS
SELECT (SELECT count(*) FROM v_lot WHERE a_basculer)                                       AS lots_a_basculer,
       (SELECT count(*) FROM v_lot WHERE dormant)                                          AS lots_dormants,
       (SELECT count(*) FROM v_lot WHERE statut = 'BLOQUE' AND solde_kg > 0)               AS lots_bloques,
       (SELECT count(*) FROM v_lot WHERE alerte_derive IN ('ORANGE','ROUGE') AND solde_kg > 0) AS lots_en_derive,
       (SELECT count(*) FROM demande_autorisation WHERE statut = 'EN_ATTENTE')            AS autorisations_en_attente,
       (SELECT round(sum(solde_kg), 0) FROM v_lot WHERE categorie = 'RESTES' AND statut = 'LIBRE') AS restes_kg,
       (SELECT round(sum(solde_kg), 0) FROM v_lot WHERE categorie = 'PROJET' AND statut = 'LIBRE') AS projet_kg;
ALTER VIEW v_cockpit_lots OWNER TO gestionfil;

SELECT 'statistiques par lot : en place';
COMMIT;
