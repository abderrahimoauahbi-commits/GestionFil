-- ==========================================================================
-- MIGRATION 2026-09-18i — LE SOCLE D'OUVERTURE PORTE SES PALETTES ET SA VALEUR
-- --------------------------------------------------------------------------
-- TROIS MANQUES, CONSTATES A L'ECRAN LE 18/09/2026 :
--
--   1. Le stock est entre EN PALETTES, et les ecrans ne rendaient que des kilos
--      et des bobines. `ligne_mouvement.nb_palettes` existait — je l'avais
--      laissee vide.
--
--   2. Les lignes n'avaient AUCUN PRIX, donc aucune valeur : `total_mad` est une
--      colonne calculee, `quantite_kg * COALESCE(prix_kg_mad, 0)`. Sans prix,
--      elle vaut zero, et le bon de mouvement affichait un stock d'ouverture a
--      zero dirham.
--
--   3. `v_etat_stock` ne comptait aucune palette.
--
-- CE QUE CHANGE CETTE MIGRATION, ET CE QU'ELLE NE CHANGE PAS.
--
-- On valorise le socle AU PRIX CATALOGUE, converti au taux en vigueur. Mais un
-- prix d'ouverture N'EST PAS UN PRIX D'ACHAT : personne n'a paye ce tarif, on
-- s'en sert pour chiffrer ce qui etait la au depart. La regle posee le
-- 2026-09-18e — « tant qu'aucun achat n'a fixe le CMUP, il suit le catalogue »
-- — doit donc continuer de s'appliquer. Sans precaution, elle se serait
-- ETEINTE D'ELLE-MEME des cette migration : elle s'arrete a la premiere ligne
-- de mouvement portant un prix, et nous venons d'en ecrire soixante-deux.
--
-- La regle distingue desormais les deux : une ENTREE VALORISEE fige le CMUP,
-- une VALORISATION D'OUVERTURE non. Changer un prix catalogue continue donc de
-- se propager partout, comme demande le 18/09 au matin.
--
-- Rejouable : la valorisation ne s'applique qu'aux lignes qui n'ont ni palette
-- ni prix, et la vue se remplace.
-- ==========================================================================

BEGIN;

-- ------------------------------------------------- 1. LA REGLE SE PRECISE
CREATE OR REPLACE FUNCTION fn_cmup_suivre_catalogue(p_reference text) RETURNS void
LANGUAGE plpgsql AS $$
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

-- --------------------------------- 2. LE SOCLE RECOIT PALETTES ET VALEUR
DO $$
DECLARE n_autres bigint; n_faites bigint;
BEGIN
    -- LA MEME GARDE QUE 2026-09-18h. Une ligne de mouvement est immuable (R03) ;
    -- la retoucher ne se justifie que parce que le grand livre ne contient
    -- encore QUE le socle d'ouverture, pose le jour meme, avant tout usage. Au
    -- premier mouvement d'exploitation, cette migration refuse de s'executer.
    SELECT count(*) INTO n_autres FROM mouvement WHERE code_type_mvt <> 'STOCK_INIT';
    IF n_autres > 0 THEN
        RAISE EXCEPTION 'Le grand livre porte % mouvement(s) d''exploitation : '
                        'le socle ne se retouche plus.', n_autres;
    END IF;

    SELECT count(*) INTO n_faites
      FROM ligne_mouvement lm JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
     WHERE m.code_type_mvt = 'STOCK_INIT'
       AND (lm.nb_palettes IS NULL OR lm.prix_kg_mad IS NULL);
    IF n_faites = 0 THEN
        RAISE NOTICE 'le socle porte deja ses palettes et sa valeur';
        RETURN;
    END IF;

    ALTER TABLE ligne_mouvement DISABLE TRIGGER trg_lmvt_immuable_u;

    UPDATE ligne_mouvement lm
       -- LE NOMBRE DE PALETTES EST UN ENTIER, ARRONDI AU SUPERIEUR : une
       -- palette entamee occupe une place au sol. `quantite_saisie` garde la
       -- valeur exacte (4,8 palettes), `nb_palettes` dit ce qu'on compte en
       -- passant dans l'allee (5).
       SET nb_palettes = CASE WHEN lm.facteur_conversion > 0
                              THEN CEIL(lm.quantite_kg / lm.facteur_conversion)::bigint END,
           prix_kg_mad = fn_prix_catalogue_mad(lm.code_reference)
      FROM mouvement m
     WHERE m.id_mouvement = lm.id_mouvement
       AND m.code_type_mvt = 'STOCK_INIT'
       AND (lm.nb_palettes IS NULL OR lm.prix_kg_mad IS NULL);

    ALTER TABLE ligne_mouvement ENABLE TRIGGER trg_lmvt_immuable_u;
    RAISE NOTICE '% ligne(s) du socle valorisee(s) au prix catalogue', n_faites;
