-- =============================================================================
-- 2026-10-22b — L'OF : son cycle, sa consommation réelle, ses statistiques
-- =============================================================================
-- docs/A-DECIDER-of-supply-chain.md (§4, §6 ter, §6 quater, §8), lot A.
--
--   1. LE CYCLE. PRÉVU → LANCÉ → CLÔTURÉ ; ANNULÉ depuis PRÉVU ou LANCÉ. Les
--      transitions sont dans `transition_statut` (entité 'ordre_fabrication') et
--      le déclencheur refuse les autres. Un OF clôturé ou annulé ne se modifie
--      plus (en-tête figé).
--   2. LA CONSOMMATION RÉELLE (`v_of_consommation`, par OF et par référence) :
--        - FIL : les écarts des lignes de décision machine ACTIVES dont l'OF DE
--          LA PÉRIODE est l'OF (l'écart appartient à l'OF sortant, 22/10/2026),
--          ventilés par effet : CONSOMMATION (hors correction), DÉCHET, PERTE,
--          CASSE ; plus les bobines DÉCHARGÉES vers le déchet, la perte ou la
--          casse (elles ne reviennent pas au magasin : aucun mouvement ne les
--          porte). Les corrections (MJ_CORRECTION), les écarts non qualifiés,
--          les régularisations et les erreurs de saisie ne sont PAS une
--          consommation : ils se totalisent à part (kg_autre_ecart).
--        - HORS MACHINE : les consommations directes (CONSO_DIRECTE) portant
--          l'OF, moins les retours au magasin de ces matières portant le même
--          OF ; un mouvement contre-passé (et sa contre-passation) ne compte pas.
--        - PRÉVU : métrage × kg/m² de la recette active × (1 + perte de la
--          qualité) — le STANDARD DE COMPARAISON, jamais la consommation.
--   3. `v_of_bilan` (par OF) et `v_qualite_consommation` (par qualité et mois de
--      l'OF, OF annulés exclus).
--   4. C61 (signal, jamais bloquant) : OF clôturé dont l'écart réel / prévu
--      dépasse P_EcartOfPct (15 % par défaut).
--   5. Les champs affichés, déclarés dans `champ_configurable` (module PLANS).
--
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- 1. Le cycle de l'OF
-- -----------------------------------------------------------------------------
DELETE FROM transition_statut WHERE entite = 'ordre_fabrication';
INSERT INTO transition_statut (entite, statut_source, statut_cible, role_requis, description) VALUES
    ('ordre_fabrication', 'PREVU', 'LANCE',   'PLANIF',    'Lancement : l''atelier produit'),
    ('ordre_fabrication', 'LANCE', 'CLOTURE', 'DIRECTION', 'Clôture : la consommation est arrêtée'),
    ('ordre_fabrication', 'PREVU', 'ANNULE',  'DIRECTION', 'Abandon avant lancement'),
    ('ordre_fabrication', 'LANCE', 'ANNULE',  'DIRECTION', 'Abandon en cours')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION fn_trg_ordre_fabrication_cycle() RETURNS trigger AS $$
BEGIN
    IF OLD.statut <> NEW.statut
       AND NOT EXISTS (SELECT 1 FROM transition_statut
                        WHERE entite = 'ordre_fabrication'
                          AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'OF-CYCLE : l''ordre de fabrication % ne passe pas de % à % (PRÉVU → LANCÉ → CLÔTURÉ ; ANNULÉ depuis PRÉVU ou LANCÉ).',
            OLD.numero, OLD.statut, NEW.statut;
    END IF;
    -- Clôturé ou annulé : l'en-tête est figé. Ce qu'il a consommé se lit, il ne se réécrit pas.
    IF OLD.statut IN ('CLOTURE', 'ANNULE')
       AND (NEW.numero, NEW.date_of, NEW.date_fin_prevue, NEW.code_qualite, NEW.metrage_m2, NEW.notes)
           IS DISTINCT FROM
           (OLD.numero, OLD.date_of, OLD.date_fin_prevue, OLD.code_qualite, OLD.metrage_m2, OLD.notes) THEN
        RAISE EXCEPTION 'OF-FIGE : l''ordre de fabrication % est % : son en-tête ne se modifie plus.',
            OLD.numero, CASE OLD.statut WHEN 'CLOTURE' THEN 'clôturé' ELSE 'annulé' END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ordre_fabrication_cycle() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_ordre_fabrication_cycle ON ordre_fabrication;
CREATE TRIGGER trg_ordre_fabrication_cycle
BEFORE UPDATE ON ordre_fabrication FOR EACH ROW
EXECUTE FUNCTION fn_trg_ordre_fabrication_cycle();

-- Un OF naît PRÉVU : il ne commence pas sa vie lancé, clôturé ou annulé.
CREATE OR REPLACE FUNCTION fn_trg_ordre_fabrication_naissance() RETURNS trigger AS $$
BEGIN
    IF NEW.statut <> 'PREVU' THEN
        RAISE EXCEPTION 'OF-CYCLE : un ordre de fabrication naît PRÉVU (reçu : %).', NEW.statut;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ordre_fabrication_naissance() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_ordre_fabrication_naissance ON ordre_fabrication;
CREATE TRIGGER trg_ordre_fabrication_naissance
BEFORE INSERT ON ordre_fabrication FOR EACH ROW
EXECUTE FUNCTION fn_trg_ordre_fabrication_naissance();

-- -----------------------------------------------------------------------------
-- 2. Le seuil du signal
-- -----------------------------------------------------------------------------
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
                       categorie, modifiable_par, verrouille)
VALUES ('P_EcartOfPct', 'OF : écart réel / prévu signalé', '15', 'DECIMAL', '%',
        'Un OF clôturé dont la consommation réelle s''écarte du prévu (métrage × recette) de plus de ce pourcentage est signalé (C61). Signal seulement, jamais un blocage.',
        'PROD', 'DIRECTION', 0)
ON CONFLICT (code_parametre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. La consommation par OF et par référence
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_of_consommation AS
WITH
-- LES TYPES DE MOUVEMENT DU HORS MACHINE, EN UN SEUL ENDROIT : la sortie
-- (consommation directe) et le retour au magasin des matières non consommées.
-- Le retour est le type que pose la fiche hors machine (lot 3 bis) ; tant qu'il
-- n'existe pas, la liste ne trouve simplement rien.
types_hors_machine (code_type_mvt, sens) AS (
    VALUES ('CONSO_DIRECTE', 'SORTI'),
           ('RETOUR_CONSO',  'RENDU')
),
prevu AS (
    SELECT o.id_of, rc.code_reference,
           sum(o.metrage_m2 * rc.kg_m2 * (1 + q.taux_perte_pct / 100.0)) AS kg_prevu
      FROM ordre_fabrication o
      JOIN qualite q ON q.code_qualite = o.code_qualite
      JOIN v_recette_calculee rc ON rc.code_qualite = o.code_qualite
     WHERE rc.kg_m2 IS NOT NULL
     GROUP BY o.id_of, rc.code_reference
),
fil AS (
    SELECT l.id_of_periode AS id_of, l.code_reference,
           string_agg(DISTINCT NULLIF(l.lot_fournisseur, ''), ', ') AS lots,
           sum(l.ecart_kg) FILTER (WHERE l.effet_ecart = 'CONSOMMATION'
                                     AND l.code_motif <> 'MJ_CORRECTION')          AS kg_conso_fil,
           COALESCE(sum(l.ecart_kg) FILTER (WHERE l.effet_ecart = 'DECHET'), 0)
             + COALESCE(sum(l.kg_mouvementes) FILTER (WHERE l.destination = 'DECHET'), 0) AS kg_dechet,
           COALESCE(sum(l.ecart_kg) FILTER (WHERE l.effet_ecart = 'PERTE'), 0)
             + COALESCE(sum(l.kg_mouvementes) FILTER (WHERE l.destination = 'PERTE'), 0)  AS kg_perte,
           COALESCE(sum(l.ecart_kg) FILTER (WHERE l.effet_ecart = 'CASSE'), 0)
             + COALESCE(sum(l.kg_mouvementes) FILTER (WHERE l.destination = 'CASSE'), 0)  AS kg_casse,
           sum(l.ecart_kg) FILTER (WHERE l.effet_ecart IN ('NON_QUALIFIE', 'REGULARISATION', 'ERREUR_SAISIE')
                                      OR (l.effet_ecart = 'CONSOMMATION' AND l.code_motif = 'MJ_CORRECTION'))
                                                                                      AS kg_autre_ecart
      FROM machine_decision_ligne l
      JOIN machine_decision d ON d.id_decision = l.id_decision
     WHERE d.statut = 'ACTIVE'
       AND l.id_of_periode IS NOT NULL
     GROUP BY l.id_of_periode, l.code_reference
),
hors_machine AS (
    SELECT m.id_of, lm.code_reference,
           string_agg(DISTINCT NULLIF(lm.lot_fournisseur, ''), ', ') AS lots,
           sum(lm.quantite_kg) FILTER (WHERE t.sens = 'SORTI') AS kg_sorti,
           sum(lm.quantite_kg) FILTER (WHERE t.sens = 'RENDU') AS kg_rendu
      FROM mouvement m
      JOIN types_hors_machine t ON t.code_type_mvt = m.code_type_mvt
      JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
     WHERE m.id_of IS NOT NULL
       AND m.id_mouvement_contrepasse IS NULL
       AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
     GROUP BY m.id_of, lm.code_reference
),
cles AS (
    SELECT id_of, code_reference FROM prevu
    UNION SELECT id_of, code_reference FROM fil
    UNION SELECT id_of, code_reference FROM hors_machine
)
SELECT o.id_of, o.numero, o.code_qualite, o.statut, o.date_of, o.metrage_m2,
       k.code_reference, r.designation,
       NULLIF(concat_ws(', ', f.lots, h.lots), '')                          AS lots,
       round(COALESCE(p.kg_prevu, 0), 4)                                     AS kg_prevu,
       round(COALESCE(f.kg_conso_fil, 0), 4)                                 AS kg_conso_fil,
       round(COALESCE(h.kg_sorti, 0), 4)                                     AS kg_sorti_hors_machine,
       round(COALESCE(h.kg_rendu, 0), 4)                                     AS kg_rendu_hors_machine,
       round(COALESCE(h.kg_sorti, 0) - COALESCE(h.kg_rendu, 0), 4)           AS kg_hors_machine,
       round(COALESCE(f.kg_conso_fil, 0) + COALESCE(h.kg_sorti, 0) - COALESCE(h.kg_rendu, 0), 4) AS kg_reel,
       round(COALESCE(f.kg_dechet, 0), 4)                                    AS kg_dechet,
       round(COALESCE(f.kg_perte, 0), 4)                                     AS kg_perte,
       round(COALESCE(f.kg_casse, 0), 4)                                     AS kg_casse,
       round(COALESCE(f.kg_autre_ecart, 0), 4)                               AS kg_autre_ecart,
       round(COALESCE(f.kg_conso_fil, 0) + COALESCE(h.kg_sorti, 0) - COALESCE(h.kg_rendu, 0)
             - COALESCE(p.kg_prevu, 0), 4)                                   AS ecart_kg,
       CASE WHEN COALESCE(p.kg_prevu, 0) > 0 THEN
           round((COALESCE(f.kg_conso_fil, 0) + COALESCE(h.kg_sorti, 0) - COALESCE(h.kg_rendu, 0)
                  - p.kg_prevu) / p.kg_prevu * 100, 2)
       END                                                                   AS ecart_pct
  FROM cles k
  JOIN ordre_fabrication o ON o.id_of = k.id_of
  JOIN reference r ON r.code_reference = k.code_reference
  LEFT JOIN prevu p        ON p.id_of = k.id_of AND p.code_reference = k.code_reference
  LEFT JOIN fil f          ON f.id_of = k.id_of AND f.code_reference = k.code_reference
  LEFT JOIN hors_machine h ON h.id_of = k.id_of AND h.code_reference = k.code_reference;
ALTER VIEW v_of_consommation OWNER TO gestionfil;
COMMENT ON VIEW v_of_consommation IS
  'Par OF et par référence : prévu (métrage × recette × perte, standard de comparaison), réel fil (écarts '
  'CONSOMMATION des décisions machine actives dont l''OF de la période est l''OF, corrections exclues), réel '
  'hors machine (CONSO_DIRECTE − retours portant l''OF, contre-passés exclus), déchets / pertes / casses à part. '
  '2026-10-22b.';

-- Par OF : les totaux.
CREATE OR REPLACE VIEW v_of_bilan AS
SELECT o.id_of, o.numero, o.code_qualite, q.nom AS qualite_nom, o.statut, o.date_of,
       o.date_fin_prevue, o.metrage_m2, o.date_cloture,
       count(c.code_reference)                          AS nb_references,
       COALESCE(round(sum(c.kg_prevu), 4), 0)           AS kg_prevu,
       COALESCE(round(sum(c.kg_conso_fil), 4), 0)       AS kg_conso_fil,
       COALESCE(round(sum(c.kg_hors_machine), 4), 0)    AS kg_hors_machine,
       COALESCE(round(sum(c.kg_reel), 4), 0)            AS kg_reel,
       COALESCE(round(sum(c.kg_dechet), 4), 0)          AS kg_dechet,
       COALESCE(round(sum(c.kg_perte), 4), 0)           AS kg_perte,
       COALESCE(round(sum(c.kg_casse), 4), 0)           AS kg_casse,
       COALESCE(round(sum(c.kg_autre_ecart), 4), 0)     AS kg_autre_ecart,
       COALESCE(round(sum(c.kg_reel) - sum(c.kg_prevu), 4), 0) AS ecart_kg,
       CASE WHEN sum(c.kg_prevu) > 0 THEN
           round((sum(c.kg_reel) - sum(c.kg_prevu)) / sum(c.kg_prevu) * 100, 2)
       END                                              AS ecart_pct
  FROM ordre_fabrication o
  JOIN qualite q ON q.code_qualite = o.code_qualite
  LEFT JOIN v_of_consommation c ON c.id_of = o.id_of
 GROUP BY o.id_of, q.nom;
ALTER VIEW v_of_bilan OWNER TO gestionfil;

-- Par qualité et par mois de l'OF : la somme des OF, annulés exclus.
CREATE OR REPLACE VIEW v_qualite_consommation AS
SELECT b.code_qualite, b.qualite_nom,
       to_char(b.date_of, 'YYYY-MM')                    AS mois,
       count(*)                                         AS nb_of,
       count(*) FILTER (WHERE b.statut = 'CLOTURE')     AS nb_of_clotures,
       round(sum(b.metrage_m2), 2)                      AS metrage_m2,
       round(sum(b.kg_prevu), 4)                        AS kg_prevu,
       round(sum(b.kg_conso_fil), 4)                    AS kg_conso_fil,
       round(sum(b.kg_hors_machine), 4)                 AS kg_hors_machine,
       round(sum(b.kg_reel), 4)                         AS kg_reel,
       round(sum(b.kg_dechet), 4)                       AS kg_dechet,
       round(sum(b.kg_perte), 4)                        AS kg_perte,
       round(sum(b.kg_casse), 4)                        AS kg_casse,
       round(sum(b.kg_autre_ecart), 4)                  AS kg_autre_ecart,
       round(sum(b.kg_reel) - sum(b.kg_prevu), 4)       AS ecart_kg,
       CASE WHEN sum(b.kg_prevu) > 0 THEN
           round((sum(b.kg_reel) - sum(b.kg_prevu)) / sum(b.kg_prevu) * 100, 2)
       END                                              AS ecart_pct
  FROM v_of_bilan b
 WHERE b.statut <> 'ANNULE'
 GROUP BY b.code_qualite, b.qualite_nom, to_char(b.date_of, 'YYYY-MM');
ALTER VIEW v_qualite_consommation OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 4. C61 : OF clôturé dont l'écart réel / prévu dépasse le seuil (signal)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ctl_c61 AS
SELECT b.id_of, b.numero, b.code_qualite, b.date_of, b.kg_prevu, b.kg_reel, b.ecart_kg, b.ecart_pct,
       s.seuil AS seuil_pct
  FROM v_of_bilan b
 CROSS JOIN (SELECT COALESCE((SELECT NULLIF(valeur_courante, '')::numeric FROM parametre
                               WHERE code_parametre = 'P_EcartOfPct'), 15) AS seuil) s
 WHERE b.statut = 'CLOTURE'
   AND b.kg_prevu > 0
   AND abs(b.ecart_pct) > s.seuil;
ALTER VIEW v_ctl_c61 OWNER TO gestionfil;

-- Ajouté à la définition EN PLACE de v_controles : les contrôles posés par les
-- autres migrations du jour restent.
DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C61' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C61''::text, ''OF cloture dont la consommation reelle s''''ecarte du prevu''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c61)';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Les champs affichés (module PLANS) — un champ non déclaré est masqué
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('PLANS', 'numero',               'N° d''OF',                       'LECTURE', 0, 300),
 ('PLANS', 'date_of',              'Date de l''OF',                  'LECTURE', 0, 302),
 ('PLANS', 'date_fin_prevue',      'Fin prévue',                     'LECTURE', 0, 304),
 ('PLANS', 'metrage_m2',           'Métrage (m²)',                   'LECTURE', 0, 306),
 ('PLANS', 'notes',                'Notes',                          'LECTURE', 0, 308),
 ('PLANS', 'code_reference',       'Référence',                      'LECTURE', 0, 310),
 ('PLANS', 'designation',          'Désignation',                    'LECTURE', 0, 312),
 ('PLANS', 'lots',                 'Lots',                           'LECTURE', 0, 314),
 ('PLANS', 'kg_prevu',             'Prévu (kg)',                     'LECTURE', 0, 320),
 ('PLANS', 'kg_conso_fil',         'Réel fil (kg)',                  'LECTURE', 0, 322),
 ('PLANS', 'kg_hors_machine',      'Réel hors machine (kg)',         'LECTURE', 0, 324),
 ('PLANS', 'kg_sorti_hors_machine','Sorti hors machine (kg)',        'LECTURE', 0, 325),
 ('PLANS', 'kg_rendu_hors_machine','Rendu au magasin (kg)',          'LECTURE', 0, 326),
 ('PLANS', 'kg_reel',              'Réel (kg)',                      'LECTURE', 0, 328),
 ('PLANS', 'kg_dechet',            'Déchet (kg)',                    'LECTURE', 0, 330),
 ('PLANS', 'kg_perte',             'Perte (kg)',                     'LECTURE', 0, 332),
 ('PLANS', 'kg_casse',             'Casse (kg)',                     'LECTURE', 0, 334),
 ('PLANS', 'kg_autre_ecart',       'Autres écarts (kg)',             'LECTURE', 0, 336),
 ('PLANS', 'ecart_kg',             'Écart réel − prévu (kg)',        'LECTURE', 0, 338),
 ('PLANS', 'ecart_pct',            'Écart (%)',                      'LECTURE', 0, 340),
 ('PLANS', 'nb_of',                'Nombre d''OF',                   'LECTURE', 0, 342),
 ('PLANS', 'nb_of_clotures',       'OF clôturés',                    'LECTURE', 0, 344),
 ('PLANS', 'nb_references',        'Références',                     'LECTURE', 0, 346)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;

-- Même niveau, par rôle et par compte, que le métrage prévu des plans.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'PLANS', c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN (SELECT champ FROM champ_configurable WHERE module = 'PLANS' AND ordre BETWEEN 300 AND 399) c
 WHERE m.module = 'PLANS' AND m.champ = 'm2_prevus'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'PLANS', c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN (SELECT champ FROM champ_configurable WHERE module = 'PLANS' AND ordre BETWEEN 300 AND 399) c
 WHERE d.module = 'PLANS' AND d.champ = 'm2_prevus'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Témoin
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.v_of_consommation') IS NULL
       OR to_regclass('public.v_qualite_consommation') IS NULL
       OR to_regclass('public.v_of_bilan') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ordre_fabrication_cycle')
       OR (SELECT count(*) FROM transition_statut WHERE entite = 'ordre_fabrication') <> 4
       OR NOT EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_EcartOfPct')
       OR position('C61' IN pg_get_viewdef('v_controles'::regclass)) = 0 THEN
        RAISE EXCEPTION '2026-10-22b : migration incomplete';
    END IF;
END $$;

COMMIT;

SELECT count(*) AS controles FROM v_controles;
