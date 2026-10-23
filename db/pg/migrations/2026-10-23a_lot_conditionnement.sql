-- =============================================================================
-- 2026-10-23a — Chaque lot a son conditionnement (décision du 23/10/2026)
-- =============================================================================
-- « Si un lot a une modification des poids de bobine, tout sera faux, et même
-- pour les nb palettes. » Le poids d'une bobine et les bobines par palette
-- n'étaient que sur la fiche article ; le poids réel varie d'un lot à l'autre.
--
--   1. LE LOT PORTE SON CONDITIONNEMENT : `poids_bobine_kg`, `bobines_par_palette`,
--      d'où vient chaque valeur (`origine_poids_bobine`, `origine_bobines_palette` :
--      RECEPTION, HISTORIQUE, MOUVEMENT, FICHE_ARTICLE, CORRECTION) et quand
--      (`date_conditionnement`).
--   2. À SA NAISSANCE (premier mouvement du lot), le lot prend la fiche article
--      (origine FICHE_ARTICLE) ; un facteur absent de la fiche reste absent.
--   3. À LA RÉCEPTION (`fn_lot_conditionnement_reception`, appelée par le service à
--      la validation, avant le suivi du conditionnement de la fiche article) :
--      poids = kilos reçus / bobines comptées ; bobines par palette = bobines /
--      palettes entières — sur TOUTES les réceptions validées du lot (locales et
--      import). Même garde-fou que la fiche article (2026-10-03c) : une mesure à
--      plus de 50 % de la fiche est une erreur de saisie, gardée dans l'historique
--      du lot mais non appliquée. Une CORRECTION manuelle n'est jamais écrasée par
--      une réception : la mesure est notée, non appliquée.
--   4. L'HISTORIQUE DU CONDITIONNEMENT DU LOT : `lot_conditionnement_journal`
--      (immuable) — chaque mesure de réception (appliquée ou non) et chaque
--      correction, avec les valeurs avant / après, la source, le document, le
--      motif et l'auteur. Une CORRECTION (fiche du lot, droit VALIDER sur les
--      lots) passe par le service : UPDATE du lot (audité) + ligne de journal.
--      (Une table à part plutôt qu'un type de plus dans `lot_evenement` : la
--      migration 2026-10-09s, rejouée, réécrit la liste de ses types.)
--   5. LES CONVERSIONS SUR UN LOT : `fn_lot_poids_bobine(ref, lot)` et
--      `fn_lot_bobines_palette(ref, lot)` — le lot, sinon la fiche article ; jamais
--      un facteur 1. Même règle en Rust (`unites::charger_pour_lot`) et à l'écran
--      (`conditionnementDuLot`, lib/conditionnement.ts).
--   6. REPRISE DES LOTS EXISTANTS (règle documentée, appliquée aux seuls lots sans
--      valeur, donc rejouable) — pour chaque facteur, la première source qui le
--      donne :
--        a. RECEPTION  : les réceptions validées du lot (locales : ligne_reception
--                        des réceptions VALIDE ou CLOTURE ; import :
--                        import_reception_lignes des réceptions VALIDEE) — kilos /
--                        bobines comptées, bobines / palettes entières ;
--        b. HISTORIQUE : la mesure retenue (poids_applique / colisage_applique = 1)
--                        de `historique_conditionnement` pour un document qui a
--                        reçu ce lot (la plus récente) — la livraison du lot quand
--                        sa propre ligne n'avait pas de bobines ;
--        c. MOUVEMENT  : les entrées du lot qui portent des bobines (STOCK_INIT,
--                        ENTREE_REC) — kilos / bobines ;
--        d. FICHE_ARTICLE : la fiche article d'aujourd'hui.
--      Les mesures a–c passent le même garde-fou de 50 %.
--   7. `v_lot` montre le conditionnement du lot (colonnes ajoutées en fin) ; les
--      champs affichés sont déclarés (`champ_configurable`, module STOCK).
--
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- 1. Les colonnes
-- -----------------------------------------------------------------------------
ALTER TABLE lot ADD COLUMN IF NOT EXISTS poids_bobine_kg         numeric(18,4);
ALTER TABLE lot ADD COLUMN IF NOT EXISTS bobines_par_palette     bigint;
ALTER TABLE lot ADD COLUMN IF NOT EXISTS origine_poids_bobine    text;
ALTER TABLE lot ADD COLUMN IF NOT EXISTS origine_bobines_palette text;
ALTER TABLE lot ADD COLUMN IF NOT EXISTS date_conditionnement    timestamptz;

