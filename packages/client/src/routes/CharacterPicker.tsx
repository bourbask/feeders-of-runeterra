import type { CharacterSummary } from '@for/contracts';
import type { ReactNode } from 'react';

import { EmptyState } from '../components/ui/EmptyState.js';
import { Panel } from '../components/ui/Panel.js';
import { routeHref } from './route.js';

/**
 * Choosing a champion. A SHELL IN M0, and deliberately so: the champion lock
 * is posted by `character.created`, through the same journal as the game
 * (ARCHITECTURE.md section 4.4). Letting this screen reserve anything would be
 * a second write path, which is the one thing section 6 forbids.
 */
export function CharacterPicker(props: {
  readonly campaignId: string;
  readonly personnages: readonly CharacterSummary[];
}): ReactNode {
  const miens = props.personnages.filter(
    (personnage) => personnage.campaignId === props.campaignId,
  );

  return (
    <main className="fr-ecran fr-ecran--personnage">
      <Panel titre="Ton champion">
        {miens.length === 0 ? (
          <EmptyState>
            Aucun champion à cette table. La création de personnage arrive avec M0-24.
          </EmptyState>
        ) : (
          <ul className="fr-personnages">
            {miens.map((personnage) => (
              <li key={personnage.id}>
                {personnage.displayName} — {personnage.championId} ({personnage.status})
              </li>
            ))}
          </ul>
        )}
        <a href={routeHref({ nom: 'table', campaignId: props.campaignId })}>Revenir à la table</a>
      </Panel>
    </main>
  );
}
