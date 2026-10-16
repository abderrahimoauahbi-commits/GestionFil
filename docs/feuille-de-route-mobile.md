# Feuille de route — l'ERP sur mobile

**Statut** : en cours · **Date** : 2026-10-14 · **Portée** : navigation par rôle, écrans tactiles, PWA installable · **Commence par** : le magasinier

Testé sur téléphone, l'ERP s'affichait mal : écrans de bureau rétrécis, menu surchargé, tableaux
illisibles. Ce document fixe **comment on fait du bon mobile sans perdre la lisibilité des données**,
en suivant les références des leaders (Apple **HIG**, Google **Material 3**, **Nielsen Norman Group**,
Luke Wroblewski *Mobile First*), et **dans la direction visuelle déjà validée** du projet (verre
transparent, gris + or ancien, pas de magenta, documents sur écran propre jamais en popup).

Principe de tête, hérité de tout le reste du projet : **le mobile n'est pas un petit bureau, c'est un
autre métier.** On ne cherche pas à montrer tout l'ERP sur un téléphone ; on sert des **tâches
ciblées**, par rôle. Les vrais utilisateurs mobiles sont le **magasinier** (le quai) et la
**Direction** (consultation). On commence par le magasinier.

---

## 1. Décisions d'outillage (14/10/2026)

Après inventaire des skills, MCP, plugins et agents recommandés, on retient le **plus petit ensemble
suffisant** — chaque MCP branché alourdit le contexte, donc on n'installe que l'utile.

| Rôle | Retenu | Raison |
|---|---|---|
| Direction visuelle | skill **`frontend-design`** | Déjà disponible ; évite le rendu « gabarit ». Appliqué **dans** nos jetons de thème, pas pour inventer un look. |
| Structure des écrans | skill **`react-state-architecture`** | Nos conventions React (TanStack Query, Zustand, état local). |
| App installable | skill **`tauri-security`** | Seulement quand on touche la PWA / Tauri (manifest, capabilities, CSP). |
| Vérification visuelle | **capture Edge headless** + **e2e Playwright** (harnais du projet, `frontend/e2e/lancer.py`) | On vérifie par capture avant toute affirmation ; viewport mobile ajouté. |
| Revue du code produit | MCP **`semgrep`** | Qualité / sécurité. |
| Agent sur mesure | **`.claude/agents/ui-mobile-erp`** (à créer) | Porte nos règles (français, cartes + maître→détail, pas de défilement horizontal, capture). |

**Écartés ici :** Figma MCP (pas de maquette Figma), shadcn MCP (on a nos primitives `composants/ui/`),
higgsfield (génère des médias, ne modifie pas l'app), agents communautaires « mobile-developer »
(ils visent React Native / Flutter — **pas** notre pile React web + Tauri — et pousseraient le mauvais
framework). **Optionnels** si besoin plus tard : Chrome DevTools MCP (audit Lighthouse mobile),
Context7 MCP (docs libs à jour).

---

## 2. Principes directeurs (et leur source)

1. **Navigation orientée tâche, par rôle.** L'utilisateur d'entreprise est *captif* : il n'a pas choisi
   l'outil. On lui montre ses gestes, pas l'organigramme. *(NN/g — complexité des applications métier.)*
2. **Barre du bas : 3 à 5 destinations**, en bas (à portée du pouce), **persistantes**, libellés d'**un
   mot**, **pas d'onglet « More »**, fond translucide. *(Apple HIG — Tab bars ; Material 3 — Bottom
   navigation.)*
3. **Aucune action essentielle ne doit dépendre du défilement horizontal.** Représentation par défaut :
   **carte / liste maître→détail**. Une **grille compacte** reste autorisée pour les tâches de
   **comparaison / contrôle / inventaire**, avec colonnes prioritaires et masquage du secondaire — la
   densité s'obtient par la **ligne `↳`**, jamais par le scroll. *(= notre règle du 10/10/2026, affinée
   le 14/10 ; NN/g — tables métier mobiles.)*
4. **Cibles tactiles ≥ 44 pt (Apple) / 48 dp (Material).** Clavier **numérique** pour les kg et montants.
5. **Divulgation progressive, Mobile First.** D'abord l'essentiel, le détail à un tap. *(Luke
   Wroblewski.)*
6. **Supporter les appareils anciens** (tablette de magasin, pas le dernier téléphone). *(NN/g, Team400.)*

---

## 3. La feuille de route, par phases

Chaque phase a un critère **« fait quand »** vérifiable (capture + e2e).

### Phase 0 — Socle mobile (invisible mais obligatoire)
- PWA **installable** propre : rétablir le bouton « Installer » (manifest valide, `display: standalone`,
  `theme-color`, icônes 192 et 512), **safe-area** (encoche), pas de défilement horizontal de page.
