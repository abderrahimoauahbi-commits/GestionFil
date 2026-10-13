-- =============================================================================
-- MIGRATION 2026-09-12 (b) — LA COULEUR ET LA FAMILLE DEVIENNENT DES REFERENTIELS
-- -----------------------------------------------------------------------------
-- LE PROBLEME, tel qu'il se pose dans les classeurs de prix : un meme fil se
-- vend chez plusieurs fournisseurs, et chacun le nomme a sa facon. Le rouge du
-- frise 2650 est « RED 7612 » chez Hasirci, « OZ 5109 » chez Ozkaralar,
-- « RED 5342 » chez Goral. Rien, dans le catalogue, ne disait que c'est le meme
-- fil et la meme couleur : les equivalences se saisissaient a la main.
--
-- LA REPONSE tient en deux listes et trois colonnes :
--
--   * `couleur`  — VOTRE liste (C1 = OR, C3 = ROUGE, CG = GRIS CLAIR…),
--     commune a tous les fournisseurs ;
--   * `famille`  — le produit independamment du vendeur (FIL 2650 dtex FZ) ;
--   * sur la reference : sa famille, sa couleur interne, et LA REFERENCE DU
--     FOURNISSEUR — celle qui est ecrite sur sa facture, donc celle que la
--     saisie assistee lira.
--
-- Deux references de meme famille et de meme couleur sont alors le meme fil,
-- quel que soit le vendeur : la vue `v_equivalence_auto` les rapproche sans
-- qu'on ait rien a declarer.
--
-- LA CLASSE DE TEINTURE (LIGHT / MEDIUM / DARK / RED) vient des memes
-- classeurs : le prix d'une couleur y est le prix de base de la famille plus un
-- supplement de teinture en devise par tonne (verifie sur 120 cotations :
-- or 2,02 − 200/1000 = noir 1,92 − 100/1000 = rouge 2,35 − 530/1000 = 1,82 $).
-- C'est ce qui permet de chiffrer une couleur JAMAIS achetee.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS couleur (
    code_couleur_interne text    NOT NULL PRIMARY KEY,
    libelle              text    NOT NULL,
    -- La classe tarifaire du teinturier. Le supplement se porte sur la
    -- reference, parce qu'il varie d'un fournisseur a l'autre.
    classe_teinture      text    CHECK (classe_teinture IS NULL
                                        OR classe_teinture IN ('LIGHT','MEDIUM','DARK','RED')),
    description          text,
    ordre_affichage      bigint  NOT NULL DEFAULT 0,
    actif                bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

CREATE TABLE IF NOT EXISTS famille (
    code_famille    text    NOT NULL PRIMARY KEY,
    libelle         text    NOT NULL,
    code_categorie  text    REFERENCES categorie_matiere(code_categorie),
    type_fil        text,
    titrage         text,
    description     text,
    ordre_affichage bigint  NOT NULL DEFAULT 0,
    actif           bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);

ALTER TABLE reference ADD COLUMN IF NOT EXISTS code_famille          text REFERENCES famille(code_famille);
ALTER TABLE reference ADD COLUMN IF NOT EXISTS code_couleur_interne  text REFERENCES couleur(code_couleur_interne);
ALTER TABLE reference ADD COLUMN IF NOT EXISTS reference_fournisseur text;
ALTER TABLE reference ADD COLUMN IF NOT EXISTS supplement_teinture   numeric(18,4);

