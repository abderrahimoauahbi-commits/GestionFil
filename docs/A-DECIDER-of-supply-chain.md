# Mission — OF Supply Chain : de la réalité physique à la consommation réelle par qualité

Document de travail commun (utilisateur, Claude, ChatGPT) — version du 22/10/2026 (révision 3).
Il remplace la proposition « fiche de production, vérité de la consommation » (abandonnée).

Tu travailles comme **architecte métier et logiciel senior** sur gestionFil, l'ERP Supply Chain de
Polyfashions Carpet (PostgreSQL 18, Rust Axum/sqlx, React 19). Lis `CLAUDE.md`.

## 0. Périmètre et règle de travail

- **On reste sur l'OF et la machine.** Pas de fiche de production dans gestionFil : elles seront
  **importées plus tard depuis l'ERP Production** (m² réellement produits).
- **On verrouille d'abord le modèle métier.** Aucun code, aucune structure SQL, aucune migration,
  aucun écran avant accord explicite, lot par lot.
- Ne comble jamais un trou par une règle ERP générique. Toute affirmation porte sa preuve, sinon
  « NON PROUVÉ ».
- **Ne pas complexifier avant d'avoir démontré**, avec les mouvements et les constats existants,
  comment on obtient la consommation par qualité.

## 1. Le résultat recherché

> **Savoir combien chaque qualité a réellement consommé.**

Machine CRM1, 4,20 m. À un instant donné : 1,20 m → OF X1 → qualité 8F ; 3,00 m → OF X2 →
qualité 8M. Deux OF n'occupent jamais la même portion physique au même moment.

Réponse attendue : **qualité 8F : X kg réellement consommés ; qualité 8M : Y kg.**

## 2. Six notions, six rôles — à ne jamais confondre

| Notion | Rôle |
|---|---|
| **OF** | intention, planification, orientation |
| **Production** | résultat de production (ERP Production, importé plus tard) |
| **Mouvement matière** | réalité physique des matières (chargements, déchargements) |
| **Constat daté** | état réellement observé |
| **Portion de largeur (« voie »)** | clé physique d'attribution, rien de plus |
| **Qualité** | niveau auquel on veut connaître la consommation |

> **Le mouvement donne la réalité physique ; le constat daté donne l'état observé ; l'OF / qualité
> donne le contexte d'attribution.**

## 3. Le flux

```text
PLAN DE PRODUCTION → stock projeté → OF retenus / prévus → stock projeté
   ├── besoin lié au plan
   └── besoin au-delà du plan
        → besoin matière prévisionnel → approvisionnement
        → mouvements physiques → constats datés → attribution / mesure réelle par qualité
```

**Séparation stricte :** plan + OF → **prévision** ; mouvements + constats datés → **réalité**.
L'OF ne devient jamais la source de la consommation réelle.

## 4. L'OF — ses rôles

1. **Prévoir** la consommation d'une période (qualité × m² × recette : un prévu, jamais le réel).
2. **Orienter** les chargements et déchargements des machines (il ne possède pas la matière).
3. **Analyser** le prévu face au réalisé matière (puis les m², à l'import des fiches).
4. **Commander au-delà du plan — le rôle le plus important.** Les OF consomment le plan :

   ```text
   Besoin (qualité, mois) = OF retenus (reste à produire)
                          + max(0, plan du mois − m² déjà couverts par des OF)
   ```

   Un OF n'est jamais compté deux fois avec le plan ; un OF au-delà du plan augmente le besoin et
   se signale ; un OF hors plan ajoute tout son besoin.

## 5. Changement d'OF — la formulation retenue

> **Un chargement physique peut continuer à servir après un changement d'OF ; en revanche, le
> changement d'OF doit obligatoirement produire un nouveau constat daté qui constitue une
> nouvelle frontière de mesure. La matière n'est pas rechargée pour autant : c'est le constat qui
> matérialise le changement de contexte OF, pas un nouveau chargement physique.**

## 6. La voie : une clé d'attribution, pas un sous-système

La voie sert **uniquement** à ne pas mélanger deux productions simultanées sur la largeur d'une
même machine. On n'en déduit pas :

- un objet métier autonome géré en permanence ;
- un suivi bobine par bobine ;
- une nouvelle forme de stock machine ;
- « un OF = une voie », ni « un chargement = un OF » ;
- une consommation calculée à partir de la largeur.

**Proposition minimale** : la voie n'existe que comme **attribution portée par la ligne de
constat** — « cette référence + lot, sur cet étage, sert l'OF X1 ». Pas de table de voies, pas de
géométrie : l'OF dit sa largeur occupée à titre d'information ; la ligne dit qui elle sert.

**Ajout de l'utilisateur (22/10/2026) — la voie comme information, avec sa capacité en bobines :**

- la **machine** porte sa largeur (CRM1 : 4,20 m) — *nouveau, n'existe pas aujourd'hui* ;
- l'**étage** porte déjà son nombre total de bobines (`machine_emplacement.capacite_bobines` :
  1 344) ;
- chaque **ligne d'étage** peut désigner sa **voie** (sa largeur, ex. 1,20 m) ;
- **capacité de la voie** = bobines de l'étage / largeur de la machine × largeur de la voie
  = 1 344 / 4,20 × 1,20 = **384 bobines** (320 par mètre sur cette machine).

Ce calcul **ne calcule jamais la consommation**. Il sert à :
- **proposer** le nombre de bobines au chargement d'une ligne sur sa voie ;
- **contrôler** (signal, jamais blocage) : une ligne au-delà de la capacité de sa voie, ou des voies
  d'un même étage dont la somme dépasse la largeur de la machine ;
- **séparer deux OF sur un même étage** : chaque ligne dit sa voie, donc son OF.

**Correction de l'utilisateur (22/10/2026) : l'OF ne propose ni voie ni machine.** La voie sert
**uniquement à dire au magasinier combien de bobines manipuler** : c'est un calcul qui facilite le
geste, rien de plus. Reste à fixer : l'arrondi de la capacité (proposé : à l'entier inférieur — une
bobine ne se coupe pas).

## 6 bis. La fiche hors machine (colle, latex, bande, jute, plastique…)

Proposée par l'utilisateur le 22/10/2026 : **date, responsable, OF, référence, lot, quantité.**

- **Ce n'est ni une table ni un nouveau type** (précision de l'utilisateur) : c'est une **interface
  de saisie simplifiée**, orientée pour les utilisateurs des autres matières. Derrière, les
  mouvements existants : la **Consommation directe** (`CONSO_DIRECTE`, 21/10/2026), qui porte déjà
  ces champs, et le retour (ci-dessous).
- **L'OF devient un lien** (aujourd'hui `numero_of` en texte) et devient obligatoire une fois les OF
  en place ; une consommation sans OF reste possible mais est **signalée** comme non attribuée.
- **Consommation d'un OF = écarts des lignes machine (fil) + ses fiches hors machine.**
- **Décidé le 22/10/2026 : le reste revient au magasin.** La fiche porte donc des lignes de
  **retour**, rattachées au même OF : **consommation de l'OF = sorti − rendu**. (Le mouvement
  d'entrée utilisé pour ce retour est un détail de conception, à proposer au lot 3 bis.)

## 6 ter. Décisions du 22/10/2026

