-- =============================================================================
-- SEED 902 : JEU D'ESSAI DE L'ALERTE A DOUBLE DECLENCHEUR
--
-- Chaque scenario est porte par une reference DIFFERENTE, pour qu'on puisse
-- les lire separement a l'ecran. Ils ne sont pas inventes : ce sont les quatre
-- situations qui font mentir une couverture en jours, plus les deux axes qui
-- s'y ajoutent.
--
--   PP-6665     consommation reelle declaree  -> source_conso passe a REELLE
--   PES-61043   lot en quarantaine            -> veto physique (declencheur A)
--   PES-202     commande en retard            -> en-cours ecarte (declencheur B)
--   BANDE-01    magasin sous son minimum      -> veto physique, sans rupture
--   SBR-821     stock au-dela du maximum      -> drapeau sur-stock
--   PLAST-50    couverture confortable, magasin bas -> ecart majeur (C27)
--
-- CE FICHIER NE SE CHARGE QU'EN MODE DEMONSTRATION. Les mouvements sont
-- immuables (R03) : une saisie d'essai dans une base d'exploitation y resterait
-- pour toujours et fausserait durablement le CMUP.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. CONSOMMATION REELLE  (PP-6665)
--
-- Trois mois de sorties de production. Sans elles, v_conso_reelle est vide et
-- TOUTES les couvertures se calculent sur le previsionnel du MRP : le systeme
-- n'a jamais vu la moindre consommation constatee.
--
-- Le numero d'OF est obligatoire (C07) et le lot aussi, PP-6665 etant suivi.
-- -----------------------------------------------------------------------------
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, numero_of, id_utilisateur)
VALUES
 ('d902-c1','MVT-2026-9001', strftime('%Y-%m-%dT08:00:00.000Z','now','-75 days'),
  'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-101','00000000-0000-4000-a000-000000000015'),
 ('d902-c2','MVT-2026-9002', strftime('%Y-%m-%dT08:00:00.000Z','now','-45 days'),
  'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-102','00000000-0000-4000-a000-000000000015'),
 ('d902-c3','MVT-2026-9003', strftime('%Y-%m-%dT08:00:00.000Z','now','-15 days'),
  'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-103','00000000-0000-4000-a000-000000000015');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             quantite_saisie, unite_saisie, facteur_conversion, lot_fournisseur)
VALUES
 ('d902-c1',1,'PP-6665', 960.0, 300, 'Bobine', 3.2, 'LOT-HAS-2602'),
 ('d902-c2',1,'PP-6665',1120.0, 350, 'Bobine', 3.2, 'LOT-HAS-2602'),
 ('d902-c3',1,'PP-6665', 800.0, 250, 'Bobine', 3.2, 'LOT-HAS-2602');

-- -----------------------------------------------------------------------------
-- 2. VETO PHYSIQUE PAR LA QUARANTAINE  (PES-61043)
--
-- La marchandise existe, elle est comptee au bilan, et elle est INUTILISABLE.
-- Le calcul logique ne le voit pas : c'est tout l'objet de la couche physique.
-- Le transfert vers la zone de quarantaine passe par deux mouvements, comme
-- tout transfert (R10) : rien n'entre nulle part sans etre sorti d'ailleurs.
-- -----------------------------------------------------------------------------
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, reference_document, id_utilisateur)
VALUES
 ('d902-q1','MVT-2026-9004', strftime('%Y-%m-%dT09:00:00.000Z','now','-8 days'),
  'TRANSFERT_SORTIE','MP-01','TRANSFERT','Mise en quarantaine - suspicion de nuance',
  '00000000-0000-4000-a000-000000000014'),
 ('d902-q2','MVT-2026-9005', strftime('%Y-%m-%dT09:05:00.000Z','now','-8 days'),
  'TRANSFERT_ENTREE','ZON-QUA','TRANSFERT','Mise en quarantaine - suspicion de nuance',
  '00000000-0000-4000-a000-000000000014');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             prix_kg_mad, lot_fournisseur)
VALUES
 ('d902-q1',1,'PES-61043', 24000.0, NULL,  'LOT-GZM-2601'),
 ('d902-q2',1,'PES-61043', 24000.0, 24.70, 'LOT-GZM-2601');

-- -----------------------------------------------------------------------------
-- 3. COMMANDE EN RETARD  (PES-202)
--
-- Un bon envoye, dont la date de livraison est passee depuis longtemps. La
-- quantite sort du calcul de couverture : le retard REEL annule la prevision
-- au lieu de la prolonger.
-- -----------------------------------------------------------------------------
INSERT INTO bon_commande
    (id_bc, numero_bc, date_bc, code_fournisseur, code_devise, taux_change_engage,
     date_taux_engage, montant_total_devise, montant_total_mad, statut, motif_creation,
     date_envoi, date_livraison_prevue, id_utilisateur_creation,
     id_utilisateur_validation, date_validation)
VALUES
 ('d902-bc1','BC-2026-9001', strftime('%Y-%m-%dT09:00:00.000Z','now','-120 days'),
  'LOM','MAD',1.0, strftime('%Y-%m-%dT09:00:00.000Z','now','-120 days'),
  119700.00, 119700.00, 'ENVOYE','MANUEL',
  strftime('%Y-%m-%dT10:00:00.000Z','now','-118 days'),
  strftime('%Y-%m-%dT00:00:00.000Z','now','-32 days'),
  '00000000-0000-4000-a000-000000000012',
  '00000000-0000-4000-a000-000000000010',
  strftime('%Y-%m-%dT11:00:00.000Z','now','-119 days'));

