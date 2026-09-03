-- =============================================================================
-- IDENTITE DE L'ENTREPRISE — Polyfashions Carpet S.A.R.L.
-- -----------------------------------------------------------------------------
-- Ces informations figurent sur TOUS LES ETATS SORTANTS : bons de commande
-- envoyes aux fournisseurs, bons de transfert, etats de reception. Elles ne
-- sont pas decoratives — un bon de commande sans RC ni identifiant fiscal n'a
-- pas de valeur commerciale au Maroc, et un fournisseur qui ne peut pas
-- identifier l'emetteur ne traite pas la commande.
--
-- Elles vivent en BASE et non dans le code : elles changent (une adresse, un
-- numero de telephone, une banque) sans qu'il faille recompiler quoi que ce
-- soit, et le changement est trace comme toute autre ecriture.
--
-- Ce fichier est IDEMPOTENT : le rejouer met a jour sans dupliquer.
-- =============================================================================

INSERT INTO entreprise (
    id_entreprise, nom, groupe, adresse, rc, identifiant_fiscal, tp, cnss,
    telephone, fax, banques, devise_base, logo_url, actif
) VALUES (
    '00000000-0000-4000-a000-000000000001',
    'POLYFASHIONS CARPET S.A.R.L.',
    'Mazari Group',
    'Z.I. M''Ghogha, Allee 3 N° 79 — Tanger, Maroc',
    '7253',           -- Registre du Commerce
    '04901102',       -- Identifiant Fiscal (N.I.F.)
    '57221265',       -- Taxe Professionnelle (Patente)
    '2662296',        -- C.N.S.S.
    '+212 5 39 35 15 49 / +212 5 39 35 16 43',
    '+212 5 39 35 17 77',
    -- Les deux RIB, sur deux lignes : ils apparaissent ainsi au pied des
    -- documents, chacun precede du nom de sa banque.
    E'ATTIJARIWAFA BANK : 007 640 000 000 090 4 012433 95\nBMCI : 013 640 0106300061900182 92',
    'MAD',
    '/logo-polyfashions.png',
    1
)
ON CONFLICT (id_entreprise) DO UPDATE SET
    nom                = excluded.nom,
    groupe             = excluded.groupe,
    adresse            = excluded.adresse,
    rc                 = excluded.rc,
    identifiant_fiscal = excluded.identifiant_fiscal,
    tp                 = excluded.tp,
    cnss               = excluded.cnss,
    telephone          = excluded.telephone,
    fax                = excluded.fax,
    banques            = excluded.banques,
    devise_base        = excluded.devise_base,
    logo_url           = excluded.logo_url,
    actif              = excluded.actif;

-- -----------------------------------------------------------------------------
-- CE QUI MANQUE, ET QUI COMPTE
-- -----------------------------------------------------------------------------
-- L'ICE — Identifiant Commun de l'Entreprise — n'est pas renseigne. Il est
-- OBLIGATOIRE sur toute facture au Maroc depuis 2016, et son absence peut faire
-- rejeter une facture par l'administration fiscale comme par un client.
--
-- Le champ existe et attend sa valeur :
--     UPDATE entreprise SET ice = '00XXXXXXXXXXXXX'
--      WHERE id_entreprise = '00000000-0000-4000-a000-000000000001';
--
-- Le capital social et le nom du dirigeant sont egalement vides. Ils figurent
-- sur les documents commerciaux d'une S.A.R.L. et se completent de la meme
-- facon.
-- -----------------------------------------------------------------------------
SELECT nom, rc, identifiant_fiscal, tp, cnss,
       CASE WHEN ice IS NULL OR ice = '' THEN 'A RENSEIGNER' ELSE ice END AS ice,
       CASE WHEN capital IS NULL THEN 'A RENSEIGNER' ELSE capital::text END AS capital,
       CASE WHEN dirigeant IS NULL OR dirigeant = '' THEN 'A RENSEIGNER' ELSE dirigeant END
                                                                          AS dirigeant
  FROM entreprise;
