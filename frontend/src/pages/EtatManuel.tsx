/**
 * LE MANUEL, SUR PAPIER — la meme documentation, pour qui n'a pas l'ecran.
 *
 * Le catalogue d'aide promettait deux lecteurs depuis le premier jour : le « ? »
 * de chaque ecran, ET un manuel imprimable. Seul le premier existait. Un atelier
 * ne forme pas ses magasiniers en leur faisant ouvrir un panneau lateral : il
 * pose une liasse sur la table, on l'annote, on la range pres du pont-bascule.
 *
 * UNE SEULE SOURCE, DEUX SORTIES. Ce manuel ne recopie rien : il rend `SUJETS`,
 * exactement ce que le panneau affiche. Deux textes qui disent la meme chose
 * divergent le jour ou l'un est corrige seul — et c'est toujours le papier qui
 * reste faux, parce que personne ne pense a le reimprimer.
 *
 * ON PEUT N'EN IMPRIMER QU'UN CHAPITRE. Le manuel complet fait des dizaines de
 * pages ; le magasinier n'a besoin que du stock, l'acheteuse que des achats.
 * Le filtre est donc en haut, et il ne s'imprime pas.
 */
import { useMemo, useState } from 'react'
import { EtatImprimable } from '../composants/Etat'
import { Selecteur } from '../composants/ui/base'
import { SUJETS } from '../aide/contenu'
import type { Sujet } from '../aide/types'

/**
 * Les chapitres, dans l'ordre ou l'on apprend le metier : ce qu'on tient
 * (le catalogue), ce qu'on achete, ce qu'on recoit, ce qu'on bouge, ce qu'on
 * regarde, ce qu'on regle.
 */
const CHAPITRES: { titre: string; prefixes: string[] }[] = [
  {
    titre: 'Catalogue et données de base',
    prefixes: ['/catalogue', '/categories', '/couleurs', '/fournisseurs', '/equivalences', '/referentiels', '/qualites'],
  },
  { titre: 'Achats', prefixes: ['/plan-achat', '/besoins', '/bons-commande'] },
  { titre: 'Importation', prefixes: ['/import', '/receptions-import'] },
  { titre: 'Réceptions et stock', prefixes: ['/receptions', '/mouvements', '/transferts', '/stock', '/inventaires'] },
  { titre: 'Analyse', prefixes: ['/statistiques', '/valorisation', '/etats', '/'] },
  { titre: 'Réglages', prefixes: ['/utilisateurs'] },
]

/** Le chapitre d'une fiche : le prefixe le plus PRECIS gagne, comme pour l'aide. */
function chapitreDe(sujet: Sujet): string {
  let meilleur = { titre: 'Autres écrans', longueur: -1 }
  for (const c of CHAPITRES) {
    for (const p of c.prefixes) {
      const correspond = sujet.route === p || sujet.route.startsWith(p === '/' ? '/' : p + '/') || sujet.route.startsWith(p)
      if (correspond && p.length > meilleur.longueur) meilleur = { titre: c.titre, longueur: p.length }
    }
  }
  return meilleur.titre
}

