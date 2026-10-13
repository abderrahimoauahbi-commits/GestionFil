-- =============================================================================
-- MIGRATION 2026-09-26d — la remise lisible dans le cout de revient importe
--
-- L'ecran de facture d'importation lit ses lignes dans v_import_cout_revient,
-- qui nomme ses colonnes une par une : la remise ajoutee par 2026-09-26c n'y
-- figurait donc pas, et l'ecran l'aurait perdue a chaque rechargement.
--
-- La vue est RECONSTRUITE A PARTIR DE SA DEFINITION EN BASE (pg_get_viewdef),
-- et non du fichier source : c'est la seule maniere d'etre sur de ne rien
-- changer d'autre que la colonne ajoutee. Les montants et le cout de revient
-- qu'elle calcule deviennent nets de remise d'eux-memes, puisqu'ils partent
-- de montant_devise.
-- =============================================================================

CREATE OR REPLACE VIEW v_import_cout_revient AS
WITH frais AS (
         SELECT lignes_frais_repartition.id_article_dossier,
            sum(lignes_frais_repartition.montant_alloue_dhs) AS frais_dhs
           FROM lignes_frais_repartition
          GROUP BY lignes_frais_repartition.id_article_dossier
        )
 SELECT l.id_ligne,
    f.id_dossier,
    d.numero AS numero_dossier,
    d.statut AS statut_dossier,
    f.id_facture,
    f.numero_facture,
    f.date_facture,
    f.code_fournisseur,
    fo.nom AS fournisseur_nom,
    l.ligne_numero,
    l.type_ligne,
    l.code_reference,
    COALESCE(r.designation, l.libelle) AS designation,
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
    round(l.montant_devise * f.taux_change, 2) AS valeur_achat_dhs,
    round(l.montant_devise * f.taux_change / l.quantite, 4) AS prix_achat_unitaire_dhs,
    COALESCE(fr.frais_dhs, 0::numeric) AS frais_alloues_dhs,
    round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0::numeric) AS cout_revient_dhs,
    round((round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0::numeric)) / l.quantite, 4) AS cout_revient_unitaire_dhs,
        CASE
            WHEN l.poids_net_kg > 0::numeric THEN round((round(l.montant_devise * f.taux_change, 2) + COALESCE(fr.frais_dhs, 0::numeric)) / l.poids_net_kg, 4)
            ELSE NULL::numeric
        END AS cout_revient_kg_dhs,
        CASE
            WHEN l.montant_devise > 0::numeric THEN round(COALESCE(fr.frais_dhs, 0::numeric) * 100::numeric / round(l.montant_devise * f.taux_change, 2), 2)
            ELSE NULL::numeric
        END AS coef_frais_pct,
    l.quantite_recue_kg,
    l.reste_kg,
    l.soldee,
    l.libelle_couleur,
    -- LA REMISE, en derniere position : CREATE OR REPLACE VIEW n'ajoute
    -- de colonnes qu'en fin de liste.
    l.remise_pct
   FROM import_facture_lignes l
     JOIN import_factures f ON f.id_facture = l.id_facture
     JOIN import_dossiers d ON d.id_dossier = f.id_dossier
     LEFT JOIN reference r ON r.code_reference = l.code_reference
     LEFT JOIN fournisseur fo ON fo.code_fournisseur = f.code_fournisseur
     LEFT JOIN ligne_bc lb ON lb.id_ligne_bc = l.id_ligne_bc
     LEFT JOIN bon_commande bc ON bc.id_bc = lb.id_bc
     LEFT JOIN frais fr ON fr.id_article_dossier = l.id_ligne;

ALTER VIEW v_import_cout_revient OWNER TO gestionfil;

SELECT 'remise_pct presente dans la vue : ' || count(*) FROM information_schema.columns
 WHERE table_name = 'v_import_cout_revient' AND column_name = 'remise_pct';
