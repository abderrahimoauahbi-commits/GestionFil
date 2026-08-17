//! Services metier.
//!
//! Repartition des responsabilites (ADR-001 D-04) : la base porte les
//! invariants (solde de stock, CMUP, immuabilite, transitions, audit), ce
//! module porte les orchestrations (cascades, calculs, generations).

pub mod classification;
pub mod inventaire;
pub mod mrp;
pub mod plan;
pub mod plan_achat;
pub mod reception;
pub mod transfert;
pub mod unites;
