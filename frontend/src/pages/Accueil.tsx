/**
 * L'accueil — la page que TOUT LE MONDE peut ouvrir.
 *
 * POURQUOI ELLE EXISTE. L'accueil etait le tableau de bord, protege par le
 * module COCKPIT. Le jour ou l'assistante a perdu ce module, sa page d'accueil
 * est devenue « Acces refuse » : elle se connectait pour lire un message
 * d'erreur. Un ERP ne peut pas ouvrir sur un refus.
 *
 * CETTE PAGE N'A DONC AUCUNE GARDE, et elle n'en a pas besoin : elle ne montre
 * rien d'autre que les ecrans auxquels celui qui regarde a deja droit. Elle les
 * lit dans la meme table de navigation que le menu — une seule liste, donc pas
 * de raccourci qui survivrait a la disparition d'un ecran.
 *
 * ELLE REPREND L'IDENTITE DE L'ECRAN DE CONNEXION, et c'est voulu. La premiere
 * version alignait des rectangles gris : elle ne ressemblait a rien, et surtout
 * pas au reste de l'outil. L'ecran de connexion, lui, a un monde — le fond de
 * fils graphite, le filet d'or, le logo blanc. On entre dans l'application par
 * cette porte-la ; la page qui suit doit en garder la trace, sinon l'atelier a
 * l'impression d'avoir change de logiciel entre la connexion et le travail.
 *
 * L'OR NE SERT QU'ICI. Il marque la banniere et rien d'autre : le bleu de
 * l'application reste la couleur de ce qui se clique. Une seule audace, tenue
 * a un seul endroit.
 */
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { estAccessible, NAVIGATION } from '../composants/Coquille'
import { cn, fmt } from '../lib/utils'

/** Ce que le rôle veut dire, en une phrase que son titulaire reconnaît. */
const METIER: Record<string, string> = {
  ADMIN: 'Vous administrez l’outil et vous voyez tout.',
  DIRECTION: 'Vous suivez l’activité, les achats et la valeur du stock.',
  ASSISTANTE: 'Vous tenez le catalogue, les commandes et les réceptions.',
  MAGASIN: 'Vous chargez, déchargez, transférez et comptez.',
}

/**
 * UNE TEINTE PAR RUBRIQUE, PAS UNE PAR BOUTON.
 *
 * Colorer chaque icone separement ferait un sapin de Noel ou plus rien ne se
 * distingue. La couleur sert ici a une seule chose : dire d'un coup d'oeil de
 * quel monde releve l'ecran — le catalogue, la production, les achats, le
 * stock. Deux boutons de la meme teinte parlent du meme sujet.
 *
 * Les valeurs sont donnees en clair et non en jetons de theme : ce sont des
 * couleurs de reperage, pas des couleurs d'etat, et elles doivent rester les
 * memes en clair comme en sombre pour que le repere tienne.
 */
const TEINTE: Record<string, { fond: string; trait: string }> = {
  GENERAL:    { fond: 'rgb(37 99 235 / .12)',  trait: 'rgb(37 99 235)' },   // bleu
  CATALOGUE:  { fond: 'rgb(124 58 237 / .12)', trait: 'rgb(124 58 237)' },  // violet
  PRODUCTION: { fond: 'rgb(196 161 90 / .18)', trait: 'rgb(163 128 58)' },  // l'or de la marque
  ACHATS:     { fond: 'rgb(5 150 105 / .12)',  trait: 'rgb(5 150 105)' },   // vert
  STOCK:      { fond: 'rgb(13 148 136 / .12)', trait: 'rgb(13 148 136)' },  // sarcelle
  FINANCE:    { fond: 'rgb(225 29 72 / .10)',  trait: 'rgb(190 24 62)' },   // grenat
  PARAMETRES: { fond: 'rgb(100 116 139 / .14)', trait: 'rgb(71 85 105)' },  // ardoise
}

const teinte = (section: string) => TEINTE[section] ?? TEINTE.GENERAL

/**
 * LES TAUX DE CHANGE EN VIGUEUR, des l'ouverture — pour la direction et
 * l'administrateur (demande du 17/09/2026).
 *
 * Tout le fil s'achete en dollars : le taux fait le prix de revient, le plan
 * d'achat et la valeur de chaque reception. Il doit se lire sans aller le
 * chercher dans la configuration, et un taux qui n'a pas bouge depuis longtemps
 * doit se voir.
 */
