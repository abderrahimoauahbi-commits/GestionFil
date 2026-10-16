-- =============================================================================
-- 2026-10-08e — Lots : la derogation qui sert, la derive qui mesure
-- (audit v4, P2 action 12)
-- =============================================================================
-- 1. Une derogation ACCORDEE etait inscrite et jamais lue : aucun refus ne
--    proposait d'en demander une, rien ne la consommait. Celle qui compte — le
--    chargement d'un lot bloque — se demande desormais depuis la fiche machine
--    refusee (document = numero de la fiche), s'accorde avec un motif, et sert
--    UNE fois : la base admet le chargement de CE lot par CETTE fiche, puis la
--    validation la marque employee.
-- 2. v_lot_variation (l'ecart de poids par bobine d'un lot) lisait tous les
--    mouvements : transferts, retours machine, ajustements recomptaient les
--    memes bobines. Elle ne lit plus que la reception initiale, hors
--    contre-passation (regle 13).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE demande_autorisation ADD COLUMN IF NOT EXISTS date_consommation text;

-- Un accord ou un refus s'explique (le refus seul l'exigeait, a l'ecran).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_demande_decision_motivee') THEN
        ALTER TABLE demande_autorisation ADD CONSTRAINT ck_demande_decision_motivee
            CHECK (statut NOT IN ('ACCORDEE', 'REFUSEE') OR length(btrim(COALESCE(motif_decision, ''))) >= 5)
            NOT VALID;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_trg_lmvt_lot_controle() RETURNS trigger AS $$
DECLARE
    v_statut text;
    v_type   text;
    v_doc    text;
    v_dest_q bigint;
BEGIN
    IF NEW.poids_unitaire_theorique_kg IS NULL AND COALESCE(NEW.nb_bobines, 0) > 0 THEN
        SELECT NULLIF(poids_bobine_kg, 0) INTO NEW.poids_unitaire_theorique_kg
          FROM reference WHERE code_reference = NEW.code_reference;
    END IF;
    IF NEW.lot_fournisseur IS NOT NULL THEN
        SELECT statut INTO v_statut FROM lot
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
        IF v_statut = 'BLOQUE' THEN
            -- LE BLOCAGE QUALITE ASSOUPLI (regle 11) : interdit ce qui EMPLOIE
            -- le lot, laisse ce qui l'ISOLE.
            SELECT m.code_type_mvt, m.reference_document INTO v_type, v_doc
              FROM mouvement m WHERE m.id_mouvement = NEW.id_mouvement;
            IF v_type IN ('RETOUR_MACHINE', 'ANNUL_CHARGE_MACHINE', 'RETOUR_FOURN',
                          'AJUST_INV_POS', 'AJUST_INV_NEG', 'ENTREE_REC') THEN
                RETURN NEW;
            END IF;
            IF v_type IN ('TRANSFERT_SORTIE', 'TRANSFERT_ENTREE') THEN
                SELECT mg.est_quarantaine INTO v_dest_q
                  FROM transfert t JOIN magasin mg ON mg.code_magasin = t.code_magasin_dest
                 WHERE t.numero_transfert = v_doc;
                IF v_dest_q = 1 THEN
                    RETURN NEW;
                END IF;
            END IF;
            -- LA DEROGATION ACCORDEE (audit v4) : ce lot, par cette fiche, une fois.
            IF v_type = 'CHARGE_MACHINE' AND EXISTS (
                SELECT 1 FROM demande_autorisation d
                 WHERE d.type_demande = 'LOT_BLOQUE' AND d.statut = 'ACCORDEE'
                   AND d.code_reference = NEW.code_reference AND d.lot_fournisseur = NEW.lot_fournisseur
                   AND d.document = v_doc AND d.date_consommation IS NULL) THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'LOT-BLOQUE : le lot % de % est bloque par la qualite : il ne part ni en production, ni sur machine, ni en fusion. Il peut revenir d''une machine, aller en quarantaine ou retourner au fournisseur.',
                NEW.lot_fournisseur, NEW.code_reference USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_lot_controle() OWNER TO gestionfil;

CREATE OR REPLACE VIEW v_lot_variation AS
 SELECT lm.code_reference,
    lm.lot_fournisseur,
    count(*) AS nb_lignes_pesees,
    round(sum(lm.nb_bobines::numeric * lm.poids_unitaire_theorique_kg), 4) AS theorique_kg,
    round(sum(lm.quantite_kg), 4) AS reel_kg,
    round(sum(lm.quantite_kg - lm.nb_bobines::numeric * lm.poids_unitaire_theorique_kg), 4) AS ecart_cumule_kg,
    round(sum(lm.quantite_kg - lm.nb_bobines::numeric * lm.poids_unitaire_theorique_kg)
          / NULLIF(sum(lm.nb_bobines::numeric * lm.poids_unitaire_theorique_kg), 0) * 100, 2) AS ecart_cumule_pct,
    round(sum(lm.quantite_kg) / NULLIF(sum(lm.nb_bobines), 0)::numeric, 4) AS poids_reel_moyen_bobine_kg,
    round(avg(lm.poids_unitaire_theorique_kg), 4) AS poids_catalogue_bobine_kg
   FROM ligne_mouvement lm
     JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
  WHERE lm.lot_fournisseur IS NOT NULL
    AND COALESCE(lm.nb_bobines, 0) > 0
    AND lm.poids_unitaire_theorique_kg > 0
    -- La reception initiale seule (regle 13), et pas celle qu'on a defaite.
    AND m.code_type_mvt = 'ENTREE_REC'
    AND NOT EXISTS (SELECT 1 FROM mouvement inv WHERE inv.id_mouvement_contrepasse = m.id_mouvement)
  GROUP BY lm.code_reference, lm.lot_fournisseur;
ALTER VIEW v_lot_variation OWNER TO gestionfil;

COMMIT;
