-- ===========================================================================
-- LE BON DE COMMANDE TEL QUE LE FOURNISSEUR LE LIT
--
-- 109 bons de commande tenus sous Excel de decembre 2020 a septembre 2026 ont
-- ete depouilles. Ils disent trois choses que l'ERP ne savait pas.
--
-- 1. LE FOURNISSEUR PRODUIT AU LOT. Sur 110 lignes mesurees, le lot vaut
--    1344 bobines dans 58 cas, 1720 dans 15, 1400 dans 10, 1688 dans 8, et
--    quelques autres valeurs. Ce n'est donc PAS une constante de la maison :
--    c'est un parametre de l'article, exactement comme le nombre de bobines
--    par palette. D'ou `bobines_par_lot` sur la reference, et « Lot » parmi
--    les unites de saisie.
--
-- 2. LE DOCUMENT EST EN ANGLAIS, ET IL NE PORTE PAS NOTRE CODE. La colonne du
--    fournisseur s'appelle « DESCRIPTION OF GOODS » et contient
--    « 100% POLYPROPYLENE YARN 2900 DTEX ». Notre `PP FRZ-2900 Dtex-Gold
--    3423-Hs` ne lui dit rien. D'ou `description_commerciale`.
--
-- 3. LA LOGISTIQUE SE COMPTE EN CONTENEURS. 71 bons sur 109 portent
--    « NBR OF CONTAINERS ». C'est ce chiffre qui commande l'expedition et le
--    cout au debarquement, et il se deduit des palettes — d'ou
--    `palettes_par_conteneur` sur le fournisseur, et un nombre de conteneurs
--    sur le bon qu'on peut forcer quand le transitaire en decide autrement.
--
-- CE QUI N'EST PAS ICI : le prix. Sur 109 bons, un mot de prix apparait sur
-- cinq, et deux fois c'est « OLD PRICE ». Le bon de commande de la maison est
-- un document de QUANTITES. La sortie destinee au fournisseur n'imprimera donc
-- aucun montant — mais cela se regle a l'impression, pas dans le schema.
-- ===========================================================================

BEGIN;

-- --- 1. Le lot, et la description que le fournisseur lit ---------------------
ALTER TABLE reference ADD COLUMN IF NOT EXISTS bobines_par_lot bigint;
ALTER TABLE reference DROP CONSTRAINT IF EXISTS reference_bobines_par_lot_check;
ALTER TABLE reference
    ADD CONSTRAINT reference_bobines_par_lot_check
    CHECK (bobines_par_lot IS NULL OR bobines_par_lot > 0);

-- La description commerciale, en anglais, telle qu'elle part au fournisseur.
ALTER TABLE reference ADD COLUMN IF NOT EXISTS description_commerciale text;

-- --- 2. « Lot » entre dans les unites ----------------------------------------
-- L'ORDRE COMPTE : on elargit la contrainte AVANT de toucher aux colonnes
-- generees, sinon une ligne en « Lot » serait refusee entre les deux.
ALTER TABLE reference DROP CONSTRAINT IF EXISTS reference_unite_catalogue_check;
ALTER TABLE reference
    ADD CONSTRAINT reference_unite_catalogue_check
    CHECK (unite_catalogue IN ('kg', 'Palette', 'Bobine', 'ml', 'Lot'));

-- Une reference vendue au lot doit porter de quoi convertir, comme la palette.
ALTER TABLE reference DROP CONSTRAINT IF EXISTS reference_lot_convertible;
ALTER TABLE reference
    ADD CONSTRAINT reference_lot_convertible
    CHECK (unite_catalogue <> 'Lot'
        OR (poids_bobine_kg IS NOT NULL AND bobines_par_lot IS NOT NULL));

