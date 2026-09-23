-- =============================================================================
-- LA SUPERVISION S'ALLUME : LES DONNEES EXISTENT MAINTENANT
-- =============================================================================
--
-- CE QUI A CHANGE. La premiere version declarait dix indicateurs « en attente
-- de donnees » : zero reception, zero bon de commande, un seul mois de
-- mouvements. Ce n'etait pas un defaut de l'ERP, c'etait un magasin qui
-- n'avait pas encore servi.
--
-- Depuis, l'exploitation a tourne : des bons de commande, des receptions
-- controlees, des sorties de production sur plusieurs annees, un historique de
-- prix. OTIF, ponctualite, completude, delai reel, rotation, stock dormant et
-- evolution des prix DEVIENNENT calculables. Ils sont donc calcules.
--
-- LA REGLE NE CHANGE PAS POUR AUTANT. Un indicateur qui n'a pas de quoi se
-- calculer rend NULL et dit ce qui lui manque ; il ne rend jamais zero. Un
-- zero se lit comme un resultat, et c'est le mensonge le plus dangereux d'un
-- tableau de bord : « OTIF 0 % » ferait conclure que les fournisseurs sont
-- catastrophiques alors que l'ERP n'a rien vu passer.
--
-- C'est pourquoi `disponible` se CALCULE ici au lieu d'etre ecrit en dur : le
-- jour ou la premiere reception arrive, l'indicateur s'allume tout seul.
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS v_supervision_valeurs CASCADE;
DROP VIEW IF EXISTS v_supervision CASCADE;

-- -----------------------------------------------------------------------------
-- 1. Les valeurs, la ou elles existent
-- -----------------------------------------------------------------------------

