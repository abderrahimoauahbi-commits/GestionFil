-- =============================================================================
-- ERP GESTION FIL — declencheurs a logique reelle, cible PostgreSQL
-- -----------------------------------------------------------------------------
-- Ecrits a la main. Les soixante-trois autres sont generes par
-- db/pg/porter_declencheurs.py : leur corps ne fait que refuser ou journaliser,
-- donc leur traduction est mecanique. Ces deux-ci ecrivent dans le stock et
-- dans l'historique, et une traduction mecanique en aurait change le sens.
-- =============================================================================


-- =============================================================================
-- 1. HISTORISATION DES PARAMETRES
-- -----------------------------------------------------------------------------
-- LE POINT QUI INQUIETAIT LA MIGRATION, ET POURQUOI IL NE SE POSE PAS.
--
-- En SQLite, ce declencheur ecrivait l'historique puis remettait a jour la
-- ligne de parametre. Il ne bouclait pas uniquement parce que
-- `recursive_triggers` est desactive — un pragma qui n'a AUCUN equivalent en
-- PostgreSQL, ou les declencheurs se cascadent toujours.
--
-- Verifie sur ce serveur : la recursion ne se produit pas davantage ici, pour
-- une raison independante du pragma. `AFTER UPDATE OF valeur_courante` ne se
-- declenche que si `valeur_courante` figure dans le SET ; la mise a jour
-- interne ne touchait que `date_derniere_modif`, donc elle ne rappelait pas le
-- declencheur. La clause WHEN forme un second filet.
--
-- La version PostgreSQL va plus loin et supprime la question : elle passe en
-- BEFORE et affecte `NEW.date_derniere_modif` directement. Plus de seconde
-- ecriture, donc plus de recursion possible, ni aujourd'hui ni le jour ou
-- quelqu'un ajoutera une colonne au SET sans y penser.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_trg_parametre_historiser() RETURNS trigger AS $$
BEGIN
    INSERT INTO parametre_historique (code_parametre, ancienne_valeur, nouvelle_valeur,
                                      id_utilisateur, motif, ip_adresse)
    VALUES (NEW.code_parametre, OLD.valeur_courante, NEW.valeur_courante,
            COALESCE(NEW.id_utilisateur_modif,
                     (SELECT id_utilisateur FROM _contexte_session WHERE id = 1)),
            NEW.motif_modif,
            (SELECT adresse_ip FROM _contexte_session WHERE id = 1));

    -- Affectation directe plutot qu'un UPDATE : c'est ce qui rend la recursion
    -- structurellement impossible, au lieu de dependre d'un reglage.
    NEW.date_derniere_modif := to_char((now() AT TIME ZONE 'UTC'),
                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_parametre_historiser
BEFORE UPDATE OF valeur_courante ON parametre FOR EACH ROW
WHEN (OLD.valeur_courante IS DISTINCT FROM NEW.valeur_courante)
EXECUTE FUNCTION fn_trg_parametre_historiser();


-- =============================================================================
-- 2. APPLICATION DU MOUVEMENT AU STOCK
-- -----------------------------------------------------------------------------
-- Le coeur du systeme. Un seul declencheur, donc un ordre garanti :
--   (a) solde et CMUP par magasin
--   (b) solde par lot
--   (c) CMUP consolide sur la fiche reference
--
-- Le CMUP ne bouge que si `type_mouvement.impacte_cmup = 1`, c'est-a-dire aux
-- seules entrees valorisees (R04). Une sortie ne le modifie jamais.
--
-- DEUX DIFFERENCES AVEC LA VERSION SQLITE, toutes deux a l'avantage de PostgreSQL.
--
-- La premiere : le decoupage « garantir la ligne a zero, puis appliquer le
-- delta » etait impose par SQLite, qui evalue les CHECK sur la ligne PROPOSEE
-- avant de resoudre le conflit d'unicite — une sortie heurtait alors
-- CHECK(quantite_kg >= 0) alors meme que le solde final restait positif.
-- PostgreSQL n'a pas ce defaut, mais le decoupage est conserve : il se lit bien,
-- et le changer sans necessite ferait perdre la comparaison avec l'original.
--
-- La seconde, et elle compte : `round(x, 4)` s'applique ici a du `numeric`, pas
-- a du flottant. L'arrondi du CMUP devient exact au lieu d'etre une correction
-- de representation. C'est le gain concret du passage a `numeric`.
--
-- Le type et le magasin du mouvement sont lus UNE fois en variables plutot que
-- six fois en sous-requetes : PL/pgSQL le permet, et l'original repetait la
-- meme jointure a chaque colonne faute de pouvoir faire autrement.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_trg_lmvt_appliquer() RETURNS trigger AS $$
DECLARE
    v_magasin       text;
    v_date          text;
    v_signe         integer;
    v_impacte_cmup  smallint;
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

    -- (a2) appliquer le delta signe, puis le CMUP si entree valorisee (R04)
    UPDATE stock_magasin
       SET cmup_mad = CASE
               WHEN v_impacte_cmup = 1
                AND NEW.prix_kg_mad IS NOT NULL
                AND quantite_kg + NEW.quantite_kg > 0
               THEN round(( quantite_kg * COALESCE(cmup_mad, NEW.prix_kg_mad)
                          + NEW.quantite_kg * NEW.prix_kg_mad )
                          / (quantite_kg + NEW.quantite_kg), 4)
               ELSE cmup_mad
           END,
           quantite_kg = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
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
                               prix_entree_mad, date_fabrication, date_peremption)
        VALUES (NEW.code_reference, v_magasin, NEW.lot_fournisseur, 0,
                NEW.prix_kg_mad, NEW.date_fabrication, NEW.date_peremption)
        ON CONFLICT (code_reference, code_magasin, lot_fournisseur) DO NOTHING;

        UPDATE stock_lot
           SET quantite_kg      = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
               prix_entree_mad  = COALESCE(prix_entree_mad, NEW.prix_kg_mad),
               date_fabrication = COALESCE(date_fabrication, NEW.date_fabrication),
               date_peremption  = COALESCE(date_peremption, NEW.date_peremption),
               date_maj         = v_maintenant
         WHERE code_reference  = NEW.code_reference
           AND lot_fournisseur = NEW.lot_fournisseur
           AND code_magasin    = v_magasin;
    END IF;

    -- (c) CMUP consolide tous magasins sur la fiche reference (RG-08)
    IF v_impacte_cmup = 1 THEN
        UPDATE reference
           SET cmup_mad = (
                   SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                     FROM stock_magasin sm
                    WHERE sm.code_reference = NEW.code_reference
                      AND sm.quantite_kg > 0
                      AND sm.cmup_mad IS NOT NULL),
               date_dernier_cmup = v_maintenant
         WHERE code_reference = NEW.code_reference;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_appliquer
AFTER INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_appliquer();
