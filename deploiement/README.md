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

> **Une seule fois.** Ce script **supprime et recrée** la base. Il n'a de sens
> qu'avant le premier mot de passe posé et la première écriture. Ensuite, toute
> évolution du schéma passe par une migration (voir « Faire évoluer la base »).

### 4. Les mots de passe

Les six comptes portent `!A_DEFINIR!`, qui n'est pas une empreinte Argon2
valide : **aucune connexion n'est possible** tant qu'un mot de passe réel n'a pas
été posé. Le serveur le signale au démarrage.

> **Le minimum est de 8 caractères**, abaissé depuis 12 le 3 septembre 2026 à la
> demande de la direction. Ce que cela coûte, dit franchement : une empreinte
> volée se casse en quelques heures à 8 caractères, contre des années à 12. Ce
> qui rend le compromis tenable ici : la base n'est joignable que depuis le
> réseau local, PostgreSQL n'écoute que sur la boucle locale, et Argon2id rend
> une attaque par le formulaire de connexion trop lente pour aboutir. Pour les
> comptes de direction, qui voient les prix et valident les engagements, une
> phrase longue reste vivement conseillée.

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

## Faire évoluer la base

Depuis le 2 septembre 2026, la base de production **ne se recrée plus** : elle
porte un mot de passe administrateur et, bientôt, des écritures. Chaque
changement de schéma est un fichier daté dans `db/pg/migrations/`, écrit pour
être **rejouable sans effet** s'il a déjà été appliqué (`ADD COLUMN IF NOT
EXISTS`, `CREATE OR REPLACE VIEW`, upsert pour les données).

Sur le serveur, après avoir déposé le fichier dans
`/home/sysadmin/gestionfil/db/migrations/` :

```bash
cd /tmp && cat /home/sysadmin/gestionfil/db/migrations/2026-09-02_entreprise_identite.sql | sudo -u postgres psql -d gestionfil -v ON_ERROR_STOP=1
```

> **Pourquoi `cat … |` et non `psql -f`.** Le compte `postgres` ne lit pas le
> répertoire personnel de `sysadmin` (`drwxr-x---`) ; `-f` échoue en
> « Permission denied ». Le passage par l'entrée standard contourne cela sans
> ouvrir le répertoire.

L'ordre est toujours : **sauvegarde** (`gestionfil-admin sauvegarder`), puis
**migration**, puis **publication** du binaire qui attend le nouveau schéma. Un
binaire publié avant sa migration démarre puis échoue à la première requête
touchant la colonne absente.

Migrations appliquées :

| Date | Fichier | Objet |
|---|---|---|
| 2026-09-02 | `2026-09-02_entreprise_identite.sql` | `entreprise` : groupe, téléphone, fax, banques (puis `seed_120_entreprise.sql` rejoué) |
| 2026-09-02 | `2026-09-02_mouvement_document.sql` | `mouvement.responsable`, `ligne_mouvement.nb_bobines` / `nb_palettes`, et les 13 champs configurables du bon de mouvement |
| 2026-09-03 | `2026-09-03_telechargements.sql` | table `telechargement` (journal des paquets clients) et ses 9 champs configurables |

> **Le 3 septembre 2026, la base a été reconstruite depuis zéro** et le
> référentiel réimporté du classeur (voir « Reprise depuis le classeur »). Les
> deux migrations du 2 septembre sont donc déjà comprises dans le schéma ; elles
> restent listées parce qu'une base plus ancienne peut encore en avoir besoin.

---

## Reprise depuis le classeur

Le référentiel ne vient plus d'un fichier SQL figé mais de **`GESTION FIL.xlsx`**,
que l'entreprise tient à jour. `gestionfil-import` en lit cinq feuilles —
Catalogue, Fournisseurs, Qualités, Recettes, Stock — et **rien d'autre** : ni
mouvements, ni réceptions, ni commandes, ni plans. Une reprise d'historique
ferait entrer dans l'ERP les incohérences accumulées dans le tableur.

```bash
# 1. Base neuve : schéma, sécurité, comptes nominatifs, identité de l'entreprise
cd /home/sysadmin/gestionfil/db
PSQL=psql python3 charger.py --production --base gestionfil --hote 127.0.0.1     --utilisateur gestionfil --motdepasse '<mot de passe du rôle>'

# 2. Le référentiel, depuis le classeur — TOUJOURS en simulation d'abord
cd /opt/gestionfil && set -a && . ./.env && set +a
./gestionfil-import --simuler --fichier '/home/sysadmin/GESTION FIL.xlsx'
./gestionfil-import          --fichier '/home/sysadmin/GESTION FIL.xlsx'

