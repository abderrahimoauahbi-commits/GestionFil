-- =============================================================================
-- 2026-10-23b — La qualité explicite sur toute consommation de fabrication
-- =============================================================================
-- Décision du 23/10/2026 : « Quand on choisit un OF ou non, on doit explicitement
-- définir la qualité, et de même dans la machine. »
--
--   1. LA CONSOMMATION DIRECTE ET SON RETOUR (CONSO_DIRECTE, RETOUR_CONSO) portent
--      une qualité (`mouvement.code_qualite`) :
--        - avec un OF : la qualité de l'OF — posée par la base si l'écran ne la
--          dit pas, refusée si elle en diffère (QUALITE-OF) ;
--        - sans OF : OBLIGATOIRE (QUALITE-OBLIGATOIRE).
--      Les autres mouvements ne portent pas de qualité (les sorties hors machine
--      ordinaires — atelier, échantillon, essai, réparation, prêt — et le déchet
--      restent SANS qualité : défaut retenu le 23/10/2026).
--   2. LE RETOUR SANS OF devient possible, borné comme le retour d'un OF : jamais
--      plus que ce que cette QUALITÉ a sorti SANS OF de cette référence et pas
--      encore rendu ; la sortie sans OF ne se contre-passe pas tant qu'un retour
--      en dépend (défaut le plus prudent, symétrique de l'OF).
--   3. LA MACHINE : la qualité sur la fiche (défaut des lignes), sur chaque ligne
--      de fiche, sur l'état de l'étage (`machine_etat`), sur l'état archivé d'une
--      décision (`machine_decision_etat`, la dévalidation rend celui d'avant) et
--      sur la ligne de décision : la qualité NOUVELLE (`code_qualite`) et la
--      QUALITÉ DE LA PÉRIODE (`code_qualite_periode`), celle que la ligne servait
--      avant ce constat — l'écart lui appartient (même frontière que
--      `id_of_periode`). En base : cohérence avec l'OF (QUALITE-OF) et qualité
--      obligatoire sur une ligne de CHARGEMENT (QUALITE-OBLIGATOIRE).
--   4. LES STATISTIQUES PAR QUALITÉ (`v_qualite_consommation`) comptent AUSSI ce qui
--      n'a pas d'OF mais a une qualité, au mois du mouvement ou du constat (date
--      de la fiche) ; l'historique sans qualité apparaît en « Non attribué »
--      (code_qualite vide). La part des OF est inchangée : nb_of, métrage, prévu
--      et écart réel − prévu ne portent que sur les OF ; `kg_reel_of`,
--      `kg_reel_sans_of` et `attribue` s'ajoutent en fin.
--   5. C62 prend le sens nouveau : une consommation directe sans OF NI qualité —
--      l'historique d'avant le 23/10/2026, qui reste « Non attribué ». Une
--      consommation sans OF mais avec sa qualité n'est plus un signal.
--   6. Les champs affichés, déclarés (`champ_configurable`).
--
-- Rejouable. Enregistrée par migrer.py.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '10s';

-- -----------------------------------------------------------------------------
-- 1. Les colonnes
-- -----------------------------------------------------------------------------
ALTER TABLE mouvement              ADD COLUMN IF NOT EXISTS code_qualite text REFERENCES qualite(code_qualite);
ALTER TABLE machine_fiche          ADD COLUMN IF NOT EXISTS code_qualite text REFERENCES qualite(code_qualite);
ALTER TABLE machine_fiche_ligne    ADD COLUMN IF NOT EXISTS code_qualite text REFERENCES qualite(code_qualite);
ALTER TABLE machine_etat           ADD COLUMN IF NOT EXISTS code_qualite text REFERENCES qualite(code_qualite);
ALTER TABLE machine_decision_etat  ADD COLUMN IF NOT EXISTS code_qualite text REFERENCES qualite(code_qualite);
ALTER TABLE machine_decision_ligne ADD COLUMN IF NOT EXISTS code_qualite text REFERENCES qualite(code_qualite);
ALTER TABLE machine_decision_ligne ADD COLUMN IF NOT EXISTS code_qualite_periode text REFERENCES qualite(code_qualite);

CREATE INDEX IF NOT EXISTS ix_fk_mouvement_qualite ON mouvement (code_qualite);
CREATE INDEX IF NOT EXISTS ix_fk_machine_fiche_qualite ON machine_fiche (code_qualite);
CREATE INDEX IF NOT EXISTS ix_fk_machine_fiche_ligne_qualite ON machine_fiche_ligne (code_qualite);
CREATE INDEX IF NOT EXISTS ix_fk_machine_etat_qualite ON machine_etat (code_qualite);
CREATE INDEX IF NOT EXISTS ix_fk_machine_decision_etat_qualite ON machine_decision_etat (code_qualite);
CREATE INDEX IF NOT EXISTS ix_fk_machine_decision_ligne_qualite ON machine_decision_ligne (code_qualite);
CREATE INDEX IF NOT EXISTS ix_fk_machine_decision_ligne_qualite_periode ON machine_decision_ligne (code_qualite_periode);

-- L'état courant qui sert un OF prend sa qualité (l'état n'est pas une archive).
UPDATE machine_etat e SET code_qualite = o.code_qualite
  FROM ordre_fabrication o
 WHERE o.id_of = e.id_of AND e.code_qualite IS NULL;

-- -----------------------------------------------------------------------------
-- 2. La consommation directe et son retour : la qualité, avec ou sans OF
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_mouvement_qualite() RETURNS trigger AS $$
DECLARE
    v_q      text;
    v_numero text;
BEGIN
    IF NEW.code_type_mvt IN ('CONSO_DIRECTE', 'RETOUR_CONSO') AND NEW.id_mouvement_contrepasse IS NULL THEN
        IF NEW.id_of IS NOT NULL THEN
            SELECT code_qualite, numero INTO v_q, v_numero FROM ordre_fabrication WHERE id_of = NEW.id_of;
            IF NEW.code_qualite IS NULL THEN
                NEW.code_qualite := v_q;
            ELSIF NEW.code_qualite IS DISTINCT FROM v_q THEN
                RAISE EXCEPTION 'QUALITE-OF : la qualité % ne correspond pas à l''OF %, qui produit la qualité %.',
                    NEW.code_qualite, v_numero, v_q USING ERRCODE = 'check_violation';
            END IF;
        ELSIF NEW.code_qualite IS NULL THEN
            RAISE EXCEPTION 'QUALITE-OBLIGATOIRE : une consommation directe ou son retour sans OF nomme la qualité qu''elle sert.'
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW.code_qualite IS NOT NULL THEN
        RAISE EXCEPTION 'QUALITE : seule une consommation directe ou son retour porte une qualité (%).', NEW.code_type_mvt
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_mouvement_qualite() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_mouvement_qualite ON mouvement;
CREATE TRIGGER trg_mouvement_qualite
BEFORE INSERT ON mouvement FOR EACH ROW
EXECUTE FUNCTION fn_trg_mouvement_qualite();

-- Ce que cette qualité a sorti SANS OF de cette référence et pas encore rendu.
CREATE OR REPLACE FUNCTION fn_qualite_conso_directe_reste(p_qualite text, p_reference text, p_sauf_mouvement text DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE(sum(CASE m.code_type_mvt WHEN 'CONSO_DIRECTE' THEN lm.quantite_kg
                                             ELSE -lm.quantite_kg END), 0)
      FROM ligne_mouvement lm
      JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
     WHERE m.id_of IS NULL
       AND m.code_qualite = p_qualite
       AND lm.code_reference = p_reference
       AND m.code_type_mvt IN ('CONSO_DIRECTE', 'RETOUR_CONSO')
       AND m.id_mouvement IS DISTINCT FROM p_sauf_mouvement
       AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
$$;
ALTER FUNCTION fn_qualite_conso_directe_reste(text, text, text) OWNER TO gestionfil;

-- Le retour : nomme l'OF, ou à défaut la qualité ; jamais plus que ce qui a été sorti.
CREATE OR REPLACE FUNCTION fn_trg_lmvt_retour_conso() RETURNS trigger AS $$
DECLARE
    v_type    text;
    v_of      text;
    v_qualite text;
    v_numero  text;
    v_mode    text;
    v_reste   numeric;
BEGIN
    SELECT m.code_type_mvt, m.id_of, m.code_qualite INTO v_type, v_of, v_qualite
      FROM mouvement m WHERE m.id_mouvement = NEW.id_mouvement;
    IF v_type IS DISTINCT FROM 'RETOUR_CONSO' THEN
        RETURN NEW;
    END IF;
    SELECT mode_consommation INTO v_mode FROM reference WHERE code_reference = NEW.code_reference;
    IF COALESCE(v_mode, 'MACHINE') <> 'DIRECTE' THEN
        RAISE EXCEPTION 'RETOUR-CONSO : % est en mode de consommation MACHINE : le fil revient par le dechargement d''une fiche machine.', NEW.code_reference
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_of IS NOT NULL THEN
        -- Deux retours simultanes du meme OF et de la meme reference : le second attend le premier.
        PERFORM pg_advisory_xact_lock(hashtext('retour_conso|' || v_of || '|' || NEW.code_reference));
        v_reste := fn_of_conso_directe_reste(v_of, NEW.code_reference);
        IF NEW.quantite_kg > v_reste + 0.0001 THEN
            SELECT numero INTO v_numero FROM ordre_fabrication WHERE id_of = v_of;
            RAISE EXCEPTION 'RETOUR-CONSO : % kg de % rendus pour l''OF %, qui n''en a sorti que % kg non encore rendus. Un surplus n''est pas un retour : c''est un ajustement d''inventaire.',
                round(NEW.quantite_kg, 4), NEW.code_reference, COALESCE(v_numero, v_of), round(greatest(v_reste, 0), 4)
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_qualite IS NOT NULL THEN
        -- SANS OF (23/10/2026) : la qualite tient le role de l'OF.
        PERFORM pg_advisory_xact_lock(hashtext('retour_conso|Q|' || v_qualite || '|' || NEW.code_reference));
        v_reste := fn_qualite_conso_directe_reste(v_qualite, NEW.code_reference);
        IF NEW.quantite_kg > v_reste + 0.0001 THEN
            RAISE EXCEPTION 'RETOUR-CONSO : % kg de % rendus pour la qualite % sans OF, qui n''en a sorti sans OF que % kg non encore rendus. Un surplus n''est pas un retour : c''est un ajustement d''inventaire.',
                round(NEW.quantite_kg, 4), NEW.code_reference, v_qualite, round(greatest(v_reste, 0), 4)
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        RAISE EXCEPTION 'RETOUR-CONSO : un retour de consommation directe nomme l''OF, ou a defaut la qualite, qui avait sorti la matiere.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_retour_conso() OWNER TO gestionfil;

-- Contre-passer une sortie dont une partie est deja rendue : d'abord le retour.
CREATE OR REPLACE FUNCTION fn_trg_mouvement_conso_rendue() RETURNS trigger AS $$
DECLARE
    v_type    text;
    v_of      text;
    v_qualite text;
    v_ligne   record;
BEGIN
    IF NEW.id_mouvement_contrepasse IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT code_type_mvt, id_of, code_qualite INTO v_type, v_of, v_qualite
      FROM mouvement WHERE id_mouvement = NEW.id_mouvement_contrepasse;
    IF v_type IS DISTINCT FROM 'CONSO_DIRECTE' OR (v_of IS NULL AND v_qualite IS NULL) THEN
        RETURN NEW;
    END IF;
    FOR v_ligne IN
        SELECT DISTINCT code_reference FROM ligne_mouvement WHERE id_mouvement = NEW.id_mouvement_contrepasse
    LOOP
        IF v_of IS NOT NULL THEN
            PERFORM pg_advisory_xact_lock(hashtext('retour_conso|' || v_of || '|' || v_ligne.code_reference));
            IF fn_of_conso_directe_reste(v_of, v_ligne.code_reference, NEW.id_mouvement_contrepasse) < -0.0001 THEN
                RAISE EXCEPTION 'RETOUR-CONSO : l''OF a deja rendu au magasin une partie de % sortie par ce mouvement : contre-passez d''abord le retour.', v_ligne.code_reference
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSE
            PERFORM pg_advisory_xact_lock(hashtext('retour_conso|Q|' || v_qualite || '|' || v_ligne.code_reference));
            IF fn_qualite_conso_directe_reste(v_qualite, v_ligne.code_reference, NEW.id_mouvement_contrepasse) < -0.0001 THEN
                RAISE EXCEPTION 'RETOUR-CONSO : la qualite % a deja rendu au magasin une partie de % sortie sans OF : contre-passez d''abord le retour.', v_qualite, v_ligne.code_reference
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_mouvement_conso_rendue() OWNER TO gestionfil;

-- -----------------------------------------------------------------------------
-- 3. La machine : la qualité cohérente avec l'OF, obligatoire au chargement
-- -----------------------------------------------------------------------------
-- Une ligne d'état (courant ou archivé) qui sert un OF sert la qualité de l'OF.
CREATE OR REPLACE FUNCTION fn_trg_machine_qualite_of() RETURNS trigger AS $$
DECLARE
    v_q      text;
    v_numero text;
BEGIN
    IF NEW.id_of IS NOT NULL THEN
        SELECT code_qualite, numero INTO v_q, v_numero FROM ordre_fabrication WHERE id_of = NEW.id_of;
        IF NEW.code_qualite IS NULL THEN
            NEW.code_qualite := v_q;
        ELSIF NEW.code_qualite IS DISTINCT FROM v_q THEN
            RAISE EXCEPTION 'QUALITE-OF : % (lot %) : la qualité % ne correspond pas à l''OF %, qui produit la qualité %.',
                NEW.code_reference, NEW.lot_fournisseur, NEW.code_qualite, v_numero, v_q
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_machine_qualite_of() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_machine_etat_qualite ON machine_etat;
CREATE TRIGGER trg_machine_etat_qualite
BEFORE INSERT OR UPDATE OF id_of, code_qualite ON machine_etat FOR EACH ROW
EXECUTE FUNCTION fn_trg_machine_qualite_of();
DROP TRIGGER IF EXISTS trg_machine_decision_etat_qualite ON machine_decision_etat;
CREATE TRIGGER trg_machine_decision_etat_qualite
BEFORE INSERT ON machine_decision_etat FOR EACH ROW
EXECUTE FUNCTION fn_trg_machine_qualite_of();

-- La ligne de décision : la qualité nouvelle (celle de l'OF nouveau) et la qualité
-- de la période (celle de l'OF de la période) ; au chargement, la qualité est due.
CREATE OR REPLACE FUNCTION fn_trg_mdl_qualite() RETURNS trigger AS $$
DECLARE
    v_q      text;
    v_numero text;
    v_nature text;
BEGIN
    IF NEW.id_of IS NOT NULL THEN
        SELECT code_qualite, numero INTO v_q, v_numero FROM ordre_fabrication WHERE id_of = NEW.id_of;
        IF NEW.code_qualite IS NULL THEN
            NEW.code_qualite := v_q;
        ELSIF NEW.code_qualite IS DISTINCT FROM v_q THEN
            RAISE EXCEPTION 'QUALITE-OF : % (lot %) : la qualité % ne correspond pas à l''OF %, qui produit la qualité %.',
                NEW.code_reference, NEW.lot_fournisseur, NEW.code_qualite, v_numero, v_q
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF NEW.id_of_periode IS NOT NULL THEN
        SELECT code_qualite, numero INTO v_q, v_numero FROM ordre_fabrication WHERE id_of = NEW.id_of_periode;
        IF NEW.code_qualite_periode IS NULL THEN
            NEW.code_qualite_periode := v_q;
        ELSIF NEW.code_qualite_periode IS DISTINCT FROM v_q THEN
            RAISE EXCEPTION 'QUALITE-OF : % (lot %) : la qualité de la période % ne correspond pas à l''OF de la période %, qui produit la qualité %.',
                NEW.code_reference, NEW.lot_fournisseur, NEW.code_qualite_periode, v_numero, v_q
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    SELECT nature INTO v_nature FROM machine_decision WHERE id_decision = NEW.id_decision;
    IF v_nature = 'CHARGE' AND NEW.code_qualite IS NULL THEN
        RAISE EXCEPTION 'QUALITE-OBLIGATOIRE : % (lot %) : un chargement nomme la qualité qu''il sert (celle de l''OF, ou choisie sans OF).',
            NEW.code_reference, NEW.lot_fournisseur USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_mdl_qualite() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_machine_decision_ligne_qualite ON machine_decision_ligne;
CREATE TRIGGER trg_machine_decision_ligne_qualite
BEFORE INSERT ON machine_decision_ligne FOR EACH ROW
EXECUTE FUNCTION fn_trg_mdl_qualite();

-- -----------------------------------------------------------------------------
-- 4. Les statistiques par qualité : OF + sans OF avec qualité + non attribué
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_qualite_consommation AS
WITH
-- LA PART DES OF, telle qu'en 2026-10-22b : par qualité et mois de l'OF.
of_part AS (
    SELECT b.code_qualite, to_char(b.date_of, 'YYYY-MM') AS mois,
           count(*)                                     AS nb_of,
           count(*) FILTER (WHERE b.statut = 'CLOTURE') AS nb_of_clotures,
           sum(b.metrage_m2)     AS metrage_m2,
           sum(b.kg_prevu)       AS kg_prevu,
           sum(b.kg_conso_fil)   AS kg_conso_fil,
           sum(b.kg_hors_machine) AS kg_hors_machine,
           sum(b.kg_reel)        AS kg_reel,
           sum(b.kg_dechet)      AS kg_dechet,
           sum(b.kg_perte)       AS kg_perte,
           sum(b.kg_casse)       AS kg_casse,
           sum(b.kg_autre_ecart) AS kg_autre_ecart
      FROM v_of_bilan b
     WHERE b.statut <> 'ANNULE'
     GROUP BY b.code_qualite, to_char(b.date_of, 'YYYY-MM')
),
-- LE FIL SANS OF : les écarts des décisions actives dont la période n'avait pas
-- d'OF, rangés sous la QUALITÉ DE LA PÉRIODE (vide : non attribué), au mois du
-- constat (la date de la fiche). Mêmes effets que la part des OF.
fil_sans_of AS (
    SELECT l.code_qualite_periode AS code_qualite,
           to_char(COALESCE(f.date_fiche, (d.date_decision AT TIME ZONE 'Africa/Casablanca')::date), 'YYYY-MM') AS mois,
           COALESCE(sum(l.ecart_kg) FILTER (WHERE l.effet_ecart = 'CONSOMMATION'
                                              AND l.code_motif <> 'MJ_CORRECTION'), 0)   AS kg_conso_fil,
           COALESCE(sum(l.ecart_kg) FILTER (WHERE l.effet_ecart = 'DECHET'), 0)
             + COALESCE(sum(l.kg_mouvementes) FILTER (WHERE l.destination = 'DECHET'), 0) AS kg_dechet,
           COALESCE(sum(l.ecart_kg) FILTER (WHERE l.effet_ecart = 'PERTE'), 0)
             + COALESCE(sum(l.kg_mouvementes) FILTER (WHERE l.destination = 'PERTE'), 0)  AS kg_perte,
           COALESCE(sum(l.ecart_kg) FILTER (WHERE l.effet_ecart = 'CASSE'), 0)
             + COALESCE(sum(l.kg_mouvementes) FILTER (WHERE l.destination = 'CASSE'), 0)  AS kg_casse,
           COALESCE(sum(l.ecart_kg) FILTER (WHERE l.effet_ecart IN ('NON_QUALIFIE', 'REGULARISATION', 'ERREUR_SAISIE')
                                               OR (l.effet_ecart = 'CONSOMMATION' AND l.code_motif = 'MJ_CORRECTION')), 0)
                                                                                         AS kg_autre_ecart
      FROM machine_decision_ligne l
      JOIN machine_decision d ON d.id_decision = l.id_decision
      LEFT JOIN machine_fiche f ON f.id_fiche = d.id_fiche
     WHERE d.statut = 'ACTIVE'
       AND l.id_of_periode IS NULL
     GROUP BY 1, 2
),
-- LE HORS MACHINE SANS OF : sorti − rendu, sous la qualité du mouvement (vide :
-- non attribué), au mois du mouvement ; contre-passés exclus.
hm_sans_of AS (
    SELECT m.code_qualite, to_char(m.date_mouvement, 'YYYY-MM') AS mois,
           sum(CASE m.code_type_mvt WHEN 'CONSO_DIRECTE' THEN lm.quantite_kg ELSE -lm.quantite_kg END) AS kg_hors_machine
      FROM mouvement m
      JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
     WHERE m.code_type_mvt IN ('CONSO_DIRECTE', 'RETOUR_CONSO')
       AND m.id_of IS NULL
       AND m.id_mouvement_contrepasse IS NULL
       AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
     GROUP BY 1, 2
),
sans_of AS (
    SELECT code_qualite, mois,
           sum(kg_conso_fil) AS kg_conso_fil, sum(kg_hors_machine) AS kg_hors_machine,
           sum(kg_dechet) AS kg_dechet, sum(kg_perte) AS kg_perte, sum(kg_casse) AS kg_casse,
           sum(kg_autre_ecart) AS kg_autre_ecart
      FROM (SELECT code_qualite, mois, kg_conso_fil, 0::numeric AS kg_hors_machine, kg_dechet, kg_perte,
                   kg_casse, kg_autre_ecart FROM fil_sans_of
            UNION ALL
            SELECT code_qualite, mois, 0, kg_hors_machine, 0, 0, 0, 0 FROM hm_sans_of) u
     GROUP BY code_qualite, mois
    HAVING sum(abs(kg_conso_fil)) + sum(abs(kg_hors_machine)) + sum(abs(kg_dechet)) + sum(abs(kg_perte))
         + sum(abs(kg_casse)) + sum(abs(kg_autre_ecart)) > 0
),
cles AS (
    SELECT code_qualite, mois FROM of_part
    UNION SELECT code_qualite, mois FROM sans_of
)
SELECT k.code_qualite,
       CASE WHEN k.code_qualite IS NULL THEN 'Non attribué' ELSE q.nom END          AS qualite_nom,
       k.mois,
       COALESCE(o.nb_of, 0)                                                         AS nb_of,
       COALESCE(o.nb_of_clotures, 0)                                                AS nb_of_clotures,
       round(COALESCE(o.metrage_m2, 0), 2)                                          AS metrage_m2,
       round(COALESCE(o.kg_prevu, 0), 4)                                            AS kg_prevu,
       round(COALESCE(o.kg_conso_fil, 0) + COALESCE(s.kg_conso_fil, 0), 4)          AS kg_conso_fil,
       round(COALESCE(o.kg_hors_machine, 0) + COALESCE(s.kg_hors_machine, 0), 4)    AS kg_hors_machine,
       round(COALESCE(o.kg_reel, 0) + COALESCE(s.kg_conso_fil, 0) + COALESCE(s.kg_hors_machine, 0), 4) AS kg_reel,
       round(COALESCE(o.kg_dechet, 0) + COALESCE(s.kg_dechet, 0), 4)                AS kg_dechet,
       round(COALESCE(o.kg_perte, 0) + COALESCE(s.kg_perte, 0), 4)                  AS kg_perte,
       round(COALESCE(o.kg_casse, 0) + COALESCE(s.kg_casse, 0), 4)                  AS kg_casse,
       round(COALESCE(o.kg_autre_ecart, 0) + COALESCE(s.kg_autre_ecart, 0), 4)      AS kg_autre_ecart,
       -- L'écart réel − prévu ne compare que ce que les OF ont prévu à ce qu'ils ont consommé.
       round(o.kg_reel - o.kg_prevu, 4)                                             AS ecart_kg,
       CASE WHEN o.kg_prevu > 0 THEN round((o.kg_reel - o.kg_prevu) / o.kg_prevu * 100, 2) END AS ecart_pct,
       round(COALESCE(o.kg_reel, 0), 4)                                             AS kg_reel_of,
       round(COALESCE(s.kg_conso_fil, 0) + COALESCE(s.kg_hors_machine, 0), 4)       AS kg_reel_sans_of,
       k.code_qualite IS NOT NULL                                                   AS attribue
  FROM cles k
  LEFT JOIN qualite q ON q.code_qualite = k.code_qualite
  LEFT JOIN of_part o ON o.code_qualite IS NOT DISTINCT FROM k.code_qualite AND o.mois = k.mois
  LEFT JOIN sans_of s ON s.code_qualite IS NOT DISTINCT FROM k.code_qualite AND s.mois = k.mois;
ALTER VIEW v_qualite_consommation OWNER TO gestionfil;
COMMENT ON VIEW v_qualite_consommation IS
  'Par qualité et par mois : les OF (mois de l''OF, annulés exclus : nb, métrage, prévu, réel, écart réel − prévu) '
  '+ ce qui a été consommé SANS OF mais avec sa qualité (fil : écarts des décisions dont la période n''avait pas '
  'd''OF, sous la qualité de la période, au mois de la fiche ; hors machine : CONSO_DIRECTE − RETOUR_CONSO sans OF, '
  'au mois du mouvement). Sans qualité : « Non attribué » (code_qualite vide). 2026-10-22b, 2026-10-23b.';

-- -----------------------------------------------------------------------------
-- 5. C62 : la consommation directe sans OF NI qualité (l'historique)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ctl_c62 AS
SELECT m.numero_mouvement, m.date_mouvement, m.code_magasin, m.numero_of,
       round(sum(lm.quantite_kg), 4) AS quantite_kg
  FROM mouvement m
  JOIN ligne_mouvement lm ON lm.id_mouvement = m.id_mouvement
 WHERE m.code_type_mvt = 'CONSO_DIRECTE'
   AND m.id_of IS NULL
   AND m.code_qualite IS NULL
   AND NOT EXISTS (SELECT 1 FROM mouvement c WHERE c.id_mouvement_contrepasse = m.id_mouvement)
 GROUP BY m.id_mouvement, m.numero_mouvement, m.date_mouvement, m.code_magasin, m.numero_of;
ALTER VIEW v_ctl_c62 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('Consommation directe sans OF : non attribuee a une qualite' IN def) > 0 THEN
        def := replace(def, 'Consommation directe sans OF : non attribuee a une qualite',
                            'Consommation directe sans OF ni qualite (historique) : non attribuee');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || rtrim(rtrim(def), ';');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Les champs affichés, déclarés
-- -----------------------------------------------------------------------------
INSERT INTO champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) VALUES
 ('MOUVEMENTS', 'code_qualite',         'Qualité (consommation directe)',  'LECTURE', 0, 4180),
 ('MOUVEMENTS', 'qualite_nom',          'Nom de la qualité',               'LECTURE', 0, 4182),
 ('STOCK',      'code_qualite',         'Qualité (ligne machine)',         'LECTURE', 0, 4470),
 ('STOCK',      'qualite_nom',          'Nom de la qualité',               'LECTURE', 0, 4472),
 ('STOCK',      'code_qualite_periode', 'Qualité de la période mesurée',   'LECTURE', 0, 4474),
 ('STOCK',      'qualite_nom_periode',  'Nom de la qualité de la période', 'LECTURE', 0, 4476),
 ('PLANS',      'kg_reel_of',           'Réel des OF (kg)',                'LECTURE', 0, 348),
 ('PLANS',      'kg_reel_sans_of',      'Réel sans OF (kg)',               'LECTURE', 0, 350),
 ('PLANS',      'attribue',             'Attribué à une qualité',          'LECTURE', 0, 352)
ON CONFLICT (module, champ) DO UPDATE SET libelle = excluded.libelle, ordre = excluded.ordre;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'MOUVEMENTS', c.champ, m.niveau
  FROM modele_droit_champ m CROSS JOIN (VALUES ('code_qualite'), ('qualite_nom')) c(champ)
 WHERE m.module = 'MOUVEMENTS' AND m.champ = 'numero_of'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'MOUVEMENTS', c.champ, d.niveau
  FROM droit_champ d CROSS JOIN (VALUES ('code_qualite'), ('qualite_nom')) c(champ)
 WHERE d.module = 'MOUVEMENTS' AND d.champ = 'numero_of'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'STOCK', c.champ, m.niveau
  FROM modele_droit_champ m
 CROSS JOIN (VALUES ('code_qualite'), ('qualite_nom'), ('code_qualite_periode'), ('qualite_nom_periode')) c(champ)
 WHERE m.module = 'STOCK' AND m.champ = 'id_of'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'STOCK', c.champ, d.niveau
  FROM droit_champ d
 CROSS JOIN (VALUES ('code_qualite'), ('qualite_nom'), ('code_qualite_periode'), ('qualite_nom_periode')) c(champ)
 WHERE d.module = 'STOCK' AND d.champ = 'id_of'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

INSERT INTO modele_droit_champ (code_role_user, module, champ, niveau)
SELECT m.code_role_user, 'PLANS', c.champ, m.niveau
  FROM modele_droit_champ m CROSS JOIN (VALUES ('kg_reel_of'), ('kg_reel_sans_of'), ('attribue')) c(champ)
 WHERE m.module = 'PLANS' AND m.champ = 'm2_prevus'
ON CONFLICT (code_role_user, module, champ) DO NOTHING;
INSERT INTO droit_champ (id_utilisateur, module, champ, niveau)
SELECT d.id_utilisateur, 'PLANS', c.champ, d.niveau
  FROM droit_champ d CROSS JOIN (VALUES ('kg_reel_of'), ('kg_reel_sans_of'), ('attribue')) c(champ)
 WHERE d.module = 'PLANS' AND d.champ = 'm2_prevus'
ON CONFLICT (id_utilisateur, module, champ) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Témoin
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'mouvement' AND column_name = 'code_qualite')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'machine_decision_ligne' AND column_name = 'code_qualite_periode')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'machine_decision_etat' AND column_name = 'code_qualite')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mouvement_qualite')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_machine_decision_ligne_qualite')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_machine_etat_qualite')
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'v_qualite_consommation' AND column_name = 'kg_reel_sans_of')
       OR position('code_qualite' IN pg_get_viewdef('v_ctl_c62'::regclass)) = 0
       OR position('fn_qualite_conso_directe_reste' IN pg_get_functiondef('fn_trg_lmvt_retour_conso'::regproc)) = 0 THEN
        RAISE EXCEPTION '2026-10-23b : migration incomplete';
    END IF;
END $$;

COMMIT;
