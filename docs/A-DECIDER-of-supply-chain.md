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
