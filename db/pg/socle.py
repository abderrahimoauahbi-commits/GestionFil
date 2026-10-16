# -*- coding: utf-8 -*-
"""
Le SOCLE : le schema complet d'une base migree, pour en batir une neuve.

POURQUOI. Les fichiers 001 a 018 decrivent le schema d'origine ; tout ce qui
est venu ensuite (lots, machines, import, regles du 08/10…) n'existe qu'en
migrations. Et l'historique des migrations ne se rejoue pas sur une base
neuve : plusieurs chargent les donnees reelles du moment (catalogue du 16/09,
stock initial du 18/09, parc machine du 20/09) et les suivantes en dependent
— vingt echecs sur quatre-vingt-quinze au 08/10/2026. Une base neuve ne
pouvait donc pas etre construite ; un banc de tests non plus.

Le socle se GENERE depuis une base entierement migree (une copie, jamais la
base vivante) :
    socle/schema.sql          le schema exact (tables, vues, fonctions,
                              declencheurs, proprietaires), par pg_dump ;
    socle/configuration.sql   les tables de configuration du systeme (droits,
                              champs, parametres, types et motifs, transitions,
                              devises, categories, magasins), sans declencheurs ;
    socle/inclus.txt          les migrations comprises, avec leur empreinte.

Une base neuve se bat ensuite par `charger.py --socle` : socle, journal des
migrations rempli (mode SOCLE), puis `migrer.py` pour les migrations venues
apres. Le metier (references, fournisseurs, qualites, stock) vient toujours du
classeur, par `gestionfil-import`.

Usage :
    python socle.py --depuis gestionfil_p1        # regenere db/pg/socle/
Options : --hote, --utilisateur (postgres), --motdepasse (a defaut PGPASSWORD).
"""
import hashlib
import os
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
SOCLE = ICI / "socle"
PG_DUMP = os.environ.get("PG_DUMP", r"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe")
PSQL = os.environ.get("PSQL", r"C:\Program Files\PostgreSQL\18\bin\psql.exe")

# La configuration DU SYSTEME : ce qu'une base neuve doit avoir pour que les
# ecrans, les droits et les regles fonctionnent. Pas les donnees de
# l'entreprise (references, fournisseurs, comptes, mouvements).
CONFIGURATION = [
    "categorie_matiere",
    # Les couleurs internes, les familles et les coefficients de saison : une
    # base neuve en a besoin des le premier ecran (audit v5, T15). Les familles
    # apres les categories, qu'elles referencent.
    "couleur",
    "famille",
    "saison_mois",
    "champ_configurable",
    "devise",
    "machine_motif",
    "magasin",
    "modele_droit_champ",
    "motif_ligne",
    "motif_mouvement",
    "parametre",
    "parametres_frais",
    "permission",
    "role_bom",
    "role_utilisateur",
    "transition_statut",
    "type_mouvement",
]


def main():
    args = sys.argv[1:]

    def option(nom, defaut=None):
        return args[args.index(nom) + 1] if nom in args else defaut

    source = option("--depuis")
    if not source:
        sys.exit("--depuis <base> est obligatoire (une copie entierement migree).")
    # Ni la base vivante, ni celle du serveur de demonstration sur 8080 (audit
    # v5, T9) : une copie migree, faite pour cela.
    if source in ("gestionfil", "gestionfil_demo"):
        sys.exit(f"Pas {source} : generez le socle depuis une copie (pg_dump -> base de repetition).")
    cible = ["-h", option("--hote", "127.0.0.1"), "-U", option("--utilisateur", "postgres"), "-d", source]
    env = dict(os.environ)
    mdp = option("--motdepasse", os.environ.get("PGPASSWORD"))
    if mdp:
        env["PGPASSWORD"] = mdp

    # La source doit etre a jour : le socle dit « toutes ces migrations ».
    migrations = sorted((ICI / "migrations").glob("*.sql"), key=lambda p: p.name)
    p = subprocess.run([PSQL, *cible, "-tA", "-c",
                        "SELECT fichier FROM migration_appliquee ORDER BY 1"],
                       capture_output=True, text=True, env=env)
    if p.returncode != 0:
        sys.exit(f"{source} n'a pas de journal des migrations : {p.stderr.strip()}")
    inscrites = set(p.stdout.split())
    manquantes = [m.name for m in migrations if m.name not in inscrites]
    if manquantes:
        sys.exit(f"{source} n'a pas toutes les migrations ({', '.join(manquantes)}) : "
                 f"python migrer.py --base {source}")

    SOCLE.mkdir(exist_ok=True)
    entete = (f"-- SOCLE genere par db/pg/socle.py depuis une copie entierement migree.\n"
              f"-- Ne pas editer a la main : regenerer (python socle.py --depuis <copie>).\n"
              f"-- Migrations comprises : {len(migrations)} (voir inclus.txt).\n\n")

    schema = subprocess.run([PG_DUMP, *cible, "--schema-only", "--no-privileges",
                             ],
                            capture_output=True, env=env)
    if schema.returncode != 0:
        sys.exit(schema.stderr.decode("utf-8", "replace"))
    (SOCLE / "schema.sql").write_bytes(entete.encode() + schema.stdout)

    conf = [PG_DUMP, *cible, "--data-only", "--disable-triggers", "--no-owner"]
    for t in CONFIGURATION:
        conf += ["-t", f"public.{t}"]
    donnees = subprocess.run(conf, capture_output=True, env=env)
    if donnees.returncode != 0:
        sys.exit(donnees.stderr.decode("utf-8", "replace"))
    (SOCLE / "configuration.sql").write_bytes(entete.encode() + donnees.stdout)

    with open(SOCLE / "inclus.txt", "w", encoding="utf-8", newline="\n") as fh:
        for m in migrations:
            # Aux fins de ligne Unix, comme migrer.py : Git les convertit selon le poste.
            fh.write(f"{m.name} {hashlib.sha256(m.read_bytes().replace(b'\r\n', b'\n')).hexdigest()}\n")

    print(f"socle regenere depuis {source} : {len(migrations)} migrations comprises, "
          f"{len(CONFIGURATION)} tables de configuration.")


if __name__ == "__main__":
    main()
