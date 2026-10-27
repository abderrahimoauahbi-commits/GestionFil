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

## 15. Moteur de couverture v2 : la couverture cible (spécification du 27/10/2026, À VALIDER)

> **Statut : rien n'est codé.** Cette section fixe les décisions prises dans la discussion du
> 27/10/2026. Le code ne commence qu'après la validation de ce texte. **La logique de Q0 est
> validée** et ne se rediscute plus. Seuls les points du § 15.9 restent ouverts.

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

### 15.10 Ce qui ne change pas

- Le stock compté, le classement des arrivages, la quarantaine, les restes et le fil sur machine.
- La source unique `couverture::etats()`.
- Le prix, la devise et le fournisseur du plan d'achat.
- « Commander » = une référence.
- Aucune décision automatique : le moteur propose, l'utilisateur décide.
