-- =============================================================================
-- MIGRATION 2026-09-18c — LES TAUX DE CHANGE REELS
-- -----------------------------------------------------------------------------
-- La base naissait avec les taux du cahier des charges : 9,50 pour le dollar,
-- 11,00 pour l'euro, ouverts au 1er janvier et jamais fermes. Ce sont des
-- valeurs de depart, pas des cours. Les vrais, saisis le 17 septembre 2026 :
--
--     USD 9,2704 a partir du 15/09/2026
--     EUR 10,8500 a partir du 17/09/2026
--
-- Ils comptent : sans achat, le CMUP est le prix catalogue converti a ce taux
-- (2026-09-17h). Entre 9,50 et 9,2704 il y a 2,4 %, soit 180 000 MAD sur la
-- valeur du stock de depart.
--
-- LE CMUP SE RECALCULE ICI, mais SEULEMENT si aucun achat ne l'a fixe : des
-- qu'une ligne de mouvement porte un prix, le CMUP est une moyenne d'achats
-- reels, et un taux de change n'a pas a la deplacer.
--
-- Rejouable : les periodes se posent en ON CONFLICT, et le recalcul retombe sur
-- la meme valeur.
-- =============================================================================

BEGIN;

-- La periode ouverte se ferme a la date d'effet du nouveau taux.
UPDATE taux_change SET date_fin = '2026-09-15'
 WHERE code_devise = 'USD' AND date_fin IS NULL AND date_debut < '2026-09-15';
UPDATE taux_change SET date_fin = '2026-09-17'
 WHERE code_devise = 'EUR' AND date_fin IS NULL AND date_debut < '2026-09-17';

-- `WHERE NOT EXISTS` ET NON `ON CONFLICT` : le declencheur anti-chevauchement
-- (RG-09) s'execute AVANT l'insertion, donc avant que le conflit soit vu. Au
-- second passage, un ON CONFLICT echouait sur « periodes chevauchantes ».
INSERT INTO taux_change (code_devise, taux, date_debut, source)
SELECT v.devise, v.taux, v.debut, v.source
  FROM (VALUES ('USD', 9.2704::numeric,  '2026-09-15', 'Taux bancaire releve le 17/09/2026'),
               ('EUR', 10.8500::numeric, '2026-09-17', 'Taux bancaire releve le 17/09/2026'))
       AS v(devise, taux, debut, source)
 WHERE NOT EXISTS (SELECT 1 FROM taux_change t
                    WHERE t.code_devise = v.devise AND t.date_debut = v.debut);

-- Le CMUP, tant qu'aucun achat ne l'a fixe.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ligne_mouvement WHERE prix_kg_mad IS NOT NULL) THEN
        RAISE NOTICE 'des mouvements sont valorises : le CMUP n''est pas recalcule';
    ELSE
        UPDATE stock_magasin sm
           SET cmup_mad = fn_prix_catalogue_mad(sm.code_reference),
               date_maj = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         WHERE sm.quantite_kg > 0
           AND sm.cmup_mad IS DISTINCT FROM fn_prix_catalogue_mad(sm.code_reference)
           AND fn_prix_catalogue_mad(sm.code_reference) IS NOT NULL;

        UPDATE reference r
           SET cmup_mad = v.cmup,
               date_dernier_cmup = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          FROM (SELECT r2.code_reference,
                       COALESCE(
                           (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                              FROM stock_magasin sm
                             WHERE sm.code_reference = r2.code_reference
                               AND sm.quantite_kg > 0 AND sm.cmup_mad IS NOT NULL),
                           fn_prix_catalogue_mad(r2.code_reference)) AS cmup
                  FROM reference r2) v
         WHERE v.code_reference = r.code_reference
           AND r.cmup_mad IS DISTINCT FROM v.cmup;

        RAISE NOTICE 'CMUP recalcule au taux en vigueur';
    END IF;
END $$;

COMMIT;
