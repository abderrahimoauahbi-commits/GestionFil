-- =============================================================================
-- LE CONDITIONNEMENT N'EST PAS TOUJOURS UNE BOBINE
-- =============================================================================
--
-- CE QUI ETAIT FAUX. Tout l'ERP comptait en bobines : `poids_bobine_kg`,
-- `bobines_par_palette`, et des ecrans qui annoncent « 3 palettes · 120
-- bobines » quelle que soit la matiere. C'etait vrai des fils, qui forment
-- l'essentiel du catalogue — et faux de tout le reste :
--
--   LA COLLE arrive en cuves industrielles de 1 000 litres (IBC, ou GRV en
--   francais), sanglees sur palette, qu'on pompe. Une cuve n'est pas une
--   bobine : elle se mesure en litres, elle ne se deroule pas, et il y en a
--   une par palette, pas cent vingt.
--
--   LES PLASTIQUES viennent en rouleaux poses sur palette — ou en un seul
--   conteneur quand la piece est grande.
--
--   LA BANDE n'a pas de bobines non plus : une palette en porte des CENTAINES
--   de petits rouleaux.
--
-- Annoncer « bobines » pour une cuve de colle n'est pas un detail d'affichage.
-- Le magasinier qui lit « 2 bobines » devant deux cuves de mille litres cesse
-- de croire l'ecran, et c'est tout le comptage qui perd sa valeur.
--
-- CE QUE FAIT CETTE MIGRATION. Elle introduit un CONDITIONNEMENT par
-- reference : ce dans quoi la matiere arrive et se compte. Chaque type porte
-- son propre vocabulaire — bobine, rouleau, cuve, sac, fut — et l'ERP emploie
-- le mot de la matiere qu'il a sous les yeux.
--
-- CE QU'ELLE NE FAIT PAS. Elle n'invente aucun chiffre. Le poids d'un rouleau
-- de Bande, le nombre de rouleaux par palette, la densite de la colle : rien
-- de tout cela n'est dans le classeur ni deductible. Les colonnes restent
-- vides et les ecrans le disent, plutot que d'afficher un comptage faux.
--
-- POURQUOI LES COLONNES DE STOCKAGE GARDENT LEUR NOM. `poids_bobine_kg` et
-- `bobines_par_palette` deviennent « poids d'une unite » et « unites par
-- palette ». Les renommer toucherait neuf vues et soixante-quatorze fichiers
-- pour un gain de vocabulaire, au risque d'en casser un en silence. On corrige
-- donc le COMMENTAIRE, qui est ce que lit le prochain developpeur, et le
-- conditionnement dit desormais de quelle unite il s'agit.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Le referentiel des conditionnements
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conditionnement (
    code_conditionnement text PRIMARY KEY,
    libelle              text NOT NULL,
    -- LE MOT AU SINGULIER ET AU PLURIEL. L'ecran ecrit « 1 cuve » et
    -- « 3 cuves » ; un seul libelle obligerait a « 1 cuve(s) », qu'aucun
    -- document serieux ne porte.
    unite_singulier      text NOT NULL,
    unite_pluriel        text NOT NULL,
    -- SE COMPTE-T-IL ? Le vrac ne se compte pas, il se pese. Afficher un
    -- nombre d'unites pour du vrac serait inventer une precision.
    se_compte            integer NOT NULL DEFAULT 1 CHECK (se_compte IN (0, 1)),
    -- CONTENANCE, pour ce qui se mesure en volume. Une cuve IBC fait 1 000 L ;
    -- c'est une propriete du CONTENANT, pas de la matiere, donc elle vit ici.
    contenance_litres    numeric(10, 2),
    ordre_affichage      integer NOT NULL DEFAULT 0,
    actif                integer NOT NULL DEFAULT 1 CHECK (actif IN (0, 1)),
    description          text
);

COMMENT ON TABLE conditionnement IS
'Ce dans quoi une matiere arrive et se compte. Le catalogue supposait la bobine
 partout ; la colle vient en cuves de 1000 L, la Bande en centaines de petits
 rouleaux par palette, les plastiques en rouleaux ou en conteneur.';

INSERT INTO conditionnement
    (code_conditionnement, libelle, unite_singulier, unite_pluriel,
     se_compte, contenance_litres, ordre_affichage, description)
