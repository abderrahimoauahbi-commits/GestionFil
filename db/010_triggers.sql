-- =============================================================================
-- TRIGGERS D'INVARIANTS
-- =============================================================================
-- REPARTITION DES RESPONSABILITES (ADR-001 D-04) :
--   BASE   -> invariants indiscutables : solde de stock, CMUP, immuabilite,
--             transitions d'etats, verrous, audit. Vrais quel que soit le
--             chemin d'appel, y compris une correction SQL a la main.
--   RUST   -> orchestration : cascade reception 3-en-1, transfert, cloture
--             d'inventaire, calcul MRP, plan d'achat, ABC/XYZ.
--
-- Le CDC placait les cascades dans des triggers PL/pgSQL a boucles FOR. Sous
-- SQLite ces boucles n'existent pas, et surtout : une cascade est une
-- orchestration metier, pas un invariant. Elle appartient au service.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- =============================================================================
-- 1. MOUVEMENTS DE STOCK  (coeur du systeme)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 Garde : mouvement date dans le futur (CDC C06)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_mouvement_date_future
BEFORE INSERT ON mouvement
FOR EACH ROW
WHEN NEW.date_mouvement > strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN
    SELECT RAISE(ABORT, 'C06 : un mouvement ne peut pas etre date dans le futur.');
END;

