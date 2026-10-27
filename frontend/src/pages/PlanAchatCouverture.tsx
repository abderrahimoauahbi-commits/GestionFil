/**
 * L'ONGLET « À COMMANDER » DU PLAN D'ACHAT (étape 2 du plan du 26/10/2026).
 *
 * Depuis le 27/10/2026, la liste et la grande fenêtre de détail sont des
 * composants PARTAGÉS (`composants/couverture/`) : le même tableau sert le
 * volet « Surveillance / Alertes » du stock projeté, la même fenêtre s'y ouvre
 * (enrichie). Ce module garde les noms d'avant pour le plan d'achat :
 * `ACommander` (la liste, avec « Commander ») et `DetailReference` (le détail,
 * encore déplié sous une proposition de l'onglet Besoins).
 */
export { ListeCouverture as ACommander } from '../composants/couverture/ListeCouverture'
export { DetailReference } from '../composants/couverture/DetailCouverture'
