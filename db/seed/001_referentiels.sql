-- =============================================================================
-- SEED 1 : REFERENTIELS
-- Donnees reelles issues du CDC partie A4.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Entreprise
-- -----------------------------------------------------------------------------
INSERT INTO entreprise (id_entreprise, nom, devise_base) VALUES
    ('00000000-0000-4000-a000-000000000001', 'Polyfashions Carpet Morocco', 'MAD');

-- -----------------------------------------------------------------------------
-- Devises  (MAD = pivot, CDC A1)
-- -----------------------------------------------------------------------------
INSERT INTO devise (code_devise, libelle, symbole, est_pivot) VALUES
    ('MAD', 'Dirham marocain',  'DH',  1),
    ('EUR', 'Euro',             'EUR', 0),
    ('USD', 'Dollar americain', 'USD', 0);

-- Taux de change : SOURCE DE VERITE UNIQUE (les parametres P_TauxEURMAD /
-- P_TauxUSDMAD du CDC A4 sont supprimes, cf. ADR-001 D-07).
INSERT INTO taux_change (code_devise, taux, date_debut, source) VALUES
    ('MAD', 1.0000, '2026-01-01T00:00:00.000Z', 'Devise pivot'),
    ('EUR', 11.0000,'2026-01-01T00:00:00.000Z', 'CDC A4'),
    ('USD', 9.5000, '2026-01-01T00:00:00.000Z', 'CDC A4');

-- -----------------------------------------------------------------------------
-- Roles BOM  (8, CDC E1)
-- -----------------------------------------------------------------------------
INSERT INTO role_bom (code_role, libelle, description, ordre_affichage) VALUES
    ('POIL',  'Poil',      'Fil de surface, determine l''aspect et le toucher', 10),
    ('TRAME', 'Trame',     'Fil transversal du tissage',                        20),
    ('CHAINE','Chaine',    'Fil longitudinal du tissage',                       30),
    ('COLLE', 'Colle',     'Liant d''envers (latex, SBR, hotmelt)',             40),
    ('CUIR',  'Cuir',      'Simili cuir de finition (exprime en ml/m2)',        50),
    ('FRANGE','Franges',   'Franges decoratives',                               60),
    ('PLAST', 'Plastique', 'Composants plastiques',                             70),
    ('RUBAN', 'Ruban',     'Bande de bordure (exprimee en ml/m2)',              80);

-- -----------------------------------------------------------------------------
-- Categories matiere  (15, CDC E1)
-- -----------------------------------------------------------------------------
-- code_role_defaut : releve de l'usage reel constate dans GESTION Fil.xlsx.
-- Les categories qu'aucune recette n'emploie encore (acrylique, coton, soie,
-- viscose) sont rattachees au Poil, leur destination naturelle ; le latex a la
-- Colle, comme le SBR. Ces valeurs se corrigent depuis l'ecran Referentiels.
INSERT INTO categorie_matiere (code_categorie, libelle, code_role_defaut, ordre_affichage) VALUES
    ('ACR',    'Acrylique',             'POIL',    10),
    ('COT',    'Coton',                 'POIL',    20),
    ('JUT',    'Jute',                  'TRAME',   30),
    ('LAI',    'Laine',                 'RUBAN',   40),
    ('LAT',    'Latex',                 'COLLE',   50),
    ('PLA',    'Plastique',             'PLAST',   60),
    ('PES',    'Polyester',             'POIL',    70),
    ('PES-CH', 'Polyester Chaine',      'CHAINE',  80),
    ('PES-PO', 'Polyester Fil Poil',    'POIL',    90),
    ('PES-SH', 'Polyester Fil Shrink',  'POIL',   100),
    ('PP',     'Polypropylene',         'POIL',   110),
    ('SBR',    'SBR',                   'COLLE',  120),
    ('CUI',    'Simili Cuir',           'CUIR',   130),
    ('SOI',    'Soie',                  'POIL',   140),
    ('VIS',    'Viscose',               'POIL',   150);

-- -----------------------------------------------------------------------------
-- Magasins
-- ZON-QUA est exclue du MRP : c'est l'usage prevu par le CDC E1 pour le flag
-- inclure_mrp, qu'aucune vue du CDC n'exploitait.
-- -----------------------------------------------------------------------------
INSERT INTO magasin (code_magasin, nom, type, inclure_mrp, est_quarantaine) VALUES
    ('MP-01',   'Magasin Matieres Premieres', 'PRINCIPAL',   1, 0),
    ('MP-02',   'Magasin Secondaire',         'SECONDAIRE',  1, 0),
    ('ATELIER', 'En-cours Atelier',           'PRODUCTION',  1, 0),
    ('ZON-QUA', 'Zone Quarantaine',           'QUARANTAINE', 0, 1);

