-- =============================================================================
-- 2026-10-27e — Une seule source de vérité : le moteur de couverture
-- =============================================================================
-- ARBITRAGE DU 27/10/2026 (direction). Tout ce qui calcule un besoin, une
-- projection, une couverture ou une quantité à commander passe par le moteur de
-- couverture (`backend/src/domain/couverture.rs`, lu par `routes/couverture.rs`).
-- L'ANCIEN CALCUL EST RETIRÉ, il ne reste pas en parallèle :
--
--   * v_stock_projete (double déclencheur RUPTURE / CRITIQUE / ATTENTION / OK,
--     stock projeté = stock MRP net + en-cours fiable − demande pendant le délai),
--   * v_plan_achat (proposition « minimum − projeté », MOQ, multiple, palier),
--   * v_encours_fiable (en-cours « fiable » selon P_RetardBCJours),
--   * v_besoin_horizon (demande pendant le délai et la couverture, prolongation
--     du plan), et ses restes d'OF vides v_besoin_horizon_of, v_besoin_of_mois,
--   * v_risque_mensuel / v_risque_reference (projection mensuelle du mur de
--     risques), v_cockpit_stock, v_cockpit_couverture (compteurs et tranches),
--   * v_stock_physique.stock_mrp_net_kg et le paramètre mort
--     P_MrpInclureStockMachine (le fil sur machine compte toujours au dernier
--     constat, quel que soit son âge — décision du 26/10/2026).
--
-- POURQUOI LE MOTEUR EN RUST ET NON UNE TABLE INSTANTANÉE. Le moteur projette
-- jour par jour : le recopier en SQL ferait deux logiques, et une table écrite par
-- le moteur serait périmée dès le mouvement suivant (écrite à la lecture, ou
-- datée). Les lecteurs étaient tous des routes Rust (cockpit, briefing, assistant,
-- stock projeté, mur de risques, indicateurs, saisie d'un bon) : ils appellent le
-- moteur (`couverture::etats`), qui calcule toutes les références en une lecture.
-- Les vues qui gardaient un statut ou une projection pour l'afficher sont
-- redéfinies SANS lui (sur la lecture neutre v_stock_reference) ; la route ajoute
-- les colonnes du moteur (statut, jours couverts, 1re rupture…).
--
-- LES CONTRÔLES. C05 (« stock projeté négatif ») et C25 (« stock mobilisable face
-- à un équivalent en tension ») gardent leur sens et passent au moteur : servis par
-- le serveur sous les mêmes codes (`couverture::controles_moteur`), ils quittent
-- v_controles. C27 (« écart majeur : couverture confortable, magasin sous le
-- minimum ») et C49 (« proposition estimée surtout sur la prolongation du plan »)
-- n'ont plus de sens — le moteur n'a ni seuils de jours ni prolongation — et sont
-- retirés. C66 (nouveau, 2026-10-27d) : un transfert en route sans date prévue de
-- disponibilité. C28 (commande en retard) se rebranche sur la règle du moteur :
-- une ligne de bon validé dont la date (de la ligne, sinon de l'en-tête) est
-- dépassée est en retard et hors couverture — plus de tolérance P_RetardBCJours,
-- plus de libellé selon P_EncoursRetardInclus (le moteur ne compte jamais un bon
-- en retard).
--
-- PARAMÈTRES DÉSORMAIS SANS LECTEUR, GARDÉS (à décider, non supprimés ici) :
-- P_RetardBCJours, P_EncoursRetardInclus, P_HorizonProlonge, P_EcartCouvertureJours.
--
-- La supervision (taux de rupture, de disponibilité, couverture médiane) se
-- calcule au moteur, dans la route ; la vue garde ses autres indicateurs.
-- `snapshot_mrp` (photo d'un plan) prend désormais le solde et l'état du moteur :
-- sa contrainte accepte les trois états du moteur, à côté des anciens (l'historique
-- reste lisible).
--
-- Gardés, parce qu'ils ne calculent ni besoin ni projection : v_besoin_mrp_calcule
-- (le plan en kilos, qui fait la photo besoin_mrp), v_besoin_12m et v_besoin_mois
-- (la lecture du plan restant, entrée et non calcul ; v_conso_retenue et l'écart de
-- besoin d'une ligne de bon la lisent), v_conso_retenue, v_stock_min_dynamique (un
-- seuil affiché, il n'entre plus dans aucun besoin), v_stock_disponible.
--
-- Déclarés : les colonnes du moteur aux modules STOCK et COCKPIT (une colonne non
-- déclarée est masquée à l'écran), le défaut de données au plan d'achat, et
-- « Plan / mois » (plan_mois_kg : le plan de l'horizon ramené à 30 jours, tel que le
-- moteur le consomme), qui remplace la « conso / mois » de l'ancienne consommation
-- retenue dans les listes pilotées par le moteur.
-- Rejouable. Enregistrée par migrer.py. Exigée au démarrage (backend/src/db.rs).
-- Une vue retirée qui manquerait au témoin final arrête la migration (aucune
-- disparition silencieuse par CASCADE).
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- 1. Retrait : l'ancien calcul et tout ce qui le lisait (recréé plus bas)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS v_supervision CASCADE;
DROP VIEW IF EXISTS v_supervision_valeurs CASCADE;
DROP VIEW IF EXISTS v_cockpit_files CASCADE;
DROP VIEW IF EXISTS v_controles CASCADE;
DROP VIEW IF EXISTS v_ctl_c05 CASCADE;
DROP VIEW IF EXISTS v_ctl_c25 CASCADE;
DROP VIEW IF EXISTS v_ctl_c27 CASCADE;
DROP VIEW IF EXISTS v_ctl_c28 CASCADE;
DROP VIEW IF EXISTS v_ctl_c49 CASCADE;
DROP VIEW IF EXISTS v_ctl_c66 CASCADE;
DROP VIEW IF EXISTS v_etat_stock_conditionne CASCADE;
DROP VIEW IF EXISTS v_etat_stock CASCADE;
DROP VIEW IF EXISTS v_risque_reference CASCADE;
DROP VIEW IF EXISTS v_risque_mensuel CASCADE;
DROP VIEW IF EXISTS v_risque_sourcing CASCADE;
DROP VIEW IF EXISTS v_substitution_dispo CASCADE;
DROP VIEW IF EXISTS v_equivalence CASCADE;
DROP VIEW IF EXISTS v_analyse_abc_xyz CASCADE;
DROP VIEW IF EXISTS v_cockpit_couverture CASCADE;
DROP VIEW IF EXISTS v_cockpit_devise CASCADE;
DROP VIEW IF EXISTS v_cockpit_economies CASCADE;
DROP VIEW IF EXISTS v_cockpit_mono_source CASCADE;
DROP VIEW IF EXISTS v_cockpit_pareto CASCADE;
DROP VIEW IF EXISTS v_cockpit_stock CASCADE;
DROP VIEW IF EXISTS v_plan_achat CASCADE;
DROP VIEW IF EXISTS v_stock_projete CASCADE;
DROP VIEW IF EXISTS v_encours_fiable CASCADE;
DROP VIEW IF EXISTS v_besoin_horizon_of CASCADE;
DROP VIEW IF EXISTS v_besoin_horizon CASCADE;
DROP VIEW IF EXISTS v_besoin_of_mois CASCADE;
DROP VIEW IF EXISTS v_stock_reference CASCADE;
DROP VIEW IF EXISTS v_stock_physique CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Les vues recréées, sans projection ni statut (définitions en service au
--    27/10/2026, colonnes de l'ancien calcul retirées)
-- -----------------------------------------------------------------------------
CREATE VIEW v_stock_physique AS
 WITH hors_mrp AS (
         SELECT sl.code_reference,
            sum(
                CASE
                    WHEN l.categorie = 'RESTES'::text AND rr.suivi_lot = 1 AND l.statut <> 'BLOQUE'::text THEN sl.quantite_kg
                    ELSE 0::numeric
                END) AS restes_kg,
            sum(
                CASE
                    WHEN l.statut = 'BLOQUE'::text THEN sl.quantite_kg
                    ELSE 0::numeric
                END) AS bloque_kg
           FROM stock_lot sl
             JOIN lot l ON l.code_reference = sl.code_reference AND l.lot_fournisseur = sl.lot_fournisseur
             JOIN reference rr ON rr.code_reference = sl.code_reference
             JOIN magasin mg_1 ON mg_1.code_magasin = sl.code_magasin
          WHERE mg_1.inclure_mrp = 1 AND mg_1.est_quarantaine = 0
          GROUP BY sl.code_reference
        ), machine AS (
         SELECT e.code_reference,
            round(sum(e.kg), 4) AS kg_sur_machine
           FROM machine_etat e
             LEFT JOIN lot l ON l.code_reference = e.code_reference AND l.lot_fournisseur = e.lot_fournisseur
          WHERE COALESCE(l.statut, 'LIBRE'::text) <> 'BLOQUE'::text
          GROUP BY e.code_reference
        ), en_route AS (
         SELECT lt.code_reference,
            round(sum(lt.quantite_kg), 4) AS kg
           FROM transfert t
             JOIN ligne_transfert lt ON lt.id_transfert = t.id_transfert
             JOIN magasin md ON md.code_magasin = t.code_magasin_dest
          WHERE t.statut = 'VALIDE'::text AND md.inclure_mrp = 1 AND md.est_quarantaine = 0
          GROUP BY lt.code_reference
        )
 SELECT r.code_reference,
    round(COALESCE(sum(
        CASE
            WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg
            ELSE NULL::numeric
        END), 0::numeric), 4) AS stock_utilisable_kg,
    round(COALESCE(sum(
        CASE
            WHEN mg.est_quarantaine = 1 THEN sm.quantite_kg
            ELSE NULL::numeric
        END), 0::numeric), 4) AS stock_quarantaine_kg,
    round(COALESCE(max(h.restes_kg), 0::numeric) + COALESCE(max(h.bloque_kg), 0::numeric), 4) AS stock_reserve_kg,
    round(COALESCE(sum(
        CASE
            WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg
            ELSE NULL::numeric
        END), 0::numeric) - COALESCE(max(h.restes_kg), 0::numeric) - COALESCE(max(h.bloque_kg), 0::numeric), 4) AS stock_physique_net_kg,
    round(COALESCE(max(h.restes_kg), 0::numeric), 4) AS stock_restes_kg,
    round(COALESCE(max(h.bloque_kg), 0::numeric), 4) AS stock_bloque_kg,
    round(COALESCE(max(mc.kg_sur_machine), 0::numeric), 4) AS stock_machine_kg,
    round(COALESCE(max(er.kg), 0::numeric), 4) AS stock_transit_kg
   FROM reference r
     LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
     LEFT JOIN magasin mg ON mg.code_magasin = sm.code_magasin
     LEFT JOIN hors_mrp h ON h.code_reference = r.code_reference
     LEFT JOIN machine mc ON mc.code_reference = r.code_reference
     LEFT JOIN en_route er ON er.code_reference = r.code_reference
  WHERE r.actif = 1
  GROUP BY r.code_reference;
ALTER VIEW v_stock_physique OWNER TO gestionfil;

CREATE VIEW v_stock_reference AS
 SELECT r.code_reference,
    r.designation,
    r.code_fournisseur,
    f.nom AS fournisseur_nom,
    f.pays AS fournisseur_pays,
    COALESCE(f.delai_livraison_jours, p_delai.v::bigint) AS delai_livraison_jours,
    r.classe_abc,
    r.classe_xyz,
    r.unite_catalogue,
    r.cmup_mad,
    sd.stock_mrp_kg,
    sd.stock_total_kg,
    sd.valeur_totale_mad,
    ph.stock_physique_net_kg,
    ph.stock_quarantaine_kg,
    ph.stock_reserve_kg,
    ph.stock_machine_kg,
    ph.stock_transit_kg,
    cr.conso_mensuelle_kg,
    cr.source_conso,
    sm.stock_min_kg
   FROM reference r
     JOIN v_stock_disponible sd ON sd.code_reference = r.code_reference
     JOIN v_stock_physique ph ON ph.code_reference = r.code_reference
     JOIN v_stock_min_dynamique sm ON sm.code_reference = r.code_reference
     LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
     LEFT JOIN v_conso_retenue cr ON cr.code_reference = r.code_reference
     CROSS JOIN ( SELECT parametre.valeur_courante AS v
           FROM parametre
          WHERE parametre.code_parametre = 'P_DelaiDefaut'::text) p_delai
  WHERE r.actif = 1;
ALTER VIEW v_stock_reference OWNER TO gestionfil;

CREATE VIEW v_equivalence AS
 SELECT rge1.code_groupe_equiv,
    ge.libelle AS groupe_libelle,
    r1.code_reference,
    r1.designation,
    r1.code_fournisseur,
    f1.nom AS fournisseur_nom,
    rge1.priorite,
    rge1.est_preferentielle,
    r1.unite_catalogue,
    COALESCE(sd1.stock_mrp_kg, 0::numeric) AS stock_kg,
    COALESCE(b1.besoin_12m_kg, 0::numeric) AS besoin_12m_kg,
    r2.code_reference AS equivalent_reference,
    r2.designation AS equivalent_designation,
    r2.code_fournisseur AS equivalent_fournisseur,
    f2.nom AS equivalent_fournisseur_nom,
    COALESCE(f2.delai_livraison_jours, ( SELECT parametre.valeur_courante::bigint AS valeur_courante
           FROM parametre
          WHERE parametre.code_parametre = 'P_DelaiDefaut'::text)) AS equivalent_delai_jours,
    rge2.priorite AS equivalent_priorite,
    rge2.est_preferentielle AS equivalent_preferentielle,
    r2.unite_catalogue AS equivalent_unite,
    r2.prix_catalogue_kg AS equivalent_prix_catalogue_kg,
    r2.code_devise_catalogue AS equivalent_devise,
    COALESCE(sd2.stock_mrp_kg, 0::numeric) AS equivalent_stock_kg,
    COALESCE(b2.besoin_12m_kg, 0::numeric) AS equivalent_besoin_12m_kg,
        CASE
            WHEN r1.code_fournisseur = r2.code_fournisseur THEN 1
            ELSE 0
        END AS meme_fournisseur,
        CASE
            WHEN r1.unite_catalogue = r2.unite_catalogue AND COALESCE(r1.densite_kg_ml, '-1'::integer::numeric) = COALESCE(r2.densite_kg_ml, '-1'::integer::numeric) AND r1.code_categorie = r2.code_categorie THEN 1
            ELSE 0
        END AS interchangeable
   FROM reference_groupe_equiv rge1
     JOIN groupe_equiv ge ON ge.code_groupe_equiv = rge1.code_groupe_equiv AND ge.actif = 1
     JOIN reference r1 ON r1.code_reference = rge1.code_reference
     JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv AND rge2.code_reference <> rge1.code_reference AND rge2.actif = 1
     JOIN reference r2 ON r2.code_reference = rge2.code_reference
     LEFT JOIN fournisseur f1 ON f1.code_fournisseur = r1.code_fournisseur
     LEFT JOIN fournisseur f2 ON f2.code_fournisseur = r2.code_fournisseur
     LEFT JOIN v_stock_disponible sd1 ON sd1.code_reference = r1.code_reference
     LEFT JOIN v_stock_disponible sd2 ON sd2.code_reference = r2.code_reference
     LEFT JOIN v_besoin_12m b1 ON b1.code_reference = r1.code_reference
     LEFT JOIN v_besoin_12m b2 ON b2.code_reference = r2.code_reference
  WHERE rge1.actif = 1 AND r1.actif = 1 AND r2.actif = 1;
ALTER VIEW v_equivalence OWNER TO gestionfil;

CREATE VIEW v_etat_stock AS
 WITH ventilation AS (
         SELECT sm.code_reference,
            jsonb_object_agg(sm.code_magasin, round(sm.quantite_kg, 3)) FILTER (WHERE e.code_machine IS NULL AND sm.quantite_kg <> 0::numeric) AS par_magasin,
            COALESCE(sum(sm.quantite_kg) FILTER (WHERE e.code_machine IS NULL), 0::numeric) AS magasins_kg,
            COALESCE(sum(sm.quantite_kg) FILTER (WHERE e.code_machine IS NOT NULL), 0::numeric) AS machines_kg,
            COALESCE(sum(sm.nb_bobines) FILTER (WHERE e.code_machine IS NOT NULL), 0::numeric) AS machines_bobines,
            count(DISTINCT e.code_machine) FILTER (WHERE e.code_machine IS NOT NULL) AS nb_machines
           FROM stock_magasin sm
             LEFT JOIN machine_emplacement e ON e.code_magasin = sm.code_magasin
          GROUP BY sm.code_reference
        ), mouvement_dernier AS (
         SELECT lm.code_reference,
            max(mv.date_mouvement::text) FILTER (WHERE tm.signe = '-1'::integer) AS derniere_sortie,
            max(mv.date_mouvement::text) AS dernier_mouvement
           FROM ligne_mouvement lm
             JOIN mouvement mv ON mv.id_mouvement = lm.id_mouvement
             JOIN type_mouvement tm ON tm.code_type_mvt = mv.code_type_mvt
          GROUP BY lm.code_reference
        )
 SELECT sp.code_reference,
    sp.designation,
    r.code_categorie,
    cm.libelle AS categorie,
    sp.code_fournisseur,
    sp.fournisseur_nom,
    sp.unite_catalogue AS unite,
    round(sp.stock_total_kg, 3) AS stock_global_kg,
    round(v.magasins_kg, 3) AS magasins_kg,
    round(v.machines_kg, 3) AS machines_kg,
    v.machines_bobines,
    v.nb_machines,
    v.par_magasin,
    round(sp.stock_quarantaine_kg, 3) AS quarantaine_kg,
    round(sp.stock_physique_net_kg, 3) AS disponible_kg,
    round(sp.stock_min_kg, 3) AS stock_min_kg,
    round(sp.conso_mensuelle_kg, 3) AS conso_mensuelle_kg,
    sp.delai_livraison_jours,
    sp.classe_abc,
    sp.classe_xyz,
    round(sp.cmup_mad, 4) AS cmup_mad,
    round(r.prix_catalogue_kg, 4) AS prix_catalogue_kg,
    r.code_devise_catalogue AS devise,
    round(sp.valeur_totale_mad, 2) AS valeur_mad,
    sp.stock_min_kg > 0::numeric AND sp.stock_total_kg < sp.stock_min_kg AS sous_minimum,
    md.derniere_sortie,
    md.dernier_mouvement,
        CASE
            WHEN md.dernier_mouvement IS NULL THEN NULL::integer
            ELSE CURRENT_DATE - "left"(md.dernier_mouvement, 10)::date
        END AS jours_sans_mouvement,
    rge.code_groupe_equiv,
    ( SELECT count(*) AS count
           FROM reference_groupe_equiv x
          WHERE x.code_groupe_equiv = rge.code_groupe_equiv AND x.code_reference <> sp.code_reference AND x.actif = 1) AS nb_equivalents,
    round(r.bobines_par_palette::numeric * r.poids_bobine_kg, 3) AS kg_par_palette,
        CASE
            WHEN r.bobines_par_palette > 0 AND r.poids_bobine_kg > 0::numeric THEN round(sp.stock_total_kg / (r.bobines_par_palette::numeric * r.poids_bobine_kg), 2)
            ELSE NULL::numeric
        END AS palettes,
        CASE
            WHEN r.poids_bobine_kg > 0::numeric THEN round(sp.stock_total_kg / r.poids_bobine_kg)
            ELSE NULL::numeric
        END AS bobines
   FROM v_stock_reference sp
     JOIN reference r ON r.code_reference = sp.code_reference
     LEFT JOIN categorie_matiere cm ON cm.code_categorie = r.code_categorie
     LEFT JOIN ventilation v ON v.code_reference = sp.code_reference
     LEFT JOIN mouvement_dernier md ON md.code_reference = sp.code_reference
     LEFT JOIN reference_groupe_equiv rge ON rge.code_reference = sp.code_reference AND rge.actif = 1;
ALTER VIEW v_etat_stock OWNER TO gestionfil;

CREATE VIEW v_etat_stock_conditionne AS
 SELECT e.code_reference,
    e.designation,
    e.code_categorie,
    e.categorie,
    e.code_fournisseur,
    e.fournisseur_nom,
    e.unite,
    e.stock_global_kg,
    e.magasins_kg,
    e.machines_kg,
    e.machines_bobines,
    e.nb_machines,
    e.par_magasin,
    e.quarantaine_kg,
    e.disponible_kg,
    e.stock_min_kg,
    e.conso_mensuelle_kg,
    e.delai_livraison_jours,
    e.classe_abc,
    e.classe_xyz,
    e.cmup_mad,
    e.prix_catalogue_kg,
    e.devise,
    e.valeur_mad,
    e.sous_minimum,
    e.derniere_sortie,
    e.dernier_mouvement,
    e.jours_sans_mouvement,
    e.code_groupe_equiv,
    e.nb_equivalents,
    e.kg_par_palette,
    e.palettes,
    e.bobines,
    c.code_conditionnement,
    c.conditionnement_libelle,
    c.unite_singulier,
    c.unite_pluriel,
    c.declare AS conditionnement_declare,
    c.comptable AS conditionnement_comptable,
    c.contenance_litres,
        CASE
            WHEN c.comptable = 1 THEN e.bobines
            ELSE NULL::numeric
        END AS nb_colis,
        CASE
            WHEN c.comptable = 1 THEN e.palettes
            ELSE NULL::numeric
        END AS nb_palettes,
        CASE
            WHEN c.comptable = 1 AND c.contenance_litres IS NOT NULL THEN round(e.bobines * c.contenance_litres, 0)
            ELSE NULL::numeric
        END AS litres
   FROM v_etat_stock e
     JOIN v_reference_conditionnement c USING (code_reference);
ALTER VIEW v_etat_stock_conditionne OWNER TO gestionfil;

CREATE VIEW v_analyse_abc_xyz AS
 WITH valeur AS (
         SELECT sp.code_reference,
            sp.designation,
            sp.fournisseur_nom,
            sp.conso_mensuelle_kg,
            sp.cmup_mad,
            sp.valeur_totale_mad,
            r.classe_abc,
            r.classe_xyz,
            fn_iso(r.date_dernier_abc) AS date_dernier_abc,
            round(COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric * COALESCE(sp.cmup_mad, 0::numeric), 2) AS valeur_conso_annuelle_mad
           FROM v_stock_reference sp
             JOIN reference r ON r.code_reference = sp.code_reference
          WHERE r.actif = 1
        ), total AS (
         SELECT sum(valeur.valeur_conso_annuelle_mad) AS t
           FROM valeur
        )
 SELECT code_reference,
    designation,
    fournisseur_nom,
    conso_mensuelle_kg,
    cmup_mad,
    valeur_totale_mad,
    classe_abc,
    classe_xyz,
    fn_iso(date_dernier_abc) AS date_dernier_abc,
    valeur_conso_annuelle_mad,
    ( SELECT count(*) + 1
           FROM valeur w
          WHERE w.valeur_conso_annuelle_mad > v.valeur_conso_annuelle_mad) AS rang,
    round((( SELECT sum(w.valeur_conso_annuelle_mad) AS sum
           FROM valeur w
          WHERE w.valeur_conso_annuelle_mad >= v.valeur_conso_annuelle_mad)) * 100.0 / NULLIF(( SELECT total.t
           FROM total), 0::numeric), 4) AS pct_cumule,
    round(valeur_conso_annuelle_mad * 100.0 / NULLIF(( SELECT total.t
           FROM total), 0::numeric), 4) AS part_pct,
        CASE
            WHEN classe_abc IS NULL OR classe_xyz IS NULL THEN 'A classer'::text
            WHEN classe_abc = 'A'::text AND classe_xyz = 'X'::text THEN 'Flux tendu, commandes cadencees'::text
            WHEN classe_abc = 'A'::text AND classe_xyz = 'Y'::text THEN 'Stock de securite modere, revue mensuelle'::text
            WHEN classe_abc = 'A'::text AND classe_xyz = 'Z'::text THEN 'Stock de securite eleve et suivi rapproche'::text
            WHEN classe_abc = 'B'::text AND classe_xyz = 'X'::text THEN 'Reapprovisionnement automatique'::text
            WHEN classe_abc = 'B'::text THEN 'Revue trimestrielle'::text
            WHEN classe_abc = 'C'::text AND classe_xyz = 'X'::text THEN 'Commande automatique, lot economique'::text
            ELSE 'A la demande, sans stock dedie'::text
        END AS politique
   FROM valeur v;
ALTER VIEW v_analyse_abc_xyz OWNER TO gestionfil;

CREATE VIEW v_cockpit_devise AS
 WITH budget AS (
         SELECT r.code_devise_catalogue AS code_devise,
            count(*) AS nb_references,
            sum(COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric * COALESCE(sp.cmup_mad, 0::numeric)) AS montant_mad
           FROM reference r
             JOIN v_stock_reference sp ON sp.code_reference = r.code_reference
          WHERE r.actif = 1
          GROUP BY r.code_devise_catalogue
        )
 SELECT code_devise,
    nb_references,
    round(montant_mad, 2) AS montant_mad,
    round(montant_mad * 100.0 / NULLIF(( SELECT sum(budget.montant_mad) AS sum
           FROM budget), 0::numeric), 2) AS part_pct
   FROM budget b
  WHERE montant_mad > 0::numeric;
ALTER VIEW v_cockpit_devise OWNER TO gestionfil;

CREATE VIEW v_cockpit_economies AS
 WITH groupes AS (
         SELECT reference_groupe_equiv.code_reference,
            reference_groupe_equiv.code_groupe_equiv
           FROM reference_groupe_equiv
          WHERE reference_groupe_equiv.actif = 1
        ), mini AS (
         SELECT g_1.code_groupe_equiv,
            min(sp_1.cmup_mad) AS prix_min_mad
           FROM groupes g_1
             JOIN v_stock_reference sp_1 ON sp_1.code_reference = g_1.code_reference
          WHERE sp_1.cmup_mad > 0::numeric
          GROUP BY g_1.code_groupe_equiv
        )
 SELECT sp.code_reference,
    sp.designation,
    sp.fournisseur_nom AS fournisseur_actuel,
    g.code_groupe_equiv,
    round(sp.cmup_mad, 4) AS prix_actuel_mad,
    round(m.prix_min_mad, 4) AS prix_min_mad,
    ( SELECT sp2.fournisseur_nom
           FROM groupes g2
             JOIN v_stock_reference sp2 ON sp2.code_reference = g2.code_reference
          WHERE g2.code_groupe_equiv = g.code_groupe_equiv AND sp2.cmup_mad = m.prix_min_mad
         LIMIT 1) AS fournisseur_alternatif,
    round(COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric, 4) AS conso_annuelle_kg,
    round((sp.cmup_mad - m.prix_min_mad) * COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric, 2) AS economie_annuelle_mad
   FROM v_stock_reference sp
     JOIN groupes g ON g.code_reference = sp.code_reference
     JOIN mini m ON m.code_groupe_equiv = g.code_groupe_equiv
  WHERE sp.cmup_mad > m.prix_min_mad AND COALESCE(sp.conso_mensuelle_kg, 0::numeric) > 0::numeric;
ALTER VIEW v_cockpit_economies OWNER TO gestionfil;

CREATE VIEW v_cockpit_mono_source AS
 SELECT code_reference,
    designation,
    fournisseur_nom,
    delai_livraison_jours,
    round(COALESCE(conso_mensuelle_kg, 0::numeric) * 12::numeric * COALESCE(cmup_mad, 0::numeric), 2) AS budget_annuel_mad
   FROM v_stock_reference sp
  WHERE NOT (EXISTS ( SELECT 1
           FROM reference_groupe_equiv a
             JOIN reference_groupe_equiv b ON b.code_groupe_equiv = a.code_groupe_equiv AND b.code_reference <> a.code_reference AND b.actif = 1
             JOIN reference rb ON rb.code_reference = b.code_reference AND rb.actif = 1
          WHERE a.code_reference = sp.code_reference AND a.actif = 1 AND rb.code_fournisseur IS DISTINCT FROM sp.code_fournisseur));
ALTER VIEW v_cockpit_mono_source OWNER TO gestionfil;

CREATE VIEW v_cockpit_pareto AS
 WITH valeur AS (
         SELECT sp.code_reference,
            sp.designation,
            r.classe_abc,
            r.classe_xyz,
            round(COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric * COALESCE(sp.cmup_mad, 0::numeric), 2) AS valeur_conso_annuelle_mad
           FROM v_stock_reference sp
             JOIN reference r ON r.code_reference = sp.code_reference
          WHERE r.actif = 1
        )
 SELECT code_reference,
    designation,
    classe_abc,
    classe_xyz,
    valeur_conso_annuelle_mad,
    ( SELECT count(*) + 1
           FROM valeur w
          WHERE w.valeur_conso_annuelle_mad > v.valeur_conso_annuelle_mad) AS rang,
    round((( SELECT sum(w.valeur_conso_annuelle_mad) AS sum
           FROM valeur w
          WHERE w.valeur_conso_annuelle_mad >= v.valeur_conso_annuelle_mad)) * 100.0 / NULLIF(( SELECT sum(valeur.valeur_conso_annuelle_mad) AS sum
           FROM valeur), 0::numeric), 4) AS pct_cumule
   FROM valeur v
  WHERE valeur_conso_annuelle_mad > 0::numeric;
ALTER VIEW v_cockpit_pareto OWNER TO gestionfil;

CREATE VIEW v_risque_sourcing AS
 WITH alternatives AS (
         SELECT a_1.code_reference,
            count(DISTINCT sp_1.code_fournisseur) AS nb_sources
           FROM reference_groupe_equiv a_1
             JOIN reference_groupe_equiv b ON b.code_groupe_equiv = a_1.code_groupe_equiv AND b.actif = 1
             JOIN v_stock_reference sp_1 ON sp_1.code_reference = b.code_reference
          WHERE a_1.actif = 1
          GROUP BY a_1.code_reference
        )
 SELECT sp.code_reference,
    sp.designation,
    sp.fournisseur_nom,
    r.classe_abc,
    r.classe_xyz,
    sp.delai_livraison_jours,
    round(COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric * COALESCE(sp.cmup_mad, 0::numeric), 2) AS budget_annuel_mad,
    COALESCE(a.nb_sources, 1::bigint) AS nb_sources,
        CASE
            WHEN COALESCE(a.nb_sources, 1::bigint) <= 1 THEN 'MONO_SOURCE'::text
            ELSE 'MULTI_SOURCE'::text
        END AS risque_source,
        CASE
            WHEN (COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric * COALESCE(sp.cmup_mad, 0::numeric)) >= (( SELECT parametre.valeur_courante::numeric AS valeur_courante
               FROM parametre
              WHERE parametre.code_parametre = 'P_SeuilTier1'::text)) THEN 'TIER_1'::text
            WHEN (COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric * COALESCE(sp.cmup_mad, 0::numeric)) >= (( SELECT parametre.valeur_courante::numeric AS valeur_courante
               FROM parametre
              WHERE parametre.code_parametre = 'P_SeuilTier2'::text)) THEN 'TIER_2'::text
            WHEN (COALESCE(sp.conso_mensuelle_kg, 0::numeric) * 12::numeric * COALESCE(sp.cmup_mad, 0::numeric)) >= (( SELECT parametre.valeur_courante::numeric AS valeur_courante
               FROM parametre
              WHERE parametre.code_parametre = 'P_SeuilTier3'::text)) THEN 'TIER_3'::text
            ELSE 'TIER_4'::text
        END AS tier
   FROM v_stock_reference sp
     JOIN reference r ON r.code_reference = sp.code_reference
     LEFT JOIN alternatives a ON a.code_reference = sp.code_reference
  WHERE r.actif = 1;
ALTER VIEW v_risque_sourcing OWNER TO gestionfil;

CREATE VIEW v_substitution_dispo AS
 SELECT r1.code_reference AS ref_principale,
    r1.designation AS designation_principale,
    rge1.code_groupe_equiv,
    ge.libelle AS groupe_libelle,
    rge1.priorite AS priorite_principale,
    r2.code_reference AS ref_substitut,
    r2.designation AS designation_substitut,
    r2.code_fournisseur AS fournisseur_substitut,
    rge2.priorite AS priorite_substitut,
    rge2.est_preferentielle,
    ph2.stock_physique_net_kg AS stock_substitut_kg
   FROM reference r1
     JOIN reference_groupe_equiv rge1 ON rge1.code_reference = r1.code_reference AND rge1.actif = 1
     JOIN groupe_equiv ge ON ge.code_groupe_equiv = rge1.code_groupe_equiv AND ge.actif = 1
     JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv AND rge2.code_reference <> rge1.code_reference AND rge2.actif = 1
     JOIN reference r2 ON r2.code_reference = rge2.code_reference AND r2.actif = 1
     JOIN v_stock_physique ph2 ON ph2.code_reference = r2.code_reference
  WHERE r1.actif = 1 AND ph2.stock_physique_net_kg > 0::numeric
  ORDER BY r1.code_reference, rge2.est_preferentielle DESC, rge2.priorite;
ALTER VIEW v_substitution_dispo OWNER TO gestionfil;

CREATE VIEW v_supervision_valeurs AS
 WITH stock AS (
         SELECT COALESCE(sum(v_etat_stock.valeur_mad), 0::numeric) AS valeur_mad,
            NULLIF(count(*), 0) AS nb_refs
           FROM v_etat_stock
        ), sourcing AS (
         SELECT count(*) FILTER (WHERE v_risque_sourcing.nb_sources <= 1) AS nb_mono,
            COALESCE(sum(v_risque_sourcing.budget_annuel_mad) FILTER (WHERE v_risque_sourcing.nb_sources <= 1), 0::numeric) AS budget_mono
           FROM v_risque_sourcing
        ), economies AS (
         SELECT COALESCE(sum(v_cockpit_economies.economie_annuelle_mad), 0::numeric) AS economies_mad
           FROM v_cockpit_economies
        ), livraison AS (
         SELECT count(*) AS nb,
            count(*) FILTER (WHERE substr(r.date_reception::text, 1, 10)::date <= substr(b.date_livraison_prevue::text, 1, 10)::date) AS nb_a_lheure,
            avg(substr(r.date_reception::text, 1, 10)::date - substr(b.date_bc::text, 1, 10)::date) AS delai_reel
           FROM reception r
             JOIN bon_commande b ON b.id_bc = r.id_bc
          WHERE (r.statut = ANY (ARRAY['VALIDE'::text, 'CLOTURE'::text])) AND b.date_livraison_prevue::text IS NOT NULL
        ), completude AS (
         SELECT count(*) AS nb,
            count(*) FILTER (WHERE l.quantite_recue_kg >= (l.quantite_commandee_kg * 0.98)) AS nb_completes
           FROM ligne_bc l
             JOIN bon_commande b ON b.id_bc = l.id_bc
          WHERE l.quantite_commandee_kg > 0::numeric AND (b.statut = ANY (ARRAY['ENVOYE'::text, 'LIVRE_PARTIEL'::text, 'CLOTURE'::text]))
        ), rotation AS (
         SELECT sum(lm.quantite_kg * COALESCE(r.cmup_mad, 0::numeric)) AS sorties_mad,
            count(DISTINCT substr(m.date_mouvement::text, 1, 7)) AS nb_mois
           FROM mouvement m
             JOIN type_mouvement t ON t.code_type_mvt = m.code_type_mvt
             JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
             JOIN reference r ON r.code_reference = lm.code_reference
          WHERE t.signe = '-1'::integer AND m.date_mouvement::text >= to_char((now() AT TIME ZONE 'UTC'::text) - '1 year'::interval, 'YYYY-MM-DD'::text)
        ), dormant AS (
         SELECT COALESCE(sum(e.valeur_mad) FILTER (WHERE NOT (EXISTS ( SELECT 1
                   FROM ligne_mouvement lm
                     JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
                  WHERE lm.code_reference = e.code_reference AND m.date_mouvement::text >= to_char((now() AT TIME ZONE 'UTC'::text) - '60 days'::interval, 'YYYY-MM-DD'::text)))), 0::numeric) AS dormant_mad,
            NULLIF(sum(e.valeur_mad), 0::numeric) AS total_mad
           FROM v_etat_stock e
        ), prix AS (
         SELECT sum(h.prix_kg_mad * h.quantite_achetee_kg) FILTER (WHERE h.date_achat >= to_char((now() AT TIME ZONE 'UTC'::text) - '6 mons'::interval, 'YYYY-MM-DD'::text)) / NULLIF(sum(h.quantite_achetee_kg) FILTER (WHERE h.date_achat >= to_char((now() AT TIME ZONE 'UTC'::text) - '6 mons'::interval, 'YYYY-MM-DD'::text)), 0::numeric) AS recent,
            sum(h.prix_kg_mad * h.quantite_achetee_kg) FILTER (WHERE h.date_achat < to_char((now() AT TIME ZONE 'UTC'::text) - '6 mons'::interval, 'YYYY-MM-DD'::text) AND h.date_achat >= to_char((now() AT TIME ZONE 'UTC'::text) - '1 year'::interval, 'YYYY-MM-DD'::text)) / NULLIF(sum(h.quantite_achetee_kg) FILTER (WHERE h.date_achat < to_char((now() AT TIME ZONE 'UTC'::text) - '6 mons'::interval, 'YYYY-MM-DD'::text) AND h.date_achat >= to_char((now() AT TIME ZONE 'UTC'::text) - '1 year'::interval, 'YYYY-MM-DD'::text)), 0::numeric) AS ancien
           FROM v_historique_prix_courant h
          WHERE h.quantite_achetee_kg > 0::numeric AND h.prix_kg_mad > 0::numeric
        ), machine AS (
         SELECT COALESCE(sum(machine_etat.kg), 0::numeric) AS kg,
            count(*) AS nb
           FROM machine_etat
        )
 SELECT 'valeur_stock'::text AS cle,
    s.valeur_mad AS valeur
   FROM stock s
UNION ALL
 SELECT 'mono_source'::text AS cle,
    so.nb_mono::numeric AS valeur
   FROM sourcing so
UNION ALL
 SELECT 'budget_mono'::text AS cle,
    so.budget_mono AS valeur
   FROM sourcing so
UNION ALL
 SELECT 'economies'::text AS cle,
    e.economies_mad AS valeur
   FROM economies e
UNION ALL
 SELECT 'on_time'::text AS cle,
        CASE
            WHEN l.nb > 0 THEN round(100.0 * l.nb_a_lheure::numeric / l.nb::numeric, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM livraison l
UNION ALL
 SELECT 'lead_time'::text AS cle,
        CASE
            WHEN l.nb > 0 THEN round(l.delai_reel, 0)
            ELSE NULL::numeric
        END AS valeur
   FROM livraison l
UNION ALL
 SELECT 'in_full'::text AS cle,
        CASE
            WHEN c.nb > 0 THEN round(100.0 * c.nb_completes::numeric / c.nb::numeric, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM completude c
UNION ALL
 SELECT 'otif'::text AS cle,
        CASE
            WHEN l.nb > 0 AND c.nb > 0 THEN round(100.0 * l.nb_a_lheure::numeric / l.nb::numeric * c.nb_completes::numeric / c.nb::numeric, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM livraison l,
    completude c
UNION ALL
 SELECT 'rotation'::text AS cle,
        CASE
            WHEN r.nb_mois >= 6 AND (( SELECT stock.valeur_mad
               FROM stock)) > 0::numeric THEN round(r.sorties_mad * 12.0 / r.nb_mois::numeric / (( SELECT stock.valeur_mad
               FROM stock)), 2)
            ELSE NULL::numeric
        END AS valeur
   FROM rotation r
UNION ALL
 SELECT 'stock_dormant'::text AS cle,
        CASE
            WHEN d.total_mad IS NOT NULL THEN round(100.0 * d.dormant_mad / d.total_mad, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM dormant d
UNION ALL
 SELECT 'evolution_prix'::text AS cle,
        CASE
            WHEN p.ancien IS NOT NULL AND p.ancien > 0::numeric THEN round(100.0 * (p.recent - p.ancien) / p.ancien, 1)
            ELSE NULL::numeric
        END AS valeur
   FROM prix p
UNION ALL
 SELECT 'wip_machine'::text AS cle,
        CASE
            WHEN m.nb > 0 THEN round(m.kg, 0)
            ELSE NULL::numeric
        END AS valeur
   FROM machine m;
ALTER VIEW v_supervision_valeurs OWNER TO gestionfil;

CREATE VIEW v_supervision AS
 SELECT d.domaine,
    d.cle,
    d.libelle,
    d.unite,
    d.definition,
    (v.valeur IS NOT NULL)::integer AS disponible,
        CASE
            WHEN v.valeur IS NULL THEN d.condition
            ELSE NULL::text
        END AS condition,
    d.sens,
    d.cible,
    d.vigilance
   FROM ( VALUES ('STOCK'::text,'valeur_stock'::text,'Valeur du stock'::text,'MAD'::text,'Au CMUP, tous magasins confondus.'::text,'Aucun stock valorise.'::text,'neutre'::text,NULL::numeric,NULL::numeric), ('STOCK'::text,'couverture_mediane'::text,'Couverture mediane'::text,'jours'::text,'Jours couverts par le moteur de couverture (jusqu a la premiere rupture, sinon tout l horizon du plan) : la moitie des references tient plus longtemps, l autre moins.'::text,'Aucune reference avec un plan en service.'::text,'haut'::text,60,30), ('STOCK'::text,'taux_rupture'::text,'Taux de rupture'::text,'%'::text,'References dont une part du plan n est pas couverte sur l horizon (moteur de couverture).'::text,'Aucune reference suivie.'::text,'bas'::text,2,5), ('STOCK'::text,'taux_disponibilite'::text,'Taux de disponibilite'::text,'%'::text,'References couvertes sur tout l horizon (ni rupture ni passage sous la securite), sur le total suivi par le moteur.'::text,'Aucune reference suivie.'::text,'haut'::text,95,90), ('STOCK'::text,'rotation'::text,'Rotation du stock'::text,'fois/an'::text,'Consommation annuelle rapportee au stock moyen.'::text,'Moins de six mois de mouvements : la rotation n aurait aucun sens.'::text,'haut'::text,4,2), ('STOCK'::text,'stock_dormant'::text,'Stock dormant'::text,'%'::text,'Valeur sans aucun mouvement depuis soixante jours.'::text,'Le magasin a moins de soixante jours.'::text,'bas'::text,5,12), ('LIVRAISON'::text,'otif'::text,'OTIF fournisseur'::text,'%'::text,'A l heure ET complet : le produit des deux, jamais leur moyenne.'::text,'Aucune reception rapprochee d un bon de commande.'::text,'haut'::text,95,85), ('LIVRAISON'::text,'on_time'::text,'Ponctualite'::text,'%'::text,'Livraisons arrivees au plus tard a la date promise.'::text,'Aucune reception avec une date promise.'::text,'haut'::text,95,85), ('LIVRAISON'::text,'in_full'::text,'Completude'::text,'%'::text,'Quantite pesee contre quantite commandee, tolerance de 2 %.'::text,'Aucune ligne de commande servie.'::text,'haut'::text,98,92), ('LIVRAISON'::text,'lead_time'::text,'Delai fournisseur reel'::text,'jours'::text,'Entre la date du bon et la date de reception.'::text,'Aucun bon suivi d une reception.'::text,'bas'::text,60,90), ('ACHATS'::text,'mono_source'::text,'References mono-source'::text,'refs'::text,'Une seule source connue : un incident fournisseur arrete la production.'::text,'Aucune reference analysee.'::text,'bas'::text,0,10), ('ACHATS'::text,'budget_mono'::text,'Budget expose au mono-source'::text,'MAD/an'::text,'Ce que pese annuellement ce qui n a qu une source.'::text,'Aucun budget calcule.'::text,'neutre'::text,NULL::numeric,NULL::numeric), ('ACHATS'::text,'economies'::text,'Economies identifiees'::text,'MAD/an'::text,'A qualite egale, le meme titrage achete moins cher ailleurs.'::text,'Aucune equivalence declaree.'::text,'neutre'::text,NULL::numeric,NULL::numeric), ('ACHATS'::text,'evolution_prix'::text,'Evolution des prix'::text,'%'::text,'Prix moyen pondere des six derniers mois contre les six precedents.'::text,'Moins d un an de releves de prix.'::text,'bas'::text,3,8), ('PREVISION'::text,'forecast_accuracy'::text,'Precision de prevision'::text,'%'::text,'100 moins l erreur ponderee entre besoin calcule et sortie reelle.'::text,'Le rapprochement besoin/realise n est pas encore etabli.'::text,'haut'::text,85,70), ('PRODUCTION'::text,'wip_machine'::text,'Matiere en machine'::text,'kg'::text,'Bobines montees sur metier, immobilisees hors magasin.'::text,'Aucun constat de machine.'::text,'neutre'::text,NULL::numeric,NULL::numeric)) d(domaine, cle, libelle, unite, definition, condition, sens, cible, vigilance)
     LEFT JOIN v_supervision_valeurs v USING (cle);
ALTER VIEW v_supervision OWNER TO gestionfil;

CREATE VIEW v_ctl_c66 AS
 SELECT t.id_transfert,
    t.numero_transfert,
    t.code_magasin_source,
    t.code_magasin_dest,
    COALESCE(t.date_sortie::date, t.date_transfert) AS date_expedition,
    ( SELECT round(COALESCE(sum(l.quantite_kg), 0::numeric), 3) AS round
           FROM ligne_transfert l
          WHERE l.id_transfert = t.id_transfert) AS quantite_kg
   FROM transfert t
  WHERE t.statut = 'VALIDE'::text AND t.date_disponibilite_prevue IS NULL;
ALTER VIEW v_ctl_c66 OWNER TO gestionfil;

CREATE VIEW v_ctl_c28 AS
 SELECT lb.code_reference,
    r.designation,
    bc.numero_bc,
    bc.code_fournisseur,
    COALESCE(lb.date_livraison_prevue, bc.date_livraison_prevue)::text AS date_livraison_prevue,
    (CURRENT_DATE - COALESCE(lb.date_livraison_prevue, bc.date_livraison_prevue))::bigint AS retard_jours,
    lb.quantite_restante_kg
   FROM ligne_bc lb
     JOIN bon_commande bc ON bc.id_bc = lb.id_bc
     JOIN reference r ON r.code_reference = lb.code_reference
  WHERE (bc.statut = ANY (ARRAY['VALIDE'::text, 'ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND (lb.statut <> ALL (ARRAY['ANNULE'::text, 'SOLDE'::text])) AND lb.type_ligne = 'MARCHANDISE'::text AND lb.quantite_restante_kg > 0::numeric AND COALESCE(lb.date_livraison_prevue, bc.date_livraison_prevue) < CURRENT_DATE;
ALTER VIEW v_ctl_c28 OWNER TO gestionfil;

CREATE VIEW v_controles AS
 SELECT 'C01'::text AS code,
    'Somme des % <> 100 par role BOM'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c01) AS anomalies
UNION ALL
 SELECT 'C02'::text AS code,
    'BC envoyes non soldes depuis plus de 30j'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c02) AS anomalies
UNION ALL
 SELECT 'C03'::text AS code,
    'Reference de mouvement absente du catalogue'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c03) AS anomalies
UNION ALL
 SELECT 'C04'::text AS code,
    'Fournisseur de reference inexistant'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c04) AS anomalies
UNION ALL
 SELECT 'C06'::text AS code,
    'Mouvement date dans le futur'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c06) AS anomalies
UNION ALL
 SELECT 'C07'::text AS code,
    'Sortie production sans numero d''OF'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c07) AS anomalies
UNION ALL
 SELECT 'C08'::text AS code,
    'Retour sans motif de ligne'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c08) AS anomalies
UNION ALL
 SELECT 'C09'::text AS code,
    'Mouvement sans utilisateur'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c09) AS anomalies
UNION ALL
 SELECT 'C10'::text AS code,
    'Ecart de pesee hors tolerance sans derogation'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c10) AS anomalies
UNION ALL
 SELECT 'C11'::text AS code,
    'Derive solde de stock vs grand livre'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c11) AS anomalies
UNION ALL
 SELECT 'C12'::text AS code,
    'Reference active a prix nul'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c12) AS anomalies
UNION ALL
 SELECT 'C13'::text AS code,
    'Reference active sans fournisseur'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c13) AS anomalies
UNION ALL
 SELECT 'C14'::text AS code,
    'Composant de recette validee a cout nul'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c14) AS anomalies
