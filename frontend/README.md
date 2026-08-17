# ERP Gestion Fil — interface

React 19 + TypeScript + Tailwind 4 + Radix UI. Un seul code source pour trois cibles : **web**, **bureau** (Windows / macOS / Linux via Tauri 2) et **mobile / tablette** (PWA installable).

---

## Démarrage

```powershell
npm install
npm run dev            # web        → http://localhost:5173
npm run bureau:dev     # bureau     → fenêtre native
npm run build          # bundle web + PWA
npm run bureau:build   # installeurs de bureau
npm run lint           # vérification des types
```

Le backend doit tourner sur `:8080` — le serveur de développement relaie `/api` vers lui.

---

## Design system

Pas de composants maison réinventés : **Radix UI** pour le comportement (focus, clavier, ARIA, portails), **Tailwind** pour l'apparence, **CVA** pour les variantes. Réimplémenter un dialogue ou un menu à la main produit presque toujours quelque chose d'inaccessible au clavier.

```
src/
├── lib/utils.ts            cn() et formatage français
├── composants/
│   ├── ui/base.tsx         bouton, champ, sélecteur, carte, badge, alerte, états
│   ├── ui/surcouches.tsx   dialogue, confirmation, menu, info-bulle, onglets, interrupteur
│   ├── DataTable.tsx       tri, pagination, choix des colonnes (TanStack Table)
│   ├── Coquille.tsx        barre latérale, fil d'Ariane, barre du bas mobile
│   ├── PaletteCommandes.tsx  Ctrl/Cmd + K
│   └── Theme.tsx           clair / sombre / système
├── components/             façades de compatibilité vers les modules ci-dessus
├── pages/                  écrans
└── hooks/useCrud.ts        mutations CRUD et invalidation du cache
```

### Thème

Les couleurs sont des **jetons HSL** redéfinis par `.sombre`, jamais des classes figées dans les composants. Un badge dit `ton="danger"`, pas `ton="rouge"` : nommer une teinte la fige, nommer une intention laisse le thème décider.

Le thème est appliqué **avant le premier rendu** par un script inline dans `index.html` — sans quoi un utilisateur en mode sombre voit un éclair blanc à chaque chargement.

---

## Adaptation aux écrans

| Largeur | Navigation | Tableaux |
|---|---|---|
| ≥ 1280 px | barre latérale, repliable en rail | toutes colonnes |
| 1024–1279 px | barre latérale | colonnes `secondaire` masquées |
| 768–1023 px | tiroir à la demande | colonnes `secondaire` masquées |
| < 768 px | barre d'onglets en bas | **cartes empilées** |

Cibles tactiles de 44 px minimum sur pointeur grossier — saisie au magasin, souvent avec des gants. Zones sûres des écrans à encoche respectées (`env(safe-area-inset-*)`).

---

## Droits par champ

L'interface lit la grille via `/api/auth/moi` et se construit dynamiquement :

| Niveau | Tableau | Formulaire |
|---|---|---|
| `MASQUE` | colonne non montée | champ non rendu |
| `LECTURE` | colonne visible | champ grisé **et exclu de l'envoi** |
| `ECRITURE` | colonne visible | champ saisissable |

Exclure les champs en lecture de la charge utile n'est pas un détail : le serveur les refuserait, et la requête entière échouerait pour un champ que l'utilisateur n'a même pas touché.

**L'interface ne protège rien** — le serveur applique la même grille en sortie comme en entrée. Elle évite seulement de faire saisir ce qui sera refusé.

---

## Application de bureau

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json      fenêtre, CSP, cibles d'empaquetage
├── build.rs
├── capabilities/        permissions Tauri
├── icons/               généré par `tauri icon`
└── src/lib.rs           commandes natives
```

L'enveloppe **n'embarque ni base ni logique métier** : elle reste un client du serveur. Une seule source de vérité dans l'usine, donc aucun conflit de synchronisation possible sur le stock ou le CMUP (ADR-001 D-03 : mode toujours connecté).

L'adresse du serveur est lue de `GESTIONFIL_API` à l'exécution — sur un poste d'atelier, elle pointe vers le serveur de l'usine, pas vers `localhost`.

Cibles d'empaquetage : `nsis`, `msi` (Windows) · `dmg` (macOS) · `deb`, `rpm`, `appimage` (Linux).

**Prérequis de compilation** : Windows a besoin des *Build Tools* Visual Studio et de WebView2 ; Linux de `libwebkit2gtk-4.1-dev` et `libgtk-3-dev` ; macOS des *Command Line Tools*.

---

## Version mobile

PWA installable via `vite-plugin-pwa` : manifeste, service worker, icônes maskable, raccourcis vers Cockpit / Mouvements / Réceptions.

**L'API n'est jamais mise en cache.** Afficher un stock périmé serait pire que de ne rien afficher : sur un ERP matière, une valeur fausse conduit à une décision fausse. Seuls les fichiers de l'application sont précachés.

Le service worker est désactivé dans l'enveloppe Tauri : les fichiers y sont déjà servis depuis le disque.

---

## Découpage du bundle

```
react       ~50 kB   React, React DOM, Router
donnees     ~94 kB   TanStack Query et Table
interface  ~102 kB   Lucide, cmdk, sonner
index      ~363 kB   code applicatif
```

Séparer les dépendances stables du code métier évite de faire retélécharger React et Radix à chaque correction fonctionnelle.
