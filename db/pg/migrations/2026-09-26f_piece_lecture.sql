-- =============================================================================
-- MIGRATION 2026-09-26f — la lecture d'une piece, gardee
--
-- CE QUE C'EST. La saisie assistee : GestionAi lit une piece scannee (OCR) et
-- en extrait les documents — facture, DUM, engagements, liquidation, frais —
-- avec, pour chaque champ, sa valeur, le fragment lu, la page et un statut
-- (lu, verifie, corrige, deduit, a verifier). RIEN n'est enregistre dans le
-- dossier par cette lecture : l'operateur confirme champ par champ.
--
-- POURQUOI LA GARDER. Lire une liasse de vingt-quatre pages prend deux
-- minutes sur le serveur. Sans memoire, chaque retour sur l'ecran relancerait
-- la lecture ; avec, elle ne se refait qu'a la demande.
--
-- POURQUOI UNE TABLE A PART, ET PAS DEUX COLONNES DE piece_jointe. Le
-- declencheur trg_piece_verrou fige les pieces d'un dossier cloture, mises a
-- jour comprises. Or relire la piece d'un dossier clos reste legitime — pour
-- un controle, pour retrouver un chiffre. La lecture n'est pas la piece.
--
-- UNE LECTURE PAR PIECE : la derniere remplace la precedente.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-26f_piece_lecture.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS piece_lecture (
    id_piece        text    NOT NULL PRIMARY KEY
                            REFERENCES piece_jointe(id_piece) ON DELETE CASCADE,
    -- Le resultat de GestionAi tel quel : documents, pages, references.
    resultat        jsonb   NOT NULL,
    duree_s         numeric(8,1),
    date_lecture    text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur  text    NOT NULL REFERENCES utilisateur(id_utilisateur)
);

ALTER TABLE piece_lecture OWNER TO gestionfil;

COMMIT;
