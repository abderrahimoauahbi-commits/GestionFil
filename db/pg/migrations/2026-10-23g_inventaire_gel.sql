-- =============================================================================
-- 2026-10-23g — Inventaire ouvert : le magasin est gelé
-- =============================================================================
-- DÉCISION DE L'UTILISATEUR (23/10/2026) : « sur l'inventaire ouvert, il ne faut
-- faire aucun mouvement ».
--
-- CE QUI EXISTAIT. La règle 10 (08/10/2026) lisait l'écart à l'heure du comptage
-- et laissait passer les mouvements pendant le comptage : « le magasin n'est pas
-- gelé ». Un mouvement passé entre la photo et le comptage faussait le
-- théorique ; un mouvement passé entre le comptage et la clôture n'était pas vu.
--
-- CE QUE FAIT CETTE MIGRATION, EN BASE (ADR-001 D-04), quel que soit le chemin
-- (écran, import, script, contre-passation, fiche machine, transfert) :
--
--   1. TANT QU'UN INVENTAIRE DU MAGASIN EST OUVERT (brouillon ou validé — ni
--      clôturé ni annulé), AUCUN MOUVEMENT n'y entre ni n'en sort : l'en-tête
--      (`mouvement`) ET chaque ligne (`ligne_mouvement`, la seule écriture qui
--      touche `stock_magasin` / `stock_lot`, par `trg_lmvt_appliquer`) sont
--      refusés, avec le numéro de l'inventaire. Tout le magasin, quel que soit
--      le type d'inventaire (GLOBAL, TOURNANT, CIBLE) : lecture littérale de la
--      décision. L'arrivée d'un transfert sur un magasin gelé est refusée aussi.
--   2. SEULS PASSENT LES AJUSTEMENTS DE SA CLÔTURE, rattachés à l'inventaire par
--      une colonne, pas devinés au type : `mouvement.id_inventaire` (posée par
--      `domain/inventaire.rs::cloturer`, et par lui seul). Un mouvement qui la
--      porte doit être un AJUST_INV_* du magasin de cet inventaire, inventaire
--      VALIDÉ (la clôture ne part que de là), un seul vivant par sens ; et chaque
--      ligne doit être un écart de cet inventaire (même référence, même lot, même
--      sens, même quantité), pas plus de fois qu'il n'y en a. Une contre-passation
--      AJUST_INV_NEG ou une saisie qui prendrait ce type reste refusée.
--   3. C65, UN SIGNAL (jamais un blocage) : un mouvement daté de la période de
--      comptage d'un inventaire clôturé — passé pendant le comptage avant ce gel,
--      ou antidaté après la clôture dans cette période. Le comptage ne l'a pas vu.
--
-- Rejouable : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, déclencheurs déposés
-- puis recréés, C65 ajouté une fois. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---- 1. L'ajustement porte son inventaire --------------------------------------
ALTER TABLE mouvement ADD COLUMN IF NOT EXISTS id_inventaire text REFERENCES inventaire(id_inventaire);
CREATE INDEX IF NOT EXISTS ix_mouvement_inventaire ON mouvement(id_inventaire) WHERE id_inventaire IS NOT NULL;

-- ---- 2. L'inventaire ouvert d'un magasin ---------------------------------------
-- Au plus un (ux_inventaire_ouvert, 2026-10-13b) ; LIMIT 1 si l'index manquait.
CREATE OR REPLACE FUNCTION fn_inventaire_ouvert(p_magasin text) RETURNS text AS $$
    SELECT id_inventaire FROM inventaire
     WHERE code_magasin = p_magasin AND statut IN ('BROUILLON', 'VALIDE')
     ORDER BY date_creation LIMIT 1;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_ouvert(text) OWNER TO gestionfil;

-- Le message, en un seul endroit : en-tête et ligne disent la même chose.
CREATE OR REPLACE FUNCTION fn_inventaire_ouvert_message(p_id text) RETURNS text AS $$
    SELECT 'INVENTAIRE-OUVERT : l''inventaire ' || numero_inventaire
           || ' est ouvert sur le magasin ' || code_magasin
           || CASE statut WHEN 'VALIDE' THEN ' (comptage validé, à clôturer)' ELSE ' (en comptage)' END
           || ' : aucun mouvement de stock jusqu''à sa clôture ou son annulation.'
      FROM inventaire WHERE id_inventaire = p_id;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_ouvert_message(text) OWNER TO gestionfil;