- Cibles tactiles ≥ 44 pt, zéro dépendance au survol (`:hover`).
- **Fait quand** : le téléphone propose « Installer l'application » ; capture à 390 px (iPhone) et 360 px
  (Android) sans débordement ni bouton hors écran.

### Phase 1 — Navigation par rôle ✅ (magasinier posé le 14/10/2026)
- Menu curé par rôle (`MENU_PAR_ROLE` dans `composants/Coquille.tsx`) : chaque rôle ne voit que ses
  écrans ; menu seulement (les droits serveur ne changent pas). Accueil et Guide restent ouverts à tous.
- Barre du bas = les 4 gestes du quai : **Réceptions, Mouvements, Machines, Inventaires**.
- **Reste à faire** : listes de la **Direction** puis de l'**Assistante** (ADMIN garde tout).
- **Fait quand** : connecté en magasinier, le menu et la barre du bas ne montrent que la liste validée.

### Phase 2 — Représentation des données : trois types d'écran
Le mobile est un autre métier : on ne transforme pas une table en cartes par réflexe, on choisit la
représentation selon la **tâche** (recadrage validé avec la revue croisée du 14/10/2026).

| Tâche | Représentation |
|---|---|
| **Exécution terrain** (recevoir, saisir un poids, charger un métier) | Carte / **formulaire** plein écran |
| **Consultation rapide** (mouvements du jour, chercher une réf) | **Liste compacte** (Réf · Lot · Qté · Statut) |
| **Contrôle / comparaison / inventaire** (écart ligne à ligne) | **Grille dense** : colonnes prioritaires, secondaires masquables, **jamais de scroll horizontal** |

**La ligne `↳` est une hiérarchie d'information, pas une simple ligne de plus :**
- **ligne principale** = ce qui est indispensable à l'**action** et à l'**identification** (réf, lot,
  quantité, écart) ;
- **`↳` extensions** = ce qui sert au **contrôle** mais pas à l'identification immédiate (emplacement,
  conditionnement, dernier comptage, statut).

```
Réf.  X123
Lot   125
Stock 1 240 kg
Écart  −20 kg
      ↳ Emplacement A
      ↳ Bobines 496
      ↳ Dernier comptage 12/10
      ↳ Statut : à contrôler
```

Pour chaque écran, sous 768 px, le détail s'ouvre en **fiche plein écran** (jamais popup), totaux en pied
collant, recherche/filtre en tête. Ordre de traitement :
1. **Réceptions** — peser et enregistrer ce qui arrive (geste le plus fréquent).
2. **Inventaire / comptage** — très « terrain », type grille dense.
3. **Mouvements** (entrées / sorties / transferts).
4. **Machines** — charger / décharger les métiers.
- **Fait quand** : chaque écran se lit et se saisit au pouce à 390 px, relu au serveur sans valeur
  faussée (ex. « 1 234,5 » vaut 1234,5), capture + e2e verts.

### Phase 3 — Saisie tactile
- Clavier numérique (kg, quantités), gros boutons, validation en ligne, **barre d'action collante
  au-dessus de la navigation** (variable `--barre-basse` déjà publiée par la coquille).
- **Fait quand** : une saisie complète (bon → validation) se fait sans zoom ni défilement horizontal.

### Phase 4 — Finition & preuve
- Accessibilité (labels, focus, contrastes), audit **Lighthouse** mobile, **e2e en viewport mobile**,
  **captures avant / après** archivées dans `rapport-e2e/`.
- **Fait quand** : rapport e2e sans écran planté, sans 5xx, sans valeur mal enregistrée.

---

## 4. Périmètre par rôle

- **MAGASIN** (en cours) : Réceptions, Réceptions import, Retours fournisseur, Mouvements, Transferts,
  Machines, Inventaires, État des stocks, Références (lecture), Assistant, Guide. *Montants masqués
  partout (quantités seules).*
- **DIRECTION** (à définir, ensuite) : tableaux de bord, indicateurs, finance en consultation.
- **ASSISTANTE** : à définir après la Direction.
- **ADMIN** : menu complet, non curé (super-utilisateur).

---

## 5. Règle de vérification

Rien n'est déclaré « fait » sur une affirmation visuelle sans **capture Edge** à l'appui, puis **e2e
Playwright** en viewport mobile. Les constats non bloquants (champ trop étroit, débordement, bouton hors
écran, HTML/axe) vont dans `frontend/rapport-e2e/constats.md` et `galerie.html`.

---

## Références

- Apple — *Human Interface Guidelines*, **Tab bars** : <https://developer.apple.com/design/human-interface-guidelines/tab-bars>
- Google — **Material Design 3**, navigation : <https://m3.material.io>
- **Nielsen Norman Group** (complexité des applications d'entreprise) : <https://www.nngroup.com>
- Luke Wroblewski — *Mobile First* (divulgation progressive).
- Patterns de tableaux responsives (cartes / maître-détail / colonnes prioritaires) — pratique du métier,
  à confronter à nos propres largeurs et utilisateurs.
