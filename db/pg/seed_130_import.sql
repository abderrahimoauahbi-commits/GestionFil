-- =============================================================================
-- seed_130 — DOSSIERS D'IMPORTATION : catalogue des frais, droits, champs
-- =============================================================================

-- Les colonnes de frais du classeur IMPORTATION 2026, une par une. La TVA est
-- saisie comme les autres (le dossier doit balancer avec les pieces) mais elle
-- est recuperable : elle n'entre jamais dans le cout de revient.
-- La PIECE JUSTIFICATIVE de chaque type : c'est elle que l'assistante cherche
-- dans le dossier, et c'est par elle que la saisie assistee reconnaitra un
-- document depose. « Recuperable » ne concerne aujourd'hui que la TVA.
INSERT INTO parametres_frais (id_frais, libelle, categorie, piece_justificative,
                              recuperable, commun, methode_repartition, inclus_dans_cout, ordre) VALUES
    ('DOUANE',    'Droits de douane (D.D.)',      'DOUANE',    'Quittance de la douane',            0, 1, 'VALEUR', 1, 10),
    ('TVA',       'TVA a l''importation',         'TAXE',      'Quittance de la douane',            1, 1, 'VALEUR', 0, 20),
    ('PORT_MED',  'Port Tanger Med',              'PORT',      'Facture du port',                   0, 1, 'VALEUR', 1, 30),
    ('FRET',      'Fret',                         'TRANSPORT', 'Facture du transporteur maritime',  0, 1, 'VALEUR', 1, 40),
    ('TREMSA',    'Transitaire (TREMSA / WIDEM)', 'TRANSIT',   'Facture du transitaire',            0, 1, 'VALEUR', 1, 50),
    ('TIMBRE',    'Timbre',                       'TAXE',      'Timbre fiscal',                     0, 1, 'VALEUR', 1, 60),
    ('INT_OC',    'INT/OC',                       'TRANSIT',   'Facture du transitaire',            0, 1, 'VALEUR', 1, 70),
    ('TMSA',      'TMSA',                         'PORT',      'Facture TMSA',                      0, 1, 'VALEUR', 1, 80),
    ('TRANSPORT', 'Transport local',              'TRANSPORT', 'Facture du transporteur routier',   0, 1, 'VALEUR', 1, 90),
    ('AUTRE',     'Autre frais',                  'AUTRE',     NULL,                                0, 0, 'VALEUR', 1, 99)
ON CONFLICT (id_frais) DO UPDATE SET
    piece_justificative = excluded.piece_justificative,
    recuperable = excluded.recuperable, commun = excluded.commun,
    methode_repartition = excluded.methode_repartition;

-- Le module IMPORT. Saisir un dossier : direction, administration, assistante.
-- CLOTURER — donc changer le CUMP — : direction et administration seulement.
-- La reception physique passe, elle, par le module RECEPTIONS, comme toute
-- reception : le magasinier y a deja ses droits.
INSERT INTO permission (code_role_user, module, action)
SELECT r.code_role_user, 'IMPORT', a.action
  FROM role_utilisateur r
  CROSS JOIN (VALUES ('LIRE'), ('ECRIRE'), ('VALIDER')) AS a(action)
 WHERE (r.code_role_user IN ('ADMIN', 'DIRECTION'))
    OR (r.code_role_user = 'ASSISTANTE' AND a.action IN ('LIRE', 'ECRIRE'))
ON CONFLICT (code_role_user, module, action) DO NOTHING;