-- ---- 3. L'en-tête -----------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_mouvement_inventaire_ouvert() RETURNS trigger AS $$
DECLARE
    v_ouvert text;
    v_inv    record;
BEGIN
    -- UN MOUVEMENT RATTACHÉ À UN INVENTAIRE n'est qu'un ajustement de sa clôture.
    IF NEW.id_inventaire IS NOT NULL THEN
        SELECT numero_inventaire, code_magasin, statut INTO v_inv
          FROM inventaire WHERE id_inventaire = NEW.id_inventaire;
        IF NEW.code_type_mvt NOT IN ('AJUST_INV_POS', 'AJUST_INV_NEG')
           OR v_inv.code_magasin IS DISTINCT FROM NEW.code_magasin
           OR v_inv.statut IS DISTINCT FROM 'VALIDE' THEN
            RAISE EXCEPTION 'INVENTAIRE-OUVERT : seul un ajustement (AJUST_INV_POS / AJUST_INV_NEG) du magasin de l''inventaire %, écrit à sa clôture, se rattache à lui (mouvement %, magasin %, inventaire %).',
                COALESCE(v_inv.numero_inventaire, NEW.id_inventaire), NEW.code_type_mvt, NEW.code_magasin,
                lower(COALESCE(v_inv.statut, 'introuvable'));
        END IF;
        -- Un seul ajustement vivant par sens : un second appliquerait deux fois
        -- les écarts. Après une dévalidation, les premiers sont contre-passés.
        IF EXISTS (SELECT 1 FROM mouvement m
                    WHERE m.id_inventaire = NEW.id_inventaire
                      AND m.code_type_mvt = NEW.code_type_mvt
                      AND NOT EXISTS (SELECT 1 FROM mouvement c
                                       WHERE c.id_mouvement_contrepasse = m.id_mouvement)) THEN
            RAISE EXCEPTION 'INVENTAIRE-OUVERT : les ajustements % de l''inventaire % sont déjà écrits.',
                NEW.code_type_mvt, v_inv.numero_inventaire;
        END IF;
        RETURN NEW;
    END IF;

    v_ouvert := fn_inventaire_ouvert(NEW.code_magasin);
    IF v_ouvert IS NOT NULL THEN
        RAISE EXCEPTION '%', fn_inventaire_ouvert_message(v_ouvert);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_mouvement_inventaire_ouvert() OWNER TO gestionfil;

-- « trg_01_ » : juste après la normalisation des dates (trg_00_date_vide), avant
-- les autres refus — sur un magasin gelé, c'est le gel qu'on doit lire.
DROP TRIGGER IF EXISTS trg_01_mouvement_inventaire_ouvert ON mouvement;
CREATE TRIGGER trg_01_mouvement_inventaire_ouvert
    BEFORE INSERT ON mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_mouvement_inventaire_ouvert();

-- ---- 4. Les lignes : la garantie ---------------------------------------------
-- `ligne_mouvement` est la seule écriture qui touche le stock (trg_lmvt_appliquer).
-- Une ligne greffée à un en-tête écrit avant l'ouverture de l'inventaire serait
-- passée sans cette garde.
CREATE OR REPLACE FUNCTION fn_trg_lmvt_inventaire_ouvert() RETURNS trigger AS $$
DECLARE
    v_magasin text;
    v_inv_mvt text;
    v_signe   integer;
    v_ouvert  text;
    v_ecarts  bigint;
    v_deja    bigint;
