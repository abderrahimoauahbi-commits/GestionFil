/**
 * Les neuf referentiels de l'ERP, en un ecran a onglets.
 *
 * Sept se modifient : categories matiere, roles BOM, magasins, groupes
 * d'equivalence, types de mouvement, motifs de mouvement, motifs de ligne.
 *
 * Deux se CONSULTENT seulement — les roles utilisateur et la machine a etats.
 * Les rendre modifiables ici ouvrirait des chemins que le reste du code ne sait
 * pas traiter : une transition inventee laisserait valider un bon deja cloture,
 * et un role sans permission donnerait des comptes sans acces. On les affiche
 * pour qu'ils soient verifiables, pas pour qu'ils soient redessines.
 */
import { useMemo, useState } from 'react'
import { useEtatDepuisParam } from '../lib/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Printer, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { Equivalences } from './Equivalences'
import { EcranReferentiel } from '../components/EcranReferentiel'
import type { ChampDef } from '../components/Formulaire'
import { DataTable, type ColonneDT } from '../composants/DataTable'
import { MaitreDetail } from '../composants/MaitreDetail'
import { RailLateral, type GroupeRail } from '../composants/RailLateral'
import type { Colonne } from '../components/TableDroits'
import {
  Alerte,
  Bouton,
  Champ,
  Chargement,
  Etiq,
  Selecteur,
} from '../composants/ui/base'
import { Dialogue, DialogueContenu, useConfirmation } from '../composants/ui/surcouches'
import { Etiquette } from '../components/ui'

interface Ligne extends Record<string, unknown> {
  actif: number
}

/**
 * LE CHEMIN VERS LE PAPIER, depuis l'ecran qui montre la liste.
 *
 * Un referentiel se consulte a l'ecran mais se DIFFUSE sur papier : le nuancier
 * va au quai, la nomenclature va sur le bureau de qui classe une matiere. Sans
 * ce lien, il faudrait quitter l'ecran, ouvrir le sommaire des etats et y
 * retrouver la meme liste sous un autre nom — ce que personne ne fait.
 */
function LienEtat({ vers, titre }: { vers: string; titre: string }) {
  return (
    <Link
      to={vers}
      title={titre}
      aria-label={titre}
      className="rounded-[var(--radius)] p-1 text-attenue-texte hover:bg-attenue/60 hover:text-texte"
    >
      <Printer className="size-4" />
    </Link>
  )
}

interface Onglet {
  cle: string
  libelle: string
  module: string
  chemin: string
  identifiant: string
  unite: string
  colonnes: Colonne<Ligne>[]
  champs: ChampDef[]
  /** Referentiel structurel : consultable, jamais modifiable depuis l'ecran. */
  lectureSeule?: { url: string; note: string; colonnes: ColonneDT<Ligne>[] }
  /**
   * Referentiel qui ne tient pas dans une table plate.
   *
   * Un groupe d'equivalence est un DOCUMENT : un entete, et des lignes qui sont
   * les references equivalentes avec leur ordre de preference et leur
   * fournisseur. Le rendre avec le CRUD generique donnerait la liste des
   * entetes et perdrait ce qui fait tout l'interet du groupe.
   */
  ecranDedie?: () => React.ReactNode
}

const compte = (champ: string, entete: string): Colonne<Ligne> => ({
  champ,
  entete,
  numerique: true,
  rendu: (l) => <Etiquette>{String(l[champ] ?? 0)}</Etiquette>,
})

/** Un 0/1 de la base, lu comme une reponse : oui, ou rien. */
const ouiNon = (champ: string, entete: string): Colonne<Ligne> => ({
  champ,
  entete,
  rendu: (l) =>
    Number(l[champ]) === 1 ? <Etiquette>oui</Etiquette> : <span className="text-attenue-texte">non</span>,
})

const METHODES_FRAIS = [
  { valeur: 'VALEUR', libelle: 'A la valeur' },
  { valeur: 'POIDS', libelle: 'Au poids' },
  { valeur: 'QUANTITE', libelle: 'A la quantite' },
  { valeur: 'PARTS_EGALES', libelle: 'A parts egales' },
]

const colonneCode = (champ: string, entete: string): Colonne<Ligne> => ({
  champ,
  entete,
  rendu: (l) => (
    <span className="font-mono text-xs text-texte">{String(l[champ])}</span>
  ),
})

/**
 * Les huit roles BOM du CDC E1. Codes en dur ici parce qu'ils structurent le
 * produit — un tapis a un poil, une trame, une chaine — et qu'un formulaire de
 * referentiel ne peut pas dependre d'un autre appel pour s'afficher.
 */
