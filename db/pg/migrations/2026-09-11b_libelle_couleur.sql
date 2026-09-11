-- =============================================================================
-- MIGRATION 2026-09-11 (b) — LE LIBELLE DE LA COULEUR
-- -----------------------------------------------------------------------------
-- La facture fournisseur porte DEUX informations de couleur : le code
-- (« COLOUR CODE 7612 ») et son libelle (« COLOUR RED »). Seul le code etait
-- saisi. Le libelle rejoint la ligne de facture — repris par defaut de la
-- fiche reference — et la ligne de reception, qui le recopie de la facture.
--
-- La vue v_import_cout_revient gagne la colonne EN DERNIER : c'est la seule
-- facon de la remplacer sans la detruire (PostgreSQL garde l'ordre des
-- colonnes d'une vue remplacee).
-- =============================================================================

BEGIN;

ALTER TABLE import_facture_lignes   ADD COLUMN IF NOT EXISTS libelle_couleur text;
ALTER TABLE import_reception_lignes ADD COLUMN IF NOT EXISTS libelle_couleur text;

-- Les lignes deja saisies prennent le libelle de leur reference.
UPDATE import_facture_lignes l
   SET libelle_couleur = r.couleur
  FROM reference r
 WHERE r.code_reference = l.code_reference AND l.libelle_couleur IS NULL AND r.couleur IS NOT NULL;

UPDATE import_reception_lignes rl
   SET libelle_couleur = l.libelle_couleur
  FROM import_facture_lignes l
 WHERE l.id_ligne = rl.id_ligne AND rl.libelle_couleur IS NULL;

CREATE OR REPLACE VIEW v_import_cout_revient AS
WITH frais AS (
    SELECT id_article_dossier, sum(montant_alloue_dhs) AS frais_dhs
      FROM lignes_frais_repartition
     GROUP BY id_article_dossier
)
SELECT l.id_ligne,
       f.id_dossier,
       d.numero                                               AS numero_dossier,
       d.statut                                               AS statut_dossier,
       f.id_facture,
       f.numero_facture,
       f.date_facture,
       f.code_fournisseur,
       fo.nom                                                 AS fournisseur_nom,
       l.ligne_numero,
       l.type_ligne,
       l.code_reference,
       COALESCE(r.designation, l.libelle)                     AS designation,
       l.id_ligne_bc,
       bc.numero_bc,
       l.lot_fournisseur,
       l.code_couleur,
       l.unite,
       l.quantite,
       l.poids_net_kg,
       l.nb_bobines,
       l.nb_palettes,
       l.prix_unitaire_devise,
       f.code_devise,
       f.taux_change,
       l.montant_devise,
       l.pct_dossier,
       round(l.montant_devise * f.taux_change, 2)             AS valeur_achat_dhs,
       round(l.montant_devise * f.taux_change / l.quantite, 4) AS prix_achat_unitaire_dhs,
       COALESCE(fr.frais_dhs, 0)                              AS frais_alloues_dhs,
       round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0)
                                                              AS cout_revient_dhs,
       round((round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0))
             / l.quantite, 4)                                 AS cout_revient_unitaire_dhs,
       CASE WHEN l.poids_net_kg > 0 THEN
            round((round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0))
                  / l.poids_net_kg, 4) END                    AS cout_revient_kg_dhs,
       CASE WHEN l.montant_devise > 0 THEN
            round(COALESCE(fr.frais_dhs, 0) * 100 / round(l.montant_devise * f.taux_change, 2), 2)
       END                                                    AS coef_frais_pct,
       l.quantite_recue_kg,
       l.reste_kg,
       l.soldee,
       l.libelle_couleur
  FROM import_facture_lignes l
  JOIN import_factures f  ON f.id_facture = l.id_facture
  JOIN import_dossiers d  ON d.id_dossier = f.id_dossier
  LEFT JOIN reference r   ON r.code_reference = l.code_reference
  LEFT JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
  LEFT JOIN ligne_bc lb   ON lb.id_ligne_bc = l.id_ligne_bc
  LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc
  LEFT JOIN frais fr      ON fr.id_article_dossier = l.id_ligne;

ALTER VIEW v_import_cout_revient OWNER TO gestionfil;

COMMIT;
