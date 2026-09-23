-- =============================================================================
-- MIGRATION 2026-09-17i — LES CHIFFRES DU TABLEAU DE BORD, REVERIFIES
-- -----------------------------------------------------------------------------
-- Revue du 17/09/2026 apres « le cout de Shehrazade a 10,2 MAD/m2, c'est
-- impossible ». Chaque indicateur a ete recalcule a la main sur la base locale.
--
-- 1. COUT MATIERE PAR QUALITE. Chaque composant etait valorise a la valeur de
--    SON STOCK EN MAGASIN : sans stock, il coutait ZERO. Shehrazade affichait
--    10,24 MAD/m2 pour 83,62 reels — la Bande, la trame, la colle, le cuir et
--    le plastique etaient gratuits. 16 composants sur 19. YL tombait a 0,00
--    pour 107,71. Le cout se calcule desormais au CMUP de la fiche, qui vaut
--    le prix catalogue tant qu'aucun achat ne l'a fixe (2026-09-17h).
--
-- 2. COUT MATIERE PAR MOIS. Tous les mois du plan etaient sommes, y compris
--    ceux deja passes : la courbe « quand la tresorerie sera sollicitee »
--    parlait aussi du passe. Seuls le mois courant et les suivants restent.
--
-- 3. MONO-SOURCE. Une reference etait « multi-source » des qu'un groupe
--    d'equivalence lui trouvait une autre reference — meme chez le MEME
--    fournisseur. Le plan d'achat et le mur des risques exigeaient deja un
--    autre fournisseur ; le cockpit l'exige aussi.
--
-- 4. FLUX PAR FAMILLE. Les « entrees » comptaient le stock initial et les
--    transferts entre magasins : 292 t « entrees » en 2026 sans un seul achat.
--    Un mouvement interne n'est ni une entree ni une sortie de l'entreprise.
--
-- 5. CHAMPS JAMAIS AFFICHES. « En sur-stock », « Ecarts a verifier » et la
--    valeur par famille n'etaient declares nulle part : pour l'ecran, un champ
--    non declare est masque. Les nouveaux montants du cockpit et du catalogue
--    sont declares avec le meme niveau que le montant voisin, utilisateur par
--    utilisateur : qui ne voit pas le CMUP ne voit pas davantage ces valeurs.
--
-- Rejouable : CREATE OR REPLACE, ON CONFLICT.
-- =============================================================================

BEGIN;

-- --- 1. Cout matiere par qualite, et par role ----------------------------------
CREATE OR REPLACE VIEW v_stat_qualite AS
WITH cout AS (
    SELECT rc.code_qualite,
           COUNT(*)                                         AS nb_composants,
           COUNT(DISTINCT rc.code_role)                     AS nb_roles,
           SUM(CASE WHEN r.cmup_mad IS NULL THEN 1 ELSE 0 END)
                                                            AS nb_sans_cmup,
           ROUND(SUM(rc.kg_m2), 6)                          AS kg_m2_total,
           ROUND(SUM(rc.kg_m2 * COALESCE(r.cmup_mad, 0)), 4) AS cout_matiere_m2_mad
      FROM v_recette_calculee rc
      JOIN reference r ON r.code_reference = rc.code_reference
     GROUP BY rc.code_qualite
),
production AS (
    SELECT lpp.code_qualite,
           ROUND(SUM(lpp.m2_prevus), 0)                     AS m2_prevus,
           ROUND(SUM(COALESCE(lpp.m2_realises, 0)), 0)      AS m2_realises,
           COUNT(*)                                         AS nb_mois_planifies
      FROM ligne_plan_production lpp
      JOIN plan_production pp ON pp.id_plan = lpp.id_plan
     WHERE pp.statut = 'EN_COURS'
     GROUP BY lpp.code_qualite
)
SELECT
    q.code_qualite,
    q.nom                                        AS qualite_nom,
    q.statut,
    q.poids_commercial_m2,
    q.taux_perte_pct,
    COALESCE(c.nb_composants, 0)                 AS nb_composants,
    COALESCE(c.nb_roles, 0)                      AS nb_roles,
    COALESCE(c.nb_sans_cmup, 0)                  AS nb_sans_cmup,
    c.kg_m2_total,
    c.cout_matiere_m2_mad,
    CASE WHEN q.poids_commercial_m2 > 0 AND c.kg_m2_total IS NOT NULL
         THEN ROUND((c.kg_m2_total - q.poids_commercial_m2) / q.poids_commercial_m2 * 100.0, 2)
    END                                          AS ecart_poids_pct,
    COALESCE(p.m2_prevus, 0)                     AS m2_prevus,
    COALESCE(p.m2_realises, 0)                   AS m2_realises,
    COALESCE(p.nb_mois_planifies, 0)             AS nb_mois_planifies,
    CASE WHEN COALESCE(p.m2_prevus, 0) > 0
         THEN ROUND(100.0 * COALESCE(p.m2_realises, 0) / p.m2_prevus, 1) END
                                                 AS taux_realisation_pct,
    CASE WHEN c.cout_matiere_m2_mad IS NOT NULL AND COALESCE(p.m2_prevus, 0) > 0
         THEN ROUND(c.cout_matiere_m2_mad * p.m2_prevus, 2) END
                                                 AS cout_matiere_plan_mad