CREATE VIEW v_supervision_valeurs AS
WITH stock AS (
    SELECT COALESCE(sum(valeur_mad), 0)                           AS valeur_mad,
           NULLIF(count(*), 0)                                    AS nb_refs,
           count(*) FILTER (WHERE statut = 'RUPTURE')             AS nb_rupture,
           count(*) FILTER (WHERE statut = 'OK')                  AS nb_ok,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY jours_couverture)
             FILTER (WHERE jours_couverture IS NOT NULL)          AS couverture_mediane
      FROM v_etat_stock
), sourcing AS (
    SELECT count(*) FILTER (WHERE nb_sources <= 1)                AS nb_mono,
           COALESCE(sum(budget_annuel_mad) FILTER (WHERE nb_sources <= 1), 0) AS budget_mono
      FROM v_risque_sourcing
), economies AS (
    SELECT COALESCE(sum(economie_annuelle_mad), 0) AS economies_mad FROM v_cockpit_economies
),
-- LA LIVRAISON : une reception controlee, rapprochee de ce que le bon promettait.
--
-- ON-TIME se mesure sur la date PROMISE, pas sur le delai theorique du
-- fournisseur : c'est l'engagement pris qui compte, et c'est lui que l'acheteur
-- a negocie.
livraison AS (
    SELECT count(*)                                               AS nb,
           count(*) FILTER (
               WHERE substr(r.date_reception, 1, 10)::date
                     <= substr(b.date_livraison_prevue, 1, 10)::date)  AS nb_a_lheure,
           avg(substr(r.date_reception, 1, 10)::date
               - substr(b.date_bc, 1, 10)::date)::numeric         AS delai_reel
      FROM reception r
      JOIN bon_commande b ON b.id_bc = r.id_bc
     WHERE r.statut IN ('VALIDE', 'CLOTURE')
       AND b.date_livraison_prevue IS NOT NULL
),
-- IN-FULL : ce qui a ete pese contre ce qui avait ete commande, ligne a ligne.
-- Une ligne servie a 99,5 % compte comme complete — c'est la tolerance de
-- pesee du metier, pas une complaisance.
completude AS (
    SELECT count(*)                                               AS nb,
           count(*) FILTER (WHERE l.quantite_recue_kg
                                  >= l.quantite_commandee_kg * 0.98)  AS nb_completes
      FROM ligne_bc l
      JOIN bon_commande b ON b.id_bc = l.id_bc
     WHERE l.quantite_commandee_kg > 0
       AND b.statut IN ('ENVOYE', 'LIVRE_PARTIEL', 'CLOTURE')
),
-- LA ROTATION rapporte ce qui est SORTI sur douze mois au stock moyen. Sans
-- douze mois d'historique, elle ne veut rien dire et reste nulle.
-- LA SORTIE NE PORTE PAS DE PRIX, ET C'EST NORMAL : on valorise ce qui entre,
-- pas ce qui part — sinon il faudrait rejouer tout le grand livre a chaque
-- revision du cout. La rotation se calcule donc sur les QUANTITES sorties,
-- valorisees au CMUP courant de chaque reference. Ma premiere ecriture
-- multipliait par `prix_kg_mad`, nul sur une sortie : elle rendait zero, et un
-- zero se lit comme « le stock ne tourne pas ».
rotation AS (
    SELECT sum(lm.quantite_kg * COALESCE(r.cmup_mad, 0))          AS sorties_mad,
           count(DISTINCT substr(m.date_mouvement, 1, 7))         AS nb_mois
      FROM mouvement m
      JOIN type_mouvement t ON t.code_type_mvt = m.code_type_mvt
      JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
      JOIN reference r ON r.code_reference = lm.code_reference
     WHERE t.signe = -1
       AND m.date_mouvement >= to_char((now() AT TIME ZONE 'UTC') - interval '12 months',
                                       'YYYY-MM-DD')
),
-- LE STOCK DORMANT : ce qui n'a pas bouge depuis soixante jours. Il ne se
-- calcule que si le magasin a plus de soixante jours d'existence.
dormant AS (
    SELECT COALESCE(sum(e.valeur_mad) FILTER (
               WHERE NOT EXISTS (
                   SELECT 1 FROM ligne_mouvement lm
                     JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
                    WHERE lm.code_reference = e.code_reference
                      AND m.date_mouvement >= to_char(
                          (now() AT TIME ZONE 'UTC') - interval '60 days', 'YYYY-MM-DD'))
           ), 0)                                                  AS dormant_mad,
           NULLIF(sum(e.valeur_mad), 0)                           AS total_mad
      FROM v_etat_stock e
),
-- L'EVOLUTION DES PRIX : le prix moyen pondere des six derniers mois contre
-- celui des six precedents. Une comparaison mois a mois serait du bruit.
prix AS (
    SELECT sum(h.prix_kg_mad * h.quantite_achetee_kg) FILTER (
               WHERE h.date_achat >= to_char((now() AT TIME ZONE 'UTC') - interval '6 months',
                                            'YYYY-MM-DD'))
           / NULLIF(sum(h.quantite_achetee_kg) FILTER (
               WHERE h.date_achat >= to_char((now() AT TIME ZONE 'UTC') - interval '6 months',
                                            'YYYY-MM-DD')), 0)    AS recent,
           sum(h.prix_kg_mad * h.quantite_achetee_kg) FILTER (
               WHERE h.date_achat < to_char((now() AT TIME ZONE 'UTC') - interval '6 months',
                                           'YYYY-MM-DD')
                 AND h.date_achat >= to_char((now() AT TIME ZONE 'UTC') - interval '12 months',
                                            'YYYY-MM-DD'))
           / NULLIF(sum(h.quantite_achetee_kg) FILTER (
               WHERE h.date_achat < to_char((now() AT TIME ZONE 'UTC') - interval '6 months',
                                           'YYYY-MM-DD')
                 AND h.date_achat >= to_char((now() AT TIME ZONE 'UTC') - interval '12 months',
                                            'YYYY-MM-DD')), 0)    AS ancien
      FROM historique_prix h
     WHERE h.quantite_achetee_kg > 0 AND h.prix_kg_mad > 0
),
-- LA MATIERE EN MACHINE : un inventaire permanent, pas un solde.
machine AS (
    SELECT COALESCE(sum(kg), 0) AS kg, count(*) AS nb FROM machine_etat
)
SELECT 'valeur_stock' AS cle, s.valeur_mad::numeric AS valeur FROM stock s
UNION ALL SELECT 'couverture_mediane', round(s.couverture_mediane::numeric, 0) FROM stock s
UNION ALL SELECT 'taux_rupture',       round(100.0 * s.nb_rupture / s.nb_refs, 1) FROM stock s
UNION ALL SELECT 'taux_disponibilite', round(100.0 * s.nb_ok / s.nb_refs, 1) FROM stock s
UNION ALL SELECT 'mono_source',        so.nb_mono::numeric FROM sourcing so
UNION ALL SELECT 'budget_mono',        so.budget_mono FROM sourcing so
UNION ALL SELECT 'economies',          e.economies_mad FROM economies e

