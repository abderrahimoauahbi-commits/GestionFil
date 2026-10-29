# ERP Gestion Fil — couche base de données

Polyfashions Carpet Morocco · pilotage des achats, stocks et production de matières premières.

**PostgreSQL 18** — SQLite a ete abandonne le 4 septembre 2026. `db/pg/` est la source ;
toute evolution s'y ecrit ET dans un fichier date de `db/pg/migrations/`.

---

## Démarrage

```powershell
cd db\pg
python charger.py --base <base> --seeds    # --base OBLIGATOIRE : aucune base par défaut (17/10/2026)
python charger.py --base gestionfil_essai  # une autre base
python charger.py --base <base> --production   # comptes réels, référentiel à importer ensuite
```

Le chargeur joue les fichiers PAR PASSES : les vues se citent en avant, et PostgreSQL
résout à la création.

### Une base neuve et complète : le socle

Les fichiers 001 à 018 décrivent le schéma d'origine ; les lots, les machines, l'import et les
règles d'octobre n'existent qu'en migrations. Et l'historique des migrations **ne se rejoue pas**
sur une base vide : plusieurs chargent les données réelles de septembre (catalogue du 16/09, stock
initial du 18/09, parc machine du 20/09), et les suivantes en dépendent — vingt échecs sur
quatre-vingt-quinze au 08/10/2026.

Le **socle** (`socle/`) est donc **généré** depuis une copie entièrement migrée :
`schema.sql` (pg_dump du schéma, propriétaires compris), `configuration.sql` (droits, champs,
paramètres, types et motifs, transitions, devises, catégories, magasins) et `inclus.txt` (les
migrations comprises, avec leur empreinte).

```powershell
python charger.py --base neuve --socle --comptes   # socle + comptes nominatifs + entreprise
python migrer.py --base neuve                      # les migrations postérieures au socle
python socle.py --depuis gestionfil_p1             # régénérer après de nouvelles migrations
```

Le schéma d'une base bâtie ainsi est identique à celui de la copie dont le socle vient (vérifié le
08/10/2026 en comparant les `pg_dump --schema-only` : seules diffèrent les étiquettes de colonnes
que PostgreSQL ajoute en recréant une vue). Le serveur y démarre. Le métier vient du classeur
(`gestionfil-import`).

### Le journal des migrations

Depuis `2026-10-08c_journal_migrations.sql`, la table `migration_appliquee` inscrit chaque
migration (fichier, empreinte SHA-256, mode `JOUEE`, `MARQUEE` ou `SOCLE`). `migrer.py` y lit ce qui
reste à jouer, s'arrête au premier échec, et refuse une base sans journal plutôt que de tout
rejouer :

```powershell
python migrer.py --base gestionfil_essai --marquer-jusqua 2026-10-08c_journal_migrations.sql
python migrer.py --base gestionfil_essai --lister
python migrer.py --base gestionfil_essai
```

---

## Structure

```
db/pg/
├── 001_schema_referentiels.sql   devises, taux, cours Bank Al-Maghrib, catégories,
│                                 rôles BOM, magasins, types/motifs de mouvement,
│                                 paramètres, machine à états
├── 002_schema_securite.sql       rôles, utilisateurs, permissions, champs restreints
├── 003_schema_catalogue.sql      fournisseurs, références, groupes d'équivalence
├── 004_schema_production.sql     qualités, densités par rôle, recettes versionnées
├── 005_schema_planification.sql  plans, saisonnalité, besoins MRP, snapshots
├── 006_schema_achats.sql         bons de commande, plan d'achat, historique des prix
├── 007_schema_receptions.sql     réceptions, lignes, archives figées
├── 008_schema_stock.sql          mouvements, stock par magasin, stock par lot,
│                                 transferts, inventaires, valorisation
├── 009_schema_pilotage.sql       KPI, journal d'audit, alertes, contexte de session
├── 009b_schema_machines.sql      métiers, emplacements, fiches de charge
├── 010_declencheurs.sql          invariants (voir plus bas)
├── 010b_declencheurs_logique.sql solde, CMUP, capacité machine
├── 011_vues.sql                  vues de pilotage
├── 012_controles.sql             contrôles métier C01–C37 (sauf C05, C25, C27), C43, C44, C66
│                                 (C38–C42, C45–C65 sauf C49, C67 : migrations ;
│                                  C05, C25, C68, C69 : moteur — plage C01–C69)
├── 013_vues_cockpit.sql          le cockpit : Pareto, économies, devises, mono-source
├── 014_audit_operations.sql      journal d'audit des opérations
├── seed_*.sql                    référentiels, sécurité, qualités, comptes réels
├── migrations/                   une évolution = un fichier daté, REJOUABLE
└── charger.py                    chargement par passes
```

