"""
Traduction des fonctions de date SQLite vers PostgreSQL.

Partage entre le portage des declencheurs et celui des vues : les memes
expressions y reviennent, et une traduction qui differerait d'un fichier a
l'autre produirait deux comportements pour une seule regle.

Le point de depart est un choix de portage : les horodatages restent du texte
ISO-8601, comme en SQLite. La plupart des traductions se ramenent donc a du
decoupage de chaine, exact par construction puisque l'ISO-8601 se compare et se
tronque dans l'ordre chronologique.

Le seul point delicat est `julianday`. En SQLite il rend un numero de jour
julien ; ici, TOUTES ses occurrences servent a une difference de deux dates —
verifie une a une. PostgreSQL soustrait deux `date` et rend directement un
entier de jours. La traduction est donc exacte a condition de convertir chaque
`julianday(X)` en `(X)::date` et de laisser la soustraction faire le reste.

Une exception connue, a traiter a la main : `julianday(annee_mois)` sur une
valeur 'AAAA-MM', qui n'est pas une date complete. Elle apparait une fois, dans
une vue de risque, et se resout en completant le mois par son premier jour.
"""
import re

MAINTENANT = "(now() AT TIME ZONE 'UTC')"

# Ordre significatif : les motifs les plus specifiques d'abord, sinon un motif
# general consommerait le debut d'une expression que le suivant devait traiter.
REGLES = [
    # Horodatage complet, valeur par defaut la plus frequente du schema.
    (
        r"strftime\('%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\)",
        "to_char({m},'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
    ),
    (r"strftime\('%Y-%m-%d'\s*,\s*'now'\)", "to_char({m},'YYYY-MM-DD')"),
    (r"strftime\('%Y-%m'\s*,\s*'now'\)", "to_char({m},'YYYY-MM')"),
    (r"date\('now'\)", "to_char({m},'YYYY-MM-DD')"),
    (r"julianday\('now'\)", "{m}::date"),
]


def traduire(sql: str) -> str:
    for motif, remplacement in REGLES:
        sql = re.sub(motif, remplacement.replace("{m}", MAINTENANT), sql)

    # strftime('%Y-%m', X) -> substr(X, 1, 7). Le mois d'un texte ISO tient dans
    # ses sept premiers caracteres.
    sql = re.sub(r"strftime\('%Y-%m'\s*,\s*", "__MOIS__(", sql)
    sql = _fermer_appel(sql, "__MOIS__", "substr({arg}, 1, 7)")

    # date(X) -> substr(X, 1, 10). Meme raisonnement pour le jour.
    sql = re.sub(r"(?<![\w.])date\(", "__JOUR__(", sql)
    sql = _fermer_appel(sql, "__JOUR__", "substr({arg}, 1, 10)")

    # julianday(X) -> (X)::date, pour que la soustraction rende des jours.
    sql = re.sub(r"(?<![\w.])julianday\(", "__JD__(", sql)
    sql = _fermer_appel(sql, "__JD__", "(substr({arg}, 1, 10))::date")

    return sql


def _fermer_appel(sql: str, marqueur: str, gabarit: str) -> str:
    """Remplace `marqueur(...)` en respectant les parentheses imbriquees.

    Une expression reguliere ne suffit pas : les arguments contiennent eux-memes
    des appels de fonction, et `[^)]*` s'arreterait a la premiere parenthese
    fermante venue, coupant l'expression en deux.
    """
    while True:
        i = sql.find(marqueur + "(")
        if i == -1:
            return sql
        debut = i + len(marqueur) + 1
        profondeur, j = 1, debut
        while j < len(sql) and profondeur:
            if sql[j] == "(":
                profondeur += 1
            elif sql[j] == ")":
                profondeur -= 1
            j += 1
        arg = sql[debut : j - 1]
        sql = sql[:i] + gabarit.replace("{arg}", arg) + sql[j:]
