-- =============================================================================
-- 2026-10-17e — Cloture de periode (A3)
-- =============================================================================
-- LE DEFAUT, CONSTATE PAR L'AUDIT DU 17/10. Dans gestionFil, « cloture »
-- designait toujours celle d'un DOCUMENT (reception, inventaire, qualite),
-- jamais celle d'un mois. Rien n'empechait de saisir un mouvement date de mars
-- apres que les comptes de mars avaient ete arretes.
--
-- LA CONCEPTION, reprise de gestion-mp-pro (`services/periode.py`) comme l'a
-- arrete le rapport de decision, mais garantie EN BASE (ADR-001 D-04) :
--
--   1. UN REGLAGE DE LA DIRECTION, `P_PeriodeCloseJusqua` : le dernier jour clos.
--      « 2000-01-01 » veut dire « rien de clos » — la valeur est obligatoire et
--      cette date precede toute donnee. Qui l'a change, quand et pourquoi :
--      `parametre_historique`, deja tenu par `trg_parametre_historiser`.
--   2. LE GRAND LIVRE REFUSE toute ecriture datee d'une periode close — en-tete
--      ET lignes, quel que soit le chemin : ecran, import, script.
--   3. LES BROUILLONS RESTES DANS LA PERIODE SE SIGNALENT (C55), ils ne bloquent
--      pas la cloture (« signaler plutot que bloquer », decision du 08/10). Un
--      brouillon de reception date d'un mois clos ne pourra plus etre valide a
--      sa date : il faut le voir avant de s'y heurter.
--
-- CE QUE LA CLOTURE NE FAIT PAS, ET POURQUOI. Elle ne fige aucun cout. Dans
-- gestionFil, chaque sortie porte deja son CMUP, fige a l'ecriture, et le grand
-- livre est immuable (R03) : le passe ne se recalcule pas. Une correction se
-- fait par contre-passation, datee du jour — donc hors de la periode close, et
-- acceptee. Une facture tardive ajuste le CMUP du stock PRESENT, pas les sorties
-- passees. La cloture n'a donc qu'un role : empecher qu'on ecrive DANS le passe.
--
-- LA DATE METIER EST CELLE DE CASABLANCA. Le grand livre melange des dates du
-- fait (« 2026-10-01 », 322 lignes au 17/10) et des horodatages UTC
-- (« 2026-10-01T23:30:00.000Z », 77). Une date seule est deja une date metier ;
-- un horodatage se convertit. Sans cela, un mouvement de 00 h 30 le 1er du mois
-- serait date de la veille en UTC et refuse a tort par la cloture du mois
-- precedent — et l'atelier tourne la nuit. Le fuseau suit la convention deja en
-- place (`decision_machine.rs`, `importation.rs`).
--
-- REJOUABLE : upsert du parametre (sans ecraser une valeur deja reglee),
-- CREATE OR REPLACE, declencheurs deposes puis recrees, C55 ajoute une fois.
-- =============================================================================

BEGIN;

-- ---- 1. La date metier d'une date du grand livre ----------------------------
-- STABLE et sans bloc EXCEPTION : elle s'execute a chaque ligne ecrite, et un
-- bloc EXCEPTION ouvrirait une sous-transaction par ligne. Un format inconnu
-- rend NULL : la cloture ne tranche pas ce qu'elle ne sait pas lire, d'autres
-- gardes (trg_mouvement_date_future) s'occupent des dates mal formees.
CREATE OR REPLACE FUNCTION fn_date_metier(p text) RETURNS date AS $$
BEGIN
    IF p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' THEN
        RETURN (p::timestamptz AT TIME ZONE 'Africa/Casablanca')::date;
    ELSIF p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
        RETURN substr(p, 1, 10)::date;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
ALTER FUNCTION fn_date_metier(text) OWNER TO gestionfil;

-- La limite courante : NULL si le reglage manque (base anterieure a cette
-- migration rechargee partiellement) — rien n'est alors refuse.
CREATE OR REPLACE FUNCTION fn_periode_close_jusqua() RETURNS date AS $$
    SELECT valeur_courante::date FROM parametre
     WHERE code_parametre = 'P_PeriodeCloseJusqua' AND actif = 1;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION fn_periode_close_jusqua() OWNER TO gestionfil;