# 3. Les mots de passe, qu'une base neuve remet à « à définir »
GESTIONFIL_MOT_DE_PASSE='...' ./gestionfil-admin definir-mot-de-passe admin
```

`--simuler` joue tout l'import puis annule la transaction : le rapport est
identique, la base intacte. Le rapport nomme chaque ligne rejetée.

> **Le classeur ne porte aucun stock.** Au 3 septembre 2026, ses 124 références
> ont toutes un stock initial à zéro, et ses feuilles Mouvements, Réceptions et
> Historique sont vides. L'import le signale au lieu de créer une photo de stock
> vide : les quantités réelles se saisiront dans l'application.

---

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

## L'assistant

L'écran **Assistant** est un chatbot. On y pose sa question dans ses mots ; un
modèle de langage choisit la **compétence** qui apporte le chiffre, et le serveur
l'exécute. Treize compétences aujourd'hui : recherche de référence, état du
stock, références en tension, équivalents, fournisseurs, commandes en cours,
plan d'achat, mouvements, valeur du stock, contrôles, composition d'une qualité,
et deux qui préparent un **brouillon** de mouvement ou de commande.

**Le modèle n'écrit jamais de SQL et n'enregistre rien.** Il choisit une
compétence et ses arguments ; la requête est écrite à l'avance, bornée, et son
résultat masqué selon la grille de droits de celui qui pose la question. Une
demande de saisie produit un brouillon que l'utilisateur relit et valide
lui-même : sans cela, le journal d'audit dirait « Mohamed a validé » alors que
personne n'a lu.

### Deux moteurs, réglables depuis l'application

Le choix du moteur est un **paramètre**, dans Paramètres → catégorie SYSTÈME :

| Paramètre | Valeurs |
|---|---|
| `P_AssistantMoteur` | `ollama` ou `claude` |
| `P_AssistantModele` | `qwen2.5:3b-instruct`, `qwen2.5:7b-instruct`, `claude-sonnet-4-5` |

Il est relu à chaque question : **aucun redémarrage du service**.

**La clé d'API reste dans `/opt/gestionfil/.env`, et elle y restera.** Une
sauvegarde de base s'exporte, se copie, se transporte ; un secret qui s'y trouve
part avec elle. La base porte donc *quel* moteur répond, jamais de quoi
s'authentifier auprès de lui.

```bash
sudo nano /opt/gestionfil/.env      # ANTHROPIC_API_KEY=sk-ant-...
sudo systemctl restart gestionfil
```

Les variables d'environnement restent acceptées et servent de valeur par défaut
quand le paramètre est absent :

```bash
ASSISTANT_MOTEUR=ollama
ASSISTANT_MODELE=qwen2.5:3b-instruct
OLLAMA_URL=http://127.0.0.1:11434
```

> **Le repli est signalé, pas subi.** Régler `claude` sans avoir posé la clé
> laisse le modèle local répondre — et l'écran de l'assistant l'affiche en clair.
> Sans ce signal, on cherche pendant une heure pourquoi les réponses restent
> lentes alors que le paramètre dit « claude ».

| Moteur | Confidentialité | Vitesse mesurée sur ce serveur |
|---|---|---|
| `ollama` | Rien ne sort de la machine | 10 à 90 s par réponse |
| `claude` | Question et chiffres partent chez Anthropic | 2 à 5 s |

Sans `ANTHROPIC_API_KEY`, demander `claude` retombe sur `ollama` plutôt que
d'échouer sur une erreur d'authentification illisible. Le changement de moteur
ne demande **pas** de redémarrage du service : le réglage est relu à chaque
question.

Ollama tourne en service systemd, avec le modèle gardé en mémoire
(`/etc/systemd/system/ollama.service.d/gestionfil.conf`). Le recharger coûtait
plusieurs secondes à la première question de la journée.

```bash
ollama list                       # les modèles installés
ollama pull qwen2.5:7b-instruct   # plus juste, environ trois fois plus lent
systemctl status ollama
```

> **Ce que le moteur local vaut, dit franchement.** Sur quatre cœurs sans carte
> graphique, le modèle 3B répond en 10 à 90 secondes et sa formulation est
> parfois maladroite. Il choisit la bonne compétence et le chiffre qu'il donne
> est exact — c'est le serveur qui le calcule — mais la phrase autour se lit
> moins bien qu'avec Claude. Le modèle 7B écrit mieux et met trois fois plus de
> temps.

---

## Distribuer les clients

Les installateurs vivent dans `/opt/gestionfil/telechargements`, servis par
l'écran « Télécharger l'application ». Le **nom du fichier est le catalogue** :

```
gestionfil-<plateforme>-<version>.<extension>
gestionfil-windows-0.1.0.exe
```

Déposer le fichier suffit à le publier ; rien n'est à déclarer en base. Le
service ne peut pas écrire dans ce dossier, et c'est délibéré : une application
qui peut réécrire les binaires qu'elle distribue est une application dont une
faille suffit à contaminer tous les postes. Un paquet se dépose donc par SSH.

Chaque téléchargement est inscrit dans la table `telechargement` — qui, quelle
version, quand. C'est la réponse à la seule question qu'on se pose après coup :
« sur quelle version tourne ce poste ».

```bash
scp gestionfil-windows-0.2.0.exe sysadmin@192.168.1.140:/home/sysadmin/paquets/
ssh sysadmin@192.168.1.140   'sudo install -o gestionfil -g gestionfil -m 0644      /home/sysadmin/paquets/gestionfil-windows-0.2.0.exe /opt/gestionfil/telechargements/'
```

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
