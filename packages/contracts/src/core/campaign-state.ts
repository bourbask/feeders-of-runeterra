/**
 * `zCampaignState` — the Zod mirror of the root of game state.
 *
 * THE MIRROR RULE, in one place (ARCHITECTURE.md section 4.3, 01-architecture.md
 * section 2.4). `CampaignState` is declared by `@for/engine` and imported here
 * with `import type`. The canonical type does NOT come from this schema: this
 * file deliberately declares no `CampaignState` of its own, inferred or
 * otherwise, because that would make the engine depend on contracts at runtime
 * and kill its purity. The acceptance criterion greps this file for exactly
 * that, so it stays free of such a declaration — the only type it exports is
 * `CampaignStateDto`, which is the SCHEMA's output and a different thing.
 *
 * `satisfies z.ZodType<CampaignState>` below is the enforcement. Add a field to
 * the engine's `CampaignState` without adding it here and `pnpm typecheck`
 * fails, pointing at this line. That failure is the feature.
 *
 * NOTE ON `status`. 03-donnees.md section 3.5 prints a `CampaignState` without
 * it, while section 3.4 defines `campaign.status_changed` carrying
 * `CampaignStatus` — a status the reducer has nowhere to put if the state does
 * not hold one. The engine carries it; the mirror follows the engine, as the
 * mirror rule requires. Reported rather than dropped.
 */

import { z } from 'zod';

import type {
  CampaignSettings,
  CampaignState,
  CampaignTruth,
  ChampionLock,
  PartyState,
  RngState,
} from '@for/engine';

import {
  zCampaignId,
  zCharacterId,
  zClockId,
  zEntityId,
  zPlayerId,
  zSeed,
  zSlug,
  zTrackId,
} from '../primitives.js';
import { zCharacterState } from './character.js';
import { zClockState } from './clock.js';
import { zEntityState } from './entity.js';
import { zCampaignStatus, zChampionLockKind, zRngStream } from './enums.js';
import { zProgressTrack } from './progress-track.js';
import { zSceneState } from './scene-state.js';

export const zChampionLock = z.object({
  championId: zSlug,
  lockKind: zChampionLockKind,
  reason: z.string(),
  setSeq: z.number().int().nonnegative(),
}) satisfies z.ZodType<ChampionLock>;

export const zCampaignTruth = z.object({
  truthId: zSlug,
  optionId: zSlug,
  customText: z.string().nullable(),
}) satisfies z.ZodType<CampaignTruth>;

/**
 * Model names are ADAPTER DATA: nothing is hard-coded, and an empty value
 * falls back to `NARRATOR_MODEL` then to the adapter's default
 * (ARCHITECTURE.md section 4.5). `.strict()` because an unknown settings key is
 * a typo that would otherwise be dropped in silence.
 */
export const zCampaignSettings = z.strictObject({
  schemaVersion: z.literal(1),
  models: z.strictObject({
    narration: z.string().nullable(),
    structured: z.string().nullable(),
  }),
  gmVerbosity: z.enum(['sobre', 'standard', 'ample']),
  oracleBias: z.enum(['clement', 'neutre', 'impitoyable']),
  safety: z.strictObject({
    /** Absolute bans. Player-authored French text, carried, never authored here. */
    lines: z.array(z.string()),
    /** Off-screen subjects. */
    veils: z.array(z.string()),
  }),
  allowForgedChampions: z.boolean(),
  requireForgeReview: z.boolean(),
}) satisfies z.ZodType<CampaignSettings>;

export const zPartyState = z.object({
  memberPlayerIds: z.array(zPlayerId),
  ownerPlayerId: zPlayerId,
}) satisfies z.ZodType<PartyState>;

/**
 * `draws` is the NEXT index per stream, and it is MONOTONE: a reverted roll
 * leaves its index consumed, so replaying an intent after a cancellation does
 * not give back the same dice (03-donnees.md section 3.6). A partial record,
 * because a stream that has never been drawn from has no entry — an exhaustive
 * `z.record` would demand a zero for each.
 */
export const zRngState = z.object({
  seed: zSeed,
  draws: z.partialRecord(zRngStream, z.number().int().nonnegative()),
}) satisfies z.ZodType<RngState>;

export const zCampaignState = z.object({
  campaignId: zCampaignId,
  /** Last applied event. Zero on an initial state, hence not `zSeq`. */
  seq: z.number().int().nonnegative(),
  reducerVersion: z.number().int().positive(),
  contentPackHash: z.string(),
  status: zCampaignStatus,
  settings: zCampaignSettings,
  truths: z.array(zCampaignTruth),
  characters: z.record(zCharacterId, zCharacterState),
  tracks: z.record(zTrackId, zProgressTrack),
  clocks: z.record(zClockId, zClockState),
  entities: z.record(zEntityId, zEntityState),
  championLocks: z.record(z.string(), zChampionLock),
  /** `null` when no scene is open. */
  scene: zSceneState.nullable(),
  party: zPartyState,
  rng: zRngState,
}) satisfies z.ZodType<CampaignState>;

export type CampaignStateDto = z.output<typeof zCampaignState>;
export type CampaignSettingsDto = z.output<typeof zCampaignSettings>;
