-- =============================================================================
-- MIGRATION 2026-10-02 — le registre des lots (cahier « Gestion des lots »)
--
-- CE QUI MANQUAIT. `stock_lot` tient un SOLDE par (reference, magasin, lot) ;
-- rien ne disait ce qu'EST un lot : d'ou il vient, s'il est bloque par la
-- qualite, s'il compte pour le plan d'achat (Projet) ou s'il n'est plus qu'un
-- reste, ni ce qui lui est arrive. Ce fichier pose :
--
--   * `lot` — une fiche par (reference, lot) : origine, fournisseur, statut
--     (LIBRE / BLOQUE / SOLDE), categorie (PROJET / RESTES), activite ;
--   * `lot_evenement` — le journal des decisions (blocage, basculement,
--     fusion, decision sur lot dormant, derogation), motif obligatoire ;
--   * `demande_autorisation` — les demandes ORANGE / ROUGE et leur reponse ;
--   * les reglages : dormance 365 j, tolerance de poids 1 % / 3 %, et le
--     SEUIL PROJET / RESTES : un lot est Projet s'il remplit au moins UN ETAGE
--     de machine — 1 344 bobines (CRM1, TINGIS, CRX). Un seuil en kilos ne
--     disait rien : 1 882 bobines de 2,2 kg (4 140 kg) chargent un etage et
--     demi, et passaient pourtant en Restes sous 5 000 kg. Chaque article peut
--     poser son propre seuil, en kilos, en bobines ou en palettes ; un article
--     sans poids de bobine (jute, colle) garde un seuil en kilos (5 000) ;
--   * deux declencheurs sur le grand livre : le poids theorique par bobine se
--     remplit seul, un lot BLOQUE ne bouge plus, et la fiche du lot nait au
--     premier mouvement ;
--   * les vues : v_lot, v_lot_variation, v_lot_vie ;
--   * le plan d'achat ne compte plus les Restes ni les lots bloques
--     (v_stock_physique.stock_reserve_kg, terme prevu a cet effet).
--
-- DORMANT n'est pas stocke : il se CALCULE (aucune activite depuis la duree
-- reglee). Un statut stocke serait perime le lendemain.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-02_registre_lots.sql
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------- reglages
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par) VALUES
  ('P_LotDormanceJours', 'Dormance d''un lot', '365', 'ENTIER', 'jours',
   'Un lot sans aucune activite (entree, sortie, constat) depuis cette duree est signale dormant.', 'STOCK', 'DIRECTION'),
  ('P_LotTolOrangePct', 'Ecart de poids : seuil orange', '1', 'DECIMAL', '%',
   'Au-dela, la ligne demande une confirmation (« Je confirme avoir verifie »).', 'STOCK', 'DIRECTION'),
  ('P_LotTolRougePct', 'Ecart de poids : seuil rouge', '3', 'DECIMAL', '%',
   'Au-dela, la ligne demande une autorisation d''un responsable.', 'STOCK', 'DIRECTION'),
  ('P_LotSeuilBobines', 'Seuil Projet / Restes : bobines d''un etage', '1344', 'ENTIER', 'bobines',
   'Un lot qui remplit au moins un etage de machine est du stock Projet ; en dessous, c''est un Reste. 1 344 = un etage de CRM1, TINGIS ou CRX.', 'STOCK', 'DIRECTION'),
  ('P_LotSeuilRestesKg', 'Seuil Projet / Restes en kilos', '5000', 'DECIMAL', 'kg',
   'Pour un article sans poids de bobine au catalogue (jute, colle) : sous ce poids, un lot est un Reste.', 'STOCK', 'DIRECTION')
ON CONFLICT (code_parametre) DO NOTHING;

-- LA GESTION DES LOTS SE REGLE SUR LA FICHE ARTICLE (carte « Gestion des lots »),
-- et seulement quand l'article est suivi par lot :
--
--   * seuil_lot_valeur — le MINIMUM D'UN LOT POUR PRODUIRE. Il se compte dans
--     l'unite de conditionnement deja definie sur la fiche (la bobine pour le
--     fil) ; en kilos pour un article sans poids par unite. Pas d'unite a part :
--     elle repetait celle du conditionnement. Vide : un etage de machine
--     (P_LotSeuilBobines), ou les kilos du reglage general.
--   * type_lot — d'ou vient le numero :
--       OBLIGATOIRE  le numero du fournisseur est exige a l'entree ;
--       GENERIQUE    l'ERP numerote toujours (FOURNISSEUR-JJMMAA-NN) ;
--       INDIFFERENT  « Optionnel » a l'ecran : le numero du fournisseur s'il existe,
--                    sinon un numero genere. C'est le defaut.
--   * fusion_lot — la fusion de deux lots de l'article est-elle permise
--     (cahier, regle 7 : au choix, meme article, couleur et fournisseur).
ALTER TABLE reference
    ADD COLUMN IF NOT EXISTS seuil_lot_valeur numeric(18,2)
        CHECK (seuil_lot_valeur IS NULL OR seuil_lot_valeur > 0),
    ADD COLUMN IF NOT EXISTS type_lot text NOT NULL DEFAULT 'INDIFFERENT'
        CHECK (type_lot IN ('OBLIGATOIRE', 'GENERIQUE', 'INDIFFERENT')),
    ADD COLUMN IF NOT EXISTS fusion_lot bigint NOT NULL DEFAULT 1
        CHECK (fusion_lot IN (0, 1));