UNION ALL
 SELECT 'C15'::text AS code,
    'Derive stock par lot vs stock par magasin'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c15) AS anomalies
UNION ALL
 SELECT 'C16'::text AS code,
    'Role de recette sans densite sur la qualite'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c16) AS anomalies
UNION ALL
 SELECT 'C17'::text AS code,
    'Reference active sans recette (orpheline)'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c17) AS anomalies
UNION ALL
 SELECT 'C18'::text AS code,
    'Qualite planifiee sans densite de role'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c18) AS anomalies
UNION ALL
 SELECT 'C19'::text AS code,
    'Devise catalogue sans taux de change en vigueur'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c19) AS anomalies
UNION ALL
 SELECT 'C20'::text AS code,
    'Reference classe A mono-source'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c20) AS anomalies
UNION ALL
 SELECT 'C21'::text AS code,
    'Role avec densite mais sans matiere en recette'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c21) AS anomalies
UNION ALL
 SELECT 'C22'::text AS code,
    'Groupe d''equivalence aux references non interchangeables'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c22) AS anomalies
UNION ALL
 SELECT 'C23'::text AS code,
    'Groupe d''equivalence sans reference preferentielle'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c23) AS anomalies
UNION ALL
 SELECT 'C24'::text AS code,
    'Reception d''une autre reference sans substitution declaree'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c24) AS anomalies