-- -----------------------------------------------------------------------------
-- 1.2 Garde : prix obligatoire sur les entrees valorisees (RG-07 / R04)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_lmvt_prix_requis
BEFORE INSERT ON ligne_mouvement
FOR EACH ROW
WHEN NEW.prix_kg_mad IS NULL
 AND (SELECT tm.exige_prix FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1
BEGIN
    SELECT RAISE(ABORT, 'RG-07 : prix_kg_mad (en MAD) obligatoire pour ce type de mouvement.');
END;

-- -----------------------------------------------------------------------------
-- 1.3 Garde : numero d'OF obligatoire sur les sorties production (CDC C07)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_lmvt_of_requis
BEFORE INSERT ON ligne_mouvement
FOR EACH ROW
WHEN COALESCE(NEW.numero_of, (SELECT numero_of FROM mouvement WHERE id_mouvement = NEW.id_mouvement)) IS NULL
 AND (SELECT tm.exige_of FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1
BEGIN
    SELECT RAISE(ABORT, 'C07 : numero d''OF obligatoire pour une sortie production.');
END;

-- -----------------------------------------------------------------------------
-- 1.4 Garde : motif de ligne obligatoire sur les retours (CDC C08)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_lmvt_motif_requis
BEFORE INSERT ON ligne_mouvement
FOR EACH ROW
WHEN NEW.code_motif_ligne IS NULL
 AND (SELECT tm.exige_motif_ligne FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1
BEGIN
    SELECT RAISE(ABORT, 'C08 : motif de ligne (R1-R6) obligatoire pour un retour.');
END;

-- -----------------------------------------------------------------------------
-- 1.5 Garde : lot obligatoire pour les references sous suivi de lot
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_lmvt_lot_requis
BEFORE INSERT ON ligne_mouvement
FOR EACH ROW
WHEN NEW.lot_fournisseur IS NULL
 AND (SELECT suivi_lot FROM reference WHERE code_reference = NEW.code_reference) = 1
BEGIN
    SELECT RAISE(ABORT, 'Tracabilite : lot_fournisseur obligatoire pour cette reference (suivi_lot = 1).');
END;

-- -----------------------------------------------------------------------------
-- 1.6 Garde : stock suffisant (R02)
-- CORRECTION CDC : le trigger J2 du CDC testait `NEW.quantite_kg < 0` en
-- BEFORE UPDATE sur stock_magasin, ce que la contrainte CHECK faisait deja.
-- Il ne traitait donc PAS le vrai cas : refuser la SORTIE elle-meme, au moment
-- de son enregistrement, avec un message metier.
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_lmvt_stock_suffisant
BEFORE INSERT ON ligne_mouvement
FOR EACH ROW
WHEN (SELECT tm.signe FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = -1
 AND NEW.quantite_kg > COALESCE((
        SELECT sm.quantite_kg FROM stock_magasin sm
        WHERE sm.code_reference = NEW.code_reference
          AND sm.code_magasin = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
     ), 0) + 0.0001
BEGIN
    SELECT RAISE(ABORT, 'R02 : stock insuffisant dans ce magasin. Sortie refusee — regulariser par inventaire ou mouvement inverse.');
END;

-- -----------------------------------------------------------------------------
-- 1.7 Garde : stock de LOT suffisant
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_lmvt_stock_lot_suffisant
BEFORE INSERT ON ligne_mouvement
FOR EACH ROW
WHEN NEW.lot_fournisseur IS NOT NULL
 AND (SELECT tm.signe FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = -1
 AND NEW.quantite_kg > COALESCE((
        SELECT sl.quantite_kg FROM stock_lot sl
        WHERE sl.code_reference = NEW.code_reference
          AND sl.lot_fournisseur = NEW.lot_fournisseur
          AND sl.code_magasin = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
     ), 0) + 0.0001
BEGIN
    SELECT RAISE(ABORT, 'R02 : quantite insuffisante sur ce lot dans ce magasin.');
END;

-- -----------------------------------------------------------------------------
-- 1.8 APPLICATION DU MOUVEMENT  (correction BL-1)
--
-- Un seul trigger, donc un ordre d'execution garanti :
--   a) solde + CMUP par magasin
--   b) solde par lot
--   c) CMUP consolide sur la fiche reference
--
-- Le CMUP n'est recalcule que si type_mouvement.impacte_cmup = 1, c'est-a-dire
-- uniquement sur les entrees valorisees (R04). Les sorties ne le modifient pas.
-- -----------------------------------------------------------------------------
-- NOTE SQLite : on ne peut pas ecrire ceci en un seul UPSERT.
-- SQLite evalue les contraintes CHECK sur la ligne PROPOSEE avant de resoudre
-- le conflit d'unicite : pour une sortie, la quantite negative proposee heurte
-- CHECK(quantite_kg >= 0) et la transaction echoue alors meme que le solde
-- final serait positif. D'ou le decoupage "garantir la ligne, puis appliquer
-- le delta".
CREATE TRIGGER trg_lmvt_appliquer
AFTER INSERT ON ligne_mouvement
FOR EACH ROW
BEGIN
    -- (a1) garantir l'existence de la ligne de solde, a zero
    INSERT INTO stock_magasin (code_reference, code_magasin, quantite_kg, cmup_mad)
    SELECT NEW.code_reference, m.code_magasin, 0, NULL
    FROM mouvement m
    WHERE m.id_mouvement = NEW.id_mouvement
    ON CONFLICT (code_reference, code_magasin) DO NOTHING;

    -- (a2) appliquer le delta signe, puis le CMUP si entree valorisee (R04)
    UPDATE stock_magasin
    SET cmup_mad = CASE
            WHEN (SELECT tm.impacte_cmup FROM mouvement m
                  JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
                  WHERE m.id_mouvement = NEW.id_mouvement) = 1
             AND NEW.prix_kg_mad IS NOT NULL
             AND quantite_kg + NEW.quantite_kg > 0
            THEN ROUND(
                   ( quantite_kg * COALESCE(cmup_mad, NEW.prix_kg_mad)
                   + NEW.quantite_kg * NEW.prix_kg_mad )
                   / (quantite_kg + NEW.quantite_kg), 4)
            ELSE cmup_mad
        END,
        quantite_kg = ROUND(quantite_kg
            + (SELECT tm.signe FROM mouvement m
               JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
               WHERE m.id_mouvement = NEW.id_mouvement) * NEW.quantite_kg, 4),
        date_derniere_entree = CASE
            WHEN (SELECT tm.signe FROM mouvement m
                  JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
                  WHERE m.id_mouvement = NEW.id_mouvement) = 1
            THEN (SELECT date_mouvement FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
            ELSE date_derniere_entree END,
        date_derniere_sortie = CASE
            WHEN (SELECT tm.signe FROM mouvement m
                  JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
                  WHERE m.id_mouvement = NEW.id_mouvement) = -1
            THEN (SELECT date_mouvement FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
            ELSE date_derniere_sortie END,
        date_maj = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE code_reference = NEW.code_reference
      AND code_magasin = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement);

    -- (b1) garantir l'existence de la ligne de lot, a zero
    INSERT INTO stock_lot (code_reference, code_magasin, lot_fournisseur, quantite_kg,
                           prix_entree_mad, date_fabrication, date_peremption)
    SELECT NEW.code_reference, m.code_magasin, NEW.lot_fournisseur, 0,
           NEW.prix_kg_mad, NEW.date_fabrication, NEW.date_peremption
    FROM mouvement m
    WHERE m.id_mouvement = NEW.id_mouvement
      AND NEW.lot_fournisseur IS NOT NULL
    ON CONFLICT (code_reference, code_magasin, lot_fournisseur) DO NOTHING;

    -- (b2) appliquer le delta sur le lot
    UPDATE stock_lot
    SET quantite_kg = ROUND(quantite_kg
            + (SELECT tm.signe FROM mouvement m
               JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
               WHERE m.id_mouvement = NEW.id_mouvement) * NEW.quantite_kg, 4),
        prix_entree_mad  = COALESCE(prix_entree_mad, NEW.prix_kg_mad),
        date_fabrication = COALESCE(date_fabrication, NEW.date_fabrication),
        date_peremption  = COALESCE(date_peremption, NEW.date_peremption),
        date_maj = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE NEW.lot_fournisseur IS NOT NULL
      AND code_reference  = NEW.code_reference
      AND lot_fournisseur = NEW.lot_fournisseur
      AND code_magasin    = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement);

    -- (c) CMUP consolide tous magasins sur la fiche reference (RG-08)
    UPDATE reference
    SET cmup_mad = (
            SELECT ROUND(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
            FROM stock_magasin sm
            WHERE sm.code_reference = NEW.code_reference
              AND sm.quantite_kg > 0
              AND sm.cmup_mad IS NOT NULL
        ),
        date_dernier_cmup = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE code_reference = NEW.code_reference
      AND (SELECT tm.impacte_cmup FROM mouvement m
           JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
           WHERE m.id_mouvement = NEW.id_mouvement) = 1;
END;

-- =============================================================================
-- 2. IMMUABILITE DE L'HISTORIQUE  (R03)
-- =============================================================================
-- CORRECTION CDC : R03 declarait "pas de DELETE/UPDATE sur mouvements,
-- receptions, archives" sans AUCUN mecanisme d'application.
--
-- TROIS VERBES, PAS DEUX. Interdire UPDATE et DELETE ne suffit pas :
-- `INSERT OR REPLACE` reecrit une ligne existante en une seule instruction.
-- SQLite y resout le conflit par un DELETE implicite suivi d'un INSERT, et ce
-- DELETE ne declenche PAS les triggers de suppression tant que
-- `recursive_triggers` est desactive — ce qu'il est, volontairement, parce que
-- l'historisation des parametres en depend (cf. backend/src/db.rs).
--
-- La parade ne touche donc pas au pragma : chaque table immuable refuse un
-- INSERT dont la cle existe deja. Un INSERT ordinaire en doublon echouerait de
-- toute facon sur la cle primaire ; ce garde ne se declenche que sur les
-- chemins de remplacement, et il les nomme.
-- =============================================================================

CREATE TRIGGER trg_mouvement_immuable_r
BEFORE INSERT ON mouvement FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
BEGIN SELECT RAISE(ABORT, 'R03 : remplacement interdit dans le grand livre des mouvements. Corriger par un mouvement inverse.'); END;

CREATE TRIGGER trg_lmvt_immuable_r
BEFORE INSERT ON ligne_mouvement FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM ligne_mouvement WHERE id_ligne_mouvement = NEW.id_ligne_mouvement)
BEGIN SELECT RAISE(ABORT, 'R03 : remplacement interdit sur une ligne de mouvement.'); END;

CREATE TRIGGER trg_archive_immuable_r
BEFORE INSERT ON archive_reception FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM archive_reception WHERE id_archive = NEW.id_archive)
BEGIN SELECT RAISE(ABORT, 'R03 : remplacement interdit sur une archive de reception.'); END;

CREATE TRIGGER trg_histo_prix_immuable_r
BEFORE INSERT ON historique_prix FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM historique_prix WHERE id_histo_prix = NEW.id_histo_prix)
BEGIN SELECT RAISE(ABORT, 'R03 : remplacement interdit dans l historique des prix.'); END;

