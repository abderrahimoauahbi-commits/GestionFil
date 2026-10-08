-- =============================================================================
-- 2026-10-08b — Corrections de l'audit v4 (08/10/2026 au soir)
-- =============================================================================
-- A jouer APRES 2026-10-08_regles_p1.sql (le serveur exige les deux).
-- Rejouable : IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT.
-- Les verrous ne s'attendent pas : si l'ancien serveur tient une table, la
-- migration echoue tout de suite au lieu de figer l'ERP (rejouer apres arret).
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. MONTANTS NON DECLARES (regle 16)
-- -----------------------------------------------------------------------------
-- Facture locale et sa cloture (masquees comme le total de la reception),
-- prix d'entree par lot (masque comme le CMUP du stock). Un champ non declare
-- est visible de tous : c'est ainsi qu'ils sortaient.
CREATE TEMP TABLE champs_neufs (module text, champ text, libelle text, niveau_defaut text,
                                sensible int, ordre int, modele text) ON COMMIT DROP;
INSERT INTO champs_neufs VALUES
 ('RECEPTIONS', 'montant_facture_mad',   'Montant de la facture (MAD)',      'LECTURE', 1, 4300, 'total_mad'),
 ('RECEPTIONS', 'frais_facture_mad',     'Frais de la facture (MAD)',        'LECTURE', 1, 4310, 'total_mad'),
 ('RECEPTIONS', 'taux_change_reception', 'Taux de change de la reception',   'LECTURE', 1, 4320, 'total_mad'),
 ('RECEPTIONS', 'valeur_provisoire_mad', 'Valeur provisoire (MAD)',          'LECTURE', 1, 4330, 'total_mad'),
 ('RECEPTIONS', 'valeur_definitive_mad', 'Valeur definitive (MAD)',          'LECTURE', 1, 4340, 'total_mad'),
 ('RECEPTIONS', 'difference_mad',        'Difference de facture (MAD)',      'LECTURE', 1, 4350, 'total_mad'),
 ('RECEPTIONS', 'au_stock_mad',          'Part portee au stock (MAD)',       'LECTURE', 1, 4360, 'total_mad'),
 ('RECEPTIONS', 'ecart_prix_mad',        'Ecart de prix (MAD)',              'LECTURE', 1, 4370, 'total_mad'),
 ('RECEPTIONS', 'cmup_avant',            'CMUP avant cloture',               'LECTURE', 1, 4380, 'total_mad'),
 ('RECEPTIONS', 'cmup_apres',            'CMUP apres cloture',               'LECTURE', 1, 4390, 'total_mad'),
 ('RECEPTIONS', 'montant_facture_devise','Montant de la facture (devise)',   'LECTURE', 1, 4392, 'total_mad'),
 ('RECEPTIONS', 'taux_facture',          'Taux de la facture',               'LECTURE', 1, 4394, 'total_mad'),
 ('RECEPTIONS', 'montant_devise',        'Montant facture saisi (devise)',   'LECTURE', 1, 4396, 'total_mad'),
 ('STOCK',      'prix_entree_mad',       'Prix d''entree du lot (MAD/kg)',   'LECTURE', 1, 4400, 'cmup_mad');

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT module, champ, libelle, niveau_defaut, sensible, ordre FROM champs_neufs
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, n.module, n.champ,
       CASE WHEN m.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM champs_neufs n
  JOIN modele_droit_champ m ON m.module = n.module AND m.champ = n.modele
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, n.module, n.champ,
       CASE WHEN d.niveau = 'MASQUE' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM champs_neufs n
  JOIN droit_champ d ON d.module = n.module AND d.champ = n.modele
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. LE NIVEAU D'ECART MACHINE EST ARCHIVE (regle 1)
-- -----------------------------------------------------------------------------
-- Vert, orange ou rouge, tel que juge a la validation : si les seuils changent,
-- on sait encore ce qui avait demande la Direction.
ALTER TABLE machine_decision_ligne ADD COLUMN IF NOT EXISTS niveau_ecart text;