-- Le seuil EFFECTIF d'un article : sa valeur, son unite, et ses deux
-- traductions (bobines, kilos) quand le colisage du catalogue les permet.
-- UN ARTICLE NON SUIVI PAR LOT N'A PAS DE STOCK MINIMUM PAR LOT : tout est
-- vide, et son stock compte en entier pour le plan d'achat (voir plus bas). La
-- valeur posee sur la fiche est gardee : elle revient si l'on rallume le suivi.
CREATE OR REPLACE FUNCTION fn_lot_seuil(p_reference text)
RETURNS TABLE (valeur numeric, unite text, bobines numeric, kg numeric)
LANGUAGE sql STABLE AS $$
    WITH r AS (
        SELECT seuil_lot_valeur AS v,
               CASE WHEN seuil_lot_valeur IS NOT NULL
                    THEN CASE WHEN NULLIF(poids_bobine_kg, 0) IS NOT NULL THEN 'Bobine' ELSE 'kg' END END AS u,
               NULLIF(poids_bobine_kg, 0)::numeric AS pb,
               NULLIF(bobines_par_palette, 0)::numeric AS bpp
          FROM reference WHERE code_reference = p_reference AND suivi_lot = 1
    ), p AS (
        SELECT max(CASE WHEN code_parametre = 'P_LotSeuilBobines' THEN valeur_courante::numeric END) AS bob,
               max(CASE WHEN code_parametre = 'P_LotSeuilRestesKg' THEN valeur_courante::numeric END) AS kg
          FROM parametre
    ), e AS (
        SELECT CASE WHEN r.v IS NOT NULL THEN r.v WHEN r.pb IS NOT NULL THEN p.bob ELSE p.kg END AS valeur,
               CASE WHEN r.v IS NOT NULL THEN r.u WHEN r.pb IS NOT NULL THEN 'Bobine' ELSE 'kg' END AS unite,
               r.pb, r.bpp
          FROM r CROSS JOIN p
    )
    SELECT e.valeur, e.unite,
           CASE e.unite WHEN 'Bobine' THEN e.valeur WHEN 'Palette' THEN e.valeur * e.bpp END,
           CASE e.unite WHEN 'kg' THEN e.valeur
                        WHEN 'Bobine' THEN round(e.valeur * e.pb, 2)
                        WHEN 'Palette' THEN round(e.valeur * e.bpp * e.pb, 2) END
      FROM e
$$;
ALTER FUNCTION fn_lot_seuil(text) OWNER TO gestionfil;

-- UN LOT ATTEINT-IL LE SEUIL ? En bobines quand le seuil se compte en bobines
-- et que le lot porte son nombre de bobines : c'est ce qui se charge sur un
-- etage, et un fil un peu leger ne doit pas faire passer un lot complet en
-- Reste. Sinon en kilos.
CREATE OR REPLACE FUNCTION fn_lot_au_seuil(p_reference text, p_kg numeric, p_bobines numeric)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM reference
                                  WHERE code_reference = p_reference AND suivi_lot = 1) THEN true
                WHEN s.bobines IS NOT NULL AND COALESCE(p_bobines, 0) > 0 THEN p_bobines >= s.bobines
                WHEN s.kg IS NOT NULL THEN COALESCE(p_kg, 0) >= s.kg
                ELSE COALESCE(p_kg, 0) >= (SELECT valeur_courante::numeric FROM parametre
                                            WHERE code_parametre = 'P_LotSeuilRestesKg') END
      FROM (SELECT 1) un LEFT JOIN fn_lot_seuil(p_reference) s ON true
$$;
ALTER FUNCTION fn_lot_au_seuil(text, numeric, numeric) OWNER TO gestionfil;

