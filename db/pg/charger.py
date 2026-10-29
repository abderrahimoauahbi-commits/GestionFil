# -*- coding: utf-8 -*-
"""
Charge les vues, controles et declencheurs portes dans PostgreSQL.

POURQUOI PAS UN SIMPLE `psql -f`. Les vues du schema se referencent en avant :
`011_vues.sql` cite `v_controles`, defini dans `012_controles.sql`, qui cite
lui-meme des vues de `011`. SQLite l'accepte — il ne resout le nom qu'a la
lecture, ce qui a l'inconvenient de laisser passer une vue definitivement
cassee. PostgreSQL resout a la CREATION, donc l'ordre compte.

Reordonner les fichiers a la main serait fragile et faux : le graphe n'est pas
un arbre, et il changera. On charge donc PAR PASSES : a chaque tour, on tente
tout ce qui reste et on garde ce qui passe. Tant qu'une passe fait progresser,
on recommence. Quand plus rien ne progresse, ce qui reste est une VRAIE erreur,
pas un probleme d'ordre — et on l'affiche.

Usage (`--base` est OBLIGATOIRE : aucune base n'est choisie par defaut) :
    python charger.py --base gestionfil_essai
    python charger.py --base gestionfil_essai --hote 192.168.1.140 --utilisateur gestionfil

    python charger.py --base <base> --production            # comptes reels, referentiel a importer
    python charger.py --base <base> --production --referentiel-fige   # + la photo du 2026-09-02
    python charger.py --base neuve --socle [--comptes]   # base COMPLETE depuis socle/
                                                         # (puis python migrer.py --base neuve)

Apres `--production`, le referentiel s'importe depuis le classeur :
    gestionfil-import --simuler      puis      gestionfil-import
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ICI = Path(__file__).resolve().parent

FICHIERS = [
    "001_schema_referentiels.sql",
    "002_schema_securite.sql",
    "003_schema_catalogue.sql",
    "004_schema_production.sql",
    "005_schema_planification.sql",
    "006_schema_achats.sql",
    "007_schema_receptions.sql",
    "008_schema_stock.sql",
    "009_schema_pilotage.sql",
    "009b_schema_machines.sql",
    "099_cles_differees.sql",
    "010_declencheurs.sql",
    "010b_declencheurs_logique.sql",
    "011_vues.sql",
    "012_controles.sql",
    "013_vues_cockpit.sql",
    "015_vues_coherence.sql",
    "016_controles_classeur.sql",
    "017a_table_frais_approche.sql",
    "017_vues_analyse.sql",
    "018_schema_import.sql",
]

# Les seeds sont SEPARES du schema, et l'ordre y est EXPLICITE.
#
# `004_qualites` depend de `002_securite` ; `003_roles_2026` reecrit la grille
# de droits que `002_securite` vient de poser. Les decouvrir par tri
# alphabetique inverserait ces dependances sans le dire — et une grille de
# droits inversee ne se voit pas : elle donne simplement acces a ce qu'elle
# devait masquer.
SEEDS = [
    # 1. Les referentiels : devises, magasins, types de mouvement, parametres.
    "seed_001_referentiels.sql",
    # 2. La securite : catalogue des champs, roles d'origine, permissions.
    "seed_002_securite.sql",
    # 3. Les qualites, qui referencent les roles BOM du point 1.
    "seed_004_qualites.sql",
    # 4. LES ROLES 2026 AVANT LES CHAMPS QUI LES CITENT. `003` cree DIRECTION,
    #    ADMIN, ASSISTANTE et MAGASIN ; `004` et `005` declarent des champs et
    #    derivent leurs droits POUR CES ROLES. Dans l'autre sens, la cle
    #    etrangere refuse — et c'est heureux : une grille de droits derivee sur
    #    des roles absents serait silencieusement vide.
    "seed_003_roles_2026.sql",
    # 5. Les champs declares apres coup, chacun derivant ses propres droits.
    "seed_004_champs_matrice.sql",
    "seed_005_champs_analyse.sql",
    # 6. Les regles du 08/10/2026 : parametres, droits LOTS, montants declares.
    "seed_006_regles_2026_10.sql",
]

# Ce qui distingue une base de PRODUCTION d'une base de recette : les six
# comptes nominatifs de l'entreprise a la place des comptes de fonction, et son
# identite legale. Charge par `--production`, jamais par defaut.
PRODUCTION = [
    "seed_110_comptes_production.sql",
    "seed_120_entreprise.sql",
    "seed_130_import.sql",
    "seed_140_couleur_famille.sql",
]

# LE REFERENTIEL NE VIENT PLUS D'ICI.
#
# `seed_100_referentiel_reel.sql` est une PHOTOGRAPHIE, extraite un jour donne
# de la base de recette. Le classeur « GESTION FIL.xlsx » est la source vivante :
# c'est lui que l'entreprise tient a jour, et `gestionfil-import` sait le lire —
# catalogue, fournisseurs, qualites, recettes et photo de stock, sans
# l'historique ni les plans.
#
# Charger les deux ferait entrer en concurrence deux verites sur les memes
# references. Le fichier fige reste disponible derriere son propre drapeau, pour
# reproduire a l'identique l'etat d'un jour precis.
REFERENTIEL_FIGE = ["seed_100_referentiel_reel.sql"]

# LES DECLENCHEURS D'AUDIT SE POSENT EN DERNIER, apres les donnees.
#
# Poses avant, ils enregistrent le chargement lui-meme : onze mille lignes
# disant « admin a cree la reference PP-1500 » a la seconde ou le fichier est
# joue. Ce n'est pas une trace d'exploitation, c'est le bruit de l'installation,
# et il noierait les premieres vraies actions.
#
# On ne peut pas l'effacer apres coup : un declencheur interdit la suppression
# dans le journal d'audit — et c'est bien ainsi. La seule facon propre de ne pas
# auditer la reprise est de ne pas l'auditer.
AUDIT = ["014_audit_operations.sql"]

# Le psql de Windows s'il est la, sinon celui du PATH (Linux : serveur, CI).
# Meme regle que migrer.py.
_PSQL_WIN = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
PSQL = os.environ.get("PSQL", _PSQL_WIN if os.path.exists(_PSQL_WIN) else "psql")


def decouper(sql):
    """Decoupe un script en instructions.

    Le decoupage naif sur `;` casse les corps de fonctions PL/pgSQL, qui en
    contiennent. On respecte donc les delimiteurs `$$ ... $$` et les chaines.
    """
    instructions, courant, i = [], [], 0
    dollar = None
    while i < len(sql):
        if dollar:
            j = sql.find(dollar, i)
            if j < 0:
                courant.append(sql[i:])
                break
            courant.append(sql[i:j + len(dollar)])
            i = j + len(dollar)
            dollar = None
            continue
        c = sql[i]
        if c == "'":
            j = sql.find("'", i + 1)
            while j >= 0 and j + 1 < len(sql) and sql[j + 1] == "'":
                j = sql.find("'", j + 2)
            j = j if j >= 0 else len(sql) - 1
            courant.append(sql[i:j + 1])
            i = j + 1
            continue
        if c == "-" and sql[i:i + 2] == "--":
            j = sql.find("\n", i)
            j = j if j >= 0 else len(sql)
            courant.append(sql[i:j])
            i = j
            continue
        m = re.match(r"\$[A-Za-z_]*\$", sql[i:])
        if m:
            dollar = m.group(0)
            courant.append(dollar)
            i += len(dollar)
            continue
        if c == ";":
            courant.append(";")
            instructions.append("".join(courant))
            courant = []
            i += 1
            continue
        courant.append(c)
        i += 1
    if "".join(courant).strip():
        instructions.append("".join(courant))

    # NE PAS FILTRER SUR « commence par -- ». Chaque instruction du schema est
    # precedee de son bloc de commentaires, qui se retrouve donc EN TETE du
    # morceau : un filtre sur le premier caractere jetterait la moitie du
    # schema en croyant jeter des commentaires. On juge sur ce qui RESTE une
    # fois les lignes de commentaire retirees.
    def porte_du_code(s):
        return any(l.strip() and not l.strip().startswith("--") for l in s.split("\n"))

    return [s for s in instructions if porte_du_code(s)]


def jouer(instruction, base, hote, utilisateur, motdepasse):
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False,
                                     encoding="utf-8") as fh:
        fh.write(instruction)
        chemin = fh.name
    try:
        env = dict(os.environ)
        if motdepasse:
            env["PGPASSWORD"] = motdepasse
        p = subprocess.run(
            [PSQL, "-U", utilisateur, "-h", hote, "-d", base,
             "-v", "ON_ERROR_STOP=1", "-q", "-f", chemin],
            capture_output=True, text=True, env=env,
        )
        return p.returncode, (p.stderr or "").strip()
    finally:
        os.unlink(chemin)


def charger_socle(args, base, hote, utilisateur, motdepasse):
    """UNE BASE NEUVE ET COMPLETE, depuis le socle (voir socle.py).

    Le socle porte le schema exact d'une base entierement migree et sa
    configuration ; le journal des migrations les inscrit (mode SOCLE). Les
    migrations venues apres le socle se jouent ensuite par migrer.py. Avec
    `--comptes`, les comptes nominatifs et l'identite de l'entreprise
    (seed_110, seed_120). Le metier vient du classeur (gestionfil-import).
    """
    if base == "gestionfil" and "--confirmer-gestionfil" not in args:
        print("Refus : --socle construit une base NEUVE ; il ne se joue pas sur « gestionfil » "
              "sans --confirmer-gestionfil.")
        return 1
    socle = ICI / "socle"
    for nom in ("schema.sql", "configuration.sql"):
        code, err = jouer((socle / nom).read_text(encoding="utf-8"), base, hote, utilisateur, motdepasse)
        print("  %-30s %s" % ("socle/" + nom, "ok" if code == 0 else "ECHEC"))
        if code != 0:
            for l in err.split("\n"):
                if "ERREUR" in l or "ERROR" in l:
                    print("      %s" % l.strip())
            return 1
    valeurs = []
    for ligne in (socle / "inclus.txt").read_text(encoding="utf-8").splitlines():
        if ligne.strip():
            fichier, emp = ligne.split()
            valeurs.append("('%s', '%s', 'SOCLE')" % (fichier, emp))
    code, err = jouer("INSERT INTO migration_appliquee (fichier, empreinte, mode) VALUES %s "
                      "ON CONFLICT (fichier) DO NOTHING;" % ", ".join(valeurs),
                      base, hote, utilisateur, motdepasse)
    print("  %-30s %s" % ("journal (%d migrations)" % len(valeurs), "ok" if code == 0 else "ECHEC"))
    if code != 0:
        print("      " + err)
        return 1
    if "--comptes" in args:
        for nom in ("seed_110_comptes_production.sql", "seed_120_entreprise.sql"):
            code, err = jouer((ICI / nom).read_text(encoding="utf-8"), base, hote, utilisateur, motdepasse)
            print("  %-30s %s" % (nom, "ok" if code == 0 else "ECHEC"))
            if code != 0:
                for l in err.split("\n"):
                    if "ERREUR" in l or "ERROR" in l:
                        print("      %s" % l.strip())
                return 1
    # LES STATISTIQUES (10/10/2026) : une base remplie d'un coup n'en a pas tant que l'autovacuum n'est pas passe ; la supervision y prenait 46 s au lieu de 1,2 s.
    jouer("ANALYZE;", base, hote, utilisateur, motdepasse)
    print("\nSocle charge. Ensuite : python migrer.py --base %s" % base)
    return 0


def main():
    args = sys.argv[1:]

    def option(nom, defaut):
        return args[args.index(nom) + 1] if nom in args else defaut

    # `--help` NE TOUCHE A RIEN (17/10/2026). Ce script ne le connaissait pas :
    # il ignorait l'argument et chargeait le schema dans la base par defaut.
    if "-h" in args or "--help" in args:
        print(__doc__)
        return 0

    # PLUS DE BASE PAR DEFAUT (17/10/2026). Le defaut etait « gestionfil », la base
    # que CLAUDE.md interdit de toucher : un `python charger.py --help` y a lance
    # un chargement complet, arrete a temps — le journal PostgreSQL a prouve
    # qu'aucune instruction n'y etait arrivee. `migrer.py` refusait deja de
    # choisir a la place de l'utilisateur ; ce script fait desormais de meme.
    base = option("--base", None)
    if not base:
        print("--base est obligatoire : ce script ne choisit pas la base a votre place.")
        print("  python charger.py --base <base> [--socle | --seeds | --production]")
        print("  python charger.py --help")
        return 2
    hote = option("--hote", "127.0.0.1")
    utilisateur = option("--utilisateur", "postgres")
    motdepasse = option("--motdepasse", os.environ.get("PGPASSWORD", "toor"))

    if "--socle" in args:
        return charger_socle(args, base, hote, utilisateur, motdepasse)

    restant = []
    for nom in FICHIERS:
        chemin = ICI / nom
        if not chemin.exists():
            print("  ! absent : %s" % nom)
            continue
        for inst in decouper(chemin.read_text(encoding="utf-8")):
            restant.append((nom, inst))

    print("%d instructions a jouer sur %s@%s/%s\n" % (len(restant), utilisateur, hote, base))

    passe = 0
    while restant:
        passe += 1
        echecs, joues = [], 0
        for nom, inst in restant:
            code, err = jouer(inst, base, hote, utilisateur, motdepasse)
            if code == 0:
                joues += 1
            else:
                echecs.append((nom, inst, err))
        print("  passe %d : %d jouees, %d en attente" % (passe, joues, len(echecs)))
        if joues == 0:
            break
        restant = [(n, i) for n, i, _ in echecs]

    if restant:
        print("\n%d instructions bloquees — ce ne sont plus des problemes d'ordre :\n"
              % len(echecs))
        for nom, inst, err in echecs[:12]:
            titre = re.search(r"CREATE\s+(?:OR REPLACE\s+)?(\w+)\s+(?:IF NOT EXISTS\s+)?([\w.]+)",
                              inst, re.I)
            print("  %-26s %s" % (nom, titre.group(0) if titre else inst[:60].replace("\n", " ")))
            for l in err.split("\n"):
                if "ERREUR" in l or "ERROR" in l or "DETAIL" in l:
                    print("      %s" % l.strip())
        return 1

    # --- Les seeds, EN ENTIER --------------------------------------------
    # Un fichier, un processus psql, donc UNE session : c'est indispensable
    # pour `seed_002_securite.sql`, qui derive la grille de permissions a
    # travers une table TEMPORAIRE. Decoupee, elle mourrait avec la premiere
    # instruction.
    if "--seeds" in args or "--production" in args:
        liste = SEEDS + (PRODUCTION if "--production" in args else [])
        if "--referentiel-fige" in args:
            liste = liste + REFERENTIEL_FIGE
        print("\n--- donnees de reference ---")
        for nom in liste:
            chemin = ICI / nom
            if not chemin.exists():
                print("  ! absent : %s" % nom)
                continue
            code, err = jouer(chemin.read_text(encoding="utf-8"),
                              base, hote, utilisateur, motdepasse)
            print("  %-30s %s" % (nom, "ok" if code == 0 else "ECHEC"))
            if code != 0:
                for l in err.split("\n"):
                    if "ERREUR" in l or "ERROR" in l or "DETAIL" in l:
                        print("      %s" % l.strip())
                return 1

    # --- Les declencheurs d'audit, en dernier ------------------------------
    # Voir le commentaire de la liste AUDIT : poses avant les donnees, ils
    # auditeraient l'installation.
    print("\n--- declencheurs d'audit ---")
    for nom in AUDIT:
        chemin = ICI / nom
        for inst in decouper(chemin.read_text(encoding="utf-8")):
            code, err = jouer(inst, base, hote, utilisateur, motdepasse)
            if code != 0:
                print("  %-30s ECHEC" % nom)
                for l in err.split("\n"):
                    if "ERREUR" in l or "ERROR" in l:
                        print("      %s" % l.strip())
                return 1
        print("  %-30s ok" % nom)

    print("\nTout est charge.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
