# À décider — la fiche de production, vérité de la consommation

> **ABANDONNÉ le 22/10/2026** : remplacé par `docs/A-DECIDER-of-supply-chain.md`. La fiche de
> production ne porte pas la consommation ; la matière est révélée par ses mouvements et ses constats datés.

Proposition du 22/10/2026. **Rien n'est codé** : ce document attend la décision de l'utilisateur.

## Le constat

- **L'ordre de fabrication** est un plan : il dit ce qu'on veut produire (qualité, m²) et ce
  que la recette devrait consommer. Il ne prouve rien de ce qui s'est passé.
- **La machine, aujourd'hui, n'est pas une mesure.** Son état est un comptage en *pourcentage du
  poids nominal* (bobines × poids × %) : les 21 états de la base de saisie sont tous en
  `ESTIMATION`. La consommation qu'on en déduit (avant + chargé − retiré − après) est donc, elle
  aussi, une estimation.
- **Ce qui est réellement mesuré**, ce sont les kilos qui sortent du magasin vers la machine (pesés),
  ceux qui en reviennent (pesés), et les m² que l'atelier a tissés.

## Le principe proposé

> **Le réel fait foi ; la machine est le point où le prévu et le réel se rejoignent.**

| Objet | Rôle | Fait foi pour |
|---|---|---|
| **Ordre de fabrication** | informatif : qualité, m² prévus, prévu figé (recette × m²) | rien : il annonce |
| **Fiche de production** (nouvelle) | réelle : date, machine, équipe, qualité, **m² réellement tissés**, matières hors machine réellement consommées | la production, et la consommation des matières hors machine |
| **Machine** | le stock tampon entre le magasin et la production | le fil chargé et le fil rendu, **pesés** |
| **Clôture de la qualité sur la machine** (déchargement) | pesée de ce qui reste, rendu au magasin | la consommation **réelle** du fil |

### Le fil : provisoire pendant la production, réel à la clôture

1. **Chargement** (fiche machine, inchangée) : le fil pesé quitte le magasin pour la machine.
2. **Pendant la production**, chaque fiche de production déclare les m² tissés. La consommation de
   fil est alors **provisoire** : recette × m² déclarés. Elle sert à valoriser l'en-cours et le
   stock restant sur la machine, jamais à faire foi.
3. **À la clôture** (la qualité quitte la machine, ou fin d'ordre) : le reste est déchargé et
   **pesé**. La consommation **réelle** = fil chargé − fil rendu. L'**écart** = réel − provisoire
   (recette × m² réels) est posé une seule fois, classé par motif (perte, casse, erreur…), et
   signalé par un contrôle, jamais bloquant.

C'est le principe de SAP pour le stock au pied de la machine : une sortie provisoire déduite de la
production déclarée, puis un recalage sur le réel au comptage. La différence voulue : le recalage
se fait sur une **pesée**, à un moment précis (la clôture), et non sur un pourcentage.

### Les matières hors machine (latex, colle, bande, frange, jute, plastique)

Elles se saisissent **sur la fiche de production**, telles que mesurées (pesée de cuve, rouleaux
comptés ou pesés) : chaque ligne produit une sortie réelle (consommation directe) au CMUP. Pas
d'estimation. Si l'atelier ne les mesure que par jour et par machine, elles se répartissent entre
les qualités de la fiche au prorata des m² réellement tissés.

### Deux qualités côte à côte sur une machine

La machine se découpe en **portions de largeur**, chacune avec sa qualité et son ordre : « 0 à
1,2 m : qualité X ». Le fil d'une portion suit la règle de largeur (1 344 bobines pour 4,2 m →
320 par mètre → 384 bobines pour 1,2 m), si la jauge de la machine est fixe. Les m² se déclarent
par qualité ; le fil réel se répartit entre les portions par cette même règle à la clôture.

## Ce que l'on obtient, sur du réel

- **m² produits** par jour, machine, qualité, ordre.
- **Consommation réelle** : fil (chargé − rendu, pesés), matières hors machine (saisies mesurées).
- **Coût réel** = consommations réelles × CMUP ; **coût au m²** = coût réel / m² réels.
- **Écart à la recette** par qualité et par ordre, signalé.
- **Avancement de l'ordre** : m² réels / m² prévus — un ordre peut finir à 80 % ou à 110 %.

## Ce qui change dans l'existant

- **La fiche machine** garde le chargement et le déchargement (pesés). Le **pourcentage restant**
  devient une **information** (aide au réapprovisionnement de la machine), plus une mesure de
  consommation.
- **Les décisions machine** (validées le 05/10) restent immuables ; le déchargement de clôture est
  une décision de plus, qui porte l'écart réel.
- **La consommation directe** (21/10) devient une ligne de la fiche de production ; la saisie seule
  reste possible pour une sortie ponctuelle.
- **Les données existantes** : les états en `ESTIMATION` restent tels quels ; la première clôture
  de chaque machine les recale sur une pesée.

## À trancher par l'utilisateur

1. **Fréquence de la fiche de production** : par équipe, par jour, ou par ordre ?
2. **Moment de la clôture du fil** : à chaque changement de qualité sur la machine, à la fin de
   l'ordre, ou à un inventaire de machine périodique (hebdomadaire, mensuel) ?
3. **Mesure des matières hors machine** : pesée de cuve, rouleaux comptés ou pesés — par ordre ou
   par jour ?
4. **Pesée du retour** : toujours pesé (recommandé), ou compté en bobines × poids quand la balance
   manque ?
5. **Jauge** : la règle des 320 bobines par mètre vaut-elle pour toutes les qualités d'une
   machine, ou certaines qualités n'utilisent-elles qu'une partie des étages ?
6. **Ordre de fabrication obligatoire** sur la fiche de production, ou facultatif au début ?

## Ordre de réalisation proposé (après décision)

1. Fiche de production : m² réels et matières hors machine (sorties réelles).
2. Ordre de fabrication informatif et son prévu figé ; rattachement des fiches.
3. Portions de largeur des machines ; clôture du fil par pesée et écart réel.
4. Coût réel, coût au m², écarts à la recette ; contrôles de signal.
