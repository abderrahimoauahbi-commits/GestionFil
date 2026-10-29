//! Pool de connexions PostgreSQL et contexte de session.
//!
//! # Le contexte d'audit, et pourquoi il a change de forme
//!
//! Les declencheurs d'audit doivent savoir QUI ecrit. Sous SQLite, l'identite
//! etait posee dans `_contexte_session`, une table a une seule ligne :
//! l'ecriture etant serialisee par le moteur, un seul redacteur pouvait s'y
//! trouver a la fois.
//!
//! POSTGRESQL ECRIT EN CONCURRENCE, ET LE PROCEDE NE TIENT PLUS. Seize
//! connexions du pool peuvent ecrire en meme temps : le magasinier pose son
//! identite, l'assistante pose la sienne une milliseconde plus tard, et le
//! declencheur du magasinier lit celle de l'assistante. Le journal attribuerait
//! alors l'action a la mauvaise personne, sans panne et sans signal — le pire
//! defaut possible pour une trace, puisqu'il ne se decouvre que le jour ou elle
//! sert.
//!
//! L'identite voyage donc dans une VARIABLE DE TRANSACTION, posee par
//! `set_config(..., true)` et lue par `current_setting(..., true)`. Elle est
//! portee par la transaction, invisible aux autres sessions, et disparait au
//! COMMIT. Les declencheurs ont ete portes en consequence (66 lectures).

use anyhow::Context;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::str::FromStr;
use std::time::Duration;

/// L'URL de connexion, sans son mot de passe.
///
/// A ECRIRE DANS TOUT JOURNAL A LA PLACE DE L'URL BRUTE. Le journal systemd est
/// lisible par tout administrateur de la machine et conserve des mois : une URL
/// tracee au demarrage y depose le mot de passe de la base en clair, autant de
/// fois que le service redemarre. Vu dans `journalctl` apres la premiere
/// publication — corrige ici, pas dans chaque appelant.
pub fn url_sans_mot_de_passe(url: &str) -> String {
    let Some(debut) = url.find("://") else { return url.to_string() };
    let apres = debut + 3;
    let Some(arobase) = url[apres..].find('@') else { return url.to_string() };
    let identite = &url[apres..apres + arobase];
    match identite.find(':') {
        Some(deux_points) => format!(
            "{}{}:***{}",
            &url[..apres],
            &identite[..deux_points],
            &url[apres + arobase..]
        ),
        None => url.to_string(),
    }
}

pub type Db = PgPool;

pub async fn connect(database_url: &str) -> anyhow::Result<Db> {
    let options = PgConnectOptions::from_str(database_url)?
        // Le fuseau de la SESSION, pas celui du serveur : CASABLANCA (decision
        // du 20/10/2026). `current_date` est ainsi le jour de l'usine, entre
        // minuit et 1 h comme le reste du temps (en UTC, c'etait la veille).
        // Les instants (`timestamptz`) ne dependent d'aucun fuseau ; le serveur
        // les sert en ISO UTC par fn_iso et routes/json.rs.
        //
        // L'ENCODAGE DU CLIENT EST FORCE EN UTF-8. Sans cela, libpq prend celui
        // du systeme : sous Windows c'est WIN1252, et un tiret cadratin ou un
        // accent parti d'un programme Rust — ou tout est UTF-8 par construction
        // — revient de la base en « â€” ». Le serveur Linux n'avait pas le
        // probleme, l'outil d'import lance depuis un poste de developpement si.
        // Un encodage qui depend de la machine qui lance l'outil n'est pas un
        // reglage, c'est un piege.
        .options([("timezone", "Africa/Casablanca"), ("client_encoding", "UTF8")])
        // DES DELAIS, POUR QU'UNE REQUETE NE FIGE PAS L'ERP (audit v4). Une
        // requete emballee ou une transaction oubliee tenaient une connexion et
        // ses verrous indefiniment : seize connexions, et l'application se
        // fige. Reglables : GESTIONFIL_DELAI_SQL_S (120 s par defaut, au-dessus
        // du calcul MRP le plus long mesure) et une transaction inactive coupee
        // apres 5 minutes.
        .options([
            ("statement_timeout", format!("{}s", delai_env("GESTIONFIL_DELAI_SQL_S", 120)).as_str()),
            ("idle_in_transaction_session_timeout", "300s"),
            // Un verrou ne s'attend pas indefiniment : au-dela, l'operation
            // echoue avec un message clair (voir error.rs, 55P03).
            ("lock_timeout", "10s"),
        ]);

    let pool = PgPoolOptions::new()
        // Seize connexions pour la cible « 50 utilisateurs simultanes » du
        // CDC L3 : un ERP passe l'essentiel de son temps a lire, et les
        // lectures sont courtes.
        .max_connections(16)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(options)
        .await
        .context("connexion a la base impossible : verifier DATABASE_URL et que PostgreSQL ecoute")?;

    verifier_schema(&pool).await.context("base non conforme a ce serveur")?;
    Ok(pool)
}

/// Un delai en secondes lu dans l'environnement, avec sa valeur par defaut.
pub fn delai_env(nom: &str, defaut: u64) -> u64 {
    std::env::var(nom).ok().and_then(|v| v.trim().parse().ok()).filter(|v| *v > 0).unwrap_or(defaut)
}