**51 tables · 36 vues · 51 triggers · 54 index** dans les fichiers d'origine ; une base migrée au
09/10/2026 en compte **96 tables · 132 vues · 242 déclencheurs · 368 index** (le socle en est la
photographie).

---

## Invariants garantis par la base

Ce que la base refuse, quel que soit le chemin d'appel — y compris une correction SQL passée à la main.

| Règle | Mécanisme |
|---|---|
| R01 · unité canonique kg | `reference.facteur_kg` colonne générée + 3 `CHECK` conditionnels |
| R02 · stock jamais négatif | garde avant écriture, par magasin **et** par lot |
| R03 · historique immuable | refus d'`UPDATE`/`DELETE` sur mouvements, archives, historique prix, audit |
| R04 · CMUP aux entrées seules | `type_mouvement.impacte_cmup`, contraint à `signe = +1`. Sans achat, le CMUP est le prix catalogue × taux en vigueur (`fn_prix_catalogue_mad`, vide sans taux) ; la première réception moyenne avec lui |
| R07 · Σ % = 100 par rôle | contrôlé au passage à `VALIDE` |
| R08 · seuls les plans VALIDE alimentent le MRP | index unique partiel sur `(annee) WHERE statut='VALIDE'` |
| RG-04 · recette validée immuable | verrou sur `ligne_recette` |
| RG-09 · taux de change déterministe | périodes non chevauchantes, devise pivot à 1 |
| B4-4 · créateur BC ≠ valideur BC | `CHECK` sur `bon_commande` |
| B4-2 · peseur ≠ contrôleur | `CHECK` sur `reception` |
| Transitions d'états | table `transition_statut` + trigger par entité — **aucune transition arrière** |
| Bon soumis figé (21/10/2026) | au contrôle et en attente de validation, ni en-tête ni lignes ne bougent ; en demande de prix, seuls prix et remise (`trg_ligne_bc_figee`, `trg_bc_entete_figee` — la validation écrit encore taux, montants, valideur) |
| Une ligne par référence sur un bon (21/10/2026) | `trg_ligne_bc_une_par_reference` refuse une seconde ligne de marchandise active (ni annulée ni soldée) ; le serveur augmente la ligne existante ; les doublons anciens se signalent (C60) |
| Une ligne de réception par lot (21/10/2026) | `trg_ligne_reception_un_lot` : même réception, même ligne de bon, même référence, même lot (vide compris) = une ligne ; le serveur additionne |
| Cycle de l'OF (22/10/2026) | `trg_ordre_fabrication_cycle` : PRÉVU → LANCÉ → CLÔTURÉ, ANNULÉ depuis PRÉVU ou LANCÉ (`transition_statut`, entité `ordre_fabrication`) ; en-tête figé une fois clôturé ou annulé ; un OF naît PRÉVU |
| Retour de consommation directe (22/10/2026) | `trg_lmvt_retour_conso` : `RETOUR_CONSO` seulement pour un article en mode DIRECTE, avec l'OF (`mouvement.id_of`), et jamais plus que ce que cet OF a sorti de la référence et pas encore rendu (`fn_of_conso_directe_reste`) ; `trg_mouvement_conso_rendue` refuse de contre-passer une sortie dont un retour dépend. Entrée au CMUP du magasin, sans effet sur le CMUP |
| Règle de frontière machine (22/10/2026) | chaque ligne de décision archive `id_of` (l'OF que la ligne sert après le constat) et `id_of_periode` (celui qu'elle servait avant : l'écart lui appartient) ; l'état archivé (`machine_decision_etat`) porte l'OF et la voie, d'où le retour exact à la dévalidation |
| Conditionnement du lot (23/10/2026) | `lot.poids_bobine_kg`, `lot.bobines_par_palette`, leur origine (`RECEPTION`, `HISTORIQUE`, `MOUVEMENT`, `FICHE_ARTICLE`, `CORRECTION`) et `date_conditionnement`. À sa naissance le lot prend la fiche article (`trg_10_lot_conditionnement_naissance`) ; la validation d'une réception le mesure sur toutes ses réceptions validées (`fn_lot_conditionnement_reception` : kilos / bobines, bobines / palettes entières ; mesure à plus de 50 % de la fiche notée, non appliquée ; une correction manuelle n'est jamais écrasée). Correction : `POST /api/lots/conditionnement` (droit VALIDER sur les lots, motif). Journal immuable `lot_conditionnement_journal`. Toute conversion sur un lot : `fn_lot_poids_bobine`, `fn_lot_bobines_palette` (le lot, sinon la fiche ; jamais 1) |
| Qualité explicite (23/10/2026) | `CONSO_DIRECTE` / `RETOUR_CONSO` portent `mouvement.code_qualite` : avec un OF, celle de l'OF (posée, une autre refusée : `QUALITE-OF`) ; sans OF, obligatoire (`QUALITE-OBLIGATOIRE`, `trg_mouvement_qualite`) ; les autres mouvements n'en portent pas. Le retour sans OF est borné par ce que la qualité a sorti sans OF (`fn_qualite_conso_directe_reste`). Machine : qualité sur la fiche, ses lignes, l'état, l'état archivé et la ligne de décision (`code_qualite` nouvelle, `code_qualite_periode` : l'écart lui appartient, même frontière que l'OF) ; cohérente avec l'OF (`trg_machine_etat_qualite`, `trg_machine_decision_etat_qualite`, `trg_machine_decision_ligne_qualite`), obligatoire sur une ligne de chargement |
| Inventaire ouvert = gel (23/10/2026 ; étendue par type, 24a) | tant qu'un inventaire du magasin est ouvert (brouillon ou validé), `trg_01_mouvement_inventaire_ouvert` (en-tête) et `trg_01_lmvt_inventaire_ouvert` (chaque ligne, seule écriture du stock) refusent tout mouvement qui y entre ou en sort — sortie, réception, transfert au départ comme à l'arrivée, fiche machine, contre-passation, `ANNUL_*` — avec le numéro de l'inventaire (`INVENTAIRE-OUVERT`). L'étendue suit le type (`fn_inventaire_gel_par_reference`) : un GLOBAL gèle tout le magasin (refus dès l'en-tête) ; un TOURNANT ou un CIBLE ne gèle que ses références — celles de ses lignes à l'instant du mouvement, tout lot (un lot trouvé au comptage gèle sa référence dès qu'il a sa ligne) — et le refus, sur la ligne, nomme l'inventaire et la référence ; les autres références du magasin passent. Depuis 24b, « ses références » sont celles de SA LISTE (`inventaire_reference`) ; un tournant ou un ciblé sans référence choisie gèle tout le magasin (défaut prudent, le message le dit). Seuls passent les ajustements de sa clôture, rattachés par `mouvement.id_inventaire` : un `AJUST_INV_*` du magasin, inventaire validé, un seul vivant par sens, chaque ligne étant un écart de l'inventaire (référence, lot, sens, quantité). Lecture pour les écrans : `GET /api/inventaires/ouverts` (`v_inventaire_gel` : étendue MAGASIN / REFERENCES et références gelées) |
| Liste d'un tournant ou d'un ciblé (23/10/2026, 24b) | `inventaire_reference` (origine `PROPOSITION` / `CHOIX` / `REPRISE`, classe ABC et dernier comptage notés au choix, journal d'audit) ; `inventaire.date_selection` / `id_utilisateur_selection`. La liste se choisit sur un TOURNANT ou un CIBLE en brouillon, avant ses lignes, puis se fige (`trg_inventaire_reference_garde`, INV-SELECTION ; un GLOBAL n'en a pas). Ses lignes n'en sortent pas — préparation comme lot trouvé au comptage (`trg_ligne_inventaire_selection`) ; sans liste, rien ne se prépare ni ne se valide (`trg_inventaire_selection_validation`, qui fige aussi le type). Proposition du tournant : `v_inventaire_candidat` — références en stock du magasin, classe de la fiche (`reference.classe_abc`, absente = C), dernier comptage = dernière ligne comptée d'un inventaire clôturé du magasin, due si jamais comptée ou depuis `fn_comptage_tournant_jours` (P_ComptageTournantA/B/C, 30/90/180 j). Reprise : un tournant / ciblé ouvert qui avait des lignes a reçu leurs références pour liste |
| Audit | journal alimenté sur paramètres, prix, droits, engagements |

Un rôle BOM sans densité sur la qualité **bloque la validation de la recette** plutôt que de produire un besoin nul en silence.

---

## Vues de pilotage

| Vue | Rôle |
|---|---|
| `v_ligne_recette_calculee` | kg/m² par ligne de recette (gère kg/m² et ml/m²) |
| `v_besoin_mrp_calcule` | besoins MRP agrégés par référence, taux de perte appliqué |
| `v_consommation_fait` | **le grand livre de la consommation** (27/10/2026, 27g) : une ligne par fait — décisions machine actives datées au jour de la fiche, mouvements non contre-passés ; natures CONSOMMATION_MACHINE, CONSOMMATION_DIRECTE, RETOUR_CONSO, RETOUR_PROD (retour depuis l'atelier, déduit du réel au jour du retour : 27i), HORS_MACHINE, REBUT_DECHET/PERTE/CASSE, AUTRE_ECART (hors réel : corrections, non qualifiés, régularisations, erreurs, ajustements d'inventaire) ; kg signés, valeur au livre (fait machine : CMUP du jour reconstitué, `prix_source`), OF, qualité (« Non attribué »), attribution, mode de mesure, clé du détail |
| `v_conso_fenetre` / `v_conso_reelle_mois` | les 12 mois pleins glissants (mois calendaires complets avant le mois en cours) ; le réel par référence et par mois dans la fenêtre (XYZ, rotation) |
| `v_conso_reelle` | le **Réel / mois** : réel d'achat des 12 mois pleins (consommation + rebut − retours) ÷ 12, valeur, rebut, autres écarts (27g) ; `v_conso_retenue` (le « plus grand » du réel et du plan) est **supprimée** |
| `v_stock_disponible` | stock agrégé par référence, hors magasins `inclure_mrp = 0` |
| `v_encours_bc` | reliquat des BC envoyés |
| `v_stock_physique` | ce qu'il y a dans les allées, sans projection : utilisable, quarantaine, mis de côté (restes, lots bloqués), fil sur machine au dernier constat, fil en route vers un magasin compté (`stock_transit_kg`) ; `stock_mrp_net_kg` retirée le 27/10/2026 |
| `v_stock_reference` | **la lecture neutre d'une référence** (27/10/2026, 27e) : fournisseur et délai, classes, stock (MRP, total, physique net, quarantaine, mis de côté, machine, transit), réel / mois et valeur réelle des 12 mois pleins (27g) — sans projection ni statut ; socle des vues d'état, d'analyse et de cockpit, à la place de `v_stock_projete` |
| `v_substitution_dispo` | substituts d'un groupe d'équivalence qui ont du stock net ; l'état de la principale vient du moteur de couverture (27e) |
| `v_stock_transit_reference` | le fil en route (transfert expédié, pas encore reçu) par référence et magasin d'arrivée, compté dans la valeur du stock et la couverture (10b) |
| `v_facture_rapprochement` | le rapprochement 3-way d'une facture fournisseur, ligne par ligne : commandé (ligne de bon), pesé (ligne de réception), facturé, écarts de quantité et de prix (ADR-003 phase B, 14d) |
| `v_fournisseur_scorecard` | conformité, ponctualité, OTIF, écart de pesée |
| `v_stock_dormant` | références sans mouvement au-delà de `P_SeuilDormant` |
| `v_lot_fefo` | proposition d'allocation FEFO |
| `v_of_consommation` | par OF et par référence : prévu (métrage × recette × (1 + perte de la qualité), étalon de comparaison) ; réel fil = écarts `CONSOMMATION` des décisions machine **actives** dont `id_of_periode` est l'OF (corrections `MJ_CORRECTION` exclues) ; déchet / perte / casse = écarts de cet effet + bobines déchargées vers cette destination ; autres écarts (non qualifié, régularisation, erreur de saisie, correction) à part ; hors machine = `CONSO_DIRECTE` − `RETOUR_CONSO` portant l'OF, contre-passés exclus (22b) |
| `v_of_bilan` / `v_qualite_consommation` | les mêmes totaux par OF, puis par qualité et mois de l'OF (OF annulés exclus), écart réel − prévu ; depuis le 23/10/2026 (23b), la consommation **sans OF** sous sa qualité s'y ajoute (écarts machine sous `code_qualite_periode`, au mois de la fiche ; `CONSO_DIRECTE` − `RETOUR_CONSO` sans OF, au mois du mouvement) — `kg_reel_of`, `kg_reel_sans_of` ; sans qualité : « Non attribué » (`code_qualite` vide). La part des OF (nb, métrage, prévu, écart) est inchangée |
| `v_lot_conditionnement_mesure` | par lot : poids d'une bobine mesuré et bobines par palette observées sur ses réceptions validées, locales et import (23a) |
| `v_of_mois` / `v_besoin_of_qualite` | les OF retenus (PRÉVU, LANCÉ) mois par mois, au prorata des jours entre leur date et leur fin prévue (sans fin : le mois de leur date) ; par qualité et mois, m² du plan en service, m² des OF, part du plan couverte, part des OF au-delà du plan (22c) |
| `v_besoin_of` | par OF, référence et mois : prévu (métrage × recette × (1 + perte de la qualité)), consommation déjà attribuée (écarts machine à effet consommation hors `MJ_CORRECTION`, déchet, perte, casse des décisions actives dont `id_of_periode` est l'OF, bobines déchargées au déchet / à la perte / à la casse, `CONSO_DIRECTE` − `RETOUR_CONSO` portant l'OF, contre-passés exclus) imputée aux mois les plus anciens d'abord, reste jamais négatif, parts liée au plan / au-delà ; un mois écoulé pèse sur le mois courant (22c) |
| `v_besoin_mois` | le besoin combiné par référence, mois et **origine** (`PLAN` / `AU_DELA_PLAN`) — la traçabilité de « OF + plan non couvert » (22c) |
| `v_besoin_12m` | la lecture du plan restant (`besoin_mrp`, mois courant et suivants) : une entrée, pas un calcul de besoin ; le plan seul depuis 27b (`besoin_plan_12m_kg` = `besoin_12m_kg`, `besoin_au_dela_12m_kg` = 0) |

**L'ancien calcul du besoin est retiré (27/10/2026, migration `2026-10-27e_source_unique_moteur.sql`).**
Une seule source de vérité : le moteur de couverture (`backend/src/domain/couverture.rs`, lu par
`routes/couverture.rs`), qui projette jour par jour. Sont supprimées `v_stock_projete`,
`v_plan_achat`, `v_encours_fiable`, `v_besoin_horizon`, `v_besoin_horizon_of`, `v_besoin_of_mois`,
`v_risque_mensuel`, `v_risque_reference`, `v_cockpit_stock`, `v_cockpit_couverture`, la colonne
`v_stock_physique.stock_mrp_net_kg` et le paramètre `P_MrpInclureStockMachine`. Les vues qui
gardaient un statut ou une projection pour l'afficher (`v_equivalence`, `v_etat_stock`,
`v_etat_stock_conditionne`, `v_analyse_abc_xyz`, `v_cockpit_devise`, `v_cockpit_economies`,
`v_cockpit_mono_source`, `v_cockpit_pareto`, `v_risque_sourcing`, `v_substitution_dispo`,
`v_supervision*`, `v_cockpit_files`) sont redéfinies sans lui, sur `v_stock_reference` ; la route
ajoute les colonnes du moteur (statut, jours couverts, 1re rupture, quantité à commander).
`snapshot_mrp` prend le solde et l'état du moteur (`PLAN_NON_COUVERT`, `SOUS_SECURITE`, `COUVERT`,
les anciens états restant admis). Gardées parce qu'elles ne calculent ni besoin ni projection :
`v_besoin_mrp_calcule`, `v_besoin_12m`, `v_besoin_mois`, `v_stock_disponible` (`v_conso_retenue` et
`v_stock_min_dynamique` sont retirées par 27g : « deux chiffres séparés », réel du grand livre et plan
du moteur ; le minimum affiché est la sécurité du jour du moteur).

