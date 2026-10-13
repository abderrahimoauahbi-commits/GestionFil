-- =============================================================================
-- MIGRATION 2026-09-08d — LA CONSOMMATION SE CALCULE EN CUMUL
-- -----------------------------------------------------------------------------
-- CE QUI ETAIT FAUX, ET POURQUOI.
--
-- Je repartissais la consommation FICHE PAR FICHE : a chaque validation, une
-- ligne disait « ce chargement a revele tant de kilos tisses ». C'est une
-- invention. Personne ne sait quel chargement a ete tisse quand, et vouloir le
-- decider a produit une cascade de cas particuliers — l'extension de zone,
-- l'estimation des bobines chargees, le partage entre celles qui completent et
-- celles qui remplacent. Aucun de ces cas n'existe dans l'atelier.
--
-- LA VERITE EST CUMULATIVE :
--
--     consommation = tout ce qui a ete charge  -  ce qui est revenu  -  l'etat actuel
--
-- Sur l'exemple de reference : 1344 chargees + 400 chargees - 672 constatees =
-- 1072. Le meme total que la somme de mes calculs par fiche — les etats
-- intermediaires s'annulent deux a deux — mais sans la repartition arbitraire.
--
-- La table `machine_consommation` reste, vide : elle servira si l'on veut un
-- jour figer un arrete de periode. Le calcul courant, lui, est une VUE.
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS v_machine_consommation CASCADE;
CREATE VIEW v_machine_consommation AS
WITH charge AS (
    -- Ce qui est monte sur la machine, et ce qui en est redescendu. On ne lit
    -- que les fiches VALIDEES : un brouillon ne compte pas, une fiche annulee
    -- non plus.
    SELECT f.code_machine, f.code_emplacement, l.code_reference, l.lot_fournisseur,
           SUM(CASE WHEN f.type_fiche = 'CHARGE'   THEN COALESCE(l.kg_mouvementes, 0) ELSE 0 END)
               AS kg_charge,
           SUM(CASE WHEN f.type_fiche = 'DECHARGE' THEN COALESCE(l.kg_mouvementes, 0) ELSE 0 END)
               AS kg_retourne,
           SUM(CASE WHEN f.type_fiche = 'CHARGE'
                    THEN COALESCE(l.nb_bobines_mouvementees, 0) ELSE 0 END)
               AS bobines_chargees,
           MIN(f.date_fiche) AS premier_chargement,
           MAX(f.date_fiche) AS dernier_mouvement
      FROM machine_fiche f
      JOIN machine_fiche_ligne l ON l.id_fiche = f.id_fiche
     WHERE f.statut = 'VALIDE'
     GROUP BY f.code_machine, f.code_emplacement, l.code_reference, l.lot_fournisseur
)
SELECT c.code_machine,
       m.nom                              AS machine_nom,
       c.code_emplacement,
       z.libelle                          AS zone,
       c.code_reference,
       r.designation,
       c.lot_fournisseur,

       ROUND(c.kg_charge, 3)              AS kg_charge,
       ROUND(c.kg_retourne, 3)            AS kg_retourne,
       c.bobines_chargees,
       c.premier_chargement,
       c.dernier_mouvement,

       -- L'ETAT ACTUEL, tel qu'il a ete constate. Zero si le lot a quitte la
       -- zone : tout ce qui a ete charge a donc ete tisse ou rendu.
       COALESCE(e.nb_bobines, 0)          AS bobines_presentes,
       COALESCE(e.pourcentage, 0)         AS pourcentage_actuel,
       ROUND(COALESCE(e.kg, 0), 3)        AS kg_actuel,
       e.date_constat,

       -- LE CUMUL. Une valeur negative signale un chargement non declare, pas
       -- une consommation negative : on l'affiche plutot que de la maquiller.
       ROUND(c.kg_charge - c.kg_retourne - COALESCE(e.kg, 0), 3) AS consommation_kg

  FROM charge c
  JOIN machine m            ON m.code_machine = c.code_machine
  JOIN machine_emplacement z ON z.code_emplacement = c.code_emplacement
  JOIN reference r          ON r.code_reference = c.code_reference
  LEFT JOIN machine_etat e  ON e.code_emplacement = c.code_emplacement
                           AND e.code_reference   = c.code_reference
                           AND e.lot_fournisseur  = c.lot_fournisseur;

ALTER VIEW v_machine_consommation OWNER TO gestionfil;

COMMIT;
