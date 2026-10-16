# -*- coding: utf-8 -*-
"""
L'AGENT DE SAISIE : rejoue l'activite de janvier 2024 a aujourd'hui dans les
vrais ecrans (simulation/agent.spec.ts), sur la base de saisie.

CE QUE FAIT LE LANCEUR :
  1. demarre un serveur d'essai sur le port 8099 (jamais 8080, celui de
     l'utilisateur), lance depuis un dossier vide : aucun .env n'est lu ; la base
     est celle qu'on nomme (gestionfil_saisie par defaut), JAMAIS gestionfil ;
  2. sert l'interface compilee (frontend/dist : --construire pour la refaire) ;
  3. lance Playwright ; l'agent reprend la ou le journal s'est arrete
     (rapport-simulation/journal.json) ;
  4. arrete le serveur.

Usage (depuis frontend/) :
    python simulation/lancer.py --cible <CARGO_TARGET_DIR>            # tout, ou la suite
    python simulation/lancer.py --limite 20                           # 20 evenements, pour voir
    python simulation/lancer.py --base gestionfil_saisie --construire
Le mot de passe postgres est pris dans PGPASSWORD, ou dans backend/.env.
"""
import os
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ICI = Path(__file__).resolve().parent
FRONTEND = ICI.parent
RACINE = FRONTEND.parent
PORT = 8099


def option(nom, defaut=None):
    args = sys.argv[1:]
    return args[args.index(nom) + 1] if nom in args else defaut


def main():
    base = option("--base", "gestionfil_saisie")
    if base == "gestionfil":
        sys.exit("Pas la base vivante : la simulation ecrit des annees de documents.")
    cible = Path(option("--cible", str(Path(tempfile.gettempdir()) / "gestionfil-paquet-cible")))
    binaire = cible / "debug" / ("gestionfil.exe" if os.name == "nt" else "gestionfil")
    if not binaire.exists():
        sys.exit(f"binaire introuvable : {binaire} (cargo build --bins avec CARGO_TARGET_DIR={cible})")
    if "--construire" in sys.argv:
        subprocess.run("npm run build", cwd=FRONTEND, shell=True, check=True)
    dist = FRONTEND / "dist"
    if not (dist / "index.html").exists():
        sys.exit("frontend/dist absent : npm run build (ou --construire).")

    env_fichier = (RACINE / "backend" / ".env").read_text(encoding="utf-8")
    url = re.search(r"^DATABASE_URL=(.*)$", env_fichier, re.M).group(1).strip()
    url = url[: url.rfind("/") + 1] + base

    with socket.socket() as sonde:
        sonde.settimeout(1)
        if sonde.connect_ex(("127.0.0.1", PORT)) == 0:
            sys.exit(f"le port {PORT} est deja occupe.")

    vide = tempfile.mkdtemp(prefix="simulation_")
    journal = open(Path(vide) / "serveur.log", "w", encoding="utf-8")
    env = dict(os.environ, DATABASE_URL=url, JWT_SECRET=secrets.token_hex(32), BIND_ADDR=f"127.0.0.1:{PORT}",
               FRONTEND_DIR=str(dist), RUST_LOG="warn")
    serveur = subprocess.Popen([str(binaire)], cwd=vide, env=env, stdout=journal, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/sante", timeout=2):
                    break
            except Exception:
                if serveur.poll() is not None:
                    journal.flush()
                    sys.exit("le serveur s'est arrete : " + (Path(vide) / "serveur.log").read_text(encoding="utf-8")[-1500:])
                time.sleep(0.5)
        print(f"simulation : base {base}, serveur 127.0.0.1:{PORT} (journal du serveur : {vide}\\serveur.log)", flush=True)
        env_pw = dict(os.environ, SIM_URL=f"http://127.0.0.1:{PORT}")
        if option("--limite"):
            env_pw["SIM_LIMITE"] = option("--limite")
        code = subprocess.run("npx playwright test --config simulation/playwright.config.ts", cwd=FRONTEND,
                              shell=True, env=env_pw).returncode
    finally:
        serveur.terminate()
        try:
            serveur.wait(10)
        except subprocess.TimeoutExpired:
            serveur.kill()
    print("journal : frontend/rapport-simulation/journal.log")
    return code


if __name__ == "__main__":
    sys.exit(main())
