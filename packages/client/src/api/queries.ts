/**
 * TanStack Query keys and fetchers (01-architecture.md section 2.9).
 *
 * WHAT IS HERE AND WHAT IS NOT. Everything reachable by HTTP is here: who is
 * signed in, the list of tables, one table's metadata, one page of journal.
 * NOTHING of the live table is: the state of a game comes down the socket, is
 * held by `ws/store.ts`, and is overwritten by every `s2c.snapshot`. Caching
 * game state in a query client would give the screen a second, staler source
 * of truth — and two sources of truth is one too many (invariant 3).
 *
 * The one exception is the journal page, and it is not an exception at all:
 * `GET /api/campaigns/:id/log` is where a client lands when a proof comes back
 * `truncated: true` (section 5.4). It reads history, never the live state.
 */

import {
  zCampaignDetailResponse,
  zCampaignListResponse,
  zCampaignLogResponse,
  zMeResponse,
} from '@for/contracts';
import type { CampaignId } from '@for/engine';

import type { HttpDeps } from './http.js';
import { request } from './http.js';

/** One place where a key is spelled, so an invalidation cannot miss a cache. */
export const queryKeys = {
  me: () => ['me'] as const,
  campaigns: () => ['campaigns'] as const,
  campaign: (id: CampaignId) => ['campaigns', id] as const,
  campaignLog: (id: CampaignId, sinceSeq: number) => ['campaigns', id, 'log', sinceSeq] as const,
};

export const fetchMe = async (deps: HttpDeps) =>
  request(deps, { path: '/api/me', schema: zMeResponse });

export const fetchCampaigns = async (deps: HttpDeps) =>
  request(deps, { path: '/api/campaigns', schema: zCampaignListResponse });

export const fetchCampaign = async (deps: HttpDeps, id: CampaignId) =>
  request(deps, { path: `/api/campaigns/${id}`, schema: zCampaignDetailResponse });

export const fetchCampaignLog = async (deps: HttpDeps, id: CampaignId, sinceSeq: number) =>
  request(deps, {
    path: `/api/campaigns/${id}/log?sinceSeq=${String(sinceSeq)}`,
    schema: zCampaignLogResponse,
  });

/** The options object a component hands to `useQuery`. */
export const meQuery = (deps: HttpDeps) => ({
  queryKey: queryKeys.me(),
  queryFn: async () => fetchMe(deps),
});

export const campaignsQuery = (deps: HttpDeps) => ({
  queryKey: queryKeys.campaigns(),
  queryFn: async () => fetchCampaigns(deps),
});

export const campaignQuery = (deps: HttpDeps, id: CampaignId) => ({
  queryKey: queryKeys.campaign(id),
  queryFn: async () => fetchCampaign(deps, id),
});