ALTER TABLE lot DROP CONSTRAINT IF EXISTS lot_poids_bobine_positif;
ALTER TABLE lot ADD CONSTRAINT lot_poids_bobine_positif
    CHECK (poids_bobine_kg IS NULL OR poids_bobine_kg > 0);
ALTER TABLE lot DROP CONSTRAINT IF EXISTS lot_bobines_palette_positif;
ALTER TABLE lot ADD CONSTRAINT lot_bobines_palette_positif
    CHECK (bobines_par_palette IS NULL OR bobines_par_palette > 0);
ALTER TABLE lot DROP CONSTRAINT IF EXISTS lot_origine_conditionnement;
ALTER TABLE lot ADD CONSTRAINT lot_origine_conditionnement
    CHECK ((origine_poids_bobine IS NULL
            OR origine_poids_bobine IN ('RECEPTION', 'HISTORIQUE', 'MOUVEMENT', 'FICHE_ARTICLE', 'CORRECTION'))
       AND (origine_bobines_palette IS NULL
            OR origine_bobines_palette IN ('RECEPTION', 'HISTORIQUE', 'MOUVEMENT', 'FICHE_ARTICLE', 'CORRECTION')));

COMMENT ON COLUMN lot.poids_bobine_kg IS
  'Le poids d''une bobine DE CE LOT (23/10/2026) : mesuré à la réception (kg / bobines), sinon la fiche article ; corrigé sur la fiche du lot.';
COMMENT ON COLUMN lot.bobines_par_palette IS
  'Les bobines par palette DE CE LOT (23/10/2026) : observées à la réception (bobines / palettes entières), sinon la fiche article.';

-- L'historique du conditionnement du lot : un journal, ni modifié ni effacé.
CREATE TABLE IF NOT EXISTS lot_conditionnement_journal (
    id_journal              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code_reference          text NOT NULL,
    lot_fournisseur         text NOT NULL,
    date_evenement          timestamptz NOT NULL DEFAULT now(),
    source                  text NOT NULL CHECK (source IN ('RECEPTION', 'CORRECTION')),
    document                text,
    poids_avant             numeric(18,4),
    poids_mesure            numeric(18,4),
    poids_apres             numeric(18,4),
    bobines_palette_avant   bigint,
    bobines_palette_mesure  bigint,
    bobines_palette_apres   bigint,
    -- La mesure a-t-elle été appliquée au lot ? Non : garde-fou de 50 % ou correction manuelle.
    applique                boolean NOT NULL,
    motif                   text NOT NULL CHECK (btrim(motif) <> ''),
    id_utilisateur          text REFERENCES utilisateur(id_utilisateur),
    FOREIGN KEY (code_reference, lot_fournisseur) REFERENCES lot (code_reference, lot_fournisseur)
);
ALTER TABLE lot_conditionnement_journal OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_lot_conditionnement_journal_lot
    ON lot_conditionnement_journal (code_reference, lot_fournisseur, date_evenement);
CREATE INDEX IF NOT EXISTS ix_fk_lot_conditionnement_journal_utilisateur
    ON lot_conditionnement_journal (id_utilisateur);

CREATE OR REPLACE FUNCTION fn_trg_lot_conditionnement_journal_immuable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lot_conditionnement_journal est un journal : ni modification, ni suppression.';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lot_conditionnement_journal_immuable() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_lot_conditionnement_journal_immuable ON lot_conditionnement_journal;
CREATE TRIGGER trg_lot_conditionnement_journal_immuable
BEFORE UPDATE OR DELETE ON lot_conditionnement_journal FOR EACH ROW
EXECUTE FUNCTION fn_trg_lot_conditionnement_journal_immuable();

