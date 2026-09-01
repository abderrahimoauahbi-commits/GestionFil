-- =============================================================================
-- ERP GESTION FIL — vues du poste de travail, alignees sur le Cockpit du classeur
-- -----------------------------------------------------------------------------
-- Le classeur organise son cockpit en six zones. Cinq agregats qu'il calcule
-- n'existaient nulle part dans l'ERP : la distribution des couvertures, le cout
-- matiere mois par mois, les economies possibles en changeant de source, la
-- concentration par devise et les references mono-source. Les voici.
--
-- Ecrites en VUES et non dans le code Rust : ce sont des agregats purs, ils se
-- relisent, et le jour de la migration PostgreSQL c'est une traduction et non
-- une reecriture.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- v_cockpit_couverture — distribution des references par tranche de couverture
-- -----------------------------------------------------------------------------
-- Les six tranches du classeur, dans son ordre. La premiere n'est pas un
-- intervalle mais un etat : une couverture negative signifie que le projete est
-- deja sous zero, ce qui n'est pas « peu de jours » mais « plus rien ».
DROP VIEW IF EXISTS v_cockpit_couverture;
CREATE VIEW v_cockpit_couverture AS
WITH tranches(rang, libelle, borne_min, borne_max) AS (
    VALUES (1, 'RUPTURE (<0)', NULL,  0.0),
           (2, '0-30 j',        0.0,  30.0),
           (3, '30-60 j',      30.0,  60.0),
           (4, '60-90 j',      60.0,  90.0),
           (5, '90-180 j',     90.0, 180.0),
           (6, '>180 j',      180.0,  NULL)
)
SELECT t.rang, t.libelle,
       (SELECT COUNT(*) FROM v_stock_projete sp
         WHERE sp.jours_couverture IS NOT NULL
           AND (t.borne_min IS NULL OR sp.jours_couverture >= t.borne_min)
           AND (t.borne_max IS NULL OR sp.jours_couverture <  t.borne_max)) AS nb_references
FROM tranches t;


-- -----------------------------------------------------------------------------
-- v_cockpit_cout_mensuel — cout matiere par mois de l'horizon
-- -----------------------------------------------------------------------------
-- Le besoin du mois, valorise au CMUP. C'est la courbe qui dit quand la
-- tresorerie sera sollicitee : un plan saisonnier fait des pics, et les voir
-- douze mois a l'avance est tout l'interet du MRP.
DROP VIEW IF EXISTS v_cockpit_cout_mensuel;
CREATE VIEW v_cockpit_cout_mensuel AS
SELECT bm.annee_mois,
       ROUND(SUM(bm.quantite_kg), 4)                            AS quantite_kg,
       ROUND(SUM(bm.quantite_kg * COALESCE(sp.cmup_mad, 0)), 2) AS cout_mad,
       COUNT(DISTINCT bm.code_reference)                        AS nb_references
  FROM besoin_mrp bm
  JOIN plan_production pp ON pp.id_plan = bm.id_plan AND pp.statut = 'EN_COURS'
  LEFT JOIN v_stock_projete sp ON sp.code_reference = bm.code_reference
 GROUP BY bm.annee_mois;


-- -----------------------------------------------------------------------------
-- v_cockpit_economies — ce que couterait de moins un autre fournisseur
-- -----------------------------------------------------------------------------
-- Pour chaque reference d'un groupe d'equivalence, le prix le plus bas du
-- groupe. L'economie annuelle est l'ecart multiplie par la consommation de
-- l'annee.
--
-- CE CHIFFRE EST UNE BORNE HAUTE, ET L'ECRAN DOIT LE DIRE. Il suppose que
-- l'equivalent tient la meme qualite, que le fournisseur suit le volume et que
-- le delai ne se degrade pas — trois hypotheses qu'un acheteur verifie avant de
-- basculer. Le classeur ecrit « economies THEORIQUES » ; on garde le mot.
DROP VIEW IF EXISTS v_cockpit_economies;
CREATE VIEW v_cockpit_economies AS
WITH groupes AS (
    -- Le groupe ne vit pas sur `reference` mais dans la table de rattachement :
    -- une reference peut etre membre de plusieurs groupes.
    SELECT code_reference, code_groupe_equiv
      FROM reference_groupe_equiv WHERE actif = 1
),
mini AS (
    SELECT g.code_groupe_equiv, MIN(sp.cmup_mad) AS prix_min_mad
      FROM groupes g
      JOIN v_stock_projete sp ON sp.code_reference = g.code_reference
     WHERE sp.cmup_mad > 0
     GROUP BY g.code_groupe_equiv
)
SELECT sp.code_reference,
       sp.designation,
       sp.fournisseur_nom                                   AS fournisseur_actuel,
       g.code_groupe_equiv,
       ROUND(sp.cmup_mad, 4)                                AS prix_actuel_mad,
       ROUND(m.prix_min_mad, 4)                             AS prix_min_mad,
       (SELECT sp2.fournisseur_nom
          FROM groupes g2
          JOIN v_stock_projete sp2 ON sp2.code_reference = g2.code_reference
         WHERE g2.code_groupe_equiv = g.code_groupe_equiv
           AND sp2.cmup_mad = m.prix_min_mad
         LIMIT 1)                                           AS fournisseur_alternatif,
       ROUND(COALESCE(sp.conso_mensuelle_kg, 0) * 12, 4)    AS conso_annuelle_kg,
       ROUND((sp.cmup_mad - m.prix_min_mad)
             * COALESCE(sp.conso_mensuelle_kg, 0) * 12, 2)  AS economie_annuelle_mad
  FROM v_stock_projete sp
  JOIN groupes g ON g.code_reference = sp.code_reference
  JOIN mini    m ON m.code_groupe_equiv = g.code_groupe_equiv
 WHERE sp.cmup_mad > m.prix_min_mad
   AND COALESCE(sp.conso_mensuelle_kg, 0) > 0;