-- -----------------------------------------------------------------------------
-- 3. LES RECEPTIONS D'IMPORT A CONTROLER COMPTENT AU TABLEAU DE BORD
-- -----------------------------------------------------------------------------
-- La file ne lisait que les receptions locales : la Direction, seule a valider,
-- ne voyait pas les receptions d'import en attente. La definition courante est
-- reprise et completee une seule fois.
DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_cockpit_files'::regclass);
    IF position('import_receptions' IN def) = 0 THEN
        def := replace(def, ') AS nb_receptions_a_controler',
                       ') + (SELECT count(*) FROM import_receptions WHERE statut = ''A_CONTROLER'') AS nb_receptions_a_controler');
        EXECUTE 'CREATE OR REPLACE VIEW v_cockpit_files AS ' || rtrim(rtrim(def), ';');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. LE FIL SUR MACHINE : COMPTE DANS LES BESOINS, PAS DANS LE MAGASIN (regle 9)
-- -----------------------------------------------------------------------------
-- La regle 9 l'ajoutait au stock physique net : C27 (« magasin sous le
-- minimum »), le statut physique et le stock SUBSTITUABLE le comptaient aussi,
-- alors qu'un fil charge n'est ni au magasin ni disponible pour une autre
-- reference. Le stock physique net redevient celui du magasin ; une colonne
-- `stock_mrp_net_kg` porte ce que le calcul des besoins compte (magasin + fil
-- sur machine selon P_MrpInclureStockMachine), et la projection la lit.
-- Seul le fil d'un etage constate depuis moins de P_JoursInventMachine jours
-- compte (decision du 08/10, audit v4) : une photo plus ancienne a ete
-- consommee depuis.
CREATE OR REPLACE VIEW v_stock_physique AS
 WITH hors_mrp AS (
         SELECT sl.code_reference,
            sum(CASE WHEN l.categorie = 'RESTES' AND rr.suivi_lot = 1 AND l.statut <> 'BLOQUE'
                     THEN sl.quantite_kg ELSE 0 END) AS restes_kg,
            sum(CASE WHEN l.statut = 'BLOQUE' THEN sl.quantite_kg ELSE 0 END) AS bloque_kg
           FROM stock_lot sl
             JOIN lot l ON l.code_reference = sl.code_reference AND l.lot_fournisseur = sl.lot_fournisseur
             JOIN reference rr ON rr.code_reference = sl.code_reference
             JOIN magasin mg_1 ON mg_1.code_magasin = sl.code_magasin
          WHERE mg_1.inclure_mrp = 1 AND mg_1.est_quarantaine = 0
          GROUP BY sl.code_reference
        ), machine AS (
         -- Le fil sur machine, hors lots bloques (il ne partira pas en production),
         -- et seulement sur un etage constate recemment.
         SELECT e.code_reference, round(sum(e.kg), 4) AS kg_sur_machine
           FROM machine_etat e
           LEFT JOIN lot l ON l.code_reference = e.code_reference AND l.lot_fournisseur = e.lot_fournisseur
          WHERE COALESCE((SELECT valeur_courante FROM parametre
                           WHERE code_parametre = 'P_MrpInclureStockMachine'), '1') = '1'
            AND COALESCE(l.statut, 'LIBRE') <> 'BLOQUE'
            AND substr(COALESCE(e.date_constat, '1900-01-01'), 1, 10)::date
                >= current_date - COALESCE((SELECT CAST(valeur_courante AS integer) FROM parametre
                                             WHERE code_parametre = 'P_JoursInventMachine'), 30)
          GROUP BY e.code_reference
        )
 SELECT r.code_reference,
    round(COALESCE(sum(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg END), 0), 4) AS stock_utilisable_kg,
    round(COALESCE(sum(CASE WHEN mg.est_quarantaine = 1 THEN sm.quantite_kg END), 0), 4) AS stock_quarantaine_kg,
    round(COALESCE(max(h.restes_kg), 0) + COALESCE(max(h.bloque_kg), 0), 4) AS stock_reserve_kg,
    round(COALESCE(sum(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg END), 0)
          - COALESCE(max(h.restes_kg), 0) - COALESCE(max(h.bloque_kg), 0), 4) AS stock_physique_net_kg,
    round(COALESCE(max(h.restes_kg), 0), 4) AS stock_restes_kg,
    round(COALESCE(max(h.bloque_kg), 0), 4) AS stock_bloque_kg,
    round(COALESCE(max(mc.kg_sur_machine), 0), 4) AS stock_machine_kg,
    round(COALESCE(sum(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg END), 0)
          - COALESCE(max(h.restes_kg), 0) - COALESCE(max(h.bloque_kg), 0)
          + COALESCE(max(mc.kg_sur_machine), 0), 4) AS stock_mrp_net_kg
   FROM reference r
     LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
     LEFT JOIN magasin mg ON mg.code_magasin = sm.code_magasin
     LEFT JOIN hors_mrp h ON h.code_reference = r.code_reference
     LEFT JOIN machine mc ON mc.code_reference = r.code_reference
  WHERE r.actif = 1
  GROUP BY r.code_reference;

