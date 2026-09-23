-- =============================================================================
-- MIGRATION 2026-09-11 (c) — LA RECEPTION D'IMPORT, UN DOCUMENT A PART
-- -----------------------------------------------------------------------------
-- La reception n'appartient plus a un dossier : elle a sa propre liste, et ses
-- lignes peuvent venir de factures de plusieurs dossiers. Le lien au dossier
-- passe par les lignes (ligne recue -> ligne de facture -> facture -> dossier).
--
-- Rien ne se perd en retirant la colonne : chaque ligne recue designe deja sa
-- ligne de facture, donc son dossier.
-- =============================================================================

BEGIN;

ALTER TABLE import_receptions DROP COLUMN IF EXISTS id_dossier;   -- emporte ix_import_receptions_dossier
CREATE INDEX IF NOT EXISTS ix_import_receptions_date ON import_receptions(date_reception DESC);

-- Une ligne recue est une ligne ERP, d'un dossier qui n'est pas clos : la
-- cloture a deja reparti les frais sur ce qui etait recu.
CREATE OR REPLACE FUNCTION fn_trg_irl_coherence() RETURNS trigger AS $$
DECLARE
    v_type    text;
    v_numero  text;
    v_statut  text;
BEGIN
    SELECT l.type_ligne, d.numero, d.statut INTO v_type, v_numero, v_statut
      FROM import_facture_lignes l
      JOIN import_factures f ON f.id_facture = l.id_facture
      JOIN import_dossiers d ON d.id_dossier = f.id_dossier
     WHERE l.id_ligne = NEW.id_ligne;

    IF v_type IS DISTINCT FROM 'ERP' THEN
        RAISE EXCEPTION 'Une ligne hors ERP ne se receptionne pas : elle ne porte que sa part de frais.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_statut = 'CLOTURE' THEN
        RAISE EXCEPTION 'Le dossier % est cloture : il ne recoit plus rien.', v_numero
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_trg_irl_coherence() OWNER TO gestionfil;

-- La liste des receptions d'import se lit avec le module RECEPTIONS : ses
-- colonnes propres doivent etre declarees, sinon l'ecran les masque.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('RECEPTIONS', 'dossiers',    'Dossiers d''import',  'LECTURE', 0, 800),
 ('RECEPTIONS', 'quantite_kg', 'Poids recu (kg)',     'LECTURE', 0, 805),
 ('RECEPTIONS', 'ecart_kg',    'Ecart (kg)',          'LECTURE', 0, 810),
 ('RECEPTIONS', 'nb_bobines',  'Bobines',             'LECTURE', 0, 815),
 ('RECEPTIONS', 'nb_palettes', 'Palettes',            'LECTURE', 0, 820)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN EXISTS (SELECT 1 FROM permission p
                          WHERE p.code_role_user = r.code_role_user
                            AND p.module = 'RECEPTIONS' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'RECEPTIONS' AND c.champ IN ('dossiers', 'quantite_kg', 'ecart_kg', 'nb_bobines', 'nb_palettes')
   AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'RECEPTIONS' AND m.champ IN ('dossiers', 'quantite_kg', 'ecart_kg', 'nb_bobines', 'nb_palettes')
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
