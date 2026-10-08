# -*- coding: utf-8 -*-
"""
Les scenarios du banc (voir banc.py). Chacun part d'un etat qu'il cree
lui-meme — un bon, une reception, du stock — et verifie, par l'API comme un
utilisateur et par SQL comme un controleur, que les regles tiennent.

Comptes (seed_110) : Assistante (ASSISTANTE), Choukri et Mohamed (DIRECTION),
Magasinie (MAGASIN), admin (ADMIN). Fournisseur FRS-011 (MAD), references
PLA 100 CHE et PLA 50 CHE (sans suivi de lot), magasins Morocco et Polyfashions.
"""
from banc import Echec, verifier

FRS = "FRS-011"
REF = "PLA 100 CHE"
REF2 = "PLA 50 CHE"
MAG = "Morocco"


# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------
def kg(infra, ref=REF, mag=MAG):
    v = infra.valeur(f"SELECT quantite_kg FROM stock_magasin WHERE code_reference = '{ref}' AND code_magasin = '{mag}'")
    return float(v) if v is not None else 0.0


def cmup_magasin(infra, ref=REF, mag=MAG):
    v = infra.valeur(f"SELECT cmup_mad FROM stock_magasin WHERE code_reference = '{ref}' AND code_magasin = '{mag}'")
    return float(v) if v is not None else None


def controle(infra, code):
    return int(infra.valeur(f"SELECT anomalies FROM v_controles WHERE code = '{code}'"))


def bon_envoye(c, lignes, frs=FRS):
    """Un bon saisi par l'assistante, valide par la Direction, envoye. Rend (id_bc, lignes du bon)."""
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": frs,
        "lignes": [{"code_reference": r, "unite_commande": "kg", "quantite_commandee_unite": q,
                    "prix_unitaire_devise": p} for r, q, p in lignes],
    })
    id_bc = bc["id_bc"]
    c.ok("Assistante", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "EN_ATTENTE_VALIDATION"})
    c.ok("Choukri", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.ok("Choukri", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "ENVOYE"})
    lignes = c.ok("Choukri", "GET", f"/api/bons-commande/{id_bc}/lignes")
    if isinstance(lignes, dict):
        lignes = lignes.get("lignes", [])
    return id_bc, lignes


def reception_validee(c, id_bc, lignes_bc, pesees, mag=MAG, **ligne_extra):
    """Pesee par le magasinier, soumise, validee par la Direction. Rend l'id de la reception."""
    lignes = []
    for lb, q in zip(lignes_bc, pesees):
        lignes.append(dict({"code_reference": lb["code_reference"], "id_ligne_bc": lb["id_ligne_bc"],
                            "unite_saisie": "kg", "quantite_pesee_unite": q, "code_magasin_dest": mag},
                           **ligne_extra))
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "num_bon_livraison": "BL-BANC", "lignes": lignes})
    rid = r["id_reception"]
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    return rid


def entree_stock(c, ref, quantite, prix=20.0, mag=MAG):
    id_bc, lignes = bon_envoye(c, [(ref, quantite, prix)])
    return reception_validee(c, id_bc, lignes, [quantite], mag=mag)


