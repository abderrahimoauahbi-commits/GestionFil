-- =============================================================================
-- MIGRATION 2026-10-03c — le poids d'une bobine et les bobines par palette
--                         suivent chaque reception, avec leur historique
--
-- LE FOURNISSEUR CHANGE LE POIDS DE SES BOBINES, parfois le nombre de bobines
-- par palette. La fiche article gardait la valeur de sa creation : l'ecart de
-- poids, le colisage et l'arrondi a la palette raisonnaient sur un chiffre
-- perime.
--
-- A CHAQUE RECEPTION VALIDEE (locale ou import), pour chaque article recu :
--   * le POIDS D'UNE BOBINE mesure = kilos recus / bobines recues ;
--   * les BOBINES PAR PALETTE observees = bobines / palettes, quand les
--     palettes sont entieres (une palette entamee fausserait le compte) ;
--   * le PRIX AU KILO paye, dans la devise du fournisseur et en dirhams ;
-- sont ecrits dans `historique_conditionnement`, avec la valeur que la fiche
-- portait AVANT, puis la fiche article est mise a jour.
--
-- UN GARDE-FOU : une mesure qui s'ecarte de plus de 50 % de la fiche est
-- presque toujours une erreur de saisie (des kilos tapes a la place des
-- bobines). Elle est gardee dans l'historique, marquee « ecartee », et ne
-- touche pas la fiche.
--
-- L'EVALUATION se lit dans deux vues : `v_suivi_conditionnement` (reception par
-- reception : variation du poids, du colisage et du prix) et
-- `v_evaluation_conditionnement` (par fournisseur : stabilite du poids, du
-- colisage et du prix).
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-03c_suivi_conditionnement.sql
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS historique_conditionnement (
    id_historique            text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    date_evenement           text    NOT NULL
        DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    source                   text    NOT NULL CHECK (source IN ('RECEPTION', 'IMPORT')),
    id_document              text    NOT NULL,
    numero_document          text,
    code_reference           text    NOT NULL REFERENCES reference (code_reference),
    code_fournisseur         text,
    kg                       numeric(18,4) NOT NULL,
    nb_bobines               bigint,
    nb_palettes              numeric(18,2),
    poids_bobine_avant       numeric(18,4),
    poids_bobine_mesure      numeric(18,4),
    bobines_palette_avant    bigint,
    bobines_palette_observe  bigint,
    prix_kg_devise           numeric(18,6),
    code_devise              text,
    prix_kg_mad              numeric(18,6),
    -- La fiche a-t-elle ete mise a jour ? Non : mesure ecartee par le garde-fou.
    poids_applique           bigint  NOT NULL DEFAULT 0 CHECK (poids_applique IN (0, 1)),
    colisage_applique        bigint  NOT NULL DEFAULT 0 CHECK (colisage_applique IN (0, 1)),
    id_utilisateur           text
);
CREATE INDEX IF NOT EXISTS ix_hist_cond_reference ON historique_conditionnement (code_reference, date_evenement);
CREATE INDEX IF NOT EXISTS ix_hist_cond_fournisseur ON historique_conditionnement (code_fournisseur);
ALTER TABLE historique_conditionnement OWNER TO gestionfil;

