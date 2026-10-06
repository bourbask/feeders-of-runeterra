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
  zChampionCatalogueResponse,
  zLogoutResponse,
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
  champions: () => ['content', 'champions'] as const,
};

export const fetchMe = async (deps: HttpDeps) =>
  request(deps, { path: '/api/me', schema: zMeResponse });

export const fetchCampaigns = async (deps: HttpDeps) =>
  request(deps, { path: '/api/campaigns', schema: zCampaignListResponse });

/**
 * Sign out. A `POST`, so `request` carries the CSRF header on its own.
 *
 * THE SERVER DOES BOTH HALVES AND THE CLIENT NEITHER: it revokes the session
 * row AND clears the cookie. The client holds no token to drop — it never had
 * one — so the only thing left to do here is to forget what was cached under
 * that identity, which is the caller's job.
 */
export const logout = async (deps: HttpDeps) =>
  request(deps, { method: 'POST', path: '/api/auth/logout', schema: zLogoutResponse });

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

/**
 * One page of a table's journal, read when the table screen opens.
 *
 * THE SOCKET CANNOT SUPPLY THIS. `s2c.snapshot` sets the resume cursor to the
 * head, so a first connection has no gap to report and asks for nothing: the
 * feed would stay empty on a campaign that already has two hundred entries.
 * The live feed and the past come from two different places on purpose.
 */
export const campaignLogQuery = (deps: HttpDeps, id: CampaignId) => ({
  queryKey: queryKeys.campaignLog(id, 0),
  queryFn: async () => fetchCampaignLog(deps, id, 0),
});

/**
 * The champions a player may choose from.
 *
 * CONTENT REACHES THE BROWSER BY HTTP, NEVER BY THE BUNDLE
 * (01-architecture.md section 2.5): `@for/content` is forbidden to this
 * package by `.dependency-cruiser.cjs`, so this read is the only way the
 * screen learns that Ashe exists.
 *
 * NOT IN THE SOCKET STORE, deliberately. The catalogue is the same for every
 * table and for every player; the store holds what the SERVER SAID ABOUT THIS
 * TABLE, and a snapshot wipes it. A catalogue wiped by a snapshot would blank
 * the choice screen on every reconnection.
 */
export const fetchChampions = async (deps: HttpDeps) =>
  request(deps, { path: '/api/content/champions', schema: zChampionCatalogueResponse });

export const championsQuery = (deps: HttpDeps) => ({
  queryKey: queryKeys.champions(),
  queryFn: async () => fetchChampions(deps),
});

export const campaignQuery = (deps: HttpDeps, id: CampaignId) => ({
  queryKey: queryKeys.campaign(id),
  queryFn: async () => fetchCampaign(deps, id),
});