END $$;

-- -------------------------------- 3. L'ETAT DE STOCK COMPTE LES PALETTES
CREATE OR REPLACE VIEW v_etat_stock AS
WITH ventilation AS (
    -- LA VENTILATION, EN UNE PASSE. `jsonb_object_agg` evite d'inventer une
    -- colonne par magasin : la liste des magasins change, la vue non. L'ecran
    -- construit ses colonnes a partir du referentiel qu'il connait deja.
    SELECT sm.code_reference,
           jsonb_object_agg(sm.code_magasin, ROUND(sm.quantite_kg, 3))
               FILTER (WHERE e.code_machine IS NULL AND sm.quantite_kg <> 0)
               AS par_magasin,
           COALESCE(SUM(sm.quantite_kg)
               FILTER (WHERE e.code_machine IS NULL), 0)          AS magasins_kg,
           COALESCE(SUM(sm.quantite_kg)
               FILTER (WHERE e.code_machine IS NOT NULL), 0)      AS machines_kg,
           COALESCE(SUM(sm.nb_bobines)
               FILTER (WHERE e.code_machine IS NOT NULL), 0)      AS machines_bobines,
           COUNT(DISTINCT e.code_machine)
               FILTER (WHERE e.code_machine IS NOT NULL)          AS nb_machines
      FROM stock_magasin sm
      LEFT JOIN machine_emplacement e ON e.code_magasin = sm.code_magasin
     GROUP BY sm.code_reference
),
mouvement_dernier AS (
    -- La derniere sortie et l'anciennete qui en decoule : deux colonnes du
    -- classeur que rien ne portait jusqu'ici.
    SELECT lm.code_reference,
           MAX(mv.date_mouvement) FILTER (WHERE tm.signe = -1) AS derniere_sortie,
           MAX(mv.date_mouvement)                              AS dernier_mouvement
      FROM ligne_mouvement lm
      JOIN mouvement mv      ON mv.id_mouvement = lm.id_mouvement
      JOIN type_mouvement tm ON tm.code_type_mvt = mv.code_type_mvt
     GROUP BY lm.code_reference
)
SELECT sp.code_reference,
       sp.designation,
       r.code_categorie,
       cm.libelle                          AS categorie,
       sp.code_fournisseur,
       sp.fournisseur_nom,
       sp.unite_catalogue                  AS unite,

       -- LE STOCK, DU GLOBAL AU DETAIL.
       ROUND(sp.stock_total_kg, 3)         AS stock_global_kg,
       ROUND(v.magasins_kg, 3)             AS magasins_kg,
       ROUND(v.machines_kg, 3)             AS machines_kg,
       v.machines_bobines,
       v.nb_machines,
       v.par_magasin,

       ROUND(sp.stock_quarantaine_kg, 3)   AS quarantaine_kg,
       ROUND(sp.stock_physique_net_kg, 3)  AS disponible_kg,
       ROUND(sp.encours_kg, 3)             AS encours_kg,
       ROUND(sp.besoin_12m_kg, 3)          AS besoin_12m_kg,
       ROUND(sp.stock_projete_kg, 3)       AS stock_projete_kg,
       ROUND(sp.stock_min_kg, 3)           AS stock_min_kg,
       ROUND(sp.conso_mensuelle_kg, 3)     AS conso_mensuelle_kg,
       ROUND(sp.jours_couverture, 1)       AS jours_couverture,
       sp.delai_livraison_jours,
       sp.statut,
       sp.classe_abc,
       sp.classe_xyz,

       -- LA VALEUR.
       ROUND(sp.cmup_mad, 4)               AS cmup_mad,
       ROUND(r.prix_catalogue_kg, 4)       AS prix_catalogue_kg,
       r.code_devise_catalogue             AS devise,
       ROUND(sp.valeur_totale_mad, 2)      AS valeur_mad,

       -- SOUS LE MINIMUM : LA LECTURE DU MAGASIN, a cote de celle du MRP.
       --
       -- `statut` vient du calcul des besoins : sans demande planifiee, il
       -- conclut « OK » meme a zero kilo, et c'est defendable — rien n'est
       -- urgent si rien n'est attendu. Le classeur, lui, compte une rupture des
       -- que le stock passe sous le minimum, et c'est defendable aussi : un
       -- magasin vide reste un magasin vide.
       --
       -- Les deux lectures coexistent donc, plutot que d'en redefinir une. Un
       -- ecran qui montre « OK » a cote de « a commander : 3 900 kg » n'est pas
       -- lisible ; un ecran qui montre les deux etats l'est.
       (sp.stock_min_kg > 0 AND sp.stock_total_kg < sp.stock_min_kg) AS sous_minimum,

       -- CE QU'IL FAUT COMMANDER, si quelque chose manque.
       GREATEST(0, ROUND(sp.stock_min_kg - sp.stock_projete_kg, 3)) AS a_commander_kg,

       -- L'ANCIENNETE : c'est elle qui revele le stock dormant.
       md.derniere_sortie,
       md.dernier_mouvement,
       CASE WHEN md.dernier_mouvement IS NULL THEN NULL
            ELSE (current_date - (LEFT(md.dernier_mouvement, 10))::date) END AS jours_sans_mouvement,

       -- L'EQUIVALENCE : savoir qu'une rupture est couverte ailleurs change
       -- entierement la lecture de la ligne.
       rge.code_groupe_equiv,
       (SELECT COUNT(*) FROM reference_groupe_equiv x
         WHERE x.code_groupe_equiv = rge.code_groupe_equiv
           AND x.code_reference <> sp.code_reference
           AND x.actif = 1)                AS nb_equivalents,

       -- LE COMPTAGE EN PALETTES, qui manquait.
       --
       -- Le stock ENTRE en palettes — c'est ainsi qu'on le compte au magasin —
       -- mais il etait RENDU en kilos et en bobines seulement. Le magasinier
       -- devait diviser de tete pour retrouver ce qu'il voit devant lui.
       --
       -- La conversion vient du catalogue, pas du mouvement : elle doit valoir
       -- pour le stock d'aujourd'hui, quelle que soit la facon dont il est
       -- entre. Une reference sans poids de bobine ou sans nombre par palette
       -- ne rend rien plutot qu'un zero : NULL se lit « on ne sait pas », zero
       -- se lit « il n'y en a pas ».
       ROUND(r.bobines_par_palette * r.poids_bobine_kg, 3)       AS kg_par_palette,
       CASE WHEN r.bobines_par_palette > 0 AND r.poids_bobine_kg > 0
            THEN ROUND(sp.stock_total_kg
                       / (r.bobines_par_palette * r.poids_bobine_kg), 2) END AS palettes,
       CASE WHEN r.poids_bobine_kg > 0
            THEN ROUND(sp.stock_total_kg / r.poids_bobine_kg)     END AS bobines

  FROM v_stock_projete sp
  JOIN reference r            ON r.code_reference = sp.code_reference
  LEFT JOIN categorie_matiere cm ON cm.code_categorie = r.code_categorie
  LEFT JOIN ventilation v     ON v.code_reference = sp.code_reference
  LEFT JOIN mouvement_dernier md ON md.code_reference = sp.code_reference
  LEFT JOIN reference_groupe_equiv rge ON rge.code_reference = sp.code_reference
                                      AND rge.actif = 1;

