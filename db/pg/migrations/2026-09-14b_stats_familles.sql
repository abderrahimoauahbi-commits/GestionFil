-- LES STATISTIQUES PAR FAMILLE, 14 septembre 2026.
--
-- C'est la forme que les classeurs tiennent depuis toujours : une feuille par
-- famille — PP 2650-2900, PLY SHRINK 1200-1500, JUTE, COLLE, CUIR — et dans
-- chaque feuille, les couleurs en colonnes et les arrivees en lignes. La
-- famille est l'axe sur lequel l'atelier raisonne : on ne demande pas « combien
-- de PP-1500 Dtex-Bleu 6666-Hs », on demande « combien de 1500 dtex, et de
-- quelle couleur ».
--
-- TROIS VUES, TROIS QUESTIONS.
--
--   v_stat_famille          — ce que chaque famille pese : references, stock,
--                             valeur, entrees et sorties de l'annee.
--   v_stat_famille_couleur  — le croisement du classeur : kilos entres par
--                             famille, par couleur et par annee.
--   v_stat_categorie        — le meme decompte un cran au-dessus, pour la
--                             lecture de direction.
--
-- CE QUI N'A PAS DE FAMILLE EST COMPTE QUAND MEME, sous « (sans famille) ». Une
-- statistique qui ecarte silencieusement les references non classees donne un
-- total faux, et fait croire le catalogue plus propre qu'il n'est. Le jour ou
-- cette ligne est a zero, le classement est termine.
--
-- L'ANNEE VIENT DE LA DATE DU MOUVEMENT, sur quatre caracteres : les dates sont
-- stockees en texte ISO, donc `left(date, 4)` est exact et se compare sans
-- conversion.

-- -----------------------------------------------------------------------------
-- Ce que chaque famille pese aujourd'hui.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stat_famille AS
WITH refs AS (
    SELECT r.code_reference,
           COALESCE(r.code_famille, '(sans famille)')    AS code_famille,
           COALESCE(f.libelle, 'Sans famille')           AS famille_libelle,
           COALESCE(r.code_categorie, '(sans categorie)') AS code_categorie,
           COALESCE(c.libelle, 'Sans categorie')          AS categorie_libelle
      FROM reference r
      LEFT JOIN famille f           ON f.code_famille   = r.code_famille
      LEFT JOIN categorie_matiere c ON c.code_categorie = r.code_categorie
     WHERE r.actif = 1
),
stock AS (
    SELECT re.code_famille,
           sum(s.quantite_kg)                     AS stock_kg,
           sum(s.valeur_mad)                      AS valeur_dhs,
           count(DISTINCT s.code_reference) FILTER (WHERE s.quantite_kg > 0) AS refs_en_stock
      FROM stock_magasin s
      JOIN refs re ON re.code_reference = s.code_reference
     GROUP BY re.code_famille
),
flux AS (
    SELECT re.code_famille,
           left(m.date_mouvement, 4)                                  AS annee,
           sum(l.quantite_kg) FILTER (WHERE t.signe =  1)              AS entrees_kg,
           sum(l.quantite_kg) FILTER (WHERE t.signe = -1)              AS sorties_kg,
           sum(l.total_mad)   FILTER (WHERE t.signe =  1)              AS entrees_dhs
      FROM ligne_mouvement l
      JOIN mouvement m       ON m.id_mouvement  = l.id_mouvement
      JOIN type_mouvement t  ON t.code_type_mvt = m.code_type_mvt
      JOIN refs re           ON re.code_reference = l.code_reference
     GROUP BY re.code_famille, left(m.date_mouvement, 4)
)
SELECT re.code_famille,
       max(re.famille_libelle)                       AS famille_libelle,
       -- UNE FAMILLE APPARTIENT A UNE CATEGORIE — sauf la ligne « sans
       -- famille », qui les traverse toutes. Y afficher l'une d'elles au hasard
       -- ferait lire « Simili Cuir » devant soixante-douze references de
       -- polypropylene.
       CASE WHEN count(DISTINCT re.code_categorie) > 1 THEN NULL
            ELSE max(re.code_categorie) END          AS code_categorie,
       CASE WHEN count(DISTINCT re.code_categorie) > 1 THEN 'Plusieurs categories'
            ELSE max(re.categorie_libelle) END       AS categorie_libelle,
       count(*)                                      AS nb_references,
       COALESCE(max(st.refs_en_stock), 0)            AS refs_en_stock,
       ROUND(COALESCE(max(st.stock_kg), 0), 2)       AS stock_kg,
       ROUND(COALESCE(max(st.valeur_dhs), 0), 2)     AS valeur_dhs,
       fl.annee,
       ROUND(COALESCE(fl.entrees_kg, 0), 2)          AS entrees_kg,
       ROUND(COALESCE(fl.sorties_kg, 0), 2)          AS sorties_kg,
       ROUND(COALESCE(fl.entrees_dhs, 0), 2)         AS entrees_dhs,
       -- Le prix moyen a l'entree : ce que le kilo a reellement coute cette
       -- annee-la. Nul quand rien n'est entre, jamais zero : zero se lirait
       -- comme « gratuit ».
       CASE WHEN COALESCE(fl.entrees_kg, 0) > 0
            THEN ROUND(fl.entrees_dhs / fl.entrees_kg, 2) END AS prix_moyen_entree_mad
  FROM refs re
  LEFT JOIN stock st ON st.code_famille = re.code_famille
  LEFT JOIN flux  fl ON fl.code_famille = re.code_famille
 GROUP BY re.code_famille, fl.annee, fl.entrees_kg, fl.sorties_kg, fl.entrees_dhs;