def mouvement(c, login, type_mvt, lignes, mag=MAG, motif="PRODUCTION", motif_ligne=None, **extra):
    corps = {"code_type_mvt": type_mvt, "code_magasin": mag, "code_motif": motif,
             "lignes": [{"code_reference": r, "quantite_saisie": q, "unite_saisie": "kg",
                         "code_motif_ligne": motif_ligne} for r, q in lignes]}
    corps.update(extra)
    return c.appel(login, "POST", "/api/mouvements", corps)


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------
def scenario_bon_segregation(c, infra):
    """Creer un bon et le valider sont deux mains (B4) ; un bon valide puis devalide ne s'efface pas."""
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": FRS,
        "lignes": [{"code_reference": REF, "unite_commande": "kg", "quantite_commandee_unite": 500,
                    "prix_unitaire_devise": 20}]})
    id_bc = bc["id_bc"]
    c.ok("Assistante", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "EN_ATTENTE_VALIDATION"})
    c.refus("Assistante", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.refus("Magasinie", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.ok("Choukri", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.ok("Choukri", "POST", f"/api/devalider/bons-commande/{id_bc}", {"motif": "Essai du banc : retour en brouillon"})
    c.refus("Assistante", "DELETE", f"/api/bons-commande/{id_bc}", contient="annulez")


def scenario_reception_cloture_avoir(c, infra):
    """Reception 3-en-1, cloture par facture sur les lots de la reception, avoir, pas de devalidation."""
    avant = kg(infra)
    id_bc, lignes = bon_envoye(c, [(REF, 1000, 20)])
    # Le saisisseur ne valide pas sa propre pesee (B4-2).
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "num_bon_livraison": "BL-1", "lignes": [{
        "code_reference": REF, "id_ligne_bc": lignes[0]["id_ligne_bc"], "unite_saisie": "kg",
        "quantite_pesee_unite": 1010, "code_magasin_dest": MAG}]})
    rid = r["id_reception"]
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.refus("Magasinie", "POST", f"/api/receptions/{rid}/valider")
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    verifier(abs(kg(infra) - avant - 1010) < 1e-6, f"stock attendu +1010 kg, obtenu {kg(infra) - avant}")
    verifier(controle(infra, "C11") == 0, "C11 : le cache s'ecarte du grand livre apres la reception")

    # Le magasinier ne voit pas les montants de la reception (regle 16).
    texte = str(c.ok("Magasinie", "GET", "/api/receptions")) + str(c.ok("Magasinie", "GET", f"/api/receptions/{rid}/lignes"))
    for champ in ("total_mad", "prix_kg_mad", "montant_facture_mad"):
        verifier(f"'{champ}'" not in texte, f"le magasinier lit {champ} sur les receptions")

    # Cloture : +10 % sur 1 010 kg tous encore la -> tout au stock de Morocco.
    ap = c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer",
              {"numero_facture": "F-BANC-1", "montant_facture": 22220, "frais_mad": 0, "simuler": True})
    verifier(abs(ap["difference_mad"] - 2020) < 0.01, f"difference attendue 2 020, obtenue {ap['difference_mad']}")
    verifier(abs(ap["ecart_prix_mad"]) < 0.01, "rien n'est sorti : pas d'ecart de prix attendu")
    cm_avant = cmup_magasin(infra)
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer",
         {"numero_facture": "F-BANC-1", "montant_facture": 22220, "frais_mad": 0})
    cm_apres = cmup_magasin(infra)
    verifier(abs(cm_apres - (cm_avant + 2020 / kg(infra))) < 0.0002,
             f"CMUP Morocco : {cm_avant} + 2020/{kg(infra)} attendu, obtenu {cm_apres}")
    # Un avoir sans motif est refuse ; motive, il baisse le CMUP du meme calcul.
    c.refus("Choukri", "POST", f"/api/receptions/{rid}/avoir",
            {"nature": "AVOIR", "numero_piece": "AV-1", "montant_mad": 1010, "motif": ""})
    c.refus("Magasinie", "POST", f"/api/receptions/{rid}/avoir",
            {"nature": "AVOIR", "numero_piece": "AV-1", "montant_mad": 1010, "motif": "Remise du mois"}, codes=(403,))
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/avoir",
         {"nature": "AVOIR", "numero_piece": "AV-1", "montant_mad": 1010, "motif": "Remise du mois"})
    verifier(abs(cmup_magasin(infra) - (cm_apres - 1010 / kg(infra))) < 0.0002, "l'avoir n'a pas baisse le CMUP")
    n = int(infra.valeur(f"SELECT count(*) FROM reception_ajustements_cmup WHERE id_reception = '{rid}' AND origine = 'AVOIR'"))
    verifier(n >= 1, "l'avoir n'est pas journalise")
    # Cloturee, elle ne recule plus.
    c.refus("Choukri", "POST", f"/api/devalider/receptions/{rid}", {"motif": "Essai : devalider une cloture"})
    c.refus("Choukri", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})


