# -*- coding: utf-8 -*-
"""
SUR QUOI LES ECRITURES ATTENDENT-ELLES ? (audit D1-D2, 17/10/2026)

Le banc de charge a montre que les ecritures ne montent pas en charge, et
qu'ecrire sur des references DIFFERENTES n'est pas plus rapide que sur LA MEME :
signe d'un point de passage unique. Plutot que de le deviner, ce script le
mesure : pendant une charge d'ecritures, il echantillonne `pg_stat_activity`
toutes les 100 ms et compte, pour chaque connexion active, ce qu'elle attend
et quelle requete elle execute.

Usage : python backend/tests/charge/diagnostic_attentes.py --cible <CARGO_TARGET_DIR> [--sessions 10] [--duree 15]
"""
import collections
import re
import sys
import threading
import time
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI))
sys.path.insert(0, str(ICI.parent / "banc"))
import banc  # noqa: E402
import charge  # noqa: E402


def main():
    args = sys.argv[1:]

    def option(nom, defaut):
        return args[args.index(nom) + 1] if nom in args else defaut

    sessions = int(option("--sessions", "10"))
    duree = float(option("--duree", "15"))
    infra_args = list(args)
    for nom in ("--sessions", "--duree"):
        if nom in infra_args:
            k = infra_args.index(nom)
            del infra_args[k:k + 2]
    infra = banc.Infra(infra_args + ["--port", str(charge.PORT)])
    print(f"diagnostic : base {infra.base}, {sessions} sessions d'ecriture, {duree:.0f} s", flush=True)
    try:
        infra.batir()
        infra.demarrer()
        c = banc.Client(f"http://127.0.0.1:{charge.PORT}")
        c.ok(charge.LOGIN, "GET", "/api/auth/moi")
        liste = infra.valeur("SELECT string_agg(code_reference, '|') FROM (SELECT code_reference FROM reference "
                             "WHERE actif = 1 AND COALESCE(suivi_lot::int, 0) = 0 ORDER BY 1 LIMIT 40) s") or ""
        refs = [r for r in liste.split("|") if r and charge.entree(c, r, 5000)[0] == 200]
        print(f"  {len(refs)} references", flush=True)

        echantillons = collections.Counter()
        requetes = collections.Counter()
        fin_mesure = threading.Event()

        def echantillonner():
            q = ("SELECT COALESCE(wait_event_type, 'CPU') || ':' || COALESCE(wait_event, '-') "
                 "|| '|' || regexp_replace(left(query, 70), '[\\s|]+', ' ', 'g') "
                 f"FROM pg_stat_activity WHERE datname = '{infra.base}' AND state = 'active' "
                 "AND pid <> pg_backend_pid()")
            while not fin_mesure.is_set():
                # `Infra.sql` rend des lignes deja decoupees ; la requete n'a qu'une colonne.
                for ligne, *_ in infra.sql(q):
                    if "|" in ligne:
                        attente, requete = ligne.split("|", 1)
                        echantillons[attente] += 1
                        if attente.startswith("Lock"):
                            requetes[re.sub(r"\$\d+", "?", requete.strip())] += 1
                time.sleep(0.1)

        sondeur = threading.Thread(target=echantillonner)
        sondeur.start()
        r = charge.courir(sessions, duree, charge.scenario_refs_differentes(c, refs))
        fin_mesure.set()
        sondeur.join()

        total = sum(echantillons.values()) or 1
        print(f"  ecritures : {r['debit_par_s']} /s, p95 {r['p95_ms']} ms, statuts {r['statuts']}")
        print("  CE QU'ATTENDENT LES CONNEXIONS ACTIVES (part des echantillons) :")
        for attente, n in echantillons.most_common(8):
            print(f"    {100 * n / total:5.1f} %  {attente}")
        print("  REQUETES EN ATTENTE D'UN VERROU :")
        for requete, n in requetes.most_common(5):
            print(f"    {n:5}  {requete}")
    finally:
        infra.arreter(False)


if __name__ == "__main__":
    sys.exit(main())