-- -----------------------------------------------------------------------------
-- 2. Les conversions sur un lot : le lot, sinon la fiche article
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lot_poids_bobine(p_reference text, p_lot text)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT NULLIF(l.poids_bobine_kg, 0) FROM lot l
          WHERE l.code_reference = p_reference AND l.lot_fournisseur = p_lot),
        (SELECT NULLIF(r.poids_bobine_kg, 0) FROM reference r WHERE r.code_reference = p_reference))
$$;
ALTER FUNCTION fn_lot_poids_bobine(text, text) OWNER TO gestionfil;
COMMENT ON FUNCTION fn_lot_poids_bobine(text, text) IS
  'Le poids d''une bobine du lot, sinon celui de la fiche article ; NULL si aucun (jamais 1). 2026-10-23a.';

CREATE OR REPLACE FUNCTION fn_lot_bobines_palette(p_reference text, p_lot text)
RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT NULLIF(l.bobines_par_palette, 0) FROM lot l
          WHERE l.code_reference = p_reference AND l.lot_fournisseur = p_lot),
        (SELECT NULLIF(r.bobines_par_palette, 0) FROM reference r WHERE r.code_reference = p_reference))
$$;
ALTER FUNCTION fn_lot_bobines_palette(text, text) OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 3. À la naissance du lot : la fiche article
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_lot_conditionnement_naissance() RETURNS trigger AS $$
DECLARE
    v_poids numeric;
    v_bpp   bigint;
BEGIN
    SELECT NULLIF(poids_bobine_kg, 0), NULLIF(bobines_par_palette, 0) INTO v_poids, v_bpp
      FROM reference WHERE code_reference = NEW.code_reference;
    IF NEW.poids_bobine_kg IS NULL AND v_poids IS NOT NULL THEN
        NEW.poids_bobine_kg := round(v_poids, 4);
        NEW.origine_poids_bobine := 'FICHE_ARTICLE';
    END IF;
    IF NEW.bobines_par_palette IS NULL AND v_bpp IS NOT NULL THEN
        NEW.bobines_par_palette := v_bpp;
        NEW.origine_bobines_palette := 'FICHE_ARTICLE';
    END IF;
    IF NEW.date_conditionnement IS NULL
       AND (NEW.poids_bobine_kg IS NOT NULL OR NEW.bobines_par_palette IS NOT NULL) THEN
        NEW.date_conditionnement := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lot_conditionnement_naissance() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_10_lot_conditionnement_naissance ON lot;
CREATE TRIGGER trg_10_lot_conditionnement_naissance
BEFORE INSERT ON lot FOR EACH ROW
EXECUTE FUNCTION fn_trg_lot_conditionnement_naissance();

-- -----------------------------------------------------------------------------
-- 4. Ce que les réceptions validées mesurent, par lot
-- -----------------------------------------------------------------------------
-- Une ligne de réception ne porte qu'un lot (2026-10-21d). Les palettes ne
-- comptent qu'entières : une palette entamée fausserait le compte (même règle
-- que le suivi du conditionnement de la fiche article, 2026-10-03c).
CREATE OR REPLACE VIEW v_lot_conditionnement_mesure AS
WITH lignes AS (
    SELECT lr.code_reference, lr.lot_fournisseur, lr.id_reception AS id_document,
           lr.quantite_stock_kg AS kg, lr.nb_bobines_saisi AS bobines, lr.nb_palettes_saisi AS palettes
      FROM ligne_reception lr
      JOIN reception rc ON rc.id_reception = lr.id_reception
     WHERE rc.statut IN ('VALIDE', 'CLOTURE')
       AND btrim(COALESCE(lr.lot_fournisseur, '')) <> ''
       AND lr.quantite_stock_kg > 0
    UNION ALL
    SELECT l.code_reference, rl.lot_fournisseur, rl.id_reception,
           rl.quantite_recue_kg, NULLIF(rl.nb_bobines, 0), NULLIF(rl.nb_palettes, 0)::numeric
      FROM import_reception_lignes rl
      JOIN import_receptions ir    ON ir.id_reception = rl.id_reception
      JOIN import_facture_lignes l ON l.id_ligne = rl.id_ligne
     WHERE ir.statut = 'VALIDEE'
       AND l.code_reference IS NOT NULL
       AND btrim(COALESCE(rl.lot_fournisseur, '')) <> ''
       AND rl.quantite_recue_kg > 0
),
agg AS (
    SELECT code_reference, lot_fournisseur,
           sum(kg) FILTER (WHERE bobines > 0)                                     AS kg_compte,
           sum(bobines) FILTER (WHERE bobines > 0)                                AS bobines,
           sum(bobines) FILTER (WHERE bobines > 0 AND palettes > 0 AND palettes = trunc(palettes)) AS bobines_palettisees,
           sum(palettes) FILTER (WHERE bobines > 0 AND palettes > 0 AND palettes = trunc(palettes)) AS palettes
      FROM lignes
     GROUP BY code_reference, lot_fournisseur
)
SELECT a.code_reference, a.lot_fournisseur,
       CASE WHEN a.bobines > 0 AND a.kg_compte > 0 THEN round(a.kg_compte / a.bobines, 4) END AS poids_mesure,
       CASE WHEN a.palettes > 0 AND a.bobines_palettisees > 0
            THEN round(a.bobines_palettisees / a.palettes)::bigint END                        AS bpp_observe,
       r.poids_bobine_kg     AS poids_fiche,
       r.bobines_par_palette AS bpp_fiche
  FROM agg a
  JOIN reference r ON r.code_reference = a.code_reference;
