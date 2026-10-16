-- =============================================================================
-- 2026-10-12a — La repartition choisie sur la ligne de frais d'un dossier
-- =============================================================================
-- Decision du 12/10/2026 : les frais du dossier restent ce qu'ils etaient
-- (saisis dans le tableau, avec les factures ou les lignes qu'ils visent ;
-- portes au CUMP a la cloture). Chaque ligne de frais dit sa repartition :
-- par defaut celle de son type (parametrage : valeur, poids…), ou MANUELLE —
-- le montant de chaque ligne de facture se saisit dans l'onglet Liquidation
-- (la douane par nature de reference). Un frais manuel dont la somme n'egale
-- pas le montant est « non reparti » : la cloture le refuse.
-- Et le journal : les lignes visees et la repartition entrent a l'audit ;
-- le montant reparti est masque au magasinier, comme les autres montants.
-- Rejouable. Enregistree par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- NULL : celle du type de frais.
ALTER TABLE dossier_lignes_frais ADD COLUMN IF NOT EXISTS methode_repartition text;
ALTER TABLE dossier_lignes_frais DROP CONSTRAINT IF EXISTS ck_dlf_methode;
ALTER TABLE dossier_lignes_frais ADD CONSTRAINT ck_dlf_methode
    CHECK (methode_repartition IS NULL
           OR methode_repartition = ANY (ARRAY['VALEUR', 'POIDS', 'QUANTITE', 'PARTS_EGALES', 'MANUEL']));

DROP TRIGGER IF EXISTS trg_audit_modification ON dossier_lignes_frais_cibles;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON dossier_lignes_frais_cibles
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();
DROP TRIGGER IF EXISTS trg_audit_modification ON lignes_frais_repartition;
CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE OR DELETE ON lignes_frais_repartition
    FOR EACH ROW EXECUTE FUNCTION fn_trg_audit_modification();

-- Le montant reparti d'un frais : un montant, masque comme eux au magasinier.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
VALUES ('IMPORT', 'reparti_dhs', 'Montant réparti (DH)', 'LECTURE', 1, 2111)
ON CONFLICT DO NOTHING;
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'IMPORT', 'reparti_dhs', CASE WHEN r.code_role_user = 'MAGASIN' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
ON CONFLICT DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'IMPORT' AND m.champ = 'reparti_dhs' AND m.niveau = 'MASQUE'
   AND NOT EXISTS (SELECT 1 FROM droit_champ d
                    WHERE d.id_utilisateur = u.id_utilisateur AND d.module = m.module AND d.champ = m.champ);

COMMIT;
