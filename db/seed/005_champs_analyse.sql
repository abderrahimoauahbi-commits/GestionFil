-- =============================================================================
-- Declaration des champs de l'analyse ABC/XYZ et du cout de revient
-- -----------------------------------------------------------------------------
-- RAPPEL DE LA REGLE, parce qu'elle se paie cher quand on l'oublie :
-- `champ_configurable.niveau_defaut` vaut LECTURE. Un champ servi par une route
-- mais absent de ce catalogue est VISIBLE DE TOUS — le defaut est ouvert, pas
-- ferme. C'est ainsi qu'un prix moyen s'est retrouve chez le magasinier la
-- semaine derniere.
--
-- Toute colonne ajoutee a une reponse d'API se declare donc ICI avant d'etre
-- servie, et se marque `sensible` si elle porte un montant.
-- =============================================================================

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES
  -- Analyse ABC / XYZ -------------------------------------------------------
  ('STOCK', 'valeur_conso_annuelle_mad', 'Valeur de consommation annuelle (MAD)', 'LECTURE', 1, 910),
  ('STOCK', 'part_pct',                  'Part dans la depense totale (%)',       'LECTURE', 1, 911),
  ('STOCK', 'pct_cumule',                'Part cumulee (%)',                      'LECTURE', 1, 912),
  ('STOCK', 'rang',                      'Rang par valeur consommee',             'LECTURE', 0, 913),
  ('STOCK', 'politique',                 'Politique de reapprovisionnement',      'LECTURE', 0, 914),
  ('STOCK', 'date_dernier_abc',          'Date du dernier classement',            'LECTURE', 0, 915),

  -- Cout de revient complet -------------------------------------------------
  -- Tous sensibles : ce sont des montants, et le cout rendu est meme plus
  -- revelateur que le prix d'achat — il expose la marge du transitaire.
  ('VALORISATION', 'prix_achat_mad_kg',   'Prix d''achat (MAD/kg)',               'LECTURE', 1, 920),
  ('VALORISATION', 'frais_approche_mad',  'Frais d''approche repartis (MAD)',     'LECTURE', 1, 921),
  ('VALORISATION', 'frais_mad_kg',        'Frais d''approche (MAD/kg)',           'LECTURE', 1, 922),
  ('VALORISATION', 'cout_revient_mad_kg', 'Cout de revient rendu (MAD/kg)',       'LECTURE', 1, 923),
  ('VALORISATION', 'part_frais_pct',      'Part des frais dans le cout (%)',      'LECTURE', 0, 924),
  ('VALORISATION', 'montant_devise',      'Montant du frais (devise)',            'LECTURE', 1, 925),
  ('VALORISATION', 'montant_mad',         'Montant du frais (MAD)',               'LECTURE', 1, 926),
  ('VALORISATION', 'type_frais',          'Nature du frais',                      'LECTURE', 0, 927),
  ('VALORISATION', 'cle_repartition',     'Cle de repartition',                   'LECTURE', 0, 928),
  ('VALORISATION', 'reference_externe',   'Reference externe (facture, DUM)',     'LECTURE', 0, 929)
ON CONFLICT (module, champ) DO UPDATE SET
  libelle  = excluded.libelle,
  sensible = excluded.sensible,
  ordre    = excluded.ordre;


-- Report dans les modeles de role, puis dans les droits effectifs — seuls lus
-- par le serveur. La regle est celle de 003_roles_2026 : un montant est masque
-- partout sauf a la direction.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
         WHEN r.code_role_user = 'DIRECTION' THEN 'ECRITURE'
         WHEN NOT EXISTS (SELECT 1 FROM permission p
                           WHERE p.code_role_user = r.code_role_user
                             AND p.module = c.module
                             AND p.action = 'LIRE' AND p.actif = 1) THEN 'MASQUE'
         WHEN c.sensible = 1 THEN 'MASQUE'
         ELSE 'ECRITURE'
       END
  FROM (SELECT 'DIRECTION' AS code_role_user UNION ALL SELECT 'ADMIN'
        UNION ALL SELECT 'ASSISTANTE' UNION ALL SELECT 'MAGASIN') r
  CROSS JOIN champ_configurable c
 WHERE c.ordre BETWEEN 910 AND 929
ON CONFLICT (code_role_user, module, champ) DO UPDATE SET niveau = excluded.niveau;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, date_modification)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE c.ordre BETWEEN 910 AND 929
ON CONFLICT (id_utilisateur, module, champ) DO UPDATE SET niveau = excluded.niveau;
