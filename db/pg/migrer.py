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

Options de connexion : --hote (127.0.0.1 ; '' = socket local, pour
`sudo -u postgres python3 migrer.py --hote ''` sur le serveur), --utilisateur
(postgres), --motdepasse (a defaut PGPASSWORD). En production, les migrations se
jouent en `postgres` (voir deploiement/README.md).

LE MARQUAGE VERIFIE (09/10/2026). Inscrire une migration sans la jouer, c'est
affirmer qu'elle est deja dans la base. Le 08/10, 2026-09-20d a ete inscrite
ainsi sans avoir jamais ete jouee : la supervision tombait en « erreur
interne », et migrer.py ne l'aurait jamais rejouee. Desormais, avant d'inscrire,
chaque migration est REJOUEE A BLANC (transaction annulee) : si elle change
encore le schema (une colonne, une vue, une fonction, un declencheur, un index),
elle n'est pas inscrite, et le rapport dit quoi. Une migration qui ne se rejoue
pas (elle chargeait des donnees deja presentes) est inscrite avec un
avertissement. Un objet remplace depuis hors des migrations (fichier source recharge) parait
aussi « non joue » : apres lecture du rapport, `--accepter <fichier>[,...]`.
Un ecart qu'aucune migration n'explique (objet change hors des migrations)
ARRETE l'inscription (10/10/2026) : `--accepter-non-attribues` apres lecture.
`--sans-essai` retrouve l'ancien comportement, a vos risques.
"""
import hashlib
import os
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
MIGRATIONS = ICI / "migrations"
_PSQL_WIN = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
PSQL = os.environ.get("PSQL", _PSQL_WIN if os.path.exists(_PSQL_WIN) else "psql")
JOURNAL = "2026-10-08c_journal_migrations.sql"


# LES CORRECTIONS DELIBEREES D'UNE MIGRATION DEJA APPLIQUEE. Une migration
# inscrite ne se rejoue jamais par ce script ; la corriger apres coup ne sert
# que pour un rejeu a la main ou une base neuve. Son ancienne empreinte reste
# acceptee par --verifier, nommement, avec la raison :
#   2026-10-08b : rejouee, elle ecrasait le reglage `sensible` des champs
#   declares a la main (audit v5, U14, 09/10/2026) — ON CONFLICT DO NOTHING.
EMPREINTES_REMPLACEES: dict[str, set[str]] = {
    "2026-10-08b_audit_v4.sql": {"b0d8a8015ece08fbf035c0693945aa8a32d49f934a9adf84bd0a73f8403939cc"},
    # 13/10/2026 au soir : l'obligation de double authentification (Admin, Direction) retiree.
    "2026-10-13c_securite.sql": {"65fab75c30cd387f31437cdb2a9b3fe76de500b818212bc7b8237cdcb8fc6447"},
    # 14/10/2026 (ADR-003 phase C) : 'FRAIS' entre dans ck_rec_ajust_origine. Corrige
    # DANS CETTE migration parce qu'elle se rejoue : rejouee sur une base qui porte
    # deja des ajustements 'FRAIS', l'ancienne liste echouait sur ses propres lignes.
    "2026-10-09g_avoirs_retours.sql": {"30cc67b5115c101cffeb9443e9e87641656793e534307d225972668ac60f7518",
                                       "12382d93eecb689607bccf2801a11271be52d779ed37b9b135cbe40dd50994c3"},
    # 19/10/2026 (A1, dates en vrai type, 2026-10-19g) : ces migrations se rejouent ;
    # elles lisent desormais date_mouvement / date_bc en texte (::text), ce qui vaut
    # avant comme apres la conversion de type.
    "2026-10-09b_supervision_rejouee.sql": {"c765b9b45e73a8e86d900c30dc1bd1d571082b9df001c41ca06f94807b957d86"},
    "2026-10-09d_sortie_hors_machine.sql": {"ff584388a8635bde5e288364114c24c0ef36f3c765fe40997cef470db01c774a"},
    "2026-10-09j_prix_plan_achat.sql": {"913cd8bce990de61598722b6d65d50018cac7e0c4a7bce9c5f9a15cb058c5ef9"},
    "2026-10-09n_avoir_import.sql": {"f4e6f92309aab941e9d2798e3343aacd28ae265ffa1750b0adf32e8d0df8e681"},
}


def empreinte(chemin: Path) -> str:
    # Sur le contenu aux fins de ligne Unix : Git les convertit selon le poste,
    # et un fichier identique ne doit pas paraitre modifie.
    return hashlib.sha256(chemin.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


class Base:
    def __init__(self, base, hote, utilisateur, motdepasse):
        self.cible = ["-U", utilisateur, "-d", base] + (["-h", hote] if hote else [])
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


# L'empreinte du schema : ce qu'une migration peut changer et qu'on sait relire.
SCHEMA = """
SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type
  FROM information_schema.columns WHERE table_schema = 'public'
