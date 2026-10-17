# -*- coding: utf-8 -*-
"""
Les scenarios du banc (voir banc.py). Chacun part d'un etat qu'il cree
lui-meme — un bon, une reception, du stock — et verifie, par l'API comme un
utilisateur et par SQL comme un controleur, que les regles tiennent.

Comptes (seed_110) : Assistante (ASSISTANTE), Choukri et Mohamed (DIRECTION),
Magasinie (MAGASIN), admin (ADMIN). Fournisseur FRS-011 (MAD), references
PLA 100 CHE et PLA 50 CHE (sans suivi de lot), magasins Morocco et Polyfashions.
"""
import time
import urllib.request

from banc import MOT_DE_PASSE, PSQL, Echec, verifier

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


def refus_sql(infra, requete, contient):
    """La base doit refuser la requete, et pour la raison attendue (un refus quelconque ne prouve rien)."""
    try:
        infra.sql(requete)
    except RuntimeError as e:
        verifier(contient.lower() in str(e).lower(), f"refus sans « {contient} » : {str(e)[:300]}")
        return
    raise Echec(f"la base a accepte : {requete[:120]}")


def bon_envoye(c, lignes, frs=FRS, date_bc=None):
    """Un bon saisi par l'assistante, valide par la Direction, envoye. Rend (id_bc, lignes du bon)."""
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": frs, **({"date_bc": date_bc} if date_bc else {}),
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


def dossier_avant_bascule(c, infra, numero, devise="USD"):
    """Un dossier d'import de l'ANCIEN circuit : celui qui recoit par ses LIGNES DE FACTURE.

    Depuis la phase C (ADR-003), un dossier neuf nait en `circuit_reception = 'BON'` : sa
    marchandise se pese dans la reception unifiee. Les dossiers OUVERTS AVANT la bascule, eux,
    finissent par l'ecran qui les a vus naitre — leur marchandise est en route et leurs factures
    portent deja des kilos recus. C'est cette population que l'on simule ici, parce qu'elle doit
    continuer de marcher : `scenario_import` et `scenario_import_coherence` la prouvent.
    Rend l'id du dossier."""
    d = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": numero, "code_devise": devise})
    id_dossier = d.get("id_dossier") or d.get("id")
    infra.sql(f"UPDATE import_dossiers SET circuit_reception = 'FACTURE' WHERE id_dossier = '{id_dossier}'")
    return id_dossier


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


def retour_fournisseur(c, lignes, fournisseur="FRS-001", saisie="Magasinie", valideur="Choukri", motif_ligne="R1"):
    """Un retour fournisseur LIBRE (12/10/2026) : brouillon par un compte, validation par un autre.
    `lignes` : [(reference, kg, magasin, prix)] ; le lot est le premier que le magasin porte (sinon sans
    lot). Rend (code, corps) de la validation, ou de la creation si elle echoue."""
    dispo = c.ok(saisie, "GET", "/api/retours-fournisseur/disponible")
    corps = {"code_fournisseur": fournisseur, "motif": "Retour au fournisseur (banc)", "lignes": []}
    for ref, q, mag, prix in lignes:
        # La ligne de stock qui porte la quantite (le plus gros lot d'abord).
        p = max((x for x in dispo if x["code_reference"] == ref and x["code_magasin"] == mag),
                key=lambda x: x["quantite_kg"], default=None)
        corps["lignes"].append({"code_reference": ref, "code_magasin": mag,
                                "lot_fournisseur": p["lot_fournisseur"] if p else None,
                                "quantite_kg": q, "prix_kg_mad": prix, "code_motif_ligne": motif_ligne})
    code, r = c.appel(saisie, "POST", "/api/retours-fournisseur", corps)
    if code != 200:
        return code, r
    return c.appel(valideur, "POST", f"/api/retours-fournisseur/{r['id_retour']}/valider")


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
    # F18 (09/10) : cloturee, elle reste au cout de revient ; un avoir sur des kilos sortis
    # va au rapport des ecarts de prix.
    verifier(int(infra.valeur(f"SELECT count(*) FROM v_cout_revient WHERE numero_reception = "
                              f"(SELECT numero_reception FROM reception WHERE id_reception = '{rid}')")) >= 1,
             "la reception cloturee a quitte le cout de revient")
    # Presque tout sort (le magasin ne garde que 100 kg de la reference) : l'avoir revient
    # alors surtout a des kilos sortis.
    sortie = round(float(infra.valeur(f"SELECT quantite_kg FROM stock_magasin WHERE code_reference = '{REF}' "
                                      f"AND code_magasin = '{MAG}'")) - 100, 4)
    code, r = mouvement(c, "Choukri", "SORTIE_PROD", [(REF, sortie)], numero_of="OF-BANC-F18")
    verifier(code == 200, f"sortie de {sortie} kg refusee : {r}")
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/avoir",
         {"nature": "AVOIR", "numero_piece": "AV-2", "montant_mad": 1000, "motif": "Remise apres consommation"})
    numero = infra.valeur(f"SELECT numero_reception FROM reception WHERE id_reception = '{rid}'")
    ecarts = c.ok("Choukri", "GET", "/api/ecarts-prix")
    miennes = [l for l in ecarts["lignes"] if l["document"] == numero]
    verifier(miennes and all(l["montant_mad"] < 0 for l in miennes),
             f"l'avoir sur kilos sortis n'apparait pas en gain au rapport : {miennes}")


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
    # LE RETOUR FOURNISSEUR N'EST PLUS UNE SAISIE LIBRE (12/10/2026) : c'est un document LIBRE, sur
    # sa page — fournisseur, references en stock, prix ; brouillon puis validation par un AUTRE compte.
    code, r = mouvement(c, "Choukri", "RETOUR_FOURN", [(REF2, 10)], motif="RETOUR_FOUR", reference_document=numero)
    verifier(code == 422 and "retour fournisseur" in str(r).lower(), f"retour en saisie libre accepte : {code} {r}")
    stock = kg(infra, REF2)
    code, r = retour_fournisseur(c, [(REF2, stock + 1, MAG, 10.0)])
    verifier(code == 422, f"retour au-dela du stock accepte : {code} {r}")
    dispo = c.ok("Magasinie", "GET", "/api/retours-fournisseur/disponible")
    lot = next(x for x in dispo if x["code_reference"] == REF2 and x["code_magasin"] == MAG)["lot_fournisseur"]
    # Le magasinier ne voit pas les prix : sans prix saisi, le retour est propose au CMUP.
    b = c.ok("Magasinie", "POST", "/api/retours-fournisseur", {"code_fournisseur": "FRS-001", "motif": "Defaut de teinte",
             "lignes": [{"code_reference": REF2, "lot_fournisseur": lot, "code_magasin": MAG, "quantite_kg": 30,
                         "code_motif_ligne": "R1"}]})
    cm = cmup_magasin(infra, REF2)
    prix = float(infra.valeur(f"SELECT prix_kg_mad FROM ligne_retour_fournisseur WHERE id_retour = '{b['id_retour']}'"))
    verifier(abs(prix - cm) < 0.0001, f"prix propose {prix} au lieu du CMUP {cm}")
    # Les achats le corrigent : 30 kg rendus a 5 DH de moins que le CMUP.
    c.ok("Choukri", "PUT", f"/api/retours-fournisseur/{b['id_retour']}", {"code_fournisseur": "FRS-001",
         "motif": "Defaut de teinte", "lignes": [{"code_reference": REF2, "lot_fournisseur": lot, "code_magasin": MAG,
                                                  "quantite_kg": 30, "prix_kg_mad": round(cm - 5, 4),
                                                  "code_motif_ligne": "R1"}]})
    avant = kg(infra, REF2)
    c.refus("Magasinie", "POST", f"/api/retours-fournisseur/{b['id_retour']}/valider", codes=(403, 422))
    v = c.ok("Mohamed", "POST", f"/api/retours-fournisseur/{b['id_retour']}/valider")
    verifier(abs(avant - kg(infra, REF2) - 30) < 1e-6 and v["mouvements"], f"retour de 30 kg : {v}")
    attendu = round(cm + 30 * 5 / (avant - 30), 4)
    verifier(abs(cmup_magasin(infra, REF2) - attendu) < 0.0002,
             f"retour a {round(cm - 5, 4)} : CMUP {cmup_magasin(infra, REF2)} au lieu de {attendu}")
    verifier(abs(v["montant_avoir_mad"] - round(30 * round(cm - 5, 4), 2)) < 0.01, f"montant de l'avoir : {v}")
    c.refus("Choukri", "POST", f"/api/retours-fournisseur/{b['id_retour']}/valider")
    c.refus("Choukri", "DELETE", f"/api/retours-fournisseur/{b['id_retour']}")
    # Valide, il est definitif : son mouvement ne se contre-passe pas.
    id_mvt_retour = infra.valeur(f"SELECT id_mouvement FROM ligne_retour_fournisseur WHERE id_retour = '{b['id_retour']}'")
    c.refus("Choukri", "POST", f"/api/mouvements/{id_mvt_retour}/contre-passer",
            {"motif": "Essai : defaire un retour valide"}, contient="RFO-DEFINITIF")
    # Celui qui saisit ne valide pas, quel que soit son droit.
    b2 = c.ok("Choukri", "POST", "/api/retours-fournisseur", {"code_fournisseur": "FRS-001", "motif": "Defaut de teinte",
              "lignes": [{"code_reference": REF2, "lot_fournisseur": lot, "code_magasin": MAG, "quantite_kg": 5,
                          "prix_kg_mad": 10, "code_motif_ligne": "R2"}]})
    verifier(abs(kg(infra, REF2) - avant + 30) < 1e-6, "un brouillon de retour a sorti du stock")
    c.refus("Choukri", "POST", f"/api/retours-fournisseur/{b2['id_retour']}/valider", contient="saisi")
    c.ok("Choukri", "DELETE", f"/api/retours-fournisseur/{b2['id_retour']}")
    # Le prix d'une sortie ou d'une entree libre est le CMUP, jamais une saisie.
    verifier(controle(infra, "C11") == 0, "C11 apres la saisie libre")


def scenario_arrivage_unifie(c, infra):
    """ADR-003 phase A : une reception est un ARRIVAGE — un camion, un BL — dont chaque LIGNE pege a
    une ligne de bon de commande. Un arrivage couvre un bon (local) ou plusieurs (groupage). Le
    dossier d'import se rattache a l'en-tete ; la ligne sans peg fait naitre le bon qui manquait ; et
    l'ancien circuit des lignes de facture est ferme aux dossiers nes depuis la bascule."""
    # Deux bons du meme fournisseur : un seul camion les apporte tous les deux.
    _id_bc1, l1 = bon_envoye(c, [(REF, 300, 20.0)])
    _id_bc2, l2 = bon_envoye(c, [(REF2, 200, 18.0)])

    # L'ARRIVAGE N'A PAS DE BON D'EN-TETE : ce sont ses lignes qui portent le peg.
    r = c.ok("Magasinie", "POST", "/api/receptions", {
        "code_fournisseur": FRS, "num_bon_livraison": "BL-ARRIVAGE",
        "lignes": [
            {"code_reference": REF, "id_ligne_bc": l1[0]["id_ligne_bc"], "unite_saisie": "kg",
             "quantite_pesee_unite": 300, "code_magasin_dest": MAG},
            {"code_reference": REF2, "id_ligne_bc": l2[0]["id_ligne_bc"], "unite_saisie": "kg",
             "quantite_pesee_unite": 200, "code_magasin_dest": MAG},
        ]})
    rid = r["id_reception"]
    verifier(r.get("numero_bc_regularisation") is None,
             f"un bon de regularisation pour un arrivage entierement commande : {r}")

    # D2 : AUCUNE LIGNE SANS SA LIGNE DE BON, et l'arrivage couvre bien deux bons.
    orphelines = int(infra.valeur(
        f"SELECT count(*) FROM ligne_reception WHERE id_reception = '{rid}' AND id_ligne_bc IS NULL"))
    verifier(orphelines == 0, f"{orphelines} ligne(s) recue(s) sans ligne de bon")
    bons = int(infra.valeur(
        "SELECT count(DISTINCT lb.id_bc) FROM ligne_reception lr "
        f"JOIN ligne_bc lb ON lb.id_ligne_bc = lr.id_ligne_bc WHERE lr.id_reception = '{rid}'"))
    verifier(bons == 2, f"l'arrivage couvre {bons} bon(s) au lieu de 2")

    # L'ecran lit les deux bons sur l'arrivage, et chaque ligne dit le sien : sans ce repere, le
    # magasinier ne sait pas contre quelle commande il pese.
    vue = next(x for x in c.ok("Choukri", "GET", "/api/receptions") if x["id_reception"] == rid)
    verifier(vue.get("numero_bc") and "," in vue["numero_bc"],
             f"la liste ne montre pas les deux bons de l'arrivage : {vue.get('numero_bc')}")
    lignes_vues = c.ok("Choukri", "GET", f"/api/receptions/{rid}/lignes")
    verifier(all(x.get("numero_bc") for x in lignes_vues),
             "une ligne recue arrive a l'ecran sans son numero de bon")

    # UNE LIGNE SANS PEG fait naitre le bon qui manquait, en BROUILLON — UN SEUL pour l'arrivage,
    # meme si deux lignes arrivent sans commande.
    c.ok("Magasinie", "POST", f"/api/receptions/{rid}/lignes", {
        "code_reference": REF, "unite_saisie": "kg", "quantite_pesee_unite": 40,
        "code_magasin_dest": MAG})
    c.ok("Magasinie", "POST", f"/api/receptions/{rid}/lignes", {
        "code_reference": REF2, "unite_saisie": "kg", "quantite_pesee_unite": 15,
        "code_magasin_dest": MAG})
    regul = infra.sql("SELECT id_bc, numero_bc, statut FROM bon_commande "
                      f"WHERE id_reception_regularisee = '{rid}'")
    verifier(len(regul) == 1, f"{len(regul)} bon(s) de regularisation pour un seul arrivage : {regul}")
    verifier(regul[0][2] == "BROUILLON",
             f"le bon de regularisation nait {regul[0][2]} au lieu de BROUILLON")
    verifier(int(infra.valeur(f"SELECT count(*) FROM ligne_bc WHERE id_bc = '{regul[0][0]}'")) == 2,
             "les deux lignes sans commande n'ont pas rejoint le meme bon")
    orphelines = int(infra.valeur(
        f"SELECT count(*) FROM ligne_reception WHERE id_reception = '{rid}' AND id_ligne_bc IS NULL"))
    verifier(orphelines == 0, "une ligne ajoutee sans commande est restee sans ligne de bon")

    # Tant que ce bon n'est pas envoye, la marchandise n'est engagee par personne : la validation
    # refuse, en le nommant. C'est tout l'interet de la regularisation.
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.refus("Choukri", "POST", f"/api/receptions/{rid}/valider", contient=regul[0][1])

    # LE DOSSIER D'IMPORT SE RATTACHE A L'EN-TETE. Il porte la DUM et les conteneurs ; il ne
    # remplace pas la commande — le prix de chaque ligne reste celui de son bon.
    dos = c.ok("Choukri", "POST", "/api/import/dossiers",
               {"numero": "BANC/ARRIVAGE", "code_devise": "USD"})
    id_dossier = dos.get("id_dossier") or dos.get("id")
    # DEPUIS LA PHASE C, un dossier neuf nait sur le circuit du bon de commande : sa marchandise
    # se pese ici, et la chaine des frais sait l'y retrouver.
    verifier(infra.valeur("SELECT circuit_reception FROM import_dossiers "
                          f"WHERE id_dossier = '{id_dossier}'") == "BON",
             "un dossier neuf ne nait pas sur le circuit du bon de commande")
    infra.sql("UPDATE import_dossiers SET numero_dum = '123 010 26 456789', "
              f"conteneurs = 'MSCU1234567' WHERE id_dossier = '{id_dossier}'")
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}", {"id_dossier_import": id_dossier})
    vue = next(x for x in c.ok("Choukri", "GET", "/api/receptions") if x["id_reception"] == rid)
    verifier(vue.get("dossier_numero") == "BANC/ARRIVAGE"
             and vue.get("numero_dum") == "123 010 26 456789",
             f"le dossier rattache ne se lit pas sur l'arrivage : {vue.get('dossier_numero')}")
    # Le magasinier choisit son conteneur sans lire les dossiers d'import.
    ouverts = c.ok("Magasinie", "GET", "/api/receptions-dossiers-import")
    verifier(any(d["id_dossier"] == id_dossier for d in ouverts),
             "le dossier ouvert ne descend pas a l'ecran du magasinier")
    # Vide = detacher ; c'est le seul moyen de reparer un rattachement errone.
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}", {"id_dossier_import": ""})
    verifier(infra.valeur("SELECT COALESCE(id_dossier_import, '-') FROM reception "
                          f"WHERE id_reception = '{rid}'") == "-", "le dossier ne se detache pas")
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}", {"id_dossier_import": id_dossier})

    # UN DOSSIER CLOS NE RECOIT PLUS D'ARRIVAGE : sa valeur est deja portee au CUMP.
    clos = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/CLOS", "code_devise": "USD"})
    id_clos = clos.get("id_dossier") or clos.get("id")
    infra.sql("UPDATE import_dossiers SET statut = 'CLOTURE', "
              "date_cloture = to_char(current_date, 'YYYY-MM-DD'), "
              "id_utilisateur_cloture = (SELECT id_utilisateur FROM utilisateur WHERE login = 'Choukri') "
              f"WHERE id_dossier = '{id_clos}'")
    c.refus("Magasinie", "PATCH", f"/api/receptions/{rid}", {"id_dossier_import": id_clos}, contient="clos")

    # L'ANCIEN CIRCUIT EST FERME AUX DOSSIERS NES DEPUIS LA BASCULE : une meme marchandise ne doit
    # pas pouvoir entrer par deux portes.
    #
    # ON NE TOUCHE PAS AUX TAUX ICI. Poser un cours USD du jour (`taux_usd_du_jour`) laissait une
    # ligne de `taux_change` ouverte le jour meme ; `import_coherence`, plus loin, la fermait a la
    # meme date et butait sur `taux_change_check` (date_fin > date_debut). Le cours de reference du
    # jour existe deja au referentiel : on le LIT, comme le scenario import.
    jour = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={jour}")["reference"]
    fac = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-ARRIVAGE", "date_facture": jour,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 200})
    id_facture = fac.get("id_facture") or fac.get("id")
    lig = c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", {
        "type_ligne": "ERP", "code_reference": "PP-1500 Dtex-Cream 2951-Hs", "unite": "kg",
        "quantite": 100, "poids_net_kg": 100, "prix_unitaire_devise": 2.0,
        "lot_fournisseur": "LOT-ARR-1"})
    id_ligne = lig.get("id_ligne") or lig.get("id")
    # L'ANCIEN CIRCUIT N'EXISTE PLUS (16/10/2026). La reception d'import n'etait plus
    # qu'une seconde porte vers la meme marchandise : elle a ete retiree, routes comprises.
    # On ne garde donc plus une frontiere, on verifie que le mur tient — pour TOUS les
    # dossiers, basculés ou non.
    # 405 et non 404 : le serveur renvoie ROUTE_INCONNUE avec un message lisible
    # plutot qu'un 405 muet (cf. routes/mod.rs).
    c.refus("Magasinie", "GET", "/api/import/a-recevoir", codes=(404, 405))
    c.refus("Magasinie", "POST", "/api/import/receptions",
            {"date_reception": jour, "lignes": [{"id_ligne": id_ligne, "quantite_recue_kg": 100,
                                                 "code_magasin": MAG, "lot_fournisseur": "LOT-ARR-1"}]},
            codes=(404, 405))

    verifier(controle(infra, "C11") == 0, "C11 apres l'arrivage unifie")