1. **Retour au magasin** des matières hors machine : **oui** (§6 bis).
2. **Le constat de frontière appartient à l'OF sortant** : **oui**. Il mesure ce que l'OF qui
   se termine a consommé, et donne au suivant son état de départ (qui n'est pas une consommation).
3. **Nombre de bobines de la voie : toujours un entier.**
4. **Exercice de validation** sur l'historique réel de CRM1 (§9) : **oui**, en lecture seule.

## 6 quater. Réalisation lancée le 22/10/2026 — défauts retenus, à confirmer

L'utilisateur a demandé de tout réaliser. Les décisions encore ouvertes prennent ces défauts,
réversibles :
- **OF comptés dans le besoin** : PRÉVU et LANCÉ (pas CLÔTURÉ ni ANNULÉ).
- **Plan non couvert d'un mois écoulé** : abandonné (pas reporté).
- **Un OF réparti dans le temps** : son métrage au prorata des jours entre sa date et sa fin
  prévue (sans fin prévue : le mois de sa date).
- **Reste d'un OF lancé** : prévu matière − consommation déjà attribuée (jamais négatif).
- **Sortie en valeur** : inchangée, au chargement.
- **Cycle de l'OF** : PRÉVU → LANCÉ → CLÔTURÉ ; ANNULÉ depuis PRÉVU ou LANCÉ.
- **Nombre de bobines d'une voie** : entier, arrondi à l'inférieur.
- **Droits** : l'OF relève du module PLANS.
Socle : migration `2026-10-22a_ordre_fabrication_socle.sql`.

**Livré le 22/10/2026** : `2026-10-22a` (socle), `22b` (cycle de l'OF, consommation par OF et par
qualité, C61, écrans `/ordres-fabrication`), `22c` (besoin OF + plan non couvert, stock projeté, plan
d'achat, `GET /api/stock/besoin`, C64), `22d` (OF et voie sur les fiches machine, règle de
frontière, RETOUR_CONSO, `/fiche-hors-machine`, C62, C63). Le banc rejoue une semaine sur une
machine de 4,20 m (`scenario_of_semaine`) : deux OF côte à côte (voies 1,20 m = 384 bobines et
3,00 m = 960), un changement d'OF, de la colle sortie puis rendue — la consommation par OF et par
qualité y vaut le calcul fait à la main.

Points confirmés par l'utilisateur le 23/10/2026 (tels que livrés) :
- un OF **clôturé** ne couvre plus le plan de son mois : ce plan redevient « non couvert » ;
- un OF clôturé refuse toute sortie ou tout retour hors machine ;
- les kilos **déchargés vers le déchet, la perte ou la casse** comptent dans le déchet, la perte ou la
  casse de l'OF de la période ;
- un OF placé dans un mois que le plan ne couvre pas s'ajoute à l'extrapolation de l'horizon.
- l'écart d'un constat peut être rangé sous l'OF sortant même déjà clôturé (pas de refus) ;
- simulation : les matières hors machine sont calées sur le métrage de l'OF et la recette.

## 6 quinquies. Décisions du 23/10/2026 — réalisées (migrations `2026-10-23a`, `2026-10-23b`)

- **Chaque lot a son conditionnement** (`lot.poids_bobine_kg`, `lot.bobines_par_palette`, origine et
  date) : mesuré à la réception (kilos / bobines, bobines / palettes entières), sinon la fiche article ;
  corrigé sur la fiche du lot (droit VALIDER sur les lots, motif, journal `lot_conditionnement_journal`).
  Toute conversion palettes ↔ bobines ↔ kilos sur un lot prend son conditionnement (base, serveur,
  écrans) ; la fiche machine propose le poids d'une bobine du lot.
- **Saisie liée palettes / bobines / kilos** sur l'écran des mouvements (grille commune) et la fiche hors
  machine, selon le conditionnement du lot choisi.
- **La qualité explicite** : consommation directe et retour — avec un OF, sa qualité ; sans OF,
  obligatoire (base). Machine — qualité sur chaque ligne de chargement (celle de l'OF, sinon
  obligatoire), sur l'état, et sur la ligne de décision : qualité nouvelle et **qualité de la période**
  (même frontière que l'OF). Les statistiques par qualité comptent aussi le sans OF ; l'historique sans
  qualité y est « Non attribué » ; C62 ne compte plus que lui.

Défauts retenus (à confirmer) : sorties hors machine ordinaires et déchets sans qualité ; retour sans OF
borné par la qualité ; au déchargement et au constat, la qualité vient de l'état (ou de l'OF nouveau) ;
correction du conditionnement au droit VALIDER des lots ; une mesure de réception n'écrase jamais une
correction manuelle ; garde-fou de 50 % comme pour la fiche article.

## 6 quinquies-bis. Migration 2026-10-24d abandonnée (26/10/2026)

La migration `2026-10-24d_memo_besoin_of.sql` mettait en mémoire, une fois par instantané,
le résultat de `fn_besoin_of_mois()` (le besoin ajusté par les OF), qui était recalculé des
dizaines de fois par requête et ralentissait la recherche de référence des bons, les contrôles
et le briefing. **Elle est abandonnée, jamais commitée ni appliquée** : la direction a décidé le
26/10 que **l'OF ne fait pas partie du besoin MRP** (le besoin repose sur le plan seul ; l'OF est
du court terme, au plus une semaine, et sert la production et les statistiques). Le calcul
qu'elle accélérait va donc disparaître ; elle n'aurait été qu'une dépendance temporaire au
démarrage. On garde la réécriture de la requête des références commandables
(`routes/bons_commande.rs` : une seule lecture de `v_equivalence`), indépendante de l'OF.

## 6 sexies. 27/10 : l'OF sort du besoin MRP (migration `2026-10-27b`, exigée au démarrage)

Décision de la direction du 26/10, réalisée le 27/10. **Le besoin d'achat est le plan de production
seul** ; l'OF est du court terme (journalier, au plus une semaine) quand les délais d'achat se comptent
en semaines ou en mois : à l'horizon d'achat, seul le plan existe. La règle du §6 quater
(« besoin = OF retenus + plan non couvert », `2026-10-22c`) est **remplacée** :

- `v_besoin_mois`, `v_besoin_12m`, `v_besoin_horizon` rendent le plan seul, sans changer de colonnes
  (`besoin_plan_12m_kg` = total, `besoin_au_dela_12m_kg` = 0) ; `v_besoin_of_mois` et
  `v_besoin_horizon_of` existent encore, vides ; `fn_besoin_of_mois()` est supprimée. Le stock projeté
  et l'ancien `v_plan_achat` suivent d'eux-mêmes.