ALTER VIEW v_etat_stock OWNER TO gestionfil;

-- ---------------------------------------------------------- 4. LES PREUVES
DO $$
DECLARE n_sans_palette bigint; n_sans_prix bigint; valeur numeric;
        valeur_stock numeric; n_palettes bigint; suit bigint;
BEGIN
    SELECT count(*) FILTER (WHERE lm.nb_palettes IS NULL),
           count(*) FILTER (WHERE lm.prix_kg_mad IS NULL),
           ROUND(SUM(lm.total_mad), 2)
      INTO n_sans_palette, n_sans_prix, valeur
      FROM ligne_mouvement lm JOIN mouvement m ON m.id_mouvement = lm.id_mouvement
     WHERE m.code_type_mvt = 'STOCK_INIT';
    IF n_sans_palette > 0 OR n_sans_prix > 0 THEN
        RAISE EXCEPTION '% ligne(s) sans palette et % sans prix', n_sans_palette, n_sans_prix;
    END IF;

    SELECT ROUND(SUM(valeur_mad), 2) INTO valeur_stock FROM stock_magasin;
    IF abs(valeur - valeur_stock) > 1 THEN
        RAISE EXCEPTION 'la valeur du socle (% MAD) et celle du stock (% MAD) divergent',
                        valeur, valeur_stock;
    END IF;

    SELECT count(*) INTO n_palettes FROM v_etat_stock WHERE palettes IS NOT NULL AND palettes > 0;

    -- LA REGLE DU CATALOGUE DOIT AVOIR SURVECU : c'est tout l'enjeu.
    SELECT count(*) INTO suit FROM reference r
     WHERE r.cmup_mad IS NOT NULL
       AND ROUND(r.cmup_mad, 4) = ROUND(fn_prix_catalogue_mad(r.code_reference), 4);
    IF suit < 100 THEN
        RAISE EXCEPTION 'seules % references suivent encore le catalogue : la regle a saute', suit;
    END IF;

    RAISE NOTICE 'socle valorise % MAD, % references comptees en palettes, % CMUP suivent le catalogue',
                 valeur, n_palettes, suit;
END $$;

COMMIT;
