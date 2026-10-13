-- =============================================================================
-- MIGRATION 2026-09-12 (e) — LA COULEUR INTERNE ET SES CODES FOURNISSEUR
-- -----------------------------------------------------------------------------
-- Le rouge de l'entreprise, c'est C3. Chez Hasirci il s'appelle « RED 7612 »,
-- chez Ozkaralar « OZ 5109 », chez Goral « RED 5342 » — et Goral en a deux,
-- 5342 et 5354. Une couleur interne porte donc PLUSIEURS codes fournisseur,
-- et c'est cette table qui les tient.
--
-- A QUOI ELLE SERT, concretement :
--   * l'assistant lit « RED 7612 » sur une facture et sait que c'est C3 ;
--   * l'acheteur voit d'un coup d'oeil qui sait fournir C3, et sous quel code ;
--   * deux references de meme famille et de meme couleur interne deviennent
--     equivalentes sans qu'on l'ait declare.
--
-- UNE SEULE UNICITE : un code chez un fournisseur designe une seule couleur.
-- L'inverse est faux — un fournisseur peut avoir deux rouges.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS couleur_fournisseur (
    id_couleur_fournisseur text NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code_couleur_interne   text NOT NULL REFERENCES couleur(code_couleur_interne) ON DELETE CASCADE,
    code_fournisseur       text NOT NULL REFERENCES fournisseur(code_fournisseur),
    -- Le code tel que le fournisseur l'ecrit : « 7612 », « OZ 5109 », « SSL2279 ».
    code_couleur           text NOT NULL,
    -- Son libelle a lui : « RED », « GOLD 2117 », « SEKER CREAM ».
    libelle                text,
    -- Le supplement de teinture de CE fournisseur pour cette couleur, en devise
    -- par tonne (100, 150, 530...) : il varie d'un fournisseur a l'autre.
    supplement_teinture    numeric(18,4) CHECK (supplement_teinture IS NULL OR supplement_teinture >= 0),
    actif                  bigint NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    UNIQUE (code_fournisseur, code_couleur)
);

CREATE INDEX IF NOT EXISTS ix_couleur_four_couleur ON couleur_fournisseur(code_couleur_interne);
CREATE INDEX IF NOT EXISTS ix_couleur_four_code    ON couleur_fournisseur(code_couleur);

ALTER TABLE couleur_fournisseur OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- CHAQUE FAMILLE SOUS SA CATEGORIE, ET AUCUNE CATEGORIE SANS FAMILLE
-- -----------------------------------------------------------------------------
-- Le rattachement se lit dans l'unite du titrage, et c'est une regle de metier
-- constante ici : le POLYPROPYLENE se compte en dtex, le POLYESTER en deniers.
-- Le shrink a sa propre categorie. Ce n'est qu'une PROPOSITION : elle se corrige
-- a l'ecran, categorie par categorie.
UPDATE famille SET code_categorie = 'PP'
 WHERE code_categorie IS NULL AND upper(libelle) LIKE '%DTEX%';

UPDATE famille SET code_categorie = 'PES-SH'
 WHERE code_categorie IS NULL AND upper(libelle) LIKE '%SHRINK%';

UPDATE famille SET code_categorie = 'PES'
 WHERE code_categorie IS NULL
   AND (upper(libelle) LIKE '%DENIER%' OR upper(libelle) LIKE '%POLYESTER%'
        OR upper(libelle) LIKE '%CHAGUI%' OR upper(libelle) LIKE '%FDY%'
        OR upper(libelle) LIKE '%MICRO%' OR upper(libelle) LIKE '%VERONA%'
        OR upper(libelle) LIKE '%PESMICRO%' OR upper(libelle) LIKE '%1775%'
        OR upper(libelle) LIKE '%1000X2%');

-- UNE CATEGORIE SANS FAMILLE EN RECOIT UNE, A SON NOM. Sans cela, une matiere
-- comme le jute ou la colle n'aurait nulle part ou se ranger, et la chaine
-- categorie -> famille -> reference serait rompue des qu'on sort du fil.
INSERT INTO famille (code_famille, libelle, code_categorie, description, ordre_affichage)
SELECT c.code_categorie, c.libelle, c.code_categorie,
       'Famille par defaut de la categorie', 5
  FROM categorie_matiere c
 WHERE c.actif = 1
   AND NOT EXISTS (SELECT 1 FROM famille f WHERE f.code_categorie = c.code_categorie)
ON CONFLICT (code_famille) DO NOTHING;

-- Les colonnes des deux ecrans lies (module CATALOGUE).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('CATALOGUE', 'code_couleur_fournisseur', 'Code chez le fournisseur', 'ECRITURE', 0, 740),
 ('CATALOGUE', 'nb_fournisseurs',          'Fournisseurs',             'LECTURE',  0, 745),
 ('CATALOGUE', 'nb_familles',              'Familles',                 'LECTURE',  0, 750)
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
 WHERE c.module = 'CATALOGUE' AND c.ordre BETWEEN 740 AND 750 AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'CATALOGUE' AND c.ordre BETWEEN 740 AND 750
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
