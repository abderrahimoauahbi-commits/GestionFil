-- =============================================================================
-- MIGRATION 2026-09-17g — LE COURS DE BANK AL-MAGHRIB, A COTE DU TAUX DE L'ERP
-- -----------------------------------------------------------------------------
-- Demande du 17/09/2026 : afficher, pour information, le taux de change utilise
-- par l'ERP ET le cours en vigueur chez Bank Al-Maghrib.
--
-- Le serveur lit le cours de reference MOYEN sur bkam.ma quand celui du jour
-- manque (au plus une tentative par demi-heure) et le garde ici. Rien ne
-- touche `taux_change` : le taux qui valorise les receptions reste une
-- decision saisie et datee (RG-09).
--
-- Rejouable : IF NOT EXISTS.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cours_bam (
    code_devise         text    NOT NULL REFERENCES devise(code_devise),
    date_cours          text    NOT NULL CHECK (date_cours ~ '^\d{4}-\d{2}-\d{2}$'),
    cours_mad           numeric(12,4)   NOT NULL CHECK (cours_mad > 0),
    date_lecture        text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    PRIMARY KEY (code_devise, date_cours)
);

ALTER TABLE cours_bam OWNER TO gestionfil;

COMMIT;