const ROLES_BOM = [
  { valeur: 'POIL', libelle: 'Poil' },
  { valeur: 'TRAME', libelle: 'Trame' },
  { valeur: 'CHAINE', libelle: 'Chaîne' },
  { valeur: 'COLLE', libelle: 'Colle' },
  { valeur: 'CUIR', libelle: 'Cuir' },
  { valeur: 'FRANGE', libelle: 'Franges' },
  { valeur: 'PLAST', libelle: 'Plastique' },
  { valeur: 'RUBAN', libelle: 'Ruban' },
]

const ONGLETS: Onglet[] = [
  {
    /**
     * LA CATEGORIE ET SES FAMILLES, dans un seul ecran. Une famille n'a pas de
     * sens hors de sa categorie — « FIL 2650 dtex FZ » est du polypropylene —
     * et une categorie sans famille ne peut rien classer : celles qui n'en
     * avaient pas ont recu la leur, a leur nom.
     */
    cle: 'categories',
    libelle: 'Catégories et familles',
    module: 'CATALOGUE',
    chemin: 'categories',
    identifiant: 'code_categorie',
    unite: 'catégorie',
    colonnes: [],
    champs: [],
    ecranDedie: () => (
      <MaitreDetail
        titre="Catégories matière"
        module="CATALOGUE"
        aide="Choisissez une catégorie pour voir et compléter ses familles."
        actions={<LienEtat vers="/etats/categories" titre="Imprimer catégories et familles" />}
        maitre={{
          route: 'categories',
          cle: 'code_categorie',
          unite: 'Catégorie',
          libelle: (l) => String(l.libelle ?? l.code_categorie),
          detail: (l) => `${l.code_categorie} · ${l.nb_references ?? 0} référence(s)`,
          champs: [
            { champ: 'code_categorie', entete: 'Code', cleCreation: true, obligatoire: true },
            { champ: 'libelle', entete: 'Libellé', obligatoire: true },
            {
              champ: 'code_role_defaut',
              entete: 'Rôle BOM habituel',
              options: ROLES_BOM.map((r) => ({ valeur: r.valeur, libelle: r.libelle })),
            },
          ],
        }}
        detail={{
          route: 'familles',
          cle: 'code_famille',
          cleEtrangere: 'code_categorie',
          unite: 'Famille',
          colonnes: [
            { champ: 'code_famille', entete: 'Code', obligatoire: true, cleCreation: true,
              placeholder: 'FIL-2650-FZ', largeur: 'w-56' },
            { champ: 'libelle', entete: 'Libellé', obligatoire: true, placeholder: 'FIL 2650 dtex FZ' },
            { champ: 'titrage', entete: 'Titrage', placeholder: '2650 dtex', largeur: 'w-40' },
          ],
        }}
      />
    ),
  },
  {
    /**
     * LA COULEUR INTERNE ET SES CODES FOURNISSEUR. Le rouge de la maison est
     * C3 ; chez Hasirci il s'ecrit « RED 7612 », chez Ozkaralar « OZ 5109 ».
     * Cette liste est ce qui permet de reconnaitre une couleur sur une facture
     * et de rapprocher deux fournisseurs du meme fil.
     */
    cle: 'couleurs',
    libelle: 'Couleurs',
    module: 'CATALOGUE',
    chemin: 'couleurs',
    identifiant: 'code_couleur_interne',
    unite: 'couleur',
    colonnes: [],
    champs: [],
    ecranDedie: () => (
      <MaitreDetail
        titre="Couleurs"
        module="CATALOGUE"
        aide="Choisissez une couleur pour voir son code chez chaque fournisseur."
        actions={<LienEtat vers="/etats/couleurs" titre="Imprimer le nuancier" />}
        actionsLigne={(l) => (
          <LienEtat
            vers={`/etats/couleur/${encodeURIComponent(String(l.code_couleur_interne ?? ''))}`}
            titre="Imprimer la fiche de cette couleur"
          />
        )}
        maitre={{
          route: 'couleurs',
          cle: 'code_couleur_interne',
          unite: 'Couleur',
          libelle: (l) => `${l.code_couleur_interne} — ${l.libelle}`,
          detail: (l) => `${l.nb_references ?? 0} référence(s)`,
          champs: [
            { champ: 'code_couleur_interne', entete: 'Code', cleCreation: true, obligatoire: true },
            { champ: 'libelle', entete: 'Libellé', obligatoire: true },
            {
              champ: 'classe_teinture',
              entete: 'Classe de teinture',
              options: [
                { valeur: 'LIGHT', libelle: 'Claire' },
                { valeur: 'MEDIUM', libelle: 'Moyenne' },
                { valeur: 'DARK', libelle: 'Sombre' },
                { valeur: 'RED', libelle: 'Rouge' },
              ],
            },
          ],
        }}
        detail={{
          route: 'couleurs-fournisseur',
          cle: 'id_couleur_fournisseur',
          cleEtrangere: 'code_couleur_interne',
          unite: 'Code fournisseur',
          colonnes: [
            { champ: 'code_fournisseur', entete: 'Fournisseur', obligatoire: true, largeur: 'w-40' },
            { champ: 'code_couleur', entete: 'Code chez lui', obligatoire: true,
              placeholder: 'RED 7612', largeur: 'w-52' },
            { champ: 'libelle', entete: 'Son libellé', placeholder: 'ROUGE' },
            { champ: 'supplement_teinture', entete: 'Supplément ($/t)', largeur: 'w-36' },
          ],
        }}
      />
    ),
  },
  {
    cle: 'roles-bom',
    libelle: 'Roles BOM',
    module: 'CATALOGUE',
    chemin: 'roles-bom',
    identifiant: 'code_role',
    unite: 'role',
    colonnes: [
      colonneCode('code_role', 'Code'),
      { champ: 'libelle', entete: 'Libelle' },
      { champ: 'description', entete: 'Description', secondaire: true },
      compte('nb_qualites', 'Qualites'),
    ],
    champs: [
      { champ: 'code_role', libelle: 'Code', obligatoire: true, cleCreation: true },
      { champ: 'libelle', libelle: 'Libelle', obligatoire: true },
      { champ: 'description', libelle: 'Description', type: 'zone' },
      { champ: 'ordre_affichage', libelle: 'Ordre d affichage', type: 'entier' },
      { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
    ],
  },
  {
    cle: 'magasins',
    libelle: 'Magasins',
    module: 'STOCK',
    chemin: 'magasins',
    identifiant: 'code_magasin',
    unite: 'magasin',
    colonnes: [
      colonneCode('code_magasin', 'Code'),
      { champ: 'nom', entete: 'Nom' },
      { champ: 'code_magasin', entete: 'Type', rendu: (l) => String(l.type ?? '—') },
      {
        champ: 'quantite_kg',
        entete: 'Regime',
        rendu: (l) => (
          <div className="flex gap-1">
            {l.est_quarantaine === 1 && <Etiquette ton="rouge">quarantaine</Etiquette>}
            {l.inclure_mrp === 1 ? (
              <Etiquette ton="vert">compte au MRP</Etiquette>
            ) : (
              <Etiquette ton="gris">hors MRP</Etiquette>
            )}
          </div>
        ),
      },
      compte('nb_references_en_stock', 'En stock'),
    ],
    champs: [
      { champ: 'code_magasin', libelle: 'Code', obligatoire: true, cleCreation: true },
      { champ: 'nom', libelle: 'Nom', obligatoire: true },
      { champ: 'type', libelle: 'Type' },
      { champ: 'responsable', libelle: 'Responsable' },
      { champ: 'adresse', libelle: 'Adresse', type: 'zone' },
      {
        champ: 'inclure_mrp',
        libelle: 'Compte dans le stock disponible',
        type: 'booleen',
        aide: 'Decoche pour exclure ce magasin du calcul de couverture et du plan d achat.',
      },
      {
        champ: 'est_quarantaine',
        libelle: 'Zone de quarantaine',
        type: 'booleen',
        aide: 'Destination imposee des receptions non conformes. Exclut automatiquement du MRP.',
      },
      { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
    ],
  },
  {
    cle: 'groupes-equiv',
    libelle: 'Groupes d équivalence',
    module: 'CATALOGUE',
    chemin: 'groupes-equiv',
    identifiant: 'code_groupe_equiv',
    unite: 'groupe',
    // Un groupe n'est pas une ligne de table : c'est un entete et ses
    // references equivalentes, avec leur ordre de preference et leur
    // fournisseur. L'ecran dedie montre les deux ensemble.
    ecranDedie: () => <Equivalences />,
    colonnes: [
      colonneCode('code_groupe_equiv', 'Code'),
      { champ: 'libelle', entete: 'Libelle' },
      { champ: 'description', entete: 'Description', secondaire: true },
      compte('nb_references', 'References'),
    ],
    champs: [
      { champ: 'code_groupe_equiv', libelle: 'Code', obligatoire: true, cleCreation: true },
      { champ: 'libelle', libelle: 'Libelle', obligatoire: true },
      {
        champ: 'description',
        libelle: 'Description',
        type: 'zone',
        aide: 'Les références d un meme groupe sont substituables en cas de rupture.',
      },
      { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
    ],
  },
  {
    cle: 'types-mouvement',
    libelle: 'Types de mouvement',
    module: 'MOUVEMENTS',
    chemin: 'types-mouvement',
    identifiant: 'code_type_mvt',
    unite: 'type',
    colonnes: [
      colonneCode('code_type_mvt', 'Code'),
      { champ: 'libelle', entete: 'Libelle' },
      {
        champ: 'signe',
        entete: 'Sens',
        rendu: (l) => (
          <Etiquette ton={Number(l.signe) > 0 ? 'vert' : 'ambre'}>
            {Number(l.signe) > 0 ? 'entree' : 'sortie'}
          </Etiquette>
        ),
      },
      { champ: 'exige_prix', entete: 'Prix exige', rendu: (l) => (l.exige_prix ? 'oui' : '—') },
      { champ: 'impacte_cmup', entete: 'Impacte le CMUP', rendu: (l) => (l.impacte_cmup ? 'oui' : '—') },
      { champ: 'exige_of', entete: 'OF exige', rendu: (l) => (l.exige_of ? 'oui' : '—') },
      compte('nb_mouvements', 'Mouvements'),
    ],
    champs: [
      { champ: 'code_type_mvt', libelle: 'Code', obligatoire: true, cleCreation: true },
      { champ: 'libelle', libelle: 'Libelle', obligatoire: true },
      {
        champ: 'signe',
        libelle: 'Sens',
        type: 'liste',
        obligatoire: true,
        options: [
          { valeur: '1', libelle: 'Entree (+)' },
          { valeur: '-1', libelle: 'Sortie (−)' },
        ],
        cleCreation: true,
        aide:
          'Fige a la creation : les mouvements deja enregistres ont ete appliques avec ce sens, ' +
          'le changer les inverserait retroactivement dans le grand livre.',
      },
      { champ: 'exige_prix', libelle: 'Exige un prix', type: 'booleen' },
      { champ: 'impacte_cmup', libelle: 'Impacte le CMUP', type: 'booleen', cleCreation: true },
      { champ: 'exige_of', libelle: 'Exige un numéro d OF', type: 'booleen' },
      { champ: 'exige_motif_ligne', libelle: 'Exige un motif de ligne', type: 'booleen' },
      { champ: 'couleur', libelle: 'Couleur', aide: 'Code hexadecimal, ex. #10b981.' },
      { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
    ],
  },
  {
    cle: 'motifs-mouvement',
    libelle: 'Motifs de mouvement',
    module: 'MOUVEMENTS',
    chemin: 'motifs-mouvement',
    identifiant: 'code_motif',
    unite: 'motif',
    colonnes: [
      colonneCode('code_motif', 'Code'),
      { champ: 'libelle', entete: 'Libelle' },
      { champ: 'categorie', entete: 'Catégorie' },
    ],
    champs: [
      { champ: 'code_motif', libelle: 'Code', obligatoire: true, cleCreation: true },
      { champ: 'libelle', libelle: 'Libelle', obligatoire: true },
      { champ: 'categorie', libelle: 'Catégorie', obligatoire: true },
      {
        champ: 'signe_default',
        libelle: 'Sens habituel',
        type: 'liste',
        obligatoire: true,
        options: [
          { valeur: '1', libelle: 'Entree (+)' },
          { valeur: '-1', libelle: 'Sortie (−)' },
        ],
        cleCreation: true,
        aide: "Sens propose a la saisie. Il n'impose rien : le type de mouvement fait foi.",
      },
      { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
    ],
  },
  {
    cle: 'motifs-ligne',
    libelle: 'Motifs de retour',
    module: 'MOUVEMENTS',
    chemin: 'motifs-ligne',
    identifiant: 'code_motif_ligne',
    unite: 'motif',
    colonnes: [
      colonneCode('code_motif_ligne', 'Code'),
      { champ: 'libelle', entete: 'Libelle' },
      { champ: 'categorie', entete: 'Catégorie' },
    ],
    champs: [
      { champ: 'code_motif_ligne', libelle: 'Code', obligatoire: true, cleCreation: true },
      { champ: 'libelle', libelle: 'Libelle', obligatoire: true },
      { champ: 'categorie', libelle: 'Catégorie' },
      { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
    ],
  },
  {
    /**
     * Le catalogue des frais d'importation. Chaque type porte la PIECE qui le
     * justifie — ce que l'assistante cherche dans le dossier —, sa
     * recuperabilite, sa portee et sa methode de repartition.
     *
     * On le desactive plutot que de le supprimer : un dossier deja clos cite
     * son type de frais, et sa repartition doit rester lisible.
     */
    cle: 'types-frais',
    libelle: 'Types de frais',
    module: 'PARAMETRES',
    chemin: 'types-frais',
    identifiant: 'id_frais',
    unite: 'type de frais',
    colonnes: [
      colonneCode('id_frais', 'Code'),
      { champ: 'libelle', entete: 'Libelle' },
      {
        champ: 'piece_justificative',
        entete: 'Piece justificative',
        rendu: (l) =>
          l.piece_justificative ? (
            String(l.piece_justificative)
          ) : (
            <span className="text-attenue-texte">—</span>
          ),
      },
      ouiNon('recuperable', 'Recuperable'),
      ouiNon('inclus_dans_cout', 'Dans le cout'),
      ouiNon('commun', 'Commun'),
      {
        champ: 'methode_repartition',
        entete: 'Repartition',
        rendu: (l) => METHODES_FRAIS.find((m) => m.valeur === l.methode_repartition)?.libelle ?? '—',
      },
      compte('nb_utilisations', 'Employe'),
    ],
    champs: [
      { champ: 'id_frais', libelle: 'Code', obligatoire: true, cleCreation: true },
      { champ: 'libelle', libelle: 'Libelle', obligatoire: true },
      {
        champ: 'categorie',
        libelle: 'Categorie',
        type: 'liste',
        obligatoire: true,
        options: [
          { valeur: 'DOUANE', libelle: 'Douane' },
          { valeur: 'TAXE', libelle: 'Taxe' },
          { valeur: 'TRANSPORT', libelle: 'Transport' },
          { valeur: 'PORT', libelle: 'Port' },
          { valeur: 'TRANSIT', libelle: 'Transit' },
          { valeur: 'AUTRE', libelle: 'Autre' },
        ],
      },
      {
        champ: 'piece_justificative',
        libelle: 'Piece justificative',
        aide: "Le document qui porte ce frais : quittance de la douane, facture du transitaire… "
          + "C'est ce qu'on cherche dans le dossier, et ce que la saisie assistee reconnaitra.",
      },
      {
        champ: 'recuperable',
        libelle: 'Recuperable',
        type: 'booleen',
        aide: "La TVA a l'importation se recupere : elle se saisit pour que le dossier balance, "
          + "mais elle n'entre jamais dans le cout de revient.",
      },
      {
        champ: 'inclus_dans_cout',
        libelle: 'Entre dans le cout de revient',
        type: 'booleen',
        defaut: true,
        aide: 'Un frais recuperable ne peut pas y entrer : la marchandise le paierait deux fois.',
      },
      {
        champ: 'commun',
        libelle: 'Commun au dossier',
        type: 'booleen',
        defaut: true,
        aide: "Commun : reparti sur toutes les lignes. Sinon, la saisie demande sur quelles "
          + 'lignes il porte — une analyse, une redevance sur une seule marchandise.',
      },
      {
        champ: 'methode_repartition',
        libelle: 'Methode de repartition',
        type: 'liste',
        options: METHODES_FRAIS,
        defaut: 'VALEUR',
        aide: 'Le classeur repartit tout a la valeur. Le poids sert pour un fret facture au kilo, '
          + 'les parts egales pour une formalite qui ne depend ni du prix ni du poids.',
      },
      { champ: 'ordre', libelle: 'Ordre d affichage', type: 'entier' },
      { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
    ],
  },
  {
    cle: 'roles-utilisateur',
    libelle: 'Roles utilisateur',
    module: 'PARAMETRES',
    chemin: '',
    identifiant: 'code_role_user',
    unite: 'role',
    colonnes: [],
    champs: [],
    lectureSeule: {
      url: '/api/roles-utilisateur',
      note:
        'Les roles sont cites par toutes les permissions et par chaque compte. On les attribue ' +
        'depuis l ecran Utilisateurs ; on ne les cree ni ne les supprime ici.',
      colonnes: [
        colonneCode('code_role_user', 'Code'),
        { champ: 'libelle', entete: 'Libelle' },
        { champ: 'description', entete: 'Description', secondaire: true },
        compte('nb_utilisateurs', 'Comptes'),
        compte('nb_modules', 'Modules'),
        compte('nb_permissions', 'Permissions'),
      ] as ColonneDT<Ligne>[],
    },
  },
  {
    cle: 'transitions',
    libelle: 'Machine a etats',
    module: 'PARAMETRES',
    chemin: '',
    identifiant: 'entite',
    unite: 'transition',
    colonnes: [],
    champs: [],
    ecranDedie: () => <MachineEtats />,
  },
]

/** Referentiel structurel : on le lit, on ne le modifie pas. */
function ReferentielLecture({
  onglet,
}: {
  onglet: Onglet & { lectureSeule: NonNullable<Onglet['lectureSeule']> }
}) {
  const q = useQuery({
    queryKey: ['referentiel-lecture', onglet.cle],
    queryFn: () => api.get<Ligne[]>(onglet.lectureSeule.url),
  })
  return (
    <div className="space-y-3">
      <Alerte ton="info">{onglet.lectureSeule.note}</Alerte>
      <DataTable<Ligne>
        module={onglet.module}
        colonnes={onglet.lectureSeule.colonnes}
        lignes={q.data ?? []}
        chargement={q.isLoading}
        // La machine a etats n'a pas de cle simple : c'est le TRIPLET
        // (entite, source, cible) qui identifie une transition.
        cle={(l) =>
          [l.entite, l.statut_source, l.statut_cible, l.code_role_user]
            .filter(Boolean)
            .join('|')
        }
        videTitre="Aucune ligne"
        videDescription="Ce referentiel est vide."
      />
    </div>
  )
}

/**
 * @param cles  Sous-ensemble d'onglets a montrer, dans cet ordre.
 *
 * L'ecran est monte a deux endroits : en entier sur `/referentiels`, et reduit
 * aux referentiels de mouvement dans la page de configuration. Le filtre est
 * donc un PARAMETRE et non une coupe dans la liste : retirer un onglet de la
 * liste elle-meme le rendrait introuvable partout, y compris les groupes
 * d'equivalence, seul endroit ou l'on rattache une reference a ses alternatives.
 */
export function Referentiels({ cles }: { cles?: string[] } = {}) {
  const visibles = cles
    ? (cles.map((c) => ONGLETS.find((o) => o.cle === c)).filter(Boolean) as Onglet[])
    : ONGLETS
  // L'ONGLET VIT DANS L'URL. Il etait un simple `useState` : on ne pouvait donc
  // pas envoyer un lien vers les groupes d'equivalence, et un rechargement
  // ramenait sur le premier onglet. Le referentiel qu'on regarde fait partie de
  // l'adresse, comme partout ailleurs dans l'application.
  const [cleOnglet, setCleOnglet] = useEtatDepuisParam('ref')
  const onglet = visibles.find((o) => o.cle === cleOnglet) ?? visibles[0]
  const setOnglet = (o: Onglet) => setCleOnglet(o.cle)

  // Deux groupes, parce que les deux derniers ne se modifient pas : les melanger
  // laisserait chercher un bouton de creation qui n'existe pas.
  const groupes: GroupeRail[] = [
    {
      titre: 'Modifiables',
      entrees: visibles.filter((o) => !o.lectureSeule).map((o) => ({
        cle: o.cle,
        libelle: o.libelle,
      })),
    },
    {
      titre: 'Structurels',
      entrees: visibles.filter((o) => o.lectureSeule).map((o) => ({
        cle: o.cle,
        libelle: o.libelle,
        resume: 'lecture seule',
      })),
    },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
      {/* Le contenu vient EN PREMIER dans le flux : sur petit ecran, la liste
          des referentiels passe alors sous le tableau plutot que de le repousser
          hors de l'ecran a chaque ouverture. */}
      <div className="min-w-0 lg:order-1">
        {onglet.ecranDedie ? (
          <div key={onglet.cle}>{onglet.ecranDedie()}</div>
        ) : onglet.lectureSeule ? (
          <ReferentielLecture
            key={onglet.cle}
            onglet={onglet as Onglet & { lectureSeule: NonNullable<Onglet['lectureSeule']> }}
          />
        ) : (
          <EcranReferentiel<Ligne>
            key={onglet.cle}
            titre={onglet.libelle}
            module={onglet.module}
            chemin={onglet.chemin}
            cle={onglet.identifiant}
            colonnes={onglet.colonnes}
            champs={onglet.champs}
            libelleUnite={onglet.unite}
            titreCarte={(l) => String(l[onglet.identifiant])}
          />
        )}
      </div>

      <div className="lg:order-2">
        <RailLateral
          groupes={groupes}
          actif={onglet.cle}
          surChoix={(c) => setOnglet(visibles.find((o) => o.cle === c) ?? visibles[0])}
        />
      </div>
    </div>
  )
}

interface Transition extends Record<string, unknown> {
  entite: string
  statut_source: string
  statut_cible: string
  role_requis: string | null
  description: string | null
}

/**
 * La machine a etats, saisissable.
 *
 * Chaque ligne autorise un passage d'un statut a un autre : c'est ce tableau qui
 * decide qu'un bon valide peut partir chez le fournisseur, et qu'on ne le ramene
 * pas en brouillon une fois engage.
 *
 * L'ecran permet d'ouvrir et de fermer des chemins, parce que le besoin est
 * reel — un circuit de validation evolue. Mais il rappelle a chaque geste ce
 * qu'il engage : ajouter une transition que le code ne sait pas traiter cree une
 * ligne sans effet ; en retirer une ferme une porte que des utilisateurs
 * empruntent peut-etre tous les jours, et rien d'autre ne le signalera.
 */
function MachineEtats() {
  const droits = useDroits('PARAMETRES')
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const [ajout, setAjout] = useState(false)
  const [entite, setEntite] = useState('')

  const q = useQuery({
    queryKey: ['transitions'],
    queryFn: () => api.get<Transition[]>('/api/transitions'),
  })

  const entites = useMemo(
    () => [...new Set((q.data ?? []).map((t) => t.entite))].sort(),
    [q.data],
  )
  const lignes = (q.data ?? []).filter((t) => !entite || t.entite === entite)

  const supprimer = useMutation({
    mutationFn: (t: Transition) =>
      api.delete<{ statut_sans_issue: boolean; statut_source: string }>(
        '/api/transitions?' +
          new URLSearchParams({
            entite: t.entite,
            statut_source: t.statut_source,
            statut_cible: t.statut_cible,
          }),
      ),
    onSuccess: (r) => {
      toast.success('Transition retiree', {
        description: r.statut_sans_issue
          ? `Attention : ${r.statut_source} n'a plus aucune sortie. Les enregistrements qui s'y ` +
            'trouvent ne pourront plus en bouger.'
          : 'Ce passage n est plus autorise.',
        duration: r.statut_sans_issue ? 15000 : 6000,
      })
      void qc.invalidateQueries({ queryKey: ['transitions'] })
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Suppression impossible.'),
  })

  return (
    <div className="space-y-3">
      <Alerte ton="alerte" titre="Ce tableau gouverne tous les circuits">
        Chaque ligne autorise un passage d un statut a un autre. Retirer une ligne fait
        disparaitre un bouton dans l application, sans autre avertissement. Ajouter une ligne pour
        un statut que la table cible ne connait pas restera sans effet : sa contrainte la
        refusera au moment du changement.
      </Alerte>

      <div className="grid grid-cols-2 items-end gap-2 lg:flex lg:flex-wrap lg:justify-between">
        <div className="col-span-2 lg:col-span-1 lg:min-w-52">
          <Etiq htmlFor="ent">Entite</Etiq>
          <Selecteur id="ent" value={entite} onChange={(e) => setEntite(e.target.value)}>
            <option value="">Toutes ({q.data?.length ?? 0} transitions)</option>
            {entites.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Selecteur>
        </div>
        {droits.peutEcrire && (
          <Bouton variante="contour" onClick={() => setAjout(true)}>
            <Plus />
            Ouvrir une transition
          </Bouton>
        )}
      </div>

      {q.isLoading ? (
        <Chargement texte="Lecture de la machine a etats…" />
      ) : (
        <DataTable<Transition>
          module="PARAMETRES"
          colonnes={[
            { champ: 'entite', entete: 'Entite', filtre: 'liste' },
            {
              champ: 'statut_source',
              entete: 'De',
              rendu: (t) => <span className="font-mono text-xs">{t.statut_source}</span>,
            },
            {
              champ: 'statut_cible',
              entete: 'Vers',
              rendu: (t) => <span className="font-mono text-xs">{t.statut_cible}</span>,
            },
            {
              champ: 'role_requis',
              entete: 'Role requis',
              rendu: (t) =>
                t.role_requis ?? <span className="text-attenue-texte">tout role</span>,
            },
            { champ: 'description', entete: 'Description', secondaire: true },
          ]}
          lignes={lignes}
          cle={(t) => `${t.entite}|${t.statut_source}|${t.statut_cible}`}
          recherche={false}
          pagination={false}
          tailleParDefaut={200}
          videTitre="Aucune transition"
          videDescription="Aucun changement de statut n est autorise pour ce filtre."
          actions={
            droits.peutEcrire
              ? (t) => (
                  <Bouton
                    variante="discret"
                    taille="icone-xs"
                    className="text-danger hover:bg-danger/10"
                    onClick={() =>
                      confirmation.demander({
                        titre: `Fermer ${t.statut_source} → ${t.statut_cible} ?`,
                        destructif: true,
                        libelleConfirmer: 'Fermer ce chemin',
                        description:
                          `Plus aucun ${t.entite} ne pourra passer de ${t.statut_source} a ` +
                          `${t.statut_cible}. Les enregistrements deja dans ces etats ne bougent ` +
                          'pas, mais le bouton correspondant disparaitra de l application.',
                        action: () => supprimer.mutate(t),
                      })
                    }
                    aria-label="Fermer"
                  >
                    <Trash2 />
                  </Bouton>
                )
              : undefined
          }
        />
      )}

      {ajout && (
        <AjoutTransition
          entites={entites}
          surFermeture={() => setAjout(false)}
          surSucces={() => {
            setAjout(false)
            void qc.invalidateQueries({ queryKey: ['transitions'] })
          }}
        />
      )}

      {confirmation.element}
    </div>
  )
}

function AjoutTransition({
  entites,
  surFermeture,
  surSucces,
}: {
  entites: string[]
  surFermeture: () => void
  surSucces: () => void
}) {
  const [f, setF] = useState({
    entite: entites[0] ?? '',
    statut_source: '',
    statut_cible: '',
    role_requis: '',
    description: '',
  })

  const creer = useMutation({
    mutationFn: () =>
      api.post('/api/transitions', {
        ...f,
        statut_source: f.statut_source.trim().toUpperCase(),
        statut_cible: f.statut_cible.trim().toUpperCase(),
        role_requis: f.role_requis.trim() || undefined,
        description: f.description.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Transition ouverte')
      surSucces()
    },
    onError: (e) => toast.error(e instanceof ErreurApi ? e.message : 'Création impossible.'),
  })

  const pret = f.entite && f.statut_source.trim() && f.statut_cible.trim()

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        titre="Ouvrir une transition"
        description="Elle autorisera un nouveau passage d un statut a un autre."
      >
        <div className="space-y-3">
          <div>
            <Etiq htmlFor="e" obligatoire>
              Entite
            </Etiq>
            <Selecteur id="e" value={f.entite} onChange={(e) => setF({ ...f, entite: e.target.value })}>
              {entites.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Selecteur>
            <p className="mt-1 text-[11px] text-attenue-texte">
              Seules les entites deja gerees par le code peuvent changer d etat.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Etiq htmlFor="src" obligatoire>
                Statut de depart
              </Etiq>
              <Champ
                id="src"
                value={f.statut_source}
                onChange={(e) => setF({ ...f, statut_source: e.target.value })}
                placeholder="VALIDE"
              />
            </div>
            <div>
              <Etiq htmlFor="cib" obligatoire>
                Statut d arrivee
              </Etiq>
              <Champ
                id="cib"
                value={f.statut_cible}
                onChange={(e) => setF({ ...f, statut_cible: e.target.value })}
                placeholder="ENVOYE"
              />
            </div>
          </div>
          <div>
            <Etiq htmlFor="r">Role requis</Etiq>
            <Champ
              id="r"
              value={f.role_requis}
              onChange={(e) => setF({ ...f, role_requis: e.target.value })}
              placeholder="Vide : tout role autorisé"
            />
          </div>
          <div>
            <Etiq htmlFor="d">Description</Etiq>
            <Champ
              id="d"
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder="Envoi au fournisseur"
            />
          </div>
          <Alerte ton="info">
            Les statuts sont ecrits en majuscules et doivent etre ceux que la table cible accepte.
            Un statut invente sera refuse par sa contrainte au moment ou quelqu un tentera le
            changement — pas ici.
          </Alerte>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-bordure pt-3">
          <Bouton variante="contour" onClick={surFermeture}>
            Annuler
          </Bouton>
          <Bouton disabled={!pret} chargement={creer.isPending} onClick={() => creer.mutate()}>
            <Plus />
            Ouvrir
          </Bouton>
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}