FROM qualite q
LEFT JOIN cout       c ON c.code_qualite = q.code_qualite
LEFT JOIN production p ON p.code_qualite = q.code_qualite;

CREATE OR REPLACE VIEW v_stat_qualite_role AS
SELECT
    rc.code_qualite,
    rc.code_role,
    rc.role_libelle,
    COUNT(*)                                     AS nb_composants,
    ROUND(SUM(rc.pourcentage_composition), 2)    AS somme_pct,
    ROUND(SUM(rc.kg_m2), 6)                      AS kg_m2,
    ROUND(SUM(rc.kg_m2 * COALESCE(r.cmup_mad, 0)), 4) AS cout_m2_mad
FROM v_recette_calculee rc
JOIN reference r ON r.code_reference = rc.code_reference
GROUP BY rc.code_qualite, rc.code_role, rc.role_libelle;

-- --- 2. Cout matiere par mois : l'horizon a venir -------------------------------
CREATE OR REPLACE VIEW v_cockpit_cout_mensuel AS
SELECT bm.annee_mois,
       ROUND(SUM(bm.quantite_kg), 4)                            AS quantite_kg,
       ROUND(SUM(bm.quantite_kg * COALESCE(r.cmup_mad, 0)), 2)  AS cout_mad,
       COUNT(DISTINCT bm.code_reference)                        AS nb_references
  FROM besoin_mrp bm
  JOIN plan_production pp ON pp.id_plan = bm.id_plan AND pp.statut = 'EN_COURS'
  JOIN reference r        ON r.code_reference = bm.code_reference
 WHERE bm.annee_mois >= to_char(current_date, 'YYYY-MM')
 GROUP BY bm.annee_mois;

-- --- 3. Mono-source : une alternative chez un AUTRE fournisseur -------------------
CREATE OR REPLACE VIEW v_cockpit_mono_source AS
SELECT sp.code_reference,
       sp.designation,
       sp.fournisseur_nom,
       sp.delai_livraison_jours,
       sp.statut,
       ROUND(sp.jours_couverture, 1) AS jours_couverture,
       ROUND(COALESCE(sp.conso_mensuelle_kg, 0) * 12
             * COALESCE(sp.cmup_mad, 0), 2) AS budget_annuel_mad
  FROM v_stock_projete sp
 WHERE NOT EXISTS (
         SELECT 1
           FROM reference_groupe_equiv a
           JOIN reference_groupe_equiv b
             ON b.code_groupe_equiv = a.code_groupe_equiv
            AND b.code_reference   <> a.code_reference
            AND b.actif = 1
           JOIN reference rb ON rb.code_reference = b.code_reference AND rb.actif = 1
          WHERE a.code_reference = sp.code_reference
            AND a.actif = 1
            AND rb.code_fournisseur IS DISTINCT FROM sp.code_fournisseur);

