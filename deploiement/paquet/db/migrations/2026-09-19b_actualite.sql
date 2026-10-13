-- =============================================================================
-- MIGRATION 2026-09-19b — L'ACTUALITE DE L'ERP
-- -----------------------------------------------------------------------------
-- CONSTAT DU 19/09/2026. La page d'accueil affichait, sous un bel en-tete et
-- les taux du jour, UN MUR DE TRENTE BOUTONS ranges par section : Catalogue,
-- Production, Achats, Stock, Finance, Parametres. C'est-a-dire le menu de
-- gauche, recopie au milieu de l'ecran.
--
-- Une page d'accueil qui ne fait que proposer des destinations n'apprend rien a
-- celui qui l'ouvre. Les accueils serieux montrent CE QUI S'EST PASSE depuis la
-- derniere visite : qui a enregistre quoi, quel bon est parti, quelle reception
-- attend un controle. C'est ce fil-la qui dit si l'outil VIT.
--
-- LA VUE RASSEMBLE LES EVENEMENTS METIER, pas les ecritures techniques. Le
-- journal d'audit existe pour l'analyse d'un incident ; ceci est pour la lecture
-- du matin. On y lit des documents et des decisions, jamais des UPDATE.
--
-- CHAQUE EVENEMENT PORTE SON LIEN : un fil d'actualite dont les lignes ne
-- s'ouvrent pas est une frise decorative.
--
-- LES DATES SONT DU TEXTE ISO dans tout l'ERP ('2026-09-19T14:30:00.000Z') :
-- leur tri alphabetique EST leur tri chronologique, et aucune conversion n'est
-- necessaire.
--
-- Rejouable : CREATE OR REPLACE.
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW v_actualite AS
WITH evenements AS (
    -- ---- LE STOCK BOUGE -----------------------------------------------------
    SELECT m.date_creation                                        AS quand,
           'MOUVEMENT'                                            AS categorie,
           tm.libelle || ' — ' || m.numero_mouvement              AS titre,
           mg.nom || ' · ' || COALESCE(
               (SELECT ROUND(SUM(lm.quantite_kg))::text || ' kg sur '
                       || COUNT(*)::text || ' ligne(s)'
                  FROM ligne_mouvement lm WHERE lm.id_mouvement = m.id_mouvement),
               'aucune ligne')                                    AS detail,
           '/mouvements/' || m.id_mouvement                       AS chemin,
           m.id_utilisateur                                       AS qui
      FROM mouvement m
      JOIN type_mouvement tm ON tm.code_type_mvt = m.code_type_mvt
      JOIN magasin mg        ON mg.code_magasin  = m.code_magasin

    -- ---- UNE RECEPTION ARRIVE, PUIS SE CONTROLE -----------------------------
    UNION ALL
    SELECT r.date_creation, 'RECEPTION',
           'Réception ' || r.numero_reception || ' enregistrée',
           COALESCE(f.nom, 'fournisseur inconnu'),
           '/receptions/' || r.id_reception, r.id_utilisateur_reception
      FROM reception r LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
    UNION ALL
    SELECT r.date_controle, 'RECEPTION',
           'Réception ' || r.numero_reception || ' contrôlée',
           COALESCE(f.nom, '') || ' · ' || r.statut,
           '/receptions/' || r.id_reception, r.id_utilisateur_controle
      FROM reception r LEFT JOIN fournisseur f ON f.code_fournisseur = r.code_fournisseur
     WHERE r.date_controle IS NOT NULL

    -- ---- UN BON DE COMMANDE NAIT, SE VALIDE, PART ---------------------------
    UNION ALL
    SELECT b.date_creation, 'COMMANDE',
           'Bon ' || b.numero_bc || ' créé',
           COALESCE(f.nom, ''),
           '/bons-commande/' || b.id_bc, b.id_utilisateur_creation
      FROM bon_commande b LEFT JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur
    UNION ALL
    SELECT b.date_validation, 'COMMANDE',
           'Bon ' || b.numero_bc || ' validé',
           COALESCE(f.nom, '') || ' · ' || ROUND(COALESCE(b.montant_total_mad, 0))::text || ' MAD',
           '/bons-commande/' || b.id_bc, b.id_utilisateur_validation
      FROM bon_commande b LEFT JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur
     WHERE b.date_validation IS NOT NULL
    UNION ALL
    SELECT b.date_envoi, 'COMMANDE',
           'Bon ' || b.numero_bc || ' envoyé au fournisseur',
           COALESCE(f.nom, ''),
           '/bons-commande/' || b.id_bc, b.id_utilisateur_validation
      FROM bon_commande b LEFT JOIN fournisseur f ON f.code_fournisseur = b.code_fournisseur
     WHERE b.date_envoi IS NOT NULL

    -- ---- LES TRANSFERTS ENTRE MAGASINS --------------------------------------
    UNION ALL
    SELECT t.date_sortie, 'TRANSFERT',
           'Transfert ' || t.numero_transfert || ' expédié', '',
           '/transferts', t.id_utilisateur
      FROM transfert t WHERE t.date_sortie IS NOT NULL
    UNION ALL
    SELECT t.date_reception_dest, 'TRANSFERT',
           'Transfert ' || t.numero_transfert || ' reçu', '',
           '/transferts', t.id_utilisateur_reception
      FROM transfert t WHERE t.date_reception_dest IS NOT NULL

    -- ---- LES INVENTAIRES ----------------------------------------------------
    UNION ALL
    SELECT i.date_creation, 'INVENTAIRE',
           'Inventaire ouvert', mg.nom,
           '/inventaires', i.id_utilisateur_responsable
      FROM inventaire i JOIN magasin mg ON mg.code_magasin = i.code_magasin
    UNION ALL
    SELECT i.date_cloture, 'INVENTAIRE',
           'Inventaire clôturé', mg.nom,
           '/inventaires', i.id_utilisateur_responsable
      FROM inventaire i JOIN magasin mg ON mg.code_magasin = i.code_magasin
     WHERE i.date_cloture IS NOT NULL

    -- ---- LE PLAN DE PRODUCTION ----------------------------------------------
    UNION ALL
    SELECT p.date_validation, 'PLAN',
           'Plan « ' || p.libelle || ' » validé',
           p.date_debut || ' au ' || p.date_fin,
           '/plans', p.id_utilisateur_validation
      FROM plan_production p WHERE p.date_validation IS NOT NULL
    UNION ALL
    SELECT p.date_cloture, 'PLAN',
           'Plan « ' || p.libelle || ' » clôturé', '',
           '/plans', p.id_utilisateur_cloture
      FROM plan_production p WHERE p.date_cloture IS NOT NULL

    -- ---- LE PLAN D'ACHAT SE REGENERE ----------------------------------------
    -- Une generation produit cent lignes d'un coup : on n'en fait qu'un
    -- evenement, sans quoi le fil ne parlerait que de cela.
    UNION ALL
    SELECT MAX(pa.date_generation), 'ACHAT',
           'Plan d''achat recalculé',
           COUNT(*)::text || ' proposition(s) · '
             || ROUND(COALESCE(SUM(pa.montant_total_mad), 0))::text || ' MAD',
           '/plan-achat', NULL
      FROM plan_achat pa
     WHERE pa.date_generation IS NOT NULL
     GROUP BY substr(pa.date_generation, 1, 16)

    -- ---- LES FICHES MACHINE -------------------------------------------------
    UNION ALL
    SELECT mf.date_validation, 'MACHINE',
           'Fiche machine validée', COALESCE(mc.nom, mf.code_machine),
           '/machines', mf.id_utilisateur_validation
      FROM machine_fiche mf LEFT JOIN machine mc ON mc.code_machine = mf.code_machine
     WHERE mf.date_validation IS NOT NULL
)
SELECT e.quand,
       e.categorie,
       e.titre,
       NULLIF(e.detail, '')     AS detail,
       e.chemin,
       u.login                  AS par
  FROM evenements e
  LEFT JOIN utilisateur u ON u.id_utilisateur = e.qui
 WHERE e.quand IS NOT NULL
 ORDER BY e.quand DESC;

ALTER VIEW v_actualite OWNER TO gestionfil;

COMMENT ON VIEW v_actualite IS
  'Le fil des evenements metier, le plus recent d''abord : ce qui s''est passe dans l''ERP.';

-- ------------------------------------------------------------- LES PREUVES
DO $$
DECLARE n bigint; premier text;
BEGIN
    SELECT count(*) INTO n FROM v_actualite;
    SELECT quand || ' — ' || titre INTO premier FROM v_actualite LIMIT 1;
    RAISE NOTICE 'actualite : % evenement(s), le plus recent : %', n, COALESCE(premier, 'aucun');
END $$;

COMMIT;
