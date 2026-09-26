-- =============================================================================
-- MIGRATION 2026-09-26 — la ligne de reception compte enfin ses palettes
--
-- LE DEFAUT. Trois documents sur quatre savent retenir un colisage constate :
--
--     ligne_bc         nb_palettes_saisi, nb_bobines_saisi
--     ligne_mouvement  nb_palettes, nb_bobines
--     ligne_transfert  nb_palettes, nb_bobines
--     ligne_reception  nb_colis_ligne  <-- et rien d'autre
--
-- La reception, c'est-a-dire l'endroit ou l'on COMPTE VRAIMENT — sur un quai,
-- devant le camion — est le seul a ne pas pouvoir le faire. Elle n'a qu'un
-- `nb_colis_ligne` generique, ancetre des deux autres colonnes, reste la parce
-- que cette table ne les a jamais recues.
--
-- CE QUE CELA EMPECHAIT. « 21 palettes ET ce poids-la » est la regle du quai
-- plutot que l'exception : une palette entamee ne se deduit d'aucune pesee, un
-- reliquat non plus. L'ecran pouvait afficher les palettes — deduites du poids
-- — mais pas enregistrer celles qu'on avait comptees. Le detachement du calcul
-- n'y aurait donc rien eu a ranger, et le receptionnaire aurait vu son constat
-- disparaitre au rechargement.
--
-- NULLABLES, comme sur `ligne_bc` : sur les lignes anterieures, la lecture
-- retombe sur le calcul theorique plutot que d'afficher un vide.
--
-- `nb_colis_ligne` EST CONSERVE, et ce n'est pas une hesitation. Il alimente un
-- controle qui a sa valeur propre — le poids moyen par colis, qui revele un
-- conditionnement inattendu — et il porte ce que le bon de livraison ANNONCE,
-- la ou les deux nouvelles colonnes portent ce qu'on a COMPTE. Les confondre
-- ferait disparaitre l'ecart entre les deux, qui est precisement ce qu'on
-- cherche a voir.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-26_reception_colisage.sql
-- =============================================================================

ALTER TABLE ligne_reception
    -- NUMERIC ET NON ENTIER POUR LES PALETTES. Une palette entamee est une
    -- realite du quai, pas une imprecision : arrondir 21,64 a 22 changerait en
    -- silence un chiffre que le receptionnaire venait d'ecrire.
    ADD COLUMN IF NOT EXISTS nb_palettes_saisi numeric(18, 2)
        CHECK (nb_palettes_saisi IS NULL OR nb_palettes_saisi >= 0),
    -- UNE BOBINE NE SE COUPE PAS : elle se compte par unites entieres.
    ADD COLUMN IF NOT EXISTS nb_bobines_saisi bigint
        CHECK (nb_bobines_saisi IS NULL OR nb_bobines_saisi >= 0);

COMMENT ON COLUMN ligne_reception.nb_palettes_saisi IS
    'Les palettes COMPTEES sur le quai. NULL : ligne anterieure, on calcule.';
COMMENT ON COLUMN ligne_reception.nb_bobines_saisi IS
    'Les bobines COMPTEES sur le quai. NULL : ligne anterieure, on calcule.';
COMMENT ON COLUMN ligne_reception.nb_colis_ligne IS
    'Les colis ANNONCES par le bon de livraison — a comparer au compte reel.';

-- PREUVE : les deux colonnes existent, sont nullables, et la reception porte
-- desormais le meme colisage que les trois autres documents.
SELECT table_name || '.' || column_name || ' : ' || data_type
       || ', nullable=' || is_nullable
  FROM information_schema.columns
 WHERE table_name = 'ligne_reception'
   AND column_name IN ('nb_palettes_saisi', 'nb_bobines_saisi')
 ORDER BY 1;
