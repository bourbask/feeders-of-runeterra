import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { EmptyState } from '../../components/ui/EmptyState.js';
import { useTable } from '../../ws/context.js';
import type { JournalLine } from '../../ws/journal.js';
import { isReadable } from '../../ws/journal.js';
import { journalLines } from '../../ws/store.js';
import { ProofCommand } from './Proof/ProofCommand.js';
import { porteeVue } from './portee.js';

/**
 * The fiction feed, on its three rails (05-interface.md §5).
 *
 * WHAT IT SHOWS: prose. WHAT IT NEVER SHOWS: a die, a total, an effect name, a
 * price — those have no field on a `JournalLine` to begin with (`ws/journal.ts`)
 * and reach the screen only through « Pourquoi ? ».
 *
 * THREE INFORMATIONS, NEVER TWO (§5.2). Each block carries its scope on three
 * channels at once: the RAIL (and its colour), the INDENTATION, and the GLYPH —
 * plus the label, in letters, always. §5.3 says why that last one is not a
 * belt-and-braces: « si la portée ne se lit qu'à la teinte, il ne sait plus qui
 * lit son message, et il peut faire un incident qu'aucune annulation ne
 * répare ». The colour is the redundancy, not the information. Held by
 * `Journal.test.tsx` and by the colour-stripped render of `screens.test.tsx`.
 *
 * « POURQUOI ? » IS ON THE JETS, NOT ON EVERY LINE. §10: « Chaque jet est
 * consultable via "Pourquoi ?", replié par défaut ». M0-19 put one on every
 * line of prose, which made the command mean « this line exists » rather than
 * « dice were rolled here ». A turn that rolled nothing has no proof worth
 * folding, so it gets no button; a turn that rolled gets exactly ONE, on its
 * first readable line. `Journal.test.tsx` counts both.
 *
 * A CANCELLED LINE STAYS. It is struck, it carries its cause, and it keeps its
 * « Pourquoi ? » (02-mj-ia.md 4.8.6 (b)). Removing it would be lying about
 * what happened, and would leave the player with an unexplained round trip
 * they watched happen.
 */

const ETIQUETTES: Readonly<Record<JournalLine['kind'], string>> = {
  scene: 'Scène',
  conteur: 'Le conteur',
  joueur: 'Un joueur',
  systeme: 'Note',
  mecanique: '',
};

/**
 * The turns whose proof is worth opening: the ones that rolled.
 *
 * READ OVER ALL THE LINES, including the mechanical ones the feed drops — a
 * `roll.action_resolved` carries no prose, so it is invisible in the list the
 * reader sees and would be invisible to this count too if it ran after the
 * filter.
 */
function toursAvecJet(lignes: readonly JournalLine[]): ReadonlySet<string> {
  const tours = new Set<string>();
  for (const ligne of lignes) {
    if (ligne.hasRoll && ligne.correlationId !== null) tours.add(ligne.correlationId);
  }
  return tours;
}

/** A line's identity in the feed: its journal number and its delivery number. */
function cle(ligne: JournalLine): string {
  return `${String(ligne.seq)}:${String(ligne.deliverySeq)}`;
}

/** The band that names the recipients of a restricted block (§5.2). */
function Bandeau(props: { readonly ligne: JournalLine }): ReactNode {
  const vue = porteeVue(props.ligne.scope);
  const combien = props.ligne.recipients?.length ?? 0;

  return (
    <span className="fr-bloc__portee" data-portee={vue.scope}>
      <span className="fr-bloc__glyphe" aria-hidden="true">
        {vue.glyphe}
      </span>
      {/* LE LIBELLÉ EST TOUJOURS LÀ, en texte, pour les trois portées. C'est le
          seul canal qu'un joueur daltonien lit à coup sûr (§5.3). */}
      <span className="fr-bloc__libelle">{vue.libelle}</span>
      {/* Le protocole porte des identifiants, pas des noms affichables : on
          compte les destinataires plutôt que d'en inventer la liste. */}
      {vue.scope === 'subset' && combien > 0 ? (
        <span className="fr-bloc__compte"> · {combien} destinataire(s)</span>
      ) : null}
    </span>
  );
}

export function Journal(): ReactNode {
  // Deux selecteurs stables plutot qu'un qui calcule : `journalLines` rend un
  // tableau neuf a chaque appel, et `useSyncExternalStore` refuse un instantane
  // qui change d'identite a chaque rendu.
  const lines = useTable((state) => state.lines);
  const history = useTable((state) => state.history);
  const revocations = useTable((state) => state.revocations);

  const toutes = useMemo(
    () => journalLines({ lines, history, revocations }),
    [lines, history, revocations],
  );
  const avecJet = useMemo(() => toursAvecJet(toutes), [toutes]);
  const lignes = useMemo(() => toutes.filter(isReadable), [toutes]);

  // ONE button per turn, on its FIRST readable line. Walking the list once and
  // remembering which turns have been served is what makes « exactly one »
  // true even when a turn spans four blocks of prose.
  const porteurs = useMemo(() => {
    const servis = new Set<string>();
    const cles = new Set<string>();
    for (const ligne of lignes) {
      const tour = ligne.correlationId;
      if (tour === null || !avecJet.has(tour) || servis.has(tour)) continue;
      servis.add(tour);
      cles.add(cle(ligne));
    }
    return cles;
  }, [lignes, avecJet]);

  if (lignes.length === 0) {
    return <EmptyState>La table est ouverte. Rien ne s’est encore passé.</EmptyState>;
  }

  return (
    <ol className="fr-journal">
      {lignes.map((ligne) => {
        const vue = porteeVue(ligne.scope);
        const tour = ligne.correlationId;
        const porteLeJet = tour !== null && porteurs.has(cle(ligne));

        return (
          <li
            key={cle(ligne)}
            className={`fr-journal__ligne fr-journal__ligne--${ligne.kind}${
              ligne.revoked === null ? '' : ' fr-journal__ligne--annulee'
            }`}
            data-portee={vue.scope}
            data-niveau={String(vue.niveau)}
            {...(ligne.revoked === null ? {} : { 'data-annulee': 'true' })}
          >
            <Bandeau ligne={ligne} />
            <span className="fr-journal__qui">{ligne.speaker ?? ETIQUETTES[ligne.kind]}</span>
            {ligne.revoked === null ? (
              <span className="fr-journal__texte">{ligne.text}</span>
            ) : (
              <span className="fr-journal__texte">
                <s>{ligne.text}</s>
                <span className="fr-annule">
                  {' '}
                  — annulé : {ligne.revoked.reason} (journal n° {ligne.revoked.bySeq})
                </span>
              </span>
            )}
            {tour !== null && porteLeJet ? <ProofCommand correlationId={tour} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
