-- =============================================================================
-- 2026-10-27h — Les colonnes du stock projeté et de la fenêtre de détail
-- =============================================================================
-- DÉCISIONS DE LA DIRECTION DU 27/10/2026 : l'écran « Stock projeté » (/stock)
-- passe en trois onglets sur LE MÊME MOTEUR de couverture (Stock projeté,
-- Simulation, Surveillance / Alertes), et le détail d'une référence s'ouvre en
-- grande fenêtre. Les colonnes nouvelles viennent toutes du moteur
-- (`routes/couverture.rs`, `ligne()`), sans formule de besoin nouvelle :
--
--   magasin_hors_restes_kg     disponible en magasins comptés, restes ôtés ;
--   machine_hors_restes_kg     fil sur machine compté, restes chargés ôtés ;
--   restant_kg                 les restes comptés par le moteur (magasin + machine) ;
--   stock_total_projete_kg     les trois + les arrivages comptés (aucun recouvrement) ;
--   besoin_jusqu_livraison_kg  le plan de [aujourd'hui, aujourd'hui + délai[ ;
--   securite_aujourdhui_kg     la ligne de sécurité du moteur aujourd'hui ;
--   reel_mois_kg               (au plan d'achat) le réel du grand livre, 12 mois pleins.
--
-- Et le MONTANT d'une commande au stock projeté : quantité de la 1re proposition
-- × LE MÊME PRIX que la proposition du plan d'achat (`domain/plan_achat.rs`,
-- PRIX_MAD_SQL). `prix_estime_mad`, `montant_estime_mad` et `source_prix` sont
-- déjà déclarés (sensibles) au PLAN_ACHAT ; ils le sont ici au STOCK, au MÊME
-- niveau que celui du plan d'achat, rôle par rôle et compte par compte : qui ne
-- voit pas le prix d'une proposition ne le voit pas non plus au stock projeté.
--
-- Une colonne non déclarée dans `champ_configurable` est MASQUÉE à l'écran.
-- Le serveur ne dépend pas de cette migration (elle n'est pas exigée au
-- démarrage). Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Les kilos et les jours, en LECTURE, non sensibles, aux deux modules.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT m.module, c.champ, c.libelle, 'LECTURE', 0, 985
  FROM (VALUES ('PLAN_ACHAT'), ('STOCK')) m(module)
 CROSS JOIN (VALUES ('magasin_hors_restes_kg',    'Disponible en magasin, hors restes (kg)'),
                    ('machine_hors_restes_kg',    'Sur machine, hors restes (kg)'),
                    ('restant_kg',                'Restant : restes comptés (kg)'),
                    ('stock_total_projete_kg',    'Stock total projeté (kg)'),
                    ('besoin_jusqu_livraison_kg', 'Besoin jusqu''à livraison (kg)'),
                    ('securite_aujourdhui_kg',    'Sécurité du jour (kg)')
            ) c(champ, libelle)
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES ('PLAN_ACHAT', 'reel_mois_kg', 'Réel / mois, 12 mois pleins (kg)', 'LECTURE', 0, 985)
ON CONFLICT (module, champ) DO NOTHING;

-- Le niveau de la quantité à commander, rôle par rôle et compte par compte.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN (VALUES ('magasin_hors_restes_kg'), ('machine_hors_restes_kg'), ('restant_kg'),
                    ('stock_total_projete_kg'), ('besoin_jusqu_livraison_kg'), ('securite_aujourdhui_kg')) c(champ)
 WHERE m.module IN ('PLAN_ACHAT', 'STOCK') AND m.champ = 'qte_a_commander_kg'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN (VALUES ('magasin_hors_restes_kg'), ('machine_hors_restes_kg'), ('restant_kg'),
                    ('stock_total_projete_kg'), ('besoin_jusqu_livraison_kg'), ('securite_aujourdhui_kg')) c(champ)
 WHERE d.module IN ('PLAN_ACHAT', 'STOCK') AND d.champ = 'qte_a_commander_kg'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'PLAN_ACHAT', 'reel_mois_kg', m.niveau
  FROM modele_droit_champ m
 WHERE m.module = 'PLAN_ACHAT' AND m.champ = 'qte_a_commander_kg'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'PLAN_ACHAT', 'reel_mois_kg', d.niveau
  FROM droit_champ d
 WHERE d.module = 'PLAN_ACHAT' AND d.champ = 'qte_a_commander_kg'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- Les montants au STOCK : sensibles, au niveau que le plan d'achat leur donne.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'STOCK', c.champ, c.libelle, COALESCE(p.niveau_defaut, 'LECTURE'), 1, 986
  FROM (VALUES ('prix_estime_mad',    'Prix d''achat estimé (MAD/kg)'),
               ('montant_estime_mad', 'Montant de la commande (MAD)'),
               ('source_prix',        'Source du prix')
       ) c(champ, libelle)
  LEFT JOIN champ_configurable p ON p.module = 'PLAN_ACHAT' AND p.champ = c.champ
ON CONFLICT (module, champ) DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'STOCK', m.champ, m.niveau
  FROM modele_droit_champ m
 WHERE m.module = 'PLAN_ACHAT' AND m.champ IN ('prix_estime_mad', 'montant_estime_mad', 'source_prix')
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'STOCK', d.champ, d.niveau
  FROM droit_champ d
 WHERE d.module = 'PLAN_ACHAT' AND d.champ IN ('prix_estime_mad', 'montant_estime_mad', 'source_prix')
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- Témoin
DO $$
BEGIN
    IF (SELECT count(*) FROM champ_configurable
         WHERE (module, champ) IN (('STOCK', 'stock_total_projete_kg'), ('PLAN_ACHAT', 'stock_total_projete_kg'),
                                   ('STOCK', 'besoin_jusqu_livraison_kg'), ('STOCK', 'montant_estime_mad'),
                                   ('PLAN_ACHAT', 'reel_mois_kg'))) <> 5
       OR (SELECT sensible FROM champ_configurable WHERE module = 'STOCK' AND champ = 'montant_estime_mad') <> 1 THEN
        RAISE EXCEPTION '2026-10-27h : colonnes du stock projeté non déclarées.';
    END IF;
END $$;

COMMIT;
