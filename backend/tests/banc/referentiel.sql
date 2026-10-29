-- Referentiel du banc de tests, extrait de gestionfil_p1 par banc.py --referentiel-depuis.
-- Pas de stock ni de mouvement : chaque scenario cree ce dont il a besoin.

--
-- PostgreSQL database dump
--

\restrict gEfoJFzlQHTIrE6TpfI52ZtBVKMGZRZ3GE909P9QCvr5kb3PTqNy7sIdhNpTUBy

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
-- Data for Name: conditionnement; Type: TABLE DATA; Schema: public; Owner: -
--

SET SESSION AUTHORIZATION DEFAULT;

ALTER TABLE public.conditionnement DISABLE TRIGGER ALL;

COPY public.conditionnement (code_conditionnement, libelle, unite_singulier, unite_pluriel, se_compte, contenance_litres, ordre_affichage, actif, description) FROM stdin;
BOBINE	Bobine de fil	bobine	bobines	1	\N	10	1	Le fil, conditionnement historique et majoritaire du catalogue.
ROULEAU	Rouleau	rouleau	rouleaux	1	\N	20	1	Plastiques et nappes : des rouleaux poses sur palette.
ROULEAU_PETIT	Petit rouleau	rouleau	rouleaux	1	\N	30	1	La Bande : une palette en porte des centaines.
CUVE	Cuve IBC / GRV 1000 L	cuve	cuves	1	1000.00	40	1	Grand recipient pour vrac, sangle sur palette et pompe sur place. La colle.
FUT	Fut	fut	futs	1	200.00	50	1	Contenant metallique ou plastique de deux cents litres.
SAC	Sac	sac	sacs	1	\N	60	1	Poudres et granules.
CONTENEUR	Conteneur	conteneur	conteneurs	1	\N	70	1	Une piece unique, trop grande pour etre palettisee.
VRAC	Vrac	unite	unites	0	\N	80	1	Ne se compte pas : se pese. Aucun nombre d unites n est affiche.
\.


ALTER TABLE public.conditionnement ENABLE TRIGGER ALL;

--
-- Data for Name: fournisseur; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.fournisseur DISABLE TRIGGER ALL;

COPY public.fournisseur (code_fournisseur, nom, contact_principal, telephone, email, adresse, ville, pays, delai_livraison_jours, conditions_paiement, delai_paiement_jours, code_devise, incoterm, transporteur, note_globale, delai_reel_moyen_jours, tolerance_pesee_pct, actif, date_creation, palettes_par_conteneur, couverture_commande_j) FROM stdin;
FRS-002	SOFIA TEXTILE	ETHEM	905379349185	ethemibrhm@gmail.com	\N	\N	TURKEY	60	OPPEN ACCOUNT 30 JOUR	30	USD	\N	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-008	TEXTURE TEKSTIL	ORHAN	905301130027	muhasebe@teksturetekstil.com	\N	\N	TURKEY	70	LC 120 JOUR	120	USD	\N	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-009	LOMAT	CINDY BLANKE	3256620410	Receptie@Lomat.be	\N	\N	BELGIUM	60	OPEN ACCOUNT 120 JOUR	120	USD	\N	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-010	GLOBALTEX	CINDY CHRISTIAENS	3256282727	orders@globaltex.be	\N	\N	BELGIUM	78	OPEN ACCOUNT 120 JOUR	120	USD	\N	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-011	CHEMS PLASTIQUE	ABDLAMJUD	(212)667418697	chemsplastic@gmail.com	\N	\N	MAROC	4	APRES 60 JOUR	60	MAD	\N	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-012	EXTRA PLAST	IKRAM	(212)661238982	commercial@extra-plast.com	\N	\N	MAROC	6	APRES 60 JOUR	60	MAD	\N	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-003	GZM TEXTIL	NIDA	905354540274	export@gizemiplik.com	\N	\N	TURKEY	70	LC 120 JOUR	120	USD	CFR TANGIER	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-006	SUJATA	\N	\N	\N	\N	\N	INDE	90	LC 150 JOUR	150	USD	CFR TANGIER	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-007	TURKAN	OMER	905369626999	export@turkantextile.com	\N	\N	TURKEY	60	LC 120 JOUR	120	USD	CFR TANGIER	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	\N	\N
FRS-005	OZKARALAR	ERDAL	905432557803	export@ozkaralar.com	\N	\N	TURKEY	65	OPEN ACCOUNT 120 JOUR	120	USD	CFR TANGIER	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	18	\N
FRS-004	TAT TEXTIL	MUSTAPHA	905309633439	kambiyo@tatgroup.com.tr	\N	\N	TURKEY	65	LC 120 JOUR	120	USD	CFR TANGIER	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	20	\N
FRS-001	HASIRCI TEXTILE	ETHEM	905379349185	ethem@hasirci.com.tr	\N	\N	TURKEY	65	OPEN ACCOUNT 180 JOUR	180	USD	CFR TANGIER	\N	\N	\N	2.0000	1	2026-09-04T19:10:33.934Z	18	60
\.


ALTER TABLE public.fournisseur ENABLE TRIGGER ALL;

--
-- Data for Name: contact_fournisseur; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.contact_fournisseur DISABLE TRIGGER ALL;

COPY public.contact_fournisseur (id_contact, code_fournisseur, nom, fonction, email, telephone, est_principal, actif) FROM stdin;
\.


ALTER TABLE public.contact_fournisseur ENABLE TRIGGER ALL;

--
-- Data for Name: couleur; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.couleur DISABLE TRIGGER ALL;

COPY public.couleur (code_couleur_interne, libelle, classe_teinture, description, ordre_affichage, actif) FROM stdin;
C3	Rouge	RED	RED — classe tarifaire la plus chere	30	1
C5	Beige	\N	CREAM / BEIGE	50	1
C7	A preciser	\N	Code present chez Tekstur	70	1
CG	Gris clair	LIGHT	L.GRAY	90	1
CV	A preciser	\N	Code present chez Tekstur	100	1
CM	Marron	DARK	BROWN	110	1
CVR	Vert fonce	DARK	D.GREEN	140	1
TAUPE	Taupe	\N	\N	160	1
C1	Or	LIGHT	GOLD chez les fournisseurs	10	1
C5N	Beige fonce	DARK	\N	55	1
C4	BLUE	LIGHT	Code present chez Goral et Ozkaralar	40	1
C6	Maron	\N	Code present chez Tekstur et Turkan	60	1
C2	Noir	DARK	BLACK	20	1
C00	Blanc	\N	Plastiques, colles : matiere non teinte	5	1
C0	Noir (C0)	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
C5I	Beige clair	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
C5L	Creme	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
C5S	Beige (C5S)	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CB	Brique	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CBM	Camel (marron clair)	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CBR	Bleu fonce	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CGL	Gris clair (CGL)	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CGM	Gris mouchete	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CMG	Taupe (CMG)	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CML	Marron clair	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CR	Rose	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CT	Turquoise	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
CZ	Vison	\N	Cree depuis le classeur Liste ref fil (03/10/2026)	0	1
\.


ALTER TABLE public.couleur ENABLE TRIGGER ALL;

--
-- Data for Name: couleur_fournisseur; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.couleur_fournisseur DISABLE TRIGGER ALL;

COPY public.couleur_fournisseur (id_couleur_fournisseur, code_couleur_interne, code_fournisseur, code_couleur, libelle, supplement_teinture, actif) FROM stdin;
b086dc51-bc0e-4e4b-8c15-78c93ab0fcc5	C1	FRS-001	GOLD - 3423	OR	200.0000	1
9e97105c-17a4-4979-9362-ceb311b31593	C2	FRS-001	BLACK - 8001	NOIRE	100.0000	1
1879a16c-ac0d-4d23-99e2-d616e1099549	C3	FRS-001	RED - 7612	ROUGE	530.0000	1
cd2477fa-0733-4f8f-803c-05a2f926bf61	CG	FRS-001	GREY - 8933	GRIS CLAIR	150.0000	1
a36035c5-adc3-44db-871a-703c70b82f1d	C5	FRS-001	CREAM -44412	BEIGE	\N	1
dd5e9c9b-2099-4971-87a0-a43b54efa458	CVR	FRS-001	D. GREEN- 5449	VERT FONCE	400.0000	1
d0e5bd4a-422e-4832-b6ee-75b0ee5da167	C5N	FRS-001	2951	CREAM	\N	1
4e3d9dfb-2bb0-45b8-9f28-0e920a14977e	CVR	FRS-001	5455	D.GREEN	\N	1
d866cbad-e225-4e4a-9d94-42d3479d56b1	C4	FRS-001	6666	BLUE	\N	1
58c9399b-a493-4bc4-abdf-fb0cd653f03a	C1	FRS-005	GOLD OZ 3034	OR	150.0000	1
6a09bdd5-946b-46ae-a79f-cc671de287e7	C2	FRS-005	BLACK OZ 9000	NOIR	100.0000	1
fde55f28-f981-4d86-a121-d8669f7499e9	C3	FRS-005	RED OZ 5109	ROUGE	\N	1
039b2ad3-84c7-4741-8853-429cfd086bcc	CG	FRS-005	GREY OZ 9055	GRIS	100.0000	1
406b9ff0-d4eb-47f9-a5df-08d1ba68a07d	CVR	FRS-005	A/GREEN OZ8068	Vert Roi	330.0000	1
977e5adb-4c56-4871-ba7f-691da4072688	C4	FRS-005	OZ 7201	BLUE	\N	1
8bdc7c1e-f536-40f3-9452-a7e53150ee93	C3	FRS-008	TEX-1755	BORDEAUX	\N	1
c52f9333-4b22-47fb-bcf6-f43893944d84	C4	FRS-008	TEX-1470	TURQUOISE	\N	1
defdcc72-8091-4138-a374-8b2442649622	C5	FRS-008	TEX 1012	CREAM	\N	1
8ce03051-2a2c-49b9-b5a5-64b32065c4a3	C6	FRS-008	TEX 1042	MARRON	\N	1
5eb07ac6-eb28-4abb-bbce-171ddc34c5aa	C7	FRS-008	TEX-1531	ROSE	\N	1
9c3b89c4-ad3a-4ec4-b66e-f81883bef1ea	C5	FRS-008	TEX-1142	BEIGE	\N	1
19158e01-1691-43f9-b41b-5d7cb9ebe302	CG	FRS-008	TEX-1431	GRIS	\N	1
c5ca364c-8077-49e1-a68a-550e896d298f	CV	FRS-008	TEX-1595	VERT	\N	1
dafe7ca4-acee-4ae0-8dba-fd39d7946a2b	CM	FRS-008	TEX-1714	MARRON	\N	1
619df468-f12c-4a2a-8085-8c220e1cab62	C1	FRS-007	CB 284	GOLD	\N	1
4f82d40a-bee3-4fc6-a241-d1c11e7f4d07	C3	FRS-007	CB 1004	RED	\N	1
e76c1cd3-5707-435e-9191-da998b55221f	C4	FRS-007	CB 1206	BLUE	\N	1
0731ecc9-6b95-4771-bfa7-4c656c2ca132	C6	FRS-007	CB 118	L.BEIGE	\N	1
cf24a84d-24fb-473e-a7ed-464b249e8ab7	C5	FRS-007	CB 153	BEIGE	\N	1
447ca1ab-767c-4c32-bc2b-9329f075f10d	C6	FRS-007	CB-118	BEIGE	\N	1
81c69219-152e-4a0d-ad82-37af4eb78299	C5N	FRS-004	CREAM 1104	CREAM	\N	1
CF-C5-FRS-001-BEIGE	C5	FRS-001	BEIGE	Beige	\N	1
CF-C4-FRS-001-BLEU	C4	FRS-001	BLEU	Bleu	\N	1
CF-C5N-FRS-001-C5N	C5N	FRS-001	C5N	C5N	\N	1
CF-C5N-FRS-001-CREAM	C5N	FRS-001	CREAM	Cream	\N	1
CF-CVR-FRS-001-CVR	CVR	FRS-001	CVR	Cvr	\N	1
CF-CG-FRS-001-GRISCLAIRE	CG	FRS-001	GRIS CLAIRE	Gris Claire	\N	1
589782d0-ae7b-4a07-841d-12158cf77be7	C6	FRS-001	BROWN - 44361	MARRON	200.0000	1
a75d44cc-ea0b-4542-a6f8-b5577914963c	C6	FRS-005	BROWN OZ 6161	SH. brown	150.0000	1
CF-C5-FRS-001-LBEIGE	C5	FRS-001	L.BEIGE	L.Beige	\N	1
CF-CM-FRS-001-MARRON	CM	FRS-001	MARRON	Marron	\N	1
CF-CMS-FRS-001-MARRONCMS	C6	FRS-001	MARRON (CMS)	Marron (CMS)	\N	1
CF-C2-FRS-001-NOIR	C2	FRS-001	NOIR	Noir	\N	1
CF-C1-FRS-001-OR	C1	FRS-001	OR	Or	\N	1
CF-C7-FRS-001-ROSE	C7	FRS-001	ROSE	Rose	\N	1
CF-C3-FRS-001-ROUGE	C3	FRS-001	ROUGE	Rouge	\N	1
CF-TAUPE-FRS-001-TAUPE	TAUPE	FRS-001	TAUPE	Taupe	\N	1
CF-CVR-FRS-001-VERTFONCE	CVR	FRS-001	VERT FONCE	Vert Fonce	\N	1
CF-C5-FRS-002-BEIGE	C5	FRS-002	BEIGE	Beige	\N	1
CF-C00-FRS-002-BLANC	C00	FRS-002	BLANC	Blanc	\N	1
CF-CM-FRS-002-MARRON	CM	FRS-002	MARRON	Marron	\N	1
CF-C1-FRS-002-OR	C1	FRS-002	OR	Or	\N	1
CF-C5-FRS-003-BEIGE	C5	FRS-003	BEIGE	Beige	\N	1
CF-CG-FRS-003-GRIS	CG	FRS-003	GRIS	Gris	\N	1
CF-CM-FRS-003-MARRON	CM	FRS-003	MARRON	Marron	\N	1
CF-C1-FRS-003-OR	C1	FRS-003	OR	Or	\N	1
CF-C3-FRS-003-ROUGE	C3	FRS-003	ROUGE	Rouge	\N	1
CF-CV-FRS-003-VERT	CV	FRS-003	VERT	Vert	\N	1
CF-C5-FRS-004-BEIGE	C5	FRS-004	BEIGE	Beige	\N	1
CF-C5N-FRS-004-BEIGEFONCE	C5N	FRS-004	BEIGE FONCE	Beige Fonce	\N	1
CF-C4-FRS-004-BLEU	C4	FRS-004	BLEU	Bleu	\N	1
CF-CG-FRS-004-GRIS	CG	FRS-004	GRIS	Gris	\N	1
CF-C5-FRS-004-LBEIGE	C5	FRS-004	L.BEIGE	L.Beige	\N	1
CF-CV-FRS-004-VERT	CV	FRS-004	VERT	Vert	\N	1
CF-C4-FRS-005-BLEU	C4	FRS-005	BLEU	Bleu	\N	1
CF-CG-FRS-005-GRISCLAIRE	CG	FRS-005	GRIS CLAIRE	Gris Claire	\N	1
CF-CMS-FRS-005-MARRONCMS	C6	FRS-005	MARRON (CMS)	Marron (CMS)	\N	1
CF-C2-FRS-005-NOIR	C2	FRS-005	NOIR	Noir	\N	1
CF-C1-FRS-005-OR	C1	FRS-005	OR	Or	\N	1
CF-C3-FRS-005-ROUGE	C3	FRS-005	ROUGE	Rouge	\N	1
CF-CVR-FRS-005-VERTFONCE	CVR	FRS-005	VERT FONCE	Vert Fonce	\N	1
CF-C5-FRS-006-BEIGE	C5	FRS-006	BEIGE	Beige	\N	1
CF-C1-FRS-006-OR	C1	FRS-006	OR	Or	\N	1
CF-C3-FRS-006-ROUGE	C3	FRS-006	ROUGE	Rouge	\N	1
CF-C5-FRS-007-BEIGE	C5	FRS-007	BEIGE	Beige	\N	1
CF-CG-FRS-007-GRIS	CG	FRS-007	GRIS	Gris	\N	1
CF-C1-FRS-007-OR	C1	FRS-007	OR	Or	\N	1
CF-C5-FRS-008-BEIGE	C5	FRS-008	BEIGE	Beige	\N	1
CF-CM-FRS-008-MARRON	CM	FRS-008	MARRON	Marron	\N	1
CF-C00-FRS-009-BLANC	C00	FRS-009	BLANC	Blanc	\N	1
CF-C5-FRS-010-BEIGE	C5	FRS-010	BEIGE	Beige	\N	1
CF-C00-FRS-011-BLANC	C00	FRS-011	BLANC	Blanc	\N	1
CF-C00-FRS-012-BLANC	C00	FRS-012	BLANC	Blanc	\N	1
\.


ALTER TABLE public.couleur_fournisseur ENABLE TRIGGER ALL;

--
-- Data for Name: cours_bam; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.cours_bam DISABLE TRIGGER ALL;

COPY public.cours_bam (code_devise, date_cours, cours_mad, date_lecture) FROM stdin;
EUR	2026-09-16	10.9068	2026-09-18T14:27:29.978Z
USD	2026-09-16	9.4514	2026-09-18T14:27:29.978Z
EUR	2026-09-29	10.9671	2026-10-01T15:57:55.293Z
USD	2026-09-29	9.6684	2026-10-01T15:57:55.293Z
EUR	2026-09-18	10.9166	2026-09-20T15:41:04.235Z
EUR	2026-09-17	10.8982	2026-09-20T15:41:04.235Z
USD	2026-09-18	9.5119	2026-09-20T15:41:04.235Z
USD	2026-09-17	9.4964	2026-09-20T15:41:04.235Z
EUR	2026-09-30	10.9981	2026-10-02T09:09:21.434Z
EUR	2026-09-22	10.9417	2026-09-22T17:48:47.747Z
EUR	2026-09-21	10.9343	2026-09-22T17:48:47.747Z
USD	2026-09-22	9.5549	2026-09-22T17:48:47.747Z
USD	2026-09-21	9.5249	2026-09-22T17:48:47.747Z
EUR	2026-09-23	10.9451	2026-09-25T09:43:02.395Z
USD	2026-09-30	9.6823	2026-10-02T09:09:21.434Z
USD	2026-09-23	9.5905	2026-09-25T09:43:02.395Z
EUR	2026-09-25	10.9394	2026-09-28T15:17:56.598Z
EUR	2026-09-24	10.9347	2026-09-28T15:17:56.598Z
USD	2026-09-25	9.5965	2026-09-28T15:17:56.598Z
USD	2026-09-24	9.6129	2026-09-28T15:17:56.598Z
EUR	2026-09-28	10.9587	2026-09-30T16:23:07.893Z
USD	2026-09-28	9.6339	2026-09-30T16:23:07.893Z
EUR	2026-10-02	11.0833	2026-10-05T15:24:50.071Z
EUR	2026-10-01	11.0017	2026-10-05T15:24:50.071Z
USD	2026-10-02	9.8549	2026-10-05T15:24:50.071Z
USD	2026-10-01	9.7465	2026-10-05T15:24:50.071Z
EUR	2026-10-05	11.1799	2026-10-05T20:20:17.192Z
USD	2026-10-05	9.9779	2026-10-05T20:20:17.192Z
EUR	2026-10-07	11.1623	2026-10-08T15:30:47.781Z
EUR	2026-10-06	11.2167	2026-10-08T15:30:47.781Z
USD	2026-10-07	9.9765	2026-10-08T15:30:47.781Z
USD	2026-10-06	9.9694	2026-10-08T15:30:47.781Z
\.


ALTER TABLE public.cours_bam ENABLE TRIGGER ALL;

--
-- Data for Name: famille; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.famille DISABLE TRIGGER ALL;