-- La PROJECTION (stock projete, couverture, statut logique) lit le stock compte
-- par le MRP ; le statut PHYSIQUE reste celui du magasin. La definition
-- courante est reprise : seules les sommes « physique + en-cours » changent.
DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_stock_projete'::regclass);
    IF position('stock_mrp_net_kg' IN def) = 0 THEN
        def := replace(def, '(ph.stock_physique_net_kg + COALESCE(ef.encours_fiable_kg',
                            '(ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg');
        def := rtrim(rtrim(def), ';');
        -- Le fil sur machine se lit a part, en derniere colonne (le FROM
        -- principal est le seul indente de trois blancs).
        def := replace(def, E'\n   FROM (', E',\n    ph.stock_machine_kg\n   FROM (');
        EXECUTE 'CREATE OR REPLACE VIEW v_stock_projete AS ' || def;
    END IF;
END $$;

-- =============================================================================
-- 5. RECEPTION D'IMPORT : LA TOLERANCE DU FOURNISSEUR, ET LA DEROGATION
-- =============================================================================
-- La tolerance etait figee a 2 % dans le code, et l'excedent refuse sec : un
-- camion de 2,5 % au-dessus ne pouvait entrer qu'en mentant sur la pesee.

-- LA TOLERANCE D'UN FOURNISSEUR (audit v4) : la meme source pour la reception
-- d'import, qui la figeait a 2 % dans le code.
CREATE OR REPLACE FUNCTION fn_tolerance_fournisseur(p_code_fournisseur text) RETURNS numeric AS $$
    SELECT COALESCE(
        (SELECT f.tolerance_pesee_pct FROM fournisseur f WHERE f.code_fournisseur = p_code_fournisseur),
        (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee'),
        2);
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_tolerance_fournisseur(text) OWNER TO gestionfil;

ALTER TABLE import_reception_lignes ADD COLUMN IF NOT EXISTS derogation_ecart smallint NOT NULL DEFAULT 0;
ALTER TABLE import_reception_lignes ADD COLUMN IF NOT EXISTS motif_derogation text;
ALTER TABLE import_reception_lignes ADD COLUMN IF NOT EXISTS id_utilisateur_derogation text
    REFERENCES utilisateur(id_utilisateur);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_irl_derogation') THEN
        ALTER TABLE import_reception_lignes ADD CONSTRAINT ck_irl_derogation CHECK (derogation_ecart IN (0,1)
            AND (derogation_ecart = 0 OR length(btrim(COALESCE(motif_derogation, ''))) >= 5));
    END IF;
END $$;

-- C10 lit aussi l'import (memes colonnes : la vue se remplace en place).
CREATE OR REPLACE VIEW v_ctl_c10 AS
SELECT lr.id_ligne_reception, rc.numero_reception, lr.code_reference,
       lr.quantite_commandee_kg, lr.quantite_stock_kg, ROUND(lr.ecart_pct, 2) AS ecart_pct,
       lr.derogation_ecart::bigint AS derogation_ecart
FROM ligne_reception lr
JOIN reception rc ON rc.id_reception = lr.id_reception
WHERE lr.ecart_pct IS NOT NULL
  AND lr.derogation_ecart = 0
  AND lr.ecart_pct > fn_tolerance_pesee(lr.id_reception)
UNION ALL
-- L'import aussi (audit v4) : un excedent au-dela de la tolerance du
-- fournisseur, sans derogation motivee.
SELECT rl.id_reception_ligne, r.numero, fl.code_reference,
       rl.quantite_attendue_kg, rl.quantite_recue_kg,
       ROUND((rl.quantite_recue_kg - rl.quantite_attendue_kg) * 100.0 / rl.quantite_attendue_kg, 2),
       rl.derogation_ecart::bigint
FROM import_reception_lignes rl
JOIN import_receptions r ON r.id_reception = rl.id_reception
JOIN import_facture_lignes fl ON fl.id_ligne = rl.id_ligne
JOIN import_factures f ON f.id_facture = fl.id_facture
WHERE rl.quantite_attendue_kg > 0
  AND rl.derogation_ecart = 0
  AND r.statut <> 'ANNULEE'
  AND (rl.quantite_recue_kg - rl.quantite_attendue_kg) * 100.0 / rl.quantite_attendue_kg
      > fn_tolerance_fournisseur(f.code_fournisseur);

-- =============================================================================
-- 6. CLOTURE PAR LA FACTURE : DEVISE, PLUSIEURS RECEPTIONS, AVOIR
-- =============================================================================
-- La facture locale se saisit dans la devise du bon, au cours Bank Al-Maghrib ;
-- le journal distingue la cloture de ses corrections (avoir, complement),
-- motivees. Un avis se leve au-dela de P_ClotureEcartAvisPct, sans bloquer.
ALTER TABLE reception ADD COLUMN IF NOT EXISTS code_devise_facture text REFERENCES devise(code_devise);
ALTER TABLE reception ADD COLUMN IF NOT EXISTS montant_facture_devise numeric(18,2);
ALTER TABLE reception ADD COLUMN IF NOT EXISTS taux_facture numeric(9,4)
    CHECK (taux_facture IS NULL OR taux_facture > 0);

ALTER TABLE reception_ajustements_cmup ADD COLUMN IF NOT EXISTS origine text NOT NULL DEFAULT 'CLOTURE';
ALTER TABLE reception_ajustements_cmup ADD COLUMN IF NOT EXISTS numero_piece text;
ALTER TABLE reception_ajustements_cmup ADD COLUMN IF NOT EXISTS motif text;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_rec_ajust_origine') THEN
        ALTER TABLE reception_ajustements_cmup ADD CONSTRAINT ck_rec_ajust_origine
            CHECK (origine IN ('CLOTURE','AVOIR','COMPLEMENT')
                   AND (origine = 'CLOTURE' OR length(btrim(COALESCE(motif, ''))) >= 5));
    END IF;
END $$;

INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_ClotureEcartAvisPct', 'Cloture facture : avis au-dela de l''ecart', '10', 'DECIMAL', '%',
   'Au-dela, l''apercu de cloture signale que la facture s''ecarte de la valeur au prix du bon (sans bloquer).',
   'RECEPT', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

-- =============================================================================
-- 7. EXPLOITATION : PROPRIETAIRES, CONTROLE C44
-- =============================================================================
-- Les fonctions du 08/10 avaient ete creees par postgres : la migration
-- suivante, jouee par gestionfil, n'aurait pas pu les remplacer.
ALTER FUNCTION fn_controle_colisage(text, numeric, numeric, numeric) OWNER TO gestionfil;
ALTER FUNCTION fn_trg_irl_quarantaine() OWNER TO gestionfil;
ALTER FUNCTION fn_trg_import_reception_segregation() OWNER TO gestionfil;
ALTER FUNCTION fn_trg_plan_achat_date_ecartee() OWNER TO gestionfil;
ALTER FUNCTION fn_trg_lmvt_lot_controle() OWNER TO gestionfil;
ALTER VIEW v_stock_physique OWNER TO gestionfil;
ALTER VIEW v_ctl_c10 OWNER TO gestionfil;

-- C44 : plus d'un inventaire en cours sur un meme magasin (audit v4). L'index
-- ux_inventaire_en_cours l'interdit ; une base ou la migration du 08/10 n'a pas
-- pu le poser (doublon deja present) le montre ici au lieu de le taire.
DROP VIEW IF EXISTS v_ctl_c44 CASCADE;
CREATE OR REPLACE VIEW v_ctl_c44 AS
SELECT code_magasin, count(*) AS nb_en_cours,
       string_agg(numero_inventaire, ', ' ORDER BY numero_inventaire) AS inventaires
  FROM inventaire
 WHERE statut = 'EN_COURS'
 GROUP BY code_magasin
HAVING count(*) > 1;
ALTER VIEW v_ctl_c44 OWNER TO gestionfil;

DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C44' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C44''::text, ''Plus d''''un inventaire en cours sur un magasin''::text,'
                ' ''CRITIQUE''::text, (SELECT count(*) FROM v_ctl_c44)';
    END IF;
END $$;

COMMIT;
