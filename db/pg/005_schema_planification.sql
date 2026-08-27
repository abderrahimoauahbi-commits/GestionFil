-- =============================================================================
-- Module 5 : PLANIFICATION PRODUCTION & MRP
-- =============================================================================
-- CORRECTIONS MAJEURES :
--
--  * BL-4 : le CDC portait `plan_production.id_recette_base` -> UNE seule
--    recette par plan. La vue MRP joignait
--        pp.id_recette_base = r.id_recette AND r.code_qualite = lpp.code_qualite
--    ce qui eliminait les lignes de TOUTES les autres qualites du plan.
--    Un plan couvrant 18 qualites n'aurait calcule les besoins que d'une seule.
--    -> remplace par la table de liaison `plan_recette` (snapshot plan x qualite
--       x version de recette), coherent avec la philosophie B3.
--
--  * BL-6 : `besoin_mrp` n'avait qu'un index NON unique. Chaque relance du MRP
--    empilait des lignes que v_stock_projete sommait -> besoins et budget
--    doubles a chaque recalcul. -> contrainte UNIQUE + recalcul idempotent.
--
--  * Ambiguite saisonnalite : `m2_prevus` est desormais DEFINI comme la valeur
--    mensuelle DEFINITIVE (deja saisonnalisee). `saisonnalite` et
--    `m2_base_mensuel` ne sont conserves que pour la tracabilite du calcul.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- plan_production
-- -----------------------------------------------------------------------------
CREATE TABLE plan_production (
    id_plan             text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    annee               integer NOT NULL CHECK (annee BETWEEN 2000 AND 2200),
    numero_version      integer NOT NULL DEFAULT 1 CHECK (numero_version > 0),
    libelle             text    NOT NULL,
    scenario_nom        text,
    -- Periode GLISSANTE : `date_debut` est le premier jour du mois M0 choisi
    -- dans l'entete, `mois_horizon` le nombre de mois couverts. `date_fin` en
    -- decoule et n'est conservee que pour les vues qui datent les besoins.
    date_debut          text    NOT NULL,
    date_fin            text    NOT NULL,
    -- Jusqu'a cinq ans : un plan pluriannuel est une periode glissante plus
    -- longue, rien d'autre. Ce qui distingue deux mois n'est pas leur mois
    -- calendaire mais leur RANG dans la periode — mai de l'an 1 et mai de l'an 2
    -- sont deux cases differentes.
    mois_horizon        integer NOT NULL DEFAULT 12 CHECK (mois_horizon BETWEEN 1 AND 60),
    -- Croissance ANNUELLE, composee : facteur = (1 + taux)^(mois ecoules / 12).
    -- Une croissance lineaire ferait un saut au 1er janvier et sous-estimerait
    -- les annees suivantes ; la composition suit le temps reellement ecoule.
    croissance_annuelle_pct numeric(9,4) NOT NULL DEFAULT 0,
    statut              text    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','SIMULATION','EN_COURS','CLOTURE')),

    -- Un plan cloture ne nourrit plus aucun besoin : le drapeau derive du statut
    -- pour qu'ils ne puissent pas se contredire.
    actif               integer GENERATED ALWAYS AS
                                (CASE WHEN statut = 'CLOTURE' THEN 0 ELSE 1 END) STORED,

    -- Parametres LOCAUX embarques a la creation (B3 / R09)
    marge_securite_pct  numeric(9,4)    NOT NULL CHECK (marge_securite_pct >= 0),
    couv_min_mois       numeric(12,4)    NOT NULL CHECK (couv_min_mois >= 0),
    taux_perte_pct      numeric(9,4)    NOT NULL CHECK (taux_perte_pct >= 0),
    seuil_alerte_jours  integer NOT NULL CHECK (seuil_alerte_jours > 0),
    seuil_critique_jours integer NOT NULL CHECK (seuil_critique_jours > 0),
    seuil_tier1_mad     numeric(18,2)    NOT NULL CHECK (seuil_tier1_mad > 0),
    seuil_tier2_mad     numeric(18,2)    NOT NULL CHECK (seuil_tier2_mad > 0),
    seuil_tier3_mad     numeric(18,2)    NOT NULL CHECK (seuil_tier3_mad > 0),

    m2_total_annuel     numeric(18,4)    CHECK (m2_total_annuel IS NULL OR m2_total_annuel >= 0),
    id_utilisateur_creation     text REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_modification text REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_validation   text REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_cloture      text REFERENCES utilisateur(id_utilisateur),
    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    date_modification   text,
    date_validation     text,
    date_cloture        text,

    UNIQUE (annee, numero_version),
    CHECK (date_fin > date_debut),
    CHECK (seuil_critique_jours < seuil_alerte_jours),
    CHECK (seuil_tier3_mad < seuil_tier2_mad AND seuil_tier2_mad < seuil_tier1_mad),
    -- R08 : un plan VALIDE porte obligatoirement sa tracabilite de validation
    CHECK (statut <> 'EN_COURS' OR (date_validation IS NOT NULL AND id_utilisateur_validation IS NOT NULL)),
    CHECK (statut <> 'CLOTURE' OR date_cloture IS NOT NULL)
);

