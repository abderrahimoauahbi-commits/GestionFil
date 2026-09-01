/**
 * Mise en page partagee des etats imprimables.
 *
 * UN SEUL CADRE POUR TOUS LES DOCUMENTS. Bon de commande, bon de transfert,
 * liste de mouvements, plan d'achat : ils different par leur contenu, jamais
 * par leur entete ni leur pied. Ecrire ce cadre une fois evite que le bon de
 * commande porte le nom de l'entreprise et la liste des besoins non — ce qui
 * arrive toujours quand chaque ecran refait sa mise en page.
 *
 * CE QUE LE PIED PORTE, ET POURQUOI. Un document imprime quitte l'application :
 * il finit sur un bureau, dans un dossier, chez un fournisseur. Trois mentions
 * le rendent exploitable des lors qu'il n'est plus a l'ecran — QUI l'a edite,
 * QUAND, et sur quelles donnees. Sans elles, deux tirages du meme etat a deux
 * semaines d'intervalle sont indiscernables, et personne ne sait lequel fait foi.
 */
import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Bouton } from './ui/base'

interface Entreprise {
  P_NomEntreprise?: string
  P_Pays?: string
  P_Secteur?: string
}

/** Les parametres d'identite, lus une fois et gardes en cache. */
function useEntreprise(): Entreprise {
  const q = useQuery({
    queryKey: ['parametres', 'entreprise'],
    queryFn: () => api.get<{ code_parametre: string; valeur_courante: string }[]>(
      '/api/parametres',
    ),
    staleTime: 30 * 60_000,
  })
  const par: Entreprise = {}
  for (const p of q.data ?? []) {
    if (p.code_parametre === 'P_NomEntreprise') par.P_NomEntreprise = p.valeur_courante
    if (p.code_parametre === 'P_Pays') par.P_Pays = p.valeur_courante
    if (p.code_parametre === 'P_Secteur') par.P_Secteur = p.valeur_courante
  }
  return par
}