Le **transfert en route** porte une date prévue de disponibilité au magasin destinataire
(`transfert.date_disponibilite_prevue`, migration `2026-10-27d`) : obligatoire à l'expédition,
révisable tant qu'il est en route, figée après (déclencheur `trg_transfert_date_disponibilite`,
`TRF-DATE` ; chaque révision journalisée par `trg_audit_transfert_date`). Le moteur le compte comme
un arrivage à cette date ; sans date, C66 le signale.

La **proposition d'achat se clôt avec son bon annulé** (décision du 27/10/2026, migration
`2026-10-27f`) : annuler le bon qu'une proposition a produit la fait passer à `ANNULE_BC`
(« Annulée avec le bon ») au lieu de la rouvrir. Elle reste liée au bon (`id_bc_genere`, et la ligne
du bon qui la désigne), n'est plus ouverte (ni purgée par la régénération, ni comptée, hors de
`ux_plan_achat_ouvert`) ; c'est un état final (`trg_plan_achat_annule_bc_final`, `PA-ANNULE-BC`). La
régénération suivante crée une proposition neuve si le moteur en propose une.

---

## Contrôles métier

```powershell
psql -d gestionfil -c "SELECT * FROM v_controles;"          # tableau de bord
psql -d gestionfil -c "SELECT * FROM v_ctl_c28;"            # détail d'un contrôle
```

