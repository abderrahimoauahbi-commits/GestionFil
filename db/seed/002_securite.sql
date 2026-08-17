-- =============================================================================
-- SEED 2 : SECURITE
--   roles, matrice RBAC (CDC D2), catalogue des champs configurables,
--   modeles de droits par role, comptes de demarrage et leurs grilles.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Roles  (CDC D1)
-- plafond_validation_bc_mad implemente B4 regle 3 :
--   < 100k MAD  -> acheteur    |    >= 300k MAD -> Direction obligatoire
-- -----------------------------------------------------------------------------
INSERT INTO role_utilisateur (code_role_user, libelle, description, niveau_hierarchique, plafond_validation_bc_mad) VALUES
    ('DIRECTION','Direction Generale', 'Validation strategique, arbitrage financier, KPI', 100, NULL),
    ('DAF',      'Comptable / DAF',    'Valorisation, CMUP, audit des ecarts',              80, 300000),
    ('ACHAT',    'Acheteur',           'Negociation, BC, suivi livraisons, OTIF',           60, 100000),
    ('PLANIF',   'Planificateur',      'Plans de production, MRP, recettes',                60, NULL),
    ('QUALITE',  'Controleur Qualite', 'Validation des receptions, quarantaine',            50, NULL),
    ('MAGASIN',  'Magasinier',         'Pesees, mouvements, inventaires, transferts',       40, NULL);

-- =============================================================================
-- 1. ACCES MODULE  (matrice CDC D2)
-- =============================================================================
CREATE TEMP TABLE _matrice (
    module    TEXT,
    DIRECTION TEXT, PLANIF TEXT, ACHAT TEXT, MAGASIN TEXT, QUALITE TEXT, DAF TEXT
);

-- La DIRECTION dispose de TOUS les droits sur TOUS les modules : c'est une
-- decision explicite de l'entreprise, prise contre l'avis par defaut du CDC D2
-- qui la laissait en lecture sur le MRP, le plan d'achat, les receptions, les
-- mouvements, le stock, la valorisation et l'audit.
--
-- Ce que cela NE leve PAS : les separations portees par les triggers, qui
-- comparent des UTILISATEURS et non des roles — le createur d'un BC ne peut
-- toujours pas le valider lui-meme (B4-4), et le peseur d'une reception ne peut
-- toujours pas la controler. Aucune permission ne contourne ces gardes.
INSERT INTO _matrice (module, DIRECTION, PLANIF, ACHAT, MAGASIN, QUALITE, DAF) VALUES
    ('PARAMETRES',    'RW', 'R',  'R',  'R',  'R',  'R' ),
    ('FOURNISSEURS',  'RW', 'R',  'RW', 'R',  'R',  'R' ),
    ('CATALOGUE',     'RW', 'RW', 'R',  'R',  'R',  'R' ),
    ('QUALITES',      'RW', 'RW', 'R',  'R',  'R',  'R' ),
    ('RECETTES',      'RW', 'RW', 'R',  'R',  'R',  'R' ),
    ('PLANS',         'RW', 'RW', 'R',  'R',  'R',  'R' ),
    ('MRP',           'RW', 'RW', 'R',  'R',  'R',  'R' ),
    ('PLAN_ACHAT',    'RW', 'R',  'RW', 'R',  'R',  'R' ),
    ('BONS_COMMANDE', 'RW', 'R',  'RW', 'R',  'R',  'R' ),
    ('RECEPTIONS',    'RW', 'R',  'R',  'RW', 'RW', 'R' ),
    ('MOUVEMENTS',    'RW', 'R',  'R',  'RW', 'R',  'R' ),
    ('STOCK',         'RW', 'R',  'R',  'R',  'R',  'R' ),
    ('INVENTAIRE',    'RW', 'R',  'R',  'RW', 'R',  'R' ),
    ('VALORISATION',  'RW', 'R',  'R',  '-',  '-',  'RW'),
    ('COCKPIT',       'RW', 'R',  'R',  'R',  'R',  'R' ),
    ('AUDIT',         'RW', '-',  '-',  '-',  '-',  'R' ),
    ('UTILISATEURS',  'RW', '-',  '-',  '-',  '-',  'R' );

INSERT INTO permission (code_role_user, module, action)
             SELECT 'DIRECTION', module, 'LIRE'   FROM _matrice WHERE instr(DIRECTION,'R') > 0
    UNION ALL SELECT 'DIRECTION', module, 'ECRIRE' FROM _matrice WHERE instr(DIRECTION,'W') > 0
    UNION ALL SELECT 'PLANIF',    module, 'LIRE'   FROM _matrice WHERE instr(PLANIF,'R')    > 0
    UNION ALL SELECT 'PLANIF',    module, 'ECRIRE' FROM _matrice WHERE instr(PLANIF,'W')    > 0
    UNION ALL SELECT 'ACHAT',     module, 'LIRE'   FROM _matrice WHERE instr(ACHAT,'R')     > 0
    UNION ALL SELECT 'ACHAT',     module, 'ECRIRE' FROM _matrice WHERE instr(ACHAT,'W')     > 0
    UNION ALL SELECT 'MAGASIN',   module, 'LIRE'   FROM _matrice WHERE instr(MAGASIN,'R')   > 0
    UNION ALL SELECT 'MAGASIN',   module, 'ECRIRE' FROM _matrice WHERE instr(MAGASIN,'W')   > 0
    UNION ALL SELECT 'QUALITE',   module, 'LIRE'   FROM _matrice WHERE instr(QUALITE,'R')   > 0
    UNION ALL SELECT 'QUALITE',   module, 'ECRIRE' FROM _matrice WHERE instr(QUALITE,'W')   > 0
    UNION ALL SELECT 'DAF',       module, 'LIRE'   FROM _matrice WHERE instr(DAF,'R')       > 0
    UNION ALL SELECT 'DAF',       module, 'ECRIRE' FROM _matrice WHERE instr(DAF,'W')       > 0;

DROP TABLE _matrice;

-- Permissions de VALIDATION (distinctes de l'ecriture : c'est sur cette
-- separation que repose toute la SoD du CDC B4).
INSERT INTO permission (code_role_user, module, action) VALUES
    ('DIRECTION','BONS_COMMANDE','VALIDER'),
    ('DIRECTION','PLANS',        'VALIDER'),
    ('DIRECTION','RECETTES',     'VALIDER'),
    ('DIRECTION','INVENTAIRE',   'VALIDER'),
    ('DIRECTION','RECEPTIONS',   'VALIDER'),
    ('DIRECTION','MOUVEMENTS',   'VALIDER'),
    ('ACHAT',    'BONS_COMMANDE','VALIDER'),   -- plafonne a 100k MAD (B4 regle 3)
    ('QUALITE',  'RECEPTIONS',   'VALIDER'),
    ('MAGASIN',  'MOUVEMENTS',   'VALIDER'),
    ('MAGASIN',  'INVENTAIRE',   'VALIDER');

