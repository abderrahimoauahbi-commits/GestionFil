-- =============================================================================
-- 2026-10-27a — Les champs de la couverture du plan (moteur du 26/10/2026)
-- =============================================================================
-- Le moteur de couverture (`domain/couverture.rs`, routes `GET /api/couverture`
-- et `GET /api/couverture/{reference}`) rend, par référence, des colonnes que le
-- plan d'achat n'avait pas : disponible, couvert jusqu'au, 1re rupture, plan non
-- couvert, prochain arrivage, date limite de commande, et les quantités affichées
-- à part (restes, quarantaine, bloqué, en retard, sans date, en route).
--
-- Une colonne dont le champ n'est pas déclaré dans `champ_configurable` est
-- MASQUÉE à l'écran (défaut MASQUE de la grille). L'onglet « À commander » à venir
-- les affichera : elles sont déclarées ici, au module PLAN_ACHAT, en LECTURE, non
-- sensibles (des kilos, des dates, des jours — aucun montant).
--
-- Les champs déjà déclarés du module sont repris tels quels (code_reference,
-- designation, classe_abc, code_fournisseur, fournisseur_nom, qte_a_commander_kg).
-- Le serveur ne dépend pas de cette migration (elle n'est pas exigée au démarrage).
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'PLAN_ACHAT', c.champ, c.libelle, 'LECTURE', 0, 980
  FROM (VALUES ('disponible_kg',            'Disponible aujourd''hui (kg)'),
               ('magasin_kg',               'Dont magasins comptés (kg)'),
               ('machine_kg',               'Dont fil sur machine (kg)'),
               ('plan_horizon_kg',          'Plan sur l''horizon (kg)'),
               ('couvert_jusqu_au',         'Couvert jusqu''au'),
               ('couvert_tout_horizon',     'Couvert sur tout l''horizon'),
               ('premiere_rupture',         '1re rupture'),
               ('plan_non_couvert_kg',      'Plan non couvert (kg)'),
               ('premier_passage_securite', 'Passage sous la sécurité'),
               ('prochain_arrivage_date',   'Prochain arrivage'),
               ('prochain_arrivage_kg',     'Prochain arrivage (kg)'),
               ('delai_j',                  'Délai (j)'),
               ('source_delai',             'Source du délai'),
               ('couverture_commande_j',    'Couverture d''une commande (j)'),
               ('source_couverture',        'Source de la couverture'),
               ('jours_securite',           'Sécurité (j)'),
               ('palettes_equivalentes',    'Équivalent en palettes'),
               ('date_disponibilite',       'Disponible le (D)'),
               ('date_limite_commande',     'Commander au plus tard le'),
               ('nb_propositions',          'Propositions sur l''horizon'),
               ('propositions_plafonnees',  'Propositions plafonnées'),
               ('motif_sans_proposition',   'Pourquoi rien à commander'),
               ('restes_kg',                'Restes, compris (kg)'),
               ('quarantaine_kg',           'Quarantaine, non comptée (kg)'),
               ('bloque_kg',                'Bloqué, non compté (kg)'),
               ('hors_plan_kg',             'Magasins hors plan, non comptés (kg)'),
               ('en_retard_kg',             'Bons en retard, non comptés (kg)'),
               ('sans_date_kg',             'Sans date fiable, non compté (kg)'),
               ('transit_kg',               'Transferts en route, non comptés (kg)')
       ) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- Témoin
DO $$
BEGIN
    IF (SELECT count(*) FROM champ_configurable
         WHERE module = 'PLAN_ACHAT'
           AND champ IN ('disponible_kg', 'couvert_jusqu_au', 'premiere_rupture', 'plan_non_couvert_kg',
                         'date_limite_commande', 'transit_kg')) <> 6 THEN
        RAISE EXCEPTION '2026-10-27a : champs de la couverture non déclarés.';
    END IF;
END $$;

COMMIT;
