-- =============================================================================
-- 2026-10-31c — Stock projeté : les restes, comptés ou non (31/10/2026)
-- =============================================================================
-- Décision du 31/10/2026 : « le stock disponible contient les restes, option oui
-- ou non, comme le rattrapage ». Les restes restent COMPTÉS par défaut (décision
-- du 26/10/2026) ; ce réglage le dit pour toute l'entreprise, et le plan d'achat
-- le suit. Le bouton « Restes » de l'écran /stock bascule l'affichage pour la
-- session (`?restes=exclus|comptes`), sans toucher au réglage.
--
--   P_ProjeteRestes = 1 : les restes comptent dans le stock du projeté ;
--                     0 : ils en sont retirés (magasins et machines).
--
-- Aucun objet créé. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
                       categorie, modifiable_par, verrouille) VALUES
 ('P_ProjeteRestes', 'Stock projeté : restes comptés (1 = oui, 0 = non)', '1', 'ENTIER', NULL,
  'Les restes (magasins et machines) comptent-ils dans le stock du projeté et du plan d''achat ? 1 = oui (par défaut), 0 = non. Le bouton Restes de l''écran ne change que l''affichage.',
  'STOCK', 'DIRECTION', 0)
ON CONFLICT (code_parametre) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_ProjeteRestes') THEN
        RAISE EXCEPTION '2026-10-31c : P_ProjeteRestes absent.';
    END IF;
END $$;

COMMIT;
