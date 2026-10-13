-- =============================================================================
-- 2026-10-09q — Receptions cloturees gardees ; le rapport des ecarts de prix
-- (audit v5, F18, valide le 09/10/2026)
-- =============================================================================
--   * Une reception CLOTUREE (avec sa facture) sortait du cout de revient
--     (v_cout_revient) et des controles C31 / C32, qui ne lisaient que VALIDE :
--     plus elle etait aboutie, moins elle etait verifiee. Elles y reviennent.
--   * v_ecart_prix : ce que la valorisation en deux temps n'a pas pu porter au
--     CMUP — la part des kilos deja sortis (nature ECART_PRIX en local,
--     CONSOMME a l'import) : factures, frais, avoirs et retours. C'est le
--     chiffre que la Direction suit : il n'est dans aucun stock.
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    v text;
    def text;
BEGIN
    FOREACH v IN ARRAY ARRAY['v_cout_revient', 'v_ctl_c31', 'v_ctl_c32'] LOOP
        def := pg_get_viewdef(v::regclass);
        IF position('rc.statut = ''VALIDE''::text' IN def) > 0 THEN
            def := replace(rtrim(rtrim(def), ';'), 'rc.statut = ''VALIDE''::text',
                           '(rc.statut = ANY (ARRAY[''VALIDE''::text, ''CLOTURE''::text]))');
            EXECUTE format('CREATE OR REPLACE VIEW %I AS %s', v, def);
        ELSIF position('CLOTURE' IN def) = 0 THEN
            RAISE EXCEPTION '% : le filtre sur le statut de la reception a change, migration a revoir', v;
        END IF;
    END LOOP;
END $$;

CREATE OR REPLACE VIEW v_ecart_prix AS
SELECT 'LOCAL'::text AS circuit, a.id_ajustement, substr(a.date_ajustement, 1, 10) AS date_ecart,
       r.numero_reception AS document, r.id_reception AS id_document,
       r.code_fournisseur, f.nom AS fournisseur_nom, a.code_reference, ref.designation,
       a.origine, a.numero_piece, a.motif, a.quantite_recue_kg, round(a.montant_mad, 2) AS montant_mad
  FROM reception_ajustements_cmup a
  JOIN reception r ON r.id_reception = a.id_reception
  LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
  LEFT JOIN reference ref ON ref.code_reference = a.code_reference
 WHERE a.nature = 'ECART_PRIX' AND a.montant_mad <> 0
UNION ALL
SELECT 'IMPORT', a.id_ajustement, substr(a.date_ajustement, 1, 10),
       d.numero, d.id_dossier,
       ref.code_fournisseur, f.nom, a.code_reference, ref.designation,
       a.origine, a.numero_piece, a.motif, a.quantite_recue_kg, round(a.montant_dhs, 2)
  FROM import_ajustements_cump a
  JOIN import_dossiers d ON d.id_dossier = a.id_dossier
  LEFT JOIN reference ref ON ref.code_reference = a.code_reference
  LEFT JOIN fournisseur f ON f.code_fournisseur = ref.code_fournisseur
 WHERE a.nature = 'CONSOMME' AND a.montant_dhs <> 0;
ALTER VIEW v_ecart_prix OWNER TO gestionfil;

COMMIT;
