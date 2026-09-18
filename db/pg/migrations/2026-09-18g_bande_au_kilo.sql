-- =============================================================================
-- MIGRATION 2026-09-18g — LA BANDE S'ACHETE AU KILO
-- -----------------------------------------------------------------------------
-- DECISION DU 18/09/2026, prise apres constat. Les deux classeurs disent « ml »
-- et 2,50 USD l'unite. Au metre, cela donnait 500 USD le kilo — cent fois le
-- prix de n'importe quel fil du catalogue — soit 4 635 MAD/kg de CMUP, 23,18 MAD
-- par metre carre de Shehrazade a elle seule, et 5,08 MILLIONS de dirhams de
-- budget annuel pour un ruban de bordure : la Bande devenait le deuxieme poste
-- d'achat de l'entreprise, devant le fil.
--
-- Au kilo, les memes 2,50 USD donnent 23,18 MAD/kg, 0,12 MAD/m2 et environ
-- 25 000 MAD par an. C'est ce prix-la qui a ete retenu.
--
-- LA DENSITE RESTE : 0,005 kg/ml sert toujours a la recette (1 ml par m2 de
-- tapis, soit 0,005 kg/m2). Elle ne sert plus a convertir un prix.
--
-- ATTENTION AU CLASSEUR : « Liste ref fil.xlsx » porte encore « ml ». Regenerer
-- la migration du catalogue depuis ce fichier remettrait le metre — cette
-- migration, plus recente, le corrigerait a nouveau, mais mieux vaut corriger le
-- fichier.
--
-- Le CMUP suit tout seul : le declencheur pose par 2026-09-18e s'en charge des
-- que l'unite change.
--
-- Rejouable : la mise a jour ne fait rien si l'unite est deja le kilo.
-- =============================================================================

BEGIN;

UPDATE reference
   SET unite_catalogue = 'kg'
 WHERE code_reference = 'Bande'
   AND unite_catalogue IS DISTINCT FROM 'kg';

DO $$
DECLARE u text; p numeric; c numeric;
BEGIN
    SELECT unite_catalogue, prix_catalogue, cmup_mad INTO u, p, c
      FROM reference WHERE code_reference = 'Bande';
    IF u IS NULL THEN
        RAISE NOTICE 'aucune reference « Bande » dans cette base';
    ELSIF u <> 'kg' THEN
        RAISE EXCEPTION 'la Bande devrait etre au kilo, elle est en %', u;
    ELSE
        RAISE NOTICE 'Bande : % USD le %, CMUP % MAD/kg', p, u, c;
    END IF;
END $$;

COMMIT;