def scenario_ecart_pesee(c, infra):
    """L'excedent au-dela de la tolerance du fournisseur demande une derogation motivee ; le manque, non."""
    id_bc, lignes = bon_envoye(c, [(REF, 1000, 20)])
    lb = lignes[0]
    base = {"code_reference": REF, "id_ligne_bc": lb["id_ligne_bc"], "unite_saisie": "kg", "code_magasin_dest": MAG}
    # +5 % sans derogation : refus (a la creation ou a la soumission).
    code, r = c.appel("Magasinie", "POST", "/api/receptions",
                      {"id_bc": id_bc, "lignes": [dict(base, quantite_pesee_unite=1050)]})
    if code == 200:
        c.refus("Magasinie", "PUT", f"/api/receptions/{r['id_reception']}/statut", {"statut": "A_CONTROLER"})
        c.ok("Magasinie", "PUT", f"/api/receptions/{r['id_reception']}/statut", {"statut": "ANNULE"})
    else:
        verifier(code == 422, f"excedent sans derogation : 422 attendu, obtenu {code} {r}")
    # Un manque de 30 % : une livraison partielle, sans derogation.
    rid = reception_validee(c, id_bc, lignes, [700])
    verifier(controle(infra, "C10") == 0, "C10 leve sur une livraison partielle")
    # Le reste (300 kg) : +5 % avec derogation motivee passe.
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "lignes": [dict(
        base, quantite_pesee_unite=315, derogation_ecart=True, motif_derogation="Accord du fournisseur, avenant 3")]})
    c.ok("Magasinie", "PUT", f"/api/receptions/{r['id_reception']}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{r['id_reception']}/valider")


def scenario_saisie_libre(c, infra):
    """Saisie libre : ajustements et gros dechets a VALIDER, retour fournisseur rattache a sa reception."""
    rid = entree_stock(c, REF2, 400)
    numero = infra.valeur(f"SELECT numero_reception FROM reception WHERE id_reception = '{rid}'")
    # Le magasinier : petit dechet oui, gros non, ajustement non.
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(REF2, 20)], numero_of="OF-BANC")
    verifier(code == 200, f"dechet de 20 kg refuse au magasinier : {r}")
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(REF2, 60)], numero_of="OF-BANC")
    verifier(code == 422, f"dechet de 60 kg accepte au magasinier : {code} {r}")
    code, r = mouvement(c, "Magasinie", "AJUST_INV_NEG", [(REF2, 5)], motif="INVENTAIRE")
    verifier(code == 403, f"ajustement accepte au magasinier : {code} {r}")
    # Le retour fournisseur : VALIDER des receptions, rattache, plafonne.
    code, r = mouvement(c, "Magasinie", "RETOUR_FOURN", [(REF2, 10)], motif="RETOUR_FOUR", reference_document=numero)
    verifier(code == 403, f"retour fournisseur accepte au magasinier : {code}")
    code, r = mouvement(c, "Choukri", "RETOUR_FOURN", [(REF2, 10)], motif="RETOUR_FOUR")
    verifier(code == 422, f"retour sans reception accepte : {code} {r}")
    code, r = mouvement(c, "Choukri", "RETOUR_FOURN", [(REF2, 500)], motif="RETOUR_FOUR", reference_document=numero)
    verifier(code == 422, f"retour au-dela du recu accepte : {code} {r}")
    code, r = mouvement(c, "Choukri", "RETOUR_FOURN", [(REF2, 30)], motif="RETOUR_FOUR", motif_ligne="R1",
                        reference_document=numero)
    verifier(code == 200, f"retour de 30 kg refuse : {r}")
    # Le prix d'une sortie ou d'une entree libre est le CMUP, jamais une saisie.
    verifier(controle(infra, "C11") == 0, "C11 apres la saisie libre")


def scenario_stock_jamais_negatif(c, infra):
    """R02 : une sortie au-dela du stock est refusee par la base, et le message remonte tel quel."""
    stock = kg(infra, REF2)
    code, r = mouvement(c, "Choukri", "SORTIE_PROD", [(REF2, stock + 1)], numero_of="OF-BANC")
    verifier(code == 422 and "R02" in str(r), f"sortie au-dela du stock : {code} {r}")


