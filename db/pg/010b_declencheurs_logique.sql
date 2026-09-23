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
                     current_setting('gestionfil.id_utilisateur', true)),
            NEW.motif_modif,
            current_setting('gestionfil.adresse_ip', true));

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
-- Le CMUP d'un magasin se MOYENNE aux entrees valorisees (R04) ; une sortie ne le
-- modifie jamais. Tant qu'aucun achat ne l'a fixe, il vaut le prix catalogue
-- (2026-09-17h), et la premiere reception moyenne avec lui.
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

-- LE PRIX CATALOGUE EN MAD (2026-09-17h) : prix catalogue au kg x taux de change
-- en vigueur. Sans taux, pas de prix. Il sert de CMUP tant qu'aucun achat n'a
-- valorise le stock, et de base a la moyenne de la premiere reception.
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

CREATE TRIGGER trg_lmvt_appliquer
AFTER INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_appliquer();


-- =============================================================================
-- 3. CAPACITE D'UN EMPLACEMENT DE MACHINE
-- -----------------------------------------------------------------------------
-- POURQUOI CE DECLENCHEUR EXISTE ALORS QUE LE SERVEUR VERIFIE DEJA.
--
-- Le backend calcule la place restante avant d'ouvrir la transaction, pour
-- pouvoir refuser avec une phrase que le magasinier comprend : « Etage 2 plein,
-- 200 places, 40 libres, vous en chargez 60 ». C'est le bon message, mais ce
-- n'est pas une garantie : il ne vaut que pour l'appelant qui prend la peine de
-- le demander. Ici la regle tient quel que soit l'appelant, y compris un
-- import, une reprise de donnees ou un psql ouvert un dimanche.
--
-- BEFORE INSERT, donc avant fn_trg_lmvt_appliquer qui est AFTER : la place est
-- lue sur l'etat courant du cache, et les lignes d'un meme document s'empilent
-- correctement puisque chaque ligne voit l'effet de la precedente.
--
-- Les trois roles — etage, chaine, trame — passent par le meme chemin. Le role
-- ne sert qu'au plan ; ici il ne sert a rien, et c'est voulu.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_trg_lmvt_capacite() RETURNS trigger AS $$
DECLARE
    v_empl  machine_emplacement%ROWTYPE;
    v_signe integer;
    v_apres bigint;
    v_max   bigint;
BEGIN
    IF COALESCE(NEW.nb_bobines, 0) = 0 THEN
        RETURN NEW;
    END IF;

    SELECT e.* INTO v_empl
      FROM machine_emplacement e
      JOIN mouvement m ON m.code_magasin = e.code_magasin
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- Magasin ordinaire : aucun plafond a faire respecter.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT tm.signe INTO v_signe
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- On ne deborde pas en retirant.
    IF v_signe < 0 THEN
        RETURN NEW;
    END IF;

    -- Plafond de l'emplacement. Le libelle genere donne un message que
    -- l'operateur reconnait : il lit « Chaine pleine », pas « MC1-CH plein ».
    SELECT COALESCE(SUM(nb_bobines), 0) INTO v_apres
      FROM stock_lot WHERE code_magasin = v_empl.code_magasin;

    IF v_apres + NEW.nb_bobines > v_empl.capacite_bobines THEN
        RAISE EXCEPTION 'C33 : % plein. Capacite % bobines, il y en aurait %.',
            v_empl.libelle, v_empl.capacite_bobines, v_apres + NEW.nb_bobines;
    END IF;

    -- Plafond de la machine, tous emplacements confondus.
    SELECT COALESCE(SUM(sl.nb_bobines), 0) INTO v_apres
      FROM stock_lot sl
      JOIN machine_emplacement e ON e.code_magasin = sl.code_magasin
     WHERE e.code_machine = v_empl.code_machine;

    SELECT capacite_bobines INTO v_max
      FROM machine WHERE code_machine = v_empl.code_machine;

    IF v_apres + NEW.nb_bobines > v_max THEN
        RAISE EXCEPTION 'C34 : machine % pleine. Capacite % bobines, il y en aurait %.',
            v_empl.code_machine, v_max, v_apres + NEW.nb_bobines;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lmvt_capacite
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_lmvt_capacite();


-- =============================================================================
-- 4. COHERENCE ENTRE UN ETAGE ET LE NOMBRE D'ETAGES DE SA MACHINE
-- -----------------------------------------------------------------------------
-- `numero_etage <= machine.nb_etages` porte sur deux tables : un CHECK ne sait
-- pas l'exprimer. Le declencheur garde les deux sens — on ne cree pas un etage
-- au-dela du compte declare, et on ne reduit pas le compte sous un etage qui
-- existe deja, ce qui rendrait la machine incoherente en silence.
--
-- La chaine et la trame portent le numero 0 et ne sont pas concernees : elles
-- ne sont pas des etages.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_trg_empl_numero() RETURNS trigger AS $$
DECLARE
    v_nb bigint;
BEGIN
    IF NEW.role <> 'ETAGE' THEN
        RETURN NEW;
    END IF;

    SELECT nb_etages INTO v_nb FROM machine WHERE code_machine = NEW.code_machine;

    IF NEW.numero_etage > v_nb THEN
        RAISE EXCEPTION 'La machine % declare % etages : l''etage % ne peut pas exister.',
            NEW.code_machine, v_nb, NEW.numero_etage;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empl_numero
BEFORE INSERT OR UPDATE ON machine_emplacement FOR EACH ROW
EXECUTE FUNCTION fn_trg_empl_numero();


CREATE OR REPLACE FUNCTION fn_trg_machine_nb_etages() RETURNS trigger AS $$
DECLARE
    v_haut bigint;
BEGIN
    SELECT COALESCE(MAX(numero_etage), 0) INTO v_haut
      FROM machine_emplacement
     WHERE code_machine = NEW.code_machine AND role = 'ETAGE';

    IF NEW.nb_etages < v_haut THEN
        RAISE EXCEPTION 'La machine % porte deja un etage % : son nombre d''etages ne peut pas descendre a %.',
            NEW.code_machine, v_haut, NEW.nb_etages;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_machine_nb_etages
BEFORE UPDATE OF nb_etages ON machine FOR EACH ROW
EXECUTE FUNCTION fn_trg_machine_nb_etages();