-- -----------------------------------------------------------------------------
-- Types de mouvement  (CDC E7)
-- AJUST_INV "+/-1" du CDC est scinde : un signe unique par type (cf. 001_schema).
-- TRANSFERT_ENTREE est valorise afin que la valeur suive la marchandise d'un
-- magasin a l'autre (le CDC l'inserait sans prix, ce qui laissait le stock
-- destinataire non valorise).
-- -----------------------------------------------------------------------------
INSERT INTO type_mouvement (code_type_mvt, libelle, signe, exige_prix, impacte_cmup, exige_of, exige_motif_ligne, couleur) VALUES
    ('STOCK_INIT',       'Initialisation de stock',  1, 1, 1, 0, 0, '#6366f1'),
    ('ENTREE_REC',       'Entree sur reception',     1, 1, 1, 0, 0, '#10b981'),
    ('RETOUR_PROD',      'Retour de production',     1, 0, 0, 0, 1, '#14b8a6'),
    ('TRANSFERT_ENTREE', 'Transfert - entree',       1, 1, 1, 0, 0, '#0ea5e9'),
    ('AJUST_INV_POS',    'Ajustement inventaire +',  1, 0, 0, 0, 1, '#a855f7'),
    ('SORTIE_PROD',      'Sortie production',       -1, 0, 0, 1, 0, '#f59e0b'),
    ('RETOUR_FOURN',     'Retour fournisseur',      -1, 0, 0, 0, 1, '#ef4444'),
    ('TRANSFERT_SORTIE', 'Transfert - sortie',      -1, 0, 0, 0, 0, '#0ea5e9'),
    ('AJUST_INV_NEG',    'Ajustement inventaire -', -1, 0, 0, 0, 1, '#a855f7');

-- -----------------------------------------------------------------------------
-- Motifs de mouvement
-- Le CDC referencait 'TRANSFERT', 'RECEPTION' et 'INVENTAIRE' dans ses triggers
-- sans jamais les definir : les cles etrangeres auraient echoue a l'execution.
-- -----------------------------------------------------------------------------
INSERT INTO motif_mouvement (code_motif, libelle, categorie, signe_default) VALUES
    ('INIT',        'Stock initial',          'INITIALISATION',  1),
    ('RECEPTION',   'Reception fournisseur',  'ACHAT',           1),
    ('PRODUCTION',  'Consommation production','PRODUCTION',     -1),
    ('RETOUR_FOUR', 'Retour au fournisseur',  'ACHAT',          -1),
    ('RETOUR_PROD', 'Retour depuis atelier',  'PRODUCTION',      1),
    ('INVENTAIRE',  'Ajustement d''inventaire','INVENTAIRE',     1),
    ('TRANSFERT',   'Transfert inter-magasin','LOGISTIQUE',      1);

-- -----------------------------------------------------------------------------
-- Motifs de ligne  (R1-R6, CDC C08)
-- -----------------------------------------------------------------------------
INSERT INTO motif_ligne (code_motif_ligne, libelle, categorie) VALUES
    ('R1', 'Defaut qualite matiere',        'RETOUR'),
    ('R2', 'Erreur de reference',           'RETOUR'),
    ('R3', 'Excedent de production',        'RETOUR'),
    ('R4', 'Rebut / chute non reutilisable','RETOUR'),
    ('R5', 'Erreur de saisie',              'CORRECTION'),
    ('R6', 'Ecart d''inventaire',           'INVENTAIRE');

