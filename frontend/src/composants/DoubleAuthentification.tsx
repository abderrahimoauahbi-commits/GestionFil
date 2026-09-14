/**
 * LA DOUBLE AUTHENTIFICATION — poser ou retirer le code de connexion.
 *
 * Elle vit dans le menu du profil, à côté du mot de passe : c'est là qu'on la
 * cherche, et c'est le même geste — protéger son propre compte.
 *
 * TOUT SE PASSE HORS LIGNE. L'application du téléphone ne parle à personne :
 * elle garde un secret et le combine avec l'heure. Aucun compte Google ni
 * Microsoft, aucun SMS, aucun accès internet — ce qui la rend utilisable sur un
 * réseau fermé, et c'est précisément pourquoi elle a été retenue ici.
 *
 * TROIS ÉTAPES ET PAS DEUX. On pose le secret, **on vérifie qu'il marche**,
 * puis seulement il devient exigé. Sauter la vérification, c'est risquer
 * d'enfermer dehors quelqu'un dont le QR code a été mal scanné — et il faudrait
 * alors un administrateur pour le faire rentrer.
 */
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Loader2, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react'
import { api, ErreurApi } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Alerte, Bouton, Champ, Etiq } from './ui/base'
import { Dialogue, DialogueContenu } from './ui/surcouches'

