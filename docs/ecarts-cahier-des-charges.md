# Écarts au cahier des charges v3.0

Traçabilité entre le CDC du 07/08/2026 et l'implémentation. Toute divergence est listée ici : rien n'a été modifié en silence.

**Légende** — 🔴 bloquant (le système ne fonctionnait pas) · 🟠 défaut fonctionnel · 🟡 contradiction à arbitrer · 🔵 ajout

---

## 1. Défauts bloquants corrigés

| # | Réf. CDC | Défaut | Correction | Test |
|---|---|---|---|---|
| 🔴 1 | J1, J3 | **Le stock ne diminuait jamais.** Le seul trigger écrivant dans `stock_magasin` était gardé par `signe = 1 AND prix > 0`. Aucune sortie n'avait d'effet ; les transferts, insérés sans prix, n'affectaient aucun des deux côtés. | Solde et CMUP découplés. `trg_lmvt_appliquer` applique le delta signé pour tous les types. | `R02 …`, `R04 …` |
| 🔴 2 | H4, I4 | **`ligne_qualite` clefée sur la catégorie**, alors que E3 définit les densités par rôle. Dans SH, *Polyester* apparaît dans Poil (1,760) et Chaîne (0,235) : deux valeurs pour une même ligne. | Clé `(code_qualite, code_role)` + `unite_densite`. | MRP = 56,32 kg |
| 🔴 3 | E3, F2 | **Rôles en ml/m² non modélisables.** Aucun discriminant d'unité ; la formule à trois facteurs de E3 n'était appliquée nulle part. | `ligne_qualite.unite_densite ∈ {kg_m2, ml_m2}` + conversion dans `v_ligne_recette_calculee`. | CUIR-01 = 175 kg |
| 🔴 4 | H5, I4 | **Le MRP ne couvrait qu'une qualité par plan.** `id_recette_base` étant une FK unique, la jointure éliminait les lignes de toutes les autres qualités. | Table `plan_recette` (plan × qualité × version). | `R08 …` |
| 🔴 5 | J4 | **CMUP faux d'un facteur ≈ 9,5 sur les achats USD.** `prix_kg_reel` était utilisé comme MAD pour le CMUP et comme devise étrangère pour l'historique. | `prix_kg_devise`, `taux_change`, `prix_kg_mad` distincts, liés par `CHECK`. | `BL-5 …` |
| 🔴 6 | H5 | **`besoin_mrp` doublait à chaque recalcul** (index non unique, sommé par la vue). | `UNIQUE (id_plan, mois, code_reference)`. | `BL-6 …` |
| 🔴 7 | H6, B4 | **Règle SoD n°4 inapplicable** : `bon_commande` ne portait ni `id_utilisateur_validation` ni `date_validation`. | Colonnes ajoutées + `CHECK` d'exclusion mutuelle. | `B4-4 …` |
| 🔴 8 | H8, A3 | **Traçabilité lot irréalisable** : `stock_magasin` clefé sans lot. | Table `stock_lot` + `reference.suivi_lot`. | `Stock par lot …` |
| 🔴 9 | H4 | **Le script SQL ne se créait pas** : `ligne_recette.id_groupe_equiv UUID` référençait une colonne `VARCHAR(20)`. | Type aligné sur `TEXT`. | build |
| 🔴 10 | J6 | **Inventaire cassé** : `ligne_numero` codé en dur à 1 sous contrainte `UNIQUE` → échec au 2ᵉ écart ; `NEW.date_cloture` affecté dans un trigger `AFTER` → sans effet. | Cascade déplacée dans le service ; `CHECK` sur `date_cloture`. | — |

---

## 2. Défauts fonctionnels corrigés

