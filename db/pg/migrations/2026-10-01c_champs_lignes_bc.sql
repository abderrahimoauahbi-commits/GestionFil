-- =============================================================================
-- MIGRATION 2026-10-01c — trois colonnes des lignes de bon, enfin visibles
--
-- LE DEFAUT. L'ecran du bon affiche, par ligne, le montant en dirhams, la
-- categorie (« Type ») et le nombre de palettes. Aucun de ces trois champs
-- n'etait DECLARE dans champ_configurable : un champ non declare vaut MASQUE,
-- et les trois colonnes etaient donc invisibles pour tout le monde.
--
-- LA CORRECTION. On les declare comme leurs voisins. Le montant en dirhams
-- est SENSIBLE, comme le total MAD du bon : chaque utilisateur recoit sur lui
-- le meme niveau que sur `montant_total_mad`, pour qu'un profil qui ne voit
-- pas les montants ne les retrouve pas ligne par ligne.
--
--   psql -d gestionfil -v ON_ERROR_STOP=1 -f 2026-10-01c_champs_lignes_bc.sql
-- =============================================================================
BEGIN;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
    ('BONS_COMMANDE', 'total_ligne_mad',   'Montant ligne MAD', 'LECTURE', 1, 151),
    ('BONS_COMMANDE', 'categorie_libelle', 'Type (catégorie)',  'LECTURE', 0, 95),
    ('BONS_COMMANDE', 'nb_palettes',       'Palettes',          'LECTURE', 0, 96)
ON CONFLICT DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau, date_modification)
SELECT id_utilisateur, module, 'total_ligne_mad', niveau, date_modification
  FROM droit_champ
 WHERE module = 'BONS_COMMANDE' AND champ = 'montant_total_mad'
ON CONFLICT DO NOTHING;

-- PREUVE
SELECT 'champs declares : ' || count(*) || '/3'
  FROM champ_configurable
 WHERE module = 'BONS_COMMANDE' AND champ IN ('total_ligne_mad', 'categorie_libelle', 'nb_palettes');

COMMIT;