DO $$ BEGIN
    ALTER TABLE reference ADD CONSTRAINT reference_supplement_teinture_check
        CHECK (supplement_teinture IS NULL OR supplement_teinture >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS ix_ref_famille_couleur
    ON reference(code_famille, code_couleur_interne) WHERE actif = 1;
CREATE INDEX IF NOT EXISTS ix_ref_reference_fournisseur
    ON reference(reference_fournisseur) WHERE reference_fournisseur IS NOT NULL;

-- Les couleurs relevees dans les classeurs de prix. Celles dont le libelle
-- n'est pas certain sont posees quand meme : le code existe chez plusieurs
-- fournisseurs, c'est a l'usage de le nommer.
INSERT INTO couleur (code_couleur_interne, libelle, classe_teinture, description, ordre_affichage) VALUES
    ('C1',  'Or',           NULL,   'GOLD chez les fournisseurs',            10),
    ('C2',  'Noir',         'DARK', 'BLACK',                                 20),
    ('C3',  'Rouge',        'RED',  'RED — classe tarifaire la plus chere',  30),
    ('C4',  'A preciser',   NULL,   'Code present chez Goral et Ozkaralar',  40),
    ('C5',  'Beige',        NULL,   'CREAM / BEIGE',                         50),
    ('C5N', 'Beige fonce',  NULL,   NULL,                                    55),
    ('C5S', 'Beige nouveau', NULL,  'NEW BEIGE / SH. beige',                 56),
    ('C6',  'A preciser',   NULL,   'Code present chez Tekstur et Turkan',   60),
    ('C7',  'A preciser',   NULL,   'Code present chez Tekstur',             70),
    ('C8',  'A preciser',   NULL,   'Code present chez Tekstur et Turkan',   80),
    ('CG',  'Gris clair',   'LIGHT','L.GRAY',                                90),
    ('CV',  'A preciser',   NULL,   'Code present chez Tekstur',            100),
    ('CM',  'Marron',       'DARK', 'BROWN',                                110),
    ('CLM', 'Marron clair', NULL,   'L.BROWN',                              120),
    ('CMS', 'Marron nouveau', NULL, 'NEW MARRON / SH. brown',               130),
    ('CVR', 'Vert fonce',   'DARK', 'D.GREEN',                              140),
    ('CBR', 'Bleu fonce',   'DARK', 'D.BLUE',                               150),
    ('TAUPE','Taupe',       NULL,   NULL,                                   160)
ON CONFLICT (code_couleur_interne) DO NOTHING;

-- -----------------------------------------------------------------------------
-- L'EQUIVALENCE SE DEDUIT : meme famille, meme couleur, deux fournisseurs.
-- La vue ne remplace pas les groupes d'equivalence saisis — elle montre ce que
-- la donnee dit deja, et sert a les alimenter sans les deviner.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_equivalence_auto AS
SELECT a.code_reference                AS code_reference,
       b.code_reference                AS code_equivalent,
       a.code_famille,
       f.libelle                       AS famille_libelle,
       a.code_couleur_interne,
       c.libelle                       AS couleur_libelle,
       a.code_fournisseur              AS fournisseur,
       b.code_fournisseur              AS fournisseur_equivalent,
       a.reference_fournisseur         AS reference_chez_fournisseur,
       b.reference_fournisseur         AS reference_chez_equivalent,
       (SELECT count(*) FROM reference_groupe_equiv g1
          JOIN reference_groupe_equiv g2 ON g2.code_groupe_equiv = g1.code_groupe_equiv
         WHERE g1.code_reference = a.code_reference
           AND g2.code_reference = b.code_reference
           AND g1.actif = 1 AND g2.actif = 1) AS deja_groupees
  FROM reference a
  JOIN reference b ON b.code_famille = a.code_famille
                  AND b.code_couleur_interne = a.code_couleur_interne
                  AND b.code_reference <> a.code_reference
  LEFT JOIN famille f ON f.code_famille = a.code_famille
  LEFT JOIN couleur c ON c.code_couleur_interne = a.code_couleur_interne
 WHERE a.actif = 1 AND b.actif = 1
   AND a.code_famille IS NOT NULL AND a.code_couleur_interne IS NOT NULL
   AND a.code_fournisseur <> b.code_fournisseur;

ALTER TABLE couleur OWNER TO gestionfil;
ALTER TABLE famille OWNER TO gestionfil;
ALTER VIEW v_equivalence_auto OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- Les colonnes doivent etre declarees, sinon les ecrans les masquent.
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('CATALOGUE', 'code_couleur_interne',  'Code couleur interne',   'ECRITURE', 0, 700),
 ('CATALOGUE', 'code_famille',          'Famille',                'ECRITURE', 0, 705),
 ('CATALOGUE', 'reference_fournisseur', 'Reference fournisseur',  'ECRITURE', 0, 710),
 ('CATALOGUE', 'supplement_teinture',   'Supplement teinture',    'ECRITURE', 0, 715),
 ('CATALOGUE', 'classe_teinture',       'Classe de teinture',     'ECRITURE', 0, 720),
 ('CATALOGUE', 'description',           'Description',            'ECRITURE', 0, 725),
 ('CATALOGUE', 'ordre_affichage',       'Ordre d''affichage',     'ECRITURE', 0, 730),
 ('CATALOGUE', 'nb_references',         'References',             'LECTURE',  0, 735)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN c.niveau_defaut = 'ECRITURE' AND EXISTS (
                 SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                  AND p.module = 'CATALOGUE' AND p.action = 'ECRIRE') THEN 'ECRITURE'
            WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                          AND p.module = 'CATALOGUE' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'CATALOGUE' AND c.ordre BETWEEN 700 AND 735 AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'CATALOGUE' AND c.ordre BETWEEN 700 AND 735
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
