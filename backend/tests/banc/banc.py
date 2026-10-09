# -*- coding: utf-8 -*-
"""
LE BANC DE TESTS : une base jetable, un serveur d'essai, les scenarios metier.

POURQUOI. Les regles qui comptent vivent dans la base (declencheurs) et dans
les cascades du service (reception 3-en-1, cloture par facture, inventaire,
contre-passation). Les tests unitaires de `cargo test` ne les touchent pas :
les defauts de l'audit v4 seraient tous tombes au premier passage d'un banc.

CE QUE FAIT LE BANC, a chaque passage :
  1. une base NEUVE `gestionfil_banc_<pid>`, batie depuis le socle (charger.py
     --socle --comptes, puis migrer.py) et le referentiel fige du banc ;
  2. les mots de passe des comptes, par gestionfil-admin ;
  3. le serveur, lance depuis un repertoire VIDE (aucun .env n'est lu : il ne
     peut pas viser la base vivante), sur un port d'essai ;
  4. les scenarios (scenarios.py), chacun isole : un echec n'arrete pas les
     suivants ;
  5. la base est supprimee (sauf --garder).

Il ne touche JAMAIS la base `gestionfil` ni le port 8080.

Usage (depuis la racine du depot) :
    python backend\\tests\\banc\\banc.py                   # tout
    python backend\\tests\\banc\\banc.py reception inventaire   # quelques scenarios
    python backend\\tests\\banc\\banc.py --garder           # garder la base pour l'examiner
    python backend\\tests\\banc\\banc.py --referentiel-depuis gestionfil_p1   # regenerer le referentiel

Options : --hote, --utilisateur (postgres), --motdepasse (a defaut PGPASSWORD),
--port (8096), --cible (repertoire cargo des binaires ; a defaut
CARGO_TARGET_DIR, sinon backend/target).
"""
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

ICI = Path(__file__).resolve().parent
RACINE = ICI.parents[2]
DB_PG = RACINE / "db" / "pg"
PSQL = os.environ.get("PSQL", r"C:\Program Files\PostgreSQL\18\bin\psql.exe")
PG_DUMP = os.environ.get("PG_DUMP", r"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe")
MOT_DE_PASSE = "Banc-Essai-2026!"
COMPTES = ["admin", "Mohamed", "Choukri", "Tarik", "Assistante", "Magasinie"]

# Le referentiel du banc : de quoi commander, recevoir, produire. Pas de stock,
# pas de mouvement : chaque scenario cree ce dont il a besoin.
REFERENTIEL = [
    "famille", "couleur", "groupe_equiv", "conditionnement", "fournisseur", "contact_fournisseur",
    "reference", "reference_groupe_equiv", "couleur_fournisseur", "taux_change", "cours_bam",
    "qualite", "ligne_qualite", "recette",
]


class Echec(AssertionError):
    pass


def verifier(condition, message):
    if not condition:
        raise Echec(message)


# ---------------------------------------------------------------------------
# Le client HTTP
# ---------------------------------------------------------------------------
class Client:
    def __init__(self, base_url):
        self.base_url = base_url
        self.jetons = {}

    def appel(self, login, methode, chemin, corps=None):
        if login not in self.jetons and chemin != "/api/auth/connexion":
            code, r = self.appel(login, "POST", "/api/auth/connexion",
                                 {"login": login, "mot_de_passe": MOT_DE_PASSE})
            if code != 200:
                raise Echec(f"connexion de {login} refusee : {r}")
            self.jetons[login] = r.get("jeton") or r.get("token")
        data = json.dumps(corps).encode() if corps is not None else None
        req = urllib.request.Request(self.base_url + chemin, data=data, method=methode)
        req.add_header("Content-Type", "application/json")
        if login in self.jetons:
            req.add_header("Authorization", "Bearer " + self.jetons[login])
        try:
            with urllib.request.urlopen(req, timeout=60) as rep:
                txt = rep.read().decode()
                return rep.status, (json.loads(txt) if txt else {})
        except urllib.error.HTTPError as e:
            txt = e.read().decode()
            try:
                return e.code, json.loads(txt)
            except ValueError:
                return e.code, {"brut": txt}

    # Raccourcis : `ok` exige un 200 et rend le corps ; `refus` exige un refus.
    def ok(self, login, methode, chemin, corps=None):
        code, r = self.appel(login, methode, chemin, corps)
        if code != 200:
            raise Echec(f"{login} {methode} {chemin} : {code} {r}")
        return r

    def refus(self, login, methode, chemin, corps=None, codes=(400, 403, 409, 422), contient=None):
        code, r = self.appel(login, methode, chemin, corps)
        if code not in codes:
            raise Echec(f"{login} {methode} {chemin} : refus attendu, obtenu {code} {str(r)[:300]}")
        if contient and contient.lower() not in json.dumps(r, ensure_ascii=False).lower():
            raise Echec(f"{login} {methode} {chemin} : message sans « {contient} » : {r}")
        return r


