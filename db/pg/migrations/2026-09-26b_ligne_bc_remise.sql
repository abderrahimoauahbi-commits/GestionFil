-- =============================================================================
-- MIGRATION 2026-09-26b — la remise, condition de prix de la ligne de commande
--
-- CE QUE FONT LES AUTRES. Dans SAP, une remise est une CONDITION DE PRIX du bon
-- de commande, posee sur la ligne a cote du prix brut. Le prix NET qui en
-- resulte valorise ensuite l'entree en stock. La facture, elle, releve de la
-- comptabilite : ce n'est pas la qu'on apprend qu'un rabais a ete negocie.
--
-- POURQUOI ICI ET PAS AILLEURS. Une remise negociee change ce que la
-- marchandise vous coute REELLEMENT, donc la valeur de votre stock et votre
-- CUMP. La laisser hors de l'ERP, c'est valoriser chaque kilo au prix brut —
-- trop cher du montant de la remise, dans chaque etat et chaque marge.
--
-- CE QUI CHANGE.
--   * `remise_pct`, en pourcentage du prix brut, 0 par defaut : les lignes
--     existantes ne bougent pas d'un centime.
--   * `total_ligne_devise` devient NET de remise. C'est lui que la somme de
--     l'en-tete additionne : le montant du bon devient donc net lui aussi.
--   * `prix_kg_devise` devient NET de remise. C'est lui que la reception
--     reprend pour valoriser le stock (RG-09) : le kilo entre au prix
--     reellement paye.
--
-- `prix_unitaire_devise` RESTE LE PRIX BRUT. C'est celui que l'acheteur
-- negocie et que le fournisseur imprime ; le rabais se lit a cote, et le net se
-- deduit. Recopier le net a la place du brut effacerait la trace de ce qui a
-- ete obtenu.
--
-- ALTER COLUMN ... SET EXPRESSION existe depuis PostgreSQL 17 : la colonne
-- garde son nom, son type et les vues qui la lisent. Seul son calcul change.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-26b_ligne_bc_remise.sql
-- =============================================================================

ALTER TABLE ligne_bc
    ADD COLUMN IF NOT EXISTS remise_pct numeric(5, 2) NOT NULL DEFAULT 0
        CHECK (remise_pct >= 0 AND remise_pct < 100);

COMMENT ON COLUMN ligne_bc.remise_pct IS
    'Remise negociee, en % du prix brut. Condition de prix de la ligne, comme dans SAP.';

ALTER TABLE ligne_bc
    ALTER COLUMN total_ligne_devise SET EXPRESSION AS
        (quantite_commandee_unite * prix_unitaire_devise * (1 - remise_pct / 100)),
    ALTER COLUMN prix_kg_devise SET EXPRESSION AS
        (prix_unitaire_devise * (1 - remise_pct / 100) / facteur_kg);

COMMENT ON COLUMN ligne_bc.total_ligne_devise IS
    'Montant NET de la ligne : quantite x prix brut x (1 - remise).';
COMMENT ON COLUMN ligne_bc.prix_kg_devise IS
    'Prix au kilo NET de remise : c''est lui qui valorise l''entree en stock.';

-- PREUVE : la colonne existe, et les deux calculs integrent la remise.
SELECT column_name || ' : ' || COALESCE(generation_expression, data_type)
  FROM information_schema.columns
 WHERE table_name = 'ligne_bc'
   AND column_name IN ('remise_pct', 'total_ligne_devise', 'prix_kg_devise')
 ORDER BY 1;
