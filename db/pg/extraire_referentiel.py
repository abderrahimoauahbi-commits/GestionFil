# -*- coding: utf-8 -*-
"""
Extrait le REFERENTIEL de la base vivante et en fait un seed PostgreSQL.

CE QUI EST PRIS, ET CE QUI NE L'EST PAS
---------------------------------------
Est pris tout ce qui DECRIT l'entreprise et sa matiere : fournisseurs,
references, groupes d'equivalence, qualites, recettes, taux de change,
magasins, parametres. Ces donnees ont ete importees du classeur Excel
d'origine puis verifiees ligne a ligne — 301 lignes de recette, 812 couples
de besoins MRP, tous identiques au classeur.

N'est PAS pris tout ce qui RACONTE une operation : mouvements, receptions,
bons de commande, transferts, inventaires, plans, journal d'audit. Le grand
livre est immuable (regle R03) : un bon de commande d'essai entre en
production n'en sort plus jamais. Le stock reel s'ouvre le jour du demarrage,
par un inventaire initial.

`historique_prix` EST PRIS, et c'est le seul choix discutable de la liste.
Ce n'est pas un document d'exploitation — il ne bouge aucun stock, ne se
valide pas, ne se solde pas — mais un historique de tarifs, qui alimente
l'analyse de derive des prix et la part imputable au change. L'ecarter
priverait le premier exercice de toute base de comparaison. Il se retire en
une ligne si vous preferez partir vierge.

POURQUOI DEPUIS SQLITE ET NON DEPUIS L'EXCEL
--------------------------------------------
Les deux contiennent la meme chose, mais la base vivante contient la version
VERIFIEE : l'import a ete compare au classeur cellule par cellule, et les
ecarts trouves (conversions d'unites, arrondis de CMUP) ont ete tranches. Ce
travail ne se refait pas gratuitement.

Usage :
    python extraire_referentiel.py                 # ecrit seed_100_referentiel_reel.sql
    python extraire_referentiel.py --sans-prix     # sans l'historique de prix
"""
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "gestionfil.db"
SORTIE = Path(__file__).resolve().parent / "seed_100_referentiel_reel.sql"

# L'ordre est celui des dependances : une reference cite un fournisseur, une
# recette cite une reference et une qualite. Le renverser ferait echouer les
# cles etrangeres — sans rien apprendre d'utile.
TABLES = [
    ("devise", ["code_devise"]),
    ("taux_change", ["id_taux"]),
    ("categorie_matiere", ["code_categorie"]),
    ("role_bom", ["code_role"]),
    ("magasin", ["code_magasin"]),
    ("parametre", ["code_parametre"]),
    ("fournisseur", ["code_fournisseur"]),
    ("contact_fournisseur", ["id_contact"]),
    ("reference", ["code_reference"]),
    ("groupe_equiv", ["code_groupe_equiv"]),
    ("reference_groupe_equiv", ["code_groupe_equiv", "code_reference"]),
    ("qualite", ["code_qualite"]),
    ("ligne_qualite", ["id_ligne_qualite"]),
    ("recette", ["id_recette"]),
    ("historique_prix", ["id_histo_prix"]),
]


# TABLES VIDEES AVANT INSERTION.
#
# Ces deux-la sont deja peuplees par les seeds de reference, avec des cles
# TECHNIQUES differentes : `ON CONFLICT (id_taux)` ne se declenche donc jamais,
# et les lignes s'AJOUTENT au lieu de se remplacer. Pour `taux_change`, le
# declencheur RG-09 le detecte et refuse — periodes chevauchantes. Pour
# `ligne_qualite`, rien ne l'aurait detecte : la base aurait porte deux jeux de
# densites pour les memes qualites, et le calcul de recette aurait double.
#
# Aucune cle etrangere ne pointe vers elles : les vider est sans effet de bord.
PURGER = {"taux_change", "ligne_qualite"}


def litteral(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int,)):
        return str(v)
    if isinstance(v, float):
        # `repr` garde la precision exacte ; `str` arrondirait un CMUP.
        return repr(v)
    if isinstance(v, bytes):
        return "'\\x" + v.hex() + "'::bytea"
    return "'" + str(v).replace("'", "''") + "'"


