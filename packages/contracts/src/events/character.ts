/**
 * `character.*` payloads — sheets, gauges, momentum, conditions, assets, XP.
 *
 * NONE OF THESE IS EMISSIBLE BY THE MODEL. `actorKind` is `engine`, `player`
 * or `system`; the input validator rejects any gauge event carrying
 * `actorKind: 'gm_ai'` (03-donnees.md section 3.4, invariant 1). The engine
 * lists them in `ENGINE_ONLY_EVENT_TYPES`, and `tests/engine-parity.test.ts`
 * checks that every one of those types exists here.
 */

import { z } from 'zod';

import type {
  CharacterAssetAddedPayload,
  CharacterAssetRemovedPayload,
  CharacterAssetUpgradedPayload,
  CharacterAttributesCorrectedPayload,
  CharacterConditionAddedPayload,
  CharacterConditionRemovedPayload,
  CharacterCreatedPayload,
  CharacterDiedPayload,
  CharacterGaugeChangedPayload,
  CharacterMomentumBurnedPayload,
  CharacterMomentumChangedPayload,
  CharacterMomentumNegatedPayload,
  CharacterRenamedPayload,
  CharacterRetiredPayload,
  CharacterSheetReboundPayload,
  CharacterXpEarnedPayload,
  CharacterXpSpentPayload,
} from '@for/engine';

import { zAttributeMap } from '../core/attributes.js';
import { zGaugeId, zSheetSource } from '../core/enums.js';
import { zGaugeSet } from '../core/gauges.js';
import {
  zCharacterId,
  zEventCause,
  zJsonObject,
  zPlayerId,
  zSceneId,
  zSeq,
  zSlug,
  zTrackId,
} from '../primitives.js';

/**
 * The frozen champion sheet, carried opaquely. The engine freezes it and never
 * reads inside it, because the real shape is a CONTENT schema
 * (`ChampionSchema`, 03-donnees.md section 4.5) that M0-09 delivers. M0-09
 * tightens this field to `zChampion`; until then a loose object here is
 * honest, and a fabricated tight one would not be.
 */
export const zChampionSheetSnapshot = zJsonObject;

export const zCharacterCreatedPayload = z.object({
  characterId: zCharacterId,
  playerId: zPlayerId,
  championId: zSlug,
  displayName: z.string().min(1),
  sheetSource: zSheetSource,
  sheetRef: z.string().min(1),
  sheetSnapshot: zChampionSheetSnapshot,
  attributes: zAttributeMap,
  gauges: zGaugeSet,
  momentum: z.number().int(),
}) satisfies z.ZodType<CharacterCreatedPayload>;

export const zCharacterRenamedPayload = z.object({
  characterId: zCharacterId,
  from: z.string(),
  to: z.string(),
}) satisfies z.ZodType<CharacterRenamedPayload>;

/**
 * `from`, `to` AND `clamped` are all written, although two of them are
 * derivable. A journal that reads without recomputing is worth the bytes.
 */
export const zCharacterGaugeChangedPayload = z.object({
  characterId: zCharacterId,
  gauge: zGaugeId,
  delta: z.number().int(),
  from: z.number().int(),
  to: z.number().int(),
  clamped: z.boolean(),
  cause: zEventCause,
}) satisfies z.ZodType<CharacterGaugeChangedPayload>;

export const zCharacterMomentumChangedPayload = z.object({
  characterId: zCharacterId,
  delta: z.number().int(),
  from: z.number().int(),
  to: z.number().int(),
  clamped: z.boolean(),
  cause: zEventCause,
}) satisfies z.ZodType<CharacterMomentumChangedPayload>;

export const zCharacterMomentumBurnedPayload = z.object({
  characterId: zCharacterId,
  spent: z.number().int(),
  resetTo: z.number().int(),
  appliedToRollSeq: zSeq,
}) satisfies z.ZodType<CharacterMomentumBurnedPayload>;

export const zCharacterMomentumNegatedPayload = z.object({
  characterId: zCharacterId,
  actionDie: z.number().int(),
  momentumValue: z.number().int(),
  rollSeq: zSeq,
}) satisfies z.ZodType<CharacterMomentumNegatedPayload>;

export const zCharacterConditionAddedPayload = z.object({
  characterId: zCharacterId,
  conditionId: zSlug,
  label: z.string(),
  source: z.string(),
}) satisfies z.ZodType<CharacterConditionAddedPayload>;

export const zCharacterConditionRemovedPayload = z.object({
  characterId: zCharacterId,
  conditionId: zSlug,
  cause: zEventCause,
}) satisfies z.ZodType<CharacterConditionRemovedPayload>;

export const zCharacterAssetAddedPayload = z.object({
  characterId: zCharacterId,
  assetId: zSlug,
  options: z.record(z.string(), z.string()).optional(),
}) satisfies z.ZodType<CharacterAssetAddedPayload>;

export const zCharacterAssetUpgradedPayload = z.object({
  characterId: zCharacterId,
  assetId: zSlug,
  abilityIndex: z.number().int().nonnegative(),
  xpCost: z.number().int().nonnegative(),
}) satisfies z.ZodType<CharacterAssetUpgradedPayload>;

export const zCharacterAssetRemovedPayload = z.object({
  characterId: zCharacterId,
  assetId: zSlug,
  cause: zEventCause,
}) satisfies z.ZodType<CharacterAssetRemovedPayload>;

export const zCharacterXpEarnedPayload = z.object({
  characterId: zCharacterId,
  amount: z.number().int(),
  reason: z.string(),
  trackId: zTrackId.optional(),
}) satisfies z.ZodType<CharacterXpEarnedPayload>;

export const zCharacterXpSpentPayload = z.object({
  characterId: zCharacterId,
  amount: z.number().int(),
  target: z.string(),
}) satisfies z.ZodType<CharacterXpSpentPayload>;

/** Admin only. */
export const zCharacterAttributesCorrectedPayload = z.object({
  characterId: zCharacterId,
  from: zAttributeMap,
  to: zAttributeMap,
  reason: z.string(),
}) satisfies z.ZodType<CharacterAttributesCorrectedPayload>;

export const zCharacterDiedPayload = z.object({
  characterId: zCharacterId,
  cause: zEventCause,
  finalSceneId: zSceneId.optional(),
}) satisfies z.ZodType<CharacterDiedPayload>;

export const zCharacterRetiredPayload = z.object({
  characterId: zCharacterId,
  reason: z.string(),
}) satisfies z.ZodType<CharacterRetiredPayload>;

export const zCharacterSheetReboundPayload = z.object({
  characterId: zCharacterId,
  fromSheetRef: z.string(),
  toSheetRef: z.string(),
  reason: z.string(),
}) satisfies z.ZodType<CharacterSheetReboundPayload>;