CREATE TRIGGER trg_param_histo_immuable_r
BEFORE INSERT ON parametre_historique FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM parametre_historique WHERE id_histo_param = NEW.id_histo_param)
BEGIN SELECT RAISE(ABORT, 'R03 : remplacement interdit dans l historique des parametres.'); END;

CREATE TRIGGER trg_audit_immuable_r
BEFORE INSERT ON audit_log FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM audit_log WHERE id_audit = NEW.id_audit)
BEGIN SELECT RAISE(ABORT, 'R03 : remplacement interdit dans le journal d audit.'); END;

CREATE TRIGGER trg_mouvement_immuable_u
BEFORE UPDATE ON mouvement FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : le grand livre des mouvements est immuable. Corriger par un mouvement inverse.'); END;

CREATE TRIGGER trg_mouvement_immuable_d
BEFORE DELETE ON mouvement FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : suppression interdite dans le grand livre des mouvements.'); END;

CREATE TRIGGER trg_lmvt_immuable_u
BEFORE UPDATE ON ligne_mouvement FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : les lignes de mouvement sont immuables.'); END;

CREATE TRIGGER trg_lmvt_immuable_d
BEFORE DELETE ON ligne_mouvement FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : suppression interdite sur les lignes de mouvement.'); END;

CREATE TRIGGER trg_archive_immuable_u
BEFORE UPDATE ON archive_reception FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : l''archive de reception est figee.'); END;

