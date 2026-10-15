# ADR-003 — Réception unifiée : GR → IR → Landed Cost (logique SAP, CMUP seul)

**Statut** : accepté · **Date** : 2026-10-14 · **Portée** : réceptions, import, factures fournisseur, valorisation (CMUP), frais d'approche

Deux circuits de réception séparés — `/receptions` (local) et `/receptions-import` — étaient une **erreur de
concept**. En logique **SAP MM / Oracle**, la réception est **un seul processus** (*goods receipt*) ; l'import
n'est pas un autre circuit, il ajoute seulement des **coûts en aval**. Cet ADR fusionne les deux et formalise la
valorisation en **trois temps : GR → IR → Landed Cost**, identiques pour le local et l'import.

Principe directeur (ADR-001 D-04) inchangé : l'invariant est en base, la cascade dans le service, l'écran reflète.

---

## Décisions du 14/10/2026

- **D1 — CMUP seul, pas de grand livre.** On garde l'esprit SAP (3 temps) **sans** compte d'attente *GR/IR* en
  comptabilité générale. La valeur vit dans le **stock et le CMUP** (`ligne_mouvement` fait foi, `stock_magasin`
  n'est qu'un cache). Gestion Fil suit le stock et son coût, pas un plan comptable.
- **D2 — Chaque ligne reçue est rattachée à une ligne de bon de commande** (raffiné le 14/10 : *pas* « une
  réception = un BC »). Une **réception = un arrivage (un BL)** ; ce sont ses **LIGNES** qui pegent chacune à une
  ligne de BC, comme l'import le fait déjà. Une réception couvre **un** BC (cas local) **ou plusieurs** (conteneur
  import) — exactement comme une *inbound delivery* SAP peut couvrir plusieurs PO. « Un BC par réception » aurait
  combattu la réalité physique (un conteneur en couvre plusieurs). Plus de réception « hors commande » ; le dossier
  d'import (DUM, conteneurs) se **rattache**, il ne remplace pas la commande.
- **D3 — Une facture peut couvrir plusieurs réceptions.** L'IR (facture fournisseur) se rapproche de **plusieurs
  réceptions et plusieurs lignes** d'un même fournisseur, comme en SAP.
- **D4 — Bascule douce, et le marqueur est porté par le dossier** (14/10/2026, corrigé le même jour).
  `import_dossiers.circuit_reception` dit, **dossier par dossier**, par quel circuit il reçoit : `FACTURE` (ses
  lignes de facture, l'écran des réceptions d'import) ou `BON` (la réception unifiée, contre les lignes du bon de
  commande). Un marqueur porté par le dossier et **pas une date de bascule** : un dossier ouvert la veille dont le
  conteneur arrive dans deux mois doit finir par le circuit où il a commencé.

  **Le défaut reste `FACTURE`, et l'import ne bascule qu'en phase C.** Première rédaction de ce D4 : les nouveaux
  dossiers passaient tout de suite en `BON`. C'était faux, et le défaut était sérieux — la chaîne des frais
  d'import (clôture du dossier, répartition, CUMP définitif) lit ses kilos reçus dans
  `import_facture_lignes.quantite_recue_kg`, que **seul l'ancien circuit alimente**. Un dossier d'import neuf
  n'aurait plus pu se clôturer : ses frais n'auraient jamais atteint le CUMP. On ne ferme une porte que quand
  l'autre mène au bout. La phase C apprendra à cette chaîne à lire les arrivages, et posera alors `BON` par
  défaut. La frontière, elle, est déjà gardée et prouvée : un dossier en `BON` disparaît de l'ancien écran et le
  serveur refuse ses lignes — une même marchandise n'entre jamais par deux portes.

---

## Le modèle cible : trois étapes, le CMUP bouge à chacune

### 1. GR — Goods Receipt (la réception, fusionnée)
- **Une réception = un arrivage (un BL).** On y **ajoute des lignes** venues des **bons de commande dont la
  marchandise est arrivée** (recherche par réf / BC / fournisseur, comme l'import le fait déjà). Cas local : un
  seul BC. Cas import : le conteneur en apporte plusieurs. **Chaque ligne pege à une ligne de BC.**
- Le magasinier fait **le même geste partout** : peser, compter les colis, relever lots / palettes / bobines.
- **Ligne simple** : `Réf · Qté commandée · Reste BL · Pesé · Nb palettes · Nb bobines`. L'**attendu** (palettes /
  bobines théoriques), l'**écart** et le **lot** (généré `FOURNISSEUR-JJMMAA-NN` ou saisi) se lisent en
  **tooltip**, pas dans la ligne.
