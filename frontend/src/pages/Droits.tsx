/**
 * Grille de droits par champ, pour UN utilisateur.
 *
 * C'est l'ecran qui repond a l'exigence : sur une meme fenetre, un utilisateur
 * voit un champ, un autre non. Chaque champ se regle sur trois etats :
 *
 *   MASQUE    le champ n'est ni envoye par le serveur, ni rendu a l'ecran
 *   LECTURE   visible, mais toute modification est refusee par le serveur
 *   ECRITURE  modifiable, si le role a aussi le droit d'ecrire sur le module
 *
 * Les reglages non enregistres restent visibles jusqu'a validation explicite :
 * on ne perd pas un travail de configuration sur un clic de navigation.
 */
import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ErreurApi } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { Bouton, Chargement, Etiquette, Message, Vide } from '../components/ui'

type Niveau = 'MASQUE' | 'LECTURE' | 'ECRITURE'

interface LigneDroit {
  module: string
  champ: string
  libelle: string
  sensible: number
  niveau: Niveau
  explicite: number
  niveau_defaut: Niveau
  niveau_modele: Niveau | null
  date_modification: string | null
}

interface Utilisateur {
  id_utilisateur: string
  login: string
  nom: string
  code_role_user: string
  role_libelle: string
  actif: number
}

const NIVEAUX: { valeur: Niveau; libelle: string; classe: string }[] = [
  { valeur: 'MASQUE', libelle: 'Masque', classe: 'bg-danger text-danger-texte' },
  { valeur: 'LECTURE', libelle: 'Lecture', classe: 'bg-alerte text-white' },
  { valeur: 'ECRITURE', libelle: 'Ecriture', classe: 'bg-succes text-white' },
]

