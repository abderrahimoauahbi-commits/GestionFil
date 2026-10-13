-- =============================================================================
-- 2026-10-09x — Les montants de l'import declares, et donc masques (audit v5, T8)
-- =============================================================================
-- Le masquage ne cache que ce qui est declare. Plusieurs montants de l'import
-- passaient en clair au magasinier : les frais et les ajustements du dossier
-- (montant_dhs), les ecarts de cloture et d'avoir, les prix des lignes de
-- facture et ceux des lignes de bon proposees a la facturation. Ils sont
-- declares sensibles dans le module IMPORT, masques au role MAGASIN (modele et
-- comptes existants) ; les trois totaux du dossier deja declares (frais, valeur,
-- TVA) passent sensibles. Rejouable : un reglage fait a la main n'est pas
-- ecrase.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'IMPORT', c.champ, c.libelle, 'LECTURE', 1, 960
  FROM (VALUES ('montant_dhs', 'Montant (DH)'),
               ('ecart_stock_dhs', 'Ecart porte au stock (DH)'),
               ('ecart_consomme_dhs', 'Ecart deja consomme (DH)'),
               ('valeur_retours_dhs', 'Valeur des kilos rendus (DH)'),
               ('montant_devise', 'Montant (devise)'),
               ('prix_unitaire_devise', 'Prix unitaire (devise)'),
               ('prix_kg_devise', 'Prix au kg (devise)'),
               ('prix_kg_mad', 'Prix au kg (DH)')) c(champ, libelle)
ON CONFLICT DO NOTHING;

-- Les totaux du dossier, declares non sensibles a l'origine.
UPDATE champ_configurable SET sensible = 1
 WHERE module = 'IMPORT' AND champ IN ('frais_dhs', 'valeur_dhs', 'tva_dhs') AND sensible = 0;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'IMPORT', c.champ,
       CASE WHEN r.code_role_user = 'MAGASIN' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
 CROSS JOIN (SELECT champ FROM champ_configurable WHERE module = 'IMPORT' AND ordre = 960) c
ON CONFLICT DO NOTHING;
-- Le modele du magasinier masque aussi les trois totaux.
UPDATE modele_droit_champ SET niveau = 'MASQUE'
 WHERE code_role_user = 'MAGASIN' AND module = 'IMPORT'
   AND champ IN ('frais_dhs', 'valeur_dhs', 'tva_dhs') AND niveau <> 'MASQUE';

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, 'IMPORT', c.champ, 'MASQUE'
  FROM utilisateur u
 CROSS JOIN (SELECT champ FROM champ_configurable
              WHERE module = 'IMPORT' AND (ordre = 960 OR champ IN ('frais_dhs', 'valeur_dhs', 'tva_dhs'))) c
 WHERE u.code_role_user = 'MAGASIN'
   AND NOT EXISTS (SELECT 1 FROM droit_champ d
                    WHERE d.id_utilisateur = u.id_utilisateur AND d.module = 'IMPORT' AND d.champ = c.champ);

COMMIT;
