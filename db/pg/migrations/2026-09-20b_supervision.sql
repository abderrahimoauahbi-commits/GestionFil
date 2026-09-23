-- =============================================================================
-- SUPERVISION SUPPLY CHAIN : UN INDICATEUR DIT AUSSI QUAND IL NE SAIT PAS
-- =============================================================================
--
-- CE QU'ON DEMANDE. Un tableau de bord de direction avec les indicateurs
-- normalises de la chaine logistique : OTIF, Fill Rate, Forecast Accuracy,
-- Lead Time, rotation, couverture, scorecard fournisseur, et une lecture en
-- trois zones — ce qui va, ce qu'il faut surveiller, ce qui exige une action.
--
-- CE QUE LA BASE PERMET AUJOURD'HUI, mesure faite le 20/09/2026 :
--
--     receptions          0        bons de commande     0
--     lignes reception    0        lignes BC            0
--     mouvements          2        mois d historique    1
--     machines            0        historique prix      0
--     besoins MRP       812        qualites            18
--
-- Autrement dit : OTIF, On-Time, In-Full, Lead Time, scorecard fournisseur,
-- evolution des prix, rotation, WIP machine et toute la precision de prevision
-- ne reposent sur RIEN. Les calculer donnerait zero, et un zero affiche comme
-- un resultat est un mensonge — pire qu'une case vide, parce qu'on le croit.
--
-- LA REGLE DE CETTE VUE. Chaque indicateur porte, a cote de sa valeur, un
-- champ `disponible` et, s'il vaut 0, la PHRASE qui dit ce qu'il faut
-- enregistrer pour l'allumer. L'ecran affiche alors « en attente : saisir des
-- receptions » au lieu de « OTIF 0 % ». Le tableau de bord devient ainsi une
-- liste de ce qui reste a mettre en route, et se remplit tout seul a mesure
-- que l'usine s'en sert.
--
-- CE QUE CETTE VUE NE CONTIENT PAS, ET POURQUOI. Chiffre d'affaires, panier
-- moyen, taux de conversion, clients actifs, churn, productivite par employe,
-- reclamations : cet ERP tient les ACHATS, les STOCKS et la PRODUCTION de
-- matiere premiere. Il n'a ni client, ni vente, ni paie. Ces indicateurs ne
-- sont pas « a venir » : ils appartiennent a un autre systeme, et pretendre les
-- calculer ici reviendrait a inventer un chiffre d'affaires.
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW v_supervision AS
WITH
-- Ce qui existe reellement, une fois pour toutes : chaque indicateur s'y
-- refere plutot que de compter lui-meme.
socle AS (
    SELECT (SELECT count(*) FROM reception)                       AS nb_receptions,
           (SELECT count(*) FROM ligne_reception)                 AS nb_lignes_rec,
           (SELECT count(*) FROM bon_commande)                    AS nb_bc,
           (SELECT count(*) FROM machine)                         AS nb_machines,
           (SELECT count(*) FROM historique_prix)                 AS nb_prix,
           (SELECT count(DISTINCT substr(date_mouvement, 1, 7))
              FROM mouvement)                                     AS nb_mois
),
stock AS (
    SELECT COALESCE(sum(valeur_mad), 0)                          AS valeur_mad,
           count(*)                                               AS nb_refs,
           count(*) FILTER (WHERE statut = 'RUPTURE')  AS nb_rupture,
           count(*) FILTER (WHERE statut = 'CRITIQUE') AS nb_critique,
           count(*) FILTER (WHERE statut = 'ATTENTION')AS nb_attention,
           count(*) FILTER (WHERE statut = 'OK')       AS nb_ok,
           -- LA COUVERTURE MEDIANE, PAS LA MOYENNE. Une reference couverte
           -- huit cents jours tire la moyenne a elle seule et donne un
           -- magasin qui parait confortable alors que la moitie est en
           -- tension. La mediane dit ou se trouve reellement le milieu.
           percentile_cont(0.5) WITHIN GROUP (ORDER BY jours_couverture)
             FILTER (WHERE jours_couverture IS NOT NULL)          AS couverture_mediane
      FROM v_etat_stock
),
sourcing AS (
    SELECT count(*) FILTER (WHERE nb_sources <= 1)                AS nb_mono_source,
           COALESCE(sum(budget_annuel_mad) FILTER (WHERE nb_sources <= 1), 0)
                                                                  AS budget_mono_mad
      FROM v_risque_sourcing
),
economies AS (
    SELECT COALESCE(sum(economie_annuelle_mad), 0)                AS economies_mad,
           count(*)                                               AS nb_opportunites
      FROM v_cockpit_economies
)
SELECT * FROM (
    VALUES
    -- --------------------------------------------------------------------
    -- CE QUI EST CALCULABLE AUJOURD'HUI
    -- --------------------------------------------------------------------
    ('STOCK',   'valeur_stock',      'Valeur du stock',
     'MAD',     'Au CMUP, tous magasins confondus.', 1, NULL::text),
    ('STOCK',   'couverture_mediane','Couverture mediane',
     'jours',   'La moitie des references tient plus longtemps, l autre moins.', 1, NULL),
    ('STOCK',   'taux_rupture',      'Taux de rupture',
     '%',       'References sans couverture sur leur delai d approvisionnement.', 1, NULL),
    ('STOCK',   'taux_disponibilite','Taux de disponibilite',
     '%',       'References au vert sur le total suivi.', 1, NULL),
    ('ACHATS',  'mono_source',       'References mono-source',
     'refs',    'Une seule source connue : un incident fournisseur arrete la production.', 1, NULL),
    ('ACHATS',  'budget_mono',       'Budget expose au mono-source',
     'MAD/an',  'Ce que pese annuellement ce qui n a qu une source.', 1, NULL),
    ('ACHATS',  'economies',         'Economies identifiees',
     'MAD/an',  'A qualite egale, le meme titrage achete moins cher ailleurs.', 1, NULL),

    -- --------------------------------------------------------------------
    -- CE QUI ATTEND DES DONNEES — et la phrase qui dit lesquelles
    -- --------------------------------------------------------------------
    ('LIVRAISON','otif',             'OTIF fournisseur',
     '%',       'Livraisons a l heure ET completes sur le total.', 0,
     'Aucune reception enregistree. L OTIF se calcule des la premiere reception controlee.'),
    ('LIVRAISON','on_time',          'Ponctualite (On-Time)',
     '%',       'Livraisons arrivees au plus tard a la date promise.', 0,
     'Aucune reception enregistree.'),
    ('LIVRAISON','in_full',          'Completude (In-Full)',
     '%',       'Quantite pesee contre quantite commandee, tolerance de 2 %.', 0,
     'Aucun bon de commande, donc aucune quantite promise a comparer.'),
    ('LIVRAISON','lead_time',        'Delai fournisseur reel',
     'jours',   'Entre la date du bon et la date de reception.', 0,
     'Aucun bon de commande suivi d une reception.'),
    ('PREVISION','forecast_accuracy','Precision de prevision',
     '%',       '100 moins l erreur ponderee (WAPE) entre besoin calcule et sortie reelle.', 0,
     'Un seul mois de mouvements. Il en faut au moins trois pour comparer une prevision a un realise.'),
    ('PREVISION','forecast_bias',    'Biais de prevision',
     '%',       'Tendance a sur-estimer ou sous-estimer, en cumul.', 0,
     'Un seul mois de mouvements.'),
    ('STOCK',   'rotation',          'Rotation du stock',
     'fois/an', 'Consommation annuelle rapportee au stock moyen.', 0,
     'Un seul mois de mouvements. La rotation demande une annee, ou au moins un trimestre.'),
    ('STOCK',   'stock_dormant',     'Stock dormant',
     '%',       'Valeur sans aucun mouvement depuis soixante jours.', 0,
     'Le stock initial date du mois courant : rien ne peut encore etre dormant.'),
    ('PRODUCTION','wip_machine',     'Matiere en machine',
     'kg',      'Bobines montees sur metier, immobilisees hors magasin.', 0,
     'Aucune machine declaree dans le parc.'),
    ('ACHATS',  'evolution_prix',    'Evolution des prix d achat',
     '%',       'Variation du prix moyen pondere par rapport a la periode precedente.', 0,
     'Aucun releve de prix : ils s enregistrent au controle des receptions.')
) AS t(domaine, cle, libelle, unite, definition, disponible, condition);