-- -----------------------------------------------------------------------------
-- v_cockpit_devise — concentration du budget d'achat par monnaie
-- -----------------------------------------------------------------------------
-- Une usine qui achete 60 % de sa matiere en dollars porte un risque de change
-- qu'aucun indicateur de stock ne montre. Le classeur en fait une zone a part ;
-- elle a sa place ici pour la meme raison.
DROP VIEW IF EXISTS v_cockpit_devise;
CREATE VIEW v_cockpit_devise AS
WITH budget AS (
    SELECT r.code_devise_catalogue AS code_devise,
           COUNT(*)                AS nb_references,
           SUM(COALESCE(sp.conso_mensuelle_kg, 0) * 12
               * COALESCE(sp.cmup_mad, 0)) AS montant_mad
      FROM reference r
      JOIN v_stock_projete sp ON sp.code_reference = r.code_reference
     WHERE r.actif = 1
     GROUP BY r.code_devise_catalogue
)
SELECT b.code_devise,
       b.nb_references,
       ROUND(b.montant_mad, 2) AS montant_mad,
       ROUND(b.montant_mad * 100.0
             / NULLIF((SELECT SUM(montant_mad) FROM budget), 0), 2) AS part_pct
  FROM budget b
 WHERE b.montant_mad > 0;


-- -----------------------------------------------------------------------------
-- v_cockpit_mono_source — references sans alternative qualifiee
-- -----------------------------------------------------------------------------
-- Une reference en tension chez un fournisseur unique n'a pas la meme gravite
-- qu'une reference dont trois maisons detiennent l'equivalent. C'est le premier
-- tri d'un plan de securisation.
DROP VIEW IF EXISTS v_cockpit_mono_source;
CREATE VIEW v_cockpit_mono_source AS
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
          WHERE a.code_reference = sp.code_reference
            AND a.actif = 1);


-- -----------------------------------------------------------------------------
-- v_cockpit_pareto — les references triees par valeur de consommation
-- -----------------------------------------------------------------------------
-- L'assiette du classement ABC, exposee telle quelle pour le graphique de
-- Pareto : la barre porte la valeur, la courbe porte le cumul.
DROP VIEW IF EXISTS v_cockpit_pareto;
CREATE VIEW v_cockpit_pareto AS
WITH valeur AS (
    SELECT sp.code_reference,
           sp.designation,
           r.classe_abc,
           r.classe_xyz,
           sp.statut,
           ROUND(COALESCE(sp.conso_mensuelle_kg, 0) * 12
                 * COALESCE(sp.cmup_mad, 0), 2) AS valeur_conso_annuelle_mad
      FROM v_stock_projete sp
      JOIN reference r ON r.code_reference = sp.code_reference
     WHERE r.actif = 1
)
SELECT v.*,
       (SELECT COUNT(*) + 1 FROM valeur w
         WHERE w.valeur_conso_annuelle_mad > v.valeur_conso_annuelle_mad) AS rang,
       ROUND((SELECT SUM(w.valeur_conso_annuelle_mad) FROM valeur w
               WHERE w.valeur_conso_annuelle_mad >= v.valeur_conso_annuelle_mad)
             * 100.0
             / NULLIF((SELECT SUM(valeur_conso_annuelle_mad) FROM valeur), 0), 4) AS pct_cumule
  FROM valeur v
 WHERE v.valeur_conso_annuelle_mad > 0;
