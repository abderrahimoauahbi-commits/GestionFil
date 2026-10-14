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
- **D2 — Le GR part toujours d'un bon de commande.** L'import passe **aussi** par un **bon de commande** (un PO
  d'import, en **devise**). Plus de réception « hors commande » comme circuit principal. Le dossier d'import
  (DUM, conteneurs) se **rattache au BC**, il ne le remplace pas.
- **D3 — Une facture peut couvrir plusieurs réceptions.** L'IR (facture fournisseur) se rapproche de **plusieurs
  réceptions et plusieurs lignes** d'un même fournisseur, comme en SAP.

---

## Le modèle cible : trois étapes, le CMUP bouge à chacune

### 1. GR — Goods Receipt (la réception, fusionnée)
- Source unique : un **bon de commande** (local MAD, ou import en devise).
- Le magasinier fait **le même geste partout** : peser, compter les colis, relever lots / palettes / bobines.
- **Ligne simple** : `Réf · Qté commandée · Reste BL · Pesé · Nb palettes · Nb bobines`. L'**attendu** (palettes /
  bobines théoriques) et l'**écart** se lisent en **tooltip**, pas dans la ligne. Le **lot** se génère
  (`FOURNISSEUR-JJMMAA-NN`) ou se saisit.
- Stock entré à **valeur provisoire** = prix du BC (MAD) ou prix du BC × **taux** (devise). *(C'est le CMUP
  provisoire déjà posé à la validation, règle « CMUP 2 temps ».)*
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
- **Change** : fusion des deux écrans de réception ; l'**import démarre d'un BC** en devise ; une **facture couvre
  plusieurs réceptions**.
- **Supprime** : la séparation `/receptions-import` comme **circuit distinct** (l'écran disparaît au profit de la
  réception unique ; les objets import — dossier, DUM, conteneurs — se rattachent au BC).

---

## Plan d'exécution (l'app reste debout à chaque phase)

| Phase | Contenu | Touche |
|---|---|---|
| **A — Fusion GR** | Un seul écran de réception, source = BC (local ou import, devise affichée) ; lignes simples + tooltips (attendu/écart/lot) ; stock provisoire ; rattachement dossier/DUM | écran réception + `domain/reception.rs` + (migration : dossier rattaché au BC) |
| **B — IR unifié** | Une saisie de facture locale/import ; **rapprochement 3-way** multi-réception ; écart de prix → **CMUP** ; devise figée au taux facture | `domain/` valorisation + écran facture + migration |
| **C — Landed Cost unifié** | Frais d'approche pour local **et** import ; répartition (poids/valeur/manuel) ; **CMUP final** | `domain/` coût de revient + écran frais + migration |

Chaque phase : **migration datée et rejouable** (`db/pg/migrations/`, `OWNER TO gestionfil`), cascade dans
`domain/`, écran, puis **preuve** (banc `backend/tests/banc` + capture Edge e2e). On ne passe à la phase suivante
que quand la précédente est **verte** et que le **CMUP ne régresse pas** (C11, matrice des mouvements).

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
