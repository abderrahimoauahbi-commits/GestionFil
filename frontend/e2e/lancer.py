# -*- coding: utf-8 -*-
"""
LES TESTS DE BOUT EN BOUT : Edge pilote par Playwright, sur les vrais ecrans.

POURQUOI. Le banc (backend/tests/banc) parle au serveur directement : il ne voit
ni une erreur JavaScript, ni un champ trop etroit pour sa valeur, ni un tableau
qu'il faut faire defiler dans les deux sens, ni un bouton d'action sorti de
l'ecran, ni une virgule decimale mal lue. Ici, un vrai navigateur ouvre chaque
ecran, s'y connecte comme un utilisateur, tape dans les champs et mesure ce
qu'il voit.

CE QUE FAIT LE LANCEUR :
  1. une base JETABLE `gestionfil_banc_<pid>` (la meme fabrique que le banc :
     socle, comptes, referentiel du banc) — JAMAIS gestionfil ni
     gestionfil_saisie ;
  2. des donnees, par les scenarios du banc, pour que les listes ne soient pas
     vides (un tableau vide ne deborde jamais) ;
  3. le serveur d'essai sur le port 8097, qui sert l'interface compilee
     (frontend/dist : `npm run build` avant, ou --construire) ;
  4. `npx playwright test` (frontend/playwright.config.ts), puis le rapport des
     constats (rapport-e2e/constats.md) ;
  5. la base est supprimee (sauf --garder).

Usage (depuis frontend/) :
    python e2e/lancer.py --cible <CARGO_TARGET_DIR>              # tout
    python e2e/lancer.py --construire                            # npm run build d'abord
    python e2e/lancer.py --garder -- --grep "Bons de commande"   # apres --, options de Playwright
    python e2e/lancer.py --servir      # base et serveur gardes ouverts pour ecrire un test
PGPASSWORD = mot de passe postgres, comme pour le banc.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

ICI = Path(__file__).resolve().parent
FRONTEND = ICI.parent
RACINE = FRONTEND.parent
sys.path.insert(0, str(RACINE / "backend" / "tests" / "banc"))

import banc  # noqa: E402
import scenarios  # noqa: E402

PORT = 8097
# Les scenarios qui remplissent la base. Pas ceux qui verrouillent des comptes
# ou changent des mots de passe (sessions, gardes), ni ceux qui ne creent rien.
SANS = {"sessions", "gardes_p1", "migrations_rejouables", "controles_finaux", "masquage", "sauvegarde_restaurable"}

# Un exemple par ecran a parametre : le premier document de chaque sorte.
EXEMPLES = {
    "bons-commande/:id": "SELECT id_bc FROM bon_commande ORDER BY date_creation DESC LIMIT 1",
    "bons-commande/:id/etat": "SELECT id_bc FROM bon_commande ORDER BY date_creation DESC LIMIT 1",
    "receptions/:id": "SELECT id_reception FROM reception ORDER BY date_creation DESC LIMIT 1",
    "etats/receptions/:id": "SELECT id_reception FROM reception ORDER BY date_creation DESC LIMIT 1",
    "import/:id": "SELECT id_dossier FROM import_dossiers ORDER BY date_creation DESC LIMIT 1",
    "receptions-import/:idReception": "SELECT id_reception FROM import_receptions ORDER BY date_creation DESC LIMIT 1",
    "mouvements/:id": "SELECT id_mouvement FROM mouvement ORDER BY date_mouvement DESC LIMIT 1",
    "machines/:code": "SELECT code_machine FROM machine ORDER BY code_machine LIMIT 1",
    "utilisateurs/:id/droits": "SELECT id_utilisateur FROM utilisateur WHERE login = 'Magasinie'",
    "etats/qualite/:code": "SELECT code_qualite FROM qualite ORDER BY code_qualite LIMIT 1",
    "etats/couleur/:code": "SELECT code_couleur FROM couleur ORDER BY code_couleur LIMIT 1",
    "etats/inventaire/:id": "SELECT id_inventaire FROM inventaire ORDER BY date_creation DESC LIMIT 1",
    "etats/plan-production/:id": "SELECT id_plan FROM plan_production ORDER BY date_creation DESC LIMIT 1",
    "transferts/:id/bon-sortie": "SELECT id_transfert FROM transfert ORDER BY date_creation DESC LIMIT 1",
}


def main():
    args = sys.argv[1:]
    extra = args[args.index("--") + 1:] if "--" in args else []
    args = args[:args.index("--")] if "--" in args else args
    infra = banc.Infra(args + ["--port", str(PORT)])
    # --dist <dossier> : une interface compilee ailleurs (npx vite build --outDir …),
    # pour verifier un ecran sans toucher frontend/dist, que sert peut-etre un
    # autre serveur (la simulation).
    dist = FRONTEND / (args[args.index("--dist") + 1] if "--dist" in args else "dist")
    if "--construire" in args:
        subprocess.run("npm run build", cwd=FRONTEND, shell=True, check=True)
    if not (dist / "index.html").exists():
        sys.exit("frontend/dist absent : npm run build (ou --construire).")
    for nom, chemin in (("serveur", infra.binaire), ("admin", infra.admin)):
        if not chemin.exists():
            sys.exit(f"binaire {nom} introuvable : {chemin} (cargo build --bins, ou --cible)")
    with socket.socket() as sonde:
        sonde.settimeout(1)
        if sonde.connect_ex(("127.0.0.1", PORT)) == 0:
            sys.exit(f"le port {PORT} est deja occupe.")

    debut = time.time()
    print(f"e2e : base {infra.base}, serveur sur 127.0.0.1:{PORT}")
    code = 1
    try:
        infra.batir()
        infra.demarrer(frontend=dist)
        client = banc.Client(f"http://127.0.0.1:{PORT}")
        for s in scenarios.SCENARIOS:
            nom = s.__name__.removeprefix("scenario_")
            if nom in SANS:
                continue
            try:
                s(client, infra)
            except Exception as e:  # une donnee en moins n'empeche pas de regarder les ecrans
                print(f"  (donnees : {nom} en echec, {str(e)[:120]})")
        # Des statistiques, comme une base vivante : sans elles, la supervision prend 46 s.
        infra.psql(infra.base, "-q", "-c", "ANALYZE")
        print(f"  donnees creees ({time.time() - debut:.0f} s)")
        exemples = {}
        for route, requete in EXEMPLES.items():
            try:
                v = infra.valeur(requete)
            except RuntimeError:
                v = None
            if v:
                exemples[route] = v
        sortie = FRONTEND / "rapport-e2e"
        # Les constats d'un passage precedent fausseraient le rapport.
        shutil.rmtree(sortie / "constats", ignore_errors=True)
        sortie.mkdir(exist_ok=True)
        (sortie / "exemples.json").write_text(json.dumps(exemples, indent=1), encoding="utf-8")
        env = dict(os.environ, E2E_URL=f"http://127.0.0.1:{PORT}", E2E_MDP=banc.MOT_DE_PASSE,
                   E2E_EXEMPLES=str(sortie / "exemples.json"))
        if "--servir" in args:
            # Pour ecrire un test : la base et le serveur restent la, on relance
            # `npx playwright test ...` a volonte (E2E_URL, E2E_MDP, E2E_EXEMPLES
            # ci-dessous). Creer rapport-e2e/ARRETER pour tout arreter proprement.
            arret = sortie / "ARRETER"
            arret.unlink(missing_ok=True)
            print(f"  serveur pret : {env['E2E_URL']} ; base {infra.base}. Arret : creer {arret}", flush=True)
            while not arret.exists():
                time.sleep(1)
            arret.unlink(missing_ok=True)
            return 0
        code = subprocess.run(f"npx playwright test {' '.join(extra)}", cwd=FRONTEND, shell=True,
                              env=env).returncode
        subprocess.run([sys.executable, str(ICI / "constats.py")], cwd=FRONTEND)
    finally:
        infra.arreter("--garder" in args)
    print(f"\ne2e termine en {time.time() - debut:.0f} s"
          + (f" ; base gardee : {infra.base}" if "--garder" in args else "")
          + ". Rapport : frontend/rapport-e2e/constats.md, et npx playwright show-report rapport-e2e/html")
    return code


if __name__ == "__main__":
    sys.exit(main())
