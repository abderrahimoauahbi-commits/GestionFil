# Déploiement — ERP Gestion Fil

Serveur : **192.168.1.140**, Ubuntu 26.04 LTS, PostgreSQL 18.6.

---

## Ce qui tourne où

```
                    ┌─────────────────────────────────────────┐
   Postes du        │  192.168.1.140                          │
   réseau           │                                         │
   ─────────        │   ┌───────────────┐   127.0.0.1:5432    │
   navigateur ──────┼──▶│  gestionfil   │◀──────┐             │
   application ─────┼──▶│  :8080        │       │             │
   bureau           │   │  API + web    │  ┌────┴─────────┐   │
   mobile      ─────┼──▶└───────────────┘  │ PostgreSQL 18│   │
                    │                      │  gestionfil  │   │
                    │                      └──────────────┘   │
                    └─────────────────────────────────────────┘
```

**Un seul port est exposé : 8080.** PostgreSQL n'écoute que sur la boucle
locale — il n'est joignable que par le service, sur la même machine. C'est ce
qui fait qu'une faille du réseau ne donne pas directement accès aux prix
d'achat, à la valorisation et aux empreintes de mots de passe.

Le même processus sert **l'API et l'interface web**. Les deux sont donc sur la
même origine : pas de CORS, pas de proxy, rien à installer sur les postes qui
se contentent d'un navigateur.

---

## Première installation

### 1. PostgreSQL 18

```bash
sudo bash 01-postgresql-18.sh
```

Ubuntu ne propose que la 16 : les versions majeures ne remontent jamais dans une
LTS. Le script ajoute le dépôt officiel PGDG et, s'il trouve un cluster
existant, le **migre** avec `pg_upgradecluster` — l'ancien est conservé, arrêté.
C'est vous qui le supprimerez, après vérification.

### 2. La machine

```bash
sudo bash 02-installer-serveur.sh
```

Crée le compte de service `gestionfil` (sans shell, sans possibilité d'ouvrir
une session), l'arborescence `/opt/gestionfil`, le service systemd, la minuterie
de sauvegarde quotidienne et les règles de pare-feu.

Puis **compléter `/opt/gestionfil/.env`** — il est écrit en modèle, avec deux
valeurs à remplacer :

```bash
sudo -e /opt/gestionfil/.env
```

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | le mot de passe du rôle `gestionfil` |
| `JWT_SECRET` | `openssl rand -base64 48` |

> Le fichier est en `0600`, lisible par le seul compte du service. Il porte deux
> secrets : quiconque le lit peut se connecter à la base **et** forger un jeton
> d'administrateur.

### 3. La base

Depuis le poste de développement :

```bash
python deployer_production.py
```

Charge le schéma (53 tables, 73 vues, 76 déclencheurs), le référentiel réel
(124 références, 12 fournisseurs, 18 qualités, 301 lignes de recette) et les six
comptes nominatifs.

### 4. Les mots de passe

Les six comptes portent `!A_DEFINIR!`, qui n'est pas une empreinte Argon2
valide : **aucune connexion n'est possible** tant qu'un mot de passe réel n'a pas
été posé. Le serveur le signale au démarrage.

```bash
cd /opt/gestionfil
GESTIONFIL_MOT_DE_PASSE="au moins douze caracteres" \
  sudo -u gestionfil ./gestionfil-admin definir-mot-de-passe admin
```

À répéter pour `Medmazari`, `Choukri`, `Tarik`, `Assistante`, `Magasinie`.

> Aucun mot de passe n'est écrit dans un fichier versionné. Il y resterait dans
> l'historique Git même après correction, et un dépôt se copie.

### 5. Publier la première version

Voir ci-dessous.

---

## Publier une version

Sur le poste de développement :

```powershell
.\deploiement\fabriquer-paquet.ps1        # produit gestionfil-AAAAMMJJ.tar.gz
```

Sur le serveur :

```bash
sudo bash 03-publier.sh gestionfil-AAAAMMJJ.tar.gz
```

Le script met la version en place de côté **avant** de la remplacer, arrête le
service, installe, redémarre, puis **vérifie que `/api/sante` répond**. Un
service qui écoute mais ne répond pas est en panne, simplement moins visible.

En cas de problème :

```bash
sudo bash 04-revenir.sh
```

> **Le retour ne touche pas à la base.** Si la version annulée avait modifié le
> schéma, revenir au binaire précédent ne suffit pas — il faut aussi restaurer la
> base, ce qui perd les écritures faites depuis. Le script le rappelle à chaque
> exécution.

