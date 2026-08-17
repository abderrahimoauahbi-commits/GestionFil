-- =============================================================================
-- SEED 901 : RECEPTION EN ATTENTE DE CONTROLE  (jeu de demonstration)
-- =============================================================================
-- /!\ DONNEES DE TEST /!\  Necessite 900_demo_sh.sql.
--
-- Prepare un bon de commande ENVOYE et sa reception A_CONTROLER, pour verifier
-- de bout en bout la cascade 3-en-1 via l'API :
--     POST /api/receptions/{id}/valider
--
-- Le BC est cree par l'acheteur et valide par la Direction (B4 regle 4).
-- La reception est pesee par le magasinier ; elle devra etre controlee par le
-- controleur qualite, qui n'est ni le peseur ni le createur du BC (B4 regle 2).
--
-- Conversion exercee (R01) : 1500 bobines x 3.2 kg = 4800 kg.
-- Prix : 10.24 USD/bobine -> 3.20 USD/kg -> x 9.5 = 30.40 MAD/kg.
--
-- CMUP attendu apres validation, pour PP-3430 au magasin MP-01 :
--     (11100 x 28.50 + 4800 x 30.40) / 15900
--   = (316350 + 145920) / 15900
--   = 462270 / 15900
--   = 29.0736 MAD/kg
-- =============================================================================

PRAGMA foreign_keys = ON;

INSERT INTO bon_commande
    (id_bc, numero_bc, date_bc, code_fournisseur, code_devise, taux_change_engage,
     date_taux_engage, montant_total_devise, montant_total_mad, statut, motif_creation,
     date_envoi, date_livraison_prevue, conditions_paiement,
     id_utilisateur_creation, id_utilisateur_validation, date_validation)
VALUES
    ('00000000-0000-4000-a000-0000000000d1', 'BC-2026-0001', '2026-05-02T09:00:00.000Z',
     'HAS', 'USD', 9.5000, '2026-05-02T09:00:00.000Z',
     15360.00, 145920.00, 'ENVOYE', 'MRP',
     '2026-05-02T14:00:00.000Z', strftime('%Y-%m-%dT00:00:00.000Z','now','+25 days'), 'Open Account 180j',
     '00000000-0000-4000-a000-000000000012',   -- cree par l'acheteur
     '00000000-0000-4000-a000-000000000010',   -- valide par la Direction
     '2026-05-02T11:00:00.000Z');

INSERT INTO ligne_bc
    (id_ligne_bc, id_bc, ligne_numero, code_reference, designation,
     unite_commande, facteur_kg, quantite_commandee_unite, quantite_commandee_kg,
     prix_unitaire_devise, code_devise, date_livraison_prevue)
VALUES
    ('00000000-0000-4000-a000-0000000000d2', '00000000-0000-4000-a000-0000000000d1', 1,
     'PP-3430', 'PP-1500 Dtex-Yellow 3430-Hs',
     'Bobine', 3.2, 1500, 4800,
     10.24, 'USD', strftime('%Y-%m-%dT00:00:00.000Z','now','+25 days'));

-- Reception pesee par le magasinier, en attente de controle qualite.
INSERT INTO reception
    (id_reception, numero_reception, date_reception, id_bc, code_fournisseur,
     transporteur, num_bon_livraison, nombre_colis, statut, id_utilisateur_reception)
VALUES
    ('00000000-0000-4000-a000-0000000000e1', 'REC-2026-0001', '2026-07-08T08:30:00.000Z',
     '00000000-0000-4000-a000-0000000000d1', 'HAS',
     'Transit Maroc', 'BL-HAS-88214', 7, 'A_CONTROLER',
     '00000000-0000-4000-a000-000000000015');

INSERT INTO ligne_reception
    (id_ligne_reception, id_reception, id_ligne_bc, ligne_numero, code_reference, designation,
     unite_saisie, facteur_kg, quantite_pesee_unite, quantite_stock_kg, quantite_commandee_kg,
     prix_kg_devise, code_devise, taux_change, prix_kg_mad,
     lot_fournisseur, date_fabrication, statut_qualite, code_magasin_dest)
VALUES
    ('00000000-0000-4000-a000-0000000000e2', '00000000-0000-4000-a000-0000000000e1',
     '00000000-0000-4000-a000-0000000000d2', 1, 'PP-3430', 'PP-1500 Dtex-Yellow 3430-Hs',
     'Bobine', 3.2, 1500, 4800, 4800,
     3.20, 'USD', 9.5000, 30.40,
     'LOT-HAS-2603', '2026-04-15', 'CONFORME', 'MP-01');
