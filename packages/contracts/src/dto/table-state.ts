/**
 * `zTableState` — what ONE PLAYER sees of a campaign.
 *
 * THE ASSUMED EXCEPTION (01-architecture.md section 2.4). This is not a mirror
 * of the engine: it is `project(CampaignState, viewerId)`, and it deliberately
 * shows less than the engine holds. So it carries no
 * `satisfies z.ZodType<...>` — there is no canonical type to satisfy — and it
 * is the only file in `core/` and `dto/` allowed to say so.
 *
 * TWO SUBTRACTIONS, both mechanical rather than conventional:
 *
 *   1. NO `visibility: 'gm'` ROW EVER. 03-donnees.md section 0.5 says the
 *      projection strips them. Rather than trusting the projector to remember,
 *      the DTO types `visibility` as the LITERAL `'public'`: a GM track or
 *      clock that reached a player view fails `zTableState.parse` instead of
 *      reaching a screen. A rule that only the projector enforces is a rule
 *      nothing enforces.
 *   2. NO `rng`. `CampaignState.rng.seed` plus a stream index is the whole
 *      future of the dice: handing it to a browser would let a player compute
 *      the result of a move before declaring it, which is invariant 1 lost
 *      through a window instead of a door. The client never needs it —
 *      everything it displays is already resolved. `contentPackHash` stays,
 *      because the client uses it to key its content cache.
 *
 * `characters` is NOT filtered: every player at the table sees everyone's
 * sheet, which is the point of a shared table. What a player must not see is
 * what the storyteller is hiding, and that is what `visibility` marks.
 */

import { z } from 'zod';

import {
  zCampaignSettings,
  zCampaignTruth,
  zChampionLock,
  zPartyState,
} from '../core/campaign-state.js';
import { zCharacterState } from '../core/character.js';
import { zClock } from '../core/clock.js';
import { zEntityState } from '../core/entity.js';
import { zCampaignStatus } from '../core/enums.js';
import { zProgressTrack } from '../core/progress-track.js';
import { zSceneState } from '../core/scene-state.js';
import { zCampaignId } from '../primitives.js';

/** A track a player is allowed to see. `gm` is not a value here. */
export const zVisibleTrack = zProgressTrack.extend({ visibility: z.literal('public') });

/** A clock a player is allowed to see. */
export const zVisibleClock = zClock.extend({ visibility: z.literal('public') });

export const zTableState = z.object({
  campaignId: zCampaignId,
  /** Last applied event, so the client knows how far behind it is. */
  seq: z.number().int().nonnegative(),
  status: zCampaignStatus,
  contentPackHash: z.string(),
  settings: zCampaignSettings,
  truths: z.array(zCampaignTruth),
  characters: z.array(zCharacterState),
  tracks: z.array(zVisibleTrack),
  clocks: z.array(zVisibleClock),
  entities: z.array(zEntityState),
  championLocks: z.array(zChampionLock),
  scene: zSceneState.nullable(),
  party: zPartyState,
});

export type TableStateDto = z.output<typeof zTableState>;
export type VisibleTrackDto = z.output<typeof zVisibleTrack>;
export type VisibleClockDto = z.output<typeof zVisibleClock>;