COPY public.famille (code_famille, libelle, code_categorie, type_fil, titrage, description, ordre_affichage, actif) FROM stdin;
3000-DENIERS	3000-DENIERS	PES	\N	3000 Deniers	Cote chez SUJATA	240	1
PLA-100	PLA-100	PLA	\N	100	Qualite relevee dans le classeur	400	1
PLA-140	PLA-140	PLA	\N	140	Qualite relevee dans le classeur	400	1
PLA-35	PLA-35	PLA	\N	35	Qualite relevee dans le classeur	400	1
PLA-45	PLA-45	PLA	\N	45	Qualite relevee dans le classeur	400	1
PLA-50	PLA-50	PLA	\N	50	Qualite relevee dans le classeur	400	1
PLA-65	PLA-65	PLA	\N	65	Qualite relevee dans le classeur	400	1
PLA-80	PLA-80	PLA	\N	80	Qualite relevee dans le classeur	400	1
SBR-821	SBR-821	SBR	\N	821	Qualite relevee dans le classeur	400	1
1500-FDY	1500-FDY	PES	\N	1500-FDY	\N	0	1
1800-FDY	1800-FDY	PES	\N	1800-FDY	\N	0	1
MICRO-PES-3600-DENIERS	MICRO-PES-3600-DENIERS	PES	\N	3600-DENIERS	\N	0	1
MICRO-PES-7360	MICRO-PES-7360	PES	\N	7360	\N	0	1
VERONA-1500	VERONA-1500	PES	\N	VERONA-1500	\N	0	1
1100-POLY	1100-POLY	PES	\N	1100-POLY	\N	0	1
1200-DENIERS	1200-DENIERS	PES	\N	1200-DENIERS	\N	0	1
IMITATION-CUIR	IMITATION-CUIR	CUI	\N	\N	\N	0	1
12/1	12/1	JUT	\N	\N	\N	0	1
16/2	16/2	JUT	\N	\N	\N	0	1
20/2	20/2	JUT	\N	\N	\N	0	1
24/1	24/1	JUT	\N	\N	\N	0	1
30/1	30/1	JUT	\N	\N	\N	0	1
9,6/1	9,6/1	JUT	\N	\N	\N	0	1
10/1	10/1	JUT	\N	\N	\N	0	1
LAINE	LAINE	LAI	\N	\N	\N	0	1
12/2	12/2	PES-CH	\N	\N	\N	0	1
12/4	12/4	PES-CH	\N	\N	\N	0	1
1500-DENIERS	1500-DENIERS	PES-PO	\N	\N	\N	0	1
1200-DENIERS-SHRINK	1200-DENIERS-SHRINK	PES-SH	\N	\N	\N	0	1
1500-DENIERS-SHRINK	1500-DENIERS-SHRINK	PES-SH	\N	\N	\N	0	1
1500-DTEX	1500-DTEX	PP	\N	\N	\N	0	1
1750*2 DTEX	1750*2 DTEX	PP	\N	\N	\N	0	1
1900-DTEX	1900-DTEX	PP	\N	\N	\N	0	1
2900-DTEX	2900-DTEX	PP	\N	\N	\N	0	1
1000X2-DTEX	1000X2-DTEX	PP	\N	\N	\N	0	1
1775*2-DTEX	1775*2-DTEX	PP	\N	\N	\N	0	1
\.


ALTER TABLE public.famille ENABLE TRIGGER ALL;

--
-- Data for Name: groupe_equiv; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.groupe_equiv DISABLE TRIGGER ALL;

COPY public.groupe_equiv (code_groupe_equiv, libelle, description, actif) FROM stdin;
GRP-019	PP-1500 Dtex-Bleu 6666-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-020	PP-1500 Dtex-L.Beige 44377-Hs	Importe de GESTION Fil.xlsx	1
GRP-022	PP-1750*2 Dtex-Sh Creme 2981 Hs	Importe de GESTION Fil.xlsx	1
GRP-023	PP-1750*2 Dtex-Sh Beige 44414 Hs	Importe de GESTION Fil.xlsx	1
GRP-024	PP-1750*2 Dtex-Sh Brown 44415 Hs	Importe de GESTION Fil.xlsx	1
GRP-025	PES-1500 Deniers-Gold Cb-4016 Sf	Importe de GESTION Fil.xlsx	1
GRP-026	PES Sh-1500 Deniers-Cream H-1008-Tat — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-027	PES Sh-1500 Deniers- L.Beige H-2000-Tat — 3 sources	Importe de GESTION Fil.xlsx	1
GRP-028	PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-029	PES Sh -1200 Deniers-Cream B Cp-1005Turk — 3 sources	Importe de GESTION Fil.xlsx	1
GRP-030	PES Sh -1200 Deniers-Cream Cb-1426 Turk — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-031	PES -1200 Deniers-Anty Bordeau 61043-Gzm	Importe de GESTION Fil.xlsx	1
GRP-032	PES -1500 Deniers-Bordeau 61043-Gzm	Importe de GESTION Fil.xlsx	1
GRP-033	PES -1500 Deniers-D.Bleu 1271-Gzm	Importe de GESTION Fil.xlsx	1
GRP-034	PES -1500 Deniers-L.Beige 1273-Gzm	Importe de GESTION Fil.xlsx	1
GRP-035	PES -1500 Deniers-Green 1272-Gzm	Importe de GESTION Fil.xlsx	1
GRP-036	PES -1500 Deniers-Grey 1274-Gzm	Importe de GESTION Fil.xlsx	1
GRP-037	PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm	Importe de GESTION Fil.xlsx	1
GRP-038	PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm	Importe de GESTION Fil.xlsx	1
GRP-039	PES Fdy-1500 Deniers-Marron Fdy-36005-Gzm	Importe de GESTION Fil.xlsx	1
GRP-040	PES Fdy-1500 Deniers-Rose Fdy-423020-Gzm	Importe de GESTION Fil.xlsx	1
GRP-041	PES Fdy-1500 Deniers-Turkoise Fdy-513020-Gzm	Importe de GESTION Fil.xlsx	1
GRP-042	PES Fdy-1500 Deniers-Olive Fdy-93005-Gzm	Importe de GESTION Fil.xlsx	1
GRP-043	PES Ver-1500 Deniers-BleuTex-8100 Text — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-044	PP FRZ-2900 Dtex-Navy Bleu 1697-Tat	Importe de GESTION Fil.xlsx	1
GRP-045	PP FRZ-2900 Dtex-Green Mlt 18-Tat	Importe de GESTION Fil.xlsx	1
GRP-046	PES Sh-1200 Deniers-Antrasit 802-Tat	Importe de GESTION Fil.xlsx	1
GRP-047	PES Sh-1200 Deniers-Cpbt Grey 801-Tat	Importe de GESTION Fil.xlsx	1
GRP-048	PES Sh-1500 Deniers-Beige H-2001-Tat	Importe de GESTION Fil.xlsx	1
GRP-049	Micro PES-3600 Deniers Shade 25 -Tat	Importe de GESTION Fil.xlsx	1
GRP-050	Micro PES-3600 Deniers Ivory 15-Tat	Importe de GESTION Fil.xlsx	1
GRP-051	PP-1775*2 Dtex-White 1073-Tat	Importe de GESTION Fil.xlsx	1
GRP-052	PP-1775*2 Dtex-Cream 1072-Tat	Importe de GESTION Fil.xlsx	1
GRP-011	PP FRZ-2900 Dtex-Pink 7639-Hs	Importe de GESTION Fil.xlsx	1
GRP-012	PP FRZ-2900 Dtex-D.Bleu 6417-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-013	PP-1900 Dtex- Cream 2951-Hs	Importe de GESTION Fil.xlsx	1
GRP-014	PP-1900 Dtex-L.Beige 44377-Hs	Importe de GESTION Fil.xlsx	1
GRP-015	PP-1900 Dtex-D.Green 5455-Hs	Importe de GESTION Fil.xlsx	1
GRP-016	PP-1500 Dtex-Yellow 3430-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-017	PP-1500 Dtex-D.Bleu 6665-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-018	PP-1500 Dtex-Cream 2951-Hs	Importe de GESTION Fil.xlsx	1
GRP-021	PP-1500 Dtex-Pink 7623-Hs	Importe de GESTION Fil.xlsx	1
GRP-054	PP-1000*2 Dtex-Cream Mn-1201-Tat	Importe de GESTION Fil.xlsx	1
GRP-055	PP-1000*2 Dtex-Beige Mn-3203 L-Tat	Importe de GESTION Fil.xlsx	1
GRP-059	PES-3000 Deniers- Seker Cream Ssl2081-Suj	Importe de GESTION Fil.xlsx	1
GRP-060	PES-3000 Deniers- Dark Grey Ssl2069-Suj	Importe de GESTION Fil.xlsx	1
GRP-061	PES-3000 Deniers- Vison Ssl2247-Suj	Importe de GESTION Fil.xlsx	1
GRP-062	PES-3000 Deniers- WhiteSsl2331-Suj	Importe de GESTION Fil.xlsx	1
GRP-063	PES-3000 Deniers- Rouge Ssl2232-Suj	Importe de GESTION Fil.xlsx	1
GRP-064	PES-3000 Deniers- Dk.Beige Ssl2271-Suj	Importe de GESTION Fil.xlsx	1
GRP-065	PES-3000 Deniers- Khave Ssl2279-Suj	Importe de GESTION Fil.xlsx	1
GRP-066	PES-3000 Deniers- Pink Ssl2259-Suj	Importe de GESTION Fil.xlsx	1
GRP-067	PES-3000 Deniers- Dk.Vison Ssl2176-Suj	Importe de GESTION Fil.xlsx	1
GRP-068	PES-3000 Deniers- Bleu Ssl2244-Suj	Importe de GESTION Fil.xlsx	1
GRP-069	Micro PES-7360 Deniers-Multi Beige 1305-129-Suj	Importe de GESTION Fil.xlsx	1
GRP-070	Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj	Importe de GESTION Fil.xlsx	1
GRP-071	Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj	Importe de GESTION Fil.xlsx	1
GRP-073	PES Sh -1200 Deniers-Grey Cb-7A Turk	Importe de GESTION Fil.xlsx	1
GRP-076	PES Sh -1200 Deniers-Cream Cb-1056 Turk	Importe de GESTION Fil.xlsx	1
GRP-077	PES Fdy -1800 Deniers-Gold Cf-101 Turk	Importe de GESTION Fil.xlsx	1
GRP-078	PES Fdy -1800 Deniers-Taupe Cf-4001 Turk	Importe de GESTION Fil.xlsx	1
GRP-079	PES Fdy -1800 Deniers-White Cf-1001 Turk	Importe de GESTION Fil.xlsx	1
GRP-082	PES Sh-1500 Deniers-VizonTex-7530 Text	Importe de GESTION Fil.xlsx	1
GRP-083	PES Ver-1500 Deniers-TerraTex-8000 Text	Importe de GESTION Fil.xlsx	1
GRP-085	Jute 30/1	Importe de GESTION Fil.xlsx	1
GRP-086	Jute 24/1	Importe de GESTION Fil.xlsx	1
GRP-087	Jute 12/1 — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-089	Jute 16/2	Importe de GESTION Fil.xlsx	1
GRP-090	Jute 20/2	Importe de GESTION Fil.xlsx	1
GRP-091	PES-20/2 LOMAT — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-092	PES-20/4 LOMAT — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-095	PES Nylon — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-097	Bande	Importe de GESTION Fil.xlsx	1
GRP-098	Cuir	Importe de GESTION Fil.xlsx	1
GRP-099	SBR 821	Importe de GESTION Fil.xlsx	1
GRP-100	Hotmelt	Importe de GESTION Fil.xlsx	1
GRP-102	Plastique 35 — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-103	Plastique 45 — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-104	Plastique 50 — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-105	Plastique 65 — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-106	Plastique 80 — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-107	Plastique 100 — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-108	Plastique 140 — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-001	PP FRZ-2900 Dtex-Gold 3423-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-002	PP FRZ-2900 Dtex-Black 8001-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-003	PP FRZ-2900 Dtex- Red 7612-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-004	PP FRZ-2900 Dtex- Grey 8933-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-005	PP FRZ-2900 Dtex-Beige 44360-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-006	PP FRZ-2900 Dtex-Brown 44361-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-007	PP FRZ-2900 Dtex-Cream 44412-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-008	PP FRZ-2900 Dtex-D.Green 5463-Hs — 2 sources	Importe de GESTION Fil.xlsx	1
GRP-009	PP FRZ-2900 Dtex-Grey 10575-Hs	Importe de GESTION Fil.xlsx	1
GRP-010	PP FRZ-2900 Dtex-Camel 44416-Hs	Importe de GESTION Fil.xlsx	1
GRP-110	Jute fin 10/1 — 2 sources	Le 9,6/1 remplace le 10/1 en trame, valide par l'atelier le 22/09	1
\.


ALTER TABLE public.groupe_equiv ENABLE TRIGGER ALL;

--
-- Data for Name: qualite; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.qualite DISABLE TRIGGER ALL;

COPY public.qualite (code_qualite, nom, description, poids_commercial_m2, statut, marge_securite_pct, couv_min_mois, taux_perte_pct, seuil_alerte_jours, seuil_critique_jours, stock_securite_jours, date_creation, date_modification, date_cloture, id_utilisateur_creation, id_utilisateur_modification, id_utilisateur_cloture) FROM stdin;
8F	8F MOSQUEE	\N	2.3880	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.326Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
8M	8M	\N	2.2650	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.341Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
8S	8S	\N	2.4450	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.354Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
BR	BRUXELLES	\N	3.1620	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.366Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
FB	FRIZE BAS	\N	1.9280	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.379Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
IS	IS MOSQUEE	\N	2.6680	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.388Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
LH	LOW POLYESTER	\N	1.7530	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.400Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
LP	LP	\N	2.3570	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.409Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
MF	FRIZE MOYEN	\N	2.5260	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.418Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
MN	MONO	\N	2.7040	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.429Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
MP	MP	\N	2.1940	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.440Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
PS	PS SHAGGY	\N	2.5230	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.449Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
SH	SHEHRAZADE	\N	2.7640	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.463Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
SL	SL SHAGGY	\N	4.7790	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.488Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
TN	TINGIS	\N	2.5320	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.497Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
YF	BAHAR	\N	2.4310	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.516Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
YH	TOPAZ	\N	3.5120	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.524Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
YL	SHAGGY	\N	3.5020	ACTIF	20.0000	2.0000	2.0000	90	60	30	2026-09-04T19:04:35.024Z	2026-09-04T19:10:34.531Z	\N	\N	fb4103c0-c16e-4214-a90b-451f7cd64211	\N
\.


ALTER TABLE public.qualite ENABLE TRIGGER ALL;

--
-- Data for Name: ligne_qualite; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.ligne_qualite DISABLE TRIGGER ALL;

COPY public.ligne_qualite (id_ligne_qualite, code_qualite, code_role, densite, unite_densite, entre_poids_commercial, observation, ordre_affichage, actif) FROM stdin;
87ae287d-7548-475c-8397-ca63614acc99	SH	POIL	1.7600	kg_m2	1	\N	10	1
d383fccf-6e45-48b9-9e8a-faa18635726a	SH	TRAME	0.5200	kg_m2	1	\N	20	1
599d2853-a5a0-4e89-a7c7-6b9a5e98c620	SH	CHAINE	0.2350	kg_m2	1	\N	30	1
8f3beafb-119b-4b6c-bbc5-8bded8777730	SH	COLLE	0.2000	kg_m2	1	\N	40	1
7864dcb6-ff28-4606-a6ed-d2c4797ff29f	SH	CUIR	1.0000	ml_m2	0	\N	60	1
28e372f6-605f-4506-a233-da2f6de27db1	SH	PLAST	0.0300	kg_m2	1	\N	50	1
f8fcf846-5bfa-4dd2-aa7c-d4c40b364026	SH	RUBAN	1.0000	ml_m2	0	\N	70	1
ff740a37-9f6d-4ffe-af31-2c5884873405	SH	FRANGE	0.8000	ml_m2	0	\N	80	1
3263b0fc-f84c-40bc-bee8-5b02d20d4680	LP	POIL	1.2100	kg_m2	1	\N	30	1
30966aa2-4168-4316-ae96-e68d95efadc1	LP	TRAME	0.6630	kg_m2	1	\N	40	1
3a707746-c550-47ff-9112-17fcc3d4a54e	LP	CHAINE	0.2350	kg_m2	1	\N	50	1
fe8bf1b8-6dcc-4c31-9fd2-0de18871490f	LP	COLLE	0.2000	kg_m2	1	\N	60	1
dd09e644-3c6a-44a2-8d10-560def2d796c	LP	CUIR	1.0000	ml_m2	0	\N	70	1
af1572aa-18c1-41c8-b290-240a599d87a8	LP	FRANGE	0.8000	ml_m2	0	\N	80	1
bb044bc0-b0f8-444d-a73a-05ff28b82477	LP	PLAST	0.0300	kg_m2	1	\N	90	1
87a5f819-bbee-4dad-a9fc-286ced3137d0	LP	RUBAN	1.0000	ml_m2	0	\N	100	1
abc8df6c-52e2-44f6-a2e1-2a987b6867e4	MP	POIL	1.0850	kg_m2	1	\N	30	1
39140c6d-4821-4068-95de-fb8620b717bc	MP	TRAME	0.5750	kg_m2	1	\N	40	1
e57cff1b-4864-46f4-80ba-71b462995dd8	MP	CHAINE	0.2350	kg_m2	1	\N	50	1
7a7b9740-516b-4468-ad13-439c1bce27fc	MP	COLLE	0.2500	kg_m2	1	\N	60	1
502067aa-cfe3-46c9-bedf-297d51585138	MP	CUIR	1.0000	ml_m2	0	\N	70	1
b71a5393-6916-456f-a34a-d3ad05c43a9e	MP	FRANGE	0.8000	ml_m2	0	\N	80	1
e1fb7122-0878-4a78-b878-26cff13b4da4	MP	PLAST	0.0300	kg_m2	1	\N	90	1
ed2e31b7-912e-482e-80ff-604bd5c44c4f	MP	RUBAN	1.0000	ml_m2	0	\N	100	1
188cd3c2-c7cf-4934-9902-5f0c04244888	MF	POIL	1.1500	kg_m2	1	\N	30	1
22ee00b2-8810-43b6-a7a9-25909557d78e	MF	TRAME	0.8700	kg_m2	1	\N	40	1
be969f70-8286-436b-b8ad-b00d2dabc344	MF	CHAINE	0.1760	kg_m2	1	\N	50	1
0dccb752-868a-4c16-9b3a-c02f1949f98e	MF	COLLE	0.3000	kg_m2	1	\N	60	1
5679c618-2b79-4f6c-a58c-e835e37bf3f9	MF	PLAST	0.0300	kg_m2	1	\N	90	1
6e49573d-46a3-4d39-a0e2-17640e2a4464	FB	POIL	0.8200	kg_m2	1	\N	30	1
0857fedd-aefd-44fb-a38a-df950a2b26cd	FB	TRAME	0.5250	kg_m2	1	\N	40	1
e1cb4e3b-9f48-4b25-95a5-25ed420e0034	FB	CHAINE	0.1760	kg_m2	1	\N	50	1
9d7bee83-ef3c-4a87-bbd4-576a3a28991f	FB	COLLE	0.4000	kg_m2	1	\N	60	1
8aa3a90f-372a-401b-90a3-64f473b0567a	FB	PLAST	0.0070	kg_m2	1	\N	90	1
b82f47a7-bc52-4218-84aa-4cbb99e84762	8S	POIL	1.0500	kg_m2	1	\N	30	1
d49161ec-e965-4738-b3e7-7201c1a7c405	8S	TRAME	0.9700	kg_m2	1	\N	40	1
b24e9381-f157-453b-af46-042449668c75	8S	CHAINE	0.1760	kg_m2	1	\N	50	1
7d0d1acc-b759-44f7-99fa-28baaf83a5a0	8S	COLLE	0.2000	kg_m2	1	\N	60	1
c2b1d810-784b-4003-85a3-cee742cfd3c8	8S	CUIR	1.0000	ml_m2	0	\N	70	1
ca040101-45cb-4d0a-a05d-c46a8c2e3252	8S	FRANGE	0.8000	ml_m2	0	\N	80	1
3ba2a4d3-d255-4534-afb5-2f5e02f64589	8S	PLAST	0.0300	kg_m2	1	\N	90	1
90fb2a9f-6dc1-4955-8b8d-cecff9d520f7	8S	RUBAN	1.0000	ml_m2	0	\N	100	1
d0ef7ab1-d778-4807-9d9a-2ccbc1d1b482	8M	POIL	0.9500	kg_m2	1	\N	30	1
8e2b3a2a-ad6e-477a-8f6f-750bd6389f29	8M	TRAME	0.8400	kg_m2	1	\N	40	1
b5c5c500-a242-4dde-a1c9-43d93406e7f0	8M	CHAINE	0.1760	kg_m2	1	\N	50	1
012c6b3b-abdc-4209-9bfe-92c9b4cb539e	8M	COLLE	0.2500	kg_m2	1	\N	60	1
b026dd87-d747-42c5-97f5-9938f69b3477	8M	CUIR	1.0000	ml_m2	0	\N	70	1
74f38983-683b-4ee7-85a8-43dcb5164cc0	8M	FRANGE	0.8000	ml_m2	0	\N	80	1
30d2c486-8158-4095-9248-b5b5d8498cd3	8M	PLAST	0.0300	kg_m2	1	\N	90	1
e2e4b4b2-45a8-4002-abcb-9860bb22ebfa	8M	RUBAN	1.0000	ml_m2	0	\N	100	1
3ea8e601-9397-4a8a-be03-8b450e744986	TN	POIL	1.0150	kg_m2	1	\N	30	1
152bc250-d936-47c8-bbd3-85899511e8fd	TN	TRAME	0.9150	kg_m2	1	\N	40	1
2ac7b606-96d6-4e71-b284-c54257366554	TN	CHAINE	0.1760	kg_m2	1	\N	50	1
d0c65880-f7f4-4078-8b1a-61751f1749fb	TN	COLLE	0.4000	kg_m2	1	\N	60	1
a81b9d02-2549-4858-8b34-b4f0f5d48bbd	TN	CUIR	1.0000	ml_m2	0	\N	70	1
c88af091-259e-4d82-b24a-65ea742804b2	TN	PLAST	0.0070	kg_m2	1	\N	90	1
f2bcca76-ac0b-48f2-811a-a79c8573489a	TN	RUBAN	1.0000	ml_m2	0	\N	100	1
12d42f4c-b717-4b47-a236-f7619071cffd	LH	POIL	0.5500	kg_m2	1	\N	30	1
7030c727-6512-41fa-9ebd-2125ba69c614	LH	TRAME	0.6200	kg_m2	1	\N	40	1
401bb605-7ba0-44f5-97e7-136c61b43a00	LH	CHAINE	0.1760	kg_m2	1	\N	50	1
a61564e7-2ad4-47d9-b82d-f81aa96e76a8	LH	COLLE	0.4000	kg_m2	1	\N	60	1
3efff2b3-7c1a-4877-baf0-5c93755e74db	LH	PLAST	0.0070	kg_m2	1	\N	90	1
31853ec0-9a2f-4851-aa1b-17aea8f97e4e	BR	POIL	1.8300	kg_m2	1	\N	30	1
084f248a-365f-4104-8f68-a2833045e608	BR	TRAME	0.7300	kg_m2	1	\N	40	1
f23e23c4-0c3a-4713-8048-c8c23aa3cd09	BR	CHAINE	0.1760	kg_m2	1	\N	50	1
881cbd59-a10e-44fd-a0f8-c25f759d51a5	BR	COLLE	0.4000	kg_m2	1	\N	60	1
d0864fee-97aa-4942-ae14-0b046e9d430e	BR	CUIR	1.0000	ml_m2	0	\N	70	1
4d70a489-f207-4dda-b3c4-b5c135bf6637	BR	PLAST	0.0070	kg_m2	1	\N	90	1
17ee86bd-08c7-46a6-920b-6d0f3c93149c	BR	RUBAN	1.0000	ml_m2	0	\N	100	1
d0eea92f-a2b4-4947-aff5-0f0d3b14a3e9	YH	POIL	2.1800	kg_m2	1	\N	30	1
41cd8acd-9930-449e-81ec-4052a508868d	YH	TRAME	0.7300	kg_m2	1	\N	40	1
0252f671-e1c2-45f1-9bac-b101913a8e24	YH	CHAINE	0.1760	kg_m2	1	\N	50	1
c74a0c7d-0425-44e9-bdec-61cb79d166ae	YH	COLLE	0.4000	kg_m2	1	\N	60	1
107ee24b-db07-44ba-8bc1-968a3da0fc30	YH	CUIR	1.0000	ml_m2	0	\N	70	1
09242619-35e4-46c2-b099-757f1e1ea849	YH	PLAST	0.0070	kg_m2	1	\N	90	1
d891ba9c-a989-4b02-be79-36c62904ae10	YH	RUBAN	1.0000	ml_m2	0	\N	100	1
bfb095cf-0e15-4f8d-a6b0-577e2fd2f5cc	YL	POIL	2.2000	kg_m2	1	\N	30	1
70faee0b-02be-48a4-88ff-d4562ee3d07c	YL	TRAME	0.7000	kg_m2	1	\N	40	1
3d61ce6c-32d8-4179-87a8-ebe12191582c	YL	CHAINE	0.1760	kg_m2	1	\N	50	1
001cd0d4-6aea-4e5d-9b47-342f12e6bf9b	YL	COLLE	0.4000	kg_m2	1	\N	60	1
e04dcc94-d1f6-4924-a195-38295cd18e48	YL	CUIR	1.0000	ml_m2	0	\N	70	1
45ff6faf-6622-40c7-8ead-2e4c894fe2e3	YL	PLAST	0.0070	kg_m2	1	\N	90	1
a31a8cd9-b8bc-403e-9ac0-1d4547b8eb03	YL	RUBAN	1.0000	ml_m2	0	\N	100	1
7b7da06e-b499-4f9d-b4d9-873b817a33be	PS	POIL	1.3000	kg_m2	1	\N	30	1
6d4fc674-cfdb-4889-9179-cb79592030c8	PS	TRAME	0.6400	kg_m2	1	\N	40	1
b395eed1-894d-4454-a696-56469a152317	PS	CHAINE	0.1760	kg_m2	1	\N	50	1
66b415a2-ef3b-4961-b3f8-27f541957815	PS	COLLE	0.4000	kg_m2	1	\N	60	1
c8084e57-5f2f-4727-b05e-4468899f85ac	PS	PLAST	0.0070	kg_m2	1	\N	90	1
d3b5ec09-dc12-4acc-bf71-72b2f4058bca	8F	POIL	1.5300	kg_m2	1	\N	30	1
f7b9e475-2f33-4676-8d3d-6d51d7295e66	8F	TRAME	0.4250	kg_m2	1	\N	40	1
b46bf0bc-be9a-4c28-9cbf-4c6d4aa7eb6c	8F	CHAINE	0.1760	kg_m2	1	\N	50	1
feec84ea-a0cc-4424-839f-72bc5358d271	8F	COLLE	0.2500	kg_m2	1	\N	60	1
cb1ef224-9ccf-4492-a26c-fdeccf225e82	8F	PLAST	0.0070	kg_m2	1	\N	90	1
fc19a80f-0f05-4663-913c-1602b76e0e11	IS	POIL	1.7100	kg_m2	1	\N	30	1
0a538d02-49d2-496d-9a6c-21db800a5d89	IS	TRAME	0.5750	kg_m2	1	\N	40	1
346fdeee-e368-4421-96d9-f5720ac7a820	IS	CHAINE	0.1760	kg_m2	1	\N	50	1
f158e83f-e6fa-4e08-b38d-9f5e0eb8fa45	IS	COLLE	0.2000	kg_m2	1	\N	60	1
38a99688-496b-4ca7-b4c0-e3e017a0fe08	IS	PLAST	0.0070	kg_m2	1	\N	90	1
b9e7228f-d0fc-4f87-8785-2423849d6a9b	YF	POIL	1.1200	kg_m2	1	\N	30	1
75204dca-0e6d-4560-bdef-f9b680f7196e	YF	TRAME	0.8050	kg_m2	1	\N	40	1
02a930bd-b812-495d-b4f0-5cf1fd16670c	YF	CHAINE	0.1760	kg_m2	1	\N	50	1
619d3cbb-ad67-448a-a740-387316bcc8fa	YF	COLLE	0.3000	kg_m2	1	\N	60	1
4302f312-e587-4b8d-80a9-d4962facadc0	YF	PLAST	0.0300	kg_m2	1	\N	90	1
fca4cd40-d0cd-4a3b-89ce-053c7de35918	SL	POIL	2.0850	kg_m2	1	\N	30	1
a5a76353-afed-40db-8b49-5d0d7ef74497	SL	TRAME	0.5850	kg_m2	1	\N	40	1
ceb0951f-3e39-4d8c-a6ec-2c99cfb63262	SL	CHAINE	1.7600	kg_m2	1	\N	50	1
ae4a7834-6403-43c4-8220-4e8a8a68cd8a	SL	COLLE	0.3000	kg_m2	1	\N	60	1
eeb56fda-d8f9-448b-ada2-89e586f4bebe	SL	CUIR	1.0000	ml_m2	0	\N	70	1
ec956669-e1bc-480a-afce-e4ce8cf9c149	SL	PLAST	0.0300	kg_m2	1	\N	90	1
d77b4377-45dc-4624-948b-de030a723e3b	SL	RUBAN	1.0000	ml_m2	0	\N	100	1
0d3bc702-c6e8-4e1f-b793-431de5f35c81	MN	POIL	1.6250	kg_m2	1	\N	30	1
aed20052-553d-4ad2-863a-9921a149e66d	MN	TRAME	0.5950	kg_m2	1	\N	40	1
ca826db7-0c2b-4df5-9f1c-fb78af3b0704	MN	CHAINE	0.2350	kg_m2	1	\N	50	1
ec6e8d55-4039-491e-b9be-b655c1bed4df	MN	COLLE	0.2000	kg_m2	1	\N	60	1
dfaf4063-4270-49d4-8e52-1ba2cd559ddb	MN	CUIR	1.0000	ml_m2	0	\N	70	1
4726445c-7acd-455e-b2a9-bebcee8d0b31	MN	FRANGE	0.8000	ml_m2	0	\N	80	1
45ba0b4c-3f9b-433e-95cb-bd513de5a2eb	MN	PLAST	0.0300	kg_m2	1	\N	90	1
3cefde76-9222-46eb-9df5-4f34b31cf158	MN	RUBAN	1.0000	ml_m2	0	\N	100	1
\.