def scenario_frais_approche_locaux(c, infra):
    """ADR-003 phase C (2/2) : les frais d'approche d'un arrivage LOCAL vont au CUMP, et CHACUN
    SELON SA CLE — un fret au poids, une assurance a la valeur.

    La table `frais_approche` existait depuis le portage et personne ne s'en servait : aucun de
    ces frais n'atteignait le CUMP, et la cloture ne connaissait qu'un total tape sur la facture,
    reparti a la valeur. Reparti ainsi, le fret se fait payer au prix du kilo : la matiere chere
    porte le transport de la matiere lourde. C'est exactement ce que ce scenario mesure.

    Deux references au profil oppose, dans un seul arrivage :
        A = 100 kg a 50 MAD/kg -> 5 000 MAD de valeur, 100 kg de poids
        B = 400 kg a 10 MAD/kg -> 4 000 MAD de valeur, 400 kg de poids
    Fret 1 000 MAD AU POIDS      -> A : 200, B : 800
    Assurance 900 MAD A LA VALEUR -> A : 500, B : 400
                                     A : 700 au total, B : 1 200.
    Tout a la valeur, A en aurait porte 1 055,56 : les deux cles ne se confondent pas."""
    id_bc, lignes = bon_envoye(c, [(REF, 100, 50.0), (REF2, 400, 10.0)])
    rid = reception_validee(c, id_bc, lignes, [100, 400])

    # Les frais se saisissent sur l'arrivage VALIDE : avant, les poids peuvent encore changer, et
    # repartir un fret sur des poids provisoires donnerait un cout a refaire.
    frais = {"id_reception": rid, "code_devise": "MAD", "taux_change": 1.0}
    c.ok("Choukri", "POST", "/api/frais-approche",
         dict(frais, type_frais="FRET", libelle="Transport Tanger-Casablanca",
              montant_devise=1000, cle_repartition="POIDS", reference_externe="FT-BANC-1"))
    c.ok("Choukri", "POST", "/api/frais-approche",
         dict(frais, type_frais="ASSURANCE", libelle="Assurance transport",
              montant_devise=900, cle_repartition="VALEUR", reference_externe="AS-BANC-1"))
    # Le magasinier ne voit pas ces montants : le module Valorisation lui est ferme.
    c.refus("Magasinie", "GET", f"/api/frais-approche?code_reference={rid}", codes=(403,))

    avant_a, stock_a = cmup_magasin(infra, REF), kg(infra, REF)
    avant_b, stock_b = cmup_magasin(infra, REF2), kg(infra, REF2)

    # LA FACTURE AU PRIX DU BON : aucune difference de prix, seuls les frais bougent le CUMP.
    corps = {"numero_facture": "FA-FRAIS-1", "montant_facture": 9000, "frais_mad": 0,
             "date_facture": infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")}
    ap = c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer", dict(corps, simuler=True))
    verifier(abs(ap["difference_mad"]) < 0.01, f"la facture au prix du bon laisse un ecart : {ap['difference_mad']}")
    verifier(abs(ap["frais_arrivage_mad"] - 1900) < 0.01,
             f"frais d'arrivage attendus 1 900, obtenus {ap.get('frais_arrivage_mad')}")
    verifier(abs(ap["valeur_complete_mad"] - 10900) < 0.01,
             f"cout de revient complet attendu 10 900, obtenu {ap.get('valeur_complete_mad')}")
    verifier(abs(cmup_magasin(infra, REF) - avant_a) < 1e-6, "l'apercu de la cloture a ecrit")

    c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer", dict(corps, simuler=False))
    porte_a = (cmup_magasin(infra, REF) - avant_a) * stock_a
    porte_b = (cmup_magasin(infra, REF2) - avant_b) * stock_b
    verifier(abs(porte_a - 700) < 0.05, f"{REF} a porte {porte_a:.2f} MAD de frais au lieu de 700")
    verifier(abs(porte_b - 1200) < 0.05, f"{REF2} a porte {porte_b:.2f} MAD de frais au lieu de 1 200")

    # LE JOURNAL DIT POURQUOI LE CUMP A BOUGE : les frais s'y lisent a part de l'ecart de prix.
    montant_frais = float(infra.valeur(
        "SELECT COALESCE(sum(montant_mad), 0) FROM reception_ajustements_cmup "
        f"WHERE id_reception = '{rid}' AND origine = 'FRAIS' AND nature = 'STOCK'"))
    verifier(abs(montant_frais - 1900) < 0.05,
             f"le journal porte {montant_frais} MAD de frais au stock au lieu de 1 900")

    # PORTE UNE FOIS. Marque, le frais est fige : il a bouge une valeur de stock.
    non_portes = int(infra.valeur(f"SELECT count(*) FROM frais_approche WHERE id_reception = '{rid}' AND date_portee IS NULL"))
    verifier(non_portes == 0, f"{non_portes} frais n'ont pas ete marques portes au CUMP")
    refus_sql(infra, f"UPDATE frais_approche SET montant_devise = 5000 WHERE id_reception = '{rid}'", "FRAIS-PORTE")
    refus_sql(infra, f"DELETE FROM frais_approche WHERE id_reception = '{rid}'", "FRAIS-PORTE")

    verifier(controle(infra, "C11") == 0, "C11 apres les frais d'approche locaux")


def scenario_facture_document(c, infra):
    """ADR-003 phase B : la facture fournisseur est un DOCUMENT — ses lignes pegent aux pesees,
    le rapprochement 3-way se lit avant de signer, et la validation porte l'ecart de prix EXACT
    PAR REFERENCE avant de cloturer les arrivages entierement factures.

    LE POINT QUI SE MESURE ICI. L'ancienne saisie ne connaissait qu'un total : elle repartissait
    la difference au prorata de la valeur provisoire, donc l'ecart d'UNE reference s'etalait sur
    toutes. Avec des lignes, l'ecart de chacune est connu. On facture donc une reference 2 MAD/kg
    plus cher et l'autre au prix du bon : la seconde ne doit PAS bouger. Au prorata, elle aurait
    pris sa part."""
    id_bc, lignes = bon_envoye(c, [(REF, 200, 40.0), (REF2, 100, 10.0)])
    rid = reception_validee(c, id_bc, lignes, [200, 100])

    # CE QUI ATTEND SA FACTURE : les pesees validees que rien ne couvre.
    attente = c.ok("Choukri", "GET", f"/api/factures-fournisseur/a-facturer?fournisseur={FRS}")
    miennes = [x for x in attente if x["id_reception"] == rid]
    verifier(len(miennes) == 2, f"{len(miennes)} pesee(s) a facturer au lieu de 2")
    a = next(x for x in miennes if x["code_reference"] == REF)
    b = next(x for x in miennes if x["code_reference"] == REF2)
    verifier(abs(a["prix_kg_devise"] - 40.0) < 1e-9 and a["numero_bc"],
             f"la pesee a facturer ne porte pas son prix engage ni son bon : {a}")

    # La facture : REF facturee 42 (2 de plus que le bon), REF2 au prix du bon.
    f = c.ok("Choukri", "POST", "/api/factures-fournisseur", {
        "numero_facture": "FF-BANC-1", "code_fournisseur": FRS,
        "lignes": [
            {"id_ligne_reception": a["id_ligne_reception"], "quantite_facturee_kg": 200,
             "prix_kg_devise": 42.0},
            {"id_ligne_reception": b["id_ligne_reception"], "quantite_facturee_kg": 100,
             "prix_kg_devise": 10.0},
        ]})
    idf = f["id_facture"]

    # LE RAPPROCHEMENT 3-WAY se lit ligne par ligne, avant toute ecriture de valeur.
    lu = c.ok("Choukri", "GET", f"/api/factures-fournisseur/{idf}")
    par_ref = {l["code_reference"]: l for l in lu["lignes"]}
    verifier(abs(par_ref[REF]["ecart_prix_devise"] - 2.0) < 1e-9,
             f"ecart de prix attendu +2 sur {REF}, lu {par_ref[REF].get('ecart_prix_devise')}")
    verifier(abs(par_ref[REF2]["ecart_prix_devise"]) < 1e-9,
             f"{REF2} est facturee au prix du bon, son ecart devrait etre nul")
    verifier(abs(par_ref[REF]["ecart_quantite_kg"]) < 1e-9,
             "la quantite facturee egale la pesee : l'ecart devrait etre nul")

    # UNE MEME PESEE NE SE FACTURE PAS DEUX FOIS : la base le refuse sec.
    c.refus("Choukri", "POST", "/api/factures-fournisseur", {
        "numero_facture": "FF-BANC-DOUBLE", "code_fournisseur": FRS,
        "lignes": [{"id_ligne_reception": a["id_ligne_reception"], "quantite_facturee_kg": 200,
                    "prix_kg_devise": 42.0}]}, contient="FACTURE-DOUBLE")

    # L'APERCU N'ECRIT RIEN, et dit ce que la validation fera.
    cm_a, stock_a = cmup_magasin(infra, REF), kg(infra, REF)
    cm_b = cmup_magasin(infra, REF2)
    ap = c.ok("Choukri", "POST", f"/api/factures-fournisseur/{idf}/valider", {"simuler": True})
    verifier(abs(ap["difference_mad"] - 400) < 0.01,
             f"difference attendue +400 (200 kg x 2 MAD), obtenue {ap['difference_mad']}")
    verifier(abs(cmup_magasin(infra, REF) - cm_a) < 1e-6, "l'apercu de la facture a ecrit")
    verifier(infra.valeur(f"SELECT statut FROM facture_fournisseur WHERE id_facture = '{idf}'") == "BROUILLON",
             "l'apercu a valide la facture")

    # LA VALIDATION : l'ecart va a la reference qui l'a, et a elle seule.
    c.ok("Choukri", "POST", f"/api/factures-fournisseur/{idf}/valider", {"simuler": False})
    verifier(abs(cmup_magasin(infra, REF) - (cm_a + 400 / stock_a)) < 0.0002,
             f"{REF} : CMUP {cmup_magasin(infra, REF)} au lieu de {cm_a + 400 / stock_a}")
    verifier(abs(cmup_magasin(infra, REF2) - cm_b) < 1e-6,
             f"{REF2} est facturee au prix du bon et son CMUP a bouge ({cm_b} -> "
             f"{cmup_magasin(infra, REF2)}) : l'ecart n'est pas exact par reference")
    verifier(infra.valeur(f"SELECT statut FROM reception WHERE id_reception = '{rid}'") == "CLOTURE",
             "l'arrivage entierement facture n'est pas cloture")

    # FIGEE : ses lignes et ses montants ne bougent plus.
    refus_sql(infra, f"DELETE FROM ligne_facture_fournisseur WHERE id_facture = '{idf}'", "FACTURE-FIGEE")
    refus_sql(infra, f"UPDATE facture_fournisseur SET taux_change = 2 WHERE id_facture = '{idf}'",
              "FACTURE-FIGEE")
    c.refus("Choukri", "DELETE", f"/api/factures-fournisseur/{idf}", contient="CUMP")

    # UNE REFERENCE SE FACTURE D'UN BLOC : deux pesees de la meme reference ne se coupent pas en
    # deux factures — la valeur provisoire et les lots se tiennent par reference.
    id_bc2, lignes2 = bon_envoye(c, [(REF, 100, 40.0), (REF, 50, 40.0)])
    rid2 = reception_validee(c, id_bc2, lignes2, [100, 50])
    attente2 = [x for x in c.ok("Choukri", "GET", f"/api/factures-fournisseur/a-facturer?fournisseur={FRS}")
                if x["id_reception"] == rid2]
    verifier(len(attente2) == 2, f"{len(attente2)} pesee(s) sur le second arrivage au lieu de 2")
    partielle = c.ok("Choukri", "POST", "/api/factures-fournisseur", {
        "numero_facture": "FF-BANC-2", "code_fournisseur": FRS,
        "lignes": [{"id_ligne_reception": attente2[0]["id_ligne_reception"],
                    "quantite_facturee_kg": attente2[0]["quantite_stock_kg"],
                    "prix_kg_devise": 40.0}]})
    c.refus("Choukri", "POST", f"/api/factures-fournisseur/{partielle['id_facture']}/valider",
            {"simuler": True}, contient="FACTURE-BLOC")
    # Complete, elle passe — et solde l'arrivage.
    c.ok("Choukri", "PATCH", f"/api/factures-fournisseur/{partielle['id_facture']}", {
        "numero_facture": "FF-BANC-2", "code_fournisseur": FRS,
        "lignes": [{"id_ligne_reception": x["id_ligne_reception"],
                    "quantite_facturee_kg": x["quantite_stock_kg"], "prix_kg_devise": 40.0}
                   for x in attente2]})
    c.ok("Choukri", "POST", f"/api/factures-fournisseur/{partielle['id_facture']}/valider",
         {"simuler": False})
    verifier(infra.valeur(f"SELECT statut FROM reception WHERE id_reception = '{rid2}'") == "CLOTURE",
             "le second arrivage n'est pas cloture apres sa facture complete")

    # Le magasinier saisit les pesees, pas les factures : les montants lui sont masques.
    vu = c.ok("Magasinie", "GET", f"/api/factures-fournisseur/{idf}")
    verifier(all("prix_kg_devise" not in l for l in vu["lignes"]),
             "le prix d'une ligne de facture n'est pas masque au magasinier")

    verifier(controle(infra, "C11") == 0, "C11 apres la facture-document")


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
    """Comme un bon (13/10) : brouillon (lignes preparees a la creation, le magasinier compte), valide
    par un AUTRE compte (comptage fige, renvoi possible), cloture ; un seul inventaire ouvert par magasin."""
    entree_stock(c, REF, 300, mag="Polyfashions")
    inv = c.ok("Choukri", "POST", "/api/inventaires", {"code_magasin": "Polyfashions", "type_inventaire": "GLOBAL"})
    iid = inv["id_inventaire"]
    verifier(inv["lignes_a_compter"] > 0, "l'inventaire cree n'a pas ses lignes")
    c.refus("Choukri", "POST", "/api/inventaires", {"code_magasin": "Polyfashions", "type_inventaire": "GLOBAL"},
            codes=(422,), contient="deja ouvert")
    c.refus("Choukri", "POST", f"/api/inventaires/{iid}/valider", codes=(422,), contient="non comptee")
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
    # Un brouillon ne se cloture pas ; le magasinier ne valide pas ; celui qui a compte non plus.
    c.refus("Choukri", "POST", f"/api/inventaires/{iid}/cloturer", codes=(422,), contient="valide")
    c.refus("Magasinie", "POST", f"/api/inventaires/{iid}/valider", codes=(403,))
    c.ok("Mohamed", "PUT", f"/api/inventaires/{iid}/lignes", {"comptages": [comptages[-1]]})
    c.refus("Mohamed", "POST", f"/api/inventaires/{iid}/valider", codes=(422,), contient="INV-SEPARATION")
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/valider")
    verifier(c.ok("Choukri", "GET", f"/api/inventaires/{iid}")["valide_par"] == "Choukri", "le valideur n'est pas lu")
    # Valide : le comptage est fige, au serveur comme en base.
    c.refus("Magasinie", "PUT", f"/api/inventaires/{iid}/lignes", {"comptages": comptages}, codes=(422,))
    refus_sql(infra, f"UPDATE ligne_inventaire SET quantite_comptee_kg = 1 WHERE id_inventaire = '{iid}'", "INV-FIGE")
    # Renvoye au comptage (motif), recompte, revalide.
    c.refus("Choukri", "POST", f"/api/inventaires/{iid}/renvoyer", {"motif": ""}, codes=(422,))
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/renvoyer", {"motif": "Recompter l'allee 3"})
    c.ok("Magasinie", "PUT", f"/api/inventaires/{iid}/lignes", {"comptages": [comptages[-1]]})
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/valider")
    verifier(abs(kg(infra, REF, "Polyfashions") - theorique) < 1e-6, "un inventaire valide a deja touche le stock")
    c.refus("Magasinie", "POST", f"/api/inventaires/{iid}/cloturer", codes=(403,))
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/cloturer")
    verifier(abs(kg(infra, REF, "Polyfashions") - (theorique - 12)) < 1e-6, "la cloture n'a pas ajuste le stock")
    c.refus("Choukri", "POST", f"/api/inventaires/{iid}/cloturer")
    # Clos, le magasin se rouvre a un autre inventaire, qu'on annule.
    inv2 = c.ok("Choukri", "POST", "/api/inventaires", {"code_magasin": "Polyfashions", "type_inventaire": "TOURNANT"})
    c.ok("Choukri", "POST", f"/api/inventaires/{inv2['id_inventaire']}/annuler", {"motif": "Doublon du banc"})
    verifier(controle(infra, "C44") == 0, "C44 : deux inventaires ouverts")


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
    # Un bon a soi, pour ne pas dependre des scenarios precedents.
    c.ok("Assistante", "POST", "/api/bons-commande", {"code_fournisseur": FRS, "lignes": [{
        "code_reference": REF, "unite_commande": "kg", "quantite_commandee_unite": 50, "prix_unitaire_devise": 20}]})
    bons = c.ok("Assistante", "GET", "/api/bons-commande")
    verifier(any(b.get("montant_total_mad") for b in bons), "l'assistante ne lit plus le montant de ses bons")


def scenario_controles_finaux(c, infra):
    """Apres tout le banc : cache = grand livre, stock lot = stock magasin, tableau de bord en 200."""
    for code in ("C11", "C15", "C45"):
        verifier(controle(infra, code) == 0, f"{code} non nul a la fin du banc")
    c.ok("Choukri", "GET", "/api/cockpit")
    # LA LISTE EXACTE (audit v5, U16) : « au moins 40 » laissait passer un controle perdu.
    manquants = infra.valeur("SELECT string_agg(c, ', ') FROM (SELECT 'C' || lpad(g::text, 2, '0') AS c "
                             "FROM generate_series(1, 54) g EXCEPT SELECT code FROM v_controles) x")
    verifier(not manquants, f"controles absents de v_controles : {manquants}")
    verifier(int(infra.valeur("SELECT count(*) FROM v_controles")) == 54, "v_controles porte des doublons")


def scenario_import(c, infra):
    """Dossier d'import : facture au cours BAM, reception avec derogation, pesee figee au controle,
    validation, cloture qui porte les frais aux lots du dossier."""
    ref = "PP-1500 Dtex-Cream 2951-Hs"
    aujourdhui = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    # UN DOSSIER NEUF, DONC EN CIRCUIT BON (ADR-003 phase C) : sa marchandise
    # entre par l'arrivage unifie, comme celle d'un achat local. L'ancien
    # circuit d'import a ete retire le 16/10/2026.
    id_dossier = (lambda d: d.get("id_dossier") or d.get("id"))(
        c.ok("Choukri", "POST", "/api/import/dossiers",
             {"numero": "BANC/26", "code_devise": "USD"}))
    # Un bon en devise ne se valide pas sur un cours de plus de 7 jours.
    taux_usd_du_jour(infra)
    id_bc, lignes_bc = bon_envoye(c, [(ref, 1000, 2.0)], frs="FRS-001")
    lb = lignes_bc[0]["id_ligne_bc"]
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
    lig = c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", {
        "type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 1000, "poids_net_kg": 1000,
        "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-BANC-1", "id_ligne_bc": lb})
    id_ligne_fact = lig.get("id_ligne") or lig.get("id")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais", {
        "id_frais": "DOUANE", "numero_piece": "DUM-BANC", "montant_devise": 5000, "code_devise": "MAD"})

    # LA RECEPTION PASSE PAR L'ARRIVAGE UNIFIE (16/10/2026).
    #
    # L'ecran et les routes de reception d'import ont ete retires : la marchandise
    # importee entre comme la locale, par un arrivage dont chaque ligne pege a une
    # ligne de bon de commande. Les regles que l'ancien circuit gardait sont
    # toutes portees par le chemin unifie — `verifier_ecarts_courants` et
    # `exiger_bobines_comptees` sont appelees a la soumission ET a la validation
    # (routes/stock.rs, domain/reception.rs).
    #
    # UNE CAPACITE A DISPARU AVEC LE CIRCUIT, et il faut le dire : la regle U4
    # — « le verdict part avec la validation, d'un bloc » — n'a plus d'objet. La
    # validation unifiee ne prend AUCUN corps : elle ne peut donc plus modifier
    # une pesee au passage. Le danger que U4 surveillait est supprime au lieu
    # d'etre garde.
    base = {"code_reference": ref, "id_ligne_bc": lb, "unite_saisie": "kg",
            "quantite_pesee_unite": 1050, "code_magasin_dest": MAG,
            "lot_fournisseur": "LOT-BANC-1", "nb_bobines": 404}
    entete = {"code_fournisseur": "FRS-001", "num_bon_livraison": "BL-BANC-26"}

    # L'EXCEDENT EST ARRETE DES LA SAISIE (C10), et non plus a la soumission :
    # l'ancien circuit laissait creer la reception puis refusait de la soumettre.
    # Le controle arrive plus tot, c'est mieux ; le test suit.
    c.refus("Magasinie", "POST", "/api/receptions", dict(entete, lignes=[base]),
            contient="tolerance")
    motive = dict(base, derogation_ecart=True,
                  motif_derogation="Accord du fournisseur, avoir a venir")
    r = c.ok("Magasinie", "POST", "/api/receptions", dict(entete, lignes=[motive]))
    rid = r["id_reception"]
    lr = c.ok("Magasinie", "GET", f"/api/receptions/{rid}/lignes")[0]["id_ligne_reception"]
    # Regle 13 : suivie au lot, la reference se compte en bobines. La derogation
    # leve l'ecart de pesee, elle ne dispense pas du comptage.
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{lr}", {"nb_bobines": 0})
    c.refus("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"},
            contient="bobines")
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{lr}", {"nb_bobines": 404})
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})

    # Segregation des taches : le peseur ne valide pas sa propre pesee.
    avant = kg(infra, ref)
    c.refus("Magasinie", "POST", f"/api/receptions/{rid}/valider")
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    verifier(abs(kg(infra, ref) - avant - 1050) < 1e-6, "l'import n'est pas entre en stock")
    # LE PRIX VIENT DE LA LIGNE DE BON (ADR-003 D2), plus de la ligne de facture
    # d'import : c'est le peg qui porte l'engagement, donc la valeur d'entree.
    # Le CMUP d'une premiere entree vaut donc exactement le prix converti de la
    # ligne recue.
    cm = cmup_magasin(infra, ref)
    prix_ligne = float(infra.valeur(
        f"SELECT prix_kg_mad FROM ligne_reception WHERE id_reception = '{rid}'"))
    verifier(abs(cm - prix_ligne) < 0.01,
             f"CMUP d'entree attendu {prix_ligne} (prix de la ligne de bon converti), obtenu {cm}")

    # Regle 5 : une DUM saisie ne s'efface pas ; elle se corrige avec un motif, au droit de valider.
    c.ok("Choukri", "PATCH", f"/api/import/dossiers/{id_dossier}", {"numero_dum": "DUM-BANC-1"})
    c.refus("Choukri", "PATCH", f"/api/import/dossiers/{id_dossier}", {"numero_dum": ""}, contient="efface")
    c.refus("Choukri", "PATCH", f"/api/import/dossiers/{id_dossier}", {"numero_dum": "DUM-BANC-2"}, contient="pourquoi")
    c.ok("Choukri", "PATCH", f"/api/import/dossiers/{id_dossier}",
         {"numero_dum": "DUM-BANC-2", "motif_dum": "Faute de frappe sur la serie"})
    refus_sql(infra, f"UPDATE import_dossiers SET numero_dum = NULL WHERE id_dossier = '{id_dossier}'", "IMPORT-DUM")
    # Regle 8 (T7) : dedouanee, l'entree de la reception d'import ne se contre-passe plus.
    id_mvt = infra.valeur(
        f"SELECT id_mouvement_genere FROM ligne_reception WHERE id_reception = '{rid}' LIMIT 1")
    c.refus("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer",
            {"motif": "Essai : annuler une entree dedouanee"}, contient="dedouane")

    # LA REPARTITION SAISIE (onglet Liquidation, 12/10/2026) : meme un frais reparti a la valeur
    # se corrige ; incomplete, il est « non reparti » et la cloture le refuse.
    frais = infra.valeur(f"SELECT id_ligne_frais FROM dossier_lignes_frais WHERE id_dossier = '{id_dossier}'")
    c.ok("Choukri", "PUT", f"/api/import/frais/{frais}/repartition",
         {"montants": [{"id_ligne": id_ligne_fact, "montant_dhs": 4000}]})
    verifier(infra.valeur(f"SELECT methode_repartition FROM dossier_lignes_frais WHERE id_ligne_frais = '{frais}'") == "MANUEL",
             "la saisie des montants n'a pas passe le frais en repartition manuelle")
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": True}, contient="non réparti")
    c.refus("Choukri", "PUT", f"/api/import/frais/{frais}/repartition",
            {"montants": [{"id_ligne": id_ligne_fact, "montant_dhs": 6000}]}, contient="plus que")
    c.ok("Choukri", "PUT", f"/api/import/frais/{frais}/repartition",
         {"montants": [{"id_ligne": id_ligne_fact, "montant_dhs": 5000}]})
    # Retour au parametrage : la repartition se recalcule seule.
    c.ok("Choukri", "PATCH", f"/api/import/frais/{frais}", {"methode_repartition": ""})
    verifier(infra.valeur(f"SELECT methode_repartition FROM dossier_lignes_frais WHERE id_ligne_frais = '{frais}'") in (None, ""),
             "le frais n'est pas revenu au parametrage")

    # Cloture : les 5 000 MAD de douane vont au lot du dossier, tout encore la.
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": True})
    verifier(abs(ap["ecart_stock_dhs"] - 5000) < 0.01 and abs(ap["ecart_consomme_dhs"]) < 0.01,
             f"frais attendus 5 000 au stock, obtenus {ap['ecart_stock_dhs']} / {ap['ecart_consomme_dhs']}")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": False})
    verifier(abs(cmup_magasin(infra, ref) - (cm + 5000 / kg(infra, ref))) < 0.0002, "les frais n'ont pas rejoint le CMUP")

    # Regle 5 : clos, le dossier est fige et ne se rouvre plus ; une facture tardive passe en
    # frais post-cloture, repartie sur le stock restant sans rouvrir le dossier.
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais", {
        "id_frais": "DOUANE", "numero_piece": "TARDIF", "montant_devise": 1000, "code_devise": "MAD"})
    c.refus("Choukri", "POST", f"/api/devalider/dossiers-import/{id_dossier}", {"motif": "Essai de reouverture"})
    tardif = {"id_frais": "DOUANE", "numero_piece": "TARDIF", "montant_devise": 1000, "code_devise": "MAD"}
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais-post-cloture", dict(tardif))
    cm = cmup_magasin(infra, ref)
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais-post-cloture",
              dict(tardif, motif="Facture du transitaire arrivee apres la cloture", simuler=True))
    verifier(abs(ap["ecart_stock_dhs"] - 1000) < 0.01, f"post-cloture : {ap['ecart_stock_dhs']} au stock au lieu de 1 000")
    verifier(abs(cmup_magasin(infra, ref) - cm) < 1e-6, "l'apercu du frais post-cloture a ecrit")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais-post-cloture",
         dict(tardif, motif="Facture du transitaire arrivee apres la cloture"))
    verifier(abs(cmup_magasin(infra, ref) - (cm + 1000 / kg(infra, ref))) < 0.0002, "le frais post-cloture n'a pas rejoint le CMUP")
    verifier(infra.valeur(f"SELECT statut FROM import_dossiers WHERE id_dossier = '{id_dossier}'") == "CLOTURE",
             "le frais post-cloture a rouvert le dossier")

    # Le cout de revient reel : un paiement au cours de la banque, son ecart de change,
    # sans toucher le CMUP (09/10/2026).
    bam = float(infra.valeur("SELECT cours_mad FROM cours_bam WHERE code_devise = 'USD' ORDER BY date_cours DESC LIMIT 1"))
    cours_ded = float(infra.valeur(f"SELECT taux_change FROM import_factures WHERE id_facture = '{id_facture}'"))
    jour = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    paiement = {"date_paiement": jour, "montant_devise": 100, "montant_mad": round(100 * bam, 2)}
    c.refus("Magasinie", "POST", f"/api/import/factures/{id_facture}/paiements", paiement, codes=(403,))
    c.refus("Choukri", "POST", f"/api/import/factures/{id_facture}/paiements",
            dict(paiement, montant_devise=10_000_000, montant_mad=10_000_000 * bam), contient="passerait")
    cm = cmup_magasin(infra, ref)
    c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/paiements", paiement)
    verifier(abs(cmup_magasin(infra, ref) - cm) < 1e-9, "le paiement a touche le CMUP")
    cr = c.ok("Choukri", "GET", f"/api/import/dossiers/{id_dossier}/cout-revient-reel")
    ligne = next(x for x in cr["factures"] if x["id_facture"] == id_facture)
    attendu = round(100 * bam, 2) - 100 * cours_ded
    verifier(abs(float(ligne["change_annee_ded_mad"]) - attendu) < 0.05,
             f"ecart de change {ligne['change_annee_ded_mad']} au lieu de {attendu:.2f}")
    # A11 (10/10) : jamais d'acompte avant le dedouanement. Un paiement date avant est
    # accepte, mais signale a la saisie et par C53 ; supprime, le signal tombe.
    veille = infra.valeur("SELECT to_char(current_date - 1, 'YYYY-MM-DD')")
    r = c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/paiements",
             dict(paiement, date_paiement=veille, taux_confirme=True))
    verifier(any("C53" in a for a in r.get("avis", [])), f"pas d'avis pour un paiement avant le dedouanement : {r}")
    verifier(int(infra.valeur(f"SELECT count(*) FROM v_ctl_c53 WHERE id_paiement = '{r['id_paiement']}'")) == 1,
             "C53 ne voit pas le paiement avant le dedouanement")
    c.ok("Choukri", "DELETE", f"/api/import/paiements/{r['id_paiement']}")
    verifier(controle(infra, "C53") == 0, "C53 garde un paiement supprime")

    # Regle 3 (09/10) : l'avoir d'import. De prix : la valeur baisse au CMUP du stock restant.
    avoir = {"nature": "AVOIR_PRIX", "numero_piece": "AV-BANC-1", "montant_mad": 500,
             "motif": "Remise pour non-conformite gardee"}
    c.refus("Magasinie", "POST", f"/api/import/dossiers/{id_dossier}/avoir", avoir, codes=(403,))
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir", dict(avoir, motif="non"))
    cm = cmup_magasin(infra, ref)
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir", dict(avoir, simuler=True))
    verifier(abs(ap["ecart_stock_dhs"] + 500) < 0.01, f"avoir de prix : {ap['ecart_stock_dhs']} au stock au lieu de -500")
    verifier(abs(cmup_magasin(infra, ref) - cm) < 1e-9, "l'apercu de l'avoir a ecrit")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/avoir", avoir)
    verifier(abs(cmup_magasin(infra, ref) - (cm - 500 / kg(infra, ref))) < 0.0002, "l'avoir de prix n'a pas baisse le CMUP")
    # Un nouvel avoir ne rejoue pas les frais : la cloture ne lit que les FRAIS.
    nb_frais = infra.valeur(f"SELECT count(*) FROM import_ajustements_cump WHERE id_dossier = '{id_dossier}' AND origine = 'FRAIS'")

    verifier(infra.valeur(f"SELECT count(*) FROM import_ajustements_cump WHERE id_dossier = '{id_dossier}' AND origine = 'FRAIS'")
             == nb_frais, "un avoir a ecrit des lignes d'origine FRAIS")
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


