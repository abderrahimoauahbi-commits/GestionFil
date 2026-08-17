-- =============================================================================
-- SEED 4 : QUALITES  (18, poids commerciaux reels CDC A4)
-- =============================================================================
-- Les parametres locaux sont initialises depuis les valeurs globales du moment
-- (CDC B3) : chaque qualite devient ensuite autonome.
--
-- Les densites par role (ligne_qualite) ne sont renseignees que pour SH, seule
-- qualite dont le CDC documente la decomposition (E3). Les 17 autres attendent
-- l'extraction de GESTION Fil.xlsx : les laisser vides est volontaire, le
-- trigger trg_recette_valider_roles refusera toute recette dont un role n'a pas
-- de densite, au lieu de calculer un besoin nul en silence.
-- =============================================================================

PRAGMA foreign_keys = ON;

WITH q(code, nom, poids) AS (VALUES
    ('SH','SHEHRAZADE',    2.76),
    ('LP','LP',            2.36),
    ('MP','MP',            2.19),
    ('MF','FRIZE MOYEN',   2.53),
    ('FB','FRIZE BAS',     1.93),
    ('8S','8S',            2.44),
    ('8M','8M',            2.26),
    ('TN','TINGIS',        2.53),
    ('LH','LOW POLYESTER', 1.75),
    ('BR','BRUXELLES',     3.16),
    ('YH','TOPAZ',         3.51),
    ('YL','SHAGGY',        3.50),
    ('PS','PS SHAGGY',     2.52),
    ('8F','8F MOSQUEE',    2.39),
    ('IS','IS MOSQUEE',    2.67),
    ('YF','BAHAR',         2.43),
    ('SL','SL SHAGGY',     4.78),
    ('MN','MONO',          2.70)
)
INSERT INTO qualite
    (code_qualite, nom, poids_commercial_m2, statut,
     marge_securite_pct, couv_min_mois, taux_perte_pct,
     seuil_alerte_jours, seuil_critique_jours, stock_securite_jours)
-- BROUILLON : une qualite sans composition n'est pas utilisable. C'est
-- l'import du classeur, ou la saisie, qui la mettra en service — en passant par
-- les controles R07 et densites.
SELECT q.code, q.nom, q.poids, 'BROUILLON',
       (SELECT CAST(valeur_courante AS REAL) FROM parametre WHERE code_parametre = 'P_MargeSecurite'),
       (SELECT CAST(valeur_courante AS REAL) FROM parametre WHERE code_parametre = 'P_CouvMinMois'),
       (SELECT CAST(valeur_courante AS REAL) FROM parametre WHERE code_parametre = 'P_TauxPerte'),
       (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre = 'P_SeuilAlerte'),
       (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre = 'P_SeuilCritique'),
       (SELECT CAST(valeur_courante AS INTEGER) FROM parametre WHERE code_parametre = 'P_SecuriteA')
FROM q;

-- -----------------------------------------------------------------------------
-- Densites par role de la qualite SH  (CDC E3)
--
-- Verification du poids commercial :
--   1.760 + 0.520 + 0.235 + 0.200 + 0.030 = 2.745  ~  2.76 kg/m2 (A4)
-- Les roles CUIR et RUBAN sont exprimes en ml/m2 : ils consomment de la matiere
-- mais n'entrent pas dans le poids commercial du tapis. C'est ce que le CDC
-- n'avait aucun moyen d'exprimer, faute de discriminant d'unite.
-- -----------------------------------------------------------------------------
INSERT INTO ligne_qualite (code_qualite, code_role, densite, unite_densite, entre_poids_commercial, ordre_affichage) VALUES
    ('SH','POIL',  1.760, 'kg_m2', 1, 10),
    ('SH','TRAME', 0.520, 'kg_m2', 1, 20),
    ('SH','CHAINE',0.235, 'kg_m2', 1, 30),
    ('SH','COLLE', 0.200, 'kg_m2', 1, 40),
    ('SH','PLAST', 0.030, 'kg_m2', 1, 50),
    ('SH','CUIR',  1.000, 'ml_m2', 0, 60),
    ('SH','RUBAN', 1.000, 'ml_m2', 0, 70);