- Stock entré à **valeur provisoire** = prix du BC de la ligne (MAD) ou prix du BC × **taux** (devise). *(CMUP
  provisoire à la validation, règle « CMUP 2 temps ».)*
- Workflow conservé : `Brouillon → À contrôler → Validé → Clôturé`. Ségrégation B4 (le peseur ne valide pas).

### 2. IR — Invoice Receipt (la facture, locale ou import)
- **Une seule saisie de facture**, locale ou import, de la même manière.
- **Rapprochement 3-way** : facture ↔ bon de commande ↔ réception(s), sur la **quantité** et le **prix**.
- Un **écart de prix** (facture ≠ provisoire) **ajuste le CMUP** (régularisation), sans toucher la quantité déjà
  entrée. Pour un import, la **devise se fige au taux de la facture**.
- **Multi-réception** (D3) : la facture agrège les lignes reçues du fournisseur.

### 3. Landed Cost (frais d'approche, local **et** import)
- Fret, douane, assurance, manutention, dédouanement → saisis puis **répartis** sur les lignes reçues
  (poids / valeur / manuel), comme les *delivery costs* SAP et le *Landed Cost Management* Oracle.
- **CMUP définitif** = marchandise (IR) + tous les frais répartis. **Local** : souvent ~0. **Import** : le gros.
- Généralise la « Liquidation » d'import existante (ADR du 12/10) à tous les achats.

**CMUP en trois temps : provisoire (GR) → prix réel (IR) → complet (Landed Cost).** Même moteur pour tout le monde ;
seuls le **montant des frais** et le **change** diffèrent.

---

## Ce qu'on garde, change, supprime

- **Garde** : le workflow de réception, la pesée magasinier (quantités, montants masqués), le CMUP à 2 temps
  (étendu à 3), les frais d'approche / liquidation (généralisés), les contrôles (C11 cache = grand livre…).
- **Change** : fusion des deux écrans de réception ; l'**import se reçoit par lignes rattachées à des BC** (en
  devise) au lieu de lignes de facture ; une **facture couvre plusieurs réceptions**.
- **Supprime** : la séparation `/receptions-import` comme **circuit distinct** (l'écran disparaît au profit de la
  réception unique ; les objets import — dossier, DUM, conteneurs — se rattachent au BC).

---

## Plan d'exécution (l'app reste debout à chaque phase)

| Phase | Contenu | Touche |
|---|---|---|
| **A — Fusion GR** ✅ *écrite le 14/10* | Un seul écran de réception (un arrivage / BL) ; on **ajoute des lignes pegées à des lignes de BC** (un ou plusieurs BC, local ou import) ; lignes simples + tooltips (attendu/écart/lot) ; stock provisoire ; devise et dossier/DUM dans l'en-tête | écran réception + `domain/reception.rs` + migration |
| **B — IR unifié** ✅ *écrite le 14/10* | Une saisie de facture locale/import ; **rapprochement 3-way** multi-réception et multi-bon ; écart de prix → **CMUP**, exact par référence ; devise figée au taux facture | `domain/` valorisation + écran facture + migration |
| **C — Landed Cost unifié** ✅ *écrite le 14/10* | Frais d'approche pour local **et** import ; répartition (poids / valeur / parts égales) ; **CMUP final** ; et le chaînon qui manquait : la chaîne des frais d'import sait lire les **arrivages** | `domain/` coût de revient + écran frais + migrations |

Chaque phase : **migration datée et rejouable** (`db/pg/migrations/`, `OWNER TO gestionfil`), cascade dans
`domain/`, écran, puis **preuve** (banc `backend/tests/banc` + capture Edge e2e). On ne passe à la phase suivante
que quand la précédente est **verte** et que le **CMUP ne régresse pas** (C11, matrice des mouvements).

---

---

## Phase A — ce qui a été fait (14/10/2026)

Migration `db/pg/migrations/2026-10-14a_reception_arrivage.sql` (exigée au démarrage, `MIGRATIONS_REQUISES`) :

- `reception.id_dossier_import` — le dossier d'import de l'arrivage, avec son invariant en base
  (`trg_reception_dossier`) : pas de rattachement à un dossier **clos**, et plus de changement une fois la
  réception validée, car les frais se répartiront sur ces lignes-là.
- `bon_commande.id_reception_regularisee` — **le bon né d'un arrivage sans commande**. D2 interdit la réception
  « hors commande » : une ligne sans peg fait créer le bon qui manquait, en BROUILLON, **un seul par arrivage**,
  et la validation refuse tant qu'il n'est pas envoyé (message qui le nomme). C'est ce qui rend la chose visible à
  l'acheteur au lieu de la noyer dans le stock.
