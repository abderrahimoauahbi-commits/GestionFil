# -*- coding: utf-8 -*-
"""
Joue les migrations qu'une base n'a pas encore recues, et les inscrit.

POURQUOI. Les migrations se jouaient a la main (`psql -f`), une par une, et
rien ne disait lesquelles une base avait : un oubli ne se voyait qu'en
« erreur interne ». La table `migration_appliquee` (migration
2026-10-08c_journal_migrations.sql) les inscrit ; ce script y lit ce qui reste
a jouer, joue chaque fichier dans l'ordre des noms (les noms sont dates), et
l'inscrit avec son empreinte. Il s'arrete au premier echec : la migration
fautive est en transaction, la base reste dans l'etat precedent.

Usage (la base est TOUJOURS nommee : pas de defaut qui viserait la production) :
    python migrer.py --base gestionfil_essai --lister          # ce qui reste a jouer
    python migrer.py --base gestionfil_essai                   # le jouer
    python migrer.py --base gestionfil_essai --verifier        # fichiers modifies apres coup
    python migrer.py --base gestionfil --marquer-jusqua 2026-10-08c_journal_migrations.sql
        # une base existante, migree a la main : inscrire sans rien rejouer
    python migrer.py --marquer-jusqua 2026-10-08c_journal_migrations.sql --imprimer > marquage.sql
        # le meme marquage en SQL, pour le serveur (cat marquage.sql | sudo -u postgres psql -d gestionfil)

Options de connexion : --hote (127.0.0.1), --utilisateur (postgres),
--motdepasse (a defaut PGPASSWORD). En production, les migrations se jouent en
`postgres` (voir deploiement/README.md).
"""
import hashlib
import os
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
MIGRATIONS = ICI / "migrations"
PSQL = os.environ.get("PSQL", r"C:\Program Files\PostgreSQL\18\bin\psql.exe")
JOURNAL = "2026-10-08c_journal_migrations.sql"