CREATE INDEX ix_plan_statut ON plan_production(statut, annee);

-- RG-10 : plusieurs scenarios peuvent coexister en brouillon ou en simulation,
-- mais UN SEUL plan est EN_COURS dans toute la base — pas un par annee.
--
-- Une periode glissante ne s'aligne plus sur l'annee civile : deux plans en
-- service, meme d'annees de depart differentes, chevaucheraient leurs mois et
-- v_besoin_12m sommerait leurs besoins sur les memes matieres. Le budget
-- d'achat doublerait sans que rien ne le signale.
--
-- L'expression constante 1 donne un index a une seule cle possible : c'est la
-- facon d'exprimer « au plus une ligne » en SQLite.
CREATE UNIQUE INDEX ux_plan_unique_en_cours
    ON plan_production ((true)) WHERE statut = 'EN_COURS';

-- -----------------------------------------------------------------------------
-- plan_qualite  (ex plan_recette — correction BL-4)
--
-- C'est l'ENTETE du plan : quelles QUALITES il produit, et sur quelle base
-- mensuelle. Depuis que la composition appartient a la qualite (une qualite =
-- une composition, pas de versionnement), il n'y a plus de version de recette a
-- figer : designer la qualite suffit, et sa composition est immuable des lors
-- qu'un plan actif s'en sert (trigger trg_recette_verrou_plan).
--
-- Une meme qualite ne peut figurer que dans UN plan actif a la fois : deux plans
-- non clotures produisant la meme qualite additionneraient leurs besoins sur les
-- memes matieres, et le plan d'achat commanderait deux fois. La regle est portee
-- par un trigger, une contrainte SQLite ne pouvant pas consulter une autre table.
-- -----------------------------------------------------------------------------
CREATE TABLE plan_qualite (
    id_plan             text    NOT NULL REFERENCES plan_production(id_plan) ON DELETE CASCADE,
    code_qualite        text    NOT NULL REFERENCES qualite(code_qualite),
    -- Base mensuelle avant saisonnalite et croissance (Production_Plan, col. B).
    m2_base_mensuel     numeric(18,4)    NOT NULL DEFAULT 0 CHECK (m2_base_mensuel >= 0),
    date_figee          text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    PRIMARY KEY (id_plan, code_qualite)
);

CREATE INDEX ix_plan_qualite_qualite ON plan_qualite(code_qualite);

-- -----------------------------------------------------------------------------
-- plan_saisonnalite
--
-- Grille 12 mois x qualite de la feuille Production_Plan (B10:S21). Le
-- coefficient module la base mensuelle selon le mois CALENDAIRE, independamment
-- du point de depart de la periode glissante : decembre reste un mois haut, que
-- le plan demarre en janvier ou en aout.
-- -----------------------------------------------------------------------------
CREATE TABLE plan_saisonnalite (
    id_plan             text    NOT NULL REFERENCES plan_production(id_plan) ON DELETE CASCADE,
    code_qualite        text    NOT NULL REFERENCES qualite(code_qualite),
    mois                integer NOT NULL CHECK (mois BETWEEN 1 AND 12),
    coefficient         numeric(9,4)    NOT NULL CHECK (coefficient >= 0),
    PRIMARY KEY (id_plan, code_qualite, mois)
);