UNION ALL
 SELECT 'C26'::text AS code,
    'Groupe d''equivalence limite a un seul fournisseur'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c26) AS anomalies
UNION ALL
 SELECT 'C28'::text AS code,
    'Commande en retard : hors couverture tant qu aucune nouvelle date n existe (moteur de couverture)'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c28) AS anomalies
UNION ALL
 SELECT 'C29'::text AS code,
    'Besoins plus anciens que le plan : projection perimee'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c29) AS anomalies
UNION ALL
 SELECT 'C30'::text AS code,
    'Delai fournisseur absent, nul ou negatif'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c30) AS anomalies
UNION ALL
 SELECT 'C31'::text AS code,
    'Reception validee non repercutee au stock'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c31) AS anomalies
UNION ALL
 SELECT 'C32'::text AS code,
    'Reception valorisee absente de l''historique des prix'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c32) AS anomalies
UNION ALL
 SELECT 'C33'::text AS code,
    'Emplacement de machine au-dela de sa capacite'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c33) AS anomalies
UNION ALL
 SELECT 'C34'::text AS code,
    'Machine au-dela de sa capacite totale'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c34) AS anomalies
UNION ALL
 SELECT 'C35'::text AS code,
    'Estimation de poids hors tolerance en machine'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c35) AS anomalies