-- Appelee par le serveur a la validation d'une reception, dans sa transaction,
-- APRES les mouvements : la ligne de mouvement a deja fige l'ancien poids
-- catalogue (c'est contre lui que l'ecart de la livraison se mesure).
CREATE OR REPLACE FUNCTION fn_suivi_conditionnement(p_source text, p_id_document text, p_utilisateur text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    n integer;
BEGIN
    INSERT INTO historique_conditionnement
        (source, id_document, numero_document, code_reference, code_fournisseur, kg, nb_bobines, nb_palettes,
         poids_bobine_avant, poids_bobine_mesure, bobines_palette_avant, bobines_palette_observe,
         prix_kg_devise, code_devise, prix_kg_mad, poids_applique, colisage_applique, id_utilisateur)
    WITH recu AS (
        -- Reception locale : le prix au kilo est sur la ligne.
        SELECT lr.code_reference, rc.code_fournisseur, rc.numero_reception AS numero,
               sum(lr.quantite_stock_kg) AS kg, sum(lr.nb_bobines_saisi) AS bobines,
               sum(lr.nb_palettes_saisi) AS palettes,
               bool_and(lr.nb_palettes_saisi IS NULL OR lr.nb_palettes_saisi = trunc(lr.nb_palettes_saisi)) AS palettes_entieres,
               sum(lr.quantite_stock_kg * lr.prix_kg_devise) AS montant_devise, max(lr.code_devise) AS code_devise,
               sum(lr.quantite_stock_kg * lr.prix_kg_mad) AS montant_mad
          FROM ligne_reception lr JOIN reception rc ON rc.id_reception = lr.id_reception
         WHERE p_source = 'RECEPTION' AND lr.id_reception = p_id_document AND lr.quantite_stock_kg > 0
         GROUP BY lr.code_reference, rc.code_fournisseur, rc.numero_reception
        UNION ALL
        -- Import : le prix au kilo est celui de la facture (montant / poids net).
        SELECT l.code_reference, f.code_fournisseur, ir.numero,
               sum(rl.quantite_recue_kg), sum(rl.nb_bobines), sum(rl.nb_palettes), true,
               sum(rl.quantite_recue_kg * l.montant_devise / NULLIF(l.poids_net_kg, 0)), max(f.code_devise),
               sum(rl.quantite_recue_kg * l.montant_devise / NULLIF(l.poids_net_kg, 0) * COALESCE(f.taux_change, 1))
          FROM import_reception_lignes rl
          JOIN import_receptions ir     ON ir.id_reception = rl.id_reception
          JOIN import_facture_lignes l  ON l.id_ligne = rl.id_ligne
          JOIN import_factures f        ON f.id_facture = l.id_facture
         WHERE p_source = 'IMPORT' AND rl.id_reception = p_id_document AND rl.quantite_recue_kg > 0
           AND l.code_reference IS NOT NULL
         GROUP BY l.code_reference, f.code_fournisseur, ir.numero
    ), x AS (
        SELECT u.*,
               CASE WHEN u.bobines > 0 AND u.kg > 0 THEN round(u.kg / u.bobines, 4) END AS poids,
               CASE WHEN u.palettes > 0 AND u.palettes_entieres AND u.bobines > 0
                    THEN round(u.bobines / u.palettes)::bigint END AS bpp
          FROM recu u
    )
    SELECT p_source, p_id_document, x.numero, x.code_reference, x.code_fournisseur, x.kg,
           NULLIF(x.bobines, 0), NULLIF(x.palettes, 0),
           r.poids_bobine_kg, x.poids, r.bobines_par_palette, x.bpp,
           round(x.montant_devise / NULLIF(x.kg, 0), 6), x.code_devise, round(x.montant_mad / NULLIF(x.kg, 0), 6),
           CASE WHEN x.poids IS NOT NULL
                 AND (COALESCE(r.poids_bobine_kg, 0) = 0
                      OR abs(x.poids - r.poids_bobine_kg) / r.poids_bobine_kg <= 0.5) THEN 1 ELSE 0 END,
           CASE WHEN x.bpp IS NOT NULL
                 AND (COALESCE(r.bobines_par_palette, 0) = 0
                      OR abs(x.bpp - r.bobines_par_palette)::numeric / r.bobines_par_palette <= 0.5) THEN 1 ELSE 0 END,
           p_utilisateur
      FROM x JOIN reference r ON r.code_reference = x.code_reference;
    GET DIAGNOSTICS n = ROW_COUNT;

    -- La fiche suit la derniere mesure retenue.
    UPDATE reference r SET poids_bobine_kg = round(h.poids_bobine_mesure, 4)
      FROM historique_conditionnement h
     WHERE h.id_document = p_id_document AND h.source = p_source
       AND h.code_reference = r.code_reference AND h.poids_applique = 1;
    UPDATE reference r SET bobines_par_palette = h.bobines_palette_observe
      FROM historique_conditionnement h
     WHERE h.id_document = p_id_document AND h.source = p_source
       AND h.code_reference = r.code_reference AND h.colisage_applique = 1;
    RETURN n;
END;
$$;
ALTER FUNCTION fn_suivi_conditionnement(text, text, text) OWNER TO gestionfil;

-- RECEPTION PAR RECEPTION : ce qui a change, et de combien.
DROP VIEW IF EXISTS v_suivi_conditionnement CASCADE;
CREATE VIEW v_suivi_conditionnement AS
SELECT h.*,
       r.designation,
       f.nom AS fournisseur_nom,
       round((h.poids_bobine_mesure - h.poids_bobine_avant) / NULLIF(h.poids_bobine_avant, 0) * 100, 2)
                                                                  AS variation_poids_pct,
       h.bobines_palette_observe - h.bobines_palette_avant         AS variation_colisage,
       lag(h.prix_kg_devise) OVER w                               AS prix_precedent_devise,
       round((h.prix_kg_devise - lag(h.prix_kg_devise) OVER w)
             / NULLIF(lag(h.prix_kg_devise) OVER w, 0) * 100, 2)  AS variation_prix_pct
  FROM historique_conditionnement h
  JOIN reference r ON r.code_reference = h.code_reference
  LEFT JOIN fournisseur f ON f.code_fournisseur = h.code_fournisseur
WINDOW w AS (PARTITION BY h.code_reference, h.code_devise ORDER BY h.date_evenement);
ALTER VIEW v_suivi_conditionnement OWNER TO gestionfil;

-- PAR FOURNISSEUR : tient-il son poids, son colisage, son prix ?
DROP VIEW IF EXISTS v_evaluation_conditionnement CASCADE;
CREATE VIEW v_evaluation_conditionnement AS
SELECT s.code_fournisseur, s.fournisseur_nom,
       count(DISTINCT s.id_document)                                         AS nb_receptions,
       count(DISTINCT s.code_reference)                                      AS nb_references,
       round(avg(abs(s.variation_poids_pct)), 2)                             AS variation_poids_moyenne_pct,
       count(*) FILTER (WHERE abs(s.variation_poids_pct) >
             (SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_LotTolOrangePct'))
                                                                             AS poids_hors_tolerance,
       count(*) FILTER (WHERE s.variation_colisage <> 0)                      AS colisages_changes,
       round(avg(s.variation_prix_pct), 2)                                   AS variation_prix_moyenne_pct,
       count(*) FILTER (WHERE s.variation_prix_pct > 0)                      AS hausses_prix,
       count(*) FILTER (WHERE s.poids_applique = 0 AND s.poids_bobine_mesure IS NOT NULL)
                                                                             AS mesures_ecartees,
       max(s.date_evenement)                                                 AS derniere_reception
  FROM v_suivi_conditionnement s
 GROUP BY s.code_fournisseur, s.fournisseur_nom;
ALTER VIEW v_evaluation_conditionnement OWNER TO gestionfil;

SELECT 'suivi du conditionnement : en place' AS etat;
COMMIT;