CREATE TRIGGER trg_archive_immuable_d
BEFORE DELETE ON archive_reception FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : suppression interdite sur l''archive de reception.'); END;

CREATE TRIGGER trg_histo_prix_immuable_u
BEFORE UPDATE ON historique_prix FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : l''historique des prix est immuable (base du CMUP).'); END;

CREATE TRIGGER trg_histo_prix_immuable_d
BEFORE DELETE ON historique_prix FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : suppression interdite sur l''historique des prix.'); END;

CREATE TRIGGER trg_param_histo_immuable_u
BEFORE UPDATE ON parametre_historique FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : l''historique des parametres est immuable.'); END;

CREATE TRIGGER trg_param_histo_immuable_d
BEFORE DELETE ON parametre_historique FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'R03 : suppression interdite sur l''historique des parametres.'); END;

CREATE TRIGGER trg_audit_immuable_u
BEFORE UPDATE ON audit_log FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Le journal d''audit est immuable.'); END;

CREATE TRIGGER trg_audit_immuable_d
BEFORE DELETE ON audit_log FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Suppression interdite dans le journal d''audit.'); END;

-- =============================================================================
-- 3. PARAMETRES  (CDC E1 / J5)
-- =============================================================================

-- Parametre verrouille (ex. P_DateSaisie, figee au 27/04/2026 par le CDC B1).
-- Le CDC declarait le verrou sans jamais l'implementer.
CREATE TRIGGER trg_parametre_verrouille
BEFORE UPDATE OF valeur_courante ON parametre
FOR EACH ROW
WHEN OLD.verrouille = 1 AND OLD.valeur_courante IS NOT NEW.valeur_courante
BEGIN
    SELECT RAISE(ABORT, 'Parametre verrouille : sa valeur est figee et ne peut pas etre modifiee.');
END;

CREATE TRIGGER trg_parametre_historiser
AFTER UPDATE OF valeur_courante ON parametre
FOR EACH ROW
WHEN OLD.valeur_courante IS NOT NEW.valeur_courante
BEGIN
    INSERT INTO parametre_historique (code_parametre, ancienne_valeur, nouvelle_valeur,
                                      id_utilisateur, motif, ip_adresse)
    VALUES (NEW.code_parametre, OLD.valeur_courante, NEW.valeur_courante,
            COALESCE(NEW.id_utilisateur_modif, (SELECT id_utilisateur FROM _contexte_session WHERE id = 1)),
            NEW.motif_modif,
            (SELECT adresse_ip FROM _contexte_session WHERE id = 1));

    UPDATE parametre
    SET date_derniere_modif = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE code_parametre = NEW.code_parametre;
END;

-- =============================================================================
-- 4. TAUX DE CHANGE  (RG-09)
-- =============================================================================
-- CORRECTION CDC : aucune contrainte n'empechait deux taux valides simultanement
-- pour une meme devise. Le trigger J4 lisait ensuite `LIMIT 1` SANS ORDER BY :
-- le taux retenu etait non deterministe.
-- =============================================================================

CREATE TRIGGER trg_taux_change_chevauchement
BEFORE INSERT ON taux_change
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM taux_change t
    WHERE t.code_devise = NEW.code_devise
      AND NEW.date_debut < COALESCE(t.date_fin, '9999-12-31')
      AND COALESCE(NEW.date_fin, '9999-12-31') > t.date_debut)
BEGIN
    SELECT RAISE(ABORT, 'RG-09 : periodes de taux de change chevauchantes pour cette devise.');
END;

-- La devise pivot vaut toujours 1 (MAD -> MAD).
CREATE TRIGGER trg_taux_pivot
BEFORE INSERT ON taux_change
FOR EACH ROW
WHEN (SELECT est_pivot FROM devise WHERE code_devise = NEW.code_devise) = 1
 AND NEW.taux <> 1.0
BEGIN
    SELECT RAISE(ABORT, 'La devise pivot doit avoir un taux de 1.');
END;

-- =============================================================================
-- 5. MACHINE A ETATS  (correction : transitions arriere non gardees)
-- =============================================================================
-- Sans ces gardes, repasser une reception de CLOTURE a VALIDE rejouait toute la
-- cascade et comptait le stock une seconde fois.
-- =============================================================================

CREATE TRIGGER trg_transition_qualite
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
WHEN OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'qualite' AND statut_source = OLD.statut AND statut_cible = NEW.statut)
BEGIN SELECT RAISE(ABORT, 'Transition de statut interdite sur la qualite.'); END;

CREATE TRIGGER trg_transition_plan
BEFORE UPDATE OF statut ON plan_production FOR EACH ROW
WHEN OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'plan_production' AND statut_source = OLD.statut AND statut_cible = NEW.statut)
BEGIN SELECT RAISE(ABORT, 'Transition de statut interdite sur le plan de production.'); END;