C01–C14 traduisent les contrôles du CDC en requêtes exécutables. C15–C37 ont été ajoutés, dont :

- **C15** cohérence stock par lot / stock par magasin
- **C16** rôle de recette sans densité (le cas du besoin nul silencieux)
- **C17** références orphelines sans recette (T09 du CDC)
- **C18** qualité planifiée sans densité de rôle
- **C19** devise catalogue sans taux en vigueur
- **C20** référence classe A mono-source

C38–C42 (machines) viennent de la migration du 05/10/2026 ; **C43** (colisage incohérent sur un
document d'achat ouvert, signalé sans bloquer) et **C44** (plus d'un inventaire en cours sur un
magasin — l'index qui l'interdit n'a pas pu être posé) des migrations du 08/10/2026. **C10** lit
aussi les réceptions d'import depuis le 08/10 (excédent au-delà de la tolérance du fournisseur sans
dérogation).

Les migrations du 09/10/2026 (audit v5) et du 10/10 ajoutent, tous en **signal** (ATTENTION), jamais en blocage :

| Code | Ce qu'il signale | Migration |
|---|---|---|
| C45 | ligne de bon reçue à la fois en local et à l'import — **dossiers en circuit `FACTURE` seulement** (ADR-003 phase C : pour un dossier basculé en `BON`, ce lien est le chaînon qui relie ses frais à la marchandise) | 08f, recadré par 2026-10-14b |
| C46 | champ sensible sans ligne dans le modèle de droits d'un rôle | 09a |
| C47 | fil prêté à une autre usine, non rendu dans le délai (`P_PretJoursAlerte`) | 09d |
| C48 | chargement : fil chargé déjà consommé, à relire | 09e |
| C49 | ~~proposition d'achat estimée surtout sur la prolongation du plan~~ — **retiré le 27/10/2026** (le moteur n'a pas de prolongation) | 09k, retiré par 27e |
| C50 | moyenne du plan éloignée de plus de 50 % de la consommation réelle | 09k |
| C51 | référence suivie au lot avec du fil sans lot, à identifier | 09s |
| C52 | réception validée dont une entrée est contre-passée | 09u |
| C53 | paiement d'import daté avant le dédouanement (jamais d'acompte, A11) | 10a |
| C54 | transfert en route depuis plus de `P_TransitJoursAlerte` jours (7) | 10b |
| C55 | document non validé (réception, inventaire, transfert) daté d'une période close (`P_PeriodeCloseJusqua`) | 17e |
| C56 | ligne d'un dossier d'import ouvert dont la référence n'a pas de position tarifaire active : ses droits attendus ne se calculent pas | 19a |
| C57 | référence sur plusieurs bons ouverts, dont un sert le plan d'achat | 19d |
| C58 | ligne de bon reçue au-delà de sa commande et de la tolérance | 19e |
| C59 | bon en attente de validation dont une ligne a un prix confirmé (demande de prix) différent du prix d'avant — prix nets, remise déduite | 21b |
| C60 | même référence sur plusieurs lignes de marchandise actives (ni annulées ni soldées) d'un bon non annulé — doublon d'avant la règle « une ligne par référence », qui ne bloque rien | 21d |
| C61 | OF clôturé dont la consommation réelle (fil + hors machine) s'écarte du prévu (métrage × recette) de plus de `P_EcartOfPct` (15 %) | 22b |
| C62 | consommation directe sans OF **ni qualité** (non contre-passée) : l'historique d'avant le 23/10/2026, « Non attribué » dans les statistiques par qualité ; depuis, une consommation sans OF nomme sa qualité (base) | 22d, 23b |
| C63 | sur l'état courant des étages : ligne qui porte plus de bobines que sa voie n'en tient (`fn_bobines_voie`), ou voies d'un même étage plus larges, ensemble, que la machine (une voie = un OF et une largeur) | 22d |
| C64 | qualité et mois où les OF retenus (PRÉVU, LANCÉ) dépassent le plan de production en service : un simple signal que la direction garde : depuis 27b, le besoin vient du plan seul et l'excédent des OF n'y entre plus ; on le montre (`v_ctl_c64` : m² du plan, des OF, au-delà, les OF) | 22c |
| C65 | mouvement d'un magasin daté de la période de comptage (du jour d'ouverture au jour de clôture) d'un inventaire clôturé, saisi après son ouverture : passé pendant le comptage avant le gel du 23/10/2026, ou antidaté après la clôture — le comptage ne l'a pas vu (ajustements de l'inventaire et leurs contre-passations exclus). Même étendue que le gel (24a) : pour un tournant ou un ciblé, seul compte un mouvement dont une ligne porte une référence de l'inventaire (sa liste, ou ses lignes avant 24b) | 23g, 24a, 24b |
| C66 | transfert en route (`VALIDE`) sans date prévue de disponibilité : le moteur de couverture le liste « sans date » et ne le compte pas, jusqu'à ce qu'une date soit saisie | 27d, 27e |
| C67 | rapprochement machine, par référence : chargé (CHARGE_MACHINE − ANNUL) − déchargé au magasin (RETOUR_MACHINE − ANNUL) − variation de l'état machine (actuel − départ) ≠ faits machine du grand livre de la consommation (consommation, rebut, autres écarts), au-delà de 0,01 kg (seuil technique d'arrondi). Un signal | 27g |
| C68 | stock minimum franchi dans [aujourd'hui, aujourd'hui + délai] (signal, vérifier le plan) — servi par le moteur de couverture en Rust, aucun SQL, hors `v_controles` | 27l (moteur v2) |
| C69 | article soumis au MRP (actif, au besoin du plan en service) sans couverture cible : aucune proposition — servi par le moteur de couverture en Rust, aucun SQL, hors `v_controles` | 27l (moteur v2) |

