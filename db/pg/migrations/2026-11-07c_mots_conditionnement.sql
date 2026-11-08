-- =============================================================================
-- 2026-11-07c — Le mot de chaque conditionnement, tel que les ecrans l'ecrivent
-- =============================================================================
-- Demande de l'utilisateur (06/11, rappelee le 07/11/2026) : sur les commandes
-- et les receptions, le mot suit le conditionnement — rouleau, fut, sac, box… —
-- et non « bobine » partout. Les ecrans lisent desormais `unite_singulier` /
-- `unite_pluriel` (GET /api/conditionnements/mots). Cette migration :
--   1. rend leurs accents aux mots deja la (fût, unité) ;
--   2. ajoute le BOX, cite par l'utilisateur ;
-- sans toucher un mot qu'une personne aurait deja change dans Configuration.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

UPDATE conditionnement SET unite_singulier = 'fût', unite_pluriel = 'fûts', libelle = 'Fût'
 WHERE code_conditionnement = 'FUT' AND unite_singulier = 'fut' AND unite_pluriel = 'futs';
UPDATE conditionnement SET unite_singulier = 'unité', unite_pluriel = 'unités'
 WHERE code_conditionnement = 'VRAC' AND unite_singulier = 'unite' AND unite_pluriel = 'unites';

INSERT INTO conditionnement (code_conditionnement, libelle, unite_singulier, unite_pluriel, se_compte,
                             ordre_affichage, actif, description)
SELECT 'BOX', 'Box', 'box', 'box', 1, 65, 1, 'Caisse ou carton : un box se compte, comme un sac.'
 WHERE NOT EXISTS (SELECT 1 FROM conditionnement WHERE code_conditionnement = 'BOX');

-- Temoin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM conditionnement WHERE code_conditionnement = 'BOX') THEN
        RAISE EXCEPTION '2026-11-07c : migration incomplete';
    END IF;
END $$;

COMMIT;
