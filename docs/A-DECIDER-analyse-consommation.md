# À décider — analyse et cockpit de consommation

> Étude du 27/10/2026 (lecture seule, base de saisie).

## Décisions de la direction (27/10/2026)

| Question | Décision |
|---|---|
| Q1 Source du réel | **Grand livre unique de la consommation** ; ABC, XYZ, OF, qualité, cockpit en dérivent |
| Q2 Rebut dans le réel d'achat | **Oui** (ABC, XYZ, rythme réel, C50) |
| Q3 Étalon d'un OF | **Métrage × recette × (1 + perte)** face au **réel + rebut** |
| Q4 OF portant un écart | **Clôturés seulement** ; ouvert = prévu / consommé / reste, écart « non calculable » |
| Q5 Date d'une consommation machine | **Date de la fiche** |
| Q6 Période des moyennes | **12 mois pleins glissants** |
| Q7 Retour de consommation | **Déduit au jour du retour** |
| Q7 bis Retour de production (RETOUR_PROD) | **Déduit du réel**, comme RETOUR_CONSO : nature RETOUR_PROD, kg négatif, au jour du retour, au prix du mouvement (arbitrage du 27/10/2026, migration `2026-10-27i`). C'est bien un retour de matière au stock (entrée, « Retour depuis atelier », CMUP inchangé) ; retiré de la saisie libre depuis la règle 12, il ne vit que dans l'historique. Hors D3 (OF) et D4 (qualité), qui choisissent leurs natures ; hors C67 (faits machine seuls) |
| Q8 Corrections, non qualifiés, régularisations, ajustements d'inventaire | **Hors réel, montrés à part** |
| Q9 Historique sans qualité | **« Non attribué »**, jamais réparti |
| Q10 Unité | **kg** partout + **kg/m² apparent** sur les OF clôturés, marqué comme tel |
| Q11 Valeur | **Prix de sortie au livre** ; écarts machine au CMUP du jour du fait |
| Q12 m² réalisés | **Attendre l'ERP de production** |
| Q13 Axe équipe | **Aucun** |
| Q14 Droit | **Module COCKPIT** |
| Q15 Étalon figé | **Oui, au lancement de l'OF** |
| Q16 Fil hors recette | **Colonne « substitution »** à part |

Réalisation : lots L0 → L4 (L5 états/assistant et L6 après les m² réels restent à planifier).

# Étude — analyses, statistiques et cockpit de CONSOMMATION (Gestion Fil)

Date : 27/10/2026. Étude en lecture seule : aucun code, aucune écriture dans le dépôt, base
`gestionfil_saisie` lue en `SELECT` seulement (transactions `default_transaction_read_only=on`),
aucun serveur lancé. Branche lue : `lots-devise-import-machines` (commit 0621dcf).

Rappel des faits métier tenus pour acquis (non rediscutés) : axe 1 (achat) = plan seul ; axe 2
(production / statistiques) = PLAN → OF → machine → qualité → mouvements → consommation réelle ;
consommation réelle = mouvements + écarts des constats machine ; le chargement n'est pas une
consommation ; CONSO_DIRECTE puis RETOUR_CONSO hors machine ; rebut = déchargement vers DÉCHET ;
l'écart d'un constat appartient à l'OF sortant ; pas de fiche de production, métrage = celui de l'OF.
Et la règle du document `docs/A-DECIDER-of-supply-chain.md` §10 : « pas une copie de SAP, Oracle,
Odoo ou Dynamics » — le benchmark ci-dessous inspire, il ne se recopie pas.

---

## Sommaire

1. Inventaire de l'existant (code + base)
   1.1 Objets de consommation et d'analyse
   1.2 Les définitions concurrentes du « réel » — formules, périmètres, écarts chiffrés
   1.3 Défauts constatés
   1.4 Recommandation : UNE source canonique
2. Benchmark des autres ERP
3. Proposition pour Gestion Fil
   3a Indicateurs et formules
   3b Axes
   3c Cockpit analytique — maquettes et drill-down
   3d Décisions de la direction (questions à choix)
   3e Découpage en lots livrables

---

## 1. Inventaire de l'existant

### 1.1 Objets de consommation et d'analyse

**Base (vues / fonctions, définitions lues en direct par `pg_get_viewdef`)**

