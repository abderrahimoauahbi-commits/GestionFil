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
├── 012_controles.sql             contrôles métier C01–C37, C43, C44 (C38–C42, C45–C64 : migrations)
├── 013_vues_cockpit.sql          le cockpit : Pareto, couvertures, économies
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
| Audit | journal alimenté sur paramètres, prix, droits, engagements |

Un rôle BOM sans densité sur la qualité **bloque la validation de la recette** plutôt que de produire un besoin nul en silence.

---

## Vues de pilotage

| Vue | Rôle |
|---|---|
| `v_ligne_recette_calculee` | kg/m² par ligne de recette (gère kg/m² et ml/m²) |
| `v_besoin_mrp_calcule` | besoins MRP agrégés par référence, taux de perte appliqué |
| `v_conso_reelle` / `v_conso_retenue` | consommation réelle (correction N4) et sa provenance |
| `v_stock_disponible` | stock agrégé par référence, hors magasins `inclure_mrp = 0` |
| `v_encours_bc` | reliquat des BC envoyés |
| `v_stock_min_dynamique` | stock minimum F3 (max de 4 sécurités) |
| `v_stock_projete` | `stock + en-cours − besoins`, statut et jours de couverture ; le besoin décomposé : `besoin_plan_12m_kg`, `besoin_au_dela_12m_kg` (22c) |
| `v_plan_achat` | quantité à commander (MOQ + multiple), tiering, sourcing, prix tracé |
| `v_cockpit_stock` | KPI en un seul balayage |
| `v_substitution_dispo` | alternatives disponibles sur rupture |
| `v_fournisseur_scorecard` | conformité, ponctualité, OTIF, écart de pesée |
| `v_stock_dormant` | références sans mouvement au-delà de `P_SeuilDormant` |
| `v_lot_fefo` | proposition d'allocation FEFO |
| `v_of_consommation` | par OF et par référence : prévu (métrage × recette × (1 + perte de la qualité), étalon de comparaison) ; réel fil = écarts `CONSOMMATION` des décisions machine **actives** dont `id_of_periode` est l'OF (corrections `MJ_CORRECTION` exclues) ; déchet / perte / casse = écarts de cet effet + bobines déchargées vers cette destination ; autres écarts (non qualifié, régularisation, erreur de saisie, correction) à part ; hors machine = `CONSO_DIRECTE` − `RETOUR_CONSO` portant l'OF, contre-passés exclus (22b) |
| `v_of_bilan` / `v_qualite_consommation` | les mêmes totaux par OF, puis par qualité et mois de l'OF (OF annulés exclus), écart réel − prévu |
| `v_of_mois` / `v_besoin_of_qualite` | les OF retenus (PRÉVU, LANCÉ) mois par mois, au prorata des jours entre leur date et leur fin prévue (sans fin : le mois de leur date) ; par qualité et mois, m² du plan en service, m² des OF, part du plan couverte, part des OF au-delà du plan (22c) |
| `v_besoin_of` | par OF, référence et mois : prévu (métrage × recette × (1 + perte de la qualité)), consommation déjà attribuée (écarts machine à effet consommation hors `MJ_CORRECTION`, déchet, perte, casse des décisions actives dont `id_of_periode` est l'OF, bobines déchargées au déchet / à la perte / à la casse, `CONSO_DIRECTE` − `RETOUR_CONSO` portant l'OF, contre-passés exclus) imputée aux mois les plus anciens d'abord, reste jamais négatif, parts liée au plan / au-delà ; un mois écoulé pèse sur le mois courant (22c) |
| `v_besoin_of_mois` (`fn_besoin_of_mois`) | **les OF consomment le plan** : par référence et mois ≥ courant, la part du besoin MRP couverte par des OF (retirée, au prorata de la recette), le reste des OF dans le plan et au-delà. Une fonction plpgsql, opaque au planificateur : dépliée, elle portait la planification de `v_plan_achat` à des secondes. Vide sans OF (22c) |
| `v_besoin_mois` | le besoin combiné par référence, mois et **origine** (`PLAN` / `AU_DELA_PLAN`) — la traçabilité de « OF + plan non couvert » (22c) |
| `v_besoin_12m` / `v_besoin_horizon` / `v_besoin_horizon_of` | le plan (`besoin_mrp`) + l'ajustement des OF ; `v_besoin_12m` ajoute `besoin_plan_12m_kg`, `besoin_au_dela_12m_kg` ; `v_besoin_horizon` garde ses colonnes (2026-10-09k doit se rejouer), la part au-delà du plan du délai et de la couverture est dans `v_besoin_horizon_of` (`dem_lead_au_dela_kg`, `sorties_au_dela_kg`). Sans OF, valeurs identiques à avant (vérifié ligne à ligne le 22/10/2026). Le reste d'un OF compte en entier sur les jours qui restent du mois courant ; le plan, lui, au prorata (22c) |

---

## Contrôles métier

```powershell
psql -d gestionfil -c "SELECT * FROM v_controles;"          # tableau de bord
psql -d gestionfil -c "SELECT * FROM v_ctl_c05;"            # détail d'un contrôle
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
| C49 | proposition d'achat estimée surtout sur la prolongation du plan | 09k |
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
| C62 | consommation directe sans OF (non contre-passée) : elle n'est attribuée à aucune qualité — l'écran des mouvements la laisse passer, la fiche hors machine exige l'OF | 22d |
| C63 | sur l'état courant des étages : ligne qui porte plus de bobines que sa voie n'en tient (`fn_bobines_voie`), ou voies d'un même étage plus larges, ensemble, que la machine (une voie = un OF et une largeur) | 22d |
| C64 | qualité et mois où les OF retenus (PRÉVU, LANCÉ) dépassent le plan de production en service : le besoin augmente de l'excédent, c'est voulu ; on le montre (`v_ctl_c64` : m² du plan, des OF, au-delà, les OF) | 22c |

C28 dit désormais ce que fait `P_EncoursRetardInclus` (comptée ou retirée de la couverture) ; C31,
C32 et le coût de revient gardent les réceptions clôturées ; C35 et C36 lisent l'état des machines
(`machine_etat`). Le banc vérifie la liste exacte C01–C64.

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
