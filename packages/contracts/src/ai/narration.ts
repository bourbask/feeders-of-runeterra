/**
 * The two ends of one narration: `zNarrationBrief` goes IN, `zNarrationOutput`
 * comes OUT.
 *
 * ── INVARIANT 1, WRITTEN AS A DIRECTION OF TRAVEL ───────────────────────────
 * The brief is a SETTLED FACT. Roll, outcome, applied effects, price drawn,
 * presage: all decided by `@for/engine` and all already in the journal before
 * the model is called. The storyteller dresses it. Read the two schemas next
 * to each other and the asymmetry is the guarantee:
 *
 *   `zNarrationBrief`  carries `outcome`, `appliedEffects`, `imposedPrice`.
 *   `zNarrationOutput` carries prose, and a scene block that holds names,
 *                      places and a refusal cause — NOT ONE NUMBER.
 *
 * Nothing the model returns is converted into a consequence by the engine.
 * That sentence is the whole review criterion for this file, and it is the one
 * `pay_price` failed (ADR 0006): the model was handed a `mode` the engine then
 * turned into a cost, which is invariant 1 through the back door. If a field
 * ever appears on the OUTPUT side that the engine would read to decide
 * something, the door is open again.
 *
 * ── THE MIRROR, AND WHAT IT DOES NOT CATCH ──────────────────────────────────
 * `zNarrationBrief satisfies z.ZodType<NarrationBrief>` catches a field the
 * engine declares and the schema forgot. ADR 0007 measured what it does not
 * catch: a field in excess, a narrowed enum, an invented variant. The enums
 * used here — `zMoveId`, `zOutcome`, `zAttributeId` — are each compared to the
 * engine tuple member by member in `tests/exhaustive-union.test.ts`, so the
 * narrowing hole is closed where it can be closed. The "field in excess" hole
 * cannot be closed at runtime for an interface: TypeScript erases it, and
 * there is no engine-side list of `NarrationBrief`'s keys to compare against.
 * Said out loud rather than left implied.
 *
 * ── WHAT IS NOT HERE, AND SHOULD BE ─────────────────────────────────────────
 * ADR 0008 decision 3 makes the perceptible-fact list PER RECIPIENT a
 * mechanical constraint, not a style note: "le moteur calcule, pour chaque
 * destinataire, la liste des faits perceptibles, et le conteur n'a le droit
 * d'utiliser que celle-là". `NarrationBrief` carries no such list, and this
 * schema mirrors the engine rather than inventing one — the engine is
 * canonical (01-architecture.md section 2.4), and a field added here alone
 * would be a contract nothing produces. Reported, not worked around: the
 * carrier belongs on the engine type first (M0-13), and the mirror follows.
 */

import { z } from 'zod';

import type { NarrationBrief } from '@for/engine';

import { zEngineEffect } from '../core/effects.js';
import { zAttributeId, zMoveId, zOutcome } from '../core/enums.js';
import { zChallengeDice, zRollAdd } from '../events/dice.js';
import {
  zCharacterId,
  zCorrelationId,
  zEventSeq,
  zRollId,
  zSceneId,
  zTrackId,
} from '../primitives.js';
import { SceneBlockSchema } from './scene.js';

/**
 * Ceiling on the prose the storyteller returns.
 *
 * Derived, not guessed: section 4.3 sets `maxOutputTokens: 800` for a
 * narration and section 7.1 retries a truncated one at 1 050. At roughly four
 * characters per French token that is ≈ 4 200 characters, so 4 000 is the
 * bound past which the text cannot be something we asked for. It is a
 * SAFETY bound, not a style rule: the "three to five sentences" instruction
 * lives in the prompt, where it can be measured by the eval assertions.
 */
export const NARRATION_PROSE_MAX = 4000;

/** The arithmetic of the action roll, so the prompt can spell it in words. */
export const zBriefRollDetail = z.object({
  rollId: zRollId,
  attribute: zAttributeId,
  attributeValue: z.number().int(),
  actionDie: z.number().int(),
  adds: z.array(zRollAdd),
  rawTotal: z.number().int(),
  total: z.number().int(),
  cappedAtTen: z.boolean(),
  challengeDice: zChallengeDice,
  momentumNegated: z.boolean(),
  burned: z.boolean(),
});

/**
 * A price ALREADY rolled, applied and journalled (P10, P21, ADR 0006).
 *
 * `entryId` and `text` are copied from the content table `pay-the-price`
 * without edit, and `effectIndex` is the second draw on the `price` RNG
 * stream. There is no variant to pick and no field to fill: the storyteller
 * integrates the entry as it stands. The absence of a `mode`, an `optionId` or
 * a list of candidates is the shape of that decision.
 */
export const zBriefImposedPrice = z.object({
  rollId: zRollId,
  tableId: z.string(),
  value: z.number().int(),
  entryId: z.string(),
  text: z.string(),
  severity: z.string(),
  effectIndex: z.number().int(),
});

export const zBriefPresage = z.object({
  tableId: z.string(),
  value: z.number().int(),
  entryId: z.string(),
  text: z.string(),
});

/** One already-applied consequence, with the journal line that produced it. */
export const zBriefAppliedEffect = z.object({
  effect: zEngineEffect,
  subjectCharacterId: zCharacterId.nullable(),
  trackId: zTrackId.nullable(),
  eventSeq: zEventSeq,
});

export const zNarrationBrief = z.object({
  /** Groups every event of the turn; the proof view keys on it. */
  correlationId: zCorrelationId,
  sceneId: zSceneId.nullable(),
  actorCharacterId: zCharacterId,
  moveId: zMoveId.nullable(),
  outcome: zOutcome.nullable(),
  isPresage: z.boolean(),
  roll: zBriefRollDetail.nullable(),
  appliedEffects: z.array(zBriefAppliedEffect),
  imposedPrice: zBriefImposedPrice.nullable(),
  presage: zBriefPresage.nullable(),
  /** What the player wrote, verbatim, for the `<intention>` block. */
  playerInput: z.string(),
  /** Journal sequences this turn wrote, ascending. */
  eventSeqs: z.array(zEventSeq),
  /**
   * Which fallback template to use if the storyteller fails. The engine only
   * PICKS — on the `fallback` RNG stream, so the choice replays identically —
   * and the text lives in the content bundle.
   */
  fallbackTemplateId: z.string(),
}) satisfies z.ZodType<NarrationBrief>;

/**
 * What one call to the storyteller produced, once the stream is over and the
 * `<scene_apres>` block has been read (F1→F8, section 2.3).
 *
 * `sceneBlock: null` is the ordinary case, not an error: a block that is
 * absent, badly closed, over 900 characters or malformed is IGNORED, the
 * previous scene state is kept to the byte, and the turn ends normally. That
 * is what stops this mechanism from being able to degrade availability.
 *
 * `.strict()`: an unknown key is refused rather than dropped, so nobody can
 * smuggle a field past the schema and have a consumer read it anyway.
 */
export const zNarrationOutput = z
  .object({
    /** The broadcast prose: everything before the opening tag, trimmed (F2). */
    prose: z.string().max(NARRATION_PROSE_MAX),
    /** Null when there was no usable block. See above. */
    sceneBlock: SceneBlockSchema.nullable(),
  })
  .strict();

export type NarrationBriefDto = z.output<typeof zNarrationBrief>;
export type NarrationOutput = z.output<typeof zNarrationOutput>;
