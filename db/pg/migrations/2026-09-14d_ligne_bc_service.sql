-- =============================================================================
-- LES LIGNES DE SERVICE SUR UN BON DE COMMANDE
--
-- Un bon ne porte pas que de la marchandise. Le transport, la commission d'un
-- agent, une piece detachee, une prestation : tout cela se commande, se
-- facture, et doit figurer sur le bon qu'on envoie au fournisseur et sur le
-- montant qu'on engage. Jusqu'ici c'etait impossible — `code_reference` etait
-- obligatoire et pointait vers le catalogue, si bien qu'il fallait inventer une
-- fausse reference pour faire passer un fret. Le referentiel se maquillait pour
-- contourner l'ecran, et cette fausse reference entrait ensuite en stock.
--
-- CE QU'UNE LIGNE DE SERVICE N'EST PAS. Elle ne se receptionne jamais : il n'y
-- a rien a peser au quai. Elle n'entre pas en stock, ne pese sur aucun CMUP,
-- n'apparait dans aucun en-cours d'approvisionnement. Le MRP ne la voit pas.
--
-- COMMENT ELLE EST NEUTRALISEE, SANS FILTRE PARTOUT. Sa quantite en kilos vaut
-- ZERO. Toutes les vues d'en-cours filtrent deja `quantite_restante_kg > 0` ;
-- une ligne a zero kilo en sort d'elle-meme, sans qu'il faille les reecrire.
-- Ce qui reste a filtrer explicitement l'est dans le meme lot : la cloture du
-- bon, la liste des lignes attendues, et le controle C28.
--
-- LE MODELE VIENT DE LA FACTURE D'IMPORT, qui resout deja le meme probleme
-- (018_schema_import.sql : `type_ligne IN ('ERP','HORS_ERP')`). Meme vocabulaire,
-- meme CHECK d'exclusion mutuelle : deux mecaniques identiques doivent se
-- ressembler, sinon la seconde se relit comme une exception.
-- =============================================================================

BEGIN;

-- --- 1. Le type de ligne, et ce qui le distingue -----------------------------

ALTER TABLE ligne_bc
    ADD COLUMN IF NOT EXISTS type_ligne text NOT NULL DEFAULT 'MARCHANDISE';

ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_type_ligne_check;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_type_ligne_check
    CHECK (type_ligne IN ('MARCHANDISE', 'SERVICE'));

-- Ce que la ligne designe quand aucune reference ne la nomme.
ALTER TABLE ligne_bc ADD COLUMN IF NOT EXISTS libelle text;

-- --- 2. La reference devient facultative, sous conditions --------------------

ALTER TABLE ligne_bc ALTER COLUMN code_reference DROP NOT NULL;

-- L'EXCLUSION MUTUELLE. Une ligne de marchandise porte une reference et un
-- poids ; une ligne de service porte un libelle et rien d'autre. Sans ce CHECK,
-- une ligne de service pourrait naitre avec une reference et des kilos, et
-- redeviendrait de la marchandise fantome que le quai attendrait en vain.
ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_type_coherent;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_type_coherent
    CHECK (
        (type_ligne = 'MARCHANDISE'
             AND code_reference IS NOT NULL
             AND quantite_commandee_kg > 0)
     OR (type_ligne = 'SERVICE'
             AND code_reference IS NULL
             AND libelle IS NOT NULL AND btrim(libelle) <> ''
             AND quantite_commandee_kg = 0
             AND facteur_kg = 1
             AND id_proposition IS NULL
             AND besoin_kg_origine IS NULL)
    );

-- --- 3. Les contraintes qui supposaient de la marchandise --------------------

-- Le poids commande devait etre strictement positif : un service n'en a pas.
-- C'est desormais le CHECK d'exclusion ci-dessus qui l'exige, du seul cote ou
-- il a un sens.
ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_quantite_commandee_kg_check;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_quantite_commandee_kg_check
    CHECK (quantite_commandee_kg >= 0);