-- -----------------------------------------------------------------------------
-- Le croisement du classeur : famille x couleur x annee, en kilos entres.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stat_famille_couleur AS
SELECT COALESCE(r.code_famille, '(sans famille)')       AS code_famille,
       COALESCE(f.libelle, 'Sans famille')              AS famille_libelle,
       -- Sans couleur interne, on montre l'origine, puis la couleur ecrite sur
       -- la reference : la case du classeur n'est jamais vide.
       COALESCE(r.code_couleur_interne, '(non classee)') AS code_couleur,
       COALESCE(cl.libelle, NULLIF(r.origine, ''), NULLIF(r.couleur, ''), 'Non classee')
                                                        AS couleur_libelle,
       left(m.date_mouvement, 4)                        AS annee,
       ROUND(sum(l.quantite_kg), 2)                     AS entrees_kg,
       count(DISTINCT m.id_mouvement)                   AS nb_entrees,
       count(DISTINCT r.code_reference)                 AS nb_references
  FROM ligne_mouvement l
  JOIN mouvement m      ON m.id_mouvement  = l.id_mouvement
  JOIN type_mouvement t ON t.code_type_mvt = m.code_type_mvt AND t.signe = 1
  JOIN reference r      ON r.code_reference = l.code_reference
  LEFT JOIN famille f   ON f.code_famille = r.code_famille
  LEFT JOIN couleur cl  ON cl.code_couleur_interne = r.code_couleur_interne
 GROUP BY 1, 2, 3, 4, 5;

-- -----------------------------------------------------------------------------
-- Le meme decompte par categorie.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stat_categorie AS
SELECT COALESCE(r.code_categorie, '(sans categorie)') AS code_categorie,
       COALESCE(c.libelle, 'Sans categorie')          AS categorie_libelle,
       count(DISTINCT r.code_reference)               AS nb_references,
       count(DISTINCT r.code_famille)                 AS nb_familles,
       ROUND(COALESCE(sum(s.quantite_kg), 0), 2)      AS stock_kg,
       ROUND(COALESCE(sum(s.valeur_mad), 0), 2)       AS valeur_dhs
  FROM reference r
  LEFT JOIN categorie_matiere c ON c.code_categorie = r.code_categorie
  LEFT JOIN stock_magasin s     ON s.code_reference = r.code_reference
 WHERE r.actif = 1
 GROUP BY 1, 2;

-- LES VUES LISENT SOUS L'IDENTITE DE LEUR PROPRIETAIRE, pas sous celle de
-- l'appelant. Une vue qui appartient a `gestionfil` et qui lit une table
-- appartenant a `postgres` echoue en « droit refuse » — et l'erreur ne se voit
-- qu'a la premiere lecture, donc en production. On accorde donc explicitement
-- la lecture des tables employees, quel qu'en soit le proprietaire.
GRANT SELECT ON reference, famille, couleur, categorie_matiere, stock_magasin,
                ligne_mouvement, mouvement, type_mouvement TO gestionfil;

ALTER VIEW v_stat_famille         OWNER TO gestionfil;
ALTER VIEW v_stat_famille_couleur OWNER TO gestionfil;
ALTER VIEW v_stat_categorie       OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- LES CHAMPS SE DECLARENT, sinon ils sont masques pour tout le monde.
--
-- Ils relevent du module MOUVEMENTS, comme le reste des statistiques de flux.
-- Ce qui porte une valeur en dirhams est marque SENSIBLE : un magasinier lit
-- des kilos, pas des montants.
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
    ('MOUVEMENTS', 'famille_libelle',       'Famille',              'LECTURE', 0, 3010),
    ('MOUVEMENTS', 'categorie_libelle',     'Categorie',            'LECTURE', 0, 3020),
    ('MOUVEMENTS', 'couleur_libelle',       'Couleur',              'LECTURE', 0, 3030),
    ('MOUVEMENTS', 'refs_en_stock',         'References en stock',  'LECTURE', 0, 3040),
    ('MOUVEMENTS', 'entrees_kg',            'Entrees (kg)',         'LECTURE', 0, 3050),
    ('MOUVEMENTS', 'sorties_kg',            'Sorties (kg)',         'LECTURE', 0, 3060),
    ('MOUVEMENTS', 'nb_entrees',            'Nombre d entrees',     'LECTURE', 0, 3070),
    ('MOUVEMENTS', 'entrees_dhs',           'Entrees (MAD)',        'LECTURE', 1, 3080),
    ('MOUVEMENTS', 'prix_moyen_entree_mad', 'Prix moyen a l entree','LECTURE', 1, 3090),
    ('MOUVEMENTS', 'nb_familles',           'Nombre de familles',   'LECTURE', 0, 3100)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

-- Le modele de chaque role, puis la grille de chaque compte : un champ declare
-- aujourd'hui doit rejoindre les utilisateurs qui existent deja, sinon il reste
-- masque pour eux seuls.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN c.sensible = 1 AND r.code_role_user = 'MAGASIN'
            THEN 'MASQUE' ELSE 'LECTURE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'MOUVEMENTS' AND c.ordre BETWEEN 3010 AND 3100
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'MOUVEMENTS'
   AND m.champ IN ('famille_libelle','categorie_libelle','couleur_libelle','refs_en_stock',
                   'entrees_kg','sorties_kg','nb_entrees','entrees_dhs',
                   'prix_moyen_entree_mad','nb_familles')
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;
