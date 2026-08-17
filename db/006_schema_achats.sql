-- =============================================================================
-- Module 6 : ACHATS (Plan d'achat, Bons de commande, Historique prix)
-- =============================================================================
-- CORRECTIONS MAJEURES :
--
--  * BL-7 : `bon_commande` ne portait NI id_utilisateur_validation NI
--    date_validation, alors que B4 regle 4 exige "Createur BC <> Valideur BC".
--    La regle SoD la plus importante du CDC etait techniquement inapplicable.
--    -> colonnes ajoutees + CHECK d'exclusion mutuelle.
--
--  * Melange d'unites : `ligne_bc` n'avait aucune colonne d'unite. Le trigger J4
--    faisait `quantite_recue = quantite_recue + quantite_stock_kg`, additionnant
--    des kg a des palettes, et la colonne generee `quantite_restante` devenait
--    fausse. -> unite explicite + facteur de conversion FIGE sur la ligne +
--    quantites tenues en kg (unite canonique R01).
--
--  * Le facteur de conversion est copie sur la ligne (et non lu dans le
--    catalogue) : si le conditionnement fournisseur change, les BC passes
--    restent reconstituables (B1 : historique fige).
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- bon_commande
-- -----------------------------------------------------------------------------
CREATE TABLE bon_commande (
    id_bc               TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    numero_bc           TEXT    NOT NULL UNIQUE,
    date_bc             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    code_fournisseur    TEXT    NOT NULL REFERENCES fournisseur(code_fournisseur),
    code_devise         TEXT    NOT NULL REFERENCES devise(code_devise),
    -- RG-09 : taux fige a la date de VALIDATION du BC
    taux_change_engage  REAL    NOT NULL CHECK (taux_change_engage > 0),
    date_taux_engage    TEXT,

    montant_total_devise REAL   CHECK (montant_total_devise IS NULL OR montant_total_devise >= 0),
    montant_total_mad   REAL    CHECK (montant_total_mad IS NULL OR montant_total_mad >= 0),

    statut              TEXT    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','EN_ATTENTE_VALIDATION','VALIDE','ENVOYE','LIVRE_PARTIEL','CLOTURE','ANNULE')),
    motif_creation      TEXT    NOT NULL DEFAULT 'MRP'
                                CHECK (motif_creation IN ('MRP','OPPORTUNITE_PRIX','ANTICIPATION_RISQUE','MANUEL')),

    date_envoi          TEXT,
    date_livraison_prevue TEXT,
    conditions_paiement TEXT,
    notes               TEXT,

    id_utilisateur_creation   TEXT NOT NULL REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_validation TEXT REFERENCES utilisateur(id_utilisateur),
    date_creation       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    date_validation     TEXT,

    -- B4 regle 4 : impossible de valider un BC que l'on a cree soi-meme
    CHECK (id_utilisateur_validation IS NULL
           OR id_utilisateur_validation <> id_utilisateur_creation),
    -- Un BC au-dela de BROUILLON/EN_ATTENTE est necessairement valide et trace
    CHECK (statut IN ('BROUILLON','EN_ATTENTE_VALIDATION','ANNULE')
           OR (id_utilisateur_validation IS NOT NULL AND date_validation IS NOT NULL))
) STRICT;

CREATE INDEX ix_bc_fournisseur ON bon_commande(code_fournisseur, statut);
CREATE INDEX ix_bc_statut      ON bon_commande(statut, date_bc DESC);

-- -----------------------------------------------------------------------------
-- ligne_bc
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_bc (
    id_ligne_bc         TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    id_bc               TEXT    NOT NULL REFERENCES bon_commande(id_bc) ON DELETE CASCADE,
    ligne_numero        INTEGER NOT NULL CHECK (ligne_numero > 0),
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),
    designation         TEXT,

    -- Unite de commande + facteur FIGE (jamais relu du catalogue)
    unite_commande      TEXT    NOT NULL CHECK (unite_commande IN ('kg','Palette','Bobine','ml')),
    facteur_kg          REAL    NOT NULL CHECK (facteur_kg > 0),
    quantite_commandee_unite REAL NOT NULL CHECK (quantite_commandee_unite > 0),
    quantite_commandee_kg    REAL NOT NULL CHECK (quantite_commandee_kg > 0),
    quantite_recue_kg   REAL    NOT NULL DEFAULT 0 CHECK (quantite_recue_kg >= 0),
    quantite_restante_kg REAL   GENERATED ALWAYS AS (quantite_commandee_kg - quantite_recue_kg) VIRTUAL,

    -- Prix : saisi par unite de commande, ramene au kg (unite canonique)
    prix_unitaire_devise REAL   NOT NULL CHECK (prix_unitaire_devise > 0),
    prix_kg_devise      REAL    GENERATED ALWAYS AS (prix_unitaire_devise / facteur_kg) VIRTUAL,
    code_devise         TEXT    NOT NULL REFERENCES devise(code_devise),
    total_ligne_devise  REAL    GENERATED ALWAYS AS (quantite_commandee_unite * prix_unitaire_devise) VIRTUAL,

    date_livraison_prevue TEXT,
    statut              TEXT    NOT NULL DEFAULT 'EN_ATTENTE'
                                CHECK (statut IN ('EN_ATTENTE','PARTIEL','SOLDE','ANNULE')),
    notes               TEXT,

    -- La proposition d'ou vient la ligne. Le lien est porte ICI, au niveau de la
    -- LIGNE, et non par le bon : une ligne annulee doit liberer sa proposition
    -- meme si le reste du bon tient toujours. Rattache au bon entier, annuler
    -- une seule ligne aurait laisse la reference bloquee en COMMANDE, invisible
    -- pour le MRP, sans qu'aucune commande ne la couvre.
    id_proposition      TEXT    REFERENCES plan_achat(id_proposition),

    -- Le besoin qui a JUSTIFIE cette ligne, fige au moment de la conversion de
    -- la proposition d'achat. NULL sur une ligne saisie a la main.
    --
    -- On stocke la valeur, pas une reference : le besoin actuel se lit dans la
    -- vue, et l'ecart se calcule a l'affichage. Un message d'exception stocke
    -- serait juste jusqu'au prochain recalcul, puis mentirait sans le dire.
    besoin_kg_origine   REAL    CHECK (besoin_kg_origine IS NULL OR besoin_kg_origine >= 0),

    -- Verrou de ligne. Une ligne issue du plan et jamais retouchee suit le plan ;
    -- des que l'acheteur y touche — quantite, prix, date — elle passe a 1 et le
    -- recalcul ne la realigne plus, il se contente d'alerter. Sans ce drapeau,
    -- soit on ecrase un prix negocie, soit on laisse vieillir en silence les
    -- lignes que personne n'a arbitrees.
    arbitree            INTEGER NOT NULL DEFAULT 0 CHECK (arbitree IN (0,1)),

    UNIQUE (id_bc, ligne_numero),
    -- Coherence de la conversion (tolerance d'arrondi au gramme)
    CHECK (abs(quantite_commandee_kg - quantite_commandee_unite * facteur_kg) < 0.001),
    -- On ne peut pas recevoir plus que commande sans avenant
    CHECK (quantite_recue_kg <= quantite_commandee_kg + 0.001)
) STRICT;

CREATE INDEX ix_ligne_bc_ref ON ligne_bc(code_reference);
CREATE INDEX ix_ligne_bc_bc  ON ligne_bc(id_bc);

-- -----------------------------------------------------------------------------
-- plan_achat  (propositions issues du MRP)
--
-- source_prix : rend EXPLICITE le repli sur le prix catalogue quand aucun achat
-- reel n'existe encore. RG-08 interdit le fallback silencieux sur le CMUP ; le
-- KPI "budget a engager" est neanmoins requis des le go-live (valorisation a 0).
-- Arbitrage ADR-001 D-02 : repli autorise mais TRACE ligne par ligne.
-- -----------------------------------------------------------------------------
CREATE TABLE plan_achat (
    id_proposition      TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    date_generation     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    id_plan             TEXT    REFERENCES plan_production(id_plan),
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),

    quantite_suggeree_kg REAL   NOT NULL CHECK (quantite_suggeree_kg > 0),
    unite_saisie        TEXT    CHECK (unite_saisie IS NULL OR unite_saisie IN ('kg','Palette','Bobine','ml')),
    quantite_suggeree_unite REAL,

    code_fournisseur    TEXT    NOT NULL REFERENCES fournisseur(code_fournisseur),
    prix_estime_mad     REAL    NOT NULL CHECK (prix_estime_mad > 0),
    source_prix         TEXT    NOT NULL CHECK (source_prix IN ('CMUP','CATALOGUE','NEGOCIE')),
    montant_total_mad   REAL    GENERATED ALWAYS AS (quantite_suggeree_kg * prix_estime_mad) VIRTUAL,

    date_besoin_prevue  TEXT    NOT NULL,
    urgence             TEXT    NOT NULL CHECK (urgence IN ('TIER 1','TIER 2','TIER 3','TIER 4')),
    risque_identifie    TEXT,
    action_recommandee  TEXT,

    statut              TEXT    NOT NULL DEFAULT 'PROPOSE'
                                CHECK (statut IN ('PROPOSE','EN_REVISION','VALIDE','COMMANDE','IGNORE')),
    id_bc_genere        TEXT    REFERENCES bon_commande(id_bc),
    id_utilisateur_validation TEXT REFERENCES utilisateur(id_utilisateur),
    date_validation     TEXT,
    commentaires        TEXT,

    -- Arbitrage sur une reference EQUIVALENTE. Le MRP a calcule un besoin sur
    -- une reference ; l'acheteur peut decider de le couvrir par un substitut du
    -- meme groupe — parce qu'il est en stock, moins cher, ou plus rapide.
    --
    -- L'origine est conservee : sans elle, la proposition ne se rattacherait
    -- plus au besoin qui l'a fait naitre, et le lien entre le plan de
    -- production et l'achat serait rompu sans que rien ne le signale.
    code_reference_origine TEXT REFERENCES reference(code_reference),
    motif_substitution     TEXT,

    -- FIGEMENT (« firming »). Une proposition retouchee a la main porte une
    -- decision que le calcul ignore : un arrondi a la palette complete, un lot
    -- minimum non declare, un prix negocie, un camion a remplir. Sans ce
    -- drapeau, la purge du recalcul detruisait ce travail — la proposition
    -- passait en EN_REVISION, et EN_REVISION etait precisement ce que la purge
    -- supprimait.
    --
    -- Figer ne fige que la PROPOSITION, pas le besoin : le calcul continue de
    -- dire ce qu'il faudrait acheter, et l'ecart entre les deux se lit a tout
    -- moment. C'est ce qui distingue une ligne protegee d'une ligne aveugle.
    figee               INTEGER NOT NULL DEFAULT 0 CHECK (figee IN (0,1)),
    id_utilisateur_figement TEXT REFERENCES utilisateur(id_utilisateur),
    date_figement       TEXT,
    motif_figement      TEXT    CHECK (motif_figement IS NULL OR motif_figement IN
                                ('PRIX_NEGOCIE','QUANTITE_AJUSTEE','LIVRAISON_GROUPEE',
                                 'DELAI_FOURNISSEUR','AUTRE')),

    -- Ce que le MRP proposait a l'instant du figement. Conserve pour que
    -- l'ecart affiche plus tard se lise comme une decision (« arrondi de 62 633
    -- a 63 000 ») et non comme une derive inexpliquee.
    quantite_mrp_kg     REAL    CHECK (quantite_mrp_kg IS NULL OR quantite_mrp_kg > 0),

    CHECK (code_reference_origine IS NULL OR code_reference_origine <> code_reference)
) STRICT;

