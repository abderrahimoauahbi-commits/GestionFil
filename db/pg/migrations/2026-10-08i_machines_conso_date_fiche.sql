-- =============================================================================
-- 2026-10-08i — La consommation machine se date a la fiche (audit v4, P2 action 17)
-- =============================================================================
-- Le journal de consommation filtrait ses periodes sur la date de VALIDATION :
-- une fiche du samedi validee le lundi tombait dans la semaine suivante. La
-- periode se juge desormais a la date de la fiche (le fait) ; l'ordre des
-- decisions, lui, reste celui de leur validation (la chaine de l'etage).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.f_machine_consommation(p_machine text DEFAULT NULL::text, p_debut text DEFAULT NULL::text, p_fin text DEFAULT NULL::text)
 RETURNS TABLE(code_machine text, machine_nom text, code_emplacement text, zone text, code_reference text, designation text, lot_fournisseur text, date_debut text, kg_debut numeric, kg_charge numeric, kg_retourne numeric, kg_sorti_autre numeric, date_fin text, kg_fin numeric, consommation_kg numeric, dechet_perte_casse_kg numeric, non_qualifie_kg numeric, regularisation_kg numeric, erreur_saisie_kg numeric)
 LANGUAGE sql
 STABLE
AS $function$
    WITH periode AS (
        SELECT e.*, l.nb_mouvementees
          FROM v_machine_ecart e
          JOIN machine_decision_ligne l ON l.id_decision = e.id_decision
                                       AND l.ligne_numero = e.ligne_numero
          LEFT JOIN machine_fiche fi ON fi.id_fiche = e.id_fiche
         WHERE e.nature <> 'DEPART'
           AND (p_machine IS NULL OR e.code_machine = p_machine)
           -- La date du FAIT (la fiche), a defaut celle de la validation.
           AND (p_debut   IS NULL OR substr(COALESCE(fi.date_fiche, e.date_decision), 1, 10) >= substr(p_debut, 1, 10))
           AND (p_fin     IS NULL OR substr(COALESCE(fi.date_fiche, e.date_decision), 1, 10) <= substr(p_fin, 1, 10))
    ),
    bornes AS (
        SELECT DISTINCT ON (p.code_emplacement, p.code_reference, p.lot_fournisseur)
               p.code_emplacement, p.code_reference, p.lot_fournisseur,
               p.date_decision AS date_debut, p.kg_avant AS kg_debut
          FROM periode p
         ORDER BY p.code_emplacement, p.code_reference, p.lot_fournisseur, p.date_decision
    ),
    fins AS (
        SELECT DISTINCT ON (p.code_emplacement, p.code_reference, p.lot_fournisseur)
               p.code_emplacement, p.code_reference, p.lot_fournisseur,
               p.date_decision AS date_fin, p.kg_apres AS kg_fin
          FROM periode p
         ORDER BY p.code_emplacement, p.code_reference, p.lot_fournisseur, p.date_decision DESC
    )
    SELECT p.code_machine, m.nom, p.code_emplacement, p.zone, p.code_reference, p.designation,
           p.lot_fournisseur, b.date_debut, ROUND(b.kg_debut, 3),
           ROUND(SUM(CASE WHEN p.nature = 'CHARGE' THEN p.kg_mouvementes ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.nature = 'DECHARGE' AND p.destination = 'MAGASIN'
                          THEN p.kg_mouvementes ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.nature = 'DECHARGE' AND p.destination <> 'MAGASIN'
                          THEN p.kg_mouvementes ELSE 0 END), 3),
           fn.date_fin, ROUND(fn.kg_fin, 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'CONSOMMATION' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart IN ('DECHET', 'PERTE', 'CASSE') THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'NON_QUALIFIE' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'REGULARISATION' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'ERREUR_SAISIE' THEN p.ecart_kg ELSE 0 END), 3)
      FROM periode p
      JOIN machine m ON m.code_machine = p.code_machine
      JOIN bornes b  ON b.code_emplacement = p.code_emplacement
                    AND b.code_reference = p.code_reference AND b.lot_fournisseur = p.lot_fournisseur
      JOIN fins fn   ON fn.code_emplacement = p.code_emplacement
                    AND fn.code_reference = p.code_reference AND fn.lot_fournisseur = p.lot_fournisseur
     GROUP BY p.code_machine, m.nom, p.code_emplacement, p.zone, p.code_reference, p.designation,
              p.lot_fournisseur, b.date_debut, b.kg_debut, fn.date_fin, fn.kg_fin
$function$;
ALTER FUNCTION f_machine_consommation(text, text, text) OWNER TO gestionfil;

COMMIT;
