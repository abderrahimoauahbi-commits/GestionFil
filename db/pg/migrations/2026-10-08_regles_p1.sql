-- =============================================================================
-- 2026-10-08 — Regles de gestion validees le 08/10/2026, priorite P1
-- =============================================================================
-- 1. Reception : seul l'EXCEDENT de pesee au-dela de la tolerance du
--    fournisseur exige une derogation (regle 14). Une livraison partielle
--    n'etait plus enregistrable depuis la fiche de reception.
-- 2. Reception d'import : une etape A_CONTROLER, un statut qualite par ligne
--    (quarantaine), et celui qui saisit ne valide pas (B4 regle 2).
-- 3. Montants masques (regle 16) : le fil d'actualite sert le montant a part,
--    les montants du tableau de bord sont declares dans la grille COCKPIT.
-- 4. Inventaire (regle 10) : annulation motivee, un seul en cours par magasin
--    (index), la cloture n'est plus au magasinier.
--
-- Rejouable : CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- A jouer apres 2026-10-06_preferences_utilisateur.sql.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. RECEPTION : L'EXCEDENT SEUL EXIGE UNE DEROGATION
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tolerance_pesee(p_id_reception text) RETURNS numeric AS $$
    SELECT COALESCE(
        (SELECT f.tolerance_pesee_pct FROM reception rc
           JOIN fournisseur f ON f.code_fournisseur = rc.code_fournisseur
          WHERE rc.id_reception = p_id_reception),
        (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee'),
        2);
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_tolerance_pesee(text) OWNER TO gestionfil;

CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_ecart() RETURNS trigger AS $$
DECLARE
    v_tol numeric;
BEGIN
    IF NEW.quantite_commandee_kg IS NOT NULL AND NEW.derogation_ecart = 0 THEN
        v_tol := fn_tolerance_pesee(NEW.id_reception);
        IF NEW.quantite_stock_kg > NEW.quantite_commandee_kg * (1 + v_tol / 100.0) + 0.0005 THEN
            RAISE EXCEPTION 'C10 : % kg peses pour % kg attendus, au-dela de la tolerance de % %%. Une derogation motivee est requise.',
                round(NEW.quantite_stock_kg, 2), round(NEW.quantite_commandee_kg, 2), round(v_tol, 2);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ligne_reception_ecart ON ligne_reception;
CREATE TRIGGER trg_ligne_reception_ecart
BEFORE INSERT OR UPDATE OF quantite_stock_kg, quantite_commandee_kg, derogation_ecart
ON ligne_reception FOR EACH ROW
EXECUTE FUNCTION fn_trg_ligne_reception_ecart();

CREATE OR REPLACE VIEW v_ctl_c10 AS
SELECT lr.id_ligne_reception, rc.numero_reception, lr.code_reference,
       lr.quantite_commandee_kg, lr.quantite_stock_kg, ROUND(lr.ecart_pct, 2) AS ecart_pct,
       lr.derogation_ecart
FROM ligne_reception lr
JOIN reception rc ON rc.id_reception = lr.id_reception
WHERE lr.ecart_pct IS NOT NULL
  AND lr.derogation_ecart = 0
  AND lr.ecart_pct > fn_tolerance_pesee(lr.id_reception);

-- -----------------------------------------------------------------------------
-- 2. RECEPTION D'IMPORT : LE CONTROLE
-- -----------------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'import_receptions'::regclass AND contype = 'c'
                AND pg_get_constraintdef(oid) LIKE '%BROUILLON%'
    LOOP
        EXECUTE format('ALTER TABLE import_receptions DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;
ALTER TABLE import_receptions ADD CONSTRAINT import_receptions_statut_check
    CHECK (statut IN ('BROUILLON','A_CONTROLER','VALIDEE','ANNULEE'));

ALTER TABLE import_reception_lignes ADD COLUMN IF NOT EXISTS statut_qualite text NOT NULL DEFAULT 'CONFORME';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_reception_lignes_statut_qualite_check') THEN
        ALTER TABLE import_reception_lignes ADD CONSTRAINT import_reception_lignes_statut_qualite_check
            CHECK (statut_qualite IN ('CONFORME','NON_CONFORME','QUARANTAINE'));
    END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_trg_irl_quarantaine() RETURNS trigger AS $$
BEGIN
    IF NEW.statut_qualite IN ('NON_CONFORME','QUARANTAINE')
 AND COALESCE((SELECT est_quarantaine FROM magasin WHERE code_magasin = NEW.code_magasin), 0) = 0 THEN
        RAISE EXCEPTION 'Une ligne non conforme ou en quarantaine doit etre dirigee vers un magasin de quarantaine.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_irl_quarantaine ON import_reception_lignes;
CREATE TRIGGER trg_irl_quarantaine
BEFORE INSERT OR UPDATE OF statut_qualite, code_magasin ON import_reception_lignes
FOR EACH ROW EXECUTE FUNCTION fn_trg_irl_quarantaine();

CREATE OR REPLACE FUNCTION fn_trg_import_reception_segregation() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'VALIDEE' AND OLD.statut IS DISTINCT FROM 'VALIDEE'
 AND NEW.id_utilisateur_validation = NEW.id_utilisateur_creation THEN
        RAISE EXCEPTION 'B4 regle 2 : celui qui a saisi la reception ne peut pas la valider.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_import_reception_segregation ON import_receptions;
CREATE TRIGGER trg_import_reception_segregation
BEFORE UPDATE OF statut ON import_receptions
FOR EACH ROW EXECUTE FUNCTION fn_trg_import_reception_segregation();

-- -----------------------------------------------------------------------------
-- 3. LES MONTANTS MASQUES NE SORTENT PLUS
-- -----------------------------------------------------------------------------
-- 3a. Le fil d'actualite portait le montant d'un bon ou d'un plan d'achat DANS
--     le texte du detail (« TURKAN · 164086 MAD ») : aucun masquage ne l'en
--     retirait. Le montant devient une colonne, que le masquage retire.
CREATE OR REPLACE VIEW v_actualite AS
WITH evenements AS (
    -- ---- LE STOCK BOUGE -----------------------------------------------------
    SELECT m.date_creation                                        AS quand,
           'MOUVEMENT'                                            AS categorie,
           tm.libelle || ' — ' || m.numero_mouvement              AS titre,
           mg.nom || ' · ' || COALESCE(
               (SELECT ROUND(SUM(lm.quantite_kg))::text || ' kg sur '
                       || COUNT(*)::text || ' ligne(s)'
                  FROM ligne_mouvement lm WHERE lm.id_mouvement = m.id_mouvement),
               'aucune ligne')                                    AS detail,
           '/mouvements/' || m.id_mouvement                       AS chemin,
           m.id_utilisateur                                       AS qui,
           NULL::numeric                                          AS montant_total_mad
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      JOIN magasin mg        ON mg.code_magasin  = m.code_magasin

    -- ---- UNE RECEPTION ARRIVE, PUIS SE CONTROLE -----------------------------
    UNION ALL
    SELECT r.date_creation, 'RECEPTION',
           'Réception ' || r.numero_reception || ' enregistrée',
           COALESCE(f.nom, 'fournisseur inconnu'),
           '/receptions/' || r.id_reception, r.id_utilisateur_reception, NULL
      FROM reception r LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
    UNION ALL
    SELECT r.date_controle, 'RECEPTION',
           'Réception ' || r.numero_reception || ' contrôlée',
           COALESCE(f.nom, '') || ' · ' || r.statut,
           '/receptions/' || r.id_reception, r.id_utilisateur_controle, NULL
      FROM reception r LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
     WHERE r.date_controle IS NOT NULL

    -- ---- UN BON DE COMMANDE NAIT, SE VALIDE, PART ---------------------------
    UNION ALL
    SELECT b.date_creation, 'COMMANDE',
           'Bon ' || b.numero_bc || ' créé',
           COALESCE(f.nom, ''),
           '/bons-commande/' || b.id_bc, b.id_utilisateur_creation, NULL
      FROM bon_commande b LEFT JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur
    UNION ALL
    SELECT b.date_validation, 'COMMANDE',
           'Bon ' || b.numero_bc || ' validé',
           COALESCE(f.nom, ''),
           '/bons-commande/' || b.id_bc, b.id_utilisateur_validation, ROUND(b.montant_total_mad)
      FROM bon_commande b LEFT JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur
     WHERE b.date_validation IS NOT NULL
    UNION ALL
    SELECT b.date_envoi, 'COMMANDE',
           'Bon ' || b.numero_bc || ' envoyé au fournisseur',
           COALESCE(f.nom, ''),
           '/bons-commande/' || b.id_bc, b.id_utilisateur_validation, NULL
      FROM bon_commande b LEFT JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur
     WHERE b.date_envoi IS NOT NULL

    -- ---- LES TRANSFERTS ENTRE MAGASINS --------------------------------------
    UNION ALL
    SELECT t.date_sortie, 'TRANSFERT',
           'Transfert ' || t.numero_transfert || ' expédié', '',
           '/transferts', t.id_utilisateur, NULL
      FROM transfert t WHERE t.date_sortie IS NOT NULL
    UNION ALL
    SELECT t.date_reception_dest, 'TRANSFERT',
           'Transfert ' || t.numero_transfert || ' reçu', '',
           '/transferts', t.id_utilisateur_reception, NULL
      FROM transfert t WHERE t.date_reception_dest IS NOT NULL

    -- ---- LES INVENTAIRES ----------------------------------------------------
    UNION ALL
    SELECT i.date_creation, 'INVENTAIRE',
           'Inventaire ouvert', mg.nom,
           '/inventaires', i.id_utilisateur_responsable, NULL
      FROM inventaire i JOIN magasin mg ON mg.code_magasin = i.code_magasin
    UNION ALL
    SELECT i.date_cloture, 'INVENTAIRE',
           'Inventaire clôturé', mg.nom,
           '/inventaires', i.id_utilisateur_responsable, NULL
      FROM inventaire i JOIN magasin mg ON mg.code_magasin = i.code_magasin
     WHERE i.date_cloture IS NOT NULL

    -- ---- LE PLAN DE PRODUCTION ----------------------------------------------
    UNION ALL
    SELECT p.date_validation, 'PLAN',
           'Plan « ' || p.libelle || ' » validé',
           p.date_debut || ' au ' || p.date_fin,
           '/plans', p.id_utilisateur_validation, NULL
      FROM plan_production p WHERE p.date_validation IS NOT NULL
    UNION ALL
    SELECT p.date_cloture, 'PLAN',
           'Plan « ' || p.libelle || ' » clôturé', '',
           '/plans', p.id_utilisateur_cloture, NULL
      FROM plan_production p WHERE p.date_cloture IS NOT NULL

    -- ---- LE PLAN D'ACHAT SE REGENERE ----------------------------------------
    -- Une generation produit cent lignes d'un coup : on n'en fait qu'un
    -- evenement, sans quoi le fil ne parlerait que de cela.
    UNION ALL
    SELECT MAX(pa.date_generation), 'ACHAT',
           'Plan d''achat recalculé',
           COUNT(*)::text || ' proposition(s)',
           '/plan-achat', NULL, ROUND(SUM(pa.montant_total_mad))
      FROM plan_achat pa
     WHERE pa.date_generation IS NOT NULL
     GROUP BY substr(pa.date_generation, 1, 16)

    -- ---- LES FICHES MACHINE -------------------------------------------------
    UNION ALL
    SELECT mf.date_validation, 'MACHINE',
           'Fiche machine validée', COALESCE(mc.nom, mf.code_machine),
           '/machines', mf.id_utilisateur_validation, NULL
      FROM machine_fiche mf LEFT JOIN machine mc ON mc.code_machine = mf.code_machine
     WHERE mf.date_validation IS NOT NULL
)
SELECT e.quand,
       e.categorie,
       e.titre,
       NULLIF(e.detail, '')     AS detail,
       e.chemin,
       u.login                  AS par,
       -- LE MONTANT A PART (08/10/2026) : colle au texte du detail, il
       -- echappait au masquage. Seul, il se masque comme partout.
       e.montant_total_mad::float8 AS montant_total_mad
  FROM evenements e
  LEFT JOIN utilisateur u ON u.id_utilisateur = e.qui
 WHERE e.quand IS NOT NULL
 ORDER BY e.quand DESC;

ALTER VIEW v_actualite OWNER TO gestionfil;

-- 3b. Les montants du tableau de bord (/api/cockpit/analyse) n'etaient pas
--     declares dans la grille COCKPIT : non declares, ils etaient visibles de
--     tous. Chacun reprend le niveau de « Valeur du stock (MAD) » du cockpit,
--     role par role et compte par compte.
CREATE TEMP TABLE champs_neufs (module text, champ text, libelle text, niveau_defaut text,
                                sensible int, ordre int, modele text) ON COMMIT DROP;
INSERT INTO champs_neufs VALUES
 ('COCKPIT', 'budget_annuel_mad',         'Budget annuel (MAD)',                'LECTURE', 1, 4200, 'valeur_stock_mad'),
 ('COCKPIT', 'cout_mad',                  'Cout (MAD)',                         'LECTURE', 1, 4210, 'valeur_stock_mad'),
 ('COCKPIT', 'cout_matiere_annuel_mad',   'Cout matiere annuel (MAD)',          'LECTURE', 1, 4220, 'valeur_stock_mad'),
 ('COCKPIT', 'economie_annuelle_mad',     'Economie annuelle (MAD)',            'LECTURE', 1, 4230, 'valeur_stock_mad'),
 ('COCKPIT', 'montant_mad',               'Montant (MAD)',                      'LECTURE', 1, 4240, 'valeur_stock_mad'),
 ('COCKPIT', 'prix_actuel_mad',           'Prix actuel (MAD/kg)',               'LECTURE', 1, 4250, 'valeur_stock_mad'),
 ('COCKPIT', 'prix_min_mad',              'Prix le plus bas (MAD/kg)',          'LECTURE', 1, 4260, 'valeur_stock_mad'),
 ('COCKPIT', 'valeur_conso_annuelle_mad', 'Valeur consommee par an (MAD)',      'LECTURE', 1, 4270, 'valeur_stock_mad'),
 ('COCKPIT', 'montant_total_mad',         'Montant (MAD) du fil d''actualite',  'LECTURE', 1, 4280, 'valeur_stock_mad');

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
-- 4. INVENTAIRE : ANNULATION, UN SEUL EN COURS, CLOTURE PAR LA DIRECTION
-- -----------------------------------------------------------------------------
ALTER TABLE inventaire ADD COLUMN IF NOT EXISTS motif_annulation text;
ALTER TABLE inventaire ADD COLUMN IF NOT EXISTS id_utilisateur_annulation text REFERENCES utilisateur(id_utilisateur);
ALTER TABLE inventaire ADD COLUMN IF NOT EXISTS date_annulation text;

-- Celui qui compte ne cloture pas son propre comptage : la cloture ecrit au
-- stock, c'est un acte de validation.
DELETE FROM permission WHERE code_role_user = 'MAGASIN' AND module = 'INVENTAIRE' AND action = 'VALIDER';

-- L'index ne se pose que si la base n'a pas deja deux inventaires en cours sur
-- un meme magasin : la migration ne choisit pas lequel annuler. Elle le dit, et
-- se rejoue une fois le doublon annule (POST /api/inventaires/{id}/annuler).
DO $$
DECLARE doublons text;
BEGIN
    SELECT string_agg(code_magasin || ' : ' || nums, ' ; ') INTO doublons
      FROM (SELECT code_magasin, string_agg(numero_inventaire, ', ' ORDER BY numero_inventaire) AS nums
              FROM inventaire WHERE statut = 'EN_COURS'
             GROUP BY code_magasin HAVING count(*) > 1) d;
    IF doublons IS NULL THEN
        CREATE UNIQUE INDEX IF NOT EXISTS ux_inventaire_en_cours
            ON inventaire(code_magasin) WHERE statut = 'EN_COURS';
    ELSE
        RAISE NOTICE 'ux_inventaire_en_cours NON cree : plusieurs inventaires en cours (%) — annulez le doublon puis rejouez cette migration.', doublons;
    END IF;
END $$;

COMMIT;
