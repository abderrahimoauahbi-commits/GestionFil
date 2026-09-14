-- =============================================================================
-- LE CONDITIONNEMENT SUR L'ECRAN DES BONS DE COMMANDE
--
-- La saisie d'un bon convertit les palettes et les bobines en kilos, par les
-- parametres de la reference. L'ecran les lisait dans le CATALOGUE ENTIER,
-- charge a chaque ouverture : 124 references passaient, mille ne passeront pas.
-- La recherche par frappe rend maintenant ces parametres avec chaque
-- suggestion, et le catalogue n'est plus charge du tout.
--
-- Mais un champ non declare pour un module est MASQUE pour tout le monde : sans
-- ces trois lignes, le serveur retirerait le poids de bobine de sa reponse, et
-- la conversion cesserait de fonctionner sans un mot d'explication. C'est la
-- mecanique de `champ_configurable` : elle protege, et elle se paie d'une
-- declaration a chaque fois qu'un champ traverse la frontiere d'un module.
-- =============================================================================

BEGIN;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('BONS_COMMANDE','poids_bobine_kg',     'Poids par bobine (kg)', 'LECTURE', 0, 104),
 ('BONS_COMMANDE','bobines_par_palette', 'Bobines par palette',   'LECTURE', 0, 106),
 ('BONS_COMMANDE','densite_kg_ml',       'Densite (kg/ml)',       'LECTURE', 0, 108)
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
 WHERE c.module = 'BONS_COMMANDE'
   AND c.champ IN ('poids_bobine_kg', 'bobines_par_palette', 'densite_kg_ml')
   AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'BONS_COMMANDE'
   AND m.champ IN ('poids_bobine_kg', 'bobines_par_palette', 'densite_kg_ml')
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