VALUES
    ('BOBINE', 'Bobine de fil', 'bobine', 'bobines', 1, NULL, 10,
     'Le fil, conditionnement historique et majoritaire du catalogue.'),
    ('ROULEAU', 'Rouleau', 'rouleau', 'rouleaux', 1, NULL, 20,
     'Plastiques et nappes : des rouleaux poses sur palette.'),
    ('ROULEAU_PETIT', 'Petit rouleau', 'rouleau', 'rouleaux', 1, NULL, 30,
     'La Bande : une palette en porte des centaines.'),
    ('CUVE', 'Cuve IBC / GRV 1000 L', 'cuve', 'cuves', 1, 1000, 40,
     'Grand recipient pour vrac, sangle sur palette et pompe sur place. La colle.'),
    ('FUT', 'Fut', 'fut', 'futs', 1, 200, 50,
     'Contenant metallique ou plastique de deux cents litres.'),
    ('SAC', 'Sac', 'sac', 'sacs', 1, NULL, 60,
     'Poudres et granules.'),
    ('CONTENEUR', 'Conteneur', 'conteneur', 'conteneurs', 1, NULL, 70,
     'Une piece unique, trop grande pour etre palettisee.'),
    ('VRAC', 'Vrac', 'unite', 'unites', 0, NULL, 80,
     'Ne se compte pas : se pese. Aucun nombre d unites n est affiche.')
ON CONFLICT (code_conditionnement) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Chaque reference declare le sien
-- -----------------------------------------------------------------------------

ALTER TABLE reference
    ADD COLUMN IF NOT EXISTS code_conditionnement text
        REFERENCES conditionnement (code_conditionnement);

COMMENT ON COLUMN reference.code_conditionnement IS
'Ce dans quoi cette matiere arrive : bobine, rouleau, cuve, sac... Il decide du
 MOT employe a l ecran et du sens des deux colonnes ci-dessous.';

-- LES DEUX COLONNES CHANGENT DE SENS, PAS DE NOM.
COMMENT ON COLUMN reference.poids_bobine_kg IS
'Poids net d UNE unite de conditionnement, en kg — une bobine, un rouleau, une
 cuve pleine. Le nom de la colonne dit « bobine » pour des raisons d historique :
 c est `code_conditionnement` qui dit de quelle unite il s agit.';

COMMENT ON COLUMN reference.bobines_par_palette IS
'Nombre d unites de conditionnement sur une palette complete : 120 bobines,
 480 petits rouleaux de Bande, 1 cuve de colle. Voir `code_conditionnement`.';

-- -----------------------------------------------------------------------------
-- 3. Ce que l on sait deja, sans rien inventer
-- -----------------------------------------------------------------------------

-- LES FILS SONT EN BOBINES, et on le sait parce qu'ils portent deja un poids
-- de bobine et un nombre par palette venus du classeur.
UPDATE reference
   SET code_conditionnement = 'BOBINE'
 WHERE code_conditionnement IS NULL
   AND poids_bobine_kg IS NOT NULL;

-- LA COLLE EN CUVES. SBR est un latex de synthese : il arrive en GRV de mille
-- litres, sangle sur palette, et se pompe. Une cuve par palette — c est la
-- seule chose qu on puisse affirmer, le poids dependant de la densite du bain
-- et restant donc a saisir.
UPDATE reference
   SET code_conditionnement = 'CUVE',
       bobines_par_palette = 1
 WHERE code_conditionnement IS NULL
   AND code_reference IN (SELECT code_reference FROM reference r
                           JOIN famille f USING (code_famille)
                          WHERE f.code_categorie = 'SBR');

-- LA BANDE EN PETITS ROULEAUX. Une palette en porte des centaines ; le nombre
-- exact et le poids unitaire ne sont nulle part, ils se saisiront a l ecran.
UPDATE reference
   SET code_conditionnement = 'ROULEAU_PETIT'
 WHERE code_conditionnement IS NULL
   AND code_reference = 'Bande';

-- LES PLASTIQUES EN ROULEAUX.
UPDATE reference
   SET code_conditionnement = 'ROULEAU'
 WHERE code_conditionnement IS NULL
   AND code_reference IN (SELECT r.code_reference FROM reference r
                           JOIN famille f USING (code_famille)
                          WHERE f.code_categorie = 'PLA');

