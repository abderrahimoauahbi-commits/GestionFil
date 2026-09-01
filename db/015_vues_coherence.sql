-- =============================================================================
-- ERP GESTION FIL — vues de coherence reprises du classeur
-- -----------------------------------------------------------------------------
-- Le classeur porte, sur ses feuilles de travail, des blocs de controle que
-- l'ERP calculait sans jamais les montrer. Les regles existent — ce sont les
-- controles C01 et C21 — mais elles ne rendaient qu'un COMPTE : « 6 anomalies ».
-- Le classeur, lui, dit QUELLE qualite, QUEL role, et combien de roles sur le
-- total sont conformes.
--
-- La difference n'est pas cosmetique. « 6 anomalies » ne se corrige pas ;
-- « SH : 7 roles sur 8, Franges a 0 % » se corrige.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- v_coherence_recette — le bloc « CONTROLE COHERENCE RECETTES » du classeur
-- -----------------------------------------------------------------------------
-- Une ligne par qualite. Pour chacune : combien de roles sont composes a 100 %,
-- combien de roles elle declare, et le nom de ceux qui echouent.
--
-- UN ROLE PEUT ECHOUER DE DEUX FACONS, et il faut les distinguer :
--   * il porte une densite mais AUCUNE matiere    -> role a 0 %
--   * ses matieres ne totalisent pas 100 %        -> somme fausse
-- Le premier est un oubli de composition, le second une erreur de saisie. Les
-- confondre ferait chercher au mauvais endroit.
DROP VIEW IF EXISTS v_coherence_recette;
CREATE VIEW v_coherence_recette AS
WITH roles_declares AS (
    -- Les roles que la qualite declare : ceux qui portent une densite.
    SELECT lq.code_qualite, lq.code_role, rb.libelle AS role_libelle
      FROM ligne_qualite lq
      JOIN role_bom rb ON rb.code_role = lq.code_role
     WHERE lq.actif = 1
),
sommes AS (
    SELECT rd.code_qualite,
           rd.code_role,
           rd.role_libelle,
           COALESCE(SUM(r.pourcentage_composition), 0) AS somme_pct,
           COUNT(r.id_recette)                         AS nb_lignes
      FROM roles_declares rd
      LEFT JOIN recette r ON r.code_qualite = rd.code_qualite
                        AND r.code_role    = rd.code_role
                        AND r.actif        = 1
     GROUP BY rd.code_qualite, rd.code_role, rd.role_libelle
),
juge AS (
    SELECT s.*,
           CASE
               WHEN s.nb_lignes = 0 THEN 'VIDE'
               WHEN ABS(s.somme_pct - 100.0) <=
                    (SELECT CAST(valeur_courante AS REAL) FROM parametre
                      WHERE code_parametre = 'P_ToleranceRecette') THEN 'OK'
               ELSE 'HORS_100'
           END AS etat
      FROM sommes s
)
SELECT q.code_qualite,
       q.nom                                                     AS qualite_nom,
       q.statut                                                  AS statut_qualite,
       COUNT(j.code_role)                                        AS roles_declares,
       SUM(CASE WHEN j.etat = 'OK'       THEN 1 ELSE 0 END)      AS roles_conformes,
       SUM(CASE WHEN j.etat = 'VIDE'     THEN 1 ELSE 0 END)      AS roles_vides,
       SUM(CASE WHEN j.etat = 'HORS_100' THEN 1 ELSE 0 END)      AS roles_hors_100,
       -- Les roles fautifs, nommes, avec leur somme. C'est ce que le classeur
       -- affiche entre parentheses : « Franges (0%) ».
       (SELECT group_concat(k.role_libelle || ' (' ||
                            CAST(ROUND(k.somme_pct, 0) AS INTEGER) || '%)', ', ')
          FROM juge k
         WHERE k.code_qualite = q.code_qualite AND k.etat <> 'OK')  AS roles_fautifs,
       CASE
           WHEN SUM(CASE WHEN j.etat <> 'OK' THEN 1 ELSE 0 END) = 0 THEN 'OK'
           ELSE 'ANOMALIE'
       END                                                       AS verdict
  FROM qualite q
  LEFT JOIN juge j ON j.code_qualite = q.code_qualite
 WHERE q.statut <> 'CLOTURE'
 GROUP BY q.code_qualite, q.nom, q.statut;


