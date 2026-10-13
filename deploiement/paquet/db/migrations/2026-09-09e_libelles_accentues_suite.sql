-- =============================================================================
-- Les mots que la premiere passe ne connaissait pas — 9 septembre 2026
-- -----------------------------------------------------------------------------
-- Ma table de correspondance portait les noms communs de l'ERP mais pas les
-- PARTICIPES PASSES ni quelques mots courants : « Categorie matiere » restait
-- « matiere », « Quantite achetee » restait « achetee ». On les ajoute.
--
-- `entree` et `sortie` sont ABSENTS A DESSEIN : « entree » s'ecrit « entrée »
-- mais « sortie » n'a pas d'accent, et les traiter ensemble invite a se tromper.
-- « cree » l'est aussi : « créé » ou « crée » selon ce qui precede, et aucune
-- regle mecanique ne le decide.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE accent_suite (faux text PRIMARY KEY, juste text NOT NULL)
  ON COMMIT DROP;

INSERT INTO accent_suite (faux, juste) VALUES
  ('recommandee', 'recommandée'), ('Recommandee', 'Recommandée'),
  ('transportee', 'transportée'), ('Transportee', 'Transportée'),
  ('consommee',   'consommée'),   ('Consommee',   'Consommée'),
  ('commandee',   'commandée'),   ('Commandee',   'Commandée'),
  ('commandees',  'commandées'),  ('Commandees',  'Commandées'),
  ('calculee',    'calculée'),    ('Calculee',    'Calculée'),
  ('cloturee',    'cloturée'),    ('Cloturee',    'Cloturée'),
  ('acceptee',    'acceptée'),    ('Acceptee',    'Acceptée'),
  ('arbitree',    'arbitrée'),    ('Arbitree',    'Arbitrée'),
  ('modifiee',    'modifiée'),    ('Modifiee',    'Modifiée'),
  ('protegee',    'protégée'),    ('Protegee',    'Protégée'),
  ('suggeree',    'suggérée'),    ('Suggeree',    'Suggérée'),
  ('achetee',     'achetée'),     ('Achetee',     'Achetée'),
  ('achetees',    'achetées'),    ('Achetees',    'Achetées'),
  ('matiere',     'matière'),     ('Matiere',     'Matière'),
  ('matieres',    'matières'),    ('Matieres',    'Matières'),
  ('recue',       'reçue'),       ('Recue',       'Reçue'),
  ('recues',      'reçues'),      ('Recues',      'Reçues'),
  ('recu',        'reçu'),        ('Recu',        'Reçu'),
  ('pesee',       'pesée'),       ('Pesee',       'Pesée'),
  ('creee',       'créée'),       ('Creee',       'Créée'),
  ('premiere',    'première'),    ('Premiere',    'Première'),
  ('fournie',     'fournie'),     ('Reglee',      'Réglée');

CREATE OR REPLACE FUNCTION f_accentuer_suite(t text) RETURNS text AS $$
DECLARE m record;
BEGIN
    IF t IS NULL THEN RETURN NULL; END IF;
    FOR m IN SELECT faux, juste FROM accent_suite ORDER BY length(faux) DESC LOOP
        t := regexp_replace(t, '\y' || m.faux || '\y', m.juste, 'g');
    END LOOP;
    RETURN t;
END;
$$ LANGUAGE plpgsql;

UPDATE champ_configurable SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;
UPDATE categorie_matiere  SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;
UPDATE categorie_matiere  SET description = f_accentuer_suite(description) WHERE description IS NOT NULL;
UPDATE motif_ligne        SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;
UPDATE motif_mouvement    SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;
UPDATE type_mouvement     SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;
UPDATE parametre          SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;
UPDATE parametre          SET description = f_accentuer_suite(description) WHERE description IS NOT NULL;
UPDATE role_utilisateur   SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;
UPDATE role_utilisateur   SET description = f_accentuer_suite(description) WHERE description IS NOT NULL;
UPDATE role_bom           SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;
UPDATE groupe_equiv       SET libelle = f_accentuer_suite(libelle) WHERE libelle IS NOT NULL;

DROP FUNCTION f_accentuer_suite(text);

COMMIT;
