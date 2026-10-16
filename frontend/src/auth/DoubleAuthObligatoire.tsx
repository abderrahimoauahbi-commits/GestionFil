/**
 * LA DOUBLE AUTHENTIFICATION OBLIGATOIRE (13/10/2026).
 *
 * Pour les rôles qui l'exigent (Administrateur et Direction par décision), un
 * compte qui ne l'a pas encore posée ne voit que cet écran : le serveur refuse
 * tout le reste (DOUBLE_AUTH_REQUISE). Une fois posée, l'application s'ouvre
 * normalement. Téléphone perdu : l'administrateur la retire sur le serveur
 * (`gestionfil-admin retirer-2fa <login>`).
 */
import { useState } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { useAuth } from './AuthContext'
import { DoubleAuthentification } from '../composants/DoubleAuthentification'
import { Alerte, Bouton, Carte, CarteCorps } from '../composants/ui/base'

export function DoubleAuthObligatoire() {
  const { moi, deconnecter } = useAuth()
  const [ouvert, setOuvert] = useState(false)
  return (
    <div className="flex min-h-dvh items-center justify-center bg-fond p-4">
      <Carte className="w-full max-w-md">
        <CarteCorps className="space-y-4">
          <div className="flex items-center gap-2 text-lg font-semibold text-texte">
            <ShieldCheck className="size-5 text-primaire" />
            Double authentification obligatoire
          </div>
          <Alerte ton="info">
            Votre rôle exige un code à six chiffres en plus du mot de passe. Installez une application
            d’authentification sur votre téléphone (Google Authenticator, Microsoft Authenticator…), puis
            scannez le code qui s’affichera.
          </Alerte>
          <p className="text-[13px] text-attenue-texte">
            Compte <strong>{moi?.login}</strong>. Tant qu’elle n’est pas activée, l’application reste fermée
            pour ce compte.
          </p>
          <div className="flex flex-wrap gap-2">
            <Bouton onClick={() => setOuvert(true)}>
              <ShieldCheck />
              Activer maintenant
            </Bouton>
            <Bouton variante="contour" onClick={deconnecter}>
              <LogOut />
              Se déconnecter
            </Bouton>
          </div>
        </CarteCorps>
      </Carte>
      <DoubleAuthentification ouvert={ouvert} surFermeture={() => setOuvert(false)} />
    </div>
  )
}