UNION ALL
 SELECT 'C36'::text AS code,
    'Emplacement de machine sans inventaire recent'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c36) AS anomalies
UNION ALL
 SELECT 'C37'::text AS code,
    'Bobines sans kilos, ou kilos sans bobines, en machine'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c37) AS anomalies
UNION ALL
 SELECT 'C38'::text AS code,
    'Machine : consommation negative'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c38) AS anomalies
UNION ALL
 SELECT 'C39'::text AS code,
    'Machine : etage different de sa derniere decision'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c39) AS anomalies
UNION ALL
 SELECT 'C40'::text AS code,
    'Machine : ecart non qualifie a revoir'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c40) AS anomalies
UNION ALL
 SELECT 'C41'::text AS code,
    'Machine : regularisation (constat superieur a l''attendu)'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c41) AS anomalies
UNION ALL
 SELECT 'C42'::text AS code,
    'Machine : annulation sans mouvement d''origine'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c42) AS anomalies
UNION ALL
 SELECT 'C43'::text AS code,
    'Colisage incoherent sur un document d''achat ouvert'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c43) AS anomalies
UNION ALL
 SELECT 'C44'::text AS code,
    'Plus d''un inventaire en cours sur un magasin'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c44) AS anomalies
UNION ALL
 SELECT 'C45'::text AS code,
    'Ligne de bon recue a la fois en local et a l''import'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c45) AS anomalies
