/**
 * Parametres systeme.
 *
 * Les parametres verrouilles (P_DateSaisie) ne sont pas modifiables : le
 * serveur refuse la modification via un trigger, et l'interface le signale
 * plutot que de laisser tenter.
 *
 * Rappel metier (CDC B3) : ces valeurs ne servent que de DEFAUT A LA CREATION.
 * Les modifier n'affecte aucune qualite, recette ou plan deja enregistre.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ErreurApi } from '../api/client'
import { useDroits } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { Bouton, Chargement, Etiquette, Message, fmt } from '../components/ui'

const MODULE = 'PARAMETRES'

interface Parametre {
  code_parametre: string
  libelle: string
  valeur_courante: string
  type_donnee: string
  unite: string | null
  categorie: string | null
  verrouille: number
  date_derniere_modif: string
}

export function Parametres() {
  const qc = useQueryClient()
  const droits = useDroits(MODULE)
  const [edition, setEdition] = useState<Record<string, string>>({})
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null)

  const q = useQuery({
    queryKey: ['parametres'],
    queryFn: () => api.get<Parametre[]>('/api/parametres'),
  })

  const enregistrer = useMutation({
    mutationFn: ({ code, valeur }: { code: string; valeur: string }) =>
      api.patch(`/api/parametres/${code}`, {
        valeur_courante: valeur,
        motif: 'Modification depuis l interface',
      }),
    onSuccess: (_, v) => {
      setEdition((e) => {
        const s = { ...e }
        delete s[v.code]
        return s
      })
      setRetour({ ton: 'succes', texte: `Parametre ${v.code} enregistre et historise.` })
      void qc.invalidateQueries({ queryKey: ['parametres'] })
    },
    onError: (e) =>
      setRetour({
        ton: 'erreur',
        texte: e instanceof ErreurApi ? e.message : 'Modification impossible.',
      }),
  })

  if (q.isLoading) return <Chargement />

  const modifiable = droits.modifiable('valeur_courante')

  const parCategorie = (q.data ?? []).reduce<Record<string, Parametre[]>>((acc, p) => {
    const c = p.categorie ?? 'AUTRE'
    ;(acc[c] ??= []).push(p)
    return acc
  }, {})

  return (
    <div>
      <EnTetePage
        titre="Parametres"
        sous_titre="Valeurs par defaut a la creation — les enregistrements existants ne sont pas affectes"
      />

      {retour && (
        <div className="mb-4">
          <Message ton={retour.ton}>{retour.texte}</Message>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(parCategorie).map(([categorie, params]) => (
          <section key={categorie} className="rounded-lg border border-bordure bg-surface">
            <h2 className="border-b border-bordure px-4 py-2.5 text-sm font-semibold text-texte">
              {categorie}
            </h2>
            <ul className="divide-y divide-ligne">
              {params.map((p) => {
                const enCours = edition[p.code_parametre]
                const verrouille = p.verrouille === 1
                return (
                  <li key={p.code_parametre} className="px-4 py-3 sm:flex sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-texte">{p.libelle}</span>
                        {verrouille && <Etiquette ton="rouge">verrouille</Etiquette>}
                      </div>
                      <div className="font-mono text-xs text-attenue-texte">{p.code_parametre}</div>
                    </div>

                    <div className="mt-2 flex items-center gap-2 sm:mt-0">
                      {enCours !== undefined ? (
                        <>
                          <input
                            value={enCours}
                            autoFocus
                            onChange={(e) =>
                              setEdition({ ...edition, [p.code_parametre]: e.target.value })
                            }
                            className="w-28 rounded-lg border border-champ px-2 py-1.5 text-right text-sm outline-none focus:border-anneau"
                          />
                          <Bouton
                            onClick={() =>
                              enregistrer.mutate({ code: p.code_parametre, valeur: enCours })
                            }
                            disabled={enregistrer.isPending}
                          >
                            Enregistrer
                          </Bouton>
                          <Bouton
                            variante="discret"
                            onClick={() =>
                              setEdition((e) => {
                                const s = { ...e }
                                delete s[p.code_parametre]
                                return s
                              })
                            }
                          >
                            Annuler
                          </Bouton>
                        </>
                      ) : (
                        <>
                          <span className="tabular-nums text-texte">
                            {p.valeur_courante}
                            {p.unite && (
                              <span className="ml-1 text-xs text-attenue-texte">{p.unite}</span>
                            )}
                          </span>
                          {modifiable && !verrouille && (
                            <Bouton
                              variante="secondaire"
                              onClick={() =>
                                setEdition({
                                  ...edition,
                                  [p.code_parametre]: p.valeur_courante,
                                })
                              }
                            >
                              Modifier
                            </Bouton>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-4 text-xs text-attenue-texte">
        Chaque modification est historisee (ancienne valeur, nouvelle valeur, auteur, date) et
        tracee dans le journal d'audit. Derniere lecture : {fmt.date(new Date().toISOString())}.
      </p>
    </div>
  )
}
