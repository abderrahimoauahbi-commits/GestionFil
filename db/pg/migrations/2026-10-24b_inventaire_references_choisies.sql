-- =============================================================================
-- 2026-10-24b — Un inventaire tournant ou ciblé compte les références CHOISIES
-- =============================================================================
-- DÉCISION DE L'UTILISATEUR (23/10/2026), après 2026-10-24a :
--
-- CE QUI EXISTAIT. À la préparation, un TOURNANT et un CIBLE prenaient tout le
-- stock du magasin, comme un GLOBAL : depuis 24a ils ne gèlent que leurs
-- références, mais comme ils les prenaient toutes, ils gelaient presque tout.
--
-- CE QUE FAIT CETTE MIGRATION, EN BASE (ADR-001 D-04) :
--
--   1. LA LISTE DES RÉFÉRENCES D'UN INVENTAIRE : `inventaire_reference` (une ligne
--      par référence choisie ; origine PROPOSITION / CHOIX / REPRISE ; la classe
--      ABC et la date du dernier comptage lues au moment du choix, pour la trace).
--      Elle se choisit sur un inventaire TOURNANT ou CIBLE, en BROUILLON, tant que
--      ses lignes ne sont pas préparées ; ensuite elle est figée
--      (`trg_inventaire_reference_garde`, INV-SELECTION). Un GLOBAL n'en a pas.
--      `inventaire.date_selection` / `id_utilisateur_selection` : qui a validé la
--      liste, et quand (le service les pose avec la liste, puis prépare).
--   2. LES LIGNES D'UN TOURNANT OU D'UN CIBLÉ NE PORTENT QUE DES RÉFÉRENCES
--      CHOISIES (`trg_ligne_inventaire_selection`) : la préparation comme le lot
--      trouvé au comptage. Une référence non choisie trouvée au comptage est
--      REFUSÉE (défaut prudent : l'inventaire ne compte que ce qu'il a choisi) ;
--      sans aucune référence choisie, aucune ligne ne se prépare.
--   3. UN TOURNANT OU UN CIBLÉ SANS RÉFÉRENCE CHOISIE NE SE VALIDE PAS
--      (`trg_inventaire_selection_validation`) ; son type ne change plus une fois
--      sa liste ou ses lignes posées.
--   4. LE GEL SUIT LA LISTE : `fn_inventaire_gel_par_reference` = tournant ou
--      ciblé AYANT une liste ; `fn_inventaire_compte_reference` = référence de la
--      liste (ou d'une ligne : les lignes sont dans la liste, l'union est la
--      prudence). Un tournant ou un ciblé SANS RÉFÉRENCE CHOISIE gèle tout le
--      magasin, comme avant « sans ligne », et le message le dit.
--      `v_inventaire_gel` (mêmes colonnes) et C65 (mêmes colonnes) suivent.
--   5. LA PROPOSITION DU TOURNANT : `v_inventaire_candidat`, par magasin, les
--      références EN STOCK dans ce magasin, leur classe ABC (celle de la fiche
--      article, `reference.classe_abc`, calculée par domain/classification.rs —
--      pas recalculée ici ; absente : traitée comme C, `sans_classe`), la date de
--      leur DERNIER COMPTAGE DANS CE MAGASIN et si elles sont DUES : jamais
--      comptées, ou comptées il y a au moins N jours selon la classe
--      (P_ComptageTournantA / B / C, défauts 30 / 90 / 180 jours ;
--      `fn_comptage_tournant_jours`).
--      LA DATE DU DERNIER COMPTAGE : la plus récente `ligne_inventaire.date_comptage`
--      (à défaut la date de clôture) d'une ligne COMPTÉE d'un inventaire CLÔTURÉ du
--      magasin, quel que soit son type. `stock_magasin.date_dernier_inventaire`
--      n'est PAS retenue : la clôture la posait sur tout le magasin, même pour un
--      tournant qui n'avait compté que quelques références (corrigé dans le
--      service : elle ne se pose plus que sur les références comptées).
--
-- REPRISE, LA PLUS PRUDENTE : un TOURNANT ou un CIBLÉ OUVERT (brouillon ou validé)
-- qui a déjà ses lignes reçoit pour liste les références de ses lignes (origine
-- REPRISE) : ses lignes et son gel ne changent pas. Un tournant ou un ciblé ouvert
-- SANS ligne n'en reçoit pas : il gèle tout le magasin jusqu'à ce que sa liste soit
-- choisie et validée sur sa page. Les inventaires clos ou annulés ne changent pas
-- (C65 lit leurs lignes, comme avant).
--
-- Rejouable : CREATE TABLE / ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- déclencheurs déposés puis recréés, reprise bornée par NOT EXISTS, paramètres
-- et champs déclarés ON CONFLICT. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---- 1. La liste ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventaire_reference (
    id_inventaire     text        NOT NULL REFERENCES inventaire(id_inventaire) ON DELETE CASCADE,
    code_reference    text        NOT NULL REFERENCES reference(code_reference),
    -- PROPOSITION : proposée par le tournant (due) et gardée ; CHOIX : ajoutée par
    -- l'utilisateur (recherche, famille, catégorie) ; REPRISE : 2026-10-24b, depuis
    -- les lignes d'un inventaire ouvert déjà préparé.
    origine           text        NOT NULL CHECK (origine IN ('PROPOSITION', 'CHOIX', 'REPRISE')),
    -- La classe ABC de la fiche article au moment du choix (NULL : sans classe).
    classe_abc        text        CHECK (classe_abc IS NULL OR classe_abc IN ('A', 'B', 'C')),
    -- Le dernier comptage de la référence dans le magasin, au moment du choix.
    dernier_comptage  timestamptz,
    id_utilisateur    text        REFERENCES utilisateur(id_utilisateur),
    date_ajout        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id_inventaire, code_reference)
);
ALTER TABLE inventaire_reference OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_inventaire_reference_ref ON inventaire_reference(code_reference);
CREATE INDEX IF NOT EXISTS ix_inventaire_reference_utilisateur ON inventaire_reference(id_utilisateur);