def scenario_audit_montants(c, infra):
    """Un prix de ligne de bon modifie laisse sa trace : ancienne et nouvelle valeur, et qui (P2-11)."""
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {"code_fournisseur": FRS, "lignes": [{
        "code_reference": REF, "unite_commande": "kg", "quantite_commandee_unite": 100, "prix_unitaire_devise": 20}]})
    lignes = c.ok("Assistante", "GET", f"/api/bons-commande/{bc['id_bc']}/lignes")
    lignes = lignes.get("lignes", lignes) if isinstance(lignes, dict) else lignes
    id_ligne = lignes[0]["id_ligne_bc"]
    c.ok("Assistante", "PATCH", f"/api/bons-commande/{bc['id_bc']}/lignes/{id_ligne}", {"prix_unitaire_devise": 21.5})
    trace = infra.sql(
        "SELECT a.anciennes_valeurs, a.nouvelles_valeurs, u.login FROM audit_log a "
        "LEFT JOIN utilisateur u ON u.id_utilisateur = a.id_utilisateur "
        f"WHERE a.table_concernee = 'ligne_bc' AND a.operation = 'UPDATE' AND a.id_enregistrement = '{id_ligne}' "
        # La meme transaction ecrit aussi `arbitree = 1`, a la meme heure : trier ne
        # departage pas les deux entrees, on prend celle qui porte le prix.
        "AND a.nouvelles_valeurs::text LIKE '%prix_unitaire_devise%' "
        "ORDER BY a.date_operation DESC LIMIT 1")
    verifier(trace, "la modification du prix n'est pas au journal")
    ancien, nouveau, qui = trace[0]
    verifier('"prix_unitaire_devise": 20' in ancien and '"prix_unitaire_devise": 21.5' in nouveau,
             f"valeurs du journal inattendues : {ancien} -> {nouveau}")
    verifier(qui == "Assistante", f"l'auteur de la modification n'est pas inscrit : {qui}")


def scenario_import_sur_arrivage(c, infra):
    """ADR-003 phase C : un dossier d'import NE DEPUIS LA BASCULE recoit sa marchandise par
    l'ARRIVAGE — la reception unifiee, sur le bon de commande qui l'a engagee — et toute sa chaine
    de frais la retrouve : reste a recevoir, repartition, CUMP definitif. C'est ce chainon qui
    manquait : la cloture lisait ses kilos dans les seules lignes de facture, et un dossier neuf
    n'aurait jamais pu se cloturer — ses frais n'auraient jamais atteint le CUMP."""
    ref, mag = "PP-1500 Dtex-Cream 2951-Hs", "Polyfashions"
    jour = taux_usd_du_jour(infra)
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={jour}")["reference"]

    # Le bon d'import, en devise, envoye au fournisseur : c'est lui qui engage le prix.
    _id_bc, lignes = bon_envoye(c, [(ref, 1000, 2.0)], frs="FRS-001")
    lb = lignes[0]["id_ligne_bc"]

    # LE DOSSIER NAIT BASCULE : sa marchandise se pese dans la reception unifiee.
    d = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/ARR", "code_devise": "USD"})
    id_dossier = d.get("id_dossier") or d.get("id")
    verifier(infra.valeur("SELECT circuit_reception FROM import_dossiers "
                          f"WHERE id_dossier = '{id_dossier}'") == "BON",
             "un dossier neuf ne nait pas sur le circuit du bon de commande")
    fac = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-ARR", "date_facture": jour,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 2000})
    id_facture = fac.get("id_facture") or fac.get("id")
    # LA LIGNE DE FACTURE SE RATTACHE A UN BON, meme deja recu : la facture arrive apres le camion,
    # et l'etancheite ne vise plus que les dossiers restes sur l'ancien circuit.
    lig = c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", {
        "type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 1000,
        "poids_net_kg": 1000, "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-ARR-IMP",
        "id_ligne_bc": lb})
    id_ligne = lig.get("id_ligne") or lig.get("id")


    # L'ARRIVAGE : un BL, une ligne pegee au bon, le dossier rattache a l'en-tete.
    r = c.ok("Magasinie", "POST", "/api/receptions", {
        "code_fournisseur": "FRS-001", "num_bon_livraison": "BL-ARR-IMP",
        "id_dossier_import": id_dossier,
        "lignes": [{"code_reference": ref, "id_ligne_bc": lb, "unite_saisie": "kg",
                    "quantite_pesee_unite": 1000, "code_magasin_dest": mag,
                    "lot_fournisseur": "LOT-ARR-IMP", "nb_bobines": 385}]})
    rid = r["id_reception"]
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")

    # LE DOSSIER A APPRIS CE QUI EST ENTRE, sans qu'on le lui saisisse deux fois.
    recu = float(infra.valeur("SELECT quantite_recue_kg FROM import_facture_lignes "
                              f"WHERE id_ligne = '{id_ligne}'"))
    verifier(abs(recu - 1000) < 1e-6, f"la ligne de facture porte {recu} kg recus au lieu de 1 000")
    verifier(infra.valeur(f"SELECT statut FROM import_dossiers WHERE id_dossier = '{id_dossier}'") == "EN_COURS",
             "le dossier n'est pas passe EN_COURS alors que sa marchandise est entree")
    verifier(infra.valeur("SELECT statut_reception FROM import_factures "
                          f"WHERE id_facture = '{id_facture}'") == "RECUE",
             "la facture ne se dit pas recue alors que tout est pese")

    # Une pesee encore en cours sur le dossier empeche la cloture : elle entrerait APRES la
    # repartition des frais.
    r2 = c.ok("Magasinie", "POST", "/api/receptions", {
        "code_fournisseur": "FRS-001", "num_bon_livraison": "BL-ARR-BROUILLON",
        "id_dossier_import": id_dossier,
        "lignes": [{"code_reference": ref, "unite_saisie": "kg", "quantite_pesee_unite": 5,
                    "code_magasin_dest": mag, "lot_fournisseur": "LOT-ARR-IMP", "nb_bobines": 2}]})
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/frais", {
        "id_frais": "DOUANE", "numero_piece": "DUM-ARR", "montant_devise": 7500, "code_devise": "MAD"})
    c.refus("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": True},
            contient="brouillon")
    # On l'ABANDONNE, on ne la supprime pas : le numero a ete attribue, et un trou dans la
    # numerotation ne s'explique pas (transition BROUILLON -> ANNULE, declaree).
    c.ok("Magasinie", "PUT", f"/api/receptions/{r2['id_reception']}/statut", {"statut": "ANNULE"})

    # LA CLOTURE PORTE LES FRAIS AU CUMP DE LA MARCHANDISE DE CE DOSSIER, la ou elle est.
    cm, stock = cmup_magasin(infra, ref, mag), kg(infra, ref, mag)
    ap = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": True})
    verifier(abs(ap["ecart_stock_dhs"] - 7500) < 0.01 and abs(ap["ecart_consomme_dhs"]) < 0.01,
             f"frais attendus 7 500 au stock, obtenus {ap['ecart_stock_dhs']} / {ap['ecart_consomme_dhs']}")
    verifier(abs(cmup_magasin(infra, ref, mag) - cm) < 1e-6, "l'apercu de la cloture a ecrit")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/cloturer", {"simuler": False})
    verifier(abs(cmup_magasin(infra, ref, mag) - (cm + 7500 / stock)) < 0.0002,
             f"les frais du dossier n'ont pas rejoint le CMUP de l'arrivage ({cmup_magasin(infra, ref, mag)})")
    verifier(infra.valeur("SELECT code_magasin FROM import_ajustements_cump "
                          f"WHERE id_dossier = '{id_dossier}' AND nature = 'STOCK'") == mag,
             "les frais sont alles a un autre magasin que celui qui a recu")

    verifier(controle(infra, "C11") == 0, "C11 apres l'import recu par l'arrivage")


def scenario_lots_autorisations(c, infra):
    """Une derogation se demande au droit d'ecrire sur les lots, s'accorde avec un motif, une seule fois ;
    declarer un magasin « quarantaine » demande VALIDER."""
    ref, lot = "PP-1500 Dtex-Cream 2951-Hs", "LOT-BANC-AUTO"
    # Une derogation de lot bloque est bornee en kilos (F17, 09/10).
    c.refus("Magasinie", "POST", "/api/autorisations", {
        "type_demande": "LOT_BLOQUE", "code_reference": ref, "lot_fournisseur": lot,
        "document": "MCH-BANC-0001", "motif": "Commande urgente, lot controle visuellement"}, contient="kilos")
    d = c.ok("Magasinie", "POST", "/api/autorisations", {
        "type_demande": "LOT_BLOQUE", "code_reference": ref, "lot_fournisseur": lot, "kg": 100,
        "document": "MCH-BANC-0001", "motif": "Commande urgente, lot controle visuellement"})
    idd = d["id_demande"]
    c.refus("Magasinie", "POST", f"/api/autorisations/{idd}/decider", {"decision": "ACCORDEE", "motif": "Vu avec la qualite"})
    c.refus("Choukri", "POST", f"/api/autorisations/{idd}/decider", {"decision": "ACCORDEE"})
    c.ok("Choukri", "POST", f"/api/autorisations/{idd}/decider", {"decision": "ACCORDEE", "motif": "Vu avec la qualite, une fois"})
    c.refus("Mohamed", "POST", f"/api/autorisations/{idd}/decider", {"decision": "REFUSEE", "motif": "Trop tard pour refuser"})
    # Le magasin : renommer reste une ecriture, la quarantaine une decision.
    # L'assistante ecrit sur le stock sans valider les lots.
    m = c.ok("Assistante", "GET", "/api/magasins/Polyfashions")
    c.ok("Assistante", "PATCH", "/api/magasins/Polyfashions", {"nom": m["nom"], "est_quarantaine": m["est_quarantaine"]})
    c.refus("Assistante", "PATCH", "/api/magasins/Polyfashions", {"est_quarantaine": 1}, codes=(403,))


def scenario_reception_devalidee_revalidee(c, infra):
    """Une reception validee, devalidee (ses entrees contre-passees), se corrige et se revalide :
    pas d'impasse sur le numero du mouvement ni sur l'archive (audit v3/v4)."""
    avant = kg(infra)
    id_bc, lignes = bon_envoye(c, [(REF, 600, 20)])
    rid = reception_validee(c, id_bc, lignes, [600])
    # La procedure : contre-passer l'entree, puis devalider le papier.
    numero = infra.valeur(f"SELECT numero_reception FROM reception WHERE id_reception = '{rid}'")
    for (id_mvt,) in infra.sql(f"SELECT id_mouvement FROM mouvement WHERE reference_document = '{numero}' "
                               "AND code_type_mvt = 'ENTREE_REC'"):
        c.ok("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer", {"motif": "Pesee a refaire, balance dereglee"})
    # U2 (09/10) : le bon revient d'une cloture, son recu se recale ; C52 signale la reception
    # validee dont l'entree est contre-passee, jusqu'a sa devalidation.
    bon = infra.sql(f"SELECT b.statut, lb.quantite_recue_kg, lb.statut FROM bon_commande b "
                    f"JOIN ligne_bc lb ON lb.id_bc = b.id_bc WHERE b.id_bc = '{id_bc}'")[0]
    verifier(bon[0] == "ENVOYE" and float(bon[1]) == 0 and bon[2] == "EN_ATTENTE",
             f"le bon n'est pas revenu de sa cloture : {bon}")
    verifier(int(infra.valeur(f"SELECT count(*) FROM v_ctl_c52 WHERE numero = '{numero}'")) == 1,
             "C52 ne voit pas la reception contre-passee")
    c.ok("Choukri", "POST", f"/api/devalider/receptions/{rid}", {"motif": "Pesee a refaire, balance dereglee"})
    verifier(int(infra.valeur(f"SELECT count(*) FROM v_ctl_c52 WHERE numero = '{numero}'")) == 0,
             "C52 garde la reception devalidee")
    verifier(abs(kg(infra) - avant) < 1e-6, "la devalidation n'a pas retire l'entree")
    # U3 (09/10) : la pesee refaite (590 kg) passe a l'historique des prix en revision, et
    # l'archive juge l'ecart sur le reste du bon, a la tolerance du fournisseur.
    id_ligne = infra.valeur(f"SELECT id_ligne_reception FROM ligne_reception WHERE id_reception = '{rid}'")
    c.ok("Choukri", "PUT", f"/api/receptions/{rid}/statut", {"statut": "BROUILLON", "motif": "Pesee a refaire au magasin"})
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{id_ligne}",
         {"unite_saisie": "kg", "quantite_pesee_unite": 590})
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    verifier(abs(kg(infra) - avant - 590) < 1e-6, "la revalidation n'a pas refait l'entree a 590 kg")
    courant = infra.sql(f"SELECT version, quantite_achetee_kg FROM v_historique_prix_courant "
                        f"WHERE id_ligne_reception = '{id_ligne}'")[0]
    verifier(courant[0] == "2" and abs(float(courant[1]) - 590) < 1e-6,
             f"l'historique des prix garde la premiere validation : {courant}")
    archive = infra.sql(f"SELECT ecart_pct, conformite_quantite FROM archive_reception "
                        f"WHERE id_ligne_reception = '{id_ligne}' ORDER BY version DESC LIMIT 1")[0]
    verifier(abs(float(archive[0]) + 1.6667) < 0.01 and archive[1] == "1",
             f"archive : ecart {archive[0]} (attendu -1,67 % sur 600 kg restants), conforme {archive[1]}")
    verifier(controle(infra, "C11") == 0, "C11 apres devalidation et revalidation")
    verifier(infra.valeur(f"SELECT statut FROM bon_commande WHERE id_bc = '{id_bc}'") == "CLOTURE",
             "le bon n'est pas reclos par la revalidation")