| # | Réf. CDC | Défaut | Correction |
|---|---|---|---|
| 🟠 11 | I1 | Stock **dupliqué par magasin** (jointure non agrégée) → ruptures surcomptées, 3 propositions d'achat pour une même référence. `inclure_mrp` inutilisé. | `v_stock_disponible` agrège et filtre. |
| 🟠 12 | I1 | **En-cours fournisseur ignoré** : `stock_projete = stock − besoins`. Le système recommandait de recommander ce qui était déjà commandé. | `v_encours_bc` intégrée : `stock + en-cours − besoins`. |
| 🟠 13 | I1 vs F4 | La **correction N4 du 11/06/2026** (consommation réelle) n'était pas reportée : la vue utilisait `SUM(besoin_mrp)/12`, la prévision. | `v_conso_reelle` + `v_conso_retenue` avec `source_conso`. |
| 🟠 14 | I1 | `COALESCE(conso, 1)` : **fallback silencieux** à 1 kg/mois, contraire à B2/R01. | Repli explicite et tracé. |
| 🟠 15 | I2 | **Quantité à commander = 0 en silence** dès que `multiple_achat_kg` était NULL (`NULLIF` → NULL, et `GREATEST` ignore les NULL). | Arithmétique réécrite ; testé sur une référence sans MOQ ni multiple. |
| 🟠 16 | I2 | Le **tiering portait sur un montant différent** de celui affiché (sans arrondi ni MOQ). | Tiering calculé sur le montant réellement commandé. |
| 🟠 17 | I2 | `stock_min` réduit au seul champ catalogue ; la **formule F3 (max de 4 sécurités)** n'était implémentée nulle part. | `v_stock_min_dynamique`. |
| 🟠 18 | I6 | **Fan-out d'agrégat** : `SUM(montant_total_mad)` sur un double `LEFT JOIN` multipliait le montant de chaque BC par son nombre de lignes reçues. | Agrégats séparés par CTE. OTIF ajouté. |
| 🟠 19 | I7 | **Stock neuf classé dormant** : une référence reçue la veille et jamais sortie était dormante. | `COALESCE(date_derniere_sortie, date_derniere_entree)`. |
| 🟠 20 | J2 | **Trigger inutile** : il dupliquait le `CHECK` de colonne et ne traitait pas le vrai cas (refuser la sortie). | Garde métier avant écriture, par magasin et par lot. |
| 🟠 21 | J4 | **Magasin unique par réception** (`LIMIT 1` sans `ORDER BY`), alors que le magasin est par ligne. | Cascade dans le service : un mouvement par magasin destinataire. |
| 🟠 22 | H6, J4 | **Mélange d'unités** : `quantite_recue += quantite_stock_kg` sur une `ligne_bc` sans colonne d'unité. | Unité + facteur figés sur la ligne, quantités en kg. |
| 🟠 23 | G5 vs H8 | État `TERMINE` déclaré en G5, absent du `CHECK`. | État ajouté. |
| 🟠 24 | tous | **Transitions arrière non gardées** : `CLOTURE → VALIDE` rejouait la cascade et comptait le stock deux fois. | Table `transition_statut` + trigger par entité. |
| 🟠 25 | E7 | `AJUST_INV` déclaré « ±1 » sous `CHECK(signe IN (-1,0,1))` : instockable. | Scindé en `AJUST_INV_POS` / `AJUST_INV_NEG`. |
| 🟠 26 | J3, J4, J6 | Motifs `TRANSFERT`, `RECEPTION`, `INVENTAIRE` référencés par les triggers, **jamais définis** → FK en échec. | Ajoutés au seed. |
| 🟠 27 | J1 | **Lecture non verrouillée** puis écriture de la valeur calculée : *lost update* sous les 50 utilisateurs simultanés visés. | `UPDATE` arithmétique atomique. |

---

## 3. Règles déclarées, jamais implémentées

| Réf. | Règle | Mécanisme ajouté |
|---|---|---|
| R03 | Historique immuable | 12 triggers de refus `UPDATE`/`DELETE` |
| R07 | Σ % = 100 par rôle (« contrainte `CHECK` » — impossible sur un agrégat) | Contrôle au passage à `VALIDE` |
| A3, M4 | Journal d'audit (table créée, jamais alimentée) | 9 triggers d'audit |
| RG-04 | Recette immuable si `est_utilisee` (jamais mis à 1) | Verrou + marquage à la validation du plan |
| E1 | `P_DateSaisie` verrouillé | `parametre.verrouille` + trigger |
| E6 | Écart de pesée > 2 % → blocage | Dérogation nominative obligatoire |
| D1, D2 | Contrôle qualité et quarantaine | État `A_CONTROLER`, `magasin.est_quarantaine`, routage contraint |
| B4-1 | « Le magasinier ne voit pas les prix » | Table `champ_restreint` |
| G5 | « Vérifier stock source suffisant » | Garde avant écriture |
| E1 | `inclure_mrp` (jamais utilisé) | Exploité par `v_stock_disponible` |

---

