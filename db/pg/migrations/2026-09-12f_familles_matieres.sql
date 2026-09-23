-- =============================================================================
-- MIGRATION 2026-09-12 (f) — LES FAMILLES MATIERE, ET L'ORIGINE
-- -----------------------------------------------------------------------------
-- DEUX CHOSES, tenues par la meme regle de nommage d'une reference interne :
--
--     categorie - famille - couleur OU ORIGINE - reference fournisseur - fournisseur
--     PES       - 3000 Deniers - Khave        - Ssl2279 - Suj
--     JUT       - 24/1         - Bangladesh   - (aucune) - Globaltex
--
-- 1. LA FAMILLE DES MATIERES NON TEINTES. Dans les feuilles jute, colle,
--    plastique et cuir du classeur, la colonne « QUALITE » EST la famille :
--    le jute se decline en 24/1, 30/1, 2100/2 ; la colle en 821 et PP 55 ; le
--    plastique en laizes de 35 a 140 cm. Elles sont reprises telles quelles.
--
--    Celles relevees une seule fois sont posees INACTIVES : une largeur de
--    99 cm vue une fois dans une colonne de quantites est probablement une
--    quantite, pas une laize. Elles restent visibles a l'ecran, et se
--    reactivent d'un clic si elles existent vraiment.
--
-- 2. L'ORIGINE. Une reference sans couleur — jute, colle, plastique, cuir —
--    porte a sa place la PROVENANCE. C'est ce qui distingue deux jutes 24/1 de
--    deux pays, et ce que la facture d'import mentionne toujours.
-- =============================================================================

BEGIN;

ALTER TABLE reference ADD COLUMN IF NOT EXISTS origine text;

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('CATALOGUE', 'origine', 'Origine', 'ECRITURE', 0, 755)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'CATALOGUE', 'origine',
       CASE WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                          AND p.module = 'CATALOGUE' AND p.action = 'ECRIRE') THEN 'ECRITURE'
            WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                          AND p.module = 'CATALOGUE' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r WHERE r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'CATALOGUE' AND m.champ = 'origine'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