BEGIN
    SELECT m.code_magasin, m.id_inventaire, tm.signe
      INTO v_magasin, v_inv_mvt, v_signe
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    v_ouvert := fn_inventaire_ouvert(v_magasin);
    IF v_ouvert IS NULL THEN
        RETURN NEW;
    END IF;

    IF v_inv_mvt IS DISTINCT FROM v_ouvert THEN
        RAISE EXCEPTION '%', fn_inventaire_ouvert_message(v_ouvert);
    END IF;

    -- L'AJUSTEMENT DE LA CLÔTURE : chaque ligne est un écart de l'inventaire,
    -- même référence, même lot, même sens, même quantité — et pas plus de fois
    -- que l'inventaire n'en porte.
    SELECT count(*) INTO v_ecarts
      FROM ligne_inventaire li
     WHERE li.id_inventaire = v_ouvert
       AND li.code_reference = NEW.code_reference
       AND li.lot_fournisseur IS NOT DISTINCT FROM NEW.lot_fournisseur
       AND sign(li.ecart_kg) = v_signe
       AND abs(abs(li.ecart_kg) - NEW.quantite_kg) < 0.00005;
    SELECT count(*) INTO v_deja
      FROM ligne_mouvement lm
     WHERE lm.id_mouvement = NEW.id_mouvement
       AND lm.code_reference = NEW.code_reference
       AND lm.lot_fournisseur IS NOT DISTINCT FROM NEW.lot_fournisseur
       AND abs(lm.quantite_kg - NEW.quantite_kg) < 0.00005;
    IF v_ecarts > v_deja THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'INVENTAIRE-OUVERT : % kg de % (%) ne correspond à aucun écart restant de l''inventaire % : un ajustement ne porte que les écarts du comptage.',
        NEW.quantite_kg, NEW.code_reference, COALESCE('lot ' || NEW.lot_fournisseur, 'sans lot'),
        (SELECT numero_inventaire FROM inventaire WHERE id_inventaire = v_ouvert);
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_inventaire_ouvert() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_01_lmvt_inventaire_ouvert ON ligne_mouvement;
CREATE TRIGGER trg_01_lmvt_inventaire_ouvert
    BEFORE INSERT ON ligne_mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_lmvt_inventaire_ouvert();

-- ---- 5. C65 : un mouvement daté de la période de comptage (SIGNAL) -------------
-- Pour un inventaire clôturé, du jour de son ouverture au jour de sa clôture
-- (jours de Casablanca) : un mouvement du magasin saisi après l'ouverture, et
-- daté de cette période. Soit il est passé pendant le comptage (avant le gel du
-- 23/10/2026), soit il a été antidaté après la clôture. Le comptage ne l'a pas
-- vu. Un mouvement saisi après la clôture et daté du jour même de la clôture
-- n'en est pas un (le jour continue). Les ajustements de l'inventaire et leurs
-- contre-passations sont exclus.
CREATE OR REPLACE VIEW v_ctl_c65 AS
SELECT i.numero_inventaire, i.code_magasin,
       (i.date_creation AT TIME ZONE 'Africa/Casablanca')::date AS jour_ouverture,
       (i.date_cloture  AT TIME ZONE 'Africa/Casablanca')::date AS jour_cloture,
       m.numero_mouvement, m.code_type_mvt, m.date_mouvement, m.date_creation AS saisi_le,
       CASE WHEN m.date_creation <= i.date_cloture THEN 'PENDANT_LE_COMPTAGE' ELSE 'ANTIDATE' END AS nature
  FROM inventaire i
  JOIN mouvement m ON m.code_magasin = i.code_magasin
 WHERE i.statut = 'CLOTURE'
   AND i.date_cloture IS NOT NULL
   AND m.date_creation > i.date_creation
   AND m.date_mouvement BETWEEN (i.date_creation AT TIME ZONE 'Africa/Casablanca')::date
                            AND (i.date_cloture  AT TIME ZONE 'Africa/Casablanca')::date
   AND (m.date_creation <= i.date_cloture
        OR m.date_mouvement < (i.date_cloture AT TIME ZONE 'Africa/Casablanca')::date)
   -- Les ajustements de l'inventaire (rattachés, ou, avant ce gel, par leur
   -- référence de document) et leurs contre-passations.
   AND m.id_inventaire IS DISTINCT FROM i.id_inventaire
   AND NOT (m.code_type_mvt IN ('AJUST_INV_POS', 'AJUST_INV_NEG')
            AND m.reference_document = i.numero_inventaire)
   AND NOT EXISTS (SELECT 1 FROM mouvement a
                    WHERE a.id_mouvement = m.id_mouvement_contrepasse
                      AND (a.id_inventaire = i.id_inventaire
                           OR (a.code_type_mvt IN ('AJUST_INV_POS', 'AJUST_INV_NEG')
                               AND a.reference_document = i.numero_inventaire)));
ALTER VIEW v_ctl_c65 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('v_ctl_c65' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C65''::text, ''Mouvement daté de la période de comptage d''''un inventaire clôturé''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c65)';
    END IF;
END $$;

-- ---- 6. Témoin ----------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_01_mouvement_inventaire_ouvert')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_01_lmvt_inventaire_ouvert')
       OR position('v_ctl_c65' IN pg_get_viewdef('v_controles'::regclass)) = 0 THEN
        RAISE EXCEPTION 'Gel des magasins en inventaire incomplet : déclencheurs ou C65 manquant.';
    END IF;
END $$;

COMMIT;