-- -----------------------------------------------------------------------------
-- ligne_plan_production
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_plan_production (
    id_ligne_plan       text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    id_plan             text    NOT NULL REFERENCES plan_production(id_plan) ON DELETE CASCADE,
    -- `mois` reste le mois CALENDAIRE (1..12) : c'est lui qui porte la
    -- saisonnalite. `rang_mois` est la position dans la periode, et c'est LUI
    -- qui identifie la case — sans quoi un plan de trois ans ecraserait mai de
    -- l'an 1 avec mai de l'an 2.
    mois                integer NOT NULL CHECK (mois BETWEEN 1 AND 12),
    rang_mois           integer NOT NULL CHECK (rang_mois >= 0),
    annee_mois          text    NOT NULL,
    code_qualite        text    NOT NULL REFERENCES qualite(code_qualite),
    m2_prevus           numeric(18,4)    NOT NULL CHECK (m2_prevus >= 0),   -- valeur definitive, deja saisonnalisee
    m2_base_mensuel     numeric(18,4)    CHECK (m2_base_mensuel IS NULL OR m2_base_mensuel >= 0),
    saisonnalite        numeric(9,4)    CHECK (saisonnalite IS NULL OR saisonnalite >= 0),
    -- Facteur de croissance applique : (1 + croissance/100)^(rang/12).
    facteur_croissance  numeric(18,4)    CHECK (facteur_croissance IS NULL OR facteur_croissance >= 0),
    m2_revises          numeric(18,4)    CHECK (m2_revises IS NULL OR m2_revises >= 0),
    m2_realises         numeric(18,4)    CHECK (m2_realises IS NULL OR m2_realises >= 0),
    notes               text,
    UNIQUE (id_plan, rang_mois, code_qualite)
);

CREATE INDEX ix_ligne_plan_qualite ON ligne_plan_production(code_qualite);

-- -----------------------------------------------------------------------------
-- besoin_mrp  (resultat du calcul, table FIGEE par plan)
-- Alimentee par le service MRP (DELETE + INSERT dans une transaction).
-- -----------------------------------------------------------------------------
CREATE TABLE besoin_mrp (
    id_besoin           text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    id_plan             text    NOT NULL REFERENCES plan_production(id_plan) ON DELETE CASCADE,
    mois                integer NOT NULL CHECK (mois BETWEEN 1 AND 12),
    rang_mois           integer NOT NULL CHECK (rang_mois >= 0),
    annee_mois          text    NOT NULL,
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    quantite_brute_kg   numeric(18,4)    NOT NULL CHECK (quantite_brute_kg >= 0),
    taux_perte_applique numeric(9,4)    NOT NULL DEFAULT 0 CHECK (taux_perte_applique >= 0),
    quantite_kg         numeric(18,4)    NOT NULL CHECK (quantite_kg >= 0),   -- brute * (1 + perte)
    date_calcul         text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    date_reference      text    NOT NULL,                            -- P_DateRef du calcul (B1 glissant)
    -- BL-6 : garantit l'idempotence du recalcul MRP. La cle porte sur le RANG,
    -- pas sur le mois calendaire : un plan pluriannuel a plusieurs « mai ».
    UNIQUE (id_plan, rang_mois, code_reference)
);

CREATE INDEX ix_besoin_mrp_ref  ON besoin_mrp(code_reference);
CREATE INDEX ix_besoin_mrp_plan ON besoin_mrp(id_plan, mois);

-- -----------------------------------------------------------------------------
-- snapshot_mrp  (photo figee a la validation d'un plan, B1)
-- -----------------------------------------------------------------------------
CREATE TABLE snapshot_mrp (
    id_snapshot         text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    date_snapshot       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_plan             text    NOT NULL REFERENCES plan_production(id_plan),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    mois                integer NOT NULL CHECK (mois BETWEEN 1 AND 12),
    rang_mois           integer NOT NULL DEFAULT 0 CHECK (rang_mois >= 0),
    annee_mois          text,
    quantite_besoin_kg  numeric(18,4)    NOT NULL,
    stock_projete_kg    numeric(18,4),
    statut_couleur      text    CHECK (statut_couleur IS NULL OR statut_couleur IN ('RUPTURE','CRITIQUE','ATTENTION','OK')),
    donnees_json        text    CHECK (donnees_json IS NULL OR (donnees_json)::jsonb IS NOT NULL),
    UNIQUE (date_snapshot, id_plan, code_reference, rang_mois)
);