-- Qui a validé la liste, et quand.
ALTER TABLE inventaire ADD COLUMN IF NOT EXISTS date_selection timestamptz;
ALTER TABLE inventaire ADD COLUMN IF NOT EXISTS id_utilisateur_selection text REFERENCES utilisateur(id_utilisateur);
CREATE INDEX IF NOT EXISTS ix_inventaire_id_utilisateur_selection ON inventaire(id_utilisateur_selection);

-- Le journal d'audit : ajout, retrait (générique, clé composée).
DROP TRIGGER IF EXISTS trg_audit_modification ON inventaire_reference;
CREATE TRIGGER trg_audit_modification
    AFTER INSERT OR UPDATE OR DELETE ON inventaire_reference
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- ---- 2. La reprise (avant la garde, qui refuserait une liste après les lignes) ----
DROP TRIGGER IF EXISTS trg_inventaire_reference_garde ON inventaire_reference;
INSERT INTO inventaire_reference (id_inventaire, code_reference, origine, classe_abc, id_utilisateur, date_ajout)
SELECT DISTINCT i.id_inventaire, li.code_reference, 'REPRISE', r.classe_abc,
       i.id_utilisateur_responsable, i.date_creation
  FROM inventaire i
  JOIN ligne_inventaire li ON li.id_inventaire = i.id_inventaire
  JOIN reference r ON r.code_reference = li.code_reference
 WHERE i.type_inventaire IN ('TOURNANT', 'CIBLE')
   AND i.statut IN ('BROUILLON', 'VALIDE')
   AND NOT EXISTS (SELECT 1 FROM inventaire_reference s WHERE s.id_inventaire = i.id_inventaire);
UPDATE inventaire i
   SET date_selection = i.date_creation, id_utilisateur_selection = i.id_utilisateur_responsable
 WHERE i.date_selection IS NULL
   AND EXISTS (SELECT 1 FROM inventaire_reference s WHERE s.id_inventaire = i.id_inventaire AND s.origine = 'REPRISE');

-- ---- 3. La liste se choisit en brouillon, avant les lignes ------------------------
CREATE OR REPLACE FUNCTION fn_trg_inventaire_reference_garde() RETURNS trigger AS $$
DECLARE
    v_id  text := COALESCE(NEW.id_inventaire, OLD.id_inventaire);
    v_inv record;
