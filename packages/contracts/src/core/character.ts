/**
 * Character sheet reference and character state.
 *
 * `zCharacterSheet` mirrors the FROZEN REFERENCE to the champion sheet, not
 * the sheet itself: the full `Champion` shape is a content schema (M0-09,
 * 03-donnees.md section 4.5). A character created from a sheet never follows
 * that sheet's later edits — that is the whole point of freezing the ref.
 */

import { z } from 'zod';

import type {
  CharacterAsset,
  CharacterCondition,
  CharacterSheet,
  CharacterState,
} from '@for/engine';

import { zCharacterId, zPlayerId, zSeq, zSlug } from '../primitives.js';
import { zAttributeMap } from './attributes.js';
import { zCharacterStatus, zSheetSource } from './enums.js';
import { zGaugeSet, zMomentumBounds } from './gauges.js';

export const zCharacterSheet = z.object({
  championId: zSlug,
  source: zSheetSource,
  /** `content:champions/braum@1.4.0`, or `forged:<champion_sheets.id>`. */
  ref: z.string().min(1),
}) satisfies z.ZodType<CharacterSheet>;

export const zCharacterCondition = z.object({
  conditionId: zSlug,
  /** Content label, copied at the time it was applied. */
  label: z.string(),
  source: z.string(),
  sinceSeq: zSeq,
}) satisfies z.ZodType<CharacterCondition>;

export const zCharacterAsset = z.object({
  assetId: zSlug,
  /** Indexes of the unlocked abilities, ascending. */
  unlockedAbilities: z.array(z.number().int().nonnegative()),
  options: z.record(z.string(), z.string()),
}) satisfies z.ZodType<CharacterAsset>;

export const zCharacterState = z.object({
  id: zCharacterId,
  playerId: zPlayerId,
  championId: zSlug,
  displayName: z.string(),
  sheet: zCharacterSheet,
  attributes: zAttributeMap,
  gauges: zGaugeSet,
  momentum: z.number().int(),
  momentumBounds: zMomentumBounds,
  xpEarned: z.number().int().nonnegative(),
  xpSpent: z.number().int().nonnegative(),
  conditions: z.array(zCharacterCondition),
  assets: z.array(zCharacterAsset),
  status: zCharacterStatus,
  createdSeq: zSeq,
  updatedSeq: zSeq,
}) satisfies z.ZodType<CharacterState>;

export type CharacterStateDto = z.output<typeof zCharacterState>;