def scenario_import_coherence(c, infra):
    """Import : une ligne de bon servie par un dossier de l'ANCIEN circuit ne se recoit pas en
    local ; une facture recue est figee ; contre-passer l'entree d'un ARRIVAGE l'annule et rend
    facture et bon."""
    ref = "PP-1500 Dtex-Bleu 6666-Hs"
    jour = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    # Un taux du jour pour l'USD : un bon en devise ne se valide pas sur un taux de plus de 7 jours.
    # PAR LE HELPER, qui ne pose le cours que s'il manque : ferme inconditionnellement, la ligne
    # du jour posee par un autre scenario violait taux_change_check (date_fin > date_debut).
    taux_usd_du_jour(infra)
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={jour}")["reference"]

    def facture_pegee(id_dossier, numero, id_ligne_bc, lot):
        """Une facture d'import d'une ligne, rattachee a une ligne de bon. Rend (id_facture, id_ligne)."""
        f = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
            "code_fournisseur": "FRS-001", "numero_facture": numero, "date_facture": jour,
            "code_devise": "USD", "taux_change": cours, "montant_devise": 2000})
        idf = f.get("id_facture") or f.get("id")
        lig = c.ok("Choukri", "POST", f"/api/import/factures/{idf}/lignes", {
            "type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 1000,
            "poids_net_kg": 1000, "prix_unitaire_devise": 2.0, "lot_fournisseur": lot,
            "id_ligne_bc": id_ligne_bc})
        return idf, (lig.get("id_ligne") or lig.get("id"))

    # ---- 1. ETANCHEITE -------------------------------------------------------
    # Un dossier RESTE en circuit FACTURE garde sa ligne de bon : elle ne se recoit
    # pas en local. La regle vaut toujours, et c'est elle qu'on eprouve ici.
    _bc_a, lignes_a = bon_envoye(c, [(ref, 1000, 2.0)], frs="FRS-001")
    lb_a = lignes_a[0]["id_ligne_bc"]
    facture_pegee(dossier_avant_bascule(c, infra, "BANC/27"), "FB-2A", lb_a, "LOT-BANC-2A")
    c.refus("Magasinie", "POST", "/api/receptions", {
        "code_fournisseur": "FRS-001", "lignes": [{
        "code_reference": ref, "id_ligne_bc": lb_a, "unite_saisie": "kg",
        "quantite_pesee_unite": 400, "code_magasin_dest": MAG,
        "lot_fournisseur": "LOT-BANC-2A", "nb_bobines": 154}]}, contient="ETANCHEITE")

    # ---- 2. LE CIRCUIT COURANT : l'arrivage unifie ---------------------------
    # Un dossier NEUF nait en circuit BON : sa marchandise entre par l'arrivage,
    # sur le bon qui l'a engagee.
    _bc, lignes = bon_envoye(c, [(ref, 1000, 2.0)], frs="FRS-001")
    lb = lignes[0]["id_ligne_bc"]
    id_dossier = (lambda d: d.get("id_dossier") or d.get("id"))(
        c.ok("Choukri", "POST", "/api/import/dossiers",
             {"numero": "BANC/27B", "code_devise": "USD"}))
    id_facture, id_ligne = facture_pegee(id_dossier, "FB-2B", lb, "LOT-BANC-2B")

    r = c.ok("Magasinie", "POST", "/api/receptions", {
        "code_fournisseur": "FRS-001", "num_bon_livraison": "BL-BANC-27", "lignes": [{
            "code_reference": ref, "id_ligne_bc": lb, "unite_saisie": "kg",
            "quantite_pesee_unite": 400, "code_magasin_dest": MAG,
            "lot_fournisseur": "LOT-BANC-2B", "nb_bobines": 154}]})
    rid = r["id_reception"]
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")

    recu = lambda: float(infra.valeur(
        f"SELECT quantite_recue_kg FROM import_facture_lignes WHERE id_ligne = '{id_ligne}'"))
    recu_bc = lambda: float(infra.valeur(
        f"SELECT quantite_recue_kg FROM ligne_bc WHERE id_ligne_bc = '{lb}'"))
    verifier(abs(recu() - 400) < 1e-6 and abs(recu_bc() - 400) < 1e-6,
             f"l'arrivage n'a pas servi facture ({recu()}) et bon ({recu_bc()})")

    # La facture recue est figee.
    c.refus("Choukri", "PATCH", f"/api/import/factures/{id_facture}",
            {"montant_devise": 2100}, contient="IMPORT-FIGEE")

    # CONTRE-PASSER L'ENTREE D'UN ARRIVAGE L'ANNULE ET REND TOUT (17/10/2026).
    # Jusqu'a cette date, la contre-passation ne connaissait que l'ancien circuit :
    # elle laissait la facture d'import afficher des kilos recus pour une
    # marchandise sortie du stock, et l'arrivage restait VALIDE.
    id_mvt = infra.valeur(
        f"SELECT id_mouvement_genere FROM ligne_reception WHERE id_reception = '{rid}'")
    c.ok("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer",
         {"motif": "Erreur de lot, a recevoir de nouveau"})
    # L'ARRIVAGE RESTE VALIDE, ET C'EST LA REGLE : `transition_statut` n'autorise,
    # depuis VALIDE, que A_CONTROLER (devalidation) et CLOTURE. Defaire une entree
    # est le travail de la contre-passation ; rendre la reception modifiable est
    # celui de la devalidation, qui reste un geste distinct et explicite. Ce qui
    # change, c'est le COMPTE : la ligne contre-passee ne compte plus.
    statut = infra.valeur(f"SELECT statut FROM reception WHERE id_reception = '{rid}'")
    verifier(statut == "VALIDE", f"l'arrivage devrait rester VALIDE, il est {statut}")
    verifier(abs(recu()) < 1e-6 and abs(recu_bc()) < 1e-6,
             f"facture {recu()} kg / bon {recu_bc()} kg apres contre-passation")

    # Plus rien de recu : la facture se corrige de nouveau.
    c.ok("Choukri", "PATCH", f"/api/import/factures/{id_facture}", {"montant_devise": 2100})

def taux_usd_du_jour(infra):
    jour = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    if infra.valeur(f"SELECT count(*) FROM taux_change WHERE code_devise = 'USD' AND substr(date_debut, 1, 10) = '{jour}'") == "0":
        infra.sql(f"UPDATE taux_change SET date_fin = '{jour}' WHERE code_devise = 'USD' AND date_fin IS NULL")
        infra.sql("INSERT INTO taux_change (id_taux, code_devise, taux, date_debut, source) "
                  f"VALUES (gen_random_uuid()::text, 'USD', 9.30, '{jour}', 'banc')")
    return jour


def scenario_machine(c, infra):
    """Une machine du banc : chargement, constat ordinaire en vert, gain refuse comme consommation,
    dechargement au magasin, grand livre juste ; retiree, elle ne se charge plus."""
    ref, lot = "PP-1500 Dtex-L.Beige 44377-Hs", "LOT-MACH-1"
    jour = taux_usd_du_jour(infra)
    id_bc, lignes = bon_envoye(c, [(ref, 520, 2.0)], frs="FRS-001")
    rid = reception_validee(c, id_bc, lignes, [520], lot_fournisseur=lot, nb_bobines=200)
    stock0 = kg(infra, ref)

    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANC1", "nom": "Machine du banc",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})
    zone = "BANC1-E1"

    def fiche(type_fiche, lignes, mag=MAG):
        f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
            "type_fiche": type_fiche, "code_machine": "BANC1", "code_emplacement": zone, "date_fiche": jour,
            "code_magasin": mag if type_fiche != "MAJ" else None, "responsable": "Banc", "lignes": lignes})
        return f["id_fiche"]

    # 1. Chargement : 100 bobines de 2,6 kg, pleines.
    f1 = fiche("CHARGE", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 100,
                           "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/apercu", {})
    verifier(not ap["blocages"], f"apercu du chargement bloque : {ap['blocages']}")
    # Le magasinier a VALIDER sur les mouvements (configuration reelle) : il charge.
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {})
    verifier(abs(kg(infra, ref) - (stock0 - 260)) < 0.01, f"le chargement n'a pas sorti 260 kg : {stock0 - kg(infra, ref)}")

    # 1 bis. Le mouvement magasin du chargement ne se contre-passe pas seul : la
    #        machine garderait le fil (service ET base, 09/10/2026).
    id_mvt = infra.valeur("SELECT id_mouvement FROM mouvement WHERE code_type_mvt = 'CHARGE_MACHINE' "
                          "ORDER BY date_creation DESC LIMIT 1")
    c.refus("Choukri", "POST", f"/api/mouvements/{id_mvt}/contre-passer",
            {"motif": "Essai du banc : contre-passer un chargement"}, contient="fiche machine")
    refus_sql(infra, "INSERT INTO mouvement (id_mouvement, numero_mouvement, code_type_mvt, code_magasin, "
                     f"id_mouvement_contrepasse) VALUES ('banc-x', 'MVT-BANC-X', 'AJUST_INV_POS', '{MAG}', '{id_mvt}')",
              "MACHINE-ANNULATION")

    # 2. Constat ordinaire : 50 % restent, 130 kg consommes -> vert, au droit d'ecrire.
    f2 = fiche("MAJ", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_presentes": 100,
                        "pourcentage": 50, "code_motif": "MJ_ORDINAIRE"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/apercu", {})
    verifier(not ap["blocages"], f"constat ordinaire bloque : {ap['blocages']}")
    verifier(all(l.get("niveau_ecart") in ("VERT", "AUCUN") for l in ap["lignes"]), f"constat ordinaire hors du vert : {ap['lignes']}")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/valider", {})

    # 3. Un gain declare comme consommation : le moteur le classe en regularisation,
    #    jamais en consommation negative (C38 reste une sentinelle a zero).
    f3 = fiche("MAJ", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_presentes": 100,
                        "pourcentage": 60, "code_motif": "MJ_CORRECTION", "effet_ecart": "CONSOMMATION",
                        "motif_texte": "essai du banc"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f3}/apercu", {})
    verifier([l.get("effet_ecart") for l in ap["lignes"]] == ["REGULARISATION"],
             f"un gain n'est pas classe en regularisation : {[(l.get('ecart_kg'), l.get('effet_ecart')) for l in ap['lignes']]}")
    # 26 kg sur une ligne de 260 : orange. Le serveur exige la confirmation.
    verifier([l.get("niveau_ecart") for l in ap["lignes"]] == ["ORANGE"], f"niveau attendu ORANGE : {ap['lignes']}")
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f3}/valider", {}, contient="ORANGE")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f3}/annuler", {"motif": "Essai du banc"})

    # 4. Dechargement de tout au magasin : 100 bobines a 50 %.
    f4 = fiche("DECHARGE", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 100,
                             "pct_retirees": 50, "destination": "MAGASIN", "code_motif": "DE_CHGT_PROD"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f4}/apercu", {})
    verifier(not ap["blocages"], f"dechargement bloque : {ap['blocages']}")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f4}/valider", {})
    verifier(abs(kg(infra, ref) - (stock0 - 130)) < 0.01, f"stock apres dechargement : {kg(infra, ref)} au lieu de {stock0 - 130}")
    verifier(controle(infra, "C11") == 0 and controle(infra, "C38") == 0, "C11 ou C38 apres le parcours machine")

    # 5. Retiree, elle ne porte plus de fiche. Un brouillon en attente empeche
    #    d'abord le retrait (il se validerait ensuite sur une machine hors parc).
    f5 = fiche("MAJ", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_presentes": 0,
                        "pourcentage": 0, "code_motif": "MJ_ORDINAIRE"}])
    c.refus("Choukri", "PATCH", "/api/machines/BANC1/etat", {"etat": "RETIREE", "motif": "Fin du banc"},
            contient="brouillon")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f5}/annuler", {"motif": "Essai du banc"})
    c.ok("Choukri", "PATCH", "/api/machines/BANC1/etat", {"etat": "RETIREE", "motif": "Fin du banc"})
    c.refus("Magasinie", "POST", "/api/machines/fiches", {
        "type_fiche": "CHARGE", "code_machine": "BANC1", "code_emplacement": zone, "date_fiche": jour,
        "code_magasin": MAG, "responsable": "Banc", "lignes": []}, contient="retiree")


def scenario_machine_surplus(c, infra):
    """Regle 2 (09/10) : a un chargement, consommer plus que ce que portait la ligne passe en ORANGE
    avec une raison choisie ; une Correction est jugee par les seuils (rouge = Direction)."""
    ref, lot = "PP-1500 Dtex-L.Beige 44377-Hs", "LOT-MACH-2"
    jour = taux_usd_du_jour(infra)
    id_bc, lignes = bon_envoye(c, [(ref, 520, 2.0)], frs="FRS-001")
    reception_validee(c, id_bc, lignes, [520], lot_fournisseur=lot, nb_bobines=200)
    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANC2", "nom": "Machine du banc 2",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})
    zone = "BANC2-E1"

    def fiche(type_fiche, lignes):
        return c.ok("Magasinie", "POST", "/api/machines/fiches", {
            "type_fiche": type_fiche, "code_machine": "BANC2", "code_emplacement": zone, "date_fiche": jour,
            "code_magasin": MAG if type_fiche != "MAJ" else None, "responsable": "Banc", "lignes": lignes})["id_fiche"]

    # Ligne vide, 100 bobines de 2,6 kg chargees, 40 % declares : 156 kg « consommes » a l'instant.
    charge = {"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 100,
              "poids_retenu_kg": 2.6, "pourcentage": 40, "code_motif": "CH_PRODUCTION"}
    f1 = fiche("CHARGE", [charge])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/apercu", {})
    verifier([l.get("niveau_ecart") for l in ap["lignes"]] == ["ORANGE"], f"surplus non orange : {ap['lignes']}")
    verifier(any("raison" in b for b in ap["blocages"]), f"surplus sans raison exigee : {ap['blocages']}")
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {"confirme_orange": True}, contient="raison")
    c.ok("Magasinie", "PUT", f"/api/machines/fiches/{f1}", {
        "type_fiche": "CHARGE", "code_machine": "BANC2", "code_emplacement": zone, "date_fiche": jour,
        "code_magasin": MAG, "responsable": "Banc", "lignes": [dict(charge, motif_texte="Saisie décalée")]})
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {}, contient="ORANGE")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {"confirme_orange": True})
    verifier(controle(infra, "C48") >= 1, "le chargement deja consomme n'est pas au controle C48")
    # F22 : le journal des mouvements machine porte le mouvement magasin lie ; l'apercu du
    # retrait dit l'etat auquel l'etage reviendra (vide) et le mouvement annule.
    journal = c.ok("Magasinie", "GET", "/api/machines/BANC2/mouvements")
    verifier(any(l.get("numero_mouvement") for l in journal), f"journal machine sans mouvement magasin : {journal[:1]}")
    ap = c.ok("Magasinie", "GET", f"/api/machines/fiches/{f1}/retrait-apercu")
    verifier(ap.get("derniere") is True and ap.get("etat_avant") == [] and len(ap.get("mouvements") or []) == 1,
             f"apercu du retrait inattendu : {ap}")

    # Une Correction qui se dit consommation : 104 kg -> 26 kg, 78 kg sur une ligne de 104 : rouge.
    f2 = fiche("MAJ", [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_presentes": 100,
                        "pourcentage": 10, "code_motif": "MJ_CORRECTION", "effet_ecart": "CONSOMMATION",
                        "motif_texte": "essai du banc"}])
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/apercu", {})
    verifier([l.get("niveau_ecart") for l in ap["lignes"]] == ["ROUGE"],
             f"une correction de 78 kg n'est pas rouge : {ap['lignes']}")
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f2}/valider", {"confirme_orange": True}, contient="Direction")
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/annuler", {"motif": "Essai du banc"})


def scenario_sessions(c, infra):
    """Mot de passe de 12 au serveur ; changer son mot de passe ferme les autres sessions et rend un
    jeton neuf ; on ne trie pas sur un champ masque (audit v4, P2-18)."""
    import time
    from banc import MOT_DE_PASSE
    c.ok("Tarik", "GET", "/api/auth/moi")
    ancien_jeton = c.jetons["Tarik"]
    time.sleep(1.2)  # le jeton date a la seconde : le changement doit lui etre posterieur
    c.refus("Tarik", "POST", "/api/auth/mot-de-passe", {"ancien": MOT_DE_PASSE, "nouveau": "Court-2026"}, contient="12")
    r = c.ok("Tarik", "POST", "/api/auth/mot-de-passe", {"ancien": MOT_DE_PASSE, "nouveau": "Nouveau-Banc-2026!"})
    verifier(r.get("jeton"), "le changement de mot de passe ne rend pas de jeton neuf")
    c.jetons["Tarik"] = ancien_jeton
    code, _ = c.appel("Tarik", "GET", "/api/auth/moi")
    verifier(code == 401, f"l'ancien jeton reste valide apres le changement de mot de passe : {code}")
    c.jetons["Tarik"] = r["jeton"]
    c.ok("Tarik", "GET", "/api/auth/moi")
    r = c.ok("Tarik", "POST", "/api/auth/mot-de-passe", {"ancien": "Nouveau-Banc-2026!", "nouveau": MOT_DE_PASSE})
    c.jetons["Tarik"] = r["jeton"]
    # Le prix catalogue est masque au magasinier : ni tri, ni filtre dessus.
    c.refus("Magasinie", "GET", "/api/catalogue?tri=prix_catalogue", contient="masque")
    # T8 (09/10) : l'ecran verrouille compte les echecs comme la connexion ; un bon mot de
    # passe ne passe pas tant que le compte est bloque.
    for _ in range(2):
        c.refus("Tarik", "POST", "/api/auth/deverrouiller", {"mot_de_passe": "pas-le-bon-mot"}, codes=(401,))
    c.refus("Tarik", "POST", "/api/auth/deverrouiller", {"mot_de_passe": "pas-le-bon-mot"}, codes=(429,))
    c.refus("Tarik", "POST", "/api/auth/deverrouiller", {"mot_de_passe": MOT_DE_PASSE}, codes=(429,))
    infra.sql("UPDATE utilisateur SET echecs_consecutifs = 0, bloque_jusqu_a = NULL WHERE login = 'Tarik'")
    c.ok("Tarik", "POST", "/api/auth/deverrouiller", {"mot_de_passe": MOT_DE_PASSE})


def scenario_concurrence_numerotation(c, infra):
    """Huit bons crees en meme temps : huit numeros distincts, aucun conflit (compteur, audit v4 P2-19)."""
    from concurrent.futures import ThreadPoolExecutor
    c.ok("Assistante", "GET", "/api/auth/moi")  # jeton pris avant la rafale
    corps = {"code_fournisseur": FRS, "lignes": [{"code_reference": REF, "unite_commande": "kg",
                                                  "quantite_commandee_unite": 10, "prix_unitaire_devise": 20}]}
    with ThreadPoolExecutor(max_workers=8) as pool:
        reponses = list(pool.map(lambda _: c.appel("Assistante", "POST", "/api/bons-commande", corps), range(8)))
    codes = [code for code, _ in reponses]
    verifier(all(code == 200 for code in codes), f"creation simultanee : codes {codes} {[r for _, r in reponses if _ != 200][:1]}")
    numeros = [r["numero_bc"] for _, r in reponses]
    verifier(len(set(numeros)) == 8, f"numeros en double : {sorted(numeros)}")


