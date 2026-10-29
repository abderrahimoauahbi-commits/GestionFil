/**
 * LE GUIDE PAS À PAS — le tutoriel du cycle complet, par rôle (27/10/2026).
 *
 * IL NE LIT PLUS UN FICHIER MARKDOWN. Le guide d'avant (`guide-utilisateur.md`)
 * était un second texte, écrit à part du catalogue d'aide, et il avait dérivé :
 * des écrans retirés, des boutons renommés, des règles changées. Ce guide rend
 * `TUTORIEL` (`aide/tutoriel.ts`), et pour chaque champ qu'il nomme, il lit la
 * description dans la FICHE DE L'ÉCRAN — la même que montrent le ⓘ du champ,
 * le « ? » de l'écran et le manuel imprimable. Un seul texte, corrigé une fois.
 *
 * ON PEUT NE SUIVRE QUE SON RÔLE : le magasinier n'a que faire de la
 * validation des bons. Le filtre garde l'ordre du cycle.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Printer, TriangleAlert } from 'lucide-react'
import { EnTetePage } from '../composants/Coquille'
import { Badge, Bouton } from '../composants/ui/base'
import { SUJETS } from '../aide/contenu'
import { champDans, sujetDans } from '../aide/indice'
import { TUTORIEL } from '../aide/tutoriel'
import type { EtapeTutoriel, RoleTutoriel } from '../aide/types'
import { cn } from '../lib/utils'

const ROLES: RoleTutoriel[] = ['Acheteur', 'Magasinier', 'Responsable', 'Direction']

/** L'ancre d'une partie, pour le sommaire. */
const ancre = (i: number) => `partie-${i + 1}`

