-- =============================================================================
-- 2026-10-17b — ADR-003 : reprise du dossier d'import 19/26 vers l'arrivage
-- =============================================================================
-- La migration 2026-10-17 a basculé vers 'BON' les seuls dossiers VIERGES. Trois
-- dossiers en cours avaient déjà reçu par l'ancien circuit et ne pouvaient pas
-- être basculés sans perte : `synchroniser_recu_arrivages` RECALCULE les kilos
-- depuis les arrivages, avec un COALESCE(..., 0) — basculer sans arrivage
-- remettrait leurs quantités reçues à zéro.
--
-- Deux d'entre eux n'ont qu'un reliquat de 2,79 et 8,28 kg (0,1 %) : ils se
-- solderont seuls. Le troisième, 19/26, attend encore 1 250 kg d'une référence
-- JAMAIS reçue (PES-20/2 GLOBALTEX, sans ligne de bon) : il lui faut un chemin
-- d'entrée, donc la bascule, donc la reprise de son historique en arrivage.
--
-- CE QUE FAIT CETTE MIGRATION, DANS CET ORDRE ET D'UN SEUL BLOC
--
--   1. Elle bascule 19/26 vers 'BON'. À partir de là, le déclencheur
--      d'étanchéité (qui ne vise que les dossiers 'FACTURE') cesse de refuser
--      ses lignes en réception locale.
--   2. Elle inscrit un ARRIVAGE HISTORIQUE reprenant la réception RIM-2026-0019
--      du 13/07/2024 : mêmes quantités, mêmes lots, même magasin, chaque ligne
--      pegée à sa ligne de bon.
--
-- L'ordre compte, et l'atomicité encore plus : un recalcul qui surviendrait
-- entre les deux verrait un dossier basculé sans arrivage et effacerait ses
-- kilos. Les deux gestes sont donc encadrés par un BEGIN/COMMIT EXPLICITE —
-- psql n'ouvre PAS de transaction pour un fichier sans --single-transaction,
-- et s'y fier a déjà produit l'état dangereux une fois, sur une copie.
--
-- AUCUN MOUVEMENT DE STOCK N'EST CRÉÉ, ET C'EST VOULU. La marchandise est
-- entrée en stock en 2024 par l'ancien circuit ; elle y est toujours. Vérifié :
-- aucun déclencheur de `reception` ni de `ligne_reception` n'écrit au grand
-- livre — l'entrée en stock est le fait du code applicatif à la validation
-- (`domain/reception.rs`). Insérer un arrivage déjà VALIDE n'ajoute donc rien
-- au stock : il documente ce qui a eu lieu.
--
-- UN SIGNAL ATTENDU, ET QU'IL FAUT LAISSER : le contrôle C32 (« réception
-- valorisée absente de l'historique des prix ») signalera les deux lignes de
-- cet arrivage. Le prix n'est pas manquant — l'historique porte bien ces deux
-- achats du 13/07/2024, aux mêmes montants, inscrits à l'époque par l'ancien
-- circuit. C'est le LIEN qui manque : leur `id_ligne_reception` désigne des
-- identifiants d'`import_reception_lignes`, une autre table, et pointait donc
-- déjà dans le vide avant cette reprise.
--
-- Ce lien ne se répare pas : `historique_prix` est IMMUABLE (règle R03), parce
-- qu'il fonde le CMUP. Une migration de rattachement a été écrite puis retirée
-- le 17/10 — le déclencheur l'a refusée, et il a raison. Créer de nouvelles
-- entrées dupliquerait l'historique d'achat et fausserait tout prix moyen.
--
-- Le signal C32 est donc exact et doit rester. Sa criticité est CRITIQUE — non
-- bloquante, mais pas anodine : c'est le prix assumé d'une reprise historique,
-- et il doit rester visible plutôt qu'être effacé.
--
-- REJOUABLE : tout est gardé par l'absence de l'arrivage de reprise.
-- =============================================================================

BEGIN;

-- ---- 1. La bascule du dossier ------------------------------------------------
UPDATE import_dossiers
   SET circuit_reception = 'BON'
 WHERE numero = '19/26'
   AND circuit_reception = 'FACTURE';