-- ---- 2. Le reglage -----------------------------------------------------------
INSERT INTO parametre (code_parametre, libelle, valeur_courante, type_donnee,
                       unite, description, categorie, modifiable_par,
                       verrouille, date_derniere_modif, actif)
VALUES ('P_PeriodeCloseJusqua',
        'Période close jusqu''au',
        '2000-01-01',
        'DATE',
        NULL,
        'Dernier jour d''une période arrêtée : aucun mouvement de stock ne peut '
        'plus y être daté. 2000-01-01 = rien de clos. Se règle par la direction ; '
        'rouvrir (reculer la date) exige un motif. Les corrections se font par '
        'contre-passation, datée du jour.',
        'STOCK',
        'DIRECTION',
        0,
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        1)
ON CONFLICT (code_parametre) DO NOTHING;

-- ---- 3. Qui peut clore, et jusqu'ou -----------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_parametre_cloture() RETURNS trigger AS $$
DECLARE
    v_user    text := NULLIF(current_setting('gestionfil.id_utilisateur', true), '');
    v_role    text;
    v_nouvelle date := NEW.valeur_courante::date;   -- format deja controle par trg_00_parametre_type
    v_ancienne date := OLD.valeur_courante::date;
    v_aujourdhui date := (now() AT TIME ZONE 'Africa/Casablanca')::date;
BEGIN
    IF v_nouvelle = v_ancienne THEN
        RETURN NEW;
    END IF;

    -- LA DIRECTION, ET L'ADMINISTRATEUR. Sans contexte applicatif (migration,
    -- script d'administration en psql), la garde s'efface : c'est la convention
    -- des autres gardes par role (fn_trg_inventaire_separation).
    IF v_user IS NOT NULL THEN
        SELECT code_role_user INTO v_role FROM utilisateur WHERE id_utilisateur = v_user;
        IF v_role IS NULL OR v_role NOT IN ('DIRECTION', 'ADMIN') THEN
            RAISE EXCEPTION 'PERIODE : clore ou rouvrir une période revient à la direction.';
        END IF;
    END IF;

    -- ON NE CLOT PAS LE JOUR MEME. Clore aujourd'hui refuserait les mouvements
    -- de la journee en cours ; clore demain, ceux de demain sans raison.
    IF v_nouvelle >= v_aujourdhui THEN
        RAISE EXCEPTION 'PERIODE : on ne clôt que des jours passés ; le % n''est pas encore terminé.',
            to_char(v_nouvelle, 'DD/MM/YYYY');
    END IF;

    -- ROUVRIR EST L'EXCEPTION, ET SE JUSTIFIE. Reculer la date redonne acces a
    -- des mois arretes : le motif reste dans parametre_historique.
    IF v_nouvelle < v_ancienne AND length(btrim(COALESCE(NEW.motif_modif, ''))) < 3 THEN
        RAISE EXCEPTION 'PERIODE : rouvrir la période close jusqu''au % exige un motif.',
            to_char(v_ancienne, 'DD/MM/YYYY');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_parametre_cloture() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_parametre_cloture ON parametre;
CREATE TRIGGER trg_parametre_cloture
    BEFORE UPDATE OF valeur_courante ON parametre
    FOR EACH ROW
    WHEN (NEW.code_parametre = 'P_PeriodeCloseJusqua')
    EXECUTE FUNCTION fn_trg_parametre_cloture();

-- ---- 4. Le grand livre refuse d'ecrire dans le passe clos -------------------
CREATE OR REPLACE FUNCTION fn_trg_mouvement_periode_close() RETURNS trigger AS $$
DECLARE
    v_limite date := fn_periode_close_jusqua();
    v_jour   date := fn_date_metier(NEW.date_mouvement);
BEGIN
    IF v_limite IS NOT NULL AND v_jour IS NOT NULL AND v_jour <= v_limite THEN
        RAISE EXCEPTION 'PERIODE-CLOSE : la période jusqu''au % est close, rien ne s''y écrit plus (mouvement du %). Datez-le après la clôture, ou demandez à la direction de rouvrir la période.',
            to_char(v_limite, 'DD/MM/YYYY'), to_char(v_jour, 'DD/MM/YYYY');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_mouvement_periode_close() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_mouvement_periode_close ON mouvement;
CREATE TRIGGER trg_mouvement_periode_close
    BEFORE INSERT ON mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_mouvement_periode_close();

