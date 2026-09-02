-- Porte automatiquement depuis db/017_vues_analyse.sql par pg/porter_vues.py.
-- NE PAS MODIFIER ICI : corriger la source, puis rejouer le portage.

-- =============================================================================
-- ERP GESTION FIL — analyse ABC/XYZ et cout de revient complet
-- =============================================================================


-- -----------------------------------------------------------------------------
-- v_analyse_abc_xyz — la matrice complete, reference par reference
-- -----------------------------------------------------------------------------
-- Les deux classements ne disent PAS la meme chose, et c'est leur croisement
-- qui commande une politique :
--
--   ABC — le POIDS. Combien cette reference pese dans la depense annuelle.
--   XYZ — la REGULARITE. Le coefficient de variation du besoin mensuel.
--
--   AX  gros et regulier    -> flux tendu, commandes cadencees, stock minimal
--   AZ  gros et erratique   -> le plus dangereux : stock de securite ET suivi
--   CX  petit et regulier   -> commande automatique, on n'y pense plus
--   CZ  petit et erratique  -> a la demande, ne merite aucun stock
--
-- Une reference AZ traitee comme une AX se met en rupture ; une CZ traitee
-- comme une AX immobilise du capital pour rien. C'est tout l'enjeu.
DROP VIEW IF EXISTS v_analyse_abc_xyz CASCADE;
CREATE VIEW v_analyse_abc_xyz AS
WITH valeur AS (
    SELECT sp.code_reference,
           sp.designation,
           sp.fournisseur_nom,
           sp.statut,
           sp.jours_couverture,
           sp.conso_mensuelle_kg,
           sp.cmup_mad,
           sp.valeur_totale_mad,
           r.classe_abc,
           r.classe_xyz,
           r.date_dernier_abc,
           ROUND(COALESCE(sp.conso_mensuelle_kg, 0) * 12
                 * COALESCE(sp.cmup_mad, 0), 2)                AS valeur_conso_annuelle_mad
      FROM v_stock_projete sp
      JOIN reference r ON r.code_reference = sp.code_reference
     WHERE r.actif = 1
),
total AS (SELECT SUM(valeur_conso_annuelle_mad) AS t FROM valeur)
SELECT v.*,
       (SELECT COUNT(*) + 1 FROM valeur w
         WHERE w.valeur_conso_annuelle_mad > v.valeur_conso_annuelle_mad)  AS rang,
       ROUND((SELECT SUM(w.valeur_conso_annuelle_mad) FROM valeur w
               WHERE w.valeur_conso_annuelle_mad >= v.valeur_conso_annuelle_mad)
             * 100.0 / NULLIF((SELECT t FROM total), 0), 4)                AS pct_cumule,
       ROUND(v.valeur_conso_annuelle_mad * 100.0
             / NULLIF((SELECT t FROM total), 0), 4)                        AS part_pct,
       -- La politique deduite du croisement. Elle est ecrite ici et non dans
       -- l'ecran : c'est une regle de gestion, elle doit se relire en SQL et
       -- se retrouver a l'identique dans un export ou un etat imprime.
       CASE
           WHEN v.classe_abc IS NULL OR v.classe_xyz IS NULL THEN 'A classer'
           WHEN v.classe_abc = 'A' AND v.classe_xyz = 'X' THEN 'Flux tendu, commandes cadencees'
           WHEN v.classe_abc = 'A' AND v.classe_xyz = 'Y' THEN 'Stock de securite modere, revue mensuelle'
           WHEN v.classe_abc = 'A' AND v.classe_xyz = 'Z' THEN 'Stock de securite eleve et suivi rapproche'
           WHEN v.classe_abc = 'B' AND v.classe_xyz = 'X' THEN 'Reapprovisionnement automatique'
           WHEN v.classe_abc = 'B'                        THEN 'Revue trimestrielle'
           WHEN v.classe_abc = 'C' AND v.classe_xyz = 'X' THEN 'Commande automatique, lot economique'
           ELSE 'A la demande, sans stock dedie'
       END                                                                 AS politique
  FROM valeur v;


