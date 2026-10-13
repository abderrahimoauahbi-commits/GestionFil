-- =============================================================================
-- MIGRATION 2026-09-19c — LA CONTRE-PASSATION, ET LA DEVALIDATION
-- -----------------------------------------------------------------------------
-- DECISION DU 19/09/2026, prise sur le modele des grands ERP.
--
-- ON N'EFFACE PAS UN MOUVEMENT. SAP, Oracle et Dynamics font tous la meme
-- chose depuis trente ans : on poste l'INVERSE, les deux lignes restent, et le
-- solde redevient juste. Six mois plus tard, on peut encore repondre a « que
-- s'est-il passe ce jour-la ? » — ce qu'un effacement rend impossible pour
-- toujours.
--
-- LE MOUVEMENT INVERSE PORTE UN TYPE D'AJUSTEMENT, pas le type d'origine
-- inverse. Une reception contre-passee n'est pas une « reception negative » :
-- c'est une correction de stock, et les statistiques d'achat ne doivent pas y
-- voir un achat de moins. AJUST_INV_NEG pour defaire une entree, AJUST_INV_POS
-- pour defaire une sortie.
--
-- LE CMUP SE REFAIT, ET C'EST LE POINT DELICAT. Les types d'ajustement ne le
-- touchent pas (`impacte_cmup = 0`) : contre-passer une reception valorisee
-- rendrait donc la quantite mais laisserait le cout moyen fige sur un achat qui
-- n'a plus lieu. `fn_recalculer_cmup` le refait depuis les lignes VALORISEES
-- QUI RESTENT — moyenne ponderee des entrees non contre-passees — et retombe
-- sur le prix catalogue s'il n'en reste aucune, comme le veut la regle du
-- 2026-09-18e.
--
-- UN MOUVEMENT NE SE CONTRE-PASSE QU'UNE FOIS, et une contre-passation ne se
-- contre-passe pas : sans cette regle, deux clics de trop produisent une paire
-- de lignes qui s'annulent et un grand livre qu'on ne sait plus lire.
--
-- Rejouable : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, INSERT garde.
-- =============================================================================

BEGIN;

-- ------------------------------------------- 1. LE LIEN ENTRE LES DEUX LIGNES
ALTER TABLE mouvement
  ADD COLUMN IF NOT EXISTS id_mouvement_contrepasse text,
  ADD COLUMN IF NOT EXISTS motif_contrepassation    text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mouvement_contrepasse_fk') THEN
        ALTER TABLE mouvement
          ADD CONSTRAINT mouvement_contrepasse_fk
          FOREIGN KEY (id_mouvement_contrepasse) REFERENCES mouvement(id_mouvement);
    END IF;
    -- UN SEUL INVERSE PAR MOUVEMENT. L'unicite se pose ici, pas dans le
    -- programme : deux clics simultanes passeraient entre les mailles d'un
    -- controle applicatif, jamais entre celles d'un index.
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ux_mouvement_contrepasse') THEN
        CREATE UNIQUE INDEX ux_mouvement_contrepasse
            ON mouvement(id_mouvement_contrepasse)
         WHERE id_mouvement_contrepasse IS NOT NULL;
    END IF;
END $$;

COMMENT ON COLUMN mouvement.id_mouvement_contrepasse IS
  'Le mouvement que celui-ci annule. Present = cette ligne EST une contre-passation.';

-- Le motif qui dit pourquoi cette ligne existe.
--
-- SA CATEGORIE EST « CORRECTION » ET NON « INVENTAIRE », bien qu'il emprunte
-- les types d'ajustement d'inventaire : un comptage constate un ecart qu'on
-- ignorait, une contre-passation defait un geste qu'on sait faux. Les confondre
-- ferait passer nos propres erreurs de saisie pour des ecarts de magasin dans
-- toutes les statistiques.
--
-- `signe_default` n'accepte que +1 ou -1 et ne sert qu'a pre-remplir un ecran
-- de saisie : on met -1, defaire une entree etant le cas courant. Le sens reel
-- d'une contre-passation n'est jamais pris ici — il est l'INVERSE du mouvement
-- annule, et le programme le deduit de lui.
INSERT INTO motif_mouvement (code_motif, libelle, categorie, signe_default, actif)
SELECT 'CONTREPASSATION', 'Contre-passation d''un mouvement', 'CORRECTION', -1, 1
 WHERE NOT EXISTS (SELECT 1 FROM motif_mouvement WHERE code_motif = 'CONTREPASSATION');