-- --- 4. Flux par famille : sans les mouvements internes -------------------------
CREATE OR REPLACE VIEW v_stat_famille AS
WITH refs AS (
    SELECT r.code_reference,
           COALESCE(r.code_famille, '(sans famille)')    AS code_famille,
           COALESCE(f.libelle, 'Sans famille')           AS famille_libelle,
           COALESCE(r.code_categorie, '(sans categorie)') AS code_categorie,
           COALESCE(c.libelle, 'Sans categorie')          AS categorie_libelle
      FROM reference r
      LEFT JOIN famille f           ON f.code_famille   = r.code_famille
      LEFT JOIN categorie_matiere c ON c.code_categorie = r.code_categorie
     WHERE r.actif = 1
),
stock AS (
    SELECT re.code_famille,
           sum(s.quantite_kg)                     AS stock_kg,
           sum(s.valeur_mad)                      AS valeur_dhs,
           count(DISTINCT s.code_reference) FILTER (WHERE s.quantite_kg > 0) AS refs_en_stock
      FROM stock_magasin s
      JOIN refs re ON re.code_reference = s.code_reference
     GROUP BY re.code_famille
),
flux AS (
    -- Le stock initial et les transferts entre magasins deplacent ou declarent
    -- du stock ; ils n'en font ni entrer ni sortir de l'entreprise.
    SELECT re.code_famille,
           left(m.date_mouvement, 4)                                  AS annee,
           sum(l.quantite_kg) FILTER (WHERE t.signe =  1)              AS entrees_kg,
           sum(l.quantite_kg) FILTER (WHERE t.signe = -1)              AS sorties_kg,
           sum(l.total_mad)   FILTER (WHERE t.signe =  1)              AS entrees_dhs
      FROM ligne_mouvement l
      JOIN mouvement m       ON m.id_mouvement  = l.id_mouvement
      JOIN type_mouvement t  ON t.code_type_mvt = m.code_type_mvt
      JOIN refs re           ON re.code_reference = l.code_reference
     WHERE m.code_type_mvt NOT IN ('STOCK_INIT', 'TRANSFERT_ENTREE', 'TRANSFERT_SORTIE')
     GROUP BY re.code_famille, left(m.date_mouvement, 4)
)
SELECT re.code_famille,
       max(re.famille_libelle)                       AS famille_libelle,
       CASE WHEN count(DISTINCT re.code_categorie) > 1 THEN NULL
            ELSE max(re.code_categorie) END          AS code_categorie,
       CASE WHEN count(DISTINCT re.code_categorie) > 1 THEN 'Plusieurs categories'
            ELSE max(re.categorie_libelle) END       AS categorie_libelle,
       count(*)                                      AS nb_references,
       COALESCE(max(st.refs_en_stock), 0)            AS refs_en_stock,
       ROUND(COALESCE(max(st.stock_kg), 0), 2)       AS stock_kg,
       ROUND(COALESCE(max(st.valeur_dhs), 0), 2)     AS valeur_dhs,
       fl.annee,
       ROUND(COALESCE(fl.entrees_kg, 0), 2)          AS entrees_kg,
       ROUND(COALESCE(fl.sorties_kg, 0), 2)          AS sorties_kg,
       ROUND(COALESCE(fl.entrees_dhs, 0), 2)         AS entrees_dhs,
       CASE WHEN COALESCE(fl.entrees_kg, 0) > 0
            THEN ROUND(fl.entrees_dhs / fl.entrees_kg, 2) END AS prix_moyen_entree_mad
  FROM refs re
  LEFT JOIN stock st ON st.code_famille = re.code_famille
  LEFT JOIN flux  fl ON fl.code_famille = re.code_famille
 GROUP BY re.code_famille, fl.annee, fl.entrees_kg, fl.sorties_kg, fl.entrees_dhs;

