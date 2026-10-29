-- =============================================================================
-- 2026-10-09m — Les paiements des factures d'import et le cout de revient reel
-- (arbitrage du 09/10/2026, « comme les leaders, sans comptabilite »)
-- =============================================================================
-- Le CMUP reste au cours du DEDOUANEMENT, comme la comptabilite : le paiement ne
-- le touche jamais. Le cout cash reel se lit a part, par dossier : matiere (au
-- cours du dedouanement) + frais + ecart de change constate au paiement.
--   * Le cours d'un paiement est celui que la banque a applique : MAD debites
--     divises par la devise payee.
--   * Un ecart par paiement : une facture payee en plusieurs fois a plusieurs
--     cours ; le tableau les additionne.
--   * Les dossiers a cheval sur deux exercices (dedouanes une annee, payes la
--     suivante) : l'ecart se coupe au cours Bank Al-Maghrib du 31/12 — annee N =
--     cours du 31/12 - cours du dedouanement, annee suivante = cours du paiement
--     - cours du 31/12. Une facture encore impayee au 31/12 d'une annee echue
--     porte son ecart latent de l'annee N. Une facture de l'annee en cours non
--     payee n'a pas d'ecart.
-- Le jour du dedouanement est la date de la DUM du dossier, a defaut la date de
-- la facture ; son cours est celui de la facture (cours BAM du jour).
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS paiement_facture_import (
    id_paiement      text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    id_facture       text NOT NULL REFERENCES import_factures(id_facture),
    date_paiement    text NOT NULL,
    montant_devise   numeric(14, 2) NOT NULL CHECK (montant_devise > 0),
    montant_mad      numeric(14, 2) NOT NULL CHECK (montant_mad > 0),
    cours_paiement   numeric(12, 6) GENERATED ALWAYS AS (round(montant_mad / montant_devise, 6)) STORED,
    reference_banque text,
    notes            text,
    id_utilisateur   text REFERENCES utilisateur(id_utilisateur),
    date_creation    text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    CONSTRAINT ck_paiement_date CHECK (date_paiement ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
);
ALTER TABLE paiement_facture_import OWNER TO gestionfil;
CREATE INDEX IF NOT EXISTS ix_fk_paiement_facture_import_facture ON paiement_facture_import(id_facture);
CREATE INDEX IF NOT EXISTS ix_fk_paiement_facture_import_utilisateur ON paiement_facture_import(id_utilisateur);
DROP TRIGGER IF EXISTS trg_audit_modification ON paiement_facture_import;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON paiement_facture_import
FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- Le cours BAM du 31/12 d'une annee (le dernier cours connu a cette date).
CREATE OR REPLACE FUNCTION fn_cours_bam_fin_annee(p_devise text, p_annee int) RETURNS numeric AS $$
    SELECT cours_mad FROM cours_bam
     WHERE code_devise = p_devise AND date_cours::text <= p_annee::text || '-12-31'
     ORDER BY date_cours DESC LIMIT 1;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_cours_bam_fin_annee(text, int) OWNER TO gestionfil;

-- Par paiement : l'ecart, coupe au 31/12 quand le paiement tombe une annee plus tard.
CREATE OR REPLACE VIEW v_change_paiement AS
WITH f AS (
    SELECT fa.id_facture, fa.id_dossier, fa.numero_facture, fa.code_devise, fa.taux_change AS cours_ded,
           substr(COALESCE(NULLIF(btrim(d.date_dum::text), ''), fa.date_facture::text), 1, 10) AS date_ded
      FROM import_factures fa JOIN import_dossiers d ON d.id_dossier = fa.id_dossier
)
SELECT p.id_paiement, f.id_facture, f.id_dossier, f.numero_facture, f.code_devise, f.date_ded, f.cours_ded,
       p.date_paiement::text AS date_paiement, p.montant_devise, p.montant_mad, p.cours_paiement,
       substr(f.date_ded, 1, 4)::int AS annee_ded,
       substr(p.date_paiement, 1, 4)::int AS annee_paiement,
       CASE WHEN substr(p.date_paiement, 1, 4) > substr(f.date_ded, 1, 4)
            THEN fn_cours_bam_fin_annee(f.code_devise, substr(f.date_ded, 1, 4)::int) END AS cours_fin_annee,
       -- L'ecart de l'annee du dedouanement, et celui de l'annee suivante.
       round(CASE WHEN substr(p.date_paiement, 1, 4) > substr(f.date_ded, 1, 4)
                  THEN p.montant_devise * (fn_cours_bam_fin_annee(f.code_devise, substr(f.date_ded, 1, 4)::int) - f.cours_ded)
                  ELSE p.montant_mad - p.montant_devise * f.cours_ded END, 2) AS ecart_annee_ded_mad,
       round(CASE WHEN substr(p.date_paiement, 1, 4) > substr(f.date_ded, 1, 4)
                  THEN p.montant_mad - p.montant_devise * fn_cours_bam_fin_annee(f.code_devise, substr(f.date_ded, 1, 4)::int)
                  ELSE 0 END, 2) AS ecart_annee_suivante_mad
  FROM paiement_facture_import p JOIN f ON f.id_facture = p.id_facture;
ALTER VIEW v_change_paiement OWNER TO gestionfil;

-- Par facture : matiere, frais, change realise et latent, cout reel.
CREATE OR REPLACE VIEW v_cout_revient_reel AS
WITH f AS (
    SELECT fa.id_facture, fa.id_dossier, d.numero AS numero_dossier, fa.numero_facture, fa.code_devise,
           fa.montant_devise, fa.taux_change AS cours_ded,
           substr(COALESCE(NULLIF(btrim(d.date_dum::text), ''), fa.date_facture::text), 1, 10) AS date_ded
      FROM import_factures fa JOIN import_dossiers d ON d.id_dossier = fa.id_dossier
), frais AS (
    SELECT l.id_facture, sum(r.montant_alloue_dhs) AS frais_mad
      FROM lignes_frais_repartition r JOIN import_facture_lignes l ON l.id_ligne = r.id_article_dossier
     GROUP BY l.id_facture
), paye AS (
    SELECT id_facture, sum(montant_devise) AS paye_devise, sum(montant_mad) AS paye_mad,
           sum(ecart_annee_ded_mad) AS ecart_ded, sum(ecart_annee_suivante_mad) AS ecart_suiv,
           count(*) AS nb_paiements
      FROM v_change_paiement GROUP BY id_facture
)
SELECT f.id_facture, f.id_dossier, f.numero_dossier, f.numero_facture, f.code_devise, f.date_ded,
       substr(f.date_ded, 1, 4)::int AS annee_ded,
       f.montant_devise, f.cours_ded,
       round(f.montant_devise * f.cours_ded, 2) AS matiere_mad,
       round(COALESCE(fr.frais_mad, 0), 2) AS frais_mad,
       round(COALESCE(p.paye_devise, 0), 2) AS paye_devise,
       round(COALESCE(p.paye_mad, 0), 2) AS paye_mad,
       COALESCE(p.nb_paiements, 0) AS nb_paiements,
       round(f.montant_devise - COALESCE(p.paye_devise, 0), 2) AS reste_devise,
       fn_cours_bam_fin_annee(f.code_devise, substr(f.date_ded, 1, 4)::int) AS cours_fin_annee_ded,
       -- L'annee du dedouanement : le change realise, plus le latent du reste
       -- impaye quand cette annee est echue.
       round(COALESCE(p.ecart_ded, 0)
             + CASE WHEN substr(f.date_ded, 1, 4)::int < extract(year FROM current_date)::int
                     AND f.montant_devise - COALESCE(p.paye_devise, 0) > 0.005
                    THEN (f.montant_devise - COALESCE(p.paye_devise, 0))
                         * (fn_cours_bam_fin_annee(f.code_devise, substr(f.date_ded, 1, 4)::int) - f.cours_ded)
                    ELSE 0 END, 2) AS change_annee_ded_mad,
       round(COALESCE(p.ecart_suiv, 0), 2) AS change_annee_suivante_mad,
       f.montant_devise - COALESCE(p.paye_devise, 0) > 0.005
         AND substr(f.date_ded, 1, 4)::int < extract(year FROM current_date)::int AS latent
  FROM f
  LEFT JOIN frais fr ON fr.id_facture = f.id_facture
  LEFT JOIN paye p ON p.id_facture = f.id_facture;
ALTER VIEW v_cout_revient_reel OWNER TO gestionfil;

-- Les montants du cout reel sont des montants : declares, masques au magasinier.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'IMPORT', c.champ, c.libelle, 'LECTURE', 1, 950
  FROM (VALUES ('matiere_mad', 'Matiere au cours du dedouanement'), ('frais_mad', 'Frais du dossier'),
               ('paye_mad', 'Dirhams payes'), ('montant_mad', 'Dirhams debites'),
               ('change_annee_ded_mad', 'Change, annee du dedouanement'),
               ('change_annee_suivante_mad', 'Change, annee suivante'),
               ('ecart_annee_ded_mad', 'Ecart de change, annee du dedouanement'),
               ('ecart_annee_suivante_mad', 'Ecart de change, annee suivante')) c(champ, libelle)
ON CONFLICT DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'IMPORT', c.champ,
       CASE WHEN r.code_role_user = 'MAGASIN' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
 CROSS JOIN (SELECT champ FROM champ_configurable WHERE module = 'IMPORT' AND ordre = 950) c
ON CONFLICT DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, 'IMPORT', c.champ, 'MASQUE'
  FROM utilisateur u
 CROSS JOIN (SELECT champ FROM champ_configurable WHERE module = 'IMPORT' AND ordre = 950) c
 WHERE u.code_role_user = 'MAGASIN'
   AND NOT EXISTS (SELECT 1 FROM droit_champ d
                    WHERE d.id_utilisateur = u.id_utilisateur AND d.module = 'IMPORT' AND d.champ = c.champ);

COMMIT;