def scenario_contre_passation(c, infra):
    """Defaire sans effacer : l'inverse est poste, le stock revient, l'original reste."""
    entree_stock(c, REF2, 200)
    avant = kg(infra, REF2)
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(REF2, 15)], numero_of="OF-BANC")
    verifier(code == 200, f"dechet refuse : {r}")
    id_mvt = r["id_mouvement"]
    c.refus("Magasinie", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Erreur de saisie"}, codes=(403,))
    c.refus("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": ""})
    c.ok("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Erreur de saisie du banc"})
    verifier(abs(kg(infra, REF2) - avant) < 1e-6, "le stock n'est pas revenu apres la contre-passation")
    n = int(infra.valeur(f"SELECT count(*) FROM mouvement WHERE id_mouvement = '{id_mvt}'"))
    verifier(n == 1, "le mouvement d'origine a disparu")
    c.refus("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Deuxieme fois"})


def scenario_inventaire(c, infra):
    """Un seul inventaire en cours par magasin ; le magasinier compte, la Direction cloture."""
    entree_stock(c, REF, 300, mag="Polyfashions")
    inv = c.ok("Choukri", "POST", "/api/inventaires", {"code_magasin": "Polyfashions", "type_inventaire": "GLOBAL"})
    iid = inv["id_inventaire"]
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/ouvrir")
    inv2 = c.ok("Choukri", "POST", "/api/inventaires", {"code_magasin": "Polyfashions", "type_inventaire": "GLOBAL"})
    c.refus("Choukri", "POST", f"/api/inventaires/{inv2['id_inventaire']}/ouvrir")
    lignes = c.ok("Magasinie", "GET", f"/api/inventaires/{iid}/lignes")
    ligne = next(l for l in lignes if l["code_reference"] == REF)
    theorique = float(ligne["quantite_theorique_kg"])
    # Un inventaire global se clot quand TOUTES ses lignes sont comptees : les
    # autres au theorique, la notre avec 12 kg de moins.
    comptages = [{"code_reference": l["code_reference"], "code_magasin": "Polyfashions",
                  "lot_fournisseur": l.get("lot_fournisseur"),
                  "quantite_comptee_kg": float(l["quantite_theorique_kg"] or 0)} for l in lignes if l is not ligne]
    comptages.append({"code_reference": REF, "code_magasin": "Polyfashions",
                      "lot_fournisseur": ligne.get("lot_fournisseur"),
                      "quantite_comptee_kg": theorique - 12, "motif_ecart": "Bobine abimee au quai"})
    c.ok("Magasinie", "PUT", f"/api/inventaires/{iid}/lignes", {"comptages": comptages})
    c.refus("Magasinie", "POST", f"/api/inventaires/{iid}/cloturer", codes=(403,))
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/cloturer")
    verifier(abs(kg(infra, REF, "Polyfashions") - (theorique - 12)) < 1e-6, "la cloture n'a pas ajuste le stock")
    c.refus("Choukri", "POST", f"/api/inventaires/{iid}/cloturer")
    c.ok("Choukri", "POST", f"/api/inventaires/{inv2['id_inventaire']}/annuler", {"motif": "Doublon du banc"})
    verifier(controle(infra, "C44") == 0, "C44 : deux inventaires en cours")


def scenario_colisage_signale(c, infra):
    """Un colisage absurde se signale (C43), il ne bloque pas (decision du 08/10)."""
    ref = infra.valeur("SELECT code_reference FROM reference WHERE poids_bobine_kg > 0 AND bobines_par_palette > 0 "
                       "AND code_fournisseur IS NOT NULL ORDER BY code_reference LIMIT 1")
    verifier(ref is not None, "aucune reference avec conditionnement dans le referentiel du banc")
    frs = infra.valeur(f"SELECT code_fournisseur FROM reference WHERE code_reference = '{ref}'")
    avant = controle(infra, "C43")
    code, r = c.appel("Assistante", "POST", "/api/bons-commande", {"code_fournisseur": frs, "lignes": [{
        "code_reference": ref, "unite_commande": "kg", "quantite_commandee_unite": 4032,
        "prix_unitaire_devise": 10, "nb_bobines": 1920, "nb_palettes": 20}]})
    verifier(code == 200, f"un colisage incoherent bloque le bon : {code} {r}")
    verifier(controle(infra, "C43") > avant, "C43 ne signale pas le colisage incoherent")


