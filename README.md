# ERP Gestion Fil

**Polyfashions Carpet Morocco** — pilotage des achats, stocks et production de matières premières.

Remplace `GESTION Fil.xlsx` (26 feuilles) par un système transactionnel. 124 références, 12 fournisseurs, 18 qualités de tapis, 870 085 m²/an, 44,2 M MAD de budget achats.

---

## Démarrage quotidien

```powershell
.\demarrer.ps1
```

Compile le backend, le démarre sur `:8080`, attend qu'il réponde, puis lance l'interface sur `:5173`. Signale au passage un catalogue vide ou des comptes sans mot de passe. `Ctrl+C` arrête les deux.

> L'application a besoin de **deux serveurs**. Sans le backend, Vite répond
> `http proxy error: connect ECONNREFUSED 127.0.0.1:8080`.

## Première installation

```powershell
# 1. Base de données (sans -Demo : les données viennent du classeur Excel)
cd db
.\build.ps1

# 2. Backend
cd ..\backend
cargo run --bin gestionfil-admin -- init-config              # crée .env, secret aléatoire
cargo run --bin gestionfil-import                            # charge GESTION Fil.xlsx
cargo run --bin gestionfil-admin -- definir-mot-de-passe direction
cargo run                                                    # http://127.0.0.1:8080

# 3. Interface
cd ..\frontend
npm install
npm run dev                                                  # web    → :5173
npm run bureau:dev                                           # bureau → fenêtre native
```

### Les trois cibles

| Cible | Commande | Résultat |
|---|---|---|
| Web | `npm run build` | bundle + PWA installable |
| Bureau | `npm run bureau:build` | `.msi` `.exe` (Windows) · `.dmg` (macOS) · `.deb` `.rpm` `.AppImage` (Linux) |
| Mobile / tablette | — | PWA : « Ajouter à l'écran d'accueil » depuis le navigateur |

Un seul code source. L'enveloppe de bureau n'embarque ni base ni logique métier : elle reste un client du serveur, ce qui écarte tout conflit de synchronisation sur le stock et le CMUP.

Les autres comptes (`achat`, `planif`, `qualite`, `magasin`, `daf`) exigent chacun un mot de passe avant de pouvoir se connecter.

### Tests

```powershell
cd db;       .\tests\run-tests.ps1     # 39 invariants  (base de référence autonome)
cd ..\backend; cargo test              # 20 unitaires
             .\tests\e2e.ps1           # 40 bout en bout (base jetable + serveur)
cd ..\frontend; npm run build          # types + bundle
```

Les trois suites construisent leur propre base : aucune ne touche `db/gestionfil.db`.

---

## État

| Couche | État | Vérification |
|---|---|---|
| Base de données | **livrée** | 53 tables, 37 vues, 53 triggers · 39/39 |
| Import Excel | **livré** | 124 réfs · 18 qualités · 18 recettes validées · 93 groupes |
| Backend Rust/Axum | **livré** | auth, RBAC, droits par champ, CRUD complet · 21/21 + 55/55 |
| Interface React 19 | **livrée** | design system Radix, thème clair/sombre, adaptative |
| Bureau (Tauri 2) | **livré** | Windows · macOS · Linux |
| Mobile (PWA) | **livré** | installable, service worker, icônes maskable |
| Bout en bout | **40/40** | `backend/tests/e2e.ps1` |

**Total : 155 tests, 0 échec.**

### Ce qui reste

Écrans de saisie pour recettes, plans, transferts, inventaires, bons de commande et réceptions. Leurs API sont complètes et testées ; il manque l'interface.

## Droits par champ

Deux niveaux distincts, combinés :

| Niveau | Portée | Source |
|---|---|---|
| Accès module | LIRE / ÉCRIRE / VALIDER sur 17 modules | **rôle** (matrice CDC D2) |
| Visibilité champ | MASQUÉ / LECTURE / ÉCRITURE sur 208 champs | **utilisateur** |