export function EtatImprimable({
  titre,
  sousTitre,
  reference,
  enTete,
  children,
  auto = false,
  sansBarre = false,
}: {
  titre: string
  sousTitre?: string
  /** Numero du document, s'il en porte un : BC-2026-0028, TR-2026-004. */
  reference?: string
  /** Bloc libre sous l'entete : fournisseur, magasin, periode. */
  enTete?: React.ReactNode
  children: React.ReactNode
  /** Ouvre la fenetre d'impression des l'affichage. */
  auto?: boolean
  /** Retire la barre d'apercu : le declenchement vient d'ailleurs. */
  sansBarre?: boolean
}) {
  const { moi } = useAuth()
  const entreprise = useEntreprise()
  const [edite] = useState(() => new Date())

  useEffect(() => {
    if (!auto) return
    // Laisser une image de rendu avant d'appeler l'impression : sans ce delai,
    // Chrome capture parfois la page avant que les polices soient posees, et
    // le document sort dans la police de secours.
    const t = setTimeout(() => window.print(), 350)
    return () => clearTimeout(t)
  }, [auto])

  const horodatage = edite.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <>
      {/* Cette barre ne part jamais au papier : `sans-impression` la retire.
          Elle est aussi inutile dans un rendu deja declenche par un bouton
          exterieur — d'ou `sansBarre`. */}
      {!sansBarre && (
      <div className="sans-impression mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-attenue-texte">
          Apercu avant impression — format A4, marges de 12 mm.
        </p>
        <Bouton onClick={() => window.print()}>
          <Printer />
          Imprimer
        </Bouton>
      </div>
      )}

      <div className="zone-impression mx-auto max-w-[210mm] bg-white p-8 text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {/* --- Entete ---------------------------------------------------- */}
        <header className="mb-5 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div className="min-w-0">
            <div className="text-[15px] font-bold uppercase tracking-wide">
              {entreprise.P_NomEntreprise ?? 'Polyfashions Carpet Morocco'}
            </div>
            {entreprise.P_Secteur && (
              <div className="text-[10px] text-neutral-600">
                {entreprise.P_Secteur}
                {entreprise.P_Pays && ` · ${entreprise.P_Pays}`}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[15px] font-bold uppercase tracking-wide">{titre}</div>
            {reference && (
              <div className="font-mono text-[13px] font-semibold">{reference}</div>
            )}
            {sousTitre && <div className="text-[10px] text-neutral-600">{sousTitre}</div>}
          </div>
        </header>

        {enTete && <div className="mb-4 text-[11px]">{enTete}</div>}

        <main className="etat-corps text-[11px]">{children}</main>

        {/* --- Pied -------------------------------------------------------
            Il se repete sur chaque page grace a `position: fixed` sous
            `@media print` ; a l'ecran il reste en fin de document. */}
        <footer className="mt-6 border-t border-neutral-400 pt-2 text-[9px] text-neutral-600">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Edite le {horodatage}
              {moi?.login && ` par ${moi.login}`}
            </span>
            <span>ERP Gestion Fil</span>
          </div>
        </footer>
      </div>
    </>
  )
}

/**
 * Un tableau d'etat, mis en forme pour le papier.
 *
 * Les colonnes reprennent celles de l'ecran, filtrees par les droits en amont :
 * un magasinier imprime le meme tableau que celui qu'il lit, sans les montants.
 * Rien ici ne doit rendre visible ce que l'ecran masque.
 */
export function TableEtat<L>({
  colonnes,
  lignes,
  total,
}: {
  colonnes: { entete: string; valeur: (l: L) => React.ReactNode; numerique?: boolean }[]
  lignes: L[]
  /** Ligne de total, si l'etat en porte une. */
  total?: React.ReactNode[]
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        {/* `table-header-group` fait repeter l'entete en haut de chaque page
            imprimee. Sans lui, la deuxieme page arrive sans nom de colonne. */}
        <tr className="border-b border-black" style={{ display: 'table-row' }}>
          {colonnes.map((c, i) => (
            <th
              key={i}
              className={
                'px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide ' +
                (c.numerique ? 'text-right' : 'text-left')
              }
            >
              {c.entete}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={i} className="border-b border-neutral-300">
            {colonnes.map((c, j) => (
              <td
                key={j}
                className={'px-1.5 py-[3px] align-top ' + (c.numerique ? 'text-right tabular-nums' : '')}
              >
                {c.valeur(l)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr className="border-t-2 border-black font-semibold">
            {total.map((v, i) => (
              <td
                key={i}
                className={
                  'px-1.5 py-1 ' + (colonnes[i]?.numerique ? 'text-right tabular-nums' : '')
                }
              >
                {v}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}

/**
 * Le rendu papier d'un tableau affiche a l'ecran.
 *
 * POURQUOI CE COMPOSANT EXISTE PLUTOT QU'UNE PAGE SEPAREE. Un etat sur sa
 * propre page oblige a re-choisir ce qu'on regardait : le magasin, la periode,
 * les trois filtres qu'on venait de poser. Ici le tableau imprime EST le
 * tableau affiche — memes colonnes, memes lignes, meme tri.
 *
 * IL EST RENDU EN PERMANENCE, invisible a l'ecran. `@media print` masque tout
 * ce qui porte `sans-impression` et ne laisse que lui. Le produire au clic
 * imposerait un aller-retour de rendu avant `window.print()`, pendant lequel le
 * navigateur capture parfois une page encore vide.
 */
export function TableauImprimable<L>({
  titre,
  colonnes,
  lignes,
  resume,
}: {
  titre: string
  colonnes: { entete: string; valeur: (l: L) => React.ReactNode; numerique?: boolean }[]
  lignes: L[]
  /** Une ligne de contexte : combien de lignes, quels filtres. */
  resume?: string
}) {
  return (
    <div className="hidden print:block">
      <EtatImprimable titre={titre} sansBarre enTete={resume ? <span>{resume}</span> : undefined}>
        <TableEtat colonnes={colonnes} lignes={lignes} />
      </EtatImprimable>
    </div>
  )
}
