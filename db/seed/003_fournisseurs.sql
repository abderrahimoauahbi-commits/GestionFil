-- =============================================================================
-- SEED 3 : FOURNISSEURS  (12, donnees reelles CDC A4)
-- =============================================================================
-- delai_paiement_jours est extrait des conditions de paiement : il alimente le
-- DPO du cockpit (110 jours annonces en E9), que le CDC affichait sans aucune
-- source de donnees.
-- =============================================================================

PRAGMA foreign_keys = ON;

INSERT INTO fournisseur
    (code_fournisseur, nom, pays, code_devise, delai_livraison_jours,
     conditions_paiement, delai_paiement_jours, tolerance_pesee_pct, note_globale)
VALUES
    ('HAS', 'HASIRCI TEXTILE',  'Turquie', 'USD', 65, 'Open Account 180j', 180, 2.0, NULL),
    ('SOF', 'SOFIA TEXTILE',    'Turquie', 'USD', 60, 'Open Account 30j',   30, 2.0, NULL),
    ('GZM', 'GZM TEXTIL',       'Turquie', 'USD', 70, 'LC 120j',           120, 2.0, NULL),
    ('TAT', 'TAT TEXTIL',       'Turquie', 'USD', 65, 'LC 120j',           120, 2.0, NULL),
    ('OZK', 'OZKARALAR',        'Turquie', 'USD', 65, 'Open Account 120j', 120, 2.0, NULL),
    ('SUJ', 'SUJATA',           'Inde',    'USD', 90, 'LC 150j',           150, 2.0, NULL),
    ('TUR', 'TURKAN',           'Turquie', 'USD', 60, 'LC 120j',           120, 2.0, NULL),
    ('TEX', 'TEXTURE TEKSTIL',  'Turquie', 'USD', 70, 'LC 120j',           120, 2.0, NULL),
    ('LOM', 'LOMAT',            'Belgique','USD', 60, 'Open Account 120j', 120, 2.0, NULL),
    ('GLO', 'GLOBALTEX',        'Belgique','USD', 78, 'Open Account 120j', 120, 2.0, NULL),
    ('CHM', 'CHEMS PLASTIQUE',  'Maroc',   'MAD',  4, 'Apres 60j',          60, 2.0, NULL),
    ('EXP', 'EXTRA PLAST',      'Maroc',   'MAD',  6, 'Apres 60j',          60, 2.0, NULL);
