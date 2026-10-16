#!/usr/bin/env bash
# =============================================================================
# Retour a la version precedente
# -----------------------------------------------------------------------------
# `03-publier.sh` met de cote les binaires et l'interface avant de les remplacer.
# Ce script les remet en place et redemarre le service.
#
# LA BASE, SUR DEMANDE EXPRESSE (09/10/2026, audit v5). Si la version publiee a
# migre le schema, l'ancien binaire tourne sur une base trop recente : il faut
# aussi restaurer la sauvegarde que 03-publier.sh a prise juste avant (son nom
# est garde dans precedent/SAUVEGARDE). Cette restauration EFFACE tout ce qui a
# ete saisi depuis la publication (receptions, fiches machine, mouvements) :
# c'est une decision humaine, jamais un automatisme. Regle pratique :
#   - le probleme est vu tout de suite, avant toute saisie : --avec-base ;
#   - des saisies ont eu lieu : ne pas restaurer, corriger en avant.
#
# Usage :
#     sudo bash 04-revenir.sh               # binaires et interface seulement
#     sudo bash 04-revenir.sh --avec-base   # et la base d'avant la publication
# =============================================================================
set -euo pipefail

RACINE=/opt/gestionfil
PRECEDENT="$RACINE/precedent"
UTILISATEUR=gestionfil

dire() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "A lancer avec sudo."; exit 1; }
[[ -d "$PRECEDENT" ]] || { echo "Aucune version precedente dans $PRECEDENT"; exit 1; }
[[ -f "$PRECEDENT/gestionfil" ]] || { echo "$PRECEDENT ne contient pas de binaire"; exit 1; }

AVEC_BASE=0
[[ "${1:-}" == "--avec-base" ]] && AVEC_BASE=1
SAUVEGARDE=$(cat "$PRECEDENT/SAUVEGARDE" 2>/dev/null || true)
if [[ $AVEC_BASE -eq 1 ]]; then
    [[ -n "$SAUVEGARDE" && -f "$SAUVEGARDE" ]] || {
        echo "Aucune sauvegarde d'avant publication connue ($PRECEDENT/SAUVEGARDE) : base non restauree."
        echo "Choisissez-en une : sudo -u gestionfil $RACINE/gestionfil-admin lister-sauvegardes"
        exit 1; }
    echo
    echo "La base va etre REMPLACEE par : $SAUVEGARDE"
    echo "Tout ce qui a ete saisi depuis cette sauvegarde sera PERDU."
    read -r -p "Tapez RESTAURER pour confirmer : " reponse
    [[ "$reponse" == "RESTAURER" ]] || { echo "Abandon : rien n'a ete touche."; exit 1; }
fi

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

if [[ $AVEC_BASE -eq 1 ]]; then
    dire "Restauration de la base d'avant la publication"
    ( cd "$RACINE" && sudo -u "$UTILISATEUR" ./gestionfil-admin restaurer "$SAUVEGARDE" )
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
