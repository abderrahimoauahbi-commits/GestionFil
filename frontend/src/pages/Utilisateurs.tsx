import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ErreurApi } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { EnTetePage } from '../components/Layout'
import { Bouton, Chargement, Etiquette, Message, Vide, fmt } from '../components/ui'
import { Champ, Etiq } from '../composants/ui/base'
import { Dialogue, DialogueContenu } from '../composants/ui/surcouches'
import { KeyRound } from 'lucide-react'

interface Utilisateur {
  id_utilisateur: string
  login: string
  nom: string
  email: string | null
  code_role_user: string
  role_libelle: string
  magasin_principal: string | null
  mfa_actif: number
  derniere_connexion: string | null
  actif: number
  mot_de_passe_a_definir: number
}

interface Role {
  code_role_user: string
  libelle: string
  nb_utilisateurs: number
}

export function Utilisateurs() {
  const qc = useQueryClient()
  const { peut, moi } = useAuth()
  const peutEcrire = peut('UTILISATEURS', 'ECRIRE')

  const [creation, setCreation] = useState(false)
  /** Compte dont on redefinit le mot de passe. Null : aucun. */
  const [reinit, setReinit] = useState<Utilisateur | null>(null)
  const [retour, setRetour] = useState<{ ton: 'succes' | 'erreur'; texte: string } | null>(null)

  const qUsers = useQuery({
    queryKey: ['utilisateurs'],
    queryFn: () => api.get<Utilisateur[]>('/api/admin/utilisateurs'),
  })
  const qRoles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Role[]>('/api/admin/roles'),
  })

  const basculerActif = useMutation({
    mutationFn: (u: Utilisateur) =>
      api.patch(`/api/admin/utilisateurs/${u.id_utilisateur}`, { actif: u.actif !== 1 }),
    onSuccess: () => {
      setRetour(null)
      void qc.invalidateQueries({ queryKey: ['utilisateurs'] })
    },
    onError: (e) =>
      setRetour({
        ton: 'erreur',
        texte: e instanceof ErreurApi ? e.message : 'Modification impossible.',
      }),
  })

  if (qUsers.isLoading) return <Chargement />

  return (
    <div>
      <EnTetePage
        titre="Utilisateurs"
        sous_titre={`${qUsers.data?.length ?? 0} compte(s) · droits configurables champ par champ`}
        actions={
          peutEcrire && (
            <Bouton onClick={() => setCreation(true)}>Nouvel utilisateur</Bouton>
          )
        }
      />

      {retour && (
        <div className="mb-4">
          <Message ton={retour.ton}>{retour.texte}</Message>
        </div>
      )}

      {qUsers.data?.some((u) => u.mot_de_passe_a_definir === 1) && (
        <div className="mb-4">
          <Message ton="attention" titre="Comptes sans mot de passe">
            Certains comptes ne peuvent pas se connecter tant qu'un mot de passe n'a pas ete
            defini.
          </Message>
        </div>
      )}

      {!qUsers.data?.length ? (
        <Vide texte="Aucun utilisateur." />
      ) : (
        <div className="space-y-2">
          {qUsers.data.map((u) => (
            <div
              key={u.id_utilisateur}
              className="rounded-lg border border-bordure bg-surface p-3 sm:flex sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-texte">{u.nom}</span>
                  <Etiquette ton="bleu">{u.role_libelle}</Etiquette>
                  {u.actif !== 1 && <Etiquette ton="rouge">desactive</Etiquette>}
                  {u.mot_de_passe_a_definir === 1 && (
                    <Etiquette ton="ambre">mot de passe a definir</Etiquette>
                  )}
                  {u.mfa_actif === 1 && <Etiquette ton="vert">2FA</Etiquette>}
                  {u.id_utilisateur === moi?.id && <Etiquette>vous</Etiquette>}
                </div>
                <div className="mt-0.5 text-sm text-attenue-texte">
                  {u.login}
                  {u.email && ` · ${u.email}`}
                  {u.magasin_principal && ` · ${u.magasin_principal}`}
                </div>
                <div className="text-xs text-attenue-texte">
                  Derniere connexion : {fmt.date(u.derniere_connexion)}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
                <Link
                  to={`/utilisateurs/${u.id_utilisateur}/droits`}
                  className="rounded-lg border border-champ bg-surface px-3 py-1.5 text-sm text-texte hover:bg-attenue"
                >
                  Droits par champ
                </Link>
                {/* La reinitialisation est ouverte AUSSI sur son propre
                    compte : un administrateur doit pouvoir changer son mot de
                    passe sans passer par la ligne de commande du serveur. */}
                {peutEcrire && (
                  <Bouton variante="secondaire" onClick={() => setReinit(u)}>
                    <KeyRound />
                    {u.mot_de_passe_a_definir === 1 ? 'Definir le mot de passe' : 'Reinitialiser'}
                  </Bouton>
                )}
                {peutEcrire && u.id_utilisateur !== moi?.id && (
                  <Bouton
                    variante="secondaire"
                    onClick={() => basculerActif.mutate(u)}
                    disabled={basculerActif.isPending}
                  >
                    {u.actif === 1 ? 'Desactiver' : 'Reactiver'}
                  </Bouton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {reinit && (
        <FormulaireMotDePasse
          utilisateur={reinit}
          surFermeture={() => setReinit(null)}
          surSucces={(message) => {
            setReinit(null)
            setRetour({ ton: 'succes', texte: message })
            void qc.invalidateQueries({ queryKey: ['utilisateurs'] })
          }}
        />
      )}

      {creation && (
        <FormulaireCreation
          roles={qRoles.data ?? []}
          surFermeture={() => setCreation(false)}
          surSucces={(message) => {
            setCreation(false)
            setRetour({ ton: 'succes', texte: message })
            void qc.invalidateQueries({ queryKey: ['utilisateurs'] })
          }}
        />
      )}
    </div>
  )
}

function FormulaireCreation({
  roles,
  surFermeture,
  surSucces,
}: {
  roles: Role[]
  surFermeture: () => void
  surSucces: (message: string) => void
}) {
  const [form, setForm] = useState({
    login: '',
    nom: '',
    email: '',
    code_role_user: roles[0]?.code_role_user ?? 'MAGASIN',
    mot_de_passe: '',
    mfa_actif: false,
  })
  const [erreur, setErreur] = useState<string | null>(null)

  const creer = useMutation({
    mutationFn: () =>
      api.post<{ droits_initialises: number }>('/api/admin/utilisateurs', {
        ...form,
        email: form.email || null,
      }),
    onSuccess: (r) =>
      surSucces(
        `Compte cree. ${r.droits_initialises} droits initialises depuis le modele du role — ` +
          `a ajuster champ par champ si besoin.`,
      ),
    onError: (e) =>
      setErreur(e instanceof ErreurApi ? e.message : 'Creation impossible.'),
  })

  const champ =
    'w-full rounded-lg border border-champ px-3 py-2 text-sm outline-none focus:border-anneau'

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={surFermeture}
    >
      <div
        className="w-full max-w-md rounded-t-xl bg-surface p-5 sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-texte">Nouvel utilisateur</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            setErreur(null)
            creer.mutate()
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-texte">Identifiant</label>
              <input
                required
                value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value })}
                autoCapitalize="none"
                className={champ}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-texte">Role</label>
              <select
                value={form.code_role_user}
                onChange={(e) => setForm({ ...form, code_role_user: e.target.value })}
                className={champ}
              >
                {roles.map((r) => (
                  <option key={r.code_role_user} value={r.code_role_user}>
                    {r.libelle}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-texte">Nom complet</label>
            <input
              required
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              className={champ}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-texte">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={champ}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-texte">
              Mot de passe <span className="text-attenue-texte">(12 caracteres minimum)</span>
            </label>
            <input
              type="password"
              required
              minLength={12}
              value={form.mot_de_passe}
              onChange={(e) => setForm({ ...form, mot_de_passe: e.target.value })}
              className={champ}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-texte">
            <input
              type="checkbox"
              checked={form.mfa_actif}
              onChange={(e) => setForm({ ...form, mfa_actif: e.target.checked })}
            />
            Exiger la double authentification
          </label>

          {erreur && <Message ton="erreur">{erreur}</Message>}

          <p className="text-xs text-attenue-texte">
            La grille de droits sera initialisee depuis le modele du role choisi, puis reglable
            champ par champ.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Bouton type="button" variante="secondaire" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton type="submit" disabled={creer.isPending}>
              {creer.isPending ? 'Creation...' : 'Creer'}
            </Bouton>
          </div>
        </form>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Reinitialisation d'un mot de passe                                          */
/* -------------------------------------------------------------------------- */

/**
 * Poser ou remplacer le mot de passe d'un compte.
 *
 * POURQUOI CET ECRAN EXISTE. La route serveur savait deja le faire ; rien ne
 * l'appelait. Un administrateur qui perdait son mot de passe devait ouvrir une
 * console sur la machine du serveur et lancer l'outil en ligne de commande —
 * autant dire que le compte etait perdu.
 *
 * LA REGLE DES DOUZE CARACTERES EST VERIFIEE DEUX FOIS. Ici pour le dire tout
 * de suite, et par le serveur qui seul decide. Le controle d'ecran evite un
 * aller-retour ; il ne remplace pas celui du serveur, qu'un appel direct
 * contournerait.
 */
function FormulaireMotDePasse({
  utilisateur,
  surFermeture,
  surSucces,
}: {
  utilisateur: Utilisateur
  surFermeture: () => void
  surSucces: (message: string) => void
}) {
  const [mdp, setMdp] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)

  const enregistrer = useMutation({
    mutationFn: () =>
      api.patch(`/api/admin/utilisateurs/${utilisateur.id_utilisateur}`, {
        mot_de_passe: mdp,
      }),
    onSuccess: () => surSucces(`Mot de passe defini pour ${utilisateur.login}.`),
    onError: (e) =>
      setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.'),
  })

  const trop_court = mdp.length > 0 && mdp.length < 12
  const discordant = confirmation.length > 0 && mdp !== confirmation
  const pret = mdp.length >= 12 && mdp === confirmation

  return (
    <Dialogue open onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        titre={`Mot de passe — ${utilisateur.login}`}
        description={`${utilisateur.nom} · ${utilisateur.role_libelle}`}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setErreur(null)
            enregistrer.mutate()
          }}
        >
          {erreur && <Message ton="erreur">{erreur}</Message>}

          <div>
            <Etiq>Nouveau mot de passe</Etiq>
            <Champ
              type="password"
              autoFocus
              value={mdp}
              onChange={(e) => setMdp(e.target.value)}
              autoComplete="new-password"
            />
            <p
              className={
                trop_court ? 'mt-1 text-[11px] text-danger' : 'mt-1 text-[11px] text-attenue-texte'
              }
            >
              {mdp.length} caractere(s) — 12 au minimum.
            </p>
          </div>

          <div>
            <Etiq>Confirmation</Etiq>
            <Champ
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="new-password"
            />
            {discordant && (
              <p className="mt-1 text-[11px] text-danger">Les deux saisies different.</p>
            )}
          </div>

          {/* Un mot de passe pose ici ne transite pas par un courriel et n'est
              affiche nulle part ensuite : il faut le transmettre a la personne
              par un autre canal. Le dire evite de le chercher apres coup. */}
          <p className="text-[11px] text-attenue-texte">
            Le mot de passe n est stocke que sous forme d empreinte Argon2. Il ne sera plus
            affichable : notez-le avant de valider, et transmettez-le a la personne concernee.
          </p>

          <div className="flex justify-end gap-2">
            <Bouton type="button" variante="secondaire" onClick={surFermeture}>
              Annuler
            </Bouton>
            <Bouton type="submit" disabled={!pret || enregistrer.isPending}>
              {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Bouton>
          </div>
        </form>
      </DialogueContenu>
    </Dialogue>
  )
}