def scenario_sortie_hors_machine(c, infra):
    """Regle 1 (09/10) : sortie hors machine avec motif par ligne et OF libre, pret a une autre usine
    rendu en nature, seuil de 50 kg cumule par jour et par reference (dechets compris)."""
    ref = "PLA 50 CHE"
    entree_stock(c, ref, 300)
    hm = lambda login, kg, motif_ligne, **x: mouvement(c, login, "SORTIE_HORS_MACHINE", [(ref, kg)],
                                                       motif="HORS_MACHINE", motif_ligne=motif_ligne, **x)
    code, r = hm("Magasinie", 10, None)
    verifier(code in (400, 422), f"sortie hors machine sans motif acceptee : {code} {r}")
    code, r = hm("Magasinie", 10, "HM_ECHANTILLON")
    verifier(code == 200, f"echantillon de 10 kg sans OF refuse : {r}")
    code, r = hm("Magasinie", 15, "HM_PRET")
    verifier(code in (400, 422) and "usine" in str(r).lower(), f"pret sans usine accepte : {code} {r}")
    code, r = hm("Magasinie", 15, "HM_PRET", tiers="Usine du banc")
    verifier(code == 200, f"pret de 15 kg refuse : {r}")
    # 10 + 15 deja sortis ce jour : un dechet de 30 kg passe le seuil cumule.
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(ref, 30)], numero_of="OF-BANC")
    verifier(code == 422 and "ce jour" in str(r), f"seuil cumule non applique : {code} {r}")
    code, r = mouvement(c, "Choukri", "SORTIE_PROD", [(ref, 30)], numero_of="OF-BANC")
    verifier(code == 200, f"la Direction ne passe pas le seuil : {r}")
    # L'ancienne consommation hors machine renvoie vers la sortie hors machine.
    code, r = mouvement(c, "Magasinie", "SORTIE_PROD", [(ref, 5)], numero_of="OF-BANC", nature_sortie="CONSOMMATION")
    verifier(code == 422 and "hors machine" in str(r).lower(), f"ancienne consommation acceptee : {code} {r}")
    # Le pret revient en nature, pas plus qu'il n'en est parti.
    verifier(float(infra.valeur(f"SELECT reste_kg FROM v_prets_en_cours WHERE tiers = 'Usine du banc' "
                                f"AND code_reference = '{ref}'")) == 15, "le pret n'est pas a rendre")
    code, r = mouvement(c, "Magasinie", "RETOUR_PRET", [(ref, 20)], motif="PRET", tiers="Usine du banc")
    verifier(code == 422, f"retour au-dela du pret accepte : {code} {r}")
    code, r = mouvement(c, "Magasinie", "RETOUR_PRET", [(ref, 15)], motif="PRET", tiers="Usine du banc")
    verifier(code == 200, f"retour du pret refuse : {r}")
    verifier(infra.valeur("SELECT count(*) FROM v_prets_en_cours WHERE tiers = 'Usine du banc'") == "0",
             "le pret rendu reste en cours")
    verifier(controle(infra, "C11") == 0 and controle(infra, "C47") == 0, "C11 ou C47 apres les sorties hors machine")


def scenario_controle_reception(c, infra):
    """Regle 4 (09/10) : au controle la pesee est figee ; le controleur renvoie au magasinier avec un
    motif ; celui qui a pese en dernier ne valide pas ; les corrections sont au journal ; la derogation
    se pose sur une ligne existante."""
    id_bc, lignes = bon_envoye(c, [(REF, 1000, 20.0)])
    lb = lignes[0]
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "num_bon_livraison": "BL-CTL", "lignes": [
        {"code_reference": REF, "id_ligne_bc": lb["id_ligne_bc"], "unite_saisie": "kg",
         "quantite_pesee_unite": 990, "code_magasin_dest": MAG}]})
    rid = r["id_reception"]
    ligne = infra.valeur(f"SELECT id_ligne_reception FROM ligne_reception WHERE id_reception = '{rid}'")
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    # Au controle : la pesee est figee, la qualite non.
    c.refus("Choukri", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"quantite_pesee_unite": 980},
            contient="figee")
    c.ok("Choukri", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"statut_qualite": "CONFORME"})
    # Le renvoi exige un motif.
    c.refus("Choukri", "PUT", f"/api/receptions/{rid}/statut", {"statut": "BROUILLON"}, contient="corriger")
    c.ok("Choukri", "PUT", f"/api/receptions/{rid}/statut", {"statut": "BROUILLON", "motif": "Repeser : 980 kg au BL"})
    verifier(infra.valeur(f"SELECT motif_renvoi FROM reception WHERE id_reception = '{rid}'") == "Repeser : 980 kg au BL",
             "le motif du renvoi n'est pas garde")
    # Un excedent au-dela de la tolerance se pose avec sa derogation, sur la ligne existante.
    c.refus("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"quantite_pesee_unite": 1100})
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}",
         {"quantite_pesee_unite": 1100, "derogation_ecart": True, "motif_derogation": "Excedent accepte par l'acheteur"})
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"quantite_pesee_unite": 980, "derogation_ecart": False})
    # Choukri corrige lui-meme en brouillon : il devient le dernier peseur et ne valide plus.
    c.ok("Choukri", "PATCH", f"/api/receptions/{rid}/lignes/{ligne}", {"quantite_pesee_unite": 981})
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.refus("Choukri", "POST", f"/api/receptions/{rid}/valider", contient="pese")
    c.ok("Mohamed", "POST", f"/api/receptions/{rid}/valider")
    # Regle 6 : 981 kg sur 1 000, dans la tolerance de 2 % -> ligne soldee, bon clos.
    verifier(infra.valeur(f"SELECT statut FROM ligne_bc WHERE id_ligne_bc = '{lb['id_ligne_bc']}'") == "SOLDE",
             "le reliquat dans la tolerance n'a pas solde la ligne")
    verifier(infra.valeur(f"SELECT statut FROM bon_commande WHERE id_bc = '{id_bc}'") == "CLOTURE",
             "le bon entierement solde n'est pas clos")
    verifier(int(infra.valeur("SELECT count(*) FROM audit_log WHERE table_concernee = 'ligne_reception' "
                              f"AND operation = 'UPDATE' AND id_enregistrement = '{ligne}'")) >= 3,
             "les corrections de pesee ne sont pas au journal")


def scenario_retour_cloture_avoirs(c, infra):
    """Le retour LIBRE (12/10) sort au prix du retour : la difference va au CMUP du stock restant, jamais
    sous zero, le reste au journal des ecarts. L'avoir de prix d'une reception ne fait jamais passer le
    CMUP sous zero (U6)."""
    ref, mag = "PLA 140 CHE", "Polyfashions"
    id_bc, lignes = bon_envoye(c, [(ref, 1000, 20.0)])
    rid = reception_validee(c, id_bc, lignes, [1000], mag=mag)

    # 1. Rendu PLUS CHER que le stock ne vaut : le CMUP descend sans passer sous zero ; le reste en ecart.
    q, cm = kg(infra, ref, mag), cmup_magasin(infra, ref, mag)
    plus_gros = max(x["quantite_kg"] for x in c.ok("Choukri", "GET", "/api/retours-fournisseur/disponible")
                    if x["code_reference"] == ref and x["code_magasin"] == mag)
    rendu, prix = round(min(plus_gros, q - 10), 4), round(cm * 3, 4)
    # Le prix du retour est celui des achats (13/10/2026) : l'assistante le saisit ; celui que
    # le magasinier enverrait serait ignore (scenario securite).
    code, r = retour_fournisseur(c, [(ref, rendu, mag, prix)], saisie="Assistante")
    verifier(code == 200, f"retour de {rendu} kg refuse : {r}")
    apres = cmup_magasin(infra, ref, mag)
    verifier(apres >= 0, "le CMUP est passe sous zero")
    ecart = float(infra.valeur(f"SELECT COALESCE(sum(montant_mad), 0) FROM v_ecart_prix WHERE circuit = 'RETOUR' "
                               f"AND document = '{r['numero']}'"))
    verifier(abs(ecart - r["ecart_mad"]) < 0.01 and ecart < 0, f"ecart du retour au journal : {ecart} / {r}")
    # Ce que le stock restant a porte, plus l'ecart, font la difference entiere (CMUP - prix) x rendu.
    difference = rendu * (cm - prix)
    porte = (q - rendu) * (apres - cm)
    verifier(abs(porte + ecart - difference) < 0.05, f"stock {porte} + ecart {ecart} != difference {difference}")

    # 2. U6 : un avoir de prix plus gros que la valeur du stock restant -> CMUP a zero, reste en ecart.
    ap = c.ok("Choukri", "POST", f"/api/receptions/{rid}/cloturer",
              {"numero_facture": "F-U6", "montant_facture": 20000, "facture_nette": False})
    verifier(abs(ap["difference_mad"]) < 0.01, f"cloture : difference {ap['difference_mad']} au lieu de 0")
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/avoir",
         {"nature": "AVOIR", "numero_piece": "AV-X", "montant_mad": 90000, "motif": "Essai d'avoir enorme",
          "code_reference": ref})
    verifier(cmup_magasin(infra, ref, mag) >= 0, "le CMUP est passe sous zero")
    total = float(infra.valeur(f"SELECT sum(montant_mad) FROM reception_ajustements_cmup WHERE id_reception = '{rid}' "
                               "AND numero_piece = 'AV-X'"))
    verifier(abs(total + 90000) < 0.05, f"l'avoir de 90 000 n'est pas entierement journalise : {total}")
    verifier(controle(infra, "C11") == 0, "C11 apres le retour et les avoirs")


def scenario_taux_bon(c, infra):
    """Regle 10 (09/10) : le taux d'un bon en devise est propose au cours du jour de la validation,
    modifiable avec un motif (au-dela de 3 % du cours BAM, a confirmer), puis fige et justifie."""
    taux_usd_du_jour(infra)
    ref = "PP-1500 Dtex-L.Beige 44377-Hs"

    def bon_soumis():
        bc = c.ok("Assistante", "POST", "/api/bons-commande", {
            "code_fournisseur": "FRS-001",
            "lignes": [{"code_reference": ref, "unite_commande": "kg", "quantite_commandee_unite": 100,
                        "prix_unitaire_devise": 2.0}]})
        c.ok("Assistante", "PUT", f"/api/bons-commande/{bc['id_bc']}/statut", {"statut": "EN_ATTENTE_VALIDATION"})
        return bc["id_bc"]

    # Au cours propose : source REFERENCE, date du cours posee.
    b1 = bon_soumis()
    entete = next(b for b in c.ok("Choukri", "GET", "/api/bons-commande") if b["id_bc"] == b1)
    verifier(abs(float(entete.get("taux_du_jour") or 0) - 9.30) < 1e-6, f"taux du jour non propose : {entete.get('taux_du_jour')}")
    c.ok("Choukri", "PUT", f"/api/bons-commande/{b1}/statut", {"statut": "VALIDE"})
    ligne = infra.sql(f"SELECT taux_change_engage, source_taux_engage, date_cours_engage FROM bon_commande WHERE id_bc = '{b1}'")[0]
    verifier(abs(float(ligne[0]) - 9.30) < 1e-6 and ligne[1] == "REFERENCE" and ligne[2],
             f"taux engage au cours propose mal justifie : {ligne}")

    # Un autre taux : motif obligatoire ; au-dela de 3 %, a confirmer.
    b2 = bon_soumis()
    c.refus("Choukri", "PUT", f"/api/bons-commande/{b2}/statut", {"statut": "VALIDE", "taux_saisi": 9.95},
            contient="pourquoi")
    c.refus("Choukri", "PUT", f"/api/bons-commande/{b2}/statut",
            {"statut": "VALIDE", "taux_saisi": 12.0, "motif_taux": "Cours de la banque"}, contient="TAUX-ECART")
    c.ok("Choukri", "PUT", f"/api/bons-commande/{b2}/statut",
         {"statut": "VALIDE", "taux_saisi": 9.95, "motif_taux": "Cours confirme par la banque"})
    ligne = infra.sql(f"SELECT taux_change_engage, source_taux_engage, motif_taux_engage FROM bon_commande WHERE id_bc = '{b2}'")[0]
    verifier(abs(float(ligne[0]) - 9.95) < 1e-6 and ligne[1] == "SAISI" and ligne[2],
             f"taux saisi mal enregistre : {ligne}")

    # Regle 18 (T7) : un taux de reference de plus de 7 jours ne valide pas un bon en devise.
    infra.sql("UPDATE taux_change SET date_debut = to_char(current_date - 10, 'YYYY-MM-DD') "
              "WHERE code_devise = 'USD' AND date_fin IS NULL")
    b3 = bon_soumis()
    c.refus("Choukri", "PUT", f"/api/bons-commande/{b3}/statut", {"statut": "VALIDE"}, contient="7")
    infra.sql("UPDATE taux_change SET date_fin = to_char(current_date, 'YYYY-MM-DD') "
              "WHERE code_devise = 'USD' AND date_fin IS NULL")
    taux_usd_du_jour(infra)


def scenario_plan_detail(c, infra):
    """F16 et U8 (09/10) : le calcul d'une proposition se lit pas a pas et tombe juste ; un dossier
    d'import en brouillon n'est pas de l'en-cours ; C28 dit ce que fait le reglage."""
    ref = "PP-1500 Dtex-Cream 2951-Hs"
    from urllib.parse import quote
    # LE PLAN D'ACHAT SUIT LE PLAN DE PRODUCTION, ET LUI SEUL (10/10/2026) : sans plan en
    # cours, rien n'est propose, pas meme pour une reference sous son minimum.
    infra.sql(f"UPDATE reference SET stock_min_kg = 50000 WHERE code_reference = '{ref}'")
    verifier(infra.valeur(f"SELECT count(*) FROM v_plan_achat WHERE code_reference = '{ref}' "
                          "AND NOT EXISTS (SELECT 1 FROM plan_production WHERE statut = 'EN_COURS')") == "0",
             "le plan d'achat propose un achat sans plan de production (stock minimum)")
    infra.sql(f"UPDATE reference SET stock_min_kg = NULL WHERE code_reference = '{ref}'")
    # Un plan de production saisi, valide, et son MRP : le detail se lit sur ce qu'il reclame.
    qualite = infra.valeur("SELECT q.code_qualite FROM qualite q WHERE q.statut = 'ACTIF' "
                           "AND EXISTS (SELECT 1 FROM recette r WHERE r.code_qualite = q.code_qualite AND r.actif = 1) "
                           "AND NOT EXISTS (SELECT 1 FROM plan_qualite pq JOIN plan_production p USING (id_plan) "
                           "WHERE pq.code_qualite = q.code_qualite AND p.statut <> 'CLOTURE') ORDER BY 1 LIMIT 1")
    mois = infra.valeur("SELECT to_char(current_date, 'YYYY-MM')")
    plan = c.ok("Choukri", "PUT", "/api/plans", {"libelle": "Plan du banc", "date_debut": mois, "mois_horizon": 12,
                                                 "croissance_annuelle_pct": 0,
                                                 "saisonnalite": [{"code_qualite": qualite, "mois": m, "coefficient": 1}
                                                                  for m in range(1, 13)],
                                                 "qualites": [{"code_qualite": qualite, "m2_base_mensuel": 20000}]})
    id_plan = plan["id_plan"]
    c.ok("Choukri", "PUT", f"/api/plans/{id_plan}/statut", {"statut": "SIMULATION"})
    c.ok("Choukri", "POST", f"/api/plans/{id_plan}/figer-recettes", {})
    c.ok("Choukri", "PUT", f"/api/plans/{id_plan}/statut", {"statut": "EN_COURS"})
    c.ok("Choukri", "POST", f"/api/plans/{id_plan}/mrp", {})
    ref_detail = infra.valeur("SELECT code_reference FROM v_plan_achat ORDER BY qte_a_commander_kg DESC LIMIT 1")
    verifier(bool(ref_detail), "un plan de production en cours ne produit aucune proposition d'achat")
    d = c.ok("Choukri", "GET", f"/api/plan-achat/detail?reference={quote(ref_detail)}")
    k = d["calcul"]
    projete = k["stock_magasin_net_kg"] + k["stock_machine_compte_kg"] + k["encours_kg"] - k["demande_delai_kg"]
    verifier(abs(max(0.0, projete) - k["residuel_kg"]) < 0.01,
             f"le detail ne retombe pas sur le residuel : {projete:.2f} contre {k['residuel_kg']}")
    besoin = max(0.0, k["sorties_fenetre_kg"] + k["securite_kg"] - k["residuel_kg"])
    verifier(abs(besoin - k["besoin_avant_arrondi_kg"]) < 0.01 or (k.get("moq_kg") or 0) >= k["besoin_avant_arrondi_kg"] - 0.01,
             f"besoin du plan {besoin:.2f} contre {k['besoin_avant_arrondi_kg']}")
    c.refus("Choukri", "GET", "/api/plan-achat/detail?reference=INCONNUE-XYZ", codes=(404,))

    def au_port():
        return float(infra.valeur(f"SELECT COALESCE((SELECT encours_import_kg FROM v_encours_fiable "
                                  f"WHERE code_reference = '{ref}'), 0)"))

    avant = au_port()
    aujourdhui = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={aujourdhui}")["reference"]
    dossier = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/PORT", "code_devise": "USD"})
    id_dossier = dossier.get("id_dossier") or dossier.get("id")
    f = c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-PORT", "date_facture": aujourdhui,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 600})
    c.ok("Choukri", "POST", f"/api/import/factures/{f.get('id_facture') or f.get('id')}/lignes", {
        "type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 300, "poids_net_kg": 300,
        "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-PORT-1"})
    verifier(abs(au_port() - avant) < 1e-6, "un dossier d'import en brouillon compte dans l'en-cours")
    c.ok("Choukri", "POST", f"/api/import/dossiers/{id_dossier}/valider")
    verifier(abs(au_port() - avant - 300) < 1e-6, f"le dossier engage ne compte pas au port : {au_port() - avant}")

    infra.sql("UPDATE parametre SET valeur_courante = '1' WHERE code_parametre = 'P_EncoursRetardInclus'")
    verifier("toujours comptee" in infra.valeur("SELECT controle FROM v_controles WHERE code = 'C28'"),
             "C28 dit « retiree » alors que le retard est compte")
    infra.sql("UPDATE parametre SET valeur_courante = '0' WHERE code_parametre = 'P_EncoursRetardInclus'")
    verifier("retiree" in infra.valeur("SELECT controle FROM v_controles WHERE code = 'C28'"), "C28 ne suit pas le reglage")
    infra.sql("UPDATE parametre SET valeur_courante = '1' WHERE code_parametre = 'P_EncoursRetardInclus'")

    # T10 (09/10) : deux calculs du plan d'achat ; la purge du second se resume en une ligne
    # d'audit, au lieu d'une par proposition remplacee.
    c.ok("Choukri", "POST", "/api/plan-achat/generer", {})
    avant = int(infra.valeur("SELECT count(*) FROM audit_log WHERE table_concernee = 'plan_achat' AND operation = 'DELETE'"))
    propositions = int(infra.valeur("SELECT count(*) FROM plan_achat WHERE statut = 'PROPOSE' AND figee = 0"))
    c.ok("Choukri", "POST", "/api/plan-achat/generer", {})
    apres = int(infra.valeur("SELECT count(*) FROM audit_log WHERE table_concernee = 'plan_achat' AND operation = 'DELETE'"))
    verifier(apres - avant == (1 if propositions else 0),
             f"la purge du plan inscrit {apres - avant} lignes d'audit pour {propositions} propositions")

    # Regle 17 (T7) : ecartee, une reference ne revient pas au calcul suivant ; au-dela de
    # P_DureeEcartJours, elle revient.
    prop = infra.sql("SELECT id_proposition, code_reference FROM plan_achat WHERE statut = 'PROPOSE' AND figee = 0 "
                     "ORDER BY code_reference LIMIT 1")
    if prop:
        id_prop, ref_prop = prop[0]
        c.ok("Choukri", "POST", f"/api/plan-achat/propositions/{id_prop}/ignorer", {})
        c.ok("Choukri", "POST", "/api/plan-achat/generer", {})
        verifier(infra.valeur(f"SELECT count(*) FROM plan_achat WHERE code_reference = '{ref_prop}' "
                              "AND statut = 'PROPOSE'") == "0", "une proposition ecartee revient au calcul suivant")
        infra.sql(f"UPDATE plan_achat SET date_ecartee = to_char(current_date - 100, 'YYYY-MM-DD') "
                  f"WHERE id_proposition = '{id_prop}'")
        c.ok("Choukri", "POST", "/api/plan-achat/generer", {})
        verifier(infra.valeur(f"SELECT count(*) FROM plan_achat WHERE code_reference = '{ref_prop}' "
                              "AND statut = 'PROPOSE'") == "1", "l'ecart expire ne rend pas la proposition")


