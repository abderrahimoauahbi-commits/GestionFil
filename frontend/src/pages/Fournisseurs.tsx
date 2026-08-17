import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { EcranReferentiel } from '../components/EcranReferentiel'
import type { ChampDef } from '../components/Formulaire'
import type { Colonne } from '../components/TableDroits'
import { Etiquette, fmt } from '../components/ui'

const MODULE = 'FOURNISSEURS'

interface Fournisseur extends Record<string, unknown> {
  code_fournisseur: string
  nom: string
  contact_principal: string | null
  telephone: string | null
  email: string | null
  pays: string
  delai_livraison_jours: number | null
  conditions_paiement?: string | null
  delai_paiement_jours?: number | null
  code_devise: string | null
  note_globale: number | null
  nb_references: number
  actif: number
}

export function Fournisseurs() {
  const qDev = useQuery({
    queryKey: ['devises'],
    queryFn: () => api.get<{ code_devise: string }[]>('/api/devises'),
  })

  const colonnes: Colonne<Fournisseur>[] = [
    {
      champ: 'nom',
      entete: 'Fournisseur',
      rendu: (f) => (
        <div>
          <div className="font-medium text-texte">{f.nom}</div>
          <div className="text-xs text-attenue-texte">
            {f.code_fournisseur}
            {f.actif === 0 && ' · desactive'}
          </div>
        </div>
      ),
    },
    { champ: 'pays', entete: 'Pays' },
    {
      champ: 'contact_principal',
      entete: 'Contact',
      rendu: (f) => fmt.texte(f.contact_principal),
      secondaire: true,
    },
    { champ: 'email', entete: 'Email', rendu: (f) => fmt.texte(f.email), secondaire: true },
    {
      champ: 'delai_livraison_jours',
      entete: 'Delai',
      numerique: true,
      rendu: (f) => (f.delai_livraison_jours == null ? '—' : `${f.delai_livraison_jours} j`),
    },
    {
      champ: 'conditions_paiement',
      entete: 'Paiement',
      rendu: (f) => fmt.texte(f.conditions_paiement),
    },
    { champ: 'code_devise', entete: 'Devise', rendu: (f) => fmt.texte(f.code_devise) },
    {
      champ: 'nb_references',
      entete: 'References',
      numerique: true,
      rendu: (f) => <Etiquette>{f.nb_references}</Etiquette>,
    },
  ]

  const champs: ChampDef[] = [
    {
      champ: 'code_fournisseur',
      libelle: 'Code',
      obligatoire: true,
      cleCreation: true,
      aide: 'Cite par le catalogue et les commandes : non modifiable ensuite.',
    },
    { champ: 'nom', libelle: 'Raison sociale', obligatoire: true },
    { champ: 'contact_principal', libelle: 'Contact' },
    { champ: 'telephone', libelle: 'Telephone' },
    { champ: 'email', libelle: 'Email', pleineLargeur: true },
    { champ: 'ville', libelle: 'Ville' },
    { champ: 'pays', libelle: 'Pays', obligatoire: true },
    { champ: 'adresse', libelle: 'Adresse', type: 'zone', pleineLargeur: true },
    {
      champ: 'delai_livraison_jours',
      libelle: 'Delai de livraison (jours)',
      type: 'entier',
      min: 1,
      aide: 'Entre dans le calcul du stock minimum dynamique (formule F3).',
    },
    { champ: 'conditions_paiement', libelle: 'Conditions de paiement' },
    {
      champ: 'delai_paiement_jours',
      libelle: 'Delai de paiement (jours)',
      type: 'entier',
      aide: 'Alimente le DPO du cockpit.',
    },
    {
      champ: 'code_devise',
      libelle: 'Devise de facturation',
      type: 'liste',
      options: qDev.data?.map((d) => ({ valeur: d.code_devise, libelle: d.code_devise })),
    },
    { champ: 'incoterm', libelle: 'Incoterm' },
    { champ: 'transporteur', libelle: 'Transporteur' },
    { champ: 'note_globale', libelle: 'Note globale (/100)', type: 'nombre', min: 0, max: 100 },
    {
      champ: 'tolerance_pesee_pct',
      libelle: 'Tolerance de pesee (%)',
      type: 'nombre',
      min: 0,
      aide: 'Au-dela, une reception exige une derogation nominative.',
    },
    { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true },
  ]

  return (
    <EcranReferentiel<Fournisseur>
      titre="Fournisseurs"
      module={MODULE}
      chemin="fournisseurs"
      cle="code_fournisseur"
      colonnes={colonnes}
      champs={champs}
      libelleUnite="fournisseur"
      titreCarte={(f) => f.nom}
    />
  )
}
