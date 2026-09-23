-- =============================================================================
-- LA LIGNE LIBRE : de la marchandise SANS reference au catalogue
--
-- Un echantillon, un type nouveau, un article que le fournisseur n'a pas encore
-- au catalogue. C'est de la marchandise — elle arrive physiquement — mais elle
-- n'a aucune reference sous laquelle on pourrait la ranger en stock, ni aucun
-- CMUP a alimenter. On la commande, on la paie, et elle ne compte dans aucune
-- statistique de matiere : elle n'en est pas une.
--
-- POURQUOI PAS UNE PRESTATION. Le fret ne franchit jamais le quai ; un
-- echantillon si. La distinction ne change rien au stock — aucun des deux n'y
-- entre — mais elle change ce qu'on attend a l'arrivee, et c'est exactement la
-- distinction que font les ERP du marche entre un poste de service et un poste
-- sans article.
--
-- Les deux partagent tout le reste : ni reference, ni poids, ni conversion.
-- Elles sortent donc d'elles-memes des vues d'en-cours, qui filtrent
-- `quantite_restante_kg > 0`.
-- =============================================================================

BEGIN;

ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_type_ligne_check;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_type_ligne_check
    CHECK (type_ligne IN ('MARCHANDISE', 'LIBRE', 'SERVICE'));

ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_type_coherent;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_type_coherent
    CHECK (
        (type_ligne = 'MARCHANDISE'
             AND code_reference IS NOT NULL
             AND quantite_commandee_kg > 0)
     OR (type_ligne IN ('LIBRE', 'SERVICE')
             AND code_reference IS NULL
             AND libelle IS NOT NULL AND btrim(libelle) <> ''
             AND quantite_commandee_kg = 0
             AND facteur_kg = 1
             AND id_proposition IS NULL
             AND besoin_kg_origine IS NULL)
    );

ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_conversion_coherente;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_conversion_coherente
    CHECK (type_ligne <> 'MARCHANDISE'
        OR abs(quantite_commandee_kg - quantite_commandee_unite * facteur_kg) < 0.001);

COMMIT;