BEGIN
    SELECT numero_inventaire, type_inventaire, statut INTO v_inv
      FROM inventaire WHERE id_inventaire = v_id;
    IF NOT FOUND THEN
        -- L'inventaire s'efface (cascade) : sa liste avec lui.
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'INV-SELECTION : inventaire % introuvable.', v_id;
    END IF;
    IF v_inv.type_inventaire NOT IN ('TOURNANT', 'CIBLE') THEN
        RAISE EXCEPTION 'INV-SELECTION : l''inventaire % est global : il compte tout le magasin, il ne choisit pas ses références.',
            v_inv.numero_inventaire;
    END IF;
    IF v_inv.statut <> 'BROUILLON' THEN
        RAISE EXCEPTION 'INV-SELECTION : l''inventaire % est % : sa liste de références ne change plus.',
            v_inv.numero_inventaire, lower(v_inv.statut);
    END IF;
    IF EXISTS (SELECT 1 FROM ligne_inventaire WHERE id_inventaire = v_id) THEN
        RAISE EXCEPTION 'INV-SELECTION : les lignes de l''inventaire % sont préparées : sa liste de références est figée (pour compter une autre liste, annulez-le et créez-en un autre).',
            v_inv.numero_inventaire;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_inventaire_reference_garde() OWNER TO gestionfil;

CREATE TRIGGER trg_inventaire_reference_garde
    BEFORE INSERT OR UPDATE OR DELETE ON inventaire_reference
    FOR EACH ROW EXECUTE FUNCTION fn_trg_inventaire_reference_garde();

-- ---- 4. Les lignes d'un tournant ou d'un ciblé : des références choisies ----------
CREATE OR REPLACE FUNCTION fn_trg_ligne_inventaire_selection() RETURNS trigger AS $$
DECLARE
    v_inv record;
BEGIN
    SELECT numero_inventaire, type_inventaire INTO v_inv
      FROM inventaire WHERE id_inventaire = NEW.id_inventaire;
    IF v_inv.type_inventaire IN ('TOURNANT', 'CIBLE')
       AND NOT EXISTS (SELECT 1 FROM inventaire_reference s
                        WHERE s.id_inventaire = NEW.id_inventaire
                          AND s.code_reference = NEW.code_reference) THEN
        IF NOT EXISTS (SELECT 1 FROM inventaire_reference s WHERE s.id_inventaire = NEW.id_inventaire) THEN
            RAISE EXCEPTION 'INV-SELECTION : l''inventaire % (%) n''a aucune référence choisie : choisissez et validez sa liste avant de préparer ses lignes.',
                v_inv.numero_inventaire, fn_inventaire_type_libelle(v_inv.type_inventaire);
        END IF;
        RAISE EXCEPTION 'INV-SELECTION : la référence % n''est pas dans la liste de l''inventaire % (%) : un inventaire tournant ou ciblé ne compte que les références choisies à sa préparation. Comptez-la dans un autre inventaire.',
            NEW.code_reference, v_inv.numero_inventaire, fn_inventaire_type_libelle(v_inv.type_inventaire);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_ligne_inventaire_selection() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_ligne_inventaire_selection ON ligne_inventaire;
CREATE TRIGGER trg_ligne_inventaire_selection
    BEFORE INSERT OR UPDATE OF code_reference, id_inventaire ON ligne_inventaire
    FOR EACH ROW EXECUTE FUNCTION fn_trg_ligne_inventaire_selection();

-- ---- 5. Sans liste, pas de validation ; le type ne change plus --------------------
CREATE OR REPLACE FUNCTION fn_trg_inventaire_selection_validation() RETURNS trigger AS $$
BEGIN
    IF NEW.type_inventaire IS DISTINCT FROM OLD.type_inventaire
       AND (EXISTS (SELECT 1 FROM inventaire_reference WHERE id_inventaire = OLD.id_inventaire)
            OR EXISTS (SELECT 1 FROM ligne_inventaire WHERE id_inventaire = OLD.id_inventaire)) THEN
        RAISE EXCEPTION 'INV-SELECTION : l''inventaire % a sa liste ou ses lignes : son type ne change plus.',
            OLD.numero_inventaire;
    END IF;
    IF NEW.statut = 'VALIDE' AND OLD.statut = 'BROUILLON'
       AND NEW.type_inventaire IN ('TOURNANT', 'CIBLE')
       AND NOT EXISTS (SELECT 1 FROM inventaire_reference WHERE id_inventaire = NEW.id_inventaire) THEN
        RAISE EXCEPTION 'INV-SELECTION : l''inventaire % (%) n''a aucune référence choisie : il ne se valide pas.',
            NEW.numero_inventaire, fn_inventaire_type_libelle(NEW.type_inventaire);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_inventaire_selection_validation() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_inventaire_selection_validation ON inventaire;
