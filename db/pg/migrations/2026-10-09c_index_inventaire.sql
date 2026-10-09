-- =============================================================================
-- 2026-10-09c — Un seul inventaire en cours par magasin, garanti (audit v5)
-- =============================================================================
-- 2026-10-08_regles_p1 posait l'index `ux_inventaire_en_cours` SAUF si la base
-- portait deja deux inventaires en cours sur un meme magasin : elle le disait
-- par un NOTICE et demandait de « rejouer cette migration » apres avoir annule
-- le doublon. Or elle ne se rejoue plus une fois 08b passee (08b ajoute une
-- colonne a v_stock_physique, que CREATE OR REPLACE VIEW ne sait pas retirer).
--
-- L'index a donc sa propre migration. Elle ECHOUE tant qu'un doublon existe,
-- avec les numeros : la publication s'arrete la, l'ancien binaire peut etre
-- relance pour annuler le doublon (POST /api/inventaires/{id}/annuler), puis la
-- publication se relance et reprend ici. Sur une base sans doublon, elle pose
-- l'index (ou constate qu'il est deja pose).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE doublons text;
BEGIN
    SELECT string_agg(d.code_magasin || ' (' || d.nums || ')', ' ; ') INTO doublons
      FROM (SELECT code_magasin, string_agg(numero_inventaire, ', ' ORDER BY numero_inventaire) AS nums
              FROM inventaire WHERE statut = 'EN_COURS'
             GROUP BY code_magasin HAVING count(*) > 1) d;
    IF doublons IS NOT NULL THEN
        RAISE EXCEPTION 'Plusieurs inventaires en cours sur un meme magasin : %. Annulez le doublon (POST /api/inventaires/{id}/annuler, avec un motif), puis relancez la publication.', doublons;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inventaire_en_cours
    ON inventaire(code_magasin) WHERE statut = 'EN_COURS';

COMMIT;