CREATE TRIGGER trg_transition_bc
BEFORE UPDATE OF statut ON bon_commande FOR EACH ROW
WHEN OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'bon_commande' AND statut_source = OLD.statut AND statut_cible = NEW.statut)
BEGIN SELECT RAISE(ABORT, 'Transition de statut interdite sur le bon de commande.'); END;

CREATE TRIGGER trg_transition_reception
BEFORE UPDATE OF statut ON reception FOR EACH ROW
WHEN OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'reception' AND statut_source = OLD.statut AND statut_cible = NEW.statut)
BEGIN SELECT RAISE(ABORT, 'Transition de statut interdite sur la reception.'); END;

CREATE TRIGGER trg_transition_transfert
BEFORE UPDATE OF statut ON transfert FOR EACH ROW
WHEN OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'transfert' AND statut_source = OLD.statut AND statut_cible = NEW.statut)
BEGIN SELECT RAISE(ABORT, 'Transition de statut interdite sur le transfert.'); END;

CREATE TRIGGER trg_transition_inventaire
BEFORE UPDATE OF statut ON inventaire FOR EACH ROW
WHEN OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'inventaire' AND statut_source = OLD.statut AND statut_cible = NEW.statut)
BEGIN SELECT RAISE(ABORT, 'Transition de statut interdite sur l''inventaire.'); END;

-- =============================================================================
-- 6. COMPOSITION DES QUALITES  (R07, R08)
--
-- Une qualite = une composition. Il n'y a plus ni statut de recette, ni clonage
-- en V+1 : c'est le passage de la QUALITE a ACTIF qui controle la composition,
-- et c'est l'appartenance a un plan actif qui la verrouille.
-- =============================================================================

-- 6.1 R07 : somme des pourcentages = 100 % par role BOM.
-- Une contrainte CHECK ne peut pas porter d'agregat : le controle a lieu au
-- moment ou la qualite est mise en service.
CREATE TRIGGER trg_qualite_activer_somme
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
WHEN NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
    GROUP BY r.code_role
    HAVING abs(SUM(r.pourcentage_composition) - 100.0) > 0.5)
BEGIN
    SELECT RAISE(ABORT, 'R07 : la somme des pourcentages de composition doit valoir 100% pour chaque role BOM.');
END;

-- 6.2 Une qualite sans composition ne peut pas etre mise en service : elle
-- produirait un besoin matiere nul en silence.
CREATE TRIGGER trg_qualite_activer_non_vide
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
WHEN NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND NOT EXISTS (SELECT 1 FROM recette WHERE code_qualite = NEW.code_qualite AND actif = 1)
BEGIN SELECT RAISE(ABORT, 'Une qualite sans ligne de composition ne peut pas etre mise en service.'); END;

-- 6.3 GARDE ANTI-BESOIN-NUL (correction du fallback silencieux de la vue I4)
-- Tout role utilise par la composition doit porter une densite sur la qualite.
-- Sans cela, le MRP produisait un besoin de 0 kg en silence via COALESCE(...,0).
CREATE TRIGGER trg_qualite_activer_roles
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
WHEN NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
      AND NOT EXISTS (SELECT 1 FROM ligne_qualite lq
                      WHERE lq.code_qualite = NEW.code_qualite
                        AND lq.code_role = r.code_role
                        AND lq.actif = 1))
BEGIN
    SELECT RAISE(ABORT, 'Role BOM sans densite definie sur la qualite : le MRP calculerait un besoin nul en silence.');
END;

-- 6.4 Un role exprime en ml/m2 exige une densite_kg_ml sur chaque reference (R01)
CREATE TRIGGER trg_qualite_activer_densite_ml
BEFORE UPDATE OF statut ON qualite FOR EACH ROW
WHEN NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    JOIN ligne_qualite lq ON lq.code_qualite = NEW.code_qualite AND lq.code_role = r.code_role
    JOIN reference ref    ON ref.code_reference = r.code_reference
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
      AND lq.unite_densite = 'ml_m2' AND ref.densite_kg_ml IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'R01 : role en ml/m2 — densite_kg_ml obligatoire sur la reference pour convertir en kg.');
END;