**Le 27/10/2026 (migration 27e, une seule source de vérité : le moteur de couverture).** **C05**
(plan non couvert sur l'horizon, ex-« stock projeté négatif ») et **C25** (stock mobilisable face à
un équivalent en tension) gardent leur sens mais sont **calculés par le moteur et servis par le
serveur** sous les mêmes codes (`couverture::controles_moteur`, `CONTROLES_MOTEUR`) : ils ne sont
plus dans `v_controles`, et l'écran des contrôles, le briefing et l'assistant les reçoivent mêlés
aux autres (`tous_les_controles`). **C27** (écart majeur : couverture confortable, magasin sous le
minimum) et **C49** sont **retirés** — le moteur n'a ni seuils de jours ni prolongation. **C28**
(commande en retard) est **rebranché** sur la règle du moteur : une ligne de bon validé dont la date
(de la ligne, sinon de l'en-tête) est dépassée est en retard et hors couverture — plus de tolérance
`P_RetardBCJours`, un libellé fixe ; `P_RetardBCJours`, `P_EncoursRetardInclus`, `P_HorizonProlonge`
et `P_EcartCouvertureJours`, sans lecteur, sont supprimés par `2026-10-27j`. **C66** naît
(transfert en route sans date prévue). C31, C32 et le coût de revient gardent les réceptions
clôturées ; C35 et C36 lisent l'état des machines (`machine_etat`). `v_controles` porte donc
C01–C67 moins C05, C25, C27 et C49.

**Le 27/10/2026 au soir (moteur de couverture v2, migration `2026-10-27l_couverture_cible.sql`).**
**C05** devient la **rupture inévitable** (1re rupture avant aujourd'hui + délai). **C68** (stock
minimum franchi dans [aujourd'hui, aujourd'hui + délai] : un signal, vérifier le plan) et **C69**
(article soumis au MRP — actif, au besoin du plan en service — sans couverture cible : aucune
proposition) naissent. Les trois sont **servis par le moteur en Rust**, aucun SQL, comme C25 : la
plage des contrôles va de C01 à C69, `v_controles` en porte la part SQL. Sur la fiche article,
`couverture_min_mois` est renommée **`couverture_cible_mois`** (la couverture souhaitée au moment de
la réception, cible du MRP ; jamais une quantité), `stock_min_kg` reste un garde-fou (un signal,
jamais une quantité de commande), `marge_securite_pct` de l'article est supprimée (celle de la
qualité, défaut du plan de production, reste) ; la vue `v_stocks_minimums_a_revoir` et la route
`/api/plan-achat/stocks-minimums` sont retirées.