export function Droits() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const { peut, moi } = useAuth()
  const peutEcrire = peut('UTILISATEURS', 'ECRIRE')

  const [module, setModule] = useState<string>('')
  const [recherche, setRecherche] = useState('')
  const [modifs, setModifs] = useState<Record<string, Niveau>>({})
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null)

  const qUtilisateurs = useQuery({
    queryKey: ['utilisateurs'],
    queryFn: () => api.get<Utilisateur[]>('/api/admin/utilisateurs'),
  })

  const qDroits = useQuery({
    queryKey: ['droits', id],
    queryFn: () => api.get<LigneDroit[]>(`/api/admin/utilisateurs/${id}/droits`),
    enabled: !!id,
  })

  const utilisateur = qUtilisateurs.data?.find((u) => u.id_utilisateur === id)

  const modules = useMemo(() => {
    const s = new Set((qDroits.data ?? []).map((d) => d.module))
    return [...s].sort()
  }, [qDroits.data])

  const moduleActif = module || modules[0] || ''

  const lignes = useMemo(() => {
    const motif = recherche.trim().toLowerCase()
    return (qDroits.data ?? [])
      .filter((d) => d.module === moduleActif)
      .filter(
        (d) =>
          !motif ||
          d.libelle.toLowerCase().includes(motif) ||
          d.champ.toLowerCase().includes(motif),
      )
  }, [qDroits.data, moduleActif, recherche])

  const cle = (d: LigneDroit) => `${d.module}.${d.champ}`
  const niveauCourant = (d: LigneDroit): Niveau => modifs[cle(d)] ?? d.niveau
  const nbModifs = Object.keys(modifs).length

  const enregistrer = useMutation({
    mutationFn: async () => {
      const droits = Object.entries(modifs).map(([k, niveau]) => {
        const [mod, ...reste] = k.split('.')
        return { module: mod, champ: reste.join('.'), niveau }
      })
      return api.put<{ droits_enregistres: number }>(
        `/api/admin/utilisateurs/${id}/droits`,
        { droits },
      )
    },
    onSuccess: (r) => {
      setModifs({})
      setRetour({ ton: 'succes', texte: `${r.droits_enregistres} reglage(s) enregistre(s).` })
      void qc.invalidateQueries({ queryKey: ['droits', id] })
      // La grille de l'utilisateur connecte a pu changer : on la recharge.
      if (id === moi?.id) void qc.invalidateQueries({ queryKey: ['moi'] })
    },
    onError: (e) =>
      setRetour({
        ton: 'erreur',
        texte: e instanceof ErreurApi ? e.message : 'Enregistrement impossible.',
      }),
  })

  const appliquerModele = useMutation({
    mutationFn: () =>
      api.post<{ droits_appliques: number }>(
        `/api/admin/utilisateurs/${id}/droits/appliquer-modele`,
        { module: moduleActif },
      ),
    onSuccess: (r) => {
      setModifs({})
      setRetour({
        ton: 'succes',
        texte: `Modele du role applique au module ${moduleActif} (${r.droits_appliques} champs).`,
      })
      void qc.invalidateQueries({ queryKey: ['droits', id] })
    },
    onError: (e) =>
      setRetour({
        ton: 'erreur',
        texte: e instanceof ErreurApi ? e.message : 'Application impossible.',
      }),
  })

  function reglerTout(niveau: Niveau) {
    const suite = { ...modifs }
    for (const d of lignes) {
      if (d.niveau !== niveau) suite[cle(d)] = niveau
      else delete suite[cle(d)]
    }
    setModifs(suite)
  }

  if (qDroits.isLoading || qUtilisateurs.isLoading) return <Chargement />
  if (!utilisateur) return <Vide texte="Utilisateur introuvable." />

  return (
    <div>
      <EnTetePage
        titre={`Droits par champ — ${utilisateur.nom}`}
        sous_titre={`${utilisateur.login} · role ${utilisateur.role_libelle}`}
        actions={
          <>
            <Link
              to="/utilisateurs"
              className="rounded-lg border border-champ bg-surface px-4 py-2 text-sm text-texte hover:bg-attenue"
            >
              Retour
            </Link>
            {peutEcrire && (
              <Bouton
                variante="secondaire"
                onClick={() => appliquerModele.mutate()}
                disabled={appliquerModele.isPending}
                title={`Reinitialise le module ${moduleActif} depuis le modele du role ${utilisateur.code_role_user}`}
              >
                Appliquer le modele du role
              </Bouton>
            )}
            {peutEcrire && (
              <Bouton
                onClick={() => enregistrer.mutate()}
                disabled={nbModifs === 0 || enregistrer.isPending}
              >
                {nbModifs > 0 ? `Enregistrer (${nbModifs})` : 'Enregistrer'}
              </Bouton>
            )}
          </>
        }
      />

      {retour && (
        <div className="mb-4">
          <Message ton={retour.ton}>{retour.texte}</Message>
        </div>
      )}

      {!peutEcrire && (
        <div className="mb-4">
          <Message ton="info">
            Vous consultez cette grille en lecture seule.
          </Message>
        </div>
      )}

      {/* --- Selection du module ------------------------------------------- */}
      <div className="defilement-x mb-4 -mx-1 flex gap-1 pb-1">
        {modules.map((m) => {
          const n = Object.keys(modifs).filter((k) => k.startsWith(`${m}.`)).length
          return (
            <button
              key={m}
              onClick={() => setModule(m)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition ${
                m === moduleActif
                  ? 'bg-accent font-medium text-accent-texte'
                  : 'bg-surface text-texte hover:bg-attenue'
              }`}
            >
              {m}
              {n > 0 && (
                <span className="ml-1.5 rounded bg-alerte px-1 text-xs text-texte">
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* --- Recherche et reglages en masse --------------------------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Filtrer les champs..."
          className="min-w-[200px] flex-1 rounded-lg border border-champ px-3 py-2 text-sm outline-none focus:border-anneau"
        />
        {peutEcrire && (
          <div className="flex gap-1">
            <span className="self-center text-xs text-attenue-texte">Tout regler :</span>
            {NIVEAUX.map((n) => (
              <button
                key={n.valeur}
                onClick={() => reglerTout(n.valeur)}
                className="rounded border border-champ bg-surface px-2 py-1 text-xs text-texte hover:bg-attenue"
              >
                {n.libelle}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* --- Grille ---------------------------------------------------------- */}
      {lignes.length === 0 ? (
        <Vide texte="Aucun champ pour ce filtre." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-bordure bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-bordure bg-attenue">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-texte">Champ</th>
                <th className="hidden px-3 py-2 text-left font-semibold text-texte lg:table-cell">
                  Nom technique
                </th>
                <th className="px-3 py-2 text-right font-semibold text-texte">Niveau</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ligne">
              {lignes.map((d) => {
                const courant = niveauCourant(d)
                const modifie = cle(d) in modifs
                return (
                  <tr key={cle(d)} className={modifie ? 'bg-alerte/10' : ''}>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-texte">{d.libelle}</span>
                        {d.sensible === 1 && <Etiquette ton="ambre">sensible</Etiquette>}
                        {!d.explicite && <Etiquette ton="gris">par defaut</Etiquette>}
                      </div>
                      <div className="text-xs text-attenue-texte lg:hidden">{d.champ}</div>
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-xs text-attenue-texte lg:table-cell">
                      {d.champ}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-0.5">
                        {NIVEAUX.map((n) => (
                          <button
                            key={n.valeur}
                            disabled={!peutEcrire}
                            onClick={() =>
                              setModifs((m) => {
                                const s = { ...m }
                                if (n.valeur === d.niveau) delete s[cle(d)]
                                else s[cle(d)] = n.valeur
                                return s
                              })
                            }
                            className={`rounded px-2.5 py-1 text-xs font-medium transition
                                        disabled:cursor-not-allowed disabled:opacity-50
                                        ${
                                          courant === n.valeur
                                            ? n.classe
                                            : 'bg-attenue text-attenue-texte hover:bg-attenue-texte/20'
                                        }`}
                          >
                            {n.libelle}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-attenue-texte">
        Un champ <strong>masque</strong> n'est pas envoye par le serveur. Un champ en{' '}
        <strong>lecture</strong> est refuse a l'ecriture par le serveur, pas seulement grise a
        l'ecran. Les champs marques <em>par defaut</em> n'ont pas de reglage propre et suivent la
        valeur du catalogue.
      </p>
    </div>
  )
}