-- LES COLONNES DE LA LISTE DOIVENT ETRE DECLAREES : l'interface masque tout
-- champ absent de la grille, et la liste des dossiers n'afficherait qu'une
-- colonne. Elles se lisent avec le module.
--
-- Le cout de revient, lui, est une VALORISATION : masque a qui n'a pas ce
-- module. Les prix d'achat restent lisibles — l'assistante les saisit.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('IMPORT', 'numero',                    'Numero du dossier',             'LECTURE', 0, 2000),
 ('IMPORT', 'statut',                    'Statut',                        'LECTURE', 0, 2005),
 ('IMPORT', 'fournisseurs',              'Fournisseurs',                  'LECTURE', 0, 2010),
 ('IMPORT', 'nb_factures',               'Nombre de factures',            'LECTURE', 0, 2015),
 ('IMPORT', 'date_arrivee',              'Date d''arrivee',               'LECTURE', 0, 2020),
 ('IMPORT', 'valeur_dhs',                'Valeur d''achat (DH)',          'LECTURE', 0, 2025),
 ('IMPORT', 'frais_dhs',                 'Frais inclus (DH)',             'LECTURE', 0, 2030),
 ('IMPORT', 'tva_dhs',                   'Frais hors cout (DH)',          'LECTURE', 0, 2035),
 ('IMPORT', 'poids_kg',                  'Poids facture (kg)',            'LECTURE', 0, 2040),
 ('IMPORT', 'recu_kg',                   'Poids recu (kg)',               'LECTURE', 0, 2045),
 ('IMPORT', 'nb_palettes',               'Palettes',                      'LECTURE', 0, 2050),
 ('IMPORT', 'nb_bobines',                'Bobines',                       'LECTURE', 0, 2055),
 ('IMPORT', 'frais_alloues_dhs',         'Frais alloues (DH)',            'LECTURE', 1, 2100),
 ('IMPORT', 'montant_alloue_dhs',        'Part de frais (DH)',            'LECTURE', 1, 2110),
 ('IMPORT', 'cout_revient_dhs',          'Cout de revient (DH)',          'LECTURE', 1, 2120),
 ('IMPORT', 'cout_revient_unitaire_dhs', 'Cout de revient unitaire (DH)', 'LECTURE', 1, 2130),
 ('IMPORT', 'cout_revient_kg_dhs',       'Cout de revient au kg (DH)',    'LECTURE', 1, 2140),
 ('IMPORT', 'coef_frais_pct',            'Frais en % de la valeur',       'LECTURE', 1, 2150),
 ('IMPORT', 'cump_avant',                'CUMP avant cloture',            'LECTURE', 1, 2160),
 ('IMPORT', 'cump_apres',                'CUMP apres cloture',            'LECTURE', 1, 2170)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
           WHEN c.sensible = 1 AND NOT EXISTS (
                SELECT 1 FROM permission p
                 WHERE p.code_role_user = r.code_role_user
                   AND p.module = 'VALORISATION' AND p.action = 'LIRE') THEN 'MASQUE'
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = 'IMPORT' AND p.action = 'LIRE') THEN 'LECTURE'
           ELSE 'MASQUE'
       END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'IMPORT' AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'IMPORT'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- L'ECRAN « TYPES DE FRAIS » (Referentiels) se lit et se modifie avec le module
-- PARAMETRES. Ses colonnes doivent y etre declarees, sinon elles disparaissent.
-- `libelle` et `categorie` y sont deja.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('PARAMETRES', 'id_frais',            'Code du frais',         'ECRITURE', 0, 900),
 ('PARAMETRES', 'piece_justificative', 'Piece justificative',   'ECRITURE', 0, 905),
 ('PARAMETRES', 'recuperable',         'Recuperable',           'ECRITURE', 0, 910),
 ('PARAMETRES', 'commun',              'Commun au dossier',     'ECRITURE', 0, 915),
 ('PARAMETRES', 'inclus_dans_cout',    'Entre dans le cout',    'ECRITURE', 0, 920),
 ('PARAMETRES', 'methode_repartition', 'Methode de repartition','ECRITURE', 0, 925),
 ('PARAMETRES', 'ordre',               'Ordre d''affichage',    'ECRITURE', 0, 930),
 ('PARAMETRES', 'actif',               'Actif',                 'ECRITURE', 0, 935),
 ('PARAMETRES', 'nb_utilisations',     'Dossiers concernes',    'LECTURE',  0, 940)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN c.niveau_defaut = 'ECRITURE' AND EXISTS (
                 SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                  AND p.module = 'PARAMETRES' AND p.action = 'ECRIRE') THEN 'ECRITURE'
            WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                          AND p.module = 'PARAMETRES' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'PARAMETRES' AND c.ordre BETWEEN 900 AND 940 AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'PARAMETRES' AND c.ordre BETWEEN 900 AND 940
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- LA LISTE DES RECEPTIONS D'IMPORT se lit avec le module RECEPTIONS. Elle
-- reprend les champs deja declares (numero_reception, date_reception, statut,
-- nb_lignes, fournisseur_nom, numero_facture — ce dernier masque au magasin) ;
-- ceux-ci sont les siens, des totaux en lecture seule.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('RECEPTIONS', 'dossiers',    'Dossiers d''import',  'LECTURE', 0, 800),
 ('RECEPTIONS', 'quantite_kg', 'Poids recu (kg)',     'LECTURE', 0, 805),
 ('RECEPTIONS', 'ecart_kg',    'Ecart (kg)',          'LECTURE', 0, 810),
 ('RECEPTIONS', 'nb_bobines',  'Bobines',             'LECTURE', 0, 815),
 ('RECEPTIONS', 'nb_palettes', 'Palettes',            'LECTURE', 0, 820)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN EXISTS (SELECT 1 FROM permission p
                          WHERE p.code_role_user = r.code_role_user
                            AND p.module = 'RECEPTIONS' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'RECEPTIONS' AND c.champ IN ('dossiers', 'quantite_kg', 'ecart_kg', 'nb_bobines', 'nb_palettes')
   AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'RECEPTIONS' AND m.champ IN ('dossiers', 'quantite_kg', 'ecart_kg', 'nb_bobines', 'nb_palettes')
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;
