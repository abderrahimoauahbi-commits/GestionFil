-- =============================================================================
-- CE QUE LE FOURNISSEUR RECONNAIT, SUR L'ECRAN QUI LUI COMMANDE
--
-- Un bon de commande part chez le vendeur. Il y lit SON code article et SON
-- code couleur — « Ssl2279 », « RED 7612 » — pas les notres. L'acheteur doit
-- donc les avoir sous les yeux au moment ou il commande, et pouvoir les
-- corriger quand ils manquent : 23 references du catalogue n'ont aucun code
-- couleur fournisseur, et l'on ne s'en apercoit jamais mieux qu'en preparant la
-- commande.
--
-- Ces trois champs appartiennent a la REFERENCE. Ils sont declares au module
-- CATALOGUE ; l'ecran des bons de commande est un autre module, et un champ non
-- declare pour un module y est MASQUE pour tout le monde — la colonne
-- disparaitrait sans un mot. D'ou cette declaration.
-- =============================================================================

BEGIN;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('BONS_COMMANDE','reference_fournisseur', 'Reference chez le fournisseur', 'LECTURE', 0, 92),
 ('BONS_COMMANDE','couleur',               'Couleur',                      'LECTURE', 0, 94),
 ('BONS_COMMANDE','code_couleur',          'Code couleur du fournisseur',  'LECTURE', 0, 96)
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
   AND c.champ IN ('reference_fournisseur', 'couleur', 'code_couleur')
   AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'BONS_COMMANDE'
   AND m.champ IN ('reference_fournisseur', 'couleur', 'code_couleur')
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
