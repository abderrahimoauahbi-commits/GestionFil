-- SOCLE genere par db/pg/socle.py depuis une copie entierement migree.
-- Ne pas editer a la main : regenerer (python socle.py --depuis <copie>).
-- Migrations comprises : 103 (voir inclus.txt).

--
-- PostgreSQL database dump
--

\restrict yEItOgJQZvxbnD5W9B3G5XS1DKNI9c2sY9ZZom3LhFU2KAP60D6mFKdhVu12nsi

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: f_machine_consommation(text, text, text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.f_machine_consommation(p_machine text DEFAULT NULL::text, p_debut text DEFAULT NULL::text, p_fin text DEFAULT NULL::text) RETURNS TABLE(code_machine text, machine_nom text, code_emplacement text, zone text, code_reference text, designation text, lot_fournisseur text, date_debut text, kg_debut numeric, kg_charge numeric, kg_retourne numeric, kg_sorti_autre numeric, date_fin text, kg_fin numeric, consommation_kg numeric, dechet_perte_casse_kg numeric, non_qualifie_kg numeric, regularisation_kg numeric, erreur_saisie_kg numeric)
    LANGUAGE sql STABLE
    AS $$
    WITH periode AS (
        SELECT e.*, l.nb_mouvementees
          FROM v_machine_ecart e
          JOIN machine_decision_ligne l ON l.id_decision = e.id_decision
                                       AND l.ligne_numero = e.ligne_numero
          LEFT JOIN machine_fiche fi ON fi.id_fiche = e.id_fiche
         WHERE e.nature <> 'DEPART'
           AND (p_machine IS NULL OR e.code_machine = p_machine)
           -- La date du FAIT (la fiche), a defaut celle de la validation.
           AND (p_debut   IS NULL OR substr(COALESCE(fi.date_fiche, e.date_decision), 1, 10) >= substr(p_debut, 1, 10))
           AND (p_fin     IS NULL OR substr(COALESCE(fi.date_fiche, e.date_decision), 1, 10) <= substr(p_fin, 1, 10))
    ),
    bornes AS (
        SELECT DISTINCT ON (p.code_emplacement, p.code_reference, p.lot_fournisseur)
               p.code_emplacement, p.code_reference, p.lot_fournisseur,
               p.date_decision AS date_debut, p.kg_avant AS kg_debut
          FROM periode p
         ORDER BY p.code_emplacement, p.code_reference, p.lot_fournisseur, p.date_decision
    ),
    fins AS (
        SELECT DISTINCT ON (p.code_emplacement, p.code_reference, p.lot_fournisseur)
               p.code_emplacement, p.code_reference, p.lot_fournisseur,
               p.date_decision AS date_fin, p.kg_apres AS kg_fin
          FROM periode p
         ORDER BY p.code_emplacement, p.code_reference, p.lot_fournisseur, p.date_decision DESC
    )
    SELECT p.code_machine, m.nom, p.code_emplacement, p.zone, p.code_reference, p.designation,
           p.lot_fournisseur, b.date_debut, ROUND(b.kg_debut, 3),
           ROUND(SUM(CASE WHEN p.nature = 'CHARGE' THEN p.kg_mouvementes ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.nature = 'DECHARGE' AND p.destination = 'MAGASIN'
                          THEN p.kg_mouvementes ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.nature = 'DECHARGE' AND p.destination <> 'MAGASIN'
                          THEN p.kg_mouvementes ELSE 0 END), 3),
           fn.date_fin, ROUND(fn.kg_fin, 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'CONSOMMATION' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart IN ('DECHET', 'PERTE', 'CASSE') THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'NON_QUALIFIE' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'REGULARISATION' THEN p.ecart_kg ELSE 0 END), 3),
           ROUND(SUM(CASE WHEN p.effet_ecart = 'ERREUR_SAISIE' THEN p.ecart_kg ELSE 0 END), 3)
      FROM periode p
      JOIN machine m ON m.code_machine = p.code_machine
      JOIN bornes b  ON b.code_emplacement = p.code_emplacement
                    AND b.code_reference = p.code_reference AND b.lot_fournisseur = p.lot_fournisseur
      JOIN fins fn   ON fn.code_emplacement = p.code_emplacement
                    AND fn.code_reference = p.code_reference AND fn.lot_fournisseur = p.lot_fournisseur
     GROUP BY p.code_machine, m.nom, p.code_emplacement, p.zone, p.code_reference, p.designation,
              p.lot_fournisseur, b.date_debut, b.kg_debut, fn.date_fin, fn.kg_fin
$$;


ALTER FUNCTION public.f_machine_consommation(p_machine text, p_debut text, p_fin text) OWNER TO gestionfil;

--
-- Name: fn_besoins_perimes(text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_besoins_perimes(p_plan text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    SELECT NOT EXISTS (SELECT 1 FROM besoin_mrp b WHERE b.id_plan = p_plan)
        -- Le fond du controle : les kilos enregistres et ceux que les recettes
        -- donneraient maintenant. La tolerance est celle de l'arrondi au gramme.
        OR EXISTS (
            SELECT 1 FROM (
                SELECT code_reference, annee_mois, SUM(quantite_kg) AS kg
                  FROM besoin_mrp WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois
                EXCEPT
                SELECT code_reference, annee_mois, SUM(quantite_kg)
                  FROM v_besoin_mrp_calcule WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois) x)
        OR EXISTS (
            SELECT 1 FROM (
                SELECT code_reference, annee_mois, SUM(quantite_kg) AS kg
                  FROM v_besoin_mrp_calcule WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois
                EXCEPT
                SELECT code_reference, annee_mois, SUM(quantite_kg)
                  FROM besoin_mrp WHERE id_plan = p_plan
                 GROUP BY code_reference, annee_mois) y)
$$;


ALTER FUNCTION public.fn_besoins_perimes(p_plan text) OWNER TO gestionfil;

--
-- Name: fn_cmup_annuler_entree(text, text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_cmup_annuler_entree(p_reference text, p_magasin text, p_kg numeric, p_prix numeric) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_q     numeric;
    v_c     numeric;
    v_neuf  numeric;
    v_fiche numeric;
    v_quand text := to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    SELECT quantite_kg, cmup_mad INTO v_q, v_c
      FROM stock_magasin
     WHERE code_reference = p_reference AND code_magasin = p_magasin
       FOR UPDATE;
    IF v_c IS NULL OR p_prix IS NULL OR p_kg IS NULL OR v_q IS NULL OR v_q <= 0.0001 THEN
        RETURN v_c;
    END IF;
    v_neuf := round((v_q * v_c + p_kg * v_c - p_kg * p_prix) / v_q, 4);
    IF v_neuf <= 0 THEN
        RETURN v_c;
    END IF;
    UPDATE stock_magasin
       SET cmup_mad = v_neuf, date_maj = v_quand
     WHERE code_reference = p_reference AND code_magasin = p_magasin;
    -- La fiche article suit, comme a chaque entree : moyenne des magasins.
    SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / NULLIF(SUM(sm.quantite_kg), 0), 4)
      INTO v_fiche
      FROM stock_magasin sm
     WHERE sm.code_reference = p_reference AND sm.quantite_kg > 0 AND sm.cmup_mad IS NOT NULL;
    IF v_fiche IS NOT NULL THEN
        UPDATE reference SET cmup_mad = v_fiche, date_dernier_cmup = v_quand
         WHERE code_reference = p_reference AND cmup_mad IS DISTINCT FROM v_fiche;
    END IF;
    RETURN v_neuf;
END $$;


ALTER FUNCTION public.fn_cmup_annuler_entree(p_reference text, p_magasin text, p_kg numeric, p_prix numeric) OWNER TO gestionfil;

--
-- Name: FUNCTION fn_cmup_annuler_entree(p_reference text, p_magasin text, p_kg numeric, p_prix numeric); Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON FUNCTION public.fn_cmup_annuler_entree(p_reference text, p_magasin text, p_kg numeric, p_prix numeric) IS 'Retire la valeur d''une entree annulee a son prix d''origine, dans son seul magasin (05/10/2026).';


--
-- Name: fn_cmup_suivre_catalogue(text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_cmup_suivre_catalogue(p_reference text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_prix       numeric;
    v_maintenant text := to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    -- UN ACHAT L'A FIXE : on ne touche a rien. Le CMUP est alors une moyenne
    -- ponderee d'entrees valorisees, et le tarif du fournisseur n'a pas a la
    -- reecrire — c'est toute la difference entre un prix et un cout.
    --
    -- LE SOCLE D'OUVERTURE EST EXCLU, et c'est le point de cette migration. Il
    -- porte un prix depuis 2026-09-18i, mais ce prix EST le prix catalogue :
    -- s'en servir pour figer le CMUP reviendrait a dire qu'un achat a eu lieu
    -- parce qu'on a chiffre un inventaire de depart. Le stock initial ne
    -- s'achete pas, il se constate.
    IF EXISTS (SELECT 1 FROM ligne_mouvement lm
                 JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
                WHERE lm.code_reference = p_reference
                  AND lm.prix_kg_mad IS NOT NULL
                  AND m.code_type_mvt <> 'STOCK_INIT') THEN
        RETURN;
    END IF;

    v_prix := fn_prix_catalogue_mad(p_reference);

    UPDATE stock_magasin
       SET cmup_mad = v_prix, date_maj = v_maintenant
     WHERE code_reference = p_reference
       AND cmup_mad IS DISTINCT FROM v_prix;

    UPDATE reference
       SET cmup_mad = v_prix, date_dernier_cmup = CASE WHEN v_prix IS NULL THEN NULL ELSE v_maintenant END
     WHERE code_reference = p_reference
       AND cmup_mad IS DISTINCT FROM v_prix;
END;
$$;


ALTER FUNCTION public.fn_cmup_suivre_catalogue(p_reference text) OWNER TO gestionfil;

--
-- Name: fn_controle_colisage(text, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_controle_colisage(p_ref text, p_kg numeric, p_bob numeric, p_pal numeric) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_pb    numeric;
    v_bpp   numeric;
    v_tol   numeric;
    v_beff  numeric;
    v_ecart numeric;
    v_pmin  numeric;
BEGIN
    IF p_ref IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT NULLIF(poids_bobine_kg, 0), NULLIF(bobines_par_palette, 0) INTO v_pb, v_bpp
      FROM reference WHERE code_reference = p_ref;
    v_tol := COALESCE((SELECT CAST(valeur_courante AS numeric) FROM parametre
                        WHERE code_parametre = 'P_ColisageTolRefusPct'), 25);

    IF COALESCE(p_bob, 0) > 0 AND v_pb IS NOT NULL AND COALESCE(p_kg, 0) > 0 THEN
        v_ecart := (p_kg / p_bob - v_pb) / v_pb * 100;
        IF abs(v_ecart) > v_tol THEN
            RETURN format('%s : %s kg pour %s bobines, soit %s kg par bobine, alors que la fiche en annonce %s (ecart %s %%, refus au-dela de %s %%). Verifiez les kilos et les bobines ; si le fournisseur a change de bobine, corrigez d''abord la fiche article.',
                          p_ref, round(p_kg, 2), round(p_bob), round(p_kg / p_bob, 3), round(v_pb, 3),
                          round(v_ecart, 1), round(v_tol));
        END IF;
    END IF;

    v_beff := COALESCE(NULLIF(p_bob, 0), CASE WHEN v_pb IS NOT NULL THEN p_kg / v_pb END);
    IF COALESCE(p_pal, 0) > 0 AND v_bpp IS NOT NULL AND COALESCE(v_beff, 0) > 0 THEN
        v_pmin := ceil(v_beff / v_bpp - 0.000001);
        IF p_pal > v_pmin + 1 THEN
            RETURN format('%s : %s palettes pour %s bobines. A %s bobines par palette, il en faut %s (%s au plus avec une palette entamee). Des colis ou des cartons ont-ils ete saisis comme palettes ?',
                          p_ref, round(p_pal), round(v_beff), round(v_bpp), v_pmin, v_pmin + 1);
        END IF;
        IF v_beff / p_pal > v_bpp * (1 + v_tol / 100.0) THEN
            RETURN format('%s : %s bobines sur %s palette(s), soit %s par palette, alors qu''une palette en porte %s. Il faut au moins %s palettes.',
                          p_ref, round(v_beff), round(p_pal), round(v_beff / p_pal), round(v_bpp), v_pmin);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_controle_colisage(p_ref text, p_kg numeric, p_bob numeric, p_pal numeric) OWNER TO gestionfil;

--
-- Name: fn_lot_au_seuil(text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_lot_au_seuil(p_reference text, p_kg numeric, p_bobines numeric) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM reference
                                  WHERE code_reference = p_reference AND suivi_lot = 1) THEN true
                WHEN s.bobines IS NOT NULL AND COALESCE(p_bobines, 0) > 0 THEN p_bobines >= s.bobines
                WHEN s.kg IS NOT NULL THEN COALESCE(p_kg, 0) >= s.kg
                ELSE COALESCE(p_kg, 0) >= (SELECT valeur_courante::numeric FROM parametre
                                            WHERE code_parametre = 'P_LotSeuilRestesKg') END
      FROM (SELECT 1) un LEFT JOIN fn_lot_seuil(p_reference) s ON true
$$;


ALTER FUNCTION public.fn_lot_au_seuil(p_reference text, p_kg numeric, p_bobines numeric) OWNER TO gestionfil;

--
-- Name: fn_lot_plancher(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_lot_plancher() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.quantite_kg < 0 THEN
        NEW.quantite_kg := 0;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_lot_plancher() OWNER TO gestionfil;

--
-- Name: fn_lot_seuil(text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_lot_seuil(p_reference text) RETURNS TABLE(valeur numeric, unite text, bobines numeric, kg numeric)
    LANGUAGE sql STABLE
    AS $$
    WITH r AS (
        SELECT seuil_lot_valeur AS v,
               CASE WHEN seuil_lot_valeur IS NOT NULL
                    THEN CASE WHEN NULLIF(poids_bobine_kg, 0) IS NOT NULL THEN 'Bobine' ELSE 'kg' END END AS u,
               NULLIF(poids_bobine_kg, 0)::numeric AS pb,
               NULLIF(bobines_par_palette, 0)::numeric AS bpp
          FROM reference WHERE code_reference = p_reference AND suivi_lot = 1
    ), p AS (
        SELECT max(CASE WHEN code_parametre = 'P_LotSeuilBobines' THEN valeur_courante::numeric END) AS bob,
               max(CASE WHEN code_parametre = 'P_LotSeuilRestesKg' THEN valeur_courante::numeric END) AS kg
          FROM parametre
    ), e AS (
        SELECT CASE WHEN r.v IS NOT NULL THEN r.v WHEN r.pb IS NOT NULL THEN p.bob ELSE p.kg END AS valeur,
               CASE WHEN r.v IS NOT NULL THEN r.u WHEN r.pb IS NOT NULL THEN 'Bobine' ELSE 'kg' END AS unite,
               r.pb, r.bpp
          FROM r CROSS JOIN p
    )
    SELECT e.valeur, e.unite,
           CASE e.unite WHEN 'Bobine' THEN e.valeur WHEN 'Palette' THEN e.valeur * e.bpp END,
           CASE e.unite WHEN 'kg' THEN e.valeur
                        WHEN 'Bobine' THEN round(e.valeur * e.pb, 2)
                        WHEN 'Palette' THEN round(e.valeur * e.bpp * e.pb, 2) END
      FROM e
$$;


ALTER FUNCTION public.fn_lot_seuil(p_reference text) OWNER TO gestionfil;

--
-- Name: fn_prix_catalogue_mad(text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_prix_catalogue_mad(p_reference text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
    SELECT round(r.prix_catalogue_kg * t.taux, 4)
      FROM reference r
      JOIN LATERAL (
            SELECT tc.taux FROM taux_change tc
             WHERE tc.code_devise = r.code_devise_catalogue
               AND to_char(current_date, 'YYYY-MM-DD') >= substr(tc.date_debut, 1, 10)
               AND (tc.date_fin IS NULL
                    OR to_char(current_date, 'YYYY-MM-DD') < substr(tc.date_fin, 1, 10))
             ORDER BY tc.date_debut DESC LIMIT 1) t ON true
     WHERE r.code_reference = p_reference
       AND r.prix_catalogue_kg > 0
$$;


ALTER FUNCTION public.fn_prix_catalogue_mad(p_reference text) OWNER TO gestionfil;

--
-- Name: fn_recalculer_cmup(text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_recalculer_cmup(p_reference text) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_kg    numeric;
    v_val   numeric;
    v_prix  numeric;
    v_quand text := to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    -- LA MOYENNE PONDEREE DES ENTREES QUI TIENNENT ENCORE. Sont exclues : les
    -- lignes d'un mouvement contre-passe, et les contre-passations elles-memes.
    -- Le socle d'ouverture (STOCK_INIT) en est aussi : son prix est une
    -- VALORISATION, pas un achat — c'est la regle posee le 2026-09-18i.
    SELECT COALESCE(SUM(lm.quantite_kg), 0),
           COALESCE(SUM(lm.quantite_kg * lm.prix_kg_mad), 0)
      INTO v_kg, v_val
      FROM ligne_mouvement lm
      JOIN mouvement m       ON m.id_mouvement = lm.id_mouvement
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE lm.code_reference = p_reference
       AND lm.prix_kg_mad IS NOT NULL
       AND tm.signe = 1
       AND m.code_type_mvt <> 'STOCK_INIT'
       AND m.id_mouvement_contrepasse IS NULL      -- ce n'est pas un inverse
       AND NOT EXISTS (SELECT 1 FROM mouvement x   -- et il n'a pas ete annule
                        WHERE x.id_mouvement_contrepasse = m.id_mouvement);

    IF v_kg > 0 THEN
        v_prix := ROUND(v_val / v_kg, 4);
    ELSE
        -- Plus aucun achat ne tient : on retombe sur le catalogue, exactement
        -- comme avant la premiere reception.
        v_prix := fn_prix_catalogue_mad(p_reference);
    END IF;

    UPDATE stock_magasin
       SET cmup_mad = v_prix, date_maj = v_quand
     WHERE code_reference = p_reference
       AND cmup_mad IS DISTINCT FROM v_prix;
    UPDATE reference
       SET cmup_mad = v_prix,
           date_dernier_cmup = CASE WHEN v_prix IS NULL THEN NULL ELSE v_quand END
     WHERE code_reference = p_reference
       AND cmup_mad IS DISTINCT FROM v_prix;
    RETURN v_prix;
END $$;


ALTER FUNCTION public.fn_recalculer_cmup(p_reference text) OWNER TO gestionfil;

--
-- Name: FUNCTION fn_recalculer_cmup(p_reference text); Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON FUNCTION public.fn_recalculer_cmup(p_reference text) IS 'Refait le CMUP depuis les entrees valorisees qui tiennent encore ; retombe sur le catalogue s''il n''en reste aucune.';


--
-- Name: fn_refuser(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_refuser() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION '%', TG_ARGV[0];
END;
$$;


ALTER FUNCTION public.fn_refuser() OWNER TO gestionfil;

--
-- Name: fn_retenants(text, text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_retenants(p_table text, p_valeur text) RETURNS TABLE(table_liee text, colonne text, nb bigint)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_oid  oid := p_table::regclass;
    v_pk   text;
    r      record;
    n      bigint;
BEGIN
    -- La colonne de cle primaire de la table visee. Sans elle, on ne saurait
    -- pas QUELLE colonne des tables liees comparer.
    SELECT a.attname INTO v_pk
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'p' AND c.conrelid = v_oid
       AND array_length(c.conkey, 1) = 1;
    IF v_pk IS NULL THEN
        RETURN;  -- cle composite : hors de portee de cette fonction
    END IF;

    FOR r IN
        -- Pour chaque cle etrangere pointant vers cette table, la colonne
        -- PORTEUSE en face de la colonne REFERENCEE : c'est l'appariement
        -- position par position de conkey et confkey qui le donne.
        SELECT c.conrelid::regclass::text AS t, ac.attname::text AS col
          FROM pg_constraint c
          CROSS JOIN LATERAL generate_subscripts(c.conkey, 1) AS i
          JOIN pg_attribute ac ON ac.attrelid = c.conrelid AND ac.attnum = c.conkey[i]
          JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[i]
         WHERE c.contype = 'f' AND c.confrelid = v_oid AND af.attname = v_pk
    LOOP
        EXECUTE format('SELECT count(*) FROM %s WHERE %I::text = $1', r.t, r.col)
           INTO n USING p_valeur;
        IF n > 0 THEN
            table_liee := r.t;
            colonne    := r.col;
            nb         := n;
            RETURN NEXT;
        END IF;
    END LOOP;
END $_$;


ALTER FUNCTION public.fn_retenants(p_table text, p_valeur text) OWNER TO gestionfil;

--
-- Name: FUNCTION fn_retenants(p_table text, p_valeur text); Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON FUNCTION public.fn_retenants(p_table text, p_valeur text) IS 'Ce qui empeche d''effacer une ligne : tables liees et nombre de lignes, lu dans le catalogue.';


--
-- Name: fn_suivi_conditionnement(text, text, text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_suivi_conditionnement(p_source text, p_id_document text, p_utilisateur text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    n integer;
BEGIN
    INSERT INTO historique_conditionnement
        (source, id_document, numero_document, code_reference, code_fournisseur, kg, nb_bobines, nb_palettes,
         poids_bobine_avant, poids_bobine_mesure, bobines_palette_avant, bobines_palette_observe,
         prix_kg_devise, code_devise, prix_kg_mad, poids_applique, colisage_applique, id_utilisateur)
    WITH recu AS (
        -- Reception locale : le prix au kilo est sur la ligne.
        SELECT lr.code_reference, rc.code_fournisseur, rc.numero_reception AS numero,
               sum(lr.quantite_stock_kg) AS kg, sum(lr.nb_bobines_saisi) AS bobines,
               sum(lr.nb_palettes_saisi) AS palettes,
               bool_and(lr.nb_palettes_saisi IS NULL OR lr.nb_palettes_saisi = trunc(lr.nb_palettes_saisi)) AS palettes_entieres,
               sum(lr.quantite_stock_kg * lr.prix_kg_devise) AS montant_devise, max(lr.code_devise) AS code_devise,
               sum(lr.quantite_stock_kg * lr.prix_kg_mad) AS montant_mad
          FROM ligne_reception lr JOIN reception rc ON rc.id_reception = lr.id_reception
         WHERE p_source = 'RECEPTION' AND lr.id_reception = p_id_document AND lr.quantite_stock_kg > 0
         GROUP BY lr.code_reference, rc.code_fournisseur, rc.numero_reception
        UNION ALL
        -- Import : le prix au kilo est celui de la facture (montant / poids net).
        SELECT l.code_reference, f.code_fournisseur, ir.numero,
               sum(rl.quantite_recue_kg), sum(rl.nb_bobines), sum(rl.nb_palettes), true,
               sum(rl.quantite_recue_kg * l.montant_devise / NULLIF(l.poids_net_kg, 0)), max(f.code_devise),
               sum(rl.quantite_recue_kg * l.montant_devise / NULLIF(l.poids_net_kg, 0) * COALESCE(f.taux_change, 1))
          FROM import_reception_lignes rl
          JOIN import_receptions ir     ON ir.id_reception = rl.id_reception
          JOIN import_facture_lignes l  ON l.id_ligne = rl.id_ligne
          JOIN import_factures f        ON f.id_facture = l.id_facture
         WHERE p_source = 'IMPORT' AND rl.id_reception = p_id_document AND rl.quantite_recue_kg > 0
           AND l.code_reference IS NOT NULL
         GROUP BY l.code_reference, f.code_fournisseur, ir.numero
    ), x AS (
        SELECT u.*,
               CASE WHEN u.bobines > 0 AND u.kg > 0 THEN round(u.kg / u.bobines, 4) END AS poids,
               CASE WHEN u.palettes > 0 AND u.palettes_entieres AND u.bobines > 0
                    THEN round(u.bobines / u.palettes)::bigint END AS bpp
          FROM recu u
    )
    SELECT p_source, p_id_document, x.numero, x.code_reference, x.code_fournisseur, x.kg,
           NULLIF(x.bobines, 0), NULLIF(x.palettes, 0),
           r.poids_bobine_kg, x.poids, r.bobines_par_palette, x.bpp,
           round(x.montant_devise / NULLIF(x.kg, 0), 6), x.code_devise, round(x.montant_mad / NULLIF(x.kg, 0), 6),
           CASE WHEN x.poids IS NOT NULL
                 AND (COALESCE(r.poids_bobine_kg, 0) = 0
                      OR abs(x.poids - r.poids_bobine_kg) / r.poids_bobine_kg <= 0.5) THEN 1 ELSE 0 END,
           CASE WHEN x.bpp IS NOT NULL
                 AND (COALESCE(r.bobines_par_palette, 0) = 0
                      OR abs(x.bpp - r.bobines_par_palette)::numeric / r.bobines_par_palette <= 0.5) THEN 1 ELSE 0 END,
           p_utilisateur
      FROM x JOIN reference r ON r.code_reference = x.code_reference;
    GET DIAGNOSTICS n = ROW_COUNT;

    -- La fiche suit la derniere mesure retenue.
    UPDATE reference r SET poids_bobine_kg = round(h.poids_bobine_mesure, 4)
      FROM historique_conditionnement h
     WHERE h.id_document = p_id_document AND h.source = p_source
       AND h.code_reference = r.code_reference AND h.poids_applique = 1;
    UPDATE reference r SET bobines_par_palette = h.bobines_palette_observe
      FROM historique_conditionnement h
     WHERE h.id_document = p_id_document AND h.source = p_source
       AND h.code_reference = r.code_reference AND h.colisage_applique = 1;
    RETURN n;
END;
$$;


ALTER FUNCTION public.fn_suivi_conditionnement(p_source text, p_id_document text, p_utilisateur text) OWNER TO gestionfil;

--
-- Name: fn_tolerance_fournisseur(text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_tolerance_fournisseur(p_code_fournisseur text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
    SELECT COALESCE(
        (SELECT f.tolerance_pesee_pct FROM fournisseur f WHERE f.code_fournisseur = p_code_fournisseur),
        (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee'),
        2);
$$;


ALTER FUNCTION public.fn_tolerance_fournisseur(p_code_fournisseur text) OWNER TO gestionfil;

--
-- Name: fn_tolerance_pesee(text); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_tolerance_pesee(p_id_reception text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
    SELECT COALESCE(
        (SELECT f.tolerance_pesee_pct FROM reception rc
           JOIN fournisseur f ON f.code_fournisseur = rc.code_fournisseur
          WHERE rc.id_reception = p_id_reception),
        (SELECT CAST(valeur_courante AS numeric) FROM parametre WHERE code_parametre = 'P_TolerEcartPesee'),
        2);
$$;


ALTER FUNCTION public.fn_tolerance_pesee(p_id_reception text) OWNER TO gestionfil;

--
-- Name: fn_trg_archive_immuable_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_archive_immuable_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite sur l''''archive de reception.';
    RETURN OLD;
END;
$$;


ALTER FUNCTION public.fn_trg_archive_immuable_d() OWNER TO gestionfil;

--
-- Name: fn_trg_archive_immuable_r(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_archive_immuable_r() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM archive_reception WHERE id_archive = NEW.id_archive) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit sur une archive de reception.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_archive_immuable_r() OWNER TO gestionfil;

--
-- Name: fn_trg_archive_immuable_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_archive_immuable_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : l''''archive de reception est figee.';
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_archive_immuable_u() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_bc_statut(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_bc_statut() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('bon_commande', 'UPDATE', NEW.id_bc,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'montant_total_mad', NEW.montant_total_mad,
                            'id_utilisateur_validation', NEW.id_utilisateur_validation),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_bc_statut() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_droit_champ_i(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_droit_champ_i() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               nouvelles_valeurs, id_utilisateur, adresse_ip, session_id)
        VALUES ('droit_champ', 'INSERT', NEW.id_utilisateur,
                json_build_object('module', NEW.module, 'champ', NEW.champ, 'niveau', NEW.niveau),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_droit_champ_i() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_droit_champ_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_droit_champ_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('droit_champ', 'UPDATE', NEW.id_utilisateur,
                json_build_object('module', NEW.module, 'champ', NEW.champ, 'niveau', OLD.niveau),
                json_build_object('module', NEW.module, 'champ', NEW.champ, 'niveau', NEW.niveau),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_droit_champ_u() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_fournisseur(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_fournisseur() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('fournisseur', 'UPDATE', NEW.code_fournisseur,
                json_build_object('delai_livraison_jours', OLD.delai_livraison_jours,
                            'code_devise', OLD.code_devise, 'actif', OLD.actif),
                json_build_object('delai_livraison_jours', NEW.delai_livraison_jours,
                            'code_devise', NEW.code_devise, 'actif', NEW.actif),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_fournisseur() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_immuable_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_immuable_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'Suppression interdite dans le journal d''''audit.';
    RETURN OLD;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_immuable_d() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_immuable_r(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_immuable_r() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM audit_log WHERE id_audit = NEW.id_audit) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit dans le journal d audit.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_immuable_r() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_immuable_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_immuable_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'Le journal d''''audit est immuable.';
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_immuable_u() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_inventaire_i(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_inventaire_i() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('inventaire', 'INSERT', NEW.id_inventaire,
                NULL,
                json_build_object('numero_inventaire', NEW.numero_inventaire,
                            'code_magasin',      NEW.code_magasin,
                            'type_inventaire',   NEW.type_inventaire,
                            'statut',            NEW.statut),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_inventaire_i() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_inventaire_statut(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_inventaire_statut() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('inventaire', 'UPDATE', NEW.id_inventaire,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'numero_inventaire', NEW.numero_inventaire),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_inventaire_statut() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_ligne_qualite(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_ligne_qualite() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('ligne_qualite', 'UPDATE', NEW.code_qualite || '/' || NEW.code_role,
                json_build_object('densite', OLD.densite),
                json_build_object('densite', NEW.densite, 'unite_densite', NEW.unite_densite),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_ligne_qualite() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_modification(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_modification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_ancien  jsonb;
    v_nouveau jsonb;
    v_cle     text;
    v_ignore  text[] := ARRAY['date_modification', 'date_maj', 'date_derniere_modif'] || TG_ARGV;
    v_col     text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_ancien := '{}'::jsonb;
        v_nouveau := '{}'::jsonb;
        FOR v_col IN SELECT key FROM jsonb_each(to_jsonb(NEW)) LOOP
            CONTINUE WHEN v_col = ANY (v_ignore);
            IF to_jsonb(OLD) -> v_col IS DISTINCT FROM to_jsonb(NEW) -> v_col THEN
                v_ancien := v_ancien || jsonb_build_object(v_col, to_jsonb(OLD) -> v_col);
                v_nouveau := v_nouveau || jsonb_build_object(v_col, to_jsonb(NEW) -> v_col);
            END IF;
        END LOOP;
        IF v_nouveau = '{}'::jsonb THEN
            RETURN NEW;    -- rien qui compte n'a change
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        v_nouveau := to_jsonb(NEW);
    ELSE
        v_ancien := to_jsonb(OLD);
    END IF;

    -- La cle, meme composee (un lot : reference|lot fournisseur).
    SELECT string_agg(COALESCE(to_jsonb(NEW), to_jsonb(OLD)) ->> a.attname, '|'
                      ORDER BY array_position(c.conkey, a.attnum)) INTO v_cle
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'p' AND c.conrelid = TG_RELID;

    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES (TG_TABLE_NAME, TG_OP, COALESCE(v_cle, '(cle composite)'),
            v_ancien::text, v_nouveau::text,
            current_setting('gestionfil.id_utilisateur', true),
            current_setting('gestionfil.adresse_ip', true),
            current_setting('gestionfil.session_id', true));
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.fn_trg_audit_modification() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_mouvement(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_mouvement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('mouvement', 'INSERT', NEW.id_mouvement,
                NULL,
                json_build_object('numero_mouvement', NEW.numero_mouvement,
                            'code_type_mvt',    NEW.code_type_mvt,
                            'code_magasin',     NEW.code_magasin,
                            'date_mouvement',   NEW.date_mouvement,
                            'auteur_declare',   NEW.id_utilisateur),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_mouvement() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_parametre(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_parametre() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('parametre', 'UPDATE', NEW.code_parametre,
                json_build_object('valeur_courante', OLD.valeur_courante),
                json_build_object('valeur_courante', NEW.valeur_courante),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_parametre() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_permission_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_permission_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, id_utilisateur, adresse_ip, session_id)
        VALUES ('permission', 'DELETE', OLD.id_permission,
                json_build_object('role', OLD.code_role_user, 'module', OLD.module, 'action', OLD.action),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_permission_d() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_permission_i(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_permission_i() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               nouvelles_valeurs, id_utilisateur, adresse_ip, session_id)
        VALUES ('permission', 'INSERT', NEW.id_permission,
                json_build_object('role', NEW.code_role_user, 'module', NEW.module, 'action', NEW.action),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_permission_i() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_plan_achat_figement(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_plan_achat_figement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('plan_achat', 'UPDATE', NEW.id_proposition,
                json_build_object('figee', OLD.figee, 'quantite_suggeree_kg', OLD.quantite_suggeree_kg),
                json_build_object('figee', NEW.figee, 'quantite_suggeree_kg', NEW.quantite_suggeree_kg,
                            'code_reference', NEW.code_reference, 'motif', NEW.motif_figement),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_plan_achat_figement() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_plan_statut(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_plan_statut() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('plan_production', 'UPDATE', NEW.id_plan,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'annee', NEW.annee, 'numero_version', NEW.numero_version),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_plan_statut() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_qualite_statut(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_qualite_statut() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('qualite', 'UPDATE', NEW.code_qualite,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'nom', NEW.nom),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_qualite_statut() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_reception_statut(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_reception_statut() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('reception', 'UPDATE', NEW.id_reception,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'id_utilisateur_controle', NEW.id_utilisateur_controle),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_reception_statut() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_recette_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_recette_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('recette', 'DELETE', OLD.id_recette,
                json_build_object('code_qualite', OLD.code_qualite, 'code_reference', OLD.code_reference,
                            'code_role', OLD.code_role, 'pourcentage', OLD.pourcentage_composition),
                NULL,
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_recette_d() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_recette_i(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_recette_i() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('recette', 'INSERT', NEW.id_recette,
                NULL,
                json_build_object('code_qualite', NEW.code_qualite, 'code_reference', NEW.code_reference,
                            'code_role', NEW.code_role, 'pourcentage', NEW.pourcentage_composition),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_recette_i() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_recette_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_recette_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('recette', 'UPDATE', NEW.id_recette,
                json_build_object('code_reference', OLD.code_reference,
                            'pourcentage', OLD.pourcentage_composition),
                json_build_object('code_qualite', NEW.code_qualite, 'code_reference', NEW.code_reference,
                            'pourcentage', NEW.pourcentage_composition),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_recette_u() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_reference(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('reference', 'UPDATE', NEW.code_reference,
                json_build_object('prix_catalogue', OLD.prix_catalogue, 'code_fournisseur', OLD.code_fournisseur, 'actif', OLD.actif),
                json_build_object('prix_catalogue', NEW.prix_catalogue, 'code_fournisseur', NEW.code_fournisseur, 'actif', NEW.actif),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_reference() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_suppression(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_suppression() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_cle text;
BEGIN
    -- L'identifiant de la ligne effacee, quel que soit le nom de sa cle : on le
    -- retrouve dans le JSON de la ligne, par la colonne de cle primaire.
    SELECT to_jsonb(OLD) ->> a.attname INTO v_cle
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'p' AND c.conrelid = TG_RELID
       AND array_length(c.conkey, 1) = 1;

    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                           anciennes_valeurs, nouvelles_valeurs,
                           id_utilisateur, adresse_ip, session_id)
    VALUES (TG_TABLE_NAME, 'DELETE', COALESCE(v_cle, '(cle composite)'),
            to_jsonb(OLD), NULL,
            current_setting('gestionfil.id_utilisateur', true),
            current_setting('gestionfil.adresse_ip', true),
            current_setting('gestionfil.session_id', true));
    RETURN OLD;
END $$;


ALTER FUNCTION public.fn_trg_audit_suppression() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_transfert_i(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_transfert_i() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('transfert', 'INSERT', NEW.id_transfert,
                NULL,
                json_build_object('numero_transfert', NEW.numero_transfert,
                            'magasin_source',   NEW.code_magasin_source,
                            'magasin_dest',     NEW.code_magasin_dest,
                            'statut',           NEW.statut),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_transfert_i() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_transfert_statut(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_transfert_statut() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('transfert', 'UPDATE', NEW.id_transfert,
                json_build_object('statut', OLD.statut),
                json_build_object('statut', NEW.statut, 'numero_transfert', NEW.numero_transfert),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_transfert_statut() OWNER TO gestionfil;

--
-- Name: fn_trg_audit_utilisateur(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_audit_utilisateur() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO audit_log (table_concernee, operation, id_enregistrement,
                               anciennes_valeurs, nouvelles_valeurs,
                               id_utilisateur, adresse_ip, session_id)
        VALUES ('utilisateur', 'UPDATE', NEW.id_utilisateur,
                json_build_object('code_role_user', OLD.code_role_user, 'actif', OLD.actif),
                json_build_object('code_role_user', NEW.code_role_user, 'actif', NEW.actif),
                current_setting('gestionfil.id_utilisateur', true),
                current_setting('gestionfil.adresse_ip', true),
                current_setting('gestionfil.session_id', true));
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_audit_utilisateur() OWNER TO gestionfil;

--
-- Name: fn_trg_bc_separation_taches(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_bc_separation_taches() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    role_validateur text;
BEGIN
    -- Rien a verifier tant que personne n'a valide.
    IF NEW.id_utilisateur_validation IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.id_utilisateur_validation <> NEW.id_utilisateur_creation THEN
        RETURN NEW;
    END IF;

    SELECT u.code_role_user INTO role_validateur
      FROM utilisateur u
     WHERE u.id_utilisateur = NEW.id_utilisateur_validation;

    IF role_validateur = 'ADMIN' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION
        'B4 regle 4 : vous ne pouvez pas valider un bon de commande que vous avez cree. '
        'Un autre compte habilite doit le valider.';
END;
$$;


ALTER FUNCTION public.fn_trg_bc_separation_taches() OWNER TO gestionfil;

--
-- Name: fn_trg_empl_numero(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_empl_numero() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_nb bigint;
BEGIN
    IF NEW.role <> 'ETAGE' THEN
        RETURN NEW;
    END IF;

    SELECT nb_etages INTO v_nb FROM machine WHERE code_machine = NEW.code_machine;

    IF NEW.numero_etage > v_nb THEN
        RAISE EXCEPTION 'La machine % declare % etages : l''etage % ne peut pas exister.',
            NEW.code_machine, v_nb, NEW.numero_etage;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_empl_numero() OWNER TO gestionfil;

--
-- Name: fn_trg_histo_prix_immuable_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_histo_prix_immuable_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite sur l''''historique des prix.';
    RETURN OLD;
END;
$$;


ALTER FUNCTION public.fn_trg_histo_prix_immuable_d() OWNER TO gestionfil;

--
-- Name: fn_trg_histo_prix_immuable_r(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_histo_prix_immuable_r() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM historique_prix WHERE id_histo_prix = NEW.id_histo_prix) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit dans l historique des prix.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_histo_prix_immuable_r() OWNER TO gestionfil;

--
-- Name: fn_trg_histo_prix_immuable_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_histo_prix_immuable_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : l''''historique des prix est immuable (base du CMUP).';
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_histo_prix_immuable_u() OWNER TO gestionfil;

--
-- Name: fn_trg_iac_immuable(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_iac_immuable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'import_ajustements_cump est un journal : ni modification, ni suppression.'
        USING ERRCODE = 'check_violation';
END;
$$;


ALTER FUNCTION public.fn_trg_iac_immuable() OWNER TO gestionfil;

--
-- Name: fn_trg_ifl_bc(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_ifl_bc() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_ref       text;
    v_four_bc   text;
    v_num_bc    text;
    v_four_fac  text;
BEGIN
    IF NEW.id_ligne_bc IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT lb.code_reference, bc.code_fournisseur, bc.numero_bc
      INTO v_ref, v_four_bc, v_num_bc
      FROM ligne_bc lb JOIN bon_commande bc ON bc.id_bc = lb.id_bc
     WHERE lb.id_ligne_bc = NEW.id_ligne_bc;
    SELECT code_fournisseur INTO v_four_fac FROM import_factures WHERE id_facture = NEW.id_facture;

    IF v_four_bc IS DISTINCT FROM v_four_fac THEN
        RAISE EXCEPTION 'Le bon % est du fournisseur %, la facture de % : la ligne ne peut pas s''y rattacher.',
            v_num_bc, v_four_bc, v_four_fac USING ERRCODE = 'check_violation';
    END IF;
    IF v_ref IS DISTINCT FROM NEW.code_reference THEN
        RAISE EXCEPTION 'La ligne du bon % porte la reference %, la ligne de facture %.',
            v_num_bc, v_ref, NEW.code_reference USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_ifl_bc() OWNER TO gestionfil;

--
-- Name: fn_trg_import_dossier_garde(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_import_dossier_garde() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.statut <> 'BROUILLON' THEN
            RAISE EXCEPTION 'Seul un dossier en brouillon se supprime.' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.statut = 'CLOTURE' AND NEW.statut IS DISTINCT FROM 'EN_COURS' THEN
        RAISE EXCEPTION 'Dossier cloture : il ne se modifie plus.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_import_dossier_garde() OWNER TO gestionfil;

--
-- Name: fn_trg_import_facture_engagement(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_import_facture_engagement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_dossier text;
    v_frs     text;
    v_numero  text;
BEGIN
    IF NEW.id_engagement IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT id_dossier, code_fournisseur, numero_ei INTO v_dossier, v_frs, v_numero
      FROM import_engagements WHERE id_engagement = NEW.id_engagement;
    IF v_dossier IS DISTINCT FROM NEW.id_dossier THEN
        RAISE EXCEPTION 'L''engagement % n''appartient pas a ce dossier.', v_numero
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_frs IS NOT NULL AND v_frs <> NEW.code_fournisseur THEN
        RAISE EXCEPTION 'L''engagement % couvre un autre fournisseur que celui de la facture.', v_numero
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_import_facture_engagement() OWNER TO gestionfil;

--
-- Name: fn_trg_import_facture_figee(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_import_facture_figee() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (NEW.code_fournisseur, NEW.code_devise, NEW.taux_change, NEW.montant_devise)
           IS DISTINCT FROM (OLD.code_fournisseur, OLD.code_devise, OLD.taux_change, OLD.montant_devise)
       AND EXISTS (SELECT 1 FROM import_facture_lignes l WHERE l.id_facture = NEW.id_facture
                      AND l.quantite_recue_kg > 0) THEN
        RAISE EXCEPTION 'IMPORT-FIGEE : la facture % a deja fait entrer de la marchandise : son fournisseur, sa devise, son taux et son montant ne bougent plus. Corrigez par les frais du dossier, ou contre-passez la reception avant la DUM.',
            NEW.numero_facture USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_import_facture_figee() OWNER TO gestionfil;

--
-- Name: fn_trg_import_hors_reception_locale(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_import_hors_reception_locale() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_reception text;
BEGIN
    IF NEW.id_ligne_bc IS NOT NULL THEN
        SELECT r.numero_reception INTO v_reception
          FROM ligne_reception lr JOIN reception r ON r.id_reception = lr.id_reception
         WHERE lr.id_ligne_bc = NEW.id_ligne_bc AND r.statut <> 'ANNULE'
         LIMIT 1;
        IF v_reception IS NOT NULL THEN
            RAISE EXCEPTION 'ETANCHEITE : cette ligne de bon est deja recue en reception locale (%) : elle ne se rattache pas a un dossier d''import.',
                v_reception USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_import_hors_reception_locale() OWNER TO gestionfil;

--
-- Name: fn_trg_import_ligne_figee(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_import_ligne_figee() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.quantite_recue_kg > 0
       AND (NEW.code_reference, NEW.type_ligne, NEW.unite, NEW.quantite, NEW.poids_net_kg,
            NEW.prix_unitaire_devise, NEW.remise_pct, NEW.id_ligne_bc)
           IS DISTINCT FROM
           (OLD.code_reference, OLD.type_ligne, OLD.unite, OLD.quantite, OLD.poids_net_kg,
            OLD.prix_unitaire_devise, OLD.remise_pct, OLD.id_ligne_bc) THEN
        RAISE EXCEPTION 'IMPORT-FIGEE : la ligne % de la facture est deja recue (% kg) : reference, poids, prix et bon ne bougent plus. Soldez-la, ou contre-passez la reception avant la DUM.',
            OLD.code_reference, OLD.quantite_recue_kg USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_import_ligne_figee() OWNER TO gestionfil;

--
-- Name: fn_trg_import_reception_segregation(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_import_reception_segregation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut = 'VALIDEE' AND OLD.statut IS DISTINCT FROM 'VALIDEE'
 AND NEW.id_utilisateur_validation = NEW.id_utilisateur_creation THEN
        RAISE EXCEPTION 'B4 regle 2 : celui qui a saisi la reception ne peut pas la valider.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_import_reception_segregation() OWNER TO gestionfil;

--
-- Name: fn_trg_import_verrou(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_import_verrou() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_row     record;
    v_dossier text;
    v_statut  text;
BEGIN
    IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

    IF TG_TABLE_NAME IN ('import_factures', 'dossier_lignes_frais') THEN
        v_dossier := v_row.id_dossier;
    ELSIF TG_TABLE_NAME = 'import_facture_lignes' THEN
        SELECT id_dossier INTO v_dossier FROM import_factures WHERE id_facture = v_row.id_facture;
    ELSIF TG_TABLE_NAME IN ('dossier_lignes_frais_cibles', 'lignes_frais_repartition') THEN
        SELECT id_dossier INTO v_dossier FROM dossier_lignes_frais WHERE id_ligne_frais = v_row.id_ligne_frais;
    END IF;

    SELECT statut INTO v_statut FROM import_dossiers WHERE id_dossier = v_dossier;
    IF v_statut = 'CLOTURE' THEN
        RAISE EXCEPTION 'Dossier cloture : ses factures, ses frais et leur repartition sont figes.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_import_verrou() OWNER TO gestionfil;

--
-- Name: fn_trg_irl_coherence(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_irl_coherence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_trg_irl_coherence() OWNER TO gestionfil;

--
-- Name: fn_trg_irl_quarantaine(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_irl_quarantaine() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut_qualite IN ('NON_CONFORME','QUARANTAINE')
 AND COALESCE((SELECT est_quarantaine FROM magasin WHERE code_magasin = NEW.code_magasin), 0) = 0 THEN
        RAISE EXCEPTION 'Une ligne non conforme ou en quarantaine doit etre dirigee vers un magasin de quarantaine.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_irl_quarantaine() OWNER TO gestionfil;

--
-- Name: fn_trg_ligne_reception_ecart(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_ligne_reception_ecart() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_tol numeric;
BEGIN
    IF NEW.quantite_commandee_kg IS NOT NULL AND NEW.derogation_ecart = 0 THEN
        v_tol := fn_tolerance_pesee(NEW.id_reception);
        IF NEW.quantite_stock_kg > NEW.quantite_commandee_kg * (1 + v_tol / 100.0) + 0.0005 THEN
            RAISE EXCEPTION 'C10 : % kg peses pour % kg attendus, au-dela de la tolerance de % %%. Une derogation motivee est requise.',
                round(NEW.quantite_stock_kg, 2), round(NEW.quantite_commandee_kg, 2), round(v_tol, 2);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_ligne_reception_ecart() OWNER TO gestionfil;

--
-- Name: fn_trg_ligne_reception_quarantaine(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_ligne_reception_quarantaine() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut_qualite IN ('NON_CONFORME','QUARANTAINE')
 AND (SELECT est_quarantaine FROM magasin WHERE code_magasin = NEW.code_magasin_dest) = 0 THEN
        RAISE EXCEPTION 'Une ligne non conforme ou en quarantaine doit etre dirigee vers un magasin de quarantaine.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_ligne_reception_quarantaine() OWNER TO gestionfil;

--
-- Name: fn_trg_ligne_reception_substitution(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_ligne_reception_substitution() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_trg_ligne_reception_substitution() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_appliquer(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_appliquer() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_magasin       text;
    v_date          text;
    v_signe         integer;
    v_impacte_cmup  smallint;
    v_cmup_magasin  numeric;
    v_catalogue     numeric;
    v_cmup_fiche    numeric;
    v_maintenant    text := to_char((now() AT TIME ZONE 'UTC'),
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
    SELECT m.code_magasin, m.date_mouvement, tm.signe, tm.impacte_cmup
      INTO v_magasin, v_date, v_signe, v_impacte_cmup
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- (a1) garantir l'existence de la ligne de solde, a zero
    INSERT INTO stock_magasin (code_reference, code_magasin, quantite_kg, cmup_mad)
    VALUES (NEW.code_reference, v_magasin, 0, NULL)
    ON CONFLICT (code_reference, code_magasin) DO NOTHING;

    -- Le prix catalogue n'est lu que s'il peut servir : une ENTREE dans un
    -- magasin qui n'a encore aucun CMUP.
    IF v_signe = 1 THEN
        SELECT cmup_mad INTO v_cmup_magasin
          FROM stock_magasin
         WHERE code_reference = NEW.code_reference AND code_magasin = v_magasin;
        IF v_cmup_magasin IS NULL THEN
            v_catalogue := fn_prix_catalogue_mad(NEW.code_reference);
        END IF;
    END IF;

    -- (a2) appliquer le delta signe, puis le CMUP (R04)
    UPDATE stock_magasin
       SET cmup_mad = CASE
               -- Entree valorisee : moyenne ponderee, le stock deja present
               -- compte a son CMUP, ou a defaut au prix catalogue.
               WHEN v_impacte_cmup = 1
                AND NEW.prix_kg_mad IS NOT NULL
                AND quantite_kg + NEW.quantite_kg > 0
               THEN round(( quantite_kg * COALESCE(cmup_mad, v_catalogue, NEW.prix_kg_mad)
                          + NEW.quantite_kg * NEW.prix_kg_mad )
                          / (quantite_kg + NEW.quantite_kg), 4)
               -- Entree sans prix dans un magasin jamais valorise : le prix
               -- catalogue, s'il existe. Sinon le CMUP reste vide.
               WHEN v_signe = 1 AND cmup_mad IS NULL
               THEN v_catalogue
               ELSE cmup_mad
           END,
           quantite_kg = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
           -- LE COMPTE DE BOBINES SUIT LES KILOS, avec le meme signe.
           --
           -- GREATEST borne a zero, et ce n'est pas une precaution de confort :
           -- les mouvements anterieurs a ce module ne portent aucun nombre de
           -- bobines, donc un magasin peut contenir 400 kg pour un compte de 0.
           -- Sans la borne, la premiere sortie chiffree violerait le CHECK et
           -- bloquerait un mouvement de kilos parfaitement legitime. Le compte
           -- est un compteur SECONDAIRE ; c'est le controle C30 qui signale les
           -- incoherences, pas une erreur au visage du magasinier.
           nb_bobines = GREATEST(0, nb_bobines + v_signe * COALESCE(NEW.nb_bobines, 0)),
           date_derniere_entree = CASE WHEN v_signe =  1 THEN v_date
                                       ELSE date_derniere_entree END,
           date_derniere_sortie = CASE WHEN v_signe = -1 THEN v_date
                                       ELSE date_derniere_sortie END,
           date_maj = v_maintenant
     WHERE code_reference = NEW.code_reference
       AND code_magasin   = v_magasin;

    -- (b) solde par lot, seulement si la ligne porte un lot
    IF NEW.lot_fournisseur IS NOT NULL THEN
        INSERT INTO stock_lot (code_reference, code_magasin, lot_fournisseur, quantite_kg,
                               prix_entree_mad, date_fabrication, date_peremption, code_couleur)
        VALUES (NEW.code_reference, v_magasin, NEW.lot_fournisseur, 0,
                NEW.prix_kg_mad, NEW.date_fabrication, NEW.date_peremption, NEW.code_couleur)
        ON CONFLICT (code_reference, code_magasin, lot_fournisseur) DO NOTHING;

        UPDATE stock_lot
           SET quantite_kg      = round(quantite_kg + v_signe * NEW.quantite_kg, 4),
               -- Meme borne, meme raison qu'au solde par magasin ci-dessus.
               -- C'est CE compte-ci que lit le declencheur de capacite : sur un
               -- emplacement de machine, ou la saisie impose toujours le nombre
               -- de bobines, il est exact des la premiere ecriture.
               nb_bobines       = GREATEST(0, nb_bobines + v_signe * COALESCE(NEW.nb_bobines, 0)),
               prix_entree_mad  = COALESCE(prix_entree_mad, NEW.prix_kg_mad),
               date_fabrication = COALESCE(date_fabrication, NEW.date_fabrication),
               date_peremption  = COALESCE(date_peremption, NEW.date_peremption),
               code_couleur     = COALESCE(code_couleur, NEW.code_couleur),
               date_maj         = v_maintenant
         WHERE code_reference  = NEW.code_reference
           AND lot_fournisseur = NEW.lot_fournisseur
           AND code_magasin    = v_magasin;
    END IF;

    -- (c) CMUP consolide tous magasins sur la fiche reference (RG-08), a CHAQUE
    -- mouvement. Sans stock nulle part : le dernier CMUP de la fiche, ou le
    -- prix catalogue si elle n'en a jamais eu. La fiche n'est reecrite que si
    -- la valeur change : chaque ecriture passe au journal d'audit.
    SELECT COALESCE(
               (SELECT round(SUM(sm.quantite_kg * sm.cmup_mad) / SUM(sm.quantite_kg), 4)
                  FROM stock_magasin sm
                 WHERE sm.code_reference = NEW.code_reference
                   AND sm.quantite_kg > 0
                   AND sm.cmup_mad IS NOT NULL),
               r.cmup_mad,
               fn_prix_catalogue_mad(NEW.code_reference))
      INTO v_cmup_fiche
      FROM reference r
     WHERE r.code_reference = NEW.code_reference;

    UPDATE reference
       SET cmup_mad = v_cmup_fiche,
           date_dernier_cmup = v_maintenant
     WHERE code_reference = NEW.code_reference
       AND cmup_mad IS DISTINCT FROM v_cmup_fiche;

    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_appliquer() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_capacite(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_capacite() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_empl  machine_emplacement%ROWTYPE;
    v_signe integer;
    v_apres bigint;
    v_max   bigint;
BEGIN
    IF COALESCE(NEW.nb_bobines, 0) = 0 THEN
        RETURN NEW;
    END IF;

    SELECT e.* INTO v_empl
      FROM machine_emplacement e
      JOIN mouvement m ON m.code_magasin = e.code_magasin
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- Magasin ordinaire : aucun plafond a faire respecter.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT tm.signe INTO v_signe
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;

    -- On ne deborde pas en retirant.
    IF v_signe < 0 THEN
        RETURN NEW;
    END IF;

    -- Plafond de l'emplacement. Le libelle genere donne un message que
    -- l'operateur reconnait : il lit « Chaine pleine », pas « MC1-CH plein ».
    SELECT COALESCE(SUM(nb_bobines), 0) INTO v_apres
      FROM stock_lot WHERE code_magasin = v_empl.code_magasin;

    IF v_apres + NEW.nb_bobines > v_empl.capacite_bobines THEN
        RAISE EXCEPTION 'C33 : % plein. Capacite % bobines, il y en aurait %.',
            v_empl.libelle, v_empl.capacite_bobines, v_apres + NEW.nb_bobines;
    END IF;

    -- Plafond de la machine, tous emplacements confondus.
    SELECT COALESCE(SUM(sl.nb_bobines), 0) INTO v_apres
      FROM stock_lot sl
      JOIN machine_emplacement e ON e.code_magasin = sl.code_magasin
     WHERE e.code_machine = v_empl.code_machine;

    SELECT capacite_bobines INTO v_max
      FROM machine WHERE code_machine = v_empl.code_machine;

    IF v_apres + NEW.nb_bobines > v_max THEN
        RAISE EXCEPTION 'C34 : machine % pleine. Capacite % bobines, il y en aurait %.',
            v_empl.code_machine, v_max, v_apres + NEW.nb_bobines;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_capacite() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_immuable_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_immuable_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite sur les lignes de mouvement.';
    RETURN OLD;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_immuable_d() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_immuable_r(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_immuable_r() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM ligne_mouvement WHERE id_ligne_mouvement = NEW.id_ligne_mouvement) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit sur une ligne de mouvement.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_immuable_r() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_immuable_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_immuable_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : les lignes de mouvement sont immuables.';
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_immuable_u() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_lot_controle(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_lot_controle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_statut text;
    v_type   text;
    v_doc    text;
    v_dest_q bigint;
BEGIN
    IF NEW.poids_unitaire_theorique_kg IS NULL AND COALESCE(NEW.nb_bobines, 0) > 0 THEN
        SELECT NULLIF(poids_bobine_kg, 0) INTO NEW.poids_unitaire_theorique_kg
          FROM reference WHERE code_reference = NEW.code_reference;
    END IF;
    IF NEW.lot_fournisseur IS NOT NULL THEN
        SELECT statut INTO v_statut FROM lot
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
        IF v_statut = 'BLOQUE' THEN
            -- LE BLOCAGE QUALITE ASSOUPLI (regle 11) : interdit ce qui EMPLOIE
            -- le lot, laisse ce qui l'ISOLE.
            SELECT m.code_type_mvt, m.reference_document INTO v_type, v_doc
              FROM mouvement m WHERE m.id_mouvement = NEW.id_mouvement;
            IF v_type IN ('RETOUR_MACHINE', 'ANNUL_CHARGE_MACHINE', 'RETOUR_FOURN',
                          'AJUST_INV_POS', 'AJUST_INV_NEG', 'ENTREE_REC') THEN
                RETURN NEW;
            END IF;
            IF v_type IN ('TRANSFERT_SORTIE', 'TRANSFERT_ENTREE') THEN
                SELECT mg.est_quarantaine INTO v_dest_q
                  FROM transfert t JOIN magasin mg ON mg.code_magasin = t.code_magasin_dest
                 WHERE t.numero_transfert = v_doc;
                IF v_dest_q = 1 THEN
                    RETURN NEW;
                END IF;
            END IF;
            -- LA DEROGATION ACCORDEE (audit v4) : ce lot, par cette fiche, une fois.
            IF v_type = 'CHARGE_MACHINE' AND EXISTS (
                SELECT 1 FROM demande_autorisation d
                 WHERE d.type_demande = 'LOT_BLOQUE' AND d.statut = 'ACCORDEE'
                   AND d.code_reference = NEW.code_reference AND d.lot_fournisseur = NEW.lot_fournisseur
                   AND d.document = v_doc AND d.date_consommation IS NULL) THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'LOT-BLOQUE : le lot % de % est bloque par la qualite : il ne part ni en production, ni sur machine, ni en fusion. Il peut revenir d''une machine, aller en quarantaine ou retourner au fournisseur.',
                NEW.lot_fournisseur, NEW.code_reference USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_lot_controle() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_lot_registre(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_lot_registre() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_solde  numeric;
    v_bob    numeric;
    v_atteint boolean;
    v_signe  bigint;
    v_neuf   boolean;
BEGIN
    IF NEW.lot_fournisseur IS NULL OR btrim(NEW.lot_fournisseur) = '' THEN
        RETURN NEW;
    END IF;
    SELECT COALESCE(sum(quantite_kg), 0), COALESCE(sum(nb_bobines), 0) INTO v_solde, v_bob FROM stock_lot
     WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
    v_atteint := fn_lot_au_seuil(NEW.code_reference, v_solde, v_bob);
    SELECT tm.signe INTO v_signe FROM mouvement m JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
     WHERE m.id_mouvement = NEW.id_mouvement;
    v_neuf := NOT EXISTS (SELECT 1 FROM lot WHERE code_reference = NEW.code_reference
                                              AND lot_fournisseur = NEW.lot_fournisseur);
    IF v_neuf THEN
        INSERT INTO lot (code_reference, lot_fournisseur, origine, code_fournisseur, categorie)
        SELECT NEW.code_reference, NEW.lot_fournisseur,
               CASE WHEN NEW.lot_fournisseur = 'SANS-LOT' THEN 'SANS_LOT'
                    WHEN NEW.lot_fournisseur LIKE 'RETOUR-%' THEN 'RETOUR'
                    ELSE 'FOURNISSEUR' END,
               r.code_fournisseur,
               CASE WHEN v_atteint THEN 'PROJET' ELSE 'RESTES' END
          FROM reference r WHERE r.code_reference = NEW.code_reference
        ON CONFLICT (code_reference, lot_fournisseur) DO NOTHING;
    ELSE
        UPDATE lot
           SET date_derniere_activite = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               categorie = CASE WHEN v_signe = 1 AND categorie = 'RESTES' AND v_atteint
                                THEN 'PROJET' ELSE categorie END
         WHERE code_reference = NEW.code_reference AND lot_fournisseur = NEW.lot_fournisseur;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_lot_registre() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_lot_requis(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_lot_requis() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.lot_fournisseur IS NULL
 AND (SELECT suivi_lot FROM reference WHERE code_reference = NEW.code_reference) = 1 THEN
        RAISE EXCEPTION 'Tracabilite : lot_fournisseur obligatoire pour cette reference (suivi_lot = 1).';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_lot_requis() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_motif_requis(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_motif_requis() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.code_motif_ligne IS NULL
 AND (SELECT tm.exige_motif_ligne FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1 THEN
        RAISE EXCEPTION 'C08 : motif de ligne (R1-R6) obligatoire pour un retour.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_motif_requis() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_of_requis(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_of_requis() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF COALESCE(NEW.numero_of, (SELECT numero_of FROM mouvement WHERE id_mouvement = NEW.id_mouvement)) IS NULL
 AND (SELECT tm.exige_of FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1 THEN
        RAISE EXCEPTION 'C07 : numero d''''OF obligatoire pour une sortie production.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_of_requis() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_prix_requis(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_prix_requis() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.prix_kg_mad IS NULL
 AND (SELECT tm.exige_prix FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = 1 THEN
        RAISE EXCEPTION 'RG-07 : prix_kg_mad (en MAD) obligatoire pour ce type de mouvement.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_prix_requis() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_stock_lot_suffisant(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_stock_lot_suffisant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- LA CONFIRMATION PASSE AVANT LE CALCUL : inutile d'aller lire le solde
    -- d'un lot dont on a deja decide qu'on s'en ecartait.
    IF NEW.lot_force = 1 THEN
        RETURN NEW;
    END IF;

    IF NEW.lot_fournisseur IS NOT NULL
 AND (SELECT tm.signe FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = -1
 AND NEW.quantite_kg > COALESCE((
        SELECT sl.quantite_kg FROM stock_lot sl
        WHERE sl.code_reference = NEW.code_reference
          AND sl.lot_fournisseur = NEW.lot_fournisseur
          AND sl.code_magasin = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
     ), 0) + 0.0001 THEN
        -- LE MESSAGE DIT CE QU'ON PEUT FAIRE, pas seulement ce qui est refuse.
        -- « Quantite insuffisante sur ce lot » laissait le magasinier sans
        -- issue devant des bobines qu'il avait dans les mains.
        RAISE EXCEPTION 'R02-LOT : le solde connu de ce lot ne couvre pas cette sortie. '
                        'La matiere est peut-etre la malgre tout — les retours de machine '
                        'sont imputes au juge. Confirmez pour charger quand meme.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_stock_lot_suffisant() OWNER TO gestionfil;

--
-- Name: fn_trg_lmvt_stock_suffisant(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_lmvt_stock_suffisant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (SELECT tm.signe FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      WHERE m.id_mouvement = NEW.id_mouvement) = -1
 AND NEW.quantite_kg > COALESCE((
        SELECT sm.quantite_kg FROM stock_magasin sm
        WHERE sm.code_reference = NEW.code_reference
          AND sm.code_magasin = (SELECT code_magasin FROM mouvement WHERE id_mouvement = NEW.id_mouvement)
     ), 0) + 0.0001 THEN
        RAISE EXCEPTION 'R02 : stock insuffisant dans ce magasin. Sortie refusee — regulariser par inventaire ou mouvement inverse.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_lmvt_stock_suffisant() OWNER TO gestionfil;

--
-- Name: fn_trg_machine_decision_maj(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_machine_decision_maj() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'R03 : une decision machine ne se supprime pas ; elle se retire.';
    END IF;
    IF (NEW.id_fiche, NEW.numero_validation, NEW.nature, NEW.code_machine, NEW.code_emplacement,
        NEW.code_magasin, NEW.id_decision_precedente, NEW.date_decision, NEW.id_utilisateur)
       IS DISTINCT FROM
       (OLD.id_fiche, OLD.numero_validation, OLD.nature, OLD.code_machine, OLD.code_emplacement,
        OLD.code_magasin, OLD.id_decision_precedente, OLD.date_decision, OLD.id_utilisateur) THEN
        RAISE EXCEPTION 'R03 : une decision machine ne se modifie pas.';
    END IF;
    IF OLD.statut <> 'ACTIVE' AND NEW.statut IS DISTINCT FROM OLD.statut THEN
        RAISE EXCEPTION 'R03 : une decision retiree ou annulee ne revient pas.';
    END IF;
    RETURN NEW;
END $$;


ALTER FUNCTION public.fn_trg_machine_decision_maj() OWNER TO gestionfil;

--
-- Name: fn_trg_machine_historique_immuable(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_machine_historique_immuable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : l''historique des decisions machine est immuable (%).', TG_TABLE_NAME;
END $$;


ALTER FUNCTION public.fn_trg_machine_historique_immuable() OWNER TO gestionfil;

--
-- Name: fn_trg_machine_nb_etages(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_machine_nb_etages() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_haut bigint;
BEGIN
    SELECT COALESCE(MAX(numero_etage), 0) INTO v_haut
      FROM machine_emplacement
     WHERE code_machine = NEW.code_machine AND role = 'ETAGE';

    IF NEW.nb_etages < v_haut THEN
        RAISE EXCEPTION 'La machine % porte deja un etage % : son nombre d''etages ne peut pas descendre a %.',
            NEW.code_machine, v_haut, NEW.nb_etages;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_machine_nb_etages() OWNER TO gestionfil;

--
-- Name: fn_trg_mouvement_immuable_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_mouvement_immuable_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite dans le grand livre des mouvements.';
    RETURN OLD;
END;
$$;


ALTER FUNCTION public.fn_trg_mouvement_immuable_d() OWNER TO gestionfil;

--
-- Name: fn_trg_mouvement_immuable_r(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_mouvement_immuable_r() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM mouvement WHERE id_mouvement = NEW.id_mouvement) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit dans le grand livre des mouvements. Corriger par un mouvement inverse.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_mouvement_immuable_r() OWNER TO gestionfil;

--
-- Name: fn_trg_mouvement_immuable_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_mouvement_immuable_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : le grand livre des mouvements est immuable. Corriger par un mouvement inverse.';
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_mouvement_immuable_u() OWNER TO gestionfil;

--
-- Name: fn_trg_param_histo_immuable_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_param_histo_immuable_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : suppression interdite sur l''''historique des parametres.';
    RETURN OLD;
END;
$$;


ALTER FUNCTION public.fn_trg_param_histo_immuable_d() OWNER TO gestionfil;

--
-- Name: fn_trg_param_histo_immuable_r(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_param_histo_immuable_r() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM parametre_historique WHERE id_histo_param = NEW.id_histo_param) THEN
        RAISE EXCEPTION 'R03 : remplacement interdit dans l historique des parametres.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_param_histo_immuable_r() OWNER TO gestionfil;

--
-- Name: fn_trg_param_histo_immuable_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_param_histo_immuable_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'R03 : l''''historique des parametres est immuable.';
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_param_histo_immuable_u() OWNER TO gestionfil;

--
-- Name: fn_trg_parametre_historiser(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_parametre_historiser() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO parametre_historique (code_parametre, ancienne_valeur, nouvelle_valeur,
                                      id_utilisateur, motif, ip_adresse)
    VALUES (NEW.code_parametre, OLD.valeur_courante, NEW.valeur_courante,
            COALESCE(NEW.id_utilisateur_modif,
                     current_setting('gestionfil.id_utilisateur', true)),
            NEW.motif_modif,
            current_setting('gestionfil.adresse_ip', true));

    -- Affectation directe plutot qu'un UPDATE : c'est ce qui rend la recursion
    -- structurellement impossible, au lieu de dependre d'un reglage.
    NEW.date_derniere_modif := to_char((now() AT TIME ZONE 'UTC'),
                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_parametre_historiser() OWNER TO gestionfil;

--
-- Name: fn_trg_pf_coherence(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_pf_coherence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.recuperable = 1 AND NEW.inclus_dans_cout = 1 THEN
        RAISE EXCEPTION 'Un frais recuperable n''entre pas dans le cout de revient : la marchandise le paierait deux fois.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_pf_coherence() OWNER TO gestionfil;

--
-- Name: fn_trg_piece_verrou(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_piece_verrou() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_trg_piece_verrou() OWNER TO gestionfil;

--
-- Name: fn_trg_plan_achat_date_ecartee(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_plan_achat_date_ecartee() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut = 'IGNORE' AND OLD.statut IS DISTINCT FROM 'IGNORE' THEN
        NEW.date_ecartee := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_plan_achat_date_ecartee() OWNER TO gestionfil;

--
-- Name: fn_trg_plan_qualite_active_i(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_plan_qualite_active_i() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (SELECT statut FROM qualite WHERE code_qualite = NEW.code_qualite) <> 'ACTIF' THEN
        RAISE EXCEPTION 'R08 : seule une qualite ACTIVE peut etre retenue par un plan.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_plan_qualite_active_i() OWNER TO gestionfil;

--
-- Name: fn_trg_plan_qualite_active_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_plan_qualite_active_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (SELECT statut FROM qualite WHERE code_qualite = NEW.code_qualite) <> 'ACTIF' THEN
        RAISE EXCEPTION 'R08 : seule une qualite ACTIVE peut etre retenue par un plan.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_plan_qualite_active_u() OWNER TO gestionfil;

--
-- Name: fn_trg_plan_qualite_exclusive_i(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_plan_qualite_exclusive_i() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
    SELECT 1 FROM plan_qualite pq
    JOIN plan_production pp ON pp.id_plan = pq.id_plan
    WHERE pq.code_qualite = NEW.code_qualite
      AND pq.id_plan <> NEW.id_plan
      AND pp.statut <> 'CLOTURE') THEN
        RAISE EXCEPTION 'Cette qualite figure deja dans un autre plan actif : un plan doit etre cloture avant que sa qualite soit reprise ailleurs.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_plan_qualite_exclusive_i() OWNER TO gestionfil;

--
-- Name: fn_trg_plan_qualite_exclusive_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_plan_qualite_exclusive_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
    SELECT 1 FROM plan_qualite pq
    JOIN plan_production pp ON pp.id_plan = pq.id_plan
    WHERE pq.code_qualite = NEW.code_qualite
      AND pq.id_plan <> NEW.id_plan
      AND NOT (pq.id_plan = OLD.id_plan AND pq.code_qualite = OLD.code_qualite)
      AND pp.statut <> 'CLOTURE') THEN
        RAISE EXCEPTION 'Cette qualite figure deja dans un autre plan actif : un plan doit etre cloture avant que sa qualite soit reprise ailleurs.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_plan_qualite_exclusive_u() OWNER TO gestionfil;

--
-- Name: fn_trg_plan_valider_recettes(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_plan_valider_recettes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut = 'EN_COURS' AND OLD.statut <> 'EN_COURS'
 AND EXISTS (
    SELECT 1 FROM ligne_plan_production lpp
    WHERE lpp.id_plan = NEW.id_plan AND lpp.m2_prevus > 0
      AND NOT EXISTS (SELECT 1 FROM plan_qualite pq
                      WHERE pq.id_plan = NEW.id_plan AND pq.code_qualite = lpp.code_qualite)) THEN
        RAISE EXCEPTION 'R08 : chaque qualite planifiee doit figurer dans l''''entete du plan (table plan_qualite) avant mise en service.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_plan_valider_recettes() OWNER TO gestionfil;

--
-- Name: fn_trg_qualite_activer_densite_ml(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_qualite_activer_densite_ml() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    JOIN ligne_qualite lq ON lq.code_qualite = NEW.code_qualite AND lq.code_role = r.code_role
    JOIN reference ref    ON ref.code_reference = r.code_reference
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
      AND lq.unite_densite = 'ml_m2' AND ref.densite_kg_ml IS NULL) THEN
        RAISE EXCEPTION 'R01 : role en ml/m2 — densite_kg_ml obligatoire sur la reference pour convertir en kg.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_qualite_activer_densite_ml() OWNER TO gestionfil;

--
-- Name: fn_trg_qualite_activer_non_vide(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_qualite_activer_non_vide() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND NOT EXISTS (SELECT 1 FROM recette WHERE code_qualite = NEW.code_qualite AND actif = 1) THEN
        RAISE EXCEPTION 'Une qualite sans ligne de composition ne peut pas etre mise en service.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_qualite_activer_non_vide() OWNER TO gestionfil;

--
-- Name: fn_trg_qualite_activer_roles(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_qualite_activer_roles() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
      AND NOT EXISTS (SELECT 1 FROM ligne_qualite lq
                      WHERE lq.code_qualite = NEW.code_qualite
                        AND lq.code_role = r.code_role
                        AND lq.actif = 1)) THEN
        RAISE EXCEPTION 'Role BOM sans densite definie sur la qualite : le MRP calculerait un besoin nul en silence.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_qualite_activer_roles() OWNER TO gestionfil;

--
-- Name: fn_trg_qualite_activer_somme(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_qualite_activer_somme() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut = 'ACTIF' AND OLD.statut <> 'ACTIF'
 AND EXISTS (
    SELECT 1 FROM recette r
    WHERE r.code_qualite = NEW.code_qualite AND r.actif = 1
    GROUP BY r.code_role
    HAVING abs(SUM(r.pourcentage_composition) - 100.0) > 0.5) THEN
        RAISE EXCEPTION 'R07 : la somme des pourcentages de composition doit valoir 100%% pour chaque role BOM.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_qualite_activer_somme() OWNER TO gestionfil;

--
-- Name: fn_trg_reception_locale_hors_import(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_reception_locale_hors_import() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_dossier text;
BEGIN
    IF NEW.id_ligne_bc IS NOT NULL THEN
        SELECT d.numero INTO v_dossier
          FROM import_facture_lignes fl
          JOIN import_factures f ON f.id_facture = fl.id_facture
          JOIN import_dossiers d ON d.id_dossier = f.id_dossier
         WHERE fl.id_ligne_bc = NEW.id_ligne_bc
         LIMIT 1;
        IF v_dossier IS NOT NULL THEN
            RAISE EXCEPTION 'ETANCHEITE : cette ligne de bon (%) est servie par le dossier d''import % : elle se recoit par la reception d''import, pas en reception locale.',
                NEW.code_reference, v_dossier USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_reception_locale_hors_import() OWNER TO gestionfil;

--
-- Name: fn_trg_reception_sod_acheteur(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_reception_sod_acheteur() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut = 'VALIDE'
 AND NEW.id_utilisateur_controle IS NOT NULL
 AND NEW.id_utilisateur_controle = (SELECT id_utilisateur_creation FROM bon_commande WHERE id_bc = NEW.id_bc) THEN
        RAISE EXCEPTION 'B4 regle 2 : le createur du bon de commande ne peut pas controler sa propre reception.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_reception_sod_acheteur() OWNER TO gestionfil;

--
-- Name: fn_trg_recette_verrou_plan_d(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_recette_verrou_plan_d() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = OLD.code_qualite AND pp.statut = 'EN_COURS') THEN
        RAISE EXCEPTION 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.';
    END IF;
    RETURN OLD;
END;
$$;


ALTER FUNCTION public.fn_trg_recette_verrou_plan_d() OWNER TO gestionfil;

--
-- Name: fn_trg_recette_verrou_plan_i(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_recette_verrou_plan_i() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = NEW.code_qualite AND pp.statut = 'EN_COURS') THEN
        RAISE EXCEPTION 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_recette_verrou_plan_i() OWNER TO gestionfil;

--
-- Name: fn_trg_recette_verrou_plan_u(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_recette_verrou_plan_u() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM plan_qualite pq
             JOIN plan_production pp ON pp.id_plan = pq.id_plan
             WHERE pq.code_qualite = OLD.code_qualite AND pp.statut = 'EN_COURS') THEN
        RAISE EXCEPTION 'Composition verrouillee : cette qualite est produite par le plan en service. Creer une nouvelle qualite pour changer la composition.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_recette_verrou_plan_u() OWNER TO gestionfil;

--
-- Name: fn_trg_reference_cmup(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_reference_cmup() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM fn_cmup_suivre_catalogue(NEW.code_reference);
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_reference_cmup() OWNER TO gestionfil;

--
-- Name: fn_trg_taux_change_chevauchement(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_taux_change_chevauchement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
    SELECT 1 FROM taux_change t
    WHERE t.code_devise = NEW.code_devise
      AND NEW.date_debut < COALESCE(t.date_fin, '9999-12-31')
      AND COALESCE(NEW.date_fin, '9999-12-31') > t.date_debut) THEN
        RAISE EXCEPTION 'RG-09 : periodes de taux de change chevauchantes pour cette devise.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_taux_change_chevauchement() OWNER TO gestionfil;

--
-- Name: fn_trg_taux_cmup(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_taux_cmup() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE r record;
BEGIN
    FOR r IN SELECT code_reference FROM reference WHERE code_devise_catalogue = NEW.code_devise
    LOOP
        PERFORM fn_cmup_suivre_catalogue(r.code_reference);
    END LOOP;
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.fn_trg_taux_cmup() OWNER TO gestionfil;

--
-- Name: fn_trg_taux_pivot(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_taux_pivot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (SELECT est_pivot FROM devise WHERE code_devise = NEW.code_devise) = 1
 AND NEW.taux <> 1.0 THEN
        RAISE EXCEPTION 'La devise pivot doit avoir un taux de 1.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_taux_pivot() OWNER TO gestionfil;

--
-- Name: fn_trg_transition_bc(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_transition_bc() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'bon_commande' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur le bon de commande.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_transition_bc() OWNER TO gestionfil;

--
-- Name: fn_trg_transition_inventaire(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_transition_inventaire() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'inventaire' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur l''''inventaire.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_transition_inventaire() OWNER TO gestionfil;

--
-- Name: fn_trg_transition_plan(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_transition_plan() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'plan_production' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur le plan de production.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_transition_plan() OWNER TO gestionfil;

--
-- Name: fn_trg_transition_qualite(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_transition_qualite() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'qualite' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur la qualite.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_transition_qualite() OWNER TO gestionfil;

--
-- Name: fn_trg_transition_reception(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_transition_reception() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'reception' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur la reception.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_transition_reception() OWNER TO gestionfil;

--
-- Name: fn_trg_transition_transfert(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_transition_transfert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.statut <> NEW.statut
 AND NOT EXISTS (SELECT 1 FROM transition_statut
                 WHERE entite = 'transfert' AND statut_source = OLD.statut AND statut_cible = NEW.statut) THEN
        RAISE EXCEPTION 'Transition de statut interdite sur le transfert.';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_transition_transfert() OWNER TO gestionfil;

--
-- Name: fn_trg_utilisateur_mdp_change(); Type: FUNCTION; Schema: public; Owner: gestionfil
--

CREATE FUNCTION public.fn_trg_utilisateur_mdp_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.mot_de_passe_hash IS DISTINCT FROM OLD.mot_de_passe_hash THEN
        NEW.mot_de_passe_change_le := floor(extract(epoch FROM clock_timestamp()))::bigint;
    END IF;
    -- Un nouveau secret repart d'un compteur vierge.
    IF NEW.secret_totp IS DISTINCT FROM OLD.secret_totp THEN
        NEW.totp_dernier_pas := NULL;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_trg_utilisateur_mdp_change() OWNER TO gestionfil;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _contexte_session; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public._contexte_session (
    id bigint NOT NULL,
    id_utilisateur text,
    adresse_ip text,
    session_id text,
    CONSTRAINT _contexte_session_id_check CHECK ((id = 1))
);


ALTER TABLE public._contexte_session OWNER TO gestionfil;

--
-- Name: alerte; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.alerte (
    id_alerte text DEFAULT (gen_random_uuid())::text NOT NULL,
    type_alerte text NOT NULL,
    gravite text NOT NULL,
    titre text NOT NULL,
    message text NOT NULL,
    entite_concernee text,
    id_entite text,
    code_role_destinataire text,
    date_detection text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    statut text DEFAULT 'OUVERTE'::text NOT NULL,
    id_utilisateur_acquittement text,
    date_acquittement text,
    commentaire text,
    CONSTRAINT alerte_gravite_check CHECK ((gravite = ANY (ARRAY['INFO'::text, 'ATTENTION'::text, 'CRITIQUE'::text, 'BLOQUANT'::text]))),
    CONSTRAINT alerte_statut_check CHECK ((statut = ANY (ARRAY['OUVERTE'::text, 'ACQUITTEE'::text, 'RESOLUE'::text, 'IGNOREE'::text]))),
    CONSTRAINT alerte_type_alerte_check CHECK ((type_alerte = ANY (ARRAY['RUPTURE'::text, 'STOCK_CRITIQUE'::text, 'BC_RETARD'::text, 'ECART_PESEE'::text, 'RECETTE_INVALIDE'::text, 'STOCK_DORMANT'::text, 'PEREMPTION'::text, 'MONO_SOURCE'::text])))
);


ALTER TABLE public.alerte OWNER TO gestionfil;

--
-- Name: archive_reception; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.archive_reception (
    id_archive text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_ligne_reception text NOT NULL,
    numero_reception text NOT NULL,
    code_reference text NOT NULL,
    code_fournisseur text NOT NULL,
    date_reception text NOT NULL,
    lot_fournisseur text,
    quantite_pesee_unite numeric(18,4) NOT NULL,
    unite_saisie text NOT NULL,
    quantite_stock_kg numeric(18,4) NOT NULL,
    prix_kg_devise numeric(18,4) NOT NULL,
    code_devise text NOT NULL,
    taux_change numeric(9,4) NOT NULL,
    prix_kg_mad numeric(18,4) NOT NULL,
    total_mad numeric(18,2) NOT NULL,
    code_magasin_dest text NOT NULL,
    statut_qualite text NOT NULL,
    ecart_pct numeric(9,4),
    conformite_specifications bigint,
    conformite_quantite bigint,
    conformite_delai bigint,
    jours_retard bigint,
    documents_attaches text,
    photos text,
    date_archive text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur_archive text,
    version smallint DEFAULT 1 NOT NULL,
    CONSTRAINT archive_reception_conformite_delai_check CHECK (((conformite_delai IS NULL) OR (conformite_delai = ANY (ARRAY[(0)::bigint, (1)::bigint])))),
    CONSTRAINT archive_reception_conformite_quantite_check CHECK (((conformite_quantite IS NULL) OR (conformite_quantite = ANY (ARRAY[(0)::bigint, (1)::bigint])))),
    CONSTRAINT archive_reception_conformite_specifications_check CHECK (((conformite_specifications IS NULL) OR (conformite_specifications = ANY (ARRAY[(0)::bigint, (1)::bigint])))),
    CONSTRAINT archive_reception_documents_attaches_check CHECK (((documents_attaches IS NULL) OR ((documents_attaches)::jsonb IS NOT NULL))),
    CONSTRAINT archive_reception_photos_check CHECK (((photos IS NULL) OR ((photos)::jsonb IS NOT NULL)))
);


ALTER TABLE public.archive_reception OWNER TO gestionfil;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.audit_log (
    id_audit text DEFAULT (gen_random_uuid())::text NOT NULL,
    table_concernee text NOT NULL,
    operation text NOT NULL,
    id_enregistrement text NOT NULL,
    anciennes_valeurs text,
    nouvelles_valeurs text,
    date_operation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur text,
    adresse_ip text,
    session_id text,
    CONSTRAINT audit_log_anciennes_valeurs_check CHECK (((anciennes_valeurs IS NULL) OR ((anciennes_valeurs)::jsonb IS NOT NULL))),
    CONSTRAINT audit_log_nouvelles_valeurs_check CHECK (((nouvelles_valeurs IS NULL) OR ((nouvelles_valeurs)::jsonb IS NOT NULL))),
    CONSTRAINT audit_log_operation_check CHECK ((operation = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text, 'DEVALIDATION'::text, 'CONTREPASSATION'::text])))
);


ALTER TABLE public.audit_log OWNER TO gestionfil;

--
-- Name: besoin_mrp; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.besoin_mrp (
    id_besoin text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_plan text NOT NULL,
    mois bigint NOT NULL,
    rang_mois bigint NOT NULL,
    annee_mois text NOT NULL,
    code_reference text NOT NULL,
    quantite_brute_kg numeric(18,4) NOT NULL,
    taux_perte_applique numeric(9,4) DEFAULT 0 NOT NULL,
    quantite_kg numeric(18,4) NOT NULL,
    date_calcul text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    date_reference text NOT NULL,
    CONSTRAINT besoin_mrp_mois_check CHECK (((mois >= 1) AND (mois <= 12))),
    CONSTRAINT besoin_mrp_quantite_brute_kg_check CHECK ((quantite_brute_kg >= (0)::numeric)),
    CONSTRAINT besoin_mrp_quantite_kg_check CHECK ((quantite_kg >= (0)::numeric)),
    CONSTRAINT besoin_mrp_rang_mois_check CHECK ((rang_mois >= 0)),
    CONSTRAINT besoin_mrp_taux_perte_applique_check CHECK ((taux_perte_applique >= (0)::numeric))
);


ALTER TABLE public.besoin_mrp OWNER TO gestionfil;

--
-- Name: bon_commande; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.bon_commande (
    id_bc text DEFAULT (gen_random_uuid())::text NOT NULL,
    numero_bc text NOT NULL,
    date_bc text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    code_fournisseur text NOT NULL,
    code_devise text NOT NULL,
    taux_change_engage numeric(9,4) NOT NULL,
    date_taux_engage text,
    montant_total_devise numeric(18,2),
    montant_total_mad numeric(18,2),
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    motif_creation text DEFAULT 'MRP'::text NOT NULL,
    date_envoi text,
    date_livraison_prevue text,
    conditions_paiement text,
    notes text,
    id_utilisateur_creation text NOT NULL,
    id_utilisateur_validation text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    date_validation text,
    nombre_conteneurs bigint,
    mention_expedition text,
    CONSTRAINT bon_commande_check1 CHECK (((statut = ANY (ARRAY['BROUILLON'::text, 'EN_ATTENTE_VALIDATION'::text, 'ANNULE'::text])) OR ((id_utilisateur_validation IS NOT NULL) AND (date_validation IS NOT NULL)))),
    CONSTRAINT bon_commande_montant_total_devise_check CHECK (((montant_total_devise IS NULL) OR (montant_total_devise >= (0)::numeric))),
    CONSTRAINT bon_commande_montant_total_mad_check CHECK (((montant_total_mad IS NULL) OR (montant_total_mad >= (0)::numeric))),
    CONSTRAINT bon_commande_motif_creation_check CHECK ((motif_creation = ANY (ARRAY['MRP'::text, 'OPPORTUNITE_PRIX'::text, 'ANTICIPATION_RISQUE'::text, 'MANUEL'::text]))),
    CONSTRAINT bon_commande_nombre_conteneurs_check CHECK (((nombre_conteneurs IS NULL) OR (nombre_conteneurs > 0))),
    CONSTRAINT bon_commande_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'EN_ATTENTE_VALIDATION'::text, 'VALIDE'::text, 'ENVOYE'::text, 'LIVRE_PARTIEL'::text, 'CLOTURE'::text, 'ANNULE'::text]))),
    CONSTRAINT bon_commande_taux_change_engage_check CHECK ((taux_change_engage > (0)::numeric))
);


ALTER TABLE public.bon_commande OWNER TO gestionfil;

--
-- Name: categorie_matiere; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.categorie_matiere (
    code_categorie text NOT NULL,
    libelle text NOT NULL,
    description text,
    code_role_defaut text,
    ordre_affichage bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT categorie_matiere_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.categorie_matiere OWNER TO gestionfil;

--
-- Name: champ_configurable; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.champ_configurable (
    module text NOT NULL,
    champ text NOT NULL,
    libelle text NOT NULL,
    niveau_defaut text DEFAULT 'LECTURE'::text NOT NULL,
    sensible bigint DEFAULT 0 NOT NULL,
    ordre bigint DEFAULT 0 NOT NULL,
    CONSTRAINT champ_configurable_niveau_defaut_check CHECK ((niveau_defaut = ANY (ARRAY['MASQUE'::text, 'LECTURE'::text, 'ECRITURE'::text]))),
    CONSTRAINT champ_configurable_sensible_check CHECK ((sensible = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.champ_configurable OWNER TO gestionfil;

--
-- Name: cockpit_kpi; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.cockpit_kpi (
    id_kpi text DEFAULT (gen_random_uuid())::text NOT NULL,
    periode text NOT NULL,
    indicateur text NOT NULL,
    valeur numeric(18,2) NOT NULL,
    cible numeric(18,4),
    seuil_alerte numeric(12,4),
    tendance text,
    date_calcul text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT cockpit_kpi_tendance_check CHECK (((tendance IS NULL) OR (tendance = ANY (ARRAY['HAUSSE'::text, 'BAISSE'::text, 'STABLE'::text]))))
);


ALTER TABLE public.cockpit_kpi OWNER TO gestionfil;

--
-- Name: conditionnement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.conditionnement (
    code_conditionnement text NOT NULL,
    libelle text NOT NULL,
    unite_singulier text NOT NULL,
    unite_pluriel text NOT NULL,
    se_compte integer DEFAULT 1 NOT NULL,
    contenance_litres numeric(10,2),
    ordre_affichage integer DEFAULT 0 NOT NULL,
    actif integer DEFAULT 1 NOT NULL,
    description text,
    CONSTRAINT conditionnement_actif_check CHECK ((actif = ANY (ARRAY[0, 1]))),
    CONSTRAINT conditionnement_se_compte_check CHECK ((se_compte = ANY (ARRAY[0, 1])))
);


ALTER TABLE public.conditionnement OWNER TO gestionfil;

--
-- Name: TABLE conditionnement; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON TABLE public.conditionnement IS 'Ce dans quoi une matiere arrive et se compte. Le catalogue supposait la bobine
 partout ; la colle vient en cuves de 1000 L, la Bande en centaines de petits
 rouleaux par palette, les plastiques en rouleaux ou en conteneur.';


--
-- Name: contact_fournisseur; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.contact_fournisseur (
    id_contact text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_fournisseur text NOT NULL,
    nom text NOT NULL,
    fonction text,
    email text,
    telephone text,
    est_principal bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT contact_fournisseur_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT contact_fournisseur_est_principal_check CHECK ((est_principal = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.contact_fournisseur OWNER TO gestionfil;

--
-- Name: couleur; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.couleur (
    code_couleur_interne text NOT NULL,
    libelle text NOT NULL,
    classe_teinture text,
    description text,
    ordre_affichage bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT couleur_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT couleur_classe_teinture_check CHECK (((classe_teinture IS NULL) OR (classe_teinture = ANY (ARRAY['LIGHT'::text, 'MEDIUM'::text, 'DARK'::text, 'RED'::text]))))
);


ALTER TABLE public.couleur OWNER TO gestionfil;

--
-- Name: couleur_fournisseur; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.couleur_fournisseur (
    id_couleur_fournisseur text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_couleur_interne text NOT NULL,
    code_fournisseur text NOT NULL,
    code_couleur text NOT NULL,
    libelle text,
    supplement_teinture numeric(18,4),
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT couleur_fournisseur_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT couleur_fournisseur_supplement_teinture_check CHECK (((supplement_teinture IS NULL) OR (supplement_teinture >= (0)::numeric)))
);


ALTER TABLE public.couleur_fournisseur OWNER TO gestionfil;

--
-- Name: cours_bam; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.cours_bam (
    code_devise text NOT NULL,
    date_cours text NOT NULL,
    cours_mad numeric(12,4) NOT NULL,
    date_lecture text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT cours_bam_cours_mad_check CHECK ((cours_mad > (0)::numeric)),
    CONSTRAINT cours_bam_date_cours_check CHECK ((date_cours ~ '^\d{4}-\d{2}-\d{2}$'::text))
);


ALTER TABLE public.cours_bam OWNER TO gestionfil;

--
-- Name: demande_autorisation; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.demande_autorisation (
    id_demande text DEFAULT (gen_random_uuid())::text NOT NULL,
    type_demande text NOT NULL,
    niveau text DEFAULT 'ROUGE'::text NOT NULL,
    statut text DEFAULT 'EN_ATTENTE'::text NOT NULL,
    code_reference text,
    lot_fournisseur text,
    document text,
    details jsonb,
    motif text NOT NULL,
    id_demandeur text NOT NULL,
    date_demande text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_decideur text,
    date_decision text,
    motif_decision text,
    date_consommation text,
    CONSTRAINT demande_autorisation_check CHECK (((statut = ANY (ARRAY['EN_ATTENTE'::text, 'ANNULEE'::text])) OR ((id_decideur IS NOT NULL) AND (date_decision IS NOT NULL)))),
    CONSTRAINT demande_autorisation_motif_check CHECK ((btrim(motif) <> ''::text)),
    CONSTRAINT demande_autorisation_niveau_check CHECK ((niveau = ANY (ARRAY['ORANGE'::text, 'ROUGE'::text]))),
    CONSTRAINT demande_autorisation_statut_check CHECK ((statut = ANY (ARRAY['EN_ATTENTE'::text, 'ACCORDEE'::text, 'REFUSEE'::text, 'ANNULEE'::text]))),
    CONSTRAINT demande_autorisation_type_demande_check CHECK ((type_demande = ANY (ARRAY['ECART_POIDS'::text, 'MELANGE_FOURNISSEURS'::text, 'LOT_BLOQUE'::text, 'RESTES_PRODUCTION'::text, 'RETOUR_PRINCIPAL'::text, 'DORMANT'::text, 'FUSION'::text, 'STOCK_INSUFFISANT'::text])))
);


ALTER TABLE public.demande_autorisation OWNER TO gestionfil;

--
-- Name: devise; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.devise (
    code_devise text NOT NULL,
    libelle text NOT NULL,
    symbole text,
    est_pivot bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT devise_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT devise_code_devise_check CHECK ((length(code_devise) = 3)),
    CONSTRAINT devise_est_pivot_check CHECK ((est_pivot = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.devise OWNER TO gestionfil;

--
-- Name: dossier_lignes_frais; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.dossier_lignes_frais (
    id_ligne_frais text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_dossier text NOT NULL,
    id_frais text NOT NULL,
    libelle text,
    numero_piece text,
    montant_devise numeric(18,2) NOT NULL,
    code_devise text NOT NULL,
    cours_change numeric(9,4) NOT NULL,
    montant_dhs numeric(18,2) GENERATED ALWAYS AS (round((montant_devise * cours_change), 2)) STORED,
    id_utilisateur_creation text NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT dossier_lignes_frais_cours_change_check CHECK ((cours_change > (0)::numeric)),
    CONSTRAINT dossier_lignes_frais_montant_devise_check CHECK ((montant_devise > (0)::numeric))
);


ALTER TABLE public.dossier_lignes_frais OWNER TO gestionfil;

--
-- Name: dossier_lignes_frais_cibles; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.dossier_lignes_frais_cibles (
    id_ligne_frais text NOT NULL,
    id_ligne text NOT NULL
);


ALTER TABLE public.dossier_lignes_frais_cibles OWNER TO gestionfil;

--
-- Name: droit_champ; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.droit_champ (
    id_utilisateur text NOT NULL,
    module text NOT NULL,
    champ text NOT NULL,
    niveau text NOT NULL,
    date_modification text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur_modif text,
    CONSTRAINT droit_champ_niveau_check CHECK ((niveau = ANY (ARRAY['MASQUE'::text, 'LECTURE'::text, 'ECRITURE'::text])))
);


ALTER TABLE public.droit_champ OWNER TO gestionfil;

--
-- Name: entreprise; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.entreprise (
    id_entreprise text DEFAULT (gen_random_uuid())::text NOT NULL,
    nom text NOT NULL,
    groupe text,
    adresse text,
    telephone text,
    fax text,
    banques text,
    ice text,
    rc text,
    identifiant_fiscal text,
    tp text,
    cnss text,
    capital numeric(18,2),
    dirigeant text,
    logo_url text,
    devise_base text DEFAULT 'MAD'::text NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT entreprise_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.entreprise OWNER TO gestionfil;

--
-- Name: famille; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.famille (
    code_famille text NOT NULL,
    libelle text NOT NULL,
    code_categorie text,
    type_fil text,
    titrage text,
    description text,
    ordre_affichage bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT famille_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.famille OWNER TO gestionfil;

--
-- Name: fournisseur; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.fournisseur (
    code_fournisseur text NOT NULL,
    nom text NOT NULL,
    contact_principal text,
    telephone text,
    email text,
    adresse text,
    ville text,
    pays text DEFAULT 'Maroc'::text NOT NULL,
    delai_livraison_jours bigint,
    conditions_paiement text,
    delai_paiement_jours bigint,
    code_devise text,
    incoterm text,
    transporteur text,
    note_globale numeric(5,2),
    delai_reel_moyen_jours numeric(12,4),
    tolerance_pesee_pct numeric(9,4),
    actif bigint DEFAULT 1 NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    palettes_par_conteneur bigint,
    couverture_commande_j bigint,
    CONSTRAINT fournisseur_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT fournisseur_delai_livraison_jours_check CHECK (((delai_livraison_jours IS NULL) OR (delai_livraison_jours > 0))),
    CONSTRAINT fournisseur_note_globale_check CHECK (((note_globale IS NULL) OR ((note_globale >= (0)::numeric) AND (note_globale <= (100)::numeric)))),
    CONSTRAINT fournisseur_palettes_par_conteneur_check CHECK (((palettes_par_conteneur IS NULL) OR (palettes_par_conteneur > 0))),
    CONSTRAINT fournisseur_tolerance_pesee_pct_check CHECK (((tolerance_pesee_pct IS NULL) OR (tolerance_pesee_pct >= (0)::numeric)))
);


ALTER TABLE public.fournisseur OWNER TO gestionfil;

--
-- Name: COLUMN fournisseur.couverture_commande_j; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.fournisseur.couverture_commande_j IS 'Duree qu''une commande doit couvrir une fois livree, en jours. Vide = P_MargeJours.';


--
-- Name: frais_approche; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.frais_approche (
    id_frais text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_reception text NOT NULL,
    type_frais text NOT NULL,
    libelle text,
    montant_devise numeric(14,4) NOT NULL,
    code_devise text NOT NULL,
    taux_change numeric(14,6) NOT NULL,
    montant_mad numeric(14,4) GENERATED ALWAYS AS ((montant_devise * taux_change)) STORED,
    cle_repartition text DEFAULT 'POIDS'::text NOT NULL,
    reference_externe text,
    date_frais text DEFAULT to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) NOT NULL,
    id_utilisateur text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    notes text,
    CONSTRAINT frais_approche_cle_repartition_check CHECK ((cle_repartition = ANY (ARRAY['POIDS'::text, 'VALEUR'::text, 'LIGNES'::text]))),
    CONSTRAINT frais_approche_montant_devise_check CHECK ((montant_devise >= (0)::numeric)),
    CONSTRAINT frais_approche_taux_change_check CHECK ((taux_change > (0)::numeric)),
    CONSTRAINT frais_approche_type_frais_check CHECK ((type_frais = ANY (ARRAY['FRET'::text, 'DOUANE'::text, 'ASSURANCE'::text, 'MANUTENTION'::text, 'AUTRE'::text])))
);


ALTER TABLE public.frais_approche OWNER TO gestionfil;

--
-- Name: groupe_equiv; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.groupe_equiv (
    code_groupe_equiv text NOT NULL,
    libelle text NOT NULL,
    description text,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT groupe_equiv_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.groupe_equiv OWNER TO gestionfil;

--
-- Name: historique_conditionnement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.historique_conditionnement (
    id_historique text DEFAULT (gen_random_uuid())::text NOT NULL,
    date_evenement text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    source text NOT NULL,
    id_document text NOT NULL,
    numero_document text,
    code_reference text NOT NULL,
    code_fournisseur text,
    kg numeric(18,4) NOT NULL,
    nb_bobines bigint,
    nb_palettes numeric(18,2),
    poids_bobine_avant numeric(18,4),
    poids_bobine_mesure numeric(18,4),
    bobines_palette_avant bigint,
    bobines_palette_observe bigint,
    prix_kg_devise numeric(18,6),
    code_devise text,
    prix_kg_mad numeric(18,6),
    poids_applique bigint DEFAULT 0 NOT NULL,
    colisage_applique bigint DEFAULT 0 NOT NULL,
    id_utilisateur text,
    CONSTRAINT historique_conditionnement_colisage_applique_check CHECK ((colisage_applique = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT historique_conditionnement_poids_applique_check CHECK ((poids_applique = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT historique_conditionnement_source_check CHECK ((source = ANY (ARRAY['RECEPTION'::text, 'IMPORT'::text])))
);


ALTER TABLE public.historique_conditionnement OWNER TO gestionfil;

--
-- Name: historique_prix; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.historique_prix (
    id_histo_prix text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_ligne_reception text NOT NULL,
    code_reference text NOT NULL,
    code_fournisseur text NOT NULL,
    date_achat text NOT NULL,
    prix_kg_devise numeric(18,4) NOT NULL,
    code_devise text NOT NULL,
    taux_change numeric(9,4) NOT NULL,
    prix_kg_mad numeric(18,4) NOT NULL,
    quantite_achetee_kg numeric(18,4) NOT NULL,
    total_mad numeric(18,2) NOT NULL,
    conditions text,
    date_enregistrement text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT historique_prix_check CHECK ((abs((prix_kg_mad - (prix_kg_devise * taux_change))) < 0.01)),
    CONSTRAINT historique_prix_check1 CHECK ((abs((total_mad - (prix_kg_mad * quantite_achetee_kg))) < 0.05)),
    CONSTRAINT historique_prix_prix_kg_devise_check CHECK ((prix_kg_devise > (0)::numeric)),
    CONSTRAINT historique_prix_prix_kg_mad_check CHECK ((prix_kg_mad > (0)::numeric)),
    CONSTRAINT historique_prix_quantite_achetee_kg_check CHECK ((quantite_achetee_kg > (0)::numeric)),
    CONSTRAINT historique_prix_taux_change_check CHECK ((taux_change > (0)::numeric)),
    CONSTRAINT historique_prix_total_mad_check CHECK ((total_mad > (0)::numeric))
);


ALTER TABLE public.historique_prix OWNER TO gestionfil;

--
-- Name: import_ajustements_cump; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.import_ajustements_cump (
    id_ajustement text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_dossier text NOT NULL,
    code_reference text NOT NULL,
    nature text NOT NULL,
    code_magasin text,
    quantite_recue_kg numeric(18,4) NOT NULL,
    stock_kg numeric(18,4) NOT NULL,
    cump_avant numeric(18,4),
    cump_apres numeric(18,4),
    montant_dhs numeric(18,2) NOT NULL,
    date_ajustement text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur text NOT NULL,
    CONSTRAINT import_ajustements_cump_check CHECK ((((nature = 'STOCK'::text) AND (code_magasin IS NOT NULL) AND (cump_apres IS NOT NULL)) OR ((nature = 'CONSOMME'::text) AND (code_magasin IS NULL)))),
    CONSTRAINT import_ajustements_cump_nature_check CHECK ((nature = ANY (ARRAY['STOCK'::text, 'CONSOMME'::text]))),
    CONSTRAINT import_ajustements_cump_quantite_recue_kg_check CHECK ((quantite_recue_kg >= (0)::numeric)),
    CONSTRAINT import_ajustements_cump_stock_kg_check CHECK ((stock_kg >= (0)::numeric))
);


ALTER TABLE public.import_ajustements_cump OWNER TO gestionfil;

--
-- Name: import_dossiers; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.import_dossiers (
    id_dossier text DEFAULT (gen_random_uuid())::text NOT NULL,
    numero text NOT NULL,
    numero_bl text,
    conteneurs text,
    code_devise text NOT NULL,
    taux_change numeric(9,4) NOT NULL,
    date_arrivee text,
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    notes text,
    id_utilisateur_creation text NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur_cloture text,
    date_cloture text,
    numero_dum text,
    regime_douanier text DEFAULT '010'::text NOT NULL,
    date_dum text,
    CONSTRAINT import_dossiers_check CHECK (((statut <> 'CLOTURE'::text) OR ((id_utilisateur_cloture IS NOT NULL) AND (date_cloture IS NOT NULL)))),
    CONSTRAINT import_dossiers_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'EN_COURS'::text, 'CLOTURE'::text]))),
    CONSTRAINT import_dossiers_taux_change_check CHECK ((taux_change > (0)::numeric))
);


ALTER TABLE public.import_dossiers OWNER TO gestionfil;

--
-- Name: import_engagements; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.import_engagements (
    id_engagement text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_dossier text NOT NULL,
    numero_ei text NOT NULL,
    banque text,
    date_ei text,
    quantite_kg numeric(18,2),
    montant_devise numeric(18,2),
    code_devise text,
    notes text,
    id_utilisateur_creation text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    code_fournisseur text,
    CONSTRAINT import_engagements_montant_devise_check CHECK (((montant_devise IS NULL) OR (montant_devise >= (0)::numeric))),
    CONSTRAINT import_engagements_numero_ei_check CHECK ((btrim(numero_ei) <> ''::text)),
    CONSTRAINT import_engagements_quantite_kg_check CHECK (((quantite_kg IS NULL) OR (quantite_kg >= (0)::numeric)))
);


ALTER TABLE public.import_engagements OWNER TO gestionfil;

--
-- Name: TABLE import_engagements; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON TABLE public.import_engagements IS 'Engagements d''importation (EI) ouverts en banque, cites par le dossier. Reference seulement : aucun suivi de consommation.';


--
-- Name: import_facture_lignes; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.import_facture_lignes (
    id_ligne text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_facture text NOT NULL,
    ligne_numero bigint NOT NULL,
    type_ligne text DEFAULT 'ERP'::text NOT NULL,
    code_reference text,
    libelle text,
    id_ligne_bc text,
    lot_fournisseur text,
    code_couleur text,
    unite text DEFAULT 'kg'::text NOT NULL,
    quantite numeric(18,4) NOT NULL,
    poids_net_kg numeric(18,4),
    nb_bobines bigint DEFAULT 0 NOT NULL,
    nb_palettes bigint DEFAULT 0 NOT NULL,
    prix_unitaire_devise numeric(18,4) NOT NULL,
    montant_devise numeric(18,2) GENERATED ALWAYS AS (round(((quantite * prix_unitaire_devise) * ((1)::numeric - (remise_pct / (100)::numeric))), 2)) STORED,
    pct_dossier numeric(13,10),
    quantite_recue_kg numeric(18,4) DEFAULT 0 NOT NULL,
    reste_kg numeric(18,4) GENERATED ALWAYS AS (
CASE
    WHEN (type_ligne = 'ERP'::text) THEN (poids_net_kg - quantite_recue_kg)
    ELSE NULL::numeric
END) STORED,
    soldee bigint DEFAULT 0 NOT NULL,
    motif_solde text,
    libelle_couleur text,
    remise_pct numeric(5,2) DEFAULT 0 NOT NULL,
    CONSTRAINT import_facture_lignes_check CHECK ((((type_ligne = 'ERP'::text) AND (code_reference IS NOT NULL) AND (poids_net_kg IS NOT NULL)) OR ((type_ligne = 'HORS_ERP'::text) AND (code_reference IS NULL) AND (id_ligne_bc IS NULL) AND (libelle IS NOT NULL)))),
    CONSTRAINT import_facture_lignes_check1 CHECK (((unite <> 'kg'::text) OR (poids_net_kg IS NULL) OR (abs((quantite - poids_net_kg)) < 0.0005))),
    CONSTRAINT import_facture_lignes_check2 CHECK (((soldee = 0) OR (motif_solde IS NOT NULL))),
    CONSTRAINT import_facture_lignes_ligne_numero_check CHECK ((ligne_numero > 0)),
    CONSTRAINT import_facture_lignes_nb_bobines_check CHECK ((nb_bobines >= 0)),
    CONSTRAINT import_facture_lignes_nb_palettes_check CHECK ((nb_palettes >= 0)),
    CONSTRAINT import_facture_lignes_poids_net_kg_check CHECK (((poids_net_kg IS NULL) OR (poids_net_kg > (0)::numeric))),
    CONSTRAINT import_facture_lignes_prix_unitaire_devise_check CHECK ((prix_unitaire_devise > (0)::numeric)),
    CONSTRAINT import_facture_lignes_quantite_check CHECK ((quantite > (0)::numeric)),
    CONSTRAINT import_facture_lignes_quantite_recue_kg_check CHECK ((quantite_recue_kg >= (0)::numeric)),
    CONSTRAINT import_facture_lignes_remise_pct_check CHECK (((remise_pct >= (0)::numeric) AND (remise_pct < (100)::numeric))),
    CONSTRAINT import_facture_lignes_soldee_check CHECK ((soldee = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT import_facture_lignes_type_ligne_check CHECK ((type_ligne = ANY (ARRAY['ERP'::text, 'HORS_ERP'::text]))),
    CONSTRAINT import_facture_lignes_unite_check CHECK ((unite = ANY (ARRAY['kg'::text, 'ml'::text, 'piece'::text])))
);


ALTER TABLE public.import_facture_lignes OWNER TO gestionfil;

--
-- Name: COLUMN import_facture_lignes.montant_devise; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.import_facture_lignes.montant_devise IS 'Montant NET de la ligne : quantite x prix brut x (1 - remise). Il valorise le stock.';


--
-- Name: COLUMN import_facture_lignes.remise_pct; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.import_facture_lignes.remise_pct IS 'Remise consentie par le fournisseur, en % du prix brut facture.';


--
-- Name: import_factures; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.import_factures (
    id_facture text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_dossier text NOT NULL,
    code_fournisseur text NOT NULL,
    numero_facture text NOT NULL,
    date_facture text NOT NULL,
    code_devise text NOT NULL,
    taux_change numeric(9,4) NOT NULL,
    montant_devise numeric(18,2),
    nb_palettes bigint,
    nb_bobines bigint,
    statut_reception text DEFAULT 'NON_RECUE'::text NOT NULL,
    id_utilisateur_creation text NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_engagement text,
    CONSTRAINT import_factures_montant_devise_check CHECK (((montant_devise IS NULL) OR (montant_devise >= (0)::numeric))),
    CONSTRAINT import_factures_nb_bobines_check CHECK (((nb_bobines IS NULL) OR (nb_bobines >= 0))),
    CONSTRAINT import_factures_nb_palettes_check CHECK (((nb_palettes IS NULL) OR (nb_palettes >= 0))),
    CONSTRAINT import_factures_statut_reception_check CHECK ((statut_reception = ANY (ARRAY['NON_RECUE'::text, 'PARTIELLE'::text, 'RECUE'::text]))),
    CONSTRAINT import_factures_taux_change_check CHECK ((taux_change > (0)::numeric))
);


ALTER TABLE public.import_factures OWNER TO gestionfil;

--
-- Name: import_reception_lignes; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.import_reception_lignes (
    id_reception_ligne text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_reception text NOT NULL,
    id_ligne text NOT NULL,
    quantite_recue_kg numeric(18,4) NOT NULL,
    quantite_attendue_kg numeric(18,4),
    ecart_kg numeric(18,4) GENERATED ALWAYS AS ((quantite_recue_kg - quantite_attendue_kg)) STORED,
    nb_bobines bigint DEFAULT 0 NOT NULL,
    nb_palettes bigint DEFAULT 0 NOT NULL,
    lot_fournisseur text,
    code_couleur text,
    code_magasin text NOT NULL,
    id_mouvement text,
    libelle_couleur text,
    statut_qualite text DEFAULT 'CONFORME'::text NOT NULL,
    derogation_ecart smallint DEFAULT 0 NOT NULL,
    motif_derogation text,
    id_utilisateur_derogation text,
    CONSTRAINT ck_irl_derogation CHECK (((derogation_ecart = ANY (ARRAY[0, 1])) AND ((derogation_ecart = 0) OR (length(btrim(COALESCE(motif_derogation, ''::text))) >= 5)))),
    CONSTRAINT import_reception_lignes_nb_bobines_check CHECK ((nb_bobines >= 0)),
    CONSTRAINT import_reception_lignes_nb_palettes_check CHECK ((nb_palettes >= 0)),
    CONSTRAINT import_reception_lignes_quantite_attendue_kg_check CHECK (((quantite_attendue_kg IS NULL) OR (quantite_attendue_kg >= (0)::numeric))),
    CONSTRAINT import_reception_lignes_quantite_recue_kg_check CHECK ((quantite_recue_kg > (0)::numeric)),
    CONSTRAINT import_reception_lignes_statut_qualite_check CHECK ((statut_qualite = ANY (ARRAY['CONFORME'::text, 'NON_CONFORME'::text, 'QUARANTAINE'::text])))
);


ALTER TABLE public.import_reception_lignes OWNER TO gestionfil;

--
-- Name: import_receptions; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.import_receptions (
    id_reception text DEFAULT (gen_random_uuid())::text NOT NULL,
    numero text NOT NULL,
    date_reception text NOT NULL,
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    litige bigint DEFAULT 0 NOT NULL,
    motif_litige text,
    notes text,
    id_utilisateur_creation text NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur_validation text,
    date_validation text,
    CONSTRAINT import_receptions_check CHECK (((litige = 0) OR (motif_litige IS NOT NULL))),
    CONSTRAINT import_receptions_check1 CHECK (((statut <> 'VALIDEE'::text) OR ((id_utilisateur_validation IS NOT NULL) AND (date_validation IS NOT NULL)))),
    CONSTRAINT import_receptions_litige_check CHECK ((litige = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT import_receptions_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text, 'VALIDEE'::text, 'ANNULEE'::text])))
);


ALTER TABLE public.import_receptions OWNER TO gestionfil;

--
-- Name: inventaire; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.inventaire (
    id_inventaire text DEFAULT (gen_random_uuid())::text NOT NULL,
    numero_inventaire text NOT NULL,
    date_inventaire text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    type_inventaire text NOT NULL,
    code_magasin text NOT NULL,
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    id_utilisateur_responsable text NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    date_cloture text,
    motif_annulation text,
    id_utilisateur_annulation text,
    date_annulation text,
    CONSTRAINT inventaire_check CHECK (((statut <> 'CLOTURE'::text) OR (date_cloture IS NOT NULL))),
    CONSTRAINT inventaire_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'EN_COURS'::text, 'CLOTURE'::text, 'ANNULE'::text]))),
    CONSTRAINT inventaire_type_inventaire_check CHECK ((type_inventaire = ANY (ARRAY['GLOBAL'::text, 'TOURNANT'::text, 'CIBLE'::text])))
);


ALTER TABLE public.inventaire OWNER TO gestionfil;

--
-- Name: journal_connexion; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.journal_connexion (
    id_journal text DEFAULT (gen_random_uuid())::text NOT NULL,
    horodatage text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    login text NOT NULL,
    id_utilisateur text,
    resultat text NOT NULL,
    adresse_ip text,
    agent text,
    CONSTRAINT journal_connexion_resultat_check CHECK ((resultat = ANY (ARRAY['REUSSITE'::text, 'MOT_DE_PASSE'::text, 'CODE'::text, 'BLOQUE'::text, 'INACTIF'::text, 'INCONNU'::text])))
);


ALTER TABLE public.journal_connexion OWNER TO gestionfil;

--
-- Name: ligne_bc; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.ligne_bc (
    id_ligne_bc text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_bc text NOT NULL,
    ligne_numero bigint NOT NULL,
    code_reference text,
    designation text,
    unite_commande text NOT NULL,
    facteur_kg numeric(18,4) NOT NULL,
    quantite_commandee_unite numeric(18,4) NOT NULL,
    quantite_commandee_kg numeric(18,4) NOT NULL,
    quantite_recue_kg numeric(18,4) DEFAULT 0 NOT NULL,
    quantite_restante_kg numeric(18,4) GENERATED ALWAYS AS ((quantite_commandee_kg - quantite_recue_kg)) STORED,
    prix_unitaire_devise numeric(18,4) NOT NULL,
    prix_kg_devise numeric(18,4) GENERATED ALWAYS AS (((prix_unitaire_devise * ((1)::numeric - (remise_pct / (100)::numeric))) / facteur_kg)) STORED,
    code_devise text NOT NULL,
    total_ligne_devise numeric(18,2) GENERATED ALWAYS AS (((quantite_commandee_unite * prix_unitaire_devise) * ((1)::numeric - (remise_pct / (100)::numeric)))) STORED,
    date_livraison_prevue text,
    statut text DEFAULT 'EN_ATTENTE'::text NOT NULL,
    notes text,
    id_proposition text,
    besoin_kg_origine numeric(18,4),
    arbitree bigint DEFAULT 0 NOT NULL,
    type_ligne text DEFAULT 'MARCHANDISE'::text NOT NULL,
    libelle text,
    nb_palettes_saisi numeric(18,2),
    nb_bobines_saisi bigint,
    remise_pct numeric(5,2) DEFAULT 0 NOT NULL,
    CONSTRAINT ligne_bc_arbitree_check CHECK ((arbitree = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT ligne_bc_besoin_kg_origine_check CHECK (((besoin_kg_origine IS NULL) OR (besoin_kg_origine >= (0)::numeric))),
    CONSTRAINT ligne_bc_check1 CHECK ((quantite_recue_kg <= (quantite_commandee_kg + 0.001))),
    CONSTRAINT ligne_bc_conversion_coherente CHECK (((type_ligne <> 'MARCHANDISE'::text) OR (abs((quantite_commandee_kg - (quantite_commandee_unite * facteur_kg))) < 0.001))),
    CONSTRAINT ligne_bc_facteur_kg_check CHECK ((facteur_kg > (0)::numeric)),
    CONSTRAINT ligne_bc_ligne_numero_check CHECK ((ligne_numero > 0)),
    CONSTRAINT ligne_bc_nb_bobines_saisi_check CHECK (((nb_bobines_saisi IS NULL) OR (nb_bobines_saisi >= 0))),
    CONSTRAINT ligne_bc_nb_palettes_saisi_check CHECK (((nb_palettes_saisi IS NULL) OR (nb_palettes_saisi >= (0)::numeric))),
    CONSTRAINT ligne_bc_prix_unitaire_devise_check CHECK ((prix_unitaire_devise > (0)::numeric)),
    CONSTRAINT ligne_bc_quantite_commandee_kg_check CHECK ((quantite_commandee_kg >= (0)::numeric)),
    CONSTRAINT ligne_bc_quantite_commandee_unite_check CHECK ((quantite_commandee_unite > (0)::numeric)),
    CONSTRAINT ligne_bc_quantite_recue_kg_check CHECK ((quantite_recue_kg >= (0)::numeric)),
    CONSTRAINT ligne_bc_remise_pct_check CHECK (((remise_pct >= (0)::numeric) AND (remise_pct < (100)::numeric))),
    CONSTRAINT ligne_bc_statut_check CHECK ((statut = ANY (ARRAY['EN_ATTENTE'::text, 'PARTIEL'::text, 'SOLDE'::text, 'ANNULE'::text]))),
    CONSTRAINT ligne_bc_type_coherent CHECK ((((type_ligne = 'MARCHANDISE'::text) AND (code_reference IS NOT NULL) AND (quantite_commandee_kg > (0)::numeric)) OR ((type_ligne = ANY (ARRAY['LIBRE'::text, 'SERVICE'::text])) AND (code_reference IS NULL) AND (libelle IS NOT NULL) AND (btrim(libelle) <> ''::text) AND (quantite_commandee_kg = (0)::numeric) AND (facteur_kg = (1)::numeric) AND (id_proposition IS NULL) AND (besoin_kg_origine IS NULL)))),
    CONSTRAINT ligne_bc_type_ligne_check CHECK ((type_ligne = ANY (ARRAY['MARCHANDISE'::text, 'LIBRE'::text, 'SERVICE'::text]))),
    CONSTRAINT ligne_bc_unite_commande_check CHECK ((unite_commande = ANY (ARRAY['kg'::text, 'Palette'::text, 'Bobine'::text, 'ml'::text, 'Lot'::text, 'Forfait'::text, 'Unite'::text, 'Heure'::text])))
);


ALTER TABLE public.ligne_bc OWNER TO gestionfil;

--
-- Name: COLUMN ligne_bc.prix_kg_devise; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_bc.prix_kg_devise IS 'Prix au kilo NET de remise : c''est lui qui valorise l''entree en stock.';


--
-- Name: COLUMN ligne_bc.total_ligne_devise; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_bc.total_ligne_devise IS 'Montant NET de la ligne : quantite x prix brut x (1 - remise).';


--
-- Name: COLUMN ligne_bc.nb_palettes_saisi; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_bc.nb_palettes_saisi IS 'Les palettes telles que saisies. NULL : ligne anterieure, on calcule.';


--
-- Name: COLUMN ligne_bc.nb_bobines_saisi; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_bc.nb_bobines_saisi IS 'Les bobines telles que saisies. NULL : ligne anterieure, on calcule.';


--
-- Name: COLUMN ligne_bc.remise_pct; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_bc.remise_pct IS 'Remise negociee, en % du prix brut. Condition de prix de la ligne, comme dans SAP.';


--
-- Name: ligne_inventaire; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.ligne_inventaire (
    id_ligne_inv text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_inventaire text NOT NULL,
    code_reference text NOT NULL,
    code_magasin text NOT NULL,
    lot_fournisseur text,
    quantite_theorique_kg numeric(18,4) NOT NULL,
    quantite_comptee_kg numeric(18,4),
    ecart_kg numeric(18,4) GENERATED ALWAYS AS ((quantite_comptee_kg - quantite_theorique_kg)) STORED,
    ecart_pct numeric(9,4) GENERATED ALWAYS AS (
CASE
    WHEN (quantite_theorique_kg = (0)::numeric) THEN NULL::numeric
    ELSE (((quantite_comptee_kg - quantite_theorique_kg) / quantite_theorique_kg) * 100.0)
END) STORED,
    ecart_mad numeric(18,2),
    motif_ecart text,
    statut_ligne text DEFAULT 'A_TRAITER'::text NOT NULL,
    id_utilisateur_comptage text,
    date_comptage text,
    nb_bobines_theorique bigint,
    nb_bobines_comptees bigint,
    nb_palettes_comptees numeric(18,2),
    poids_unitaire_theorique_kg numeric(18,4),
    CONSTRAINT ligne_inventaire_check CHECK (((statut_ligne = 'A_TRAITER'::text) OR (quantite_comptee_kg IS NOT NULL))),
    CONSTRAINT ligne_inventaire_nb_bobines_comptees_check CHECK (((nb_bobines_comptees IS NULL) OR (nb_bobines_comptees >= 0))),
    CONSTRAINT ligne_inventaire_nb_bobines_theorique_check CHECK (((nb_bobines_theorique IS NULL) OR (nb_bobines_theorique >= 0))),
    CONSTRAINT ligne_inventaire_nb_palettes_comptees_check CHECK (((nb_palettes_comptees IS NULL) OR (nb_palettes_comptees >= (0)::numeric))),
    CONSTRAINT ligne_inventaire_poids_unitaire_theorique_kg_check CHECK (((poids_unitaire_theorique_kg IS NULL) OR (poids_unitaire_theorique_kg > (0)::numeric))),
    CONSTRAINT ligne_inventaire_quantite_comptee_kg_check CHECK (((quantite_comptee_kg IS NULL) OR (quantite_comptee_kg >= (0)::numeric))),
    CONSTRAINT ligne_inventaire_quantite_theorique_kg_check CHECK ((quantite_theorique_kg >= (0)::numeric)),
    CONSTRAINT ligne_inventaire_statut_ligne_check CHECK ((statut_ligne = ANY (ARRAY['A_TRAITER'::text, 'COMPTE'::text, 'AJUSTE'::text, 'IGNORE'::text])))
);


ALTER TABLE public.ligne_inventaire OWNER TO gestionfil;

--
-- Name: ligne_mouvement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.ligne_mouvement (
    id_ligne_mouvement text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_mouvement text NOT NULL,
    ligne_numero bigint NOT NULL,
    code_reference text NOT NULL,
    quantite_kg numeric(18,4) NOT NULL,
    prix_kg_mad numeric(18,4),
    total_mad numeric(18,2) GENERATED ALWAYS AS ((quantite_kg * COALESCE(prix_kg_mad, (0)::numeric))) STORED,
    quantite_saisie numeric(18,4),
    unite_saisie text,
    facteur_conversion numeric(18,4),
    nb_bobines bigint,
    nb_palettes numeric(18,2),
    mode_pesee text,
    poids_unitaire_theorique_kg numeric(18,4),
    poids_total_pese_kg numeric(18,4),
    pourcentage_restant numeric(6,2),
    poids_reel_moyen_bobine_kg numeric(18,4) GENERATED ALWAYS AS (
CASE
    WHEN (nb_bobines > 0) THEN (quantite_kg / (nb_bobines)::numeric)
    ELSE NULL::numeric
END) STORED,
    ecart_theorique_pct numeric(9,4) GENERATED ALWAYS AS (
CASE
    WHEN ((nb_bobines > 0) AND (poids_unitaire_theorique_kg > (0)::numeric)) THEN (((quantite_kg - ((nb_bobines)::numeric * poids_unitaire_theorique_kg)) / ((nb_bobines)::numeric * poids_unitaire_theorique_kg)) * 100.0)
    ELSE NULL::numeric
END) STORED,
    lot_fournisseur text,
    date_fabrication text,
    date_peremption text,
    code_motif_ligne text,
    numero_of text,
    statut_qualite text,
    code_couleur text,
    lot_force bigint DEFAULT 0 NOT NULL,
    motif_lot_force text,
    CONSTRAINT ck_lmvt_conversion CHECK (((COALESCE(mode_pesee, ''::text) = ANY (ARRAY['PESEE'::text, 'ESTIMATION'::text])) OR (quantite_saisie IS NULL) OR (facteur_conversion IS NULL) OR (abs((quantite_kg - (quantite_saisie * facteur_conversion))) < 0.001))),
    CONSTRAINT ck_lmvt_mode_pesee CHECK (((mode_pesee IS NULL) OR (mode_pesee = 'THEORIQUE'::text) OR ((mode_pesee = 'PESEE'::text) AND (poids_total_pese_kg IS NOT NULL) AND (pourcentage_restant IS NULL) AND (abs((quantite_kg - poids_total_pese_kg)) < 0.001)) OR ((mode_pesee = 'ESTIMATION'::text) AND (pourcentage_restant IS NOT NULL) AND (poids_total_pese_kg IS NULL) AND (nb_bobines IS NOT NULL) AND (nb_bobines > 0) AND (poids_unitaire_theorique_kg IS NOT NULL) AND (abs((quantite_kg - ((((nb_bobines)::numeric * poids_unitaire_theorique_kg) * pourcentage_restant) / 100.0))) < 0.01)))),
    CONSTRAINT ligne_mouvement_facteur_conversion_check CHECK (((facteur_conversion IS NULL) OR (facteur_conversion > (0)::numeric))),
    CONSTRAINT ligne_mouvement_ligne_numero_check CHECK ((ligne_numero > 0)),
    CONSTRAINT ligne_mouvement_lot_force_check CHECK ((lot_force = ANY (ARRAY[0, 1]))),
    CONSTRAINT ligne_mouvement_mode_pesee_check CHECK (((mode_pesee IS NULL) OR (mode_pesee = ANY (ARRAY['PESEE'::text, 'ESTIMATION'::text, 'THEORIQUE'::text])))),
    CONSTRAINT ligne_mouvement_nb_bobines_check CHECK (((nb_bobines IS NULL) OR (nb_bobines >= 0))),
    CONSTRAINT ligne_mouvement_nb_palettes_check CHECK (((nb_palettes IS NULL) OR (nb_palettes >= (0)::numeric))),
    CONSTRAINT ligne_mouvement_poids_total_pese_kg_check CHECK (((poids_total_pese_kg IS NULL) OR (poids_total_pese_kg >= (0)::numeric))),
    CONSTRAINT ligne_mouvement_poids_unitaire_theorique_kg_check CHECK (((poids_unitaire_theorique_kg IS NULL) OR (poids_unitaire_theorique_kg > (0)::numeric))),
    CONSTRAINT ligne_mouvement_pourcentage_restant_check CHECK (((pourcentage_restant IS NULL) OR ((pourcentage_restant >= (0)::numeric) AND (pourcentage_restant <= (100)::numeric)))),
    CONSTRAINT ligne_mouvement_prix_kg_mad_check CHECK (((prix_kg_mad IS NULL) OR (prix_kg_mad > (0)::numeric))),
    CONSTRAINT ligne_mouvement_quantite_kg_check CHECK ((quantite_kg > (0)::numeric)),
    CONSTRAINT ligne_mouvement_quantite_saisie_check CHECK (((quantite_saisie IS NULL) OR (quantite_saisie > (0)::numeric))),
    CONSTRAINT ligne_mouvement_statut_qualite_check CHECK (((statut_qualite IS NULL) OR (statut_qualite = ANY (ARRAY['CONFORME'::text, 'NON_CONFORME'::text, 'QUARANTAINE'::text])))),
    CONSTRAINT ligne_mouvement_unite_saisie_check CHECK (((unite_saisie IS NULL) OR (unite_saisie = ANY (ARRAY['kg'::text, 'Palette'::text, 'Bobine'::text, 'ml'::text]))))
);


ALTER TABLE public.ligne_mouvement OWNER TO gestionfil;

--
-- Name: COLUMN ligne_mouvement.lot_force; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_mouvement.lot_force IS '1 : la sortie depasse le solde connu de ce lot, et l operateur a confirme.
 Le lot sert a la tracabilite, pas au comptage — les retours de machine lui
 sont imputes au juge, donc son solde derive. Le solde du MAGASIN, lui, reste
 verifie : il n est jamais franchissable.';


--
-- Name: COLUMN ligne_mouvement.motif_lot_force; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_mouvement.motif_lot_force IS 'Pourquoi on est passe outre. Sans lui, un solde de lot force ne se
 distinguerait plus d un solde juste.';


--
-- Name: ligne_plan_production; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.ligne_plan_production (
    id_ligne_plan text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_plan text NOT NULL,
    mois bigint NOT NULL,
    rang_mois bigint NOT NULL,
    annee_mois text NOT NULL,
    code_qualite text NOT NULL,
    m2_prevus numeric(18,4) NOT NULL,
    m2_base_mensuel numeric(18,4),
    saisonnalite numeric(9,4),
    facteur_croissance numeric(18,4),
    m2_revises numeric(18,4),
    m2_realises numeric(18,4),
    notes text,
    CONSTRAINT ligne_plan_production_facteur_croissance_check CHECK (((facteur_croissance IS NULL) OR (facteur_croissance >= (0)::numeric))),
    CONSTRAINT ligne_plan_production_m2_base_mensuel_check CHECK (((m2_base_mensuel IS NULL) OR (m2_base_mensuel >= (0)::numeric))),
    CONSTRAINT ligne_plan_production_m2_prevus_check CHECK ((m2_prevus >= (0)::numeric)),
    CONSTRAINT ligne_plan_production_m2_realises_check CHECK (((m2_realises IS NULL) OR (m2_realises >= (0)::numeric))),
    CONSTRAINT ligne_plan_production_m2_revises_check CHECK (((m2_revises IS NULL) OR (m2_revises >= (0)::numeric))),
    CONSTRAINT ligne_plan_production_mois_check CHECK (((mois >= 1) AND (mois <= 12))),
    CONSTRAINT ligne_plan_production_rang_mois_check CHECK ((rang_mois >= 0)),
    CONSTRAINT ligne_plan_production_saisonnalite_check CHECK (((saisonnalite IS NULL) OR (saisonnalite >= (0)::numeric)))
);


ALTER TABLE public.ligne_plan_production OWNER TO gestionfil;

--
-- Name: ligne_qualite; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.ligne_qualite (
    id_ligne_qualite text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_qualite text NOT NULL,
    code_role text NOT NULL,
    densite numeric(18,4) NOT NULL,
    unite_densite text DEFAULT 'kg_m2'::text NOT NULL,
    entre_poids_commercial bigint DEFAULT 1 NOT NULL,
    observation text,
    ordre_affichage bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT ligne_qualite_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT ligne_qualite_check CHECK (((unite_densite = 'kg_m2'::text) OR (entre_poids_commercial = 0))),
    CONSTRAINT ligne_qualite_densite_check CHECK ((densite >= (0)::numeric)),
    CONSTRAINT ligne_qualite_entre_poids_commercial_check CHECK ((entre_poids_commercial = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT ligne_qualite_unite_densite_check CHECK ((unite_densite = ANY (ARRAY['kg_m2'::text, 'ml_m2'::text])))
);


ALTER TABLE public.ligne_qualite OWNER TO gestionfil;

--
-- Name: ligne_reception; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.ligne_reception (
    id_ligne_reception text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_reception text NOT NULL,
    id_ligne_bc text,
    ligne_numero bigint NOT NULL,
    code_reference text NOT NULL,
    designation text,
    unite_saisie text NOT NULL,
    facteur_kg numeric(18,4) NOT NULL,
    quantite_pesee_unite numeric(18,4) NOT NULL,
    quantite_stock_kg numeric(18,4) NOT NULL,
    quantite_commandee_kg numeric(18,4),
    ecart_pct numeric(9,4) GENERATED ALWAYS AS (
CASE
    WHEN ((quantite_commandee_kg IS NULL) OR (quantite_commandee_kg = (0)::numeric)) THEN NULL::numeric
    ELSE (((quantite_stock_kg - quantite_commandee_kg) / quantite_commandee_kg) * 100.0)
END) STORED,
    prix_kg_devise numeric(18,4) NOT NULL,
    code_devise text NOT NULL,
    taux_change numeric(9,4) NOT NULL,
    prix_kg_mad numeric(18,4) NOT NULL,
    total_devise numeric(18,2) GENERATED ALWAYS AS ((quantite_stock_kg * prix_kg_devise)) STORED,
    total_mad numeric(18,2) GENERATED ALWAYS AS ((quantite_stock_kg * prix_kg_mad)) STORED,
    quantite_bl_kg numeric(18,4),
    nb_colis_ligne bigint,
    lot_fournisseur text,
    date_fabrication text,
    date_peremption text,
    statut_qualite text DEFAULT 'CONFORME'::text NOT NULL,
    code_motif_ligne text,
    substitution_acceptee bigint DEFAULT 0 NOT NULL,
    motif_substitution text,
    code_magasin_dest text NOT NULL,
    id_mouvement_genere text,
    derogation_ecart bigint DEFAULT 0 NOT NULL,
    id_utilisateur_derogation text,
    motif_derogation text,
    notes text,
    nb_palettes_saisi numeric(18,2),
    nb_bobines_saisi bigint,
    CONSTRAINT ligne_reception_check CHECK ((abs((quantite_stock_kg - (quantite_pesee_unite * facteur_kg))) < 0.001)),
    CONSTRAINT ligne_reception_check1 CHECK ((abs((prix_kg_mad - (prix_kg_devise * taux_change))) < 0.01)),
    CONSTRAINT ligne_reception_check2 CHECK (((date_peremption IS NULL) OR (date_fabrication IS NULL) OR (date_peremption > date_fabrication))),
    CONSTRAINT ligne_reception_check3 CHECK (((derogation_ecart = 0) OR ((id_utilisateur_derogation IS NOT NULL) AND (motif_derogation IS NOT NULL)))),
    CONSTRAINT ligne_reception_derogation_ecart_check CHECK ((derogation_ecart = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT ligne_reception_facteur_kg_check CHECK ((facteur_kg > (0)::numeric)),
    CONSTRAINT ligne_reception_ligne_numero_check CHECK ((ligne_numero > 0)),
    CONSTRAINT ligne_reception_nb_bobines_saisi_check CHECK (((nb_bobines_saisi IS NULL) OR (nb_bobines_saisi >= 0))),
    CONSTRAINT ligne_reception_nb_colis_ligne_check CHECK (((nb_colis_ligne IS NULL) OR (nb_colis_ligne > 0))),
    CONSTRAINT ligne_reception_nb_palettes_saisi_check CHECK (((nb_palettes_saisi IS NULL) OR (nb_palettes_saisi >= (0)::numeric))),
    CONSTRAINT ligne_reception_prix_kg_devise_check CHECK ((prix_kg_devise > (0)::numeric)),
    CONSTRAINT ligne_reception_prix_kg_mad_check CHECK ((prix_kg_mad > (0)::numeric)),
    CONSTRAINT ligne_reception_quantite_bl_kg_check CHECK (((quantite_bl_kg IS NULL) OR (quantite_bl_kg >= (0)::numeric))),
    CONSTRAINT ligne_reception_quantite_commandee_kg_check CHECK (((quantite_commandee_kg IS NULL) OR (quantite_commandee_kg > (0)::numeric))),
    CONSTRAINT ligne_reception_quantite_pesee_unite_check CHECK ((quantite_pesee_unite > (0)::numeric)),
    CONSTRAINT ligne_reception_quantite_stock_kg_check CHECK ((quantite_stock_kg > (0)::numeric)),
    CONSTRAINT ligne_reception_statut_qualite_check CHECK ((statut_qualite = ANY (ARRAY['CONFORME'::text, 'NON_CONFORME'::text, 'QUARANTAINE'::text]))),
    CONSTRAINT ligne_reception_substitution_acceptee_check CHECK ((substitution_acceptee = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT ligne_reception_taux_change_check CHECK ((taux_change > (0)::numeric)),
    CONSTRAINT ligne_reception_unite_saisie_check CHECK ((unite_saisie = ANY (ARRAY['kg'::text, 'Palette'::text, 'Bobine'::text, 'ml'::text, 'Lot'::text])))
);


ALTER TABLE public.ligne_reception OWNER TO gestionfil;

--
-- Name: COLUMN ligne_reception.nb_colis_ligne; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_reception.nb_colis_ligne IS 'Les colis ANNONCES par le bon de livraison — a comparer au compte reel.';


--
-- Name: COLUMN ligne_reception.nb_palettes_saisi; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_reception.nb_palettes_saisi IS 'Les palettes COMPTEES sur le quai. NULL : ligne anterieure, on calcule.';


--
-- Name: COLUMN ligne_reception.nb_bobines_saisi; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.ligne_reception.nb_bobines_saisi IS 'Les bobines COMPTEES sur le quai. NULL : ligne anterieure, on calcule.';


--
-- Name: ligne_transfert; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.ligne_transfert (
    id_ligne_transfert text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_transfert text NOT NULL,
    ligne_numero bigint NOT NULL,
    code_reference text NOT NULL,
    quantite_kg numeric(18,4) NOT NULL,
    quantite_saisie numeric(18,4),
    unite_saisie text,
    facteur_conversion numeric(18,4),
    lot_fournisseur text,
    nb_bobines bigint,
    nb_palettes numeric(18,2),
    prix_kg_mad numeric(18,4),
    CONSTRAINT ligne_transfert_facteur_conversion_check CHECK (((facteur_conversion IS NULL) OR (facteur_conversion > (0)::numeric))),
    CONSTRAINT ligne_transfert_ligne_numero_check CHECK ((ligne_numero > 0)),
    CONSTRAINT ligne_transfert_nb_bobines_check CHECK (((nb_bobines IS NULL) OR (nb_bobines >= 0))),
    CONSTRAINT ligne_transfert_nb_palettes_check CHECK (((nb_palettes IS NULL) OR (nb_palettes >= (0)::numeric))),
    CONSTRAINT ligne_transfert_prix_kg_mad_check CHECK (((prix_kg_mad IS NULL) OR (prix_kg_mad > (0)::numeric))),
    CONSTRAINT ligne_transfert_quantite_kg_check CHECK ((quantite_kg > (0)::numeric)),
    CONSTRAINT ligne_transfert_unite_saisie_check CHECK (((unite_saisie IS NULL) OR (unite_saisie = ANY (ARRAY['kg'::text, 'Palette'::text, 'Bobine'::text, 'ml'::text]))))
);


ALTER TABLE public.ligne_transfert OWNER TO gestionfil;

--
-- Name: lignes_frais_repartition; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.lignes_frais_repartition (
    id_ligne_frais text NOT NULL,
    id_article_dossier text NOT NULL,
    pourcentage numeric(13,10) NOT NULL,
    montant_alloue_dhs numeric(18,2) NOT NULL,
    CONSTRAINT lignes_frais_repartition_montant_alloue_dhs_check CHECK ((montant_alloue_dhs >= (0)::numeric)),
    CONSTRAINT lignes_frais_repartition_pourcentage_check CHECK (((pourcentage >= (0)::numeric) AND (pourcentage <= (100)::numeric)))
);


ALTER TABLE public.lignes_frais_repartition OWNER TO gestionfil;

--
-- Name: lot; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.lot (
    code_reference text NOT NULL,
    lot_fournisseur text NOT NULL,
    origine text DEFAULT 'FOURNISSEUR'::text NOT NULL,
    code_fournisseur text,
    statut text DEFAULT 'LIBRE'::text NOT NULL,
    categorie text DEFAULT 'PROJET'::text NOT NULL,
    fusionne_dans text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    date_derniere_activite text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT lot_categorie_check CHECK ((categorie = ANY (ARRAY['PROJET'::text, 'RESTES'::text]))),
    CONSTRAINT lot_lot_fournisseur_check CHECK ((btrim(lot_fournisseur) <> ''::text)),
    CONSTRAINT lot_origine_check CHECK ((origine = ANY (ARRAY['FOURNISSEUR'::text, 'GENERE'::text, 'RETOUR'::text, 'FUSION'::text, 'SANS_LOT'::text]))),
    CONSTRAINT lot_statut_check CHECK ((statut = ANY (ARRAY['LIBRE'::text, 'BLOQUE'::text, 'SOLDE'::text])))
);


ALTER TABLE public.lot OWNER TO gestionfil;

--
-- Name: lot_evenement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.lot_evenement (
    id_evenement text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_reference text NOT NULL,
    lot_fournisseur text NOT NULL,
    type_evenement text NOT NULL,
    motif text NOT NULL,
    details jsonb,
    id_utilisateur text,
    date_evenement text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT lot_evenement_motif_check CHECK ((btrim(motif) <> ''::text)),
    CONSTRAINT lot_evenement_type_evenement_check CHECK ((type_evenement = ANY (ARRAY['BLOCAGE'::text, 'DEBLOCAGE'::text, 'BASCULEMENT_RESTES'::text, 'RETOUR_PROJET'::text, 'FUSION'::text, 'DECISION_DORMANT'::text, 'DEROGATION'::text, 'SOLDE'::text, 'IDENTIFICATION'::text])))
);


ALTER TABLE public.lot_evenement OWNER TO gestionfil;

--
-- Name: machine; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine (
    code_machine text NOT NULL,
    nom text NOT NULL,
    capacite_bobines bigint NOT NULL,
    nb_etages bigint NOT NULL,
    code_atelier text,
    notes text,
    etat text DEFAULT 'ACTIVE'::text NOT NULL,
    actif bigint GENERATED ALWAYS AS (
CASE
    WHEN (etat = 'RETIREE'::text) THEN 0
    ELSE 1
END) STORED,
    motif_etat text,
    date_etat text,
    CONSTRAINT ck_machine_etat CHECK ((etat = ANY (ARRAY['ACTIVE'::text, 'PANNE'::text, 'SOMMEIL'::text, 'RETIREE'::text]))),
    CONSTRAINT machine_capacite_bobines_check CHECK ((capacite_bobines > 0)),
    CONSTRAINT machine_nb_etages_check CHECK ((nb_etages >= 0))
);


ALTER TABLE public.machine OWNER TO gestionfil;

--
-- Name: machine_cliche; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_cliche (
    id_cliche text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_fiche text NOT NULL,
    code_emplacement text NOT NULL,
    date_cliche text NOT NULL,
    code_reference text NOT NULL,
    lot_fournisseur text NOT NULL,
    nb_bobines bigint DEFAULT 0 NOT NULL,
    poids_unitaire_kg numeric(18,4),
    pourcentage numeric(6,2),
    kg numeric(18,4) DEFAULT 0 NOT NULL,
    CONSTRAINT machine_cliche_nb_bobines_check CHECK ((nb_bobines >= 0))
);


ALTER TABLE public.machine_cliche OWNER TO gestionfil;

--
-- Name: machine_consommation; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_consommation (
    id_consommation text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_machine text NOT NULL,
    code_emplacement text NOT NULL,
    code_reference text NOT NULL,
    lot_fournisseur text NOT NULL,
    date_constat text NOT NULL,
    date_constat_precedent text,
    bobines_avant bigint DEFAULT 0 NOT NULL,
    pourcentage_avant numeric(6,2),
    kg_avant numeric(18,4) DEFAULT 0 NOT NULL,
    kg_charge numeric(18,4) DEFAULT 0 NOT NULL,
    kg_retourne numeric(18,4) DEFAULT 0 NOT NULL,
    bobines_apres bigint DEFAULT 0 NOT NULL,
    pourcentage_apres numeric(6,2),
    poids_unitaire_kg numeric(18,4),
    kg_apres numeric(18,4) DEFAULT 0 NOT NULL,
    numero_of text,
    responsable text NOT NULL,
    id_utilisateur text NOT NULL,
    mode_constat text DEFAULT 'ESTIMATION'::text NOT NULL,
    marque_geste text,
    notes text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_fiche text,
    CONSTRAINT machine_consommation_bobines_apres_check CHECK ((bobines_apres >= 0)),
    CONSTRAINT machine_consommation_bobines_avant_check CHECK ((bobines_avant >= 0)),
    CONSTRAINT machine_consommation_kg_apres_check CHECK ((kg_apres >= (0)::numeric)),
    CONSTRAINT machine_consommation_kg_avant_check CHECK ((kg_avant >= (0)::numeric)),
    CONSTRAINT machine_consommation_kg_charge_check CHECK ((kg_charge >= (0)::numeric)),
    CONSTRAINT machine_consommation_kg_retourne_check CHECK ((kg_retourne >= (0)::numeric)),
    CONSTRAINT machine_consommation_mode_constat_check CHECK ((mode_constat = ANY (ARRAY['ESTIMATION'::text, 'PESEE'::text]))),
    CONSTRAINT machine_consommation_poids_unitaire_kg_check CHECK (((poids_unitaire_kg IS NULL) OR (poids_unitaire_kg > (0)::numeric))),
    CONSTRAINT machine_consommation_pourcentage_apres_check CHECK (((pourcentage_apres IS NULL) OR ((pourcentage_apres >= (0)::numeric) AND (pourcentage_apres <= (100)::numeric)))),
    CONSTRAINT machine_consommation_pourcentage_avant_check CHECK (((pourcentage_avant IS NULL) OR ((pourcentage_avant >= (0)::numeric) AND (pourcentage_avant <= (100)::numeric))))
);


ALTER TABLE public.machine_consommation OWNER TO gestionfil;

--
-- Name: TABLE machine_consommation; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON TABLE public.machine_consommation IS 'Trace de l''etat avant et apres chaque fiche, pour l''annulation et l''audit. La consommation se lit dans v_machine_consommation, en cumul.';


--
-- Name: machine_decision; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_decision (
    id_decision text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_fiche text,
    numero_validation bigint DEFAULT 1 NOT NULL,
    nature text NOT NULL,
    code_machine text NOT NULL,
    code_emplacement text NOT NULL,
    code_magasin text,
    id_decision_precedente text,
    statut text DEFAULT 'ACTIVE'::text NOT NULL,
    est_tete bigint DEFAULT 1 NOT NULL,
    date_decision text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur text,
    responsable text,
    date_retrait text,
    id_utilisateur_retrait text,
    motif_retrait text,
    CONSTRAINT machine_decision_check CHECK (((est_tete = 0) OR (statut = 'ACTIVE'::text))),
    CONSTRAINT machine_decision_check1 CHECK (((statut = 'ACTIVE'::text) OR ((date_retrait IS NOT NULL) AND (motif_retrait IS NOT NULL)))),
    CONSTRAINT machine_decision_check2 CHECK (((nature = 'DEPART'::text) = (id_fiche IS NULL))),
    CONSTRAINT machine_decision_est_tete_check CHECK ((est_tete = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT machine_decision_nature_check CHECK ((nature = ANY (ARRAY['DEPART'::text, 'CHARGE'::text, 'DECHARGE'::text, 'MAJ'::text]))),
    CONSTRAINT machine_decision_statut_check CHECK ((statut = ANY (ARRAY['ACTIVE'::text, 'RETIREE'::text, 'ANNULEE'::text])))
);


ALTER TABLE public.machine_decision OWNER TO gestionfil;

--
-- Name: machine_decision_etat; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_decision_etat (
    id_decision text NOT NULL,
    moment text NOT NULL,
    code_reference text NOT NULL,
    lot_fournisseur text NOT NULL,
    nb_bobines bigint NOT NULL,
    poids_unitaire_kg numeric(18,4),
    pourcentage numeric(6,2),
    kg numeric(18,4) NOT NULL,
    CONSTRAINT machine_decision_etat_kg_check CHECK ((kg >= (0)::numeric)),
    CONSTRAINT machine_decision_etat_moment_check CHECK ((moment = ANY (ARRAY['AVANT'::text, 'APRES'::text]))),
    CONSTRAINT machine_decision_etat_nb_bobines_check CHECK ((nb_bobines >= 0))
);


ALTER TABLE public.machine_decision_etat OWNER TO gestionfil;

--
-- Name: machine_decision_ligne; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_decision_ligne (
    id_decision text NOT NULL,
    ligne_numero bigint NOT NULL,
    code_reference text NOT NULL,
    lot_fournisseur text NOT NULL,
    poids_nominal_kg numeric(18,4) NOT NULL,
    nb_avant bigint NOT NULL,
    kg_avant numeric(18,4) NOT NULL,
    nb_mouvementees bigint DEFAULT 0 NOT NULL,
    poids_retenu_kg numeric(18,4),
    pct_retirees numeric(6,2),
    kg_mouvementes numeric(18,4) DEFAULT 0 NOT NULL,
    destination text,
    nb_apres bigint NOT NULL,
    pourcentage_apres numeric(6,2),
    kg_apres numeric(18,4) NOT NULL,
    ecart_kg numeric(18,4) NOT NULL,
    effet_ecart text NOT NULL,
    code_motif text NOT NULL,
    motif_texte text,
    cmup_mad numeric(18,4),
    id_mouvement text,
    pourcentage_theorique numeric(12,2),
    niveau_ecart text,
    CONSTRAINT machine_decision_ligne_destination_check CHECK ((destination = ANY (ARRAY['MAGASIN'::text, 'PERTE'::text, 'DECHET'::text, 'CASSE'::text]))),
    CONSTRAINT machine_decision_ligne_effet_ecart_check CHECK ((effet_ecart = ANY (ARRAY['CONSOMMATION'::text, 'ERREUR_SAISIE'::text, 'DECHET'::text, 'PERTE'::text, 'CASSE'::text, 'NON_QUALIFIE'::text, 'REGULARISATION'::text, 'AUCUN'::text]))),
    CONSTRAINT machine_decision_ligne_kg_apres_check CHECK ((kg_apres >= (0)::numeric)),
    CONSTRAINT machine_decision_ligne_kg_avant_check CHECK ((kg_avant >= (0)::numeric)),
    CONSTRAINT machine_decision_ligne_kg_mouvementes_check CHECK ((kg_mouvementes >= (0)::numeric)),
    CONSTRAINT machine_decision_ligne_nb_apres_check CHECK ((nb_apres >= 0)),
    CONSTRAINT machine_decision_ligne_nb_avant_check CHECK ((nb_avant >= 0)),
    CONSTRAINT machine_decision_ligne_nb_mouvementees_check CHECK ((nb_mouvementees >= 0)),
    CONSTRAINT machine_decision_ligne_poids_nominal_kg_check CHECK ((poids_nominal_kg > (0)::numeric))
);


ALTER TABLE public.machine_decision_ligne OWNER TO gestionfil;

--
-- Name: machine_emplacement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_emplacement (
    code_emplacement text NOT NULL,
    code_machine text NOT NULL,
    role text NOT NULL,
    numero_etage bigint NOT NULL,
    capacite_bobines bigint NOT NULL,
    code_magasin text,
    actif bigint DEFAULT 1 NOT NULL,
    libelle text GENERATED ALWAYS AS (
CASE role
    WHEN 'ETAGE'::text THEN ('Etage '::text || (numero_etage)::text)
    WHEN 'CHAINE'::text THEN 'Chaine'::text
    WHEN 'TRAME'::text THEN 'Trame'::text
    WHEN 'RESERVE'::text THEN 'Reserve'::text
    ELSE NULL::text
END) STORED,
    CONSTRAINT ck_empl_role CHECK ((role = ANY (ARRAY['ETAGE'::text, 'CHAINE'::text, 'TRAME'::text, 'RESERVE'::text]))),
    CONSTRAINT machine_emplacement_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT machine_emplacement_capacite_bobines_check CHECK ((capacite_bobines > 0)),
    CONSTRAINT machine_emplacement_check CHECK (((role = 'ETAGE'::text) OR (numero_etage = 0))),
    CONSTRAINT machine_emplacement_check1 CHECK (((role <> 'ETAGE'::text) OR (numero_etage > 0))),
    CONSTRAINT machine_emplacement_numero_etage_check CHECK ((numero_etage >= 0))
);


ALTER TABLE public.machine_emplacement OWNER TO gestionfil;

--
-- Name: machine_etat; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_etat (
    code_emplacement text NOT NULL,
    code_reference text NOT NULL,
    lot_fournisseur text NOT NULL,
    nb_bobines bigint DEFAULT 0 NOT NULL,
    nb_palettes bigint,
    poids_unitaire_kg numeric(18,4),
    pourcentage numeric(6,2) DEFAULT 100 NOT NULL,
    kg numeric(18,4) DEFAULT 0 NOT NULL,
    mode_constat text DEFAULT 'ESTIMATION'::text NOT NULL,
    date_constat text NOT NULL,
    responsable text,
    id_utilisateur text,
    date_maj text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_fiche text,
    CONSTRAINT ck_machine_etat_kg CHECK ((kg >= (0)::numeric)),
    CONSTRAINT machine_etat_mode_constat_check CHECK ((mode_constat = ANY (ARRAY['ESTIMATION'::text, 'PESEE'::text]))),
    CONSTRAINT machine_etat_nb_bobines_check CHECK ((nb_bobines >= 0)),
    CONSTRAINT machine_etat_nb_palettes_check CHECK (((nb_palettes IS NULL) OR (nb_palettes >= 0))),
    CONSTRAINT machine_etat_poids_unitaire_kg_check CHECK (((poids_unitaire_kg IS NULL) OR (poids_unitaire_kg > (0)::numeric))),
    CONSTRAINT machine_etat_pourcentage_check CHECK (((pourcentage >= (0)::numeric) AND (pourcentage <= (500)::numeric)))
);


ALTER TABLE public.machine_etat OWNER TO gestionfil;

--
-- Name: machine_fiche; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_fiche (
    id_fiche text DEFAULT (gen_random_uuid())::text NOT NULL,
    numero_fiche text NOT NULL,
    type_fiche text NOT NULL,
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    code_machine text NOT NULL,
    code_emplacement text NOT NULL,
    date_fiche text NOT NULL,
    date_constat_precedent text,
    code_magasin text,
    nb_bobines_etage bigint,
    nb_palettes bigint,
    numero_of text,
    responsable text NOT NULL,
    observations text,
    id_utilisateur text NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur_validation text,
    date_validation text,
    motif_annulation text,
    date_annulation text,
    nb_validations bigint DEFAULT 0 NOT NULL,
    CONSTRAINT ck_fiche_magasin CHECK (((type_fiche = ANY (ARRAY['MAJ'::text, 'CONSO'::text])) OR (code_magasin IS NOT NULL))),
    CONSTRAINT ck_fiche_type CHECK ((type_fiche = ANY (ARRAY['CHARGE'::text, 'DECHARGE'::text, 'MAJ'::text, 'CONSO'::text]))),
    CONSTRAINT machine_fiche_check CHECK (((statut <> 'ANNULE'::text) OR (motif_annulation IS NOT NULL))),
    CONSTRAINT machine_fiche_check1 CHECK (((statut <> 'VALIDE'::text) OR (date_validation IS NOT NULL))),
    CONSTRAINT machine_fiche_nb_bobines_etage_check CHECK (((nb_bobines_etage IS NULL) OR (nb_bobines_etage >= 0))),
    CONSTRAINT machine_fiche_nb_palettes_check CHECK (((nb_palettes IS NULL) OR (nb_palettes >= 0))),
    CONSTRAINT machine_fiche_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'VALIDE'::text, 'ANNULE'::text])))
);


ALTER TABLE public.machine_fiche OWNER TO gestionfil;

--
-- Name: machine_fiche_journal; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_fiche_journal (
    id_evenement text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_fiche text,
    id_decision text,
    evenement text NOT NULL,
    code_emplacement text,
    motif text,
    id_utilisateur text,
    horodatage text DEFAULT to_char((clock_timestamp() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    detail jsonb,
    CONSTRAINT machine_fiche_journal_evenement_check CHECK ((evenement = ANY (ARRAY['DEPART'::text, 'VALIDATION'::text, 'DEVALIDATION'::text, 'ANNULATION'::text, 'CHANGEMENT_ETAGE'::text])))
);


ALTER TABLE public.machine_fiche_journal OWNER TO gestionfil;

--
-- Name: machine_fiche_ligne; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_fiche_ligne (
    id_ligne text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_fiche text NOT NULL,
    ligne_numero bigint NOT NULL,
    code_reference text NOT NULL,
    lot_fournisseur text NOT NULL,
    nb_bobines_mouvementees bigint,
    nb_palettes bigint,
    poids_unitaire_kg numeric(18,4),
    pourcentage numeric(6,2),
    total_kg numeric(18,4) NOT NULL,
    mode_constat text DEFAULT 'ESTIMATION'::text NOT NULL,
    notes text,
    nb_bobines_presentes bigint DEFAULT 0 NOT NULL,
    kg_mouvementes numeric(18,4),
    lot_force bigint DEFAULT 0 NOT NULL,
    motif_lot_force text,
    poids_retenu_kg numeric(18,4),
    pct_retirees numeric(6,2),
    destination text,
    code_motif text,
    motif_texte text,
    effet_ecart text,
    CONSTRAINT ck_ligne_destination CHECK (((destination IS NULL) OR (destination = ANY (ARRAY['MAGASIN'::text, 'PERTE'::text, 'DECHET'::text, 'CASSE'::text])))),
    CONSTRAINT ck_ligne_mouvementees CHECK (((nb_bobines_mouvementees IS NULL) OR (nb_bobines_mouvementees >= 0))),
    CONSTRAINT ck_ligne_pct_retirees CHECK (((pct_retirees IS NULL) OR ((pct_retirees >= (0)::numeric) AND (pct_retirees <= (500)::numeric)))),
    CONSTRAINT ck_ligne_poids_retenu CHECK (((poids_retenu_kg IS NULL) OR (poids_retenu_kg > (0)::numeric))),
    CONSTRAINT machine_fiche_ligne_kg_mouvementes_check CHECK (((kg_mouvementes IS NULL) OR (kg_mouvementes >= (0)::numeric))),
    CONSTRAINT machine_fiche_ligne_ligne_numero_check CHECK ((ligne_numero > 0)),
    CONSTRAINT machine_fiche_ligne_lot_force_check CHECK ((lot_force = ANY (ARRAY[0, 1]))),
    CONSTRAINT machine_fiche_ligne_mode_constat_check CHECK ((mode_constat = ANY (ARRAY['ESTIMATION'::text, 'PESEE'::text]))),
    CONSTRAINT machine_fiche_ligne_nb_bobines_presentes_check CHECK ((nb_bobines_presentes >= 0)),
    CONSTRAINT machine_fiche_ligne_nb_palettes_check CHECK (((nb_palettes IS NULL) OR (nb_palettes >= 0))),
    CONSTRAINT machine_fiche_ligne_poids_unitaire_kg_check CHECK (((poids_unitaire_kg IS NULL) OR (poids_unitaire_kg > (0)::numeric))),
    CONSTRAINT machine_fiche_ligne_pourcentage_check CHECK (((pourcentage IS NULL) OR ((pourcentage >= (0)::numeric) AND (pourcentage <= (500)::numeric)))),
    CONSTRAINT machine_fiche_ligne_total_kg_check CHECK ((total_kg >= (0)::numeric))
);


ALTER TABLE public.machine_fiche_ligne OWNER TO gestionfil;

--
-- Name: COLUMN machine_fiche_ligne.lot_force; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.machine_fiche_ligne.lot_force IS '1 : l operateur a confirme le chargement malgre un solde de lot insuffisant.
 Se reporte sur la ligne de mouvement a la validation.';


--
-- Name: machine_motif; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.machine_motif (
    code_motif text NOT NULL,
    type_fiche text NOT NULL,
    libelle text NOT NULL,
    destinations text[] DEFAULT '{}'::text[] NOT NULL,
    effet_defaut text,
    effets_permis text[] DEFAULT '{}'::text[] NOT NULL,
    ordre bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT machine_motif_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT machine_motif_check CHECK (((effet_defaut IS NOT NULL) OR (cardinality(effets_permis) > 0))),
    CONSTRAINT machine_motif_effet_defaut_check CHECK ((effet_defaut = ANY (ARRAY['CONSOMMATION'::text, 'NON_QUALIFIE'::text]))),
    CONSTRAINT machine_motif_type_fiche_check CHECK ((type_fiche = ANY (ARRAY['CHARGE'::text, 'DECHARGE'::text, 'MAJ'::text])))
);


ALTER TABLE public.machine_motif OWNER TO gestionfil;

--
-- Name: magasin; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.magasin (
    code_magasin text NOT NULL,
    nom text NOT NULL,
    type text,
    adresse text,
    responsable text,
    inclure_mrp bigint DEFAULT 1 NOT NULL,
    est_quarantaine bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT magasin_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT magasin_check CHECK (((est_quarantaine = 0) OR (inclure_mrp = 0))),
    CONSTRAINT magasin_est_quarantaine_check CHECK ((est_quarantaine = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT magasin_inclure_mrp_check CHECK ((inclure_mrp = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.magasin OWNER TO gestionfil;

--
-- Name: migration_appliquee; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.migration_appliquee (
    fichier text NOT NULL,
    empreinte text,
    date_application text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    mode text DEFAULT 'JOUEE'::text NOT NULL,
    par text DEFAULT CURRENT_USER NOT NULL,
    CONSTRAINT migration_appliquee_mode_check CHECK ((mode = ANY (ARRAY['JOUEE'::text, 'MARQUEE'::text, 'SOCLE'::text])))
);


ALTER TABLE public.migration_appliquee OWNER TO gestionfil;

--
-- Name: modele_droit_champ; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.modele_droit_champ (
    code_role_user text NOT NULL,
    module text NOT NULL,
    champ text NOT NULL,
    niveau text NOT NULL,
    CONSTRAINT modele_droit_champ_niveau_check CHECK ((niveau = ANY (ARRAY['MASQUE'::text, 'LECTURE'::text, 'ECRITURE'::text])))
);


ALTER TABLE public.modele_droit_champ OWNER TO gestionfil;

--
-- Name: motif_ligne; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.motif_ligne (
    code_motif_ligne text NOT NULL,
    libelle text NOT NULL,
    categorie text,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT motif_ligne_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.motif_ligne OWNER TO gestionfil;

--
-- Name: motif_mouvement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.motif_mouvement (
    code_motif text NOT NULL,
    libelle text NOT NULL,
    categorie text NOT NULL,
    signe_default bigint NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT motif_mouvement_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT motif_mouvement_signe_default_check CHECK ((signe_default = ANY (ARRAY[('-1'::integer)::bigint, (1)::bigint])))
);


ALTER TABLE public.motif_mouvement OWNER TO gestionfil;

--
-- Name: mouvement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.mouvement (
    id_mouvement text DEFAULT (gen_random_uuid())::text NOT NULL,
    numero_mouvement text NOT NULL,
    date_mouvement text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    code_type_mvt text NOT NULL,
    code_magasin text NOT NULL,
    code_motif text NOT NULL,
    reference_document text,
    numero_of text,
    observations_globales text,
    id_utilisateur text NOT NULL,
    responsable text,
    est_initial bigint DEFAULT 0 NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_mouvement_contrepasse text,
    motif_contrepassation text,
    id_decision_machine text,
    CONSTRAINT mouvement_est_initial_check CHECK ((est_initial = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.mouvement OWNER TO gestionfil;

--
-- Name: COLUMN mouvement.id_mouvement_contrepasse; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.mouvement.id_mouvement_contrepasse IS 'Le mouvement que celui-ci annule. Present = cette ligne EST une contre-passation.';


--
-- Name: parametre; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.parametre (
    code_parametre text NOT NULL,
    libelle text NOT NULL,
    valeur_courante text NOT NULL,
    type_donnee text NOT NULL,
    unite text,
    description text,
    categorie text,
    modifiable_par text,
    verrouille bigint DEFAULT 0 NOT NULL,
    date_derniere_modif text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur_modif text,
    motif_modif text,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT parametre_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT parametre_type_donnee_check CHECK ((type_donnee = ANY (ARRAY['ENTIER'::text, 'DECIMAL'::text, 'TEXTE'::text, 'DATE'::text, 'BOOLEEN'::text]))),
    CONSTRAINT parametre_verrouille_check CHECK ((verrouille = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.parametre OWNER TO gestionfil;

--
-- Name: parametre_historique; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.parametre_historique (
    id_histo_param text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_parametre text NOT NULL,
    ancienne_valeur text NOT NULL,
    nouvelle_valeur text NOT NULL,
    date_modification text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur text,
    motif text,
    ip_adresse text,
    CONSTRAINT parametre_historique_check CHECK ((ancienne_valeur IS DISTINCT FROM nouvelle_valeur))
);


ALTER TABLE public.parametre_historique OWNER TO gestionfil;

--
-- Name: parametres_frais; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.parametres_frais (
    id_frais text NOT NULL,
    libelle text NOT NULL,
    categorie text NOT NULL,
    inclus_dans_cout bigint NOT NULL,
    ordre bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    piece_justificative text,
    recuperable bigint DEFAULT 0 NOT NULL,
    commun bigint DEFAULT 1 NOT NULL,
    methode_repartition text DEFAULT 'VALEUR'::text NOT NULL,
    CONSTRAINT parametres_frais_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT parametres_frais_categorie_check CHECK ((categorie = ANY (ARRAY['DOUANE'::text, 'TAXE'::text, 'TRANSPORT'::text, 'PORT'::text, 'TRANSIT'::text, 'AUTRE'::text]))),
    CONSTRAINT parametres_frais_commun_check CHECK ((commun = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT parametres_frais_inclus_dans_cout_check CHECK ((inclus_dans_cout = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT parametres_frais_methode_check CHECK ((methode_repartition = ANY (ARRAY['VALEUR'::text, 'POIDS'::text, 'QUANTITE'::text, 'PARTS_EGALES'::text]))),
    CONSTRAINT parametres_frais_recup_hors_cout_check CHECK (((recuperable = 0) OR (inclus_dans_cout = 0))),
    CONSTRAINT parametres_frais_recuperable_check CHECK ((recuperable = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.parametres_frais OWNER TO gestionfil;

--
-- Name: permission; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.permission (
    id_permission text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_role_user text NOT NULL,
    module text NOT NULL,
    action text NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT permission_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT permission_action_check CHECK ((action = ANY (ARRAY['LIRE'::text, 'ECRIRE'::text, 'VALIDER'::text])))
);


ALTER TABLE public.permission OWNER TO gestionfil;

--
-- Name: piece_jointe; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.piece_jointe (
    id_piece text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_dossier text NOT NULL,
    id_facture text,
    id_reception text,
    nature text DEFAULT 'AUTRE'::text NOT NULL,
    id_frais text,
    libelle text,
    nom_fichier text NOT NULL,
    type_mime text NOT NULL,
    taille_octets bigint NOT NULL,
    nb_pages bigint,
    chemin text NOT NULL,
    empreinte_sha256 text NOT NULL,
    date_depot text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur text NOT NULL,
    notes text,
    CONSTRAINT piece_jointe_nature_check CHECK ((nature = ANY (ARRAY['FACTURE_FOURNISSEUR'::text, 'DUM'::text, 'QUITTANCE_DOUANE'::text, 'LIQUIDATION'::text, 'FACTURE_FRAIS'::text, 'BL'::text, 'PACKING'::text, 'ENGAGEMENT'::text, 'AUTRE'::text]))),
    CONSTRAINT piece_jointe_nb_pages_check CHECK (((nb_pages IS NULL) OR (nb_pages > 0))),
    CONSTRAINT piece_jointe_taille_octets_check CHECK ((taille_octets > 0))
);


ALTER TABLE public.piece_jointe OWNER TO gestionfil;

--
-- Name: piece_lecture; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.piece_lecture (
    id_piece text NOT NULL,
    resultat jsonb NOT NULL,
    duree_s numeric(8,1),
    date_lecture text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur text NOT NULL
);


ALTER TABLE public.piece_lecture OWNER TO gestionfil;

--
-- Name: plan_achat; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.plan_achat (
    id_proposition text DEFAULT (gen_random_uuid())::text NOT NULL,
    date_generation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_plan text,
    code_reference text NOT NULL,
    quantite_suggeree_kg numeric(18,4) NOT NULL,
    unite_saisie text,
    quantite_suggeree_unite numeric(18,4),
    code_fournisseur text NOT NULL,
    prix_estime_mad numeric(18,4) NOT NULL,
    source_prix text NOT NULL,
    montant_total_mad numeric(18,2) GENERATED ALWAYS AS ((quantite_suggeree_kg * prix_estime_mad)) STORED,
    date_besoin_prevue text NOT NULL,
    urgence text NOT NULL,
    risque_identifie text,
    action_recommandee text,
    statut text DEFAULT 'PROPOSE'::text NOT NULL,
    id_bc_genere text,
    id_utilisateur_validation text,
    date_validation text,
    commentaires text,
    code_reference_origine text,
    motif_substitution text,
    figee bigint DEFAULT 0 NOT NULL,
    id_utilisateur_figement text,
    date_figement text,
    motif_figement text,
    quantite_mrp_kg numeric(18,4),
    code_devise text,
    prix_devise numeric,
    montant_devise numeric,
    taux_devise numeric,
    palettes_a_commander bigint,
    date_ecartee text,
    CONSTRAINT plan_achat_check CHECK (((code_reference_origine IS NULL) OR (code_reference_origine <> code_reference))),
    CONSTRAINT plan_achat_figee_check CHECK ((figee = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT plan_achat_motif_figement_check CHECK (((motif_figement IS NULL) OR (motif_figement = ANY (ARRAY['PRIX_NEGOCIE'::text, 'QUANTITE_AJUSTEE'::text, 'LIVRAISON_GROUPEE'::text, 'DELAI_FOURNISSEUR'::text, 'AUTRE'::text])))),
    CONSTRAINT plan_achat_prix_estime_mad_check CHECK ((prix_estime_mad > (0)::numeric)),
    CONSTRAINT plan_achat_quantite_mrp_kg_check CHECK (((quantite_mrp_kg IS NULL) OR (quantite_mrp_kg > (0)::numeric))),
    CONSTRAINT plan_achat_quantite_suggeree_kg_check CHECK ((quantite_suggeree_kg > (0)::numeric)),
    CONSTRAINT plan_achat_source_prix_check CHECK ((source_prix = ANY (ARRAY['CMUP'::text, 'CATALOGUE'::text, 'NEGOCIE'::text]))),
    CONSTRAINT plan_achat_statut_check CHECK ((statut = ANY (ARRAY['PROPOSE'::text, 'EN_REVISION'::text, 'VALIDE'::text, 'COMMANDE'::text, 'IGNORE'::text]))),
    CONSTRAINT plan_achat_unite_saisie_check CHECK (((unite_saisie IS NULL) OR (unite_saisie = ANY (ARRAY['kg'::text, 'Palette'::text, 'Bobine'::text, 'ml'::text, 'Lot'::text])))),
    CONSTRAINT plan_achat_urgence_check CHECK ((urgence = ANY (ARRAY['TIER 1'::text, 'TIER 2'::text, 'TIER 3'::text, 'TIER 4'::text])))
);


ALTER TABLE public.plan_achat OWNER TO gestionfil;

--
-- Name: COLUMN plan_achat.prix_devise; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.plan_achat.prix_devise IS 'Prix unitaire dans la devise du catalogue. On ne negocie pas en dirhams avec un fournisseur turc.';


--
-- Name: plan_production; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.plan_production (
    id_plan text DEFAULT (gen_random_uuid())::text NOT NULL,
    annee bigint NOT NULL,
    numero_version bigint DEFAULT 1 NOT NULL,
    libelle text NOT NULL,
    scenario_nom text,
    date_debut text NOT NULL,
    date_fin text NOT NULL,
    mois_horizon bigint DEFAULT 12 NOT NULL,
    croissance_annuelle_pct numeric(9,4) DEFAULT 0 NOT NULL,
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    actif bigint GENERATED ALWAYS AS (
CASE
    WHEN (statut = 'CLOTURE'::text) THEN 0
    ELSE 1
END) STORED,
    marge_securite_pct numeric(9,4) NOT NULL,
    couv_min_mois numeric(12,4) NOT NULL,
    taux_perte_pct numeric(9,4) NOT NULL,
    seuil_alerte_jours bigint NOT NULL,
    seuil_critique_jours bigint NOT NULL,
    seuil_tier1_mad numeric(18,2) NOT NULL,
    seuil_tier2_mad numeric(18,2) NOT NULL,
    seuil_tier3_mad numeric(18,2) NOT NULL,
    m2_total_annuel numeric(18,4),
    id_utilisateur_creation text,
    id_utilisateur_modification text,
    id_utilisateur_validation text,
    id_utilisateur_cloture text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    date_modification text,
    date_validation text,
    date_cloture text,
    CONSTRAINT plan_production_annee_check CHECK (((annee >= 2000) AND (annee <= 2200))),
    CONSTRAINT plan_production_check CHECK ((date_fin > date_debut)),
    CONSTRAINT plan_production_check1 CHECK ((seuil_critique_jours < seuil_alerte_jours)),
    CONSTRAINT plan_production_check2 CHECK (((seuil_tier3_mad < seuil_tier2_mad) AND (seuil_tier2_mad < seuil_tier1_mad))),
    CONSTRAINT plan_production_check3 CHECK (((statut <> 'EN_COURS'::text) OR ((date_validation IS NOT NULL) AND (id_utilisateur_validation IS NOT NULL)))),
    CONSTRAINT plan_production_check4 CHECK (((statut <> 'CLOTURE'::text) OR (date_cloture IS NOT NULL))),
    CONSTRAINT plan_production_couv_min_mois_check CHECK ((couv_min_mois >= (0)::numeric)),
    CONSTRAINT plan_production_m2_total_annuel_check CHECK (((m2_total_annuel IS NULL) OR (m2_total_annuel >= (0)::numeric))),
    CONSTRAINT plan_production_marge_securite_pct_check CHECK ((marge_securite_pct >= (0)::numeric)),
    CONSTRAINT plan_production_mois_horizon_check CHECK (((mois_horizon >= 1) AND (mois_horizon <= 60))),
    CONSTRAINT plan_production_numero_version_check CHECK ((numero_version > 0)),
    CONSTRAINT plan_production_seuil_alerte_jours_check CHECK ((seuil_alerte_jours > 0)),
    CONSTRAINT plan_production_seuil_critique_jours_check CHECK ((seuil_critique_jours > 0)),
    CONSTRAINT plan_production_seuil_tier1_mad_check CHECK ((seuil_tier1_mad > (0)::numeric)),
    CONSTRAINT plan_production_seuil_tier2_mad_check CHECK ((seuil_tier2_mad > (0)::numeric)),
    CONSTRAINT plan_production_seuil_tier3_mad_check CHECK ((seuil_tier3_mad > (0)::numeric)),
    CONSTRAINT plan_production_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'SIMULATION'::text, 'EN_COURS'::text, 'CLOTURE'::text]))),
    CONSTRAINT plan_production_taux_perte_pct_check CHECK ((taux_perte_pct >= (0)::numeric))
);


ALTER TABLE public.plan_production OWNER TO gestionfil;

--
-- Name: plan_qualite; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.plan_qualite (
    id_plan text NOT NULL,
    code_qualite text NOT NULL,
    m2_base_mensuel numeric(18,4) DEFAULT 0 NOT NULL,
    date_figee text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT plan_qualite_m2_base_mensuel_check CHECK ((m2_base_mensuel >= (0)::numeric))
);


ALTER TABLE public.plan_qualite OWNER TO gestionfil;

--
-- Name: plan_saisonnalite; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.plan_saisonnalite (
    id_plan text NOT NULL,
    code_qualite text NOT NULL,
    mois bigint NOT NULL,
    coefficient numeric(9,4) NOT NULL,
    CONSTRAINT plan_saisonnalite_coefficient_check CHECK ((coefficient >= (0)::numeric)),
    CONSTRAINT plan_saisonnalite_mois_check CHECK (((mois >= 1) AND (mois <= 12)))
);


ALTER TABLE public.plan_saisonnalite OWNER TO gestionfil;

--
-- Name: preference_utilisateur; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.preference_utilisateur (
    id_utilisateur text NOT NULL,
    apparence jsonb DEFAULT '{}'::jsonb NOT NULL,
    fond_image text,
    modifie_le timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_pref_fond_taille CHECK (((fond_image IS NULL) OR (length(fond_image) <= 2000000)))
);


ALTER TABLE public.preference_utilisateur OWNER TO gestionfil;

--
-- Name: qualite; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.qualite (
    code_qualite text NOT NULL,
    nom text NOT NULL,
    description text,
    poids_commercial_m2 numeric(18,4) DEFAULT 0 NOT NULL,
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    actif bigint GENERATED ALWAYS AS (
CASE
    WHEN (statut = 'CLOTURE'::text) THEN 0
    ELSE 1
END) STORED,
    marge_securite_pct numeric(9,4) NOT NULL,
    couv_min_mois numeric(12,4) NOT NULL,
    taux_perte_pct numeric(9,4) NOT NULL,
    seuil_alerte_jours bigint NOT NULL,
    seuil_critique_jours bigint NOT NULL,
    stock_securite_jours bigint NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    date_modification text,
    date_cloture text,
    id_utilisateur_creation text,
    id_utilisateur_modification text,
    id_utilisateur_cloture text,
    CONSTRAINT qualite_check CHECK ((seuil_critique_jours < seuil_alerte_jours)),
    CONSTRAINT qualite_check1 CHECK ((((statut <> 'CLOTURE'::text) AND (date_cloture IS NULL)) OR ((statut = 'CLOTURE'::text) AND (date_cloture IS NOT NULL)))),
    CONSTRAINT qualite_couv_min_mois_check CHECK ((couv_min_mois >= (0)::numeric)),
    CONSTRAINT qualite_marge_securite_pct_check CHECK ((marge_securite_pct >= (0)::numeric)),
    CONSTRAINT qualite_poids_commercial_m2_check CHECK ((poids_commercial_m2 >= (0)::numeric)),
    CONSTRAINT qualite_seuil_alerte_jours_check CHECK ((seuil_alerte_jours > 0)),
    CONSTRAINT qualite_seuil_critique_jours_check CHECK ((seuil_critique_jours > 0)),
    CONSTRAINT qualite_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'ACTIF'::text, 'CLOTURE'::text]))),
    CONSTRAINT qualite_stock_securite_jours_check CHECK ((stock_securite_jours >= 0)),
    CONSTRAINT qualite_taux_perte_pct_check CHECK ((taux_perte_pct >= (0)::numeric))
);


ALTER TABLE public.qualite OWNER TO gestionfil;

--
-- Name: reception; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.reception (
    id_reception text DEFAULT (gen_random_uuid())::text NOT NULL,
    numero_reception text NOT NULL,
    date_reception text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_bc text,
    code_fournisseur text NOT NULL,
    transporteur text,
    num_bon_livraison text,
    numero_facture text,
    nombre_colis bigint,
    poids_total_brut_kg numeric(18,4),
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    taux_change_reception numeric(9,4),
    id_utilisateur_reception text NOT NULL,
    id_utilisateur_controle text,
    date_controle text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    montant_facture_mad numeric(18,2),
    frais_facture_mad numeric(18,2),
    date_cloture text,
    id_utilisateur_cloture text,
    code_devise_facture text,
    montant_facture_devise numeric(18,2),
    taux_facture numeric(9,4),
    CONSTRAINT reception_check CHECK (((id_utilisateur_controle IS NULL) OR (id_utilisateur_controle <> id_utilisateur_reception))),
    CONSTRAINT reception_check1 CHECK (((statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text, 'ANNULE'::text])) OR ((id_utilisateur_controle IS NOT NULL) AND (date_controle IS NOT NULL) AND (taux_change_reception IS NOT NULL)))),
    CONSTRAINT reception_nombre_colis_check CHECK (((nombre_colis IS NULL) OR (nombre_colis > 0))),
    CONSTRAINT reception_poids_total_brut_kg_check CHECK (((poids_total_brut_kg IS NULL) OR (poids_total_brut_kg > (0)::numeric))),
    CONSTRAINT reception_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text, 'VALIDE'::text, 'CLOTURE'::text, 'ANNULE'::text]))),
    CONSTRAINT reception_taux_change_reception_check CHECK (((taux_change_reception IS NULL) OR (taux_change_reception > (0)::numeric))),
    CONSTRAINT reception_taux_facture_check CHECK (((taux_facture IS NULL) OR (taux_facture > (0)::numeric)))
);


ALTER TABLE public.reception OWNER TO gestionfil;

--
-- Name: reception_ajustements_cmup; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.reception_ajustements_cmup (
    id_ajustement text DEFAULT (gen_random_uuid())::text NOT NULL,
    id_reception text NOT NULL,
    code_reference text NOT NULL,
    nature text NOT NULL,
    code_magasin text,
    quantite_recue_kg numeric(18,4) NOT NULL,
    stock_kg numeric(18,4) NOT NULL,
    cmup_avant numeric(18,4),
    cmup_apres numeric(18,4),
    montant_mad numeric(18,2) NOT NULL,
    date_ajustement text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur text NOT NULL,
    origine text DEFAULT 'CLOTURE'::text NOT NULL,
    numero_piece text,
    motif text,
    CONSTRAINT ck_rec_ajust_origine CHECK (((origine = ANY (ARRAY['CLOTURE'::text, 'AVOIR'::text, 'COMPLEMENT'::text])) AND ((origine = 'CLOTURE'::text) OR (length(btrim(COALESCE(motif, ''::text))) >= 5)))),
    CONSTRAINT reception_ajustements_cmup_check CHECK ((((nature = 'STOCK'::text) AND (code_magasin IS NOT NULL) AND (cmup_apres IS NOT NULL)) OR ((nature = 'ECART_PRIX'::text) AND (code_magasin IS NULL)))),
    CONSTRAINT reception_ajustements_cmup_nature_check CHECK ((nature = ANY (ARRAY['STOCK'::text, 'ECART_PRIX'::text]))),
    CONSTRAINT reception_ajustements_cmup_quantite_recue_kg_check CHECK ((quantite_recue_kg >= (0)::numeric)),
    CONSTRAINT reception_ajustements_cmup_stock_kg_check CHECK ((stock_kg >= (0)::numeric))
);


ALTER TABLE public.reception_ajustements_cmup OWNER TO gestionfil;

--
-- Name: recette; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.recette (
    id_recette text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_qualite text NOT NULL,
    ligne_numero bigint NOT NULL,
    code_reference text NOT NULL,
    code_role text NOT NULL,
    code_groupe_equiv text,
    pourcentage_composition numeric(9,4) NOT NULL,
    type_composant text,
    couleur text,
    code_fournisseur_prefere text,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT recette_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT recette_ligne_numero_check CHECK ((ligne_numero > 0)),
    CONSTRAINT recette_pourcentage_composition_check CHECK (((pourcentage_composition > (0)::numeric) AND (pourcentage_composition <= (100)::numeric)))
);


ALTER TABLE public.recette OWNER TO gestionfil;

--
-- Name: reference; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.reference (
    code_reference text NOT NULL,
    code_categorie text NOT NULL,
    code_fournisseur text NOT NULL,
    designation text NOT NULL,
    type_fil text,
    couleur text,
    titrage text,
    unite_catalogue text NOT NULL,
    poids_bobine_kg numeric(18,4),
    bobines_par_palette bigint,
    densite_kg_ml numeric(18,4),
    facteur_kg numeric(18,4) GENERATED ALWAYS AS (
CASE unite_catalogue
    WHEN 'kg'::text THEN 1.0
    WHEN 'Bobine'::text THEN poids_bobine_kg
    WHEN 'Palette'::text THEN (poids_bobine_kg * (bobines_par_palette)::numeric)
    WHEN 'Lot'::text THEN (poids_bobine_kg * (bobines_par_lot)::numeric)
    WHEN 'ml'::text THEN densite_kg_ml
    ELSE NULL::numeric
END) STORED,
    prix_catalogue numeric(18,4) NOT NULL,
    code_devise_catalogue text NOT NULL,
    date_prix_catalogue text,
    prix_catalogue_kg numeric(18,4) GENERATED ALWAYS AS ((prix_catalogue /
CASE unite_catalogue
    WHEN 'kg'::text THEN 1.0
    WHEN 'Bobine'::text THEN poids_bobine_kg
    WHEN 'Palette'::text THEN (poids_bobine_kg * (bobines_par_palette)::numeric)
    WHEN 'Lot'::text THEN (poids_bobine_kg * (bobines_par_lot)::numeric)
    WHEN 'ml'::text THEN densite_kg_ml
    ELSE NULL::numeric
END)) STORED,
    stock_min_kg numeric(18,4),
    couverture_min_mois numeric(12,4),
    marge_securite_pct numeric(9,4),
    moq_kg numeric(18,4),
    multiple_achat_kg numeric(18,4),
    classe_abc text,
    classe_xyz text,
    date_dernier_abc text,
    cmup_mad numeric(18,4),
    date_dernier_cmup text,
    suivi_lot bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_utilisateur_creation text,
    code_couleur text,
    code_famille text,
    code_couleur_interne text,
    reference_fournisseur text,
    supplement_teinture numeric(18,4),
    origine text,
    bobines_par_lot bigint,
    description_commerciale text,
    code_conditionnement text,
    seuil_lot_valeur numeric(18,2),
    type_lot text DEFAULT 'INDIFFERENT'::text NOT NULL,
    fusion_lot bigint DEFAULT 1 NOT NULL,
    arrondi_palette bigint DEFAULT 0 NOT NULL,
    CONSTRAINT reference_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT reference_arrondi_palette_check CHECK ((arrondi_palette = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT reference_bobines_par_lot_check CHECK (((bobines_par_lot IS NULL) OR (bobines_par_lot > 0))),
    CONSTRAINT reference_bobines_par_palette_check CHECK (((bobines_par_palette IS NULL) OR (bobines_par_palette > 0))),
    CONSTRAINT reference_check CHECK (((unite_catalogue <> 'Bobine'::text) OR (poids_bobine_kg IS NOT NULL))),
    CONSTRAINT reference_check1 CHECK (((unite_catalogue <> 'Palette'::text) OR ((poids_bobine_kg IS NOT NULL) AND (bobines_par_palette IS NOT NULL)))),
    CONSTRAINT reference_check2 CHECK (((unite_catalogue <> 'ml'::text) OR (densite_kg_ml IS NOT NULL))),
    CONSTRAINT reference_check3 CHECK (((moq_kg IS NULL) OR (multiple_achat_kg IS NULL) OR (moq_kg >= multiple_achat_kg))),
    CONSTRAINT reference_classe_abc_check CHECK (((classe_abc IS NULL) OR (classe_abc = ANY (ARRAY['A'::text, 'B'::text, 'C'::text])))),
    CONSTRAINT reference_classe_xyz_check CHECK (((classe_xyz IS NULL) OR (classe_xyz = ANY (ARRAY['X'::text, 'Y'::text, 'Z'::text])))),
    CONSTRAINT reference_cmup_mad_check CHECK (((cmup_mad IS NULL) OR (cmup_mad >= (0)::numeric))),
    CONSTRAINT reference_couverture_min_mois_check CHECK (((couverture_min_mois IS NULL) OR (couverture_min_mois >= (0)::numeric))),
    CONSTRAINT reference_densite_kg_ml_check CHECK (((densite_kg_ml IS NULL) OR (densite_kg_ml > (0)::numeric))),
    CONSTRAINT reference_fusion_lot_check CHECK ((fusion_lot = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT reference_lot_convertible CHECK (((unite_catalogue <> 'Lot'::text) OR ((poids_bobine_kg IS NOT NULL) AND (bobines_par_lot IS NOT NULL)))),
    CONSTRAINT reference_marge_securite_pct_check CHECK (((marge_securite_pct IS NULL) OR (marge_securite_pct >= (0)::numeric))),
    CONSTRAINT reference_moq_kg_check CHECK (((moq_kg IS NULL) OR (moq_kg > (0)::numeric))),
    CONSTRAINT reference_multiple_achat_kg_check CHECK (((multiple_achat_kg IS NULL) OR (multiple_achat_kg > (0)::numeric))),
    CONSTRAINT reference_poids_bobine_kg_check CHECK (((poids_bobine_kg IS NULL) OR (poids_bobine_kg > (0)::numeric))),
    CONSTRAINT reference_prix_catalogue_check CHECK ((prix_catalogue > (0)::numeric)),
    CONSTRAINT reference_seuil_lot_valeur_check CHECK (((seuil_lot_valeur IS NULL) OR (seuil_lot_valeur > (0)::numeric))),
    CONSTRAINT reference_stock_min_kg_check CHECK (((stock_min_kg IS NULL) OR (stock_min_kg >= (0)::numeric))),
    CONSTRAINT reference_suivi_lot_check CHECK ((suivi_lot = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT reference_supplement_teinture_check CHECK (((supplement_teinture IS NULL) OR (supplement_teinture >= (0)::numeric))),
    CONSTRAINT reference_type_lot_check CHECK ((type_lot = ANY (ARRAY['OBLIGATOIRE'::text, 'GENERIQUE'::text, 'INDIFFERENT'::text]))),
    CONSTRAINT reference_unite_catalogue_check CHECK ((unite_catalogue = ANY (ARRAY['kg'::text, 'Palette'::text, 'Bobine'::text, 'ml'::text, 'Lot'::text])))
);


ALTER TABLE public.reference OWNER TO gestionfil;

--
-- Name: COLUMN reference.poids_bobine_kg; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.reference.poids_bobine_kg IS 'Poids net d UNE unite de conditionnement, en kg — une bobine, un rouleau, une
 cuve pleine. Le nom de la colonne dit « bobine » pour des raisons d historique :
 c est `code_conditionnement` qui dit de quelle unite il s agit.';


--
-- Name: COLUMN reference.bobines_par_palette; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.reference.bobines_par_palette IS 'Nombre d unites de conditionnement sur une palette complete : 120 bobines,
 480 petits rouleaux de Bande, 1 cuve de colle. Voir `code_conditionnement`.';


--
-- Name: COLUMN reference.code_conditionnement; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON COLUMN public.reference.code_conditionnement IS 'Ce dans quoi cette matiere arrive : bobine, rouleau, cuve, sac... Il decide du
 MOT employe a l ecran et du sens des deux colonnes ci-dessous.';


--
-- Name: reference_groupe_equiv; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.reference_groupe_equiv (
    id_ref_grp text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_reference text NOT NULL,
    code_groupe_equiv text NOT NULL,
    priorite bigint NOT NULL,
    est_preferentielle bigint DEFAULT 0 NOT NULL,
    date_debut text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    date_fin text,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT reference_groupe_equiv_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT reference_groupe_equiv_check CHECK (((date_fin IS NULL) OR (date_fin > date_debut))),
    CONSTRAINT reference_groupe_equiv_est_preferentielle_check CHECK ((est_preferentielle = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT reference_groupe_equiv_priorite_check CHECK ((priorite > 0))
);


ALTER TABLE public.reference_groupe_equiv OWNER TO gestionfil;

--
-- Name: role_bom; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.role_bom (
    code_role text NOT NULL,
    libelle text NOT NULL,
    description text,
    ordre_affichage bigint DEFAULT 0 NOT NULL,
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT role_bom_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.role_bom OWNER TO gestionfil;

--
-- Name: role_utilisateur; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.role_utilisateur (
    code_role_user text NOT NULL,
    libelle text NOT NULL,
    description text,
    niveau_hierarchique bigint DEFAULT 0 NOT NULL,
    plafond_validation_bc_mad numeric(18,2),
    actif bigint DEFAULT 1 NOT NULL,
    CONSTRAINT role_utilisateur_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.role_utilisateur OWNER TO gestionfil;

--
-- Name: snapshot_mrp; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.snapshot_mrp (
    id_snapshot text DEFAULT (gen_random_uuid())::text NOT NULL,
    date_snapshot text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    id_plan text NOT NULL,
    code_reference text NOT NULL,
    mois bigint NOT NULL,
    rang_mois bigint DEFAULT 0 NOT NULL,
    annee_mois text,
    quantite_besoin_kg numeric(18,4) NOT NULL,
    stock_projete_kg numeric(18,4),
    statut_couleur text,
    donnees_json text,
    CONSTRAINT snapshot_mrp_donnees_json_check CHECK (((donnees_json IS NULL) OR ((donnees_json)::jsonb IS NOT NULL))),
    CONSTRAINT snapshot_mrp_mois_check CHECK (((mois >= 1) AND (mois <= 12))),
    CONSTRAINT snapshot_mrp_rang_mois_check CHECK ((rang_mois >= 0)),
    CONSTRAINT snapshot_mrp_statut_couleur_check CHECK (((statut_couleur IS NULL) OR (statut_couleur = ANY (ARRAY['RUPTURE'::text, 'CRITIQUE'::text, 'ATTENTION'::text, 'OK'::text]))))
);


ALTER TABLE public.snapshot_mrp OWNER TO gestionfil;

--
-- Name: stock_lot; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.stock_lot (
    id_stock_lot text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_reference text NOT NULL,
    code_magasin text NOT NULL,
    lot_fournisseur text NOT NULL,
    quantite_kg numeric(18,4) DEFAULT 0 NOT NULL,
    prix_entree_mad numeric(18,4),
    nb_bobines bigint DEFAULT 0 NOT NULL,
    date_fabrication text,
    date_peremption text,
    date_premiere_entree text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    date_maj text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    code_couleur text,
    CONSTRAINT stock_lot_nb_bobines_check CHECK ((nb_bobines >= 0)),
    CONSTRAINT stock_lot_prix_entree_mad_check CHECK (((prix_entree_mad IS NULL) OR (prix_entree_mad >= (0)::numeric))),
    CONSTRAINT stock_lot_quantite_kg_check CHECK ((quantite_kg >= (0)::numeric))
);


ALTER TABLE public.stock_lot OWNER TO gestionfil;

--
-- Name: stock_magasin; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.stock_magasin (
    id_stock text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_reference text NOT NULL,
    code_magasin text NOT NULL,
    quantite_kg numeric(18,4) DEFAULT 0 NOT NULL,
    cmup_mad numeric(18,4),
    valeur_mad numeric(18,2) GENERATED ALWAYS AS ((quantite_kg * COALESCE(cmup_mad, (0)::numeric))) STORED,
    nb_bobines bigint DEFAULT 0 NOT NULL,
    date_derniere_entree text,
    date_derniere_sortie text,
    date_dernier_inventaire text,
    date_maj text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT stock_magasin_cmup_mad_check CHECK (((cmup_mad IS NULL) OR (cmup_mad >= (0)::numeric))),
    CONSTRAINT stock_magasin_nb_bobines_check CHECK ((nb_bobines >= 0)),
    CONSTRAINT stock_magasin_quantite_kg_check CHECK ((quantite_kg >= (0)::numeric))
);


ALTER TABLE public.stock_magasin OWNER TO gestionfil;

--
-- Name: taux_change; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.taux_change (
    id_taux text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_devise text NOT NULL,
    taux numeric(9,4) NOT NULL,
    date_debut text NOT NULL,
    date_fin text,
    source text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT taux_change_check CHECK (((date_fin IS NULL) OR (date_fin > date_debut))),
    CONSTRAINT taux_change_taux_check CHECK ((taux > (0)::numeric))
);


ALTER TABLE public.taux_change OWNER TO gestionfil;

--
-- Name: telechargement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.telechargement (
    id_telechargement text DEFAULT (gen_random_uuid())::text NOT NULL,
    fichier text NOT NULL,
    plateforme text NOT NULL,
    version text NOT NULL,
    taille_octets bigint,
    id_utilisateur text NOT NULL,
    adresse_ip text,
    date_telechargement text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL
);


ALTER TABLE public.telechargement OWNER TO gestionfil;

--
-- Name: transfert; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.transfert (
    id_transfert text DEFAULT (gen_random_uuid())::text NOT NULL,
    numero_transfert text NOT NULL,
    date_transfert text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    code_magasin_source text NOT NULL,
    code_magasin_dest text NOT NULL,
    statut text DEFAULT 'BROUILLON'::text NOT NULL,
    id_utilisateur text NOT NULL,
    id_utilisateur_reception text,
    date_sortie text,
    date_reception_dest text,
    responsable text,
    transporteur text,
    observations text,
    CONSTRAINT transfert_check CHECK ((code_magasin_source <> code_magasin_dest)),
    CONSTRAINT transfert_statut_check CHECK ((statut = ANY (ARRAY['BROUILLON'::text, 'VALIDE'::text, 'TERMINE'::text, 'ANNULE'::text])))
);


ALTER TABLE public.transfert OWNER TO gestionfil;

--
-- Name: transition_statut; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.transition_statut (
    entite text NOT NULL,
    statut_source text NOT NULL,
    statut_cible text NOT NULL,
    role_requis text,
    description text
);


ALTER TABLE public.transition_statut OWNER TO gestionfil;

--
-- Name: type_mouvement; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.type_mouvement (
    code_type_mvt text NOT NULL,
    libelle text NOT NULL,
    signe bigint NOT NULL,
    exige_prix bigint DEFAULT 0 NOT NULL,
    impacte_cmup bigint DEFAULT 0 NOT NULL,
    exige_of bigint DEFAULT 0 NOT NULL,
    exige_motif_ligne bigint DEFAULT 0 NOT NULL,
    couleur text,
    actif bigint DEFAULT 1 NOT NULL,
    interne bigint DEFAULT 0 NOT NULL,
    CONSTRAINT type_mouvement_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT type_mouvement_cmup_entree CHECK (((impacte_cmup = 0) OR (signe = 1))),
    CONSTRAINT type_mouvement_exige_motif_ligne_check CHECK ((exige_motif_ligne = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT type_mouvement_exige_of_check CHECK ((exige_of = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT type_mouvement_exige_prix_check CHECK ((exige_prix = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT type_mouvement_impacte_cmup_check CHECK ((impacte_cmup = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT type_mouvement_interne_check CHECK ((interne = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT type_mouvement_signe_check CHECK ((signe = ANY (ARRAY[('-1'::integer)::bigint, (1)::bigint])))
);


ALTER TABLE public.type_mouvement OWNER TO gestionfil;

--
-- Name: utilisateur; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.utilisateur (
    id_utilisateur text DEFAULT (gen_random_uuid())::text NOT NULL,
    code_role_user text NOT NULL,
    login text NOT NULL,
    mot_de_passe_hash text NOT NULL,
    nom text NOT NULL,
    email text,
    telephone text,
    magasin_principal text,
    date_creation text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    derniere_connexion text,
    actif bigint DEFAULT 1 NOT NULL,
    echecs_consecutifs bigint DEFAULT 0 NOT NULL,
    bloque_jusqu_a text,
    dernier_echec text,
    secret_totp text,
    totp_actif bigint DEFAULT 0 NOT NULL,
    totp_active_le text,
    mot_de_passe_change_le bigint,
    totp_dernier_pas bigint,
    CONSTRAINT ck_utilisateur_totp CHECK (((totp_actif = 0) OR (secret_totp IS NOT NULL))),
    CONSTRAINT utilisateur_actif_check CHECK ((actif = ANY (ARRAY[(0)::bigint, (1)::bigint]))),
    CONSTRAINT utilisateur_echecs_consecutifs_check CHECK ((echecs_consecutifs >= 0)),
    CONSTRAINT utilisateur_totp_actif_check CHECK ((totp_actif = ANY (ARRAY[(0)::bigint, (1)::bigint])))
);


ALTER TABLE public.utilisateur OWNER TO gestionfil;

--
-- Name: v_actualite; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_actualite AS
 WITH evenements AS (
         SELECT m.date_creation AS quand,
            'MOUVEMENT'::text AS categorie,
            ((tm.libelle || ' — '::text) || m.numero_mouvement) AS titre,
            ((mg.nom || ' · '::text) || COALESCE(( SELECT ((((round(sum(lm.quantite_kg)))::text || ' kg sur '::text) || (count(*))::text) || ' ligne(s)'::text)
                   FROM public.ligne_mouvement lm
                  WHERE (lm.id_mouvement = m.id_mouvement)), 'aucune ligne'::text)) AS detail,
            ('/mouvements/'::text || m.id_mouvement) AS chemin,
            m.id_utilisateur AS qui,
            NULL::numeric AS montant_total_mad
           FROM ((public.mouvement m
             JOIN public.type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
             JOIN public.magasin mg ON ((mg.code_magasin = m.code_magasin)))
        UNION ALL
         SELECT r.date_creation,
            'RECEPTION'::text,
            (('Réception '::text || r.numero_reception) || ' enregistrée'::text),
            COALESCE(f.nom, 'fournisseur inconnu'::text) AS "coalesce",
            ('/receptions/'::text || r.id_reception),
            r.id_utilisateur_reception,
            NULL::numeric
           FROM (public.reception r
             LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = r.code_fournisseur)))
        UNION ALL
         SELECT r.date_controle,
            'RECEPTION'::text,
            (('Réception '::text || r.numero_reception) || ' contrôlée'::text),
            ((COALESCE(f.nom, ''::text) || ' · '::text) || r.statut),
            ('/receptions/'::text || r.id_reception),
            r.id_utilisateur_controle,
            NULL::numeric
           FROM (public.reception r
             LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = r.code_fournisseur)))
          WHERE (r.date_controle IS NOT NULL)
        UNION ALL
         SELECT b.date_creation,
            'COMMANDE'::text,
            (('Bon '::text || b.numero_bc) || ' créé'::text),
            COALESCE(f.nom, ''::text) AS "coalesce",
            ('/bons-commande/'::text || b.id_bc),
            b.id_utilisateur_creation,
            NULL::numeric
           FROM (public.bon_commande b
             LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = b.code_fournisseur)))
        UNION ALL
         SELECT b.date_validation,
            'COMMANDE'::text,
            (('Bon '::text || b.numero_bc) || ' validé'::text),
            COALESCE(f.nom, ''::text) AS "coalesce",
            ('/bons-commande/'::text || b.id_bc),
            b.id_utilisateur_validation,
            round(b.montant_total_mad) AS round
           FROM (public.bon_commande b
             LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = b.code_fournisseur)))
          WHERE (b.date_validation IS NOT NULL)
        UNION ALL
         SELECT b.date_envoi,
            'COMMANDE'::text,
            (('Bon '::text || b.numero_bc) || ' envoyé au fournisseur'::text),
            COALESCE(f.nom, ''::text) AS "coalesce",
            ('/bons-commande/'::text || b.id_bc),
            b.id_utilisateur_validation,
            NULL::numeric
           FROM (public.bon_commande b
             LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = b.code_fournisseur)))
          WHERE (b.date_envoi IS NOT NULL)
        UNION ALL
         SELECT t.date_sortie,
            'TRANSFERT'::text,
            (('Transfert '::text || t.numero_transfert) || ' expédié'::text),
            ''::text,
            '/transferts'::text,
            t.id_utilisateur,
            NULL::numeric
           FROM public.transfert t
          WHERE (t.date_sortie IS NOT NULL)
        UNION ALL
         SELECT t.date_reception_dest,
            'TRANSFERT'::text,
            (('Transfert '::text || t.numero_transfert) || ' reçu'::text),
            ''::text,
            '/transferts'::text,
            t.id_utilisateur_reception,
            NULL::numeric
           FROM public.transfert t
          WHERE (t.date_reception_dest IS NOT NULL)
        UNION ALL
         SELECT i.date_creation,
            'INVENTAIRE'::text,
            'Inventaire ouvert'::text,
            mg.nom,
            '/inventaires'::text,
            i.id_utilisateur_responsable,
            NULL::numeric
           FROM (public.inventaire i
             JOIN public.magasin mg ON ((mg.code_magasin = i.code_magasin)))
        UNION ALL
         SELECT i.date_cloture,
            'INVENTAIRE'::text,
            'Inventaire clôturé'::text,
            mg.nom,
            '/inventaires'::text,
            i.id_utilisateur_responsable,
            NULL::numeric
           FROM (public.inventaire i
             JOIN public.magasin mg ON ((mg.code_magasin = i.code_magasin)))
          WHERE (i.date_cloture IS NOT NULL)
        UNION ALL
         SELECT p.date_validation,
            'PLAN'::text,
            (('Plan « '::text || p.libelle) || ' » validé'::text),
            ((p.date_debut || ' au '::text) || p.date_fin),
            '/plans'::text,
            p.id_utilisateur_validation,
            NULL::numeric
           FROM public.plan_production p
          WHERE (p.date_validation IS NOT NULL)
        UNION ALL
         SELECT p.date_cloture,
            'PLAN'::text,
            (('Plan « '::text || p.libelle) || ' » clôturé'::text),
            ''::text,
            '/plans'::text,
            p.id_utilisateur_cloture,
            NULL::numeric
           FROM public.plan_production p
          WHERE (p.date_cloture IS NOT NULL)
        UNION ALL
         SELECT max(pa.date_generation) AS max,
            'ACHAT'::text,
            'Plan d''achat recalculé'::text,
            ((count(*))::text || ' proposition(s)'::text),
            '/plan-achat'::text,
            NULL::text,
            round(sum(pa.montant_total_mad)) AS round
           FROM public.plan_achat pa
          WHERE (pa.date_generation IS NOT NULL)
          GROUP BY (substr(pa.date_generation, 1, 16))
        UNION ALL
         SELECT mf.date_validation,
            'MACHINE'::text,
            'Fiche machine validée'::text,
            COALESCE(mc.nom, mf.code_machine) AS "coalesce",
            '/machines'::text,
            mf.id_utilisateur_validation,
            NULL::numeric
           FROM (public.machine_fiche mf
             LEFT JOIN public.machine mc ON ((mc.code_machine = mf.code_machine)))
          WHERE (mf.date_validation IS NOT NULL)
        )
 SELECT e.quand,
    e.categorie,
    e.titre,
    NULLIF(e.detail, ''::text) AS detail,
    e.chemin,
    u.login AS par,
    (e.montant_total_mad)::double precision AS montant_total_mad
   FROM (evenements e
     LEFT JOIN public.utilisateur u ON ((u.id_utilisateur = e.qui)))
  WHERE (e.quand IS NOT NULL)
  ORDER BY e.quand DESC;


ALTER VIEW public.v_actualite OWNER TO gestionfil;

--
-- Name: VIEW v_actualite; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON VIEW public.v_actualite IS 'Le fil des evenements metier, le plus recent d''abord : ce qui s''est passe dans l''ERP.';


--
-- Name: v_besoin_12m; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_besoin_12m AS
 WITH horizon AS (
         SELECT besoin_mrp.id_plan,
            count(DISTINCT besoin_mrp.annee_mois) AS mois
           FROM public.besoin_mrp
          WHERE (besoin_mrp.annee_mois >= to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text))
          GROUP BY besoin_mrp.id_plan
        )
 SELECT bm.code_reference,
    round(sum(bm.quantite_kg), 4) AS besoin_12m_kg,
    round((sum(bm.quantite_kg) / (
        CASE
            WHEN (min(h.mois) > 0) THEN min(h.mois)
            ELSE (1)::bigint
        END)::numeric), 4) AS besoin_mensuel_moyen_kg
   FROM ((public.besoin_mrp bm
     JOIN public.plan_production pp ON ((pp.id_plan = bm.id_plan)))
     JOIN horizon h ON ((h.id_plan = bm.id_plan)))
  WHERE ((pp.statut = 'EN_COURS'::text) AND ((to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) >= pp.date_debut) AND (to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) <= pp.date_fin)) AND (bm.annee_mois >= to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text)))
  GROUP BY bm.code_reference;


ALTER VIEW public.v_besoin_12m OWNER TO gestionfil;

--
-- Name: v_besoin_horizon; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_besoin_horizon AS
 WITH p AS (
         SELECT ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_DelaiDefaut'::text)) AS delai_defaut,
            ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_MargeJours'::text)) AS marge_jours,
            (((((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval))::date - CURRENT_DATE))::numeric / EXTRACT(day FROM (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon -1 days'::interval))) AS reste_mois,
            (COALESCE(( SELECT parametre.valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_HorizonProlonge'::text)), '1'::text) = '1'::text) AS prolonger
        ), mois AS (
         SELECT i.i,
            to_char((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + (((i.i - 1) || ' month'::text))::interval), 'YYYY-MM'::text) AS annee_mois,
                CASE
                    WHEN (i.i = 1) THEN (0)::numeric
                    ELSE ((30.0 * p.reste_mois) + (((i.i - 2))::numeric * 30.0))
                END AS debut_j,
            ((30.0 * p.reste_mois) + (((i.i - 1))::numeric * 30.0)) AS fin_j
           FROM (generate_series(1, 12) i(i)
             CROSS JOIN p)
        ), fenetre AS (
         SELECT r.code_reference,
            COALESCE((f.delai_livraison_jours)::numeric, p.delai_defaut) AS lead_j,
            COALESCE((f.couverture_commande_j)::numeric, p.marge_jours) AS couv_j
           FROM ((public.reference r
             LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = r.code_fournisseur)))
             CROSS JOIN p)
        ), besoin_plan AS (
         SELECT bm_1.code_reference,
            bm_1.annee_mois,
            bm_1.quantite_kg
           FROM (public.besoin_mrp bm_1
             JOIN public.plan_production pp ON ((pp.id_plan = bm_1.id_plan)))
          WHERE (pp.statut = 'EN_COURS'::text)
        ), etendue AS (
         SELECT max(besoin_plan.annee_mois) AS dernier,
            count(DISTINCT besoin_plan.annee_mois) AS nb
           FROM besoin_plan
        ), besoin AS (
         SELECT besoin_plan.code_reference,
            besoin_plan.annee_mois,
            besoin_plan.quantite_kg
           FROM besoin_plan
        UNION ALL
         SELECT b.code_reference,
            m_1.annee_mois,
            (sum(b.quantite_kg) / (NULLIF(e.nb, 0))::numeric)
           FROM (((besoin_plan b
             CROSS JOIN etendue e)
             CROSS JOIN mois m_1)
             CROSS JOIN p)
          WHERE (p.prolonger AND (m_1.annee_mois > e.dernier))
          GROUP BY b.code_reference, m_1.annee_mois, e.nb
        )
 SELECT w.code_reference,
    w.lead_j,
    w.couv_j,
    round(COALESCE(sum(((bm.quantite_kg * GREATEST((0)::numeric, (LEAST(m.fin_j, w.lead_j) - m.debut_j))) / 30.0)), (0)::numeric), 4) AS dem_lead_kg,
    round(COALESCE(sum(((bm.quantite_kg * GREATEST((0)::numeric, (LEAST(m.fin_j, (w.lead_j + w.couv_j)) - GREATEST(m.debut_j, w.lead_j)))) / 30.0)), (0)::numeric), 4) AS sorties_prevues_kg
   FROM ((fenetre w
     CROSS JOIN mois m)
     LEFT JOIN besoin bm ON (((bm.code_reference = w.code_reference) AND (bm.annee_mois = m.annee_mois))))
  GROUP BY w.code_reference, w.lead_j, w.couv_j;


ALTER VIEW public.v_besoin_horizon OWNER TO gestionfil;

--
-- Name: v_machine_ecart; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_machine_ecart AS
 SELECT d.id_decision,
    d.id_fiche,
    f.numero_fiche,
    d.nature,
    d.code_machine,
    d.code_emplacement,
    z.libelle AS zone,
    d.date_decision,
    l.ligne_numero,
    l.code_reference,
    r.designation,
    l.lot_fournisseur,
    l.kg_avant,
    l.kg_mouvementes,
    l.destination,
    l.kg_apres,
    l.ecart_kg,
    l.effet_ecart,
    l.code_motif,
    m.libelle AS motif,
    l.motif_texte
   FROM (((((public.machine_decision d
     JOIN public.machine_decision_ligne l ON ((l.id_decision = d.id_decision)))
     JOIN public.machine_emplacement z ON ((z.code_emplacement = d.code_emplacement)))
     JOIN public.reference r ON ((r.code_reference = l.code_reference)))
     JOIN public.machine_motif m ON ((m.code_motif = l.code_motif)))
     LEFT JOIN public.machine_fiche f ON ((f.id_fiche = d.id_fiche)))
  WHERE (d.statut = 'ACTIVE'::text);


ALTER VIEW public.v_machine_ecart OWNER TO gestionfil;

--
-- Name: v_conso_reelle; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_conso_reelle AS
 WITH conso AS (
         SELECT lm.code_reference,
            lm.quantite_kg AS kg_prod,
            (0)::numeric AS kg_machine,
            m.date_mouvement AS quand
           FROM ((public.ligne_mouvement lm
             JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
             JOIN public.type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
          WHERE ((tm.signe = '-1'::integer) AND (m.code_type_mvt = 'SORTIE_PROD'::text))
        UNION ALL
         SELECT e.code_reference,
            (0)::numeric AS "numeric",
            e.ecart_kg,
            e.date_decision
           FROM public.v_machine_ecart e
          WHERE ((e.effet_ecart = 'CONSOMMATION'::text) AND (e.ecart_kg > (0)::numeric))
        )
 SELECT code_reference,
    round(sum((kg_prod + kg_machine)), 4) AS sorties_cumulees_kg,
    GREATEST((1)::bigint, ((((CURRENT_DATE - (min(substr(quand, 1, 10)))::date))::numeric / 30.44))::bigint) AS nb_mois_ecoules,
    round((sum((kg_prod + kg_machine)) / (GREATEST((1)::bigint, ((((CURRENT_DATE - (min(substr(quand, 1, 10)))::date))::numeric / 30.44))::bigint))::numeric), 4) AS conso_mensuelle_kg,
    min(quand) AS premiere_sortie,
    max(quand) AS derniere_sortie,
    round(sum(kg_prod), 4) AS sorties_prod_kg,
    round(sum(kg_machine), 4) AS conso_machine_kg
   FROM conso
  GROUP BY code_reference;


ALTER VIEW public.v_conso_reelle OWNER TO gestionfil;

--
-- Name: v_conso_retenue; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_conso_retenue AS
 SELECT r.code_reference,
    NULLIF(GREATEST(COALESCE(cr.conso_mensuelle_kg, (0)::numeric), COALESCE(b.besoin_mensuel_moyen_kg, (0)::numeric)), (0)::numeric) AS conso_mensuelle_kg,
    round(COALESCE(cr.conso_mensuelle_kg, (0)::numeric), 4) AS conso_reelle_kg,
    round(COALESCE(b.besoin_mensuel_moyen_kg, (0)::numeric), 4) AS conso_previsionnelle_kg,
        CASE
            WHEN ((cr.conso_mensuelle_kg IS NULL) AND (b.besoin_mensuel_moyen_kg IS NULL)) THEN 'INDETERMINEE'::text
            WHEN (COALESCE(cr.conso_mensuelle_kg, (0)::numeric) >= COALESCE(b.besoin_mensuel_moyen_kg, (0)::numeric)) THEN 'REELLE'::text
            ELSE 'PREVISIONNELLE_MRP'::text
        END AS source_conso,
    cr.nb_mois_ecoules
   FROM ((public.reference r
     LEFT JOIN public.v_conso_reelle cr ON ((cr.code_reference = r.code_reference)))
     LEFT JOIN public.v_besoin_12m b ON ((b.code_reference = r.code_reference)))
  WHERE (r.actif = 1);


ALTER VIEW public.v_conso_retenue OWNER TO gestionfil;

--
-- Name: v_encours_fiable; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_encours_fiable AS
 WITH p_ret AS (
         SELECT ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_RetardBCJours'::text)) AS v,
            (COALESCE(( SELECT parametre.valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_EncoursRetardInclus'::text)), '1'::text) = '1'::text) AS inclure
        ), bons AS (
         SELECT lb.code_reference,
            lb.quantite_restante_kg AS kg,
            (substr(lb.date_livraison_prevue, 1, 10) < to_char(((CURRENT_DATE - (p_ret.v)::integer))::timestamp with time zone, 'YYYY-MM-DD'::text)) AS en_retard,
            lb.date_livraison_prevue
           FROM ((public.ligne_bc lb
             JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
             CROSS JOIN p_ret)
          WHERE ((bc.statut = ANY (ARRAY['VALIDE'::text, 'ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND (lb.statut <> ALL (ARRAY['ANNULE'::text, 'SOLDE'::text])) AND (lb.type_ligne = 'MARCHANDISE'::text) AND (lb.quantite_restante_kg > (0)::numeric))
        ), port AS (
         SELECT fl.code_reference,
            sum(fl.reste_kg) AS kg
           FROM ((public.import_facture_lignes fl
             JOIN public.import_factures f ON ((f.id_facture = fl.id_facture)))
             JOIN public.import_dossiers d ON ((d.id_dossier = f.id_dossier)))
          WHERE ((d.statut <> 'CLOTURE'::text) AND (fl.type_ligne = 'ERP'::text) AND (fl.soldee = 0) AND (fl.id_ligne_bc IS NULL) AND (fl.reste_kg > (0)::numeric))
          GROUP BY fl.code_reference
        ), refs AS (
         SELECT bons.code_reference
           FROM bons
        UNION
         SELECT port.code_reference
           FROM port
        )
 SELECT code_reference,
    round((COALESCE(( SELECT sum(b.kg) AS sum
           FROM (bons b
             CROSS JOIN p_ret)
          WHERE ((b.code_reference = r.code_reference) AND ((NOT COALESCE(b.en_retard, false)) OR p_ret.inclure))), (0)::numeric) + COALESCE(( SELECT po.kg
           FROM port po
          WHERE (po.code_reference = r.code_reference)), (0)::numeric)), 4) AS encours_fiable_kg,
    round(COALESCE(( SELECT sum(b.kg) AS sum
           FROM bons b
          WHERE ((b.code_reference = r.code_reference) AND b.en_retard)), (0)::numeric), 4) AS encours_retarde_kg,
    ( SELECT count(*) AS count
           FROM bons b
          WHERE ((b.code_reference = r.code_reference) AND b.en_retard)) AS nb_lignes_retardees,
    ( SELECT min(b.date_livraison_prevue) AS min
           FROM bons b
          WHERE ((b.code_reference = r.code_reference) AND b.en_retard)) AS plus_ancien_retard,
    ( SELECT (max((CURRENT_DATE - (b.date_livraison_prevue)::date)))::bigint AS max
           FROM bons b
          WHERE ((b.code_reference = r.code_reference) AND b.en_retard)) AS retard_max_jours,
    round(COALESCE(( SELECT po.kg
           FROM port po
          WHERE (po.code_reference = r.code_reference)), (0)::numeric), 4) AS encours_import_kg
   FROM refs r;


ALTER VIEW public.v_encours_fiable OWNER TO gestionfil;

--
-- Name: v_stock_disponible; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stock_disponible AS
 SELECT r.code_reference,
    round(COALESCE(sum(
        CASE
            WHEN (mg.inclure_mrp = 1) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric), 4) AS stock_mrp_kg,
    round(COALESCE(sum(sm.quantite_kg), (0)::numeric), 4) AS stock_total_kg,
    round(COALESCE(sum(
        CASE
            WHEN (mg.est_quarantaine = 1) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric), 4) AS stock_quarantaine_kg,
    round(COALESCE(sum((sm.quantite_kg * COALESCE(sm.cmup_mad, (0)::numeric))), (0)::numeric), 2) AS valeur_totale_mad,
    max(sm.date_derniere_entree) AS date_derniere_entree,
    max(sm.date_derniere_sortie) AS date_derniere_sortie
   FROM ((public.reference r
     LEFT JOIN public.stock_magasin sm ON ((sm.code_reference = r.code_reference)))
     LEFT JOIN public.magasin mg ON ((mg.code_magasin = sm.code_magasin)))
  WHERE (r.actif = 1)
  GROUP BY r.code_reference;


ALTER VIEW public.v_stock_disponible OWNER TO gestionfil;

--
-- Name: v_stock_min_dynamique; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stock_min_dynamique AS
 SELECT r.code_reference,
    COALESCE(r.stock_min_kg, (0)::numeric) AS terme1_catalogue_kg,
    round(((COALESCE(r.couverture_min_mois, p_couv.v) * COALESCE(cr.conso_mensuelle_kg, (0)::numeric)) * ((1)::numeric + (COALESCE(r.marge_securite_pct, p_marge.v) / 100.0))), 4) AS terme2_couverture_kg,
    round(((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) * COALESCE((f.delai_livraison_jours)::numeric, p_delai.v)) / 30.0), 4) AS terme3_delai_kg,
    round(((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) *
        CASE r.classe_abc
            WHEN 'A'::text THEN p_seca.v
            WHEN 'B'::text THEN p_secb.v
            ELSE p_secc.v
        END) / 30.0), 4) AS terme4_securite_abc_kg,
    round(GREATEST(COALESCE(r.stock_min_kg, (0)::numeric), ((COALESCE(r.couverture_min_mois, p_couv.v) * COALESCE(cr.conso_mensuelle_kg, (0)::numeric)) * ((1)::numeric + (COALESCE(r.marge_securite_pct, p_marge.v) / 100.0))), ((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) * COALESCE((f.delai_livraison_jours)::numeric, p_delai.v)) / 30.0), ((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) *
        CASE r.classe_abc
            WHEN 'A'::text THEN p_seca.v
            WHEN 'B'::text THEN p_secb.v
            ELSE p_secc.v
        END) / 30.0)), 4) AS stock_min_kg
   FROM ((((((((public.reference r
     LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = r.code_fournisseur)))
     LEFT JOIN public.v_conso_retenue cr ON ((cr.code_reference = r.code_reference)))
     CROSS JOIN ( SELECT (parametre.valeur_courante)::numeric AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_CouvMinMois'::text)) p_couv)
     CROSS JOIN ( SELECT (parametre.valeur_courante)::numeric AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_MargeSecurite'::text)) p_marge)
     CROSS JOIN ( SELECT (parametre.valeur_courante)::numeric AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_DelaiDefaut'::text)) p_delai)
     CROSS JOIN ( SELECT (parametre.valeur_courante)::numeric AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_SecuriteA'::text)) p_seca)
     CROSS JOIN ( SELECT (parametre.valeur_courante)::numeric AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_SecuriteB'::text)) p_secb)
     CROSS JOIN ( SELECT (parametre.valeur_courante)::numeric AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_SecuriteC'::text)) p_secc)
  WHERE (r.actif = 1);


ALTER VIEW public.v_stock_min_dynamique OWNER TO gestionfil;

--
-- Name: v_stock_physique; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stock_physique AS
 WITH hors_mrp AS (
         SELECT sl.code_reference,
            sum(
                CASE
                    WHEN ((l.categorie = 'RESTES'::text) AND (rr.suivi_lot = 1) AND (l.statut <> 'BLOQUE'::text)) THEN sl.quantite_kg
                    ELSE (0)::numeric
                END) AS restes_kg,
            sum(
                CASE
                    WHEN (l.statut = 'BLOQUE'::text) THEN sl.quantite_kg
                    ELSE (0)::numeric
                END) AS bloque_kg
           FROM (((public.stock_lot sl
             JOIN public.lot l ON (((l.code_reference = sl.code_reference) AND (l.lot_fournisseur = sl.lot_fournisseur))))
             JOIN public.reference rr ON ((rr.code_reference = sl.code_reference)))
             JOIN public.magasin mg_1 ON ((mg_1.code_magasin = sl.code_magasin)))
          WHERE ((mg_1.inclure_mrp = 1) AND (mg_1.est_quarantaine = 0))
          GROUP BY sl.code_reference
        ), machine AS (
         SELECT e.code_reference,
            round(sum(e.kg), 4) AS kg_sur_machine
           FROM (public.machine_etat e
             LEFT JOIN public.lot l ON (((l.code_reference = e.code_reference) AND (l.lot_fournisseur = e.lot_fournisseur))))
          WHERE ((COALESCE(( SELECT parametre.valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_MrpInclureStockMachine'::text)), '1'::text) = '1'::text) AND (COALESCE(l.statut, 'LIBRE'::text) <> 'BLOQUE'::text) AND ((substr(COALESCE(e.date_constat, '1900-01-01'::text), 1, 10))::date >= (CURRENT_DATE - COALESCE(( SELECT (parametre.valeur_courante)::integer AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_JoursInventMachine'::text)), 30))))
          GROUP BY e.code_reference
        )
 SELECT r.code_reference,
    round(COALESCE(sum(
        CASE
            WHEN ((mg.inclure_mrp = 1) AND (mg.est_quarantaine = 0)) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric), 4) AS stock_utilisable_kg,
    round(COALESCE(sum(
        CASE
            WHEN (mg.est_quarantaine = 1) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric), 4) AS stock_quarantaine_kg,
    round((COALESCE(max(h.restes_kg), (0)::numeric) + COALESCE(max(h.bloque_kg), (0)::numeric)), 4) AS stock_reserve_kg,
    round(((COALESCE(sum(
        CASE
            WHEN ((mg.inclure_mrp = 1) AND (mg.est_quarantaine = 0)) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric) - COALESCE(max(h.restes_kg), (0)::numeric)) - COALESCE(max(h.bloque_kg), (0)::numeric)), 4) AS stock_physique_net_kg,
    round(COALESCE(max(h.restes_kg), (0)::numeric), 4) AS stock_restes_kg,
    round(COALESCE(max(h.bloque_kg), (0)::numeric), 4) AS stock_bloque_kg,
    round(COALESCE(max(mc.kg_sur_machine), (0)::numeric), 4) AS stock_machine_kg,
    round((((COALESCE(sum(
        CASE
            WHEN ((mg.inclure_mrp = 1) AND (mg.est_quarantaine = 0)) THEN sm.quantite_kg
            ELSE NULL::numeric
        END), (0)::numeric) - COALESCE(max(h.restes_kg), (0)::numeric)) - COALESCE(max(h.bloque_kg), (0)::numeric)) + COALESCE(max(mc.kg_sur_machine), (0)::numeric)), 4) AS stock_mrp_net_kg
   FROM ((((public.reference r
     LEFT JOIN public.stock_magasin sm ON ((sm.code_reference = r.code_reference)))
     LEFT JOIN public.magasin mg ON ((mg.code_magasin = sm.code_magasin)))
     LEFT JOIN hors_mrp h ON ((h.code_reference = r.code_reference)))
     LEFT JOIN machine mc ON ((mc.code_reference = r.code_reference)))
  WHERE (r.actif = 1)
  GROUP BY r.code_reference;


ALTER VIEW public.v_stock_physique OWNER TO gestionfil;

--
-- Name: v_stock_projete; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stock_projete AS
 SELECT r.code_reference,
    r.designation,
    r.code_fournisseur,
    f.nom AS fournisseur_nom,
    f.pays AS fournisseur_pays,
    COALESCE(f.delai_livraison_jours, (p_delai.v)::bigint) AS delai_livraison_jours,
    r.classe_abc,
    r.classe_xyz,
    r.unite_catalogue,
    r.cmup_mad,
    sd.stock_mrp_kg,
    sd.stock_total_kg,
    sd.valeur_totale_mad,
    ph.stock_physique_net_kg,
    ph.stock_quarantaine_kg,
    ph.stock_reserve_kg,
    COALESCE(ef.encours_fiable_kg, (0)::numeric) AS encours_kg,
    COALESCE(ef.encours_retarde_kg, (0)::numeric) AS encours_retarde_kg,
    COALESCE(ef.nb_lignes_retardees, (0)::bigint) AS nb_lignes_retardees,
    ef.retard_max_jours,
    COALESCE(b.besoin_12m_kg, (0)::numeric) AS besoin_12m_kg,
    round(((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)), 4) AS stock_projete_kg,
    cr.conso_mensuelle_kg,
    cr.source_conso,
        CASE
            WHEN (COALESCE(cr.conso_mensuelle_kg, (0)::numeric) > (0)::numeric) THEN round((((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) / (cr.conso_mensuelle_kg / 30.0)), 1)
            ELSE NULL::numeric
        END AS jours_couverture,
    (p_crit.v)::numeric AS seuil_critique_jours,
    (p_alerte.v)::numeric AS seuil_alerte_jours,
    sm.stock_min_kg,
    sm.terme2_couverture_kg,
    round(GREATEST((sm.stock_min_kg * 1.5), (sm.stock_min_kg + ((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) * (p_marge.v)::numeric) / 30.0))), 4) AS stock_max_kg,
        CASE
            WHEN ((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) = (0)::numeric) AND (COALESCE(b.besoin_12m_kg, (0)::numeric) = (0)::numeric)) THEN 'OK'::text
            WHEN (((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) <= (0)::numeric) THEN 'RUPTURE'::text
            WHEN (COALESCE(cr.conso_mensuelle_kg, (0)::numeric) = (0)::numeric) THEN 'OK'::text
            WHEN ((((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) / (cr.conso_mensuelle_kg / 30.0)) < (p_crit.v)::numeric) THEN 'CRITIQUE'::text
            WHEN ((((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) / (cr.conso_mensuelle_kg / 30.0)) < (p_alerte.v)::numeric) THEN 'ATTENTION'::text
            ELSE 'OK'::text
        END AS statut_logique,
        CASE
            WHEN ((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) = (0)::numeric) AND (COALESCE(b.besoin_12m_kg, (0)::numeric) = (0)::numeric)) THEN 'OK'::text
            WHEN (ph.stock_physique_net_kg <= (0)::numeric) THEN 'RUPTURE'::text
            WHEN ((COALESCE(sm.stock_min_kg, (0)::numeric) > (0)::numeric) AND (ph.stock_physique_net_kg < sm.stock_min_kg)) THEN 'CRITIQUE'::text
            ELSE 'OK'::text
        END AS statut_physique,
        CASE
            WHEN ((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) = (0)::numeric) AND (COALESCE(b.besoin_12m_kg, (0)::numeric) = (0)::numeric)) THEN 'OK'::text
            WHEN ((ph.stock_physique_net_kg <= (0)::numeric) OR (((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) <= (0)::numeric)) THEN 'RUPTURE'::text
            WHEN ((COALESCE(sm.stock_min_kg, (0)::numeric) > (0)::numeric) AND (ph.stock_physique_net_kg < sm.stock_min_kg)) THEN 'CRITIQUE'::text
            WHEN (COALESCE(cr.conso_mensuelle_kg, (0)::numeric) = (0)::numeric) THEN 'OK'::text
            WHEN ((((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) / (cr.conso_mensuelle_kg / 30.0)) < (p_crit.v)::numeric) THEN 'CRITIQUE'::text
            WHEN ((((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) / (cr.conso_mensuelle_kg / 30.0)) < (p_alerte.v)::numeric) THEN 'ATTENTION'::text
            ELSE 'OK'::text
        END AS statut,
        CASE
            WHEN ((COALESCE(sm.stock_min_kg, (0)::numeric) > (0)::numeric) AND (((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) > GREATEST((sm.stock_min_kg * 1.5), (sm.stock_min_kg + ((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) * (p_marge.v)::numeric) / 30.0))))) THEN 1
            ELSE 0
        END AS sur_stock,
        CASE
            WHEN ((COALESCE(cr.conso_mensuelle_kg, (0)::numeric) > (0)::numeric) AND ((((ph.stock_mrp_net_kg + COALESCE(ef.encours_fiable_kg, (0)::numeric)) - COALESCE(bh.dem_lead_kg, (0)::numeric)) / (cr.conso_mensuelle_kg / 30.0)) > (p_ecart.v)::numeric) AND (ph.stock_physique_net_kg < COALESCE(r.stock_min_kg, (0)::numeric))) THEN 1
            ELSE 0
        END AS ecart_majeur,
    ( SELECT max(besoin_mrp.date_calcul) AS max
           FROM public.besoin_mrp) AS besoins_calcules_le,
    COALESCE(bh.dem_lead_kg, (0)::numeric) AS demande_delai_kg,
    COALESCE(bh.sorties_prevues_kg, (0)::numeric) AS sorties_prevues_kg,
    ph.stock_machine_kg
   FROM (((((((((((((public.reference r
     JOIN public.v_stock_disponible sd ON ((sd.code_reference = r.code_reference)))
     JOIN public.v_stock_physique ph ON ((ph.code_reference = r.code_reference)))
     JOIN public.v_stock_min_dynamique sm ON ((sm.code_reference = r.code_reference)))
     LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = r.code_fournisseur)))
     LEFT JOIN public.v_encours_fiable ef ON ((ef.code_reference = r.code_reference)))
     LEFT JOIN public.v_besoin_12m b ON ((b.code_reference = r.code_reference)))
     LEFT JOIN public.v_besoin_horizon bh ON ((bh.code_reference = r.code_reference)))
     LEFT JOIN public.v_conso_retenue cr ON ((cr.code_reference = r.code_reference)))
     CROSS JOIN ( SELECT parametre.valeur_courante AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_DelaiDefaut'::text)) p_delai)
     CROSS JOIN ( SELECT parametre.valeur_courante AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_SeuilCritique'::text)) p_crit)
     CROSS JOIN ( SELECT parametre.valeur_courante AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_SeuilAlerte'::text)) p_alerte)
     CROSS JOIN ( SELECT parametre.valeur_courante AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_MargeJours'::text)) p_marge)
     CROSS JOIN ( SELECT parametre.valeur_courante AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_EcartCouvertureJours'::text)) p_ecart)
  WHERE (r.actif = 1);


ALTER VIEW public.v_stock_projete OWNER TO gestionfil;

--
-- Name: v_analyse_abc_xyz; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_analyse_abc_xyz AS
 WITH valeur AS (
         SELECT sp.code_reference,
            sp.designation,
            sp.fournisseur_nom,
            sp.statut,
            sp.jours_couverture,
            sp.conso_mensuelle_kg,
            sp.cmup_mad,
            sp.valeur_totale_mad,
            r.classe_abc,
            r.classe_xyz,
            r.date_dernier_abc,
            round(((COALESCE(sp.conso_mensuelle_kg, (0)::numeric) * (12)::numeric) * COALESCE(sp.cmup_mad, (0)::numeric)), 2) AS valeur_conso_annuelle_mad
           FROM (public.v_stock_projete sp
             JOIN public.reference r ON ((r.code_reference = sp.code_reference)))
          WHERE (r.actif = 1)
        ), total AS (
         SELECT sum(valeur.valeur_conso_annuelle_mad) AS t
           FROM valeur
        )
 SELECT code_reference,
    designation,
    fournisseur_nom,
    statut,
    jours_couverture,
    conso_mensuelle_kg,
    cmup_mad,
    valeur_totale_mad,
    classe_abc,
    classe_xyz,
    date_dernier_abc,
    valeur_conso_annuelle_mad,
    ( SELECT (count(*) + 1)
           FROM valeur w
          WHERE (w.valeur_conso_annuelle_mad > v.valeur_conso_annuelle_mad)) AS rang,
    round(((( SELECT sum(w.valeur_conso_annuelle_mad) AS sum
           FROM valeur w
          WHERE (w.valeur_conso_annuelle_mad >= v.valeur_conso_annuelle_mad)) * 100.0) / NULLIF(( SELECT total.t
           FROM total), (0)::numeric)), 4) AS pct_cumule,
    round(((valeur_conso_annuelle_mad * 100.0) / NULLIF(( SELECT total.t
           FROM total), (0)::numeric)), 4) AS part_pct,
        CASE
            WHEN ((classe_abc IS NULL) OR (classe_xyz IS NULL)) THEN 'A classer'::text
            WHEN ((classe_abc = 'A'::text) AND (classe_xyz = 'X'::text)) THEN 'Flux tendu, commandes cadencees'::text
            WHEN ((classe_abc = 'A'::text) AND (classe_xyz = 'Y'::text)) THEN 'Stock de securite modere, revue mensuelle'::text
            WHEN ((classe_abc = 'A'::text) AND (classe_xyz = 'Z'::text)) THEN 'Stock de securite eleve et suivi rapproche'::text
            WHEN ((classe_abc = 'B'::text) AND (classe_xyz = 'X'::text)) THEN 'Reapprovisionnement automatique'::text
            WHEN (classe_abc = 'B'::text) THEN 'Revue trimestrielle'::text
            WHEN ((classe_abc = 'C'::text) AND (classe_xyz = 'X'::text)) THEN 'Commande automatique, lot economique'::text
            ELSE 'A la demande, sans stock dedie'::text
        END AS politique
   FROM valeur v;


ALTER VIEW public.v_analyse_abc_xyz OWNER TO gestionfil;

--
-- Name: v_archive_reception_courante; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_archive_reception_courante AS
 SELECT id_archive,
    id_ligne_reception,
    numero_reception,
    code_reference,
    code_fournisseur,
    date_reception,
    lot_fournisseur,
    quantite_pesee_unite,
    unite_saisie,
    quantite_stock_kg,
    prix_kg_devise,
    code_devise,
    taux_change,
    prix_kg_mad,
    total_mad,
    code_magasin_dest,
    statut_qualite,
    ecart_pct,
    conformite_specifications,
    conformite_quantite,
    conformite_delai,
    jours_retard,
    documents_attaches,
    photos,
    date_archive,
    id_utilisateur_archive,
    version
   FROM public.archive_reception a
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.archive_reception b
          WHERE ((b.id_ligne_reception = a.id_ligne_reception) AND (b.version > a.version)))));


ALTER VIEW public.v_archive_reception_courante OWNER TO gestionfil;

--
-- Name: v_besoin_mrp_calcule; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_besoin_mrp_calcule AS
SELECT
    NULL::text AS id_plan,
    NULL::text AS plan_libelle,
    NULL::bigint AS annee,
    NULL::bigint AS mois,
    NULL::bigint AS rang_mois,
    NULL::text AS annee_mois,
    NULL::text AS code_reference,
    NULL::numeric AS quantite_brute_kg,
    NULL::numeric(9,4) AS taux_perte_pct,
    NULL::numeric AS quantite_kg;


ALTER VIEW public.v_besoin_mrp_calcule OWNER TO gestionfil;

--
-- Name: v_cockpit_cout_mensuel; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_cout_mensuel AS
 SELECT bm.annee_mois,
    round(sum(bm.quantite_kg), 4) AS quantite_kg,
    round(sum((bm.quantite_kg * COALESCE(r.cmup_mad, (0)::numeric))), 2) AS cout_mad,
    count(DISTINCT bm.code_reference) AS nb_references
   FROM ((public.besoin_mrp bm
     JOIN public.plan_production pp ON (((pp.id_plan = bm.id_plan) AND (pp.statut = 'EN_COURS'::text))))
     JOIN public.reference r ON ((r.code_reference = bm.code_reference)))
  WHERE (bm.annee_mois >= to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text))
  GROUP BY bm.annee_mois;


ALTER VIEW public.v_cockpit_cout_mensuel OWNER TO gestionfil;

--
-- Name: v_cockpit_couverture; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_couverture AS
 WITH tranches(rang, libelle, borne_min, borne_max) AS (
         VALUES (1,'RUPTURE (<0)'::text,NULL::numeric,0.0), (2,'0-30 j'::text,0.0,30.0), (3,'30-60 j'::text,30.0,60.0), (4,'60-90 j'::text,60.0,90.0), (5,'90-180 j'::text,90.0,180.0), (6,'>180 j'::text,180.0,NULL::numeric)
        )
 SELECT rang,
    libelle,
    ( SELECT count(*) AS count
           FROM public.v_stock_projete sp
          WHERE ((sp.jours_couverture IS NOT NULL) AND ((t.borne_min IS NULL) OR (sp.jours_couverture >= t.borne_min)) AND ((t.borne_max IS NULL) OR (sp.jours_couverture < t.borne_max)))) AS nb_references
   FROM tranches t;


ALTER VIEW public.v_cockpit_couverture OWNER TO gestionfil;

--
-- Name: v_cockpit_devise; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_devise AS
 WITH budget AS (
         SELECT r.code_devise_catalogue AS code_devise,
            count(*) AS nb_references,
            sum(((COALESCE(sp.conso_mensuelle_kg, (0)::numeric) * (12)::numeric) * COALESCE(sp.cmup_mad, (0)::numeric))) AS montant_mad
           FROM (public.reference r
             JOIN public.v_stock_projete sp ON ((sp.code_reference = r.code_reference)))
          WHERE (r.actif = 1)
          GROUP BY r.code_devise_catalogue
        )
 SELECT code_devise,
    nb_references,
    round(montant_mad, 2) AS montant_mad,
    round(((montant_mad * 100.0) / NULLIF(( SELECT sum(budget.montant_mad) AS sum
           FROM budget), (0)::numeric)), 2) AS part_pct
   FROM budget b
  WHERE (montant_mad > (0)::numeric);


ALTER VIEW public.v_cockpit_devise OWNER TO gestionfil;

--
-- Name: v_cockpit_economies; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_economies AS
 WITH groupes AS (
         SELECT reference_groupe_equiv.code_reference,
            reference_groupe_equiv.code_groupe_equiv
           FROM public.reference_groupe_equiv
          WHERE (reference_groupe_equiv.actif = 1)
        ), mini AS (
         SELECT g_1.code_groupe_equiv,
            min(sp_1.cmup_mad) AS prix_min_mad
           FROM (groupes g_1
             JOIN public.v_stock_projete sp_1 ON ((sp_1.code_reference = g_1.code_reference)))
          WHERE (sp_1.cmup_mad > (0)::numeric)
          GROUP BY g_1.code_groupe_equiv
        )
 SELECT sp.code_reference,
    sp.designation,
    sp.fournisseur_nom AS fournisseur_actuel,
    g.code_groupe_equiv,
    round(sp.cmup_mad, 4) AS prix_actuel_mad,
    round(m.prix_min_mad, 4) AS prix_min_mad,
    ( SELECT sp2.fournisseur_nom
           FROM (groupes g2
             JOIN public.v_stock_projete sp2 ON ((sp2.code_reference = g2.code_reference)))
          WHERE ((g2.code_groupe_equiv = g.code_groupe_equiv) AND (sp2.cmup_mad = m.prix_min_mad))
         LIMIT 1) AS fournisseur_alternatif,
    round((COALESCE(sp.conso_mensuelle_kg, (0)::numeric) * (12)::numeric), 4) AS conso_annuelle_kg,
    round((((sp.cmup_mad - m.prix_min_mad) * COALESCE(sp.conso_mensuelle_kg, (0)::numeric)) * (12)::numeric), 2) AS economie_annuelle_mad
   FROM ((public.v_stock_projete sp
     JOIN groupes g ON ((g.code_reference = sp.code_reference)))
     JOIN mini m ON ((m.code_groupe_equiv = g.code_groupe_equiv)))
  WHERE ((sp.cmup_mad > m.prix_min_mad) AND (COALESCE(sp.conso_mensuelle_kg, (0)::numeric) > (0)::numeric));


ALTER VIEW public.v_cockpit_economies OWNER TO gestionfil;

--
-- Name: v_ctl_c01; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c01 AS
 SELECT r.code_qualite,
    q.nom AS qualite_nom,
    q.statut,
    r.code_role,
    round(sum(r.pourcentage_composition), 2) AS somme_pct
   FROM (public.recette r
     JOIN public.qualite q ON ((q.code_qualite = r.code_qualite)))
  WHERE ((r.actif = 1) AND (q.statut = 'ACTIF'::text))
  GROUP BY r.code_qualite, q.nom, q.statut, r.code_role
 HAVING (abs((sum(r.pourcentage_composition) - 100.0)) > 0.5);


ALTER VIEW public.v_ctl_c01 OWNER TO gestionfil;

--
-- Name: v_ctl_c02; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c02 AS
 SELECT id_bc,
    numero_bc,
    code_fournisseur,
    date_envoi,
    statut,
    ((CURRENT_DATE - (date_envoi)::date))::bigint AS jours_depuis_envoi
   FROM public.bon_commande bc
  WHERE ((statut = ANY (ARRAY['ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND (date_envoi IS NOT NULL) AND ((CURRENT_DATE - (date_envoi)::date) > 30));


ALTER VIEW public.v_ctl_c02 OWNER TO gestionfil;

--
-- Name: v_ctl_c03; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c03 AS
 SELECT id_ligne_mouvement,
    code_reference
   FROM public.ligne_mouvement lm
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.reference r
          WHERE (r.code_reference = lm.code_reference))));


ALTER VIEW public.v_ctl_c03 OWNER TO gestionfil;

--
-- Name: v_ctl_c04; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c04 AS
 SELECT code_reference,
    code_fournisseur
   FROM public.reference r
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.fournisseur f
          WHERE (f.code_fournisseur = r.code_fournisseur))));


ALTER VIEW public.v_ctl_c04 OWNER TO gestionfil;

--
-- Name: v_ctl_c05; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c05 AS
 SELECT code_reference,
    designation,
    stock_mrp_kg,
    encours_kg,
    besoin_12m_kg,
    stock_projete_kg,
    jours_couverture,
    statut
   FROM public.v_stock_projete
  WHERE (stock_projete_kg < (0)::numeric);


ALTER VIEW public.v_ctl_c05 OWNER TO gestionfil;

--
-- Name: v_ctl_c06; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c06 AS
 SELECT id_mouvement,
    numero_mouvement,
    date_mouvement
   FROM public.mouvement
  WHERE (date_mouvement > to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text));


ALTER VIEW public.v_ctl_c06 OWNER TO gestionfil;

--
-- Name: v_ctl_c07; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c07 AS
 SELECT m.id_mouvement,
    m.numero_mouvement,
    lm.id_ligne_mouvement,
    lm.code_reference
   FROM (public.ligne_mouvement lm
     JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
  WHERE ((m.code_type_mvt = 'SORTIE_PROD'::text) AND (COALESCE(lm.numero_of, m.numero_of) IS NULL));


ALTER VIEW public.v_ctl_c07 OWNER TO gestionfil;

--
-- Name: v_ctl_c08; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c08 AS
 SELECT m.id_mouvement,
    m.numero_mouvement,
    lm.id_ligne_mouvement,
    m.code_type_mvt
   FROM ((public.ligne_mouvement lm
     JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
     JOIN public.type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
  WHERE ((tm.exige_motif_ligne = 1) AND (lm.code_motif_ligne IS NULL));


ALTER VIEW public.v_ctl_c08 OWNER TO gestionfil;

--
-- Name: v_ctl_c09; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c09 AS
 SELECT id_mouvement,
    numero_mouvement
   FROM public.mouvement
  WHERE (id_utilisateur IS NULL);


ALTER VIEW public.v_ctl_c09 OWNER TO gestionfil;

--
-- Name: v_ctl_c10; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c10 AS
 SELECT lr.id_ligne_reception,
    rc.numero_reception,
    lr.code_reference,
    lr.quantite_commandee_kg,
    lr.quantite_stock_kg,
    round(lr.ecart_pct, 2) AS ecart_pct,
    lr.derogation_ecart
   FROM (public.ligne_reception lr
     JOIN public.reception rc ON ((rc.id_reception = lr.id_reception)))
  WHERE ((lr.ecart_pct IS NOT NULL) AND (lr.derogation_ecart = 0) AND (lr.ecart_pct > public.fn_tolerance_pesee(lr.id_reception)))
UNION ALL
 SELECT rl.id_reception_ligne AS id_ligne_reception,
    r.numero AS numero_reception,
    fl.code_reference,
    rl.quantite_attendue_kg AS quantite_commandee_kg,
    rl.quantite_recue_kg AS quantite_stock_kg,
    round((((rl.quantite_recue_kg - rl.quantite_attendue_kg) * 100.0) / rl.quantite_attendue_kg), 2) AS ecart_pct,
    (rl.derogation_ecart)::bigint AS derogation_ecart
   FROM (((public.import_reception_lignes rl
     JOIN public.import_receptions r ON ((r.id_reception = rl.id_reception)))
     JOIN public.import_facture_lignes fl ON ((fl.id_ligne = rl.id_ligne)))
     JOIN public.import_factures f ON ((f.id_facture = fl.id_facture)))
  WHERE ((rl.quantite_attendue_kg > (0)::numeric) AND (rl.derogation_ecart = 0) AND (r.statut <> 'ANNULEE'::text) AND ((((rl.quantite_recue_kg - rl.quantite_attendue_kg) * 100.0) / rl.quantite_attendue_kg) > public.fn_tolerance_fournisseur(f.code_fournisseur)));


ALTER VIEW public.v_ctl_c10 OWNER TO gestionfil;

--
-- Name: v_ctl_c11; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c11 AS
 WITH livre AS (
         SELECT m.code_magasin,
            lm.code_reference,
            round(sum(((tm.signe)::numeric * lm.quantite_kg)), 4) AS solde_livre_kg
           FROM ((public.ligne_mouvement lm
             JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
             JOIN public.type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
          GROUP BY m.code_magasin, lm.code_reference
        )
 SELECT sm.code_reference,
    sm.code_magasin,
    sm.quantite_kg AS solde_cache_kg,
    COALESCE(l.solde_livre_kg, (0)::numeric) AS solde_livre_kg,
    round((sm.quantite_kg - COALESCE(l.solde_livre_kg, (0)::numeric)), 4) AS derive_kg
   FROM (public.stock_magasin sm
     LEFT JOIN livre l ON (((l.code_magasin = sm.code_magasin) AND (l.code_reference = sm.code_reference))))
  WHERE (abs((sm.quantite_kg - COALESCE(l.solde_livre_kg, (0)::numeric))) > 0.01);


ALTER VIEW public.v_ctl_c11 OWNER TO gestionfil;

--
-- Name: v_ctl_c12; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c12 AS
 SELECT code_reference,
    designation,
    prix_catalogue,
    prix_catalogue_kg
   FROM public.reference
  WHERE ((actif = 1) AND ((prix_catalogue IS NULL) OR (prix_catalogue <= (0)::numeric) OR (prix_catalogue_kg IS NULL)));


ALTER VIEW public.v_ctl_c12 OWNER TO gestionfil;

--
-- Name: v_ctl_c13; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c13 AS
 SELECT code_reference,
    designation
   FROM public.reference
  WHERE ((actif = 1) AND (code_fournisseur IS NULL));


ALTER VIEW public.v_ctl_c13 OWNER TO gestionfil;

--
-- Name: v_ctl_c14; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c14 AS
 SELECT DISTINCT r.code_qualite,
    r.code_reference,
    ref.designation,
    ref.prix_catalogue_kg,
    ref.cmup_mad
   FROM ((public.recette r
     JOIN public.qualite q ON ((q.code_qualite = r.code_qualite)))
     JOIN public.reference ref ON ((ref.code_reference = r.code_reference)))
  WHERE ((r.actif = 1) AND (q.statut = 'ACTIF'::text) AND (COALESCE(ref.cmup_mad, ref.prix_catalogue_kg, (0)::numeric) <= (0)::numeric));


ALTER VIEW public.v_ctl_c14 OWNER TO gestionfil;

--
-- Name: v_ctl_c15; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c15 AS
 SELECT sm.code_reference,
    sm.code_magasin,
    sm.quantite_kg AS solde_magasin_kg,
    round(COALESCE(sum(sl.quantite_kg), (0)::numeric), 4) AS solde_lots_kg,
    round((sm.quantite_kg - COALESCE(sum(sl.quantite_kg), (0)::numeric)), 4) AS derive_kg
   FROM ((public.stock_magasin sm
     JOIN public.reference r ON (((r.code_reference = sm.code_reference) AND (r.suivi_lot = 1))))
     LEFT JOIN public.stock_lot sl ON (((sl.code_reference = sm.code_reference) AND (sl.code_magasin = sm.code_magasin))))
  GROUP BY sm.code_reference, sm.code_magasin, sm.quantite_kg
 HAVING (abs((sm.quantite_kg - COALESCE(sum(sl.quantite_kg), (0)::numeric))) > 0.01);


ALTER VIEW public.v_ctl_c15 OWNER TO gestionfil;

--
-- Name: v_ctl_c16; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c16 AS
 SELECT r.code_qualite,
    q.statut,
    r.code_role,
    r.code_reference
   FROM (public.recette r
     JOIN public.qualite q ON ((q.code_qualite = r.code_qualite)))
  WHERE ((r.actif = 1) AND (NOT (EXISTS ( SELECT 1
           FROM public.ligne_qualite lq
          WHERE ((lq.code_qualite = r.code_qualite) AND (lq.code_role = r.code_role) AND (lq.actif = 1))))));


ALTER VIEW public.v_ctl_c16 OWNER TO gestionfil;

--
-- Name: v_ctl_c17; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c17 AS
 SELECT code_reference,
    designation,
    classe_abc
   FROM public.reference r
  WHERE ((actif = 1) AND (NOT (EXISTS ( SELECT 1
           FROM public.recette c
          WHERE ((c.code_reference = r.code_reference) AND (c.actif = 1))))));


ALTER VIEW public.v_ctl_c17 OWNER TO gestionfil;

--
-- Name: v_ctl_c18; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c18 AS
 SELECT DISTINCT lpp.code_qualite,
    q.nom
   FROM (public.ligne_plan_production lpp
     JOIN public.qualite q ON ((q.code_qualite = lpp.code_qualite)))
  WHERE ((lpp.m2_prevus > (0)::numeric) AND (NOT (EXISTS ( SELECT 1
           FROM public.ligne_qualite lq
          WHERE ((lq.code_qualite = lpp.code_qualite) AND (lq.actif = 1))))));


ALTER VIEW public.v_ctl_c18 OWNER TO gestionfil;

--
-- Name: v_ctl_c19; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c19 AS
 SELECT DISTINCT code_devise_catalogue
   FROM public.reference r
  WHERE ((actif = 1) AND (NOT (EXISTS ( SELECT 1
           FROM public.taux_change tc
          WHERE ((tc.code_devise = r.code_devise_catalogue) AND (to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) >= substr(tc.date_debut, 1, 10)) AND ((tc.date_fin IS NULL) OR (to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) < substr(tc.date_fin, 1, 10))))))));


ALTER VIEW public.v_ctl_c19 OWNER TO gestionfil;

--
-- Name: v_ctl_c20; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c20 AS
 SELECT r.code_reference,
    r.designation,
    r.code_fournisseur,
    f.pays,
    r.classe_abc
   FROM (public.reference r
     JOIN public.fournisseur f ON ((f.code_fournisseur = r.code_fournisseur)))
  WHERE ((r.actif = 1) AND (r.classe_abc = 'A'::text) AND (NOT (EXISTS ( SELECT 1
           FROM ((public.reference_groupe_equiv rge1
             JOIN public.reference_groupe_equiv rge2 ON (((rge2.code_groupe_equiv = rge1.code_groupe_equiv) AND (rge2.code_reference <> rge1.code_reference) AND (rge2.actif = 1))))
             JOIN public.reference r2 ON (((r2.code_reference = rge2.code_reference) AND (r2.actif = 1))))
          WHERE ((rge1.code_reference = r.code_reference) AND (rge1.actif = 1) AND (r2.code_fournisseur IS DISTINCT FROM r.code_fournisseur))))));


ALTER VIEW public.v_ctl_c20 OWNER TO gestionfil;

--
-- Name: v_ctl_c21; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c21 AS
 SELECT code_qualite,
    code_role,
    densite,
    unite_densite,
    ( SELECT count(*) AS count
           FROM (public.reference r
             JOIN public.recette c2 ON ((c2.code_reference = r.code_reference)))
          WHERE (c2.code_role = lq.code_role)) AS refs_disponibles
   FROM public.ligne_qualite lq
  WHERE ((actif = 1) AND (densite > (0)::numeric) AND (NOT (EXISTS ( SELECT 1
           FROM public.recette r
          WHERE ((r.code_qualite = lq.code_qualite) AND (r.actif = 1) AND (r.code_role = lq.code_role))))));


ALTER VIEW public.v_ctl_c21 OWNER TO gestionfil;

--
-- Name: v_groupe_equiv_detail; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_groupe_equiv_detail AS
SELECT
    NULL::text AS code_groupe_equiv,
    NULL::text AS libelle,
    NULL::text AS description,
    NULL::bigint AS actif,
    NULL::bigint AS nb_references,
    NULL::bigint AS nb_fournisseurs,
    NULL::bigint AS nb_unites,
    NULL::bigint AS nb_densites,
    NULL::bigint AS nb_categories,
    NULL::numeric AS nb_preferentielles,
    NULL::bigint AS nb_avec_stock,
    NULL::bigint AS nb_avec_besoin,
    NULL::numeric AS stock_cumule_kg,
    NULL::numeric AS besoin_cumule_kg,
    NULL::text AS qualification;


ALTER VIEW public.v_groupe_equiv_detail OWNER TO gestionfil;

--
-- Name: v_ctl_c22; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c22 AS
 SELECT code_groupe_equiv,
    libelle,
    nb_references,
    nb_unites,
    nb_densites,
    nb_categories
   FROM public.v_groupe_equiv_detail
  WHERE ((nb_references > 1) AND ((nb_unites > 1) OR (nb_densites > 1) OR (nb_categories > 1)));


ALTER VIEW public.v_ctl_c22 OWNER TO gestionfil;

--
-- Name: v_ctl_c23; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c23 AS
 SELECT code_groupe_equiv,
    libelle,
    nb_references,
    nb_preferentielles
   FROM public.v_groupe_equiv_detail
  WHERE ((nb_references > 1) AND (COALESCE(nb_preferentielles, (0)::numeric) <> (1)::numeric));


ALTER VIEW public.v_ctl_c23 OWNER TO gestionfil;

--
-- Name: v_ctl_c24; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c24 AS
 SELECT rc.numero_reception,
    rc.date_reception,
    lb.code_reference AS commandee,
    lr.code_reference AS recue,
    lr.quantite_stock_kg,
    rc.code_fournisseur
   FROM ((public.ligne_reception lr
     JOIN public.reception rc ON ((rc.id_reception = lr.id_reception)))
     JOIN public.ligne_bc lb ON ((lb.id_ligne_bc = lr.id_ligne_bc)))
  WHERE ((lb.code_reference <> lr.code_reference) AND (lr.substitution_acceptee = 0));


ALTER VIEW public.v_ctl_c24 OWNER TO gestionfil;

--
-- Name: v_equivalence; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_equivalence AS
 SELECT rge1.code_groupe_equiv,
    ge.libelle AS groupe_libelle,
    r1.code_reference,
    r1.designation,
    r1.code_fournisseur,
    f1.nom AS fournisseur_nom,
    rge1.priorite,
    rge1.est_preferentielle,
    r1.unite_catalogue,
    COALESCE(sd1.stock_mrp_kg, (0)::numeric) AS stock_kg,
    sp1.stock_projete_kg,
    sp1.statut,
    COALESCE(b1.besoin_12m_kg, (0)::numeric) AS besoin_12m_kg,
    r2.code_reference AS equivalent_reference,
    r2.designation AS equivalent_designation,
    r2.code_fournisseur AS equivalent_fournisseur,
    f2.nom AS equivalent_fournisseur_nom,
    COALESCE(f2.delai_livraison_jours, ( SELECT (parametre.valeur_courante)::bigint AS valeur_courante
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_DelaiDefaut'::text))) AS equivalent_delai_jours,
    rge2.priorite AS equivalent_priorite,
    rge2.est_preferentielle AS equivalent_preferentielle,
    r2.unite_catalogue AS equivalent_unite,
    r2.prix_catalogue_kg AS equivalent_prix_catalogue_kg,
    r2.code_devise_catalogue AS equivalent_devise,
    COALESCE(sd2.stock_mrp_kg, (0)::numeric) AS equivalent_stock_kg,
    sp2.stock_projete_kg AS equivalent_stock_projete_kg,
    sp2.statut AS equivalent_statut,
    COALESCE(b2.besoin_12m_kg, (0)::numeric) AS equivalent_besoin_12m_kg,
        CASE
            WHEN (r1.code_fournisseur = r2.code_fournisseur) THEN 1
            ELSE 0
        END AS meme_fournisseur,
        CASE
            WHEN ((r1.unite_catalogue = r2.unite_catalogue) AND (COALESCE(r1.densite_kg_ml, ('-1'::integer)::numeric) = COALESCE(r2.densite_kg_ml, ('-1'::integer)::numeric)) AND (r1.code_categorie = r2.code_categorie)) THEN 1
            ELSE 0
        END AS interchangeable
   FROM ((((((((((((public.reference_groupe_equiv rge1
     JOIN public.groupe_equiv ge ON (((ge.code_groupe_equiv = rge1.code_groupe_equiv) AND (ge.actif = 1))))
     JOIN public.reference r1 ON ((r1.code_reference = rge1.code_reference)))
     JOIN public.reference_groupe_equiv rge2 ON (((rge2.code_groupe_equiv = rge1.code_groupe_equiv) AND (rge2.code_reference <> rge1.code_reference) AND (rge2.actif = 1))))
     JOIN public.reference r2 ON ((r2.code_reference = rge2.code_reference)))
     LEFT JOIN public.fournisseur f1 ON ((f1.code_fournisseur = r1.code_fournisseur)))
     LEFT JOIN public.fournisseur f2 ON ((f2.code_fournisseur = r2.code_fournisseur)))
     LEFT JOIN public.v_stock_disponible sd1 ON ((sd1.code_reference = r1.code_reference)))
     LEFT JOIN public.v_stock_disponible sd2 ON ((sd2.code_reference = r2.code_reference)))
     LEFT JOIN public.v_stock_projete sp1 ON ((sp1.code_reference = r1.code_reference)))
     LEFT JOIN public.v_stock_projete sp2 ON ((sp2.code_reference = r2.code_reference)))
     LEFT JOIN public.v_besoin_12m b1 ON ((b1.code_reference = r1.code_reference)))
     LEFT JOIN public.v_besoin_12m b2 ON ((b2.code_reference = r2.code_reference)))
  WHERE ((rge1.actif = 1) AND (r1.actif = 1) AND (r2.actif = 1));


ALTER VIEW public.v_equivalence OWNER TO gestionfil;

--
-- Name: v_ctl_c25; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c25 AS
 SELECT code_reference,
    designation,
    stock_kg,
    equivalent_reference,
    equivalent_statut,
    equivalent_besoin_12m_kg,
    equivalent_stock_projete_kg
   FROM public.v_equivalence e
  WHERE ((stock_kg > (0)::numeric) AND (besoin_12m_kg = (0)::numeric) AND (interchangeable = 1) AND (equivalent_statut IS NOT NULL) AND (equivalent_statut <> 'OK'::text));


ALTER VIEW public.v_ctl_c25 OWNER TO gestionfil;

--
-- Name: v_ctl_c26; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c26 AS
 SELECT code_groupe_equiv,
    libelle,
    nb_references,
    nb_fournisseurs
   FROM public.v_groupe_equiv_detail
  WHERE (qualification = 'MEME FOURNISSEUR'::text);


ALTER VIEW public.v_ctl_c26 OWNER TO gestionfil;

--
-- Name: v_ctl_c27; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c27 AS
 SELECT sp.code_reference,
    sp.designation,
    sp.jours_couverture,
    sp.stock_physique_net_kg,
    r.stock_min_kg,
    round((r.stock_min_kg - sp.stock_physique_net_kg), 3) AS manque_kg,
    sp.stock_quarantaine_kg,
    sp.encours_retarde_kg,
    sp.besoins_calcules_le
   FROM (public.v_stock_projete sp
     JOIN public.reference r ON ((r.code_reference = sp.code_reference)))
  WHERE (sp.ecart_majeur = 1);


ALTER VIEW public.v_ctl_c27 OWNER TO gestionfil;

--
-- Name: v_ctl_c28; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c28 AS
 SELECT lb.code_reference,
    r.designation,
    bc.numero_bc,
    bc.code_fournisseur,
    lb.date_livraison_prevue,
    ((CURRENT_DATE - (lb.date_livraison_prevue)::date))::bigint AS retard_jours,
    lb.quantite_restante_kg
   FROM (((public.ligne_bc lb
     JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
     JOIN public.reference r ON ((r.code_reference = lb.code_reference)))
     CROSS JOIN ( SELECT (parametre.valeur_courante)::numeric AS v
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_RetardBCJours'::text)) p)
  WHERE ((bc.statut = ANY (ARRAY['VALIDE'::text, 'ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND (lb.statut <> ALL (ARRAY['ANNULE'::text, 'SOLDE'::text])) AND (lb.type_ligne = 'MARCHANDISE'::text) AND (lb.quantite_restante_kg > (0)::numeric) AND (substr(lb.date_livraison_prevue, 1, 10) < to_char(((CURRENT_DATE - (p.v)::integer))::timestamp with time zone, 'YYYY-MM-DD'::text)));


ALTER VIEW public.v_ctl_c28 OWNER TO gestionfil;

--
-- Name: v_ctl_c29; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c29 AS
 SELECT id_plan,
    libelle,
    statut,
    date_modification,
    ( SELECT max(b.date_calcul) AS max
           FROM public.besoin_mrp b
          WHERE (b.id_plan = pp.id_plan)) AS dernier_calcul,
    ( SELECT round(COALESCE(sum(b.quantite_kg), (0)::numeric), 2) AS round
           FROM public.besoin_mrp b
          WHERE (b.id_plan = pp.id_plan)) AS besoins_enregistres_kg,
    ( SELECT round(COALESCE(sum(c.quantite_kg), (0)::numeric), 2) AS round
           FROM public.v_besoin_mrp_calcule c
          WHERE (c.id_plan = pp.id_plan)) AS besoins_recalcules_kg
   FROM public.plan_production pp
  WHERE ((statut = 'EN_COURS'::text) AND public.fn_besoins_perimes(id_plan));


ALTER VIEW public.v_ctl_c29 OWNER TO gestionfil;

--
-- Name: v_ctl_c30; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c30 AS
 SELECT code_fournisseur,
    nom,
    delai_livraison_jours,
    ( SELECT count(*) AS count
           FROM public.reference r
          WHERE ((r.code_fournisseur = f.code_fournisseur) AND (r.actif = 1))) AS nb_references
   FROM public.fournisseur f
  WHERE ((actif = 1) AND ((delai_livraison_jours IS NULL) OR (delai_livraison_jours <= 0)));


ALTER VIEW public.v_ctl_c30 OWNER TO gestionfil;

--
-- Name: v_ctl_c31; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c31 AS
 SELECT rc.numero_reception,
    rc.date_reception,
    lr.code_reference,
    lr.quantite_stock_kg,
    lr.lot_fournisseur
   FROM (public.ligne_reception lr
     JOIN public.reception rc ON ((rc.id_reception = lr.id_reception)))
  WHERE ((rc.statut = 'VALIDE'::text) AND (COALESCE(lr.quantite_stock_kg, (0)::numeric) > (0)::numeric) AND (NOT (EXISTS ( SELECT 1
           FROM (public.ligne_mouvement lm
             JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
          WHERE ((lm.code_reference = lr.code_reference) AND (abs((lm.quantite_kg - lr.quantite_stock_kg)) < 0.001) AND ((lr.lot_fournisseur IS NULL) OR (NOT (lm.lot_fournisseur IS DISTINCT FROM lr.lot_fournisseur))))))));


ALTER VIEW public.v_ctl_c31 OWNER TO gestionfil;

--
-- Name: v_ctl_c32; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c32 AS
 SELECT rc.numero_reception,
    rc.date_reception,
    lr.code_reference,
    lr.prix_kg_mad,
    lr.quantite_stock_kg
   FROM (public.ligne_reception lr
     JOIN public.reception rc ON ((rc.id_reception = lr.id_reception)))
  WHERE ((rc.statut = 'VALIDE'::text) AND (lr.prix_kg_mad IS NOT NULL) AND (lr.prix_kg_mad > (0)::numeric) AND (NOT (EXISTS ( SELECT 1
           FROM public.historique_prix hp
          WHERE (hp.id_ligne_reception = lr.id_ligne_reception)))));


ALTER VIEW public.v_ctl_c32 OWNER TO gestionfil;

--
-- Name: v_ctl_c33; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c33 AS
 SELECT e.code_machine,
    e.code_emplacement,
    e.libelle,
    e.capacite_bobines,
    COALESCE(sum(sl.nb_bobines), (0)::numeric) AS bobines_presentes
   FROM (public.machine_emplacement e
     LEFT JOIN public.stock_lot sl ON ((sl.code_magasin = e.code_magasin)))
  GROUP BY e.code_machine, e.code_emplacement, e.libelle, e.capacite_bobines
 HAVING (COALESCE(sum(sl.nb_bobines), (0)::numeric) > (e.capacite_bobines)::numeric);


ALTER VIEW public.v_ctl_c33 OWNER TO gestionfil;

--
-- Name: v_ctl_c34; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c34 AS
 SELECT m.code_machine,
    m.nom,
    m.capacite_bobines,
    COALESCE(sum(sl.nb_bobines), (0)::numeric) AS bobines_presentes
   FROM ((public.machine m
     LEFT JOIN public.machine_emplacement e ON ((e.code_machine = m.code_machine)))
     LEFT JOIN public.stock_lot sl ON ((sl.code_magasin = e.code_magasin)))
  GROUP BY m.code_machine, m.nom, m.capacite_bobines
 HAVING (COALESCE(sum(sl.nb_bobines), (0)::numeric) > (m.capacite_bobines)::numeric);


ALTER VIEW public.v_ctl_c34 OWNER TO gestionfil;

--
-- Name: v_ctl_c35; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c35 AS
 SELECT lm.id_ligne_mouvement,
    mv.numero_mouvement,
    mv.date_mouvement,
    e.code_machine,
    e.libelle,
    lm.code_reference,
    lm.lot_fournisseur,
    lm.nb_bobines,
    lm.quantite_kg,
    lm.pourcentage_restant,
    lm.poids_unitaire_theorique_kg,
    lm.poids_reel_moyen_bobine_kg,
    round(lm.ecart_theorique_pct, 2) AS ecart_theorique_pct,
    mv.responsable,
    mv.id_utilisateur
   FROM ((public.ligne_mouvement lm
     JOIN public.mouvement mv ON ((mv.id_mouvement = lm.id_mouvement)))
     JOIN public.machine_emplacement e ON ((e.code_magasin = mv.code_magasin)))
  WHERE ((lm.mode_pesee = 'ESTIMATION'::text) AND (lm.ecart_theorique_pct IS NOT NULL) AND (abs(lm.ecart_theorique_pct) > ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_TolerEstimMachine'::text))));


ALTER VIEW public.v_ctl_c35 OWNER TO gestionfil;

--
-- Name: v_ctl_c36; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c36 AS
 SELECT e.code_machine,
    e.code_emplacement,
    e.libelle,
    max(sm.date_dernier_inventaire) AS dernier_inventaire,
    round(sum(sm.quantite_kg), 3) AS quantite_kg
   FROM (public.machine_emplacement e
     JOIN public.stock_magasin sm ON ((sm.code_magasin = e.code_magasin)))
  WHERE (e.actif = 1)
  GROUP BY e.code_machine, e.code_emplacement, e.libelle
 HAVING ((sum(sm.quantite_kg) > (0)::numeric) AND ((max(sm.date_dernier_inventaire) IS NULL) OR (max(sm.date_dernier_inventaire) < to_char(((now() AT TIME ZONE 'UTC'::text) - make_interval(days => ( SELECT (parametre.valeur_courante)::integer AS valeur_courante
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_JoursInventMachine'::text)))), 'YYYY-MM-DD'::text))));


ALTER VIEW public.v_ctl_c36 OWNER TO gestionfil;

--
-- Name: v_ctl_c37; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c37 AS
 SELECT e.code_machine,
    e.libelle,
    sl.code_reference,
    sl.lot_fournisseur,
    sl.quantite_kg,
    sl.nb_bobines
   FROM (public.stock_lot sl
     JOIN public.machine_emplacement e ON ((e.code_magasin = sl.code_magasin)))
  WHERE (((sl.quantite_kg > (0)::numeric) AND (sl.nb_bobines = 0)) OR ((sl.quantite_kg = (0)::numeric) AND (sl.nb_bobines > 0)));


ALTER VIEW public.v_ctl_c37 OWNER TO gestionfil;

--
-- Name: v_ctl_c38; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c38 AS
 SELECT id_decision,
    id_fiche,
    numero_fiche,
    nature,
    code_machine,
    code_emplacement,
    zone,
    date_decision,
    ligne_numero,
    code_reference,
    designation,
    lot_fournisseur,
    kg_avant,
    kg_mouvementes,
    destination,
    kg_apres,
    ecart_kg,
    effet_ecart,
    code_motif,
    motif,
    motif_texte
   FROM public.v_machine_ecart
  WHERE ((effet_ecart = 'CONSOMMATION'::text) AND (ecart_kg < '-0.001'::numeric));


ALTER VIEW public.v_ctl_c38 OWNER TO gestionfil;

--
-- Name: v_ctl_c39; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c39 AS
 WITH tete AS (
         SELECT d.id_decision,
            d.code_emplacement
           FROM public.machine_decision d
          WHERE (d.est_tete = 1)
        ), attendu AS (
         SELECT t.code_emplacement,
            s.code_reference,
            s.lot_fournisseur,
            s.nb_bobines,
            s.kg
           FROM (tete t
             JOIN public.machine_decision_etat s ON (((s.id_decision = t.id_decision) AND (s.moment = 'APRES'::text))))
        )
 SELECT COALESCE(a.code_emplacement, e.code_emplacement) AS code_emplacement,
    COALESCE(a.code_reference, e.code_reference) AS code_reference,
    COALESCE(a.lot_fournisseur, e.lot_fournisseur) AS lot_fournisseur,
    a.nb_bobines AS bobines_attendues,
    e.nb_bobines AS bobines_etat,
    a.kg AS kg_attendus,
    e.kg AS kg_etat
   FROM (attendu a
     FULL JOIN public.machine_etat e ON (((e.code_emplacement = a.code_emplacement) AND (e.code_reference = a.code_reference) AND (e.lot_fournisseur = a.lot_fournisseur))))
  WHERE ((a.nb_bobines IS DISTINCT FROM e.nb_bobines) OR (abs((COALESCE(a.kg, (0)::numeric) - COALESCE(e.kg, (0)::numeric))) > 0.001));


ALTER VIEW public.v_ctl_c39 OWNER TO gestionfil;

--
-- Name: v_ctl_c40; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c40 AS
 SELECT id_decision,
    id_fiche,
    numero_fiche,
    nature,
    code_machine,
    code_emplacement,
    zone,
    date_decision,
    ligne_numero,
    code_reference,
    designation,
    lot_fournisseur,
    kg_avant,
    kg_mouvementes,
    destination,
    kg_apres,
    ecart_kg,
    effet_ecart,
    code_motif,
    motif,
    motif_texte
   FROM public.v_machine_ecart
  WHERE ((effet_ecart = 'NON_QUALIFIE'::text) AND (abs(ecart_kg) > 0.001));


ALTER VIEW public.v_ctl_c40 OWNER TO gestionfil;

--
-- Name: v_ctl_c41; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c41 AS
 SELECT id_decision,
    id_fiche,
    numero_fiche,
    nature,
    code_machine,
    code_emplacement,
    zone,
    date_decision,
    ligne_numero,
    code_reference,
    designation,
    lot_fournisseur,
    kg_avant,
    kg_mouvementes,
    destination,
    kg_apres,
    ecart_kg,
    effet_ecart,
    code_motif,
    motif,
    motif_texte
   FROM public.v_machine_ecart
  WHERE (effet_ecart = 'REGULARISATION'::text);


ALTER VIEW public.v_ctl_c41 OWNER TO gestionfil;

--
-- Name: v_ctl_c42; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c42 AS
 SELECT id_mouvement,
    numero_mouvement,
    date_mouvement,
    code_type_mvt,
    code_magasin,
    code_motif,
    reference_document,
    numero_of,
    observations_globales,
    id_utilisateur,
    responsable,
    est_initial,
    date_creation,
    id_mouvement_contrepasse,
    motif_contrepassation,
    id_decision_machine
   FROM public.mouvement m
  WHERE ((code_type_mvt = ANY (ARRAY['ANNUL_CHARGE_MACHINE'::text, 'ANNUL_RETOUR_MACHINE'::text])) AND (id_mouvement_contrepasse IS NULL));


ALTER VIEW public.v_ctl_c42 OWNER TO gestionfil;

--
-- Name: v_ctl_c43; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c43 AS
 SELECT document,
    numero,
    code_reference,
    kg,
    bobines,
    palettes,
    message
   FROM ( SELECT 'BON DE COMMANDE'::text AS document,
            bc.numero_bc AS numero,
            lb.code_reference,
            lb.quantite_commandee_kg AS kg,
            lb.nb_bobines_saisi AS bobines,
            lb.nb_palettes_saisi AS palettes,
            public.fn_controle_colisage(lb.code_reference, lb.quantite_commandee_kg, (lb.nb_bobines_saisi)::numeric, lb.nb_palettes_saisi) AS message
           FROM (public.ligne_bc lb
             JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
          WHERE ((lb.type_ligne = 'MARCHANDISE'::text) AND (bc.statut <> ALL (ARRAY['CLOTURE'::text, 'ANNULE'::text])))
        UNION ALL
         SELECT 'FACTURE IMPORT'::text,
            f.numero_facture,
            fl.code_reference,
            fl.poids_net_kg,
            fl.nb_bobines,
            fl.nb_palettes,
            public.fn_controle_colisage(fl.code_reference, fl.poids_net_kg, (fl.nb_bobines)::numeric, (fl.nb_palettes)::numeric) AS fn_controle_colisage
           FROM ((public.import_facture_lignes fl
             JOIN public.import_factures f ON ((f.id_facture = fl.id_facture)))
             JOIN public.import_dossiers d ON ((d.id_dossier = f.id_dossier)))
          WHERE (d.statut <> 'CLOTURE'::text)
        UNION ALL
         SELECT 'RECEPTION IMPORT'::text,
            r.numero,
            fl.code_reference,
            rl.quantite_recue_kg,
            rl.nb_bobines,
            rl.nb_palettes,
            public.fn_controle_colisage(fl.code_reference, rl.quantite_recue_kg, (rl.nb_bobines)::numeric, (rl.nb_palettes)::numeric) AS fn_controle_colisage
           FROM ((public.import_reception_lignes rl
             JOIN public.import_receptions r ON ((r.id_reception = rl.id_reception)))
             JOIN public.import_facture_lignes fl ON ((fl.id_ligne = rl.id_ligne)))
          WHERE (r.statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text]))
        UNION ALL
         SELECT 'RECEPTION'::text,
            rc.numero_reception,
            lr.code_reference,
            lr.quantite_stock_kg,
            lr.nb_bobines_saisi,
            lr.nb_palettes_saisi,
            public.fn_controle_colisage(lr.code_reference, lr.quantite_stock_kg, (lr.nb_bobines_saisi)::numeric, lr.nb_palettes_saisi) AS fn_controle_colisage
           FROM (public.ligne_reception lr
             JOIN public.reception rc ON ((rc.id_reception = lr.id_reception)))
          WHERE (rc.statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text]))) x
  WHERE (message IS NOT NULL);


ALTER VIEW public.v_ctl_c43 OWNER TO gestionfil;

--
-- Name: v_ctl_c44; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c44 AS
 SELECT code_magasin,
    count(*) AS nb_en_cours,
    string_agg(numero_inventaire, ', '::text ORDER BY numero_inventaire) AS inventaires
   FROM public.inventaire
  WHERE (statut = 'EN_COURS'::text)
  GROUP BY code_magasin
 HAVING (count(*) > 1);


ALTER VIEW public.v_ctl_c44 OWNER TO gestionfil;

--
-- Name: v_ctl_c45; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_ctl_c45 AS
 SELECT bc.numero_bc,
    lb.code_reference,
    lb.id_ligne_bc
   FROM (public.ligne_bc lb
     JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
  WHERE ((EXISTS ( SELECT 1
           FROM public.import_facture_lignes fl
          WHERE (fl.id_ligne_bc = lb.id_ligne_bc))) AND (EXISTS ( SELECT 1
           FROM (public.ligne_reception lr
             JOIN public.reception r ON ((r.id_reception = lr.id_reception)))
          WHERE ((lr.id_ligne_bc = lb.id_ligne_bc) AND (r.statut <> 'ANNULE'::text)))));


ALTER VIEW public.v_ctl_c45 OWNER TO gestionfil;

--
-- Name: v_controles; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_controles AS
 SELECT 'C01'::text AS code,
    'Somme des % <> 100 par role BOM'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c01) AS anomalies
UNION ALL
 SELECT 'C02'::text AS code,
    'BC envoyes non soldes depuis plus de 30j'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c02) AS anomalies
UNION ALL
 SELECT 'C03'::text AS code,
    'Reference de mouvement absente du catalogue'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c03) AS anomalies
UNION ALL
 SELECT 'C04'::text AS code,
    'Fournisseur de reference inexistant'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c04) AS anomalies
UNION ALL
 SELECT 'C05'::text AS code,
    'Stock projete negatif sur 12 mois'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c05) AS anomalies
UNION ALL
 SELECT 'C06'::text AS code,
    'Mouvement date dans le futur'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c06) AS anomalies
UNION ALL
 SELECT 'C07'::text AS code,
    'Sortie production sans numero d''OF'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c07) AS anomalies
UNION ALL
 SELECT 'C08'::text AS code,
    'Retour sans motif de ligne'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c08) AS anomalies
UNION ALL
 SELECT 'C09'::text AS code,
    'Mouvement sans utilisateur'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c09) AS anomalies
UNION ALL
 SELECT 'C10'::text AS code,
    'Ecart de pesee hors tolerance sans derogation'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c10) AS anomalies
UNION ALL
 SELECT 'C11'::text AS code,
    'Derive solde de stock vs grand livre'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c11) AS anomalies
UNION ALL
 SELECT 'C12'::text AS code,
    'Reference active a prix nul'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c12) AS anomalies
UNION ALL
 SELECT 'C13'::text AS code,
    'Reference active sans fournisseur'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c13) AS anomalies
UNION ALL
 SELECT 'C14'::text AS code,
    'Composant de recette validee a cout nul'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c14) AS anomalies
UNION ALL
 SELECT 'C15'::text AS code,
    'Derive stock par lot vs stock par magasin'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c15) AS anomalies
UNION ALL
 SELECT 'C16'::text AS code,
    'Role de recette sans densite sur la qualite'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c16) AS anomalies
UNION ALL
 SELECT 'C17'::text AS code,
    'Reference active sans recette (orpheline)'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c17) AS anomalies
UNION ALL
 SELECT 'C18'::text AS code,
    'Qualite planifiee sans densite de role'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c18) AS anomalies
UNION ALL
 SELECT 'C19'::text AS code,
    'Devise catalogue sans taux de change en vigueur'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c19) AS anomalies
UNION ALL
 SELECT 'C20'::text AS code,
    'Reference classe A mono-source'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c20) AS anomalies
UNION ALL
 SELECT 'C21'::text AS code,
    'Role avec densite mais sans matiere en recette'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c21) AS anomalies
UNION ALL
 SELECT 'C22'::text AS code,
    'Groupe d''equivalence aux references non interchangeables'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c22) AS anomalies
UNION ALL
 SELECT 'C23'::text AS code,
    'Groupe d''equivalence sans reference preferentielle'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c23) AS anomalies
UNION ALL
 SELECT 'C24'::text AS code,
    'Reception d''une autre reference sans substitution declaree'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c24) AS anomalies
UNION ALL
 SELECT 'C25'::text AS code,
    'Stock mobilisable face a un equivalent en tension'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c25) AS anomalies
UNION ALL
 SELECT 'C26'::text AS code,
    'Groupe d''equivalence limite a un seul fournisseur'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c26) AS anomalies
UNION ALL
 SELECT 'C27'::text AS code,
    'Ecart majeur : couverture confortable, magasin sous le minimum'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c27) AS anomalies
UNION ALL
 SELECT 'C28'::text AS code,
    'Commande en retard, retiree du calcul de couverture'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c28) AS anomalies
UNION ALL
 SELECT 'C29'::text AS code,
    'Besoins plus anciens que le plan : projection perimee'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c29) AS anomalies
UNION ALL
 SELECT 'C30'::text AS code,
    'Delai fournisseur absent, nul ou negatif'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c30) AS anomalies
UNION ALL
 SELECT 'C31'::text AS code,
    'Reception validee non repercutee au stock'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c31) AS anomalies
UNION ALL
 SELECT 'C32'::text AS code,
    'Reception valorisee absente de l''historique des prix'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c32) AS anomalies
UNION ALL
 SELECT 'C33'::text AS code,
    'Emplacement de machine au-dela de sa capacite'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c33) AS anomalies
UNION ALL
 SELECT 'C34'::text AS code,
    'Machine au-dela de sa capacite totale'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c34) AS anomalies
UNION ALL
 SELECT 'C35'::text AS code,
    'Estimation de poids hors tolerance en machine'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c35) AS anomalies
UNION ALL
 SELECT 'C36'::text AS code,
    'Emplacement de machine sans inventaire recent'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c36) AS anomalies
UNION ALL
 SELECT 'C37'::text AS code,
    'Bobines sans kilos, ou kilos sans bobines, en machine'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c37) AS anomalies
UNION ALL
 SELECT 'C38'::text AS code,
    'Machine : consommation negative'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c38) AS anomalies
UNION ALL
 SELECT 'C39'::text AS code,
    'Machine : etage different de sa derniere decision'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c39) AS anomalies
UNION ALL
 SELECT 'C40'::text AS code,
    'Machine : ecart non qualifie a revoir'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c40) AS anomalies
UNION ALL
 SELECT 'C41'::text AS code,
    'Machine : regularisation (constat superieur a l''attendu)'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c41) AS anomalies
UNION ALL
 SELECT 'C42'::text AS code,
    'Machine : annulation sans mouvement d''origine'::text AS controle,
    'BLOQUANT'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c42) AS anomalies
UNION ALL
 SELECT 'C43'::text AS code,
    'Colisage incoherent sur un document d''achat ouvert'::text AS controle,
    'ATTENTION'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c43) AS anomalies
UNION ALL
 SELECT 'C44'::text AS code,
    'Plus d''un inventaire en cours sur un magasin'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c44) AS anomalies
UNION ALL
 SELECT 'C45'::text AS code,
    'Ligne de bon recue a la fois en local et a l''import'::text AS controle,
    'CRITIQUE'::text AS criticite,
    ( SELECT count(*) AS count
           FROM public.v_ctl_c45) AS anomalies;


ALTER VIEW public.v_controles OWNER TO gestionfil;

--
-- Name: v_lot_fefo; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_lot_fefo AS
 SELECT sl.code_reference,
    r.designation,
    sl.code_magasin,
    sl.lot_fournisseur,
    sl.quantite_kg,
    sl.prix_entree_mad,
    sl.date_fabrication,
    sl.date_peremption,
    sl.date_premiere_entree,
        CASE
            WHEN (sl.date_peremption IS NOT NULL) THEN (((sl.date_peremption)::date - CURRENT_DATE))::bigint
            ELSE NULL::bigint
        END AS jours_avant_peremption,
    row_number() OVER (PARTITION BY sl.code_reference, sl.code_magasin ORDER BY COALESCE(sl.date_peremption, '9999-12-31'::text), sl.date_premiere_entree) AS rang_fefo
   FROM (public.stock_lot sl
     JOIN public.reference r ON ((r.code_reference = sl.code_reference)))
  WHERE (sl.quantite_kg > (0)::numeric);


ALTER VIEW public.v_lot_fefo OWNER TO gestionfil;

--
-- Name: v_plan_achat; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_plan_achat AS
 WITH p AS (
         SELECT ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_SecuriteA'::text)) AS sec_a,
            ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_SecuriteB'::text)) AS sec_b,
            ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_SecuriteC'::text)) AS sec_c,
            ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_SeuilTier1'::text)) AS tier1,
            ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_SeuilTier2'::text)) AS tier2,
            ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                   FROM public.parametre
                  WHERE (parametre.code_parametre = 'P_SeuilTier3'::text)) AS tier3
        ), base AS (
         SELECT sp.code_reference,
            sp.designation,
            sp.code_fournisseur,
            sp.fournisseur_nom,
            sp.fournisseur_pays,
            sp.delai_livraison_jours,
            sp.classe_abc,
            sp.classe_xyz,
            sp.unite_catalogue,
            sp.cmup_mad,
            sp.stock_mrp_kg,
            sp.stock_total_kg,
            sp.valeur_totale_mad,
            sp.stock_physique_net_kg,
            sp.stock_quarantaine_kg,
            sp.stock_reserve_kg,
            sp.encours_kg,
            sp.encours_retarde_kg,
            sp.nb_lignes_retardees,
            sp.retard_max_jours,
            sp.besoin_12m_kg,
            sp.stock_projete_kg,
            sp.conso_mensuelle_kg,
            sp.source_conso,
            sp.jours_couverture,
            sp.seuil_critique_jours,
            sp.seuil_alerte_jours,
            sp.stock_min_kg,
            sp.terme2_couverture_kg,
            sp.stock_max_kg,
            sp.statut_logique,
            sp.statut_physique,
            sp.statut,
            sp.sur_stock,
            sp.ecart_majeur,
            sp.besoins_calcules_le,
            sp.demande_delai_kg,
            sp.sorties_prevues_kg,
            r.moq_kg,
                CASE
                    WHEN ((r.arrondi_palette = 1) AND (r.poids_bobine_kg > (0)::numeric) AND (r.bobines_par_palette > 0)) THEN round((r.poids_bobine_kg * (r.bobines_par_palette)::numeric), 4)
                    ELSE NULL::numeric
                END AS multiple_achat_kg,
            r.facteur_kg,
            r.poids_bobine_kg,
            r.bobines_par_palette,
            COALESCE(r.stock_min_kg, (0)::numeric) AS stock_min_catalogue_kg,
            r.code_devise_catalogue AS devise,
            r.prix_catalogue_kg,
            COALESCE(r.cmup_mad, round((r.prix_catalogue_kg * COALESCE(tc.taux, 1.0)), 4)) AS prix_retenu_mad,
                CASE
                    WHEN (r.cmup_mad IS NOT NULL) THEN 'CMUP'::text
                    ELSE 'CATALOGUE'::text
                END AS source_prix,
            COALESCE(tc.taux, 1.0) AS taux,
                CASE sp.classe_abc
                    WHEN 'A'::text THEN p.sec_a
                    WHEN 'B'::text THEN p.sec_b
                    ELSE p.sec_c
                END AS sec_j,
            p.tier1,
            p.tier2,
            p.tier3
           FROM (((public.v_stock_projete sp
             JOIN public.reference r ON ((r.code_reference = sp.code_reference)))
             LEFT JOIN public.taux_change tc ON (((tc.code_devise = r.code_devise_catalogue) AND (to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) >= substr(tc.date_debut, 1, 10)) AND ((tc.date_fin IS NULL) OR (to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) < substr(tc.date_fin, 1, 10))))))
             CROSS JOIN p)
        ), classeur AS (
         SELECT b.code_reference,
            b.designation,
            b.code_fournisseur,
            b.fournisseur_nom,
            b.fournisseur_pays,
            b.delai_livraison_jours,
            b.classe_abc,
            b.classe_xyz,
            b.unite_catalogue,
            b.cmup_mad,
            b.stock_mrp_kg,
            b.stock_total_kg,
            b.valeur_totale_mad,
            b.stock_physique_net_kg,
            b.stock_quarantaine_kg,
            b.stock_reserve_kg,
            b.encours_kg,
            b.encours_retarde_kg,
            b.nb_lignes_retardees,
            b.retard_max_jours,
            b.besoin_12m_kg,
            b.stock_projete_kg,
            b.conso_mensuelle_kg,
            b.source_conso,
            b.jours_couverture,
            b.seuil_critique_jours,
            b.seuil_alerte_jours,
            b.stock_min_kg,
            b.terme2_couverture_kg,
            b.stock_max_kg,
            b.statut_logique,
            b.statut_physique,
            b.statut,
            b.sur_stock,
            b.ecart_majeur,
            b.besoins_calcules_le,
            b.demande_delai_kg,
            b.sorties_prevues_kg,
            b.moq_kg,
            b.multiple_achat_kg,
            b.facteur_kg,
            b.poids_bobine_kg,
            b.bobines_par_palette,
            b.stock_min_catalogue_kg,
            b.devise,
            b.prix_catalogue_kg,
            b.prix_retenu_mad,
            b.source_prix,
            b.taux,
            b.sec_j,
            b.tier1,
            b.tier2,
            b.tier3,
            GREATEST((0)::numeric, b.stock_projete_kg) AS residuel_kg,
                CASE
                    WHEN (COALESCE(bh.couv_j, (0)::numeric) = (0)::numeric) THEN (0)::numeric
                    ELSE round(((b.sec_j * COALESCE(bh.sorties_prevues_kg, (0)::numeric)) / bh.couv_j), 4)
                END AS securite_kg,
            COALESCE(bh.sorties_prevues_kg, (0)::numeric) AS sorties_fenetre_kg
           FROM (base b
             LEFT JOIN public.v_besoin_horizon bh ON ((bh.code_reference = b.code_reference)))
        ), calcul AS (
         SELECT c.code_reference,
            c.designation,
            c.code_fournisseur,
            c.fournisseur_nom,
            c.fournisseur_pays,
            c.delai_livraison_jours,
            c.classe_abc,
            c.classe_xyz,
            c.unite_catalogue,
            c.cmup_mad,
            c.stock_mrp_kg,
            c.stock_total_kg,
            c.valeur_totale_mad,
            c.stock_physique_net_kg,
            c.stock_quarantaine_kg,
            c.stock_reserve_kg,
            c.encours_kg,
            c.encours_retarde_kg,
            c.nb_lignes_retardees,
            c.retard_max_jours,
            c.besoin_12m_kg,
            c.stock_projete_kg,
            c.conso_mensuelle_kg,
            c.source_conso,
            c.jours_couverture,
            c.seuil_critique_jours,
            c.seuil_alerte_jours,
            c.stock_min_kg,
            c.terme2_couverture_kg,
            c.stock_max_kg,
            c.statut_logique,
            c.statut_physique,
            c.statut,
            c.sur_stock,
            c.ecart_majeur,
            c.besoins_calcules_le,
            c.demande_delai_kg,
            c.sorties_prevues_kg,
            c.moq_kg,
            c.multiple_achat_kg,
            c.facteur_kg,
            c.poids_bobine_kg,
            c.bobines_par_palette,
            c.stock_min_catalogue_kg,
            c.devise,
            c.prix_catalogue_kg,
            c.prix_retenu_mad,
            c.source_prix,
            c.taux,
            c.sec_j,
            c.tier1,
            c.tier2,
            c.tier3,
            c.residuel_kg,
            c.securite_kg,
            c.sorties_fenetre_kg,
            GREATEST((0)::numeric, round(((c.sorties_fenetre_kg + c.securite_kg) - c.residuel_kg), 4), round((c.stock_min_catalogue_kg - c.residuel_kg), 4)) AS besoin_net_kg
           FROM classeur c
        ), moq AS (
         SELECT calcul.code_reference,
            calcul.designation,
            calcul.code_fournisseur,
            calcul.fournisseur_nom,
            calcul.fournisseur_pays,
            calcul.delai_livraison_jours,
            calcul.classe_abc,
            calcul.classe_xyz,
            calcul.unite_catalogue,
            calcul.cmup_mad,
            calcul.stock_mrp_kg,
            calcul.stock_total_kg,
            calcul.valeur_totale_mad,
            calcul.stock_physique_net_kg,
            calcul.stock_quarantaine_kg,
            calcul.stock_reserve_kg,
            calcul.encours_kg,
            calcul.encours_retarde_kg,
            calcul.nb_lignes_retardees,
            calcul.retard_max_jours,
            calcul.besoin_12m_kg,
            calcul.stock_projete_kg,
            calcul.conso_mensuelle_kg,
            calcul.source_conso,
            calcul.jours_couverture,
            calcul.seuil_critique_jours,
            calcul.seuil_alerte_jours,
            calcul.stock_min_kg,
            calcul.terme2_couverture_kg,
            calcul.stock_max_kg,
            calcul.statut_logique,
            calcul.statut_physique,
            calcul.statut,
            calcul.sur_stock,
            calcul.ecart_majeur,
            calcul.besoins_calcules_le,
            calcul.demande_delai_kg,
            calcul.sorties_prevues_kg,
            calcul.moq_kg,
            calcul.multiple_achat_kg,
            calcul.facteur_kg,
            calcul.poids_bobine_kg,
            calcul.bobines_par_palette,
            calcul.stock_min_catalogue_kg,
            calcul.devise,
            calcul.prix_catalogue_kg,
            calcul.prix_retenu_mad,
            calcul.source_prix,
            calcul.taux,
            calcul.sec_j,
            calcul.tier1,
            calcul.tier2,
            calcul.tier3,
            calcul.residuel_kg,
            calcul.securite_kg,
            calcul.sorties_fenetre_kg,
            calcul.besoin_net_kg,
                CASE
                    WHEN (calcul.besoin_net_kg > (0)::numeric) THEN GREATEST(calcul.besoin_net_kg, COALESCE(calcul.moq_kg, (0)::numeric))
                    ELSE 0.0
                END AS qte_avec_moq_kg
           FROM calcul
        ), arrondi AS (
         SELECT moq.code_reference,
            moq.designation,
            moq.code_fournisseur,
            moq.fournisseur_nom,
            moq.fournisseur_pays,
            moq.delai_livraison_jours,
            moq.classe_abc,
            moq.classe_xyz,
            moq.unite_catalogue,
            moq.cmup_mad,
            moq.stock_mrp_kg,
            moq.stock_total_kg,
            moq.valeur_totale_mad,
            moq.stock_physique_net_kg,
            moq.stock_quarantaine_kg,
            moq.stock_reserve_kg,
            moq.encours_kg,
            moq.encours_retarde_kg,
            moq.nb_lignes_retardees,
            moq.retard_max_jours,
            moq.besoin_12m_kg,
            moq.stock_projete_kg,
            moq.conso_mensuelle_kg,
            moq.source_conso,
            moq.jours_couverture,
            moq.seuil_critique_jours,
            moq.seuil_alerte_jours,
            moq.stock_min_kg,
            moq.terme2_couverture_kg,
            moq.stock_max_kg,
            moq.statut_logique,
            moq.statut_physique,
            moq.statut,
            moq.sur_stock,
            moq.ecart_majeur,
            moq.besoins_calcules_le,
            moq.demande_delai_kg,
            moq.sorties_prevues_kg,
            moq.moq_kg,
            moq.multiple_achat_kg,
            moq.facteur_kg,
            moq.poids_bobine_kg,
            moq.bobines_par_palette,
            moq.stock_min_catalogue_kg,
            moq.devise,
            moq.prix_catalogue_kg,
            moq.prix_retenu_mad,
            moq.source_prix,
            moq.taux,
            moq.sec_j,
            moq.tier1,
            moq.tier2,
            moq.tier3,
            moq.residuel_kg,
            moq.securite_kg,
            moq.sorties_fenetre_kg,
            moq.besoin_net_kg,
            moq.qte_avec_moq_kg,
                CASE
                    WHEN (moq.qte_avec_moq_kg <= (0)::numeric) THEN 0.0
                    WHEN ((moq.multiple_achat_kg IS NULL) OR (moq.multiple_achat_kg <= (0)::numeric)) THEN round(moq.qte_avec_moq_kg, 4)
                    ELSE round((ceil((moq.qte_avec_moq_kg / moq.multiple_achat_kg)) * moq.multiple_achat_kg), 4)
                END AS qte_a_commander_kg
           FROM moq
        )
 SELECT code_reference,
    designation,
    code_fournisseur,
    fournisseur_nom,
    fournisseur_pays,
    delai_livraison_jours,
    classe_abc,
    classe_xyz,
    unite_catalogue,
    stock_mrp_kg,
    encours_kg,
    besoin_12m_kg,
    stock_projete_kg,
    jours_couverture,
    conso_mensuelle_kg,
    source_conso,
    statut,
    stock_min_kg,
    qte_a_commander_kg,
        CASE
            WHEN (facteur_kg > (0)::numeric) THEN round((qte_a_commander_kg / facteur_kg), 4)
            ELSE NULL::numeric
        END AS qte_a_commander_unite,
    prix_retenu_mad AS prix_estime_mad,
    source_prix,
    round((qte_a_commander_kg * prix_retenu_mad), 2) AS montant_estime_mad,
        CASE
            WHEN (statut = 'RUPTURE'::text) THEN 'TIER 1'::text
            WHEN ((classe_abc = 'A'::text) AND ((qte_a_commander_kg * prix_retenu_mad) >= tier1)) THEN 'TIER 1'::text
            WHEN ((qte_a_commander_kg * prix_retenu_mad) >= tier2) THEN 'TIER 2'::text
            WHEN ((qte_a_commander_kg * prix_retenu_mad) >= tier3) THEN 'TIER 3'::text
            ELSE 'TIER 4'::text
        END AS tier,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM (((public.reference_groupe_equiv rge1
                 JOIN public.reference_groupe_equiv rge2 ON (((rge2.code_groupe_equiv = rge1.code_groupe_equiv) AND (rge2.code_reference <> rge1.code_reference) AND (rge2.actif = 1))))
                 JOIN public.reference r2 ON (((r2.code_reference = rge2.code_reference) AND (r2.actif = 1))))
                 JOIN public.reference r1 ON ((r1.code_reference = rge1.code_reference)))
              WHERE ((rge1.code_reference = a.code_reference) AND (rge1.actif = 1) AND (r2.code_fournisseur IS DISTINCT FROM r1.code_fournisseur))) > 0) THEN 'MULTI-SOURCE'::text
            ELSE 'MONO-SOURCE'::text
        END AS risque_sourcing,
    to_char(((CURRENT_DATE + (delai_livraison_jours)::integer))::timestamp with time zone, 'YYYY-MM-DD'::text) AS date_besoin_prevue,
    devise,
    round(prix_catalogue_kg, 4) AS prix_devise,
    round((qte_a_commander_kg * prix_catalogue_kg), 2) AS montant_devise,
    round(taux, 4) AS taux_devise,
        CASE
            WHEN ((poids_bobine_kg > (0)::numeric) AND (bobines_par_palette > 0)) THEN (ceil((qte_a_commander_kg / (poids_bobine_kg * (bobines_par_palette)::numeric))))::bigint
            ELSE NULL::bigint
        END AS palettes_a_commander,
    round(sorties_fenetre_kg, 4) AS sorties_fenetre_kg,
    round(securite_kg, 4) AS securite_kg,
    round(residuel_kg, 4) AS residuel_kg,
    round(stock_min_catalogue_kg, 4) AS stock_min_catalogue_kg,
    round(qte_avec_moq_kg, 4) AS besoin_avant_arrondi_kg,
    round((qte_a_commander_kg - qte_avec_moq_kg), 4) AS complement_palette_kg
   FROM arrondi a
  WHERE (qte_a_commander_kg > (0)::numeric)
  ORDER BY
        CASE statut
            WHEN 'RUPTURE'::text THEN 1
            WHEN 'CRITIQUE'::text THEN 2
            WHEN 'ATTENTION'::text THEN 3
            ELSE 4
        END, (qte_a_commander_kg * prix_retenu_mad) DESC;


ALTER VIEW public.v_plan_achat OWNER TO gestionfil;

--
-- Name: v_stock_dormant; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stock_dormant AS
 SELECT sm.code_reference,
    r.designation,
    sm.code_magasin,
    mg.nom AS magasin_nom,
    sm.quantite_kg,
    sm.cmup_mad,
    sm.valeur_mad,
    sm.date_derniere_sortie,
    sm.date_derniere_entree,
    COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree) AS date_reference_dormance,
    ((CURRENT_DATE - (COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree))::date))::bigint AS jours_sans_mouvement,
    r.classe_abc
   FROM ((public.stock_magasin sm
     JOIN public.reference r ON ((r.code_reference = sm.code_reference)))
     JOIN public.magasin mg ON ((mg.code_magasin = sm.code_magasin)))
  WHERE ((sm.quantite_kg > (0)::numeric) AND (COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree) IS NOT NULL) AND (((CURRENT_DATE - (COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree))::date))::numeric > ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_SeuilDormant'::text))))
  ORDER BY (((CURRENT_DATE - (COALESCE(sm.date_derniere_sortie, sm.date_derniere_entree))::date))::bigint) DESC;


ALTER VIEW public.v_stock_dormant OWNER TO gestionfil;

--
-- Name: v_cockpit_files; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_files AS
 SELECT ( SELECT count(*) AS count
           FROM public.plan_achat
          WHERE (plan_achat.statut = ANY (ARRAY['PROPOSE'::text, 'EN_REVISION'::text]))) AS nb_propositions_a_traiter,
    ( SELECT count(*) AS count
           FROM public.bon_commande
          WHERE (bon_commande.statut = 'BROUILLON'::text)) AS nb_bc_en_preparation,
    ( SELECT count(*) AS count
           FROM public.bon_commande
          WHERE (bon_commande.statut = 'EN_ATTENTE_VALIDATION'::text)) AS nb_bc_a_valider,
    ( SELECT round(COALESCE(sum(bon_commande.montant_total_mad), (0)::numeric), 2) AS round
           FROM public.bon_commande
          WHERE (bon_commande.statut = 'EN_ATTENTE_VALIDATION'::text)) AS montant_bc_a_valider_mad,
    ( SELECT count(*) AS count
           FROM public.bon_commande
          WHERE (bon_commande.statut = 'VALIDE'::text)) AS nb_bc_a_envoyer,
    ( SELECT count(*) AS count
           FROM public.bon_commande
          WHERE ((bon_commande.statut = ANY (ARRAY['ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND (bon_commande.date_livraison_prevue IS NOT NULL) AND (substr(bon_commande.date_livraison_prevue, 1, 10) < to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text)))) AS nb_livraisons_en_retard,
    ( SELECT COALESCE(max(((CURRENT_DATE - (bon_commande.date_livraison_prevue)::date))::bigint), (0)::bigint) AS "coalesce"
           FROM public.bon_commande
          WHERE ((bon_commande.statut = ANY (ARRAY['ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND (bon_commande.date_livraison_prevue IS NOT NULL) AND (substr(bon_commande.date_livraison_prevue, 1, 10) < to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text)))) AS retard_max_jours,
    ( SELECT count(*) AS count
           FROM public.reception
          WHERE (reception.statut = 'BROUILLON'::text)) AS nb_receptions_en_saisie,
    (( SELECT count(*) AS count
           FROM public.reception
          WHERE (reception.statut = 'A_CONTROLER'::text)) + ( SELECT count(*) AS count
           FROM public.import_receptions
          WHERE (import_receptions.statut = 'A_CONTROLER'::text))) AS nb_receptions_a_controler,
    ( SELECT count(*) AS count
           FROM (public.ligne_reception lr
             JOIN public.reception rc ON ((rc.id_reception = lr.id_reception)))
          WHERE ((rc.statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text])) AND (lr.statut_qualite <> 'CONFORME'::text))) AS nb_lignes_non_conformes,
    ( SELECT count(DISTINCT rc.id_reception) AS count
           FROM (((public.reception rc
             JOIN public.ligne_reception lr ON ((lr.id_reception = rc.id_reception)))
             JOIN public.ligne_bc lb ON ((lb.id_ligne_bc = lr.id_ligne_bc)))
             JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
          WHERE ((rc.statut = ANY (ARRAY['BROUILLON'::text, 'A_CONTROLER'::text])) AND (bc.statut = ANY (ARRAY['BROUILLON'::text, 'EN_ATTENTE_VALIDATION'::text, 'VALIDE'::text])))) AS nb_receptions_a_regulariser,
    ( SELECT count(*) AS count
           FROM public.v_plan_achat
          WHERE (v_plan_achat.stock_projete_kg < v_plan_achat.stock_min_kg)) AS nb_refs_sous_minimum,
    ( SELECT count(*) AS count
           FROM public.v_stock_dormant) AS nb_refs_dormantes,
    ( SELECT round(COALESCE(sum(v_stock_dormant.valeur_mad), (0)::numeric), 2) AS round
           FROM public.v_stock_dormant) AS valeur_dormante_mad,
    ( SELECT count(*) AS count
           FROM public.v_lot_fefo
          WHERE ((v_lot_fefo.jours_avant_peremption IS NOT NULL) AND (v_lot_fefo.jours_avant_peremption <= 90))) AS nb_lots_peremption_proche,
    ( SELECT count(*) AS count
           FROM public.v_controles
          WHERE ((v_controles.criticite = 'BLOQUANT'::text) AND (v_controles.anomalies > 0))) AS nb_controles_bloquants,
    ( SELECT count(*) AS count
           FROM public.v_controles
          WHERE ((v_controles.criticite = 'CRITIQUE'::text) AND (v_controles.anomalies > 0))) AS nb_controles_critiques,
    ( SELECT count(*) AS count
           FROM public.alerte
          WHERE (alerte.statut = 'OUVERTE'::text)) AS nb_alertes_ouvertes;


ALTER VIEW public.v_cockpit_files OWNER TO gestionfil;

--
-- Name: v_lot_variation; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_lot_variation AS
 SELECT lm.code_reference,
    lm.lot_fournisseur,
    count(*) AS nb_lignes_pesees,
    round(sum(((lm.nb_bobines)::numeric * lm.poids_unitaire_theorique_kg)), 4) AS theorique_kg,
    round(sum(lm.quantite_kg), 4) AS reel_kg,
    round(sum((lm.quantite_kg - ((lm.nb_bobines)::numeric * lm.poids_unitaire_theorique_kg))), 4) AS ecart_cumule_kg,
    round(((sum((lm.quantite_kg - ((lm.nb_bobines)::numeric * lm.poids_unitaire_theorique_kg))) / NULLIF(sum(((lm.nb_bobines)::numeric * lm.poids_unitaire_theorique_kg)), (0)::numeric)) * (100)::numeric), 2) AS ecart_cumule_pct,
    round((sum(lm.quantite_kg) / NULLIF(sum(lm.nb_bobines), (0)::numeric)), 4) AS poids_reel_moyen_bobine_kg,
    round(avg(lm.poids_unitaire_theorique_kg), 4) AS poids_catalogue_bobine_kg
   FROM (public.ligne_mouvement lm
     JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
  WHERE ((lm.lot_fournisseur IS NOT NULL) AND (COALESCE(lm.nb_bobines, (0)::bigint) > 0) AND (lm.poids_unitaire_theorique_kg > (0)::numeric) AND (m.code_type_mvt = 'ENTREE_REC'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.mouvement inv
          WHERE (inv.id_mouvement_contrepasse = m.id_mouvement)))))
  GROUP BY lm.code_reference, lm.lot_fournisseur;


ALTER VIEW public.v_lot_variation OWNER TO gestionfil;

--
-- Name: v_lot; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_lot AS
 WITH solde AS (
         SELECT stock_lot.code_reference,
            stock_lot.lot_fournisseur,
            sum(stock_lot.quantite_kg) AS kg,
            sum(stock_lot.nb_bobines) AS bobines,
            min(stock_lot.date_premiere_entree) AS premiere_entree
           FROM public.stock_lot
          GROUP BY stock_lot.code_reference, stock_lot.lot_fournisseur
        ), p AS (
         SELECT max(
                CASE
                    WHEN (parametre.code_parametre = 'P_LotDormanceJours'::text) THEN (parametre.valeur_courante)::numeric
                    ELSE NULL::numeric
                END) AS dormance,
            max(
                CASE
                    WHEN (parametre.code_parametre = 'P_LotTolOrangePct'::text) THEN (parametre.valeur_courante)::numeric
                    ELSE NULL::numeric
                END) AS orange,
            max(
                CASE
                    WHEN (parametre.code_parametre = 'P_LotTolRougePct'::text) THEN (parametre.valeur_courante)::numeric
                    ELSE NULL::numeric
                END) AS rouge
           FROM public.parametre
        )
 SELECT l.code_reference,
    r.designation,
    r.code_categorie,
    l.lot_fournisseur,
    l.origine,
    l.code_fournisseur,
    f.nom AS fournisseur_nom,
    l.statut,
        CASE
            WHEN (r.suivi_lot = 1) THEN l.categorie
            ELSE 'PROJET'::text
        END AS categorie,
    r.type_lot,
    (r.fusion_lot = 1) AS fusion_autorisee,
    l.fusionne_dans,
    l.date_creation,
    l.date_derniere_activite,
    COALESCE(s.kg, (0)::numeric) AS solde_kg,
    COALESCE(s.bobines, (0)::numeric) AS solde_bobines,
    sx.valeur AS seuil_valeur,
    sx.unite AS seuil_unite,
    sx.bobines AS seuil_bobines,
    sx.kg AS seuil_restes_kg,
    (CURRENT_DATE - (substr(l.date_derniere_activite, 1, 10))::date) AS jours_sans_activite,
    ((COALESCE(s.kg, (0)::numeric) > (0)::numeric) AND (((CURRENT_DATE - (substr(l.date_derniere_activite, 1, 10))::date))::numeric > p.dormance)) AS dormant,
    ((l.categorie = 'PROJET'::text) AND (l.statut = 'LIBRE'::text) AND (COALESCE(s.kg, (0)::numeric) > (0)::numeric) AND (NOT public.fn_lot_au_seuil(l.code_reference, s.kg, s.bobines))) AS a_basculer,
    v.ecart_cumule_kg,
    v.ecart_cumule_pct,
    v.poids_reel_moyen_bobine_kg,
    r.poids_bobine_kg AS poids_catalogue_bobine_kg,
        CASE
            WHEN (v.ecart_cumule_pct IS NULL) THEN NULL::text
            WHEN (abs(v.ecart_cumule_pct) > p.rouge) THEN 'ROUGE'::text
            WHEN (abs(v.ecart_cumule_pct) > p.orange) THEN 'ORANGE'::text
            ELSE 'VERT'::text
        END AS alerte_derive,
    round((COALESCE(s.kg, (0)::numeric) * COALESCE(( SELECT sm.cmup_mad
           FROM public.stock_magasin sm
          WHERE ((sm.code_reference = l.code_reference) AND (sm.cmup_mad IS NOT NULL))
          ORDER BY sm.quantite_kg DESC
         LIMIT 1), r.cmup_mad, (0)::numeric)), 2) AS valeur_mad
   FROM ((((((public.lot l
     JOIN public.reference r ON ((r.code_reference = l.code_reference)))
     LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = l.code_fournisseur)))
     LEFT JOIN solde s ON (((s.code_reference = l.code_reference) AND (s.lot_fournisseur = l.lot_fournisseur))))
     LEFT JOIN public.v_lot_variation v ON (((v.code_reference = l.code_reference) AND (v.lot_fournisseur = l.lot_fournisseur))))
     LEFT JOIN LATERAL public.fn_lot_seuil(l.code_reference) sx(valeur, unite, bobines, kg) ON (true))
     CROSS JOIN p);


ALTER VIEW public.v_lot OWNER TO gestionfil;

--
-- Name: v_cockpit_lots; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_lots AS
 SELECT ( SELECT count(*) AS count
           FROM public.v_lot
          WHERE v_lot.a_basculer) AS lots_a_basculer,
    ( SELECT count(*) AS count
           FROM public.v_lot
          WHERE v_lot.dormant) AS lots_dormants,
    ( SELECT count(*) AS count
           FROM public.v_lot
          WHERE ((v_lot.statut = 'BLOQUE'::text) AND (v_lot.solde_kg > (0)::numeric))) AS lots_bloques,
    ( SELECT count(*) AS count
           FROM public.v_lot
          WHERE ((v_lot.alerte_derive = ANY (ARRAY['ORANGE'::text, 'ROUGE'::text])) AND (v_lot.solde_kg > (0)::numeric))) AS lots_en_derive,
    ( SELECT count(*) AS count
           FROM public.demande_autorisation
          WHERE (demande_autorisation.statut = 'EN_ATTENTE'::text)) AS autorisations_en_attente,
    ( SELECT round(sum(v_lot.solde_kg), 0) AS round
           FROM public.v_lot
          WHERE ((v_lot.categorie = 'RESTES'::text) AND (v_lot.statut = 'LIBRE'::text))) AS restes_kg,
    ( SELECT round(sum(v_lot.solde_kg), 0) AS round
           FROM public.v_lot
          WHERE ((v_lot.categorie = 'PROJET'::text) AND (v_lot.statut = 'LIBRE'::text))) AS projet_kg;


ALTER VIEW public.v_cockpit_lots OWNER TO gestionfil;

--
-- Name: v_cockpit_mono_source; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_mono_source AS
 SELECT code_reference,
    designation,
    fournisseur_nom,
    delai_livraison_jours,
    statut,
    round(jours_couverture, 1) AS jours_couverture,
    round(((COALESCE(conso_mensuelle_kg, (0)::numeric) * (12)::numeric) * COALESCE(cmup_mad, (0)::numeric)), 2) AS budget_annuel_mad
   FROM public.v_stock_projete sp
  WHERE (NOT (EXISTS ( SELECT 1
           FROM ((public.reference_groupe_equiv a
             JOIN public.reference_groupe_equiv b ON (((b.code_groupe_equiv = a.code_groupe_equiv) AND (b.code_reference <> a.code_reference) AND (b.actif = 1))))
             JOIN public.reference rb ON (((rb.code_reference = b.code_reference) AND (rb.actif = 1))))
          WHERE ((a.code_reference = sp.code_reference) AND (a.actif = 1) AND (rb.code_fournisseur IS DISTINCT FROM sp.code_fournisseur)))));


ALTER VIEW public.v_cockpit_mono_source OWNER TO gestionfil;

--
-- Name: v_cockpit_pareto; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_pareto AS
 WITH valeur AS (
         SELECT sp.code_reference,
            sp.designation,
            r.classe_abc,
            r.classe_xyz,
            sp.statut,
            round(((COALESCE(sp.conso_mensuelle_kg, (0)::numeric) * (12)::numeric) * COALESCE(sp.cmup_mad, (0)::numeric)), 2) AS valeur_conso_annuelle_mad
           FROM (public.v_stock_projete sp
             JOIN public.reference r ON ((r.code_reference = sp.code_reference)))
          WHERE (r.actif = 1)
        )
 SELECT code_reference,
    designation,
    classe_abc,
    classe_xyz,
    statut,
    valeur_conso_annuelle_mad,
    ( SELECT (count(*) + 1)
           FROM valeur w
          WHERE (w.valeur_conso_annuelle_mad > v.valeur_conso_annuelle_mad)) AS rang,
    round(((( SELECT sum(w.valeur_conso_annuelle_mad) AS sum
           FROM valeur w
          WHERE (w.valeur_conso_annuelle_mad >= v.valeur_conso_annuelle_mad)) * 100.0) / NULLIF(( SELECT sum(valeur.valeur_conso_annuelle_mad) AS sum
           FROM valeur), (0)::numeric)), 4) AS pct_cumule
   FROM valeur v
  WHERE (valeur_conso_annuelle_mad > (0)::numeric);


ALTER VIEW public.v_cockpit_pareto OWNER TO gestionfil;

--
-- Name: v_cockpit_stock; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cockpit_stock AS
 WITH s AS (
         SELECT v_stock_projete.statut,
            v_stock_projete.classe_abc
           FROM public.v_stock_projete
        ), p AS (
         SELECT v_plan_achat.montant_estime_mad,
            v_plan_achat.classe_abc,
            v_plan_achat.tier
           FROM public.v_plan_achat
        )
 SELECT ( SELECT count(*) AS count
           FROM s
          WHERE (s.statut = 'RUPTURE'::text)) AS nb_ruptures,
    ( SELECT count(*) AS count
           FROM s
          WHERE (s.statut = 'CRITIQUE'::text)) AS nb_critiques,
    ( SELECT count(*) AS count
           FROM s
          WHERE (s.statut = 'ATTENTION'::text)) AS nb_attention,
    ( SELECT count(*) AS count
           FROM public.v_stock_projete
          WHERE (v_stock_projete.sur_stock = 1)) AS nb_sur_stock,
    ( SELECT count(*) AS count
           FROM public.v_stock_projete
          WHERE (v_stock_projete.ecart_majeur = 1)) AS nb_ecart_majeur,
    ( SELECT max(besoin_mrp.date_calcul) AS max
           FROM public.besoin_mrp) AS besoins_calcules_le,
    ( SELECT count(*) AS count
           FROM public.plan_production pp
          WHERE ((pp.statut = 'EN_COURS'::text) AND public.fn_besoins_perimes(pp.id_plan))) AS besoins_perimes,
    ( SELECT count(*) AS count
           FROM s
          WHERE (s.statut = 'OK'::text)) AS nb_ok,
    ( SELECT count(*) AS count
           FROM s) AS nb_references,
    ( SELECT round(COALESCE(sum(stock_magasin.valeur_mad), (0)::numeric), 2) AS round
           FROM public.stock_magasin) AS valeur_stock_mad,
    ( SELECT count(*) AS count
           FROM p) AS nb_refs_a_commander,
    ( SELECT round(COALESCE(sum(p.montant_estime_mad), (0)::numeric), 2) AS round
           FROM p) AS budget_a_engager_mad,
    ( SELECT count(*) AS count
           FROM p
          WHERE (p.classe_abc = 'A'::text)) AS nb_classe_a_alerte,
    ( SELECT count(*) AS count
           FROM p
          WHERE (p.tier = 'TIER 1'::text)) AS nb_tier1,
    ( SELECT count(*) AS count
           FROM public.fournisseur
          WHERE (fournisseur.actif = 1)) AS nb_fournisseurs_actifs,
    ( SELECT count(*) AS count
           FROM public.bon_commande
          WHERE (bon_commande.statut = ANY (ARRAY['VALIDE'::text, 'ENVOYE'::text, 'LIVRE_PARTIEL'::text]))) AS nb_bc_ouverts,
    ( SELECT round(COALESCE(sum(bon_commande.montant_total_mad), (0)::numeric), 2) AS round
           FROM public.bon_commande
          WHERE (bon_commande.statut = ANY (ARRAY['VALIDE'::text, 'ENVOYE'::text, 'LIVRE_PARTIEL'::text]))) AS montant_bc_ouverts_mad,
    ( SELECT count(*) AS count
           FROM public.alerte
          WHERE ((alerte.statut = 'OUVERTE'::text) AND (alerte.gravite = ANY (ARRAY['CRITIQUE'::text, 'BLOQUANT'::text])))) AS nb_alertes_critiques;


ALTER VIEW public.v_cockpit_stock OWNER TO gestionfil;

--
-- Name: v_coherence_recette; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_coherence_recette AS
 WITH roles_declares AS (
         SELECT lq.code_qualite,
            lq.code_role,
            rb.libelle AS role_libelle
           FROM (public.ligne_qualite lq
             JOIN public.role_bom rb ON ((rb.code_role = lq.code_role)))
          WHERE (lq.actif = 1)
        ), sommes AS (
         SELECT rd.code_qualite,
            rd.code_role,
            rd.role_libelle,
            COALESCE(sum(r.pourcentage_composition), (0)::numeric) AS somme_pct,
            count(r.id_recette) AS nb_lignes
           FROM (roles_declares rd
             LEFT JOIN public.recette r ON (((r.code_qualite = rd.code_qualite) AND (r.code_role = rd.code_role) AND (r.actif = 1))))
          GROUP BY rd.code_qualite, rd.code_role, rd.role_libelle
        ), juge AS (
         SELECT s.code_qualite,
            s.code_role,
            s.role_libelle,
            s.somme_pct,
            s.nb_lignes,
                CASE
                    WHEN (s.nb_lignes = 0) THEN 'VIDE'::text
                    WHEN (abs((s.somme_pct - 100.0)) <= ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
                       FROM public.parametre
                      WHERE (parametre.code_parametre = 'P_ToleranceRecette'::text))) THEN 'OK'::text
                    ELSE 'HORS_100'::text
                END AS etat
           FROM sommes s
        )
 SELECT q.code_qualite,
    q.nom AS qualite_nom,
    q.statut AS statut_qualite,
    count(j.code_role) AS roles_declares,
    sum(
        CASE
            WHEN (j.etat = 'OK'::text) THEN 1
            ELSE 0
        END) AS roles_conformes,
    sum(
        CASE
            WHEN (j.etat = 'VIDE'::text) THEN 1
            ELSE 0
        END) AS roles_vides,
    sum(
        CASE
            WHEN (j.etat = 'HORS_100'::text) THEN 1
            ELSE 0
        END) AS roles_hors_100,
    ( SELECT string_agg((((k.role_libelle || ' ('::text) || (round(k.somme_pct, 0))::bigint) || '%)'::text), ', '::text) AS string_agg
           FROM juge k
          WHERE ((k.code_qualite = q.code_qualite) AND (k.etat <> 'OK'::text))) AS roles_fautifs,
        CASE
            WHEN (sum(
            CASE
                WHEN (j.etat <> 'OK'::text) THEN 1
                ELSE 0
            END) = 0) THEN 'OK'::text
            ELSE 'ANOMALIE'::text
        END AS verdict
   FROM (public.qualite q
     LEFT JOIN juge j ON ((j.code_qualite = q.code_qualite)))
  WHERE (q.statut <> 'CLOTURE'::text)
  GROUP BY q.code_qualite, q.nom, q.statut;


ALTER VIEW public.v_coherence_recette OWNER TO gestionfil;

--
-- Name: v_cout_revient; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_cout_revient AS
 WITH bases AS (
         SELECT lr_1.id_reception,
            sum(lr_1.quantite_stock_kg) AS poids_total_kg,
            sum((lr_1.quantite_stock_kg * COALESCE(lr_1.prix_kg_mad, (0)::numeric))) AS valeur_totale_mad,
            count(*) AS nb_lignes
           FROM public.ligne_reception lr_1
          GROUP BY lr_1.id_reception
        ), quote_part AS (
         SELECT lr_1.id_ligne_reception,
            sum(((fa.montant_devise * fa.taux_change) *
                CASE fa.cle_repartition
                    WHEN 'POIDS'::text THEN (lr_1.quantite_stock_kg / NULLIF(b.poids_total_kg, (0)::numeric))
                    WHEN 'VALEUR'::text THEN ((lr_1.quantite_stock_kg * COALESCE(lr_1.prix_kg_mad, (0)::numeric)) / NULLIF(b.valeur_totale_mad, (0)::numeric))
                    ELSE (1.0 / (NULLIF(b.nb_lignes, 0))::numeric)
                END)) AS frais_mad
           FROM ((public.ligne_reception lr_1
             JOIN bases b ON ((b.id_reception = lr_1.id_reception)))
             JOIN public.frais_approche fa ON ((fa.id_reception = lr_1.id_reception)))
          GROUP BY lr_1.id_ligne_reception
        )
 SELECT lr.id_ligne_reception,
    rc.numero_reception,
    rc.date_reception,
    lr.code_reference,
    r.designation,
    f.nom AS fournisseur_nom,
    lr.quantite_stock_kg,
    round(lr.prix_kg_mad, 4) AS prix_achat_mad_kg,
    round(COALESCE(qp.frais_mad, (0)::numeric), 2) AS frais_approche_mad,
    round((COALESCE(qp.frais_mad, (0)::numeric) / NULLIF(lr.quantite_stock_kg, (0)::numeric)), 4) AS frais_mad_kg,
    round((COALESCE(lr.prix_kg_mad, (0)::numeric) + (COALESCE(qp.frais_mad, (0)::numeric) / NULLIF(lr.quantite_stock_kg, (0)::numeric))), 4) AS cout_revient_mad_kg,
    round(((COALESCE(qp.frais_mad, (0)::numeric) * 100.0) / NULLIF((lr.quantite_stock_kg * COALESCE(lr.prix_kg_mad, (0)::numeric)), (0)::numeric)), 2) AS part_frais_pct
   FROM ((((public.ligne_reception lr
     JOIN public.reception rc ON ((rc.id_reception = lr.id_reception)))
     JOIN public.reference r ON ((r.code_reference = lr.code_reference)))
     LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = rc.code_fournisseur)))
     LEFT JOIN quote_part qp ON ((qp.id_ligne_reception = lr.id_ligne_reception)))
  WHERE (rc.statut = 'VALIDE'::text);


ALTER VIEW public.v_cout_revient OWNER TO gestionfil;

--
-- Name: v_document_mouvements_vivants; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_document_mouvements_vivants AS
 SELECT m.reference_document AS document,
    count(*) AS nb_mouvements,
    round(COALESCE(sum(lm.quantite_kg), (0)::numeric), 3) AS kg
   FROM (public.mouvement m
     LEFT JOIN public.ligne_mouvement lm ON ((lm.id_mouvement = m.id_mouvement)))
  WHERE ((m.reference_document IS NOT NULL) AND (m.id_mouvement_contrepasse IS NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.mouvement x
          WHERE (x.id_mouvement_contrepasse = m.id_mouvement)))))
  GROUP BY m.reference_document;


ALTER VIEW public.v_document_mouvements_vivants OWNER TO gestionfil;

--
-- Name: v_encours_bc; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_encours_bc AS
 SELECT lb.code_reference,
    round(sum(lb.quantite_restante_kg), 4) AS encours_kg,
    count(DISTINCT lb.id_bc) AS nb_bc_ouverts,
    min(lb.date_livraison_prevue) AS prochaine_livraison
   FROM (public.ligne_bc lb
     JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
  WHERE ((bc.statut = ANY (ARRAY['VALIDE'::text, 'ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND (lb.statut <> ALL (ARRAY['ANNULE'::text, 'SOLDE'::text])) AND (lb.type_ligne = 'MARCHANDISE'::text) AND (lb.quantite_restante_kg > (0)::numeric))
  GROUP BY lb.code_reference;


ALTER VIEW public.v_encours_bc OWNER TO gestionfil;

--
-- Name: v_equivalence_auto; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_equivalence_auto AS
 SELECT a.code_reference,
    b.code_reference AS code_equivalent,
    a.code_famille,
    f.libelle AS famille_libelle,
    a.code_couleur_interne,
    c.libelle AS couleur_libelle,
    a.code_fournisseur AS fournisseur,
    b.code_fournisseur AS fournisseur_equivalent,
    a.reference_fournisseur AS reference_chez_fournisseur,
    b.reference_fournisseur AS reference_chez_equivalent,
    ( SELECT count(*) AS count
           FROM (public.reference_groupe_equiv g1
             JOIN public.reference_groupe_equiv g2 ON ((g2.code_groupe_equiv = g1.code_groupe_equiv)))
          WHERE ((g1.code_reference = a.code_reference) AND (g2.code_reference = b.code_reference) AND (g1.actif = 1) AND (g2.actif = 1))) AS deja_groupees
   FROM (((public.reference a
     JOIN public.reference b ON (((b.code_famille = a.code_famille) AND (b.code_couleur_interne = a.code_couleur_interne) AND (b.code_reference <> a.code_reference))))
     LEFT JOIN public.famille f ON ((f.code_famille = a.code_famille)))
     LEFT JOIN public.couleur c ON ((c.code_couleur_interne = a.code_couleur_interne)))
  WHERE ((a.actif = 1) AND (b.actif = 1) AND (a.code_famille IS NOT NULL) AND (a.code_couleur_interne IS NOT NULL) AND (a.code_fournisseur <> b.code_fournisseur));


ALTER VIEW public.v_equivalence_auto OWNER TO gestionfil;

--
-- Name: v_etat_stock; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_etat_stock AS
 WITH ventilation AS (
         SELECT sm.code_reference,
            jsonb_object_agg(sm.code_magasin, round(sm.quantite_kg, 3)) FILTER (WHERE ((e.code_machine IS NULL) AND (sm.quantite_kg <> (0)::numeric))) AS par_magasin,
            COALESCE(sum(sm.quantite_kg) FILTER (WHERE (e.code_machine IS NULL)), (0)::numeric) AS magasins_kg,
            COALESCE(sum(sm.quantite_kg) FILTER (WHERE (e.code_machine IS NOT NULL)), (0)::numeric) AS machines_kg,
            COALESCE(sum(sm.nb_bobines) FILTER (WHERE (e.code_machine IS NOT NULL)), (0)::numeric) AS machines_bobines,
            count(DISTINCT e.code_machine) FILTER (WHERE (e.code_machine IS NOT NULL)) AS nb_machines
           FROM (public.stock_magasin sm
             LEFT JOIN public.machine_emplacement e ON ((e.code_magasin = sm.code_magasin)))
          GROUP BY sm.code_reference
        ), mouvement_dernier AS (
         SELECT lm.code_reference,
            max(mv.date_mouvement) FILTER (WHERE (tm.signe = '-1'::integer)) AS derniere_sortie,
            max(mv.date_mouvement) AS dernier_mouvement
           FROM ((public.ligne_mouvement lm
             JOIN public.mouvement mv ON ((mv.id_mouvement = lm.id_mouvement)))
             JOIN public.type_mouvement tm ON ((tm.code_type_mvt = mv.code_type_mvt)))
          GROUP BY lm.code_reference
        )
 SELECT sp.code_reference,
    sp.designation,
    r.code_categorie,
    cm.libelle AS categorie,
    sp.code_fournisseur,
    sp.fournisseur_nom,
    sp.unite_catalogue AS unite,
    round(sp.stock_total_kg, 3) AS stock_global_kg,
    round(v.magasins_kg, 3) AS magasins_kg,
    round(v.machines_kg, 3) AS machines_kg,
    v.machines_bobines,
    v.nb_machines,
    v.par_magasin,
    round(sp.stock_quarantaine_kg, 3) AS quarantaine_kg,
    round(sp.stock_physique_net_kg, 3) AS disponible_kg,
    round(sp.encours_kg, 3) AS encours_kg,
    round(sp.besoin_12m_kg, 3) AS besoin_12m_kg,
    round(sp.stock_projete_kg, 3) AS stock_projete_kg,
    round(sp.stock_min_kg, 3) AS stock_min_kg,
    round(sp.conso_mensuelle_kg, 3) AS conso_mensuelle_kg,
    round(sp.jours_couverture, 1) AS jours_couverture,
    sp.delai_livraison_jours,
    sp.statut,
    sp.classe_abc,
    sp.classe_xyz,
    round(sp.cmup_mad, 4) AS cmup_mad,
    round(r.prix_catalogue_kg, 4) AS prix_catalogue_kg,
    r.code_devise_catalogue AS devise,
    round(sp.valeur_totale_mad, 2) AS valeur_mad,
    ((sp.stock_min_kg > (0)::numeric) AND (sp.stock_total_kg < sp.stock_min_kg)) AS sous_minimum,
    GREATEST((0)::numeric, round((sp.stock_min_kg - sp.stock_projete_kg), 3)) AS a_commander_kg,
    md.derniere_sortie,
    md.dernier_mouvement,
        CASE
            WHEN (md.dernier_mouvement IS NULL) THEN NULL::integer
            ELSE (CURRENT_DATE - ("left"(md.dernier_mouvement, 10))::date)
        END AS jours_sans_mouvement,
    rge.code_groupe_equiv,
    ( SELECT count(*) AS count
           FROM public.reference_groupe_equiv x
          WHERE ((x.code_groupe_equiv = rge.code_groupe_equiv) AND (x.code_reference <> sp.code_reference) AND (x.actif = 1))) AS nb_equivalents,
    round(((r.bobines_par_palette)::numeric * r.poids_bobine_kg), 3) AS kg_par_palette,
        CASE
            WHEN ((r.bobines_par_palette > 0) AND (r.poids_bobine_kg > (0)::numeric)) THEN round((sp.stock_total_kg / ((r.bobines_par_palette)::numeric * r.poids_bobine_kg)), 2)
            ELSE NULL::numeric
        END AS palettes,
        CASE
            WHEN (r.poids_bobine_kg > (0)::numeric) THEN round((sp.stock_total_kg / r.poids_bobine_kg))
            ELSE NULL::numeric
        END AS bobines
   FROM (((((public.v_stock_projete sp
     JOIN public.reference r ON ((r.code_reference = sp.code_reference)))
     LEFT JOIN public.categorie_matiere cm ON ((cm.code_categorie = r.code_categorie)))
     LEFT JOIN ventilation v ON ((v.code_reference = sp.code_reference)))
     LEFT JOIN mouvement_dernier md ON ((md.code_reference = sp.code_reference)))
     LEFT JOIN public.reference_groupe_equiv rge ON (((rge.code_reference = sp.code_reference) AND (rge.actif = 1))));


ALTER VIEW public.v_etat_stock OWNER TO gestionfil;

--
-- Name: v_reference_conditionnement; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_reference_conditionnement AS
 SELECT r.code_reference,
    r.code_conditionnement,
    c.libelle AS conditionnement_libelle,
    COALESCE(c.unite_singulier, 'unite'::text) AS unite_singulier,
    COALESCE(c.unite_pluriel, 'unites'::text) AS unite_pluriel,
    COALESCE(c.se_compte, 0) AS se_compte,
    c.contenance_litres,
    r.poids_bobine_kg AS poids_unite_kg,
    r.bobines_par_palette AS unites_par_palette,
        CASE
            WHEN ((r.poids_bobine_kg IS NOT NULL) AND (r.bobines_par_palette IS NOT NULL)) THEN (r.poids_bobine_kg * (r.bobines_par_palette)::numeric)
            ELSE NULL::numeric
        END AS kg_par_palette,
    ((r.code_conditionnement IS NOT NULL))::integer AS declare,
    (((r.code_conditionnement IS NOT NULL) AND (r.poids_bobine_kg IS NOT NULL) AND (r.bobines_par_palette IS NOT NULL) AND (c.se_compte = 1)))::integer AS comptable
   FROM (public.reference r
     LEFT JOIN public.conditionnement c ON ((c.code_conditionnement = r.code_conditionnement)));


ALTER VIEW public.v_reference_conditionnement OWNER TO gestionfil;

--
-- Name: VIEW v_reference_conditionnement; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON VIEW public.v_reference_conditionnement IS 'Le vocabulaire de comptage de chaque reference : quel mot employer, combien
 pese une unite, combien il en tient sur une palette, et si le comptage est
 seulement possible.';


--
-- Name: v_etat_stock_conditionne; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_etat_stock_conditionne AS
 SELECT e.code_reference,
    e.designation,
    e.code_categorie,
    e.categorie,
    e.code_fournisseur,
    e.fournisseur_nom,
    e.unite,
    e.stock_global_kg,
    e.magasins_kg,
    e.machines_kg,
    e.machines_bobines,
    e.nb_machines,
    e.par_magasin,
    e.quarantaine_kg,
    e.disponible_kg,
    e.encours_kg,
    e.besoin_12m_kg,
    e.stock_projete_kg,
    e.stock_min_kg,
    e.conso_mensuelle_kg,
    e.jours_couverture,
    e.delai_livraison_jours,
    e.statut,
    e.classe_abc,
    e.classe_xyz,
    e.cmup_mad,
    e.prix_catalogue_kg,
    e.devise,
    e.valeur_mad,
    e.sous_minimum,
    e.a_commander_kg,
    e.derniere_sortie,
    e.dernier_mouvement,
    e.jours_sans_mouvement,
    e.code_groupe_equiv,
    e.nb_equivalents,
    e.kg_par_palette,
    e.palettes,
    e.bobines,
    c.code_conditionnement,
    c.conditionnement_libelle,
    c.unite_singulier,
    c.unite_pluriel,
    c.declare AS conditionnement_declare,
    c.comptable AS conditionnement_comptable,
    c.contenance_litres,
        CASE
            WHEN (c.comptable = 1) THEN e.bobines
            ELSE NULL::numeric
        END AS nb_colis,
        CASE
            WHEN (c.comptable = 1) THEN e.palettes
            ELSE NULL::numeric
        END AS nb_palettes,
        CASE
            WHEN ((c.comptable = 1) AND (c.contenance_litres IS NOT NULL)) THEN round((e.bobines * c.contenance_litres), 0)
            ELSE NULL::numeric
        END AS litres
   FROM (public.v_etat_stock e
     JOIN public.v_reference_conditionnement c USING (code_reference));


ALTER VIEW public.v_etat_stock_conditionne OWNER TO gestionfil;

--
-- Name: VIEW v_etat_stock_conditionne; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON VIEW public.v_etat_stock_conditionne IS 'L etat du stock, augmente du vocabulaire de comptage propre a chaque matiere.
 Les nombres de colis et de palettes valent NULL quand le conditionnement n est
 pas renseigne : mieux vaut les kilos seuls qu un comptage invente.';


--
-- Name: v_suivi_conditionnement; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_suivi_conditionnement AS
 SELECT h.id_historique,
    h.date_evenement,
    h.source,
    h.id_document,
    h.numero_document,
    h.code_reference,
    h.code_fournisseur,
    h.kg,
    h.nb_bobines,
    h.nb_palettes,
    h.poids_bobine_avant,
    h.poids_bobine_mesure,
    h.bobines_palette_avant,
    h.bobines_palette_observe,
    h.prix_kg_devise,
    h.code_devise,
    h.prix_kg_mad,
    h.poids_applique,
    h.colisage_applique,
    h.id_utilisateur,
    r.designation,
    f.nom AS fournisseur_nom,
    round((((h.poids_bobine_mesure - h.poids_bobine_avant) / NULLIF(h.poids_bobine_avant, (0)::numeric)) * (100)::numeric), 2) AS variation_poids_pct,
    (h.bobines_palette_observe - h.bobines_palette_avant) AS variation_colisage,
    lag(h.prix_kg_devise) OVER w AS prix_precedent_devise,
    round((((h.prix_kg_devise - lag(h.prix_kg_devise) OVER w) / NULLIF(lag(h.prix_kg_devise) OVER w, (0)::numeric)) * (100)::numeric), 2) AS variation_prix_pct
   FROM ((public.historique_conditionnement h
     JOIN public.reference r ON ((r.code_reference = h.code_reference)))
     LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = h.code_fournisseur)))
  WINDOW w AS (PARTITION BY h.code_reference, h.code_devise ORDER BY h.date_evenement);


ALTER VIEW public.v_suivi_conditionnement OWNER TO gestionfil;

--
-- Name: v_evaluation_conditionnement; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_evaluation_conditionnement AS
 SELECT code_fournisseur,
    fournisseur_nom,
    count(DISTINCT id_document) AS nb_receptions,
    count(DISTINCT code_reference) AS nb_references,
    round(avg(abs(variation_poids_pct)), 2) AS variation_poids_moyenne_pct,
    count(*) FILTER (WHERE (abs(variation_poids_pct) > ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_LotTolOrangePct'::text)))) AS poids_hors_tolerance,
    count(*) FILTER (WHERE (variation_colisage <> 0)) AS colisages_changes,
    round(avg(variation_prix_pct), 2) AS variation_prix_moyenne_pct,
    count(*) FILTER (WHERE (variation_prix_pct > (0)::numeric)) AS hausses_prix,
    count(*) FILTER (WHERE ((poids_applique = 0) AND (poids_bobine_mesure IS NOT NULL))) AS mesures_ecartees,
    max(date_evenement) AS derniere_reception
   FROM public.v_suivi_conditionnement s
  GROUP BY code_fournisseur, fournisseur_nom;


ALTER VIEW public.v_evaluation_conditionnement OWNER TO gestionfil;

--
-- Name: v_fournisseur_scorecard; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_fournisseur_scorecard AS
 WITH bc_agg AS (
         SELECT bon_commande.code_fournisseur,
            count(*) AS nb_bc,
            round(COALESCE(sum(bon_commande.montant_total_mad), (0)::numeric), 2) AS montant_total_mad
           FROM public.bon_commande
          WHERE (bon_commande.statut <> ALL (ARRAY['BROUILLON'::text, 'ANNULE'::text]))
          GROUP BY bon_commande.code_fournisseur
        ), rec_agg AS (
         SELECT ar.code_fournisseur,
            count(*) AS nb_lignes_recues,
            round(avg(
                CASE
                    WHEN (ar.statut_qualite = 'CONFORME'::text) THEN 100.0
                    ELSE 0.0
                END), 2) AS taux_conformite_pct,
            round(avg(
                CASE
                    WHEN (ar.conformite_delai = 1) THEN 100.0
                    ELSE 0.0
                END), 2) AS taux_ponctualite_pct,
            round(avg(abs(COALESCE(ar.ecart_pct, (0)::numeric))), 2) AS ecart_pesee_moyen_pct,
            round(avg(
                CASE
                    WHEN ((ar.statut_qualite = 'CONFORME'::text) AND (ar.conformite_delai = 1) AND (ar.conformite_quantite = 1)) THEN 100.0
                    ELSE 0.0
                END), 2) AS otif_pct,
            round(avg(COALESCE(ar.jours_retard, (0)::bigint)), 1) AS retard_moyen_jours
           FROM public.v_archive_reception_courante ar
          GROUP BY ar.code_fournisseur
        ), ref_agg AS (
         SELECT reference.code_fournisseur,
            count(*) AS nb_references
           FROM public.reference
          WHERE (reference.actif = 1)
          GROUP BY reference.code_fournisseur
        )
 SELECT f.code_fournisseur,
    f.nom,
    f.pays,
    f.code_devise,
    f.delai_livraison_jours,
    f.delai_reel_moyen_jours,
    COALESCE(rf.nb_references, (0)::bigint) AS nb_references,
    COALESCE(b.nb_bc, (0)::bigint) AS nb_bc,
    COALESCE(b.montant_total_mad, (0)::numeric) AS montant_total_mad,
    COALESCE(rc.nb_lignes_recues, (0)::bigint) AS nb_lignes_recues,
    rc.taux_conformite_pct,
    rc.taux_ponctualite_pct,
    rc.ecart_pesee_moyen_pct,
    rc.otif_pct,
    rc.retard_moyen_jours,
    f.note_globale,
        CASE
            WHEN (COALESCE(f.note_globale, (0)::numeric) >= ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
               FROM public.parametre
              WHERE (parametre.code_parametre = 'P_ScoreStrategique'::text))) THEN 'STRATEGIQUE'::text
            WHEN (COALESCE(f.note_globale, (0)::numeric) >= ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
               FROM public.parametre
              WHERE (parametre.code_parametre = 'P_ScoreStandard'::text))) THEN 'STANDARD'::text
            WHEN (COALESCE(f.note_globale, (0)::numeric) >= ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
               FROM public.parametre
              WHERE (parametre.code_parametre = 'P_ScoreSurveiller'::text))) THEN 'A_SURVEILLER'::text
            ELSE 'CHALLENGER'::text
        END AS classement
   FROM (((public.fournisseur f
     LEFT JOIN bc_agg b ON ((b.code_fournisseur = f.code_fournisseur)))
     LEFT JOIN rec_agg rc ON ((rc.code_fournisseur = f.code_fournisseur)))
     LEFT JOIN ref_agg rf ON ((rf.code_fournisseur = f.code_fournisseur)))
  WHERE (f.actif = 1);


ALTER VIEW public.v_fournisseur_scorecard OWNER TO gestionfil;

--
-- Name: v_import_cout_revient; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_import_cout_revient AS
 WITH frais AS (
         SELECT lignes_frais_repartition.id_article_dossier,
            sum(lignes_frais_repartition.montant_alloue_dhs) AS frais_dhs
           FROM public.lignes_frais_repartition
          GROUP BY lignes_frais_repartition.id_article_dossier
        )
 SELECT l.id_ligne,
    f.id_dossier,
    d.numero AS numero_dossier,
    d.statut AS statut_dossier,
    f.id_facture,
    f.numero_facture,
    f.date_facture,
    f.code_fournisseur,
    fo.nom AS fournisseur_nom,
    l.ligne_numero,
    l.type_ligne,
    l.code_reference,
    COALESCE(r.designation, l.libelle) AS designation,
    l.id_ligne_bc,
    bc.numero_bc,
    l.lot_fournisseur,
    l.code_couleur,
    l.unite,
    l.quantite,
    l.poids_net_kg,
    l.nb_bobines,
    l.nb_palettes,
    l.prix_unitaire_devise,
    f.code_devise,
    f.taux_change,
    l.montant_devise,
    l.pct_dossier,
    round((l.montant_devise * f.taux_change), 2) AS valeur_achat_dhs,
    round(((l.montant_devise * f.taux_change) / l.quantite), 4) AS prix_achat_unitaire_dhs,
    COALESCE(fr.frais_dhs, (0)::numeric) AS frais_alloues_dhs,
    (round((l.montant_devise * f.taux_change), 2) + COALESCE(fr.frais_dhs, (0)::numeric)) AS cout_revient_dhs,
    round(((round((l.montant_devise * f.taux_change), 2) + COALESCE(fr.frais_dhs, (0)::numeric)) / l.quantite), 4) AS cout_revient_unitaire_dhs,
        CASE
            WHEN (l.poids_net_kg > (0)::numeric) THEN round(((round((l.montant_devise * f.taux_change), 2) + COALESCE(fr.frais_dhs, (0)::numeric)) / l.poids_net_kg), 4)
            ELSE NULL::numeric
        END AS cout_revient_kg_dhs,
        CASE
            WHEN (l.montant_devise > (0)::numeric) THEN round(((COALESCE(fr.frais_dhs, (0)::numeric) * (100)::numeric) / round((l.montant_devise * f.taux_change), 2)), 2)
            ELSE NULL::numeric
        END AS coef_frais_pct,
    l.quantite_recue_kg,
    l.reste_kg,
    l.soldee,
    l.libelle_couleur,
    l.remise_pct
   FROM (((((((public.import_facture_lignes l
     JOIN public.import_factures f ON ((f.id_facture = l.id_facture)))
     JOIN public.import_dossiers d ON ((d.id_dossier = f.id_dossier)))
     LEFT JOIN public.reference r ON ((r.code_reference = l.code_reference)))
     LEFT JOIN public.fournisseur fo ON ((fo.code_fournisseur = f.code_fournisseur)))
     LEFT JOIN public.ligne_bc lb ON ((lb.id_ligne_bc = l.id_ligne_bc)))
     LEFT JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
     LEFT JOIN frais fr ON ((fr.id_article_dossier = l.id_ligne)));


ALTER VIEW public.v_import_cout_revient OWNER TO gestionfil;

--
-- Name: v_lot_vie; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_lot_vie AS
 SELECT lm.code_reference,
    lm.lot_fournisseur,
    m.date_mouvement AS date_evenement,
    'MOUVEMENT'::text AS nature,
    tm.libelle AS evenement,
    m.numero_mouvement AS document,
    COALESCE(m.reference_document, ''::text) AS document_origine,
    m.code_magasin AS lieu,
    round(((tm.signe)::numeric * lm.quantite_kg), 4) AS kg,
    lm.nb_bobines,
    round(((lm.nb_bobines)::numeric * lm.poids_unitaire_theorique_kg), 4) AS theorique_kg,
    round((lm.quantite_kg - ((lm.nb_bobines)::numeric * lm.poids_unitaire_theorique_kg)), 4) AS ecart_kg,
    round(lm.ecart_theorique_pct, 2) AS ecart_pct,
    u.login AS utilisateur,
    COALESCE(lm.motif_lot_force, m.observations_globales) AS motif
   FROM (((public.ligne_mouvement lm
     JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
     JOIN public.type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
     LEFT JOIN public.utilisateur u ON ((u.id_utilisateur = m.id_utilisateur)))
  WHERE (lm.lot_fournisseur IS NOT NULL)
UNION ALL
 SELECT e.code_reference,
    e.lot_fournisseur,
    e.date_evenement,
    'DECISION'::text AS nature,
    e.type_evenement AS evenement,
    NULL::text AS document,
    ''::text AS document_origine,
    NULL::text AS lieu,
    NULL::numeric AS kg,
    NULL::bigint AS nb_bobines,
    NULL::numeric AS theorique_kg,
    NULL::numeric AS ecart_kg,
    NULL::numeric AS ecart_pct,
    u.login AS utilisateur,
    e.motif
   FROM (public.lot_evenement e
     LEFT JOIN public.utilisateur u ON ((u.id_utilisateur = e.id_utilisateur)))
UNION ALL
 SELECT d.code_reference,
    d.lot_fournisseur,
    d.date_demande AS date_evenement,
    'AUTORISATION'::text AS nature,
    ((((d.type_demande || ' ('::text) || d.niveau) || ') — '::text) || d.statut) AS evenement,
    d.document,
    ''::text AS document_origine,
    NULL::text AS lieu,
    NULL::numeric AS kg,
    NULL::bigint AS nb_bobines,
    NULL::numeric AS theorique_kg,
    NULL::numeric AS ecart_kg,
    NULL::numeric AS ecart_pct,
    u.login AS utilisateur,
    (d.motif || COALESCE((' / réponse : '::text || d.motif_decision), ''::text)) AS motif
   FROM (public.demande_autorisation d
     LEFT JOIN public.utilisateur u ON ((u.id_utilisateur = d.id_demandeur)))
  WHERE (d.lot_fournisseur IS NOT NULL);


ALTER VIEW public.v_lot_vie OWNER TO gestionfil;

--
-- Name: v_machine_consommation; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_machine_consommation AS
 WITH charge AS (
         SELECT f.code_machine,
            f.code_emplacement,
            l.code_reference,
            l.lot_fournisseur,
            sum(
                CASE
                    WHEN (f.type_fiche = 'CHARGE'::text) THEN COALESCE(l.kg_mouvementes, (0)::numeric)
                    ELSE (0)::numeric
                END) AS kg_charge,
            sum(
                CASE
                    WHEN (f.type_fiche = 'DECHARGE'::text) THEN COALESCE(l.kg_mouvementes, (0)::numeric)
                    ELSE (0)::numeric
                END) AS kg_retourne,
            sum(
                CASE
                    WHEN (f.type_fiche = 'CHARGE'::text) THEN COALESCE(l.nb_bobines_mouvementees, (0)::bigint)
                    ELSE (0)::bigint
                END) AS bobines_chargees,
            min(f.date_fiche) AS premier_chargement,
            max(f.date_fiche) AS dernier_mouvement
           FROM (public.machine_fiche f
             JOIN public.machine_fiche_ligne l ON ((l.id_fiche = f.id_fiche)))
          WHERE (f.statut = 'VALIDE'::text)
          GROUP BY f.code_machine, f.code_emplacement, l.code_reference, l.lot_fournisseur
        )
 SELECT c.code_machine,
    m.nom AS machine_nom,
    c.code_emplacement,
    z.libelle AS zone,
    c.code_reference,
    r.designation,
    c.lot_fournisseur,
    round(c.kg_charge, 3) AS kg_charge,
    round(c.kg_retourne, 3) AS kg_retourne,
    c.bobines_chargees,
    c.premier_chargement,
    c.dernier_mouvement,
    COALESCE(e.nb_bobines, (0)::bigint) AS bobines_presentes,
    COALESCE(e.pourcentage, (0)::numeric) AS pourcentage_actuel,
    round(COALESCE(e.kg, (0)::numeric), 3) AS kg_actuel,
    e.date_constat,
    round(((c.kg_charge - c.kg_retourne) - COALESCE(e.kg, (0)::numeric)), 3) AS consommation_kg
   FROM ((((charge c
     JOIN public.machine m ON ((m.code_machine = c.code_machine)))
     JOIN public.machine_emplacement z ON ((z.code_emplacement = c.code_emplacement)))
     JOIN public.reference r ON ((r.code_reference = c.code_reference)))
     LEFT JOIN public.machine_etat e ON (((e.code_emplacement = c.code_emplacement) AND (e.code_reference = c.code_reference) AND (e.lot_fournisseur = c.lot_fournisseur))));


ALTER VIEW public.v_machine_consommation OWNER TO gestionfil;

--
-- Name: v_recette_calculee; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_recette_calculee AS
 SELECT r.id_recette,
    r.code_qualite,
    q.nom AS qualite_nom,
    q.statut AS statut_qualite,
    r.ligne_numero,
    r.code_reference,
    ref.designation,
    r.code_role,
    rb.libelle AS role_libelle,
    r.pourcentage_composition,
    r.couleur,
    r.code_groupe_equiv,
    lq.densite AS densite_role,
    lq.unite_densite,
    ref.densite_kg_ml,
    round(
        CASE lq.unite_densite
            WHEN 'kg_m2'::text THEN ((lq.densite * r.pourcentage_composition) / 100.0)
            WHEN 'ml_m2'::text THEN (((lq.densite * r.pourcentage_composition) / 100.0) * ref.densite_kg_ml)
            ELSE NULL::numeric
        END, 6) AS kg_m2
   FROM ((((public.recette r
     JOIN public.qualite q ON ((q.code_qualite = r.code_qualite)))
     JOIN public.ligne_qualite lq ON (((lq.code_qualite = r.code_qualite) AND (lq.code_role = r.code_role) AND (lq.actif = 1))))
     JOIN public.role_bom rb ON ((rb.code_role = r.code_role)))
     JOIN public.reference ref ON ((ref.code_reference = r.code_reference)))
  WHERE (r.actif = 1);


ALTER VIEW public.v_recette_calculee OWNER TO gestionfil;

--
-- Name: v_risque_mensuel; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_risque_mensuel AS
 WITH horizon AS (
         SELECT bm.code_reference,
            bm.annee_mois,
            bm.rang_mois,
            round(sum(bm.quantite_kg), 4) AS besoin_kg
           FROM (public.besoin_mrp bm
             JOIN public.plan_production pp ON ((pp.id_plan = bm.id_plan)))
          WHERE ((pp.statut = 'EN_COURS'::text) AND ((to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) >= pp.date_debut) AND (to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM-DD'::text) <= pp.date_fin)) AND (bm.annee_mois >= to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text)))
          GROUP BY bm.code_reference, bm.rang_mois, bm.annee_mois
        ), premier_mois AS (
         SELECT horizon.code_reference,
            min(horizon.annee_mois) AS annee_mois
           FROM horizon
          GROUP BY horizon.code_reference
        ), attendu_brut AS (
         SELECT lb.code_reference,
            substr(COALESCE(lb.date_livraison_prevue, bc.date_livraison_prevue), 1, 7) AS annee_mois,
            lb.quantite_restante_kg AS entrees_kg
           FROM (public.ligne_bc lb
             JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
          WHERE ((bc.statut = ANY (ARRAY['VALIDE'::text, 'ENVOYE'::text, 'LIVRE_PARTIEL'::text])) AND (lb.statut <> ALL (ARRAY['SOLDE'::text, 'ANNULE'::text])) AND (lb.quantite_restante_kg > (0)::numeric))
        ), attendu AS (
         SELECT ab.code_reference,
                CASE
                    WHEN ((ab.annee_mois IS NULL) OR (ab.annee_mois < pm.annee_mois)) THEN pm.annee_mois
                    ELSE ab.annee_mois
                END AS annee_mois,
            round(sum(ab.entrees_kg), 4) AS entrees_kg
           FROM (attendu_brut ab
             JOIN premier_mois pm ON ((pm.code_reference = ab.code_reference)))
          GROUP BY ab.code_reference,
                CASE
                    WHEN ((ab.annee_mois IS NULL) OR (ab.annee_mois < pm.annee_mois)) THEN pm.annee_mois
                    ELSE ab.annee_mois
                END
        ), projection AS (
         SELECT h.code_reference,
            h.annee_mois,
            h.rang_mois,
            h.besoin_kg,
            COALESCE(a.entrees_kg, (0)::numeric) AS entrees_kg,
            round(COALESCE(sd.stock_mrp_kg, (0)::numeric), 4) AS stock_initial_kg,
            round((COALESCE(sd.stock_mrp_kg, (0)::numeric) + sum((COALESCE(a.entrees_kg, (0)::numeric) - h.besoin_kg)) OVER (PARTITION BY h.code_reference ORDER BY h.rang_mois ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)), 4) AS stock_fin_kg,
            round(COALESCE(smd.stock_min_kg, (0)::numeric), 4) AS stock_min_kg
           FROM (((horizon h
             LEFT JOIN attendu a ON (((a.code_reference = h.code_reference) AND (a.annee_mois = h.annee_mois))))
             LEFT JOIN public.v_stock_disponible sd ON ((sd.code_reference = h.code_reference)))
             LEFT JOIN public.v_stock_min_dynamique smd ON ((smd.code_reference = h.code_reference)))
        )
 SELECT p.code_reference,
    r.designation,
    r.classe_abc,
    p.annee_mois,
    p.rang_mois,
    p.besoin_kg,
    p.entrees_kg,
    p.stock_initial_kg,
    p.stock_fin_kg,
    p.stock_min_kg,
        CASE
            WHEN (p.stock_fin_kg < (0)::numeric) THEN 'RUPTURE'::text
            WHEN (p.stock_fin_kg < p.stock_min_kg) THEN 'TENDU'::text
            ELSE 'COUVERT'::text
        END AS statut
   FROM (projection p
     JOIN public.reference r ON ((r.code_reference = p.code_reference)));


ALTER VIEW public.v_risque_mensuel OWNER TO gestionfil;

--
-- Name: v_risque_reference; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_risque_reference AS
 SELECT rm.code_reference,
    rm.designation,
    rm.classe_abc,
    ref.code_fournisseur,
    f.nom AS fournisseur_nom,
    COALESCE(f.delai_livraison_jours, ( SELECT (parametre.valeur_courante)::bigint AS valeur_courante
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_DelaiDefaut'::text))) AS delai_livraison_jours,
        CASE
            WHEN (( SELECT count(*) AS count
               FROM (((public.reference_groupe_equiv rge1
                 JOIN public.reference_groupe_equiv rge2 ON (((rge2.code_groupe_equiv = rge1.code_groupe_equiv) AND (rge2.code_reference <> rge1.code_reference) AND (rge2.actif = 1))))
                 JOIN public.reference r2 ON (((r2.code_reference = rge2.code_reference) AND (r2.actif = 1))))
                 JOIN public.reference r1 ON ((r1.code_reference = rge1.code_reference)))
              WHERE ((rge1.code_reference = rm.code_reference) AND (rge1.actif = 1) AND (r2.code_fournisseur IS DISTINCT FROM r1.code_fournisseur))) > 0) THEN 'MULTI-SOURCE'::text
            ELSE 'MONO-SOURCE'::text
        END AS risque_sourcing,
    min(rm.stock_min_kg) AS stock_min_kg,
    min(rm.stock_initial_kg) AS stock_initial_kg,
    sum(
        CASE
            WHEN (rm.statut = 'RUPTURE'::text) THEN 1
            ELSE 0
        END) AS nb_mois_rupture,
    sum(
        CASE
            WHEN (rm.statut = 'TENDU'::text) THEN 1
            ELSE 0
        END) AS nb_mois_tendu,
    min(
        CASE
            WHEN (rm.statut = 'RUPTURE'::text) THEN rm.annee_mois
            ELSE NULL::text
        END) AS premier_mois_rupture,
    min(
        CASE
            WHEN (rm.statut <> 'COUVERT'::text) THEN rm.annee_mois
            ELSE NULL::text
        END) AS premier_mois_risque,
    min(
        CASE
            WHEN (rm.statut <> 'COUVERT'::text) THEN rm.rang_mois
            ELSE NULL::bigint
        END) AS rang_premier_risque,
    ((((min(
        CASE
            WHEN (rm.statut <> 'COUVERT'::text) THEN rm.annee_mois
            ELSE NULL::text
        END) || '-01'::text))::date - CURRENT_DATE) - COALESCE(f.delai_livraison_jours, ( SELECT (parametre.valeur_courante)::bigint AS valeur_courante
           FROM public.parametre
          WHERE (parametre.code_parametre = 'P_DelaiDefaut'::text)))) AS marge_decision_jours,
    ( SELECT round(COALESCE(max(e.equivalent_stock_kg), (0)::numeric), 3) AS round
           FROM public.v_equivalence e
          WHERE ((e.code_reference = rm.code_reference) AND (e.interchangeable = 1))) AS equivalent_dispo_kg,
    ( SELECT e.equivalent_reference
           FROM public.v_equivalence e
          WHERE ((e.code_reference = rm.code_reference) AND (e.interchangeable = 1))
          ORDER BY e.equivalent_stock_kg DESC
         LIMIT 1) AS equivalent_reference
   FROM ((public.v_risque_mensuel rm
     JOIN public.reference ref ON ((ref.code_reference = rm.code_reference)))
     LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = ref.code_fournisseur)))
  GROUP BY rm.code_reference, rm.designation, rm.classe_abc, ref.code_fournisseur, f.nom, f.delai_livraison_jours
 HAVING ((sum(
        CASE
            WHEN (rm.statut = 'RUPTURE'::text) THEN 1
            ELSE 0
        END) > 0) OR (sum(
        CASE
            WHEN (rm.statut = 'TENDU'::text) THEN 1
            ELSE 0
        END) > 0));


ALTER VIEW public.v_risque_reference OWNER TO gestionfil;

--
-- Name: v_risque_sourcing; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_risque_sourcing AS
 WITH alternatives AS (
         SELECT a_1.code_reference,
            count(DISTINCT sp_1.code_fournisseur) AS nb_sources
           FROM ((public.reference_groupe_equiv a_1
             JOIN public.reference_groupe_equiv b ON (((b.code_groupe_equiv = a_1.code_groupe_equiv) AND (b.actif = 1))))
             JOIN public.v_stock_projete sp_1 ON ((sp_1.code_reference = b.code_reference)))
          WHERE (a_1.actif = 1)
          GROUP BY a_1.code_reference
        )
 SELECT sp.code_reference,
    sp.designation,
    sp.fournisseur_nom,
    r.classe_abc,
    r.classe_xyz,
    sp.statut,
    round(sp.jours_couverture, 1) AS jours_couverture,
    sp.delai_livraison_jours,
    round(((COALESCE(sp.conso_mensuelle_kg, (0)::numeric) * (12)::numeric) * COALESCE(sp.cmup_mad, (0)::numeric)), 2) AS budget_annuel_mad,
    COALESCE(a.nb_sources, (1)::bigint) AS nb_sources,
        CASE
            WHEN (COALESCE(a.nb_sources, (1)::bigint) <= 1) THEN 'MONO_SOURCE'::text
            ELSE 'MULTI_SOURCE'::text
        END AS risque_source,
        CASE
            WHEN (((COALESCE(sp.conso_mensuelle_kg, (0)::numeric) * (12)::numeric) * COALESCE(sp.cmup_mad, (0)::numeric)) >= ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
               FROM public.parametre
              WHERE (parametre.code_parametre = 'P_SeuilTier1'::text))) THEN 'TIER_1'::text
            WHEN (((COALESCE(sp.conso_mensuelle_kg, (0)::numeric) * (12)::numeric) * COALESCE(sp.cmup_mad, (0)::numeric)) >= ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
               FROM public.parametre
              WHERE (parametre.code_parametre = 'P_SeuilTier2'::text))) THEN 'TIER_2'::text
            WHEN (((COALESCE(sp.conso_mensuelle_kg, (0)::numeric) * (12)::numeric) * COALESCE(sp.cmup_mad, (0)::numeric)) >= ( SELECT (parametre.valeur_courante)::numeric AS valeur_courante
               FROM public.parametre
              WHERE (parametre.code_parametre = 'P_SeuilTier3'::text))) THEN 'TIER_3'::text
            ELSE 'TIER_4'::text
        END AS tier,
        CASE
            WHEN ((sp.statut = ANY (ARRAY['RUPTURE'::text, 'CRITIQUE'::text])) AND (COALESCE(a.nb_sources, (1)::bigint) <= 1)) THEN 'Commander et qualifier une seconde source'::text
            WHEN (sp.statut = ANY (ARRAY['RUPTURE'::text, 'CRITIQUE'::text])) THEN 'Commander cette semaine'::text
            WHEN ((COALESCE(a.nb_sources, (1)::bigint) <= 1) AND (r.classe_abc = 'A'::text)) THEN 'Qualifier une seconde source sous 30 jours'::text
            WHEN (sp.statut = 'ATTENTION'::text) THEN 'Surveiller, commander au prochain point'::text
            ELSE 'Aucune action'::text
        END AS action_recommandee
   FROM ((public.v_stock_projete sp
     JOIN public.reference r ON ((r.code_reference = sp.code_reference)))
     LEFT JOIN alternatives a ON ((a.code_reference = sp.code_reference)))
  WHERE (r.actif = 1);


ALTER VIEW public.v_risque_sourcing OWNER TO gestionfil;

--
-- Name: v_stat_autorisations; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_autorisations AS
 SELECT type_demande,
    niveau,
    count(*) AS total,
    count(*) FILTER (WHERE (statut = 'EN_ATTENTE'::text)) AS en_attente,
    count(*) FILTER (WHERE (statut = 'ACCORDEE'::text)) AS accordees,
    count(*) FILTER (WHERE (statut = 'REFUSEE'::text)) AS refusees,
    round(avg((EXTRACT(epoch FROM ((date_decision)::timestamp with time zone - (date_demande)::timestamp with time zone)) / 3600.0)) FILTER (WHERE (date_decision IS NOT NULL)), 1) AS delai_moyen_h,
    round(((100.0 * (count(*) FILTER (WHERE (statut = 'REFUSEE'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (statut = ANY (ARRAY['ACCORDEE'::text, 'REFUSEE'::text]))), 0))::numeric), 1) AS taux_refus_pct
   FROM public.demande_autorisation
  GROUP BY type_demande, niveau;


ALTER VIEW public.v_stat_autorisations OWNER TO gestionfil;

--
-- Name: v_stat_categorie; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_categorie AS
 SELECT COALESCE(r.code_categorie, '(sans categorie)'::text) AS code_categorie,
    COALESCE(c.libelle, 'Sans categorie'::text) AS categorie_libelle,
    count(DISTINCT r.code_reference) AS nb_references,
    count(DISTINCT r.code_famille) AS nb_familles,
    round(COALESCE(sum(s.quantite_kg), (0)::numeric), 2) AS stock_kg,
    round(COALESCE(sum(s.valeur_mad), (0)::numeric), 2) AS valeur_dhs
   FROM ((public.reference r
     LEFT JOIN public.categorie_matiere c ON ((c.code_categorie = r.code_categorie)))
     LEFT JOIN public.stock_magasin s ON ((s.code_reference = r.code_reference)))
  WHERE (r.actif = 1)
  GROUP BY COALESCE(r.code_categorie, '(sans categorie)'::text), COALESCE(c.libelle, 'Sans categorie'::text);


ALTER VIEW public.v_stat_categorie OWNER TO gestionfil;

--
-- Name: v_stat_divergence_bobine; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_divergence_bobine AS
 SELECT lm.code_reference,
    r.designation,
    lm.lot_fournisseur,
    COALESCE(lo.code_fournisseur, r.code_fournisseur) AS code_fournisseur,
    f.nom AS fournisseur_nom,
    m.code_type_mvt,
    tm.libelle AS type_libelle,
    substr(m.date_mouvement, 1, 7) AS mois,
    lm.nb_bobines,
    lm.quantite_kg,
    lm.poids_unitaire_theorique_kg AS poids_catalogue_kg,
    lm.poids_reel_moyen_bobine_kg AS poids_reel_kg,
    lm.ecart_theorique_pct AS ecart_pct
   FROM (((((public.ligne_mouvement lm
     JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
     JOIN public.type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
     JOIN public.reference r ON ((r.code_reference = lm.code_reference)))
     LEFT JOIN public.lot lo ON (((lo.code_reference = lm.code_reference) AND (lo.lot_fournisseur = lm.lot_fournisseur))))
     LEFT JOIN public.fournisseur f ON ((f.code_fournisseur = COALESCE(lo.code_fournisseur, r.code_fournisseur))))
  WHERE ((lm.ecart_theorique_pct IS NOT NULL) AND (m.code_type_mvt = 'ENTREE_REC'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.mouvement c
          WHERE (c.id_mouvement_contrepasse = m.id_mouvement)))));


ALTER VIEW public.v_stat_divergence_bobine OWNER TO gestionfil;

--
-- Name: v_stat_derive_fournisseur; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_derive_fournisseur AS
 WITH p AS (
         SELECT max(
                CASE
                    WHEN (parametre.code_parametre = 'P_LotTolOrangePct'::text) THEN (parametre.valeur_courante)::numeric
                    ELSE NULL::numeric
                END) AS orange,
            max(
                CASE
                    WHEN (parametre.code_parametre = 'P_LotTolRougePct'::text) THEN (parametre.valeur_courante)::numeric
                    ELSE NULL::numeric
                END) AS rouge
           FROM public.parametre
        ), par_lot AS (
         SELECT d.code_fournisseur,
            d.fournisseur_nom,
            d.code_reference,
            d.lot_fournisseur,
            sum((d.quantite_kg - ((d.nb_bobines)::numeric * d.poids_catalogue_kg))) AS ecart_kg,
            ((sum((d.quantite_kg - ((d.nb_bobines)::numeric * d.poids_catalogue_kg))) / NULLIF(sum(((d.nb_bobines)::numeric * d.poids_catalogue_kg)), (0)::numeric)) * (100)::numeric) AS ecart_pct
           FROM public.v_stat_divergence_bobine d
          GROUP BY d.code_fournisseur, d.fournisseur_nom, d.code_reference, d.lot_fournisseur
        )
 SELECT l.code_fournisseur,
    l.fournisseur_nom,
    count(*) AS nb_lots,
    count(*) FILTER (WHERE ((abs(l.ecart_pct) > COALESCE(p.orange, (1)::numeric)) AND (abs(l.ecart_pct) <= COALESCE(p.rouge, (3)::numeric)))) AS lots_orange,
    count(*) FILTER (WHERE (abs(l.ecart_pct) > COALESCE(p.rouge, (3)::numeric))) AS lots_rouges,
    round(sum(l.ecart_kg), 2) AS ecart_cumule_kg,
    round(avg(l.ecart_pct), 2) AS ecart_moyen_pct
   FROM (par_lot l
     CROSS JOIN p)
  WHERE (l.ecart_pct IS NOT NULL)
  GROUP BY l.code_fournisseur, l.fournisseur_nom;


ALTER VIEW public.v_stat_derive_fournisseur OWNER TO gestionfil;

--
-- Name: v_stat_divergence_article; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_divergence_article AS
 SELECT code_reference,
    designation,
    fournisseur_nom,
    count(*) AS nb_lignes,
    sum(nb_bobines) AS bobines,
    round(avg(poids_catalogue_kg), 3) AS poids_catalogue_kg,
    round((sum(quantite_kg) / NULLIF(sum(nb_bobines), (0)::numeric)), 3) AS poids_reel_moyen_kg,
    round(((sum((quantite_kg - ((nb_bobines)::numeric * poids_catalogue_kg))) / NULLIF(sum(((nb_bobines)::numeric * poids_catalogue_kg)), (0)::numeric)) * (100)::numeric), 2) AS ecart_moyen_pct,
    round(sum((quantite_kg - ((nb_bobines)::numeric * poids_catalogue_kg))), 2) AS ecart_kg
   FROM public.v_stat_divergence_bobine
  GROUP BY code_reference, designation, fournisseur_nom;


ALTER VIEW public.v_stat_divergence_article OWNER TO gestionfil;

--
-- Name: v_stat_divergence_fournisseur; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_divergence_fournisseur AS
 SELECT code_fournisseur,
    fournisseur_nom,
    count(*) AS nb_lignes,
    sum(nb_bobines) AS bobines,
    round(((sum((quantite_kg - ((nb_bobines)::numeric * poids_catalogue_kg))) / NULLIF(sum(((nb_bobines)::numeric * poids_catalogue_kg)), (0)::numeric)) * (100)::numeric), 2) AS ecart_moyen_pct,
    round(min(ecart_pct), 2) AS ecart_min_pct,
    round(max(ecart_pct), 2) AS ecart_max_pct,
    round(sum((quantite_kg - ((nb_bobines)::numeric * poids_catalogue_kg))), 2) AS ecart_kg
   FROM public.v_stat_divergence_bobine
  GROUP BY code_fournisseur, fournisseur_nom;


ALTER VIEW public.v_stat_divergence_fournisseur OWNER TO gestionfil;

--
-- Name: v_stat_divergence_mois; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_divergence_mois AS
 SELECT mois,
    count(*) AS nb_lignes,
    round(((sum((quantite_kg - ((nb_bobines)::numeric * poids_catalogue_kg))) / NULLIF(sum(((nb_bobines)::numeric * poids_catalogue_kg)), (0)::numeric)) * (100)::numeric), 2) AS ecart_moyen_pct,
    round(sum((quantite_kg - ((nb_bobines)::numeric * poids_catalogue_kg))), 2) AS ecart_kg
   FROM public.v_stat_divergence_bobine
  GROUP BY mois;


ALTER VIEW public.v_stat_divergence_mois OWNER TO gestionfil;

--
-- Name: v_stat_famille; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_famille AS
 WITH refs AS (
         SELECT r.code_reference,
            COALESCE(r.code_famille, '(sans famille)'::text) AS code_famille,
            COALESCE(f.libelle, 'Sans famille'::text) AS famille_libelle,
            COALESCE(r.code_categorie, '(sans categorie)'::text) AS code_categorie,
            COALESCE(c.libelle, 'Sans categorie'::text) AS categorie_libelle
           FROM ((public.reference r
             LEFT JOIN public.famille f ON ((f.code_famille = r.code_famille)))
             LEFT JOIN public.categorie_matiere c ON ((c.code_categorie = r.code_categorie)))
          WHERE (r.actif = 1)
        ), stock AS (
         SELECT re_1.code_famille,
            sum(s.quantite_kg) AS stock_kg,
            sum(s.valeur_mad) AS valeur_dhs,
            count(DISTINCT s.code_reference) FILTER (WHERE (s.quantite_kg > (0)::numeric)) AS refs_en_stock
           FROM (public.stock_magasin s
             JOIN refs re_1 ON ((re_1.code_reference = s.code_reference)))
          GROUP BY re_1.code_famille
        ), flux AS (
         SELECT re_1.code_famille,
            "left"(m.date_mouvement, 4) AS annee,
            sum(l.quantite_kg) FILTER (WHERE (t.signe = 1)) AS entrees_kg,
            sum(l.quantite_kg) FILTER (WHERE (t.signe = '-1'::integer)) AS sorties_kg,
            sum(l.total_mad) FILTER (WHERE (t.signe = 1)) AS entrees_dhs
           FROM (((public.ligne_mouvement l
             JOIN public.mouvement m ON ((m.id_mouvement = l.id_mouvement)))
             JOIN public.type_mouvement t ON ((t.code_type_mvt = m.code_type_mvt)))
             JOIN refs re_1 ON ((re_1.code_reference = l.code_reference)))
          WHERE (m.code_type_mvt <> ALL (ARRAY['STOCK_INIT'::text, 'TRANSFERT_ENTREE'::text, 'TRANSFERT_SORTIE'::text]))
          GROUP BY re_1.code_famille, ("left"(m.date_mouvement, 4))
        )
 SELECT re.code_famille,
    max(re.famille_libelle) AS famille_libelle,
        CASE
            WHEN (count(DISTINCT re.code_categorie) > 1) THEN NULL::text
            ELSE max(re.code_categorie)
        END AS code_categorie,
        CASE
            WHEN (count(DISTINCT re.code_categorie) > 1) THEN 'Plusieurs categories'::text
            ELSE max(re.categorie_libelle)
        END AS categorie_libelle,
    count(*) AS nb_references,
    COALESCE(max(st.refs_en_stock), (0)::bigint) AS refs_en_stock,
    round(COALESCE(max(st.stock_kg), (0)::numeric), 2) AS stock_kg,
    round(COALESCE(max(st.valeur_dhs), (0)::numeric), 2) AS valeur_dhs,
    fl.annee,
    round(COALESCE(fl.entrees_kg, (0)::numeric), 2) AS entrees_kg,
    round(COALESCE(fl.sorties_kg, (0)::numeric), 2) AS sorties_kg,
    round(COALESCE(fl.entrees_dhs, (0)::numeric), 2) AS entrees_dhs,
        CASE
            WHEN (COALESCE(fl.entrees_kg, (0)::numeric) > (0)::numeric) THEN round((fl.entrees_dhs / fl.entrees_kg), 2)
            ELSE NULL::numeric
        END AS prix_moyen_entree_mad
   FROM ((refs re
     LEFT JOIN stock st ON ((st.code_famille = re.code_famille)))
     LEFT JOIN flux fl ON ((fl.code_famille = re.code_famille)))
  GROUP BY re.code_famille, fl.annee, fl.entrees_kg, fl.sorties_kg, fl.entrees_dhs;


ALTER VIEW public.v_stat_famille OWNER TO gestionfil;

--
-- Name: v_stat_famille_couleur; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_famille_couleur AS
 SELECT COALESCE(r.code_famille, '(sans famille)'::text) AS code_famille,
    COALESCE(f.libelle, 'Sans famille'::text) AS famille_libelle,
    COALESCE(r.code_couleur_interne, '(non classee)'::text) AS code_couleur,
    COALESCE(cl.libelle, NULLIF(r.origine, ''::text), NULLIF(r.couleur, ''::text), 'Non classee'::text) AS couleur_libelle,
    "left"(m.date_mouvement, 4) AS annee,
    round(sum(l.quantite_kg), 2) AS entrees_kg,
    count(DISTINCT m.id_mouvement) AS nb_entrees,
    count(DISTINCT r.code_reference) AS nb_references
   FROM (((((public.ligne_mouvement l
     JOIN public.mouvement m ON ((m.id_mouvement = l.id_mouvement)))
     JOIN public.type_mouvement t ON (((t.code_type_mvt = m.code_type_mvt) AND (t.signe = 1))))
     JOIN public.reference r ON ((r.code_reference = l.code_reference)))
     LEFT JOIN public.famille f ON ((f.code_famille = r.code_famille)))
     LEFT JOIN public.couleur cl ON ((cl.code_couleur_interne = r.code_couleur_interne)))
  GROUP BY COALESCE(r.code_famille, '(sans famille)'::text), COALESCE(f.libelle, 'Sans famille'::text), COALESCE(r.code_couleur_interne, '(non classee)'::text), COALESCE(cl.libelle, NULLIF(r.origine, ''::text), NULLIF(r.couleur, ''::text), 'Non classee'::text), ("left"(m.date_mouvement, 4));


ALTER VIEW public.v_stat_famille_couleur OWNER TO gestionfil;

--
-- Name: v_stat_fournisseur_mois; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_fournisseur_mois AS
 SELECT rc.code_fournisseur,
    f.nom AS fournisseur_nom,
    substr(rc.date_reception, 1, 7) AS annee_mois,
    count(DISTINCT rc.id_reception) AS nb_receptions,
    count(lr.id_ligne_reception) AS nb_lignes,
    round(sum(lr.quantite_stock_kg), 3) AS quantite_kg,
    round(sum((lr.quantite_stock_kg * lr.prix_kg_mad)), 2) AS montant_mad,
    round(((100.0 * (sum(
        CASE
            WHEN (lr.statut_qualite = 'CONFORME'::text) THEN 1
            ELSE 0
        END))::numeric) / (count(lr.id_ligne_reception))::numeric), 1) AS taux_conformite_pct,
    sum(
        CASE
            WHEN ((bc.date_livraison_prevue IS NOT NULL) AND (substr(rc.date_reception, 1, 10) <= substr(bc.date_livraison_prevue, 1, 10))) THEN 1
            ELSE 0
        END) AS nb_a_lheure,
    sum(
        CASE
            WHEN (bc.date_livraison_prevue IS NOT NULL) THEN 1
            ELSE 0
        END) AS nb_mesurables,
    round(avg(
        CASE
            WHEN (bc.date_livraison_prevue IS NOT NULL) THEN ((rc.date_reception)::date - (bc.date_livraison_prevue)::date)
            ELSE NULL::integer
        END), 1) AS retard_moyen_jours
   FROM ((((public.reception rc
     JOIN public.fournisseur f ON ((f.code_fournisseur = rc.code_fournisseur)))
     JOIN public.ligne_reception lr ON ((lr.id_reception = rc.id_reception)))
     LEFT JOIN public.ligne_bc lb ON ((lb.id_ligne_bc = lr.id_ligne_bc)))
     LEFT JOIN public.bon_commande bc ON ((bc.id_bc = lb.id_bc)))
  WHERE (rc.statut = ANY (ARRAY['VALIDE'::text, 'CLOTURE'::text]))
  GROUP BY rc.code_fournisseur, f.nom, (substr(rc.date_reception, 1, 7));


ALTER VIEW public.v_stat_fournisseur_mois OWNER TO gestionfil;

--
-- Name: v_stat_lot_age; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_lot_age AS
 SELECT
        CASE
            WHEN (jours < 90) THEN '0-90 j'::text
            WHEN (jours < 180) THEN '90-180 j'::text
            WHEN (jours < 365) THEN '180-365 j'::text
            ELSE 'plus d''un an'::text
        END AS tranche,
        CASE
            WHEN (jours < 90) THEN 1
            WHEN (jours < 180) THEN 2
            WHEN (jours < 365) THEN 3
            ELSE 4
        END AS ordre,
    categorie,
    count(*) AS nb_lots,
    round(sum(solde_kg), 2) AS kg,
    round(sum(valeur_mad), 2) AS valeur_mad
   FROM ( SELECT l.code_reference,
            l.designation,
            l.code_categorie,
            l.lot_fournisseur,
            l.origine,
            l.code_fournisseur,
            l.fournisseur_nom,
            l.statut,
            l.categorie,
            l.type_lot,
            l.fusion_autorisee,
            l.fusionne_dans,
            l.date_creation,
            l.date_derniere_activite,
            l.solde_kg,
            l.solde_bobines,
            l.seuil_valeur,
            l.seuil_unite,
            l.seuil_bobines,
            l.seuil_restes_kg,
            l.jours_sans_activite,
            l.dormant,
            l.a_basculer,
            l.ecart_cumule_kg,
            l.ecart_cumule_pct,
            l.poids_reel_moyen_bobine_kg,
            l.poids_catalogue_bobine_kg,
            l.alerte_derive,
            l.valeur_mad,
            (CURRENT_DATE - (substr(l.date_creation, 1, 10))::date) AS jours
           FROM public.v_lot l
          WHERE (l.solde_kg > (0)::numeric)) a
  GROUP BY
        CASE
            WHEN (jours < 90) THEN '0-90 j'::text
            WHEN (jours < 180) THEN '90-180 j'::text
            WHEN (jours < 365) THEN '180-365 j'::text
            ELSE 'plus d''un an'::text
        END,
        CASE
            WHEN (jours < 90) THEN 1
            WHEN (jours < 180) THEN 2
            WHEN (jours < 365) THEN 3
            ELSE 4
        END, categorie;


ALTER VIEW public.v_stat_lot_age OWNER TO gestionfil;

--
-- Name: v_stat_lot_categorie; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_lot_categorie AS
 SELECT code_reference,
    designation,
    code_categorie,
    count(*) FILTER (WHERE (solde_kg > (0)::numeric)) AS nb_lots,
    round(sum(solde_kg) FILTER (WHERE ((categorie = 'PROJET'::text) AND (statut = 'LIBRE'::text) AND (NOT dormant))), 2) AS projet_kg,
    round(sum(solde_kg) FILTER (WHERE ((categorie = 'RESTES'::text) AND (statut = 'LIBRE'::text) AND (NOT dormant))), 2) AS restes_kg,
    round(sum(solde_kg) FILTER (WHERE (statut = 'BLOQUE'::text)), 2) AS bloque_kg,
    round(sum(solde_kg) FILTER (WHERE (dormant AND (statut <> 'BLOQUE'::text))), 2) AS dormant_kg,
    round(sum(solde_kg), 2) AS total_kg,
    round(sum(valeur_mad) FILTER (WHERE ((categorie = 'PROJET'::text) AND (statut = 'LIBRE'::text) AND (NOT dormant))), 2) AS projet_mad,
    round(sum(valeur_mad) FILTER (WHERE ((categorie = 'RESTES'::text) AND (statut = 'LIBRE'::text) AND (NOT dormant))), 2) AS restes_mad,
    round(sum(valeur_mad), 2) AS total_mad,
    count(*) FILTER (WHERE a_basculer) AS nb_a_basculer
   FROM public.v_lot l
  WHERE (solde_kg > (0)::numeric)
  GROUP BY code_reference, designation, code_categorie;


ALTER VIEW public.v_stat_lot_categorie OWNER TO gestionfil;

--
-- Name: v_stat_mouvement_mois; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_mouvement_mois AS
 SELECT substr(m.date_mouvement, 1, 7) AS annee_mois,
    m.code_type_mvt,
    tm.libelle AS type_libelle,
    tm.signe,
    tm.couleur,
    count(DISTINCT m.id_mouvement) AS nb_mouvements,
    count(*) AS nb_lignes,
    count(DISTINCT lm.code_reference) AS nb_references,
    round(sum(lm.quantite_kg), 3) AS quantite_kg,
    round(sum(COALESCE(lm.total_mad, (0)::numeric)), 2) AS valeur_mad
   FROM ((public.ligne_mouvement lm
     JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
     JOIN public.type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
  GROUP BY (substr(m.date_mouvement, 1, 7)), m.code_type_mvt, tm.libelle, tm.signe, tm.couleur;


ALTER VIEW public.v_stat_mouvement_mois OWNER TO gestionfil;

--
-- Name: v_stat_mouvement_reference; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_mouvement_reference AS
 WITH flux AS (
         SELECT lm.code_reference,
            sum(
                CASE
                    WHEN (tm.signe = 1) THEN lm.quantite_kg
                    ELSE (0)::numeric
                END) AS entrees_kg,
            sum(
                CASE
                    WHEN (tm.signe = '-1'::integer) THEN lm.quantite_kg
                    ELSE (0)::numeric
                END) AS sorties_kg,
            sum(
                CASE
                    WHEN (tm.signe = 1) THEN COALESCE(lm.total_mad, (0)::numeric)
                    ELSE (0)::numeric
                END) AS entrees_mad,
            count(*) AS nb_lignes,
            min(m.date_mouvement) AS premier_mouvement,
            max(m.date_mouvement) AS dernier_mouvement,
            count(DISTINCT substr(m.date_mouvement, 1, 7)) AS nb_mois_actifs
           FROM ((public.ligne_mouvement lm
             JOIN public.mouvement m ON ((m.id_mouvement = lm.id_mouvement)))
             JOIN public.type_mouvement tm ON ((tm.code_type_mvt = m.code_type_mvt)))
          GROUP BY lm.code_reference
        )
 SELECT r.code_reference,
    r.designation,
    r.classe_abc,
    round(COALESCE(fx.entrees_kg, (0)::numeric), 3) AS entrees_kg,
    round(COALESCE(fx.sorties_kg, (0)::numeric), 3) AS sorties_kg,
    round((COALESCE(fx.entrees_kg, (0)::numeric) - COALESCE(fx.sorties_kg, (0)::numeric)), 3) AS solde_kg,
    round(COALESCE(fx.entrees_mad, (0)::numeric), 2) AS entrees_mad,
    COALESCE(fx.nb_lignes, (0)::bigint) AS nb_lignes,
    COALESCE(fx.nb_mois_actifs, (0)::bigint) AS nb_mois_actifs,
    fx.premier_mouvement,
    fx.dernier_mouvement,
    round(COALESCE(sd.stock_total_kg, (0)::numeric), 3) AS stock_actuel_kg,
        CASE
            WHEN ((COALESCE(sd.stock_total_kg, (0)::numeric) > (0)::numeric) AND (COALESCE(fx.sorties_kg, (0)::numeric) > (0)::numeric)) THEN round((fx.sorties_kg / sd.stock_total_kg), 2)
            ELSE NULL::numeric
        END AS rotation,
        CASE
            WHEN (fx.dernier_mouvement IS NULL) THEN NULL::bigint
            ELSE ((CURRENT_DATE - (fx.dernier_mouvement)::date))::bigint
        END AS jours_sans_mouvement
   FROM ((public.reference r
     LEFT JOIN flux fx ON ((fx.code_reference = r.code_reference)))
     LEFT JOIN public.v_stock_disponible sd ON ((sd.code_reference = r.code_reference)))
  WHERE (r.actif = 1);


ALTER VIEW public.v_stat_mouvement_reference OWNER TO gestionfil;

--
-- Name: v_stat_prix_mois; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_prix_mois AS
 SELECT hp.code_reference,
    r.designation,
    substr(hp.date_achat, 1, 7) AS annee_mois,
    hp.code_devise,
    count(*) AS nb_achats,
    count(DISTINCT hp.code_fournisseur) AS nb_fournisseurs,
    round(sum(hp.quantite_achetee_kg), 3) AS quantite_kg,
    round(sum(hp.total_mad), 2) AS montant_mad,
    round((sum((hp.prix_kg_devise * hp.quantite_achetee_kg)) / sum(hp.quantite_achetee_kg)), 4) AS prix_moyen_devise,
    round((sum((hp.prix_kg_mad * hp.quantite_achetee_kg)) / sum(hp.quantite_achetee_kg)), 4) AS prix_moyen_mad,
    round((sum((hp.taux_change * hp.quantite_achetee_kg)) / sum(hp.quantite_achetee_kg)), 4) AS taux_moyen,
    min(hp.prix_kg_mad) AS prix_min_mad,
    max(hp.prix_kg_mad) AS prix_max_mad
   FROM (public.historique_prix hp
     JOIN public.reference r ON ((r.code_reference = hp.code_reference)))
  GROUP BY hp.code_reference, r.designation, (substr(hp.date_achat, 1, 7)), hp.code_devise;


ALTER VIEW public.v_stat_prix_mois OWNER TO gestionfil;

--
-- Name: v_stat_prix_reference; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_prix_reference AS
 WITH bornes AS (
         SELECT historique_prix.code_reference,
            min(historique_prix.date_achat) AS premier,
            max(historique_prix.date_achat) AS dernier
           FROM public.historique_prix
          GROUP BY historique_prix.code_reference
        ), premier AS (
         SELECT hp.code_reference,
            hp.prix_kg_devise,
            hp.prix_kg_mad,
            hp.taux_change,
            hp.code_devise,
            hp.date_achat
           FROM (public.historique_prix hp
             JOIN bornes b ON (((b.code_reference = hp.code_reference) AND (b.premier = hp.date_achat))))
          GROUP BY hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad, hp.taux_change, hp.code_devise, hp.date_achat
        ), dernier AS (
         SELECT hp.code_reference,
            hp.prix_kg_devise,
            hp.prix_kg_mad,
            hp.taux_change,
            hp.code_devise,
            hp.date_achat
           FROM (public.historique_prix hp
             JOIN bornes b ON (((b.code_reference = hp.code_reference) AND (b.dernier = hp.date_achat))))
          GROUP BY hp.code_reference, hp.prix_kg_devise, hp.prix_kg_mad, hp.taux_change, hp.code_devise, hp.date_achat
        ), cumul AS (
         SELECT historique_prix.code_reference,
            count(*) AS nb_achats,
            count(DISTINCT historique_prix.code_fournisseur) AS nb_fournisseurs,
            round(sum(historique_prix.quantite_achetee_kg), 3) AS quantite_totale_kg,
            round(sum(historique_prix.total_mad), 2) AS montant_total_mad,
            round((sum((historique_prix.prix_kg_mad * historique_prix.quantite_achetee_kg)) / sum(historique_prix.quantite_achetee_kg)), 4) AS prix_moyen_mad
           FROM public.historique_prix
          GROUP BY historique_prix.code_reference
        )
 SELECT c.code_reference,
    r.designation,
    r.classe_abc,
    d.code_devise,
    c.nb_achats,
    c.nb_fournisseurs,
    c.quantite_totale_kg,
    c.montant_total_mad,
    c.prix_moyen_mad,
    p.date_achat AS premier_achat,
    d.date_achat AS dernier_achat,
    p.prix_kg_mad AS premier_prix_mad,
    d.prix_kg_mad AS dernier_prix_mad,
    p.prix_kg_devise AS premier_prix_devise,
    d.prix_kg_devise AS dernier_prix_devise,
    p.taux_change AS premier_taux,
    d.taux_change AS dernier_taux,
        CASE
            WHEN (p.prix_kg_mad > (0)::numeric) THEN round((((d.prix_kg_mad - p.prix_kg_mad) / p.prix_kg_mad) * 100.0), 2)
            ELSE NULL::numeric
        END AS derive_totale_pct,
        CASE
            WHEN (p.prix_kg_devise > (0)::numeric) THEN round((((d.prix_kg_devise - p.prix_kg_devise) / p.prix_kg_devise) * 100.0), 2)
            ELSE NULL::numeric
        END AS derive_fournisseur_pct,
        CASE
            WHEN (p.taux_change > (0)::numeric) THEN round((((d.taux_change - p.taux_change) / p.taux_change) * 100.0), 2)
            ELSE NULL::numeric
        END AS derive_change_pct,
        CASE
            WHEN (p.prix_kg_devise > (0)::numeric) THEN round((((d.prix_kg_devise - p.prix_kg_devise) * d.taux_change) * c.quantite_totale_kg), 2)
            ELSE NULL::numeric
        END AS impact_fournisseur_mad
   FROM (((cumul c
     JOIN public.reference r ON ((r.code_reference = c.code_reference)))
     JOIN premier p ON ((p.code_reference = c.code_reference)))
     JOIN dernier d ON ((d.code_reference = c.code_reference)));


ALTER VIEW public.v_stat_prix_reference OWNER TO gestionfil;

--
-- Name: v_stat_qualite; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_qualite AS
 WITH cout AS (
         SELECT rc.code_qualite,
            count(*) AS nb_composants,
            count(DISTINCT rc.code_role) AS nb_roles,
            sum(
                CASE
                    WHEN (r.cmup_mad IS NULL) THEN 1
                    ELSE 0
                END) AS nb_sans_cmup,
            round(sum(rc.kg_m2), 6) AS kg_m2_total,
            round(sum((rc.kg_m2 * COALESCE(r.cmup_mad, (0)::numeric))), 4) AS cout_matiere_m2_mad
           FROM (public.v_recette_calculee rc
             JOIN public.reference r ON ((r.code_reference = rc.code_reference)))
          GROUP BY rc.code_qualite
        ), production AS (
         SELECT lpp.code_qualite,
            round(sum(lpp.m2_prevus), 0) AS m2_prevus,
            round(sum(COALESCE(lpp.m2_realises, (0)::numeric)), 0) AS m2_realises,
            count(*) AS nb_mois_planifies
           FROM (public.ligne_plan_production lpp
             JOIN public.plan_production pp ON ((pp.id_plan = lpp.id_plan)))
          WHERE (pp.statut = 'EN_COURS'::text)
          GROUP BY lpp.code_qualite
        )
 SELECT q.code_qualite,
    q.nom AS qualite_nom,
    q.statut,
    q.poids_commercial_m2,
    q.taux_perte_pct,
    COALESCE(c.nb_composants, (0)::bigint) AS nb_composants,
    COALESCE(c.nb_roles, (0)::bigint) AS nb_roles,
    COALESCE(c.nb_sans_cmup, (0)::bigint) AS nb_sans_cmup,
    c.kg_m2_total,
    c.cout_matiere_m2_mad,
        CASE
            WHEN ((q.poids_commercial_m2 > (0)::numeric) AND (c.kg_m2_total IS NOT NULL)) THEN round((((c.kg_m2_total - q.poids_commercial_m2) / q.poids_commercial_m2) * 100.0), 2)
            ELSE NULL::numeric
        END AS ecart_poids_pct,
    COALESCE(p.m2_prevus, (0)::numeric) AS m2_prevus,
    COALESCE(p.m2_realises, (0)::numeric) AS m2_realises,
    COALESCE(p.nb_mois_planifies, (0)::bigint) AS nb_mois_planifies,
        CASE
            WHEN (COALESCE(p.m2_prevus, (0)::numeric) > (0)::numeric) THEN round(((100.0 * COALESCE(p.m2_realises, (0)::numeric)) / p.m2_prevus), 1)
            ELSE NULL::numeric
        END AS taux_realisation_pct,
        CASE
            WHEN ((c.cout_matiere_m2_mad IS NOT NULL) AND (COALESCE(p.m2_prevus, (0)::numeric) > (0)::numeric)) THEN round((c.cout_matiere_m2_mad * p.m2_prevus), 2)
            ELSE NULL::numeric
        END AS cout_matiere_plan_mad
   FROM ((public.qualite q
     LEFT JOIN cout c ON ((c.code_qualite = q.code_qualite)))
     LEFT JOIN production p ON ((p.code_qualite = q.code_qualite)));


ALTER VIEW public.v_stat_qualite OWNER TO gestionfil;

--
-- Name: v_stat_qualite_role; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stat_qualite_role AS
 SELECT rc.code_qualite,
    rc.code_role,
    rc.role_libelle,
    count(*) AS nb_composants,
    round(sum(rc.pourcentage_composition), 2) AS somme_pct,
    round(sum(rc.kg_m2), 6) AS kg_m2,
    round(sum((rc.kg_m2 * COALESCE(r.cmup_mad, (0)::numeric))), 4) AS cout_m2_mad
   FROM (public.v_recette_calculee rc
     JOIN public.reference r ON ((r.code_reference = rc.code_reference)))
  GROUP BY rc.code_qualite, rc.code_role, rc.role_libelle;


ALTER VIEW public.v_stat_qualite_role OWNER TO gestionfil;

--
-- Name: v_stock_machine; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stock_machine AS
 SELECT code_reference,
    round(sum(kg), 4) AS kg_sur_machine,
    (sum(nb_bobines))::bigint AS bobines_sur_machine,
    count(DISTINCT code_emplacement) AS nb_zones
   FROM public.machine_etat e
  GROUP BY code_reference;


ALTER VIEW public.v_stock_machine OWNER TO gestionfil;

--
-- Name: v_stock_transit; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_stock_transit AS
 SELECT t.id_transfert,
    t.numero_transfert,
    t.date_transfert,
    t.code_magasin_source,
    ms.nom AS magasin_source_nom,
    t.code_magasin_dest,
    md.nom AS magasin_dest_nom,
    u.login AS expediteur,
    lt.code_reference,
    r.designation,
    lt.lot_fournisseur,
    round(lt.quantite_kg, 4) AS quantite_kg,
    lt.prix_kg_mad,
    round((lt.quantite_kg * COALESCE(lt.prix_kg_mad, (0)::numeric)), 2) AS valeur_mad,
    ((CURRENT_DATE - (t.date_transfert)::date))::bigint AS jours_en_transit
   FROM (((((public.transfert t
     JOIN public.ligne_transfert lt ON ((lt.id_transfert = t.id_transfert)))
     JOIN public.reference r ON ((r.code_reference = lt.code_reference)))
     LEFT JOIN public.magasin ms ON ((ms.code_magasin = t.code_magasin_source)))
     LEFT JOIN public.magasin md ON ((md.code_magasin = t.code_magasin_dest)))
     LEFT JOIN public.utilisateur u ON ((u.id_utilisateur = t.id_utilisateur)))
  WHERE (t.statut = 'VALIDE'::text);


ALTER VIEW public.v_stock_transit OWNER TO gestionfil;

--
-- Name: v_substitution_dispo; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_substitution_dispo AS
 SELECT r1.code_reference AS ref_principale,
    r1.designation AS designation_principale,
    sp1.statut AS statut_principale,
    sp1.stock_projete_kg AS stock_projete_principale,
    rge1.code_groupe_equiv,
    ge.libelle AS groupe_libelle,
    rge1.priorite AS priorite_principale,
    r2.code_reference AS ref_substitut,
    r2.designation AS designation_substitut,
    r2.code_fournisseur AS fournisseur_substitut,
    rge2.priorite AS priorite_substitut,
    rge2.est_preferentielle,
    ph2.stock_physique_net_kg AS stock_substitut_kg,
    sp2.stock_projete_kg AS stock_projete_substitut
   FROM (((((((public.reference r1
     JOIN public.reference_groupe_equiv rge1 ON (((rge1.code_reference = r1.code_reference) AND (rge1.actif = 1))))
     JOIN public.groupe_equiv ge ON (((ge.code_groupe_equiv = rge1.code_groupe_equiv) AND (ge.actif = 1))))
     JOIN public.reference_groupe_equiv rge2 ON (((rge2.code_groupe_equiv = rge1.code_groupe_equiv) AND (rge2.code_reference <> rge1.code_reference) AND (rge2.actif = 1))))
     JOIN public.reference r2 ON (((r2.code_reference = rge2.code_reference) AND (r2.actif = 1))))
     JOIN public.v_stock_projete sp1 ON ((sp1.code_reference = r1.code_reference)))
     JOIN public.v_stock_projete sp2 ON ((sp2.code_reference = r2.code_reference)))
     JOIN public.v_stock_physique ph2 ON ((ph2.code_reference = r2.code_reference)))
  WHERE ((r1.actif = 1) AND (sp1.statut = ANY (ARRAY['RUPTURE'::text, 'CRITIQUE'::text])) AND (ph2.stock_physique_net_kg > (0)::numeric))
  ORDER BY r1.code_reference, rge2.est_preferentielle DESC, rge2.priorite;


ALTER VIEW public.v_substitution_dispo OWNER TO gestionfil;

--
-- Name: v_supervision; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_supervision AS
 WITH socle AS (
         SELECT ( SELECT count(*) AS count
                   FROM public.reception) AS nb_receptions,
            ( SELECT count(*) AS count
                   FROM public.ligne_reception) AS nb_lignes_rec,
            ( SELECT count(*) AS count
                   FROM public.bon_commande) AS nb_bc,
            ( SELECT count(*) AS count
                   FROM public.machine) AS nb_machines,
            ( SELECT count(*) AS count
                   FROM public.historique_prix) AS nb_prix,
            ( SELECT count(DISTINCT substr(mouvement.date_mouvement, 1, 7)) AS count
                   FROM public.mouvement) AS nb_mois
        ), stock AS (
         SELECT COALESCE(sum(v_etat_stock.valeur_mad), (0)::numeric) AS valeur_mad,
            count(*) AS nb_refs,
            count(*) FILTER (WHERE (v_etat_stock.statut = 'RUPTURE'::text)) AS nb_rupture,
            count(*) FILTER (WHERE (v_etat_stock.statut = 'CRITIQUE'::text)) AS nb_critique,
            count(*) FILTER (WHERE (v_etat_stock.statut = 'ATTENTION'::text)) AS nb_attention,
            count(*) FILTER (WHERE (v_etat_stock.statut = 'OK'::text)) AS nb_ok,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v_etat_stock.jours_couverture)::double precision)) FILTER (WHERE (v_etat_stock.jours_couverture IS NOT NULL)) AS couverture_mediane
           FROM public.v_etat_stock
        ), sourcing AS (
         SELECT count(*) FILTER (WHERE (v_risque_sourcing.nb_sources <= 1)) AS nb_mono_source,
            COALESCE(sum(v_risque_sourcing.budget_annuel_mad) FILTER (WHERE (v_risque_sourcing.nb_sources <= 1)), (0)::numeric) AS budget_mono_mad
           FROM public.v_risque_sourcing
        ), economies AS (
         SELECT COALESCE(sum(v_cockpit_economies.economie_annuelle_mad), (0)::numeric) AS economies_mad,
            count(*) AS nb_opportunites
           FROM public.v_cockpit_economies
        )
 SELECT domaine,
    cle,
    libelle,
    unite,
    definition,
    disponible,
    condition
   FROM ( VALUES ('STOCK'::text,'valeur_stock'::text,'Valeur du stock'::text,'MAD'::text,'Au CMUP, tous magasins confondus.'::text,1,NULL::text), ('STOCK'::text,'couverture_mediane'::text,'Couverture mediane'::text,'jours'::text,'La moitie des references tient plus longtemps, l autre moins.'::text,1,NULL::text), ('STOCK'::text,'taux_rupture'::text,'Taux de rupture'::text,'%'::text,'References sans couverture sur leur delai d approvisionnement.'::text,1,NULL::text), ('STOCK'::text,'taux_disponibilite'::text,'Taux de disponibilite'::text,'%'::text,'References au vert sur le total suivi.'::text,1,NULL::text), ('ACHATS'::text,'mono_source'::text,'References mono-source'::text,'refs'::text,'Une seule source connue : un incident fournisseur arrete la production.'::text,1,NULL::text), ('ACHATS'::text,'budget_mono'::text,'Budget expose au mono-source'::text,'MAD/an'::text,'Ce que pese annuellement ce qui n a qu une source.'::text,1,NULL::text), ('ACHATS'::text,'economies'::text,'Economies identifiees'::text,'MAD/an'::text,'A qualite egale, le meme titrage achete moins cher ailleurs.'::text,1,NULL::text), ('LIVRAISON'::text,'otif'::text,'OTIF fournisseur'::text,'%'::text,'Livraisons a l heure ET completes sur le total.'::text,0,'Aucune reception enregistree. L OTIF se calcule des la premiere reception controlee.'::text), ('LIVRAISON'::text,'on_time'::text,'Ponctualite (On-Time)'::text,'%'::text,'Livraisons arrivees au plus tard a la date promise.'::text,0,'Aucune reception enregistree.'::text), ('LIVRAISON'::text,'in_full'::text,'Completude (In-Full)'::text,'%'::text,'Quantite pesee contre quantite commandee, tolerance de 2 %.'::text,0,'Aucun bon de commande, donc aucune quantite promise a comparer.'::text), ('LIVRAISON'::text,'lead_time'::text,'Delai fournisseur reel'::text,'jours'::text,'Entre la date du bon et la date de reception.'::text,0,'Aucun bon de commande suivi d une reception.'::text), ('PREVISION'::text,'forecast_accuracy'::text,'Precision de prevision'::text,'%'::text,'100 moins l erreur ponderee (WAPE) entre besoin calcule et sortie reelle.'::text,0,'Un seul mois de mouvements. Il en faut au moins trois pour comparer une prevision a un realise.'::text), ('PREVISION'::text,'forecast_bias'::text,'Biais de prevision'::text,'%'::text,'Tendance a sur-estimer ou sous-estimer, en cumul.'::text,0,'Un seul mois de mouvements.'::text), ('STOCK'::text,'rotation'::text,'Rotation du stock'::text,'fois/an'::text,'Consommation annuelle rapportee au stock moyen.'::text,0,'Un seul mois de mouvements. La rotation demande une annee, ou au moins un trimestre.'::text), ('STOCK'::text,'stock_dormant'::text,'Stock dormant'::text,'%'::text,'Valeur sans aucun mouvement depuis soixante jours.'::text,0,'Le stock initial date du mois courant : rien ne peut encore etre dormant.'::text), ('PRODUCTION'::text,'wip_machine'::text,'Matiere en machine'::text,'kg'::text,'Bobines montees sur metier, immobilisees hors magasin.'::text,0,'Aucune machine declaree dans le parc.'::text), ('ACHATS'::text,'evolution_prix'::text,'Evolution des prix d achat'::text,'%'::text,'Variation du prix moyen pondere par rapport a la periode precedente.'::text,0,'Aucun releve de prix : ils s enregistrent au controle des receptions.'::text)) t(domaine, cle, libelle, unite, definition, disponible, condition);


ALTER VIEW public.v_supervision OWNER TO gestionfil;

--
-- Name: VIEW v_supervision; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON VIEW public.v_supervision IS 'Le catalogue des indicateurs de supervision : ce qu ils mesurent, et pour ceux
 qui ne peuvent pas encore etre calcules, CE QU IL FAUT ENREGISTRER pour les
 allumer. Les valeurs elles-memes sont servies par `v_supervision_valeurs`.';


--
-- Name: v_supervision_valeurs; Type: VIEW; Schema: public; Owner: gestionfil
--

CREATE VIEW public.v_supervision_valeurs AS
 WITH stock AS (
         SELECT COALESCE(sum(v_etat_stock.valeur_mad), (0)::numeric) AS valeur_mad,
            NULLIF(count(*), 0) AS nb_refs,
            count(*) FILTER (WHERE (v_etat_stock.statut = 'RUPTURE'::text)) AS nb_rupture,
            count(*) FILTER (WHERE (v_etat_stock.statut = 'OK'::text)) AS nb_ok,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v_etat_stock.jours_couverture)::double precision)) FILTER (WHERE (v_etat_stock.jours_couverture IS NOT NULL)) AS couverture_mediane
           FROM public.v_etat_stock
        ), sourcing AS (
         SELECT count(*) FILTER (WHERE (v_risque_sourcing.nb_sources <= 1)) AS nb_mono,
            COALESCE(sum(v_risque_sourcing.budget_annuel_mad) FILTER (WHERE (v_risque_sourcing.nb_sources <= 1)), (0)::numeric) AS budget_mono
           FROM public.v_risque_sourcing
        ), economies AS (
         SELECT COALESCE(sum(v_cockpit_economies.economie_annuelle_mad), (0)::numeric) AS economies_mad
           FROM public.v_cockpit_economies
        )
 SELECT 'valeur_stock'::text AS cle,
    s.valeur_mad AS valeur
   FROM stock s
UNION ALL
 SELECT 'couverture_mediane'::text AS cle,
    round((s.couverture_mediane)::numeric, 0) AS valeur
   FROM stock s
UNION ALL
 SELECT 'taux_rupture'::text AS cle,
    round(((100.0 * (s.nb_rupture)::numeric) / (s.nb_refs)::numeric), 1) AS valeur
   FROM stock s
UNION ALL
 SELECT 'taux_disponibilite'::text AS cle,
    round(((100.0 * (s.nb_ok)::numeric) / (s.nb_refs)::numeric), 1) AS valeur
   FROM stock s
UNION ALL
 SELECT 'mono_source'::text AS cle,
    (so.nb_mono)::numeric AS valeur
   FROM sourcing so
UNION ALL
 SELECT 'budget_mono'::text AS cle,
    so.budget_mono AS valeur
   FROM sourcing so
UNION ALL
 SELECT 'economies'::text AS cle,
    e.economies_mad AS valeur
   FROM economies e;


ALTER VIEW public.v_supervision_valeurs OWNER TO gestionfil;

--
-- Name: VIEW v_supervision_valeurs; Type: COMMENT; Schema: public; Owner: gestionfil
--

COMMENT ON VIEW public.v_supervision_valeurs IS 'La valeur courante de chaque indicateur calculable. Ceux qui manquent ici sont
 exactement ceux que `v_supervision` declare indisponibles.';


--
-- Name: valorisation_stock; Type: TABLE; Schema: public; Owner: gestionfil
--

CREATE TABLE public.valorisation_stock (
    id_valo text DEFAULT (gen_random_uuid())::text NOT NULL,
    date_valorisation text NOT NULL,
    code_reference text NOT NULL,
    code_magasin text NOT NULL,
    quantite_kg numeric(18,4) NOT NULL,
    cmup_mad numeric(18,4) NOT NULL,
    valeur_mad numeric(18,2) NOT NULL,
    methode text DEFAULT 'CMUP'::text NOT NULL,
    date_calcul text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text) NOT NULL,
    CONSTRAINT valorisation_stock_methode_check CHECK ((methode = 'CMUP'::text))
);


ALTER TABLE public.valorisation_stock OWNER TO gestionfil;

--
-- Name: _contexte_session _contexte_session_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public._contexte_session
    ADD CONSTRAINT _contexte_session_pkey PRIMARY KEY (id);


--
-- Name: alerte alerte_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.alerte
    ADD CONSTRAINT alerte_pkey PRIMARY KEY (id_alerte);


--
-- Name: archive_reception archive_reception_ligne_version_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.archive_reception
    ADD CONSTRAINT archive_reception_ligne_version_key UNIQUE (id_ligne_reception, version);


--
-- Name: archive_reception archive_reception_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.archive_reception
    ADD CONSTRAINT archive_reception_pkey PRIMARY KEY (id_archive);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id_audit);


--
-- Name: besoin_mrp besoin_mrp_id_plan_rang_mois_code_reference_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.besoin_mrp
    ADD CONSTRAINT besoin_mrp_id_plan_rang_mois_code_reference_key UNIQUE (id_plan, rang_mois, code_reference);


--
-- Name: besoin_mrp besoin_mrp_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.besoin_mrp
    ADD CONSTRAINT besoin_mrp_pkey PRIMARY KEY (id_besoin);


--
-- Name: bon_commande bon_commande_numero_bc_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.bon_commande
    ADD CONSTRAINT bon_commande_numero_bc_key UNIQUE (numero_bc);


--
-- Name: bon_commande bon_commande_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.bon_commande
    ADD CONSTRAINT bon_commande_pkey PRIMARY KEY (id_bc);


--
-- Name: categorie_matiere categorie_matiere_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.categorie_matiere
    ADD CONSTRAINT categorie_matiere_pkey PRIMARY KEY (code_categorie);


--
-- Name: champ_configurable champ_configurable_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.champ_configurable
    ADD CONSTRAINT champ_configurable_pkey PRIMARY KEY (module, champ);


--
-- Name: demande_autorisation ck_demande_decision_motivee; Type: CHECK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE public.demande_autorisation
    ADD CONSTRAINT ck_demande_decision_motivee CHECK (((statut <> ALL (ARRAY['ACCORDEE'::text, 'REFUSEE'::text])) OR (length(btrim(COALESCE(motif_decision, ''::text))) >= 5))) NOT VALID;


--
-- Name: cockpit_kpi cockpit_kpi_periode_indicateur_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.cockpit_kpi
    ADD CONSTRAINT cockpit_kpi_periode_indicateur_key UNIQUE (periode, indicateur);


--
-- Name: cockpit_kpi cockpit_kpi_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.cockpit_kpi
    ADD CONSTRAINT cockpit_kpi_pkey PRIMARY KEY (id_kpi);


--
-- Name: conditionnement conditionnement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.conditionnement
    ADD CONSTRAINT conditionnement_pkey PRIMARY KEY (code_conditionnement);


--
-- Name: contact_fournisseur contact_fournisseur_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.contact_fournisseur
    ADD CONSTRAINT contact_fournisseur_pkey PRIMARY KEY (id_contact);


--
-- Name: couleur_fournisseur couleur_fournisseur_code_fournisseur_code_couleur_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.couleur_fournisseur
    ADD CONSTRAINT couleur_fournisseur_code_fournisseur_code_couleur_key UNIQUE (code_fournisseur, code_couleur);


--
-- Name: couleur_fournisseur couleur_fournisseur_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.couleur_fournisseur
    ADD CONSTRAINT couleur_fournisseur_pkey PRIMARY KEY (id_couleur_fournisseur);


--
-- Name: couleur couleur_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.couleur
    ADD CONSTRAINT couleur_pkey PRIMARY KEY (code_couleur_interne);


--
-- Name: cours_bam cours_bam_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.cours_bam
    ADD CONSTRAINT cours_bam_pkey PRIMARY KEY (code_devise, date_cours);


--
-- Name: demande_autorisation demande_autorisation_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.demande_autorisation
    ADD CONSTRAINT demande_autorisation_pkey PRIMARY KEY (id_demande);


--
-- Name: devise devise_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.devise
    ADD CONSTRAINT devise_pkey PRIMARY KEY (code_devise);


--
-- Name: dossier_lignes_frais_cibles dossier_lignes_frais_cibles_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.dossier_lignes_frais_cibles
    ADD CONSTRAINT dossier_lignes_frais_cibles_pkey PRIMARY KEY (id_ligne_frais, id_ligne);


--
-- Name: dossier_lignes_frais dossier_lignes_frais_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.dossier_lignes_frais
    ADD CONSTRAINT dossier_lignes_frais_pkey PRIMARY KEY (id_ligne_frais);


--
-- Name: droit_champ droit_champ_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.droit_champ
    ADD CONSTRAINT droit_champ_pkey PRIMARY KEY (id_utilisateur, module, champ);


--
-- Name: entreprise entreprise_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.entreprise
    ADD CONSTRAINT entreprise_pkey PRIMARY KEY (id_entreprise);


--
-- Name: famille famille_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.famille
    ADD CONSTRAINT famille_pkey PRIMARY KEY (code_famille);


--
-- Name: fournisseur fournisseur_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.fournisseur
    ADD CONSTRAINT fournisseur_pkey PRIMARY KEY (code_fournisseur);


--
-- Name: frais_approche frais_approche_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.frais_approche
    ADD CONSTRAINT frais_approche_pkey PRIMARY KEY (id_frais);


--
-- Name: groupe_equiv groupe_equiv_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.groupe_equiv
    ADD CONSTRAINT groupe_equiv_pkey PRIMARY KEY (code_groupe_equiv);


--
-- Name: historique_conditionnement historique_conditionnement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.historique_conditionnement
    ADD CONSTRAINT historique_conditionnement_pkey PRIMARY KEY (id_historique);


--
-- Name: historique_prix historique_prix_id_ligne_reception_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.historique_prix
    ADD CONSTRAINT historique_prix_id_ligne_reception_key UNIQUE (id_ligne_reception);


--
-- Name: historique_prix historique_prix_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.historique_prix
    ADD CONSTRAINT historique_prix_pkey PRIMARY KEY (id_histo_prix);


--
-- Name: import_ajustements_cump import_ajustements_cump_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_ajustements_cump
    ADD CONSTRAINT import_ajustements_cump_pkey PRIMARY KEY (id_ajustement);


--
-- Name: import_dossiers import_dossiers_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_dossiers
    ADD CONSTRAINT import_dossiers_numero_key UNIQUE (numero);


--
-- Name: import_dossiers import_dossiers_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_dossiers
    ADD CONSTRAINT import_dossiers_pkey PRIMARY KEY (id_dossier);


--
-- Name: import_engagements import_engagements_id_dossier_numero_ei_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_engagements
    ADD CONSTRAINT import_engagements_id_dossier_numero_ei_key UNIQUE (id_dossier, numero_ei);


--
-- Name: import_engagements import_engagements_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_engagements
    ADD CONSTRAINT import_engagements_pkey PRIMARY KEY (id_engagement);


--
-- Name: import_facture_lignes import_facture_lignes_id_facture_ligne_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_facture_lignes
    ADD CONSTRAINT import_facture_lignes_id_facture_ligne_numero_key UNIQUE (id_facture, ligne_numero);


--
-- Name: import_facture_lignes import_facture_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_facture_lignes
    ADD CONSTRAINT import_facture_lignes_pkey PRIMARY KEY (id_ligne);


--
-- Name: import_factures import_factures_code_fournisseur_numero_facture_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_factures
    ADD CONSTRAINT import_factures_code_fournisseur_numero_facture_key UNIQUE (code_fournisseur, numero_facture);


--
-- Name: import_factures import_factures_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_factures
    ADD CONSTRAINT import_factures_pkey PRIMARY KEY (id_facture);


--
-- Name: import_reception_lignes import_reception_lignes_id_reception_id_ligne_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_reception_lignes
    ADD CONSTRAINT import_reception_lignes_id_reception_id_ligne_key UNIQUE (id_reception, id_ligne);


--
-- Name: import_reception_lignes import_reception_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_reception_lignes
    ADD CONSTRAINT import_reception_lignes_pkey PRIMARY KEY (id_reception_ligne);


--
-- Name: import_receptions import_receptions_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_receptions
    ADD CONSTRAINT import_receptions_numero_key UNIQUE (numero);


--
-- Name: import_receptions import_receptions_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_receptions
    ADD CONSTRAINT import_receptions_pkey PRIMARY KEY (id_reception);


--
-- Name: inventaire inventaire_numero_inventaire_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.inventaire
    ADD CONSTRAINT inventaire_numero_inventaire_key UNIQUE (numero_inventaire);


--
-- Name: inventaire inventaire_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.inventaire
    ADD CONSTRAINT inventaire_pkey PRIMARY KEY (id_inventaire);


--
-- Name: journal_connexion journal_connexion_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.journal_connexion
    ADD CONSTRAINT journal_connexion_pkey PRIMARY KEY (id_journal);


--
-- Name: ligne_bc ligne_bc_id_bc_ligne_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_bc
    ADD CONSTRAINT ligne_bc_id_bc_ligne_numero_key UNIQUE (id_bc, ligne_numero);


--
-- Name: ligne_bc ligne_bc_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_bc
    ADD CONSTRAINT ligne_bc_pkey PRIMARY KEY (id_ligne_bc);


--
-- Name: ligne_inventaire ligne_inventaire_id_inventaire_code_reference_code_magasin__key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_inventaire
    ADD CONSTRAINT ligne_inventaire_id_inventaire_code_reference_code_magasin__key UNIQUE (id_inventaire, code_reference, code_magasin, lot_fournisseur);


--
-- Name: ligne_inventaire ligne_inventaire_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_inventaire
    ADD CONSTRAINT ligne_inventaire_pkey PRIMARY KEY (id_ligne_inv);


--
-- Name: ligne_mouvement ligne_mouvement_id_mouvement_ligne_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_mouvement
    ADD CONSTRAINT ligne_mouvement_id_mouvement_ligne_numero_key UNIQUE (id_mouvement, ligne_numero);


--
-- Name: ligne_mouvement ligne_mouvement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_mouvement
    ADD CONSTRAINT ligne_mouvement_pkey PRIMARY KEY (id_ligne_mouvement);


--
-- Name: ligne_plan_production ligne_plan_production_id_plan_rang_mois_code_qualite_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_plan_production
    ADD CONSTRAINT ligne_plan_production_id_plan_rang_mois_code_qualite_key UNIQUE (id_plan, rang_mois, code_qualite);


--
-- Name: ligne_plan_production ligne_plan_production_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_plan_production
    ADD CONSTRAINT ligne_plan_production_pkey PRIMARY KEY (id_ligne_plan);


--
-- Name: ligne_qualite ligne_qualite_code_qualite_code_role_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_qualite
    ADD CONSTRAINT ligne_qualite_code_qualite_code_role_key UNIQUE (code_qualite, code_role);


--
-- Name: ligne_qualite ligne_qualite_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_qualite
    ADD CONSTRAINT ligne_qualite_pkey PRIMARY KEY (id_ligne_qualite);


--
-- Name: ligne_reception ligne_reception_id_reception_ligne_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_id_reception_ligne_numero_key UNIQUE (id_reception, ligne_numero);


--
-- Name: ligne_reception ligne_reception_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_pkey PRIMARY KEY (id_ligne_reception);


--
-- Name: ligne_transfert ligne_transfert_id_transfert_ligne_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_transfert
    ADD CONSTRAINT ligne_transfert_id_transfert_ligne_numero_key UNIQUE (id_transfert, ligne_numero);


--
-- Name: ligne_transfert ligne_transfert_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_transfert
    ADD CONSTRAINT ligne_transfert_pkey PRIMARY KEY (id_ligne_transfert);


--
-- Name: lignes_frais_repartition lignes_frais_repartition_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.lignes_frais_repartition
    ADD CONSTRAINT lignes_frais_repartition_pkey PRIMARY KEY (id_ligne_frais, id_article_dossier);


--
-- Name: lot_evenement lot_evenement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.lot_evenement
    ADD CONSTRAINT lot_evenement_pkey PRIMARY KEY (id_evenement);


--
-- Name: lot lot_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_pkey PRIMARY KEY (code_reference, lot_fournisseur);


--
-- Name: machine_cliche machine_cliche_id_fiche_code_reference_lot_fournisseur_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_cliche
    ADD CONSTRAINT machine_cliche_id_fiche_code_reference_lot_fournisseur_key UNIQUE (id_fiche, code_reference, lot_fournisseur);


--
-- Name: machine_cliche machine_cliche_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_cliche
    ADD CONSTRAINT machine_cliche_pkey PRIMARY KEY (id_cliche);


--
-- Name: machine_consommation machine_consommation_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_consommation
    ADD CONSTRAINT machine_consommation_pkey PRIMARY KEY (id_consommation);


--
-- Name: machine_decision_etat machine_decision_etat_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision_etat
    ADD CONSTRAINT machine_decision_etat_pkey PRIMARY KEY (id_decision, moment, code_reference, lot_fournisseur);


--
-- Name: machine_decision_ligne machine_decision_ligne_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision_ligne
    ADD CONSTRAINT machine_decision_ligne_pkey PRIMARY KEY (id_decision, ligne_numero);


--
-- Name: machine_decision machine_decision_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision
    ADD CONSTRAINT machine_decision_pkey PRIMARY KEY (id_decision);


--
-- Name: machine_emplacement machine_emplacement_code_machine_role_numero_etage_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_emplacement
    ADD CONSTRAINT machine_emplacement_code_machine_role_numero_etage_key UNIQUE (code_machine, role, numero_etage);


--
-- Name: machine_emplacement machine_emplacement_code_magasin_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_emplacement
    ADD CONSTRAINT machine_emplacement_code_magasin_key UNIQUE (code_magasin);


--
-- Name: machine_emplacement machine_emplacement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_emplacement
    ADD CONSTRAINT machine_emplacement_pkey PRIMARY KEY (code_emplacement);


--
-- Name: machine_etat machine_etat_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_etat
    ADD CONSTRAINT machine_etat_pkey PRIMARY KEY (code_emplacement, code_reference, lot_fournisseur);


--
-- Name: machine_fiche_journal machine_fiche_journal_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_journal
    ADD CONSTRAINT machine_fiche_journal_pkey PRIMARY KEY (id_evenement);


--
-- Name: machine_fiche_ligne machine_fiche_ligne_id_fiche_ligne_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_ligne
    ADD CONSTRAINT machine_fiche_ligne_id_fiche_ligne_numero_key UNIQUE (id_fiche, ligne_numero);


--
-- Name: machine_fiche_ligne machine_fiche_ligne_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_ligne
    ADD CONSTRAINT machine_fiche_ligne_pkey PRIMARY KEY (id_ligne);


--
-- Name: machine_fiche machine_fiche_numero_fiche_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche
    ADD CONSTRAINT machine_fiche_numero_fiche_key UNIQUE (numero_fiche);


--
-- Name: machine_fiche machine_fiche_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche
    ADD CONSTRAINT machine_fiche_pkey PRIMARY KEY (id_fiche);


--
-- Name: machine_motif machine_motif_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_motif
    ADD CONSTRAINT machine_motif_pkey PRIMARY KEY (code_motif);


--
-- Name: machine machine_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine
    ADD CONSTRAINT machine_pkey PRIMARY KEY (code_machine);


--
-- Name: magasin magasin_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.magasin
    ADD CONSTRAINT magasin_pkey PRIMARY KEY (code_magasin);


--
-- Name: migration_appliquee migration_appliquee_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.migration_appliquee
    ADD CONSTRAINT migration_appliquee_pkey PRIMARY KEY (fichier);


--
-- Name: modele_droit_champ modele_droit_champ_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.modele_droit_champ
    ADD CONSTRAINT modele_droit_champ_pkey PRIMARY KEY (code_role_user, module, champ);


--
-- Name: motif_ligne motif_ligne_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.motif_ligne
    ADD CONSTRAINT motif_ligne_pkey PRIMARY KEY (code_motif_ligne);


--
-- Name: motif_mouvement motif_mouvement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.motif_mouvement
    ADD CONSTRAINT motif_mouvement_pkey PRIMARY KEY (code_motif);


--
-- Name: mouvement mouvement_numero_mouvement_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.mouvement
    ADD CONSTRAINT mouvement_numero_mouvement_key UNIQUE (numero_mouvement);


--
-- Name: mouvement mouvement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.mouvement
    ADD CONSTRAINT mouvement_pkey PRIMARY KEY (id_mouvement);


--
-- Name: parametre_historique parametre_historique_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.parametre_historique
    ADD CONSTRAINT parametre_historique_pkey PRIMARY KEY (id_histo_param);


--
-- Name: parametre parametre_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.parametre
    ADD CONSTRAINT parametre_pkey PRIMARY KEY (code_parametre);


--
-- Name: parametres_frais parametres_frais_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.parametres_frais
    ADD CONSTRAINT parametres_frais_pkey PRIMARY KEY (id_frais);


--
-- Name: permission permission_code_role_user_module_action_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.permission
    ADD CONSTRAINT permission_code_role_user_module_action_key UNIQUE (code_role_user, module, action);


--
-- Name: permission permission_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.permission
    ADD CONSTRAINT permission_pkey PRIMARY KEY (id_permission);


--
-- Name: piece_jointe piece_jointe_chemin_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_jointe
    ADD CONSTRAINT piece_jointe_chemin_key UNIQUE (chemin);


--
-- Name: piece_jointe piece_jointe_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_jointe
    ADD CONSTRAINT piece_jointe_pkey PRIMARY KEY (id_piece);


--
-- Name: piece_lecture piece_lecture_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_lecture
    ADD CONSTRAINT piece_lecture_pkey PRIMARY KEY (id_piece);


--
-- Name: plan_achat plan_achat_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_achat
    ADD CONSTRAINT plan_achat_pkey PRIMARY KEY (id_proposition);


--
-- Name: plan_production plan_production_annee_numero_version_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_production
    ADD CONSTRAINT plan_production_annee_numero_version_key UNIQUE (annee, numero_version);


--
-- Name: plan_production plan_production_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_production
    ADD CONSTRAINT plan_production_pkey PRIMARY KEY (id_plan);


--
-- Name: plan_qualite plan_qualite_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_qualite
    ADD CONSTRAINT plan_qualite_pkey PRIMARY KEY (id_plan, code_qualite);


--
-- Name: plan_saisonnalite plan_saisonnalite_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_saisonnalite
    ADD CONSTRAINT plan_saisonnalite_pkey PRIMARY KEY (id_plan, code_qualite, mois);


--
-- Name: preference_utilisateur preference_utilisateur_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.preference_utilisateur
    ADD CONSTRAINT preference_utilisateur_pkey PRIMARY KEY (id_utilisateur);


--
-- Name: qualite qualite_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.qualite
    ADD CONSTRAINT qualite_pkey PRIMARY KEY (code_qualite);


--
-- Name: reception_ajustements_cmup reception_ajustements_cmup_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception_ajustements_cmup
    ADD CONSTRAINT reception_ajustements_cmup_pkey PRIMARY KEY (id_ajustement);


--
-- Name: reception reception_numero_reception_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception
    ADD CONSTRAINT reception_numero_reception_key UNIQUE (numero_reception);


--
-- Name: reception reception_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception
    ADD CONSTRAINT reception_pkey PRIMARY KEY (id_reception);


--
-- Name: recette recette_code_qualite_code_reference_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.recette
    ADD CONSTRAINT recette_code_qualite_code_reference_key UNIQUE (code_qualite, code_reference);


--
-- Name: recette recette_code_qualite_ligne_numero_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.recette
    ADD CONSTRAINT recette_code_qualite_ligne_numero_key UNIQUE (code_qualite, ligne_numero);


--
-- Name: recette recette_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.recette
    ADD CONSTRAINT recette_pkey PRIMARY KEY (id_recette);


--
-- Name: reference_groupe_equiv reference_groupe_equiv_code_reference_code_groupe_equiv_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference_groupe_equiv
    ADD CONSTRAINT reference_groupe_equiv_code_reference_code_groupe_equiv_key UNIQUE (code_reference, code_groupe_equiv);


--
-- Name: reference_groupe_equiv reference_groupe_equiv_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference_groupe_equiv
    ADD CONSTRAINT reference_groupe_equiv_pkey PRIMARY KEY (id_ref_grp);


--
-- Name: reference reference_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference
    ADD CONSTRAINT reference_pkey PRIMARY KEY (code_reference);


--
-- Name: role_bom role_bom_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.role_bom
    ADD CONSTRAINT role_bom_pkey PRIMARY KEY (code_role);


--
-- Name: role_utilisateur role_utilisateur_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.role_utilisateur
    ADD CONSTRAINT role_utilisateur_pkey PRIMARY KEY (code_role_user);


--
-- Name: snapshot_mrp snapshot_mrp_date_snapshot_id_plan_code_reference_rang_mois_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.snapshot_mrp
    ADD CONSTRAINT snapshot_mrp_date_snapshot_id_plan_code_reference_rang_mois_key UNIQUE (date_snapshot, id_plan, code_reference, rang_mois);


--
-- Name: snapshot_mrp snapshot_mrp_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.snapshot_mrp
    ADD CONSTRAINT snapshot_mrp_pkey PRIMARY KEY (id_snapshot);


--
-- Name: stock_lot stock_lot_code_reference_code_magasin_lot_fournisseur_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.stock_lot
    ADD CONSTRAINT stock_lot_code_reference_code_magasin_lot_fournisseur_key UNIQUE (code_reference, code_magasin, lot_fournisseur);


--
-- Name: stock_lot stock_lot_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.stock_lot
    ADD CONSTRAINT stock_lot_pkey PRIMARY KEY (id_stock_lot);


--
-- Name: stock_magasin stock_magasin_code_reference_code_magasin_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.stock_magasin
    ADD CONSTRAINT stock_magasin_code_reference_code_magasin_key UNIQUE (code_reference, code_magasin);


--
-- Name: stock_magasin stock_magasin_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.stock_magasin
    ADD CONSTRAINT stock_magasin_pkey PRIMARY KEY (id_stock);


--
-- Name: taux_change taux_change_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.taux_change
    ADD CONSTRAINT taux_change_pkey PRIMARY KEY (id_taux);


--
-- Name: telechargement telechargement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.telechargement
    ADD CONSTRAINT telechargement_pkey PRIMARY KEY (id_telechargement);


--
-- Name: transfert transfert_numero_transfert_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.transfert
    ADD CONSTRAINT transfert_numero_transfert_key UNIQUE (numero_transfert);


--
-- Name: transfert transfert_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.transfert
    ADD CONSTRAINT transfert_pkey PRIMARY KEY (id_transfert);


--
-- Name: transition_statut transition_statut_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.transition_statut
    ADD CONSTRAINT transition_statut_pkey PRIMARY KEY (entite, statut_source, statut_cible);


--
-- Name: type_mouvement type_mouvement_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.type_mouvement
    ADD CONSTRAINT type_mouvement_pkey PRIMARY KEY (code_type_mvt);


--
-- Name: utilisateur utilisateur_login_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.utilisateur
    ADD CONSTRAINT utilisateur_login_key UNIQUE (login);


--
-- Name: utilisateur utilisateur_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.utilisateur
    ADD CONSTRAINT utilisateur_pkey PRIMARY KEY (id_utilisateur);


--
-- Name: valorisation_stock valorisation_stock_date_valorisation_code_reference_code_ma_key; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.valorisation_stock
    ADD CONSTRAINT valorisation_stock_date_valorisation_code_reference_code_ma_key UNIQUE (date_valorisation, code_reference, code_magasin);


--
-- Name: valorisation_stock valorisation_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.valorisation_stock
    ADD CONSTRAINT valorisation_stock_pkey PRIMARY KEY (id_valo);


--
-- Name: idx_import_engagements_numero; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX idx_import_engagements_numero ON public.import_engagements USING btree (numero_ei);


--
-- Name: idx_import_factures_engagement; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX idx_import_factures_engagement ON public.import_factures USING btree (id_engagement);


--
-- Name: ix_alerte_entite; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_alerte_entite ON public.alerte USING btree (entite_concernee, id_entite);


--
-- Name: ix_alerte_statut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_alerte_statut ON public.alerte USING btree (statut, gravite, date_detection DESC);


--
-- Name: ix_archive_four; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_archive_four ON public.archive_reception USING btree (code_fournisseur, date_reception DESC);


--
-- Name: ix_archive_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_archive_ref ON public.archive_reception USING btree (code_reference, date_reception DESC);


--
-- Name: ix_audit_enreg; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_audit_enreg ON public.audit_log USING btree (id_enregistrement);


--
-- Name: ix_audit_table; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_audit_table ON public.audit_log USING btree (table_concernee, date_operation DESC);


--
-- Name: ix_audit_user; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_audit_user ON public.audit_log USING btree (id_utilisateur, date_operation DESC);


--
-- Name: ix_bc_fournisseur; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_bc_fournisseur ON public.bon_commande USING btree (code_fournisseur, statut);


--
-- Name: ix_bc_statut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_bc_statut ON public.bon_commande USING btree (statut, date_bc DESC);


--
-- Name: ix_besoin_mrp_plan; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_besoin_mrp_plan ON public.besoin_mrp USING btree (id_plan, mois);


--
-- Name: ix_besoin_mrp_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_besoin_mrp_ref ON public.besoin_mrp USING btree (code_reference);


--
-- Name: ix_champ_conf_module; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_champ_conf_module ON public.champ_configurable USING btree (module, ordre);


--
-- Name: ix_cliche_zone; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_cliche_zone ON public.machine_cliche USING btree (code_emplacement, date_cliche);


--
-- Name: ix_conso_machine; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_conso_machine ON public.machine_consommation USING btree (code_machine, date_constat);


--
-- Name: ix_conso_of; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_conso_of ON public.machine_consommation USING btree (numero_of) WHERE (numero_of IS NOT NULL);


--
-- Name: ix_conso_reference; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_conso_reference ON public.machine_consommation USING btree (code_reference, lot_fournisseur);


--
-- Name: ix_couleur_four_code; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_couleur_four_code ON public.couleur_fournisseur USING btree (code_couleur);


--
-- Name: ix_couleur_four_couleur; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_couleur_four_couleur ON public.couleur_fournisseur USING btree (code_couleur_interne);


--
-- Name: ix_demande_statut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_demande_statut ON public.demande_autorisation USING btree (statut, date_demande);


--
-- Name: ix_dlf_dossier; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_dlf_dossier ON public.dossier_lignes_frais USING btree (id_dossier);


--
-- Name: ix_droit_champ_module; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_droit_champ_module ON public.droit_champ USING btree (id_utilisateur, module);


--
-- Name: ix_empl_machine; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_empl_machine ON public.machine_emplacement USING btree (code_machine);


--
-- Name: ix_etat_reference; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_etat_reference ON public.machine_etat USING btree (code_reference, lot_fournisseur);


--
-- Name: ix_fiche_ligne_fiche; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_fiche_ligne_fiche ON public.machine_fiche_ligne USING btree (id_fiche);


--
-- Name: ix_fiche_ligne_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_fiche_ligne_ref ON public.machine_fiche_ligne USING btree (code_reference, lot_fournisseur);


--
-- Name: ix_fiche_machine; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_fiche_machine ON public.machine_fiche USING btree (code_machine, date_fiche);


--
-- Name: ix_fiche_statut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_fiche_statut ON public.machine_fiche USING btree (statut) WHERE (statut = 'BROUILLON'::text);


--
-- Name: ix_frais_reception; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_frais_reception ON public.frais_approche USING btree (id_reception);


--
-- Name: ix_grp_equiv_priorite; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_grp_equiv_priorite ON public.reference_groupe_equiv USING btree (code_groupe_equiv, priorite);


--
-- Name: ix_hist_cond_fournisseur; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_hist_cond_fournisseur ON public.historique_conditionnement USING btree (code_fournisseur);


--
-- Name: ix_hist_cond_reference; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_hist_cond_reference ON public.historique_conditionnement USING btree (code_reference, date_evenement);


--
-- Name: ix_histo_prix_four; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_histo_prix_four ON public.historique_prix USING btree (code_fournisseur, date_achat DESC);


--
-- Name: ix_histo_prix_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_histo_prix_ref ON public.historique_prix USING btree (code_reference, date_achat DESC);


--
-- Name: ix_iac_dossier; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_iac_dossier ON public.import_ajustements_cump USING btree (id_dossier);


--
-- Name: ix_iac_reference; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_iac_reference ON public.import_ajustements_cump USING btree (code_reference, date_ajustement DESC);


--
-- Name: ix_ifl_facture; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ifl_facture ON public.import_facture_lignes USING btree (id_facture);


--
-- Name: ix_ifl_ligne_bc; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ifl_ligne_bc ON public.import_facture_lignes USING btree (id_ligne_bc) WHERE (id_ligne_bc IS NOT NULL);


--
-- Name: ix_ifl_reference; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ifl_reference ON public.import_facture_lignes USING btree (code_reference);


--
-- Name: ix_import_dossiers_statut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_import_dossiers_statut ON public.import_dossiers USING btree (statut, date_creation DESC);


--
-- Name: ix_import_factures_dossier; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_import_factures_dossier ON public.import_factures USING btree (id_dossier);


--
-- Name: ix_import_factures_fournisseur; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_import_factures_fournisseur ON public.import_factures USING btree (code_fournisseur, date_facture DESC);


--
-- Name: ix_import_receptions_date; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_import_receptions_date ON public.import_receptions USING btree (date_reception DESC);


--
-- Name: ix_irl_ligne; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_irl_ligne ON public.import_reception_lignes USING btree (id_ligne);


--
-- Name: ix_journal_connexion_date; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_journal_connexion_date ON public.journal_connexion USING btree (horodatage DESC);


--
-- Name: ix_journal_connexion_login; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_journal_connexion_login ON public.journal_connexion USING btree (login, horodatage DESC);


--
-- Name: ix_lfr_article; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_lfr_article ON public.lignes_frais_repartition USING btree (id_article_dossier);


--
-- Name: ix_ligne_bc_bc; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ligne_bc_bc ON public.ligne_bc USING btree (id_bc);


--
-- Name: ix_ligne_bc_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ligne_bc_ref ON public.ligne_bc USING btree (code_reference) WHERE (code_reference IS NOT NULL);


--
-- Name: ix_ligne_inv_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ligne_inv_ref ON public.ligne_inventaire USING btree (code_reference);


--
-- Name: ix_ligne_plan_qualite; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ligne_plan_qualite ON public.ligne_plan_production USING btree (code_qualite);


--
-- Name: ix_ligne_reception_bc; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ligne_reception_bc ON public.ligne_reception USING btree (id_ligne_bc);


--
-- Name: ix_ligne_reception_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ligne_reception_ref ON public.ligne_reception USING btree (code_reference);


--
-- Name: ix_lmvt_lot; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_lmvt_lot ON public.ligne_mouvement USING btree (code_reference, lot_fournisseur);


--
-- Name: ix_lmvt_mvt; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_lmvt_mvt ON public.ligne_mouvement USING btree (id_mouvement);


--
-- Name: ix_lmvt_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_lmvt_ref ON public.ligne_mouvement USING btree (code_reference);


--
-- Name: ix_lot_evenement_lot; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_lot_evenement_lot ON public.lot_evenement USING btree (code_reference, lot_fournisseur, date_evenement);


--
-- Name: ix_machine_decision_emplacement; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_machine_decision_emplacement ON public.machine_decision USING btree (code_emplacement, date_decision);


--
-- Name: ix_machine_decision_ligne_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_machine_decision_ligne_ref ON public.machine_decision_ligne USING btree (code_reference, lot_fournisseur);


--
-- Name: ix_machine_fiche_journal_fiche; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_machine_fiche_journal_fiche ON public.machine_fiche_journal USING btree (id_fiche, horodatage);


--
-- Name: ix_mouvement_decision_machine; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_mouvement_decision_machine ON public.mouvement USING btree (id_decision_machine) WHERE (id_decision_machine IS NOT NULL);


--
-- Name: ix_mvt_date; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_mvt_date ON public.mouvement USING btree (date_mouvement DESC);


--
-- Name: ix_mvt_doc; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_mvt_doc ON public.mouvement USING btree (reference_document);


--
-- Name: ix_mvt_magasin; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_mvt_magasin ON public.mouvement USING btree (code_magasin, date_mouvement DESC);


--
-- Name: ix_mvt_type; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_mvt_type ON public.mouvement USING btree (code_type_mvt, date_mouvement DESC);


--
-- Name: ix_param_histo_code; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_param_histo_code ON public.parametre_historique USING btree (code_parametre, date_modification DESC);


--
-- Name: ix_piece_dossier; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_piece_dossier ON public.piece_jointe USING btree (id_dossier, date_depot DESC);


--
-- Name: ix_piece_empreinte; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_piece_empreinte ON public.piece_jointe USING btree (empreinte_sha256);


--
-- Name: ix_plan_achat_fournisseur; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_plan_achat_fournisseur ON public.plan_achat USING btree (code_fournisseur);


--
-- Name: ix_plan_achat_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_plan_achat_ref ON public.plan_achat USING btree (code_reference);


--
-- Name: ix_plan_achat_statut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_plan_achat_statut ON public.plan_achat USING btree (statut, urgence);


--
-- Name: ix_plan_qualite_qualite; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_plan_qualite_qualite ON public.plan_qualite USING btree (code_qualite);


--
-- Name: ix_plan_statut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_plan_statut ON public.plan_production USING btree (statut, annee);


--
-- Name: ix_rec_ajust_reception; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_rec_ajust_reception ON public.reception_ajustements_cmup USING btree (id_reception);


--
-- Name: ix_reception_bc; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_reception_bc ON public.reception USING btree (id_bc);


--
-- Name: ix_reception_statut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_reception_statut ON public.reception USING btree (statut, date_reception DESC);


--
-- Name: ix_recette_qualite; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_recette_qualite ON public.recette USING btree (code_qualite);


--
-- Name: ix_recette_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_recette_ref ON public.recette USING btree (code_reference);


--
-- Name: ix_recette_role; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_recette_role ON public.recette USING btree (code_qualite, code_role);


--
-- Name: ix_ref_abc; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ref_abc ON public.reference USING btree (classe_abc) WHERE (actif = 1);


--
-- Name: ix_ref_categorie; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ref_categorie ON public.reference USING btree (code_categorie);


--
-- Name: ix_ref_famille_couleur; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ref_famille_couleur ON public.reference USING btree (code_famille, code_couleur_interne) WHERE (actif = 1);


--
-- Name: ix_ref_fournisseur; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ref_fournisseur ON public.reference USING btree (code_fournisseur);


--
-- Name: ix_ref_reference_fournisseur; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_ref_reference_fournisseur ON public.reference USING btree (reference_fournisseur) WHERE (reference_fournisseur IS NOT NULL);


--
-- Name: ix_stock_lot_fefo; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_stock_lot_fefo ON public.stock_lot USING btree (code_reference, code_magasin, date_peremption) WHERE (quantite_kg > (0)::numeric);


--
-- Name: ix_stock_magasin; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_stock_magasin ON public.stock_magasin USING btree (code_magasin);


--
-- Name: ix_stock_ref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_stock_ref ON public.stock_magasin USING btree (code_reference);


--
-- Name: ix_taux_devise_date; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_taux_devise_date ON public.taux_change USING btree (code_devise, date_debut DESC);


--
-- Name: ix_telechargement_date; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_telechargement_date ON public.telechargement USING btree (date_telechargement DESC);


--
-- Name: ix_telechargement_user; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_telechargement_user ON public.telechargement USING btree (id_utilisateur, date_telechargement DESC);


--
-- Name: ix_utilisateur_role; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE INDEX ix_utilisateur_role ON public.utilisateur USING btree (code_role_user);


--
-- Name: ux_contact_principal; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_contact_principal ON public.contact_fournisseur USING btree (code_fournisseur) WHERE (est_principal = 1);


--
-- Name: ux_devise_pivot; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_devise_pivot ON public.devise USING btree (est_pivot) WHERE (est_pivot = 1);


--
-- Name: ux_empl_role_unique; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_empl_role_unique ON public.machine_emplacement USING btree (code_machine, role) WHERE (role = ANY (ARRAY['CHAINE'::text, 'TRAME'::text, 'RESERVE'::text]));


--
-- Name: ux_grp_equiv_pref; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_grp_equiv_pref ON public.reference_groupe_equiv USING btree (code_groupe_equiv) WHERE (est_preferentielle = 1);


--
-- Name: ux_grp_equiv_prio; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_grp_equiv_prio ON public.reference_groupe_equiv USING btree (code_groupe_equiv, priorite) WHERE (actif = 1);


--
-- Name: ux_inventaire_en_cours; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_inventaire_en_cours ON public.inventaire USING btree (code_magasin) WHERE (statut = 'EN_COURS'::text);


--
-- Name: ux_machine_decision_fiche; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_machine_decision_fiche ON public.machine_decision USING btree (id_fiche, numero_validation) WHERE (id_fiche IS NOT NULL);


--
-- Name: ux_machine_decision_tete; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_machine_decision_tete ON public.machine_decision USING btree (code_emplacement) WHERE (est_tete = 1);


--
-- Name: ux_mouvement_contrepasse; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_mouvement_contrepasse ON public.mouvement USING btree (id_mouvement_contrepasse) WHERE (id_mouvement_contrepasse IS NOT NULL);


--
-- Name: ux_plan_achat_ouvert; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_plan_achat_ouvert ON public.plan_achat USING btree (code_reference) WHERE (statut = ANY (ARRAY['PROPOSE'::text, 'EN_REVISION'::text, 'VALIDE'::text]));


--
-- Name: ux_plan_unique_en_cours; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_plan_unique_en_cours ON public.plan_production USING btree ((true)) WHERE (statut = 'EN_COURS'::text);


--
-- Name: ux_taux_devise_debut; Type: INDEX; Schema: public; Owner: gestionfil
--

CREATE UNIQUE INDEX ux_taux_devise_debut ON public.taux_change USING btree (code_devise, date_debut);


--
-- Name: v_besoin_mrp_calcule _RETURN; Type: RULE; Schema: public; Owner: gestionfil
--

CREATE OR REPLACE VIEW public.v_besoin_mrp_calcule AS
 SELECT pp.id_plan,
    pp.libelle AS plan_libelle,
    pp.annee,
    lpp.mois,
    lpp.rang_mois,
    lpp.annee_mois,
    rc.code_reference,
    round(sum((lpp.m2_prevus * rc.kg_m2)), 4) AS quantite_brute_kg,
    pp.taux_perte_pct,
    round((sum((lpp.m2_prevus * rc.kg_m2)) * ((1)::numeric + (pp.taux_perte_pct / 100.0))), 4) AS quantite_kg
   FROM (((public.plan_production pp
     JOIN public.ligne_plan_production lpp ON ((lpp.id_plan = pp.id_plan)))
     JOIN public.plan_qualite pq ON (((pq.id_plan = pp.id_plan) AND (pq.code_qualite = lpp.code_qualite))))
     JOIN public.v_recette_calculee rc ON ((rc.code_qualite = pq.code_qualite)))
  WHERE (lpp.m2_prevus > (0)::numeric)
  GROUP BY pp.id_plan, lpp.rang_mois, lpp.mois, lpp.annee_mois, rc.code_reference;


--
-- Name: v_groupe_equiv_detail _RETURN; Type: RULE; Schema: public; Owner: gestionfil
--

CREATE OR REPLACE VIEW public.v_groupe_equiv_detail AS
 SELECT g.code_groupe_equiv,
    g.libelle,
    g.description,
    g.actif,
    count(rge.code_reference) AS nb_references,
    count(DISTINCT r.code_fournisseur) AS nb_fournisseurs,
    count(DISTINCT r.unite_catalogue) AS nb_unites,
    count(DISTINCT COALESCE(r.densite_kg_ml, ('-1'::integer)::numeric)) AS nb_densites,
    count(DISTINCT r.code_categorie) AS nb_categories,
    sum(rge.est_preferentielle) AS nb_preferentielles,
    sum(
        CASE
            WHEN (COALESCE(sd.stock_mrp_kg, (0)::numeric) > (0)::numeric) THEN 1
            ELSE 0
        END) AS nb_avec_stock,
    sum(
        CASE
            WHEN (COALESCE(b.besoin_12m_kg, (0)::numeric) > (0)::numeric) THEN 1
            ELSE 0
        END) AS nb_avec_besoin,
    round(sum(COALESCE(sd.stock_mrp_kg, (0)::numeric)), 3) AS stock_cumule_kg,
    round(sum(COALESCE(b.besoin_12m_kg, (0)::numeric)), 3) AS besoin_cumule_kg,
        CASE
            WHEN (count(rge.code_reference) < 2) THEN 'MONO-REFERENCE'::text
            WHEN ((count(DISTINCT r.unite_catalogue) > 1) OR (count(DISTINCT COALESCE(r.densite_kg_ml, ('-1'::integer)::numeric)) > 1) OR (count(DISTINCT r.code_categorie) > 1)) THEN 'HETEROGENE'::text
            WHEN (count(DISTINCT r.code_fournisseur) < 2) THEN 'MEME FOURNISSEUR'::text
            ELSE 'ALTERNATIF'::text
        END AS qualification
   FROM ((((public.groupe_equiv g
     LEFT JOIN public.reference_groupe_equiv rge ON (((rge.code_groupe_equiv = g.code_groupe_equiv) AND (rge.actif = 1))))
     LEFT JOIN public.reference r ON (((r.code_reference = rge.code_reference) AND (r.actif = 1))))
     LEFT JOIN public.v_stock_disponible sd ON ((sd.code_reference = rge.code_reference)))
     LEFT JOIN public.v_besoin_12m b ON ((b.code_reference = rge.code_reference)))
  GROUP BY g.code_groupe_equiv;


--
-- Name: archive_reception trg_archive_immuable_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_archive_immuable_d BEFORE DELETE ON public.archive_reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_archive_immuable_d();


--
-- Name: archive_reception trg_archive_immuable_r; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_archive_immuable_r BEFORE INSERT ON public.archive_reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_archive_immuable_r();


--
-- Name: archive_reception trg_archive_immuable_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_archive_immuable_u BEFORE UPDATE ON public.archive_reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_archive_immuable_u();


--
-- Name: bon_commande trg_audit_bc_statut; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_bc_statut AFTER UPDATE OF statut ON public.bon_commande FOR EACH ROW WHEN ((old.statut IS DISTINCT FROM new.statut)) EXECUTE FUNCTION public.fn_trg_audit_bc_statut();


--
-- Name: droit_champ trg_audit_droit_champ_i; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_droit_champ_i AFTER INSERT ON public.droit_champ FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_droit_champ_i();


--
-- Name: droit_champ trg_audit_droit_champ_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_droit_champ_u AFTER UPDATE OF niveau ON public.droit_champ FOR EACH ROW WHEN ((old.niveau IS DISTINCT FROM new.niveau)) EXECUTE FUNCTION public.fn_trg_audit_droit_champ_u();


--
-- Name: fournisseur trg_audit_fournisseur; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_fournisseur AFTER UPDATE ON public.fournisseur FOR EACH ROW WHEN (((old.delai_livraison_jours IS DISTINCT FROM new.delai_livraison_jours) OR (old.code_devise IS DISTINCT FROM new.code_devise) OR (old.actif IS DISTINCT FROM new.actif))) EXECUTE FUNCTION public.fn_trg_audit_fournisseur();


--
-- Name: audit_log trg_audit_immuable_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_immuable_d BEFORE DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_immuable_d();


--
-- Name: audit_log trg_audit_immuable_r; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_immuable_r BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_immuable_r();


--
-- Name: audit_log trg_audit_immuable_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_immuable_u BEFORE UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_immuable_u();


--
-- Name: inventaire trg_audit_inventaire_i; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_inventaire_i AFTER INSERT ON public.inventaire FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_inventaire_i();


--
-- Name: inventaire trg_audit_inventaire_statut; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_inventaire_statut AFTER UPDATE OF statut ON public.inventaire FOR EACH ROW WHEN ((old.statut IS DISTINCT FROM new.statut)) EXECUTE FUNCTION public.fn_trg_audit_inventaire_statut();


--
-- Name: ligne_qualite trg_audit_ligne_qualite; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_ligne_qualite AFTER UPDATE OF densite ON public.ligne_qualite FOR EACH ROW WHEN ((old.densite IS DISTINCT FROM new.densite)) EXECUTE FUNCTION public.fn_trg_audit_ligne_qualite();


--
-- Name: bon_commande trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER UPDATE ON public.bon_commande FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification('statut');


--
-- Name: demande_autorisation trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON public.demande_autorisation FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: dossier_lignes_frais trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER INSERT OR DELETE OR UPDATE ON public.dossier_lignes_frais FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: import_dossiers trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER UPDATE ON public.import_dossiers FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: import_facture_lignes trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON public.import_facture_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification('quantite_recue_kg');


--
-- Name: import_factures trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON public.import_factures FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: import_reception_lignes trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER INSERT OR DELETE OR UPDATE ON public.import_reception_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: import_receptions trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON public.import_receptions FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: ligne_bc trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON public.ligne_bc FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: lot trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER UPDATE ON public.lot FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification('date_derniere_activite');


--
-- Name: plan_achat trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER UPDATE OF statut ON public.plan_achat FOR EACH ROW WHEN ((old.statut IS DISTINCT FROM new.statut)) EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: reception trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER UPDATE ON public.reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification('statut');


--
-- Name: taux_change trg_audit_modification; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_modification AFTER INSERT OR UPDATE ON public.taux_change FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: mouvement trg_audit_mouvement; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_mouvement AFTER INSERT ON public.mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_mouvement();


--
-- Name: parametre trg_audit_parametre; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_parametre AFTER UPDATE ON public.parametre FOR EACH ROW WHEN ((old.valeur_courante IS DISTINCT FROM new.valeur_courante)) EXECUTE FUNCTION public.fn_trg_audit_parametre();


--
-- Name: permission trg_audit_permission_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_permission_d AFTER DELETE ON public.permission FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_permission_d();


--
-- Name: permission trg_audit_permission_i; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_permission_i AFTER INSERT ON public.permission FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_permission_i();


--
-- Name: plan_achat trg_audit_plan_achat_figement; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_plan_achat_figement AFTER UPDATE OF figee ON public.plan_achat FOR EACH ROW WHEN ((old.figee IS DISTINCT FROM new.figee)) EXECUTE FUNCTION public.fn_trg_audit_plan_achat_figement();


--
-- Name: plan_production trg_audit_plan_statut; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_plan_statut AFTER UPDATE OF statut ON public.plan_production FOR EACH ROW WHEN ((old.statut IS DISTINCT FROM new.statut)) EXECUTE FUNCTION public.fn_trg_audit_plan_statut();


--
-- Name: qualite trg_audit_qualite_statut; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_qualite_statut AFTER UPDATE OF statut ON public.qualite FOR EACH ROW WHEN ((old.statut IS DISTINCT FROM new.statut)) EXECUTE FUNCTION public.fn_trg_audit_qualite_statut();


--
-- Name: reception trg_audit_reception_statut; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_reception_statut AFTER UPDATE OF statut ON public.reception FOR EACH ROW WHEN ((old.statut IS DISTINCT FROM new.statut)) EXECUTE FUNCTION public.fn_trg_audit_reception_statut();


--
-- Name: recette trg_audit_recette_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_recette_d AFTER DELETE ON public.recette FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_recette_d();


--
-- Name: recette trg_audit_recette_i; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_recette_i AFTER INSERT ON public.recette FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_recette_i();


--
-- Name: recette trg_audit_recette_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_recette_u AFTER UPDATE ON public.recette FOR EACH ROW WHEN (((old.pourcentage_composition IS DISTINCT FROM new.pourcentage_composition) OR (old.code_reference IS DISTINCT FROM new.code_reference))) EXECUTE FUNCTION public.fn_trg_audit_recette_u();


--
-- Name: reference trg_audit_reference; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_reference AFTER UPDATE ON public.reference FOR EACH ROW WHEN (((old.prix_catalogue IS DISTINCT FROM new.prix_catalogue) OR (old.code_fournisseur IS DISTINCT FROM new.code_fournisseur) OR (old.actif IS DISTINCT FROM new.actif))) EXECUTE FUNCTION public.fn_trg_audit_reference();


--
-- Name: bon_commande trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.bon_commande FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: categorie_matiere trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.categorie_matiere FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: champ_configurable trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.champ_configurable FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: couleur trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.couleur FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: couleur_fournisseur trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.couleur_fournisseur FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: famille trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.famille FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: fournisseur trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.fournisseur FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: import_dossiers trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.import_dossiers FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: import_facture_lignes trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.import_facture_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: import_factures trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.import_factures FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: import_receptions trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.import_receptions FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: inventaire trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.inventaire FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: ligne_bc trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.ligne_bc FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: ligne_inventaire trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.ligne_inventaire FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: ligne_mouvement trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: ligne_plan_production trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.ligne_plan_production FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: ligne_qualite trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.ligne_qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: ligne_reception trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.ligne_reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: ligne_transfert trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.ligne_transfert FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: machine trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.machine FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: machine_emplacement trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.machine_emplacement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: machine_fiche trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.machine_fiche FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: machine_fiche_ligne trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.machine_fiche_ligne FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: magasin trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.magasin FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: motif_ligne trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.motif_ligne FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: motif_mouvement trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.motif_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: mouvement trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: parametre trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.parametre FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: permission trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.permission FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: plan_production trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.plan_production FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: plan_qualite trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.plan_qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: plan_saisonnalite trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.plan_saisonnalite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: qualite trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: reception trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: recette trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.recette FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: reference trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.reference FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: reference_groupe_equiv trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.reference_groupe_equiv FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: role_bom trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.role_bom FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: taux_change trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.taux_change FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: transfert trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.transfert FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: type_mouvement trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.type_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: utilisateur trg_audit_suppression; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression BEFORE DELETE ON public.utilisateur FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_suppression();


--
-- Name: plan_achat trg_audit_suppression_plan_achat; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_suppression_plan_achat AFTER DELETE ON public.plan_achat FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_modification();


--
-- Name: transfert trg_audit_transfert_i; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_transfert_i AFTER INSERT ON public.transfert FOR EACH ROW EXECUTE FUNCTION public.fn_trg_audit_transfert_i();


--
-- Name: transfert trg_audit_transfert_statut; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_transfert_statut AFTER UPDATE OF statut ON public.transfert FOR EACH ROW WHEN ((old.statut IS DISTINCT FROM new.statut)) EXECUTE FUNCTION public.fn_trg_audit_transfert_statut();


--
-- Name: utilisateur trg_audit_utilisateur; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_audit_utilisateur AFTER UPDATE ON public.utilisateur FOR EACH ROW WHEN (((old.code_role_user IS DISTINCT FROM new.code_role_user) OR (old.actif IS DISTINCT FROM new.actif))) EXECUTE FUNCTION public.fn_trg_audit_utilisateur();


--
-- Name: bon_commande trg_bc_separation_taches; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_bc_separation_taches BEFORE INSERT OR UPDATE ON public.bon_commande FOR EACH ROW EXECUTE FUNCTION public.fn_trg_bc_separation_taches();


--
-- Name: machine_emplacement trg_empl_numero; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_empl_numero BEFORE INSERT OR UPDATE ON public.machine_emplacement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_empl_numero();


--
-- Name: historique_prix trg_histo_prix_immuable_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_histo_prix_immuable_d BEFORE DELETE ON public.historique_prix FOR EACH ROW EXECUTE FUNCTION public.fn_trg_histo_prix_immuable_d();


--
-- Name: historique_prix trg_histo_prix_immuable_r; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_histo_prix_immuable_r BEFORE INSERT ON public.historique_prix FOR EACH ROW EXECUTE FUNCTION public.fn_trg_histo_prix_immuable_r();


--
-- Name: historique_prix trg_histo_prix_immuable_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_histo_prix_immuable_u BEFORE UPDATE ON public.historique_prix FOR EACH ROW EXECUTE FUNCTION public.fn_trg_histo_prix_immuable_u();


--
-- Name: import_ajustements_cump trg_iac_immuable; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_iac_immuable BEFORE DELETE OR UPDATE ON public.import_ajustements_cump FOR EACH ROW EXECUTE FUNCTION public.fn_trg_iac_immuable();


--
-- Name: import_facture_lignes trg_ifl_bc; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_ifl_bc BEFORE INSERT OR UPDATE OF id_ligne_bc, code_reference ON public.import_facture_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ifl_bc();


--
-- Name: dossier_lignes_frais_cibles trg_import_cibles_verrou; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_cibles_verrou BEFORE INSERT OR DELETE OR UPDATE ON public.dossier_lignes_frais_cibles FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_verrou();


--
-- Name: import_dossiers trg_import_dossier_garde; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_dossier_garde BEFORE DELETE OR UPDATE ON public.import_dossiers FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_dossier_garde();


--
-- Name: import_factures trg_import_facture_engagement; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_facture_engagement BEFORE INSERT OR UPDATE OF id_engagement, code_fournisseur ON public.import_factures FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_facture_engagement();


--
-- Name: import_factures trg_import_facture_figee; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_facture_figee BEFORE UPDATE ON public.import_factures FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_facture_figee();


--
-- Name: import_factures trg_import_factures_verrou; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_factures_verrou BEFORE INSERT OR DELETE OR UPDATE ON public.import_factures FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_verrou();


--
-- Name: dossier_lignes_frais trg_import_frais_verrou; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_frais_verrou BEFORE INSERT OR DELETE OR UPDATE ON public.dossier_lignes_frais FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_verrou();


--
-- Name: import_facture_lignes trg_import_hors_reception_locale; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_hors_reception_locale BEFORE INSERT OR UPDATE OF id_ligne_bc ON public.import_facture_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_hors_reception_locale();


--
-- Name: import_facture_lignes trg_import_ligne_figee; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_ligne_figee BEFORE UPDATE ON public.import_facture_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_ligne_figee();


--
-- Name: import_facture_lignes trg_import_lignes_verrou; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_lignes_verrou BEFORE INSERT OR DELETE OR UPDATE ON public.import_facture_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_verrou();


--
-- Name: import_receptions trg_import_reception_segregation; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_reception_segregation BEFORE UPDATE OF statut ON public.import_receptions FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_reception_segregation();


--
-- Name: lignes_frais_repartition trg_import_repartition_verrou; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_import_repartition_verrou BEFORE INSERT OR DELETE OR UPDATE ON public.lignes_frais_repartition FOR EACH ROW EXECUTE FUNCTION public.fn_trg_import_verrou();


--
-- Name: import_reception_lignes trg_irl_coherence; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_irl_coherence BEFORE INSERT OR UPDATE OF id_ligne, id_reception ON public.import_reception_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_irl_coherence();


--
-- Name: import_reception_lignes trg_irl_quarantaine; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_irl_quarantaine BEFORE INSERT OR UPDATE OF statut_qualite, code_magasin ON public.import_reception_lignes FOR EACH ROW EXECUTE FUNCTION public.fn_trg_irl_quarantaine();


--
-- Name: ligne_reception trg_ligne_reception_ecart; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_ligne_reception_ecart BEFORE INSERT OR UPDATE OF quantite_stock_kg, quantite_commandee_kg, derogation_ecart ON public.ligne_reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ligne_reception_ecart();


--
-- Name: ligne_reception trg_ligne_reception_quarantaine; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_ligne_reception_quarantaine BEFORE INSERT ON public.ligne_reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ligne_reception_quarantaine();


--
-- Name: ligne_reception trg_ligne_reception_substitution; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_ligne_reception_substitution BEFORE INSERT ON public.ligne_reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ligne_reception_substitution();


--
-- Name: ligne_mouvement trg_lmvt_appliquer; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_appliquer AFTER INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_appliquer();


--
-- Name: ligne_mouvement trg_lmvt_capacite; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_capacite BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_capacite();


--
-- Name: ligne_mouvement trg_lmvt_immuable_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_immuable_d BEFORE DELETE ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_immuable_d();


--
-- Name: ligne_mouvement trg_lmvt_immuable_r; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_immuable_r BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_immuable_r();


--
-- Name: ligne_mouvement trg_lmvt_immuable_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_immuable_u BEFORE UPDATE ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_immuable_u();


--
-- Name: ligne_mouvement trg_lmvt_lot_controle; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_lot_controle BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_lot_controle();


--
-- Name: ligne_mouvement trg_lmvt_lot_registre; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_lot_registre AFTER INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_lot_registre();


--
-- Name: ligne_mouvement trg_lmvt_lot_requis; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_lot_requis BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_lot_requis();


--
-- Name: ligne_mouvement trg_lmvt_motif_requis; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_motif_requis BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_motif_requis();


--
-- Name: ligne_mouvement trg_lmvt_of_requis; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_of_requis BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_of_requis();


--
-- Name: ligne_mouvement trg_lmvt_prix_requis; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_prix_requis BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_prix_requis();


--
-- Name: ligne_mouvement trg_lmvt_stock_lot_suffisant; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_stock_lot_suffisant BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_stock_lot_suffisant();


--
-- Name: ligne_mouvement trg_lmvt_stock_suffisant; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lmvt_stock_suffisant BEFORE INSERT ON public.ligne_mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_lmvt_stock_suffisant();


--
-- Name: stock_lot trg_lot_plancher; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_lot_plancher BEFORE INSERT OR UPDATE ON public.stock_lot FOR EACH ROW EXECUTE FUNCTION public.fn_lot_plancher();


--
-- Name: machine_decision_etat trg_machine_decision_etat_immuable; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_machine_decision_etat_immuable BEFORE DELETE OR UPDATE ON public.machine_decision_etat FOR EACH ROW EXECUTE FUNCTION public.fn_trg_machine_historique_immuable();


--
-- Name: machine_decision_ligne trg_machine_decision_ligne_immuable; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_machine_decision_ligne_immuable BEFORE DELETE OR UPDATE ON public.machine_decision_ligne FOR EACH ROW EXECUTE FUNCTION public.fn_trg_machine_historique_immuable();


--
-- Name: machine_decision trg_machine_decision_maj; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_machine_decision_maj BEFORE DELETE OR UPDATE ON public.machine_decision FOR EACH ROW EXECUTE FUNCTION public.fn_trg_machine_decision_maj();


--
-- Name: machine_fiche_journal trg_machine_fiche_journal_immuable; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_machine_fiche_journal_immuable BEFORE DELETE OR UPDATE ON public.machine_fiche_journal FOR EACH ROW EXECUTE FUNCTION public.fn_trg_machine_historique_immuable();


--
-- Name: machine trg_machine_nb_etages; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_machine_nb_etages BEFORE UPDATE OF nb_etages ON public.machine FOR EACH ROW EXECUTE FUNCTION public.fn_trg_machine_nb_etages();


--
-- Name: mouvement trg_mouvement_date_future; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_mouvement_date_future BEFORE INSERT ON public.mouvement FOR EACH ROW WHEN ((new.date_mouvement > to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text))) EXECUTE FUNCTION public.fn_refuser('C06 : un mouvement ne peut pas etre date dans le futur.');


--
-- Name: mouvement trg_mouvement_immuable_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_mouvement_immuable_d BEFORE DELETE ON public.mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_mouvement_immuable_d();


--
-- Name: mouvement trg_mouvement_immuable_r; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_mouvement_immuable_r BEFORE INSERT ON public.mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_mouvement_immuable_r();


--
-- Name: mouvement trg_mouvement_immuable_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_mouvement_immuable_u BEFORE UPDATE ON public.mouvement FOR EACH ROW EXECUTE FUNCTION public.fn_trg_mouvement_immuable_u();


--
-- Name: parametre_historique trg_param_histo_immuable_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_param_histo_immuable_d BEFORE DELETE ON public.parametre_historique FOR EACH ROW EXECUTE FUNCTION public.fn_trg_param_histo_immuable_d();


--
-- Name: parametre_historique trg_param_histo_immuable_r; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_param_histo_immuable_r BEFORE INSERT ON public.parametre_historique FOR EACH ROW EXECUTE FUNCTION public.fn_trg_param_histo_immuable_r();


--
-- Name: parametre_historique trg_param_histo_immuable_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_param_histo_immuable_u BEFORE UPDATE ON public.parametre_historique FOR EACH ROW EXECUTE FUNCTION public.fn_trg_param_histo_immuable_u();


--
-- Name: parametre trg_parametre_historiser; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_parametre_historiser BEFORE UPDATE OF valeur_courante ON public.parametre FOR EACH ROW WHEN ((old.valeur_courante IS DISTINCT FROM new.valeur_courante)) EXECUTE FUNCTION public.fn_trg_parametre_historiser();


--
-- Name: parametre trg_parametre_verrouille; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_parametre_verrouille BEFORE UPDATE OF valeur_courante ON public.parametre FOR EACH ROW WHEN (((old.verrouille = 1) AND (old.valeur_courante IS DISTINCT FROM new.valeur_courante))) EXECUTE FUNCTION public.fn_refuser('Parametre verrouille : sa valeur est figee et ne peut pas etre modifiee.');


--
-- Name: parametres_frais trg_pf_coherence; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_pf_coherence BEFORE INSERT OR UPDATE OF recuperable, inclus_dans_cout ON public.parametres_frais FOR EACH ROW EXECUTE FUNCTION public.fn_trg_pf_coherence();


--
-- Name: piece_jointe trg_piece_verrou; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_piece_verrou BEFORE INSERT OR DELETE OR UPDATE ON public.piece_jointe FOR EACH ROW EXECUTE FUNCTION public.fn_trg_piece_verrou();


--
-- Name: plan_achat trg_plan_achat_date_ecartee; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_plan_achat_date_ecartee BEFORE UPDATE OF statut ON public.plan_achat FOR EACH ROW EXECUTE FUNCTION public.fn_trg_plan_achat_date_ecartee();


--
-- Name: plan_achat trg_plan_achat_figement_statut; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_plan_achat_figement_statut BEFORE UPDATE OF figee ON public.plan_achat FOR EACH ROW WHEN (((new.figee = 1) AND (new.statut = ANY (ARRAY['COMMANDE'::text, 'IGNORE'::text])))) EXECUTE FUNCTION public.fn_refuser('Figement refuse : cette proposition est deja commandee ou ecartee.');


--
-- Name: plan_achat trg_plan_achat_figement_trace; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_plan_achat_figement_trace BEFORE UPDATE OF figee ON public.plan_achat FOR EACH ROW WHEN (((new.figee = 1) AND ((new.id_utilisateur_figement IS NULL) OR (new.date_figement IS NULL)))) EXECUTE FUNCTION public.fn_refuser('Figement refuse : une proposition figee doit porter son auteur et sa date.');


--
-- Name: plan_qualite trg_plan_qualite_active_i; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_plan_qualite_active_i BEFORE INSERT ON public.plan_qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_plan_qualite_active_i();


--
-- Name: plan_qualite trg_plan_qualite_active_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_plan_qualite_active_u BEFORE UPDATE OF code_qualite ON public.plan_qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_plan_qualite_active_u();


--
-- Name: plan_qualite trg_plan_qualite_exclusive_i; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_plan_qualite_exclusive_i BEFORE INSERT ON public.plan_qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_plan_qualite_exclusive_i();


--
-- Name: plan_qualite trg_plan_qualite_exclusive_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_plan_qualite_exclusive_u BEFORE UPDATE OF code_qualite, id_plan ON public.plan_qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_plan_qualite_exclusive_u();


--
-- Name: plan_production trg_plan_valider_recettes; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_plan_valider_recettes BEFORE UPDATE OF statut ON public.plan_production FOR EACH ROW EXECUTE FUNCTION public.fn_trg_plan_valider_recettes();


--
-- Name: qualite trg_qualite_activer_densite_ml; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_qualite_activer_densite_ml BEFORE UPDATE OF statut ON public.qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_qualite_activer_densite_ml();


--
-- Name: qualite trg_qualite_activer_non_vide; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_qualite_activer_non_vide BEFORE UPDATE OF statut ON public.qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_qualite_activer_non_vide();


--
-- Name: qualite trg_qualite_activer_roles; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_qualite_activer_roles BEFORE UPDATE OF statut ON public.qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_qualite_activer_roles();


--
-- Name: qualite trg_qualite_activer_somme; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_qualite_activer_somme BEFORE UPDATE OF statut ON public.qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_qualite_activer_somme();


--
-- Name: reception_ajustements_cmup trg_rec_ajust_immuable; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_rec_ajust_immuable BEFORE DELETE OR UPDATE ON public.reception_ajustements_cmup FOR EACH ROW EXECUTE FUNCTION public.fn_refuser('Le journal des ajustements de CMUP d''une reception est immuable.');


--
-- Name: ligne_reception trg_reception_locale_hors_import; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_reception_locale_hors_import BEFORE INSERT OR UPDATE OF id_ligne_bc ON public.ligne_reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_reception_locale_hors_import();


--
-- Name: reception trg_reception_sod_acheteur; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_reception_sod_acheteur BEFORE UPDATE OF statut ON public.reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_reception_sod_acheteur();


--
-- Name: recette trg_recette_verrou_plan_d; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_recette_verrou_plan_d BEFORE DELETE ON public.recette FOR EACH ROW EXECUTE FUNCTION public.fn_trg_recette_verrou_plan_d();


--
-- Name: recette trg_recette_verrou_plan_i; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_recette_verrou_plan_i BEFORE INSERT ON public.recette FOR EACH ROW EXECUTE FUNCTION public.fn_trg_recette_verrou_plan_i();


--
-- Name: recette trg_recette_verrou_plan_u; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_recette_verrou_plan_u BEFORE UPDATE ON public.recette FOR EACH ROW EXECUTE FUNCTION public.fn_trg_recette_verrou_plan_u();


--
-- Name: reference trg_reference_cmup; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_reference_cmup AFTER UPDATE OF prix_catalogue, code_devise_catalogue, unite_catalogue, poids_bobine_kg, bobines_par_palette, bobines_par_lot, densite_kg_ml ON public.reference FOR EACH ROW EXECUTE FUNCTION public.fn_trg_reference_cmup();


--
-- Name: taux_change trg_taux_change_chevauchement; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_taux_change_chevauchement BEFORE INSERT ON public.taux_change FOR EACH ROW EXECUTE FUNCTION public.fn_trg_taux_change_chevauchement();


--
-- Name: taux_change trg_taux_cmup; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_taux_cmup AFTER INSERT OR UPDATE OF taux, date_debut, date_fin ON public.taux_change FOR EACH ROW EXECUTE FUNCTION public.fn_trg_taux_cmup();


--
-- Name: taux_change trg_taux_pivot; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_taux_pivot BEFORE INSERT ON public.taux_change FOR EACH ROW EXECUTE FUNCTION public.fn_trg_taux_pivot();


--
-- Name: bon_commande trg_transition_bc; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_transition_bc BEFORE UPDATE OF statut ON public.bon_commande FOR EACH ROW EXECUTE FUNCTION public.fn_trg_transition_bc();


--
-- Name: inventaire trg_transition_inventaire; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_transition_inventaire BEFORE UPDATE OF statut ON public.inventaire FOR EACH ROW EXECUTE FUNCTION public.fn_trg_transition_inventaire();


--
-- Name: plan_production trg_transition_plan; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_transition_plan BEFORE UPDATE OF statut ON public.plan_production FOR EACH ROW EXECUTE FUNCTION public.fn_trg_transition_plan();


--
-- Name: qualite trg_transition_qualite; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_transition_qualite BEFORE UPDATE OF statut ON public.qualite FOR EACH ROW EXECUTE FUNCTION public.fn_trg_transition_qualite();


--
-- Name: reception trg_transition_reception; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_transition_reception BEFORE UPDATE OF statut ON public.reception FOR EACH ROW EXECUTE FUNCTION public.fn_trg_transition_reception();


--
-- Name: transfert trg_transition_transfert; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_transition_transfert BEFORE UPDATE OF statut ON public.transfert FOR EACH ROW EXECUTE FUNCTION public.fn_trg_transition_transfert();


--
-- Name: utilisateur trg_utilisateur_mdp_change; Type: TRIGGER; Schema: public; Owner: gestionfil
--

CREATE TRIGGER trg_utilisateur_mdp_change BEFORE UPDATE OF mot_de_passe_hash, secret_totp ON public.utilisateur FOR EACH ROW EXECUTE FUNCTION public.fn_trg_utilisateur_mdp_change();


--
-- Name: alerte alerte_code_role_destinataire_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.alerte
    ADD CONSTRAINT alerte_code_role_destinataire_fkey FOREIGN KEY (code_role_destinataire) REFERENCES public.role_utilisateur(code_role_user);


--
-- Name: alerte alerte_id_utilisateur_acquittement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.alerte
    ADD CONSTRAINT alerte_id_utilisateur_acquittement_fkey FOREIGN KEY (id_utilisateur_acquittement) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: archive_reception archive_reception_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.archive_reception
    ADD CONSTRAINT archive_reception_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: archive_reception archive_reception_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.archive_reception
    ADD CONSTRAINT archive_reception_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: archive_reception archive_reception_id_utilisateur_archive_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.archive_reception
    ADD CONSTRAINT archive_reception_id_utilisateur_archive_fkey FOREIGN KEY (id_utilisateur_archive) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: besoin_mrp besoin_mrp_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.besoin_mrp
    ADD CONSTRAINT besoin_mrp_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: besoin_mrp besoin_mrp_id_plan_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.besoin_mrp
    ADD CONSTRAINT besoin_mrp_id_plan_fkey FOREIGN KEY (id_plan) REFERENCES public.plan_production(id_plan) ON DELETE CASCADE;


--
-- Name: bon_commande bon_commande_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.bon_commande
    ADD CONSTRAINT bon_commande_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: bon_commande bon_commande_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.bon_commande
    ADD CONSTRAINT bon_commande_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: bon_commande bon_commande_id_utilisateur_creation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.bon_commande
    ADD CONSTRAINT bon_commande_id_utilisateur_creation_fkey FOREIGN KEY (id_utilisateur_creation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: bon_commande bon_commande_id_utilisateur_validation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.bon_commande
    ADD CONSTRAINT bon_commande_id_utilisateur_validation_fkey FOREIGN KEY (id_utilisateur_validation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: contact_fournisseur contact_fournisseur_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.contact_fournisseur
    ADD CONSTRAINT contact_fournisseur_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur) ON DELETE CASCADE;


--
-- Name: couleur_fournisseur couleur_fournisseur_code_couleur_interne_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.couleur_fournisseur
    ADD CONSTRAINT couleur_fournisseur_code_couleur_interne_fkey FOREIGN KEY (code_couleur_interne) REFERENCES public.couleur(code_couleur_interne) ON DELETE CASCADE;


--
-- Name: couleur_fournisseur couleur_fournisseur_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.couleur_fournisseur
    ADD CONSTRAINT couleur_fournisseur_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: cours_bam cours_bam_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.cours_bam
    ADD CONSTRAINT cours_bam_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: dossier_lignes_frais_cibles dossier_lignes_frais_cibles_id_ligne_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.dossier_lignes_frais_cibles
    ADD CONSTRAINT dossier_lignes_frais_cibles_id_ligne_fkey FOREIGN KEY (id_ligne) REFERENCES public.import_facture_lignes(id_ligne) ON DELETE CASCADE;


--
-- Name: dossier_lignes_frais_cibles dossier_lignes_frais_cibles_id_ligne_frais_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.dossier_lignes_frais_cibles
    ADD CONSTRAINT dossier_lignes_frais_cibles_id_ligne_frais_fkey FOREIGN KEY (id_ligne_frais) REFERENCES public.dossier_lignes_frais(id_ligne_frais) ON DELETE CASCADE;


--
-- Name: dossier_lignes_frais dossier_lignes_frais_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.dossier_lignes_frais
    ADD CONSTRAINT dossier_lignes_frais_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: dossier_lignes_frais dossier_lignes_frais_id_dossier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.dossier_lignes_frais
    ADD CONSTRAINT dossier_lignes_frais_id_dossier_fkey FOREIGN KEY (id_dossier) REFERENCES public.import_dossiers(id_dossier) ON DELETE CASCADE;


--
-- Name: dossier_lignes_frais dossier_lignes_frais_id_frais_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.dossier_lignes_frais
    ADD CONSTRAINT dossier_lignes_frais_id_frais_fkey FOREIGN KEY (id_frais) REFERENCES public.parametres_frais(id_frais);


--
-- Name: dossier_lignes_frais dossier_lignes_frais_id_utilisateur_creation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.dossier_lignes_frais
    ADD CONSTRAINT dossier_lignes_frais_id_utilisateur_creation_fkey FOREIGN KEY (id_utilisateur_creation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: droit_champ droit_champ_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.droit_champ
    ADD CONSTRAINT droit_champ_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur) ON DELETE CASCADE;


--
-- Name: droit_champ droit_champ_id_utilisateur_modif_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.droit_champ
    ADD CONSTRAINT droit_champ_id_utilisateur_modif_fkey FOREIGN KEY (id_utilisateur_modif) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: droit_champ droit_champ_module_champ_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.droit_champ
    ADD CONSTRAINT droit_champ_module_champ_fkey FOREIGN KEY (module, champ) REFERENCES public.champ_configurable(module, champ) ON DELETE CASCADE;


--
-- Name: famille famille_code_categorie_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.famille
    ADD CONSTRAINT famille_code_categorie_fkey FOREIGN KEY (code_categorie) REFERENCES public.categorie_matiere(code_categorie);


--
-- Name: categorie_matiere fk_categorie_matiere_code_role_defaut; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.categorie_matiere
    ADD CONSTRAINT fk_categorie_matiere_code_role_defaut FOREIGN KEY (code_role_defaut) REFERENCES public.role_bom(code_role);


--
-- Name: ligne_bc fk_ligne_bc_id_proposition; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_bc
    ADD CONSTRAINT fk_ligne_bc_id_proposition FOREIGN KEY (id_proposition) REFERENCES public.plan_achat(id_proposition);


--
-- Name: ligne_reception fk_ligne_reception_id_mouvement_genere; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT fk_ligne_reception_id_mouvement_genere FOREIGN KEY (id_mouvement_genere) REFERENCES public.mouvement(id_mouvement);


--
-- Name: fournisseur fournisseur_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.fournisseur
    ADD CONSTRAINT fournisseur_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: frais_approche frais_approche_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.frais_approche
    ADD CONSTRAINT frais_approche_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: frais_approche frais_approche_id_reception_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.frais_approche
    ADD CONSTRAINT frais_approche_id_reception_fkey FOREIGN KEY (id_reception) REFERENCES public.reception(id_reception);


--
-- Name: frais_approche frais_approche_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.frais_approche
    ADD CONSTRAINT frais_approche_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: historique_conditionnement historique_conditionnement_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.historique_conditionnement
    ADD CONSTRAINT historique_conditionnement_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: historique_prix historique_prix_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.historique_prix
    ADD CONSTRAINT historique_prix_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: historique_prix historique_prix_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.historique_prix
    ADD CONSTRAINT historique_prix_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: historique_prix historique_prix_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.historique_prix
    ADD CONSTRAINT historique_prix_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: import_ajustements_cump import_ajustements_cump_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_ajustements_cump
    ADD CONSTRAINT import_ajustements_cump_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: import_ajustements_cump import_ajustements_cump_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_ajustements_cump
    ADD CONSTRAINT import_ajustements_cump_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: import_ajustements_cump import_ajustements_cump_id_dossier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_ajustements_cump
    ADD CONSTRAINT import_ajustements_cump_id_dossier_fkey FOREIGN KEY (id_dossier) REFERENCES public.import_dossiers(id_dossier);


--
-- Name: import_ajustements_cump import_ajustements_cump_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_ajustements_cump
    ADD CONSTRAINT import_ajustements_cump_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: import_dossiers import_dossiers_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_dossiers
    ADD CONSTRAINT import_dossiers_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: import_dossiers import_dossiers_id_utilisateur_cloture_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_dossiers
    ADD CONSTRAINT import_dossiers_id_utilisateur_cloture_fkey FOREIGN KEY (id_utilisateur_cloture) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: import_dossiers import_dossiers_id_utilisateur_creation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_dossiers
    ADD CONSTRAINT import_dossiers_id_utilisateur_creation_fkey FOREIGN KEY (id_utilisateur_creation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: import_engagements import_engagements_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_engagements
    ADD CONSTRAINT import_engagements_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: import_engagements import_engagements_id_dossier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_engagements
    ADD CONSTRAINT import_engagements_id_dossier_fkey FOREIGN KEY (id_dossier) REFERENCES public.import_dossiers(id_dossier) ON DELETE CASCADE;


--
-- Name: import_facture_lignes import_facture_lignes_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_facture_lignes
    ADD CONSTRAINT import_facture_lignes_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: import_facture_lignes import_facture_lignes_id_facture_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_facture_lignes
    ADD CONSTRAINT import_facture_lignes_id_facture_fkey FOREIGN KEY (id_facture) REFERENCES public.import_factures(id_facture) ON DELETE CASCADE;


--
-- Name: import_facture_lignes import_facture_lignes_id_ligne_bc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_facture_lignes
    ADD CONSTRAINT import_facture_lignes_id_ligne_bc_fkey FOREIGN KEY (id_ligne_bc) REFERENCES public.ligne_bc(id_ligne_bc);


--
-- Name: import_factures import_factures_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_factures
    ADD CONSTRAINT import_factures_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: import_factures import_factures_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_factures
    ADD CONSTRAINT import_factures_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: import_factures import_factures_id_dossier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_factures
    ADD CONSTRAINT import_factures_id_dossier_fkey FOREIGN KEY (id_dossier) REFERENCES public.import_dossiers(id_dossier) ON DELETE CASCADE;


--
-- Name: import_factures import_factures_id_engagement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_factures
    ADD CONSTRAINT import_factures_id_engagement_fkey FOREIGN KEY (id_engagement) REFERENCES public.import_engagements(id_engagement) ON DELETE SET NULL;


--
-- Name: import_factures import_factures_id_utilisateur_creation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_factures
    ADD CONSTRAINT import_factures_id_utilisateur_creation_fkey FOREIGN KEY (id_utilisateur_creation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: import_reception_lignes import_reception_lignes_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_reception_lignes
    ADD CONSTRAINT import_reception_lignes_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: import_reception_lignes import_reception_lignes_id_ligne_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_reception_lignes
    ADD CONSTRAINT import_reception_lignes_id_ligne_fkey FOREIGN KEY (id_ligne) REFERENCES public.import_facture_lignes(id_ligne);


--
-- Name: import_reception_lignes import_reception_lignes_id_mouvement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_reception_lignes
    ADD CONSTRAINT import_reception_lignes_id_mouvement_fkey FOREIGN KEY (id_mouvement) REFERENCES public.mouvement(id_mouvement);


--
-- Name: import_reception_lignes import_reception_lignes_id_reception_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_reception_lignes
    ADD CONSTRAINT import_reception_lignes_id_reception_fkey FOREIGN KEY (id_reception) REFERENCES public.import_receptions(id_reception) ON DELETE CASCADE;


--
-- Name: import_reception_lignes import_reception_lignes_id_utilisateur_derogation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_reception_lignes
    ADD CONSTRAINT import_reception_lignes_id_utilisateur_derogation_fkey FOREIGN KEY (id_utilisateur_derogation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: import_receptions import_receptions_id_utilisateur_creation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_receptions
    ADD CONSTRAINT import_receptions_id_utilisateur_creation_fkey FOREIGN KEY (id_utilisateur_creation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: import_receptions import_receptions_id_utilisateur_validation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.import_receptions
    ADD CONSTRAINT import_receptions_id_utilisateur_validation_fkey FOREIGN KEY (id_utilisateur_validation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: inventaire inventaire_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.inventaire
    ADD CONSTRAINT inventaire_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: inventaire inventaire_id_utilisateur_annulation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.inventaire
    ADD CONSTRAINT inventaire_id_utilisateur_annulation_fkey FOREIGN KEY (id_utilisateur_annulation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: inventaire inventaire_id_utilisateur_responsable_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.inventaire
    ADD CONSTRAINT inventaire_id_utilisateur_responsable_fkey FOREIGN KEY (id_utilisateur_responsable) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: journal_connexion journal_connexion_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.journal_connexion
    ADD CONSTRAINT journal_connexion_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: ligne_bc ligne_bc_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_bc
    ADD CONSTRAINT ligne_bc_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: ligne_bc ligne_bc_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_bc
    ADD CONSTRAINT ligne_bc_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: ligne_bc ligne_bc_id_bc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_bc
    ADD CONSTRAINT ligne_bc_id_bc_fkey FOREIGN KEY (id_bc) REFERENCES public.bon_commande(id_bc) ON DELETE CASCADE;


--
-- Name: ligne_inventaire ligne_inventaire_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_inventaire
    ADD CONSTRAINT ligne_inventaire_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: ligne_inventaire ligne_inventaire_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_inventaire
    ADD CONSTRAINT ligne_inventaire_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: ligne_inventaire ligne_inventaire_id_inventaire_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_inventaire
    ADD CONSTRAINT ligne_inventaire_id_inventaire_fkey FOREIGN KEY (id_inventaire) REFERENCES public.inventaire(id_inventaire) ON DELETE CASCADE;


--
-- Name: ligne_inventaire ligne_inventaire_id_utilisateur_comptage_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_inventaire
    ADD CONSTRAINT ligne_inventaire_id_utilisateur_comptage_fkey FOREIGN KEY (id_utilisateur_comptage) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: ligne_mouvement ligne_mouvement_code_motif_ligne_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_mouvement
    ADD CONSTRAINT ligne_mouvement_code_motif_ligne_fkey FOREIGN KEY (code_motif_ligne) REFERENCES public.motif_ligne(code_motif_ligne);


--
-- Name: ligne_mouvement ligne_mouvement_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_mouvement
    ADD CONSTRAINT ligne_mouvement_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: ligne_mouvement ligne_mouvement_id_mouvement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_mouvement
    ADD CONSTRAINT ligne_mouvement_id_mouvement_fkey FOREIGN KEY (id_mouvement) REFERENCES public.mouvement(id_mouvement) ON DELETE CASCADE;


--
-- Name: ligne_plan_production ligne_plan_production_code_qualite_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_plan_production
    ADD CONSTRAINT ligne_plan_production_code_qualite_fkey FOREIGN KEY (code_qualite) REFERENCES public.qualite(code_qualite);


--
-- Name: ligne_plan_production ligne_plan_production_id_plan_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_plan_production
    ADD CONSTRAINT ligne_plan_production_id_plan_fkey FOREIGN KEY (id_plan) REFERENCES public.plan_production(id_plan) ON DELETE CASCADE;


--
-- Name: ligne_qualite ligne_qualite_code_qualite_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_qualite
    ADD CONSTRAINT ligne_qualite_code_qualite_fkey FOREIGN KEY (code_qualite) REFERENCES public.qualite(code_qualite) ON DELETE CASCADE;


--
-- Name: ligne_qualite ligne_qualite_code_role_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_qualite
    ADD CONSTRAINT ligne_qualite_code_role_fkey FOREIGN KEY (code_role) REFERENCES public.role_bom(code_role);


--
-- Name: ligne_reception ligne_reception_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: ligne_reception ligne_reception_code_magasin_dest_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_code_magasin_dest_fkey FOREIGN KEY (code_magasin_dest) REFERENCES public.magasin(code_magasin);


--
-- Name: ligne_reception ligne_reception_code_motif_ligne_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_code_motif_ligne_fkey FOREIGN KEY (code_motif_ligne) REFERENCES public.motif_ligne(code_motif_ligne);


--
-- Name: ligne_reception ligne_reception_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: ligne_reception ligne_reception_id_ligne_bc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_id_ligne_bc_fkey FOREIGN KEY (id_ligne_bc) REFERENCES public.ligne_bc(id_ligne_bc);


--
-- Name: ligne_reception ligne_reception_id_reception_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_id_reception_fkey FOREIGN KEY (id_reception) REFERENCES public.reception(id_reception) ON DELETE CASCADE;


--
-- Name: ligne_reception ligne_reception_id_utilisateur_derogation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_reception
    ADD CONSTRAINT ligne_reception_id_utilisateur_derogation_fkey FOREIGN KEY (id_utilisateur_derogation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: ligne_transfert ligne_transfert_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_transfert
    ADD CONSTRAINT ligne_transfert_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: ligne_transfert ligne_transfert_id_transfert_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.ligne_transfert
    ADD CONSTRAINT ligne_transfert_id_transfert_fkey FOREIGN KEY (id_transfert) REFERENCES public.transfert(id_transfert) ON DELETE CASCADE;


--
-- Name: lignes_frais_repartition lignes_frais_repartition_id_article_dossier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.lignes_frais_repartition
    ADD CONSTRAINT lignes_frais_repartition_id_article_dossier_fkey FOREIGN KEY (id_article_dossier) REFERENCES public.import_facture_lignes(id_ligne) ON DELETE CASCADE;


--
-- Name: lignes_frais_repartition lignes_frais_repartition_id_ligne_frais_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.lignes_frais_repartition
    ADD CONSTRAINT lignes_frais_repartition_id_ligne_frais_fkey FOREIGN KEY (id_ligne_frais) REFERENCES public.dossier_lignes_frais(id_ligne_frais) ON DELETE CASCADE;


--
-- Name: lot lot_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: lot lot_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.lot
    ADD CONSTRAINT lot_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: lot_evenement lot_evenement_code_reference_lot_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.lot_evenement
    ADD CONSTRAINT lot_evenement_code_reference_lot_fournisseur_fkey FOREIGN KEY (code_reference, lot_fournisseur) REFERENCES public.lot(code_reference, lot_fournisseur);


--
-- Name: machine_cliche machine_cliche_code_emplacement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_cliche
    ADD CONSTRAINT machine_cliche_code_emplacement_fkey FOREIGN KEY (code_emplacement) REFERENCES public.machine_emplacement(code_emplacement);


--
-- Name: machine_cliche machine_cliche_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_cliche
    ADD CONSTRAINT machine_cliche_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: machine_cliche machine_cliche_id_fiche_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_cliche
    ADD CONSTRAINT machine_cliche_id_fiche_fkey FOREIGN KEY (id_fiche) REFERENCES public.machine_fiche(id_fiche) ON DELETE CASCADE;


--
-- Name: machine machine_code_atelier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine
    ADD CONSTRAINT machine_code_atelier_fkey FOREIGN KEY (code_atelier) REFERENCES public.magasin(code_magasin);


--
-- Name: machine_consommation machine_consommation_code_emplacement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_consommation
    ADD CONSTRAINT machine_consommation_code_emplacement_fkey FOREIGN KEY (code_emplacement) REFERENCES public.machine_emplacement(code_emplacement);


--
-- Name: machine_consommation machine_consommation_code_machine_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_consommation
    ADD CONSTRAINT machine_consommation_code_machine_fkey FOREIGN KEY (code_machine) REFERENCES public.machine(code_machine);


--
-- Name: machine_consommation machine_consommation_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_consommation
    ADD CONSTRAINT machine_consommation_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: machine_consommation machine_consommation_id_fiche_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_consommation
    ADD CONSTRAINT machine_consommation_id_fiche_fkey FOREIGN KEY (id_fiche) REFERENCES public.machine_fiche(id_fiche);


--
-- Name: machine_consommation machine_consommation_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_consommation
    ADD CONSTRAINT machine_consommation_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: machine_decision machine_decision_code_emplacement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision
    ADD CONSTRAINT machine_decision_code_emplacement_fkey FOREIGN KEY (code_emplacement) REFERENCES public.machine_emplacement(code_emplacement);


--
-- Name: machine_decision machine_decision_code_machine_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision
    ADD CONSTRAINT machine_decision_code_machine_fkey FOREIGN KEY (code_machine) REFERENCES public.machine(code_machine);


--
-- Name: machine_decision machine_decision_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision
    ADD CONSTRAINT machine_decision_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: machine_decision_etat machine_decision_etat_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision_etat
    ADD CONSTRAINT machine_decision_etat_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: machine_decision_etat machine_decision_etat_id_decision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision_etat
    ADD CONSTRAINT machine_decision_etat_id_decision_fkey FOREIGN KEY (id_decision) REFERENCES public.machine_decision(id_decision);


--
-- Name: machine_decision machine_decision_id_decision_precedente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision
    ADD CONSTRAINT machine_decision_id_decision_precedente_fkey FOREIGN KEY (id_decision_precedente) REFERENCES public.machine_decision(id_decision);


--
-- Name: machine_decision machine_decision_id_fiche_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision
    ADD CONSTRAINT machine_decision_id_fiche_fkey FOREIGN KEY (id_fiche) REFERENCES public.machine_fiche(id_fiche);


--
-- Name: machine_decision machine_decision_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision
    ADD CONSTRAINT machine_decision_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: machine_decision machine_decision_id_utilisateur_retrait_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision
    ADD CONSTRAINT machine_decision_id_utilisateur_retrait_fkey FOREIGN KEY (id_utilisateur_retrait) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: machine_decision_ligne machine_decision_ligne_code_motif_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision_ligne
    ADD CONSTRAINT machine_decision_ligne_code_motif_fkey FOREIGN KEY (code_motif) REFERENCES public.machine_motif(code_motif);


--
-- Name: machine_decision_ligne machine_decision_ligne_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision_ligne
    ADD CONSTRAINT machine_decision_ligne_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: machine_decision_ligne machine_decision_ligne_id_decision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision_ligne
    ADD CONSTRAINT machine_decision_ligne_id_decision_fkey FOREIGN KEY (id_decision) REFERENCES public.machine_decision(id_decision);


--
-- Name: machine_decision_ligne machine_decision_ligne_id_mouvement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_decision_ligne
    ADD CONSTRAINT machine_decision_ligne_id_mouvement_fkey FOREIGN KEY (id_mouvement) REFERENCES public.mouvement(id_mouvement);


--
-- Name: machine_emplacement machine_emplacement_code_machine_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_emplacement
    ADD CONSTRAINT machine_emplacement_code_machine_fkey FOREIGN KEY (code_machine) REFERENCES public.machine(code_machine);


--
-- Name: machine_emplacement machine_emplacement_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_emplacement
    ADD CONSTRAINT machine_emplacement_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: machine_etat machine_etat_code_emplacement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_etat
    ADD CONSTRAINT machine_etat_code_emplacement_fkey FOREIGN KEY (code_emplacement) REFERENCES public.machine_emplacement(code_emplacement);


--
-- Name: machine_etat machine_etat_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_etat
    ADD CONSTRAINT machine_etat_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: machine_etat machine_etat_id_fiche_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_etat
    ADD CONSTRAINT machine_etat_id_fiche_fkey FOREIGN KEY (id_fiche) REFERENCES public.machine_fiche(id_fiche);


--
-- Name: machine_etat machine_etat_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_etat
    ADD CONSTRAINT machine_etat_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: machine_fiche machine_fiche_code_emplacement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche
    ADD CONSTRAINT machine_fiche_code_emplacement_fkey FOREIGN KEY (code_emplacement) REFERENCES public.machine_emplacement(code_emplacement);


--
-- Name: machine_fiche machine_fiche_code_machine_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche
    ADD CONSTRAINT machine_fiche_code_machine_fkey FOREIGN KEY (code_machine) REFERENCES public.machine(code_machine);


--
-- Name: machine_fiche machine_fiche_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche
    ADD CONSTRAINT machine_fiche_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: machine_fiche machine_fiche_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche
    ADD CONSTRAINT machine_fiche_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: machine_fiche machine_fiche_id_utilisateur_validation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche
    ADD CONSTRAINT machine_fiche_id_utilisateur_validation_fkey FOREIGN KEY (id_utilisateur_validation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: machine_fiche_journal machine_fiche_journal_code_emplacement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_journal
    ADD CONSTRAINT machine_fiche_journal_code_emplacement_fkey FOREIGN KEY (code_emplacement) REFERENCES public.machine_emplacement(code_emplacement);


--
-- Name: machine_fiche_journal machine_fiche_journal_id_decision_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_journal
    ADD CONSTRAINT machine_fiche_journal_id_decision_fkey FOREIGN KEY (id_decision) REFERENCES public.machine_decision(id_decision);


--
-- Name: machine_fiche_journal machine_fiche_journal_id_fiche_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_journal
    ADD CONSTRAINT machine_fiche_journal_id_fiche_fkey FOREIGN KEY (id_fiche) REFERENCES public.machine_fiche(id_fiche);


--
-- Name: machine_fiche_journal machine_fiche_journal_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_journal
    ADD CONSTRAINT machine_fiche_journal_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: machine_fiche_ligne machine_fiche_ligne_code_motif_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_ligne
    ADD CONSTRAINT machine_fiche_ligne_code_motif_fkey FOREIGN KEY (code_motif) REFERENCES public.machine_motif(code_motif);


--
-- Name: machine_fiche_ligne machine_fiche_ligne_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_ligne
    ADD CONSTRAINT machine_fiche_ligne_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: machine_fiche_ligne machine_fiche_ligne_id_fiche_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.machine_fiche_ligne
    ADD CONSTRAINT machine_fiche_ligne_id_fiche_fkey FOREIGN KEY (id_fiche) REFERENCES public.machine_fiche(id_fiche) ON DELETE CASCADE;


--
-- Name: modele_droit_champ modele_droit_champ_code_role_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.modele_droit_champ
    ADD CONSTRAINT modele_droit_champ_code_role_user_fkey FOREIGN KEY (code_role_user) REFERENCES public.role_utilisateur(code_role_user) ON DELETE CASCADE;


--
-- Name: modele_droit_champ modele_droit_champ_module_champ_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.modele_droit_champ
    ADD CONSTRAINT modele_droit_champ_module_champ_fkey FOREIGN KEY (module, champ) REFERENCES public.champ_configurable(module, champ) ON DELETE CASCADE;


--
-- Name: mouvement mouvement_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.mouvement
    ADD CONSTRAINT mouvement_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: mouvement mouvement_code_motif_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.mouvement
    ADD CONSTRAINT mouvement_code_motif_fkey FOREIGN KEY (code_motif) REFERENCES public.motif_mouvement(code_motif);


--
-- Name: mouvement mouvement_code_type_mvt_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.mouvement
    ADD CONSTRAINT mouvement_code_type_mvt_fkey FOREIGN KEY (code_type_mvt) REFERENCES public.type_mouvement(code_type_mvt);


--
-- Name: mouvement mouvement_contrepasse_fk; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.mouvement
    ADD CONSTRAINT mouvement_contrepasse_fk FOREIGN KEY (id_mouvement_contrepasse) REFERENCES public.mouvement(id_mouvement);


--
-- Name: mouvement mouvement_id_decision_machine_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.mouvement
    ADD CONSTRAINT mouvement_id_decision_machine_fkey FOREIGN KEY (id_decision_machine) REFERENCES public.machine_decision(id_decision);


--
-- Name: mouvement mouvement_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.mouvement
    ADD CONSTRAINT mouvement_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: parametre_historique parametre_historique_code_parametre_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.parametre_historique
    ADD CONSTRAINT parametre_historique_code_parametre_fkey FOREIGN KEY (code_parametre) REFERENCES public.parametre(code_parametre);


--
-- Name: permission permission_code_role_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.permission
    ADD CONSTRAINT permission_code_role_user_fkey FOREIGN KEY (code_role_user) REFERENCES public.role_utilisateur(code_role_user) ON DELETE CASCADE;


--
-- Name: piece_jointe piece_jointe_id_dossier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_jointe
    ADD CONSTRAINT piece_jointe_id_dossier_fkey FOREIGN KEY (id_dossier) REFERENCES public.import_dossiers(id_dossier) ON DELETE CASCADE;


--
-- Name: piece_jointe piece_jointe_id_facture_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_jointe
    ADD CONSTRAINT piece_jointe_id_facture_fkey FOREIGN KEY (id_facture) REFERENCES public.import_factures(id_facture) ON DELETE SET NULL;


--
-- Name: piece_jointe piece_jointe_id_frais_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_jointe
    ADD CONSTRAINT piece_jointe_id_frais_fkey FOREIGN KEY (id_frais) REFERENCES public.parametres_frais(id_frais);


--
-- Name: piece_jointe piece_jointe_id_reception_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_jointe
    ADD CONSTRAINT piece_jointe_id_reception_fkey FOREIGN KEY (id_reception) REFERENCES public.import_receptions(id_reception) ON DELETE SET NULL;


--
-- Name: piece_jointe piece_jointe_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_jointe
    ADD CONSTRAINT piece_jointe_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: piece_lecture piece_lecture_id_piece_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_lecture
    ADD CONSTRAINT piece_lecture_id_piece_fkey FOREIGN KEY (id_piece) REFERENCES public.piece_jointe(id_piece) ON DELETE CASCADE;


--
-- Name: piece_lecture piece_lecture_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.piece_lecture
    ADD CONSTRAINT piece_lecture_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: plan_achat plan_achat_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_achat
    ADD CONSTRAINT plan_achat_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: plan_achat plan_achat_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_achat
    ADD CONSTRAINT plan_achat_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: plan_achat plan_achat_code_reference_origine_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_achat
    ADD CONSTRAINT plan_achat_code_reference_origine_fkey FOREIGN KEY (code_reference_origine) REFERENCES public.reference(code_reference);


--
-- Name: plan_achat plan_achat_id_bc_genere_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_achat
    ADD CONSTRAINT plan_achat_id_bc_genere_fkey FOREIGN KEY (id_bc_genere) REFERENCES public.bon_commande(id_bc);


--
-- Name: plan_achat plan_achat_id_plan_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_achat
    ADD CONSTRAINT plan_achat_id_plan_fkey FOREIGN KEY (id_plan) REFERENCES public.plan_production(id_plan);


--
-- Name: plan_achat plan_achat_id_utilisateur_figement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_achat
    ADD CONSTRAINT plan_achat_id_utilisateur_figement_fkey FOREIGN KEY (id_utilisateur_figement) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: plan_achat plan_achat_id_utilisateur_validation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_achat
    ADD CONSTRAINT plan_achat_id_utilisateur_validation_fkey FOREIGN KEY (id_utilisateur_validation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: plan_production plan_production_id_utilisateur_cloture_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_production
    ADD CONSTRAINT plan_production_id_utilisateur_cloture_fkey FOREIGN KEY (id_utilisateur_cloture) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: plan_production plan_production_id_utilisateur_creation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_production
    ADD CONSTRAINT plan_production_id_utilisateur_creation_fkey FOREIGN KEY (id_utilisateur_creation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: plan_production plan_production_id_utilisateur_modification_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_production
    ADD CONSTRAINT plan_production_id_utilisateur_modification_fkey FOREIGN KEY (id_utilisateur_modification) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: plan_production plan_production_id_utilisateur_validation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_production
    ADD CONSTRAINT plan_production_id_utilisateur_validation_fkey FOREIGN KEY (id_utilisateur_validation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: plan_qualite plan_qualite_code_qualite_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_qualite
    ADD CONSTRAINT plan_qualite_code_qualite_fkey FOREIGN KEY (code_qualite) REFERENCES public.qualite(code_qualite);


--
-- Name: plan_qualite plan_qualite_id_plan_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_qualite
    ADD CONSTRAINT plan_qualite_id_plan_fkey FOREIGN KEY (id_plan) REFERENCES public.plan_production(id_plan) ON DELETE CASCADE;


--
-- Name: plan_saisonnalite plan_saisonnalite_code_qualite_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_saisonnalite
    ADD CONSTRAINT plan_saisonnalite_code_qualite_fkey FOREIGN KEY (code_qualite) REFERENCES public.qualite(code_qualite);


--
-- Name: plan_saisonnalite plan_saisonnalite_id_plan_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.plan_saisonnalite
    ADD CONSTRAINT plan_saisonnalite_id_plan_fkey FOREIGN KEY (id_plan) REFERENCES public.plan_production(id_plan) ON DELETE CASCADE;


--
-- Name: preference_utilisateur preference_utilisateur_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.preference_utilisateur
    ADD CONSTRAINT preference_utilisateur_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur) ON DELETE CASCADE;


--
-- Name: qualite qualite_id_utilisateur_cloture_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.qualite
    ADD CONSTRAINT qualite_id_utilisateur_cloture_fkey FOREIGN KEY (id_utilisateur_cloture) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: qualite qualite_id_utilisateur_creation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.qualite
    ADD CONSTRAINT qualite_id_utilisateur_creation_fkey FOREIGN KEY (id_utilisateur_creation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: qualite qualite_id_utilisateur_modification_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.qualite
    ADD CONSTRAINT qualite_id_utilisateur_modification_fkey FOREIGN KEY (id_utilisateur_modification) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: reception_ajustements_cmup reception_ajustements_cmup_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception_ajustements_cmup
    ADD CONSTRAINT reception_ajustements_cmup_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: reception_ajustements_cmup reception_ajustements_cmup_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception_ajustements_cmup
    ADD CONSTRAINT reception_ajustements_cmup_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: reception_ajustements_cmup reception_ajustements_cmup_id_reception_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception_ajustements_cmup
    ADD CONSTRAINT reception_ajustements_cmup_id_reception_fkey FOREIGN KEY (id_reception) REFERENCES public.reception(id_reception);


--
-- Name: reception_ajustements_cmup reception_ajustements_cmup_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception_ajustements_cmup
    ADD CONSTRAINT reception_ajustements_cmup_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: reception reception_code_devise_facture_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception
    ADD CONSTRAINT reception_code_devise_facture_fkey FOREIGN KEY (code_devise_facture) REFERENCES public.devise(code_devise);


--
-- Name: reception reception_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception
    ADD CONSTRAINT reception_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: reception reception_id_bc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception
    ADD CONSTRAINT reception_id_bc_fkey FOREIGN KEY (id_bc) REFERENCES public.bon_commande(id_bc);


--
-- Name: reception reception_id_utilisateur_cloture_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception
    ADD CONSTRAINT reception_id_utilisateur_cloture_fkey FOREIGN KEY (id_utilisateur_cloture) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: reception reception_id_utilisateur_controle_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception
    ADD CONSTRAINT reception_id_utilisateur_controle_fkey FOREIGN KEY (id_utilisateur_controle) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: reception reception_id_utilisateur_reception_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reception
    ADD CONSTRAINT reception_id_utilisateur_reception_fkey FOREIGN KEY (id_utilisateur_reception) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: recette recette_code_fournisseur_prefere_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.recette
    ADD CONSTRAINT recette_code_fournisseur_prefere_fkey FOREIGN KEY (code_fournisseur_prefere) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: recette recette_code_groupe_equiv_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.recette
    ADD CONSTRAINT recette_code_groupe_equiv_fkey FOREIGN KEY (code_groupe_equiv) REFERENCES public.groupe_equiv(code_groupe_equiv);


--
-- Name: recette recette_code_qualite_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.recette
    ADD CONSTRAINT recette_code_qualite_fkey FOREIGN KEY (code_qualite) REFERENCES public.qualite(code_qualite) ON DELETE CASCADE;


--
-- Name: recette recette_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.recette
    ADD CONSTRAINT recette_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: recette recette_code_role_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.recette
    ADD CONSTRAINT recette_code_role_fkey FOREIGN KEY (code_role) REFERENCES public.role_bom(code_role);


--
-- Name: reference reference_code_categorie_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference
    ADD CONSTRAINT reference_code_categorie_fkey FOREIGN KEY (code_categorie) REFERENCES public.categorie_matiere(code_categorie);


--
-- Name: reference reference_code_conditionnement_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference
    ADD CONSTRAINT reference_code_conditionnement_fkey FOREIGN KEY (code_conditionnement) REFERENCES public.conditionnement(code_conditionnement);


--
-- Name: reference reference_code_couleur_interne_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference
    ADD CONSTRAINT reference_code_couleur_interne_fkey FOREIGN KEY (code_couleur_interne) REFERENCES public.couleur(code_couleur_interne);


--
-- Name: reference reference_code_devise_catalogue_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference
    ADD CONSTRAINT reference_code_devise_catalogue_fkey FOREIGN KEY (code_devise_catalogue) REFERENCES public.devise(code_devise);


--
-- Name: reference reference_code_famille_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference
    ADD CONSTRAINT reference_code_famille_fkey FOREIGN KEY (code_famille) REFERENCES public.famille(code_famille);


--
-- Name: reference reference_code_fournisseur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference
    ADD CONSTRAINT reference_code_fournisseur_fkey FOREIGN KEY (code_fournisseur) REFERENCES public.fournisseur(code_fournisseur);


--
-- Name: reference_groupe_equiv reference_groupe_equiv_code_groupe_equiv_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference_groupe_equiv
    ADD CONSTRAINT reference_groupe_equiv_code_groupe_equiv_fkey FOREIGN KEY (code_groupe_equiv) REFERENCES public.groupe_equiv(code_groupe_equiv) ON DELETE CASCADE;


--
-- Name: reference_groupe_equiv reference_groupe_equiv_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference_groupe_equiv
    ADD CONSTRAINT reference_groupe_equiv_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: reference reference_id_utilisateur_creation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.reference
    ADD CONSTRAINT reference_id_utilisateur_creation_fkey FOREIGN KEY (id_utilisateur_creation) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: snapshot_mrp snapshot_mrp_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.snapshot_mrp
    ADD CONSTRAINT snapshot_mrp_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: snapshot_mrp snapshot_mrp_id_plan_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.snapshot_mrp
    ADD CONSTRAINT snapshot_mrp_id_plan_fkey FOREIGN KEY (id_plan) REFERENCES public.plan_production(id_plan);


--
-- Name: stock_lot stock_lot_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.stock_lot
    ADD CONSTRAINT stock_lot_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: stock_lot stock_lot_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.stock_lot
    ADD CONSTRAINT stock_lot_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: stock_magasin stock_magasin_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.stock_magasin
    ADD CONSTRAINT stock_magasin_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: stock_magasin stock_magasin_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.stock_magasin
    ADD CONSTRAINT stock_magasin_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- Name: taux_change taux_change_code_devise_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.taux_change
    ADD CONSTRAINT taux_change_code_devise_fkey FOREIGN KEY (code_devise) REFERENCES public.devise(code_devise);


--
-- Name: telechargement telechargement_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.telechargement
    ADD CONSTRAINT telechargement_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: transfert transfert_code_magasin_dest_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.transfert
    ADD CONSTRAINT transfert_code_magasin_dest_fkey FOREIGN KEY (code_magasin_dest) REFERENCES public.magasin(code_magasin);


--
-- Name: transfert transfert_code_magasin_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.transfert
    ADD CONSTRAINT transfert_code_magasin_source_fkey FOREIGN KEY (code_magasin_source) REFERENCES public.magasin(code_magasin);


--
-- Name: transfert transfert_id_utilisateur_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.transfert
    ADD CONSTRAINT transfert_id_utilisateur_fkey FOREIGN KEY (id_utilisateur) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: transfert transfert_id_utilisateur_reception_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.transfert
    ADD CONSTRAINT transfert_id_utilisateur_reception_fkey FOREIGN KEY (id_utilisateur_reception) REFERENCES public.utilisateur(id_utilisateur);


--
-- Name: utilisateur utilisateur_code_role_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.utilisateur
    ADD CONSTRAINT utilisateur_code_role_user_fkey FOREIGN KEY (code_role_user) REFERENCES public.role_utilisateur(code_role_user);


--
-- Name: utilisateur utilisateur_magasin_principal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.utilisateur
    ADD CONSTRAINT utilisateur_magasin_principal_fkey FOREIGN KEY (magasin_principal) REFERENCES public.magasin(code_magasin);


--
-- Name: valorisation_stock valorisation_stock_code_magasin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.valorisation_stock
    ADD CONSTRAINT valorisation_stock_code_magasin_fkey FOREIGN KEY (code_magasin) REFERENCES public.magasin(code_magasin);


--
-- Name: valorisation_stock valorisation_stock_code_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: gestionfil
--

ALTER TABLE ONLY public.valorisation_stock
    ADD CONSTRAINT valorisation_stock_code_reference_fkey FOREIGN KEY (code_reference) REFERENCES public.reference(code_reference);


--
-- PostgreSQL database dump complete
--

\unrestrict yEItOgJQZvxbnD5W9B3G5XS1DKNI9c2sY9ZZom3LhFU2KAP60D6mFKdhVu12nsi