def empreinte(chemin: Path) -> str:
    # Sur le contenu aux fins de ligne Unix : Git les convertit selon le poste,
    # et un fichier identique ne doit pas paraitre modifie.
    return hashlib.sha256(chemin.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


class Base:
    def __init__(self, base, hote, utilisateur, motdepasse):
        self.cible = ["-U", utilisateur, "-h", hote, "-d", base]
        self.env = dict(os.environ)
        if motdepasse:
            self.env["PGPASSWORD"] = motdepasse

    def requete(self, sql: str) -> list[str]:
        p = subprocess.run([PSQL, *self.cible, "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql],
                           capture_output=True, text=True, env=self.env)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip())
        return [l for l in p.stdout.splitlines() if l.strip()]

    def jouer(self, chemin: Path) -> tuple[int, str]:
        # Par l'entree standard, comme sur le serveur (le compte postgres ne lit
        # pas toujours le repertoire du fichier).
        with open(chemin, "rb") as fh:
            p = subprocess.run([PSQL, *self.cible, "-v", "ON_ERROR_STOP=1", "-q"],
                               stdin=fh, capture_output=True, env=self.env)
        sortie = (p.stderr or b"").decode("utf-8", "replace").strip()
        return p.returncode, sortie


def fichiers() -> list[Path]:
    return sorted(MIGRATIONS.glob("*.sql"), key=lambda p: p.name)


def deja(base: Base) -> dict[str, str]:
    existe = base.requete("SELECT to_regclass('public.migration_appliquee') IS NOT NULL")
    if existe != ["t"]:
        return {}
    return dict(l.split("|", 1) for l in base.requete(
        "SELECT fichier, COALESCE(empreinte, '') FROM migration_appliquee"))


def inscrire(base: Base, nom: str, emp: str, mode: str):
    base.requete(
        "INSERT INTO migration_appliquee (fichier, empreinte, mode) "
        f"VALUES ('{nom}', '{emp}', '{mode}') ON CONFLICT (fichier) DO NOTHING")


def main():
    args = sys.argv[1:]

    def option(nom, defaut=None):
        return args[args.index(nom) + 1] if nom in args else defaut

    limite = option("--marquer-jusqua")
    if limite and "--imprimer" in args:
        # Pour le serveur, ou les migrations passent par `sudo -u postgres psql` :
        # le SQL du marquage, a envoyer de la meme facon. Aucune connexion ici.
        noms = [f for f in fichiers() if f.name <= limite]
        print("-- Inscription des migrations jouees a la main, jusqu'a " + limite)
        print("INSERT INTO migration_appliquee (fichier, empreinte, mode) VALUES")
        print(",\n".join(f"  ('{f.name}', '{empreinte(f)}', 'MARQUEE')" for f in noms))
        print("ON CONFLICT (fichier) DO NOTHING;")
        return

    nom_base = option("--base")
    if not nom_base:
        sys.exit("--base est obligatoire : ce script ne choisit pas la base a votre place.")
    base = Base(nom_base, option("--hote", "127.0.0.1"), option("--utilisateur", "postgres"),
                option("--motdepasse", os.environ.get("PGPASSWORD")))

    connues = deja(base)
    tous = fichiers()

    if "--verifier" in args:
        modifies = [f.name for f in tous if connues.get(f.name) and connues[f.name] != empreinte(f)]
        manquants = [f.name for f in tous if f.name not in connues]
        for n in modifies:
            print(f"  MODIFIE depuis son application : {n}")
        for n in manquants:
            print(f"  A JOUER : {n}")
        print(f"{len(tous) - len(manquants)} inscrite(s), {len(manquants)} a jouer, {len(modifies)} modifiee(s).")
        sys.exit(1 if manquants else 0)

    if limite:
        if limite not in [f.name for f in tous]:
            sys.exit(f"{limite} : fichier inconnu dans {MIGRATIONS}")
        if not connues:
            # Le journal lui-meme d'abord : il cree la table.
            code, sortie = base.jouer(MIGRATIONS / JOURNAL)
            if code != 0:
                sys.exit(f"{JOURNAL} : {sortie}")
        n = 0
        for f in tous:
            if f.name > limite:
                break
            if f.name not in connues:
                inscrire(base, f.name, empreinte(f), "MARQUEE")
                n += 1
        print(f"{n} migration(s) inscrite(s) sans etre rejouees, jusqu'a {limite}.")
        return

    if base.requete("SELECT to_regclass('public.migration_appliquee') IS NOT NULL") != ["t"]:
        # Sans journal, « tout reste a jouer » serait faux et dangereux : la
        # base a ete migree a la main. On l'inscrit d'abord, explicitement.
        sys.exit(
            f"{nom_base} n'a pas de journal des migrations. Inscrivez ce qu'elle a deja recu :\n"
            f"    python migrer.py --base {nom_base} --marquer-jusqua <derniere migration jouee a la main>"
        )
    a_jouer = [f for f in tous if f.name not in connues]
    if "--lister" in args:
        for f in a_jouer:
            print(f"  {f.name}")
        print(f"{len(a_jouer)} migration(s) a jouer sur {nom_base}.")
        return
    if not a_jouer:
        print(f"{nom_base} est a jour ({len(connues)} migrations inscrites).")
        return
    for f in a_jouer:
        code, sortie = base.jouer(f)
        if code != 0:
            print(f"  ECHEC {f.name}\n      {sortie}")
            sys.exit(f"Arret au premier echec : {f.name} n'est pas inscrite, la base garde l'etat precedent.")
        # Le journal existe des que sa propre migration est passee.
        inscrire(base, f.name, empreinte(f), "JOUEE")
        avis = [l for l in sortie.splitlines() if "NOTICE" in l or "AVERTISSEMENT" in l or "WARNING" in l]
        print(f"  ok {f.name}" + (f"\n      {avis[0]}" if avis else ""))
    print(f"{len(a_jouer)} migration(s) jouee(s) sur {nom_base}.")


if __name__ == "__main__":
    main()