-- -----------------------------------------------------------------------------
-- Parametres systeme  (CDC A4)
-- P_TauxEURMAD / P_TauxUSDMAD retires : doublon de la table taux_change.
-- P_CouvMinMois ajoute : le CDC l'utilise en B3 ("P_CouvMin = 2.0 mois") et en
-- F3 sans jamais le lister dans les 27 parametres de A4.
-- P_SeuilDormant : A4 dit 180 jours, E9 dit 60. Valeur retenue : 180 (A4 fait
-- foi comme table des parametres). Cf. ADR-001 D-08.
-- -----------------------------------------------------------------------------
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, categorie, modifiable_par, verrouille) VALUES
    ('P_SeuilAlerte',      'Seuil d''alerte (statut ATTENTION)',        '90',    'ENTIER',  'jours', 'STOCK',   'DIRECTION', 0),
    ('P_SeuilCritique',    'Seuil critique (statut CRITIQUE)',          '60',    'ENTIER',  'jours', 'STOCK',   'DIRECTION', 0),
    -- ---- ALERTE A DOUBLE DECLENCHEUR ------------------------------------------
    -- Les deux seuils ci-dessous ne raisonnent pas : ils regardent ce qu'il y a
    -- dans les allees. Le plus exigeant des deux fait plancher. Ils existent
    -- parce qu'une couverture de 90 jours peut coexister avec un magasin vide :
    -- camion bloque en douane, lot en quarantaine, consommation exceptionnelle
    -- que le MRP n'a pas encore integree.

    -- Passe ce retard, la quantite commandee sort du calcul de couverture : un
    -- camion qu'on n'attend plus ne doit pas continuer a rassurer.
    ('P_RetardBCJours',    'Retard au-dela duquel une commande ne compte plus', '5', 'ENTIER', 'jours', 'ACHAT', 'DIRECTION', 0),
    -- Au-dela de cette couverture annoncee, un stock physique sous le minimum
    -- ne s'explique plus par la planification : c'est un ecart de donnees.
    ('P_EcartCouvertureJours','Couverture au-dela de laquelle un stock bas est un ecart','60','ENTIER','jours','STOCK','DIRECTION', 0),
    ('P_DelaiDefaut',      'Delai fournisseur par defaut',              '60',    'ENTIER',  'jours', 'ACHAT',   'DIRECTION', 0),
    ('P_MargeSecurite',    'Marge de securite sur couverture',          '20',    'DECIMAL', '%',     'STOCK',   'DIRECTION', 0),
    ('P_MargeJours',       'Marge en jours sur date de besoin',         '30',    'ENTIER',  'jours', 'ACHAT',   'DIRECTION', 0),
    ('P_CouvMinMois',      'Couverture minimale cible',                 '2.0',   'DECIMAL', 'mois',  'STOCK',   'DIRECTION', 0),
    ('P_TauxPerte',        'Taux de perte production',                  '2',     'DECIMAL', '%',     'PROD',    'DIRECTION', 0),
    ('P_ToleranceRecette', 'Tolerance sur la somme des % d''une recette','0.5',   'DECIMAL', '%',     'PROD',    'DIRECTION', 0),
    ('P_SecuriteA',        'Stock de securite classe A',                '30',    'ENTIER',  'jours', 'STOCK',   'DIRECTION', 0),
    ('P_SecuriteB',        'Stock de securite classe B',                '30',    'ENTIER',  'jours', 'STOCK',   'DIRECTION', 0),
    ('P_SecuriteC',        'Stock de securite classe C',                '30',    'ENTIER',  'jours', 'STOCK',   'DIRECTION', 0),
    ('P_DateSaisie',       'Date de la photo de stock initial (figee)', '2026-04-27', 'DATE', NULL,  'SYSTEME', 'AUCUN',     1),
    ('P_Devise',           'Devise pivot',                              'MAD',   'TEXTE',   NULL,    'SYSTEME', 'AUCUN',     1),
    ('P_TolerInFull',      'Tolerance In-Full',                         '2',     'DECIMAL', '%',     'ACHAT',   'DIRECTION', 0),
    ('P_CibleOTIF',        'Cible OTIF fournisseurs',                   '95',    'DECIMAL', '%',     'ACHAT',   'DIRECTION', 0),
    ('P_SeuilABCA',        'Seuil cumul classe A',                      '80',    'DECIMAL', '%',     'ANALYSE', 'DAF',       0),
    ('P_SeuilABCB',        'Seuil cumul classe B',                      '95',    'DECIMAL', '%',     'ANALYSE', 'DAF',       0),
    ('P_SeuilXYZ_X',       'Seuil CV classe X',                         '0.25',  'DECIMAL', 'ratio', 'ANALYSE', 'DAF',       0),
    ('P_SeuilXYZ_Y',       'Seuil CV classe Y',                         '0.50',  'DECIMAL', 'ratio', 'ANALYSE', 'DAF',       0),
    ('P_SeuilTier1',       'Seuil montant TIER 1',                      '300000','DECIMAL', 'MAD',   'ACHAT',   'DIRECTION', 0),
    ('P_SeuilTier2',       'Seuil montant TIER 2',                      '200000','DECIMAL', 'MAD',   'ACHAT',   'DIRECTION', 0),
    ('P_SeuilTier3',       'Seuil montant TIER 3',                      '100000','DECIMAL', 'MAD',   'ACHAT',   'DIRECTION', 0),
    ('P_ScoreStrategique', 'Score fournisseur STRATEGIQUE',             '85',    'DECIMAL', '/100',  'ACHAT',   'DIRECTION', 0),
    ('P_ScoreStandard',    'Score fournisseur STANDARD',                '65',    'DECIMAL', '/100',  'ACHAT',   'DIRECTION', 0),
    ('P_ScoreSurveiller',  'Score fournisseur A SURVEILLER',            '45',    'DECIMAL', '/100',  'ACHAT',   'DIRECTION', 0),
    ('P_TolerEcartPesee',  'Tolerance ecart de pesee en reception',     '2',     'DECIMAL', '%',     'RECEPT',  'DIRECTION', 0),
    ('P_SeuilDormant',     'Seuil de stock dormant',                    '180',   'ENTIER',  'jours', 'STOCK',   'DIRECTION', 0),
    ('P_SeuilValidationBC','Montant BC exigeant validation Direction',  '300000','DECIMAL', 'MAD',   'ACHAT',   'DIRECTION', 0);