-- =============================================================================
-- 2. CATALOGUE DES CHAMPS CONFIGURABLES
--    sensible = 1 : prix, cout, valorisation, taux de change.
--    Ce sont les champs vises par la regle B4-1 ("le magasinier ne voit PAS
--    les prix"), mis en evidence dans l'ecran d'administration.
-- =============================================================================
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
-- ---- CATALOGUE -------------------------------------------------------------
 ('CATALOGUE','code_reference',       'Reference',                  'LECTURE', 0, 10),
 ('CATALOGUE','designation',          'Designation',                'LECTURE', 0, 20),
 ('CATALOGUE','code_categorie',       'Categorie matiere',          'LECTURE', 0, 30),
 ('CATALOGUE','code_role_defaut',     'Role BOM habituel',          'LECTURE', 0, 35),
 ('CATALOGUE','code_fournisseur',     'Fournisseur',                'LECTURE', 0, 40),
 ('CATALOGUE','fournisseur_nom',      'Nom du fournisseur',         'LECTURE', 0, 45),
 ('CATALOGUE','type_fil',             'Type de fil',                'LECTURE', 0, 50),
 ('CATALOGUE','couleur',              'Couleur',                    'LECTURE', 0, 60),
 ('CATALOGUE','titrage',              'Titrage',                    'LECTURE', 0, 70),
 ('CATALOGUE','unite_catalogue',      'Unite',                      'LECTURE', 0, 80),
 ('CATALOGUE','poids_bobine_kg',      'Poids par bobine (kg)',      'LECTURE', 0, 90),
 ('CATALOGUE','bobines_par_palette',  'Bobines par palette',        'LECTURE', 0,100),
 ('CATALOGUE','densite_kg_ml',        'Densite (kg/ml)',            'LECTURE', 0,110),
 ('CATALOGUE','facteur_kg',           'Facteur de conversion (kg)', 'LECTURE', 0,120),
 ('CATALOGUE','prix_catalogue',       'Prix catalogue',             'LECTURE', 1,130),
 ('CATALOGUE','code_devise_catalogue','Devise',                     'LECTURE', 1,140),
 ('CATALOGUE','prix_catalogue_kg',    'Prix ramene au kg',          'LECTURE', 1,150),
 ('CATALOGUE','prix_kg_mad',          'Prix (MAD/kg)',              'LECTURE', 1,155),
 ('CATALOGUE','source_prix',          'Source du prix',             'LECTURE', 1,156),
 ('CATALOGUE','cmup_mad',             'CMUP (MAD/kg)',              'LECTURE', 1,160),
 ('CATALOGUE','stock_min_kg',         'Stock minimum (kg)',         'LECTURE', 0,170),
 ('CATALOGUE','couverture_min_mois',  'Couverture minimale (mois)', 'LECTURE', 0,180),
 ('CATALOGUE','marge_securite_pct',   'Marge de securite (%)',      'LECTURE', 0,190),
 ('CATALOGUE','moq_kg',               'Quantite minimale (kg)',     'LECTURE', 0,200),
 ('CATALOGUE','multiple_achat_kg',    'Multiple d''achat (kg)',     'LECTURE', 0,210),
 ('CATALOGUE','classe_abc',           'Classe ABC',                 'LECTURE', 0,220),
 ('CATALOGUE','classe_xyz',           'Classe XYZ',                 'LECTURE', 0,230),
 ('CATALOGUE','suivi_lot',            'Suivi par lot',              'LECTURE', 0,240),
 ('CATALOGUE','actif',                'Actif',                      'LECTURE', 0,250),
-- ---- FOURNISSEURS ----------------------------------------------------------
 ('FOURNISSEURS','code_fournisseur',      'Code',                   'LECTURE', 0, 10),
 ('FOURNISSEURS','nom',                   'Nom',                    'LECTURE', 0, 20),
 ('FOURNISSEURS','contact_principal',     'Contact',                'LECTURE', 0, 30),
 ('FOURNISSEURS','telephone',             'Telephone',              'LECTURE', 0, 40),
 ('FOURNISSEURS','email',                 'Email',                  'LECTURE', 0, 50),
 ('FOURNISSEURS','pays',                  'Pays',                   'LECTURE', 0, 60),
 ('FOURNISSEURS','ville',                 'Ville',                  'LECTURE', 0, 65),
 ('FOURNISSEURS','delai_livraison_jours', 'Delai de livraison (j)', 'LECTURE', 0, 70),
 ('FOURNISSEURS','conditions_paiement',   'Conditions de paiement', 'LECTURE', 1, 80),
 ('FOURNISSEURS','delai_paiement_jours',  'Delai de paiement (j)',  'LECTURE', 1, 90),
 ('FOURNISSEURS','code_devise',           'Devise',                 'LECTURE', 0,100),
 ('FOURNISSEURS','note_globale',          'Note globale',           'LECTURE', 0,110),
 ('FOURNISSEURS','tolerance_pesee_pct',   'Tolerance de pesee (%)', 'LECTURE', 0,120),
 ('FOURNISSEURS','actif',                 'Actif',                  'LECTURE', 0,130),
-- ---- STOCK -----------------------------------------------------------------
 ('STOCK','code_reference',        'Reference',                'LECTURE', 0, 10),
 ('STOCK','designation',           'Designation',              'LECTURE', 0, 20),
 ('STOCK','code_magasin',          'Magasin',                  'LECTURE', 0, 30),
 ('STOCK','quantite_kg',           'Quantite (kg)',            'LECTURE', 0, 40),
 ('STOCK','cmup_mad',              'CMUP (MAD/kg)',            'LECTURE', 1, 50),
 ('STOCK','valeur_mad',            'Valeur (MAD)',             'LECTURE', 1, 60),
 ('STOCK','date_derniere_entree',  'Derniere entree',          'LECTURE', 0, 70),
 ('STOCK','date_derniere_sortie',  'Derniere sortie',          'LECTURE', 0, 80),
 ('STOCK','date_dernier_inventaire','Dernier inventaire',      'LECTURE', 0, 90),
 ('STOCK','stock_projete_kg',      'Stock projete (kg)',       'LECTURE', 0,100),
 ('STOCK','jours_couverture',      'Jours de couverture',      'LECTURE', 0,110),
 ('STOCK','statut',                'Statut',                   'LECTURE', 0,120),
 ('STOCK','lot_fournisseur',       'Lot fournisseur',          'LECTURE', 0,130),
 ('STOCK','date_peremption',       'Date de peremption',       'LECTURE', 0,140),
-- ---- MOUVEMENTS ------------------------------------------------------------
 ('MOUVEMENTS','numero_mouvement', 'Numero',                   'LECTURE', 0, 10),
 ('MOUVEMENTS','date_mouvement',   'Date',                     'LECTURE', 0, 20),
 ('MOUVEMENTS','code_type_mvt',    'Type de mouvement',        'LECTURE', 0, 30),
 ('MOUVEMENTS','code_magasin',     'Magasin',                  'LECTURE', 0, 40),
 ('MOUVEMENTS','code_motif',       'Motif',                    'LECTURE', 0, 50),
 ('MOUVEMENTS','code_reference',   'Reference',                'LECTURE', 0, 60),
 ('MOUVEMENTS','quantite_kg',      'Quantite (kg)',            'LECTURE', 0, 70),
 ('MOUVEMENTS','prix_kg_mad',      'Prix (MAD/kg)',            'LECTURE', 1, 80),
 ('MOUVEMENTS','total_mad',        'Total (MAD)',              'LECTURE', 1, 90),
 ('MOUVEMENTS','lot_fournisseur',  'Lot fournisseur',          'LECTURE', 0,100),
 ('MOUVEMENTS','numero_of',        'Numero d''OF',             'LECTURE', 0,110),
 ('MOUVEMENTS','utilisateur',      'Utilisateur',              'LECTURE', 0,120),
-- ---- RECEPTIONS ------------------------------------------------------------
 ('RECEPTIONS','numero_reception',      'Numero de reception',  'LECTURE', 0, 10),
 ('RECEPTIONS','date_reception',        'Date',                 'LECTURE', 0, 20),
 ('RECEPTIONS','code_fournisseur',      'Fournisseur',          'LECTURE', 0, 30),
 ('RECEPTIONS','num_bon_livraison',     'Numero de BL',         'LECTURE', 0, 40),
 ('RECEPTIONS','code_reference',        'Reference',            'LECTURE', 0, 50),
 ('RECEPTIONS','unite_saisie',          'Unite de saisie',      'LECTURE', 0, 60),
 ('RECEPTIONS','quantite_pesee_unite',  'Quantite pesee',       'LECTURE', 0, 70),
 ('RECEPTIONS','quantite_stock_kg',     'Quantite en kg',       'LECTURE', 0, 80),
 ('RECEPTIONS','quantite_commandee_kg', 'Quantite commandee',   'LECTURE', 0, 90),
 ('RECEPTIONS','ecart_pct',             'Ecart (%)',            'LECTURE', 0,100),
 ('RECEPTIONS','prix_kg_devise',        'Prix (devise/kg)',     'LECTURE', 1,110),
 ('RECEPTIONS','code_devise',           'Devise',               'LECTURE', 1,120),
 ('RECEPTIONS','taux_change',           'Taux de change',       'LECTURE', 1,130),
 ('RECEPTIONS','prix_kg_mad',           'Prix (MAD/kg)',        'LECTURE', 1,140),
 ('RECEPTIONS','total_mad',             'Total (MAD)',          'LECTURE', 1,150),
 ('RECEPTIONS','total_devise',          'Total (devise)',       'LECTURE', 1,155),
 ('RECEPTIONS','lot_fournisseur',       'Lot fournisseur',      'LECTURE', 0,160),
 ('RECEPTIONS','date_peremption',       'Date de peremption',   'LECTURE', 0,170),
 ('RECEPTIONS','statut_qualite',        'Statut qualite',       'LECTURE', 0,180),
 ('RECEPTIONS','code_magasin_dest',     'Magasin destinataire', 'LECTURE', 0,190),
 -- Entete : un champ non declare vaut MASQUE, donc la colonne disparait sans
 -- rien dire. Tout ce que la liste et le document affichent est declare ici.
 ('RECEPTIONS','fournisseur_nom',       'Nom du fournisseur',   'LECTURE', 0, 31),
 ('RECEPTIONS','numero_bc',             'Bon de commande',      'LECTURE', 0, 35),
 ('RECEPTIONS','numero_facture',        'Numero de facture',    'LECTURE', 1, 41),
 ('RECEPTIONS','transporteur',          'Transporteur',         'LECTURE', 0, 42),
 ('RECEPTIONS','nombre_colis',          'Nombre de colis',      'LECTURE', 0, 43),
 ('RECEPTIONS','poids_total_brut_kg',   'Poids brut (kg)',      'LECTURE', 0, 44),
 ('RECEPTIONS','statut',                'Statut',               'LECTURE', 0, 45),
 ('RECEPTIONS','nb_lignes',             'Nombre de lignes',     'LECTURE', 0, 46),
 ('RECEPTIONS','receptionnaire',        'Pesee par',            'LECTURE', 0,200),
 ('RECEPTIONS','controleur',            'Controle par',         'LECTURE', 0,210),
 ('RECEPTIONS','date_controle',         'Date de controle',     'LECTURE', 0,220),
 -- Lignes : les trois ecarts ne disent pas la meme chose. BL contre pesee met
 -- en cause le fournisseur ; commande contre pesee mesure le reliquat.
 ('RECEPTIONS','quantite_bl_kg',        'Quantite BL (kg)',     'LECTURE', 0, 75),
 ('RECEPTIONS','ecart_bl_kg',           'Ecart BL / pesee',     'LECTURE', 0, 76),
 ('RECEPTIONS','ecart_cmd_kg',          'Ecart commande',       'LECTURE', 0, 95),
 ('RECEPTIONS','nb_colis_ligne',        'Colis de la ligne',    'LECTURE', 0,192),
 ('RECEPTIONS','poids_moyen_colis_kg',  'Poids moyen / colis',  'LECTURE', 0,193),
 ('RECEPTIONS','date_fabrication',      'Date de fabrication',  'LECTURE', 0,165),
 ('RECEPTIONS','notes',                 'Observations',         'LECTURE', 0,230),
 -- OTIF : produit de trois conditions, pas moyenne. Une livraison a l'heure
 -- mais incomplete vaut zero — c'est la seule lecture honnete pour un achat.
 ('RECEPTIONS','delai_reel_jours',      'Delai reel (j)',       'LECTURE', 0,240),
 ('RECEPTIONS','delai_prevu_jours',     'Delai prevu (j)',      'LECTURE', 0,250),
 ('RECEPTIONS','retard_jours',          'Retard (j)',           'LECTURE', 0,260),
 ('RECEPTIONS','on_time',               'A l''heure',           'LECTURE', 0,270),
 ('RECEPTIONS','in_full',               'Complet',              'LECTURE', 0,280),
 ('RECEPTIONS','in_spec',               'Conforme',             'LECTURE', 0,290),
 -- Substitution : le fournisseur livre l'equivalent de ce qu'on a commande.
 ('RECEPTIONS','substitution_acceptee', 'Substitution acceptee',   'LECTURE', 0,700),
 ('RECEPTIONS','motif_substitution',    'Motif de la substitution','LECTURE', 0,710),
 ('RECEPTIONS','reference_commandee',   'Reference commandee',     'LECTURE', 0,720),
 ('RECEPTIONS','est_substitution',      'Est une substitution',    'LECTURE', 0,730),
 ('RECEPTIONS','equivalents_recevables','Equivalents recevables',  'LECTURE', 0,740),
-- ---- BONS DE COMMANDE ------------------------------------------------------
 ('BONS_COMMANDE','numero_bc',               'Numero de BC',       'LECTURE', 0, 10),
 ('BONS_COMMANDE','date_bc',                 'Date',               'LECTURE', 0, 20),
 ('BONS_COMMANDE','code_fournisseur',        'Fournisseur',        'LECTURE', 0, 30),
 ('BONS_COMMANDE','statut',                  'Statut',             'LECTURE', 0, 40),
 ('BONS_COMMANDE','code_devise',             'Devise',             'LECTURE', 1, 50),
 ('BONS_COMMANDE','taux_change_engage',      'Taux engage',        'LECTURE', 1, 60),
 ('BONS_COMMANDE','montant_total_devise',    'Montant (devise)',   'LECTURE', 1, 70),
 ('BONS_COMMANDE','montant_total_mad',       'Montant (MAD)',      'LECTURE', 1, 80),
 ('BONS_COMMANDE','code_reference',          'Reference',          'LECTURE', 0, 90),
 ('BONS_COMMANDE','unite_commande',          'Unite de commande',  'LECTURE', 0,100),
 ('BONS_COMMANDE','quantite_commandee_unite','Quantite commandee', 'LECTURE', 0,110),
 ('BONS_COMMANDE','quantite_commandee_kg',   'Quantite (kg)',      'LECTURE', 0,120),
 ('BONS_COMMANDE','quantite_recue_kg',       'Quantite recue (kg)','LECTURE', 0,130),
 ('BONS_COMMANDE','prix_unitaire_devise',    'Prix unitaire',      'LECTURE', 1,140),
 ('BONS_COMMANDE','total_ligne_devise',      'Total ligne',        'LECTURE', 1,150),
 ('BONS_COMMANDE','date_livraison_prevue',   'Livraison prevue',   'LECTURE', 0,160),
 -- Le besoin qui a justifie la ligne, et celui d'aujourd'hui. Non saisissables :
 -- l'un est fige a la conversion, l'autre est lu dans le calcul MRP.
 ('BONS_COMMANDE','besoin_kg_origine',       'Besoin a la conversion','LECTURE', 0,170),
 ('BONS_COMMANDE','besoin_kg_actuel',        'Besoin actuel (kg)', 'LECTURE', 0,172),
 ('BONS_COMMANDE','ecart_besoin_kg',         'Ecart de besoin',    'LECTURE', 0,174),
 -- Le verrou se pose par le geste de modification, jamais a la main.
 ('BONS_COMMANDE','arbitree',                'Ligne arbitree',     'LECTURE', 0,176),
-- Colonnes affichees mais jamais declarees : un champ inconnu vaut MASQUE,
-- donc sa colonne disparaissait de l'ecran sans le moindre message.
-- ---- BONS DE COMMANDE : entete ------------------------------------------
 ('BONS_COMMANDE','fournisseur_nom',      'Nom du fournisseur',      'LECTURE', 0,  35),
 ('BONS_COMMANDE','devise_fournisseur',   'Devise du fournisseur',   'LECTURE', 0,  36),
 ('BONS_COMMANDE','nb_lignes',            'Nombre de lignes',        'LECTURE', 0,  62),
 ('BONS_COMMANDE','date_envoi',           'Date d''envoi',           'LECTURE', 0,  64),
 ('BONS_COMMANDE','date_validation',      'Date de validation',      'LECTURE', 0,  66),
 ('BONS_COMMANDE','createur',             'Cree par',                'LECTURE', 0,  68),
 ('BONS_COMMANDE','valideur',             'Valide par',              'LECTURE', 0,  70),
 ('BONS_COMMANDE','motif_creation',       'Motif de creation',       'LECTURE', 0,  72),
 ('BONS_COMMANDE','conditions_paiement',  'Conditions de paiement',  'LECTURE', 0,  74),
 ('BONS_COMMANDE','notes',                'Observations',            'LECTURE', 0,  76),
 -- ---- BONS DE COMMANDE : avancement de livraison --------------------------
 ('BONS_COMMANDE','quantite_recue_kg_bc', 'Quantite recue (kg)',     'LECTURE', 0, 180),
 ('BONS_COMMANDE','reste_a_livrer_kg',    'Reste a livrer (kg)',     'LECTURE', 0, 182),
 ('BONS_COMMANDE','pct_livre',            'Pourcentage livre',       'LECTURE', 0, 184),
 ('BONS_COMMANDE','statut_livraison',     'Statut de livraison',     'LECTURE', 0, 186),
 -- Rapprochement par equivalence, a la saisie d'un bon.
 ('BONS_COMMANDE','equivalent_de',        'Equivalent de',              'LECTURE', 0, 950),
 ('BONS_COMMANDE','besoin_equivalent_kg', 'Besoin de l''equivalent (kg)','LECTURE', 0, 960),
 ('BONS_COMMANDE','nb_equivalents',       'Nombre d''equivalents',       'LECTURE', 0, 970),
 ('BONS_COMMANDE','statut_ligne',         'Statut de la ligne',      'LECTURE', 0, 188),
 -- ---- PLAN D'ACHAT : colonnes de la feuille -------------------------------
 ('PLAN_ACHAT','fournisseur_nom',         'Nom du fournisseur',      'LECTURE', 0,  35),
 ('PLAN_ACHAT','unite_saisie',            'Unite de commande',       'LECTURE', 0,  54),
 ('PLAN_ACHAT','risque_identifie',        'Risque identifie',        'LECTURE', 0, 100),
 ('PLAN_ACHAT','action_recommandee',      'Action recommandee',      'LECTURE', 0, 102),
 ('PLAN_ACHAT','commentaires',            'Commentaires',            'LECTURE', 0, 104),
 ('PLAN_ACHAT','date_generation',         'Date de generation',      'LECTURE', 0, 106),
 -- ---- CATALOGUE : historique des prix -------------------------------------
 ('CATALOGUE','date_achat',               'Date d''achat',           'LECTURE', 0, 300),
 ('CATALOGUE','prix_kg_devise',           'Prix (devise/kg)',        'LECTURE', 1, 302),
 ('CATALOGUE','prix_precedent_mad',       'Prix precedent (MAD/kg)', 'LECTURE', 1, 304),
 ('CATALOGUE','quantite_achetee_kg',      'Quantite achetee (kg)',   'LECTURE', 0, 306),
 ('CATALOGUE','total_mad',                'Total (MAD)',             'LECTURE', 1, 308),
 ('CATALOGUE','numero_bc',                'Bon de commande',         'LECTURE', 0, 310),
 ('CATALOGUE','numero_reception',         'Reception',               'LECTURE', 0, 312),
-- ---- PLAN D'ACHAT ----------------------------------------------------------
 ('PLAN_ACHAT','id_proposition',     'Proposition',            'LECTURE', 0,  5),
 ('PLAN_ACHAT','code_reference',     'Reference',              'LECTURE', 0, 10),
 ('PLAN_ACHAT','quantite_suggeree_kg','Quantite suggeree (kg)', 'LECTURE', 0, 55),
 ('PLAN_ACHAT','quantite_suggeree_unite','Quantite suggeree',   'LECTURE', 0, 56),
 ('PLAN_ACHAT','urgence',            'Urgence',                'LECTURE', 0, 57),
 ('PLAN_ACHAT','date_besoin_prevue', 'Date de besoin',         'LECTURE', 0, 58),
 ('PLAN_ACHAT','montant_total_mad',  'Montant (MAD)',          'LECTURE', 1, 59),
 ('PLAN_ACHAT','numero_bc',          'Bon de commande',        'LECTURE', 0,120),
 ('PLAN_ACHAT','statut_bc',          'Statut du bon',          'LECTURE', 0,122),
 ('PLAN_ACHAT','designation',        'Designation',            'LECTURE', 0, 20),
 ('PLAN_ACHAT','code_fournisseur',   'Fournisseur',            'LECTURE', 0, 30),
 ('PLAN_ACHAT','statut',             'Statut du stock',        'LECTURE', 0, 40),
 ('PLAN_ACHAT','stock_projete_kg',   'Stock projete (kg)',     'LECTURE', 0, 50),
 ('PLAN_ACHAT','stock_min_kg',       'Stock minimum (kg)',     'LECTURE', 0, 60),
 ('PLAN_ACHAT','qte_a_commander_kg', 'Quantite a commander',   'LECTURE', 0, 70),
 ('PLAN_ACHAT','prix_estime_mad',    'Prix estime (MAD/kg)',   'LECTURE', 1, 80),
 ('PLAN_ACHAT','source_prix',        'Source du prix',         'LECTURE', 1, 90),
 ('PLAN_ACHAT','montant_estime_mad', 'Montant estime (MAD)',   'LECTURE', 1,100),
 ('PLAN_ACHAT','tier',               'Urgence',                'LECTURE', 0,110),
 ('PLAN_ACHAT','risque_sourcing',    'Risque de sourcing',     'LECTURE', 0,120),
 ('PLAN_ACHAT','jours_couverture',   'Jours de couverture',    'LECTURE', 0,130),
 -- Arbitrage d'une proposition sur une reference equivalente.
 ('PLAN_ACHAT','code_reference_origine','Reference d''origine',      'LECTURE', 0,140),
 ('PLAN_ACHAT','designation_origine',   'Designation d''origine',    'LECTURE', 0,150),
 ('PLAN_ACHAT','motif_substitution',    'Motif de la bascule',       'LECTURE', 0,160),
 ('PLAN_ACHAT','nb_equivalents',        'Nombre d''equivalents',     'LECTURE', 0,170),
 ('PLAN_ACHAT','equivalent_dispo_kg',   'Stock d''un equivalent (kg)','LECTURE', 0,180),
-- ---- QUALITES --------------------------------------------------------------
 ('QUALITES','code_qualite',        'Code',                     'LECTURE', 0, 10),
 ('QUALITES','nom',                 'Nom',                      'LECTURE', 0, 20),
 ('QUALITES','description',         'Description',              'LECTURE', 0, 25),
 ('QUALITES','statut',              'Statut',                   'LECTURE', 0, 28),
 ('QUALITES','poids_commercial_m2', 'Poids commercial (kg/m2)', 'LECTURE', 0, 30),
 ('QUALITES','code_role',           'Role BOM',                 'LECTURE', 0, 40),
 ('QUALITES','role_libelle',        'Libelle du role',          'LECTURE', 0, 45),
 ('QUALITES','densite',             'Densite',                  'LECTURE', 0, 50),
 ('QUALITES','unite_densite',       'Unite de densite',         'LECTURE', 0, 60),
 ('QUALITES','entre_poids_commercial','Entre dans le poids',    'LECTURE', 0, 65),
-- La COMPOSITION fait partie du document de la qualite : ses champs sont donc
-- gouvernes par le module QUALITES. Le module RECETTES gouverne, lui, l'ecran de
-- consultation transversale, qui montre les memes donnees sans les modifier.
 ('QUALITES','code_reference',      'Reference',                'LECTURE', 0, 66),
 ('QUALITES','designation',         'Designation',              'LECTURE', 0, 67),
 ('QUALITES','pourcentage_composition','Composition (%)',       'LECTURE', 0, 68),
 ('QUALITES','couleur',             'Couleur',                  'LECTURE', 0, 69),
 ('QUALITES','code_groupe_equiv',   'Groupe d''equivalence',    'LECTURE', 0, 69),
 ('QUALITES','code_fournisseur_prefere','Fournisseur prefere',  'LECTURE', 0, 69),
 ('QUALITES','ligne_numero',        'Ligne',                    'LECTURE', 0, 69),
 ('QUALITES','kg_m2',               'Consommation (kg/m2)',     'LECTURE', 0, 69),
 ('QUALITES','type_fil',           'Type',                     'LECTURE', 0, 69),
 ('QUALITES','categorie',          'Categorie',                'LECTURE', 0, 69),
 ('QUALITES','fournisseur',        'Fournisseur',              'LECTURE', 0, 69),
 ('QUALITES','prix_kg_mad',        'Prix (MAD/kg)',            'LECTURE', 1, 69),
 ('QUALITES','code_devise_catalogue','Devise',                 'LECTURE', 1, 69),
 ('QUALITES','cout_m2_mad',        'Cout (MAD/m2)',            'LECTURE', 1, 69),
 ('QUALITES','source_prix',        'Source du prix',           'LECTURE', 1, 69),
 ('QUALITES','marge_securite_pct',  'Marge de securite (%)',    'LECTURE', 0, 70),
 ('QUALITES','couv_min_mois',       'Couverture minimale',      'LECTURE', 0, 80),
 ('QUALITES','taux_perte_pct',      'Taux de perte (%)',        'LECTURE', 0, 90),
 ('QUALITES','seuil_alerte_jours',  'Seuil d''alerte (jours)',  'LECTURE', 0, 92),
 ('QUALITES','seuil_critique_jours','Seuil critique (jours)',   'LECTURE', 0, 94),
 ('QUALITES','stock_securite_jours','Stock de securite (jours)','LECTURE', 0, 96),
 ('QUALITES','actif',               'Actif',                    'LECTURE', 0,100),
 ('QUALITES','nb_roles',            'Nombre de lignes',         'LECTURE', 0,110),
 ('QUALITES','nb_composition',      'Lignes de composition',    'LECTURE', 0,118),
 ('QUALITES','nb_roles_composes',   'Roles composes',           'LECTURE', 0,119),
 ('QUALITES','nb_roles_hors_100',   'Roles hors 100 %',         'LECTURE', 0,120),
 ('QUALITES','nb_lignes_plan',      'Lignes de plan',           'LECTURE', 0,130),
 ('QUALITES','date_creation',       'Creee le',                 'LECTURE', 0,140),
 ('QUALITES','cree_par',            'Creee par',                'LECTURE', 0,150),
 ('QUALITES','date_modification',   'Modifiee le',              'LECTURE', 0,160),
 ('QUALITES','modifie_par',         'Modifiee par',             'LECTURE', 0,170),
 ('QUALITES','date_cloture',        'Cloturee le',              'LECTURE', 0,180),
-- ---- RECETTES --------------------------------------------------------------
 ('RECETTES','code_qualite',            'Qualite',              'LECTURE', 0, 10),
 ('RECETTES','qualite_nom',             'Nom de la qualite',    'LECTURE', 0, 12),
 ('RECETTES','ligne_numero',            'Ligne',                'LECTURE', 0, 40),
 ('RECETTES','code_reference',          'Reference',            'LECTURE', 0, 50),
 ('RECETTES','designation',             'Designation',          'LECTURE', 0, 60),
 ('RECETTES','code_role',               'Role BOM',             'LECTURE', 0, 70),
 ('RECETTES','role_libelle',            'Libelle du role',      'LECTURE', 0, 75),
 ('RECETTES','pourcentage_composition', 'Composition (%)',      'LECTURE', 0, 80),
 ('RECETTES','couleur',                 'Couleur',              'LECTURE', 0, 85),
 ('RECETTES','densite_role',            'Densite du role',      'LECTURE', 0, 90),
 ('RECETTES','unite_densite',           'Unite de densite',     'LECTURE', 0,100),
 ('RECETTES','kg_m2',                   'Consommation (kg/m2)', 'LECTURE', 0,110),
 ('RECETTES','code_groupe_equiv',       'Groupe d''equivalence','LECTURE', 0,120),
 ('RECETTES','statut_qualite',          'Statut de la qualite', 'LECTURE', 0,130),
 ('RECETTES','code_fournisseur',       'Code fournisseur',     'LECTURE', 0,138),
 ('RECETTES','fournisseur',             'Fournisseur',          'LECTURE', 0,140),
 ('RECETTES','code_fournisseur_prefere','Fournisseur prefere',  'LECTURE', 0,125),
-- ---- PLANS -----------------------------------------------------------------
 ('PLANS','annee',            'Annee',                  'LECTURE', 0, 10),
 ('PLANS','numero_version',   'Version',                'LECTURE', 0, 20),
 ('PLANS','libelle',          'Libelle',                'LECTURE', 0, 30),
 ('PLANS','scenario_nom',     'Scenario',               'LECTURE', 0, 40),
 ('PLANS','statut',           'Statut',                 'LECTURE', 0, 50),
 ('PLANS','actif',            'Actif',                  'LECTURE', 0, 52),
 ('PLANS','date_debut',       'Debut de periode',       'LECTURE', 0, 54),
 ('PLANS','date_fin',         'Fin de periode',         'LECTURE', 0, 56),
 ('PLANS','mois_horizon',     'Horizon (mois)',         'LECTURE', 0, 58),
 ('PLANS','croissance_annuelle_pct','Croissance annuelle (%)','LECTURE', 0, 59),
 ('PLANS','mois',             'Mois',                   'LECTURE', 0, 60),
 ('PLANS','rang_mois',        'Rang dans la periode',   'LECTURE', 0, 62),
 ('PLANS','annee_mois',       'Mois date',              'LECTURE', 0, 64),
 ('PLANS','code_qualite',     'Qualite',                'LECTURE', 0, 70),
 ('PLANS','qualite_nom',      'Nom de la qualite',      'LECTURE', 0, 72),
 ('PLANS','m2_base_mensuel',  'Base mensuelle (m2)',    'LECTURE', 0, 76),
 ('PLANS','m2_prevus',        'm2 prevus',              'LECTURE', 0, 80),
 ('PLANS','saisonnalite',     'Saisonnalite',           'LECTURE', 0, 90),
 ('PLANS','coefficient',      'Coefficient du mois',    'LECTURE', 0, 92),
 ('PLANS','facteur_croissance','Facteur de croissance', 'LECTURE', 0, 94),
 ('PLANS','m2_realises',      'm2 realises',            'LECTURE', 0,100),
 ('PLANS','taux_perte_pct',   'Taux de perte (%)',      'LECTURE', 0,110),
 ('PLANS','m2_total_annuel',  'Total de la periode (m2)','LECTURE', 0,120),
 ('PLANS','m2_total',         'Total deploye (m2)',     'LECTURE', 0,122),
 ('PLANS','nb_lignes',        'Cases du plan',          'LECTURE', 0,124),
 ('PLANS','nb_qualites',      'Qualites retenues',      'LECTURE', 0,126),
 ('PLANS','nb_qualites_perimees','Qualites perimees',   'LECTURE', 0,128),
 ('PLANS','nb_besoins',       'Besoins calcules',       'LECTURE', 0,130),
 ('PLANS','date_creation',    'Cree le',                'LECTURE', 0,140),
 ('PLANS','cree_par',         'Cree par',               'LECTURE', 0,142),
 ('PLANS','date_modification','Modifie le',             'LECTURE', 0,144),
 ('PLANS','modifie_par',      'Modifie par',            'LECTURE', 0,146),
 ('PLANS','date_validation',  'Valide le',              'LECTURE', 0,148),
 ('PLANS','valide_par',       'Valide par',             'LECTURE', 0,150),
 ('PLANS','date_cloture',     'Cloture le',             'LECTURE', 0,152),
 ('PLANS','cloture_par',      'Cloture par',            'LECTURE', 0,154),
-- ---- MRP -------------------------------------------------------------------
 ('MRP','code_reference',       'Reference',              'LECTURE', 0, 10),
 ('MRP','designation',          'Designation',            'LECTURE', 0, 20),
 ('MRP','mois',                 'Mois',                   'LECTURE', 0, 30),
 ('MRP','quantite_brute_kg',    'Besoin brut (kg)',       'LECTURE', 0, 40),
 ('MRP','taux_perte_applique',  'Taux de perte (%)',      'LECTURE', 0, 50),
 ('MRP','quantite_kg',          'Besoin net (kg)',        'LECTURE', 0, 60),
 ('MRP','code_fournisseur',     'Fournisseur',            'LECTURE', 0, 70),
-- ---- INVENTAIRE ------------------------------------------------------------
 ('INVENTAIRE','numero_inventaire',     'Numero',              'LECTURE', 0, 10),
 ('INVENTAIRE','date_inventaire',       'Date',                'LECTURE', 0, 20),
 ('INVENTAIRE','type_inventaire',       'Type',                'LECTURE', 0, 30),
 ('INVENTAIRE','code_magasin',          'Magasin',             'LECTURE', 0, 40),
 ('INVENTAIRE','statut',                'Statut',              'LECTURE', 0, 50),
 ('INVENTAIRE','code_reference',        'Reference',           'LECTURE', 0, 60),
 ('INVENTAIRE','quantite_theorique_kg', 'Theorique (kg)',      'LECTURE', 0, 70),
 ('INVENTAIRE','quantite_comptee_kg',   'Compte (kg)',         'LECTURE', 0, 80),
 ('INVENTAIRE','ecart_kg',              'Ecart (kg)',          'LECTURE', 0, 90),
 ('INVENTAIRE','ecart_pct',             'Ecart (%)',           'LECTURE', 0,100),
 ('INVENTAIRE','ecart_mad',             'Ecart (MAD)',         'LECTURE', 1,110),
 ('INVENTAIRE','motif_ecart',           'Motif de l''ecart',   'LECTURE', 0,120),
-- ---- VALORISATION ----------------------------------------------------------
 ('VALORISATION','code_reference', 'Reference',           'LECTURE', 0, 10),
 ('VALORISATION','code_magasin',   'Magasin',             'LECTURE', 0, 20),
 ('VALORISATION','quantite_kg',    'Quantite (kg)',       'LECTURE', 0, 30),
 ('VALORISATION','cmup_mad',       'CMUP (MAD/kg)',       'LECTURE', 1, 40),
 ('VALORISATION','valeur_mad',     'Valeur (MAD)',        'LECTURE', 1, 50),
-- ---- COCKPIT ---------------------------------------------------------------
 ('COCKPIT','nb_ruptures',            'Ruptures',                  'LECTURE', 0, 10),
 ('COCKPIT','nb_critiques',           'Critiques',                 'LECTURE', 0, 20),
 ('COCKPIT','nb_attention',           'En attention',              'LECTURE', 0, 30),
 ('COCKPIT','nb_ok',                  'Situation normale',         'LECTURE', 0, 40),
 ('COCKPIT','nb_references',          'References suivies',        'LECTURE', 0, 50),
 ('COCKPIT','valeur_stock_mad',       'Valeur du stock (MAD)',     'LECTURE', 1, 60),
 ('COCKPIT','nb_refs_a_commander',    'References a commander',    'LECTURE', 0, 70),
 ('COCKPIT','budget_a_engager_mad',   'Budget a engager (MAD)',    'LECTURE', 1, 80),
 ('COCKPIT','nb_classe_a_alerte',     'Classe A en alerte',        'LECTURE', 0, 90),
 ('COCKPIT','nb_tier1',               'Urgences TIER 1',           'LECTURE', 0,100),
 ('COCKPIT','nb_fournisseurs_actifs', 'Fournisseurs actifs',       'LECTURE', 0,110),
 ('COCKPIT','nb_bc_ouverts',          'BC ouverts',                'LECTURE', 0,120),
 ('COCKPIT','montant_bc_ouverts_mad', 'Montant des BC (MAD)',      'LECTURE', 1,130),
 ('COCKPIT','nb_alertes_critiques',   'Alertes critiques',         'LECTURE', 0,140),
 -- Files de travail du poste de travail. Un compteur non declare ici vaut
 -- MASQUE : sa tuile disparaitrait sans un mot, et l'on chercherait longtemps.
 ('COCKPIT','nb_propositions_a_traiter',  'Propositions d''achat a traiter', 'LECTURE', 0,150),
 ('COCKPIT','nb_bc_en_preparation',       'Bons en preparation',        'LECTURE', 0,160),
 ('COCKPIT','nb_bc_a_valider',            'Bons a valider',             'LECTURE', 0,170),
 ('COCKPIT','montant_bc_a_valider_mad',   'Montant a valider (MAD)',    'LECTURE', 1,180),
 ('COCKPIT','nb_bc_a_envoyer',            'Bons a envoyer',             'LECTURE', 0,190),
 ('COCKPIT','nb_livraisons_en_retard',    'Livraisons en retard',       'LECTURE', 0,200),
 ('COCKPIT','retard_max_jours',           'Retard le plus ancien (j)',  'LECTURE', 0,210),
 ('COCKPIT','nb_receptions_en_saisie',    'Receptions en saisie',       'LECTURE', 0,220),
 ('COCKPIT','nb_receptions_a_controler',  'Receptions a controler',     'LECTURE', 0,230),
 ('COCKPIT','nb_lignes_non_conformes',    'Lignes non conformes',       'LECTURE', 0,240),
 ('COCKPIT','nb_receptions_a_regulariser','Receptions a regulariser',   'LECTURE', 0,250),
 ('COCKPIT','nb_refs_sous_minimum',       'References sous le minimum', 'LECTURE', 0,260),
 ('COCKPIT','nb_refs_dormantes',          'References dormantes',       'LECTURE', 0,270),
 ('COCKPIT','valeur_dormante_mad',        'Valeur dormante (MAD)',      'LECTURE', 1,280),
 ('COCKPIT','nb_lots_peremption_proche',  'Lots proches de peremption', 'LECTURE', 0,290),
 ('COCKPIT','nb_controles_bloquants',     'Controles bloquants',        'LECTURE', 0,300),
 ('COCKPIT','nb_controles_critiques',     'Controles critiques',        'LECTURE', 0,310),
 ('COCKPIT','nb_alertes_ouvertes',        'Alertes ouvertes',           'LECTURE', 0,320),
 -- Mur de risques. Les quantites en kg ne sont pas sensibles ; la marge de
 -- decision non plus — c'est un delai, pas une valeur.
 ('COCKPIT','code_reference',             'Reference',                  'LECTURE', 0,400),
 ('COCKPIT','designation',                'Designation',                'LECTURE', 0,410),
 ('COCKPIT','classe_abc',                 'Classe ABC',                 'LECTURE', 0,420),
 ('COCKPIT','code_fournisseur',           'Fournisseur',                'LECTURE', 0,430),
 ('COCKPIT','fournisseur_nom',            'Nom du fournisseur',         'LECTURE', 0,440),
 ('COCKPIT','delai_livraison_jours',      'Delai de livraison (j)',     'LECTURE', 0,450),
 ('COCKPIT','risque_sourcing',            'Sourcing',                   'LECTURE', 0,460),
 ('COCKPIT','stock_min_kg',               'Stock minimum (kg)',         'LECTURE', 0,470),
 ('COCKPIT','stock_initial_kg',           'Stock actuel (kg)',          'LECTURE', 0,480),
 ('COCKPIT','nb_mois_rupture',            'Mois en rupture',            'LECTURE', 0,490),
 ('COCKPIT','nb_mois_tendu',              'Mois tendus',                'LECTURE', 0,500),
 ('COCKPIT','premier_mois_rupture',       'Premier mois de rupture',    'LECTURE', 0,510),
 ('COCKPIT','premier_mois_risque',        'Premier mois a risque',      'LECTURE', 0,520),
 ('COCKPIT','rang_premier_risque',        'Rang du premier risque',     'LECTURE', 0,530),
 ('COCKPIT','marge_decision_jours',       'Marge de decision (j)',      'LECTURE', 0,540),
 ('COCKPIT','mois',                       'Frise mensuelle',            'LECTURE', 0,550),
 ('COCKPIT','annee_mois',                 'Mois',                       'LECTURE', 0,560),
 ('COCKPIT','rang_mois',                  'Rang du mois',               'LECTURE', 0,570),
 ('COCKPIT','besoin_kg',                  'Besoin du mois (kg)',        'LECTURE', 0,580),
 ('COCKPIT','entrees_kg',                 'Entrees attendues (kg)',     'LECTURE', 0,590),
 ('COCKPIT','stock_fin_kg',               'Stock en fin de mois (kg)',  'LECTURE', 0,600),
 ('COCKPIT','statut',                     'Statut',                     'LECTURE', 0,610),
-- ---- STATISTIQUES (colonnes des vues v_stat_*) -------------------------
-- Genere depuis les vues elles-memes : un champ non declare vaut MASQUE,
-- et sa colonne disparaitrait sans un mot.
 ('MOUVEMENTS','annee_mois',                'Mois',                          'LECTURE', 0, 710),
 ('MOUVEMENTS','type_libelle',              'Type de mouvement',             'LECTURE', 0, 720),
 ('MOUVEMENTS','signe',                     'Sens',                          'LECTURE', 0, 730),
 ('MOUVEMENTS','couleur',                   'Couleur',                       'LECTURE', 0, 740),
 ('MOUVEMENTS','nb_mouvements',             'Nombre de mouvements',          'LECTURE', 0, 750),
 ('MOUVEMENTS','nb_lignes',                 'Nombre de lignes',              'LECTURE', 0, 760),
 ('MOUVEMENTS','nb_references',             'Nombre de references',          'LECTURE', 0, 770),
 ('MOUVEMENTS','valeur_mad',                'Valeur (MAD)',                  'LECTURE', 1, 780),
 ('MOUVEMENTS','designation',               'Designation',                   'LECTURE', 0, 790),
 ('MOUVEMENTS','classe_abc',                'Classe abc',                    'LECTURE', 0, 800),
 ('MOUVEMENTS','entrees_kg',                'Entrees (kg)',                  'LECTURE', 0, 810),
 ('MOUVEMENTS','sorties_kg',                'Sorties (kg)',                  'LECTURE', 0, 820),
 ('MOUVEMENTS','solde_kg',                  'Solde (kg)',                    'LECTURE', 0, 830),
 ('MOUVEMENTS','entrees_mad',               'Entrees (MAD)',                 'LECTURE', 1, 840),
 ('MOUVEMENTS','nb_mois_actifs',            'Mois avec mouvement',           'LECTURE', 0, 850),
 ('MOUVEMENTS','premier_mouvement',         'Premier mouvement',             'LECTURE', 0, 860),
 ('MOUVEMENTS','dernier_mouvement',         'Dernier mouvement',             'LECTURE', 0, 870),
 ('MOUVEMENTS','stock_actuel_kg',           'Stock actuel (kg)',             'LECTURE', 0, 880),
 ('MOUVEMENTS','rotation',                  'Rotation',                      'LECTURE', 0, 890),
 ('MOUVEMENTS','jours_sans_mouvement',      'Jours sans mouvement',          'LECTURE', 0, 900),
 ('VALORISATION','designation',               'Designation',                   'LECTURE', 0, 710),
 ('VALORISATION','annee_mois',                'Mois',                          'LECTURE', 0, 720),
 ('VALORISATION','code_devise',               'Code devise',                   'LECTURE', 0, 730),
 ('VALORISATION','nb_achats',                 'Nombre dachats',                'LECTURE', 0, 740),
 ('VALORISATION','nb_fournisseurs',           'Nombre de fournisseurs',        'LECTURE', 0, 750),
 ('VALORISATION','montant_mad',               'Montant mad',                   'LECTURE', 1, 760),
 ('VALORISATION','prix_moyen_devise',         'Prix moyen (devise)',           'LECTURE', 1, 770),
 ('VALORISATION','prix_moyen_mad',            'Prix moyen (MAD)',              'LECTURE', 1, 780),
 ('VALORISATION','taux_moyen',                'Taux de change moyen',          'LECTURE', 0, 790),
 ('VALORISATION','prix_min_mad',              'Prix le plus bas (MAD)',        'LECTURE', 1, 800),
 ('VALORISATION','prix_max_mad',              'Prix le plus haut (MAD)',       'LECTURE', 1, 810),
 ('VALORISATION','classe_abc',                'Classe abc',                    'LECTURE', 0, 820),
 ('VALORISATION','quantite_totale_kg',        'Quantite achetee (kg)',         'LECTURE', 0, 830),
 ('VALORISATION','montant_total_mad',         'Montant achete (MAD)',          'LECTURE', 1, 840),
 ('VALORISATION','premier_achat',             'Premier achat',                 'LECTURE', 0, 850),
 ('VALORISATION','dernier_achat',             'Dernier achat',                 'LECTURE', 0, 860),
 ('VALORISATION','premier_prix_mad',          'Premier prix (MAD)',            'LECTURE', 1, 870),
 ('VALORISATION','dernier_prix_mad',          'Dernier prix (MAD)',            'LECTURE', 1, 880),
 ('VALORISATION','premier_prix_devise',       'Premier prix (devise)',         'LECTURE', 1, 890),
 ('VALORISATION','dernier_prix_devise',       'Dernier prix (devise)',         'LECTURE', 1, 900),
 ('VALORISATION','premier_taux',              'Premier taux',                  'LECTURE', 0, 910),
 ('VALORISATION','dernier_taux',              'Dernier taux',                  'LECTURE', 0, 920),
 ('VALORISATION','derive_totale_pct',         'Derive totale (%)',             'LECTURE', 0, 930),
 ('VALORISATION','derive_fournisseur_pct',    'Derive fournisseur (%)',        'LECTURE', 0, 940),
 ('VALORISATION','derive_change_pct',         'Derive de change (%)',          'LECTURE', 0, 950),
 ('VALORISATION','impact_fournisseur_mad',    'Impact fournisseur (MAD)',      'LECTURE', 1, 960),
 ('FOURNISSEURS','fournisseur_nom',           'Nom du fournisseur',            'LECTURE', 0, 710),
 ('FOURNISSEURS','annee_mois',                'Mois',                          'LECTURE', 0, 720),
 ('FOURNISSEURS','nb_receptions',             'Nombre de receptions',          'LECTURE', 0, 730),
 ('FOURNISSEURS','nb_lignes',                 'Nombre de lignes',              'LECTURE', 0, 740),
 ('FOURNISSEURS','quantite_kg',               'Quantite kg',                   'LECTURE', 0, 750),
 ('FOURNISSEURS','montant_mad',               'Montant mad',                   'LECTURE', 1, 760),
 ('FOURNISSEURS','taux_conformite_pct',       'Taux de conformite (%)',        'LECTURE', 0, 770),
 ('FOURNISSEURS','nb_a_lheure',               'Livraisons a lheure',           'LECTURE', 0, 780),
 ('FOURNISSEURS','nb_mesurables',             'Livraisons mesurables',         'LECTURE', 0, 790),
 ('FOURNISSEURS','retard_moyen_jours',        'Retard moyen (j)',              'LECTURE', 0, 800),
 ('FOURNISSEURS','delai_reel_moyen_jours',    'Delai reel moyen (j)',          'LECTURE', 0, 810),
 ('FOURNISSEURS','nb_references',             'Nombre de references',          'LECTURE', 0, 820),
 ('FOURNISSEURS','nb_bc',                     'Nombre de bons',                'LECTURE', 0, 830),
 ('FOURNISSEURS','montant_total_mad',         'Montant achete (MAD)',          'LECTURE', 1, 840),
 ('FOURNISSEURS','nb_lignes_recues',          'Lignes recues',                 'LECTURE', 0, 850),
 ('FOURNISSEURS','taux_ponctualite_pct',      'Ponctualite (%)',               'LECTURE', 0, 860),
 ('FOURNISSEURS','ecart_pesee_moyen_pct',     'Ecart de pesee moyen (%)',      'LECTURE', 0, 870),
 ('FOURNISSEURS','otif_pct',                  'OTIF (%)',                      'LECTURE', 0, 880),
 ('FOURNISSEURS','classement',                'Classement',                    'LECTURE', 0, 890),
 ('QUALITES','qualite_nom',               'Nom de la qualite',             'LECTURE', 0, 710),
 ('QUALITES','nb_composants',             'Nombre de composants',          'LECTURE', 0, 720),
 ('QUALITES','nb_sans_cmup',              'Composants sans CMUP',          'LECTURE', 0, 730),
 ('QUALITES','kg_m2_total',               'Poids recette (kg/m2)',         'LECTURE', 0, 740),
 ('QUALITES','cout_matiere_m2_mad',       'Cout matiere (MAD/m2)',         'LECTURE', 1, 750),
 ('QUALITES','ecart_poids_pct',           'Ecart de poids (%)',            'LECTURE', 0, 760),
 ('QUALITES','m2_prevus',                 'm2 prevus',                     'LECTURE', 0, 770),
 ('QUALITES','m2_realises',               'm2 realises',                   'LECTURE', 0, 780),
 ('QUALITES','nb_mois_planifies',         'Mois planifies',                'LECTURE', 0, 790),
 ('QUALITES','taux_realisation_pct',      'Taux de realisation (%)',       'LECTURE', 0, 800),
 ('QUALITES','cout_matiere_plan_mad',     'Cout matiere du plan (MAD)',    'LECTURE', 1, 810),
 ('QUALITES','somme_pct',                 'Somme des % du role',           'LECTURE', 0, 820),
-- ---- EQUIVALENCES (colonnes de v_equivalence / v_groupe_equiv_detail) ----
 ('CATALOGUE','code_groupe_equiv',             'Groupe dequivalence',               'LECTURE', 0, 810),
 ('CATALOGUE','groupe_libelle',                'Libelle du groupe',                 'LECTURE', 0, 820),
 ('CATALOGUE','priorite',                      'Priorite',                          'LECTURE', 0, 830),
 ('CATALOGUE','est_preferentielle',            'Preferentielle',                    'LECTURE', 0, 840),
 ('CATALOGUE','stock_kg',                      'Stock (kg)',                        'LECTURE', 0, 850),
 ('CATALOGUE','stock_projete_kg',              'Stock projete (kg)',                'LECTURE', 0, 860),
 ('CATALOGUE','statut',                        'Statut',                            'LECTURE', 0, 870),
 ('CATALOGUE','besoin_12m_kg',                 'Besoin 12 mois (kg)',               'LECTURE', 0, 880),
 ('CATALOGUE','equivalent_reference',          'Reference equivalente',             'LECTURE', 0, 890),
 ('CATALOGUE','equivalent_designation',        'Designation de lequivalent',        'LECTURE', 0, 900),
 ('CATALOGUE','equivalent_fournisseur',        'Fournisseur de lequivalent',        'LECTURE', 0, 910),
 ('CATALOGUE','equivalent_fournisseur_nom',    'Nom du fournisseur equivalent',     'LECTURE', 0, 920),
 ('CATALOGUE','equivalent_delai_jours',        'Delai de lequivalent (j)',          'LECTURE', 0, 930),
 ('CATALOGUE','equivalent_priorite',           'Priorite de lequivalent',           'LECTURE', 0, 940),
 ('CATALOGUE','equivalent_preferentielle',     'Equivalent preferentiel',           'LECTURE', 0, 950),
 ('CATALOGUE','equivalent_unite',              'Unite de lequivalent',              'LECTURE', 0, 960),
 ('CATALOGUE','equivalent_prix_catalogue_kg',  'Prix catalogue de lequivalent',     'LECTURE', 1, 970),
 ('CATALOGUE','equivalent_devise',             'Devise de lequivalent',             'LECTURE', 0, 980),
 ('CATALOGUE','equivalent_stock_kg',           'Stock de lequivalent (kg)',         'LECTURE', 0, 990),
 ('CATALOGUE','equivalent_stock_projete_kg',   'Stock projete de lequivalent (kg)', 'LECTURE', 0,1000),
 ('CATALOGUE','equivalent_statut',             'Statut de lequivalent',             'LECTURE', 0,1010),
 ('CATALOGUE','equivalent_besoin_12m_kg',      'Besoin de lequivalent (kg)',        'LECTURE', 0,1020),
 ('CATALOGUE','meme_fournisseur',              'Meme fournisseur',                  'LECTURE', 0,1030),
 ('CATALOGUE','interchangeable',               'Interchangeable',                   'LECTURE', 0,1040),
 ('CATALOGUE','libelle',                       'Libelle',                           'LECTURE', 0,1050),
 ('CATALOGUE','description',                   'Description',                       'LECTURE', 0,1060),
 ('CATALOGUE','nb_references',                 'Nombre de references',              'LECTURE', 0,1070),
 ('CATALOGUE','nb_fournisseurs',               'Nombre de fournisseurs',            'LECTURE', 0,1080),
 ('CATALOGUE','nb_unites',                     'Unites distinctes',                 'LECTURE', 0,1090),
 ('CATALOGUE','nb_densites',                   'Densites distinctes',               'LECTURE', 0,1100),
 ('CATALOGUE','nb_categories',                 'Categories distinctes',             'LECTURE', 0,1110),
 ('CATALOGUE','nb_preferentielles',            'Preferentielles',                   'LECTURE', 0,1120),
 ('CATALOGUE','nb_avec_stock',                 'References avec stock',             'LECTURE', 0,1130),
 ('CATALOGUE','nb_avec_besoin',                'References avec besoin',            'LECTURE', 0,1140),
 ('CATALOGUE','stock_cumule_kg',               'Stock cumule du groupe (kg)',       'LECTURE', 0,1150),
 ('CATALOGUE','besoin_cumule_kg',              'Besoin cumule du groupe (kg)',      'LECTURE', 0,1160),
 ('CATALOGUE','qualification',                 'Qualification du groupe',           'LECTURE', 0,1170),
-- ---- REFERENTIELS CRUD (derive du registre : table + alias de selection) --
-- Un champ non declare vaut MASQUE : le formulaire ne le proposait pas, et
-- les referentiels etaient quasiment vides a lecran.
 ('CATALOGUE','ordre_affichage',           'Ordre d''affichage',              'LECTURE', 0, 1180),
 ('CATALOGUE','code_role',                 'Code du role',                    'LECTURE', 0, 1180),
 ('MOUVEMENTS','actif',                     'Actif',                           'LECTURE', 0, 1010),
 ('MOUVEMENTS','exige_motif_ligne',         'Exige un motif de ligne',         'LECTURE', 0, 1020),
 ('MOUVEMENTS','exige_of',                  'Exige un numero d''OF',           'LECTURE', 0, 1030),
 ('MOUVEMENTS','exige_prix',                'Exige un prix',                   'LECTURE', 1, 1040),
 ('MOUVEMENTS','impacte_cmup',              'Impacte le CMUP',                 'LECTURE', 0, 1050),
 ('MOUVEMENTS','libelle',                   'Libelle',                         'LECTURE', 0, 1060),
 ('MOUVEMENTS','categorie',                 'Categorie',                       'LECTURE', 0, 1010),
 ('MOUVEMENTS','signe_default',             'Sens habituel',                   'LECTURE', 0, 1020),
 ('MOUVEMENTS','code_motif_ligne',          'Code du motif',                   'LECTURE', 0, 1010),
 ('STOCK','actif',                     'Actif',                           'LECTURE', 0, 1010),
 ('STOCK','adresse',                   'Adresse',                         'LECTURE', 0, 1020),
 ('STOCK','est_quarantaine',           'Zone de quarantaine',             'LECTURE', 0, 1030),
 ('STOCK','inclure_mrp',               'Compte dans le stock disponible', 'LECTURE', 0, 1040),
 ('STOCK','nom',                       'Nom',                             'LECTURE', 0, 1050),
 ('STOCK','responsable',               'Responsable',                     'LECTURE', 0, 1060),
 ('STOCK','type',                      'Type',                            'LECTURE', 0, 1070),
 ('FOURNISSEURS','adresse',                   'Adresse',                         'LECTURE', 0, 1010),
 ('FOURNISSEURS','date_creation',             'Date creation',                   'LECTURE', 0, 1020),
 ('FOURNISSEURS','incoterm',                  'Incoterm',                        'LECTURE', 0, 1030),
 ('FOURNISSEURS','transporteur',              'Transporteur',                    'LECTURE', 0, 1040),
 ('CATALOGUE','date_creation',             'Date creation',                   'LECTURE', 0, 1180),
 ('CATALOGUE','date_dernier_abc',          'Date dernier abc',                'LECTURE', 0, 1190),
 ('CATALOGUE','date_dernier_cmup',         'Date dernier cmup',               'LECTURE', 0, 1200),
 ('CATALOGUE','date_prix_catalogue',       'Date du prix catalogue',          'LECTURE', 1, 1210),
 ('CATALOGUE','date_debut',                'Date de debut',                   'LECTURE', 0, 1180),
 ('CATALOGUE','date_fin',                  'Date de fin',                     'LECTURE', 0, 1190),
-- ---- TRANSFERTS (entete, lignes et bons imprimables) ----------------------
-- Le transfert est un DOCUMENT du module MOUVEMENTS : son entete, ses lignes et
-- les deux bons imprimables tirent leurs colonnes d'ici. Sans ces lignes, la
-- colonne « ou est la marchandise » disparaissait de la liste sans un mot.
 ('MOUVEMENTS','numero_transfert',       'Numero du transfert',      'LECTURE', 0, 1300),
 ('MOUVEMENTS','date_transfert',         'Date du document',         'LECTURE', 0, 1310),
 ('MOUVEMENTS','statut',                 'Statut',                   'LECTURE', 0, 1320),
 ('MOUVEMENTS','code_magasin_source',    'Magasin expediteur',       'LECTURE', 0, 1330),
 ('MOUVEMENTS','code_magasin_dest',      'Magasin destinataire',     'LECTURE', 0, 1340),
 ('MOUVEMENTS','magasin_source_nom',     'Nom du magasin source',    'LECTURE', 0, 1350),
 ('MOUVEMENTS','magasin_dest_nom',       'Nom du magasin destinataire','LECTURE',0,1360),
 ('MOUVEMENTS','date_sortie',            'Date de sortie',           'LECTURE', 0, 1370),
 ('MOUVEMENTS','date_reception_dest',    'Date de reception',        'LECTURE', 0, 1380),
 ('MOUVEMENTS','responsable',            'Responsable',              'LECTURE', 0, 1390),
 ('MOUVEMENTS','transporteur',           'Transporteur',             'LECTURE', 0, 1400),
 ('MOUVEMENTS','observations',           'Observations',             'LECTURE', 0, 1410),
 ('MOUVEMENTS','auteur',                 'Cree par',                 'LECTURE', 0, 1420),
 ('MOUVEMENTS','expediteur',             'Expedie par',              'LECTURE', 0, 1430),
 ('MOUVEMENTS','receptionnaire',         'Recu par',                 'LECTURE', 0, 1440),
 ('MOUVEMENTS','jours_en_transit',       'Jours en transit',         'LECTURE', 0, 1450),
 ('MOUVEMENTS','ligne_numero',           'Numero de ligne',          'LECTURE', 0, 1460),
 ('MOUVEMENTS','quantite_saisie',        'Quantite saisie',          'LECTURE', 0, 1470),
 ('MOUVEMENTS','unite_saisie',           'Unite de saisie',          'LECTURE', 0, 1480),
 ('MOUVEMENTS','nb_bobines',             'Nombre de bobines',        'LECTURE', 0, 1490),
 ('MOUVEMENTS','nb_palettes',            'Nombre de palettes',       'LECTURE', 0, 1500),
 ('MOUVEMENTS','quantite_totale_kg',     'Quantite totale (kg)',     'LECTURE', 0, 1510),
 ('MOUVEMENTS','bobines_totales',        'Total des bobines',        'LECTURE', 0, 1520),
 ('MOUVEMENTS','palettes_totales',       'Total des palettes',       'LECTURE', 0, 1530),
 -- La valeur transportee est une donnee monetaire : masquee au magasin et a la
 -- qualite comme tout ce qui porte un prix (B4 regle 1). Les deux bons
 -- imprimables ne l'affichent pas ; ils n'en ont pas besoin.
 ('MOUVEMENTS','valeur_totale_mad',      'Valeur transportee (MAD)', 'LECTURE', 1, 1540),
-- ---- PLAN D'ACHAT : FIGEMENT DES PROPOSITIONS -----------------------------
-- Une ligne retouchee par l'acheteur est protegee du recalcul. L'ecart entre ce
-- qu'elle porte et ce que le calcul dit aujourd'hui se lit sur la ligne : une
-- protection qui rendrait aveugle serait pire que pas de protection.
 ('PLAN_ACHAT','figee',                'Protegee du recalcul',      'LECTURE', 0, 1300),
 ('PLAN_ACHAT','figee_par',            'Protegee par',              'LECTURE', 0, 1310),
 ('PLAN_ACHAT','date_figement',        'Date de protection',        'LECTURE', 0, 1320),
 ('PLAN_ACHAT','motif_figement',       'Motif de la protection',    'LECTURE', 0, 1330),
 ('PLAN_ACHAT','quantite_mrp_kg',      'Quantite calculee au depart (kg)', 'LECTURE', 0, 1340),
 ('PLAN_ACHAT','quantite_calculee_kg', 'Quantite calculee aujourdhui (kg)','LECTURE', 0, 1350),
 ('PLAN_ACHAT','ecart_calcul_kg',      'Ecart avec le calcul (kg)', 'LECTURE', 0, 1360),
 ('PLAN_ACHAT','etat_figement',        'Coherence de la protection','LECTURE', 0, 1370),
-- ---- PARAMETRES ------------------------------------------------------------
 ('PARAMETRES','code_parametre',  'Code',            'LECTURE', 0, 10),
 ('PARAMETRES','libelle',         'Libelle',         'LECTURE', 0, 20),
 ('PARAMETRES','valeur_courante', 'Valeur',          'LECTURE', 0, 30),
 ('PARAMETRES','unite',           'Unite',           'LECTURE', 0, 40),
 ('PARAMETRES','categorie',       'Categorie',       'LECTURE', 0, 50),
 ('PARAMETRES','verrouille',      'Verrouille',      'LECTURE', 0, 60),
-- ---- AUDIT -----------------------------------------------------------------
 ('AUDIT','date_operation',    'Date',               'LECTURE', 0, 10),
 ('AUDIT','table_concernee',   'Table',              'LECTURE', 0, 20),
 ('AUDIT','operation',         'Operation',          'LECTURE', 0, 30),
 ('AUDIT','auteur',            'Auteur',             'LECTURE', 0, 40),
 ('AUDIT','anciennes_valeurs', 'Anciennes valeurs',  'LECTURE', 0, 50),
 ('AUDIT','nouvelles_valeurs', 'Nouvelles valeurs',  'LECTURE', 0, 60),
 ('AUDIT','adresse_ip',        'Adresse IP',         'LECTURE', 0, 70),
-- ---- UTILISATEURS ----------------------------------------------------------
 ('UTILISATEURS','login',              'Identifiant',        'LECTURE', 0, 10),
 ('UTILISATEURS','nom',                'Nom',                'LECTURE', 0, 20),
 ('UTILISATEURS','code_role_user',     'Role',               'LECTURE', 0, 30),
 ('UTILISATEURS','email',              'Email',              'LECTURE', 0, 40),
 ('UTILISATEURS','telephone',          'Telephone',          'LECTURE', 0, 50),
 ('UTILISATEURS','magasin_principal',  'Magasin principal',  'LECTURE', 0, 60),
 ('UTILISATEURS','mfa_actif',          'Double facteur',     'LECTURE', 0, 70),
 ('UTILISATEURS','derniere_connexion', 'Derniere connexion', 'LECTURE', 0, 80),
 ('UTILISATEURS','actif',              'Actif',              'LECTURE', 0, 90);

-- =============================================================================
-- 3. MODELES DE DROITS PAR ROLE
--
-- Derives de la matrice D2 et du marquage `sensible` :
--   * champ sensible + role MAGASIN ou QUALITE  -> MASQUE  (CDC B4 regle 1)
--   * le role a ECRIRE sur le module            -> ECRITURE
--   * le role a LIRE sur le module              -> LECTURE
--   * aucun acces au module                     -> MASQUE
--
-- Ces modeles ne sont JAMAIS consultes lors d'une requete : ils servent
-- uniquement a initialiser la grille d'un utilisateur.
-- =============================================================================
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
           WHEN c.sensible = 1 AND r.code_role_user IN ('MAGASIN','QUALITE') THEN 'MASQUE'
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = c.module AND p.action = 'ECRIRE') THEN 'ECRITURE'
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = c.module AND p.action = 'LIRE') THEN 'LECTURE'
           ELSE 'MASQUE'
       END