UNION ALL
 SELECT 'C46'::text AS code,
    'Champ sensible sans ligne dans le modele de droits d''un role'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c46) AS anomalies
UNION ALL
 SELECT 'C47'::text AS code,
    'Fil prete a une autre usine, non rendu dans le delai'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c47) AS anomalies
UNION ALL
 SELECT 'C48'::text AS code,
    'Chargement : fil charge deja consomme (a relire)'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c48) AS anomalies
UNION ALL
 SELECT 'C50'::text AS code,
    'Moyenne du plan eloignee de plus de 50 % de la consommation reelle'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c50) AS anomalies
UNION ALL
 SELECT 'C51'::text AS code,
    'Reference suivie au lot avec du fil sans lot, a identifier'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c51) AS anomalies
UNION ALL
 SELECT 'C52'::text AS code,
    'Reception validee dont une entree est contre-passee'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c52) AS anomalies
UNION ALL
 SELECT 'C53'::text AS code,
    'Paiement d''import date avant le dedouanement'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c53) AS anomalies
UNION ALL
 SELECT 'C54'::text AS code,
    'Transfert en route depuis trop longtemps'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c54) AS anomalies
UNION ALL
 SELECT 'C55'::text AS code,
    'Document non validé daté d''une période close'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c55) AS anomalies
