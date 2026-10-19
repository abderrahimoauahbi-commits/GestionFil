//! Services metier.
//!
//! Repartition des responsabilites (ADR-001 D-04) : la base porte les
//! invariants (solde de stock, CMUP, immuabilite, transitions, audit), ce
//! module porte les orchestrations (cascades, calculs, generations).

pub mod classification;
pub mod concurrence;
pub mod cours_bam;
pub mod decision_machine;
pub mod facture_fournisseur;
pub mod facture_locale;
pub mod idempotence;
pub mod importation;
pub mod inventaire;
pub mod mrp;
pub mod numerotation;
pub mod plan;
pub mod plan_achat;
pub mod reception;
pub mod retour_fournisseur;
pub mod sauvegarde;
pub mod transfert;
pub mod transitions;
pub mod unites;