FROM role_utilisateur r
CROSS JOIN champ_configurable c;

-- 3a. Valeurs DERIVEES : jamais modifiables, quel que soit le module.
-- Les corriger a la main ferait diverger le calcul de son resultat.
UPDATE modele_droit_champ SET niveau = 'LECTURE'
 WHERE niveau = 'ECRITURE'
   AND champ IN ('facteur_kg','prix_catalogue_kg','cmup_mad','valeur_mad','total_mad',
                 'total_devise','total_ligne_devise','ecart_pct','ecart_kg','ecart_mad',
                 'kg_m2','quantite_recue_kg','quantite_stock_kg','montant_estime_mad',
                 'stock_projete_kg','jours_couverture','derniere_connexion',
                 'quantite_theorique_kg','nb_references','taux_change');

-- 3b. IDENTIFIANTS : non modifiables APRES creation, dans le module dont ils
-- sont la cle. Un code de reference est cite par les mouvements, les recettes
-- et les commandes : le renommer romprait ces liens.
--
-- La restriction est portee par le couple (module, champ), pas par le seul nom
-- de champ : `code_fournisseur` est la cle dans FOURNISSEURS, mais une simple
-- cle etrangere dans CATALOGUE, ou il doit rester saisissable.
UPDATE modele_droit_champ SET niveau = 'LECTURE'
 WHERE niveau = 'ECRITURE'
   AND (module, champ) IN (VALUES
        ('CATALOGUE','code_reference'),
        ('QUALITES','code_qualite'),
        ('FOURNISSEURS','code_fournisseur'),
        ('PARAMETRES','code_parametre'),
        ('BONS_COMMANDE','numero_bc'),
        ('RECEPTIONS','numero_reception'),
        ('MOUVEMENTS','numero_mouvement'),
        ('INVENTAIRE','numero_inventaire'),
        ('UTILISATEURS','login'));

