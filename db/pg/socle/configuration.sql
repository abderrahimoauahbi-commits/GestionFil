-- SOCLE genere par db/pg/socle.py depuis une copie entierement migree.
-- Ne pas editer a la main : regenerer (python socle.py --depuis <copie>).
-- Migrations comprises : 102 (voir inclus.txt).

--
-- PostgreSQL database dump
--

\restrict HtkXv1fgBbFuG9eshThHAd2GCcsdKT31lW2tjbAlgDqYfU71WV7rTbxvfpa9UFQ

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: role_bom; Type: TABLE DATA; Schema: public; Owner: -
--

SET SESSION AUTHORIZATION DEFAULT;

ALTER TABLE public.role_bom DISABLE TRIGGER ALL;

COPY public.role_bom (code_role, libelle, description, ordre_affichage, actif) FROM stdin;
POIL	Poil	Fil de surface, determine l'aspect et le toucher	10	1
TRAME	Trame	Fil transversal du tissage	20	1
CHAINE	Chaîne	Fil longitudinal du tissage	30	1
COLLE	Colle	Liant d'envers (latex, SBR, hotmelt)	40	1
CUIR	Cuir	Simili cuir de finition (exprime en ml/m2)	50	1
FRANGE	Franges	Franges decoratives	60	1
PLAST	Plastique	Composants plastiques	70	1
RUBAN	Ruban	Bande de bordure (exprimee en ml/m2)	80	1
\.


ALTER TABLE public.role_bom ENABLE TRIGGER ALL;

--
-- Data for Name: categorie_matiere; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.categorie_matiere DISABLE TRIGGER ALL;

COPY public.categorie_matiere (code_categorie, libelle, description, code_role_defaut, ordre_affichage, actif) FROM stdin;
ACR	Acrylique	\N	POIL	10	1
COT	Coton	\N	POIL	20	1
JUT	Jute	\N	TRAME	30	1
LAI	Laine	\N	RUBAN	40	1
LAT	Latex	\N	COLLE	50	1
PLA	Plastique	\N	PLAST	60	1
PES	Polyester	\N	POIL	70	1
PES-CH	Polyester Chaîne	\N	CHAINE	80	1
PES-PO	Polyester Fil Poil	\N	POIL	90	1
PES-SH	Polyester Fil Shrink	\N	POIL	100	1
PP	Polypropylene	\N	POIL	110	1
SBR	SBR	\N	COLLE	120	1
CUI	Simili Cuir	\N	CUIR	130	1
SOI	Soie	\N	POIL	140	1
VIS	Viscose	\N	POIL	150	1
\.


ALTER TABLE public.categorie_matiere ENABLE TRIGGER ALL;

--
-- Data for Name: champ_configurable; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.champ_configurable DISABLE TRIGGER ALL;

COPY public.champ_configurable (module, champ, libelle, niveau_defaut, sensible, ordre) FROM stdin;
FOURNISSEURS	nom	Nom	LECTURE	0	20
FOURNISSEURS	contact_principal	Contact	LECTURE	0	30
FOURNISSEURS	telephone	Telephone	LECTURE	0	40
FOURNISSEURS	email	Email	LECTURE	0	50
FOURNISSEURS	pays	Pays	LECTURE	0	60
FOURNISSEURS	ville	Ville	LECTURE	0	65
FOURNISSEURS	delai_livraison_jours	Délai de livraison (j)	LECTURE	0	70
FOURNISSEURS	conditions_paiement	Conditions de paiement	LECTURE	1	80
FOURNISSEURS	delai_paiement_jours	Délai de paiement (j)	LECTURE	1	90
FOURNISSEURS	code_devise	Devise	LECTURE	0	100
FOURNISSEURS	note_globale	Note globale	LECTURE	0	110
FOURNISSEURS	tolerance_pesee_pct	Tolerance de pesée (%)	LECTURE	0	120
FOURNISSEURS	actif	Actif	LECTURE	0	130
STOCK	code_reference	Référence	LECTURE	0	10
STOCK	designation	Designation	LECTURE	0	20
STOCK	code_magasin	Magasin	LECTURE	0	30
STOCK	quantite_kg	Quantité (kg)	LECTURE	0	40
STOCK	cmup_mad	CMUP (MAD/kg)	LECTURE	1	50
STOCK	valeur_mad	Valeur (MAD)	LECTURE	1	60
STOCK	date_derniere_entree	Dernière entree	LECTURE	0	70
STOCK	date_derniere_sortie	Dernière sortie	LECTURE	0	80
STOCK	date_dernier_inventaire	Dernier inventaire	LECTURE	0	90
STOCK	stock_projete_kg	Stock projeté (kg)	LECTURE	0	100
STOCK	jours_couverture	Jours de couverture	LECTURE	0	110
STOCK	statut	Statut	LECTURE	0	120
STOCK	lot_fournisseur	Lot fournisseur	LECTURE	0	130
STOCK	date_peremption	Date de peremption	LECTURE	0	140
MOUVEMENTS	numero_mouvement	Numéro	LECTURE	0	10
MOUVEMENTS	date_mouvement	Date	LECTURE	0	20
MOUVEMENTS	code_type_mvt	Type de mouvement	LECTURE	0	30
MOUVEMENTS	code_magasin	Magasin	LECTURE	0	40
MOUVEMENTS	code_motif	Motif	LECTURE	0	50
MOUVEMENTS	code_reference	Référence	LECTURE	0	60
MOUVEMENTS	quantite_kg	Quantité (kg)	LECTURE	0	70
MOUVEMENTS	prix_kg_mad	Prix (MAD/kg)	LECTURE	1	80
MOUVEMENTS	total_mad	Total (MAD)	LECTURE	1	90
MOUVEMENTS	lot_fournisseur	Lot fournisseur	LECTURE	0	100
MOUVEMENTS	numero_of	Numéro d'OF	LECTURE	0	110
MOUVEMENTS	utilisateur	Utilisateur	LECTURE	0	120
RECEPTIONS	numero_reception	Numéro de réception	LECTURE	0	10
RECEPTIONS	date_reception	Date	LECTURE	0	20
RECEPTIONS	code_fournisseur	Fournisseur	LECTURE	0	30
RECEPTIONS	num_bon_livraison	Numéro de BL	LECTURE	0	40
RECEPTIONS	code_reference	Référence	LECTURE	0	50
RECEPTIONS	unite_saisie	Unité de saisie	LECTURE	0	60
RECEPTIONS	quantite_pesee_unite	Quantité pesée	LECTURE	0	70
RECEPTIONS	quantite_stock_kg	Quantité en kg	LECTURE	0	80
RECEPTIONS	quantite_commandee_kg	Quantité commandée	LECTURE	0	90
RECEPTIONS	ecart_pct	Écart (%)	LECTURE	0	100
RECEPTIONS	prix_kg_devise	Prix (devise/kg)	LECTURE	1	110
RECEPTIONS	code_devise	Devise	LECTURE	1	120
RECEPTIONS	taux_change	Taux de change	LECTURE	1	130
RECEPTIONS	prix_kg_mad	Prix (MAD/kg)	LECTURE	1	140
RECEPTIONS	total_mad	Total (MAD)	LECTURE	1	150
RECEPTIONS	total_devise	Total (devise)	LECTURE	1	155
RECEPTIONS	lot_fournisseur	Lot fournisseur	LECTURE	0	160
RECEPTIONS	date_peremption	Date de peremption	LECTURE	0	170
RECEPTIONS	statut_qualite	Statut qualité	LECTURE	0	180
RECEPTIONS	code_magasin_dest	Magasin destinataire	LECTURE	0	190
RECEPTIONS	fournisseur_nom	Nom du fournisseur	LECTURE	0	31
RECEPTIONS	numero_bc	Bon de commande	LECTURE	0	35
RECEPTIONS	numero_facture	Numéro de facture	LECTURE	1	41
RECEPTIONS	transporteur	Transporteur	LECTURE	0	42
RECEPTIONS	nombre_colis	Nombre de colis	LECTURE	0	43
RECEPTIONS	poids_total_brut_kg	Poids brut (kg)	LECTURE	0	44
RECEPTIONS	statut	Statut	LECTURE	0	45
RECEPTIONS	nb_lignes	Nombre de lignes	LECTURE	0	46
RECEPTIONS	receptionnaire	Pesée par	LECTURE	0	200
RECEPTIONS	controleur	Contrôle par	LECTURE	0	210
RECEPTIONS	date_controle	Date de contrôle	LECTURE	0	220
RECEPTIONS	quantite_bl_kg	Quantité BL (kg)	LECTURE	0	75
RECEPTIONS	ecart_bl_kg	Écart BL / pesée	LECTURE	0	76
RECEPTIONS	ecart_cmd_kg	Écart commande	LECTURE	0	95
RECEPTIONS	nb_colis_ligne	Colis de la ligne	LECTURE	0	192
RECEPTIONS	poids_moyen_colis_kg	Poids moyen / colis	LECTURE	0	193
RECEPTIONS	date_fabrication	Date de fabrication	LECTURE	0	165
RECEPTIONS	notes	Observations	LECTURE	0	230
RECEPTIONS	delai_reel_jours	Délai reel (j)	LECTURE	0	240
RECEPTIONS	delai_prevu_jours	Délai prévu (j)	LECTURE	0	250
RECEPTIONS	retard_jours	Retard (j)	LECTURE	0	260
RECEPTIONS	on_time	A l'heure	LECTURE	0	270
RECEPTIONS	in_full	Complet	LECTURE	0	280
RECEPTIONS	in_spec	Conforme	LECTURE	0	290
RECEPTIONS	substitution_acceptee	Substitution acceptée	LECTURE	0	700
RECEPTIONS	motif_substitution	Motif de la substitution	LECTURE	0	710
RECEPTIONS	reference_commandee	Référence commandée	LECTURE	0	720
RECEPTIONS	est_substitution	Est une substitution	LECTURE	0	730
RECEPTIONS	equivalents_recevables	Equivalents recevables	LECTURE	0	740
BONS_COMMANDE	numero_bc	Numéro de BC	LECTURE	0	10
BONS_COMMANDE	date_bc	Date	LECTURE	0	20
BONS_COMMANDE	code_fournisseur	Fournisseur	LECTURE	0	30
BONS_COMMANDE	statut	Statut	LECTURE	0	40
BONS_COMMANDE	code_devise	Devise	LECTURE	1	50
BONS_COMMANDE	taux_change_engage	Taux engage	LECTURE	1	60
BONS_COMMANDE	montant_total_devise	Montant (devise)	LECTURE	1	70
BONS_COMMANDE	montant_total_mad	Montant (MAD)	LECTURE	1	80
BONS_COMMANDE	code_reference	Référence	LECTURE	0	90
BONS_COMMANDE	unite_commande	Unité de commande	LECTURE	0	100
BONS_COMMANDE	quantite_commandee_unite	Quantité commandée	LECTURE	0	110
BONS_COMMANDE	quantite_commandee_kg	Quantité (kg)	LECTURE	0	120
BONS_COMMANDE	quantite_recue_kg	Quantité reçue (kg)	LECTURE	0	130
BONS_COMMANDE	prix_unitaire_devise	Prix unitaire	LECTURE	1	140
BONS_COMMANDE	total_ligne_devise	Total ligne	LECTURE	1	150
BONS_COMMANDE	date_livraison_prevue	Livraison prévue	LECTURE	0	160
BONS_COMMANDE	besoin_kg_origine	Besoin a la conversion	LECTURE	0	170
BONS_COMMANDE	besoin_kg_actuel	Besoin actuel (kg)	LECTURE	0	172
BONS_COMMANDE	ecart_besoin_kg	Écart de besoin	LECTURE	0	174
BONS_COMMANDE	arbitree	Ligne arbitrée	LECTURE	0	176
BONS_COMMANDE	fournisseur_nom	Nom du fournisseur	LECTURE	0	35
BONS_COMMANDE	devise_fournisseur	Devise du fournisseur	LECTURE	0	36
BONS_COMMANDE	nb_lignes	Nombre de lignes	LECTURE	0	62
BONS_COMMANDE	date_validation	Date de validation	LECTURE	0	66
BONS_COMMANDE	createur	Cree par	LECTURE	0	68
BONS_COMMANDE	valideur	Valide par	LECTURE	0	70
BONS_COMMANDE	motif_creation	Motif de création	LECTURE	0	72
BONS_COMMANDE	conditions_paiement	Conditions de paiement	LECTURE	0	74
BONS_COMMANDE	notes	Observations	LECTURE	0	76
BONS_COMMANDE	quantite_recue_kg_bc	Quantité reçue (kg)	LECTURE	0	180
BONS_COMMANDE	reste_a_livrer_kg	Reste a livrer (kg)	LECTURE	0	182
BONS_COMMANDE	pct_livre	Pourcentage livre	LECTURE	0	184
BONS_COMMANDE	statut_livraison	Statut de livraison	LECTURE	0	186
BONS_COMMANDE	equivalent_de	Equivalent de	LECTURE	0	950
BONS_COMMANDE	besoin_equivalent_kg	Besoin de l'equivalent (kg)	LECTURE	0	960
BONS_COMMANDE	nb_equivalents	Nombre d'equivalents	LECTURE	0	970
BONS_COMMANDE	statut_ligne	Statut de la ligne	LECTURE	0	188
PLAN_ACHAT	fournisseur_nom	Nom du fournisseur	LECTURE	0	35
PLAN_ACHAT	unite_saisie	Unité de commande	LECTURE	0	54
PLAN_ACHAT	risque_identifie	Risque identifie	LECTURE	0	100
PLAN_ACHAT	action_recommandee	Action recommandée	LECTURE	0	102
PLAN_ACHAT	commentaires	Commentaires	LECTURE	0	104
PLAN_ACHAT	date_generation	Date de generation	LECTURE	0	106
CATALOGUE	date_achat	Date d'achat	LECTURE	0	300
CATALOGUE	prix_kg_devise	Prix (devise/kg)	LECTURE	1	302
CATALOGUE	prix_precedent_mad	Prix précédent (MAD/kg)	LECTURE	1	304
CATALOGUE	quantite_achetee_kg	Quantité achetée (kg)	LECTURE	0	306
CATALOGUE	total_mad	Total (MAD)	LECTURE	1	308
CATALOGUE	numero_bc	Bon de commande	LECTURE	0	310
CATALOGUE	numero_reception	Réception	LECTURE	0	312
PLAN_ACHAT	id_proposition	Proposition	LECTURE	0	5
PLAN_ACHAT	code_reference	Référence	LECTURE	0	10
PLAN_ACHAT	quantite_suggeree_kg	Quantité suggérée (kg)	LECTURE	0	55
PLAN_ACHAT	quantite_suggeree_unite	Quantité suggérée	LECTURE	0	56
PLAN_ACHAT	urgence	Urgence	LECTURE	0	57
PLAN_ACHAT	date_besoin_prevue	Date de besoin	LECTURE	0	58
PLAN_ACHAT	montant_total_mad	Montant (MAD)	LECTURE	1	59
PLAN_ACHAT	numero_bc	Bon de commande	LECTURE	0	120
PLAN_ACHAT	statut_bc	Statut du bon	LECTURE	0	122
PLAN_ACHAT	designation	Designation	LECTURE	0	20
PLAN_ACHAT	code_fournisseur	Fournisseur	LECTURE	0	30
PLAN_ACHAT	statut	Statut du stock	LECTURE	0	40
PLAN_ACHAT	stock_projete_kg	Stock projeté (kg)	LECTURE	0	50
PLAN_ACHAT	stock_min_kg	Stock minimum (kg)	LECTURE	0	60
PLAN_ACHAT	qte_a_commander_kg	Quantité a commander	LECTURE	0	70
PLAN_ACHAT	prix_estime_mad	Prix estime (MAD/kg)	LECTURE	1	80
PLAN_ACHAT	source_prix	Source du prix	LECTURE	1	90
PLAN_ACHAT	montant_estime_mad	Montant estime (MAD)	LECTURE	1	100
PLAN_ACHAT	tier	Urgence	LECTURE	0	110
PLAN_ACHAT	risque_sourcing	Risque de sourcing	LECTURE	0	120
PLAN_ACHAT	jours_couverture	Jours de couverture	LECTURE	0	130
PLAN_ACHAT	code_reference_origine	Référence d'origine	LECTURE	0	140
PLAN_ACHAT	designation_origine	Designation d'origine	LECTURE	0	150
PLAN_ACHAT	motif_substitution	Motif de la bascule	LECTURE	0	160
PLAN_ACHAT	nb_equivalents	Nombre d'equivalents	LECTURE	0	170
PLAN_ACHAT	equivalent_dispo_kg	Stock d'un equivalent (kg)	LECTURE	0	180
QUALITES	code_qualite	Code	LECTURE	0	10
QUALITES	nom	Nom	LECTURE	0	20
QUALITES	description	Description	LECTURE	0	25
QUALITES	statut	Statut	LECTURE	0	28
QUALITES	poids_commercial_m2	Poids commercial (kg/m2)	LECTURE	0	30
QUALITES	code_role	Role BOM	LECTURE	0	40
QUALITES	role_libelle	Libelle du role	LECTURE	0	45
QUALITES	densite	Densité	LECTURE	0	50
QUALITES	unite_densite	Unité de densité	LECTURE	0	60
QUALITES	entre_poids_commercial	Entre dans le poids	LECTURE	0	65
QUALITES	code_reference	Référence	LECTURE	0	66
QUALITES	designation	Designation	LECTURE	0	67
QUALITES	pourcentage_composition	Composition (%)	LECTURE	0	68
QUALITES	couleur	Couleur	LECTURE	0	69
QUALITES	code_groupe_equiv	Groupe d'équivalence	LECTURE	0	69
QUALITES	code_fournisseur_prefere	Fournisseur prefere	LECTURE	0	69
QUALITES	ligne_numero	Ligne	LECTURE	0	69
QUALITES	kg_m2	Consommation (kg/m2)	LECTURE	0	69
QUALITES	type_fil	Type	LECTURE	0	69
QUALITES	categorie	Catégorie	LECTURE	0	69
QUALITES	fournisseur	Fournisseur	LECTURE	0	69
QUALITES	prix_kg_mad	Prix (MAD/kg)	LECTURE	1	69
QUALITES	code_devise_catalogue	Devise	LECTURE	1	69
QUALITES	cout_m2_mad	Coût (MAD/m2)	LECTURE	1	69
QUALITES	source_prix	Source du prix	LECTURE	1	69
QUALITES	marge_securite_pct	Marge de sécurité (%)	LECTURE	0	70
QUALITES	couv_min_mois	Couverture minimale	LECTURE	0	80
QUALITES	taux_perte_pct	Taux de perte (%)	LECTURE	0	90
QUALITES	seuil_alerte_jours	Seuil d'alerte (jours)	LECTURE	0	92
QUALITES	seuil_critique_jours	Seuil critique (jours)	LECTURE	0	94
QUALITES	stock_securite_jours	Stock de sécurité (jours)	LECTURE	0	96
QUALITES	actif	Actif	LECTURE	0	100
QUALITES	nb_roles	Nombre de lignes	LECTURE	0	110
QUALITES	nb_composition	Lignes de composition	LECTURE	0	118
QUALITES	nb_roles_composes	Roles composes	LECTURE	0	119
QUALITES	nb_roles_hors_100	Roles hors 100 %	LECTURE	0	120
QUALITES	nb_lignes_plan	Lignes de plan	LECTURE	0	130
QUALITES	date_creation	Créée le	LECTURE	0	140
QUALITES	cree_par	Créée par	LECTURE	0	150
QUALITES	date_modification	Modifiée le	LECTURE	0	160
QUALITES	modifie_par	Modifiée par	LECTURE	0	170
QUALITES	date_cloture	Cloturée le	LECTURE	0	180
RECETTES	code_qualite	Qualité	LECTURE	0	10
RECETTES	qualite_nom	Nom de la qualité	LECTURE	0	12
RECETTES	ligne_numero	Ligne	LECTURE	0	40
RECETTES	code_reference	Référence	LECTURE	0	50
RECETTES	designation	Designation	LECTURE	0	60
RECETTES	code_role	Role BOM	LECTURE	0	70
RECETTES	role_libelle	Libelle du role	LECTURE	0	75
RECETTES	pourcentage_composition	Composition (%)	LECTURE	0	80
RECETTES	couleur	Couleur	LECTURE	0	85
RECETTES	densite_role	Densité du role	LECTURE	0	90
RECETTES	unite_densite	Unité de densité	LECTURE	0	100
RECETTES	kg_m2	Consommation (kg/m2)	LECTURE	0	110
RECETTES	code_groupe_equiv	Groupe d'équivalence	LECTURE	0	120
RECETTES	statut_qualite	Statut de la qualité	LECTURE	0	130
RECETTES	code_fournisseur	Code fournisseur	LECTURE	0	138
RECETTES	fournisseur	Fournisseur	LECTURE	0	140
RECETTES	code_fournisseur_prefere	Fournisseur prefere	LECTURE	0	125
PLANS	annee	Année	LECTURE	0	10
PLANS	numero_version	Version	LECTURE	0	20
PLANS	libelle	Libelle	LECTURE	0	30
PLANS	scenario_nom	Scenario	LECTURE	0	40
PLANS	statut	Statut	LECTURE	0	50
PLANS	actif	Actif	LECTURE	0	52
PLANS	date_debut	Début de période	LECTURE	0	54
PLANS	date_fin	Fin de période	LECTURE	0	56
PLANS	mois_horizon	Horizon (mois)	LECTURE	0	58
PLANS	croissance_annuelle_pct	Croissance annuelle (%)	LECTURE	0	59
PLANS	mois	Mois	LECTURE	0	60
PLANS	rang_mois	Rang dans la période	LECTURE	0	62
PLANS	annee_mois	Mois date	LECTURE	0	64
PLANS	code_qualite	Qualité	LECTURE	0	70
PLANS	qualite_nom	Nom de la qualité	LECTURE	0	72
PLANS	m2_base_mensuel	Base mensuelle (m2)	LECTURE	0	76
PLANS	m2_prevus	m2 prévus	LECTURE	0	80
PLANS	saisonnalite	Saisonnalite	LECTURE	0	90
PLANS	coefficient	Coefficient du mois	LECTURE	0	92
PLANS	facteur_croissance	Facteur de croissance	LECTURE	0	94
PLANS	m2_realises	m2 realises	LECTURE	0	100
PLANS	taux_perte_pct	Taux de perte (%)	LECTURE	0	110
PLANS	m2_total_annuel	Total de la période (m2)	LECTURE	0	120
PLANS	m2_total	Total deploye (m2)	LECTURE	0	122
PLANS	nb_lignes	Cases du plan	LECTURE	0	124
PLANS	nb_qualites	Qualités retenues	LECTURE	0	126
PLANS	nb_qualites_perimees	Qualités perimees	LECTURE	0	128
PLANS	nb_besoins	Besoins calcules	LECTURE	0	130
PLANS	date_creation	Cree le	LECTURE	0	140
PLANS	cree_par	Cree par	LECTURE	0	142
PLANS	date_modification	Modifie le	LECTURE	0	144
PLANS	modifie_par	Modifie par	LECTURE	0	146
PLANS	date_validation	Valide le	LECTURE	0	148
PLANS	valide_par	Valide par	LECTURE	0	150
PLANS	date_cloture	Clôture le	LECTURE	0	152
PLANS	cloture_par	Clôture par	LECTURE	0	154
MRP	code_reference	Référence	LECTURE	0	10
MRP	designation	Designation	LECTURE	0	20
MRP	mois	Mois	LECTURE	0	30
MRP	quantite_brute_kg	Besoin brut (kg)	LECTURE	0	40
MRP	taux_perte_applique	Taux de perte (%)	LECTURE	0	50
MRP	quantite_kg	Besoin net (kg)	LECTURE	0	60
MRP	code_fournisseur	Fournisseur	LECTURE	0	70
INVENTAIRE	numero_inventaire	Numéro	LECTURE	0	10
INVENTAIRE	date_inventaire	Date	LECTURE	0	20
INVENTAIRE	type_inventaire	Type	LECTURE	0	30
INVENTAIRE	code_magasin	Magasin	LECTURE	0	40
INVENTAIRE	statut	Statut	LECTURE	0	50
INVENTAIRE	code_reference	Référence	LECTURE	0	60
INVENTAIRE	quantite_theorique_kg	Theorique (kg)	LECTURE	0	70
INVENTAIRE	quantite_comptee_kg	Compte (kg)	LECTURE	0	80
INVENTAIRE	ecart_kg	Écart (kg)	LECTURE	0	90
INVENTAIRE	ecart_pct	Écart (%)	LECTURE	0	100
INVENTAIRE	ecart_mad	Écart (MAD)	LECTURE	1	110
INVENTAIRE	motif_ecart	Motif de l'ecart	LECTURE	0	120
VALORISATION	code_reference	Référence	LECTURE	0	10
VALORISATION	code_magasin	Magasin	LECTURE	0	20
VALORISATION	quantite_kg	Quantité (kg)	LECTURE	0	30
VALORISATION	cmup_mad	CMUP (MAD/kg)	LECTURE	1	40
VALORISATION	valeur_mad	Valeur (MAD)	LECTURE	1	50
COCKPIT	nb_ruptures	Ruptures	LECTURE	0	10
COCKPIT	nb_critiques	Critiques	LECTURE	0	20
COCKPIT	nb_attention	En attention	LECTURE	0	30
COCKPIT	nb_ok	Situation normale	LECTURE	0	40
COCKPIT	nb_references	Références suivies	LECTURE	0	50
COCKPIT	valeur_stock_mad	Valeur du stock (MAD)	LECTURE	1	60
COCKPIT	nb_refs_a_commander	Références a commander	LECTURE	0	70
COCKPIT	budget_a_engager_mad	Budget a engager (MAD)	LECTURE	1	80
COCKPIT	nb_classe_a_alerte	Classe A en alerte	LECTURE	0	90
COCKPIT	nb_tier1	Urgences TIER 1	LECTURE	0	100
COCKPIT	nb_fournisseurs_actifs	Fournisseurs actifs	LECTURE	0	110
COCKPIT	nb_bc_ouverts	BC ouverts	LECTURE	0	120
COCKPIT	montant_bc_ouverts_mad	Montant des BC (MAD)	LECTURE	1	130
COCKPIT	nb_alertes_critiques	Alertes critiques	LECTURE	0	140
COCKPIT	nb_propositions_a_traiter	Propositions d'achat a traiter	LECTURE	0	150
COCKPIT	nb_bc_en_preparation	Bons en preparation	LECTURE	0	160
COCKPIT	nb_bc_a_valider	Bons a valider	LECTURE	0	170
COCKPIT	montant_bc_a_valider_mad	Montant a valider (MAD)	LECTURE	1	180
COCKPIT	nb_bc_a_envoyer	Bons a envoyer	LECTURE	0	190
COCKPIT	nb_livraisons_en_retard	Livraisons en retard	LECTURE	0	200
COCKPIT	retard_max_jours	Retard le plus ancien (j)	LECTURE	0	210
COCKPIT	nb_receptions_en_saisie	Réceptions en saisie	LECTURE	0	220
COCKPIT	nb_receptions_a_controler	Réceptions a controler	LECTURE	0	230
COCKPIT	nb_lignes_non_conformes	Lignes non conformes	LECTURE	0	240
COCKPIT	nb_receptions_a_regulariser	Réceptions a regulariser	LECTURE	0	250
COCKPIT	nb_refs_sous_minimum	Références sous le minimum	LECTURE	0	260
COCKPIT	nb_refs_dormantes	Références dormantes	LECTURE	0	270
FOURNISSEURS	nb_references	Nombre de références	LECTURE	0	820
COCKPIT	nb_controles_bloquants	Contrôles bloquants	LECTURE	0	300
COCKPIT	nb_controles_critiques	Contrôles critiques	LECTURE	0	310
COCKPIT	nb_alertes_ouvertes	Alertes ouvertes	LECTURE	0	320
COCKPIT	code_reference	Référence	LECTURE	0	400
COCKPIT	designation	Designation	LECTURE	0	410
COCKPIT	classe_abc	Classe ABC	LECTURE	0	420
COCKPIT	code_fournisseur	Fournisseur	LECTURE	0	430
COCKPIT	fournisseur_nom	Nom du fournisseur	LECTURE	0	440
COCKPIT	delai_livraison_jours	Délai de livraison (j)	LECTURE	0	450
COCKPIT	risque_sourcing	Sourcing	LECTURE	0	460
COCKPIT	stock_min_kg	Stock minimum (kg)	LECTURE	0	470
COCKPIT	stock_initial_kg	Stock actuel (kg)	LECTURE	0	480
COCKPIT	nb_mois_rupture	Mois en rupture	LECTURE	0	490
COCKPIT	nb_mois_tendu	Mois tendus	LECTURE	0	500
COCKPIT	premier_mois_rupture	Premier mois de rupture	LECTURE	0	510
COCKPIT	premier_mois_risque	Premier mois a risque	LECTURE	0	520
COCKPIT	rang_premier_risque	Rang du premier risque	LECTURE	0	530
COCKPIT	marge_decision_jours	Marge de decision (j)	LECTURE	0	540
COCKPIT	mois	Frise mensuelle	LECTURE	0	550
COCKPIT	annee_mois	Mois	LECTURE	0	560
COCKPIT	rang_mois	Rang du mois	LECTURE	0	570
COCKPIT	besoin_kg	Besoin du mois (kg)	LECTURE	0	580
COCKPIT	entrees_kg	Entrees attendues (kg)	LECTURE	0	590
COCKPIT	stock_fin_kg	Stock en fin de mois (kg)	LECTURE	0	600
COCKPIT	statut	Statut	LECTURE	0	610
MOUVEMENTS	annee_mois	Mois	LECTURE	0	710
MOUVEMENTS	type_libelle	Type de mouvement	LECTURE	0	720
MOUVEMENTS	signe	Sens	LECTURE	0	730
COCKPIT	nb_lots_peremption_proche	Lots proches de peremption	LECTURE	0	290
MOUVEMENTS	couleur	Couleur	LECTURE	0	740
MOUVEMENTS	nb_mouvements	Nombre de mouvements	LECTURE	0	750
MOUVEMENTS	nb_lignes	Nombre de lignes	LECTURE	0	760
MOUVEMENTS	nb_references	Nombre de références	LECTURE	0	770
MOUVEMENTS	valeur_mad	Valeur (MAD)	LECTURE	1	780
MOUVEMENTS	designation	Designation	LECTURE	0	790
MOUVEMENTS	classe_abc	Classe abc	LECTURE	0	800
MOUVEMENTS	solde_kg	Solde (kg)	LECTURE	0	830
MOUVEMENTS	entrees_mad	Entrees (MAD)	LECTURE	1	840
MOUVEMENTS	nb_mois_actifs	Mois avec mouvement	LECTURE	0	850
MOUVEMENTS	premier_mouvement	Premier mouvement	LECTURE	0	860
MOUVEMENTS	dernier_mouvement	Dernier mouvement	LECTURE	0	870
MOUVEMENTS	stock_actuel_kg	Stock actuel (kg)	LECTURE	0	880
MOUVEMENTS	rotation	Rotation	LECTURE	0	890
MOUVEMENTS	jours_sans_mouvement	Jours sans mouvement	LECTURE	0	900
VALORISATION	designation	Designation	LECTURE	0	710
VALORISATION	annee_mois	Mois	LECTURE	0	720
VALORISATION	code_devise	Code devise	LECTURE	0	730
VALORISATION	nb_achats	Nombre dachats	LECTURE	0	740
VALORISATION	nb_fournisseurs	Nombre de fournisseurs	LECTURE	0	750
VALORISATION	prix_moyen_devise	Prix moyen (devise)	LECTURE	1	770
VALORISATION	prix_moyen_mad	Prix moyen (MAD)	LECTURE	1	780
VALORISATION	taux_moyen	Taux de change moyen	LECTURE	0	790
VALORISATION	prix_min_mad	Prix le plus bas (MAD)	LECTURE	1	800
VALORISATION	prix_max_mad	Prix le plus haut (MAD)	LECTURE	1	810
VALORISATION	classe_abc	Classe abc	LECTURE	0	820
VALORISATION	quantite_totale_kg	Quantité achetée (kg)	LECTURE	0	830
VALORISATION	montant_total_mad	Montant achete (MAD)	LECTURE	1	840
VALORISATION	premier_achat	Premier achat	LECTURE	0	850
VALORISATION	dernier_achat	Dernier achat	LECTURE	0	860
VALORISATION	premier_prix_mad	Premier prix (MAD)	LECTURE	1	870
VALORISATION	dernier_prix_mad	Dernier prix (MAD)	LECTURE	1	880
VALORISATION	premier_prix_devise	Premier prix (devise)	LECTURE	1	890
VALORISATION	dernier_prix_devise	Dernier prix (devise)	LECTURE	1	900
VALORISATION	premier_taux	Premier taux	LECTURE	0	910
VALORISATION	dernier_taux	Dernier taux	LECTURE	0	920
VALORISATION	derive_totale_pct	Derive totale (%)	LECTURE	0	930
VALORISATION	derive_fournisseur_pct	Derive fournisseur (%)	LECTURE	0	940
VALORISATION	derive_change_pct	Derive de change (%)	LECTURE	0	950
VALORISATION	impact_fournisseur_mad	Impact fournisseur (MAD)	LECTURE	1	960
FOURNISSEURS	fournisseur_nom	Nom du fournisseur	LECTURE	0	710
FOURNISSEURS	annee_mois	Mois	LECTURE	0	720
FOURNISSEURS	nb_receptions	Nombre de réceptions	LECTURE	0	730
FOURNISSEURS	nb_lignes	Nombre de lignes	LECTURE	0	740
FOURNISSEURS	quantite_kg	Quantité kg	LECTURE	0	750
FOURNISSEURS	montant_mad	Montant mad	LECTURE	1	760
FOURNISSEURS	taux_conformite_pct	Taux de conformite (%)	LECTURE	0	770
FOURNISSEURS	nb_a_lheure	Livraisons a lheure	LECTURE	0	780
FOURNISSEURS	nb_mesurables	Livraisons mesurables	LECTURE	0	790
FOURNISSEURS	retard_moyen_jours	Retard moyen (j)	LECTURE	0	800
FOURNISSEURS	delai_reel_moyen_jours	Délai reel moyen (j)	LECTURE	0	810
FOURNISSEURS	nb_bc	Nombre de bons	LECTURE	0	830
FOURNISSEURS	montant_total_mad	Montant achete (MAD)	LECTURE	1	840
FOURNISSEURS	nb_lignes_recues	Lignes reçues	LECTURE	0	850
FOURNISSEURS	taux_ponctualite_pct	Ponctualite (%)	LECTURE	0	860
FOURNISSEURS	ecart_pesee_moyen_pct	Écart de pesée moyen (%)	LECTURE	0	870
FOURNISSEURS	classement	Classement	LECTURE	0	890
QUALITES	qualite_nom	Nom de la qualité	LECTURE	0	710
QUALITES	nb_composants	Nombre de composants	LECTURE	0	720
QUALITES	nb_sans_cmup	Composants sans CMUP	LECTURE	0	730
QUALITES	kg_m2_total	Poids recette (kg/m2)	LECTURE	0	740
QUALITES	cout_matiere_m2_mad	Coût matière (MAD/m2)	LECTURE	1	750
QUALITES	ecart_poids_pct	Écart de poids (%)	LECTURE	0	760
QUALITES	m2_prevus	m2 prévus	LECTURE	0	770
QUALITES	m2_realises	m2 realises	LECTURE	0	780
QUALITES	nb_mois_planifies	Mois planifies	LECTURE	0	790
QUALITES	taux_realisation_pct	Taux de realisation (%)	LECTURE	0	800
QUALITES	cout_matiere_plan_mad	Coût matière du plan (MAD)	LECTURE	1	810
QUALITES	somme_pct	Somme des % du role	LECTURE	0	820
CATALOGUE	code_groupe_equiv	Groupe dequivalence	LECTURE	0	810
CATALOGUE	groupe_libelle	Libelle du groupe	LECTURE	0	820
CATALOGUE	priorite	Priorite	LECTURE	0	830
CATALOGUE	est_preferentielle	Préférentielle	LECTURE	0	840
CATALOGUE	stock_kg	Stock (kg)	LECTURE	0	850
CATALOGUE	stock_projete_kg	Stock projeté (kg)	LECTURE	0	860
CATALOGUE	statut	Statut	LECTURE	0	870
CATALOGUE	besoin_12m_kg	Besoin 12 mois (kg)	LECTURE	0	880
IMPORT	numero	Numero du dossier	LECTURE	0	2000
IMPORT	statut	Statut	LECTURE	0	2005
FOURNISSEURS	otif_pct	OTIF (%)	LECTURE	0	880
CATALOGUE	equivalent_reference	Référence equivalente	LECTURE	0	890
CATALOGUE	equivalent_designation	Designation de lequivalent	LECTURE	0	900
CATALOGUE	equivalent_fournisseur	Fournisseur de lequivalent	LECTURE	0	910
CATALOGUE	equivalent_fournisseur_nom	Nom du fournisseur equivalent	LECTURE	0	920
CATALOGUE	equivalent_delai_jours	Délai de lequivalent (j)	LECTURE	0	930
CATALOGUE	equivalent_priorite	Priorite de lequivalent	LECTURE	0	940
CATALOGUE	equivalent_preferentielle	Equivalent preferentiel	LECTURE	0	950
CATALOGUE	equivalent_unite	Unité de lequivalent	LECTURE	0	960
CATALOGUE	equivalent_prix_catalogue_kg	Prix catalogue de lequivalent	LECTURE	1	970
CATALOGUE	equivalent_devise	Devise de lequivalent	LECTURE	0	980
CATALOGUE	equivalent_stock_kg	Stock de lequivalent (kg)	LECTURE	0	990
CATALOGUE	equivalent_stock_projete_kg	Stock projeté de lequivalent (kg)	LECTURE	0	1000
CATALOGUE	equivalent_statut	Statut de lequivalent	LECTURE	0	1010
CATALOGUE	equivalent_besoin_12m_kg	Besoin de lequivalent (kg)	LECTURE	0	1020
CATALOGUE	meme_fournisseur	Meme fournisseur	LECTURE	0	1030
CATALOGUE	interchangeable	Interchangeable	LECTURE	0	1040
CATALOGUE	libelle	Libelle	LECTURE	0	1050
CATALOGUE	nb_unites	Unités distinctes	LECTURE	0	1090
CATALOGUE	nb_densites	Densites distinctes	LECTURE	0	1100
CATALOGUE	nb_categories	Catégories distinctes	LECTURE	0	1110
CATALOGUE	nb_preferentielles	Preferentielles	LECTURE	0	1120
CATALOGUE	nb_avec_stock	Références avec stock	LECTURE	0	1130
CATALOGUE	nb_avec_besoin	Références avec besoin	LECTURE	0	1140
CATALOGUE	stock_cumule_kg	Stock cumulé du groupe (kg)	LECTURE	0	1150
CATALOGUE	besoin_cumule_kg	Besoin cumulé du groupe (kg)	LECTURE	0	1160
CATALOGUE	qualification	Qualification du groupe	LECTURE	0	1170
CATALOGUE	code_role	Code du role	LECTURE	0	1180
MOUVEMENTS	actif	Actif	LECTURE	0	1010
MOUVEMENTS	exige_motif_ligne	Exige un motif de ligne	LECTURE	0	1020
MOUVEMENTS	exige_of	Exige un numéro d'OF	LECTURE	0	1030
MOUVEMENTS	exige_prix	Exige un prix	LECTURE	1	1040
MOUVEMENTS	impacte_cmup	Impacte le CMUP	LECTURE	0	1050
MOUVEMENTS	libelle	Libelle	LECTURE	0	1060
MOUVEMENTS	categorie	Catégorie	LECTURE	0	1010
MOUVEMENTS	signe_default	Sens habituel	LECTURE	0	1020
MOUVEMENTS	code_motif_ligne	Code du motif	LECTURE	0	1010
STOCK	actif	Actif	LECTURE	0	1010
STOCK	adresse	Adresse	LECTURE	0	1020
STOCK	est_quarantaine	Zone de quarantaine	LECTURE	0	1030
STOCK	inclure_mrp	Compte dans le stock disponible	LECTURE	0	1040
STOCK	nom	Nom	LECTURE	0	1050
STOCK	responsable	Responsable	LECTURE	0	1060
STOCK	type	Type	LECTURE	0	1070
FOURNISSEURS	adresse	Adresse	LECTURE	0	1010
FOURNISSEURS	date_creation	Date création	LECTURE	0	1020
FOURNISSEURS	incoterm	Incoterm	LECTURE	0	1030
FOURNISSEURS	transporteur	Transporteur	LECTURE	0	1040
CATALOGUE	date_creation	Date création	LECTURE	0	1180
CATALOGUE	date_dernier_abc	Date dernier abc	LECTURE	0	1190
CATALOGUE	date_dernier_cmup	Date dernier cmup	LECTURE	0	1200
CATALOGUE	date_prix_catalogue	Date du prix catalogue	LECTURE	1	1210
CATALOGUE	date_debut	Date de début	LECTURE	0	1180
CATALOGUE	date_fin	Date de fin	LECTURE	0	1190
MOUVEMENTS	numero_transfert	Numéro du transfert	LECTURE	0	1300
MOUVEMENTS	date_transfert	Date du document	LECTURE	0	1310
MOUVEMENTS	statut	Statut	LECTURE	0	1320
MOUVEMENTS	code_magasin_source	Magasin expediteur	LECTURE	0	1330
MOUVEMENTS	code_magasin_dest	Magasin destinataire	LECTURE	0	1340
MOUVEMENTS	magasin_source_nom	Nom du magasin source	LECTURE	0	1350
MOUVEMENTS	magasin_dest_nom	Nom du magasin destinataire	LECTURE	0	1360
MOUVEMENTS	date_sortie	Date de sortie	LECTURE	0	1370
MOUVEMENTS	date_reception_dest	Date de réception	LECTURE	0	1380
MOUVEMENTS	responsable	Responsable	LECTURE	0	1390
MOUVEMENTS	transporteur	Transporteur	LECTURE	0	1400
MOUVEMENTS	observations	Observations	LECTURE	0	1410
MOUVEMENTS	auteur	Cree par	LECTURE	0	1420
MOUVEMENTS	expediteur	Expedie par	LECTURE	0	1430
MOUVEMENTS	receptionnaire	Reçu par	LECTURE	0	1440
MOUVEMENTS	jours_en_transit	Jours en transit	LECTURE	0	1450
MOUVEMENTS	ligne_numero	Numéro de ligne	LECTURE	0	1460
MOUVEMENTS	quantite_saisie	Quantité saisie	LECTURE	0	1470
MOUVEMENTS	unite_saisie	Unité de saisie	LECTURE	0	1480
MOUVEMENTS	nb_bobines	Nombre de bobines	LECTURE	0	1490
MOUVEMENTS	nb_palettes	Nombre de palettes	LECTURE	0	1500
MOUVEMENTS	quantite_totale_kg	Quantité totale (kg)	LECTURE	0	1510
MOUVEMENTS	bobines_totales	Total des bobines	LECTURE	0	1520
IMPORT	fournisseurs	Fournisseurs	LECTURE	0	2010
CATALOGUE	nb_fournisseurs	Fournisseurs	LECTURE	0	745
PARAMETRES	unite	Unité	LECTURE	0	40
MOUVEMENTS	palettes_totales	Total des palettes	LECTURE	0	1530
MOUVEMENTS	valeur_totale_mad	Valeur transportée (MAD)	LECTURE	1	1540
MOUVEMENTS	magasin_nom	Nom du magasin	LECTURE	0	1600
MOUVEMENTS	motif_libelle	Motif	LECTURE	0	1610
MOUVEMENTS	reference_document	Document de référence	LECTURE	0	1620
MOUVEMENTS	observations_globales	Observations	LECTURE	0	1630
MOUVEMENTS	date_creation	Date de saisie	LECTURE	0	1640
MOUVEMENTS	jours_de_retard_saisie	Jours entre fait et saisie	LECTURE	0	1650
MOUVEMENTS	saisi_par	Saisi par	LECTURE	0	1660
MOUVEMENTS	rebut_kg	Dont rebut / perte (kg)	LECTURE	0	1670
MOUVEMENTS	motif_ligne_libelle	Motif de la ligne	LECTURE	0	1680
MOUVEMENTS	est_initial	Reprise de stock initial	LECTURE	0	1690
MOUVEMENTS	date_fabrication	Date de fabrication	LECTURE	0	1700
MOUVEMENTS	statut_qualite	Statut qualité	LECTURE	0	1710
MOUVEMENTS	facteur_conversion	Facteur de conversion	LECTURE	0	1720
PLAN_ACHAT	figee	Protégée du recalcul	LECTURE	0	1300
PLAN_ACHAT	figee_par	Protégée par	LECTURE	0	1310
PLAN_ACHAT	date_figement	Date de protection	LECTURE	0	1320
PLAN_ACHAT	motif_figement	Motif de la protection	LECTURE	0	1330
PLAN_ACHAT	quantite_mrp_kg	Quantité calculée au depart (kg)	LECTURE	0	1340
PLAN_ACHAT	quantite_calculee_kg	Quantité calculée aujourdhui (kg)	LECTURE	0	1350
PLAN_ACHAT	ecart_calcul_kg	Écart avec le calcul (kg)	LECTURE	0	1360
PLAN_ACHAT	etat_figement	Cohérence de la protection	LECTURE	0	1370
PARAMETRES	fichier	Fichier	LECTURE	0	200
PARAMETRES	plateforme	Plateforme	LECTURE	0	210
PARAMETRES	version	Version	LECTURE	0	220
PARAMETRES	taille_octets	Taille	LECTURE	0	230
PARAMETRES	date_telechargement	Telecharge le	LECTURE	0	240
PARAMETRES	utilisateur	Par	LECTURE	0	250
STOCK	valeur_conso_annuelle_mad	Valeur de consommation annuelle (MAD)	LECTURE	1	910
STOCK	part_pct	Part dans la depense totale (%)	LECTURE	1	911
STOCK	pct_cumule	Part cumulée (%)	LECTURE	1	912
STOCK	rang	Rang par valeur consommée	LECTURE	0	913
STOCK	politique	Politique de reapprovisionnement	LECTURE	0	914
STOCK	date_dernier_abc	Date du dernier classement	LECTURE	0	915
VALORISATION	prix_achat_mad_kg	Prix d'achat (MAD/kg)	LECTURE	1	920
VALORISATION	frais_approche_mad	Frais d'approche repartis (MAD)	LECTURE	1	921
VALORISATION	frais_mad_kg	Frais d'approche (MAD/kg)	LECTURE	1	922
VALORISATION	cout_revient_mad_kg	Coût de revient rendu (MAD/kg)	LECTURE	1	923
VALORISATION	part_frais_pct	Part des frais dans le coût (%)	LECTURE	0	924
VALORISATION	montant_devise	Montant du frais (devise)	LECTURE	1	925
VALORISATION	montant_mad	Montant du frais (MAD)	LECTURE	1	926
VALORISATION	type_frais	Nature du frais	LECTURE	0	927
VALORISATION	cle_repartition	Clé de répartition	LECTURE	0	928
VALORISATION	reference_externe	Référence externe (facture, DUM)	LECTURE	0	929
STOCK	stock_global_kg	Stock global (kg)	LECTURE	0	1900
STOCK	magasins_kg	Dont en magasin (kg)	LECTURE	0	1910
STOCK	machines_kg	Dont sur machines (kg)	LECTURE	0	1920
STOCK	machines_bobines	Bobines sur machines	LECTURE	0	1930
STOCK	nb_machines	Nombre de machines chargees	LECTURE	0	1940
STOCK	par_magasin	Ventilation par magasin	LECTURE	0	1950
STOCK	a_commander_kg	A commander (kg)	LECTURE	0	1960
STOCK	prix_catalogue_kg	Prix catalogue au kg	LECTURE	1	1970
STOCK	jours_sans_mouvement	Jours sans mouvement	LECTURE	0	1980
STOCK	derniere_sortie	Dernière sortie	LECTURE	0	1990
STOCK	nb_equivalents	Equivalents disponibles	LECTURE	0	2000
PARAMETRES	etat	État de la machine	ECRITURE	0	2100
PARAMETRES	motif_etat	Motif du changement d etat	ECRITURE	0	2101
PARAMETRES	date_etat	Date du changement d etat	LECTURE	0	2102
IMPORT	nb_factures	Nombre de factures	LECTURE	0	2015
IMPORT	date_arrivee	Date d'arrivee	LECTURE	0	2020
IMPORT	valeur_dhs	Valeur d'achat (DH)	LECTURE	0	2025
IMPORT	frais_dhs	Frais inclus (DH)	LECTURE	0	2030
IMPORT	tva_dhs	Frais hors cout (DH)	LECTURE	0	2035
IMPORT	poids_kg	Poids facture (kg)	LECTURE	0	2040
IMPORT	recu_kg	Poids recu (kg)	LECTURE	0	2045
IMPORT	nb_palettes	Palettes	LECTURE	0	2050
IMPORT	nb_bobines	Bobines	LECTURE	0	2055
IMPORT	frais_alloues_dhs	Frais alloues (DH)	LECTURE	1	2100
IMPORT	montant_alloue_dhs	Part de frais (DH)	LECTURE	1	2110
IMPORT	cout_revient_dhs	Cout de revient (DH)	LECTURE	1	2120
IMPORT	cout_revient_unitaire_dhs	Cout de revient unitaire (DH)	LECTURE	1	2130
IMPORT	cout_revient_kg_dhs	Cout de revient au kg (DH)	LECTURE	1	2140
IMPORT	coef_frais_pct	Frais en % de la valeur	LECTURE	1	2150
IMPORT	cump_avant	CUMP avant cloture	LECTURE	1	2160
IMPORT	cump_apres	CUMP apres cloture	LECTURE	1	2170
CATALOGUE	code_reference	Référence	LECTURE	0	10
CATALOGUE	designation	Designation	LECTURE	0	20
CATALOGUE	code_categorie	Catégorie matière	LECTURE	0	30
CATALOGUE	code_role_defaut	Role BOM habituel	LECTURE	0	35
CATALOGUE	code_fournisseur	Fournisseur	LECTURE	0	40
CATALOGUE	fournisseur_nom	Nom du fournisseur	LECTURE	0	45
CATALOGUE	type_fil	Type de fil	LECTURE	0	50
CATALOGUE	couleur	Couleur	LECTURE	0	60
CATALOGUE	titrage	Titrage	LECTURE	0	70
CATALOGUE	unite_catalogue	Unité	LECTURE	0	80
CATALOGUE	densite_kg_ml	Densité (kg/ml)	LECTURE	0	110
CATALOGUE	facteur_kg	Facteur de conversion (kg)	LECTURE	0	120
CATALOGUE	prix_catalogue	Prix catalogue	LECTURE	1	130
CATALOGUE	code_devise_catalogue	Devise	LECTURE	1	140
CATALOGUE	prix_catalogue_kg	Prix ramene au kg	LECTURE	1	150
CATALOGUE	prix_kg_mad	Prix (MAD/kg)	LECTURE	1	155
CATALOGUE	source_prix	Source du prix	LECTURE	1	156
CATALOGUE	cmup_mad	CMUP (MAD/kg)	LECTURE	1	160
CATALOGUE	stock_min_kg	Stock minimum (kg)	LECTURE	0	170
CATALOGUE	couverture_min_mois	Couverture minimale (mois)	LECTURE	0	180
CATALOGUE	marge_securite_pct	Marge de sécurité (%)	LECTURE	0	190
CATALOGUE	moq_kg	Quantité minimale (kg)	LECTURE	0	200
CATALOGUE	multiple_achat_kg	Multiple d'achat (kg)	LECTURE	0	210
CATALOGUE	classe_abc	Classe ABC	LECTURE	0	220
CATALOGUE	classe_xyz	Classe XYZ	LECTURE	0	230
CATALOGUE	suivi_lot	Suivi par lot	LECTURE	0	240
RECEPTIONS	dossiers	Dossiers d'import	LECTURE	0	800
RECEPTIONS	quantite_kg	Poids recu (kg)	LECTURE	0	805
RECEPTIONS	ecart_kg	Ecart (kg)	LECTURE	0	810
RECEPTIONS	nb_bobines	Bobines	LECTURE	0	815
RECEPTIONS	nb_palettes	Palettes	LECTURE	0	820
PARAMETRES	id_frais	Code du frais	ECRITURE	0	900
PARAMETRES	piece_justificative	Piece justificative	ECRITURE	0	905
PARAMETRES	recuperable	Recuperable	ECRITURE	0	910
PARAMETRES	commun	Commun au dossier	ECRITURE	0	915
PARAMETRES	inclus_dans_cout	Entre dans le cout	ECRITURE	0	920
PARAMETRES	methode_repartition	Methode de repartition	ECRITURE	0	925
PARAMETRES	ordre	Ordre d'affichage	ECRITURE	0	930
PARAMETRES	actif	Actif	ECRITURE	0	935
PARAMETRES	nb_utilisations	Dossiers concernes	LECTURE	0	940
BONS_COMMANDE	type_ligne	Type de ligne	LECTURE	0	85
BONS_COMMANDE	libelle	Libelle de prestation	LECTURE	0	88
PARAMETRES	taux	Taux de change	LECTURE	0	2110
PARAMETRES	date_debut	En vigueur depuis	LECTURE	0	2120
PARAMETRES	date_fin	En vigueur jusqu'au	LECTURE	0	2130
CATALOGUE	code_conditionnement	Conditionnement	ECRITURE	0	88
STOCK	unite_pluriel	Unite de comptage	LECTURE	0	62
STOCK	nb_colis	Colis	LECTURE	0	63
STOCK	litres	Litres	LECTURE	0	64
CATALOGUE	poids_bobine_kg	Poids par unite (kg)	LECTURE	0	90
CATALOGUE	bobines_par_palette	Unites par palette	LECTURE	0	100
CATALOGUE	actif	Actif	LECTURE	0	250
FOURNISSEURS	code_fournisseur	Code	LECTURE	0	10
CATALOGUE	code_couleur_interne	Code couleur interne	ECRITURE	0	700
CATALOGUE	code_famille	Famille	ECRITURE	0	705
CATALOGUE	reference_fournisseur	Reference fournisseur	ECRITURE	0	710
CATALOGUE	supplement_teinture	Supplement teinture	ECRITURE	0	715
CATALOGUE	classe_teinture	Classe de teinture	ECRITURE	0	720
CATALOGUE	description	Description	LECTURE	0	725
CATALOGUE	ordre_affichage	Ordre d'affichage	LECTURE	0	730
CATALOGUE	nb_references	References	LECTURE	0	735
BONS_COMMANDE	densite_kg_ml	Densite (kg/ml)	LECTURE	0	108
COCKPIT	nb_sur_stock	References en sur-stock	LECTURE	0	4010
COCKPIT	nb_ecart_majeur	Ecarts majeurs a verifier	LECTURE	0	4020
COCKPIT	nb_refs_en_alerte	References en alerte	LECTURE	0	4030
COCKPIT	nb_classe_a	Classe A	LECTURE	0	4040
COCKPIT	nb_classe_b	Classe B	LECTURE	0	4050
COCKPIT	nb_classe_c	Classe C	LECTURE	0	4060
COCKPIT	nb_non_classees	References non classees	LECTURE	0	4070
COCKPIT	couverture_ponderee_jours	Couverture ponderee valeur (j)	LECTURE	0	4080
COCKPIT	ecart_pesee_moyen_pct	Ecart de pesee moyen (%)	LECTURE	0	4090
COCKPIT	nb_opportunites	Opportunites d'economie	LECTURE	0	4100
COCKPIT	alertes	References en alerte (liste)	LECTURE	0	4110
COCKPIT	economies_total_mad	Economies theoriques (MAD/an)	LECTURE	1	4120
COCKPIT	budget_ruptures_mad	Budget des ruptures (MAD)	LECTURE	1	4130
COCKPIT	pct_valeur_dormante	Part du stock dormant (%)	LECTURE	1	4140
COCKPIT	valeur_dormante_mad	Valeur du stock dormant (MAD)	LECTURE	1	4150
MOUVEMENTS	valeur_dhs	Valeur du stock (MAD)	LECTURE	1	4160
CATALOGUE	prix_catalogue_mad	Prix catalogue (MAD/kg)	LECTURE	1	4170
CATALOGUE	valeur_stock_mad	Valeur du stock (MAD)	LECTURE	1	4180
BONS_COMMANDE	poids_bobine_kg	Poids par unite (kg)	LECTURE	0	104
BONS_COMMANDE	bobines_par_palette	Unites par palette	LECTURE	0	106
IMPORT	nom_fichier	Fichier	LECTURE	0	2200
IMPORT	nature	Nature	LECTURE	0	2205
IMPORT	taille_octets	Taille	LECTURE	0	2210
IMPORT	nb_pages	Pages	LECTURE	0	2215
IMPORT	date_depot	Depose le	LECTURE	0	2220
IMPORT	depose_par	Depose par	LECTURE	0	2225
BONS_COMMANDE	reference_fournisseur	Reference chez le fournisseur	LECTURE	0	92
BONS_COMMANDE	couleur	Couleur	LECTURE	0	94
BONS_COMMANDE	code_couleur	Code couleur du fournisseur	LECTURE	0	96
PLAN_ACHAT	selection	Case de selection	LECTURE	0	4200
PLAN_ACHAT	classe_abc	Classe ABC	LECTURE	0	4210
PLAN_ACHAT	classe_xyz	Classe XYZ	LECTURE	0	4220
PLAN_ACHAT	risque_source	Risque de sourcing	LECTURE	0	4230
PLAN_ACHAT	nb_sources	Nombre de sources	LECTURE	0	4240
PLAN_ACHAT	code_devise	Devise	LECTURE	0	4250
PLAN_ACHAT	prix_devise	Prix (devise)	LECTURE	1	4260
PLAN_ACHAT	montant_devise	Montant (devise)	LECTURE	1	4270
PLAN_ACHAT	taux_devise	Taux de change retenu	LECTURE	0	4280
PLAN_ACHAT	palettes_a_commander	Palettes a commander	LECTURE	0	4290
STOCK	palettes	Palettes en stock	LECTURE	0	4300
STOCK	bobines	Bobines en stock	LECTURE	0	4310
STOCK	kg_par_palette	Kilos par palette	LECTURE	0	4320
BONS_COMMANDE	date_envoi	Date d'envoi	LECTURE	0	64
CATALOGUE	code_couleur_fournisseur	Code chez le fournisseur	ECRITURE	0	740
CATALOGUE	nb_familles	Familles	LECTURE	0	750
STOCK	unite_catalogue	Unite du catalogue	LECTURE	0	2010
STOCK	densite_kg_ml	Densite (kg/ml)	LECTURE	0	2040
STOCK	suivi_lot	Suivi de lot	LECTURE	0	2050
STOCK	poids_bobine_kg	Poids par unite (kg)	LECTURE	0	2020
STOCK	bobines_par_palette	Unites par palette	LECTURE	0	2030
MOUVEMENTS	famille_libelle	Famille	LECTURE	0	3010
MOUVEMENTS	categorie_libelle	Categorie	LECTURE	0	3020
MOUVEMENTS	couleur_libelle	Couleur	LECTURE	0	3030
MOUVEMENTS	refs_en_stock	References en stock	LECTURE	0	3040
MOUVEMENTS	entrees_kg	Entrees (kg)	LECTURE	0	3050
MOUVEMENTS	sorties_kg	Sorties (kg)	LECTURE	0	3060
MOUVEMENTS	nb_entrees	Nombre d entrees	LECTURE	0	3070
MOUVEMENTS	entrees_dhs	Entrees (MAD)	LECTURE	1	3080
MOUVEMENTS	prix_moyen_entree_mad	Prix moyen a l entree	LECTURE	1	3090
MOUVEMENTS	nb_familles	Nombre de familles	LECTURE	0	3100
CATALOGUE	bobines_par_lot	Bobines par lot	ECRITURE	0	3010
CATALOGUE	description_commerciale	Description commerciale	ECRITURE	0	3020
FOURNISSEURS	palettes_par_conteneur	Palettes par conteneur	ECRITURE	0	3030
BONS_COMMANDE	bobines_par_lot	Bobines par lot	LECTURE	0	3040
BONS_COMMANDE	description_commerciale	Description commerciale	LECTURE	0	3050
BONS_COMMANDE	nombre_conteneurs	Nombre de conteneurs	ECRITURE	0	3060
BONS_COMMANDE	mention_expedition	Mention d'expedition	ECRITURE	0	3070
STOCK	bobines_par_lot	Bobines par lot	LECTURE	0	3080
BONS_COMMANDE	incoterm	Incoterm	LECTURE	0	3090
BONS_COMMANDE	tolerance_pesee_pct	Tolerance de pesee (%)	LECTURE	0	3100
BONS_COMMANDE	palettes_par_conteneur	Palettes par conteneur	LECTURE	0	3110
BONS_COMMANDE	code_famille	Famille (titrage)	LECTURE	0	3120
UTILISATEURS	totp_actif	Double authentification	LECTURE	0	4010
UTILISATEURS	totp_active_le	Activée le	LECTURE	0	4020
UTILISATEURS	echecs_consecutifs	Échecs consécutifs	LECTURE	0	4030
UTILISATEURS	bloque_jusqu_a	Bloqué jusqu’à	LECTURE	0	4040
UTILISATEURS	dernier_echec	Dernier échec	LECTURE	0	4050
UTILISATEURS	resultat	Résultat	LECTURE	0	4060
UTILISATEURS	agent	Appareil	LECTURE	0	4070
PARAMETRES	adresse_ip	Adresse IP	LECTURE	0	260
PARAMETRES	disponible	Disponible	LECTURE	0	270
PARAMETRES	nb_telechargements	Telechargements	LECTURE	0	280
PARAMETRES	code_parametre	Code	LECTURE	0	10
PARAMETRES	libelle	Libelle	LECTURE	0	20
PARAMETRES	valeur_courante	Valeur	LECTURE	0	30
PARAMETRES	categorie	Catégorie	LECTURE	0	50
PARAMETRES	verrouille	Verrouille	LECTURE	0	60
AUDIT	date_operation	Date	LECTURE	0	10
AUDIT	table_concernee	Table	LECTURE	0	20
AUDIT	operation	Opération	LECTURE	0	30
AUDIT	auteur	Auteur	LECTURE	0	40
AUDIT	anciennes_valeurs	Anciennes valeurs	LECTURE	0	50
AUDIT	nouvelles_valeurs	Nouvelles valeurs	LECTURE	0	60
AUDIT	adresse_ip	Adresse IP	LECTURE	0	70
UTILISATEURS	login	Identifiant	LECTURE	0	10
UTILISATEURS	nom	Nom	LECTURE	0	20
UTILISATEURS	code_role_user	Role	LECTURE	0	30
UTILISATEURS	email	Email	LECTURE	0	40
UTILISATEURS	telephone	Telephone	LECTURE	0	50
UTILISATEURS	magasin_principal	Magasin principal	LECTURE	0	60
UTILISATEURS	derniere_connexion	Dernière connexion	LECTURE	0	80
UTILISATEURS	actif	Actif	LECTURE	0	90
CATALOGUE	prix_moyen_mad	Prix moyen pondere du mois (MAD/kg)	LECTURE	1	900
CATALOGUE	annee_mois	Mois d'achat	LECTURE	0	901
CATALOGUE	quantite_kg	Quantité achetée dans le mois (kg)	LECTURE	0	902
CATALOGUE	nb_achats	Nombre d'achats dans le mois	LECTURE	0	903
BONS_COMMANDE	total_ligne_mad	Montant ligne MAD	LECTURE	1	151
BONS_COMMANDE	categorie_libelle	Type (catégorie)	LECTURE	0	95
BONS_COMMANDE	nb_palettes	Palettes	LECTURE	0	96
CATALOGUE	type_lot	Type de lot	ECRITURE	0	3014
CATALOGUE	seuil_lot_valeur	Minimum d'un lot pour produire	ECRITURE	0	3015
CATALOGUE	fusion_lot	Fusion de lots autorisee	ECRITURE	0	3016
CATALOGUE	arrondi_palette	Arrondi a la palette pleine	ECRITURE	0	3017
PLAN_ACHAT	complement_palette_kg	Complement de palette (kg)	LECTURE	0	4295
STOCK	kg_sur_machine	Fil sur machine (kg)	LECTURE	0	45
COCKPIT	budget_annuel_mad	Budget annuel (MAD)	LECTURE	1	4200
COCKPIT	cout_mad	Cout (MAD)	LECTURE	1	4210
COCKPIT	cout_matiere_annuel_mad	Cout matiere annuel (MAD)	LECTURE	1	4220
COCKPIT	economie_annuelle_mad	Economie annuelle (MAD)	LECTURE	1	4230
COCKPIT	montant_mad	Montant (MAD)	LECTURE	1	4240
COCKPIT	prix_actuel_mad	Prix actuel (MAD/kg)	LECTURE	1	4250
COCKPIT	prix_min_mad	Prix le plus bas (MAD/kg)	LECTURE	1	4260
COCKPIT	valeur_conso_annuelle_mad	Valeur consommee par an (MAD)	LECTURE	1	4270
COCKPIT	montant_total_mad	Montant (MAD) du fil d'actualite	LECTURE	1	4280
RECEPTIONS	montant_facture_mad	Montant de la facture (MAD)	LECTURE	1	4300
RECEPTIONS	frais_facture_mad	Frais de la facture (MAD)	LECTURE	1	4310
RECEPTIONS	taux_change_reception	Taux de change de la reception	LECTURE	1	4320
RECEPTIONS	valeur_provisoire_mad	Valeur provisoire (MAD)	LECTURE	1	4330
RECEPTIONS	valeur_definitive_mad	Valeur definitive (MAD)	LECTURE	1	4340
RECEPTIONS	difference_mad	Difference de facture (MAD)	LECTURE	1	4350
RECEPTIONS	au_stock_mad	Part portee au stock (MAD)	LECTURE	1	4360
RECEPTIONS	ecart_prix_mad	Ecart de prix (MAD)	LECTURE	1	4370
RECEPTIONS	cmup_avant	CMUP avant cloture	LECTURE	1	4380
RECEPTIONS	cmup_apres	CMUP apres cloture	LECTURE	1	4390
RECEPTIONS	montant_facture_devise	Montant de la facture (devise)	LECTURE	1	4392
RECEPTIONS	taux_facture	Taux de la facture	LECTURE	1	4394
RECEPTIONS	montant_devise	Montant facture saisi (devise)	LECTURE	1	4396
STOCK	prix_entree_mad	Prix d'entree du lot (MAD/kg)	LECTURE	1	4400
\.


ALTER TABLE public.champ_configurable ENABLE TRIGGER ALL;

--
-- Data for Name: devise; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.devise DISABLE TRIGGER ALL;

COPY public.devise (code_devise, libelle, symbole, est_pivot, actif) FROM stdin;
MAD	Dirham marocain	DH	1	1
EUR	Euro	EUR	0	1
USD	Dollar americain	USD	0	1
\.


ALTER TABLE public.devise ENABLE TRIGGER ALL;

--
-- Data for Name: machine_motif; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.machine_motif DISABLE TRIGGER ALL;

COPY public.machine_motif (code_motif, type_fiche, libelle, destinations, effet_defaut, effets_permis, ordre, actif) FROM stdin;
CH_PRODUCTION	CHARGE	Pour production	{}	CONSOMMATION	{}	1	1
CH_COMPLEMENT	CHARGE	Complément de production	{}	CONSOMMATION	{}	2	1
CH_AUTRE	CHARGE	Autre	{}	NON_QUALIFIE	{}	9	1
DE_CHGT_LOT	DECHARGE	Changement de lot	{MAGASIN}	CONSOMMATION	{}	1	1
DE_CHGT_PROD	DECHARGE	Changement de production	{MAGASIN}	CONSOMMATION	{}	2	1
DE_PB_FIL	DECHARGE	Problème de fil	{MAGASIN,DECHET}	CONSOMMATION	{}	3	1
DE_DECHET	DECHARGE	Déchet	{DECHET}	CONSOMMATION	{}	4	1
DE_PERTE	DECHARGE	Perte	{PERTE}	CONSOMMATION	{}	5	1
DE_CASSE	DECHARGE	Casse	{CASSE}	CONSOMMATION	{}	6	1
DE_AUTRE	DECHARGE	Autre	{MAGASIN,PERTE,DECHET,CASSE}	NON_QUALIFIE	{}	9	1
MJ_ORDINAIRE	MAJ	Constat ordinaire	{}	CONSOMMATION	{}	1	1
MJ_CORRECTION	MAJ	Correction	{}	\N	{CONSOMMATION,ERREUR_SAISIE}	2	1
MJ_DPC	MAJ	Déchet / perte / casse	{}	\N	{DECHET,PERTE,CASSE}	3	1
MJ_AUTRE	MAJ	Autre	{}	NON_QUALIFIE	{}	9	1
\.


ALTER TABLE public.machine_motif ENABLE TRIGGER ALL;

--
-- Data for Name: magasin; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.magasin DISABLE TRIGGER ALL;

COPY public.magasin (code_magasin, nom, type, adresse, responsable, inclure_mrp, est_quarantaine, actif) FROM stdin;
Polyfashions	Polyfashions Carpet	PRINCIPAL	\N	\N	1	0	1
Morocco	Morocco	SECONDAIRE	\N	\N	1	0	1
\.


ALTER TABLE public.magasin ENABLE TRIGGER ALL;

--
-- Data for Name: role_utilisateur; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.role_utilisateur DISABLE TRIGGER ALL;

COPY public.role_utilisateur (code_role_user, libelle, description, niveau_hierarchique, plafond_validation_bc_mad, actif) FROM stdin;
DIRECTION	Direction Générale	Validation strategique, arbitrage financier, KPI	100	\N	1
MAGASIN	Magasinier	Pesees, mouvements, inventaires, transferts	40	\N	1
ASSISTANTE	Assistante de gestion	Gestion courante hors montants : catalogue, production, planification, achats, stock.	55	\N	1
ADMIN	Administrateur système	Super-utilisateur : tous les modules, toutes les actions, montants compris. Aucune separation avec la direction.	90	\N	1
\.


ALTER TABLE public.role_utilisateur ENABLE TRIGGER ALL;

--
-- Data for Name: modele_droit_champ; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.modele_droit_champ DISABLE TRIGGER ALL;

COPY public.modele_droit_champ (code_role_user, module, champ, niveau) FROM stdin;
DIRECTION	STOCK	stock_global_kg	LECTURE
MAGASIN	STOCK	stock_global_kg	LECTURE
ASSISTANTE	CATALOGUE	code_reference	ECRITURE
DIRECTION	PARAMETRES	date_etat	ECRITURE
DIRECTION	STOCK	magasins_kg	LECTURE
MAGASIN	STOCK	magasins_kg	LECTURE
ASSISTANTE	CATALOGUE	designation	ECRITURE
DIRECTION	STOCK	machines_kg	LECTURE
MAGASIN	STOCK	machines_kg	LECTURE
ASSISTANTE	CATALOGUE	code_categorie	ECRITURE
ASSISTANTE	PARAMETRES	date_etat	ECRITURE
DIRECTION	STOCK	machines_bobines	LECTURE
MAGASIN	STOCK	machines_bobines	LECTURE
ASSISTANTE	CATALOGUE	code_role_defaut	ECRITURE
MAGASIN	PARAMETRES	date_etat	ECRITURE
DIRECTION	STOCK	nb_machines	LECTURE
MAGASIN	STOCK	nb_machines	LECTURE
ASSISTANTE	CATALOGUE	code_fournisseur	ECRITURE
DIRECTION	PARAMETRES	etat	ECRITURE
DIRECTION	STOCK	par_magasin	LECTURE
MAGASIN	STOCK	par_magasin	LECTURE
ASSISTANTE	CATALOGUE	fournisseur_nom	ECRITURE
DIRECTION	STOCK	a_commander_kg	LECTURE
MAGASIN	STOCK	a_commander_kg	LECTURE
ASSISTANTE	CATALOGUE	type_fil	ECRITURE
ASSISTANTE	PARAMETRES	etat	ECRITURE
DIRECTION	STOCK	prix_catalogue_kg	LECTURE
MAGASIN	STOCK	prix_catalogue_kg	MASQUE
ASSISTANTE	CATALOGUE	couleur	ECRITURE
MAGASIN	PARAMETRES	etat	ECRITURE
DIRECTION	STOCK	jours_sans_mouvement	LECTURE
MAGASIN	STOCK	jours_sans_mouvement	LECTURE
ASSISTANTE	CATALOGUE	titrage	ECRITURE
DIRECTION	PARAMETRES	motif_etat	ECRITURE
DIRECTION	STOCK	derniere_sortie	LECTURE
MAGASIN	STOCK	derniere_sortie	LECTURE
ASSISTANTE	CATALOGUE	unite_catalogue	ECRITURE
DIRECTION	STOCK	nb_equivalents	LECTURE
MAGASIN	STOCK	nb_equivalents	LECTURE
ASSISTANTE	CATALOGUE	poids_bobine_kg	ECRITURE
ASSISTANTE	PARAMETRES	motif_etat	ECRITURE
ASSISTANTE	CATALOGUE	bobines_par_palette	ECRITURE
ASSISTANTE	CATALOGUE	densite_kg_ml	ECRITURE
ASSISTANTE	CATALOGUE	facteur_kg	ECRITURE
ASSISTANTE	CATALOGUE	prix_catalogue	MASQUE
ASSISTANTE	CATALOGUE	code_devise_catalogue	MASQUE
ASSISTANTE	CATALOGUE	prix_catalogue_kg	MASQUE
ASSISTANTE	CATALOGUE	prix_kg_mad	MASQUE
ASSISTANTE	CATALOGUE	source_prix	MASQUE
ASSISTANTE	CATALOGUE	cmup_mad	MASQUE
ASSISTANTE	CATALOGUE	stock_min_kg	ECRITURE
ASSISTANTE	CATALOGUE	couverture_min_mois	ECRITURE
ASSISTANTE	CATALOGUE	marge_securite_pct	ECRITURE
ASSISTANTE	CATALOGUE	moq_kg	ECRITURE
ASSISTANTE	CATALOGUE	multiple_achat_kg	ECRITURE
ASSISTANTE	CATALOGUE	classe_abc	ECRITURE
ASSISTANTE	CATALOGUE	classe_xyz	ECRITURE
ASSISTANTE	CATALOGUE	suivi_lot	ECRITURE
ASSISTANTE	CATALOGUE	actif	ECRITURE
ASSISTANTE	FOURNISSEURS	code_fournisseur	ECRITURE
ASSISTANTE	FOURNISSEURS	nom	ECRITURE
ASSISTANTE	FOURNISSEURS	contact_principal	ECRITURE
ASSISTANTE	FOURNISSEURS	telephone	ECRITURE
ASSISTANTE	FOURNISSEURS	email	ECRITURE
ASSISTANTE	FOURNISSEURS	pays	ECRITURE
ASSISTANTE	FOURNISSEURS	ville	ECRITURE
ASSISTANTE	FOURNISSEURS	delai_livraison_jours	ECRITURE
ASSISTANTE	FOURNISSEURS	conditions_paiement	MASQUE
ASSISTANTE	FOURNISSEURS	delai_paiement_jours	MASQUE
ASSISTANTE	FOURNISSEURS	code_devise	ECRITURE
ASSISTANTE	FOURNISSEURS	note_globale	ECRITURE
ASSISTANTE	FOURNISSEURS	tolerance_pesee_pct	ECRITURE
ASSISTANTE	FOURNISSEURS	actif	ECRITURE
ASSISTANTE	STOCK	code_reference	ECRITURE
ASSISTANTE	STOCK	designation	ECRITURE
ASSISTANTE	STOCK	code_magasin	ECRITURE
ASSISTANTE	STOCK	quantite_kg	ECRITURE
ASSISTANTE	STOCK	cmup_mad	MASQUE
ASSISTANTE	STOCK	valeur_mad	MASQUE
ASSISTANTE	STOCK	date_derniere_entree	ECRITURE
ASSISTANTE	STOCK	date_derniere_sortie	ECRITURE
ASSISTANTE	STOCK	date_dernier_inventaire	ECRITURE
ASSISTANTE	STOCK	stock_projete_kg	ECRITURE
ASSISTANTE	STOCK	jours_couverture	ECRITURE
ASSISTANTE	STOCK	statut	ECRITURE
ASSISTANTE	STOCK	lot_fournisseur	ECRITURE
ASSISTANTE	STOCK	date_peremption	ECRITURE
ASSISTANTE	MOUVEMENTS	numero_mouvement	ECRITURE
ASSISTANTE	MOUVEMENTS	date_mouvement	ECRITURE
ASSISTANTE	MOUVEMENTS	code_type_mvt	ECRITURE
ASSISTANTE	MOUVEMENTS	code_magasin	ECRITURE
ASSISTANTE	MOUVEMENTS	code_motif	ECRITURE
ASSISTANTE	MOUVEMENTS	code_reference	ECRITURE
ASSISTANTE	MOUVEMENTS	quantite_kg	ECRITURE
ASSISTANTE	MOUVEMENTS	prix_kg_mad	MASQUE
ASSISTANTE	MOUVEMENTS	total_mad	MASQUE
ASSISTANTE	MOUVEMENTS	lot_fournisseur	ECRITURE
ASSISTANTE	MOUVEMENTS	numero_of	ECRITURE
ASSISTANTE	MOUVEMENTS	utilisateur	ECRITURE
ASSISTANTE	RECEPTIONS	numero_reception	ECRITURE
ASSISTANTE	RECEPTIONS	date_reception	ECRITURE
ASSISTANTE	RECEPTIONS	code_fournisseur	ECRITURE
ASSISTANTE	RECEPTIONS	num_bon_livraison	ECRITURE
ASSISTANTE	RECEPTIONS	code_reference	ECRITURE
ASSISTANTE	RECEPTIONS	unite_saisie	ECRITURE
ASSISTANTE	RECEPTIONS	quantite_pesee_unite	ECRITURE
ASSISTANTE	RECEPTIONS	quantite_stock_kg	ECRITURE
MAGASIN	PARAMETRES	motif_etat	ECRITURE
ADMIN	FOURNISSEURS	nom	ECRITURE
ASSISTANTE	RECEPTIONS	quantite_commandee_kg	ECRITURE
ASSISTANTE	RECEPTIONS	ecart_pct	ECRITURE
ASSISTANTE	RECEPTIONS	prix_kg_devise	ECRITURE
ASSISTANTE	RECEPTIONS	code_devise	ECRITURE
ASSISTANTE	RECEPTIONS	taux_change	ECRITURE
ASSISTANTE	RECEPTIONS	prix_kg_mad	ECRITURE
ASSISTANTE	RECEPTIONS	total_mad	ECRITURE
ASSISTANTE	RECEPTIONS	total_devise	ECRITURE
ASSISTANTE	RECEPTIONS	lot_fournisseur	ECRITURE
ASSISTANTE	RECEPTIONS	date_peremption	ECRITURE
ASSISTANTE	RECEPTIONS	statut_qualite	ECRITURE
ASSISTANTE	RECEPTIONS	code_magasin_dest	ECRITURE
ASSISTANTE	RECEPTIONS	fournisseur_nom	ECRITURE
ASSISTANTE	RECEPTIONS	numero_bc	ECRITURE
ASSISTANTE	RECEPTIONS	numero_facture	ECRITURE
ASSISTANTE	RECEPTIONS	transporteur	ECRITURE
ASSISTANTE	RECEPTIONS	nombre_colis	ECRITURE
ASSISTANTE	RECEPTIONS	poids_total_brut_kg	ECRITURE
ASSISTANTE	RECEPTIONS	statut	ECRITURE
ASSISTANTE	RECEPTIONS	nb_lignes	ECRITURE
ASSISTANTE	RECEPTIONS	receptionnaire	ECRITURE
ASSISTANTE	RECEPTIONS	controleur	ECRITURE
ASSISTANTE	RECEPTIONS	date_controle	ECRITURE
ASSISTANTE	RECEPTIONS	quantite_bl_kg	ECRITURE
ASSISTANTE	RECEPTIONS	ecart_bl_kg	ECRITURE
ASSISTANTE	RECEPTIONS	ecart_cmd_kg	ECRITURE
ASSISTANTE	RECEPTIONS	nb_colis_ligne	ECRITURE
ASSISTANTE	RECEPTIONS	poids_moyen_colis_kg	ECRITURE
ASSISTANTE	RECEPTIONS	date_fabrication	ECRITURE
ASSISTANTE	RECEPTIONS	notes	ECRITURE
ASSISTANTE	RECEPTIONS	delai_reel_jours	ECRITURE
ASSISTANTE	RECEPTIONS	delai_prevu_jours	ECRITURE
ASSISTANTE	RECEPTIONS	retard_jours	ECRITURE
ASSISTANTE	RECEPTIONS	on_time	ECRITURE
ASSISTANTE	RECEPTIONS	in_full	ECRITURE
ASSISTANTE	RECEPTIONS	in_spec	ECRITURE
ASSISTANTE	RECEPTIONS	substitution_acceptee	ECRITURE
ASSISTANTE	RECEPTIONS	motif_substitution	ECRITURE
ASSISTANTE	RECEPTIONS	reference_commandee	ECRITURE
ASSISTANTE	RECEPTIONS	est_substitution	ECRITURE
ASSISTANTE	RECEPTIONS	equivalents_recevables	ECRITURE
ASSISTANTE	BONS_COMMANDE	numero_bc	ECRITURE
ASSISTANTE	BONS_COMMANDE	date_bc	ECRITURE
ASSISTANTE	BONS_COMMANDE	code_fournisseur	ECRITURE
ASSISTANTE	BONS_COMMANDE	statut	ECRITURE
ASSISTANTE	BONS_COMMANDE	code_devise	ECRITURE
ASSISTANTE	BONS_COMMANDE	taux_change_engage	ECRITURE
ASSISTANTE	BONS_COMMANDE	montant_total_devise	ECRITURE
ASSISTANTE	BONS_COMMANDE	montant_total_mad	ECRITURE
ASSISTANTE	BONS_COMMANDE	code_reference	ECRITURE
ASSISTANTE	BONS_COMMANDE	unite_commande	ECRITURE
ASSISTANTE	BONS_COMMANDE	quantite_commandee_unite	ECRITURE
ASSISTANTE	BONS_COMMANDE	quantite_commandee_kg	ECRITURE
ASSISTANTE	BONS_COMMANDE	quantite_recue_kg	ECRITURE
ASSISTANTE	BONS_COMMANDE	prix_unitaire_devise	ECRITURE
ASSISTANTE	BONS_COMMANDE	total_ligne_devise	ECRITURE
ASSISTANTE	BONS_COMMANDE	date_livraison_prevue	ECRITURE
ASSISTANTE	BONS_COMMANDE	besoin_kg_origine	ECRITURE
ASSISTANTE	BONS_COMMANDE	besoin_kg_actuel	ECRITURE
ASSISTANTE	BONS_COMMANDE	ecart_besoin_kg	ECRITURE
ASSISTANTE	BONS_COMMANDE	arbitree	ECRITURE
ASSISTANTE	BONS_COMMANDE	fournisseur_nom	ECRITURE
ASSISTANTE	BONS_COMMANDE	devise_fournisseur	ECRITURE
ASSISTANTE	BONS_COMMANDE	nb_lignes	ECRITURE
ASSISTANTE	BONS_COMMANDE	date_envoi	ECRITURE
ASSISTANTE	BONS_COMMANDE	date_validation	ECRITURE
ASSISTANTE	BONS_COMMANDE	createur	ECRITURE
ASSISTANTE	BONS_COMMANDE	valideur	ECRITURE
ASSISTANTE	BONS_COMMANDE	motif_creation	ECRITURE
ASSISTANTE	BONS_COMMANDE	conditions_paiement	ECRITURE
ASSISTANTE	BONS_COMMANDE	notes	ECRITURE
ASSISTANTE	BONS_COMMANDE	quantite_recue_kg_bc	ECRITURE
ASSISTANTE	BONS_COMMANDE	reste_a_livrer_kg	ECRITURE
ASSISTANTE	BONS_COMMANDE	pct_livre	ECRITURE
ASSISTANTE	BONS_COMMANDE	statut_livraison	ECRITURE
ASSISTANTE	BONS_COMMANDE	equivalent_de	ECRITURE
ASSISTANTE	BONS_COMMANDE	besoin_equivalent_kg	ECRITURE
ASSISTANTE	BONS_COMMANDE	nb_equivalents	ECRITURE
ASSISTANTE	BONS_COMMANDE	statut_ligne	ECRITURE
ASSISTANTE	PLAN_ACHAT	fournisseur_nom	ECRITURE
ASSISTANTE	PLAN_ACHAT	unite_saisie	ECRITURE
ASSISTANTE	PLAN_ACHAT	risque_identifie	ECRITURE
ASSISTANTE	PLAN_ACHAT	action_recommandee	ECRITURE
ASSISTANTE	PLAN_ACHAT	commentaires	ECRITURE
ASSISTANTE	PLAN_ACHAT	date_generation	ECRITURE
ASSISTANTE	CATALOGUE	date_achat	ECRITURE
ASSISTANTE	CATALOGUE	prix_kg_devise	MASQUE
ASSISTANTE	CATALOGUE	prix_precedent_mad	MASQUE
ASSISTANTE	CATALOGUE	quantite_achetee_kg	ECRITURE
ASSISTANTE	CATALOGUE	total_mad	MASQUE
ASSISTANTE	CATALOGUE	numero_bc	ECRITURE
ASSISTANTE	CATALOGUE	numero_reception	ECRITURE
ASSISTANTE	PLAN_ACHAT	id_proposition	ECRITURE
ASSISTANTE	PLAN_ACHAT	code_reference	ECRITURE
ASSISTANTE	PLAN_ACHAT	quantite_suggeree_kg	ECRITURE
ASSISTANTE	PLAN_ACHAT	quantite_suggeree_unite	ECRITURE
ASSISTANTE	PLAN_ACHAT	urgence	ECRITURE
ASSISTANTE	PLAN_ACHAT	date_besoin_prevue	ECRITURE
ASSISTANTE	PLAN_ACHAT	montant_total_mad	ECRITURE
ASSISTANTE	PLAN_ACHAT	numero_bc	ECRITURE
ASSISTANTE	PLAN_ACHAT	statut_bc	ECRITURE
ASSISTANTE	PLAN_ACHAT	designation	ECRITURE
ASSISTANTE	PLAN_ACHAT	code_fournisseur	ECRITURE
ASSISTANTE	PLAN_ACHAT	statut	ECRITURE
ASSISTANTE	PLAN_ACHAT	stock_projete_kg	ECRITURE
ASSISTANTE	PLAN_ACHAT	stock_min_kg	ECRITURE
ASSISTANTE	PLAN_ACHAT	qte_a_commander_kg	ECRITURE
ASSISTANTE	PLAN_ACHAT	prix_estime_mad	ECRITURE
ASSISTANTE	PLAN_ACHAT	source_prix	ECRITURE
ASSISTANTE	PLAN_ACHAT	montant_estime_mad	ECRITURE
ASSISTANTE	PLAN_ACHAT	tier	ECRITURE
ASSISTANTE	PLAN_ACHAT	risque_sourcing	ECRITURE
ASSISTANTE	PLAN_ACHAT	jours_couverture	ECRITURE
ASSISTANTE	PLAN_ACHAT	code_reference_origine	ECRITURE
ASSISTANTE	PLAN_ACHAT	designation_origine	ECRITURE
ASSISTANTE	PLAN_ACHAT	motif_substitution	ECRITURE
ASSISTANTE	PLAN_ACHAT	nb_equivalents	ECRITURE
ASSISTANTE	PLAN_ACHAT	equivalent_dispo_kg	ECRITURE
ASSISTANTE	QUALITES	code_qualite	ECRITURE
ASSISTANTE	QUALITES	nom	ECRITURE
ASSISTANTE	QUALITES	description	ECRITURE
ASSISTANTE	QUALITES	statut	ECRITURE
ASSISTANTE	QUALITES	poids_commercial_m2	ECRITURE
ASSISTANTE	QUALITES	code_role	ECRITURE
ASSISTANTE	QUALITES	role_libelle	ECRITURE
ASSISTANTE	QUALITES	densite	ECRITURE
ASSISTANTE	QUALITES	unite_densite	ECRITURE
ASSISTANTE	QUALITES	entre_poids_commercial	ECRITURE
ASSISTANTE	QUALITES	code_reference	ECRITURE
ASSISTANTE	QUALITES	designation	ECRITURE
ASSISTANTE	QUALITES	pourcentage_composition	ECRITURE
ASSISTANTE	QUALITES	couleur	ECRITURE
ASSISTANTE	QUALITES	code_groupe_equiv	ECRITURE
ASSISTANTE	QUALITES	code_fournisseur_prefere	ECRITURE
ASSISTANTE	QUALITES	ligne_numero	ECRITURE
ASSISTANTE	QUALITES	kg_m2	ECRITURE
ASSISTANTE	QUALITES	type_fil	ECRITURE
ASSISTANTE	QUALITES	categorie	ECRITURE
ASSISTANTE	QUALITES	fournisseur	ECRITURE
ASSISTANTE	QUALITES	prix_kg_mad	MASQUE
ASSISTANTE	QUALITES	code_devise_catalogue	MASQUE
ASSISTANTE	QUALITES	cout_m2_mad	MASQUE
ASSISTANTE	QUALITES	source_prix	MASQUE
ASSISTANTE	QUALITES	marge_securite_pct	ECRITURE
ASSISTANTE	QUALITES	couv_min_mois	ECRITURE
ASSISTANTE	QUALITES	taux_perte_pct	ECRITURE
ASSISTANTE	QUALITES	seuil_alerte_jours	ECRITURE
ASSISTANTE	QUALITES	seuil_critique_jours	ECRITURE
ASSISTANTE	QUALITES	stock_securite_jours	ECRITURE
ASSISTANTE	QUALITES	actif	ECRITURE
ASSISTANTE	QUALITES	nb_roles	ECRITURE
ASSISTANTE	QUALITES	nb_composition	ECRITURE
ASSISTANTE	QUALITES	nb_roles_composes	ECRITURE
ASSISTANTE	QUALITES	nb_roles_hors_100	ECRITURE
ASSISTANTE	QUALITES	nb_lignes_plan	ECRITURE
ASSISTANTE	QUALITES	date_creation	ECRITURE
ASSISTANTE	QUALITES	cree_par	ECRITURE
ASSISTANTE	QUALITES	date_modification	ECRITURE
ASSISTANTE	QUALITES	modifie_par	ECRITURE
ASSISTANTE	QUALITES	date_cloture	ECRITURE
ASSISTANTE	RECETTES	code_qualite	ECRITURE
ASSISTANTE	RECETTES	qualite_nom	ECRITURE
ASSISTANTE	RECETTES	ligne_numero	ECRITURE
ASSISTANTE	RECETTES	code_reference	ECRITURE
ASSISTANTE	RECETTES	designation	ECRITURE
ASSISTANTE	RECETTES	code_role	ECRITURE
ASSISTANTE	RECETTES	role_libelle	ECRITURE
ASSISTANTE	RECETTES	pourcentage_composition	ECRITURE
ASSISTANTE	RECETTES	couleur	ECRITURE
ASSISTANTE	RECETTES	densite_role	ECRITURE
ASSISTANTE	RECETTES	unite_densite	ECRITURE
ASSISTANTE	RECETTES	kg_m2	ECRITURE
ASSISTANTE	RECETTES	code_groupe_equiv	ECRITURE
ASSISTANTE	RECETTES	statut_qualite	ECRITURE
ASSISTANTE	RECETTES	code_fournisseur	ECRITURE
ASSISTANTE	RECETTES	fournisseur	ECRITURE
ASSISTANTE	RECETTES	code_fournisseur_prefere	ECRITURE
ASSISTANTE	PLANS	annee	ECRITURE
ASSISTANTE	PLANS	numero_version	ECRITURE
ASSISTANTE	PLANS	libelle	ECRITURE
ASSISTANTE	PLANS	scenario_nom	ECRITURE
ASSISTANTE	PLANS	statut	ECRITURE
ASSISTANTE	PLANS	actif	ECRITURE
ASSISTANTE	PLANS	date_debut	ECRITURE
ASSISTANTE	PLANS	date_fin	ECRITURE
ASSISTANTE	PLANS	mois_horizon	ECRITURE
ASSISTANTE	PLANS	croissance_annuelle_pct	ECRITURE
ASSISTANTE	PLANS	mois	ECRITURE
ASSISTANTE	PLANS	rang_mois	ECRITURE
ASSISTANTE	PLANS	annee_mois	ECRITURE
ASSISTANTE	PLANS	code_qualite	ECRITURE
ASSISTANTE	PLANS	qualite_nom	ECRITURE
ASSISTANTE	PLANS	m2_base_mensuel	ECRITURE
ASSISTANTE	PLANS	m2_prevus	ECRITURE
ASSISTANTE	PLANS	saisonnalite	ECRITURE
ASSISTANTE	PLANS	coefficient	ECRITURE
ASSISTANTE	PLANS	facteur_croissance	ECRITURE
ASSISTANTE	PLANS	m2_realises	ECRITURE
ASSISTANTE	PLANS	taux_perte_pct	ECRITURE
ASSISTANTE	PLANS	m2_total_annuel	ECRITURE
ASSISTANTE	PLANS	m2_total	ECRITURE
ASSISTANTE	PLANS	nb_lignes	ECRITURE
ASSISTANTE	PLANS	nb_qualites	ECRITURE
ASSISTANTE	PLANS	nb_qualites_perimees	ECRITURE
ASSISTANTE	PLANS	nb_besoins	ECRITURE
ASSISTANTE	PLANS	date_creation	ECRITURE
ASSISTANTE	PLANS	cree_par	ECRITURE
ASSISTANTE	PLANS	date_modification	ECRITURE
ASSISTANTE	PLANS	modifie_par	ECRITURE
ASSISTANTE	PLANS	date_validation	ECRITURE
ASSISTANTE	PLANS	valide_par	ECRITURE
ASSISTANTE	PLANS	date_cloture	ECRITURE
ASSISTANTE	PLANS	cloture_par	ECRITURE
ASSISTANTE	MRP	code_reference	ECRITURE
ASSISTANTE	MRP	designation	ECRITURE
ASSISTANTE	MRP	mois	ECRITURE
ASSISTANTE	MRP	quantite_brute_kg	ECRITURE
ASSISTANTE	MRP	taux_perte_applique	ECRITURE
ASSISTANTE	MRP	quantite_kg	ECRITURE
ASSISTANTE	MRP	code_fournisseur	ECRITURE
ASSISTANTE	INVENTAIRE	numero_inventaire	ECRITURE
ASSISTANTE	INVENTAIRE	date_inventaire	ECRITURE
ASSISTANTE	INVENTAIRE	type_inventaire	ECRITURE
ASSISTANTE	INVENTAIRE	code_magasin	ECRITURE
ASSISTANTE	INVENTAIRE	statut	ECRITURE
ASSISTANTE	INVENTAIRE	code_reference	ECRITURE
ASSISTANTE	INVENTAIRE	quantite_theorique_kg	ECRITURE
ASSISTANTE	INVENTAIRE	quantite_comptee_kg	ECRITURE
ASSISTANTE	INVENTAIRE	ecart_kg	ECRITURE
ASSISTANTE	INVENTAIRE	ecart_pct	ECRITURE
ASSISTANTE	INVENTAIRE	ecart_mad	MASQUE
ASSISTANTE	INVENTAIRE	motif_ecart	ECRITURE
ASSISTANTE	VALORISATION	code_reference	MASQUE
ASSISTANTE	VALORISATION	code_magasin	MASQUE
ASSISTANTE	VALORISATION	quantite_kg	MASQUE
ASSISTANTE	VALORISATION	cmup_mad	MASQUE
ASSISTANTE	VALORISATION	valeur_mad	MASQUE
ASSISTANTE	COCKPIT	nb_ruptures	MASQUE
ASSISTANTE	COCKPIT	nb_critiques	MASQUE
ASSISTANTE	COCKPIT	nb_attention	MASQUE
ASSISTANTE	COCKPIT	nb_ok	MASQUE
ASSISTANTE	COCKPIT	nb_references	MASQUE
ASSISTANTE	COCKPIT	valeur_stock_mad	MASQUE
ASSISTANTE	COCKPIT	nb_refs_a_commander	MASQUE
ASSISTANTE	COCKPIT	budget_a_engager_mad	MASQUE
ASSISTANTE	COCKPIT	nb_classe_a_alerte	MASQUE
ASSISTANTE	COCKPIT	nb_tier1	MASQUE
ASSISTANTE	COCKPIT	nb_fournisseurs_actifs	MASQUE
ASSISTANTE	COCKPIT	nb_bc_ouverts	MASQUE
ASSISTANTE	COCKPIT	montant_bc_ouverts_mad	MASQUE
ASSISTANTE	COCKPIT	nb_alertes_critiques	MASQUE
ASSISTANTE	COCKPIT	nb_propositions_a_traiter	MASQUE
ASSISTANTE	COCKPIT	nb_bc_en_preparation	MASQUE
ASSISTANTE	COCKPIT	nb_bc_a_valider	MASQUE
ASSISTANTE	COCKPIT	montant_bc_a_valider_mad	MASQUE
ASSISTANTE	COCKPIT	nb_bc_a_envoyer	MASQUE
ASSISTANTE	COCKPIT	nb_livraisons_en_retard	MASQUE
ASSISTANTE	COCKPIT	retard_max_jours	MASQUE
ASSISTANTE	COCKPIT	nb_receptions_en_saisie	MASQUE
ASSISTANTE	COCKPIT	nb_receptions_a_controler	MASQUE
ASSISTANTE	COCKPIT	nb_lignes_non_conformes	MASQUE
ASSISTANTE	COCKPIT	nb_receptions_a_regulariser	MASQUE
ASSISTANTE	COCKPIT	nb_refs_sous_minimum	MASQUE
ASSISTANTE	COCKPIT	nb_refs_dormantes	MASQUE
ASSISTANTE	COCKPIT	valeur_dormante_mad	MASQUE
ASSISTANTE	FOURNISSEURS	nb_references	ECRITURE
ASSISTANTE	COCKPIT	nb_lots_peremption_proche	MASQUE
ASSISTANTE	COCKPIT	nb_controles_bloquants	MASQUE
ASSISTANTE	COCKPIT	nb_controles_critiques	MASQUE
ASSISTANTE	COCKPIT	nb_alertes_ouvertes	MASQUE
ASSISTANTE	COCKPIT	code_reference	MASQUE
ASSISTANTE	COCKPIT	designation	MASQUE
ASSISTANTE	COCKPIT	classe_abc	MASQUE
ASSISTANTE	COCKPIT	code_fournisseur	MASQUE
ASSISTANTE	COCKPIT	fournisseur_nom	MASQUE
ASSISTANTE	COCKPIT	delai_livraison_jours	MASQUE
ASSISTANTE	COCKPIT	risque_sourcing	MASQUE
ASSISTANTE	COCKPIT	stock_min_kg	MASQUE
ASSISTANTE	COCKPIT	stock_initial_kg	MASQUE
ASSISTANTE	COCKPIT	nb_mois_rupture	MASQUE
ASSISTANTE	COCKPIT	nb_mois_tendu	MASQUE
ASSISTANTE	COCKPIT	premier_mois_rupture	MASQUE
ASSISTANTE	COCKPIT	premier_mois_risque	MASQUE
ASSISTANTE	COCKPIT	rang_premier_risque	MASQUE
ASSISTANTE	COCKPIT	marge_decision_jours	MASQUE
ASSISTANTE	COCKPIT	mois	MASQUE
ASSISTANTE	COCKPIT	annee_mois	MASQUE
ASSISTANTE	COCKPIT	rang_mois	MASQUE
ASSISTANTE	COCKPIT	besoin_kg	MASQUE
ASSISTANTE	COCKPIT	entrees_kg	MASQUE
ASSISTANTE	COCKPIT	stock_fin_kg	MASQUE
ASSISTANTE	COCKPIT	statut	MASQUE
ASSISTANTE	MOUVEMENTS	annee_mois	ECRITURE
ASSISTANTE	MOUVEMENTS	type_libelle	ECRITURE
ASSISTANTE	MOUVEMENTS	signe	ECRITURE
ASSISTANTE	MOUVEMENTS	couleur	ECRITURE
ASSISTANTE	MOUVEMENTS	nb_mouvements	ECRITURE
ASSISTANTE	MOUVEMENTS	nb_lignes	ECRITURE
ASSISTANTE	MOUVEMENTS	nb_references	ECRITURE
ASSISTANTE	MOUVEMENTS	valeur_mad	MASQUE
ASSISTANTE	MOUVEMENTS	designation	ECRITURE
ASSISTANTE	MOUVEMENTS	classe_abc	ECRITURE
ASSISTANTE	MOUVEMENTS	entrees_kg	ECRITURE
ASSISTANTE	MOUVEMENTS	sorties_kg	ECRITURE
ASSISTANTE	MOUVEMENTS	solde_kg	ECRITURE
ASSISTANTE	MOUVEMENTS	nb_mois_actifs	ECRITURE
ASSISTANTE	MOUVEMENTS	premier_mouvement	ECRITURE
ASSISTANTE	MOUVEMENTS	dernier_mouvement	ECRITURE
ASSISTANTE	MOUVEMENTS	stock_actuel_kg	ECRITURE
ASSISTANTE	MOUVEMENTS	rotation	ECRITURE
ASSISTANTE	MOUVEMENTS	jours_sans_mouvement	ECRITURE
ASSISTANTE	VALORISATION	designation	MASQUE
ASSISTANTE	VALORISATION	annee_mois	MASQUE
ASSISTANTE	VALORISATION	code_devise	MASQUE
ASSISTANTE	VALORISATION	nb_achats	MASQUE
ASSISTANTE	VALORISATION	nb_fournisseurs	MASQUE
ASSISTANTE	VALORISATION	prix_moyen_devise	MASQUE
ASSISTANTE	VALORISATION	prix_moyen_mad	MASQUE
ASSISTANTE	VALORISATION	taux_moyen	MASQUE
ASSISTANTE	VALORISATION	prix_min_mad	MASQUE
ASSISTANTE	VALORISATION	prix_max_mad	MASQUE
ASSISTANTE	VALORISATION	classe_abc	MASQUE
ASSISTANTE	VALORISATION	quantite_totale_kg	MASQUE
ASSISTANTE	VALORISATION	montant_total_mad	MASQUE
ASSISTANTE	VALORISATION	premier_achat	MASQUE
ASSISTANTE	VALORISATION	dernier_achat	MASQUE
ASSISTANTE	VALORISATION	premier_prix_mad	MASQUE
ASSISTANTE	VALORISATION	dernier_prix_mad	MASQUE
ASSISTANTE	VALORISATION	premier_prix_devise	MASQUE
ASSISTANTE	VALORISATION	dernier_prix_devise	MASQUE
ASSISTANTE	VALORISATION	premier_taux	MASQUE
ASSISTANTE	VALORISATION	dernier_taux	MASQUE
ASSISTANTE	VALORISATION	derive_totale_pct	MASQUE
ASSISTANTE	VALORISATION	derive_fournisseur_pct	MASQUE
ASSISTANTE	VALORISATION	derive_change_pct	MASQUE
ASSISTANTE	VALORISATION	impact_fournisseur_mad	MASQUE
ASSISTANTE	FOURNISSEURS	fournisseur_nom	ECRITURE
ASSISTANTE	FOURNISSEURS	annee_mois	ECRITURE
ASSISTANTE	FOURNISSEURS	nb_receptions	ECRITURE
ASSISTANTE	FOURNISSEURS	nb_lignes	ECRITURE
ASSISTANTE	FOURNISSEURS	quantite_kg	ECRITURE
ASSISTANTE	FOURNISSEURS	montant_mad	MASQUE
ASSISTANTE	FOURNISSEURS	taux_conformite_pct	ECRITURE
ASSISTANTE	FOURNISSEURS	nb_a_lheure	ECRITURE
ASSISTANTE	FOURNISSEURS	nb_mesurables	ECRITURE
ASSISTANTE	FOURNISSEURS	retard_moyen_jours	ECRITURE
ASSISTANTE	FOURNISSEURS	delai_reel_moyen_jours	ECRITURE
ASSISTANTE	FOURNISSEURS	nb_bc	ECRITURE
ASSISTANTE	FOURNISSEURS	montant_total_mad	MASQUE
ASSISTANTE	FOURNISSEURS	nb_lignes_recues	ECRITURE
ASSISTANTE	FOURNISSEURS	taux_ponctualite_pct	ECRITURE
ASSISTANTE	FOURNISSEURS	ecart_pesee_moyen_pct	ECRITURE
ASSISTANTE	FOURNISSEURS	otif_pct	ECRITURE
ASSISTANTE	FOURNISSEURS	classement	ECRITURE
ASSISTANTE	QUALITES	qualite_nom	ECRITURE
ASSISTANTE	QUALITES	nb_composants	ECRITURE
ASSISTANTE	QUALITES	nb_sans_cmup	ECRITURE
ASSISTANTE	QUALITES	kg_m2_total	ECRITURE
ASSISTANTE	QUALITES	cout_matiere_m2_mad	MASQUE
ASSISTANTE	QUALITES	ecart_poids_pct	ECRITURE
ASSISTANTE	QUALITES	m2_prevus	ECRITURE
ASSISTANTE	QUALITES	m2_realises	ECRITURE
ASSISTANTE	QUALITES	nb_mois_planifies	ECRITURE
ASSISTANTE	QUALITES	taux_realisation_pct	ECRITURE
ASSISTANTE	QUALITES	cout_matiere_plan_mad	MASQUE
ASSISTANTE	QUALITES	somme_pct	ECRITURE
ASSISTANTE	CATALOGUE	code_groupe_equiv	ECRITURE
ASSISTANTE	CATALOGUE	groupe_libelle	ECRITURE
ASSISTANTE	CATALOGUE	priorite	ECRITURE
ASSISTANTE	CATALOGUE	est_preferentielle	ECRITURE
ASSISTANTE	CATALOGUE	stock_kg	ECRITURE
ASSISTANTE	CATALOGUE	stock_projete_kg	ECRITURE
ASSISTANTE	CATALOGUE	statut	ECRITURE
ASSISTANTE	CATALOGUE	besoin_12m_kg	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_reference	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_designation	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_fournisseur	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_fournisseur_nom	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_delai_jours	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_priorite	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_preferentielle	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_unite	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_prix_catalogue_kg	MASQUE
ASSISTANTE	CATALOGUE	equivalent_devise	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_stock_kg	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_stock_projete_kg	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_statut	ECRITURE
ASSISTANTE	CATALOGUE	equivalent_besoin_12m_kg	ECRITURE
ASSISTANTE	CATALOGUE	meme_fournisseur	ECRITURE
ASSISTANTE	CATALOGUE	interchangeable	ECRITURE
ASSISTANTE	CATALOGUE	libelle	ECRITURE
ASSISTANTE	CATALOGUE	description	ECRITURE
ASSISTANTE	CATALOGUE	nb_references	ECRITURE
ASSISTANTE	CATALOGUE	nb_fournisseurs	ECRITURE
ASSISTANTE	CATALOGUE	nb_unites	ECRITURE
ASSISTANTE	CATALOGUE	nb_densites	ECRITURE
ASSISTANTE	CATALOGUE	nb_categories	ECRITURE
ASSISTANTE	CATALOGUE	nb_preferentielles	ECRITURE
ASSISTANTE	CATALOGUE	nb_avec_stock	ECRITURE
ASSISTANTE	CATALOGUE	nb_avec_besoin	ECRITURE
ASSISTANTE	CATALOGUE	stock_cumule_kg	ECRITURE
ASSISTANTE	CATALOGUE	besoin_cumule_kg	ECRITURE
ASSISTANTE	CATALOGUE	qualification	ECRITURE
ASSISTANTE	CATALOGUE	ordre_affichage	ECRITURE
ASSISTANTE	CATALOGUE	code_role	ECRITURE
ASSISTANTE	MOUVEMENTS	actif	ECRITURE
ASSISTANTE	MOUVEMENTS	exige_motif_ligne	ECRITURE
ASSISTANTE	MOUVEMENTS	exige_of	ECRITURE
ASSISTANTE	MOUVEMENTS	exige_prix	MASQUE
ASSISTANTE	MOUVEMENTS	impacte_cmup	ECRITURE
ASSISTANTE	MOUVEMENTS	libelle	ECRITURE
ASSISTANTE	MOUVEMENTS	categorie	ECRITURE
ASSISTANTE	MOUVEMENTS	signe_default	ECRITURE
ASSISTANTE	MOUVEMENTS	code_motif_ligne	ECRITURE
ASSISTANTE	STOCK	actif	ECRITURE
ASSISTANTE	STOCK	adresse	ECRITURE
ASSISTANTE	STOCK	est_quarantaine	ECRITURE
ASSISTANTE	STOCK	inclure_mrp	ECRITURE
ASSISTANTE	STOCK	nom	ECRITURE
ASSISTANTE	STOCK	responsable	ECRITURE
ASSISTANTE	STOCK	type	ECRITURE
ASSISTANTE	FOURNISSEURS	adresse	ECRITURE
ASSISTANTE	FOURNISSEURS	date_creation	ECRITURE
ASSISTANTE	FOURNISSEURS	incoterm	ECRITURE
ASSISTANTE	FOURNISSEURS	transporteur	ECRITURE
ASSISTANTE	CATALOGUE	date_creation	ECRITURE
ASSISTANTE	CATALOGUE	date_dernier_abc	ECRITURE
ASSISTANTE	CATALOGUE	date_dernier_cmup	ECRITURE
ASSISTANTE	CATALOGUE	date_prix_catalogue	MASQUE
ASSISTANTE	CATALOGUE	date_debut	ECRITURE
ASSISTANTE	CATALOGUE	date_fin	ECRITURE
ASSISTANTE	MOUVEMENTS	numero_transfert	ECRITURE
ASSISTANTE	MOUVEMENTS	date_transfert	ECRITURE
ASSISTANTE	MOUVEMENTS	statut	ECRITURE
ASSISTANTE	MOUVEMENTS	code_magasin_source	ECRITURE
ASSISTANTE	MOUVEMENTS	code_magasin_dest	ECRITURE
ASSISTANTE	MOUVEMENTS	magasin_source_nom	ECRITURE
ASSISTANTE	MOUVEMENTS	magasin_dest_nom	ECRITURE
ASSISTANTE	MOUVEMENTS	date_sortie	ECRITURE
ASSISTANTE	MOUVEMENTS	date_reception_dest	ECRITURE
ASSISTANTE	MOUVEMENTS	responsable	ECRITURE
ASSISTANTE	MOUVEMENTS	transporteur	ECRITURE
ASSISTANTE	MOUVEMENTS	observations	ECRITURE
ASSISTANTE	MOUVEMENTS	auteur	ECRITURE
ASSISTANTE	MOUVEMENTS	expediteur	ECRITURE
ASSISTANTE	MOUVEMENTS	receptionnaire	ECRITURE
ASSISTANTE	MOUVEMENTS	jours_en_transit	ECRITURE
ASSISTANTE	MOUVEMENTS	ligne_numero	ECRITURE
ASSISTANTE	MOUVEMENTS	quantite_saisie	ECRITURE
ASSISTANTE	MOUVEMENTS	unite_saisie	ECRITURE
ASSISTANTE	MOUVEMENTS	nb_bobines	ECRITURE
ASSISTANTE	MOUVEMENTS	nb_palettes	ECRITURE
ASSISTANTE	MOUVEMENTS	quantite_totale_kg	ECRITURE
ASSISTANTE	MOUVEMENTS	bobines_totales	ECRITURE
ASSISTANTE	MOUVEMENTS	palettes_totales	ECRITURE
ASSISTANTE	MOUVEMENTS	valeur_totale_mad	MASQUE
ASSISTANTE	MOUVEMENTS	magasin_nom	ECRITURE
ASSISTANTE	MOUVEMENTS	motif_libelle	ECRITURE
ASSISTANTE	MOUVEMENTS	reference_document	ECRITURE
ASSISTANTE	MOUVEMENTS	observations_globales	ECRITURE
ASSISTANTE	MOUVEMENTS	date_creation	ECRITURE
ASSISTANTE	MOUVEMENTS	jours_de_retard_saisie	ECRITURE
ASSISTANTE	MOUVEMENTS	saisi_par	ECRITURE
ASSISTANTE	MOUVEMENTS	rebut_kg	ECRITURE
ASSISTANTE	MOUVEMENTS	motif_ligne_libelle	ECRITURE
ASSISTANTE	MOUVEMENTS	est_initial	ECRITURE
ASSISTANTE	MOUVEMENTS	date_fabrication	ECRITURE
ASSISTANTE	MOUVEMENTS	statut_qualite	ECRITURE
ASSISTANTE	MOUVEMENTS	facteur_conversion	ECRITURE
ASSISTANTE	PLAN_ACHAT	figee	ECRITURE
ASSISTANTE	PLAN_ACHAT	figee_par	ECRITURE
ASSISTANTE	PLAN_ACHAT	date_figement	ECRITURE
ASSISTANTE	PLAN_ACHAT	motif_figement	ECRITURE
ASSISTANTE	PLAN_ACHAT	quantite_mrp_kg	ECRITURE
ASSISTANTE	PLAN_ACHAT	quantite_calculee_kg	ECRITURE
ASSISTANTE	PLAN_ACHAT	ecart_calcul_kg	ECRITURE
ASSISTANTE	PLAN_ACHAT	etat_figement	ECRITURE
ASSISTANTE	PARAMETRES	fichier	ECRITURE
ASSISTANTE	PARAMETRES	plateforme	ECRITURE
ASSISTANTE	PARAMETRES	version	ECRITURE
ASSISTANTE	PARAMETRES	taille_octets	ECRITURE
ASSISTANTE	PARAMETRES	date_telechargement	ECRITURE
ASSISTANTE	PARAMETRES	utilisateur	ECRITURE
ASSISTANTE	PARAMETRES	adresse_ip	ECRITURE
ASSISTANTE	PARAMETRES	disponible	ECRITURE
ASSISTANTE	PARAMETRES	nb_telechargements	ECRITURE
ASSISTANTE	PARAMETRES	code_parametre	ECRITURE
ASSISTANTE	PARAMETRES	libelle	ECRITURE
ASSISTANTE	PARAMETRES	valeur_courante	ECRITURE
ASSISTANTE	PARAMETRES	unite	ECRITURE
ASSISTANTE	PARAMETRES	categorie	ECRITURE
ASSISTANTE	PARAMETRES	verrouille	ECRITURE
ASSISTANTE	AUDIT	date_operation	MASQUE
ASSISTANTE	AUDIT	table_concernee	MASQUE
ASSISTANTE	AUDIT	operation	MASQUE
ASSISTANTE	AUDIT	auteur	MASQUE
ASSISTANTE	AUDIT	anciennes_valeurs	MASQUE
ASSISTANTE	AUDIT	nouvelles_valeurs	MASQUE
ASSISTANTE	AUDIT	adresse_ip	MASQUE
ASSISTANTE	UTILISATEURS	login	MASQUE
ASSISTANTE	UTILISATEURS	nom	MASQUE
ASSISTANTE	UTILISATEURS	code_role_user	MASQUE
ASSISTANTE	UTILISATEURS	email	MASQUE
ASSISTANTE	UTILISATEURS	telephone	MASQUE
ASSISTANTE	UTILISATEURS	magasin_principal	MASQUE
ASSISTANTE	UTILISATEURS	derniere_connexion	MASQUE
ASSISTANTE	UTILISATEURS	actif	MASQUE
ASSISTANTE	CATALOGUE	prix_moyen_mad	MASQUE
ASSISTANTE	CATALOGUE	annee_mois	ECRITURE
ASSISTANTE	CATALOGUE	quantite_kg	ECRITURE
ASSISTANTE	CATALOGUE	nb_achats	ECRITURE
ASSISTANTE	STOCK	valeur_conso_annuelle_mad	MASQUE
ASSISTANTE	STOCK	part_pct	MASQUE
ASSISTANTE	STOCK	pct_cumule	MASQUE
ASSISTANTE	STOCK	rang	ECRITURE
ASSISTANTE	STOCK	politique	ECRITURE
ASSISTANTE	STOCK	date_dernier_abc	ECRITURE
ASSISTANTE	VALORISATION	prix_achat_mad_kg	MASQUE
ASSISTANTE	VALORISATION	frais_approche_mad	MASQUE
ASSISTANTE	VALORISATION	frais_mad_kg	MASQUE
ASSISTANTE	VALORISATION	cout_revient_mad_kg	MASQUE
ASSISTANTE	VALORISATION	part_frais_pct	MASQUE
ASSISTANTE	VALORISATION	montant_devise	MASQUE
ASSISTANTE	VALORISATION	montant_mad	MASQUE
ASSISTANTE	VALORISATION	type_frais	MASQUE
ASSISTANTE	VALORISATION	cle_repartition	MASQUE
ASSISTANTE	VALORISATION	reference_externe	MASQUE
ASSISTANTE	STOCK	stock_global_kg	ECRITURE
ASSISTANTE	STOCK	magasins_kg	ECRITURE
ASSISTANTE	STOCK	machines_kg	ECRITURE
ASSISTANTE	STOCK	machines_bobines	ECRITURE
ASSISTANTE	STOCK	nb_machines	ECRITURE
ASSISTANTE	STOCK	par_magasin	ECRITURE
ASSISTANTE	STOCK	a_commander_kg	ECRITURE
ASSISTANTE	STOCK	prix_catalogue_kg	MASQUE
ASSISTANTE	STOCK	jours_sans_mouvement	ECRITURE
ASSISTANTE	STOCK	derniere_sortie	ECRITURE
ASSISTANTE	STOCK	nb_equivalents	ECRITURE
DIRECTION	IMPORT	numero	LECTURE
MAGASIN	IMPORT	numero	MASQUE
ASSISTANTE	IMPORT	numero	LECTURE
DIRECTION	IMPORT	statut	LECTURE
MAGASIN	IMPORT	statut	MASQUE
ASSISTANTE	IMPORT	statut	LECTURE
DIRECTION	IMPORT	fournisseurs	LECTURE
MAGASIN	IMPORT	fournisseurs	MASQUE
ASSISTANTE	IMPORT	fournisseurs	LECTURE
DIRECTION	IMPORT	nb_factures	LECTURE
MAGASIN	IMPORT	nb_factures	MASQUE
ASSISTANTE	IMPORT	nb_factures	LECTURE
DIRECTION	IMPORT	date_arrivee	LECTURE
MAGASIN	IMPORT	date_arrivee	MASQUE
ASSISTANTE	IMPORT	date_arrivee	LECTURE
DIRECTION	IMPORT	valeur_dhs	LECTURE
MAGASIN	IMPORT	valeur_dhs	MASQUE
ASSISTANTE	IMPORT	valeur_dhs	LECTURE
DIRECTION	IMPORT	frais_dhs	LECTURE
MAGASIN	IMPORT	frais_dhs	MASQUE
ASSISTANTE	IMPORT	frais_dhs	LECTURE
DIRECTION	IMPORT	tva_dhs	LECTURE
MAGASIN	IMPORT	tva_dhs	MASQUE
ASSISTANTE	IMPORT	tva_dhs	LECTURE
DIRECTION	IMPORT	poids_kg	LECTURE
MAGASIN	IMPORT	poids_kg	MASQUE
ASSISTANTE	IMPORT	poids_kg	LECTURE
DIRECTION	IMPORT	recu_kg	LECTURE
MAGASIN	IMPORT	recu_kg	MASQUE
ASSISTANTE	IMPORT	recu_kg	LECTURE
DIRECTION	IMPORT	nb_palettes	LECTURE
MAGASIN	IMPORT	nb_palettes	MASQUE
ASSISTANTE	IMPORT	nb_palettes	LECTURE
DIRECTION	IMPORT	nb_bobines	LECTURE
MAGASIN	IMPORT	nb_bobines	MASQUE
ASSISTANTE	IMPORT	nb_bobines	LECTURE
DIRECTION	IMPORT	frais_alloues_dhs	LECTURE
MAGASIN	IMPORT	frais_alloues_dhs	MASQUE
ASSISTANTE	IMPORT	frais_alloues_dhs	MASQUE
DIRECTION	IMPORT	montant_alloue_dhs	LECTURE
MAGASIN	IMPORT	montant_alloue_dhs	MASQUE
ASSISTANTE	IMPORT	montant_alloue_dhs	MASQUE
DIRECTION	IMPORT	cout_revient_dhs	LECTURE
MAGASIN	IMPORT	cout_revient_dhs	MASQUE
ASSISTANTE	IMPORT	cout_revient_dhs	MASQUE
DIRECTION	IMPORT	cout_revient_unitaire_dhs	LECTURE
MAGASIN	IMPORT	cout_revient_unitaire_dhs	MASQUE
ASSISTANTE	IMPORT	cout_revient_unitaire_dhs	MASQUE
DIRECTION	IMPORT	cout_revient_kg_dhs	LECTURE
MAGASIN	IMPORT	cout_revient_kg_dhs	MASQUE
ASSISTANTE	IMPORT	cout_revient_kg_dhs	MASQUE
DIRECTION	IMPORT	coef_frais_pct	LECTURE
MAGASIN	IMPORT	coef_frais_pct	MASQUE
ASSISTANTE	IMPORT	coef_frais_pct	MASQUE
DIRECTION	IMPORT	cump_avant	LECTURE
MAGASIN	IMPORT	cump_avant	MASQUE
ASSISTANTE	IMPORT	cump_avant	MASQUE
DIRECTION	IMPORT	cump_apres	LECTURE
MAGASIN	IMPORT	cump_apres	MASQUE
ASSISTANTE	IMPORT	cump_apres	MASQUE
DIRECTION	RECEPTIONS	dossiers	LECTURE
MAGASIN	RECEPTIONS	dossiers	LECTURE
ASSISTANTE	RECEPTIONS	dossiers	LECTURE
DIRECTION	RECEPTIONS	ecart_kg	LECTURE
MAGASIN	RECEPTIONS	ecart_kg	LECTURE
ASSISTANTE	RECEPTIONS	ecart_kg	LECTURE
DIRECTION	RECEPTIONS	nb_bobines	LECTURE
MAGASIN	RECEPTIONS	nb_bobines	LECTURE
ASSISTANTE	RECEPTIONS	nb_bobines	LECTURE
DIRECTION	RECEPTIONS	nb_palettes	LECTURE
MAGASIN	RECEPTIONS	nb_palettes	LECTURE
ASSISTANTE	RECEPTIONS	nb_palettes	LECTURE
DIRECTION	RECEPTIONS	quantite_kg	LECTURE
MAGASIN	RECEPTIONS	quantite_kg	LECTURE
ASSISTANTE	RECEPTIONS	quantite_kg	LECTURE
DIRECTION	PARAMETRES	id_frais	ECRITURE
MAGASIN	PARAMETRES	id_frais	LECTURE
ASSISTANTE	PARAMETRES	id_frais	LECTURE
DIRECTION	PARAMETRES	piece_justificative	ECRITURE
MAGASIN	PARAMETRES	piece_justificative	LECTURE
ASSISTANTE	PARAMETRES	piece_justificative	LECTURE
DIRECTION	PARAMETRES	recuperable	ECRITURE
MAGASIN	PARAMETRES	recuperable	LECTURE
ASSISTANTE	PARAMETRES	recuperable	LECTURE
DIRECTION	PARAMETRES	commun	ECRITURE
MAGASIN	PARAMETRES	commun	LECTURE
ASSISTANTE	PARAMETRES	commun	LECTURE
DIRECTION	PARAMETRES	inclus_dans_cout	ECRITURE
MAGASIN	PARAMETRES	inclus_dans_cout	LECTURE
ASSISTANTE	PARAMETRES	inclus_dans_cout	LECTURE
DIRECTION	PARAMETRES	methode_repartition	ECRITURE
MAGASIN	PARAMETRES	methode_repartition	LECTURE
ASSISTANTE	PARAMETRES	methode_repartition	LECTURE
DIRECTION	PARAMETRES	ordre	ECRITURE
MAGASIN	PARAMETRES	ordre	LECTURE
ASSISTANTE	PARAMETRES	ordre	LECTURE
DIRECTION	PARAMETRES	actif	ECRITURE
MAGASIN	PARAMETRES	actif	LECTURE
ASSISTANTE	PARAMETRES	actif	LECTURE
DIRECTION	PARAMETRES	nb_utilisations	LECTURE
MAGASIN	PARAMETRES	nb_utilisations	LECTURE
ASSISTANTE	PARAMETRES	nb_utilisations	LECTURE
DIRECTION	BONS_COMMANDE	libelle	LECTURE
MAGASIN	BONS_COMMANDE	libelle	LECTURE
ASSISTANTE	BONS_COMMANDE	libelle	LECTURE
DIRECTION	BONS_COMMANDE	type_ligne	LECTURE
MAGASIN	BONS_COMMANDE	type_ligne	LECTURE
ASSISTANTE	BONS_COMMANDE	type_ligne	LECTURE
DIRECTION	PARAMETRES	taux	LECTURE
MAGASIN	PARAMETRES	taux	LECTURE
ASSISTANTE	PARAMETRES	taux	LECTURE
DIRECTION	PARAMETRES	date_debut	LECTURE
MAGASIN	PARAMETRES	date_debut	LECTURE
ASSISTANTE	PARAMETRES	date_debut	LECTURE
DIRECTION	PARAMETRES	date_fin	LECTURE
MAGASIN	PARAMETRES	date_fin	LECTURE
ASSISTANTE	PARAMETRES	date_fin	LECTURE
DIRECTION	CATALOGUE	code_couleur_interne	ECRITURE
DIRECTION	CATALOGUE	code_famille	ECRITURE
DIRECTION	CATALOGUE	reference_fournisseur	ECRITURE
DIRECTION	CATALOGUE	supplement_teinture	ECRITURE
DIRECTION	CATALOGUE	classe_teinture	ECRITURE
MAGASIN	CATALOGUE	code_couleur_interne	LECTURE
MAGASIN	CATALOGUE	code_famille	LECTURE
MAGASIN	CATALOGUE	reference_fournisseur	LECTURE
MAGASIN	CATALOGUE	supplement_teinture	LECTURE
MAGASIN	CATALOGUE	classe_teinture	LECTURE
ASSISTANTE	CATALOGUE	code_couleur_interne	ECRITURE
ASSISTANTE	CATALOGUE	code_famille	ECRITURE
ASSISTANTE	CATALOGUE	reference_fournisseur	ECRITURE
ASSISTANTE	CATALOGUE	supplement_teinture	ECRITURE
ASSISTANTE	CATALOGUE	classe_teinture	ECRITURE
DIRECTION	BONS_COMMANDE	bobines_par_palette	LECTURE
MAGASIN	BONS_COMMANDE	bobines_par_palette	LECTURE
ASSISTANTE	BONS_COMMANDE	bobines_par_palette	LECTURE
DIRECTION	BONS_COMMANDE	densite_kg_ml	LECTURE
MAGASIN	BONS_COMMANDE	densite_kg_ml	LECTURE
ASSISTANTE	BONS_COMMANDE	densite_kg_ml	LECTURE
DIRECTION	CATALOGUE	type_lot	ECRITURE
DIRECTION	BONS_COMMANDE	poids_bobine_kg	LECTURE
MAGASIN	BONS_COMMANDE	poids_bobine_kg	LECTURE
ASSISTANTE	BONS_COMMANDE	poids_bobine_kg	LECTURE
MAGASIN	COCKPIT	nb_sur_stock	LECTURE
DIRECTION	COCKPIT	nb_sur_stock	LECTURE
ASSISTANTE	COCKPIT	nb_sur_stock	MASQUE
MAGASIN	COCKPIT	nb_ecart_majeur	LECTURE
DIRECTION	COCKPIT	nb_ecart_majeur	LECTURE
ASSISTANTE	COCKPIT	nb_ecart_majeur	MASQUE
MAGASIN	COCKPIT	nb_refs_en_alerte	LECTURE
DIRECTION	COCKPIT	nb_refs_en_alerte	LECTURE
ASSISTANTE	COCKPIT	nb_refs_en_alerte	MASQUE
MAGASIN	COCKPIT	nb_classe_a	LECTURE
DIRECTION	COCKPIT	nb_classe_a	LECTURE
ASSISTANTE	COCKPIT	nb_classe_a	MASQUE
MAGASIN	COCKPIT	nb_classe_b	LECTURE
DIRECTION	COCKPIT	nb_classe_b	LECTURE
ASSISTANTE	COCKPIT	nb_classe_b	MASQUE
MAGASIN	COCKPIT	nb_classe_c	LECTURE
DIRECTION	COCKPIT	nb_classe_c	LECTURE
ASSISTANTE	COCKPIT	nb_classe_c	MASQUE
MAGASIN	COCKPIT	nb_non_classees	LECTURE
DIRECTION	COCKPIT	nb_non_classees	LECTURE
ASSISTANTE	COCKPIT	nb_non_classees	MASQUE
MAGASIN	COCKPIT	couverture_ponderee_jours	LECTURE
DIRECTION	COCKPIT	couverture_ponderee_jours	LECTURE
ASSISTANTE	COCKPIT	couverture_ponderee_jours	MASQUE
MAGASIN	COCKPIT	ecart_pesee_moyen_pct	LECTURE
DIRECTION	COCKPIT	ecart_pesee_moyen_pct	LECTURE
ASSISTANTE	COCKPIT	ecart_pesee_moyen_pct	MASQUE
MAGASIN	COCKPIT	nb_opportunites	LECTURE
DIRECTION	COCKPIT	nb_opportunites	LECTURE
ASSISTANTE	COCKPIT	nb_opportunites	MASQUE
MAGASIN	COCKPIT	alertes	LECTURE
DIRECTION	COCKPIT	alertes	LECTURE
ASSISTANTE	COCKPIT	alertes	MASQUE
MAGASIN	COCKPIT	economies_total_mad	MASQUE
DIRECTION	COCKPIT	economies_total_mad	LECTURE
ASSISTANTE	COCKPIT	economies_total_mad	MASQUE
MAGASIN	COCKPIT	budget_ruptures_mad	MASQUE
DIRECTION	COCKPIT	budget_ruptures_mad	LECTURE
ASSISTANTE	COCKPIT	budget_ruptures_mad	MASQUE
MAGASIN	COCKPIT	pct_valeur_dormante	MASQUE
DIRECTION	COCKPIT	pct_valeur_dormante	LECTURE
ASSISTANTE	COCKPIT	pct_valeur_dormante	MASQUE
MAGASIN	MOUVEMENTS	valeur_dhs	MASQUE
DIRECTION	MOUVEMENTS	valeur_dhs	LECTURE
ASSISTANTE	MOUVEMENTS	valeur_dhs	MASQUE
MAGASIN	CATALOGUE	prix_catalogue_mad	MASQUE
DIRECTION	CATALOGUE	prix_catalogue_mad	LECTURE
ASSISTANTE	CATALOGUE	prix_catalogue_mad	MASQUE
MAGASIN	CATALOGUE	valeur_stock_mad	MASQUE
DIRECTION	CATALOGUE	valeur_stock_mad	LECTURE
ASSISTANTE	CATALOGUE	valeur_stock_mad	MASQUE
DIRECTION	IMPORT	nom_fichier	LECTURE
MAGASIN	IMPORT	nom_fichier	MASQUE
ASSISTANTE	IMPORT	nom_fichier	LECTURE
DIRECTION	IMPORT	nature	LECTURE
MAGASIN	IMPORT	nature	MASQUE
ASSISTANTE	IMPORT	nature	LECTURE
DIRECTION	IMPORT	taille_octets	LECTURE
MAGASIN	IMPORT	taille_octets	MASQUE
ASSISTANTE	IMPORT	taille_octets	LECTURE
DIRECTION	IMPORT	nb_pages	LECTURE
MAGASIN	IMPORT	nb_pages	MASQUE
ASSISTANTE	IMPORT	nb_pages	LECTURE
DIRECTION	IMPORT	date_depot	LECTURE
MAGASIN	IMPORT	date_depot	MASQUE
ASSISTANTE	IMPORT	date_depot	LECTURE
DIRECTION	IMPORT	depose_par	LECTURE
MAGASIN	IMPORT	depose_par	MASQUE
ASSISTANTE	IMPORT	depose_par	LECTURE
DIRECTION	BONS_COMMANDE	code_couleur	LECTURE
MAGASIN	BONS_COMMANDE	code_couleur	LECTURE
ASSISTANTE	BONS_COMMANDE	code_couleur	LECTURE
DIRECTION	BONS_COMMANDE	couleur	LECTURE
MAGASIN	BONS_COMMANDE	couleur	LECTURE
ASSISTANTE	BONS_COMMANDE	couleur	LECTURE
DIRECTION	BONS_COMMANDE	reference_fournisseur	LECTURE
MAGASIN	BONS_COMMANDE	reference_fournisseur	LECTURE
ASSISTANTE	BONS_COMMANDE	reference_fournisseur	LECTURE
MAGASIN	PLAN_ACHAT	selection	LECTURE
DIRECTION	PLAN_ACHAT	selection	LECTURE
ASSISTANTE	PLAN_ACHAT	selection	LECTURE
MAGASIN	PLAN_ACHAT	classe_abc	LECTURE
DIRECTION	PLAN_ACHAT	classe_abc	LECTURE
ASSISTANTE	PLAN_ACHAT	classe_abc	LECTURE
MAGASIN	PLAN_ACHAT	classe_xyz	LECTURE
DIRECTION	PLAN_ACHAT	classe_xyz	LECTURE
ASSISTANTE	PLAN_ACHAT	classe_xyz	LECTURE
MAGASIN	PLAN_ACHAT	risque_source	LECTURE
DIRECTION	PLAN_ACHAT	risque_source	LECTURE
ASSISTANTE	PLAN_ACHAT	risque_source	LECTURE
MAGASIN	PLAN_ACHAT	nb_sources	LECTURE
DIRECTION	PLAN_ACHAT	nb_sources	LECTURE
ASSISTANTE	PLAN_ACHAT	nb_sources	LECTURE
MAGASIN	PLAN_ACHAT	code_devise	MASQUE
DIRECTION	PLAN_ACHAT	code_devise	LECTURE
ASSISTANTE	PLAN_ACHAT	code_devise	LECTURE
MAGASIN	PLAN_ACHAT	prix_devise	MASQUE
DIRECTION	PLAN_ACHAT	prix_devise	LECTURE
ASSISTANTE	PLAN_ACHAT	prix_devise	LECTURE
MAGASIN	PLAN_ACHAT	montant_devise	MASQUE
DIRECTION	PLAN_ACHAT	montant_devise	LECTURE
ASSISTANTE	PLAN_ACHAT	montant_devise	LECTURE
MAGASIN	PLAN_ACHAT	taux_devise	MASQUE
DIRECTION	PLAN_ACHAT	taux_devise	LECTURE
ASSISTANTE	PLAN_ACHAT	taux_devise	LECTURE
MAGASIN	PLAN_ACHAT	palettes_a_commander	LECTURE
DIRECTION	PLAN_ACHAT	palettes_a_commander	LECTURE
ASSISTANTE	PLAN_ACHAT	palettes_a_commander	LECTURE
ASSISTANTE	STOCK	palettes	LECTURE
MAGASIN	STOCK	palettes	LECTURE
DIRECTION	STOCK	palettes	LECTURE
ASSISTANTE	STOCK	bobines	LECTURE
MAGASIN	STOCK	bobines	LECTURE
DIRECTION	STOCK	bobines	LECTURE
ASSISTANTE	STOCK	kg_par_palette	LECTURE
MAGASIN	STOCK	kg_par_palette	LECTURE
DIRECTION	STOCK	kg_par_palette	LECTURE
DIRECTION	CATALOGUE	code_couleur_fournisseur	ECRITURE
MAGASIN	CATALOGUE	code_couleur_fournisseur	LECTURE
ASSISTANTE	CATALOGUE	code_couleur_fournisseur	ECRITURE
DIRECTION	CATALOGUE	nb_familles	LECTURE
MAGASIN	CATALOGUE	nb_familles	LECTURE
ASSISTANTE	CATALOGUE	nb_familles	LECTURE
DIRECTION	STOCK	unite_catalogue	LECTURE
MAGASIN	STOCK	unite_catalogue	LECTURE
ASSISTANTE	STOCK	unite_catalogue	LECTURE
DIRECTION	STOCK	poids_bobine_kg	LECTURE
MAGASIN	STOCK	poids_bobine_kg	LECTURE
ASSISTANTE	STOCK	poids_bobine_kg	LECTURE
DIRECTION	STOCK	bobines_par_palette	LECTURE
MAGASIN	STOCK	bobines_par_palette	LECTURE
ASSISTANTE	STOCK	bobines_par_palette	LECTURE
DIRECTION	STOCK	densite_kg_ml	LECTURE
MAGASIN	STOCK	densite_kg_ml	LECTURE
ASSISTANTE	STOCK	densite_kg_ml	LECTURE
DIRECTION	STOCK	suivi_lot	LECTURE
MAGASIN	STOCK	suivi_lot	LECTURE
ASSISTANTE	STOCK	suivi_lot	LECTURE
DIRECTION	MOUVEMENTS	famille_libelle	LECTURE
MAGASIN	MOUVEMENTS	famille_libelle	LECTURE
ASSISTANTE	MOUVEMENTS	famille_libelle	LECTURE
DIRECTION	MOUVEMENTS	categorie_libelle	LECTURE
MAGASIN	MOUVEMENTS	categorie_libelle	LECTURE
ASSISTANTE	MOUVEMENTS	categorie_libelle	LECTURE
DIRECTION	MOUVEMENTS	couleur_libelle	LECTURE
MAGASIN	MOUVEMENTS	couleur_libelle	LECTURE
ASSISTANTE	MOUVEMENTS	couleur_libelle	LECTURE
DIRECTION	MOUVEMENTS	refs_en_stock	LECTURE
MAGASIN	MOUVEMENTS	refs_en_stock	LECTURE
ASSISTANTE	MOUVEMENTS	refs_en_stock	LECTURE
DIRECTION	MOUVEMENTS	nb_entrees	LECTURE
MAGASIN	MOUVEMENTS	nb_entrees	LECTURE
ASSISTANTE	MOUVEMENTS	nb_entrees	LECTURE
DIRECTION	MOUVEMENTS	entrees_dhs	LECTURE
DIRECTION	MOUVEMENTS	prix_moyen_entree_mad	LECTURE
DIRECTION	MOUVEMENTS	nb_familles	LECTURE
MAGASIN	MOUVEMENTS	nb_familles	LECTURE
ASSISTANTE	MOUVEMENTS	nb_familles	LECTURE
DIRECTION	CATALOGUE	bobines_par_lot	ECRITURE
MAGASIN	CATALOGUE	bobines_par_lot	LECTURE
ASSISTANTE	CATALOGUE	bobines_par_lot	ECRITURE
DIRECTION	CATALOGUE	description_commerciale	ECRITURE
ADMIN	PLANS	date_cloture	ECRITURE
MAGASIN	CATALOGUE	description_commerciale	LECTURE
ASSISTANTE	CATALOGUE	description_commerciale	ECRITURE
DIRECTION	FOURNISSEURS	palettes_par_conteneur	ECRITURE
MAGASIN	FOURNISSEURS	palettes_par_conteneur	LECTURE
ASSISTANTE	FOURNISSEURS	palettes_par_conteneur	ECRITURE
DIRECTION	BONS_COMMANDE	bobines_par_lot	LECTURE
MAGASIN	BONS_COMMANDE	bobines_par_lot	LECTURE
ASSISTANTE	BONS_COMMANDE	bobines_par_lot	LECTURE
DIRECTION	BONS_COMMANDE	description_commerciale	LECTURE
MAGASIN	BONS_COMMANDE	description_commerciale	LECTURE
ASSISTANTE	BONS_COMMANDE	description_commerciale	LECTURE
DIRECTION	BONS_COMMANDE	nombre_conteneurs	ECRITURE
MAGASIN	BONS_COMMANDE	nombre_conteneurs	LECTURE
ASSISTANTE	BONS_COMMANDE	nombre_conteneurs	ECRITURE
DIRECTION	BONS_COMMANDE	mention_expedition	ECRITURE
MAGASIN	BONS_COMMANDE	mention_expedition	LECTURE
ASSISTANTE	BONS_COMMANDE	mention_expedition	ECRITURE
DIRECTION	STOCK	bobines_par_lot	LECTURE
MAGASIN	STOCK	bobines_par_lot	LECTURE
ASSISTANTE	STOCK	bobines_par_lot	LECTURE
DIRECTION	BONS_COMMANDE	incoterm	LECTURE
MAGASIN	BONS_COMMANDE	incoterm	LECTURE
ASSISTANTE	BONS_COMMANDE	incoterm	LECTURE
DIRECTION	BONS_COMMANDE	tolerance_pesee_pct	LECTURE
MAGASIN	BONS_COMMANDE	tolerance_pesee_pct	LECTURE
ASSISTANTE	STOCK	kg_sur_machine	LECTURE
ASSISTANTE	BONS_COMMANDE	tolerance_pesee_pct	LECTURE
DIRECTION	BONS_COMMANDE	palettes_par_conteneur	LECTURE
MAGASIN	BONS_COMMANDE	palettes_par_conteneur	LECTURE
ASSISTANTE	BONS_COMMANDE	palettes_par_conteneur	LECTURE
DIRECTION	BONS_COMMANDE	code_famille	LECTURE
MAGASIN	BONS_COMMANDE	code_famille	LECTURE
ASSISTANTE	BONS_COMMANDE	code_famille	LECTURE
DIRECTION	UTILISATEURS	totp_actif	LECTURE
MAGASIN	UTILISATEURS	totp_actif	LECTURE
ASSISTANTE	UTILISATEURS	totp_actif	LECTURE
DIRECTION	UTILISATEURS	totp_active_le	LECTURE
MAGASIN	UTILISATEURS	totp_active_le	LECTURE
ASSISTANTE	UTILISATEURS	totp_active_le	LECTURE
DIRECTION	UTILISATEURS	echecs_consecutifs	LECTURE
MAGASIN	UTILISATEURS	echecs_consecutifs	LECTURE
ASSISTANTE	UTILISATEURS	echecs_consecutifs	LECTURE
DIRECTION	UTILISATEURS	bloque_jusqu_a	LECTURE
MAGASIN	UTILISATEURS	bloque_jusqu_a	LECTURE
ASSISTANTE	UTILISATEURS	bloque_jusqu_a	LECTURE
DIRECTION	UTILISATEURS	dernier_echec	LECTURE
MAGASIN	UTILISATEURS	dernier_echec	LECTURE
ASSISTANTE	UTILISATEURS	dernier_echec	LECTURE
DIRECTION	UTILISATEURS	resultat	LECTURE
MAGASIN	UTILISATEURS	resultat	LECTURE
ASSISTANTE	UTILISATEURS	resultat	LECTURE
DIRECTION	UTILISATEURS	agent	LECTURE
MAGASIN	UTILISATEURS	agent	LECTURE
ASSISTANTE	UTILISATEURS	agent	LECTURE
DIRECTION	CATALOGUE	code_reference	ECRITURE
DIRECTION	CATALOGUE	designation	ECRITURE
DIRECTION	CATALOGUE	code_categorie	ECRITURE
DIRECTION	CATALOGUE	code_role_defaut	ECRITURE
DIRECTION	CATALOGUE	code_fournisseur	ECRITURE
DIRECTION	CATALOGUE	fournisseur_nom	ECRITURE
DIRECTION	CATALOGUE	type_fil	ECRITURE
DIRECTION	CATALOGUE	couleur	ECRITURE
DIRECTION	CATALOGUE	titrage	ECRITURE
DIRECTION	CATALOGUE	unite_catalogue	ECRITURE
DIRECTION	CATALOGUE	poids_bobine_kg	ECRITURE
DIRECTION	CATALOGUE	bobines_par_palette	ECRITURE
DIRECTION	CATALOGUE	densite_kg_ml	ECRITURE
DIRECTION	CATALOGUE	facteur_kg	ECRITURE
DIRECTION	CATALOGUE	prix_catalogue	ECRITURE
DIRECTION	CATALOGUE	code_devise_catalogue	ECRITURE
DIRECTION	CATALOGUE	prix_catalogue_kg	ECRITURE
DIRECTION	CATALOGUE	prix_kg_mad	ECRITURE
DIRECTION	CATALOGUE	source_prix	ECRITURE
DIRECTION	CATALOGUE	cmup_mad	ECRITURE
DIRECTION	CATALOGUE	stock_min_kg	ECRITURE
DIRECTION	CATALOGUE	couverture_min_mois	ECRITURE
DIRECTION	CATALOGUE	marge_securite_pct	ECRITURE
DIRECTION	CATALOGUE	moq_kg	ECRITURE
DIRECTION	CATALOGUE	multiple_achat_kg	ECRITURE
DIRECTION	CATALOGUE	classe_abc	ECRITURE
DIRECTION	CATALOGUE	classe_xyz	ECRITURE
DIRECTION	CATALOGUE	suivi_lot	ECRITURE
DIRECTION	CATALOGUE	actif	ECRITURE
DIRECTION	FOURNISSEURS	code_fournisseur	ECRITURE
DIRECTION	FOURNISSEURS	nom	ECRITURE
DIRECTION	FOURNISSEURS	contact_principal	ECRITURE
DIRECTION	FOURNISSEURS	telephone	ECRITURE
DIRECTION	FOURNISSEURS	email	ECRITURE
DIRECTION	FOURNISSEURS	pays	ECRITURE
DIRECTION	FOURNISSEURS	ville	ECRITURE
DIRECTION	FOURNISSEURS	delai_livraison_jours	ECRITURE
DIRECTION	FOURNISSEURS	conditions_paiement	ECRITURE
DIRECTION	FOURNISSEURS	delai_paiement_jours	ECRITURE
DIRECTION	FOURNISSEURS	code_devise	ECRITURE
DIRECTION	FOURNISSEURS	note_globale	ECRITURE
DIRECTION	FOURNISSEURS	tolerance_pesee_pct	ECRITURE
DIRECTION	FOURNISSEURS	actif	ECRITURE
DIRECTION	STOCK	code_reference	ECRITURE
DIRECTION	STOCK	designation	ECRITURE
DIRECTION	STOCK	code_magasin	ECRITURE
DIRECTION	STOCK	quantite_kg	ECRITURE
DIRECTION	STOCK	cmup_mad	ECRITURE
DIRECTION	STOCK	valeur_mad	ECRITURE
DIRECTION	STOCK	date_derniere_entree	ECRITURE
DIRECTION	STOCK	date_derniere_sortie	ECRITURE
DIRECTION	STOCK	date_dernier_inventaire	ECRITURE
DIRECTION	STOCK	stock_projete_kg	ECRITURE
DIRECTION	STOCK	jours_couverture	ECRITURE
DIRECTION	STOCK	statut	ECRITURE
DIRECTION	STOCK	lot_fournisseur	ECRITURE
DIRECTION	STOCK	date_peremption	ECRITURE
DIRECTION	MOUVEMENTS	numero_mouvement	ECRITURE
DIRECTION	MOUVEMENTS	date_mouvement	ECRITURE
DIRECTION	MOUVEMENTS	code_type_mvt	ECRITURE
DIRECTION	MOUVEMENTS	code_magasin	ECRITURE
DIRECTION	MOUVEMENTS	code_motif	ECRITURE
DIRECTION	MOUVEMENTS	code_reference	ECRITURE
DIRECTION	MOUVEMENTS	quantite_kg	ECRITURE
DIRECTION	MOUVEMENTS	prix_kg_mad	ECRITURE
DIRECTION	MOUVEMENTS	total_mad	ECRITURE
DIRECTION	MOUVEMENTS	lot_fournisseur	ECRITURE
DIRECTION	MOUVEMENTS	numero_of	ECRITURE
DIRECTION	MOUVEMENTS	utilisateur	ECRITURE
DIRECTION	RECEPTIONS	numero_reception	ECRITURE
DIRECTION	RECEPTIONS	date_reception	ECRITURE
DIRECTION	RECEPTIONS	code_fournisseur	ECRITURE
DIRECTION	RECEPTIONS	num_bon_livraison	ECRITURE
DIRECTION	RECEPTIONS	code_reference	ECRITURE
DIRECTION	RECEPTIONS	unite_saisie	ECRITURE
DIRECTION	RECEPTIONS	quantite_pesee_unite	ECRITURE
DIRECTION	RECEPTIONS	quantite_stock_kg	ECRITURE
DIRECTION	RECEPTIONS	quantite_commandee_kg	ECRITURE
DIRECTION	RECEPTIONS	ecart_pct	ECRITURE
DIRECTION	RECEPTIONS	prix_kg_devise	ECRITURE
DIRECTION	STOCK	kg_sur_machine	LECTURE
DIRECTION	RECEPTIONS	code_devise	ECRITURE
DIRECTION	RECEPTIONS	taux_change	ECRITURE
DIRECTION	RECEPTIONS	prix_kg_mad	ECRITURE
DIRECTION	RECEPTIONS	total_mad	ECRITURE
DIRECTION	RECEPTIONS	total_devise	ECRITURE
DIRECTION	RECEPTIONS	lot_fournisseur	ECRITURE
DIRECTION	RECEPTIONS	date_peremption	ECRITURE
DIRECTION	RECEPTIONS	statut_qualite	ECRITURE
DIRECTION	RECEPTIONS	code_magasin_dest	ECRITURE
DIRECTION	RECEPTIONS	fournisseur_nom	ECRITURE
DIRECTION	RECEPTIONS	numero_bc	ECRITURE
DIRECTION	RECEPTIONS	numero_facture	ECRITURE
DIRECTION	RECEPTIONS	transporteur	ECRITURE
DIRECTION	RECEPTIONS	nombre_colis	ECRITURE
DIRECTION	RECEPTIONS	poids_total_brut_kg	ECRITURE
DIRECTION	RECEPTIONS	statut	ECRITURE
DIRECTION	RECEPTIONS	nb_lignes	ECRITURE
DIRECTION	RECEPTIONS	receptionnaire	ECRITURE
DIRECTION	RECEPTIONS	controleur	ECRITURE
DIRECTION	RECEPTIONS	date_controle	ECRITURE
DIRECTION	RECEPTIONS	quantite_bl_kg	ECRITURE
DIRECTION	RECEPTIONS	ecart_bl_kg	ECRITURE
DIRECTION	RECEPTIONS	ecart_cmd_kg	ECRITURE
DIRECTION	RECEPTIONS	nb_colis_ligne	ECRITURE
DIRECTION	RECEPTIONS	poids_moyen_colis_kg	ECRITURE
DIRECTION	RECEPTIONS	date_fabrication	ECRITURE
DIRECTION	RECEPTIONS	notes	ECRITURE
DIRECTION	RECEPTIONS	delai_reel_jours	ECRITURE
DIRECTION	RECEPTIONS	delai_prevu_jours	ECRITURE
DIRECTION	RECEPTIONS	retard_jours	ECRITURE
DIRECTION	RECEPTIONS	on_time	ECRITURE
DIRECTION	RECEPTIONS	in_full	ECRITURE
DIRECTION	RECEPTIONS	in_spec	ECRITURE
DIRECTION	RECEPTIONS	substitution_acceptee	ECRITURE
DIRECTION	RECEPTIONS	motif_substitution	ECRITURE
DIRECTION	RECEPTIONS	reference_commandee	ECRITURE
DIRECTION	RECEPTIONS	est_substitution	ECRITURE
DIRECTION	RECEPTIONS	equivalents_recevables	ECRITURE
DIRECTION	BONS_COMMANDE	numero_bc	ECRITURE
DIRECTION	BONS_COMMANDE	date_bc	ECRITURE
DIRECTION	BONS_COMMANDE	code_fournisseur	ECRITURE
DIRECTION	BONS_COMMANDE	statut	ECRITURE
DIRECTION	BONS_COMMANDE	code_devise	ECRITURE
DIRECTION	BONS_COMMANDE	taux_change_engage	ECRITURE
DIRECTION	BONS_COMMANDE	montant_total_devise	ECRITURE
DIRECTION	BONS_COMMANDE	montant_total_mad	ECRITURE
DIRECTION	BONS_COMMANDE	code_reference	ECRITURE
DIRECTION	BONS_COMMANDE	unite_commande	ECRITURE
DIRECTION	BONS_COMMANDE	quantite_commandee_unite	ECRITURE
DIRECTION	BONS_COMMANDE	quantite_commandee_kg	ECRITURE
DIRECTION	BONS_COMMANDE	quantite_recue_kg	ECRITURE
DIRECTION	BONS_COMMANDE	prix_unitaire_devise	ECRITURE
DIRECTION	BONS_COMMANDE	total_ligne_devise	ECRITURE
DIRECTION	BONS_COMMANDE	date_livraison_prevue	ECRITURE
DIRECTION	BONS_COMMANDE	besoin_kg_origine	ECRITURE
DIRECTION	BONS_COMMANDE	besoin_kg_actuel	ECRITURE
DIRECTION	BONS_COMMANDE	ecart_besoin_kg	ECRITURE
DIRECTION	BONS_COMMANDE	arbitree	ECRITURE
DIRECTION	BONS_COMMANDE	fournisseur_nom	ECRITURE
DIRECTION	BONS_COMMANDE	devise_fournisseur	ECRITURE
DIRECTION	BONS_COMMANDE	nb_lignes	ECRITURE
DIRECTION	BONS_COMMANDE	date_envoi	ECRITURE
DIRECTION	BONS_COMMANDE	date_validation	ECRITURE
DIRECTION	BONS_COMMANDE	createur	ECRITURE
DIRECTION	BONS_COMMANDE	valideur	ECRITURE
DIRECTION	BONS_COMMANDE	motif_creation	ECRITURE
DIRECTION	BONS_COMMANDE	conditions_paiement	ECRITURE
DIRECTION	BONS_COMMANDE	notes	ECRITURE
DIRECTION	BONS_COMMANDE	quantite_recue_kg_bc	ECRITURE
DIRECTION	BONS_COMMANDE	reste_a_livrer_kg	ECRITURE
DIRECTION	BONS_COMMANDE	pct_livre	ECRITURE
DIRECTION	BONS_COMMANDE	statut_livraison	ECRITURE
DIRECTION	BONS_COMMANDE	equivalent_de	ECRITURE
DIRECTION	BONS_COMMANDE	besoin_equivalent_kg	ECRITURE
DIRECTION	BONS_COMMANDE	nb_equivalents	ECRITURE
DIRECTION	BONS_COMMANDE	statut_ligne	ECRITURE
DIRECTION	PLAN_ACHAT	fournisseur_nom	ECRITURE
DIRECTION	PLAN_ACHAT	unite_saisie	ECRITURE
DIRECTION	PLAN_ACHAT	risque_identifie	ECRITURE
DIRECTION	PLAN_ACHAT	action_recommandee	ECRITURE
DIRECTION	PLAN_ACHAT	commentaires	ECRITURE
DIRECTION	PLAN_ACHAT	date_generation	ECRITURE
DIRECTION	CATALOGUE	date_achat	ECRITURE
DIRECTION	CATALOGUE	prix_kg_devise	ECRITURE
DIRECTION	CATALOGUE	prix_precedent_mad	ECRITURE
DIRECTION	CATALOGUE	quantite_achetee_kg	ECRITURE
DIRECTION	CATALOGUE	total_mad	ECRITURE
DIRECTION	CATALOGUE	numero_bc	ECRITURE
DIRECTION	CATALOGUE	numero_reception	ECRITURE
DIRECTION	PLAN_ACHAT	id_proposition	ECRITURE
DIRECTION	PLAN_ACHAT	code_reference	ECRITURE
DIRECTION	PLAN_ACHAT	quantite_suggeree_kg	ECRITURE
DIRECTION	PLAN_ACHAT	quantite_suggeree_unite	ECRITURE
DIRECTION	PLAN_ACHAT	urgence	ECRITURE
DIRECTION	PLAN_ACHAT	date_besoin_prevue	ECRITURE
DIRECTION	PLAN_ACHAT	montant_total_mad	ECRITURE
DIRECTION	PLAN_ACHAT	numero_bc	ECRITURE
DIRECTION	PLAN_ACHAT	statut_bc	ECRITURE
DIRECTION	PLAN_ACHAT	designation	ECRITURE
DIRECTION	PLAN_ACHAT	code_fournisseur	ECRITURE
DIRECTION	PLAN_ACHAT	statut	ECRITURE
DIRECTION	PLAN_ACHAT	stock_projete_kg	ECRITURE
DIRECTION	PLAN_ACHAT	stock_min_kg	ECRITURE
DIRECTION	PLAN_ACHAT	qte_a_commander_kg	ECRITURE
DIRECTION	PLAN_ACHAT	prix_estime_mad	ECRITURE
DIRECTION	PLAN_ACHAT	source_prix	ECRITURE
DIRECTION	PLAN_ACHAT	montant_estime_mad	ECRITURE
DIRECTION	PLAN_ACHAT	tier	ECRITURE
DIRECTION	PLAN_ACHAT	risque_sourcing	ECRITURE
DIRECTION	PLAN_ACHAT	jours_couverture	ECRITURE
DIRECTION	PLAN_ACHAT	code_reference_origine	ECRITURE
DIRECTION	PLAN_ACHAT	designation_origine	ECRITURE
DIRECTION	PLAN_ACHAT	motif_substitution	ECRITURE
DIRECTION	PLAN_ACHAT	nb_equivalents	ECRITURE
DIRECTION	PLAN_ACHAT	equivalent_dispo_kg	ECRITURE
DIRECTION	QUALITES	code_qualite	ECRITURE
DIRECTION	QUALITES	nom	ECRITURE
DIRECTION	QUALITES	description	ECRITURE
DIRECTION	QUALITES	statut	ECRITURE
DIRECTION	QUALITES	poids_commercial_m2	ECRITURE
DIRECTION	QUALITES	code_role	ECRITURE
DIRECTION	QUALITES	role_libelle	ECRITURE
DIRECTION	QUALITES	densite	ECRITURE
DIRECTION	QUALITES	unite_densite	ECRITURE
DIRECTION	QUALITES	entre_poids_commercial	ECRITURE
DIRECTION	QUALITES	code_reference	ECRITURE
DIRECTION	QUALITES	designation	ECRITURE
DIRECTION	QUALITES	pourcentage_composition	ECRITURE
DIRECTION	QUALITES	couleur	ECRITURE
DIRECTION	QUALITES	code_groupe_equiv	ECRITURE
DIRECTION	QUALITES	code_fournisseur_prefere	ECRITURE
DIRECTION	QUALITES	ligne_numero	ECRITURE
DIRECTION	QUALITES	kg_m2	ECRITURE
DIRECTION	QUALITES	type_fil	ECRITURE
DIRECTION	QUALITES	categorie	ECRITURE
DIRECTION	QUALITES	fournisseur	ECRITURE
DIRECTION	QUALITES	prix_kg_mad	ECRITURE
DIRECTION	QUALITES	code_devise_catalogue	ECRITURE
DIRECTION	QUALITES	cout_m2_mad	ECRITURE
DIRECTION	QUALITES	source_prix	ECRITURE
DIRECTION	QUALITES	marge_securite_pct	ECRITURE
DIRECTION	QUALITES	couv_min_mois	ECRITURE
DIRECTION	QUALITES	taux_perte_pct	ECRITURE
DIRECTION	QUALITES	seuil_alerte_jours	ECRITURE
DIRECTION	QUALITES	seuil_critique_jours	ECRITURE
DIRECTION	QUALITES	stock_securite_jours	ECRITURE
DIRECTION	QUALITES	actif	ECRITURE
DIRECTION	QUALITES	nb_roles	ECRITURE
DIRECTION	QUALITES	nb_composition	ECRITURE
DIRECTION	QUALITES	nb_roles_composes	ECRITURE
DIRECTION	QUALITES	nb_roles_hors_100	ECRITURE
DIRECTION	QUALITES	nb_lignes_plan	ECRITURE
DIRECTION	QUALITES	date_creation	ECRITURE
DIRECTION	QUALITES	cree_par	ECRITURE
DIRECTION	QUALITES	date_modification	ECRITURE
DIRECTION	QUALITES	modifie_par	ECRITURE
DIRECTION	QUALITES	date_cloture	ECRITURE
DIRECTION	RECETTES	code_qualite	ECRITURE
DIRECTION	RECETTES	qualite_nom	ECRITURE
DIRECTION	RECETTES	ligne_numero	ECRITURE
DIRECTION	RECETTES	code_reference	ECRITURE
DIRECTION	RECETTES	designation	ECRITURE
DIRECTION	RECETTES	code_role	ECRITURE
DIRECTION	RECETTES	role_libelle	ECRITURE
DIRECTION	RECETTES	pourcentage_composition	ECRITURE
DIRECTION	RECETTES	couleur	ECRITURE
DIRECTION	RECETTES	densite_role	ECRITURE
DIRECTION	RECETTES	unite_densite	ECRITURE
DIRECTION	RECETTES	kg_m2	ECRITURE
DIRECTION	RECETTES	code_groupe_equiv	ECRITURE
DIRECTION	RECETTES	statut_qualite	ECRITURE
DIRECTION	RECETTES	code_fournisseur	ECRITURE
DIRECTION	RECETTES	fournisseur	ECRITURE
DIRECTION	RECETTES	code_fournisseur_prefere	ECRITURE
DIRECTION	PLANS	annee	ECRITURE
DIRECTION	PLANS	numero_version	ECRITURE
DIRECTION	PLANS	libelle	ECRITURE
DIRECTION	PLANS	scenario_nom	ECRITURE
DIRECTION	PLANS	statut	ECRITURE
DIRECTION	PLANS	actif	ECRITURE
DIRECTION	PLANS	date_debut	ECRITURE
DIRECTION	PLANS	date_fin	ECRITURE
DIRECTION	PLANS	mois_horizon	ECRITURE
DIRECTION	PLANS	croissance_annuelle_pct	ECRITURE
DIRECTION	PLANS	mois	ECRITURE
DIRECTION	PLANS	rang_mois	ECRITURE
DIRECTION	PLANS	annee_mois	ECRITURE
DIRECTION	PLANS	code_qualite	ECRITURE
DIRECTION	PLANS	qualite_nom	ECRITURE
DIRECTION	PLANS	m2_base_mensuel	ECRITURE
DIRECTION	PLANS	m2_prevus	ECRITURE
DIRECTION	PLANS	saisonnalite	ECRITURE
DIRECTION	PLANS	coefficient	ECRITURE
DIRECTION	PLANS	facteur_croissance	ECRITURE
DIRECTION	PLANS	m2_realises	ECRITURE
DIRECTION	PLANS	taux_perte_pct	ECRITURE
DIRECTION	PLANS	m2_total_annuel	ECRITURE
DIRECTION	PLANS	m2_total	ECRITURE
DIRECTION	PLANS	nb_lignes	ECRITURE
DIRECTION	PLANS	nb_qualites	ECRITURE
DIRECTION	PLANS	nb_qualites_perimees	ECRITURE
DIRECTION	PLANS	nb_besoins	ECRITURE
DIRECTION	PLANS	date_creation	ECRITURE
DIRECTION	PLANS	cree_par	ECRITURE
DIRECTION	PLANS	date_modification	ECRITURE
DIRECTION	PLANS	modifie_par	ECRITURE
DIRECTION	PLANS	date_validation	ECRITURE
DIRECTION	PLANS	valide_par	ECRITURE
DIRECTION	PLANS	date_cloture	ECRITURE
DIRECTION	PLANS	cloture_par	ECRITURE
DIRECTION	MRP	code_reference	ECRITURE
DIRECTION	MRP	designation	ECRITURE
DIRECTION	MRP	mois	ECRITURE
DIRECTION	MRP	quantite_brute_kg	ECRITURE
DIRECTION	MRP	taux_perte_applique	ECRITURE
DIRECTION	MRP	quantite_kg	ECRITURE
DIRECTION	MRP	code_fournisseur	ECRITURE
DIRECTION	INVENTAIRE	numero_inventaire	ECRITURE
DIRECTION	INVENTAIRE	date_inventaire	ECRITURE
DIRECTION	INVENTAIRE	type_inventaire	ECRITURE
DIRECTION	INVENTAIRE	code_magasin	ECRITURE
DIRECTION	INVENTAIRE	statut	ECRITURE
DIRECTION	INVENTAIRE	code_reference	ECRITURE
DIRECTION	INVENTAIRE	quantite_theorique_kg	ECRITURE
DIRECTION	INVENTAIRE	quantite_comptee_kg	ECRITURE
DIRECTION	INVENTAIRE	ecart_kg	ECRITURE
DIRECTION	INVENTAIRE	ecart_pct	ECRITURE
DIRECTION	INVENTAIRE	ecart_mad	ECRITURE
DIRECTION	INVENTAIRE	motif_ecart	ECRITURE
DIRECTION	VALORISATION	code_reference	ECRITURE
DIRECTION	VALORISATION	code_magasin	ECRITURE
DIRECTION	VALORISATION	quantite_kg	ECRITURE
DIRECTION	VALORISATION	cmup_mad	ECRITURE
DIRECTION	VALORISATION	valeur_mad	ECRITURE
DIRECTION	COCKPIT	nb_ruptures	ECRITURE
DIRECTION	COCKPIT	nb_critiques	ECRITURE
DIRECTION	COCKPIT	nb_attention	ECRITURE
DIRECTION	COCKPIT	nb_ok	ECRITURE
DIRECTION	COCKPIT	nb_references	ECRITURE
DIRECTION	COCKPIT	valeur_stock_mad	ECRITURE
DIRECTION	COCKPIT	nb_refs_a_commander	ECRITURE
DIRECTION	COCKPIT	budget_a_engager_mad	ECRITURE
DIRECTION	COCKPIT	nb_classe_a_alerte	ECRITURE
DIRECTION	COCKPIT	nb_tier1	ECRITURE
DIRECTION	COCKPIT	nb_fournisseurs_actifs	ECRITURE
DIRECTION	COCKPIT	nb_bc_ouverts	ECRITURE
DIRECTION	COCKPIT	montant_bc_ouverts_mad	ECRITURE
DIRECTION	COCKPIT	nb_alertes_critiques	ECRITURE
DIRECTION	COCKPIT	nb_propositions_a_traiter	ECRITURE
DIRECTION	COCKPIT	nb_bc_en_preparation	ECRITURE
DIRECTION	COCKPIT	nb_bc_a_valider	ECRITURE
DIRECTION	COCKPIT	montant_bc_a_valider_mad	ECRITURE
DIRECTION	COCKPIT	nb_bc_a_envoyer	ECRITURE
DIRECTION	COCKPIT	nb_livraisons_en_retard	ECRITURE
DIRECTION	COCKPIT	retard_max_jours	ECRITURE
DIRECTION	COCKPIT	nb_receptions_en_saisie	ECRITURE
DIRECTION	COCKPIT	nb_receptions_a_controler	ECRITURE
DIRECTION	COCKPIT	nb_lignes_non_conformes	ECRITURE
DIRECTION	COCKPIT	nb_receptions_a_regulariser	ECRITURE
DIRECTION	COCKPIT	nb_refs_sous_minimum	ECRITURE
DIRECTION	COCKPIT	nb_refs_dormantes	ECRITURE
DIRECTION	COCKPIT	valeur_dormante_mad	ECRITURE
DIRECTION	FOURNISSEURS	nb_references	ECRITURE
DIRECTION	COCKPIT	nb_lots_peremption_proche	ECRITURE
DIRECTION	COCKPIT	nb_controles_bloquants	ECRITURE
DIRECTION	COCKPIT	nb_controles_critiques	ECRITURE
DIRECTION	COCKPIT	nb_alertes_ouvertes	ECRITURE
DIRECTION	COCKPIT	code_reference	ECRITURE
DIRECTION	COCKPIT	designation	ECRITURE
DIRECTION	COCKPIT	classe_abc	ECRITURE
DIRECTION	COCKPIT	code_fournisseur	ECRITURE
DIRECTION	COCKPIT	fournisseur_nom	ECRITURE
DIRECTION	COCKPIT	delai_livraison_jours	ECRITURE
DIRECTION	COCKPIT	risque_sourcing	ECRITURE
DIRECTION	COCKPIT	stock_min_kg	ECRITURE
DIRECTION	COCKPIT	stock_initial_kg	ECRITURE
DIRECTION	COCKPIT	nb_mois_rupture	ECRITURE
DIRECTION	COCKPIT	nb_mois_tendu	ECRITURE
DIRECTION	COCKPIT	premier_mois_rupture	ECRITURE
DIRECTION	COCKPIT	premier_mois_risque	ECRITURE
DIRECTION	COCKPIT	rang_premier_risque	ECRITURE
DIRECTION	COCKPIT	marge_decision_jours	ECRITURE
DIRECTION	COCKPIT	mois	ECRITURE
DIRECTION	COCKPIT	annee_mois	ECRITURE
DIRECTION	COCKPIT	rang_mois	ECRITURE
DIRECTION	COCKPIT	besoin_kg	ECRITURE
DIRECTION	COCKPIT	entrees_kg	ECRITURE
DIRECTION	COCKPIT	stock_fin_kg	ECRITURE
DIRECTION	COCKPIT	statut	ECRITURE
DIRECTION	MOUVEMENTS	annee_mois	ECRITURE
DIRECTION	MOUVEMENTS	type_libelle	ECRITURE
DIRECTION	MOUVEMENTS	signe	ECRITURE
DIRECTION	MOUVEMENTS	couleur	ECRITURE
DIRECTION	MOUVEMENTS	nb_mouvements	ECRITURE
DIRECTION	MOUVEMENTS	nb_lignes	ECRITURE
DIRECTION	MOUVEMENTS	nb_references	ECRITURE
DIRECTION	MOUVEMENTS	valeur_mad	ECRITURE
DIRECTION	MOUVEMENTS	designation	ECRITURE
DIRECTION	MOUVEMENTS	classe_abc	ECRITURE
DIRECTION	MOUVEMENTS	entrees_kg	ECRITURE
DIRECTION	MOUVEMENTS	sorties_kg	ECRITURE
DIRECTION	MOUVEMENTS	solde_kg	ECRITURE
DIRECTION	MOUVEMENTS	entrees_mad	ECRITURE
DIRECTION	MOUVEMENTS	nb_mois_actifs	ECRITURE
DIRECTION	MOUVEMENTS	premier_mouvement	ECRITURE
DIRECTION	MOUVEMENTS	dernier_mouvement	ECRITURE
DIRECTION	MOUVEMENTS	stock_actuel_kg	ECRITURE
DIRECTION	MOUVEMENTS	rotation	ECRITURE
DIRECTION	MOUVEMENTS	jours_sans_mouvement	ECRITURE
DIRECTION	VALORISATION	designation	ECRITURE
DIRECTION	VALORISATION	annee_mois	ECRITURE
DIRECTION	VALORISATION	code_devise	ECRITURE
DIRECTION	VALORISATION	nb_achats	ECRITURE
DIRECTION	VALORISATION	nb_fournisseurs	ECRITURE
DIRECTION	VALORISATION	prix_moyen_devise	ECRITURE
DIRECTION	VALORISATION	prix_moyen_mad	ECRITURE
DIRECTION	VALORISATION	taux_moyen	ECRITURE
DIRECTION	VALORISATION	prix_min_mad	ECRITURE
DIRECTION	VALORISATION	prix_max_mad	ECRITURE
DIRECTION	VALORISATION	classe_abc	ECRITURE
DIRECTION	VALORISATION	quantite_totale_kg	ECRITURE
DIRECTION	VALORISATION	montant_total_mad	ECRITURE
DIRECTION	VALORISATION	premier_achat	ECRITURE
DIRECTION	VALORISATION	dernier_achat	ECRITURE
DIRECTION	VALORISATION	premier_prix_mad	ECRITURE
DIRECTION	VALORISATION	dernier_prix_mad	ECRITURE
DIRECTION	VALORISATION	premier_prix_devise	ECRITURE
DIRECTION	VALORISATION	dernier_prix_devise	ECRITURE
DIRECTION	VALORISATION	derive_totale_pct	ECRITURE
DIRECTION	VALORISATION	derive_fournisseur_pct	ECRITURE
DIRECTION	VALORISATION	derive_change_pct	ECRITURE
DIRECTION	VALORISATION	impact_fournisseur_mad	ECRITURE
DIRECTION	FOURNISSEURS	fournisseur_nom	ECRITURE
DIRECTION	FOURNISSEURS	annee_mois	ECRITURE
DIRECTION	FOURNISSEURS	nb_receptions	ECRITURE
DIRECTION	FOURNISSEURS	nb_lignes	ECRITURE
DIRECTION	FOURNISSEURS	quantite_kg	ECRITURE
DIRECTION	FOURNISSEURS	montant_mad	ECRITURE
DIRECTION	FOURNISSEURS	taux_conformite_pct	ECRITURE
DIRECTION	FOURNISSEURS	nb_a_lheure	ECRITURE
DIRECTION	FOURNISSEURS	nb_mesurables	ECRITURE
DIRECTION	FOURNISSEURS	retard_moyen_jours	ECRITURE
DIRECTION	FOURNISSEURS	delai_reel_moyen_jours	ECRITURE
DIRECTION	FOURNISSEURS	nb_bc	ECRITURE
DIRECTION	FOURNISSEURS	montant_total_mad	ECRITURE
DIRECTION	FOURNISSEURS	nb_lignes_recues	ECRITURE
DIRECTION	FOURNISSEURS	taux_ponctualite_pct	ECRITURE
DIRECTION	FOURNISSEURS	ecart_pesee_moyen_pct	ECRITURE
DIRECTION	FOURNISSEURS	otif_pct	ECRITURE
DIRECTION	FOURNISSEURS	classement	ECRITURE
DIRECTION	QUALITES	qualite_nom	ECRITURE
DIRECTION	QUALITES	nb_composants	ECRITURE
DIRECTION	QUALITES	nb_sans_cmup	ECRITURE
DIRECTION	QUALITES	kg_m2_total	ECRITURE
DIRECTION	QUALITES	cout_matiere_m2_mad	ECRITURE
DIRECTION	QUALITES	ecart_poids_pct	ECRITURE
DIRECTION	QUALITES	m2_prevus	ECRITURE
DIRECTION	QUALITES	m2_realises	ECRITURE
DIRECTION	QUALITES	nb_mois_planifies	ECRITURE
DIRECTION	QUALITES	taux_realisation_pct	ECRITURE
DIRECTION	QUALITES	cout_matiere_plan_mad	ECRITURE
DIRECTION	QUALITES	somme_pct	ECRITURE
DIRECTION	CATALOGUE	code_groupe_equiv	ECRITURE
DIRECTION	CATALOGUE	groupe_libelle	ECRITURE
DIRECTION	CATALOGUE	priorite	ECRITURE
DIRECTION	CATALOGUE	est_preferentielle	ECRITURE
DIRECTION	CATALOGUE	stock_kg	ECRITURE
DIRECTION	CATALOGUE	stock_projete_kg	ECRITURE
DIRECTION	CATALOGUE	statut	ECRITURE
DIRECTION	CATALOGUE	besoin_12m_kg	ECRITURE
DIRECTION	CATALOGUE	equivalent_reference	ECRITURE
DIRECTION	CATALOGUE	equivalent_designation	ECRITURE
DIRECTION	CATALOGUE	equivalent_delai_jours	ECRITURE
DIRECTION	CATALOGUE	equivalent_priorite	ECRITURE
DIRECTION	CATALOGUE	equivalent_preferentielle	ECRITURE
DIRECTION	CATALOGUE	equivalent_unite	ECRITURE
DIRECTION	CATALOGUE	equivalent_prix_catalogue_kg	ECRITURE
DIRECTION	CATALOGUE	equivalent_devise	ECRITURE
DIRECTION	CATALOGUE	equivalent_stock_kg	ECRITURE
DIRECTION	CATALOGUE	equivalent_stock_projete_kg	ECRITURE
DIRECTION	CATALOGUE	equivalent_statut	ECRITURE
DIRECTION	CATALOGUE	equivalent_besoin_12m_kg	ECRITURE
DIRECTION	CATALOGUE	meme_fournisseur	ECRITURE
DIRECTION	CATALOGUE	interchangeable	ECRITURE
DIRECTION	CATALOGUE	libelle	ECRITURE
DIRECTION	CATALOGUE	description	ECRITURE
DIRECTION	CATALOGUE	nb_references	ECRITURE
DIRECTION	CATALOGUE	nb_fournisseurs	ECRITURE
DIRECTION	CATALOGUE	nb_unites	ECRITURE
DIRECTION	CATALOGUE	nb_densites	ECRITURE
DIRECTION	CATALOGUE	nb_categories	ECRITURE
DIRECTION	CATALOGUE	nb_preferentielles	ECRITURE
DIRECTION	CATALOGUE	nb_avec_stock	ECRITURE
DIRECTION	CATALOGUE	nb_avec_besoin	ECRITURE
DIRECTION	CATALOGUE	stock_cumule_kg	ECRITURE
DIRECTION	CATALOGUE	besoin_cumule_kg	ECRITURE
DIRECTION	CATALOGUE	qualification	ECRITURE
DIRECTION	CATALOGUE	ordre_affichage	ECRITURE
DIRECTION	CATALOGUE	code_role	ECRITURE
DIRECTION	MOUVEMENTS	actif	ECRITURE
DIRECTION	MOUVEMENTS	exige_motif_ligne	ECRITURE
DIRECTION	MOUVEMENTS	exige_of	ECRITURE
DIRECTION	MOUVEMENTS	exige_prix	ECRITURE
DIRECTION	MOUVEMENTS	impacte_cmup	ECRITURE
DIRECTION	MOUVEMENTS	libelle	ECRITURE
DIRECTION	MOUVEMENTS	categorie	ECRITURE
DIRECTION	MOUVEMENTS	signe_default	ECRITURE
DIRECTION	MOUVEMENTS	code_motif_ligne	ECRITURE
DIRECTION	STOCK	actif	ECRITURE
DIRECTION	STOCK	adresse	ECRITURE
DIRECTION	STOCK	est_quarantaine	ECRITURE
DIRECTION	STOCK	inclure_mrp	ECRITURE
DIRECTION	STOCK	nom	ECRITURE
DIRECTION	STOCK	responsable	ECRITURE
DIRECTION	STOCK	type	ECRITURE
DIRECTION	FOURNISSEURS	adresse	ECRITURE
DIRECTION	FOURNISSEURS	date_creation	ECRITURE
DIRECTION	FOURNISSEURS	incoterm	ECRITURE
DIRECTION	FOURNISSEURS	transporteur	ECRITURE
DIRECTION	CATALOGUE	date_creation	ECRITURE
DIRECTION	CATALOGUE	date_dernier_abc	ECRITURE
DIRECTION	CATALOGUE	date_dernier_cmup	ECRITURE
DIRECTION	CATALOGUE	date_prix_catalogue	ECRITURE
DIRECTION	CATALOGUE	date_debut	ECRITURE
DIRECTION	CATALOGUE	date_fin	ECRITURE
DIRECTION	MOUVEMENTS	numero_transfert	ECRITURE
DIRECTION	MOUVEMENTS	date_transfert	ECRITURE
DIRECTION	MOUVEMENTS	statut	ECRITURE
DIRECTION	MOUVEMENTS	code_magasin_source	ECRITURE
DIRECTION	MOUVEMENTS	code_magasin_dest	ECRITURE
DIRECTION	MOUVEMENTS	magasin_source_nom	ECRITURE
DIRECTION	MOUVEMENTS	magasin_dest_nom	ECRITURE
DIRECTION	MOUVEMENTS	date_sortie	ECRITURE
DIRECTION	MOUVEMENTS	date_reception_dest	ECRITURE
DIRECTION	MOUVEMENTS	responsable	ECRITURE
DIRECTION	MOUVEMENTS	transporteur	ECRITURE
DIRECTION	MOUVEMENTS	observations	ECRITURE
DIRECTION	MOUVEMENTS	auteur	ECRITURE
DIRECTION	MOUVEMENTS	expediteur	ECRITURE
DIRECTION	MOUVEMENTS	receptionnaire	ECRITURE
DIRECTION	MOUVEMENTS	jours_en_transit	ECRITURE
DIRECTION	MOUVEMENTS	ligne_numero	ECRITURE
DIRECTION	MOUVEMENTS	quantite_saisie	ECRITURE
DIRECTION	MOUVEMENTS	unite_saisie	ECRITURE
DIRECTION	MOUVEMENTS	nb_bobines	ECRITURE
DIRECTION	MOUVEMENTS	nb_palettes	ECRITURE
DIRECTION	MOUVEMENTS	quantite_totale_kg	ECRITURE
DIRECTION	MOUVEMENTS	bobines_totales	ECRITURE
DIRECTION	MOUVEMENTS	palettes_totales	ECRITURE
DIRECTION	MOUVEMENTS	valeur_totale_mad	ECRITURE
DIRECTION	MOUVEMENTS	magasin_nom	ECRITURE
DIRECTION	MOUVEMENTS	motif_libelle	ECRITURE
DIRECTION	MOUVEMENTS	reference_document	ECRITURE
DIRECTION	MOUVEMENTS	observations_globales	ECRITURE
DIRECTION	MOUVEMENTS	date_creation	ECRITURE
DIRECTION	MOUVEMENTS	jours_de_retard_saisie	ECRITURE
DIRECTION	MOUVEMENTS	saisi_par	ECRITURE
DIRECTION	MOUVEMENTS	rebut_kg	ECRITURE
DIRECTION	MOUVEMENTS	motif_ligne_libelle	ECRITURE
DIRECTION	MOUVEMENTS	est_initial	ECRITURE
DIRECTION	MOUVEMENTS	date_fabrication	ECRITURE
DIRECTION	MOUVEMENTS	statut_qualite	ECRITURE
DIRECTION	MOUVEMENTS	facteur_conversion	ECRITURE
DIRECTION	PLAN_ACHAT	figee	ECRITURE
DIRECTION	PLAN_ACHAT	figee_par	ECRITURE
DIRECTION	PLAN_ACHAT	date_figement	ECRITURE
DIRECTION	PLAN_ACHAT	motif_figement	ECRITURE
DIRECTION	PLAN_ACHAT	quantite_mrp_kg	ECRITURE
DIRECTION	PLAN_ACHAT	quantite_calculee_kg	ECRITURE
DIRECTION	PLAN_ACHAT	ecart_calcul_kg	ECRITURE
DIRECTION	PLAN_ACHAT	etat_figement	ECRITURE
DIRECTION	PARAMETRES	fichier	ECRITURE
DIRECTION	PARAMETRES	plateforme	ECRITURE
DIRECTION	PARAMETRES	version	ECRITURE
DIRECTION	PARAMETRES	taille_octets	ECRITURE
DIRECTION	PARAMETRES	date_telechargement	ECRITURE
DIRECTION	PARAMETRES	utilisateur	ECRITURE
DIRECTION	PARAMETRES	adresse_ip	ECRITURE
DIRECTION	PARAMETRES	disponible	ECRITURE
DIRECTION	PARAMETRES	nb_telechargements	ECRITURE
DIRECTION	PARAMETRES	code_parametre	ECRITURE
DIRECTION	PARAMETRES	libelle	ECRITURE
DIRECTION	PARAMETRES	valeur_courante	ECRITURE
DIRECTION	PARAMETRES	unite	ECRITURE
DIRECTION	PARAMETRES	categorie	ECRITURE
DIRECTION	PARAMETRES	verrouille	ECRITURE
DIRECTION	AUDIT	date_operation	ECRITURE
DIRECTION	AUDIT	table_concernee	ECRITURE
DIRECTION	AUDIT	operation	ECRITURE
DIRECTION	AUDIT	auteur	ECRITURE
DIRECTION	AUDIT	anciennes_valeurs	ECRITURE
DIRECTION	AUDIT	nouvelles_valeurs	ECRITURE
DIRECTION	AUDIT	adresse_ip	ECRITURE
DIRECTION	UTILISATEURS	login	ECRITURE
DIRECTION	UTILISATEURS	nom	ECRITURE
DIRECTION	UTILISATEURS	code_role_user	ECRITURE
DIRECTION	UTILISATEURS	email	ECRITURE
DIRECTION	UTILISATEURS	telephone	ECRITURE
DIRECTION	UTILISATEURS	magasin_principal	ECRITURE
DIRECTION	UTILISATEURS	derniere_connexion	ECRITURE
DIRECTION	UTILISATEURS	actif	ECRITURE
MAGASIN	CATALOGUE	code_reference	ECRITURE
MAGASIN	CATALOGUE	designation	ECRITURE
MAGASIN	CATALOGUE	code_categorie	ECRITURE
MAGASIN	CATALOGUE	code_role_defaut	ECRITURE
MAGASIN	CATALOGUE	code_fournisseur	ECRITURE
MAGASIN	CATALOGUE	fournisseur_nom	ECRITURE
MAGASIN	CATALOGUE	type_fil	ECRITURE
MAGASIN	CATALOGUE	couleur	ECRITURE
MAGASIN	CATALOGUE	titrage	ECRITURE
MAGASIN	CATALOGUE	unite_catalogue	ECRITURE
MAGASIN	CATALOGUE	poids_bobine_kg	ECRITURE
MAGASIN	CATALOGUE	bobines_par_palette	ECRITURE
MAGASIN	CATALOGUE	densite_kg_ml	ECRITURE
MAGASIN	CATALOGUE	facteur_kg	ECRITURE
MAGASIN	CATALOGUE	prix_catalogue	MASQUE
MAGASIN	CATALOGUE	code_devise_catalogue	MASQUE
MAGASIN	CATALOGUE	prix_catalogue_kg	MASQUE
MAGASIN	CATALOGUE	prix_kg_mad	MASQUE
MAGASIN	CATALOGUE	source_prix	MASQUE
MAGASIN	CATALOGUE	cmup_mad	MASQUE
MAGASIN	CATALOGUE	stock_min_kg	ECRITURE
MAGASIN	CATALOGUE	couverture_min_mois	ECRITURE
MAGASIN	CATALOGUE	marge_securite_pct	ECRITURE
MAGASIN	CATALOGUE	moq_kg	ECRITURE
MAGASIN	CATALOGUE	multiple_achat_kg	ECRITURE
MAGASIN	CATALOGUE	classe_abc	ECRITURE
MAGASIN	CATALOGUE	classe_xyz	ECRITURE
MAGASIN	CATALOGUE	suivi_lot	ECRITURE
MAGASIN	CATALOGUE	actif	ECRITURE
MAGASIN	FOURNISSEURS	code_fournisseur	ECRITURE
MAGASIN	FOURNISSEURS	nom	ECRITURE
MAGASIN	FOURNISSEURS	contact_principal	ECRITURE
MAGASIN	FOURNISSEURS	telephone	ECRITURE
MAGASIN	FOURNISSEURS	email	ECRITURE
MAGASIN	FOURNISSEURS	pays	ECRITURE
MAGASIN	FOURNISSEURS	ville	ECRITURE
MAGASIN	FOURNISSEURS	delai_livraison_jours	ECRITURE
MAGASIN	FOURNISSEURS	conditions_paiement	MASQUE
MAGASIN	FOURNISSEURS	delai_paiement_jours	MASQUE
MAGASIN	FOURNISSEURS	code_devise	ECRITURE
MAGASIN	FOURNISSEURS	note_globale	ECRITURE
MAGASIN	FOURNISSEURS	tolerance_pesee_pct	ECRITURE
MAGASIN	FOURNISSEURS	actif	ECRITURE
MAGASIN	STOCK	code_reference	ECRITURE
MAGASIN	STOCK	designation	ECRITURE
MAGASIN	STOCK	code_magasin	ECRITURE
MAGASIN	STOCK	quantite_kg	ECRITURE
MAGASIN	STOCK	cmup_mad	MASQUE
MAGASIN	STOCK	valeur_mad	MASQUE
MAGASIN	STOCK	date_derniere_entree	ECRITURE
MAGASIN	STOCK	date_derniere_sortie	ECRITURE
MAGASIN	STOCK	date_dernier_inventaire	ECRITURE
MAGASIN	STOCK	stock_projete_kg	ECRITURE
MAGASIN	STOCK	jours_couverture	ECRITURE
MAGASIN	STOCK	statut	ECRITURE
MAGASIN	STOCK	lot_fournisseur	ECRITURE
MAGASIN	STOCK	date_peremption	ECRITURE
MAGASIN	MOUVEMENTS	numero_mouvement	ECRITURE
MAGASIN	MOUVEMENTS	date_mouvement	ECRITURE
MAGASIN	MOUVEMENTS	code_type_mvt	ECRITURE
MAGASIN	MOUVEMENTS	code_magasin	ECRITURE
MAGASIN	MOUVEMENTS	code_motif	ECRITURE
MAGASIN	MOUVEMENTS	code_reference	ECRITURE
MAGASIN	MOUVEMENTS	quantite_kg	ECRITURE
MAGASIN	MOUVEMENTS	prix_kg_mad	MASQUE
MAGASIN	MOUVEMENTS	total_mad	MASQUE
MAGASIN	MOUVEMENTS	lot_fournisseur	ECRITURE
MAGASIN	MOUVEMENTS	numero_of	ECRITURE
MAGASIN	MOUVEMENTS	utilisateur	ECRITURE
MAGASIN	RECEPTIONS	numero_reception	ECRITURE
MAGASIN	RECEPTIONS	date_reception	ECRITURE
MAGASIN	RECEPTIONS	code_fournisseur	ECRITURE
MAGASIN	RECEPTIONS	num_bon_livraison	ECRITURE
MAGASIN	RECEPTIONS	code_reference	ECRITURE
MAGASIN	RECEPTIONS	unite_saisie	ECRITURE
MAGASIN	RECEPTIONS	quantite_pesee_unite	ECRITURE
MAGASIN	RECEPTIONS	quantite_stock_kg	ECRITURE
MAGASIN	RECEPTIONS	quantite_commandee_kg	ECRITURE
MAGASIN	RECEPTIONS	ecart_pct	ECRITURE
MAGASIN	RECEPTIONS	prix_kg_devise	MASQUE
MAGASIN	RECEPTIONS	code_devise	MASQUE
MAGASIN	RECEPTIONS	taux_change	MASQUE
MAGASIN	RECEPTIONS	prix_kg_mad	MASQUE
MAGASIN	RECEPTIONS	total_mad	MASQUE
MAGASIN	RECEPTIONS	total_devise	MASQUE
MAGASIN	RECEPTIONS	lot_fournisseur	ECRITURE
MAGASIN	RECEPTIONS	date_peremption	ECRITURE
MAGASIN	RECEPTIONS	statut_qualite	ECRITURE
MAGASIN	RECEPTIONS	code_magasin_dest	ECRITURE
MAGASIN	RECEPTIONS	fournisseur_nom	ECRITURE
MAGASIN	RECEPTIONS	numero_bc	ECRITURE
MAGASIN	RECEPTIONS	numero_facture	MASQUE
MAGASIN	RECEPTIONS	transporteur	ECRITURE
MAGASIN	RECEPTIONS	nombre_colis	ECRITURE
MAGASIN	RECEPTIONS	poids_total_brut_kg	ECRITURE
MAGASIN	RECEPTIONS	statut	ECRITURE
MAGASIN	RECEPTIONS	nb_lignes	ECRITURE
MAGASIN	RECEPTIONS	receptionnaire	ECRITURE
MAGASIN	RECEPTIONS	controleur	ECRITURE
MAGASIN	RECEPTIONS	date_controle	ECRITURE
MAGASIN	RECEPTIONS	quantite_bl_kg	ECRITURE
MAGASIN	RECEPTIONS	ecart_bl_kg	ECRITURE
MAGASIN	RECEPTIONS	ecart_cmd_kg	ECRITURE
MAGASIN	RECEPTIONS	nb_colis_ligne	ECRITURE
MAGASIN	RECEPTIONS	poids_moyen_colis_kg	ECRITURE
MAGASIN	RECEPTIONS	date_fabrication	ECRITURE
MAGASIN	RECEPTIONS	notes	ECRITURE
MAGASIN	RECEPTIONS	delai_reel_jours	ECRITURE
MAGASIN	RECEPTIONS	delai_prevu_jours	ECRITURE
MAGASIN	RECEPTIONS	retard_jours	ECRITURE
MAGASIN	RECEPTIONS	on_time	ECRITURE
MAGASIN	RECEPTIONS	in_full	ECRITURE
MAGASIN	RECEPTIONS	in_spec	ECRITURE
MAGASIN	RECEPTIONS	substitution_acceptee	ECRITURE
MAGASIN	RECEPTIONS	motif_substitution	ECRITURE
MAGASIN	RECEPTIONS	reference_commandee	ECRITURE
MAGASIN	RECEPTIONS	est_substitution	ECRITURE
MAGASIN	RECEPTIONS	equivalents_recevables	ECRITURE
MAGASIN	BONS_COMMANDE	numero_bc	ECRITURE
MAGASIN	BONS_COMMANDE	date_bc	ECRITURE
MAGASIN	BONS_COMMANDE	code_fournisseur	ECRITURE
MAGASIN	BONS_COMMANDE	statut	ECRITURE
MAGASIN	BONS_COMMANDE	code_devise	MASQUE
MAGASIN	BONS_COMMANDE	taux_change_engage	MASQUE
MAGASIN	BONS_COMMANDE	montant_total_devise	MASQUE
MAGASIN	BONS_COMMANDE	montant_total_mad	MASQUE
MAGASIN	BONS_COMMANDE	code_reference	ECRITURE
MAGASIN	BONS_COMMANDE	unite_commande	ECRITURE
MAGASIN	BONS_COMMANDE	quantite_commandee_unite	ECRITURE
MAGASIN	BONS_COMMANDE	quantite_commandee_kg	ECRITURE
MAGASIN	BONS_COMMANDE	quantite_recue_kg	ECRITURE
MAGASIN	BONS_COMMANDE	prix_unitaire_devise	MASQUE
MAGASIN	BONS_COMMANDE	total_ligne_devise	MASQUE
MAGASIN	BONS_COMMANDE	date_livraison_prevue	ECRITURE
MAGASIN	BONS_COMMANDE	besoin_kg_origine	ECRITURE
MAGASIN	BONS_COMMANDE	besoin_kg_actuel	ECRITURE
MAGASIN	BONS_COMMANDE	ecart_besoin_kg	ECRITURE
MAGASIN	BONS_COMMANDE	arbitree	ECRITURE
MAGASIN	BONS_COMMANDE	fournisseur_nom	ECRITURE
MAGASIN	BONS_COMMANDE	devise_fournisseur	ECRITURE
MAGASIN	BONS_COMMANDE	nb_lignes	ECRITURE
MAGASIN	BONS_COMMANDE	date_envoi	ECRITURE
MAGASIN	BONS_COMMANDE	date_validation	ECRITURE
MAGASIN	BONS_COMMANDE	createur	ECRITURE
MAGASIN	BONS_COMMANDE	valideur	ECRITURE
MAGASIN	BONS_COMMANDE	motif_creation	ECRITURE
MAGASIN	BONS_COMMANDE	conditions_paiement	ECRITURE
MAGASIN	BONS_COMMANDE	notes	ECRITURE
MAGASIN	BONS_COMMANDE	quantite_recue_kg_bc	ECRITURE
MAGASIN	BONS_COMMANDE	reste_a_livrer_kg	ECRITURE
MAGASIN	BONS_COMMANDE	pct_livre	ECRITURE
MAGASIN	BONS_COMMANDE	statut_livraison	ECRITURE
MAGASIN	BONS_COMMANDE	equivalent_de	ECRITURE
MAGASIN	BONS_COMMANDE	besoin_equivalent_kg	ECRITURE
MAGASIN	BONS_COMMANDE	nb_equivalents	ECRITURE
MAGASIN	BONS_COMMANDE	statut_ligne	ECRITURE
MAGASIN	PLAN_ACHAT	fournisseur_nom	ECRITURE
MAGASIN	PLAN_ACHAT	unite_saisie	ECRITURE
MAGASIN	PLAN_ACHAT	risque_identifie	ECRITURE
MAGASIN	PLAN_ACHAT	action_recommandee	ECRITURE
MAGASIN	PLAN_ACHAT	commentaires	ECRITURE
MAGASIN	PLAN_ACHAT	date_generation	ECRITURE
MAGASIN	CATALOGUE	date_achat	ECRITURE
MAGASIN	CATALOGUE	prix_kg_devise	MASQUE
MAGASIN	CATALOGUE	prix_precedent_mad	MASQUE
MAGASIN	CATALOGUE	quantite_achetee_kg	ECRITURE
MAGASIN	CATALOGUE	total_mad	MASQUE
MAGASIN	CATALOGUE	numero_bc	ECRITURE
MAGASIN	PLANS	cree_par	ECRITURE
MAGASIN	CATALOGUE	numero_reception	ECRITURE
MAGASIN	PLAN_ACHAT	id_proposition	ECRITURE
MAGASIN	PLAN_ACHAT	code_reference	ECRITURE
MAGASIN	PLAN_ACHAT	quantite_suggeree_kg	ECRITURE
MAGASIN	PLAN_ACHAT	quantite_suggeree_unite	ECRITURE
MAGASIN	PLAN_ACHAT	urgence	ECRITURE
MAGASIN	PLAN_ACHAT	date_besoin_prevue	ECRITURE
MAGASIN	PLAN_ACHAT	montant_total_mad	MASQUE
MAGASIN	PLAN_ACHAT	numero_bc	ECRITURE
MAGASIN	PLAN_ACHAT	statut_bc	ECRITURE
MAGASIN	PLAN_ACHAT	designation	ECRITURE
MAGASIN	PLAN_ACHAT	code_fournisseur	ECRITURE
MAGASIN	PLAN_ACHAT	statut	ECRITURE
MAGASIN	PLAN_ACHAT	stock_projete_kg	ECRITURE
MAGASIN	PLAN_ACHAT	stock_min_kg	ECRITURE
MAGASIN	PLAN_ACHAT	qte_a_commander_kg	ECRITURE
MAGASIN	PLAN_ACHAT	prix_estime_mad	MASQUE
MAGASIN	PLAN_ACHAT	source_prix	MASQUE
MAGASIN	PLAN_ACHAT	montant_estime_mad	MASQUE
MAGASIN	PLAN_ACHAT	tier	ECRITURE
MAGASIN	PLAN_ACHAT	risque_sourcing	ECRITURE
MAGASIN	PLAN_ACHAT	jours_couverture	ECRITURE
MAGASIN	PLAN_ACHAT	code_reference_origine	ECRITURE
MAGASIN	PLAN_ACHAT	designation_origine	ECRITURE
MAGASIN	PLAN_ACHAT	motif_substitution	ECRITURE
MAGASIN	PLAN_ACHAT	nb_equivalents	ECRITURE
MAGASIN	PLAN_ACHAT	equivalent_dispo_kg	ECRITURE
MAGASIN	QUALITES	code_qualite	ECRITURE
MAGASIN	QUALITES	nom	ECRITURE
MAGASIN	QUALITES	description	ECRITURE
MAGASIN	QUALITES	statut	ECRITURE
MAGASIN	QUALITES	poids_commercial_m2	ECRITURE
MAGASIN	QUALITES	code_role	ECRITURE
MAGASIN	QUALITES	role_libelle	ECRITURE
MAGASIN	QUALITES	densite	ECRITURE
MAGASIN	QUALITES	unite_densite	ECRITURE
MAGASIN	QUALITES	entre_poids_commercial	ECRITURE
MAGASIN	QUALITES	code_reference	ECRITURE
MAGASIN	QUALITES	designation	ECRITURE
MAGASIN	QUALITES	pourcentage_composition	ECRITURE
MAGASIN	QUALITES	couleur	ECRITURE
MAGASIN	QUALITES	code_groupe_equiv	ECRITURE
MAGASIN	QUALITES	code_fournisseur_prefere	ECRITURE
MAGASIN	QUALITES	ligne_numero	ECRITURE
MAGASIN	QUALITES	kg_m2	ECRITURE
MAGASIN	QUALITES	type_fil	ECRITURE
MAGASIN	QUALITES	categorie	ECRITURE
MAGASIN	QUALITES	fournisseur	ECRITURE
MAGASIN	QUALITES	prix_kg_mad	MASQUE
MAGASIN	QUALITES	code_devise_catalogue	MASQUE
MAGASIN	QUALITES	cout_m2_mad	MASQUE
MAGASIN	QUALITES	source_prix	MASQUE
MAGASIN	QUALITES	marge_securite_pct	ECRITURE
MAGASIN	QUALITES	couv_min_mois	ECRITURE
MAGASIN	QUALITES	taux_perte_pct	ECRITURE
MAGASIN	QUALITES	seuil_alerte_jours	ECRITURE
MAGASIN	QUALITES	seuil_critique_jours	ECRITURE
MAGASIN	QUALITES	stock_securite_jours	ECRITURE
MAGASIN	QUALITES	actif	ECRITURE
MAGASIN	QUALITES	nb_roles	ECRITURE
MAGASIN	QUALITES	nb_composition	ECRITURE
MAGASIN	QUALITES	nb_roles_composes	ECRITURE
MAGASIN	QUALITES	nb_roles_hors_100	ECRITURE
MAGASIN	QUALITES	nb_lignes_plan	ECRITURE
MAGASIN	QUALITES	date_creation	ECRITURE
MAGASIN	QUALITES	cree_par	ECRITURE
MAGASIN	QUALITES	date_modification	ECRITURE
MAGASIN	QUALITES	modifie_par	ECRITURE
MAGASIN	QUALITES	date_cloture	ECRITURE
MAGASIN	RECETTES	code_qualite	ECRITURE
MAGASIN	RECETTES	qualite_nom	ECRITURE
MAGASIN	RECETTES	ligne_numero	ECRITURE
MAGASIN	RECETTES	code_reference	ECRITURE
MAGASIN	RECETTES	designation	ECRITURE
MAGASIN	RECETTES	code_role	ECRITURE
MAGASIN	RECETTES	role_libelle	ECRITURE
MAGASIN	RECETTES	pourcentage_composition	ECRITURE
MAGASIN	RECETTES	couleur	ECRITURE
MAGASIN	RECETTES	densite_role	ECRITURE
MAGASIN	RECETTES	unite_densite	ECRITURE
MAGASIN	RECETTES	kg_m2	ECRITURE
MAGASIN	RECETTES	code_groupe_equiv	ECRITURE
MAGASIN	RECETTES	statut_qualite	ECRITURE
MAGASIN	RECETTES	code_fournisseur	ECRITURE
MAGASIN	RECETTES	fournisseur	ECRITURE
MAGASIN	RECETTES	code_fournisseur_prefere	ECRITURE
MAGASIN	PLANS	annee	ECRITURE
MAGASIN	PLANS	numero_version	ECRITURE
MAGASIN	PLANS	libelle	ECRITURE
MAGASIN	PLANS	scenario_nom	ECRITURE
MAGASIN	PLANS	statut	ECRITURE
MAGASIN	PLANS	actif	ECRITURE
MAGASIN	PLANS	date_debut	ECRITURE
MAGASIN	PLANS	date_fin	ECRITURE
MAGASIN	PLANS	mois_horizon	ECRITURE
MAGASIN	PLANS	croissance_annuelle_pct	ECRITURE
MAGASIN	PLANS	mois	ECRITURE
MAGASIN	PLANS	rang_mois	ECRITURE
MAGASIN	PLANS	annee_mois	ECRITURE
MAGASIN	PLANS	code_qualite	ECRITURE
MAGASIN	PLANS	qualite_nom	ECRITURE
MAGASIN	PLANS	m2_base_mensuel	ECRITURE
MAGASIN	PLANS	m2_prevus	ECRITURE
MAGASIN	PLANS	saisonnalite	ECRITURE
MAGASIN	PLANS	coefficient	ECRITURE
MAGASIN	PLANS	facteur_croissance	ECRITURE
MAGASIN	PLANS	m2_realises	ECRITURE
MAGASIN	PLANS	taux_perte_pct	ECRITURE
MAGASIN	PLANS	m2_total_annuel	ECRITURE
MAGASIN	PLANS	m2_total	ECRITURE
MAGASIN	PLANS	nb_lignes	ECRITURE
MAGASIN	PLANS	nb_qualites	ECRITURE
MAGASIN	PLANS	nb_qualites_perimees	ECRITURE
MAGASIN	PLANS	nb_besoins	ECRITURE
MAGASIN	PLANS	date_creation	ECRITURE
MAGASIN	PLANS	date_modification	ECRITURE
MAGASIN	PLANS	modifie_par	ECRITURE
MAGASIN	PLANS	date_validation	ECRITURE
MAGASIN	PLANS	valide_par	ECRITURE
MAGASIN	PLANS	date_cloture	ECRITURE
MAGASIN	PLANS	cloture_par	ECRITURE
MAGASIN	MRP	code_reference	ECRITURE
MAGASIN	MRP	designation	ECRITURE
MAGASIN	MRP	mois	ECRITURE
MAGASIN	MRP	quantite_brute_kg	ECRITURE
MAGASIN	MRP	taux_perte_applique	ECRITURE
MAGASIN	MRP	quantite_kg	ECRITURE
MAGASIN	MRP	code_fournisseur	ECRITURE
MAGASIN	INVENTAIRE	numero_inventaire	ECRITURE
MAGASIN	INVENTAIRE	date_inventaire	ECRITURE
MAGASIN	INVENTAIRE	type_inventaire	ECRITURE
MAGASIN	INVENTAIRE	code_magasin	ECRITURE
MAGASIN	INVENTAIRE	statut	ECRITURE
MAGASIN	INVENTAIRE	code_reference	ECRITURE
MAGASIN	INVENTAIRE	quantite_theorique_kg	ECRITURE
MAGASIN	INVENTAIRE	quantite_comptee_kg	ECRITURE
MAGASIN	INVENTAIRE	ecart_kg	ECRITURE
MAGASIN	INVENTAIRE	ecart_pct	ECRITURE
MAGASIN	INVENTAIRE	ecart_mad	MASQUE
MAGASIN	INVENTAIRE	motif_ecart	ECRITURE
MAGASIN	VALORISATION	code_reference	MASQUE
MAGASIN	VALORISATION	code_magasin	MASQUE
MAGASIN	VALORISATION	quantite_kg	MASQUE
MAGASIN	VALORISATION	cmup_mad	MASQUE
MAGASIN	VALORISATION	valeur_mad	MASQUE
MAGASIN	COCKPIT	nb_ruptures	ECRITURE
MAGASIN	COCKPIT	nb_critiques	ECRITURE
MAGASIN	COCKPIT	nb_attention	ECRITURE
MAGASIN	COCKPIT	nb_ok	ECRITURE
MAGASIN	COCKPIT	nb_references	ECRITURE
MAGASIN	COCKPIT	valeur_stock_mad	MASQUE
MAGASIN	COCKPIT	nb_refs_a_commander	ECRITURE
MAGASIN	COCKPIT	budget_a_engager_mad	MASQUE
MAGASIN	COCKPIT	nb_classe_a_alerte	ECRITURE
MAGASIN	COCKPIT	nb_tier1	ECRITURE
MAGASIN	COCKPIT	nb_fournisseurs_actifs	ECRITURE
MAGASIN	COCKPIT	nb_bc_ouverts	ECRITURE
MAGASIN	COCKPIT	montant_bc_ouverts_mad	MASQUE
MAGASIN	COCKPIT	nb_alertes_critiques	ECRITURE
MAGASIN	COCKPIT	nb_propositions_a_traiter	ECRITURE
MAGASIN	COCKPIT	nb_bc_en_preparation	ECRITURE
MAGASIN	COCKPIT	nb_bc_a_valider	ECRITURE
MAGASIN	COCKPIT	montant_bc_a_valider_mad	MASQUE
MAGASIN	COCKPIT	nb_bc_a_envoyer	ECRITURE
MAGASIN	COCKPIT	nb_livraisons_en_retard	ECRITURE
MAGASIN	COCKPIT	retard_max_jours	ECRITURE
MAGASIN	COCKPIT	nb_receptions_en_saisie	ECRITURE
MAGASIN	COCKPIT	nb_receptions_a_controler	ECRITURE
MAGASIN	COCKPIT	nb_lignes_non_conformes	ECRITURE
MAGASIN	COCKPIT	nb_receptions_a_regulariser	ECRITURE
MAGASIN	COCKPIT	nb_refs_sous_minimum	ECRITURE
MAGASIN	COCKPIT	nb_refs_dormantes	ECRITURE
MAGASIN	COCKPIT	valeur_dormante_mad	MASQUE
MAGASIN	FOURNISSEURS	nb_references	ECRITURE
MAGASIN	COCKPIT	nb_lots_peremption_proche	ECRITURE
MAGASIN	COCKPIT	nb_controles_bloquants	ECRITURE
MAGASIN	COCKPIT	nb_controles_critiques	ECRITURE
MAGASIN	COCKPIT	nb_alertes_ouvertes	ECRITURE
MAGASIN	COCKPIT	code_reference	ECRITURE
MAGASIN	COCKPIT	designation	ECRITURE
MAGASIN	COCKPIT	classe_abc	ECRITURE
MAGASIN	COCKPIT	code_fournisseur	ECRITURE
MAGASIN	COCKPIT	fournisseur_nom	ECRITURE
MAGASIN	COCKPIT	delai_livraison_jours	ECRITURE
MAGASIN	COCKPIT	risque_sourcing	ECRITURE
MAGASIN	COCKPIT	stock_min_kg	ECRITURE
MAGASIN	COCKPIT	stock_initial_kg	ECRITURE
MAGASIN	COCKPIT	nb_mois_rupture	ECRITURE
MAGASIN	COCKPIT	nb_mois_tendu	ECRITURE
MAGASIN	COCKPIT	premier_mois_rupture	ECRITURE
MAGASIN	COCKPIT	premier_mois_risque	ECRITURE
MAGASIN	COCKPIT	rang_premier_risque	ECRITURE
MAGASIN	COCKPIT	marge_decision_jours	ECRITURE
MAGASIN	COCKPIT	mois	ECRITURE
MAGASIN	COCKPIT	annee_mois	ECRITURE
MAGASIN	COCKPIT	rang_mois	ECRITURE
MAGASIN	COCKPIT	besoin_kg	ECRITURE
MAGASIN	COCKPIT	entrees_kg	ECRITURE
MAGASIN	COCKPIT	stock_fin_kg	ECRITURE
MAGASIN	COCKPIT	statut	ECRITURE
MAGASIN	MOUVEMENTS	annee_mois	ECRITURE
MAGASIN	MOUVEMENTS	type_libelle	ECRITURE
MAGASIN	MOUVEMENTS	signe	ECRITURE
MAGASIN	MOUVEMENTS	couleur	ECRITURE
MAGASIN	MOUVEMENTS	nb_mouvements	ECRITURE
MAGASIN	MOUVEMENTS	nb_lignes	ECRITURE
MAGASIN	MOUVEMENTS	nb_references	ECRITURE
MAGASIN	MOUVEMENTS	valeur_mad	MASQUE
MAGASIN	MOUVEMENTS	designation	ECRITURE
MAGASIN	MOUVEMENTS	classe_abc	ECRITURE
MAGASIN	MOUVEMENTS	entrees_kg	ECRITURE
MAGASIN	MOUVEMENTS	sorties_kg	ECRITURE
MAGASIN	MOUVEMENTS	solde_kg	ECRITURE
MAGASIN	MOUVEMENTS	nb_mois_actifs	ECRITURE
MAGASIN	MOUVEMENTS	premier_mouvement	ECRITURE
MAGASIN	MOUVEMENTS	dernier_mouvement	ECRITURE
MAGASIN	MOUVEMENTS	stock_actuel_kg	ECRITURE
MAGASIN	MOUVEMENTS	rotation	ECRITURE
MAGASIN	MOUVEMENTS	jours_sans_mouvement	ECRITURE
MAGASIN	VALORISATION	designation	MASQUE
MAGASIN	VALORISATION	annee_mois	MASQUE
MAGASIN	VALORISATION	code_devise	MASQUE
MAGASIN	VALORISATION	nb_achats	MASQUE
MAGASIN	VALORISATION	nb_fournisseurs	MASQUE
MAGASIN	VALORISATION	prix_moyen_devise	MASQUE
MAGASIN	VALORISATION	prix_moyen_mad	MASQUE
MAGASIN	VALORISATION	taux_moyen	MASQUE
MAGASIN	VALORISATION	prix_min_mad	MASQUE
MAGASIN	VALORISATION	prix_max_mad	MASQUE
MAGASIN	VALORISATION	classe_abc	MASQUE
MAGASIN	VALORISATION	quantite_totale_kg	MASQUE
MAGASIN	VALORISATION	montant_total_mad	MASQUE
MAGASIN	VALORISATION	premier_achat	MASQUE
MAGASIN	VALORISATION	dernier_achat	MASQUE
MAGASIN	VALORISATION	premier_prix_mad	MASQUE
MAGASIN	VALORISATION	dernier_prix_mad	MASQUE
MAGASIN	VALORISATION	premier_prix_devise	MASQUE
MAGASIN	VALORISATION	dernier_prix_devise	MASQUE
MAGASIN	VALORISATION	derive_totale_pct	MASQUE
MAGASIN	VALORISATION	derive_fournisseur_pct	MASQUE
MAGASIN	VALORISATION	derive_change_pct	MASQUE
MAGASIN	VALORISATION	impact_fournisseur_mad	MASQUE
MAGASIN	FOURNISSEURS	fournisseur_nom	ECRITURE
MAGASIN	FOURNISSEURS	annee_mois	ECRITURE
MAGASIN	FOURNISSEURS	nb_receptions	ECRITURE
MAGASIN	FOURNISSEURS	nb_lignes	ECRITURE
MAGASIN	FOURNISSEURS	quantite_kg	ECRITURE
MAGASIN	FOURNISSEURS	montant_mad	MASQUE
MAGASIN	FOURNISSEURS	taux_conformite_pct	ECRITURE
MAGASIN	FOURNISSEURS	nb_a_lheure	ECRITURE
MAGASIN	FOURNISSEURS	nb_mesurables	ECRITURE
MAGASIN	FOURNISSEURS	retard_moyen_jours	ECRITURE
MAGASIN	FOURNISSEURS	delai_reel_moyen_jours	ECRITURE
MAGASIN	FOURNISSEURS	nb_bc	ECRITURE
MAGASIN	FOURNISSEURS	montant_total_mad	MASQUE
MAGASIN	FOURNISSEURS	nb_lignes_recues	ECRITURE
MAGASIN	FOURNISSEURS	taux_ponctualite_pct	ECRITURE
MAGASIN	FOURNISSEURS	ecart_pesee_moyen_pct	ECRITURE
MAGASIN	FOURNISSEURS	otif_pct	ECRITURE
MAGASIN	FOURNISSEURS	classement	ECRITURE
MAGASIN	QUALITES	qualite_nom	ECRITURE
MAGASIN	QUALITES	nb_composants	ECRITURE
MAGASIN	QUALITES	nb_sans_cmup	ECRITURE
MAGASIN	QUALITES	kg_m2_total	ECRITURE
MAGASIN	QUALITES	cout_matiere_m2_mad	MASQUE
MAGASIN	QUALITES	ecart_poids_pct	ECRITURE
MAGASIN	QUALITES	m2_prevus	ECRITURE
MAGASIN	QUALITES	m2_realises	ECRITURE
MAGASIN	QUALITES	nb_mois_planifies	ECRITURE
MAGASIN	QUALITES	taux_realisation_pct	ECRITURE
MAGASIN	QUALITES	cout_matiere_plan_mad	MASQUE
MAGASIN	QUALITES	somme_pct	ECRITURE
MAGASIN	CATALOGUE	code_groupe_equiv	ECRITURE
MAGASIN	CATALOGUE	groupe_libelle	ECRITURE
MAGASIN	CATALOGUE	priorite	ECRITURE
MAGASIN	CATALOGUE	est_preferentielle	ECRITURE
MAGASIN	CATALOGUE	stock_kg	ECRITURE
MAGASIN	CATALOGUE	stock_projete_kg	ECRITURE
MAGASIN	CATALOGUE	statut	ECRITURE
MAGASIN	CATALOGUE	besoin_12m_kg	ECRITURE
MAGASIN	CATALOGUE	equivalent_reference	ECRITURE
MAGASIN	CATALOGUE	equivalent_designation	ECRITURE
MAGASIN	CATALOGUE	equivalent_delai_jours	ECRITURE
MAGASIN	CATALOGUE	equivalent_priorite	ECRITURE
MAGASIN	CATALOGUE	equivalent_preferentielle	ECRITURE
MAGASIN	CATALOGUE	equivalent_unite	ECRITURE
MAGASIN	CATALOGUE	equivalent_prix_catalogue_kg	MASQUE
MAGASIN	CATALOGUE	equivalent_devise	ECRITURE
MAGASIN	CATALOGUE	equivalent_stock_kg	ECRITURE
MAGASIN	CATALOGUE	equivalent_stock_projete_kg	ECRITURE
MAGASIN	CATALOGUE	equivalent_statut	ECRITURE
MAGASIN	CATALOGUE	equivalent_besoin_12m_kg	ECRITURE
MAGASIN	CATALOGUE	meme_fournisseur	ECRITURE
MAGASIN	CATALOGUE	interchangeable	ECRITURE
MAGASIN	CATALOGUE	libelle	ECRITURE
MAGASIN	CATALOGUE	description	ECRITURE
MAGASIN	CATALOGUE	nb_references	ECRITURE
MAGASIN	CATALOGUE	nb_fournisseurs	ECRITURE
MAGASIN	CATALOGUE	nb_unites	ECRITURE
MAGASIN	CATALOGUE	nb_densites	ECRITURE
MAGASIN	CATALOGUE	nb_categories	ECRITURE
MAGASIN	CATALOGUE	nb_preferentielles	ECRITURE
MAGASIN	CATALOGUE	nb_avec_stock	ECRITURE
MAGASIN	CATALOGUE	nb_avec_besoin	ECRITURE
MAGASIN	CATALOGUE	stock_cumule_kg	ECRITURE
MAGASIN	CATALOGUE	besoin_cumule_kg	ECRITURE
MAGASIN	CATALOGUE	qualification	ECRITURE
MAGASIN	CATALOGUE	ordre_affichage	ECRITURE
MAGASIN	CATALOGUE	code_role	ECRITURE
MAGASIN	MOUVEMENTS	actif	ECRITURE
MAGASIN	MOUVEMENTS	exige_motif_ligne	ECRITURE
MAGASIN	MOUVEMENTS	exige_of	ECRITURE
MAGASIN	MOUVEMENTS	exige_prix	MASQUE
MAGASIN	MOUVEMENTS	impacte_cmup	ECRITURE
MAGASIN	MOUVEMENTS	libelle	ECRITURE
MAGASIN	MOUVEMENTS	categorie	ECRITURE
MAGASIN	STOCK	kg_sur_machine	LECTURE
MAGASIN	MOUVEMENTS	signe_default	ECRITURE
MAGASIN	MOUVEMENTS	code_motif_ligne	ECRITURE
MAGASIN	STOCK	actif	ECRITURE
MAGASIN	STOCK	adresse	ECRITURE
MAGASIN	STOCK	est_quarantaine	ECRITURE
MAGASIN	STOCK	inclure_mrp	ECRITURE
MAGASIN	STOCK	nom	ECRITURE
MAGASIN	STOCK	responsable	ECRITURE
MAGASIN	STOCK	type	ECRITURE
MAGASIN	FOURNISSEURS	adresse	ECRITURE
MAGASIN	FOURNISSEURS	date_creation	ECRITURE
MAGASIN	FOURNISSEURS	incoterm	ECRITURE
MAGASIN	FOURNISSEURS	transporteur	ECRITURE
MAGASIN	CATALOGUE	date_creation	ECRITURE
MAGASIN	CATALOGUE	date_dernier_abc	ECRITURE
MAGASIN	CATALOGUE	date_dernier_cmup	ECRITURE
MAGASIN	CATALOGUE	date_prix_catalogue	MASQUE
MAGASIN	CATALOGUE	date_debut	ECRITURE
MAGASIN	CATALOGUE	date_fin	ECRITURE
MAGASIN	MOUVEMENTS	numero_transfert	ECRITURE
MAGASIN	MOUVEMENTS	date_transfert	ECRITURE
MAGASIN	MOUVEMENTS	statut	ECRITURE
MAGASIN	MOUVEMENTS	code_magasin_source	ECRITURE
MAGASIN	MOUVEMENTS	code_magasin_dest	ECRITURE
MAGASIN	MOUVEMENTS	magasin_source_nom	ECRITURE
MAGASIN	MOUVEMENTS	magasin_dest_nom	ECRITURE
MAGASIN	MOUVEMENTS	date_sortie	ECRITURE
MAGASIN	MOUVEMENTS	date_reception_dest	ECRITURE
MAGASIN	MOUVEMENTS	responsable	ECRITURE
MAGASIN	MOUVEMENTS	transporteur	ECRITURE
MAGASIN	MOUVEMENTS	observations	ECRITURE
MAGASIN	MOUVEMENTS	auteur	ECRITURE
MAGASIN	MOUVEMENTS	expediteur	ECRITURE
MAGASIN	MOUVEMENTS	receptionnaire	ECRITURE
MAGASIN	MOUVEMENTS	jours_en_transit	ECRITURE
MAGASIN	MOUVEMENTS	ligne_numero	ECRITURE
MAGASIN	MOUVEMENTS	quantite_saisie	ECRITURE
MAGASIN	MOUVEMENTS	unite_saisie	ECRITURE
MAGASIN	MOUVEMENTS	nb_bobines	ECRITURE
MAGASIN	MOUVEMENTS	nb_palettes	ECRITURE
MAGASIN	MOUVEMENTS	quantite_totale_kg	ECRITURE
MAGASIN	MOUVEMENTS	bobines_totales	ECRITURE
MAGASIN	MOUVEMENTS	palettes_totales	ECRITURE
MAGASIN	MOUVEMENTS	valeur_totale_mad	MASQUE
MAGASIN	MOUVEMENTS	magasin_nom	ECRITURE
MAGASIN	MOUVEMENTS	motif_libelle	ECRITURE
MAGASIN	MOUVEMENTS	reference_document	ECRITURE
MAGASIN	MOUVEMENTS	observations_globales	ECRITURE
MAGASIN	MOUVEMENTS	date_creation	ECRITURE
MAGASIN	MOUVEMENTS	jours_de_retard_saisie	ECRITURE
MAGASIN	MOUVEMENTS	saisi_par	ECRITURE
MAGASIN	MOUVEMENTS	rebut_kg	ECRITURE
MAGASIN	MOUVEMENTS	motif_ligne_libelle	ECRITURE
MAGASIN	MOUVEMENTS	est_initial	ECRITURE
MAGASIN	MOUVEMENTS	date_fabrication	ECRITURE
MAGASIN	MOUVEMENTS	statut_qualite	ECRITURE
MAGASIN	MOUVEMENTS	facteur_conversion	ECRITURE
MAGASIN	PLAN_ACHAT	figee	ECRITURE
MAGASIN	PLAN_ACHAT	figee_par	ECRITURE
MAGASIN	PLAN_ACHAT	date_figement	ECRITURE
MAGASIN	PLAN_ACHAT	motif_figement	ECRITURE
MAGASIN	PLAN_ACHAT	quantite_mrp_kg	ECRITURE
MAGASIN	PLAN_ACHAT	quantite_calculee_kg	ECRITURE
MAGASIN	PLAN_ACHAT	ecart_calcul_kg	ECRITURE
MAGASIN	PLAN_ACHAT	etat_figement	ECRITURE
MAGASIN	PARAMETRES	fichier	ECRITURE
MAGASIN	PARAMETRES	plateforme	ECRITURE
MAGASIN	PARAMETRES	version	ECRITURE
MAGASIN	PARAMETRES	taille_octets	ECRITURE
MAGASIN	PARAMETRES	date_telechargement	ECRITURE
MAGASIN	PARAMETRES	utilisateur	ECRITURE
MAGASIN	PARAMETRES	adresse_ip	ECRITURE
MAGASIN	PARAMETRES	disponible	ECRITURE
MAGASIN	PARAMETRES	nb_telechargements	ECRITURE
MAGASIN	PARAMETRES	code_parametre	ECRITURE
MAGASIN	PARAMETRES	libelle	ECRITURE
MAGASIN	PARAMETRES	valeur_courante	ECRITURE
MAGASIN	PARAMETRES	unite	ECRITURE
MAGASIN	PARAMETRES	categorie	ECRITURE
MAGASIN	PARAMETRES	verrouille	ECRITURE
MAGASIN	AUDIT	date_operation	MASQUE
MAGASIN	AUDIT	table_concernee	MASQUE
MAGASIN	AUDIT	operation	MASQUE
MAGASIN	AUDIT	auteur	MASQUE
MAGASIN	AUDIT	anciennes_valeurs	MASQUE
MAGASIN	AUDIT	nouvelles_valeurs	MASQUE
MAGASIN	AUDIT	adresse_ip	MASQUE
MAGASIN	UTILISATEURS	login	MASQUE
MAGASIN	UTILISATEURS	nom	MASQUE
MAGASIN	UTILISATEURS	code_role_user	MASQUE
MAGASIN	UTILISATEURS	email	MASQUE
MAGASIN	UTILISATEURS	telephone	MASQUE
MAGASIN	UTILISATEURS	magasin_principal	MASQUE
MAGASIN	UTILISATEURS	derniere_connexion	MASQUE
MAGASIN	UTILISATEURS	actif	MASQUE
DIRECTION	CATALOGUE	prix_moyen_mad	ECRITURE
MAGASIN	CATALOGUE	prix_moyen_mad	MASQUE
DIRECTION	CATALOGUE	annee_mois	ECRITURE
MAGASIN	CATALOGUE	annee_mois	ECRITURE
DIRECTION	CATALOGUE	quantite_kg	ECRITURE
MAGASIN	CATALOGUE	quantite_kg	ECRITURE
DIRECTION	CATALOGUE	nb_achats	ECRITURE
MAGASIN	CATALOGUE	nb_achats	ECRITURE
DIRECTION	VALORISATION	premier_taux	ECRITURE
DIRECTION	VALORISATION	dernier_taux	ECRITURE
DIRECTION	CATALOGUE	equivalent_fournisseur	ECRITURE
DIRECTION	CATALOGUE	equivalent_fournisseur_nom	ECRITURE
DIRECTION	STOCK	valeur_conso_annuelle_mad	ECRITURE
DIRECTION	STOCK	part_pct	ECRITURE
DIRECTION	STOCK	pct_cumule	ECRITURE
DIRECTION	STOCK	rang	ECRITURE
DIRECTION	STOCK	politique	ECRITURE
DIRECTION	STOCK	date_dernier_abc	ECRITURE
DIRECTION	VALORISATION	prix_achat_mad_kg	ECRITURE
DIRECTION	VALORISATION	frais_approche_mad	ECRITURE
DIRECTION	VALORISATION	frais_mad_kg	ECRITURE
DIRECTION	VALORISATION	cout_revient_mad_kg	ECRITURE
DIRECTION	VALORISATION	part_frais_pct	ECRITURE
DIRECTION	VALORISATION	montant_devise	ECRITURE
DIRECTION	VALORISATION	montant_mad	ECRITURE
DIRECTION	VALORISATION	type_frais	ECRITURE
DIRECTION	VALORISATION	cle_repartition	ECRITURE
DIRECTION	VALORISATION	reference_externe	ECRITURE
MAGASIN	VALORISATION	premier_taux	MASQUE
MAGASIN	VALORISATION	dernier_taux	MASQUE
MAGASIN	CATALOGUE	equivalent_fournisseur	ECRITURE
MAGASIN	CATALOGUE	equivalent_fournisseur_nom	ECRITURE
MAGASIN	STOCK	valeur_conso_annuelle_mad	MASQUE
MAGASIN	STOCK	part_pct	MASQUE
MAGASIN	STOCK	pct_cumule	MASQUE
MAGASIN	STOCK	rang	ECRITURE
MAGASIN	STOCK	politique	ECRITURE
MAGASIN	STOCK	date_dernier_abc	ECRITURE
MAGASIN	VALORISATION	prix_achat_mad_kg	MASQUE
MAGASIN	VALORISATION	frais_approche_mad	MASQUE
MAGASIN	VALORISATION	frais_mad_kg	MASQUE
MAGASIN	VALORISATION	cout_revient_mad_kg	MASQUE
MAGASIN	VALORISATION	part_frais_pct	MASQUE
MAGASIN	VALORISATION	montant_devise	MASQUE
MAGASIN	VALORISATION	montant_mad	MASQUE
MAGASIN	VALORISATION	type_frais	MASQUE
MAGASIN	VALORISATION	cle_repartition	MASQUE
MAGASIN	VALORISATION	reference_externe	MASQUE
DIRECTION	CATALOGUE	seuil_lot_valeur	ECRITURE
DIRECTION	CATALOGUE	fusion_lot	ECRITURE
MAGASIN	CATALOGUE	type_lot	LECTURE
MAGASIN	CATALOGUE	seuil_lot_valeur	LECTURE
MAGASIN	CATALOGUE	fusion_lot	LECTURE
ASSISTANTE	CATALOGUE	type_lot	ECRITURE
ASSISTANTE	CATALOGUE	seuil_lot_valeur	ECRITURE
ASSISTANTE	CATALOGUE	fusion_lot	ECRITURE
ADMIN	FOURNISSEURS	contact_principal	ECRITURE
ADMIN	FOURNISSEURS	telephone	ECRITURE
ADMIN	FOURNISSEURS	email	ECRITURE
ADMIN	FOURNISSEURS	pays	ECRITURE
ADMIN	FOURNISSEURS	ville	ECRITURE
ADMIN	FOURNISSEURS	delai_livraison_jours	ECRITURE
ADMIN	FOURNISSEURS	conditions_paiement	ECRITURE
ADMIN	FOURNISSEURS	delai_paiement_jours	ECRITURE
ADMIN	FOURNISSEURS	code_devise	ECRITURE
ADMIN	FOURNISSEURS	note_globale	ECRITURE
ADMIN	FOURNISSEURS	tolerance_pesee_pct	ECRITURE
ADMIN	FOURNISSEURS	actif	ECRITURE
ADMIN	STOCK	code_reference	ECRITURE
ADMIN	STOCK	designation	ECRITURE
ADMIN	STOCK	code_magasin	ECRITURE
ADMIN	STOCK	quantite_kg	ECRITURE
ADMIN	STOCK	cmup_mad	ECRITURE
ADMIN	STOCK	valeur_mad	ECRITURE
ADMIN	STOCK	date_derniere_entree	ECRITURE
ADMIN	STOCK	date_derniere_sortie	ECRITURE
ADMIN	STOCK	date_dernier_inventaire	ECRITURE
ADMIN	STOCK	stock_projete_kg	ECRITURE
ADMIN	STOCK	jours_couverture	ECRITURE
ADMIN	STOCK	statut	ECRITURE
ADMIN	STOCK	lot_fournisseur	ECRITURE
ADMIN	STOCK	date_peremption	ECRITURE
ADMIN	MOUVEMENTS	numero_mouvement	ECRITURE
ADMIN	MOUVEMENTS	date_mouvement	ECRITURE
ADMIN	MOUVEMENTS	code_type_mvt	ECRITURE
ADMIN	MOUVEMENTS	code_magasin	ECRITURE
ADMIN	MOUVEMENTS	code_motif	ECRITURE
ADMIN	MOUVEMENTS	code_reference	ECRITURE
ADMIN	MOUVEMENTS	quantite_kg	ECRITURE
ADMIN	MOUVEMENTS	prix_kg_mad	ECRITURE
ADMIN	MOUVEMENTS	total_mad	ECRITURE
ADMIN	MOUVEMENTS	lot_fournisseur	ECRITURE
ADMIN	MOUVEMENTS	numero_of	ECRITURE
ADMIN	MOUVEMENTS	utilisateur	ECRITURE
ADMIN	RECEPTIONS	numero_reception	ECRITURE
ADMIN	RECEPTIONS	date_reception	ECRITURE
ADMIN	RECEPTIONS	code_fournisseur	ECRITURE
ADMIN	RECEPTIONS	num_bon_livraison	ECRITURE
ADMIN	RECEPTIONS	code_reference	ECRITURE
ADMIN	RECEPTIONS	unite_saisie	ECRITURE
ADMIN	RECEPTIONS	quantite_pesee_unite	ECRITURE
ADMIN	RECEPTIONS	quantite_stock_kg	ECRITURE
ADMIN	RECEPTIONS	quantite_commandee_kg	ECRITURE
ADMIN	RECEPTIONS	ecart_pct	ECRITURE
ADMIN	RECEPTIONS	prix_kg_devise	ECRITURE
ADMIN	RECEPTIONS	code_devise	ECRITURE
ADMIN	RECEPTIONS	taux_change	ECRITURE
ADMIN	RECEPTIONS	prix_kg_mad	ECRITURE
ADMIN	RECEPTIONS	total_mad	ECRITURE
ADMIN	RECEPTIONS	total_devise	ECRITURE
ADMIN	RECEPTIONS	lot_fournisseur	ECRITURE
ADMIN	RECEPTIONS	date_peremption	ECRITURE
ADMIN	RECEPTIONS	statut_qualite	ECRITURE
ADMIN	RECEPTIONS	code_magasin_dest	ECRITURE
ADMIN	RECEPTIONS	fournisseur_nom	ECRITURE
ADMIN	RECEPTIONS	numero_bc	ECRITURE
ADMIN	RECEPTIONS	numero_facture	ECRITURE
ADMIN	RECEPTIONS	transporteur	ECRITURE
ADMIN	RECEPTIONS	nombre_colis	ECRITURE
ADMIN	RECEPTIONS	poids_total_brut_kg	ECRITURE
ADMIN	RECEPTIONS	statut	ECRITURE
ADMIN	RECEPTIONS	nb_lignes	ECRITURE
ADMIN	RECEPTIONS	receptionnaire	ECRITURE
ADMIN	RECEPTIONS	controleur	ECRITURE
ADMIN	RECEPTIONS	date_controle	ECRITURE
ADMIN	RECEPTIONS	quantite_bl_kg	ECRITURE
ADMIN	RECEPTIONS	ecart_bl_kg	ECRITURE
ADMIN	RECEPTIONS	ecart_cmd_kg	ECRITURE
ADMIN	RECEPTIONS	nb_colis_ligne	ECRITURE
ADMIN	RECEPTIONS	poids_moyen_colis_kg	ECRITURE
ADMIN	RECEPTIONS	date_fabrication	ECRITURE
ADMIN	RECEPTIONS	notes	ECRITURE
ADMIN	RECEPTIONS	delai_reel_jours	ECRITURE
ADMIN	RECEPTIONS	delai_prevu_jours	ECRITURE
ADMIN	RECEPTIONS	retard_jours	ECRITURE
ADMIN	RECEPTIONS	on_time	ECRITURE
ADMIN	RECEPTIONS	in_full	ECRITURE
ADMIN	RECEPTIONS	in_spec	ECRITURE
ADMIN	RECEPTIONS	substitution_acceptee	ECRITURE
ADMIN	RECEPTIONS	motif_substitution	ECRITURE
ADMIN	RECEPTIONS	reference_commandee	ECRITURE
ADMIN	RECEPTIONS	est_substitution	ECRITURE
ADMIN	RECEPTIONS	equivalents_recevables	ECRITURE
ADMIN	BONS_COMMANDE	numero_bc	ECRITURE
ADMIN	BONS_COMMANDE	date_bc	ECRITURE
ADMIN	BONS_COMMANDE	code_fournisseur	ECRITURE
ADMIN	BONS_COMMANDE	statut	ECRITURE
ADMIN	BONS_COMMANDE	code_devise	ECRITURE
ADMIN	BONS_COMMANDE	taux_change_engage	ECRITURE
ADMIN	BONS_COMMANDE	montant_total_devise	ECRITURE
ADMIN	BONS_COMMANDE	montant_total_mad	ECRITURE
ADMIN	BONS_COMMANDE	code_reference	ECRITURE
ADMIN	BONS_COMMANDE	unite_commande	ECRITURE
ADMIN	BONS_COMMANDE	quantite_commandee_unite	ECRITURE
ADMIN	BONS_COMMANDE	quantite_commandee_kg	ECRITURE
ADMIN	BONS_COMMANDE	quantite_recue_kg	ECRITURE
ADMIN	BONS_COMMANDE	prix_unitaire_devise	ECRITURE
ADMIN	BONS_COMMANDE	total_ligne_devise	ECRITURE
ADMIN	BONS_COMMANDE	date_livraison_prevue	ECRITURE
ADMIN	BONS_COMMANDE	besoin_kg_origine	ECRITURE
ADMIN	BONS_COMMANDE	besoin_kg_actuel	ECRITURE
ADMIN	BONS_COMMANDE	ecart_besoin_kg	ECRITURE
ADMIN	BONS_COMMANDE	arbitree	ECRITURE
ADMIN	BONS_COMMANDE	fournisseur_nom	ECRITURE
ADMIN	BONS_COMMANDE	devise_fournisseur	ECRITURE
ADMIN	BONS_COMMANDE	nb_lignes	ECRITURE
ADMIN	BONS_COMMANDE	date_validation	ECRITURE
ADMIN	BONS_COMMANDE	createur	ECRITURE
ADMIN	BONS_COMMANDE	valideur	ECRITURE
ADMIN	BONS_COMMANDE	motif_creation	ECRITURE
ADMIN	BONS_COMMANDE	conditions_paiement	ECRITURE
ADMIN	BONS_COMMANDE	notes	ECRITURE
ADMIN	BONS_COMMANDE	quantite_recue_kg_bc	ECRITURE
ADMIN	BONS_COMMANDE	reste_a_livrer_kg	ECRITURE
ADMIN	BONS_COMMANDE	pct_livre	ECRITURE
ADMIN	BONS_COMMANDE	statut_livraison	ECRITURE
ADMIN	BONS_COMMANDE	equivalent_de	ECRITURE
ADMIN	BONS_COMMANDE	besoin_equivalent_kg	ECRITURE
ADMIN	BONS_COMMANDE	nb_equivalents	ECRITURE
ADMIN	BONS_COMMANDE	statut_ligne	ECRITURE
ADMIN	PLAN_ACHAT	fournisseur_nom	ECRITURE
ADMIN	PLAN_ACHAT	unite_saisie	ECRITURE
ADMIN	PLAN_ACHAT	risque_identifie	ECRITURE
ADMIN	PLAN_ACHAT	action_recommandee	ECRITURE
ADMIN	PLAN_ACHAT	commentaires	ECRITURE
ADMIN	PLAN_ACHAT	date_generation	ECRITURE
ADMIN	CATALOGUE	date_achat	ECRITURE
ADMIN	CATALOGUE	prix_kg_devise	ECRITURE
ADMIN	CATALOGUE	prix_precedent_mad	ECRITURE
ADMIN	CATALOGUE	quantite_achetee_kg	ECRITURE
ADMIN	CATALOGUE	total_mad	ECRITURE
ADMIN	CATALOGUE	numero_bc	ECRITURE
ADMIN	CATALOGUE	numero_reception	ECRITURE
ADMIN	PLAN_ACHAT	id_proposition	ECRITURE
ADMIN	PLAN_ACHAT	code_reference	ECRITURE
ADMIN	PLAN_ACHAT	quantite_suggeree_kg	ECRITURE
ADMIN	PLAN_ACHAT	quantite_suggeree_unite	ECRITURE
ADMIN	PLAN_ACHAT	urgence	ECRITURE
ADMIN	PLAN_ACHAT	date_besoin_prevue	ECRITURE
ADMIN	PLAN_ACHAT	montant_total_mad	ECRITURE
ADMIN	PLAN_ACHAT	numero_bc	ECRITURE
ADMIN	PLAN_ACHAT	statut_bc	ECRITURE
ADMIN	PLAN_ACHAT	designation	ECRITURE
ADMIN	PLAN_ACHAT	code_fournisseur	ECRITURE
ADMIN	PLAN_ACHAT	statut	ECRITURE
ADMIN	PLAN_ACHAT	stock_projete_kg	ECRITURE
ADMIN	PLAN_ACHAT	stock_min_kg	ECRITURE
ADMIN	PLAN_ACHAT	qte_a_commander_kg	ECRITURE
ADMIN	PLAN_ACHAT	prix_estime_mad	ECRITURE
ADMIN	PLAN_ACHAT	source_prix	ECRITURE
ADMIN	PLAN_ACHAT	montant_estime_mad	ECRITURE
ADMIN	PLAN_ACHAT	tier	ECRITURE
ADMIN	PLAN_ACHAT	risque_sourcing	ECRITURE
ADMIN	PLAN_ACHAT	jours_couverture	ECRITURE
ADMIN	PLAN_ACHAT	code_reference_origine	ECRITURE
ADMIN	PLAN_ACHAT	designation_origine	ECRITURE
ADMIN	PLAN_ACHAT	motif_substitution	ECRITURE
ADMIN	PLAN_ACHAT	nb_equivalents	ECRITURE
ADMIN	PLAN_ACHAT	equivalent_dispo_kg	ECRITURE
ADMIN	QUALITES	code_qualite	ECRITURE
ADMIN	QUALITES	nom	ECRITURE
ADMIN	QUALITES	description	ECRITURE
ADMIN	QUALITES	statut	ECRITURE
ADMIN	QUALITES	poids_commercial_m2	ECRITURE
ADMIN	QUALITES	code_role	ECRITURE
ADMIN	QUALITES	role_libelle	ECRITURE
ADMIN	QUALITES	densite	ECRITURE
ADMIN	QUALITES	unite_densite	ECRITURE
ADMIN	QUALITES	entre_poids_commercial	ECRITURE
ADMIN	QUALITES	code_reference	ECRITURE
ADMIN	QUALITES	designation	ECRITURE
ADMIN	QUALITES	pourcentage_composition	ECRITURE
ADMIN	QUALITES	couleur	ECRITURE
ADMIN	QUALITES	code_groupe_equiv	ECRITURE
ADMIN	QUALITES	code_fournisseur_prefere	ECRITURE
ADMIN	QUALITES	ligne_numero	ECRITURE
ADMIN	QUALITES	kg_m2	ECRITURE
ADMIN	QUALITES	type_fil	ECRITURE
ADMIN	QUALITES	categorie	ECRITURE
ADMIN	QUALITES	fournisseur	ECRITURE
ADMIN	QUALITES	prix_kg_mad	ECRITURE
ADMIN	QUALITES	code_devise_catalogue	ECRITURE
ADMIN	QUALITES	cout_m2_mad	ECRITURE
ADMIN	QUALITES	source_prix	ECRITURE
ADMIN	QUALITES	marge_securite_pct	ECRITURE
ADMIN	QUALITES	couv_min_mois	ECRITURE
ADMIN	QUALITES	taux_perte_pct	ECRITURE
ADMIN	QUALITES	seuil_alerte_jours	ECRITURE
ADMIN	QUALITES	seuil_critique_jours	ECRITURE
ADMIN	QUALITES	stock_securite_jours	ECRITURE
ADMIN	QUALITES	actif	ECRITURE
ADMIN	QUALITES	nb_roles	ECRITURE
ADMIN	QUALITES	nb_composition	ECRITURE
ADMIN	QUALITES	nb_roles_composes	ECRITURE
ADMIN	QUALITES	nb_roles_hors_100	ECRITURE
ADMIN	QUALITES	nb_lignes_plan	ECRITURE
ADMIN	QUALITES	date_creation	ECRITURE
ADMIN	QUALITES	cree_par	ECRITURE
ADMIN	QUALITES	date_modification	ECRITURE
ADMIN	QUALITES	modifie_par	ECRITURE
ADMIN	QUALITES	date_cloture	ECRITURE
ADMIN	RECETTES	code_qualite	ECRITURE
ADMIN	RECETTES	qualite_nom	ECRITURE
ADMIN	RECETTES	ligne_numero	ECRITURE
ADMIN	RECETTES	code_reference	ECRITURE
ADMIN	RECETTES	designation	ECRITURE
ADMIN	RECETTES	code_role	ECRITURE
ADMIN	RECETTES	role_libelle	ECRITURE
ADMIN	RECETTES	pourcentage_composition	ECRITURE
ADMIN	RECETTES	couleur	ECRITURE
ADMIN	RECETTES	densite_role	ECRITURE
ADMIN	RECETTES	unite_densite	ECRITURE
ADMIN	RECETTES	kg_m2	ECRITURE
ADMIN	RECETTES	code_groupe_equiv	ECRITURE
ADMIN	RECETTES	statut_qualite	ECRITURE
ADMIN	RECETTES	code_fournisseur	ECRITURE
ADMIN	RECETTES	fournisseur	ECRITURE
ADMIN	RECETTES	code_fournisseur_prefere	ECRITURE
ADMIN	PLANS	annee	ECRITURE
ADMIN	PLANS	numero_version	ECRITURE
ADMIN	PLANS	libelle	ECRITURE
ADMIN	PLANS	scenario_nom	ECRITURE
ADMIN	PLANS	statut	ECRITURE
ADMIN	PLANS	actif	ECRITURE
ADMIN	PLANS	date_debut	ECRITURE
ADMIN	PLANS	date_fin	ECRITURE
ADMIN	PLANS	mois_horizon	ECRITURE
ADMIN	PLANS	croissance_annuelle_pct	ECRITURE
ADMIN	PLANS	mois	ECRITURE
ADMIN	PLANS	rang_mois	ECRITURE
ADMIN	PLANS	annee_mois	ECRITURE
ADMIN	PLANS	code_qualite	ECRITURE
ADMIN	PLANS	qualite_nom	ECRITURE
ADMIN	PLANS	m2_base_mensuel	ECRITURE
ADMIN	PLANS	m2_prevus	ECRITURE
ADMIN	PLANS	saisonnalite	ECRITURE
ADMIN	PLANS	coefficient	ECRITURE
ADMIN	PLANS	facteur_croissance	ECRITURE
ADMIN	PLANS	m2_realises	ECRITURE
ADMIN	PLANS	taux_perte_pct	ECRITURE
ADMIN	PLANS	m2_total_annuel	ECRITURE
ADMIN	PLANS	m2_total	ECRITURE
ADMIN	PLANS	nb_lignes	ECRITURE
ADMIN	PLANS	nb_qualites	ECRITURE
ADMIN	PLANS	nb_qualites_perimees	ECRITURE
ADMIN	PLANS	nb_besoins	ECRITURE
ADMIN	PLANS	date_creation	ECRITURE
ADMIN	PLANS	cree_par	ECRITURE
ADMIN	PLANS	date_modification	ECRITURE
ADMIN	PLANS	modifie_par	ECRITURE
ADMIN	PLANS	date_validation	ECRITURE
ADMIN	PLANS	valide_par	ECRITURE
ADMIN	PLANS	cloture_par	ECRITURE
ADMIN	MRP	code_reference	ECRITURE
ADMIN	MRP	designation	ECRITURE
ADMIN	MRP	mois	ECRITURE
ADMIN	MRP	quantite_brute_kg	ECRITURE
ADMIN	MRP	taux_perte_applique	ECRITURE
ADMIN	MRP	quantite_kg	ECRITURE
ADMIN	MRP	code_fournisseur	ECRITURE
ADMIN	INVENTAIRE	numero_inventaire	ECRITURE
ADMIN	INVENTAIRE	date_inventaire	ECRITURE
ADMIN	INVENTAIRE	type_inventaire	ECRITURE
ADMIN	INVENTAIRE	code_magasin	ECRITURE
ADMIN	INVENTAIRE	statut	ECRITURE
ADMIN	INVENTAIRE	code_reference	ECRITURE
ADMIN	INVENTAIRE	quantite_theorique_kg	ECRITURE
ADMIN	INVENTAIRE	quantite_comptee_kg	ECRITURE
ADMIN	INVENTAIRE	ecart_kg	ECRITURE
ADMIN	INVENTAIRE	ecart_pct	ECRITURE
ADMIN	INVENTAIRE	ecart_mad	ECRITURE
ADMIN	INVENTAIRE	motif_ecart	ECRITURE
ADMIN	VALORISATION	code_reference	ECRITURE
ADMIN	VALORISATION	code_magasin	ECRITURE
ADMIN	VALORISATION	quantite_kg	ECRITURE
ADMIN	VALORISATION	cmup_mad	ECRITURE
ADMIN	VALORISATION	valeur_mad	ECRITURE
ADMIN	COCKPIT	nb_ruptures	ECRITURE
ADMIN	COCKPIT	nb_critiques	ECRITURE
ADMIN	COCKPIT	nb_attention	ECRITURE
ADMIN	COCKPIT	nb_ok	ECRITURE
ADMIN	COCKPIT	nb_references	ECRITURE
ADMIN	COCKPIT	valeur_stock_mad	ECRITURE
ADMIN	COCKPIT	nb_refs_a_commander	ECRITURE
ADMIN	COCKPIT	budget_a_engager_mad	ECRITURE
ADMIN	COCKPIT	nb_classe_a_alerte	ECRITURE
ADMIN	COCKPIT	nb_tier1	ECRITURE
ADMIN	COCKPIT	nb_fournisseurs_actifs	ECRITURE
ADMIN	COCKPIT	nb_bc_ouverts	ECRITURE
ADMIN	COCKPIT	montant_bc_ouverts_mad	ECRITURE
ADMIN	COCKPIT	nb_alertes_critiques	ECRITURE
ADMIN	COCKPIT	nb_propositions_a_traiter	ECRITURE
ADMIN	COCKPIT	nb_bc_en_preparation	ECRITURE
ADMIN	COCKPIT	nb_bc_a_valider	ECRITURE
ADMIN	COCKPIT	montant_bc_a_valider_mad	ECRITURE
ADMIN	COCKPIT	nb_bc_a_envoyer	ECRITURE
ADMIN	COCKPIT	nb_livraisons_en_retard	ECRITURE
ADMIN	COCKPIT	retard_max_jours	ECRITURE
ADMIN	COCKPIT	nb_receptions_en_saisie	ECRITURE
ADMIN	COCKPIT	nb_receptions_a_controler	ECRITURE
ADMIN	COCKPIT	nb_lignes_non_conformes	ECRITURE
ADMIN	COCKPIT	nb_receptions_a_regulariser	ECRITURE
ADMIN	COCKPIT	nb_refs_sous_minimum	ECRITURE
ADMIN	COCKPIT	nb_refs_dormantes	ECRITURE
ADMIN	FOURNISSEURS	nb_references	ECRITURE
ADMIN	COCKPIT	nb_controles_bloquants	ECRITURE
ADMIN	COCKPIT	nb_controles_critiques	ECRITURE
ADMIN	COCKPIT	nb_alertes_ouvertes	ECRITURE
ADMIN	COCKPIT	code_reference	ECRITURE
ADMIN	COCKPIT	designation	ECRITURE
ADMIN	COCKPIT	classe_abc	ECRITURE
ADMIN	COCKPIT	code_fournisseur	ECRITURE
ADMIN	COCKPIT	fournisseur_nom	ECRITURE
ADMIN	COCKPIT	delai_livraison_jours	ECRITURE
ADMIN	COCKPIT	risque_sourcing	ECRITURE
ADMIN	COCKPIT	stock_min_kg	ECRITURE
ADMIN	COCKPIT	stock_initial_kg	ECRITURE
ADMIN	COCKPIT	nb_mois_rupture	ECRITURE
ADMIN	COCKPIT	nb_mois_tendu	ECRITURE
ADMIN	COCKPIT	premier_mois_rupture	ECRITURE
ADMIN	COCKPIT	premier_mois_risque	ECRITURE
ADMIN	COCKPIT	rang_premier_risque	ECRITURE
ADMIN	COCKPIT	marge_decision_jours	ECRITURE
ADMIN	COCKPIT	mois	ECRITURE
ADMIN	COCKPIT	annee_mois	ECRITURE
ADMIN	COCKPIT	rang_mois	ECRITURE
ADMIN	COCKPIT	besoin_kg	ECRITURE
ADMIN	COCKPIT	entrees_kg	ECRITURE
ADMIN	COCKPIT	stock_fin_kg	ECRITURE
ADMIN	COCKPIT	statut	ECRITURE
ADMIN	MOUVEMENTS	annee_mois	ECRITURE
ADMIN	MOUVEMENTS	type_libelle	ECRITURE
ADMIN	MOUVEMENTS	signe	ECRITURE
ADMIN	COCKPIT	nb_lots_peremption_proche	ECRITURE
ADMIN	MOUVEMENTS	couleur	ECRITURE
ADMIN	MOUVEMENTS	nb_mouvements	ECRITURE
ADMIN	MOUVEMENTS	nb_lignes	ECRITURE
ADMIN	MOUVEMENTS	nb_references	ECRITURE
ADMIN	MOUVEMENTS	valeur_mad	ECRITURE
ADMIN	MOUVEMENTS	designation	ECRITURE
ADMIN	MOUVEMENTS	classe_abc	ECRITURE
ADMIN	MOUVEMENTS	solde_kg	ECRITURE
ADMIN	MOUVEMENTS	entrees_mad	ECRITURE
ADMIN	MOUVEMENTS	nb_mois_actifs	ECRITURE
ADMIN	MOUVEMENTS	premier_mouvement	ECRITURE
ADMIN	MOUVEMENTS	dernier_mouvement	ECRITURE
ADMIN	MOUVEMENTS	stock_actuel_kg	ECRITURE
ADMIN	MOUVEMENTS	rotation	ECRITURE
ADMIN	MOUVEMENTS	jours_sans_mouvement	ECRITURE
ADMIN	VALORISATION	designation	ECRITURE
ADMIN	VALORISATION	annee_mois	ECRITURE
ADMIN	VALORISATION	code_devise	ECRITURE
ADMIN	VALORISATION	nb_achats	ECRITURE
ADMIN	VALORISATION	nb_fournisseurs	ECRITURE
ADMIN	VALORISATION	prix_moyen_devise	ECRITURE
ADMIN	VALORISATION	prix_moyen_mad	ECRITURE
ADMIN	VALORISATION	taux_moyen	ECRITURE
ADMIN	VALORISATION	prix_min_mad	ECRITURE
ADMIN	VALORISATION	prix_max_mad	ECRITURE
ADMIN	VALORISATION	classe_abc	ECRITURE
ADMIN	VALORISATION	quantite_totale_kg	ECRITURE
ADMIN	VALORISATION	montant_total_mad	ECRITURE
ADMIN	VALORISATION	premier_achat	ECRITURE
ADMIN	VALORISATION	dernier_achat	ECRITURE
ADMIN	VALORISATION	premier_prix_mad	ECRITURE
ADMIN	VALORISATION	dernier_prix_mad	ECRITURE
ADMIN	VALORISATION	premier_prix_devise	ECRITURE
ADMIN	VALORISATION	dernier_prix_devise	ECRITURE
ADMIN	VALORISATION	premier_taux	ECRITURE
ADMIN	VALORISATION	dernier_taux	ECRITURE
ADMIN	VALORISATION	derive_totale_pct	ECRITURE
ADMIN	VALORISATION	derive_fournisseur_pct	ECRITURE
ADMIN	VALORISATION	derive_change_pct	ECRITURE
ADMIN	VALORISATION	impact_fournisseur_mad	ECRITURE
ADMIN	FOURNISSEURS	fournisseur_nom	ECRITURE
ADMIN	FOURNISSEURS	annee_mois	ECRITURE
ADMIN	FOURNISSEURS	nb_receptions	ECRITURE
ADMIN	FOURNISSEURS	nb_lignes	ECRITURE
ADMIN	FOURNISSEURS	quantite_kg	ECRITURE
ADMIN	FOURNISSEURS	montant_mad	ECRITURE
ADMIN	FOURNISSEURS	taux_conformite_pct	ECRITURE
ADMIN	FOURNISSEURS	nb_a_lheure	ECRITURE
ADMIN	FOURNISSEURS	nb_mesurables	ECRITURE
ADMIN	FOURNISSEURS	retard_moyen_jours	ECRITURE
ADMIN	FOURNISSEURS	delai_reel_moyen_jours	ECRITURE
ADMIN	FOURNISSEURS	nb_bc	ECRITURE
ADMIN	FOURNISSEURS	montant_total_mad	ECRITURE
ADMIN	FOURNISSEURS	nb_lignes_recues	ECRITURE
ADMIN	FOURNISSEURS	taux_ponctualite_pct	ECRITURE
ADMIN	FOURNISSEURS	ecart_pesee_moyen_pct	ECRITURE
ADMIN	FOURNISSEURS	classement	ECRITURE
ADMIN	QUALITES	qualite_nom	ECRITURE
ADMIN	QUALITES	nb_composants	ECRITURE
ADMIN	QUALITES	nb_sans_cmup	ECRITURE
ADMIN	QUALITES	kg_m2_total	ECRITURE
ADMIN	QUALITES	cout_matiere_m2_mad	ECRITURE
ADMIN	QUALITES	ecart_poids_pct	ECRITURE
ADMIN	QUALITES	m2_prevus	ECRITURE
ADMIN	QUALITES	m2_realises	ECRITURE
ADMIN	QUALITES	nb_mois_planifies	ECRITURE
ADMIN	QUALITES	taux_realisation_pct	ECRITURE
ADMIN	QUALITES	cout_matiere_plan_mad	ECRITURE
ADMIN	QUALITES	somme_pct	ECRITURE
ADMIN	CATALOGUE	code_groupe_equiv	ECRITURE
ADMIN	CATALOGUE	groupe_libelle	ECRITURE
ADMIN	CATALOGUE	priorite	ECRITURE
ADMIN	CATALOGUE	est_preferentielle	ECRITURE
ADMIN	CATALOGUE	stock_kg	ECRITURE
ADMIN	CATALOGUE	stock_projete_kg	ECRITURE
ADMIN	CATALOGUE	statut	ECRITURE
ADMIN	CATALOGUE	besoin_12m_kg	ECRITURE
ADMIN	IMPORT	numero	ECRITURE
ADMIN	IMPORT	statut	ECRITURE
ADMIN	FOURNISSEURS	otif_pct	ECRITURE
ADMIN	CATALOGUE	equivalent_reference	ECRITURE
ADMIN	CATALOGUE	equivalent_designation	ECRITURE
ADMIN	CATALOGUE	equivalent_fournisseur	ECRITURE
ADMIN	CATALOGUE	equivalent_fournisseur_nom	ECRITURE
ADMIN	CATALOGUE	equivalent_delai_jours	ECRITURE
ADMIN	CATALOGUE	equivalent_priorite	ECRITURE
ADMIN	CATALOGUE	equivalent_preferentielle	ECRITURE
ADMIN	CATALOGUE	equivalent_unite	ECRITURE
ADMIN	CATALOGUE	equivalent_prix_catalogue_kg	ECRITURE
ADMIN	CATALOGUE	equivalent_devise	ECRITURE
ADMIN	CATALOGUE	equivalent_stock_kg	ECRITURE
ADMIN	CATALOGUE	equivalent_stock_projete_kg	ECRITURE
ADMIN	CATALOGUE	equivalent_statut	ECRITURE
ADMIN	CATALOGUE	equivalent_besoin_12m_kg	ECRITURE
ADMIN	CATALOGUE	meme_fournisseur	ECRITURE
ADMIN	CATALOGUE	interchangeable	ECRITURE
ADMIN	CATALOGUE	libelle	ECRITURE
ADMIN	CATALOGUE	nb_unites	ECRITURE
ADMIN	CATALOGUE	nb_densites	ECRITURE
ADMIN	CATALOGUE	nb_categories	ECRITURE
ADMIN	CATALOGUE	nb_preferentielles	ECRITURE
ADMIN	CATALOGUE	nb_avec_stock	ECRITURE
ADMIN	CATALOGUE	nb_avec_besoin	ECRITURE
ADMIN	CATALOGUE	stock_cumule_kg	ECRITURE
ADMIN	CATALOGUE	besoin_cumule_kg	ECRITURE
ADMIN	CATALOGUE	qualification	ECRITURE
ADMIN	CATALOGUE	code_role	ECRITURE
ADMIN	MOUVEMENTS	actif	ECRITURE
ADMIN	MOUVEMENTS	exige_motif_ligne	ECRITURE
ADMIN	MOUVEMENTS	exige_of	ECRITURE
ADMIN	MOUVEMENTS	exige_prix	ECRITURE
ADMIN	MOUVEMENTS	impacte_cmup	ECRITURE
ADMIN	MOUVEMENTS	libelle	ECRITURE
ADMIN	MOUVEMENTS	categorie	ECRITURE
ADMIN	MOUVEMENTS	signe_default	ECRITURE
ADMIN	MOUVEMENTS	code_motif_ligne	ECRITURE
ADMIN	STOCK	actif	ECRITURE
ADMIN	STOCK	adresse	ECRITURE
ADMIN	STOCK	est_quarantaine	ECRITURE
ADMIN	STOCK	inclure_mrp	ECRITURE
ADMIN	STOCK	nom	ECRITURE
ADMIN	STOCK	responsable	ECRITURE
ADMIN	STOCK	type	ECRITURE
ADMIN	FOURNISSEURS	adresse	ECRITURE
ADMIN	FOURNISSEURS	date_creation	ECRITURE
ADMIN	FOURNISSEURS	incoterm	ECRITURE
ADMIN	FOURNISSEURS	transporteur	ECRITURE
ADMIN	CATALOGUE	date_creation	ECRITURE
ADMIN	CATALOGUE	date_dernier_abc	ECRITURE
ADMIN	CATALOGUE	date_dernier_cmup	ECRITURE
ADMIN	CATALOGUE	date_prix_catalogue	ECRITURE
ADMIN	CATALOGUE	date_debut	ECRITURE
ADMIN	CATALOGUE	date_fin	ECRITURE
ADMIN	MOUVEMENTS	numero_transfert	ECRITURE
ADMIN	MOUVEMENTS	date_transfert	ECRITURE
ADMIN	MOUVEMENTS	statut	ECRITURE
ADMIN	MOUVEMENTS	code_magasin_source	ECRITURE
ADMIN	MOUVEMENTS	code_magasin_dest	ECRITURE
ADMIN	MOUVEMENTS	magasin_source_nom	ECRITURE
ADMIN	MOUVEMENTS	magasin_dest_nom	ECRITURE
ADMIN	MOUVEMENTS	date_sortie	ECRITURE
ADMIN	MOUVEMENTS	date_reception_dest	ECRITURE
ADMIN	MOUVEMENTS	responsable	ECRITURE
ADMIN	MOUVEMENTS	transporteur	ECRITURE
ADMIN	MOUVEMENTS	observations	ECRITURE
ADMIN	MOUVEMENTS	auteur	ECRITURE
ADMIN	MOUVEMENTS	expediteur	ECRITURE
ADMIN	MOUVEMENTS	receptionnaire	ECRITURE
ADMIN	MOUVEMENTS	jours_en_transit	ECRITURE
ADMIN	MOUVEMENTS	ligne_numero	ECRITURE
ADMIN	MOUVEMENTS	quantite_saisie	ECRITURE
ADMIN	MOUVEMENTS	unite_saisie	ECRITURE
ADMIN	MOUVEMENTS	nb_bobines	ECRITURE
ADMIN	MOUVEMENTS	nb_palettes	ECRITURE
ADMIN	MOUVEMENTS	quantite_totale_kg	ECRITURE
ADMIN	MOUVEMENTS	bobines_totales	ECRITURE
ADMIN	IMPORT	fournisseurs	ECRITURE
ADMIN	CATALOGUE	nb_fournisseurs	ECRITURE
ADMIN	PARAMETRES	unite	ECRITURE
ADMIN	MOUVEMENTS	palettes_totales	ECRITURE
ADMIN	MOUVEMENTS	valeur_totale_mad	ECRITURE
ADMIN	MOUVEMENTS	magasin_nom	ECRITURE
ADMIN	MOUVEMENTS	motif_libelle	ECRITURE
ADMIN	MOUVEMENTS	reference_document	ECRITURE
ADMIN	MOUVEMENTS	observations_globales	ECRITURE
ADMIN	MOUVEMENTS	date_creation	ECRITURE
ADMIN	MOUVEMENTS	jours_de_retard_saisie	ECRITURE
ADMIN	MOUVEMENTS	saisi_par	ECRITURE
ADMIN	MOUVEMENTS	rebut_kg	ECRITURE
ADMIN	MOUVEMENTS	motif_ligne_libelle	ECRITURE
ADMIN	MOUVEMENTS	est_initial	ECRITURE
ADMIN	MOUVEMENTS	date_fabrication	ECRITURE
ADMIN	MOUVEMENTS	statut_qualite	ECRITURE
ADMIN	MOUVEMENTS	facteur_conversion	ECRITURE
ADMIN	PLAN_ACHAT	figee	ECRITURE
ADMIN	PLAN_ACHAT	figee_par	ECRITURE
ADMIN	PLAN_ACHAT	date_figement	ECRITURE
ADMIN	PLAN_ACHAT	motif_figement	ECRITURE
ADMIN	PLAN_ACHAT	quantite_mrp_kg	ECRITURE
ADMIN	PLAN_ACHAT	quantite_calculee_kg	ECRITURE
ADMIN	PLAN_ACHAT	ecart_calcul_kg	ECRITURE
ADMIN	PLAN_ACHAT	etat_figement	ECRITURE
ADMIN	PARAMETRES	fichier	ECRITURE
ADMIN	PARAMETRES	plateforme	ECRITURE
ADMIN	PARAMETRES	version	ECRITURE
ADMIN	PARAMETRES	taille_octets	ECRITURE
ADMIN	PARAMETRES	date_telechargement	ECRITURE
ADMIN	PARAMETRES	utilisateur	ECRITURE
ADMIN	STOCK	valeur_conso_annuelle_mad	ECRITURE
ADMIN	STOCK	part_pct	ECRITURE
ADMIN	STOCK	pct_cumule	ECRITURE
ADMIN	STOCK	rang	ECRITURE
ADMIN	STOCK	politique	ECRITURE
ADMIN	STOCK	date_dernier_abc	ECRITURE
ADMIN	VALORISATION	prix_achat_mad_kg	ECRITURE
ADMIN	VALORISATION	frais_approche_mad	ECRITURE
ADMIN	VALORISATION	frais_mad_kg	ECRITURE
ADMIN	VALORISATION	cout_revient_mad_kg	ECRITURE
ADMIN	VALORISATION	part_frais_pct	ECRITURE
ADMIN	VALORISATION	montant_devise	ECRITURE
ADMIN	VALORISATION	montant_mad	ECRITURE
ADMIN	VALORISATION	type_frais	ECRITURE
ADMIN	VALORISATION	cle_repartition	ECRITURE
ADMIN	VALORISATION	reference_externe	ECRITURE
ADMIN	STOCK	stock_global_kg	ECRITURE
ADMIN	STOCK	magasins_kg	ECRITURE
ADMIN	STOCK	machines_kg	ECRITURE
ADMIN	STOCK	machines_bobines	ECRITURE
ADMIN	STOCK	nb_machines	ECRITURE
ADMIN	STOCK	par_magasin	ECRITURE
ADMIN	STOCK	a_commander_kg	ECRITURE
ADMIN	STOCK	prix_catalogue_kg	ECRITURE
ADMIN	STOCK	jours_sans_mouvement	ECRITURE
ADMIN	STOCK	derniere_sortie	ECRITURE
ADMIN	STOCK	nb_equivalents	ECRITURE
ADMIN	PARAMETRES	etat	ECRITURE
ADMIN	PARAMETRES	motif_etat	ECRITURE
ADMIN	PARAMETRES	date_etat	ECRITURE
ADMIN	IMPORT	nb_factures	ECRITURE
ADMIN	IMPORT	date_arrivee	ECRITURE
ADMIN	IMPORT	valeur_dhs	ECRITURE
ADMIN	IMPORT	frais_dhs	ECRITURE
ADMIN	IMPORT	tva_dhs	ECRITURE
ADMIN	IMPORT	poids_kg	ECRITURE
ADMIN	IMPORT	recu_kg	ECRITURE
ADMIN	IMPORT	nb_palettes	ECRITURE
ADMIN	IMPORT	nb_bobines	ECRITURE
ADMIN	IMPORT	frais_alloues_dhs	ECRITURE
ADMIN	IMPORT	montant_alloue_dhs	ECRITURE
ADMIN	IMPORT	cout_revient_dhs	ECRITURE
ADMIN	IMPORT	cout_revient_unitaire_dhs	ECRITURE
ADMIN	IMPORT	cout_revient_kg_dhs	ECRITURE
ADMIN	IMPORT	coef_frais_pct	ECRITURE
ADMIN	IMPORT	cump_avant	ECRITURE
ADMIN	IMPORT	cump_apres	ECRITURE
ADMIN	CATALOGUE	code_reference	ECRITURE
ADMIN	CATALOGUE	designation	ECRITURE
ADMIN	CATALOGUE	code_categorie	ECRITURE
ADMIN	CATALOGUE	code_role_defaut	ECRITURE
ADMIN	CATALOGUE	code_fournisseur	ECRITURE
ADMIN	CATALOGUE	fournisseur_nom	ECRITURE
ADMIN	CATALOGUE	type_fil	ECRITURE
ADMIN	CATALOGUE	couleur	ECRITURE
ADMIN	CATALOGUE	titrage	ECRITURE
ADMIN	CATALOGUE	unite_catalogue	ECRITURE
ADMIN	CATALOGUE	densite_kg_ml	ECRITURE
ADMIN	CATALOGUE	facteur_kg	ECRITURE
ADMIN	CATALOGUE	prix_catalogue	ECRITURE
ADMIN	CATALOGUE	code_devise_catalogue	ECRITURE
ADMIN	CATALOGUE	prix_catalogue_kg	ECRITURE
ADMIN	CATALOGUE	prix_kg_mad	ECRITURE
ADMIN	CATALOGUE	source_prix	ECRITURE
ADMIN	CATALOGUE	cmup_mad	ECRITURE
ADMIN	CATALOGUE	stock_min_kg	ECRITURE
ADMIN	CATALOGUE	couverture_min_mois	ECRITURE
ADMIN	CATALOGUE	marge_securite_pct	ECRITURE
ADMIN	CATALOGUE	moq_kg	ECRITURE
ADMIN	CATALOGUE	multiple_achat_kg	ECRITURE
ADMIN	CATALOGUE	classe_abc	ECRITURE
ADMIN	CATALOGUE	classe_xyz	ECRITURE
ADMIN	CATALOGUE	suivi_lot	ECRITURE
ADMIN	RECEPTIONS	dossiers	ECRITURE
ADMIN	RECEPTIONS	quantite_kg	ECRITURE
ADMIN	RECEPTIONS	ecart_kg	ECRITURE
ADMIN	RECEPTIONS	nb_bobines	ECRITURE
ADMIN	RECEPTIONS	nb_palettes	ECRITURE
ADMIN	PARAMETRES	id_frais	ECRITURE
ADMIN	PARAMETRES	piece_justificative	ECRITURE
ADMIN	PARAMETRES	recuperable	ECRITURE
ADMIN	PARAMETRES	commun	ECRITURE
ADMIN	PARAMETRES	inclus_dans_cout	ECRITURE
ADMIN	PARAMETRES	methode_repartition	ECRITURE
ADMIN	PARAMETRES	ordre	ECRITURE
ADMIN	PARAMETRES	actif	ECRITURE
ADMIN	PARAMETRES	nb_utilisations	ECRITURE
ADMIN	BONS_COMMANDE	type_ligne	ECRITURE
ADMIN	BONS_COMMANDE	libelle	ECRITURE
ADMIN	PARAMETRES	taux	ECRITURE
ADMIN	PARAMETRES	date_debut	ECRITURE
ADMIN	PARAMETRES	date_fin	ECRITURE
ADMIN	CATALOGUE	code_conditionnement	ECRITURE
ADMIN	STOCK	unite_pluriel	ECRITURE
ADMIN	STOCK	nb_colis	ECRITURE
ADMIN	STOCK	litres	ECRITURE
ADMIN	CATALOGUE	poids_bobine_kg	ECRITURE
ADMIN	CATALOGUE	bobines_par_palette	ECRITURE
ADMIN	CATALOGUE	actif	ECRITURE
ADMIN	FOURNISSEURS	code_fournisseur	ECRITURE
ADMIN	CATALOGUE	code_couleur_interne	ECRITURE
ADMIN	CATALOGUE	code_famille	ECRITURE
ADMIN	CATALOGUE	reference_fournisseur	ECRITURE
ADMIN	CATALOGUE	supplement_teinture	ECRITURE
ADMIN	CATALOGUE	classe_teinture	ECRITURE
ADMIN	CATALOGUE	description	ECRITURE
ADMIN	CATALOGUE	ordre_affichage	ECRITURE
ADMIN	CATALOGUE	nb_references	ECRITURE
ADMIN	BONS_COMMANDE	densite_kg_ml	ECRITURE
ADMIN	COCKPIT	nb_sur_stock	ECRITURE
ADMIN	COCKPIT	nb_ecart_majeur	ECRITURE
ADMIN	COCKPIT	nb_refs_en_alerte	ECRITURE
ADMIN	COCKPIT	nb_classe_a	ECRITURE
ADMIN	COCKPIT	nb_classe_b	ECRITURE
ADMIN	COCKPIT	nb_classe_c	ECRITURE
ADMIN	COCKPIT	nb_non_classees	ECRITURE
ADMIN	COCKPIT	couverture_ponderee_jours	ECRITURE
ADMIN	COCKPIT	ecart_pesee_moyen_pct	ECRITURE
ADMIN	COCKPIT	nb_opportunites	ECRITURE
ADMIN	COCKPIT	alertes	ECRITURE
ADMIN	COCKPIT	economies_total_mad	ECRITURE
ADMIN	COCKPIT	budget_ruptures_mad	ECRITURE
ADMIN	COCKPIT	pct_valeur_dormante	ECRITURE
ADMIN	COCKPIT	valeur_dormante_mad	ECRITURE
ADMIN	MOUVEMENTS	valeur_dhs	ECRITURE
ADMIN	CATALOGUE	prix_catalogue_mad	ECRITURE
ADMIN	CATALOGUE	valeur_stock_mad	ECRITURE
ADMIN	BONS_COMMANDE	poids_bobine_kg	ECRITURE
ADMIN	BONS_COMMANDE	bobines_par_palette	ECRITURE
ADMIN	IMPORT	nom_fichier	ECRITURE
ADMIN	IMPORT	nature	ECRITURE
ADMIN	IMPORT	taille_octets	ECRITURE
ADMIN	IMPORT	nb_pages	ECRITURE
ADMIN	IMPORT	date_depot	ECRITURE
ADMIN	IMPORT	depose_par	ECRITURE
ADMIN	BONS_COMMANDE	reference_fournisseur	ECRITURE
ADMIN	BONS_COMMANDE	couleur	ECRITURE
ADMIN	BONS_COMMANDE	code_couleur	ECRITURE
ADMIN	PLAN_ACHAT	selection	ECRITURE
ADMIN	PLAN_ACHAT	classe_abc	ECRITURE
ADMIN	PLAN_ACHAT	classe_xyz	ECRITURE
ADMIN	PLAN_ACHAT	risque_source	ECRITURE
ADMIN	PLAN_ACHAT	nb_sources	ECRITURE
ADMIN	PLAN_ACHAT	code_devise	ECRITURE
ADMIN	PLAN_ACHAT	prix_devise	ECRITURE
ADMIN	PLAN_ACHAT	montant_devise	ECRITURE
ADMIN	PLAN_ACHAT	taux_devise	ECRITURE
ADMIN	PLAN_ACHAT	palettes_a_commander	ECRITURE
ADMIN	STOCK	palettes	ECRITURE
ADMIN	STOCK	bobines	ECRITURE
ADMIN	STOCK	kg_par_palette	ECRITURE
ADMIN	BONS_COMMANDE	date_envoi	ECRITURE
ADMIN	CATALOGUE	code_couleur_fournisseur	ECRITURE
ADMIN	CATALOGUE	nb_familles	ECRITURE
ADMIN	STOCK	unite_catalogue	ECRITURE
ADMIN	STOCK	densite_kg_ml	ECRITURE
ADMIN	STOCK	suivi_lot	ECRITURE
ADMIN	STOCK	poids_bobine_kg	ECRITURE
ADMIN	STOCK	bobines_par_palette	ECRITURE
ADMIN	MOUVEMENTS	famille_libelle	ECRITURE
ADMIN	MOUVEMENTS	categorie_libelle	ECRITURE
ADMIN	MOUVEMENTS	couleur_libelle	ECRITURE
ADMIN	MOUVEMENTS	refs_en_stock	ECRITURE
ADMIN	MOUVEMENTS	entrees_kg	ECRITURE
ADMIN	MOUVEMENTS	sorties_kg	ECRITURE
ADMIN	MOUVEMENTS	nb_entrees	ECRITURE
ADMIN	MOUVEMENTS	entrees_dhs	ECRITURE
ADMIN	MOUVEMENTS	prix_moyen_entree_mad	ECRITURE
ADMIN	MOUVEMENTS	nb_familles	ECRITURE
ADMIN	CATALOGUE	bobines_par_lot	ECRITURE
ADMIN	CATALOGUE	description_commerciale	ECRITURE
ADMIN	FOURNISSEURS	palettes_par_conteneur	ECRITURE
ADMIN	BONS_COMMANDE	bobines_par_lot	ECRITURE
ADMIN	BONS_COMMANDE	description_commerciale	ECRITURE
ADMIN	BONS_COMMANDE	nombre_conteneurs	ECRITURE
ADMIN	BONS_COMMANDE	mention_expedition	ECRITURE
ADMIN	STOCK	bobines_par_lot	ECRITURE
ADMIN	BONS_COMMANDE	incoterm	ECRITURE
ADMIN	BONS_COMMANDE	tolerance_pesee_pct	ECRITURE
ADMIN	BONS_COMMANDE	palettes_par_conteneur	ECRITURE
ADMIN	BONS_COMMANDE	code_famille	ECRITURE
ADMIN	UTILISATEURS	totp_actif	ECRITURE
ADMIN	UTILISATEURS	totp_active_le	ECRITURE
ADMIN	UTILISATEURS	echecs_consecutifs	ECRITURE
ADMIN	UTILISATEURS	bloque_jusqu_a	ECRITURE
ADMIN	UTILISATEURS	dernier_echec	ECRITURE
ADMIN	UTILISATEURS	resultat	ECRITURE
ADMIN	UTILISATEURS	agent	ECRITURE
ADMIN	PARAMETRES	adresse_ip	ECRITURE
ADMIN	PARAMETRES	disponible	ECRITURE
ADMIN	PARAMETRES	nb_telechargements	ECRITURE
ADMIN	PARAMETRES	code_parametre	ECRITURE
ADMIN	PARAMETRES	libelle	ECRITURE
ADMIN	PARAMETRES	valeur_courante	ECRITURE
ADMIN	PARAMETRES	categorie	ECRITURE
ADMIN	PARAMETRES	verrouille	ECRITURE
ADMIN	AUDIT	date_operation	ECRITURE
ADMIN	AUDIT	table_concernee	ECRITURE
ADMIN	AUDIT	operation	ECRITURE
ADMIN	AUDIT	auteur	ECRITURE
ADMIN	AUDIT	anciennes_valeurs	ECRITURE
ADMIN	AUDIT	nouvelles_valeurs	ECRITURE
ADMIN	AUDIT	adresse_ip	ECRITURE
ADMIN	UTILISATEURS	login	ECRITURE
ADMIN	UTILISATEURS	nom	ECRITURE
ADMIN	UTILISATEURS	code_role_user	ECRITURE
ADMIN	UTILISATEURS	email	ECRITURE
ADMIN	UTILISATEURS	telephone	ECRITURE
ADMIN	UTILISATEURS	magasin_principal	ECRITURE
ADMIN	UTILISATEURS	derniere_connexion	ECRITURE
ADMIN	UTILISATEURS	actif	ECRITURE
ADMIN	CATALOGUE	prix_moyen_mad	ECRITURE
ADMIN	CATALOGUE	annee_mois	ECRITURE
ADMIN	CATALOGUE	quantite_kg	ECRITURE
ADMIN	CATALOGUE	nb_achats	ECRITURE
ADMIN	BONS_COMMANDE	total_ligne_mad	ECRITURE
ADMIN	BONS_COMMANDE	categorie_libelle	ECRITURE
ADMIN	BONS_COMMANDE	nb_palettes	ECRITURE
ADMIN	CATALOGUE	type_lot	ECRITURE
ADMIN	CATALOGUE	seuil_lot_valeur	ECRITURE
ADMIN	CATALOGUE	fusion_lot	ECRITURE
ASSISTANTE	PLAN_ACHAT	complement_palette_kg	LECTURE
DIRECTION	PLAN_ACHAT	complement_palette_kg	LECTURE
MAGASIN	PLAN_ACHAT	complement_palette_kg	LECTURE
ADMIN	PLAN_ACHAT	complement_palette_kg	LECTURE
DIRECTION	CATALOGUE	arrondi_palette	ECRITURE
MAGASIN	CATALOGUE	arrondi_palette	LECTURE
ASSISTANTE	CATALOGUE	arrondi_palette	ECRITURE
ADMIN	CATALOGUE	arrondi_palette	ECRITURE
ADMIN	STOCK	kg_sur_machine	LECTURE
ADMIN	COCKPIT	budget_annuel_mad	LECTURE
MAGASIN	COCKPIT	budget_annuel_mad	MASQUE
DIRECTION	COCKPIT	budget_annuel_mad	LECTURE
ASSISTANTE	COCKPIT	budget_annuel_mad	MASQUE
ADMIN	COCKPIT	cout_mad	LECTURE
MAGASIN	COCKPIT	cout_mad	MASQUE
DIRECTION	COCKPIT	cout_mad	LECTURE
ASSISTANTE	COCKPIT	cout_mad	MASQUE
ADMIN	COCKPIT	cout_matiere_annuel_mad	LECTURE
MAGASIN	COCKPIT	cout_matiere_annuel_mad	MASQUE
DIRECTION	COCKPIT	cout_matiere_annuel_mad	LECTURE
ASSISTANTE	COCKPIT	cout_matiere_annuel_mad	MASQUE
ADMIN	COCKPIT	economie_annuelle_mad	LECTURE
MAGASIN	COCKPIT	economie_annuelle_mad	MASQUE
DIRECTION	COCKPIT	economie_annuelle_mad	LECTURE
ASSISTANTE	COCKPIT	economie_annuelle_mad	MASQUE
ADMIN	COCKPIT	montant_mad	LECTURE
MAGASIN	COCKPIT	montant_mad	MASQUE
DIRECTION	COCKPIT	montant_mad	LECTURE
ASSISTANTE	COCKPIT	montant_mad	MASQUE
ADMIN	COCKPIT	prix_actuel_mad	LECTURE
MAGASIN	COCKPIT	prix_actuel_mad	MASQUE
DIRECTION	COCKPIT	prix_actuel_mad	LECTURE
ASSISTANTE	COCKPIT	prix_actuel_mad	MASQUE
ADMIN	COCKPIT	prix_min_mad	LECTURE
MAGASIN	COCKPIT	prix_min_mad	MASQUE
DIRECTION	COCKPIT	prix_min_mad	LECTURE
ASSISTANTE	COCKPIT	prix_min_mad	MASQUE
ADMIN	COCKPIT	valeur_conso_annuelle_mad	LECTURE
MAGASIN	COCKPIT	valeur_conso_annuelle_mad	MASQUE
DIRECTION	COCKPIT	valeur_conso_annuelle_mad	LECTURE
ASSISTANTE	COCKPIT	valeur_conso_annuelle_mad	MASQUE
ADMIN	COCKPIT	montant_total_mad	LECTURE
MAGASIN	COCKPIT	montant_total_mad	MASQUE
DIRECTION	COCKPIT	montant_total_mad	LECTURE
ASSISTANTE	COCKPIT	montant_total_mad	MASQUE
ASSISTANTE	MOUVEMENTS	entrees_mad	MASQUE
ASSISTANTE	MOUVEMENTS	entrees_dhs	MASQUE
ASSISTANTE	MOUVEMENTS	prix_moyen_entree_mad	MASQUE
MAGASIN	MOUVEMENTS	entrees_mad	MASQUE
MAGASIN	MOUVEMENTS	entrees_dhs	MASQUE
MAGASIN	MOUVEMENTS	prix_moyen_entree_mad	MASQUE
ADMIN	RECEPTIONS	montant_facture_mad	LECTURE
MAGASIN	RECEPTIONS	montant_facture_mad	MASQUE
DIRECTION	RECEPTIONS	montant_facture_mad	LECTURE
ASSISTANTE	RECEPTIONS	montant_facture_mad	LECTURE
ADMIN	RECEPTIONS	frais_facture_mad	LECTURE
MAGASIN	RECEPTIONS	frais_facture_mad	MASQUE
DIRECTION	RECEPTIONS	frais_facture_mad	LECTURE
ASSISTANTE	RECEPTIONS	frais_facture_mad	LECTURE
ADMIN	RECEPTIONS	taux_change_reception	LECTURE
MAGASIN	RECEPTIONS	taux_change_reception	MASQUE
DIRECTION	RECEPTIONS	taux_change_reception	LECTURE
ASSISTANTE	RECEPTIONS	taux_change_reception	LECTURE
ADMIN	RECEPTIONS	valeur_provisoire_mad	LECTURE
MAGASIN	RECEPTIONS	valeur_provisoire_mad	MASQUE
DIRECTION	RECEPTIONS	valeur_provisoire_mad	LECTURE
ASSISTANTE	RECEPTIONS	valeur_provisoire_mad	LECTURE
ADMIN	RECEPTIONS	valeur_definitive_mad	LECTURE
MAGASIN	RECEPTIONS	valeur_definitive_mad	MASQUE
DIRECTION	RECEPTIONS	valeur_definitive_mad	LECTURE
ASSISTANTE	RECEPTIONS	valeur_definitive_mad	LECTURE
ADMIN	RECEPTIONS	difference_mad	LECTURE
MAGASIN	RECEPTIONS	difference_mad	MASQUE
DIRECTION	RECEPTIONS	difference_mad	LECTURE
ASSISTANTE	RECEPTIONS	difference_mad	LECTURE
ADMIN	RECEPTIONS	au_stock_mad	LECTURE
MAGASIN	RECEPTIONS	au_stock_mad	MASQUE
DIRECTION	RECEPTIONS	au_stock_mad	LECTURE
ASSISTANTE	RECEPTIONS	au_stock_mad	LECTURE
ADMIN	RECEPTIONS	ecart_prix_mad	LECTURE
MAGASIN	RECEPTIONS	ecart_prix_mad	MASQUE
DIRECTION	RECEPTIONS	ecart_prix_mad	LECTURE
ASSISTANTE	RECEPTIONS	ecart_prix_mad	LECTURE
ADMIN	RECEPTIONS	cmup_avant	LECTURE
MAGASIN	RECEPTIONS	cmup_avant	MASQUE
DIRECTION	RECEPTIONS	cmup_avant	LECTURE
ASSISTANTE	RECEPTIONS	cmup_avant	LECTURE
ADMIN	RECEPTIONS	cmup_apres	LECTURE
MAGASIN	RECEPTIONS	cmup_apres	MASQUE
DIRECTION	RECEPTIONS	cmup_apres	LECTURE
ASSISTANTE	RECEPTIONS	cmup_apres	LECTURE
ADMIN	STOCK	prix_entree_mad	LECTURE
MAGASIN	STOCK	prix_entree_mad	MASQUE
DIRECTION	STOCK	prix_entree_mad	LECTURE
ASSISTANTE	STOCK	prix_entree_mad	MASQUE
ADMIN	RECEPTIONS	montant_facture_devise	LECTURE
MAGASIN	RECEPTIONS	montant_facture_devise	MASQUE
DIRECTION	RECEPTIONS	montant_facture_devise	LECTURE
ASSISTANTE	RECEPTIONS	montant_facture_devise	LECTURE
ADMIN	RECEPTIONS	taux_facture	LECTURE
MAGASIN	RECEPTIONS	taux_facture	MASQUE
DIRECTION	RECEPTIONS	taux_facture	LECTURE
ASSISTANTE	RECEPTIONS	taux_facture	LECTURE
ADMIN	RECEPTIONS	montant_devise	LECTURE
MAGASIN	RECEPTIONS	montant_devise	MASQUE
DIRECTION	RECEPTIONS	montant_devise	LECTURE
ASSISTANTE	RECEPTIONS	montant_devise	LECTURE
\.


ALTER TABLE public.modele_droit_champ ENABLE TRIGGER ALL;

--
-- Data for Name: motif_ligne; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.motif_ligne DISABLE TRIGGER ALL;

COPY public.motif_ligne (code_motif_ligne, libelle, categorie, actif) FROM stdin;
R1	Defaut qualité matière	RETOUR	1
R2	Erreur de référence	RETOUR	1
R3	Excedent de production	RETOUR	1
R4	Rebut / chute non reutilisable	RETOUR	1
R5	Erreur de saisie	CORRECTION	1
R6	Écart d'inventaire	INVENTAIRE	1
\.


ALTER TABLE public.motif_ligne ENABLE TRIGGER ALL;

--
-- Data for Name: motif_mouvement; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.motif_mouvement DISABLE TRIGGER ALL;

COPY public.motif_mouvement (code_motif, libelle, categorie, signe_default, actif) FROM stdin;
INIT	Stock initial	INITIALISATION	1	1
RECEPTION	Réception fournisseur	ACHAT	1	1
PRODUCTION	Consommation production	PRODUCTION	-1	1
RETOUR_FOUR	Retour au fournisseur	ACHAT	-1	1
RETOUR_PROD	Retour depuis atelier	PRODUCTION	1	1
INVENTAIRE	Ajustement d'inventaire	INVENTAIRE	1	1
TRANSFERT	Transfert inter-magasin	LOGISTIQUE	1	1
MACHINE	Chargement / retour machine	PRODUCTION	1	1
CONTREPASSATION	Contre-passation d'un mouvement	CORRECTION	-1	1
FUSION	Fusion de lots	LOGISTIQUE	1	1
IDENTIFICATION	Identification du lot	LOGISTIQUE	1	1
\.


ALTER TABLE public.motif_mouvement ENABLE TRIGGER ALL;

--
-- Data for Name: parametre; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.parametre DISABLE TRIGGER ALL;

COPY public.parametre (code_parametre, libelle, valeur_courante, type_donnee, unite, description, categorie, modifiable_par, verrouille, date_derniere_modif, id_utilisateur_modif, motif_modif, actif) FROM stdin;
P_SeuilAlerte	Seuil d'alerte (statut ATTENTION)	90	ENTIER	jours	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilCritique	Seuil critique (statut CRITIQUE)	60	ENTIER	jours	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_RetardBCJours	Retard au-dela duquel une commande ne compte plus	5	ENTIER	jours	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_EcartCouvertureJours	Couverture au-dela de laquelle un stock bas est un ecart	60	ENTIER	jours	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_DelaiDefaut	Délai fournisseur par defaut	60	ENTIER	jours	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_MargeSecurite	Marge de sécurité sur couverture	20	DECIMAL	%	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_MargeJours	Marge en jours sur date de besoin	30	ENTIER	jours	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_CouvMinMois	Couverture minimale cible	2.0	DECIMAL	mois	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_TauxPerte	Taux de perte production	2	DECIMAL	%	\N	PROD	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_ToleranceRecette	Tolerance sur la somme des % d'une recette	0.5	DECIMAL	%	\N	PROD	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SecuriteA	Stock de sécurité classe A	30	ENTIER	jours	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SecuriteB	Stock de sécurité classe B	30	ENTIER	jours	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SecuriteC	Stock de sécurité classe C	30	ENTIER	jours	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_DateSaisie	Date de la photo de stock initial (figee)	2026-04-27	DATE	\N	\N	SYSTEME	AUCUN	1	2026-09-04T19:04:34.398Z	\N	\N	1
P_Devise	Devise pivot	MAD	TEXTE	\N	\N	SYSTEME	AUCUN	1	2026-09-04T19:04:34.398Z	\N	\N	1
P_TolerInFull	Tolerance In-Full	2	DECIMAL	%	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_CibleOTIF	Cible OTIF fournisseurs	95	DECIMAL	%	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilTier1	Seuil montant TIER 1	300000	DECIMAL	MAD	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilTier2	Seuil montant TIER 2	200000	DECIMAL	MAD	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilTier3	Seuil montant TIER 3	100000	DECIMAL	MAD	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_ScoreStrategique	Score fournisseur STRATEGIQUE	85	DECIMAL	/100	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilDormant	Seuil de stock dormant	180	ENTIER	jours	\N	STOCK	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_ScoreStandard	Score fournisseur STANDARD	65	DECIMAL	/100	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_ScoreSurveiller	Score fournisseur A SURVEILLER	45	DECIMAL	/100	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_TolerEcartPesee	Tolerance ecart de pesée en réception	2	DECIMAL	%	\N	RECEPT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_TolerEstimMachine	Tolerance ecart estimation en machine	10	DECIMAL	%	\N	MACHINE	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_JoursInventMachine	Anciennete max d'inventaire d'un emplacement	30	ENTIER	jours	\N	MACHINE	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilValidationBC	Montant BC exigeant validation Direction	300000	DECIMAL	MAD	\N	ACHAT	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilABCA	Seuil cumul classe A	80	DECIMAL	%	\N	ANALYSE	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilABCB	Seuil cumul classe B	95	DECIMAL	%	\N	ANALYSE	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilXYZ_X	Seuil CV classe X	0.25	DECIMAL	ratio	\N	ANALYSE	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_SeuilXYZ_Y	Seuil CV classe Y	0.50	DECIMAL	ratio	\N	ANALYSE	DIRECTION	0	2026-09-04T19:04:34.398Z	\N	\N	1
P_NomEntreprise	Nom de l'entreprise	Polyfashions Carpet Morocco	TEXTE	\N	Figure sur les etats d'impression et les bons de commande.	ENTREPRISE	DIRECTION	0	2026-09-04T19:04:34.407Z	\N	\N	1
P_Secteur	Secteur d'activite	Fabrication de tapis mecaniques	TEXTE	\N	Contexte métier, sans effet sur les calculs.	ENTREPRISE	DIRECTION	0	2026-09-04T19:04:34.407Z	\N	\N	1
P_Pays	Pays	Maroc	TEXTE	\N	Pays du siege : sert de référence pour distinguer achats locaux et imports.	ENTREPRISE	DIRECTION	0	2026-09-04T19:04:34.407Z	\N	\N	1
P_DateCreationERP	Date de mise en service	2026-04-18	DATE	\N	Début de l'historique exploitable : avant cette date, les données viennent de la reprise.	ENTREPRISE	DIRECTION	0	2026-09-04T19:04:34.407Z	\N	\N	1
P_SeuilBCGroupe	Seuil de regroupement des commandes	100000	ENTIER	MAD	En dessous, il est preferable de regrouper avec une autre commande du meme fournisseur plutot que d'emettre un bon isole.	ACHAT	DIRECTION	0	2026-09-04T19:04:34.407Z	\N	\N	1
P_DSODefaut	Délai de paiement par defaut	60	ENTIER	jours	Applique quand le fournisseur n'en declare aucun. Sert au prévisionnel de tresorerie.	ACHAT	DIRECTION	0	2026-09-04T19:04:34.407Z	\N	\N	1
P_DateRefKPI	Date de référence des indicateurs	2026-07-18	DATE	\N	Point de depart des cumuls et des comparaisons annuelles.	ANALYSE	DIRECTION	0	2026-09-04T19:04:34.407Z	\N	\N	1
P_AssistantPlateforme	Adresse de GestionAi		TEXTE	\N	L'adresse du service d'agents de l'entreprise, par exemple http://127.0.0.1:8090 en local ou https://ia.polyfashion.local depuis le reseau. Laisser vide tant que le service n'est pas installe. La cle d'application, elle, se pose dans GESTIONAI_CLE du fichier .env du serveur — jamais ici.	SYSTEME	DIRECTION	0	2026-09-25T17:19:20.858Z	\N	\N	1
P_LotDormanceJours	Dormance d'un lot	365	ENTIER	jours	Un lot sans aucune activite (entree, sortie, constat) depuis cette duree est signale dormant.	STOCK	DIRECTION	0	2026-10-03T10:44:01.601Z	\N	\N	1
P_LotTolOrangePct	Ecart de poids : seuil orange	1	DECIMAL	%	Au-dela, la ligne demande une confirmation (« Je confirme avoir verifie »).	STOCK	DIRECTION	0	2026-10-03T10:44:01.601Z	\N	\N	1
P_LotTolRougePct	Ecart de poids : seuil rouge	3	DECIMAL	%	Au-dela, la ligne demande une autorisation d'un responsable.	STOCK	DIRECTION	0	2026-10-03T10:44:01.601Z	\N	\N	1
P_LotSeuilBobines	Seuil Projet / Restes : bobines d'un etage	1344	ENTIER	bobines	Un lot qui remplit au moins un etage de machine est du stock Projet ; en dessous, c'est un Reste. 1 344 = un etage de CRM1, TINGIS ou CRX.	STOCK	DIRECTION	0	2026-10-03T10:44:01.601Z	\N	\N	1
P_LotSeuilRestesKg	Seuil Projet / Restes en kilos	5000	DECIMAL	kg	Pour un article sans poids de bobine au catalogue (jute, colle) : sous ce poids, un lot est un Reste.	STOCK	DIRECTION	0	2026-10-03T10:44:01.601Z	\N	\N	1
P_ColisageTolAlertePct	Colisage : alerte sur le poids d'une bobine	10	DECIMAL	%	Au-dela, l'ecran signale que kilos et bobines ne s'accordent pas avec la fiche article.	RECEPT	DIRECTION	0	2026-10-08T16:27:05.014Z	\N	\N	1
P_ColisageTolRefusPct	Colisage : refus sur le poids d'une bobine	25	DECIMAL	%	Au-dela, la ligne est refusee (bon, facture, reception) : kilos, bobines et palettes se contredisent.	RECEPT	DIRECTION	0	2026-10-08T16:27:05.014Z	\N	\N	1
P_MrpInclureStockMachine	Compter le fil sur machine dans les besoins d'achat	1	ENTIER	\N	1 : le fil charge sur machine compte comme stock disponible pour le calcul des besoins ; 0 : il est ignore.	STOCK	DIRECTION	0	2026-10-08T16:39:11.819Z	\N	\N	1
P_DureeEcartJours	Duree d'une proposition d'achat ecartee	90	ENTIER	jours	Au-dela, la proposition ecartee cesse de masquer la reference : le besoin est repropose au calcul suivant. Elle reste en base, marquee expiree.	STOCK	DIRECTION	0	2026-10-08T16:40:14.746Z	\N	\N	1
P_AncienneteTauxJours	Anciennete maximale du taux de reference	7	ENTIER	jours	Au-dela, un bon de commande en devise ne se valide pas tant que le taux du jour n'est pas saisi. Le taux de chaque facture d'import reste celui de sa facture.	ACHAT	DIRECTION	0	2026-10-08T16:42:22.889Z	\N	\N	1
P_MachineEcartVertKg	Ecart machine : vert jusqu'a (kg)	10	DECIMAL	kg	Le seuil vert est le plus grand de ce poids et du pourcentage vert de la ligne.	MACHINE	DIRECTION	0	2026-10-08T16:47:34.827Z	\N	\N	1
P_MachineEcartVertPct	Ecart machine : vert jusqu'a (%)	1	DECIMAL	%	Pourcentage du poids de la ligne.	MACHINE	DIRECTION	0	2026-10-08T16:47:34.827Z	\N	\N	1
P_MachineEcartRougeKg	Ecart machine : rouge au-dela de (kg)	50	DECIMAL	kg	Le seuil rouge est le plus grand de ce poids et du pourcentage rouge de la ligne.	MACHINE	DIRECTION	0	2026-10-08T16:47:34.827Z	\N	\N	1
P_MachineEcartRougePct	Ecart machine : rouge au-dela de (%)	5	DECIMAL	%	Pourcentage du poids de la ligne.	MACHINE	DIRECTION	0	2026-10-08T16:47:34.827Z	\N	\N	1
P_ClotureEcartAvisPct	Cloture facture : avis au-dela de l'ecart	10	DECIMAL	%	Au-dela, l'apercu de cloture signale que la facture s'ecarte de la valeur au prix du bon (sans bloquer).	RECEPT	DIRECTION	0	2026-10-08T19:10:15.827Z	\N	\N	1
P_DechetSeuilValiderKg	Dechet : seuil de validation (kg)	50	DECIMAL	kg	Au-dela, un dechet saisi a la main demande le droit de valider l'inventaire, comme un ajustement negatif.	STOCK	DIRECTION	0	2026-10-08T19:37:54.660Z	\N	\N	1
P_EncoursRetardInclus	Compter les commandes en retard dans l'en-cours	1	ENTIER	\N	1 : une ligne de bon en retard reste comptee dans l'en-cours (le retard se relance) ; 0 : elle en sort et le besoin est repropose.	STOCK	DIRECTION	0	2026-10-08T20:48:18.505Z	\N	\N	1
P_HorizonProlonge	Prolonger la demande au-dela du plan	1	ENTIER	\N	1 : au-dela du dernier mois du plan en service, la demande se prolonge a la moyenne mensuelle du plan ; 0 : elle est nulle.	STOCK	DIRECTION	0	2026-10-08T20:48:18.505Z	\N	\N	1
\.


ALTER TABLE public.parametre ENABLE TRIGGER ALL;

--
-- Data for Name: parametres_frais; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.parametres_frais DISABLE TRIGGER ALL;

COPY public.parametres_frais (id_frais, libelle, categorie, inclus_dans_cout, ordre, actif, piece_justificative, recuperable, commun, methode_repartition) FROM stdin;
DOUANE	Droits de douane (D.D.)	DOUANE	1	10	1	Quittance de la douane	0	1	VALEUR
TVA	TVA a l'importation	TAXE	0	20	1	Quittance de la douane	1	1	VALEUR
PORT_MED	Port Tanger Med	PORT	1	30	1	Facture du port	0	1	VALEUR
FRET	Fret	TRANSPORT	1	40	1	Facture du transporteur maritime	0	1	VALEUR
TREMSA	Transitaire (TREMSA / WIDEM)	TRANSIT	1	50	1	Facture du transitaire	0	1	VALEUR
TIMBRE	Timbre	TAXE	1	60	1	Timbre fiscal	0	1	VALEUR
INT_OC	INT/OC	TRANSIT	1	70	1	Facture du transitaire	0	1	VALEUR
TMSA	TMSA	PORT	1	80	1	Facture TMSA	0	1	VALEUR
TRANSPORT	Transport local	TRANSPORT	1	90	1	Facture du transporteur routier	0	1	VALEUR
AUTRE	Autre frais	AUTRE	1	99	1	\N	0	0	VALEUR
\.


ALTER TABLE public.parametres_frais ENABLE TRIGGER ALL;

--
-- Data for Name: permission; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.permission DISABLE TRIGGER ALL;

COPY public.permission (id_permission, code_role_user, module, action, actif) FROM stdin;
f2a97e1e-45b2-42df-8380-b0870e9e3f8d	DIRECTION	IMPORT	LIRE	1
e8f5b5de-f469-4a74-8936-4e4a7e8ce062	DIRECTION	IMPORT	ECRIRE	1
198f14bb-e925-4a2a-b844-d5531707b315	DIRECTION	IMPORT	VALIDER	1
65e98839-ad15-446f-aff8-e357e3826e7c	ASSISTANTE	IMPORT	LIRE	1
31b3bc9f-8369-4523-b370-affb3f89d2fd	ASSISTANTE	IMPORT	ECRIRE	1
b5c6ef97-226d-448e-816d-951aba702477	ASSISTANTE	COCKPIT	LIRE	0
4d06aa2a-09aa-42be-8e29-9ecb455e58b9	ASSISTANTE	QUALITES	ECRIRE	0
86c1abfb-306a-40c9-8588-188afc922508	ASSISTANTE	RECETTES	ECRIRE	0
4b338f0b-c389-4b89-98be-da483083e7a8	DIRECTION	COCKPIT	LIRE	1
580c57cb-2d81-4d70-928d-e59acc64786d	DIRECTION	COCKPIT	ECRIRE	1
f59b7cd0-74a0-4b61-991c-946db10f31d7	MAGASIN	COCKPIT	LIRE	1
2e85f2d2-1e26-48c1-b337-59b6dd2947de	DIRECTION	CATALOGUE	LIRE	1
58f55ef1-3567-45cb-ad64-8600963954cd	DIRECTION	CATALOGUE	ECRIRE	1
ffc6ec33-0073-4d43-958c-8f74fc020fc7	ASSISTANTE	CATALOGUE	LIRE	1
0ad3ac78-ca16-4292-83e3-81aed13d3a4f	ASSISTANTE	CATALOGUE	ECRIRE	1
440dc77a-eaa9-487d-8515-b00db802edb0	MAGASIN	CATALOGUE	LIRE	1
1ed1b8e6-403a-488e-b310-b9bdbf728135	DIRECTION	FOURNISSEURS	LIRE	1
2da275e0-ab05-42db-bd10-e04039166f40	DIRECTION	FOURNISSEURS	ECRIRE	1
dca8d8a6-8e8a-4cd5-9799-ea170b9ee40a	ASSISTANTE	FOURNISSEURS	LIRE	1
26f510fd-a0bd-473d-a35e-b414e12810b8	ASSISTANTE	FOURNISSEURS	ECRIRE	1
51255681-d154-4e09-8422-bc9921f49449	MAGASIN	FOURNISSEURS	LIRE	1
ee43cede-be02-4512-bdbf-ba816772cf9f	DIRECTION	QUALITES	LIRE	1
f8866aa7-426e-4434-b2c1-58cbc7cf4608	DIRECTION	QUALITES	ECRIRE	1
cf77e014-a723-4a72-98c3-d08b61e16e28	DIRECTION	QUALITES	VALIDER	1
3b809517-9117-441d-bdf8-6236a88e9fb5	ASSISTANTE	QUALITES	LIRE	1
9f4ff09f-a1a1-4bd2-bf79-7ccc1dde93dc	MAGASIN	QUALITES	LIRE	1
0c5f794e-1dae-4665-b02a-6417c711676b	DIRECTION	RECETTES	LIRE	1
b930c298-cb1e-4363-ab41-caf170b0a1be	DIRECTION	RECETTES	ECRIRE	1
d50d3d6d-f806-435a-bf1d-e31c29850616	DIRECTION	RECETTES	VALIDER	1
bd8af0c9-320c-4189-9512-a33298fcaa0c	ASSISTANTE	RECETTES	LIRE	1
02e26cd4-f137-41a9-8d6d-935bce66d850	MAGASIN	RECETTES	LIRE	1
485dae5a-7ff4-41e9-abb4-2ab5298f85b9	DIRECTION	PLANS	LIRE	1
44bfa35c-ed36-4fe7-aae4-522b72e94296	DIRECTION	PLANS	ECRIRE	1
f37c8acc-3985-4f58-91ca-55c6ed168068	DIRECTION	PLANS	VALIDER	1
b01be4e8-746a-417d-89f6-7d3af67a0443	ASSISTANTE	PLANS	LIRE	1
8d4cda79-f3ba-40a4-a20f-677c1b81be19	ASSISTANTE	PLANS	ECRIRE	1
13b135f0-0aed-47cc-91b2-1eb4bb192c96	ASSISTANTE	PLANS	VALIDER	1
4b01dc12-5cf7-4292-9317-b1d7e56f4d6c	MAGASIN	PLANS	LIRE	1
938a9311-3983-4f7a-b25d-4cd62c00b1b0	DIRECTION	MRP	LIRE	1
6bd2d553-8287-4441-aaff-79859e614737	DIRECTION	MRP	ECRIRE	1
4e38ca8d-27b6-42f8-881f-af076af3741a	ASSISTANTE	MRP	LIRE	1
e7e09ffe-c700-4aa4-9ec0-1d5862b982cf	ASSISTANTE	MRP	ECRIRE	1
868149ba-764f-4271-867f-45f7436cb5fb	MAGASIN	MRP	LIRE	1
b48056c2-b85f-43df-96a7-d3b41eda61a2	DIRECTION	PLAN_ACHAT	LIRE	1
564514c4-6801-420a-b657-d4ef4b073c59	DIRECTION	PLAN_ACHAT	ECRIRE	1
750d61af-d2eb-46c1-8f26-2f7295ee1c54	DIRECTION	PLAN_ACHAT	VALIDER	1
8a33a766-de45-4e00-a2f4-234115616c24	ASSISTANTE	PLAN_ACHAT	LIRE	1
f228057b-e2ef-4380-a462-5caa7dea2dc1	ASSISTANTE	PLAN_ACHAT	ECRIRE	1
e8b11feb-47f9-4f27-beb5-edaf60b75df1	MAGASIN	PLAN_ACHAT	LIRE	1
494099ac-984d-4df1-95d2-336e8ab20338	DIRECTION	BONS_COMMANDE	LIRE	1
ffb95389-a220-41e7-b1c1-cf1a29710788	DIRECTION	BONS_COMMANDE	ECRIRE	1
8f7e9b30-3b4d-4197-b891-479ee4b280a9	DIRECTION	BONS_COMMANDE	VALIDER	1
16ed558b-b0ed-4247-98ac-3bd44c803fb1	ASSISTANTE	BONS_COMMANDE	LIRE	1
1642e42f-2d43-4362-aef6-97fbfcab6f79	ASSISTANTE	BONS_COMMANDE	ECRIRE	1
1daff391-81ea-4653-b33b-72a1d6c14b63	MAGASIN	BONS_COMMANDE	LIRE	1
5e0d3852-e7b8-44e8-925c-128298d23139	DIRECTION	RECEPTIONS	LIRE	1
d18bc2ed-d582-4364-8d82-d63b8f646033	DIRECTION	RECEPTIONS	ECRIRE	1
7a89f123-7454-41a1-89d0-2e40cd8c6103	DIRECTION	RECEPTIONS	VALIDER	1
aad4fd11-3f57-4deb-9de3-4d402cfc073a	ASSISTANTE	RECEPTIONS	LIRE	1
9b63481a-9faf-42b5-835b-138ddaadbc7a	ASSISTANTE	RECEPTIONS	ECRIRE	1
f597b6c0-56f6-4fb2-992b-550df72b3d6b	MAGASIN	RECEPTIONS	LIRE	1
f7795975-838c-4bf5-83f3-da7394b4a059	MAGASIN	RECEPTIONS	ECRIRE	1
fdf15398-1fdc-4357-a002-fc2153de56a3	DIRECTION	MOUVEMENTS	LIRE	1
84d56668-a10e-4dcb-8d66-483b265a66ab	DIRECTION	MOUVEMENTS	ECRIRE	1
ec2147f5-137d-4366-9cbe-71e8a13b4079	DIRECTION	MOUVEMENTS	VALIDER	1
f23bfc8f-32e6-43d4-a1ac-53e26da083ca	ASSISTANTE	MOUVEMENTS	LIRE	1
93229bf2-eb7f-4ffa-906a-8d29e59b225b	ASSISTANTE	MOUVEMENTS	ECRIRE	1
ec5d9711-b9d2-4228-8440-0e961dc6e685	MAGASIN	MOUVEMENTS	LIRE	1
a3a7694e-7dc1-491f-aab2-268c0e0ed2aa	MAGASIN	MOUVEMENTS	ECRIRE	1
6a5d1a2b-a9e4-47f4-be36-e4b124b67843	MAGASIN	MOUVEMENTS	VALIDER	1
6d522e4c-5057-4751-8e42-8767206ffdbc	DIRECTION	INVENTAIRE	LIRE	1
36a952db-0317-4286-9909-550f1ab0db64	DIRECTION	INVENTAIRE	ECRIRE	1
ac237b12-11f2-4a38-bc98-1309d8c8d039	DIRECTION	INVENTAIRE	VALIDER	1
e0d80a31-6f75-46d1-ada9-15a77d557524	ASSISTANTE	INVENTAIRE	LIRE	1
346da2d6-7762-4fa3-bd88-6258d567158d	ASSISTANTE	INVENTAIRE	ECRIRE	1
b5c775d4-6353-4e9a-9019-4b12bf11655e	MAGASIN	INVENTAIRE	LIRE	1
a3f141f7-1179-468c-b942-895bdc92f5ae	MAGASIN	INVENTAIRE	ECRIRE	1
cfe88426-0c79-4b00-b8a5-08fc3cd053fa	DIRECTION	STOCK	LIRE	1
95392006-1cdc-4a76-814a-182068724a04	DIRECTION	STOCK	ECRIRE	1
5b8ad6fc-04aa-4021-bf23-418ce2bfa75e	ASSISTANTE	STOCK	LIRE	1
7c34eeab-3a70-41d9-ab94-fa71907f891f	ASSISTANTE	STOCK	ECRIRE	1
17b9be74-fce8-4963-90c4-6342424e3f7f	MAGASIN	STOCK	LIRE	1
7a53d603-2615-4ec7-87b9-fd5e748ffea6	DIRECTION	VALORISATION	LIRE	1
c0e35cd3-c902-47bf-b874-ea70e1688fc5	DIRECTION	VALORISATION	ECRIRE	1
14efab5b-54fd-4f9a-8532-0dcbddde8c3d	DIRECTION	PARAMETRES	LIRE	1
258d9672-7db2-4158-b3e1-258c307974a5	DIRECTION	PARAMETRES	ECRIRE	1
7801aeab-c2ee-4db1-85e5-b347bf217a65	ASSISTANTE	PARAMETRES	LIRE	1
37695107-1b17-4c84-b7ee-71b4dc7bc3ee	MAGASIN	PARAMETRES	LIRE	1
269293aa-782f-4b0c-b9d9-f10845fffab1	DIRECTION	UTILISATEURS	LIRE	1
9befcae4-1734-4f73-a134-5d0920314a5c	DIRECTION	AUDIT	LIRE	1
1a9ca42f-9164-4bd8-baaf-97f4e86376b8	ADMIN	AUDIT	VALIDER	1
be633552-c701-490c-aee6-ee9bf8313d27	ADMIN	PLANS	ECRIRE	1
f9122b99-7383-490c-9d9d-545047303065	ADMIN	PLANS	VALIDER	1
d2f90938-043f-4b28-ad00-78e3c28f86ad	ADMIN	RECETTES	ECRIRE	1
c4b6558d-498b-46bd-872d-d25eeaa25318	ADMIN	RECETTES	VALIDER	1
f627d817-67d1-4d59-99ba-acb98d53c8b0	ADMIN	BONS_COMMANDE	ECRIRE	1
931fd481-f464-4150-a2a6-c4fae8d3491f	ADMIN	BONS_COMMANDE	VALIDER	1
caa5c0f1-0fc2-4c8a-90d3-134bdf6cb121	ADMIN	COCKPIT	ECRIRE	1
702e3250-9b8d-43b8-a511-6d2dfc17c3a7	ADMIN	COCKPIT	VALIDER	1
04382c98-1a87-4493-af7f-d10f9e0fb00e	ADMIN	PARAMETRES	VALIDER	1
8702fea8-bae5-4622-85cf-be25b5e6f2c9	ADMIN	MRP	ECRIRE	1
e18737d9-51ac-4004-b562-c78f8b5bf777	ADMIN	MRP	VALIDER	1
e33c860a-7f46-47df-a875-5f19ed0e02f5	ADMIN	RECEPTIONS	ECRIRE	1
c2a532fd-331f-4966-b52f-4c5c3ba82f0d	ADMIN	RECEPTIONS	VALIDER	1
5e23a5c9-e51d-4712-8c5f-7d94b1d92d32	ADMIN	QUALITES	ECRIRE	1
dc7551af-f922-475e-9b09-bc2e9111df7d	ADMIN	QUALITES	VALIDER	1
0a019097-008e-4d98-ad04-34335a920114	ADMIN	STOCK	ECRIRE	1
89395607-5e65-4aae-ad62-4da19b4702ea	ADMIN	STOCK	VALIDER	1
c17501af-1bca-452e-a217-5ca2c00496f8	ADMIN	FOURNISSEURS	VALIDER	1
482ee036-afe8-4619-821e-4bf2e0b0e140	ADMIN	CATALOGUE	VALIDER	1
eb8fef3c-cc0a-4b5e-ac2b-2bfe42c82274	ADMIN	INVENTAIRE	ECRIRE	1
a1801b1f-4647-4dcd-ab25-cebd5b41dc09	ADMIN	INVENTAIRE	VALIDER	1
15895e4e-5bd6-4e6d-a4c7-53e0a111de83	ADMIN	UTILISATEURS	VALIDER	1
12b0fadc-d535-406e-bed8-57e22017e2d8	ADMIN	MOUVEMENTS	ECRIRE	1
b40bc431-397c-497b-b0c9-a6d8f7edf086	ADMIN	MOUVEMENTS	VALIDER	1
fa61ad56-234b-4e82-becf-74849c288edd	ADMIN	VALORISATION	LIRE	1
072e196f-02ec-453a-a809-bd06012788ef	ADMIN	VALORISATION	ECRIRE	1
7ba1e77f-fd29-40b9-a8c5-07f1daf0d6e7	ADMIN	VALORISATION	VALIDER	1
471d1bfa-626e-4466-abd6-9bf9424f0e4e	ADMIN	PLAN_ACHAT	ECRIRE	1
1323e39a-1a55-48ab-be19-5789fe412a4d	ADMIN	PLAN_ACHAT	VALIDER	1
61e26274-73d3-4fe3-a053-15713496ea72	ADMIN	IMPORT	LIRE	1
634380f4-415b-481a-927d-5ac79475b029	ADMIN	IMPORT	ECRIRE	1
305f9fce-1aea-44c3-b0cf-56017dd71c0e	ADMIN	IMPORT	VALIDER	1
e35ddc6b-9d5a-4f0f-9a2f-bcc0cd5d38a3	ADMIN	COCKPIT	LIRE	1
545aed5b-7a6e-4342-a748-bfdc8dd51e19	ADMIN	CATALOGUE	LIRE	1
71c26cb9-06e5-4bb0-a4bf-dbf2997dcf7c	ADMIN	CATALOGUE	ECRIRE	1
a9425d71-4ad6-4e9e-a017-438ce4d990dd	ADMIN	FOURNISSEURS	LIRE	1
07fe9d23-b294-4741-b838-dab99342349c	ADMIN	FOURNISSEURS	ECRIRE	1
267efe74-c064-4a74-a70c-a51d677eeb3e	ADMIN	QUALITES	LIRE	1
0cdf19fd-8c2d-4e0c-8e52-66c5e10deb1d	ADMIN	RECETTES	LIRE	1
36ead218-ef46-4cf6-be17-b71122d3618f	ADMIN	PLANS	LIRE	1
d3dc4608-677d-4e87-826c-60915003faee	ADMIN	MRP	LIRE	1
4dc41dad-7df7-49b5-a890-88c3996012e4	ADMIN	PLAN_ACHAT	LIRE	1
a6544112-7141-4560-b923-e0f5a3020c13	ADMIN	BONS_COMMANDE	LIRE	1
38b72854-b33d-4a14-a4c8-a32c1c46e608	ADMIN	RECEPTIONS	LIRE	1
b222262b-dfa1-42e8-8242-09a59d6a39b8	ADMIN	MOUVEMENTS	LIRE	1
47b99337-57f9-4bff-90f3-701fb6a6f390	ADMIN	INVENTAIRE	LIRE	1
d0292839-80c2-4ce5-af07-b9913e94d229	ADMIN	STOCK	LIRE	1
fa41729b-6daf-44a1-8b42-c34673a167f9	ADMIN	PARAMETRES	LIRE	1
e1ee61ca-bdc2-421a-a0dc-deaee24e6bb1	ADMIN	PARAMETRES	ECRIRE	1
71f43589-2883-4424-a5fb-6142544b9b1e	ADMIN	UTILISATEURS	LIRE	1
b7351a3e-a986-4319-b39e-a4dac65f80b4	ADMIN	UTILISATEURS	ECRIRE	1
e07299e7-9ec9-4ada-875c-d45df8ea47ae	ADMIN	AUDIT	LIRE	1
e54917ac-b185-492a-8896-277858bc7af4	ADMIN	AUDIT	ECRIRE	1
b593f085-6048-4559-b898-8343b1bdc49e	DIRECTION	LOTS	LIRE	1
4c70981f-28b5-4ce0-95ce-d294f7f8c32f	DIRECTION	LOTS	ECRIRE	1
3013b525-f357-437d-a498-98c145fb2391	ASSISTANTE	LOTS	LIRE	1
fbcc860e-7b4e-4d5a-8321-d2c377e17f3a	ASSISTANTE	LOTS	ECRIRE	1
4ef6f12b-280c-4336-a9a6-f4600c05f031	MAGASIN	LOTS	LIRE	1
dccb421a-a473-45ac-ae51-de8dd8a11063	ADMIN	LOTS	ECRIRE	1
15110942-e2ae-4837-81cc-ee0f75912527	ADMIN	LOTS	LIRE	1
8e5ec73f-818a-4f08-b359-614be523ee6b	DIRECTION	LOTS	VALIDER	1
d45f8c1b-a2b5-4554-a92d-2f1c6759e386	ADMIN	LOTS	VALIDER	1
\.


ALTER TABLE public.permission ENABLE TRIGGER ALL;

--
-- Data for Name: transition_statut; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.transition_statut DISABLE TRIGGER ALL;

COPY public.transition_statut (entite, statut_source, statut_cible, role_requis, description) FROM stdin;
qualite	BROUILLON	ACTIF	DIRECTION	Mise en service : contrôle R07 et densites
qualite	ACTIF	BROUILLON	PLANIF	Retour en redaction
qualite	BROUILLON	CLOTURE	PLANIF	Abandon avant mise en service
qualite	ACTIF	CLOTURE	DIRECTION	Retrait du catalogue
qualite	CLOTURE	BROUILLON	DIRECTION	Reouverture pour correction
plan_production	BROUILLON	SIMULATION	PLANIF	Test d'impact MRP
plan_production	SIMULATION	BROUILLON	PLANIF	Retour en redaction
plan_production	SIMULATION	EN_COURS	DIRECTION	Mise en service : alimente le MRP (R08)
plan_production	EN_COURS	CLOTURE	DIRECTION	Fin de période, archivage
plan_production	BROUILLON	CLOTURE	PLANIF	Abandon avant simulation
plan_production	SIMULATION	CLOTURE	PLANIF	Abandon du scenario
bon_commande	BROUILLON	EN_ATTENTE_VALIDATION	ACHAT	Soumission a validation
bon_commande	BROUILLON	ANNULE	ACHAT	Abandon
bon_commande	EN_ATTENTE_VALIDATION	BROUILLON	ACHAT	Renvoi pour correction
bon_commande	EN_ATTENTE_VALIDATION	VALIDE	DIRECTION	Validation (createur <> valideur)
bon_commande	EN_ATTENTE_VALIDATION	ANNULE	DIRECTION	Refus
bon_commande	VALIDE	ENVOYE	ACHAT	Envoi au fournisseur
bon_commande	VALIDE	ANNULE	DIRECTION	Annulation avant envoi
bon_commande	ENVOYE	LIVRE_PARTIEL	MAGASIN	Premiere réception
bon_commande	ENVOYE	CLOTURE	ACHAT	Réception complete en une fois
bon_commande	LIVRE_PARTIEL	CLOTURE	ACHAT	Dernière réception
reception	BROUILLON	A_CONTROLER	MAGASIN	Pesees saisies, en attente de contrôle qualité
reception	BROUILLON	ANNULE	MAGASIN	Abandon avant contrôle
reception	A_CONTROLER	BROUILLON	QUALITE	Renvoi pour correction des pesees
reception	A_CONTROLER	VALIDE	QUALITE	Contrôle qualité OK : declenche la cascade 3-en-1
reception	A_CONTROLER	ANNULE	QUALITE	Refus total de la livraison
reception	VALIDE	CLOTURE	MAGASIN	Clôture administrative
transfert	BROUILLON	VALIDE	MAGASIN	Depart de marchandise
transfert	BROUILLON	ANNULE	MAGASIN	Abandon
transfert	VALIDE	TERMINE	MAGASIN	Confirmation de réception a destination
inventaire	BROUILLON	EN_COURS	MAGASIN	Photo du stock theorique
inventaire	BROUILLON	ANNULE	MAGASIN	Abandon
inventaire	EN_COURS	CLOTURE	DIRECTION	Clôture : genere les ajustements
inventaire	EN_COURS	ANNULE	DIRECTION	Abandon du comptage
reception	VALIDE	A_CONTROLER	ADMIN	Devalidation : le controle est a refaire
bon_commande	ENVOYE	BROUILLON	ADMIN	Le fournisseur refuse le bon : il redevient modifiable
inventaire	CLOTURE	EN_COURS	ADMIN	Reouverture d'un inventaire : un comptage etait faux
reception	CLOTURE	A_CONTROLER	ADMIN	Reouverture d'une reception cloturee trop tot
plan_production	CLOTURE	BROUILLON	ADMIN	Reouverture d'un plan cloture trop tot
qualite	CLOTURE	ACTIF	ADMIN	Reouverture d'une qualite cloturee trop tot
bon_commande	VALIDE	BROUILLON	ADMIN	Devalidation d'un bon non encore servi
plan_production	EN_COURS	BROUILLON	ADMIN	Devalidation : le plan revient en saisie
\.


ALTER TABLE public.transition_statut ENABLE TRIGGER ALL;

--
-- Data for Name: type_mouvement; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.type_mouvement DISABLE TRIGGER ALL;

COPY public.type_mouvement (code_type_mvt, libelle, signe, exige_prix, impacte_cmup, exige_of, exige_motif_ligne, couleur, actif, interne) FROM stdin;
ENTREE_REC	Entree sur réception	1	1	1	0	0	#10b981	1	0
RETOUR_PROD	Retour de production	1	0	0	0	1	#14b8a6	1	0
AJUST_INV_POS	Ajustement inventaire +	1	0	0	0	1	#a855f7	1	0
SORTIE_PROD	Sortie production	-1	0	0	1	0	#f59e0b	1	0
RETOUR_FOURN	Retour fournisseur	-1	0	0	0	1	#ef4444	1	0
TRANSFERT_SORTIE	Transfert - sortie	-1	0	0	0	0	#0ea5e9	1	0
AJUST_INV_NEG	Ajustement inventaire -	-1	0	0	0	1	#a855f7	1	0
CHARGE_MACHINE	Charge machine	-1	0	0	0	0	#7c3aed	1	0
STOCK_INIT	Initialisation de stock	1	0	1	0	0	#6366f1	1	0
TRANSFERT_ENTREE	Transfert - entree	1	0	1	0	0	#0ea5e9	1	0
RETOUR_MACHINE	Retour machine	1	0	1	0	0	#7c3aed	1	0
FUSION_SORTIE	Fusion de lots - sortie	-1	0	0	0	0	#64748b	1	1
FUSION_ENTREE	Fusion de lots - entree	1	0	0	0	0	#64748b	1	1
ANNUL_CHARGE_MACHINE	Annulation d'un chargement machine	1	1	1	0	0	#9ca3af	1	1
ANNUL_RETOUR_MACHINE	Annulation d'un retour machine	-1	0	0	0	0	#9ca3af	1	1
\.


ALTER TABLE public.type_mouvement ENABLE TRIGGER ALL;

--
-- PostgreSQL database dump complete
--

\unrestrict HtkXv1fgBbFuG9eshThHAd2GCcsdKT31lW2tjbAlgDqYfU71WV7rTbxvfpa9UFQ

