-- =============================================================================
-- 2026-10-05b — Recommandations de l'audit du 05/10/2026, acceptees ce jour
-- =============================================================================
-- 1. Besoins a l'horizon : le seul plan en service (plus les plans clotures ni
--    les simulations), C29 sans la clause de date.
-- 2. Consommation reelle : sorties de production ET consommation des metiers.
-- 3. Fil sur machine : une vue par reference, affichee comme stock engage.
-- 4. Annuler une entree retire ses kilos A LEUR PRIX, dans leur magasin (SAP),
--    au lieu de refaire le CMUP sur tout l'historique.
-- 5. Un seul inventaire ouvert par magasin (refus a l'ouverture, cote serveur).
--
-- Rejouable : CREATE OR REPLACE partout, aucun objet supprime.
-- A jouer apres 2026-10-05_decisions_machine.sql.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1a. LES BESOINS A L'HORIZON NE VIENNENT QUE DU PLAN EN SERVICE
-- -----------------------------------------------------------------------------
-- La jointure ne portait que sur la reference et le mois : les plans clotures
-- et les simulations s'ajoutaient au plan en service (964 t au lieu de 423 t
-- sur la base d'essai, 48 alertes C05 au lieu de 30).
CREATE OR REPLACE VIEW v_besoin_horizon AS
 WITH p AS (
         SELECT ( SELECT parametre.valeur_courante::numeric AS valeur_courante
                   FROM parametre
                  WHERE parametre.code_parametre = 'P_DelaiDefaut'::text) AS delai_defaut,
            ( SELECT parametre.valeur_courante::numeric AS valeur_courante
                   FROM parametre
                  WHERE parametre.code_parametre = 'P_MargeJours'::text) AS marge_jours
        ), mois AS (
         SELECT i.i,
            to_char(date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) + (((i.i - 1) || ' month'::text)::interval), 'YYYY-MM'::text) AS annee_mois
           FROM generate_series(1, 12) i(i)
        ), fenetre AS (
         SELECT r.code_reference,
            COALESCE(f.delai_livraison_jours::numeric, p.delai_defaut) AS lead_j,
            COALESCE(f.couverture_commande_j::numeric, p.marge_jours) AS couv_j
           FROM reference r
             LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
             CROSS JOIN p
        ), besoin AS (
         SELECT bm.code_reference, bm.annee_mois, bm.quantite_kg
           FROM besoin_mrp bm
           JOIN plan_production pp ON pp.id_plan = bm.id_plan
          WHERE pp.statut = 'EN_COURS'
        )
 SELECT w.code_reference,
    w.lead_j,
    w.couv_j,
    round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.i::numeric * 30.0, w.lead_j) - (m.i - 1)::numeric * 30.0) / 30.0), 0::numeric), 4) AS dem_lead_kg,
    round(COALESCE(sum(bm.quantite_kg * GREATEST(0::numeric, LEAST(m.i::numeric * 30.0, w.lead_j + w.couv_j) - GREATEST((m.i - 1)::numeric * 30.0, w.lead_j)) / 30.0), 0::numeric), 4) AS sorties_prevues_kg
   FROM fenetre w
     CROSS JOIN mois m
     LEFT JOIN besoin bm ON bm.code_reference = w.code_reference AND bm.annee_mois = m.annee_mois
  GROUP BY w.code_reference, w.lead_j, w.couv_j;