- **L'axe production / statistiques reste intact** : `v_of_mois`, `v_besoin_of_qualite`, `v_besoin_of`
  (prévu, consommé, reste d'un OF), `v_of_consommation`, `v_of_bilan`, `v_qualite_consommation`, et
  **C64 signale toujours** un OF au-delà du plan du mois (simple signal, gardé par décision).
- **Le fil sur machine compte au dernier constat, quel que soit son âge** : `v_stock_physique` ne
  l'exclut plus après `P_JoursInventMachine` jours ; le paramètre ne sert plus que le signal C36.
- Écrans : colonnes « dont plan » / « Au-delà du plan » retirées du stock projeté ; `GET /api/stock/besoin`
  et `composants/BesoinOf.tsx` ne montrent plus que le plan (horizon, délai, mois par mois).
- Le même jour, la proposition d'achat est passée au moteur de couverture (`2026-10-27c`, « Commander »).

### Audit indépendant du 27/10 (copie de la base de saisie)

Conforme : ressources (quarantaine, bloqués, prêts exclus ; restes, dormants, machine sans limite
d'âge comptés ; bon partiellement reçu pour son reste), même quantité / D / date limite entre l'onglet
et `generer()`, droits (LIRE pour l'onglet, ECRIRE pour Commander), aucun piège SQL. Simulation : un bon
de 500 kg validé dans la fenêtre baisse la proposition de 500 kg exactement ; un OF lancé ne la change
pas ; un lot bloqué sort des ressources et revient débloqué.

Corrigé le même jour : les indicateurs « à commander » (budget, kilos, références, paliers, par
fournisseur) lisent les propositions ouvertes, plus l'ancien `v_plan_achat` ; une quantité masquée l'est
aussi dans les étapes du calcul ; une référence inactive se lit sans bouton « Commander ».

**Restent à décider (aucun n'est codé)** :
1. **Transfert en route** : la règle le compte, le moteur le laisse « hors couverture » faute de date
   d'arrivée prévue (règle provisoire affichée). Le compter dès aujourd'hui, à une date saisie à
   l'expédition, ou attendre la réception ?
2. Fenêtre `[D, F[` (30 jours pleins, celle de l'exemple validé n°1) ou `[D, F]` ?
3. Sans classe ABC, la sécurité la plus longue des trois (aucune référence aujourd'hui).
4. Date de ligne dépassée d'un bon : prime-t-elle sur une nouvelle date d'en-tête ?
5. Fenêtre et sécurité coupées à la fin de l'horizon du plan.
6. `P_MrpInclureStockMachine` : le moteur compte toujours la machine (décision du 26/10) ; le
   paramètre ne vaut plus que pour l'ancien calcul — le retirer ?
7. Onglets Situation / Par fournisseur, `/api/plan-achat/detail`, briefing : les statuts de stock y
   viennent encore de l'ancien calcul (`v_stock_projete`) ; les garder, les passer au moteur ou les
   retirer ?
8. Le moteur se lit avant la transaction de génération (≈ 0,5 s) : un bon validé dans cet intervalle
   donne une proposition à régénérer — défaut technique mineur, laissé en l'état.

## 7. Ce que les données existantes donnent déjà (preuves, base de saisie, 22/10/2026)

| Fait | Preuve |
|---|---|
| Chaque validation de fiche est une **décision** par étage, horodatée | `machine_decision` (`code_emplacement`, `date_decision` timestamptz), `domain/decision_machine.rs` |
| Chaque ligne de décision (référence + lot) porte **avant, mouvementé, après, écart, effet, motif** | `machine_decision_ligne` : `kg_avant`, `kg_mouvementes`, `kg_apres`, `ecart_kg`, `effet_ecart`, `code_motif` |
| L'écart est **déjà calculé** à chaque décision | `decision_machine.rs` : `ecart_kg = kg_avant ± kg_mouvementes − kg_apres` (selon le type de fiche) |
| L'écart est **déjà classé** par effet | `effet_ecart` : CONSOMMATION, AUCUN (et DÉCHET, PERTE, CASSE par motif) ; 450 lignes CONSOMMATION = 192 189,8 kg ; 309 lignes AUCUN |
| Les motifs disent la cause | `machine_motif` : CH_PRODUCTION, CH_COMPLEMENT ; DE_CASSE, DE_DECHET, DE_PERTE, DE_PB_FIL, DE_CHGT_LOT, DE_CHGT_PROD ; MJ_ORDINAIRE, MJ_DPC, MJ_CORRECTION |
| Le contexte OF existe, **en texte** | `machine_fiche.numero_of` (369 fiches sur 369 renseignées) |
| Pas d'OF structuré, pas de qualité sur la machine | aucune table d'OF ; aucune colonne `qualite` sur les tables machine |
| La mesure est souvent **estimée** | `machine_etat.mode_constat = ESTIMATION` (21 sur 21) ; bobines × poids × % ; `poids_retenu_kg` existe |
| En valeur, le chargement sort du stock | `CHARGE_MACHINE` sortie au CMUP ; `RETOUR_MACHINE` réintègre au prix du chargement |

**Conclusion des faits :** la réalité physique est **déjà mesurée, ligne par ligne, période par
période** (entre deux décisions d'un même étage). Ce qui manque n'est pas la mesure : c'est
**l'attribution fiable de chaque écart à un OF, donc à une qualité**.

## 8. De la réalité physique à la consommation par qualité — le chemin proposé

Quatre pas, sans consommation théorique et sans sous-système de voies :

1. **L'écart d'une ligne de constat est la réalité observée sur une période** : depuis le constat
   précédent de la même ligne (même étage, même référence + lot) jusqu'à celui-ci. Il est classé
   par son effet : consommation, déchet, perte, casse, correction.
2. **Cet écart appartient à l'OF qui occupait la portion PENDANT cette période** — l'OF *sortant*
   au constat de frontière, jamais l'OF qui commence.
3. **L'OF donne sa qualité.**
4. **Consommation réelle d'une qualité = somme des écarts à effet CONSOMMATION des périodes
   attribuées à ses OF** ; déchets, pertes et casses se totalisent à part.

### Ce qui rend l'attribution sûre — ou incertaine

| Situation | Attribution |
|---|---|
| Un étage ne sert qu'un OF entre deux constats | **sûre** |
| L'OF change avec un constat de frontière | **sûre** : la période se coupe au constat |
| L'OF change **sans** constat | **incertaine** : la période est à cheval sur deux OF → c'est pourquoi le constat de frontière est obligatoire |
| Un étage sert **deux OF en même temps** (deux portions) et les lignes sont séparées par OF | **sûre** : chaque ligne dit l'OF qu'elle sert |
| Un étage sert deux OF et les bobines ne se comptent **pas** séparément | **non attribuable sans règle** → à décider ; tout résultat serait marqué « estimé » |
| Constat estimé (%) | sûre quant à l'OF, **approximative quant aux kilos** |

## 9. La formule est une hypothèse, pas une règle

`début + chargés − déchargés − fin` est **l'hypothèse de calcul** déjà appliquée ligne par ligne
par les décisions machine. Elle n'est pas encore validée comme vérité de consommation par qualité.
À vérifier sur des cas réels :

- la précision d'un constat estimé (%) face à une pesée ;
- le poids réel d'une bobine face au nominal (`poids_retenu_kg`) ;
- le déchargement rendu au magasin, le changement de lot (DE_CHGT_LOT), le changement de
  production (DE_CHGT_PROD) ;
- les corrections (MJ_CORRECTION) : elles ne sont pas une consommation ;
- un OF interrompu puis repris ; deux OF simultanés sur un même étage.

**Méthode de validation proposée, sans code :** prendre l'historique réel d'une machine (CRM1) sur
la base de saisie, et reconstituer **à la main**, décision par décision, la consommation par OF
(d'après `numero_of`) puis par qualité. Les cas où l'attribution échoue révèlent les vraies
décisions à prendre.

**Résultat de l'exercice (22/10/2026, lecture seule) : il n'existe pas encore d'historique réel.**
- **Base de saisie** : l'historique de CRM1 vient de l'**agent de simulation**. Chaque fiche porte un
  numéro d'OF fabriqué (`SIM-2025-05-20-CRM1-E1-CH`), un par fiche, sans qualité ; toutes les
  décisions sont horodatées du jour de la simulation (10/10/2026), la date réelle n'étant que sur
  la fiche, au jour.
- **Copie de la production (20/10/2026)** : seulement l'**inventaire d'ouverture** du 22/09 —
  1 fiche, 40 décisions, 23 états `ESTIMATION`, aucun `numero_of`.
- **Conséquence** : l'attribution par OF et par qualité ne peut pas se valider sur les données
  actuelles. Il faut une **semaine réelle de l'atelier** sur une machine (chargements, constats,
  OF, voies), relevée sur papier ou saisie en essai, pour dérouler le calcul. Et l'agent de
  simulation devra apprendre de vrais OF (plusieurs fiches par OF, avec leur qualité).

## 10. Ce que nous ne voulons pas

- ❌ Un OF source de la consommation réelle, ou qui sort le stock.
- ❌ Une consommation calculée par la recette ou par la largeur.
- ❌ Un chargement attribué définitivement à l'OF actif au moment du chargement.
- ❌ Un changement d'OF sans constat daté.
- ❌ Une gestion des voies comme sous-système ; un suivi bobine par bobine ; un second stock machine.
- ❌ Une saisie de consommation dans la fiche de production.
- ❌ Un OF compté deux fois avec le plan.
- ❌ Une copie de SAP, Oracle, Odoo ou Dynamics.

## 11. Décisions à prendre

### BLOQUANT
1. **À quel OF appartient l'écart d'un constat ?** Proposé : à l'OF qui occupait la portion
   pendant la période qui se termine (OF sortant).
2. **Un étage partagé par deux OF** : les bobines de chaque OF se comptent-elles séparément ?
   Sinon, quelle règle (et le résultat est « estimé ») ?
3. **Le `numero_of` des fiches existantes** désigne-t-il l'OF en cours ou l'OF pour lequel on
   charge ? (conditionne la reprise des 369 fiches)
4. **Quels OF comptent dans le besoin** : lancés seulement, ou aussi prévus ? Et le plan non
   couvert d'un mois écoulé : abandonné ou reporté ?

### IMPORTANT
- Quand la matière quitte le stock **en valeur** : au chargement (aujourd'hui) ou au constat ?
- L'heure du constat : obligatoire aux frontières d'OF (aujourd'hui, la décision est horodatée,
  la fiche datée au jour).
- La qualité de mesure portée par le constat (pesé, compté, estimé).
- L'ERP Production et son numéro d'OF (clé commune, pour l'import futur).

### SECONDAIRE
- Traçabilité lot → OF, occupation des machines, recalage des recettes à partir du réel.

## 12. Réalisation (après décisions, chaque lot validé avant d'être codé)

1. **L'OF** : numéro, qualité, m² prévus, période, largeur occupée (information), statut ; prévu
   matière affiché. Aucun effet.
2. **Le besoin** : les OF consomment le plan ; le plan d'achat lit « OF + plan non couvert ».
3. **L'attribution** : la ligne de constat dit l'OF qu'elle sert ; elle peut indiquer une voie
   (largeur), d'où le nombre de bobines à manipuler calculé pour le magasinier ; la machine porte
   sa largeur ; constat de frontière obligatoire au changement d'OF, rangé sous l'OF sortant ; le
   `numero_of` texte devient un lien.
3 bis. **La fiche hors machine** : écran simple sur la consommation directe (date, responsable, OF,
   référence, lot, quantité), OF en lien ; retour éventuel selon la décision du §6 bis.
4. **La consommation par OF puis par qualité** : écarts des lignes machine attribués (consommation,
   déchet, perte, casse séparés, avec la qualité de mesure) + fiches hors machine.
5. **Prévu / réalisé matière** par OF et qualité.
6. **Reprise de l'existant** : 369 fiches, états estimés, consommations directes sans OF.

Plus tard : import des fiches de production (m²), kg/m² réels.

## 13. Prochain point

**La validation sur données réelles (§9)** : reconstituer à la main la consommation par OF puis
par qualité sur l'historique de CRM1, pour répondre aux décisions bloquantes 1 à 3 à partir des
faits, pas d'une théorie.

## 14. Règle finale

> **Le mouvement donne la réalité physique ; le constat daté donne l'état observé ; l'OF / qualité
> donne le contexte d'attribution ; la voie n'est que la clé qui sépare deux productions
> simultanées.**
> **La consommation réelle par qualité est la somme des écarts constatés, attribués à l'OF qui
> occupait la portion pendant la période — jamais une estimation théorique.**

## 15. Moteur de couverture v2 : la couverture cible (spécification du 27/10/2026, validée)

> **Statut : livré le 27/10/2026 au soir (non publié).** `domain/couverture.rs` porte les cas
> 1, 2, 3, 4a et 4b du § 15.6 comme tests unitaires aux chiffres exacts, le bilan, l'équivalence
> classique, une propriété sur plans et arrivages pseudo-aléatoires, le stock minimum sans effet
> sur Q, l'article sans cible et la consolidation du cas 4a (1 215 kg à J+30, puis J+61) ; le banc
> rejoue le cas 1 aux chiffres exacts et le cas 3 transposé au mois (la photo MRP est mensuelle)
> par l'API (`scenario_couverture_cible`). Migrations `2026-10-27l` (exigée) et `2026-10-27m`.
> Écrans : /stock › Stock projeté (21 colonnes), Simulation, Surveillance (l'ancien onglet
> « À commander », sans bouton « Commander » pour l'instant) ; contrôles C05, C25, C68, C69 servis
> par le moteur. **Interprétations à confirmer** : (1) quand la rupture est inévitable (D > R),
> le stock au début de D est compté à zéro au plus bas — le manque d'avant D (−B(D − 1), soit
> P(R, D) − reste(R) sans arrivage) est affiché, pas commandé ; (2) un article SANS cible et avec
> une rupture sur l'horizon (ni inévitable ni sous sécurité) est SOUS_CIBLE (« la rupture reste
> visible dans l'état ») ; (3) la frise mensuelle (mur de risques, photo du plan) garde ses codes
> de mois PLAN_NON_COUVERT / SOUS_SECURITE / COUVERT ; (4) « Avant le » = D* − L même quand la
> réception est en retard (elle est alors dépassée, en rouge).

### 15.1 Notations et formules

```
j = 0 (aujourd'hui) … H (fin de l'horizon du plan en service)
p(t)       besoin planifié DATÉ du jour t (plan de production → besoin_mrp, réparti au jour)
P(a,b)     Σ p(t), t ∈ [a, b[  (la seule mesure du besoin dans le moteur ; aucune moyenne)
S0         stock compté aujourd'hui (magasins inclus au MRP, hors quarantaine et bloqué, restes comptés,
           fil sur machine au dernier constat), comme aujourd'hui
A(t)       arrivages datés et comptés (lignes de bon validées, transferts en route datés)
B(t)       solde au soir du jour t = S0 + Σ_{k≤t} (A(k) − p(k))  (sans plafonner à 0)
b(t)       point bas du jour t, AVANT ses arrivages = B(t−1) − p(t)   (b(0) = S0 − p(0))
R          première rupture : premier t tel que B(t) < 0 (avec les propositions déjà placées)
reste(R)   B(R−1) : le stock qui reste au début du jour de rupture (0 ≤ reste < p(R))

C   couverture cible (jours) = 30 × couverture cible de l'article (mois)
L   délai fournisseur (jours)
N   couverture d'une commande (jours)
S   jours de sécurité de la classe ABC
NS(t) = P(t+1, t+1+S)   seuil de sécurité du jour t, en kg du plan daté

D*  = R − C                       date de besoin (réception normale)
D   = max(D*, L)                  réception possible (aujourd'hui + délai au plus tôt)
Date limite de commande = D* − L
Fenêtre de la commande  = [R, R+N[   ; si D > R (rupture inévitable) : [D, D+N[
Q0  = besoin net de la fenêtre = P(fenêtre) − reste(R) − arrivages datés dans la fenêtre
    = min Q tel que, Q reçu en D, aucune rupture avant la fin de la fenêtre
X   = max_{t ∈ [0, L]} min( NS(t), NS(t) − b(t) )⁺      (sécurité, 1re proposition seulement)
Q   = arrondi_fournisseur(Q0 + X)   (minimum de commande, multiple, palette)
```

### 15.2 Les définitions : chacune a un seul rôle

| Notion | Définition | Ce qu'elle fixe | Source |
|---|---|---|---|
| **Couverture actuelle** | R − aujourd'hui : ce que le stock projeté couvre avec le plan daté et les arrivages datés | une mesure, jamais une décision | calculée |
| **C, couverture cible** | la couverture souhaitée **au moment de la réception** | **la date** de la réception normale (C jours avant la rupture) | fiche article, **obligatoire** pour un article soumis au MRP |
| **L, délai** | délai fournisseur | **la faisabilité** : date limite, retard, rupture inévitable | fournisseur, sinon `P_DelaiDefaut` |
| **N, couverture d'une commande** | la durée de besoin qu'une commande couvre (l'intervalle entre deux réceptions en régime normal ; c'est la règle de lot « période » des ERP) | **la quantité** | fournisseur (`couverture_commande_j`), sinon `P_MargeJours` |
| **S, sécurité ABC** | protection dynamique quand un creux sous NS est projeté dans [aujourd'hui, aujourd'hui + L] | **un complément X** à la 1re proposition, seulement s'il y a un creux | `P_SecuriteA/B/C` |
| **Stock minimum** | garde-fou absolu en kg | **un signal** (« vérifier le plan »), **jamais une quantité** | fiche article (`stock_min_kg`) |

**C ≠ N ≠ S ≠ stock minimum.** `P_CouvMinMois` n'entre dans aucune formule. « Plan / mois » n'est
qu'un indicateur affiché.

**La cible n'est pas un plancher physique permanent.** Elle dit qu'à la réception normale, le stock
doit couvrir encore C jours. Juste après la réception, il couvre C + N jours.

### 15.3 L'algorithme chronologique (une référence)

1. **Charger** S0, les arrivages datés A(t) et le plan daté p(t) jusqu'à H, comme aujourd'hui.
2. **Configuration.** Si C est absente, la configuration MRP est incomplète : on émet le signal
   `CIBLE_NON_DEFINIE` et on ne fait pas de proposition (voir § 15.9-1). On calcule quand même
   R et la couverture actuelle.
3. **Projeter** B(t) et b(t) sans proposition. On en tire R et la couverture actuelle.
4. **Sécurité.** On parcourt [0, L] et on compare b(t) à NS(t) :
   - tS est le premier jour de franchissement ;
   - X est la profondeur du creux le plus bas, plafonnée à NS ;
   - si X = 0, la sécurité n'est pas appliquée.
5. **Stock minimum.** On parcourt [0, L]. Si b(t) < stock minimum, on émet le signal
   `SOUS_MINIMUM` avec la date du 1er franchissement. Aucune quantité n'est générée.
6. **Boucle des propositions**, tant qu'une rupture R existe sur l'horizon et que le plafond de
   propositions n'est pas atteint :
   1. calculer D*, D, la date limite et la fenêtre ;
   2. calculer Q0 ;
   3. ajouter X à la 1re proposition seulement ;
   4. calculer Q = arrondi(Q0 + X) ;
   5. placer Q en D dans la projection (l'excédent d'arrondi et X restent en stock et repoussent la
      rupture suivante) ;
   6. recalculer R.
7. **Si D > D*** : la commande est en retard sur la cible, signal `RETARD_CIBLE`.
   **Si D > R** : la rupture est inévitable, signal `RUPTURE_INEVITABLE` ; le manque P(R, D) est
   affiché, pas commandé.
8. **Aucune décision n'est prise** : le moteur propose, l'utilisateur commande (« Commander »).

### 15.4 Les états et les signaux

**État d'une référence**, calculé sans proposition (le plus grave l'emporte) :

| État | Condition | Remplace |
|---|---|---|
| `RUPTURE_INEVITABLE` | R < aujourd'hui + L : aucune commande passée aujourd'hui n'arrive à temps | `PLAN_NON_COUVERT` (qui signifiait « une rupture quelque part sur l'horizon ») |
| `SOUS_SECURITE` | X > 0 : creux sous NS dans [aujourd'hui, aujourd'hui + L] | `SOUS_SECURITE`, au nouveau sens |
| `SOUS_CIBLE` | couverture actuelle < C | nouveau |
| `COUVERT` | couverture actuelle ≥ C (y compris sans rupture sur l'horizon) | `COUVERT` |

**Signaux**, indépendants de l'état, ne bloquent jamais :
- `CIBLE_NON_DEFINIE` (configuration incomplète) ;
- `SOUS_MINIMUM` (vérifier le plan) ;
- `RETARD_CIBLE` (date limite passée) ;
- `HORIZON_COURT` (H < aujourd'hui + C : le plan est trop court pour juger la cible) ;
- les données manquantes déjà connues (classe ABC absente…).

Un contrôle `Cxx` pour `SOUS_MINIMUM` et un pour `CIBLE_NON_DEFINIE` sont servis par le moteur,
comme C05 et C25.

### 15.5 L'affichage

- **Situation** (fenêtre de détail, stock projeté) :
  - couverture actuelle, en jours, avec la date de rupture ;
  - cible C, avec sa source ;
  - **écart** (couverture − C, en jours) ;
  - rupture projetée (date ou « aucune sur l'horizon ») ;
  - date de besoin D*, date limite de commande ;
  - sécurité : « appliquée : X kg, creux le tS (b = … kg sous NS = … kg) » ou « non appliquée » ;
  - stock minimum : « respecté » ou « franchi le … ».
- **Approvisionnement** : L, N et S, chacun avec sa source ; minimum de commande, multiple.
- **Proposition** : la décomposition **Q0 (besoin net de [R, R+N[) + X (sécurité) + arrondi = Q**,
  la fenêtre couverte et le stock projeté après réception.
- **Listes** (« À commander », Surveillance, Stock projeté) : les colonnes Couverture actuelle |
  Cible | Écart | Date limite | À commander, et l'état.
- **Plan / mois** reste affiché comme indicateur, marqué « indicateur, non utilisé par le calcul ».
- Les écrans disent leur source (« moteur de couverture, plan daté »).

### 15.6 Les cas de test (ils deviennent des tests unitaires du moteur)

Réglages communs : C = 60 j, N = 30 j, L = 30 j. Les chiffres sont vérifiés jour par jour.

| Cas | Données | R | D* / D | Date limite | Q0 | X | Q | Stock à R+N |
|---|---|---|---|---|---|---|---|---|
| 1. Régulier | S0 = 1 800, 15 kg/j | J+120 | J+60 / J+60 | J+30 | 450 | 0 | 450 | 0 |
| 2. Saison | S0 = 600 ; 5 kg/j jusqu'à J+89, 30 kg/j J+90→J+149, puis 5 kg/j | J+95 | J+35 / J+35 | J+5 | 900 | 0 | 900 | 0 |
| 3. Arrivage avant le pic | cas 2 + bon de 1 000 kg à J+85 | J+128 (reste 10) | J+68 / J+68 | J+38 | 690 | 0 | 690 | 0 |
| 4a. Sécurité sans arrivage | S0 = 600, 15 kg/j, S = 30 j (NS = 450) | J+40 | J−20 / J+30 (retard) | J−50 | 450 | **315** (creux dès J+10, b(30) = 135) | 765 | **315 = X** |
| 4b. Sécurité, arrivage pendant le délai | S0 = 500 + bon de 900 kg à J+20, 15 kg/j, S = 30 j | J+93 (reste 5) | J+33 / J+33 | J+3 | 445 | **265** (creux dès J+3, b(20) = 185 avant l'arrivage) | 710 | **265 = X** |

**Preuve d'absence de double compte**, à tester sur chaque cas :

- **Bilan de Q0** :
  S0 + A[0, R+N[ + Q0 = P(0, R+N) ⇒ le stock vaut 0 à R + N (cas 1 à 3).
  Le cas 3 donne 600 + 1 000 + 690 = 2 290 = P(0, 158).
- **Bilan de X** :
  S0 + A + Q0 + X = P(0, R+N) + X ⇒ le stock à R + N vaut **exactement X**.
  - Cas 4a : 600 + 765 − P(0, 70) = 315.
  - Cas 4b : 500 + 900 + 710 − P(0, 123) = 265.
  - Si X recomptait un besoin déjà couvert par Q0 ou par un arrivage, ce reste serait < X.
- **X se consomme une fois**. Il repousse la rupture suivante de X / p jours (4a : 21 j ;
  4b : 17 j), et la proposition suivante est retardée d'autant. À la réception d'après, le stock
  est de nouveau exactement C : 900 kg, avec ou sans sécurité. **La sécurité ne gonfle pas le stock
  en permanence.**
- **L'arrivage n'est compté qu'une fois** :
  - dans R, qu'il repousse : de J+33 à J+93 en 4b ;
  - dans b(t) à partir de son jour d'arrivée.

  Le jour même, b(t) est mesuré **avant** l'arrivage : c'est le creux réel, pas un besoin.
- **Équivalence avec le calcul classique** à la date de commande t₀ = D* − L :
  besoin du délai + besoin de N + plan des C jours suivants − stock à t₀ − arrivages.
  - Les deux calculs portent sur le même intervalle [t₀, R + N[ (puisque R = t₀ + L + C) et sur
    les mêmes ressources ; seul le découpage diffère.
  - Cas 1 : 450 + 450 + 900 − 1 350 = 450.
  - Cas 2 : 150 + 150 + 1 175 − 575 = 900.
  - Cas 3 : 150 + 350 + 1 600 − 410 − 1 000 = 690.

**Chronologie du cas 3** (preuve visuelle) :

| Date | Stock début | Besoin | Arrivage | Commande | Stock fin | Couverture sans / avec la commande |
|---|---:|---:|---:|---:|---:|---|
| J0 | 600 | 5 | | | 595 | 128 j / 158 j |
| J+38 (limite) | 410 | 5 | | | 405 | 90 / 120 |
| J+68 = D | 260 | 5 | | +690 | 945 | **60 = C** / **90 = C+N** |
| J+85 | 865 | 5 | +1 000 | | 1 860 | 43 / 73 |
| J+128 = R | 700 | 30 | | | 670 | rupture / **30 = N** |
| J+157 | 5 | 5 | | | **0** | — / 1 |

### 15.7 Critères d'acceptation

1. Les cas 1, 2, 3, 4a et 4b sont des tests unitaires de `domain/couverture.rs`, aux chiffres exacts
   ci-dessus : R, D*, D, date limite, Q0, X, Q, stock à R+N.
2. Les tests de **bilan** (stock à R+N = X) et d'**équivalence classique** passent sur ces cas et
   sur un plan aléatoire (propriété : quels que soient le plan et les arrivages).
3. Le moteur ne lit **aucune moyenne** : P(a,b) seul. « Plan / mois » ne sert qu'à l'affichage.
4. Le stock minimum ne change **jamais** une quantité (test : même Q avec ou sans minimum).
5. Un article sans cible : signal, pas de proposition, aucune valeur de repli.
6. La simulation (`POST /api/couverture/{ref}/simulation`) applique les mêmes formules (C, N, L et
   S modifiables dans les hypothèses).
7. **Mode comparaison sur une copie de la base** avant la bascule. Le tableau par référence
   (état, couverture, date limite, Q avant et après) est relu et **validé par l'utilisateur**.
8. Le banc de tests et les tests de bout en bout passent ; l'aide et le manuel sont mis à jour
   (définitions du § 15.2, indices des champs).

### 15.8 L'impact (estimation de premier ordre, base de saisie, 27/10/2026)

- Aujourd'hui, la commande se déclenche à la **sécurité ABC (30 j pour les trois classes)**.
- Demain, elle se déclenchera à la **cible**. Les 125 références en ont déjà une, importée du
  classeur :

| Cible | Références | Avec un plan | Stock moyen en plus (plan daté des C − 30 jours à venir) | Valeur (CMUP) |
|---|---:|---:|---:|---:|
| 1 mois (30 j) | 6 | 3 | 0 kg | 0 MAD |
| 2 mois (60 j) | 66 | 49 | ≈ 210 t | ≈ 4,36 M MAD |
| 2,5 mois (75 j) | 53 | 31 | ≈ 44 t | ≈ 1,13 M MAD |
| **Total** | **125** | **83** | **≈ 254 t** | **≈ 5,49 M MAD** |

C'est une **estimation**. Elle compare la cible à la sécurité actuelle de 30 j, sur le plan
daté. Ce n'est pas le résultat du moteur v2 : le chiffre exact, référence par référence, viendra
du mode comparaison (critère 7). Elle suffit pour une conclusion : **les cibles importées du
classeur engagent environ 5,5 M MAD de stock de plus.** Elles sont à revoir avant la bascule.
Les 42 références sans plan ne changent pas.

### 15.9 Points ouverts (à trancher avant le code)

1. **Article sans cible.** Le § 15.3 propose : signal `CIBLE_NON_DEFINIE`, **pas de proposition**,
   la rupture restant visible dans l'état. L'alternative serait une proposition à la rupture (C = 0),
   affichée comme telle. Aujourd'hui, toutes les références ont une cible ; le cas ne vise que les
   créations. Faut-il rendre la cible obligatoire à la saisie de l'article ?
2. **Rattrapage d'un retard sur la cible** (cas 4a). Quand D* < aujourd'hui + L, la 1re proposition
   arrive à L. La couverture à la réception reste alors sous C + N, et la boucle émet une 2e
   proposition le lendemain (J+30 puis J+31). Sans sécurité, elle les émettrait le même jour
   (J+30 deux fois). Faut-il **regrouper** en une seule proposition celles qui arrivent dans le
   même délai, comme le ferait un acheteur ? Ce regroupement touche l'affichage et « Commander »,
   pas Q0.
3. **Ce que X protège.** Le creux est dans [aujourd'hui, aujourd'hui + L] : par construction, une
   commande passée aujourd'hui arrive **après** lui. X ne protège donc pas ce creux-là. Le creux,
   c'est le signal qui le traite (accélérer, avancer l'arrivage existant). X **reconstitue** la
   protection entamée pour le cycle suivant. C'est conforme à la règle validée ; à confirmer en
   connaissance de cause.
4. **Les anciennes colonnes de l'article.** `stock_min_kg` est gardée et devient le garde-fou.
   `marge_securite_pct` n'a plus de rôle : elle sera supprimée, après le relevé de ses lecteurs.
   `couverture_min_mois` est renommée **couverture cible (mois)**. L'écran non monté
   « stocks minimums à revoir » et sa route sont à retirer.
5. **Les codes d'état.** `RUPTURE_INEVITABLE`, `SOUS_SECURITE`, `SOUS_CIBLE` et `COUVERT`
   remplacent les trois états actuels. Le cockpit, le briefing, l'assistant et les contrôles C05 et
   C25 suivent, puisqu'ils lisent tous `couverture::etats()`.

### 15.9 bis Décisions du 27/10/2026 (soir) : GO spécification → tests → implémentation

1. **Cible obligatoire seulement pour les articles soumis au MRP.** Il n'existe pas de drapeau
   « MRP » sur l'article, et on n'en ajoute pas. Un article est soumis au MRP s'il est actif et
   présent dans le besoin du plan en service. Sans cible : signal `CIBLE_NON_DEFINIE`
   (configuration incomplète) et aucune proposition. Aucun blocage à la saisie de la fiche.
2. **Une seule proposition consolidée quand la cible est déjà en retard.** Les propositions
   successives qui arrivent toutes à aujourd'hui + L sont fusionnées en une seule, dont la
   quantité est la somme des Q0 de chaque fenêtre (plus X et l'arrondi, appliqués une fois). La
   formule de Q0 ne change pas. Au cas 4a : une proposition de 765 + 450 = 1 215 kg à J+30, puis la
   suivante à J+61.
3. **X protège le cycle suivant ; le signal traite le creux immédiat** (accélérer, avancer
   l'arrivage existant).
4. `stock_min_kg` est le garde-fou (signal seulement). `couverture_min_mois` est renommée
   **`couverture_cible_mois`** et devient la cible MRP. `marge_securite_pct` de l'article est
   supprimée ; celle de la qualité, défaut du plan de production, reste. L'écran
   « stocks minimums à revoir », jamais monté, et sa route sont retirés.
5. **Les états sont séparés des signaux** (§ 15.4).
6. **L'impact sur les 125 références se calcule avant toute modification des cibles.** Le tableau
   de comparaison, ancien moteur contre v2 aux cibles actuelles, est produit sur une copie et remis
   à l'utilisateur. La v2 ne va pas sur la base de saisie avant sa validation.
7. **Taux de la facture d'import** : le taux de la facture s'il est saisi, sinon celui du dossier
   (même devise), sinon blocage si une conversion est nécessaire. C'est le comportement livré le
   27/10 (`2026-10-27k`).

**La formule de Q0 démontrée au § 15.6 ne se modifie plus.** On passe à la formalisation et aux
tests de régression.

### 15.10 Ce qui ne change pas

- Le stock compté, le classement des arrivages, la quarantaine, les restes et le fil sur machine.
- La source unique `couverture::etats()`.
- Le prix, la devise et le fournisseur du plan d'achat.
- « Commander » = une référence.
- Aucune décision automatique : le moteur propose, l'utilisateur décide.

## 16. Nouveau Stock projeté (spécification du 30/10/2026, validée et codée le même jour)

*Livré le 30/10/2026* : `domain/projete.rs` (T1 à T10 et les propriétés en tests unitaires),
`couverture::stock_projete` / `projete_de` (écran et plan d'achat, même fonction),
`GET /api/stock/projete?rattrapage=exclu&inverses=[…]`, bloc `projete` de
`GET /api/couverture/{ref}?rattrapage=exclu`, migration `2026-10-30a_stock_projete.sql` (CV, colonnes
déclarées ; exigée au démarrage), écran /stock (trois vues, bouton Rattrapage) et sa fenêtre. Le
reste de l'ERP (cockpit, briefing, assistant, contrôles C05, C25, C68, C69, onglet Surveillance) lit
encore le moteur v2 (`couverture::etats()`) : il passe à la Surveillance avec elle.

Le § 16 remplace le § 15 **pour le Stock projeté**. La mécanique chronologique du § 15 (B(t), R,
D\*, date limite, Q0, X, consolidation) n'est plus celle du projeté : elle passe à la Surveillance
(spécification à venir). Son code reste en place pour elle.

> **Frontière (verrouillée).** Le Stock projeté calcule une couverture estimative en tenant compte
> des consommations planifiées entre aujourd'hui et chaque approvisionnement prévu. Un
> approvisionnement n'augmente la couverture qu'à partir de sa date prévue d'arrivée. Un manque
> entre deux approvisionnements est traité selon l'option de rattrapage ; cette règle modifie la
> couverture projetée, mais ne fait pas du Stock projeté un outil de surveillance chronologique.
> Le projeté répond à « quelle couverture aurai-je, combien dois-je commander ? » ; la Surveillance
> à « où et quand est le risque ? ».

### 16.1 Les décisions (tables rondes du 30/10/2026)

| # | Décision |
|---|---|
| 1 | Le projeté n'est **pas chronologique** : ni date de rupture, ni frise, ni date limite |
| 2 | **Toutes** les commandes ouvertes comptent, chacune **à partir de sa date d'arrivée** ; aucun filtre d'horizon ; une date dépassée compte à partir d'aujourd'hui |
| 3 | La consommation du plan est **déduite avant chaque arrivage** |
| 4 | **Rattrapage** du manque avant un arrivage tardif : un **bouton à l'écran** (global, et par ligne), **inclus par défaut**, non retenu d'une ouverture à l'autre ; ce n'est pas un champ de la fiche |
| 5 | Déclenchement : couverture projetée **< C** (cible seule) |
| 6 | Quantité : la plus petite quantité qui, reçue à **aujourd'hui + délai**, porte la couverture projetée à **C + N** |
| 7 | Alerte, sur l'idée de gestion-mp-pro : seuil = sécurité de la classe ABC + stock minimum en jours ; le minimum ne change **jamais** une quantité |
| 8 | Trois onglets : **Approvisionnement** (19 colonnes), **Risques**, **Sourcing** ; fenêtre de détail sur le modèle gestion-mp-pro |
| 9 | Renommages : « Stock projeté » → **Position projetée** ; « Couverture actuelle » → **Couverture projetée** |
| 10 | Le **CV** est conservé à chaque classification ; le stock minimum est **affiché pour information** dans la fenêtre |
| 11 | Le plan d'achat appelle **la même fonction**, rattrapage **inclus** ; aucun recalcul parallèle |

### 16.2 Les calculs

```
j = 0 (aujourd'hui) … H (fin de l'horizon du plan en service)
p(t)    besoin planifié du jour t : le mois du plan ÷ jours du mois (profil « uniforme dans le
        mois », AFFICHÉ comme hypothèse) ; aucune moyenne
S0      stock compté : magasins inclus au MRP hors lots bloqués + fil sur machine au dernier
        constat + restes (quarantaine, bloqué, hors MRP : à part) — inchangé
A(t)    commandes ouvertes à leur date d'arrivée : reste à livrer des lignes de bon VALIDÉ /
        ENVOYÉ / LIVRÉ PARTIEL (date de la ligne, sinon de l'en-tête) et transferts en route
        (date prévue de disponibilité) ; une date passée ⇒ t = 0 ; sans date : à part, signalée

Rattrapage INCLUS   E(t) = S0 + Σ_{k≤t} (A(k) − p(k))                (le manque reste dû)
Rattrapage EXCLU    E(t) = max(E(t−1), 0) + A(t) − p(t), E(−1) = S0  (le manque est perdu)

Couverture projetée T = premier jour à partir duquel E reste < 0 jusqu'à H ;
                        aucun ⇒ « > H j »
Manque avant arrivage = Σ du plan non servi avant T (kg, sans date)
Position projetée      = S0 + Σ A (kg)
```

Tant qu'aucun arrivage n'arrive après l'épuisement du stock, T est le jour où la position épuise
le plan, quelle que soit l'option de rattrapage.

### 16.3 La quantité

- **Déclenchement** : T < C.
- **Q** = la plus petite quantité qui, ajoutée à A(aujourd'hui + L), donne T ≥ C + N, avec la même
  option de rattrapage. Sans arrivage tardif, Q = P(0, C + N) − position projetée.
- Puis le minimum de commande, puis le multiple d'achat (sinon la palette si la fiche le demande).
- **C + N** : C est la couverture cible, N la couverture d'une commande
  (`fournisseur.couverture_commande_j`, sinon `P_MargeJours`). Remonter à C + N revient à ce que
  chaque commande couvre N jours de consommation : la commande suivante se déclenche N jours plus
  tard.
- Aujourd'hui + L est la date **théorique de la nouvelle proposition** ; les commandes existantes
  gardent la leur.
- Si C + N dépasse H, Q se calcule jusqu'à H et le signal `HORIZON_COURT` le dit.

### 16.4 L'alerte et l'état

```
Seuil d'alerte (j)          = S (classe ABC : P_SecuriteA/B/C ; sans classe, la plus longue)
                              + stock minimum converti en jours de plan (le minimum épuisé sur le
                                plan à partir d'aujourd'hui + L)
Couverture à la livraison   = T − L
```

| État (le plus grave l'emporte) | Condition |
|---|---|
| `ALERTE` | couverture à la livraison < seuil d'alerte |
| `SOUS_CIBLE` | T < C (une quantité est proposée) |
| `COUVERT` | sinon |

Signal à part : `CIBLE_NON_DEFINIE` (aucune quantité, aucun repli). `P_SeuilAlerte` et
`P_SeuilCritique` échelonnent les **paliers de rupture** depuis le 31/10/2026 (§ 16.13), une autre
question que l'état.

*Observation* : avec les réglages actuels (S = 30 j pour A, B et C ; L ≈ 30 j ; C = 60 j), le
seuil d'alerte sans minimum vaut L + S = C : `ALERTE` et `SOUS_CIBLE` coïncident. Les deux états ne
se sépareront qu'après la revue des cibles et des sécurités (R2).

### 16.5 L'écran

*Revu le 31/10/2026 : colonnes, onglets et fenêtre au § 16.13 ; ce qui suit est l'état du 30/10.*

**Bouton « Rattrapage : inclus / exclu »** dans la barre d'outils (toutes les lignes) et sur chaque
ligne (exception marquée). Il revient à « inclus » à chaque ouverture.

**Onglet Approvisionnement** (19 colonnes) :

| # | Colonne | Contenu |
|---|---|---|
| 1-4 | Référence, Désignation, Fournisseur, ABC / XYZ | fiche article |
| 5 | Stock disponible | magasins inclus au MRP − bloqués − restes |
| 6 | Sur machines | dernier constat − restes − bloqués |
| 7 | Restant constaté | restes comptés (magasin + machine) |
| 8 | Arrivages | Σ A (toutes les commandes ouvertes) |
| 9 | **Position projetée** | 5 + 6 + 7 + 8 |
| 10 | Besoin pendant le délai | P(0, L) |
| 11 | **Couverture projetée** | T |
| 12 | Cible | C |
| 13 | Écart cible | T − C |
| 14 | Délai | L, avec sa source |
| 15 | À commander | Q (§ 16.3) |
| 16 | Unité / palette | Q ÷ kg par palette |
| 17 | Montant commande | Q × prix (prix, devise, fournisseur comme aujourd'hui) |
| 18 | Avant le | aujourd'hui + (T − C) ; passée ⇒ « dépassée de n j » |
| 19 | État | § 16.4, raison au survol |

**Onglet Risques** : référence, désignation, état, classe ABC, rang, % cumulé, valeur consommée sur
12 mois, classe XYZ, CV, politique ABC/XYZ (`v_analyse_abc_xyz`), palier de montant
(`v_risque_sourcing`).

**Onglet Sourcing** : référence, désignation, fournisseur, délai, nombre de sources et mono / multi
(`v_risque_sourcing` : fournisseurs du groupe d'équivalence), groupe d'équivalence, substituts, stock
et couverture projetée des substituts en stock (`v_substitution_dispo` + le même calcul), dernière
sortie, jours sans mouvement, dormant (`v_stock_dormant`). Le contrôle C25 s'y rattache.

**Fenêtre de détail** (clic sur une ligne) : Approvisionnement (fournisseur, délai, N et leurs
sources, prix, montant en MAD et en devise, stock minimum pour information, seuil d'alerte et son
calcul) ; Classement et risque ; Sourcing ; **Où se trouve la matière** (chaque stock, puis arrivage
par arrivage : consommation avant l'arrivage, l'arrivage, le manque éventuel et l'option de
rattrapage appliquée, « couvert jusqu'au … » ; chaque total est la somme exacte des lignes) ;
**Calcul de la quantité** (P(0, C + N) − position = besoin → minimum → multiple → Q).

### 16.6 Le plan d'achat

La génération appelle la fonction du projeté avec rattrapage inclus et reprend Q, la réception
théorique (aujourd'hui + L), le prix, la devise et le fournisseur. Même référence, mêmes entrées,
même Q que l'écran.

### 16.7 Ce qui quitte le projeté

| Élément | Destination |
|---|---|
| B(t), R, D\*, D, date limite, Q0, X, consolidation | Surveillance (code v2 gardé) |
| `RUPTURE_INEVITABLE`, `RETARD_CIBLE`, C05 | Surveillance |
| `SOUS_MINIMUM`, C68 | Surveillance (repère) ; au projeté, le minimum n'entre que dans le seuil d'alerte |
| C69 (article sans cible) | reste au projeté |
| C25 (équivalent en tension) | onglet Sourcing |

### 16.8 Les données

Une migration datée : le **CV** sur la référence, écrit par la classification
(`domain/classification.rs`), déclaré dans `champ_configurable`. Rien d'autre en base : le
rattrapage est un paramètre de la demande.

### 16.9 Les tests (plan 25 kg/j, C = 60 j, N = 30 j, L = 30 j, S = 30 j)

| Cas | Données | T inclus / exclu | Q | État |
|---|---|---|---|---|
| T1 | S0 = 1 000 ; 1 500 kg à J20 | 100 / 100 | 0 | COUVERT |
| T2 | S0 = 1 000 ; 1 500 kg à J50 (manque 250 kg) | **100 / 110** | 0 | COUVERT |
| T3 | S0 = 1 000 ; 1 500 kg à J20 ; 2 000 kg à J50 | 180 / 180 | 0 | COUVERT |
| T4 | S0 = 1 000 ; 1 500 kg à **J85**, puis à **J95** | **100 et 100** (inclus) ; 145 et 155 (exclu) | 0 | COUVERT |
| T5 | S0 = 1 000 ; 1 500 kg prévus à J−5 (en retard) | 100 | 0 : pas de double commande | COUVERT |
| T6 | S0 = 1 475 ; aucune commande | 59 | **775** | ALERTE |
| T6b | le lendemain : S0 = 1 450 ; 775 kg à J29 | 89 | **0** : une seule commande | COUVERT |
| T7 | T6 avec un stock minimum de 300 kg | 59 | **775** (inchangé) | ALERTE |
| T8 | S0 = 1 200 ; minimum 300 kg ; palette 400 kg | 48 | 1 050 → **1 200** (3 palettes) | ALERTE (18 j < 30 + 12 = 42 j) |
| T9 | T6 sans cible | 59 | aucune | signal `CIBLE_NON_DEFINIE` |
| T10 | S0 = 1 000 ; 400 kg à J50 | **56 / 66** | **850 / 0** | ALERTE / COUVERT |

T10 montre l'effet du rattrapage sur la quantité : inclus, le manque de 250 kg reste dû et la
commande se déclenche ; exclu, il est perdu et la couverture reste au-dessus de la cible. Le plan
d'achat prend l'option incluse.

### 16.10 Critères d'acceptation

1. T1 à T10 sont des tests unitaires d'un module de calcul pur, aux chiffres exacts ci-dessus.
2. Propriétés sur plans et arrivages aléatoires : sans arrivage tardif, T ne dépend pas de l'option
   de rattrapage ; déplacer une commande sans créer de trou ne change pas T (aucun effet de seuil) ;
   le stock minimum ne change jamais Q ; une commande proposée puis passée annule la proposition du
   lendemain.
3. L'écran et le plan d'achat donnent le même Q pour la même référence.
4. **Mode comparaison** sur une copie de la base : § 15 contre § 16, référence par référence
   (couverture, état, Q), relu et validé par l'utilisateur avant la base de saisie.
5. Le banc de tests et les tests de bout en bout passent ; l'aide et le manuel suivent.

### 16.11 Les étapes

Spécification validée → tests unitaires → module de calcul pur → migration du CV → route (paramètre
de rattrapage) → plan d'achat rebranché → écran (bouton, trois onglets, fenêtre) → mode comparaison
→ banc, e2e, aide → `gestionfil_saisie`.

### 16.12 Points ouverts

- ~~`P_SeuilAlerte` et `P_SeuilCritique`, lus par aucun calcul~~ : tranché le 31/10/2026, ils
  échelonnent les paliers de rupture (§ 16.13). Ils restent aussi recopiés dans chaque qualité et
  chaque plan de production (valeurs par défaut).
- Le seuil d'alerte (sécurité + stock minimum) vaut 300 j sur la plupart des références : 65 en
  `ALERTE`. Le réglage `P_ProjeteMinimumAlerte = 0` en laisse 55 ; la revue des minimums (R3) reste à
  faire.
- Un état `COUVERT` peut cacher une rupture aujourd'hui (un trou avant un camion, rattrapé) : le
  palier de rupture et le bandeau « à sec avant le camion » la montrent ; la règle de déclenchement
  (T < C) est inchangée.

### 16.13 Décisions du 31/10/2026 (codées et livrées le même jour)

Migrations `2026-10-31a` à `2026-10-31d` (31a et 31b exigées au démarrage), toutes appliquées à
`gestionfil_saisie` après sauvegarde. Chaque réglage démarre sur le comportement d'avant.

| # | Décision | Où |
|---|---|---|
| 1 | **Une seule ligne par référence**, sans ↳, sur les quatre onglets et le plan d'achat ; police 14 px | `DataTable` (`lisible`, `serre`) |
| 2 | **Référence · Fournisseur · État** fixes en tête des quatre onglets | `pages/Stock.tsx` |
| 3 | **Approvisionnement** : stock disponible, sur machine, en route (arrivages), position, conso / mois, couverture, rupture, cible, à commander, montant (stock disponible + sur machine + en route = position) | idem |
| 4 | **Couverture négative** = jours sans fil jusqu'au prochain approvisionnement : arrivage connu, sinon une commande passée aujourd'hui (aujourd'hui + L) | `projete.jours_sans_fil` |
| 5 | **Onglet Emplacements** : disponible total, un magasin par colonne, sur machines, restes, quarantaine, en route (transferts seuls), en route après le délai, commandé, stock global après l'arrivage | `stock_par_magasin`, `ColonneDT.droit` |
| 6 | **Paliers de rupture** : jours jusqu'au premier jour sans fil → RUPTURE (aujourd'hui), IMMINENTE (< `P_SeuilImminent`, 30 j, nouveau), CRITIQUE (< `P_SeuilCritique`, 60 j), ATTENTION (< `P_SeuilAlerte`, 90 j) ; le palier suivant et sa date (« → Critique le 28/11 ») ; filtre du rail | `projete::palier`, `paliers()` |
| 7 | **À sec avant le camion** : le premier trou avant un arrivage connu (date à sec, camion, manque, jours) ; bandeau en tête du plan d'achat (« faire avancer la livraison, ou acheter sur place ») | `projete.a_sec` |
| 8 | **Fenêtre de détail en « pont de calcul »** : décision (à commander, montant, avant le, réception), quatre chiffres, pont stock compté + arrivages − plan jusqu'à C + N = solde, + quantité ; où se trouve la matière (barre) ; arrivages ; onglets Calcul, Besoins, Lots, Métiers, Classement, Historique | `FenetreStockProjete.tsx`, `projete.pont` |
| 9 | **Restes** comptés ou non : réglage `P_ProjeteRestes` (1) que suit le plan d'achat, bouton de l'écran pour la session | `couverture::stock_du_projete` |
| 10 | **Réglages globaux** (section « Stock projeté » de Configuration) : `P_ProjeteRattrapage` (1), `P_ProjeteAgeConstatMax` (0 = sans limite), `P_ProjeteQuarantaine` (0), `P_ProjeteRetardJours` (0), `P_ProjeteSansDate` (0), `P_ProjeteMinMultiple` (1), `P_ProjeteMinimumAlerte` (1) ; le plan d'achat les suit, les boutons de l'écran n'en changent que l'affichage | `ReglagesProjete` |
| 11 | **Plan d'achat** : une ligne par proposition (valeurs regroupées dans une cellule, exportées en colonnes : `ColonneDT.joints`), paliers par fournisseur et bouton **Préparer**, mono / multi-source sous le fournisseur, tri pondéré ABC (A × 3, B × 2) | `pages/PlanAchat.tsx` |
| 12 | **Pieds de total** (lignes filtrées, toutes pages) et **filtres matière** : composition, rôle (rôle par défaut de la catégorie), type de fil, titrage, couleur, magasin principal | `ColonneDT.total` |
| 13 | Le magasin **Quarantaine** (type QUARANTAINE, hors MRP) créé dans `gestionfil_saisie` | donnée, aucun code |

Refusé : les tuiles en tête de liste (règle d'écran de l'entreprise).

Mesures sur une copie de la base (122 références) : 23 en rupture, 20 imminentes, 11 critiques,
5 en attention ; 5 matières à sec avant leur camion ; chaque réglage testé seul (rattrapage à 0 =
bouton « exclu » ; minimum hors alerte : 55 alertes au lieu de 65) ; stock + machine + arrivages =
position sur chaque ligne, dans chaque cas.