export function DoubleAuthentification({
  ouvert,
  surFermeture,
}: {
  ouvert: boolean
  surFermeture: () => void
}) {
  const { moi, rafraichir } = useAuth()
  const actif = moi?.totp_actif === true

  const [etape, setEtape] = useState<'debut' | 'scan' | 'retrait'>('debut')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const toile = useRef<HTMLCanvasElement>(null)

  // On repart de zéro à chaque ouverture : un secret abandonné ne doit pas
  // réapparaître à la prochaine visite.
  useEffect(() => {
    if (ouvert) {
      setEtape('debut')
      setSecret('')
      setCode('')
      setMotDePasse('')
      setErreur(null)
      setMessage(null)
    }
  }, [ouvert])

  async function preparer() {
    setErreur(null)
    setEnvoi(true)
    try {
      const r = await api.post<{ secret: string; adresse: string }>('/api/auth/2fa/preparer', {})
      setSecret(r.secret)
      setEtape('scan')
      // Le QR se dessine après le rendu du canevas.
      setTimeout(() => {
        if (toile.current) {
          void QRCode.toCanvas(toile.current, r.adresse, { width: 200, margin: 1 })
        }
      }, 30)
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : 'Préparation impossible.')
    } finally {
      setEnvoi(false)
    }
  }

  async function activer() {
    setErreur(null)
    setEnvoi(true)
    try {
      await api.post('/api/auth/2fa/activer', { code })
      setMessage('La double authentification est active. Le code vous sera demandé à chaque connexion.')
      setEtape('debut')
      await rafraichir()
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : 'Activation impossible.')
    } finally {
      setEnvoi(false)
    }
  }

  async function retirer() {
    setErreur(null)
    setEnvoi(true)
    try {
      await api.post('/api/auth/2fa/desactiver', { mot_de_passe: motDePasse })
      setMessage('La double authentification est retirée.')
      setEtape('debut')
      setMotDePasse('')
      await rafraichir()
    } catch (e) {
      setErreur(
        e instanceof ErreurApi && e.code === 'IDENTIFIANTS_INVALIDES'
          ? 'Mot de passe incorrect.'
          : e instanceof ErreurApi
            ? e.message
            : 'Retrait impossible.',
      )
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Dialogue open={ouvert} onOpenChange={(o) => !o && surFermeture()}>
      <DialogueContenu
        titre="Double authentification"
        description="Un code à six chiffres, en plus du mot de passe, à chaque connexion."
      >
        <div className="space-y-3">
          {erreur && <Alerte ton="danger">{erreur}</Alerte>}
          {message && <Alerte ton="succes">{message}</Alerte>}

          {/* ---------------------------------------------------- au repos */}
          {etape === 'debut' && (
            <>
              <div className="flex items-start gap-2 rounded-[var(--radius)] border border-bordure bg-attenue/30 px-3 py-2.5">
                {actif ? (
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-succes" />
                ) : (
                  <ShieldOff className="mt-0.5 size-4 shrink-0 text-attenue-texte" />
                )}
                <div className="text-[13px]">
                  <div className="font-semibold">
                    {actif ? 'Active sur votre compte' : 'Non activée'}
                  </div>
                  <div className="text-attenue-texte">
                    {actif
                      ? 'Un code vous est demandé à chaque connexion.'
                      : 'Votre mot de passe seul suffit aujourd’hui à ouvrir votre compte.'}
                  </div>
                </div>
              </div>

              {!actif && (
                <p className="m-0 text-[12.5px] text-attenue-texte">
                  Vous aurez besoin d’une application d’authentification sur votre
                  téléphone — Google Authenticator, Microsoft Authenticator, FreeOTP.
                  Elle fonctionne <strong>hors ligne</strong> : aucun compte à créer,
                  aucune connexion internet nécessaire une fois installée.
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Bouton variante="contour" onClick={surFermeture}>
                  Fermer
                </Bouton>
                {actif ? (
                  <Bouton variante="danger" onClick={() => setEtape('retrait')}>
                    Retirer
                  </Bouton>
                ) : (
                  <Bouton onClick={preparer} disabled={envoi}>
                    {envoi && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                    <Smartphone className="mr-1 size-3.5" />
                    Activer
                  </Bouton>
                )}
              </div>
            </>
          )}

          {/* ------------------------------------------------ scan et essai */}
          {etape === 'scan' && (
            <>
              <ol className="m-0 space-y-1 pl-4 text-[13px]">
                <li>Ouvrez votre application d’authentification.</li>
                <li>Scannez ce QR code.</li>
                <li>Saisissez ci-dessous les six chiffres qu’elle affiche.</li>
              </ol>

              <div className="flex justify-center rounded-[var(--radius)] border border-bordure bg-white p-3">
                <canvas ref={toile} aria-label="QR code à scanner" />
              </div>

              {/* Le secret en clair : un téléphone qui ne peut pas scanner —
                  caméra cassée, écran distant — doit pouvoir le saisir. */}
              <div>
                <Etiq>Ou saisissez cette clé à la main</Etiq>
                <div className="select-all break-all rounded border border-bordure bg-attenue/30 px-2 py-1.5 font-mono text-[12.5px]">
                  {secret}
                </div>
              </div>

              <div>
                <Etiq>Le code affiché par l’application</Etiq>
                <Champ
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  className="text-center text-[17px] tracking-[0.4em]"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2">
                <Bouton variante="contour" onClick={() => setEtape('debut')}>
                  Annuler
                </Bouton>
                <Bouton onClick={activer} disabled={code.length !== 6 || envoi}>
                  {envoi && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                  Vérifier et activer
                </Bouton>
              </div>
            </>
          )}

          {/* ----------------------------------------------------- retrait */}
          {etape === 'retrait' && (
            <>
              <Alerte ton="alerte">
                Sans ce code, votre mot de passe seul ouvrira de nouveau votre compte.
              </Alerte>
              <div>
                <Etiq>Votre mot de passe</Etiq>
                <Champ
                  type="password"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                />
                <p className="mt-1 text-[11.5px] text-attenue-texte">
                  Il est exigé : un poste laissé ouvert ne doit pas suffire à retirer
                  la protection.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Bouton variante="contour" onClick={() => setEtape('debut')}>
                  Annuler
                </Bouton>
                <Bouton variante="danger" onClick={retirer} disabled={!motDePasse || envoi}>
                  {envoi && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                  Retirer la protection
                </Bouton>
              </div>
            </>
          )}
        </div>
      </DialogueContenu>
    </Dialogue>
  )
}