- `import_dossiers.circuit_reception` — le marqueur de la bascule douce (D4), à `FACTURE` pour tout le monde
  aujourd'hui : **l'import garde son circuit jusqu'à la phase C**, parce que ses frais n'y arriveraient pas
  autrement. La garde existe déjà pour le jour où il basculera.
- `P_BasculeReceptionGR` — le jour où la réception est devenue un arrivage. Il n'interdit rien, il **l'explique**.

Service : le peg est désormais **obligatoire des deux côtés** — `POST /api/receptions` comme
`POST /api/receptions/{id}/lignes` passent par un seul `ligne_bc_regularisation`. L'ancien chemin, où une ligne
ajoutée sans bon entrait au **prix du catalogue** sans aucun engagement, est fermé. L'écran gagne
`/api/receptions-dossiers-import` (gardé par `RECEPTIONS`, pas `IMPORT` : le magasinier dit quel conteneur il vide
sans lire les dossiers d'import).

Écran : la grille large du bon de commande cède la place à la saisie propre de la réception (`PeseesMobile`,
bureau **et** téléphone) ; **le peg voyage jusqu'au serveur** (il se perdait : chaque ligne proposée repartait sans
sa ligne de bon, et le serveur devait inventer un bon de régularisation pour une marchandise bel et bien
commandée) ; chaque ligne affiche **son** numéro de bon, et les propositions sont clés par ligne de bon — la même
référence attendue sur deux bons du même camion ne se recouvre plus.

Autre défaut corrigé au passage : la **devise de clôture** se lisait sur le bon de l'**en-tête**, qui est vide
sur un arrivage couvrant deux bons — la lecture retombait alors sur la devise du *fournisseur*, et un conteneur
payé en dollars se facturait en dirhams au taux 1. Elle vient maintenant des **lignes** (`facture_locale.rs`,
`contexte_facture_reception`), et un arrivage à plusieurs devises refuse de se clôturer d'un bloc plutôt que d'en
choisir une au hasard.

Preuve : `scenario_arrivage_unifie` au banc — deux bons dans un arrivage, peg obligatoire, bon de régularisation
unique qui bloque la validation jusqu'à son envoi, dossier rattaché / détaché / clos refusé, et la frontière des
deux circuits gardée dans les deux sens. Les 43 autres scénarios passent sans changement.

---

## Phase C — ce qui a été fait (14/10/2026), et l'ordre revu

**L'ordre des phases a changé en route : A → C → B.** La phase A avait fait de la réception un
arrivage, mais l'import ne pouvait pas la rejoindre — toute sa chaîne de frais (clôture du dossier,
répartition, CUMP définitif) lit ses kilos reçus dans `import_facture_lignes.quantite_recue_kg`, que
seul l'ancien circuit alimentait. Basculer l'import avant d'avoir appris cette lecture à la chaîne
aurait empêché tout dossier neuf de se clôturer : ses frais n'auraient jamais atteint le CUMP. C est
donc le **préalable** de la bascule, pas la dernière étape.

### C (1/2) — l'import se reçoit par l'arrivage · `2026-10-14b_import_sur_arrivage.sql`

- `importation::synchroniser_recu_arrivages` **relit** les kilos reçus d'un dossier en `BON` depuis
  ses arrivages validés — à la validation d'un arrivage et au seuil de la clôture. Un **recalcul**,
  pas un incrément : la facture arrive souvent après le camion, et un compteur aurait raté les kilos
  entrés avant qu'elle soit saisie. Toute la chaîne (reste à recevoir, base de répartition,
  localisation des lots, avoirs) continue alors de fonctionner **sans la toucher**.
- La localisation des lots (`porter`) lit les **deux** circuits par une UNION ; un dossier n'a jamais
  les deux, l'étanchéité y veille.
- Une **pesée en cours** sur un dossier empêche sa clôture : elle entrerait après la répartition.
- L'**étanchéité local/import devient conditionnelle au circuit** : elle garde toute sa force pour les
  dossiers en `FACTURE`, et s'écarte pour ceux en `BON`, dont la réception unifiée est la bonne porte.
