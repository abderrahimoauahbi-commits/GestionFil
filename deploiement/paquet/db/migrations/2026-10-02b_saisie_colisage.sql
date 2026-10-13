-- =============================================================================
-- MIGRATION 2026-10-02b — la saisie des mouvements, transferts et inventaires
-- se fait comme celle du bon de commande (cahier « Gestion des lots », regle 8)
--
--   * PALETTES ENTAMEES. Une palette entamee se compte 21,64, pas 22 : les
--     palettes des mouvements et des transferts passent en decimal, comme
--     celles du bon de commande. Aucune vue ne lit ces deux colonnes.
--
--   * L'INVENTAIRE COMPTE AUSSI LES BOBINES. Le theorique en bobines est
--     photographie a l'ouverture ; le comptage porte kilos, bobines et
--     palettes ; le poids catalogue est fige sur la ligne. C'est ce qui permet
--     de lire, au comptage, l'ecart de poids PAR BOBINE.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-02b_saisie_colisage.sql
-- =============================================================================
BEGIN;

ALTER TABLE ligne_mouvement ALTER COLUMN nb_palettes TYPE numeric(18,2);
ALTER TABLE ligne_transfert ALTER COLUMN nb_palettes TYPE numeric(18,2);

ALTER TABLE ligne_inventaire
    ADD COLUMN IF NOT EXISTS nb_bobines_theorique bigint
        CHECK (nb_bobines_theorique IS NULL OR nb_bobines_theorique >= 0),
    ADD COLUMN IF NOT EXISTS nb_bobines_comptees bigint
        CHECK (nb_bobines_comptees IS NULL OR nb_bobines_comptees >= 0),
    ADD COLUMN IF NOT EXISTS nb_palettes_comptees numeric(18,2)
        CHECK (nb_palettes_comptees IS NULL OR nb_palettes_comptees >= 0),
    ADD COLUMN IF NOT EXISTS poids_unitaire_theorique_kg numeric(18,4)
        CHECK (poids_unitaire_theorique_kg IS NULL OR poids_unitaire_theorique_kg > 0);

-- Les inventaires en cours recoivent leur photographie de bobines et leur
-- poids catalogue, comme s'ils venaient d'etre ouverts.
UPDATE ligne_inventaire li
   SET nb_bobines_theorique = COALESCE(
           (SELECT sl.nb_bobines FROM stock_lot sl
             WHERE sl.code_reference = li.code_reference AND sl.code_magasin = li.code_magasin
               AND sl.lot_fournisseur = li.lot_fournisseur),
           (SELECT sm.nb_bobines FROM stock_magasin sm
             WHERE sm.code_reference = li.code_reference AND sm.code_magasin = li.code_magasin
               AND li.lot_fournisseur IS NULL)),
       poids_unitaire_theorique_kg = (SELECT NULLIF(r.poids_bobine_kg, 0) FROM reference r
                                       WHERE r.code_reference = li.code_reference)
  FROM inventaire i
 WHERE i.id_inventaire = li.id_inventaire AND i.statut = 'EN_COURS';

SELECT 'palettes decimales et comptage en bobines : en place';

COMMIT;
