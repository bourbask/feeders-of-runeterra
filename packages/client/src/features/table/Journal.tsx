import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { EmptyState } from '../../components/ui/EmptyState.js';
import { useTable } from '../../ws/context.js';
import type { JournalLine } from '../../ws/journal.js';
import { isReadable } from '../../ws/journal.js';
import { journalLines } from '../../ws/store.js';
import { ProofCommand } from './Proof/ProofCommand.js';

const ETIQUETTES: Readonly<Record<JournalLine['kind'], string>> = {
  scene: 'Scène',
  conteur: 'Le conteur',
  joueur: 'Un joueur',
  systeme: 'Note',
  mecanique: '',
};

/**
 * The fiction feed.
 *
 * WHAT IT SHOWS: prose. WHAT IT NEVER SHOWS: a die, a total, an effect name, a
 * price — those have no field on a `JournalLine` to begin with (`ws/journal.ts`)
 * and reach the screen only through « Pourquoi ? ».
 *
 * A CANCELLED LINE STAYS. It is struck, it carries its cause, and it keeps its
 * « Pourquoi ? » (02-mj-ia.md 4.8.6 (b)). Removing it would be lying about
 * what happened, and would leave the player with an unexplained round trip
 * they watched happen.
 */
export function Journal(): ReactNode {
  // Deux selecteurs stables plutot qu'un qui calcule : `journalLines` rend un
  // tableau neuf a chaque appel, et `useSyncExternalStore` refuse un instantane
  // qui change d'identite a chaque rendu.
  const lines = useTable((state) => state.lines);
  const revocations = useTable((state) => state.revocations);
  const lignes = useMemo(
    () => journalLines({ lines, revocations }).filter(isReadable),
    [lines, revocations],
  );

  if (lignes.length === 0) {
    return <EmptyState>La table est ouverte. Rien ne s’est encore passé.</EmptyState>;
  }

  return (
    <ol className="fr-journal">
      {lignes.map((ligne) => (
        <li
          key={ligne.deliverySeq}
          className={`fr-journal__ligne fr-journal__ligne--${ligne.kind}${
            ligne.revoked === null ? '' : ' fr-journal__ligne--annulee'
          }`}
          {...(ligne.revoked === null ? {} : { 'data-annulee': 'true' })}
        >
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
          {ligne.correlationId === null ? null : (
            <ProofCommand correlationId={ligne.correlationId} />
          )}
        </li>
      ))}
    </ol>
  );
}
