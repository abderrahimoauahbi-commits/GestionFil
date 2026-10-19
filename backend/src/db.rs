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
        // Le fuseau de la SESSION, pas celui du serveur. Toutes les dates du
        // schema sont du texte ISO-8601 en UTC (ADR-001 D-11) : un serveur
        // regle sur Europe/Paris ferait rendre a `current_date` une date
        // decalee d'un jour pendant deux heures chaque nuit.
        //
        // L'ENCODAGE DU CLIENT EST FORCE EN UTF-8. Sans cela, libpq prend celui
        // du systeme : sous Windows c'est WIN1252, et un tiret cadratin ou un
        // accent parti d'un programme Rust — ou tout est UTF-8 par construction
        // — revient de la base en « â€” ». Le serveur Linux n'avait pas le
        // probleme, l'outil d'import lance depuis un poste de developpement si.
        // Un encodage qui depend de la machine qui lance l'outil n'est pas un
        // reglage, c'est un piege.
        .options([("timezone", "UTC"), ("client_encoding", "UTF8")])
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
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'v_stock_physique'
                           AND column_name = 'stock_mrp_net_kg')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'import_reception_lignes'
                           AND column_name = 'derogation_ecart')
            AND EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'reception_ajustements_cmup'
                           AND column_name = 'origine')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_ctl_c44')
            AND EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_DechetSeuilValiderKg')
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_besoin_horizon'
                                                 AND definition LIKE '%reste_mois%')",
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
        "2026-10-08h_planification_encours.sql",
        "SELECT EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_HorizonProlonge')
            AND EXISTS (SELECT 1 FROM parametre WHERE code_parametre = 'P_EncoursRetardInclus')",
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
        // La saison, les alertes C49/C50, les stocks minimums a revoir.
        "2026-10-09k_saisonnalite.sql",
        "SELECT to_regclass('public.saison_mois') IS NOT NULL
            AND EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_stocks_minimums_a_revoir')",
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
        "2026-10-09o_plan_detail.sql",
        "SELECT position('BROUILLON' IN pg_get_viewdef('v_encours_fiable'::regclass)) > 0",
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

/// Date calendaire du jour, format base.
pub fn aujourdhui() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

/// Arrondi a 4 decimales : quantites en kg et CMUP (ADR-001 D-10).
pub fn arrondi_kg(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

/// Arrondi a 2 decimales : montants en MAD (ADR-001 D-10).
pub fn arrondi_mad(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
