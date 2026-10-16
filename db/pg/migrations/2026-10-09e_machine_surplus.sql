-- =============================================================================
-- 2026-10-09e — Le fil charge deja consomme, a relire (regle 2, 09/10/2026)
-- =============================================================================
-- Arbitrage : a un chargement, la consommation ne peut venir que de ce que la
-- ligne portait avant. Au-dela, le fil qu'on vient de charger serait deja file
-- (fiche saisie en retard, oubli d'un constat, erreur de report) : la decision
-- passe en ORANGE, le magasinier choisit la raison et valide seul. Le controle
-- C48 liste ces decisions pour que le responsable les relise ; il ne bloque rien.
-- Les decisions anterieures a la regle (vertes a l'epoque) y figurent aussi.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE VIEW v_ctl_c48 AS
SELECT e.numero_fiche, e.code_machine, e.zone, e.date_decision, e.code_reference, e.lot_fournisseur,
       e.kg_avant, e.kg_mouvementes, e.kg_apres, e.ecart_kg,
       round(e.ecart_kg - e.kg_avant, 4) AS surplus_kg, e.motif_texte
  FROM v_machine_ecart e
 WHERE e.nature = 'CHARGE' AND e.effet_ecart = 'CONSOMMATION'
   AND e.ecart_kg > e.kg_avant + 0.5;
ALTER VIEW v_ctl_c48 OWNER TO gestionfil;

DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C48' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C48''::text, ''Chargement : fil charge deja consomme (a relire)''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c48)';
    END IF;
END $$;

COMMIT;
