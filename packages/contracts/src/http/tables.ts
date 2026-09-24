/**
 * Campaigns, and the paginated journal (01-architecture.md section 6).
 * A table IS a campaign: the product word for the same identifier.
 *
 * THE JOURNAL IS BROWSED BY `seq`, NOT BY `deliverySeq`, and the difference
 * matters enough to be said here. `deliverySeq` (ADR 0010) is a DELIVERY
 * cursor: it exists only inside one player's live socket and is never stored.
 * This route reads the journal itself, which is numbered by `seq`. So
 * `sinceSeq` here is correct and `sinceDeliverySeq` would be meaningless —
 * whereas on `c2s.resume` it is the other way round. Two cursors, two homes.
 *
 * This route is also where a client lands when `s2c.turn_proof` comes back
 * `truncated: true`. It is projected per spectator like `zTableState`: a
 * player reads their own view of the journal, not the table's.
 */

import { z } from 'zod';

import { zCampaignStatus } from '../core/enums.js';
import { zGameEvent } from '../events/index.js';
import { zCampaignId, zPlayerId, zSeq, zSlug } from '../primitives.js';

export const zCampaignSummary = z.strictObject({
  id: zCampaignId,
  slug: zSlug,
  name: z.string().min(1).max(120),
  pitch: z.string().max(2000),
  status: zCampaignStatus,
  ownerPlayerId: zPlayerId,
  /** Semver of the content pack this campaign is frozen on. */
  contentPackVersion: z.string().min(1),
  /** Journal head. 0 on a campaign that has not started. */
  seq: z.number().int().nonnegative(),
});

export const zCampaignListResponse = z.strictObject({
  campaigns: z.array(zCampaignSummary),
});

/**
 * `slug` is optional: the server derives it from the name when absent, and a
 * client that guessed one is only proposing it — the server owns uniqueness.
 */
export const zCreateCampaignBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  pitch: z.string().max(2000).default(''),
  slug: zSlug.optional(),
});

export const zCampaignParams = z.strictObject({ id: zCampaignId });

/** Metadata plus `lastSeq`, which is the same number as `seq`, named for its use. */
export const zCampaignDetailResponse = zCampaignSummary.extend({
  lastSeq: z.number().int().nonnegative(),
  contentPackHash: z.string().min(1),
  rulesVersion: z.number().int().nonnegative(),
});

/** One page of journal. Past this the client pages again. */
export const CAMPAIGN_LOG_PAGE_MAX = 200;

export const zCampaignLogQuery = z.strictObject({
  sinceSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(CAMPAIGN_LOG_PAGE_MAX)
    .default(CAMPAIGN_LOG_PAGE_MAX),
});

export const zCampaignLogEntry = z.strictObject({ seq: zSeq, event: zGameEvent });

export const zCampaignLogResponse = z.strictObject({
  entries: z.array(zCampaignLogEntry),
  /** `null` when the page reached the head: there is nothing more to ask for. */
  nextSinceSeq: z.number().int().nonnegative().nullable(),
  lastSeq: z.number().int().nonnegative(),
});

export type CampaignSummary = z.output<typeof zCampaignSummary>;
export type CampaignDetailResponse = z.output<typeof zCampaignDetailResponse>;
export type CampaignLogEntry = z.output<typeof zCampaignLogEntry>;
export type CampaignLogResponse = z.output<typeof zCampaignLogResponse>;