const ROLES_TAUX = ['DIRECTION', 'ADMIN']

interface TauxDate {
  taux: number
  date_debut: string
  date_fin: string | null
}

/** Le cours de reference de Bank Al-Maghrib, lu par le serveur — pour information. */
interface CoursBam {
  code_devise: string
  date_cours: string | null
  cours_mad: number | null
  date_precedente: string | null
  cours_precedent_mad: number | null
}

/** Hausse en rouge, baisse en vert : un taux qui monte renchérit chaque achat. */
function Variation({ ecart, base, suffixe }: { ecart: number; base: number; suffixe?: string }) {
  return (
    <span
      className={cn(
        'tabular-nums',
        ecart > 0 ? 'text-danger' : ecart < 0 ? 'text-succes' : 'text-attenue-texte',
      )}
    >
      {ecart > 0 ? '▲' : ecart < 0 ? '▼' : '='} {fmt.nombre(Math.abs(ecart), 2)} % sur{' '}
      {fmt.nombre(base, 4)}
      {suffixe}
    </span>
  )
}

function TauxDeChange() {
  const qDev = useQuery({
    queryKey: ['devises'],
    queryFn: () => api.get<{ code_devise: string; est_pivot: number }[]>('/api/devises'),
  })
  // Le serveur ne relit la banque qu'au plus une fois par demi-heure : un
  // rafraichissement de l'ecran plus frequent ne lui apprendrait rien.
  const qBam = useQuery({
    queryKey: ['cours-bam'],
    queryFn: () =>
      api.get<{ source: string; url: string; erreur: string | null; cours: CoursBam[] }>(
        '/api/devises/cours-bam',
      ),
    staleTime: 10 * 60_000,
  })
  const devises = (qDev.data ?? []).filter((d) => d.est_pivot === 0)
  const historiques = useQueries({
    queries: devises.map((d) => ({
      queryKey: ['taux', d.code_devise],
      queryFn: () =>
        api.get<TauxDate[]>(`/api/devises/${encodeURIComponent(d.code_devise)}/taux`),
    })),
  })
  if (devises.length === 0) return null

  return (
    <section className="flex flex-col gap-3" aria-label="Taux de change en vigueur">
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-attenue-texte">
          Taux de change en vigueur
        </h2>
        <Link to="/configuration" className="text-[11.5px] text-primaire hover:underline">
          historique
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {devises.map((d, i) => {
          const lignes = historiques[i]?.data ?? []
          // En vigueur : la periode ouverte. La precedente est le dernier taux
          // DIFFERENT — un meme taux ressaisi ne dit rien du mouvement.
          const courant = lignes.find((l) => !l.date_fin) ?? lignes[0]
          const precedent = courant && lignes.find((l) => l.date_debut < courant.date_debut && l.taux !== courant.taux)
          /* LA REGLE EST JUSTE, ET ON PASSE OUTRE EN LE DISANT.
             `react-hooks/purity` interdit de lire l'horloge pendant le rendu :
             deux rendus du meme etat n'y donnent plus le meme resultat. Ici la
             valeur ne change qu'une fois par jour, et l'afficher juste demande
             la date du jour. Les deux parades honnetes — figer l'heure au
             montage, ou reveiller un minuteur a minuit — coutent plus cher que
             le defaut qu'elles corrigent : un ecran laisse ouvert toute la nuit
             afficherait « depuis 3 jours » au lieu de 4. */
          const jours = courant
            // eslint-disable-next-line react-hooks/purity
            ? Math.floor((Date.now() - new Date(courant.date_debut).getTime()) / 86_400_000)
            : null
          const bam = qBam.data?.cours.find((c) => c.code_devise === d.code_devise)
          // L'ECART QUI COMPTE : le taux de l'ERP rapporte au cours de la banque.
          // Un taux ERP sous le marche sous-estime le cout de chaque achat.
          const ecartBam =
            courant && bam?.cours_mad ? ((courant.taux - bam.cours_mad) / bam.cours_mad) * 100 : null
          return (
            <div
              key={d.code_devise}
              className="flex flex-col gap-2 rounded-[var(--radius)] border border-bordure bg-surface p-3 shadow-sm"
            >
              <span className="text-[11.5px] font-medium text-attenue-texte">
                1 {d.code_devise} en MAD
              </span>

              <div className="flex flex-col gap-0.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-attenue-texte">
                  Taux utilisé par l’ERP
                </span>
                <span className="text-[22px] font-semibold leading-tight tabular-nums text-texte">
                  {courant ? fmt.nombre(courant.taux, 4) : '—'}
                </span>
                {courant && (
                  <span className="text-[11.5px] leading-snug text-attenue-texte">
                    depuis le {fmt.date(courant.date_debut)}
                    {jours !== null && jours > 7 && (
                      <span className="text-alerte"> · {jours} jours sans mise à jour</span>
                    )}
                  </span>
                )}
                {courant && precedent && (
                  <span className="text-[11.5px]">
                    <Variation ecart={((courant.taux - precedent.taux) / precedent.taux) * 100} base={precedent.taux} />
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5 border-t border-bordure pt-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-attenue-texte">
                  Bank Al-Maghrib · cours de référence
                </span>
                {bam?.cours_mad ? (
                  <>
                    <span className="text-[17px] font-semibold leading-tight tabular-nums text-texte">
                      {fmt.nombre(bam.cours_mad, 4)}
                      <span className="ml-1.5 text-[11.5px] font-normal text-attenue-texte">
                        au {fmt.date(bam.date_cours)}
                      </span>
                    </span>
                    {bam.cours_precedent_mad && (
                      <span className="text-[11.5px]">
                        <Variation
                          ecart={((bam.cours_mad - bam.cours_precedent_mad) / bam.cours_precedent_mad) * 100}
                          base={bam.cours_precedent_mad}
                          suffixe={` au ${fmt.date(bam.date_precedente)}`}
                        />
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[11.5px] text-attenue-texte">
                    {qBam.isLoading
                      ? 'lecture du cours…'
                      : qBam.isError
                        ? // Un serveur qui n'a pas encore la route : le dire, plutot
                          // que de laisser croire que la banque ne cote pas.
                          'cours indisponible : le serveur doit être mis à jour et redémarré'
                        : 'aucun cours lu pour cette devise'}
                  </span>
                )}
                {ecartBam !== null && (
                  // Signale au-dela de 1 % : le prix de revient calcule s'ecarte
                  // alors sensiblement de ce que la banque facturera.
                  <span
                    className={cn(
                      'mt-0.5 text-[11.5px] tabular-nums',
                      Math.abs(ecartBam) >= 1 ? 'font-medium text-alerte' : 'text-attenue-texte',
                    )}
                  >
                    {Math.abs(ecartBam) < 0.005
                      ? 'Taux ERP aligné sur Bank Al-Maghrib'
                      : `Taux ERP ${fmt.nombre(Math.abs(ecartBam), 2)} % ${ecartBam < 0 ? 'sous le' : 'au-dessus du'} cours BAM`}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-attenue-texte">
        Pour information : le cours de Bank Al-Maghrib ne modifie jamais le taux de l’ERP.{' '}
        <a href={qBam.data?.url} target="_blank" rel="noreferrer" className="text-primaire hover:underline">
          Source : Bank Al-Maghrib
        </a>
        {qBam.data?.erreur && <span className="text-alerte"> · {qBam.data.erreur} — dernier cours connu affiché</span>}
      </p>
    </section>
  )
}

/**
 * LE FIL DE CE QUI S'EST PASSE.
 *
 * C'est ce qu'un accueil doit porter : des faits, pas des liens. Qui a
 * enregistre quel mouvement, quel bon est parti, quelle reception a ete
 * controlee. Une page qui dit « voici ou aller » suppose qu'on ne le sait pas ;
 * une page qui dit « voici ce qui a bouge » apprend quelque chose a chaque
 * ouverture — et c'est elle qui donne le sentiment que l'outil VIT.
 *
 * CHAQUE LIGNE S'OUVRE. Un fil dont les evenements ne menent nulle part est une
 * frise decorative : on le lit une fois, puis on cesse de le voir.
 */
interface Evenement {
  quand: string
  categorie: string
  titre: string
  detail: string | null
  chemin: string
  par: string | null
}

const TEINTE_CATEGORIE: Record<string, string> = {
  MOUVEMENT: 'bg-primaire/12 text-primaire',
  RECEPTION: 'bg-succes/15 text-succes',
  COMMANDE: 'bg-alerte/15 text-alerte',
  TRANSFERT: 'bg-primaire/10 text-primaire',
  INVENTAIRE: 'bg-attenue text-attenue-texte',
  PLAN: 'bg-attenue text-attenue-texte',
  ACHAT: 'bg-alerte/12 text-alerte',
  MACHINE: 'bg-attenue text-attenue-texte',
}

/** « il y a 3 h », « hier », « le 12/09 » — la distance se lit mieux qu'une date. */
function depuis(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const min = Math.round((Date.now() - t) / 60000)
  if (min < 1) return "a l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h} h`
  const j = Math.round(h / 24)
  if (j === 1) return 'hier'
  if (j < 7) return `il y a ${j} jours`
  return fmt.date(iso)
}

function FilActualite() {
  const q = useQuery({
    queryKey: ['actualite'],
    queryFn: () => api.get<Evenement[]>('/api/actualite'),
    staleTime: 60_000,
  })
  const evenements = q.data ?? []

  return (
    <section className="flex flex-col gap-2.5">
      <h2
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-attenue-texte"
      >
        Ce qui s'est passé
      </h2>

      {q.isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-[var(--radius-sm)] bg-attenue" />
          ))}
        </div>
      ) : evenements.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border border-bordure bg-surface px-3 py-4
                      text-[13px] text-attenue-texte">
          Rien n'a encore ete enregistre. Le fil se remplira des la premiere
          reception, le premier mouvement ou le premier bon de commande.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {evenements.map((e, i) => (
            <li key={`${e.quand}-${i}`}>
              <Link
                to={e.chemin}
                className={cn(
                  'group flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5',
                  'rounded-[var(--radius-sm)] border border-bordure bg-surface px-3 py-2',
                  'transition-colors hover:border-primaire/40 hover:bg-primaire/[0.04]',
                )}
              >
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    TEINTE_CATEGORIE[e.categorie] ?? 'bg-attenue text-attenue-texte',
                  )}
                >
                  {e.categorie}
                </span>
                <span className="text-[13.5px] font-medium text-texte">{e.titre}</span>
                {e.detail && (
                  <span className="text-[12px] text-attenue-texte">{e.detail}</span>
                )}
                {/* L'AUTEUR ET LE MOMENT FERMENT LA LIGNE, a droite : ce sont
                    les deux choses qu'on cherche en second, jamais en premier. */}
                <span className="ml-auto whitespace-nowrap text-[11.5px] text-attenue-texte">
                  {e.par ? `${e.par} · ` : ''}
                  {depuis(e.quand)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function salutation(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

/** « mercredi 9 septembre 2026 » — la date que porte une fiche de production. */
function dateDuJour(): string {
  return new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function Accueil() {
  const { moi, peut } = useAuth()

  /* L'ACCUEIL NE SE LISTE PAS LUI-MEME. Il figure dans la navigation — sans
     quoi personne ne savait comment y revenir — mais un raccourci vers la page
     qu'on regarde deja n'apprend rien a personne. */
  const accessibles = NAVIGATION.filter(
    (e) => e.vers !== '/' && !e.aVenir && estAccessible(e, peut, moi?.role),
  )
  const quotidiens = accessibles.filter((e) => e.principale)

  /* LES RUBRIQUES NE SONT PLUS CALCULEES ICI. Elles servaient au mur de trente
     boutons range par section, qui recopiait le menu de gauche au milieu de
     l'ecran. La navigation complete reste dans la barre laterale et dans la
     palette de commandes ; l'accueil, lui, montre ce qui s'est passe. */

  return (
    <div className="flex flex-col gap-7 pb-4">
      {/* ================= LA BANNIERE =================================
          Pleine largeur : les marges negatives annulent le rembourrage de la
          coquille, sinon la bande flotterait dans une gouttiere et perdrait
          tout son effet. Le fond est le meme fichier que l'ecran de connexion.
          ================================================================= */}
      <header
        className="relative -mx-3 overflow-hidden px-6 py-9 sm:-mx-4 sm:rounded-[var(--radius-lg)]
                   sm:px-9 sm:py-11"
        style={{
          backgroundColor: '#0F141A',
          backgroundImage: `linear-gradient(100deg, rgba(15,20,26,.94) 0%, rgba(15,20,26,.72) 48%, rgba(15,20,26,.42) 100%), url(${import.meta.env.BASE_URL}fond-fils-graphite.jpg)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center right',
        }}
      >
        {/* LE LOGO SE POSAIT SUR LA PARTIE CLAIRE DU FOND et disparaissait : a
            70 % d'opacite sur des fils blancs, il ne restait qu'un contour. On
            le remonte a pleine opacite et on lui glisse un halo sombre pour
            qu'il se detache de ce qui passe derriere lui. */}
        <img
          src={`${import.meta.env.BASE_URL}logo-polyfashions-blanc.png`}
          alt="Polyfashions Carpet"
          className="pointer-events-none absolute right-6 top-6 hidden h-9 sm:block"
          style={{ filter: 'drop-shadow(0 1px 6px rgba(15,20,26,.85))' }}
        />

        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          {dateDuJour()}
        </p>

        <h1
          className="mt-2 max-w-[22ch] text-[clamp(1.7rem,1.1rem+2.4vw,2.6rem)] font-semibold
                     leading-[1.1] tracking-[-0.02em] text-white"
          style={{ textWrap: 'balance' } as React.CSSProperties}
        >
          {salutation()}
          {moi?.login ? `, ${moi.login}` : ''}
        </h1>

        {/* Le filet d'or de l'ecran de connexion, repris a l'identique. */}
        <hr
          className="my-4 h-px w-40 border-0"
          style={{
            background:
              'linear-gradient(90deg, rgb(196 161 90 / .75) 0%, rgb(196 161 90 / .35) 60%, transparent 100%)',
          }}
        />

        <p className="max-w-[54ch] text-[14.5px] leading-relaxed text-white/70">
          {METIER[moi?.role ?? ''] ?? 'Voici les écrans auxquels vous avez accès.'}
        </p>
      </header>

      {ROLES_TAUX.includes(moi?.role ?? '') && <TauxDeChange />}

      {/* ================= CE QU'ON OUVRE TOUS LES JOURS ================ */}
      {quotidiens.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-attenue-texte">
            Pour commencer
          </h2>
          {/* DEUX PAR LIGNE DES LE TELEPHONE. Pleine largeur, chaque bouton
              faisait un pave de 390 px pour trois mots : sept ecrans de haut
              rien que pour les raccourcis, et il fallait defiler pour voir le
              reste. A deux colonnes, tout tient dans un ecran. */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 xl:grid-cols-4">
            {quotidiens.map((e) => {
              const c = teinte(e.section)
              return (
                <Link
                  key={e.vers}
                  to={e.vers}
                  className={cn(
                    'group flex flex-col gap-2 rounded-[var(--radius)] border border-bordure',
                    'bg-surface p-3 shadow-sm',
                    'transition-[box-shadow,border-color,transform] duration-150',
                    'hover:-translate-y-px hover:border-primaire/45 hover:shadow-md',
                  )}
                >
                  <span
                    className="flex size-9 items-center justify-center rounded-[var(--radius-sm)]"
                    style={{ backgroundColor: c.fond, color: c.trait }}
                  >
                    <e.Icone className="size-[19px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-[13.5px] font-semibold leading-tight text-texte">
                        {e.libelle}
                      </span>
                      <ArrowRight
                        className="size-3 shrink-0 text-attenue-texte opacity-0 transition-all
                                   group-hover:translate-x-0.5 group-hover:text-primaire
                                   group-hover:opacity-100"
                      />
                    </span>
                    {/* LE RESUME PORTE LE SENS. « Mouvements » n'apprend rien a
                        qui decouvre l'outil ; « entrees, sorties, transferts »
                        dit ce qu'on vient y faire. */}
                    {e.resume && (
                      <span className="mt-1 block text-[11.5px] leading-snug text-attenue-texte">
                        {e.resume}
                      </span>
                    )}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* ================= CE QUI S'EST PASSE ===========================
          LE MUR DE TRENTE BOUTONS A DISPARU D'ICI. Il rangeait par rubrique —
          Catalogue, Production, Achats, Stock, Finance, Parametres — c'est-a-
          dire qu'il recopiait le menu de gauche au milieu de l'ecran. Une page
          d'accueil qui ne propose que des destinations n'apprend rien a celui
          qui l'ouvre : il sait deja ou il va, il ouvre l'outil pour savoir ce
          qui s'est passe pendant son absence.

          La navigation complete reste dans la barre laterale et dans la palette
          de commandes, ou elle est cherchee quand on en a besoin. */}
      <FilActualite />

      {accessibles.length === 0 && (
        <p className="text-[14px] text-attenue-texte">
          Aucun écran ne vous est ouvert. Demandez vos droits à la direction.
        </p>
      )}
    </div>
  )
}
