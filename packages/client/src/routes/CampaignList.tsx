import type { CampaignSummary } from '@for/contracts';
import type { ReactNode } from 'react';

import { EmptyState } from '../components/ui/EmptyState.js';
import { Panel } from '../components/ui/Panel.js';
import { routeHref } from './route.js';

/** The tables this player may open. The server decided the list; we draw it. */
export function CampaignList(props: { readonly campagnes: readonly CampaignSummary[] }): ReactNode {
  return (
    <main className="fr-ecran fr-ecran--campagnes">
      <Panel titre="Tes tables">
        {props.campagnes.length === 0 ? (
          <EmptyState>Aucune table ne t’est ouverte pour l’instant.</EmptyState>
        ) : (
          <ul className="fr-campagnes">
            {props.campagnes.map((campagne) => (
              <li key={campagne.id} className="fr-campagnes__ligne">
                <a href={routeHref({ nom: 'table', campaignId: campagne.id })}>{campagne.name}</a>
                <span className="fr-campagnes__pitch">{campagne.pitch}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