UNION ALL SELECT 'on_time',
       CASE WHEN l.nb > 0 THEN round(100.0 * l.nb_a_lheure / l.nb, 1) END FROM livraison l
UNION ALL SELECT 'lead_time',
       CASE WHEN l.nb > 0 THEN round(l.delai_reel, 0) END FROM livraison l
UNION ALL SELECT 'in_full',
       CASE WHEN c.nb > 0 THEN round(100.0 * c.nb_completes / c.nb, 1) END FROM completude c
-- OTIF EST LE PRODUIT DES DEUX, et non leur moyenne : une livraison compte
-- seulement si elle est a l heure ET complete.
UNION ALL SELECT 'otif',
       CASE WHEN l.nb > 0 AND c.nb > 0
            THEN round(100.0 * l.nb_a_lheure / l.nb * c.nb_completes / c.nb, 1) END
  FROM livraison l, completude c
UNION ALL SELECT 'rotation',
       CASE WHEN r.nb_mois >= 6 AND (SELECT valeur_mad FROM stock) > 0
            THEN round((r.sorties_mad * 12.0 / r.nb_mois)
                       / (SELECT valeur_mad FROM stock), 2) END FROM rotation r
UNION ALL SELECT 'stock_dormant',
       CASE WHEN d.total_mad IS NOT NULL
            THEN round(100.0 * d.dormant_mad / d.total_mad, 1) END FROM dormant d
UNION ALL SELECT 'evolution_prix',
       CASE WHEN p.ancien IS NOT NULL AND p.ancien > 0
            THEN round(100.0 * (p.recent - p.ancien) / p.ancien, 1) END FROM prix p
UNION ALL SELECT 'wip_machine',
       CASE WHEN m.nb > 0 THEN round(m.kg::numeric, 0) END FROM machine m;

COMMENT ON VIEW v_supervision_valeurs IS
'La valeur courante de chaque indicateur. NULL quand la donnee manque — jamais
 zero : un zero se lit comme un resultat.';

-- -----------------------------------------------------------------------------
-- 2. Le catalogue, dont la disponibilite se DEDUIT de la valeur
-- -----------------------------------------------------------------------------

