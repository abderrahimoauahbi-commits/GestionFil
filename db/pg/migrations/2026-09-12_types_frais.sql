-- =============================================================================
-- MIGRATION 2026-09-12 — LE CATALOGUE DES TYPES DE FRAIS S'ADMINISTRE
-- -----------------------------------------------------------------------------
-- Un type de frais ne dit plus seulement s'il entre dans le cout. Il dit aussi :
--
--   * la PIECE qui le justifie (quittance de la douane, facture du transitaire) :
--     c'est ce que l'assistante doit avoir en main, et ce que la saisie assistee
--     reconnaitra dans un document depose ;
--   * s'il est RECUPERABLE — la TVA a l'importation l'est : elle se saisit, elle
--     ne rejoint jamais le cout de revient ;
--   * s'il est COMMUN au dossier, ou s'il vise des lignes designees ;
--   * COMMENT il se repartit : a la valeur (la regle du classeur), au poids, a la
--     quantite, ou a parts egales.
--
-- Les dix types d'origine sont (re)poses avec leur piece justificative.
-- =============================================================================

BEGIN;

ALTER TABLE parametres_frais ADD COLUMN IF NOT EXISTS piece_justificative text;
ALTER TABLE parametres_frais ADD COLUMN IF NOT EXISTS recuperable bigint NOT NULL DEFAULT 0;
ALTER TABLE parametres_frais ADD COLUMN IF NOT EXISTS commun      bigint NOT NULL DEFAULT 1;
ALTER TABLE parametres_frais ADD COLUMN IF NOT EXISTS methode_repartition text NOT NULL DEFAULT 'VALEUR';

-- La TVA etait deja hors cout : elle devient explicitement recuperable.
UPDATE parametres_frais SET recuperable = 1 WHERE id_frais = 'TVA';

DO $$ BEGIN
    ALTER TABLE parametres_frais ADD CONSTRAINT parametres_frais_recuperable_check
        CHECK (recuperable IN (0,1));
    ALTER TABLE parametres_frais ADD CONSTRAINT parametres_frais_commun_check
        CHECK (commun IN (0,1));
    ALTER TABLE parametres_frais ADD CONSTRAINT parametres_frais_methode_check
        CHECK (methode_repartition IN ('VALEUR','POIDS','QUANTITE','PARTS_EGALES'));
    -- Un frais recuperable se recupere : le porter au cout ferait payer deux
    -- fois la marchandise.
    ALTER TABLE parametres_frais ADD CONSTRAINT parametres_frais_recup_hors_cout_check
        CHECK (recuperable = 0 OR inclus_dans_cout = 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO parametres_frais (id_frais, libelle, categorie, piece_justificative,
                              recuperable, commun, methode_repartition, inclus_dans_cout, ordre) VALUES
    ('DOUANE',    'Droits de douane (D.D.)',      'DOUANE',    'Quittance de la douane',            0, 1, 'VALEUR', 1, 10),
    ('TVA',       'TVA a l''importation',         'TAXE',      'Quittance de la douane',            1, 1, 'VALEUR', 0, 20),
    ('PORT_MED',  'Port Tanger Med',              'PORT',      'Facture du port',                   0, 1, 'VALEUR', 1, 30),
    ('FRET',      'Fret',                         'TRANSPORT', 'Facture du transporteur maritime',  0, 1, 'VALEUR', 1, 40),
    ('TREMSA',    'Transitaire (TREMSA / WIDEM)', 'TRANSIT',   'Facture du transitaire',            0, 1, 'VALEUR', 1, 50),
    ('TIMBRE',    'Timbre',                       'TAXE',      'Timbre fiscal',                     0, 1, 'VALEUR', 1, 60),
    ('INT_OC',    'INT/OC',                       'TRANSIT',   'Facture du transitaire',            0, 1, 'VALEUR', 1, 70),
    ('TMSA',      'TMSA',                         'PORT',      'Facture TMSA',                      0, 1, 'VALEUR', 1, 80),
    ('TRANSPORT', 'Transport local',              'TRANSPORT', 'Facture du transporteur routier',   0, 1, 'VALEUR', 1, 90),
    ('AUTRE',     'Autre frais',                  'AUTRE',     NULL,                                0, 0, 'VALEUR', 1, 99)
ON CONFLICT (id_frais) DO UPDATE SET
    piece_justificative = excluded.piece_justificative,
    recuperable = excluded.recuperable, commun = excluded.commun,
    methode_repartition = excluded.methode_repartition;

-- Le CHECK protege la donnee ; ce declencheur protege l'utilisateur : il dit
-- POURQUOI, en francais, au lieu de laisser remonter une contrainte.
CREATE OR REPLACE FUNCTION fn_trg_pf_coherence() RETURNS trigger AS $$
BEGIN
    IF NEW.recuperable = 1 AND NEW.inclus_dans_cout = 1 THEN
        RAISE EXCEPTION 'Un frais recuperable n''entre pas dans le cout de revient : la marchandise le paierait deux fois.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_trg_pf_coherence() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_pf_coherence ON parametres_frais;
CREATE TRIGGER trg_pf_coherence
BEFORE INSERT OR UPDATE OF recuperable, inclus_dans_cout ON parametres_frais
FOR EACH ROW EXECUTE FUNCTION fn_trg_pf_coherence();

-- L'ecran d'administration se lit avec le module PARAMETRES : ses colonnes
-- doivent y etre declarees, sinon elles disparaissent sans un mot.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('PARAMETRES', 'id_frais',            'Code du frais',         'ECRITURE', 0, 900),
 ('PARAMETRES', 'piece_justificative', 'Piece justificative',   'ECRITURE', 0, 905),
 ('PARAMETRES', 'recuperable',         'Recuperable',           'ECRITURE', 0, 910),
 ('PARAMETRES', 'commun',              'Commun au dossier',     'ECRITURE', 0, 915),
 ('PARAMETRES', 'inclus_dans_cout',    'Entre dans le cout',    'ECRITURE', 0, 920),
 ('PARAMETRES', 'methode_repartition', 'Methode de repartition','ECRITURE', 0, 925),
 ('PARAMETRES', 'ordre',               'Ordre d''affichage',    'ECRITURE', 0, 930),
 ('PARAMETRES', 'actif',               'Actif',                 'ECRITURE', 0, 935),
 ('PARAMETRES', 'nb_utilisations',     'Dossiers concernes',    'LECTURE',  0, 940)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN c.niveau_defaut = 'ECRITURE' AND EXISTS (
                 SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                  AND p.module = 'PARAMETRES' AND p.action = 'ECRIRE') THEN 'ECRITURE'
            WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                          AND p.module = 'PARAMETRES' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'PARAMETRES' AND c.ordre BETWEEN 900 AND 940 AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'PARAMETRES' AND c.ordre BETWEEN 900 AND 940
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