CREATE TRIGGER trg_inventaire_selection_validation
    BEFORE UPDATE OF statut, type_inventaire ON inventaire
    FOR EACH ROW EXECUTE FUNCTION fn_trg_inventaire_selection_validation();

-- ---- 6. Le gel suit la liste --------------------------------------------------------
-- Vrai : le gel porte sur ses références (un tournant ou un ciblé qui a sa liste) ;
-- faux : sur tout le magasin (un global, ou un tournant / ciblé sans liste).
CREATE OR REPLACE FUNCTION fn_inventaire_gel_par_reference(p_id text) RETURNS boolean AS $$
    SELECT COALESCE(
        (SELECT i.type_inventaire IN ('TOURNANT', 'CIBLE')
                AND EXISTS (SELECT 1 FROM inventaire_reference s WHERE s.id_inventaire = i.id_inventaire)
           FROM inventaire i WHERE i.id_inventaire = p_id),
        false);
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_gel_par_reference(text) OWNER TO gestionfil;

-- La référence est-elle comptée par cet inventaire : choisie, ou sur l'une de ses
-- lignes (les lignes sont dans la liste ; l'union est la prudence).
CREATE OR REPLACE FUNCTION fn_inventaire_compte_reference(p_id text, p_reference text) RETURNS boolean AS $$
    SELECT EXISTS (SELECT 1 FROM inventaire_reference s
                    WHERE s.id_inventaire = p_id AND s.code_reference = p_reference)
        OR EXISTS (SELECT 1 FROM ligne_inventaire li
                    WHERE li.id_inventaire = p_id AND li.code_reference = p_reference);
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_compte_reference(text, text) OWNER TO gestionfil;

-- Le gel du magasin entier : un global, ou un tournant / ciblé encore sans liste.
CREATE OR REPLACE FUNCTION fn_inventaire_ouvert_message(p_id text) RETURNS text AS $$
    SELECT 'INVENTAIRE-OUVERT : l''inventaire ' || i.numero_inventaire
           || ' (' || fn_inventaire_type_libelle(i.type_inventaire) || ')'
           || ' est ouvert sur le magasin ' || i.code_magasin
           || CASE i.statut WHEN 'VALIDE' THEN ' (comptage validé, à clôturer)' ELSE ' (en comptage)' END
           || CASE WHEN i.type_inventaire IN ('TOURNANT', 'CIBLE')
                   THEN ', encore sans référence choisie (tout le magasin est gelé jusqu''à la validation de sa liste)'
                   ELSE '' END
           || ' : aucun mouvement de stock jusqu''à sa clôture ou son annulation.'
      FROM inventaire i WHERE i.id_inventaire = p_id;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_inventaire_ouvert_message(text) OWNER TO gestionfil;

-- Ce qui est gelé, pour les écrans : mêmes colonnes qu'en 24a ; les références
-- gelées sont celles de la liste (et des lignes).
CREATE OR REPLACE VIEW v_inventaire_gel AS
SELECT i.id_inventaire, i.numero_inventaire, i.code_magasin, i.statut, i.type_inventaire,
       i.date_creation,
       CASE WHEN fn_inventaire_gel_par_reference(i.id_inventaire) THEN 'REFERENCES' ELSE 'MAGASIN' END
           AS etendue_gel,
       CASE WHEN fn_inventaire_gel_par_reference(i.id_inventaire)
            THEN COALESCE((SELECT jsonb_agg(r.code_reference ORDER BY r.code_reference)
                             FROM (SELECT s.code_reference FROM inventaire_reference s
                                    WHERE s.id_inventaire = i.id_inventaire
                                   UNION
                                   SELECT li.code_reference FROM ligne_inventaire li
                                    WHERE li.id_inventaire = i.id_inventaire) r), '[]'::jsonb)
            ELSE '[]'::jsonb END AS references_gelees
  FROM inventaire i
 WHERE i.statut IN ('BROUILLON', 'VALIDE');
ALTER VIEW v_inventaire_gel OWNER TO gestionfil;

-- C65 à la même étendue : mêmes colonnes qu'en 24a. Un tournant ou un ciblé clos
-- couvre ses références (liste, ou lignes pour ceux d'avant cette migration) ; sans
-- l'une ni l'autre, tout le magasin.
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
   AND (NOT (i.type_inventaire IN ('TOURNANT', 'CIBLE')
             AND (EXISTS (SELECT 1 FROM inventaire_reference s0 WHERE s0.id_inventaire = i.id_inventaire)
                  OR EXISTS (SELECT 1 FROM ligne_inventaire l0 WHERE l0.id_inventaire = i.id_inventaire)))
        OR EXISTS (SELECT 1 FROM ligne_mouvement lm
                    WHERE lm.id_mouvement = m.id_mouvement
                      AND fn_inventaire_compte_reference(i.id_inventaire, lm.code_reference)))
   AND m.id_inventaire IS DISTINCT FROM i.id_inventaire
   AND NOT (m.code_type_mvt IN ('AJUST_INV_POS', 'AJUST_INV_NEG')
            AND m.reference_document = i.numero_inventaire)
   AND NOT EXISTS (SELECT 1 FROM mouvement a
                    WHERE a.id_mouvement = m.id_mouvement_contrepasse
                      AND (a.id_inventaire = i.id_inventaire
                           OR (a.code_type_mvt IN ('AJUST_INV_POS', 'AJUST_INV_NEG')
                               AND a.reference_document = i.numero_inventaire)));
ALTER VIEW v_ctl_c65 OWNER TO gestionfil;

-- ---- 7. La proposition du tournant ------------------------------------------------
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description,
                       categorie, modifiable_par, verrouille) VALUES
 ('P_ComptageTournantA', 'Inventaire tournant : classe A comptée tous les', '30', 'ENTIER', 'jours',
  'Une référence de classe A en stock est proposée au tournant si elle n''a pas été comptée dans ce magasin depuis ce nombre de jours (ou jamais).',
  'STOCK', 'DIRECTION', 0),
 ('P_ComptageTournantB', 'Inventaire tournant : classe B comptée tous les', '90', 'ENTIER', 'jours',
  'Une référence de classe B en stock est proposée au tournant si elle n''a pas été comptée dans ce magasin depuis ce nombre de jours (ou jamais).',
  'STOCK', 'DIRECTION', 0),
 ('P_ComptageTournantC', 'Inventaire tournant : classe C comptée tous les', '180', 'ENTIER', 'jours',
  'Une référence de classe C — ou sans classe ABC — en stock est proposée au tournant si elle n''a pas été comptée dans ce magasin depuis ce nombre de jours (ou jamais).',
  'STOCK', 'DIRECTION', 0)
ON CONFLICT (code_parametre) DO UPDATE
   SET libelle = excluded.libelle, description = excluded.description, unite = excluded.unite,
       categorie = excluded.categorie;

-- La période d'une classe (sans classe : C) ; paramètre absent ou illisible : le
-- défaut décidé (30 / 90 / 180), jamais zéro.
CREATE OR REPLACE FUNCTION fn_comptage_tournant_jours(p_classe text) RETURNS integer AS $$
    SELECT COALESCE(
        (SELECT trim(p.valeur_courante)::integer FROM parametre p
          WHERE p.code_parametre = 'P_ComptageTournant' || COALESCE(p_classe, 'C')
            AND p.actif = 1 AND trim(p.valeur_courante) ~ '^[0-9]{1,6}$'),
        CASE COALESCE(p_classe, 'C') WHEN 'A' THEN 30 WHEN 'B' THEN 90 ELSE 180 END);
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_comptage_tournant_jours(text) OWNER TO gestionfil;

-- Par magasin, les références en stock, leur classe, leur dernier comptage, et si
-- elles sont dues. Lu par `GET /api/inventaires/candidats` et par le service.
CREATE OR REPLACE VIEW v_inventaire_candidat AS
WITH stock AS (
    SELECT code_magasin, code_reference, max(kg) AS stock_kg
      FROM (SELECT code_magasin, code_reference, quantite_kg AS kg
              FROM stock_magasin WHERE quantite_kg > 0
            UNION ALL
            SELECT code_magasin, code_reference, sum(quantite_kg)
              FROM stock_lot WHERE quantite_kg > 0
             GROUP BY code_magasin, code_reference) s
     GROUP BY code_magasin, code_reference
),
compte AS (
    -- Le dernier comptage : une ligne COMPTÉE d'un inventaire CLÔTURÉ du magasin.
    SELECT i.code_magasin, li.code_reference,
           max(COALESCE(li.date_comptage, i.date_cloture)) AS dernier
      FROM ligne_inventaire li
      JOIN inventaire i ON i.id_inventaire = li.id_inventaire
     WHERE i.statut = 'CLOTURE' AND li.quantite_comptee_kg IS NOT NULL
     GROUP BY i.code_magasin, li.code_reference
)
SELECT s.code_magasin, s.code_reference, r.designation,
       r.code_famille, f.libelle AS famille_libelle,
       r.code_categorie, cat.libelle AS categorie_libelle,
       r.classe_abc, COALESCE(r.classe_abc, 'C') AS classe_retenue, (r.classe_abc IS NULL) AS sans_classe,
       s.stock_kg, c.dernier AS dernier_comptage,
       fn_comptage_tournant_jours(r.classe_abc) AS periode_jours,
       fn_jour_casablanca(now()) - fn_jour_casablanca(c.dernier) AS jours_depuis,
       (c.dernier IS NULL
        OR fn_jour_casablanca(now()) - fn_jour_casablanca(c.dernier) >= fn_comptage_tournant_jours(r.classe_abc)) AS du
  FROM stock s
  JOIN reference r ON r.code_reference = s.code_reference
  LEFT JOIN famille f ON f.code_famille = r.code_famille
  LEFT JOIN categorie_matiere cat ON cat.code_categorie = r.code_categorie
  LEFT JOIN compte c ON c.code_magasin = s.code_magasin AND c.code_reference = s.code_reference;
ALTER VIEW v_inventaire_candidat OWNER TO gestionfil;

-- Les champs de l'en-tête, lus par la page de l'inventaire.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'INVENTAIRE', c.champ, c.libelle, 'LECTURE', 0, 997
  FROM (VALUES ('date_selection', 'Liste validée le'),
               ('selection_par', 'Liste validée par'),
               ('nb_references', 'Références choisies')) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- ---- 8. Témoin ----------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.inventaire_reference') IS NULL
       OR to_regclass('public.v_inventaire_candidat') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'inventaire' AND column_name = 'date_selection')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventaire_reference_garde')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_inventaire_selection')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventaire_selection_validation')
       OR position('inventaire_reference' IN pg_get_functiondef('fn_inventaire_gel_par_reference'::regproc)) = 0
       OR position('inventaire_reference' IN pg_get_viewdef('v_inventaire_gel'::regclass)) = 0
       OR (SELECT count(*) FROM parametre WHERE code_parametre LIKE 'P_ComptageTournant_') <> 3
       -- La reprise : tout tournant / ciblé ouvert qui a des lignes a sa liste, et ses
       -- lignes y sont toutes.
       OR EXISTS (SELECT 1 FROM ligne_inventaire li JOIN inventaire i ON i.id_inventaire = li.id_inventaire
                   WHERE i.type_inventaire IN ('TOURNANT', 'CIBLE') AND i.statut IN ('BROUILLON', 'VALIDE')
                     AND NOT EXISTS (SELECT 1 FROM inventaire_reference s
                                      WHERE s.id_inventaire = li.id_inventaire
                                        AND s.code_reference = li.code_reference)) THEN
        RAISE EXCEPTION '2026-10-24b : liste des références d''inventaire incomplète.';
    END IF;
END $$;

COMMIT;