-- -----------------------------------------------------------------------------
-- Machine a etats  (CDC partie G)
-- AUCUNE transition arriere depuis VALIDE / CLOTURE : c'est ce qui empechait,
-- dans le CDC, de rejouer une cascade de reception et de compter le stock deux fois.
-- -----------------------------------------------------------------------------
INSERT INTO transition_statut (entite, statut_source, statut_cible, role_requis, description) VALUES
    -- G7 Qualite : une qualite = une composition. Pas de versionnement — si la
    -- composition change, on cree une nouvelle qualite (SH1, SH2, SH3...).
    ('qualite','BROUILLON','ACTIF',    'DIRECTION','Mise en service : controle R07 et densites'),
    ('qualite','ACTIF',    'BROUILLON','PLANIF',   'Retour en redaction'),
    ('qualite','BROUILLON','CLOTURE',  'PLANIF',   'Abandon avant mise en service'),
    ('qualite','ACTIF',    'CLOTURE',  'DIRECTION','Retrait du catalogue'),
    ('qualite','CLOTURE',  'BROUILLON','DIRECTION','Reouverture pour correction'),

    -- G1 Plan de production
    ('plan_production','BROUILLON', 'SIMULATION','PLANIF',   'Test d''impact MRP'),
    ('plan_production','SIMULATION','BROUILLON', 'PLANIF',   'Retour en redaction'),
    ('plan_production','SIMULATION','EN_COURS',  'DIRECTION','Mise en service : alimente le MRP (R08)'),
    ('plan_production','EN_COURS',  'CLOTURE',   'DIRECTION','Fin de periode, archivage'),
    -- La cloture libere les recettes du plan : elles redeviennent disponibles
    -- pour un plan suivant.
    ('plan_production','BROUILLON', 'CLOTURE',   'PLANIF',   'Abandon avant simulation'),
    ('plan_production','SIMULATION','CLOTURE',   'PLANIF',   'Abandon du scenario'),

    -- G2 Bon de commande
    ('bon_commande','BROUILLON',            'EN_ATTENTE_VALIDATION','ACHAT',    'Soumission a validation'),
    ('bon_commande','BROUILLON',            'ANNULE',               'ACHAT',    'Abandon'),
    ('bon_commande','EN_ATTENTE_VALIDATION','BROUILLON',            'ACHAT',    'Renvoi pour correction'),
    ('bon_commande','EN_ATTENTE_VALIDATION','VALIDE',               'DIRECTION','Validation (createur <> valideur)'),
    ('bon_commande','EN_ATTENTE_VALIDATION','ANNULE',               'DIRECTION','Refus'),
    ('bon_commande','VALIDE',               'ENVOYE',               'ACHAT',    'Envoi au fournisseur'),
    ('bon_commande','VALIDE',               'ANNULE',               'DIRECTION','Annulation avant envoi'),
    ('bon_commande','ENVOYE',               'LIVRE_PARTIEL',        'MAGASIN',  'Premiere reception'),
    ('bon_commande','ENVOYE',               'CLOTURE',              'ACHAT',    'Reception complete en une fois'),
    ('bon_commande','LIVRE_PARTIEL',        'CLOTURE',              'ACHAT',    'Derniere reception'),

    -- G3 Reception
    ('reception','BROUILLON',  'A_CONTROLER','MAGASIN', 'Pesees saisies, en attente de controle qualite'),
    ('reception','BROUILLON',  'ANNULE',     'MAGASIN', 'Abandon avant controle'),
    ('reception','A_CONTROLER','BROUILLON',  'QUALITE', 'Renvoi pour correction des pesees'),
    ('reception','A_CONTROLER','VALIDE',     'QUALITE', 'Controle qualite OK : declenche la cascade 3-en-1'),
    ('reception','A_CONTROLER','ANNULE',     'QUALITE', 'Refus total de la livraison'),
    ('reception','VALIDE',     'CLOTURE',    'MAGASIN', 'Cloture administrative'),

    -- G5 Transfert
    ('transfert','BROUILLON','VALIDE', 'MAGASIN','Depart de marchandise'),
    ('transfert','BROUILLON','ANNULE', 'MAGASIN','Abandon'),
    ('transfert','VALIDE',   'TERMINE','MAGASIN','Confirmation de reception a destination'),

    -- G6 Inventaire
    ('inventaire','BROUILLON','EN_COURS','MAGASIN',  'Photo du stock theorique'),
    ('inventaire','BROUILLON','ANNULE',  'MAGASIN',  'Abandon'),
    ('inventaire','EN_COURS', 'CLOTURE', 'DIRECTION','Cloture : genere les ajustements'),
    ('inventaire','EN_COURS', 'ANNULE',  'DIRECTION','Abandon du comptage');


