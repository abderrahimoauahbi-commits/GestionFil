-- =============================================================================
-- 2026-10-09s — Lots : le lot solde qui recoit, le fil sans lot (audit v5, F21)
-- =============================================================================
--   * Un lot SOLDE qui recoit du fil (dechargement d'une machine, transfert,
--     retour de pret, ajustement) restait SOLDE : son stock disparaissait des
--     vues Projet et Restes et l'ecran n'offrait plus aucune action. Toute
--     entree le remet LIBRE, avec un evenement REOUVERTURE.
--   * Un lot qui porte encore du fil sur une machine ne passe pas SOLDE : la
--     decision manuelle est refusee (service) ; une fusion ou une
--     identification qui le viderait au magasin le laisse dans son statut.
--   * Rattrapage : les lots SOLDE qui ont du stock ou du fil sur machine
--     redeviennent LIBRE.
--   * C51 : une reference suivie au lot qui garde du stock SANS-LOT (magasin ou
--     machine) — a identifier. Un signal, jamais un blocage.
--   * Le plancher du stock par lot (jamais negatif) ramenait a zero sans trace :
--     il inscrit desormais un evenement PLANCHER avec les kilos manquants.
--   * Une meme demande d'autorisation en attente ne se cree plus deux fois
--     (index unique ; les doublons existants sont retires).
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE lot_evenement DROP CONSTRAINT IF EXISTS lot_evenement_type_evenement_check;
ALTER TABLE lot_evenement ADD CONSTRAINT lot_evenement_type_evenement_check CHECK (type_evenement IN
    ('BLOCAGE','DEBLOCAGE','BASCULEMENT_RESTES','RETOUR_PROJET','FUSION',
     'DECISION_DORMANT','DEROGATION','SOLDE','IDENTIFICATION','REOUVERTURE','PLANCHER'));

-- Une entree remet un lot solde en service.
DO $$
DECLARE
    def text;
    ancien constant text := 'categorie = CASE WHEN v_signe = 1 AND categorie = ''RESTES'' AND v_atteint';
BEGIN
    def := pg_get_functiondef('fn_trg_lmvt_lot_registre'::regproc);
    IF position('REOUVERTURE' IN def) = 0 THEN
        IF position(ancien IN def) = 0 THEN
            RAISE EXCEPTION 'fn_trg_lmvt_lot_registre : la mise a jour du lot a change, migration a revoir';
        END IF;
        def := replace(def, ancien,
            'statut = CASE WHEN v_signe = 1 AND statut = ''SOLDE'' THEN ''LIBRE'' ELSE statut END,'
            || E'\n               ' || ancien);
        -- L'evenement, avant la mise a jour (le statut lu est encore SOLDE).
        -- Une expression reguliere : le corps peut porter des fins de ligne CRLF.
        def := regexp_replace(def, 'ELSE(\s+)UPDATE lot',
            'ELSE\1IF v_signe = 1 THEN'
            || ' INSERT INTO lot_evenement (code_reference, lot_fournisseur, type_evenement, motif, details)'
            || ' SELECT NEW.code_reference, NEW.lot_fournisseur, ''REOUVERTURE'','
            || ' ''Lot solde qui recoit du fil : remis en service'','
            || ' jsonb_build_object(''id_mouvement'', NEW.id_mouvement, ''quantite_kg'', NEW.quantite_kg)'
            || ' FROM lot WHERE code_reference = NEW.code_reference'
            || ' AND lot_fournisseur = NEW.lot_fournisseur AND statut = ''SOLDE'';'
            || ' END IF;\1UPDATE lot');
        IF position('REOUVERTURE' IN def) = 0 THEN
            RAISE EXCEPTION 'fn_trg_lmvt_lot_registre : branche ELSE introuvable, migration a revoir';
        END IF;
        EXECUTE def;
    END IF;
END $$;
ALTER FUNCTION fn_trg_lmvt_lot_registre() OWNER TO gestionfil;

-- Un lot qui a du fil sur machine ne passe pas SOLDE (il garde son statut).
CREATE OR REPLACE FUNCTION fn_trg_lot_pas_solde_sur_machine() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'SOLDE' AND OLD.statut IS DISTINCT FROM 'SOLDE' AND EXISTS (
        SELECT 1 FROM machine_etat e
         WHERE e.code_reference = NEW.code_reference AND e.lot_fournisseur = NEW.lot_fournisseur AND e.kg > 0) THEN
        NEW.statut := OLD.statut;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lot_pas_solde_sur_machine() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_lot_pas_solde_sur_machine ON lot;
CREATE TRIGGER trg_lot_pas_solde_sur_machine BEFORE UPDATE OF statut ON lot
FOR EACH ROW EXECUTE FUNCTION fn_trg_lot_pas_solde_sur_machine();

