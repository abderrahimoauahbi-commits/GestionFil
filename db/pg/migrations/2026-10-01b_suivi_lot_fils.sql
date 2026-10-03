-- =============================================================================
-- MIGRATION 2026-10-01b — le suivi par lot est mis en service sur les FILS
--
-- POURQUOI. Un lot est une production du fournisseur : meme bain, meme nuance.
-- Deux lots d'une meme reference peuvent differer de teinte, et la difference
-- apparait au tissage. Decision de l'utilisateur, 01/10/2026 : suivi par lot
-- pour tous les fils. Les accessoires (simili cuir, plastique, SBR, latex)
-- restent hors suivi.
--
-- CE QUE CELA IMPOSE. Avec suivi_lot = 1, le declencheur trg_lmvt_lot_requis
-- refuse tout mouvement sans lot. Or le stock deja present n'en a aucun : sans
-- transition, la premiere sortie de demain serait refusee.
--
-- LA TRANSITION. Le stock que les lots n'expliquent pas passe sous le lot
-- conventionnel « SANS-LOT », par reference et par magasin. C'est le MEME lot
-- qu'on emploie quand le fournisseur n'a pas mis de lot sur la marchandise, ou
-- pour une reference qui ne se gere pas par lot : une seule convention, que
-- l'ecran affiche « Sans lot ». Les quantites des
-- magasins NE BOUGENT PAS : seul le detail par lot est pose. Ce lot s'epuise
-- aux sorties, ou se ventile au prochain inventaire, qui sait saisir les lots.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-01b_suivi_lot_fils.sql
-- =============================================================================
BEGIN;

UPDATE reference
   SET suivi_lot = 1
 WHERE suivi_lot = 0
   AND code_categorie IN ('ACR', 'COT', 'JUT', 'LAI', 'PES', 'PES-CH', 'PES-PO', 'PES-SH', 'PP', 'SOI', 'VIS');

-- Le stock non explique par des lots, ferme sous le lot de reprise.
INSERT INTO stock_lot (code_reference, code_magasin, lot_fournisseur, quantite_kg, nb_bobines, prix_entree_mad)
SELECT sm.code_reference, sm.code_magasin, 'SANS-LOT',
       round(sm.quantite_kg - COALESCE(l.kg, 0), 4),
       GREATEST(0, COALESCE(sm.nb_bobines, 0) - COALESCE(l.bob, 0)),
       sm.cmup_mad
  FROM stock_magasin sm
  JOIN reference r ON r.code_reference = sm.code_reference AND r.suivi_lot = 1
  LEFT JOIN (SELECT code_reference, code_magasin, sum(quantite_kg) AS kg, sum(nb_bobines) AS bob
               FROM stock_lot GROUP BY 1, 2) l
         ON l.code_reference = sm.code_reference AND l.code_magasin = sm.code_magasin
 WHERE sm.quantite_kg - COALESCE(l.kg, 0) > 0.0001
ON CONFLICT (code_reference, code_magasin, lot_fournisseur)
DO UPDATE SET quantite_kg = stock_lot.quantite_kg + EXCLUDED.quantite_kg;

-- PREUVE : par reference et magasin suivis, la somme des lots egale le stock.
SELECT 'fils suivis par lot : ' || (SELECT count(*) FROM reference WHERE suivi_lot = 1)
    || ' ; ecarts lots / magasin : '
    || (SELECT count(*) FROM stock_magasin sm
          JOIN reference r ON r.code_reference = sm.code_reference AND r.suivi_lot = 1
         WHERE abs(sm.quantite_kg - COALESCE((SELECT sum(quantite_kg) FROM stock_lot sl
                                               WHERE sl.code_reference = sm.code_reference
                                                 AND sl.code_magasin = sm.code_magasin), 0)) > 0.001);

COMMIT;
