"""
Portage SQLite -> PostgreSQL des scripts de tables (001 a 009).

Ce convertisseur ne touche QUE la DDL des tables. Les declencheurs (010) et les
vues (011, 012) sont portes a la main : leur traduction demande de comprendre ce
que la regle veut dire, pas seulement ce qu'elle ecrit. Un `RAISE(ABORT)` devient
une fonction PL/pgSQL, et une vue qui fait de l'arithmetique de dates change de
fonctions — automatiser cela produirait du SQL qui compile et ment.

Quatre choix de portage, tous reversibles, tous deliberes :

1. DECIMAUX -> `numeric`. L'ADR-001 D-10 avait choisi `REAL` faute de decimal
   exact en SQLite, avec un ROUND explicite a chaque ecriture pour compenser.
   PostgreSQL a `numeric` : l'echelle est portee par la colonne, et l'arrondi
   cesse d'etre une discipline pour devenir une garantie. L'echelle se deduit du
   nom, qui est deja normalise dans ce schema.

2. BOOLEENS -> `smallint` 0/1, PAS `boolean`. PostgreSQL a un vrai booleen, mais
   le service et les ecrans comparent partout `actif === 0` et `est_quarantaine
   === 1`. Basculer maintenant changerait le JSON en true/false et casserait ces
   comparaisons dans une centaine d'endroits, au milieu d'une migration deja
   large. Le CHECK (0,1) preserve l'invariant ; le vrai booleen viendra apres.

3. DATES -> `text` ISO-8601, inchangees. C'est le choix qui surprend le plus et
   c'est le plus important : tout le code compare des dates par ordre
   lexicographique, ce que l'ISO-8601 garantit. Les passer en `date` /
   `timestamptz` maintenant toucherait 110 appels de fonctions dans les vues et
   toute la serialisation JSON — donc exactement ce que la strategie « schema
   d'abord, service ensuite » cherche a eviter. A reprendre une fois la bascule
   faite et verte.

4. REFERENCES EN AVANT -> differees. SQLite accepte qu'une table en reference une
   autre definie plus bas ; PostgreSQL exige que la cible existe. Ces cles sont
   retirees de la colonne et reposees en fin de parcours, pour ne pas avoir a
   reordonner des tables dont l'ordre raconte le modele.
"""
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]

# --- Echelles decimales, deduites du nom de colonne --------------------------
# Le schema nomme ses colonnes de facon reguliere : c'est ce qui rend la regle
# sure. Toute colonne REAL non reconnue tombe sur un defaut large ET se signale,
# pour qu'aucune echelle ne soit choisie en silence.
ECHELLES = [
    # Monnaie : deux decimales, comme un dirham s'ecrit.
    (r"_mad$|_mad_|montant|prix|valeur|cout|capital|plafond|_devise$", "numeric(18,2)"),
    # Quantites : quatre decimales, l'echelle retenue par R01 pour le kilo.
    (r"_kg$|_kg_|quantite|poids|densite|facteur|_m2$|m2_", "numeric(18,4)"),
    # Ratios et coefficients.
    (r"_pct$|pourcentage|taux|marge|coefficient|saisonnalite", "numeric(9,4)"),
    # Notes sur 100.
    (r"^note_|_note$", "numeric(5,2)"),
    (r"_jours$|_mois$|delai|seuil|duree", "numeric(12,4)"),
    # Valeur cible d'un indicateur : meme echelle qu'une quantite.
    (r"^cible$", "numeric(18,4)"),
]
DEFAUT_REAL = "numeric(18,6)"

UUID_SQLITE = re.compile(
    r"DEFAULT\s*\(lower\(hex\(randomblob\(4\)\).*?randomblob\(6\)\)\)\)", re.S
)
HORODATAGE = re.compile(r"DEFAULT\s*\(strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)\)")
JOUR = re.compile(r"DEFAULT\s*\(strftime\('%Y-%m-%d','now'\)\)")


def echelle(colonne: str) -> str:
    c = colonne.lower()
    for motif, type_pg in ECHELLES:
        if re.search(motif, c):
            return type_pg
    print("    ! REAL sans echelle deduite : %s -> %s" % (colonne, DEFAUT_REAL))
    return DEFAUT_REAL


