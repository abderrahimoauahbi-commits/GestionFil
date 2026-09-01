-- =============================================================================
-- Declaration des champs de la matrice des prix et de l'historique
-- -----------------------------------------------------------------------------
-- POURQUOI CE FICHIER EXISTE.
--
-- `champ_configurable.niveau_defaut` vaut LECTURE. Un champ servi par une route
-- mais absent de ce catalogue est donc VISIBLE DE TOUS, y compris du magasinier
-- a qui l'on masque justement les montants. Le defaut est ouvert, pas ferme.
--
-- Constate en testant la nouvelle route `/api/matrice-prix` : le compte
-- magasinier recevait `prix_moyen_mad`. Trois autres champs de la meme route
-- etaient dans le meme cas.
--
-- La regle a retenir : toute colonne ajoutee a une reponse d'API doit etre
-- declaree ici AVANT d'etre servie, et marquee `sensible` si elle porte un
-- montant. Le serveur ne devine pas.
-- =============================================================================

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES
  ('CATALOGUE', 'prix_moyen_mad', 'Prix moyen pondere du mois (MAD/kg)', 'LECTURE', 1, 900),
  ('CATALOGUE', 'annee_mois',     'Mois d''achat',                       'LECTURE', 0, 901),
  ('CATALOGUE', 'quantite_kg',    'Quantite achetee dans le mois (kg)',  'LECTURE', 0, 902),
  ('CATALOGUE', 'nb_achats',      'Nombre d''achats dans le mois',       'LECTURE', 0, 903)
ON CONFLICT (module, champ) DO UPDATE SET
  libelle  = excluded.libelle,
  sensible = excluded.sensible,
  ordre    = excluded.ordre;

-- Report dans les modeles de role, avec la meme regle qu'en 003 : un montant
-- est masque partout sauf a la direction, et sauf a l'assistante sur les
-- modules ou elle doit saisir un prix — ce qui n'est pas le cas du catalogue.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
         WHEN r.code_role_user = 'DIRECTION' THEN 'ECRITURE'
         WHEN c.sensible = 1 THEN 'MASQUE'
         ELSE 'ECRITURE'
       END
  FROM (SELECT 'DIRECTION' AS code_role_user UNION ALL SELECT 'ADMIN'
        UNION ALL SELECT 'ASSISTANTE' UNION ALL SELECT 'MAGASIN') r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'CATALOGUE'
   AND c.champ IN ('prix_moyen_mad', 'annee_mois', 'quantite_kg', 'nb_achats')
ON CONFLICT (code_role_user, module, champ) DO UPDATE SET niveau = excluded.niveau;

-- Puis dans les droits effectifs, seuls lus par le serveur.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, date_modification)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'CATALOGUE'
   AND m.champ IN ('prix_moyen_mad', 'annee_mois', 'quantite_kg', 'nb_achats')
ON CONFLICT (id_utilisateur, module, champ) DO UPDATE SET niveau = excluded.niveau;
