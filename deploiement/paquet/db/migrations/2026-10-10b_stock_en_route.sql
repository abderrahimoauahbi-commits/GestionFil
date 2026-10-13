-- =============================================================================
-- 2026-10-10b — Le fil en route compte (transfert expedie, pas encore recu)
-- =============================================================================
-- Un transfert entre magasins se valide deux fois : l'expedition sort le fil du
-- magasin de depart, la reception le fait entrer a l'arrivee. Entre les deux,
-- parfois plusieurs jours, il n'est dans AUCUN magasin (domain/transfert.rs).
-- v_stock_transit le listait, mais personne ne le lisait :
--   * le calcul des besoins (v_stock_physique) ne le voyait pas : pendant le
--     trajet, le plan d'achat pouvait proposer de racheter ce qui roule ;
--   * la valeur du stock du cockpit baissait du montant transporte, puis
--     remontait a l'arrivee.
-- Comme dans les ERP du marche, le stock en route reste compte :
--   1. v_stock_physique : colonne stock_transit_kg, ajoutee a stock_mrp_net_kg
--      (magasin de destination au MRP et hors quarantaine) ;
--   2. v_stock_transit_reference : kg et valeur en route par reference (au CMUP
--      fige au depart, qui voyage avec la marchandise) ;
--   3. v_cockpit_stock.valeur_stock_mad : magasins + en route ;
--   4. C54 (signal) : un transfert en route depuis plus de P_TransitJoursAlerte
--      jours (7 par defaut) — camion perdu ou reception oubliee.
-- Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Le calcul des besoins voit le fil en route ----------------------------------
CREATE OR REPLACE VIEW v_stock_physique AS
 WITH hors_mrp AS (
         SELECT sl.code_reference,
            sum(
                CASE
                    WHEN ((l.categorie = 'RESTES'::text) AND (rr.suivi_lot = 1) AND (l.statut <> 'BLOQUE'::text)) THEN sl.quantite_kg
                    ELSE (0)::numeric
                END) AS restes_kg,
            sum(
                CASE
                    WHEN (l.statut = 'BLOQUE'::text) THEN sl.quantite_kg
                    ELSE (0)::numeric
                END) AS bloque_kg
           FROM (((public.stock_lot sl
             JOIN public.lot l ON (((l.code_reference = sl.code_reference) AND (l.lot_fournisseur = sl.lot_fournisseur))))
             JOIN public.reference rr ON ((rr.code_reference = sl.code_reference)))
             JOIN public.magasin mg_1 ON ((mg_1.code_magasin = sl.code_magasin)))
          WHERE ((mg_1.inclure_mrp = 1) AND (mg_1.est_quarantaine = 0))
          GROUP BY sl.code_reference
        ), machine AS (
         SELECT e.code_reference,
            round(sum(e.kg), 4) AS kg_sur_machine
           FROM (public.machine_etat e
             LEFT JOIN public.lot l ON (((l.code_reference = e.code_reference) AND (l.lot_fournisseur = e.lot_fournisseur))))
          WHERE ((COALESCE(( SELECT parametre.valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_MrpInclureStockMachine'::text)), '1'::text) = '1'::text) AND (COALESCE(l.statut, 'LIBRE'::text) <> 'BLOQUE'::text) AND ((substr(COALESCE(e.date_constat, '1900-01-01'::text), 1, 10))::date >= (CURRENT_DATE - COALESCE(( SELECT (parametre.valeur_courante)::integer AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_JoursInventMachine'::text)), 30))))
          GROUP BY e.code_reference
        ), en_route AS (
         -- LE FIL EN ROUTE (10/10/2026) : expedie, pas encore receptionne. Il
         -- compte pour son magasin de DESTINATION, si celui-ci entre au MRP.
         SELECT lt.code_reference,
            round(sum(lt.quantite_kg), 4) AS kg
           FROM ((public.transfert t
             JOIN public.ligne_transfert lt ON ((lt.id_transfert = t.id_transfert)))
             JOIN public.magasin md ON ((md.code_magasin = t.code_magasin_dest)))
          WHERE ((t.statut = 'VALIDE'::text) AND (md.inclure_mrp = 1) AND (md.est_quarantaine = 0))
          GROUP BY lt.code_reference
        )
 SELECT r.code_reference,
    round(COALESCE(sum(
        CASE
            WHEN ((mg.inclure_mrp = 1) AND (mg.est_quarantaine = 0)) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric), 4) AS stock_utilisable_kg,
    round(COALESCE(sum(
        CASE
            WHEN (mg.est_quarantaine = 1) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric), 4) AS stock_quarantaine_kg,
    round((COALESCE(max(h.restes_kg), (0)::numeric) + COALESCE(max(h.bloque_kg), (0)::numeric)), 4) AS stock_reserve_kg,
    round(((COALESCE(sum(
        CASE
            WHEN ((mg.inclure_mrp = 1) AND (mg.est_quarantaine = 0)) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric) - COALESCE(max(h.restes_kg), (0)::numeric)) - COALESCE(max(h.bloque_kg), (0)::numeric)), 4) AS stock_physique_net_kg,
    round(COALESCE(max(h.restes_kg), (0)::numeric), 4) AS stock_restes_kg,
    round(COALESCE(max(h.bloque_kg), (0)::numeric), 4) AS stock_bloque_kg,
    round(COALESCE(max(mc.kg_sur_machine), (0)::numeric), 4) AS stock_machine_kg,
    round((((COALESCE(sum(
        CASE
            WHEN ((mg.inclure_mrp = 1) AND (mg.est_quarantaine = 0)) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric) - COALESCE(max(h.restes_kg), (0)::numeric)) - COALESCE(max(h.bloque_kg), (0)::numeric)) + COALESCE(max(mc.kg_sur_machine), (0)::numeric) + COALESCE(max(er.kg), (0)::numeric)), 4) AS stock_mrp_net_kg,
    round(COALESCE(max(er.kg), (0)::numeric), 4) AS stock_transit_kg
   FROM ((((public.reference r
     LEFT JOIN public.stock_magasin sm ON ((sm.code_reference = r.code_reference)))
     LEFT JOIN public.magasin mg ON ((mg.code_magasin = sm.code_magasin)))
     LEFT JOIN hors_mrp h ON ((h.code_reference = r.code_reference)))
     LEFT JOIN machine mc ON ((mc.code_reference = r.code_reference)))
     LEFT JOIN en_route er ON ((er.code_reference = r.code_reference))
  WHERE (r.actif = 1)
  GROUP BY r.code_reference;
ALTER VIEW v_stock_physique OWNER TO gestionfil;

-- 2. Le fil en route par reference -----------------------------------------------
CREATE OR REPLACE VIEW v_stock_transit_reference AS
SELECT code_reference,
       round(sum(quantite_kg), 4) AS kg_en_route,
       round(sum(valeur_mad), 2)  AS valeur_en_route_mad,
       count(DISTINCT id_transfert) AS nb_transferts
  FROM v_stock_transit
 GROUP BY code_reference;
ALTER VIEW v_stock_transit_reference OWNER TO gestionfil;

-- 3. La valeur du stock du cockpit : magasins + en route ----------------------------
DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_cockpit_stock'::regclass);
    IF position('v_stock_transit' IN def) = 0 THEN
        def := regexp_replace(def, 'FROM (public\.)?stock_magasin\) AS valeur_stock_mad',
                              'FROM stock_magasin) + ( SELECT COALESCE(sum(v_stock_transit.valeur_mad), (0)::numeric) '
                              'FROM v_stock_transit) AS valeur_stock_mad');
        IF position('v_stock_transit' IN def) = 0 THEN
            RAISE EXCEPTION 'v_cockpit_stock : la valeur du stock n''a pas ete trouvee, migration a revoir';
        END IF;
        EXECUTE 'CREATE OR REPLACE VIEW v_cockpit_stock AS ' || def;
    END IF;
END $$;

-- 4. C54 : un transfert en route depuis trop longtemps ------------------------------
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
                       categorie, modifiable_par) VALUES
  ('P_TransitJoursAlerte', 'Transfert en route : delai avant alerte', '7', 'ENTIER', 'jours',
   'Au-dela, le controle C54 signale un transfert expedie et toujours pas receptionne (il ne bloque rien).',
   'STOCK', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

CREATE OR REPLACE VIEW v_ctl_c54 AS
SELECT t.numero_transfert, t.code_magasin_source, t.code_magasin_dest,
       substr(COALESCE(t.date_sortie, t.date_transfert), 1, 10) AS date_expedition,
       (CURRENT_DATE - substr(COALESCE(t.date_sortie, t.date_transfert), 1, 10)::date) AS jours_en_route
  FROM transfert t
 WHERE t.statut = 'VALIDE'
   AND (CURRENT_DATE - substr(COALESCE(t.date_sortie, t.date_transfert), 1, 10)::date)
       > COALESCE((SELECT valeur_courante::int FROM parametre WHERE code_parametre = 'P_TransitJoursAlerte'), 7);
ALTER VIEW v_ctl_c54 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C54' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C54''::text, ''Transfert en route depuis trop longtemps''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c54)';
    END IF;
END $$;

-- 5. La valeur en route est un montant : masquee comme la valeur du stock ---------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES ('CATALOGUE', 'valeur_transit_mad', 'Valeur en route (MAD)', 'LECTURE', 1, 4185)
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'CATALOGUE', 'valeur_transit_mad', m.niveau
  FROM modele_droit_champ m WHERE m.module = 'CATALOGUE' AND m.champ = 'valeur_stock_mad'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'CATALOGUE', 'valeur_transit_mad', d.niveau
  FROM droit_champ d WHERE d.module = 'CATALOGUE' AND d.champ = 'valeur_stock_mad'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
