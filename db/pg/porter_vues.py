# -*- coding: utf-8 -*-
"""
Portage SQLite -> PostgreSQL des vues, controles et declencheurs d'audit
(fichiers 011 a 017).

Le convertisseur des tables (`porter.py`) ne touchait que la DDL. Celui-ci
traite les REQUETES, ou les ecarts entre les deux moteurs ne sont pas dans la
syntaxe mais dans les FONCTIONS. Cinq familles, toutes verifiees sur les 73 vues
du schema :

1. LES DATES. Tout le code compare des dates par ordre lexicographique sur du
   texte ISO-8601 — c'est le choix de portage n°3 de `porter.py`, et il est
   conserve ici. `julianday(a) - julianday(b)` devient donc `(a::date - b::date)`,
   qui rend un ENTIER de jours en PostgreSQL, exactement comme la difference de
   deux jours juliens rendait un reel de jours en SQLite. Le resultat est
   identique tant qu'on compte des jours pleins, ce que fait tout le code.

2. LE FORMATAGE DE DATES. `strftime('%Y-%m', x)` devient `substr(x, 1, 7)` et
   non `to_char(x::timestamp, 'YYYY-MM')` : la donnee EST du texte ISO, la
   decouper est exact, gratuit, et ne peut pas dependre du fuseau du serveur.
   C'est la conversion la plus sure des cinq.

3. LES CONVERSIONS. `CAST(x AS REAL)` devient `numeric` et non
   `double precision` : les colonnes portees sont en `numeric`, melanger les
   deux ferait remonter des flottants dans des calculs de valorisation.

4. L'AGREGATION DE TEXTE. `GROUP_CONCAT` devient `string_agg`, qui EXIGE un
   separateur explicite la ou SQLite en supposait un.

5. CE QUI DISPARAIT. `PRAGMA` n'existe pas ; les cles etrangeres sont toujours
   verifiees en PostgreSQL, la ligne n'a donc pas d'equivalent — elle est
   retiree, pas traduite.

Usage :
    python porter_vues.py            # convertit
    python porter_vues.py --jouer    # convertit puis joue sur la base locale
"""
import re
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SORTIE = Path(__file__).resolve().parent

FICHIERS = [
    ("011_vues.sql", "011_vues.sql"),
    ("012_controles.sql", "012_controles.sql"),
    ("013_vues_cockpit.sql", "013_vues_cockpit.sql"),
    ("015_vues_coherence.sql", "015_vues_coherence.sql"),
    ("016_controles_classeur.sql", "016_controles_classeur.sql"),
    ("017_vues_analyse.sql", "017_vues_analyse.sql"),
]

PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
BASE = "gestionfil"


