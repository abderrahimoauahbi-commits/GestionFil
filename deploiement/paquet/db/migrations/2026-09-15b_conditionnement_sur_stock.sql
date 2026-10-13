-- =============================================================================
-- LE CONDITIONNEMENT AVEC LE STOCK
--
-- Transferer se compte en palettes et en bobines autant qu'en kilos. L'ecran de
-- transfert chargeait le CATALOGUE ENTIER — deux mille references — pour lire
-- le poids d'une bobine sur les trois lignes d'un camion. Le stock du magasin
-- source suffit, et il porte desormais ces parametres.
--
-- Mais un champ non declare pour un module y est MASQUE pour tout le monde : la
-- colonne disparaitrait de la reponse, et la conversion cesserait de fonctionner
-- sans un mot d'explication. D'ou cette declaration.
-- =============================================================================

BEGIN;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('STOCK','unite_catalogue',      'Unite du catalogue',    'LECTURE', 0, 2010),
 ('STOCK','poids_bobine_kg',      'Poids par bobine (kg)', 'LECTURE', 0, 2020),
 ('STOCK','bobines_par_palette',  'Bobines par palette',   'LECTURE', 0, 2030),
 ('STOCK','densite_kg_ml',        'Densite (kg/ml)',       'LECTURE', 0, 2040),
 ('STOCK','suivi_lot',            'Suivi de lot',          'LECTURE', 0, 2050)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN EXISTS (SELECT 1 FROM permission p
                          WHERE p.code_role_user = r.code_role_user
                            AND p.module = c.module AND p.action = 'LIRE')
            THEN 'LECTURE' ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'STOCK' AND c.ordre BETWEEN 2010 AND 2050 AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'STOCK' AND c.ordre BETWEEN 2010 AND 2050
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
