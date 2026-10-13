---
name: react-state-architecture
description: Architecture de l'état de l'interface React de Gestion Fil — données du serveur par TanStack Query, état global du client par Zustand, état de saisie local, TypeScript strict. À charger avant de créer un écran, un hook, un store, un contexte React, ou de déplacer de l'état entre composants.
---

# Architecture de l'état React — Gestion Fil

## Les trois sortes d'état, et où chacune vit

| État | Exemple | Où | Jamais |
|---|---|---|---|
| **Données du serveur** | stock, inventaires, bons, fiches machine, plan d'achat, droits | **TanStack Query** (`useQuery` / `useMutation`) | copiées dans un store ou un `useState` |
| **État global du client** | session et préférences d'affichage, filtres partagés entre écrans, onglets ouverts, brouillon d'un document multi-écrans | **Zustand** (un store par domaine, `src/stores/`) | `useState` remonté de parent en parent, nouveau `createContext` |
| **État local d'un écran** | ligne en cours de saisie, dialogue ouvert, onglet choisi | `useState` / `useReducer` dans le composant | promu en global « au cas où » |

### Pourquoi les données du serveur ne vont PAS dans Zustand
Le stock, un inventaire, un bon de commande appartiennent à la **base** : le serveur les
calcule, les masque selon les droits, les invalide. TanStack Query en est le cache unique
(clés `['machine-fiches', code, etage]`…, invalidation après mutation). Les recopier dans un store
Zustand crée une seconde vérité qui ment dès qu'un autre poste écrit. Règle : **un store Zustand
ne contient jamais une liste reçue de l'API.** Il peut contenir des identifiants, des filtres,
des choix de l'utilisateur.

## Zustand : règles
1. Zustand n'est pas encore une dépendance : l'ajouter (`npm i zustand`) au premier store réel,
   pas avant.
2. Un fichier par domaine, `src/stores/<domaine>.ts`, exportant un hook `use<Domaine>Store`.
   État et actions typés dans une interface ; pas de `any`.
3. Lire par **sélecteur** (`useApparenceStore((s) => s.taille)`), jamais l'objet entier :
   sinon chaque changement re-rend tout l'écran.
4. Persistance (`persist`) seulement pour des préférences de poste, dans `localStorage`, avec
   un nom de clé préfixé `gestionfil.` et une `version`. **Jamais** le jeton : il reste en
   `sessionStorage` (`api/client.ts`) et disparaît à la fermeture.
5. Pas de logique métier dans un store (calculs de stock, de CMUP, de droits) : elle est au
   serveur. Un store range des choix ; il ne décide pas.
6. Atelier à onglets : chaque onglet reste monté ; un état propre à un onglet se clé par son
   chemin (`lib/navigation.ts`, `useParamVue`), pas un singleton global.

## Contextes existants
`AuthContext` (session), `Theme` / `Apparence` (préférences d'affichage), `atelier/etat`
(onglets) sont des contextes React. Ils marchent : **ne pas les migrer en bloc**. Un nouvel état
global se crée en Zustand ; un contexte existant passe à Zustand quand on le retravaille, avec
capture d'écran avant / après.

## État local : ce qui reste permis
- La saisie en cours d'un document (lignes d'un bon, d'une fiche) vit dans l'écran ou dans
  son hook (`useFiche`), jusqu'à l'enregistrement, qui passe par une mutation.
- Un `useEffect` qui copie une donnée de requête dans un `useState` est suspect : dériver
  plutôt (`useMemo`), ou amorcer une seule fois avec une clé explicite.

## TypeScript strict
- `strict: true` est en place (`frontend/tsconfig.json`) : ne pas l'affaiblir, pas de
  `// @ts-ignore`, pas de `any` (utiliser `unknown` puis affiner).
- Les réponses de l'API ont une interface (`noyau.ts`, à côté de l'écran qui les consomme) ;
  les champs que le serveur peut masquer sont optionnels.
- `npm run lint` (eslint + `tsc --noEmit`) sans erreur avant de livrer ; les avertissements
  `react-hooks` ne s'ajoutent pas.
