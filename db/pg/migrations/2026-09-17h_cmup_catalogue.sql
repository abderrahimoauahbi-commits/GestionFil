-- =============================================================================
-- MIGRATION 2026-09-17h — SANS ACHAT, LE CMUP EST LE PRIX CATALOGUE
-- -----------------------------------------------------------------------------
-- DECISION DU 17/09/2026, qui complete 2026-09-17b. « Comme tous les grands
-- ERP : tant qu'aucune reception ni aucun mouvement n'a valorise le CMUP, on
-- prend le prix catalogue ; sinon les valeurs sont nulles. » Et a la premiere
-- reception, MOYENNE avec le catalogue (le prix moyen de la fiche article de
-- SAP) : le stock deja la compte au prix catalogue.
--
--   26 346,6 kg au catalogue (3,00 $ x 9,2704 = 27,8112)
--   + 10 000 kg recus a 29,14
--   = (26 346,6 x 27,8112 + 10 000 x 29,14) / 36 346,6 = 28,1768 MAD/kg
--
-- LE PRIX CATALOGUE EN MAD = prix catalogue au kg x taux de change EN VIGUEUR
-- de sa devise. Pas de taux : pas de prix — jamais de repli sur un taux de 1,
-- qui valoriserait un fil en dollars comme s'il etait en dirhams.
--
-- CE QUI CHANGE DANS `fn_trg_lmvt_appliquer` :
--   (a) une entree SANS prix dans un magasin sans CMUP y pose le prix catalogue
--       (stock initial, transfert d'un stock non valorise, retour machine,
--       stock trouve a l'inventaire) ;
--   (a) une entree AVEC prix moyenne avec le CMUP du magasin, ou a defaut avec
--       le prix catalogue ;
--   (c) le CMUP de la fiche reference se recalcule a CHAQUE mouvement, sorties
--       comprises : une sortie qui vide un magasin laissait une moyenne perimee
--       (constat 10 de l'audit du CMUP). Sans aucun stock, la fiche garde son
--       dernier CMUP, ou prend le prix catalogue si elle n'en a jamais eu.
--
-- LE GRAND LIVRE NE BOUGE PAS : les lignes de mouvement sans prix restent sans
-- prix. Seuls les soldes et les fiches recoivent le prix catalogue.
--
-- Rejouable : CREATE OR REPLACE, mises a jour gardees par IS NULL / IS DISTINCT.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_prix_catalogue_mad(p_reference text) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT round(r.prix_catalogue_kg * t.taux, 4)
      FROM reference r
      JOIN LATERAL (
            SELECT tc.taux FROM taux_change tc
             WHERE tc.code_devise = r.code_devise_catalogue
               AND to_char(current_date, 'YYYY-MM-DD') >= substr(tc.date_debut, 1, 10)
               AND (tc.date_fin IS NULL
                    OR to_char(current_date, 'YYYY-MM-DD') < substr(tc.date_fin, 1, 10))
             ORDER BY tc.date_debut DESC LIMIT 1) t ON true
     WHERE r.code_reference = p_reference
       AND r.prix_catalogue_kg > 0
$$;

CREATE OR REPLACE FUNCTION fn_trg_lmvt_appliquer() RETURNS trigger AS $$
DECLARE
    v_magasin       text;
    v_date          text;
    v_signe         integer;
    v_impacte_cmup  smallint;
    v_cmup_magasin  numeric;
    v_catalogue     numeric;
    v_cmup_fiche    numeric;
    v_maintenant    text := to_char((now() AT TIME ZONE 'UTC'),
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    SELECT m.code_magasin, m.date_mouvement, tm.signe, tm.impacte_cmup
      INTO v_magasin, v_date, v_signe, v_impacte_cmup
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- (a1) garantir l'existence de la ligne de solde, a zero
    INSERT INTO stock_magasin (code_reference, code_magasin, quantite_kg, cmup_mad)
    VALUES (NEW.code_reference, v_magasin, 0, NULL)
    ON CONFLICT (code_reference, code_magasin) DO NOTHING;

    -- Le prix catalogue n'est lu que s'il peut servir : une ENTREE dans un
    -- magasin qui n'a encore aucun CMUP.
    IF v_signe = 1 THEN
        SELECT cmup_mad INTO v_cmup_magasin
          FROM stock_magasin
         WHERE code_reference = NEW.code_reference AND code_magasin = v_magasin;
        IF v_cmup_magasin IS NULL THEN
            v_catalogue := fn_prix_catalogue_mad(NEW.code_reference);
        END IF;
    END IF;

    -- (a2) appliquer le delta signe, puis le CMUP (R04)
    UPDATE stock_magasin
       SET cmup_mad = CASE
               -- Entree valorisee : moyenne ponderee, le stock deja present
               -- compte a son CMUP, ou a defaut au prix catalogue.
               WHEN v_impacte_cmup = 1
                AND NEW.prix_kg_mad IS NOT NULL
                AND quantite_kg + NEW.quantite_kg > 0
               THEN round(( quantite_kg * COALESCE(cmup_mad, v_catalogue, NEW.prix_kg_mad)
                          + NEW.quantite_kg * NEW.prix_kg_mad )
                          / (quantite_kg + NEW.quantite_kg), 4)
               -- Entree sans prix dans un magasin jamais valorise : le prix
               -- catalogue, s'il existe. Sinon le CMUP reste vide.
               WHEN v_signe = 1 AND cmup_mad IS NULL
               THEN v_catalogue
               ELSE cmup_mad
           END,
           quantite_kg = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
           -- LE COMPTE DE BOBINES SUIT LES KILOS, avec le meme signe.
           --
           -- GREATEST borne a zero, et ce n'est pas une precaution de confort :
           -- les mouvements anterieurs a ce module ne portent aucun nombre de
           -- bobines, donc un magasin peut contenir 400 kg pour un compte de 0.
           -- Sans la borne, la premiere sortie chiffree violerait le CHECK et
           -- bloquerait un mouvement de kilos parfaitement legitime. Le compte
           -- est un compteur SECONDAIRE ; c'est le controle C30 qui signale les
           -- incoherences, pas une erreur au visage du magasinier.
           nb_bobines = GREATEST(0, nb_bobines + v_signe * COALESCE(NEW.nb_bobines, 0)),
           date_derniere_entree = CASE WHEN v_signe =  1 THEN v_date
                                       ELSE date_derniere_entree END,
           date_derniere_sortie = CASE WHEN v_signe = -1 THEN v_date
                                       ELSE date_derniere_sortie END,
           date_maj = v_maintenant
     WHERE code_reference = NEW.code_reference
       AND code_magasin   = v_magasin;

    -- (b) solde par lot, seulement si la ligne porte un lot
    IF NEW.lot_fournisseur IS NOT NULL THEN
        INSERT INTO stock_lot (code_reference, code_magasin, lot_fournisseur, quantite_kg,
                               prix_entree_mad, date_fabrication, date_peremption, code_couleur)
        VALUES (NEW.code_reference, v_magasin, NEW.lot_fournisseur, 0,
                NEW.prix_kg_mad, NEW.date_fabrication, NEW.date_peremption, NEW.code_couleur)
        ON CONFLICT (code_reference, code_magasin, lot_fournisseur) DO NOTHING;

        UPDATE stock_lot
           SET quantite_kg      = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
               -- Meme borne, meme raison qu'au solde par magasin ci-dessus.
               -- C'est CE compte-ci que lit le declencheur de capacite : sur un
               -- emplacement de machine, ou la saisie impose toujours le nombre
               -- de bobines, il est exact des la premiere ecriture.
               nb_bobines       = GREATEST(0, nb_bobines + v_signe * COALESCE(NEW.nb_bobines, 0)),
               prix_entree_mad  = COALESCE(prix_entree_mad, NEW.prix_kg_mad),
               date_fabrication = COALESCE(date_fabrication, NEW.date_fabrication),
               date_peremption  = COALESCE(date_peremption, NEW.date_peremption),
               code_couleur     = COALESCE(code_couleur, NEW.code_couleur),
               date_maj         = v_maintenant
         WHERE code_reference  = NEW.code_reference
           AND lot_fournisseur = NEW.lot_fournisseur
           AND code_magasin    = v_magasin;
    END IF;

    -- (c) CMUP consolide tous magasins sur la fiche reference (RG-08), a CHAQUE
    -- mouvement. Sans stock nulle part : le dernier CMUP de la fiche, ou le
    -- prix catalogue si elle n'en a jamais eu. La fiche n'est reecrite que si
    -- la valeur change : chaque ecriture passe au journal d'audit.
    SELECT COALESCE(
               (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                  FROM stock_magasin sm
                 WHERE sm.code_reference = NEW.code_reference
                   AND sm.quantite_kg > 0
                   AND sm.cmup_mad IS NOT NULL),
               r.cmup_mad,
               fn_prix_catalogue_mad(NEW.code_reference))
      INTO v_cmup_fiche
      FROM reference r
     WHERE r.code_reference = NEW.code_reference;

    UPDATE reference
       SET cmup_mad = v_cmup_fiche,
           date_dernier_cmup = v_maintenant
     WHERE code_reference = NEW.code_reference
       AND cmup_mad IS DISTINCT FROM v_cmup_fiche;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- --- Les soldes et les fiches deja en base --------------------------------------
-- Le stock de depart, entre sans prix : chaque solde non valorise prend le prix
-- catalogue du jour.
UPDATE stock_magasin sm
   SET cmup_mad = fn_prix_catalogue_mad(sm.code_reference),
       date_maj = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE sm.cmup_mad IS NULL
   AND sm.quantite_kg > 0
   AND fn_prix_catalogue_mad(sm.code_reference) IS NOT NULL;

UPDATE reference r
   SET cmup_mad = v.cmup,
       date_dernier_cmup = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (SELECT r2.code_reference,
               COALESCE(
                   (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                      FROM stock_magasin sm
                     WHERE sm.code_reference = r2.code_reference
                       AND sm.quantite_kg > 0 AND sm.cmup_mad IS NOT NULL),
                   r2.cmup_mad,
                   fn_prix_catalogue_mad(r2.code_reference)) AS cmup
          FROM reference r2) v
 WHERE v.code_reference = r.code_reference
   AND r.cmup_mad IS DISTINCT FROM v.cmup;

COMMIT;