INSERT INTO ligne_bc
    (id_ligne_bc, id_bc, ligne_numero, code_reference, designation, unite_commande,
     facteur_kg, quantite_commandee_unite, quantite_commandee_kg,
     prix_unitaire_devise, code_devise, date_livraison_prevue)
VALUES
 ('d902-lbc1','d902-bc1',1,'PES-202','PES-20/2 LOMAT','kg',
  1.0, 6000, 6000, 19.95,'MAD', strftime('%Y-%m-%dT00:00:00.000Z','now','-32 days'));

-- Sans consommation, la couverture de PES-202 se compte en milliers de jours et
-- le retard ne change rien de visible : le scenario ne demontrerait rien. On lui
-- donne donc une consommation reelle, puis une entree qui remet le magasin
-- au-dessus de son minimum — pour que la bascule vienne du RETARD, et de lui
-- seul, sans que le veto physique s'en mele.
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, numero_of, id_utilisateur)
VALUES
 ('d902-r1','MVT-2026-9009', strftime('%Y-%m-%dT08:00:00.000Z','now','-70 days'),
  'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-201','00000000-0000-4000-a000-000000000015'),
 ('d902-r2','MVT-2026-9010', strftime('%Y-%m-%dT08:00:00.000Z','now','-40 days'),
  'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-202','00000000-0000-4000-a000-000000000015'),
 ('d902-r3','MVT-2026-9011', strftime('%Y-%m-%dT08:00:00.000Z','now','-12 days'),
  'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-203','00000000-0000-4000-a000-000000000015');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             quantite_saisie, unite_saisie, facteur_conversion)
VALUES
 ('d902-r1',1,'PES-202', 1500.0, 1500, 'kg', 1.0),
 ('d902-r2',1,'PES-202', 1500.0, 1500, 'kg', 1.0),
 ('d902-r3',1,'PES-202', 1500.0, 1500, 'kg', 1.0);

INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, id_utilisateur)
VALUES
 ('d902-r4','MVT-2026-9012', strftime('%Y-%m-%dT10:00:00.000Z','now','-9 days'),
  'STOCK_INIT','MP-01','INIT','00000000-0000-4000-a000-000000000015');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             prix_kg_mad, quantite_saisie, unite_saisie, facteur_conversion)
VALUES ('d902-r4',1,'PES-202', 3500.0, 19.95, 3500, 'kg', 1.0);

-- -----------------------------------------------------------------------------
-- 4. MAGASIN SOUS SON MINIMUM  (BANDE-01)
--
-- Ni rupture, ni couverture courte : juste un magasin qui descend sous son
-- plancher. C'est le cas que l'ancienne echelle en jours ne nommait pas.
-- L'ajustement passe par un mouvement trace, jamais par une ecriture directe
-- dans le solde.
-- -----------------------------------------------------------------------------
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, numero_of, id_utilisateur)
VALUES
 ('d902-b1','MVT-2026-9006', strftime('%Y-%m-%dT14:00:00.000Z','now','-20 days'),
  'SORTIE_PROD','MP-01','PRODUCTION','OF-2026-104','00000000-0000-4000-a000-000000000015');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             quantite_saisie, unite_saisie, facteur_conversion)
VALUES ('d902-b1',1,'BANDE-01', 700.0, 700, 'kg', 1.0);

-- -----------------------------------------------------------------------------
-- 5. SUR-STOCK  (SBR-821)
--
-- Une entree massive, sans besoin en face : du capital immobilise. Ce n'est pas
-- une alerte de manque, c'est un second axe — et une reference peut porter les
-- deux a la fois.
-- -----------------------------------------------------------------------------
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, id_utilisateur)
VALUES
 ('d902-s1','MVT-2026-9007', strftime('%Y-%m-%dT10:00:00.000Z','now','-5 days'),
  'STOCK_INIT','MP-01','INIT','00000000-0000-4000-a000-000000000015');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             prix_kg_mad, quantite_saisie, unite_saisie, facteur_conversion)
VALUES ('d902-s1',1,'SBR-821', 40000.0, 11.40, 40000, 'kg', 1.0);

-- -----------------------------------------------------------------------------
-- 6. ECART MAJEUR  (PLAST-50)
--
-- Le magasin descend sous son minimum catalogue alors que la couverture reste
-- confortable. Ce n'est pas une alerte de stock, c'est une alerte de VERITE DES
-- DONNEES : une consommation, une casse ou une perte n'a pas ete declaree, et
-- cela se traite par un inventaire tournant, pas par un bon de commande.
-- -----------------------------------------------------------------------------
INSERT INTO mouvement (id_mouvement, numero_mouvement, date_mouvement, code_type_mvt,
                       code_magasin, code_motif, id_utilisateur)
VALUES
 ('d902-e1','MVT-2026-9008', strftime('%Y-%m-%dT16:00:00.000Z','now','-3 days'),
  'AJUST_INV_NEG','MP-01','INVENTAIRE','00000000-0000-4000-a000-000000000015');

INSERT INTO ligne_mouvement (id_mouvement, ligne_numero, code_reference, quantite_kg,
                             code_motif_ligne, quantite_saisie, unite_saisie, facteur_conversion)
VALUES ('d902-e1',1,'PLAST-50', 800.0, 'R4', 800, 'kg', 1.0);