-- -----------------------------------------------------------------------------
-- Cout de revient complet — la structure des frais annexes
-- -----------------------------------------------------------------------------
-- POURQUOI CETTE TABLE PLUTOT QU'UNE COLONNE. Les frais d'approche ne portent
-- pas sur une ligne mais sur un ENVOI : un conteneur transporte dix references,
-- et le fret se repartit entre elles. Une colonne par ligne obligerait a faire
-- la repartition a la main avant de saisir, donc a la refaire a chaque
-- correction.
--
-- LA REPARTITION EST UN CHOIX, PAS UNE EVIDENCE. Le fret suit le poids, la
-- douane suit la valeur, l'assurance aussi. Retenir une seule cle pour tout
-- fausserait l'un ou l'autre : une matiere legere et chere porterait trop de
-- fret, une lourde et bon marche trop de douane. Chaque frais porte donc sa
-- propre cle.
CREATE TABLE IF NOT EXISTS frais_approche (
    id_frais            TEXT    NOT NULL PRIMARY KEY
                                DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
    id_reception        TEXT    NOT NULL REFERENCES reception(id_reception),
    type_frais          TEXT    NOT NULL CHECK (type_frais IN
                                    ('FRET', 'DOUANE', 'ASSURANCE', 'MANUTENTION', 'AUTRE')),
    libelle             TEXT,
    montant_devise      REAL    NOT NULL CHECK (montant_devise >= 0),
    code_devise         TEXT    NOT NULL REFERENCES devise(code_devise),
    taux_change         REAL    NOT NULL CHECK (taux_change > 0),
    montant_mad         REAL    GENERATED ALWAYS AS (montant_devise * taux_change) VIRTUAL,
    -- La cle de repartition, choisie par frais.
    cle_repartition     TEXT    NOT NULL DEFAULT 'POIDS'
                                CHECK (cle_repartition IN ('POIDS', 'VALEUR', 'LIGNES')),
    reference_externe   TEXT,   -- numero de facture transitaire, DUM douaniere
    date_frais          TEXT    NOT NULL DEFAULT (to_char(current_date, 'YYYY-MM-DD')),
    id_utilisateur      TEXT    REFERENCES utilisateur(id_utilisateur),
    date_creation       TEXT    NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    notes               TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS ix_frais_reception ON frais_approche(id_reception);


-- -----------------------------------------------------------------------------
-- v_cout_revient — le prix rendu magasin, ligne par ligne
-- -----------------------------------------------------------------------------
-- Prix d'achat + quote-part des frais d'approche. C'est le seul chiffre qui
-- permette de comparer deux fournisseurs eloignes : un prix depart usine plus
-- bas peut couter plus cher rendu, et rien dans le prix d'achat ne le montre.
DROP VIEW IF EXISTS v_cout_revient CASCADE;
CREATE VIEW v_cout_revient AS
WITH bases AS (
    -- Les assiettes de repartition, par reception : poids total, valeur totale
    -- et nombre de lignes. Calculees une fois, reutilisees par chaque frais.
    SELECT lr.id_reception,
           SUM(lr.quantite_stock_kg)                             AS poids_total_kg,
           SUM(lr.quantite_stock_kg * COALESCE(lr.prix_kg_mad, 0)) AS valeur_totale_mad,
           COUNT(*)                                              AS nb_lignes
      FROM ligne_reception lr
     GROUP BY lr.id_reception
),
quote_part AS (
    SELECT lr.id_ligne_reception,
           SUM(
               fa.montant_devise * fa.taux_change *
               CASE fa.cle_repartition
                   WHEN 'POIDS'  THEN lr.quantite_stock_kg
                                      / NULLIF(b.poids_total_kg, 0)
                   WHEN 'VALEUR' THEN (lr.quantite_stock_kg * COALESCE(lr.prix_kg_mad, 0))
                                      / NULLIF(b.valeur_totale_mad, 0)
                   ELSE 1.0 / NULLIF(b.nb_lignes, 0)
               END
           ) AS frais_mad
      FROM ligne_reception lr
      JOIN bases b          ON b.id_reception  = lr.id_reception
      JOIN frais_approche fa ON fa.id_reception = lr.id_reception
     GROUP BY lr.id_ligne_reception
)
SELECT lr.id_ligne_reception,
       rc.numero_reception,
       rc.date_reception,
       lr.code_reference,
       r.designation,
       f.nom                                                     AS fournisseur_nom,
       lr.quantite_stock_kg,
       ROUND(lr.prix_kg_mad, 4)                                  AS prix_achat_mad_kg,
       ROUND(COALESCE(qp.frais_mad, 0), 2)                       AS frais_approche_mad,
       ROUND(COALESCE(qp.frais_mad, 0)
             / NULLIF(lr.quantite_stock_kg, 0), 4)               AS frais_mad_kg,
       ROUND(COALESCE(lr.prix_kg_mad, 0)
             + COALESCE(qp.frais_mad, 0)
               / NULLIF(lr.quantite_stock_kg, 0), 4)             AS cout_revient_mad_kg,
       -- La part des frais dans le cout rendu. Au-dela de quelques pour cent,
       -- elle change le classement des fournisseurs.
       ROUND(COALESCE(qp.frais_mad, 0) * 100.0
             / NULLIF(lr.quantite_stock_kg * COALESCE(lr.prix_kg_mad, 0), 0), 2)
                                                                 AS part_frais_pct
  FROM ligne_reception lr
  JOIN reception rc ON rc.id_reception = lr.id_reception
  JOIN reference r  ON r.code_reference = lr.code_reference
  LEFT JOIN fournisseur f  ON f.code_fournisseur = rc.code_fournisseur
  LEFT JOIN quote_part qp  ON qp.id_ligne_reception = lr.id_ligne_reception
 WHERE rc.statut = 'VALIDE';