# ---------------------------------------------------------------------------
# La base et le serveur
# ---------------------------------------------------------------------------
class Infra:
    def __init__(self, args):
        def option(nom, defaut=None):
            return args[args.index(nom) + 1] if nom in args else defaut

        self.hote = option("--hote", "127.0.0.1")
        self.utilisateur = option("--utilisateur", "postgres")
        self.motdepasse = option("--motdepasse", os.environ.get("PGPASSWORD", ""))
        self.port = int(option("--port", "8096"))
        cible = option("--cible", os.environ.get("CARGO_TARGET_DIR", str(RACINE / "backend" / "target")))
        self.binaire = Path(cible) / "debug" / "gestionfil.exe"
        self.admin = Path(cible) / "debug" / "gestionfil-admin.exe"
        self.base = f"gestionfil_banc_{os.getpid()}"
        self.serveur = None
        self.env = dict(os.environ, PGPASSWORD=self.motdepasse)

    def url(self, base=None):
        from urllib.parse import quote
        return (f"postgres://{quote(self.utilisateur)}:{quote(self.motdepasse)}@{self.hote}:5432/"
                f"{base or self.base}")

    def psql(self, base, *args, entree=None):
        p = subprocess.run([PSQL, "-h", self.hote, "-U", self.utilisateur, "-d", base,
                            "-v", "ON_ERROR_STOP=1", *args],
                           input=entree, capture_output=True, text=True, env=self.env)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip())
        return p.stdout

    def sql(self, requete):
        """Une requete sur la base du banc, resultat en lignes de colonnes."""
        out = self.psql(self.base, "-tA", "-F", "\t", "-c", requete)
        return [l.split("\t") for l in out.splitlines() if l.strip()]

    def valeur(self, requete):
        lignes = self.sql(requete)
        return lignes[0][0] if lignes else None

    def batir(self):
        assert self.base.startswith("gestionfil_banc_")
        self.psql("postgres", "-q", "-c", f"DROP DATABASE IF EXISTS {self.base}")
        self.psql("postgres", "-q", "-c", f"CREATE DATABASE {self.base} OWNER gestionfil")
        for cmd in ([sys.executable, "charger.py", "--base", self.base, "--socle", "--comptes",
                     "--hote", self.hote, "--utilisateur", self.utilisateur],
                    [sys.executable, "migrer.py", "--base", self.base,
                     "--hote", self.hote, "--utilisateur", self.utilisateur]):
            p = subprocess.run(cmd, cwd=DB_PG, capture_output=True, text=True, env=self.env)
            if p.returncode != 0:
                raise RuntimeError(f"{' '.join(cmd[1:3])} : {p.stdout[-800:]} {p.stderr[-800:]}")
        self.psql(self.base, "-q", "-f", str(ICI / "referentiel.sql"))
        for login in COMPTES:
            p = subprocess.run([str(self.admin), "definir-mot-de-passe", login],
                               cwd=tempfile.gettempdir(), capture_output=True, text=True,
                               env=dict(self.env, DATABASE_URL=self.url(),
                                        GESTIONFIL_MOT_DE_PASSE=MOT_DE_PASSE))
            if p.returncode != 0:
                raise RuntimeError(f"mot de passe de {login} : {p.stderr.strip()[-400:]}")

    def demarrer(self):
        self.vide = tempfile.mkdtemp(prefix="banc_")
        (Path(self.vide) / "index.html").write_text("<!doctype html><title>banc</title>", encoding="utf-8")
        self.journal = open(Path(self.vide) / "serveur.log", "w", encoding="utf-8")
        env = dict(self.env, DATABASE_URL=self.url(), JWT_SECRET=secrets.token_hex(32),
                   BIND_ADDR=f"127.0.0.1:{self.port}", FRONTEND_DIR=self.vide, RUST_LOG="warn")
        self.serveur = subprocess.Popen([str(self.binaire)], cwd=self.vide, env=env,
                                        stdout=self.journal, stderr=subprocess.STDOUT)
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/sante", timeout=2):
                    return
            except Exception:
                if self.serveur.poll() is not None:
                    break
                time.sleep(0.5)
        self.journal.flush()
        raise RuntimeError("le serveur ne repond pas : " +
                           (Path(self.vide) / "serveur.log").read_text(encoding="utf-8")[-1500:])

    def arreter(self, garder):
        if self.serveur and self.serveur.poll() is None:
            self.serveur.terminate()
            try:
                self.serveur.wait(10)
            except subprocess.TimeoutExpired:
                self.serveur.kill()
        if not garder:
            try:
                self.psql("postgres", "-q", "-c", f"DROP DATABASE IF EXISTS {self.base} WITH (FORCE)")
            except RuntimeError as e:
                print(f"  (base {self.base} non supprimee : {e})")


