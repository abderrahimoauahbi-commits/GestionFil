"""
Portage des declencheurs SQLite -> PostgreSQL.

SQLite ecrit le corps du declencheur en ligne ; PostgreSQL exige une fonction.
La traduction se range en trois familles, et seule la derniere demande de
comprendre la regle plutot que de la transcrire.

  GARDE SIMPLE          la condition tient dans le WHEN, le corps ne fait que
                        refuser. PostgreSQL garde le WHEN declaratif : la regle
                        reste lisible sur le declencheur, et une seule fonction
                        partagee porte le refus.

  GARDE A SOUS-REQUETE  meme chose, sauf que la condition interroge une autre
                        table. PostgreSQL INTERDIT les sous-requetes dans un
                        WHEN de declencheur — la condition descend dans le corps
                        d'une fonction dediee. C'est la seule vraie perte de
                        lisibilite du portage, et elle touche la moitie des
                        gardes.

  CORPS D'ECRITURE      le corps insere au lieu de refuser : ce sont les onze
                        declencheurs d'audit. Une seule instruction, donc
                        portable telle quelle une fois `json_object` renomme.

Reste trois declencheurs a vraie logique — application au stock, historisation
des parametres, substitution en reception — ecartes ici et portes a la main dans
010b_declencheurs_logique.sql. Ce sont ceux dont la traduction change le sens si
on la mecanise.

Le sens de retour compte : un BEFORE doit rendre NEW pour laisser passer
l'ecriture, OLD pour un DELETE. Rendre NULL annulerait l'operation en silence —
exactement ce qu'un garde ne doit jamais faire, puisqu'il refuse en levant une
exception, jamais en escamotant. Un AFTER voit son retour ignore : NULL par
convention.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from dates import traduire

RACINE = Path(__file__).resolve().parents[1]

# Declencheurs dont la traduction demande de comprendre la regle.
A_LA_MAIN = {
    # Ces deux-la ecrivent dans le stock et dans l'historique : leur traduction
    # demande de comprendre la regle, pas seulement de la transcrire.
    "trg_lmvt_appliquer",
    "trg_parametre_historiser",
}

EVENEMENT = re.compile(
    r"(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)(\s+OF\s+[\w,\s]+?)?\s+ON\s+(\w+)", re.I
)


def decouper(sql):
    """Isole chaque declencheur, quelle que soit la mise en forme du corps."""
    blocs, i = [], 0
    fin = re.compile(r"END\s*;", re.I)
    while True:
        d = sql.find("CREATE TRIGGER", i)
        if d == -1:
            return blocs
        m = fin.search(sql, d)
        if not m:
            return blocs
        blocs.append(sql[d : m.end()])
        i = m.end()


def analyser(bloc):
    nom = re.match(r"CREATE TRIGGER (\w+)", bloc).group(1)
    m = re.search(r"\bBEGIN\b", bloc)
    tete = bloc[: m.start()].rstrip()
    corps = re.sub(r"END\s*;\s*$", "", bloc[m.end() :].rstrip(), flags=re.I).strip()
    m_when = re.search(r"\bWHEN\b(.*)$", tete, re.S)
    return nom, tete, corps, (m_when.group(1).strip() if m_when else None)


def message(corps):
    """Libelle d'un RAISE(ABORT, '...'), apostrophes comprises."""
    m = re.search(r"RAISE\s*\(\s*ABORT\s*,\s*'(.*?)'\s*\)\s*;", corps, re.S)
    return m.group(1) if m else None


def litteral(msg):
    """Echappe un message pour PL/pgSQL.

    Deux echappements, pour deux raisons distinctes : l'apostrophe parce que le
    message devient un litteral SQL, et le pourcent parce que PL/pgSQL lit le
    message de RAISE comme un format. Un « 100% » non double fait echouer la
    COMPILATION de la fonction, pas son execution — l'erreur arrive donc au
    chargement du schema, loin de sa cause.
    """
    return msg.replace("'", "''").replace("%", "%%")


def assembler(nom, tete, corps_pg, moment, action, colonnes, table, condition, retour):
    """Ecrit la fonction et son declencheur.

    Le WHEN reste declaratif quand il le peut : c'est ce qui permet de relire la
    regle sur le declencheur lui-meme, comme en SQLite. Il ne descend dans le
    corps que si PostgreSQL l'y oblige, c'est-a-dire s'il contient un SELECT.
    """
    sous_requete = bool(condition and re.search(r"\bSELECT\b", condition, re.I))
    clause = ""
    if condition and not sous_requete:
        clause = "WHEN (" + condition + ")\n"
    elif condition:
        corps_pg = "    IF " + condition + " THEN\n" + corps_pg + "\n    END IF;"

    colonnes = (" " + colonnes) if colonnes else ""
    return (
        "CREATE OR REPLACE FUNCTION fn_" + nom + "() RETURNS trigger AS $$\nBEGIN\n"
        + corps_pg
        + "\n    RETURN " + retour + ";\nEND;\n$$ LANGUAGE plpgsql;\n\n"
        + "CREATE TRIGGER " + nom + "\n"
        + moment + " " + action + colonnes + " ON " + table + " FOR EACH ROW\n"
        + clause
        + "EXECUTE FUNCTION fn_" + nom + "();"
    )