-- 6.5 VERROU : la composition d'une qualite produite par un plan actif est
-- immuable. Le plan a arrete sa base de calcul ; la modifier changerait
-- retroactivement des besoins deja arretes. La regle remplace RG-04/RG-05 :
-- pour changer une composition en service, on cree une nouvelle qualite.
CREATE TRIGGER trg_recette_verrou_plan_i
BEFORE INSERT ON recette FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = NEW.code_qualite AND pp.statut = 'EN_COURS')
BEGIN
    SELECT RAISE(ABORT, 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.');
END;

CREATE TRIGGER trg_recette_verrou_plan_u
BEFORE UPDATE ON recette FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = OLD.code_qualite AND pp.statut = 'EN_COURS')
BEGIN
    SELECT RAISE(ABORT, 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.');
END;

CREATE TRIGGER trg_recette_verrou_plan_d
BEFORE DELETE ON recette FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = OLD.code_qualite AND pp.statut = 'EN_COURS')
BEGIN
    SELECT RAISE(ABORT, 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.');
END;

-- 6.6 Une qualite ne peut etre produite que par UN plan actif a la fois.
-- Deux plans non clotures portant la meme qualite additionneraient leurs besoins
-- sur les memes matieres : le plan d'achat commanderait la quantite en double.
CREATE TRIGGER trg_plan_qualite_exclusive_i
BEFORE INSERT ON plan_qualite FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM plan_qualite pq
    JOIN plan_production pp ON pp.id_plan = pq.id_plan
    WHERE pq.code_qualite = NEW.code_qualite
      AND pq.id_plan <> NEW.id_plan
      AND pp.statut <> 'CLOTURE')
BEGIN
    SELECT RAISE(ABORT, 'Cette qualite figure deja dans un autre plan actif : un plan doit etre cloture avant que sa qualite soit reprise ailleurs.');
END;

-- Jumeau sur UPDATE. Sans lui, on inserait la qualite libre A dans le plan,
-- puis on la changeait en B deja planifiee ailleurs : le besoin de B se
-- trouvait compte deux fois, et le plan d'achat commandait le double.
--
-- La ligne en cours de modification s'exclut d'elle-meme : sans cette clause,
-- DEPLACER une qualite d'un plan a l'autre — donc changer son id_plan — se
-- heurterait a sa propre presence dans le plan qu'elle quitte, et le
-- deplacement, qui est legitime, deviendrait impossible.
CREATE TRIGGER trg_plan_qualite_exclusive_u
BEFORE UPDATE OF code_qualite, id_plan ON plan_qualite FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM plan_qualite pq
    JOIN plan_production pp ON pp.id_plan = pq.id_plan
    WHERE pq.code_qualite = NEW.code_qualite
      AND pq.id_plan <> NEW.id_plan
      AND NOT (pq.id_plan = OLD.id_plan AND pq.code_qualite = OLD.code_qualite)
      AND pp.statut <> 'CLOTURE')
BEGIN
    SELECT RAISE(ABORT, 'Cette qualite figure deja dans un autre plan actif : un plan doit etre cloture avant que sa qualite soit reprise ailleurs.');
END;

-- 6.7 R08 : seule une qualite ACTIVE, donc dont la composition a passe les
-- controles, peut etre retenue par un plan.
CREATE TRIGGER trg_plan_qualite_active_i
BEFORE INSERT ON plan_qualite FOR EACH ROW
WHEN (SELECT statut FROM qualite WHERE code_qualite = NEW.code_qualite) <> 'ACTIF'
BEGIN
    SELECT RAISE(ABORT, 'R08 : seule une qualite ACTIVE peut etre retenue par un plan.');
END;

-- Jumeau sur UPDATE. Une garde posee sur le seul INSERT se contourne en
-- inserant une ligne acceptable puis en la modifiant : deux instructions au
-- lieu d'une, et la regle ne voit rien passer. Les deux verbes doivent porter
-- le meme refus.
CREATE TRIGGER trg_plan_qualite_active_u
BEFORE UPDATE OF code_qualite ON plan_qualite FOR EACH ROW
WHEN (SELECT statut FROM qualite WHERE code_qualite = NEW.code_qualite) <> 'ACTIF'
BEGIN
    SELECT RAISE(ABORT, 'R08 : seule une qualite ACTIVE peut etre retenue par un plan.');
END;

-- 6.8 R08 : un plan ne peut entrer en service sans qualite retenue pour chaque
-- ligne planifiee.
CREATE TRIGGER trg_plan_valider_recettes
BEFORE UPDATE OF statut ON plan_production FOR EACH ROW
WHEN NEW.statut = 'EN_COURS' AND OLD.statut <> 'EN_COURS'
 AND EXISTS (
    SELECT 1 FROM ligne_plan_production lpp
    WHERE lpp.id_plan = NEW.id_plan AND lpp.m2_prevus > 0
      AND NOT EXISTS (SELECT 1 FROM plan_qualite pq
                      WHERE pq.id_plan = NEW.id_plan AND pq.code_qualite = lpp.code_qualite))
BEGIN
    SELECT RAISE(ABORT, 'R08 : chaque qualite planifiee doit figurer dans l''entete du plan (table plan_qualite) avant mise en service.');