**C11 est le contrôle central** : il compare le solde de `stock_magasin` au grand livre. `stock_magasin` n'est qu'un cache ; `ligne_mouvement` fait foi. Toute divergence signale un bug applicatif, et le solde est reconstructible.

---

## Contraintes d'intégration côté service

1. **Renseigner le contexte de session en début de transaction écrivante** — sinon le journal
   d'audit enregistre des actions anonymes. Côté serveur : `user.poser_contexte(&mut tx)`,
   qui pose `SET LOCAL app.id_utilisateur`, `app.adresse_ip`, `app.session_id`.
2. **Arrondir à l'écriture** : 4 décimales pour les kg et le CMUP, 2 pour les montants
   (ADR-001 D-10).
3. **Les cascades sont à la charge du service**, dans une transaction : réception 3-en-1,
   transfert, clôture d'inventaire, calcul MRP, plan d'achat, ABC/XYZ (ADR-001 D-04).
4. **Une requête nouvelle se vérifie avant d'être livrée** : `PREPARE` sur une copie de la base,
   et types du résultat comparés aux types Rust. Un `NUMERIC` lu en `f64`, un `ROUND(x, n)` sur un
   flottant ou un `SUM(booléen)` ne se voient qu'à l'exécution — seize requêtes plantaient ainsi
   le 17 septembre 2026.

---

## Ce que la base porte aujourd'hui

- **125 références**, familles et couleurs alignées sur « Liste ref fil.xlsx ».
- **18 qualités** et leurs recettes, densités par rôle comprises.
- Le **plan de production** de l'année et sa saisonnalité, d'où le MRP tire les besoins.
- Le **CMUP** : prix catalogue × taux en vigueur tant qu'aucun achat ne l'a fixé, puis moyenne
  pondérée à chaque réception valorisée.
- Le **cours de référence de Bank Al-Maghrib**, lu pour information à côté du taux de l'ERP.

---

## Documentation

- [ADR-001 — Décisions fondatrices](../docs/ADR-001-decisions-fondatrices.md)
- [ADR-002 — Les 18 règles de gestion du 08/10/2026](../docs/ADR-002-regles-de-gestion-2026-10.md)
- [Écarts au cahier des charges](../docs/ecarts-cahier-des-charges.md)
- [ADR-003 — Réception unifiée GR → IR → Landed Cost](../docs/ADR-003-reception-unifiee-gr-ir-landed-cost.md)
- [Matrice des types de mouvement](../docs/matrice-mouvements.md) — générée par `python db/pg/matrice.py`