-- La coherence de la conversion (kg = unites x facteur) ne vaut que pour la
-- marchandise. Un forfait de transport n'a pas de facteur au kilo ; son
-- `facteur_kg` vaut 1 par convention, pour que `prix_kg_devise` reste calculable
-- sans division par zero.
-- DEUX NOMS A RETIRER, ET C'EST VOULU. `ligne_bc_check` est le nom anonyme que
-- PostgreSQL avait donne a la contrainte d'origine ; `ligne_bc_conversion_coherente`
-- est celui qu'on lui donne ici. Sans le second DROP, rejouer cette migration
-- echoue sur « la contrainte existe deja » — ce qui s'est produit en publication,
-- a mi-chemin, sur une base a demi migree. Une migration qu'on ne peut pas
-- rejouer est un piege : elle n'est utilisable qu'une fois, et on ne sait jamais
-- si cette fois-la a eu lieu.
ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_check;
ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_conversion_coherente;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_conversion_coherente
    CHECK (type_ligne <> 'MARCHANDISE'
        OR abs(quantite_commandee_kg - quantite_commandee_unite * facteur_kg) < 0.001);

-- L'unite de commande : un service se compte en forfait, en heures, en pieces.
ALTER TABLE ligne_bc DROP CONSTRAINT IF EXISTS ligne_bc_unite_commande_check;
ALTER TABLE ligne_bc
    ADD CONSTRAINT ligne_bc_unite_commande_check
    CHECK (unite_commande IN ('kg', 'Palette', 'Bobine', 'ml',
                              'Forfait', 'Unite', 'Heure'));

-- L'index de reference ne sert que la marchandise : partiel, il ignore les
-- services au lieu de leur reserver une entree NULL par ligne.
DROP INDEX IF EXISTS ix_ligne_bc_ref;
CREATE INDEX ix_ligne_bc_ref ON ligne_bc(code_reference)
    WHERE code_reference IS NOT NULL;

-- --- 4. Le garde-fou de substitution en reception ----------------------------
--
-- `NEW.code_reference <> (SELECT code_reference FROM ligne_bc ...)` rend NULL —
-- donc jamais vrai — des que la ligne de bon est un service. Le controle
-- s'ouvrait alors en grand : n'importe quelle marchandise pouvait se rattacher
-- a une ligne « transport », sans un mot. `IS DISTINCT FROM` traite le NULL, et
-- le rattachement a un service est refuse explicitement.

CREATE OR REPLACE FUNCTION fn_trg_ligne_reception_substitution() RETURNS trigger AS $$
DECLARE
    v_type      text;
    v_commandee text;
BEGIN
    IF NEW.id_ligne_bc IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT type_ligne, code_reference INTO v_type, v_commandee
      FROM ligne_bc WHERE id_ligne_bc = NEW.id_ligne_bc;

    -- Une ligne de service n'attend aucune marchandise : rien ne s'y pese.
    IF v_type = 'SERVICE' THEN
        RAISE EXCEPTION 'La ligne de commande visee est une prestation, pas de la marchandise : on ne peut pas y receptionner %.', NEW.code_reference;
    END IF;

    -- `IS DISTINCT FROM` et non `<>` : la comparaison d'origine rendait NULL
    -- des que la ligne de bon n'en portait pas, et le garde-fou ne se
    -- declenchait jamais.
    IF NEW.code_reference IS DISTINCT FROM v_commandee
   AND (NEW.substitution_acceptee = 0
        OR NOT EXISTS (
            SELECT 1 FROM v_equivalence e
             WHERE e.code_reference = v_commandee
               AND e.equivalent_reference = NEW.code_reference
               AND e.interchangeable = 1)) THEN
        RAISE EXCEPTION 'Reference recue differente de la reference commandee. Elle n''est acceptable que si les deux references appartiennent au meme groupe d''equivalence, sont interchangeables (meme unite, meme densite, meme categorie), et que la substitution est explicitement confirmee.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- --- 5. Les vues d'en-cours : dire ce qu'elles font --------------------------
--
-- Le filtre `quantite_restante_kg > 0` les protege deja, puisqu'un service pese
-- zero. Mais une protection obtenue par accident se perd au premier
-- refactoring : on l'ecrit. `CREATE OR REPLACE` conserve les colonnes, donc les
-- vues qui dependent de celles-ci ne sont pas touchees.

CREATE OR REPLACE VIEW v_encours_bc AS
SELECT
    lb.code_reference,
    ROUND(SUM(lb.quantite_restante_kg), 4) AS encours_kg,
    COUNT(DISTINCT lb.id_bc)               AS nb_bc_ouverts,
    MIN(lb.date_livraison_prevue)          AS prochaine_livraison
