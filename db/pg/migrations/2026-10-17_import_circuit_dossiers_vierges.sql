-- =============================================================================
-- 2026-10-17 — ADR-003 : les dossiers d'import VIERGES rejoignent le circuit BON
-- =============================================================================
-- Le 16/10/2026, l'écran `/receptions-import` et ses routes ont été retirés :
-- la marchandise importée entre désormais par la RÉCEPTION UNIFIÉE, un arrivage
-- dont chaque ligne pege à une ligne de bon de commande.
--
-- Ce retrait a laissé un trou que le banc a révélé : un dossier resté en
-- `circuit_reception = 'FACTURE'` ne peut plus recevoir **par aucune porte**.
-- La réception d'import n'existe plus, et la réception locale lui est interdite
-- par le déclencheur d'étanchéité (2026-10-08f), qui le renvoie vers l'écran
-- disparu. La marchandise ne peut plus entrer.
--
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS
--
-- Elle bascule vers 'BON' les seuls dossiers **non clôturés et vierges de toute
-- réception**. Pour eux la bascule est sans effet de bord : il n'y a aucun kilo
-- reçu à préserver, et ils retrouvent un chemin d'entrée.
--
-- Elle ne touche PAS les dossiers qui ont déjà reçu par l'ancien circuit, et
-- c'est le point important. `importation::synchroniser_recu_arrivages` ne
-- s'exécute que pour les dossiers en circuit 'BON', et il **recalcule**
-- `import_facture_lignes.quantite_recue_kg` depuis les arrivages, avec un
-- COALESCE(..., 0) : basculer un dossier dont la marchandise est entrée par
-- l'ancien circuit REMETTRAIT SES KILOS REÇUS À ZÉRO au premier recalcul.
-- Ces dossiers-là demandent une reprise de leurs réceptions en arrivages, ou
-- une clôture — cas par cas, jamais en masse.
--
-- Elle ne touche PAS non plus les dossiers clôturés : leur histoire est faite.
--
-- REJOUABLE : l'UPDATE est idempotent (il ne voit plus rien au second passage).
-- =============================================================================

UPDATE import_dossiers d
   SET circuit_reception = 'BON'
 WHERE d.circuit_reception = 'FACTURE'
   AND d.statut <> 'CLOTURE'
   -- Vierge de toute réception par l'ancien circuit : rien à préserver.
   AND NOT EXISTS (
         SELECT 1
           FROM import_factures f
           JOIN import_facture_lignes fl ON fl.id_facture = f.id_facture
           JOIN import_reception_lignes irl ON irl.id_ligne = fl.id_ligne
          WHERE f.id_dossier = d.id_dossier)
   -- Et aucun kilo déjà porté sur ses lignes de facture, quelle qu'en soit
   -- l'origine : une reprise manuelle a pu en inscrire sans passer par
   -- `import_reception_lignes`.
   AND NOT EXISTS (
         SELECT 1
           FROM import_factures f
           JOIN import_facture_lignes fl ON fl.id_facture = f.id_facture
          WHERE f.id_dossier = d.id_dossier
            AND COALESCE(fl.quantite_recue_kg, 0) > 0);

-- Témoin : ce qui reste en circuit FACTURE sans être clôturé a forcément déjà
-- reçu. Ces dossiers n'ont plus de chemin d'entrée et doivent être traités un
-- par un — reprise en arrivages, ou clôture sur le reliquat.
DO $$
DECLARE
    v_restants integer;
BEGIN
    SELECT count(*) INTO v_restants
      FROM import_dossiers
     WHERE circuit_reception = 'FACTURE' AND statut <> 'CLOTURE';
    IF v_restants > 0 THEN
        RAISE NOTICE
          '2026-10-17 : % dossier(s) restent en circuit FACTURE avec des kilos déjà reçus. '
          'Ils n''ont plus de chemin de réception : à reprendre en arrivages ou à clôturer, un par un.',
          v_restants;
    END IF;
END $$;