-- LES COLONNES GENEREES SE REECRIVENT, elles ne se completent pas. PostgreSQL
-- 17 a introduit `SET EXPRESSION`, qui recalcule toute la table d'un coup ;
-- avant, il fallait supprimer la colonne et la reposer, en perdant sa place
-- dans l'ordre des colonnes et tout ce qui la referencait.
ALTER TABLE reference ALTER COLUMN facteur_kg SET EXPRESSION AS (
    CASE unite_catalogue
        WHEN 'kg'      THEN 1.0
        WHEN 'Bobine'  THEN poids_bobine_kg
        WHEN 'Palette' THEN poids_bobine_kg * bobines_par_palette
        WHEN 'Lot'     THEN poids_bobine_kg * bobines_par_lot
        WHEN 'ml'      THEN densite_kg_ml
    END);

ALTER TABLE reference ALTER COLUMN prix_catalogue_kg SET EXPRESSION AS (
    prix_catalogue / CASE unite_catalogue
        WHEN 'kg'      THEN 1.0
        WHEN 'Bobine'  THEN poids_bobine_kg
        WHEN 'Palette' THEN poids_bobine_kg * bobines_par_palette
        WHEN 'Lot'     THEN poids_bobine_kg * bobines_par_lot
        WHEN 'ml'      THEN densite_kg_ml
    END);

-- Les cinq tables qui enumerent les unites de saisie. Le mouvement, le
-- transfert et l'inventaire restent en kg/palette/bobine/ml : on ne DEPLACE
-- pas un lot, c'est une unite d'ACHAT — le lot arrive, il ne circule pas.
ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_unite_commande_check;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_unite_commande_check
    CHECK (unite_commande IN ('kg', 'Palette', 'Bobine', 'ml', 'Lot',
                              'Forfait', 'Unite', 'Heure'));

-- La reception, elle, doit pouvoir peser ce qui a ete commande au lot.
ALTER TABLE ligne_reception DROP CONSTRAINT IF EXISTS ligne_reception_unite_saisie_check;
ALTER TABLE ligne_reception
    ADD CONSTRAINT ligne_reception_unite_saisie_check
    CHECK (unite_saisie IN ('kg', 'Palette', 'Bobine', 'ml', 'Lot'));

ALTER TABLE plan_achat DROP CONSTRAINT IF EXISTS plan_achat_unite_saisie_check;
ALTER TABLE plan_achat
    ADD CONSTRAINT plan_achat_unite_saisie_check
    CHECK (unite_saisie IS NULL
        OR unite_saisie IN ('kg', 'Palette', 'Bobine', 'ml', 'Lot'));

-- --- 3. La logistique -------------------------------------------------------
ALTER TABLE fournisseur ADD COLUMN IF NOT EXISTS palettes_par_conteneur bigint;
ALTER TABLE fournisseur DROP CONSTRAINT IF EXISTS fournisseur_palettes_par_conteneur_check;
ALTER TABLE fournisseur
    ADD CONSTRAINT fournisseur_palettes_par_conteneur_check
    CHECK (palettes_par_conteneur IS NULL OR palettes_par_conteneur > 0);

-- Le nombre de conteneurs se DEDUIT des palettes, mais il se force : c'est le
-- transitaire qui a le dernier mot, et un bon annonce parfois un conteneur de
-- plus pour une expedition partagee. NULL veut dire « prends le calcul ».
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS nombre_conteneurs bigint;
ALTER TABLE bon_commande DROP CONSTRAINT IF EXISTS bon_commande_nombre_conteneurs_check;
ALTER TABLE bon_commande
    ADD CONSTRAINT bon_commande_nombre_conteneurs_check
    CHECK (nombre_conteneurs IS NULL OR nombre_conteneurs > 0);

-- « SHIPMENT DATE : As soon as possible ». Dix-neuf bons portent une PHRASE la
-- ou l'ERP attend une date. Les deux coexistent : `date_livraison_prevue`
-- pilote le suivi de l'en-cours, cette mention part sur le document.
ALTER TABLE bon_commande ADD COLUMN IF NOT EXISTS mention_expedition text;

