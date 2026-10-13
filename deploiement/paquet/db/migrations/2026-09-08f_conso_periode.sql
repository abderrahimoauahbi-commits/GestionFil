-- =============================================================================
-- MIGRATION 2026-09-08f — LE CLICHE EST LE POINT DE REFERENCE
-- -----------------------------------------------------------------------------
-- La consommation en cumul depuis l'origine ne suffit pas : on veut savoir ce
-- qu'une machine a tisse EN AOUT. Il faut donc deux bornes, et ces bornes sont
-- les CLICHES — l'etat complet d'une zone, fige a chaque validation de fiche.
--
--     consommation(d1 -> d2) = cliche(d1) + charges(d1..d2) - retours(d1..d2) - cliche(d2)
--
-- Sans cliche, on ne saurait pas ou en etait la zone au 1er aout, et l'ecart
-- d'un mois serait indiscernable de celui de trois jours.
--
-- La fonction rend une ligne par (zone, reference, lot). Bornes nulles = depuis
-- l'origine jusqu'a l'etat courant.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS f_machine_consommation(text, text, text);
CREATE FUNCTION f_machine_consommation(
    p_machine text DEFAULT NULL,
    p_debut   text DEFAULT NULL,
    p_fin     text DEFAULT NULL
)
RETURNS TABLE (
    code_machine text, machine_nom text, code_emplacement text, zone text,
    code_reference text, designation text, lot_fournisseur text,
    date_debut text, kg_debut numeric, kg_charge numeric, kg_retourne numeric,
    date_fin text, kg_fin numeric, consommation_kg numeric
)
LANGUAGE sql STABLE AS $$
    WITH bornes AS (
        -- LE CLICHE D'OUVERTURE : le dernier fige AVANT la periode. Aucun
        -- cliche signifie que la zone n'avait rien — le point de depart est
        -- alors zero, ce qui est exact.
        SELECT DISTINCT ON (c.code_emplacement, c.code_reference, c.lot_fournisseur)
               c.code_emplacement, c.code_reference, c.lot_fournisseur,
               c.date_cliche AS date_debut, c.kg AS kg_debut
          FROM machine_cliche c
         WHERE p_debut IS NOT NULL AND c.date_cliche < p_debut
         ORDER BY c.code_emplacement, c.code_reference, c.lot_fournisseur,
                  c.date_cliche DESC
    ),
    fin AS (
        -- LE CLICHE DE CLOTURE, ou l'etat courant si la periode est ouverte.
        SELECT DISTINCT ON (c.code_emplacement, c.code_reference, c.lot_fournisseur)
               c.code_emplacement, c.code_reference, c.lot_fournisseur,
               c.date_cliche AS date_fin, c.kg AS kg_fin
          FROM machine_cliche c
         WHERE p_fin IS NOT NULL AND c.date_cliche <= p_fin
         ORDER BY c.code_emplacement, c.code_reference, c.lot_fournisseur,
                  c.date_cliche DESC
    ),
    flux AS (
        SELECT f.code_machine, f.code_emplacement, l.code_reference, l.lot_fournisseur,
               SUM(CASE WHEN f.type_fiche = 'CHARGE'
                        THEN COALESCE(l.kg_mouvementes, 0) ELSE 0 END) AS kg_charge,
               SUM(CASE WHEN f.type_fiche = 'DECHARGE'
                        THEN COALESCE(l.kg_mouvementes, 0) ELSE 0 END) AS kg_retourne
          FROM machine_fiche f
          JOIN machine_fiche_ligne l ON l.id_fiche = f.id_fiche
         WHERE f.statut = 'VALIDE'
           AND (p_machine IS NULL OR f.code_machine = p_machine)
           AND (p_debut   IS NULL OR f.date_fiche >= p_debut)
           AND (p_fin     IS NULL OR f.date_fiche <= p_fin)
         GROUP BY f.code_machine, f.code_emplacement, l.code_reference, l.lot_fournisseur
    )
    SELECT x.code_machine, m.nom, x.code_emplacement, z.libelle,
           x.code_reference, r.designation, x.lot_fournisseur,
           b.date_debut,
           ROUND(COALESCE(b.kg_debut, 0), 3),
           ROUND(x.kg_charge, 3),
           ROUND(x.kg_retourne, 3),
           COALESCE(fn.date_fin, e.date_constat),
           ROUND(COALESCE(fn.kg_fin, e.kg, 0), 3),
           ROUND(COALESCE(b.kg_debut, 0) + x.kg_charge - x.kg_retourne
                 - COALESCE(fn.kg_fin, e.kg, 0), 3)
      FROM flux x
      JOIN machine m             ON m.code_machine = x.code_machine
      JOIN machine_emplacement z ON z.code_emplacement = x.code_emplacement
      JOIN reference r           ON r.code_reference = x.code_reference
      LEFT JOIN bornes b  ON b.code_emplacement = x.code_emplacement
                         AND b.code_reference   = x.code_reference
                         AND b.lot_fournisseur  = x.lot_fournisseur
      LEFT JOIN fin fn    ON fn.code_emplacement = x.code_emplacement
                         AND fn.code_reference   = x.code_reference
                         AND fn.lot_fournisseur  = x.lot_fournisseur
      LEFT JOIN machine_etat e ON e.code_emplacement = x.code_emplacement
                              AND e.code_reference   = x.code_reference
                              AND e.lot_fournisseur  = x.lot_fournisseur;
$$;

ALTER FUNCTION f_machine_consommation(text, text, text) OWNER TO gestionfil;

COMMIT;