-- TOUT LE RESTE RESTE SANS CONDITIONNEMENT DECLARE, et c est volontaire.
--
-- Quinze references sont dans ce cas : les sept jutes, les quatre chaines
-- polyester, les deux PES-Nylon, le simili cuir (compte en metres lineaires)
-- et le Hotmelt. Elles arrivent peut-etre en bobines, peut-etre en rouleaux,
-- peut-etre en sacs — le Hotmelt est une colle, mais en granules, pas en cuve.
-- Personne ici ne le sait, et deviner reviendrait a mettre un chiffre faux
-- dans un comptage que quelqu un croira.
--
-- L ecran du catalogue permet de les declarer une par une ; tant que ce n est
-- pas fait, l etat du stock affiche les kilos seuls, sans nombre de colis.

-- -----------------------------------------------------------------------------
-- 4. Ce que les ecrans liront
-- -----------------------------------------------------------------------------

-- CREATE OR REPLACE ne suffit pas : la vue change de colonnes, et PostgreSQL
-- refuse d en renommer une au passage. On la depose d abord.
-- CASCADE : `v_etat_stock_conditionne` s appuie dessus et sera recreee plus bas.
DROP VIEW IF EXISTS v_reference_conditionnement CASCADE;
CREATE VIEW v_reference_conditionnement AS
SELECT r.code_reference,
       r.code_conditionnement,
       c.libelle                                        AS conditionnement_libelle,
       -- PAS DE REPLI SUR « BOBINE » POUR CE QUI N EST PAS DECLARE.
       --
       -- La premiere ecriture de cette vue mettait COALESCE(..., 'BOBINE') :
       -- le jute, les chaines polyester et le simili cuir s affichaient alors
       -- comme des bobines, ce qui est precisement l erreur que la migration
       -- corrige — et en pire, puisqu elle aurait l air d une donnee saisie.
       -- Non declare, on dit « unite » et l ecran saura que le mot est
       -- provisoire.
       COALESCE(c.unite_singulier, 'unite')             AS unite_singulier,
       COALESCE(c.unite_pluriel, 'unites')              AS unite_pluriel,
       COALESCE(c.se_compte, 0)                         AS se_compte,
       c.contenance_litres,
       r.poids_bobine_kg                                AS poids_unite_kg,
       r.bobines_par_palette                            AS unites_par_palette,
       -- LE POIDS D UNE PALETTE PLEINE, quand les deux chiffres existent.
       -- Absent, il vaut NULL : l ecran affichera alors les kilos seuls, ce
       -- qui est la verite, plutot qu un nombre de colis calcule sur du vide.
       CASE WHEN r.poids_bobine_kg IS NOT NULL AND r.bobines_par_palette IS NOT NULL
            THEN r.poids_bobine_kg * r.bobines_par_palette
       END                                              AS kg_par_palette,
       -- LE CONDITIONNEMENT EST-IL DECLARE ? Ce que l ecran doit savoir pour
       -- proposer de le renseigner au lieu de faire semblant.
       (r.code_conditionnement IS NOT NULL)::int        AS declare,
       -- LE COMPTAGE EST-IL POSSIBLE ? Il faut le type, le poids unitaire, le
       -- nombre par palette, et que la matiere se compte : du vrac se pese.
       (r.code_conditionnement IS NOT NULL
        AND r.poids_bobine_kg IS NOT NULL
        AND r.bobines_par_palette IS NOT NULL
        AND c.se_compte = 1)::int                       AS comptable
  FROM reference r
  LEFT JOIN conditionnement c
         ON c.code_conditionnement = r.code_conditionnement;

COMMENT ON VIEW v_reference_conditionnement IS
'Le vocabulaire de comptage de chaque reference : quel mot employer, combien
 pese une unite, combien il en tient sur une palette, et si le comptage est
 seulement possible.';

ALTER VIEW v_reference_conditionnement OWNER TO gestionfil;
ALTER TABLE conditionnement OWNER TO gestionfil;

DO $$
DECLARE n_bob int; n_cuve int; n_roul int; n_petit int; n_sans int;
BEGIN
    SELECT count(*) INTO n_bob   FROM reference WHERE code_conditionnement = 'BOBINE';
    SELECT count(*) INTO n_cuve  FROM reference WHERE code_conditionnement = 'CUVE';
    SELECT count(*) INTO n_roul  FROM reference WHERE code_conditionnement = 'ROULEAU';
    SELECT count(*) INTO n_petit FROM reference WHERE code_conditionnement = 'ROULEAU_PETIT';
    SELECT count(*) INTO n_sans  FROM reference WHERE code_conditionnement IS NULL;
    RAISE NOTICE 'conditionnement : % bobines, % cuves, % rouleaux, % petits rouleaux, % a declarer',
                 n_bob, n_cuve, n_roul, n_petit, n_sans;