/// Verifie au demarrage que la base chargee est bien celle attendue.
///
/// Mieux vaut refuser de demarrer que servir des ecrans vides sur une base
/// incomplete : l'erreur se lit alors dans le journal du service, pas dans le
/// support utilisateur trois jours plus tard.
/// Les migrations dont le code a besoin, chacune avec un temoin qui vaut vrai
/// une fois jouee (la derniere colonne qu'elle ajoute). A completer a chaque
/// migration dont le binaire depend.
const MIGRATIONS_REQUISES: &[(&str, &str)] = &[
    (
        // La couverture cible (moteur v2, 27/10/2026) : la fiche article porte
        // couverture_cible_mois (ancienne couverture_min_mois), lue par le moteur
        // et ecrite par le CRUD ; la marge de securite de l'article est retiree.
        "2026-10-27l_couverture_cible.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reference'
                           AND column_name = 'couverture_cible_mois')",
    ),
    (
        // Le taux d'un dossier d'import est facultatif (arbitrage du 27/10/2026) :
        // le serveur l'ecrit NULL pour une devise sans taux, au lieu d'inventer 1.
        // Sans elle, la creation d'un tel dossier echouerait sur NOT NULL.
        "2026-10-27k_import_taux_dossier_facultatif.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'import_dossiers'
                           AND column_name = 'taux_change' AND is_nullable = 'YES')",
    ),
    (
        // Le grand livre de la consommation (27/10/2026, lots L0 et L1) : une seule
        // source du reel (v_consommation_fait), 12 mois pleins, machine datee a la
        // fiche ; le « plus grand des deux » (v_conso_retenue) et le minimum qui le
        // lisait sont retires ; v_stock_reference porte reel_mois_kg ; C67.
        "2026-10-27g_grand_livre_consommation.sql",
        "SELECT to_regclass('public.v_consommation_fait') IS NOT NULL
            AND to_regclass('public.v_conso_reelle_mois') IS NOT NULL
            AND to_regclass('public.v_conso_retenue') IS NULL
            AND to_regclass('public.v_ctl_c67') IS NOT NULL
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'v_stock_reference' AND column_name = 'valeur_reel_12m_mad')",
    ),
    (
        // La proposition se clot avec son bon annule (decision du 27/10/2026) :
        // statut ANNULE_BC, liee au bon, etat final (PA-ANNULE-BC) ; l'annulation
        // d'un bon l'ecrit, et sans ce statut elle echouerait sur le CHECK.
        "2026-10-27f_proposition_bon_annule.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname = 'plan_achat_statut_check'
                           AND pg_get_constraintdef(oid) LIKE '%ANNULE_BC%')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_plan_achat_annule_bc_final')",
    ),
    (
        // UNE SEULE SOURCE DE VERITE (27/10/2026) : l'ancien calcul du besoin et de
        // la projection est retire (v_stock_projete, v_plan_achat, v_encours_fiable,
        // v_besoin_horizon, v_risque_*, v_cockpit_stock…), les vues qui le lisaient
        // sont redefinies sur v_stock_reference, C05 et C25 passent au moteur, C27
        // et C49 sont retires, C66 nait ; P_MrpInclureStockMachine est supprime.
        "2026-10-27e_source_unique_moteur.sql",
        "SELECT to_regclass('public.v_stock_reference') IS NOT NULL
            AND to_regclass('public.v_stock_projete') IS NULL
            AND to_regclass('public.v_plan_achat') IS NULL
            AND to_regclass('public.v_ctl_c66') IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_MrpInclureStockMachine')
            AND EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'COCKPIT' AND champ = 'nb_plan_non_couvert')
            AND EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'STOCK' AND champ = 'plan_mois_kg')",
    ),
    (
        // Le fil en route est un arrivage (27/10/2026) : la date prevue de
        // disponibilite du transfert, obligatoire a l'expedition (TRF-DATE),
        // revisable tant qu'il roule, journalisee.
        "2026-10-27d_transit_date_disponibilite.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'transfert' AND column_name = 'date_disponibilite_prevue')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_transfert_date_disponibilite')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_transfert_date')",
    ),
    (
        // « Commander » branche sur le moteur de couverture (27/10/2026) : la date
        // limite de commande sur la proposition d'achat, les kilos hors
        // couverture des bons non valides et apres l'horizon declares.
        "2026-10-27c_commande_couverture.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'plan_achat' AND column_name = 'date_limite_commande')
            AND (SELECT count(*) FROM champ_configurable
                  WHERE module = 'PLAN_ACHAT' AND champ IN ('non_valide_kg', 'apres_horizon_kg')) = 2",
    ),
    (
        // L'OF sort du besoin MRP (decision du 26/10/2026) : le besoin est le plan
        // seul ; le fil sur machine compte au dernier constat quel que soit son age.
        "2026-10-27b_besoin_plan_seul.sql",
        "SELECT NOT EXISTS (SELECT 1 FROM pg_views
                             WHERE viewname IN ('v_besoin_horizon', 'v_besoin_12m', 'v_besoin_mois')
                               AND definition LIKE '%v_besoin_of_mois%')
            AND NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_stock_physique'
                                                     AND definition LIKE '%P_JoursInventMachine%')
            AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_besoin_of_mois')",
    ),
    (
        // Les colonnes de l'onglet « À commander » (moteur de couverture, 26/10/2026) :
        // sans elles, l'onglet s'affiche colonnes masquees, sans message.
        "2026-10-27a_couverture_champs.sql",
        "SELECT (SELECT count(*) FROM champ_configurable
                  WHERE module = 'PLAN_ACHAT'
                    AND champ IN ('disponible_kg', 'couvert_jusqu_au', 'premiere_rupture', 'plan_non_couvert_kg',
                                  'date_limite_commande', 'transit_kg')) = 6",
    ),
    (
        // La ligne de facture d'import recue figee tout entiere (24/10/2026) :
        // lot, couleur, bobines, palettes et libelle refuses aussi (IMPORT-FIGEE).
        "2026-10-24c_import_ligne_recue_figee.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_import_ligne_figee')
            AND COALESCE(position('libelle_couleur' IN
                    pg_get_functiondef(to_regproc('public.fn_trg_import_ligne_figee'))) > 0, false)",
    ),
    (
        // La liste d'un inventaire tournant ou cible (decision du 23/10/2026) :
        // inventaire_reference, proposition ABC du tournant (v_inventaire_candidat,
        // P_ComptageTournantA/B/C), lignes et gel limites aux references choisies.
        "2026-10-24b_inventaire_references_choisies.sql",
        "SELECT to_regclass('public.inventaire_reference') IS NOT NULL
            AND to_regclass('public.v_inventaire_candidat') IS NOT NULL
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'inventaire' AND column_name = 'date_selection')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_inventaire_selection')",
    ),
    (
        // Le gel selon le type d'inventaire (decision du 23/10/2026) : GLOBAL gele
        // le magasin, TOURNANT et CIBLE leurs seules references ; v_inventaire_gel
        // (lue par /api/inventaires/ouverts) ; C65 a la meme etendue ; theorique
        // d'une ligne d'inventaire au poids du lot.
        "2026-10-24a_inventaire_gel_par_reference.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_inventaire_gel_par_reference')
            AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_inventaire_ouvert_message' AND pronargs = 2)
            AND to_regclass('public.v_inventaire_gel') IS NOT NULL",
    ),
    (
        // Inventaire ouvert = magasin gele (decision du 23/10/2026) : aucun
        // mouvement tant qu'un inventaire du magasin est ouvert ; la cloture
        // rattache ses ajustements par `mouvement.id_inventaire`. C65.
        "2026-10-23g_inventaire_gel.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'mouvement' AND column_name = 'id_inventaire')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_01_lmvt_inventaire_ouvert')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_01_mouvement_inventaire_ouvert')
            AND to_regclass('public.v_ctl_c65') IS NOT NULL",
    ),
    (
        // La qualite explicite (23/10/2026) : sur la consommation directe et son
        // retour (avec ou sans OF), sur les lignes machine (nouvelle et de la
        // periode), statistiques par qualite sans OF, C62 au sens nouveau.
        "2026-10-23b_qualite_explicite.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'machine_decision_ligne' AND column_name = 'code_qualite_periode')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'machine_fiche_ligne' AND column_name = 'code_qualite')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mouvement_qualite')
            AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_qualite_conso_directe_reste')",
    ),
    (
        // Chaque lot a son conditionnement (23/10/2026) : poids d'une bobine et
        // bobines par palette du lot, mesures a la reception, corriges sur la
        // fiche du lot ; conversions au lot.
        "2026-10-23a_lot_conditionnement.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'lot' AND column_name = 'date_conditionnement')
            AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_lot_conditionnement_reception')
            AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_lot_poids_bobine')
            AND to_regclass('public.lot_conditionnement_journal') IS NOT NULL",
    ),
    (
        // L'OF, lot C (22/10/2026) : OF et voie sur l'etat archive des decisions,
        // nombre de bobines d'une voie, retour de consommation directe
        // (RETOUR_CONSO, borne en base), C62 et C63.
        "2026-10-22d_of_machines_hors_machine.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'machine_decision_etat' AND column_name = 'id_of')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lmvt_retour_conso')
            AND EXISTS (SELECT 1 FROM type_mouvement WHERE code_type_mvt = 'RETOUR_CONSO')
            AND to_regclass('public.v_ctl_c63') IS NOT NULL",
    ),
    (
        // L'OF, lot B (22/10/2026) : les vues du besoin par OF, les colonnes du
        // besoin du plan / au-dela du plan, C64. L'ajustement des OF dans le besoin
        // est retire par 2026-10-27b (le plan seul) : le temoin ne l'exige plus.
        // Ses vues du besoin par OF (vides) et v_stock_projete sont retirees par
        // 2026-10-27e : passee celle-ci, seul C64 reste a temoigner.
        "2026-10-22c_besoin_of.sql",
        "SELECT to_regclass('public.v_ctl_c64') IS NOT NULL
            AND (to_regclass('public.v_stock_reference') IS NOT NULL
                 OR (to_regclass('public.v_besoin_of_mois') IS NOT NULL
                     AND to_regclass('public.v_besoin_horizon_of') IS NOT NULL
                     AND EXISTS (SELECT 1 FROM information_schema.columns
                                  WHERE table_name = 'v_stock_projete' AND column_name = 'besoin_au_dela_12m_kg')))",
    ),
    (
        // L'OF, lot A (22/10/2026) : cycle garde en base, consommation reelle
        // par OF et par qualite (v_of_consommation, v_qualite_consommation), C61.
        "2026-10-22b_of_consommation.sql",
        "SELECT to_regclass('public.v_of_consommation') IS NOT NULL
            AND to_regclass('public.v_qualite_consommation') IS NOT NULL
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ordre_fabrication_cycle')",
    ),
    (
        // L'OF Supply Chain, le socle (22/10/2026) : ordre_fabrication, largeur
        // des machines, OF et voie sur les fiches, etats, decisions, mouvements.
        "2026-10-22a_ordre_fabrication_socle.sql",
        "SELECT to_regclass('public.ordre_fabrication') IS NOT NULL
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'machine_decision_ligne' AND column_name = 'id_of_periode')",
    ),
    (
        // Bon fige en attente de validation, une ligne par reference sur un bon,
        // une ligne de reception par lot, tuiles du circuit, C60 (21/10/2026).
        "2026-10-21d_bons_receptions_regles.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_bc_une_par_reference')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ligne_reception_un_lot')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bc_entete_figee')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c60')",
    ),
    (
        // La consommation directe (21/10/2026) : mode de consommation de la
        // fiche article, type CONSO_DIRECTE, garantie en base.
        "2026-10-21c_consommation_directe.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lmvt_conso_directe')
            AND EXISTS (SELECT 1 FROM type_mouvement WHERE code_type_mvt = 'CONSO_DIRECTE')",
    ),
    (
        // Le bon de commande passe par un controle et une demande de prix
        // (21/10/2026) : nouveaux etats, prix d'avant la demande, C59.
        "2026-10-21b_bc_demande_prix.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'ligne_bc'
                           AND column_name = 'prix_unitaire_avant_demande')
            AND EXISTS (SELECT 1 FROM transition_statut
                         WHERE entite = 'bon_commande' AND statut_source = 'EN_CONTROLE'
                           AND statut_cible = 'DEMANDE_PRIX')",
    ),
    (
        // Les indicateurs du plan d'achat, figes a la generation (21/10/2026).
        "2026-10-21a_indicateurs_plan_achat.sql",
        "SELECT to_regclass('public.plan_achat_indicateurs') IS NOT NULL",
    ),
    (
        // Verrou optimiste, groupe 3 (20/10/2026) : le serveur ecrit sous
        // condition de version les dossiers et factures d'import, factures et
        // retours fournisseur, parametres, machines.
        "2026-10-20c_verrou_groupe3.sql",
        "SELECT count(*) = 6 FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'version'
            AND table_name IN ('import_dossiers', 'import_factures', 'facture_fournisseur',
                               'retour_fournisseur', 'parametre', 'machine')",
    ),
    (
        // Le jour de Casablanca (20/10/2026) : le serveur accepte un fait du
        // jour marocain ; la regle C06 en base doit compter le meme jour.
        "2026-10-20b_jour_casablanca.sql",
        "SELECT pg_get_triggerdef(oid) ~ 'Africa/Casablanca' FROM pg_trigger
          WHERE tgname = 'trg_mouvement_date_future'",
    ),
    (
        // A1, horodatages (20/10/2026) : les 93 dernieres colonnes de date en
        // texte sont des `timestamptz`. Le serveur les ecrit par fn_instant ou
        // now() et les lit par fn_iso, le meme texte ISO qu'avant.
        "2026-10-20a_horodatages_types.sql",
        "SELECT to_regprocedure('fn_instant(text)') IS NOT NULL
            AND (SELECT data_type FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'bon_commande'
                    AND column_name = 'date_validation') = 'timestamp with time zone'",
    ),
    (
        // A1, troisieme lot (19/10/2026) : seize colonnes de jour encore vides
        // (fabrication et peremption, retour, facture fournisseur, frais,
        // engagement, paiement, transfert, valorisation, constat machine) sont
        // des `date` ; le serveur les ecrit par fn_jour_casablanca.
        "2026-10-19i_dates_typees_lot3.sql",
        "SELECT (SELECT data_type FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ligne_reception'
                    AND column_name = 'date_fabrication') = 'date'
            AND (SELECT data_type FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'transfert'
                    AND column_name = 'date_transfert') = 'date'",
    ),
    (
        // A1, deuxieme lot (19/10/2026) : vingt colonnes de dates (reception,
        // fiche machine, livraison prevue, cours BAM…) sont des `date` ; le serveur
        // les compare a current_date et les ecrit par fn_jour_casablanca.
        "2026-10-19h_dates_typees_lot2.sql",
        "SELECT (SELECT data_type FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'reception'
                    AND column_name = 'date_reception') = 'date'
            AND (SELECT data_type FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'machine_fiche'
                    AND column_name = 'date_fiche') = 'date'",
    ),
    (
        // A1, premier lot (19/10/2026) : date_mouvement, date_bc, date_debut / date_fin
        // des taux et date_derniere_sortie sont des `date` ; le serveur les ecrit par
        // `fn_jour_casablanca`. Sans la migration, toute ecriture de mouvement tombe.
        "2026-10-19g_dates_typees_lot1.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_jour_casablanca')
            AND (SELECT data_type FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'mouvement'
                    AND column_name = 'date_mouvement') = 'date'",
    ),
    (
        // Decision du 19/10/2026 : le verrou optimiste sur les 17 referentiels.
        // `crud::modifier` et `crud::supprimer` lisent `version` : sans la
        // colonne, toute fiche refuserait de s'enregistrer.
        "2026-10-19c_verrou_referentiels.sql",
        "SELECT (SELECT count(*) FROM pg_trigger
                  WHERE tgname = 'trg_aa_version' AND NOT tgisinternal) >= 23
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reference'
                           AND column_name = 'version')",
    ),
    (
        // Audit P3 : les etiquettes de lot. Generer et scanner lisent
        // `etiquette_lot` et `v_etiquette_lot`.
        "2026-10-19b_etiquettes_lot.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.views
                         WHERE table_schema = 'public' AND table_name = 'v_etiquette_lot')",
    ),
    (
        // Audit P3 : les positions tarifaires. La repartition des frais d'un
        // dossier d'import (`domain::importation`) lit `position_tarifaire` et
        // `parametres_frais.entre_valeur_douane` ; sans elles, tout recalcul
        // d'un dossier tombe en erreur interne.
        "2026-10-19a_positions_tarifaires.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'parametres_frais'
                           AND column_name = 'entre_valeur_douane')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reference'
                           AND column_name = 'code_sh')
            AND EXISTS (SELECT 1 FROM information_schema.views
                         WHERE table_schema = 'public' AND table_name = 'v_import_droits_dossier')",
    ),
    (
        // Audit A2 : le verrou optimiste. `domain::concurrence::exiger_version`
        // lit `version` sur les six documents a workflow ; sans la colonne,
        // chaque enregistrement d'un bon ou d'une reception tombe en erreur
        // interne. Le temoin exige aussi le declencheur : sans lui la colonne
        // n'avance jamais, et le verrou ne refuserait rien.
        "2026-10-17d_verrou_optimiste.sql",
        "SELECT (SELECT count(*) FROM information_schema.columns
                  WHERE table_schema = 'public' AND column_name = 'version'
                    AND table_name IN ('bon_commande', 'reception', 'inventaire',
                                       'transfert', 'plan_production', 'qualite')) = 6
            AND (SELECT count(*) FROM pg_trigger
                  WHERE tgname = 'trg_aa_version' AND NOT tgisinternal
                    AND tgrelid::regclass::text IN ('bon_commande', 'reception', 'inventaire',
                                                    'transfert', 'plan_production', 'qualite')) = 6",
    ),
    (
        // ADR-003 phase B : la facture fournisseur est un document. Sans ses
        // tables, l'ecran et sa validation tombent.
        "2026-10-14d_facture_fournisseur.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables
                         WHERE table_schema = 'public' AND table_name = 'facture_fournisseur')
            AND EXISTS (SELECT 1 FROM information_schema.views
                         WHERE table_schema = 'public' AND table_name = 'v_facture_rapprochement')",
    ),
    (
        // ADR-003 phase C : les frais d'approche d'un arrivage local vont au
        // CMUP, chacun selon sa cle. Sans la colonne, la cloture tombe.
        "2026-10-14c_frais_approche_cmup.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'frais_approche'
                           AND column_name = 'date_portee')",
    ),
    (
        // ADR-003 phase C : l'import se recoit par l'arrivage. L'etancheite
        // local/import depend du circuit du dossier ; sans cette migration, un
        // dossier bascule refuserait ses propres pesees.
        "2026-10-14b_import_sur_arrivage.sql",
        // `pg_get_functiondef` sur un regproc absent LEVE : on passe par pg_proc,
        // qui ne rend simplement aucune ligne.
        "SELECT EXISTS (SELECT 1 FROM pg_proc p
                         WHERE p.proname = 'fn_trg_reception_locale_hors_import'
                           AND pg_get_functiondef(p.oid) LIKE '%circuit_reception%')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'import_dossiers'
                           AND column_name = 'circuit_reception'
                           AND column_default LIKE '%BON%')",
    ),
    (
        // ADR-003 phase A : la reception est un arrivage, rattache a un dossier
        // d'import. Sans la colonne, toute creation de reception tombe.
        "2026-10-14a_reception_arrivage.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reception'
                           AND column_name = 'id_dossier_import')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'bon_commande'
                           AND column_name = 'id_reception_regularisee')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'import_dossiers'
                           AND column_name = 'circuit_reception')",
    ),
    (
        // Le complement de palette est fige sur la proposition : la liste du
        // plan d'achat ne recalcule plus le MRP a l'ouverture.
        "2026-10-14_plan_achat_complement_palette.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'plan_achat'
                           AND column_name = 'complement_palette_kg')",
    ),
    (
        "2026-10-03b_multiple_achat_palette.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reference'
                           AND column_name = 'arrondi_palette')",
    ),
    (
        "2026-10-03c_suivi_conditionnement.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_suivi_conditionnement')",
    ),
    (
        "2026-10-05_decisions_machine.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'machine_decision_ligne'
                           AND column_name = 'pourcentage_theorique')",
    ),
    (
        "2026-10-05b_recommandations_audit.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_cmup_annuler_entree')",
    ),
    (
        "2026-10-06_preferences_utilisateur.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables
                         WHERE table_schema = 'public' AND table_name = 'preference_utilisateur')",
    ),
    (
        // Controle des receptions d'import (statut_qualite), annulation
        // d'inventaire (motif_annulation), tolerance de pesee, montants du fil.
        "2026-10-08_regles_p1.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'import_reception_lignes'
                           AND column_name = 'statut_qualite')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'inventaire'
                           AND column_name = 'motif_annulation')
            AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_tolerance_pesee')
            -- Les dernieres sections aussi (audit v4) : sans elles, la cloture
            -- locale et l'expiration des propositions ecartees tombaient en
            -- « erreur interne » sur une base a demi migree.
            AND EXISTS (SELECT 1 FROM information_schema.tables
                         WHERE table_schema = 'public' AND table_name = 'reception_ajustements_cmup')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'plan_achat'
                           AND column_name = 'date_ecartee')",
    ),
    (
        // Corrections de l'audit v4 : niveau d'ecart machine archive, stock
        // machine dans le MRP, derogation d'import, cloture en devise et avoir,
        // controle C44. Le temoin porte sur la DERNIERE section.
        "2026-10-08b_audit_v4.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'machine_decision_ligne'
                           AND column_name = 'niveau_ecart')
            -- Le stock MRP net et v_besoin_horizon sont retires par 2026-10-27e
            -- (le moteur de couverture) : passee celle-ci, ils ne temoignent plus.
            AND (to_regclass('public.v_stock_reference') IS NOT NULL
                 OR (EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema = 'public' AND table_name = 'v_stock_physique'
                                AND column_name = 'stock_mrp_net_kg')
                     AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_besoin_horizon'
                                                          AND definition LIKE '%reste_mois%')))
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'import_reception_lignes'
                           AND column_name = 'derogation_ecart')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reception_ajustements_cmup'
                           AND column_name = 'origine')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c44')
            AND EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_DechetSeuilValiderKg')",
    ),
    (
        // La derogation de lot bloque : le service lit date_consommation.
        "2026-10-08e_lots_derogation.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'demande_autorisation'
                           AND column_name = 'date_consommation')",
    ),
    (
        // La revalidation d'une reception : archive versionnee, vue courante.
        "2026-10-08g_revalidation_reception.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_archive_reception_courante')",
    ),
    (
        // La numerotation : tout document numerote passe par le compteur.
        "2026-10-08k_compteur_numero.sql",
        "SELECT to_regclass('public.compteur_numero') IS NOT NULL",
    ),
    (
        // Sessions : la connexion et chaque requete lisent ces deux colonnes.
        "2026-10-08j_sessions.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'utilisateur'
                           AND column_name = 'mot_de_passe_change_le')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'utilisateur'
                           AND column_name = 'totp_dernier_pas')
            -- Le declencheur qui pose la date : sans lui, la revocation des
            -- autres sessions disparait en silence (audit v5).
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_utilisateur_mdp_change')",
    ),
    // LES INVARIANTS SANS LESQUELS LE SERVICE MARCHE QUAND MEME (audit v5, T4) :
    // le binaire ne lit pas leurs colonnes, mais sans eux il accepterait en
    // silence ce que la base devait refuser. Ils sont donc exiges aussi.
    (
        // L'audit des tables d'argent.
        "2026-10-08d_audit_tables_argent.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                         WHERE c.relname = 'ligne_bc' AND t.tgname = 'trg_audit_modification')",
    ),
    (
        // Facture d'import figee et etancheite local / import.
        "2026-10-08f_import_coherence.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_import_facture_figee')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_import_hors_reception_locale')",
    ),
    (
        // L'en-cours complet et l'horizon prolonge du plan d'achat.
        // L'ancien calcul qui les lisait est retire par 2026-10-27e (le moteur de
        // couverture) et les deux parametres, sans lecteur, sont supprimes par
        // 2026-10-27j : passee 27e, ils ne temoignent plus.
        "2026-10-08h_planification_encours.sql",
        "SELECT to_regclass('public.v_stock_reference') IS NOT NULL
             OR (EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_HorizonProlonge')
                 AND EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_EncoursRetardInclus'))",
    ),
    (
        // Dates vides, tolerance au droit VALIDER, modele de droits, mouvement
        // machine annule par sa seule fiche.
        "2026-10-09a_gardes_p1.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_mouvement_machine_annulation')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_00_date_vide')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c46')",
    ),
    (
        // La sortie hors machine et le pret : le service ecrit mouvement.tiers.
        "2026-10-09d_sortie_hors_machine.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'mouvement'
                           AND column_name = 'tiers')
            AND EXISTS (SELECT 1 FROM type_mouvement WHERE code_type_mvt = 'RETOUR_PRET')",
    ),
    (
        // Le fil charge deja consomme, liste par le controle C48.
        "2026-10-09e_machine_surplus.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c48')",
    ),
    (
        // Le controle des receptions : renvoi motive, dernier peseur.
        "2026-10-09f_controle_reception.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reception'
                           AND column_name = 'motif_renvoi')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'import_receptions'
                           AND column_name = 'motif_renvoi')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reception_valideur_pas_peseur')",
    ),
    (
        // Avoirs types et retours dans la cloture : le service lit v_retours_reception.
        "2026-10-09g_avoirs_retours.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_retours_reception')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reception_ajustements_cmup'
                           AND column_name = 'id_mouvement_retour')",
    ),
    (
        // La vie du dossier d'import : frais post-cloture (colonnes lues et ecrites).
        "2026-10-09h_dossier_import.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'dossier_lignes_frais'
                           AND column_name = 'motif_post_cloture')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_import_dum_permanente')",
    ),
    (
        // Le prix des propositions : dernier achat, catalogue, puis CMUP.
        "2026-10-09j_prix_plan_achat.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_dernier_prix_achat_mad')",
    ),
    (
        // La saison, les alertes C49/C50. Sa vue des stocks minimums a revoir est
        // retiree par 2026-10-27l : le temoin ne retient que la saison.
        "2026-10-09k_saisonnalite.sql",
        "SELECT to_regclass('public.saison_mois') IS NOT NULL",
    ),
    (
        // Le taux engage d'un bon, justifie : le service ecrit ces colonnes.
        "2026-10-09l_taux_bon_commande.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'bon_commande'
                           AND column_name = 'source_taux_engage')",
    ),
    (
        // Le retour fournisseur, document a part ; ses routes en dependent.
        "2026-10-12b_retours_fournisseur.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_retour_fournisseur_garde')",
    ),
    (
        // Audit de securite : sessions tenues par le serveur, double
        // authentification exigee par role, role Administrateur garde.
        "2026-10-13c_securite.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_utilisateur_garde_role')
            AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'session_ouverte')",
    ),
    (
        // L'inventaire comme un bon : brouillon, valide, cloture.
        "2026-10-13b_inventaire_valide.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventaire_separation')",
    ),
    (
        // Les roles se reglent a l'ecran ; l'origine des droits (modele/manuel).
        "2026-10-13a_roles_permissions.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'droit_champ'
                           AND column_name = 'origine')",
    ),
    (
        // La repartition choisie sur la ligne de frais (manuelle possible).
        "2026-10-12a_repartition_frais.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'dossier_lignes_frais'
                           AND column_name = 'methode_repartition')",
    ),
    (
        // Chaque sortie porte son cout (CMUP du moment) dans le grand livre.
        "2026-10-10c_cout_des_sorties.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lmvt_cout_sortie')",
    ),
    (
        // Le fil en route : calcul des besoins, valeur du stock, C54 ; le catalogue le lit.
        "2026-10-10b_stock_en_route.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_stock_transit_reference')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c54')",
    ),
    (
        // C53 : un paiement d'import date avant le dedouanement (A11) ; la saisie le lit.
        "2026-10-10a_paiement_avant_dedouanement.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c53')",
    ),
    (
        // La colonne « Voir le calcul » du plan d'achat, declaree dans la grille.
        "2026-10-09za_champ_calcul.sql",
        "SELECT EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'PLAN_ACHAT' AND champ = 'calcul')",
    ),
    (
        // Le type d'un parametre garanti par la base.
        "2026-10-09z_parametres_types.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_00_parametre_type')",
    ),
    (
        // Audit des cours BAM et des comptages ; lot_evenement immuable ; purge du plan resumee.
        "2026-10-09y_audit_complete.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lot_evenement_immuable')
            AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_audit_modification'
                          AND t.tgrelid = 'cours_bam'::regclass)",
    ),
    (
        // Les montants de l'import declares, masques au magasinier.
        "2026-10-09x_import_montants_declares.sql",
        "SELECT EXISTS (SELECT 1 FROM champ_configurable WHERE module = 'IMPORT' AND champ = 'montant_dhs')",
    ),
    (
        // Une reception cloturee ne se rouvre plus (transition retiree).
        "2026-10-09w_reception_cloturee_definitive.sql",
        "SELECT NOT EXISTS (SELECT 1 FROM transition_statut WHERE entite = 'reception'
                              AND statut_source = 'CLOTURE' AND statut_cible = 'A_CONTROLER')",
    ),
    (
        // L'historique des prix suit la revalidation (revisions, vue courante).
        "2026-10-09v_historique_prix_revise.sql",
        "SELECT to_regclass('public.historique_prix_revision') IS NOT NULL
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_historique_prix_courant')",
    ),
    (
        // Le bon recale apres une contre-passation ; C52.
        "2026-10-09u_bon_apres_contrepassation.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_recaler_lignes_bc')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c52')",
    ),
    (
        // Une ligne de facture d'import ne vise qu'un bon envoye.
        "2026-10-09t_import_bon_envoye.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_import_ligne_bon')",
    ),
    (
        // Lots : un lot solde qui recoit se rouvre ; pas de solde avec du fil sur machine ; C51.
        "2026-10-09s_lots_vivants.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lot_pas_solde_sur_machine')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c51')
            AND to_regclass('public.ux_demande_en_attente') IS NOT NULL",
    ),
    (
        // C35 et C36 sur l'etat des machines (machine_etat).
        "2026-10-09r_controles_machine.sql",
        "SELECT position('machine_etat' IN pg_get_viewdef('v_ctl_c36'::regclass)) > 0",
    ),
    (
        // Receptions cloturees dans le cout de revient et C31/C32 ; v_ecart_prix.
        "2026-10-09q_ecart_prix.sql",
        "SELECT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ecart_prix')
            AND position('CLOTURE' IN pg_get_viewdef('v_ctl_c31'::regclass)) > 0",
    ),
    (
        // La derogation de lot bornee en kilos, tombee avec sa fiche.
        "2026-10-09p_derogation_bornee.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'demande_autorisation' AND column_name = 'kg_autorises')
            AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fiche_derogations')",
    ),
    (
        // Plan d'achat : C28 au libelle du reglage, brouillons d'import hors en-cours.
        // v_encours_fiable est retiree par 2026-10-27e (le moteur de couverture).
        "2026-10-09o_plan_detail.sql",
        "SELECT to_regclass('public.v_stock_reference') IS NOT NULL
             OR COALESCE((SELECT position('BROUILLON' IN pg_get_viewdef(c.oid)) > 0
                            FROM pg_class c WHERE c.relname = 'v_encours_fiable' AND c.relkind = 'v'), false)",
    ),
    (
        // L'avoir d'import : origine du journal du dossier, retours soldes.
        "2026-10-09n_avoir_import.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'import_ajustements_cump' AND column_name = 'origine')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_retours_import')",
    ),
    (
        // Les paiements d'import et le cout de revient reel.
        "2026-10-09m_cout_revient_reel.sql",
        "SELECT to_regclass('public.paiement_facture_import') IS NOT NULL
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_cout_revient_reel')",
    ),
    (
        // La supervision complete : /api/supervision lit sens, cible, vigilance.
        "2026-10-09b_supervision_rejouee.sql",
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'v_supervision'
                           AND column_name = 'vigilance')",
    ),
];

