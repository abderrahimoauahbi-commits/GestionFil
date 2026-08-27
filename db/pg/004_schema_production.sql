-- =============================================================================
-- Module 4 : PRODUCTION (Qualites & Recettes / BOM)
-- =============================================================================
-- CORRECTION MAJEURE (BL-2 / BL-3 de l'analyse) :
--
--   Le CDC clefait `ligne_qualite` sur (code_qualite, code_categorie) alors que
--   E3 definit les densites PAR ROLE BOM. C'est structurellement impossible :
--   dans la qualite SH, la categorie Polyester apparait dans le role Poil
--   (densite 1.760) ET dans le role Chaine (densite 0.235). Une cle sur la
--   categorie exigerait deux valeurs pour la meme ligne.
--   -> la cle devient (code_qualite, code_role).
--
--   Le CDC ne portait par ailleurs aucun discriminant d'unite de densite, alors
--   que E3 impose une formule differente pour les roles en ml/m2 (Cuir, Ruban) :
--       kg_m2 = (% / 100) * densite_role_ml * densite_kg_ml_reference
--   -> ajout de ligne_qualite.unite_densite.
--
--   Verification : SH = 1.760 + 0.520 + 0.235 + 0.200 + 0.030 = 2.745 ~ 2.76
--   (poids commercial A4). Les roles en ml/m2 sont bien hors poids commercial
--   mais consomment de la matiere : ils doivent entrer dans le MRP.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- qualite
-- Parametres LOCAUX embarques a la creation (CDC B3 / R09).
-- -----------------------------------------------------------------------------
CREATE TABLE qualite (
    code_qualite        text    NOT NULL PRIMARY KEY,
    nom                 text    NOT NULL,
    description         text,
    poids_commercial_m2 numeric(18,4)    NOT NULL DEFAULT 0 CHECK (poids_commercial_m2 >= 0),

    -- Cycle de vie. `actif` en derive : deux colonnes independantes finiraient
    -- par diverger, et les vues filtrent toutes sur `actif`.
    statut              text    NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON','ACTIF','CLOTURE')),
    actif               integer GENERATED ALWAYS AS
                                (CASE WHEN statut = 'CLOTURE' THEN 0 ELSE 1 END) STORED,

    -- Snapshot des parametres globaux au moment de la creation
    marge_securite_pct  numeric(9,4)    NOT NULL CHECK (marge_securite_pct >= 0),
    couv_min_mois       numeric(12,4)    NOT NULL CHECK (couv_min_mois >= 0),
    taux_perte_pct      numeric(9,4)    NOT NULL CHECK (taux_perte_pct >= 0),
    seuil_alerte_jours  integer NOT NULL CHECK (seuil_alerte_jours > 0),
    seuil_critique_jours integer NOT NULL CHECK (seuil_critique_jours > 0),
    stock_securite_jours integer NOT NULL CHECK (stock_securite_jours >= 0),

    date_creation       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    date_modification   text,
    date_cloture        text,
    id_utilisateur_creation   text REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_modification text REFERENCES utilisateur(id_utilisateur),
    id_utilisateur_cloture    text REFERENCES utilisateur(id_utilisateur),

    CHECK (seuil_critique_jours < seuil_alerte_jours),
    -- RG-03 : une qualite cloturee porte obligatoirement sa date de cloture
    CHECK ((statut <> 'CLOTURE' AND date_cloture IS NULL)
        OR (statut  = 'CLOTURE' AND date_cloture IS NOT NULL))
);

-- -----------------------------------------------------------------------------
-- ligne_qualite  : densite par ROLE BOM
-- -----------------------------------------------------------------------------
CREATE TABLE ligne_qualite (
    id_ligne_qualite    text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_qualite        text    NOT NULL REFERENCES qualite(code_qualite) ON DELETE CASCADE,
    code_role           text    NOT NULL REFERENCES role_bom(code_role),
    densite             numeric(18,4)    NOT NULL CHECK (densite >= 0),
    unite_densite       text    NOT NULL DEFAULT 'kg_m2' CHECK (unite_densite IN ('kg_m2','ml_m2')),
    -- Un role en ml/m2 ne contribue pas au poids commercial du tapis
    entre_poids_commercial smallint NOT NULL DEFAULT 1 CHECK (entre_poids_commercial IN (0,1)),
    observation         text,
    ordre_affichage     integer NOT NULL DEFAULT 0,
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    UNIQUE (code_qualite, code_role),
    CHECK (unite_densite = 'kg_m2' OR entre_poids_commercial = 0)
);

-- -----------------------------------------------------------------------------
-- recette : LIGNES DE COMPOSITION d'une qualite
--
-- Une qualite = une composition, point. Pas de versionnement : si la
-- composition change, on cree une NOUVELLE qualite (SH1, SH2, SH3...). Le
-- modele precedent — recette versionnee avec statut, clonage V+1 et journal de
-- versions — decrivait un cycle de vie que l'atelier n'a pas : sur place, une
-- composition differente EST un article different.
--
-- La qualite porte donc l'entete (code, nom, poids, parametres, statut), et
-- cette table ses lignes. Le cycle de vie de la composition est celui de la
-- qualite : c'est le passage de la qualite a ACTIF qui controle R07.
--
-- CORRECTIONS CDC conservees :
--  * code_groupe_equiv en TEXT (le CDC le declarait UUID vers une cle texte) ;
--  * kg_m2 n'est pas stocke : il derive de (densite du role, %, densite kg/ml)
--    et vit dans la vue v_recette_calculee, sans risque de derive ;
--  * borne superieure sur le pourcentage.
-- -----------------------------------------------------------------------------
CREATE TABLE recette (
    id_recette          text    NOT NULL PRIMARY KEY
                                DEFAULT gen_random_uuid()::text,
    code_qualite        text    NOT NULL REFERENCES qualite(code_qualite) ON DELETE CASCADE,
    ligne_numero        integer NOT NULL CHECK (ligne_numero > 0),
    code_reference      text    NOT NULL REFERENCES reference(code_reference),
    code_role           text    NOT NULL REFERENCES role_bom(code_role),
    code_groupe_equiv   text    REFERENCES groupe_equiv(code_groupe_equiv),
    pourcentage_composition numeric(9,4) NOT NULL CHECK (pourcentage_composition > 0 AND pourcentage_composition <= 100),
    type_composant      text,
    couleur             text,
    code_fournisseur_prefere text REFERENCES fournisseur(code_fournisseur),
    actif               smallint NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),
    UNIQUE (code_qualite, ligne_numero),
    -- Une meme matiere ne figure qu'UNE FOIS dans une qualite, tous roles
    -- confondus. Deux lignes portant la meme reference additionneraient leurs
    -- pourcentages sur la meme matiere sans qu'on sache laquelle corriger, et le
    -- besoin MRP resterait juste tout en rendant la composition illisible.
    UNIQUE (code_qualite, code_reference)
);

CREATE INDEX ix_recette_qualite ON recette(code_qualite);
CREATE INDEX ix_recette_ref     ON recette(code_reference);
CREATE INDEX ix_recette_role    ON recette(code_qualite, code_role);