def porter(bloc):
    bloc = traduire(bloc)
    # `a IS NOT b` entre deux colonnes est l'inegalite null-safe de SQLite ;
    # PostgreSQL l'ecrit `IS DISTINCT FROM`. `IS NOT NULL` reste standard.
    bloc = re.sub(r"\bIS NOT (?!NULL\b)(\w)", r"IS DISTINCT FROM \1", bloc)

    nom, tete, corps, condition = analyser(bloc)
    if nom in A_LA_MAIN:
        return None, "-- " + nom + " : porte a la main (010b_declencheurs_logique.sql)"

    ev = EVENEMENT.search(tete)
    if not ev:
        return None, "-- " + nom + " : evenement non reconnu, a porter a la main"
    moment, action = ev.group(1).upper(), ev.group(2).upper()
    colonnes, table = (ev.group(3) or "").strip(), ev.group(4)

    msg = message(corps)

    # --- Garde : le corps ne fait que refuser -------------------------------
    if msg is not None and corps.count(";") <= 1:
        sous_requete = bool(condition and re.search(r"\bSELECT\b", condition, re.I))
        if condition and not sous_requete:
            # Une seule fonction partagee suffit : le message voyage en
            # argument. Soixante fonctions identiques a un litteral pres
            # seraient soixante endroits ou une correction peut manquer.
            colonnes_txt = (" " + colonnes) if colonnes else ""
            return (
                "CREATE TRIGGER " + nom + "\n"
                + moment + " " + action + colonnes_txt + " ON " + table + " FOR EACH ROW\n"
                + "WHEN (" + condition + ")\n"
                + "EXECUTE FUNCTION fn_refuser('" + litteral(msg) + "');",
                None,
            )
        retour = "OLD" if action == "DELETE" else "NEW"
        corps_pg = "        RAISE EXCEPTION '" + litteral(msg) + "';"
        if not condition:
            corps_pg = "    RAISE EXCEPTION '" + litteral(msg) + "';"
        return (
            assembler(nom, tete, corps_pg, moment, action, colonnes, table, condition, retour),
            None,
        )

    # --- Corps d'ecriture : une seule instruction, portable telle quelle -----
    if msg is None and corps.count(";") == 1 and corps.upper().startswith("INSERT INTO"):
        # SQLite json_object et PostgreSQL json_build_object ont le meme
        # contrat : une suite alternee de cles et de valeurs. Le nom seul change.
        corps_pg = re.sub(r"\bjson_object\(", "json_build_object(", corps)
        corps_pg = "\n".join("    " + l for l in corps_pg.split("\n"))
        retour = "NULL" if moment == "AFTER" else "NEW"
        return (
            assembler(nom, tete, corps_pg, moment, action, colonnes, table, condition, retour),
            None,
        )

    return None, "-- " + nom + " : corps non reconnu, a porter a la main"


ENTETE = """-- =============================================================================
-- ERP GESTION FIL — declencheurs, cible PostgreSQL
-- -----------------------------------------------------------------------------
-- Genere depuis 010_triggers.sql et 006_schema_achats.sql par
-- db/pg/porter_declencheurs.py. Ne pas editer a la main : regenerer.
--
-- Les trois declencheurs a vraie logique sont dans
-- 010b_declencheurs_logique.sql, ecrits a la main.
--
-- Trois formes, selon ce que PostgreSQL autorise :
--   * condition simple    -> WHEN (...) EXECUTE FUNCTION fn_refuser('message')
--     La regle reste lisible sur le declencheur, comme en SQLite.
--   * condition a SELECT  -> la condition descend dans le corps d'une fonction
--     dediee : PostgreSQL interdit les sous-requetes dans un WHEN.
--   * corps d'ecriture    -> fonction dediee, WHEN conserve quand il le peut.
-- =============================================================================

-- Refus partage. Le message voyage en argument plutot que dans le corps : une
-- fonction par garde ferait cinquante endroits ou une correction peut manquer.
CREATE OR REPLACE FUNCTION fn_refuser() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '%', TG_ARGV[0];
END;
$$ LANGUAGE plpgsql;

"""


# Chaque groupe donne un fichier de sortie : garder 014 separe permet de le
# rejouer seul quand on ajoute un declencheur d'audit, sans retoucher aux 65
# declencheurs metier de 010.
GROUPES = [
    ("010_declencheurs.sql", ["010_triggers.sql", "006_schema_achats.sql"]),
    ("014_audit_operations.sql", ["014_audit_operations.sql"]),
]


def main():
    total, restants = 0, []
    for cible, sources in GROUPES:
        sorties, notes = [], []
        for nom in sources:
            src = RACINE / nom
            if not src.exists():
                continue
            for bloc in decouper(src.read_text(encoding="utf-8")):
                porte, note = porter(bloc)
                if porte:
                    sorties.append(porte)
                if note:
                    notes.append(note)

        (RACINE / "pg" / cible).write_text(
            ENTETE
            + "\n\n".join(sorties)
            + ("\n\n-- Portes a la main :\n" + "\n".join(notes) if notes else "")
            + "\n",
            encoding="utf-8",
        )
        print("  %-28s %2d declencheurs, %d a la main" % (cible, len(sorties), len(notes)))
        total += len(sorties)
        restants += notes

    print("  total : %d declencheurs portes" % total)
    for n in restants:
        print("   ", n.replace("-- ", ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
