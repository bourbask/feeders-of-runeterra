import type { ReactNode } from 'react';

import { EmptyState } from '../../components/ui/EmptyState.js';
import { useTable } from '../../ws/context.js';

/** Who is at the table, as the server last said. The client counts nobody. */
export function Presence(): ReactNode {
  const membres = useTable((state) => state.presence);

  if (membres.length === 0) {
    return <EmptyState>Personne d’autre n’est connecté.</EmptyState>;
  }

  return (
    <ul className="fr-presence">
      {membres.map((membre) => (
        <li key={membre.playerId} className="fr-presence__membre">
          <span
            className={membre.online ? 'fr-presence__pastille--en-ligne' : 'fr-presence__pastille'}
          />
          {membre.characterId ?? membre.playerId}
          {membre.typing ? <em className="fr-presence__ecrit"> écrit…</em> : null}
        </li>
      ))}
    </ul>
  );
}