ALTER TABLE public.ligne_qualite ENABLE TRIGGER ALL;

--
-- Data for Name: reference; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.reference DISABLE TRIGGER ALL;

COPY public.reference (code_reference, code_categorie, code_fournisseur, designation, type_fil, couleur, titrage, unite_catalogue, poids_bobine_kg, bobines_par_palette, densite_kg_ml, prix_catalogue, code_devise_catalogue, date_prix_catalogue, stock_min_kg, couverture_cible_mois, moq_kg, multiple_achat_kg, classe_abc, classe_xyz, date_dernier_abc, cmup_mad, date_dernier_cmup, suivi_lot, actif, date_creation, id_utilisateur_creation, code_couleur, code_famille, code_couleur_interne, reference_fournisseur, supplement_teinture, origine, bobines_par_lot, description_commerciale, code_conditionnement, seuil_lot_valeur, type_lot, fusion_lot, arrondi_palette) FROM stdin;
PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm	PES	FRS-003	PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm	Polyester	Beige	1500	kg	2.5000	448	\N	1.9700	USD	\N	3360.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	18.2627	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-FDY	C5	Fdy-811100	\N	\N	\N	1500 Denier polyester floss yarn Taupe	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy -1800 Deniers-Taupe Cf-4001 Turk	PES	FRS-007	PES Fdy -1800 Deniers-Taupe Cf-4001 Turk	Polyester	Beige	1800	kg	2.5000	448	\N	3.0500	USD	\N	2822.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	28.2747	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1800-FDY	C5	Cf-4001	\N	\N	\N	100% POLYESTER FDY FLOSH	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-D.Green 5463-Hs	PP	FRS-001	PP FRZ-2900 Dtex-D.Green 5463-Hs	Polypropylène	Vert Fonce	2900	kg	3.1500	240	\N	2.2000	USD	\N	4300.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	20.3949	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CVR	5463	\N	\N	\N	\N	BOBINE	1344.00	INDIFFERENT	1	0
PP-1500 Dtex-Bleu 7201-Oz	PP	FRS-005	PP-1500 Dtex-Bleu 7201-Oz	Polypropylène	Bleu	1500	kg	2.6000	288	\N	2.3300	USD	\N	4400.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	21.6000	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	C4	7201	\N	\N	\N	\N	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-A/Green 8068-Oz	PP	FRS-005	PP FRZ-2900 Dtex-A/Green 8068-Oz	Polypropylène	Vert Fonce	2900	kg	3.1000	240	\N	2.1200	USD	\N	4166.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	19.6532	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CVR	8068	\N	\N	\N	\N	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex- Red 5001-Oz	PP	FRS-005	PP FRZ-2900 Dtex- Red 5001-Oz	Polypropylène	Rouge	2900	kg	3.1000	240	\N	2.3500	USD	\N	12500.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	21.7854	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C3	5001	\N	\N	\N	\N	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Beige 44360-Hs	PP	FRS-001	PP FRZ-2900 Dtex-Beige 44360-Hs	Polypropylène	Beige (C5S)	2900	kg	3.1500	240	\N	2.6700	USD	\N	12900.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	24.7520	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	\N	44360	\N	\N	\N	\N	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1200 Deniers-Beige Cp-1432 Sf	PES-SH	FRS-002	PES Sh-1200 Deniers-Beige Cp-1432 Sf	Polyester Fil Shrink	Beige	1200	kg	2.2000	336	\N	2.2400	USD	\N	3000.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	20.7657	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	C5	Cp-1432	\N	\N	\N	100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers-Beige Cp-2039 Sf	PES-SH	FRS-002	PES Sh-1500 Deniers-Beige Cp-2039 Sf	Polyester Fil Shrink	Beige	1500	kg	2.2000	336	\N	2.7700	USD	\N	2950.0000	1.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	25.6790	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	C5	Cp-2039	\N	\N	\N	100% POLYESTER DTY 1500*1 Denier (300*5);144 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers-Beige Tex-7500 Text	PES-SH	FRS-008	PES Sh-1500 Deniers-Beige Tex-7500 Text	Polyester Fil Shrink	Beige	1500	kg	2.2000	392	\N	2.9000	USD	\N	2956.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	26.8842	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	C5	Tex-7500	\N	\N	\N	PES DRAW TEXTURING YARN KRİNKIL 1500 DNY	BOBINE	1344.00	INDIFFERENT	1	0
PP-1750*2 Dtex-Sh Beige 44414 Hs	PP	FRS-001	PP-1750*2 Dtex-Sh Beige 44414 Hs	Polypropylène	Beige	1750*2	kg	3.1000	240	\N	2.1800	USD	\N	8332.0000	2.0000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	20.2095	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1750*2 DTEX	C5	44414	\N	\N	\N	100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Beige 2204-Oz	PP	FRS-005	PP FRZ-2900 Dtex-Beige 2204-Oz	Polypropylène	Beige (C5S)	2900	kg	3.1000	240	\N	1.9400	USD	\N	12500.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	17.9846	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C5S	2204	\N	\N	\N	100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers-Beige H-2001-Tat	PES-SH	FRS-004	PES Sh-1500 Deniers-Beige H-2001-Tat	Polyester Fil Shrink	Beige Fonce	1500	kg	2.1000	448	\N	4.0200	USD	\N	3544.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	37.2670	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	C5N	H-2001	\N	\N	\N	1500 DENIER SHRINK POLYESTER	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy -1800 Deniers-White Cf-1001 Turk	PES	FRS-007	PES Fdy -1800 Deniers-White Cf-1001 Turk	Polyester	Blanc	1800	kg	2.5000	448	\N	3.0500	USD	\N	2822.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	28.2747	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1800-FDY	C00	Cf-1001	\N	\N	\N	100% POLYESTER FDY FLOSH	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- WhiteSsl2331-Suj	PES	FRS-006	PES-3000 Deniers- WhiteSsl2331-Suj	Polyester	Blanc	3000	kg	2.5000	392	\N	2.9500	USD	\N	6720.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	C00	Ssl2331	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh -1200 Deniers-Cream B Cp-1005Turk	PES-SH	FRS-007	PES Sh -1200 Deniers-Cream B Cp-1005Turk	Polyester Fil Shrink	Cream B	1200	kg	2.1000	336	\N	1.9000	USD	\N	16934.0000	2.5000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	17.6138	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	\N	Cp-1005	\N	\N	\N	\N	BOBINE	1344.00	INDIFFERENT	1	0
PP 1750*2 dtex SH Beige 2204 oz	PP	FRS-005	PP-tt	Polyester Fil Poil	Beige	1750*2	kg	2.1000	331	\N	2.2000	USD	\N	12000.0000	2.0000	12000.0000	2.0000	\N	\N	\N	20.3949	2026-10-03T17:33:49.387Z	1	1	2026-09-30T16:14:38.034Z	\N	\N	1750*2 DTEX	C5	Oz 2204	\N	\N	\N	Oz 2204	BOBINE	1344.00	INDIFFERENT	1	0
PP-1775*2 Dtex-White 1073-Tat	PP	FRS-004	PP-1775*2 Dtex-White 1073-Tat	Polypropylène	Blanc	1775*2	kg	2.0000	336	\N	2.2750	USD	\N	7800.0000	2.5000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	21.0902	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1775*2-DTEX	C00	1073	\N	\N	\N	REPALL/FINAL 1775DX2 FRZ- 300 FLAMENTS 165/S TPM	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy-1500 Deniers-Bleu  Fdy-542030-Gzm	PES	FRS-003	PES Fdy-1500 Deniers-Bleu  Fdy-542030-Gzm	Polyester	Bleu	1500	kg	2.5000	448	\N	2.4700	USD	\N	3360.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	22.8979	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-FDY	C4	Fdy-542030	\N	\N	\N	1500 Denier polyester floss yarn Gold	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Bleu Ssl2244-Suj	PES	FRS-006	PES-3000 Deniers- Bleu Ssl2244-Suj	Polyester	Bleu	3000	kg	2.5000	392	\N	2.9500	USD	\N	3360.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	C4	Ssl2244	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PES Ver-1500 Deniers-BleuTex-8100 Text	PES	FRS-008	PES Ver-1500 Deniers-BleuTex-8100 Text	Polyester	Bleu	1500	kg	1.8000	432	\N	3.1500	USD	\N	2419.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	29.2018	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	VERONA-1500	C4	Tex-8100	\N	\N	\N	POLYESTER YARN VERRONA 1500 DENIERS	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Navy Bleu 1697-Tat	PP	FRS-004	PP FRZ-2900 Dtex-Navy Bleu 1697-Tat	Polypropylène	Bleu	2900	kg	2.0000	336	\N	2.1570	USD	\N	2688.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	19.9963	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C4	1697	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRIEZE,	BOBINE	1344.00	INDIFFERENT	1	0
PES -1500 Deniers-D.Bleu 1271-Gzm	PES-PO	FRS-003	PES -1500 Deniers-D.Bleu 1271-Gzm	Polyester Fil Poil	Bleu Marine	1500	kg	2.5000	448	\N	2.3500	USD	\N	3360.0000	2.5000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	21.7854	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS	C2	1271	\N	\N	\N	100% POLYESTER DTY 1500*1 DENIER (300*5); 144 Flaments	BOBINE	1344.00	INDIFFERENT	1	0
PP-1500 Dtex-D.Bleu 6665-Hs	PP	FRS-001	PP-1500 Dtex-D.Bleu 6665-Hs	Polypropylène	Bleu Marine	1500	kg	2.6000	288	\N	2.6800	USD	\N	4400.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	24.8447	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	C2	6665	\N	\N	\N	100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-D.Bleu 6417-Hs	PP	FRS-001	PP FRZ-2900 Dtex-D.Bleu 6417-Hs	Polypropylène	Bleu Marine	2900	kg	3.1500	240	\N	2.0700	USD	\N	4300.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	19.1897	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C2	6417	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES Ver-1500 Deniers-TerraTex-8000 Text	PES	FRS-008	PES Ver-1500 Deniers-TerraTex-8000 Text	Polyester	Brique	1500	kg	1.8000	432	\N	3.1500	USD	\N	2419.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	29.2018	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	VERONA-1500	CB	Tex-8000	\N	\N	\N	POLYESTER YARN VERRONA 1500 DENIERS	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Seker Cream Ssl2081-Suj	PES	FRS-006	PES-3000 Deniers- Seker Cream Ssl2081-Suj	Polyester	Cream	3000	kg	2.5000	392	\N	2.9500	USD	\N	6720.0000	2.5000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	C5L	Ssl2081	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1200 Deniers-Cream B-Cb -1005 Sf	PES-SH	FRS-002	PES Sh-1200 Deniers-Cream B-Cb -1005 Sf	Polyester Fil Shrink	Cream	1200	kg	2.2000	336	\N	2.2400	USD	\N	8900.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	20.7657	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	C5L	Cb -1005	\N	\N	\N	100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers-Vizon Cp-2018 Sf	PES-SH	FRS-002	PES Sh-1500 Deniers-Vizon Cp-2018 Sf	Polyester Fil Shrink	Cream	1500	kg	2.2000	336	\N	2.7700	USD	\N	2950.0000	1.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	25.6790	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	C5L	Cp-2018	\N	\N	\N	100% POLYESTER DTY 1500*1 Denier (300*5);144 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1200 Deniers- Cream Dtbc-H69-Gzm	PES-SH	FRS-003	PES Sh-1200 Deniers- Cream Dtbc-H69-Gzm	Polyester Fil Shrink	Cream	1200	kg	2.0000	448	\N	2.0500	USD	\N	2688.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	19.0043	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	C5L	Dtbc-H69	\N	\N	\N	100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh -1200 Deniers-Cream Cb-1426 Turk	PES-SH	FRS-007	PES Sh -1200 Deniers-Cream Cb-1426 Turk	Polyester Fil Shrink	Beige	1200	kg	2.1000	336	\N	1.9100	USD	\N	5644.0000	2.5000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	17.7065	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	C5	Cb-1426	\N	\N	\N	\N	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers-Cream H-1008-Tat	PES-SH	FRS-004	PES Sh-1500 Deniers-Cream H-1008-Tat	Polyester Fil Shrink	Cream	1500	kg	2.1000	448	\N	4.0200	USD	\N	3544.0000	2.5000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	37.2670	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	C5L	H-1008	\N	\N	\N	1500 DENIER SHRINK POLYESTER	BOBINE	1344.00	INDIFFERENT	1	0
PP-1750*2 Dtex-Sh Creme 2981 Hs	PP	FRS-001	PP-1750*2 Dtex-Sh Creme 2981 Hs	Polypropylène	Cream	1750*2	kg	3.1000	240	\N	2.1800	USD	\N	8332.0000	2.0000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	20.2095	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1750*2 DTEX	C5L	2981	\N	\N	\N	100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Cream 44412-Hs	PP	FRS-001	PP FRZ-2900 Dtex-Cream 44412-Hs	Polypropylène	Cream	2900	kg	3.1500	240	\N	2.6200	USD	\N	8600.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	24.2884	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C5L	44412	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PP-1000*2 Dtex-Cream Mn-1201-Tat	PP	FRS-004	PP-1000*2 Dtex-Cream Mn-1201-Tat	Polypropylène	Cream	1000*2	kg	2.3000	286	\N	3.0500	USD	\N	7765.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	28.2747	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1000X2-DTEX	C5L	Mn-1201	\N	\N	\N	MN Final 1000x2 Dtex HS-360 FIL, 300/S TPM	BOBINE	1344.00	INDIFFERENT	1	0
PP-1775*2 Dtex-Cream 1072-Tat	PP	FRS-004	PP-1775*2 Dtex-Cream 1072-Tat	Polypropylène	Cream	1775*2	kg	2.0000	336	\N	2.2750	USD	\N	7800.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	21.0902	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1775*2-DTEX	C5L	1072	\N	\N	\N	REPALL/FINAL 1775DX2 FRZ- 300 FLAMENTS 165/S TPM	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Cream 1104-Tat	PP	FRS-004	PP FRZ-2900 Dtex-Cream 1104-Tat	Polypropylène	Cream	2900	kg	2.0000	336	\N	2.1570	USD	\N	5376.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	19.9963	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C5L	1104	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRIEZE,	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh -1200 Deniers-Cream Cb-1056 Turk	PES-SH	FRS-007	PES Sh -1200 Deniers-Cream Cb-1056 Turk	Polyester Fil Shrink	Cream CR	1200	kg	2.0000	336	\N	2.0500	USD	\N	2822.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	19.0043	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	C5L	Cb-1056	\N	\N	\N	100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Navy 7062 -Oz	PP	FRS-005	PP FRZ-2900 Dtex-Navy 7062 -Oz	Polypropylène	D.Turkoi	2900	kg	3.1000	240	\N	2.1500	USD	\N	4166.0000	1.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	19.9314	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CT	7062	\N	\N	\N	100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Dk.Vison Ssl2176-Suj	PES	FRS-006	PES-3000 Deniers- Dk.Vison Ssl2176-Suj	Polyester	Dk Vison	3000	kg	2.5000	392	\N	2.9500	USD	\N	6720.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	CZ	Ssl2176	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1200 Deniers-Cpbt Grey 801-Tat	PES-SH	FRS-004	PES Sh-1200 Deniers-Cpbt Grey 801-Tat	Polyester Fil Shrink	Gris	1200	kg	2.0000	448	\N	2.8900	USD	\N	2688.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	26.7915	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	CG	801	\N	\N	\N	1200 DENIER SHRINK POLYESTER	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh -1200 Deniers-Grey Cb-7A Turk	PES-SH	FRS-007	PES Sh -1200 Deniers-Grey Cb-7A Turk	Polyester Fil Shrink	Gris	1200	kg	2.1000	336	\N	1.9500	USD	\N	2822.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	18.0773	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	CG	Cb-7A	\N	\N	\N	100% POLYESTER SHRINK 1200*1 Denier yarn 96*4 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex- Grey 8933-Hs	PP	FRS-001	PP FRZ-2900 Dtex- Grey 8933-Hs	Polypropylène	Gris Claire	2900	kg	3.1500	240	\N	2.6700	USD	\N	8600.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	24.7520	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CGL	8933	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES -1500 Deniers-Grey 1274-Gzm	PES-PO	FRS-003	PES -1500 Deniers-Grey 1274-Gzm	Polyester Fil Poil	Gris	1500	kg	2.5000	448	\N	2.3500	USD	\N	3360.0000	2.5000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	21.7854	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS	CG	1274	\N	\N	\N	100% POLYESTER DTY 1500*1 DENIER (300*5); 144 Flaments	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1200 Deniers-Antrasit 802-Tat	PES-SH	FRS-004	PES Sh-1200 Deniers-Antrasit 802-Tat	Polyester Fil Shrink	Gris Mouchte	1200	kg	2.0000	448	\N	2.8900	USD	\N	2688.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	26.7915	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS-SHRINK	CGM	802	\N	\N	\N	1200 DENIER SHRINK POLYESTER	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Grey 10575-Hs	PP	FRS-001	PP FRZ-2900 Dtex-Grey 10575-Hs	Polypropylène	Gris Mouchte	2900	kg	3.1500	240	\N	2.6700	USD	\N	8600.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	24.7520	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CG	10575	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Khave Ssl2279-Suj	PES	FRS-006	PES-3000 Deniers- Khave Ssl2279-Suj	Polyester	Khave	3000	kg	2.5000	392	\N	2.9500	USD	\N	3360.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	CM	Ssl2279	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj	PES	FRS-006	Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj	Polyester	L.Beige	7360	kg	2.2000	448	\N	3.2800	USD	\N	5956.0000	2.5000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	30.4069	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	MICRO-PES-7360	C5I	1305-130	\N	\N	\N	Pes Micro 7360D Soft Touch-5 1305-130 Multi L.Beige	BOBINE	1344.00	INDIFFERENT	1	0
PES -1500 Deniers-L.Beige 1273-Gzm	PES-PO	FRS-003	PES -1500 Deniers-L.Beige 1273-Gzm	Polyester Fil Poil	L.Beige	1500	kg	2.5000	448	\N	2.3500	USD	\N	3360.0000	2.5000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	21.7854	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS	C5I	1273	\N	\N	\N	100% POLYESTER DTY 1500*1 DENIER (300*5); 144 Flaments	BOBINE	1344.00	INDIFFERENT	1	0
PP-1500 Dtex-L.Beige 44377-Hs	PP	FRS-001	PP-1500 Dtex-L.Beige 44377-Hs	Polypropylène	L.Beige	1500	kg	2.6000	288	\N	2.3800	USD	\N	4400.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	22.0636	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	C5L	44377	\N	\N	\N	100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PP-1000*2 Dtex-Beige Mn-3203 L-Tat	PP	FRS-004	PP-1000*2 Dtex-Beige Mn-3203 L-Tat	Polypropylène	L.Beige	1000*2	kg	2.3000	286	\N	3.1040	USD	\N	7765.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	28.7753	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1000X2-DTEX	C5I	Mn-3203	\N	\N	\N	MN Final 1000x2 Dtex HS-360 FIL, 300/S TPM	BOBINE	1344.00	INDIFFERENT	1	0
Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj	PES	FRS-006	Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj	Polyester	L.Brown	7360	kg	2.2000	448	\N	3.2800	USD	\N	2960.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	30.4069	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	MICRO-PES-7360	CML	1305-61	\N	\N	\N	Pes Micro 7360D Soft Touch-5 1305-61 Multi L.Brown	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy-1500 Deniers-Marron Fdy-36005-Gzm	PES	FRS-003	PES Fdy-1500 Deniers-Marron Fdy-36005-Gzm	Polyester	Marron	1500	kg	2.5000	448	\N	2.4700	USD	\N	3360.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	22.8979	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-FDY	CM	Fdy-36005	\N	\N	\N	1500 Denier polyester floss yarn Marron	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf	PES-SH	FRS-002	PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf	Polyester Fil Shrink	Marron	1500	kg	2.2000	336	\N	2.7700	USD	\N	2950.0000	1.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	25.6790	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	CM	Cp-2068	\N	\N	\N	100% POLYESTER DTY 1500*1 Denier (300*5);144 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers-D.VizonTex-7521 Text	PES-SH	FRS-008	PES Sh-1500 Deniers-D.VizonTex-7521 Text	Polyester Fil Shrink	Marron	1500	kg	2.2000	392	\N	2.9000	USD	\N	5913.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	26.8842	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	CM	Tex-7521	\N	\N	\N	PES DRAW TEXTURING YARN KRİNKIL 1500 DNY	BOBINE	1344.00	INDIFFERENT	1	0
PP-1750*2 Dtex-Sh Brown 44415 Hs	PP	FRS-001	PP-1750*2 Dtex-Sh Brown 44415 Hs	Polypropylène	Marron	1750*2	kg	3.1000	240	\N	2.2300	USD	\N	8332.0000	2.0000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	20.6730	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1750*2 DTEX	CM	44415	\N	\N	\N	100% PP FRISE YARN 1750*2 DTEX 460 FILAMENTS 205 TPM FINAL -S - 1,5 % softer	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Brown 44361-Hs	PP	FRS-001	PP FRZ-2900 Dtex-Brown 44361-Hs	Polypropylène	Marron (CMS)	2900	kg	3.1500	240	\N	2.7200	USD	\N	12900.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	25.2155	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CM	44361	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Brown 6161-Oz	PP	FRS-005	PP FRZ-2900 Dtex-Brown 6161-Oz	Polypropylène	Marron (CMS)	2900	kg	3.1000	240	\N	1.9400	USD	\N	12500.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	17.9846	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CM	6161	\N	\N	\N	100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Black 8001-Hs	PP	FRS-001	PP FRZ-2900 Dtex-Black 8001-Hs	Polypropylène	Noir	2900	kg	3.1500	240	\N	2.6200	USD	\N	8600.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	24.2884	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C2	8001	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Black 9000-Oz	PP	FRS-005	PP FRZ-2900 Dtex-Black 9000-Oz	Polypropylène	Noir	2900	kg	3.1000	240	\N	1.9400	USD	\N	8333.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	17.9846	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C2	9000	\N	\N	\N	100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy-1500 Deniers-Olive Fdy-93005-Gzm	PES	FRS-003	PES Fdy-1500 Deniers-Olive Fdy-93005-Gzm	Polyester	Olive	1500	kg	2.5000	448	\N	2.4700	USD	\N	3360.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	22.8979	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-FDY	CVR	Fdy-93005	\N	\N	\N	1500 Denier polyester floss yarn Olive	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm	PES	FRS-003	PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm	Polyester	Or	1500	kg	2.5000	448	\N	2.3000	USD	\N	6720.0000	2.5000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	21.3219	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-FDY	C1	Fdy-33005	\N	\N	\N	1500 Denier polyester floss yarn GOLD	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy -1800 Deniers-Gold Cf-101 Turk	PES	FRS-007	PES Fdy -1800 Deniers-Gold Cf-101 Turk	Polyester	Or	1800	kg	2.5000	448	\N	3.0500	USD	\N	2822.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	28.2747	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1800-FDY	C1	Cf-101	\N	\N	\N	100% POLYESTER FDY FLOSH	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Dk.Beige Ssl2271-Suj	PES	FRS-006	PES-3000 Deniers- Dk.Beige Ssl2271-Suj	Polyester	Or	3000	kg	2.5000	392	\N	2.9500	USD	\N	6720.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	C1	Ssl2271	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PES-1500 Deniers-Gold Cb-4016 Sf	PES-PO	FRS-002	PES-1500 Deniers-Gold Cb-4016 Sf	Polyester Fil Poil	Or	1500	kg	2.5000	336	\N	2.2000	USD	\N	3360.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	20.3949	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS	C1	Cb-4016	\N	\N	\N	100% POLYESTER DTY 1500*1 Denier (300*5);144 Filament	BOBINE	1344.00	INDIFFERENT	1	0
PP-1500 Dtex-Yellow 3430-Hs	PP	FRS-001	PP-1500 Dtex-Yellow 3430-Hs	Polypropylène	Or	1500	kg	2.6000	288	\N	2.4900	USD	\N	4400.0000	2.0000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	23.0833	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	C1	3430	\N	\N	\N	100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Gold 3423-Hs	PP	FRS-001	PP FRZ-2900 Dtex-Gold 3423-Hs	Polypropylène	Or	2900	kg	3.1500	240	\N	2.7200	USD	\N	8600.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	25.2155	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C1	3423	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Gold 3034-Oz	PP	FRS-005	PP FRZ-2900 Dtex-Gold 3034-Oz	Polypropylène	Or	2900	kg	3.1000	240	\N	1.9400	USD	\N	8333.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	17.9846	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C1	3034	\N	\N	\N	100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy-1500 Deniers-Rose Fdy-423020-Gzm	PES	FRS-003	PES Fdy-1500 Deniers-Rose Fdy-423020-Gzm	Polyester	Rose	1500	kg	2.5000	448	\N	2.4700	USD	\N	3360.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	22.8979	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-FDY	CR	Fdy-423020	\N	\N	\N	1500 Denier polyester floss yarn Rose	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Pink Ssl2259-Suj	PES	FRS-006	PES-3000 Deniers- Pink Ssl2259-Suj	Polyester	Rose	3000	kg	2.5000	392	\N	2.9500	USD	\N	3360.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	CR	Ssl2259	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PP-1500 Dtex-Pink 7623-Hs	PP	FRS-001	PP-1500 Dtex-Pink 7623-Hs	Polypropylène	Rose	1500	kg	2.6000	288	\N	2.5300	USD	\N	4400.0000	1.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	23.4541	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	CR	7623	\N	\N	\N	100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Pink 7639-Hs	PP	FRS-001	PP FRZ-2900 Dtex-Pink 7639-Hs	Polypropylène	Rose	2900	kg	3.1500	240	\N	2.0000	USD	\N	4300.0000	1.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	18.5408	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CR	7639	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Rouge Ssl2232-Suj	PES	FRS-006	PES-3000 Deniers- Rouge Ssl2232-Suj	Polyester	Rouge	3000	kg	2.5000	392	\N	2.9500	USD	\N	6720.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	C3	Ssl2232	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PES -1200 Deniers-Anty Bordeau 61043-Gzm	PES	FRS-003	PES -1200 Deniers-Anty Bordeau 61043-Gzm	Polyester	Rouge	1200	kg	1.7000	448	\N	2.8000	USD	\N	11500.0000	2.5000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	25.9571	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1200-DENIERS	C3	61043	\N	\N	\N	100% POLYESTER DTY ANATOLIA 1200*1 DENIER (300*4); 144 filament	BOBINE	1344.00	INDIFFERENT	1	0
Micro PES-3600 Deniers Ivory 15-Tat	PES	FRS-004	Micro PES-3600 Deniers Ivory 15-Tat	Polyester	Blanc	3600	kg	2.9000	336	\N	3.1300	USD	\N	3900.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	29.0164	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	MICRO-PES-3600-DENIERS	C00	15	\N	\N	\N	300X2X6 MICRO POLYESTER	BOBINE	1344.00	INDIFFERENT	1	0
Micro PES-3600 Deniers Shade 25-Tat	PES	FRS-004	Micro PES-3600 Deniers Shade 25 -Tat	Polyester	Blanc Mouchte	3600	kg	2.9000	336	\N	3.1300	USD	\N	3900.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	29.0164	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	MICRO-PES-3600-DENIERS	CG	25	\N	\N	\N	300X2X6 MICRO POLYESTER	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex- Grey 9095-Oz	PP	FRS-005	PP FRZ-2900 Dtex- Grey 9095-Oz	Polypropylène	Gris Claire	2900	kg	3.1000	240	\N	1.9400	USD	\N	8333.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	17.9846	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CGL	9095	\N	\N	\N	100% POLYPROPYLENE YARN 2900  DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PES -1500 Deniers-Bordeau 61043-Gzm	PES-PO	FRS-003	PES -1500 Deniers-Bordeau 61043-Gzm	Polyester Fil Poil	Rouge	1500	kg	2.0000	448	\N	2.8000	USD	\N	10750.0000	2.5000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	25.9571	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS	C3	61043	\N	\N	\N	100% POLYESTER DTY ANATOLIA 1500*1 DENIER (300*5); 144 Flaments	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex- Red 7612-Hs	PP	FRS-001	PP FRZ-2900 Dtex- Red 7612-Hs	Polypropylène	Rouge	2900	kg	3.1500	240	\N	3.0000	USD	\N	12900.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	27.8112	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	C3	7612	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PP-1900 Dtex-L.Beige 44377-Hs	PP	FRS-001	PP-1900 Dtex-L.Beige 44377-Hs	Polypropylène	Taupe	1900	kg	3.1000	240	\N	2.9000	USD	\N	12600.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	26.8842	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1900-DTEX	CMG	44377	\N	\N	\N	100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PES Fdy-1500 Deniers-Turkoise Fdy-513020-Gzm	PES	FRS-003	PES Fdy-1500 Deniers-Turkoise Fdy-513020-Gzm	Polyester	Turkoise	1500	kg	2.5000	448	\N	2.4700	USD	\N	3360.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	22.8979	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-FDY	CT	Fdy-513020	\N	\N	\N	1500 Denier polyester floss yarn Turkoise	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Green Mlt 18-Tat	PP	FRS-004	PP FRZ-2900 Dtex-Green Mlt 18-Tat	Polypropylène	Vert	2900	kg	2.0000	336	\N	2.3900	USD	\N	2688.0000	2.5000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	22.1563	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CV	18	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRIEZE,	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Vison Ssl2247-Suj	PES	FRS-006	PES-3000 Deniers- Vison Ssl2247-Suj	Polyester	Vison	3000	kg	2.5000	392	\N	2.9500	USD	\N	6720.0000	2.5000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	CZ	Ssl2247	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers-VizonTex-7530 Text	PES-SH	FRS-008	PES Sh-1500 Deniers-VizonTex-7530 Text	Polyester Fil Shrink	Vizon	1500	kg	2.2000	392	\N	2.9000	USD	\N	5913.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	26.8842	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	CZ	Tex-7530	\N	\N	\N	PES DRAW TEXTURING YARN KRİNKIL 1500 DNY	BOBINE	1344.00	INDIFFERENT	1	0
PES-Nylon	PES	FRS-010	PES-Nylon	Polyester	Blanc	1100	kg	\N	\N	\N	5.3000	USD	\N	56.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	49.1331	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1100-POLY	C00	1100	\N	\N	\N	Polyester Yarn For Swing	\N	5000.00	INDIFFERENT	1	0
PES-20/2 GLOBALTEX	PES-CH	FRS-010	PES-20/2 GLOBALTEX	Polyester Chaîne	Blanc	20/2	kg	\N	\N	\N	1.9000	USD	\N	0.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	17.6138	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	12/2	C00	20/2	\N	\N	\N	Polyester Spun 20/2	\N	5000.00	INDIFFERENT	1	0
Jute 30/1	JUT	FRS-010	Jute 30/1	Jute	Beige	30/1	kg	\N	\N	\N	1.5800	USD	\N	65342.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	14.6472	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	30/1	C5	30/1	\N	\N	\N	FIL DE JUTE 30/1	\N	5000.00	INDIFFERENT	1	0
Jute 9,6/1	JUT	FRS-010	Jute 9,6/1	Jute	Beige	9,6/1	kg	\N	\N	\N	2.1800	USD	\N	3304.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	20.2095	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	9,6/1	C5	3000/1	\N	\N	\N	FIL DE JUTE 9,6/1	\N	5000.00	INDIFFERENT	1	0
PLA 140 CHE	PLA	FRS-011	Plastique-140	Plastique	Blanc	140	kg	\N	\N	\N	20.0000	MAD	\N	301.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	20.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-140	C00	140	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PES Nylon	PES	FRS-002	PES Nylon	Polyester	Blanc	1100	kg	\N	\N	\N	2.5000	USD	\N	1020.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	23.1760	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1100-POLY	C00	1100	\N	\N	\N	Polyester Yarn For Swing	\N	5000.00	INDIFFERENT	1	0
Jute 12/1	JUT	FRS-010	Jute 12/1	Jute	Beige	12/1	kg	\N	\N	\N	2.0900	USD	\N	20332.0000	2.0000	\N	\N	A	Z	2026-09-20T15:46:06.875Z	19.3751	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	12/1	C5	12/1	\N	\N	\N	FIL DE JUTE 12/1	\N	5000.00	INDIFFERENT	1	0
Jute 16/2	JUT	FRS-010	Jute 16/2	Jute	Beige	16/2	kg	\N	\N	\N	1.8300	USD	\N	0.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	16.9648	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	16/2	C5	1800/2	\N	\N	\N	FIL DE JUTE 16/2	\N	5000.00	INDIFFERENT	1	0
Jute 20/2	JUT	FRS-010	Jute 20/2	Jute	Beige	20/2	kg	\N	\N	\N	1.2900	USD	\N	6159.0000	2.0000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	11.9588	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	20/2	C5	1440/2	\N	\N	\N	FIL DE JUTE 20/2	\N	5000.00	INDIFFERENT	1	0
Jute 24/1	JUT	FRS-010	Jute 24/1	Jute	Beige	24/1	kg	\N	\N	\N	1.6200	USD	\N	34737.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	15.0180	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	24/1	C5	1200/1	\N	\N	\N	FIL DE JUTE 24/1	\N	5000.00	INDIFFERENT	1	0
Bande	LAI	FRS-002	Bande	Laine	Beige	\N	kg	\N	\N	0.0050	2.5000	USD	\N	215.0000	2.0000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	23.1760	2026-09-18T12:48:34.712Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	LAINE	C5	Bande	\N	\N	\N	TAPE FROM NONWOVEN	ROULEAU_PETIT	5000.00	INDIFFERENT	1	0
PES-20/2 LOMAT	PES-CH	FRS-009	PES-20/2 LOMAT	Polyester Chaîne	Blanc	20/2	kg	\N	\N	\N	1.9000	USD	\N	24433.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	17.6138	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	12/2	C00	20/2	\N	\N	\N	Polyester Spun 20/2	\N	5000.00	INDIFFERENT	1	0
PES-20/4 GLOBALTEX	PES-CH	FRS-010	PES-20/4 GLOBALTEX	Polyester Chaîne	Blanc	20/4	kg	4.6500	225	\N	2.0500	USD	\N	0.0000	2.0000	\N	4.0000	C	\N	2026-09-20T15:46:06.875Z	19.0043	2026-09-22T12:17:55.427Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	12/4	C00	20/4	\N	\N	\N	Polyester Spun 20/4	BOBINE	1344.00	INDIFFERENT	1	1
PES-20/4 LOMAT	PES-CH	FRS-009	PES-20/4 LOMAT	Polyester Chaîne	Blanc	20/4	kg	\N	\N	\N	1.9000	USD	\N	14975.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	17.6138	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	12/4	C00	20/4	\N	\N	\N	Polyester Spun 20/4	\N	5000.00	INDIFFERENT	1	0
Cuir	CUI	FRS-002	Cuir	Simili Cuir	Noir	\N	ml	\N	\N	0.0140	0.0740	USD	\N	603.0000	2.0000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	49.0006	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	IMITATION-CUIR	C0	CUIR	\N	\N	\N	IMITATION LEATHER	\N	5000.00	INDIFFERENT	1	0
PLA 140 EXT	PLA	FRS-012	Plastique 140	Plastique	Blanc	140	kg	\N	\N	\N	21.0000	MAD	\N	43.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	21.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-140	C00	140	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 35 EXT	PLA	FRS-012	Plastique 35	Plastique	Blanc	35	kg	\N	\N	\N	21.0000	MAD	\N	0.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	21.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-35	C00	35	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 35 CHE	PLA	FRS-011	Plastique-35	Plastique	Blanc	35	kg	\N	\N	\N	20.0000	MAD	\N	0.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	20.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-35	C00	35	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 45 EXT	PLA	FRS-012	Plastique 45	Plastique	Blanc	45	kg	\N	\N	\N	21.0000	MAD	\N	145.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	21.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-45	C00	45	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 65 EXT	PLA	FRS-012	Plastique 65	Plastique	Blanc	65	kg	\N	\N	\N	21.0000	MAD	\N	145.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	21.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-65	C00	65	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 100 EXT	PLA	FRS-012	Plastique 100	Plastique	Blanc	100	kg	\N	\N	\N	21.0000	MAD	\N	79.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	21.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-100	C00	100	\N	\N	\N	GAINE EN P.E TRANSPARENT INDUSTRIEL 100 CM  (Ouvert  pérforé - 9 Micro avec grand trou)	ROULEAU	5000.00	INDIFFERENT	1	0
Jute 10/1	JUT	FRS-010	Jute 10/1	\N	Beige	10/1	kg	\N	\N	\N	2.0900	USD	\N	0.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	19.3751	2026-09-17T16:58:50.060Z	1	1	2026-09-16T11:56:24.174Z	\N	\N	10/1	C5	2250/1	\N	\N	\N	FIL DE JUTE 10/1	\N	5000.00	INDIFFERENT	1	0
PLA 80 EXT	PLA	FRS-012	Plastique 80	Plastique	Blanc	80	kg	\N	\N	\N	21.0000	MAD	\N	14.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	21.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-80	C00	80	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 45 CHE	PLA	FRS-011	Plastique-45	Plastique	Blanc	45	kg	\N	\N	\N	20.0000	MAD	\N	222.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	20.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-45	C00	45	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 80 CHE	PLA	FRS-011	Plastique-80	Plastique	Blanc	80	kg	\N	\N	\N	20.0000	MAD	\N	428.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	20.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-80	C00	80	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
Hotmelt	SBR	FRS-002	Hotmelt	SBR	Blanc	\N	kg	\N	\N	\N	5.4200	USD	\N	3227.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	50.2456	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	\N	C00	\N	\N	\N	\N	\N	\N	5000.00	INDIFFERENT	1	0
SBR 821	SBR	FRS-009	SBR 821	SBR	Blanc	821	kg	\N	1	\N	1.0700	EUR	\N	61313.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	11.6095	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	SBR-821	C00	821	\N	\N	\N	Colle 821	CUVE	5000.00	INDIFFERENT	1	0
PLA 65 CHE	PLA	FRS-011	Plastique-65	Plastique	Blanc	65	kg	\N	\N	\N	20.0000	MAD	\N	154.0000	2.0000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	20.0000	2026-09-17T16:58:50.060Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-65	C00	65	\N	\N	\N	Plastique-65	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 50 EXT	PLA	FRS-012	Plastique 50	Plastique	Blanc	50	kg	\N	\N	\N	21.0000	MAD	\N	161.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	20.5000	2026-10-03T17:13:02.841Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-50	C00	50	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PP-1500 Dtex-Bleu 6666-Hs	PP	FRS-001	PP-1500 Dtex-Bleu 6666-Hs	Polypropylène	Bleu	1500	kg	2.6000	288	\N	2.6600	USD	\N	4400.0000	2.0000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	26.7752	2026-10-03T17:13:03.420Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	C4	6666	\N	\N	\N	100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PP-1500 Dtex-Yellow 3151-Oz	PP	FRS-005	PP-1500 Dtex-Yellow 3151-Oz	Polypropylène	Or	1500	kg	2.5931	288	\N	2.3300	USD	\N	4400.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	22.8496	2026-10-03T17:37:09.346Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	C1	3151	\N	\N	\N	100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PES Sh-1500 Deniers- L.Beige H-2000-Tat	PES-SH	FRS-004	PES Sh-1500 Deniers- L.Beige H-2000-Tat	Polyester Fil Shrink	Beige	1500	kg	2.1000	448	\N	4.0200	USD	\N	3544.0000	2.5000	\N	\N	C	Z	2026-09-20T15:46:06.875Z	40.1509	2026-10-03T17:13:03.420Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS-SHRINK	C5	H-2000	\N	\N	\N	1500 DENIER SHRINK POLYESTER	BOBINE	1344.00	INDIFFERENT	1	0
Micro PES-7360 Deniers-Multi Beige 1305-129-Suj	PES	FRS-006	Micro PES-7360 Deniers-Multi Beige 1305-129-Suj	Polyester	Beige	7360	kg	2.2000	448	\N	3.2800	USD	\N	5956.0000	2.5000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	30.4069	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	MICRO-PES-7360	C5	1305-129	\N	\N	\N	Pes Micro 7360D Soft Touch-5 1305-129 Multi Beige	BOBINE	1344.00	INDIFFERENT	1	0
PES -1500 Deniers-Green 1272-Gzm	PES-PO	FRS-003	PES -1500 Deniers-Green 1272-Gzm	Polyester Fil Poil	Vert	1500	kg	2.5000	448	\N	2.2500	USD	\N	3360.0000	2.5000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	20.8584	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DENIERS	CV	1272	\N	\N	\N	100% POLYESTER DTY 1500*1 DENIER (300*5); 144 Flaments	BOBINE	1344.00	INDIFFERENT	1	0
PP-1500 Dtex-Cream 2951-Hs	PP	FRS-001	PP-1500 Dtex-Cream 2951-Hs	Polypropylène	Cream	1500	kg	2.6000	288	\N	3.3800	USD	\N	4400.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	32.6518	2026-10-03T17:33:49.387Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	C5L	2951	\N	\N	\N	100% PP 1500 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PP-1500 Dtex-D.Bleu 7200-Oz	PP	FRS-005	PP-1500 Dtex-D.Bleu 7200-Oz	Polypropylène	Bleu Marine	1500	kg	2.6000	288	\N	2.6600	USD	\N	4400.0000	2.0000	\N	\N	C	\N	2026-09-20T15:46:06.875Z	26.4988	2026-10-05T16:55:07.797Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1500-DTEX	C2	7200	\N	\N	\N	100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PES-3000 Deniers- Dark Grey Ssl2069-Suj	PES	FRS-006	PES-3000 Deniers- Dark Grey Ssl2069-Suj	Polyester	Grris	3000	kg	2.5000	392	\N	2.9500	USD	\N	6720.0000	2.5000	\N	\N	B	Z	2026-09-20T15:46:06.875Z	27.3477	2026-09-17T16:58:50.060Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	3000-DENIERS	CG	Ssl2069	\N	\N	\N	Dyed Multiply Polyester Tuxtured Yarn	BOBINE	1344.00	INDIFFERENT	1	0
PP FRZ-2900 Dtex-Camel 44416-Hs	PP	FRS-001	PP FRZ-2900 Dtex-Camel 44416-Hs	Polypropylène	Camel(Marron Claire)	2900	kg	3.1500	240	\N	2.5300	USD	\N	4300.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	23.4541	2026-10-05T19:17:20.126Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	2900-DTEX	CBM	44416	\N	\N	\N	100% POLYPROPYLENE YARN 2900 DTEX FRISE, 360 FIL.115 TPM, "S" TWIST	BOBINE	1344.00	INDIFFERENT	1	0
PP-1900 Dtex- Cream 2951-Hs	PP	FRS-001	PP-1900 Dtex- Cream 2951-Hs	Polypropylène	C5N	1900	kg	3.1000	240	\N	2.9000	USD	\N	4200.0000	2.0000	\N	\N	A	Y	2026-09-20T15:46:06.875Z	26.8800	2026-10-08T15:06:40.345Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1900-DTEX	C5N	2951	\N	\N	\N	100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
PLA 100 CHE	PLA	FRS-011	Plastique-100	Plastique	Blanc	100	kg	\N	\N	\N	20.0000	MAD	\N	352.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	20.3406	2026-10-08T19:19:30.426Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-100	C00	100	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PLA 50 CHE	PLA	FRS-011	Plastique-50	Plastique	Blanc	50	kg	\N	\N	\N	20.0000	MAD	\N	211.0000	2.0000	\N	\N	C	Y	2026-09-20T15:46:06.875Z	20.5500	2026-10-08T19:19:30.426Z	0	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	PLA-50	C00	50	\N	\N	\N	\N	ROULEAU	5000.00	INDIFFERENT	1	0
PP-1900 Dtex-D.Green 5455-Hs	PP	FRS-001	PP-1900 Dtex-D.Green 5455-Hs	Polypropylène	Cvr	1900	kg	3.1000	240	\N	2.5600	USD	\N	8400.0000	2.0000	\N	\N	B	Y	2026-09-20T15:46:06.875Z	24.3615	2026-10-08T16:58:24.269Z	1	1	2026-09-04T19:10:33.934Z	fb4103c0-c16e-4214-a90b-451f7cd64211	\N	1900-DTEX	CVR	5455	\N	\N	\N	100% PP 1900 DTEX HEAT-SET TEXTURED YARN 600 FIL, 125TPM, "S" 1% softer	BOBINE	1344.00	INDIFFERENT	1	0
\.