END;

-- =============================================================================
-- 7. RECEPTIONS  (B4 regle 2 : SoD acheteur / controleur)
-- =============================================================================

-- L'acheteur qui a cree le BC ne peut pas controler la reception correspondante.
CREATE TRIGGER trg_reception_sod_acheteur
BEFORE UPDATE OF statut ON reception FOR EACH ROW
WHEN NEW.statut = 'VALIDE'
 AND NEW.id_utilisateur_controle IS NOT NULL
 AND NEW.id_utilisateur_controle = (SELECT id_utilisateur_creation FROM bon_commande WHERE id_bc = NEW.id_bc)
BEGIN
    SELECT RAISE(ABORT, 'B4 regle 2 : le createur du bon de commande ne peut pas controler sa propre reception.');
END;

-- Routage quarantaine : une ligne non conforme doit aller en zone de quarantaine.
CREATE TRIGGER trg_ligne_reception_quarantaine
BEFORE INSERT ON ligne_reception FOR EACH ROW
WHEN NEW.statut_qualite IN ('NON_CONFORME','QUARANTAINE')
 AND (SELECT est_quarantaine FROM magasin WHERE code_magasin = NEW.code_magasin_dest) = 0
BEGIN
    SELECT RAISE(ABORT, 'Une ligne non conforme ou en quarantaine doit etre dirigee vers un magasin de quarantaine.');
END;

-- Substitution : la reference recue differe de la reference commandee.
--
-- Le schema ne l'interdisait pas et rien ne le signalait : on pouvait solder
-- n'importe quelle ligne de commande avec n'importe quelle matiere, et le
-- besoin d'origine restait entier pendant que le stock d'une autre reference
-- montait. Personne ne le voyait avant l'inventaire.
--
-- Deux conditions, desormais, et les deux sont necessaires :
--   * l'operateur CONFIRME (substitution_acceptee = 1) — l'ecart ne peut plus
--     etre le resultat d'une faute de frappe ;
--   * les deux references partagent un groupe d'equivalence ACTIF et sont
--     techniquement interchangeables — meme unite, meme densite, meme categorie.
--     Sans cette seconde condition, la confirmation autoriserait n'importe quoi.
CREATE TRIGGER trg_ligne_reception_substitution
BEFORE INSERT ON ligne_reception FOR EACH ROW
WHEN NEW.id_ligne_bc IS NOT NULL
 AND NEW.code_reference <> (SELECT code_reference FROM ligne_bc
                             WHERE id_ligne_bc = NEW.id_ligne_bc)
 AND (NEW.substitution_acceptee = 0
      OR NOT EXISTS (
          SELECT 1 FROM v_equivalence e
           WHERE e.code_reference = (SELECT code_reference FROM ligne_bc
                                      WHERE id_ligne_bc = NEW.id_ligne_bc)
             AND e.equivalent_reference = NEW.code_reference
             AND e.interchangeable = 1))
BEGIN
    -- RAISE n'accepte qu'un LITTERAL : une concatenation est acceptee a
    -- l'ecriture puis rend le schema illisible a la relecture. Le message tient
    -- donc sur une seule chaine, quelle que soit sa longueur.
    SELECT RAISE(ABORT, 'Reference recue differente de la reference commandee. Elle n''est acceptable que si les deux references appartiennent au meme groupe d''equivalence, sont interchangeables (meme unite, meme densite, meme categorie), et que la substitution est explicitement confirmee.');
END;

