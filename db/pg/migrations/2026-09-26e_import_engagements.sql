-- =============================================================================
-- MIGRATION 2026-09-26e — les engagements d'importation du dossier
--
-- CE QUE C'EST. Avant toute importation, l'entreprise ouvre en banque un
-- ENGAGEMENT D'IMPORTATION (EI) : c'est lui qui autorise le reglement en devise
-- au fournisseur. La DUM le reprend en case 38 — numero, date, banque,
-- quantite, valeur — et un meme dossier en porte souvent plusieurs : la DUM du
-- 26/05/2026 en cite deux, ouverts dans deux banques differentes.
--
-- POURQUOI ICI, ET POURQUOI SI PEU. L'engagement sert a RETROUVER et a
-- CLASSER un dossier : c'est le numero que la banque, le transitaire et la
-- comptabilite ont sous les yeux. On ne gere pas le credit lui-meme — ni
-- consommation, ni echeances, ni reglements : ce suivi appartient a la
-- tresorerie. D'ou une table de reference, sans aucun calcul.
--
-- PLUSIEURS PAR DOSSIER, et le meme numero peut revenir sur deux dossiers : un
-- engagement se consomme parfois en plusieurs expeditions. L'unicite porte donc
-- sur le couple (dossier, numero), pas sur le numero seul.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-09-26e_import_engagements.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS import_engagements (
    id_engagement   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_dossier      text NOT NULL REFERENCES import_dossiers (id_dossier) ON DELETE CASCADE,
    -- Le numero tel que la banque l'imprime : 20261000000000905984.
    numero_ei       text NOT NULL CHECK (btrim(numero_ei) <> ''),
    -- La banque, telle que la DUM la cite (« 013-6400063 ») ou par son nom.
    banque          text,
    date_ei         text,
    -- Ce que l'engagement couvre, tel qu'il est declare. Facultatif : le
    -- numero suffit a classer ; le reste aide a reconnaitre.
    quantite_kg     numeric(18, 2) CHECK (quantite_kg IS NULL OR quantite_kg >= 0),
    montant_devise  numeric(18, 2) CHECK (montant_devise IS NULL OR montant_devise >= 0),
    code_devise     text,
    notes           text,
    id_utilisateur_creation text,
    date_creation   text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE (id_dossier, numero_ei)
);

-- La recherche d'un dossier par son numero d'engagement.
CREATE INDEX IF NOT EXISTS idx_import_engagements_numero ON import_engagements (numero_ei);

ALTER TABLE import_engagements OWNER TO gestionfil;

COMMENT ON TABLE import_engagements IS
    'Engagements d''importation (EI) ouverts en banque, cites par le dossier. Reference seulement : aucun suivi de consommation.';

-- PREUVE
SELECT 'import_engagements : ' || count(*) || ' colonnes'
  FROM information_schema.columns WHERE table_name = 'import_engagements';