-- Parametres cites dans la structure demandee et absents de la base.
--
-- Les valeurs sont posees a partir de ce que l'ERP sait deja de l'entreprise
-- (fabrication de tapis mecaniques, Maroc, MAD) ou de ce que la structure
-- indiquait. Elles restent modifiables : c'est un point de depart, pas une
-- verite figee.
INSERT OR IGNORE INTO parametre
    (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
     categorie, modifiable_par, verrouille)
VALUES
-- ---- Identite de l'entreprise --------------------------------------------
 ('P_NomEntreprise',   'Nom de l''entreprise',        'Polyfashions Carpet Morocco', 'TEXTE', NULL,
  'Figure sur les etats d''impression et les bons de commande.', 'ENTREPRISE', 'DIRECTION', 0),
 ('P_Secteur',         'Secteur d''activite',         'Fabrication de tapis mecaniques', 'TEXTE', NULL,
  'Contexte metier, sans effet sur les calculs.', 'ENTREPRISE', 'DIRECTION', 0),
 ('P_Pays',            'Pays',                        'Maroc', 'TEXTE', NULL,
  'Pays du siege : sert de reference pour distinguer achats locaux et imports.',
  'ENTREPRISE', 'DIRECTION', 0),
 ('P_DateCreationERP', 'Date de mise en service',     '2026-04-18', 'DATE', NULL,
  'Debut de l''historique exploitable : avant cette date, les donnees viennent de la reprise.',
  'ENTREPRISE', 'DIRECTION', 0),

-- ---- Supply chain ---------------------------------------------------------
 ('P_DSODefaut',       'Delai de paiement par defaut', '60', 'ENTIER', 'jours',
  'Applique quand le fournisseur n''en declare aucun. Sert au previsionnel de tresorerie.',
  'ACHAT', 'DAF', 0),
 ('P_SeuilBCGroupe',   'Seuil de regroupement des commandes', '100000', 'ENTIER', 'MAD',
  'En dessous, il est preferable de regrouper avec une autre commande du meme fournisseur '
  || 'plutot que d''emettre un bon isole.', 'ACHAT', 'DIRECTION', 0),
 ('P_DateRefKPI',      'Date de reference des indicateurs', '2026-07-18', 'DATE', NULL,
  'Point de depart des cumuls et des comparaisons annuelles.', 'ANALYSE', 'DAF', 0);

SELECT categorie, COUNT(*) AS nb FROM parametre GROUP BY categorie ORDER BY categorie;