Un champ **masqué** n'est pas envoyé par le serveur — il n'existe ni dans la réponse JSON, ni dans le DOM. Un champ en **lecture** est refusé à l'écriture **par le serveur**, pas seulement grisé à l'écran : griser un champ ne protège rien, n'importe qui peut envoyer la requête à la main.

Écran `/utilisateurs/{id}/droits` : matrice module × champ à trois états, avec réglage en masse et bouton « appliquer le modèle du rôle » (sans lui, chaque nouvel employé demanderait 208 réglages manuels).

---

## Organisation

```
db/          schéma, triggers, vues, contrôles, jeux de données, tests
backend/     Rust + Axum + sqlx
docs/        décisions d'architecture et écarts au cahier des charges
```

- [db/README.md](db/README.md) — invariants garantis, vues, contrôles, migration PostgreSQL
- [backend/README.md](backend/README.md) — API, principes, séquences types
- [docs/ADR-001](docs/ADR-001-decisions-fondatrices.md) — 12 décisions fondatrices
- [docs/écarts](docs/ecarts-cahier-des-charges.md) — traçabilité CDC → implémentation

---

## Principes

**Le kilogramme est l'unité canonique.** Palettes, bobines et mètres linéaires ne sont que des masques de saisie. Un facteur de conversion manquant fait échouer la saisie — jamais de repli silencieux sur ×1.

**Historique figé, projections glissantes.** Mouvements, réceptions et plans validés sont immuables. Besoins MRP, stock projeté et alertes sont recalculés à chaque consultation.

**Les paramètres sont embarqués par entité.** Chaque qualité, recette, plan et bon de commande copie les paramètres globaux à sa création. Modifier un seuil global n'altère aucun enregistrement existant : le passé reste reconstituable.

**Les invariants sont en base, les orchestrations dans le service.** Le stock ne peut pas devenir négatif, un mouvement passé ne peut pas être modifié, une recette dont les pourcentages ne somment pas à 100 % ne peut pas être validée — quel que soit le chemin d'appel, y compris une correction SQL passée à la main.

**Ségrégation des tâches.** Le magasinier ne voit aucun prix. L'acheteur ne valide pas ses propres réceptions. Le créateur d'un bon de commande ne peut pas le valider. La permission `VALIDER` est distincte d'`ÉCRIRE`.

---

## Vérification métier

Le jeu de démonstration reproduit l'exemple de calcul du cahier des charges (partie F2) :

```
Plan SH Juillet, 500 m²
  PP-3430 (Poil, 6,4 %)   500 × 1,760 × 6,4 %          =  56,32 kg  ✓
  JUT-961 (Trame, 100 %)  500 × 0,520 × 100 %          = 260,00 kg  ✓
  CUIR-01 (Cuir, ml/m²)   500 × 1,000 × 100 % × 0,35   = 175,00 kg
```

Et la cascade de réception, de bout en bout via l'API :

```
Réception REC-2026-0001 · 1500 bobines × 3,2 kg = 4800 kg à 3,20 USD/kg (taux 9,5)
  → stock MP-01     11 100 → 15 900 kg
  → CMUP            (11100 × 28,50 + 4800 × 30,40) / 15900 = 29,0736 MAD/kg
  → archive figée, historique de prix, lot LOT-HAS-2603
  → BC-2026-0001 soldé puis CLOTURE
```

---

## Points en attente d'une décision métier

Détaillés au [§5 du document d'écarts](docs/ecarts-cahier-des-charges.md).

1. **124 ou 300 références ?** Le cahier des charges se contredit (A2/E2 vs E9).
2. **Rotation ≥ 12×/an ou couverture ≥ 60 jours ?** Les deux objectifs s'excluent : 60 jours impliquent une rotation d'environ 6×/an.
3. **Définition du KPI « économies »** — 5 557 436 MAD/an est le chiffre le plus mis en avant du cockpit, sans formule nulle part.
4. **Densités par rôle des 17 qualités autres que SH** — à extraire de `GESTION Fil.xlsx`.
5. **Prix, MOQ et multiples d'achat réels** — absents du cahier des charges ; ceux du jeu de démonstration sont inventés et marqués comme tels.
