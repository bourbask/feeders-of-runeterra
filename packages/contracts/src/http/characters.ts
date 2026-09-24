/**
 * `GET /api/me` — who is signed in, and what they may open
 * (01-architecture.md section 6).
 *
 * WHAT IS NOT HERE IS THE DESIGN. The `players` row carries the Discord
 * snowflake, the e-mail, the avatar hash, `last_seen_at`; none of it reaches a
 * browser except what is needed to draw a name and a face. `zPlayerProfile` is
 * a PROJECTION of that row, in the same spirit as `zTableState` — not a
 * mirror, and it says so rather than being trimmed by whoever writes the
 * handler.
 *
 * `zCharacterSummary` is not `zCharacterState` either: the list on a home page
 * needs a name and a status, not a sheet. The sheet arrives with the table.
 */

import { z } from 'zod';

import { zCharacterStatus, zSheetSource } from '../core/enums.js';
import { zCampaignId, zCharacterId, zPlayerId } from '../primitives.js';
import { zCampaignSummary } from './tables.js';

export const zPlayerProfile = z.strictObject({
  id: zPlayerId,
  /** Discord global name when set, username otherwise. Already resolved server-side. */
  displayName: z.string().min(1).max(64),
  avatarUrl: z.url().nullable(),
  locale: z.string().min(2).max(8),
  isAdmin: z.boolean(),
});

export const zCharacterSummary = z.strictObject({
  id: zCharacterId,
  campaignId: zCampaignId,
  /** Content identifier of the champion, e.g. `braum`. */
  championId: z.string().min(1),
  displayName: z.string().min(1).max(64),
  sheetSource: zSheetSource,
  status: zCharacterStatus,
});

export const zMeResponse = z.strictObject({
  player: zPlayerProfile,
  characters: z.array(zCharacterSummary),
  campaigns: z.array(zCampaignSummary),
});

export type PlayerProfile = z.output<typeof zPlayerProfile>;
export type CharacterSummary = z.output<typeof zCharacterSummary>;
export type MeResponse = z.output<typeof zMeResponse>;
