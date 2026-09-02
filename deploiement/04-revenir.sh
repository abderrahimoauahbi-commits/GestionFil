#!/usr/bin/env bash
# =============================================================================
# Retour a la version precedente
# -----------------------------------------------------------------------------
# `03-publier.sh` met de cote les binaires et l'interface avant de les remplacer.
# Ce script les remet en place et redemarre le service.
#
# CE QU'IL NE FAIT PAS, ET C'EST ESSENTIEL : il ne touche pas a la BASE. Si la
# version publiee a modifie le schema, revenir au binaire precedent ne suffit
# pas — il faut aussi restaurer la base, ce qui est une operation distincte,
# plus lourde, et qui perd les ecritures faites depuis :
#
#     sudo systemctl stop gestionfil
#     sudo -u gestionfil /opt/gestionfil/gestionfil-admin restaurer <fichier>
#
# Un retour de binaire sur une base migree donne un service qui demarre et se
# comporte de facon imprevisible. Le message ci-dessous le rappelle a chaque
# execution, parce que c'est le genre de detail qu'on oublie sous pression.
#
# Usage :
#     sudo bash 04-revenir.sh
# =============================================================================
set -euo pipefail

RACINE=/opt/gestionfil
PRECEDENT="$RACINE/precedent"
UTILISATEUR=gestionfil

dire() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "A lancer avec sudo."; exit 1; }
[[ -d "$PRECEDENT" ]] || { echo "Aucune version precedente dans $PRECEDENT"; exit 1; }
[[ -f "$PRECEDENT/gestionfil" ]] || { echo "$PRECEDENT ne contient pas de binaire"; exit 1; }

dire "Version qui va etre remise en place"
ls -l --time-style=+'%Y-%m-%d %H:%M' "$PRECEDENT" | tail -n +2

dire "Arret du service"
systemctl stop gestionfil 2>/dev/null || true

dire "Remise en place"
for f in gestionfil gestionfil-admin gestionfil-import; do
    [[ -f "$PRECEDENT/$f" ]] && install -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0755 \
        "$PRECEDENT/$f" "$RACINE/"
done
if [[ -d "$PRECEDENT/web" ]]; then
    rm -rf "$RACINE/web"
    cp -r "$PRECEDENT/web" "$RACINE/web"
    chown -R "$UTILISATEUR:$UTILISATEUR" "$RACINE/web"
fi

dire "Demarrage"
systemctl start gestionfil
sleep 3
if systemctl is-active --quiet gestionfil; then
    PORT=$(grep -oP 'BIND_ADDR=.*:\K[0-9]+' "$RACINE/.env" || echo 8080)
    curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/sante" >/dev/null \
        && echo "  service actif, /api/sante repond" \
        || echo "  service actif mais /api/sante ne repond pas"
else
    journalctl -u gestionfil -n 30 --no-pager
    exit 1
fi

dire "Revenu a la version precedente"
printf '\033[1;33m /!\\ %s\033[0m\n' \
    "LA BASE N'A PAS ETE TOUCHEE. Si la version annulee avait migre le schema,"
printf '\033[1;33m     %s\033[0m\n' \
    "restaurez aussi la base : gestionfil-admin restaurer <fichier>"
