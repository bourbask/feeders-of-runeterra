import { anId } from '@for/testkit';
import { describe, expect, it } from 'vitest';

import type { HttpDeps } from './http.js';
import {
  campaignQuery,
  campaignsQuery,
  fetchCampaign,
  fetchCampaignLog,
  fetchCampaigns,
  fetchMe,
  meQuery,
  queryKeys,
} from './queries.js';

const campagne = {
  id: anId('campaign'),
  slug: 'le-col',
  name: 'Le col de Rakelstake',
  pitch: 'Une passe que personne ne franchit deux fois.',
  status: 'active',
  ownerPlayerId: anId('player'),
  contentPackVersion: '1.0.0',
  seq: 12,
};

function depsRendant(corps: unknown, chemins: string[] = []): HttpDeps {
  return {
    baseUrl: '',
    fetch: (url: string | URL | Request) => {
      if (typeof url === 'string') chemins.push(url);
      return Promise.resolve(
        new Response(JSON.stringify(corps), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    },
  };
}

describe('les clés de cache', () => {
  it('sont écrites une seule fois, et hiérarchiques', () => {
    const id = anId('campaign');
    expect(queryKeys.me()).toEqual(['me']);
    expect(queryKeys.campaigns()).toEqual(['campaigns']);
    expect(queryKeys.campaign(id)).toEqual(['campaigns', id]);
    expect(queryKeys.campaignLog(id, 40)).toEqual(['campaigns', id, 'log', 40]);
  });

  it('les options de requête portent leur clé', () => {
    const deps = depsRendant({});
    const id = anId('campaign');
    expect(meQuery(deps).queryKey).toEqual(['me']);
    expect(campaignsQuery(deps).queryKey).toEqual(['campaigns']);
    expect(campaignQuery(deps, id).queryKey).toEqual(['campaigns', id]);
  });
});

describe('les lectures HTTP', () => {
  it('« qui suis-je » rend un profil validé', async () => {
    const deps = depsRendant({
      player: {
        id: anId('player'),
        displayName: 'Théo',
        avatarUrl: null,
        locale: 'fr',
        isAdmin: false,
      },
      characters: [],
      campaigns: [campagne],
    });

    await expect(fetchMe(deps)).resolves.toMatchObject({ campaigns: [{ slug: 'le-col' }] });
  });

  it('la liste des campagnes est validée', async () => {
    const deps = depsRendant({ campaigns: [campagne] });
    await expect(fetchCampaigns(deps)).resolves.toEqual({ campaigns: [campagne] });
  });

  it('le détail d’une campagne porte sa tête de journal', async () => {
    const deps = depsRendant({
      ...campagne,
      lastSeq: 12,
      contentPackHash: 'abc',
      rulesVersion: 1,
    });
    await expect(fetchCampaign(deps, campagne.id)).resolves.toMatchObject({ lastSeq: 12 });
  });

  it('le journal se lit par `seq`, jamais par `deliverySeq`', async () => {
    const chemins: string[] = [];
    const deps = depsRendant({ entries: [], nextSinceSeq: null, lastSeq: 12 }, chemins);

    await fetchCampaignLog(deps, campagne.id, 40);

    expect(chemins[0]).toContain('sinceSeq=40');
    expect(chemins[0]).not.toContain('deliverySeq');
  });
});