INSERT INTO famille (code_famille, libelle, code_categorie, titrage, description, ordre_affichage) VALUES
    ('CUI-IMITATION-CUIR', 'Cuir IMITATION CUIR', 'CUI', 'IMITATION CUIR', 'Qualite relevee dans le classeur', 400),
    ('JUT-10-1', 'Jute 10/1', 'JUT', '10/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-1100-1', 'Jute 1100/1', 'JUT', '1100/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-1107-1', 'Jute 1107/1', 'JUT', '1107/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-12-1', 'Jute 12/1', 'JUT', '12/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-1200-1', 'Jute 1200/1', 'JUT', '1200/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-1440-2', 'Jute 1440/2', 'JUT', '1440/2', 'Qualite relevee dans le classeur', 400),
    ('JUT-16-2', 'Jute 16/2', 'JUT', '16/2', 'Qualite relevee dans le classeur', 400),
    ('JUT-1800-2', 'Jute 1800/2', 'JUT', '1800/2', 'Qualite relevee dans le classeur', 400),
    ('JUT-20-2', 'Jute 20/2', 'JUT', '20/2', 'Qualite relevee dans le classeur', 400),
    ('JUT-2100-2', 'Jute 2100/2', 'JUT', '2100/2', 'Qualite relevee dans le classeur', 400),
    ('JUT-22-2', 'Jute 22/2', 'JUT', '22/2', 'Qualite relevee dans le classeur', 400),
    ('JUT-24-1', 'Jute 24/1', 'JUT', '24/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-2400-2', 'Jute 2400/2', 'JUT', '2400/2', 'Qualite relevee dans le classeur', 400),
    ('JUT-2850-1', 'Jute 2850/1', 'JUT', '2850/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-30-1', 'Jute 30/1', 'JUT', '30/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-3000-1', 'Jute 3000/1', 'JUT', '3000/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-3000-2', 'Jute 3000/2', 'JUT', '3000/2', 'Qualite relevee dans le classeur', 400),
    ('JUT-3600-1', 'Jute 3600/1', 'JUT', '3600/1', 'Qualite relevee dans le classeur', 400),
    ('JUT-9-6-1', 'Jute 9,6/1', 'JUT', '9,6/1', 'Qualite relevee dans le classeur', 400),
    ('PES-0-3', 'Nylon 0.3', 'PES', '0.3', 'Qualite relevee dans le classeur', 400),
    ('PES-0-35', 'Nylon 0.35', 'PES', '0.35', 'Qualite relevee dans le classeur', 400),
    ('PES-1100-POLY', 'Nylon 1100 - POLY', 'PES', '1100 - POLY', 'Qualite relevee dans le classeur', 400),
    ('PES-1100-POLY', 'Nylon 1100-POLY', 'PES', '1100-POLY', 'Qualite relevee dans le classeur', 400),
    ('PES-CH-20-2', 'Polyester chaine 20/2', 'PES-CH', '20/2', 'Qualite relevee dans le classeur', 400),
    ('PES-CH-20-3', 'Polyester chaine 20/3', 'PES-CH', '20/3', 'Qualite relevee dans le classeur', 400),
    ('PES-CH-20-4', 'Polyester chaine 20/4', 'PES-CH', '20/4', 'Qualite relevee dans le classeur', 400),
    ('PES-CH-DTY-390D-72F-2', 'Polyester chaine DTY 390D/72F/2', 'PES-CH', 'DTY 390D/72F/2', 'Qualite relevee dans le classeur', 400),
    ('PES-CH-DTY-500D-144F-2', 'Polyester chaine DTY 500D/144F/2', 'PES-CH', 'DTY 500D/144F/2', 'Qualite relevee dans le classeur', 400),
    ('PLA-100', 'Plastique 100', 'PLA', '100', 'Qualite relevee dans le classeur', 400),
    ('PLA-107', 'Plastique 107', 'PLA', '107', 'Qualite relevee dans le classeur', 400),
    ('PLA-111', 'Plastique 111', 'PLA', '111', 'Qualite relevee dans le classeur', 400),
    ('PLA-121', 'Plastique 121', 'PLA', '121', 'Qualite relevee dans le classeur', 400),
    ('PLA-124', 'Plastique 124', 'PLA', '124', 'Qualite relevee dans le classeur', 400),
    ('PLA-127', 'Plastique 127', 'PLA', '127', 'Qualite relevee dans le classeur', 400),
    ('PLA-140', 'Plastique 140', 'PLA', '140', 'Qualite relevee dans le classeur', 400),
    ('PLA-154', 'Plastique 154', 'PLA', '154', 'Qualite relevee dans le classeur', 400),
    ('PLA-33', 'Plastique 33', 'PLA', '33', 'Qualite relevee dans le classeur', 400),
    ('PLA-35', 'Plastique 35', 'PLA', '35', 'Qualite relevee dans le classeur', 400),
    ('PLA-40', 'Plastique 40', 'PLA', '40', 'Qualite relevee dans le classeur', 400),
    ('PLA-45', 'Plastique 45', 'PLA', '45', 'Qualite relevee dans le classeur', 400),
    ('PLA-50', 'Plastique 50', 'PLA', '50', 'Qualite relevee dans le classeur', 400),
    ('PLA-65', 'Plastique 65', 'PLA', '65', 'Qualite relevee dans le classeur', 400),
    ('PLA-75', 'Plastique 75', 'PLA', '75', 'Qualite relevee dans le classeur', 400),
    ('PLA-78', 'Plastique 78', 'PLA', '78', 'Qualite relevee dans le classeur', 400),
    ('PLA-80', 'Plastique 80', 'PLA', '80', 'Qualite relevee dans le classeur', 400),
    ('PLA-95', 'Plastique 95', 'PLA', '95', 'Qualite relevee dans le classeur', 400),
    ('PLA-96', 'Plastique 96', 'PLA', '96', 'Qualite relevee dans le classeur', 400),
    ('PLA-99', 'Plastique 99', 'PLA', '99', 'Qualite relevee dans le classeur', 400),
    ('SBR-650', 'Colle 650', 'SBR', '650', 'Qualite relevee dans le classeur', 400),
    ('SBR-821', 'Colle 821', 'SBR', '821', 'Qualite relevee dans le classeur', 400),
    ('SBR-HOLTMELT-WHITE', 'Colle HOLTMELT WHITE', 'SBR', 'HOLTMELT WHITE', 'Qualite relevee dans le classeur', 400),
    ('SBR-HOLTMELT-YELLOW', 'Colle HOLTMELT YELLOW', 'SBR', 'HOLTMELT YELLOW', 'Qualite relevee dans le classeur', 400),
    ('SBR-HOTMELT', 'Colle HOTMELT', 'SBR', 'HOTMELT', 'Qualite relevee dans le classeur', 400),
    ('SBR-HOTMELT-GLUE-803', 'Colle HOTMELT GLUE 803', 'SBR', 'HOTMELT GLUE 803', 'Qualite relevee dans le classeur', 400),
    ('SBR-HOTMELT-GLUE-804', 'Colle HOTMELT GLUE 804', 'SBR', 'HOTMELT GLUE 804', 'Qualite relevee dans le classeur', 400),
    ('SBR-HOTMELT-GLUE803', 'Colle HOTMELT  GLUE803', 'SBR', 'HOTMELT  GLUE803', 'Qualite relevee dans le classeur', 400),
    ('SBR-LATEX-70', 'Colle LATEX 70%', 'SBR', 'LATEX 70%', 'Qualite relevee dans le classeur', 400),
    ('SBR-PP-55', 'Colle PP 55', 'SBR', 'PP 55', 'Qualite relevee dans le classeur', 400),
    ('SBR-PP55', 'Colle PP55', 'SBR', 'PP55', 'Qualite relevee dans le classeur', 400),
    ('SBR-T68W27', 'Colle T68W27', 'SBR', 'T68W27', 'Qualite relevee dans le classeur', 400)
ON CONFLICT (code_famille) DO NOTHING;

-- Vues une seule fois : probablement du bruit de colonne. Inactives, pas perdues.
UPDATE famille SET actif = 0 WHERE code_famille IN (
    'PLA-33', 'PLA-40', 'PLA-78', 'PLA-99', 'PLA-107', 'PLA-111', 'PLA-121', 'PLA-124', 'PLA-127', 'PLA-154', 'JUT-10-1', 'JUT-1107-1', 'JUT-22-2', 'JUT-2400-2', 'JUT-2850-1', 'SBR-HOLTMELT-WHITE', 'SBR-HOLTMELT-YELLOW', 'SBR-HOTMELT-GLUE803', 'SBR-PP55');

COMMIT;
