---
name: tauri-security
description: Règles de sécurité de l'application de bureau Tauri 2 de Gestion Fil (frontend/src-tauri) — commandes IPC, capabilities, CSP, mise à jour signée. À charger avant de toucher tauri.conf.json, capabilities/*.json, src-tauri/src/*.rs, ou tout appel à @tauri-apps/api depuis l'interface.
---

# Sécurité Tauri 2 — Gestion Fil

L'application de bureau est une **enveloppe** : elle n'embarque ni base, ni logique
métier, ni secret. Elle affiche l'interface React et parle au serveur Axum en HTTP(S).
Toute règle métier, tout droit et tout masquage restent **au serveur**. Une commande
Tauri n'est jamais un raccourci pour contourner l'API.

## État actuel (à préserver)

- Commandes IPC exposées (`src-tauri/src/lib.rs`, `generate_handler!`) : **deux seulement**,
  `adresse_serveur` et `version_application`. Aucune ne lit ni n'écrit de fichier, de base
  ou de processus.
- Greffons : `opener`, `updater`, `process`. Pas de `shell`, `fs`, `sql`, `http`, `store`.
- Capability unique `capabilities/default.json`, fenêtre `main`, permissions nommées une à une.
- Mise à jour : paquets **signés** (minisign), clé publique compilée dans `tauri.conf.json`,
  point de terminaison sur le serveur de l'usine (`https://192.168.1.140/api/maj/...`).

## Règles

### Commandes IPC
1. Ajouter une commande `#[tauri::command]` est une décision d'architecture : la justifier
   dans un commentaire (pourquoi l'API HTTP ne suffit pas).
2. Une commande ne reçoit jamais un chemin, une URL, une requête SQL ou une commande
   système venus de l'interface. Les paramètres sont des valeurs typées et bornées.
3. Une commande ne porte ni jeton ni mot de passe : l'authentification reste celle de l'API
   (JWT en `sessionStorage`, revalidé par le serveur à chaque requête).
4. Toute commande nouvelle est listée dans `generate_handler!` **et** n'est appelable que
   si une capability l'autorise ; ne jamais élargir `core:default` pour la faire passer.

### Capabilities (`capabilities/*.json`)
1. Permissions **nommées une à une** (`core:window:allow-minimize`…), jamais de joker
   (`core:window:default` complet, `fs:default`, `shell:allow-execute`…).
2. Une capability vise des fenêtres précises (`"windows": ["main"]`), pas `"*"`.
3. Interdits sans décision écrite : `shell:*`, `fs:*`, `sql:*`, `http:default` avec portée
   large, `process:allow-exit` sur une fenêtre de contenu distant.
4. Les webviews créées par `core:webview:allow-create-webview-window` n'affichent que
   l'interface embarquée, jamais une URL tierce.

### CSP (`app.security.csp`)
CSP actuelle :
`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' http: https:`
1. Pas de `script-src 'unsafe-eval'` ni `'unsafe-inline'` pour les scripts. Pas de script
   distant (CDN) : tout est empaqueté par Vite.
2. `connect-src http: https:` est large **parce que l'adresse du serveur se règle par poste**.
   Ne pas l'élargir davantage (pas de `ws:` ni `*` sans besoin). Si l'adresse devient fixe,
   la resserrer au serveur de l'usine.
3. `style-src 'unsafe-inline'` est toléré (Radix, styles calculés) ; ne pas l'étendre aux scripts.
4. Ne jamais mettre `"csp": null`.

### Mise à jour
1. Jamais de paquet non signé ; la clé privée ne vit pas dans le dépôt.
2. Le point de terminaison de mise à jour reste en HTTPS sur le serveur de l'usine.
3. `createUpdaterArtifacts: true` : publier le `.sig` avec le paquet (`deploiement/`).

### Interface
1. L'interface ne présume pas Tauri : passer par `lib/navigation.ts` (`useOuvrirVue`) et
   détecter l'enveloppe, la même base de code sert le web (PWA).
2. `withGlobalTauri` reste à `false` : importer `@tauri-apps/api` explicitement.
3. Ne rien stocker de sensible hors `sessionStorage` (le jeton disparaît à la fermeture).

## Avant de livrer une modification Tauri
- Relire le diff de `tauri.conf.json` et `capabilities/` ligne par ligne.
- `npm run bureau:dev` : la fenêtre s'ouvre, la console ne montre aucun refus CSP.
- Une permission ajoutée est expliquée dans le message de livraison.
