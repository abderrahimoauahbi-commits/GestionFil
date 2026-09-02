#!/usr/bin/env bash
# =============================================================================
# Publication d'une version sur le serveur
# -----------------------------------------------------------------------------
# Se lance SUR LE SERVEUR, apres y avoir depose l'archive produite par le poste
# de developpement. Rejouable a chaque version : il ne touche qu'a
# /opt/gestionfil et ne modifie aucun reglage systeme.
#
# LE SERVICE EST ARRETE PENDANT LA BASCULE, et c'est deliberé. Remplacer un
# binaire en cours d'execution est possible sous Linux — l'ancien continue de
# tourner depuis l'inode supprime — mais le resultat est une version qui sert
# encore l'ancienne interface avec la nouvelle base. Trente secondes d'arret
# valent mieux qu'une incoherence silencieuse.
#
# Usage :
#     sudo bash 03-publier.sh /chemin/vers/gestionfil-VERSION.tar.gz
# =============================================================================
set -euo pipefail

RACINE=/opt/gestionfil
UTILISATEUR=gestionfil
ARCHIVE=${1:-}

dire() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "A lancer avec sudo."; exit 1; }
[[ -f "$ARCHIVE" ]] || { echo "Archive introuvable : $ARCHIVE"; exit 1; }
[[ -f "$RACINE/.env" ]] || { echo "$RACINE/.env absent : lancer d'abord 02-installer-serveur.sh"; exit 1; }

# --- 1. La version precedente est gardee ------------------------------------
# Une publication qui ne peut pas etre annulee n'est pas une publication, c'est
# un pari. Les binaires et l'interface precedents sont mis de cote AVANT d'etre
# remplaces ; `04-revenir.sh` les remet en place en une commande.
dire "Mise de cote de la version en place"
PRECEDENT="$RACINE/precedent"
rm -rf "$PRECEDENT"
install -d -o "$UTILISATEUR" -g "$UTILISATEUR" "$PRECEDENT"
for f in gestionfil gestionfil-admin gestionfil-import; do
    [[ -f "$RACINE/$f" ]] && cp -p "$RACINE/$f" "$PRECEDENT/"
done
[[ -d "$RACINE/web" ]] && cp -rp "$RACINE/web" "$PRECEDENT/" || true
echo "  $PRECEDENT"

# --- 2. Extraction dans un dossier temporaire --------------------------------
# JAMAIS directement par-dessus l'installation : une archive tronquee laisserait
# une version a moitie remplacee, et le service redemarrerait dessus.
dire "Extraction"
TEMPO=$(mktemp -d)
trap 'rm -rf "$TEMPO"' EXIT
tar -xzf "$ARCHIVE" -C "$TEMPO"
[[ -f "$TEMPO/gestionfil" ]] || { echo "archive invalide : binaire absent"; exit 1; }
[[ -f "$TEMPO/web/index.html" ]] || { echo "archive invalide : interface absente"; exit 1; }
echo "  $(du -sh "$TEMPO" | cut -f1)"

# --- 3. Bascule --------------------------------------------------------------
dire "Arret du service"
systemctl stop gestionfil 2>/dev/null || echo "  (n'etait pas demarre)"

dire "Installation"
install -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0755 "$TEMPO/gestionfil"       "$RACINE/"
install -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0755 "$TEMPO/gestionfil-admin" "$RACINE/"
[[ -f "$TEMPO/gestionfil-import" ]] && \
    install -o "$UTILISATEUR" -g "$UTILISATEUR" -m 0755 "$TEMPO/gestionfil-import" "$RACINE/"

# L'interface est REMPLACEE, pas fusionnee : un fichier d'une version
# precedente qui survivrait serait servi avec le nouveau code, et les erreurs
# que cela produit sont parmi les plus penibles a diagnostiquer.
rm -rf "$RACINE/web"
cp -r "$TEMPO/web" "$RACINE/web"
chown -R "$UTILISATEUR:$UTILISATEUR" "$RACINE/web"
find "$RACINE/web" -type d -exec chmod 0755 {} +
find "$RACINE/web" -type f -exec chmod 0644 {} +
echo "  binaires et interface en place"

# --- 4. Demarrage et verification -------------------------------------------
dire "Demarrage"
systemctl start gestionfil
sleep 3

if ! systemctl is-active --quiet gestionfil; then
    echo
    echo "LE SERVICE N'A PAS DEMARRE. Les 30 dernieres lignes du journal :"
    journalctl -u gestionfil -n 30 --no-pager
    echo
    echo "Pour revenir a la version precedente : sudo bash 04-revenir.sh"
    exit 1
fi

# On ne se contente pas de « le processus tourne » : un service qui ecoute mais
# ne repond pas est en panne, simplement moins visible.
PORT=$(grep -oP 'BIND_ADDR=.*:\K[0-9]+' "$RACINE/.env" || echo 8080)
if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/sante" >/dev/null; then
    echo "  service actif, /api/sante repond sur le port $PORT"
else
    echo "  service actif MAIS /api/sante ne repond pas :"
    journalctl -u gestionfil -n 20 --no-pager
    exit 1
fi

dire "Publie"
systemctl status gestionfil --no-pager | head -6
echo
echo "Version precedente conservee dans $PRECEDENT"
echo "Pour y revenir : sudo bash 04-revenir.sh"
