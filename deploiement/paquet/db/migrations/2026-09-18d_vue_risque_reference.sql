-- =============================================================================
-- MIGRATION 2026-09-18d — LE MUR DES RISQUES NE LISTAIT PAS QUE LES RISQUES
-- -----------------------------------------------------------------------------
-- `v_risque_reference` agrege les douze mois par reference. Sur le serveur, la
-- clause qui ne garde QUE les references ayant au moins un mois en rupture ou
-- tendu manquait : le mur aurait affiche les 125 references, couvertes
-- comprises, et la marge de decision aurait perdu son sens.
--
-- La vue du poste, celle de `011_vues.sql`, est reposee telle quelle. Meme
-- liste de colonnes : CREATE OR REPLACE suffit, les vues qui en dependent ne
-- sont pas touchees.
--
-- Rejouable : CREATE OR REPLACE.
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW v_risque_reference AS
SELECT
    rm.code_reference,
    rm.designation,
    rm.classe_abc,
    ref.code_fournisseur,
    f.nom AS fournisseur_nom,
    COALESCE(f.delai_livraison_jours,
             (SELECT CAST(valeur_courante AS bigint) FROM parametre
               WHERE code_parametre = 'P_DelaiDefaut')) AS delai_livraison_jours,
    -- Meme regle que v_plan_achat : un autre FOURNISSEUR, pas une autre
    -- reference. Le mur de risques trie sur ce champ ; le fausser reviendrait a
    -- reculer dans la liste une reference reellement mono-source.
    CASE WHEN (
        SELECT COUNT(*)
        FROM reference_groupe_equiv rge1
        JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                        AND rge2.code_reference   <> rge1.code_reference
                                        AND rge2.actif = 1
        JOIN reference r2 ON r2.code_reference = rge2.code_reference AND r2.actif = 1
        JOIN reference r1 ON r1.code_reference = rge1.code_reference
        WHERE rge1.code_reference = rm.code_reference AND rge1.actif = 1
          AND r2.code_fournisseur IS DISTINCT FROM r1.code_fournisseur
    ) > 0 THEN 'MULTI-SOURCE' ELSE 'MONO-SOURCE' END    AS risque_sourcing,
    MIN(rm.stock_min_kg)                                AS stock_min_kg,
    MIN(rm.stock_initial_kg)                            AS stock_initial_kg,
    SUM(CASE WHEN rm.statut = 'RUPTURE' THEN 1 ELSE 0 END)       AS nb_mois_rupture,
    SUM(CASE WHEN rm.statut = 'TENDU'   THEN 1 ELSE 0 END)       AS nb_mois_tendu,
    MIN(CASE WHEN rm.statut = 'RUPTURE'  THEN rm.annee_mois END) AS premier_mois_rupture,
    MIN(CASE WHEN rm.statut <> 'COUVERT' THEN rm.annee_mois END) AS premier_mois_risque,
    MIN(CASE WHEN rm.statut <> 'COUVERT' THEN rm.rang_mois END)  AS rang_premier_risque,
    -- Jours restants avant le premier mois a risque, DELAI FOURNISSEUR DEDUIT.
    -- Negatif, il est deja trop tard pour commander a temps : c'est le seul
    -- chiffre qui dise s'il reste une decision a prendre ou un degat a limiter.
    CAST(((MIN(CASE WHEN rm.statut <> 'COUVERT' THEN rm.annee_mois END) || '-01')::date - current_date)
         - COALESCE(f.delai_livraison_jours,
                    (SELECT CAST(valeur_courante AS bigint) FROM parametre
                      WHERE code_parametre = 'P_DelaiDefaut')) AS bigint)
                                                        AS marge_decision_jours,
    -- Un equivalent en stock change la NATURE du risque : ce n'est plus « il
    -- faut commander et attendre » mais « il faut decider ». Le dire evite de
    -- traiter en urgence ce qui se resout par un arbitrage.
    (SELECT ROUND(COALESCE(MAX(e.equivalent_stock_kg), 0), 3) FROM v_equivalence e
      WHERE e.code_reference = rm.code_reference
        AND e.interchangeable = 1)                      AS equivalent_dispo_kg,
    (SELECT e.equivalent_reference FROM v_equivalence e
      WHERE e.code_reference = rm.code_reference
        AND e.interchangeable = 1
      ORDER BY e.equivalent_stock_kg DESC LIMIT 1)      AS equivalent_reference
  FROM v_risque_mensuel rm
  JOIN reference ref      ON ref.code_reference = rm.code_reference
  LEFT JOIN fournisseur f ON f.code_fournisseur = ref.code_fournisseur
 -- Toutes ces colonnes dependent de `code_reference`, deja groupe : la
 -- designation et la classe ABC viennent de la reference, le fournisseur et son
 -- delai en decoulent. Les citer ne change aucune ligne.
 GROUP BY rm.code_reference, rm.designation, rm.classe_abc,
          ref.code_fournisseur, f.nom, f.delai_livraison_jours
-- Les expressions sont repetees plutot que citees par leur alias :
-- HAVING s'evalue AVANT la projection, donc avant que l'alias existe.
-- SQLite l'admettait, la norme SQL non.
HAVING SUM(CASE WHEN rm.statut = 'RUPTURE' THEN 1 ELSE 0 END) > 0
    OR SUM(CASE WHEN rm.statut = 'TENDU'   THEN 1 ELSE 0 END) > 0;
COMMIT;
