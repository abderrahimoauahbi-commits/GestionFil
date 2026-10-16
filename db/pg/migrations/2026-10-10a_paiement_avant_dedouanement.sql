-- =============================================================================
-- 2026-10-10a — Un paiement d'import date avant le dedouanement (arbitrage A11)
-- =============================================================================
--   * Tranche le 10/10/2026 : il n'y a JAMAIS d'acompte avant le dedouanement.
--     Le cout de revient reel (09m) mesure l'ecart de change d'un paiement par
--     rapport au cours du dedouanement : un paiement date AVANT la DUM y serait
--     compte comme s'il venait apres. Puisque le cas n'existe pas, un tel
--     paiement est une erreur de date (ou une pratique nouvelle a trancher).
--   * C53 le SIGNALE, il ne bloque rien (doctrine « signaler plutot que
--     bloquer ») ; la saisie renvoie le meme avis.
--   * Le jour du dedouanement est celui de v_change_paiement : la date de la
--     DUM du dossier, a defaut la date de la facture.
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE VIEW v_ctl_c53 AS
SELECT d.numero AS numero_dossier, p.numero_facture, p.date_paiement, p.date_ded,
       p.montant_devise, p.code_devise, p.id_paiement
  FROM v_change_paiement p
  JOIN import_dossiers d ON d.id_dossier = p.id_dossier
 WHERE p.date_paiement < p.date_ded;
ALTER VIEW v_ctl_c53 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C53' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C53''::text, ''Paiement d''''import date avant le dedouanement''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c53)';
    END IF;
END $$;

COMMIT;