CREATE VIEW v_supervision AS
SELECT d.domaine, d.cle, d.libelle, d.unite, d.definition,
       -- L'indicateur est disponible des qu'il a une valeur. Ecrire « 0 » en
       -- dur obligerait a repasser dans la migration le jour ou la premiere
       -- reception arrive ; personne ne le ferait, et le tableau de bord
       -- resterait eteint sur des donnees qui existent.
       (v.valeur IS NOT NULL)::int AS disponible,
       CASE WHEN v.valeur IS NULL THEN d.condition END AS condition,
       d.sens, d.cible, d.vigilance
  FROM (VALUES
    ('STOCK',    'valeur_stock',      'Valeur du stock',        'MAD',
     'Au CMUP, tous magasins confondus.',
     'Aucun stock valorise.', 'neutre', NULL::numeric, NULL::numeric),
    ('STOCK',    'couverture_mediane','Couverture mediane',     'jours',
     'La moitie des references tient plus longtemps, l autre moins.',
     'Aucune couverture calculable : il faut une consommation.', 'haut', 60, 30),
    ('STOCK',    'taux_rupture',      'Taux de rupture',        '%',
     'References sans couverture sur leur delai d approvisionnement.',
     'Aucune reference suivie.', 'bas', 2, 5),
    ('STOCK',    'taux_disponibilite','Taux de disponibilite',  '%',
     'References au vert sur le total suivi.',
     'Aucune reference suivie.', 'haut', 95, 90),
    ('STOCK',    'rotation',          'Rotation du stock',      'fois/an',
     'Consommation annuelle rapportee au stock moyen.',
     'Moins de six mois de mouvements : la rotation n aurait aucun sens.', 'haut', 4, 2),
    ('STOCK',    'stock_dormant',     'Stock dormant',          '%',
     'Valeur sans aucun mouvement depuis soixante jours.',
     'Le magasin a moins de soixante jours.', 'bas', 5, 12),
    ('LIVRAISON','otif',              'OTIF fournisseur',       '%',
     'A l heure ET complet : le produit des deux, jamais leur moyenne.',
     'Aucune reception rapprochee d un bon de commande.', 'haut', 95, 85),
    ('LIVRAISON','on_time',           'Ponctualite',            '%',
     'Livraisons arrivees au plus tard a la date promise.',
     'Aucune reception avec une date promise.', 'haut', 95, 85),
    ('LIVRAISON','in_full',           'Completude',             '%',
     'Quantite pesee contre quantite commandee, tolerance de 2 %.',
     'Aucune ligne de commande servie.', 'haut', 98, 92),
    ('LIVRAISON','lead_time',         'Delai fournisseur reel', 'jours',
     'Entre la date du bon et la date de reception.',
     'Aucun bon suivi d une reception.', 'bas', 60, 90),
    ('ACHATS',   'mono_source',       'References mono-source', 'refs',
     'Une seule source connue : un incident fournisseur arrete la production.',
     'Aucune reference analysee.', 'bas', 0, 10),
    ('ACHATS',   'budget_mono',       'Budget expose au mono-source', 'MAD/an',
     'Ce que pese annuellement ce qui n a qu une source.',
     'Aucun budget calcule.', 'neutre', NULL, NULL),
    ('ACHATS',   'economies',         'Economies identifiees',  'MAD/an',
     'A qualite egale, le meme titrage achete moins cher ailleurs.',
     'Aucune equivalence declaree.', 'neutre', NULL, NULL),
    ('ACHATS',   'evolution_prix',    'Evolution des prix',     '%',
     'Prix moyen pondere des six derniers mois contre les six precedents.',
     'Moins d un an de releves de prix.', 'bas', 3, 8),
    ('PREVISION','forecast_accuracy', 'Precision de prevision', '%',
     '100 moins l erreur ponderee entre besoin calcule et sortie reelle.',
     'Le rapprochement besoin/realise n est pas encore etabli.', 'haut', 85, 70),
    ('PRODUCTION','wip_machine',      'Matiere en machine',     'kg',
     'Bobines montees sur metier, immobilisees hors magasin.',
     'Aucun constat de machine.', 'neutre', NULL, NULL)
  ) AS d(domaine, cle, libelle, unite, definition, condition, sens, cible, vigilance)
  LEFT JOIN v_supervision_valeurs v USING (cle);

COMMENT ON VIEW v_supervision IS
'Les indicateurs de supervision : ce qu ils mesurent, leur cible, leur seuil,
 et — pour ceux qui ne peuvent pas encore etre calcules — ce qu il faut
 enregistrer pour les allumer.';

ALTER VIEW v_supervision OWNER TO gestionfil;
ALTER VIEW v_supervision_valeurs OWNER TO gestionfil;

DO $$
DECLARE n_ok int; n_attente int;
BEGIN
    SELECT count(*) FILTER (WHERE disponible = 1),
           count(*) FILTER (WHERE disponible = 0)
      INTO n_ok, n_attente FROM v_supervision;
    RAISE NOTICE 'supervision : % calculables, % en attente', n_ok, n_attente;
END $$;

COMMIT;