-- Une ligne figee doit dire PAR QUI et QUAND : un verrou anonyme se retourne
-- contre son auteur le jour ou il faut en repondre.
CREATE TRIGGER trg_plan_achat_figement_trace
BEFORE UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN NEW.figee = 1
 AND (NEW.id_utilisateur_figement IS NULL OR NEW.date_figement IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'Figement refuse : une proposition figee doit porter son auteur et sa date.');
END;

-- Une proposition deja engagee ou ecartee n'a plus rien a proteger : la figer
-- laisserait croire a un arbitrage encore ouvert.
CREATE TRIGGER trg_plan_achat_figement_statut
BEFORE UPDATE OF figee ON plan_achat FOR EACH ROW
WHEN NEW.figee = 1 AND NEW.statut IN ('COMMANDE','IGNORE')
BEGIN
    SELECT RAISE(ABORT, 'Figement refuse : cette proposition est deja commandee ou ecartee.');
END;

CREATE INDEX ix_plan_achat_fournisseur ON plan_achat(code_fournisseur);
CREATE INDEX ix_plan_achat_statut      ON plan_achat(statut, urgence);
CREATE INDEX ix_plan_achat_ref         ON plan_achat(code_reference);
-- Une seule proposition ouverte par reference et par generation
CREATE UNIQUE INDEX ux_plan_achat_ouvert
    ON plan_achat(code_reference) WHERE statut IN ('PROPOSE','EN_REVISION','VALIDE');

