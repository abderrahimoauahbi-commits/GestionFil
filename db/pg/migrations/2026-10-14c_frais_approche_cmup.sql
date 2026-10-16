-- =============================================================================
-- 2026-10-14c — ADR-003 phase C (2/2) : les frais d'approche LOCAUX au CUMP
-- =============================================================================
-- La table `frais_approche` existait depuis le portage (017a) — fret, douane,
-- assurance, manutention, chacun avec sa clé de répartition — et personne ne
-- s'en servait : aucun écran ne la remplissait, et surtout **aucun de ces frais
-- n'atteignait le CUMP**. La clôture d'une réception ne connaissait qu'un
-- `frais_mad`, un total tapé à la main sur la facture, réparti à la valeur.
--
-- Le coût de revient complet, lui, demande deux choses que cette migration
-- apporte :
--
--   * CHAQUE FRAIS SE RÉPARTIT SELON SA PROPRE CLÉ. Un fret va au POIDS, une
--     assurance à la VALEUR, une manutention en PARTS ÉGALES. Les mélanger dans
--     un total unique réparti à la valeur fait payer le fret au prix du kilo :
--     la matière chère porte le transport de la matière lourde.
--
--   * UN FRAIS PORTÉ NE SE PORTE PAS DEUX FOIS. `date_portee` dit quand la
--     clôture l'a passé au CUMP ; après quoi il est figé, comme toute écriture
--     qui a bougé une valeur de stock.
--
-- `origine = 'FRAIS'` dans le journal des ajustements les distingue de l'écart
-- de prix de la facture : au contrôle, « pourquoi ce CUMP a bougé » se lit sans
-- avoir à recalculer.
--
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- --- Le journal accueille les frais ------------------------------------------
ALTER TABLE reception_ajustements_cmup DROP CONSTRAINT IF EXISTS ck_rec_ajust_origine;
ALTER TABLE reception_ajustements_cmup ADD CONSTRAINT ck_rec_ajust_origine
    CHECK (origine = ANY (ARRAY['CLOTURE', 'AVOIR', 'COMPLEMENT', 'AVOIR_RETOUR',
                                'FACTURE_NETTE', 'FRAIS'])
           -- Tout ce qui n'est pas la clôture elle-même se motive : pour un
           -- frais, c'est son libellé, qui dit ce qu'on a payé.
           AND (origine = 'CLOTURE' OR length(btrim(COALESCE(motif, ''))) >= 5));

-- --- Un frais porté au CUMP est figé ------------------------------------------
ALTER TABLE frais_approche
  ADD COLUMN IF NOT EXISTS date_portee text;

COMMENT ON COLUMN frais_approche.date_portee IS
  'Quand la clôture de la réception a passé ce frais au CUMP (ADR-003 phase C). '
  'Renseignée, le frais est figé : il a bougé une valeur de stock.';

CREATE OR REPLACE FUNCTION fn_trg_frais_approche_porte() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.date_portee IS NOT NULL THEN
            RAISE EXCEPTION 'FRAIS-PORTE : ce frais est deja passe au CUMP le % : il ne se supprime plus. Corrigez par un avoir sur la reception.',
                substr(OLD.date_portee, 1, 10) USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    -- La clôture pose `date_portee` : c'est la seule modification admise.
    IF OLD.date_portee IS NOT NULL
       AND (NEW.montant_devise, NEW.code_devise, NEW.taux_change, NEW.cle_repartition,
            NEW.type_frais, NEW.id_reception)
           IS DISTINCT FROM
           (OLD.montant_devise, OLD.code_devise, OLD.taux_change, OLD.cle_repartition,
            OLD.type_frais, OLD.id_reception) THEN
        RAISE EXCEPTION 'FRAIS-PORTE : ce frais est deja passe au CUMP le % : son montant, sa devise et sa cle ne bougent plus.',
            substr(OLD.date_portee, 1, 10) USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_frais_approche_porte() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_frais_approche_porte ON frais_approche;
CREATE TRIGGER trg_frais_approche_porte
    BEFORE UPDATE OR DELETE ON frais_approche
    FOR EACH ROW EXECUTE FUNCTION fn_trg_frais_approche_porte();

-- --- Les colonnes du tableau des frais se déclarent --------------------------
-- Non déclarée, une colonne n'apparaît dans aucun écran : la grille des champs
-- ne connaît que ce qui est ici.
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre)
SELECT 'VALORISATION', c.champ, c.libelle, 'LECTURE', c.sensible, c.ordre
  FROM (VALUES ('numero_reception', 'Réception',             0, 900),
               ('type_frais',       'Nature du frais',       0, 910),
               ('libelle',          'Libellé',               0, 920),
               ('montant_devise',   'Montant (devise)',      1, 930),
               ('taux_change',      'Taux de change',        0, 940),
               ('cle_repartition',  'Clé de répartition',    0, 950),
               ('reference_externe','Pièce (facture, DUM)',  0, 960),
               ('date_frais',       'Date du frais',         0, 970),
               ('date_portee',      'Porté au CUMP le',      0, 980))
       c(champ, libelle, sensible, ordre)
ON CONFLICT DO NOTHING;

-- Le montant en dirhams d'un frais est un montant : masqué à qui ne voit pas la
-- valeur du stock, comme les autres.
INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT r.code_role_user, 'VALORISATION', 'montant_devise',
       CASE WHEN r.code_role_user = 'MAGASIN' THEN 'MASQUE' ELSE 'LECTURE' END
  FROM (SELECT DISTINCT code_role_user FROM modele_droit_champ) r
ON CONFLICT DO NOTHING;

INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT u.id_utilisateur, m.module, m.champ, m.niveau
  FROM utilisateur u
  JOIN modele_droit_champ m ON m.code_role_user = u.code_role_user
 WHERE m.module = 'VALORISATION' AND m.champ = 'montant_devise' AND m.niveau = 'MASQUE'
   AND NOT EXISTS (SELECT 1 FROM droit_champ d
                    WHERE d.id_utilisateur = u.id_utilisateur
                      AND d.module = m.module AND d.champ = m.champ);

COMMIT;
