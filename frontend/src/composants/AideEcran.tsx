/**
 * L'AIDE CONTEXTUELLE — le « ? » que porte chaque écran.
 *
 * Elle suit la forme des grands ERP : objectif, prérequis, procédure numérotée,
 * TABLEAU DES CHAMPS, règles de gestion, messages de refus, écrans liés. Cet
 * ordre n'est pas décoratif — c'est l'ordre dans lequel les questions se posent
 * devant un écran qu'on ne connaît pas.
 *
 * ELLE SE TROUVE TOUTE SEULE. Le panneau lit la route courante et cherche sa
 * fiche : aucun écran n'a à la déclarer, donc aucun ne peut l'oublier. Un écran
 * sans fiche montre ce qu'il dit déjà de lui-même, et le panneau le dit.
 *
 * ELLE NE RECOUVRE PAS LA SAISIE. Sur large écran c'est un panneau latéral
 * qu'on garde ouvert en travaillant ; sur téléphone il prend l'écran, parce
 * qu'à cette largeur deux colonnes ne se lisent pas.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, ExternalLink, HelpCircle, X } from 'lucide-react'
import { sujetPour } from '../aide/contenu'
import type { Sujet } from '../aide/types'
import { cn } from '../lib/utils'

const titreSection =
  'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-attenue-texte mb-1.5'

export function AideEcran({ description }: { description?: React.ReactNode }) {
  const emplacement = useLocation()
  const [ouvert, setOuvert] = useState(false)
  const sujet = sujetPour(emplacement.pathname)

  // On ferme en changeant d'écran : l'aide d'un autre écran resterait ouverte
  // sur le nouveau, ce qui est pire que pas d'aide du tout.
  useEffect(() => setOuvert(false), [emplacement.pathname])

  // Échap ferme, comme partout ailleurs dans l'application.
  useEffect(() => {
    if (!ouvert) return
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuvert(false)
    }
    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [ouvert])

  if (!sujet && !description) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        title={sujet ? `Aide : ${sujet.titre}` : 'Aide'}
        aria-label="Aide de cet écran"
        data-aide-bouton
        className="grid size-5 shrink-0 place-items-center rounded-full border border-bordure
                   text-[11px] text-attenue-texte transition-colors hover:border-primaire
                   hover:text-primaire focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-primaire"
      >
        <HelpCircle className="size-3.5" />
      </button>

      {ouvert && createPortal(
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/20 lg:bg-transparent"
            onClick={() => setOuvert(false)}
            aria-hidden
          />
          <aside
            data-aide-panneau
            role="dialog"
            aria-label={sujet ? `Aide : ${sujet.titre}` : 'Aide'}
            className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-[30rem] flex-col
                       border-l border-bordure bg-surface shadow-2xl"
          >
            <header className="flex items-start gap-2 border-b border-bordure bg-attenue/30 px-4 py-2.5">
              <BookOpen className="mt-0.5 size-4 shrink-0 text-primaire" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold leading-tight">
                  {sujet?.titre ?? 'Aide'}
                </div>
                {sujet && (
                  <div className="text-[11px] text-attenue-texte">{sujet.chemin}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOuvert(false)}
                aria-label="Fermer l’aide"
                className="rounded p-1 text-attenue-texte hover:bg-attenue hover:text-texte"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3.5 text-[13px] leading-relaxed">
              {sujet ? <Fiche sujet={sujet} surNavigation={() => setOuvert(false)} /> : null}

              {!sujet && description && (
                <div>
                  <div className={titreSection}>Cet écran</div>
                  <div>{description}</div>
                  <p className="mt-3 text-[12px] text-attenue-texte">
                    La fiche détaillée de cet écran n’est pas encore rédigée.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </>,
        document.body,
      )}
    </>
  )
}

function Fiche({ sujet, surNavigation }: { sujet: Sujet; surNavigation: () => void }) {
  const naviguer = useNavigate()
  return (
    <>
      <section>
        <div className={titreSection}>Objectif</div>
        <p className="m-0">{sujet.objectif}</p>
      </section>

      {sujet.prerequis && sujet.prerequis.length > 0 && (
        <section>
          <div className={titreSection}>Avant de commencer</div>
          <ul className="m-0 list-disc space-y-1 pl-4">
            {sujet.prerequis.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      {sujet.droits && (
        <section>
          <div className={titreSection}>Qui peut le faire</div>
          <p className="m-0">{sujet.droits}</p>
        </section>
      )}

      {sujet.procedures?.map((proc, i) => (
        <section key={i}>
          <div className={titreSection}>{proc.titre}</div>
          <ol className="m-0 space-y-1.5 pl-0">
            {proc.etapes.map((e, j) => (
              <li key={j} className="grid grid-cols-[1.3rem_minmax(0,1fr)] gap-2">
                <span className="grid h-[1.3rem] place-items-center rounded bg-primaire/10 text-[11px] font-semibold tabular-nums text-primaire">
                  {j + 1}
                </span>
                <span>{e}</span>
              </li>
            ))}
          </ol>
          {proc.resultat && (
            <p className="mb-0 mt-2 border-l-2 border-succes pl-2 text-[12.5px] text-attenue-texte">
              <span className="font-semibold text-succes">Résultat : </span>
              {proc.resultat}
            </p>
          )}
        </section>
      ))}

      {/* LE TABLEAU DES CHAMPS : ce que la personne cherche vraiment quand elle
          hésite devant une case. */}
      {sujet.champs && sujet.champs.length > 0 && (
        <section>
          <div className={titreSection}>Les champs de cet écran</div>
          <dl className="m-0 divide-y divide-bordure/60 rounded border border-bordure">
            {sujet.champs.map((c, i) => (
              <div key={i} className="px-2.5 py-2">
                <dt className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-semibold">{c.nom}</span>
                  {c.obligatoire && (
                    <span className="rounded bg-danger/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-danger">
                      obligatoire
                    </span>
                  )}
                </dt>
                <dd className="m-0 text-[12.5px]">{c.description}</dd>
                {c.valeurs && (
                  <dd className="m-0 text-[11.5px] text-attenue-texte">Valeurs : {c.valeurs}</dd>
                )}
                {c.defaut && (
                  <dd className="m-0 text-[11.5px] text-attenue-texte">Par défaut : {c.defaut}</dd>
                )}
              </div>
            ))}
          </dl>
        </section>
      )}

      {sujet.regles && sujet.regles.length > 0 && (
        <section>
          <div className={titreSection}>Règles de gestion</div>
          <ul className="m-0 list-disc space-y-1 pl-4">
            {sujet.regles.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      {sujet.messages && sujet.messages.length > 0 && (
        <section>
          <div className={titreSection}>Si l’outil refuse</div>
          <div className="space-y-2">
            {sujet.messages.map((m, i) => (
              <div key={i} className="rounded border border-bordure bg-attenue/20 px-2.5 py-2">
                <div className="font-medium text-danger">« {m.message} »</div>
                <div className="text-[12.5px] text-attenue-texte">{m.cause}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sujet.liens && sujet.liens.length > 0 && (
        <section>
          <div className={titreSection}>Écrans liés</div>
          <div className="flex flex-wrap gap-1.5">
            {sujet.liens.map((l, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  surNavigation()
                  naviguer(l.route)
                }}
                className={cn(
                  'inline-flex items-center gap-1 rounded border border-bordure px-2 py-1',
                  'text-[12px] hover:border-primaire hover:text-primaire',
                )}
              >
                {l.libelle}
                <ExternalLink className="size-3" />
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