export function EtatManuel() {
  const [chapitre, setChapitre] = useState('')

  const parChapitre = useMemo(() => {
    const groupes = new Map<string, Sujet[]>()
    for (const s of SUJETS) {
      const c = chapitreDe(s)
      if (!groupes.has(c)) groupes.set(c, [])
      groupes.get(c)!.push(s)
    }
    // L'ordre des chapitres est celui declare, pas celui des rencontres.
    const ordonne: { titre: string; sujets: Sujet[] }[] = []
    for (const c of CHAPITRES) {
      const s = groupes.get(c.titre)
      if (s?.length) ordonne.push({ titre: c.titre, sujets: s })
      groupes.delete(c.titre)
    }
    for (const [titre, sujets] of groupes) ordonne.push({ titre, sujets })
    return ordonne
  }, [])

  const retenus = chapitre ? parChapitre.filter((c) => c.titre === chapitre) : parChapitre
  const nbFiches = retenus.reduce((s, c) => s + c.sujets.length, 0)
  const nbChamps = retenus.reduce(
    (s, c) => s + c.sujets.reduce((t, f) => t + (f.champs?.length ?? 0), 0),
    0,
  )

  return (
    <EtatImprimable
      titre="Manuel d’utilisation"
      sousTitre={chapitre || 'Toutes les fonctions'}
      enTete={
        <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
          <span>
            <span className="text-neutral-600">Écrans documentés : </span>
            <span className="font-semibold">{nbFiches}</span>
          </span>
          <span>
            <span className="text-neutral-600">Champs décrits : </span>
            <span className="font-semibold">{nbChamps}</span>
          </span>
          {/* LE FILTRE NE S'IMPRIME PAS : il sert a choisir ce qu'on imprime,
              il n'a rien a faire sur la feuille. */}
          <span className="print:hidden">
            <Selecteur
              value={chapitre}
              onChange={(e) => setChapitre(e.target.value)}
              className="h-7 text-[12px]"
            >
              <option value="">Manuel complet</option>
              {parChapitre.map((c) => (
                <option key={c.titre} value={c.titre}>
                  {c.titre}
                </option>
              ))}
            </Selecteur>
          </span>
        </div>
      }
    >
      <div className="space-y-6">
        {retenus.map((c) => (
          <section key={c.titre}>
            <h2 className="mb-2 border-b-2 border-black pb-0.5 text-[13px] font-bold uppercase tracking-wide">
              {c.titre}
            </h2>
            <div className="space-y-4">
              {c.sujets.map((s) => (
                <FicheImprimee key={s.route} sujet={s} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </EtatImprimable>
  )
}

/** Une fiche, dans l'ordre ou les questions se posent devant un ecran inconnu. */
function FicheImprimee({ sujet }: { sujet: Sujet }) {
  return (
    // `break-inside-avoid` : une fiche coupee entre deux pages se lit comme
    // deux fiches incompletes. Elle tient ensemble ou passe a la page suivante.
    <article className="break-inside-avoid border-l-2 border-neutral-400 pl-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="text-[12px] font-bold">{sujet.titre}</h3>
        <span className="text-[10px] text-neutral-600">{sujet.chemin}</span>
      </header>
      <p className="mt-0.5 text-[10.5px] leading-snug">{sujet.objectif}</p>

      {sujet.prerequis?.length ? (
        <Bloc titre="Avant de commencer">
          <ul className="list-disc pl-4">
            {sujet.prerequis.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Bloc>
      ) : null}

      {sujet.droits ? <Bloc titre="Qui peut le faire">{sujet.droits}</Bloc> : null}

      {sujet.procedures?.map((p) => (
        <Bloc key={p.titre} titre={p.titre}>
          <ol className="list-decimal pl-4">
            {p.etapes.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ol>
          {p.resultat ? (
            <p className="mt-0.5 italic">
              <span className="font-semibold not-italic">Résultat : </span>
              {p.resultat}
            </p>
          ) : null}
        </Bloc>
      ))}

      {/* LE TABLEAU DES CHAMPS EST LE COEUR du manuel : c'est ce qu'on vient y
          chercher quand on hesite devant une case. */}
      {sujet.champs?.length ? (
        <Bloc titre="Les champs de cet écran">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-400 text-left">
                <th className="w-40 py-0.5 pr-2 font-semibold">Champ</th>
                <th className="py-0.5 font-semibold">Rôle</th>
              </tr>
            </thead>
            <tbody>
              {sujet.champs.map((c) => (
                <tr key={c.nom} className="border-b border-neutral-200 align-top">
                  <td className="py-0.5 pr-2 font-medium">
                    {c.nom}
                    {c.obligatoire ? <span className="ml-1 font-normal">(obligatoire)</span> : null}
                  </td>
                  <td className="py-0.5">
                    {c.description}
                    {c.valeurs ? (
                      <div className="text-neutral-600">Valeurs : {c.valeurs}</div>
                    ) : null}
                    {c.defaut ? (
                      <div className="text-neutral-600">Par défaut : {c.defaut}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Bloc>
      ) : null}

      {sujet.regles?.length ? (
        <Bloc titre="Règles appliquées">
          <ul className="list-disc pl-4">
            {sujet.regles.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Bloc>
      ) : null}

      {sujet.messages?.length ? (
        <Bloc titre="Si l’outil refuse">
          <ul className="list-disc pl-4">
            {sujet.messages.map((m) => (
              <li key={m.message}>
                <span className="font-medium">« {m.message} » </span>
                {m.cause}
              </li>
            ))}
          </ul>
        </Bloc>
      ) : null}
    </article>
  )
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5 text-[10px] leading-snug">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-neutral-600">
        {titre}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}