ALTER TABLE public.reference ENABLE TRIGGER ALL;

--
-- Data for Name: recette; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.recette DISABLE TRIGGER ALL;

COPY public.recette (id_recette, code_qualite, ligne_numero, code_reference, code_role, code_groupe_equiv, pourcentage_composition, type_composant, couleur, code_fournisseur_prefere, actif) FROM stdin;
61a34ce2-d680-4773-b384-6688f25a2590	8M	16	PLA 50 CHE	PLAST	GRP-104	30.0000	Plastique	Blanc	\N	1
9c6fc504-04f3-402d-a05a-5745e47c98e5	8M	17	PLA 65 CHE	PLAST	GRP-105	20.0000	Plastique	Blanc	\N	1
6e9aed56-d86e-4f4a-9284-76ef1e374d3b	8M	18	PLA 80 EXT	PLAST	GRP-106	10.0000	Plastique	Blanc	\N	1
0abbe22d-ea9a-4b37-8185-5038bb496d0b	8M	19	PLA 100 CHE	PLAST	GRP-107	10.0000	Plastique	Blanc	\N	1
0e608e5b-e98a-45f8-9622-a09eefaf4b1a	8S	15	PLA 45 CHE	PLAST	GRP-103	30.0000	Plastique	Blanc	\N	1
1fc74561-2ec8-4ff1-928d-4a21c9045dc2	8S	16	PLA 50 CHE	PLAST	GRP-104	30.0000	Plastique	Blanc	\N	1
960e1cfc-cc75-47c7-824d-5ca016845c7f	8S	17	PLA 65 CHE	PLAST	GRP-105	20.0000	Plastique	Blanc	\N	1
5adf799d-e4f4-4f7e-b016-4db023b6e61e	8S	18	PLA 80 CHE	PLAST	GRP-106	10.0000	Plastique	Blanc	\N	1
b658b062-e7d1-4106-9fcf-d69211393d24	8S	19	PLA 100 CHE	PLAST	GRP-107	10.0000	Plastique	Blanc	\N	1
1e44d96b-d87a-4057-ad00-4f5baddc0789	BR	15	PLA 45 CHE	PLAST	GRP-103	10.0000	Plastique	Blanc	\N	1
22f67ec4-e04d-477d-a325-e39d9325ffbc	BR	16	PLA 50 CHE	PLAST	GRP-104	10.0000	Plastique	Blanc	\N	1
adcd0cfc-277c-4dc8-8956-d86635301284	BR	17	PLA 65 CHE	PLAST	GRP-105	20.0000	Plastique	Blanc	\N	1
33fa94ff-fa92-4e6e-8510-ac30aa18b88f	BR	18	PLA 80 CHE	PLAST	GRP-106	20.0000	Plastique	Blanc	\N	1
89535956-148d-4b4d-8830-448d7a3dff4d	BR	19	PLA 100 CHE	PLAST	GRP-107	20.0000	Plastique	Blanc	\N	1
89ff95f8-1b43-4c18-9586-de75b0ba0824	BR	20	PLA 140 CHE	PLAST	GRP-108	20.0000	Plastique	Blanc	\N	1
05629b28-62dd-4592-ae8d-666fe52c993c	FB	20	PLA 140 CHE	PLAST	GRP-108	30.0000	Plastique	Blanc	\N	1
5b439390-37be-423b-8cef-951749ec5f55	FB	21	PLA 45 CHE	PLAST	GRP-103	5.0000	Plastique	Blanc	\N	1
d8ca24e4-613b-418f-88b4-92974a371243	FB	22	PLA 50 CHE	PLAST	GRP-104	5.0000	Plastique	Blanc	\N	1
c4e187bd-5507-4d0d-b0c4-0ea8dc4edc95	FB	23	PLA 80 CHE	PLAST	GRP-106	30.0000	Plastique	Blanc	\N	1
5a2e60cd-c07e-4902-8236-97851333a7b3	FB	24	PLA 100 CHE	PLAST	GRP-107	30.0000	Plastique	Blanc	\N	1
4105ce6f-b27c-4cf7-a657-cb132cc4a9f5	IS	6	PLA 65 EXT	PLAST	GRP-105	10.0000	Plastique	Blanc	\N	1
2165587b-ae90-4875-8bba-aa800725a4a9	IS	7	PLA 80 CHE	PLAST	GRP-106	30.0000	Plastique	Blanc	\N	1
88142c69-ea7d-4214-bdf1-176b39570b52	IS	8	PLA 100 CHE	PLAST	GRP-107	30.0000	Plastique	Blanc	\N	1
d15be106-5744-4cc7-bc00-0b51776d468b	IS	9	PLA 140 CHE	PLAST	GRP-108	30.0000	Plastique	Blanc	\N	1
6815ae63-1f98-4485-b855-9a5de17ef771	LH	11	PLA 80 CHE	PLAST	GRP-106	40.0000	Plastique	Blanc	\N	1
9c2a3d92-bc47-4021-b8a7-4c972652896d	LH	12	PLA 100 EXT	PLAST	GRP-107	40.0000	Plastique	Blanc	\N	1
06633ee0-1765-41cd-9d7d-56811a190ff6	LH	13	PLA 140 EXT	PLAST	GRP-108	20.0000	Plastique	Blanc	\N	1
7caf60a5-7717-4cca-a4d4-83c9508a3cd1	LP	9	PLA 65 EXT	PLAST	GRP-105	30.0000	Plastique	Blanc	\N	1
0ed3f5c7-51e5-4b64-8e10-971694d64521	LP	10	PLA 45 EXT	PLAST	GRP-103	35.0000	Plastique	Blanc	\N	1
9e9985ac-fdfa-4cbc-822b-def13261e185	LP	11	PLA 50 EXT	PLAST	GRP-104	35.0000	Plastique	Blanc	\N	1
6958345d-85b3-4b69-a294-0fee748c8ff7	MF	14	PLA 45 CHE	PLAST	GRP-103	35.0000	Plastique	Blanc	\N	1
703406c4-d3ca-4538-8784-1f67d6f83eb1	MF	15	PLA 50 CHE	PLAST	GRP-104	35.0000	Plastique	Blanc	\N	1
dd6509a3-55fa-42d4-9621-74bcd43ee665	MF	16	PLA 80 CHE	PLAST	GRP-106	30.0000	Plastique	Blanc	\N	1
e6b9d154-a1a8-4230-90fa-2fab4c95af2a	MN	6	PLA 45 EXT	PLAST	GRP-103	20.0000	Plastique	Blanc	\N	1
de9127fd-a0fb-4912-afe0-5045c60ded48	MN	7	PLA 50 EXT	PLAST	GRP-104	30.0000	Plastique	Blanc	\N	1
d1174034-9fe6-447d-ae88-c2596a757b6c	MN	8	PLA 65 CHE	PLAST	GRP-105	30.0000	Plastique	Blanc	\N	1
a9a98f3a-8a9b-4b78-be9a-10ad704906be	MN	9	PLA 80 CHE	PLAST	GRP-106	20.0000	Plastique	Blanc	\N	1
1f813ad9-f8f8-4a58-bdd3-503238f75e61	MP	18	PLA 45 EXT	PLAST	GRP-103	35.0000	Plastique	Blanc	\N	1
0c8509d5-c62a-4c47-8961-d2430484b278	MP	19	PLA 65 EXT	PLAST	GRP-105	30.0000	Plastique	Blanc	\N	1
7c447229-6c4b-4dff-9055-b04e399cde40	PS	8	PLA 80 CHE	PLAST	GRP-106	50.0000	Plastique	Blanc	\N	1
41394e48-cdde-4343-92d4-7382cd91dd97	PS	9	PLA 100 CHE	PLAST	GRP-107	50.0000	Plastique	Blanc	\N	1
24b48545-4a3f-4be8-ba76-746a8b9f3425	SH	10	PLA 50 EXT	PLAST	GRP-104	35.0000	Plastique	Blanc	\N	1
c428cc6d-479a-40f5-8fa3-7b9bd4b92fa2	SH	11	PLA 65 EXT	PLAST	GRP-105	30.0000	Plastique	Blanc	\N	1
6f9fcf30-2bbf-4201-a6c5-412a32db3ae1	SH	12	PLA 45 EXT	PLAST	GRP-103	35.0000	Plastique	Blanc	\N	1
978785b8-521f-43a7-b819-40489a9351fd	SL	3	Micro PES-3600 Deniers Shade 25-Tat	POIL	GRP-049	12.5000	Polyester	Blanc Mouchte	\N	1
34369623-3790-40a1-8683-70bba92da8cd	SL	6	PLA 100 CHE	PLAST	GRP-107	30.0000	Plastique	Blanc	\N	1
a8fe1ebe-3173-4a07-aba5-c6c2b0299d5a	SL	7	PLA 140 CHE	PLAST	GRP-108	30.0000	Plastique	Blanc	\N	1
52c87faf-9e7e-4260-a3c1-fdae7308b9da	SL	8	PLA 80 CHE	PLAST	GRP-106	20.0000	Plastique	Blanc	\N	1
6f0a0fff-7f0a-43ff-a822-9a474ea610e0	SL	9	PLA 65 CHE	PLAST	GRP-105	20.0000	Plastique	Blanc	\N	1
ad28268c-a3e1-4bfb-8973-9d5c8a75f566	TN	12	PLA 80 EXT	PLAST	GRP-106	40.0000	Plastique	Blanc	\N	1
cbb49554-346d-4bc0-868b-e1b2c3b0f503	TN	13	PLA 100 EXT	PLAST	GRP-107	40.0000	Plastique	Blanc	\N	1
bec0d6fa-7e7d-4846-9e51-2eb943785bd7	TN	14	PLA 140 EXT	PLAST	GRP-108	20.0000	Plastique	Blanc	\N	1
d1b93d1d-27d1-42ff-99f3-3a69a1f4d4fc	YF	11	PLA 140 CHE	PLAST	GRP-108	20.0000	Plastique	Blanc	\N	1
0853d1df-aea7-499b-80e5-bd720bb04d0b	YF	12	PLA 45 CHE	PLAST	GRP-103	30.0000	Plastique	Blanc	\N	1
20a29f68-adec-4337-b62c-14de6533f88a	YF	13	PLA 50 EXT	PLAST	GRP-104	30.0000	Plastique	Blanc	\N	1
f380e5c9-d154-416b-ae95-9d6fa0d68bec	YF	14	PLA 65 CHE	PLAST	GRP-105	20.0000	Plastique	Blanc	\N	1
2760b894-d4e5-4ba3-92fa-efae0be5d207	YH	4	PLA 140 CHE	PLAST	GRP-108	80.0000	Plastique	Blanc	\N	1
7aaf88f6-8881-4f37-8d5c-75c43463d622	YH	5	PLA 100 CHE	PLAST	GRP-107	20.0000	Plastique	Blanc	\N	1
365211f2-ffe1-4ef5-bdd9-d9f6e851e7dd	8F	11	PLA 65 EXT	PLAST	GRP-105	25.0000	Plastique	Blanc	\N	1
5a68489b-03bc-43a4-8016-e7663e634dac	8F	12	PLA 80 EXT	PLAST	GRP-106	25.0000	Plastique	Blanc	\N	1
68d724af-5b6b-4b62-8fb7-50ef875d1f01	8F	13	PLA 100 EXT	PLAST	GRP-107	25.0000	Plastique	Blanc	\N	1
4581cc76-6546-4918-852a-21ce600ebe51	8F	14	PLA 140 EXT	PLAST	GRP-108	25.0000	Plastique	Blanc	\N	1
97743e4e-3df4-4ce4-8bb3-4f8a25185553	8F	1	PP FRZ-2900 Dtex-Gold 3423-Hs	POIL	GRP-001	9.5000	Polypropylène	Or	\N	1
09b3697a-5d69-4e82-98af-a911a981cfae	8F	2	PP FRZ-2900 Dtex-Black 8001-Hs	POIL	GRP-002	18.0000	Polypropylène	Noir	\N	1
c1e1b8cd-02da-412f-80df-c4ae8c4aee23	8F	3	PP FRZ-2900 Dtex- Red 7612-Hs	POIL	GRP-003	54.0000	Polypropylène	Rouge	\N	1
e8cf4f0a-735a-4d6c-b4f9-ac61e2d74218	8F	4	PP FRZ-2900 Dtex-Beige 44360-Hs	POIL	GRP-005	18.0000	Polypropylène	Beige (C5S)	\N	1
f7f52e47-1622-46b5-bacb-0a0af72041e7	8F	5	Jute 24/1	TRAME	GRP-086	100.0000	Jute	Beige	\N	1
46d5ec15-c02e-4887-b7da-37db92ba5507	8F	6	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
e22c83bb-97d1-4530-bf66-57e6e9c8ded5	8F	7	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
d0024825-ee3d-42b9-b0f4-6b4c2da30d3a	8F	8	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
0475f8ea-2ce7-4265-9a04-d01fe16ce657	8F	9	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
49f2cac1-e30c-4404-931d-df08ad61c883	8F	10	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
0105ed6a-b8c6-45ab-90e0-30c0c5755e56	8M	1	PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm	POIL	GRP-037	12.0000	Polyester	Or	\N	1
547cd78f-bba0-4e5e-bdaa-83a95376e164	8M	2	PES Sh -1200 Deniers-Cream B Cp-1005Turk	POIL	GRP-029	20.0000	Polyester Fil Shrink	Cream B	\N	1
24eed376-17e9-4d8c-8cc4-a8b8e3e51f9d	8M	3	PES -1500 Deniers-Bordeau 61043-Gzm	POIL	GRP-032	20.0000	Polyester Fil Poil	Rouge	\N	1
e729ae72-aa8f-45e2-87d5-9db73e3acd84	8M	4	PP-1900 Dtex- Cream 2951-Hs	POIL	GRP-013	26.5000	Polypropylène	C5N	\N	1
6f2923ca-afd6-4f21-9414-a1d92e162c20	8M	5	PP-1900 Dtex-L.Beige 44377-Hs	POIL	GRP-014	14.0000	Polypropylène	Taupe	\N	1
d5fcdb58-8253-4126-9a29-28aba1236dae	8M	6	PP-1900 Dtex-D.Green 5455-Hs	POIL	GRP-015	7.0000	Polypropylène	Cvr	\N	1
0562636a-9caa-442e-8d0a-f388395f3741	8M	7	Jute 24/1	TRAME	GRP-086	100.0000	Jute	Beige	\N	1
a30e074e-a6ad-4ef0-8f5e-94f134bc0fb9	8M	8	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
21b76ae2-ef11-4bef-a764-31335b41ec1a	8M	9	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
7beaaf25-1199-4932-8af9-ba33c799df44	8M	10	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
269ea55f-6c22-4219-a39f-49aff6ef3755	8M	11	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
fd873707-c1d3-4601-8d27-8064e24c1cca	8M	12	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
0c4f61af-6368-40fd-9ecd-fb4738d6fcd1	8M	13	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
5abb9d67-70cd-4274-bf31-1db567f7acba	8M	14	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
73dc1e3a-973b-4335-b8e4-a67a6afab935	8S	1	PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm	POIL	GRP-037	12.0000	Polyester	Or	\N	1
12f328e9-577d-4e63-b7d9-6946c2dccb3f	8S	2	PES Sh-1200 Deniers-Cream B-Cb -1005 Sf	POIL	GRP-029	20.0000	Polyester Fil Shrink	Cream	\N	1
a79d15f8-5468-4fd6-b14b-0b21ee13c013	8S	3	PP-1900 Dtex-L.Beige 44377-Hs	POIL	GRP-014	14.0000	Polypropylène	Taupe	\N	1
58cd965e-1b99-4f8e-b8a7-fc2521a1153f	8S	4	PP-1900 Dtex- Cream 2951-Hs	POIL	GRP-013	26.5000	Polypropylène	C5N	\N	1
5e33c15c-3e40-4a4b-af0c-267bcf8b235e	8S	5	PP-1900 Dtex-D.Green 5455-Hs	POIL	GRP-015	7.0000	Polypropylène	Cvr	\N	1
809e64c4-bd02-451a-ac3d-c6483cbb7779	8S	6	PES -1500 Deniers-Bordeau 61043-Gzm	POIL	GRP-032	20.0000	Polyester Fil Poil	Rouge	\N	1
62e46568-87ce-4334-8f5c-fef28f850ddd	8S	7	Jute 24/1	TRAME	GRP-086	100.0000	Jute	Beige	\N	1
a8adff0c-b973-4ba2-920e-fcf0848303b8	8S	8	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
8d87d16c-426c-46eb-bae8-4b0a44ac93ac	8S	9	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
8795cf26-6729-4726-bc81-08cb2ca56433	8S	10	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
6650410f-1168-4501-a036-f0c8e43a78e3	8S	11	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
baadb7d0-6ea3-47fa-addf-29a51aafa2cb	8S	12	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
092f8f4c-43a2-4dc1-b6c3-120d77020129	8S	13	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
b6ac9bfa-47d6-44d6-9627-b16bb4da59dd	8S	14	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
97b132ed-f809-4232-966e-59227e7c5080	BR	1	PP-1750*2 Dtex-Sh Creme 2981 Hs	POIL	GRP-022	15.0000	Polypropylène	Cream	\N	1
579bd49a-505e-4e31-86d1-2f37054305d9	BR	2	PP-1750*2 Dtex-Sh Beige 44414 Hs	POIL	GRP-023	20.0000	Polypropylène	Beige	\N	1
0a9891e3-1a95-4fa7-8f02-73aca2218f57	BR	3	PP-1750*2 Dtex-Sh Brown 44415 Hs	POIL	GRP-024	25.0000	Polypropylène	Marron	\N	1
fa1c4417-867d-4ad2-adc5-73bbe39a64f3	BR	4	PES Sh-1500 Deniers-Beige Tex-7500 Text	POIL	GRP-027	10.0000	Polyester Fil Shrink	Beige	\N	1
9ec9b7b7-8d9f-4bc8-af06-ae113d2fc4e1	BR	5	PES Sh-1500 Deniers-VizonTex-7530 Text	POIL	GRP-082	16.0000	Polyester Fil Shrink	Vizon	\N	1
ce1753c2-ca61-45e1-91d3-39d3d50fdda6	BR	6	PES Sh-1500 Deniers-D.VizonTex-7521 Text	POIL	GRP-028	13.5000	Polyester Fil Shrink	Marron	\N	1
1ed0cc72-31a4-477b-8970-98620ac88ca9	BR	7	Jute 24/1	TRAME	GRP-086	100.0000	Jute	Beige	\N	1
17d0eceb-f435-4017-a189-34272fe70b73	BR	8	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
93288f4f-6b65-4e8e-844a-9d7bb820554e	BR	9	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
e0d3d906-033c-4483-9008-0cf3d7ee2546	BR	10	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
50ced888-f03a-4f9b-9952-1cb65631c86c	BR	11	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
f6bb1109-59a8-4723-b863-f6054974483b	BR	12	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
61e0341e-7c8e-4243-9f72-6b58b9daed9c	BR	13	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
3b630d12-5da4-4aaa-a20f-088469152680	BR	14	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
e84912eb-54d9-4999-8d9f-e0ff344a07c8	FB	1	PP FRZ-2900 Dtex-Gold 3423-Hs	POIL	GRP-001	8.0000	Polypropylène	Or	\N	1
c3fcf616-8474-4376-aaf9-14163174e3ff	FB	2	PP FRZ-2900 Dtex-Black 8001-Hs	POIL	GRP-002	3.0000	Polypropylène	Noir	\N	1
e9c26ed2-54ac-4fdc-9eb0-2d1561059193	FB	3	PP FRZ-2900 Dtex- Red 7612-Hs	POIL	GRP-003	20.0000	Polypropylène	Rouge	\N	1
f6b960e3-ed06-4f14-ac2a-1be831a0ec39	8M	15	PLA 45 CHE	PLAST	GRP-103	30.0000	Plastique	Blanc	\N	1
c268293a-2fff-4d6f-9f05-d77b468fac42	FB	4	PP FRZ-2900 Dtex-Beige 44360-Hs	POIL	GRP-005	20.0000	Polypropylène	Beige (C5S)	\N	1
71e7a273-4d25-4795-ba80-10558deaa0bc	FB	5	PP FRZ-2900 Dtex- Grey 8933-Hs	POIL	GRP-004	8.0000	Polypropylène	Gris Claire	\N	1
5bb7317f-e27b-4874-928e-1f04767ac646	FB	6	PP FRZ-2900 Dtex-Brown 44361-Hs	POIL	GRP-006	20.0000	Polypropylène	Marron (CMS)	\N	1
1b5d9af3-cec8-4632-b646-c1640a1629ea	FB	7	PP FRZ-2900 Dtex-Cream 44412-Hs	POIL	GRP-007	2.0000	Polypropylène	Cream	\N	1
759afacd-e223-4f4c-ab18-6d82822710b3	FB	8	PP FRZ-2900 Dtex-D.Green 5463-Hs	POIL	GRP-008	5.0000	Polypropylène	Vert Fonce	\N	1
7ea48be4-d1ad-4250-8b19-fb14a78e92d9	FB	9	PP FRZ-2900 Dtex-Navy 7062 -Oz	POIL	GRP-012	1.0000	Polypropylène	D.Turkoi	\N	1
2d545b92-7285-484f-b5af-2e3c4d971680	FB	10	PP FRZ-2900 Dtex-Pink 7639-Hs	POIL	GRP-011	1.0000	Polypropylène	Rose	\N	1
d8f10965-377b-4c6a-b633-8ac21056389c	FB	11	PP FRZ-2900 Dtex-D.Bleu 6417-Hs	POIL	GRP-012	1.0000	Polypropylène	Bleu Marine	\N	1
170de73d-858b-4850-ba4d-e7eb5e11a947	FB	12	PP FRZ-2900 Dtex-Grey 10575-Hs	POIL	GRP-009	9.5000	Polypropylène	Gris Mouchte	\N	1
5223e3fd-c832-4e44-a0f8-0ef2e1afba3e	FB	13	PP FRZ-2900 Dtex-Camel 44416-Hs	POIL	GRP-010	1.0000	Polypropylène	Camel	\N	1
e569315b-2638-4167-bfa6-d260d43fd926	FB	14	Jute 30/1	TRAME	GRP-085	100.0000	Jute	Beige	\N	1
742fe8dc-34c9-4375-9fc5-dc59c36d8121	FB	15	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
18e8a37e-13ae-42e6-b085-c3f5d7dffabd	FB	16	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
0c19c8f5-a2ec-4612-bb03-1beabdc906d8	FB	17	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
840e82b5-0b27-4f04-b4f0-402386e5f2e8	FB	18	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
b8644666-ab9a-4246-87b8-f790d982f336	FB	19	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
f414be5d-3c88-4a0c-ae1d-5e2ac6a15e5a	IS	1	PP FRZ-2900 Dtex-Black 8001-Hs	POIL	GRP-002	16.0000	Polypropylène	Noir	\N	1
31230914-a7cd-4041-a33f-d4e1d3884959	IS	2	PP FRZ-2900 Dtex-Gold 3423-Hs	POIL	GRP-001	9.0000	Polypropylène	Or	\N	1
65a07a4f-9f42-4d1a-8fcb-fbafda08579d	IS	3	PP FRZ-2900 Dtex- Red 7612-Hs	POIL	GRP-003	58.5000	Polypropylène	Rouge	\N	1
bc753842-f7c6-4e2f-8f20-ea1d295508c3	IS	4	PP FRZ-2900 Dtex-Beige 44360-Hs	POIL	GRP-005	16.0000	Polypropylène	Beige (C5S)	\N	1
be2a4c42-eac0-42e1-a455-3e5981c4c75f	IS	5	Jute 12/1	TRAME	GRP-087	100.0000	Jute	Beige	\N	1
69790539-ef99-45c4-bcad-3ca1683a4287	IS	10	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
bbe408da-f303-4cab-b455-0d53fea77311	IS	11	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
9473e0e2-21b4-4934-86d9-a0fb5ad2197d	IS	12	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
d20680a5-2e8f-41d2-98e0-2e8188f82b4c	IS	13	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
2a3dbc61-549f-4e85-bc0a-410ac78330a4	IS	14	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
de1f2cc6-076d-4085-a520-4762eeca0bdb	LH	1	PES Sh -1200 Deniers-Cream B Cp-1005Turk	POIL	GRP-029	23.0000	Polyester Fil Shrink	Cream B	\N	1
aff052d7-87ea-44d5-bd1f-1b0acc95337d	LH	2	PES Sh -1200 Deniers-Cream Cb-1426 Turk	POIL	GRP-030	23.0000	Polyester Fil Shrink	Beige	\N	1
c75ded86-d789-4aad-9efd-25c8c44e51e7	LH	3	PES-1500 Deniers-Gold Cb-4016 Sf	POIL	GRP-025	8.5000	Polyester Fil Poil	Or	\N	1
810b610e-ff75-4729-8bc7-a368e33de2c8	LH	4	PES -1500 Deniers-D.Bleu 1271-Gzm	POIL	GRP-033	10.0000	Polyester Fil Poil	Bleu Marine	\N	1
561c6420-f3f1-42d1-aa27-61793204fc4a	LH	5	PES -1500 Deniers-L.Beige 1273-Gzm	POIL	GRP-034	15.0000	Polyester Fil Poil	L.Beige	\N	1
2dfc07d1-643b-4dd4-9e41-017d21aad169	LH	6	PES -1500 Deniers-Green 1272-Gzm	POIL	GRP-035	10.0000	Polyester Fil Poil	Vert	\N	1
a088e98a-14e8-4855-9584-4deae0c78985	LH	7	PES -1500 Deniers-Grey 1274-Gzm	POIL	GRP-036	10.0000	Polyester Fil Poil	Gris	\N	1
07a33477-0d8f-4344-a20d-09f33a63b2ca	LH	8	Jute 30/1	TRAME	GRP-085	100.0000	Jute	Beige	\N	1
333abf0f-b596-409c-b720-dd2faa58742a	LH	9	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
72ba573e-9fd1-4214-98c2-13f1d2f93bf7	LH	10	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
21fce075-5588-4bff-ad8b-92a084f58969	LH	14	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
d0029ad6-c660-4acc-bbd3-f61ef5f40139	LH	15	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
0f69a003-b156-4ebc-9f0e-e7853bad631b	LH	16	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
136cf189-a197-468e-a595-571b24fce68b	LP	1	PES Sh -1200 Deniers-Cream B Cp-1005Turk	POIL	GRP-029	12.0000	Polyester Fil Shrink	Cream B	\N	1
378c3919-bfcf-4740-8ac9-74a7fd653a7b	LP	2	PP-1500 Dtex-Yellow 3430-Hs	POIL	GRP-016	0.5000	Polypropylène	Or	\N	1
5adf3e83-2db7-4cde-a696-d413bf3b6572	LP	3	PP-1500 Dtex-Pink 7623-Hs	POIL	GRP-021	1.0000	Polypropylène	Rose	\N	1
e19919ac-35bf-489a-9dac-b279ebc93284	LP	4	PP-1500 Dtex-D.Bleu 6665-Hs	POIL	GRP-017	6.0000	Polypropylène	Bleu Marine	\N	1
c4dde3d4-1e1d-4477-bdb1-c07841621941	LP	5	PP-1500 Dtex-Cream 2951-Hs	POIL	GRP-018	25.0000	Polypropylène	C5N	\N	1
94ed460f-1803-4504-a2a9-d34c8d6e9176	LP	6	PP-1500 Dtex-L.Beige 44377-Hs	POIL	GRP-020	20.0000	Polypropylène	L.Beige	\N	1
3a95b346-65cf-4605-a779-b8487dbf0e37	LP	7	PES -1200 Deniers-Anty Bordeau 61043-Gzm	POIL	GRP-031	35.0000	Polyester	Rouge	\N	1
f609c207-0f31-4567-b7cd-61c8e60061c1	LP	8	PES-Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
11d9b421-7ee9-42a2-a2e9-7d2eb314b940	LP	12	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
769e8589-c68d-4281-bf73-c17827789bab	LP	13	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
cfac76ba-2d9a-46d1-988b-9806fcd2a8c8	LP	14	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
c3b71d7d-93fd-45db-bc71-96dcfa401d04	LP	15	Jute 9,6/1	TRAME	GRP-087	17.0000	Jute	Beige	\N	1
1a6ea63a-f9af-4f1e-b634-42f46de7a985	LP	16	Jute 24/1	TRAME	GRP-086	83.0000	Jute	Beige	\N	1
8dfc289b-0110-436c-b655-7f73df6a4405	LP	17	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
e4711e9b-2f15-47a5-8864-becb205b657d	LP	18	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
64ca03c2-1848-4ef8-b808-86f79a421ab6	LP	19	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
12a77211-9450-4660-8260-0305178c09d4	MF	1	PP FRZ-2900 Dtex-Gold 3423-Hs	POIL	GRP-001	9.5000	Polypropylène	Or	\N	1
2ec63241-4589-4fef-b64c-5c7de0ccb584	MF	2	PP FRZ-2900 Dtex-Black 8001-Hs	POIL	GRP-002	15.0000	Polypropylène	Noir	\N	1
4972232e-12cd-4c9f-a6e8-6f505ca9429e	MF	3	PP FRZ-2900 Dtex- Red 7612-Hs	POIL	GRP-003	51.0000	Polypropylène	Rouge	\N	1
4fae2977-6dec-46f9-a0c8-e428375b9b3a	MF	4	PP FRZ-2900 Dtex-Cream 44412-Hs	POIL	GRP-007	18.0000	Polypropylène	Cream	\N	1
380c3c29-55ff-45c1-a3d9-0eb3d1ff16d0	MF	5	PP FRZ-2900 Dtex-D.Green 5463-Hs	POIL	GRP-008	2.0000	Polypropylène	Vert Fonce	\N	1
640b201b-20ce-44fe-905d-aca3d561d89b	MF	6	PP FRZ-2900 Dtex-Grey 10575-Hs	POIL	GRP-009	2.0000	Polypropylène	Gris Mouchte	\N	1
d2ede22f-212d-4101-9abf-2642ce4016f2	MF	7	PP FRZ-2900 Dtex-D.Bleu 6417-Hs	POIL	GRP-012	2.0000	Polypropylène	Bleu Marine	\N	1
7cf65d98-7d32-46aa-af47-68585204645a	MF	8	Jute 24/1	TRAME	GRP-086	100.0000	Jute	Beige	\N	1
c37c6123-6a76-45c5-adc3-c876b53396ba	MF	9	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
ef7b51f2-f8e0-4006-af4a-336462303bdb	MF	10	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
baf57b10-3f0a-4a31-97c5-471c36b03aa9	MF	11	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
f06d9e8d-4523-4dc4-a197-a54cb88f46e3	MF	12	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
898517cc-ca34-4611-9b30-ed38aefc4787	MF	13	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
31e670a2-0881-49c3-ac24-eb960554c6ef	MN	1	PES Sh-1500 Deniers-Cream H-1008-Tat	POIL	GRP-026	33.5000	Polyester Fil Shrink	Cream	\N	1
32b6c035-bc9b-40a3-97a1-126f81fa2f3b	MN	2	PES Sh-1500 Deniers- L.Beige H-2000-Tat	POIL	GRP-027	12.0000	Polyester Fil Shrink	Beige	\N	1
c59b0ebf-30c2-4d06-a1be-9f209442a421	MN	3	PES Sh-1500 Deniers-Beige H-2001-Tat	POIL	GRP-048	6.0000	Polyester Fil Shrink	Beige Fonce	\N	1
1252da0c-f07a-489b-aaec-e5da78b268d1	MN	4	PP-1000*2 Dtex-Cream Mn-1201-Tat	POIL	GRP-054	35.0000	Polypropylène	Cream	\N	1
6ba2fe39-2d22-4b81-bfd7-038fd30b9e8e	MN	5	PP-1000*2 Dtex-Beige Mn-3203 L-Tat	POIL	GRP-055	13.0000	Polypropylène	L.Beige	\N	1
13a6c343-a588-4fea-baac-bf6a3fbb2de7	MN	10	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
36325749-ef45-4506-927d-0fa4c2c979f8	MN	11	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
b3b2fe45-7aa5-4917-8d6b-4f7b56637ef6	MN	12	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
43487df7-3e55-4521-a958-891d88aa71a3	MN	13	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
10df3901-f5bb-473f-89a2-a4d7a5078c1f	MN	14	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
64cb5fa2-54e8-466b-b679-6bfda49614d1	MN	15	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
a1927863-2994-4169-af83-cd01219d9435	MN	16	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
4eae8eb6-6616-43d1-962b-19f6bebc32c7	MN	17	Jute 24/1	TRAME	GRP-086	83.0000	Jute	Beige	\N	1
48a14645-6aab-43c5-8d54-4ff520c145fa	MN	18	Jute 9,6/1	TRAME	GRP-087	17.0000	Jute	Beige	\N	1
fb3a7c2a-eafc-4889-8935-95c04cdd9538	MP	1	PP-1500 Dtex-Yellow 3430-Hs	POIL	GRP-016	0.5000	Polypropylène	Or	\N	1
445b705d-5cd1-4574-afae-ab9788b68525	MP	2	PP-1500 Dtex-D.Bleu 6665-Hs	POIL	GRP-017	6.0000	Polypropylène	Bleu Marine	\N	1
e5d68c07-5464-4c77-81eb-be9837c89a17	MP	3	PP-1500 Dtex-Cream 2951-Hs	POIL	GRP-018	25.0000	Polypropylène	C5N	\N	1
976ca058-bffa-48da-82fa-2b72248d96a3	MP	4	PP-1500 Dtex-L.Beige 44377-Hs	POIL	GRP-020	20.0000	Polypropylène	L.Beige	\N	1
6de64ff6-f181-4938-b34c-f0b1f965d878	MP	5	PP-1500 Dtex-Pink 7623-Hs	POIL	GRP-021	1.0000	Polypropylène	Rose	\N	1
14d7317f-6051-4500-af96-24e3b3c8226d	MP	6	PES Sh -1200 Deniers-Cream B Cp-1005Turk	POIL	GRP-029	12.0000	Polyester Fil Shrink	Cream B	\N	1
ce09b8ef-0a11-4ba9-b62b-bed4e3f77691	MP	7	PES -1200 Deniers-Anty Bordeau 61043-Gzm	POIL	GRP-031	35.0000	Polyester	Rouge	\N	1
85411f87-dcb2-492d-b475-89ad3d077ae5	MP	8	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
4e944d93-9381-4607-958e-10eb7377f368	MP	9	Jute 24/1	TRAME	GRP-086	83.0000	Jute	Beige	\N	1
140dd7d4-232e-4d73-a01e-2b16661634dd	MP	10	Jute 9,6/1	TRAME	GRP-087	17.0000	Jute	Beige	\N	1
e91a72d0-7fa2-4d61-98b2-d3de6aa034b6	MP	11	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
0dfe4966-3e40-4ee6-a679-440cf5d4ecc4	MP	12	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
d82f5ac5-e313-42aa-a942-f7102373b5fa	MP	13	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
c4118832-b694-4c01-abea-01ddefc9ef98	MP	14	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
ab0cc3eb-ffb5-4a5c-b338-e434e9e9a022	MP	15	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
983e356b-f307-4df8-b2de-db07702b0425	MP	16	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
48800f07-afea-40e6-ac39-e3019b97410c	PS	1	PES-3000 Deniers- Seker Cream Ssl2081-Suj	POIL	GRP-059	28.0000	Polyester	Cream	\N	1
7d1791dd-2714-45da-85bb-fd8d2a030847	PS	2	PES-3000 Deniers- Dark Grey Ssl2069-Suj	POIL	GRP-060	32.0000	Polyester	Grris	\N	1
dd0fa80a-1b7e-4b54-bdd2-bf627bb7e0e3	PS	3	PES-3000 Deniers- Vison Ssl2247-Suj	POIL	GRP-061	21.0000	Polyester	Vison	\N	1
03d6e623-cdcd-4936-95b8-efe2685dd1d1	PS	4	PES-3000 Deniers- WhiteSsl2331-Suj	POIL	GRP-062	5.0000	Polyester	Blanc	\N	1
f207e8af-9e2e-4b7e-b13b-c6c87718477e	PS	5	PES-3000 Deniers- Khave Ssl2279-Suj	POIL	GRP-065	4.5000	Polyester	Khave	\N	1
145d163c-ab3d-4bb1-ad2d-27aa5b28f0bf	PS	6	PES-3000 Deniers- Bleu Ssl2244-Suj	POIL	GRP-068	9.0000	Polyester	Bleu	\N	1
7e784d63-8100-4852-8bdf-2fe422291ee1	PS	7	Jute 20/2	TRAME	GRP-090	100.0000	Jute	Beige	\N	1
0c9f669c-0166-4c87-8973-122a9f4b03d1	PS	10	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
fec2d3ff-c5b7-4b5e-b5a5-80dcd00886a6	PS	11	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
eca4962a-6210-477a-a75c-693367ada3f9	PS	12	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
1ab6a9bf-370c-4f44-ab4c-b55e17da5bf2	PS	13	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
a8966ad6-c0a8-4735-b84b-1a9c0184272f	PS	14	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
4a324832-f4be-426d-bee3-5414b727de9f	SH	1	PP-1500 Dtex-Yellow 3430-Hs	POIL	GRP-016	6.4000	Polypropylène	Or	\N	1
0dcd8510-5a98-4e21-a6b2-bbb8bd3d95b6	SH	2	PP-1500 Dtex-D.Bleu 6665-Hs	POIL	GRP-017	8.6000	Polypropylène	Bleu Marine	\N	1
fd3485f3-b99a-4fae-ad88-03c4d405eb1b	SH	3	PP-1500 Dtex-Cream 2951-Hs	POIL	GRP-018	1.5000	Polypropylène	C5N	\N	1
5be203c7-88ea-423c-ade7-44021bce8791	SH	4	PP-1500 Dtex-Bleu 6666-Hs	POIL	GRP-019	8.6000	Polypropylène	Bleu	\N	1
f0d78c1c-3c4b-4ec3-9580-43f6ce1441d4	SH	5	PP-1500 Dtex-L.Beige 44377-Hs	POIL	GRP-020	7.0000	Polypropylène	L.Beige	\N	1
985d234b-d8ba-43ff-a346-3f7f5fe5176f	SH	6	PP-1500 Dtex-Pink 7623-Hs	POIL	GRP-021	5.0000	Polypropylène	Rose	\N	1
9fc7ea62-ad11-4c2a-a670-cc0d4a2aeec7	SH	7	PES -1200 Deniers-Anty Bordeau 61043-Gzm	POIL	GRP-031	44.4000	Polyester	Rouge	\N	1
29add5e6-7ffc-4125-a9f9-1c9d22ba1d2b	SH	8	PES Sh -1200 Deniers-Cream B Cp-1005Turk	POIL	GRP-029	18.0000	Polyester Fil Shrink	Cream B	\N	1
f001cf8b-76d4-4078-9077-bd668151f27a	SH	9	Jute 9,6/1	TRAME	GRP-087	100.0000	Jute	Beige	\N	1
2b5d8114-36f8-4873-b6c2-e0d207be6829	SH	13	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
ac7d1207-cb1d-4ecd-8824-b88462cc7b29	SH	14	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
e8e74a51-c4f9-4e7e-8fd4-82f7fa6dcb1a	SH	15	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
0b2ce910-bfd0-4734-8521-382e8e907a0a	SH	16	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
2182eb98-f77b-468f-922c-141e7c1d539d	SH	17	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
be9b9715-380c-4ca3-b98a-4dc16508fedf	SH	18	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
12739233-e643-4006-8239-1da45927b11a	SH	19	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
fe7dab06-05af-459a-be06-ff22f2f5c9f0	SL	1	PP-1775*2 Dtex-White 1073-Tat	POIL	GRP-051	35.0000	Polypropylène	Blanc	\N	1
565f5676-68dd-4809-9c9e-d0a66819ae03	SL	2	PP-1775*2 Dtex-Cream 1072-Tat	POIL	GRP-052	25.0000	Polypropylène	Cream	\N	1
65f87766-f9bf-4574-b993-a710c26c4a54	MP	17	PLA 50 EXT	PLAST	GRP-104	35.0000	Plastique	Blanc	\N	1
bb29194d-1622-4cbc-b98b-f29a8723338e	SL	4	Micro PES-3600 Deniers Ivory 15-Tat	POIL	GRP-050	20.0000	Polyester	Blanc	\N	1
ed1c0877-5332-45c8-8037-79a55b248336	SL	5	Jute 24/1	TRAME	GRP-086	100.0000	Jute	Beige	\N	1
60d7a313-338e-4106-a6a4-10ac3819e327	SL	10	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
2f98f275-99f7-47fe-8d95-d75df740211e	SL	11	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
cf09a3f5-d870-4ad6-9906-3dc7ff58dd37	SL	12	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
220b74f7-1e8d-481e-9f25-97a73f78f958	SL	13	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
698966e4-c8c2-4b09-8955-17a48ff59ddb	SL	14	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
378023b0-7393-497f-b462-50a233b90c68	SL	15	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
1c4fdab1-e7a2-4bb6-baa6-00f56618e434	SL	16	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
d55c7549-76b7-4bf7-b6c0-fbfb584c91c9	SL	17	PES Ver-1500 Deniers-TerraTex-8000 Text	POIL	GRP-083	7.0000	Polyester	Brique	\N	1
dd41b42b-5adb-463f-9e61-782c89db1980	TN	1	PES Sh -1200 Deniers-Cream B Cp-1005Turk	POIL	GRP-029	19.5000	Polyester Fil Shrink	Cream B	\N	1
645f2ff7-0b81-4e42-93a9-abd70666b9a2	TN	2	PES Sh -1200 Deniers-Cream Cb-1426 Turk	POIL	GRP-030	20.0000	Polyester Fil Shrink	Beige	\N	1
730e21df-ce72-4437-bab5-c133abdc6c13	TN	3	PP FRZ-2900 Dtex-Cream 44412-Hs	POIL	GRP-007	60.0000	Polypropylène	Cream	\N	1
3c79221d-b598-40b1-88a9-a825603c34a8	TN	4	Jute 30/1	TRAME	GRP-085	100.0000	Jute	Beige	\N	1
73c60a9d-d0c1-4a11-9fc3-de9b48b54a4d	TN	5	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
49b5c1df-52dc-4702-9b86-0dec4be11639	TN	6	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
008f50d9-def6-49e1-9e5e-e21c16b29cac	TN	7	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
93e90b08-e40e-45ec-9a83-26d3f16b2511	TN	8	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
d888ae6a-40a0-467d-b3fd-1827f6446487	TN	9	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
22c05cca-6931-4df8-8654-ae52c4a1eb7f	TN	10	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
e573ddd8-604b-429d-82c9-8fd9f3a0ec55	TN	11	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
bdfab1de-0b12-41b9-b45c-41b5dbfbff0d	YF	1	PP-1900 Dtex- Cream 2951-Hs	POIL	GRP-013	30.0000	Polypropylène	C5N	\N	1
71743a19-037d-4464-bae8-0c27d58cf2f2	YF	2	PP-1900 Dtex-L.Beige 44377-Hs	POIL	GRP-014	30.0000	Polypropylène	Taupe	\N	1
df60917f-f64b-47d3-9862-fdf0248900df	YF	3	PES Sh -1200 Deniers-Cream B Cp-1005Turk	POIL	GRP-029	20.0000	Polyester Fil Shrink	Cream B	\N	1
81661ccf-013e-4189-82b7-b1a60db1d2a9	YF	4	PES Sh -1200 Deniers-Cream Cb-1426 Turk	POIL	GRP-030	19.5000	Polyester Fil Shrink	Beige	\N	1
c6995ab2-2f33-4acb-9a16-d3a4d1674da8	YF	5	Jute 24/1	TRAME	GRP-086	100.0000	Jute	Beige	\N	1
a214b516-fbdd-4c9e-9560-6cb7048efb7f	YF	6	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
bc058231-7466-467f-9583-f5df27c723e6	YF	7	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
36e04f17-852a-43e7-b94d-7dee7239a752	YF	8	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
50c4d5a8-441c-492e-933d-30037a49d65c	YF	9	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
2fb97d7f-a456-4b24-a1f6-b8d2a40a3e09	YF	10	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
e6c9768a-dd96-48c5-a987-74bc6dc66a9b	YH	1	PP-1750*2 Dtex-Sh Creme 2981 Hs	POIL	GRP-022	24.5000	Polypropylène	Cream	\N	1
ccd28634-6a2c-4ddc-a0f0-08c0c451e868	YH	2	PP-1750*2 Dtex-Sh Beige 44414 Hs	POIL	GRP-023	35.0000	Polypropylène	Beige	\N	1
97b84302-906f-4ba3-8957-b6e210503222	YH	3	PP-1750*2 Dtex-Sh Brown 44415 Hs	POIL	GRP-024	40.0000	Polypropylène	Marron	\N	1
c699a807-2263-432e-86b8-68ae6fed98ee	YH	6	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
f4349384-b0ee-4f9e-aded-53235fd39192	YH	7	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
c2e696c0-c143-4e10-9f6d-139332ca476e	YH	8	Jute 24/1	TRAME	GRP-086	100.0000	Jute	Beige	\N	1
e5e3b0aa-3f72-4e51-8d21-77053d60fa5b	YH	9	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
487e3c69-4a85-4520-b82e-8ccfe4e9e798	YH	10	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
e76f07d2-882b-4726-8249-6ebeee4291b5	YH	11	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
5952d22f-9a43-4c9b-85a2-7d63de4c23c2	YH	12	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
a7dd8ec0-45c4-4037-8fec-ec3b9759e698	YH	13	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
3a3f3780-8708-4c55-b4c3-693c69cbd99e	YL	1	Micro PES-7360 Deniers-Multi Beige 1305-129-Suj	POIL	GRP-069	60.0000	Polyester	Beige	\N	1
6a08b99c-0e3e-4db8-b423-030004a4c718	YL	2	Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj	POIL	GRP-070	38.5000	Polyester	L.Beige	\N	1
10eda740-ab36-4970-a4de-445dc8290c45	YL	3	Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj	POIL	GRP-071	1.0000	Polyester	L.Brown	\N	1
ac234930-d442-430c-8126-529105e39a6a	YL	4	Jute 20/2	TRAME	GRP-090	100.0000	Jute	Beige	\N	1
e171d466-5046-435a-ac52-108a5849c62f	YL	6	Hotmelt	COLLE	GRP-100	5.0000	SBR	Blanc	\N	1
07fb35f9-9ccd-4220-99f7-839aba3cd294	YL	7	SBR 821	COLLE	GRP-099	95.0000	SBR	Blanc	\N	1
d3d774ce-5fcc-4d7e-aa19-c8c9986e3001	YL	8	Cuir	CUIR	GRP-098	100.0000	Simili Cuir	Noir	\N	1
9295d003-2317-4af5-99ea-0e89f3971dde	YL	9	Bande	RUBAN	GRP-097	100.0000	Laine	Beige	\N	1
a0e79fd5-6457-43d8-9513-f7776c4ea7ff	YL	10	PES Nylon	POIL	GRP-095	0.5000	Polyester	Blanc	\N	1
b7036f4e-8d1b-4765-ab0e-8c8ee7258f73	YL	11	PES-20/2 LOMAT	CHAINE	GRP-091	62.0000	Polyester Chaîne	Blanc	\N	1
0b814696-c635-48d4-90c8-d288c615fddb	YL	12	PES-20/4 LOMAT	CHAINE	GRP-092	38.0000	Polyester Chaîne	Blanc	\N	1
27da5909-42fa-463f-adf7-e9f0efb0bf4f	YL	5	PLA 140 CHE	PLAST	GRP-108	100.0000	Plastique	Blanc	\N	1
\.