-- CES REGLAGES SE FONT SUR LA FICHE ARTICLE. Un champ non declare est masque
-- pour tout le monde : sans ces lignes, les colonnes existeraient en base et
-- n'arriveraient jamais a l'ecran du catalogue.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('CATALOGUE','type_lot',         'Type de lot',                     'ECRITURE', 0, 3014),
 ('CATALOGUE','seuil_lot_valeur', 'Minimum d''un lot pour produire', 'ECRITURE', 0, 3015),
 ('CATALOGUE','fusion_lot',       'Fusion de lots autorisee',        'ECRITURE', 0, 3016)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

CREATE TEMP TABLE champs_seuil_lot (module text, champ text) ON COMMIT DROP;
INSERT INTO champs_seuil_lot VALUES ('CATALOGUE','type_lot'), ('CATALOGUE','seuil_lot_valeur'), ('CATALOGUE','fusion_lot');

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN EXISTS (SELECT 1 FROM permission p
                          WHERE p.code_role_user = r.code_role_user
                            AND p.module = c.module AND p.action = 'ECRIRE')
            THEN c.niveau_defaut
            WHEN EXISTS (SELECT 1 FROM permission p
                          WHERE p.code_role_user = r.code_role_user
                            AND p.module = c.module AND p.action = 'LIRE')
            THEN 'LECTURE' ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
  JOIN champs_seuil_lot n ON n.module = c.module AND n.champ = c.champ
 WHERE r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champs_seuil_lot n ON n.module = m.module AND n.champ = m.champ
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- ---------------------------------------------------------------- le registre
CREATE TABLE IF NOT EXISTS lot (
    code_reference      text NOT NULL REFERENCES reference (code_reference),
    lot_fournisseur     text NOT NULL CHECK (btrim(lot_fournisseur) <> ''),
    origine             text NOT NULL DEFAULT 'FOURNISSEUR'
                        CHECK (origine IN ('FOURNISSEUR','GENERE','RETOUR','FUSION','SANS_LOT')),
    code_fournisseur    text REFERENCES fournisseur (code_fournisseur),
    statut              text NOT NULL DEFAULT 'LIBRE' CHECK (statut IN ('LIBRE','BLOQUE','SOLDE')),
    categorie           text NOT NULL DEFAULT 'PROJET' CHECK (categorie IN ('PROJET','RESTES')),
    -- Fusion : le lot absorbe pointe vers celui qui l'a recu.
    fusionne_dans       text,
    date_creation       text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    -- Derniere entree, sortie ou constat : c'est elle qui fait la dormance.
    date_derniere_activite text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    PRIMARY KEY (code_reference, lot_fournisseur)
);
ALTER TABLE lot OWNER TO gestionfil;

CREATE TABLE IF NOT EXISTS lot_evenement (
    id_evenement        text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    code_reference      text NOT NULL,
    lot_fournisseur     text NOT NULL,
    type_evenement      text NOT NULL CHECK (type_evenement IN
                        ('BLOCAGE','DEBLOCAGE','BASCULEMENT_RESTES','RETOUR_PROJET','FUSION',
                         'DECISION_DORMANT','DEROGATION','SOLDE','IDENTIFICATION')),
    motif               text NOT NULL CHECK (btrim(motif) <> ''),
    details             jsonb,
    id_utilisateur      text,
    date_evenement      text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    FOREIGN KEY (code_reference, lot_fournisseur) REFERENCES lot (code_reference, lot_fournisseur)
);
CREATE INDEX IF NOT EXISTS ix_lot_evenement_lot ON lot_evenement (code_reference, lot_fournisseur, date_evenement);
ALTER TABLE lot_evenement OWNER TO gestionfil;