- **C45** (« ligne de bon reçue à la fois en local et à l'import ») ne compte plus que les dossiers en
  `FACTURE` : pour un dossier basculé, ce lien **est** le chaînon qui relie les frais à la marchandise.
- `circuit_reception` passe à **`BON` par défaut**. Les dossiers déjà en base gardent `FACTURE` : leur
  marchandise est en route, leurs factures portent déjà des kilos reçus, et leur valorisation ne
  change pas de pied en cours de route.

### C (2/2) — les frais d'approche locaux au CUMP · `2026-10-14c_frais_approche_cmup.sql`

`frais_approche` existait depuis le portage et **personne ne s'en servait** : aucun écran ne la
remplissait, et surtout aucun de ces frais n'atteignait le CUMP — la clôture ne connaissait qu'un
`frais_mad`, un total tapé sur la facture et réparti à la valeur.

- **Chaque frais se répartit selon SA clé** : un fret au **poids**, une assurance à la **valeur**, une
  manutention en **parts égales**. Le moteur ne change pas (`appliquer` répartit au prorata de ce
  qu'on lui donne) ; seule la base change. Réparti à la valeur, un fret se fait payer au prix du
  kilo : la matière chère porte le transport de la matière lourde.
- **Porté une fois** : `frais_approche.date_portee` le marque, et un déclencheur fige alors le frais —
  il a bougé une valeur de stock. Avant cela il se retire (`DELETE /api/frais-approche/{id}`) : une
  faute de frappe ne mérite pas un avoir.
- Le journal distingue les frais de l'écart de prix (`origine = 'FRAIS'`, motif = le libellé) : au
  contrôle, « pourquoi ce CUMP a bougé » se lit sans recalculer.
- L'écran : une carte **Frais d'approche** sur l'arrivage validé, où la clé suit la nature par défaut
  (personne ne doit y penser pour un fret). La clôture rend `frais_arrivage_mad` et
  `valeur_complete_mad` — le coût de revient complet.
- **Pas de répartition MANUELLE en local** dans cet incrément : l'import l'a là où elle sert (la
  douane par nature de référence, onglet Liquidation). À demander si le besoin apparaît en local.

Deux défauts de l'existant corrigés au passage, tous deux révélés par le banc :

- **`ck_rec_ajust_origine` se re-rétrécissait au rejeu.** La migration `2026-10-09g` repose cette
  contrainte à chaque rejeu ; rejouée sur une base portant déjà des ajustements `FRAIS`, elle
  échouait sur ses propres lignes. La valeur est donc ajoutée **dans 09g aussi**, et son empreinte
  d'origine déclarée dans `EMPREINTES_REMPLACEES` — le mécanisme prévu pour cela.
- **Le filtre des frais mentait sur son nom** : `?code_reference=` portait en fait un identifiant de
  réception. `?id_reception=` existe maintenant ; l'ancien reste accepté.

Preuve : `scenario_import_sur_arrivage` (dossier basculé, reçu par l'arrivage, frais 7 500 MAD au
CUMP du magasin qui a reçu, pesée en brouillon qui bloque la clôture) et
`scenario_frais_approche_locaux` (deux références au profil opposé, fret au poids + assurance à la
valeur : 700 et 1 200 MAD au lieu de 1 055 et 844 si tout allait à la valeur — les deux clés ne se
confondent pas).

---

## Phase B — la facture unifiée : le plan (14/10/2026)

**Ce qui existe déjà et qu'on garde.** Le moteur de valorisation local (`domain/facture_locale.rs`) fait
*déjà* l'essentiel de D3 : une facture **couvre plusieurs réceptions** du même fournisseur et de la même
devise, son montant se répartit entre elles au prorata de leur valeur provisoire, la différence va au
**stock encore présent de ces lots** et le reste en **écart de prix** (tracé, hors CMUP), avec son journal
immuable, ses avoirs et ses factures complémentaires. La devise est figée au taux de la facture, contrôlé
contre le cours BAM. Il n'y a rien à refaire là : Phase B **l'habille d'un document** au lieu de le
déclencher depuis un formulaire accroché à une réception.

**Une facture peut couvrir plusieurs bons de commande** (décision du 14/10 : c'est rare, mais réel). Elle
le peut déjà par construction — ses réceptions couvrent chacune un ou plusieurs bons depuis la phase A —
à condition que le rapprochement se fasse **ligne par ligne** et non sur un total.

**Le document.** `facture_fournisseur` (en-tête : numéro, fournisseur, date, devise, taux, montant imprimé,
dossier d'import optionnel, statut `BROUILLON → VALIDEE`) et `ligne_facture_fournisseur`, dont chaque ligne
**pege à une ligne de réception** — et par elle à la ligne de bon, donc au prix engagé. C'est le même geste
qu'en phase A : le peg est porté par la ligne, jamais par l'en-tête.

**Rapprochement 3-way**, par ligne : quantité facturée ↔ quantité pesée (réception) ↔ prix engagé (bon).
Les écarts se lisent avant de signer ; ils ne bloquent pas (un écart peut être réel), ils s'expliquent.

**Validation = clôture** : le document appelle le moteur existant, les réceptions couvertes passent en
`CLOTURE`, le CMUP bouge, le journal garde tout.

**L'ancienne saisie reste** le temps que la nouvelle soit prouvée : c'est le même moteur, et la couper
d'un coup ferait tomber la valorisation qui marche aujourd'hui. Les factures des dossiers d'import
**d'avant la bascule** restent dans `import_factures` (même principe que la phase A, D4).

**Le point qui change un comportement.** L'ancienne saisie répartit la différence **au prorata de la
valeur provisoire**, parce qu'elle ne connaît qu'un total : l'écart d'une seule référence s'étale alors sur
toutes. Avec des lignes, l'écart de chaque référence est **connu** — c'est lui qu'on porte. Une fois les
lignes là, il n'y avait plus de choix cohérent : afficher un rapprochement par ligne et porter autre chose
au CMUP aurait été pire que les deux options. Le banc le mesure : une référence facturée au prix du bon ne
bouge pas, là où le prorata lui aurait donné une part.

### Ce qui a été fait · `2026-10-14d_facture_fournisseur.sql`

- `facture_fournisseur` + `ligne_facture_fournisseur`, chaque ligne **pegée à une ligne de réception** — et par
  elle au bon (prix engagé) et à l'arrivage (kilos pesés).
- `v_facture_rapprochement` : le 3-way par ligne, les deux écarts (quantité, prix) et la valeur provisoire.
- **Invariants en base** : une ligne ne facture qu'une pesée **validée**, du **fournisseur** et de la **devise**
  de la facture ; validée, la facture et ses lignes sont **figées** ; et la **double facturation** se refuse sec
  (`FACTURE-DOUBLE`) — c'est le seul écart qu'on ne peut pas se contenter de signaler.
- **Une référence se facture d'un bloc** (`FACTURE-BLOC`) : une facture peut ne couvrir qu'une partie des
  références d'un arrivage — le reste suivra —, mais pas une partie des kilos d'une référence, car la valeur
  provisoire et les lots se tiennent par référence.
- **L'arrivage ne se clôture que quand tout est facturé**, par cette facture ou par une autre déjà validée.
- Les écrans : la liste (ce qui attend sa facture en tête de description) et le document — on coche les pesées
  à facturer, les kilos et le prix proposés sont ceux du quai et du bon, le rapprochement se lit en face, puis
  **Aperçu** avant **Valider**. `GET /api/factures-fournisseur/a-facturer` est à la facture ce que
  « lignes attendues » est à la réception : on ne saisit pas en cherchant dans un catalogue.
- Les retours fournisseur (règle 3) et le contrôle du taux (jamais 1 en devise, écart > 3 % à confirmer) sont
  ceux de l'existant, repris tels quels.
- **L'ancienne saisie reste** : c'est le même moteur, et la couper d'un coup ferait tomber la valorisation qui
  marche aujourd'hui. Elle garde sa répartition au prorata, elle, puisqu'elle n'a pas de lignes.

Preuve : `scenario_facture_document` — rapprochement lu avant écriture, double facturation refusée, aperçu qui
n'écrit rien, écart exact (`+400` sur la référence facturée plus cher, **zéro** sur celle au prix du bon),
arrivage clôturé, facture figée, `FACTURE-BLOC` sur une référence coupée en deux, et montants masqués au
magasinier.

---

## À trancher au fil des phases (pas des bloquants pour commencer)

- L'écran **bon de commande** doit accepter un BC **import** : devise, incoterm, et le **taux** proposé à la
  validation (déjà amorcé, cf. « Change au paiement » du 09/10).
- **Migration des réceptions import existantes** vers le modèle BC → GR (reprise des dossiers en cours).
- Le **change** à chaque étape (BC → GR → IR → Landed Cost) : quel taux fait foi à quel moment (règles déjà posées
  le 09/10 : CMUP jamais touché au paiement, coût de revient réel par dossier).
- La **DUM / douane** comme pièces rattachées, et leur place dans le Landed Cost.

## Références

- ADR-002 (règles de gestion 08/10) : CMUP 2 temps, inventaire, import, droits.
- SAP MM : *Goods Receipt (MIGO)*, *Invoice Receipt (MIRO)*, *delivery costs / planned conditions*.
- Oracle : *Receiving*, *Landed Cost Management*.
