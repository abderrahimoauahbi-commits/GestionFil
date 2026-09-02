#!/usr/bin/env bash
# =============================================================================
# PostgreSQL 18 sur Ubuntu 24.04 LTS — installation ou mise a niveau
# -----------------------------------------------------------------------------
# Serveur cible : 192.168.1.140
#
# POURQUOI CE SCRIPT ET PAS `apt install postgresql`. Ubuntu 24.04 livre
# PostgreSQL 16 et ne proposera jamais la 18 : les versions majeures ne
# remontent pas dans une LTS. La 18 vient du depot PGDG, maintenu par le projet
# PostgreSQL lui-meme.
#
# POURQUOI LA 18 ICI. Le poste de developpement tourne deja en 18.4. Deux
# versions majeures differentes entre le poste et le serveur, c'est un ecart
# qu'on ne decouvre qu'en production, sur une fonction de fenetrage ou un
# comportement de tri. Les aligner coute une heure aujourd'hui.
#
# CE SCRIPT NE DETRUIT RIEN. S'il trouve un cluster existant, il le MIGRE avec
# `pg_upgradecluster` et laisse l'ancien en place, arrete. Vous le supprimerez
# vous-meme, apres verification — jamais le script.
#
# Usage, sur le serveur :
#     sudo bash 01-postgresql-18.sh
# =============================================================================
set -euo pipefail

VERSION_CIBLE=18

dire() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
avertir() { printf '\033[1;33m /!\\ %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "A lancer avec sudo."; exit 1; }

# --- 1. Ou en est-on ? -------------------------------------------------------
dire "Etat actuel"
if command -v pg_lsclusters >/dev/null 2>&1; then
    pg_lsclusters
    ANCIENNE=$(pg_lsclusters --no-header | awk '$1 != "'"$VERSION_CIBLE"'" {print $1; exit}')
else
    echo "Aucun cluster PostgreSQL installe."
    ANCIENNE=""
fi

# --- 2. Le depot PGDG --------------------------------------------------------
# La cle est posee en fichier dedie sous /etc/apt/keyrings, et le depot la
# designe par `signed-by`. `apt-key` est obsolete depuis Ubuntu 22.04 : une cle
# posee avec lui vaut pour TOUS les depots, ce qu'on ne veut pas.
dire "Depot PostgreSQL officiel (PGDG)"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release

install -d -m 0755 /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/pgdg.asc ]]; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        -o /etc/apt/keyrings/pgdg.asc
fi

CODENAME=$(lsb_release -cs)
echo "deb [signed-by=/etc/apt/keyrings/pgdg.asc] http://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq

# --- 3. Installation ---------------------------------------------------------
dire "Installation de PostgreSQL ${VERSION_CIBLE}"
# `postgresql-client` et `-contrib` : le premier pour psql/pg_dump, le second
# pour les extensions (pg_trgm, unaccent) qu'un ERP finit toujours par vouloir.
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    "postgresql-${VERSION_CIBLE}" \
    "postgresql-client-${VERSION_CIBLE}" \
    "postgresql-contrib-${VERSION_CIBLE}"

# --- 4. Mise a niveau d'un cluster existant ----------------------------------
# `apt` cree automatiquement un cluster `main` vide pour la nouvelle version.
# `pg_upgradecluster` refuse d'ecrire dans un cluster existant : on retire donc
# le cluster VIDE qu'il vient de creer, pas celui qui porte les donnees.
if [[ -n "${ANCIENNE}" ]]; then
    dire "Migration du cluster ${ANCIENNE}/main vers ${VERSION_CIBLE}"
    avertir "L'ancien cluster est CONSERVE et arrete. Rien n'est supprime."

    if pg_lsclusters --no-header | awk '{print $1"/"$2}' | grep -qx "${VERSION_CIBLE}/main"; then
        pg_dropcluster --stop "${VERSION_CIBLE}" main
    fi

    pg_upgradecluster -m upgrade "${ANCIENNE}" main

    dire "Apres migration"
    pg_lsclusters
    avertir "Verifiez vos donnees, PUIS seulement :"
    avertir "    sudo pg_dropcluster --stop ${ANCIENNE} main"
fi

# --- 5. Ecoute sur le reseau local -------------------------------------------
# Par defaut PostgreSQL n'ecoute que sur la boucle locale. Le backend tournera
# sur cette meme machine, donc CELA SUFFIT et c'est le plus sur : la base n'est
# jamais exposee au reseau, seul l'API l'est.
#
# Rien n'est donc modifie ici. Si un jour le backend doit tourner ailleurs,
# c'est `listen_addresses` dans postgresql.conf et une ligne `scram-sha-256`
# dans pg_hba.conf — et un pare-feu, pas l'inverse.
dire "Ecoute"
CONF="/etc/postgresql/${VERSION_CIBLE}/main/postgresql.conf"
echo "  listen_addresses = $(grep -E '^\s*listen_addresses' "$CONF" || echo 'localhost (defaut)')"
echo "  La base reste sur la boucle locale : seul le backend la joint."

# --- 6. Verification ---------------------------------------------------------
dire "Verification"
systemctl enable --now "postgresql@${VERSION_CIBLE}-main" >/dev/null 2>&1 || systemctl enable --now postgresql
sudo -u postgres psql -tAc "SELECT version();"
pg_lsclusters

dire "Termine"
echo "Etape suivante : 02-base-production.sh"
