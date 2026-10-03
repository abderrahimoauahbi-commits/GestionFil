BEGIN;
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_LotDormanceJours', 'Dormance d''un lot', '365', 'ENTIER', 'jours',
   'Un lot sans aucune activite (entree, sortie, constat) depuis cette duree est signale dormant.', 'STOCK', 'DIRECTION'),
  ('P_LotTolOrangePct', 'Ecart de poids : seuil orange', '1', 'DECIMAL', '%',
   'Au-dela, la ligne demande une confirmation (« Je confirme avoir verifie »).', 'STOCK', 'DIRECTION'),
  ('P_LotTolRougePct', 'Ecart de poids : seuil rouge', '3', 'DECIMAL', '%',
   'Au-dela, la ligne demande une autorisation d''un responsable.', 'STOCK', 'DIRECTION'),
  ('P_LotSeuilBobines', 'Seuil Projet / Restes : bobines d''un etage', '1344', 'ENTIER', 'bobines',
   'Un lot qui remplit au moins un etage de machine est du stock Projet ; en dessous, c''est un Reste. 1 344 = un etage de CRM1, TINGIS ou CRX.', 'STOCK', 'DIRECTION'),
  ('P_LotSeuilRestesKg', 'Seuil Projet / Restes en kilos', '5000', 'DECIMAL', 'kg',
   'Pour un article sans poids de bobine au catalogue (jute, colle) : sous ce poids, un lot est un Reste.', 'STOCK', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;
UPDATE parametre SET libelle = 'Seuil Projet / Restes en kilos', description = 'Pour un article sans poids de bobine au catalogue (jute, colle) : sous ce poids, un lot est un Reste.' WHERE code_parametre = 'P_LotSeuilRestesKg';
DROP VIEW IF EXISTS v_lot CASCADE;
ALTER TABLE reference DROP COLUMN IF EXISTS seuil_restes_kg;
ALTER TABLE reference
    ADD COLUMN IF NOT EXISTS seuil_lot_valeur numeric(18,2)
        CHECK (seuil_lot_valeur IS NULL OR seuil_lot_valeur > 0),
    ADD COLUMN IF NOT EXISTS seuil_lot_unite text
        CHECK (seuil_lot_unite IS NULL OR seuil_lot_unite IN ('kg', 'Bobine', 'Palette'));

-- Le seuil EFFECTIF d'un article : sa valeur, son unite, et ses deux
-- traductions (bobines, kilos) quand le colisage du catalogue les permet.
-- UN ARTICLE NON SUIVI PAR LOT N'A PAS DE STOCK MINIMUM PAR LOT : tout est
-- vide, et son stock compte en entier pour le plan d'achat (voir plus bas). La
-- valeur posee sur la fiche est gardee : elle revient si l'on rallume le suivi.
CREATE OR REPLACE FUNCTION fn_lot_seuil(p_reference text)
RETURNS TABLE (valeur numeric, unite text, bobines numeric, kg numeric)
LANGUAGE sql STABLE AS $$
    WITH r AS (
        SELECT seuil_lot_valeur AS v,
               CASE WHEN seuil_lot_valeur IS NOT NULL THEN COALESCE(seuil_lot_unite, 'kg') END AS u,
               NULLIF(poids_bobine_kg, 0)::numeric AS pb,
               NULLIF(bobines_par_palette, 0)::numeric AS bpp
          FROM reference WHERE code_reference = p_reference AND suivi_lot = 1
    ), p AS (
        SELECT max(CASE WHEN code_parametre = 'P_LotSeuilBobines' THEN valeur_courante::numeric END) AS bob,
               max(CASE WHEN code_parametre = 'P_LotSeuilRestesKg' THEN valeur_courante::numeric END) AS kg
          FROM parametre
    ), e AS (
        SELECT CASE WHEN r.v IS NOT NULL THEN r.v WHEN r.pb IS NOT NULL THEN p.bob ELSE p.kg END AS valeur,
               CASE WHEN r.v IS NOT NULL THEN r.u WHEN r.pb IS NOT NULL THEN 'Bobine' ELSE 'kg' END AS unite,
               r.pb, r.bpp
          FROM r CROSS JOIN p
    )
    SELECT e.valeur, e.unite,
           CASE e.unite WHEN 'Bobine' THEN e.valeur WHEN 'Palette' THEN e.valeur * e.bpp END,
           CASE e.unite WHEN 'kg' THEN e.valeur
                        WHEN 'Bobine' THEN round(e.valeur * e.pb, 2)
                        WHEN 'Palette' THEN round(e.valeur * e.bpp * e.pb, 2) END
      FROM e
$$;
ALTER FUNCTION fn_lot_seuil(text) OWNER TO gestionfil;

-- UN LOT ATTEINT-IL LE SEUIL ? En bobines quand le seuil se compte en bobines
-- et que le lot porte son nombre de bobines : c'est ce qui se charge sur un
-- etage, et un fil un peu leger ne doit pas faire passer un lot complet en
-- Reste. Sinon en kilos.
CREATE OR REPLACE FUNCTION fn_lot_au_seuil(p_reference text, p_kg numeric, p_bobines numeric)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM reference
                                  WHERE code_reference = p_reference AND suivi_lot = 1) THEN true
                WHEN s.bobines IS NOT NULL AND COALESCE(p_bobines, 0) > 0 THEN p_bobines >= s.bobines
                WHEN s.kg IS NOT NULL THEN COALESCE(p_kg, 0) >= s.kg
                ELSE COALESCE(p_kg, 0) >= (SELECT valeur_courante::numeric FROM parametre
                                            WHERE code_parametre = 'P_LotSeuilRestesKg') END
      FROM (SELECT 1) un LEFT JOIN fn_lot_seuil(p_reference) s ON true