def regenerer_referentiel(infra, source):
    if source == "gestionfil":
        sys.exit("Pas la base vivante : une copie.")
    cmd = [PG_DUMP, "-h", infra.hote, "-U", infra.utilisateur, "-d", source,
           "--data-only", "--disable-triggers", "--no-owner"]
    for t in REFERENTIEL:
        cmd += ["-t", f"public.{t}"]
    p = subprocess.run(cmd, capture_output=True, env=infra.env)
    if p.returncode != 0:
        sys.exit(p.stderr.decode("utf-8", "replace"))
    entete = (f"-- Referentiel du banc de tests, extrait de {source} par banc.py --referentiel-depuis.\n"
              f"-- Pas de stock ni de mouvement : chaque scenario cree ce dont il a besoin.\n\n").encode()
    (ICI / "referentiel.sql").write_bytes(entete + p.stdout)
    print(f"referentiel.sql regenere depuis {source} ({len(REFERENTIEL)} tables).")


def main():
    args = sys.argv[1:]
    infra = Infra(args)
    if "--referentiel-depuis" in args:
        regenerer_referentiel(infra, args[args.index("--referentiel-depuis") + 1])
        return 0

    import scenarios
    valeurs = {"--hote", "--utilisateur", "--motdepasse", "--port", "--cible"}
    choisis = [a for i, a in enumerate(args)
               if not a.startswith("--") and (i == 0 or args[i - 1] not in valeurs)]
    liste = [s for s in scenarios.SCENARIOS if not choisis or s.__name__.removeprefix("scenario_") in choisis]
    # UN NOM INCONNU N'EST PAS UN SUCCES (audit v5, U16) : « 0/0 scenarios
    # passent » se lisait comme un banc vert.
    connus = {s.__name__.removeprefix("scenario_") for s in scenarios.SCENARIOS}
    inconnus = [c for c in choisis if c not in connus]
    if inconnus:
        sys.exit(f"scenario(s) inconnu(s) : {', '.join(inconnus)}. Connus : {', '.join(sorted(connus))}")
    # LE PORT DOIT ETRE LIBRE : un serveur deja la (un banc precedent, un essai)
    # repondrait a la place de celui du banc, sur une autre base.
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sonde:
        sonde.settimeout(1)
        if sonde.connect_ex(("127.0.0.1", infra.port)) == 0:
            sys.exit(f"le port {infra.port} est deja occupe : arretez ce qui l'ecoute, ou passez --port.")
    for nom, chemin in (("serveur", infra.binaire), ("admin", infra.admin)):
        if not chemin.exists():
            sys.exit(f"binaire {nom} introuvable : {chemin} (cargo build --bins, ou --cible)")

    debut = time.time()
    print(f"banc : base {infra.base}, serveur sur 127.0.0.1:{infra.port}")
    resultats = []
    try:
        infra.batir()
        infra.demarrer()
        client = Client(f"http://127.0.0.1:{infra.port}")
        for s in liste:
            t0 = time.time()
            try:
                s(client, infra)
                resultats.append((s.__name__, None))
                print(f"  ok     {s.__name__.removeprefix('scenario_'):<28} {time.time() - t0:5.1f} s")
            except Exception as e:  # un scenario en echec n'arrete pas les autres
                resultats.append((s.__name__, e))
                print(f"  ECHEC  {s.__name__.removeprefix('scenario_'):<28} {e}")
                if not isinstance(e, Echec):
                    traceback.print_exc()
    finally:
        infra.arreter("--garder" in args)
    echecs = [n for n, e in resultats if e]
    print(f"\n{len(resultats) - len(echecs)}/{len(resultats)} scenarios passent "
          f"({time.time() - debut:.0f} s)." + (f" Base gardee : {infra.base}" if "--garder" in args else ""))
    return 1 if echecs else 0


if __name__ == "__main__":
    sys.path.insert(0, str(ICI))
    sys.exit(main())
