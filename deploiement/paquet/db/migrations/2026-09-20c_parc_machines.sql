-- =============================================================================
-- LE PARC : CINQ METIERS, LEURS ETAGES, LEUR TRAME ET LEUR CHAINE
-- =============================================================================
--
-- CE QUI EST CREE, ET CE QUI NE L'EST PAS.
--
-- Deux metiers CRM existaient deja sous leurs noms d'atelier — Rania et
-- TINGIS — avec six etages de 1344 bobines et six de trame chacun, soit
-- exactement la description dictee pour CRM1 et CRM2. Ce script n'en cree donc
-- que TROIS :
--
--   CRX         8 etages x 1344 bobines   trame 6   chaine 2200
--   CRT         8 etages x 1668 bobines   trame 6   chaine 4400
--   Enrouleur  12 etages x  342 bobines   ni trame ni chaine
--
-- IL NE TOUCHE PAS AUX DEUX EXISTANTS. Une premiere version avait pousse la
-- chaine de Rania de 2 a 2200 en croyant la creer : ajouter des metiers ne
-- donne pas le droit d'en modifier un autre.
--
-- UNE LECTURE A CONFIRMER : « fil de chine » est lu comme fil de CHAINE. Le
-- modele porte deja un role CHAINE, les quantites annoncees sont celles d'une
-- ensouple, et l'Enrouleur — qui enroule sans tisser — n'en a aucune. S'il
-- s'agissait d'un fil importe de Chine, ce serait une REFERENCE du catalogue
-- et non une zone de machine.
--
-- UN ECART QUI RESTE : Rania et TINGIS portent une chaine de 2, les nouveaux
-- metiers 2200 et 4400. Ce ne peut pas etre la meme grandeur — deux ensouples
-- d'un cote, un nombre de bobines de l'autre. La question est posee, elle
-- n'est pas tranchee ici.
--
-- LA CAPACITE DE LA MACHINE est la somme de ses emplacements : etages, trame
-- et chaine. C'est ce total que le magasin compare a ce qui est reellement
-- monte, et le calculer a la main ouvrirait un ecart des le premier ajout.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Les metiers
-- -----------------------------------------------------------------------------

-- `code_atelier` EST UN MAGASIN, pas un nom d'atelier. La colonne pointe vers
-- `magasin` : les metiers sont donc rattaches a « Polyfashions », le site qui
-- les abrite. Ecrire « TISSAGE » etait un contresens que la cle etrangere a
-- arrete — ce qui est exactement son role.
--
-- `actif` NE S'INSERE PAS : c'est une colonne generee depuis `etat`, qui vaut
-- 0 pour une machine RETIREE et 1 sinon. La declarer ici serait refuse par la
-- base — et c'est tant mieux : une machine active dont l'etat dirait le
-- contraire serait une incoherence impossible a trancher.
INSERT INTO machine (code_machine, nom, capacite_bobines, nb_etages, code_atelier,
                     etat, notes)
VALUES
    ('CRX', 'CRX', 1, 8, 'Polyfashions', 'ACTIVE',
     'Huit etages de 1344 bobines. Trame 6. Chaine 2200.'),
    ('CRT', 'CRT', 1, 8, 'Polyfashions', 'ACTIVE',
     'Huit etages de 1668 bobines. Trame 6. Chaine 4400.'),
    ('ENROULEUR', 'Enrouleur', 1, 12, 'Polyfashions', 'ACTIVE',
     'Douze etages de 342 bobines. Ni trame ni chaine : il enroule, il ne tisse pas.')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Les etages
-- -----------------------------------------------------------------------------
-- Ils se fabriquent par generation plutot qu'a la main : quarante lignes
-- ecrites une a une, c'est quarante occasions de se tromper d'un chiffre, et
-- la faute ne se verrait qu'au comptage.

-- `code_magasin` RESTE VIDE : LA MACHINE N'EST PAS UN MAGASIN.
--
-- C'est une regle du modele, arretee le 9 septembre 2026, et non une question
-- ouverte. L'ancienne version creait un magasin par zone — dix-sept magasins
-- pour deux magasins reels, tous dans la liste du magasinier. La colonne est
-- depuis nullable et ne se renseigne plus.
--
-- Le parc entier est UN SEUL ENDROIT du point de vue du stock : « en
-- machine ». Ce qui s'y trouve est porte par `machine_etat`, un inventaire
-- permanent qui se COMPTE, et le stock global vaut « soldes des magasins plus
-- machine_etat ». Un envoi magasin vers machine ne cree donc aucune
-- contre-ecriture : il deplace, il ne duplique pas.
--
-- `libelle` EST GENERE PAR LA BASE depuis le role et le numero d'etage :
-- « Etage 3 », « Trame », « Chaine ». On ne l'ecrit donc pas — et c'est une
-- bonne chose, puisque deux emplacements de meme role ne peuvent plus porter
-- deux libelles differents selon qui les a saisis.
INSERT INTO machine_emplacement
    (code_emplacement, code_machine, role, numero_etage, capacite_bobines,
     code_magasin, actif)