-- -----------------------------------------------------------------------------
-- historique_prix  (traçabilite des prix REELLEMENT payes, base du CMUP RG-08)
-- TABLE IMMUABLE (R03) : cf. trg_histo_prix_immuable.
-- -----------------------------------------------------------------------------
CREATE TABLE historique_prix (
    id_histo_prix       TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    id_ligne_reception  TEXT    NOT NULL UNIQUE,
    code_reference      TEXT    NOT NULL REFERENCES reference(code_reference),
    code_fournisseur    TEXT    NOT NULL REFERENCES fournisseur(code_fournisseur),
    date_achat          TEXT    NOT NULL,

    -- BL-5 : le CDC utilisait le meme nombre une fois comme MAD (CMUP) et une
    -- fois comme devise etrangere (historique) -> CMUP faux d'un facteur ~9,5
    -- sur les achats USD. Les deux grandeurs sont ici distinctes et le lien
    -- entre elles est contraint.
    prix_kg_devise      REAL    NOT NULL CHECK (prix_kg_devise > 0),
    code_devise         TEXT    NOT NULL REFERENCES devise(code_devise),
    taux_change         REAL    NOT NULL CHECK (taux_change > 0),
    prix_kg_mad         REAL    NOT NULL CHECK (prix_kg_mad > 0),

    quantite_achetee_kg REAL    NOT NULL CHECK (quantite_achetee_kg > 0),
    total_mad           REAL    NOT NULL CHECK (total_mad > 0),
    conditions          TEXT,
    date_enregistrement TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

    -- Coherence de la conversion : prix_mad = prix_devise x taux
    CHECK (abs(prix_kg_mad - prix_kg_devise * taux_change) < 0.01),
    CHECK (abs(total_mad - prix_kg_mad * quantite_achetee_kg) < 0.05)
) STRICT;

CREATE INDEX ix_histo_prix_ref  ON historique_prix(code_reference, date_achat DESC);
CREATE INDEX ix_histo_prix_four ON historique_prix(code_fournisseur, date_achat DESC);