def scenario_declencheurs(c, infra):
    """Les invariants en base : grand livre, audit et journal de cloture immuables."""
    for requete, quoi in (
        ("UPDATE ligne_mouvement SET quantite_kg = quantite_kg + 1 WHERE id_mouvement = "
         "(SELECT id_mouvement FROM ligne_mouvement LIMIT 1)", "le grand livre"),
        ("DELETE FROM audit_log WHERE id_audit = (SELECT id_audit FROM audit_log LIMIT 1)", "le journal d'audit"),
        ("UPDATE reception_ajustements_cmup SET montant_mad = 0 WHERE id_ajustement = "
         "(SELECT id_ajustement FROM reception_ajustements_cmup LIMIT 1)", "le journal de cloture"),
    ):
        table = requete.split()[1] if requete.startswith("UPDATE") else requete.split()[2]
        verifier(int(infra.valeur(f"SELECT count(*) FROM {table}")) > 0,
                 f"{quoi} est vide : rien a tenter (scenario joue trop tot)")
        try:
            infra.sql(requete)
        except RuntimeError:
            continue
        raise Echec(f"{quoi} s'est laisse modifier")


def scenario_masquage(c, infra):
    """Le magasinier ne lit aucun prix ; l'assistante lit le montant de ses bons (regression du 08/10)."""
    lots = c.ok("Magasinie", "GET", "/api/stock/lots")
    verifier("prix_entree_mad" not in str(lots), "le magasinier lit le prix d'entree des lots")
    stock = c.ok("Magasinie", "GET", "/api/stock")
    verifier("cmup_mad" not in str(stock), "le magasinier lit le CMUP")
    bons = c.ok("Assistante", "GET", "/api/bons-commande")
    verifier(any(b.get("montant_total_mad") for b in bons), "l'assistante ne lit plus le montant de ses bons")


def scenario_controles_finaux(c, infra):
    """Apres tout le banc : cache = grand livre, stock lot = stock magasin, tableau de bord en 200."""
    for code in ("C11", "C15"):
        verifier(controle(infra, code) == 0, f"{code} non nul a la fin du banc")
    c.ok("Choukri", "GET", "/api/cockpit")
    verifier(int(infra.valeur("SELECT count(*) FROM v_controles")) >= 40, "v_controles incomplet")