ALTER TABLE public.recette ENABLE TRIGGER ALL;

--
-- Data for Name: reference_groupe_equiv; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.reference_groupe_equiv DISABLE TRIGGER ALL;

COPY public.reference_groupe_equiv (id_ref_grp, code_reference, code_groupe_equiv, priorite, est_preferentielle, date_debut, date_fin, actif) FROM stdin;
7ed7eec2-8fc4-4115-9021-dccd7185e096	Micro PES-3600 Deniers Shade 25-Tat	GRP-049	1	1	2026-09-04T19:10:33.934Z	\N	1
499b9ddd-c290-4458-a8ad-cd7c4cdcc0d9	PLA 140 EXT	GRP-108	1	1	2026-09-04T19:10:33.934Z	\N	1
a1a074d0-d28b-4e48-98b4-4ba5d95f757c	PLA 35 EXT	GRP-102	1	1	2026-09-04T19:10:33.934Z	\N	1
1a13edaf-0720-4a16-8b33-5ef3aab88ff4	PLA 45 EXT	GRP-103	1	1	2026-09-04T19:10:33.934Z	\N	1
6053f248-b4a6-4fdb-9ae4-c641e2817964	PLA 50 EXT	GRP-104	1	1	2026-09-04T19:10:33.934Z	\N	1
8c982bfe-8504-4bd7-ae7c-1ada4190492e	PLA 65 EXT	GRP-105	1	1	2026-09-04T19:10:33.934Z	\N	1
02395a60-c306-41ea-8cf4-d398329d2ed8	PLA 80 EXT	GRP-106	1	1	2026-09-04T19:10:33.934Z	\N	1
f2d13553-e3af-4638-b5da-db6527e13160	PLA 100 CHE	GRP-107	2	0	2026-09-04T19:10:33.934Z	\N	1
175b9afb-86c1-4357-a69c-6bc6b162251c	PLA 140 CHE	GRP-108	2	0	2026-09-04T19:10:33.934Z	\N	1
72aea708-c2ab-4f1f-8f25-827743403772	PLA 35 CHE	GRP-102	2	0	2026-09-04T19:10:33.934Z	\N	1
6165ab73-c83d-4155-ac85-244a91481e87	PLA 45 CHE	GRP-103	2	0	2026-09-04T19:10:33.934Z	\N	1
f07e67be-addf-456d-b869-078141c1fe3d	PLA 50 CHE	GRP-104	2	0	2026-09-04T19:10:33.934Z	\N	1
6ddb24b0-8574-4cdb-b139-76808dccc068	PLA 65 CHE	GRP-105	2	0	2026-09-04T19:10:33.934Z	\N	1
6b40575e-4f4b-455d-bb0b-1cd9f2906640	PLA 80 CHE	GRP-106	2	0	2026-09-04T19:10:33.934Z	\N	1
764ce910-0ae9-4e63-83a2-f129c8651a6b	PP FRZ-2900 Dtex-Gold 3423-Hs	GRP-001	1	1	2026-09-04T19:10:33.934Z	\N	1
3b053037-d774-4871-8c78-12a2ab961a26	PP FRZ-2900 Dtex-Gold 3034-Oz	GRP-001	2	0	2026-09-04T19:10:33.934Z	\N	1
f1fce094-3b8a-4fec-b679-d21798e27a35	PP FRZ-2900 Dtex-Black 8001-Hs	GRP-002	1	1	2026-09-04T19:10:33.934Z	\N	1
a68f620a-63e1-4234-8f53-d28a63f7cb86	PP FRZ-2900 Dtex-Black 9000-Oz	GRP-002	2	0	2026-09-04T19:10:33.934Z	\N	1
be4c3717-c95a-462e-b1d7-bf664377951e	PP FRZ-2900 Dtex- Red 7612-Hs	GRP-003	1	1	2026-09-04T19:10:33.934Z	\N	1
97ee7e3a-448a-435c-ae27-5d142b88ffe2	PP FRZ-2900 Dtex- Red 5001-Oz	GRP-003	2	0	2026-09-04T19:10:33.934Z	\N	1
5c028ebd-33e2-4e67-a03a-01b09b6f2677	PP FRZ-2900 Dtex- Grey 8933-Hs	GRP-004	1	1	2026-09-04T19:10:33.934Z	\N	1
5444b224-be97-4948-b75f-a74d187486ad	PP FRZ-2900 Dtex- Grey 9095-Oz	GRP-004	2	0	2026-09-04T19:10:33.934Z	\N	1
f354fb00-9ed4-4ecb-af6e-cb322b67f1f9	PP FRZ-2900 Dtex-Beige 44360-Hs	GRP-005	1	1	2026-09-04T19:10:33.934Z	\N	1
2d20232d-a8f1-4a84-bc72-533751b784b6	PP FRZ-2900 Dtex-Beige 2204-Oz	GRP-005	2	0	2026-09-04T19:10:33.934Z	\N	1
5b7a5cf9-a3e7-45e1-a2f6-e8fbfc7df162	PP FRZ-2900 Dtex-Brown 44361-Hs	GRP-006	1	1	2026-09-04T19:10:33.934Z	\N	1
de8cc9ae-f318-48bd-b949-55b24b211c3b	PP FRZ-2900 Dtex-Brown 6161-Oz	GRP-006	2	0	2026-09-04T19:10:33.934Z	\N	1
c654d8fc-9df3-4efb-b334-0be966bd2af2	PP FRZ-2900 Dtex-Cream 44412-Hs	GRP-007	1	1	2026-09-04T19:10:33.934Z	\N	1
e724b125-fc51-47f1-af88-467c6afc074e	PP FRZ-2900 Dtex-Cream 1104-Tat	GRP-007	2	0	2026-09-04T19:10:33.934Z	\N	1
ec41742f-1c21-45cd-a5c5-276a95fe23f0	PP FRZ-2900 Dtex-D.Green 5463-Hs	GRP-008	1	1	2026-09-04T19:10:33.934Z	\N	1
7eeea279-8f26-4a2e-8ee0-09981ca43490	PP FRZ-2900 Dtex-A/Green 8068-Oz	GRP-008	2	0	2026-09-04T19:10:33.934Z	\N	1
2de94503-7be6-4d06-b570-853a5deb782b	PP FRZ-2900 Dtex-Grey 10575-Hs	GRP-009	1	1	2026-09-04T19:10:33.934Z	\N	1
3cbf878a-0735-4500-8a0b-f16715590b82	PP FRZ-2900 Dtex-Camel 44416-Hs	GRP-010	1	1	2026-09-04T19:10:33.934Z	\N	1
5dd38977-10e9-44a0-97bd-46509f3b16fa	PP FRZ-2900 Dtex-Pink 7639-Hs	GRP-011	1	1	2026-09-04T19:10:33.934Z	\N	1
de142071-4e64-4f01-8397-6750b908dbdf	PP FRZ-2900 Dtex-D.Bleu 6417-Hs	GRP-012	1	1	2026-09-04T19:10:33.934Z	\N	1
a8aec470-467f-46a2-8f99-6c27323f1b1c	PP FRZ-2900 Dtex-Navy 7062 -Oz	GRP-012	2	0	2026-09-04T19:10:33.934Z	\N	1
74bb8010-7855-4c39-b00e-c070fd71ad99	PP-1900 Dtex- Cream 2951-Hs	GRP-013	1	1	2026-09-04T19:10:33.934Z	\N	1
e052a68f-a7f1-44dd-9830-d17a1dee5508	PP-1900 Dtex-L.Beige 44377-Hs	GRP-014	1	1	2026-09-04T19:10:33.934Z	\N	1
1ebc5260-aba5-412e-be21-2ca990f8a891	PP-1900 Dtex-D.Green 5455-Hs	GRP-015	1	1	2026-09-04T19:10:33.934Z	\N	1
5306529a-3286-47ed-b398-4b5f3ce670e0	PP-1500 Dtex-Yellow 3430-Hs	GRP-016	1	1	2026-09-04T19:10:33.934Z	\N	1
d40a4215-0ac2-4d35-ab86-01a61f5dfeaa	PP-1500 Dtex-Yellow 3151-Oz	GRP-016	2	0	2026-09-04T19:10:33.934Z	\N	1
5a2af35b-a2b3-4978-be3e-ccbbf40d76b8	PP-1500 Dtex-D.Bleu 6665-Hs	GRP-017	1	1	2026-09-04T19:10:33.934Z	\N	1
00aee4af-6f08-48bb-9d21-ff29ce4e7dbb	PP-1500 Dtex-D.Bleu 7200-Oz	GRP-017	2	0	2026-09-04T19:10:33.934Z	\N	1
d65ca041-9e2d-47b4-8e23-d94ca6365d02	PP-1500 Dtex-Cream 2951-Hs	GRP-018	1	1	2026-09-04T19:10:33.934Z	\N	1
668d34ff-6969-45fa-9159-2f2236aeac4b	PP-1500 Dtex-L.Beige 44377-Hs	GRP-020	1	1	2026-09-04T19:10:33.934Z	\N	1
cb02f439-4b14-4862-9ad7-da42d5a44858	PP-1500 Dtex-Pink 7623-Hs	GRP-021	1	1	2026-09-04T19:10:33.934Z	\N	1
1272fbc7-def3-4eb0-8593-3dcf4a260d1c	PP-1750*2 Dtex-Sh Creme 2981 Hs	GRP-022	1	1	2026-09-04T19:10:33.934Z	\N	1
e5551837-0f75-4ee7-af1f-f40e298d5b6c	PP-1750*2 Dtex-Sh Beige 44414 Hs	GRP-023	1	1	2026-09-04T19:10:33.934Z	\N	1
b3173118-3d70-4762-a19f-f58debc8a5cc	PP-1750*2 Dtex-Sh Brown 44415 Hs	GRP-024	1	1	2026-09-04T19:10:33.934Z	\N	1
ca437a62-4516-4561-9652-abc925164897	PES-1500 Deniers-Gold Cb-4016 Sf	GRP-025	1	1	2026-09-04T19:10:33.934Z	\N	1
211c55d3-4d05-46f4-8846-b3da0160e43e	PES Sh-1500 Deniers-Cream H-1008-Tat	GRP-026	1	1	2026-09-04T19:10:33.934Z	\N	1
d5b5a15f-3999-4f4e-a088-7604a7ddf938	PES Sh-1500 Deniers-Vizon Cp-2018 Sf	GRP-026	2	0	2026-09-04T19:10:33.934Z	\N	1
76db28a3-eac7-4443-b1db-eae935379664	PES Sh-1500 Deniers- L.Beige H-2000-Tat	GRP-027	1	1	2026-09-04T19:10:33.934Z	\N	1
3674964b-76ca-4bf8-941b-f4570f3ac1be	PES Sh-1500 Deniers-Beige Cp-2039 Sf	GRP-027	2	0	2026-09-04T19:10:33.934Z	\N	1
bb3ff780-3e44-41f6-9648-b0f4cc82f4e5	PES Sh-1500 Deniers-Beige Tex-7500 Text	GRP-027	3	0	2026-09-04T19:10:33.934Z	\N	1
2bef3612-736c-4fd6-a52f-f30c1974a1ab	PES Sh-1500 Deniers-D.Vizon Cp-2068 Sf	GRP-028	1	1	2026-09-04T19:10:33.934Z	\N	1
ffda5a7a-29b1-462c-89dc-e43d4c411ce5	PES Sh-1500 Deniers-D.VizonTex-7521 Text	GRP-028	2	0	2026-09-04T19:10:33.934Z	\N	1
4c3a348f-9eae-44ee-8497-ea1ebb5471cc	PES Sh -1200 Deniers-Cream B Cp-1005Turk	GRP-029	1	1	2026-09-04T19:10:33.934Z	\N	1
29bba05b-db67-4d90-8277-c302898d091d	PES Sh-1200 Deniers- Cream Dtbc-H69-Gzm	GRP-029	2	0	2026-09-04T19:10:33.934Z	\N	1
acaf18a2-edcd-47b1-9d87-1b757b6d398d	PES Sh-1200 Deniers-Cream B-Cb -1005 Sf	GRP-029	3	0	2026-09-04T19:10:33.934Z	\N	1
9493f165-ed53-460d-8d7c-f38ee51a91e5	PES Sh -1200 Deniers-Cream Cb-1426 Turk	GRP-030	1	1	2026-09-04T19:10:33.934Z	\N	1
6f8ad431-dd07-4160-9ace-ac4ebe27abea	PES Sh-1200 Deniers-Beige Cp-1432 Sf	GRP-030	2	0	2026-09-04T19:10:33.934Z	\N	1
21aaf2d8-dbe1-411b-94d8-af7f8f5d9a1d	PES -1200 Deniers-Anty Bordeau 61043-Gzm	GRP-031	1	1	2026-09-04T19:10:33.934Z	\N	1
d2d1a053-c7ef-4316-a2ea-64243c22b5df	PES -1500 Deniers-Bordeau 61043-Gzm	GRP-032	1	1	2026-09-04T19:10:33.934Z	\N	1
e14ba059-9ffd-4875-8c7a-eae9d45a9c0e	PES -1500 Deniers-D.Bleu 1271-Gzm	GRP-033	1	1	2026-09-04T19:10:33.934Z	\N	1
1fc98e10-40ce-4267-960e-255e9c4fe92a	PES -1500 Deniers-L.Beige 1273-Gzm	GRP-034	1	1	2026-09-04T19:10:33.934Z	\N	1
2904d027-2890-4073-80e4-c395cf845ca7	PES -1500 Deniers-Green 1272-Gzm	GRP-035	1	1	2026-09-04T19:10:33.934Z	\N	1
aa155e2a-73eb-434a-a515-9f715493639b	PES -1500 Deniers-Grey 1274-Gzm	GRP-036	1	1	2026-09-04T19:10:33.934Z	\N	1
8779f243-0039-4edb-9369-b46b94eb3f61	PES Fdy-1500 Deniers-Gold Fdy-33005-Gzm	GRP-037	1	1	2026-09-04T19:10:33.934Z	\N	1
9f314caa-0d77-48c4-8c4a-0488731689de	PES Fdy-1500 Deniers-Taupe Fdy-811100-Gzm	GRP-038	1	1	2026-09-04T19:10:33.934Z	\N	1
8e14ace7-630c-4e53-b9a1-36f27366df2e	PES Fdy-1500 Deniers-Marron Fdy-36005-Gzm	GRP-039	1	1	2026-09-04T19:10:33.934Z	\N	1
ccdffcce-7843-4936-a8c0-6783d6f52439	PES Fdy-1500 Deniers-Rose Fdy-423020-Gzm	GRP-040	1	1	2026-09-04T19:10:33.934Z	\N	1
c030fa08-fb56-4273-b0a3-da2029ceb851	PES Fdy-1500 Deniers-Turkoise Fdy-513020-Gzm	GRP-041	1	1	2026-09-04T19:10:33.934Z	\N	1
ea898caf-1f33-4ceb-ac4c-ba74e5d8fa2a	PES Fdy-1500 Deniers-Olive Fdy-93005-Gzm	GRP-042	1	1	2026-09-04T19:10:33.934Z	\N	1
e7ffcfbd-7155-4d1d-8cf3-65125ffaaf6e	PES Ver-1500 Deniers-BleuTex-8100 Text	GRP-043	1	1	2026-09-04T19:10:33.934Z	\N	1
69723e95-d078-482a-80a8-ea53e9743212	PES Fdy-1500 Deniers-Bleu  Fdy-542030-Gzm	GRP-043	2	0	2026-09-04T19:10:33.934Z	\N	1
3b9c00d3-2c62-4f49-9521-f11b1108b6f5	PP FRZ-2900 Dtex-Navy Bleu 1697-Tat	GRP-044	1	1	2026-09-04T19:10:33.934Z	\N	1
bd16f5e8-38b0-4274-9fa6-7d9dcfa00370	PP FRZ-2900 Dtex-Green Mlt 18-Tat	GRP-045	1	1	2026-09-04T19:10:33.934Z	\N	1
57ec28ed-d225-4c63-a36f-6c9543786118	PES Sh-1200 Deniers-Antrasit 802-Tat	GRP-046	1	1	2026-09-04T19:10:33.934Z	\N	1
e864fe4a-16a7-41e8-8e8e-6f7db2281234	PES Sh-1200 Deniers-Cpbt Grey 801-Tat	GRP-047	1	1	2026-09-04T19:10:33.934Z	\N	1
7a65097c-e66e-40f0-b2da-fde409101905	PES Sh-1500 Deniers-Beige H-2001-Tat	GRP-048	1	1	2026-09-04T19:10:33.934Z	\N	1
55a66b8f-3e28-4fc6-ad52-a3e1e8eea023	Micro PES-3600 Deniers Ivory 15-Tat	GRP-050	1	1	2026-09-04T19:10:33.934Z	\N	1
a6ce303b-63ba-47d8-9ef9-38c8918fa191	PP-1775*2 Dtex-White 1073-Tat	GRP-051	1	1	2026-09-04T19:10:33.934Z	\N	1
88b5ddf6-1143-4688-92c4-8b253c3cb716	PP-1775*2 Dtex-Cream 1072-Tat	GRP-052	1	1	2026-09-04T19:10:33.934Z	\N	1
7da6af71-120a-4fd4-8924-f04393650a38	PP-1000*2 Dtex-Cream Mn-1201-Tat	GRP-054	1	1	2026-09-04T19:10:33.934Z	\N	1
7e8782ee-4092-48ea-a434-e72cca3a5b02	PP-1000*2 Dtex-Beige Mn-3203 L-Tat	GRP-055	1	1	2026-09-04T19:10:33.934Z	\N	1
06f8a136-0803-4b69-be05-b02a3146414b	PES-3000 Deniers- Seker Cream Ssl2081-Suj	GRP-059	1	1	2026-09-04T19:10:33.934Z	\N	1
f0769428-17a4-4210-ba05-76bc0041deb5	PES-3000 Deniers- Dark Grey Ssl2069-Suj	GRP-060	1	1	2026-09-04T19:10:33.934Z	\N	1
52613e99-d372-4bd2-b8bf-a3d5db402d06	PES-3000 Deniers- Vison Ssl2247-Suj	GRP-061	1	1	2026-09-04T19:10:33.934Z	\N	1
edb99918-b4a8-4496-af7e-be76f7f7c0dd	PES-3000 Deniers- WhiteSsl2331-Suj	GRP-062	1	1	2026-09-04T19:10:33.934Z	\N	1
1facc7b6-be23-45a8-b500-a24f487526a1	PES-3000 Deniers- Rouge Ssl2232-Suj	GRP-063	1	1	2026-09-04T19:10:33.934Z	\N	1
306ecaa3-c8ee-4cd6-8e4c-18db556a6d9c	PES-3000 Deniers- Dk.Beige Ssl2271-Suj	GRP-064	1	1	2026-09-04T19:10:33.934Z	\N	1
66c49e4d-8130-4272-b372-1a3014ea9d27	PES-3000 Deniers- Khave Ssl2279-Suj	GRP-065	1	1	2026-09-04T19:10:33.934Z	\N	1
5791ecea-6155-4836-a0fa-a320bfe85152	PES-3000 Deniers- Pink Ssl2259-Suj	GRP-066	1	1	2026-09-04T19:10:33.934Z	\N	1
68aea2f0-d477-49f7-bce9-47c0f20a6fc4	PES-3000 Deniers- Dk.Vison Ssl2176-Suj	GRP-067	1	1	2026-09-04T19:10:33.934Z	\N	1
8de27c61-c2b3-4931-98f3-2aca85f0d80a	PES-3000 Deniers- Bleu Ssl2244-Suj	GRP-068	1	1	2026-09-04T19:10:33.934Z	\N	1
5ceb326e-859a-4f13-aadd-f62791605f5a	Micro PES-7360 Deniers-Multi Beige 1305-129-Suj	GRP-069	1	1	2026-09-04T19:10:33.934Z	\N	1
030e87e4-1b35-4638-b60f-8ee406fc018a	Micro PES-7360 Deniers-Multi L.Beige 1305-130-Suj	GRP-070	1	1	2026-09-04T19:10:33.934Z	\N	1
a22f5f3a-a38c-4bd8-8630-6fabdf6e39c6	Micro PES-7360 Deniers-Multi L.Brown 1305-61-Suj	GRP-071	1	1	2026-09-04T19:10:33.934Z	\N	1
000c0eaa-bc59-4f7d-91f9-f81887f46062	PES Sh -1200 Deniers-Grey Cb-7A Turk	GRP-073	1	1	2026-09-04T19:10:33.934Z	\N	1
00eb2cf7-9081-4bfc-bbd9-7e60a19bccd2	PES Sh -1200 Deniers-Cream Cb-1056 Turk	GRP-076	1	1	2026-09-04T19:10:33.934Z	\N	1
adbc757a-fd43-483b-b26d-b3e6c3b4f11d	PES Fdy -1800 Deniers-Gold Cf-101 Turk	GRP-077	1	1	2026-09-04T19:10:33.934Z	\N	1
867d28e5-dbbb-4978-b078-a0fd58c333fd	PES Fdy -1800 Deniers-Taupe Cf-4001 Turk	GRP-078	1	1	2026-09-04T19:10:33.934Z	\N	1
d9be38ba-8c0e-4f31-b566-4277ca754149	PES Fdy -1800 Deniers-White Cf-1001 Turk	GRP-079	1	1	2026-09-04T19:10:33.934Z	\N	1
df1f13ec-01c9-4393-9d51-3535619c11fe	PES Sh-1500 Deniers-VizonTex-7530 Text	GRP-082	1	1	2026-09-04T19:10:33.934Z	\N	1
c124483a-0bd0-4b8e-8733-873fa7988231	PES Ver-1500 Deniers-TerraTex-8000 Text	GRP-083	1	1	2026-09-04T19:10:33.934Z	\N	1
9cb25f13-59e7-470b-9c22-58e2deea6bf2	Jute 30/1	GRP-085	1	1	2026-09-04T19:10:33.934Z	\N	1
5c7fa2ac-6b27-48dc-bb08-00310d7756b5	Jute 24/1	GRP-086	1	1	2026-09-04T19:10:33.934Z	\N	1
dc2c9a95-b37d-4577-82e4-abe405451db2	Jute 12/1	GRP-087	1	1	2026-09-04T19:10:33.934Z	\N	1
b291ede7-31b3-424f-9b00-c27cb12a1c4e	Jute 9,6/1	GRP-087	2	0	2026-09-04T19:10:33.934Z	\N	1
5b011c9b-2fcf-4340-89e9-533ef95bbe50	Jute 16/2	GRP-089	1	1	2026-09-04T19:10:33.934Z	\N	1
f026efde-4cd1-4bdd-ba7d-6c4b13e48366	Jute 20/2	GRP-090	1	1	2026-09-04T19:10:33.934Z	\N	1
d0f65357-7fcd-485b-ac63-d8bd69b244c0	PES-20/2 LOMAT	GRP-091	1	1	2026-09-04T19:10:33.934Z	\N	1
c2bc67b6-30ec-4ee7-bf04-ad60be3a1c50	PES-20/2 GLOBALTEX	GRP-091	2	0	2026-09-04T19:10:33.934Z	\N	1
daab7b8a-984c-4ea8-94dc-afaadf351959	PES-20/4 LOMAT	GRP-092	1	1	2026-09-04T19:10:33.934Z	\N	1
863fd7f5-ccf3-4787-89d0-57bf77b0c04c	PES-20/4 GLOBALTEX	GRP-092	2	0	2026-09-04T19:10:33.934Z	\N	1
63c2c2cb-e77e-4f33-9d6e-94033816bc3a	PES Nylon	GRP-095	1	1	2026-09-04T19:10:33.934Z	\N	1
840ca9d1-073f-4ee6-bb9f-a0b0df1d9007	Bande	GRP-097	1	1	2026-09-04T19:10:33.934Z	\N	1
79068579-0213-47a8-a887-d5a2c85dcf79	Cuir	GRP-098	1	1	2026-09-04T19:10:33.934Z	\N	1
218e8354-ea49-4c15-95f0-863447d661b7	SBR 821	GRP-099	1	1	2026-09-04T19:10:33.934Z	\N	1
cbc9a648-9ebf-4dec-aa4d-8c527d0b46f0	Hotmelt	GRP-100	1	1	2026-09-04T19:10:33.934Z	\N	1
c97db4a2-06b3-41fd-859d-885f5f8cb832	PLA 100 EXT	GRP-107	1	1	2026-09-04T19:10:33.934Z	\N	1
098f5304-4709-4305-aa2f-7c50114a9b8e	PP-1500 Dtex-Bleu 7201-Oz	GRP-019	1	1	2026-09-04T19:10:33.934Z	\N	1
8af7210a-f2e3-47a0-b075-14aeecea1738	PP-1500 Dtex-Bleu 6666-Hs	GRP-019	2	0	2026-09-04T19:10:33.934Z	\N	1
1da499c0-121f-4959-ae18-434453a4de55	Jute 10/1	GRP-110	1	1	2026-10-03T17:12:55.527Z	\N	1
1ef929df-4820-40da-971e-b4b9b3d905b7	Jute 9,6/1	GRP-110	2	0	2026-10-03T17:12:55.536Z	\N	1
fea22cb6-2415-4561-a1d6-9e783d5e1a80	PES-Nylon	GRP-095	2	0	2026-09-04T19:10:33.934Z	2026-10-01	0
\.