## 4. Contradictions internes arbitrées

| Sujet | CDC | Retenu |
|---|---|---|
| 🟡 Seuil dormant | A4 : 180 j · E9 : 60 j | **180 j** (A4 fait foi) |
| 🟡 Taux de change | E8 : paramètres · J4 : table | **Table `taux_change`** ; paramètres supprimés |
| 🟡 Autorisation | H2 : table · L1 : Casbin | **Table** ; Casbin abandonné |
| 🟡 Frontend | l.13 : « 0 JavaScript » · L1 : React 19 | **React 19 + TS** |
| 🟡 Versionnement | qualité (SH1/SH2) vs recette (V1/V2) | **Recette** |
| 🟡 Saisonnalité | `m2_prevus` saisonnalisé ou non ? | **Oui**, `saisonnalite` reste informative |

---

## 5. Contradictions **non** résolues — décision métier requise

| # | Sujet | Détail |
|---|---|---|
| 1 | **Nombre de références** | A2/E2 annoncent 124, E9 en compte 300 (ABC : 16 + 25 + 259). Écart non explicable depuis le CDC. |
| 2 | **Objectifs A3 incompatibles** | « Rotation ≥ 12×/an » et « couverture ≥ 60 jours » s'excluent : 60 jours ⇒ rotation ≈ 6×/an. De plus, la rotation actuelle de 40,8× traduit un sous-stockage (9 jours), pas une performance. |
| 3 | **Seuils incohérents** | L'objectif « couverture ≥ 60 j » place l'entreprise en statut ATTENTION permanent, F4 exigeant ≥ 90 j pour le statut OK. |
| 4 | **KPI « économies »** | « 5 557 436 MAD/an sur 33 opportunités » est le chiffre le plus mis en avant du cockpit (zone 1) ; aucune formule n'en est donnée. Non implémenté. |
| 5 | **83 ruptures vs 57 C05** | Deux mesures du même phénomène. |
| 6 | **75 TIER 1 vs 83 ruptures** | F7 impose « toute rupture ⇒ TIER 1 », donc au moins 83. |
| 7 | **DSO / CCC sans source** | Pas de module ventes. DSO = 60 j est une constante non modélisée. |
| 8 | **Section M2 absente** | La table des matières annonce « Planning (26 semaines) » ; le corps passe de M1 à M3. |
| 9 | **Prix, MOQ, multiples** | Absents du CDC. Le jeu `900_demo_sh.sql` en invente pour la démonstration — à remplacer par l'extraction de `GESTION Fil.xlsx`. |
| 10 | **Densités des 17 autres qualités** | Seule SH est documentée (E3). À extraire par rôle. |

---

## 6. Ajouts au modèle

| 🔵 Objet | Motif |
|---|---|
| `transition_statut` | Machine à états déclarative |
| `plan_recette` | Correction du MRP mono-qualité |
| `stock_lot` | Traçabilité par lot promise en A3 |
| `champ_restreint` | Masquage des prix (B4-1) |
| `alerte` | A3 promet l'automatisation des alertes sans aucun support |
| `_contexte_session` | Identité de l'appelant pour l'audit |
| `permission.action = 'VALIDER'` | La SoD exige une permission distincte de l'écriture |
| `role_utilisateur.plafond_validation_bc_mad` | Seuils de validation B4-3 |
| `magasin.est_quarantaine` | Routage des non-conformes |
| `reference.facteur_kg`, `prix_catalogue_kg` | Conversion R01 rendue structurelle |
| `plan_achat.source_prix` | Repli de prix tracé (ADR-001 D-02) |
| Contrôles C15–C20 | Couverture des défauts structurels ci-dessus |

---

## 7. Non traité à ce stade

- **Réservation / allocation de stock** aux ordres de fabrication : le stock projeté ne distingue pas disponible et réservé.
- **Lien sortie ↔ OF ↔ plan** : `numero_of` reste un texte libre, donc le taux de perte réel (2 %) n'est pas mesurable.
- **Module ventes** (cf. §5-7).
- **Stockage documentaire** : `documents_attaches` et `photos` sont des colonnes JSON sans backend de fichiers.
- **Procédure de reprise Excel → ERP** : `est_initial` et `P_DateSaisie` existent, la procédure de go-live reste à écrire.
- **Multi-société** : la table `entreprise` existe, aucune table n'y fait référence.