-- LES LIGNES AUSSI. `ligne_mouvement` est immuable en modification et en
-- suppression (R03), mais une INSERTION sur un en-tete ancien reste possible :
-- sans cette garde, on pourrait faire entrer du stock dans un mois clos en
-- greffant une ligne a un mouvement de mars. La garantie vaut quel que soit le
-- chemin, pas seulement celui des ecrans.
CREATE OR REPLACE FUNCTION fn_trg_lmvt_periode_close() RETURNS trigger AS $$
DECLARE
    v_limite date := fn_periode_close_jusqua();
    v_jour   date;
BEGIN
    IF v_limite IS NULL OR v_limite <= DATE '2000-01-01' THEN
        RETURN NEW;    -- rien de clos : pas de lecture d'en-tete a chaque ligne
    END IF;
    SELECT fn_date_metier(m.date_mouvement) INTO v_jour
      FROM mouvement m WHERE m.id_mouvement = NEW.id_mouvement;
    IF v_jour IS NOT NULL AND v_jour <= v_limite THEN
        RAISE EXCEPTION 'PERIODE-CLOSE : la période jusqu''au % est close ; on n''ajoute pas de ligne à un mouvement du %.',
            to_char(v_limite, 'DD/MM/YYYY'), to_char(v_jour, 'DD/MM/YYYY');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION fn_trg_lmvt_periode_close() OWNER TO gestionfil;

DROP TRIGGER IF EXISTS trg_lmvt_periode_close ON ligne_mouvement;
CREATE TRIGGER trg_lmvt_periode_close
    BEFORE INSERT ON ligne_mouvement
    FOR EACH ROW EXECUTE FUNCTION fn_trg_lmvt_periode_close();

-- ---- 5. C55 : les brouillons restes dans une periode close (SIGNAL) ---------
-- Seuls comptent les documents qui produiront un mouvement a leur date : une
-- reception pas encore validee, un inventaire pas encore cloture, un transfert
-- pas encore expedie. Un bon de commande n'ecrit jamais au grand livre.
CREATE OR REPLACE VIEW v_ctl_c55 AS
SELECT 'reception'::text AS document, r.numero_reception AS numero, r.statut,
       fn_date_metier(r.date_reception) AS date_document
  FROM reception r
 WHERE r.statut IN ('BROUILLON', 'A_CONTROLER')
   AND fn_date_metier(r.date_reception) <= fn_periode_close_jusqua()
UNION ALL
SELECT 'inventaire', i.numero_inventaire, i.statut, fn_date_metier(i.date_inventaire)
  FROM inventaire i
 WHERE i.statut IN ('BROUILLON', 'VALIDE')
   AND fn_date_metier(i.date_inventaire) <= fn_periode_close_jusqua()
UNION ALL
SELECT 'transfert', t.numero_transfert, t.statut, fn_date_metier(t.date_transfert)
  FROM transfert t
 WHERE t.statut = 'BROUILLON'
   AND fn_date_metier(t.date_transfert) <= fn_periode_close_jusqua();
ALTER VIEW v_ctl_c55 OWNER TO gestionfil;

DO $$
DECLARE
    def text;
BEGIN
    def := pg_get_viewdef('v_controles'::regclass);
    IF position('C55' IN def) = 0 THEN
        def := rtrim(rtrim(def), ';');
        EXECUTE 'CREATE OR REPLACE VIEW v_controles AS ' || def ||
                ' UNION ALL SELECT ''C55''::text, ''Document non validé daté d''''une période close''::text,'
                ' ''ATTENTION''::text, (SELECT count(*) FROM v_ctl_c55)';
    END IF;
END $$;

-- ---- 6. Temoin ---------------------------------------------------------------
DO $$
DECLARE
    v_ok boolean;
BEGIN
    v_ok := EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_PeriodeCloseJusqua')
        AND (SELECT count(*) FROM pg_trigger
              WHERE tgname IN ('trg_parametre_cloture', 'trg_mouvement_periode_close',
                               'trg_lmvt_periode_close') AND NOT tgisinternal) = 3
        AND position('C55' IN pg_get_viewdef('v_controles'::regclass)) > 0;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'Cloture de periode incomplete : reglage, declencheurs ou C55 manquant.';
    END IF;
    RAISE NOTICE '2026-10-17e : cloture de periode en place — close jusqu''au %.',
        to_char(fn_periode_close_jusqua(), 'DD/MM/YYYY');
END $$;

COMMIT;