UNION ALL
SELECT 'vue ' || viewname || ' ' || md5(definition) FROM pg_views WHERE schemaname = 'public'
UNION ALL
SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
       || md5(replace(p.prosrc, chr(13), ''))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
UNION ALL
SELECT 'trg ' || c.relname || '.' || t.tgname
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal
UNION ALL
SELECT 'ctr ' || conrelid::regclass::text || '.' || conname
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
UNION ALL
SELECT 'idx ' || indexname FROM pg_indexes WHERE schemaname = 'public'
"""


def essai_a_blanc(base, sequence: list[Path]) -> tuple[list[str], int]:
    """Rejoue la SUITE des migrations, dans l'ordre, dans une transaction annulee,
    et rend ce qu'elle change encore au schema, avec le nombre d'instructions qui
    ne se rejouent pas (chargements de donnees deja presentes : sautees une a une,
    ON_ERROR_ROLLBACK). Toute la suite, et non chaque fichier seul : une vue
    redefinie plus tard paraitrait sinon « changee » par la migration ancienne."""
    corps = []
    for chemin in sequence:
        corps.append(f"\\echo @@FICHIER {chemin.name}")
        corps += [l for l in chemin.read_text(encoding="utf-8").splitlines()
                  if l.strip().upper() not in ("BEGIN;", "COMMIT;", "START TRANSACTION;")]
    # Les lignes du schema sont marquees : les migrations impriment aussi des resultats.
    instantane = "SELECT '@@S ' || x FROM (" + SCHEMA + ") s(x);"
    script = "\n".join(["\\set ON_ERROR_ROLLBACK on", "BEGIN;", "\\echo @@AVANT", instantane,
                        *corps, "\\echo @@APRES", instantane, "ROLLBACK;", ""])
    p = subprocess.run([PSQL, *base.cible, "-tA", "-q"], input=script.encode("utf-8"),
                       capture_output=True, env=base.env)
    sortie = p.stdout.decode("utf-8", "replace")
    if "@@APRES" not in sortie:
        erreur = (p.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError("l'essai a blanc n'a pas abouti : " + (erreur[-1] if erreur else "?"))
    echecs = sum(1 for l in (p.stderr or b"").decode("utf-8", "replace").splitlines()
                 if l.startswith(("ERREUR", "ERROR", "psql:")))
    avant_txt, apres_txt = sortie.split("@@AVANT", 1)[1].split("@@APRES", 1)
    avant = {l[4:] for l in avant_txt.splitlines() if l.startswith("@@S ")}
    apres = {l[4:] for l in apres_txt.splitlines() if l.startswith("@@S ")}
    return sorted((apres - avant) | {"(disparait) " + x for x in avant - apres}), echecs


def objet_de(ecart: str) -> str:
    """Le nom de l'objet d'une ligne d'ecart (« col v_x.c numeric » -> v_x)."""
    nature, mot = ecart.replace("(disparait) ", "").split()[:2]
    if nature in ("trg", "ctr"):
        return mot.split(".")[-1]
    return mot.split("(")[0].split(".")[0]


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
        print("-- ATTENTION : ce SQL inscrit SANS VERIFIER. Preferez, sur le serveur :")
        print("--   sudo -u postgres python3 migrer.py --base gestionfil --hote '' --marquer-jusqua " + limite)
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
        modifies = [f.name for f in tous if connues.get(f.name) and connues[f.name] != empreinte(f)
                    and connues[f.name] not in EMPREINTES_REMPLACEES.get(f.name, set())]
        manquants = [f.name for f in tous if f.name not in connues]
        for n in modifies:
            print(f"  MODIFIE depuis son application : {n}")
        for n in manquants:
            print(f"  A JOUER : {n}")
        print(f"{len(tous) - len(manquants)} inscrite(s), {len(manquants)} a jouer, {len(modifies)} modifiee(s).")
        # Un fichier modifie apres coup est une anomalie, pas une information.
        sys.exit(1 if manquants or modifies else 0)

    if limite:
        if limite not in [f.name for f in tous]:
            sys.exit(f"{limite} : fichier inconnu dans {MIGRATIONS}")
        if not connues:
            # Le journal lui-meme d'abord : il cree la table.
            code, sortie = base.jouer(MIGRATIONS / JOURNAL)
            if code != 0:
                sys.exit(f"{JOURNAL} : {sortie}")
        candidates = [f for f in tous if f.name <= limite and f.name not in connues]
        refusees: dict[str, list[str]] = {}
        if candidates and "--sans-essai" not in args:
            # La suite rejouee : les candidates, et ce que la base a deja recu apres
            # la premiere d'entre elles (pour finir sur l'etat qu'elle doit avoir).
            sequence = [f for f in tous if f.name >= candidates[0].name
                        and (f.name <= limite or f.name in connues)]
            print(f"  essai a blanc de {len(sequence)} migration(s) (transaction annulee)...")
            ecarts, echecs = essai_a_blanc(base, sequence)
            textes = {f.name: f.read_text(encoding="utf-8") for f in sequence}
            non_attribues: list[str] = []
            for e in ecarts:
                objet = objet_de(e)
                # La derniere migration de la suite qui nomme l'objet en est l'auteur.
                auteur = next((f.name for f in reversed(sequence) if objet in textes[f.name]), None)
                # UN NOM GENERE (10/10/2026) : « ck_date_alerte_date_detection_d958 »
                # n'apparait nulle part en clair — 08m le fabrique dans un DO. Pour
                # une contrainte ou un index, et pour eux seuls, on cherche alors son
                # prefixe (« ck_date_alerte_date », ..., « ck_date »). Une vue ou une
                # fonction porte son nom en clair : un prefixe y accuserait une voisine.
                nature = e.replace("(disparait) ", "").split()[0]
                if auteur is None and nature in ("ctr", "idx"):
                    morceaux = objet.split("_")
                    for n in range(len(morceaux) - 1, 1, -1):
                        prefixe = "_".join(morceaux[:n])
                        if len(prefixe) < 6:
                            break
                        auteur = next((f.name for f in reversed(sequence) if prefixe in textes[f.name]), None)
                        if auteur:
                            break
                if auteur in [c.name for c in candidates]:
                    refusees.setdefault(auteur, []).append(e)
                elif auteur is None:
                    non_attribues.append(e)
            # UN ECART SANS AUTEUR (10/10/2026). Il etait affiche puis ignore : 08m a
            # ete inscrite sur une copie sans que ses contraintes existent. Deux cas :
            #  - le rejeu AJOUTERAIT ou CHANGERAIT l'objet : la base n'a pas ce que
            #    les migrations disent. On n'inscrit rien tant qu'un humain n'a pas lu ;
            #  - l'objet existe dans la base et DISPARAIT seulement du rejeu (une vue
            #    rechargee depuis son fichier source, que le rejeu emporte en
            #    cascade) : la base est en avance, pas en retard. Signale, sans bloquer.
            en_avance = [e for e in non_attribues if e.startswith("(disparait) ")]
            non_attribues = [e for e in non_attribues if not e.startswith("(disparait) ")]
            if en_avance:
                print(f"  {len(en_avance)} objet(s) present(s) dans la base et absent(s) du rejeu "
                      "(recharges hors des migrations) : sans incidence sur l'inscription.")
            if non_attribues and "--accepter-non-attribues" not in args:
                print(f"  {len(non_attribues)} ecart(s) que les migrations n'expliquent pas :")
                for e in non_attribues[:25]:
                    print(f"      {e}")
                if len(non_attribues) > 25:
                    print(f"      ... et {len(non_attribues) - 25} autre(s)")
                sys.exit("Rien n'a ete inscrit. Ces objets ont ete changes hors des migrations (fichier source "
                         "recharge, geste a la main) : lisez-les, puis relancez avec --accepter-non-attribues "
                         "si la base est bien dans l'etat voulu.")
            for e in non_attribues:
                print(f"  ecart non attribue, accepte nommement : {e}")
            if echecs:
                print(f"  {echecs} instruction(s) ne se rejouent pas (donnees deja chargees) : "
                      "sautees, sans incidence sur le schema compare.")
        # Apres lecture du rapport : une migration dont l'objet a ete remplace hors
        # des migrations (rechargement d'un fichier source) s'accepte nommement.
        acceptees = set(filter(None, (option("--accepter") or "").split(",")))
        for nom in acceptees & set(refusees):
            print(f"  acceptee apres examen : {nom}")
            refusees.pop(nom)
        n = 0
        for f in candidates:
            if f.name in refusees:
                print(f"  PAS INSCRITE {f.name} : elle change encore le schema, elle n'a donc pas "
                      "ete (entierement) jouee. Ce qu'elle changerait :")
                for e in refusees[f.name][:12]:
                    print(f"      {e}")
                continue
            inscrire(base, f.name, empreinte(f), "MARQUEE")
            n += 1
        print(f"{n} migration(s) inscrite(s) sans etre rejouees, jusqu'a {limite} ; "
              f"{len(refusees)} refusee(s).")
        if refusees:
            sys.exit("Des migrations ne sont pas (telles quelles) dans la base. Pour chacune : si elle n'a "
                     "jamais ete jouee, jouez-la (psql -f) ; si ses objets ont ete remplaces depuis par un "
                     "fichier source, relancez avec --accepter <fichier>[,<fichier>].")
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
        # Tous les avis : le second de 08m (« DATES MAL FORMEES ») etait avale.
        print(f"  ok {f.name}" + "".join(f"\n      {a}" for a in avis))
    # LES STATISTIQUES (10/10/2026) : une base remplie d'un coup n'en a pas tant que l'autovacuum n'est pas passe ; la supervision y prenait 46 s au lieu de 1,2 s.
    base.requete("ANALYZE")
    print(f"{len(a_jouer)} migration(s) jouee(s) sur {nom_base}.")


if __name__ == "__main__":
    main()