-- 3c. Valeurs derivees PROPRES A UN MODULE.
-- `actif` se saisit dans CATALOGUE ou UTILISATEURS ; dans QUALITES il decoule du
-- statut. Le poids commercial d'une qualite est la somme de ses lignes : le
-- saisir a la main le ferait diverger de sa propre composition.
UPDATE modele_droit_champ SET niveau = 'LECTURE'
 WHERE niveau = 'ECRITURE'
   AND (module, champ) IN (VALUES
        ('QUALITES','actif'),
        ('QUALITES','poids_commercial_m2'),
        ('QUALITES','role_libelle'),
        ('QUALITES','entre_poids_commercial'),
        ('QUALITES','nb_roles'),
        ('QUALITES','nb_composition'),
        ('QUALITES','nb_roles_composes'),
        ('QUALITES','nb_roles_hors_100'),
        ('QUALITES','nb_lignes_plan'),
        ('QUALITES','date_creation'),
        ('QUALITES','cree_par'),
        ('QUALITES','date_modification'),
        ('QUALITES','modifie_par'),
        ('QUALITES','date_cloture'),
        ('QUALITES','designation'),
        ('QUALITES','ligne_numero'),
        ('QUALITES','type_fil'),
        ('QUALITES','categorie'),
        ('QUALITES','fournisseur'),
        ('QUALITES','prix_kg_mad'),
        ('QUALITES','code_devise_catalogue'),
        ('QUALITES','cout_m2_mad'),
        ('QUALITES','source_prix'),
        -- Le statut d'une recette ne se saisit pas : il resulte d'une transition
        -- declaree (soumission, validation, cloture), chacune avec son controle.
        ('RECETTES','qualite_nom'),
        ('RECETTES','statut_qualite'),
        ('RECETTES','designation'),
        ('RECETTES','code_fournisseur'),
        ('RECETTES','fournisseur'),
        ('RECETTES','code_fournisseur_prefere'),
        ('RECETTES','role_libelle'),
        ('RECETTES','densite_role'),
        ('RECETTES','unite_densite'),
        ('RECETTES','ligne_numero'),
        ('PLANS','statut'),
        ('PLANS','actif'),
        ('PLANS','annee'),
        ('PLANS','numero_version'),
        ('PLANS','date_fin'),
        ('PLANS','mois'),
        ('PLANS','rang_mois'),
        ('PLANS','annee_mois'),
        ('PLANS','qualite_nom'),
        ('PLANS','m2_prevus'),
        ('PLANS','saisonnalite'),
        ('PLANS','facteur_croissance'),
        ('PLANS','m2_total_annuel'),
        ('PLANS','m2_total'),
        ('PLANS','nb_lignes'),
        ('PLANS','nb_qualites'),
        ('PLANS','nb_qualites_perimees'),
        ('PLANS','nb_besoins'),
        ('PLANS','date_creation'),
        ('PLANS','cree_par'),
        ('PLANS','date_modification'),
        ('PLANS','modifie_par'),
        ('PLANS','date_validation'),
        ('PLANS','valide_par'),
        ('PLANS','date_cloture'),
        ('PLANS','cloture_par'));