| Objet | Origine | Sert à | Lu par |
|---|---|---|---|
| `v_conso_reelle` | 011_vues + 09d, 21c | consommation mensuelle « réelle » par référence | `v_conso_retenue` → `v_stock_projete` (statut, jours de couverture, stock max), ABC (`classification.rs`), C50, cockpit (Pareto, DIO, valeur annuelle), assistant, briefing |
| `v_conso_retenue` | 011 | max(réel, plan) par référence + `source_conso` | `v_stock_projete` |
| `domain/classification.rs` (requête XYZ) | Rust | coefficient de variation 12 mois → X/Y/Z | `POST /api/classification`, écran `/classification` |
| `v_analyse_abc_xyz`, `v_cockpit_pareto` | 017, 013 | Pareto en valeur = `conso_mensuelle_kg × 12 × CMUP` | `/api/analyse-abc-xyz`, `/api/cockpit/analyse` |
| `v_of_consommation` | 2026-10-22b | par OF × référence : prévu, réel fil, réel hors machine, déchet/perte/casse, autres écarts, écart | `GET /api/ordres-fabrication/{id}/consommation` (écran `/ordres-fabrication/:id`) |
| `v_of_bilan` | 22b | somme par OF | liste des OF, C61 |
| `v_qualite_consommation` | 22b puis 23b (redéfinie) | par qualité × mois : part OF (au mois de l'OF) + part « sans OF » sous la qualité de la période (au mois du constat) ; « Non attribué » | `GET /api/ordres-fabrication/consommation-qualites` (onglet « Consommation par qualité » de `/ordres-fabrication`) |
| `v_besoin_of` | 22c | prévu / consommé / reste d'un OF par mois (consommé plafonné au prévu) | plus aucun calcul de besoin depuis 27b ; vue gardée « axe 2 » |
| `v_besoin_of_qualite`, `v_of_mois` | 22c | m² plan vs m² OF par qualité × mois | C64 |
| `f_machine_consommation(machine, du, au)` | 09-08f puis 10-05, 10-08i | par étage × référence × lot sur une période : début, chargé, retourné, sorti ailleurs, fin, consommation, DPC, non qualifié, régularisation, erreur | `GET /api/machines/consommation` → table « Consommation » de l'écran machine (`pages/machines/Bureau.tsx`) |
| `v_machine_ecart` | 10-05 | lignes de décision ACTIVES avec motif | `f_machine_consommation`, `v_conso_reelle` |
| `v_machine_consommation` | 009b / 10-05 | chargé − retourné − état actuel, depuis `machine_fiche_ligne` | **personne** (vue morte, et fausse : voir 1.3) |
| table `machine_consommation` | ancien journal | consommation par constat (avant le modèle des décisions) | vide (0 ligne) |
| `v_stat_mouvement_mois`, `v_stat_mouvement_reference`, `v_stat_famille`, `v_stat_famille_couleur` | 015/017 | flux par type, « sorties » = tous les types de signe −1 | `/api/stats/*` → `/statistiques`, tableau de bord |
| `v_stat_qualite` | 017 | coût matière / m² de la recette, m² prévus du plan, `m2_realises` du plan | `/api/stats/qualites` (aucune consommation réelle) |
| `v_cockpit_cout_mensuel` | 013 | coût du **plan** à venir (besoin_mrp × CMUP) | cockpit |
| `fn_of_conso_directe_reste`, `fn_qualite_conso_directe_reste` | 22d, 23b | ce qui peut encore être rendu sur un OF / une qualité | fiche hors machine |
| Contrôles | | | `v_controles` |
| C38 | consommation machine négative | CRITIQUE | 0 |
| C40 / C41 | écart non qualifié / régularisation | ATTENTION | 0 / 0 |
| C50 | moyenne du plan à > 50 % de la conso réelle (lit `v_conso_reelle`) | ATTENTION | **13** |
| C61 | OF clôturé dont réel/prévu > `P_EcartOfPct` (15 %) (lit `v_of_bilan`) | ATTENTION | 0 (aucun OF clôturé) |
| C62 | consommation directe sans OF ni qualité | ATTENTION | 0 |
| C63 | ligne d'étage au-delà de la capacité de sa voie | ATTENTION | 0 |
| C64 | OF au-delà du plan (qualité × mois) | ATTENTION | 3 |

**Écrans (frontend/src/App.tsx, `ECRANS`)** qui montrent aujourd'hui de la consommation :
- `/ordres-fabrication` (onglet consommation par qualité, filtre qualité / du mois / au mois) et
  `/ordres-fabrication/:id` (par référence : prévu, réel, déchets…) — module PLANS ;
- écran machine `/machines/:code` (table « Consommation », `f_machine_consommation`) — module STOCK ;
- `/classification` (ABC/XYZ) — STOCK ; `/statistiques` (mouvements, familles, prix, fournisseurs,
  qualités, lots) — MOUVEMENTS ; `/tableau-de-bord/*` (vue d'ensemble, analyse, matière,
  opportunités, risques) et `Cockpit.tsx` / `CockpitAnalyse.tsx` — COCKPIT ; `/rapports` (VALORISATION).
- **Aucun écran n'est un cockpit de consommation** : par qualité il n'y a qu'un tableau mensuel ;
  par fil, aucune vue de la consommation réelle (seulement des « sorties » tous types confondus) ;
  par machine, une table par étage sans période choisie à l'écran ; aucun graphe de tendance,
  aucun Pareto de consommation réelle, aucun motif d'écart agrégé, aucun drill-down.

**Données de la base de saisie (au 27/10/2026)** : 400 mouvements, 373 décisions machine ACTIVES
(166 CHARGE, 207 MAJ = constats ; aucune DECHARGE), 768 lignes de décision, 5 OF (tous LANCÉS,
13 300 m², octobre 2026), 18 qualités / 301 lignes de recette (toutes avec kg/m²), 125 références
actives (24 en mode DIRECTE, 101 MACHINE), plan en service 2026-10 → 2027-09 (880 085 m²),
`ligne_plan_production.m2_realises` **vide**. Mouvements utiles : CHARGE_MACHINE 200 946 kg ;
SORTIE_HORS_MACHINE 52 206 kg (motif HM_ATELIER, 382 lignes, **aucune avec OF**) ; CONSO_DIRECTE,
RETOUR_CONSO, SORTIE_PROD : 0. Écarts machine : 459 lignes CONSOMMATION (motif MJ_ORDINAIRE) =
195 473 kg ; aucun déchet / perte / casse / correction / non qualifié. **1 ligne sur 768** porte
un OF de période et une qualité de période. Mode de constat : ESTIMATION à 100 % (18 états).
Dates : fiches du 12/02/2024 au 24/10/2026, mais **décisions toutes validées entre le 10 et le
24/10/2026** (rejeu de l'agent de simulation).

### 1.2 Les définitions concurrentes du « réel »

Six familles distinctes (deux annexes en plus). `v_of_bilan` et la part OF de
`v_qualite_consommation` ne sont que des sommes de `v_of_consommation`.

| # | Définition | Formule exacte | Date | Compte | Oublie / biais |
|---|---|---|---|---|---|
| **D1** | `v_conso_reelle` (ABC, couverture, stock max, C50, cockpit, assistant) | Σ lignes de SORTIE_PROD + CONSO_DIRECTE + SORTIE_HORS_MACHINE (sauf HM_PRET) − RETOUR_CONSO, mouvements contre-passés exclus, **+ Σ écarts machine effet CONSOMMATION > 0** (tous motifs, corrections comprises) ; `conso_mensuelle = cumul / max(1, mois depuis la 1re sortie)` | mouvement : date du mouvement ; machine : **date de VALIDATION de la décision** | machine + directe + hors machine historique + sortie production (déchet) | rebut machine (déchargements DÉCHET/PERTE/CASSE, écarts DPC) ; écarts négatifs ignorés ; **moyenne depuis l'origine** sans fenêtre ; corrections MJ_CORRECTION comptées |
| **D2** | XYZ (`domain/classification.rs`) | par mois sur 12 mois glissants : Σ SORTIE_PROD + CONSO_DIRECTE + SORTIE_HORS_MACHINE (sauf prêt), contre-passés exclus ; puis **MAX(mois réel, besoin MRP du mois)** | date du mouvement | mouvements seuls | **aucun écart machine** (tout le fil machine !) ; **RETOUR_CONSO non déduit** (le commentaire dit « les mêmes sorties que v_conso_reelle » : faux) ; le plan (futur) se mélange aux mois passés |
| **D3** | `v_of_consommation.kg_reel` (→ `v_of_bilan`, C61, écran OF) | Σ écarts CONSOMMATION **signés** hors MJ_CORRECTION des décisions ACTIVES où `id_of_periode` = l'OF + Σ CONSO_DIRECTE − Σ RETOUR_CONSO portant l'OF (contre-passés exclus) ; déchet / perte / casse (écarts + déchargements) et autres écarts **à part** | aucune (cumul de l'OF) | ce qui est attribué à un OF | tout le non attribué ; SORTIE_HORS_MACHINE ; **comparé à un prévu qui inclut la perte (1 + taux_perte) alors que le réel exclut le rebut** : comparaison asymétrique |
| **D4** | `v_qualite_consommation` (onglet par qualité) | part OF = D3 agrégé **au mois de la date de l'OF** ; + part « sans OF » = écarts CONSOMMATION hors correction sous `code_qualite_periode` (NULL → « Non attribué ») **au mois de la fiche**, + CONSO_DIRECTE − RETOUR_CONSO sans OF sous `mouvement.code_qualite` | mixte : date de l'OF pour une part, date de la fiche pour l'autre | machine + directe, attribué ou non | **SORTIE_HORS_MACHINE (52 t) absente**, même en « Non attribué » ; deux axes de temps dans la même colonne ; un OF à cheval sur deux mois tombe entièrement dans le premier |
| **D5** | `f_machine_consommation` (écran machine) | par étage × réf × lot, sur [du, au] : Σ écarts effet CONSOMMATION (**corrections comprises**), DPC, non qualifié, régularisation, erreur ; décisions DEPART exclues | **date de la fiche** (à défaut, validation) | machine seule | hors machine ; pas d'OF ni de qualité ; MJ_CORRECTION compté comme consommation (contraire à D3/D4) |
| **D6** | `v_machine_consommation` | Σ kg chargés (fiches CHARGE) − Σ kg déchargés − kg de l'état actuel, lus dans `machine_fiche_ligne.kg_mouvementes` | — | rien : la colonne n'est plus remplie depuis le modèle des décisions | **vue morte et fausse** : chargé = 0, conso = −5 473 kg (= −stock machine) ; non lue |
| *annexe A* | `v_besoin_of.kg_consomme` | D3 **+ écarts DÉCHET/PERTE/CASSE + déchargements vers DÉCHET/PERTE/CASSE**, plafonné au prévu, réparti par mois | mois de l'OF | — | inclut le rebut, contrairement à D3 ; plafonné ; plus utilisée par le besoin (27b) |
| *annexe B* | `v_stat_mouvement_reference.sorties_kg`, `v_stat_famille.sorties_kg` (écran Statistiques) | Σ de **tous** les types de signe −1 : CHARGE_MACHINE, RETOUR_FOURN, AJUST_INV_NEG, transferts… | date du mouvement | des sorties de stock, pas une consommation | affichées « Sorties cumulées » et « rotation » : le chargement y passe pour une consommation |

**Écarts chiffrés sur `gestionfil_saisie`** (même base, même jour) :

| Définition | Total kg | Remarque |
|---|---:|---|
| D1 `v_conso_reelle` cumul | **247 679** | 195 473 machine + 52 206 hors machine |
| D1 « conso mensuelle » (somme des références) | **197 491 / mois** | quasi le cumul : voir défaut n° 1 |
| D1 corrigée (même formule, machine datée à la fiche) | 16 861 / mois | **facteur 11,7** |
| D2 XYZ, 12 mois, mouvements seuls | **16 430** (20 réf.) | aucune des 72 références de fil machine n'a de réel ; leur X/Y/Z vient du plan |
| D3 `v_of_consommation` Σ `kg_reel` | **85,5** | face à 33 354 kg prévus (5 OF) ; une seule ligne de décision attribuée |
| D4 `v_qualite_consommation` Σ `kg_reel` | **195 473** | 100 % « Non attribué » ; sans les 52 206 kg hors machine |
| D5 `f_machine_consommation` tout l'historique | **195 473** | 12 mois par date de fiche : 31 366 kg |
| D6 `v_machine_consommation` | **−5 473** | vue cassée |
| annexe A `v_besoin_of` consommé | 85,5 | idem D3 (aucun rebut dans la base) |
| annexe B « sorties » | **254 409** | inclut 200 946 kg de CHARGE_MACHINE, 1 200 de retours fournisseur, 57 d'ajustements |

Pour une même réalité (≈ 247,7 t consommées en 30 mois), l'ERP affiche donc aujourd'hui : 85 kg
(OF), 16 t (XYZ), 195 t (qualité, machine), 248 t (cumul ABC), 254 t (« sorties »), 197 t **par
mois** (couverture / ABC), et −5 t (vue morte).

### 1.3 Défauts constatés (classés par gravité)

1. **D1 date la consommation machine au jour de VALIDATION de la décision** (`fn_iso(e.date_decision)`),
   pas au jour du fait (la fiche). Sur la base de saisie, toute la consommation machine (2024-05 →
   2026-10) tombe en octobre 2026 : pour une référence de fil machine seule, `nb_mois_ecoules = 1` et
   la « consommation mensuelle » = le cumul de 29 mois (ex. *PP FRZ-2900 Dtex-Green Mlt 18-Tat* :
   5 831 kg « par mois »). Effets en chaîne : `v_conso_retenue` (78 références « REELLE » à
   185 657 kg/mois au lieu de 29 250 ; 29 d'entre elles repasseraient au plan), `v_stock_projete`
   (jours de couverture, statuts CRITIQUE/ATTENTION, stock max), classes ABC, Pareto du cockpit,
   DIO, C50 (13 signaux). En production le biais est moindre (on valide près du fait) mais il existe
   à chaque validation tardive et sur toute reprise. Et la moyenne « depuis l'origine » n'a pas de
   fenêtre : elle ne voit pas une tendance (la série machine de la base baisse de ~11 t/mois en 2024
   à ~3 t/mois en 2026).
2. **D2 (XYZ) ignore toute la consommation machine** et ne déduit pas RETOUR_CONSO : la régularité
   des fils est mesurée sur le plan, pas sur le réel.
3. **D3/C61 comparent un prévu « perte comprise » à un réel « rebut exclu »** : l'écart d'un OF est
   biaisé de −(taux de perte + rebut). D3 et l'annexe A traitent le rebut de façon opposée.
4. **Corrections (MJ_CORRECTION)** : exclues par D3/D4, comptées par D1 (si > 0) et D5.
5. **SORTIE_HORS_MACHINE historique (52 t, 21 % du réel)** : comptée par D1/D2, absente de D3/D4
   (même pas en « Non attribué »).
6. **D4 mélange deux axes de temps** (mois de l'OF / mois du constat).
7. **D6 `v_machine_consommation` est morte et fausse** ; la table `machine_consommation` est un
   reliquat vide. Les « sorties » de l'écran Statistiques confondent chargement et consommation.
8. **Valeur** : `machine_decision_ligne.cmup_mad` est vide sur les 459 lignes de consommation ; la
   valeur existe sur le mouvement de chargement (`ligne_mouvement.prix_kg_mad`, 5,08 M MAD chargés)
   et sur les sorties hors machine (1,13 M MAD). Aucune vue ne valorise la consommation réelle.
9. **Attribution** : 1 ligne sur 768 porte un OF / une qualité de période ; l'historique de la base
   de saisie est simulé (OF texte fabriqués). Par qualité, l'historique reste « Non attribué » —
   aucune analyse par qualité n'est possible avant que les OF réels ne vivent quelques semaines.
10. **Écart affiché sur des OF ouverts** : `v_of_bilan` montre −100 % (ou −98,4 %) sur les cinq OF
    LANCÉS ; un OF ouvert devrait montrer « prévu / consommé / reste », et l'écart « non
    calculable » tant qu'il n'est pas clôturé. Le prévu relit la recette actuelle
    (`v_recette_calculee`) : il n'est pas figé au lancement.

### 1.4 Recommandation : UNE source canonique

**Proposé : un « grand livre de la consommation » (`v_consommation_fait`, nom à confirmer), une
ligne par FAIT, d'où toutes les autres lectures dérivent.** Ce n'est pas un nouveau stock ni un
nouveau journal : une vue sur les deux registres immuables qui existent déjà (décisions machine et
mouvements).

| Colonne | Contenu |
|---|---|
| `date_fait` | date de la fiche machine (jamais la validation) ; date du mouvement |
| `source`, `id_source`, `ligne` | DECISION (id_decision, ligne_numero) / MOUVEMENT (id_mouvement, ligne) — le drill-down |
| `nature` | CONSOMMATION_MACHINE, CONSOMMATION_DIRECTE, RETOUR_CONSO (négatif), RETOUR_PROD (négatif, Q7 bis), HORS_MACHINE_HISTORIQUE, REBUT_DECHET, REBUT_PERTE, REBUT_CASSE, AUTRE_ECART (correction, non qualifié, régularisation, erreur de saisie) |
| `kg` | signé (retour négatif ; un écart négatif garde son signe) |
| `valeur_mad` | kg × prix de sortie (à décider, Q11) |
| `code_reference`, `lot_fournisseur` | + famille, couleur, catégorie, fournisseur par jointure |
| `code_machine`, `code_emplacement`, `code_motif`, `responsable` | machine seulement |
| `id_of`, `code_qualite`, `attribution` | OF de la période (`id_of_periode`) / de l'OF du mouvement ; qualité de l'OF sinon `code_qualite_periode` / `mouvement.code_qualite` ; `attribution` = OF / QUALITE / NON_ATTRIBUE |
| `mode_mesure` | ESTIMATION / PESEE (de l'état ou du constat) |

Règles : décisions ACTIVES seulement (une décision retirée n'a pas eu lieu) ; mouvements
contre-passés et leur contre-passation exclus ; CHARGE_MACHINE, RETOUR_MACHINE, transferts,
retours fournisseur, prêts **exclus** (ce ne sont pas des consommations) ; ajustements d'inventaire
exclus (ou nature à part, Q8).

Pourquoi celle-là :
- **elle respecte la doctrine** (« le mouvement donne la réalité physique ; le constat daté donne
  l'état observé ; l'OF / qualité donne le contexte d'attribution ») : elle ne calcule rien par la
  recette, elle range ;
- **une seule date (le fait)** corrige les défauts 1 et 6 ;
- **toutes les natures sont présentes et séparées** : chaque usage choisit explicitement ce qu'il
  somme (achat : CONSO + REBUT ; production : CONSO seule face au prévu sans perte, ou CONSO + REBUT
  face au prévu avec perte) au lieu que chaque vue réinvente sa liste de types ;
- **elle se rapproche du stock** : Σ chargé − Σ déchargé au magasin − Δ état machine = Σ natures
  machine (nouveau contrôle de cohérence, signal) ; Σ hors machine = Σ mouvements concernés ;
- **elle porte la clé du drill-down** jusqu'à la décision et au mouvement ;
- `v_conso_reelle`, la requête XYZ, `v_of_consommation`, `v_qualite_consommation`,
  `f_machine_consommation` deviennent des agrégats de la même vue, **mêmes colonnes en sortie**
  (aucun écran ne casse) ; `v_machine_consommation` disparaît.

---

## 2. Benchmark des autres ERP

Recherche web du 27/10/2026 (date de consultation de toutes les sources). Étiquettes :
**[DOC Sx]** vu dans la source ; **[EXTRAIT Sx]** lu seulement dans l'extrait du moteur de
recherche (moins sûr) ; **[DÉDUIT]** interprétation, non sourcée. Pages inaccessibles :
blogs.sap.com (403), miroir de l'aide Oracle EBS (connexion refusée), KBA SAP (connexion requise).
Beaucoup de pages d'aide SAP ouvertes sont des versions 4.6C / 4.7 : la logique du contrôle de
gestion est restée la même en S/4HANA, mais c'est à vérifier version par version.

### 2.1 SAP S/4HANA

- **Catégories d'écart** (Cost Object Controlling) : côté entrée, rebut, prix d'entrée, quantité
  d'entrée, *resource-usage* (substitution), reste ; côté sortie, prix mixte, taille de lot, prix de
  sortie, reste [DOC S1].
  - L'écart de **quantité d'entrée** est la différence entre quantités planifiées et réelles,
    valorisée au prix planifié [DOC S1][DOC S2]. La formule (Qté réelle − Qté cible) × prix plan
    se déduit de l'exemple ; elle n'est pas écrite telle quelle.
  - L'écart de **rebut** compare le rebut planifié au rebut confirmé [DOC S2].
  - Le **reste** reçoit ce qui ne se classe pas [DOC S1].
- **La cible** (consommation théorique) se calcule sur la **quantité livrée** : coûts dépendant du
  lot ÷ taille du calcul × quantité livrée. Seule la version 2 prend la quantité planifiée de
  l'ordre [DOC S3].
- **Ordre ouvert** : l'en-cours vaut les coûts réels. L'écart n'existe qu'à la livraison totale
  (DLV) ou à la clôture technique (TECO) [DOC S3][DOC S5][DOC S6].
- **Rebut** : le rebut planifié entre dans le standard ; le rebut composant gonfle les quantités
  d'entrée [DOC S1].
- **Rapport cible / réel** : coûts cible, réels, écart absolu et en %, quantité cible, quantité
  confirmée, écart de quantité [DOC S4].
- **Fiori** (d'après les tables des matières SAP PRESS, pas l'aide SAP) :
  - *Production Cost Analysis* F1780, *Analyze Costs by Work Center/Operation* F3331 [DOC S7] ;
  - *Material Scrap*, *Operation Scrap*, *Scrap Reason*, *Excess Component Consumption* (F2171),
    *Material Documents Overview*, *Monitor Material Coverage* [DOC S8][EXTRAIT S10].
- **MCRE** : analyse d'utilisation des matières, structure S026 ; quantité de besoin, quantité
  prélevée, valeur sortie [DOC S9].
- **Non vérifié** : MB51, KKS2 / KKBC_ORD, MCRX, et un traitement textile propre à SAP Fashion
  Management (aucune source trouvée).

### 2.2 Oracle (Fusion Cloud SCM 26D, EBS)

- **Écarts d'un ordre, calculés à la clôture** [DOC S11] :
  - *Material Usage* (quantité utilisée ≠ définition de travail), *Material Rate* (taux),
    *Material Substitution* ;
  - Resource Rate / Substitution / Efficiency, Batch Size, *Yield* (sortie planifiée vs réelle) ;
  - *Job Close* : le résiduel.
- **Rebut estimé** = quantité terminée × (1 − rendement) / rendement. Sorties et retours de
  composants sont valorisés selon la méthode de coût [DOC S11].
- **OTBI « Material Usage Real Time »** [DOC S13] :
  - mesures : *Required*, *Actual Usage* = **sorties − retours**, *Open* = requis − réel ;
  - contextes : lot composant, centre de travail, opération.
  - Domaines voisins : Work Order Performance, Resource Usage, Actual Production, Production
    Exceptions [DOC S14].
- **Écran Redwood *Review Work Order Costs*** : une liste, puis un détail avec les onglets Input,
  Output et Variance (filtres par opération, article, ressource) [DOC S12].
- **EBS** : *Discrete Job Value Report* (matière, ressources, rebut, écarts de clôture), ventilé
  par compte [EXTRAIT S15].
- [DÉDUIT] Sur un ordre ouvert, Oracle montre **requis / consommé net / reste**, sans écart :
  c'est le modèle le plus proche de notre situation (cible = besoin de l'ordre au métrage prévu).

### 2.3 Microsoft Dynamics 365 SCM

- **Quatre écarts de production à la fin de l'ordre**, contre le standard [DOC S19, AX 2012
  archivé] : taille de lot, quantité, prix, substitution. Ils se lisent par article, ressource ou
  groupe de coûts.
- **Rebut en nomenclature** : constant + variable [DOC S18, 2026-05-28].
  Exemple : besoin = 100 × 1,20 + 10.
- **Power BI « Production performance »** [DOC S16, 2026-03-05] :
  - écart = coût estimé − coût réalisé, calculé au statut *Ended* ;
  - tuiles : coût réalisé, écart, écart % ;
  - graphiques : écart par date et groupe de coûts, par site, **Top 10 produits défavorables**,
    **Top 10 ressources défavorables** ;
  - autres pages : défauts en ppm, OTIF ; dimensions : date, site, ressource, groupe d'articles.
- **Espace *Cost administration*** : onglet « High production variances », comparaison actif /
  estimé / réalisé [DOC S17].
- **Journaux** : la liste de prélèvement porte la consommation [EXTRAIT, AX 2012]. Le réalisé
  peut n'être mis à jour qu'à la fin de l'ordre [EXTRAIT S20].

### 2.4 Odoo (17 / 18 / 19)

- **Production Analysis** [DOC S21] :
  - mesures : coût composant / unité, coût total, quantité demandée / produite, **Yield %**
    (produit / demandé), coûts d'opération, durées ;
  - vues : tableau croisé et graphiques, comparaison avec la période ou l'année précédente ;
  - **pas de mesure « consommation attendue vs réelle »**.
- **Coût d'un OF** : *MO Cost* vs *Real Cost* [DOC S23].
- **Consommation flexible / avertissement / stricte** [DOC S22]. Dans le code [DOC S26] :
  - attendu = ligne de nomenclature × quantité **en cours de production** ;
  - réel = mouvements des composants ;
  - un assistant affiche « consommé / à consommer » à la clôture.
- **Rebut** : vers un emplacement virtuel, consultable par liste, **sans motif en standard**
  [DOC S24].
- **OEE** par poste de charge [DOC S25].
- [DÉDUIT] Pas d'écart par composant valorisé en standard.

### 2.5 Infor, ERP textile et tapis

- **Infor CloudSuite Industrial** [DOC S27] :
  - écart d'usage = (sorti − déjà passé en écart − **requis**) × coût standard, à la clôture ;
  - requis = **quantité terminée** × quantité par assemblage.
- **Infor LN** [EXTRAIT S28] :
  - écart d'efficacité, par ordre ou par composant de coût ;
  - les estimés se **figent** au lancement (*Moment Freezing Estimates*).
- **Aptean Traverse** : écarts de temps, d'usage et de production suivis **par code d'écart**
  [EXTRAIT S31].
- **Datatex NOW** : besoin en fil chaîne / trame et traçabilité du cône au produit, mais **aucun
  rapport d'écart publié** [EXTRAIT S29]. Infor M3 Fashion, BlueCherry : rien de pertinent.
- **Tapis (hors ERP)** [EXTRAIT S30] :
  - la grandeur suivie est le **poids de fil au m²** (on découpe 1 m², on arrache le velours,
    on pèse) ;
  - le fil touffeté se distingue du velours fini (pertes de tonte).
- **Aucun ERP ne documente publiquement un « écart de grammage » g/m².**

### 2.6 Synthèse comparative

| ERP | Axes | Indicateurs | Présentations | Base de la cible | Ordre ouvert |
|---|---|---|---|---|---|
| SAP S/4HANA | ordre, opération, centre de travail, composant, produit, catégorie d'écart, motif de rebut, période | cible / réel / écart (valeur, %), quantité, rebut attendu vs réel, surconsommation | rapport cible/réel, Fiori F1780 / F3331 / F2171, applis rebut, MCRE | quantité **livrée** | en-cours ; écart à DLV / TECO |
| Oracle Fusion | ordre, opération, composant, ressource, élément de coût, lot, centre de travail | requis / réel net / reste ; 9 écarts dont usage, substitution, rendement | liste puis détail (Redwood), OTBI | besoin de l'ordre | requis / réel / reste, écarts à la clôture |
| D365 SCM | ordre, produit, groupe d'articles, ressource, site, groupe de coûts, date | écart valeur et %, top 10 défavorables, ppm | Power BI (tuiles, graphes, top N), espace d'exceptions | standard / estimé de l'ordre | écart à « Ended » |
| Odoo | produit, ordre, poste, date | coût / unité, yield %, coût ordre vs réel, OEE | tableau croisé, graphes, N−1 | nomenclature × quantité en production | contrôle à la clôture |
| Infor CSI / LN | ordre, composant de coût, centre de travail | usage, gamme, efficacité | éditions par ordre / composant | quantité **terminée** ; estimés figés | écart à la clôture |
| Textile / tapis | ordre de tissu, chaîne / trame | g/m² (hors ERP) | non documenté | recette g/m² × m² | non documenté |

### 2.7 Ce que nous en retenons pour Gestion Fil [DÉDUIT]

1. **Deux comparaisons, jamais confondues.**
   - « Consommé vs besoin de l'OF » (recette × métrage **prévu**, avec le reste) : le modèle
     Oracle, faisable tout de suite.
   - « Écart d'usage » (recette × m² **produits**) : n'existe qu'avec la sortie réelle, comme
     partout ailleurs (SAP DLV / TECO, D365 Ended, Infor quantité terminée). C'est notre lot L6.
2. **Pas de cible sans sortie** : afficher « non calculable », jamais 0 % ni −100 %.
   Aujourd'hui `v_of_bilan` affiche −100 % sur les OF lancés.
3. **Consommation nette = sorties − retours, sur l'OF d'origine** (Oracle) : déjà notre règle
   hors machine.
4. **Séparer l'effet quantité de l'effet prix** (SAP, Oracle) : l'écart d'un OF se valorise à
   un prix de référence, et l'effet CMUP se montre à part.
5. **La substitution est une catégorie** (SAP *resource-usage*, Oracle, D365) : un fil hors
   recette consommé par un OF n'est pas un « surplus ».
6. **Rebut prévu dans la cible, rebut réel par motif** (SAP *Scrap Reason*, codes Aptean) : notre
   `taux_perte_pct` et nos motifs machine le permettent déjà.
7. **Un résiduel explicite** (SAP « reste », Oracle *Job Close*) : chez nous, les « autres écarts »
   (corrections, non qualifiés), visibles et rapprochés.
8. **Figer l'étalon au lancement de l'OF** (Infor LN) : une recette modifiée après coup ne
   réécrit pas l'écart des OF passés. Aujourd'hui `v_of_consommation` relit la recette **active**
   à chaque lecture.
9. **Présentation** : tuiles, puis top 10 défavorables (D365), puis tableau croisé, puis détail
   de l'OF et de ses lignes ; tendance et comparaison N−1 (Odoo).
10. **Des « m² équivalents » étiquetés comme tels** (kg nets ÷ kg/m² de la recette) comme
    indicateur d'avancement. Ce n'est pas un rendement : la mesure est circulaire avec la recette.

### Sources (consultées le 27/10/2026 ; « s.d. » = sans date visible)

- S1 SAP Learning, *Performing Variance Calculation*, s.d. — https://learning.sap.com/courses/cost-object-controlling-in-sap-s-4hana/performing-variance-calculation
- S2 SAP Help 4.7, *Variance Categories*, s.d. — https://help.sap.com/saphelp_470/helpdata/en/90/ba624f446711d189420000e829fbbd/content.htm
- S3 SAP Help 4.6C, *Calculation of Target Costs*, s.d. — https://help.sap.com/saphelp_46c/helpdata/en/90/ba6290446711d189420000e829fbbd/content.htm
- S4 SAP Help 4.6C, *Target / Actual Comparison*, s.d. — https://help.sap.com/saphelp_46c/helpdata/en/cf/6fe7d1414f11d182b10000e829fbfe/content.htm
- S5 SAP Help 4.6C, *Define Valuation Method (Actual Costs)*, s.d. — https://help.sap.com/saphelp_46c/helpdata/en/6e/f42c7dd435d1118b3f0060b03ca329/content.htm
- S6 SAP Learning, *Calculating Work in Process Based on Actual Costs*, s.d. — https://learning.sap.com/courses/cost-object-controlling-in-sap-s-4hana/calculating-work-in-process-based-on-actual-costs
- S7 SAP PRESS, table des matières *Product Cost Controlling with SAP S/4HANA*, s.d. — https://www.sap-press.com/product-cost-controlling-with-sap-s4hana_5832/toc/5173
- S8 SAP PRESS, table des matières *Inventory Management with SAP S/4HANA*, s.d. — https://www.sap-press.com/inventory-management-with-sap-s4hana_6141/toc/5561
- S9 SAP Help 4.6C, *Key Figures for Material Usage (S026)*, s.d. — https://help.sap.com/saphelp_46C/helpdata/EN/c1/3768f4449a11d188fe0000e8322f96/content.htm
- S10 KBA SAP 3727813 (F2171), extrait seulement — https://userapps.support.sap.com/sap/support/knowledge/en/3727813
- S11 Oracle Fusion SCM 26D, *Cost Accounting for Manufacturing Work Orders* — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26d/fapma/cost-accounting-for-manufacturing-work-orders.html
- S12 Oracle 25B, *Redwood: Review Work Order Costs* — https://docs.oracle.com/en/cloud/saas/readiness/scm/25b/inv25b/25B-inventory-wn-f37152.htm
- S13 Oracle Fusion 26D, *Manufacturing – Material Usage Real Time* — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26d/faumf/manufacturing-material-usage-real-time.html
- S14 Oracle Fusion 26A, *Overview of OTBI for Oracle Fusion Manufacturing* — https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faumf/overview-of-otbi-for-oracle-fusion-manufacturing.html
- S15 Oracle EBS, *Discrete Job Value Report* (extrait) — https://community.oracle.com/mosc/discussion/3775211
- S16 Microsoft Learn, *Production performance Power BI content*, 2026-03-05 — https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/analytics/production-performance-power-bi
- S17 Microsoft Learn, *Compare active, estimated, and realized costs on a production order*, 2025-06-17 — https://learn.microsoft.com/en-us/dynamics365/supply-chain/cost-management/tasks/compare-active-estimated-realized-costs
- S18 Microsoft Learn, *Set up scrap to calculate raw material requirements*, 2026-05-28 — https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/scrap-calculations
- S19 Microsoft Learn (AX 2012), *About analyzing variances for a completed production order*, 2014-04-18 — https://learn.microsoft.com/en-us/previous-versions/dynamicsax-2012/appuser-itpro/about-analyzing-variances-for-a-completed-production-order
- S20 Armanino, *Ending production orders in D365* (extrait) — https://www.armanino.com/articles/ending-production-orders-d365
- S21 Odoo 18, *Production analysis* — https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/reporting/production_analysis.html
- S22 Odoo 18, *Bill of materials* — https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/basic_setup/bill_configuration.html
- S23 Odoo 19, *Manufacturing order costs* — https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/mo_costs.html
- S24 Odoo 18, *Scrap during manufacturing* — https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/workflows/scrap_manufacturing.html
- S25 Odoo 18, *Overall equipment effectiveness* — https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/reporting/oee.html
- S26 Code source Odoo 18.0 — https://raw.githubusercontent.com/odoo/odoo/18.0/addons/mrp/wizard/mrp_consumption_warning.py
- S27 Infor CSI 10.x, *About Job WIP Costs*, s.d. — https://docs.infor.com/csi/10.x/en-us/csbiolh/inventory_user_cl_sl/lsm1454144442829.html
- S28 Infor LN (extraits) — https://docs.infor.com/ln/10.8/en-us/lnolh/tiolh/tiom000652.html
- S29 Datatex NOW (extraits) — https://datatex.com/portfolio-items/now-network-oriented-world/
- S30 Tapis : brevet US4519332 — https://patents.google.com/patent/US4519332 ; Interface — https://www.interface.com/CA/en-CA/more-from-interface/about/product-specification-disclaimers/
- S31 Aptean Traverse (extrait) — https://aptean.com/de/insights/blog/erp-manufacturing-software-production-application

À vérifier si besoin : les fiches officielles F1780 / F3331 / F2171 de la *Fiori apps reference
library*, MB51 / MCRX / KKS2, SAP Fashion Management.

---

## 3. Proposition pour Gestion Fil

Contrainte de fond : **pas de m² réels**. Le seul « produit » connu est le métrage PRÉVU de l'OF.
Ce que cela EMPÊCHE (et que les autres ERP calculent avec la quantité livrée / confirmée) :
- le **kg/m² réel** (consommation par unité produite), le **rendement** au sens propre
  (sortie réelle / entrée réelle), le **coût matière par m² réel** ;
- l'**écart de quantité « pur »** : aujourd'hui l'écart d'un OF mélange l'écart de consommation
  (plus de fil par m²) et l'écart de production (moins de m² que prévu). Un OF qui a produit 80 %
  de son métrage semble « économe » de 20 % ;
- tout écart sur un OF **ouvert** (la cible est inconnue tant qu'on ne sait pas ce qui est fait) ;
- la comparaison plan / réalisé en m² (`m2_realises` existe sur le plan, vide).

Ce qui reste POSSIBLE dès maintenant, sans m² réels :
- la consommation réelle en kg et en valeur, par fil / famille / couleur / catégorie / fournisseur /
  lot / machine / étage / période / motif / nature, sa tendance, sa régularité, son Pareto ;
- le **rebut** (kg, %, par motif, par machine, par lot / fournisseur) ;
- **le mix réel d'une qualité face à sa recette** : part de chaque fil dans la consommation
  attribuée à la qualité vs son % de recette — un RATIO, indépendant du nombre de m² ;
- le prévu / réel par OF **clôturé** (en kg, explicitement « au métrage de l'OF »), et un kg/m²
  dit « apparent » (réel / métrage de l'OF) ;
- la qualité de la donnée elle-même : part attribuée, part pesée, fraîcheur des constats.

### 3a. Indicateurs retenus et formules (sur `v_consommation_fait` = F, à défaut sur les tables actuelles)

| # | Indicateur | Formule | Utilisable aujourd'hui ? |
|---|---|---|---|
| I1 | Consommation réelle (kg) | Σ F.kg où nature ∈ {CONSOMMATION_MACHINE, CONSOMMATION_DIRECTE, RETOUR_CONSO, RETOUR_PROD, HORS_MACHINE_HISTORIQUE} | oui |
| I2 | Rebut (kg) | Σ F.kg où nature ∈ REBUT_* (écarts DÉCHET/PERTE/CASSE + déchargements vers DÉCHET/PERTE/CASSE + SORTIE_PROD) | oui (0 dans la base de saisie) |
| I3 | Consommation matière totale (kg) | I1 + I2 — **mesure de l'achat** (ABC, XYZ, couverture au rythme réel, C50) | oui |
| I4 | Taux de rebut (%) | I2 / I3 × 100 | oui |
| I5 | Autres écarts (kg) | Σ F.kg où nature = AUTRE_ECART (correction, non qualifié, régularisation, erreur) — jamais dans I1, toujours visible | oui |
| I6 | Valeur consommée (MAD) | Σ F.valeur_mad (règle de prix : Q11) | après Q11 |
| I7 | Consommation mensuelle moyenne | I3 sur les N derniers mois **pleins** / N (N = Q6, 12 proposé), mois sans consommation = 0 | oui |
| I8 | Tendance | pente / variation I7(3 derniers mois) vs I7(12 mois) ; même mois N−1 | oui |
| I9 | Régularité (XYZ) | CV = écart-type / moyenne des 12 mois de I3 (réel seul, sans le plan) | oui |
| I10 | Pareto / ABC | rang et % cumulé de I6 sur la période | après Q11 (en kg dès maintenant) |
| I11 | Prévu standard d'un OF (kg) | métrage OF × kg/m² recette × (1 + perte %) par référence (`v_of_consommation.kg_prevu` existant) ; variante sans perte | oui |
| I12 | Écart quantité OF (kg, %) | (I1 + I2 attribués à l'OF) − I11 avec perte **ou** I1 − I11 sans perte (Q3) ; % = écart / prévu ; **OF CLÔTURÉS seulement** (Q4), « non calculable » sinon ; fils hors recette en colonne « substitution » (Q16) | dès les premiers OF clôturés |
| I12b | Avancement d'un OF ouvert | prévu / consommé net / **reste** (modèle Oracle Required / Actual / Open), sans écart | oui |
| I13 | Valeur de l'écart (MAD) | écart kg × prix retenu (Q11) — l'« écart de quantité » des autres ERP, ici au métrage prévu | après Q11 |
| I14 | Rendement matière (%) | I11 / (I1 + I2) × 100, OF clôturés | idem I12 |
| I15 | kg/m² apparent | (I1 + I2) / métrage de l'OF, à comparer au kg/m² de la recette et au poids commercial ; libellé « au métrage de l'OF » | idem |
| I16 | Mix réel vs recette (points) | part réelle = I1(qualité, réf) / Σ I1(qualité) ; part recette = kg/m² réf / Σ kg/m² ; écart en points | dès que des consommations sont attribuées |
| I17 | Part attribuée (%) | Σ I1 attribuée (OF ou qualité) / Σ I1 | oui (≈ 0 % aujourd'hui) |
| I18 | Part pesée (%) | Σ kg mesurés en PESÉE / Σ kg | oui (0 % aujourd'hui) |
| I19 | Fraîcheur des constats | jours depuis le dernier constat par étage (C36 existe) | oui |
| I20 | Couverture au rythme réel (jours) | stock disponible / (I7 / 30) — **affichée à côté** de la couverture du plan, jamais à sa place (axe 1 = plan seul) | oui |

### 3b. Axes

| Axe | Source | Remarque |
|---|---|---|
| Qualité | OF.code_qualite, sinon `code_qualite_periode` / `mouvement.code_qualite` ; « Non attribué » | historique non attribué (Q9) |
| Fil (référence) | F.code_reference | axe principal de l'achat |
| Famille, couleur interne, catégorie matière, mode (MACHINE/DIRECTE) | `reference` → `famille`, `couleur`, `categorie_matiere` | 36 familles, 28 couleurs, 10 catégories |
| Rôle dans la recette (POIL, TRAME, CHAÎNE, COLLE, RUBAN, PLAST, CUIR) | `v_recette_calculee.code_role` | propre au tapis : où part le fil |
| Fournisseur, lot | `reference.code_fournisseur`, F.lot_fournisseur | rebut par lot (motif DE_PB_FIL) |
| OF | F.id_of | statut, date, métrage |
| Machine, étage | F.code_machine, F.code_emplacement | voie si utile |
| Période | F.date_fait → jour / semaine / mois / année | date du fait seulement |
| Motif d'écart, nature | F.code_motif, F.nature | DPC, changement de lot / de production, problème de fil… |
| Responsable | `machine_fiche.responsable` (texte) | **pas d'équipe ni de poste** dans la base : un « par équipe » demande une décision |
| Mode de mesure | ESTIMATION / PESÉE | fiabilité |

### 3c. Cockpit analytique de consommation

**Statut d'écran.** C'est un écran d'**ANALYSE**, pas un écran de travail : la règle « pas de
statistiques en tête de liste » (écrans de travail) ne s'applique pas ; une bande d'indicateurs en
tête est ici le contenu même. Les autres règles s'appliquent : 1 366 px sans défilement horizontal
(ligne complémentaire ↳ si une ligne ne tient pas), Liste/Cartes, accents, Retour, couleurs en
jetons de thème, aucun bouton d'écriture (lecture seule, module à décider : COCKPIT ou PLANS),
masquage des champs déclarés dans `champ_configurable`. Proposé : `/analyse-consommation`, sous
« Tableau de bord » ou « Production » dans le menu.

**Écran 1 — Vue d'ensemble** (1 366 px ; barre de filtres commune à tous les onglets)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Retour   Analyse de la consommation                                 [Exporter] [Imprimer]   │
│ Période [12 derniers mois ▾]  Qualité [Toutes ▾]  Famille [Toutes ▾]  Machine [Toutes ▾]     │
│ Nature [Consommation + rebut ▾]   Unité (•) kg  ( ) MAD                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Vue d'ensemble │ Par qualité │ Par fil │ Par OF │ Machines │ Rebut et écarts │ Fiabilité       │
├───────────────┬───────────────┬───────────────┬───────────────┬───────────────┬──────────────┤
│ Consommé      │ Valeur        │ Rebut         │ Écart OF clôt.│ Attribué      │ Pesé         │
│ 247,7 t       │ 6,2 M MAD     │ 0,0 % (0 kg)  │ — (0 OF)      │ 0,0 %  ⚠      │ 0 %  ⚠       │
│ ▲ +4 % vs N-1 │               │               │ seuil 15 %    │ → Fiabilité   │              │
├───────────────┴───────────────┴───────────┬───┴───────────────┴───────────────┴──────────────┤
│ Consommation par mois (13 mois, empilé)    │ Pareto des fils (valeur, top 15)                │
│  machine ▇  directe ▆  hors machine ▅      │ 1 PP FRZ-2900 Green ███████████  9,1 %  A       │
│  rebut ▃   — moyenne 12 mois  ┄ plan       │ 2 PES Sh-1500 Vizon █████████    8,6 %  A       │
│  ▇▇ ▇▇ ▇▆ ▇▆ ▇  ▇  ▆  ▇  ▇▇ ▇▇ ▇ ▇ ▇      │ …                         cumul 80 % → réf. 23   │
│  oct …………………………………………………………… oct          │ (clic barre → onglet Par fil, réf. filtrée)     │
├────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ Par qualité (clic → onglet Par qualité)    │ Par famille / couleur (carte de chaleur)        │
│ 8F  ████████  31,2 t   écart  +3,1 %       │            Écru  Bleu  Rouge  Vert …            │
│ YF  ██████    24,0 t   écart  −1,4 %       │  PP        ▓▓    ▓     ░      ▓▓                │
│ Non attribué ███████████████ 195,5 t       │  PES       ▓     ▓▓▓   ░      ░                 │
└────────────────────────────────────────────┴──────────────────────────────────────────────────┘
```

**Écran 2 — Par qualité → détail d'une qualité** (le cœur de l'axe 2)

```text
Analyse › Par qualité › 8F MOSQUÉE                                           Période : 12 mois
┌────────────┬────────────┬────────────┬────────────┬────────────┬──────────────────────────────┐
│ OF         │ Métrage OF │ Prévu      │ Réel+rebut │ Écart      │ kg/m² apparent / recette     │
│ 12 (9 clôt)│ 34 200 m²  │ 83 120 kg  │ 85 900 kg  │ +3,3 %     │ 2,51 / 2,39 (poids com. 2,39)│
└────────────┴────────────┴────────────┴────────────┴────────────┴──────────────────────────────┘
Mix réel face à la recette (OF clôturés + consommations attribuées à 8F)
 Fil                         Rôle    Recette %  Réel %   Écart pts   Réel kg   Rebut kg  Écart kg
 PP FRZ-2900 Green           POIL      41,0     43,5      +2,5      37 380       410     +1 920  ›
 PES Ver-1500 Bleu           POIL      22,0     21,1      −0,9      18 130       120       −250  ›
 Jute 8 oz                   TRAME     12,0     11,8      −0,2      10 140         0        −80  ›
 ↳ ligne complémentaire si la désignation ne tient pas (lots, fournisseur)
Tendance du kg/m² apparent par mois (OF clôturés)   ▁▂▂▃▂▂▃▄▃
```

**Écran 3 — Par fil → détail d'un fil**

```text
Analyse › Par fil › PP FRZ-2900 Dtex-Green Mlt 18-Tat            Famille PP FRZ · Vert · Tat
 Consommé 12 m 5,8 t · moyenne 486 kg/mois · tendance ▼ −18 % · XYZ : Y (CV 0,41) · rebut 1,2 %
 Couverture : 41 j au rythme réel  |  63 j selon le plan (axe 1)
 [graphe mensuel 24 mois : réel ▇ / plan ┄ ]
 Où part ce fil :   par qualité  8F 62 % · YF 21 % · Non attribué 17 %
                    par machine  CRM1 55 % · CRX 45 %
 Par lot :  LOT-2410-17  2,1 t  rebut 0,4 %   |  LOT-2502-03 1,9 t rebut 3,8 % ⚠ (DE_PB_FIL)
 Liste des OF ayant consommé ce fil ›
```

**Écran 4 — Par OF → détail** (existe : `/ordres-fabrication/:id` ; on y ajoute le lien vers les
décisions et la colonne « rendement », OF clôturé seulement)

```text
OF-2026-0412 · 8F · 2 800 m² · CLÔTURÉ le 14/11      Prévu 6 820 kg · Réel 6 950 · Rebut 85
 Référence            Prévu   Réel   Rebut  Écart   %     Décisions
 PP FRZ-2900 Green    2 790   2 905    40   +155  +5,6   7 constats ›
 ↳ constats : CRM1 étage 2 · 04/11 MJ_ORDINAIRE 410 kg · 07/11 … · 14/11 (frontière) 212 kg
```

**Écran 5 — Décision machine → mouvement** (existe : `/machines/fiches/:id`) — la fin du
drill-down : avant / chargé / retiré / après / écart / motif, et le mouvement CHARGE_MACHINE
d'origine du lot (prix de sortie).

**Drill-down** : Qualité → Fil (mix) → OF → Décision (fiche) → Mouvement, et dans l'autre sens
Fil → Qualités / Machines / Lots. Chaque clic garde les filtres (période, machine). Le fil d'Ariane
en tête (« Analyse › Par qualité › 8F › PP FRZ-2900 › OF-… ») sert de Retour.

**Onglets restants** : *Machines* (consommation et rebut par machine × étage × mois, nombre de
constats, dernier constat) ; *Rebut et écarts* (Pareto des motifs, par machine, par lot /
fournisseur, autres écarts à revoir — C40/C41) ; *Fiabilité* (part attribuée, part pesée, étages
sans constat récent, OF lancés sans consommation, OF clôturés hors seuil = C61, lien vers les
contrôles).

### 3d. Décisions à prendre par la direction (questions courtes à choix)

- **Q1 — Source unique du réel.** (a) un grand livre de la consommation, toutes les analyses en
  dérivent *(recommandé)* ; (b) garder une vue par usage.
- **Q2 — Le réel de l'ACHAT (ABC, XYZ, rythme réel, C50) compte-t-il le rebut ?** (a) oui :
  consommation matière totale *(recommandé — le rebut s'achète aussi)* ; (b) non.
- **Q3 — Étalon de comparaison d'un OF.** (a) métrage OF × recette × (1 + perte) face à réel +
  rebut *(recommandé, symétrique)* ; (b) métrage × recette sans perte face au réel seul ; (c) les
  deux côte à côte.
- **Q4 — Quels OF portent un écart ?** (a) clôturés seulement *(recommandé)* ; (b) aussi les lancés.
- **Q5 — Date d'une consommation machine.** (a) date de la fiche du constat *(recommandé)* ;
  (b) répartie au prorata des jours entre deux constats ; (c) date de validation (actuel D1 — à
  abandonner).
- **Q6 — Période de référence des moyennes.** (a) 12 mois pleins glissants *(recommandé)* ;
  (b) 3 mois ; (c) depuis l'origine (actuel).
- **Q7 — Retour de consommation.** (a) déduit au jour du retour *(recommandé)* ; (b) ramené au mois
  de la sortie.
- **Q8 — Corrections, non qualifiés, régularisations, ajustements d'inventaire.** (a) hors réel,
  montrés à part *(recommandé)* ; (b) dans le réel.
- **Q9 — Historique sans qualité.** (a) « Non attribué », jamais réparti *(recommandé — pas
  d'invention)* ; (b) réparti au prorata du plan, marqué « estimé ».
- **Q10 — Unité.** (a) kg partout + kg/m² « apparent » sur les OF clôturés seulement
  *(recommandé)* ; (b) aucun kg/m² avant les m² réels.
- **Q11 — Prix de la consommation.** (a) prix de sortie du chargement / du mouvement (déjà au
  livre) *(recommandé)* ; (b) CMUP du jour du fait ; (c) CMUP actuel.
- **Q12 — m² réalisés en attendant l'ERP de production.** (a) attendre *(défaut)* ; (b) un seul
  nombre « m² réalisés » saisi à la clôture de l'OF ; (c) par mois sur le plan
  (`m2_realises`, existe, vide).
- **Q13 — Équipe / poste.** (a) pas d'axe équipe *(défaut)* ; (b) le responsable de la fiche en
  tient lieu ; (c) ajouter un poste à la fiche machine.
- **Q14 — Accès.** (a) module COCKPIT ; (b) module PLANS (comme les OF) ; (c) nouveau module
  ANALYSE_CONSO.
- **Q15 — Étalon figé.** Le prévu d'un OF se fige-t-il au lancement (recette et perte du jour) ?
  (a) oui *(recommandé, comme Infor LN : une recette révisée ne réécrit pas le passé)* ; (b) non,
  recette actuelle (aujourd'hui).
- **Q16 — Fil hors recette consommé par un OF.** (a) colonne « substitution » à part
  *(recommandé)* ; (b) compté dans l'écart de quantité.

### 3e. Découpage en lots (du plus utile au moins utile)

| Lot | Contenu | Décisions requises | Pourquoi d'abord |
|---|---|---|---|
| **L0 — Vérité du réel** | dater la machine au jour de la fiche dans `v_conso_reelle` ; fenêtre glissante ; XYZ lit la même source (machine comprise, retours déduits) ; retirer `v_machine_consommation` ; témoin chiffré avant / après | Q2, Q5, Q6 | corrige des chiffres faux **déjà affichés** (couverture, statuts, ABC, Pareto, C50 : ×11,7 sur la base de saisie) |
| **L1 — Grand livre** | `v_consommation_fait` + contrôle de rapprochement (signal) ; `v_conso_reelle`, XYZ, `v_of_consommation`, `v_qualite_consommation`, `f_machine_consommation` réécrites dessus, mêmes colonnes ; ajout de la nature HORS_MACHINE_HISTORIQUE dans la vue par qualité ; banc de tests (mêmes résultats qu'à la main) | Q1, Q7, Q8, Q11 | une définition, des écarts qui disparaissent |
| **L2 — Cockpit, vue d'ensemble + par fil** | onglets Vue d'ensemble, Par fil (tendance, Pareto, XYZ, rythme réel vs plan, par lot) | Q14 | utile **tout de suite** : ne dépend pas de l'attribution |
| **L3 — Par qualité et par OF** | mix réel vs recette, prévu / réel / écart / rendement des OF clôturés, drill-down jusqu'à la décision et au mouvement | Q3, Q4, Q9, Q10, Q15, Q16 | prend sa valeur quand les OF réels vivent (aujourd'hui 0 % attribué) |
| **L4 — Rebut, écarts, machines, fiabilité** | onglets Rebut et écarts, Machines, Fiabilité | Q13 | le rebut est encore à 0 dans la base ; la fiabilité accompagne L3 |
| **L5 — États et assistant** | états imprimables (consommation par qualité / par fil, bilan d'OF), compétence de l'assistant « consommation de… » | — | confort |
| **L6 — Après les m² réels** | kg/m² réel, écart de rendement séparé de l'écart de consommation, coût matière par m² réel, plan / réalisé en m² | Q12 + ERP production | impossible avant |