COMMENT ON VIEW v_supervision IS
'Le catalogue des indicateurs de supervision : ce qu ils mesurent, et pour ceux
 qui ne peuvent pas encore etre calcules, CE QU IL FAUT ENREGISTRER pour les
 allumer. Les valeurs elles-memes sont servies par `v_supervision_valeurs`.';

-- -----------------------------------------------------------------------------
-- Les valeurs, la ou elles existent
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_supervision_valeurs AS
WITH stock AS (
    SELECT COALESCE(sum(valeur_mad), 0)                          AS valeur_mad,
           NULLIF(count(*), 0)                                    AS nb_refs,
           count(*) FILTER (WHERE statut = 'RUPTURE')  AS nb_rupture,
           count(*) FILTER (WHERE statut = 'OK')       AS nb_ok,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY jours_couverture)
             FILTER (WHERE jours_couverture IS NOT NULL)          AS couverture_mediane
      FROM v_etat_stock
), sourcing AS (
    SELECT count(*) FILTER (WHERE nb_sources <= 1)                AS nb_mono,
           COALESCE(sum(budget_annuel_mad) FILTER (WHERE nb_sources <= 1), 0) AS budget_mono
      FROM v_risque_sourcing
), economies AS (
    SELECT COALESCE(sum(economie_annuelle_mad), 0) AS economies_mad FROM v_cockpit_economies
)
SELECT 'valeur_stock'       AS cle, s.valeur_mad::numeric                       AS valeur FROM stock s
UNION ALL SELECT 'couverture_mediane', round(s.couverture_mediane::numeric, 0)           FROM stock s
UNION ALL SELECT 'taux_rupture',       round(100.0 * s.nb_rupture / s.nb_refs, 1) FROM stock s
UNION ALL SELECT 'taux_disponibilite', round(100.0 * s.nb_ok / s.nb_refs, 1)    FROM stock s
UNION ALL SELECT 'mono_source',        so.nb_mono::numeric                      FROM sourcing so
UNION ALL SELECT 'budget_mono',        so.budget_mono                           FROM sourcing so
UNION ALL SELECT 'economies',          e.economies_mad                          FROM economies e;

COMMENT ON VIEW v_supervision_valeurs IS
'La valeur courante de chaque indicateur calculable. Ceux qui manquent ici sont
 exactement ceux que `v_supervision` declare indisponibles.';

ALTER VIEW v_supervision OWNER TO gestionfil;
ALTER VIEW v_supervision_valeurs OWNER TO gestionfil;

DO $$
DECLARE n_ok int; n_attente int;
BEGIN
    SELECT count(*) FILTER (WHERE disponible = 1),
           count(*) FILTER (WHERE disponible = 0)
      INTO n_ok, n_attente FROM v_supervision;
    RAISE NOTICE 'supervision : % indicateurs calculables, % en attente de donnees',
                 n_ok, n_attente;
END $$;

COMMIT;
