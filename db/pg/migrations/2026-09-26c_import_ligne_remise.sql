-- =============================================================================
-- MIGRATION 2026-09-26c — la remise sur la ligne de facture d'importation
--
-- LA REMISE DOIT ETRE DES DEUX COTES. Le bon de commande la porte depuis la
-- migration 2026-09-26b. Mais une marchandise importee n'entre pas en stock au
-- prix du bon : elle entre a la VALEUR DE LA FACTURE, reglee par la banque sur
-- l'engagement d'importation, au taux que porte la facture. Une remise
-- consentie par le fournisseur etranger qui n'apparaitrait que sur le bon
-- laisserait donc le stock valorise au brut — trop cher du montant du rabais,
-- dans le cout de revient et dans chaque marge qui en decoule.
--
-- CE QUI CHANGE.
--   * `remise_pct`, en % du prix brut, 0 par defaut : les lignes existantes ne
--     bougent pas d'un centime.
--   * `montant_devise` devient NET de remise. C'est lui que la validation de
--     la reception divise par le poids net pour obtenir le prix au kilo qui
--     entre en stock, et lui que la repartition des frais d'approche utilise
--     pour la part de chaque ligne dans le dossier. Les deux deviennent nets
--     sans autre changement.
--
-- `prix_unitaire_devise` RESTE LE PRIX BRUT, celui que le fournisseur imprime.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-26c_import_ligne_remise.sql
-- =============================================================================

ALTER TABLE import_facture_lignes
    ADD COLUMN IF NOT EXISTS remise_pct numeric(5, 2) NOT NULL DEFAULT 0
        CHECK (remise_pct >= 0 AND remise_pct < 100);

COMMENT ON COLUMN import_facture_lignes.remise_pct IS
    'Remise consentie par le fournisseur, en % du prix brut facture.';

ALTER TABLE import_facture_lignes
    ALTER COLUMN montant_devise SET EXPRESSION AS
        (round(quantite * prix_unitaire_devise * (1 - remise_pct / 100), 2));

COMMENT ON COLUMN import_facture_lignes.montant_devise IS
    'Montant NET de la ligne : quantite x prix brut x (1 - remise). Il valorise le stock.';

-- PREUVE
SELECT column_name || ' : ' || COALESCE(generation_expression, data_type)
  FROM information_schema.columns
 WHERE table_name = 'import_facture_lignes'
   AND column_name IN ('remise_pct', 'montant_devise')
 ORDER BY 1;