ALTER VIEW v_besoin_horizon OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 1b. C29 : les besoins sont perimes si les KILOS different, pas si la date
--     du plan a bouge. Mettre un plan en service touchait sa date de
--     modification et levait C29 sans aucun changement de besoin.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_besoins_perimes(p_plan text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    SELECT NOT EXISTS (SELECT 1 FROM besoin_mrp b WHERE b.id_plan = p_plan)
        -- Le fond du controle : les kilos enregistres et ceux que les recettes
        -- donneraient maintenant. La tolerance est celle de l'arrondi au gramme.
        OR EXISTS (
            SELECT 1 FROM (
                SELECT code_reference, annee_mois, SUM(quantite_kg) AS kg
                  FROM besoin_mrp WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois
                EXCEPT
                SELECT code_reference, annee_mois, SUM(quantite_kg)
                  FROM v_besoin_mrp_calcule WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois) x)
        OR EXISTS (
            SELECT 1 FROM (
                SELECT code_reference, annee_mois, SUM(quantite_kg) AS kg
                  FROM v_besoin_mrp_calcule WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois
                EXCEPT
                SELECT code_reference, annee_mois, SUM(quantite_kg)
                  FROM besoin_mrp WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois) y)
$function$;

-- -----------------------------------------------------------------------------
-- 2. LA CONSOMMATION REELLE COMPTE LES METIERS
-- -----------------------------------------------------------------------------
-- Les sorties de production (4 t sur la base d'essai) ne disaient presque rien :
-- le fil part sur les machines. La consommation d'un metier est l'ecart que
-- les decisions actives ont qualifie « consommation » (modele du 05/10/2026).
-- Les colonnes d'origine gardent leur nom et leur place ; deux s'ajoutent.
CREATE OR REPLACE VIEW v_conso_reelle AS
 WITH conso AS (
         SELECT lm.code_reference,
            lm.quantite_kg AS kg_prod,
            0::numeric AS kg_machine,
            m.date_mouvement AS quand
           FROM ligne_mouvement lm
             JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
             JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
          WHERE tm.signe = '-1'::integer AND m.code_type_mvt = 'SORTIE_PROD'::text
        UNION ALL
         SELECT e.code_reference,
            0::numeric,
            e.ecart_kg,
            e.date_decision
           FROM v_machine_ecart e
          WHERE e.effet_ecart = 'CONSOMMATION' AND e.ecart_kg > 0
        )
 SELECT code_reference,
    round(sum(kg_prod + kg_machine), 4) AS sorties_cumulees_kg,
    GREATEST(1::bigint, ((CURRENT_DATE - min(substr(quand, 1, 10))::date)::numeric / 30.44)::bigint) AS nb_mois_ecoules,
    round(sum(kg_prod + kg_machine) / GREATEST(1::bigint, ((CURRENT_DATE - min(substr(quand, 1, 10))::date)::numeric / 30.44)::bigint)::numeric, 4) AS conso_mensuelle_kg,
    min(quand) AS premiere_sortie,
    max(quand) AS derniere_sortie,
    round(sum(kg_prod), 4) AS sorties_prod_kg,
    round(sum(kg_machine), 4) AS conso_machine_kg
   FROM conso
  GROUP BY code_reference;
ALTER VIEW v_conso_reelle OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 3. LE FIL SUR MACHINE, PAR REFERENCE
-- -----------------------------------------------------------------------------
-- Affiche a cote du stock comme stock ENGAGE : il n'est plus au magasin et
-- n'est pas encore consomme. Il n'est pas deduit des besoins tant que les
-- ordres de fabrication n'existent pas (decision du 05/10/2026).
CREATE OR REPLACE VIEW v_stock_machine AS
 SELECT e.code_reference,
    round(sum(e.kg), 4) AS kg_sur_machine,
    sum(e.nb_bobines)::bigint AS bobines_sur_machine,
    count(DISTINCT e.code_emplacement)::bigint AS nb_zones
   FROM machine_etat e
  GROUP BY e.code_reference;
ALTER VIEW v_stock_machine OWNER TO gestionfil;

-- La colonne de l'ecran Stock : un champ non declare est masque a l'ecran. Il se
-- voit la ou se voit la quantite en stock, ni plus ni moins.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('STOCK', 'kg_sur_machine', 'Fil sur machine (kg)', 'LECTURE', 0, 45)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'STOCK', 'kg_sur_machine',
       CASE WHEN m.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM modele_droit_champ m WHERE m.module = 'STOCK' AND m.champ = 'quantite_kg'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'STOCK', 'kg_sur_machine',
       CASE WHEN d.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM droit_champ d WHERE d.module = 'STOCK' AND d.champ = 'quantite_kg'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. ANNULER UNE ENTREE, AU PRIX DE L'ENTREE, DANS SON MAGASIN
-- -----------------------------------------------------------------------------
-- La contre-passation d'une entree a deja retire les kilos (ligne inverse, sans
-- prix : le CMUP n'a pas bouge). Il reste a retirer leur VALEUR, a leur prix :
--     CMUP' = (Q'·C + q·C − q·p) / Q'      ou Q' est le stock apres retrait.
-- Les autres magasins ne bougent pas ; les frais d'import, ecrits au CMUP a la
-- cloture, restent dedans. Annuler une SORTIE ne touche pas au CMUP.
-- Si la valeur restante deviendrait negative (stock deja presque sorti), le
-- CMUP reste tel quel : il n'y a plus assez de kilos pour porter l'ecart.
CREATE OR REPLACE FUNCTION fn_cmup_annuler_entree(p_reference text, p_magasin text,
                                                  p_kg numeric, p_prix numeric)
RETURNS numeric
LANGUAGE plpgsql AS $$
DECLARE
    v_q     numeric;
    v_c     numeric;
    v_neuf  numeric;
    v_fiche numeric;
    v_quand text := to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    SELECT quantite_kg, cmup_mad INTO v_q, v_c
      FROM stock_magasin
     WHERE code_reference = p_reference AND code_magasin = p_magasin
       FOR UPDATE;
    IF v_c IS NULL OR p_prix IS NULL OR p_kg IS NULL OR v_q IS NULL OR v_q <= 0.0001 THEN
        RETURN v_c;
    END IF;
    v_neuf := round((v_q * v_c + p_kg * v_c - p_kg * p_prix) / v_q, 4);
    IF v_neuf <= 0 THEN
        RETURN v_c;
    END IF;
    UPDATE stock_magasin
       SET cmup_mad = v_neuf, date_maj = v_quand
     WHERE code_reference = p_reference AND code_magasin = p_magasin;
    -- La fiche article suit, comme a chaque entree : moyenne des magasins.
    SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / NULLIF(SUM(sm.quantite_kg), 0), 4)
      INTO v_fiche
      FROM stock_magasin sm
     WHERE sm.code_reference = p_reference AND sm.quantite_kg > 0 AND sm.cmup_mad IS NOT NULL;
    IF v_fiche IS NOT NULL THEN
        UPDATE reference SET cmup_mad = v_fiche, date_dernier_cmup = v_quand
         WHERE code_reference = p_reference AND cmup_mad IS DISTINCT FROM v_fiche;
    END IF;
    RETURN v_neuf;
END $$;
ALTER FUNCTION fn_cmup_annuler_entree(text, text, numeric, numeric) OWNER TO gestionfil;

COMMENT ON FUNCTION fn_cmup_annuler_entree(text, text, numeric, numeric) IS
  'Retire la valeur d''une entree annulee a son prix d''origine, dans son seul magasin (05/10/2026).';

SELECT 'recommandations audit : '
       || (SELECT count(*) FROM v_besoin_horizon WHERE dem_lead_kg > 0) || ' references avec besoin a l''horizon, '
       || (SELECT count(*) FROM v_stock_machine) || ' references sur machine';

COMMIT;