export function GuideUtilisateur() {
  const naviguer = useNavigate()
  const [role, setRole] = useState<RoleTutoriel | ''>('')

  // La numérotation reste celle du cycle complet, même filtrée : « étape 12 »
  // désigne la même étape pour tout le monde.
  const parties = useMemo(() => {
    let n = 0
    return TUTORIEL.parties.map((p) => ({
      ...p,
      etapes: p.etapes
        .map((e) => ({ etape: e, numero: ++n }))
        .filter((x) => !role || x.etape.role === role),
    }))
  }, [role])

  return (
    <div>
      <EnTetePage
        titre="Guide utilisateur"
        description="Le cycle complet du fil, pas à pas, par rôle"
        actions={
          <>
            <Bouton variante="contour" onClick={() => naviguer('/etats/manuel')}>
              <Printer />
              Manuel imprimable
            </Bouton>
            <Bouton variante="contour" onClick={() => naviguer('/')}>
              <ArrowLeft />
              Retour
            </Bouton>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
        {/* LE SOMMAIRE : sur téléphone, il passe au-dessus et se replie. */}
        <aside className="min-w-0">
          <nav
            aria-label="Sommaire du guide"
            className="rounded-[var(--radius)] border border-bordure bg-surface p-3 lg:sticky lg:top-4"
          >
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold">
              <BookOpen className="size-4 text-primaire" />
              Sommaire
            </div>
            <ol className="m-0 list-none space-y-1 p-0 text-[12.5px]">
              {TUTORIEL.parties.map((p, i) => (
                <li key={p.titre}>
                  <a href={`#${ancre(i)}`} className="text-attenue-texte hover:text-primaire">
                    {p.titre}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          <section className="rounded-[var(--radius)] border border-bordure bg-surface p-4">
            <h2 className="m-0 text-[15px] font-semibold">{TUTORIEL.titre}</h2>
            <p className="mb-0 mt-1.5 text-[13px] leading-relaxed">{TUTORIEL.introduction}</p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {TUTORIEL.roles.map((r) => (
                <div key={r.role} className="rounded border border-bordure bg-attenue/25 px-2.5 py-2 text-[12.5px]">
                  <div className="font-semibold">{r.role}</div>
                  <div>{r.mission}</div>
                  <div className="mt-0.5 text-[11.5px] text-attenue-texte">{r.droits}</div>
                </div>
              ))}
            </div>

            {/* LE FILTRE PAR RÔLE : des puces, pas une liste déroulante — quatre
                choix se lisent d'un coup d'œil, et se touchent au doigt. */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Rôle suivi">
              <span className="text-[12px] text-attenue-texte">Suivre :</span>
              {(['', ...ROLES] as const).map((r) => (
                <button
                  key={r || 'tous'}
                  type="button"
                  aria-pressed={role === r}
                  onClick={() => setRole(r)}
                  className={cn(
                    'min-h-[30px] rounded-full border px-3 text-[12.5px] transition-colors',
                    role === r
                      ? 'border-primaire bg-primaire text-primaire-texte'
                      : 'border-bordure bg-surface hover:border-primaire/50',
                  )}
                >
                  {r || 'Tout le cycle'}
                </button>
              ))}
            </div>
          </section>

          {parties.map((p, i) => (
            <section key={p.titre} id={ancre(i)} className="scroll-mt-4 space-y-3">
              <h2 className="m-0 border-b border-bordure pb-1 text-[15px] font-semibold">{p.titre}</h2>
              {p.introduction && <p className="m-0 text-[13px] leading-relaxed text-attenue-texte">{p.introduction}</p>}
              {p.etapes.length === 0 && (
                <p className="m-0 text-[12.5px] italic text-attenue-texte">Aucune étape pour ce rôle dans cette partie.</p>
              )}
              {p.etapes.map(({ etape, numero }) => (
                <CarteEtape
                  key={numero}
                  etape={etape}
                  numero={numero}
                  ouvrir={etape.route.includes(':') ? undefined : () => naviguer(etape.route)}
                />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function CarteEtape({
  etape,
  numero,
  ouvrir,
}: {
  etape: EtapeTutoriel
  numero: number
  ouvrir?: () => void
}) {
  // Les champs nommés par l'étape, décrits par la fiche de leur écran.
  const sujet = sujetDans(SUJETS, etape.route)
  const champs = (etape.champs ?? []).map((nom) => ({ nom, champ: champDans(sujet, nom) }))

  return (
    <article className="rounded-[var(--radius)] border border-bordure bg-surface p-3.5 text-[13px] leading-relaxed">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="grid size-6 shrink-0 place-items-center rounded bg-primaire/10 text-[12px] font-semibold tabular-nums text-primaire">
          {numero}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[14px] font-semibold">{etape.titre}</h3>
          <div className="text-[12px] text-attenue-texte">{etape.acces}</div>
        </div>
        <Badge ton="neutre">{etape.role}</Badge>
        {ouvrir && (
          <Bouton variante="contour" taille="sm" onClick={ouvrir}>
            Ouvrir l’écran
            <ArrowRight />
          </Bouton>
        )}
      </header>

      <ol className="m-0 mt-2 list-decimal space-y-1 pl-5">
        {etape.gestes.map((g, i) => (
          <li key={i}>{g}</li>
        ))}
      </ol>

      {champs.length > 0 && (
        <details className="mt-2 rounded border border-bordure bg-attenue/20 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[12.5px] font-medium">
            Les champs à remplir ({champs.length}) — décrits dans l’aide de l’écran
          </summary>
          <dl className="m-0 mt-1.5 space-y-1.5">
            {champs.map(({ nom, champ }) => (
              <div key={nom}>
                <dt className="font-semibold">
                  {nom}
                  {champ?.obligatoire && (
                    <span className="ml-1.5 rounded bg-danger/10 px-1 text-[10px] font-semibold uppercase tracking-wide text-danger">
                      obligatoire
                    </span>
                  )}
                </dt>
                <dd className="m-0 text-[12.5px] text-attenue-texte">{champ?.description ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <p className="mb-0 mt-2 flex gap-1.5 border-l-2 border-succes pl-2 text-[12.5px]">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-succes" aria-hidden />
        <span>
          <span className="font-semibold">Résultat : </span>
          {etape.resultat}
        </span>
      </p>
      {etape.erreur && (
        <p className="mb-0 mt-1.5 flex gap-1.5 border-l-2 border-alerte pl-2 text-[12.5px]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-alerte" aria-hidden />
          <span>
            <span className="font-semibold">Erreur fréquente : </span>
            {etape.erreur}
          </span>
        </p>
      )}
    </article>
  )
}
