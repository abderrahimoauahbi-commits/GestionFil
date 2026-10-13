-- =============================================================================
-- 2026-10-10d — La premiere entree d'un lot est la date du fait
-- =============================================================================
-- Depuis la date du fait (receptions, mouvements, fiches machine datees), un lot
-- recu en fevrier 2024 et saisi en octobre 2026 prenait le 10/10/2026 pour
-- premiere entree : la valeur par defaut de la colonne, l'instant de la saisie.
-- Le lot le plus ancien, propose d'office aux sorties et aux chargements de
-- machine (F21), etait alors le dernier saisi, pas le premier arrive.
--
-- Le declencheur d'application des lignes de mouvement pose desormais la date
-- du mouvement ; une entree datee avant la premiere connue la remplace. Les
-- lots existants sont recales sur leur premiere entree au grand livre.
-- Rejouable : CREATE OR REPLACE, et une mise a jour qui ne fait que reculer.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_trg_lmvt_appliquer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
        -- LA PREMIERE ENTREE EST LA DATE DU FAIT (10/10/2026) : celle du mouvement,
        -- pas l'instant de la saisie. Une livraison de fevrier 2024 saisie en
        -- octobre 2026 passait pour le lot le plus recent, et le « plus ancien
        -- d'abord » des sorties et des chargements se trompait de lot.
        INSERT INTO stock_lot (code_reference, code_magasin, lot_fournisseur, quantite_kg,
                               prix_entree_mad, date_fabrication, date_peremption, code_couleur,
                               date_premiere_entree)
        VALUES (NEW.code_reference, v_magasin, NEW.lot_fournisseur, 0,
                NEW.prix_kg_mad, NEW.date_fabrication, NEW.date_peremption, NEW.code_couleur,
                COALESCE(v_date, v_maintenant))
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
               -- Une entree datee avant la premiere connue la remplace.
               date_premiere_entree = CASE WHEN v_signe = 1 AND v_date < date_premiere_entree
                                           THEN v_date ELSE date_premiere_entree END,
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
$function$;

-- Les lots deja la : leur premiere entree au grand livre, si elle est plus ancienne.
UPDATE stock_lot sl
   SET date_premiere_entree = x.premiere
  FROM (SELECT lm.code_reference, m.code_magasin, lm.lot_fournisseur, min(m.date_mouvement) AS premiere
          FROM ligne_mouvement lm
          JOIN mouvement m       ON m.id_mouvement   = lm.id_mouvement
          JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
         WHERE tm.signe = 1 AND lm.lot_fournisseur IS NOT NULL
         GROUP BY 1, 2, 3) x
 WHERE sl.code_reference = x.code_reference AND sl.code_magasin = x.code_magasin
   AND sl.lot_fournisseur = x.lot_fournisseur AND x.premiere < sl.date_premiere_entree;