def scenario_derogation_bornee(c, infra):
    """F17 (09/10) : la derogation d'un lot bloque couvre les kilos d'une fiche, pas plus ; elle tombe
    avec la fiche annulee ; la validation l'emploie lot par lot."""
    ref, lot = "PP-1500 Dtex-L.Beige 44377-Hs", "LOT-DERO-1"
    jour = taux_usd_du_jour(infra)
    id_bc, lignes = bon_envoye(c, [(ref, 520, 2.0)], frs="FRS-001")
    reception_validee(c, id_bc, lignes, [520], lot_fournisseur=lot, nb_bobines=200)
    c.ok("Choukri", "POST", "/api/lots/statut", {"code_reference": ref, "lot_fournisseur": lot,
                                                 "action": "BLOQUER", "motif": "Nuance douteuse, essai du banc"})
    # Regle 11 (T7) : bloque, le lot ne sort pas en production.
    code, r = c.appel("Choukri", "POST", "/api/mouvements", {
        "code_type_mvt": "SORTIE_PROD", "code_magasin": MAG, "code_motif": "PRODUCTION", "numero_of": "OF-BANC-BLOQUE",
        "lignes": [{"code_reference": ref, "quantite_saisie": 5, "unite_saisie": "kg", "lot_fournisseur": lot}]})
    verifier(code == 422 and "LOT-BLOQUE" in str(r), f"sortie en production d'un lot bloque : {code} {r}")
    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANCD", "nom": "Machine des derogations",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})

    def fiche():
        f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
            "type_fiche": "CHARGE", "code_machine": "BANCD", "code_emplacement": "BANCD-E1", "date_fiche": jour,
            "code_magasin": MAG, "responsable": "Banc",
            "lignes": [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 100,
                        "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}]})
        return f["id_fiche"], infra.valeur(f"SELECT numero_fiche FROM machine_fiche WHERE id_fiche = '{f['id_fiche']}'")

    def demander(numero, kg):
        d = c.ok("Magasinie", "POST", "/api/autorisations", {
            "type_demande": "LOT_BLOQUE", "code_reference": ref, "lot_fournisseur": lot, "kg": kg,
            "document": numero, "motif": "Commande urgente, nuance acceptee par le client"})
        c.ok("Choukri", "POST", f"/api/autorisations/{d['id_demande']}/decider",
             {"decision": "ACCORDEE", "motif": "Vu avec la qualite pour cette fiche"})
        return d["id_demande"]

    f1, n1 = fiche()
    ap = c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/apercu", {})
    verifier(any("LOT-BLOQUE" in b for b in map(str, ap["blocages"])), f"lot bloque non refuse : {ap['blocages']}")
    verifier([abs(float(x["kg"]) - 260) < 0.01 for x in ap["derogations"]] == [True],
             f"la derogation proposee ne porte pas les 260 kg de la fiche : {ap['derogations']}")
    # Accordee pour 200 kg : la fiche en charge 260, refusee ; la base aussi.
    d1 = demander(n1, 200)
    c.refus("Magasinie", "POST", f"/api/machines/fiches/{f1}/valider", {}, contient="DEROGATION-KG")
    # La fiche remplacee emporte sa derogation.
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f1}/annuler", {"motif": "Fiche refaite, essai du banc"})
    verifier(infra.valeur(f"SELECT statut FROM demande_autorisation WHERE id_demande = '{d1}'") == "ANNULEE",
             "la derogation d'une fiche annulee reste accordee")
    # La nouvelle fiche, sa derogation a la bonne mesure : le chargement passe et l'emploie.
    f2, n2 = fiche()
    d2 = demander(n2, 260)
    avant = kg(infra, ref)
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f2}/valider", {})
    verifier(abs(avant - kg(infra, ref) - 260) < 0.01, "le chargement derogatoire n'a pas sorti 260 kg")
    ligne = infra.sql(f"SELECT date_consommation IS NOT NULL, kg_consommes FROM demande_autorisation WHERE id_demande = '{d2}'")[0]
    verifier(ligne[0] in (True, "t") and abs(float(ligne[1]) - 260) < 0.01, f"derogation non employee : {ligne}")
    verifier(controle(infra, "C11") == 0, "C11 apres le chargement derogatoire")


def scenario_machine_constat(c, infra):
    """F19 (09/10) : une fiche ne rajeunit que les lignes qu'elle touche ; C36 voit l'etage dont une
    ligne n'a pas ete constatee depuis P_JoursInventMachine ; C35 l'estimation hors tolerance."""
    ref = "PP-1500 Dtex-L.Beige 44377-Hs"
    jour = taux_usd_du_jour(infra)
    for lot in ("LOT-CST-1", "LOT-CST-2"):
        id_bc, lignes = bon_envoye(c, [(ref, 260, 2.0)], frs="FRS-001")
        reception_validee(c, id_bc, lignes, [260], lot_fournisseur=lot, nb_bobines=100)
    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANC3", "nom": "Machine des constats",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})
    zone = "BANC3-E1"

    def valider(type_fiche, lignes):
        f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
            "type_fiche": type_fiche, "code_machine": "BANC3", "code_emplacement": zone, "date_fiche": jour,
            "code_magasin": MAG if type_fiche != "MAJ" else None, "responsable": "Banc", "lignes": lignes})
        c.ok("Magasinie", "POST", f"/api/machines/fiches/{f['id_fiche']}/valider", {})

    def date_de(lot):
        return infra.valeur(f"SELECT substr(date_constat, 1, 10) FROM machine_etat "
                            f"WHERE code_emplacement = '{zone}' AND lot_fournisseur = '{lot}'")

    valider("CHARGE", [{"code_reference": ref, "lot_fournisseur": "LOT-CST-1", "nb_bobines_mouvementees": 50,
                        "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}])
    c36 = controle(infra, "C36")
    infra.sql(f"UPDATE machine_etat SET date_constat = '2026-01-05' WHERE code_emplacement = '{zone}'")
    verifier(controle(infra, "C36") == c36 + 1, "C36 ne voit pas l'etage constate en janvier")
    # Charger un autre lot ne rajeunit pas le premier.
    valider("CHARGE", [{"code_reference": ref, "lot_fournisseur": "LOT-CST-2", "nb_bobines_mouvementees": 20,
                        "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}])
    verifier(date_de("LOT-CST-1") == "2026-01-05", f"le lot non touche a pris la date de la fiche : {date_de('LOT-CST-1')}")
    verifier(date_de("LOT-CST-2") == jour, f"le lot charge n'a pas la date de la fiche : {date_de('LOT-CST-2')}")
    verifier(controle(infra, "C36") == c36 + 1, "C36 a oublie l'etage apres un chargement partiel")
    # Le constat du premier lot le rajeunit : l'etage sort de C36.
    valider("MAJ", [{"code_reference": ref, "lot_fournisseur": "LOT-CST-1", "nb_bobines_presentes": 50,
                     "pourcentage": 100, "code_motif": "MJ_ORDINAIRE"}])
    verifier(date_de("LOT-CST-1") == jour, "le constat n'a pas rajeuni la ligne constatee")
    verifier(controle(infra, "C36") == c36, "C36 garde l'etage tout juste constate")
    # C35 : un poids par bobine a 20 % du catalogue.
    c35 = controle(infra, "C35")
    infra.sql(f"UPDATE machine_etat SET poids_unitaire_kg = poids_unitaire_kg * 1.2 "
              f"WHERE code_emplacement = '{zone}' AND lot_fournisseur = 'LOT-CST-2'")
    verifier(controle(infra, "C35") == c35 + 1, "C35 ne voit pas une estimation a +20 %")


def scenario_lots_vivants(c, infra):
    """F21 et U10 (09/10) : un lot solde qui recoit se rouvre ; un lot qui tourne sur machine ne se
    solde pas ; une demande en attente ne se cree qu'une fois ; le plancher du lot laisse une trace ;
    C51 compte le fil sans lot d'une reference suivie."""
    ref, lot = "PP-1500 Dtex-L.Beige 44377-Hs", "LOT-VIV-1"
    jour = taux_usd_du_jour(infra)
    id_bc, lignes = bon_envoye(c, [(ref, 130, 2.0)], frs="FRS-001")
    reception_validee(c, id_bc, lignes, [130], lot_fournisseur=lot, nb_bobines=50)
    verifier(infra.valeur("SELECT count(*) FROM v_controles WHERE code = 'C51'") == "1", "C51 absent de v_controles")

    # Sur machine, le lot ne se solde pas.
    c.ok("Choukri", "POST", "/api/machines", {"code_machine": "BANCL", "nom": "Machine des lots",
                                              "zones": [{"role": "ETAGE", "numero_etage": 1, "capacite_bobines": 300}]})
    f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
        "type_fiche": "CHARGE", "code_machine": "BANCL", "code_emplacement": "BANCL-E1", "date_fiche": jour,
        "code_magasin": MAG, "responsable": "Banc",
        "lignes": [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 10,
                    "poids_retenu_kg": 2.6, "pourcentage": 100, "code_motif": "CH_PRODUCTION"}]})
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f['id_fiche']}/valider", {})
    decision = {"code_reference": ref, "lot_fournisseur": lot, "decision": "SOLDER", "motif": "Lot dormant, essai du banc"}
    c.refus("Choukri", "POST", "/api/lots/dormant", decision, contient="LOT-MACHINE")
    # Meme par une ecriture directe, il garde son statut.
    infra.sql(f"UPDATE lot SET statut = 'SOLDE' WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}'")
    verifier(infra.valeur(f"SELECT statut FROM lot WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}'") == "LIBRE",
             "un lot qui tourne sur machine est passe SOLDE")

    # Decharge, puis solde : le lot est vide au magasin et sur machine.
    f = c.ok("Magasinie", "POST", "/api/machines/fiches", {
        "type_fiche": "DECHARGE", "code_machine": "BANCL", "code_emplacement": "BANCL-E1", "date_fiche": jour,
        "code_magasin": MAG, "responsable": "Banc",
        "lignes": [{"code_reference": ref, "lot_fournisseur": lot, "nb_bobines_mouvementees": 10,
                    "pct_retirees": 100, "destination": "MAGASIN", "code_motif": "DE_CHGT_PROD"}]})
    c.ok("Magasinie", "POST", f"/api/machines/fiches/{f['id_fiche']}/valider", {})
    c.ok("Choukri", "POST", "/api/lots/dormant", decision)
    verifier(infra.valeur(f"SELECT statut FROM lot WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}'") == "SOLDE",
             "le lot vide ne s'est pas solde")
    # Il recoit : il se rouvre, avec son evenement.
    code, r = c.appel("Choukri", "POST", "/api/mouvements", {
        "code_type_mvt": "AJUST_INV_POS", "code_magasin": MAG, "code_motif": "INVENTAIRE",
        "lignes": [{"code_reference": ref, "quantite_saisie": 5, "unite_saisie": "kg", "lot_fournisseur": lot,
                    "code_motif_ligne": "R1"}]})
    verifier(code == 200, f"ajustement sur le lot solde refuse : {r}")
    verifier(infra.valeur(f"SELECT statut FROM lot WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}'") == "LIBRE",
             "le lot solde qui recoit est reste SOLDE")
    verifier(int(infra.valeur(f"SELECT count(*) FROM lot_evenement WHERE code_reference = '{ref}' "
                              f"AND lot_fournisseur = '{lot}' AND type_evenement = 'REOUVERTURE'")) == 1,
             "pas d'evenement REOUVERTURE")

    # Le plancher laisse une trace (ecriture directe, puis le solde reel est remis : C15).
    solde = infra.valeur(f"SELECT quantite_kg FROM stock_lot WHERE code_reference = '{ref}' "
                         f"AND lot_fournisseur = '{lot}' AND code_magasin = '{MAG}'")
    infra.sql(f"UPDATE stock_lot SET quantite_kg = -2 WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}' "
              f"AND code_magasin = '{MAG}'")
    verifier(int(infra.valeur(f"SELECT count(*) FROM lot_evenement WHERE lot_fournisseur = '{lot}' "
                              f"AND type_evenement = 'PLANCHER'")) == 1, "le plancher n'a rien inscrit")
    infra.sql(f"UPDATE stock_lot SET quantite_kg = {solde} WHERE code_reference = '{ref}' AND lot_fournisseur = '{lot}' "
              f"AND code_magasin = '{MAG}'")

    # Deux demandes identiques : une seule en attente.
    demande = {"type_demande": "LOT_BLOQUE", "code_reference": ref, "lot_fournisseur": lot, "kg": 10,
               "document": "MCH-BANC-DOUBLE", "motif": "Essai de double demande"}
    d1 = c.ok("Magasinie", "POST", "/api/autorisations", demande)
    d2 = c.ok("Magasinie", "POST", "/api/autorisations", demande)
    verifier(d1["id_demande"] == d2["id_demande"] and d2.get("reprise"), f"demande creee deux fois : {d1} {d2}")


def scenario_import_bon_envoye(c, infra):
    """U1 (09/10) : une ligne de facture d'import ne vise qu'un bon envoye, du meme fournisseur et de la
    meme reference ; la liste des lignes a facturer ne propose pas une ligne deja servie."""
    ref = "PP-1500 Dtex-Cream 2951-Hs"
    taux_usd_du_jour(infra)
    aujourdhui = infra.valeur("SELECT to_char(current_date, 'YYYY-MM-DD')")
    cours = c.ok("Choukri", "GET", f"/api/import/taux-reference?devise=USD&date={aujourdhui}")["reference"]
    d = c.ok("Choukri", "POST", "/api/import/dossiers", {"numero": "BANC/BON", "code_devise": "USD"})
    f = c.ok("Choukri", "POST", f"/api/import/dossiers/{d.get('id_dossier') or d.get('id')}/factures", {
        "code_fournisseur": "FRS-001", "numero_facture": "FB-BON", "date_facture": aujourdhui,
        "code_devise": "USD", "taux_change": cours, "montant_devise": 200})
    id_facture = f.get("id_facture") or f.get("id")
    brouillon = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": "FRS-001",
        "lignes": [{"code_reference": ref, "unite_commande": "kg", "quantite_commandee_unite": 100, "prix_unitaire_devise": 2.0}]})
    ligne_brouillon = infra.valeur(f"SELECT id_ligne_bc FROM ligne_bc WHERE id_bc = '{brouillon['id_bc']}'")
    base = {"type_ligne": "ERP", "code_reference": ref, "unite": "kg", "quantite": 100, "poids_net_kg": 100,
            "prix_unitaire_devise": 2.0, "lot_fournisseur": "LOT-BON-1"}
    c.refus("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", dict(base, id_ligne_bc=ligne_brouillon),
            contient="IMPORT-BC")
    id_bc, lignes = bon_envoye(c, [(ref, 100, 2.0)], frs="FRS-001")
    autre = infra.valeur("SELECT code_reference FROM reference WHERE actif = 1 AND code_reference <> "
                         f"'{ref}' ORDER BY code_reference LIMIT 1")
    c.refus("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes",
            dict(base, code_reference=autre, id_ligne_bc=lignes[0]["id_ligne_bc"]), contient="porte la reference")
    c.ok("Choukri", "POST", f"/api/import/factures/{id_facture}/lignes", dict(base, id_ligne_bc=lignes[0]["id_ligne_bc"]))
    # Servie en local, une ligne ne se propose plus a la facturation.
    id_bc2, lignes2 = bon_envoye(c, [(ref, 100, 2.0)], frs="FRS-001")
    reception_validee(c, id_bc2, lignes2, [100], lot_fournisseur="LOT-BON-2", nb_bobines=38)
    ouvertes = c.ok("Choukri", "GET", "/api/import/lignes-bc?fournisseur=FRS-001")
    verifier(all(x["id_ligne_bc"] != lignes2[0]["id_ligne_bc"] for x in ouvertes),
             "une ligne de bon deja servie en local reste proposee a l'import")


def scenario_parametres_types(c, infra):
    """T15 (09/10) : un parametre garde son type (entier, nombre au point, date) ; la base refuse le reste."""
    refus_sql(infra, "UPDATE parametre SET valeur_courante = '2,5' WHERE code_parametre = 'P_TolerEcartPesee'", "PARAMETRE")
    refus_sql(infra, "UPDATE parametre SET valeur_courante = '10 j' WHERE code_parametre = 'P_RetardBCJours'", "PARAMETRE")
    refus_sql(infra, "UPDATE parametre SET valeur_courante = '2026-02-30' WHERE code_parametre = 'P_DateRefKPI'", "PARAMETRE")
    infra.sql("UPDATE parametre SET valeur_courante = ' 2.5 ' WHERE code_parametre = 'P_TolerEcartPesee'")
    verifier(infra.valeur("SELECT valeur_courante FROM parametre WHERE code_parametre = 'P_TolerEcartPesee'") == "2.5",
             "la valeur d'un parametre numerique n'est pas nettoyee")
    infra.sql("UPDATE parametre SET valeur_courante = '2' WHERE code_parametre = 'P_TolerEcartPesee'")


def scenario_migrations_rejouables(c, infra):
    """T7 (09/10) : chaque migration du 09/10, rejouee a la main sur une base qui l'a deja recue et
    porte des donnees, passe sans erreur et ne change ni le nombre de controles ni le grand livre."""
    from pathlib import Path
    dossier = Path(__file__).resolve().parents[3] / "db" / "pg" / "migrations"
    avant = (infra.valeur("SELECT count(*) FROM v_controles"), infra.valeur("SELECT count(*) FROM ligne_mouvement"))
    for f in sorted(dossier.glob("2026-10-09*.sql")):
        try:
            infra.psql(infra.base, "-q", "-f", str(f))
        except RuntimeError as e:
            raise Echec(f"{f.name} ne se rejoue pas : {str(e)[-300:]}")
    apres = (infra.valeur("SELECT count(*) FROM v_controles"), infra.valeur("SELECT count(*) FROM ligne_mouvement"))
    verifier(avant == apres, f"le rejeu a change les controles ou le grand livre : {avant} -> {apres}")


def scenario_gardes_p1(c, infra):
    """Arbitrages du 09/10 : une date vide est une date absente ; la tolerance du fournisseur se
    fixe au droit VALIDER et se journalise ; le modele de droits n'oublie aucun champ sensible."""
    # Un bon sans date de livraison (regression de la contrainte de format du 08/10).
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {
        "code_fournisseur": FRS, "date_livraison_prevue": "",
        "lignes": [{"code_reference": REF, "unite_commande": "kg", "quantite_commandee_unite": 100,
                    "prix_unitaire_devise": 20}]})
    verifier(infra.valeur(f"SELECT coalesce(date_livraison_prevue, 'NULL') FROM bon_commande "
                          f"WHERE id_bc = '{bc['id_bc']}'") == "NULL", "la date vide n'est pas devenue NULL")

    # La tolerance de pesee : l'assistante corrige la fiche, pas le seuil.
    tol = infra.valeur(f"SELECT tolerance_pesee_pct FROM fournisseur WHERE code_fournisseur = '{FRS}'")
    c.ok("Assistante", "PATCH", f"/api/fournisseurs/{FRS}", {"telephone": "0539000000", "tolerance_pesee_pct": tol})
    c.refus("Assistante", "PATCH", f"/api/fournisseurs/{FRS}", {"tolerance_pesee_pct": 10}, contient="valider")
    c.ok("Choukri", "PATCH", f"/api/fournisseurs/{FRS}", {"tolerance_pesee_pct": 3})
    verifier(int(infra.valeur("SELECT count(*) FROM audit_log WHERE table_concernee = 'fournisseur' "
                              "AND nouvelles_valeurs LIKE '%tolerance_pesee_pct%'")) >= 1,
             "le changement de tolerance n'est pas au journal")
    c.ok("Choukri", "PATCH", f"/api/fournisseurs/{FRS}", {"tolerance_pesee_pct": tol})
    verifier(controle(infra, "C46") == 0, "un champ sensible n'a pas de ligne dans le modele de droits")
    # Regle 8 : le prix d'une proposition est d'abord le dernier prix d'achat chez ce fournisseur.
    bon_envoye(c, [(REF, 100, 20.0)])
    dernier = infra.valeur(f"SELECT fn_dernier_prix_achat_mad('{REF}', '{FRS}')")
    verifier(dernier is not None and abs(float(dernier) - 20) < 0.001, f"dernier prix d'achat : {dernier} au lieu de 20")
    # Regle 9 : la saison se regle (Direction), les stocks minimums a revoir se listent.
    c.ok("Choukri", "PATCH", "/api/saisons/1", {"coefficient": 0.7})
    verifier(abs(float(infra.valeur("SELECT coefficient FROM saison_mois WHERE mois = 1")) - 0.7) < 1e-9,
             "le coefficient de janvier n'est pas enregistre")
    c.refus("Magasinie", "PATCH", "/api/saisons/1", {"coefficient": 2})
    c.refus("Choukri", "PATCH", "/api/saisons/1", {"coefficient": 0})
    c.ok("Choukri", "PATCH", "/api/saisons/1", {"coefficient": 1})
    c.ok("Assistante", "GET", "/api/plan-achat/stocks-minimums")
    verifier(int(infra.valeur("SELECT count(*) FROM v_controles WHERE code IN ('C49', 'C50')")) == 2,
             "les controles C49 et C50 manquent")
    # La supervision complete (2026-09-20d, rejouee par 09b) : plus d'« erreur interne ».
    sup = c.ok("Choukri", "GET", "/api/supervision")
    verifier(sup, "la supervision ne rend rien")

# ---------------------------------------------------------------------------
# Etape 1 (10/10/2026) : le CMUP calcule a la main, l'atomicite, la concurrence
# ---------------------------------------------------------------------------
def r4(x):
    """L'arrondi de la base : 4 decimales pour les kg et le CMUP (db::arrondi_kg)."""
    return round(x + 0.0, 4)


