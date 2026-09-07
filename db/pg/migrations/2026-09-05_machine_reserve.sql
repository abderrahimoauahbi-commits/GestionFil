-- =============================================================================
-- MIGRATION 2026-09-05 — LA ZONE « RESERVE »
-- -----------------------------------------------------------------------------
-- Une machine porte du fil ailleurs que sur ses etages : la chaine, la trame,
-- et une reserve — le fil deja sorti du magasin, au pied du metier, pas encore
-- monte.
--
-- CE QUE CETTE MIGRATION MONTRE. Les roles passent par le meme chemin depuis le
-- premier jour : meme table, meme stock, meme declencheur de capacite, meme
-- geste, meme controle. Le role ne sert qu'au PLAN. Ajouter une zone ne coute
-- donc qu'une contrainte elargie — pas une table, pas un type de mouvement, pas
-- une branche dans le code metier.
--
-- LE SEUL POINT DELICAT est ailleurs : `libelle` est une colonne GENEREE, et
-- PostgreSQL n'en modifie pas l'expression. Il faut la reposer — donc deposer
-- d'abord les quatre vues de controle qui la lisent, puis les recreer a
-- l'identique. Leur texte est EXTRAIT de db/pg/012_controles.sql au moment
-- d'ecrire cette migration : les deux fichiers ne peuvent pas diverger.
--
--     cd /tmp
--     cat /home/sysadmin/gestionfil/db/pg/migrations/2026-09-05_machine_reserve.sql |
--         sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
-- =============================================================================

BEGIN;

-- --- 1. Ce qui depend du libelle ---------------------------------------------
DROP VIEW IF EXISTS v_controles CASCADE;
DROP VIEW IF EXISTS v_ctl_c33 CASCADE;
DROP VIEW IF EXISTS v_ctl_c34 CASCADE;
DROP VIEW IF EXISTS v_ctl_c35 CASCADE;
DROP VIEW IF EXISTS v_ctl_c36 CASCADE;
DROP VIEW IF EXISTS v_ctl_c37 CASCADE;

-- --- 2. Le role et le libelle -------------------------------------------------
ALTER TABLE machine_emplacement DROP COLUMN IF EXISTS libelle;

DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'machine_emplacement'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%ETAGE%CHAINE%TRAME%'
           AND pg_get_constraintdef(oid) NOT LIKE '%RESERVE%'
    LOOP
        EXECUTE format('ALTER TABLE machine_emplacement DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE machine_emplacement DROP CONSTRAINT IF EXISTS ck_empl_role;
ALTER TABLE machine_emplacement
    ADD CONSTRAINT ck_empl_role
    CHECK (role IN ('ETAGE','CHAINE','TRAME','RESERVE'));

ALTER TABLE machine_emplacement
    ADD COLUMN libelle text GENERATED ALWAYS AS (
        CASE role
            WHEN 'ETAGE'   THEN 'Etage ' || CAST(numero_etage AS text)
            WHEN 'CHAINE'  THEN 'Chaine'
            WHEN 'TRAME'   THEN 'Trame'
            WHEN 'RESERVE' THEN 'Reserve'
        END) STORED;

-- La reserve est unique par machine, comme la chaine et la trame.
DROP INDEX IF EXISTS ux_empl_role_unique;
CREATE UNIQUE INDEX ux_empl_role_unique ON machine_emplacement(code_machine, role)
    WHERE role IN ('CHAINE','TRAME','RESERVE');

-- --- 3. Les vues, reposees a l'identique -------------------------------------

-- MACHINES — C33 a C37
-- -----------------------------------------------------------------------------
-- Les deux premiers ne devraient JAMAIS rien remonter : le declencheur
-- trg_lmvt_capacite interdit le depassement a l'ecriture. S'ils sortent, ce
-- n'est pas la capacite qui a ete violee, c'est le CACHE de bobines qui a
-- derive — meme logique que C11 et C15 pour les kilos.
-- =============================================================================

DROP VIEW IF EXISTS v_ctl_c33 CASCADE;
CREATE VIEW v_ctl_c33 AS
SELECT e.code_machine, e.code_emplacement, e.libelle, e.capacite_bobines,
       COALESCE(SUM(sl.nb_bobines), 0) AS bobines_presentes
FROM machine_emplacement e
LEFT JOIN stock_lot sl ON sl.code_magasin = e.code_magasin
GROUP BY e.code_machine, e.code_emplacement, e.libelle, e.capacite_bobines
HAVING COALESCE(SUM(sl.nb_bobines), 0) > e.capacite_bobines;

DROP VIEW IF EXISTS v_ctl_c34 CASCADE;
CREATE VIEW v_ctl_c34 AS
SELECT m.code_machine, m.nom, m.capacite_bobines,
       COALESCE(SUM(sl.nb_bobines), 0) AS bobines_presentes
FROM machine m
LEFT JOIN machine_emplacement e ON e.code_machine = m.code_machine
LEFT JOIN stock_lot sl ON sl.code_magasin = e.code_magasin
GROUP BY m.code_machine, m.nom, m.capacite_bobines
HAVING COALESCE(SUM(sl.nb_bobines), 0) > m.capacite_bobines;

-- C35 : L'AUDIT DU MODE ESTIMATION.
--
-- C'est le controle qui donne son sens a la colonne `mode_pesee`. L'estimation
-- est legitime — un operateur qui depose des bobines a moitie vides a raison de
-- saisir 50 %, et le bloquer l'empecherait de travailler. Mais une estimation
-- tres eloignee du catalogue est soit une bobine reellement inhabituelle, soit
-- une saisie faite pour aller vite. Les deux meritent d'etre regardees a froid,
-- et celui qui a saisi est nomme.
DROP VIEW IF EXISTS v_ctl_c35 CASCADE;
CREATE VIEW v_ctl_c35 AS
SELECT lm.id_ligne_mouvement, mv.numero_mouvement, mv.date_mouvement,
       e.code_machine, e.libelle,
       lm.code_reference, lm.lot_fournisseur, lm.nb_bobines,
       lm.quantite_kg, lm.pourcentage_restant,
       lm.poids_unitaire_theorique_kg, lm.poids_reel_moyen_bobine_kg,
       ROUND(lm.ecart_theorique_pct, 2) AS ecart_theorique_pct,
       mv.responsable, mv.id_utilisateur
FROM ligne_mouvement lm
JOIN mouvement mv ON mv.id_mouvement = lm.id_mouvement
JOIN machine_emplacement e ON e.code_magasin = mv.code_magasin
WHERE lm.mode_pesee = 'ESTIMATION'
  AND lm.ecart_theorique_pct IS NOT NULL
  AND abs(lm.ecart_theorique_pct) >
      (SELECT CAST(valeur_courante AS numeric) FROM parametre
        WHERE code_parametre = 'P_TolerEstimMachine');

-- C36 : EMPLACEMENT NON INVENTORIE DEPUIS TROP LONGTEMPS.
--
-- Le stock d'une machine repose sur une hypothese : retirer N bobines retire
-- N fois le poids moyen de l'emplacement, faute de suivre les bobines une par
-- une. La correction d'inventaire absorbe l'ecart de cette hypothese. Espacee,
-- elle ne l'absorbe plus, et l'ecart s'installe sans que personne le voie.
--
-- Comparaison de textes ISO-8601 : elle est exacte par construction, les dates
-- s'y ordonnant comme des chaines. Un emplacement vide n'est pas signale — il
-- n'y a rien a compter dessus.
DROP VIEW IF EXISTS v_ctl_c36 CASCADE;
CREATE VIEW v_ctl_c36 AS
SELECT e.code_machine, e.code_emplacement, e.libelle,
       MAX(sm.date_dernier_inventaire) AS dernier_inventaire,
       ROUND(SUM(sm.quantite_kg), 3) AS quantite_kg
FROM machine_emplacement e
JOIN stock_magasin sm ON sm.code_magasin = e.code_magasin
WHERE e.actif = 1
GROUP BY e.code_machine, e.code_emplacement, e.libelle
HAVING SUM(sm.quantite_kg) > 0
   AND (MAX(sm.date_dernier_inventaire) IS NULL
     OR MAX(sm.date_dernier_inventaire) <
        to_char((now() AT TIME ZONE 'UTC')
                - make_interval(days => (SELECT CAST(valeur_courante AS integer)
                                           FROM parametre
                                          WHERE code_parametre = 'P_JoursInventMachine')),
                'YYYY-MM-DD'));

-- C37 : LES DEUX COMPTEURS ONT DIVERGE.
--
-- Des bobines sans kilos, ou des kilos sans bobines : dans les deux cas le
-- poids moyen par bobine devient absurde, et c'est lui qui sert a calculer ce
-- qui quitte l'emplacement lors d'une depose. L'anomalie est donc CRITIQUE :
-- elle fausse silencieusement tous les retraits suivants.
DROP VIEW IF EXISTS v_ctl_c37 CASCADE;
CREATE VIEW v_ctl_c37 AS
SELECT e.code_machine, e.libelle, sl.code_reference, sl.lot_fournisseur,
       sl.quantite_kg, sl.nb_bobines
FROM stock_lot sl
JOIN machine_emplacement e ON e.code_magasin = sl.code_magasin
WHERE (sl.quantite_kg > 0 AND sl.nb_bobines = 0)
   OR (sl.quantite_kg = 0 AND sl.nb_bobines > 0);

DROP VIEW IF EXISTS v_controles CASCADE;
CREATE VIEW v_controles AS
SELECT 'C01' AS code, 'Somme des % <> 100 par role BOM'                AS controle, 'BLOQUANT'  AS criticite, (SELECT COUNT(*) FROM v_ctl_c01) AS anomalies UNION ALL
SELECT 'C02', 'BC envoyes non soldes depuis plus de 30j',              'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c02) UNION ALL
SELECT 'C03', 'Reference de mouvement absente du catalogue',           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c03) UNION ALL
SELECT 'C04', 'Fournisseur de reference inexistant',                   'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c04) UNION ALL
SELECT 'C05', 'Stock projete negatif sur 12 mois',                     'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c05) UNION ALL
SELECT 'C06', 'Mouvement date dans le futur',                          'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c06) UNION ALL
SELECT 'C07', 'Sortie production sans numero d''OF',                   'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c07) UNION ALL
SELECT 'C08', 'Retour sans motif de ligne',                            'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c08) UNION ALL
SELECT 'C09', 'Mouvement sans utilisateur',                            'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c09) UNION ALL
SELECT 'C10', 'Ecart de pesee hors tolerance sans derogation',         'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c10) UNION ALL
SELECT 'C11', 'Derive solde de stock vs grand livre',                  'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c11) UNION ALL
SELECT 'C12', 'Reference active a prix nul',                           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c12) UNION ALL
SELECT 'C13', 'Reference active sans fournisseur',                     'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c13) UNION ALL
SELECT 'C14', 'Composant de recette validee a cout nul',               'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c14) UNION ALL
SELECT 'C15', 'Derive stock par lot vs stock par magasin',             'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c15) UNION ALL
SELECT 'C16', 'Role de recette sans densite sur la qualite',           'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c16) UNION ALL
SELECT 'C17', 'Reference active sans recette (orpheline)',             'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c17) UNION ALL
SELECT 'C18', 'Qualite planifiee sans densite de role',                'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c18) UNION ALL
SELECT 'C19', 'Devise catalogue sans taux de change en vigueur',       'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c19) UNION ALL
SELECT 'C20', 'Reference classe A mono-source',                        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c20) UNION ALL
SELECT 'C21', 'Role avec densite mais sans matiere en recette',        'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c21) UNION ALL
SELECT 'C22', 'Groupe d''equivalence aux references non interchangeables', 'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c22) UNION ALL
SELECT 'C23', 'Groupe d''equivalence sans reference preferentielle',     'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c23) UNION ALL
SELECT 'C24', 'Reception d''une autre reference sans substitution declaree', 'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c24) UNION ALL
SELECT 'C25', 'Stock mobilisable face a un equivalent en tension',        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c25) UNION ALL
SELECT 'C26', 'Groupe d''equivalence limite a un seul fournisseur',        'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c26) UNION ALL
SELECT 'C27', 'Ecart majeur : couverture confortable, magasin sous le minimum', 'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c27) UNION ALL
SELECT 'C28', 'Commande en retard, retiree du calcul de couverture',      'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c28) UNION ALL
SELECT 'C29', 'Besoins plus anciens que le plan : projection perimee',    'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c29) UNION ALL
-- Les trois derniers viennent de la feuille Tests du classeur (T12, T17, T19).
-- Leurs vues de detail sont definies dans 016_controles_classeur.sql, charge
-- juste avant celui-ci lors de la construction.
SELECT 'C30', 'Delai fournisseur absent, nul ou negatif',                'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c30) UNION ALL
SELECT 'C31', 'Reception validee non repercutee au stock',               'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c31) UNION ALL
SELECT 'C32', 'Reception valorisee absente de l''historique des prix',   'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c32) UNION ALL
-- MACHINES. C33 et C34 traquent une derive du cache de bobines, pas un
-- depassement : le declencheur rend celui-ci impossible a l''ecriture.
SELECT 'C33', 'Emplacement de machine au-dela de sa capacite',          'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c33) UNION ALL
SELECT 'C34', 'Machine au-dela de sa capacite totale',                  'BLOQUANT',  (SELECT COUNT(*) FROM v_ctl_c34) UNION ALL
SELECT 'C35', 'Estimation de poids hors tolerance en machine',          'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c35) UNION ALL
SELECT 'C36', 'Emplacement de machine sans inventaire recent',          'ATTENTION', (SELECT COUNT(*) FROM v_ctl_c36) UNION ALL
SELECT 'C37', 'Bobines sans kilos, ou kilos sans bobines, en machine',  'CRITIQUE',  (SELECT COUNT(*) FROM v_ctl_c37);

COMMIT;
