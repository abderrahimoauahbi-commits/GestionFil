# Décidé — verrou optimiste sur toutes les tables de base

> Statut : **décidé le 19/10/2026** — l'utilisateur retient les quatre conseils ci-dessous.
> Rédigé le 19/10/2026, à sa demande.

## La demande

Un verrou automatique sur les enregistrements de **toutes les tables de base**, et seulement
celles-là, pour toute écriture : modification et suppression.

## Ce qui existe aujourd'hui

- La colonne `version` et son déclencheur (`trg_aa_version`) sont sur 6 tables : `bon_commande`,
  `reception`, `inventaire`, `transfert`, `plan_production`, `qualite` (migration `2026-10-17d`).
- Le **refus** (409 qui nomme l'auteur et l'heure) n'est branché que sur **2** d'entre elles : bon de
  commande et réception (`domain/concurrence.rs` → `exiger_version`).
- Les autres tables modifiables n'ont rien : deux saisies concurrentes s'écrasent en silence.

## Le périmètre proposé

| Groupe | Tables | Comment |
|---|---|---|
| **1. Référentiels** (CRUD générique) | les 17 de `crud.rs` : `reference`, `fournisseur`, `magasin`, `famille`, `categorie_matiere`, `couleur`, `couleur_fournisseur`, `conditionnement`, `groupe_equiv`, `reference_groupe_equiv`, `role_bom`, `type_mouvement`, `motif_mouvement`, `motif_ligne`, `parametres_frais`, `position_tarifaire`, `saison_mois` | **Un seul point de code** : la modification et la suppression génériques (`routes/entites.rs`), et `hooks/useCrud.ts` côté écran. Toutes les tables d'un coup. |
| **2. Documents à workflow** | `inventaire`, `transfert`, `plan_production`, `qualite` (la colonne y est déjà) | Brancher le refus dans leurs routes et leurs écrans, comme pour le bon. |
| **3. Autres tables modifiables** | `parametre`, `utilisateur`, `role`, dossiers d'import, factures fournisseur, retours, machines… | À lister avant de coder. |

**Exclues, et pourquoi :**
- **Tables immuables** (grand livre, audit, décisions machine, étiquettes) : elles ne se
  modifient jamais. Les déclencheurs le refusent déjà.
- **Tables recalculées** (`stock_magasin`, propositions du plan d'achat, résultats du MRP) : le
  moteur les réécrit à chaque calcul. Un verrou y produirait de faux conflits.
- **Tables techniques** (compteurs, sessions, journaux) : sans objet.

## Mon avis

1. **Oui pour les groupes 1 et 2.** Le groupe 1 se fait en une fois pour les 17 tables, par le
   chemin générique. C'est le meilleur rapport coût / protection. Le groupe 2 finit ce qui est
   commencé.
2. **La suppression aussi.** *(Corrigé à l'implémentation : la route de suppression efface
   réellement la ligne quand rien ne la retient ; la mise à l'état inactif est une modification à
   part. Les deux passent donc par le verrou : la version voyage dans l'adresse,
   `DELETE …?version=N`.)*
3. **Les lignes d'un document passent par leur en-tête.** Modifier une ligne de bon fait avancer
   la version du bon, et c'est le bon qui se verrouille. Mettre un verrou sur chaque ligne
   multiplierait les conflits pour rien.
4. **Rendre la version obligatoire pour les écrans.** Aujourd'hui, un appel sans version passe,
   pour ne pas casser les scripts. Je propose qu'elle soit exigée des écrans, et que seuls les
   outils d'administration et d'import en soient dispensés.
5. **Le coût, une estimation :** groupe 1 ≈ 2 j-h, groupe 2 ≈ 2 j-h, groupe 3 ≈ 3 j-h. Chaque
   groupe aura son scénario de banc : deux saisies concurrentes, la seconde refusée.

## Ce que l'utilisateur doit trancher

- [x] Le périmètre : **groupes 1 et 2** (le groupe 3 reste à lister, plus tard).
- [x] Les lignes : **verrou sur l'en-tête du document**.
- [x] La version : **obligatoire pour les écrans** ; les outils d'administration et d'import en sont dispensés.
- [x] Les exclusions : **d'accord**.

## Ce qui a été fait (19/10/2026)

- **Migration `2026-10-19c_verrou_referentiels.sql`** (exigée au démarrage) : colonne `version`
  et déclencheur `trg_aa_version` sur les 17 référentiels. La version n'avance **que si une donnée
  saisie change** : les colonnes que le système réécrit (CMUP, classes ABC/XYZ, délais réels du
  fournisseur) sont exclues de la comparaison, sans quoi chaque réception validée rendrait une
  fiche périmée — un faux conflit. Une mise à jour à l'identique ne la fait pas avancer non plus.
- **Serveur** : la version est **obligatoire** (400 si absente, 409 si périmée, nommant l'auteur)
  sur la modification et la suppression génériques, la suppression définitive d'une référence, le
  transfert (modification, abandon), le plan (enregistrement d'un plan existant, suppression), la
  qualité (enregistrement, modification, suppression, densités), et l'en-tête du bon et de la
  réception (jusqu'ici facultative). La modification rend la nouvelle version.
- **Écrans** : formulaires de référentiel, maître-détail, suppression, correction d'une référence
  depuis un bon, complétion du catalogue, saisonnalité et stocks minimums, équivalences, plans,
  qualités, transferts.
- **Preuve** : scénario de banc `verrou_referentiels` — une réception validée ne rend pas la fiche
  périmée ; deux saisies sur une référence, la seconde refusée et la première intacte ; sans
  version, refus et rien d'écrit ; suppression périmée refusée ; transfert et qualité idem.

## Restent hors du verrou, et pourquoi

- **Le comptage d'inventaire.** Plusieurs compteurs saisissent en même temps des lignes
  différentes ; un verrou sur l'en-tête les bloquerait entre eux. Il n'y a pas de route qui
  modifie l'en-tête d'un inventaire.
- **Le réordonnancement d'un groupe d'équivalences** : une action d'ensemble sur plusieurs
  rattachements, non verrouillée.
- **Les utilisateurs** : seul l'administrateur les modifie ; le mot de passe a sa route (décision
  du 20/10/2026).
- **Les fiches de saisie machine** : leur verrou est la fiche puis l'étage (`FOR UPDATE NOWAIT`),
  et seule la décision tête se retire (décision du 20/10/2026).

## Les lignes d'un bon et d'une réception (19/10/2026)

Option 1 retenue : chaque route de ligne prend l'en-tête sous condition de version et renvoie la
nouvelle ; l'écran enchaîne les versions (`suivre()`).

## Le groupe 3 (décision du 20/10/2026)

Migration `2026-10-20c_verrou_groupe3.sql`, exigée au démarrage :

- **Documents à lignes** — dossiers d'import, factures d'import, factures fournisseur, retours
  fournisseur, machine et ses zones : déclencheur `fn_trg_version_document`, la version avance à
  CHAQUE écriture, y compris la prise sous verrou qui précède l'enregistrement des lignes. Seule
  exception : une écriture du système qui ne change que des colonnes calculées
  (`import_factures.statut_reception`). Les frais, engagements, paiements, pièces et la clôture
  d'un dossier passent par le verrou du dossier ; une facture d'import et ses lignes par celui de
  la facture.
- **Le paramètre** (une ligne) : `fn_trg_version_si_saisie`, comme les référentiels ; l'écran de
  configuration fige la version à la première frappe.
- Les validations (facture, retour) ne demandent pas la version : leur changement de statut est
  déjà gardé par la base et le verrou de ligne.
