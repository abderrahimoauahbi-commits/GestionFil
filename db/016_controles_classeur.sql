-- =============================================================================
-- ERP GESTION FIL — les controles du classeur qui manquaient
-- -----------------------------------------------------------------------------
-- La feuille Tests du classeur porte vingt verifications croisees. Dix-sept ont
-- deja leur equivalent parmi les controles C01 a C29 ; deux ne concernent que la
-- plomberie d'Excel (tableau vide, formules auxiliaires hors-tableau) et n'ont
-- pas de sens ici. Restent trois regles reelles, ajoutees ci-dessous.
--
-- CORRESPONDANCE AVEC LE CLASSEUR :
--   T12 delai fournisseur negatif ou nul        -> C30
--   T17 ligne de reception non repercutee stock -> C31
--   T19 ligne de reception non repercutee prix  -> C32
--
-- LES DEUX DERNIERS VERIFIENT LA CASCADE DE RECEPTION. Valider une reception
-- doit faire trois choses d'un coup : entrer la marchandise au stock, inscrire
-- le prix paye a l'historique, et solder la ligne de commande. Si l'une des
-- trois manque, rien ne le signale — le stock est faux ou le prix perdu, et on
-- ne s'en apercoit qu'au prochain inventaire. Ces controles ferment cet angle.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- C30 — delai de livraison absent, nul ou negatif
-- -----------------------------------------------------------------------------
-- Le delai entre dans le calcul de couverture et dans le stock minimum
-- dynamique. A zero, la reference parait toujours approvisionnable a temps ;
-- l'alerte de rupture arrive alors le jour ou il est trop tard pour commander.
DROP VIEW IF EXISTS v_ctl_c30;
CREATE VIEW v_ctl_c30 AS
SELECT f.code_fournisseur,
       f.nom,
       f.delai_livraison_jours,
       (SELECT COUNT(*) FROM reference r
         WHERE r.code_fournisseur = f.code_fournisseur AND r.actif = 1) AS nb_references
  FROM fournisseur f
 WHERE f.actif = 1
   AND (f.delai_livraison_jours IS NULL OR f.delai_livraison_jours <= 0);


-- -----------------------------------------------------------------------------
-- C31 — ligne de reception validee sans mouvement de stock
-- -----------------------------------------------------------------------------
-- Le rapprochement se fait sur la reference ET la quantite pesee : deux
-- receptions de la meme reference le meme jour restent distinguables par leur
-- poids, qui n'est jamais rond.
DROP VIEW IF EXISTS v_ctl_c31;
CREATE VIEW v_ctl_c31 AS
SELECT rc.numero_reception,
       rc.date_reception,
       lr.code_reference,
       lr.quantite_stock_kg,
       lr.lot_fournisseur
  FROM ligne_reception lr
  JOIN reception rc ON rc.id_reception = lr.id_reception
 WHERE rc.statut = 'VALIDE'
   AND COALESCE(lr.quantite_stock_kg, 0) > 0
   AND NOT EXISTS (
         SELECT 1
           FROM ligne_mouvement lm
           JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
          WHERE lm.code_reference = lr.code_reference
            AND ABS(lm.quantite_kg - lr.quantite_stock_kg) < 0.001
            AND (lr.lot_fournisseur IS NULL
                 OR lm.lot_fournisseur IS lr.lot_fournisseur));


-- -----------------------------------------------------------------------------
-- C32 — ligne de reception valorisee sans trace dans l'historique des prix
-- -----------------------------------------------------------------------------
-- L'historique des prix est la seule source honnete pour dire si un fournisseur
-- derive : il n'enregistre que du prix REELLEMENT paye. Une ligne qui n'y entre
-- pas rend la reference invisible a la negociation, sans que rien ne l'indique.
DROP VIEW IF EXISTS v_ctl_c32;
CREATE VIEW v_ctl_c32 AS
SELECT rc.numero_reception,
       rc.date_reception,
       lr.code_reference,
       lr.prix_kg_mad,
       lr.quantite_stock_kg
  FROM ligne_reception lr
  JOIN reception rc ON rc.id_reception = lr.id_reception
 WHERE rc.statut = 'VALIDE'
   AND lr.prix_kg_mad IS NOT NULL
   AND lr.prix_kg_mad > 0
   AND NOT EXISTS (
         SELECT 1 FROM historique_prix hp
          WHERE hp.id_ligne_reception = lr.id_ligne_reception);


-- -----------------------------------------------------------------------------
-- Rattachement au tableau de bord
-- -----------------------------------------------------------------------------
-- Les trois lignes qui les exposent vivent dans `v_controles`, definie en
-- 012_controles.sql. Une vue par-dessus une autre aurait fonctionne mais aurait
-- laisse deux definitions du meme tableau : celle qu'on lit et celle qui compte.
