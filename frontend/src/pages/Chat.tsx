/**
 * Le chatbot de l'ERP.
 *
 * UNE CONVERSATION, PAS UN FORMULAIRE. On pose la question dans ses mots ; le
 * modele choisit la competence qui apporte le chiffre, et le serveur l'execute.
 * L'ecran precedent offrait un catalogue de questions toutes faites : il ne
 * repondait qu'a ce qui avait ete prevu, et personne ne lit une liste de
 * quinze questions pour en trouver la sienne.
 *
 * CE QUE L'ECRAN MONTRE ET QUE LES AUTRES CACHENT :
 *
 *   D'OU VIENT LE CHIFFRE. Chaque reponse porte la liste des competences
 *   employees. Un assistant qui affirme sans dire d'ou il tient son chiffre ne
 *   se verifie pas, et un chiffre inverifiable dans un ERP ne sert a rien.
 *
 *   QUEL MOTEUR REPOND. Le modele local ne fait rien sortir de l'entreprise
 *   mais met des dizaines de secondes ; l'API est rapide mais les donnees
 *   partent. La difference se voit, elle ne se devine pas.
 *
 *   QUE RIEN N'EST ENREGISTRE. Une demande de saisie produit un BROUILLON,
 *   affiche avec un bouton pour aller le relire. L'enregistrement reste un
 *   geste humain.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Cpu,
  Cloud,
  FileText,
  Loader2,
  Send,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { api, ErreurApi } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Bouton, Carte, CarteCorps, Champ } from '../composants/ui/base'
import { cn } from '../lib/utils'

interface Echange {
  role: 'utilisateur' | 'assistant'
  texte: string
  competences?: { nom: string; arguments: Record<string, unknown> }[]
  brouillon?: Brouillon | null
  erreur?: boolean
}

interface Brouillon {
  brouillon: boolean
  type: string
  ecran: string
  resume: string
  formulaire: Record<string, unknown>
}

interface Reponse {
  reponse: string
  competences: { nom: string; arguments: Record<string, unknown> }[]
  brouillon: Brouillon | null
  moteur: string
}

interface Etat {
  moteur: string
  modele: string
  local: boolean
  note: string
  /** Le moteur demande, quand ce n'est pas celui qui repond. */
  repli_depuis?: string | null
  manque_cle?: boolean
}

interface ModeleDispo {
  nom: string
  moteur: string
  taille_go?: number
  note: string
}

interface Modeles {
  moteur_actuel: string
  modele_actuel: string
  cle_claude_presente: boolean
  locaux: ModeleDispo[]
  distants: ModeleDispo[]
}

interface CompetenceDecrite {
  nom: string
  description: string
  module: string
  ecran: string | null
  autorisee: boolean
}

/** Quelques amorces, pour que l'ecran vide ne soit pas une page blanche. */
const AMORCES = [
  'Qu est-ce qui manque en stock ?',
  'Combien vaut notre stock aujourd hui ?',
  'Quels fournisseurs livrent en retard ?',
  'Par quoi remplacer le polypropylene rouge ?',
  'Qu est-ce qu on doit commander cette semaine ?',
]

/** Une ligne du selecteur : le nom, ce qu'il coute, et son etat. */
function LigneModele({
  m,
  actif,
  surChoix,
  enCours,
}: {
  m: ModeleDispo
  actif: boolean
  surChoix: () => void
  enCours: boolean
}) {
  return (
    <button
      type="button"
      onClick={surChoix}
      disabled={enCours || actif}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
        actif ? 'bg-primaire/12' : 'hover:bg-attenue',
      )}
    >
      <span className="mt-0.5 w-4 shrink-0">
        {actif ? <Check className="size-3.5 text-primaire" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-1.5">
          <span className="font-mono text-[12px] font-medium text-texte">{m.nom}</span>
          {m.taille_go ? (
            <span className="text-[11px] text-attenue-texte">{m.taille_go} Go</span>
          ) : null}
        </span>
        <span className="block text-[11px] leading-snug text-attenue-texte">{m.note}</span>
      </span>
    </button>
  )
}

