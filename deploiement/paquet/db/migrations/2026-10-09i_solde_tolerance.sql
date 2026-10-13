-- =============================================================================
-- 2026-10-09i — Les reliquats dans la tolerance se soldent (regle 6, 09/10/2026)
-- =============================================================================
-- Arbitrage : a la validation d'une reception, une ligne de bon recue a au
-- moins « commande x (1 - tolerance du fournisseur) » est SOLDEE (livraison
-- terminee) ; son reste sort de l'en-cours du MRP ; un bon dont toutes les
-- lignes sont soldees passe a CLOTURE sans droit particulier (fin de vie
-- normale). Un reliquat plus grand reste PARTIEL : l'abandonner reste une
-- decision de la Direction (VALIDER). Le service applique la regle desormais ;
-- cette migration solde UNE FOIS les reliquats deja en attente (BC-2026-0004
-- sur la copie), avec une trace au journal d'audit.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

WITH soldees AS (
    UPDATE ligne_bc lb
       SET statut = 'SOLDE'
      FROM bon_commande b
     WHERE b.id_bc = lb.id_bc
       AND lb.statut = 'PARTIEL' AND lb.type_ligne = 'MARCHANDISE'
       AND b.statut IN ('ENVOYE', 'LIVRE_PARTIEL')
       AND lb.quantite_recue_kg > 0
       AND lb.quantite_recue_kg
           >= lb.quantite_commandee_kg * (1 - fn_tolerance_fournisseur(b.code_fournisseur) / 100.0) - 0.001
 RETURNING lb.id_ligne_bc, b.numero_bc, lb.ligne_numero, lb.quantite_restante_kg
)
INSERT INTO audit_log (table_concernee, operation, id_enregistrement, anciennes_valeurs, nouvelles_valeurs)
SELECT 'ligne_bc', 'UPDATE', s.id_ligne_bc, '{"statut": "PARTIEL"}',
       json_build_object('statut', 'SOLDE', 'bon', s.numero_bc, 'ligne', s.ligne_numero,
                         'reliquat_kg', s.quantite_restante_kg,
                         'motif', 'Cloture automatique par migration : reliquat dans la tolerance de pesee')::text
  FROM soldees s;

-- Les bons dont toutes les lignes de marchandise sont soldees se cloturent.
WITH clos AS (
    UPDATE bon_commande b
       SET statut = 'CLOTURE'
     WHERE b.statut = 'LIVRE_PARTIEL'
       AND NOT EXISTS (SELECT 1 FROM ligne_bc l
                        WHERE l.id_bc = b.id_bc AND l.type_ligne = 'MARCHANDISE'
                          AND l.statut NOT IN ('SOLDE', 'ANNULE'))
 RETURNING b.id_bc, b.numero_bc
)
INSERT INTO audit_log (table_concernee, operation, id_enregistrement, anciennes_valeurs, nouvelles_valeurs)
SELECT 'bon_commande', 'UPDATE', c.id_bc, '{"statut": "LIVRE_PARTIEL"}',
       json_build_object('statut', 'CLOTURE', 'bon', c.numero_bc,
                         'motif', 'Cloture automatique par migration : toutes les lignes soldees')::text
  FROM clos c;

COMMIT;