CREATE TABLE IF NOT EXISTS demande_autorisation (
    id_demande          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    type_demande        text NOT NULL CHECK (type_demande IN
                        ('ECART_POIDS','MELANGE_FOURNISSEURS','LOT_BLOQUE','RESTES_PRODUCTION',
                         'RETOUR_PRINCIPAL','DORMANT','FUSION','STOCK_INSUFFISANT')),
    niveau              text NOT NULL DEFAULT 'ROUGE' CHECK (niveau IN ('ORANGE','ROUGE')),
    statut              text NOT NULL DEFAULT 'EN_ATTENTE'
                        CHECK (statut IN ('EN_ATTENTE','ACCORDEE','REFUSEE','ANNULEE')),
    code_reference      text,
    lot_fournisseur     text,
    -- Le document qui attend la reponse (fiche machine, transfert, mouvement…).
    document            text,
    details             jsonb,
    motif               text NOT NULL CHECK (btrim(motif) <> ''),
    id_demandeur        text NOT NULL,
    date_demande        text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_decideur         text,
    date_decision       text,
    motif_decision      text,
    CHECK (statut IN ('EN_ATTENTE','ANNULEE') OR (id_decideur IS NOT NULL AND date_decision IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_demande_statut ON demande_autorisation (statut, date_demande);
ALTER TABLE demande_autorisation OWNER TO gestionfil;

-- ---------------------------------------------------------------- reprise
-- Chaque lot deja connu (stock ou grand livre) recoit sa fiche.
INSERT INTO lot (code_reference, lot_fournisseur, origine, code_fournisseur, date_creation, date_derniere_activite)
SELECT x.code_reference, x.lot_fournisseur,
       CASE WHEN x.lot_fournisseur = 'SANS-LOT' THEN 'SANS_LOT'
            WHEN x.lot_fournisseur LIKE 'RETOUR-%' THEN 'RETOUR'
            WHEN x.lot_fournisseur ~ '^REC-[0-9]{4}-[0-9]+-[0-9]+$' THEN 'GENERE'
            ELSE 'FOURNISSEUR' END,
       r.code_fournisseur,
       x.premiere, x.derniere
  FROM (SELECT code_reference, lot_fournisseur, min(d) AS premiere, max(d) AS derniere
          FROM (SELECT lm.code_reference, lm.lot_fournisseur, m.date_mouvement AS d
                  FROM ligne_mouvement lm JOIN mouvement m USING (id_mouvement)
                 WHERE lm.lot_fournisseur IS NOT NULL AND btrim(lm.lot_fournisseur) <> ''
                UNION ALL
                SELECT code_reference, lot_fournisseur, date_premiere_entree
                  FROM stock_lot WHERE btrim(lot_fournisseur) <> '') u
         GROUP BY 1, 2) x
  JOIN reference r ON r.code_reference = x.code_reference
ON CONFLICT DO NOTHING;

-- Categorie de depart : au seuil ou au-dessus = Projet, sinon Restes. « Sans
-- lot » suit la MEME regle (alternative de la decision n° 8 du cahier) : le
-- classer d'office en Restes retirait du plan d'achat tout le stock d'avant le
-- suivi — 251 000 kg sur la copie — et le plan aurait propose de le racheter.
UPDATE lot l
   SET categorie = CASE WHEN fn_lot_au_seuil(l.code_reference, s.kg, s.bobines)
                        THEN 'PROJET' ELSE 'RESTES' END
  FROM (SELECT l2.code_reference, l2.lot_fournisseur,
               COALESCE(sum(sl.quantite_kg), 0) AS kg, COALESCE(sum(sl.nb_bobines), 0) AS bobines
          FROM lot l2
          LEFT JOIN stock_lot sl ON sl.code_reference = l2.code_reference
                                AND sl.lot_fournisseur = l2.lot_fournisseur
         GROUP BY 1, 2) s
 WHERE s.code_reference = l.code_reference AND s.lot_fournisseur = l.lot_fournisseur;

-- ---------------------------------------------------------------- declencheurs
-- AVANT : le poids catalogue fige sur la ligne (il fait l'ecart de poids), et
-- le veto du lot bloque. Le poids d'une ligne deja saisi n'est jamais touche.
CREATE OR REPLACE FUNCTION fn_trg_lmvt_lot_controle() RETURNS trigger AS $$
DECLARE
    v_statut text;
BEGIN
    IF NEW.poids_unitaire_theorique_kg IS NULL AND COALESCE(NEW.nb_bobines, 0) > 0 THEN
        SELECT NULLIF(poids_bobine_kg, 0) INTO NEW.poids_unitaire_theorique_kg
          FROM reference WHERE code_reference = NEW.code_reference;
    END IF;
    IF NEW.lot_fournisseur IS NOT NULL THEN
        SELECT statut INTO v_statut FROM lot
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
        IF v_statut = 'BLOQUE' THEN
            RAISE EXCEPTION 'LOT-BLOQUE : le lot % de % est bloque par la qualite. Seul le responsable qualite peut le debloquer.',
                NEW.lot_fournisseur, NEW.code_reference USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_lot_controle() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_lmvt_lot_controle ON ligne_mouvement;
CREATE TRIGGER trg_lmvt_lot_controle BEFORE INSERT ON ligne_mouvement
FOR EACH ROW EXECUTE FUNCTION fn_trg_lmvt_lot_controle();

-- APRES : la fiche du lot nait au premier mouvement, et chaque mouvement
-- compte comme activite (la dormance se lit dessus). La CATEGORIE suit le
-- seuil de l'article dans les deux cas automatiques : un lot NEUF nait Projet
-- ou Restes selon son poids, et un Reste qui REMONTE au-dessus du seuil par une
-- entree redevient Projet. La descente sous le seuil, elle, reste un geste
-- manuel et obligatoire du magasinier (regle 5) : v_lot.a_basculer la signale.
-- Ce declencheur passe APRES trg_lmvt_appliquer (ordre alphabetique) : le
-- solde du lot est deja a jour quand il le lit.
CREATE OR REPLACE FUNCTION fn_trg_lmvt_lot_registre() RETURNS trigger AS $$
DECLARE
    v_solde  numeric;
    v_bob    numeric;
    v_atteint boolean;
    v_signe  bigint;
    v_neuf   boolean;
BEGIN
    IF NEW.lot_fournisseur IS NULL OR btrim(NEW.lot_fournisseur) = '' THEN
        RETURN NEW;
    END IF;
    SELECT COALESCE(sum(quantite_kg), 0), COALESCE(sum(nb_bobines), 0) INTO v_solde, v_bob FROM stock_lot
     WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
    v_atteint := fn_lot_au_seuil(NEW.code_reference, v_solde, v_bob);
    SELECT tm.signe INTO v_signe FROM mouvement m JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;
    v_neuf := NOT EXISTS (SELECT 1 FROM lot WHERE code_reference = NEW.code_reference
                                              AND lot_fournisseur = NEW.lot_fournisseur);
    IF v_neuf THEN
        INSERT INTO lot (code_reference, lot_fournisseur, origine, code_fournisseur, categorie)
        SELECT NEW.code_reference, NEW.lot_fournisseur,
               CASE WHEN NEW.lot_fournisseur = 'SANS-LOT' THEN 'SANS_LOT'
                    WHEN NEW.lot_fournisseur LIKE 'RETOUR-%' THEN 'RETOUR'
                    ELSE 'FOURNISSEUR' END,
               r.code_fournisseur,
               CASE WHEN v_atteint THEN 'PROJET' ELSE 'RESTES' END
          FROM reference r WHERE r.code_reference = NEW.code_reference
        ON CONFLICT (code_reference, lot_fournisseur) DO NOTHING;
    ELSE
        UPDATE lot
           SET date_derniere_activite = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               categorie = CASE WHEN v_signe = 1 AND categorie = 'RESTES' AND v_atteint
                                THEN 'PROJET' ELSE categorie END
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_lot_registre() OWNER TO gestionfil;
DROP TRIGGER IF EXISTS trg_lmvt_lot_registre ON ligne_mouvement;
CREATE TRIGGER trg_lmvt_lot_registre AFTER INSERT ON ligne_mouvement
FOR EACH ROW EXECUTE FUNCTION fn_trg_lmvt_lot_registre();

-- ---------------------------------------------------------------- vues
-- LA VARIATION DE POIDS d'un lot, sur toute sa vie : reel contre bobines x
-- poids catalogue fige sur chaque ligne. Les transferts ne comptent qu'a la
-- sortie (l'entree confirme la meme matiere) ; les lignes sans bobines ou sans
-- poids catalogue n'entrent pas dans le calcul.
DROP VIEW IF EXISTS v_lot_variation CASCADE;
CREATE VIEW v_lot_variation AS
SELECT lm.code_reference,
       lm.lot_fournisseur,
       count(*)                                                        AS nb_lignes_pesees,
       round(sum(lm.nb_bobines * lm.poids_unitaire_theorique_kg), 4)   AS theorique_kg,
       round(sum(lm.quantite_kg), 4)                                   AS reel_kg,
       round(sum(lm.quantite_kg - lm.nb_bobines * lm.poids_unitaire_theorique_kg), 4) AS ecart_cumule_kg,
       round(sum(lm.quantite_kg - lm.nb_bobines * lm.poids_unitaire_theorique_kg)
             / NULLIF(sum(lm.nb_bobines * lm.poids_unitaire_theorique_kg), 0) * 100, 2) AS ecart_cumule_pct,
       round(sum(lm.quantite_kg) / NULLIF(sum(lm.nb_bobines), 0), 4)   AS poids_reel_moyen_bobine_kg,
       round(avg(lm.poids_unitaire_theorique_kg), 4)                   AS poids_catalogue_bobine_kg
  FROM ligne_mouvement lm
  JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
 WHERE lm.lot_fournisseur IS NOT NULL
   AND COALESCE(lm.nb_bobines, 0) > 0
   AND lm.poids_unitaire_theorique_kg > 0
   AND m.code_type_mvt <> 'TRANSFERT_ENTREE'
 GROUP BY lm.code_reference, lm.lot_fournisseur;
ALTER VIEW v_lot_variation OWNER TO gestionfil;

-- UNE LIGNE PAR LOT : identite, solde, statut, categorie, dormance, alerte de
-- basculement et derive de poids. C'est la source des trois vues de stock
-- (Comptable = tout, Projet, Restes) et des alertes.
DROP VIEW IF EXISTS v_lot CASCADE;
CREATE VIEW v_lot AS
WITH solde AS (
    SELECT code_reference, lot_fournisseur,
           sum(quantite_kg) AS kg, sum(nb_bobines) AS bobines,
           min(date_premiere_entree) AS premiere_entree
      FROM stock_lot GROUP BY 1, 2
), p AS (
    SELECT max(CASE WHEN code_parametre = 'P_LotDormanceJours' THEN valeur_courante::numeric END) AS dormance,
           max(CASE WHEN code_parametre = 'P_LotTolOrangePct' THEN valeur_courante::numeric END) AS orange,
           max(CASE WHEN code_parametre = 'P_LotTolRougePct' THEN valeur_courante::numeric END) AS rouge
      FROM parametre
)
SELECT l.code_reference,
       r.designation,
       r.code_categorie,
       l.lot_fournisseur,
       l.origine,
       l.code_fournisseur,
       f.nom                                            AS fournisseur_nom,
       l.statut,
       -- Sans suivi par lot, la reference n'a pas de Restes : tout son stock
       -- est du Projet, quelle que soit la categorie gardee sur la fiche.
       CASE WHEN r.suivi_lot = 1 THEN l.categorie ELSE 'PROJET' END AS categorie,
       r.type_lot,
       (r.fusion_lot = 1)                               AS fusion_autorisee,
       l.fusionne_dans,
       l.date_creation,
       l.date_derniere_activite,
       COALESCE(s.kg, 0)                                AS solde_kg,
       COALESCE(s.bobines, 0)                           AS solde_bobines,
       -- Le seuil dans l'unite ou il est pose, et sa traduction en kilos.
       sx.valeur                                        AS seuil_valeur,
       sx.unite                                         AS seuil_unite,
       sx.bobines                                       AS seuil_bobines,
       sx.kg                                            AS seuil_restes_kg,
       (current_date - substr(l.date_derniere_activite, 1, 10)::date) AS jours_sans_activite,
       (COALESCE(s.kg, 0) > 0
        AND current_date - substr(l.date_derniere_activite, 1, 10)::date > p.dormance) AS dormant,
       -- Le basculement est MANUEL mais OBLIGATOIRE : l'alerte reste tant
       -- qu'un lot Projet est passe sous le seuil.
       (l.categorie = 'PROJET' AND l.statut = 'LIBRE'
        AND COALESCE(s.kg, 0) > 0
        AND NOT fn_lot_au_seuil(l.code_reference, s.kg, s.bobines))  AS a_basculer,
       v.ecart_cumule_kg,
       v.ecart_cumule_pct,
       v.poids_reel_moyen_bobine_kg,
       r.poids_bobine_kg                                AS poids_catalogue_bobine_kg,
       CASE WHEN v.ecart_cumule_pct IS NULL THEN NULL
            WHEN abs(v.ecart_cumule_pct) > p.rouge  THEN 'ROUGE'
            WHEN abs(v.ecart_cumule_pct) > p.orange THEN 'ORANGE'
            ELSE 'VERT' END                             AS alerte_derive,
       ROUND(COALESCE(s.kg, 0) * COALESCE(
           (SELECT sm.cmup_mad FROM stock_magasin sm
             WHERE sm.code_reference = l.code_reference AND sm.cmup_mad IS NOT NULL
             ORDER BY sm.quantite_kg DESC LIMIT 1), r.cmup_mad, 0), 2) AS valeur_mad
  FROM lot l
  JOIN reference r ON r.code_reference = l.code_reference
  LEFT JOIN fournisseur f ON f.code_fournisseur = l.code_fournisseur
  LEFT JOIN solde s ON s.code_reference = l.code_reference AND s.lot_fournisseur = l.lot_fournisseur
  LEFT JOIN v_lot_variation v ON v.code_reference = l.code_reference AND v.lot_fournisseur = l.lot_fournisseur
  LEFT JOIN LATERAL fn_lot_seuil(l.code_reference) sx ON true
  CROSS JOIN p;
ALTER VIEW v_lot OWNER TO gestionfil;

-- LA FICHE DE VIE : tout ce qui est arrive a un lot, dans l'ordre.
DROP VIEW IF EXISTS v_lot_vie CASCADE;
CREATE VIEW v_lot_vie AS
SELECT lm.code_reference, lm.lot_fournisseur,
       m.date_mouvement                                   AS date_evenement,
       'MOUVEMENT'                                        AS nature,
       tm.libelle                                         AS evenement,
       m.numero_mouvement                                 AS document,
       COALESCE(m.reference_document, '')                 AS document_origine,
       m.code_magasin                                     AS lieu,
       round(tm.signe * lm.quantite_kg, 4)                AS kg,
       lm.nb_bobines,
       round(lm.nb_bobines * lm.poids_unitaire_theorique_kg, 4) AS theorique_kg,
       round(lm.quantite_kg - lm.nb_bobines * lm.poids_unitaire_theorique_kg, 4) AS ecart_kg,
       round(lm.ecart_theorique_pct, 2)                   AS ecart_pct,
       u.login                                            AS utilisateur,
       COALESCE(lm.motif_lot_force, m.observations_globales) AS motif
  FROM ligne_mouvement lm
  JOIN mouvement m        ON m.id_mouvement = lm.id_mouvement
  JOIN type_mouvement tm  ON tm.code_type_mvt = m.code_type_mvt
  LEFT JOIN utilisateur u ON u.id_utilisateur = m.id_utilisateur
 WHERE lm.lot_fournisseur IS NOT NULL
UNION ALL
SELECT e.code_reference, e.lot_fournisseur, e.date_evenement, 'DECISION', e.type_evenement,
       NULL, '', NULL, NULL, NULL, NULL, NULL, NULL, u.login, e.motif
  FROM lot_evenement e LEFT JOIN utilisateur u ON u.id_utilisateur = e.id_utilisateur
UNION ALL
SELECT d.code_reference, d.lot_fournisseur, d.date_demande, 'AUTORISATION',
       d.type_demande || ' (' || d.niveau || ') — ' || d.statut,
       d.document, '', NULL, NULL, NULL, NULL, NULL, NULL, u.login,
       d.motif || COALESCE(' / réponse : ' || d.motif_decision, '')
  FROM demande_autorisation d LEFT JOIN utilisateur u ON u.id_utilisateur = d.id_demandeur
 WHERE d.lot_fournisseur IS NOT NULL;
ALTER VIEW v_lot_vie OWNER TO gestionfil;

-- ---------------------------------------------------------------- plan d'achat
-- Le terme de reserve, pose a zero « en attendant », recoit enfin son sens :
-- les lots RESTES et BLOQUES ne comptent pas pour le plan d'achat. Les
-- colonnes nouvelles vont en fin de liste pour ne rien casser en aval.
CREATE OR REPLACE VIEW v_stock_physique AS
WITH hors_mrp AS (
    SELECT sl.code_reference,
           sum(CASE WHEN l.categorie = 'RESTES' AND rr.suivi_lot = 1 AND l.statut <> 'BLOQUE'
                    THEN sl.quantite_kg ELSE 0 END)                                                AS restes_kg,
           sum(CASE WHEN l.statut = 'BLOQUE' THEN sl.quantite_kg ELSE 0 END)                           AS bloque_kg
      FROM stock_lot sl
      JOIN lot l ON l.code_reference = sl.code_reference AND l.lot_fournisseur = sl.lot_fournisseur
      JOIN reference rr ON rr.code_reference = sl.code_reference
      JOIN magasin mg ON mg.code_magasin = sl.code_magasin
     WHERE mg.inclure_mrp = 1 AND mg.est_quarantaine = 0
     GROUP BY sl.code_reference
)
SELECT
    r.code_reference,
    ROUND(COALESCE(SUM(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0
                            THEN sm.quantite_kg END), 0), 4)          AS stock_utilisable_kg,
    ROUND(COALESCE(SUM(CASE WHEN mg.est_quarantaine = 1
                            THEN sm.quantite_kg END), 0), 4)          AS stock_quarantaine_kg,
    ROUND(COALESCE(max(h.restes_kg), 0) + COALESCE(max(h.bloque_kg), 0), 4) AS stock_reserve_kg,
    ROUND(COALESCE(SUM(CASE WHEN mg.inclure_mrp = 1 AND mg.est_quarantaine = 0
                            THEN sm.quantite_kg END), 0)
          - COALESCE(max(h.restes_kg), 0) - COALESCE(max(h.bloque_kg), 0), 4) AS stock_physique_net_kg,
    ROUND(COALESCE(max(h.restes_kg), 0), 4)                           AS stock_restes_kg,
    ROUND(COALESCE(max(h.bloque_kg), 0), 4)                           AS stock_bloque_kg
FROM reference r
LEFT JOIN stock_magasin sm ON sm.code_reference = r.code_reference
LEFT JOIN magasin       mg ON mg.code_magasin   = sm.code_magasin
LEFT JOIN hors_mrp      h  ON h.code_reference  = r.code_reference
WHERE r.actif = 1
GROUP BY r.code_reference;

-- LES SUBSTITUTS NON PLUS ne comptent pas les Restes : la vue proposait un
-- article equivalent sur la foi de son stock brut, Restes compris.
CREATE OR REPLACE VIEW v_substitution_dispo AS
SELECT
    r1.code_reference           AS ref_principale,
    r1.designation              AS designation_principale,
    sp1.statut                  AS statut_principale,
    sp1.stock_projete_kg        AS stock_projete_principale,
    rge1.code_groupe_equiv,
    ge.libelle                  AS groupe_libelle,
    rge1.priorite               AS priorite_principale,
    r2.code_reference           AS ref_substitut,
    r2.designation              AS designation_substitut,
    r2.code_fournisseur         AS fournisseur_substitut,
    rge2.priorite               AS priorite_substitut,
    rge2.est_preferentielle,
    -- LE STOCK D'UN SUBSTITUT SE LIT NET : sans ses lots Restes ni ses lots
    -- bloques (02/10/2026). Un Reste ne remplace pas un lot de production.
    ph2.stock_physique_net_kg   AS stock_substitut_kg,
    sp2.stock_projete_kg        AS stock_projete_substitut
FROM reference r1
JOIN reference_groupe_equiv rge1 ON rge1.code_reference = r1.code_reference AND rge1.actif = 1
JOIN groupe_equiv           ge   ON ge.code_groupe_equiv = rge1.code_groupe_equiv AND ge.actif = 1
JOIN reference_groupe_equiv rge2 ON rge2.code_groupe_equiv = rge1.code_groupe_equiv
                                AND rge2.code_reference   <> rge1.code_reference
                                AND rge2.actif = 1
JOIN reference              r2   ON r2.code_reference = rge2.code_reference AND r2.actif = 1
JOIN v_stock_projete       sp1   ON sp1.code_reference = r1.code_reference
JOIN v_stock_projete       sp2   ON sp2.code_reference = r2.code_reference
JOIN v_stock_physique     ph2   ON ph2.code_reference = r2.code_reference
WHERE r1.actif = 1
  AND sp1.statut IN ('RUPTURE','CRITIQUE')
  AND ph2.stock_physique_net_kg > 0
ORDER BY r1.code_reference, rge2.est_preferentielle DESC, rge2.priorite;
ALTER VIEW v_substitution_dispo OWNER TO gestionfil;

-- ---------------------------------------------------------------- fusion
-- LA FUSION DEPLACE DES KILOS D'UN LOT A L'AUTRE DANS LE MEME MAGASIN : le
-- magasin ne bouge pas, le cout moyen non plus. Deux types sans effet sur le
-- CMUP, marques « internes » pour que les statistiques ne les comptent ni en
-- consommation ni en entree.
ALTER TABLE type_mouvement ADD COLUMN IF NOT EXISTS interne bigint NOT NULL DEFAULT 0
    CHECK (interne IN (0, 1));
INSERT INTO type_mouvement (code_type_mvt, libelle, signe, exige_prix, impacte_cmup, exige_of, exige_motif_ligne, couleur, actif, interne) VALUES
  ('FUSION_SORTIE', 'Fusion de lots - sortie', -1, 0, 0, 0, 0, '#64748b', 1, 1),
  ('FUSION_ENTREE', 'Fusion de lots - entree',  1, 0, 0, 0, 0, '#64748b', 1, 1)
ON CONFLICT (code_type_mvt) DO NOTHING;
INSERT INTO motif_mouvement (code_motif, libelle, categorie, signe_default)
SELECT 'FUSION', 'Fusion de lots', 'LOGISTIQUE', 1
 WHERE NOT EXISTS (SELECT 1 FROM motif_mouvement WHERE code_motif = 'FUSION');
-- L'IDENTIFICATION d'un lot passe par les memes mouvements internes : du stock
-- range « Sans lot » recoit, plus tard, le numero lu sur l'etiquette.
INSERT INTO motif_mouvement (code_motif, libelle, categorie, signe_default)
SELECT 'IDENTIFICATION', 'Identification du lot', 'LOGISTIQUE', 1
 WHERE NOT EXISTS (SELECT 1 FROM motif_mouvement WHERE code_motif = 'IDENTIFICATION');

-- ---------------------------------------------------------------- preuve
SELECT 'lots enregistres : ' || (SELECT count(*) FROM lot)
    || ' ; projet ' || (SELECT count(*) FROM lot WHERE categorie = 'PROJET')
    || ' ; restes ' || (SELECT count(*) FROM lot WHERE categorie = 'RESTES')
    || ' ; stock hors plan d''achat (kg) : ' || (SELECT round(sum(stock_reserve_kg)) FROM v_stock_physique);

COMMIT;