def inventaire_global(c, infra, mag, comptes, motif="Comptage du banc"):
    """Un inventaire global de `mag` : `comptes` {reference: kg compte}, le reste compte au theorique."""
    inv = c.ok("Choukri", "POST", "/api/inventaires", {"code_magasin": mag, "type_inventaire": "GLOBAL"})
    iid = inv["id_inventaire"]
    lignes = c.ok("Magasinie", "GET", f"/api/inventaires/{iid}/lignes")
    comptages = []
    for l in lignes:
        ref = l["code_reference"]
        q = comptes.get(ref, float(l["quantite_theorique_kg"] or 0))
        comptage = {"code_reference": ref, "code_magasin": mag, "lot_fournisseur": l.get("lot_fournisseur"),
                    "quantite_comptee_kg": q}
        if ref in comptes:
            comptage["motif_ecart"] = motif
        comptages.append(comptage)
    c.ok("Magasinie", "PUT", f"/api/inventaires/{iid}/lignes", {"comptages": comptages})
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/valider")
    c.ok("Choukri", "POST", f"/api/inventaires/{iid}/cloturer")


def valeur_magasins(infra, ref):
    return float(infra.valeur(f"SELECT COALESCE(sum(valeur_mad), 0) FROM stock_magasin WHERE code_reference = '{ref}'"))


def scenario_cmup_chiffre(c, infra):
    """LE CMUP CALCULE A LA MAIN, scenario par scenario (etape 1, 10/10/2026) : premiere
    reception, second prix, sortie (CMUP inchange, cout porte par la ligne), transfert en
    route avec une reception pendant le trajet (le CMUP de depart voyage avec le fil, la
    valeur totale ne baisse pas), inventaire - et +, devalidation d'une reception, achat en
    devise au taux engage du bon."""
    A, M, P = "PLA 80 CHE", "Morocco", "Polyfashions"
    verifier(kg(infra, A, M) == 0 and kg(infra, A, P) == 0, "PLA 80 CHE doit partir d'un stock nul")
    cm = lambda mag: cmup_magasin(infra, A, mag)
    egal = lambda a, b: a is not None and abs(a - b) <= 0.00011

    # 1. Premiere reception : le CMUP est le prix.
    entree_stock(c, A, 1000, prix=20.0, mag=M)
    verifier(egal(cm(M), 20.0), f"1re reception : CMUP {cm(M)} au lieu de 20")
    # 2. Second prix : moyenne ponderee (1000 x 20 + 500 x 23) / 1500 = 21.
    entree_stock(c, A, 500, prix=23.0, mag=M)
    verifier(egal(cm(M), 21.0), f"2e reception : CMUP {cm(M)} au lieu de 21")

    # 3. Une sortie ne touche pas le CMUP, et porte son cout (migration 10c).
    code, r = mouvement(c, "Magasinie", "SORTIE_HORS_MACHINE", [(A, 40)], mag=M,
                        motif="HORS_MACHINE", motif_ligne="HM_ECHANTILLON")
    verifier(code == 200, f"sortie de 40 kg refusee : {r}")
    verifier(egal(cm(M), 21.0) and abs(kg(infra, A, M) - 1460) < 1e-6, f"apres sortie : {kg(infra, A, M)} kg a {cm(M)}")
    cout = infra.valeur(
        "SELECT lm.prix_kg_mad FROM ligne_mouvement lm JOIN mouvement m USING (id_mouvement) "
        f"WHERE m.code_type_mvt = 'SORTIE_HORS_MACHINE' AND lm.code_reference = '{A}' "
        "ORDER BY m.date_mouvement DESC LIMIT 1")
    verifier(cout is not None and egal(float(cout), 21.0), f"la sortie ne porte pas son cout au CMUP : {cout}")

    # 4. Transfert de 600 kg vers Polyfashions, une reception pendant le trajet.
    valeur_avant = valeur_magasins(infra, A)
    t = c.ok("Magasinie", "POST", "/api/transferts", {
        "code_magasin_source": M, "code_magasin_dest": P,
        "lignes": [{"code_reference": A, "quantite_saisie": 600, "unite_saisie": "kg"}]})
    tid = t["id_transfert"]
    c.ok("Magasinie", "POST", f"/api/transferts/{tid}/expedier")
    verifier(abs(kg(infra, A, M) - 860) < 1e-6 and kg(infra, A, P) == 0, "l'expedition n'a pas sorti 600 kg")
    verifier(egal(cm(M), 21.0), f"l'expedition a touche le CMUP de depart : {cm(M)}")
    route = infra.sql(f"SELECT kg_en_route, valeur_en_route_mad FROM v_stock_transit_reference WHERE code_reference = '{A}'")
    verifier(route and abs(float(route[0][0]) - 600) < 1e-6 and abs(float(route[0][1]) - 12600) < 0.01,
             f"en route : {route} au lieu de 600 kg pour 12 600 MAD")
    total = valeur_magasins(infra, A) + float(route[0][1])
    verifier(abs(total - valeur_avant) < 0.05, f"la valeur totale baisse pendant le trajet : {valeur_avant} -> {total}")
    besoin = float(infra.valeur(f"SELECT stock_transit_kg FROM v_stock_physique WHERE code_reference = '{A}'"))
    verifier(abs(besoin - 600) < 1e-6, f"le calcul des besoins ne voit pas le fil en route : {besoin}")
    cat = next(x for x in c.ok("Choukri", "GET", "/api/catalogue?actif=1&limite=2000") if x["code_reference"] == A)
    verifier(abs(float(cat["valeur_transit_mad"]) - 12600) < 0.01, f"le catalogue ignore la valeur en route : {cat.get('valeur_transit_mad')}")
    # Pendant le trajet : 400 kg a 26 au depart, 200 kg a 30 a l'arrivee.
    rid_26 = entree_stock(c, A, 400, prix=26.0, mag=M)
    cm_m = r4((860 * 21 + 400 * 26) / 1260)
    verifier(egal(cm(M), cm_m), f"reception pendant le trajet : CMUP depart {cm(M)} au lieu de {cm_m}")
    entree_stock(c, A, 200, prix=30.0, mag=P)
    verifier(egal(cm(P), 30.0), f"1re reception a l'arrivee : {cm(P)}")
    # L'arrivee entre au CMUP FIGE AU DEPART (21), pas a celui du jour (22,59).
    c.ok("Magasinie", "POST", f"/api/transferts/{tid}/receptionner")
    cm_p = r4((200 * 30 + 600 * 21) / 800)
    verifier(egal(cm(P), cm_p), f"arrivee du transfert : CMUP {cm(P)} au lieu de {cm_p}")
    verifier(egal(cm(M), cm_m), "l'arrivee a touche le CMUP du magasin de depart")
    verifier(abs(kg(infra, A, P) - 800) < 1e-6, f"arrivee : {kg(infra, A, P)} kg au lieu de 800")
    verifier(not infra.sql(f"SELECT 1 FROM v_stock_transit_reference WHERE code_reference = '{A}'"), "le transfert reste en route")

    # 5. Inventaire : un ecart - puis + ne change pas le CMUP.
    inventaire_global(c, infra, P, {A: 790}, "Bobine abimee (banc CMUP)")
    verifier(abs(kg(infra, A, P) - 790) < 1e-6 and egal(cm(P), cm_p), f"inventaire - : {kg(infra, A, P)} kg a {cm(P)}")
    inventaire_global(c, infra, P, {A: 800}, "Bobine retrouvee (banc CMUP)")
    verifier(abs(kg(infra, A, P) - 800) < 1e-6 and egal(cm(P), cm_p), f"inventaire + : {kg(infra, A, P)} kg a {cm(P)}")

    # 6. Defaire la reception a 26 : sa marchandise est en stock, on contre-passe d'abord
    #    son entree (la valeur sort A SON PRIX, dans son seul magasin), puis le papier recule.
    id_entree = infra.valeur(f"SELECT id_mouvement_genere FROM ligne_reception WHERE id_reception = '{rid_26}'")
    c.ok("Choukri", "POST", f"/api/mouvements/{id_entree}/contre-passer", {"motif": "Pesee a refaire (banc CMUP)"})
    c.ok("Choukri", "POST", f"/api/devalider/receptions/{rid_26}", {"motif": "Pesee a refaire (banc CMUP)"})
    cm_dev = r4((860 * cm_m + 400 * cm_m - 400 * 26) / 860)
    verifier(abs(kg(infra, A, M) - 860) < 1e-6, f"devalidation : {kg(infra, A, M)} kg au lieu de 860")
    verifier(egal(cm(M), cm_dev), f"devalidation : CMUP {cm(M)} au lieu de {cm_dev}")

    # 7. Achat en devise : le prix en dirhams est le prix du bon au taux ENGAGE.
    taux_usd_du_jour(infra)
    H = "Hotmelt"
    verifier(kg(infra, H, M) == 0, "Hotmelt doit partir d'un stock nul")
    id_bc, lignes = bon_envoye(c, [(H, 100, 5.42)], frs="FRS-002")
    taux = float(infra.valeur(f"SELECT taux_change_engage FROM bon_commande WHERE id_bc = '{id_bc}'"))
    reception_validee(c, id_bc, lignes, [100], mag=M)
    attendu = r4(5.42 * taux)
    verifier(egal(cmup_magasin(infra, H, M), attendu), f"devise : CMUP {cmup_magasin(infra, H, M)} au lieu de 5,42 x {taux} = {attendu}")

    verifier(controle(infra, "C11") == 0, "C11 : le cache du stock diverge du grand livre")


def scenario_atomicite(c, infra):
    """TOUT OU RIEN (etape 1, 10/10/2026) : une expedition dont la 2e ligne manque de stock
    n'ecrit rien, pas meme la 1re ; une reception dont une ligne est invalide n'existe pas."""
    A, B, M, P = "PLA 35 CHE", "PLA 45 CHE", "Morocco", "Polyfashions"
    entree_stock(c, A, 100, prix=20.0, mag=M)
    avant = (kg(infra, A, M), kg(infra, B, M), kg(infra, A, P), kg(infra, B, P))
    mvts = int(infra.valeur("SELECT count(*) FROM mouvement"))
    t = c.ok("Magasinie", "POST", "/api/transferts", {
        "code_magasin_source": M, "code_magasin_dest": P,
        "lignes": [{"code_reference": A, "quantite_saisie": 10, "unite_saisie": "kg"},
                   {"code_reference": B, "quantite_saisie": 5000, "unite_saisie": "kg"}]})
    tid = t["id_transfert"]
    c.refus("Magasinie", "POST", f"/api/transferts/{tid}/expedier")
    apres = (kg(infra, A, M), kg(infra, B, M), kg(infra, A, P), kg(infra, B, P))
    verifier(apres == avant, f"une expedition refusee a deplace du stock : {avant} -> {apres}")
    verifier(int(infra.valeur("SELECT count(*) FROM mouvement")) == mvts, "une expedition refusee a ecrit un mouvement")
    verifier(infra.valeur(f"SELECT statut FROM transfert WHERE id_transfert = '{tid}'") == "BROUILLON",
             "le transfert refuse n'est plus en brouillon")
    receptions = int(infra.valeur("SELECT count(*) FROM reception"))
    id_bc, lignes = bon_envoye(c, [(A, 50, 20.0)])
    c.refus("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "num_bon_livraison": "BL-ATOME", "lignes": [
        {"code_reference": A, "id_ligne_bc": lignes[0]["id_ligne_bc"], "unite_saisie": "kg",
         "quantite_pesee_unite": 50, "code_magasin_dest": M},
        {"code_reference": A, "unite_saisie": "kg", "quantite_pesee_unite": 5,
         "code_magasin_dest": "MAGASIN-INEXISTANT"}]}, codes=(400, 404, 409, 422))
    verifier(int(infra.valeur("SELECT count(*) FROM reception")) == receptions,
             "une reception refusee a laisse un en-tete")


def scenario_concurrence_stock(c, infra):
    """DEUX SORTIES SIMULTANEES sur le meme stock (etape 1, 10/10/2026) : 2 x 70 kg sur
    100 kg. Une seule passe, l'autre est refusee ; le stock ne passe jamais sous zero."""
    from concurrent.futures import ThreadPoolExecutor
    A, M = "PLA 65 CHE", "Morocco"
    entree_stock(c, A, 100, prix=20.0, mag=M)
    depart = kg(infra, A, M)
    def sortie(_):
        return mouvement(c, "Choukri", "SORTIE_HORS_MACHINE", [(A, 70)], mag=M,
                         motif="HORS_MACHINE", motif_ligne="HM_ESSAI")
    with ThreadPoolExecutor(2) as ex:
        resultats = list(ex.map(sortie, range(2)))
    codes = sorted(r[0] for r in resultats)
    verifier(codes[0] == 200 and codes[1] in (409, 422, 423, 500) and codes[1] != 200,
             f"deux sorties de 70 kg sur {depart} kg : {resultats}")
    verifier(codes[1] != 500, f"le refus concurrent tombe en erreur interne : {resultats}")
    verifier(abs(kg(infra, A, M) - (depart - 70)) < 1e-6, f"stock final {kg(infra, A, M)} au lieu de {depart - 70}")
    verifier(controle(infra, "C11") == 0, "C11 apres la concurrence")


def scenario_matrice_mouvements(c, infra):
    """LA MATRICE DES MOUVEMENTS EST CONTROLEE (etape 1, 10/10/2026) : chaque type de la base
    figure dans matrice_mouvements.json avec le meme signe, le meme effet sur le CMUP et les
    memes exigences ; les scenarios qu'elle cite comme preuves existent."""
    import json
    from pathlib import Path
    matrice = json.loads((Path(__file__).resolve().parent / "matrice_mouvements.json").read_text(encoding="utf-8"))["types"]
    colonnes = ["signe", "impacte_cmup", "exige_prix", "exige_of", "exige_motif_ligne", "interne"]
    base = {l[0]: dict(zip(colonnes, map(int, l[1:])))
            for l in infra.sql(f"SELECT code_type_mvt, {', '.join(colonnes)} FROM type_mouvement WHERE actif = 1")}
    verifier(set(base) == set(matrice), f"types absents de la matrice : {sorted(set(base) - set(matrice))} ; "
                                        f"de la base : {sorted(set(matrice) - set(base))}")
    ecarts = [f"{code}.{k} : base {base[code][k]}, matrice {matrice[code][k]}"
              for code in base for k in colonnes if base[code][k] != matrice[code][k]]
    verifier(not ecarts, "la matrice ne dit pas ce que dit la base : " + " ; ".join(ecarts))
    connus = {f.__name__.removeprefix("scenario_") for f in SCENARIOS}
    absents = sorted({s for t in matrice.values() for s in t["banc"]} - connus)
    verifier(not absents, f"la matrice cite des scenarios qui n'existent pas : {absents}")


def scenario_contrat_droits(c, infra):
    """LE CONTRAT DES DROITS, par HTTP direct (etape 2, 10/10/2026) : pour chaque entite du
    CRUD generique et chaque role, la lecture suit le droit LIRE, l'ecriture est refusee
    (403, avant toute validation du contenu) sans le droit ECRIRE ; un montant masque ne sort
    pas ; un droit retire s'applique a la requete suivante, sans reconnexion."""
    import re
    from pathlib import Path
    texte = (Path(__file__).resolve().parents[2] / "src" / "crud.rs").read_text(encoding="utf-8")
    entites = re.findall(r'chemin: "([^"]+)",\s*table: "[^"]+",\s*module: "([^"]+)"', texte)
    verifier(len(entites) >= 15, f"registre du CRUD illisible : {len(entites)} entite(s)")
    perms = {tuple(l) for l in infra.sql("SELECT code_role_user, module, action FROM permission WHERE actif = 1")}
    comptes = dict(infra.sql("SELECT login, code_role_user FROM utilisateur "
                             "WHERE login IN ('admin', 'Assistante', 'Choukri', 'Magasinie')"))
    ecarts = []
    for chemin, module in entites:
        for login, role in comptes.items():
            lire = (role, module, "LIRE") in perms
            code, _ = c.appel(login, "GET", f"/api/{chemin}")
            if (lire and code != 200) or (not lire and code != 403):
                ecarts.append(f"{login} ({role}) GET /api/{chemin} : {code}, droit LIRE {module} {'oui' if lire else 'non'}")
            if (role, module, "ECRIRE") not in perms:
                code, _ = c.appel(login, "POST", f"/api/{chemin}", {})
                if code != 403:
                    ecarts.append(f"{login} ({role}) POST /api/{chemin} sans ECRIRE {module} : {code} au lieu de 403")
    verifier(not ecarts, f"{len(ecarts)} ecart(s) au contrat des droits : " + " ; ".join(ecarts[:12]))

    # Un montant masque ne sort pas, quelle que soit la voie (ici, la liste du catalogue).
    masques = [l[0] for l in infra.sql(
        "SELECT d.champ FROM droit_champ d JOIN utilisateur u USING (id_utilisateur) "
        "WHERE u.login = 'Magasinie' AND d.module = 'CATALOGUE' AND d.niveau = 'MASQUE'")]
    verifier("cmup_mad" in masques and "valeur_transit_mad" in masques,
             f"le magasinier devrait avoir le CMUP et la valeur en route masques : {masques}")
    if ("MAGASIN", "CATALOGUE", "LIRE") in perms:
        lignes = c.ok("Magasinie", "GET", "/api/catalogue?actif=1&limite=50")
        fuites = sorted({k for l in lignes for k in masques if l.get(k) is not None})
        verifier(not fuites, f"champs masques livres au magasinier : {fuites}")

    # Un droit retire s'applique tout de suite, avec le meme jeton.
    role_mag = comptes["Magasinie"]
    verifier((role_mag, "STOCK", "LIRE") in perms, "le magasin devrait lire le stock")
    c.ok("Magasinie", "GET", "/api/magasins")
    infra.sql(f"UPDATE permission SET actif = 0 WHERE code_role_user = '{role_mag}' AND module = 'STOCK' AND action = 'LIRE'")
    try:
        code, _ = c.appel("Magasinie", "GET", "/api/magasins")
        verifier(code == 403, f"un droit retire reste effectif : {code}")
    finally:
        infra.sql(f"UPDATE permission SET actif = 1 WHERE code_role_user = '{role_mag}' AND module = 'STOCK' AND action = 'LIRE'")
    c.ok("Magasinie", "GET", "/api/magasins")


def scenario_codes_erreur(c, infra):
    """DES CODES STABLES (etape 2, 10/10/2026) : une regle metier repond 422 REGLE_METIER avec
    son code (« regle »), un droit manquant 403 NON_AUTORISE ; l'ecran lit le code, pas le texte."""
    A, M = "PLA 140 CHE", "Morocco"
    code, r = mouvement(c, "Choukri", "SORTIE_HORS_MACHINE", [(A, 999999)], mag=M,
                        motif="HORS_MACHINE", motif_ligne="HM_ESSAI")
    verifier(code == 422 and r.get("code") == "REGLE_METIER", f"sortie impossible : {code} {r}")
    verifier(r.get("regle", "").startswith("R02"), f"le code de la regle manque : {r}")
    code, r = c.appel("Magasinie", "POST", "/api/fournisseurs", {"code_fournisseur": "X", "nom": "X"})
    verifier(code == 403 and r.get("code") == "NON_AUTORISE", f"ecriture sans droit : {code} {r}")