-- ------------------------------------ 2. LE CMUP SE REFAIT SUR CE QUI RESTE
CREATE OR REPLACE FUNCTION fn_recalculer_cmup(p_reference text) RETURNS numeric
LANGUAGE plpgsql AS $$
DECLARE
    v_kg    numeric;
    v_val   numeric;
    v_prix  numeric;
    v_quand text := to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    -- LA MOYENNE PONDEREE DES ENTREES QUI TIENNENT ENCORE. Sont exclues : les
    -- lignes d'un mouvement contre-passe, et les contre-passations elles-memes.
    -- Le socle d'ouverture (STOCK_INIT) en est aussi : son prix est une
    -- VALORISATION, pas un achat — c'est la regle posee le 2026-09-18i.
    SELECT COALESCE(SUM(lm.quantite_kg), 0),
           COALESCE(SUM(lm.quantite_kg * lm.prix_kg_mad), 0)
      INTO v_kg, v_val
      FROM ligne_mouvement lm
      JOIN mouvement m       ON m.id_mouvement = lm.id_mouvement
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE lm.code_reference = p_reference
       AND lm.prix_kg_mad IS NOT NULL
       AND tm.signe = 1
       AND m.code_type_mvt <> 'STOCK_INIT'
       AND m.id_mouvement_contrepasse IS NULL      -- ce n'est pas un inverse
       AND NOT EXISTS (SELECT 1 FROM mouvement x   -- et il n'a pas ete annule
                        WHERE x.id_mouvement_contrepasse = m.id_mouvement);

    IF v_kg > 0 THEN
        v_prix := ROUND(v_val / v_kg, 4);
    ELSE
        -- Plus aucun achat ne tient : on retombe sur le catalogue, exactement
        -- comme avant la premiere reception.
        v_prix := fn_prix_catalogue_mad(p_reference);
    END IF;

    UPDATE stock_magasin
       SET cmup_mad = v_prix, date_maj = v_quand
     WHERE code_reference = p_reference
       AND cmup_mad IS DISTINCT FROM v_prix;
    UPDATE reference
       SET cmup_mad = v_prix,
           date_dernier_cmup = CASE WHEN v_prix IS NULL THEN NULL ELSE v_quand END
     WHERE code_reference = p_reference
       AND cmup_mad IS DISTINCT FROM v_prix;
    RETURN v_prix;
END $$;

COMMENT ON FUNCTION fn_recalculer_cmup(text) IS
  'Refait le CMUP depuis les entrees valorisees qui tiennent encore ; retombe sur le catalogue s''il n''en reste aucune.';

-- --------------------------------- 3. CE QU'UN DOCUMENT A ENCORE DE VIVANT
-- Un document ne se devalide pas tant que ses mouvements tiennent : defaire la
-- validation sans defaire le stock laisserait un magasin qui ne correspond plus
-- a aucun papier. La reponse se lit ici, une fois pour toutes.
CREATE OR REPLACE VIEW v_document_mouvements_vivants AS
SELECT m.reference_document                                   AS document,
       COUNT(*)                                               AS nb_mouvements,
       ROUND(COALESCE(SUM(lm.quantite_kg), 0), 3)             AS kg
  FROM mouvement m
  LEFT JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
 WHERE m.reference_document IS NOT NULL
   AND m.id_mouvement_contrepasse IS NULL
   AND NOT EXISTS (SELECT 1 FROM mouvement x
                    WHERE x.id_mouvement_contrepasse = m.id_mouvement)
 GROUP BY m.reference_document;

ALTER VIEW v_document_mouvements_vivants OWNER TO gestionfil;

-- ---------------------- 3bis. LE JOURNAL APPREND DEUX MOTS DE PLUS
--
-- `audit_log.operation` n'acceptait que INSERT, UPDATE et DELETE : le
-- vocabulaire d'un declencheur, pas celui d'un metier. Or une DEVALIDATION
-- n'est pas un UPDATE comme un autre — c'est une decision, elle porte un motif,
-- et celui qui relira le journal dans six mois doit la distinguer d'une simple
-- correction de champ. Meme chose pour une CONTRE-PASSATION.
--
-- Les enregistrer sous « UPDATE » reviendrait a les noyer parmi des milliers de
-- lignes techniques : elles seraient tracees sans etre retrouvables.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_operation_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_operation_check
    CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'DEVALIDATION', 'CONTREPASSATION'));