-- -----------------------------------------------------------------------------
-- v_risque_sourcing — le bloc « RISQUES IDENTIFIES » du plan d'achat
-- -----------------------------------------------------------------------------
-- Le classeur qualifie chaque reference a commander : classe ABC, palier de
-- montant (tier), risque de source, action recommandee. Trois de ces quatre
-- colonnes existaient deja dans l'ERP mais dispersees ; la quatrieme — le
-- risque — se deduisait sans etre nommee.
--
-- LE RISQUE N'EST PAS L'URGENCE. Une reference peut etre urgente et
-- multi-source : on la commande sans inquietude. Une autre peut etre calme et
-- mono-source : elle ne presse pas, mais elle merite qu'on qualifie une seconde
-- source avant qu'elle presse. Melanger les deux fait rater la seconde.
DROP VIEW IF EXISTS v_risque_sourcing;
CREATE VIEW v_risque_sourcing AS
WITH alternatives AS (
    SELECT a.code_reference,
           COUNT(DISTINCT sp.code_fournisseur) AS nb_sources
      FROM reference_groupe_equiv a
      JOIN reference_groupe_equiv b ON b.code_groupe_equiv = a.code_groupe_equiv
                                   AND b.actif = 1
      JOIN v_stock_projete sp ON sp.code_reference = b.code_reference
     WHERE a.actif = 1
     GROUP BY a.code_reference
)
SELECT sp.code_reference,
       sp.designation,
       sp.fournisseur_nom,
       r.classe_abc,
       r.classe_xyz,
       sp.statut,
       ROUND(sp.jours_couverture, 1)                              AS jours_couverture,
       sp.delai_livraison_jours,
       ROUND(COALESCE(sp.conso_mensuelle_kg, 0) * 12
             * COALESCE(sp.cmup_mad, 0), 2)                       AS budget_annuel_mad,
       COALESCE(a.nb_sources, 1)                                  AS nb_sources,
       CASE
           WHEN COALESCE(a.nb_sources, 1) <= 1 THEN 'MONO_SOURCE'
           ELSE 'MULTI_SOURCE'
       END                                                        AS risque_source,
       -- Le palier de montant, lu des parametres et non ecrit en dur.
       CASE
           WHEN COALESCE(sp.conso_mensuelle_kg, 0) * 12 * COALESCE(sp.cmup_mad, 0)
                >= (SELECT CAST(valeur_courante AS REAL) FROM parametre
                     WHERE code_parametre = 'P_SeuilTier1') THEN 'TIER_1'
           WHEN COALESCE(sp.conso_mensuelle_kg, 0) * 12 * COALESCE(sp.cmup_mad, 0)
                >= (SELECT CAST(valeur_courante AS REAL) FROM parametre
                     WHERE code_parametre = 'P_SeuilTier2') THEN 'TIER_2'
           WHEN COALESCE(sp.conso_mensuelle_kg, 0) * 12 * COALESCE(sp.cmup_mad, 0)
                >= (SELECT CAST(valeur_courante AS REAL) FROM parametre
                     WHERE code_parametre = 'P_SeuilTier3') THEN 'TIER_3'
           ELSE 'TIER_4'
       END                                                        AS tier,
       -- L'action recommandee combine les trois : ce qui presse, ce qui pese,
       -- ce qui est fragile.
       CASE
           WHEN sp.statut IN ('RUPTURE', 'CRITIQUE') AND COALESCE(a.nb_sources, 1) <= 1
                THEN 'Commander et qualifier une seconde source'
           WHEN sp.statut IN ('RUPTURE', 'CRITIQUE')
                THEN 'Commander cette semaine'
           WHEN COALESCE(a.nb_sources, 1) <= 1 AND r.classe_abc = 'A'
                THEN 'Qualifier une seconde source sous 30 jours'
           WHEN sp.statut = 'ATTENTION'
                THEN 'Surveiller, commander au prochain point'
           ELSE 'Aucune action'
       END                                                        AS action_recommandee
  FROM v_stock_projete sp
  JOIN reference r ON r.code_reference = sp.code_reference
  LEFT JOIN alternatives a ON a.code_reference = sp.code_reference
 WHERE r.actif = 1;
