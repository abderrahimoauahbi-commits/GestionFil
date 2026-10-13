-- =============================================================================
-- L'etat d'une machine — 9 septembre 2026
-- -----------------------------------------------------------------------------
-- `actif` a deux valeurs, et l'atelier en a quatre. Une machine arretee pour
-- panne n'est pas une machine mise en sommeil faute de commande, et aucune des
-- deux n'est une machine retiree du parc. Confondre les trois, c'est ne plus
-- savoir pourquoi un metier ne tourne pas — et c'est exactement la question
-- qu'on pose devant un metier arrete.
--
--   ACTIVE    en production. Tout est permis.
--   PANNE     arretee, elle porte encore du fil. On peut la decharger.
--   SOMMEIL   arretee volontairement — pas de commande, changement de serie.
--   RETIREE   sortie du parc. Elle ne doit plus rien porter.
--
-- `actif` NE DISPARAIT PAS : d'autres requetes le lisent. Il devient une
-- colonne GENEREE — vrai partout sauf pour une machine retiree — pour qu'il ne
-- puisse plus contredire l'etat. Deux verites sur la meme chose finissent
-- toujours par diverger.
-- =============================================================================

BEGIN;

ALTER TABLE machine ADD COLUMN etat text NOT NULL DEFAULT 'ACTIVE';

-- Ce qui etait inactif etait, de fait, retire du parc.
UPDATE machine SET etat = 'RETIREE' WHERE actif <> 1;

ALTER TABLE machine ADD CONSTRAINT ck_machine_etat
  CHECK (etat IN ('ACTIVE', 'PANNE', 'SOMMEIL', 'RETIREE'));

-- `actif` se deduit desormais de l'etat, il ne se saisit plus.
ALTER TABLE machine DROP COLUMN actif;
ALTER TABLE machine ADD COLUMN actif bigint
  GENERATED ALWAYS AS (CASE WHEN etat = 'RETIREE' THEN 0 ELSE 1 END) STORED;

-- Le motif du dernier changement d'etat, et sa date. UNE MACHINE EN PANNE SANS
-- MOTIF NE SERT A PERSONNE : dans trois semaines, plus personne ne saura si
-- elle attend une piece ou un technicien.
ALTER TABLE machine ADD COLUMN motif_etat text;
ALTER TABLE machine ADD COLUMN date_etat text;

UPDATE machine SET date_etat = to_char(now() AT TIME ZONE 'UTC',
                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

-- -----------------------------------------------------------------------------
-- Les champs, declares pour les droits
-- -----------------------------------------------------------------------------
-- Un champ non declare vaut MASQUE et sa colonne disparait sans un mot.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES
  ('PARAMETRES', 'etat',       'Etat de la machine',        'ECRITURE', 0, 2100),
  ('PARAMETRES', 'motif_etat', 'Motif du changement d etat', 'ECRITURE', 0, 2101),
  ('PARAMETRES', 'date_etat',  'Date du changement d etat',  'LECTURE',  0, 2102)
ON CONFLICT (module, champ) DO UPDATE
   SET libelle = excluded.libelle,
       niveau_defaut = excluded.niveau_defaut,
       sensible = excluded.sensible,
       ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
         WHEN r.code_role_user = 'ADMIN' THEN 'ECRITURE'
         WHEN NOT EXISTS (SELECT 1 FROM permission p
                           WHERE p.code_role_user = r.code_role_user
                             AND p.module = c.module AND p.action = 'LIRE'
                             AND p.actif = 1) THEN 'MASQUE'
         ELSE 'ECRITURE'
       END
  FROM (SELECT 'DIRECTION' AS code_role_user UNION ALL SELECT 'ADMIN'
        UNION ALL SELECT 'ASSISTANTE' UNION ALL SELECT 'MAGASIN') r
 CROSS JOIN champ_configurable c
 WHERE c.module = 'PARAMETRES' AND c.champ IN ('etat', 'motif_etat', 'date_etat')
ON CONFLICT (code_role_user, module, champ) DO UPDATE SET niveau = excluded.niveau;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, date_modification)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'PARAMETRES' AND m.champ IN ('etat', 'motif_etat', 'date_etat')
ON CONFLICT (id_utilisateur, module, champ) DO UPDATE SET niveau = excluded.niveau;

COMMIT;
