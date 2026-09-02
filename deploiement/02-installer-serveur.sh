#!/usr/bin/env bash
# =============================================================================
# Installation du service Gestion Fil sur Ubuntu
# -----------------------------------------------------------------------------
# Serveur cible : 192.168.1.140
#
# Ce script prepare la MACHINE : compte de service, arborescence, droits, outils
# de sauvegarde, pare-feu. Il ne compile rien et ne deploie aucun binaire — c'est
# `03-publier.sh` qui s'en charge, et qui peut etre rejoue a chaque version sans
# repasser par ici.
#
# La separation compte : celui-ci se lance UNE FOIS et touche au systeme ; l'autre
# se lance a chaque mise a jour et ne touche qu'a /opt/gestionfil.
#
# Usage, sur le serveur :
#     sudo bash 02-installer-serveur.sh
# =============================================================================
set -euo pipefail

RACINE=/opt/gestionfil
UTILISATEUR=gestionfil

dire() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
avertir() { printf '\033[1;33m /!\\ %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "A lancer avec sudo."; exit 1; }

# --- 1. Le compte de service -------------------------------------------------
# SANS SHELL ET SANS RECEVOIR DE COURRIER. Ce compte n'existe que pour porter un
# processus : il ne doit pas pouvoir ouvrir de session, meme si quelqu'un lui
# trouve un mot de passe. `--system` le range hors des comptes humains et lui
# donne un identifiant bas, par convention.
dire "Compte de service"
if id -u "$UTILISATEUR" >/dev/null 2>&1; then
    echo "  deja present"
else
    adduser --system --group --no-create-home --shell /usr/sbin/nologin "$UTILISATEUR"
    echo "  cree"
fi

# --- 2. L'arborescence -------------------------------------------------------
dire "Arborescence"
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0755 "$RACINE"
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0755 "$RACINE/web"
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0750 "$RACINE/journaux"
# 0700 sur les sauvegardes : chacune contient TOUTE la base — prix d'achat,
# valorisation, empreintes de mots de passe, audit nominatif. Un `chmod 755`
# ici annulerait tout le reste.
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0700 "$RACINE/sauvegardes"
echo "  $RACINE  (web, journaux, sauvegardes)"

# --- 3. Les outils de sauvegarde ---------------------------------------------
# `pg_dump` et `pg_restore` viennent de postgresql-client. Le service en a besoin
# a l'execution, pas seulement a l'installation : sans eux, la sauvegarde echoue
# au moment ou on la declenche.
dire "Outils de sauvegarde"
if command -v pg_dump >/dev/null 2>&1; then
    echo "  pg_dump : $(pg_dump --version)"
else
    DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-client
fi

# --- 4. La configuration -----------------------------------------------------
# Elle n'est PAS ecrite ici : elle porte le mot de passe de la base et le secret
# des jetons. Un script qui la genererait la laisserait dans l'historique du
# shell et dans les journaux d'installation.
dire "Configuration"
if [[ -f "$RACINE/.env" ]]; then
    echo "  $RACINE/.env existe deja, laisse tel quel"
else
    cat > "$RACINE/.env" <<'MODELE'
# Configuration du service Gestion Fil.
# Ce fichier porte des SECRETS : il n'est lisible que par le compte de service.

# La base est sur cette machine, sur la boucle locale.
DATABASE_URL=postgres://gestionfil:MOT_DE_PASSE_A_REMPLACER@127.0.0.1:5432/gestionfil

# 0.0.0.0 : l'API doit etre joignable depuis les postes du reseau. C'est le
# SEUL service expose — la base, elle, n'ecoute que sur localhost.
BIND_ADDR=0.0.0.0:8080

# Au moins 32 caracteres, tire au sort. En generer un :
#     openssl rand -base64 48
JWT_SECRET=A_REMPLACER_PAR_UN_SECRET_TIRE_AU_SORT

# Duree de validite d'un jeton, en minutes. 480 = une journee de travail : au
# dela, une session oubliee sur un poste de magasin reste ouverte la nuit.
JWT_TTL_MINUTES=480

# L'interface est servie par ce meme processus, depuis ./web : elle est donc sur
# la MEME ORIGINE que l'API, et aucune regle CORS n'est necessaire pour elle.
# Cette liste ne sert qu'aux applications empaquetees (bureau, mobile), dont
# l'origine n'est pas une adresse web.
CORS_ORIGINS=tauri://localhost,http://tauri.localhost

# Dossier des sauvegardes.
GESTIONFIL_SAUVEGARDES=/opt/gestionfil/sauvegardes
MODELE
    chown "$UTILISATEUR:$UTILISATEUR" "$RACINE/.env"
    chmod 0600 "$RACINE/.env"
    echo "  modele ecrit dans $RACINE/.env"
    avertir "A COMPLETER : mot de passe de la base et JWT_SECRET."
fi

# --- 5. Le service -----------------------------------------------------------
dire "Service systemd"
if [[ -f "$(dirname "$0")/gestionfil.service" ]]; then
    cp "$(dirname "$0")/gestionfil.service" /etc/systemd/system/
    systemctl daemon-reload
    echo "  installe (non demarre : le binaire n'est pas encore la)"
else
    avertir "gestionfil.service introuvable a cote de ce script"
fi

# --- 6. Le pare-feu ----------------------------------------------------------
# On OUVRE le port de l'API et on laisse SSH ouvert. On ne touche a rien d'autre :
# PostgreSQL n'ecoute deja que sur la boucle locale, donc aucune regle ne le
# concerne — une regle qui protege ce qui n'est pas expose donne surtout une
# fausse impression de securite.
dire "Pare-feu"
if command -v ufw >/dev/null 2>&1; then
    ufw allow 22/tcp  comment 'SSH' >/dev/null 2>&1 || true
    ufw allow 8080/tcp comment 'Gestion Fil (API et interface)' >/dev/null 2>&1 || true
    echo "  regles posees (ufw reste inactif tant qu'il n'est pas active)"
    ufw status | head -6
else
    echo "  ufw absent : aucune regle posee"
fi

# --- 7. La sauvegarde quotidienne -------------------------------------------
dire "Sauvegarde quotidienne"
cat > /etc/systemd/system/gestionfil-sauvegarde.service <<SERVICE
[Unit]
Description=Sauvegarde quotidienne de la base Gestion Fil
Requires=postgresql.service
After=postgresql.service

[Service]
Type=oneshot
User=$UTILISATEUR
Group=$UTILISATEUR
WorkingDirectory=$RACINE
EnvironmentFile=$RACINE/.env
ExecStart=$RACINE/gestionfil-admin sauvegarder
SERVICE

cat > /etc/systemd/system/gestionfil-sauvegarde.timer <<'TIMER'
[Unit]
Description=Sauvegarde quotidienne de la base Gestion Fil

[Timer]
# 02h30 : apres la fermeture de l'atelier, avant l'arrivee du matin. La base
# est au repos, la sauvegarde ne ralentit personne.
OnCalendar=*-*-* 02:30:00
# Si la machine etait eteinte a 02h30, la sauvegarde part au demarrage suivant
# plutot que d'etre sautee. Un serveur eteint le week-end sauterait sinon deux
# jours sans que rien ne le signale.
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable gestionfil-sauvegarde.timer >/dev/null 2>&1 || true
echo "  minuterie posee : tous les jours a 02h30"

dire "Termine"
echo "Etape suivante : 03-publier.sh, depuis le poste de developpement."
echo
echo "Avant le premier demarrage :"
echo "  1. completer $RACINE/.env  (mot de passe base, JWT_SECRET)"
echo "  2. publier les binaires et l'interface"
echo "  3. definir les mots de passe des six comptes"
