-- =============================================================================
-- MIGRATION 2026-09-02 — le mouvement devient un DOCUMENT
-- -----------------------------------------------------------------------------
-- CE QUI CHANGE ET POURQUOI. Le mouvement etait lu ligne a ligne, comme un
-- grand livre comptable : une ligne par reference, sans totaux. C'est juste
-- pour l'audit et faux pour le magasin. Ce qui entre ou sort, c'est un camion,
-- une equipe, une palette — un document avec un entete et des lignes, comme un
-- bon de commande. Les tables portaient deja cette forme ; il leur manquait
-- trois colonnes et un ecran.
--
--   * `mouvement.responsable`  QUI a remis ou recu la marchandise, par
--     opposition a `id_utilisateur` qui dit qui a TAPE la saisie. Le magasinier
--     saisit souvent pour un chef d'equipe ou un chauffeur, et c'est ce dernier
--     qu'on cherche quand un ecart apparait trois jours plus tard. Texte libre :
--     ce peut etre un tiers sans compte.
--
--   * `ligne_mouvement.nb_bobines` / `nb_palettes`  les colis REELLEMENT
--     COMPTES. La quantite saisie en palettes se convertit en kg par un facteur
--     theorique ; le nombre de palettes chargees se compte sur le quai. Les deux
--     different des qu'une palette est incomplete, ce qui est le cas ordinaire.
--
-- LE GRAND LIVRE RESTE IMMUABLE (R03) : rien ici ne touche aux declencheurs qui
-- interdisent UPDATE et DELETE sur `mouvement` et `ligne_mouvement`. On ajoute
-- des colonnes, on ne rouvre pas le journal.
--
-- Application, sur le serveur — le compte `postgres` ne lit pas /home/sysadmin,
-- d'ou le passage par l'entree standard plutot que `psql -f` :
--
--     cd /tmp
--     cat /home/sysadmin/gestionfil/db/migrations/2026-09-02_mouvement_document.sql |
--         sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
-- =============================================================================

-- --- 1. Les colonnes ---------------------------------------------------------
ALTER TABLE mouvement       ADD COLUMN IF NOT EXISTS responsable text;
ALTER TABLE ligne_mouvement ADD COLUMN IF NOT EXISTS nb_bobines  bigint
                            CHECK (nb_bobines  IS NULL OR nb_bobines  >= 0);
ALTER TABLE ligne_mouvement ADD COLUMN IF NOT EXISTS nb_palettes bigint
                            CHECK (nb_palettes IS NULL OR nb_palettes >= 0);

-- --- 2. Les champs configurables ---------------------------------------------
-- UN CHAMP NON DECLARE VAUT MASQUE, et sa colonne disparait de l'ecran sans un
-- mot. C'est la garde qui rend le masquage sur : rien ne fuit par oubli. Le
-- prix de cette garde est ce pave, qu'il faut tenir a jour.
--
-- `responsable`, `nb_bobines`, `nb_palettes`, `quantite_totale_kg`,
-- `bobines_totales`, `palettes_totales` et `valeur_totale_mad` sont deja
-- declares pour ce module : ils servaient aux bons de transfert, qui sont des
-- documents du meme module. Seuls les manquants figurent ici.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('MOUVEMENTS','magasin_nom',           'Nom du magasin',            'LECTURE', 0, 1600),
 ('MOUVEMENTS','motif_libelle',         'Motif',                     'LECTURE', 0, 1610),
 ('MOUVEMENTS','reference_document',    'Document de reference',     'LECTURE', 0, 1620),
 ('MOUVEMENTS','observations_globales', 'Observations',              'LECTURE', 0, 1630),
 ('MOUVEMENTS','date_creation',         'Date de saisie',            'LECTURE', 0, 1640),
 ('MOUVEMENTS','jours_de_retard_saisie','Jours entre fait et saisie','LECTURE', 0, 1650),
 ('MOUVEMENTS','saisi_par',             'Saisi par',                 'LECTURE', 0, 1660),
 ('MOUVEMENTS','rebut_kg',              'Dont rebut / perte (kg)',   'LECTURE', 0, 1670),
 ('MOUVEMENTS','motif_ligne_libelle',   'Motif de la ligne',         'LECTURE', 0, 1680),
 ('MOUVEMENTS','est_initial',           'Reprise de stock initial',  'LECTURE', 0, 1690),
 ('MOUVEMENTS','date_fabrication',      'Date de fabrication',       'LECTURE', 0, 1700),
 ('MOUVEMENTS','statut_qualite',        'Statut qualite',            'LECTURE', 0, 1710),
 ('MOUVEMENTS','facteur_conversion',    'Facteur de conversion',     'LECTURE', 0, 1720)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, ordre = excluded.ordre;

-- --- 3. Le modele par role ---------------------------------------------------
-- Meme regle que le seed d'origine : ECRITURE si le role ecrit dans le module,
-- LECTURE s'il le lit, MASQUE sinon. Aucun de ces champs n'est monetaire, donc
-- aucun n'est masque au magasin.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = c.module AND p.action = 'ECRIRE') THEN 'ECRITURE'
           WHEN EXISTS (SELECT 1 FROM permission p
                         WHERE p.code_role_user = r.code_role_user
                           AND p.module = c.module AND p.action = 'LIRE') THEN 'LECTURE'
           ELSE 'MASQUE'
       END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'MOUVEMENTS'
   AND c.ordre BETWEEN 1600 AND 1720
   AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

-- LES VALEURS DERIVEES NE SE MODIFIENT PAS A LA MAIN. Les corriger ferait
-- diverger le calcul de son resultat : le rebut vient des motifs de ligne, le
-- retard de saisie de deux dates.
UPDATE modele_droit_champ SET niveau = 'LECTURE'
 WHERE niveau = 'ECRITURE'
   AND module = 'MOUVEMENTS'
   AND champ IN ('rebut_kg','jours_de_retard_saisie','facteur_conversion','magasin_nom',
                 'motif_libelle','motif_ligne_libelle','saisi_par','date_creation');

-- --- 4. La grille des comptes existants --------------------------------------
-- Le serveur ne lit JAMAIS `modele_droit_champ` : il lit `droit_champ`, ou
-- l'absence de ligne vaut `niveau_defaut`. Pour les champs non sensibles ce
-- defaut suffirait — mais laisser les comptes sans ligne les rendrait
-- invisibles dans l'ecran des droits, qui n'affiche que ce qui existe.
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'MOUVEMENTS'
   AND c.ordre BETWEEN 1600 AND 1720
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- --- 5. Verification ---------------------------------------------------------
SELECT 'colonnes ajoutees (attendu 3)' AS controle,
       count(*) AS valeur
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'mouvement'       AND column_name = 'responsable')
     OR (table_name = 'ligne_mouvement' AND column_name IN ('nb_bobines','nb_palettes')))
UNION ALL
SELECT 'champs declares (attendu 13)', count(*)
  FROM champ_configurable
 WHERE module = 'MOUVEMENTS' AND ordre BETWEEN 1600 AND 1720;
