-- =============================================================================
-- 2026-10-31a — Stock projeté : onglet Emplacements et jours sans fil (31/10/2026)
-- =============================================================================
-- Décisions du 31/10/2026 :
--
-- 1. LA COUVERTURE NÉGATIVE : quand le stock s'épuise avant un arrivage, la
--    colonne Couverture montre les JOURS SANS FIL en négatif (`jours_sans_fil`,
--    `domain/projete.rs`), sinon les jours couverts.
--
-- 2. L'ONGLET EMPLACEMENTS : le stock de chaque magasin au plan
--    (`stock_par_magasin`, un objet { magasin : kg }, hors bloqués et hors
--    restes), sur machines, restes, quarantaine, EN ROUTE = les transferts entre
--    magasins (`transit_kg`, déjà déclaré), COMMANDÉ = les autres arrivages datés
--    (`commande_kg`), et le STOCK APRÈS L'ARRIVAGE = disponible + quarantaine +
--    en route + commandé (`stock_apres_arrivage_kg`).
--
-- Les colonnes sont déclarées au module STOCK (une colonne non déclarée dans
-- `champ_configurable` est MASQUÉE à l'écran), droits repris de
-- `jours_couverture` rôle par rôle et compte par compte (même mécanisme que
-- 2026-10-30a). Aucun objet créé : pas d'OWNER à poser. Rejouable.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _colonnes_emplacements (champ text PRIMARY KEY, libelle text NOT NULL) ON COMMIT DROP;
INSERT INTO _colonnes_emplacements VALUES
    ('jours_sans_fil',          'Jours sans fil avant arrivage'),
    ('stock_par_magasin',       'Stock par magasin (kg)'),
    ('commande_kg',             'Commandé (kg)'),
    ('stock_apres_arrivage_kg', 'Stock global après l''arrivage (kg)');

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'STOCK', c.champ, c.libelle,
       COALESCE(j.niveau_defaut, 'LECTURE'), COALESCE(j.sensible, 0), COALESCE(j.ordre, 990)
  FROM _colonnes_emplacements c
  LEFT JOIN champ_configurable j ON j.module = 'STOCK' AND j.champ = 'jours_couverture'
ON CONFLICT (module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, m.module, c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN _colonnes_emplacements c
 WHERE m.module = 'STOCK' AND m.champ = 'jours_couverture'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, d.module, c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN _colonnes_emplacements c
 WHERE d.module = 'STOCK' AND d.champ = 'jours_couverture'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

DO $$
BEGIN
    IF (SELECT count(*) FROM champ_configurable c JOIN _colonnes_emplacements p ON p.champ = c.champ
         WHERE c.module = 'STOCK') <> (SELECT count(*) FROM _colonnes_emplacements) THEN
        RAISE EXCEPTION '2026-10-31a : colonnes de l''onglet Emplacements non déclarées.';
    END IF;
END $$;

COMMIT;