-- ---- 2. L'en-tête de l'arrivage historique -----------------------------------
INSERT INTO reception (
    id_reception, numero_reception, date_reception, code_fournisseur,
    statut, id_utilisateur_reception, id_utilisateur_pesee,
    id_utilisateur_controle, date_controle, taux_change_reception,
    id_dossier_import, num_bon_livraison)
SELECT 'rep-19-26-' || substr(md5('19/26'), 1, 24),
       'REP-IMP-19-26',
       ir.date_reception,
       f.code_fournisseur,
       'VALIDE',
       -- LA SEGREGATION DES TACHES EST RECONSTITUEE A L'IDENTIQUE : le peseur
       -- d'origine reste le receptionnaire, le valideur d'origine reste le
       -- controleur. La contrainte `reception_check` exige qu'ils different, et
       -- `reception_check1` qu'une reception VALIDE porte son controle date.
       COALESCE(ir.id_utilisateur_pesee, ir.id_utilisateur_creation),
       ir.id_utilisateur_pesee,
       ir.id_utilisateur_validation,
       ir.date_validation,
       -- `reception_check1` exige aussi le taux applique : c'est celui de la
       -- facture d'import qui a porte cette marchandise.
       f.taux_change,
       d.id_dossier,
       ir.numero
  FROM import_dossiers d
  JOIN import_factures f ON f.id_dossier = d.id_dossier
  JOIN import_facture_lignes fl ON fl.id_facture = f.id_facture
  JOIN import_reception_lignes irl ON irl.id_ligne = fl.id_ligne
  JOIN import_receptions ir ON ir.id_reception = irl.id_reception
 WHERE d.numero = '19/26'
   AND ir.id_utilisateur_validation IS NOT NULL
   AND ir.id_utilisateur_validation <> COALESCE(ir.id_utilisateur_pesee, ir.id_utilisateur_creation)
   AND NOT EXISTS (SELECT 1 FROM reception WHERE numero_reception = 'REP-IMP-19-26')
 LIMIT 1;

-- ---- 3. Les lignes, pegées à leur ligne de bon -------------------------------
INSERT INTO ligne_reception (
    id_reception, ligne_numero, code_reference, id_ligne_bc,
    unite_saisie, facteur_kg, quantite_pesee_unite, quantite_stock_kg,
    prix_kg_devise, code_devise, taux_change, prix_kg_mad,
    code_magasin_dest, lot_fournisseur, statut_qualite)
SELECT r.id_reception,
       row_number() OVER (ORDER BY fl.code_reference),
       fl.code_reference,
       fl.id_ligne_bc,
       'kg', 1,
       irl.quantite_recue_kg,
       irl.quantite_recue_kg,
       fl.prix_unitaire_devise,
       f.code_devise,
       f.taux_change,
       ROUND(fl.prix_unitaire_devise * f.taux_change, 4),
       irl.code_magasin,
       irl.lot_fournisseur,
       'CONFORME'
  FROM import_dossiers d
  JOIN import_factures f ON f.id_dossier = d.id_dossier
  JOIN import_facture_lignes fl ON fl.id_facture = f.id_facture
  JOIN import_reception_lignes irl ON irl.id_ligne = fl.id_ligne
  JOIN reception r ON r.numero_reception = 'REP-IMP-19-26'
 WHERE d.numero = '19/26'
   AND fl.id_ligne_bc IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM ligne_reception lr WHERE lr.id_reception = r.id_reception);

-- ---- 4. Témoin ---------------------------------------------------------------
DO $$
DECLARE
    v_lignes integer;
    v_kg     numeric;
BEGIN
    SELECT count(*), COALESCE(round(sum(lr.quantite_stock_kg), 2), 0)
      INTO v_lignes, v_kg
      FROM ligne_reception lr
      JOIN reception r ON r.id_reception = lr.id_reception
     WHERE r.numero_reception = 'REP-IMP-19-26';
    RAISE NOTICE '2026-10-17b : arrivage de reprise REP-IMP-19-26 — % ligne(s), % kg reconstitués.',
                 v_lignes, v_kg;
END $$;

COMMIT;