-- =============================================================================
-- 4. COMPTES DE DEMARRAGE
--
-- ATTENTION : le hash ci-dessous est un MARQUEUR INVALIDE, aucune connexion
-- n'est possible avec. Definir les mots de passe reels via :
--     cargo run --bin gestionfil-admin -- definir-mot-de-passe <login>
-- =============================================================================
INSERT INTO utilisateur (id_utilisateur, code_role_user, login, mot_de_passe_hash, nom, magasin_principal, mfa_actif) VALUES
    ('00000000-0000-4000-a000-000000000010','DIRECTION','direction','!A_DEFINIR!','Direction Generale',         NULL,     1),
    ('00000000-0000-4000-a000-000000000011','DAF',      'daf',      '!A_DEFINIR!','Direction Administrative',   NULL,     1),
    ('00000000-0000-4000-a000-000000000012','ACHAT',    'achat',    '!A_DEFINIR!','Service Achats',             NULL,     1),
    ('00000000-0000-4000-a000-000000000013','PLANIF',   'planif',   '!A_DEFINIR!','Planification',              NULL,     0),
    ('00000000-0000-4000-a000-000000000014','QUALITE',  'qualite',  '!A_DEFINIR!','Controle Qualite',           'ZON-QUA',0),
    ('00000000-0000-4000-a000-000000000015','MAGASIN',  'magasin',  '!A_DEFINIR!','Magasin Matieres Premieres', 'MP-01',  0);

-- Initialisation des grilles individuelles depuis le modele de chaque role.
-- A partir d'ici, la grille appartient a l'utilisateur : la modifier n'affecte
-- personne d'autre, et changer le modele n'affecte plus les comptes existants.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
FROM utilisateur u
JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user;