def porter(sql: str) -> str:
    # 1. Ce qui n'existe pas en PostgreSQL, et n'a pas besoin d'exister.
    sql = re.sub(r"^PRAGMA .*?;\n", "", sql, flags=re.M)
    sql = re.sub(r"\)\s*STRICT\s*;", ");", sql)

    # 2. Identifiants et horodatages : la generation passe au moteur.
    sql = UUID_SQLITE.sub("DEFAULT gen_random_uuid()::text", sql)
    sql = HORODATAGE.sub(
        "DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
        sql,
    )
    sql = JOUR.sub("DEFAULT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')", sql)

    # 3. Colonnes calculees : PostgreSQL ne connait que STORED.
    sql = re.sub(r"\)\s*VIRTUAL", ") STORED", sql)

    # 4. Types, ligne a ligne : le nom de la colonne decide de l'echelle.
    lignes = []
    for ligne in sql.split("\n"):
        m = re.match(r"(\s+)(\w+)(\s+)(TEXT|REAL|INTEGER|BLOB)\b(.*)$", ligne)
        if not m:
            lignes.append(ligne)
            continue
        indent, nom, espace, type_sqlite, reste = m.groups()
        if type_sqlite == "TEXT":
            type_pg = "text"
        elif type_sqlite == "BLOB":
            type_pg = "bytea"
        elif type_sqlite == "REAL":
            type_pg = echelle(nom)
        else:
            booleen = re.search(
                r"CHECK\s*\(\s*%s\s+IN\s*\(0\s*,\s*1\)\s*\)" % re.escape(nom), reste
            )
            type_pg = "smallint" if booleen else "integer"
        lignes.append("%s%s%s%s%s" % (indent, nom, espace, type_pg, reste))
    sql = "\n".join(lignes)

    # 5. Inegalite null-safe. `a IS NOT b` entre deux colonnes est propre a
    #    SQLite ; PostgreSQL l'ecrit `IS DISTINCT FROM`. La negative lookahead
    #    protege `IS NOT NULL`, qui est standard et doit rester tel quel.
    sql = re.sub(r"\bIS NOT (?!NULL\b)(\w)", r"IS DISTINCT FROM \1", sql)

    # 6. Index unique sur une constante. SQLite ecrit `ON t(1) WHERE ...` pour
    #    imposer « au plus une ligne satisfaisant le predicat » — c'est ainsi
    #    que RG-10 garantit un seul plan en service. PostgreSQL veut une
    #    expression parenthesee : `ON t ((true)) WHERE ...`, verifie equivalent.
    sql = re.sub(r"(ON\s+\w+)\(1\)(\s+WHERE)", r"\1 ((true))\2", sql)

    # 6. Validation JSON : SQLite a json_valid, PostgreSQL a un type.
    sql = re.sub(r"json_valid\((\w+)\)", r"(\1)::jsonb IS NOT NULL", sql)

    # 7. En-tete : dire la cible reelle du fichier.
    sql = sql.replace(
        "-- Cible dev : SQLite 3.51+  (tables STRICT)  |  Cible prod : PostgreSQL 16",
        "-- Cible : PostgreSQL 16+   (porte depuis la version SQLite, voir db/pg/porter.py)",
    )
    return sql


def extraire_declencheurs(sql, nom_fichier, recueil):
    """Sort les declencheurs des fichiers de tables.

    Deux d'entre eux vivent dans 006 plutot que dans 010. En SQLite cela ne
    genait pas ; ici tout declencheur demande une fonction PL/pgSQL, donc ils
    rejoignent le portage manuel des 65 autres au lieu d'echouer au chargement
    du schema. Les fichiers de tables redeviennent de la DDL pure.
    """
    sortie = []
    tampon = None
    for ligne in sql.split(chr(10)):
        if ligne.startswith('CREATE TRIGGER'):
            tampon = [ligne]
            continue
        if tampon is not None:
            tampon.append(ligne)
            if ligne.strip() == 'END;':
                recueil.append((nom_fichier, chr(10).join(tampon)))
                tampon = None
            continue
        sortie.append(ligne)
    return chr(10).join(sortie)



def differer_references_avant(fichiers):
    """Sort les cles etrangeres qui pointent vers une table pas encore creee."""
    rang = {}
    for i, (nom, sql) in enumerate(fichiers.items()):
        for j, t in enumerate(re.findall(r"CREATE TABLE (\w+)", sql)):
            rang[t] = (i, j)

    differees = []
    sortie = {}
    for i, (nom, sql) in enumerate(fichiers.items()):
        table = None
        lignes = []
        for ligne in sql.split("\n"):
            m_table = re.match(r"CREATE TABLE (\w+)", ligne)
            if m_table:
                table = m_table.group(1)
            m_fk = re.search(r"\s+REFERENCES\s+(\w+)\((\w+)\)", ligne)
            m_col = re.match(r"\s+(\w+)\s", ligne)
            if m_fk and m_col and table:
                cible = m_fk.group(1)
                if rang.get(cible, (99, 99)) > rang.get(table, (0, 0)):
                    colonne = m_col.group(1)
                    differees.append(
                        "ALTER TABLE %s\n    ADD CONSTRAINT fk_%s_%s\n"
                        "    FOREIGN KEY (%s) REFERENCES %s(%s);"
                        % (table, table, colonne, colonne, cible, m_fk.group(2))
                    )
                    ligne = ligne.replace(m_fk.group(0), "")
                    print("    reference en avant differee : %s.%s -> %s" % (table, colonne, cible))
            lignes.append(ligne)
        sortie[nom] = "\n".join(lignes)

    if differees:
        sortie["099_cles_differees.sql"] = (
            "-- ============================================================\n"
            "-- Cles etrangeres en reference avant\n"
            "-- ------------------------------------------------------------\n"
            "-- Posees ici parce que leur cible est creee apres la table qui\n"
            "-- les porte. SQLite l'acceptait en ligne ; PostgreSQL exige que\n"
            "-- la cible existe deja.\n"
            "-- Genere par db/pg/porter.py — ne pas editer a la main.\n"
            "-- ============================================================\n\n"
            + "\n\n".join(differees)
            + "\n"
        )
    return sortie


def main():
    sortie = RACINE / "pg"
    sortie.mkdir(exist_ok=True)
    portes = {}
    extraits = []
    for src in sorted(RACINE.glob("0*_schema_*.sql")):
        print("  " + src.name)
        sql = porter(src.read_text(encoding="utf-8"))
        portes[src.name] = extraire_declencheurs(sql, src.name, extraits)
    for nom, t in extraits:
        print("    declencheur sorti vers le portage manuel : "
              + t.split(chr(10))[0].replace("CREATE TRIGGER ", "") + "  (" + nom + ")")
    for nom, sql in differer_references_avant(portes).items():
        (sortie / nom).write_text(sql, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