-- --- 4. Les droits ----------------------------------------------------------
-- UN CHAMP NON DECLARE EST MASQUE POUR TOUT LE MONDE. Sans ces trois blocs, les
-- colonnes ci-dessus existeraient en base et seraient absentes de toutes les
-- reponses — la conversion au lot echouerait sans un mot d'explication.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('CATALOGUE','bobines_par_lot',        'Bobines par lot',           'ECRITURE', 0, 3010),
 ('CATALOGUE','description_commerciale','Description commerciale',   'ECRITURE', 0, 3020),
 ('FOURNISSEURS','palettes_par_conteneur','Palettes par conteneur',  'ECRITURE', 0, 3030),
 ('BONS_COMMANDE','bobines_par_lot',    'Bobines par lot',           'LECTURE',  0, 3040),
 ('BONS_COMMANDE','description_commerciale','Description commerciale','LECTURE', 0, 3050),
 ('BONS_COMMANDE','nombre_conteneurs',  'Nombre de conteneurs',      'ECRITURE', 0, 3060),
 ('BONS_COMMANDE','mention_expedition', 'Mention d''expedition',     'ECRITURE', 0, 3070),
 ('STOCK','bobines_par_lot',            'Bobines par lot',           'LECTURE',  0, 3080),
 -- Lus depuis la fiche fournisseur et imprimes sur le document : sans
 -- declaration ici, ils n'arriveraient jamais a l'ecran du bon.
 ('BONS_COMMANDE','incoterm',           'Incoterm',                  'LECTURE',  0, 3090),
 ('BONS_COMMANDE','tolerance_pesee_pct','Tolerance de pesee (%)',    'LECTURE',  0, 3100),
 ('BONS_COMMANDE','palettes_par_conteneur','Palettes par conteneur', 'LECTURE',  0, 3110),
 -- Le titrage du document fournisseur — « 2900-DTEX » — est chez nous la famille.
 ('BONS_COMMANDE','code_famille',       'Famille (titrage)',         'LECTURE',  0, 3120)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

-- LES HUIT COUPLES SE NOMMENT, ON NE LES ATTRAPE PAS PAR UNE PLAGE DE `ordre`.
-- Le rang est un ordre d'AFFICHAGE, propre a chaque module : 3010 a 3080 est
-- deja occupe par huit champs du module Mouvements. Une distribution de droits
-- par plage les aurait emportes avec les miens, et aurait pu accorder un droit
-- que quelqu'un avait deliberement retire.
CREATE TEMP TABLE champs_neufs (module text, champ text) ON COMMIT DROP;
INSERT INTO champs_neufs VALUES
 ('CATALOGUE','bobines_par_lot'), ('CATALOGUE','description_commerciale'),
 ('FOURNISSEURS','palettes_par_conteneur'),
 ('BONS_COMMANDE','bobines_par_lot'), ('BONS_COMMANDE','description_commerciale'),
 ('BONS_COMMANDE','nombre_conteneurs'), ('BONS_COMMANDE','mention_expedition'),
 ('STOCK','bobines_par_lot'),
 ('BONS_COMMANDE','incoterm'),
 ('BONS_COMMANDE','tolerance_pesee_pct'), ('BONS_COMMANDE','palettes_par_conteneur'), ('BONS_COMMANDE','code_famille');

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
  JOIN champs_neufs n ON n.module = c.module AND n.champ = c.champ
 WHERE r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champs_neufs n ON n.module = m.module AND n.champ = m.champ
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- --- 5. Ce que les archives nous ont appris ---------------------------------
-- Le lot dominant est de 1344 bobines : 58 lignes sur 110, chez HASIRCI,
-- OZKARALAR et TURKAN, et il correspond a 6 palettes de 224 bobines. On ne le
-- pose sur AUCUNE reference : le lot varie d'un article a l'autre chez le meme
-- fournisseur, et une valeur posee d'office se retrouverait sur un bon sans
-- que personne ne l'ait voulue. L'acheteur le renseigne article par article.

COMMIT;
