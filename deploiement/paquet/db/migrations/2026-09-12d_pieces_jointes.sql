-- =============================================================================
-- MIGRATION 2026-09-12 (d) — LES PIECES DU DOSSIER
-- -----------------------------------------------------------------------------
-- Un dossier d'importation, c'est une douzaine de documents : la facture du
-- fournisseur, la DUM, la quittance de la douane, la fiche de liquidation, les
-- factures du transitaire, du port, du transporteur. Aujourd'hui ils vivent
-- dans une chemise en carton et dans un scan sur un bureau.
--
-- La piece se RANGE avec le dossier : c'est ce qui permet de verifier une
-- saisie sans se lever, de repondre a un controle, et — demain — de la faire
-- lire par l'assistant.
--
-- LE FICHIER N'EST PAS DANS LA BASE. Une base qui porte des scans grossit sans
-- fin et rend chaque sauvegarde plus lourde que la precedente. La table porte
-- le CHEMIN ; les octets restent sur le disque du serveur, dans un repertoire
-- que la configuration nomme (GESTIONFIL_PIECES).
--
-- L'EMPREINTE (sha256) sert a deux choses : reconnaitre un document deja
-- depose — un scan refait, un envoi en double — et prouver qu'il n'a pas bouge.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS piece_jointe (
    id_piece         text    NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    -- A quoi la piece se rattache. Une piece appartient TOUJOURS a un dossier ;
    -- elle peut en plus viser une facture ou une reception precise.
    id_dossier       text    NOT NULL REFERENCES import_dossiers(id_dossier) ON DELETE CASCADE,
    id_facture       text    REFERENCES import_factures(id_facture) ON DELETE SET NULL,
    id_reception     text    REFERENCES import_receptions(id_reception) ON DELETE SET NULL,
    -- Ce que le document EST. `id_frais` relie la piece au type de frais
    -- qu'elle justifie (quittance de la douane -> DOUANE et TVA) : c'est le
    -- lien que la saisie assistee suivra.
    nature           text    NOT NULL DEFAULT 'AUTRE'
                             CHECK (nature IN ('FACTURE_FOURNISSEUR','DUM','QUITTANCE_DOUANE',
                                               'LIQUIDATION','FACTURE_FRAIS','BL','PACKING',
                                               'ENGAGEMENT','AUTRE')),
    id_frais         text    REFERENCES parametres_frais(id_frais),
    libelle          text,

    nom_fichier      text    NOT NULL,
    type_mime        text    NOT NULL,
    taille_octets    bigint  NOT NULL CHECK (taille_octets > 0),
    nb_pages         bigint  CHECK (nb_pages IS NULL OR nb_pages > 0),
    chemin           text    NOT NULL UNIQUE,
    empreinte_sha256 text    NOT NULL,

    date_depot       text    NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    id_utilisateur   text    NOT NULL REFERENCES utilisateur(id_utilisateur),
    notes            text
);

CREATE INDEX IF NOT EXISTS ix_piece_dossier   ON piece_jointe(id_dossier, date_depot DESC);
CREATE INDEX IF NOT EXISTS ix_piece_empreinte ON piece_jointe(empreinte_sha256);

-- Un dossier clos ne recoit plus de piece : ce qui a servi a corriger le CUMP
-- ne se complete pas apres coup. La consultation, elle, reste ouverte.
CREATE OR REPLACE FUNCTION fn_trg_piece_verrou() RETURNS trigger AS $$
DECLARE
    v_statut text;
    v_numero text;
BEGIN
    SELECT statut, numero INTO v_statut, v_numero FROM import_dossiers
     WHERE id_dossier = COALESCE(NEW.id_dossier, OLD.id_dossier);
    IF v_statut = 'CLOTURE' THEN
        RAISE EXCEPTION 'Dossier % cloture : ses pieces sont figees.', v_numero
            USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_trg_piece_verrou() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_piece_verrou ON piece_jointe;
CREATE TRIGGER trg_piece_verrou
BEFORE INSERT OR UPDATE OR DELETE ON piece_jointe
FOR EACH ROW EXECUTE FUNCTION fn_trg_piece_verrou();

ALTER TABLE piece_jointe OWNER TO gestionfil;

-- Les colonnes de la liste des pieces, cote ecran (module IMPORT).
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('IMPORT', 'nom_fichier',   'Fichier',        'LECTURE', 0, 2200),
 ('IMPORT', 'nature',        'Nature',         'LECTURE', 0, 2205),
 ('IMPORT', 'taille_octets', 'Taille',         'LECTURE', 0, 2210),
 ('IMPORT', 'nb_pages',      'Pages',          'LECTURE', 0, 2215),
 ('IMPORT', 'date_depot',    'Depose le',      'LECTURE', 0, 2220),
 ('IMPORT', 'depose_par',    'Depose par',     'LECTURE', 0, 2225)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN EXISTS (SELECT 1 FROM permission p WHERE p.code_role_user = r.code_role_user
                          AND p.module = 'IMPORT' AND p.action = 'LIRE') THEN 'LECTURE'
            ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'IMPORT' AND c.ordre BETWEEN 2200 AND 2225 AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
  JOIN champ_configurable c ON c.module = m.module AND c.champ = m.champ
 WHERE m.module = 'IMPORT' AND c.ordre BETWEEN 2200 AND 2225
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