-- Rattrapage : un lot solde qui a encore du stock ou du fil sur machine.
INSERT INTO lot_evenement (code_reference, lot_fournisseur, type_evenement, motif, details)
SELECT l.code_reference, l.lot_fournisseur, 'REOUVERTURE',
       'Lot solde qui portait encore du stock ou du fil sur machine : remis en service (migration 2026-10-09s)',
       jsonb_build_object('stock_kg', COALESCE(s.kg, 0), 'machine_kg', COALESCE(m.kg, 0))
  FROM lot l
  LEFT JOIN (SELECT code_reference, lot_fournisseur, sum(quantite_kg) AS kg FROM stock_lot
              GROUP BY 1, 2) s USING (code_reference, lot_fournisseur)
  LEFT JOIN (SELECT code_reference, lot_fournisseur, sum(kg) AS kg FROM machine_etat
              GROUP BY 1, 2) m USING (code_reference, lot_fournisseur)
 WHERE l.statut = 'SOLDE' AND (COALESCE(s.kg, 0) > 0.0005 OR COALESCE(m.kg, 0) > 0.0005);
UPDATE lot l SET statut = 'LIBRE'
 WHERE l.statut = 'SOLDE'
   AND (EXISTS (SELECT 1 FROM stock_lot s WHERE s.code_reference = l.code_reference
                  AND s.lot_fournisseur = l.lot_fournisseur AND s.quantite_kg > 0.0005)
     OR EXISTS (SELECT 1 FROM machine_etat m WHERE m.code_reference = l.code_reference
                  AND m.lot_fournisseur = l.lot_fournisseur AND m.kg > 0.0005));

-- Le plancher du lot laisse une trace.
CREATE OR REPLACE FUNCTION fn_lot_plancher() RETURNS trigger AS $$
BEGIN
    IF NEW.quantite_kg < 0 THEN
        INSERT INTO lot_evenement (code_reference, lot_fournisseur, type_evenement, motif, details)
        SELECT NEW.code_reference, NEW.lot_fournisseur, 'PLANCHER',
               'Solde du lot ramene a zero : la sortie depassait ce que le lot portait au magasin',
               jsonb_build_object('code_magasin', NEW.code_magasin, 'manque_kg', round(-NEW.quantite_kg, 4))
          FROM lot WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
        NEW.quantite_kg := 0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_lot_plancher() OWNER TO gestionfil;

-- Une demande en attente, une seule fois : les doublons existants s'annulent.
UPDATE demande_autorisation d SET statut = 'ANNULEE',
       motif_decision = 'Doublon d''une demande deja en attente (migration 2026-10-09s)'
 WHERE d.statut = 'EN_ATTENTE'
   AND EXISTS (SELECT 1 FROM demande_autorisation x
                WHERE x.statut = 'EN_ATTENTE' AND x.type_demande = d.type_demande
                  AND x.document IS NOT DISTINCT FROM d.document
                  AND x.lot_fournisseur IS NOT DISTINCT FROM d.lot_fournisseur
                  AND x.code_reference IS NOT DISTINCT FROM d.code_reference
                  AND (x.date_demande, x.id_demande) < (d.date_demande, d.id_demande));
CREATE UNIQUE INDEX IF NOT EXISTS ux_demande_en_attente ON demande_autorisation
    (type_demande, COALESCE(document, ''), COALESCE(lot_fournisseur, ''), COALESCE(code_reference, ''))
    WHERE statut = 'EN_ATTENTE';

-- C51 : le fil d'une reference suivie au lot qui reste sans lot.
CREATE OR REPLACE VIEW v_ctl_c51 AS
SELECT r.code_reference, r.designation,
       round(COALESCE((SELECT sum(s.quantite_kg) FROM stock_lot s
                        WHERE s.code_reference = r.code_reference AND s.lot_fournisseur = 'SANS-LOT'), 0), 3) AS magasin_kg,
       round(COALESCE((SELECT sum(e.kg) FROM machine_etat e
                        WHERE e.code_reference = r.code_reference AND e.lot_fournisseur = 'SANS-LOT'), 0), 3) AS machine_kg
  FROM reference r
 WHERE r.suivi_lot = 1
   AND (EXISTS (SELECT 1 FROM stock_lot s WHERE s.code_reference = r.code_reference
                  AND s.lot_fournisseur = 'SANS-LOT' AND s.quantite_kg > 0.0005)
     OR EXISTS (SELECT 1 FROM machine_etat e WHERE e.code_reference = r.code_reference
                  AND e.lot_fournisseur = 'SANS-LOT' AND e.kg > 0.0005));
ALTER VIEW v_ctl_c51 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C51' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C51''::text, ''Reference suivie au lot avec du fil sans lot, a identifier''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c51)';
    END IF;
END $$;

COMMIT;