END $$;

COMMIT;

-- =============================================================================
-- L'ETAT DU STOCK PARLE LA LANGUE DE LA MATIERE
-- =============================================================================
--
-- La vue calculait deja `palettes` et `bobines` a partir du poids de bobine.
-- Le calcul reste juste ; c'est le MOT qui manquait. On ajoute donc, a cote
-- des nombres, l'unite qui leur correspond — « bobines » pour un fil,
-- « rouleaux » pour un plastique, « cuves » pour la colle — et de quoi savoir
-- si le comptage tient debout.
--
-- LE NOMBRE ET SON MOT VOYAGENT ENSEMBLE. Les separer, c'est garantir qu'un
-- ecran affichera tot ou tard le nombre sans le mot, ou pire, avec le mauvais.
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW v_etat_stock_conditionne AS
SELECT e.*,
       c.code_conditionnement,
       c.conditionnement_libelle,
       c.unite_singulier,
       c.unite_pluriel,
       c.declare        AS conditionnement_declare,
       c.comptable      AS conditionnement_comptable,
       c.contenance_litres,
       -- LE COMPTAGE N'EST RENDU QUE S'IL VEUT DIRE QUELQUE CHOSE. Sans type
       -- declare, sans poids unitaire, ou sur du vrac qui se pese, on rend
       -- NULL plutot qu'un nombre : l'ecran montrera les kilos seuls, et
       -- proposera de completer la fiche.
       CASE WHEN c.comptable = 1 THEN e.bobines END   AS nb_colis,
       CASE WHEN c.comptable = 1 THEN e.palettes END  AS nb_palettes,
       -- LE VOLUME, pour ce qui se mesure en litres : deux cuves de mille
       -- litres se disent mieux en « 2 000 L » qu'en kilos de latex.
       CASE WHEN c.comptable = 1 AND c.contenance_litres IS NOT NULL
            THEN round(e.bobines * c.contenance_litres, 0)
       END                                            AS litres
  FROM v_etat_stock e
  JOIN v_reference_conditionnement c USING (code_reference);

COMMENT ON VIEW v_etat_stock_conditionne IS
'L etat du stock, augmente du vocabulaire de comptage propre a chaque matiere.
 Les nombres de colis et de palettes valent NULL quand le conditionnement n est
 pas renseigne : mieux vaut les kilos seuls qu un comptage invente.';

ALTER VIEW v_etat_stock_conditionne OWNER TO gestionfil;

COMMIT;

-- =============================================================================
-- LES CHAMPS NEUFS SE DECLARENT, SINON ILS N'EXISTENT PAS A L'ECRAN
-- =============================================================================
--
-- PIEGE DEJA PAYE UNE FOIS. Les colonnes visibles sont filtrees par
-- `champ_configurable` ; un champ NON DECLARE retombe sur MASQUE. Il est alors
-- present en base, rendu par l'API, attendu par l'ecran — et invisible, sans
-- le moindre message. C'est ce qui avait fait disparaitre la case a cocher du
-- plan d'achat, et cherchee pendant une heure ailleurs.
--
-- Le libelle des deux colonnes historiques change aussi : « Poids par bobine »
-- devient « Poids par unite », puisque l'unite n'est plus toujours une bobine.
-- =============================================================================

BEGIN;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES
    ('CATALOGUE', 'code_conditionnement', 'Conditionnement', 'ECRITURE', 0, 88),
    ('STOCK',     'unite_pluriel',        'Unite de comptage', 'LECTURE', 0, 62),
    ('STOCK',     'nb_colis',             'Colis',             'LECTURE', 0, 63),
    ('STOCK',     'litres',               'Litres',            'LECTURE', 0, 64)
ON CONFLICT (module, champ) DO NOTHING;

-- LE MOT « BOBINE » QUITTE LES LIBELLES, puisqu'il ne dit plus la verite de
-- toutes les references.
UPDATE champ_configurable
   SET libelle = 'Poids par unite (kg)'
 WHERE champ = 'poids_bobine_kg';

UPDATE champ_configurable
   SET libelle = 'Unites par palette'
 WHERE champ = 'bobines_par_palette';

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM champ_configurable
     WHERE champ IN ('code_conditionnement', 'unite_pluriel', 'nb_colis', 'litres');
    RAISE NOTICE 'champs de conditionnement declares : %', n;
END $$;

COMMIT;
