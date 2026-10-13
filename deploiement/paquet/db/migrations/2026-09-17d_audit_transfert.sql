-- =============================================================================
-- MIGRATION 2026-09-17d — AUCUN TRANSFERT NE POUVAIT ETRE CREE
-- -----------------------------------------------------------------------------
-- Le declencheur d'audit de `transfert` lisait `NEW.code_magasin_destination`.
-- La colonne s'appelle `code_magasin_dest`. PL/pgSQL ne resout le champ qu'a
-- l'execution : la fonction se creait sans erreur, et CHAQUE creation de
-- transfert echouait ensuite en « erreur interne ». La table ne compte aucun
-- transfert, ni en local ni sur la copie de verification.
--
-- Trouve en essayant, par l'API, le transfert d'un stock sans valeur (2026-09-17b).
-- Rejouable : CREATE OR REPLACE.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_trg_audit_transfert_i() RETURNS trigger AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('transfert', 'INSERT', NEW.id_transfert,
                NULL,
                json_build_object('numero_transfert', NEW.numero_transfert,
                            'magasin_source',   NEW.code_magasin_source,
                            'magasin_dest',     NEW.code_magasin_dest,
                            'statut',           NEW.statut),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
