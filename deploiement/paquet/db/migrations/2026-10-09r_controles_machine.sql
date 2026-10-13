-- =============================================================================
-- 2026-10-09r — C35 et C36 rebranches sur l'etat des machines (audit v5, F19)
-- =============================================================================
-- Depuis le modele « decision » du 05/10, le fil sur machine vit dans
-- machine_etat, plus dans un magasin par emplacement. C35 et C36 lisaient
-- encore l'ancien modele (mouvements en ESTIMATION, stock_magasin des
-- emplacements) : ils comptaient zero quoi qu'il arrive.
--   * C35 : une ligne d'etage dont le poids par bobine retenu s'ecarte du poids
--     catalogue au-dela de P_TolerEstimMachine (%).
--   * C36 : un etage qui porte du fil et dont la ligne la plus ancienne n'a pas
--     ete constatee depuis P_JoursInventMachine jours (la date est celle de la
--     ligne depuis la meme livraison : une fiche ne rajeunit plus les lignes
--     qu'elle ne touche pas).
-- Leurs colonnes changent : v_controles et v_cockpit_files, qui en dependent,
-- sont reposees a l'identique. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    def_controles text := pg_get_viewdef('v_controles'::regclass);
    def_cockpit   text := pg_get_viewdef('v_cockpit_files'::regclass);
BEGIN
    -- Reposees a chaque passage : la migration se rejoue a l'identique.
    DROP VIEW v_cockpit_files;
    DROP VIEW v_controles;
    DROP VIEW v_ctl_c35;
    DROP VIEW v_ctl_c36;

    CREATE VIEW v_ctl_c35 AS
    SELECT z.code_machine, z.code_emplacement, z.libelle, e.code_reference, e.lot_fournisseur,
           e.nb_bobines, round(e.kg, 3) AS kg, e.poids_unitaire_kg, r.poids_bobine_kg AS poids_catalogue_kg,
           round((e.poids_unitaire_kg - r.poids_bobine_kg) / r.poids_bobine_kg * 100, 2) AS ecart_pct,
           substr(e.date_constat, 1, 10) AS date_constat, e.responsable
      FROM machine_etat e
      JOIN machine_emplacement z ON z.code_emplacement = e.code_emplacement
      JOIN reference r ON r.code_reference = e.code_reference
     WHERE e.kg > 0 AND e.poids_unitaire_kg > 0 AND r.poids_bobine_kg > 0
       AND abs((e.poids_unitaire_kg - r.poids_bobine_kg) / r.poids_bobine_kg * 100)
           > COALESCE((SELECT valeur_courante::numeric FROM parametre WHERE code_parametre = 'P_TolerEstimMachine'), 10);

    CREATE VIEW v_ctl_c36 AS
    SELECT z.code_machine, z.code_emplacement, z.libelle,
           min(substr(e.date_constat, 1, 10)) AS constat_le_plus_ancien,
           count(*) AS nb_lignes, round(sum(e.kg), 3) AS quantite_kg
      FROM machine_etat e
      JOIN machine_emplacement z ON z.code_emplacement = e.code_emplacement
     WHERE e.kg > 0
     GROUP BY z.code_machine, z.code_emplacement, z.libelle
    HAVING min(substr(e.date_constat, 1, 10)) < to_char(current_date - COALESCE(
               (SELECT valeur_courante::int FROM parametre WHERE code_parametre = 'P_JoursInventMachine'), 30), 'YYYY-MM-DD');

    EXECUTE 'CREATE VIEW v_controles AS ' || def_controles;
    EXECUTE 'CREATE VIEW v_cockpit_files AS ' || def_cockpit;
END $$;

ALTER VIEW v_ctl_c35 OWNER TO gestionfil;
ALTER VIEW v_ctl_c36 OWNER TO gestionfil;
ALTER VIEW v_controles OWNER TO gestionfil;
ALTER VIEW v_cockpit_files OWNER TO gestionfil;

COMMIT;