---

## Sauvegardes

**Automatique** : tous les jours à 02 h 30, par `gestionfil-sauvegarde.timer`.
Si la machine était éteinte, la sauvegarde part au démarrage suivant plutôt que
d'être sautée.

```bash
systemctl list-timers gestionfil-sauvegarde   # prochaine exécution
journalctl -u gestionfil-sauvegarde -n 20     # ce qui s'est passé
```

**Manuelle** :

```bash
sudo -u gestionfil /opt/gestionfil/gestionfil-admin sauvegarder
sudo -u gestionfil /opt/gestionfil/gestionfil-admin lister-sauvegardes
```

Les fichiers vont dans `/opt/gestionfil/sauvegardes`, en `0700` : chacun
contient **toute la base**.

### Restaurer

```bash
sudo systemctl stop gestionfil
sudo -u gestionfil /opt/gestionfil/gestionfil-admin restaurer gestionfil-AAAAMMJJHHMMSS.dump
sudo systemctl start gestionfil
```

La base actuelle n'est pas détruite : elle est **renommée**
`gestionfil_remplacee_<horodatage>`. Si la restauration déçoit, elle est encore
là, entière.

> ⚠️ **Une sauvegarde qui reste sur la même machine ne protège que des erreurs
> humaines**, pas d'une panne de disque ni d'un vol. Copiez régulièrement
> `/opt/gestionfil/sauvegardes` vers un support externe.

---

## Exploitation courante

```bash
systemctl status gestionfil          # état
journalctl -u gestionfil -f          # journal en direct
journalctl -u gestionfil --since today | grep -i erreur
sudo systemctl restart gestionfil    # redémarrage
```

### Diagnostic

```bash
sudo -u gestionfil /opt/gestionfil/gestionfil-admin diagnostic
```

Vérifie la structure, la taille, les contraintes, et déroule les **32 contrôles
de cohérence métier**. Ne modifie rien.

### Maintenance

```bash
sudo -u gestionfil /opt/gestionfil/gestionfil-admin reparer
```

Réindexe, compacte, recalcule les statistiques. **Ne corrige aucune donnée** :
une anomalie métier se corrige dans l'application, par quelqu'un qui sait ce que
la ligne devrait porter.

---

## Ce que le service refuse de faire

Le service démarre en vérifiant la base et **s'arrête si elle ne convient pas** :

| Vérification | Seuil | Pourquoi |
|---|---|---|
| Tables | ≥ 40 | Une base incomplète servirait des écrans vides sans erreur |
| Vues | ≥ 60 | Le pilotage serait muet |
| Déclencheurs | ≥ 70 | **Les règles métier ne seraient plus appliquées** |

La troisième est la plus importante : sans les déclencheurs, le service
fonctionne parfaitement et n'applique plus aucune règle — stock négatif accepté,
écritures dans le grand livre, journal d'audit silencieux.

---

## Les clients

| Cible | État | Comment |
|---|---|---|
| **Web** | prêt | `http://192.168.1.140:8080` — rien à installer |
| **Windows** | à produire | `npm run tauri build` sur Windows |
| **macOS** | bloqué | exige un Mac avec Xcode |
| **Android** | à produire | `npm run tauri android build`, exige le SDK/NDK |
| **iOS** | bloqué | exige un Mac + compte Apple Developer (99 $/an) |

Les applications empaquetées demandent **l'adresse du serveur** au premier
lancement (`http://192.168.1.140:8080`), la retiennent, et ne la redemandent
plus. Un seul paquet peut donc viser n'importe quel serveur : pas de
recompilation quand l'adresse change.

---

## Sécurité — l'état des lieux

| | |
|---|---|
| PostgreSQL | boucle locale uniquement, jamais exposé |
| Rôle `gestionfil` | **aucun privilège** — ni superutilisateur, ni création de base, ni création de rôle |
| Compte de service | sans shell, sans session possible |
| `.env` | `0600`, deux secrets |
| Sauvegardes | `0700` |
| Service systemd | `ProtectSystem=strict`, `NoNewPrivileges`, deux chemins inscriptibles |
| Mots de passe | Argon2id, 12 caractères minimum |
| Droits par champ | appliqués **côté serveur**, en sortie et en entrée |

**Ce qui n'est pas fait, et qu'il faut savoir :** le trafic entre les postes et
le serveur est en **HTTP, non chiffré**. Sur un réseau d'usine fermé c'est un
risque mesuré ; dès qu'un accès depuis l'extérieur est envisagé, il faut un
reverse proxy TLS devant le service.
