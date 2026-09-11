-- =============================================================================
-- MIGRATION 2026-09-07 — L'ETAT DE STOCK, VENTILE PAR MAGASIN
-- -----------------------------------------------------------------------------
-- CE QUI MANQUAIT. `/api/stock` rendait une ligne par couple (reference,
-- magasin), et l'ecran recomposait le tableau. On ne voyait donc jamais une
-- reference d'un coup d'oeil : il fallait lire quatre lignes pour savoir ou
-- etaient ses kilos, et le total ne s'affichait nulle part.
--
-- LA FEUILLE « Stock » DU CLASSEUR fait exactement l'inverse : une ligne par
-- reference, et des colonnes par magasin (Polyfashions, Morocco, magasins).
-- C'est la bonne forme, et c'est celle que cette vue produit.
--
-- LES MACHINES COMPTENT POUR UNE SEULE COLONNE. Chaque etage est un magasin,
-- ce qui est juste pour la comptabilite mais illisible dans un etat : une
-- machine a six zones ferait six colonnes. On les additionne donc, et le detail
-- reste consultable sur l'ecran des machines. Deux etats pour la meme matiere
-- ne servent personne.
--
--     cd /tmp
--     cat /home/sysadmin/gestionfil/db/pg/migrations/2026-09-07_etat_stock.sql |
--         sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS v_etat_stock CASCADE;
CREATE VIEW v_etat_stock AS
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
           AND x.actif = 1)                AS nb_equivalents

  FROM v_stock_projete sp
  JOIN reference r            ON r.code_reference = sp.code_reference
  LEFT JOIN categorie_matiere cm ON cm.code_categorie = r.code_categorie
  LEFT JOIN ventilation v     ON v.code_reference = sp.code_reference
  LEFT JOIN mouvement_dernier md ON md.code_reference = sp.code_reference
  LEFT JOIN reference_groupe_equiv rge ON rge.code_reference = sp.code_reference
                                      AND rge.actif = 1;

ALTER VIEW v_etat_stock OWNER TO gestionfil;

COMMIT;