-- Ecart de pesee hors tolerance : derogation nominative obligatoire (E6).
CREATE TRIGGER trg_ligne_reception_ecart
BEFORE INSERT ON ligne_reception FOR EACH ROW
WHEN NEW.quantite_commandee_kg IS NOT NULL
 AND NEW.derogation_ecart = 0
 AND abs((NEW.quantite_stock_kg - NEW.quantite_commandee_kg) / NEW.quantite_commandee_kg * 100.0) >
     COALESCE(
        (SELECT f.tolerance_pesee_pct FROM reception rc
         JOIN fournisseur f ON f.code_fournisseur = rc.code_fournisseur
         WHERE rc.id_reception = NEW.id_reception),
        (SELECT CAST(valeur_courante AS REAL) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee'))
BEGIN
    SELECT RAISE(ABORT, 'C10 : ecart de pesee hors tolerance. Une derogation tracee est requise (derogation_ecart = 1).');
END;

-- =============================================================================
-- 8. JOURNAL D'AUDIT  (A3 : 100% des actions tracees)
-- =============================================================================
-- Le CDC creait audit_log sans jamais l'alimenter. Les triggers ci-dessous
-- couvrent les entites a enjeu : parametres, prix, droits, engagements.
-- =============================================================================

CREATE TRIGGER trg_audit_parametre
AFTER UPDATE ON parametre FOR EACH ROW
WHEN OLD.valeur_courante IS NOT NEW.valeur_courante
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('parametre', 'UPDATE', NEW.code_parametre,
            json_object('valeur_courante', OLD.valeur_courante),
            json_object('valeur_courante', NEW.valeur_courante),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_reference
AFTER UPDATE ON reference FOR EACH ROW
WHEN OLD.prix_catalogue IS NOT NEW.prix_catalogue
  OR OLD.code_fournisseur IS NOT NEW.code_fournisseur
  OR OLD.actif IS NOT NEW.actif
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('reference', 'UPDATE', NEW.code_reference,
            json_object('prix_catalogue', OLD.prix_catalogue, 'code_fournisseur', OLD.code_fournisseur, 'actif', OLD.actif),
            json_object('prix_catalogue', NEW.prix_catalogue, 'code_fournisseur', NEW.code_fournisseur, 'actif', NEW.actif),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_bc_statut
AFTER UPDATE OF statut ON bon_commande FOR EACH ROW
WHEN OLD.statut IS NOT NEW.statut
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('bon_commande', 'UPDATE', NEW.id_bc,
            json_object('statut', OLD.statut),
            json_object('statut', NEW.statut, 'montant_total_mad', NEW.montant_total_mad,
                        'id_utilisateur_validation', NEW.id_utilisateur_validation),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_reception_statut
AFTER UPDATE OF statut ON reception FOR EACH ROW
WHEN OLD.statut IS NOT NEW.statut
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('reception', 'UPDATE', NEW.id_reception,
            json_object('statut', OLD.statut),
            json_object('statut', NEW.statut, 'id_utilisateur_controle', NEW.id_utilisateur_controle),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_qualite_statut
AFTER UPDATE OF statut ON qualite FOR EACH ROW
WHEN OLD.statut IS NOT NEW.statut
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('qualite', 'UPDATE', NEW.code_qualite,
            json_object('statut', OLD.statut),
            json_object('statut', NEW.statut, 'nom', NEW.nom),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_plan_statut
AFTER UPDATE OF statut ON plan_production FOR EACH ROW
WHEN OLD.statut IS NOT NEW.statut
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('plan_production', 'UPDATE', NEW.id_plan,
            json_object('statut', OLD.statut),
            json_object('statut', NEW.statut, 'annee', NEW.annee, 'numero_version', NEW.numero_version),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_utilisateur
AFTER UPDATE ON utilisateur FOR EACH ROW
WHEN OLD.code_role_user IS NOT NEW.code_role_user OR OLD.actif IS NOT NEW.actif
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('utilisateur', 'UPDATE', NEW.id_utilisateur,
            json_object('code_role_user', OLD.code_role_user, 'actif', OLD.actif),
            json_object('code_role_user', NEW.code_role_user, 'actif', NEW.actif),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

-- La visibilite des champs est une decision de securite : chaque changement est
-- trace nominativement, au meme titre qu'un changement de role.
CREATE TRIGGER trg_audit_droit_champ_i
AFTER INSERT ON droit_champ FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           nouvelles_valeurs, id_utilisateur, adresse_ip, session_id)
    VALUES ('droit_champ', 'INSERT', NEW.id_utilisateur,
            json_object('module', NEW.module, 'champ', NEW.champ, 'niveau', NEW.niveau),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_droit_champ_u
AFTER UPDATE OF niveau ON droit_champ FOR EACH ROW
WHEN OLD.niveau IS NOT NEW.niveau
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES ('droit_champ', 'UPDATE', NEW.id_utilisateur,
            json_object('module', NEW.module, 'champ', NEW.champ, 'niveau', OLD.niveau),
            json_object('module', NEW.module, 'champ', NEW.champ, 'niveau', NEW.niveau),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_permission_i
AFTER INSERT ON permission FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           nouvelles_valeurs, id_utilisateur, adresse_ip, session_id)
    VALUES ('permission', 'INSERT', NEW.id_permission,
            json_object('role', NEW.code_role_user, 'module', NEW.module, 'action', NEW.action),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;

CREATE TRIGGER trg_audit_permission_d
AFTER DELETE ON permission FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, id_utilisateur, adresse_ip, session_id)
    VALUES ('permission', 'DELETE', OLD.id_permission,
            json_object('role', OLD.code_role_user, 'module', OLD.module, 'action', OLD.action),
            (SELECT id_utilisateur FROM _contexte_session WHERE id = 1),
            (SELECT adresse_ip    FROM _contexte_session WHERE id = 1),
            (SELECT session_id    FROM _contexte_session WHERE id = 1));
END;