async fn verifier_schema(pool: &Db) -> anyhow::Result<()> {
    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    )
    .fetch_one(pool)
    .await?;
    if tables < 40 {
        anyhow::bail!(
            "schema incomplet ({} tables) : charger db/pg avec charger.py avant de demarrer",
            tables
        );
    }

    let vues: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public'",
    )
    .fetch_one(pool)
    .await?;
    if vues < 60 {
        anyhow::bail!(
            "vues manquantes ({} sur 73) : le pilotage serait muet sans erreur visible",
            vues
        );
    }

    // Les declencheurs d'audit portent la tracabilite : sans eux le service
    // fonctionne parfaitement et n'enregistre rien. C'est exactement le genre
    // d'absence qu'on ne remarque pas.
    let declencheurs: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT trigger_name) FROM information_schema.triggers
          WHERE trigger_schema = 'public'",
    )
    .fetch_one(pool)
    .await?;
    if declencheurs < 70 {
        anyhow::bail!(
            "declencheurs manquants ({} sur 76) : les regles metier ne seraient plus appliquees",
            declencheurs
        );
    }

    // LES MIGRATIONS SE JOUENT A LA MAIN, SANS TABLE DE SUIVI : un binaire neuf
    // sur une base qui ne l'a pas suivie demarre sans broncher, puis repond
    // « erreur interne » a chaque geste touche (05/10/2026, fiches machine).
    // Mieux vaut refuser de demarrer en nommant TOUS les fichiers a jouer, dans l'ordre.
    let mut manquantes = Vec::new();
    for (fichier, temoin) in MIGRATIONS_REQUISES {
        let presente: bool = sqlx::query_scalar(temoin).fetch_one(pool).await?;
        if !presente {
            manquantes.push(format!("db/pg/migrations/{fichier}"));
        }
    }
    if !manquantes.is_empty() {
        anyhow::bail!(
            "migration(s) manquante(s), a jouer dans cet ordre sur cette base (apres sauvegarde) \
             avant de demarrer ce serveur : {}",
            manquantes.join(", ")
        );
    }

    // LE TEMPS EST TYPE (A1, 20/10/2026) : plus une colonne de date en texte. Une
    // migration qui en recreerait une — copiee d'un ancien fichier — rouvrirait
    // les dates mal formees et les comparaisons de chaines : refus de demarrer,
    // en la nommant. Une colonne de date nait en `date` ou `timestamptz`.
    let dates_texte: Option<String> = sqlx::query_scalar(
        "SELECT string_agg(c.table_name || '.' || c.column_name, ', ' ORDER BY 1)
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
            AND c.data_type = 'text'
            AND (c.column_name ~ '^date_' OR c.column_name ~ '_date$')",
    )
    .fetch_one(pool)
    .await?;
    if let Some(liste) = dates_texte {
        anyhow::bail!(
            "colonne(s) de date en texte : {liste}. Une date se declare en `date` (un jour) ou `timestamptz` (un instant) ; voir 2026-10-20a_horodatages_types.sql"
        );
    }

    Ok(())
}

