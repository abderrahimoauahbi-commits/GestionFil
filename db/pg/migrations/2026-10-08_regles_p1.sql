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
-- 5. Colisage : kilos, bobines et palettes doivent s'accorder avec la fiche
--    article — signale (ecran, controle C43), jamais bloquant.
-- 6. Derive fournisseur (regle 13) : sur la reception initiale seulement.
-- 7. MRP (regle 9) : le fil sur machine compte dans les besoins, par reglage.
-- 8. Proposition ecartee (regle 17) : elle expire apres 90 jours.
-- 9. Taux de reference (regle 18) : au-dela de 7 jours, pas de validation de
--    bon en devise.
-- 10. Lot bloque (regle 11) : interdit la production, permet retour machine,
--     quarantaine, retour fournisseur.
-- 11. Seuils d'ecart machine (regle 1) : vert, orange, rouge.
-- 12. Module LOTS (regle 5) : derogations et blocages decides par VALIDER des
--     lots ou la Direction.
-- 13. Reception locale en deux temps (regle 6) : cloture avec la facture,
--     prorata au stock present, ecart de prix trace.
-- 14. Grille des champs : les montants d'entree suivent la valeur du stock.
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

-- -----------------------------------------------------------------------------
-- 5. LA COHERENCE DU COLISAGE SUR TOUS LES DOCUMENTS D'ACHAT
-- -----------------------------------------------------------------------------
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_ColisageTolAlertePct', 'Colisage : alerte sur le poids d''une bobine', '10', 'DECIMAL', '%',
   'Au-dela, l''ecran signale que kilos et bobines ne s''accordent pas avec la fiche article.', 'RECEPT', 'DIRECTION'),
  ('P_ColisageTolRefusPct', 'Colisage : refus sur le poids d''une bobine', '25', 'DECIMAL', '%',
   'Au-dela, la ligne est refusee (bon, facture, reception) : kilos, bobines et palettes se contredisent.', 'RECEPT', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- LA COHERENCE DU COLISAGE (08/10/2026)
-- -----------------------------------------------------------------------------
-- Kilos, bobines et palettes disent la meme marchandise. Une facture saisie a
-- 4 032 kg, 1 920 bobines et 20 palettes pour un fil de 2,1 kg la bobine et
-- 336 bobines par palette ne decrit rien de reel : il faut 6 palettes, pas 20
-- (des colis ou des cartons avaient ete saisis comme palettes). Le controle
-- raisonne a partir de la fiche article :
--   * le poids moyen d'une bobine (kilos / bobines) ne s'ecarte pas de la fiche
--     de plus de P_ColisageTolRefusPct (25 %) ;
--   * les palettes ne depassent pas le minimum necessaire plus une palette
--     entamee, et aucune palette ne porte plus que sa capacite (+ la meme
--     tolerance).
-- Sans bobines, le nombre de bobines se deduit des kilos. Une fiche sans poids
-- de bobine ou sans colisage ne permet pas de juger : on ne juge pas.
-- Rend NULL si la ligne est coherente, sinon le message qui explique.
CREATE OR REPLACE FUNCTION fn_controle_colisage(p_ref text, p_kg numeric, p_bob numeric, p_pal numeric)
RETURNS text AS $$
DECLARE
    v_pb    numeric;
    v_bpp   numeric;
    v_tol   numeric;
    v_beff  numeric;
    v_ecart numeric;
    v_pmin  numeric;
BEGIN
    IF p_ref IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT NULLIF(poids_bobine_kg, 0), NULLIF(bobines_par_palette, 0) INTO v_pb, v_bpp
      FROM reference WHERE code_reference = p_ref;
    v_tol := COALESCE((SELECT CAST(valeur_courante AS numeric) FROM parametre
                        WHERE code_parametre = 'P_ColisageTolRefusPct'), 25);

    IF COALESCE(p_bob, 0) > 0 AND v_pb IS NOT NULL AND COALESCE(p_kg, 0) > 0 THEN
        v_ecart := (p_kg / p_bob - v_pb) / v_pb * 100;
        IF abs(v_ecart) > v_tol THEN
            RETURN format('%s : %s kg pour %s bobines, soit %s kg par bobine, alors que la fiche en annonce %s (ecart %s %%, refus au-dela de %s %%). Verifiez les kilos et les bobines ; si le fournisseur a change de bobine, corrigez d''abord la fiche article.',
                          p_ref, round(p_kg, 2), round(p_bob), round(p_kg / p_bob, 3), round(v_pb, 3),
                          round(v_ecart, 1), round(v_tol));
        END IF;
    END IF;

    v_beff := COALESCE(NULLIF(p_bob, 0), CASE WHEN v_pb IS NOT NULL THEN p_kg / v_pb END);
    IF COALESCE(p_pal, 0) > 0 AND v_bpp IS NOT NULL AND COALESCE(v_beff, 0) > 0 THEN
        v_pmin := ceil(v_beff / v_bpp - 0.000001);
        IF p_pal > v_pmin + 1 THEN
            RETURN format('%s : %s palettes pour %s bobines. A %s bobines par palette, il en faut %s (%s au plus avec une palette entamee). Des colis ou des cartons ont-ils ete saisis comme palettes ?',
                          p_ref, round(p_pal), round(v_beff), round(v_bpp), v_pmin, v_pmin + 1);
        END IF;
        IF v_beff / p_pal > v_bpp * (1 + v_tol / 100.0) THEN
            RETURN format('%s : %s bobines sur %s palette(s), soit %s par palette, alors qu''une palette en porte %s. Il faut au moins %s palettes.',
                          p_ref, round(v_beff), round(p_pal), round(v_beff / p_pal), round(v_bpp), v_pmin);
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ON SIGNALE, ON NE BLOQUE PAS (decision du 08/10/2026) : pas de declencheur.
-- Ceux d'un premier passage de cette migration sont retires.
DROP TRIGGER IF EXISTS trg_ligne_bc_colisage ON ligne_bc;
DROP TRIGGER IF EXISTS trg_ligne_reception_colisage ON ligne_reception;
DROP TRIGGER IF EXISTS trg_ifl_colisage ON import_facture_lignes;
DROP TRIGGER IF EXISTS trg_irl_colisage ON import_reception_lignes;
DROP FUNCTION IF EXISTS fn_trg_controle_colisage();

CREATE OR REPLACE VIEW v_ctl_c43 AS
-- C43 : colisage incoherent sur un document d'achat encore ouvert — kilos,
-- bobines et palettes ne s'accordent pas avec la fiche article (08/10/2026).
SELECT *
  FROM (SELECT 'BON DE COMMANDE' AS document, bc.numero_bc AS numero, lb.code_reference,
               lb.quantite_commandee_kg AS kg, lb.nb_bobines_saisi AS bobines, lb.nb_palettes_saisi AS palettes,
               fn_controle_colisage(lb.code_reference, lb.quantite_commandee_kg,
                                    lb.nb_bobines_saisi, lb.nb_palettes_saisi) AS message
          FROM ligne_bc lb JOIN bon_commande bc ON bc.id_bc = lb.id_bc
         WHERE lb.type_ligne = 'MARCHANDISE' AND bc.statut NOT IN ('CLOTURE', 'ANNULE')
        UNION ALL
        SELECT 'FACTURE IMPORT', f.numero_facture, fl.code_reference, fl.poids_net_kg, fl.nb_bobines, fl.nb_palettes,
               fn_controle_colisage(fl.code_reference, fl.poids_net_kg, fl.nb_bobines, fl.nb_palettes)
          FROM import_facture_lignes fl
          JOIN import_factures f ON f.id_facture = fl.id_facture
          JOIN import_dossiers d ON d.id_dossier = f.id_dossier
         WHERE d.statut <> 'CLOTURE'
        UNION ALL
        SELECT 'RECEPTION IMPORT', r.numero, fl.code_reference, rl.quantite_recue_kg, rl.nb_bobines, rl.nb_palettes,
               fn_controle_colisage(fl.code_reference, rl.quantite_recue_kg, rl.nb_bobines, rl.nb_palettes)
          FROM import_reception_lignes rl
          JOIN import_receptions r ON r.id_reception = rl.id_reception
          JOIN import_facture_lignes fl ON fl.id_ligne = rl.id_ligne
         WHERE r.statut IN ('BROUILLON', 'A_CONTROLER')
        UNION ALL
        SELECT 'RECEPTION', rc.numero_reception, lr.code_reference, lr.quantite_stock_kg,
               lr.nb_bobines_saisi, lr.nb_palettes_saisi,
               fn_controle_colisage(lr.code_reference, lr.quantite_stock_kg, lr.nb_bobines_saisi, lr.nb_palettes_saisi)
          FROM ligne_reception lr JOIN reception rc ON rc.id_reception = lr.id_reception
         WHERE rc.statut IN ('BROUILLON', 'A_CONTROLER')) x
 WHERE x.message IS NOT NULL;
ALTER VIEW v_ctl_c43 OWNER TO gestionfil;

-- La ligne C43 s'ajoute au tableau des controles tel qu'il est sur cette base
-- (C38-C42 viennent d'une migration machine) : la definition courante est
-- reprise et completee, une seule fois.
DO $$
DECLARE def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C43' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C43''::text, ''Colisage incoherent sur un document d''''achat ouvert''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c43)';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. LA DERIVE FOURNISSEUR SE LIT A LA RECEPTION (regle 13)
-- -----------------------------------------------------------------------------
-- Le poids d'une bobine juge le fournisseur au moment ou elle arrive. Les
-- chargements et retours machine (equilibres par le poids de reference de la
-- ligne), les transferts et les ajustements n'en disent rien : ils
-- representaient 174 lignes sur 184 de la divergence « fournisseur ».
CREATE OR REPLACE VIEW v_stat_divergence_bobine AS
SELECT lm.code_reference,
       r.designation,
       lm.lot_fournisseur,
       COALESCE(lo.code_fournisseur, r.code_fournisseur)        AS code_fournisseur,
       f.nom                                                    AS fournisseur_nom,
       m.code_type_mvt,
       tm.libelle                                               AS type_libelle,
       substr(m.date_mouvement, 1, 7)                           AS mois,
       lm.nb_bobines,
       lm.quantite_kg,
       lm.poids_unitaire_theorique_kg                           AS poids_catalogue_kg,
       lm.poids_reel_moyen_bobine_kg                            AS poids_reel_kg,
       lm.ecart_theorique_pct                                   AS ecart_pct
  FROM ligne_mouvement lm
  JOIN mouvement m       ON m.id_mouvement = lm.id_mouvement
  JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
  JOIN reference r       ON r.code_reference = lm.code_reference
  LEFT JOIN lot lo       ON lo.code_reference = lm.code_reference AND lo.lot_fournisseur = lm.lot_fournisseur
  LEFT JOIN fournisseur f ON f.code_fournisseur = COALESCE(lo.code_fournisseur, r.code_fournisseur)
 WHERE lm.ecart_theorique_pct IS NOT NULL
   AND m.code_type_mvt = 'ENTREE_REC'
   -- Une entree contre-passee ne compte plus : la livraison n'a pas eu lieu.
   AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement);

-- La derive cumulee par fournisseur : chaque lot jugee sur ce qu'il pesait a
-- son arrivee, aux seuils orange et rouge des lots.
CREATE OR REPLACE VIEW v_stat_derive_fournisseur AS
WITH p AS (
    SELECT max(CASE WHEN code_parametre = 'P_LotTolOrangePct' THEN valeur_courante::numeric END) AS orange,
           max(CASE WHEN code_parametre = 'P_LotTolRougePct'  THEN valeur_courante::numeric END) AS rouge
      FROM parametre
), par_lot AS (
    SELECT d.code_fournisseur, d.fournisseur_nom, d.code_reference, d.lot_fournisseur,
           sum(d.quantite_kg - d.nb_bobines * d.poids_catalogue_kg)                           AS ecart_kg,
           sum(d.quantite_kg - d.nb_bobines * d.poids_catalogue_kg)
             / NULLIF(sum(d.nb_bobines * d.poids_catalogue_kg), 0) * 100                      AS ecart_pct
      FROM v_stat_divergence_bobine d
     GROUP BY d.code_fournisseur, d.fournisseur_nom, d.code_reference, d.lot_fournisseur
)
SELECT l.code_fournisseur,
       l.fournisseur_nom,
       count(*)                                                                           AS nb_lots,
       count(*) FILTER (WHERE abs(l.ecart_pct) > COALESCE(p.orange, 1)
                          AND abs(l.ecart_pct) <= COALESCE(p.rouge, 3))                   AS lots_orange,
       count(*) FILTER (WHERE abs(l.ecart_pct) > COALESCE(p.rouge, 3))                    AS lots_rouges,
       round(sum(l.ecart_kg), 2)                                                          AS ecart_cumule_kg,
       round(avg(l.ecart_pct), 2)                                                         AS ecart_moyen_pct
  FROM par_lot l CROSS JOIN p
 WHERE l.ecart_pct IS NOT NULL
 GROUP BY l.code_fournisseur, l.fournisseur_nom;

-- -----------------------------------------------------------------------------
-- 7. LE STOCK MACHINE DANS LES BESOINS D'ACHAT (regle 9)
-- -----------------------------------------------------------------------------
-- Le fil charge sur machine sortait du stock disponible : le plan d'achat le
-- rachetait alors qu'il servira la production. Un reglage decide ; par defaut
-- il est compte. Il entre dans le stock physique net, et se lit a part
-- (stock_machine_kg).
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_MrpInclureStockMachine', 'Compter le fil sur machine dans les besoins d''achat', '1', 'ENTIER', NULL,
   '1 : le fil charge sur machine compte comme stock disponible pour le calcul des besoins ; 0 : il est ignore.', 'STOCK', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

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
         SELECT vm.code_reference, vm.kg_sur_machine
           FROM v_stock_machine vm
          WHERE COALESCE((SELECT valeur_courante FROM parametre
                           WHERE code_parametre = 'P_MrpInclureStockMachine'), '1') = '1'
        )
 SELECT r.code_reference,
    round(COALESCE(sum(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg END), 0), 4) AS stock_utilisable_kg,
    round(COALESCE(sum(CASE WHEN mg.est_quarantaine = 1 THEN sm.quantite_kg END), 0), 4) AS stock_quarantaine_kg,
    round(COALESCE(max(h.restes_kg), 0) + COALESCE(max(h.bloque_kg), 0), 4) AS stock_reserve_kg,
    round(COALESCE(sum(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0 THEN sm.quantite_kg END), 0)
          - COALESCE(max(h.restes_kg), 0) - COALESCE(max(h.bloque_kg), 0)
          + COALESCE(max(mc.kg_sur_machine), 0), 4) AS stock_physique_net_kg,
    round(COALESCE(max(h.restes_kg), 0), 4) AS stock_restes_kg,
    round(COALESCE(max(h.bloque_kg), 0), 4) AS stock_bloque_kg,
    round(COALESCE(max(mc.kg_sur_machine), 0), 4) AS stock_machine_kg
   FROM reference r
     LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
     LEFT JOIN magasin mg ON mg.code_magasin = sm.code_magasin
     LEFT JOIN hors_mrp h ON h.code_reference = r.code_reference
     LEFT JOIN machine mc ON mc.code_reference = r.code_reference
  WHERE r.actif = 1
  GROUP BY r.code_reference;

-- -----------------------------------------------------------------------------
-- 8. UNE PROPOSITION ECARTEE EXPIRE (regle 17)
-- -----------------------------------------------------------------------------
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_DureeEcartJours', 'Duree d''une proposition d''achat ecartee', '90', 'ENTIER', 'jours',
   'Au-dela, la proposition ecartee cesse de masquer la reference : le besoin est repropose au calcul suivant. Elle reste en base, marquee expiree.', 'STOCK', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

ALTER TABLE plan_achat ADD COLUMN IF NOT EXISTS date_ecartee text;
-- Les propositions deja ecartees : a defaut de mieux, la date de leur calcul.
UPDATE plan_achat SET date_ecartee = date_generation WHERE statut = 'IGNORE' AND date_ecartee IS NULL;

CREATE OR REPLACE FUNCTION fn_trg_plan_achat_date_ecartee() RETURNS trigger AS $$
BEGIN
    IF NEW.statut = 'IGNORE' AND OLD.statut IS DISTINCT FROM 'IGNORE' THEN
        NEW.date_ecartee := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_plan_achat_date_ecartee ON plan_achat;
CREATE TRIGGER trg_plan_achat_date_ecartee
BEFORE UPDATE OF statut ON plan_achat FOR EACH ROW EXECUTE FUNCTION fn_trg_plan_achat_date_ecartee();

-- -----------------------------------------------------------------------------
-- 9. ANCIENNETE DU TAUX DE REFERENCE (regle 18)
-- -----------------------------------------------------------------------------
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_AncienneteTauxJours', 'Anciennete maximale du taux de reference', '7', 'ENTIER', 'jours',
   'Au-dela, un bon de commande en devise ne se valide pas tant que le taux du jour n''est pas saisi. Le taux de chaque facture d''import reste celui de sa facture.', 'ACHAT', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 10. LE BLOCAGE QUALITE ASSOUPLI (regle 11)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_lmvt_lot_controle() RETURNS trigger AS $$
DECLARE
    v_statut text;
    v_type   text;
    v_doc    text;
    v_dest_q bigint;
BEGIN
    IF NEW.poids_unitaire_theorique_kg IS NULL AND COALESCE(NEW.nb_bobines, 0) > 0 THEN
        SELECT NULLIF(poids_bobine_kg, 0) INTO NEW.poids_unitaire_theorique_kg
          FROM reference WHERE code_reference = NEW.code_reference;
    END IF;
    IF NEW.lot_fournisseur IS NOT NULL THEN
        SELECT statut INTO v_statut FROM lot
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
        IF v_statut = 'BLOQUE' THEN
            -- LE BLOCAGE QUALITE ASSOUPLI (regle 11, 08/10/2026). Un lot bloque
            -- refusait tout mouvement : on ne pouvait ni le retirer d'une
            -- machine, ni le mettre en quarantaine, ni le rendre au
            -- fournisseur. Le blocage interdit desormais ce qui l'EMPLOIE —
            -- production, chargement machine, fusion — et laisse ce qui
            -- l'ISOLE : retour machine, annulation d'un chargement, transfert
            -- vers un magasin de quarantaine, retour fournisseur, ajustement
            -- d'inventaire, reception.
            SELECT m.code_type_mvt, m.reference_document INTO v_type, v_doc
              FROM mouvement m WHERE m.id_mouvement = NEW.id_mouvement;
            IF v_type IN ('RETOUR_MACHINE', 'ANNUL_CHARGE_MACHINE', 'RETOUR_FOURN',
                          'AJUST_INV_POS', 'AJUST_INV_NEG', 'ENTREE_REC') THEN
                RETURN NEW;
            END IF;
            IF v_type IN ('TRANSFERT_SORTIE', 'TRANSFERT_ENTREE') THEN
                SELECT mg.est_quarantaine INTO v_dest_q
                  FROM transfert t JOIN magasin mg ON mg.code_magasin = t.code_magasin_dest
                 WHERE t.numero_transfert = v_doc;
                IF v_dest_q = 1 THEN
                    RETURN NEW;
                END IF;
            END IF;
            RAISE EXCEPTION 'LOT-BLOQUE : le lot % de % est bloque par la qualite : il ne part ni en production, ni sur machine, ni en fusion. Il peut revenir d''une machine, aller en quarantaine ou retourner au fournisseur.',
                NEW.lot_fournisseur, NEW.code_reference USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 11. LES SEUILS D'ECART MACHINE (regle 1)
-- -----------------------------------------------------------------------------
-- Vert jusqu'a MAX(10 kg, 1 % de la ligne) : enregistre, rien a confirmer.
-- Orange au-dela : confirmation a l'ecran. Rouge au-dela de MAX(50 kg, 5 %) :
-- droit de valider l'inventaire et commentaire obligatoires.
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_MachineEcartVertKg',   'Ecart machine : vert jusqu''a (kg)',   '10', 'DECIMAL', 'kg', 'Le seuil vert est le plus grand de ce poids et du pourcentage vert de la ligne.', 'MACHINE', 'DIRECTION'),
  ('P_MachineEcartVertPct',  'Ecart machine : vert jusqu''a (%)',    '1',  'DECIMAL', '%',  'Pourcentage du poids de la ligne.', 'MACHINE', 'DIRECTION'),
  ('P_MachineEcartRougeKg',  'Ecart machine : rouge au-dela de (kg)', '50', 'DECIMAL', 'kg', 'Le seuil rouge est le plus grand de ce poids et du pourcentage rouge de la ligne.', 'MACHINE', 'DIRECTION'),
  ('P_MachineEcartRougePct', 'Ecart machine : rouge au-dela de (%)',  '5',  'DECIMAL', '%',  'Pourcentage du poids de la ligne.', 'MACHINE', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 12. LE MODULE LOTS : QUI DECIDE D'UN LOT (regle 5)
-- -----------------------------------------------------------------------------
-- Derogation, blocage, deblocage, dormant : le droit VALIDER du module LOTS,
-- ou la Direction. Lire et ecrire suivent le stock, role par role.
INSERT INTO permission (code_role_user, module, action)
SELECT p.code_role_user, 'LOTS', p.action FROM permission p
 WHERE p.module = 'STOCK' AND p.action IN ('LIRE', 'ECRIRE')
ON CONFLICT (code_role_user, module, action) DO NOTHING;
INSERT INTO permission (code_role_user, module, action)
SELECT r.code_role_user, 'LOTS', 'VALIDER' FROM role_utilisateur r
 WHERE r.code_role_user IN ('ADMIN', 'DIRECTION')
ON CONFLICT (code_role_user, module, action) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 13. LA VALORISATION EN DEUX TEMPS D'UNE RECEPTION LOCALE (regle 6)
-- -----------------------------------------------------------------------------
-- Provisoire a la validation (prix du bon), definitive a la cloture (facture +
-- frais) : la difference va au stock present, au prorata ; la part des kilos
-- deja sortis est tracee en ECART_PRIX, hors CMUP. Journal immuable.
ALTER TABLE reception ADD COLUMN IF NOT EXISTS montant_facture_mad numeric(18,2);
ALTER TABLE reception ADD COLUMN IF NOT EXISTS frais_facture_mad numeric(18,2);
ALTER TABLE reception ADD COLUMN IF NOT EXISTS date_cloture text;
ALTER TABLE reception ADD COLUMN IF NOT EXISTS id_utilisateur_cloture text REFERENCES utilisateur(id_utilisateur);

CREATE TABLE IF NOT EXISTS reception_ajustements_cmup (
    id_ajustement       text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_reception        text    NOT NULL REFERENCES reception(id_reception),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    nature              text    NOT NULL CHECK (nature IN ('STOCK','ECART_PRIX')),
    code_magasin        text    REFERENCES magasin(code_magasin),
    quantite_recue_kg   numeric(18,4) NOT NULL CHECK (quantite_recue_kg >= 0),
    stock_kg            numeric(18,4) NOT NULL CHECK (stock_kg >= 0),
    cmup_avant          numeric(18,4),
    cmup_apres          numeric(18,4),
    montant_mad         numeric(18,2) NOT NULL,
    date_ajustement     text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur      text    NOT NULL REFERENCES utilisateur(id_utilisateur),
    CHECK ((nature = 'STOCK' AND code_magasin IS NOT NULL AND cmup_apres IS NOT NULL)
        OR (nature = 'ECART_PRIX' AND code_magasin IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_rec_ajust_reception ON reception_ajustements_cmup(id_reception);
ALTER TABLE reception_ajustements_cmup OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_rec_ajust_immuable ON reception_ajustements_cmup;
CREATE TRIGGER trg_rec_ajust_immuable
BEFORE UPDATE OR DELETE ON reception_ajustements_cmup FOR EACH ROW
EXECUTE FUNCTION fn_refuser('Le journal des ajustements de CMUP d''une reception est immuable.');

-- -----------------------------------------------------------------------------
-- 14. LES MONTANTS D'ENTREE SUIVENT LA VALEUR DU STOCK (grille des champs)
-- -----------------------------------------------------------------------------
-- Qui ne voit pas la valeur du stock (MOUVEMENTS.valeur_dhs masque) ne voit pas
-- davantage la valeur des entrees ni le prix moyen d'entree : l'assistante les
-- lisait au tableau de bord « Matiere ». Compte par compte, puis role par role.
WITH masques AS (
    SELECT id_utilisateur FROM droit_champ
     WHERE module = 'MOUVEMENTS' AND champ = 'valeur_dhs' AND niveau = 'MASQUE'
), champs AS (
    SELECT champ FROM champ_configurable
     WHERE module = 'MOUVEMENTS' AND champ IN ('entrees_dhs', 'entrees_mad', 'prix_moyen_entree_mad')
)
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT m.id_utilisateur, 'MOUVEMENTS', c.champ, 'MASQUE' FROM masques m CROSS JOIN champs c
ON CONFLICT (id_utilisateur, module, champ) DO UPDATE SET niveau = 'MASQUE';

WITH masques AS (
    SELECT code_role_user FROM modele_droit_champ
     WHERE module = 'MOUVEMENTS' AND champ = 'valeur_dhs' AND niveau = 'MASQUE'
), champs AS (
    SELECT champ FROM champ_configurable
     WHERE module = 'MOUVEMENTS' AND champ IN ('entrees_dhs', 'entrees_mad', 'prix_moyen_entree_mad')
)
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'MOUVEMENTS', c.champ, 'MASQUE' FROM masques m CROSS JOIN champs c
ON CONFLICT (code_role_user, module, champ) DO UPDATE SET niveau = 'MASQUE';

COMMIT;