FROM ligne_bc lb
JOIN bon_commande bc ON bc.id_bc = lb.id_bc
WHERE bc.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
  AND lb.statut NOT IN ('ANNULE','SOLDE')
  AND lb.type_ligne = 'MARCHANDISE'
  AND lb.quantite_restante_kg > 0
GROUP BY lb.code_reference;

CREATE OR REPLACE VIEW v_encours_fiable AS
SELECT
    lb.code_reference,
    ROUND(SUM(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) >= to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
                     OR lb.date_livraison_prevue IS NULL
                   THEN lb.quantite_restante_kg ELSE 0 END), 4)       AS encours_fiable_kg,
    ROUND(SUM(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) <  to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
                   THEN lb.quantite_restante_kg ELSE 0 END), 4)       AS encours_retarde_kg,
    SUM(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) <  to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
             THEN 1 ELSE 0 END)                                       AS nb_lignes_retardees,
    MIN(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) <  to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
             THEN lb.date_livraison_prevue END)                       AS plus_ancien_retard,
    MAX(CASE WHEN substr(lb.date_livraison_prevue, 1, 10) <  to_char(current_date - (p_ret.v)::integer, 'YYYY-MM-DD')
             THEN CAST((current_date - (lb.date_livraison_prevue)::date) AS bigint) END)
                                                                      AS retard_max_jours
FROM ligne_bc lb
JOIN bon_commande bc ON bc.id_bc = lb.id_bc
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_RetardBCJours') p_ret
WHERE bc.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
  AND lb.statut NOT IN ('ANNULE','SOLDE')
  AND lb.type_ligne = 'MARCHANDISE'
  AND lb.quantite_restante_kg > 0
GROUP BY lb.code_reference;

CREATE OR REPLACE VIEW v_ctl_c28 AS
SELECT lb.code_reference, r.designation, bc.numero_bc, bc.code_fournisseur,
       lb.date_livraison_prevue,
       CAST((current_date - (lb.date_livraison_prevue)::date) AS bigint) AS retard_jours,
       lb.quantite_restante_kg
FROM ligne_bc lb
JOIN bon_commande bc ON bc.id_bc = lb.id_bc
JOIN reference r     ON r.code_reference = lb.code_reference
CROSS JOIN (SELECT CAST(valeur_courante AS numeric) v FROM parametre WHERE code_parametre = 'P_RetardBCJours') p
WHERE bc.statut IN ('VALIDE','ENVOYE','LIVRE_PARTIEL')
  AND lb.statut NOT IN ('ANNULE','SOLDE')
  AND lb.type_ligne = 'MARCHANDISE'
  AND lb.quantite_restante_kg > 0
  AND substr(lb.date_livraison_prevue, 1, 10) < to_char(current_date - (p.v)::integer, 'YYYY-MM-DD');

-- --- 6. Les droits de champ -------------------------------------------------
--
-- UN CHAMP NON DECLARE EST MASQUE POUR TOUT LE MONDE : la colonne disparait de
-- l'ecran sans un mot. `type_ligne` et `libelle` doivent donc etre declares
-- avant d'etre affiches, et la grille des roles re-derivee pour la base
-- vivante, peuplee avant cette declaration.

INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('BONS_COMMANDE','type_ligne', 'Type de ligne',         'LECTURE', 0,  85),
 ('BONS_COMMANDE','libelle',    'Libelle de prestation', 'LECTURE', 0,  88)
ON CONFLICT (module, champ) DO UPDATE SET
    libelle = excluded.libelle, sensible = excluded.sensible, ordre = excluded.ordre;

-- Le niveau suit le role, comme partout : qui ne lit pas les bons de commande
-- ne lira pas davantage le type de leurs lignes.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, c.module, c.champ,
       CASE WHEN EXISTS (SELECT 1 FROM permission p
                          WHERE p.code_role_user = r.code_role_user
                            AND p.module = c.module AND p.action = 'LIRE')
            THEN 'LECTURE' ELSE 'MASQUE' END
  FROM role_utilisateur r
  CROSS JOIN champ_configurable c
 WHERE c.module = 'BONS_COMMANDE' AND c.champ IN ('type_ligne', 'libelle')
   AND r.actif = 1
ON CONFLICT (code_role_user, module, champ) DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'BONS_COMMANDE' AND m.champ IN ('type_ligne', 'libelle')
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

COMMIT;