$$;
ALTER FUNCTION fn_lot_au_seuil(text, numeric, numeric) OWNER TO gestionfil;
CREATE OR REPLACE FUNCTION fn_trg_lmvt_lot_registre() RETURNS trigger AS $$
DECLARE
    v_solde  numeric;
    v_bob    numeric;
    v_atteint boolean;
    v_signe  bigint;
    v_neuf   boolean;
BEGIN
    IF NEW.lot_fournisseur IS NULL OR btrim(NEW.lot_fournisseur) = '' THEN
        RETURN NEW;
    END IF;
    SELECT COALESCE(sum(quantite_kg), 0), COALESCE(sum(nb_bobines), 0) INTO v_solde, v_bob FROM stock_lot
     WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
    v_atteint := fn_lot_au_seuil(NEW.code_reference, v_solde, v_bob);
    SELECT tm.signe INTO v_signe FROM mouvement m JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;
    v_neuf := NOT EXISTS (SELECT 1 FROM lot WHERE code_reference = NEW.code_reference
                                              AND lot_fournisseur = NEW.lot_fournisseur);
    IF v_neuf THEN
        INSERT INTO lot (code_reference, lot_fournisseur, origine, code_fournisseur, categorie)
        SELECT NEW.code_reference, NEW.lot_fournisseur,
               CASE WHEN NEW.lot_fournisseur = 'SANS-LOT' THEN 'SANS_LOT'
                    WHEN NEW.lot_fournisseur LIKE 'RETOUR-%' THEN 'RETOUR'
                    ELSE 'FOURNISSEUR' END,
               r.code_fournisseur,
               CASE WHEN v_atteint THEN 'PROJET' ELSE 'RESTES' END
          FROM reference r WHERE r.code_reference = NEW.code_reference
        ON CONFLICT (code_reference, lot_fournisseur) DO NOTHING;
    ELSE
        UPDATE lot
           SET date_derniere_activite = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               categorie = CASE WHEN v_signe = 1 AND categorie = 'RESTES' AND v_atteint
                                THEN 'PROJET' ELSE categorie END
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_lot_registre() OWNER TO gestionfil;
DROP VIEW IF EXISTS v_lot CASCADE;
CREATE VIEW v_lot AS
WITH solde AS (
    SELECT code_reference, lot_fournisseur,
           sum(quantite_kg) AS kg, sum(nb_bobines) AS bobines,
           min(date_premiere_entree) AS premiere_entree
      FROM stock_lot GROUP BY 1, 2
), p AS (
    SELECT max(CASE WHEN code_parametre = 'P_LotDormanceJours' THEN valeur_courante::numeric END) AS dormance,
           max(CASE WHEN code_parametre = 'P_LotTolOrangePct' THEN valeur_courante::numeric END) AS orange,
           max(CASE WHEN code_parametre = 'P_LotTolRougePct' THEN valeur_courante::numeric END) AS rouge
      FROM parametre
)
SELECT l.code_reference,
       r.designation,
       r.code_categorie,
       l.lot_fournisseur,
       l.origine,
       l.code_fournisseur,
       f.nom                                            AS fournisseur_nom,
       l.statut,
       -- Sans suivi par lot, la reference n'a pas de Restes : tout son stock
       -- est du Projet, quelle que soit la categorie gardee sur la fiche.
       CASE WHEN r.suivi_lot = 1 THEN l.categorie ELSE 'PROJET' END AS categorie,
       l.fusionne_dans,
       l.date_creation,
       l.date_derniere_activite,
       COALESCE(s.kg, 0)                                AS solde_kg,
       COALESCE(s.bobines, 0)                           AS solde_bobines,
       -- Le seuil dans l'unite ou il est pose, et sa traduction en kilos.
       sx.valeur                                        AS seuil_valeur,
       sx.unite                                         AS seuil_unite,
       sx.bobines                                       AS seuil_bobines,
       sx.kg                                            AS seuil_restes_kg,
       (current_date - substr(l.date_derniere_activite, 1, 10)::date) AS jours_sans_activite,
       (COALESCE(s.kg, 0) > 0
        AND current_date - substr(l.date_derniere_activite, 1, 10)::date > p.dormance) AS dormant,
       -- Le basculement est MANUEL mais OBLIGATOIRE : l'alerte reste tant
       -- qu'un lot Projet est passe sous le seuil.
       (l.categorie = 'PROJET' AND l.statut = 'LIBRE'
        AND COALESCE(s.kg, 0) > 0
        AND NOT fn_lot_au_seuil(l.code_reference, s.kg, s.bobines))  AS a_basculer,
       v.ecart_cumule_kg,
       v.ecart_cumule_pct,
       v.poids_reel_moyen_bobine_kg,
       r.poids_bobine_kg                                AS poids_catalogue_bobine_kg,
       CASE WHEN v.ecart_cumule_pct IS NULL THEN NULL
            WHEN abs(v.ecart_cumule_pct) > p.rouge  THEN 'ROUGE'
            WHEN abs(v.ecart_cumule_pct) > p.orange THEN 'ORANGE'
            ELSE 'VERT' END                             AS alerte_derive,
       ROUND(COALESCE(s.kg, 0) * COALESCE(
           (SELECT sm.cmup_mad FROM stock_magasin sm
             WHERE sm.code_reference = l.code_reference AND sm.cmup_mad IS NOT NULL
             ORDER BY sm.quantite_kg DESC LIMIT 1), r.cmup_mad, 0), 2) AS valeur_mad
  FROM lot l
  JOIN reference r ON r.code_reference = l.code_reference
  LEFT JOIN fournisseur f ON f.code_fournisseur = l.code_fournisseur
  LEFT JOIN solde s ON s.code_reference = l.code_reference AND s.lot_fournisseur = l.lot_fournisseur
  LEFT JOIN v_lot_variation v ON v.code_reference = l.code_reference AND v.lot_fournisseur = l.lot_fournisseur
  LEFT JOIN LATERAL fn_lot_seuil(l.code_reference) sx ON true
  CROSS JOIN p;
ALTER VIEW v_lot OWNER TO gestionfil;


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

UPDATE lot l
   SET categorie = CASE WHEN fn_lot_au_seuil(l.code_reference, s.kg, s.bobines)
                        THEN 'PROJET' ELSE 'RESTES' END
  FROM (SELECT l2.code_reference, l2.lot_fournisseur,
               COALESCE(sum(sl.quantite_kg), 0) AS kg, COALESCE(sum(sl.nb_bobines), 0) AS bobines
          FROM lot l2
          LEFT JOIN stock_lot sl ON sl.code_reference = l2.code_reference
                                AND sl.lot_fournisseur = l2.lot_fournisseur
         GROUP BY 1, 2) s
 WHERE s.code_reference = l.code_reference AND s.lot_fournisseur = l.lot_fournisseur;
COMMIT;