ALTER TABLE public.reference_groupe_equiv ENABLE TRIGGER ALL;

--
-- Data for Name: taux_change; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.taux_change DISABLE TRIGGER ALL;

COPY public.taux_change (id_taux, code_devise, taux, date_debut, date_fin, source, date_creation) FROM stdin;
de9e6041-abc6-4324-a564-85971ec1340d	MAD	1.0000	2026-01-01T00:00:00.000Z	\N	Devise pivot	2026-09-04T19:04:34.373Z
d0a56f5a-2c13-4ffd-afea-245d554cc67c	USD	9.5000	2026-01-01T00:00:00.000Z	2026-09-15	CDC A4	2026-09-04T19:04:34.373Z
860c5fd4-64b4-46f4-b751-310ef8ce98d7	EUR	11.0000	2026-01-01T00:00:00.000Z	2026-09-17	CDC A4	2026-09-04T19:04:34.373Z
4901f39d-4edb-412c-8541-9dc0ad771a76	EUR	10.8500	2026-09-17	\N	\N	2026-09-17T15:43:55.045Z
9e3ff940-065d-40b6-8f2e-df72057f44f6	USD	9.2704	2026-09-15	2026-09-17	\N	2026-09-17T15:43:13.232Z
06a1dce5-1c9e-4cf2-ad24-4304ca771835	USD	9.2705	2026-09-17	2026-09-17T16:05:40.520Z	\N	2026-09-17T16:05:01.387Z
4c04dcf5-86e3-4f0f-aa43-88ef20435d1e	USD	9.2704	2026-09-17T16:05:40.520Z	\N	\N	2026-09-17T16:05:40.521Z
\.


ALTER TABLE public.taux_change ENABLE TRIGGER ALL;

--
-- PostgreSQL database dump complete
--

\unrestrict gEfoJFzlQHTIrE6TpfI52ZtBVKMGZRZ3GE909P9QCvr5kb3PTqNy7sIdhNpTUBy

