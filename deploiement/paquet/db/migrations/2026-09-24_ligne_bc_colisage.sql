-- =============================================================================
-- MIGRATION 2026-09-24 — la ligne de bon retient son colisage
--
-- LE DEFAUT. La grille de saisie offre de DETACHER le calcul : palettes,
-- bobines et quantite cessent alors de se repondre, et chacune se saisit
-- seule. C'est necessaire — un fournisseur livre une palette entamee, et
-- 17 palettes pleines plus une aux trois quarts ne se deduisent d'aucun
-- poids. Mais `ligne_bc` ne portait AUCUNE colonne pour les recevoir : les
-- palettes affichees etaient CALCULEES a la lecture
--
--     nb_palettes = quantite_kg / (poids_bobine x bobines_par_palette)
--
-- et le nombre saisi partait au serveur... qui ne le demandait pas. On
-- proposait donc un detachement qui ne detachait rien : au rechargement, le
-- calcul reprenait la main et effacait la saisie sans le dire.
--
-- CE QUI CHANGE. Deux colonnes. Desormais LES TROIS EXPRESSIONS SE GARDENT —
-- quantite, palettes, bobines — que le calcul soit lie ou detache. Elles
-- disent la meme marchandise de trois facons ; n'en retenir qu'une obligeait a
-- rededuire les autres, et la deduction se trompe des que le colisage reel
-- s'ecarte du theorique.
--
-- Elles restent NULLABLES pour les lignes DEJA en base, saisies avant cette
-- migration : sur celles-la, la lecture retombe sur le calcul d'origine plutot
-- que d'afficher un vide.
--
-- POURQUOI PAS UNE COLONNE CALCULEE. Parce qu'on veut justement pouvoir s'en
-- ecarter. Une colonne GENERATED rendrait le detachement impossible par
-- construction.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-24_ligne_bc_colisage.sql
-- =============================================================================

ALTER TABLE ligne_bc
    -- NUMERIC ET NON ENTIER POUR LES PALETTES. Le calcul rend 21,64 palettes
    -- pour 22 638 kg ; arrondir a 22 a l'enregistrement changerait en silence
    -- un chiffre que l'ecran venait d'afficher. Une palette entamee est une
    -- realite du quai, pas une imprecision.
    ADD COLUMN IF NOT EXISTS nb_palettes_saisi numeric(18, 2)
        CHECK (nb_palettes_saisi IS NULL OR nb_palettes_saisi >= 0),
    ADD COLUMN IF NOT EXISTS nb_bobines_saisi bigint
        CHECK (nb_bobines_saisi IS NULL OR nb_bobines_saisi >= 0);

COMMENT ON COLUMN ligne_bc.nb_palettes_saisi IS
    'Les palettes telles que saisies. NULL : ligne anterieure, on calcule.';
COMMENT ON COLUMN ligne_bc.nb_bobines_saisi IS
    'Les bobines telles que saisies. NULL : ligne anterieure, on calcule.';

-- PREUVE : les deux colonnes existent et sont bien nullables.
SELECT column_name || ' : ' || data_type || ', nullable=' || is_nullable
  FROM information_schema.columns
 WHERE table_name = 'ligne_bc'
   AND column_name IN ('nb_palettes_saisi', 'nb_bobines_saisi')
 ORDER BY 1;