UNION ALL
 SELECT 'C56'::text AS code,
    'Ligne d''import sans position tarifaire'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c56) AS anomalies
UNION ALL
 SELECT 'C57'::text AS code,
    'Reference sur plusieurs bons ouverts, dont un sert le plan d''achat'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c57) AS anomalies
UNION ALL
 SELECT 'C58'::text AS code,
    'Ligne de bon recue au-dela de sa commande et de la tolerance'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c58) AS anomalies
UNION ALL
 SELECT 'C59'::text AS code,
    'Prix confirme par le fournisseur different du prix d''avant la demande'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c59) AS anomalies
UNION ALL
 SELECT 'C60'::text AS code,
    'Meme reference sur plusieurs lignes actives d''un bon de commande'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c60) AS anomalies
UNION ALL
 SELECT 'C61'::text AS code,
    'OF cloture dont la consommation reelle s''ecarte du prevu'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c61) AS anomalies
UNION ALL
 SELECT 'C64'::text AS code,
    'OF au-dela du plan de production (qualite et mois)'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c64) AS anomalies
UNION ALL
 SELECT 'C62'::text AS code,
    'Consommation directe sans OF ni qualite (historique) : non attribuee'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c62) AS anomalies
UNION ALL
 SELECT 'C63'::text AS code,
    'Ligne d''etage au-dela de la capacite de sa voie, ou voies plus larges que la machine'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c63) AS anomalies