def main():
    sans_prix = "--sans-prix" in sys.argv
    if not SOURCE.exists():
        print("base source introuvable : %s" % SOURCE)
        return 1

    cx = sqlite3.connect("file:%s?mode=ro" % SOURCE.as_posix(), uri=True)
    cx.row_factory = sqlite3.Row

    morceaux = [
        "-- =============================================================================",
        "-- REFERENTIEL REEL — Polyfashions Carpet Morocco",
        "-- -----------------------------------------------------------------------------",
        "-- Extrait de la base vivante le %s" % datetime.now(timezone.utc)
        .strftime("%Y-%m-%d %H:%M UTC"),
        "-- par pg/extraire_referentiel.py. NE PAS MODIFIER A LA MAIN : reextraire.",
        "--",
        "-- Contient ce qui DECRIT l'entreprise. Ne contient AUCUN document",
        "-- d'exploitation : ni mouvement, ni reception, ni bon de commande, ni plan.",
        "-- Le stock reel s'ouvre par un inventaire initial, le jour du demarrage.",
        "--",
        "-- Chaque insertion est IDEMPOTENTE : rejouer ce fichier ne cree pas de",
        "-- doublon et ne perd pas les modifications faites depuis.",
        "-- =============================================================================",
        "",
        "BEGIN;",
        "",
    ]

    total = 0
    for table, cles in TABLES:
        if sans_prix and table == "historique_prix":
            morceaux.append("-- historique_prix : ecarte a la demande (--sans-prix)\n")
            continue

        try:
            lignes = cx.execute("SELECT * FROM %s" % table).fetchall()
        except sqlite3.OperationalError as ex:
            morceaux.append("-- %s : %s\n" % (table, ex))
            continue

        if not lignes:
            morceaux.append("-- %s : vide dans la source\n" % table)
            continue

        # Les colonnes GENEREES ne s'inserent pas : PostgreSQL les calcule.
        info = cx.execute("PRAGMA table_xinfo(%s)" % table).fetchall()
        generees = {r["name"] for r in info if r["hidden"] in (2, 3)}
        colonnes = [c for c in lignes[0].keys() if c not in generees]

        morceaux.append("-- --- %s : %d lignes %s" % (table, len(lignes), "-" * max(0, 40 - len(table))))
        if table in PURGER:
            morceaux.append("-- Videe d'abord : les seeds la peuplent avec d'autres cles")
            morceaux.append("-- techniques, donc ON CONFLICT ne s'y declencherait jamais.")
            morceaux.append("DELETE FROM %s;" % table)
        morceaux.append("INSERT INTO %s (%s) VALUES" % (table, ", ".join(colonnes)))

        # Les qualites entrent en BROUILLON : leurs lignes de composition
        # n'arrivent qu'apres, et la regle metier interdit la mise en service
        # d'une qualite sans composition.
        force_brouillon = table == "qualite" and "statut" in colonnes
        i_statut = colonnes.index("statut") if force_brouillon else -1

        def cellule(l, c, k):
            return "'BROUILLON'" if k == i_statut else litteral(l[c])

        valeurs = [
            "  (%s)" % ", ".join(cellule(l, c, k) for k, c in enumerate(colonnes))
            for l in lignes
        ]
        morceaux.append(",\n".join(valeurs))
        majs = [c for c in colonnes if c not in cles]
        if majs:
            morceaux.append("ON CONFLICT (%s) DO UPDATE SET" % ", ".join(cles))
            morceaux.append(",\n".join("  %s = excluded.%s" % (c, c) for c in majs) + ";")
        else:
            morceaux.append("ON CONFLICT (%s) DO NOTHING;" % ", ".join(cles))
        morceaux.append("")
        total += len(lignes)

    # --- Mise en service, une fois les compositions en place -----------------
    statuts = {}
    try:
        for l in cx.execute("SELECT code_qualite, statut FROM qualite").fetchall():
            statuts.setdefault(l["statut"], []).append(l["code_qualite"])
    except sqlite3.OperationalError:
        pass
    if statuts:
        morceaux.append("-- --- mise en service des qualites " + "-" * 26)
        morceaux.append("-- Le declencheur verifie ICI que chaque qualite a bien une")
        morceaux.append("-- composition. C'est le seul moment ou la verification a un sens.")
        for statut, codes in sorted(statuts.items()):
            liste = ", ".join("'%s'" % c for c in sorted(codes))
            morceaux.append("UPDATE qualite SET statut = '%s' WHERE code_qualite IN (%s);"
                            % (statut, liste))
        morceaux.append("")

    morceaux += ["COMMIT;", ""]
    SORTIE.write_text("\n".join(morceaux), encoding="utf-8")
    cx.close()

    print("%s\n  %d lignes, %d Ko" % (SORTIE.name, total, SORTIE.stat().st_size // 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
