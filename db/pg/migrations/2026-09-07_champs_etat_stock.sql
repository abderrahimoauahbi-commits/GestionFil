-- =============================================================================
-- MIGRATION 2026-09-07 — LES CHAMPS DE L'ETAT DE STOCK
-- -----------------------------------------------------------------------------
-- Les colonnes de `v_etat_stock` doivent etre DECLAREES, faute de quoi elles
-- n'apparaissent pas dans l'ecran des droits : personne ne peut alors decider
-- qui voit quoi, et le jour ou l'on voudra masquer un prix a un role, il n'y
-- aura rien a cocher.
--
-- `prix_catalogue_kg` est marque SENSIBLE, comme `cmup_mad` et `valeur_mad`
-- avant lui : c'est un prix d'achat, et le magasin n'a pas a le lire.
-- =============================================================================

BEGIN;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('STOCK','stock_global_kg',     'Stock global (kg)',            'LECTURE', 0, 1900),
 ('STOCK','magasins_kg',         'Dont en magasin (kg)',         'LECTURE', 0, 1910),
 ('STOCK','machines_kg',         'Dont sur machines (kg)',       'LECTURE', 0, 1920),
 ('STOCK','machines_bobines',    'Bobines sur machines',         'LECTURE', 0, 1930),
 ('STOCK','nb_machines',         'Nombre de machines chargees',  'LECTURE', 0, 1940),
 ('STOCK','par_magasin',         'Ventilation par magasin',      'LECTURE', 0, 1950),
 ('STOCK','a_commander_kg',      'A commander (kg)',             'LECTURE', 0, 1960),
 ('STOCK','prix_catalogue_kg',   'Prix catalogue au kg',         'LECTURE', 1, 1970),
 ('STOCK','jours_sans_mouvement','Jours sans mouvement',         'LECTURE', 0, 1980),
 ('STOCK','derniere_sortie',     'Derniere sortie',              'LECTURE', 0, 1990),
 ('STOCK','nb_equivalents',      'Equivalents disponibles',      'LECTURE', 0, 2000)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
           WHEN c.sensible = 1 AND NOT EXISTS (
                SELECT 1 FROM permission p
                 WHERE p.code_role_user = r.code_role_user
                   AND p.module = 'VALORISATION') THEN 'MASQUE'
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = c.module AND p.action = 'LIRE') THEN 'LECTURE'
           ELSE 'MASQUE'
       END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'STOCK' AND c.ordre BETWEEN 1900 AND 2000 AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'STOCK' AND c.ordre BETWEEN 1900 AND 2000
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