-- --- 5. Les champs ---------------------------------------------------------------
-- Chaque champ neuf nomme son MODELE : le champ voisin dont il reprend le
-- niveau, utilisateur par utilisateur.
CREATE TEMP TABLE champs_neufs (module text, champ text, libelle text, niveau_defaut text,
                                sensible int, ordre int, modele text) ON COMMIT DROP;
INSERT INTO champs_neufs VALUES
 ('COCKPIT',    'nb_sur_stock',              'References en sur-stock',          'LECTURE', 0, 4010, 'nb_ruptures'),
 ('COCKPIT',    'nb_ecart_majeur',           'Ecarts majeurs a verifier',        'LECTURE', 0, 4020, 'nb_ruptures'),
 ('COCKPIT',    'nb_refs_en_alerte',         'References en alerte',             'LECTURE', 0, 4030, 'nb_ruptures'),
 ('COCKPIT',    'nb_classe_a',               'Classe A',                         'LECTURE', 0, 4040, 'nb_ruptures'),
 ('COCKPIT',    'nb_classe_b',               'Classe B',                         'LECTURE', 0, 4050, 'nb_ruptures'),
 ('COCKPIT',    'nb_classe_c',               'Classe C',                         'LECTURE', 0, 4060, 'nb_ruptures'),
 ('COCKPIT',    'nb_non_classees',           'References non classees',          'LECTURE', 0, 4070, 'nb_ruptures'),
 ('COCKPIT',    'couverture_ponderee_jours', 'Couverture ponderee valeur (j)',   'LECTURE', 0, 4080, 'nb_ruptures'),
 ('COCKPIT',    'ecart_pesee_moyen_pct',     'Ecart de pesee moyen (%)',         'LECTURE', 0, 4090, 'nb_ruptures'),
 ('COCKPIT',    'nb_opportunites',           'Opportunites d''economie',         'LECTURE', 0, 4100, 'nb_ruptures'),
 ('COCKPIT',    'alertes',                   'References en alerte (liste)',     'LECTURE', 0, 4110, 'nb_ruptures'),
 ('COCKPIT',    'economies_total_mad',       'Economies theoriques (MAD/an)',    'LECTURE', 1, 4120, 'valeur_stock_mad'),
 ('COCKPIT',    'budget_ruptures_mad',       'Budget des ruptures (MAD)',        'LECTURE', 1, 4130, 'valeur_stock_mad'),
 ('COCKPIT',    'pct_valeur_dormante',       'Part du stock dormant (%)',        'LECTURE', 1, 4140, 'valeur_stock_mad'),
 ('COCKPIT',    'valeur_dormante_mad',       'Valeur du stock dormant (MAD)',    'LECTURE', 1, 4150, 'valeur_stock_mad'),
 ('MOUVEMENTS', 'valeur_dhs',                'Valeur du stock (MAD)',            'LECTURE', 1, 4160, 'total_mad'),
 ('CATALOGUE',  'prix_catalogue_mad',        'Prix catalogue (MAD/kg)',          'LECTURE', 1, 4170, 'cmup_mad'),
 ('CATALOGUE',  'valeur_stock_mad',          'Valeur du stock (MAD)',            'LECTURE', 1, 4180, 'cmup_mad');

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT module, champ, libelle, niveau_defaut, sensible, ordre FROM champs_neufs
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

-- Le modele par role suit le champ modele du meme role.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, n.module, n.champ,
       CASE WHEN m.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM champs_neufs n
  JOIN modele_droit_champ m ON m.module = n.module AND m.champ = n.modele
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

-- Et l'utilisateur, le champ modele de l'utilisateur.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, n.module, n.champ,
       CASE WHEN d.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM champs_neufs n
  JOIN droit_champ d ON d.module = n.module AND d.champ = n.modele
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
