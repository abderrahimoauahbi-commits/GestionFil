-- ===========================================================================
-- JUTE 10/1 — la seule reference que le classeur ajoutait vraiment
--
-- Elle avait ete laissee de cote a la migration precedente, faute de prix : la
-- base exige `prix_catalogue > 0` et le classeur « Liste ref fil.xlsx » ne
-- porte aucun tarif. Sur demande, elle est creee quand meme.
--
-- LE PRIX EST PROVISOIRE, ET IL FAUT LE DIRE. On reprend celui de Jute 12/1,
-- le titrage voisin chez le meme fournisseur — 2,09 USD. Les jutes de GLOBALTEX
-- s'echelonnent de 1,29 (20/2) a 2,18 (9,6/1), et le prix suit le titrage : plus
-- le fil est fin, plus il coute. 10/1 tombe entre 9,6/1 et 12/1, donc l'ordre de
-- grandeur est juste. CE N'EST PAS LE PRIX NEGOCIE.
--
-- `date_prix_catalogue` reste VIDE : c'est la marque d'un tarif jamais confirme.
-- Toutes les autres references en portent une. Un prix sans date est un prix
-- que personne n'a valide, et c'est exactement ce qu'on veut pouvoir retrouver.
-- ===========================================================================

BEGIN;

INSERT INTO reference (
    code_reference, designation, code_categorie, code_fournisseur,
    code_famille, reference_fournisseur, unite_catalogue, code_couleur_interne,
    prix_catalogue, code_devise_catalogue, date_prix_catalogue, actif)
VALUES (
    'Jute 10/1', 'Jute 10/1', 'JUT', 'FRS-010',
    '10/1', '10/1', 'kg', 'C5',
    2.09, 'USD', NULL, 1)
ON CONFLICT (code_reference) DO NOTHING;

COMMIT;