export function Chat() {
  const { moi } = useAuth()
  const naviguer = useNavigate()
  const [saisie, setSaisie] = useState('')
  const [fil, setFil] = useState<Echange[]>([])
  const [aide, setAide] = useState(false)
  const [choixOuvert, setChoixOuvert] = useState(false)
  const basDuFil = useRef<HTMLDivElement>(null)

  const qEtat = useQuery({
    queryKey: ['chat-etat'],
    queryFn: () => api.get<Etat>('/api/chat/etat'),
    retry: false,
  })
  const qModeles = useQuery({
    queryKey: ['chat-modeles'],
    queryFn: () => api.get<Modeles>('/api/chat/modeles'),
    retry: false,
  })

  /* LA BASCULE PREND EFFET A LA QUESTION SUIVANTE, sans redemarrage : le
     serveur relit le reglage a chaque appel. On rafraichit donc l'etat plutot
     que de demander a l'utilisateur de recharger la page. */
  const basculer = useMutation({
    mutationFn: (m: ModeleDispo) =>
      api.post('/api/chat/modeles', { moteur: m.moteur, modele: m.nom }),
    onSuccess: () => {
      void qEtat.refetch()
      void qModeles.refetch()
      setChoixOuvert(false)
    },
  })

  const qCompetences = useQuery({
    queryKey: ['chat-competences'],
    queryFn: () => api.get<{ competences: CompetenceDecrite[] }>('/api/chat/competences'),
    retry: false,
    enabled: aide,
  })

  // Le fil suit la derniere reponse : sans cela, une reponse longue arrive hors
  // de l'ecran et l'on croit qu'il ne s'est rien passe.
  useEffect(() => {
    basDuFil.current?.scrollIntoView({ behavior: 'smooth' })
  }, [fil])

  const envoyer = useMutation({
    mutationFn: (question: string) =>
      api.post<Reponse>('/api/chat', {
        messages: [...fil, { role: 'utilisateur', texte: question }].map((e) => ({
          role: e.role,
          texte: e.texte,
        })),
      }),
    onSuccess: (r) =>
      setFil((f) => [
        ...f,
        {
          role: 'assistant',
          texte: r.reponse,
          competences: r.competences,
          brouillon: r.brouillon,
        },
      ]),
    onError: (e) =>
      setFil((f) => [
        ...f,
        {
          role: 'assistant',
          erreur: true,
          texte:
            e instanceof ErreurApi
              ? e.message
              : 'Le moteur n a pas repondu. Verifiez qu il est demarre.',
        },
      ]),
  })

  function poser(question: string) {
    const q = question.trim()
    if (!q || envoyer.isPending) return
    setFil((f) => [...f, { role: 'utilisateur', texte: q }])
    setSaisie('')
    envoyer.mutate(q)
  }

  const etat = qEtat.data
  const local = etat?.local ?? true

  // `h-full` ne resout pas : les ancetres de cet ecran ne sont pas en flex. Une
  // hauteur minimale calculee garde la saisie EN BAS DE LA FENETRE, la ou la
  // main la cherche, au lieu de la laisser flotter au milieu du vide.
  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-4xl flex-col">
      <EnTetePage
        titre="Assistant"
        description="Posez votre question dans vos mots. Les chiffres viennent des memes vues que les ecrans."
        actions={
          <div className="flex items-center gap-2">
            {etat && (
              <Bouton
                variante="contour"
                taille="sm"
                onClick={() => setChoixOuvert((o) => !o)}
                title={etat.note}
              >
                {local ? <Cpu /> : <Cloud />}
                {local ? 'Local' : 'Claude'} · {etat.modele}
                <ChevronDown />
              </Bouton>
            )}
            <Bouton variante="contour" taille="sm" onClick={() => setAide((a) => !a)}>
              <Wrench />
              Competences
            </Bouton>
          </div>
        }
      />

      {/* LE CHOIX DU MODELE EST DANS L'ECRAN, pas dans un fichier du serveur.
          Chaque ligne porte ce qu'elle coute : sur un processeur sans carte
          graphique la vitesse tombe a peu pres comme le nombre de parametres,
          et un modele plus gros ne sera jamais plus rapide. Le dire evite d'en
          essayer trois pour le decouvrir. */}
      {choixOuvert && qModeles.data && (
        <Carte className="mb-3">
          <CarteCorps className="space-y-2">
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-texte">
                <Cpu className="size-3.5" />
                Sur le serveur — aucune donnee ne sort
              </div>
              {qModeles.data.locaux.length === 0 && (
                <p className="text-[12px] text-attenue-texte">
                  Aucun modele installe, ou le service ollama est arrete.
                </p>
              )}
              {qModeles.data.locaux.map((m) => (
                <LigneModele
                  key={m.nom}
                  m={m}
                  actif={m.nom === etat?.modele && local}
                  surChoix={() => basculer.mutate(m)}
                  enCours={basculer.isPending}
                />
              ))}
            </div>

            <div className="border-t border-bordure pt-2">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-texte">
                <Cloud className="size-3.5" />
                Par l API — la question et les chiffres partent chez Anthropic
              </div>
              {!qModeles.data.cle_claude_presente && (
                <p className="mb-1 text-[12px] text-alerte">
                  Aucune cle d API sur le serveur : ces modeles se choisissent, mais c est le
                  modele local qui repondra tant que <code>ANTHROPIC_API_KEY</code> n est pas
                  posee dans <code>/opt/gestionfil/.env</code>.
                </p>
              )}
              {qModeles.data.distants.map((m) => (
                <LigneModele
                  key={m.nom}
                  m={m}
                  actif={m.nom === etat?.modele && !local}
                  surChoix={() => basculer.mutate(m)}
                  enCours={basculer.isPending}
                />
              ))}
            </div>
          </CarteCorps>
        </Carte>
      )}

      {/* LE REPLI EST DIT. Regler « claude » dans les parametres sans avoir
          pose la cle d'API laisse le moteur local repondre : sans ce bandeau,
          on cherche pendant une heure pourquoi c'est toujours aussi lent. */}
      {etat?.manque_cle && (
        <Alerte ton="alerte" className="mb-3" titre="Claude est demande mais la cle manque">
          Le parametre demande Claude, mais aucune cle d API n est posee sur le serveur : c est
          donc le modele local qui repond. Ajoutez <code>ANTHROPIC_API_KEY</code> dans
          <code> /opt/gestionfil/.env</code>, puis redemarrez le service.
        </Alerte>
      )}

      {/* LA LENTEUR DU MOTEUR LOCAL EST ANNONCEE. Sans cet avertissement, une
          attente de quarante secondes passe pour une panne, et l'utilisateur
          recharge la page au moment ou la reponse allait arriver. */}
      {local && !etat?.manque_cle && fil.length === 0 && (
        <Alerte ton="info" className="mb-3">
          Le modele tourne sur le serveur : aucune donnee ne sort de l entreprise. Sans carte
          graphique, comptez plusieurs dizaines de secondes par reponse.
        </Alerte>
      )}

      {aide && (
        <Carte className="mb-3">
          <CarteCorps className="space-y-1.5">
            <p className="text-[12px] text-attenue-texte">
              L assistant ne devine pas : il emploie ces competences, et rien d autre. Celles que
              votre role n autorise pas sont grisees.
            </p>
            {(qCompetences.data?.competences ?? []).map((c) => (
              <div
                key={c.nom}
                className={cn(
                  'flex gap-2 text-[12px]',
                  c.autorisee ? 'text-texte' : 'text-attenue-texte opacity-50',
                )}
              >
                <span className="w-44 shrink-0 font-mono text-[11px]">{c.nom}</span>
                <span className="min-w-0 flex-1">{c.description}</span>
              </div>
            ))}
          </CarteCorps>
        </Carte>
      )}

      {/* --- Le fil ------------------------------------------------------- */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {fil.length === 0 && (
          <div className="py-8 text-center">
            <Bot className="mx-auto size-8 text-attenue-texte" />
            <p className="mt-2 text-[13px] text-attenue-texte">
              Bonjour {moi?.login}. Que voulez-vous savoir ?
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {AMORCES.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => poser(a)}
                  className="rounded-full border border-bordure px-3 py-1.5 text-[12px] text-attenue-texte transition-colors hover:border-primaire hover:text-texte"
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}

        {fil.map((e, i) => (
          <div
            key={i}
            className={cn('flex', e.role === 'utilisateur' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed',
                e.role === 'utilisateur'
                  ? 'bg-primaire text-primaire-texte'
                  : e.erreur
                    ? 'border border-danger/40 bg-danger/10 text-texte'
                    : 'border border-bordure bg-surface text-texte',
              )}
            >
              {e.erreur && <CircleAlert className="mb-1 size-4 text-danger" />}
              <p className="whitespace-pre-wrap">{e.texte}</p>

              {/* D'OU VIENT LE CHIFFRE. */}
              {!!e.competences?.length && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-bordure pt-1.5">
                  {e.competences.map((c, k) => (
                    <span
                      key={k}
                      className="rounded bg-attenue px-1.5 py-0.5 font-mono text-[10px] text-attenue-texte"
                      title={JSON.stringify(c.arguments)}
                    >
                      {c.nom}
                    </span>
                  ))}
                </div>
              )}

              {/* LE BROUILLON : rien n'est enregistre tant qu'on n'a pas relu. */}
              {e.brouillon?.brouillon && (
                <div className="mt-2 rounded-lg border border-alerte/40 bg-alerte/10 p-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium">
                    <FileText className="size-3.5" />
                    Brouillon — rien n est enregistre
                  </div>
                  <p className="mt-0.5 text-[12px]">{e.brouillon.resume}</p>
                  <Bouton
                    taille="sm"
                    className="mt-1.5"
                    onClick={() =>
                      naviguer(e.brouillon!.ecran, { state: { brouillon: e.brouillon } })
                    }
                  >
                    Relire et valider
                    <ArrowRight />
                  </Bouton>
                </div>
              )}
            </div>
          </div>
        ))}

        {envoyer.isPending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-xl border border-bordure bg-surface px-3 py-2 text-[13px] text-attenue-texte">
              <Loader2 className="size-4 animate-spin" />
              {local ? 'Le modele local reflechit…' : 'Reflexion…'}
            </div>
          </div>
        )}
        <div ref={basDuFil} />
      </div>

      {/* --- La saisie ---------------------------------------------------- */}
      <form
        onSubmit={(ev) => {
          ev.preventDefault()
          poser(saisie)
        }}
        className="flex shrink-0 items-center gap-2 border-t border-bordure pt-3"
      >
        <Champ
          value={saisie}
          onChange={(ev) => setSaisie(ev.target.value)}
          placeholder="Posez votre question…"
          className="flex-1"
          autoFocus
          disabled={envoyer.isPending}
        />
        <Bouton type="submit" disabled={!saisie.trim() || envoyer.isPending}>
          {envoyer.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        </Bouton>
        {fil.length > 0 && (
          <Bouton variante="contour" type="button" onClick={() => setFil([])}>
            <Sparkles />
            Nouvelle
          </Bouton>
        )}
      </form>
    </div>
  )
}