def scenario_reception_date_du_fait(c, infra):
    """LA DATE DU FAIT D'UNE RECEPTION (10/10/2026) : un BL du 15/03/2025 entre en stock a cette
    date ; une date future est refusee, comme une date anterieure au bon."""
    A, M = "PLA 100 EXT", "Morocco"
    A_USD = "PP-1500 Dtex-Bleu 6666-Hs"
    bc = c.ok("Assistante", "POST", "/api/bons-commande", {"code_fournisseur": "FRS-012", "date_bc": "2025-03-01",
        "lignes": [{"code_reference": A, "unite_commande": "kg", "quantite_commandee_unite": 200, "prix_unitaire_devise": 21}]})
    id_bc = bc["id_bc"]
    c.ok("Assistante", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "EN_ATTENTE_VALIDATION"})
    c.ok("Choukri", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "VALIDE"})
    c.ok("Choukri", "PUT", f"/api/bons-commande/{id_bc}/statut", {"statut": "ENVOYE"})
    lb = c.ok("Choukri", "GET", f"/api/bons-commande/{id_bc}/lignes")
    lb = lb.get("lignes", lb) if isinstance(lb, dict) else lb
    ligne = [{"code_reference": A, "id_ligne_bc": lb[0]["id_ligne_bc"], "unite_saisie": "kg",
              "quantite_pesee_unite": 200, "code_magasin_dest": M}]
    demain = infra.valeur("SELECT to_char(current_date + 1, 'YYYY-MM-DD')")
    c.refus("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "date_reception": demain, "lignes": ligne},
            contient="futur")
    c.refus("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "date_reception": "2025-02-20", "lignes": ligne},
            contient="preceder")
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "date_reception": "2025-03-15",
                                                     "num_bon_livraison": "BL-DATE", "lignes": ligne})
    rid = r["id_reception"]
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    date_mvt = infra.valeur(
        "SELECT substr(m.date_mouvement, 1, 10) FROM ligne_reception lr JOIN mouvement m ON m.id_mouvement = lr.id_mouvement_genere "
        f"WHERE lr.id_reception = '{rid}'")
    verifier(date_mvt == "2025-03-15", f"l'entree en stock est datee {date_mvt} au lieu du 2025-03-15")

    # EN DEVISE : le taux est celui du jour de la livraison (RG-09), pas celui de la saisie.
    # Deux cours de mars 2025 s'inserent dans l'historique, entre des cours deja connus.
    c.ok("Mohamed", "POST", "/api/devises/USD/taux", {"taux": 9.7, "date_debut": "2025-03-01"})
    c.ok("Mohamed", "POST", "/api/devises/USD/taux", {"taux": 9.5, "date_debut": "2025-03-12"})
    jour = taux_usd_du_jour(infra)
    du_jour = float(infra.valeur(f"SELECT taux FROM taux_change WHERE code_devise = 'USD' AND substr(date_debut, 1, 10) = '{jour}'"))
    id_bc, lignes = bon_envoye(c, [(A_USD, 300, 2.0)], frs="FRS-001", date_bc="2025-03-01")
    ligne = [{"code_reference": A_USD, "id_ligne_bc": lignes[0]["id_ligne_bc"], "unite_saisie": "kg",
              "quantite_pesee_unite": 300, "code_magasin_dest": M, "lot_fournisseur": "LOT-DATE-USD",
              "nb_bobines": 120}]
    r = c.ok("Magasinie", "POST", "/api/receptions", {"id_bc": id_bc, "date_reception": "2025-03-05",
                                                     "num_bon_livraison": "BL-DATE-USD", "lignes": ligne})
    rid = r["id_reception"]
    taux = lambda: float(infra.valeur(f"SELECT taux_change FROM ligne_reception WHERE id_reception = '{rid}'"))
    prix = lambda: float(infra.valeur(f"SELECT prix_kg_mad FROM ligne_reception WHERE id_reception = '{rid}'"))
    verifier(abs(taux() - 9.7) < 1e-9, f"livraison du 05/03/2025 au taux {taux()} au lieu du cours du 01/03 (9,70)")
    verifier(abs(prix() - 19.4) < 1e-9, f"prix {prix()} MAD/kg au lieu de 19,40")
    # La date corrigee au 20/03 : le cours du 12/03 s'applique.
    c.ok("Magasinie", "PATCH", f"/api/receptions/{rid}", {"date_reception": "2025-03-20"})
    verifier(abs(taux() - 9.5) < 1e-9 and abs(prix() - 19.0) < 1e-9,
             f"date corrigee au 20/03 : taux {taux()}, prix {prix()} au lieu de 9,50 et 19,00")
    # Validee, la livraison entre en stock au 20/03/2025, et son lot avec elle : le lot
    # le plus ancien (propose d'office aux sorties) se juge sur la date du fait.
    c.ok("Magasinie", "PUT", f"/api/receptions/{rid}/statut", {"statut": "A_CONTROLER"})
    c.ok("Choukri", "POST", f"/api/receptions/{rid}/valider")
    lot = infra.valeur("SELECT substr(date_premiere_entree, 1, 10) FROM stock_lot WHERE lot_fournisseur = 'LOT-DATE-USD'")
    verifier(lot == "2025-03-20", f"le lot recu le 20/03/2025 a pour premiere entree {lot}")
    # Le cours du jour, lui, n'a pas bouge.
    encore = float(infra.valeur(f"SELECT taux FROM taux_change WHERE code_devise = 'USD' AND substr(date_debut, 1, 10) = '{jour}'"))
    verifier(encore == du_jour, f"le cours du jour est passe de {du_jour} a {encore}")


def scenario_sauvegarde_restaurable(c, infra):
    """Une sauvegarde se prouve en la restaurant (10/10/2026) : gestionfil-admin la
    restaure dans une base temporaire, la controle, l'efface ; la base du banc
    n'est pas touchee. Une sauvegarde tronquee doit etre refusee."""
    import os, subprocess, tempfile
    from pathlib import Path
    dossier = tempfile.mkdtemp(prefix="banc_sauvegardes_")
    pg = str(Path(PSQL).parent)
    env = dict(infra.env, DATABASE_URL=infra.url(), GESTIONFIL_SAUVEGARDES=dossier,
               PATH=pg + os.pathsep + infra.env.get("PATH", ""))
    def admin(*args):
        return subprocess.run([str(infra.admin), *args], cwd=dossier, capture_output=True, text=True, env=env)
    r = admin("sauvegarder")
    verifier(r.returncode == 0, f"sauvegarde : {r.stderr[-400:]}")
    r = admin("verifier-sauvegarde")
    verifier(r.returncode == 0 and "SAUVEGARDE RESTAURABLE" in r.stdout,
             f"verification : {r.stdout[-600:]} {r.stderr[-400:]}")
    dump = next(Path(dossier).glob("*.dump"))
    (Path(dossier) / "tronquee.dump").write_bytes(dump.read_bytes()[: dump.stat().st_size // 2])
    r = admin("verifier-sauvegarde", "tronquee.dump")
    verifier(r.returncode != 0, "une sauvegarde tronquee a ete jugee restaurable")
    reste = infra.valeur(f"SELECT count(*) FROM pg_database WHERE datname LIKE '{infra.base}_verif_%'")
    verifier(reste == "0", "une base temporaire de verification n'a pas ete effacee")


def scenario_roles_permissions(c, infra):
    """Roles et permissions (13/10) : page de l'Administrateur seul ; le modele d'un role suit chez ses
    utilisateurs, sauf les champs regles a la main ; un role porte ne se supprime pas ; l'Administrateur
    garde la gestion des utilisateurs, et ses gestes entrent a l'audit."""
    c.refus("Mohamed", "GET", "/api/admin/roles/MAGASIN", codes=(403,))
    fiche = c.ok("admin", "GET", "/api/admin/roles/MAGASIN")
    role = fiche["role"]
    entete = {"libelle": role["libelle"], "description": role["description"],
              "plafond_validation_bc_mad": role["plafond_validation_bc_mad"]}
    perms = [{"module": p["module"], "action": p["action"]} for p in fiche["permissions"]]
    champs = [x for x in fiche["champs"] if x["au_modele"]]
    verifier(len(champs) >= 2, "le modele du magasinier n'a pas deux champs")
    suivi, manuel = champs[0], champs[1]
    autre = lambda n: "LECTURE" if n != "LECTURE" else "MASQUE"
    mag = next(u for u in c.ok("admin", "GET", "/api/admin/utilisateurs") if u["login"] == "Magasinie")
    uid = mag["id_utilisateur"]
    niveau = lambda champ: next(d for d in c.ok("admin", "GET", f"/api/admin/utilisateurs/{uid}/droits")
                                if d["module"] == champ["module"] and d["champ"] == champ["champ"])
    # Un champ regle a la main pour le magasinier : il ne suit plus le modele.
    c.ok("admin", "PUT", f"/api/admin/utilisateurs/{uid}/droits", {"droits": [
        {"module": manuel["module"], "champ": manuel["champ"], "niveau": autre(manuel["niveau"])}]})
    verifier(niveau(manuel)["origine"] == "MANUEL", "un droit regle a la main n'est pas marque MANUEL")
    nouveau = lambda x: {"module": x["module"], "champ": x["champ"], "niveau": "ECRITURE" if x["niveau"] != "ECRITURE" else "MASQUE"}
    r = c.ok("admin", "PUT", "/api/admin/roles/MAGASIN", {**entete, "permissions": perms,
             "champs": [nouveau(suivi), nouveau(manuel)]})
    verifier(r["droits_repercutes"] >= 1, f"le modele n'a rien repercute : {r}")
    verifier(niveau(suivi)["niveau"] == nouveau(suivi)["niveau"], "le magasinier ne suit pas le modele de son role")
    verifier(niveau(manuel)["niveau"] == autre(manuel["niveau"]), "le modele a ecrase un reglage fait a la main")
    # Retour au modele d'origine (le masquage des prix en depend).
    c.ok("admin", "PUT", "/api/admin/roles/MAGASIN", {**entete, "permissions": perms, "champs": [
        {"module": x["module"], "champ": x["champ"], "niveau": x["niveau"]} for x in (suivi, manuel)]})
    c.ok("admin", "POST", f"/api/admin/utilisateurs/{uid}/droits/appliquer-modele", {"module": manuel["module"]})
    verifier(niveau(manuel)["niveau"] == manuel["niveau"] and niveau(manuel)["origine"] == "MODELE",
             "appliquer le modele ne remet pas le champ au modele")
    # Un role neuf, recopie du magasinier, puis supprime ; un role porte ne se supprime pas.
    c.refus("admin", "POST", "/api/admin/roles", {"code_role_user": "essai banc", "libelle": "Essai"}, codes=(400,))
    c.ok("admin", "POST", "/api/admin/roles", {"code_role_user": "ESSAI_BANC", "libelle": "Essai du banc",
                                               "a_partir_de": "MAGASIN"})
    copie = c.ok("admin", "GET", "/api/admin/roles/ESSAI_BANC")
    verifier(sorted(map(str, copie["permissions"])) == sorted(map(str, fiche["permissions"])),
             "le role recopie n'a pas les permissions du magasinier")
    c.refus("admin", "POST", "/api/admin/roles", {"code_role_user": "ESSAI_BANC", "libelle": "Doublon"}, codes=(422,))
    c.refus("admin", "DELETE", "/api/admin/roles/MAGASIN", codes=(422,), contient="ROLE-UTILISE")
    c.ok("admin", "DELETE", "/api/admin/roles/ESSAI_BANC")
    n = int(infra.valeur("SELECT count(*) FROM audit_log WHERE table_concernee = 'role_utilisateur' "
                         "AND id_enregistrement LIKE '%ESSAI_BANC%' AND id_utilisateur IS NOT NULL"))
    verifier(n >= 2, f"creation et suppression du role sans trace d'audit signee ({n})")
    # L'Administrateur ne s'enferme pas dehors.
    admin = c.ok("admin", "GET", "/api/admin/roles/ADMIN")
    sans = [{"module": p["module"], "action": p["action"]} for p in admin["permissions"] if p["module"] != "UTILISATEURS"]
    c.ok("admin", "PUT", "/api/admin/roles/ADMIN", {"libelle": admin["role"]["libelle"], "permissions": sans,
         "plafond_validation_bc_mad": admin["role"]["plafond_validation_bc_mad"]})
    verifier(len([p for p in c.ok("admin", "GET", "/api/admin/roles/ADMIN")["permissions"]
                  if p["module"] == "UTILISATEURS"]) == 3, "l'Administrateur a perdu la gestion des utilisateurs")
    refus_sql(infra, "DELETE FROM permission WHERE code_role_user = 'ADMIN' AND module = 'UTILISATEURS'", "ROLE-ADMIN")
    refus_sql(infra, "DELETE FROM role_utilisateur WHERE code_role_user = 'ADMIN'", "ROLE-ADMIN")
    c.refus("admin", "DELETE", "/api/admin/roles/ADMIN", codes=(422,), contient="ROLE-ADMIN")


def totp(secret, decalage=0):
    """Le code a six chiffres d'un secret base32, comme un telephone (RFC 6238, SHA-1, 30 s)."""
    import base64, hashlib, hmac, struct
    cle = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    pas = int(time.time() // 30) + decalage
    h = hmac.new(cle, struct.pack(">Q", pas), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def scenario_securite(c, infra):
    """Audit de securite du 13/10 : double authentification obligatoire (Direction), verrou et
    deconnexion tenus par le serveur, rafale de connexions bloquee, identifiant inconnu bloque comme un
    vrai, role Administrateur garde, prix suggeres masques au magasinier, types de mouvement sous
    Parametres, reglage de l'assistant reserve a l'administrateur, politique de contenu posee."""
    import concurrent.futures
    # 1. Double authentification obligatoire pour la Direction.
    infra.sql("UPDATE role_utilisateur SET exige_totp = 1 WHERE code_role_user = 'DIRECTION'")
    try:
        c.refus("Tarik", "GET", "/api/stock", codes=(403,), contient="DOUBLE_AUTH_REQUISE")
        verifier(c.ok("Tarik", "GET", "/api/auth/moi")["totp_requis"] is True, "moi ne dit pas que la 2FA est requise")
        secret = c.ok("Tarik", "POST", "/api/auth/2fa/preparer", {"mot_de_passe": MOT_DE_PASSE})["secret"]
        c.ok("Tarik", "POST", "/api/auth/2fa/activer", {"code": totp(secret)})
        c.ok("Tarik", "GET", "/api/stock")
        c.refus("Tarik", "POST", "/api/auth/2fa/desactiver", {"mot_de_passe": MOT_DE_PASSE}, codes=(422,),
                contient="obligatoire")
        code, r = c.appel("Tarik#2", "POST", "/api/auth/connexion", {"login": "Tarik", "mot_de_passe": MOT_DE_PASSE})
        verifier(code == 200 and r.get("exige_code") is True, f"la connexion ne demande pas le code : {r}")
        code, r = c.appel("Tarik#2", "POST", "/api/auth/connexion",
                          {"login": "Tarik", "mot_de_passe": MOT_DE_PASSE, "code": totp(secret, 1)})
        verifier(code == 200 and r.get("jeton"), f"connexion avec code refusee : {code} {r}")
    finally:
        infra.sql("UPDATE role_utilisateur SET exige_totp = 0; "
                  "UPDATE utilisateur SET totp_actif = 0, secret_totp = NULL, totp_dernier_pas = NULL WHERE login = 'Tarik'")

    # 2. Le verrou d'inactivite tient au serveur : ni F5 ni un appel direct ne le levent.
    code, r = c.appel("Assistante#2", "POST", "/api/auth/connexion", {"login": "Assistante", "mot_de_passe": MOT_DE_PASSE})
    c.jetons["Assistante#2"] = r["jeton"]
    c.ok("Assistante#2", "POST", "/api/auth/verrouiller")
    c.refus("Assistante#2", "GET", "/api/stock", codes=(423,))
    verifier(c.ok("Assistante#2", "GET", "/api/auth/moi")["session_verrouillee"] is True, "moi ne dit pas le verrou")
    c.refus("Assistante#2", "POST", "/api/auth/deverrouiller", {"mot_de_passe": "faux-mot-de-passe"}, codes=(401,))
    c.ok("Assistante#2", "POST", "/api/auth/deverrouiller", {"mot_de_passe": MOT_DE_PASSE})
    c.ok("Assistante#2", "GET", "/api/stock")
    # 3. La deconnexion revoque le jeton.
    c.ok("Assistante#2", "POST", "/api/auth/deconnexion")
    c.refus("Assistante#2", "GET", "/api/auth/moi", codes=(401,))

    # 4. Une rafale sur un identifiant : les essais passent un par un, le blocage tient.
    def essai(_):
        return c.appel("rafale", "POST", "/api/auth/connexion", {"login": "Choukri", "mot_de_passe": "mauvais-mot-de-passe"})[0]
    try:
        with concurrent.futures.ThreadPoolExecutor(8) as p:
            codes = list(p.map(essai, range(8)))
        verifier(codes.count(429) >= 5, f"la rafale n'a pas ete bloquee : {codes}")
        code, _ = c.appel("rafale", "POST", "/api/auth/connexion", {"login": "Choukri", "mot_de_passe": MOT_DE_PASSE})
        verifier(code == 429, f"le bon mot de passe passe pendant le blocage : {code}")
    finally:
        infra.sql("UPDATE utilisateur SET echecs_consecutifs = 0, bloque_jusqu_a = NULL WHERE login = 'Choukri'")
    # Un identifiant inconnu se bloque comme un vrai : rien ne le distingue.
    codes = [c.appel("x", "POST", "/api/auth/connexion", {"login": "personne-du-banc", "mot_de_passe": "x" * 12})[0]
             for _ in range(4)]
    verifier(codes == [401, 401, 429, 429], f"un inconnu ne se bloque pas comme un vrai compte : {codes}")

    # 5. Le role Administrateur ne se prend pas, meme avec le droit d'ecrire les utilisateurs.
    infra.sql("INSERT INTO permission (code_role_user, module, action) VALUES ('DIRECTION', 'UTILISATEURS', 'LIRE'), "
              "('DIRECTION', 'UTILISATEURS', 'ECRIRE') ON CONFLICT DO NOTHING")
    try:
        comptes = {u["login"]: u for u in c.ok("Mohamed", "GET", "/api/admin/utilisateurs")}
        moi = comptes["Mohamed"]["id_utilisateur"]
        c.refus("Mohamed", "PATCH", f"/api/admin/utilisateurs/{moi}", {"code_role_user": "ADMIN"}, codes=(422,))
        c.refus("Mohamed", "PATCH", f"/api/admin/utilisateurs/{comptes['admin']['id_utilisateur']}",
                {"nom": "Pris"}, codes=(422,), contient="administrateur")
        c.refus("Mohamed", "PATCH", f"/api/admin/utilisateurs/{comptes['Magasinie']['id_utilisateur']}",
                {"mot_de_passe": "Un-autre-mot-de-passe"}, codes=(422,), contient="mot de passe")
        c.refus("Mohamed", "PUT", f"/api/admin/utilisateurs/{moi}/droits",
                {"droits": [{"module": "STOCK", "champ": "cmup_mad", "niveau": "ECRITURE"}]}, codes=(422,))
        c.refus("Mohamed", "POST", "/api/admin/utilisateurs", {"login": "intrus", "nom": "Intrus",
                "code_role_user": "ADMIN", "mot_de_passe": "Un-mot-de-passe-12"}, codes=(422,))
        # La base garde la meme regle, sous le contexte d'un compte de la Direction.
        refus_sql(infra, "BEGIN; SELECT set_config('gestionfil.id_utilisateur', "
                         f"'{moi}', true); UPDATE utilisateur SET code_role_user = 'ADMIN' WHERE login = 'Magasinie'; COMMIT;",
                  "UTIL-ADMIN")
    finally:
        infra.sql("DELETE FROM permission WHERE code_role_user = 'DIRECTION' AND module = 'UTILISATEURS'")

    # 6. Le magasinier ne recoit aucun prix suggere (le CMUP compris).
    refs = c.ok("Magasinie", "GET", f"/api/references-commandables?code_fournisseur={FRS}&toutes=1")
    verifier(refs and not any(l.get("prix_mad_suggere") or l.get("prix_suggere_devise") for l in refs),
             "le magasinier recoit des prix suggeres")
    # Le prix d'un retour que le magasinier envoie est ignore : le CMUP du magasin.
    entree_stock(c, REF, 50)
    dispo = next(x for x in c.ok("Magasinie", "GET", "/api/retours-fournisseur/disponible") if x["quantite_kg"] >= 1)
    r = c.ok("Magasinie", "POST", "/api/retours-fournisseur", {"code_fournisseur": "FRS-001", "motif": "Essai du prix",
             "lignes": [{"code_reference": dispo["code_reference"], "code_magasin": dispo["code_magasin"],
                         "lot_fournisseur": dispo["lot_fournisseur"], "quantite_kg": 1, "prix_kg_mad": 999.0,
                         "code_motif_ligne": "R1"}]})
    prix = float(infra.valeur(f"SELECT prix_kg_mad FROM ligne_retour_fournisseur WHERE id_retour = '{r['id_retour']}'"))
    verifier(abs(prix - 999.0) > 0.01, "le magasinier a impose le prix du retour")
    c.ok("Magasinie", "DELETE", f"/api/retours-fournisseur/{r['id_retour']}")
    # 7. Les types de mouvement se reglent sous Parametres : plus par le magasinier.
    c.ok("Magasinie", "GET", "/api/types-mouvement")
    c.refus("Magasinie", "POST", "/api/types-mouvement", {"code_type_mvt": "PIRATE", "libelle": "Pirate", "signe": 1},
            codes=(403,))
    # 8. L'assistant se regle par l'administrateur.
    c.refus("Mohamed", "PATCH", "/api/parametres/P_AssistantMoteur", {"valeur_courante": "claude"}, codes=(422,))
    # 9. La politique de contenu est posee par le serveur.
    with urllib.request.urlopen(c.base_url + "/") as rep:
        csp = rep.headers.get("Content-Security-Policy") or ""
    verifier("script-src 'self'" in csp and "object-src 'none'" in csp, f"politique de contenu absente : {csp!r}")


SCENARIOS = [
    scenario_bon_segregation,
    scenario_reception_cloture_avoir,
    scenario_ecart_pesee,
    scenario_reception_devalidee_revalidee,
    scenario_arrivage_unifie,
    scenario_frais_approche_locaux,
    scenario_facture_document,
    scenario_saisie_libre,
    scenario_stock_jamais_negatif,
    scenario_contre_passation,
    scenario_inventaire,
    scenario_colisage_signale,
    scenario_colisage_ecran_et_base,
    scenario_import,
    scenario_import_coherence,
    scenario_import_sur_arrivage,
    scenario_lots_autorisations,
    scenario_machine,
    scenario_machine_surplus,
    scenario_declencheurs,
    scenario_audit_montants,
    scenario_masquage,
    scenario_sessions,
    scenario_concurrence_numerotation,
    scenario_gardes_p1,
    scenario_sortie_hors_machine,
    scenario_controle_reception,
    scenario_retour_cloture_avoirs,
    scenario_taux_bon,
    scenario_plan_detail,
    scenario_derogation_bornee,
    scenario_machine_constat,
    scenario_lots_vivants,
    scenario_import_bon_envoye,
    scenario_parametres_types,
    scenario_migrations_rejouables,
    scenario_matrice_mouvements,
    scenario_cmup_chiffre,
    scenario_atomicite,
    scenario_concurrence_stock,
    scenario_contrat_droits,
    scenario_roles_permissions,
    scenario_securite,
    scenario_reception_date_du_fait,
    scenario_codes_erreur,
    scenario_sauvegarde_restaurable,
    scenario_controles_finaux,
]