-- ------------------------------ 4. LES RETOURS EN ARRIERE SE DECLARENT
--
-- LES TRANSITIONS SONT DES DONNEES, PAS DU CODE : `fn_trg_transition_*` refuse
-- tout passage d'etat qui n'est pas inscrit dans `transition_statut`. C'est une
-- bonne chose — la regle se lit dans une table plutot que dans six fonctions —
-- et cela veut dire qu'ouvrir la devalidation ne demande AUCUNE retouche de
-- declencheur : il suffit de declarer les chemins du retour.
--
-- `role_requis` porte ADMIN, car defaire la validation d'un autre est un acte
-- de direction. Le declencheur ne le lit pas encore ; le service, lui, l'exige
-- deja. La colonne dit l'intention a qui lira la table.
--
-- CE QUI N'EST PAS OUVERT L'EST VOLONTAIREMENT : un bon CLOTURE ou LIVRE_PARTIEL
-- ne recule pas — la marchandise est arrivee, et le bon en est la preuve. Un
-- transfert non plus : ses deux mouvements appartiennent a deux magasins, et
-- c'est la contre-passation qui les defait.
INSERT INTO transition_statut (entite, statut_source, statut_cible, role_requis, description)
SELECT v.entite, v.source, v.cible, 'ADMIN', v.pourquoi
  FROM (VALUES
    ('plan_production', 'EN_COURS',  'BROUILLON',   'Devalidation : le plan revient en saisie'),
    ('plan_production', 'CLOTURE',   'BROUILLON',   'Reouverture d''un plan cloture trop tot'),
    ('bon_commande',    'VALIDE',    'BROUILLON',   'Devalidation d''un bon non encore servi'),
    ('bon_commande',    'ENVOYE',    'BROUILLON',   'Le fournisseur refuse le bon : il redevient modifiable'),
    ('reception',       'VALIDE',    'A_CONTROLER', 'Devalidation : le controle est a refaire'),
    ('reception',       'CLOTURE',   'A_CONTROLER', 'Reouverture d''une reception cloturee trop tot'),
    ('inventaire',      'CLOTURE',   'EN_COURS',    'Reouverture d''un inventaire : un comptage etait faux'),
    ('qualite',         'CLOTURE',   'ACTIF',       'Reouverture d''une qualite cloturee trop tot')
  ) AS v(entite, source, cible, pourquoi)
 WHERE NOT EXISTS (
       SELECT 1 FROM transition_statut t
        WHERE t.entite = v.entite AND t.statut_source = v.source AND t.statut_cible = v.cible);

-- ------------------------------------------------------------- 5. LES PREUVES
DO $$
DECLARE n_col bigint; n_motif bigint; n_fn bigint; n_trans bigint;
BEGIN
    SELECT count(*) INTO n_trans FROM transition_statut
     WHERE (entite, statut_source, statut_cible) IN (
        ('plan_production','EN_COURS','BROUILLON'), ('plan_production','CLOTURE','BROUILLON'),
        ('bon_commande','VALIDE','BROUILLON'), ('bon_commande','ENVOYE','BROUILLON'),
        ('reception','VALIDE','A_CONTROLER'), ('reception','CLOTURE','A_CONTROLER'),
        ('inventaire','CLOTURE','EN_COURS'), ('qualite','CLOTURE','ACTIF'));
    IF n_trans <> 8 THEN
        RAISE EXCEPTION 'seuls %/8 chemins de retour sont declares', n_trans;
    END IF;
    SELECT count(*) INTO n_col FROM information_schema.columns
     WHERE table_name = 'mouvement'
       AND column_name IN ('id_mouvement_contrepasse', 'motif_contrepassation');
    SELECT count(*) INTO n_motif FROM motif_mouvement WHERE code_motif = 'CONTREPASSATION';
    SELECT count(*) INTO n_fn FROM pg_proc WHERE proname = 'fn_recalculer_cmup';
    IF n_col <> 2 OR n_motif <> 1 OR n_fn <> 1 THEN
        RAISE EXCEPTION 'socle incomplet : % colonne(s), % motif, % fonction', n_col, n_motif, n_fn;
    END IF;
    RAISE NOTICE 'contre-passation : le lien, le motif et le recalcul du CMUP sont en place';
END $$;

COMMIT;