/// Renseigne l'identite de l'appelant pour les declencheurs d'audit.
///
/// A appeler en TOUT DEBUT de transaction ecrivante, avant la premiere
/// ecriture : les declencheurs lisent ces variables au moment ou ils
/// s'executent.
///
/// Le troisieme argument de `set_config` vaut `true` : la variable est LOCALE A
/// LA TRANSACTION. Elle disparait au COMMIT et reste invisible aux autres
/// connexions du pool — c'est ce qui empeche deux utilisateurs simultanes de se
/// voler leur identite dans le journal.
pub async fn poser_contexte(
    tx: &mut sqlx::PgConnection,
    id_utilisateur: &str,
    adresse_ip: Option<&str>,
    session_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "SELECT set_config('gestionfil.id_utilisateur', $1, true),
                set_config('gestionfil.adresse_ip',     COALESCE($2, ''), true),
                set_config('gestionfil.session_id',     COALESCE($3, ''), true)",
    )
    .bind(id_utilisateur)
    .bind(adresse_ip)
    .bind(session_id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Horodatage au format canonique de la base : ISO-8601 UTC (ADR-001 D-11).
pub fn maintenant() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Un instant a venir, au meme format que `maintenant()`.
///
/// Les dates sont stockees en texte ISO : deux instants se comparent donc
/// directement, sans conversion, y compris en SQL.
pub fn dans_secondes(secondes: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(secondes))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// LE JOUR EST CELUI DE CASABLANCA (decision du 20/10/2026) : l'usine, les
/// postes et la base y vivent. Un fait saisi a 0 h 30 heure du Maroc est du
/// jour, pas de la veille comme en UTC. Les INSTANTS, eux, restent en UTC
/// (`maintenant`), le type `timestamptz` ne depend d'aucun fuseau.
pub fn jour_casablanca() -> chrono::NaiveDate {
    jour_casablanca_de(chrono::Utc::now())
}

fn jour_casablanca_de(instant: chrono::DateTime<chrono::Utc>) -> chrono::NaiveDate {
    instant.with_timezone(&chrono_tz::Africa::Casablanca).date_naive()
}

#[cfg(test)]
mod tests_jour {
    use super::jour_casablanca_de;
    use chrono::{NaiveDate, TimeZone, Utc};

    #[test]
    fn minuit_et_demi_au_maroc_est_deja_le_lendemain() {
        // 23 h 30 UTC le 19/10 = 0 h 30 a Casablanca (UTC+1) le 20/10.
        let i = Utc.with_ymd_and_hms(2026, 10, 19, 23, 30, 0).unwrap();
        assert_eq!(jour_casablanca_de(i), NaiveDate::from_ymd_opt(2026, 10, 20).unwrap());
        let midi = Utc.with_ymd_and_hms(2026, 10, 19, 12, 0, 0).unwrap();
        assert_eq!(jour_casablanca_de(midi), NaiveDate::from_ymd_opt(2026, 10, 19).unwrap());
    }
}

/// Date calendaire du jour (Casablanca), format base.
pub fn aujourdhui() -> String {
    jour_casablanca().format("%Y-%m-%d").to_string()
}

/// Arrondi a 4 decimales : quantites en kg et CMUP (ADR-001 D-10).
pub fn arrondi_kg(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

/// Arrondi a 2 decimales : montants en MAD (ADR-001 D-10).
pub fn arrondi_mad(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
