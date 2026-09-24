/**
 * `roll.*` payloads — the heart of invariant 1.
 *
 * These events are written BEFORE any AI call. Everything the storyteller will
 * later dress is already a fact on this line: the dice, the total, the
 * outcome, the price drawn.
 *
 * `roll.price_paid` CARRIES NO CHOICE FIELD, and that is the whole point
 * (ADR 0006). The engine rolls a d12 on the `pay-the-price` table, and when
 * the drawn entry proposes several `suggestedEffects` a SECOND draw on the
 * `price` stream picks one — `effectIndex` records which. Nobody else decided
 * anything, and the journal replays bit for bit.
 */

import { z } from 'zod';

import type {
  RollActionResolvedPayload,
  RollActionRevisedPayload,
  RollAdd,
  RollDie,
  RollOracleResolvedPayload,
  RollPresageDrawnPayload,
  RollPricePaidPayload,
  RollProgressResolvedPayload,
  RollRawPayload,
  RollYesNoResolvedPayload,
} from '@for/engine';

import { zAttributeId, zLikelihood, zMoveId, zOutcome } from '../core/enums.js';
import { zCharacterId, zRollId, zSeq, zSlug, zTrackId } from '../primitives.js';

/** Score ceiling of an action roll. `rawTotal` keeps the unclamped value. */
export const ACTION_SCORE_CAP = 10;

export const zRollAdd = z.object({
  source: z.string(),
  value: z.number().int(),
}) satisfies z.ZodType<RollAdd>;

export const zChallengeDice = z.tuple([z.number().int(), z.number().int()]);

export const zRollActionResolvedPayload = z.object({
  rollId: zRollId,
  characterId: zCharacterId,
  moveId: zMoveId,
  attribute: zAttributeId,
  attributeValue: z.number().int(),
  actionDie: z.number().int(),
  adds: z.array(zRollAdd),
  /** Unclamped, kept so the journal reads without recomputing. */
  rawTotal: z.number().int(),
  /** Clamped to `ACTION_SCORE_CAP`. */
  total: z.number().int().max(ACTION_SCORE_CAP),
  cappedAtTen: z.boolean(),
  challengeDice: zChallengeDice,
  outcome: zOutcome,
  isPresage: z.boolean(),
  momentumBefore: z.number().int(),
  momentumNegated: z.boolean(),
  /** `true` while burning momentum on this roll is still legal. */
  burnWindow: z.boolean(),
  /** A literal, not the stream enum: an action roll comes from one stream. */
  rngStream: z.literal('action'),
  rngDrawIndex: z.number().int().nonnegative(),
}) satisfies z.ZodType<RollActionResolvedPayload>;

/**
 * The ONLY consequence of a momentum burn on an already written roll. The
 * journal is append-only: the first roll is never rewritten, its revision is
 * appended.
 */
export const zRollActionRevisedPayload = z.object({
  rollId: zRollId,
  revisedFromSeq: zSeq,
  total: z.number().int().max(ACTION_SCORE_CAP),
  outcome: zOutcome,
  isPresage: z.boolean(),
}) satisfies z.ZodType<RollActionRevisedPayload>;

export const zRollProgressResolvedPayload = z.object({
  rollId: zRollId,
  trackId: zTrackId,
  ticks: z.number().int(),
  filledBoxes: z.number().int().nonnegative(),
  challengeDice: zChallengeDice,
  outcome: zOutcome,
  isPresage: z.boolean(),
}) satisfies z.ZodType<RollProgressResolvedPayload>;

export const zRollOracleResolvedPayload = z.object({
  rollId: zRollId,
  tableId: zSlug,
  tableVersion: z.string(),
  dieSize: z.number().int().positive(),
  value: z.number().int().positive(),
  entryId: z.string().min(1),
  /** Content text, copied verbatim. */
  text: z.string(),
  tags: z.array(z.string()),
  question: z.string().optional(),
}) satisfies z.ZodType<RollOracleResolvedPayload>;

export const zRollYesNoResolvedPayload = z.object({
  rollId: zRollId,
  question: z.string(),
  likelihood: zLikelihood,
  threshold: z.number().int(),
  value: z.number().int(),
  answer: z.enum(['oui', 'non']),
  isExtreme: z.boolean(),
}) satisfies z.ZodType<RollYesNoResolvedPayload>;

/** ADR 0006: no `mode`, no `optionId`, no `playerChoices`. Ever. */
export const zRollPricePaidPayload = z.object({
  rollId: zRollId,
  /** The d12 the engine rolled. */
  value: z.number().int().min(1).max(12),
  entryId: z.string().min(1),
  text: z.string(),
  severity: z.string(),
  /** Which `suggestedEffect` the second `price` draw picked. */
  effectIndex: z.number().int().nonnegative(),
  targetCharacterId: zCharacterId.optional(),
}) satisfies z.ZodType<RollPricePaidPayload>;

export const zRollPresageDrawnPayload = z.object({
  rollId: zRollId,
  tableId: zSlug,
  value: z.number().int(),
  entryId: z.string().min(1),
  text: z.string(),
  triggeredByRollSeq: zSeq,
}) satisfies z.ZodType<RollPresageDrawnPayload>;

export const zRollDie = z.object({
  sides: z.number().int().positive(),
  value: z.number().int().positive(),
}) satisfies z.ZodType<RollDie>;

export const zRollRawPayload = z.object({
  rollId: zRollId,
  label: z.string(),
  dice: z.array(zRollDie),
  reason: z.string(),
}) satisfies z.ZodType<RollRawPayload>;
