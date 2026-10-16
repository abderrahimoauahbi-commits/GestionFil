-- =============================================================================
-- 2026-10-08k — La numerotation par compteur (audit v4, P2 action 19)
-- =============================================================================
-- Chaque document prenait le plus grand numero de l'annee, plus un. Deux
-- saisies simultanees lisaient le meme maximum : la seconde tombait sur
-- l'unicite, en « Cet enregistrement existe deja », et l'operateur devait
-- recommencer. Le compteur est une ligne par prefixe et par annee, incrementee
-- dans la transaction du document : la seconde saisie attend la premiere, puis
-- prend le numero suivant. Il part du plus grand numero existant (documents
-- importes ou crees avant lui).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS compteur_numero (
    -- « table.colonne.PREFIXE-ANNEE », par exemple « bon_commande.numero_bc.BC-2026 ».
    cle     text   NOT NULL PRIMARY KEY,
    valeur  bigint NOT NULL CHECK (valeur > 0)
);
ALTER TABLE compteur_numero OWNER TO gestionfil;

COMMIT;