SELECT format('%s-E%s', m.code, e.n), m.code, 'ETAGE', e.n, m.capacite,
       NULL, 1
  FROM (VALUES
            ('CRX', 8, 1344),
            ('CRT', 8, 1668),
            ('ENROULEUR', 12, 342)
       ) AS m(code, nb_etages, capacite),
       LATERAL generate_series(1, m.nb_etages) AS e(n)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. La trame et la chaine
-- -----------------------------------------------------------------------------
-- LE MENAGE D'ABORD. Une execution precedente avait pose des emplacements
-- `-TRAME` et `-CHAINE` a cote des `-TR` et `-CH` de l'existant. Les supprimer
-- APRES l'insertion ne marchait pas : l'unique (machine, role, etage) faisait
-- echouer la pose des `-TR` en silence — `DO NOTHING` — puis la suppression
-- emportait l'ancienne ligne sans que la neuve ait pris sa place. Trois metiers
-- se retrouvaient sans trame ni chaine, et rien ne le disait.

DELETE FROM machine_emplacement
 WHERE code_emplacement LIKE 'CRX-TRAME' OR code_emplacement LIKE 'CRX-CHAINE'
    OR code_emplacement LIKE 'CRT-TRAME' OR code_emplacement LIKE 'CRT-CHAINE';


INSERT INTO machine_emplacement
    (code_emplacement, code_machine, role, numero_etage, capacite_bobines,
     code_magasin, actif)
VALUES
    -- Trame : six bobines par metier, comme les deux CRM le portent deja.
    ('CRX-TR', 'CRX', 'TRAME', 0, 6, NULL, 1),
    ('CRT-TR', 'CRT', 'TRAME', 0, 6, NULL, 1),

    -- Chaine : le nombre dicte par l'atelier.
    ('CRX-CH', 'CRX', 'CHAINE', 0, 2200, NULL, 1),
    ('CRT-CH', 'CRT', 'CHAINE', 0, 4400, NULL, 1)
    -- L'Enrouleur n'en a aucune : il n'apparait pas ici, et c'est voulu.
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3 ter. Les noms et les capacites sont REMIS a ce qui est declare
-- -----------------------------------------------------------------------------
-- `ON CONFLICT DO NOTHING` rend le script rejouable, mais garde la ligne
-- existante telle quelle : une valeur fausse posee par une execution
-- precedente y survivrait. C'est arrive — CRM1 portait une trame de 6 et une
-- chaine de 2, restes d'un premier jet. Le script doit donc non seulement
-- pouvoir etre rejoue, mais RAMENER les capacites a ce qui est declare ici.

UPDATE machine m SET nom = v.nom
  FROM (VALUES ('CRX', 'CRX'), ('CRT', 'CRT'), ('ENROULEUR', 'Enrouleur')) AS v(code, nom)
 WHERE m.code_machine = v.code AND m.nom <> v.nom;

UPDATE machine_emplacement e
   SET capacite_bobines = v.capacite
  FROM (VALUES
            ('CRX-E%', 1344), ('CRT-E%', 1668), ('ENROULEUR-E%', 342)
       ) AS v(motif, capacite)
 WHERE e.code_emplacement LIKE v.motif
   AND e.capacite_bobines <> v.capacite;

UPDATE machine_emplacement e
   SET capacite_bobines = v.capacite
  FROM (VALUES
            ('CRX-TR', 6), ('CRT-TR', 6),
            ('CRX-CH', 2200), ('CRT-CH', 4400)
       ) AS v(code, capacite)
 WHERE e.code_emplacement = v.code
   AND e.capacite_bobines <> v.capacite;

-- -----------------------------------------------------------------------------
-- 4. La capacite de chaque metier est la somme de ses emplacements
-- -----------------------------------------------------------------------------

UPDATE machine m
   SET capacite_bobines = s.total
  FROM (SELECT code_machine, sum(capacite_bobines) AS total
          FROM machine_emplacement
         WHERE actif = 1
         GROUP BY code_machine) s
 WHERE s.code_machine = m.code_machine
   AND m.code_machine IN ('CRX', 'CRT', 'ENROULEUR');

DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT m.code_machine, m.nb_etages, m.capacite_bobines,
               count(*) FILTER (WHERE e.role = 'ETAGE')  AS etages,
               COALESCE(sum(e.capacite_bobines) FILTER (WHERE e.role = 'TRAME'), 0)  AS trame,
               COALESCE(sum(e.capacite_bobines) FILTER (WHERE e.role = 'CHAINE'), 0) AS chaine
          FROM machine m
          JOIN machine_emplacement e USING (code_machine)
         WHERE m.code_machine IN ('CRX', 'CRT', 'ENROULEUR')
         GROUP BY m.code_machine, m.nb_etages, m.capacite_bobines
         ORDER BY m.code_machine
    LOOP
        RAISE NOTICE '% : % etages declares, % crees, trame %, chaine %, total % bobines',
                     r.code_machine, r.nb_etages, r.etages, r.trame, r.chaine,
                     r.capacite_bobines;
    END LOOP;
END $$;

COMMIT;