def convertir(sql):
    """Applique les cinq familles de conversion."""

    # --- 0. MAX / MIN a deux arguments --------------------------------------
    # EN PREMIER, ET C'EST NECESSAIRE : les conversions de dates introduisent
    # des parentheses dans les arguments, ce qui rendrait la detection plus
    # fragile ensuite.
    #
    # En SQLite, `MAX(a, b)` est une fonction SCALAIRE qui rend le plus grand
    # des deux ; en PostgreSQL, `MAX` est un AGREGAT a un seul argument. Le
    # portage naif echoue bruyamment (« la fonction max(integer, integer)
    # n'existe pas »), ce qui est une chance : la variante silencieuse aurait
    # rendu un chiffre faux.
    sql = _scalaire_max_min(sql)

    # --- 9. IS / IS NOT, comparaison sure aux NULL --------------------------
    # `IS NOT NULL`, `IS NULL`, `IS TRUE`, `IS FALSE` sont communs aux deux
    # moteurs et ne doivent pas etre touches : la negation ci-dessous les
    # exclut explicitement.
    sql = re.sub(r"\bIS\s+NOT\s+(?!NULL\b|TRUE\b|FALSE\b|DISTINCT\b)",
                 "IS DISTINCT FROM ", sql, flags=re.I)
    sql = re.sub(r"\bIS\s+(?!NOT\b|NULL\b|TRUE\b|FALSE\b|DISTINCT\b)",
                 "IS NOT DISTINCT FROM ", sql, flags=re.I)

    # --- 5. Ce qui disparait -------------------------------------------------
    sql = re.sub(r"^\s*PRAGMA[^;]*;\s*$", "", sql, flags=re.M)

    # --- 1. Les dates --------------------------------------------------------
    # `julianday(X) - julianday(Y)` -> `(X::date - Y::date)`.
    # On traite d'abord la forme complete, pour ne pas laisser d'appel isole.
    def jour(expr):
        expr = expr.strip()
        if expr in ("'now'", '"now"'):
            return "current_date"
        # `julianday(date(x))` : le `date()` interne devient inutile, le cast
        # le fait deja.
        m = re.fullmatch(r"date\((.*)\)", expr, re.S)
        if m:
            expr = m.group(1).strip()
        return "(%s)::date" % expr

    def remplacer_diff(m):
        return "(%s - %s)" % (jour(m.group(1)), jour(m.group(2)))

    # Le contenu d'un julianday() peut contenir des parentheses : on capture de
    # facon equilibree, a la main.
    sql = _remplacer_appels_paires(sql, remplacer_diff)

    # --- 2. Le formatage de dates -------------------------------------------
    sql = sql.replace("strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                      "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
    sql = sql.replace("strftime('%Y-%m-%d','now')", "to_char(current_date, 'YYYY-MM-DD')")
    sql = sql.replace("strftime('%Y-%m', 'now')", "to_char(current_date, 'YYYY-MM')")
    sql = sql.replace("strftime('%Y-%m','now')", "to_char(current_date, 'YYYY-MM')")
    # `strftime('%Y-%m', X)` -> `substr(X, 1, 7)` : la donnee est du texte ISO.
    # L'expression X peut contenir des parentheses (COALESCE, CASE) : on la
    # capture de facon equilibree plutot qu'avec une expression reguliere, qui
    # s'arreterait a la premiere parenthese fermante venue.
    sql = _remplacer_strftime(sql)

    # --- 3. Les conversions --------------------------------------------------
    sql = re.sub(r"\bAS\s+REAL\b", "AS numeric", sql, flags=re.I)
    sql = re.sub(r"\bAS\s+INTEGER\b", "AS integer", sql, flags=re.I)
    sql = re.sub(r"\bAS\s+TEXT\b", "AS text", sql, flags=re.I)

    # --- 6. MAX / MIN a deux arguments --------------------------------------
    # En SQLite, `MAX(a, b)` est une fonction SCALAIRE qui rend le plus grand
    # des deux ; en PostgreSQL, `MAX` est un AGREGAT a un seul argument. Le
    # portage naif compile parfois et rend alors autre chose : c'est le genre
    # d'ecart qui ne se voit qu'a la lecture d'un chiffre faux.

    # --- 8. La fonction `date()` --------------------------------------------
    # SQLite rend du TEXTE `AAAA-MM-JJ` ; PostgreSQL rend un type `date`. La
    # difference se voit immediatement — `date >= text` n'existe pas — mais elle
    # aurait pu ne PAS se voir : une comparaison entre deux `date()` aurait
    # compile et compare autre chose.
    #
    # On reste donc en texte, conformement au choix de portage n°3 : les dates
    # sont du texte ISO, comparees lexicographiquement. `date(x)` devient
    # `substr(x, 1, 10)` — la partie jour d'un horodatage ISO, exactement ce que
    # SQLite renvoyait — et `date('now')` devient la date du jour formatee de
    # la meme facon.
    sql = _decalage_de_date(sql)
    sql = sql.replace("date('now')", "to_char(current_date, 'YYYY-MM-DD')")
    sql = re.sub(r"(?<![a-zA-Z_])date\(([^()]+)\)", r"substr(\1, 1, 10)", sql)

    # --- 7. Les dependances entre vues --------------------------------------
    # SQLite laisse supprimer une vue dont d'autres dependent : elles deviennent
    # simplement invalides, et l'erreur n'apparait qu'a la lecture. PostgreSQL
    # refuse, et il a raison — mais ces fichiers RECREENT tout l'enchainement
    # juste apres. `CASCADE` est donc exact ici, et seulement ici : il tombe
    # exactement sur les vues que les lignes suivantes reconstruisent.
    lignes = []
    for l in sql.split(chr(10)):
        t = l.strip()
        if t.upper().startswith("DROP VIEW IF EXISTS ") and t.endswith(";") and "CASCADE" not in t.upper():
            l = l.rstrip()[:-1] + " CASCADE;"
        lignes.append(l)
    sql = chr(10).join(lignes)

    # --- 4. L'agregation de texte -------------------------------------------
    sql = re.sub(r"GROUP_CONCAT\(\s*([^,()]+?)\s*\)", r"string_agg(\1, ',')", sql, flags=re.I)
    sql = re.sub(r"GROUP_CONCAT\(", "string_agg(", sql, flags=re.I)

    return sql


def _scalaire_max_min(sql):
    """`MAX(a, b)` -> `GREATEST(a, b)` ; `MIN(a, b)` -> `LEAST(a, b)`.

    Ne touche PAS les formes a un seul argument, qui sont de vrais agregats.
    """
    for nom, cible in (("max", "GREATEST"), ("min", "LEAST")):
        resultat = []
        i = 0
        bas = sql.lower()
        while True:
            j = bas.find(nom + "(", i)
            if j < 0:
                resultat.append(sql[i:])
                break
            # Un identifiant qui se termine par « max » n'est pas un appel.
            if j > 0 and (sql[j - 1].isalnum() or sql[j - 1] == "_"):
                resultat.append(sql[i:j + len(nom) + 1])
                i = j + len(nom) + 1
                continue
            contenu, apres = _capturer(sql, j + len(nom) + 1)
            args = _decouper(contenu)
            resultat.append(sql[i:j])
            # SQLite accepte autant d'arguments qu'on veut : `max(a, b, c, d)`
            # est valide et rend le plus grand des quatre. Un seul argument, en
            # revanche, est le vrai agregat — celui-la ne bouge pas.
            if len(args) >= 2:
                resultat.append("%s(%s)" % (cible, ", ".join(a.strip() for a in args)))
            else:
                resultat.append(sql[j:apres])
            i = apres
        sql = "".join(resultat)
        bas = sql.lower()
    return sql


def _decouper(contenu):
    """Decoupe les arguments de premier niveau d'un appel de fonction."""
    args, profondeur, courant, i = [], 0, [], 0
    while i < len(contenu):
        c = contenu[i]
        if c == "'":
            fin = contenu.index("'", i + 1)
            courant.append(contenu[i:fin + 1])
            i = fin + 1
            continue
        if c == "(":
            profondeur += 1
        elif c == ")":
            profondeur -= 1
        elif c == "," and profondeur == 0:
            args.append("".join(courant))
            courant = []
            i += 1
            continue
        courant.append(c)
        i += 1
    args.append("".join(courant))
    return args


def _decalage_de_date(sql):
    """`date('now', '-' || CAST(x AS ...) || ' days')` -> date decalee, en texte.

    On ne traite QUE cette forme, et deliberement : un `date()` a
    modificateur peut exprimer des dizaines de choses en SQLite ('start of
    month', 'weekday 0', '+1 year'). Traduire au jugé ce qu'on n'a pas sous
    les yeux produirait du SQL qui compile et ment. Les sept occurrences du
    schema sont toutes des decalages en jours ; toute autre forme est laissee
    telle quelle et fera echouer le chargement, ce qui est le comportement
    voulu.
    """
    motif = re.compile(
        r"date\(\s*'now'\s*,\s*'([+-])'\s*\|\|\s*"
        r"CAST\((.+?)\s+AS\s+\w+\)\s*\|\|\s*' days'\s*\)",
        re.I | re.S,
    )

    def remplacer(m):
        signe, expr = m.group(1), m.group(2).strip()
        return "to_char(current_date %s (%s)::integer, 'YYYY-MM-DD')" % (signe, expr)

    return motif.sub(remplacer, sql)


def _remplacer_strftime(sql):
    """`strftime('%Y-%m', X)` -> `substr(X, 1, 7)`, parentheses respectees."""
    marqueur = "strftime('%Y-%m',"
    resultat = []
    i = 0
    while True:
        j = sql.find(marqueur, i)
        if j < 0:
            resultat.append(sql[i:])
            return "".join(resultat)
        resultat.append(sql[i:j])
        contenu, apres = _capturer(sql, j + len(marqueur))
        resultat.append("substr(%s, 1, 7)" % contenu.strip())
        i = apres


def _remplacer_appels_paires(sql, remplacer):
    """Trouve `julianday(A) - julianday(B)` en respectant les parentheses."""
    resultat = []
    i = 0
    while True:
        j = sql.find("julianday(", i)
        if j < 0:
            resultat.append(sql[i:])
            break
        resultat.append(sql[i:j])
        a, apres_a = _capturer(sql, j + len("julianday("))
        # Cherche un `-` puis un second julianday.
        reste = sql[apres_a:]
        m = re.match(r"\s*-\s*julianday\(", reste)
        if m:
            b, apres_b = _capturer(sql, apres_a + m.end())
            resultat.append(remplacer(_Deux(a, b)))
            i = apres_b
        else:
            # julianday isole : `julianday(x)` seul n'a de sens qu'en
            # comparaison ; on le rend en jours depuis l'epoque, ce qui
            # preserve les differences.
            resultat.append("(%s)::date" % (a if a.strip() not in ("'now'",) else "current_date"))
            i = apres_a
    return "".join(resultat)


class _Deux:
    def __init__(self, a, b):
        self._a, self._b = a, b

    def group(self, n):
        return self._a if n == 1 else self._b


def _capturer(sql, debut):
    """Renvoie (contenu, position apres la parenthese fermante)."""
    profondeur = 1
    i = debut
    while i < len(sql):
        c = sql[i]
        if c == "(":
            profondeur += 1
        elif c == ")":
            profondeur -= 1
            if profondeur == 0:
                return sql[debut:i], i + 1
        elif c == "'":
            i = sql.index("'", i + 1)
        i += 1
    raise ValueError("parenthese non fermee a %d" % debut)


def main():
    total = 0
    for source, cible in FICHIERS:
        sql = (RACINE / source).read_text(encoding="utf-8")
        porte = convertir(sql)
        entete = (
            "-- Porte automatiquement depuis db/%s par pg/porter_vues.py.\n"
            "-- NE PAS MODIFIER ICI : corriger la source, puis rejouer le portage.\n\n"
            % source
        )
        (SORTIE / cible).write_text(entete + porte, encoding="utf-8")
        n = len(re.findall(r"CREATE\s+(?:VIEW|TRIGGER|TABLE|FUNCTION)", porte, re.I))
        print("  %-30s -> pg/%-30s %2d objets" % (source, cible, n))
        total += n
    print("\n%d objets portes." % total)


if __name__ == "__main__":
    main()
    if "--jouer" in sys.argv:
        import os
        env = dict(os.environ, PGPASSWORD="toor")
        for _, cible in FICHIERS:
            p = subprocess.run(
                [PSQL, "-U", "postgres", "-h", "127.0.0.1", "-d", BASE,
                 "-v", "ON_ERROR_STOP=1", "-f", str(SORTIE / cible)],
                capture_output=True, text=True, env=env,
            )
            etat = "ok" if p.returncode == 0 else "ECHEC"
            print("  %-30s %s" % (cible, etat))
            if p.returncode != 0:
                print(p.stderr.strip()[:1500])
                break