def scenario_import(c, infra):
    """Dossier d'import : facture au cours BAM, reception avec derogation, pesee figee au controle,
    validation, cloture qui porte les frais aux lots du dossier."""
    ref = "PP-1500 Dtex-Cream 2951-Hs"
    aujourdhui = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    d = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/26", "code_devise": "USD"})
    id_dossier = d.get("id_dossier") or d.get("id")
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={aujourdhui}")["reference"]
    verifier(cours and cours > 1, f"pas de cours BAM pour l'USD : {cours}")
    # Le taux 1 en devise est refuse (regle 18).
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-0", "date_facture": aujourdhui,
        "code_devise": "USD", "taux_change": 1, "montant_devise": 2000})
    f = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-1", "date_facture": aujourdhui,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 2000})
    id_facture = f.get("id_facture") or f.get("id")
    c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", {
        "type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 1000, "poids_net_kg": 1000,
        "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-BANC-1"})
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais", {
        "id_frais": "DOUANE", "numero_piece": "DUM-BANC", "montant_devise": 5000, "code_devise": "MAD"})

    ligne = next(x for x in c.ok("Magasinie", "GET", "/api/import/a-recevoir") if x["code_reference"] == ref
                 and x["numero_dossier"] == "BANC/26")
    verifier(ligne.get("tolerance_pesee_pct") is not None, "la tolerance du fournisseur ne descend pas a l'ecran")
    base = {"id_ligne": ligne["id_ligne"], "quantite_recue_kg": 1050, "code_magasin": MAG,
            "lot_fournisseur": "LOT-BANC-1"}
    r = c.ok("Magasinie", "POST", "/api/import/receptions", {"date_reception": aujourdhui, "lignes": [base]})
    rid = r["id_reception"]
    c.refus("Magasinie", "PUT", f"/api/import/receptions/{rid}/statut", {"statut": "A_CONTROLER"}, contient="tolérance")
    c.refus("Magasinie", "PUT", f"/api/import/receptions/{rid}",
            {"lignes": [dict(base, derogation_ecart=1, motif_derogation="ok")]})
    motive = dict(base, derogation_ecart=1, motif_derogation="Accord du fournisseur, avoir a venir")
    c.ok("Magasinie", "PUT", f"/api/import/receptions/{rid}", {"lignes": [motive]})
    c.ok("Magasinie", "PUT", f"/api/import/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    # Au controle, la pesee est figee ; le verdict ne l'est pas.
    c.refus("Choukri", "PUT", f"/api/import/receptions/{rid}", {"lignes": [dict(motive, quantite_recue_kg=1040)]})
    c.refus("Magasinie", "POST", f"/api/import/receptions/{rid}/valider")
    avant = kg(infra, ref)
    c.ok("Choukri", "POST", f"/api/import/receptions/{rid}/valider")
    verifier(abs(kg(infra, ref) - avant - 1050) < 1e-6, "l'import n'est pas entre en stock")
    cm = cmup_magasin(infra, ref)
    verifier(abs(cm - 2.0 * cours) < 0.01, f"CMUP d'entree attendu {2.0 * cours:.4f} (prix x cours), obtenu {cm}")

    # Cloture : les 5 000 MAD de douane vont au lot du dossier, tout encore la.
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": True})
    verifier(abs(ap["ecart_stock_dhs"] - 5000) < 0.01 and abs(ap["ecart_consomme_dhs"]) < 0.01,
             f"frais attendus 5 000 au stock, obtenus {ap['ecart_stock_dhs']} / {ap['ecart_consomme_dhs']}")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": False})
    verifier(abs(cmup_magasin(infra, ref) - (cm + 5000 / kg(infra, ref))) < 0.0002, "les frais n'ont pas rejoint le CMUP")
    verifier(controle(infra, "C10") == 0, "C10 leve malgre la derogation")


def scenario_colisage_ecran_et_base(c, infra):
    """Le controle SQL (fn_controle_colisage) rend le meme verdict que l'ecran sur les cas partages
    (cas_colisage.json, joues aussi par frontend/tests). La base ne parle que d'« incoherent »."""
    import json
    from pathlib import Path
    d = json.loads((Path(__file__).parent / "cas_colisage.json").read_text(encoding="utf-8"))
    ref = "PLA 140 CHE"
    infra.sql(f"UPDATE reference SET poids_bobine_kg = {d['poids_bobine_kg']}, "
              f"bobines_par_palette = {d['bobines_par_palette']} WHERE code_reference = '{ref}'")
    infra.sql(f"UPDATE parametre SET valeur_courante = '{d['refus_pct']}' WHERE code_parametre = 'P_ColisageTolRefusPct'")
    sql = lambda v: "NULL" if v is None else str(v)
    for cas in d["cas"]:
        msg = infra.valeur(f"SELECT COALESCE(fn_controle_colisage('{ref}', {sql(cas['kg'])}, "
                           f"{sql(cas['bobines'])}, {sql(cas['palettes'])}), '')")
        verifier(bool(msg) == (cas["attendu"] == "incoherent"),
                 f"« {cas['nom']} » : la base dit {msg or 'rien'}, l'ecran dit {cas['attendu']}")


SCENARIOS = [
    scenario_bon_segregation,
    scenario_reception_cloture_avoir,
    scenario_ecart_pesee,
    scenario_saisie_libre,
    scenario_stock_jamais_negatif,
    scenario_contre_passation,
    scenario_inventaire,
    scenario_colisage_signale,
    scenario_colisage_ecran_et_base,
    scenario_import,
    scenario_declencheurs,
    scenario_masquage,
    scenario_controles_finaux,
]