UNION ALL
 SELECT 'C65'::text AS code,
    'Mouvement daté de la période de comptage d''un inventaire clôturé'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c65) AS anomalies
UNION ALL
 SELECT 'C66'::text AS code,
    'Transfert en route sans date prevue de disponibilite (hors couverture)'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM v_ctl_c66) AS anomalies;
ALTER VIEW v_controles OWNER TO gestionfil;

CREATE VIEW v_cockpit_files AS
 SELECT ( SELECT count(*) AS count
           FROM plan_achat
          WHERE plan_achat.statut = ANY (ARRAY['PROPOSE'::text, 'EN_REVISION'::text])) AS nb_propositions_a_traiter,
    ( SELECT count(*) AS count
           FROM bon_commande
          WHERE bon_commande.statut = 'BROUILLON'::text) AS nb_bc_en_preparation,
    ( SELECT count(*) AS count
           FROM bon_commande
          WHERE bon_commande.statut = 'EN_ATTENTE_VALIDATION'::text) AS nb_bc_a_valider,
    ( SELECT round(COALESCE(sum(bon_commande.montant_total_mad), 0::numeric), 2) AS round
           FROM bon_commande
          WHERE bon_commande.statut = 'EN_ATTENTE_VALIDATION'::text) AS montant_bc_a_valider_mad,
    ( SELECT count(*) AS count
           FROM bon_commande
          WHERE bon_commande.statut = 'VALIDE'::text) AS nb_bc_a_envoyer,
    ( SELECT count(*) AS count
           FROM bon_commande
          WHERE (bon_commande.statut = ANY (ARRAY['ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND bon_commande.date_livraison_prevue::text IS NOT NULL AND substr(bon_commande.date_livraison_prevue::text, 1, 10) < to_char(CURRENT_DATE::timestamp with time zone, 'YYYY-MM-DD'::text)) AS nb_livraisons_en_retard,
    ( SELECT COALESCE(max((CURRENT_DATE - bon_commande.date_livraison_prevue::text::date)::bigint), 0::bigint) AS "coalesce"
           FROM bon_commande
          WHERE (bon_commande.statut = ANY (ARRAY['ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND bon_commande.date_livraison_prevue::text IS NOT NULL AND substr(bon_commande.date_livraison_prevue::text, 1, 10) < to_char(CURRENT_DATE::timestamp with time zone, 'YYYY-MM-DD'::text)) AS retard_max_jours,
    ( SELECT count(*) AS count
           FROM reception
          WHERE reception.statut = 'BROUILLON'::text) AS nb_receptions_en_saisie,
    (( SELECT count(*) AS count
           FROM reception
          WHERE reception.statut = 'A_CONTROLER'::text)) + (( SELECT count(*) AS count
           FROM import_receptions
          WHERE import_receptions.statut = 'A_CONTROLER'::text)) AS nb_receptions_a_controler,
    ( SELECT count(*) AS count
           FROM ligne_reception lr
             JOIN reception rc ON rc.id_reception = lr.id_reception
          WHERE (rc.statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text])) AND lr.statut_qualite <> 'CONFORME'::text) AS nb_lignes_non_conformes,
    ( SELECT count(DISTINCT rc.id_reception) AS count
           FROM reception rc
             JOIN ligne_reception lr ON lr.id_reception = rc.id_reception
             JOIN ligne_bc lb ON lb.id_ligne_bc = lr.id_ligne_bc
             JOIN bon_commande bc ON bc.id_bc = lb.id_bc
          WHERE (rc.statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text])) AND (bc.statut = ANY (ARRAY['BROUILLON'::text, 'EN_CONTROLE'::text, 'DEMANDE_PRIX'::text, 'EN_ATTENTE_VALIDATION'::text, 'VALIDE'::text]))) AS nb_receptions_a_regulariser,
    ( SELECT count(*) AS count
           FROM v_stock_dormant) AS nb_refs_dormantes,
    ( SELECT round(COALESCE(sum(v_stock_dormant.valeur_mad), 0::numeric), 2) AS round
           FROM v_stock_dormant) AS valeur_dormante_mad,
    ( SELECT count(*) AS count
           FROM v_lot_fefo
          WHERE v_lot_fefo.jours_avant_peremption IS NOT NULL AND v_lot_fefo.jours_avant_peremption <= 90) AS nb_lots_peremption_proche,
    ( SELECT count(*) AS count
           FROM v_controles
          WHERE v_controles.criticite = 'BLOQUANT'::text AND v_controles.anomalies > 0) AS nb_controles_bloquants,
    ( SELECT count(*) AS count
           FROM v_controles
          WHERE v_controles.criticite = 'CRITIQUE'::text AND v_controles.anomalies > 0) AS nb_controles_critiques,
    ( SELECT count(*) AS count
           FROM alerte
          WHERE alerte.statut = 'OUVERTE'::text) AS nb_alertes_ouvertes,
    ( SELECT count(*) AS count
           FROM bon_commande
          WHERE bon_commande.statut = 'EN_CONTROLE'::text) AS nb_bc_au_controle,
    ( SELECT count(*) AS count
           FROM bon_commande
          WHERE bon_commande.statut = 'DEMANDE_PRIX'::text) AS nb_bc_demande_prix;
ALTER VIEW v_cockpit_files OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 3. Le paramètre mort : P_MrpInclureStockMachine
-- -----------------------------------------------------------------------------
-- Plus aucune lecture (ni vue, ni serveur) : le fil sur machine compte toujours,
-- au dernier constat. Sa suppression est journalisée (trg_audit_suppression) ;
-- son historique de valeurs, s'il en a, part avec lui.
DELETE FROM parametre_historique WHERE code_parametre = 'P_MrpInclureStockMachine';
DELETE FROM parametre WHERE code_parametre = 'P_MrpInclureStockMachine';

-- -----------------------------------------------------------------------------
-- 4. La photo d'un plan porte l'état du moteur
-- -----------------------------------------------------------------------------
ALTER TABLE snapshot_mrp DROP CONSTRAINT IF EXISTS snapshot_mrp_statut_couleur_check;
ALTER TABLE snapshot_mrp ADD CONSTRAINT snapshot_mrp_statut_couleur_check
    CHECK (statut_couleur IS NULL OR statut_couleur IN
           ('PLAN_NON_COUVERT', 'SOUS_SECURITE', 'COUVERT',
            -- l'historique d'avant le 27/10/2026
            'RUPTURE', 'CRITIQUE', 'ATTENTION', 'OK'));
COMMENT ON COLUMN snapshot_mrp.stock_projete_kg IS
    'Solde projeté par le moteur de couverture en fin de mois (depuis le 27/10/2026 ; avant : stock projeté de v_stock_projete).';
COMMENT ON COLUMN snapshot_mrp.statut_couleur IS
    'État du mois au moteur de couverture : PLAN_NON_COUVERT, SOUS_SECURITE, COUVERT (depuis le 27/10/2026 ; avant : RUPTURE, CRITIQUE, ATTENTION, OK).';

-- -----------------------------------------------------------------------------
-- 5. Les champs à l'écran
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'PLAN_ACHAT', c.champ, c.libelle, 'LECTURE', 0, 982
  FROM (VALUES ('defaut_donnees',         'Défaut de données'),
               ('a_commander_aujourdhui', 'À commander aujourd''hui'),
               ('arrivages_comptes_kg',   'Arrivages comptés (kg)'),
               ('nb_plan_non_couvert',    'Références au plan non couvert'),
               ('plan_mois_kg',           'Plan / mois (kg)')
       ) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- Le stock projeté et l'état des stocks montrent les colonnes du moteur : mêmes
-- libellés qu'au plan d'achat.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'STOCK', cc.champ, cc.libelle, cc.niveau_defaut, cc.sensible, 985
  FROM champ_configurable cc
 WHERE cc.module = 'PLAN_ACHAT'
   AND cc.champ IN ('disponible_kg', 'magasin_kg', 'machine_kg', 'plan_horizon_kg', 'couvert_jusqu_au',
                    'couvert_tout_horizon', 'premiere_rupture', 'plan_non_couvert_kg',
                    'premier_passage_securite', 'prochain_arrivage_date', 'prochain_arrivage_kg',
                    'delai_j', 'couverture_commande_j', 'jours_securite', 'qte_a_commander_kg',
                    'date_disponibilite', 'date_limite_commande', 'restes_kg', 'quarantaine_kg',
                    'bloque_kg', 'hors_plan_kg', 'en_retard_kg', 'sans_date_kg', 'transit_kg',
                    'non_valide_kg', 'apres_horizon_kg', 'defaut_donnees', 'a_commander_aujourdhui',
                    'arrivages_comptes_kg', 'plan_mois_kg', 'classe_abc', 'classe_xyz', 'fournisseur_nom')
ON CONFLICT DO NOTHING;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'COCKPIT', c.champ, c.libelle, 'LECTURE', 0, 990
  FROM (VALUES ('nb_plan_non_couvert',       'Références au plan non couvert'),
               ('nb_sous_securite',          'Références sous la sécurité'),
               ('nb_couvert',                'Références couvertes'),
               ('nb_a_commander_aujourdhui', 'À commander aujourd''hui'),
               ('nb_classe_a_en_rupture',    'Classe A au plan non couvert'),
               ('premiere_rupture',          '1re rupture'),
               ('couvert_jusqu_au',          'Couvert jusqu''au'),
               ('plan_non_couvert_kg',       'Plan non couvert (kg)'),
               ('plan_horizon_kg',           'Plan sur l''horizon (kg)'),
               ('jours_couverture',          'Jours couverts'),
               ('qte_a_commander_kg',        'À commander (kg)'),
               ('date_limite_commande',      'Commander au plus tard le'),
               ('a_commander_aujourdhui',    'À commander aujourd''hui'),
               ('securite_kg',               'Sécurité (kg)'),
               ('plan_mois_kg',              'Plan / mois (kg)')
       ) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Témoin : l'ancien calcul est parti, tout le reste est là
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_manquantes text;
    v_restees    text;
BEGIN
    SELECT string_agg(v, ', ') INTO v_manquantes
      FROM unnest(ARRAY['v_stock_physique', 'v_stock_reference', 'v_equivalence', 'v_etat_stock',
                        'v_etat_stock_conditionne', 'v_analyse_abc_xyz', 'v_cockpit_devise',
                        'v_cockpit_economies', 'v_cockpit_mono_source', 'v_cockpit_pareto',
                        'v_risque_sourcing', 'v_substitution_dispo', 'v_supervision_valeurs',
                        'v_supervision', 'v_ctl_c28', 'v_ctl_c66', 'v_controles', 'v_cockpit_files',
                        'v_besoin_12m', 'v_besoin_mois', 'v_besoin_mrp_calcule', 'v_conso_retenue',
                        'v_stock_min_dynamique', 'v_stock_disponible', 'v_groupe_equiv_detail',
                        'v_stat_mouvement_reference', 'v_besoin_of', 'v_besoin_of_qualite']) v
     WHERE to_regclass('public.' || v) IS NULL;
    IF v_manquantes IS NOT NULL THEN
        RAISE EXCEPTION '2026-10-27e : vues manquantes après la migration : %', v_manquantes;
    END IF;

    SELECT string_agg(v, ', ') INTO v_restees
      FROM unnest(ARRAY['v_stock_projete', 'v_plan_achat', 'v_encours_fiable', 'v_besoin_horizon',
                        'v_besoin_horizon_of', 'v_besoin_of_mois', 'v_risque_mensuel',
                        'v_risque_reference', 'v_cockpit_stock', 'v_cockpit_couverture',
                        'v_ctl_c05', 'v_ctl_c25', 'v_ctl_c27', 'v_ctl_c49']) v
     WHERE to_regclass('public.' || v) IS NOT NULL;
    IF v_restees IS NOT NULL THEN
        RAISE EXCEPTION '2026-10-27e : l''ancien calcul est encore là : %', v_restees;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'v_stock_physique' AND column_name = 'stock_mrp_net_kg')
       OR EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_MrpInclureStockMachine')
       OR EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public'
                   AND definition ~ 'P_MrpInclureStockMachine|v_stock_projete|v_plan_achat|v_encours_fiable|v_besoin_horizon')
       OR NOT EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'PLAN_ACHAT' AND champ = 'defaut_donnees')
       OR NOT EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'STOCK' AND champ = 'premiere_rupture')
       OR NOT EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'COCKPIT' AND champ = 'nb_plan_non_couvert')
       OR (SELECT count(*) FROM champ_configurable WHERE champ = 'plan_mois_kg'
            AND module IN ('PLAN_ACHAT', 'STOCK', 'COCKPIT')) <> 3 THEN
        RAISE EXCEPTION '2026-10-27e : migration incomplète';
    END IF;
END $$;

COMMIT;
