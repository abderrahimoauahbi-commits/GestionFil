# -*- coding: utf-8 -*-
"""
Portage du service Rust de SQLite vers PostgreSQL.

POURQUOI UN SCRIPT ET NON UNE EDITION A LA MAIN. 944 marqueurs de parametres
repartis dans 22 fichiers : a la main, l'erreur n'est pas probable, elle est
certaine. Et elle serait SILENCIEUSE — un `?3` devenu `$2` compile, s'execute,
et ecrit la mauvaise valeur dans la mauvaise colonne.

Le script est aussi la trace de ce qui a ete change, et permet de rejouer le
portage si une correction arrive cote SQLite avant la bascule.

CE QU'IL FAIT
-------------
1. LES MARQUEURS. SQLite ecrit `?1`, PostgreSQL `$1`. La numerotation est
   identique — c'est la seule chance de ce portage — donc la substitution est
   positionnelle et sure. On ne touche QUE ce qui est a l'interieur d'une
   chaine de caracteres : un `?` de Rust (`Option`, operateur d'erreur) n'est
   jamais suivi d'un chiffre, mais on ne prend pas le risque.

2. LES FONCTIONS DE DATE. `julianday(a) - julianday(b)` devient une
   soustraction de dates, `strftime('%Y-%m', x)` un `substr` — memes regles
   que le portage SQL, memes justifications.

3. LES TYPES sqlx. `SqlitePool` -> `PgPool`, `SqliteRow` -> `PgRow`,
   `SqliteConnection` -> `PgConnection`, `sqlx::Sqlite` -> `sqlx::Postgres`.

CE QU'IL NE FAIT PAS, ET QUI EST FAIT A LA MAIN
-----------------------------------------------
`db.rs`, `json.rs` et `sauvegarde.rs` changent de LOGIQUE, pas seulement de
vocabulaire : ouverture du pool, decodage des types, sauvegarde. Les traduire
mecaniquement produirait du code qui compile et se comporte autrement. Ils sont
exclus ici et repris a la main.

Usage :
    python porter_rust.py            # montre ce qui changerait
    python porter_rust.py --ecrire   # applique
"""
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src"

# Ces trois-la changent de logique : voir le commentaire de tete.
A_LA_MAIN = {"db.rs", "json.rs", "sauvegarde.rs"}


def marqueurs(texte):
    """`?N` -> `$N`, uniquement a l'interieur des chaines Rust.

    On parcourt le fichier en suivant l'etat « dans une chaine ou non », en
    tenant compte des chaines brutes `r"..."` et `r#"..."#` qui abondent dans
    les requetes SQL. Une expression reguliere globale toucherait aussi le `?`
    de `Option<T>` dans un commentaire de doc.
    """
    sortie, i, n = [], 0, len(texte)
    while i < n:
        c = texte[i]

        # Chaine brute : r"..." ou r#"..."#
        m = re.match(r'r(#*)"', texte[i:])
        if m:
            diese = m.group(1)
            fin_motif = '"' + diese
            debut = i + len(m.group(0))
            fin = texte.find(fin_motif, debut)
            fin = fin if fin >= 0 else n
            sortie.append(texte[i:debut])
            sortie.append(re.sub(r"\?(\d+)", r"$\1", texte[debut:fin]))
            sortie.append(fin_motif)
            i = fin + len(fin_motif)
            continue

        # Chaine ordinaire
        if c == '"':
            j = i + 1
            while j < n:
                if texte[j] == "\\":
                    j += 2
                    continue
                if texte[j] == '"':
                    break
                j += 1
            sortie.append('"')
            sortie.append(re.sub(r"\?(\d+)", r"$\1", texte[i + 1:j]))
            sortie.append('"')
            i = j + 1
            continue

        sortie.append(c)
        i += 1
    return "".join(sortie)


def dates(texte):
    """Memes conversions que le portage SQL, memes justifications."""
    # `julianday(A) - julianday(B)` -> `(A::date - B::date)`
    def jour(e):
        e = e.strip()
        if e in ("'now'", "date('now')"):
            return "current_date"
        m = re.fullmatch(r"date\((.*)\)", e, re.S)
        if m:
            e = m.group(1).strip()
        return "(%s)::date" % e

    def paire(m):
        return "(%s - %s)" % (jour(m.group(1)), jour(m.group(2)))

    texte = re.sub(r"julianday\(([^()]*(?:\([^()]*\))?[^()]*)\)\s*-\s*"
                   r"julianday\(([^()]*(?:\([^()]*\))?[^()]*)\)",
                   paire, texte)

    texte = re.sub(r"strftime\(\s*'%Y-%m'\s*,\s*'now'\s*\)",
                   "to_char(current_date, 'YYYY-MM')", texte)
    texte = re.sub(r"strftime\(\s*'%Y-%m'\s*,\s*([^()]+?)\)",
                   r"substr(\1, 1, 7)", texte)
    texte = texte.replace("date('now')", "to_char(current_date, 'YYYY-MM-DD')")
    return texte


def types(texte):
    """Le vocabulaire sqlx."""
    for avant, apres in (
        ("SqlitePool", "PgPool"),
        ("SqliteRow", "PgRow"),
        ("SqliteConnection", "PgConnection"),
        ("SqliteQueryResult", "PgQueryResult"),
        ("sqlx::Sqlite", "sqlx::Postgres"),
        ("sqlx::sqlite", "sqlx::postgres"),
        ("Sqlite>", "Postgres>"),
    ):
        texte = texte.replace(avant, apres)
    return texte


def main():
    ecrire = "--ecrire" in sys.argv
    total_m, total_d, touches = 0, 0, 0

    for f in sorted(SRC.rglob("*.rs")):
        if f.name in A_LA_MAIN:
            print("  %-36s laisse a la main" % f.relative_to(SRC.parent))
            continue

        avant = f.read_text(encoding="utf-8")
        apres = types(dates(marqueurs(avant)))
        if apres == avant:
            continue

        nb_m = len(re.findall(r"\?\d+", avant)) - len(re.findall(r"\?\d+", apres))
        nb_d = (avant.count("julianday") - apres.count("julianday")
                + avant.count("strftime") - apres.count("strftime"))
        print("  %-36s %4d marqueurs, %d fonctions de date"
              % (f.relative_to(SRC.parent), nb_m, nb_d))
        total_m += nb_m
        total_d += nb_d
        touches += 1
        if ecrire:
            f.write_text(apres, encoding="utf-8")

    print("\n%d fichiers, %d marqueurs, %d fonctions de date%s"
          % (touches, total_m, total_d, "" if ecrire else "  (essai a blanc)"))
    if not ecrire:
        print("Relancer avec --ecrire pour appliquer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
