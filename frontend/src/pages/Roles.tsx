/**
 * Rôles et permissions (13/10/2026), réservés au rôle Administrateur.
 *
 * La liste des rôles se tient dans Paramètres › Paramètres utilisateurs ;
 * chaque rôle s'ouvre sur son propre écran (`/roles/:code`, `/roles/nouveau`) :
 *   * son libellé et son plafond de validation des bons (vide = sans plafond) ;
 *   * ses permissions, module par module : lire, écrire, valider ;
 *   * le modèle de visibilité de ses champs : masqué, lecture, écriture.
 * Le modèle s'applique aux utilisateurs du rôle, sauf aux champs réglés à la
 * main pour l'un d'eux (écran « Droits par champ » de l'utilisateur). Un rôle
 * porté par un utilisateur ne se supprime pas ; l'Administrateur garde
 * toujours la gestion des utilisateurs : la base le garantit.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api, ErreurApi } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../composants/Coquille'
import { Alerte, Badge, Bouton, Carte, CarteCorps, CarteEntete, CarteTitre, Champ, Chargement, Etiq, Selecteur } from '../composants/ui/base'
import { useConfirmation } from '../composants/ui/surcouches'
import { useGardeSaisie } from '../hooks/useGardeSaisie'
import { cn, fmt } from '../lib/utils'

type Niveau = 'MASQUE' | 'LECTURE' | 'ECRITURE'
type Action = 'LIRE' | 'ECRIRE' | 'VALIDER'

interface RoleResume {
  code_role_user: string
  libelle: string
  description: string | null
  plafond_validation_bc_mad: number | null
  nb_utilisateurs: number
  exige_totp?: boolean
}

interface FicheRole {
  role: RoleResume
  permissions: { module: string; action: Action }[]
  champs: {
    module: string
    champ: string
    libelle: string
    sensible: number
    niveau: Niveau
    niveau_defaut: Niveau
    au_modele: boolean
  }[]
  modules: { module: string; libelle: string; description: string }[]
}

interface Enregistre {
  code_role_user: string
  droits_repercutes?: number
}

const ACTIONS: { valeur: Action; libelle: string }[] = [
  { valeur: 'LIRE', libelle: 'Lire' },
  { valeur: 'ECRIRE', libelle: 'Écrire' },
  { valeur: 'VALIDER', libelle: 'Valider' },
]

const NIVEAUX: { valeur: Niveau; libelle: string; classe: string }[] = [
  { valeur: 'MASQUE', libelle: 'Masqué', classe: 'bg-danger text-danger-texte' },
  { valeur: 'LECTURE', libelle: 'Lecture', classe: 'bg-alerte text-white' },
  { valeur: 'ECRITURE', libelle: 'Écriture', classe: 'bg-succes text-white' },
]

const echec = (e: unknown) => toast.error(e instanceof ErreurApi ? e.message : 'Opération impossible.')
const estAdmin = (role?: string) => role === 'ADMIN'
const clePerm = (module: string, action: string) => `${module}/${action}`
const cleChamp = (module: string, champ: string) => `${module}.${champ}`

// ============================================================================
// La liste, montée dans Paramètres
// ============================================================================

export function ListeRoles() {
  const { moi } = useAuth()
  const naviguer = useNavigate()
  const q = useQuery({
    queryKey: ['roles'],
    queryFn: ({ signal }) => api.get<RoleResume[]>('/api/admin/roles', { signal }),
    enabled: estAdmin(moi?.role),
  })
  if (!estAdmin(moi?.role)) {
    return <Alerte ton="info">Les rôles et leurs permissions se règlent par le rôle Administrateur.</Alerte>
  }
  if (q.isLoading) return <Chargement texte="Lecture des rôles…" />
  return (
    <Carte>
      <CarteEntete className="flex flex-wrap items-center justify-between gap-2">
        <CarteTitre>Rôles et permissions</CarteTitre>
        <Bouton onClick={() => naviguer('/roles/nouveau')}>
          <Plus />
          Nouveau rôle
        </Bouton>
      </CarteEntete>
      <CarteCorps className="p-0">
        <ul className="divide-y divide-ligne">
          {(q.data ?? []).map((r) => (
            <li key={r.code_role_user}>
              <button
                type="button"
                onClick={() => naviguer(`/roles/${encodeURIComponent(r.code_role_user)}`)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-attenue"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-texte">{r.libelle}</span>
                  <span className="ml-2 font-mono text-[11px] text-attenue-texte">{r.code_role_user}</span>
                  {r.description && <span className="block text-[12px] text-attenue-texte">{r.description}</span>}
                </span>
                <span className="text-[12px] text-attenue-texte">
                  {r.plafond_validation_bc_mad === null ? 'sans plafond' : `plafond ${fmt.mad(r.plafond_validation_bc_mad)}`}
                </span>
                <Badge ton={r.nb_utilisateurs > 0 ? 'info' : 'neutre'}>
                  {r.nb_utilisateurs} utilisateur{r.nb_utilisateurs > 1 ? 's' : ''}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      </CarteCorps>
    </Carte>
  )
}

// ============================================================================
// Un rôle, sur son écran
// ============================================================================

export function Role() {
  const { code = 'nouveau' } = useParams()
  const { moi } = useAuth()
  const nouveau = code === 'nouveau'
  // Un rôle neuf part de l'ensemble des modules et des champs : on les lit sur
  // le rôle Administrateur, sans en reprendre les réglages.
  const lu = nouveau ? 'ADMIN' : code
  const q = useQuery({
    queryKey: ['role', lu],
    queryFn: ({ signal }) => api.get<FicheRole>(`/api/admin/roles/${encodeURIComponent(lu)}`, { signal }),
    enabled: estAdmin(moi?.role),
  })
  if (!estAdmin(moi?.role)) {
    return <Alerte ton="info">Les rôles et leurs permissions se règlent par le rôle Administrateur.</Alerte>
  }
  if (q.isLoading) return <Chargement texte="Lecture du rôle…" />
  if (!q.data) return <Alerte ton="alerte">Rôle introuvable.</Alerte>
  return <EditeurRole key={nouveau ? 'nouveau' : JSON.stringify(q.data)} nouveau={nouveau} fiche={q.data} />
}

function EditeurRole({ nouveau, fiche }: { nouveau: boolean; fiche: FicheRole }) {
  const naviguer = useNavigate()
  const qc = useQueryClient()
  const confirmation = useConfirmation()
  const code = fiche.role.code_role_user
  const admin = !nouveau && code === 'ADMIN'

  // Valeurs de depart : celles du role, ou un role vide (aucune permission,
  // champs au niveau par defaut du catalogue).
  const permsDepart = useMemo(
    () => new Set(nouveau ? [] : fiche.permissions.map((p) => clePerm(p.module, p.action))),
    [nouveau, fiche],
  )
  const champsDepart = useMemo(() => {
    const m: Record<string, Niveau> = {}
    for (const c of fiche.champs) m[cleChamp(c.module, c.champ)] = nouveau ? c.niveau_defaut : c.niveau
    return m
  }, [nouveau, fiche])

  const [codeSaisi, setCodeSaisi] = useState('')
  const [libelle, setLibelle] = useState(nouveau ? '' : fiche.role.libelle)
  const [description, setDescription] = useState(nouveau ? '' : fiche.role.description ?? '')
  const [plafond, setPlafond] = useState(
    nouveau || fiche.role.plafond_validation_bc_mad === null ? '' : String(fiche.role.plafond_validation_bc_mad),
  )
  const [exigeTotp, setExigeTotp] = useState(nouveau ? false : fiche.role.exige_totp === true)
  const [perms, setPerms] = useState<Set<string>>(permsDepart)
  const [champs, setChamps] = useState<Record<string, Niveau>>(champsDepart)
  const [source, setSource] = useState('')
  const [module, setModule] = useState('')

  const qRoles = useQuery({
    queryKey: ['roles'],
    queryFn: ({ signal }) => api.get<RoleResume[]>('/api/admin/roles', { signal }),
    enabled: nouveau,
  })

  // « A partir du role » : recopie ses permissions et son modele dans la saisie.
  async function partirDe(c: string) {
    setSource(c)
    if (!c) {
      setPerms(new Set())
      setChamps(champsDepart)
      return
    }
    try {
      const f = await qc.fetchQuery({
        queryKey: ['role', c],
        queryFn: ({ signal }) => api.get<FicheRole>(`/api/admin/roles/${encodeURIComponent(c)}`, { signal }),
      })
      setPerms(new Set(f.permissions.map((p) => clePerm(p.module, p.action))))
      const m: Record<string, Niveau> = {}
      for (const x of f.champs) m[cleChamp(x.module, x.champ)] = x.niveau
      setChamps(m)
    } catch (e) {
      echec(e)
    }
  }

  const champsModifies = Object.keys(champs).filter((k) => champs[k] !== champsDepart[k])
  const permsModifiees =
    perms.size !== permsDepart.size || [...perms].some((p) => !permsDepart.has(p))
  const enteteModifiee =
    nouveau
      ? codeSaisi.trim() !== '' || libelle.trim() !== '' || description.trim() !== '' || plafond.trim() !== ''
      : libelle !== fiche.role.libelle ||
        description !== (fiche.role.description ?? '') ||
        plafond !== (fiche.role.plafond_validation_bc_mad === null ? '' : String(fiche.role.plafond_validation_bc_mad))
  const totpModifie = exigeTotp !== (nouveau ? false : fiche.role.exige_totp === true)
  const modifie = enteteModifiee || totpModifie || permsModifiees || champsModifies.length > 0
  const quitter = useGardeSaisie(modifie)

  const plafondNombre = (() => {
    const t = plafond.replace(/\s/g, '').replace(',', '.')
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : NaN
  })()

  const enregistrer = useMutation({
    mutationFn: () => {
      if (Number.isNaN(plafondNombre)) throw new ErreurApi(400, 'INVALIDE', 'Le plafond doit être un montant.')
      const corps = {
        code_role_user: nouveau ? codeSaisi.trim().toUpperCase() : undefined,
        libelle,
        description,
        plafond_validation_bc_mad: plafondNombre,
        exige_totp: exigeTotp,
        permissions: [...perms].map((p) => {
          const [m, a] = p.split('/')
          return { module: m, action: a }
        }),
        // Un role neuf recoit tout son modele ; un role existant, ce qui a change.
        champs: (nouveau ? Object.keys(champs) : champsModifies).map((k) => {
          const i = k.indexOf('.')
          return { module: k.slice(0, i), champ: k.slice(i + 1), niveau: champs[k] }
        }),
      }
      return nouveau
        ? api.post<Enregistre>('/api/admin/roles', corps)
        : api.put<Enregistre>(
            `/api/admin/roles/${encodeURIComponent(code)}`,
            corps,
          )
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['roles'] })
      void qc.invalidateQueries({ queryKey: ['role'] })
      void qc.invalidateQueries({ queryKey: ['droits'] })
      void qc.invalidateQueries({ queryKey: ['moi'] })
      if (nouveau) {
        toast.success(`Rôle ${r.code_role_user} créé.`)
        naviguer(`/roles/${encodeURIComponent(r.code_role_user)}`, { replace: true })
      } else {
        const n = r.droits_repercutes ?? 0
        toast.success(n > 0 ? `Rôle enregistré ; ${n} réglage(s) d’utilisateurs suivent le modèle.` : 'Rôle enregistré.')
      }
    },
    onError: echec,
  })

  const supprimer = useMutation({
    mutationFn: () => api.delete(`/api/admin/roles/${encodeURIComponent(code)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['roles'] })
      toast.success(`Rôle ${code} supprimé.`)
      naviguer('/configuration?section=utilisateurs')
    },
    onError: echec,
  })

  const verrouillee = (m: string) => admin && m === 'UTILISATEURS'
  const basculer = (m: string, a: Action) => {
    if (verrouillee(m)) return
    setPerms((s) => {
      const n = new Set(s)
      const k = clePerm(m, a)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }

  // Les onglets dans l'ordre du menu, comme la grille des permissions.
  const modulesChamps = useMemo(() => {
    const rang = (m: string) => {
      const i = fiche.modules.findIndex((x) => x.module === m)
      return i < 0 ? fiche.modules.length : i
    }
    return [...new Set(fiche.champs.map((c) => c.module))].sort((a, b) => rang(a) - rang(b))
  }, [fiche])
  const libelleModule = (m: string) => fiche.modules.find((x) => x.module === m)?.libelle ?? m
  const moduleActif = module || modulesChamps[0] || ''
  const champsDuModule = fiche.champs.filter((c) => c.module === moduleActif)
  const reglerModule = (n: Niveau) =>
    setChamps((s) => {
      const suite = { ...s }
      for (const c of champsDuModule) suite[cleChamp(c.module, c.champ)] = n
      return suite
    })

  const titre = nouveau ? 'Nouveau rôle' : `Rôle — ${fiche.role.libelle}`

  return (
    <div className="space-y-4">
      <EnTetePage
        titre={titre}
        description={
          nouveau
            ? 'Un rôle vide, ou recopié d’un rôle existant, puis ajusté.'
            : `${code} · ${fiche.role.nb_utilisateurs} utilisateur(s)`
        }
        actions={
          <>
            <Bouton variante="contour" onClick={() => quitter(() => naviguer('/configuration?section=utilisateurs'))}>
              <ArrowLeft />
              Retour
            </Bouton>
            {!nouveau && !admin && (
              <Bouton
                variante="contour"
                className="text-danger hover:bg-danger/10"
                disabled={fiche.role.nb_utilisateurs > 0 || supprimer.isPending}
                title={
                  fiche.role.nb_utilisateurs > 0
                    ? 'Des utilisateurs ont ce rôle : réaffectez-les d’abord.'
                    : undefined
                }
                onClick={() =>
                  confirmation.demander({
                    titre: `Supprimer le rôle ${fiche.role.libelle} ?`,
                    description: 'Ses permissions et son modèle de champs disparaissent avec lui.',
                    destructif: true,
                    libelleConfirmer: 'Supprimer',
                    action: () => supprimer.mutate(),
                  })
                }
              >
                <Trash2 />
                Supprimer
              </Bouton>
            )}
            {modifie && (
              <Bouton chargement={enregistrer.isPending} onClick={() => enregistrer.mutate()}>
                <Save />
                Enregistrer
              </Bouton>
            )}
          </>
        }
      />

      {admin && (
        <Alerte ton="info">
          L’Administrateur garde toujours la gestion des utilisateurs, et voit tous les champs en écriture
          quel que soit le modèle.
        </Alerte>
      )}

      {/* --- Le role ---------------------------------------------------------- */}
      <Carte>
        <CarteEntete>
          <CarteTitre>Le rôle</CarteTitre>
        </CarteEntete>
        <CarteCorps className="grid gap-3 sm:grid-cols-2">
          {nouveau && (
            <div>
              <Etiq htmlFor="role-code" obligatoire>Code</Etiq>
              <Champ
                id="role-code"
                value={codeSaisi}
                maxLength={30}
                placeholder="ex. ACHETEUR"
                onChange={(e) => setCodeSaisi(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              />
            </div>
          )}
          <div>
            <Etiq htmlFor="role-libelle" obligatoire>Libellé</Etiq>
            <Champ id="role-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Etiq htmlFor="role-description">Description</Etiq>
            <Champ id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Etiq htmlFor="role-plafond">Plafond de validation des bons (MAD)</Etiq>
            <Champ
              id="role-plafond"
              inputMode="decimal"
              value={plafond}
              placeholder="vide = sans plafond"
              onChange={(e) => setPlafond(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 self-end pb-1 text-[13px] text-texte">
            <input
              type="checkbox"
              className="size-4 accent-[hsl(var(--primaire))]"
              checked={exigeTotp}
              onChange={(e) => setExigeTotp(e.target.checked)}
            />
            Double authentification obligatoire
          </label>
          {nouveau && (
            <div>
              <Etiq htmlFor="role-source">À partir du rôle</Etiq>
              <Selecteur id="role-source" value={source} onChange={(e) => void partirDe(e.target.value)}>
                <option value="">— rôle vide —</option>
                {(qRoles.data ?? []).map((r) => (
                  <option key={r.code_role_user} value={r.code_role_user}>
                    {r.libelle}
                  </option>
                ))}
              </Selecteur>
            </div>
          )}
        </CarteCorps>
      </Carte>

      {/* --- Les permissions -------------------------------------------------- */}
      <Carte>
        <CarteEntete>
          <CarteTitre>Permissions par module</CarteTitre>
        </CarteEntete>
        <CarteCorps className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-bordure bg-attenue">
              <tr>
                <th className="px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte">
                  Module
                </th>
                {ACTIONS.map((a) => (
                  <th
                    key={a.valeur}
                    className="w-16 px-1 py-1.5 text-center text-[10.5px] font-semibold uppercase tracking-wider text-attenue-texte sm:w-20"
                  >
                    {a.libelle}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ligne">
              {fiche.modules.map((m) => (
                <tr key={m.module} className={cn(verrouillee(m.module) && 'opacity-70')}>
                  <td className="px-3 py-1.5">
                    <div className="text-texte">{m.libelle}</div>
                    <div className="text-[11.5px] text-attenue-texte">{m.description}</div>
                  </td>
                  {ACTIONS.map((a) => {
                    const k = clePerm(m.module, a.valeur)
                    return (
                      <td key={a.valeur} className="px-1 py-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${m.libelle} : ${a.libelle}`}
                          className="size-4 accent-[hsl(var(--primaire))]"
                          checked={perms.has(k)}
                          disabled={verrouillee(m.module)}
                          onChange={() => basculer(m.module, a.valeur)}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CarteCorps>
      </Carte>

      {/* --- Le modele de champs ---------------------------------------------- */}
      <Carte>
        <CarteEntete className="flex-col items-start gap-1">
          <CarteTitre>Visibilité des champs</CarteTitre>
          <p className="text-[12px] text-attenue-texte">
            Le modèle du rôle. Ses utilisateurs le suivent, sauf les champs réglés à la main pour l’un d’eux
            (écran « Droits par champ » de l’utilisateur).
          </p>
        </CarteEntete>
        <CarteCorps className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {modulesChamps.map((m) => {
              const n = champsModifies.filter((k) => k.startsWith(`${m}.`)).length
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModule(m)}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-[12.5px]',
                    m === moduleActif ? 'bg-primaire text-primaire-texte' : 'bg-attenue text-texte hover:bg-attenue/70',
                  )}
                >
                  {libelleModule(m)}
                  {n > 0 && <span className="ml-1 rounded bg-alerte px-1 text-[11px] text-white">{n}</span>}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[12px] text-attenue-texte">Tout le module :</span>
            {NIVEAUX.map((n) => (
              <Bouton key={n.valeur} variante="contour" taille="sm" onClick={() => reglerModule(n.valeur)}>
                {n.libelle}
              </Bouton>
            ))}
          </div>
          <ul className="divide-y divide-ligne rounded-lg border border-bordure">
            {champsDuModule.map((c) => {
              const k = cleChamp(c.module, c.champ)
              const courant = champs[k]
              return (
                <li
                  key={k}
                  className={cn(
                    'flex flex-wrap items-center gap-2 px-3 py-1.5',
                    courant !== champsDepart[k] && 'bg-alerte/10',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-texte">{c.libelle}</span>
                    {c.sensible === 1 && (
                      <Badge ton="or" className="ml-2">
                        sensible
                      </Badge>
                    )}
                    <span className="block font-mono text-[11px] text-attenue-texte">{c.champ}</span>
                  </span>
                  <span className="flex gap-0.5">
                    {NIVEAUX.map((n) => (
                      <button
                        key={n.valeur}
                        type="button"
                        aria-pressed={courant === n.valeur}
                        onClick={() => setChamps((s) => ({ ...s, [k]: n.valeur }))}
                        className={cn(
                          'rounded px-2 py-1 text-[11.5px] font-medium',
                          courant === n.valeur ? n.classe : 'bg-attenue text-attenue-texte hover:bg-attenue/70',
                        )}
                      >
                        {n.libelle}
                      </button>
                    ))}
                  </span>
                </li>
              )
            })}
          </ul>
        </CarteCorps>
      </Carte>

      {confirmation.element}
    </div>
  )
}
