-- =============================================================================
-- 2026-10-24a — Le gel d'un inventaire selon son type ; son théorique au poids du lot
-- =============================================================================
-- DÉCISIONS DE L'UTILISATEUR (23/10/2026), après 2026-10-23g :
--
-- 1. L'ÉTENDUE DU GEL SUIT LE TYPE D'INVENTAIRE (logique SAP : l'article compté
--    est bloqué, pas l'entrepôt entier) :
--      * GLOBAL   : tout le magasin, comme en 23g ;
--      * TOURNANT, CIBLE : les seules RÉFÉRENCES de l'inventaire — celles de ses
--        lignes, lues À L'INSTANT DU MOUVEMENT — dans son magasin ; les autres
--        références du magasin bougent librement.
--    Les lignes d'un tournant ou d'un ciblé naissent à la création de
--    l'inventaire (`domain/inventaire.rs::preparer`) : le stock existant du
--    magasin, au lot pour une référence suivie. Un lot trouvé au comptage ouvre
--    sa ligne (`saisir_comptage`) : sa référence est gelée à partir de là.
--    UN TOURNANT OU UN CIBLÉ SANS AUCUNE LIGNE (magasin vide à la création, ou
--    brouillon d'avant le 13/10 jamais préparé) ne dit pas ce qu'il compte : il
--    gèle TOUT LE MAGASIN, comme un global — le défaut le plus prudent — et le
--    message le dit. Un type inconnu gèle aussi tout le magasin.
--    Le message nomme l'inventaire et, pour un gel par référence, la référence.
--    L'en-tête (`mouvement`) ne porte pas de référence : il n'est refusé que
--    pour un gel du magasin entier ; pour un gel par référence, chaque LIGNE
--    (`ligne_mouvement`, la seule écriture qui touche le stock) est jugée.
--    L'exemption des ajustements de clôture (`mouvement.id_inventaire`) est
--    inchangée.
--    `v_inventaire_gel` donne, par inventaire ouvert, l'étendue et les
--    références gelées : c'est ce que lit `GET /api/inventaires/ouverts`.
--    C65 (signal) prend la même étendue : pour un tournant ou un ciblé clôturé,
--    seul compte un mouvement dont une ligne porte une référence de l'inventaire.
--
-- 2. LE THÉORIQUE D'UNE LIGNE D'INVENTAIRE AU POIDS DU LOT : le poids d'une bobine
--    figé sur la ligne (`ligne_inventaire.poids_unitaire_theorique_kg`) est celui
--    du lot de la ligne (`fn_lot_poids_bobine` : le lot, sinon la fiche article,
--    jamais 1) ; le service le pose à la préparation, au lot trouvé et au
--    comptage, et convertit au même poids des bobines comptées sans kilos.
--    REPRISE, LA PLUS PRUDENTE : seules les lignes ENCORE À COMPTER (A_TRAITER)
--    d'un inventaire EN BROUILLON prennent le poids de leur lot — aucune quantité
--    enregistrée n'en dépend. Les lignes déjà comptées (leurs kilos sont saisis,
--    ou déduits à l'écran au poids d'alors) ne bougent pas : un recomptage les
--    remet au poids du lot. Les inventaires validés (comptage figé, INV-FIGE),
--    clôturés et annulés ne changent pas (historique).
--    NE CHANGE PAS : C43 et l'écart de poids d'un lot (poids_unitaire_theorique_kg
--    des MOUVEMENTS, dérive du lot) restent au poids de la fiche article — leur
--    rôle est de signaler l'écart à la fiche.
--
-- Rejouable : CREATE OR REPLACE, déclencheurs déposés puis recréés, reprise
-- bornée aux lignes à compter des brouillons, déclarations ON CONFLICT.
-- Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---- 1. L'étendue du gel d'un inventaire ---------------------------------------
-- Vrai : le gel porte sur ses références ; faux : sur tout le magasin.
CREATE OR REPLACE FUNCTION fn_inventaire_gel_par_reference(p_id text) RETURNS boolean AS $$
    SELECT COALESCE(
        (SELECT i.type_inventaire IN ('TOURNANT', 'CIBLE')
                AND EXISTS (SELECT 1 FROM ligne_inventaire li WHERE li.id_inventaire = i.id_inventaire)
           FROM inventaire i WHERE i.id_inventaire = p_id),
        false);
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_gel_par_reference(text) OWNER TO gestionfil;

-- La référence est-elle comptée par cet inventaire (l'une de ses lignes, tout lot) ?
CREATE OR REPLACE FUNCTION fn_inventaire_compte_reference(p_id text, p_reference text) RETURNS boolean AS $$
    SELECT EXISTS (SELECT 1 FROM ligne_inventaire li
                    WHERE li.id_inventaire = p_id AND li.code_reference = p_reference);
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_compte_reference(text, text) OWNER TO gestionfil;

-- ---- 2. Les messages ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_inventaire_type_libelle(p_type text) RETURNS text AS $$
    SELECT CASE p_type WHEN 'GLOBAL' THEN 'global' WHEN 'TOURNANT' THEN 'tournant'
                       WHEN 'CIBLE' THEN 'ciblé' ELSE lower(COALESCE(p_type, '?')) END;
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION fn_inventaire_type_libelle(text) OWNER TO gestionfil;

-- Le gel du magasin entier : un global, ou un tournant / ciblé encore sans ligne.
CREATE OR REPLACE FUNCTION fn_inventaire_ouvert_message(p_id text) RETURNS text AS $$
    SELECT 'INVENTAIRE-OUVERT : l''inventaire ' || i.numero_inventaire
           || ' (' || fn_inventaire_type_libelle(i.type_inventaire) || ')'
           || ' est ouvert sur le magasin ' || i.code_magasin
           || CASE i.statut WHEN 'VALIDE' THEN ' (comptage validé, à clôturer)' ELSE ' (en comptage)' END
           || CASE WHEN i.type_inventaire IN ('TOURNANT', 'CIBLE')
                   THEN ', encore sans aucune ligne (tout le magasin est gelé)'
                   ELSE '' END
           || ' : aucun mouvement de stock jusqu''à sa clôture ou son annulation.'
      FROM inventaire i WHERE i.id_inventaire = p_id;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_ouvert_message(text) OWNER TO gestionfil;

-- Le gel d'une référence : un tournant ou un ciblé qui la compte.
CREATE OR REPLACE FUNCTION fn_inventaire_ouvert_message(p_id text, p_reference text) RETURNS text AS $$
    SELECT 'INVENTAIRE-OUVERT : la référence ' || p_reference
           || ' est comptée par l''inventaire ' || i.numero_inventaire
           || ' (' || fn_inventaire_type_libelle(i.type_inventaire) || ')'
           || ' ouvert sur le magasin ' || i.code_magasin
           || CASE i.statut WHEN 'VALIDE' THEN ' (comptage validé, à clôturer)' ELSE ' (en comptage)' END
           || ' : aucun mouvement de cette référence dans ce magasin jusqu''à sa clôture ou son annulation'
           || ' (les autres références du magasin restent libres).'
      FROM inventaire i WHERE i.id_inventaire = p_id;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_ouvert_message(text, text) OWNER TO gestionfil;

-- ---- 3. L'en-tête : refusé seulement pour un gel du magasin entier ----------------
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

    -- L'en-tête ne porte pas de référence : un gel par référence (tournant, ciblé)
    -- se juge sur chaque ligne (section 4).
    v_ouvert := fn_inventaire_ouvert(NEW.code_magasin);
    IF v_ouvert IS NOT NULL AND NOT fn_inventaire_gel_par_reference(v_ouvert) THEN
        RAISE EXCEPTION '%', fn_inventaire_ouvert_message(v_ouvert);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_mouvement_inventaire_ouvert() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_01_mouvement_inventaire_ouvert ON mouvement;
CREATE TRIGGER trg_01_mouvement_inventaire_ouvert
    BEFORE INSERT ON mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_mouvement_inventaire_ouvert();

-- ---- 4. Les lignes : la garantie ---------------------------------------------
-- `ligne_mouvement` est la seule écriture qui touche le stock (trg_lmvt_appliquer).
-- Une ligne greffée à un en-tête écrit avant l'ouverture de l'inventaire serait
-- passée sans cette garde. Pour un gel par référence, c'est ici seulement qu'il se juge.
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
        -- UN MOUVEMENT ORDINAIRE. Gel du magasin entier : refusé. Gel par
        -- référence : refusé si l'inventaire compte cette référence, à l'instant.
        IF NOT fn_inventaire_gel_par_reference(v_ouvert) THEN
            RAISE EXCEPTION '%', fn_inventaire_ouvert_message(v_ouvert);
        END IF;
        IF fn_inventaire_compte_reference(v_ouvert, NEW.code_reference) THEN
            RAISE EXCEPTION '%', fn_inventaire_ouvert_message(v_ouvert, NEW.code_reference);
        END IF;
        RETURN NEW;
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

-- ---- 5. Ce qui est gelé, pour les écrans ------------------------------------------
-- Une ligne par inventaire ouvert : MAGASIN (tout le magasin) ou REFERENCES (ses
-- références, en tableau JSON trié). Même règle que les déclencheurs.
CREATE OR REPLACE VIEW v_inventaire_gel AS
SELECT i.id_inventaire, i.numero_inventaire, i.code_magasin, i.statut, i.type_inventaire,
       i.date_creation,
       CASE WHEN fn_inventaire_gel_par_reference(i.id_inventaire) THEN 'REFERENCES' ELSE 'MAGASIN' END
           AS etendue_gel,
       CASE WHEN fn_inventaire_gel_par_reference(i.id_inventaire)
            THEN COALESCE((SELECT jsonb_agg(r.code_reference ORDER BY r.code_reference)
                             FROM (SELECT DISTINCT li.code_reference FROM ligne_inventaire li
                                    WHERE li.id_inventaire = i.id_inventaire) r), '[]'::jsonb)
            ELSE '[]'::jsonb END AS references_gelees
  FROM inventaire i
 WHERE i.statut IN ('BROUILLON', 'VALIDE');
ALTER VIEW v_inventaire_gel OWNER TO gestionfil;

-- ---- 6. C65 à la même étendue -----------------------------------------------------
-- Même vue qu'en 23g (mêmes colonnes) ; pour un tournant ou un ciblé (avec
-- lignes), seul compte un mouvement dont une ligne porte une référence comptée.
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
   -- L'ÉTENDUE (2026-10-24a) : un global, ou un tournant / ciblé sans ligne,
   -- couvre tout le magasin ; sinon, les seules références comptées.
   AND (NOT (i.type_inventaire IN ('TOURNANT', 'CIBLE')
             AND EXISTS (SELECT 1 FROM ligne_inventaire l0 WHERE l0.id_inventaire = i.id_inventaire))
        OR EXISTS (SELECT 1 FROM ligne_mouvement lm
                     JOIN ligne_inventaire li ON li.id_inventaire = i.id_inventaire
                                             AND li.code_reference = lm.code_reference
                    WHERE lm.id_mouvement = m.id_mouvement))
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

-- ---- 7. Le théorique d'une ligne d'inventaire au poids du lot -----------------------
-- Les seules lignes encore à compter des brouillons (voir l'en-tête).
UPDATE ligne_inventaire li
   SET poids_unitaire_theorique_kg = fn_lot_poids_bobine(li.code_reference, li.lot_fournisseur)
  FROM inventaire i
 WHERE i.id_inventaire = li.id_inventaire
   AND i.statut = 'BROUILLON'
   AND li.statut_ligne = 'A_TRAITER'
   AND li.poids_unitaire_theorique_kg IS DISTINCT FROM fn_lot_poids_bobine(li.code_reference, li.lot_fournisseur);

-- Le conditionnement du lot, sur la feuille de comptage (`GET /api/inventaires/{id}/lignes`).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('INVENTAIRE', 'poids_bobine_lot_kg',     'Poids d''une bobine du lot (kg)', 'LECTURE', 0, 995),
 ('INVENTAIRE', 'bobines_par_palette_lot', 'Bobines par palette du lot',      'LECTURE', 0, 996)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;

-- ---- 8. Témoin ----------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_inventaire_gel_par_reference')
       OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_inventaire_ouvert_message' AND pronargs = 2)
       OR to_regclass('public.v_inventaire_gel') IS NULL
       OR position('fn_inventaire_gel_par_reference' IN pg_get_functiondef('fn_trg_lmvt_inventaire_ouvert'::regproc)) = 0
       OR position('fn_inventaire_gel_par_reference' IN pg_get_functiondef('fn_trg_mouvement_inventaire_ouvert'::regproc)) = 0
       OR position('ligne_inventaire' IN pg_get_viewdef('v_ctl_c65'::regclass)) = 0
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_01_lmvt_inventaire_ouvert')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_01_mouvement_inventaire_ouvert') THEN
        RAISE EXCEPTION '2026-10-24a : gel par référence incomplet.';
    END IF;
END $$;

COMMIT;
