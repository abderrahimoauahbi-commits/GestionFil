#!/usr/bin/env bash
# Compile le service sur le serveur, en mode release.
#
# `--locked` : la resolution des versions est celle du Cargo.lock envoye, pas
# une resolution fraiche. Sans cela, une version mineure publiee entre-temps
# entrerait dans la compilation sans que personne ne l'ait vue.
set -euo pipefail
cd "$(dirname "$0")"

command -v cargo >/dev/null 2>&1 || {
    echo "Rust absent. L'installer :"
    echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
    echo "    source \$HOME/.cargo/env"
    exit 1
}

echo "Compilation (mode release, peut prendre quelques minutes)..."
cargo build --release --locked --bin gestionfil --bin gestionfil-admin --bin gestionfil-import

cp target/release/gestionfil        ./gestionfil
cp target/release/gestionfil-admin  ./gestionfil-admin
cp target/release/gestionfil-import ./gestionfil-import
strip ./gestionfil ./gestionfil-admin ./gestionfil-import 2>/dev/null || true

echo
echo "Binaires prets :"
ls -lh ./gestionfil ./gestionfil-admin ./gestionfil-import

# L'archive a publier, avec tout ce que 03-publier.sh attend : binaires,
# interface, migrations, unite systemd, et la trace d'un paquet sans tests.
EXTRA=""
[[ -f TESTS-NON-JOUES.txt ]] && EXTRA="TESTS-NON-JOUES.txt"
tar -czf ../gestionfil-pret.tar.gz gestionfil gestionfil-admin gestionfil-import web db gestionfil.service $EXTRA
echo "Archive a publier : $(cd .. && pwd)/gestionfil-pret.tar.gz"