ALTER VIEW v_lot_conditionnement_mesure OWNER TO gestionfil;
COMMENT ON VIEW v_lot_conditionnement_mesure IS
  'Par lot : poids d''une bobine mesuré (kilos / bobines comptées) et bobines par palette observées (palettes entières) sur toutes ses réceptions validées, locales et import. 2026-10-23a.';

-- Le garde-fou : une mesure à plus de 50 % de la fiche est une erreur de saisie.
CREATE OR REPLACE FUNCTION fn_mesure_vraisemblable(p_mesure numeric, p_fiche numeric)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT p_mesure IS NOT NULL AND p_mesure > 0
       AND (COALESCE(p_fiche, 0) = 0 OR abs(p_mesure - p_fiche) / p_fiche <= 0.5)
$$;
ALTER FUNCTION fn_mesure_vraisemblable(numeric, numeric) OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 5. À la validation d'une réception : les lots qu'elle a reçus
-- -----------------------------------------------------------------------------
-- Appelée par le service (domain/reception.rs), dans la transaction de
-- validation, APRÈS les mouvements (le lot existe) et AVANT le suivi du
-- conditionnement de la fiche article (le garde-fou juge contre la fiche d'avant).
CREATE OR REPLACE FUNCTION fn_lot_conditionnement_reception(p_id_reception text, p_utilisateur text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
    v_numero text;
    r        record;
    v_poids  numeric;
    v_bpp    bigint;
    n        integer := 0;
BEGIN
    SELECT numero_reception INTO v_numero FROM reception WHERE id_reception = p_id_reception;
    FOR r IN
        SELECT l.code_reference, l.lot_fournisseur, l.poids_bobine_kg, l.bobines_par_palette,
               l.origine_poids_bobine, l.origine_bobines_palette,
               m.poids_mesure, m.bpp_observe, m.poids_fiche, m.bpp_fiche
          FROM (SELECT DISTINCT code_reference, lot_fournisseur FROM ligne_reception
                 WHERE id_reception = p_id_reception AND btrim(COALESCE(lot_fournisseur, '')) <> '') x
          JOIN lot l ON l.code_reference = x.code_reference AND l.lot_fournisseur = x.lot_fournisseur
          JOIN v_lot_conditionnement_mesure m
            ON m.code_reference = x.code_reference AND m.lot_fournisseur = x.lot_fournisseur
         FOR UPDATE OF l
    LOOP
        v_poids := CASE WHEN fn_mesure_vraisemblable(r.poids_mesure, r.poids_fiche) THEN r.poids_mesure END;
        v_bpp   := CASE WHEN fn_mesure_vraisemblable(r.bpp_observe, r.bpp_fiche) THEN r.bpp_observe END;
        IF v_poids IS NULL AND v_bpp IS NULL AND r.poids_mesure IS NULL AND r.bpp_observe IS NULL THEN
            CONTINUE;  -- rien de compté : le lot garde ce qu'il a
        END IF;
        -- UNE CORRECTION MANUELLE N'EST JAMAIS ÉCRASÉE : la mesure est notée.
        IF r.origine_poids_bobine = 'CORRECTION' THEN v_poids := NULL; END IF;
        IF r.origine_bobines_palette = 'CORRECTION' THEN v_bpp := NULL; END IF;
        IF (v_poids IS NOT NULL AND v_poids IS DISTINCT FROM r.poids_bobine_kg)
           OR (v_bpp IS NOT NULL AND v_bpp IS DISTINCT FROM r.bobines_par_palette)
           OR (v_poids IS NOT NULL AND r.origine_poids_bobine IS DISTINCT FROM 'RECEPTION')
           OR (v_bpp IS NOT NULL AND r.origine_bobines_palette IS DISTINCT FROM 'RECEPTION') THEN
            UPDATE lot
               SET poids_bobine_kg         = COALESCE(v_poids, poids_bobine_kg),
                   origine_poids_bobine    = CASE WHEN v_poids IS NOT NULL THEN 'RECEPTION' ELSE origine_poids_bobine END,
                   bobines_par_palette     = COALESCE(v_bpp, bobines_par_palette),
                   origine_bobines_palette = CASE WHEN v_bpp IS NOT NULL THEN 'RECEPTION' ELSE origine_bobines_palette END,
                   date_conditionnement    = now()
             WHERE code_reference = r.code_reference AND lot_fournisseur = r.lot_fournisseur;
            n := n + 1;
        END IF;
        IF (r.poids_mesure IS DISTINCT FROM r.poids_bobine_kg AND r.poids_mesure IS NOT NULL)
           OR (r.bpp_observe IS DISTINCT FROM r.bobines_par_palette AND r.bpp_observe IS NOT NULL) THEN
            INSERT INTO lot_conditionnement_journal
                (code_reference, lot_fournisseur, source, document,
                 poids_avant, poids_mesure, poids_apres,
                 bobines_palette_avant, bobines_palette_mesure, bobines_palette_apres,
                 applique, motif, id_utilisateur)
            VALUES (r.code_reference, r.lot_fournisseur, 'RECEPTION', COALESCE(v_numero, p_id_reception),
                    r.poids_bobine_kg, r.poids_mesure, COALESCE(v_poids, r.poids_bobine_kg),
                    r.bobines_par_palette, r.bpp_observe, COALESCE(v_bpp, r.bobines_par_palette),
                    v_poids IS NOT NULL OR v_bpp IS NOT NULL,
                    CASE WHEN v_poids IS NULL AND v_bpp IS NULL
                         THEN 'Mesure de la réception ' || COALESCE(v_numero, p_id_reception)
                              || ' non appliquée (garde-fou de 50 % ou correction manuelle)'
                         ELSE 'Mesure de la réception ' || COALESCE(v_numero, p_id_reception) END,
                    p_utilisateur);
        END IF;
    END LOOP;
    RETURN n;
END;
$$;
ALTER FUNCTION fn_lot_conditionnement_reception(text, text) OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 6. Reprise des lots existants (seulement ceux sans valeur : rejouable)
-- -----------------------------------------------------------------------------
-- a. Les réceptions validées du lot.
UPDATE lot l
   SET poids_bobine_kg = m.poids_mesure, origine_poids_bobine = 'RECEPTION', date_conditionnement = now()
  FROM v_lot_conditionnement_mesure m
 WHERE m.code_reference = l.code_reference AND m.lot_fournisseur = l.lot_fournisseur
   AND l.poids_bobine_kg IS NULL
   AND fn_mesure_vraisemblable(m.poids_mesure, m.poids_fiche);
UPDATE lot l
   SET bobines_par_palette = m.bpp_observe, origine_bobines_palette = 'RECEPTION', date_conditionnement = now()
  FROM v_lot_conditionnement_mesure m
 WHERE m.code_reference = l.code_reference AND m.lot_fournisseur = l.lot_fournisseur
   AND l.bobines_par_palette IS NULL
   AND fn_mesure_vraisemblable(m.bpp_observe, m.bpp_fiche);

-- b. L'historique du conditionnement d'un document qui a reçu ce lot (le plus récent).
WITH docs AS (
    SELECT lr.code_reference, lr.lot_fournisseur, lr.id_reception AS id_document
      FROM ligne_reception lr WHERE btrim(COALESCE(lr.lot_fournisseur, '')) <> ''
    UNION
    SELECT fl.code_reference, rl.lot_fournisseur, rl.id_reception
      FROM import_reception_lignes rl JOIN import_facture_lignes fl ON fl.id_ligne = rl.id_ligne
     WHERE fl.code_reference IS NOT NULL AND btrim(COALESCE(rl.lot_fournisseur, '')) <> ''
),
poids AS (
    SELECT DISTINCT ON (d.code_reference, d.lot_fournisseur)
           d.code_reference, d.lot_fournisseur, h.poids_bobine_mesure
      FROM docs d
      JOIN historique_conditionnement h ON h.id_document = d.id_document AND h.code_reference = d.code_reference
     WHERE h.poids_applique = 1 AND h.poids_bobine_mesure > 0
     ORDER BY d.code_reference, d.lot_fournisseur, h.date_evenement DESC
)
UPDATE lot l
   SET poids_bobine_kg = round(p.poids_bobine_mesure, 4), origine_poids_bobine = 'HISTORIQUE',
       date_conditionnement = now()
  FROM poids p
 WHERE p.code_reference = l.code_reference AND p.lot_fournisseur = l.lot_fournisseur
   AND l.poids_bobine_kg IS NULL;

WITH docs AS (
    SELECT lr.code_reference, lr.lot_fournisseur, lr.id_reception AS id_document
      FROM ligne_reception lr WHERE btrim(COALESCE(lr.lot_fournisseur, '')) <> ''
    UNION
    SELECT fl.code_reference, rl.lot_fournisseur, rl.id_reception
      FROM import_reception_lignes rl JOIN import_facture_lignes fl ON fl.id_ligne = rl.id_ligne
     WHERE fl.code_reference IS NOT NULL AND btrim(COALESCE(rl.lot_fournisseur, '')) <> ''
),
bpp AS (
    SELECT DISTINCT ON (d.code_reference, d.lot_fournisseur)
           d.code_reference, d.lot_fournisseur, h.bobines_palette_observe
      FROM docs d
      JOIN historique_conditionnement h ON h.id_document = d.id_document AND h.code_reference = d.code_reference
     WHERE h.colisage_applique = 1 AND h.bobines_palette_observe > 0
     ORDER BY d.code_reference, d.lot_fournisseur, h.date_evenement DESC
)
UPDATE lot l
   SET bobines_par_palette = b.bobines_palette_observe, origine_bobines_palette = 'HISTORIQUE',
       date_conditionnement = now()
  FROM bpp b
 WHERE b.code_reference = l.code_reference AND b.lot_fournisseur = l.lot_fournisseur
   AND l.bobines_par_palette IS NULL;

-- c. Les entrées du lot qui portent des bobines (stock d'ouverture, entrée de réception).
WITH e AS (
    SELECT lm.code_reference, lm.lot_fournisseur,
           round(sum(lm.quantite_kg) / sum(lm.nb_bobines), 4) AS poids
      FROM ligne_mouvement lm
      JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
     WHERE m.code_type_mvt IN ('STOCK_INIT', 'ENTREE_REC')
       AND lm.nb_bobines > 0 AND lm.quantite_kg > 0
       AND btrim(COALESCE(lm.lot_fournisseur, '')) <> ''
       AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
     GROUP BY lm.code_reference, lm.lot_fournisseur
)
UPDATE lot l
   SET poids_bobine_kg = e.poids, origine_poids_bobine = 'MOUVEMENT', date_conditionnement = now()
  FROM e JOIN reference r ON r.code_reference = e.code_reference
 WHERE e.code_reference = l.code_reference AND e.lot_fournisseur = l.lot_fournisseur
   AND l.poids_bobine_kg IS NULL
   AND fn_mesure_vraisemblable(e.poids, r.poids_bobine_kg);

-- d. La fiche article.
UPDATE lot l
   SET poids_bobine_kg = round(r.poids_bobine_kg, 4), origine_poids_bobine = 'FICHE_ARTICLE',
       date_conditionnement = COALESCE(l.date_conditionnement, now())
  FROM reference r
 WHERE r.code_reference = l.code_reference AND l.poids_bobine_kg IS NULL AND r.poids_bobine_kg > 0;
UPDATE lot l
   SET bobines_par_palette = r.bobines_par_palette, origine_bobines_palette = 'FICHE_ARTICLE',
       date_conditionnement = COALESCE(l.date_conditionnement, now())
  FROM reference r
 WHERE r.code_reference = l.code_reference AND l.bobines_par_palette IS NULL AND r.bobines_par_palette > 0;

-- -----------------------------------------------------------------------------
-- 7. v_lot : le conditionnement du lot (colonnes ajoutées en fin)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_lot AS
 WITH solde AS (
         SELECT stock_lot.code_reference,
            stock_lot.lot_fournisseur,
            sum(stock_lot.quantite_kg) AS kg,
            sum(stock_lot.nb_bobines) AS bobines,
            min(stock_lot.date_premiere_entree::text) AS premiere_entree
           FROM stock_lot
          GROUP BY stock_lot.code_reference, stock_lot.lot_fournisseur
        ), p AS (
         SELECT max(
                CASE
                    WHEN parametre.code_parametre = 'P_LotDormanceJours'::text THEN parametre.valeur_courante::numeric
                    ELSE NULL::numeric
                END) AS dormance,
            max(
                CASE
                    WHEN parametre.code_parametre = 'P_LotTolOrangePct'::text THEN parametre.valeur_courante::numeric
                    ELSE NULL::numeric
                END) AS orange,
            max(
                CASE
                    WHEN parametre.code_parametre = 'P_LotTolRougePct'::text THEN parametre.valeur_courante::numeric
                    ELSE NULL::numeric
                END) AS rouge
           FROM parametre
        )
 SELECT l.code_reference,
    r.designation,
    r.code_categorie,
    l.lot_fournisseur,
    l.origine,
    l.code_fournisseur,
    f.nom AS fournisseur_nom,
    l.statut,
        CASE
            WHEN r.suivi_lot = 1 THEN l.categorie
            ELSE 'PROJET'::text
        END AS categorie,
    r.type_lot,
    r.fusion_lot = 1 AS fusion_autorisee,
    l.fusionne_dans,
    fn_iso(l.date_creation) AS date_creation,
    fn_iso(l.date_derniere_activite) AS date_derniere_activite,
    COALESCE(s.kg, 0::numeric) AS solde_kg,
    COALESCE(s.bobines, 0::numeric) AS solde_bobines,
    sx.valeur AS seuil_valeur,
    sx.unite AS seuil_unite,
    sx.bobines AS seuil_bobines,
    sx.kg AS seuil_restes_kg,
    CURRENT_DATE - substr(fn_iso(l.date_derniere_activite), 1, 10)::date AS jours_sans_activite,
    COALESCE(s.kg, 0::numeric) > 0::numeric AND (CURRENT_DATE - substr(fn_iso(l.date_derniere_activite), 1, 10)::date)::numeric > p.dormance AS dormant,
    l.categorie = 'PROJET'::text AND l.statut = 'LIBRE'::text AND COALESCE(s.kg, 0::numeric) > 0::numeric AND NOT fn_lot_au_seuil(l.code_reference, s.kg, s.bobines) AS a_basculer,
    v.ecart_cumule_kg,
    v.ecart_cumule_pct,
    v.poids_reel_moyen_bobine_kg,
    r.poids_bobine_kg AS poids_catalogue_bobine_kg,
        CASE
            WHEN v.ecart_cumule_pct IS NULL THEN NULL::text
            WHEN abs(v.ecart_cumule_pct) > p.rouge THEN 'ROUGE'::text
            WHEN abs(v.ecart_cumule_pct) > p.orange THEN 'ORANGE'::text
            ELSE 'VERT'::text
        END AS alerte_derive,
    round(COALESCE(s.kg, 0::numeric) * COALESCE(( SELECT sm.cmup_mad
           FROM stock_magasin sm
          WHERE sm.code_reference = l.code_reference AND sm.cmup_mad IS NOT NULL
          ORDER BY sm.quantite_kg DESC
         LIMIT 1), r.cmup_mad, 0::numeric), 2) AS valeur_mad,
    -- LE CONDITIONNEMENT DU LOT (23/10/2026) : ce qui convertit palettes, bobines
    -- et kilos de CE lot ; d'où vient chaque valeur, et quand.
    l.poids_bobine_kg,
    l.bobines_par_palette,
    l.origine_poids_bobine,
    l.origine_bobines_palette,
    l.date_conditionnement,
    r.bobines_par_palette AS bobines_par_palette_catalogue
   FROM lot l
     JOIN reference r ON r.code_reference = l.code_reference
     LEFT JOIN fournisseur f ON f.code_fournisseur = l.code_fournisseur
     LEFT JOIN solde s ON s.code_reference = l.code_reference AND s.lot_fournisseur = l.lot_fournisseur
     LEFT JOIN v_lot_variation v ON v.code_reference = l.code_reference AND v.lot_fournisseur = l.lot_fournisseur
     LEFT JOIN LATERAL fn_lot_seuil(l.code_reference) sx(valeur, unite, bobines, kg) ON true
     CROSS JOIN p;
ALTER VIEW v_lot OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 8. Les champs affichés (module STOCK) — un champ non déclaré est masqué
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('STOCK', 'origine_poids_bobine',          'Origine du poids de bobine du lot',        'LECTURE', 0, 4460),
 ('STOCK', 'origine_bobines_palette',       'Origine des bobines par palette du lot',   'LECTURE', 0, 4462),
 ('STOCK', 'date_conditionnement',          'Date du conditionnement du lot',           'LECTURE', 0, 4464),
 ('STOCK', 'poids_bobine_lot_kg',           'Poids d''une bobine du lot (kg)',          'LECTURE', 0, 4466),
 ('STOCK', 'bobines_par_palette_lot',       'Bobines par palette du lot',               'LECTURE', 0, 4468),
 ('STOCK', 'bobines_par_palette_catalogue', 'Bobines par palette (fiche article)',      'LECTURE', 0, 4469),
 ('STOCK', 'poids_lot_kg',                  'Poids d''une bobine du lot, fiche machine', 'LECTURE', 0, 4467)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'STOCK', c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN (VALUES ('origine_poids_bobine'), ('origine_bobines_palette'), ('date_conditionnement'),
                    ('poids_bobine_lot_kg'), ('bobines_par_palette_lot'), ('bobines_par_palette_catalogue'),
                    ('poids_lot_kg')) c(champ)
 WHERE m.module = 'STOCK' AND m.champ = 'poids_bobine_kg'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'STOCK', c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN (VALUES ('origine_poids_bobine'), ('origine_bobines_palette'), ('date_conditionnement'),
                    ('poids_bobine_lot_kg'), ('bobines_par_palette_lot'), ('bobines_par_palette_catalogue'),
                    ('poids_lot_kg')) c(champ)
 WHERE d.module = 'STOCK' AND d.champ = 'poids_bobine_kg'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Témoin
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'lot' AND column_name = 'date_conditionnement')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_10_lot_conditionnement_naissance')
       OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_lot_conditionnement_reception')
       OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_lot_poids_bobine')
       OR to_regclass('public.v_lot_conditionnement_mesure') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'v_lot' AND column_name = 'origine_poids_bobine')
       OR to_regclass('public.lot_conditionnement_journal') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lot_conditionnement_journal_immuable') THEN
        RAISE EXCEPTION '2026-10-23a : migration incomplete';
    END IF;
END $$;

COMMIT;

SELECT origine_poids_bobine, count(*) AS lots FROM lot GROUP BY 1 ORDER BY 1;
