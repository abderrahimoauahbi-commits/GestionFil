import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { EcranReferentiel } from '../components/EcranReferentiel'
import type { ChampDef } from '../components/Formulaire'
import type { Colonne } from '../components/TableDroits'
import { Badge } from '../composants/ui/base'
import { fmt } from '../lib/utils'

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
    queryFn: ({ signal }) => api.get<{ code_devise: string }[]>('/api/devises', { signal }),
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
      entete: 'Délai',
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
      entete: 'Références',
      numerique: true,
      rendu: (f) => <Badge>{f.nb_references}</Badge>,
    },
  ]

  const champs: ChampDef[] = [
    /* --- Identité ---------------------------------------------------- */
    {
      champ: 'code_fournisseur',
      libelle: 'Code',
      obligatoire: true,
      cleCreation: true,
      aide: 'Cite par le catalogue et les commandes : non modifiable ensuite.',
      section: 'Identité',
    },
    { champ: 'nom', libelle: 'Raison sociale', obligatoire: true, section: 'Identité', etendue: 2 },
    { champ: 'actif', libelle: 'Actif', type: 'booleen', defaut: true, section: 'Identité' },
    /* --- Contact ----------------------------------------------------- */
    { champ: 'contact_principal', libelle: 'Contact', section: 'Contact' },
    { champ: 'telephone', libelle: 'Téléphone', section: 'Contact' },
    { champ: 'email', libelle: 'Email', section: 'Contact' },
    { champ: 'ville', libelle: 'Ville', section: 'Contact' },
    { champ: 'pays', libelle: 'Pays', obligatoire: true, section: 'Contact' },
    { champ: 'adresse', libelle: 'Adresse', type: 'zone', pleineLargeur: true, section: 'Contact' },
    /* --- Conditions commerciales ------------------------------------- */
    {
      champ: 'code_devise',
      libelle: 'Devise de facturation',
      type: 'liste',
      options: qDev.data?.map((d) => ({ valeur: d.code_devise, libelle: d.code_devise })),
      section: 'Conditions commerciales',
    },
    { champ: 'conditions_paiement', libelle: 'Conditions de paiement', section: 'Conditions commerciales' },
    {
      champ: 'delai_paiement_jours',
      libelle: 'Délai de paiement (jours)',
      type: 'entier',
      aide: 'Alimente le DPO du cockpit.',
      section: 'Conditions commerciales',
    },
    { champ: 'incoterm', libelle: 'Incoterm', section: 'Conditions commerciales' },
    /* --- Logistique et réception ------------------------------------- */
    {
      champ: 'delai_livraison_jours',
      libelle: 'Délai de livraison (jours)',
      type: 'entier',
      min: 1,
      aide: 'Entre dans le calcul du stock minimum dynamique (formule F3).',
      section: 'Logistique et réception',
    },
    { champ: 'transporteur', libelle: 'Transporteur', section: 'Logistique et réception' },
    {
      champ: 'palettes_par_conteneur',
      libelle: 'Palettes par conteneur',
      type: 'entier',
      min: 1,
      aide:
        'Combien de palettes entrent dans un conteneur chez ce fournisseur. Le bon de ' +
        'commande en déduit le nombre de conteneurs à annoncer — le chiffre que le ' +
        'transitaire attend, et qui figurait sur 71 des anciens bons Excel.',
      section: 'Logistique et réception',
    },
    {
      champ: 'tolerance_pesee_pct',
      libelle: 'Tolérance de pesée (%)',
      type: 'nombre',
      min: 0,
      aide:
        'Au-dela, une réception exige une derogation nominative. Ce seuil se fixe avec le ' +
        'droit de valider : celle qui prepare les réceptions ne le règle pas.',
      section: 'Logistique et réception',
      exigeValider: true,
    },
    /* --- Évaluation -------------------------------------------------- */
    { champ: 'note_globale', libelle: 'Note globale (/100)', type: 'nombre', min: 0, max: 100, section: 'Évaluation' },
  ]

  return (
    <EcranReferentiel<Fournisseur>
          exportable="fournisseurs"
          imprimable="Fournisseurs"
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
