-- =============================================================================
-- ERP GESTION FIL — MACHINES ET EMPLACEMENTS, cible PostgreSQL
-- -----------------------------------------------------------------------------
-- LA MACHINE EST UN EMPLACEMENT DE STOCK, PAS UN REGISTRE A PART.
--
-- Le fil pose sur un metier n'a pas quitte l'entreprise : il est sorti du
-- magasin et il attend d'etre consomme. Le suivre dans une table dediee
-- obligerait a reconcilier deux comptabilites, et deux comptabilites derivent
-- toujours l'une de l'autre. Chaque emplacement de machine possede donc sa
-- ligne dans `magasin`, et son contenu vit dans `stock_magasin` et `stock_lot`
-- comme n'importe quel autre stock : meme grand livre, meme CMUP, meme
-- interdiction de solde negatif (R02), meme inventaire, meme audit, meme
-- securite par champ.
--
-- Consequence directe : ce fichier n'introduit AUCUN type de mouvement. Un
-- chargement est un TRANSFERT_SORTIE suivi d'un TRANSFERT_ENTREE, une
-- consommation un SORTIE_PROD, une correction un AJUST_INV_POS ou _NEG. Les
-- six types semes a l'origine suffisent, et tous les etats existants couvrent
-- les machines le jour de leur mise en service.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- MACHINE
-- -----------------------------------------------------------------------------
CREATE TABLE machine (
    code_machine        text    NOT NULL PRIMARY KEY,
    nom                 text    NOT NULL,

    -- Capacite physique TOTALE : etages, chaine et trame confondus. Elle n'est
    -- PAS la somme des capacites d'emplacement — on repartit 600 bobines comme
    -- on veut sur quatre etages de 200 places. Les deux plafonds existent, et
    -- les deux s'appliquent.
    capacite_bobines    bigint  NOT NULL CHECK (capacite_bobines > 0),

    -- Compte les ETAGES SEULEMENT. La chaine et la trame sont des emplacements
    -- de la machine, pas des etages : elles n'entrent pas dans ce nombre.
    nb_etages           bigint  NOT NULL CHECK (nb_etages > 0),

    -- Atelier de rattachement. Sert au filtrage des ecrans, jamais au stock :
    -- le stock d'une machine est porte par ses emplacements, pas par elle.
    code_atelier        text    REFERENCES magasin(code_magasin),

    notes               text,
    actif               bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1))
);


-- -----------------------------------------------------------------------------
-- EMPLACEMENT — un etage, la chaine ou la trame
-- -----------------------------------------------------------------------------
-- LES QUATRE ROLES SONT TRAITES A L'IDENTIQUE par tout ce qui suit : meme stock,
-- meme declencheur de capacite, meme geste d'operateur, meme controle. Le role
-- ne sert qu'au PLAN — ce qu'on affiche dans la pile d'etages et ce qu'on
-- affiche a cote. Ecrire deux tables pour cette seule difference d'affichage
-- aurait double la logique sans rien gagner.
--
-- Un emplacement porte plusieurs references et plusieurs lots a la fois : c'est
-- la regle, pas l'exception, et le stock par (reference, magasin, lot) le
-- represente sans effort particulier.
-- -----------------------------------------------------------------------------
CREATE TABLE machine_emplacement (
    code_emplacement    text    NOT NULL PRIMARY KEY,
    code_machine        text    NOT NULL REFERENCES machine(code_machine),
    role                text    NOT NULL
                                CHECK (role IN ('ETAGE','CHAINE','TRAME','RESERVE')),

    -- Numero d'etage, ou 0 pour la chaine et la trame. Les deux contraintes du
    -- bas verrouillent la convention dans les deux sens : ni « etage 0 », ni
    -- « chaine 3 » ne peuvent s'ecrire.
    numero_etage        bigint  NOT NULL CHECK (numero_etage >= 0),

    capacite_bobines    bigint  NOT NULL CHECK (capacite_bobines > 0),

    -- Le libelle du plan, calcule une fois pour toutes : « Etage 2 », « Chaine »,
    -- « Trame ». Il sert aux messages des declencheurs, qui n'ont pas a refaire
    -- cette mise en forme, et a l'ecran, qui n'a pas a l'inventer.
    libelle             text    GENERATED ALWAYS AS (
                            CASE role
                                WHEN 'ETAGE'  THEN 'Etage ' || CAST(numero_etage AS text)
                                WHEN 'CHAINE' THEN 'Chaine'
                                WHEN 'TRAME'  THEN 'Trame'
                                WHEN 'RESERVE' THEN 'Reserve'
                            END) STORED,

    -- L'EMPLACEMENT EST UN MAGASIN. Tout le stock de la machine passe par la,
    -- et rien d'autre n'a besoin d'exister.
    code_magasin        text    NOT NULL UNIQUE REFERENCES magasin(code_magasin),

    actif               bigint  NOT NULL DEFAULT 1 CHECK (actif IN (0,1)),

    CHECK (role =  'ETAGE' OR numero_etage = 0),
    CHECK (role <> 'ETAGE' OR numero_etage > 0),
    UNIQUE (code_machine, role, numero_etage)
);

CREATE INDEX ix_empl_machine ON machine_emplacement(code_machine);

-- Une seule chaine, une seule trame, une seule reserve par machine. Index
-- UNIQUE partiel, comme ux_grp_equiv_pref ailleurs dans le schema : la
-- contrainte ne porte que sur les lignes concernees et laisse les etages se
-- multiplier librement.
CREATE UNIQUE INDEX ux_empl_role_unique ON machine_emplacement(code_machine, role)
    WHERE role IN ('CHAINE','TRAME','RESERVE');
